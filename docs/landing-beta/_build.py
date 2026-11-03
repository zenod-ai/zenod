#!/usr/bin/env python3
"""Generates a/, b/, c/ index.html from shared copy. Run: python3 _build.py"""
import pathlib

ROOT = pathlib.Path(__file__).parent
SITE = "https://zenod.dev"
GH = "https://github.com/zenod-ai/zenod"

# ---------- diagrams (thin lines, few words; wide for desktop, tall for phone) ----------
def _box(x, y, w, h, title, sub, focus=False, ts=26, ss=19, dash=False):
    cls = "d-box d-focus" if focus else ("d-box d-dash" if dash else "d-box")
    cx = x + w / 2
    return (
        f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="3"/>'
        f'<text class="d-t" x="{cx}" y="{y + h/2 - (4 if sub else -9)}" text-anchor="middle" font-size="{ts}">{title}</text>'
        + (f'<text class="d-s" x="{cx}" y="{y + h/2 + 26}" text-anchor="middle" font-size="{ss}">{sub}</text>' if sub else "")
    )

def _arrow_h(x1, x2, y):
    return f'<path class="d-line" d="M{x1} {y}H{x2}"/><path class="d-line" d="M{x2-9} {y-6}L{x2} {y}L{x2-9} {y+6}"/>'

def _arrow_v(x, y1, y2):
    return f'<path class="d-line" d="M{x} {y1}V{y2}"/><path class="d-line" d="M{x-6} {y2-9}L{x} {y2}L{x+6} {y2-9}"/>'

def _dline(d):
    return f'<path class="d-line d-dash" d="{d}"/>'

def _lab(x, y, text, size=18, anchor="start"):
    return f'<text class="d-s" x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}">{text}</text>'

def _fig(wide_vb, tall_vb, label, wide, tall):
    return (f'<figure class="diagram"><svg class="d-wide" viewBox="{wide_vb}" role="img" aria-label="{label}">{wide}</svg>'
            f'<svg class="d-tall" viewBox="{tall_vb}" role="img" aria-label="{label}">{tall}</svg></figure>')

# 1. Hire a librarian: the library is yours, Zenod files it, any librarian could.
def diagram_library():
    lbl = "Zenod, the librarian you hire, files and organizes your library. The library sits in your own GitHub repository or Google Drive. A different librarian could take over later."
    wide = (
        _box(10, 50, 230, 90, "Zenod", "the librarian you hire", True)
        + _box(10, 170, 230, 90, "Another librarian", "if you ever switch", dash=True)
        + _arrow_h(244, 326, 95) + _dline("M244 215H322") + '<path class="d-line" d="M313 209L322 215L313 221"/>'
        + '<rect class="d-box d-dash" x="330" y="20" width="620" height="260" rx="3"/>'
        + _lab(354, 56, "Yours: your GitHub repository or Google Drive", 19)
        + _box(360, 85, 560, 160, "Your library", "plain Markdown, originals included", ts=30, ss=20)
    )
    tall = (
        _box(10, 0, 165, 80, "Zenod", "you hire it", True, ts=22, ss=15)
        + _box(185, 0, 165, 80, "Another", "if you switch", ts=22, ss=15, dash=True)
        + _arrow_v(92, 84, 140) + _dline("M268 84V136") + '<path class="d-line" d="M262 128L268 136L274 128"/>'
        + '<rect class="d-box d-dash" x="10" y="144" width="340" height="250" rx="3"/>'
        + _lab(26, 176, "Yours: GitHub repo or Google Drive", 15.5)
        + _box(30, 200, 300, 170, "Your library", "plain Markdown,", ts=28, ss=17)
        + _lab(180, 330, "originals included", 17, "middle")
    )
    return _fig("0 0 960 300", "0 0 360 410", lbl, wide, tall)

