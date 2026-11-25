// Intraday scoring protocol v2: each decision fills at the open of the first 1-minute bar that STARTS at or after
// the moment the decision was stored. Forecast metrics are shared with v1 (intraday-metrics.js).
import {computeIntradayMetrics, decisionBar, finalBar, group, score, sessionKey, side} from './intraday-metrics.js';
import {TS_CONDITIONS, TS_SUFFIX, barExit, countLevels, emptyTsCounts, tradeLevels, utcMillis} from './protocol.js';

const MINUTE = 60000, FIVE = 5 * MINUTE, SLOTS = 78;

// First index whose t >= value in an array sorted by t.
function lower(rows, value) {
 let lo = 0, hi = rows.length;
 while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].t < value) lo = mid + 1; else hi = mid; }
 return lo;
}

// symbol/session -> 1-minute bars sorted by start, each with its start in milliseconds.
export function indexMinutes(rows = []) {
 const map = group(rows.map(b => ({...b, t: Date.parse(b.ts)})), sessionKey);
 for (const list of map.values()) list.sort((a, b) => a.t - b.t);
 return map;
}

// Time layout of one session. The final bar (78, or the flagged early-close bar) ends the session.
// Bar starts are clock slots, so the session start follows from any bar's ts and number.
// Cached per bar array: statistics replay the same session for many conditions and pairings.
const layouts = new WeakMap();
function layout(bb, minutes) {
 const hit = layouts.get(bb);
 if (hit && hit.minutes === minutes && hit.size === bb.length) return hit;
 const L = buildLayout(bb, minutes);
 layouts.set(bb, Object.assign(L, {minutes, size: bb.length, fills: new WeakMap()}));
 return L;
}
function buildLayout(bb, minutes) {
 const last = bb.at(-1), start = Date.parse(last.ts) - (last.bar - 1) * FIVE, final = finalBar(last);
 const lastStart = start + (last.bar - 1) * FIVE, lastEnd = lastStart + FIVE;
 const bars = bb.map(b => ({...b, t: start + (b.bar - 1) * FIVE}));
 const mm = (minutes || []).filter(b => b.t >= start && (!final || b.t < lastEnd));
 const tail = mm.at(-1);
 // In-progress sessions are marked at the newest stored close, never at a close older than a fill.
 const newer = !final && tail && tail.t + MINUTE > lastEnd;
 return {start, final, bars, mm, cutoff: final ? lastStart : start + (SLOTS - 1) * FIVE,
  mark: newer ? tail.close : last.close, markEnd: newer ? tail.t + MINUTE : lastEnd};
}

function findFill(p, L) {
 const none = status => ({p, status, t: null, price: null, source: null});
 const created = utcMillis(p.created_at);
 if (!Number.isFinite(created)) return none('unfilled');
 // A decision cannot use its own bar before that bar has closed, whatever the stored clock says.
 const earliest = Math.max(created, L.start + p.bar * FIVE);
 const pick = rows => { const row = rows[lower(rows, earliest)]; return row && row.t < L.cutoff ? row : null; };
 const one = pick(L.mm), five = pick(L.bars);
 // 1-minute data "covers" the time unless a whole 5-minute bar passes before its next bar.
 const use = one && (!five || one.t < five.t + FIVE) ? one : five;
 if (use) return {p, status: 'filled', t: use.t, price: use.open, source: use === one ? '1m' : '5m'};
 return none(L.final || Math.ceil(earliest / MINUTE) * MINUTE >= L.cutoff ? 'unfilled' : 'pending');
}

// Fill of each decision, in decision order. A fill must start before the session's final bar.
// status: filled | pending | unfilled | superseded (a newer decision fills at the same time or earlier).
export function planFills(bb, minutes, predictions, L = layout(bb, minutes)) {
 const plan = [...predictions].sort((a, b) => a.bar - b.bar).map(p => {
  if (!L.fills.has(p)) L.fills.set(p, findFill(p, L));
  return {...L.fills.get(p)};
 });
 let newer = Infinity;
 for (let i = plan.length - 1; i >= 0; i--) {
  if (plan[i].status !== 'filled') continue;
  if (plan[i].t >= newer) plan[i].status = 'superseded';
  else newer = plan[i].t;
 }
 return plan;
}

// Bars a trade filled at `from` is exposed to before `to`: complete 5-minute slots of 1-minute bars, otherwise the
// 5-minute bar (so a missing minute cannot hide a stop), otherwise whatever minutes exist around the fills.
function exposedBars(L, from, to, price) {
 const out = [];
 const end = Math.min(to, L.markEnd);
 for (let s = L.start + Math.floor((from - L.start) / FIVE) * FIVE; s < end; s += FIVE) {
  const all = L.mm.slice(lower(L.mm, s), lower(L.mm, s + FIVE));
  const five = L.bars[lower(L.bars, s)];
  if (all.length < 5 && five?.t === s && s >= from && s + FIVE <= to) out.push({...five, open: s === from ? price : five.open, end: s + FIVE});
  else for (const b of all) if (b.t >= from && b.t < end) out.push({...b, end: b.t + MINUTE});
 }
 return out;
}

