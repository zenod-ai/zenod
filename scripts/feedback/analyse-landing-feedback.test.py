#!/usr/bin/env python3
"""Tests for analyse-landing-feedback.py on demo data (no private data). Run: python3 scripts/feedback/analyse-landing-feedback.test.py"""
import importlib.util, json, os, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'analyse-landing-feedback.py')
spec = importlib.util.spec_from_file_location('alf', SCRIPT)
alf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alf)

DEMO = [
    {'ts': '2026-01-01T10:00:00Z', 'type': 'answer', 'round': 1, 'note_id': 'n1', 'memory_id': 'm1', 'memories': ['Boat quote'],
     'zenod_page': 'Boat repair', 'zenod_parent': 'Home', 'written': True, 'verdict': 'yes', 'correction': ''},
    # m2 first said yes, then changed to no: the later record wins
    {'ts': '2026-01-01T10:01:00Z', 'type': 'answer', 'round': 1, 'note_id': 'n1', 'memory_id': 'm2', 'memories': ['Learn Portuguese'],
     'zenod_page': 'Porto quotes', 'zenod_parent': 'Boat repair', 'written': True, 'verdict': 'yes', 'correction': ''},
    {'ts': '2026-01-01T10:05:00Z', 'type': 'answer', 'round': 1, 'note_id': 'n1', 'memory_id': 'm2', 'memories': ['Learn Portuguese'],
     'zenod_page': 'Porto quotes', 'zenod_parent': 'Boat repair', 'written': True, 'verdict': 'no',
     'correction': 'Should be its own page, nothing to do with the boat'},
    {'ts': '2026-01-01T10:02:00Z', 'type': 'answer', 'round': 2, 'note_id': 'n2', 'memory_id': 'm3', 'memories': ['Call mum'],
     'zenod_page': 'Family', 'zenod_parent': None, 'written': False, 'verdict': 'no', 'correction': ''},
    {'ts': '2026-01-01T10:03:00Z', 'type': 'answer', 'round': 2, 'note_id': 'n2', 'memory_id': 'm4', 'memories': ['Gym plan'],
     'zenod_page': 'Health and Work', 'zenod_parent': 'Life', 'written': True, 'verdict': 'no',
     'correction': 'health and work are totally separate things, parent is wrong'},
    {'ts': '2026-01-01T10:04:00Z', 'type': 'answer', 'round': 2, 'note_id': 'n3', 'memory_id': 'm5', 'memories': ['Idea'],
     'zenod_page': 'Ideas', 'zenod_parent': None, 'written': True, 'verdict': 'unsure', 'correction': ''},
    {'ts': '2026-01-01T10:06:00Z', 'type': 'answer', 'round': 2, 'note_id': 'n3', 'memory_id': 'm6', 'memories': ['Thing'],
     'zenod_page': 'Misc', 'zenod_parent': None, 'written': True, 'verdict': 'no', 'correction': ''},
    {'ts': '2026-01-01T10:07:00Z', 'type': 'submit', 'answers': 6, 'corrections': 2},
]


class T(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix='.jsonl')
        with os.fdopen(fd, 'w') as f:
            for r in DEMO:
                f.write(json.dumps(r) + '\n')
            f.write('not json\n\n')

    def tearDown(self):
        os.unlink(self.path)

    def test_counts_latest_wins(self):
        a = alf.analyse(alf.load(self.path))
        self.assertEqual((a['answered'], a['right'], a['wrong'], a['unsure'], a['corrections']), (6, 1, 4, 1, 2))
        self.assertEqual(a['rounds'], [1, 2])

    def test_modes(self):
        a = alf.analyse(alf.load(self.path))
        got = {m['id']: m['count'] for m in a['failure_modes']}
        self.assertEqual(got, {'never_written': 1, 'mixed_topics': 2, 'wrong_parent': 1, 'needs_own_page': 1,
                               'wrong_branch': 1, 'wrong_unspecified': 1})
        self.assertEqual(a['top_fixes'][0]['mode'], 'mixed_topics')
        self.assertEqual(len(a['top_fixes']), 3)

    def test_round_filter(self):
        a = alf.analyse(alf.load(self.path, {2}))
        self.assertEqual(a['answered'], 4)

    def test_cli_text_and_json(self):
        out = subprocess.run([sys.executable, SCRIPT, self.path], capture_output=True, text=True, check=True).stdout
        self.assertIn('6 placements judged', out)
        self.assertIn('Top fixes:', out)
        j = json.loads(subprocess.run([sys.executable, SCRIPT, self.path, '--json'], capture_output=True, text=True, check=True).stdout)
        self.assertEqual(j['wrong'], 4)

    def test_empty(self):
        fd, p = tempfile.mkstemp(); os.close(fd)
        try:
            self.assertEqual(alf.text_report(alf.analyse(alf.load(p))), 'No answers yet.')
        finally:
            os.unlink(p)


if __name__ == '__main__':
    unittest.main()
