import {barrier, calibration} from './metrics.js';

export const mechanical = ['ema20_5m', 'opening_bar', 'buy_hold'];
export const decisionBar = n => Number.isInteger(n) && n >= 3 && n <= 75 && n % 3 === 0;
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
export const sessionKey = b => JSON.stringify([b.symbol, b.session]);
const pointKey = p => JSON.stringify([p.symbol, p.session, p.bar]);
export const side = p => p.always_in === 'long' ? 1 : p.always_in === 'short' ? -1 : 0;
export const finalBar = b => b.final === 1 || b.final === true || b.bar === 78;
export function group(rows, key) {
 const groups = new Map();
 for (const row of rows) {
  const k = key(row);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(row);
 }
 return groups;
}

function sessionReturn(bb, predictions, cost) {
 const map = new Map(bb.map(b => [b.bar, b]));
 const last = bb.at(-1);
 const base = bb[0].open;
 let entry = base, position = 0, pnl = 0, fees = 0, previous = 1, exposed = 0, pending = 0;
 for (const p of predictions) {
  const next = map.get(p.bar + 1);
  if (!next) {
   if (!finalBar(last) && p.bar >= last.bar) pending++;
   continue;
  }
  const newPosition = side(p);
  pnl += position * (next.open - entry) / base;
  fees += Math.abs(newPosition - position) * cost;
  exposed += Math.abs(position) * (next.bar - previous);
  position = newPosition;
  entry = next.open;
  previous = next.bar;
 }
 pnl += position * (last.close - entry) / base;
 exposed += Math.abs(position) * (last.bar + 1 - previous);
 if (finalBar(last)) fees += Math.abs(position) * cost;
 return {date: last.session, return: pnl - fees, exposure: exposed / last.bar, pending, final: finalBar(last),
  position: finalBar(last) || !position ? 'flat' : position > 0 ? 'long' : 'short'};
}

export function score(sessions, predictions, cost, simulate = sessionReturn) {
 const rows = [], hits = [], brier = [], losses = [], pairs = [];
 const target_stop = {}, extra = {};
 let pending_6 = 0, pending_horizon = 0, unavailable_6 = 0, unavailable_horizon = 0;
 let missing_bars = 0, pending_entries = 0;
 for (const [key, pp] of group(predictions, sessionKey)) {
  const bb = sessions.get(key);
  if (!bb?.length) {
   missing_bars += pp.length;
   continue;
  }
  pp.sort((a, b) => a.bar - b.bar);
  const row = simulate(bb, pp, cost);
  rows.push(row);
  // Extra per-session counters (v2 only).
  for (const [k, n] of Object.entries(row.counts || {})) extra[k] = (extra[k] || 0) + n;
  pending_entries += row.pending;
  const byNumber = new Map(bb.map(b => [b.bar, b]));
  const last = bb.at(-1);
  const pending = n => !finalBar(last) && n <= 78 && n > last.bar;
  for (const p of pp) {
   const current = byNumber.get(p.bar);
   if (!current) {
    missing_bars++;
    continue;
   }
   const later = byNumber.get(p.bar + 6);
   if (later) {
    const y = +(later.close > current.close);
    const q = Math.max(1e-6, Math.min(1 - 1e-6, p.p_up_6));
    const d = side(p);
    if (d) hits.push(+((d === 1) === !!y));
    brier.push((p.p_up_6 - y) ** 2);
    losses.push(y ? -Math.log(q) : -Math.log(1 - q));
    pairs.push([p.p_up_6, y]);
   } else if (pending(p.bar + 6)) pending_6++;
   else unavailable_6++;
   let outcome = barrier(p, [], current.close);
   if (outcome === 'neither') {
    const future = Array.from({length: p.horizon}, (_, i) => byNumber.get(p.bar + i + 1));
    const firstGap = future.findIndex(b => !b);
    outcome = barrier(p, firstGap < 0 ? future : future.slice(0, firstGap), current.close);
    if (outcome === 'neither' && firstGap >= 0) {
     if (future.every((b, i) => b || pending(p.bar + i + 1))) pending_horizon++;
     else unavailable_horizon++;
     continue;
    }
   }
   target_stop[outcome] = (target_stop[outcome] || 0) + 1;
  }
 }
 let equity = 1, peak = 1, max_drawdown = 0;
 const equity_curve = [...group(rows, r => r.date)].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => {
  const ret = mean(day.map(r => r.return));
  equity *= 1 + ret;
  peak = Math.max(peak, equity);
  max_drawdown = Math.max(max_drawdown, 1 - equity / peak);
  return {date, return: ret, equity, exposure: mean(day.map(r => r.exposure)), final: day.every(r => r.final)};
 });
 const daily = equity_curve.filter(r => r.final).map(r => r.return);
 const avg = mean(daily);
 const variance = daily.length > 1 ? daily.reduce((a, r) => a + (r - avg) ** 2, 0) / (daily.length - 1) : 0;
 const valid = ['target', 'stop', 'neither'].reduce((n, k) => n + (target_stop[k] || 0), 0);
 return {
  decisions: predictions.length, mature: brier.length, pending_6, pending_horizon, pending_entries,
  unavailable_6, unavailable_horizon, missing_bars,
  direction_coverage: brier.length ? hits.length / brier.length : 0,
  direction_hit_rate: mean(hits), brier: mean(brier), log_loss: mean(losses), calibration: calibration(pairs), target_stop,
  target_before_stop_rate: valid ? (target_stop.target || 0) / valid : null,
  account: {days: equity_curve.length, total_return: equity - 1, max_drawdown,
   annualized_sharpe: variance ? avg / Math.sqrt(variance) * Math.sqrt(252) : null,
   exposure: mean(equity_curve.map(r => r.exposure)), equity_curve},
  ...extra
 };
}