# 2. One contact: a voice note becomes a kept original and filed notes.
def diagram_capture():
    lbl = "A voice note sent on WhatsApp goes to Zenod, which keeps the original recording and files the notes in your library."
    wide = (
        _box(10, 65, 230, 100, "Voice note", "sent on WhatsApp")
        + _arrow_h(244, 326, 115)
        + _box(330, 65, 220, 100, "Zenod", "files it", True)
        + '<path class="d-line" d="M554 115H602V60H706"/><path class="d-line" d="M697 54L706 60L697 66"/>'
        + '<path class="d-line" d="M602 115V170H706"/><path class="d-line" d="M697 164L706 170L697 176"/>'
        + _box(710, 20, 240, 80, "Original kept", "recording, transcript", ts=24, ss=18)
        + _box(710, 130, 240, 80, "Notes filed", "in your library", ts=24, ss=18)
    )
    tall = (
        _box(30, 0, 300, 76, "Voice note", "sent on WhatsApp", ts=24, ss=17)
        + _arrow_v(180, 80, 128)
        + _box(30, 132, 300, 76, "Zenod", "files it", True, ts=24, ss=17)
        + '<path class="d-line" d="M180 212V232H92V266"/><path class="d-line" d="M86 257L92 266L98 257"/>'
        + '<path class="d-line" d="M180 232H268V266"/><path class="d-line" d="M262 257L268 266L274 257"/>'
        + _box(10, 270, 165, 80, "Original", "kept", ts=21, ss=16)
        + _box(185, 270, 165, 80, "Notes", "filed", ts=21, ss=16)
    )
    return _fig("0 0 960 230", "0 0 360 360", lbl, wide, tall)

# 3. Cultivate + keep the original: three layers, every note links back.
def diagram_layers():
    lbl = "Three layers. Original recordings, documents and pictures at the bottom. Meaning such as projects, people and preferences in the middle. Plans and decisions on top. Every note links back to its original."
    wide = (
        _box(10, 10, 940, 74, "Put to work", "plans, decisions, answers", ts=26, ss=19)
        + _box(10, 128, 940, 74, "Meaning", "projects, people, preferences", True, ts=26, ss=19)
        + _box(10, 246, 940, 74, "Originals", "recordings, documents, pictures, kept as they were", ts=26, ss=19)
        + '<path class="d-line" d="M200 242V206"/><path class="d-line" d="M194 215L200 206L206 215"/>'
        + '<path class="d-line" d="M200 124V88"/><path class="d-line" d="M194 97L200 88L206 97"/>'
        + _lab(214, 233, "organizes", 20) + _lab(214, 115, "puts to work", 20)
        + _dline("M600 206V242") + '<path class="d-line" d="M594 233L600 242L606 233"/>'
        + _lab(614, 233, "every note links back to its source", 20)
    )
    tall = (
        _box(0, 0, 360, 76, "Put to work", "plans, decisions", ts=22, ss=16)
        + _box(0, 124, 360, 76, "Meaning", "projects, people, preferences", True, ts=22, ss=16)
        + _box(0, 248, 360, 76, "Originals", "recordings, documents, pictures", ts=22, ss=16)
        + '<path class="d-line" d="M48 244V204"/><path class="d-line" d="M42 213L48 204L54 213"/>'
        + '<path class="d-line" d="M48 120V80"/><path class="d-line" d="M42 89L48 80L54 89"/>'
        + _lab(62, 230, "organizes", 16) + _lab(62, 106, "puts to work", 16)
        + _dline("M220 204V244") + '<path class="d-line" d="M214 235L220 244L226 235"/>'
        + _lab(234, 230, "links back", 16)
    )
    return _fig("0 0 960 330", "0 0 360 324", lbl, wide, tall)

# 4. Ask the librarian: question, answer, the voice note behind it.
def diagram_ask():
    lbl = "You ask what you said about the light in that flat. Zenod answers and points to the original voice note."
    wide = (
        _box(0, 40, 290, 100, "You ask", "the light in that flat?")
        + _arrow_h(294, 331, 90)
        + _box(335, 40, 290, 100, "Zenod answers", "you loved the natural light", True)
        + _arrow_h(629, 666, 90)
        + _box(670, 40, 290, 100, "Your voice note", "the original, to play back")
    )
    tall = (
        _box(30, 0, 300, 76, "You ask", "the light in that flat?", ts=24, ss=17)
        + _arrow_v(180, 80, 128)
        + _box(30, 132, 300, 76, "Zenod answers", "you loved the natural light", True, ts=24, ss=17)
        + _arrow_v(180, 212, 260)
        + _box(30, 264, 300, 76, "Your voice note", "the original, to play back", ts=24, ss=17)
    )
    return _fig("0 0 960 180", "0 0 360 340", lbl, wide, tall)

