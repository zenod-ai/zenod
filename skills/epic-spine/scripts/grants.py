"""Standing approvals (docs/doctrine/standing-approvals.md): `## Standing approvals` grant lines (`grants`), inherited down the
`Parent spine:` chain (`chain`), uses counted from Decisions rows citing `under <code>` (`uses`), and advisory checks (`grant_issues`)."""
from __future__ import annotations

import datetime
import re
from pathlib import Path

import validate_spine as v
from ask_refs import TAG, ask_context

GRANT_ID = r"[A-Za-z0-9][A-Za-z0-9-]*-G\d+"
DATE = r"\d{4}-\d\d-\d\d"
GRANT_TAG = re.compile(r"grant\s+(" + GRANT_ID + r")\s+@(\S+)\s+since\s+(" + DATE + ")")
REVOKED_TAG = re.compile(r"revoked\s+(" + GRANT_ID + r")\s+(" + DATE + r")\s+@(\S+)")
FIELD = re.compile(r"(limits|expires|context|why):\s*(.*)", re.S)
UNDER = re.compile(r"\bunder\s+(" + GRANT_ID + r"(?:(?:\s*[,+&]\s*|\s+and\s+)" + GRANT_ID + r")*)")
CANONICAL = "`[grant <epic code>-G<n> @<who> since <date>] <scope> — limits: … — expires: <date|never> — context: <link>` or `[revoked <code> <date> @<who>] … — why: …`"


def grants(text: str, path: Path, repo: Path, problems: list[str] | None = None, today: datetime.date | None = None) -> list[dict]:
    """This spine's own grant lines; ``problems`` collects bullets the tools cannot read, naming the canonical form."""
    today, out = today or datetime.date.today(), []
    for raw in v.parse_sections(text).get("Standing approvals", "").splitlines():
        line = raw.strip()
        if raw[:1] not in "-*" or not line[1:].strip():
            continue
        tag, rest = m.groups() if (m := TAG.fullmatch(line)) else ("", "")
        given, revoked = GRANT_TAG.fullmatch(tag.strip()), REVOKED_TAG.fullmatch(tag.strip())
        if not (given or revoked):
            if problems is not None:
                problems.append(f"## Standing approvals line '{line[:50]}' is not a form the tools read: write {CANONICAL}")
            continue
        code, who, since = given.groups() if given else (revoked.group(1), revoked.group(3), None)
        scope, *parts = re.split(r"\s+[—–]\s+", rest.strip())
        fields: dict[str, str] = {}
        for part in parts:
            if f := FIELD.fullmatch(part.strip()):
                fields[last := f.group(1)] = f.group(2).strip()
            elif fields:  # a dash inside the previous field's text
                fields[last] += " — " + part
            else:
                scope += " — " + part
        expires = fields.get("expires") or None
        ended = expires and re.fullmatch(DATE, expires) and datetime.date.fromisoformat(expires) < today
        out.append({"code": code, "who": who, "scope": scope, "limits": fields.get("limits") or None, "expires": expires,
                    "context": ask_context(fields.get("context", ""), path, repo), "since": since,
                    "state": "revoked" if revoked else "expired" if ended else "active",
                    "revoked": revoked.group(2) if revoked else None, "why": fields.get("why") or None})
    return out


def cited(text: str) -> list[tuple[str, set[str]]]:
    """(date, codes) per Decisions row citing `under <code>[, <code>]`; a row counts once per code."""
    out = []
    for line in v.parse_sections(text).get("Decisions", "").splitlines():
        codes = {c for m in UNDER.finditer(line) for c in re.findall(GRANT_ID, m.group(1))}
        if codes:
            out.append(((d.group(0) if (d := re.search(DATE, line)) else ""), codes))
    return out


def uses(texts: list[str]) -> dict[str, int]:
    """Grant code to the number of Decisions rows (over ``texts``, e.g. every spine of the tree) that cite it."""
    out: dict[str, int] = {}
    for _, codes in (row for t in texts for row in cited(t)):
        for c in codes:
            out[c] = out.get(c, 0) + 1
    return out


def chain(path: Path, repo: Path) -> list[Path]:
    """The `Parent spine:` ancestors of ``path``, nearest first (links resolve from the file's folder, else the repo root)."""
    out, cur = [], path.resolve()
    while True:
        value = v.parse_fields(cur.read_text(encoding="utf-8", errors="replace")).get("Parent spine", "")
        target = v.resolve_local_link(cur, value)
        if target and not target.exists():
            target = v.resolve_local_link(repo / "-", value)
        if not target or not target.is_file() or target.resolve() in out or target.resolve() == path.resolve():
            return out
        out.append(cur := target.resolve())


def advisory(text: str, path: Path) -> list[str]:
    """Every advisory issue of a spine: human asks (epic_log.ask_issues) then grants, against the repo holding ``path``."""
    from epic_log import ask_issues, repo_root
    repo = repo_root(path)
    return ask_issues(text, repo=repo) + grant_issues(text, path, repo)


def grant_issues(text: str, path: Path | None = None, repo: Path | None = None, today: datetime.date | None = None) -> list[str]:
    """Advisory (never blocking): unreadable grant lines, a reused code (this spine or an ancestor), a grant cited after it expired or was revoked."""
    today, issues = today or datetime.date.today(), []
    own = grants(text, Path("-"), Path("-"), issues, today)
    inherited = [g for p in (chain(path, repo) if path and repo else []) for g in grants(p.read_text(encoding="utf-8", errors="replace"), p, repo, None, today)]
    seen: set[str] = {g["code"] for g in inherited}
    for g in own:
        if g["code"] in seen:
            issues.append(f"grant code {g['code']} is used twice (here or in a parent spine): codes are never reused, take the highest G + 1")
        seen.add(g["code"])
    ended = {g["code"]: (g["revoked"] or g["expires"], g["state"]) for g in own + inherited if g["state"] != "active"}
    for date, codes in cited(text):
        for c in sorted(codes & ended.keys()):
            end, state = ended[c]
            if not date or date > end:
                issues.append(f"Decisions row {date or '(undated)'} acts under {c}, {state} {end}: ask instead, or record a new grant")
    return issues
