#!/usr/bin/env python3
"""EPIC-22 L5: three passes over all of Jordi's voice notes (E22-A6 yes). Reads notes.json, writes only into OUT dir.
Pass 1 Haiku 5.5 per note; pass 2 Sonnet 5.5 batches + one merge; pass 3 Opus 5.5 monthly digests + overall.
Resumable: each call's result is cached in OUT/cache/<key>.json. Hard stop on the budget CAP (USD). Stdlib only."""
import json, os, re, sys, time, threading, urllib.request, concurrent.futures as CF, collections as C
IN, OUT = sys.argv[1], sys.argv[2]; CAP = float(os.environ.get('CAP', '14.5'))
os.makedirs(OUT + '/cache', exist_ok=True)
PRICE = {'claude-haiku-5-5': (0.10, 0.50), 'claude-sonnet-5-5': (2.0, 10.0), 'claude-opus-5-5': (4.0, 20.0)}
lock = threading.Lock(); LEDGER = OUT + '/spend.jsonl'
spent = sum(json.loads(l)['usd'] for l in open(LEDGER)) if os.path.exists(LEDGER) else 0.0

class Budget(Exception): pass

def call(key, model, system, user, effort, max_tokens):
    global spent
    cf = f'{OUT}/cache/{key}.json'
    if os.path.exists(cf): return json.load(open(cf))
    for attempt in range(3):
        with lock:
            if spent >= CAP: raise Budget(f'budget stop at ${spent:.3f}')
        t = time.time()
        if os.environ.get('BACKEND') == 'claude':
            # the team's Claude subscription (seat token in env, empty config dir: no hooks, no tools)
            import subprocess
            env = dict(os.environ, CLAUDE_CODE_MAX_OUTPUT_TOKENS=str(max(max_tokens, 32000)))
            try:
                p = subprocess.run(['claude', '-p', '--model', model, '--output-format', 'json', '--system-prompt', system, '--tools', '',
                                    '--no-session-persistence'], input=user, capture_output=True, text=True, timeout=1500, env=env, cwd=env['CLAUDE_CONFIG_DIR'])
                r = json.loads(p.stdout)
                if r.get('is_error'): raise RuntimeError(str(r.get('result'))[:200])
            except Exception as e:
                print('claude error', key, type(e).__name__, str(e)[:200], file=sys.stderr); time.sleep(10 * (attempt + 1)); continue
            u = r.get('usage') or {}; c = r.get('total_cost_usd') or 0.0
            with lock:
                spent += c
                open(LEDGER, 'a').write(json.dumps(dict(key=key, model=model, backend='claude-seat', inp=u.get('input_tokens', 0) + u.get('cache_read_input_tokens', 0) + u.get('cache_creation_input_tokens', 0),
                                                        out=u.get('output_tokens'), usd=round(c, 6), sec=round(time.time() - t, 1), attempt=attempt)) + '\n')
            m = re.search(r'\{.*\}', r.get('result') or '', re.S)
            try:
                res = json.loads(m.group(0))
            except Exception:
                print('bad json', key, attempt, file=sys.stderr); continue
            json.dump(res, open(cf, 'w'), ensure_ascii=False); return res
        body = dict(model='anthropic/' + model.replace('-5-5', '-5.5'), max_tokens=max_tokens,
                    messages=[{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
                    reasoning={'effort': effort}, usage={'include': True})
        req = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions', data=json.dumps(body).encode(),
                                     headers={'Authorization': 'Bearer ' + os.environ['OPENROUTER_API_KEY'], 'Content-Type': 'application/json'})
        try:
            r = json.load(urllib.request.urlopen(req, timeout=900))
        except Exception as e:
            print('http error', key, type(e).__name__, file=sys.stderr); time.sleep(5 * (attempt + 1)); continue
        u = r.get('usage') or {}; pi, po = PRICE[model]
        c = u.get('cost') or (u.get('prompt_tokens', 0) * pi + u.get('completion_tokens', 0) * po) / 1e6
        with lock:
            spent += c
            open(LEDGER, 'a').write(json.dumps(dict(key=key, model=model, inp=u.get('prompt_tokens'), out=u.get('completion_tokens'),
                                                    usd=round(c, 6), sec=round(time.time() - t, 1), attempt=attempt)) + '\n')
        txt = (r.get('choices') or [{}])[0].get('message', {}).get('content') or ''
        m = re.search(r'\{.*\}', txt, re.S)
        try:
            res = json.loads(m.group(0))
        except Exception:
            print('bad json', key, attempt, file=sys.stderr); continue
        json.dump(res, open(cf, 'w'), ensure_ascii=False); return res
    raise RuntimeError('failed ' + key)

D = json.load(open(IN)); NOTES = D['notes']; IDX = D['index']
log = lambda *a: print(time.strftime('%H:%M:%S'), *a, f'spent ${spent:.3f}', file=sys.stderr, flush=True)

# ---------- pass 1: Haiku, one call per note ----------
P1 = """You read one transcribed voice note from Jordi (a founder who records his thinking by voice; English or Spanish; transcripts have errors like "Zenot" for Zenod). Extract faithfully, nothing invented. Return only JSON:
{"gist":"one plain sentence, what this note is about","items":[{"kind":"fact|decision|idea|ask|feeling|learning","text":"short plain sentence in English","quote":"his exact words, max 20 words"}],"people_projects":["names of projects, products, people"],"language":"en|es"}
Keep %s items, the ones he would want back in a year. Merge repeats."""
def p1(x):
    n = max(3, min(25, x['words'] // 150)); rng = f'1 to {n}' if n <= 3 else f'3 to {n}'
    r = call('p1-' + x['id'], 'claude-haiku-5-5', P1 % rng, f"Date {x['date']}, channel {x['ch']}.\n\nTranscript:\n{x['tr']}", 'low', 6000)
    return x['id'], r
P1R = {}
with CF.ThreadPoolExecutor(8) as ex:
    for i, (k, r) in enumerate(ex.map(p1, NOTES)):
        P1R[k] = r
        if i % 50 == 0: log('p1', i)
log('p1 done', len(P1R), 'items', sum(len(r.get('items', [])) for r in P1R.values()))

# ---------- pass 2: Sonnet, batches of notes in date order, then one merge ----------
P2 = """You get first-pass extractions of several of Jordi's voice notes and the list of pages already in his memory tree. Link across notes. Every item is numbered as <note id>#<n>. Return only JSON:
{"threads":[{"name":"short theme name","notes":["note ids"],"summary":"one sentence: what connects them","home":"best existing page from the list, or NEW: <title>"}],
 "placements":[{"item":"<note id>#<n>","home":"existing page or NEW: <title>"}],
 "duplicates_or_tensions":["one line each: where notes repeat or contradict each other, naming the note ids"]}
Prefer existing pages; propose a NEW page only when three or more items need it. Every item gets exactly one placement. A thread needs two or more notes."""
pages = '\n'.join(IDX)
def compact(ids):
    out = []
    for k in ids:
        x = BY[k]; r = P1R[k]
        out.append(f"## {k} {x['date']} ({x['ch']}): {r.get('gist','')}\n" + '\n'.join(
            f"{k}#{i} [{it.get('kind')}] {it.get('text')}" for i, it in enumerate(r.get('items', []))))
    return '\n'.join(out)
BY = {x['id']: x for x in NOTES}
order = [x['id'] for x in NOTES]
batches, cur, cnt = [], [], 0
for k in order:
    cur.append(k); cnt += len(P1R[k].get('items', []))
    if len(cur) >= 12 or cnt >= 110: batches.append(cur); cur, cnt = [], 0
if cur: batches.append(cur)
def p2(b):
    i, ids = b
    return call(f'p2-b{i:03d}', 'claude-sonnet-5-5', P2, f"Existing pages:\n{pages}\n\nNotes:\n{compact(ids)}", 'low', 16000)
with CF.ThreadPoolExecutor(6) as ex: P2R = list(ex.map(p2, enumerate(batches)))
log('p2 batches done', len(batches))
local = []
for i, r in enumerate(P2R):
    for j, t in enumerate(r.get('threads', [])): local.append(dict(lid=f'b{i}t{j}', **t))
PM = """You get local themes found in batches of Jordi's voice notes, recorded from June to November 2026, in date order. The same theme shows up in many batches under different names. Merge them into the threads that run through his thinking over time. Return only JSON:
{"threads":[{"name":"short theme name","summary":"one or two sentences: what this thread is about","home":"best existing page, or NEW: <title>","members":["local theme ids"]}]}
Make 15 to 40 threads. Every local theme id goes into exactly one thread; put leftovers that fit nowhere into one thread named "Other"."""
lt = '\n'.join(f"{t['lid']} | {', '.join(BY[n]['date'] for n in t.get('notes', []) if n in BY)[:40]} | {t.get('name')} — {t.get('summary')} | home: {t.get('home')}" for t in local)
M = call('p2-merge', 'claude-sonnet-5-5', PM, f"Existing pages:\n{pages}\n\nLocal themes:\n{lt}", 'medium', 24000)
lmap = {t['lid']: t for t in local}; threads = []
for t in M.get('threads', []):
    ns = sorted({n for lid in t.get('members', []) if lid in lmap for n in lmap[lid].get('notes', []) if n in BY}, key=lambda n: BY[n]['date'])
    threads.append(dict(name=t['name'], summary=t.get('summary'), home=t.get('home'), notes=ns,
                        first=BY[ns[0]]['date'] if ns else None, last=BY[ns[-1]]['date'] if ns else None))
threads.sort(key=lambda t: -len(t['notes']))
placements = [p for r in P2R for p in r.get('placements', [])]
tensions = [s for r in P2R for s in r.get('duplicates_or_tensions', [])]
json.dump(dict(threads=threads, placements=placements, tensions=tensions, local=local), open(OUT + '/pass2.json', 'w'), ensure_ascii=False, indent=1)
log('p2 merged threads', len(threads), 'placements', len(placements))

# ---------- pass 3: Opus, a digest per month (each reads the one before), then one over everything ----------
tl = '\n'.join(f"T{i} {t['name']} ({len(t['notes'])} notes, {t['first']} to {t['last']}): {t['summary']}" for i, t in enumerate(threads))
nthread = C.defaultdict(list)
for i, t in enumerate(threads):
    for n in t['notes']: nthread[n].append(f'T{i}')
P3M = """You get one month of Jordi's voice notes as extracted items (with the threads each note belongs to), the list of threads across all his notes, and your digest of the month before. Write the month's digest: what happened in his thinking, what he decided, what changed compared with before, what is still open at the month's end. Plain words, no hype, nothing invented; name note ids for every claim. Return only JSON:
{"month":"YYYY-MM","headline":"one sentence","what_happened":["3 to 8 lines"],"decisions":[{"text":"...","notes":["ids"]}],"changed":[{"text":"what moved compared with earlier months","notes":["ids"]}],"open_at_month_end":["one line each"],"threads_active":["T ids"]}"""
months = sorted({x['date'][:7] for x in NOTES}); digests = []; prev = 'none (this is the first month)'
for mo in months:
    ids = [x['id'] for x in NOTES if x['date'][:7] == mo]
    body = '\n'.join(compact([k]) + (f"\n  threads: {' '.join(nthread[k])}" if nthread[k] else '') for k in ids)
    dg = call(f'p3-{mo}', 'claude-opus-5-5', P3M, f"Month {mo}, {len(ids)} notes.\n\nThreads:\n{tl}\n\nDigest of the month before:\n{prev}\n\nNotes:\n{body}", 'medium', 16000)
    dg['month'] = mo; dg['notes'] = len(ids); digests.append(dg); prev = json.dumps(dg, ensure_ascii=False)
    log('p3 month', mo, len(ids))
P3 = """You get Jordi's monthly digests from June to November 2026 and the threads that run through all his voice notes, with their date spans. Write what only shows up over time. Plain words, no hype, nothing invented. Return only JSON:
{"insights":[{"title":"short","text":"two sentences max","threads":["T ids"],"months":["YYYY-MM"]}],
 "thread_arcs":[{"thread":"T id","arc":"one or two sentences: how this thread moved from its first note to its last"}],
 "still_open":["one line each: loops he opened and has not closed, newest first"],
 "held":["decisions that held across months, one line each"],"changed_mind":["places he changed his mind, one line each"],
 "compounding":"three sentences: what the joined-up memory can tell him now that no single note could"}
6 to 10 insights; an arc for the 12 biggest threads."""
O = call('p3-overall', 'claude-opus-5-5', P3, f"Threads:\n{tl}\n\nMonthly digests:\n{json.dumps(digests, ensure_ascii=False)}", 'medium', 16000)
json.dump(dict(digests=digests, overall=O), open(OUT + '/pass3.json', 'w'), ensure_ascii=False, indent=1)
json.dump(P1R, open(OUT + '/pass1.json', 'w'), ensure_ascii=False)
log('ALL DONE notes', len(P1R))
print(json.dumps(dict(notes=len(NOTES), p1=len(P1R), threads=len(threads), months=len(digests), spent=round(spent, 4))))
