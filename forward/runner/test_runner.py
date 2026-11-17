import datetime as dt
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

from fetch import closed_bars
from run_daily import parse_prediction, stage_inputs, collect, unwrap_output, mechanical, llm_prediction


def bars():
    return [dict(symbol='SPY', date=f'2026-10-{i:02}', open=100+i, high=102+i, low=99+i, close=101+i) for i in range(1, 26)]


class FakeAPI:
    def __init__(self):
        self.predictions = []
        self.uploads = []
        self.runs = []

    def request(self, method, path, body=None):
        if method == 'GET':
            return {'predictions': self.predictions[:]}
        if path == '/api/predictions':
            self.predictions.append(body)
        elif path == '/api/bars':
            self.uploads.extend(body['bars'])
        else:
            self.runs.append(body)
        return {'ok': True}


class RunnerTests(unittest.TestCase):
    def test_parse(self):
        p = dict(always_in='long', p_up_5=.6, target=140, stop=100, state='weak bull channel')
        text = 'Reading\n```json\n' + json.dumps(p) + '\n```'
        result = parse_prediction(text)
        self.assertEqual(result['horizon_bars'], 5)
        self.assertEqual(result['state'], 'bull_trend')
        for value in [True, 1.1, float('nan')]:
            with self.assertRaises(ValueError):
                parse_prediction(json.dumps(dict(p, p_up_5=value)))
        self.assertEqual(parse_prediction(json.dumps(dict(p, horizon_bars='five')))['horizon_bars'], 5)
        reading, model = unwrap_output(json.dumps({'result': text, 'modelUsage': {'claude-test': {}}}))
        self.assertEqual(reading, text)
        self.assertEqual(model, 'claude-test')

    def test_stage_whitelist(self):
        with tempfile.TemporaryDirectory() as name:
            root = pathlib.Path(name)
            skill = root / 'source'
            (skill / 'scripts').mkdir(parents=True)
            (skill / 'references').mkdir()
            for path in ['SKILL.md', 'scripts/bar_features.py', 'references/methodology.md', 'token', 'config.json', 'scripts/similar_cases.py']:
                (skill / path).write_text('test')
            stage = root / 'stage'
            stage.mkdir()
            stage_inputs(stage, bars(), skill)
            names = {str(p.relative_to(stage)) for p in stage.rglob('*') if p.is_file()}
            self.assertEqual(names, {'bars.csv', 'skill/SKILL.md', 'skill/scripts/bar_features.py', 'skill/references/methodology.md'})
            self.assertEqual((stage / 'bars.csv').read_text().splitlines()[0], 'date,open,high,low,close')
            baseline = root / 'baseline'
            baseline.mkdir()
            stage_inputs(baseline, bars())
            self.assertEqual([p.name for p in baseline.iterdir()], ['bars.csv'])

    def test_idempotency_and_partial_failure(self):
        config = dict(symbols=['SPY'], conditions=['buy_hold', 'ema20', 'momentum20'], lookback=700)
        api = FakeAPI()
        first = collect(config, api, 'sha', None, fetcher=lambda s: bars())
        self.assertEqual(first[:2], (3, 0))
        second = collect(config, api, 'sha', None, fetcher=lambda s: bars())
        self.assertEqual(second[:2], (3, 0))
        self.assertEqual(len(api.predictions), 3)
        config['conditions'].append('bad')
        self.assertEqual(collect(config, api, 'sha', None, fetcher=lambda s: bars())[:2], (3, 1))
        self.assertEqual(mechanical('momentum20', bars())['always_in'], 'long')

    def test_gap_upload_uses_latest_forecast_and_thirty_bar_floor(self):
        config = dict(symbols=['SPY'], conditions=['buy_hold'], lookback=700)
        api = FakeAPI()
        api.predictions = [dict(symbol='SPY', condition='buy_hold', asof='2026-08-01'),
                           dict(symbol='SPY', condition='buy_hold', asof='2026-10-05')]
        start = dt.date(2026, 9, 1)
        data = [dict(symbol='SPY', date=(start + dt.timedelta(days=i)).isoformat(),
                     open=100, high=101, low=99, close=100) for i in range(70)]
        self.assertEqual(collect(config, api, 'sha', None, fetcher=lambda s: data)[:2], (1, 0))
        self.assertEqual(api.uploads[0]['date'], '2026-10-05')
        self.assertEqual(len(api.uploads), 36)

    def test_session_close(self):
        pt = ZoneInfo('America/Los_Angeles')
        bb = [{'date': '2026-11-26'}, {'date': '2026-11-27'}, {'date': '2026-11-28'}]
        # Friday after Thanksgiving: conservative even though early session closed at 10 PT.
        for hour, minute, count in [(10, 30, 1), (13, 0, 1), (13, 14, 1), (13, 15, 2), (14, 0, 2)]:
            self.assertEqual(len(closed_bars(bb, dt.datetime(2026, 11, 27, hour, minute, tzinfo=pt))), count)
        # Summer DST, using an equivalent UTC time.
        self.assertEqual(closed_bars([{'date': '2026-07-01'}], dt.datetime(2026, 7, 1, 20, 14, tzinfo=dt.timezone.utc)), [])

    def test_cli_retry_and_token_not_inherited(self):
        config = {'llm_cli': 'claude'}
        good = json.dumps(dict(always_in='short', p_up_5=.4, target=None, stop=None, state='bear'))
        from types import SimpleNamespace
        with patch('run_daily.subprocess.run', side_effect=[SimpleNamespace(returncode=0, stdout='bad'), SimpleNamespace(returncode=0, stdout=json.dumps({'result': good, 'model': 'version'}))]) as run, patch.dict('os.environ', {'WRITE_TOKEN': 'never-copy'}):
            result, reading, model = llm_prediction(config, 'baseline', 'SPY', bars(), None)
            self.assertEqual(result['always_in'], 'short')
            self.assertEqual(model, 'version')
            self.assertEqual(run.call_count, 2)
            for call in run.call_args_list:
                self.assertNotIn('WRITE_TOKEN', call.kwargs['env'])
                self.assertEqual(call.kwargs['timeout'], 900)


if __name__ == '__main__':
    unittest.main()