// Per-decision outcome fields for exports, with the same +6 and barrier rules as score().
// bb: that symbol/session's bars sorted by bar number.
export function intradayOutcome(p, bb) {
 const byNumber = new Map(bb.map(b => [b.bar, b]));
 const current = byNumber.get(p.bar);
 if (!current || p.condition === 'missed') return {outcome_status: current ? 'missed' : 'missing_bar'};
 const last = bb.at(-1);
 const open = !finalBar(last);
 const later = byNumber.get(p.bar + 6);
 const d = side(p);
 const up = later ? +(later.close > current.close) : null;
 let outcome = barrier(p, [], current.close);
 if (outcome === 'neither') {
  const future = Array.from({length: p.horizon}, (_, i) => byNumber.get(p.bar + i + 1));
  const gap = future.findIndex(b => !b);
  outcome = barrier(p, gap < 0 ? future : future.slice(0, gap), current.close);
  if (outcome === 'neither' && gap >= 0) outcome = open && p.bar + gap + 1 > last.bar ? 'pending' : 'unavailable';
 }
 return {close_6: later?.close ?? null, up_6: up, direction_hit: up == null || !d ? null : +((d === 1) === !!up),
  barrier: outcome, outcome_status: later ? 'mature' : open && p.bar + 6 > last.bar ? 'pending' : 'unavailable'};
}

export function sessionPositions(bars, predictions, conditions, cost_bps) {
 const groups = group(predictions, p => p.condition);
 return Object.fromEntries(conditions.map(condition => {
  const decisions = (groups.get(condition) || []).sort((a, b) => a.bar - b.bar);
  if (!bars.length || !decisions.length) return [condition, {position: 'flat', return: null}];
  const result = sessionReturn(bars, decisions, cost_bps / 10000);
  return [condition, {position: result.position, return: result.return}];
 }));
}

export function computeIntradayMetrics(bars, predictions, {cost_bps = 1, simulate = sessionReturn} = {}) {
 const sessions = group(bars, sessionKey);
 for (const bb of sessions.values()) bb.sort((a, b) => a.bar - b.bar);
 const valid = predictions.filter(p => decisionBar(p.bar));
 const groups = group(valid.filter(p => p.condition !== 'missed'), p => p.condition);
 const conditions = Object.create(null), paired = Object.create(null);
 for (const [condition, pp] of groups) {
  conditions[condition] = score(sessions, pp, cost_bps / 10000, simulate);
  paired[condition] = {};
  for (const m of condition === 'skill_chart' ? [...mechanical, 'skill'] : mechanical) {
   if (m === condition) continue;
   const baseline = new Map((groups.get(m) || []).map(p => [pointKey(p), p]));
   const matched = pp.filter(p => baseline.has(pointKey(p)));
   const a = score(sessions, matched, cost_bps / 10000, simulate);
   const b = score(sessions, matched.map(p => baseline.get(pointKey(p))), cost_bps / 10000, simulate);
   const delta = {};
   for (const k of ['direction_hit_rate', 'direction_coverage', 'brier', 'log_loss', 'target_before_stop_rate']) {
    delta[k] = a[k] == null || b[k] == null ? null : a[k] - b[k];
   }
   for (const k of ['total_return', 'annualized_sharpe', 'max_drawdown', 'exposure']) {
    delta[k] = !matched.length || a.account[k] == null || b.account[k] == null ? null : a.account[k] - b.account[k];
   }
   paired[condition][m] = {n: matched.length, candidate: a, baseline: b, delta};
  }
 }
 return {cost_bps, conditions, paired, missed: valid.filter(p => p.condition === 'missed').length};
}
