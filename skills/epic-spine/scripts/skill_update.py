#!/usr/bin/env python3
"""Check and upgrade an installed EpicSpine skill copy.

Stdlib only, Python 3.10+. The installed skill directory is derived from this
script's own location (the directory above ``scripts/``); a ``<skill-dir>.SOURCE``
pin file sits next to it. ``status`` is cheap and never modifies the tree;
``upgrade`` shallow-clones, verifies the clone against its ``MANIFEST.sha256``,
and swaps atomically while keeping exactly one ``.bak`` generation.

The default source is the canonical repository only. Nothing from the
downloaded tree is executed: only files are read and the manifest is verified.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_SOURCE = "https://github.com/AlfaBlok/epicspine-skill.git"
DEFAULT_REF = "main"
DEFAULT_WINDOW_DAYS = 7
SKILL_REL = "skill/epic-spine"
SYNC_HINT = (
    "Vendored and symlinked copies follow SYNC.md: re-sync them, do not upgrade in place."
)
HEX_RE = re.compile(r"^[0-9a-f]{64}$")


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #


def utc_today() -> str:
    return dt.datetime.now(dt.timezone.utc).date().isoformat()


def short(sha: str | None) -> str:
    return sha[:7] if sha else "?"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def generate_manifest(repo_root: Path | str, rel_skill: str = SKILL_REL) -> str:
    """Byte-identical re-implementation of tools/epicspine-manifest.sh output."""
    repo_root = Path(repo_root)
    skill_root = repo_root / rel_skill
    entries: list[tuple[str, str]] = []
    for dirpath, _dirnames, filenames in os.walk(skill_root, followlinks=False):
        for name in filenames:
            full = Path(dirpath) / name
            if full.is_symlink() or not full.is_file():
                continue
            rel = full.relative_to(repo_root).as_posix()
            entries.append((rel, sha256_file(full)))
    entries.sort(key=lambda item: item[0])
    return "".join(f"{digest}  {rel}\n" for rel, digest in entries)


def skill_dir_from_here() -> Path:
    return Path(__file__).absolute().parent.parent


def pin_path(skill_dir: Path) -> Path:
    return Path(str(skill_dir) + ".SOURCE")


def read_pin(path: Path) -> dict[str, str] | None:
    if not path.is_file():
        return None
    fields: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line or line[0].isspace() or line.startswith("#"):
            continue
        if ":" in line:
            key, value = line.split(":", 1)
            fields[key.strip()] = value.strip()
    return fields


def is_our_pin(fields: dict[str, str]) -> bool:
    return bool(HEX_RE.match(fields.get("manifest", "")))


def read_version(skill_dir: Path) -> str | None:
    version_file = skill_dir / "VERSION"
    if not version_file.is_file():
        return None
    text = version_file.read_text(encoding="utf-8").strip()
    return text or None


def set_pin_key(path: Path, key: str, value: str) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    prefix = key + ":"
    for index, line in enumerate(lines):
        if line.startswith(prefix):
            lines[index] = f"{key}: {value}"
            break
    else:
        insert_at = len(lines)
        for index, line in enumerate(lines):
            if not line.strip():
                insert_at = index
                break
        lines.insert(insert_at, f"{key}: {value}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_pin_atomic(path: Path, fields: dict[str, str]) -> None:
    lines = [
        f"source: {fields['source']}",
        f"path: {fields['path']}",
        f"commit: {fields['commit']}",
        f"manifest: {fields['manifest']}",
        f"version: {fields['version']}",
        f"installed: {fields['installed']}",
        f"checked: {fields['checked']}",
        "",
        "Managed by skill_update.py. Do not edit the installed copy by hand.",
    ]
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def within_window(checked: str, window_days: int) -> bool:
    try:
        checked_date = dt.date.fromisoformat(checked)
    except ValueError:
        return False
    age = (dt.date.fromisoformat(utc_today()) - checked_date).days
    return 0 <= age < window_days


# --------------------------------------------------------------------------- #
# Git
# --------------------------------------------------------------------------- #


def git(args: list[str], *, cwd: Path | None = None, timeout: int = 60) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env.pop("GIT_ASKPASS", None)
    return subprocess.run(
        ["git", "-c", "http.followRedirects=false", *args],
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        env=env,
        timeout=timeout,
    )


def remote_head(source: str, ref: str, timeout: int = 30) -> tuple[str | None, str | None]:
    proc = git(["ls-remote", source, f"refs/heads/{ref}"], timeout=timeout)
    if proc.returncode != 0:
        return None, proc.stderr.strip() or "git ls-remote failed"
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    if not lines:
        return None, f"ref refs/heads/{ref} not found on {source}"
    sha = lines[0].split()[0].strip()
    return (sha or None), None


# --------------------------------------------------------------------------- #
# Shared detection
# --------------------------------------------------------------------------- #


def detect_linked(skill_dir: Path) -> str | None:
    if skill_dir.is_symlink():
        return f"skill dir is a symlink: {skill_dir}"
    if skill_dir.parent.is_symlink():
        return f"skill parent is a symlink: {skill_dir.parent}"
    pin = read_pin(pin_path(skill_dir))
    if pin is not None and not is_our_pin(pin):
        return "SOURCE pin marks a vendored copy"
    return None


# --------------------------------------------------------------------------- #
# status
# --------------------------------------------------------------------------- #


def emit(result: dict, as_json: bool) -> None:
    if as_json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(result["detail"])


def cmd_status(args) -> int:
    skill_dir = skill_dir_from_here()
    result: dict = {
        "status": "unknown",
        "detail": "",
        "skill_dir": str(skill_dir),
        "source": args.source,
        "ref": args.ref,
        "installed_commit": None,
        "latest_commit": None,
        "installed_version": None,
        "checked": None,
        "cached": False,
        "upgradeable": False,
    }

    linked = detect_linked(skill_dir)
    if linked:
        result.update(status="linked", detail=f"linked ({linked})")
        emit(result, args.json)
        return 0

    pin = read_pin(pin_path(skill_dir))
    result["installed_version"] = read_version(skill_dir)
    if pin is not None:
        result["installed_commit"] = pin.get("commit") or None
        result["checked"] = pin.get("checked") or None

    if pin is not None and not args.force and pin.get("checked") and within_window(pin["checked"], args.window_days):
        result.update(
            status="fresh",
            cached=True,
            detail=f"fresh (cached, checked {pin['checked']})",
        )
        emit(result, args.json)
        return 0

    latest, error = remote_head(args.source, args.ref)
    if error or not latest:
        result.update(status="unknown", detail=f"unknown ({error})")
        emit(result, args.json)
        return 0

    result["latest_commit"] = latest
    result["checked"] = utc_today()

    if pin is None:
        result.update(
            status="unpinned",
            upgradeable=True,
            detail=f"unpinned (no {pin_path(skill_dir).name}; run upgrade to adopt)",
        )
        emit(result, args.json)
        return 0

    try:
        set_pin_key(pin_path(skill_dir), "checked", utc_today())
    except OSError:
        pass

    installed = pin.get("commit") or ""
    if installed == latest:
        result.update(status="fresh", detail=f"fresh ({short(latest)})")
    else:
        result.update(
            status="stale",
            upgradeable=True,
            detail=f"stale (installed {short(installed)} vs latest {short(latest)})",
        )
    emit(result, args.json)
    return 0


# --------------------------------------------------------------------------- #
# upgrade
# --------------------------------------------------------------------------- #


def changelog_headline(clone: Path) -> str | None:
    changelog = clone / "CHANGELOG.md"
    if not changelog.is_file():
        return None
    try:
        for line in changelog.read_text(encoding="utf-8", errors="replace").splitlines():
            stripped = line.strip()
            if stripped.startswith("## "):
                return stripped[3:].strip()
    except OSError:
        return None
    return None


def cmd_upgrade(args) -> int:
    skill_dir = skill_dir_from_here()
    linked = detect_linked(skill_dir)
    if linked:
        sys.stderr.write(f"refusing to upgrade: {linked}\n{SYNC_HINT}\n")
        return 1

    if not args.yes:
        if not sys.stdin.isatty():
            sys.stderr.write("refusing to upgrade non-interactively; pass --yes\n")
            return 1
        print(f"Upgrade EpicSpine at {skill_dir} from {args.source} ({args.ref})?")
        try:
            answer = input("Proceed? [y/N] ")
        except EOFError:
            answer = ""
        if answer.strip().lower() not in ("y", "yes"):
            print("aborted")
            return 1

    old_version = read_version(skill_dir)
    backup = Path(str(skill_dir) + ".bak")
    tmp_dir = Path(tempfile.mkdtemp(prefix="epicspine-upgrade-"))
    clone = tmp_dir / "repo"

    try:
        proc = git(
            ["clone", "--depth", "1", "--branch", args.ref, "--single-branch", args.source, str(clone)],
            timeout=180,
        )
        if proc.returncode != 0:
            sys.stderr.write(f"upgrade failed: clone error: {proc.stderr.strip()}\n")
            return 1

        new_skill = clone / SKILL_REL
        if not new_skill.is_dir():
            sys.stderr.write(f"upgrade failed: {SKILL_REL} missing in clone\n")
            return 1

        manifest_file = clone / "MANIFEST.sha256"
        if not manifest_file.is_file():
            sys.stderr.write("upgrade failed: MANIFEST.sha256 missing in clone\n")
            return 1

        expected = generate_manifest(clone, SKILL_REL)
        actual = manifest_file.read_text(encoding="utf-8").replace("\r\n", "\n")
        if actual != expected:
            sys.stderr.write("upgrade failed: clone tree does not match MANIFEST.sha256\n")
            return 1

        digest = hashlib.sha256(expected.encode("utf-8")).hexdigest()
        new_version = read_version(new_skill) or "unknown"

        head_proc = git(["rev-parse", "HEAD"], cwd=clone)
        if head_proc.returncode != 0:
            sys.stderr.write(f"upgrade failed: cannot resolve clone commit: {head_proc.stderr.strip()}\n")
            return 1
        head = head_proc.stdout.strip()

        if backup.is_dir() and not backup.is_symlink():
            shutil.rmtree(backup)
        elif backup.exists() or backup.is_symlink():
            backup.unlink()

        moved = False
        try:
            os.rename(skill_dir, backup)
            moved = True
            shutil.move(str(new_skill), str(skill_dir))
            write_pin_atomic(
                pin_path(skill_dir),
                {
                    "source": args.source,
                    "path": SKILL_REL,
                    "commit": head,
                    "manifest": digest,
                    "version": new_version,
                    "installed": utc_today(),
                    "checked": utc_today(),
                },
            )
        except Exception as exc:  # noqa: BLE001 - restore on any failure
            if skill_dir.exists():
                shutil.rmtree(skill_dir, ignore_errors=True)
            if moved and backup.exists():
                os.rename(backup, skill_dir)
            sys.stderr.write(f"upgrade failed during swap: {exc}; restored previous copy\n")
            return 1

        print(f"Upgraded EpicSpine: {old_version or 'unknown'} -> {new_version} ({short(head)})")
        headline = changelog_headline(clone)
        if headline:
            print(f"Latest changes: {headline}")
        print(f"Backup: {backup}")
        return 0
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="skill_update.py",
        description="Check and upgrade an installed EpicSpine skill copy.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--source", default=DEFAULT_SOURCE)
        sp.add_argument("--ref", default=DEFAULT_REF)
        sp.add_argument("--window-days", type=int, default=DEFAULT_WINDOW_DAYS)

    status = sub.add_parser("status", help="report freshness (cheap, read-mostly)")
    common(status)
    status.add_argument("--force", action="store_true", help="ignore the check window")
    status.add_argument("--json", action="store_true", help="emit machine-readable output")

    upgrade = sub.add_parser("upgrade", help="install the latest source copy")
    common(upgrade)
    upgrade.add_argument("--yes", action="store_true", help="do not prompt")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "status":
        return cmd_status(args)
    if args.command == "upgrade":
        return cmd_upgrade(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
