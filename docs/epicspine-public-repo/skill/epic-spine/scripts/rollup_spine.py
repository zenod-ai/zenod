#!/usr/bin/env python3
"""Check, preview and apply bounded direct-child execution projections."""
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from validate_spine import is_empty, is_history_snapshot, normalize, parse_fields, parse_sections, parse_table, read_state, resolve_local_link, validate_local

START = "<!-- epicspine-rollup:v1\n"
END = "\n-->"
PROJECTION_COLUMNS = ("Owner", "Source revision", "Input fingerprint", "Freshness", "Coverage", "Verification")
EXECUTION_FIELDS = ("owner", "status", "waiting_on", "evidence", "next_action", "source_revision")


def digest(value: bytes | str) -> str:
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def scoped(path: Path, root: Path) -> Path:
    path = path.resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"input is outside scope root: {path}")
    return path


def stored_receipt(text: str):
    count = text.count(START)
    if not count:
        return None
    if count != 1:
        raise ValueError("conflicting generated receipts")
    payload = text.split(START, 1)[1].split(END, 1)
    if len(payload) != 2:
        raise ValueError("interrupted or malformed generated receipt")
    if payload[1].strip():
        raise ValueError("generated receipt must be a trailing metadata block")
    try:
        receipt = json.loads(payload[0])
        if not isinstance(receipt, dict) or set(receipt) != {"version", "inputs", "fingerprint"} or receipt["version"] != 1:
            raise ValueError("unsupported generated receipt shape")
        if not isinstance(receipt["inputs"], list) or not isinstance(receipt["fingerprint"], str) or not re.fullmatch(r"[0-9a-f]{64}", receipt["fingerprint"]):
            raise ValueError("unsupported generated receipt values")
        for item in receipt["inputs"]:
            if not isinstance(item, dict) or set(item) != {"spine_id", "path", "source_sha256", "fingerprint", "ticket_sources"}:
                raise ValueError("unsupported generated input receipt shape")
            if not all(isinstance(item[key], str) for key in ("spine_id", "path", "source_sha256", "fingerprint")) or not isinstance(item["ticket_sources"], list):
                raise ValueError("unsupported generated input receipt values")
        return receipt
    except json.JSONDecodeError as error:
        raise ValueError("malformed generated receipt JSON") from error


@dataclass
class Node:
    path: Path
    text: str = ""
    source_hash: str = "missing"
    state: dict[str, str] = field(default_factory=dict)
    fields: dict[str, str] = field(default_factory=dict)
    spine_id: str = "unknown"
    children: list["Node"] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    tickets: list[dict[str, str]] = field(default_factory=list)
    ticket_hashes: dict[str, str] = field(default_factory=dict)
    fingerprint: str = ""
    receipt: dict = field(default_factory=dict)
    receipt_state: str = "missing"