# 5. Every agent reaches the same library through the librarian.
def diagram_agents():
    lbl = "Claude, Codex and other agents you choose reach your library through Zenod over MCP. Change the agent and the library stays."
    wide = (
        _box(10, 20, 220, 56, "Claude", "", ts=24)
        + _box(10, 97, 220, 56, "Codex", "", ts=24)
        + _box(10, 174, 220, 56, "Other agents", "", ts=24)
        + '<path class="d-line" d="M234 48H300Q330 48 330 78V112Q330 125 360 125"/>'
        + '<path class="d-line" d="M234 125H356"/>'
        + '<path class="d-line" d="M234 202H300Q330 202 330 172V138Q330 125 360 125"/>'
        + _box(360, 85, 240, 80, "Zenod", "reached over MCP", True)
        + _arrow_h(604, 676, 125)
        + _box(680, 85, 270, 80, "Your library", "", ts=26)
    )
    tall = (
        _box(10, 0, 100, 54, "Claude", "", ts=19)
        + _box(130, 0, 100, 54, "Codex", "", ts=19)
        + _box(250, 0, 100, 54, "Others", "", ts=19)
        + '<path class="d-line" d="M60 58V94Q60 108 80 108H180"/>'
        + '<path class="d-line" d="M180 58V146"/>'
        + '<path class="d-line" d="M300 58V94Q300 108 280 108H180"/>'
        + _box(30, 150, 300, 80, "Zenod", "reached over MCP", True, ts=24, ss=17)
        + _arrow_v(180, 234, 288)
        + _box(30, 292, 300, 80, "Your library", "", ts=24)
    )
    return _fig("0 0 960 250", "0 0 360 372", lbl, wide, tall)

HERO_H = "Hire a librarian for your memory."
HERO_LEAD = ("Zenod files and organizes your notes and voice notes in a library you keep in your own GitHub or Google Drive. "
             "Any agent you choose can reach it, so your context stays yours.")
LIB_H = "You hire Zenod. You keep the library."
LIB_BIG = "You hire Zenod to look after your memory library. The library stays yours."
LIB_P1 = ("Your memory library is plain Markdown in your own GitHub repository or, on Hosted, a Google Drive folder. "
          "Zenod is the librarian you hire to file it, keep it tidy and keep the originals.")
LIB_P2 = ("It also makes the library easy for third-party agents to reach, so your context moves with you from one agent to the next. "
          "If you ever change librarian, the library is already where you keep it.")
LIB_FINE = "Obsidian opens the files as they are."
CAP_P = ("Send a voice note on WhatsApp while the thought is fresh. Zenod keeps the recording and the transcript, "
         "sorts what you said into projects, people and preferences, and files it in your library.")
ORIG_P = ("The recording stays as the original. Notes built from it link back to it, so you can check any summary against what you said.")
ASK_P = ("Ask \u201cWhat did I say about the light in that flat?\u201d and Zenod finds the thought and shows you the voice note it came from.")
AG_H = "Any agent you choose."
AG_P = ("Claude, Codex and other MCP clients reach your library through Zenod, and add to it there. Change the agent and the library stays where it is.")
AG_BIG = "Claude, Codex and other MCP clients reach your library through Zenod. Change the agent and keep the library."
NAME_P = "Zenodotus was the first librarian of the Library of Alexandria. The library was the place. The librarian made it usable."

# ---------- shared copy ----------
def head(title, css, fonts):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="Hire Zenod as the librarian for your memory library. It files your notes in your own GitHub or Google Drive and makes them easy for any agent you choose to reach.">
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{fonts}">
<link rel="stylesheet" href="{css}">
</head>
<body>
"""

def nav(extra=""):
    return f"""<header class="nav"><div class="wrap nav-in">
<a class="brand" href="#top">Zenod</a>
<nav aria-label="Primary"><a href="#capture">How it works</a><a href="#agents">Agents</a><a href="#start">Pricing</a><a href="{SITE}/connect">Connect</a></nav>
<a class="btn btn-small" href="{SITE}/pricing">Get started</a>
</div></header>
"""

def footer():
    return f"""<footer class="foot"><div class="wrap">
