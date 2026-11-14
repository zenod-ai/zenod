#!/usr/bin/env python3
"""EPIC-22 L5: build the tailnet page from the three-pass output. Private (quotes his notes). Writes only PAGE dir."""
import collections as C, json, os, subprocess, sys
from html import escape as esc
O = os.path.dirname(os.path.abspath(__file__)); PAGE = '/var/lib/vps3-scratch/t3agent/pages/e22-l5-threepass'
os.makedirs(PAGE, exist_ok=True)
N = json.load(open(f'{O}/notes.json')); NOTES = N['notes']; BY = {x['id']: x for x in NOTES}
P1 = json.load(open(f'{O}/out/pass1.json')); P2 = json.load(open(f'{O}/out/pass2.json')); P3 = json.load(open(f'{O}/out/pass3.json'))
SP = [json.loads(l) for l in open(f'{O}/out/spend.jsonl')]
T = P2['threads']; DG = P3['digests']; OV = P3['overall']
cost = lambda pfx: sum(s['usd'] for s in SP if s['key'].startswith(pfx))
TOTAL = sum(s['usd'] for s in SP); PAID = sum(s['usd'] for s in SP if s.get('backend') != 'claude-seat'); SAMPLE = 0.197
items = sum(len(r.get('items', [])) for r in P1.values())
kinds = C.Counter(it.get('kind') for r in P1.values() for it in r.get('items', []))
pl = P2['placements']; newp = C.Counter(p['home'] for p in pl if str(p.get('home', '')).startswith('NEW'))
onexisting = sum(1 for p in pl if not str(p.get('home', '')).startswith('NEW'))
real = [t for t in T if t['name'] != 'Other' and len(t['notes']) >= 2]
multi = [t for t in real if t['first'] and t['last'] and t['first'][:7] != t['last'][:7]]
before_links = sum(len(x['pages_live']) for x in NOTES)
mon = lambda m: __import__('datetime').date.fromisoformat(m + '-01').strftime('%B')
nthreads = C.defaultdict(list)
for i, t in enumerate(T):
    for n in t['notes']: nthreads[n].append(i)
STATS = dict(vault=N['vault'], notes=len(NOTES), p1=len(P1), words=sum(x['words'] for x in NOTES), items=items, kinds=dict(kinds),
             threads=len(real), threads_across_months=len(multi), months=len(DG), placements=len(pl), on_existing=onexisting,
             new_pages_proposed=len(newp), insights=len(OV.get('insights', [])), still_open=len(OV.get('still_open', [])),
             tensions=len(P2['tensions']), before_links=before_links, cost_total=round(TOTAL, 3), paid_openrouter=round(PAID, 3),
             cost_p1=round(cost('p1'), 3), cost_p2=round(cost('p2'), 3), cost_p3=round(cost('p3'), 3), calls=len(SP),
             biggest_thread=dict(name=real[0]['name'], notes=len(real[0]['notes']), first=real[0]['first'], last=real[0]['last']) if real else None,
             per_month={d['month']: d['notes'] for d in DG})
json.dump(STATS, open(f'{O}/stats.json', 'w'), indent=1)

# ---- diagram: the three passes, what each added ----
W, H = 1200, 360; G = '#1f4d3a'; INK = '#18211c'; PAP = '#f6f2e9'; MUT = '#e9e3d5'
def box(x, w, title, model, lines, fill, fg):
    s = f'<rect x="{x}" y="70" width="{w}" height="230" rx="10" fill="{fill}" stroke="{INK}" stroke-width="1.5"/>'
    s += f'<text x="{x+18}" y="108" font-family="Newsreader,Georgia,serif" font-size="26" fill="{fg}">{esc(title)}</text>'
    s += f'<text x="{x+18}" y="134" font-family="Instrument Sans,Arial,sans-serif" font-size="15" fill="{fg}" opacity=".8">{esc(model)}</text>'
    for i, l in enumerate(lines):
        s += f'<text x="{x+18}" y="{172+i*30}" font-family="Instrument Sans,Arial,sans-serif" font-size="18" fill="{fg}">{esc(l)}</text>'
    return s
