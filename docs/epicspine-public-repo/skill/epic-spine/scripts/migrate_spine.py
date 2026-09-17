#!/usr/bin/env python3
"""Preview a conservative full-to-compact migration; writes require --apply and a source hash."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import difflib
import hashlib
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.parse import quote

from validate_spine import STATE_ALIASES, STATE_FIELDS, is_empty, normalize, validate_local


@dataclass
class MigrationPlan:
    source: Path
    source_sha256: str
    original: bytes
    revised: str
    archive: Path


def anchor(heading: str) -> str:
    """GitHub heading fragment for the supported Markdown heading subset."""
    return re.sub(r"[^\w\- ]", "", heading.lower()).replace(" ", "-")


def plan_migration(source: Path) -> MigrationPlan:
    source = source.resolve()
    if source.suffix not in {".md", ".markdown"}:
        raise ValueError("migration source must be a .md or .markdown file")
    original = source.read_bytes()
    text = original.decode("utf-8")
    document = validate_local(source)
    if document.fields.get("Spine profile", "full").lower() != "full":
        raise ValueError("migration requires a full/legacy source; compact input is already migrated")
    if document.errors:
        raise ValueError("source must be reconciled before migration:\n" + "\n".join(document.errors))
    # Reference definitions can serve retained content from an archived section.
    # Without a complete Markdown reference resolver, refuse rather than sever
    # that dependency or guess renderer-specific heading fragments.
    if re.search(r"(?m)^[ \t]{0,3}\[[^\]\r\n]+\]:", text):
        raise ValueError("Markdown reference definitions require manual migration to preserve retained reference links")
    heading_texts = re.findall(r"(?m)^#{1,6} (.+?)[ \t]*\r?$", text)
    if any("[" in heading or "]" in heading for heading in heading_texts):
        raise ValueError("heading link/reference markup requires manual migration to preserve rendered fragments")
    headings = list(re.finditer(r"(?m)^## (.+?)[ \t]*\r?$", text))
    names = [normalize(match.group(1)) for match in headings]
    if len(names) != len(set(names)):
        raise ValueError("duplicate section names require manual reconciliation before migration")
    # Moving a heading can change old fragment links. Keep the original path's
    # heading stubs and refuse duplicate generated fragments that cannot be kept.
    fragments = [anchor(match.group(1)) for match in re.finditer(r"(?m)^#{1,6} (.+?)[ \t]*\r?$", text)]
    fragments += re.findall(r'<a\s+id=[\"\']([^\"\']+)[\"\']', text)
    if len(fragments) != len(set(fragments)):
        raise ValueError("ambiguous heading anchors require manual migration")
    if "Non-Goals" not in document.sections:
        raise ValueError("Non-Goals is missing; the steward must author it before migration")
    source_sha = hashlib.sha256(original).hexdigest()
    archive = source.with_name(f"{source.stem}.history-{source_sha[:12]}{source.suffix}")
    archive_link = quote(archive.name)
    state = dict(document.state)
    if not state.get("evidence") and document.sections.get("Validation Evidence"):
        state["evidence"] = f"[Preserved validation evidence]({archive_link}#validation-evidence)"
    missing = [label for label, key in STATE_FIELDS.items() if key not in state or (is_empty(state[key]) and not (key in {"waiting_on", "approved_work"} and state[key].lower() in {"none", "nothing", "n/a", "-"}))]
    if missing:
        raise ValueError("cannot infer missing state; reconcile source fields first: " + ", ".join(missing))
    preamble = text[:headings[0].start()] if headings else text
    preserved_lines = []
    for line in preamble.splitlines():
        field = re.match(r"^([A-Za-z][A-Za-z ]+):", line)
        if field and (field.group(1).lower() in STATE_ALIASES or field.group(1).lower() == "spine profile"):
            continue
        preserved_lines.append(line)
    preamble = "\n".join(preserved_lines).rstrip() + "\nSpine profile: compact\n"
    current = "\n".join(f"{label}: {state[key]}" for label, key in STATE_FIELDS.items())
    if "phase" in state:
        current += f"\nPhase: {state['phase']}"
    retained = {"Mission", "Non-Goals", "Definition Of Done", "Issue Ledger", "Decisions", "Spine Map", "Human Gates", "Write Scope", "Authority By Artifact", "Recovery And Takeover"}
    def historical_anchors(name: str) -> str:
        body = document.sections[name]
        targets = [(anchor(match.group(1)), match.group(1)) for match in re.finditer(r"(?m)^#{3,6} (.+?)[ \t]*$", body)]
        targets += [(value, value) for value in re.findall(r'<a\s+id=[\"\']([^\"\']+)[\"\']', body)]
        return "".join(f'\n- <a id="{fragment}"></a> [Preserved {label}]({archive_link}#{fragment}).' for fragment, label in targets)

    chunks = [preamble, "## Current State\n\n" + current + historical_anchors("Current State")]
    # Move the small active contract first. Durable decisions and evidence retain
    # their exact body text; all other content remains in the byte-exact archive.
    active_order = ["Mission", "Non-Goals", "Definition Of Done", "Issue Ledger", "Decisions"]
    navigation = []
    for name in active_order + [name for name in names if name not in active_order and name != "Current State"]:
        if name in retained or "book" in name.lower():
            chunks.append(f"## {name}\n\n{document.sections[name]}")
        else:
            navigation.append(f'- <a id="{anchor(name)}"></a> [Preserved {name}]({archive_link}#{anchor(name)}).' + historical_anchors(name))
    if navigation:
        chunks.append("Historical navigation; current execution facts are in [Current State](#current-state).\n\n" + "\n".join(navigation))
    revised = "\n\n".join(chunks) + "\n"
    with tempfile.TemporaryDirectory(prefix="epicspine-migration-check-") as tmp:
        candidate = Path(tmp) / source.name
        candidate.write_text(revised, encoding="utf-8")
        result = validate_local(candidate, ticket_source=source)
        if result.errors:
            raise ValueError("proposed compact document is invalid:\n" + "\n".join(result.errors))
    return MigrationPlan(source, source_sha, original, revised, archive)


def apply_migration(plan: MigrationPlan, expected_sha256: str) -> None:
    if expected_sha256 != plan.source_sha256:
        raise ValueError("expected source hash differs from this preview; review a fresh diff")
    if hashlib.sha256(plan.source.read_bytes()).hexdigest() != expected_sha256:
        raise ValueError("source changed after preview; refusing to overwrite newer work")
    # Exclusive archive creation avoids clobbering historical evidence. The
    # archive stays beside the source so existing relative links keep resolving.
    try:
        with plan.archive.open("xb") as handle:
            handle.write(plan.original)
    except FileExistsError:
        if plan.archive.read_bytes() != plan.original:
            raise ValueError("existing archive differs from original; refusing to overwrite historical evidence")
        # A previous attempt may have stopped after archiving. Reuse matching
        # evidence without rewriting it; the source freshness check still runs.
    # Replace the source atomically after the final freshness check. The archive
    # remains available even if replacement fails; never overwrite its evidence.
    descriptor, temporary = tempfile.mkstemp(prefix=f".{plan.source.name}.", dir=plan.source.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(plan.revised)
        os.chmod(temporary, plan.source.stat().st_mode)
        if hashlib.sha256(plan.source.read_bytes()).hexdigest() != expected_sha256:
            raise ValueError("source changed while preparing archive; original left untouched")
        os.replace(temporary, plan.source)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--apply", action="store_true", help="Apply the displayed migration after reviewing a preview")
    parser.add_argument("--expect-sha256", help="Source hash printed by the reviewed preview; required with --apply")
    args = parser.parse_args()
    try:
        plan = plan_migration(args.source)
        if args.apply and not args.expect_sha256:
            raise ValueError("--apply requires --expect-sha256 from a reviewed preview")
        print(f"Source SHA256: {plan.source_sha256}")
        print(f"Byte-exact history: {plan.archive}")
        print("".join(difflib.unified_diff(plan.original.decode("utf-8").splitlines(keepends=True), plan.revised.splitlines(keepends=True), fromfile=str(plan.source), tofile=str(plan.source))), end="")
        if args.apply:
            apply_migration(plan, args.expect_sha256)
            print("Applied; inspect the diff and validate before committing.")
        return 0
    except (OSError, UnicodeError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
