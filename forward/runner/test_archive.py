import datetime as dt
import json
import pathlib
import sqlite3
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import llm_log
from intraday import ET, UTC, bars_only, collect_symbol, run_model, session_bars_1m, parse_prediction
from recap import collect_recap
from run_daily import collect, llm_prediction

WORKER = pathlib.Path(__file__).resolve().parents[1] / 'worker'
# Shape of `claude -p --output-format json` (Claude Code CLI result envelope).
SAMPLE = {
    'type': 'result', 'subtype': 'success', 'is_error': False, 'duration_ms': 48213, 'duration_api_ms': 45110,
    'num_turns': 4, 'result': 'SECRET READING TEXT', 'session_id': 'abc', 'total_cost_usd': 0.0731,
    'usage': {'input_tokens': 12, 'cache_creation_input_tokens': 5000, 'cache_read_input_tokens': 40000,
              'output_tokens': 1500, 'service_tier': 'standard'},
    'modelUsage': {
        'claude-sonnet-4-5-20250929': {'inputTokens': 20, 'outputTokens': 1600, 'cacheReadInputTokens': 41000,
                                       'cacheCreationInputTokens': 5200, 'webSearchRequests': 0, 'costUSD': 0.07},
        'claude-haiku-4-5-20251001': {'inputTokens': 300, 'outputTokens': 40, 'cacheReadInputTokens': 0,
                                      'cacheCreationInputTokens': 0, 'webSearchRequests': 0, 'costUSD': 0.0031}},
    'permission_denials': [], 'uuid': 'u'}


def when(year, month, day, hour, minute, second=0):
    return dt.datetime(year, month, day, hour, minute, second, tzinfo=ET)


def fenced(value):
    return 'reading\n\n```json\n' + json.dumps(value) + '\n```'


class Recorder:
    def __init__(self, fail=False):
        self.posts, self.fail = [], fail

    def request(self, method, path, body=None):
        if self.fail and path == '/api/llm_calls':
            raise RuntimeError('network down')
        self.posts.append((method, path, body))
        if method == 'GET':
            return {'predictions': []}
        return {'ok': True}

    def calls(self):
        return [b for _, p, b in self.posts if p == '/api/llm_calls']


class MigrationTests(unittest.TestCase):
    def test_migrations_apply_on_sqlite_and_archive_is_rerunnable(self):
        db = sqlite3.connect(':memory:')
        for name in ('schema.sql', 'migrations/0002_intraday.sql', 'migrations/0003_archive.sql',
                     'migrations/0004_levels_ok.sql', 'migrations/0003_archive.sql'):
            db.executescript((WORKER / name).read_text())
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({'ibars1m', 'metrics_snapshots', 'llm_calls', 'predictions', 'ipredictions'} <= tables)
        for table in ('predictions', 'ipredictions'):
            self.assertIn('levels_ok', [r[1] for r in db.execute(f'PRAGMA table_info({table})')])
        db.execute("INSERT INTO ibars1m VALUES('SPY','2026-11-17T14:30:00Z','2026-11-17',1,1,2,0.5,1.5,10)")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO ibars1m VALUES('SPY','2026-11-17T14:29:00Z','2026-11-17',0,1,2,0.5,1.5,10)")
        db.execute("INSERT INTO metrics_snapshots(scope,as_of,condition,metrics_json) VALUES('daily','2026-11-17','skill','{}')")
        self.assertEqual(db.execute('SELECT symbol FROM metrics_snapshots').fetchone()[0], '*')
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO metrics_snapshots(scope,as_of,condition,metrics_json) VALUES('daily','2026-11-17','skill','{}')")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO llm_calls(ts,scope) VALUES('x','weekly')")
        db.execute("INSERT INTO llm_calls(ts,scope,cost_usd,ok) VALUES('x','recap',0.5,0)")
        # 0004 is a one-shot ALTER: a second run fails rather than silently changing anything.
        with self.assertRaises(sqlite3.OperationalError):
            db.executescript((WORKER / 'migrations/0004_levels_ok.sql').read_text())


