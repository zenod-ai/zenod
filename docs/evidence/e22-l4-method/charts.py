import html
A='#1f4d3a'; INK='#18211c'; MUT='#4a554e'; LINE='#c9c1ae'; SOFT='#cfe0d4'
def esc(s): return html.escape(str(s))
def vbars(data,fmt,label_every=1,h=200,w=760,unit='',title='',xlab=None):
    # data: list of (label, value, tooltip)
    n=len(data); pl,pr,pt,pb=36,8,12,34
    mx=max(v for _,v,_ in data) or 1
    bw=(w-pl-pr)/n; g=2
    out=[f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="{esc(title)}" class="chart" preserveAspectRatio="xMidYMid meet">']
    for t in (0.5,1.0):
        y=pt+(h-pt-pb)*(1-t); out.append(f'<line x1="{pl}" x2="{w-pr}" y1="{y:.1f}" y2="{y:.1f}" stroke="{LINE}" stroke-width="1" stroke-dasharray="2 3"/><text x="{pl-6}" y="{y+4:.1f}" text-anchor="end" font-size="11" fill="{MUT}">{fmt(mx*t)}</text>')
    base=h-pb
    out.append(f'<line x1="{pl}" x2="{w-pr}" y1="{base}" y2="{base}" stroke="{MUT}" stroke-width="1"/>')
    for i,(lab,v,tip) in enumerate(data):
        x=pl+i*bw; bh=(h-pt-pb)*v/mx
        out.append(f'<g class="bar"><title>{esc(tip)}</title><rect x="{x:.1f}" y="{pt}" width="{bw:.1f}" height="{h-pt-pb}" fill="transparent"/>')
        if v>0:
            r=min(4,bw/2-g,bh)
            out.append(f'<path d="M{x+g/2:.1f},{base} V{base-bh+r:.1f} Q{x+g/2:.1f},{base-bh:.1f} {x+g/2+r:.1f},{base-bh:.1f} H{x+bw-g/2-r:.1f} Q{x+bw-g/2:.1f},{base-bh:.1f} {x+bw-g/2:.1f},{base-bh+r:.1f} V{base} Z" fill="{A}"/>')
        out.append('</g>')
        if lab and i%label_every==0: out.append(f'<text x="{x+bw/2:.1f}" y="{base+16}" text-anchor="middle" font-size="11" fill="{MUT}">{esc(lab)}</text>')
    out.append('</svg>'); return ''.join(out)
def hbars(data,fmt,w=760,rowh=30,lw=210,title=''):
    mx=max(v for _,v,_ in data) or 1; h=rowh*len(data)+6
    out=[f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="{esc(title)}" class="chart">']
    for i,(lab,v,tip) in enumerate(data):
        y=i*rowh+4; bl=(w-lw-90)*v/mx
        out.append(f'<g class="bar"><title>{esc(tip)}</title><rect x="0" y="{y}" width="{w}" height="{rowh-2}" fill="transparent"/>')
        out.append(f'<text x="{lw-10}" y="{y+rowh/2+4}" text-anchor="end" font-size="13" fill="{INK}">{esc(lab)}</text>')
        out.append(f'<rect x="{lw}" y="{y+5}" width="{max(bl,1.5):.1f}" height="{rowh-12}" rx="3" fill="{A}"/>')
        out.append(f'<text x="{lw+bl+8:.1f}" y="{y+rowh/2+4}" font-size="12" fill="{MUT}">{esc(fmt(v))}</text></g>')
    out.append('</svg>'); return ''.join(out)
def table(head,rows):
    t='<details class="tv"><summary>Show as a table</summary><table><tr>'+''.join(f'<th>{esc(h)}</th>' for h in head)+'</tr>'
    for r in rows: t+='<tr>'+''.join(f'<td>{esc(c)}</td>' for c in r)+'</tr>'
    return t+'</table></details>'
CSS=f'''<style>
.chart{{width:100%;height:auto;display:block;margin:.4rem 0 .2rem}}
.chart .bar:hover path,.chart .bar:hover rect[rx]{{fill:#2f6e54}}
.tiles{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.7rem;margin:1rem 0}}
.tile{{border:1px solid {LINE};border-radius:6px;padding:.7rem .9rem;background:#fbf8f1}}
.tile b{{display:block;font-family:var(--serif);font-size:2rem;line-height:1.1;color:{INK}}}
.tile span{{font-size:.85rem;color:{MUT}}}
.tv summary{{cursor:pointer;color:{MUT};font-size:.85rem}} .tv table{{border-collapse:collapse;font-size:.85rem;margin:.4rem 0}} .tv td,.tv th{{border-bottom:1px solid {LINE};padding:.2rem .6rem;text-align:left}}
.note{{font-size:.85rem;color:{MUT}}}
.split{{display:flex;height:34px;border-radius:5px;overflow:hidden;margin:.5rem 0;gap:2px}}
.split div{{display:flex;align-items:center;padding:0 .6rem;font-size:.82rem;white-space:nowrap;overflow:hidden}}
.ex{{display:grid;grid-template-columns:1.2fr .8fr;gap:1rem;align-items:start}} @media(max-width:700px){{.ex{{grid-template-columns:1fr}}}}
.ex blockquote{{margin:0;padding:.7rem .9rem;border-left:3px solid {A};background:#fbf8f1;font-size:.92rem}}
.ex ul{{margin:0;padding-left:1.1rem}} .ex li{{margin:.25rem 0}}
.pill{{font-size:.72rem;border:1px solid {LINE};border-radius:9px;padding:0 .4rem;color:{MUT};margin-left:.3rem}}
</style>'''
