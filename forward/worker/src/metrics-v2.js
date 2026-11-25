// Daily scoring protocol v2. Decision as of close t -> position from open t+1 to open t+2.
// v1 lives unchanged in metrics.js; shared pure helpers are imported from there.
import {account, barrier, calibration, mean, side} from './metrics.js';
import {TS_CONDITIONS, TS_SUFFIX, barExit, countLevels, emptyTsCounts, tradeLevels, utcMillis} from './protocol.js';

const ny = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23'});
const opens = new Map();
// 09:30 New York on a date, in epoch milliseconds.
export function sessionOpenMillis(date) {
 if (!opens.has(date)) {
  const edt = Date.parse(date + 'T13:30:00Z');
  opens.set(date, Number(ny.format(edt)) === 9 ? edt : edt + 3600000);
 }
 return opens.get(date);
}
// A row first stored at or after the fill open could not have traded there (no lookahead): treated as missing.
export function isLate(p, fillDate) {
 const created = utcMillis(p?.created_at);
 return Number.isFinite(created) && created >= sessionOpenMillis(fillDate);
}

// The trade of decision p at index i of one symbol's sorted bars, or null until open[i+2] exists.
export function dailyTrade(p, bb, i, ts = false) {
 const fill = bb[i + 1], end = bb[i + 2];
 if (!fill || !end) return null;
 const late = !!p && isLate(p, fill.date), d = p && !late ? side(p) : 0;
 const levels = ts && d ? tradeLevels(p, d, fill.open) : null;
 const exit = levels && barExit(fill, d, levels);
 return {d, late, fill, end, levels, exit, gross: d * ((exit ? exit.price : end.open) / fill.open - 1)};
}

function periods(bars, preds, cost, ts) {
 const rows = [], counts = {late: 0, ...(ts ? emptyTsCounts() : {})};
 for (const [symbol, bb] of bars) {
  const map = new Map(preds.filter(p => p.symbol === symbol).map(p => [p.asof, p]));
  if (!map.size) continue;
  const first = [...map.keys()].sort()[0];
  let previous = 0;
  for (let i = 0; i + 2 < bb.length; i++) {
   if (bb[i].date < first) continue;
   const t = dailyTrade(map.get(bb[i].date), bb, i, ts);
   let fee = Math.abs(t.d - previous) * cost;
   if (t.levels) countLevels(counts, t.levels, t.exit);
   if (t.exit) fee += Math.abs(t.d) * cost;
   const held = t.exit ? 0 : t.d;
   // Data edge, as in v1: a flat next decision liquidates at the last known open.
   if (i + 3 === bb.length) {
    const next = map.get(bb[i + 1].date);
    if (!next || isLate(next, bb[i + 2].date) || !side(next)) fee += Math.abs(held) * cost;
   }
   rows.push({symbol, asof: bb[i].date, date: t.end.date, return: t.gross - fee, exposure: Math.abs(t.d)});
   previous = held;
  }
  for (const [asof, p] of map) {
   const i = bb.findIndex(b => b.date === asof);
   if (i >= 0 && bb[i + 1] && isLate(p, bb[i + 1].date)) counts.late++;
  }
 }
 return {account: account(rows), counts};
}

function forecasts(bars, preds) {
 const hits = [], bs = [], ll = [], pairs = [], outcomes = {};
 let pending5 = 0, pendingHorizon = 0, missing = 0, mature = 0;
 for (const p of preds) {
  const bb = bars.get(p.symbol) || [], i = bb.findIndex(b => b.date === p.asof);
  if (i < 0) { missing++; continue; }
  const future = bb.slice(i + 1), h = p.horizon ?? 5;
  if (future.length < h) pendingHorizon++;
  else { const o = barrier(p, future, bb[i].close); outcomes[o] = (outcomes[o] || 0) + 1; }
  // Every condition matures after exactly five later bars, whatever horizon it declared.
  if (future.length < 5) { pending5++; continue; }
  mature++;
  const y = +(future[4].close > bb[i].close), d = side(p), q = Math.max(1e-6, Math.min(1 - 1e-6, p.p_up_5));
  if (d) hits.push(+((d === 1) === !!y));
  bs.push((p.p_up_5 - y) ** 2);
  ll.push(-y * Math.log(q) - (1 - y) * Math.log(1 - q));
  pairs.push([p.p_up_5, y]);
 }
 const valid = ['target', 'stop', 'neither'].reduce((a, k) => a + (outcomes[k] || 0), 0);
 return {predictions: preds.length, mature, pending_5: pending5, pending_horizon: pendingHorizon, missing_bars: missing,
  direction_coverage: mature ? hits.length / mature : 0, direction_hit_rate: mean(hits), brier: mean(bs), log_loss: mean(ll),
  calibration: calibration(pairs), target_stop: outcomes, target_before_stop_rate: valid ? (outcomes.target || 0) / valid : null};
}

