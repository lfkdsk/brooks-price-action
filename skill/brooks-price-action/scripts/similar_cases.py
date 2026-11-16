#!/usr/bin/env python3
"""Retrieve past Brooks Trading Course readings whose chart state resembles the current one.

Build once:  similar_cases.py build --posts <posts.jsonl> --ohlc <es_daily.csv> --out <index.jsonl>
Query:       similar_cases.py query --index <index.jsonl> --csv bars.csv [--before YYYY-MM-DD] [--k 3]

The index pairs each weekend E-mini report (daily-chart section) with features computed from daily OHLC up to
the Friday before it. Query computes the same features for the given bars and returns the k nearest PAST cases
(strictly before --before, default = last bar date) with their reading text, as few-shot references.
Personal-study use: the index holds post text locally; never publish it.
"""
import argparse, csv, datetime, json, math, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
import bar_features as bf

FEATS = ["er", "overlap", "slope", "gap", "pos", "last_dir", "last_cp", "run", "dist_hi", "major_leg",
         "w_slope", "w_pos", "w_last_dir", "w_gap"]
WEIGHTS = {"er": 1, "overlap": 1, "slope": 1.5, "gap": 1, "pos": 1.5, "last_dir": 1, "last_cp": 1, "run": 1,
           "dist_hi": 1.5, "major_leg": 1, "w_slope": 1.5, "w_pos": 1, "w_last_dir": 1, "w_gap": 1}

def load_rows(path):
    rows = list(csv.DictReader(open(path)))
    k = {c.lower(): c for c in rows[0]}
    t = next(k[c] for c in ("date", "time", "timestamp", "datetime") if c in k)
    return [{"t": r[t][:10], "o": float(r[k["open"]]), "h": float(r[k["high"]]), "l": float(r[k["low"]]),
             "c": float(r[k["close"]])} for r in rows]

def features(rows):
    bars = [dict(i=i, **r) for i, r in enumerate(rows[-700:])]
    if len(bars) < 120: return None
    S = bf.summarize(bars, 0.25, 20); c = S["context"]; L = bars[-1]; atr = L["atr_prev"] or 1
    msw, mleg, _ = bf.swings(bars, atr * 3.0)
    hi = max(b["h"] for b in bars[-260:])
    side, run = S["gap"]
    wk = bf.to_weekly([dict(i=b["i"], t=b["t"], o=b["o"], h=b["h"], l=b["l"], c=b["c"]) for b in bars])
    W = bf.summarize(wk, 0.25, 8) if len(wk) >= 30 else None
    sd = lambda d: 1 if d == "bull" else -1 if d == "bear" else 0
    f = {
        "er": c["efficiency_ratio"], "overlap": c["mean_overlap"], "slope": max(-4, min(4, c["ema_slope_atr"])) / 4,
        "gap": (1 if side == "above_gap" else -1 if side == "below_gap" else 0) * min(run, 20) / 20,
        "pos": c["close_position_in_range"], "last_dir": sd(L["dir"]), "last_cp": L["close_pos"],
        "run": (1 if c["consecutive_strong_bars"]["dir"] == "bull" else -1 if c["consecutive_strong_bars"]["dir"] == "bear" else 0)
               * min(c["consecutive_strong_bars"]["count"], 4) / 4,
        "dist_hi": max(0, min(1, (hi - L["c"]) / (atr * 15))), "major_leg": 1 if mleg == "up" else -1 if mleg == "down" else 0,
    }
    if W:
        wc = W["context"]; wl = wk[-1]; ws, wr = W["gap"]
        f.update({"w_slope": max(-4, min(4, wc["ema_slope_atr"])) / 4, "w_pos": wc["close_position_in_range"],
                  "w_last_dir": sd(wl["dir"]), "w_gap": (1 if ws == "above_gap" else -1 if ws == "below_gap" else 0) * min(wr, 20) / 20})
    else:
        f.update({"w_slope": 0, "w_pos": 0.5, "w_last_dir": 0, "w_gap": 0})
    return {k: round(v, 3) for k, v in f.items()}

def build(a):
    rows = load_rows(a.ohlc); n = 0
    with open(a.out, "w") as fo:
        for l in open(a.posts):
            r = json.loads(l)
            if "Market Analysis" not in r["categories"]: continue
            d = datetime.date.fromisoformat(r["date"][:10])
            if d.weekday() < 5: continue
            secs = {(s["heading"] or "").lower(): s for s in r["sections"]}
            daily = next((s for h, s in secs.items() if "daily" in h and re.search(r"e-?mini|s&p", h) and len(s["text"]) >= 5), None)
            if not daily: continue
            weekly = next((s for h, s in secs.items() if "weekly" in h and re.search(r"e-?mini|s&p", h)), None)
            past = [x for x in rows if x["t"] < r["date"][:10]]
            f = features(past)
            if not f: continue
            fo.write(json.dumps({"id": r["id"], "date": r["date"][:10], "asof": past[-1]["t"], "title": r["title"],
                                 "feat": f, "daily": daily["text"], "weekly": weekly["text"] if weekly else []},
                                ensure_ascii=False) + "\n"); n += 1
    print("indexed", n)

def query(a):
    rows = load_rows(a.csv)
    before = a.before or rows[-1]["t"]
    f = features(rows)
    if not f: sys.exit("need >= 120 bars")
    cands = []
    for l in open(a.index):
        c = json.loads(l)
        if c["asof"] >= before or (a.exclude_id and c["id"] == a.exclude_id): continue
        d = math.sqrt(sum(WEIGHTS[k] * (f[k] - c["feat"][k]) ** 2 for k in FEATS))
        cands.append((d, c))
    cands.sort(key=lambda x: x[0])
    print(f"current features: {f}\n")
    for d, c in cands[: a.k]:
        print(f"=== similar case {c['date']} (as of {c['asof']}, distance {d:.2f}): {c['title']}")
        if c["weekly"]: print("weekly read (excerpt):\n- " + "\n- ".join(c["weekly"][:8]))
        print("daily read:\n- " + "\n- ".join(c["daily"][:14]) + "\n")

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest="cmd", required=True)
    b = sp.add_parser("build"); b.add_argument("--posts", required=True); b.add_argument("--ohlc", required=True); b.add_argument("--out", required=True)
    q = sp.add_parser("query"); q.add_argument("--index", required=True); q.add_argument("--csv", required=True)
    q.add_argument("--before"); q.add_argument("--k", type=int, default=3); q.add_argument("--exclude-id", type=int)
    a = ap.parse_args(); build(a) if a.cmd == "build" else query(a)
