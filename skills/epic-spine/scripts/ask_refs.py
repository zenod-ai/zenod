"""Human asks (docs/doctrine/human-asks.md, D19): ``## Waiting on`` ask lines (`asks`), and references: `- [waits on [<repo>/]<code>
row <id>]` lines plus ask codes named in Current State's `Waiting on:` (`waits`), resolved against this repo's asks, else the
sibling checkout `../<repo>`; `unknown` lists same-repo codes no ask has."""
from __future__ import annotations

import os
import re
from pathlib import Path

import validate_spine as v

ASK_ID = r"[A-Za-z0-9][A-Za-z0-9-]*-A\d+"
ASK_CODE = f"({ASK_ID})"
REPO = r"([A-Za-z0-9][\w.-]*)"
WAIT = re.compile(r"-\s+\[waits on\s+(?:" + REPO + "/)?" + ASK_CODE + r"(?:\s+row\s+(\S+))?\]\s*(.*)")
MENTION = re.compile(r"(?<![\w./-])(?:" + REPO + "/)?" + ASK_CODE + r"(?![\w-])")
NO_HUMAN = re.compile(r"(?i)(?:none|nobody|nothing|n/a|-)(?![\w-])")
DATE = r"\d{4}-\d\d-\d\d"
KINDS = ("decide", "approve", "provide", "do")
TAG = re.compile(r"[-*]\s+\[([^\]]*)\]\s*(.*)")
OPEN_TAG = re.compile(r"ask(?:\s+" + ASK_CODE + r")?:\s*(\w+)\s+@(\S+)\s+since\s+(" + DATE + r")(?:\s+row\s+(\S+))?")
ANSWERED_TAG = re.compile(r"answered(?:\s+" + ASK_CODE + r")?\s+" + DATE + r"\s+@([^\s:,;·]+)[:,;]?(.*)")
SUPERSEDED_TAG = re.compile(r"superseded\s+" + ASK_CODE + r"\s+" + DATE + r"\s+by\s+((?:[\w.-]+/)?" + ASK_ID + ")")
SUPERSEDED_BY = re.compile(r"\s*superseded by\s+((?:[\w.-]+/)?" + ASK_ID + ")")
DONE = re.compile(r"\s*·\s*done\s+" + DATE + r"\b.*$")  # consumed answer, with an optional sha and note
CANONICAL = ("`[ask <code>: <type> @<who> since <date> row <id>]`, `[answered <code> <date> @<who>]` (then ` · done <date> <sha>`), "
             "`[superseded <code> <date> by <code>]` or `[waits on [<repo>/]<code> row <id>]`")
ASK_FIELD = re.compile(r"(steps|options|recommend|unblocks|effort|context|impact|risk|why(?:\s+@?[\w.-]+)?|answer):\s*(.*)", re.S)  # `why <who>:` is `why`


def ref(r: str | None, c: str, row: str | None, via: str) -> dict:
    return {"ref": f"{r}/{c}" if r else c, "repo": r, "code": c, "row": row, "state": "unresolved", "via": via}


def waits(text: str) -> list[dict]:
    """`[waits on]` lines (`via: "waits_on"`), then codes Current State's `Waiting on:` names (`via: "waiting_on"`; none/nobody: no wait)."""
    sections = v.parse_sections(text)
    lines = (line.strip() for line in sections.get("Waiting on", "").splitlines())
    out = [ref(r, c, row, "waits_on") for m in map(WAIT.fullmatch, lines) if m for r, c, row, _ in [m.groups()]]
    said = v.parse_key_values(sections.get("Current State", "")).get("Waiting on", "")
    for r, c in [] if NO_HUMAN.match(said) else MENTION.findall(said):
        if (f"{r}/{c}" if r else c) not in {x["ref"] for x in out}:
            out.append(ref(r or None, c, None, "waiting_on"))
    return out


def states(repo: Path, nodes: list[dict]) -> dict[str, str]:
    """Ask code to state: its line, else `done` when only a Decisions row cites it (the line was cleaned up)."""
    out = {a["code"]: a["state"] for n in nodes for a in n["waiting_on"] if a["code"]}
    for n in nodes:
        for code in re.findall(ASK_CODE, v.parse_sections((repo / n["path"]).read_text(encoding="utf-8", errors="replace")).get("Decisions", "")):
            out.setdefault(code, "done")
    return out


def tree_states(repo: Path) -> dict[str, str] | None:  # None: not a checkout or no root spine
    try:
        import spines
        log = spines.scan(repo, refs=False) if repo.is_dir() else {"root": None}
        return states(repo, log["nodes"]) if log["root"] else None
    except Exception:
        return None


def names(repo: Path, text: str) -> set[str]:  # what a qualified code may call this repo
    return {repo.name, *re.findall(r"(?m)^Repository:\s*(?:\S*/)?([\w.-]+)", text)}