def arrow(x1, x2): return f'<line x1="{x1}" y1="185" x2="{x2-8}" y2="185" stroke="{INK}" stroke-width="2"/><polygon points="{x2},185 {x2-12},179 {x2-12},191" fill="{INK}"/>'
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}"><rect width="{W}" height="{H}" fill="{PAP}"/>'
svg += f'<text x="20" y="40" font-family="Instrument Sans,Arial,sans-serif" font-size="18" fill="{INK}">Your words stay as they are. Each pass reads the one before it.</text>'
svg += box(10, 190, 'Your voice', 'the raw notes', [f'{len(NOTES)} notes', f'{STATS["words"]//1000}k words', f'June to November'], MUT, INK)
svg += arrow(200, 240)
svg += box(240, 290, '1 · Pull out', 'Haiku 5.5, one call a note', [f'{items:,} facts, decisions,', 'ideas, each with your quote', f'${STATS["cost_p1"]:.2f}'], PAP, INK)
svg += arrow(530, 570)
svg += box(570, 290, '2 · Join up', 'Sonnet 5.5, batches + merge', [f'{len(real)} threads across notes', f'{onexisting:,} of {len(pl):,} points on', f'pages you have · ${STATS["cost_p2"]:.2f}'], PAP, INK)
svg += arrow(860, 900)
svg += box(900, 290, '3 · Over time', 'Opus 5.5, month by month', [f'{len(DG)} monthly digests', f'{STATS["insights"]} insights, {STATS["still_open"]} open loops', f'${STATS["cost_p3"]:.2f}'], G, PAP)
svg += f'<text x="20" y="340" font-family="Instrument Sans,Arial,sans-serif" font-size="16" fill="{INK}">Total ${TOTAL:.2f} for all {len(NOTES)} notes, under the $15 stop. Written beside your memory, nothing written into it.</text></svg>'
open(f'{PAGE}/passes.svg', 'w').write(svg)

# ---- before and after of one note ----
def pick():
    c = [x for x in NOTES if 300 <= x['words'] <= 1500 and nthreads[x['id']] and len(P1[x['id']].get('items', [])) >= 5]
    c.sort(key=lambda x: (-max(len(T[i]['notes']) for i in nthreads[x['id']]), x['date']))
    return c[0]
ex = pick(); r1 = P1[ex['id']]
mine = [d for d in DG if any(ex['id'] in json.dumps(d) for _ in [0])]
quote = ' '.join(ex['tr'].split()[:70]) + ' …'
ba = f'''<h2>One note, before and after</h2>
<p>Your note of {esc(ex['date'])} from {esc(ex['ch'])}, about {ex['words']} words. Its opening words: <i>“{esc(quote)}”</i></p>
<div style="display:flex;flex-wrap:wrap;gap:16px"><div style="flex:1 1 300px;min-width:0;border:1px solid #c9c1ae;border-radius:8px;padding:12px 16px"><h3>Before: what your memory holds today</h3>
<p>{len(ex['pages_live'])} page links:</p><ul>{''.join(f'<li>{esc(p)}</li>' for p in ex['pages_live'][:10]) or '<li>none</li>'}</ul>
<p>Mostly your words quoted under a sentence title, not joined to other notes.</p></div><div style="flex:1 1 300px;min-width:0;border:2px solid #1f4d3a;border-radius:8px;padding:12px 16px"><h3>After: the three passes</h3>
<p><b>Pass 1:</b> {esc(r1.get('gist',''))}</p><ul>{''.join(f"<li>[{esc(it.get('kind',''))}] {esc(it.get('text',''))} <i>“{esc(it.get('quote',''))}”</i></li>" for it in r1.get('items', [])[:8])}</ul>
<p><b>Pass 2:</b> part of {', '.join(f"<b>{esc(T[i]['name'])}</b> ({len(T[i]['notes'])} notes, {esc(T[i]['first'])} to {esc(T[i]['last'])})" for i in nthreads[ex['id']])}.</p>
<p><b>Pass 3:</b> {esc(mine[0].get('headline','')) if mine else 'read in the ' + mon(ex['date'][:7]) + ' digest'}</p></div></div>'''

# ---- over time ----
arcs = {a.get('thread'): a.get('arc') for a in OV.get('thread_arcs', [])}
li = lambda xs: ''.join(f'<li>{esc(x)}</li>' for x in xs)
ot = f'''<h2>What only shows up over time</h2><p>{esc(OV.get('compounding',''))}</p>
<ul>{''.join(f"<li><b>{esc(i.get('title',''))}.</b> {esc(i.get('text',''))}</li>" for i in OV.get('insights', []))}</ul>
<details><summary>Still open, newest first ({len(OV.get('still_open', []))})</summary><ul>{li(OV.get('still_open', []))}</ul></details>
<details><summary>Decisions that held ({len(OV.get('held', []))})</summary><ul>{li(OV.get('held', []))}</ul></details>
<details><summary>Where you changed your mind ({len(OV.get('changed_mind', []))})</summary><ul>{li(OV.get('changed_mind', []))}</ul></details>'''

