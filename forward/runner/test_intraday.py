import datetime as dt
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from intraday import ET, UTC, collect_symbol, decisions, llm, parse_prediction, run_model, session_bars
from recap import collect_recap, parse_recap


def when(year, month, day, hour, minute, second=0):
    return dt.datetime(year, month, day, hour, minute, second, tzinfo=ET)


def yahoo_result(starts, **meta):
    return dict(timestamp=[int(t.timestamp()) for t in starts], meta=meta,
                indicators={'quote': [dict(open=[100] * len(starts), high=[105] * len(starts),
                                          low=[99] * len(starts), close=[104] * len(starts),
                                          volume=[50] * len(starts))]})


def session_starts(start, count):
    return [start + dt.timedelta(minutes=5 * i) for i in range(count)]


def fenced(value):
    return '复盘正文\n\n' + chr(96) * 3 + 'json\n' + json.dumps(value) + '\n' + chr(96) * 3


class FakeAPI:
    def __init__(self):
        self.predictions = {}
        self.recaps = {}
        self.bar_uploads = 0

    def request(self, method, path, body=None):
        if path == '/api/intraday/bars':
            self.bar_uploads += 1
        elif method == 'GET' and path.startswith('/api/intraday/predictions?'):
            return {'predictions': list(self.predictions.values())}
        elif path == '/api/intraday/predictions':
            self.predictions.setdefault((body['bar'], body['condition']), body)
        elif method == 'GET' and path.startswith('/api/recaps?'):
            return {'recaps': list(self.recaps.values())}
        elif path == '/api/recaps':
            self.recaps[body['session']] = body
        else:
            raise AssertionError(path)


