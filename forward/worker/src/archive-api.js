// Archive routes: 1-minute bars, LLM call log, metrics snapshots, the /explore page and its
// JSON/CSV APIs. All statistics come from metrics.js / intraday-metrics.js (no duplicated math).
import {computeMetrics, dailyOutcome} from './metrics.js';
import {computeIntradayMetrics, intradayOutcome} from './intraday-metrics.js';
import {computeMetricsV2, dailyOutcomeV2} from './metrics-v2.js';
import {computeIntradayMetricsV2, fillColumns, indexMinutes} from './intraday-metrics-v2.js';
import {loadMinutes} from './minutes.js';
import {PROTOCOL_FROM, TS_CONDITIONS, TS_SUFFIX, protocolFor, tagProtocol} from './protocol.js';
import {explorePage} from './explore-page.js';

export const archiveWrites = ['/api/intraday/bars1m', '/api/llm_calls'];
const reads = ['/explore', '/api/explore', '/api/export.csv', '/api/snapshots'];
const SCOPES = ['daily', 'intraday'];
const CALL_SCOPES = ['daily', 'intraday', 'recap'];
const ROLLING = 20;
const MAX_ROLLING_POINTS = 250;
const ny = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York',
 year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
const BAR_COLS = ['symbol', 'ts', 'session', 'minute', 'open', 'high', 'low', 'close', 'volume'];
const CALL_COLS = ['ts', 'scope', 'symbol', 'session_or_asof', 'condition', 'model', 'duration_ms',
 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cost_usd', 'ok', 'error_type'];
const SNAP_COLS = ['scope', 'as_of', 'condition', 'symbol', 'metrics_json', 'rolling20_json', 'created_at'];
const html = body => new Response(body, {headers: {'content-type': 'text/html; charset=utf-8'}});

// One-minute bar starts: 09:30 ET is minute 1, 15:59 ET is minute 390.
export function minuteStamp(row) {
 if (typeof row.ts !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00(?:\.000)?Z$/.test(row.ts)) return false;
 const millis = Date.parse(row.ts);
 if (!Number.isFinite(millis)) return false;
 const d = Object.fromEntries(ny.formatToParts(millis).map(p => [p.type, p.value]));
 return row.session === `${d.year}-${d.month}-${d.day}` && Number(d.hour) * 60 + Number(d.minute) === 570 + row.minute - 1;
}

// Upsert many rows with a single binding (keeps D1 within its bound-parameter limits).
const jsonInsert = (table, cols, conflict) => `INSERT INTO ${table}(${cols.join(',')})
 SELECT ${cols.map((_, i) => `json_extract(value,'$[${i}]')`).join(',')} FROM json_each(?) WHERE 1 ${conflict}`;

// Cumulative metrics under one protocol. v2 intraday needs `minutes` (indexMinutes).
function compute(scope, bars, preds, {cost_bps, version = 1, minutes} = {}) {
 const opts = cost_bps == null ? {} : {cost_bps};
 if (version === 2) return scope === 'daily' ? computeMetricsV2(bars, preds, opts) : computeIntradayMetricsV2(bars, preds, {...opts, minutes});
 return scope === 'daily' ? computeMetrics(bars, preds, opts) : computeIntradayMetrics(bars, preds, opts);
}

// Rolling window ending at `end`: the last ROLLING trading dates/sessions with data up to `end` only,
// i.e. what was known on that day (later outcomes stay pending, as in a snapshot taken then).
export function rollingWindow(scope, bars, preds, end, options = {}) {
 const key = scope === 'daily' ? 'date' : 'session', pkey = scope === 'daily' ? 'asof' : 'session';
 const dates = [...new Set(bars.map(b => b[key]).filter(d => d <= end))].sort().slice(-ROLLING);
 if (!dates.length) return null;
 const start = dates[0];
 const bb = bars.filter(b => b[key] >= start && b[key] <= end), pp = preds.filter(p => p[pkey] >= start && p[pkey] <= end);
 return compute(scope, bb, pp, options);
}

// Snapshots drop the equity curve (recomputable, and quadratic to store over time).
const slim = m => m && {...m, account: m.account && {...m.account, equity_curve: undefined}};

export function snapshotRows(scope, bars, preds, {created_at = new Date().toISOString(), ...opts} = {}) {
 const key = scope === 'daily' ? 'date' : 'session';
 const asOf = bars.map(b => b[key]).sort().at(-1);
 if (!asOf || !preds.length) return [];
 const total = compute(scope, bars, preds, opts);
 const rolling = rollingWindow(scope, bars, preds, asOf, opts);
 const rows = [];
 for (const [condition, m] of Object.entries(total.conditions)) {
  rows.push([scope, asOf, condition, '*', JSON.stringify(slim(m)), JSON.stringify(slim(rolling?.conditions?.[condition]) ?? null), created_at]);
  if (scope !== 'daily') continue;
  for (const [sym, ms] of Object.entries(total.per_symbol[condition] || {}))
   rows.push([scope, asOf, condition, sym, JSON.stringify(slim(ms)), JSON.stringify(slim(rolling?.per_symbol?.[condition]?.[sym]) ?? null), created_at]);
 }
 return rows;
}

// v1 reads whole tables without a filter (its row order, hence its float sums, must not change); v2 reads from `from`.
async function loadAll(db, scope, from = null) {
 const q = async (sql, key) => (from ? await db.prepare(sql.replace('%', ' WHERE ' + key + '>=?')).bind(from).all() :
  await db.prepare(sql.replace('%', '')).bind().all()).results;
 return scope === 'daily' ?
  Promise.all([q('SELECT symbol,date,open,high,low,close FROM bars% ORDER BY symbol,date', 'date'),
   q('SELECT symbol,asof,condition,always_in,p_up_5,target,stop,horizon,created_at FROM predictions% ORDER BY symbol,asof', 'asof')]) :
  Promise.all([q('SELECT symbol,ts,session,bar,open,high,low,close,final FROM ibars%', 'session'),
   q('SELECT symbol,session,bar,condition,always_in,p_up_6,target,stop,horizon,created_at FROM ipredictions%', 'session')]);
}

// Cron entry point: idempotent upsert of today's cumulative + rolling-20 metrics for both scopes and both protocols.
export async function runSnapshots(db, {intradayCostBps = 1, created_at} = {}) {
 const all = async (_, sql, args) => (await db.prepare(sql).bind(...args).all()).results;
 const cost = scope => scope === 'intraday' && Number.isFinite(intradayCostBps) ? intradayCostBps : undefined;
 const store = async (table, rows) => {
  if (!rows.length) return 0;
  await db.prepare(jsonInsert(table, SNAP_COLS,
   'ON CONFLICT(scope,as_of,condition,symbol) DO UPDATE SET metrics_json=excluded.metrics_json,rolling20_json=excluded.rolling20_json,created_at=excluded.created_at'))
   .bind(JSON.stringify(rows)).run();
  return rows.length;
 };
 let count = 0;
 for (const scope of SCOPES) {
  const [bars, preds] = await loadAll(db, scope);
  count += await store('metrics_snapshots', snapshotRows(scope, bars, preds, {cost_bps: cost(scope), created_at}));
 }
 // v2 runs after every v1 row is stored, so nothing here can cost a v1 snapshot.
 for (const scope of SCOPES) {
  const from = PROTOCOL_FROM[scope];
  const [bars, preds] = await loadAll(db, scope, from);
  if (!preds.length) continue;
  const minutes = scope === 'intraday' ? indexMinutes(await loadMinutes(all, db, {from})) : undefined;
  const rows = snapshotRows(scope, bars, preds, {cost_bps: cost(scope), created_at, version: 2, minutes});
  try { count += await store('metrics_snapshots_v2', rows); }
  catch (e) { if (!/no such table/i.test(String(e?.message))) throw e; } // before migration 0005
 }
 return count;
}

// RFC 4180 CSV: quote fields with separators/quotes/newlines; neutralize spreadsheet formulas.
export function csvCell(v) {
 if (v === null || v === undefined) return '';
 if (typeof v === 'boolean') return v ? '1' : '0';
 let s = String(v);
 if (typeof v === 'string' && /^[=+@\t\r]|^-(?![\d.])/.test(s)) s = "'" + s;
 return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const toCsv = (cols, rows) => [cols, ...rows.map(r => cols.map(k => r[k]))].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function archiveRoutes({json, date, number, symbol, text, all}) {
 const invalid = kind => json({error: 'Invalid ' + kind}, 400);
 const count = v => v === null || v === undefined || (Number.isInteger(v) && v >= 0);
 const maybe = (v, check) => v === null || v === undefined || check(v);

 async function write(path, body, db) {
  if (!body || typeof body !== 'object') return invalid('body');
  if (path === '/api/intraday/bars1m') {
   const rows = body.bars;
   if (!Array.isArray(rows) || !rows.length || rows.length > 2000 || rows.some(b => !b || !symbol(b.symbol) || !date(b.session) ||
    !Number.isInteger(b.minute) || b.minute < 1 || b.minute > 390 || !minuteStamp(b) ||
    !['open', 'high', 'low', 'close'].every(k => number(b[k]) && b[k] > 0) ||
    b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close) ||
    (b.volume != null && (!number(b.volume) || b.volume < 0)))) return invalid('bars');
   const values = rows.map(b => BAR_COLS.map(k => k === 'ts' ? new Date(b.ts).toISOString().replace('.000', '') : b[k] ?? null));
   const revised = BAR_COLS.slice(4);
   await db.prepare(jsonInsert('ibars1m', BAR_COLS, `ON CONFLICT(symbol,ts) DO UPDATE SET ${revised.map(k => `${k}=excluded.${k}`).join(',')}
    WHERE ${revised.map(k => `ibars1m.${k} IS NOT excluded.${k}`).join(' OR ')}`)).bind(JSON.stringify(values)).run();
   return json({ok: true, count: rows.length});
  }
  const calls = Array.isArray(body.calls) ? body.calls : [body];
  if (!calls.length || calls.length > 200 || calls.some(c => !c || typeof c !== 'object' ||
   !text(c.ts, 40) || !Number.isFinite(Date.parse(c.ts)) || !CALL_SCOPES.includes(c.scope) ||
   !maybe(c.symbol, symbol) || !maybe(c.session_or_asof, date) || !maybe(c.condition, v => text(v, 60)) ||
   !maybe(c.model, v => text(v, 200)) || !maybe(c.error_type, v => text(v, 60)) ||
   !['duration_ms', 'input_tokens', 'output_tokens', 'cache_read_tokens'].every(k => count(c[k])) ||
   !maybe(c.cost_usd, v => number(v) && v >= 0) || ![true, false, 0, 1].includes(c.ok))) return invalid('llm call');
  const values = calls.map(c => CALL_COLS.map(k => k === 'ok' ? +c.ok : c[k] ?? null));
  await db.prepare(jsonInsert('llm_calls', CALL_COLS, '')).bind(JSON.stringify(values)).run();
  return json({ok: true, count: calls.length});
 }

 // Shared filter parsing for /api/explore, /api/export.csv and /api/snapshots.
 function filters(params) {
  const scope = params.get('scope') || 'daily';
  const protocol = protocolFor(SCOPES.includes(scope) ? scope : 'daily', params);
  const from = params.get('from') || null, to = params.get('to') || null;
  const sym = params.get('symbol') && params.get('symbol') !== 'all' ? params.get('symbol') : null;
  const raw = params.get('conditions');
  const conditions = raw ? [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))] : null;
  if (!protocol || !SCOPES.includes(scope) || (from && !date(from)) || (to && !date(to)) || (from && to && from > to) ||
   (sym && !symbol(sym)) || (conditions && (conditions.length > 20 || conditions.some(c => !/^[\w.-]{1,60}$/.test(c))))) return null;
  return {scope, from, to, symbol: sym, conditions, protocol};
 }

 // Rows for the filters. Daily bars keep everything after `from` so outcomes can mature.
 async function load(db, f, {withMeta = false} = {}) {
  const daily = f.scope === 'daily', dkey = daily ? 'asof' : 'session';
  const modern = f.protocol.version === 2;
  // v2 counts decisions from the protocol start only (unless all=1).
  const start = [f.from, f.protocol.from].filter(Boolean).sort().at(-1) ?? null;
  const where = (key, extra = []) => {
   const c = [], a = [];
   if (start) { c.push(key + '>=?'); a.push(start); }
   for (const [k, v] of extra) if (v != null) { c.push(k); a.push(v); }
   return [c.length ? ' WHERE ' + c.join(' AND ') : '', a];
  };
  const base = daily ? 'id,symbol,asof,condition,always_in,p_up_5,target,stop,horizon,close,created_at' :
   'id,symbol,session,bar,ts,condition,always_in,p_up_6,target,stop,horizon,close,created_at';
  const meta = daily ? ',model,skill_sha,state' : ',model,skill_sha,day_type';
  const [pw, pa] = where(dkey, [[dkey + '<=?', f.to], ['symbol=?', f.symbol]]);
  const order = daily ? ' ORDER BY asof,symbol,condition' : ' ORDER BY session,bar,symbol,condition';
  const table = daily ? 'predictions' : 'ipredictions';
  const cols = base + (withMeta ? meta : '');
  let preds;
  try { preds = await all(db, `SELECT ${cols},levels_ok FROM ${table}${pw}${order}`, pa); }
  catch { preds = await all(db, `SELECT ${cols} FROM ${table}${pw}${order}`, pa); } // before migration 0004
  const [bw, ba] = daily ? where('date', [['symbol=?', f.symbol]]) : where('session', [['session<=?', f.to], ['symbol=?', f.symbol]]);
  const bars = await all(db, daily ? `SELECT symbol,date,open,high,low,close FROM bars${bw} ORDER BY symbol,date` :
   `SELECT symbol,ts,session,bar,open,high,low,close,final FROM ibars${bw} ORDER BY symbol,session,bar`, ba);
  // Derived `_ts` conditions are computed from their stored base condition.
  const keep = f.conditions ? new Set(f.conditions.map(c => modern && derivedBase(f.scope, c) || c)) : null;
  const minutes = modern && !daily && preds.length ? indexMinutes(await loadMinutes(all, db, {from: start, to: f.to, symbol: f.symbol})) : undefined;
  return {bars, minutes, preds: preds.filter(p => keep ? keep.has(p.condition) || (!daily && p.condition === 'missed') : true)};
 }

 // Daily: forecasts use all later bars; the account stops at the first bar after `to`.
 // v2 positions end one open later, so its account needs the second bar after `to`.
 function dailyMetrics(bars, preds, to, version) {
  const full = compute('daily', bars, preds, {version});
  if (!to) return full;
  const next = [...new Set(bars.map(b => b.date).filter(d => d > to))].sort()[version - 1];
  const acc = compute('daily', bars.filter(b => !next || b.date <= next), preds, {version});
  for (const [c, m] of Object.entries(full.conditions)) {
   m.account = acc.conditions[c]?.account ?? m.account;
   for (const [s, ms] of Object.entries(full.per_symbol[c] || {})) ms.account = acc.per_symbol[c]?.[s]?.account ?? ms.account;
  }
  return full;
 }

 async function explore(db, f, env) {
  const daily = f.scope === 'daily', key = daily ? 'date' : 'session', pkey = daily ? 'asof' : 'session';
  const cost = daily ? undefined : intradayCost(env);
  const version = f.protocol.version, modern = version === 2;
  const {bars, preds, minutes} = await load(db, f);
  const scored = preds.filter(p => p.condition !== 'missed');
  const metrics = daily ? dailyMetrics(bars, scored, f.to, version) : compute('intraday', bars, preds, {cost_bps: cost, version, minutes});
  if (modern && f.conditions) {
   for (const c of Object.keys(metrics.conditions)) {
    const base = derivedBase(f.scope, c);
    if (!f.conditions.includes(c) && !f.conditions.includes(base)) for (const part of ['conditions', 'per_symbol', 'paired']) if (metrics[part]) delete metrics[part][c];
   }
  }
  // Rolling-20 lines: stored snapshots where they exist for that day, otherwise computed the same way.
  const first = scored.map(p => p[pkey]).sort()[0];
  const days = first ? [...new Set(bars.map(b => b[key]))].filter(d => d >= first && (!f.to || d <= f.to)).sort().slice(-MAX_ROLLING_POINTS) : [];
  const snaps = new Map();
  if (days.length && (daily || !f.symbol) && !f.protocol.all) {
   try {
    const rows = await all(db, `SELECT as_of,condition,rolling20_json FROM ${modern ? 'metrics_snapshots_v2' : 'metrics_snapshots'} WHERE scope=? AND symbol=? AND as_of>=? AND as_of<=?`,
     [f.scope, f.symbol || '*', days[0], days.at(-1)]);
    for (const r of rows) if (r.rolling20_json && r.rolling20_json !== 'null') snaps.set(r.as_of + '|' + r.condition, JSON.parse(r.rolling20_json));
   } catch { /* table missing before migration 0003 */ }
  }
  const conditions = Object.keys(metrics.conditions);
  const rolling = Object.fromEntries(conditions.map(c => [c, []]));
  let stored = 0, computed = 0;
  // A window can reach back before `from`, so computed points reload without the lower bound.
  let wide = f.from ? null : {bars, preds, minutes};
  for (const d of days) {
   let window = null;
   for (const c of conditions) {
    let m = snaps.get(d + '|' + c);
    if (m) stored++;
    else {
     if (!wide) wide = await load(db, {...f, from: null});
     window ??= rollingWindow(f.scope, wide.bars, wide.preds, d, {cost_bps: cost, version, minutes: wide.minutes});
     m = window?.conditions?.[c];
     if (m && daily && f.symbol) m = window.per_symbol?.[c]?.[f.symbol] ?? m;
     if (m) computed++;
    }
    if (m) rolling[c].push({date: d, direction_hit_rate: m.direction_hit_rate ?? null,
     n: Math.round((m.direction_coverage || 0) * (m.mature || 0)), total_return: m.account?.total_return ?? null});
   }
  }
  const [options, llm] = await Promise.all([choices(db, f.scope), llmSummary(db, f)]);
  for (const m of Object.values(metrics.conditions)) m.levels_inverted = 0;
  for (const p of scored) if (p.levels_ok === 0 && metrics.conditions[p.condition]) metrics.conditions[p.condition].levels_inverted++;
  if (modern) for (const [c, m] of Object.entries(metrics.conditions)) if (m.derived_from) m.levels_inverted = scored.filter(p => p.condition === m.derived_from && p.levels_ok === 0).length;
  return {scope: f.scope, from: f.from, to: f.to, symbol: f.symbol, conditions: f.conditions, cost_bps: metrics.cost_bps,
   range: {first: first || null, last: scored.map(p => p[pkey]).sort().at(-1) || null}, options,
   metrics: metrics.conditions, per_symbol: metrics.per_symbol || null, paired: metrics.paired, missed: metrics.missed ?? null,
   rolling, rolling_source: !stored ? 'computed' : computed ? 'mixed' : 'snapshots', rolling_window: ROLLING, llm, ...(modern ? {protocol: f.protocol} : {})};
 }

 async function choices(db, scope) {
  const table = scope === 'daily' ? 'predictions' : 'ipredictions', key = scope === 'daily' ? 'asof' : 'session';
  const [syms, conds, range] = await Promise.all([all(db, `SELECT DISTINCT symbol FROM ${table} ORDER BY symbol`),
   all(db, `SELECT DISTINCT condition FROM ${table} ORDER BY condition`),
   all(db, `SELECT MIN(${key}) AS first, MAX(${key}) AS last FROM ${table}`)]);
  return {symbols: syms.map(r => r.symbol), conditions: conds.map(r => r.condition).filter(c => c !== 'missed'),
   first: range[0]?.first ?? null, last: range[0]?.last ?? null};
 }

 async function llmSummary(db, f) {
  const scopes = f.scope === 'daily' ? ['daily'] : ['intraday', 'recap'];
  const c = [`scope IN (${scopes.map(() => '?').join(',')})`], a = [...scopes];
  if (f.from) { c.push('session_or_asof>=?'); a.push(f.from); }
  if (f.to) { c.push('session_or_asof<=?'); a.push(f.to); }
  if (f.symbol) { c.push('symbol=?'); a.push(f.symbol); }
  try {
   const rows = await all(db, `SELECT CASE WHEN scope='recap' THEN 'recap' ELSE condition END AS condition, COUNT(*) AS calls, SUM(ok) AS ok,
    SUM(cost_usd) AS cost_usd, AVG(duration_ms) AS avg_duration_ms, SUM(input_tokens) AS input_tokens,
    SUM(output_tokens) AS output_tokens, SUM(cache_read_tokens) AS cache_read_tokens
    FROM llm_calls WHERE ${c.join(' AND ')} GROUP BY 1 ORDER BY 1`, a);
   const keep = f.conditions ? new Set([...f.conditions, 'recap']) : null;
   return rows.filter(r => !keep || keep.has(r.condition)).map(r => ({...r, avg_cost_usd: r.calls && r.cost_usd != null ? r.cost_usd / r.calls : null}));
  } catch { return null; }
 }

 async function exportCsv(db, f) {
  const daily = f.scope === 'daily', modern = f.protocol.version === 2;
  const {bars, preds, minutes} = await load(db, f, {withMeta: true});
  const groups = new Map();
  for (const b of bars) {
   const k = daily ? b.symbol : b.symbol + '|' + b.session;
   if (!groups.has(k)) groups.set(k, []);
   groups.get(k).push(b);
  }
  const fills = new Map();
  if (modern && !daily) {
   const byCondition = new Map();
   for (const p of preds) {
    if (p.condition === 'missed') continue;
    const k = p.symbol + '|' + p.session + '|' + p.condition;
    if (!byCondition.has(k)) byCondition.set(k, []);
    byCondition.get(k).push(p);
   }
   for (const pp of byCondition.values())
    for (const [p, columns] of fillColumns(groups.get(pp[0].symbol + '|' + pp[0].session) || [], pp, minutes)) fills.set(p, columns);
  }
  const rows = preds.filter(p => f.conditions || p.condition !== 'missed').map(p => {
   const bb = groups.get(daily ? p.symbol : p.symbol + '|' + p.session) || [];
   return {...p, ...(daily ? (modern ? dailyOutcomeV2 : dailyOutcome)(p, bb) : {...intradayOutcome(p, bb), ...fills.get(p)}),
    ...(modern ? {protocol: 2} : {})};
  });
  const cols = daily ?
   ['id', 'symbol', 'asof', 'condition', 'model', 'skill_sha', 'always_in', 'p_up_5', 'target', 'stop', 'horizon', 'state', 'close',
    'levels_ok', 'created_at', 'outcome_status', 'next_date', 'next_return', 'close_5', 'up_5', 'direction_hit', 'barrier'] :
   ['id', 'symbol', 'session', 'bar', 'ts', 'condition', 'model', 'skill_sha', 'always_in', 'p_up_6', 'target', 'stop', 'horizon',
    'day_type', 'close', 'levels_ok', 'created_at', 'outcome_status', 'close_6', 'up_6', 'direction_hit', 'barrier'];
  if (modern) {
   const own = daily ? ['fill_status', 'fill_date', 'fill_price', 'exit_date', 'exit_price', 'period_return', 'ts_exit', 'ts_exit_price', 'ts_return'] :
    ['fill_status', 'fill_ts', 'fill_price', 'fill_source', 'ts_exit', 'ts_exit_ts', 'ts_exit_price'];
   cols.splice(cols.indexOf('outcome_status') + 1, daily ? 2 : 0, ...own);
   cols.push('protocol');
  }
  const name = ['brooks', f.scope, f.symbol || 'all', f.from || 'start', f.to || 'latest'].join('_').replace(/[^\w.-]/g, '-') + '.csv';
  return new Response('\ufeff' + toCsv(cols, rows), {headers: {'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store',
   'content-disposition': `attachment; filename="${name}"`}});
 }

 async function snapshots(db, params) {
  // Unchanged default: stored v1 rows. v=2 reads the v2 table.
  const modern = params.get('v') === '2';
  const f = filters(params), condition = params.get('condition');
  if (!f || (condition !== null && !/^[\w.-]{1,60}$/.test(condition))) return invalid('filter');
  const c = ['scope=?'], a = [f.scope];
  for (const [k, v] of [['condition=?', condition], ['symbol=?', params.has('symbol') ? params.get('symbol') === 'all' ? '*' : f.symbol : null],
   ['as_of>=?', f.from], ['as_of<=?', f.to]]) if (v != null) { c.push(k); a.push(v); }
  let rows;
  try { rows = await all(db, `SELECT * FROM ${modern ? 'metrics_snapshots_v2' : 'metrics_snapshots'} WHERE ${c.join(' AND ')} ORDER BY as_of,condition,symbol LIMIT 5000`, a); }
  catch (e) { if (!modern || !/no such table/i.test(String(e?.message))) throw e; rows = []; } // before migration 0005
  return json({snapshots: rows.map(({metrics_json, rolling20_json, ...r}) => ({...r, metrics: JSON.parse(metrics_json), rolling20: JSON.parse(rolling20_json ?? 'null')}))});
 }

 async function read(u, env) {
  const path = u.pathname;
  if (!reads.includes(path)) return undefined;
  if (path === '/explore') return html(explorePage());
  if (path === '/api/snapshots') return snapshots(env.DB, u.searchParams);
  const f = filters(u.searchParams);
  if (!f) return invalid('filter');
  return tagProtocol(path === '/api/explore' ? json(await explore(env.DB, f, env)) : await exportCsv(env.DB, f), f.protocol);
 }

 return {read, write};
}

// 'skill_ts' -> 'skill' when that derived condition exists in the scope, else null.
function derivedBase(scope, condition) {
 const base = condition.endsWith(TS_SUFFIX) ? condition.slice(0, -TS_SUFFIX.length) : '';
 return TS_CONDITIONS[scope].includes(base) ? base : null;
}

function intradayCost(env) {
 const cost = Number(env?.INTRADAY_COST_BPS ?? 1);
 return Number.isFinite(cost) && cost >= 0 ? cost : 1;
}
