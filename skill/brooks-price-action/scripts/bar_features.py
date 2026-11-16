#!/usr/bin/env python3
"""Brooks-style bar features from OHLC data (stdlib only, Python 3.9+).

Usage:
  bar_features.py data.csv [--tick 0.25] [--last 60] [--json]

CSV needs columns: time/date/timestamp, open, high, low, close (case-insensitive).
Only CLOSED bars should be passed; the last row is treated as the most recent closed bar.

Every threshold below is an engineering approximation, not a Brooks rule. The output is
evidence for the reader to interpret, never a verdict.
"""
import argparse, csv, json, sys

# ---------- load ----------
def load(path):
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        sys.exit("empty csv")
    keys = {k.lower().strip(): k for k in rows[0]}
    tcol = next((keys[k] for k in ("time", "date", "timestamp", "datetime") if k in keys), None)
    need = [keys.get(k) for k in ("open", "high", "low", "close")]
    if None in need:
        sys.exit("csv needs open/high/low/close columns")
    bars = []
    for i, r in enumerate(rows):
        o, h, l, c = (float(r[k]) for k in need)
        bars.append({"i": i, "t": r[tcol] if tcol else str(i), "o": o, "h": h, "l": l, "c": c})
    return bars

# ---------- per-bar ----------
def ema(vals, n=20):
    k, out, e = 2 / (n + 1), [], None
    for v in vals:
        e = v if e is None else k * v + (1 - k) * e
        out.append(e)
    return out

def atr(bars, n=14):
    out, a = [], None
    for i, b in enumerate(bars):
        tr = b["h"] - b["l"] if i == 0 else max(b["h"], bars[i-1]["c"]) - min(b["l"], bars[i-1]["c"])
        a = tr if a is None else (a * (n - 1) + tr) / n
        out.append(a)
    return out

def classify(bars, tick):
    e = ema([b["c"] for b in bars]); a = atr(bars)
    for i, b in enumerate(bars):
        rng = max(b["h"] - b["l"], tick); body = abs(b["c"] - b["o"])
        b["ema"] = e[i]; b["atr_prev"] = a[i-1] if i else a[0]
        b["body_pct"] = body / rng
        b["close_pos"] = (b["c"] - b["l"]) / rng               # 0 = closed on low, 1 = on high
        b["upper_tail"] = (b["h"] - max(b["o"], b["c"])) / rng
        b["lower_tail"] = (min(b["o"], b["c"]) - b["l"]) / rng
        d = "bull" if b["c"] > b["o"] else "bear" if b["c"] < b["o"] else "doji"
        if b["body_pct"] <= 0.25: d = "doji"
        b["dir"] = d
        tags = []
        if d == "bull" and b["body_pct"] >= 0.6 and b["close_pos"] >= 0.8: tags.append("strong_bull")
        if d == "bear" and b["body_pct"] >= 0.6 and b["close_pos"] <= 0.2: tags.append("strong_bear")
        if rng >= 1.5 * b["atr_prev"]: tags.append("big")
        if rng >= 2.5 * b["atr_prev"]: tags.append("surprise_size")
        if b["lower_tail"] >= 0.35 and b["close_pos"] >= 0.65: tags.append("bull_reversal_shape")
        if b["upper_tail"] >= 0.35 and b["close_pos"] <= 0.35: tags.append("bear_reversal_shape")
        if i:
            p = bars[i-1]
            if b["h"] <= p["h"] and b["l"] >= p["l"]: tags.append("inside")
            if b["h"] >= p["h"] and b["l"] <= p["l"] and (b["h"] > p["h"] or b["l"] < p["l"]): tags.append("outside")
            ov = max(0.0, min(b["h"], p["h"]) - max(b["l"], p["l"])) / max(min(rng, p["h"] - p["l"]), tick)
            b["overlap_prev"] = round(min(ov, 1.0), 2)
            if abs(b["h"] - p["h"]) <= max(tick, 0.1 * b["atr_prev"]): tags.append("micro_double_top")
            if abs(b["l"] - p["l"]) <= max(tick, 0.1 * b["atr_prev"]): tags.append("micro_double_bottom")
        else:
            b["overlap_prev"] = None
        # EMA gap bar: whole bar away from the EMA
        if b["l"] > b["ema"] + tick: b["ema_side"] = "above_gap"
        elif b["h"] < b["ema"] - tick: b["ema_side"] = "below_gap"
        else: b["ema_side"] = "touch"
        b["tags"] = tags
    # consecutive patterns
    for i, b in enumerate(bars):
        p = bars[i-1] if i else None
        b["ii"] = bool(p and "inside" in b["tags"] and "inside" in p["tags"])
        b["oo"] = bool(p and "outside" in b["tags"] and "outside" in p["tags"])

