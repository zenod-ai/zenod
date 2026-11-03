#!/usr/bin/env python3
"""Generates a/, b/, c/ index.html from shared copy. Run: python3 _build.py"""
import pathlib

ROOT = pathlib.Path(__file__).parent
SITE = "https://zenod.dev"
GH = "https://github.com/zenod-ai/zenod"

# ---------- diagrams (thin lines, few words; wide for desktop, tall for phone) ----------
def _box(x, y, w, h, title, sub, focus=False, ts=26, ss=19):
    cls = "d-box d-focus" if focus else "d-box"
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

def diagram_capture():
    wide = (
        '<svg class="d-wide" viewBox="0 0 960 190" role="img" aria-label="A voice note goes to Zenod, which files it in your vault as Markdown.">'
        + _box(10, 45, 270, 100, "Voice note", "sent on WhatsApp")
        + _arrow_h(284, 356, 95)
        + _box(360, 45, 240, 100, "Zenod", "keeps, sorts, links", True)
        + _arrow_h(604, 676, 95)
        + _box(680, 45, 270, 100, "Your vault", "Markdown, your account")
        + "</svg>"
    )
    tall = (
        '<svg class="d-tall" viewBox="0 0 360 420" role="img" aria-label="A voice note goes to Zenod, which files it in your vault as Markdown.">'
        + _box(30, 10, 300, 84, "Voice note", "sent on WhatsApp", ts=24, ss=17)
        + _arrow_v(180, 98, 156)
        + _box(30, 160, 300, 84, "Zenod", "keeps, sorts, links", True, ts=24, ss=17)
        + _arrow_v(180, 248, 306)
        + _box(30, 310, 300, 84, "Your vault", "Markdown, your account", ts=24, ss=17)
        + "</svg>"
    )
    return f'<figure class="diagram">{wide}{tall}</figure>'

def diagram_agents():
    wide = (
        '<svg class="d-wide" viewBox="0 0 960 250" role="img" aria-label="Claude, Codex and other agents read from and write to your vault only through Zenod.">'
        + _box(10, 20, 220, 56, "Claude", "", ts=24)
        + _box(10, 97, 220, 56, "Codex", "", ts=24)
        + _box(10, 174, 220, 56, "Other agents", "", ts=24)
        + '<path class="d-line" d="M234 48H300Q330 48 330 78V112Q330 125 360 125"/>'
        + '<path class="d-line" d="M234 125H356"/>'
        + '<path class="d-line" d="M234 202H300Q330 202 330 172V138Q330 125 360 125"/>'
        + _box(360, 85, 240, 80, "Zenod", "one gateway (MCP)", True)
        + _arrow_h(604, 676, 125)
        + _box(680, 85, 270, 80, "Your vault", "", ts=26)
        + "</svg>"
    )
    tall = (
        '<svg class="d-tall" viewBox="0 0 360 420" role="img" aria-label="Claude, Codex and other agents read from and write to your vault only through Zenod.">'
        + _box(10, 10, 100, 54, "Claude", "", ts=19)
        + _box(130, 10, 100, 54, "Codex", "", ts=19)
        + _box(250, 10, 100, 54, "Others", "", ts=19)
        + '<path class="d-line" d="M60 68V104Q60 118 80 118H180"/>'
        + '<path class="d-line" d="M180 68V156"/>'
        + '<path class="d-line" d="M300 68V104Q300 118 280 118H180"/>'
        + _box(30, 160, 300, 84, "Zenod", "one gateway (MCP)", True, ts=24, ss=17)
        + _arrow_v(180, 248, 306)
        + _box(30, 310, 300, 84, "Your vault", "", ts=24)
        + "</svg>"
    )
    return f'<figure class="diagram">{wide}{tall}</figure>'

# ---------- shared copy ----------
def head(title, css, fonts):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="Zenod keeps your notes, voice notes and decisions in plain Markdown you own, and gives every agent the right context.">
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