class Graph:
    def __init__(self, root: Path, max_inputs: int = 256):
        self.root = root.resolve()
        self.max_inputs = max_inputs
        self.nodes: dict[Path, Node] = {}
        self.hashes: dict[str, str] = {}
        self.visiting: set[Path] = set()

    def read(self, path: Path) -> Node:
        path = scoped(path, self.root)
        if path in self.visiting:
            return Node(path, problems=["conflicting: hierarchy cycle"], fingerprint=digest("cycle:" + str(path)))
        if path in self.nodes:
            return self.nodes[path]
        node = Node(path)
        if len(self.nodes) >= self.max_inputs:
            node.problems.append("missing: input coverage limit reached")
            node.fingerprint = digest("coverage-limit:" + str(path))
            return node
        self.nodes[path] = node
        self.visiting.add(path)
        try:
            content = path.read_bytes()
            node.text = content.decode("utf-8")
            node.source_hash = digest(content)
            self.hashes[str(path)] = node.source_hash
            if is_history_snapshot(path):
                node.problems.append("unmanaged: historical snapshot is not active input")
            node.fields = parse_fields(node.text)
            node.spine_id = normalize(node.fields.get("Spine ID", "")) or "unknown"
            node.state, _, state_errors = read_state(node.text, compact=node.fields.get("Spine profile", "").lower() == "compact")
            node.problems.extend(("conflicting: " if "conflict" in error or "duplicate" in error else "unmanaged: ") + error for error in state_errors)
            # Preflight before the backend reader opens any ticket bytes. Its
            # explicitly permitted root can be broader than this rollup scope.
            if node.fields.get("Ticket backend", "github").lower() == "local":
                root_value = node.fields.get("Ticket root", "")
                if root_value:
                    scoped(path.parent / root_value, self.root)
            document = validate_local(path)
            node.spine_id = document.spine_id or "unknown"
            node.state = document.state
            node.tickets = document.tickets
            for error in document.errors:
                kind = "conflicting" if "conflict" in error or "duplicate" in error else "unmanaged"
                node.problems.append(f"{kind}: {error}")
            missing = [key for key in EXECUTION_FIELDS if not node.state.get(key) or (is_empty(node.state[key]) and not (key == "waiting_on" and node.state[key] == "none"))]
            if missing:
                node.problems.append("unmanaged: missing authoritative state " + ", ".join(missing))
            header, rows = parse_table(document.sections.get("Spine Map", ""))
            for row in rows:
                values = dict(zip(header, row))
                if values.get("Relationship", "").lower() != "child":
                    node.problems.append("conflicting: Spine Map contains a non-child relationship")
                    continue
                child_path = resolve_local_link(path, values.get("Spine", ""))
                if child_path is None:
                    child = Node(path, problems=["missing: nonlocal or unresolved child input"], fingerprint=digest(canonical(values)))
                else:
                    try:
                        child = self.read(child_path)
                    except (OSError, ValueError, RuntimeError) as error:
                        child = Node(child_path, problems=[f"missing: {error}"], fingerprint=digest(str(error)))
                if any(prior.path == child.path for prior in node.children):
                    child.problems.append("conflicting: duplicate direct-child registration")
                node.children.append(child)
                if child.source_hash != "missing":
                    if child.spine_id != values.get("Spine ID"):
                        child.problems.append("conflicting: parent registration and child Spine ID disagree")
                    if resolve_local_link(child.path, child.fields.get("Parent spine", "")) != path:
                        child.problems.append("conflicting: child does not declare this direct parent")
                    parent_root = path if node.fields.get("Root spine", "").lower() == "self" else resolve_local_link(path, node.fields.get("Root spine", ""))
                    child_root = resolve_local_link(child.path, child.fields.get("Root spine", ""))
                    if parent_root is None or child_root != parent_root:
                        child.problems.append("conflicting: child Root spine disagrees with the direct parent root")
            if path.read_bytes() != content:
                node.problems.append("conflicting: source changed while reading")
            if node.fields.get("Ticket backend", "github").lower() == "local":
                ticket_root = scoped(path.parent / node.fields.get("Ticket root", ""), self.root)
                ticket_header, ticket_rows = parse_table(parse_sections(node.text).get("Issue Ledger", ""))
                for row in ticket_rows:
                    reference = dict(zip(ticket_header, row)).get("Ticket", "")
                    location = resolve_local_link(path, reference)
                    if location is not None and location.is_relative_to(ticket_root) and location.is_file():
                        location = scoped(location, self.root)
                        fingerprint = digest(location.read_bytes())
                        self.hashes[str(location)] = fingerprint
                        node.ticket_hashes[os.path.relpath(location, self.root)] = fingerprint
                for ticket in node.tickets:
                    if ticket["backend"] == "local":
                        relative = os.path.relpath(ticket["location"], self.root)
                        if node.ticket_hashes.get(relative) != ticket["source_revision"].removeprefix("sha256:"):
                            node.problems.append("conflicting: ticket changed while reading")
        except (OSError, UnicodeError, ValueError, RuntimeError) as error:
            node.problems.append(f"missing: {error}")
        finally:
            self.visiting.remove(path)
        inputs = [{"spine_id": child.spine_id, "path": os.path.relpath(child.path, path.parent), "source_sha256": child.source_hash, "fingerprint": child.fingerprint, "ticket_sources": [{key: ticket[key] for key in ("identity", "source_revision", "verification", "freshness")} for ticket in child.tickets]} for child in node.children]
        node.receipt = {"version": 1, "inputs": inputs, "fingerprint": digest(canonical(inputs))}
        try:
            previous = stored_receipt(node.text)
            node.receipt_state = "fresh" if previous == node.receipt else "stale" if previous else "unmanaged"
        except ValueError as error:
            node.receipt_state = "conflicting"
            node.problems.append("conflicting: " + str(error))
        if node.children and node.receipt_state != "fresh":
            node.problems.append(f"{node.receipt_state}: descendant input receipt requires one-level reconciliation")
        for child in node.children:
            if child.problems:
                node.problems.append(f"incomplete: child {child.spine_id} has {', '.join(sorted({problem.split(':', 1)[0] for problem in child.problems}))} inputs")
        tickets = [{key: (os.path.relpath(value, self.root) if key == "location" and ticket["backend"] == "local" else value) for key, value in ticket.items()} for ticket in node.tickets]
        node.fingerprint = digest(canonical({"source": node.source_hash, "tickets": tickets, "ticket_hashes": node.ticket_hashes, "problems": sorted(set(node.problems)), "descendants": inputs}))
        return node


