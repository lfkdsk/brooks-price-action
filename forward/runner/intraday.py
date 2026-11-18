"""Collect prospective 5-minute paper signals on regular US sessions."""
import argparse
import concurrent.futures
import csv
import datetime as dt
import json
import math
import os
import pathlib
import re
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

from run_daily import API, HERE, read_token, stage_inputs, unwrap_output

ET = ZoneInfo('America/New_York')
UTC = dt.timezone.utc
OPEN_MINUTE = 9 * 60 + 30
CLOSE_MINUTE = 16 * 60
BAR_MINUTES = 5
CLOSE_BUFFER = 20
CADENCE = range(3, 76, 3)
CONDITIONS = ('skill', 'baseline', 'ema20_5m', 'opening_bar', 'buy_hold')
FIELDS = ('open', 'high', 'low', 'close')


def finite(v):
    try:
        return type(v) in (int, float) and math.isfinite(v)
    except OverflowError:
        return False


def yahoo(symbol, query):
    url = ('https://query1.finance.yahoo.com/v8/finance/chart/' +
           urllib.parse.quote(symbol, safe='') + '?' + query)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.load(response)['chart']['result'][0]
        except (OSError, ValueError, KeyError, TypeError, IndexError):
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def prices(quote, i):
    values = {k: quote[k][i] for k in FIELDS}
    if (all(finite(v) and v > 0 for v in values.values())
            and values['high'] == max(values.values())
            and values['low'] == min(values.values())):
        return values
    return None


def session_bars(symbol, result, now):
    today = now.astimezone(ET).date().isoformat()
    stamps = result.get('timestamp') or []
    if not stamps:
        return []
    quote = result['indicators']['quote'][0]
    meta = result.get('meta', {})
    periods = meta.get('tradingPeriods') or []
    if isinstance(periods, dict):
        periods = periods.get('regular', [])
    regular = [period for day in periods for period in (day if isinstance(day, list) else [day])]
    regular.append(meta.get('currentTradingPeriod', {}).get('regular', {}))
    ends = {}
    for period in regular:
        if period.get('end'):
            end = dt.datetime.fromtimestamp(period['end'], ET)
            ends[end.date()] = end
    rows = {}
    for i, stamp in enumerate(stamps):
        start = dt.datetime.fromtimestamp(stamp, UTC)
        local = start.astimezone(ET)
        minute = local.hour * 60 + local.minute
        session = local.date().isoformat()
        offset = minute - OPEN_MINUTE
        if (local.weekday() >= 5 or not OPEN_MINUTE <= minute < CLOSE_MINUTE or offset % BAR_MINUTES
                or local.second or start + dt.timedelta(minutes=BAR_MINUTES, seconds=CLOSE_BUFFER) > now):
            continue
        end = ends.get(local.date())
        if end and local >= end:
            continue
        values = prices(quote, i)
        if values is None:
            continue
        volume = quote.get('volume')
        volume = volume[i] if volume else None
        rows[stamp] = dict(symbol=symbol, ts=start.isoformat().replace('+00:00', 'Z'),
                           session=session, bar=offset // BAR_MINUTES + 1, **values,
                           volume=volume if finite(volume) and volume >= 0 else None,
                           final=int(minute == CLOSE_MINUTE - BAR_MINUTES
                                     or bool(end and local + dt.timedelta(minutes=BAR_MINUTES) == end)))
    prior = sorted({b['session'] for b in rows.values() if b['session'] < today})[-2:]
    return [b for _, b in sorted(rows.items()) if b['session'] in (*prior, today)]


def fetch_intraday(symbol, now):
    return session_bars(symbol, yahoo(symbol, 'range=5d&interval=5m'), now)


