"""Download ES=F (continuous E-mini futures) daily OHLC from Yahoo Finance into CSV. Usage: fetch_es_yahoo.py out.csv [SYMBOL]"""
import csv, datetime, json, sys, urllib.request
sym = sys.argv[2] if len(sys.argv) > 2 else "ES=F"
url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?period1=1262304000&period2={int(datetime.datetime.now().timestamp())}&interval=1d"
d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60))["chart"]["result"][0]
q = d["indicators"]["quote"][0]
with open(sys.argv[1], "w", newline="") as f:
    w = csv.writer(f); w.writerow(["date", "open", "high", "low", "close"])
    for i, t in enumerate(d["timestamp"]):
        v = [q[k][i] for k in ("open", "high", "low", "close")]
        if None not in v: w.writerow([datetime.datetime.utcfromtimestamp(t).date(), *v])
print("ok")