def raw_cells(line: str) -> list[str]:
    cells, current, backslashes = [], [], 0
    for character in line.strip()[1:]:
        if character == "|" and backslashes % 2 == 0:
            cells.append("".join(current).strip())
            current = []
        else:
            current.append(character)
        backslashes = backslashes + 1 if character == "\\" else 0
    if current:
        cells.append("".join(current).strip())
    return cells


def cell(value: str) -> str:
    return value.replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ")


def rebase_links(value: str, source: Path, target: Path, source_text: str = "") -> str:
    """Keep projected relative evidence/navigation links anchored to the child."""
    if re.search(r"\[[^\]]+\]\s*\[[^\]]*\]", value):
        raise ValueError("reference-style links in projected state require explicit reconciliation; use inline source links")
    definitions = {label.lower() for label in re.findall(r"(?m)^[ \t]{0,3}\[([^\]]+)\]:", source_text)}
    if any(label.lower() in definitions for label in re.findall(r"\[([^\]]+)\](?!\()", value)):
        raise ValueError("shortcut reference links in projected state require explicit reconciliation; use inline source links")
    def replace(match):
        parsed = urlsplit(match.group(2))
        if parsed.scheme or parsed.netloc:
            return match.group(0)
        destination = source if not parsed.path else source.parent / unquote(parsed.path)
        relative = quote(os.path.relpath(destination.resolve(), target.parent), safe="/.-_")
        return f"[{match.group(1)}]({urlunsplit(('', '', relative, parsed.query, parsed.fragment))})"
    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", replace, value)


