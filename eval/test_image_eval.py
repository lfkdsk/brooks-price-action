"""Fast offline tests: .venv/bin/python -m unittest discover -s eval -p 'test_image_eval.py'."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image
import image_prep as prep
import extract_swing_labels as swing
import run_eval
import run_image_eval


class ImageTests(unittest.TestCase):
    def test_crop_and_preservation(self):
        a = np.full((300, 500, 3), 255, dtype=np.uint8)
        a[:35] = (65, 115, 180); a[280:] = (65, 115, 180)
        a[100:150, 200:204] = 0
        a[160:162, 80:400] = (0, 0, 255)
        a[80:90, 195:210] = (235, 0, 0)
        with tempfile.TemporaryDirectory() as td:
            d = Path(td); Image.fromarray(a).save(d / 'in.png')
            meta = prep.prepare(d / 'in.png', d / 'clean.png', d / 'labels.png')
            clean = np.array(Image.open(d / 'clean.png'))
            labels = np.array(Image.open(d / 'labels.png'))
            self.assertEqual(meta['crop_xyxy'], [0, 35, 500, 280])
            self.assertTrue(meta['blind_eligible'])
            self.assertFalse(prep.red_mask(clean).any())
            np.testing.assert_array_equal(clean[65:115, 200:204], 0)
            np.testing.assert_array_equal(clean[125:127, 80:400], labels[125:127, 80:400])
            self.assertEqual(swing.extract(d / 'labels.png')['labels'][0]['kind'], 'swing_high')

    def test_unsupported_and_selection(self):
        with self.assertRaises(ValueError): prep.crop_bounds(np.full((300, 500, 3), 255, np.uint8))
        with self.assertRaises(ValueError): prep.select_image({'id': 1, 'images': ['weekly.jpg']})
        with self.assertRaises(ValueError): prep.select_image({'id': 1, 'images': ['daily-a.jpg', 'daily-b.jpg']})
        paths = prep.local_images({'id': 1, 'images': ['https://example.test/daily%20chart.jpg?v=2']}, Path('/tmp'))
        self.assertEqual(paths, [Path('/tmp/1/daily chart.jpg')])

    def test_judge_mean_std_and_failure(self):
        case = {'date': '2026-01-01', 'title': 'SECRET', 'reference': ['SECRET']}
        scores = [dict.fromkeys(run_eval.DIMS, x) for x in (2, 4, 6)]
        with tempfile.TemporaryDirectory() as td:
            with patch.object(run_eval, 'run', side_effect=[json.dumps(s) for s in scores]) as mocked:
                result = run_eval.judge(case, 'candidate', Path(td), 3)
                self.assertEqual(mocked.call_count, 3)
                self.assertEqual(result['mean']['levels'], 4)
                self.assertAlmostEqual(result['std']['levels'], (8/3)**.5)
            with patch.object(run_eval, 'run', return_value='bad json'):
                self.assertIn('error', run_eval.judge(case, 'candidate', Path(td), 1))

    def test_candidate_boundary(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td); Image.new('RGB', (10, 10), 'white').save(d / 'source.png')
            case = {'id': 1, 'date': '2026-01-01', 'title': 'SECRET_THESIS', 'reference': ['SECRET_REFERENCE']}
            with patch.object(run_image_eval, 'run', return_value='candidate') as mocked, patch.object(run_image_eval, 'judge', return_value={}):
                run_image_eval.one(case, 'image_clean', d, {'clean': d / 'source.png'}, 3)
                cmd = mocked.call_args.args[0]
                self.assertEqual(cmd[cmd.index('--allowedTools') + 1], 'Read')
                self.assertNotIn('SECRET', cmd[2])
                self.assertNotIn('source.png', cmd[2])


if __name__ == '__main__': unittest.main()
