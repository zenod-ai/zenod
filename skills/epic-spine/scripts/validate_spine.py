#!/usr/bin/env python3
"""Validate the structural contracts of an EpicSpine Markdown document."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


REQUIRED_FIELDS = (
    "Status",
    "Updated",
    "Repository",
    "Primary document",
    "Integration branch",
    "Active spine steward",
    "Last reconciled commit",
)

REQUIRED_SECTIONS = (
    "Role Bindings",
    "Write Scope",
    "Authority By Artifact",
    "Mission",
    "Definition Of Done",
    "Current State",
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

ACTIVE_STATUSES = {"active", "blocked", "review", "testing"}
EMPTY_VALUES = {"", "-", "none", "n/a", "tbd", "<sha>", "<task/thread/agent>"}


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().strip("`"))


def parse_sections(text: str) -> dict[str, str]:
    matches = list(re.finditer(r"(?m)^## (.+?)\s*$", text))
    sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        sections[normalize(match.group(1))] = text[match.end() : end].strip()
    return sections


def parse_fields(text: str) -> dict[str, str]:
    first_section = re.search(r"(?m)^## ", text)
    preamble = text[: first_section.start()] if first_section else text
    return {
        normalize(match.group(1)): normalize(match.group(2))
        for match in re.finditer(r"(?m)^([A-Za-z][A-Za-z ]+):\s*(.+?)\s*$", preamble)
    }


def parse_table(section: str) -> tuple[list[str], list[list[str]]]:
    lines = [line.strip() for line in section.splitlines() if line.strip().startswith("|")]
    if len(lines) < 2:
        return [], []

    def cells(line: str) -> list[str]:
        return [normalize(cell) for cell in line.strip("|").split("|")]

    header = cells(lines[0])
    rows = []
    for line in lines[2:]:
        row = cells(line)
        if len(row) == len(header):
            rows.append(row)
    return header, rows


def is_empty(value: str) -> bool:
    return normalize(value).lower() in EMPTY_VALUES or normalize(value).startswith("<")


def validate(path: Path) -> dict[str, object]:
    errors: list[str] = []
    warnings: list[str] = []
    text = path.read_text(encoding="utf-8")
    fields = parse_fields(text)
    sections = parse_sections(text)

    for field in REQUIRED_FIELDS:
        if field not in fields:
            errors.append(f"missing field: {field}")
        elif is_empty(fields[field]):
            warnings.append(f"unresolved field: {field}")

    for section in REQUIRED_SECTIONS:
        if section not in sections:
            errors.append(f"missing section: {section}")

    ledger = sections.get("Issue Ledger", "")
    header, rows = parse_table(ledger)
    if not header:
        errors.append("Issue Ledger has no Markdown table")
    else:
        for column in REQUIRED_LEDGER_COLUMNS:
            if column not in header:
                errors.append(f"Issue Ledger missing column: {column}")

        positions = {name: index for index, name in enumerate(header)}
        if all(name in positions for name in ("Issue", "Owner / Assignment", "Status", "PR/Branch", "Base", "Latest Evidence", "Last Verified", "Next Action")):
            for row_number, row in enumerate(rows, start=1):
                status = row[positions["Status"]].lower()
                issue = row[positions["Issue"]]
                if status in ACTIVE_STATUSES:
                    for column in ("Owner / Assignment", "PR/Branch", "Base", "Last Verified", "Next Action"):
                        if is_empty(row[positions[column]]):
                            errors.append(f"ledger row {row_number} ({issue}) is {status} but {column} is empty")
                if status == "done" and is_empty(row[positions["Latest Evidence"]]):
                    errors.append(f"ledger row {row_number} ({issue}) is done without evidence")

    if "YYYY-MM-DD" in fields.get("Updated", ""):
        warnings.append("Updated still contains a template date")

    return {"path": str(path), "errors": errors, "warnings": warnings}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--strict", action="store_true", help="Treat warnings as failures")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable results")
    args = parser.parse_args()

    results = []
    exit_code = 0
    for path in args.paths:
        if not path.is_file():
            result = {"path": str(path), "errors": ["file not found"], "warnings": []}
        else:
            result = validate(path)
        results.append(result)
        if result["errors"] or (args.strict and result["warnings"]):
            exit_code = 1

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        for result in results:
            print(result["path"])
            for error in result["errors"]:
                print(f"  ERROR: {error}")
            for warning in result["warnings"]:
                print(f"  WARN: {warning}")
            if not result["errors"] and not result["warnings"]:
                print("  OK")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
