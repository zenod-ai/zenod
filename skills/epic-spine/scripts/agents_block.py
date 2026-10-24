#!/usr/bin/env python3
"""Install and verify the EpicSpine always-on block (per repo, or machine-wide).

Stdlib only, Python 3.10+. Repo ``install``/``check``/``uninstall`` write the thin
``assets/agents-block.md`` (repo facts + pointer; shared rules live in the live global
block) into AGENTS.md. ``install`` also refreshes harness mirrors that already exist
(CLAUDE.md, GEMINI.md: ``@AGENTS.md`` pointer; ``.cursor/rules/epicspine.mdc``,
``.github/copilot-instructions.md``: copy) and creates them only with ``--mirrors``;
it migrates an old full block and installs a pre-commit hook (gate: ``--trackable``). Existing content is kept; reruns change nothing.
``*-global`` write a pointer to the global block plus each harness's session-start hook
(``--no-hooks`` opts out); see global_install.py. ``print-hook``/``print-global`` emit the live block.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import global_install  # noqa: E402

SKILL_DIR = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL_DIR / "assets" / "agents-block.md"
AGENTS_NAME = "AGENTS.md"
POINTERS = ("CLAUDE.md", "GEMINI.md")
COPIES = (".cursor/rules/epicspine.mdc", ".github/copilot-instructions.md")
CURSOR_HEAD = "---\ndescription: EpicSpine always-on bind\nalwaysApply: true\n---\n\n"
BLOCK_RE = global_install.BLOCK_RE
BEGIN_RE = re.compile(r"<!-- epicspine:begin (.*?) -->")
PROFILE_RE = re.compile(r"^Dispatch profile:[ \t]*(\S.*?)[ \t]*$", re.MULTILINE)
MACHINE_FILE = global_install.MACHINE_FILE
LOCAL_FILE = global_install.LOCAL_FILE
ROOT_RE = re.compile(r"^Root spine: (.*?)\. Read ", re.MULTILINE)
NO_SPINE = "none"  # a repo with no root spine yet: the block still carries the bind, learnings and sync rules
# Old full blocks: rules 3 (workers) and 4 (integrate) that are not the stock text are repo-specific.
CUSTOM_RULE_RE = re.compile(
    r"^(?!3\. Workers: use the root spine's|4\. Integrate: verify diff and checks yourself, "
    r"fast-forward main, run tests, revert on red, remove the worktree\.$)[34]\. .*$", re.MULTILINE)
HOOK_MARK = "# epicspine:pre-commit"
HOOK_SKILLS = ('"$HOME/.agents/skills/epic-spine"',)  # stable fallback if the install-time path moves
CARRIED_HEAD = "Carried over from the old EpicSpine block (repo-specific; fold into the root spine's `Dispatch profile:` / `Integration policy:`, then delete):"


def block_id() -> str:
    """Marker id: stable across skill releases; bump it in the template only when the text changes."""
    return BEGIN_RE.search(TEMPLATE.read_text(encoding="utf-8")).group(1).strip()


def render(root_spine: str) -> str:
    read = "the README's first screen" if root_spine == NO_SPINE else "its Current State and Operating Learnings"
    return TEMPLATE.read_text(encoding="utf-8").replace("{root_spine}", root_spine).replace("{read}", read)


def pointer() -> str:
    return f"<!-- epicspine:begin {block_id()} -->\n@{AGENTS_NAME}\n<!-- epicspine:end -->\n"


def hook_path(repo: Path) -> Path | None:
    """The repo's pre-commit hook path (honors core.hooksPath); None outside a git repo."""
    done = subprocess.run(["git", "-C", str(repo), "rev-parse", "--git-path", "hooks/pre-commit"], capture_output=True, text=True)
    return repo / done.stdout.strip() if done.returncode == 0 and done.stdout.strip() else None


def hook_text() -> str:
    skills = " ".join((f'"{global_install.ig.install_dir(global_install.SKILL_DIR) or SKILL_DIR}"', *HOOK_SKILLS))  # never a worktree path
    return (f"#!/bin/sh\n{HOOK_MARK} (managed by agents_block.py; logic lives in the skill; commits need --trackable spines/tickets)\n"
            f'for s in {skills}; do\n  [ -f "$s/scripts/pre_commit.py" ] && exec python3 "$s/scripts/pre_commit.py" "$@"\ndone\nexit 0\n')