class UsageTests(unittest.TestCase):
    def test_parse_sample_result_json(self):
        u = llm_log.usage(json.dumps(SAMPLE))
        self.assertEqual(u['model'], 'claude-haiku-4-5-20251001,claude-sonnet-4-5-20250929')
        self.assertEqual(u['duration_ms'], 48213)
        self.assertEqual(u['input_tokens'], 20 + 5200 + 300)
        self.assertEqual(u['output_tokens'], 1640)
        self.assertEqual(u['cache_read_tokens'], 41000)
        self.assertAlmostEqual(u['cost_usd'], 0.0731)

    def test_fallbacks_and_garbage(self):
        top = dict(SAMPLE, modelUsage=None, model='claude-x')
        u = llm_log.usage(json.dumps(top))
        self.assertEqual((u['model'], u['input_tokens'], u['output_tokens'], u['cache_read_tokens']),
                         ('claude-x', 5012, 1500, 40000))
        no_total = dict(SAMPLE)
        del no_total['total_cost_usd']
        self.assertAlmostEqual(llm_log.usage(json.dumps(no_total))['cost_usd'], 0.0731)
        for raw in ('not json', None, '[]', json.dumps({'duration_ms': -5, 'total_cost_usd': float('inf')}).replace('Infinity', '1e999')):
            u = llm_log.usage(raw)
            self.assertIsNone(u['duration_ms'])
            self.assertIsNone(u['cost_usd'])

    def test_row_has_metadata_only(self):
        now = dt.datetime(2026, 11, 17, 21, 0, 5, 123, tzinfo=UTC)
        r = llm_log.row(json.dumps(SAMPLE), scope='daily', symbol='SPY', session_or_asof='2026-11-17',
                        condition='skill', ok=False, error_type='invalid_output', now=now)
        self.assertEqual(r['ts'], '2026-11-17T21:00:05Z')
        self.assertEqual((r['ok'], r['error_type'], r['scope']), (False, 'invalid_output', 'daily'))
        self.assertNotIn('SECRET', json.dumps(r))
        self.assertEqual(set(r), {'ts', 'scope', 'symbol', 'session_or_asof', 'condition', 'model', 'duration_ms',
                                  'input_tokens', 'output_tokens', 'cache_read_tokens', 'cost_usd', 'ok', 'error_type'})
        self.assertEqual(llm_log.row('garbage', scope='recap', elapsed_ms=1234.7)['duration_ms'], 1234)

    def test_recorder_never_raises(self):
        api = Recorder(fail=True)
        with patch('builtins.print') as log:
            llm_log.recorder(api, scope='daily')(json.dumps(SAMPLE), ok=True)
        self.assertIn('llm_calls log skipped', str(log.call_args))
        self.assertIsNone(llm_log.recorder(None, scope='daily'))
        llm_log.emit(None, 'x', ok=True)
        llm_log.emit(Mock(side_effect=ValueError), 'x', ok=True)


class LevelsTests(unittest.TestCase):
    def test_levels_ok(self):
        f = llm_log.levels_ok
        self.assertEqual(f('long', 110, 95, 100), 1)
        self.assertEqual(f('long', 95, 90, 100), 0)
        self.assertEqual(f('long', 110, 100, 100), 0)
        self.assertEqual(f('short', 90, 105, 100), 1)
        self.assertEqual(f('short', 105, 110, 100), 0)
        self.assertEqual(f('short', None, 99, 100), 0)
        self.assertIsNone(f('unclear', 110, 90, 100))
        self.assertIsNone(f('long', None, None, 100))
        self.assertIsNone(f('long', 110, 90, None))

    def test_daily_collect_flags_inverted_levels(self):
        bars = [dict(symbol='SPY', date=f'2026-10-{i:02}', open=100, high=101, low=99, close=100) for i in range(1, 26)]
        api = Recorder()
        llm = Mock(return_value=(dict(always_in='long', p_up_5=.6, target=95, stop=90, state='other', horizon_bars=5), 'r', 'm'))
        ok, failed, logs = collect(dict(symbols=['SPY'], conditions=['skill', 'buy_hold'], lookback=700), api, 'sha', None,
                                   fetcher=lambda s: bars, llm=llm)
        self.assertEqual((ok, failed), (2, 0))
        posted = {b['condition']: b for _, p, b in api.posts if p == '/api/predictions'}
        self.assertEqual(posted['skill']['levels_ok'], 0)
        self.assertIsNone(posted['buy_hold']['levels_ok'])
        self.assertTrue(any('levels_ok=false' in line for line in logs))
        self.assertEqual(llm.call_args.kwargs['log'].__name__, 'log')

    def test_intraday_save_flags_inverted_levels(self):
        start = when(2026, 7, 9, 9, 30)
        now = start + dt.timedelta(minutes=16)
        bars = [dict(symbol='SPY', session='2026-07-09', bar=n, ts='x', open=100, high=101, low=99, close=100, final=0)
                for n in (1, 2, 3)]

        class API(Recorder):
            def request(self, method, path, body=None):
                if method == 'GET':
                    return {'predictions': []}
                return super().request(method, path, body)
        api = API()
        forecast = Mock(return_value=(dict(always_in='short', p_up_6=.3, target=101, stop=102, horizon=6, day_type='t'), 'r', 'm'))
        with patch('builtins.print') as log:
            collect_symbol({'intraday_conditions': ['skill', 'buy_hold']}, api, 'sha', None, 'SPY', bars, now, forecast)
        posted = {b['condition']: b for _, p, b in api.posts if p == '/api/intraday/predictions'}
        self.assertEqual(posted['skill']['levels_ok'], 0)
        self.assertIsNone(posted['buy_hold']['levels_ok'])
        self.assertIn('levels_ok=false', str(log.call_args_list))
        self.assertIn('log', forecast.call_args.kwargs)


