import test from 'node:test';
import assert from 'node:assert/strict';
import {Script, createContext} from 'node:vm';
import worker from '../src/index.js';
import {csvCell, toCsv, runSnapshots, snapshotRows, minuteStamp} from '../src/archive-api.js';
import {computeMetrics, levelsOk} from '../src/metrics.js';
import {computeIntradayMetrics} from '../src/intraday-metrics.js';
import {explorePage, exploreHelpers} from '../src/explore-page.js';
import {readingPage} from '../src/dashboard.js';
import {emitFunction, scriptPrelude} from '../src/ui-common.js';
import {MIGRATIONS, SqliteD1, python3Available} from './sqlite-d1.js';

const sql = {skip: !python3Available && 'python3 with sqlite3 is required'};
const call = (env, path, method = 'GET', body, auth = 'Bearer test-secret') => worker.fetch(new Request('https://unit.test' + path,
 {method, headers: {authorization: auth}, ...(body === undefined ? {} : {body: JSON.stringify(body)})}), env);
const dates = (() => {
 const out = [];
 for (let t = Date.parse('2026-10-01T12:00:00Z'); out.length < 30; t += 86400000) {
  const d = new Date(t);
  if (![0, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
 }
 return out;
})();
const dailyBars = sym => dates.map((date, i) => {
 const close = (sym === 'SPY' ? 100 : 200) + (i % 4) * (sym === 'SPY' ? 1 : -1) + i * .1;
 return {symbol: sym, date, open: close, high: close + 1, low: close - 1, close};
});
const prediction = (sym, asof, condition, extra = {}) => ({symbol: sym, asof, condition, model: 'm', skill_sha: 's', always_in: 'long',
 p_up_5: condition === 'skill' ? .65 : .5, target: null, stop: null, horizon: 5, state: 'other', close: 100, reading: 'r', ...extra});

async function seededDaily() {
 const env = {DB: new SqliteD1(MIGRATIONS), WRITE_TOKEN: 'test-secret'};
 const bars = [...dailyBars('SPY'), ...dailyBars('QQQ')];
 assert.equal((await call(env, '/api/bars', 'POST', {bars})).status, 200);
 for (const b of bars) for (const c of ['skill', 'ema20'])
  assert.equal((await call(env, '/api/predictions', 'POST', prediction(b.symbol, b.date, c,
   {close: b.close, always_in: (dates.indexOf(b.date) + (c === 'skill' ? 0 : 1)) % 3 ? 'long' : 'short'}))).status, 200);
 return {env, bars};
}

test('new write routes require the bearer token and touch no data without it', async () => {
 const calls = [];
 const env = {DB: {prepare(sql) { calls.push(sql); throw new Error('unexpected'); }}, WRITE_TOKEN: 'test-secret'};
 for (const path of ['/api/intraday/bars1m', '/api/llm_calls'])
  for (const auth of ['', 'Bearer wrong', 'test-secret']) assert.equal((await call(env, path, 'POST', {}, auth)).status, 401);
 assert.deepEqual(calls, []);
});

test('levels_ok: long target above / stop below entry, short reversed, null when not applicable', () => {
 assert.equal(levelsOk({always_in: 'long', target: 110, stop: 95}, 100), 1);
 assert.equal(levelsOk({always_in: 'long', target: 90, stop: 95}, 100), 0);
 assert.equal(levelsOk({always_in: 'long', target: 110, stop: 101}, 100), 0);
 assert.equal(levelsOk({always_in: 'short', target: 90, stop: 105}, 100), 1);
 assert.equal(levelsOk({always_in: 'short', target: 110, stop: null}, 100), 0);
 assert.equal(levelsOk({always_in: 'unclear', target: 110, stop: 90}, 100), null);
 assert.equal(levelsOk({always_in: 'long', target: null, stop: null}, 100), null);
});

test('1-minute bar timestamps must match the session minute (09:30 ET = 1) across DST', () => {
 assert.ok(minuteStamp({ts: '2026-07-09T13:30:00Z', session: '2026-07-09', minute: 1}));
 assert.ok(minuteStamp({ts: '2026-11-17T14:30:00Z', session: '2026-11-17', minute: 1}));
 assert.ok(minuteStamp({ts: '2026-11-17T20:59:00Z', session: '2026-11-17', minute: 390}));
 assert.ok(!minuteStamp({ts: '2026-11-17T14:31:00Z', session: '2026-11-17', minute: 1}));
 assert.ok(!minuteStamp({ts: '2026-11-17T14:30:30Z', session: '2026-11-17', minute: 1}));
});

test('POST /api/intraday/bars1m validates and upserts idempotently in real SQLite', sql, async () => {
 const env = {DB: new SqliteD1(MIGRATIONS), WRITE_TOKEN: 'test-secret'};
 const bar = (minute, extra = {}) => ({symbol: 'SPY', session: '2026-11-17', minute,
  ts: new Date(Date.parse('2026-11-17T14:30:00Z') + (minute - 1) * 60000).toISOString().replace('.000', ''),
  open: 100, high: 101, low: 99, close: 100.5, volume: 1000, ...extra});
 for (const bad of [[bar(1, {minute: 0})], [bar(1, {minute: 391})], [bar(1, {ts: '2026-11-17T14:31:00Z'})], [bar(1, {high: 99.5})],
  [bar(1, {volume: -1})], [bar(1, {symbol: 'bad symbol'})], []])
  assert.equal((await call(env, '/api/intraday/bars1m', 'POST', {bars: bad})).status, 400);
 for (let i = 0; i < 2; i++) assert.equal((await call(env, '/api/intraday/bars1m', 'POST', {bars: [bar(1), bar(2)]})).status, 200);
 assert.equal((await call(env, '/api/intraday/bars1m', 'POST', {bars: [bar(2, {close: 100.9})]})).status, 200);
 const rows = await env.DB.prepare('SELECT * FROM ibars1m ORDER BY minute').bind().all();
 assert.deepEqual(rows.results.map(r => [r.minute, r.close, r.ts]), [[1, 100.5, '2026-11-17T14:30:00Z'], [2, 100.9, '2026-11-17T14:31:00Z']]);
});

test('POST /api/llm_calls validates single and batch rows', sql, async () => {
 const env = {DB: new SqliteD1(MIGRATIONS), WRITE_TOKEN: 'test-secret'};
 const row = {ts: '2026-11-17T21:00:00Z', scope: 'daily', symbol: 'SPY', session_or_asof: '2026-11-17', condition: 'skill',
  model: 'claude-sonnet', duration_ms: 1200, input_tokens: 10, output_tokens: 20, cache_read_tokens: 30, cost_usd: .012, ok: true, error_type: null};
 for (const bad of [{...row, scope: 'weekly'}, {...row, input_tokens: -1}, {...row, duration_ms: 1.5}, {...row, ok: 'yes'},
  {...row, ts: 'yesterday'}, {...row, session_or_asof: '2026-13-01'}, {...row, cost_usd: -1}, {calls: []}])
  assert.equal((await call(env, '/api/llm_calls', 'POST', bad)).status, 400);
 assert.equal((await call(env, '/api/llm_calls', 'POST', row)).status, 200);
 assert.equal((await call(env, '/api/llm_calls', 'POST', {calls: [{...row, condition: 'baseline', ok: false, error_type: 'invalid_output', cost_usd: .02},
  {ts: row.ts, scope: 'recap', ok: 1}]})).status, 200);
 const rows = (await env.DB.prepare('SELECT * FROM llm_calls ORDER BY id').bind().all()).results;
 assert.deepEqual(rows.map(r => [r.scope, r.condition, r.ok, r.error_type]), [['daily', 'skill', 1, null], ['daily', 'baseline', 0, 'invalid_output'], ['recap', null, 1, null]]);
});

test('predictions store levels_ok (derived or supplied) and still insert before migration 0004', sql, async () => {
 const env = {DB: new SqliteD1(MIGRATIONS), WRITE_TOKEN: 'test-secret'};
 await call(env, '/api/predictions', 'POST', prediction('SPY', '2026-11-02', 'skill', {target: 95, stop: 90}));
 await call(env, '/api/predictions', 'POST', prediction('SPY', '2026-11-03', 'skill', {target: 105, stop: 90}));
 await call(env, '/api/predictions', 'POST', prediction('SPY', '2026-11-04', 'skill', {target: 105, stop: 90, levels_ok: false}));
 assert.equal((await call(env, '/api/predictions', 'POST', prediction('SPY', '2026-11-05', 'skill', {levels_ok: 'no'}))).status, 400);
 const decision = {symbol: 'SPY', session: '2026-11-17', bar: 3, ts: '2026-11-17T14:40:00Z', condition: 'skill', model: 'm', skill_sha: 's',
  always_in: 'short', p_up_6: .4, target: 101, stop: 102, horizon: 6, day_type: 'x', close: 100, reading: 'r'};
 assert.equal((await call(env, '/api/intraday/predictions', 'POST', decision)).status, 200);
 const daily = (await (await call(env, '/api/predictions?limit=10')).json()).predictions;
 assert.deepEqual(daily.map(p => [p.asof, p.levels_ok]), [['2026-11-04', 0], ['2026-11-03', 1], ['2026-11-02', 0]]);
 const intraday = (await (await call(env, '/api/intraday/predictions')).json()).predictions;
 assert.equal(intraday[0].levels_ok, 0);
 const old = {DB: new SqliteD1(MIGRATIONS.slice(0, 3)), WRITE_TOKEN: 'test-secret'};
 assert.equal((await call(old, '/api/predictions', 'POST', prediction('SPY', '2026-11-02', 'skill', {target: 95, stop: 90}))).status, 200);
 assert.equal((await call(old, '/api/intraday/predictions', 'POST', decision)).status, 200);
 assert.equal((await (await call(old, '/api/predictions')).json()).predictions.length, 1);
});

test('snapshots: scheduled() upserts cumulative and rolling-20 metrics idempotently; GET /api/snapshots', sql, async () => {
 const {env, bars} = await seededDaily();
 const waits = [];
 await worker.scheduled({cron: '15 22 * * 1-5'}, env, {waitUntil: p => waits.push(p)});
 await Promise.all(waits);
 const count = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM metrics_snapshots').bind().all()).results[0].n;
 assert.equal(await count(), 2 * 3); // skill/ema20 × (* + SPY + QQQ)
 assert.equal(await runSnapshots(env.DB, {created_at: 'later'}), 6);
 assert.equal(await count(), 6);
 const res = await (await call(env, '/api/snapshots?scope=daily&condition=skill&symbol=all')).json();
 assert.equal(res.snapshots.length, 1);
 const snap = res.snapshots[0];
 assert.equal(snap.as_of, dates.at(-1));
 assert.equal(snap.created_at, 'later');
 const preds = (await env.DB.prepare('SELECT * FROM predictions').bind().all()).results;
 const expected = computeMetrics(bars, preds).conditions.skill;
 assert.equal(snap.metrics.direction_hit_rate, expected.direction_hit_rate);
 assert.equal(snap.metrics.account.total_return, expected.account.total_return);
 assert.equal(snap.metrics.account.equity_curve, undefined);
 const window = dates.slice(-20);
 const rolling = computeMetrics(bars.filter(b => b.date >= window[0]), preds.filter(p => p.asof >= window[0])).conditions.skill;
 assert.equal(snap.rolling20.account.total_return, rolling.account.total_return);
 assert.equal((await (await call(env, '/api/snapshots?scope=daily&symbol=QQQ')).json()).snapshots.length, 2);
 assert.equal((await call(env, '/api/snapshots?scope=weekly')).status, 400);
 // Intraday scope uses session keys and only the all-symbol row.
 const ibars = Array.from({length: 12}, (_, i) => ({symbol: 'SPY', session: '2026-11-17', bar: i + 1, open: 100, high: 101, low: 99, close: 100 + i * .1, final: +(i === 11)}));
 const ipreds = [{symbol: 'SPY', session: '2026-11-17', bar: 3, condition: 'skill', always_in: 'long', p_up_6: .6, target: null, stop: null, horizon: 6}];
 const rows = snapshotRows('intraday', ibars, ipreds, {created_at: 'x'});
 assert.deepEqual(rows.map(r => r.slice(0, 4)), [['intraday', '2026-11-17', 'skill', '*']]);
 assert.equal(JSON.parse(rows[0][4]).direction_hit_rate, computeIntradayMetrics(ibars, ipreds).conditions.skill.direction_hit_rate);
});

test('GET /api/explore filters by date, symbol and groups and reuses the shared metrics', sql, async () => {
 const {env, bars} = await seededDaily();
 await call(env, '/api/llm_calls', 'POST', {calls: [
  {ts: '2026-10-05T21:00:00Z', scope: 'daily', symbol: 'SPY', session_or_asof: dates[2], condition: 'skill', duration_ms: 1000, cost_usd: .01, input_tokens: 5, output_tokens: 6, cache_read_tokens: 7, ok: 1},
  {ts: '2026-10-05T21:00:00Z', scope: 'daily', symbol: 'QQQ', session_or_asof: dates[2], condition: 'skill', duration_ms: 3000, cost_usd: .03, ok: 0, error_type: 'invalid_output'},
  {ts: '2026-10-05T21:00:00Z', scope: 'daily', symbol: 'SPY', session_or_asof: dates[0], condition: 'skill', duration_ms: 9000, cost_usd: 1, ok: 1}]});
 const from = dates[2], to = dates[20];
 const r = await call(env, `/api/explore?scope=daily&from=${from}&to=${to}&symbol=SPY&conditions=skill`);
 assert.equal(r.status, 200);
 const data = await r.json();
 assert.deepEqual(Object.keys(data.metrics), ['skill']);
 assert.deepEqual(data.options.symbols, ['QQQ', 'SPY']);
 assert.deepEqual(data.options.conditions, ['ema20', 'skill']);
 const preds = (await env.DB.prepare('SELECT * FROM predictions').bind().all()).results
  .filter(p => p.symbol === 'SPY' && p.condition === 'skill' && p.asof >= from && p.asof <= to);
 const spy = bars.filter(b => b.symbol === 'SPY' && b.date >= from);
 const full = computeMetrics(spy, preds).conditions.skill;
 const account = computeMetrics(spy.filter(b => b.date <= dates[21]), preds).conditions.skill.account;
 assert.equal(data.metrics.skill.predictions, 19);
 assert.equal(data.metrics.skill.direction_hit_rate, full.direction_hit_rate);
 assert.equal(data.metrics.skill.brier, full.brier);
 assert.equal(data.metrics.skill.account.total_return, account.total_return);
 assert.equal(data.metrics.skill.account.equity_curve.at(-1).date, dates[21]);
 assert.equal(data.metrics.skill.calibration.length, 10);
 assert.equal(data.rolling_source, 'computed');
 assert.equal(data.rolling.skill.length, 19);
 assert.equal(data.rolling.skill[0].date, from);
 assert.deepEqual(data.llm.map(x => [x.condition, x.calls, x.ok]), [['skill', 1, 1]]);
 assert.equal(data.llm[0].avg_cost_usd, .01);
 assert.equal(data.metrics.skill.levels_inverted, 0);
 // All symbols: llm summary aggregates both rows in range, rolling now comes from snapshots on the latest day.
 await runSnapshots(env.DB);
 const both = await (await call(env, `/api/explore?scope=daily&from=${from}`)).json();
 assert.deepEqual(Object.keys(both.metrics).sort(), ['ema20', 'skill']);
 assert.equal(both.rolling_source, 'mixed');
 assert.equal(both.llm[0].calls, 2);
 assert.ok(Math.abs(both.llm[0].avg_duration_ms - 2000) < 1e-9);
 for (const bad of ['scope=weekly', 'from=2026-02-30', 'from=2026-11-02&to=2026-11-01', 'symbol=bad%20sym', 'conditions=a;b'])
  assert.equal((await call(env, '/api/explore?' + bad)).status, 400, bad);
 assert.equal((await call(env, '/explore')).status, 200);
});

test('GET /api/explore intraday scope and before-migration tables degrade gracefully', sql, async () => {
 const env = {DB: new SqliteD1(MIGRATIONS.slice(0, 2)), WRITE_TOKEN: 'test-secret'};
 const data = await (await call(env, '/api/explore?scope=intraday')).json();
 assert.deepEqual(data.metrics, {});
 assert.equal(data.llm, null);
 assert.equal((await call(env, '/api/export.csv?scope=intraday')).status, 200);
});

test('CSV cells escape quotes, separators, newlines and spreadsheet formulas', () => {
 assert.equal(csvCell('plain'), 'plain');
 assert.equal(csvCell('a,b'), '"a,b"');
 assert.equal(csvCell('say "hi"'), '"say ""hi"""');
 assert.equal(csvCell('two\nlines'), '"two\nlines"');
 assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
 assert.equal(csvCell('-cmd'), "'-cmd");
 assert.equal(csvCell(-0.25), '-0.25');
 assert.equal(csvCell(null), '');
 assert.equal(csvCell(true), '1');
 assert.equal(toCsv(['a', 'b'], [{a: 1, b: 'x,y'}]), 'a,b\r\n1,"x,y"\r\n');
});

test('GET /api/export.csv: one row per filtered prediction with outcome fields, attachment header', sql, async () => {
 const {env} = await seededDaily();
 await call(env, '/api/predictions', 'POST', prediction('SPY', dates[3], 'skill', {model: 'evil,"model"\n=1', close: 103, target: 90, stop: 110}));
 const r = await call(env, `/api/export.csv?scope=daily&from=${dates[3]}&to=${dates[4]}&symbol=SPY&conditions=skill`);
 assert.equal(r.status, 200);
 assert.match(r.headers.get('content-type'), /^text\/csv/);
 assert.match(r.headers.get('content-disposition'), /^attachment; filename="brooks_daily_SPY_2026-10-06_2026-10-07\.csv"$/);
 const text = await r.text();
 const lines = text.trim().split('\r\n');
 assert.equal(lines[0], 'id,symbol,asof,condition,model,skill_sha,always_in,p_up_5,target,stop,horizon,state,close,levels_ok,created_at,outcome_status,next_date,next_return,close_5,up_5,direction_hit,barrier');
 assert.equal(lines.length, 3);
 assert.ok(text.includes('"evil,""model""\n=1"'));
 const head = lines[0].split(',');
 const last = lines[2].split(',');
 assert.equal(last[head.indexOf('asof')], dates[4]);
 assert.equal(last[head.indexOf('outcome_status')], 'mature');
 assert.equal(last[head.indexOf('next_date')], dates[5]);
 assert.ok(['0', '1'].includes(last[head.indexOf('up_5')]));
 assert.match(text, /,0,[^,]*,mature,/); // levels_ok 0 for the inverted long
 const intraday = await call(env, '/api/export.csv?scope=intraday');
 assert.equal((await intraday.text()).split('\r\n')[0].split(',')[3], 'bar');
});

const scripts = html => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const sandbox = () => createContext({URL, URLSearchParams, Intl, setTimeout() {}, clearTimeout() {}, addEventListener() {},
 location: {search: '?scope=intraday', pathname: '/explore'}, history: {replaceState() {}}});

test('explore page: shared nav/style, Chinese sections, script boots to the DOM with every helper defined', async () => {
 const html = explorePage();
 assert.match(html, /<a href="\/explore" aria-current="page">分析<\/a>/);
 assert.match(html, /prefers-color-scheme:dark/);
 for (const text of ['范围', '日线', '日内', '日期从', '标的', '组别', '谁更准', '高级指标', '累计收益', '滚动 20 日', '概率校准', '模型花费', '下载 CSV'])
  assert.ok(html.includes(text), text);
 const [script] = scripts(html);
 assert.match(script, /^\/\/[^\n]*\nvar __name = \(fn, _name\) => fn;/);
 for (const text of ['总花费', '每次平均', '平均耗时', '目标/止损方向异常', 'Claude + Brooks（看图）', '均线规则（EMA20）'])
  assert.ok(html.includes(text), text);
 const wrapped = script.replace('const $ = id => document.getElementById(id);', 'const $ = __name(id => document.getElementById(id), "$");');
 assert.notEqual(wrapped, script);
 for (const source of [script, wrapped]) {
  const context = sandbox();
  const started = new Script(source).runInContext(context);
  for (const fn of ['drawLines', 'drawCalibration', 'drawEquity', 'pct', 'ratio', 'num', 'tone', 'drawdown', 'escapeHtml', 'levelsTag', 'isNum'])
   assert.equal(typeof context[fn], 'function', fn);
  await assert.rejects(started, e => e.name === 'ReferenceError' && /document/.test(e.message));
 }
});

test('bundler renaming a helper (drawLines -> drawLines2, num -> num2) still defines the names callers use', async () => {
 const rename = (fn, to) => new Function('return (' + fn.toString().replace(/^function\s+[\w$]+/, 'function ' + to) + ')')();
 const renamed = rename(exploreHelpers.drawLines, 'drawLines2');
 assert.equal(renamed.name, 'drawLines2');
 const html = explorePage({...exploreHelpers, drawLines: renamed});
 const [script] = scripts(html);
 assert.match(script, /function drawLines2\(/);
 assert.doesNotMatch(script, /function drawLines\(/);
 const context = sandbox();
 const started = new Script(script).runInContext(context);
 assert.equal(typeof context.drawLines, 'function');
 assert.equal(typeof context.drawLines2, 'function');
 await assert.rejects(started, e => /document/.test(e.message));
 // A renamed shared helper emitted under its key keeps both names, and the prelude's own helpers too.
 const num2 = rename(function num(v) { return String(v); }, 'num2');
 const ctx = createContext({});
 new Script(scriptPrelude([num2]) + '\n' + emitFunction(num2, 'num')).runInContext(ctx);
 assert.equal(ctx.num(1), '1');
 assert.equal(ctx.num2(1), '1');
 // Drawing helpers render SVG with a diagonal and hover titles in a minimal DOM stub.
 const box = {clientWidth: 390, innerHTML: ''};
 const draw = createContext({});
 new Script(scripts(explorePage())[0].replace(/\n\(async function loadExplore[\s\S]*$/, '')).runInContext(draw);
 draw.drawCalibration(box, [{key: 'skill', name: 'A<b>', color: 'red', buckets: [{bucket: 6, n: 3, mean_probability: .65, observed_up: 2 / 3}]}]);
 assert.match(box.innerHTML, /class="diag"/);
 assert.match(box.innerHTML, /A&lt;b&gt;：预测 65%，实际上涨 67%（3 个）/);
 draw.drawLines(box, [{key: 'a', name: 'A', color: 'red', points: [{date: '2026-11-17', value: .55, n: 4}, {date: '2026-11-18', value: .6, n: 5}]}], {center: .5});
 assert.match(box.innerHTML, /<polyline class="ln"/);
 draw.drawLines(box, [], {empty: '没有'});
 assert.match(box.innerHTML, /没有/);
});

test('inverted target/stop is marked 目标/止损方向异常 on the reading page and in the client helper', () => {
 const p = {id: 1, symbol: 'SPY', asof: '2026-11-19', condition: 'skill', always_in: 'long', p_up_5: .6, close: 100, target: 95, stop: 90,
  model: 'm', skill_sha: 'abc', reading: 'x'};
 assert.match(readingPage(p), /目标\/止损方向异常/);
 assert.doesNotMatch(readingPage({...p, target: 110}), /目标\/止损方向异常/);
 assert.match(readingPage({...p, target: 110, levels_ok: 0}), /目标\/止损方向异常/);
 assert.doesNotMatch(readingPage({...p, always_in: 'short', target: 90, stop: 105, levels_ok: null}), /目标\/止损方向异常/);
});