def decisions(bars, existing, now):
    """Return missed points and the sole eligible point, using session bar slots."""
    if not bars:
        return [], None
    last = bars[-1]['bar']
    local = now.astimezone(ET)
    bar_seconds = BAR_MINUTES * 60
    elapsed = (local.hour * 60 + local.minute - OPEN_MINUTE) * 60 + local.second - CLOSE_BUFFER
    due = min(CADENCE[-1], elapsed // bar_seconds)
    # After an early close, repeated timer runs may upload prices but never forecast.
    if bars[-1].get('final'):
        due = min(due, last)
    latest = max((n for n in CADENCE if n <= due), default=0)
    observed = {(p['bar'], p['condition']) for p in existing}
    accounted = {n for n, _ in observed}
    expired = elapsed >= (latest + CADENCE.step) * bar_seconds or bool(bars[-1].get('final') and latest != last)
    missed = [n for n in CADENCE if (n < latest or (n == latest and expired)) and n not in accounted]
    current = latest if not expired and latest in {b['bar'] for b in bars} and (latest, 'missed') not in observed else None
    return missed, current


def final_json(reading):
    blocks = list(re.finditer(r'^```(?:json)?[ \t]*\r?\n(.*?)^[ \t]*```[ \t]*(?:\r?$)',
                              reading, re.I | re.M | re.S))
    if not blocks or reading[blocks[-1].end():].strip():
        raise ValueError('Expected a final fenced JSON block')
    match = blocks[-1]
    value = json.loads(match[1])
    if not isinstance(value, dict):
        raise ValueError('Expected a JSON object')
    return reading[:match.start()].strip(), value


def parse_prediction(reading):
    _, p = final_json(reading)
    side = str(p.get('always_in', '')).strip().lower()
    probability = p.get('p_up_6')
    day_type = p.get('day_type')
    if (side not in ('long', 'short', 'unclear') or not finite(probability)
            or not 0 <= probability <= 1 or not isinstance(day_type, str)
            or not day_type.strip() or len(day_type) > 200
            or any(k not in p or (p[k] is not None and not finite(p[k])) for k in ('target', 'stop'))):
        raise ValueError('Invalid forecast')
    h = p.get('horizon_bars')
    return dict(always_in=side, p_up_6=probability, target=p['target'], stop=p['stop'],
                horizon=h if type(h) is int and 1 <= h <= 12 else 6, day_type=day_type.strip())


def run_model(config, bars, skill, instruction, parse, model=None, context=None):
    if config.get('llm_cli', 'claude') != 'claude':
        raise ValueError('Only Claude CLI is supported')
    with tempfile.TemporaryDirectory(prefix='brooks-intraday-') as name:
        stage = pathlib.Path(name)
        stage_inputs(stage, bars, skill)
        columns = ('session', 'bar', 'timestamp', *FIELDS, 'volume')
        with (stage / 'bars.csv').open('w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=columns, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(dict(b, timestamp=b['ts']) for b in bars)
        if context is not None:
            (stage / 'prior.json').write_text(json.dumps(context))
        if skill:
            features = subprocess.run(
                ['python3', 'skill/scripts/bar_features.py', 'bars.csv', '--last', '78'],
                cwd=stage, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                timeout=30, check=True)
            (stage / 'features.txt').write_text(features.stdout)
            instruction += '\nRead skill/SKILL.md and features.txt before writing. Use the CSV session and bar columns for references.'
        for attempt in range(2):
            prompt = instruction + ('\nThe preceding result was invalid. End with strictly valid JSON.' if attempt else '')
            command = ['claude', '-p', prompt, '--output-format', 'json', '--tools', 'Read',
                       '--allowedTools', 'Read', '--add-dir', str(stage)]
            if model:
                command += ['--model', model]
            proc = subprocess.run(command, cwd=stage, stdin=subprocess.DEVNULL,
                                  capture_output=True, text=True, timeout=600,
                                  env={k: v for k, v in os.environ.items() if k != 'WRITE_TOKEN'})
            if proc.returncode:
                raise RuntimeError(f'Claude exited {proc.returncode}')
            reading, actual_model = unwrap_output(proc.stdout)
            try:
                return parse(reading), reading, actual_model
            except ValueError:
                if attempt:
                    raise


def llm(config, condition, bars, skill):
    b = bars[-1]
    style = 'Use Brooks intraday price action.' if condition == 'skill' else 'Use your own intraday price-action analysis.'
    prompt = f"""Read {b['symbol']} on 5-minute regular-session bars for {b['session']} through bar {b['bar']}.
{style} Read bars.csv. Refer to today's bar numbers and use previous sessions only for context.
Forecast the probability that the same-session close six bars later is strictly above this close.
End with a fenced json block with always_in (long, short or unclear), p_up_6 (number 0–1),
target and stop (number or null), horizon_bars (integer 1–12), and day_type (short label)."""
    return run_model(config, bars, skill if condition == 'skill' else None, prompt,
                     parse_prediction, config.get('intraday_model', 'sonnet'))


def mechanical(condition, bars):
    opening = next((b for b in bars if b['session'] == bars[-1]['session'] and b['bar'] == 1), None)
    ema = bars[0]['close']
    for b in bars[1:]:
        ema += 2 / 21 * (b['close'] - ema)
    if condition == 'opening_bar':
        body = opening['close'] - opening['open'] if opening else 0
        side = ('unclear' if not opening or abs(body) <= .25 * (opening['high'] - opening['low'])
                else 'long' if body > 0 else 'short')
    else:
        side = 'long' if condition == 'buy_hold' or bars[-1]['close'] > ema else 'short'
    return dict(always_in=side, p_up_6=.5, target=None, stop=None, horizon=6, day_type='')


def collect_symbol(config, api, sha, skill, symbol, bars, now, predict=llm):
    session = now.astimezone(ET).date().isoformat()
    today = [b for b in bars if b['session'] == session]
    if not today:
        return 0
    api.request('POST', '/api/intraday/bars', {'bars': bars})
    query = urllib.parse.urlencode(dict(symbol=symbol, session=session, limit=1000))
    existing = api.request('GET', '/api/intraday/predictions?' + query)['predictions']
    missed, current = decisions(today, existing, now)
    by_bar = {b['bar']: b for b in today}

    def save(n, condition, result, reading, model):
        b = by_bar.get(n)
        start = dt.datetime.combine(dt.date.fromisoformat(session), dt.time(9, 30), ET)
        ts = (start + dt.timedelta(minutes=(n - 1) * BAR_MINUTES)).astimezone(UTC)
        api.request('POST', '/api/intraday/predictions',
                    dict(result, symbol=symbol, session=session, bar=n,
                         ts=ts.isoformat().replace('+00:00', 'Z'), condition=condition,
                         close=b['close'] if b else None, reading=reading, model=model,
                         skill_sha=sha if condition in ('skill', 'missed') else ''))

    for n in missed:
        save(n, 'missed', dict(mechanical('buy_hold', bars), always_in='unclear', day_type='missed'),
             'Decision point missed. No forecast was generated.', '')
    if current is None:
        return 0
    recent = [b for b in bars if b['session'] != session or b['bar'] <= current]
    seen = {(p['bar'], p['condition']) for p in existing}

    def job(condition):
        if (current, condition) in seen:
            return 0
        try:
            if condition in ('skill', 'baseline'):
                result, reading, model = predict(config, condition, recent, skill)
            else:
                result, reading, model = mechanical(condition, recent), '', 'mechanical-v1'
            save(current, condition, result, reading, model)
            print(f'{symbol} {session} bar {current} {condition}: saved')
            return 0
        except Exception as exc:
            print(f'{symbol} {session} bar {current} {condition}: {type(exc).__name__}')
            return 1

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(CONDITIONS)) as executor:
        return sum(executor.map(job, CONDITIONS))


def settings(description, force=False):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument('--config', type=pathlib.Path, default=HERE / 'config.json')
    if force:
        parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    skill = (args.config.resolve().parent / config.get('skill_dir', '../../skill/brooks-price-action')).resolve()
    return args, config, skill


def api_and_sha(config):
    sha = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=HERE, check=True,
                         capture_output=True, text=True).stdout.strip()
    return API(config['api_base'], read_token()), sha


def main():
    _, config, skill = settings(__doc__)
    symbols = list(dict.fromkeys(config.get('intraday_symbols', ['SPY'])))

    def collect(symbol):
        try:
            now = dt.datetime.now(UTC)
            bars = fetch_intraday(symbol, now)
            if not any(b['session'] == now.astimezone(ET).date().isoformat() for b in bars):
                return 0
            api, sha = api_and_sha(config)
            return collect_symbol(config, api, sha, skill, symbol, bars, now)
        except Exception as exc:
            print(f'{symbol}: {type(exc).__name__}: {str(exc)[:120]}')
            return 1

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, len(symbols))) as executor:
        return int(bool(sum(executor.map(collect, symbols))))


if __name__ == '__main__':
    raise SystemExit(main())
