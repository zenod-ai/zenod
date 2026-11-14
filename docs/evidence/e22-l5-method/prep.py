#!/usr/bin/env python3
"""EPIC-22 L4 iteration 2: rebuild Jordi's voice-notes chart page from his vault, every day (zenod-e22-l4-refresh.timer).
Private: reads obsidian-brain (a read-only clone beside this file), writes only the page folder. Stdlib only."""
import collections as C, datetime as D, hashlib, json, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.expanduser('~/github/agent_team/scripts'))


V = os.path.join(HERE, 'vault'); OUT = '/var/lib/vps3-scratch/t3agent/pages/e22-l4-chart/index.html'
WPM = 131.4; PROPOSAL = 'http://vps3.taild81fbb.ts.net:9005/'
git = lambda *a: subprocess.run(['git', '-C', V, *a], check=True, capture_output=True, text=True).stdout.strip()
git('fetch', '-q', 'origin', 'main'); git('reset', '-q', '--hard', 'origin/main')
SHA = git('log', '-1', '--format=%h'); NOW = D.datetime.now(D.timezone.utc); TODAY = NOW.date()

# 1. parse every Log entry that is a voice note
out = []
for f in sorted(os.listdir(os.path.join(V, 'Log'))):
    if not re.fullmatch(r'2.*\.md', f): continue
    day = f[:-3]; txt = open(os.path.join(V, 'Log', f), errors='ignore').read()
    for p in re.split(r'\n(?=## )', txt):
        if not p.startswith('## '): continue
        head = p.split('\n', 1)[0]; m = re.search(r'\^(e-[0-9a-f]+)', head)
        meta = dict(re.findall(r'^- ([a-z-]+): (.*)$', p, re.M)); ct = meta.get('content-type', '')
        if not (ct in ('voice_note', 'audio') or 'voice note' in head.lower() or 'transcri' in p[:3000].lower()): continue
        quote = '\n'.join(l[2:] if l.startswith('> ') else l[1:] for l in p.split('\n') if l.startswith('>'))
        hk = ('Voice note', 'Raw artifact', 'Media type', 'Source', 'Transcribed by', 'Extraction artifact', 'User context', 'Audio', 'Duration')
        tr = ' '.join(l for l in quote.split('\n') if l.strip() and not any(l.startswith(k) for k in hk))
        filed = re.findall(r'^- filed: \[\[([^\]]+)\]\] \(([^)]*)\)(.*)$', p, re.M)
        out.append(dict(day=day, id=m.group(1) if m else None, head=head[3:90], ct=ct, src=meta.get('source'), cap=meta.get('captured-at'),
            words=len(tr.split()), transcriber=(re.search(r'Transcribed by ([^\n]+?)\.?\n', p) or [None, None])[1],
            drive=(re.search(r'drive\.google\.com/file/d/([\w-]+)', p) or [None, None])[1],
            filed=[dict(page=a, path=b, rest=c.strip()) for a, b, c in filed], tr=tr))

# 2. keep real voice notes, the same audio once, and name the channel
def is_voice(x):
    if x['ct'] in ('voice_note', 'audio'): return True
    if x['ct'] in ('text', 'image'): return False
    return bool(re.search(r'voice note "|ptt from|voice note transcript|voice-note transcript|voice memo', x['head'].lower()))
seen = {}; d = []
for x in filter(is_voice, out):
    k = x['drive'] or hashlib.md5(' '.join(x['tr'].split()[:60]).encode()).hexdigest()
    if x['words'] < 3: k = x['id']
    if k in seen: seen[k]['filed'] += [f for f in x['filed'] if f not in seen[k]['filed']]; continue
    seen[k] = x; d.append(x)
for x in d:
    tb = x['transcriber'] or ''; h = x['head'].lower()
    x['ch'] = ('EpicTeam card answer' if 'card answer' in tb else 'EpicTeam chat' if 'EpicTeam Chat' in tb else 'EpicSocial chat' if 'EpicSocial' in tb
        else 'WhatsApp' if x['src'] == 'whatsapp' or 'whatsapp' in h else 'Drive upload' if x['src'] == 'drive' else 'Telegram' if 'telegram' in h else 'other')
    ts = x['cap'] or (x['day'] + 'T' + x['head'][:5] + ':00Z')
    if 'epicteam call' in h: x['ch'] = 'EpicTeam desk call'
    if x['ch'] == 'other': x['ch'] = 'Early transcripts' if x['day'] < '2026-08' else 'Other'
    mm = re.search(r'(2026-\d\d-\d\d)', x['head']) if 'call' in h and not x['cap'] else None
    if mm: ts = mm.group(1) + 'T00:00:00Z'
    x['date'] = ts[:10]; x['min'] = x['words'] / WPM
START = str(TODAY - D.timedelta(days=184))
d = [x for x in d if x['words'] >= 3 and START <= x['date'] <= str(TODAY)]
d.sort(key=lambda x: x['date'])

# 3. the pages each note became: a page that cites its ^e- id, or the page its filed: line names
ids = {x['id'] for x in d}; ref = C.defaultdict(set)
for root in ['Notes', 'Projects', 'Areas', 'Personas', 'Inbox', 'Archive']:
    for dp, _, fs in os.walk(os.path.join(V, root)):
        for f in fs:
            if not f.endswith('.md'): continue
            p = os.path.join(dp, f); rel = os.path.relpath(p, V)[:-3]
            for k in set(re.findall(r'e-[0-9a-f]{6}', open(p, errors='ignore').read())):
                if k in ids: ref[k].add(rel)
for x in d: x['pages'] = sorted(ref.get(x['id'], set()) | {f['page'] for f in x['filed']})
live = lambda p: not p.startswith(('Archive/', 'Inbox/'))

idx=sorted({os.path.relpath(os.path.join(dp,f),V)[:-3] for root in ['Projects','Areas'] for dp,_,fs in os.walk(os.path.join(V,root)) for f in fs if f.endswith('.md')})
for x in d: x['pages_live']=[p for p in x['pages'] if live(p)]
json.dump(dict(vault=SHA,built=NOW.isoformat(),notes=d,index=idx),open(os.path.join(sys.argv[1],'notes.json'),'w'),ensure_ascii=False)
print(len(d),'notes',sum(x['words'] for x in d),'words',len(idx),'index pages',SHA)
