#!/usr/bin/env python3
"""E22-S5 (B): fold a week of provisional leaves into their topics, and retire the stray branches.

Jordi, vn_8e8b0693 (23 Nov): his notes should grow the topics he has, not spread into new files.
alpha9's grouping (agent_team E105-S251, http://vps3.taild81fbb.ts.net:9884/) found three stray
level-1 branches catching most of them and a new leaf per sentence beside the right topic.

What it does, on a checkout of the vault (no commit, no push; the caller commits once):
  * every provisional leaf born in the window, and every provisional leaf under a stray branch,
    moves into its topic page as a dated section: the leaf's text byte for byte (its `## Capture`
    headings one level down) with the Log citation it carries. A note's second leaf on the same
    topic joins the section of its first (one section per note and topic, not one per sentence);
  * the leaf file moves to `Archive/Folded 2026-11/<its path>` as a short pointer page
    (`merged-into:`), so `[[Notes/<name>]]` links in the Log still resolve in Obsidian;
  * confirmed pages hung under a stray branch get a real parent;
  * the stray branches stop being branches: the two one-note roots get a parent and leave Tree.md,
    and the "Epic Social" root points at Projects/Epic Social instead of the Hosted Zenod plan;
  * three new topics hold what had no home: Bitwarden and keys, Mini businesses, Nectary.

Nothing is deleted: each leaf's words move; its pointer page keeps its name. Dry run by default.

  fold_leaves.py --vault PATH [--since 2026-11-16] [--until 2026-11-24] [--today 2026-11-24] [--apply] [--json OUT]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

STRAY = {
    "Notes/The user says there is one data environment with two frontends (staging and stable production)",
    "Notes/Boris Cherny - Anthropic Engineers Think in Exponentials",
    "Projects/Zenod/Hosted Zenod (M3) Multi-Tenant Plan",
}
# A real topic that caught unrelated leaves (the niche deal names, places to live): keyword rules first.
SUSPECT = {"Areas/Family Estrangement & Severance 2026-08"}

NEW_TOPICS = {
    "Projects/Bitwarden and keys": ("Bitwarden and keys", "Moving every login and key into Bitwarden: what is stored, what is missing, pasted keys that never arrived.", "Projects/Epic Team"),
    "Projects/Mini businesses": ("Mini businesses", "The niche deal funnels and their names: camper, convertible, 911 and the other small lines.", "Areas/Ventures and work"),
}
# Nectary already has a page (its old name, RepoMiningFunding): it grows that page and becomes a branch.
NECTARY = "Projects/RepoMiningFunding"

# New topics: Bitwarden and the niche names match on the leaf's title only (long bodies mention "key results"
# or a place name in passing); Nectary is a word nobody says in passing, so its whole text counts.
RULES: list[tuple[str, re.Pattern[str], bool]] = [
    ("Projects/Bitwarden and keys", re.compile(r"bitwarden|bitwarder|vaultwarden|password|\bapi keys?\b|pasted .*\bkey\b|\bsecrets?\b|keychain|\bkeys\b.*(?:cach|stor|memory|sync)", re.I), True),
    (NECTARY, re.compile(r"nectary", re.I), False),
    ("Projects/Mini businesses", re.compile(r"\bniche\b|camper|convertible|descapotable|\b911s?\b|cochechollo|mini[- ]?business|deal funnel", re.I), True),
]
STRAY_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("Areas/Housing", re.compile(r"\bhous(?:e|es|ing)\b|\bflats?\b|apartment|frankfurt|z[uü]rich|cerdanya|maresme|mortgage|\brent(?:al)?\b|property|\bplot\b|neighbo|relocat|where to live|\bvillas?\b|skyline plaza|algarve|tenerife|\bferry\b|nomad|\bcity\b|cities|humidity|climate|\bmove to\b|airbnb", re.I)),
    ("Projects/Epic Social", re.compile(r"epic ?social|\bposts?\b|tweet|\bx\.com\b|instagram|tiktok|youtube|linkedin|\bvideos?\b|\bclips?\b|campaign|social media|reddit|\bchannels?\b", re.I)),
    ("Projects/Zenod", re.compile(r"zenod|zenot|xenot|voice[- ]?notes?|\bmemory\b|\bvault\b|obsidian|\btesters?\b|whatsapp", re.I)),
]
DEFAULT_STRAY_TARGET = "Projects/Epic Team"

FM_RE = re.compile(r"^---\n(.*?)\n---\n?", re.S)
CITE_RE = re.compile(r"\[\[(\d{4}-\d{2}-\d{2})#\^(e-[0-9a-f]+)\]\]")
INTRO_RE = re.compile(r"^A provisional leaf under \[\[[^\]]+\]\]: .*$")


def git(vault: Path, *args: str) -> str:
    return subprocess.run(["git", "-c", "core.quotepath=off", "-C", str(vault), *args], check=True, capture_output=True, text=True).stdout


def frontmatter(raw: str) -> tuple[dict[str, str], str, str]:
    m = FM_RE.match(raw)
    if not m:
        return {}, "", raw
    fields = {}
    for line in m.group(1).split("\n"):
        k, sep, v = line.partition(":")
        if sep and not line.startswith(" ") and re.fullmatch(r"[\w-]+", k):
            fields[k] = v.strip()
    return fields, m.group(0), raw[m.end():]


def ref(value: str) -> str:
    m = re.search(r"\[\[([^\]|#]+)", value or "")
    return m.group(1) if m else ""


def born_in(vault: Path, since: str, until: str) -> set[str]:
    out = git(vault, "log", f"--since={since}T00:00:00Z", f"--until={until}T00:00:00Z", "--diff-filter=A", "--no-renames", "--format=", "--name-only", "--", "Notes")
    return {line.strip() for line in out.splitlines() if line.strip().endswith(".md")}


def target_for(parent: str, title: str, text: str) -> tuple[str, str]:
    for target, rule, title_only in RULES:
        if rule.search(title if title_only else f"{title}\n{text}"):
            return target, "new topic"
    if parent in STRAY or parent in SUSPECT or not parent:
        for target, rule in STRAY_RULES:
            if rule.search(f"{title}\n{text[:300]}"):
                return target, "stray branch" if parent in STRAY else "keyword"
        if parent in SUSPECT:
            return parent, "kept"
        return DEFAULT_STRAY_TARGET, "stray branch"
    return parent, "beside its topic"


def section_body(body: str) -> tuple[str, str]:
    """The leaf's own text without its title and intro line; `## ` headings one level down."""
    lines = body.strip("\n").split("\n")
    title = ""
    if lines and lines[0].startswith("# "):
        title = lines[0][2:].strip()
        lines = lines[1:]
    kept = [line for line in lines if not INTRO_RE.match(line)]
    kept = ["#" + line if line.startswith("## ") else line for line in kept]
    return title, "\n".join(kept).strip("\n")


