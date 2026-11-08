# E18-W1 round 2: before/after bars, small multiples (one scale per panel), direct labels.
import sys, base64, os
FONTS = sys.argv[1]
def font(name):
    return base64.b64encode(open(os.path.join(FONTS, name + ".ttf"), "rb").read()).decode()
BG, INK, MUTED, LINE, BEFORE, AFTER = "#f6f2e9", "#18211c", "#4a554e", "#d9d2c3", "#8d948c", "#1f4d3a"
panels = [
  ("His 45 real questions: right note in the top 5", 45, 18, 21, "of 45"),
  ("His 45 real questions: right note in the top 8", 45, 23, 26, "of 45"),
  ("31 test questions: shown memories on topic", 110, 95, 95, "of 110"),
  ("Search time, median", 120, 113, 89, "ms"),
]
W, H = 1600, 900
pw, ph, top = 330, 440, 300
gap = (W - 160 - 4 * pw) / 3
svg = []
for i, (title, mx, b, a, unit) in enumerate(panels):
    x0 = 80 + i * (pw + gap)
    base = top + ph
    svg.append(f'<foreignObject x="{x0}" y="{top-80}" width="{pw}" height="80"><div class="pt">{title}</div></foreignObject>')
    svg.append(f'<line x1="{x0}" x2="{x0+pw}" y1="{base}" y2="{base}" stroke="{LINE}" stroke-width="1.5"/>')
    bw = 110
    for j, (v, c, lab) in enumerate([(b, BEFORE, "before"), (a, AFTER, "after")]):
        bx = x0 + 40 + j * (bw + 30)
        h = (v / mx) * (ph - 60)
        svg.append(f'<path d="M{bx},{base} V{base-h+4} q0,-4 4,-4 H{bx+bw-4} q4,0 4,4 V{base} Z" fill="{c}"><title>{lab}: {v} {unit}</title></path>')
        svg.append(f'<text x="{bx+bw/2}" y="{base-h-14}" text-anchor="middle" class="v">{v}<tspan class="u"> {unit}</tspan></text>')
        svg.append(f'<text x="{bx+bw/2}" y="{base+34}" text-anchor="middle" class="l">{lab}</text>')
html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: News; src: url(data:font/ttf;base64,{font("newsreader-400")}); }}
@font-face {{ font-family: Inst; font-weight: 400; src: url(data:font/ttf;base64,{font("instrument-sans-400")}); }}
@font-face {{ font-family: Inst; font-weight: 600; src: url(data:font/ttf;base64,{font("instrument-sans-600")}); }}
html,body {{ margin:0; background:{BG}; }}
.wrap {{ width:{W}px; height:{H}px; position:relative; font-family: Inst, sans-serif; color:{INK}; }}
h1 {{ position:absolute; left:80px; top:44px; margin:0; font: 400 64px/1.1 News, serif; letter-spacing:-0.01em; }}
p.sub {{ position:absolute; left:80px; top:130px; margin:0; font: 400 26px Inst, sans-serif; color:{MUTED}; }}
.pt {{ font: 600 22px/1.25 Inst, sans-serif; color:{INK}; }}
.v {{ font: 600 34px Inst, sans-serif; fill:{INK}; }} .u {{ font-size:18px; fill:{MUTED}; font-weight:400; }}
.l {{ font: 400 20px Inst, sans-serif; fill:{MUTED}; }}
.foot {{ position:absolute; left:80px; bottom:36px; font: 400 18px Inst, sans-serif; color:{MUTED}; }}
</style></head><body><div class="wrap">
<h1>Better: the right note shows up more often</h1>
<p class="sub">Grey is before, green is with strong-link retrieval. Nothing got worse, and search got faster.</p>
<svg width="{W}" height="{H}" style="position:absolute;left:0;top:0">{"".join(svg)}</svg>
<div class="foot">Measured on a private copy of Jordi's notes and on 31 made-up test questions, no AI model involved. 8 Nov 2026.</div>
</div></body></html>'''
open(sys.argv[2], "w").write(html)
