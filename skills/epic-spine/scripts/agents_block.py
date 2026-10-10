#!/usr/bin/env python3
"""Install and verify the EpicSpine always-on block in a repo's AGENTS.md.

Stdlib only, Python 3.10+. The template and ``VERSION`` are read relative to
this script's own location. ``install`` renders ``assets/agents-block.md``
(substituting ``{version}`` and ``{root_spine}``): it replaces an existing
``epicspine:begin``/``epicspine:end`` region in place, appends the block when
none is present, or creates ``AGENTS.md``. Running it twice changes nothing.
``check`` reports a missing, stale, or divergent block and exits non-zero.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL_DIR / "assets" / "agents-block.md"
VERSION_FILE = SKILL_DIR / "VERSION"
AGENTS_NAME = "AGENTS.md"
BLOCK_RE = re.compile(r"<!-- epicspine:begin [^>]*-->.*?<!-- epicspine:end -->", re.DOTALL)
BEGIN_RE = re.compile(r"<!-- epicspine:begin (.*?) -->")
ROOT_RE = re.compile(r"^Root spine: (.*?)\. Read its", re.MULTILINE)


def read_version() -> str:
    return VERSION_FILE.read_text(encoding="utf-8").strip()


def render(root_spine: str, version: str | None = None) -> str:
    text = TEMPLATE.read_text(encoding="utf-8")
    text = text.replace("{version}", version or read_version())
    return text.replace("{root_spine}", root_spine)


def install(repo: Path, root_spine: str) -> int:
    agents = repo / AGENTS_NAME
    block = render(root_spine)
    existing = agents.read_text(encoding="utf-8") if agents.is_file() else None
    if existing is None:
        updated = block
    elif BLOCK_RE.search(existing):
        updated = BLOCK_RE.sub(lambda _: block.rstrip("\n"), existing)
    else:
        updated = existing.rstrip("\n") + "\n\n" + block
    if updated != existing:
        agents.parent.mkdir(parents=True, exist_ok=True)
        agents.write_text(updated, encoding="utf-8")
    return 0


def check(repo: Path) -> int:
    agents = repo / AGENTS_NAME
    text = agents.read_text(encoding="utf-8") if agents.is_file() else ""
    match = BLOCK_RE.search(text)
    if not match:
        print(f"{AGENTS_NAME}: EpicSpine block missing")
        return 1

    problems: list[str] = []
    block = match.group(0)
    version = read_version()
    begin = BEGIN_RE.search(block)
    block_version = begin.group(1).strip() if begin else ""
    if block_version != version:
        problems.append(f"block version {block_version!r} differs from VERSION {version!r}")
    root = ROOT_RE.search(block)
    if not root:
        problems.append("block has no 'Root spine:' line")
    else:
        root_spine = root.group(1)
        if not (repo / root_spine).exists():
            problems.append(f"root spine path does not exist: {root_spine}")
        if block.rstrip("\n") + "\n" != render(root_spine, version):
            problems.append("block text differs from the rendered template")
    for problem in problems:
        print(problem)
    return 1 if problems else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="agents_block.py",
        description="Install or verify the EpicSpine block in AGENTS.md.",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    do_install = sub.add_parser("install", help="write or refresh the block")
    do_install.add_argument("--repo", type=Path, default=Path("."))
    do_install.add_argument("--root-spine", required=True)
    do_check = sub.add_parser("check", help="verify the block")
    do_check.add_argument("--repo", type=Path, default=Path("."))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "install":
        return install(args.repo, args.root_spine)
    if args.command == "check":
        return check(args.repo)
    return 2


if __name__ == "__main__":
    sys.exit(main())