# ---- threads ----
def notes_list(ids):
    return '<ul>' + ''.join(f"<li>{esc(BY[n]['date'])} · {esc(P1[n].get('gist',''))}</li>" for n in ids) + '</ul>'
th = f'<h2>The threads: {len(real)} themes that run through your notes</h2><p>{len(multi)} of them span more than one month. Open one to see its notes in order.</p>'
th += '<table><tr><th>Thread</th><th>Notes</th><th>From</th><th>To</th></tr>' + ''.join(
    f"<tr><td>{esc(t['name'])}</td><td>{len(t['notes'])}</td><td>{esc(t['first'] or '')}</td><td>{esc(t['last'] or '')}</td></tr>" for t in real[:15]) + '</table>'
for i, t in enumerate(T):
    if t not in real: continue
    arc = arcs.get(f'T{i}')
    th += f"<details><summary><b>{esc(t['name'])}</b> · {len(t['notes'])} notes · {esc(t['first'] or '')} to {esc(t['last'] or '')}</summary><p>{esc(t.get('summary') or '')}</p>" \
          + (f'<p><b>How it moved:</b> {esc(arc)}</p>' if arc else '') + f"<p>Home: {esc(str(t.get('home')))}</p>{notes_list(t['notes'])}</details>"

# ---- monthly digests ----
md = '<h2>Month by month</h2><table><tr><th>Month</th><th>Notes</th><th>In one line</th></tr>' + ''.join(
    f"<tr><td>{mon(d['month'])}</td><td>{d['notes']}</td><td>{esc(d.get('headline',''))}</td></tr>" for d in DG) + '</table>'
for d in DG:
    md += f"<details><summary><b>{mon(d['month'])}</b> · {d['notes']} notes · {esc(d.get('headline',''))}</summary>" \
          f"<p><b>What happened</b></p><ul>{li(d.get('what_happened', []))}</ul>" \
          f"<p><b>Decided</b></p><ul>{li(x.get('text','') if isinstance(x, dict) else x for x in d.get('decisions', []))}</ul>" \
          f"<p><b>Changed from before</b></p><ul>{li(x.get('text','') if isinstance(x, dict) else x for x in d.get('changed', []))}</ul>" \
          f"<p><b>Still open at month end</b></p><ul>{li(d.get('open_at_month_end', []))}</ul></details>"

# ---- how it ran ----
hw = f'''<h2>How it ran</h2><table>
<tr><th>Pass</th><th>Model</th><th>What it read</th><th>Cost</th></tr>
<tr><td>1 · Pull out</td><td>Haiku 5.5</td><td>{len(P1)} of {len(NOTES)} notes, one call each</td><td>${STATS['cost_p1']:.2f}</td></tr>
<tr><td>2 · Join up</td><td>Sonnet 5.5</td><td>{items:,} points in date-order batches, then one merge</td><td>${STATS['cost_p2']:.2f}</td></tr>
<tr><td>3 · Over time</td><td>Opus 5.5</td><td>{len(DG)} months, each after the one before, then one overall read</td><td>${STATS['cost_p3']:.2f}</td></tr>
<tr><td><b>Total</b></td><td></td><td>{len(SP)} calls, stop set at $14.50</td><td><b>${TOTAL:.2f}</b></td></tr></table>
<p>Read from your vault at {esc(N['vault'])}: every voice note since June, the same audio once. Written to a folder beside your memory on VPS3. Your vault, your raw words and the tree were not touched. The engine stays frozen until 24 November. Undo: delete that folder. Of the ${TOTAL:.2f}, ${PAID:.2f} was paid on the shared OpenRouter key, which then ran out of credit. The rest, ${TOTAL-PAID:.2f} at list price, ran on the team's Claude subscription at no extra charge. Before, these notes held {before_links:,} links to pages. Pass 2 put {onexisting:,} of {len(pl):,} points on pages you already have and suggests {len(newp)} new pages.</p>'''

body = ba + ot + th + md + hw
open(f'{O}/body.html', 'w').write(body)
punch = f"All {len(NOTES)} of your voice notes, read again in three passes for ${TOTAL:.2f}: {len(real)} threads, {len(multi)} of them running across months, {len(DG)} monthly digests and what is still open."
subprocess.run([sys.executable, os.path.expanduser('~/github/agent_team/scripts/page_shell.py'), 'new', PAGE, '--title', 'Your voice notes, read again in three passes',
                '--punchline', punch, '--row', 'L5', '--diagram', 'passes.svg', '--body', f'{O}/body.html'], check=True)
print(json.dumps(STATS)); print('PUNCH', punch)