def gap_bar_run(bars):
    """Consecutive bars on the same side of the EMA without touching it (ending at last bar)."""
    side, n = bars[-1]["ema_side"], 0
    if side == "touch": return "touch", 0
    for b in reversed(bars):
        if b["ema_side"] != side: break
        n += 1
    return side, n

# ---------- swings (realtime directional change, no lookahead) ----------
def swings(bars, delta):
    out, trend, ext = [], None, 0
    for i, b in enumerate(bars):
        if trend is None:
            if b["h"] - bars[ext]["l"] >= delta: trend, ext = "up", i
            elif bars[ext]["h"] - b["l"] >= delta: trend, ext = "down", i
            continue
        if trend == "up":
            if b["h"] >= bars[ext]["h"]: ext = i
            elif bars[ext]["h"] - b["l"] >= delta:
                out.append({"type": "SH", "i": ext, "t": bars[ext]["t"], "price": bars[ext]["h"], "known_at": i})
                trend, ext = "down", i
        else:
            if b["l"] <= bars[ext]["l"]: ext = i
            elif b["h"] - bars[ext]["l"] >= delta:
                out.append({"type": "SL", "i": ext, "t": bars[ext]["t"], "price": bars[ext]["l"], "known_at": i})
                trend, ext = "up", i
    return out, trend, ext

def label_swings(sw):
    last = {}
    for s in sw:
        prev = last.get(s["type"])
        if prev:
            hi = s["type"] == "SH"
            if abs(s["price"] - prev["price"]) < 1e-12: s["label"] = "DT" if hi else "DB"
            elif s["price"] > prev["price"]: s["label"] = "HH" if hi else "HL"
            else: s["label"] = "LH" if hi else "LL"
        last[s["type"]] = s
    return sw

# ---------- H/L bar counting (leg-aware state machine) ----------
def bar_counts(bars, delta):
    """High 1/2/3/4 = successive attempts to resume up while price is pulling back from the last up-leg high;
    Low 1/2/3/4 mirror it during a rally from the last down-leg low. An attempt is a bar whose high exceeds
    the prior bar's high (H) / whose low goes below the prior bar's low (L), after at least one bar that did not.
    Counts reset when price makes a new leg extreme (trend resumed) or when the pullback itself becomes a
    confirmed opposite leg of >= 2*delta (context changed). Approximation: Brooks counts legs by judgment."""
    ev = []
    hi_i = lo_i = 0; nh = nl = 0; ph = pl = False
    for i in range(1, len(bars)):
        b, p = bars[i], bars[i-1]
        # up-leg high tracking for H counts
        if b["h"] > bars[hi_i]["h"]:
            hi_i, nh, ph = i, 0, False
        else:
            if b["h"] <= p["h"]: ph = True
            elif ph:
                nh += 1; ph = False
                if bars[hi_i]["h"] - min(x["l"] for x in bars[hi_i:i+1]) >= 2 * delta and nh > 4:
                    hi_i, nh = i, 0
                else:
                    ev.append({"i": i, "t": b["t"], "label": f"H{nh}", "signal_bar_t": p["t"], "buy_stop_above": p["h"]})
            if bars[hi_i]["h"] - b["l"] >= 3 * delta:   # pullback grew into a bear leg: restart reference
                hi_i, nh, ph = i, 0, False
        # down-leg low tracking for L counts
        if b["l"] < bars[lo_i]["l"]:
            lo_i, nl, pl = i, 0, False
        else:
            if b["l"] >= p["l"]: pl = True
            elif pl:
                nl += 1; pl = False
                if nl <= 4:
                    ev.append({"i": i, "t": b["t"], "label": f"L{nl}", "signal_bar_t": p["t"], "sell_stop_below": p["l"]})
            if b["h"] - bars[lo_i]["l"] >= 3 * delta:
                lo_i, nl, pl = i, 0, False
    return [e for e in ev if int(e["label"][1:]) <= 4]