class IntradayTests(unittest.TestCase):
    def test_dst_numbering_auction_and_two_prior_sessions(self):
        for month, day, utc_open in [(7, 9, 13), (11, 12, 14)]:
            start = when(2026, month, day, 9, 30)
            stamps = [start - dt.timedelta(days=i) for i in (3, 2, 1)]
            stamps += [start - dt.timedelta(minutes=5), start, start + dt.timedelta(minutes=10),
                       start.replace(hour=15, minute=55), start.replace(hour=16, minute=0)]
            bars = session_bars('SPY', yahoo_result(stamps), start.replace(hour=16, minute=20))
            self.assertEqual([b['bar'] for b in bars], [1, 1, 1, 3, 78])
            self.assertEqual(len({b['session'] for b in bars}), 3)
            self.assertIn(f'T{utc_open}:30:00Z', bars[2]['ts'])
            self.assertEqual(bars[-1]['final'], 1)

    def test_closed_rule_and_early_close(self):
        start = when(2026, 7, 9, 9, 30)
        payload = yahoo_result(session_starts(start, 4))
        self.assertEqual(len(session_bars('SPY', payload, when(2026, 7, 9, 9, 45, 19).astimezone(UTC))), 2)
        self.assertEqual(len(session_bars('SPY', payload, when(2026, 7, 9, 9, 45, 20).astimezone(UTC))), 3)
        end = start.replace(hour=13, minute=0)
        payload = yahoo_result(session_starts(start, 43), currentTradingPeriod={'regular': {'end': int(end.timestamp())}})
        bars = session_bars('SPY', payload, end + dt.timedelta(seconds=25))
        self.assertEqual((bars[-1]['bar'], bars[-1]['final']), (42, 1))

    def test_decision_cadence_and_lag(self):
        start = when(2026, 7, 9, 9, 30)
        now = start + dt.timedelta(minutes=46)
        bars = session_bars('SPY', yahoo_result(session_starts(start, 9)), now)
        self.assertEqual(decisions(bars, [], now), ([3, 6], 9))
        self.assertEqual(decisions(bars[:-1], [], now), ([3, 6], None))
        self.assertEqual(decisions(bars, [{'bar': 9, 'condition': 'missed'}], now), ([3, 6], None))

    def test_idempotency_and_only_latest_point_forecast(self):
        start = when(2026, 7, 9, 9, 30)
        now = start + dt.timedelta(minutes=51)
        bars = session_bars('SPY', yahoo_result(session_starts(start, 10)), now)
        api = FakeAPI()
        forecast = Mock(return_value=(dict(always_in='long', p_up_6=.7, target=None, stop=None,
                                           horizon=6, day_type='trend'), 'reading', 'actual'))
        for _ in range(2):
            self.assertEqual(collect_symbol({}, api, 'sha', None, 'SPY', bars, now, forecast), 0)
        self.assertEqual(forecast.call_count, 3)
        self.assertEqual({call.args[2][-1]['bar'] for call in forecast.call_args_list}, {9})
        self.assertEqual(len(api.predictions), 8)
        self.assertIn((3, 'missed'), api.predictions)
        self.assertIn((6, 'missed'), api.predictions)
        self.assertEqual(collect_symbol({}, api, 'sha', None, 'SPY', [], now, forecast), 0)

    def test_forecast_normalization(self):
        text = fenced(dict(always_in=' Long ', p_up_6=.7, target=None, stop=None, horizon_bars=99, day_type='Trend'))
        self.assertEqual(parse_prediction(text)['always_in'], 'long')
        self.assertEqual(parse_prediction(text)['horizon'], 6)
        with self.assertRaises(ValueError):
            parse_prediction(text + '\nextra')

    def test_model_retry_and_skill_staging(self):
        start = when(2026, 7, 9, 9, 30)
        previous = session_starts(start - dt.timedelta(days=1), 78)
        bars = session_bars('SPY', yahoo_result(previous + session_starts(start, 3)),
                            start + dt.timedelta(minutes=16))
        skill = pathlib.Path(__file__).resolve().parents[2] / 'skill/brooks-price-action'
        good = fenced(dict(always_in='long', p_up_6=.7, target=None, stop=None,
                           horizon_bars=6, day_type='trend'))
        actual_run = subprocess.run
        calls = []

        def run(command, **kwargs):
            if command[0] != 'claude':
                return actual_run(command, **kwargs)
            calls.append(command)
            self.assertEqual(kwargs['stdin'], subprocess.DEVNULL)
            self.assertEqual(kwargs['timeout'], 600)
            self.assertNotIn('WRITE_TOKEN', kwargs['env'])
            stage = kwargs['cwd']
            self.assertIn('session,bar,timestamp', (stage / 'bars.csv').read_text())
            self.assertIn(bars[-1]['ts'], (stage / 'features.txt').read_text())
            result = 'invalid' if len(calls) == 1 else good
            return subprocess.CompletedProcess(command, 0, json.dumps({'result': result, 'model': 'mock'}))

        with patch('intraday.subprocess.run', side_effect=run):
            parsed, _, model = run_model({}, bars, skill, 'prompt', parse_prediction, 'sonnet')
        self.assertEqual((len(calls), parsed['always_in'], model), (2, 'long', 'mock'))
        self.assertEqual(calls[0][-2:], ['--model', 'sonnet'])

    def test_skill_chart_stages_only_chart_csv_and_skill(self):
        start = when(2026, 7, 9, 9, 30)
        bars = session_bars('SPY', yahoo_result(session_starts(start, 3)), start + dt.timedelta(minutes=16))
        skill = pathlib.Path(__file__).resolve().parents[2] / 'skill/brooks-price-action'
        result = fenced(dict(always_in='long', p_up_6=.7, target=None, stop=None,
                             horizon_bars=6, day_type='trend'))

        def run(command, **kwargs):
            stage = kwargs['cwd']
            if command[0] != 'claude':
                self.assertEqual(command[0], sys.executable)
                self.assertEqual(pathlib.Path(command[1]).name, 'render_chart.py')
                self.assertEqual(command[2:], ['bars.csv', 'chart.png', 'SPY', '2026-07-09'])
                (stage / 'chart.png').write_bytes(b'mocked render')
                return subprocess.CompletedProcess(command, 0)
            self.assertTrue(command[2].startswith('Read chart.png first'))
            self.assertEqual(command[command.index('--allowedTools') + 1], 'Read,Bash(python3:*)')
            self.assertEqual({p.name for p in stage.iterdir()}, {'bars.csv', 'chart.png', 'skill'})
            self.assertEqual({p.relative_to(stage / 'skill') for p in (stage / 'skill').rglob('*') if p.is_file()},
                             {pathlib.Path('SKILL.md'), pathlib.Path('scripts/bar_features.py'),
                              *(p.relative_to(skill) for p in (skill / 'references').glob('*.md'))})
            self.assertEqual((stage / 'chart.png').read_bytes(), b'mocked render')
            self.assertIn(bars[-1]['ts'], (stage / 'bars.csv').read_text())
            self.assertNotIn('WRITE_TOKEN', kwargs['env'])
            return subprocess.CompletedProcess(command, 0, json.dumps({'result': result, 'model': 'mock'}))

        with patch.dict('os.environ', {'WRITE_TOKEN': 'private'}), patch('intraday.subprocess.run', side_effect=run):
            parsed, _, _ = llm({'chart_python': sys.executable}, 'skill_chart', bars, skill)
        self.assertEqual(parsed['always_in'], 'long')

    def test_missing_chart_venv_skips_only_candidate(self):
        start = when(2026, 7, 9, 9, 30)
        now = start + dt.timedelta(minutes=16)
        bars = session_bars('SPY', yahoo_result(session_starts(start, 3)), now)
        api = FakeAPI()
        with tempfile.TemporaryDirectory() as tmp, patch('intraday.subprocess.run') as run, patch('builtins.print') as log:
            config = {'chart_python': str(pathlib.Path(tmp) / 'missing/bin/python'),
                      'intraday_conditions': ['skill_chart', 'opening_bar']}
            self.assertEqual(collect_symbol(config, api, 'sha', None, 'SPY', bars, now), 0)
            run.assert_not_called()
            self.assertIn('chart Python unavailable', str(log.call_args_list))
        self.assertEqual(set(api.predictions), {(3, 'opening_bar')})


