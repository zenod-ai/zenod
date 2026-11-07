#!/usr/bin/env python3
"""Builds the EPIC-12 P1 vision deck (one static page). Demo data only."""
import math, sys

OUT = sys.argv[1]

# Demo memory graph: (id, label, x, y, kind) kind: root | page | log
CX, CY = 600, 360
ROOTS = [("work", "Work", -90), ("home", "Home", -18), ("travel", "Travel", 54), ("health", "Health", 126), ("reading", "Reading", 198)]
KIDS = {
    "work": [("atlas", "Project Atlas"), ("hiring", "Hiring a designer"), ("q4", "Q4 plan")],
    "home": [("flat", "The Lisbon flat"), ("boiler", "Boiler service"), ("garden", "Garden ideas")],
    "travel": [("lisbon", "Lisbon trip ideas"), ("visa", "Visa checklist")],
    "health": [("run", "10k running plan"), ("sleep", "Sleep notes")],
    "reading": [("overstory", "The Overstory"), ("habits", "Atomic Habits notes")],
}
LOGS = [("l1", "Voice note, 3 Nov", "flat"), ("l2", "Voice note, 5 Nov", "q4"), ("l3", "Photo of a receipt", "boiler"),
        ("l4", "Link saved, 6 Nov", "overstory"), ("l5", "Voice note, 7 Nov", "lisbon")]
NODES, TREE = [], []
_p = {}
for rid, rl, ang in ROOTS:
    a = math.radians(ang)
    rx, ry = CX + 310 * math.cos(a), CY + 175 * math.sin(a)
    NODES.append((rid, rl, round(rx), round(ry), "root")); _p[rid] = (rx, ry, a)
    kids = KIDS[rid]
    for k, (kid, kl) in enumerate(kids):
        ka = a + math.radians((k - (len(kids) - 1) / 2) * 50)
        kx, ky = rx + 160 * math.cos(ka), ry + 120 * math.sin(ka)
        NODES.append((kid, kl, round(kx), round(ky), "page")); TREE.append((kid, rid)); _p[kid] = (kx, ky, ka)
for lid, ll, par in LOGS:
    px, py, pa = _p[par]
    NODES.append((lid, ll, round(px + 60 * math.cos(pa + 0.9)), round(py + 50 * math.sin(pa + 0.9)), "log")); TREE.append((lid, par))
FIX = {"l3": (1060, 215), "l4": (205, 395), "l1": (870, 130), "l5": (1000, 640), "l2": (790, 160)}
NODES = [(n[0], n[1], *FIX[n[0]], n[4]) if n[0] in FIX else n for n in NODES]
LINKS = [("flat", "lisbon"), ("visa", "flat"), ("habits", "sleep"), ("habits", "run"), ("q4", "hiring"),
         ("l2", "atlas"), ("l3", "flat"), ("overstory", "atlas")]
POS = {n[0]: (n[2], n[3]) for n in NODES}
LABEL = {n[0]: n[1] for n in NODES}
KIND = {n[0]: n[4] for n in NODES}


def graph_svg(lit=None, focus=None, cls="g", vb="0 0 1200 720"):
    lit = lit or {}
    out = [f'<svg class="{cls}" viewBox="{vb}" role="img" aria-label="Demo memory graph">']
    for a, b in TREE:
        (x1, y1), (x2, y2) = POS[a], POS[b]
        on = " on" if (a in lit and (b in lit or KIND[b] == "root")) else ""
        out.append(f'<line class="e-tree{on}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"/>')
    for a, b in LINKS:
        (x1, y1), (x2, y2) = POS[a], POS[b]
        on = " on" if (a in lit and b in lit) else ""
        out.append(f'<line class="e-link{on}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"/>')
    for nid, label, x, y, kind in NODES:
        r = {"root": 20, "page": 11, "log": 6}[kind]
        state = " lit" if nid in lit else (" dim" if lit else "")
        state += " focus" if nid == focus else ""
        out.append(f'<g class="n {kind}{state}">')
        if nid in lit:
            out.append(f'<circle class="halo" cx="{x}" cy="{y}" r="{r + 14}"/>')
        out.append(f'<circle cx="{x}" cy="{y}" r="{r}"/>')
        dy = r + 20
        if kind == "log":
            if nid in lit or not lit:
                anc = "start" if x >= CX else "end"
                out.append(f'<text class="lt" x="{x + (12 if x >= CX else -12)}" y="{y + 5}" text-anchor="{anc}">{label}</text>')
        else:
            out.append(f'<text x="{x}" y="{y + dy}" text-anchor="middle">{label}</text>')
        if nid in lit:
            out.append(f'<text class="pct" x="{x}" y="{y - r - 10}" text-anchor="middle">{lit[nid]}%</text>')
        out.append('</g>')
    out.append('</svg>')
    return "\n".join(out)