<p class="foot-name">Zenod, the librarian for your agents.</p>
<p class="foot-links"><a href="{SITE}/connect">Docs</a> <a href="{GH}">GitHub</a> <a href="{SITE}/legal/privacy.html">Privacy</a> <a href="{SITE}/legal/terms.html">Terms</a> <a href="{SITE}/legal/legal-notice.html">Legal notice</a> <a href="{SITE}/legal/cookies.html">Cookies</a> <a href="{SITE}/legal/data-handling.html">Data</a></p>
<p class="foot-note">Design preview of a possible landing page. Not the live site.</p>
</div></footer>
</body></html>
"""

PRICING = f"""<div class="plans">
<div class="plan">
<h3>Self-hosted</h3>
<p class="price">Free</p>
<p>Run Zenod on your own server with your AI provider key, a Telegram bot and a GitHub vault.</p>
<a class="btn" href="{GH}#readme">Read the install guide</a>
</div>
<div class="plan plan-main">
<h3>Zenod Hosted</h3>
<p class="price">€9 <small>per month + VAT</small></p>
<p>We run it for you. Managed AI usage and WhatsApp are included. Keep your vault in GitHub or in a Google Drive folder the app creates.</p>
<a class="btn btn-primary" href="{SITE}/pricing">See Hosted</a>
</div>
</div>
<p class="fine">Same open-source engine in both. Your memory is ordinary Markdown either way.</p>"""


FINE_WA = "WhatsApp comes with Hosted. Self-hosted uses Telegram."
FINE_MCP = f'Needs a compatible client and a configured connection. <a href="{SITE}/connect">How to connect</a>'

def page_a():
    return head("Zenod: hire a librarian for your memory", "style.css",
        "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Instrument+Sans:wght@400;500&display=swap") + nav() + f"""
<main id="top">
<section class="hero wrap">
<h1>{HERO_H}</h1>
<p class="lead">{HERO_LEAD}</p>
<p class="actions"><a class="btn btn-primary" href="{SITE}/pricing">Try Zenod free</a> <a class="btn" href="{GH}">Star on GitHub</a></p>
</section>
<figure class="band wrap-wide"><img src="../img/hero.webp" width="1536" height="1024" alt="Wooden library shelves holding paper scrolls and books in warm window light"></figure>

<section class="sec wrap" id="library">
<h2>{LIB_H}</h2>
<p>{LIB_P1}</p>
<p>{LIB_P2}</p>
{diagram_library()}
<p class="fine">{LIB_FINE}</p>
</section>

<section class="sec wrap" id="capture">
<h2>Say it once. Zenod files it.</h2>
<p>{CAP_P}</p>
{diagram_capture()}
<p class="fine">{FINE_WA}</p>
</section>

<section class="sec wrap" id="originals">
<h2>Kept as you said it.</h2>
<p>{ORIG_P}</p>
{diagram_layers()}
</section>

<section class="sec wrap" id="ask">
<h2>Ask the librarian.</h2>
<p>{ASK_P}</p>
{diagram_ask()}
</section>
<figure class="band wrap-wide"><img src="../img/voice.webp" width="1536" height="1024" loading="lazy" alt="A phone, a ceramic cup and a blank sheet of paper on an oak desk"></figure>

<section class="sec wrap" id="agents">
<h2>{AG_H}</h2>
<p>{AG_P}</p>
{diagram_agents()}
<p class="fine">{FINE_MCP}</p>
</section>

<section class="sec wrap" id="name">
<h2>Why the name.</h2>
<p>{NAME_P}</p>
</section>
<figure class="band wrap-wide"><img src="../img/hall.webp" width="1536" height="1024" loading="lazy" alt="A quiet library hall with tall arches and a reader at a long table"></figure>

<section class="sec wrap" id="start">
<h2>Run it your way.</h2>
{PRICING}
</section>
</main>
""" + footer()

def page_b():
    return head("Zenod: your library, your librarian", "style.css",
        "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&display=swap") + nav() + f"""
