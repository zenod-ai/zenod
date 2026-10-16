#!/usr/bin/env python3
"""Claude Code Stop hook: block a final reply that hands over an HTML/visual
deliverable as a path or ``file://`` instead of a reachable URL (127.0.0.1, or the Tailscale host on a headless machine).

Stdin is the Stop-hook JSON (``last_assistant_message``, else the last assistant
text in ``transcript_path``). To block, print ``{"decision": "block", "reason": ...}``
and exit 0 (https://code.claude.com/docs/en/hooks, "Stop decision control").
Stdlib only, Python 3.10+.

Heuristics (deliberately simple):
- A visual mention is a ``file://`` link or a path containing ``/`` ending in
  .html .htm .svg .png .pdf (a bare ``file://`` or a ``<host>``-style placeholder URL,
  as in quoted rule text, is not one); a bare ``name.html`` counts only on a line that
  also says open/view. Fenced code blocks are ignored, URLs included (quoted source/diffs);
  remote http(s) URLs are ignored.
- Any ``http://127.0.0.1[:port]/...`` or ``localhost`` URL in the message is
  curl-checked (GET, 2s); anything but 200 blocks. A reachable one satisfies a
  visual mention, whatever it points at.
- When artifact_host.resolve() picks a non-loopback host (auto-detected on a headless
  machine with Tailscale, or set by env ``EPICSPINE_ARTIFACT_HOST``) the same holds
  for URLs on that host (or its bind IP), and 127.0.0.1/localhost URLs no longer
  count: a remote reader cannot open them. Desktops and ``local`` stay on loopback.
- Non-visual paths (.py .md .json ...) never trigger. A path mention only counts when the file was
  created or modified during the turn (transcript Write/Edit/MultiEdit targets, or mtime at/after
  the last user prompt) or the same line calls it a deliverable (open/view/deliverable); naming an
  untouched file (a template, a source) never blocks. ``file://`` links always count. No transcript
  or timestamps: every mention counts (legacy).
Safety: fails open on any error; at most MAX_BLOCKS blocks per turn (a counter
file per session in the temp dir, reset when ``stop_hook_active`` is false);
``EPICSPINE_URL_GATE=off`` disables the gate.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Callable

import artifact_host

MAX_BLOCKS = 2
FENCE = re.compile(r"^(```|~~~).*?^\1[^\n]*$", re.DOTALL | re.MULTILINE)
URL_TAIL = r"(?::\d+)?(?![\w:<])(?:/[^\s)\]>\"'`<]*)?"
LOCAL_URL = re.compile(r"https?://(?:127\.0\.0\.1|localhost)" + URL_TAIL)
REMOTE_URL = re.compile(r"https?://[^\s)\]>\"'`<]+")
FILE_URL = re.compile(r"file://(?=[^\s)\]>\"'`<]*\w)[^\s)\]>\"'`<]*", re.I)
# A URL token carrying a `<placeholder>` is quoted rule text, not a deliverable.
PLACEHOLDER_URL = re.compile(r"(?:https?|file)://[^\s)\]\"'`]*<[^<>\s]+>[^\s)\]\"'`]*", re.I)
EXT = r"\.(?:html?|svg|png|pdf)\b"
PATH = re.compile(r"(?<![\w.])[\w~./\-+%@]*[\w\-+%@]" + EXT + r"(?![\w/])", re.I)
OPEN_WORD = re.compile(r"\b(?:open|view)\b", re.I)
DELIVERABLE = re.compile(r"\b(?:open|view|deliverables?)\b", re.I)

REASON_NO_URL = (
    "HTML deliverable reported without a served URL ({found}). Serve the artifact "
    "directory (references/artifacts.md, scripts/artifact_host.py; or the repo's declared "
    "serve script) so it is reachable at {host}, curl-check HTTP 200, and report the "
    "clickable URL http://{host}:<port>/<file> on its own line. "
    "Set EPICSPINE_URL_GATE=off to disable.")
REASON_BAD_URL = (
    "Reported URL not serving HTTP 200: {bad}. Start or fix the server on {host}, "
    "curl-check it, then report the working URL on its own line.")


def final_text(payload: dict) -> str:
    text = payload.get("last_assistant_message")
    if isinstance(text, str) and text.strip():
        return text
    path = payload.get("transcript_path")
    if not isinstance(path, str):
        return ""
    last = ""
    with open(os.path.expanduser(path), encoding="utf-8") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            msg = rec.get("message") if isinstance(rec, dict) else None
            if rec.get("type") != "assistant" or not isinstance(msg, dict):
                continue
            content = msg.get("content")
            if isinstance(content, str):
                parts = [content]
            else:
                parts = [c.get("text", "") for c in content or []
                         if isinstance(c, dict) and c.get("type") == "text"]
            joined = "\n".join(p for p in parts if p).strip()
            if joined:
                last = joined
    return last


def prose_of(text: str) -> str:
    """``text`` without fenced code and placeholder URLs (quoted rule wording)."""
    return PLACEHOLDER_URL.sub("", FENCE.sub("", text))


def turn_activity(payload: dict) -> Callable[[str], bool] | None:
    """``fresh(mention)`` from the transcript: was the file written this turn? None when unknowable."""
    path = payload.get("transcript_path")
    if not isinstance(path, str):
        return None
    start, touched = None, set()
    with open(os.path.expanduser(path), encoding="utf-8") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
                msg = rec["message"]
                content = msg["content"]
            except (ValueError, KeyError, TypeError):
                continue
            blocks = [{"type": "text", "text": content}] if isinstance(content, str) else content or []
            if rec.get("type") == "user" and any(isinstance(b, dict) and b.get("type") == "text" for b in blocks):
                start, touched = datetime.fromisoformat(str(rec["timestamp"]).replace("Z", "+00:00")).timestamp(), set()
            elif rec.get("type") == "assistant":
                for b in blocks:
                    inp = b.get("input") if isinstance(b, dict) and b.get("type") == "tool_use" else None
                    if isinstance(inp, dict):
                        touched.update(str(v) for k, v in inp.items() if k in ("file_path", "path") and isinstance(v, str))
    if start is None:
        return None
    cwd = Path(str(payload.get("cwd") or os.getcwd()))

    def fresh(mention: str) -> bool:
        if any(t == mention or t.endswith("/" + mention.lstrip("./")) or Path(t).name == mention for t in touched):
            return True
        try:
            return (cwd / Path(mention).expanduser()).stat().st_mtime >= start - 2
        except OSError:
            return False
    return fresh


def visual_mentions(text: str, pat: re.Pattern = LOCAL_URL, fresh: Callable[[str], bool] | None = None) -> list[str]:
    """Visual-file mentions in prose (fences and non-``pat`` URLs removed); path mentions need ``fresh``
    or a deliverable word on their line when ``fresh`` is given."""
    prose = REMOTE_URL.sub(lambda m: m.group(0) if pat.match(m.group(0)) else "",
                           prose_of(text))
    found = FILE_URL.findall(prose)
    prose = FILE_URL.sub("", prose)
    for line in prose.splitlines():
        for m in PATH.finditer(pat.sub("", line)):
            if ("/" in m.group(0) or OPEN_WORD.search(line)) and (
                    fresh is None or DELIVERABLE.search(line) or fresh(m.group(0))):
                found.append(m.group(0))
    return found


def status_ok(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def decide(text: str, fresh: Callable[[str], bool] | None = None) -> str | None:
    """Return a block reason, or None to allow."""
    info = artifact_host.resolve()
    host, pat, prose = info["host"], LOCAL_URL, prose_of(text)
    if host != "127.0.0.1":
        names = "|".join(re.escape(n) for n in {host, info["bind"]} if not n.startswith("127."))
        pat = re.compile(r"https?://(?:" + names + ")" + URL_TAIL, re.I)
    urls = list(dict.fromkeys(u.rstrip(".,;:!?") for u in pat.findall(prose)))
    bad = [u for u in urls if not status_ok(u)]
    if bad:
        return REASON_BAD_URL.format(bad=", ".join(bad), host=host)
    if not urls:
        found = visual_mentions(text, pat, fresh)
        if pat is not LOCAL_URL:
            found += LOCAL_URL.findall(prose)
        if found:
            return REASON_NO_URL.format(found=", ".join(dict.fromkeys(found))[:200], host=host)
    return None


def counter_path(session: str) -> Path:
    safe = re.sub(r"[^\w.-]", "_", session or "nosession")[:80]
    return Path(tempfile.gettempdir()) / "epicspine-url-gate" / f"{safe}.count"


def main() -> int:
    try:
        if os.environ.get("EPICSPINE_URL_GATE", "").strip().lower() == "off":
            return 0
        payload = json.loads(sys.stdin.read() or "{}")
        if not isinstance(payload, dict):
            return 0
        counter = counter_path(str(payload.get("session_id", "")))
        count = 0
        if payload.get("stop_hook_active"):
            try:
                count = int(counter.read_text())
            except (OSError, ValueError):
                count = 0
        try:
            fresh = turn_activity(payload)
        except Exception:
            fresh = None
        reason = decide(final_text(payload), fresh)
        if reason is None or count >= MAX_BLOCKS:
            counter.unlink(missing_ok=True)
            return 0
        counter.parent.mkdir(parents=True, exist_ok=True)
        counter.write_text(str(count + 1))
        print(json.dumps({"decision": "block", "reason": reason}))
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
