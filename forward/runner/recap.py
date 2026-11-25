"""Generate a Chinese Brooks recap after the regular session has closed."""
import datetime as dt
import urllib.parse

import llm_log
from intraday import (ET, UTC, api_and_sha, fetch_intraday, final_json, finite, prices,
                      run_model, settings, yahoo)


def prior_daily(symbol, today):
    """Previous daily close/high/low plus the last ~60 completed daily bars, daily EMA20 and 3-month extremes."""
    result = yahoo(symbol, 'range=6mo&interval=1d')
    quote = result['indicators']['quote'][0]
    daily = []
    for i, stamp in enumerate(result.get('timestamp') or []):
        session = dt.datetime.fromtimestamp(stamp, ET).date().isoformat()
        values = prices(quote, i)
        if session < today and values:
            daily.append(dict(date=session, **{k: round(values[k], 2) for k in ('open', 'high', 'low', 'close')}))
    if not daily:
        raise ValueError('Previous daily bar unavailable')
    ema, k = daily[0]['close'], 2 / 21
    for d in daily:
        ema = k * d['close'] + (1 - k) * ema
    last = daily[-1]
    recent = daily[-63:]
    return dict(session=last['date'], close=last['close'], high=last['high'], low=last['low'],
                daily_ema20=round(ema, 2), high_3m=max(d['high'] for d in recent),
                low_3m=min(d['low'] for d in recent), recent_daily=daily[-60:])


def voo_mapping(session, symbol_close_today=None):
    """VOO tracks the same index as SPY; return VOO's close on `session` and the VOO/SPY price ratio."""
    try:
        out = {}
        for sym in ('VOO', 'SPY'):
            result = yahoo(sym, 'range=10d&interval=1d')
            quote = result['indicators']['quote'][0]
            for i, stamp in enumerate(result.get('timestamp') or []):
                day = dt.datetime.fromtimestamp(stamp, ET).date().isoformat()
                values = prices(quote, i)
                if day == session and values:
                    out[sym] = round(values['close'], 2)
        if len(out) == 2:
            return dict(voo_close=out['VOO'], spy_close=out['SPY'], voo_per_spy=round(out['VOO'] / out['SPY'], 5))
    except Exception:
        pass
    return None


def voo_signals(session, since='2026-11-12', zone2=645, zone3=627, reclaim=660):
    """Deterministic VOO tranche-signal check on completed daily bars up to `session` (markdown section or None).

    Signal bar: bull close in the top 40% of its range. Tranche 2: signal bar with low <= zone2, confirmed the next
    day by a higher close without a lower low. Tranche 3: same with low <= zone3, or a reclaim of `reclaim` after the
    cycle low followed by a higher low and a close above the prior day's high. Public page: no personal holdings."""
    try:
        result = yahoo('VOO', 'range=6mo&interval=1d')
        quote = result['indicators']['quote'][0]
        bars = []
        for i, stamp in enumerate(result.get('timestamp') or []):
            day = dt.datetime.fromtimestamp(stamp, ET).date().isoformat()
            v = prices(quote, i)
            if v and day <= session:
                bars.append(dict(day=day, **{k: v[k] for k in ('open', 'high', 'low', 'close')}))
        if len(bars) < 3 or bars[-1]['day'] != session:
            return None
    except Exception:
        return None
    def sig(b):
        rng = b['high'] - b['low']
        return rng > 0 and b['close'] > b['open'] and (b['close'] - b['low']) / rng >= 0.6
    t, y = bars[-1], bars[-2]
    cycle = [b for b in bars if b['day'] >= since]
    low_i = min(range(len(cycle)), key=lambda i: cycle[i]['low']) if cycle else None
    L = cycle[low_i]['low'] if cycle else None
    lines = []
    for name, zone in (('第二批', zone2), ('第三批', zone3)):
        if sig(y) and y['low'] <= zone and t['low'] >= y['low'] and t['close'] > y['close']:
            lines.append(f'- 🔔 **{name}信号已确认**：{y["day"]} 在 {zone} 下方出现止跌阳线（低 {y["low"]:.2f}），今天没有创新低并收高（{t["close"]:.2f}）——止跌K线 + follow-through。')
        elif sig(t) and t['low'] <= zone:
            lines.append(f'- 🔔 **{name}：出现止跌信号K线，待下一交易日确认**（今天低 {t["low"]:.2f} ≤ {zone}，收在高位 {t["close"]:.2f}）。')
    if cycle:
        after = cycle[low_i + 1:]
        reclaimed = [i for i, b in enumerate(after) if b['close'] >= reclaim]
        if reclaimed:
            post = after[reclaimed[0] + 1:]
            if post and min(b['low'] for b in post) > L and len(post) >= 2 and t['close'] > y['high']:
                lines.append(f'- 🔔 **第三批：反转确认**：收回 {reclaim} 后回调低点高于本轮最低 {L:.2f}（higher low），今天收盘 {t["close"]:.2f} 突破昨高。')
            elif reclaimed[0] == len(after) - 1:
                lines.append(f'- 👀 **VOO 收回 {reclaim}**（今天收 {t["close"]:.2f}）：反转尝试，等待回调形成 higher low。')
    if not lines:
        lines.append(f'- 暂无信号。今天 VOO 收 {t["close"]:.2f}，低 {t["low"]:.2f}，高 {t["high"]:.2f}；'
                     f'距第二批区域上沿 {zone2}：{t["low"] - zone2:+.2f}，距第三批 {zone3}：{t["low"] - zone3:+.2f}，距收回 {reclaim}：{reclaim - t["close"]:+.2f}。')
    lines.append(f'- 参考区域：第二批 634–{zone2}；第三批 620–{zone3}，或收回 {reclaim} 后出现 higher low。本轮最低 {L:.2f}。' if L else '')
    return '**VOO 分批信号**\n' + '\n'.join(l for l in lines if l)


