#!/usr/bin/env python3
"""Validate the local document and connected-graph contracts of EpicSpines."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlsplit


REQUIRED_FIELDS = (
    "Status",
    "Updated",
    "Repository",
    "Primary document",
    "Spine ID",
    "Spine Type",
    "Root spine",
    "Parent spine",
    "Additional root rationale",
    "Integration branch",
    "Active spine steward",
    "Last reconciled commit",
)

REQUIRED_SECTIONS = (
    "Role Bindings",
    "Write Scope",
    "Authority By Artifact",
    "Spine Map",
    "Mission",
    "Definition Of Done",
    "Current State",
    "Execution Cursor",
    "Bootstrap Map",
    "Decisions",
    "Issue Ledger",
    "Branch And Integration",
    "Human Gates",
    "Recovery And Takeover",
    "Validation Evidence",
    "Handoff Journal",
    "Open Questions",
)

REQUIRED_CURSOR_FIELDS = (
    "Last attempted",
    "Result",
    "Execution status",
    "Waiting on",
    "Approved work",
    "Next action",
)

REQUIRED_SPINE_MAP_COLUMNS = (
    "Spine ID",
    "Relationship",
    "Spine",
    "Purpose",
    "Status",
    "Health / Blocker",
    "Latest Evidence",
    "Last Rolled Up",
    "Next Action",
)

REQUIRED_DECISION_COLUMNS = (
    "Date",
    "Outcome",
    "Decision / Attempt",
    "Durable Summary",
    "Evidence",
    "Revisit When",
)

REQUIRED_LEDGER_COLUMNS = (
    "Issue",
    "Role",
    "Owner / Assignment",
    "Title",
    "Status",
    "PR/Branch",
    "Base",
    "Latest Evidence",
    "Last Verified",
    "Next Action",
)

COMPACT_FIELDS = ("Repository", "Primary document", "Spine ID", "Integration branch")
COMPACT_SECTIONS = ("Mission", "Non-Goals", "Current State", "Definition Of Done", "Issue Ledger", "Decisions")
STATE_FIELDS = {
    "Owner": "owner", "Status": "status", "Last attempted": "last_attempted",
    "Result": "result", "Evidence": "evidence", "Waiting on": "waiting_on",
    "Approved work": "approved_work", "Next action": "next_action",
    "Source revision": "source_revision", "Verified at": "verified_at",
}
STATE_ALIASES = {
    **{label.lower(): key for label, key in STATE_FIELDS.items()},
    "phase": "phase", "execution status": "status", "active spine steward": "owner",
    "blocker": "waiting_on", "blockers": "waiting_on", "latest evidence": "evidence",
    "last reconciled commit": "source_revision", "last verified": "verified_at",
}

DIALECTS = {"v1", "v2"}
ACCEPTANCE_SURFACES = {"browser", "cli", "library", "infrastructure", "documentation"}

ACTIVE_STATUSES = {"active", "blocked", "review", "testing"}
LEDGER_STATUSES = {"draft", "ready", "active", "blocked", "review", "testing", "done", "superseded", "deferred"}
DECISION_OUTCOMES = {"accepted", "rejected", "superseded"}
EMPTY_VALUES = {"", "-", "none", "n/a", "tbd", "<sha>", "<task/thread/agent>"}


@dataclass
class SpineDocument:
    path: Path
    fields: dict[str, str]
    sections: dict[str, str]
    errors: list[str]
    warnings: list[str]
    state: dict[str, str] = field(default_factory=dict)
    state_sources: dict[str, list[str]] = field(default_factory=dict)
    tickets: list[dict[str, str]] = field(default_factory=list)

    @property
    def diagnostics(self) -> list[dict[str, object]]:
        # Compute after graph validation too; preserve mutable legacy lists.
        return [classify_diagnostic(message, error=True) for message in self.errors] + [
            classify_diagnostic(message, error=False) for message in self.warnings]

    def fails(self, *, strict: bool = False) -> bool:
        return bool(self.errors) or (strict and any(d["category"] == "required-data" for d in self.diagnostics))

    @property
    def spine_id(self) -> str:
        return normalize(self.fields.get("Spine ID", ""))

    @property
    def spine_type(self) -> str:
        return normalize(self.fields.get("Spine Type", "")).lower()


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().strip("`"))


def parse_sections(text: str) -> dict[str, str]:
    matches = list(re.finditer(r"(?m)^## (.+?)[ \t]*$", text))
    sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        sections[normalize(match.group(1))] = text[match.end() : end].strip()
    return sections


def parse_key_values(text: str) -> dict[str, str]:
    return {
        normalize(match.group(1)): normalize(match.group(2))
        for match in re.finditer(r"(?m)^([A-Za-z][A-Za-z ]+):[ \t]*([^\r\n]*?)[ \t]*\r?$", text)
    }


def parse_fields(text: str) -> dict[str, str]:
    first_section = re.search(r"(?m)^## ", text)
    preamble = text[: first_section.start()] if first_section else text
    return parse_key_values(preamble)


def read_state(text: str, *, compact: bool = False) -> tuple[dict[str, str], dict[str, list[str]], list[str]]:
    """Normalize execution facts without selecting a winner for contradictions.

    Values are single-line strings; provenance is source section/label/line.
    Conflicting keys are omitted from the returned state and reported as errors.
    This API is shared with migration and execution-only rollup consumers.
    """
    candidates: dict[str, list[tuple[str, str]]] = {}
    errors: list[str] = []
    section = "preamble"
    section_counts: dict[str, int] = {}
    for number, line in enumerate(text.splitlines(), 1):
        heading = re.fullmatch(r"## (.+?)[ \t]*", line)
        if heading:
            section = normalize(heading.group(1))
            section_counts[section] = section_counts.get(section, 0) + 1
            continue
        if section not in {"preamble", "Current State", "Execution Cursor"}:
            continue
        match = re.fullmatch(r"([A-Za-z][A-Za-z ]+):[ \t]*(.*)", line)
        if not match:
            continue
        label, value = normalize(match.group(1)), normalize(match.group(2))
        key = STATE_ALIASES.get(label.lower())
        if key is None:
            continue
        source = f"{section} / {label} (line {number})"
        if compact and section != "Current State":
            errors.append(f"competing compact state: {source}; author facts only in Current State")
        candidates.setdefault(key, []).append((value, source))
    for name in ("Current State", "Execution Cursor"):
        if section_counts.get(name, 0) > 1:
            errors.append(f"duplicate state section: {name}")
    state: dict[str, str] = {}
    sources: dict[str, list[str]] = {}
    for key, entries in candidates.items():
        sources[key] = [source for _, source in entries]
        def comparable(value: str) -> str:
            if key == "waiting_on" and value.lower() in {"none", "nothing", "n/a", "-", "no blockers"}:
                return "none"
            return value.lower() if key == "status" else value
        # Legacy templates remain usable, but unresolved placeholders never
        # supply a trustworthy value to migration or rollup consumers.
        resolved = [(value, source) for value, source in entries if value and not value.startswith("<") and not (key == "status" and value.lower().startswith("draft | ready | active"))]
        distinct = {comparable(value) for value, _ in resolved}
        if len(distinct) > 1:
            details = "; ".join(f"{source} = {value!r}" for value, source in resolved)
            errors.append(f"conflicting state {key}: {details}; reconcile explicitly before migration or rollup")
            continue
        if resolved:
            state[key] = comparable(resolved[0][0]) if key in {"waiting_on", "status"} else resolved[0][0]
        elif entries:
            state[key] = entries[0][0]
    if compact:
        for label, key in STATE_FIELDS.items():
            if key not in candidates:
                errors.append(f"Current State missing field: {label}")
            elif key in state:
                value = state[key]
                if is_empty(value) and not (key in {"waiting_on", "approved_work"} and value.lower() in {"none", "nothing", "n/a", "-"}):
                    errors.append(f"Current State unresolved field: {label}")
        if state.get("status") and state["status"] not in LEDGER_STATUSES:
            errors.append(f"Current State invalid Status: {state['status']}")
    return state, sources, errors


def parse_table(
    section: str,
    *,
    errors: list[str] | None = None,
    line_offset: int = 0,
    section_name: str = "table",
) -> tuple[list[str], list[list[str]]]:
    """Read one contiguous pipe table; optionally collect source-located errors.

    The two-value return remains compatible with graph and dialect callers.
    Contract sections contain one table, so a second block is rejected instead
    of silently joining its headers and rows to the first table.
    """
    lines = section.splitlines()
    starts = [i for i, line in enumerate(lines) if line.strip().startswith("|")]
    if not starts:
        return [], []

    def report(index: int, message: str) -> None:
        if errors is not None:
            errors.append(f"{section_name} line {line_offset + index + 1}: {message}")

    def cells(line: str) -> list[str]:
        # Only unescaped pipes delimit cells, including the optional end pipe.
        # An odd run of backslashes escapes a pipe; an even run does not.
        parts: list[str] = []
        cell: list[str] = []
        backslashes = 0
        for character in line.strip()[1:]:
            if character == "|" and backslashes % 2 == 0:
                parts.append(normalize("".join(cell)))
                cell = []
            else:
                if character == "|":
                    cell.pop()  # Remove the Markdown escape, retain literal pipe.
                cell.append(character)
            backslashes = backslashes + 1 if character == "\\" else 0
        if cell or not line.rstrip().endswith("|") or backslashes:
            parts.append(normalize("".join(cell)))
        return parts

    start = starts[0]
    end = start + 1
    while end < len(lines) and lines[end].strip().startswith("|"):
        end += 1
    for index in starts:
        if index >= end and (index == 0 or not lines[index - 1].strip().startswith("|")):
            report(index, "additional table block; keep the contract in one contiguous table")

    header = cells(lines[start])
    if start + 1 >= end:
        report(start, "table is missing its separator row")
        return header, []
    separator = cells(lines[start + 1])
    if len(separator) != len(header) or not all(re.fullmatch(r":?-{3,}:?", cell) for cell in separator):
        report(start + 1, f"invalid table separator; expected {len(header)} cells of at least three hyphens with optional alignment colons")

    rows = []
    for index in range(start + 2, end):
        row = cells(lines[index])
        if len(row) != len(header):
            report(index, f"malformed table row: expected {len(header)} cells, found {len(row)}; escape literal pipes as \\|")
        else:
            rows.append(row)
    return header, rows


def is_empty(value: str) -> bool:
    normalized = normalize(value)
    return normalized.lower() in EMPTY_VALUES or normalized.startswith("<")


def is_none(value: str) -> bool:
    return normalize(value).lower() in {"none", "n/a", "-"}


def markdown_target(value: str) -> str | None:
    match = re.search(r"\[[^\]]+\]\(([^)]+)\)", value)
    return unquote(match.group(1)).split("#", 1)[0] if match else None


def is_issue_reference(value: str) -> bool:
    """Check a GitHub/Enterprise HTTPS issue route without contacting the host."""
    target = normalize(value)
    if target.startswith("["):
        link = re.fullmatch(r"\[[^\]\n]+\]\((https://[^\s)]+)\)", target)
        if not link:
            return False
        target = link.group(1)
    if re.search(r"\s", target):
        return False
    try:
        url = urlsplit(target)
        hostname = url.hostname or ""
        # Accessing port rejects malformed/out-of-range ports even without I/O.
        if url.port == 0:
            return False
    except ValueError:
        return False
    if url.scheme != "https" or url.username is not None or url.password is not None:
        return False
    if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", hostname):
        return False
    if any(not label or label.startswith("-") or label.endswith("-") for label in hostname.split(".")):
        return False
    route = re.fullmatch(r"/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/issues/([1-9][0-9]*)/?", url.path)
    return bool(route and route.group(1) not in {".", ".."} and route.group(2) not in {".", ".."})


def resolve_local_link(source: Path, value: str) -> Path | None:
    target = markdown_target(value)
    if target is None:
        candidate = normalize(value).split("#", 1)[0]
        if candidate.lower() in {"", "none", "n/a", "self", "-"} or "://" in candidate:
            return None
        target = candidate
    if "://" in target or target.startswith("#"):
        return None
    path = Path(target)
    return (path if path.is_absolute() else source.parent / path).resolve()


def table_rows(section: str) -> list[dict[str, str]]:
    header, rows = parse_table(section)
    return [dict(zip(header, row)) for row in rows]


def read_tickets(path: Path, fields: dict[str, str], sections: dict[str, str]) -> tuple[list[dict[str, str]], list[str]]:
    """Read authoritative local files or explicitly unverified GitHub snapshots.

    Local identity is scoped to this board. Duplicate identities are excluded
    rather than choosing one source. Callers must inspect all returned errors.
    """
    backend = normalize(fields.get("Ticket backend", "github")).lower()
    errors: list[str] = []
    tickets: list[dict[str, str]] = []
    if backend not in {"github", "local"}:
        return [], [f"unsupported Ticket backend: {backend or '(empty)'}; expected github or local"]
    header, rows = parse_table(sections.get("Issue Ledger", ""))
    if backend == "github":
        for number, row in enumerate(rows, 1):
            values = dict(zip(header, row))
            issue = values.get("Issue", "")
            status = values.get("Status", "").lower()
            template_status = issue.lower() == "draft" and re.fullmatch(r"<[^<>]+>", status)
            if status not in LEDGER_STATUSES and not template_status:
                errors.append(f"ledger row {number} has invalid Status: {status or '(empty)'}")
            if issue.lower() == "draft" and (status == "draft" or template_status):
                continue
            if not is_issue_reference(issue):
                errors.append(f"ledger row {number} has invalid Issue: expected an HTTPS GitHub issue URL (draft is allowed only for draft rows)")
                continue
            if status not in LEDGER_STATUSES:
                continue
            parsed = urlsplit(markdown_target(issue) or normalize(issue))
            location = f"https://{parsed.netloc.lower()}{parsed.path.rstrip('/')}"
            tickets.append({
                "identity": "github:" + location.lower(), "location": location,
                "status": values.get("Status", "").lower(),
                "owner": values.get("Owner / Assignment", ""),
                "evidence": values.get("Latest Evidence", ""), "waiting_on": values.get("Waiting on", ""), "backend": backend,
                "verification": "unverified", "freshness": "unknown", "source_revision": "",
                "declared_verified_at": values.get("Last Verified", ""),
            })
    else:
        source_dir = path.resolve().parent
        checkout = next((parent for parent in (source_dir, *source_dir.parents) if (parent / ".git").exists()), source_dir)
        permitted = fields.get("Ticket permitted root", "")
        if permitted:
            if not Path(permitted).is_absolute() or is_empty(permitted):
                return [], ["Ticket permitted root must be an explicit absolute directory"]
            try:
                checkout = Path(permitted).resolve()
            except (OSError, ValueError, RuntimeError):
                return [], ["Ticket permitted root is invalid or inaccessible"]
            if checkout == Path(checkout.anchor):
                return [], ["Ticket permitted root must be bounded below the filesystem root"]
        root_value = fields.get("Ticket root", "")
        if is_empty(root_value):
            return [], ["local ticket backend requires a resolved Ticket root"]
        try:
            root = (source_dir / root_value).resolve()
        except (OSError, ValueError, RuntimeError):
            return [], ["Ticket root is invalid or inaccessible"]
        if not root.is_relative_to(checkout):
            return [], ["Ticket root escapes the checkout; declare a bounded absolute Ticket permitted root for authorized external files"]
        if not root.is_dir():
            return [], [f"Ticket root is not an existing directory: {root}"]
        required = ("Ticket", "Depends On")
        for column in required:
            if column not in header:
                errors.append(f"local Issue Ledger missing column: {column}")
        extra = set(header) - set(required)
        if extra:
            errors.append("local Issue Ledger is references/dependencies only; remove duplicated fields: " + ", ".join(sorted(extra)))
        for number, row in enumerate(rows, 1):
            values = dict(zip(header, row))
            reference = values.get("Ticket", "")
            target = reference
            if target.startswith("["):
                match = re.fullmatch(r"\[[^\]\n]+\]\(([^\s)]+)\)", target)
                target = match.group(1) if match else ""
            try:
                parsed = urlsplit(target)
            except ValueError:
                errors.append(f"local ledger row {number} has malformed Ticket reference")
                continue
            if not target or is_empty(target) or parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
                errors.append(f"local ledger row {number} has unresolved Ticket reference: use a relative Markdown file path without query/fragment")
                continue
            local_path = Path(unquote(parsed.path))
            if local_path.is_absolute():
                errors.append(f"local ledger row {number} requires a relative Ticket path")
                continue
            try:
                ticket_path = (source_dir / local_path).resolve()
            except (OSError, ValueError, RuntimeError):
                errors.append(f"local ledger row {number} has invalid or inaccessible Ticket path")
                continue
            if not ticket_path.is_relative_to(root):
                errors.append(f"local ledger row {number} Ticket escapes Ticket root: {reference}")
                continue
            if ticket_path.suffix.lower() not in {".md", ".markdown"} or not ticket_path.is_file():
                errors.append(f"local ledger row {number} Ticket file is missing or not Markdown: {reference}")
                continue
            try:
                content = ticket_path.read_bytes()
                text = content.decode("utf-8")
            except (OSError, UnicodeError) as error:
                errors.append(f"local ticket could not be read: {ticket_path}: {error}")
                continue
            ticket_fields = parse_fields(text)
            ticket_errors = []
            for label in ("Ticket ID", "Status", "Owner", "Evidence"):
                if is_empty(ticket_fields.get(label, "")):
                    ticket_errors.append(f"local ticket {reference} missing or unresolved field: {label}")
                preamble = re.split(r"(?m)^## ", text, maxsplit=1)[0]
                labels = [normalize(match.group(1)) for match in re.finditer(r"(?m)^([A-Za-z][A-Za-z ]+):", preamble)]
                if labels.count(label) > 1:
                    ticket_errors.append(f"local ticket {reference} has duplicate field: {label}")
            identity = ticket_fields.get("Ticket ID", "")
            if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]*", identity):
                ticket_errors.append(f"local ticket {reference} has invalid Ticket ID: {identity or '(empty)'}")
            status = ticket_fields.get("Status", "").lower()
            if status not in LEDGER_STATUSES:
                ticket_errors.append(f"local ticket {reference} has invalid Status: {status or '(empty)'}")
            if ticket_errors:
                errors.extend(error for error in ticket_errors if error not in errors)
                continue
            tickets.append({
                "identity": "local:" + identity, "location": str(ticket_path),
                "status": status, "owner": ticket_fields["Owner"], "evidence": ticket_fields["Evidence"],
                "waiting_on": ticket_fields.get("Waiting on", ""),
                "backend": backend, "verification": "local-read", "freshness": "unknown",
                "source_revision": "sha256:" + hashlib.sha256(content).hexdigest(),
                "declared_verified_at": ticket_fields.get("Verified at", ""),
            })
        identities = {ticket["identity"][len("local:"):] for ticket in tickets}
        for number, row in enumerate(rows, 1):
            depends = dict(zip(header, row)).get("Depends On", "")
            if depends.lower() in {"none", "-", "n/a"}:
                continue
            for identity in (value.strip() for value in depends.split(",")):
                if identity not in identities:
                    errors.append(f"local ledger row {number} unresolved dependency Ticket ID: {identity or '(empty)'}")
    seen: dict[str, list[str]] = {}
    for ticket in tickets:
        seen.setdefault(ticket["identity"], []).append(ticket["location"])
    duplicates = {identity for identity, locations in seen.items() if len(locations) > 1}
    for identity in sorted(duplicates):
        errors.append(f"duplicate ticket identity {identity}: " + ", ".join(seen[identity]))
    return [ticket for ticket in tickets if ticket["identity"] not in duplicates], errors


def classify_diagnostic(message: str, *, error: bool) -> dict[str, object]:
    """Stable rule families; prose is not an execution or structural proof."""
    lower = message.lower()
    required = any(term in lower for term in ("unresolved", "missing field:", "is empty", "without evidence", "required acceptance", "required evidence"))
    required = required or lower == "updated still contains a template date"
    required = required or lower.startswith(("v2 discovery missing", "v2 human gates should include column", "v2 issue ledger should include", "v2 definition of done should have"))
    required = required or bool(re.match(r"v2 ledger row \d+ has no ", lower))
    if error:
        category = "required-data" if required else "structural"
    else:
        category = "required-data" if required else "advisory"
    if "required acceptance" in lower:
        rule = "ES-D-ACCEPTANCE"
    elif "required evidence" in lower:
        rule = "ES-D-EVIDENCE"
    elif category == "advisory":
        rule = "ES-A-PROSE"
    elif category == "required-data":
        rule = "ES-D-REQUIRED"
    elif any(word in lower for word in ("table", "column", "separator", "malformed table")):
        rule = "ES-S-TABLE"
    elif any(word in lower for word in ("ticket", "ledger row", "issue ledger")):
        rule = "ES-S-TICKET"
    elif any(word in lower for word in ("dialect", "profile", "acceptance surface")):
        rule = "ES-S-DIALECT"
    elif any(word in lower for word in ("conflicting state", "duplicate state", "competing compact")):
        rule = "ES-S-STATE"
    elif any(word in lower for word in ("parent", "root", "child", "graph", "spine id", "spine type")):
        rule = "ES-S-GRAPH"
    else:
        rule = "ES-S-CONTRACT"
    return {"rule_id": rule, "category": category, "severity": "error" if error else "warning",
            "message": message, "fails_strict": error or category == "required-data"}


def acceptance_warnings(fields: dict[str, str], sections: dict[str, str]) -> list[str]:
    """Check declared acceptance data, not preferred phrasing or journey length.

    Explicit surface-qualified methods accept free prose. Legacy Evidence lines
    and evidence-producing steps use a small compatibility vocabulary, not the
    old conjunction of mandatory phrases. Human review still assesses adequacy.
    """
    dod = sections.get("Definition Of Done", "")
    ship = re.split(r"(?im)^\s*HARDEN\b", dod, maxsplit=1)[0]
    data = parse_key_values(ship)
    checks = re.findall(r"(?m)^\s*-\s*\[[ xX]\]\s*(?:\d+\.\s*)?(.+)$", ship)
    outcome = data.get("Acceptance outcome", "")
    warnings = []
    resolved_outcome = not is_empty(outcome) if "Acceptance outcome" in data else any(
        not is_empty(item) and not item.lower().startswith("test package:") for item in checks)
    if not resolved_outcome:
        warnings.append("v2 required acceptance: declare a resolved observable outcome or acceptance checkbox")
    surface = normalize(fields.get("Acceptance surface", "")).lower()
    if surface not in ACCEPTANCE_SURFACES:
        return warnings
    method = data.get("Evidence method", "")
    qualified = re.fullmatch(r"(browser|cli|library|infrastructure|documentation):\s*(.+)", method, re.I)
    if "Evidence method" in data:
        valid = bool(qualified and qualified[1].lower() == surface and not is_empty(qualified[2]))
    else:
        # Compatibility with the documented v2 Evidence declaration and older
        # inline journeys. This does not require exact words, order, or a count.
        evidence = data.get("Evidence", "")
        patterns = {
            "browser": r"browser|screenshot|screen capture|playwright|selenium",
            "cli": r"command|terminal|stdout|stderr|exit (?:code|status)|shell",
            "library": r"consumer|import|unit test|behavior(?:al)? (?:check|test)|api test",
            "infrastructure": r"probe|health check|telemetry|deployment test|service check",
            "documentation": r"render|link check|walkthrough|follow.*instruction|example",
        }
        candidates = [evidence] if "Evidence" in data else [line for line in checks if not line.lower().startswith("test package:") and re.search(r"evidence|capture|record|verify|check|inspect", line, re.I)]
        valid = any(not is_empty(value) and re.search(patterns[surface], value, re.I) for value in candidates)
    if not valid:
        warnings.append(f"v2 required evidence: declare a resolved {surface} evidence method (Evidence method: {surface}: <how results are observed and recorded>)")
    return warnings


def contains_all(value: str, *terms: str) -> bool:
    lowered = value.lower()
    return all(term.lower() in lowered for term in terms)


def dialect_warnings(text: str, fields: dict[str, str], sections: dict[str, str]) -> list[str]:
    """Optional prose guidance; required data is classified separately."""
    warnings: list[str] = []
    dod = sections.get("Definition Of Done", "")
    if not (re.search(r"(?im)^\s*SHIP\b", dod) and re.search(r"(?im)^\s*HARDEN\b", dod)):
        warnings.append("v2 Definition Of Done should have SHIP and HARDEN tiers")
    else:
        ship = re.split(r"(?im)^\s*HARDEN\b", dod, maxsplit=1)[0]
        for label, terms in (
            ("personal execution", ("personally",)),
            ("first-failure repair/restart loop", ("first failure", "dispatch", "restart", "step 1")),
            ("reproducible test-package handoff", ("test package", "exact commit", "environment", "limits")),
        ):
            if not contains_all(ship, *terms):
                warnings.append(f"v2 SHIP journey should state the {label} contract")
        for number, line in re.findall(r"(?m)^\s*-\s*\[[ xX]\]\s*(\d+)\.\s*(.+)$", ship):
            if "test package" not in line.lower() and not re.search(r"\b(PORT|DUPLICATE|BUILD)\b", line, re.I):
                warnings.append(f"v2 SHIP step {number} lacks PORT/DUPLICATE/BUILD marking")

    roles = sections.get("Role Bindings", "")
    if not contains_all(roles, "Epic worker", "MANAGER", "dispatch", "walk"):
        warnings.append("v2 Epic-worker role should contain the manager mandate")
    if not (contains_all(roles, "Ticket worker", "FIRST ACTION", "git worktree add") and re.search(r"never .*?(checkout|switch)|never (checkout|switch)", roles, re.I | re.S)):
        warnings.append("v2 Ticket-worker role should require worktree first action and ban shared-clone checkout/switch")
    if not contains_all(roles, "PORT/DUPLICATE", "adaptation", "validation"):
        warnings.append("v2 Ticket-worker role should record reuse adaptations and validation")

    current = sections.get("Current State", "")
    if not contains_all(current, "base", "pinned", "no rebase"):
        warnings.append("v2 Current State should record a pinned base and no-rebases-until-journey-passes rule")
    status = fields.get("Status", "")
    gated = "dispatch only after" in status.lower() or "pending" in status.lower() and "gate" in status.lower()
    if gated and not ("dispatch" in current.lower() and ("gate" in current.lower() or "condition" in current.lower())):
        warnings.append("gated status should repeat its dispatch condition in Current State")
    if "superseded" in status.lower() and not contains_all(status, "by", "do not execute"):
        warnings.append("SUPERSEDED status should name the replacement and say do not execute")

    decisions = sections.get("Decisions", "")
    if not contains_all(decisions, "safe", "reversible", "approved scope", "journal", "gate"):
        warnings.append("v2 Decisions should constrain defaults to safe reversible choices within approved scope, journal uncertainty, and preserve gates")
    discovery = sections.get("Architecture And Context", "")
    discovery_fields = parse_key_values(discovery)
    for field in ("Search scope", "Search budget", "Search evidence", "Method rationale"):
        if field not in discovery_fields:
            warnings.append(f"v2 discovery missing field: {field}")
        elif is_empty(discovery_fields[field]):
            warnings.append(f"v2 discovery unresolved field: {field}")

    ledger = sections.get("Issue Ledger", "")
    header, rows = parse_table(ledger)
    for concept, alternatives in (
        ("Wave", ("Wave",)), ("Budget", ("Budget",)),
        ("worktree dispatch record", ("Worktree", "Worktree / PR / Branch")),
        ("PORT/DUPLICATE/BUILD method", ("Method", "Source", "Origin")),
    ):
        if not any(name in header for name in alternatives):
            warnings.append(f"v2 Issue Ledger should include {concept}")
    if rows and header:
        pos = {name: i for i, name in enumerate(header)}
        method_col = next((name for name in ("Method", "Source", "Origin") if name in pos), None)
        title_col = "Title" if "Title" in pos else None
        for n, row in enumerate(rows, 1):
            haystack = " ".join(row[pos[name]] for name in (title_col, method_col) if name)
            if not re.search(r"\b(PORT|DUPLICATE|BUILD)\b", haystack, re.I):
                warnings.append(f"v2 ledger row {n} lacks PORT/DUPLICATE/BUILD marking")
            for column in ("Wave", "Budget", "Worktree"):
                if column in pos and is_empty(row[pos[column]]):
                    warnings.append(f"v2 ledger row {n} has no {column}")
        first = " ".join(rows[0][pos[name]] for name in ("Title", "Acceptance") if name in pos)
        if not re.search(r"touchable|observable|deploy|running|open|URL|login|script|demo|journey step|consumer|render|probe|command", first, re.I):
            warnings.append("v2 first ledger ticket should be the earliest human-touchable milestone")

    gates = sections.get("Human Gates", "")
    gate_header, gate_rows = parse_table(gates)
    for required in ("Gate", "Human Owner", "Trigger", "Exact Approval / Input Required", "What May Continue"):
        if required not in gate_header:
            warnings.append(f"v2 Human Gates should include column: {required}")
    if not contains_all(gates, "BLOCKED ON", "stop dependent work", "independent authorized work", "silence", "approval"):
        warnings.append("v2 Human Gates should stop dependent work, allow only independent authorized work, and never treat silence as approval")

    recovery = sections.get("Recovery And Takeover", "")
    if not contains_all(recovery, "manager reassigns", "silent past", "budget"):
        warnings.append("v2 Recovery should reassign tickets silent past budget")

    whole = text.lower()
    if not ("30 min" in whole and "lap/state | blocker | eta" in whole and "two consecutive eta" in whole):
        warnings.append("v2 spine should define the 30-minute heartbeat and two-ETA-slip rule")
    if not re.search(r"live customer data.*snapshot.*checksum.*restore drill", whole, re.S):
        warnings.append("v2 spine should define proportional ceremony by risk class")
    if not re.search(r"wave 1.*wave 2.*(journey|then)", whole, re.S):
        warnings.append("v2 spine should define disjoint waves followed by the manager journey loop")
    appendix = sections.get("Appendix", "")
    if not ("input" in appendix.lower() and ("absence rule" in appendix.lower() or "non-blocking" in appendix.lower())):
        warnings.append("v2 Appendix should list human inputs with absence-rules")
    if "worker dispatch prompt" not in appendix.lower():
        warnings.append("v2 Appendix should store versioned Worker Dispatch Prompts")
    if "no human in the loop" in whole:
        warnings.append("banned v2 phrase: no human in the loop")
    return warnings


def is_history_snapshot(path: Path) -> bool:
    """Recognize byte-exact migration archives; inventory must exclude these."""
    match = re.search(r"\.history-([0-9a-f]{12})\.(?:md|markdown)$", path.name)
    return bool(match and path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest().startswith(match.group(1)))


def validate_local(path: Path, *, dialect: str = "auto", ticket_source: Path | None = None) -> SpineDocument:
    """Validate a document; ticket_source preserves path context in migration previews."""
    errors: list[str] = []
    warnings: list[str] = []
    if not path.is_file():
        return SpineDocument(path, {}, {}, ["file not found"], [])

    if is_history_snapshot(path):
        return SpineDocument(path.resolve(), {}, {}, ["historical snapshot is not an active spine; exclude it from active/graph inventory"], [])

    text = path.read_text(encoding="utf-8")
    fields = parse_fields(text)
    sections = parse_sections(text)
    profile = normalize(fields.get("Spine profile", "full")).lower()
    compact = profile == "compact"
    if profile not in {"full", "compact"}:
        errors.append(f"unsupported Spine profile: {profile}; expected full or compact")
    state, state_sources, state_errors = read_state(text, compact=compact)
    errors.extend(state_errors)

    # A supported CLI selection overrides the declaration; it cannot conceal an
    # invalid declaration. Missing declarations select legacy v1 in auto mode.
    if dialect not in DIALECTS | {"auto"}:
        errors.append(f"unsupported dialect override: {dialect}; expected auto, v1 or v2")
    declared_dialect = normalize(fields.get("Spine dialect", "")).lower()
    if "Spine dialect" in fields and declared_dialect not in DIALECTS:
        errors.append(f"unsupported Spine dialect: {declared_dialect or '(empty)'}; expected v1 or v2")
    selected_dialect = (declared_dialect or "v1") if dialect == "auto" else dialect
    if selected_dialect == "v2":
        surface = normalize(fields.get("Acceptance surface", "")).lower()
        template_choices = [part.strip() for part in surface.split("|")]
        is_surface_template = len(template_choices) == len(ACCEPTANCE_SURFACES) and set(template_choices) == ACCEPTANCE_SURFACES
        if not surface or is_empty(surface) or is_surface_template:
            warnings.append("v2 unresolved Acceptance surface: choose browser, cli, library, infrastructure or documentation")
        elif surface not in ACCEPTANCE_SURFACES:
            errors.append(f"unsupported Acceptance surface: {surface}; expected browser, cli, library, infrastructure or documentation")

    # Validate the table syntax once, before semantic and graph readers reuse it.
    for match in re.finditer(r"(?m)^## (.+?)[ \t]*$", text):
        name = normalize(match.group(1))
        if name in {"Spine Map", "Decisions", "Issue Ledger", "Human Gates"}:
            content_start = match.end()
            while content_start < len(text) and text[content_start].isspace():
                content_start += 1
            parse_table(
                sections.get(name, ""), errors=errors,
                line_offset=text.count("\n", 0, content_start), section_name=name,
            )

    required_fields = COMPACT_FIELDS if compact else REQUIRED_FIELDS
    if compact and any(name in fields for name in ("Spine Type", "Root spine", "Parent spine")):
        required_fields += ("Spine Type", "Root spine", "Parent spine", "Additional root rationale")
    for field in required_fields:
        if field not in fields:
            errors.append(f"missing field: {field}")
        elif is_empty(fields[field]) and field not in {"Parent spine", "Additional root rationale"}:
            warnings.append(f"unresolved field: {field}")

    for section in (COMPACT_SECTIONS if compact else REQUIRED_SECTIONS):
        if section not in sections:
            errors.append(f"missing section: {section}")

    for name in ("Mission", "Definition Of Done", *(() if compact else ("Validation Evidence",))):
        if name in sections and is_empty(sections[name]):
            warnings.append(f"unresolved required section: {name}")

    spine_type = normalize(fields.get("Spine Type", "")).lower()
    root_spine = normalize(fields.get("Root spine", "")).lower()
    parent_spine = normalize(fields.get("Parent spine", "")).lower()
    if spine_type and spine_type not in {"root", "branch"} and not spine_type.startswith("<") and "|" not in spine_type:
        errors.append("Spine Type must be root or branch")
    elif spine_type == "root":
        if root_spine != "self":
            errors.append("root spine must declare Root spine: self")
        if parent_spine != "none":
            errors.append("root spine must declare Parent spine: none")
    elif spine_type == "branch":
        if root_spine in {"", "self", "none", "n/a"} or root_spine.startswith("<"):
            errors.append("branch spine must link to its root spine")
        if parent_spine in {"", "self", "none", "n/a"} or parent_spine.startswith("<"):
            errors.append("branch spine must link to its direct parent spine")
        if root_spine and markdown_target(fields.get("Root spine", "")) is None:
            warnings.append("branch Root spine should be a Markdown link for navigation and graph validation")
        if parent_spine and markdown_target(fields.get("Parent spine", "")) is None:
            warnings.append("branch Parent spine should be a Markdown link for navigation and graph validation")

    cursor = parse_key_values(sections.get("Execution Cursor", ""))
    for field in (() if compact else REQUIRED_CURSOR_FIELDS):
        if field not in cursor:
            errors.append(f"Execution Cursor missing field: {field}")
        elif is_empty(cursor[field]):
            warnings.append(f"Execution Cursor unresolved field: {field}")

    spine_map = sections.get("Spine Map", "No child spines." if compact else "")
    if "No child spines." not in spine_map:
        header, rows = parse_table(spine_map)
        if not header:
            errors.append("Spine Map must contain a direct-child table or 'No child spines.'")
        else:
            for column in REQUIRED_SPINE_MAP_COLUMNS:
                if column not in header:
                    errors.append(f"Spine Map missing column: {column}")
            for row_number, row in enumerate(rows, start=1):
                values = dict(zip(header, row))
                relationship = values.get("Relationship", "").lower()
                if relationship and relationship != "child" and not relationship.startswith("<"):
                    errors.append(f"Spine Map row {row_number} Relationship must be child")
                for column in ("Spine ID", "Spine", "Purpose", "Status", "Health / Blocker", "Last Rolled Up", "Next Action"):
                    if column in values and is_empty(values[column]) and not (column == "Health / Blocker" and normalize(values[column]).lower() in {"none", "no blocker", "no blockers", "nothing", "n/a", "-"}):
                        warnings.append(f"Spine Map row {row_number} unresolved field: {column}")

    decisions = sections.get("Decisions", "")
    decision_header, decision_rows = parse_table(decisions)
    if not decision_header:
        errors.append("Decisions has no Markdown table")
    else:
        for column in REQUIRED_DECISION_COLUMNS:
            if column not in decision_header:
                errors.append(f"Decisions missing column: {column}")
        decision_positions = {name: index for index, name in enumerate(decision_header)}
        if "Outcome" in decision_positions:
            for row_number, row in enumerate(decision_rows, start=1):
                outcome = row[decision_positions["Outcome"]].lower()
                if outcome not in DECISION_OUTCOMES and not outcome.startswith("<"):
                    errors.append(f"decision row {row_number} has invalid Outcome: {outcome}")
                if outcome in {"rejected", "superseded"}:
                    is_template_row = any(normalize(value).startswith("<") for value in row)
                    if is_template_row:
                        continue
                    for column in ("Durable Summary", "Evidence", "Revisit When"):
                        if column in decision_positions and is_empty(row[decision_positions[column]]):
                            errors.append(f"decision row {row_number} is {outcome} but {column} is empty")

    backend = normalize(fields.get("Ticket backend", "github")).lower()
    ledger = sections.get("Issue Ledger", "")
    header, rows = parse_table(ledger)
    if not header:
        errors.append("Issue Ledger has no Markdown table")
    elif backend == "github":
        for column in REQUIRED_LEDGER_COLUMNS:
            if column not in header:
                errors.append(f"Issue Ledger missing column: {column}")

        for row_number, row in enumerate(rows, start=1):
            values = dict(zip(header, row))
            status = values.get("Status", "").lower()
            issue = values.get("Issue", "")
            # Only a deliberately unassigned draft may carry a status placeholder.
            # Placeholders elsewhere never exempt a real row from status/URL checks.
            template_status = issue.lower() == "draft" and re.fullmatch(r"<[^<>]+>", status)
            if "Status" in values and status not in LEDGER_STATUSES:
                if template_status:
                    warnings.append(f"ledger row {row_number} unresolved field: Status")
                else:
                    errors.append(f"ledger row {row_number} has invalid Status: {status or '(empty)'}")
            if "Issue" in values:
                draft_reference = issue.lower() == "draft" and (status == "draft" or template_status)
                if not draft_reference and not is_issue_reference(issue):
                    errors.append(f"ledger row {row_number} has invalid Issue: expected an HTTPS GitHub issue URL (draft is allowed only for draft rows)")
            if status in ACTIVE_STATUSES:
                for column in ("Owner / Assignment", "PR/Branch", "Base", "Last Verified", "Next Action"):
                    if column in values and is_empty(values[column]):
                        errors.append(f"ledger row {row_number} ({issue}) is {status} but {column} is empty")
            if status == "done" and "Latest Evidence" in values and is_empty(values["Latest Evidence"]):
                errors.append(f"ledger row {row_number} ({issue}) is done without evidence")

    tickets, ticket_errors = read_tickets(ticket_source or path, fields, sections)
    errors.extend(ticket_errors)

    if "YYYY-MM-DD" in fields.get("Updated", ""):
        warnings.append("Updated still contains a template date")

    if selected_dialect == "v2":
        guidance = dialect_warnings(text, fields, sections)
        if backend == "local":
            guidance = [message for message in guidance if not message.startswith(("v2 Issue Ledger", "v2 ledger", "v2 first ledger"))]
        if compact:
            guidance = [message for message in guidance if message.startswith(("v2 SHIP", "v2 Definition Of Done"))]
        warnings.extend(guidance)
        warnings.extend(acceptance_warnings(fields, sections))

    return SpineDocument(path.resolve(), fields, sections, errors, warnings, state, state_sources, tickets)


def validate_graph(documents: list[SpineDocument]) -> None:
    existing = [doc for doc in documents if doc.path.is_file()]
    by_path = {doc.path: doc for doc in existing}
    by_id: dict[str, SpineDocument] = {}
    for doc in existing:
        if doc.fields.get("Spine profile", "").lower() == "compact" and not doc.spine_type:
            doc.errors.append("graph validation requires explicit hierarchy fields for compact spines; lineage is undeclared")
        if is_empty(doc.spine_id):
            continue
        if doc.spine_id in by_id:
            doc.errors.append(f"duplicate Spine ID also used by {by_id[doc.spine_id].path}")
            by_id[doc.spine_id].errors.append(f"duplicate Spine ID also used by {doc.path}")
        else:
            by_id[doc.spine_id] = doc

    roots = [doc for doc in existing if doc.spine_type == "root"]
    if len(roots) > 1:
        canonical = [doc for doc in roots if is_none(doc.fields.get("Additional root rationale", ""))]
        if len(canonical) != 1:
            paths = ", ".join(str(doc.path) for doc in roots)
            for doc in roots:
                doc.errors.append(
                    "a multi-root graph must have exactly one canonical root with "
                    f"Additional root rationale: n/a; roots: {paths}"
                )

    def require_graph_target(doc: SpineDocument, field: str) -> SpineDocument | None:
        target = resolve_local_link(doc.path, doc.fields.get(field, ""))
        if target is None:
            doc.errors.append(f"graph validation requires a local Markdown link for {field}")
            return None
        target_doc = by_path.get(target)
        if target_doc is None:
            doc.errors.append(f"{field} target is not included in graph validation: {target}")
        return target_doc

    for doc in existing:
        if doc.spine_type != "branch":
            continue
        parent = require_graph_target(doc, "Parent spine")
        declared_root = require_graph_target(doc, "Root spine")
        if parent is not None and parent.path == doc.path:
            doc.errors.append("spine cannot be its own parent")
        if declared_root is not None and declared_root.spine_type != "root":
            doc.errors.append(f"declared Root spine is not type root: {declared_root.path}")

        if parent is not None:
            registrations = table_rows(parent.sections.get("Spine Map", ""))
            matches = []
            for row in registrations:
                row_target = resolve_local_link(parent.path, row.get("Spine", ""))
                if row.get("Spine ID") == doc.spine_id or row_target == doc.path:
                    matches.append((row, row_target))
            if not matches:
                doc.errors.append(f"parent does not reciprocally register this branch in Spine Map: {parent.path}")
            else:
                row, row_target = matches[0]
                if row.get("Spine ID") != doc.spine_id:
                    doc.errors.append(f"parent Spine Map uses wrong Spine ID for this branch: {row.get('Spine ID')}")
                if row_target != doc.path:
                    doc.errors.append("parent Spine Map link does not resolve to this branch")

        seen = {doc.path}
        cursor = parent
        computed_root: SpineDocument | None = None
        while cursor is not None:
            if cursor.path in seen:
                doc.errors.append(f"parent cycle detected through {cursor.path}")
                break
            seen.add(cursor.path)
            if cursor.spine_type == "root":
                computed_root = cursor
                break
            if cursor.spine_type != "branch":
                break
            cursor_path = resolve_local_link(cursor.path, cursor.fields.get("Parent spine", ""))
            cursor = by_path.get(cursor_path) if cursor_path else None
        if computed_root is not None and declared_root is not None and computed_root.path != declared_root.path:
            doc.errors.append(
                f"declared root {declared_root.path} disagrees with parent-chain root {computed_root.path}"
            )

    for parent in existing:
        for row in table_rows(parent.sections.get("Spine Map", "")):
            if row.get("Relationship", "").lower() != "child":
                continue
            child_path = resolve_local_link(parent.path, row.get("Spine", ""))
            if child_path is None:
                parent.errors.append(f"graph validation requires local child link for Spine ID {row.get('Spine ID', '?')}")
                continue
            child = by_path.get(child_path)
            if child is None:
                parent.errors.append(f"child target is not included in graph validation: {child_path}")
                continue
            declared_parent = resolve_local_link(child.path, child.fields.get("Parent spine", ""))
            if declared_parent != parent.path:
                parent.errors.append(f"child {child.path} does not point back to this parent")


def result_for(doc: SpineDocument) -> dict[str, object]:
    return {"path": str(doc.path), "errors": doc.errors, "warnings": doc.warnings, "diagnostics": doc.diagnostics}


def validate(path: Path, *, dialect: str = "auto") -> dict[str, object]:
    """Validate one spine; retain legacy keys and add classified diagnostics."""
    return result_for(validate_local(path, dialect=dialect))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--strict", action="store_true", help="Fail structural defects and unresolved required data; prose advice does not fail")
    parser.add_argument("--dialect", choices=("auto", "v1", "v2"), default="auto",
                        help="Override a supported Spine dialect declaration; auto uses the declaration or defaults to v1")
    parser.add_argument(
        "--graph",
        action="store_true",
        help="Validate local parent/root links, reciprocal registration, cycles, IDs, and multiple roots across all paths",
    )
    parser.add_argument("--json", action="store_true", help="Emit machine-readable results")
    args = parser.parse_args()

    documents = [validate_local(path, dialect=args.dialect) for path in args.paths]
    if args.graph:
        validate_graph(documents)

    results = [result_for(doc) for doc in documents]
    exit_code = 0
    for document in documents:
        if document.fails(strict=args.strict):
            exit_code = 1

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        for result in results:
            print(result["path"])
            for diagnostic in result["diagnostics"]:
                print(f"  {diagnostic['severity'].upper()} [{diagnostic['rule_id']} / {diagnostic['category']}]: {diagnostic['message']}")
            if not result["errors"] and not result["warnings"]:
                print("  OK")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
