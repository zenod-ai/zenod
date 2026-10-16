#!/usr/bin/env python3
"""Pre-commit gate (installed by ``agents_block.py install``): staged spine/ticket Markdown must be
``validate_spine.py --trackable``. A fixable file with no unstaged changes is fixed (``--fix``) and re-staged; with
unstaged changes it blocks with the exact fix command; it also blocks when only a guess would fix it. ``--strict``
is advisory (printed, never blocks). A staged ``.md`` is a spine if it has ``## Current State`` or ``Spine ID:``,
a ticket if it has ``Ticket ID:``."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import spine_fix  # noqa: E402
import validate_spine as v  # noqa: E402


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], capture_output=True, text=True)


def say(message: str) -> None:
    print(f"epicspine: {message}", file=sys.stderr)


def main() -> int:
    top = git("rev-parse", "--show-toplevel").stdout.strip()
    if top:
        os.chdir(top)
    blocked = False
    for name in filter(None, git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").stdout.split("\0")):
        path = Path(name)
        if not (name.endswith(".md") and path.is_file()):
            continue
        raw = path.read_bytes()
        text = raw.decode("utf-8", errors="replace")
        kind = v.doc_kind(text)
        if kind is None:
            continue
        result, hint = v.trackable(path), ""
        if not result["trackable"] and (change := spine_fix.fix_text(text)) and change[1] and text.encode() == raw:
            if git("diff", "--quiet", "--", name).returncode:
                hint = f"; unstaged changes, so not auto-fixed: run `python3 {HERE / 'validate_spine.py'} --fix {name}`, review, then `git add {name}`"
            else:
                path.write_bytes(change[0].encode("utf-8"))
                git("add", "--", name)
                say(f"fixed {name}: " + "; ".join(change[1]))
                result = v.trackable(path)
        if not result["trackable"]:
            blocked = True
            say(f"{name}: not trackable: " + "; ".join(result["missing"]) + hint)
        if kind == "spine" and v.validate_local(path).fails(strict=True):
            say(f"{name}: --strict issues (advisory; run validate_spine.py --strict)")
    if blocked:
        say("commit blocked; fix the above, or bypass once with git commit --no-verify")
    return int(blocked)


if __name__ == "__main__":
    sys.exit(main())