# ---------- range / trend context ----------
def context(bars, n=20):
    w = bars[-n:]
    path = sum(abs(w[k]["c"] - w[k-1]["c"]) for k in range(1, len(w))) or 1e-12
    er = abs(w[-1]["c"] - w[0]["c"]) / path
    ov = [b["overlap_prev"] for b in w if b["overlap_prev"] is not None]
    crosses = sum(1 for k in range(1, len(w)) if (w[k]["c"] - w[k]["ema"]) * (w[k-1]["c"] - w[k-1]["ema"]) < 0)
    hi, lo = max(b["h"] for b in w), min(b["l"] for b in w)
    third = (bars[-1]["c"] - lo) / max(hi - lo, 1e-12)
    bulls = sum(1 for b in w if b["dir"] == "bull"); bears = sum(1 for b in w if b["dir"] == "bear")
    slope = (w[-1]["ema"] - w[0]["ema"]) / max(bars[-1]["atr_prev"], 1e-12)
    mean_ov = sum(ov) / len(ov) if ov else 0
    tr_score = (er < 0.3) + (mean_ov > 0.5) + (crosses >= 4) + (abs(slope) < 1.0)
    # consecutive strong trend bars at the end
    run_dir, run = None, 0
    for b in reversed(bars):
        d = "bull" if "strong_bull" in b["tags"] else "bear" if "strong_bear" in b["tags"] else None
        if d is None or (run_dir and d != run_dir): break
        run_dir, run = d, run + 1
    return {
        "window": n, "efficiency_ratio": round(er, 2), "mean_overlap": round(mean_ov, 2),
        "ema_cross_count": crosses, "ema_slope_atr": round(slope, 2),
        "range_high": hi, "range_low": lo, "close_position_in_range": round(third, 2),
        "range_third": "upper" if third > 2/3 else "lower" if third < 1/3 else "middle",
        "bull_bars": bulls, "bear_bars": bears,
        "trading_range_evidence": f"{tr_score}/4",
        "consecutive_strong_bars": {"dir": run_dir, "count": run},
    }

def wedge_candidates(sw):
    """Three pushes in the same direction among the last swings (loose)."""
    out = []
    for typ, better in (("SH", lambda a, b: a > b), ("SL", lambda a, b: a < b)):
        pts = [s for s in sw if s["type"] == typ][-3:]
        if len(pts) == 3 and better(pts[1]["price"], pts[0]["price"]) and better(pts[2]["price"], pts[1]["price"]):
            d1 = abs(pts[1]["price"] - pts[0]["price"]); d2 = abs(pts[2]["price"] - pts[1]["price"])
            out.append({"kind": "wedge_top_candidate" if typ == "SH" else "wedge_bottom_candidate",
                        "pushes": [p["t"] for p in pts], "prices": [p["price"] for p in pts],
                        "momentum_fading": d2 < d1})
    return out