def resolve(repo: Path, nodes: list[dict], root_text: str) -> None:
    """Set each reference's `state` to its target ask's state (open, answered, done), else `unresolved`."""
    own, mine, sibling = states(repo, nodes), names(repo, root_text), {}
    for r in (r for n in nodes for r in n["waits_on"]):
        found = own if r["repo"] in (None, *mine) else sibling.setdefault(r["repo"], tree_states(repo.parent / r["repo"]) or {})
        r["state"] = found.get(r["code"], "unresolved")


def unknown(refs: list[dict], repo: Path | None, text: str) -> list[dict]:
    """Same-repo references whose code is no ask of the tree (cross-repo ones never warn; nothing without a repo and a root spine)."""
    local = [r for r in refs if repo and r["repo"] in (None, *names(repo, text))]
    known = tree_states(repo) if local else None
    return [r for r in local if known is not None and r["code"] not in known]


def repo_root(path: Path) -> Path | None:
    return next((p for p in [path.resolve(), *path.resolve().parents] if (p / ".git").exists()), None)


def asks(text: str, path: Path, repo: Path, problems: list[str] | None = None) -> list[dict]:
    """``## Waiting on`` ask lines in the docs/doctrine/human-asks.md shape; ``context``/``steps`` links are repo-relative when local (else kept as-is).
    ``problems`` collects the lines and tags the tools cannot read, naming the canonical form."""
    out = []
    for raw in v.parse_sections(text).get("Waiting on", "").splitlines():
        line = raw.strip()
        if raw[:1] not in "-*" or not line[1:].strip() or NO_HUMAN.fullmatch(line[1:].strip().rstrip(".")) or WAIT.fullmatch(line):
            continue
        tag, rest = m.groups() if (m := TAG.fullmatch(line)) else ("", "")
        opened, answered, superseded = OPEN_TAG.fullmatch(tag), ANSWERED_TAG.fullmatch(tag), SUPERSEDED_TAG.fullmatch(tag)
        if not (opened or answered or superseded):
            if problems is not None:
                problems.append(f"## Waiting on line '{line[:50]}' is not a form the tools read: write {CANONICAL}")
            continue
        code, kind, who, since, row = opened.groups() if opened else (None,) * 5
        extra, by = "", None
        if answered:
            code, who, extra = answered.groups()
            by = (b := SUPERSEDED_BY.search(extra)) and b.group(1)
            left = DONE.sub("", SUPERSEDED_BY.sub("", extra)).strip()
            if left and problems is not None:
                problems.append(f"ask {code or who}: tag carries '{left[:40]}': write `[answered <code> <date> @<who>]`, the answer after ` — answer:`, then ` · done <date> <sha>`")
        if superseded:
            code, by = superseded.groups()
        if kind and kind not in KINDS and problems is not None:
            problems.append(f"ask {code or who}: type '{kind}' is not one of {' | '.join(KINDS)}")
        done = bool(answered and (DONE.search(extra) or DONE.search(rest)))
        question, *parts = re.split(r"\s+[—–]\s+", DONE.sub("", rest).strip())
        fields: dict[str, str] = {}
        for part in parts:
            f = ASK_FIELD.fullmatch(part.strip())
            if f:
                fields[last := f.group(1).split()[0]] = f.group(2).strip()
            elif fields:  # a dash inside the previous field's text
                fields[last] += " — " + part
            else:
                question += " — " + part
        options = [o.strip() for o in fields.get("options", "").split("|") if o.strip()]
        steps = re.sub(r"\[[^\]]*\]\(([^)]+)\)", lambda k: ask_context(k.group(1), path, repo) or "", fields.get("steps", ""))
        out.append({"code": code, "who": who, "ask": kind, "question": question, "steps": steps or None, "options": options,
                    "recommend": fields.get("recommend") or None, "unblocks": fields.get("unblocks") or None, "effort": fields.get("effort") or None,
                    "context": ask_context(fields.get("context", ""), path, repo), "impact": fields.get("impact") or None,
                    "risk": fields.get("risk") or None, "why": fields.get("why") or None, "since": since, "row": row,
                    "state": "open" if opened else "superseded" if superseded else "done" if done else "answered",
                    "answer": fields.get("answer") or None, "superseded_by": by})
    return out


def ask_context(value: str, path: Path, repo: Path) -> str | None:
    """A markdown link or bare path/URL: external kept as-is, local made repo-relative (the file's folder first, else the repo root).
    Plain words (v6 `context:` in human format) are kept as written."""
    link = re.fullmatch(r"\[[^\]]*\]\(([^)]+)\)", value.strip())
    if not link and re.search(r"\s", value.strip()):
        return value.strip()
    target = (link.group(1) if link else value.strip()).strip("<>")
    if not target or "://" in target or target.startswith("mailto:"):
        return target or None
    name, _, frag = target.partition("#")
    here = (path.parent / name).resolve() if name else path.resolve()
    found = here if here.exists() or not (repo / name).exists() else (repo / name).resolve()
    return (os.path.relpath(found, repo) if found.is_relative_to(repo) else target) + (f"#{frag}" if frag else "")