def page_a():
    return head("Zenod: one memory for all your agents", "style.css",
        "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Instrument+Sans:wght@400;500&display=swap") + nav() + f"""
<main id="top">
<section class="hero wrap">
<h1>One memory for all your agents.</h1>
<p class="lead">Zenod keeps your notes, voice notes and decisions in plain Markdown that you own, and hands every agent the context it needs.</p>
<p class="actions"><a class="btn btn-primary" href="{SITE}/pricing">Try Zenod free</a> <a class="btn" href="{GH}">Star on GitHub</a></p>
</section>
<figure class="band wrap-wide"><img src="../img/hero.webp" width="1536" height="1024" alt="Wooden library shelves holding paper scrolls and books in warm window light"></figure>

<section class="sec wrap" id="capture">
<h2>Say it once. Zenod files it.</h2>
<p>Send a voice note on WhatsApp while the thought is fresh. Zenod keeps the recording and the transcript, sorts what you said into projects, people and preferences, and links every note back to the original.</p>
{diagram_capture()}
<p class="fine">WhatsApp comes with Hosted. Self-hosted uses Telegram.</p>
</section>

<section class="sec wrap" id="ask">
<h2>Every answer points back to what you said.</h2>
<p>Ask “What did I say about the light in that flat?” and Zenod finds the thought and shows you the voice note it came from. Summaries stay tied to their sources, so you can check them.</p>
</section>
<figure class="band wrap-wide"><img src="../img/voice.webp" width="1536" height="1024" loading="lazy" alt="A phone, a ceramic cup and a blank sheet of paper on an oak desk"></figure>

<section class="sec wrap wrap-two" id="agents">
<div>
<h2>Every agent starts from the same place.</h2>
<p>Claude, Codex and other MCP clients can read from your memory and add to it through Zenod. Swap the agent and the memory stays where it was.</p>
<p class="fine">Needs a compatible client and a configured connection. <a href="{SITE}/connect">How to connect</a></p>
</div>
<figure class="pic"><img src="../img/threads.webp" width="1536" height="1024" loading="lazy" alt="Many green threads running from wooden pegs to a single brass ring"></figure>
</section>

<section class="sec wrap" id="yours">
<h2>Plain Markdown, in your account.</h2>
<p>Your library lives in your own GitHub repository or, on Hosted, a Google Drive folder. Zenod has permission to look after it and does not own it. If you replace Zenod one day, the files and the originals beneath them are still yours. Obsidian opens them as they are.</p>
</section>

<section class="sec wrap" id="name">
<h2>Why the name.</h2>
<p>Zenodotus was the first librarian of the Library of Alexandria. The library was the place. The librarian made it usable.</p>
</section>
<figure class="band wrap-wide"><img src="../img/hall.webp" width="1536" height="1024" loading="lazy" alt="A quiet library hall with tall arches and a reader at a long table"></figure>

<section class="sec wrap" id="start">
<h2>Run it your way.</h2>
{PRICING}
</section>
</main>
""" + footer()