def insert_section(raw: str, heading: str, block: str, cite: str) -> str:
    """Append to the section already holding this note's citation, else a new section before `## Ops rollup`."""
    lines = raw.rstrip("\n").split("\n")
    at = next((i for i, line in enumerate(lines) if line.startswith("## ") and cite in line), -1)
    if at >= 0:
        end = next((i for i in range(at + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
        return "\n".join(lines[:end] + ["", block, ""] + lines[end:]).rstrip("\n") + "\n"
    ops = next((i for i, line in enumerate(lines) if line == "## Ops rollup"), -1)
    if ops >= 0 and not any(line.startswith("## ") for line in lines[ops + 1:]):
        head = "\n".join(lines[:ops]).rstrip("\n")
        return f"{head}\n\n{heading}\n\n{block}\n\n" + "\n".join(lines[ops:]) + "\n"
    return "\n".join(lines) + f"\n\n{heading}\n\n{block}\n"


def set_field(raw: str, key: str, value: str | None) -> str:
    m = FM_RE.match(raw)
    if not m:
        return raw
    fm = [line for line in m.group(1).split("\n") if not line.startswith(f"{key}:")]
    if value is not None:
        fm.append(f"{key}: {value}")
    return "---\n" + "\n".join(fm) + "\n---\n" + raw[m.end():]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault", required=True)
    ap.add_argument("--since", default="2026-11-16")
    ap.add_argument("--until", default="2026-11-24")
    ap.add_argument("--today", default="2026-11-24")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--json")
    a = ap.parse_args()
    vault = Path(a.vault)
    born = born_in(vault, a.since, a.until)

    leaves, rehang = [], []
    for path in sorted(vault.glob("Notes/**/*.md")):
        rel = path.relative_to(vault).as_posix()
        if rel[:-3] in STRAY:
            continue
        raw = path.read_text()
        fields, _, body = frontmatter(raw)
        parent = ref(fields.get("parent", ""))
        provisional = fields.get("provisional") == "true"
        if provisional and fields.get("merged-into") is None and (rel in born or parent in STRAY):
            leaves.append((rel, raw, fields, body, parent))
        elif parent in STRAY and not provisional:
            rehang.append((rel, raw, parent))
    # Confirmed pages under the Hosted plan elsewhere (Projects/) hang on as before: the plan keeps a parent below.

    pages: dict[str, str] = {}

    def page(path: str) -> str:
        if path not in pages:
            f = vault / f"{path}.md"
            if f.exists():
                pages[path] = f.read_text()
            else:
                title, summary, related = NEW_TOPICS[path]
                pages[path] = "\n".join(["---", f"title: {json.dumps(title)}", "type: project", "tags: []", f"created: {a.today}",
                                         f"updated: {a.today}", f"summary: {json.dumps(summary)}", 'parent: "[[Tree]]"', "memory: working", "---", "",
                                         f"# {title}", "", summary, "", f"Related: [[{related}]].", ""])
        return pages[path]

    plan, why = [], Counter()
    for rel, raw, fields, body, parent in leaves:
        title, block = section_body(body)
        title = title or fields.get("title", "").strip('"') or Path(rel).stem
        target, reason = target_for(parent, title, block)
        cites = CITE_RE.findall(block)
        date, anchor = cites[0] if cites else (a.today, "")
        cite = f"[[{date}#^{anchor}]]" if anchor else ""
        heading = f"## {date} · {title[:90].strip()} {cite}".rstrip()
        text = page(target)
        pages[target] = insert_section(text, heading, block, cite) if cite else text.rstrip("\n") + f"\n\n{heading}\n\n{block}\n"
        why[(target, reason)] += 1
        plan.append({"leaf": rel, "from": parent, "into": target, "why": reason, "cite": cite})

    for rel, raw, parent in rehang:
        fields, _, body = frontmatter(raw)
        target, reason = target_for(parent, fields.get("title", "").strip('"'), body)
        if target in NEW_TOPICS:
            page(target)
        plan.append({"rehang": rel, "from": parent, "into": target, "why": reason})

    summary = {
        "leaves": len(leaves), "rehung": len(rehang), "born_in_window": len(born),
        "into": Counter(p["into"] for p in plan if "leaf" in p).most_common(),
        "why": Counter(p["why"] for p in plan if "leaf" in p).most_common(),
        "new_topics": [t for t in NEW_TOPICS if t in pages] + ([NECTARY] if NECTARY in pages else []),
    }
    print(json.dumps(summary, indent=1, ensure_ascii=False))
    if a.json:
        Path(a.json).write_text(json.dumps({"summary": summary, "plan": plan}, indent=1, ensure_ascii=False))
    if not a.apply:
        return 0

    # Topic pages grow; `updated:` moves to today.
    for path, text in pages.items():
        f = vault / f"{path}.md"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(set_field(text, "updated", a.today))
    # Each leaf moves to the Archive as a pointer page: its words now live in the topic.
    for item in plan:
        if "leaf" not in item:
            continue
        src = vault / item["leaf"]
        dst = vault / "Archive" / "Folded 2026-11" / item["leaf"]
        dst.parent.mkdir(parents=True, exist_ok=True)
        fields, _, _ = frontmatter(src.read_text())
        title = fields.get("title", json.dumps(src.stem))
        git(vault, "mv", item["leaf"], dst.relative_to(vault).as_posix())
        dst.write_text("\n".join(["---", f"title: {title}", "type: note", f"merged-into: \"[[{item['into']}]]\"", f"folded: {a.today}",
                                  "folded-by: E22-S5", "---", "", f"# {json.loads(title) if title.startswith('\"') else title}", "",
                                  f"Folded into [[{item['into']}]] on {a.today}: the words and their Log link {item['cite']} live there now.", ""]))
    # Older pointer pages (`merged-into:` a leaf folded now) follow it to the Archive, pointing at its topic.
    folded_into = {item["leaf"][:-3]: item["into"] for item in plan if "leaf" in item}
    moved_pointers = set()
    for path in sorted(vault.glob("Notes/**/*.md")):
        raw = path.read_text()
        into = ref(frontmatter(raw)[0].get("merged-into", ""))
        if into in folded_into:
            rel = path.relative_to(vault).as_posix()
            dst = vault / "Archive" / "Folded 2026-11" / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            git(vault, "mv", rel, dst.relative_to(vault).as_posix())
            dst.write_text(set_field(set_field(raw, "merged-into", json.dumps(f"[[{folded_into[into]}]]")), "parent", None))
            moved_pointers.add(rel)
    for item in plan:
        if "rehang" in item and item["rehang"] not in moved_pointers:
            f = vault / item["rehang"]
            f.write_text(set_field(f.read_text(), "parent", json.dumps(f"[[{item['into']}]]")))
    # Retire the stray branches.
    hang = {
        "Notes/The user says there is one data environment with two frontends (staging and stable production)": "Projects/Epic Team",
        "Notes/Boris Cherny - Anthropic Engineers Think in Exponentials": "Areas/Ideas and knowledge",
        "Projects/Zenod/Hosted Zenod (M3) Multi-Tenant Plan": "Projects/Zenod",
    }
    for path, parent in hang.items():
        f = vault / f"{path}.md"
        f.write_text(set_field(set_field(f.read_text(), "parent", json.dumps(f"[[{parent}]]")), "memory", None))
    if NECTARY in pages:
        nf = vault / f"{NECTARY}.md"
        nf.write_text(set_field(set_field(nf.read_text(), "parent", '"[[Tree]]"'), "memory", "working"))
    es = vault / "Projects/Epic Social.md"
    es.write_text(set_field(set_field(es.read_text(), "parent", '"[[Tree]]"'), "memory", "working"))
    tree = vault / "Tree.md"
    lines = tree.read_text().split("\n")
    out = []
    for line in lines:
        if line.startswith("- data environment |") or line.startswith("- Anthropic Engineers |"):
            continue
        if line.startswith("- Epic Social |"):
            line = line.replace("[[Projects/Zenod/Hosted Zenod (M3) Multi-Tenant Plan]]", "[[Projects/Epic Social]]")
        out.append(line)
        if line.startswith("- Epic Social |"):
            for path in [*NEW_TOPICS, NECTARY]:
                if path in pages:
                    name, desc = ("Nectary", "Nectary, the venture idea (formerly RepoMiningFunding): what it is, how to revive it.") if path == NECTARY else NEW_TOPICS[path][:2]
                    out.append(f"- {name} | working | [[{path}]] | {desc} ^n-{hashlib.sha1(path.encode()).hexdigest()[:8]}")
    tree.write_text("\n".join(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