def install_hook(repo: Path) -> None:
    hook = hook_path(repo)
    if hook is None:
        return
    old = hook.read_text(encoding="utf-8", errors="replace") if hook.is_file() else None
    if old is not None and HOOK_MARK not in old:
        print(f"pre-commit: foreign hook at {hook}; EpicSpine trackable gate not installed")
    elif old != hook_text():
        hook.parent.mkdir(parents=True, exist_ok=True)
        hook.write_text(hook_text(), encoding="utf-8")
        hook.chmod(0o755)


def install(repo: Path, root_spine: str | None = None, mirrors: bool = False) -> int:
    agents = repo / AGENTS_NAME
    old = BLOCK_RE.search(agents.read_text(encoding="utf-8")) if agents.is_file() else None
    root = ROOT_RE.search(old.group(0)) if old else None
    if root_spine is None and not root:
        sys.exit("install: no existing 'Root spine:' line; pass --root-spine")
    block = render(root_spine or root.group(1))
    carried = CUSTOM_RULE_RE.findall(old.group(0)) if old else []
    note = "\n" + CARRIED_HEAD + "\n" + "\n".join("- " + c for c in carried) if carried else ""
    global_install.upsert(agents, block.rstrip("\n") + note + "\n")
    if carried:
        print(f"{AGENTS_NAME}: carried over {len(carried)} repo-specific rule(s) from the old block")
    for name in (*POINTERS, *COPIES):
        path = repo / name
        if not (mirrors or path.exists()):
            continue
        if name.endswith(".mdc") and not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(CURSOR_HEAD + block, encoding="utf-8")
        else:
            global_install.upsert(path, pointer() if name in POINTERS else block)
    install_hook(repo)
    return 0


def uninstall(repo: Path) -> int:
    for name in (AGENTS_NAME, *POINTERS, *COPIES):
        path = repo / name
        global_install.remove(path)
        if name.endswith(".mdc") and path.is_file() and path.read_text(encoding="utf-8") == CURSOR_HEAD.rstrip("\n") + "\n":
            path.unlink()
    hook = hook_path(repo)
    if hook and hook.is_file() and HOOK_MARK in hook.read_text(encoding="utf-8", errors="replace"):
        hook.unlink()
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
    version = block_id()
    begin = BEGIN_RE.search(block)
    block_version = begin.group(1).strip() if begin else ""
    if block_version != version:
        problems.append(f"block id {block_version!r} differs from current {version!r}")
    root = ROOT_RE.search(block)
    expected_full = None
    if not root:
        problems.append("block has no 'Root spine:' line")
    else:
        root_spine = root.group(1)
        if root_spine != NO_SPINE and not (repo / root_spine).exists():
            problems.append(f"root spine path does not exist: {root_spine}")
        expected_full = render(root_spine)
        if block.rstrip("\n") + "\n" != expected_full:
            problems.append("block text differs from the rendered template")
    # Mirror files are optional, but any that carry a block must match.
    for name in (*POINTERS, *COPIES):
        path = repo / name
        found = BLOCK_RE.search(path.read_text(encoding="utf-8")) if path.is_file() else None
        want = pointer() if name in POINTERS else expected_full
        if found and want and found.group(0) + "\n" != want:
            problems.append(f"{name}: block is stale or edited")
    hook = hook_path(repo)
    if hook and not hook.exists():
        print("note: pre-commit trackable gate not installed (run install); not a failure")
    for problem in problems:
        print(problem)
    return 1 if problems else 0


