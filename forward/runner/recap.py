"""Generate a Chinese Brooks recap after the regular session has closed."""
import datetime as dt
import urllib.parse

from intraday import (ET, UTC, api_and_sha, fetch_intraday, final_json, finite, prices,
                      run_model, settings, yahoo)


def prior_daily(symbol, today):
    result = yahoo(symbol, 'range=5d&interval=1d')
    quote = result['indicators']['quote'][0]
    for i, stamp in reversed(list(enumerate(result.get('timestamp') or []))):
        session = dt.datetime.fromtimestamp(stamp, ET).date().isoformat()
        values = prices(quote, i)
        if session < today and values:
            return dict(session=session, **{k: values[k] for k in ('close', 'high', 'low')})
    raise ValueError('Previous daily bar unavailable')


def label(value, size=200):
    return isinstance(value, str) and bool(value.strip()) and len(value) <= size


def parse_recap(reading, bars):
    markdown, payload = final_json(reading)
    annotations, levels = payload.get('annotations'), payload.get('levels')
    if (not markdown or len(markdown) > 12000 or not label(payload.get('day_type'))
            or not isinstance(annotations, list) or len(annotations) > 12
            or not isinstance(levels, list) or len(levels) > 30):
        raise ValueError('Invalid recap')
    for a in annotations:
        if (not isinstance(a, dict) or type(a.get('bar')) is not int or a['bar'] not in bars
                or a.get('pos') not in ('above', 'below') or not label(a.get('label'), 120)):
            raise ValueError('Invalid recap annotation')
    for level in levels:
        if (not isinstance(level, dict) or not finite(level.get('price'))
                or level['price'] <= 0 or not label(level.get('label'), 120)):
            raise ValueError('Invalid recap level')
    return dict(day_type=payload['day_type'].strip(), markdown=markdown,
                annotations=annotations, levels=levels)


def collect_recap(config, api, sha, skill, symbol, session, bars, force=False,
                  daily=prior_daily, model=run_model):
    today = [b for b in bars if b['session'] == session]
    if not today:
        return
    api.request('POST', '/api/intraday/bars', {'bars': bars})
    query = urllib.parse.urlencode(dict(symbol=symbol, session=session))
    if not force and api.request('GET', '/api/recaps?' + query)['recaps']:
        return
    numbers = {b['bar'] for b in today}
    if not today[-1]['final'] or numbers != set(range(1, today[-1]['bar'] + 1)):
        raise ValueError('Full regular-session bars unavailable')
    prior = daily(symbol, session)
    prompt = f"""Review the completed {symbol} 5-minute regular session on {session} in bars.csv.
Use earlier sessions as context and prior.json for previous daily close, high and low.
Write a concise Chinese Markdown recap (aim for at most 450 Chinese characters, Brooks terms in English).
Include day type, a numbered-bar narrative with evidence (opening range, breakouts, spikes or climaxes,
reversals, higher lows or lower highs, and tests of breakout points where applicable), key levels,
daily-chart context, what to watch tomorrow, and an educational/non-advice disclaimer.
Finish with a fenced json block of day_type (string), annotations (up to 12 objects containing
bar (today's bar number), label (short string), and pos (above or below)), and levels (objects
containing price (number) and label (string)). Avoid overlapping annotation labels where possible."""
    result, _, actual_model = model(config, bars, skill, prompt, lambda reading: parse_recap(reading, numbers),
                                    context=prior)
    api.request('POST', '/api/recaps', dict(result, symbol=symbol, session=session, model=actual_model,
                                          skill_sha=sha, prior=prior, force=force))
    print(f'{symbol} {session}: recap saved')


def main():
    args, config, skill = settings(__doc__, force=True)
    failures = 0
    connection = None
    for symbol in config.get('intraday_symbols', ['SPY']):
        try:
            now = dt.datetime.now(UTC)
            session = now.astimezone(ET).date().isoformat()
            bars = fetch_intraday(symbol, now)
            if not any(b['session'] == session for b in bars):
                continue
            connection = connection or api_and_sha(config)
            api, sha = connection
            collect_recap(config, api, sha, skill, symbol, session, bars, args.force)
        except Exception as exc:
            print(f'{symbol}: recap failed ({type(exc).__name__}: {str(exc)[:120]})')
            failures += 1
    return int(bool(failures))


if __name__ == '__main__':
    raise SystemExit(main())