def page_b():
    return head("Zenod: give your agents a library", "style.css",
        "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&display=swap") + nav() + f"""
<main id="top">
<section class="hero">
<img class="hero-img" src="../img/hero.webp" width="1536" height="1024" alt="Wooden library shelves holding paper scrolls and books in warm window light">
<div class="wrap hero-in">
<h1>Give your agents a library.</h1>
<p class="lead">Zenod keeps your memory in Markdown that you own, and hands each agent the context it needs.</p>
<p class="actions"><a class="btn btn-primary" href="{SITE}/pricing">Try Zenod free</a> <a class="btn" href="{GH}">Star on GitHub</a></p>
</div>
</section>

<section class="sec wrap" id="capture">
<h2>Talk. Zenod files.</h2>
<p>Send a voice note on WhatsApp. Zenod keeps the recording and transcript, sorts what you said into projects, people and preferences, and links it all back to the original.</p>
{diagram_capture()}
<p class="fine">WhatsApp comes with Hosted. Self-hosted uses Telegram.</p>
</section>

<figure class="full"><img src="../img/hall.webp" width="1536" height="1024" loading="lazy" alt="A quiet library hall with tall arches and a reader at a long table"></figure>

<section class="sec wrap" id="ask">
<h2>Ask later. Get the source.</h2>
<p>“What did I say about the light in that flat?” Zenod finds the thought and plays you the voice note behind it. Summaries stay tied to the evidence they came from.</p>
</section>

<section class="sec wrap" id="agents">
<h2>One library, any agent.</h2>
<p>Claude, Codex and other MCP clients read from your memory and add to it through Zenod. Change the agent and keep the library.</p>
{diagram_agents()}
<p class="fine">Needs a compatible client and a configured connection. <a href="{SITE}/connect">How to connect</a></p>
</section>

<section class="sec wrap" id="yours">
<h2>Yours, in plain Markdown.</h2>
<p>The library sits in your GitHub repository or, on Hosted, a Google Drive folder. Zenod can maintain it and does not own it. Replace Zenod later and your files and originals stay put. Obsidian opens them as they are.</p>
<p class="fine">Named for Zenodotus, the first librarian of Alexandria. The library was the place. The librarian made it usable.</p>
</section>

<section class="sec wrap" id="start">
<h2>Run it your way.</h2>
{PRICING}
</section>
</main>
""" + footer()

def page_c():
    return head("Zenod: the librarian for your agents", "style.css",
        "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&display=swap") + nav() + f"""
<main id="top">
<section class="stmt hero wrap">
<h1>The librarian for your agents.</h1>
<p class="lead">Zenod keeps one memory, in Markdown you own, and gives every agent the right context.</p>
<p class="actions"><a class="btn btn-primary" href="{SITE}/pricing">Try Zenod free</a> <a class="btn" href="{GH}">Star on GitHub</a></p>
</section>

<section class="stmt wrap" id="capture">
<p class="big">Send a voice note. Zenod keeps the recording and the transcript, sorts it, and links it to the original.</p>
{diagram_capture()}
<p class="fine">WhatsApp comes with Hosted. Self-hosted uses Telegram.</p>
</section>

<section class="stmt wrap" id="ask">
<p class="big">Ask what you said about the light in that flat. Get the thought and the voice note behind it.</p>
</section>

<figure class="full"><img src="../img/threads.webp" width="1536" height="1024" loading="lazy" alt="Many green threads running from wooden pegs to a single brass ring"></figure>

<section class="stmt wrap" id="agents">
<p class="big">Claude, Codex and other MCP clients all read and write through Zenod. Change the agent and keep the memory.</p>
<p class="fine">Needs a compatible client and a configured connection. <a href="{SITE}/connect">How to connect</a></p>
</section>

<section class="stmt wrap" id="yours">
<p class="big">Your files, your account, plain Markdown. Zenod looks after them and never owns them.</p>
<p class="fine">GitHub repository, or on Hosted a Google Drive folder. Obsidian opens the files as they are.</p>
</section>

<section class="stmt wrap" id="start">
<div class="rows">
<div class="row"><div><h3>Self-hosted</h3><p>Your server, your AI provider key, Telegram, a GitHub vault.</p></div><p class="price">Free</p><a class="btn" href="{GH}#readme">Install guide</a></div>
<div class="row"><div><h3>Zenod Hosted</h3><p>Managed AI usage and WhatsApp included. GitHub or Google Drive vault.</p></div><p class="price">€9<small>/month + VAT</small></p><a class="btn btn-primary" href="{SITE}/pricing">See Hosted</a></div>
</div>
<p class="fine">Same open-source engine in both. Named for Zenodotus, the first librarian of Alexandria.</p>
</section>
</main>
""" + footer()

for name, fn in (("a", page_a), ("b", page_b), ("c", page_c)):
    (ROOT / name).mkdir(exist_ok=True)
    (ROOT / name / "index.html").write_text(fn())
print("built")