class RecapTests(unittest.TestCase):
    def test_json_validation(self):
        payload = dict(day_type='Trend', annotations=[dict(bar=1, label='Breakout', pos='above')],
                       levels=[dict(price=105, label='Target')])
        self.assertEqual(parse_recap(fenced(payload), {1, 2})['markdown'], '复盘正文')
        for invalid in [dict(bar=0, label='bad', pos='below'), dict(bar=3, label='bad', pos='below'),
                        dict(bar=True, label='bad', pos='above'), dict(bar=2, label='', pos='above'),
                        dict(bar=2, label='wrong position', pos='right')]:
            with self.assertRaises(ValueError):
                parse_recap(fenced(dict(payload, annotations=[invalid])), {1, 2})
        with self.assertRaises(ValueError):
            parse_recap(fenced(dict(payload, annotations=payload['annotations'] * 13)), {1})
        with self.assertRaises(ValueError):
            parse_recap(fenced(dict(payload, levels=[dict(price=True, label='bad')])), {1})

    def test_skip_existing_unless_forced(self):
        api = FakeAPI()
        day = '2026-07-09'
        daily = Mock(return_value={'session': '2026-07-08', 'close': 100, 'high': 101, 'low': 99})
        model = Mock(return_value=(dict(day_type='Trend', markdown='内容', annotations=[], levels=[]),
                                   'reading', 'actual'))
        for force in (False, False, True):
            collect_recap({}, api, 'sha', None, 'SPY', day, [dict(bar=1, final=1, session=day)],
                          force, daily, model)
        self.assertEqual(daily.call_count, 2)
        self.assertEqual(model.call_count, 2)
        self.assertTrue(api.recaps[day]['force'])


if __name__ == '__main__':
    unittest.main()