class CliLoggingTests(unittest.TestCase):
    def test_run_model_logs_each_call_including_invalid_retry(self):
        bars = [dict(symbol='SPY', session='2026-07-09', bar=1, ts='2026-07-09T13:30:00Z', open=1, high=2, low=.5, close=1.5, volume=1)]
        good = fenced(dict(always_in='long', p_up_6=.7, target=None, stop=None, horizon_bars=6, day_type='trend'))
        outputs = iter([dict(SAMPLE, result='invalid'), dict(SAMPLE, result=good)])
        api = Recorder()
        log = llm_log.recorder(api, scope='intraday', symbol='SPY', session_or_asof='2026-07-09', condition='baseline')

        def run(command, **kwargs):
            self.assertEqual(command[command.index('--output-format') + 1], 'json')
            return subprocess.CompletedProcess(command, 0, json.dumps(next(outputs)))
        with patch('intraday.subprocess.run', side_effect=run):
            parsed, _, model = run_model({}, bars, None, 'prompt', parse_prediction, log=log)
        self.assertEqual(parsed['always_in'], 'long')
        rows = api.calls()
        self.assertEqual([(r['ok'], r['error_type']) for r in rows], [(False, 'invalid_output'), (True, None)])
        self.assertEqual(rows[1]['cost_usd'], 0.0731)
        self.assertEqual(rows[1]['condition'], 'baseline')
        self.assertNotIn('prompt', json.dumps(rows))

    def test_failures_are_logged_and_reraised(self):
        bars = [dict(symbol='SPY', session='2026-07-09', bar=1, ts='t', open=1, high=2, low=.5, close=1.5, volume=1)]
        api = Recorder()
        log = llm_log.recorder(api, scope='intraday')
        for effect, error, kind in ((subprocess.TimeoutExpired('claude', 1), subprocess.TimeoutExpired, 'timeout'),
                                    (subprocess.CompletedProcess('claude', 3, ''), RuntimeError, 'exit_3'),
                                    (subprocess.CompletedProcess('claude', 0, json.dumps(dict(SAMPLE, is_error=True))), RuntimeError, 'cli_error')):
            with patch('intraday.subprocess.run', side_effect=[effect] if isinstance(effect, Exception) else [effect]), \
                    self.assertRaises(error):
                run_model({}, bars, None, 'p', parse_prediction, log=log)
            self.assertEqual((api.calls()[-1]['ok'], api.calls()[-1]['error_type']), (False, kind))

    def test_daily_cli_logs_and_logging_failure_does_not_fail_the_call(self):
        bars = [dict(symbol='SPY', date=f'2026-10-{i:02}', open=100, high=101, low=99, close=100) for i in range(1, 26)]
        good = json.dumps(dict(always_in='short', p_up_5=.4, target=None, stop=None, state='bear'))
        apis = (Recorder(), Recorder(fail=True))
        for api in apis:
            with patch('run_daily.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps(dict(SAMPLE, result=good)))), \
                    patch('builtins.print'):
                result, _, model = llm_prediction({'llm_cli': 'claude'}, 'baseline', 'SPY', bars, None,
                                                  log=llm_log.recorder(api, scope='daily', symbol='SPY', condition='baseline'))
            self.assertEqual(result['always_in'], 'short')
        self.assertEqual([(r['ok'], r['scope'], r['duration_ms']) for r in apis[0].calls()], [(True, 'daily', 48213)])

    def test_recap_passes_a_recap_logger(self):
        api = Recorder()
        model = Mock(return_value=(dict(day_type='Trend', markdown='m', annotations=[], levels=[]), 'r', 'actual'))
        api.request = Mock(side_effect=lambda method, path, body=None: {'recaps': []} if method == 'GET' else {'ok': True})
        collect_recap({}, api, 'sha', None, 'SPY', '2026-07-09', [dict(bar=1, final=1, session='2026-07-09')],
                      daily=Mock(return_value={'close': 1, 'high': 1, 'low': 1}), model=model)
        log = model.call_args.kwargs['log']
        log(json.dumps(SAMPLE), ok=True)
        body = api.request.call_args.args[2]
        self.assertEqual((body['scope'], body['condition'], body['session_or_asof']), ('recap', 'recap', '2026-07-09'))


def yahoo_1m(starts, **meta):
    n = len(starts)
    return dict(timestamp=[int(t.timestamp()) for t in starts], meta=meta,
                indicators={'quote': [dict(open=[100] * n, high=[101] * n, low=[99] * n, close=[100.5] * n, volume=[7] * n)]})


class MinuteBarTests(unittest.TestCase):
    def test_session_filtering_and_minute_numbers(self):
        for month, day, utc_hour in ((7, 9, 13), (11, 17, 14)):
            open_ = when(2026, month, day, 9, 30)
            starts = [open_ - dt.timedelta(minutes=1), open_, open_ + dt.timedelta(minutes=1),
                      open_.replace(hour=15, minute=59), open_.replace(hour=16, minute=0),
                      open_ - dt.timedelta(days=1), open_ + dt.timedelta(minutes=2, seconds=30)]
            bars = session_bars_1m('SPY', yahoo_1m(starts), open_.replace(hour=16, minute=5))
            self.assertEqual([b['minute'] for b in bars], [1, 2, 390])
            self.assertEqual(bars[0]['ts'], f'2026-{month:02}-{day:02}T{utc_hour}:30:00Z')
            self.assertEqual({b['session'] for b in bars}, {open_.date().isoformat()})

    def test_only_closed_bars_and_early_close(self):
        open_ = when(2026, 11, 27, 9, 30)
        starts = [open_ + dt.timedelta(minutes=i) for i in range(5)]
        self.assertEqual(len(session_bars_1m('SPY', yahoo_1m(starts), open_ + dt.timedelta(minutes=3, seconds=19))), 2)
        self.assertEqual(len(session_bars_1m('SPY', yahoo_1m(starts), open_ + dt.timedelta(minutes=3, seconds=20))), 3)
        end = open_.replace(hour=13, minute=0)
        starts = [end - dt.timedelta(minutes=1), end, end + dt.timedelta(minutes=1)]
        meta = {'currentTradingPeriod': {'regular': {'end': int(end.timestamp())}}}
        self.assertEqual([b['minute'] for b in session_bars_1m('SPY', yahoo_1m(starts, **meta), end + dt.timedelta(hours=1))], [210])
        bad = yahoo_1m([open_])
        bad['indicators']['quote'][0]['high'] = [98]
        self.assertEqual(session_bars_1m('SPY', bad, open_ + dt.timedelta(minutes=5)), [])
        self.assertEqual(session_bars_1m('SPY', {'timestamp': []}, open_), [])

    def test_bars_only_uploads_minute_bars_in_batches(self):
        now = when(2026, 7, 9, 15, 30).astimezone(UTC)
        api = Recorder()
        minute = [dict(minute=i) for i in range(1, 1201)]
        self.assertEqual(bars_only({}, ['SPY'], now, api, Mock(return_value=[]), Mock(return_value=minute)), 0)
        sizes = [len(b['bars']) for _, p, b in api.posts if p == '/api/intraday/bars1m']
        self.assertEqual(sizes, [1000, 200])
        failing = Mock(side_effect=OSError('yahoo down'))
        with patch('builtins.print') as log:
            self.assertEqual(bars_only({}, ['SPY'], now, Recorder(), Mock(return_value=[]), failing), 1)
        self.assertIn('1m bars', str(log.call_args))


if __name__ == '__main__':
    unittest.main()