<main id="top">
<section class="hero">
<img class="hero-img" src="../img/hero.webp" width="1536" height="1024" alt="Wooden library shelves holding paper scrolls and books in warm window light">
<div class="wrap hero-in">
<h1>Your library. Your librarian.</h1>
<p class="lead">{HERO_LEAD}</p>
<p class="actions"><a class="btn btn-primary" href="{SITE}/pricing">Try Zenod free</a> <a class="btn" href="{GH}">Star on GitHub</a></p>
</div>
</section>

<section class="sec wrap" id="library">
<h2>{LIB_H}</h2>
<p>{LIB_P1}</p>
<p>{LIB_P2}</p>
{diagram_library()}
<p class="fine">{LIB_FINE}</p>
</section>

<section class="sec wrap" id="capture">
<h2>Talk. Zenod files.</h2>
<p>{CAP_P}</p>
{diagram_capture()}
<p class="fine">{FINE_WA}</p>
</section>

<figure class="full"><img src="../img/hall.webp" width="1536" height="1024" loading="lazy" alt="A quiet library hall with tall arches and a reader at a long table"></figure>

<section class="sec wrap" id="originals">
<h2>Kept as you said it.</h2>
<p>{ORIG_P}</p>
{diagram_layers()}
</section>

<section class="sec wrap" id="ask">
<h2>Ask later. Get the source.</h2>
<p>{ASK_P}</p>
{diagram_ask()}
</section>

<section class="sec wrap" id="agents">
<h2>{AG_H}</h2>
<p>{AG_P}</p>
{diagram_agents()}
<p class="fine">{FINE_MCP}</p>
</section>

<section class="sec wrap" id="name">
<h2>Why the name.</h2>
<p>{NAME_P}</p>
</section>

<section class="sec wrap" id="start">
<h2>Run it your way.</h2>
{PRICING}
</section>
</main>
""" + footer()

def page_c():
    return head("Zenod: hire a librarian for your memory", "style.css",
        "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&display=swap") + nav() + f"""
<main id="top">
<section class="stmt hero wrap">
<h1>Hire a librarian. Keep your library.</h1>
<p class="lead">{HERO_LEAD}</p>
<p class="actions"><a class="btn btn-primary" href="{SITE}/pricing">Try Zenod free</a> <a class="btn" href="{GH}">Star on GitHub</a></p>
</section>

<section class="stmt wrap" id="library">
<p class="big">{LIB_BIG}</p>
<p>{LIB_P2}</p>
{diagram_library()}
<p class="fine">{LIB_FINE}</p>
</section>

<section class="stmt wrap" id="capture">
<p class="big">Send a voice note. Zenod keeps the recording and files the notes.</p>
{diagram_capture()}
<p class="fine">{FINE_WA}</p>
</section>

<section class="stmt wrap" id="originals">
<p class="big">Every note links back to what you said.</p>
{diagram_layers()}
</section>

<section class="stmt wrap" id="ask">
<p class="big">Ask what you said about the light in that flat. Get the answer and the voice note behind it.</p>
{diagram_ask()}
</section>

<figure class="full"><img src="../img/threads.webp" width="1536" height="1024" loading="lazy" alt="Many green threads running from wooden pegs to a single brass ring"></figure>

<section class="stmt wrap" id="agents">
<p class="big">{AG_BIG}</p>
{diagram_agents()}
<p class="fine">{FINE_MCP}</p>
</section>

<section class="stmt wrap" id="start">
<div class="rows">
<div class="row"><div><h3>Self-hosted</h3><p>Your server, your AI provider key, Telegram, a GitHub vault.</p></div><p class="price">Free</p><a class="btn" href="{GH}#readme">Install guide</a></div>
<div class="row"><div><h3>Zenod Hosted</h3><p>Managed AI usage and WhatsApp included. GitHub or Google Drive vault.</p></div><p class="price">€9<small>/month + VAT</small></p><a class="btn btn-primary" href="{SITE}/pricing">See Hosted</a></div>
</div>
<p class="fine">Same open-source engine in both. {NAME_P}</p>
</section>
</main>
""" + footer()

for name, fn in (("a", page_a), ("b", page_b), ("c", page_c)):
    (ROOT / name).mkdir(exist_ok=True)
    (ROOT / name / "index.html").write_text(fn())
print("built")
