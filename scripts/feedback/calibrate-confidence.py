#!/usr/bin/env python3
"""Calibrate Zenod's filing confidence against the person's Right place / Wrong place answers (EPIC-12 S30).

E12-S27 writes how sure Zenod was of each new filing (0-100, `· 72% sure` on the filed line) as
classifier confidence x a factor for how the page reached the tree (treePlacement.ts PLACEMENT_FACTOR:
in_tree 1, hung 0.85, hung_weak 0.5, leaf 0.3). Every Right place / Wrong place answer in the app is a
correction record in `.brain/tree-corrections.jsonl` in the person's vault (same shape as the S6 landing
feedback, plus `confidence`). This script measures how well the number predicts a wrong place and, when
there are enough answers, tunes the four factors on a training split and checks them on a held-out split.

  - Answers: the standing record per page (an undo removes the answer it undoes; a later answer wins);
    only `verdict` yes / no with a confidence count. Older pages that were "not scored" are skipped.
  - Route: the record's `how` when present, else inferred from the vault: the filed line says
    `provisional` -> hung_weak, or leaf when the page is a provisional leaf (`Filing note:`); otherwise
    hung when the page got its `parent:` on the filing day (git), else in_tree.
  - Measure: wrong-place rate per confidence band, Brier score, log loss, calibration error (ECE) and
    AUC (how often a wrong place had a lower number than a right place).
  - Tune: a grid over the four factors (steps of 0.05, in_tree >= hung >= hung_weak >= leaf), lowest
    log loss on the training split; kept only when it also beats today's factors on the held-out split.

Too few answers (fewer than --min-answers, or fewer than --min-wrong of either verdict) ends with status
`too_few`, the counts and how many more are needed; nothing is tuned. No model call, no network.

Usage: calibrate-confidence.py --vault VAULT [--corrections FILE] [--out DIR] [--json]
       calibrate-confidence.py --demo 80 --out DIR      (made-up answers, to see the report and chart)
Writes DIR/calibration.json and DIR/calibration.svg. No private data lives in the repo; paths are given at run time.
"""
import argparse, glob, itertools, json, math, os, random, re, subprocess, sys

CURRENT = {'in_tree': 1.0, 'hung': 0.85, 'hung_weak': 0.5, 'leaf': 0.3}
ROUTES = list(CURRENT)
BANDS = [(0, 39), (40, 59), (60, 79), (80, 100)]
CORRECTIONS = '.brain/tree-corrections.jsonl'
SURE = re.compile(r'^\s*- filed: \[\[([^\]|#]+)[^\]]*\]\].*· (\d{1,3})% sure\s*$')


def standing(records):
    """The answer that stands per page: undo removes what it undoes, a later answer replaces an earlier one."""
    undone = {r.get('undoes') for r in records if r.get('action') == 'undo'}
    latest = {}
    for r in sorted(records, key=lambda r: r.get('ts', '')):
        if r.get('type', 'answer') != 'answer' or r.get('action') == 'undo' or r.get('id') in undone:
            continue
        if r.get('verdict') not in ('yes', 'no') or not r.get('memory_id'):
            continue
        latest[r['memory_id']] = r
    return list(latest.values())


def read_jsonl(path):
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, encoding='utf8') as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    pass
    return rows


def filed_lines(vault):
    """page path (no .md) -> [(date, confidence, provisional)] from `filed:` lines that carry a confidence."""
    out = {}
    for log in sorted(glob.glob(os.path.join(vault, 'Log', '*.md'))):
        date = os.path.basename(log)[:10]
        with open(log, encoding='utf8') as f:
            for line in f:
                m = SURE.match(line)
                if m:
                    out.setdefault(m.group(1).strip(), []).append((date, int(m.group(2)), '· provisional' in line))
    return out