def profile(repo: Path, home: Path, text: str | None) -> int:
    """Print the effective dispatch profile (repo override, local override, synced machine file, unset); exit 3 if unset."""
    machine, local = home / MACHINE_FILE, home / LOCAL_FILE
    if text is not None:  # an explicit local choice; the SessionStart sync never overwrites it
        line = "Dispatch profile: " + " ".join(text.split())
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_text(line + "\n", encoding="utf-8")
        print(f"{line} (wrote ~/{LOCAL_FILE})")
        return 0
    agents = repo / AGENTS_NAME
    files = [agents]
    root = ROOT_RE.search(agents.read_text(encoding="utf-8")) if agents.is_file() else None
    if root and root.group(1) != NO_SPINE:
        files.insert(0, repo / root.group(1))
    sources = [(f, f"repo {f.relative_to(repo) if f.is_relative_to(repo) else f}") for f in files]
    sources += [(local, f"local ~/{LOCAL_FILE}"), (machine, f"machine ~/{MACHINE_FILE}")]
    for path, label in sources:
        match = PROFILE_RE.search(path.read_text(encoding="utf-8")) if path.is_file() else None
        if match and (path in (machine, local) or match.group(1).lower() != "default"):
            print(f"Dispatch profile: {match.group(1)} (source: {label})")
            return 0
    print("unset")
    return 3


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="agents_block.py", description="Install or verify the EpicSpine always-on block."
    )
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("install", "check", "uninstall"):
        cmd = sub.add_parser(name, help=f"{name} the repo files (AGENTS.md + existing harness mirrors)")
        cmd.add_argument("--repo", type=Path, default=Path("."))
        if name == "install":
            cmd.add_argument("--root-spine", help="default: the one in the existing block")
            cmd.add_argument("--mirrors", action="store_true", help="also create missing harness mirrors")
    for name in ("install-global", "check-global", "uninstall-global"):
        cmd = sub.add_parser(name, help=f"{name.split('-')[0]} the machine-wide block and hooks")
        cmd.add_argument("--home", type=Path, help="override the home directory (tests)")
        cmd.add_argument("--claude-dir", "--config-dir", dest="claude_dir", action="append", default=[], help="Claude config dir; repeatable")
        cmd.add_argument("--no-hooks", action="store_true", help="skip session-start hooks")
        cmd.add_argument("--only", action="append", default=[], metavar="HARNESS", help="only this harness (claude-code, codex, ...); repeatable (used by the SessionStart self-heal)")
        if name == "install-global":
            cmd.add_argument("--profile", metavar="TEXT", help="also write the machine dispatch profile (as `profile --set`)")
        cmd.add_argument("--artifact-host", metavar="VALUE", help="override only (auto-detected otherwise): set env EPICSPINE_ARTIFACT_HOST (local, tailscale or a hostname) in each Claude settings.json ('' removes)")
    cmd = sub.add_parser("profile", help="print the effective dispatch profile; exit 3 if unset")
    cmd.add_argument("--repo", type=Path, default=Path("."))
    cmd.add_argument("--home", type=Path, help="override the home directory (tests)")
    cmd.add_argument("--set", metavar="TEXT", help="write the machine profile file")
    sub.add_parser("print-global", help="print the global block")
    sub.add_parser("print-hook", help="print the SessionStart hook JSON (used by hooks)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "install":
        return install(args.repo, args.root_spine, args.mirrors)
    if args.command == "check":
        return check(args.repo)
    if args.command == "uninstall":
        return uninstall(args.repo)
    if args.command == "profile":
        return profile(args.repo, args.home or Path.home(), args.set)
    if args.command == "print-global":
        print(global_install.render_global(), end="")
        return 0
    if args.command == "print-hook":
        print(global_install.hook_payload(os.environ))
        return 0
    home = args.home or Path.home()
    env = dict(os.environ) if args.home is None else {}
    action = args.command.split("-")[0]
    code = global_install.run(action, home, env, args.claude_dir, not args.no_hooks, args.artifact_host, tuple(args.only))
    if action == "install":
        if args.profile is not None:
            profile(Path("."), home, args.profile)
        import session_sync
        if session_sync.sync_profile(home):
            print(f"machine dispatch profile installed from the skill (~/{MACHINE_FILE})")
        if global_install.profile_missing(home):
            print(f"machine dispatch profile missing (~/{MACHINE_FILE}): set it with `agents_block.py profile --set TEXT` "
                  "or `install-global --profile TEXT`; until then workers may inherit the manager's model")
    return code


if __name__ == "__main__":
    sys.exit(main())
