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

import llm_log
from run_daily import API, HERE, read_token, stage_inputs, unwrap_output

ET = ZoneInfo('America/New_York')
UTC = dt.timezone.utc
OPEN_MINUTE = 9 * 60 + 30
CLOSE_MINUTE = 16 * 60
BAR_MINUTES = 5
CLOSE_BUFFER = 20
CADENCE = range(3, 76, 3)
CONDITIONS = ('skill', 'skill_chart', 'baseline', 'ema20_5m', 'opening_bar', 'buy_hold')
LLM_CONDITIONS = ('skill', 'skill_chart', 'baseline')
CHART_PYTHON = '~/brooks-price-action/.venv-forward/bin/python'
FIELDS = ('open', 'high', 'low', 'close')


class ChartUnavailable(Exception):
    pass


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


def session_bars_1m(symbol, result, now):
    """Today's closed regular-session 1-minute bars (minute 1 = 09:30 ET), same rules as 5-minute bars."""
    today = now.astimezone(ET).date()
    stamps = result.get('timestamp') or []
    if not stamps:
        return []
    quote = result['indicators']['quote'][0]
    meta = result.get('meta', {})
    end = (meta.get('currentTradingPeriod') or {}).get('regular', {}).get('end')
    end = dt.datetime.fromtimestamp(end, ET) if end else None
    rows = {}
    for i, stamp in enumerate(stamps):
        start = dt.datetime.fromtimestamp(stamp, UTC)
        local = start.astimezone(ET)
        minute = local.hour * 60 + local.minute
        if (local.date() != today or local.weekday() >= 5 or not OPEN_MINUTE <= minute < CLOSE_MINUTE
                or local.second or start + dt.timedelta(minutes=1, seconds=CLOSE_BUFFER) > now
                or (end and end.date() == today and local >= end)):
            continue
        values = prices(quote, i)
        if values is None:
            continue
        volume = quote.get('volume')
        volume = volume[i] if volume else None
        rows[stamp] = dict(symbol=symbol, ts=start.isoformat().replace('+00:00', 'Z'),
                           session=today.isoformat(), minute=minute - OPEN_MINUTE + 1, **values,
                           volume=volume if finite(volume) and volume >= 0 else None)
    return [b for _, b in sorted(rows.items())]


def fetch_intraday_1m(symbol, now):
    return session_bars_1m(symbol, yahoo(symbol, 'range=1d&interval=1m'), now)


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


def run_model(config, bars, skill, instruction, parse, model=None, context=None, *, chart=False, timeout=600, log=None):
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
        if chart:
            python = pathlib.Path(config.get('chart_python', CHART_PYTHON)).expanduser().absolute()
            if not python.is_file() or not os.access(python, os.X_OK):
                raise ChartUnavailable(f'chart Python unavailable at {python}')
            last = bars[-1]
            try:
                subprocess.run(
                    [str(python), str(HERE / 'render_chart.py'), 'bars.csv', 'chart.png',
                     last['symbol'], last['session']],
                    cwd=stage, stdin=subprocess.DEVNULL, capture_output=True, check=True, timeout=30)
            except (OSError, subprocess.SubprocessError) as exc:
                stderr = exc.stderr if isinstance(exc, subprocess.CalledProcessError) else None
                lines = (stderr or b'').decode(errors='replace').strip().splitlines()
                raise ChartUnavailable(lines[-1] if lines else str(exc)) from exc
            if not (stage / 'chart.png').is_file():
                raise ChartUnavailable('renderer did not produce chart.png')
        if context is not None:
            (stage / 'prior.json').write_text(json.dumps(context))
        if skill and not chart:
            features = subprocess.run(
                ['python3', 'skill/scripts/bar_features.py', 'bars.csv', '--last', '78'],
                cwd=stage, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                timeout=30, check=True)
            (stage / 'features.txt').write_text(features.stdout)
            instruction += '\nRead skill/SKILL.md and features.txt before writing. Use the CSV session and bar columns for references.'
        for attempt in range(2):
            prompt = instruction + ('\nThe preceding result was invalid. End with strictly valid JSON.' if attempt else '')
            allowed = ['Read', 'Bash(python3:*)'] if chart else ['Read']
            command = ['claude', '-p', prompt, '--output-format', 'json', '--tools', 'Read,Bash' if chart else 'Read',
                       '--allowedTools', ','.join(allowed), '--add-dir', str(stage)]
            if model:
                command += ['--model', model]
            _, reading, actual_model, finish = llm_log.run_cli(
                subprocess.run, command, log, unwrap_output, cwd=stage, stdin=subprocess.DEVNULL,
                capture_output=True, text=True, timeout=timeout,
                env={k: v for k, v in os.environ.items() if k != 'WRITE_TOKEN'})
            try:
                parsed = parse(reading)
            except ValueError:
                finish(False, 'invalid_output')
                if attempt:
                    raise
                continue
            finish(True)
            return parsed, reading, actual_model