def render_projection(parent: Node) -> str:
    text = parent.text
    stored_receipt(text)  # Never repair a malformed/ambiguous receipt by guessing.
    match = re.search(r"(?m)^## Spine Map[ \t]*\r?$", text)
    if not match:
        raise ValueError("target needs an explicit Spine Map section")
    section_end = re.search(r"(?m)^## ", text[match.end():])
    end = match.end() + section_end.start() if section_end else len(text)
    body = text[match.end():end]
    lines = body.splitlines(keepends=True)
    indexes = [i for i, line in enumerate(lines) if line.strip().startswith("|")]
    if not indexes:
        if not parent.children and "No child spines." in body:
            return text
        raise ValueError("target Spine Map needs one valid table")
    header_display = raw_cells(lines[indexes[0]])
    header = [normalize(name) for name in header_display]
    if len(header) != len(set(header)):
        raise ValueError("duplicate Spine Map columns require explicit reconciliation")
    if len(indexes) - 2 != len(parent.children):
        raise ValueError("target child rows are ambiguous; reconcile the Spine Map first")
    existing_rows = [raw_cells(lines[index]) for index in indexes[2:]]
    new_header = header + [name for name in PROJECTION_COLUMNS if name not in header]
    output = ["| " + " | ".join(header_display + [name for name in PROJECTION_COLUMNS if name not in header]) + " |\n", "|" + "|".join("---" for _ in new_header) + "|\n"]
    for original, child in zip(existing_rows, parent.children):
        values = dict(zip(header, original))
        problems = {problem.split(":", 1)[0] for problem in child.problems}
        freshness = next((value for value in ("conflicting", "missing", "unmanaged", "stale", "incomplete") if value in problems), "current-inputs")
        verification = ("source-read" if child.source_hash != "missing" else "unavailable") + ("; github-unverified" if any(ticket["verification"] == "unverified" for ticket in child.tickets) else "")
        updates = {
            "Owner": child.state.get("owner", "unknown"), "Status": child.state.get("status", "unknown"),
            "Health / Blocker": child.state.get("waiting_on", "unknown"), "Latest Evidence": child.state.get("evidence", "unknown"),
            "Next Action": child.state.get("next_action", "unknown"), "Source revision": child.state.get("source_revision", "unknown"),
            "Input fingerprint": child.fingerprint, "Freshness": freshness,
            "Coverage": "incomplete" if child.problems else "complete", "Verification": verification,
            "Last Rolled Up": "receipt:" + parent.receipt["fingerprint"][:12],
        }
        values.update({key: cell(rebase_links(value, child.path, parent.path, child.text)) for key, value in updates.items()})
        output.append("| " + " | ".join(values.get(name, "") for name in new_header) + " |\n")
    first, last = indexes[0], indexes[-1]
    rewritten = "".join(lines[:first] + output + lines[last + 1:])
    candidate = text[:match.end()] + rewritten + text[end:]
    if START in candidate:
        before, after = candidate.split(START, 1)
        if END not in after:
            raise ValueError("cannot overwrite interrupted receipt; reconcile the malformed block")
        candidate = before + after.split(END, 1)[1]
    return candidate.rstrip() + "\n\n" + START + canonical(parent.receipt) + END + "\n"


def plan_rollup(target: Path, scope_root: Path, max_inputs: int = 256) -> dict:
    if max_inputs < 1:
        raise ValueError("max inputs must be positive")
    root = scope_root.resolve()
    if not root.is_dir() or root == Path(root.anchor):
        raise ValueError("scope root must be an existing bounded directory")
    target = scoped(target, root)
    graph = Graph(root, max_inputs)
    parent = graph.read(target)
    if not parent.text:
        raise ValueError("target is missing or unreadable")
    # Cross-node IDs are checked independently of per-document state parsing.
    identities: dict[str, list[str]] = {}
    for node in graph.nodes.values():
        if node.spine_id != "unknown":
            identities.setdefault(node.spine_id, []).append(str(node.path))
    conflicts = [f"conflicting: duplicate Spine ID {identity}: {', '.join(paths)}" for identity, paths in identities.items() if len(paths) > 1]
    for identity, paths in identities.items():
        if len(paths) > 1:
            for path in paths:
                graph.nodes[Path(path)].problems.append(f"conflicting: duplicate Spine ID {identity}")
    candidate = render_projection(parent)
    input_hashes = {path: value for path, value in sorted(graph.hashes.items()) if Path(path) != target}
    return {
        "version": 1, "target": str(target), "scope_root": str(root), "max_inputs": max_inputs,
        "steward": parent.state.get("owner", ""), "target_sha256": parent.source_hash,
        "input_hashes": input_hashes, "candidate": candidate,
        "receipt": parent.receipt, "changed": candidate != parent.text,
        "coverage": {"loaded": sum(node.source_hash != "missing" for node in graph.nodes.values()), "inputs_seen": len(graph.nodes), "boundary": "reachable subtree only; ancestors are not written"},
        "problems": sorted(set(parent.problems + conflicts)),
        "input_diagnostics": [{"path": os.path.relpath(node.path, root), "spine_id": node.spine_id, "problems": sorted(set(node.problems))} for node in sorted(graph.nodes.values(), key=lambda node: str(node.path)) if node.problems],
    }


