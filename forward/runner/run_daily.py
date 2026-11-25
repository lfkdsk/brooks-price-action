#!/usr/bin/env python3
"""Push immutable-in-practice daily forecasts. Explicit invocation launches CLI jobs."""
import argparse
import concurrent.futures as cf
import csv
import datetime as dt
import json
import math
import os
import pathlib
import re
import shutil
import socket
import stat
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request

import llm_log
from fetch import fetch_bars
from prompts import prompt

HERE = pathlib.Path(__file__).resolve().parent


def parse_prediction(text):
    blocks = re.findall(r'```(?:json)?\s*(.*?)```', text, re.S | re.I)
    for raw in blocks[::-1] + [text.strip()]:
        try:
            p = json.loads(raw)
            if not isinstance(p, dict) or p['always_in'] not in ('long', 'short', 'unclear'):
                continue
            v = p['p_up_5']
            if type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1:
                continue
            for k in ('target', 'stop'):
                if p[k] is not None and (type(p[k]) not in (int, float) or not math.isfinite(p[k])):
                    raise ValueError(k)
            h = p.get('horizon_bars', 5)
            p['horizon_bars'] = h if type(h) is int and 1 <= h <= 20 else 5
            s = str(p.get('state', '')).lower()
            p['state'] = ('trading_range' if 'range' in s else 'bull_trend' if 'bull' in s
                          else 'bear_trend' if 'bear' in s else 'other')
            return p
        except (ValueError, TypeError, KeyError):
            pass
    raise ValueError('No valid prediction JSON')


def unwrap_output(raw):
    """Claude JSON envelope; retain raw text compatibility for CLI variants."""
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict) and 'result' in obj:
            if obj.get('is_error'):
                raise RuntimeError('CLI returned an error envelope')
            usage = obj.get('modelUsage') or {}
            model = obj.get('model') or (','.join(sorted(usage)) if isinstance(usage, dict) else None)
            return str(obj['result']), model or 'unknown'
    except json.JSONDecodeError:
        pass
    return raw, 'unknown'


def stage_inputs(stage, bars, skill=None):
    stage = pathlib.Path(stage)
    with (stage / 'bars.csv').open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['date', 'open', 'high', 'low', 'close'], extrasaction='ignore')
        writer.writeheader()
        writer.writerows(bars)
    if skill:
        skill = pathlib.Path(skill)
        files = [skill / 'SKILL.md', skill / 'scripts/bar_features.py', *sorted((skill / 'references').glob('*.md'))]
        for source in files:
            target = stage / 'skill' / source.relative_to(skill)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)


def llm_prediction(config, condition, symbol, bars, skill, log=None):
    if config['llm_cli'] != 'claude':
        raise ValueError('Only the Claude CLI JSON protocol is supported')
    with tempfile.TemporaryDirectory(prefix='brooks-forward-') as name:
        stage = pathlib.Path(name)
        stage_inputs(stage, bars, skill if condition == 'skill' else None)
        base = prompt(condition, symbol, bars[-1]['date'])
        for attempt in range(2):
            instruction = base + ('\nPrevious output failed parsing. Ensure the final JSON strictly matches the contract.' if attempt else '')
            command = ['claude', '-p', instruction, '--output-format', 'json', '--allowedTools',
                       'Bash(python3:*) Read', '--add-dir', str(stage)]
            if condition == 'skill':
                command += ['--add-dir', str(stage / 'skill')]
            # Pinned: without --model the CLI default drifted between models from day to day.
            if config.get('daily_model'):
                command += ['--model', config['daily_model']]
            # The collector token must not be inherited by the CLI or its subprocesses.
            env = {k: v for k, v in os.environ.items() if k != 'WRITE_TOKEN'}
            _, reading, model, finish = llm_log.run_cli(
                subprocess.run, command, log, unwrap_output, cwd=stage, stdin=subprocess.DEVNULL,
                capture_output=True, text=True, timeout=900, env=env)
            try:
                parsed = parse_prediction(reading)
            except ValueError:
                finish(False, 'invalid_output')
                if attempt:
                    raise
                continue
            finish(True)
            return parsed, reading, model


def mechanical(condition, bars):
    c = [b['close'] for b in bars]
    if condition == 'buy_hold':
        d = 1
    elif condition == 'ema20':
        ema = c[0]
        for v in c[1:]:
            ema = 2 / 21 * v + 19 / 21 * ema
        d = 1 if c[-1] > ema else -1
    elif condition == 'momentum20':
        if len(c) < 21:
            raise ValueError('Momentum20 requires 21 bars')
        d = (c[-1] > c[-21]) - (c[-1] < c[-21])
    else:
        raise ValueError('Unknown condition')
    return dict(always_in={1: 'long', -1: 'short', 0: 'unclear'}[d], p_up_5=.5,
                target=None, stop=None, horizon_bars=5, state='other')


