#!/usr/bin/env python3
"""Tests for calibrate-confidence.py on a made-up vault (no private data). Run: python3 scripts/feedback/calibrate-confidence.test.py"""
import importlib.util, json, os, subprocess, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'calibrate-confidence.py')
spec = importlib.util.spec_from_file_location('cc', SCRIPT)
cc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cc)


def git(vault, *args):
    env = dict(os.environ, GIT_AUTHOR_DATE='2026-01-02T10:00:00Z', GIT_COMMITTER_DATE='2026-01-02T10:00:00Z')
    subprocess.run(['git', '-C', vault, '-c', 'user.name=t', '-c', 'user.email=t@t', *args], check=True, capture_output=True, env=env)


def write(vault, path, text):
    os.makedirs(os.path.dirname(os.path.join(vault, path)), exist_ok=True)
    with open(os.path.join(vault, path), 'w', encoding='utf8') as f:
        f.write(text)


def record(page, verdict, confidence, ts='2026-01-03T09:00:00Z', **extra):
    return dict({'id': f'c-{page}-{ts}', 'ts': ts, 'type': 'answer', 'source': 'app', 'action': 'confirm' if verdict == 'yes' else 'move',
                 'memory_id': f'{page}.md', 'zenod_page': page, 'verdict': verdict, 'confidence': confidence}, **extra)


class Calibrate(unittest.TestCase):
    def vault(self):
        vault = tempfile.mkdtemp()
        git(vault, 'init', '-q')
        write(vault, 'Topics/Boat.md', '---\ntitle: Boat\n---\n')
        write(vault, 'Topics/Cello.md', '---\ntitle: Cello\n---\n')
        git(vault, 'add', '-A')
        git(vault, 'commit', '-qm', 'start')
        # Cello gets its parent on the filing day (hung); Porto is a weak hang; Idea is a provisional leaf.
        write(vault, 'Topics/Cello.md', '---\ntitle: Cello\nparent: "[[Topics/Life]]"\n---\n')
        write(vault, 'Topics/Porto.md', '---\ntitle: Porto\nprovisional: true\n---\n')
        write(vault, 'Topics/Idea.md', '---\ntitle: Idea\nprovisional: true\n---\n## Capture 2026-01-02 [[Log/2026-01-02#^e-1]]\n\nFiling note: nothing fitted\n')
        write(vault, 'Log/2026-01-02.md', '\n'.join([
            '- filed: [[Topics/Boat]] (Home › Boat) · 90% sure',
            '- filed: [[Topics/Cello]] (Life › Cello) · 68% sure',
            '- filed: [[Topics/Porto]] (Home › Porto) · provisional · 40% sure',
            '- filed: [[Topics/Idea]] · provisional · 21% sure', '']))
        git(vault, 'add', '-A')
        git(vault, 'commit', '-qm', 'memory: filed e-1')
        return vault

    def test_routes_inferred_from_the_vault(self):
        vault = self.vault()
        write(vault, cc.CORRECTIONS, '\n'.join(json.dumps(r) for r in [
            record('Topics/Boat', 'yes', 90), record('Topics/Cello', 'no', 68), record('Topics/Porto', 'no', 40), record('Topics/Idea', 'yes', 21),
            record('Topics/Old', 'no', None)]) + '\n')
        got = {round(a['confidence']): a['how'] for a in cc.answers_from_vault(vault)}
        self.assertEqual(got, {90: 'in_tree', 68: 'hung', 40: 'hung_weak', 21: 'leaf'})

    def test_undo_and_later_answer(self):
        rows = [record('A', 'yes', 80), record('A', 'no', 80, ts='2026-01-04T00:00:00Z', id='c-2'),
                {'id': 'u', 'ts': '2026-01-05T00:00:00Z', 'type': 'answer', 'action': 'undo', 'undoes': 'c-2', 'memory_id': 'A.md', 'verdict': None},
                record('B', 'no', 30)]
        got = {r['memory_id']: r['verdict'] for r in cc.standing(rows)}
        self.assertEqual(got, {'A.md': 'yes', 'B.md': 'no'})

    def test_too_few_says_how_many_more(self):
        report = cc.calibrate([{'confidence': 90, 'wrong': False, 'how': 'in_tree'}] * 7 + [{'confidence': 30, 'wrong': True, 'how': 'leaf'}] * 2)
        self.assertEqual(report['status'], 'too_few')
        self.assertEqual(report['need'], {'answers': 11, 'wrong_place': 3, 'right_place': 0})

    def test_enough_answers_measure_and_tune(self):
        report = cc.calibrate(cc.demo_answers(150, seed=3))
        self.assertIn(report['status'], ('tuned', 'kept'))
        self.assertEqual(report['held_out'] + report['train'], 150)
        f = report['ship_factors']
        self.assertTrue(f['in_tree'] >= f['hung'] >= f['hung_weak'] >= f['leaf'])
        self.assertEqual(sum(b['n'] for b in report['all_current']['bands']), 150)

    def test_cli_writes_json_and_chart(self):
        out = tempfile.mkdtemp()
        self.assertEqual(cc.main(['--demo', '40', '--out', out]), 0)
        with open(os.path.join(out, 'calibration.svg')) as f:
            self.assertTrue(f.read().startswith('<svg'))
        with open(os.path.join(out, 'calibration.json')) as f:
            self.assertEqual(json.load(f)['answers'], 40)


if __name__ == '__main__':
    unittest.main()