def to_weekly(bars):
    """Resample daily bars (t = YYYY-MM-DD) into ISO-week bars labelled by the week's first trading day."""
    import datetime
    out, key = [], None
    for b in bars:
        d = datetime.date.fromisoformat(str(b["t"])[:10]); k = d.isocalendar()[:2]
        if k != key:
            out.append({"i": len(out), "t": str(d), "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"]}); key = k
        else:
            w = out[-1]; w["h"] = max(w["h"], b["h"]); w["l"] = min(w["l"], b["l"]); w["c"] = b["c"]
    return out

def summarize(bars, tick, last, delta=None):
    classify(bars, tick)
    delta = delta or bars[-1]["atr_prev"]
    sw, cur_leg, ext = swings(bars, delta); label_swings(sw)
    side, run = gap_bar_run(bars)
    return {"bars": bars, "delta": delta, "swings": sw, "leg": cur_leg, "ext": ext, "gap": (side, run),
            "context": context(bars), "wedges": wedge_candidates(sw),
            "counts": [e for e in bar_counts(bars, delta) if e["i"] >= len(bars) - last]}

def print_weekly(daily, tick):
    wk = to_weekly(daily)
    if len(wk) < 30:
        print("\n[weekly] not enough history for a weekly read"); return
    S = summarize(wk, tick, 12); c = S["context"]; b = wk[-1]
    print(f"\n[weekly] bars={len(wk)} last week starting {b['t']}: O={b['o']} H={b['h']} L={b['l']} C={b['c']} "
          f"dir={b['dir']} close_pos={round(b['close_pos'],2)} tags={','.join(b['tags'])} EMA20w={round(b['ema'],2)}")
    print(f"[weekly] EMA gap run: {S['gap'][1]} bars {S['gap'][0]}  leg: {S['leg']}  ER={c['efficiency_ratio']} "
          f"overlap={c['mean_overlap']} TR evidence={c['trading_range_evidence']} close in {c['range_third']} third  "
          f"consecutive strong={c['consecutive_strong_bars']}")
    print("[weekly] swings:", " ".join(f"{x.get('label', x['type'])}@{x['t']}={x['price']}" for x in S["swings"][-8:]))
    for w in S["wedges"]: print("[weekly] wedge:", w)
    print("[weekly] last 8 weeks:", " | ".join(f"{x['t'][5:]} {x['dir']} cp={round(x['close_pos'],2)}{' '+','.join(x['tags']) if x['tags'] else ''}" for x in wk[-8:]))

def measured_moves(sw, bars):
    """Leg1=Leg2 projections from the last two completed legs, plus the height of the latest range of swings."""
    out = []
    if len(sw) >= 3:
        a, b, c = sw[-3], sw[-2], sw[-1]
        leg = b["price"] - a["price"]
        out.append({"kind": "leg1=leg2", "leg1": f"{a['t']}->{b['t']}", "from": f"{c['t']} {c['price']}",
                    "target": round(c["price"] + leg, 2)})
    if len(sw) >= 4:
        hi = max(x["price"] for x in sw[-4:]); lo = min(x["price"] for x in sw[-4:])
        out.append({"kind": "range-height", "range": [lo, hi], "up_target": round(hi + (hi - lo), 2),
                    "down_target": round(lo - (hi - lo), 2)})
    return out

