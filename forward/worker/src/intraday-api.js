import {computeIntradayMetrics, decisionBar, mechanical, sessionPositions} from './intraday-metrics.js';
import {computeIntradayMetricsV2, indexMinutes, sessionPositionsV2} from './intraday-metrics-v2.js';
import {loadMinutes} from './minutes.js';
import {protocolFor, tagProtocol} from './protocol.js';
import {intradayPage, recapPage} from './intraday-pages.js';

export const intradayWrites = ['/api/intraday/bars', '/api/intraday/predictions', '/api/recaps'];
const activeConditions = ['skill', 'skill_chart', 'baseline', ...mechanical];
const conditions = [...activeConditions, 'missed'];
const costBps = env => {
 const cost = Number(env.INTRADAY_COST_BPS ?? 1);
 return Number.isFinite(cost) && cost >= 0 ? cost : 1;
};
const ny = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York',
 year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
const label = (s, max) => typeof s === 'string' && !!s.trim() && s.length <= max;
const barNumber = n => Number.isInteger(n) && n >= 1 && n <= 78;
const html = body => new Response(body, {headers: {'content-type': 'text/html; charset=utf-8'}});
const fields = {
 bars: ['symbol', 'ts', 'session', 'bar', 'open', 'high', 'low', 'close', 'volume', 'final'],
 predictions: ['symbol', 'session', 'bar', 'ts', 'condition', 'model', 'skill_sha', 'always_in',
  'p_up_6', 'target', 'stop', 'horizon', 'day_type', 'close', 'reading'],
 recaps: ['symbol', 'session', 'day_type', 'markdown', 'annotations', 'levels', 'prior', 'model', 'skill_sha']
};
const insert = (table, cols) => `INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`;
const replace = cols => cols.map(k => `${k}=excluded.${k}`).join(',');

function timestamp(row) {
 if (typeof row.ts !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00(?:\.000)?Z$/.test(row.ts)) return false;
 const millis = Date.parse(row.ts);
 if (!Number.isFinite(millis)) return false;
 const d = Object.fromEntries(ny.formatToParts(millis).map(p => [p.type, p.value]));
 return row.session === `${d.year}-${d.month}-${d.day}` && Number(d.hour) * 60 + Number(d.minute) === 570 + (row.bar - 1) * 5;
}