export function sortedBySymbol(bars) {
 const map = new Map();
 for (const b of bars) { if (!map.has(b.symbol)) map.set(b.symbol, []); map.get(b.symbol).push(b); }
 for (const bb of map.values()) bb.sort((a, b) => a.date.localeCompare(b.date));
 return map;
}

export function computeMetricsV2(bars, predictions, {cost_bps = 2} = {}) {
 const cost = cost_bps / 10000, bySymbol = sortedBySymbol(bars);
 const score = (bb, pp, base) => {
  const f = base || forecasts(bb, pp), run = periods(bb, pp, cost, !!base);
  return {...f, account: run.account, ...run.counts};
 };
 const only = s => new Map(bySymbol.has(s) ? [[s, bySymbol.get(s)]] : []);
 const conditions = {}, per_symbol = {}, paired = {};
 for (const c of [...new Set(predictions.map(p => p.condition))].sort()) {
  const pp = predictions.filter(p => p.condition === c), derived = TS_CONDITIONS.daily.includes(c) ? c + TS_SUFFIX : null;
  conditions[c] = score(bySymbol, pp);
  per_symbol[c] = {};
  if (derived) { conditions[derived] = {...score(bySymbol, pp, conditions[c]), derived_from: c}; per_symbol[derived] = {}; }
  for (const s of new Set(pp.map(p => p.symbol))) {
   const mine = pp.filter(p => p.symbol === s);
   per_symbol[c][s] = score(only(s), mine);
   if (derived) per_symbol[derived][s] = {...score(only(s), mine, per_symbol[c][s]), derived_from: c};
  }
  paired[c] = {};
  for (const m of ['ema20', 'momentum20', 'buy_hold']) {
   if (c === m) continue;
   const key = p => `${p.symbol}/${p.asof}`, baseline = new Map(predictions.filter(p => p.condition === m).map(p => [key(p), p]));
   const matched = pp.filter(p => baseline.has(key(p)));
   const a = score(bySymbol, matched), b = score(bySymbol, matched.map(p => baseline.get(key(p))));
   paired[c][m] = {n: matched.length, candidate: a, baseline: b,
    delta: Object.fromEntries(['direction_hit_rate', 'brier', 'log_loss'].map(k => [k, a[k] == null || b[k] == null ? null : a[k] - b[k]]))};
  }
 }
 return {cost_bps, conditions, per_symbol, paired};
}

// Per-prediction outcome fields for the v2 CSV (gross return, before costs).
export function dailyOutcomeV2(p, bb) {
 const i = bb.findIndex(b => b.date === p.asof);
 if (i < 0) return {outcome_status: 'missing_bar'};
 const future = bb.slice(i + 1), h = p.horizon ?? 5, d = side(p), fifth = future[4];
 const up = fifth ? +(fifth.close > bb[i].close) : null, t = dailyTrade(p, bb, i);
 const x = t && TS_CONDITIONS.daily.includes(p.condition) ? dailyTrade(p, bb, i, true) : null;
 return {fill_date: future[0]?.date ?? null, fill_price: future[0]?.open ?? null,
  fill_status: future[0] && isLate(p, future[0].date) ? 'late' : !future[0] ? 'pending' : d ? 'filled' : 'flat',
  exit_date: t?.end.date ?? null, exit_price: t?.end.open ?? null, period_return: t ? t.gross : null,
  ts_exit: x?.exit?.reason ?? null, ts_exit_price: x?.exit?.price ?? null, ts_return: x ? x.gross : null,
  close_5: fifth?.close ?? null, up_5: up, direction_hit: up == null || !d ? null : +((d === 1) === !!up),
  barrier: future.length < h ? 'pending' : barrier(p, future, bb[i].close), outcome_status: fifth ? 'mature' : 'pending'};
}