def got_parent_on(vault, page, date):
    """True when a commit on `date` added a `parent:` line to the page (it was hung on the tree that day)."""
    try:
        log = subprocess.run(['git', '-C', vault, 'log', f'--since={date}T00:00:00Z', f'--until={date}T23:59:59Z',
                              '-p', '--format=tformat:@@commit', '--', page], capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return any(line.startswith('+parent:') for line in log.splitlines())


def infer_route(vault, record, filings):
    if record.get('how') in CURRENT:
        return record['how'], 'recorded'
    page = record['memory_id']
    key = page[:-3] if page.endswith('.md') else page
    before = [f for f in filings.get(key, []) if f[0] <= record.get('ts', '9999')[:10]]
    if not before:
        return 'in_tree', 'guessed'
    date, _, provisional = before[-1]
    if provisional:
        try:
            with open(os.path.join(vault, page if page.endswith('.md') else page + '.md'), encoding='utf8') as f:
                return ('leaf' if 'Filing note:' in f.read() else 'hung_weak'), 'inferred'
        except OSError:
            return 'hung_weak', 'inferred'
    return ('hung' if got_parent_on(vault, page if page.endswith('.md') else page + '.md', date) else 'in_tree'), 'inferred'


def answers_from_vault(vault, corrections=None):
    records = standing(read_jsonl(corrections or os.path.join(vault, CORRECTIONS)))
    filings = filed_lines(vault)
    out = []
    for r in records:
        if not isinstance(r.get('confidence'), (int, float)):
            continue
        route, source = infer_route(vault, r, filings)
        out.append({'confidence': float(r['confidence']), 'wrong': r['verdict'] == 'no', 'how': route, 'route_source': source})
    return out


def demo_answers(n, seed=7):
    """Made-up answers: hung_weak and leaf filings are wrong more often than today's number says."""
    rng = random.Random(seed)
    true_right = {'in_tree': 0.92, 'hung': 0.75, 'hung_weak': 0.6, 'leaf': 0.45}
    weights = {'in_tree': 0.45, 'hung': 0.25, 'hung_weak': 0.2, 'leaf': 0.1}
    out = []
    for _ in range(n):
        how = rng.choices(ROUTES, [weights[r] for r in ROUTES])[0]
        classifier = rng.uniform(0.6, 1.0)
        right = rng.random() < min(0.99, true_right[how] * (0.7 + 0.3 * classifier))
        out.append({'confidence': round(100 * classifier * CURRENT[how]), 'wrong': not right, 'how': how, 'route_source': 'demo'})
    return out


def p_right(a, factors):
    classifier = min(1.0, a['confidence'] / (100.0 * CURRENT[a['how']]))
    return min(0.99, max(0.01, classifier * factors[a['how']]))


def metrics(answers, factors):
    if not answers:
        return {'n': 0}
    ps = [p_right(a, factors) for a in answers]
    ys = [0 if a['wrong'] else 1 for a in answers]
    brier = sum((p - y) ** 2 for p, y in zip(ps, ys)) / len(ys)
    logloss = -sum(math.log(p if y else 1 - p) for p, y in zip(ps, ys)) / len(ys)
    bands = []
    ece = 0.0
    for lo, hi in BANDS:
        idx = [i for i, p in enumerate(ps) if lo <= round(100 * p) <= hi]
        if not idx:
            bands.append({'band': f'{lo}-{hi}', 'n': 0})
            continue
        said = sum(ps[i] for i in idx) / len(idx)
        right = sum(ys[i] for i in idx) / len(idx)
        ece += len(idx) / len(ys) * abs(said - right)
        bands.append({'band': f'{lo}-{hi}', 'n': len(idx), 'said_right': round(100 * said, 1), 'was_right': round(100 * right, 1),
                      'wrong_place_rate': round(100 * (1 - right), 1)})
    wrong = [p for p, y in zip(ps, ys) if not y]
    right = [p for p, y in zip(ps, ys) if y]
    auc = None
    if wrong and right:
        auc = sum(1.0 if w < r else 0.5 if w == r else 0.0 for w in wrong for r in right) / (len(wrong) * len(right))
    return {'n': len(ys), 'wrong': len(wrong), 'brier': round(brier, 4), 'log_loss': round(logloss, 4), 'ece': round(100 * ece, 1),
            'auc': None if auc is None else round(auc, 3), 'bands': bands}


def split(answers, holdout, seed):
    """Stratified by verdict so both halves hold some wrong places."""
    rng = random.Random(seed)
    train, test = [], []
    for verdict in (True, False):
        group = [a for a in answers if a['wrong'] is verdict]
        rng.shuffle(group)
        k = max(1, round(len(group) * holdout)) if len(group) > 1 else 0
        test += group[:k]
        train += group[k:]
    return train, test


def tune(train):
    present = sorted({a['how'] for a in train}, key=ROUTES.index)
    grid = [round(0.05 * i, 2) for i in range(1, 21)]
    best, best_loss = dict(CURRENT), metrics(train, CURRENT)['log_loss']
    for combo in itertools.product(grid, repeat=len(present)):
        factors = dict(CURRENT, **dict(zip(present, combo)))
        if not all(factors[ROUTES[i]] >= factors[ROUTES[i + 1]] for i in range(len(ROUTES) - 1)):
            continue
        loss = metrics(train, factors)['log_loss']
        if loss < best_loss - 1e-9:
            best, best_loss = factors, loss
    return best


def calibrate(answers, min_answers=20, min_wrong=5, holdout=0.3, seed=7):
    wrong = sum(a['wrong'] for a in answers)
    right = len(answers) - wrong
    report = {'answers': len(answers), 'wrong_place': wrong, 'right_place': right, 'min_answers': min_answers, 'min_wrong': min_wrong,
              'routes': {r: sum(a['how'] == r for a in answers) for r in ROUTES}, 'current_factors': CURRENT,
              'all_current': metrics(answers, CURRENT)}
    if len(answers) < min_answers or wrong < min_wrong or right < min_wrong:
        report['status'] = 'too_few'
        report['need'] = {'answers': max(0, min_answers - len(answers)), 'wrong_place': max(0, min_wrong - wrong), 'right_place': max(0, min_wrong - right)}
        return report
    train, test = split(answers, holdout, seed)
    tuned = tune(train)
    before, after = metrics(test, CURRENT), metrics(test, tuned)
    better = after['log_loss'] < before['log_loss'] and after['brier'] <= before['brier']
    report.update({'status': 'tuned' if better else 'kept', 'train': len(train), 'held_out': len(test), 'tuned_factors': tuned,
                   'held_out_current': before, 'held_out_tuned': after, 'ship_factors': tuned if better else CURRENT,
                   'all_tuned': metrics(answers, tuned if better else CURRENT)})
    return report


def svg(report):
    """A reliability chart: per band, how sure Zenod said it was vs how often it was right."""
    w, h, left, bottom, top, right = 640, 400, 70, 330, 40, 610
    x = lambda v: left + (right - left) * v / 100
    y = lambda v: bottom - (bottom - top) * v / 100
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="sans-serif" font-size="12">',
             f'<rect width="{w}" height="{h}" fill="#fbf8f2"/>',
             f'<line x1="{x(0)}" y1="{y(0)}" x2="{x(100)}" y2="{y(100)}" stroke="#b9b2a5" stroke-dasharray="4 4"/>',
             f'<line x1="{left}" y1="{bottom}" x2="{right}" y2="{bottom}" stroke="#333"/><line x1="{left}" y1="{bottom}" x2="{left}" y2="{top}" stroke="#333"/>']
    for v in (0, 25, 50, 75, 100):
        parts.append(f'<text x="{x(v)}" y="{bottom + 18}" text-anchor="middle">{v}%</text><text x="{left - 8}" y="{y(v) + 4}" text-anchor="end">{v}%</text>')
    parts.append(f'<text x="{(left + right) / 2}" y="{h - 22}" text-anchor="middle">How sure Zenod said it was</text>')
    parts.append(f'<text x="18" y="{(top + bottom) / 2}" transform="rotate(-90 18 {(top + bottom) / 2})" text-anchor="middle">How often it was the right place</text>')
    series = [('all_current', '#9a3b2e', 'Today', 'circle')]
    if report.get('status') == 'tuned':
        series.append(('all_tuned', '#1f5c45', 'Tuned', 'rect'))
    for key, color, label, shape in series:
        pts = [b for b in report.get(key, {}).get('bands', []) if b.get('n')]
        if len(pts) > 1:
            parts.append('<polyline fill="none" stroke="%s" stroke-width="2" points="%s"/>' % (color, ' '.join(f'{x(b["said_right"]):.1f},{y(b["was_right"]):.1f}' for b in pts)))
        for b in pts:
            cx, cy = x(b['said_right']), y(b['was_right'])
            parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="6" fill="{color}"/>' if shape == 'circle' else
                         f'<rect x="{cx - 6:.1f}" y="{cy - 6:.1f}" width="12" height="12" fill="{color}"/>')
            parts.append(f'<text x="{cx + 9:.1f}" y="{cy - 8:.1f}" fill="{color}">{b["n"]}</text>')
    title = f'{report["answers"]} answers, {report["wrong_place"]} wrong place'
    if report.get('status') == 'too_few':
        need = report['need']
        title += f': needs {max(need["answers"], need["wrong_place"] + need["right_place"])} more before tuning'
    parts.append(f'<text x="{left}" y="24" font-size="15" font-weight="bold">{title}</text>')
    for i, (_, color, label, _) in enumerate(series):
        parts.append(f'<rect x="{right - 150 + i * 75}" y="{top + 4}" width="10" height="10" fill="{color}"/><text x="{right - 136 + i * 75}" y="{top + 13}">{label}</text>')
    parts.append(f'<text x="{right}" y="{bottom - 8}" text-anchor="end" fill="#777">on the dashed line the number means what it says</text>')
    parts.append('</svg>')
    return '\n'.join(parts)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--vault', help='the person\'s vault checkout (git)')
    ap.add_argument('--corrections', help=f'the answers file (default VAULT/{CORRECTIONS})')
    ap.add_argument('--demo', type=int, help='use N made-up answers instead of a vault')
    ap.add_argument('--out', help='write calibration.json and calibration.svg here')
    ap.add_argument('--min-answers', type=int, default=20)
    ap.add_argument('--min-wrong', type=int, default=5)
    ap.add_argument('--holdout', type=float, default=0.3)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args(argv)
    if not args.vault and not args.demo:
        ap.error('give --vault or --demo')
    answers = demo_answers(args.demo, args.seed) if args.demo else answers_from_vault(args.vault, args.corrections)
    report = calibrate(answers, args.min_answers, args.min_wrong, args.holdout, args.seed)
    if args.out:
        os.makedirs(args.out, exist_ok=True)
        with open(os.path.join(args.out, 'calibration.json'), 'w', encoding='utf8') as f:
            json.dump(report, f, indent=2)
        with open(os.path.join(args.out, 'calibration.svg'), 'w', encoding='utf8') as f:
            f.write(svg(report))
    if args.json:
        print(json.dumps(report, indent=2))
        return 0
    print(f'{report["answers"]} answers ({report["wrong_place"]} wrong place, {report["right_place"]} right place); routes {report["routes"]}')
    if report['status'] == 'too_few':
        n = report['need']
        print(f'too few to tune: need {n["answers"]} more answers, {n["wrong_place"]} more wrong place, {n["right_place"]} more right place')
        return 0
    b, a = report['held_out_current'], report['held_out_tuned']
    print(f'held out ({report["held_out"]}): log loss {b["log_loss"]} -> {a["log_loss"]}, Brier {b["brier"]} -> {a["brier"]}, '
          f'ECE {b["ece"]} -> {a["ece"]} points, AUC {b["auc"]} -> {a["auc"]}')
    print(f'{report["status"]}: factors {report["ship_factors"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