def print_major(bars, mult):
    delta = bars[-1]["atr_prev"] * mult
    sw, leg, ext = swings(bars, delta); label_swings(sw)
    print(f"\n[major swings, delta={mult}xATR] leg now: {leg} (extreme {bars[ext]['t']})")
    print("  ", " ".join(f"{x.get('label', x['type'])}@{x['t']}={x['price']}" for x in sw[-10:]))
    for w in wedge_candidates(sw): print("   wedge:", w)
    for m in measured_moves(sw, bars): print("   MM:", m)
    # all-time / lookback extremes
    hi = max(bars, key=lambda b: b["h"]); lo = min(bars[-260:], key=lambda b: b["l"])
    print(f"   highest high in data: {hi['t']} {hi['h']}   lowest low in last 260 bars: {lo['t']} {lo['l']}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv"); ap.add_argument("--tick", type=float, default=0.01)
    ap.add_argument("--last", type=int, default=40, help="bars to print in the bar table")
    ap.add_argument("--delta", type=float, default=None, help="swing size; default 1.0 x ATR")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--weekly", action="store_true", help="also print a weekly read resampled from daily bars")
    ap.add_argument("--drop-last", action="store_true", help="drop the last row if that bar has not closed yet")
    a = ap.parse_args()
    bars = load(a.csv)
    if a.drop_last: bars = bars[:-1]
    if len(bars) < 30: sys.exit("need at least 30 bars (EMA warm-up)")
    classify(bars, a.tick)
    delta = a.delta or bars[-1]["atr_prev"] * 1.0
    sw, cur_leg, ext = swings(bars, delta); label_swings(sw)
    side, run = gap_bar_run(bars)
    counts = [e for e in bar_counts(bars, delta) if e["i"] >= len(bars) - a.last]
    res = {
        "n_bars": len(bars), "last_bar": bars[-1]["t"], "last_close": bars[-1]["c"],
        "ema20": round(bars[-1]["ema"], 4), "atr14": round(bars[-1]["atr_prev"], 4),
        "ema_gap_run": {"side": side, "bars": run},
        "current_leg": cur_leg, "current_leg_extreme": {"t": bars[ext]["t"], "high": bars[ext]["h"], "low": bars[ext]["l"]},
        "context": context(bars), "swings": sw[-10:], "wedges": wedge_candidates(sw),
        "bar_count_events": counts[-10:],
        "bars": [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in b.items()
                  if k in ("i", "t", "o", "h", "l", "c", "dir", "body_pct", "close_pos", "overlap_prev", "ema_side", "tags", "ii", "oo")}
                 for b in bars[-a.last:]],
    }
    if a.json:
        print(json.dumps(res, indent=1, default=str)); return
    weekly_src = [dict(i=b["i"], t=b["t"], o=b["o"], h=b["h"], l=b["l"], c=b["c"]) for b in bars]
    c = res["context"]
    print(f"bars={res['n_bars']} last={res['last_bar']} close={res['last_close']} EMA20={res['ema20']} ATR={res['atr14']}")
    print(f"EMA gap run: {run} bars {side}   current leg: {cur_leg}")
    print(f"last {c['window']}: ER={c['efficiency_ratio']} overlap={c['mean_overlap']} EMA crosses={c['ema_cross_count']} "
          f"EMA slope={c['ema_slope_atr']}ATR  TR evidence={c['trading_range_evidence']}  "
          f"close in {c['range_third']} third of {c['range_low']}-{c['range_high']}  bull/bear bars={c['bull_bars']}/{c['bear_bars']}  "
          f"consecutive strong={c['consecutive_strong_bars']}")
    print("swings:", " ".join(f"{s.get('label', s['type'])}@{s['t']}={s['price']}" for s in res["swings"]))
    for w in res["wedges"]: print("wedge:", w)
    print("bar counts:", " ".join(f"{e['label']}@{e['t']}" for e in res["bar_count_events"]))
    print("\n  #  time                 O        H        L        C     dir  body close ovl  ema    tags")
    for b in res["bars"]:
        print(f"{b['i']:>4} {str(b['t'])[:19]:19} {b['o']:>8} {b['h']:>8} {b['l']:>8} {b['c']:>8} {b['dir']:>5} {b['body_pct']:>4} "
              f"{b['close_pos']:>5} {str(b['overlap_prev']):>4} {b['ema_side']:>9} {','.join(b['tags'])}{' ii' if b['ii'] else ''}{' oo' if b['oo'] else ''}")
    print_major(bars, 3.0)
    if a.weekly: print_weekly(weekly_src, a.tick)

if __name__ == "__main__":
    main()