def proposal_hash(proposal: dict) -> str:
    return digest(canonical(proposal))


def apply_rollup(proposal: dict, *, bound_target: Path, steward: str, scope_root: Path, write_root: Path, expected_proposal_hash: str) -> str:
    if proposal_hash(proposal) != expected_proposal_hash:
        raise ValueError("proposal hash differs from the reviewed proposal")
    root = write_root.resolve()
    if not root.is_dir() or root == Path(root.anchor):
        raise ValueError("write root must be an explicit bounded directory")
    target = scoped(Path(proposal["target"]), root)
    if bound_target.resolve() != target:
        raise ValueError("proposal target differs from the explicit target binding")
    if scope_root.resolve() != Path(proposal["scope_root"]).resolve():
        raise ValueError("proposal read scope differs from the explicit scope binding")
    current = plan_rollup(target, scope_root, proposal["max_inputs"])
    if not steward or current["steward"] != steward or proposal["steward"] != steward:
        raise ValueError("target-steward binding does not match existing authoritative owner; proposal only")
    if current["input_hashes"] != proposal["input_hashes"] or current["receipt"] != proposal["receipt"]:
        raise ValueError("child inputs changed after review; regenerate proposal")
    if target.read_bytes().decode("utf-8") == proposal["candidate"]:
        return "already-applied"
    if current != proposal:
        raise ValueError("target or proposal changed after review; regenerate proposal")
    document = validate_local(target)
    if document.errors:
        raise ValueError("target has unresolved validation/authority errors; proposal only")
    for path, expected in proposal["input_hashes"].items():
        if digest(Path(path).read_bytes()) != expected:
            raise ValueError("input changed during reconciliation; no target write")
    descriptor, temporary = tempfile.mkstemp(prefix=f".{target.name}.rollup-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(proposal["candidate"])
        os.chmod(temporary, target.stat().st_mode)
        if digest(target.read_bytes()) != proposal["target_sha256"]:
            raise ValueError("target changed during reconciliation; no overwrite")
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return "applied"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("check", "preview", "apply"))
    parser.add_argument("target", type=Path, nargs="?")
    parser.add_argument("--scope-root", type=Path)
    parser.add_argument("--max-inputs", type=int, default=256)
    parser.add_argument("--proposal", type=Path, help="Preview output path or reviewed proposal to apply")
    parser.add_argument("--steward")
    parser.add_argument("--write-root", type=Path)
    parser.add_argument("--expect-proposal-sha256")
    args = parser.parse_args()
    try:
        if args.mode == "apply":
            if not all((args.target, args.proposal, args.steward, args.scope_root, args.write_root, args.expect_proposal_sha256)):
                raise ValueError("apply requires a bound target, --proposal, --steward, --scope-root, --write-root and --expect-proposal-sha256")
            proposal = json.loads(args.proposal.read_text())
            print(apply_rollup(proposal, bound_target=args.target, steward=args.steward, scope_root=args.scope_root, write_root=args.write_root, expected_proposal_hash=args.expect_proposal_sha256))
            return 0
        if not args.target or not args.scope_root:
            raise ValueError("check/preview requires a target and explicit --scope-root")
        plan = plan_rollup(args.target, args.scope_root, args.max_inputs)
        print(canonical({key: plan[key] for key in ("changed", "coverage", "problems", "input_diagnostics")}))
        print("Proposal SHA256: " + proposal_hash(plan))
        if args.mode == "preview":
            original = args.target.read_bytes().decode("utf-8")
            print("".join(difflib.unified_diff(original.splitlines(keepends=True), plan["candidate"].splitlines(keepends=True), fromfile=str(args.target), tofile=str(args.target))), end="")
            if args.proposal:
                scoped(args.proposal, args.scope_root.resolve())
                with args.proposal.open("x", encoding="utf-8") as handle:
                    handle.write(json.dumps(plan, indent=2) + "\n")
        return 1 if args.mode == "check" and (plan["changed"] or plan["problems"]) else 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