export function intradayRoutes({json, date, number, symbol, text, all, levelsField = () => true, levelsValue, withLevels}) {
 const positive = x => number(x) && x > 0;
 const identity = row => row && symbol(row.symbol) && date(row.session);
 const invalid = kind => json({error: 'Invalid ' + kind}, 400);

 async function write(path, body, db) {
  if (!body || typeof body !== 'object') return invalid('body');
  if (path === '/api/intraday/bars') {
   const rows = body.bars;
   if (!Array.isArray(rows) || !rows.length || rows.length > 2000 || rows.some(b =>
    !identity(b) || !barNumber(b.bar) || !timestamp(b) ||
    !['open', 'high', 'low', 'close'].every(k => positive(b[k])) ||
    b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close) ||
    (b.volume != null && (!number(b.volume) || b.volume < 0)) ||
    (b.final != null && ![0, 1].includes(b.final)))) return invalid('bars');
   const cols = fields.bars;
   const revised = cols.slice(4, -1);
   const values = rows.map(b => cols.map(k =>
    k === 'ts' ? new Date(b.ts).toISOString().replace('.000', '') :
     k === 'final' ? (b.bar === 78 ? 1 : b.final ?? 0) : b[k] ?? null));
   // A single binding keeps repeated context uploads within D1 query limits.
   const sql = `INSERT INTO ibars(${cols.join(',')})
    SELECT ${cols.map((_, i) => `json_extract(value,'$[${i}]')`).join(',')}
    FROM json_each(?) WHERE 1
    ON CONFLICT(symbol,ts) DO UPDATE SET ${replace(revised)},final=MAX(ibars.final,excluded.final)
    WHERE excluded.final > ibars.final OR ${revised.map(k => `ibars.${k} IS NOT excluded.${k}`).join(' OR ')}`;
   await db.prepare(sql).bind(JSON.stringify(values)).run();
   return json({ok: true, count: rows.length});
  }
  if (path === '/api/intraday/predictions') {
   const p = body;
   if (!identity(p) || !decisionBar(p.bar) || !timestamp(p) || !conditions.includes(p.condition) ||
    !['long', 'short', 'unclear'].includes(p.always_in) || !number(p.p_up_6) || p.p_up_6 < 0 || p.p_up_6 > 1 ||
    !Number.isInteger(p.horizon) || p.horizon < 1 || p.horizon > 12 ||
    (!positive(p.close) && !(p.condition === 'missed' && p.close === null)) ||
    !['target', 'stop'].every(k => p[k] === null || number(p[k])) ||
    !text(p.model) || !text(p.skill_sha) || !text(p.day_type) || !text(p.reading, 200000) ||
    !levelsField(p.levels_ok)) return invalid('prediction');
   const cols = fields.predictions;
   const sql = c => db.prepare(insert('ipredictions', c) + ' ON CONFLICT(symbol,session,bar,condition) DO NOTHING');
   if (withLevels) await withLevels(cols, {...p, levels_ok: levelsValue(p, p.close)}, sql, false);
   else await sql(cols).bind(...cols.map(k => p[k])).run();
   return json({ok: true});
  }
  const r = body;
  if (!identity(r) || !label(r.day_type, 200) || !label(r.markdown, 12000) ||
   !text(r.model) || !text(r.skill_sha) || (r.force !== undefined && typeof r.force !== 'boolean') ||
   !Array.isArray(r.annotations) || r.annotations.length > 12 || r.annotations.some(a =>
    !a || !barNumber(a.bar) || !label(a.label, 120) || !['above', 'below'].includes(a.pos)) ||
   !Array.isArray(r.levels) || r.levels.length > 30 ||
   r.levels.some(l => !l || !positive(l.price) || !label(l.label, 120)) ||
   (r.prior != null && (!date(r.prior.session) || r.prior.session >= r.session ||
    !['close', 'high', 'low'].every(k => positive(r.prior[k]))))) return invalid('recap');
  if (r.annotations.length) {
   const bb = await all(db, 'SELECT bar FROM ibars WHERE symbol=? AND session=?', [r.symbol, r.session]);
   const numbers = new Set(bb.map(b => b.bar));
   if (r.annotations.some(a => !numbers.has(a.bar))) return invalid('annotation bar');
  }
  const cols = fields.recaps;
  const row = {...r, annotations: JSON.stringify(r.annotations), levels: JSON.stringify(r.levels),
   prior: r.prior == null ? null : JSON.stringify(r.prior)};
  const conflict = r.force ? 'DO UPDATE SET ' + replace(cols.slice(2)) : 'DO NOTHING';
  await db.prepare(insert('recaps', cols) + ' ON CONFLICT(symbol,session) ' + conflict).bind(...cols.map(k => row[k])).run();
  return json({ok: true});
 }

 async function read(u, env) {
  const path = u.pathname, db = env.DB, params = u.searchParams;
  const sym = params.get('symbol'), session = params.get('session'), condition = params.get('condition');
  if (path === '/intraday') return html(intradayPage());
  if (!['/api/intraday/predictions', '/api/intraday/stats', '/api/intraday/session', '/api/recaps', '/recap'].includes(path) &&
      !path.startsWith('/recap/')) return undefined;
  if ((sym !== null && !symbol(sym)) || (session !== null && !date(session))) return invalid('filter');
  if (path === '/api/intraday/predictions') {
   const filters = [['symbol', sym], ['session', session], ['condition', condition]].filter(([, v]) => v !== null);
   const where = filters.length ? ' WHERE ' + filters.map(([k]) => k + '=?').join(' AND ') : '';
   const requested = Number(params.get('limit') || 100);
   const limit = Number.isFinite(requested) ? Math.max(1, Math.min(1000, Math.floor(requested))) : 100;
   const predictions = await all(db, 'SELECT * FROM ipredictions' + where + ' ORDER BY session DESC,bar DESC,id DESC LIMIT ?',
    [...filters.map(([, v]) => v), limit]);
   return json({predictions});
  }
  const protocol = protocolFor('intraday', params);
  if (!protocol && ['/api/intraday/stats', '/api/intraday/session'].includes(path)) return invalid('version');
  if (path === '/api/intraday/stats' && protocol.version === 2) {
   const from = protocol.from || '';
   const args = sym ? [from, sym] : [from];
   const where = ' WHERE session>=?' + (sym ? ' AND symbol=?' : '');
   const [bars, preds, minutes] = await Promise.all([
    all(db, 'SELECT symbol,ts,session,bar,open,high,low,close,final FROM ibars' + where, args),
    all(db, 'SELECT symbol,session,bar,condition,always_in,p_up_6,target,stop,horizon,created_at FROM ipredictions' + where, args),
    loadMinutes(all, db, {from, symbol: sym})
   ]);
   return tagProtocol(json({...computeIntradayMetricsV2(bars, preds, {cost_bps: costBps(env), minutes: indexMinutes(minutes)}), protocol}), protocol);
  }
  if (path === '/api/intraday/stats') {
   const args = sym ? [sym] : [];
   const where = sym ? ' WHERE symbol=?' : '';
   const [bars, preds] = await Promise.all([
    all(db, 'SELECT symbol,session,bar,open,high,low,close,final FROM ibars' + where, args),
    all(db, 'SELECT symbol,session,bar,condition,always_in,p_up_6,target,stop,horizon,created_at FROM ipredictions' + where, args)
   ]);
   return tagProtocol(json(computeIntradayMetrics(bars, preds, {cost_bps: costBps(env)})), protocol);
  }
  const selected = sym || 'SPY';
  if (path === '/api/intraday/session') {
   const days = await all(db, 'SELECT session, MAX(final) AS final FROM ibars WHERE symbol=? GROUP BY session ORDER BY session DESC', [selected]);
   const sessions = days.map(row => row.session);
   const day = session || sessions[0] || null;
   const index = sessions.indexOf(day);
   if (session && index < 0) return json({error: 'Session bars unavailable'}, 404);
   const modern = protocol.version === 2;
   // Positions always follow the selected rules for the shown day; `counted` says whether that day is in the statistics.
   const extra = modern ? {protocol: {...protocol, counted: !!day && (!protocol.from || day >= protocol.from)}} : {};
   if (!day) return tagProtocol(json({session: null, sessions, latest_final: false, bars: [], predictions: [],
    positions: modern ? sessionPositionsV2([], [], activeConditions, costBps(env)).positions : sessionPositions([], [], activeConditions, costBps(env)),
    ...(modern ? {fills: {}} : {}), ...extra}), protocol);
   const [bars, predictions, minutes] = await Promise.all([
    contextBars(db, selected, day),
    all(db, 'SELECT * FROM ipredictions WHERE symbol=? AND session=? ORDER BY bar,condition', [selected, day]),
    modern ? loadMinutes(all, db, {from: day, to: day, symbol: selected}) : []
   ]);
   const today = bars.filter(b => b.session === day);
   const result = modern ? sessionPositionsV2(today, predictions, activeConditions, costBps(env), indexMinutes(minutes)) :
    {positions: sessionPositions(today, predictions, activeConditions, costBps(env))};
   return tagProtocol(json({session: day, sessions, latest_final: Boolean(days[0]?.final), bars, predictions, ...result, ...extra}), protocol);
  }
  if (path === '/api/recaps') {
   const rows = await all(db, 'SELECT * FROM recaps WHERE symbol=?' +
    (session ? ' AND session=?' : '') + ' ORDER BY session DESC LIMIT 100', session ? [selected, session] : [selected]);
   return json({recaps: rows.map(decodeRecap)});
  }
  const requested = path === '/recap' ? null : path.slice('/recap/'.length);
  if (requested !== null && !date(requested)) return json({error: 'Not found'}, 404);
  const history = await all(db, 'SELECT session,day_type FROM recaps WHERE symbol=? ORDER BY session DESC', [selected]);
  const day = requested || history[0]?.session;
  const rows = day ? await all(db, 'SELECT * FROM recaps WHERE symbol=? AND session=?', [selected, day]) : [];
  if (!rows.length && requested) return json({error: 'Not found'}, 404);
  const recap = rows.length ? decodeRecap(rows[0]) : null;
  const bars = recap ? await contextBars(db, selected, day) : [];
  return html(recapPage(selected, history, recap, bars));
 }

 function contextBars(db, selected, day) {
  return all(db, 'SELECT * FROM ibars WHERE symbol=? AND session<=? AND session IN ' +
   '(SELECT DISTINCT session FROM ibars WHERE symbol=? AND session<=? ORDER BY session DESC LIMIT 3) ORDER BY session,bar',
   [selected, day, selected, day]);
 }

 return {read, write};
}

function decodeRecap(row) {
 return {...row, annotations: JSON.parse(row.annotations), levels: JSON.parse(row.levels), prior: JSON.parse(row.prior)};
}