LIT = {"flat": 92, "l1": 81, "visa": 74, "lisbon": 63, "l3": 48}
RESULTS = [("flat", "The Lisbon flat", "Home / The Lisbon flat", 92),
           ("l1", "Voice note, 3 Nov", "Log / 3 Nov / landlord call", 81),
           ("visa", "Visa checklist", "Travel / Visa checklist", 74),
           ("lisbon", "Lisbon trip ideas", "Travel / Lisbon trip ideas", 63),
           ("l3", "Photo of a receipt", "Home / Boiler service", 48)]


def results_list(compact=False):
    rows = []
    for i, (nid, title, path, pct) in enumerate(RESULTS, 1):
        rows.append(
            f'<li><span class="rank">{i}</span><span class="rt"><a href="#" tabindex="-1">{title}</a>'
            f'<small>{path}</small></span><span class="bar"><span style="--w:{pct}%"></span></span>'
            f'<span class="p">{pct}%</span></li>')
    return '<ol class="results">' + "".join(rows) + '</ol>'


def digestion_svg():
    steps = [
        (40, "A memory arrives", "WhatsApp, MCP or the app"),
        (300, "Filed in seconds", "placed under its parent; links read"),
        (560, "Index updated", "search sees it at once"),
        (820, "Nightly sweep", "topics re-found, links refreshed, last run shown"),
    ]
    out = ['<svg class="flow" viewBox="0 0 1080 300" role="img" aria-label="How self-digestion runs">']
    for i, (x, t, s) in enumerate(steps):
        focus = " focus" if i == 3 else ""
        out.append(f'<rect class="box{focus}" x="{x}" y="70" width="220" height="130" rx="4"/>')
        out.append(f'<text class="bt{focus.replace("focus","f")}" x="{x + 20}" y="118">{t}</text>')
        # wrap subtitle
        words, line, lines = s.split(), "", []
        for w in words:
            if len(line + " " + w) > 26:
                lines.append(line); line = w
            else:
                line = (line + " " + w).strip()
        lines.append(line)
        for j, ln in enumerate(lines):
            out.append(f'<text class="bs{focus.replace("focus","f")}" x="{x + 20}" y="{150 + j * 24}">{ln}</text>')
        if i < 3:
            out.append(f'<line class="arrow" x1="{x + 224}" y1="135" x2="{x + 256}" y2="135" marker-end="url(#ah)"/>')
    out.append('<path class="loop" d="M 930 200 C 930 270, 410 270, 410 204" marker-end="url(#ah)"/>')
    out.append('<text class="bs" x="560" y="290" text-anchor="middle">each night the sweep re-reads what was filed that day</text>')
    out.append('<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="ahp" d="M0 0 L10 5 L0 10 z"/></marker></defs>')
    out.append('</svg>')
    return "\n".join(out)


HTML = open(sys.argv[2]).read()
HTML = (HTML.replace("{{GRAPH}}", graph_svg(focus="flat"))
        .replace("{{GRAPH_LIT}}", graph_svg(lit=LIT, cls="g lit-graph", vb="440 75 760 635"))
        .replace("{{RESULTS}}", results_list())
        .replace("{{FLOW}}", digestion_svg()))
open(OUT, "w").write(HTML)
print("wrote", OUT, len(HTML))
