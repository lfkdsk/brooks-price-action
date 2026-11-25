// Deterministic database used for the v1 golden comparison (test/fixtures/golden-v1.json was produced by the
// Worker as it was BEFORE protocol v2, commit d7dded9, from exactly these rows and with Date.now() = NOW).
export const NOW = Date.parse('2026-11-26T20:00:00Z');
export const PATHS = ['/api/stats', '/api/equity', '/api/intraday/stats', '/api/intraday/stats?symbol=SPY', '/api/intraday/session',
 '/api/intraday/session?symbol=SPY&session=2026-11-23', '/api/intraday/session?symbol=QQQ',
 '/api/explore?scope=daily', '/api/explore?scope=daily&from=2026-11-12&to=2026-11-18&symbol=SPY&conditions=skill',
 '/api/explore?scope=intraday', '/api/explore?scope=intraday&from=2026-11-24&conditions=skill,baseline',
 '/api/export.csv?scope=daily', '/api/export.csv?scope=intraday', '/api/export.csv?scope=daily&to=2026-11-13&conditions=skill',
 '/api/explore?scope=weekly', '/api/intraday/session?session=2026-11-01'];

const q = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
export const rowsSql = (table, rows) => rows.map(r => `INSERT INTO ${table}(${Object.keys(r).join(',')}) VALUES(${Object.values(r).map(q).join(',')});`).join('\n');
const r2 = x => Math.round(x * 100) / 100;

export function v1Fixture() {
 const days = [];
 for (let t = Date.parse('2026-11-09T12:00:00Z'); days.length < 13; t += 86400000)
  if (![0, 6].includes(new Date(t).getUTCDay())) days.push(new Date(t).toISOString().slice(0, 10));
 const bars = [], predictions = [];
 for (const [k, symbol] of ['SPY', 'QQQ'].entries()) days.forEach((date, i) => {
  const close = r2(100 + 50 * k + 3 * Math.sin(i * 1.3 + k)), open = r2(close - Math.cos(i * 2.1));
  bars.push({symbol, date, open, high: r2(Math.max(open, close) + .7), low: r2(Math.min(open, close) - .6), close});
  for (const [j, condition] of ['skill', 'baseline', 'ema20', 'buy_hold'].entries()) {
   if (condition === 'skill' && i === 4) continue; // a missing day
   const always_in = condition === 'buy_hold' ? 'long' : ['long', 'short', 'unclear', 'long'][(i + j + k) % 4], d = always_in === 'short' ? -1 : 1;
   predictions.push({symbol, asof: date, condition, model: 'm', skill_sha: 's', always_in, p_up_5: j > 1 ? .5 : r2(.4 + (i % 5) * .07),
    target: j > 1 ? null : r2(close + d * 2), stop: j > 1 ? null : r2(close - d * 1.5), horizon: i % 3 ? 5 : 10, state: 'x', close,
    reading: 'r', created_at: date + ' 21:41:00', levels_ok: j > 1 || always_in === 'unclear' ? null : 1});
  }
 });
 const ibars = [], ibars1m = [], ipredictions = [];
 for (const [s, session, last] of [[0, '2026-11-23', 78], [1, '2026-11-24', 42], [2, '2026-11-25', 20]]) {
  const t0 = Date.parse(session + 'T14:30:00Z'), iso = ms => new Date(ms).toISOString().replace('.000', '');
  for (let bar = 1; bar <= last; bar++) {
   const open = r2(700 + s + 4 * Math.sin(bar / 9 + s)), close = r2(open + Math.cos(bar * 1.7));
   ibars.push({symbol: 'SPY', ts: iso(t0 + (bar - 1) * 300000), session, bar, open, high: r2(Math.max(open, close) + .4), low: r2(Math.min(open, close) - .4),
    close, volume: 1000 + bar, final: +(bar === last && s < 2)});
   for (let m = 0; m < 5; m++) ibars1m.push({symbol: 'SPY', ts: iso(t0 + ((bar - 1) * 5 + m) * 60000), session, minute: (bar - 1) * 5 + m + 1,
    open: r2(open + m * .05), high: r2(open + m * .05 + .2), low: r2(open + m * .05 - .2), close: r2(open + m * .05 + .03), volume: 10});
  }
  for (let bar = 3; bar <= Math.min(75, last); bar += 3) {
   const ts = iso(t0 + (bar - 1) * 300000), created_at = iso(t0 + bar * 300000 + (30 + bar) * 1000).replace('T', ' ').replace('Z', '');
   const close = ibars.find(b => b.session === session && b.bar === bar).close;
   if (bar === 12) { ipredictions.push({symbol: 'SPY', session, bar, ts, condition: 'missed', model: '', skill_sha: 's', always_in: 'unclear', p_up_6: .5,
    target: null, stop: null, horizon: 6, day_type: 'missed', close, reading: 'missed', created_at, levels_ok: null}); continue; }
   for (const [j, condition] of ['skill', 'skill_chart', 'baseline', 'ema20_5m', 'buy_hold'].entries()) {
    const always_in = condition === 'buy_hold' ? 'long' : ['long', 'short', 'long', 'unclear'][(bar / 3 + j) % 4], d = always_in === 'short' ? -1 : 1;
    ipredictions.push({symbol: 'SPY', session, bar, ts, condition, model: 'm', skill_sha: 's', always_in, p_up_6: j > 2 ? .5 : r2(.35 + (bar % 7) * .05),
     target: j > 2 ? null : r2(close + d * 1.5), stop: j > 2 ? null : r2(close - d), horizon: 6, day_type: 'range', close, reading: 'r', created_at,
     levels_ok: j > 2 || always_in === 'unclear' ? null : 1});
   }
  }
 }
 const llm = [{ts: '2026-11-20T21:00:00Z', scope: 'daily', symbol: 'SPY', session_or_asof: '2026-11-20', condition: 'skill', model: 'm', duration_ms: 900,
  input_tokens: 1, output_tokens: 2, cache_read_tokens: 3, cost_usd: .5, ok: 1}];
 return {bars, predictions, ibars, ibars1m, ipredictions, llm_calls: llm};
}
export const fixtureSql = (f = v1Fixture()) => Object.entries(f).map(([table, rows]) => rowsSql(table, rows)).join('\n');
