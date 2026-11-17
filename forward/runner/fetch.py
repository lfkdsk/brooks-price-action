"""Yahoo daily OHLC, standard library only. No imports trigger requests."""
import datetime as dt
import json
import math
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

PT = ZoneInfo('America/Los_Angeles')


def closed_bars(bars, now=None):
    now = (now or dt.datetime.now(PT)).astimezone(PT)
    # A conservative universal cutoff also covers 10:00 PT early closes.
    today = now.date().isoformat()
    ready = (now.hour, now.minute) >= (13, 15)
    return [b for b in bars if b['date'] < today or (b['date'] == today and ready)]


def fetch_bars(symbol, now=None, attempts=4):
    url = ('https://query1.finance.yahoo.com/v8/finance/chart/' +
           urllib.parse.quote(symbol, safe='') + '?range=5y&interval=1d')
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=60) as response:
                payload = json.load(response)
            result = payload['chart']['result'][0]
            q = result['indicators']['quote'][0]
            rows = {}
            for i, stamp in enumerate(result.get('timestamp', [])):
                values = {k: q[k][i] for k in ('open', 'high', 'low', 'close')}
                if any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0 for v in values.values()):
                    continue
                if values['high'] < max(values.values()) or values['low'] > min(values.values()):
                    continue
                date = dt.datetime.fromtimestamp(stamp, PT).date().isoformat()
                rows[date] = dict(symbol=symbol, date=date, **values)
            bars = closed_bars([rows[d] for d in sorted(rows)], now)
            if not bars:
                raise ValueError('No closed bars')
            return bars
        except (OSError, ValueError, KeyError, TypeError, IndexError):
            if attempt + 1 == attempts:
                raise
            time.sleep(2 ** attempt)
