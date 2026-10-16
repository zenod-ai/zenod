#!/usr/bin/env python3
"""Machine-wide EpicSpine install: for every detected harness, write a pointer to
the live ``assets/global-block.md`` into its user-level instruction file AND
register its session-start hook where one exists (Claude Code also gets the
``url_gate.py`` Stop hook; Claude Code and Codex get the ``stop_push.py`` Stop hook; Codex hooks also need
trust, see codex_hooks.py; all default on; ``hooks=False`` is the opt-out).
Stdlib only, Python 3.10+. Harness-neutral: one block, one marker pair, one
adapter table; no harness is privileged.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
GLOBAL_TEMPLATE = SKILL_DIR / "assets" / "global-block.md"
BLOCK_RE = re.compile(r"<!-- epicspine:begin [^>]*-->.*?<!-- epicspine:end -->", re.DOTALL)
HOOK_MARK = 'agents_block.py" print-hook'
GATE_MARK = 'url_gate.py"'
PUSH_MARK = 'stop_push.py"'
HOOK_EVENTS = (("SessionStart", HOOK_MARK), ("Stop", GATE_MARK), ("Stop", PUSH_MARK))
STOPS = {"claude-code": ("url_gate.py", "stop_push.py"), "codex": ("stop_push.py",)}  # harness -> managed Stop hook scripts
ENV_KEY = "EPICSPINE_ARTIFACT_HOST"
MACHINE_FILE = ".agents/epicspine-profile.md"
LOCAL_FILE = ".agents/epicspine-profile.local.md"  # machine override; the hook never overwrites ~/.agents/epicspine-profile.md while it exists
PROFILE_WARNING = (f"Machine dispatch profile missing (~/{MACHINE_FILE}): before the first dispatch, ask the user once "
                   "which worker model to use and save it with `agents_block.py profile --set`; until then do not "
                   "let workers silently inherit the manager's model.")
UNSUPPORTED = {
    "cursor (user level)": "user rules live in the app settings UI, not a file; repo install writes .cursor/rules",
    "aider": "no user-level instruction file; needs a read: entry in .aider.conf.yml",
    "opencode hook": "hooks need a JS plugin; instruction file only",
}


def read_version() -> str:
    return (SKILL_DIR / "VERSION").read_text(encoding="utf-8").strip()


def render_global() -> str:
    return GLOBAL_TEMPLATE.read_text(encoding="utf-8").replace("{version}", read_version())


def render_pointer(hookless: bool = False) -> str:
    """Pasted into instruction files: a pointer to the live block, never a copy. ``hookless``: the harness hook
    may be unregistered or untrusted, so the first command runs the hook by hand (sync included)."""
    tail = (f"If the block was not injected at session start, run `python3 {SKILL_DIR / 'scripts' / 'agents_block.py'} "
            "print-hook` first and follow its output (it also syncs the skill and this repo).\n") if hookless else ""
    return ("<!-- epicspine:begin pointer -->\nEpicSpine is installed. Before your first reply, follow "
            f"`{GLOBAL_TEMPLATE}` (read it unless already injected at session start).\n{tail}<!-- epicspine:end -->\n")


def profile_missing(home: Path | None = None) -> bool:
    home = home or Path.home()
    return not ((home / MACHINE_FILE).is_file() or (home / LOCAL_FILE).is_file())


def hook_payload(env: dict | None = None) -> str:
    """SessionStart JSON; given ``env`` (the hook), also heal the user-level pasted copy."""
    notes: list[str] = []
    if env is not None:
        heal(env)
        notes = sync(env)
        heal_repo()
    ctx = render_global()
    if profile_missing():
        ctx = ctx.rstrip("\n") + "\n" + PROFILE_WARNING + "\n"
    if notes:
        ctx = ctx.rstrip("\n") + "\n" + "\n".join(notes) + "\n"
    return json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": ctx}})


def sync(env: dict) -> list[str]:
    """SessionStart self-sync (skill, dispatch profile, current repo; see session_sync.py): context lines, never raises."""
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import session_sync
        return session_sync.run(env)
    except Exception:
        return []


def heal_repo() -> None:
    """Best-effort, silent: in the current git repo, see ``ensure_gate``; never raises."""
    try:
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=5).stdout.strip()
        if top:
            ensure_gate(Path(top))
    except Exception:
        pass


def ensure_gate(top: Path) -> None:
    """In a repo that uses EpicSpine (AGENTS.md block, or a ``Root spine:`` line naming a file) install the
    pre-commit trackable gate; idempotent, never replaces a foreign hook, skips opted-out repos. May raise."""
    agents = top / "AGENTS.md"
    text = agents.read_text(encoding="utf-8") if agents.is_file() else ""
    root = re.search(r"Root spine: \[?`?([^`\]\s)]+)", text)
    import repo_sync
    if repo_sync.opted_out(top):
        return
    if BLOCK_RE.search(text) or root and (top / root.group(1).rstrip(".")).is_file():
        import agents_block
        with contextlib.redirect_stdout(io.StringIO()):
            agents_block.install_hook(top)


def upsert(path: Path, block: str) -> str:
    """Write ``block`` into ``path``; returns created|updated|appended|current."""
    old = path.read_text(encoding="utf-8") if path.is_file() else None
    if old is None:
        new, how = block, "created"
    elif BLOCK_RE.search(old):
        new, how = BLOCK_RE.sub(lambda _: block.rstrip("\n"), old), "updated"
    else:
        new, how = old.rstrip("\n") + "\n\n" + block, "appended"
    if new == old:
        return "current"
    path.parent.mkdir(parents=True, exist_ok=True)
    target = os.path.realpath(path)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(target), prefix=".epicspine-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(new)
        if os.path.exists(target):
            os.chmod(tmp, os.stat(target).st_mode & 0o7777)
        os.replace(tmp, target)
    except BaseException:
        os.unlink(tmp)
        raise
    return how


def heal(env: dict) -> None:
    """Best-effort, silent: rewrite a stale EpicSpine block in the Claude config dir's CLAUDE.md
    (``CLAUDE_CONFIG_DIR``, else ``~/.claude``) with the current pointer. No block, or current: untouched."""
    try:
        path = Path(env.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude").expanduser() / "CLAUDE.md"
        match = BLOCK_RE.search(path.read_text(encoding="utf-8"))
        if match and match.group(0) + "\n" != render_pointer() and os.access(path, os.W_OK):
            upsert(path, render_pointer())
    except Exception:
        pass


def remove(path: Path) -> bool:
    """Strip the EpicSpine block; delete the file if nothing else remains."""
    if not path.is_file():
        return False
    text = path.read_text(encoding="utf-8")
    match = BLOCK_RE.search(text)
    if not match:
        return False
    before, after = text[: match.start()].rstrip("\n"), text[match.end() :].strip("\n")
    rest = before + ("\n\n" if before and after else "") + after
    if rest:
        path.write_text(rest + "\n", encoding="utf-8")
    else:
        path.unlink()
    return True


def harnesses(home: Path, env: dict, claude_dirs: list[str]):
    """Yield (label, detect_path, instruction_file, explicit, hook_settings|None)."""
    found: list[Path] = [Path(d).expanduser() for d in claude_dirs]
    explicit = bool(found)
    if not explicit:
        if env.get("CLAUDE_CONFIG_DIR"):
            found.append(Path(env["CLAUDE_CONFIG_DIR"]).expanduser())
        for p in sorted(home.glob(".claude*")):
            if p.is_dir() and (p.name == ".claude" or (p / "settings.json").exists()
                               or (p / "projects").is_dir()):
                found.append(p)
    seen: set[Path] = set()
    for d in found:
        if d not in seen:
            seen.add(d)
            yield f"claude-code[{d}]", d, d / "CLAUDE.md", explicit, d / "settings.json"
    xdg = Path(env.get("XDG_CONFIG_HOME") or home / ".config")
    codex = Path(env.get("CODEX_HOME") or home / ".codex")
    gem, ws = home / ".gemini", home / ".codeium" / "windsurf"
    yield "codex", codex, codex / "AGENTS.md", False, codex / "hooks.json"
    yield "opencode", xdg / "opencode", xdg / "opencode" / "AGENTS.md", False, None
    yield "gemini-cli", gem, gem / "GEMINI.md", False, gem / "settings.json"
    yield "windsurf", ws, ws / "memories" / "global_rules.md", False, None
    yield "copilot-cli", home / ".copilot", home / ".copilot" / "copilot-instructions.md", False, None


def _load(settings: Path) -> dict:
    if not settings.is_file():
        return {}
    data = json.loads(settings.read_text(encoding="utf-8") or "{}")
    if not isinstance(data, dict):
        raise ValueError("settings.json is not a JSON object")
    return data


def _strip_hook(data: dict) -> bool:
    """Remove EpicSpine-managed hooks (SessionStart, Stop); foreign hooks stay."""
    changed = False
    for event, mark in HOOK_EVENTS:
        groups = data.get("hooks", {}).get(event)
        if not isinstance(groups, list):
            continue
        hit = False
        for group in list(groups):
            hooks = group.get("hooks") if isinstance(group, dict) else None
            keep = [h for h in hooks if mark not in str(h.get("command", ""))] if isinstance(hooks, list) else None
            if keep is not None and len(keep) != len(hooks):
                hit = changed = True
                group["hooks"] = keep
                if not keep:
                    groups.remove(group)
        if hit and not groups:
            del data["hooks"][event]
    if changed and not data["hooks"]:
        del data["hooks"]
    return changed


def _save(settings: Path, data: dict) -> None:
    if data:
        settings.parent.mkdir(parents=True, exist_ok=True)
        settings.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    elif settings.exists():
        settings.unlink()


def set_hook(settings: Path, on: bool, stop: tuple[str, ...] = ()) -> str:
    """Add/remove managed hooks (SessionStart; plus the Stop scripts named in ``stop``), merging."""
    try:
        data = _load(settings)
    except (ValueError, OSError) as exc:
        return f"error: cannot merge {settings}: {exc}"
    had = _strip_hook(data)
    if on:
        cmds = [("SessionStart", f'python3 "{Path(__file__).with_name("agents_block.py")}" print-hook')]
        cmds += [("Stop", f'python3 "{Path(__file__).with_name(name)}"') for name in stop]
        for event, command in cmds:
            data.setdefault("hooks", {}).setdefault(event, []).append(
                {"hooks": [{"type": "command", "command": command}]})
    elif not had:
        return "absent"
    _save(settings, data)
    return "set" if on else "removed"


def set_env(settings: Path, value: str) -> str:
    """Persist (empty ``value`` removes) ``env.EPICSPINE_ARTIFACT_HOST`` in settings.json."""
    try:
        data = _load(settings)
    except (ValueError, OSError) as exc:
        return f"error: cannot merge {settings}: {exc}"
    env = data.get("env", {})
    if not isinstance(env, dict):
        return f"error: {settings} env is not an object"
    if env.get(ENV_KEY) == (value or None):
        return "current" if value else "absent"
    if value:
        data["env"] = {**env, ENV_KEY: value}
    else:
        del env[ENV_KEY]
        if not env:
            del data["env"]
    _save(settings, data)
    return f"set {value}" if value else "removed"


def has_hook(settings: Path, stop: tuple[str, ...] = ()) -> bool:
    """SessionStart hook present, and each Stop script named in ``stop``."""
    try:
        hooks = str(_load(settings).get("hooks", {}))
    except (ValueError, OSError):
        return False
    return HOOK_MARK in hooks and all(f'{name}"' in hooks for name in stop)


def skill_link(action: str, cdir: Path) -> tuple[str, int]:
    """Make the skill discoverable at ``<cdir>/skills/epic-spine`` (symlink to SKILL_DIR)."""
    link = cdir / "skills" / "epic-spine"
    ours = link.is_symlink() and link.resolve() == SKILL_DIR
    if action == "install":
        if ours:
            return "current", 0
        if link.is_symlink() or link.exists():
            return "foreign, left alone", 0
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(SKILL_DIR, target_is_directory=True)
        return "linked", 0
    if action == "uninstall":
        if ours:
            link.unlink()
        return ("removed" if ours else "absent or foreign"), 0
    present = link.is_symlink() or link.exists()
    return ("current" if ours else "present (foreign)" if present else "missing"), int(not present)


def run(action: str, home: Path, env: dict, claude_dirs: list[str], hooks: bool = True,
        artifact_host: str | None = None, only: tuple[str, ...] = ()) -> int:
    """action: install | check | uninstall. Prints one line per harness (``only``: just these, e.g. ``codex``).
    ``artifact_host`` (install, Claude only): None leaves settings env alone, "" removes it."""
    code, present = 0, 0
    for label, detect, target, explicit, settings in harnesses(home, env, claude_dirs):
        if only and label.split("[")[0] not in only:
            continue
        if not (detect.exists() or (explicit and action == "install")):
            print(f"{label}: not detected ({detect} absent)")
            continue
        present += 1
        block = render_pointer(hookless=label == "codex")
        if action == "install":
            line = f"{label}: {upsert(target, block)} {target}"
        elif action == "uninstall":
            line = f"{label}: {'removed' if remove(target) else 'absent'} {target}"
        else:
            text = target.read_text(encoding="utf-8") if target.is_file() else ""
            match = BLOCK_RE.search(text)
            state = "missing" if not match else ("current" if match.group(0) + "\n" == block else "stale")
            code |= state != "current"
            line = f"{label}: {state} {target}"
        if settings is not None:
            stop = STOPS.get(label.split("[")[0], ())
            if action == "check" and hooks:
                ok = has_hook(settings, stop)
                code |= not ok
                line += f"; hook {'present' if ok else 'missing'}"
                if label == "codex":  # advisory: without trust Codex lists the hooks as "needs review"
                    import codex_hooks
                    line += f"; trust {'present' if codex_hooks.trust_present(detect) else 'not set (re-run install-global, or approve in Codex /hooks)'}"
            elif action == "uninstall" or (action == "install" and hooks):
                result = set_hook(settings, action == "install", stop)
                if label == "codex" and not result.startswith("error"):
                    import codex_hooks
                    result += "; " + codex_hooks.sync_trust(detect, settings, (HOOK_MARK, *(f'{n}"' for n in stop)), action == "install")
                code |= result.startswith("error") or "error:" in result
                line += f"; hook {result}"
        if label.startswith("claude-code"):
            if action == "uninstall" or (action == "install" and artifact_host is not None):
                result = set_env(settings, artifact_host or "")
                code |= result.startswith("error")
                line += f"; artifact host {result}"
            state, bad = skill_link(action, detect)
            code |= bad
            line += f"; skill link {state}"
        print(line)
    if not only and (action == "uninstall" or (present and hooks)):  # machine-wide, not per harness
        import sync_schedule
        line, bad = sync_schedule.apply(action, home)
        code |= bad
        print(f"background sync: {line}")
    for name, reason in UNSUPPORTED.items():
        print(f"{name}: unsupported: {reason}")
    if not present:
        print("no supported harness detected; nothing done")
        return 1 if action != "uninstall" else 0
    return int(code)