class API:
    def __init__(self, base, token):
        self.base, self.token = base.rstrip('/'), token

    def request(self, method, path, body=None):
        data = None if body is None else json.dumps(body, allow_nan=False).encode()
        # Cloudflare's bot check rejects the default Python-urllib agent (error 1010).
        headers = {'Content-Type': 'application/json', 'User-Agent': 'brooks-forward-runner/1.0'}
        if method == 'POST':
            headers['Authorization'] = 'Bearer ' + self.token
        # Retrying POST is safe for bars/predictions; runs and LLM call logs are append-only, so one attempt.
        once = path in ('/api/runs', '/api/llm_calls')
        for attempt in range(1 if once else 3):
            try:
                req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
                with urllib.request.urlopen(req, timeout=90) as response:
                    return json.load(response)
            except OSError as e:
                status = getattr(e, 'code', None)
                if attempt == (0 if once else 2):
                    raise RuntimeError(f'Collector request failed: {method} {path.split("?")[0]} (HTTP {status})') from None
                time.sleep(2 ** attempt)


def exists(api, symbol, asof, condition):
    query = urllib.parse.urlencode(dict(symbol=symbol, condition=condition, limit=1000))
    return any(p['asof'] == asof and p['symbol'] == symbol and p['condition'] == condition for p in api.request('GET', '/api/predictions?' + query)['predictions'])


def collect(config, api, skill_sha, skill, workers=2, fetcher=fetch_bars, llm=llm_prediction):
    logs, jobs, successes, failures = [], [], 0, 0
    for symbol in config['symbols']:
        try:
            bars = fetcher(symbol)[-config['lookback']:]
            if not bars:
                raise ValueError('No bars')
            asof = bars[-1]['date']
            # 30 bars normally; bridge longer outages so old predictions can mature.
            existing = api.request('GET', '/api/predictions?' + urllib.parse.urlencode(dict(symbol=symbol, limit=1000)))['predictions']
            latest = max((p['asof'] for p in existing), default=asof)
            upload = [b for i, b in enumerate(bars) if i >= len(bars)-30 or b['date'] >= latest]
            api.request('POST', '/api/bars', {'bars': upload})
            for condition in config['conditions']:
                if exists(api, symbol, asof, condition):
                    successes += 1
                    logs.append(f'{symbol} {asof} {condition}: exists, skipped')
                else:
                    jobs.append((symbol, asof, condition, bars))
        except Exception as e:
            failures += 1
            logs.append(f'{symbol}: fetch/API failure ({type(e).__name__}: {str(e)[:120]})')

    def job(args):
        symbol, asof, condition, bars = args
        try:
            if condition in ('skill', 'baseline'):
                log = llm_log.recorder(api, scope='daily', symbol=symbol, session_or_asof=asof, condition=condition)
                p, reading, model = llm(config, condition, symbol, bars, skill, log=log)
            else:
                p, reading, model = mechanical(condition, bars), '', 'mechanical-v1'
            p = {k: p[k] for k in ('always_in', 'p_up_5', 'target', 'stop', 'state', 'horizon_bars')}
            p['horizon'] = p.pop('horizon_bars')
            p.update(symbol=symbol, asof=asof, condition=condition, close=bars[-1]['close'],
                     reading=reading, model=model, skill_sha=skill_sha)
            # Inverted levels are kept (the forecast stands) but flagged for the pages and metrics.
            p['levels_ok'] = llm_log.levels_ok(p['always_in'], p['target'], p['stop'], p['close'])
            api.request('POST', '/api/predictions', p)
            flag = ' levels_ok=false (target/stop on the wrong side of close)' if p['levels_ok'] == 0 else ''
            return True, f'{symbol} {asof} {condition}: saved ({model}){flag}'
        except Exception as e:
            # Do not log raw CLI output, environment values, or exception messages.
            return False, f'{symbol} {asof} {condition}: failed ({type(e).__name__})'
    with cf.ThreadPoolExecutor(max_workers=workers) as executor:
        for ok, log in executor.map(job, jobs):
            successes += int(ok)
            failures += int(not ok)
            logs.append(log)
    return successes, failures, logs


def read_token():
    token = os.environ.get('WRITE_TOKEN')
    if not token:
        path = pathlib.Path.home() / '.config/brooks-forward/token'
        if stat.S_IMODE(path.stat().st_mode) != 0o600:
            raise ValueError('Token file must have mode 600')
        token = path.read_text().strip()
    if not token or '\n' in token or '\r' in token:
        raise ValueError('Invalid WRITE_TOKEN')
    return token


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=pathlib.Path, default=HERE / 'config.json')
    parser.add_argument('--workers', type=int, default=2)
    args = parser.parse_args()
    if args.workers < 1:
        parser.error('--workers must be positive')
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    config = json.loads(args.config.read_text())
    if config.get('timezone') != 'America/Los_Angeles':
        parser.error('Session policy requires America/Los_Angeles')
    skill = (args.config.resolve().parent / config.get('skill_dir', '../../skill/brooks-price-action')).resolve()
    api = API(config['api_base'], read_token())
    sha = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=HERE, check=True,
                         capture_output=True, text=True).stdout.strip()
    success, failures, logs = collect(config, api, sha, skill, args.workers)
    summary = '\n'.join(logs + [f'success_or_skipped={success} failures={failures}'])
    print(summary)
    try:
        api.request('POST', '/api/runs', dict(started_at=started,
                    finished_at=dt.datetime.now(dt.timezone.utc).isoformat(), host=socket.gethostname(),
                    ok=failures == 0, log=summary))
    except Exception:
        print('Run record upload failed')
    return 0 if success else 1


if __name__ == '__main__':
    raise SystemExit(main())