def llm(config, condition, bars, skill, log=None):
    b = bars[-1]
    style = 'Use Brooks intraday price action.' if condition != 'baseline' else 'Use your own intraday price-action analysis.'
    prompt = f"""Read {b['symbol']} on 5-minute regular-session bars for {b['session']} through bar {b['bar']}.
{style} Read bars.csv. Refer to today's bar numbers and use previous sessions only for context.
Forecast the probability that the same-session close six bars later is strictly above this close.
End with a fenced json block with always_in (long, short or unclear), p_up_6 (number 0–1),
target and stop (number or null), horizon_bars (integer 1–12), and day_type (short label)."""
    chart = condition == 'skill_chart'
    if chart:
        prompt = ("Read chart.png first for market structure: swings, ranges, patterns, and price "
                  "relative to EMA20 and prior levels. Then read skill/SKILL.md and take exact "
                  "prices from bars.csv.\n" + prompt)
    return run_model(config, bars, skill if condition != 'baseline' else None, prompt,
                     parse_prediction, config.get('intraday_model', 'sonnet'), chart=chart, timeout=360, log=log)


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
        # Inverted target/stop: keep the forecast, flag it (levels_ok=0) and log it.
        result = dict(result, levels_ok=llm_log.levels_ok(result.get('always_in'), result.get('target'),
                                                           result.get('stop'), b['close'] if b else None))
        if result['levels_ok'] == 0:
            print(f'{symbol} {session} bar {n} {condition}: levels_ok=false (target/stop on the wrong side of close)')
        start = dt.datetime.combine(dt.date.fromisoformat(session), dt.time(9, 30), ET)
        ts = (start + dt.timedelta(minutes=(n - 1) * BAR_MINUTES)).astimezone(UTC)
        api.request('POST', '/api/intraday/predictions',
                    dict(result, symbol=symbol, session=session, bar=n,
                         ts=ts.isoformat().replace('+00:00', 'Z'), condition=condition,
                         close=b['close'] if b else None, reading=reading, model=model,
                         skill_sha=sha if condition in ('skill', 'skill_chart', 'missed') else ''))

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
            if condition in LLM_CONDITIONS:
                log = llm_log.recorder(api, scope='intraday', symbol=symbol, session_or_asof=session, condition=condition)
                result, reading, model = predict(config, condition, recent, skill, log=log)
            else:
                result, reading, model = mechanical(condition, recent), '', 'mechanical-v1'
            save(current, condition, result, reading, model)
            print(f'{symbol} {session} bar {current} {condition}: saved')
            return 0
        except ChartUnavailable as exc:
            print(f'{symbol} {session} bar {current} {condition}: skipped ({exc})')
            return 0
        except Exception as exc:
            print(f'{symbol} {session} bar {current} {condition}: {type(exc).__name__}')
            return 1

    conditions = tuple(dict.fromkeys(config.get('intraday_conditions', CONDITIONS)))
    unknown = set(conditions).difference(CONDITIONS)
    if unknown:
        raise ValueError(f'Unknown intraday conditions: {sorted(unknown)}')
    model_conditions = [condition for condition in conditions if condition in LLM_CONDITIONS]
    with concurrent.futures.ThreadPoolExecutor(max_workers=config.get('intraday_workers', 3)) as executor:
        futures = [executor.submit(job, condition) for condition in model_conditions]
        errors = sum(job(condition) for condition in conditions if condition not in LLM_CONDITIONS)
        return errors + sum(future.result() for future in futures)


def settings(description, force=False, bars_only=False, argv=None):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument('--config', type=pathlib.Path, default=HERE / 'config.json')
    if force:
        parser.add_argument('--force', action='store_true')
        parser.add_argument('--session', help='YYYY-MM-DD (America/New_York) to recap; default = today in New York')
    if bars_only:
        parser.add_argument('--bars-only', action='store_true',
                            help='upload the latest 5-minute and 1-minute bars only (no model calls, no predictions)')
    args = parser.parse_args(argv)
    config = json.loads(args.config.read_text())
    skill = (args.config.resolve().parent / config.get('skill_dir', '../../skill/brooks-price-action')).resolve()
    return args, config, skill


def api_and_sha(config):
    sha = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=HERE, check=True,
                         capture_output=True, text=True).stdout.strip()
    return API(config['api_base'], read_token()), sha


def in_session_window(now):
    """Weekday 09:30–16:10 New York: bars can still arrive, including the final bar."""
    local = now.astimezone(ET)
    minute = local.hour * 60 + local.minute
    return local.weekday() < 5 and OPEN_MINUTE <= minute < CLOSE_MINUTE + 10


def upload_bars(api, symbol, now, fetch=None):
    """Refresh the live chart between decisions: POST bars only, never forecasts."""
    bars = (fetch or fetch_intraday)(symbol, now)
    session = now.astimezone(ET).date().isoformat()
    if not any(b['session'] == session for b in bars):
        return 0
    api.request('POST', '/api/intraday/bars', {'bars': bars})
    return 0


def upload_bars_1m(api, symbol, now, fetch_1m=None):
    """Archive today's closed 1-minute bars (idempotent upsert; the whole session so far each run)."""
    bars = (fetch_1m or fetch_intraday_1m)(symbol, now)
    for i in range(0, len(bars), 1000):
        api.request('POST', '/api/intraday/bars1m', {'bars': bars[i:i + 1000]})
    return 0


def bars_only(config, symbols, now, api=None, fetch=None, fetch_1m=None):
    if not in_session_window(now):
        return 0
    api = api or API(config['api_base'], read_token())
    errors = 0
    for symbol in symbols:
        for kind, upload, source in (('bars', upload_bars, fetch), ('1m bars', upload_bars_1m, fetch_1m)):
            try:
                errors += upload(api, symbol, now, source)
            except Exception as exc:
                print(f'{symbol} {kind}: {type(exc).__name__}: {str(exc)[:120]}')
                errors += 1
    return int(bool(errors))


def main(argv=None):
    args, config, skill = settings(__doc__, bars_only=True, argv=argv)
    symbols = list(dict.fromkeys(config.get('intraday_symbols', ['SPY'])))
    if args.bars_only:
        return bars_only(config, symbols, dt.datetime.now(UTC))

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