def label(value, size=200):
    return isinstance(value, str) and bool(value.strip()) and len(value) <= size


def parse_recap(reading, bars):
    markdown, payload = final_json(reading)
    # Drop any conversational preamble ("I have everything I need…", a leading '---') before the recap body.
    lines = (markdown or '').splitlines()
    start = next((i for i, l in enumerate(lines) if l.lstrip().startswith(('#', '**'))), 0)
    markdown = '\n'.join(lines[start:]).strip()
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
    voo = voo_mapping(session) if symbol == 'SPY' else None
    if voo:
        prior = dict(prior, voo=voo)
    prompt = f"""Review the completed {symbol} 5-minute regular session on {session} in bars.csv.
Use earlier sessions as context. prior.json has the previous daily close/high/low, the daily EMA20,
3-month high/low and recent_daily (the last ~60 completed daily bars, oldest first) for daily-chart context.
Write a concise Chinese Markdown recap (aim for at most 650 Chinese characters, Brooks terms in English).
START with a section headed exactly "**整体判断**" (3-6 short lines): the daily-chart picture (trend or trading
range, Always In direction, where price is vs the daily EMA20 and recent swings, any measured-move target reached,
climax or not); then the next 1-3 trading days as two or three scenarios with rough Brooks-style odds that sum to
about 100% (e.g. 反弹/回调 约60%, 继续下跌 约40%), each with its price zone; the single most important level and what
would change the view. Be honest about uncertainty; no buy/sell instructions.
If prior.json has "voo" (VOO tracks the same S&P 500 index; voo_per_spy is today's VOO/SPY price ratio), then wherever
you give a key SPY level in 整体判断 and in the "明日关注" part, also give the VOO equivalent as "SPY 710（VOO ≈ 652）"
(multiply by voo_per_spy, round to whole dollars), and end 明日关注 with one line headed "**VOO 视角**" for long-term
holders (VOO cannot be shorted in a cash account): which VOO zones are support worth watching and what Brooks-style
signal (e.g. strong bull reversal bar with follow-through, higher low / double bottom) would confirm a bottom vs a
bear-flag bounce. Educational only, no orders or position sizes. Write for a human reader: never paste raw feature-script tags (strong_bull, bull_reversal_shape, big, wedge_bottom_candidate,
micro_double_top…) — say it in words ("强阳线", "收在高位的反转K线", "wedge bottom 候选"). day_type in the JSON must be a short
readable phrase with spaces (e.g. "Bear trend day, late sell climax"), not snake_case. Then continue with day type, a numbered-bar narrative with evidence (opening range, breakouts, spikes or climaxes,
reversals, higher lows or lower highs, and tests of breakout points where applicable), key levels,
daily-chart context, what to watch tomorrow, and an educational/non-advice disclaimer.
Finish with a fenced json block of day_type (string), annotations (up to 12 objects containing
bar (today's bar number), label (short string), and pos (above or below)), and levels (objects
containing price (number) and label (string)). Avoid overlapping annotation labels where possible."""
    log = llm_log.recorder(api, scope='recap', symbol=symbol, session_or_asof=session, condition='recap')
    result, _, actual_model = model(config, bars, skill, prompt, lambda reading: parse_recap(reading, numbers),
                                    config.get('recap_model'), context=prior, log=log)
    if symbol == 'SPY':
        section = voo_signals(session)
        if section:
            result = dict(result, markdown=result['markdown'].rstrip() + '\n\n' + section)
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
            session = getattr(args, 'session', None) or now.astimezone(ET).date().isoformat()
            bars = fetch_intraday(symbol, now)
            if not any(b['session'] == session for b in bars):
                print(f'{symbol} {session}: no regular-session bars (holiday, not yet open, or outside the 5-day window)')
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