export function simulateSession(bb, predictions, cost, {minutes, ts = false, trace = null} = {}) {
 const L = layout(bb, minutes?.get(sessionKey(bb[0])));
 const plan = planFills(bb, null, predictions, L), filled = plan.filter(f => f.status === 'filled');
 const counts = {unfilled: 0, superseded: 0, ...(ts ? emptyTsCounts() : {})};
 for (const f of plan) if (f.status in counts) counts[f.status]++;
 const base = bb[0].open;
 let entry = base, position = 0, pnl = 0, fees = 0, previous = L.start, exposed = 0;
 filled.forEach((f, i) => {
  const d = side(f.p);
  pnl += position * (f.price - entry) / base;
  fees += Math.abs(d - position) * cost;
  exposed += Math.abs(position) * (f.t - previous);
  position = d;
  entry = f.price;
  previous = f.t;
  if (!ts || !d) return;
  const levels = tradeLevels(f.p, d, f.price);
  let exit = null;
  for (const b of exposedBars(L, f.t, filled[i + 1]?.t ?? Infinity, f.price)) {
   exit = barExit(b, d, levels);
   if (exit) { exit = {...exit, t: b.t, end: b.end}; break; }
  }
  countLevels(counts, levels, exit);
  f.exit = exit;
  if (!exit) return;
  pnl += d * (exit.price - entry) / base;
  fees += Math.abs(d) * cost;
  exposed += Math.abs(d) * (exit.end - previous);
  position = 0;
  previous = exit.end;
 });
 pnl += position * (L.mark - entry) / base;
 exposed += Math.abs(position) * (L.markEnd - previous);
 if (L.final) fees += Math.abs(position) * cost;
 if (trace) trace.push(...plan);
 return {date: bb.at(-1).session, return: pnl - fees, exposure: exposed / (L.markEnd - L.start),
  pending: plan.filter(f => f.status === 'pending').length, final: L.final, counts,
  position: L.final || !position ? 'flat' : position > 0 ? 'long' : 'short'};
}

export function computeIntradayMetricsV2(bars, predictions, {cost_bps = 1, minutes = new Map()} = {}) {
 const out = computeIntradayMetrics(bars, predictions, {cost_bps, simulate: (bb, pp, cost) => simulateSession(bb, pp, cost, {minutes})});
 const sessions = group(bars, sessionKey);
 for (const bb of sessions.values()) bb.sort((a, b) => a.bar - b.bar);
 for (const c of TS_CONDITIONS.intraday) {
  if (!out.conditions[c]) continue;
  const pp = predictions.filter(p => p.condition === c && decisionBar(p.bar));
  out.conditions[c + TS_SUFFIX] = {...score(sessions, pp, cost_bps / 10000, (bb, rows, cost) => simulateSession(bb, rows, cost, {minutes, ts: true})),
   derived_from: c};
 }
 return out;
}

const iso = t => t === null ? null : new Date(t).toISOString().replace('.000', '');

// Positions of one session under v2 plus the fill of every decision (for the chart and the detail sheet).
export function sessionPositionsV2(bars, predictions, conditions, cost_bps, minutes) {
 const groups = group(predictions, p => p.condition), positions = {}, fills = {};
 const sorted = [...bars].sort((a, b) => a.bar - b.bar);
 for (const condition of conditions) {
  const pp = groups.get(condition) || [], derived = TS_CONDITIONS.intraday.includes(condition) ? condition + TS_SUFFIX : null;
  for (const key of derived ? [condition, derived] : [condition]) {
   if (!sorted.length || !pp.length) { positions[key] = {position: 'flat', return: null}; continue; }
   const trace = [], r = simulateSession(sorted, pp, cost_bps / 10000, {minutes, ts: key === derived, trace});
   positions[key] = {position: r.position, return: r.return};
   if (key === condition) {
    const start = Date.parse(sorted[0].ts) - (sorted[0].bar - 1) * FIVE;
    fills[key] = trace.map(f => ({bar: f.p.bar, status: f.status, ts: iso(f.t), price: f.price, source: f.source,
     fill_bar: f.t === null ? null : Math.floor((f.t - start) / FIVE) + 1}));
   }
  }
 }
 return {positions, fills};
}

// Fill fields for the v2 CSV: Map prediction -> columns, for one symbol/session/condition.
export function fillColumns(bb, predictions, minutes) {
 const out = new Map();
 if (!bb.length) return out;
 const ts = TS_CONDITIONS.intraday.includes(predictions[0]?.condition), trace = [];
 simulateSession(bb, predictions, 0, {minutes, ts, trace});
 for (const f of trace) out.set(f.p, {fill_status: f.status, fill_ts: iso(f.t), fill_price: f.price, fill_source: f.source,
  ts_exit: f.exit?.reason ?? null, ts_exit_ts: f.exit ? iso(f.exit.t) : null, ts_exit_price: f.exit?.price ?? null});
 return out;
}
