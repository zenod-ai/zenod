#!/usr/bin/env python3
"""Analyse landing feedback: where Zenod put each memory vs. what the user said (EPIC-12 S6).

Reads an append-only JSONL dataset (one record per answer; later records for the
same memory win) and prints a short report: how many placements were right, wrong
or unsure, the failure modes the corrections point to, and the top 3 fixes.

Record shape (one JSON object per line):
  {"ts": ISO UTC, "type": "answer", "round": int, "note_id": str, "memory_id": str,
   "memories": [str], "zenod_page": str, "zenod_parent": str|null, "written": bool,
   "verdict": "yes"|"no"|"unsure"|null, "correction": str}
Records of any other "type" (e.g. "submit") are ignored.

Usage: analyse-landing-feedback.py DATASET.jsonl [--json] [--round N ...]
No private data lives in the repo; the dataset path is given at run time.
"""
import argparse, json, re, sys
from collections import Counter

# Failure modes, in tie-break order. Each: (id, label, correction patterns, fix).
MODES = [
    ('never_written', 'Understood but never written',
     r'never written|not written|missing|isn.t there|not there|lost',
     'Never stop half way: when polishing fails, write the fact statement as a dated line on the chosen page and polish later.'),
    ('mixed_topics', 'Unrelated topics share one page or branch',
     r'separate|unrelated|nothing to do|different things|totally different|mixed|lumped|one branch|together|same branch|in one',
     'Split pages that bundle unrelated topics into their own pages and re-parent their children.'),
    ('wrong_parent', 'The page hangs under the wrong parent',
     r'parent',
     'Check a page\'s parent against the top-level topics before attaching it, and move pages whose parent does not match.'),
    ('needs_own_page', 'Should be a new topic of its own',
     r'own page|new page|new topic|its own|own topic|own branch',
     'Park a new topic as a loose page until it has a clear home, instead of forcing it under the nearest match.'),
    ('duplicate', 'Duplicate or repeated memory',
     r'duplicat|twice|repeat|same as|already (there|exists|have)',
     'Merge overlapping parts of a note into one memory and check the page for the same point before writing.'),
    ('wrong_branch', 'Wrong branch (a better home exists)',
     r'should (go|be)|belongs?|move (it )?to|under |goes in|put it in|rather in',
     'Choose the branch from the memory\'s own meaning, not from words it shares with nearby pages.'),
]
UNSPECIFIED = ('wrong_unspecified', 'Wrong, no reason given', None,
               'Ask one short follow-up ("where should it go?") on every No so wrong placements carry a reason.')
ORDER = {m[0]: i for i, m in enumerate(MODES + [UNSPECIFIED])}
INFO = {m[0]: m for m in MODES + [UNSPECIFIED]}


def load(path, rounds=None):
    latest = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get('type', 'answer') != 'answer' or not r.get('memory_id'):
                continue
            if rounds and r.get('round') not in rounds:
                continue
            k = r['memory_id']
            if k not in latest or str(r.get('ts', '')) >= str(latest[k].get('ts', '')):
                latest[k] = r
    return [r for r in latest.values() if r.get('verdict') in ('yes', 'no', 'unsure')]


def modes_of(r):
    text = (r.get('correction') or '').lower()
    found = [m[0] for m in MODES if text and re.search(m[2], text)]
    if r.get('written') is False and 'never_written' not in found:
        found.insert(0, 'never_written')
    if not found and r.get('verdict') == 'no':
        found = [UNSPECIFIED[0]]
    return found


def analyse(records):
    verdicts = Counter(r['verdict'] for r in records)
    modes, examples = Counter(), {}
    for r in records:
        if r['verdict'] == 'yes':
            continue
        for m in modes_of(r):
            if r['verdict'] == 'unsure' and m == UNSPECIFIED[0]:
                continue
            modes[m] += 1
            examples.setdefault(m, []).append({
                'memory_id': r['memory_id'], 'page': r.get('zenod_page'), 'parent': r.get('zenod_parent'),
                'verdict': r['verdict'], 'correction': r.get('correction') or ''})
    ranked = sorted(modes, key=lambda m: (-modes[m], ORDER[m]))
    return {
        'answered': len(records),
        'right': verdicts['yes'], 'wrong': verdicts['no'], 'unsure': verdicts['unsure'],
        'corrections': sum(1 for r in records if (r.get('correction') or '').strip()),
        'rounds': sorted({r.get('round') for r in records if r.get('round') is not None}),
        'failure_modes': [{'id': m, 'label': INFO[m][1], 'count': modes[m], 'examples': examples[m]} for m in ranked],
        'top_fixes': [{'mode': m, 'fix': INFO[m][3], 'count': modes[m]} for m in ranked[:3]],
    }


def text_report(a):
    if not a['answered']:
        return 'No answers yet.'
    out = [f"{a['answered']} placements judged (rounds {', '.join(map(str, a['rounds'])) or '-'}): "
           f"{a['right']} right, {a['wrong']} wrong, {a['unsure']} unsure; {a['corrections']} with a correction.", '']
    out.append('Failure modes:' if a['failure_modes'] else 'Failure modes: none found.')
    for m in a['failure_modes']:
        out.append(f"- {m['label']}: {m['count']}")
        for e in m['examples'][:2]:
            if e['correction']:
                out.append(f"    \"{e['correction'][:160]}\" ({e['page']})")
    if a['top_fixes']:
        out += ['', 'Top fixes:']
        out += [f"{i}. {f['fix']} ({f['count']})" for i, f in enumerate(a['top_fixes'], 1)]
    return '\n'.join(out)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument('dataset')
    p.add_argument('--json', action='store_true')
    p.add_argument('--round', type=int, action='append', dest='rounds')
    a = p.parse_args(argv)
    res = analyse(load(a.dataset, set(a.rounds) if a.rounds else None))
    print(json.dumps(res, ensure_ascii=False, indent=1) if a.json else text_report(res))


if __name__ == '__main__':
    sys.exit(main())
