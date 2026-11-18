import importlib.util
import tempfile
import unittest
from pathlib import Path

from render_chart import chart_series, price_bounds, price_y, render

PRIOR = '2026-11-16'
SESSION = '2026-11-17'


def bar(session, n, close=100, low=98):
    return dict(session=session, bar=n, open=100, high=104, low=low, close=close)


class RenderChartTests(unittest.TestCase):
    def test_context_prior_levels_and_scaling(self):
        rows = [bar(PRIOR, 1, low=80), *(bar(PRIOR, n) for n in range(2, 33)),
                bar(SESSION, 1, close=103), bar('2026-11-18', 1, low=70)]
        series, guides = chart_series(rows, SESSION)
        self.assertEqual(len(series), 31)
        self.assertEqual(series[0][0]['bar'], 3)
        self.assertEqual(series[-1][0]['session'], SESSION)
        self.assertAlmostEqual(series[-1][1], 100 + 6 / 21)
        self.assertEqual(guides, (100, 80))
        bounds = price_bounds(series, guides)
        self.assertLess(bounds[0], 80)
        self.assertGreater(bounds[1], 104)
        self.assertEqual(price_y(bounds[0], bounds, 10, 110), 110)
        self.assertEqual(price_y(bounds[1], bounds, 10, 110), 10)
        self.assertEqual(chart_series(rows, SESSION, context=0)[0], series[-1:])
        with self.assertRaises(ValueError):
            chart_series(rows, '2026-11-15')

    @unittest.skipUnless(importlib.util.find_spec('PIL'), 'Pillow unavailable')
    def test_writes_png(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'chart.png'
            render([bar(PRIOR, 1), bar(SESSION, 1), bar(SESSION, 5, close=99)],
                   'SPY', SESSION, out)
            with Image.open(out) as image:
                self.assertEqual(image.format, 'PNG')
                self.assertEqual(image.size, (1600, 900))
                colors = image.getcolors(maxcolors=1600 * 900)
                self.assertIn((35, 108, 202), {color for _, color in colors})
