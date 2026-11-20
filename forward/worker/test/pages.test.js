import test from 'node:test';
import assert from 'node:assert/strict';
import {Script, createContext} from 'node:vm';
import {dashboard, dashboardPage, readingPage} from '../src/dashboard.js';
import {intradayPage, recapPage, splitOverall} from '../src/intraday-pages.js';
import {renderMarkdown, stripPreamble} from '../src/ui-common.js';

const session = '2026-11-19';
const bars = [
 {symbol: 'SPY', session: '2026-11-18', bar: 78, open: 730, high: 731, low: 726.8, close: 730.2, final: 1},
 ...Array.from({length: 30}, (_, i) => ({symbol: 'SPY', session, bar: i + 1, open: 735 - i * .3, high: 736 - i * .3,
  low: 734 - i * .3, close: 734.6 - i * .3, final: 0}))
];
const recap = {symbol: 'SPY', session, day_type: 'Bear trend day <b>', model: 'test-model', skill_sha: 'abcdef123456',
 markdown: "I have everything I need. Here's the recap.\n\n---\n\n**整体判断**\n日线：第二段下跌。\n- 反弹 约60%：726–731\n- 继续下跌 约40%：跌破 715\n\n**K线叙事**\n- Bar 1 <script>alert(1)</script> gap up\n\n# 明日关注\n看 715。",
 annotations: [{bar: 1, label: 'Gap-up HOD </text><img>', pos: 'above'}, {bar: 9, label: 'Bear spike', pos: 'below'}],
 levels: [{price: 735.5, label: 'Prior high <img>'}, {price: 730.2, label: 'Prior close'}, {price: 699.4, label: 'far target'}],
 prior: {session: '2026-11-18', close: 730.2, high: 735, low: 726.8}};
const history = [{session: '2026-11-20', day_type: 'Trading range'}, {session, day_type: recap.day_type}, {session: '2026-11-18', day_type: 'Bull channel'}];
const scripts = html => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

test('every inline script on all three pages parses and starts with the __name shim when it serializes functions', () => {
 const pages = {daily: dashboardPage(), intraday: intradayPage(), recap: recapPage('SPY', history, recap, bars)};
 for (const [name, html] of Object.entries(pages)) {
  for (const source of scripts(html)) {
   new Script(source, {filename: name + '.js'});
   if (/function \w+\(/.test(source)) assert.match(source, /^\/\/[^\n]*\nvar __name = \(fn, _name\) => fn;/, name);
  }
  assert.match(html, /<nav aria-label="页面"><a href="\/"[^>]*>每日<\/a><a href="\/intraday"[^>]*>日内<\/a><a href="\/recap"[^>]*>复盘<\/a>/, name);
  assert.match(html, /prefers-color-scheme:dark/, name);
 }
 assert.equal(scripts(pages.daily).length, 1);
 assert.equal(dashboard, pages.daily);
});

test('daily dashboard has the Chinese sections and its boot reaches the DOM after defining helpers', async () => {
 const html = dashboardPage();
 for (const text of ['今日概览', '各组现在怎么看', '谁更准', '高级指标', '累计收益', '最新判断', '怎么看这个页面', '13:40 PT', '对照组'])
  assert.ok(html.includes(text), text);
 const [script] = scripts(html);
 for (const text of ['样本太少，仅供参考', '5日方向准确率要等判断后满 5 个交易日', 'Claude + Brooks', '均线规则（EMA20）', '20日动量规则', '一直持有（参照）', '长期美债', 'Brier', '<0.25', '<0.693', '展开全文', '分歧'])
  assert.ok(script.includes(text), text);
 // Simulate esbuild keep_names wrapping a serialized helper.
 const wrapped = script.replace('const $ = id => document.getElementById(id);', 'const $ = __name(id => document.getElementById(id), "$");');
 assert.notEqual(wrapped, script);
 for (const source of [script, wrapped]) {
  const context = createContext({URL, URLSearchParams, Intl, setTimeout() {}, clearTimeout() {}, addEventListener() {},
   location: {search: ''}});
  const started = new Script(source).runInContext(context);
  for (const fn of ['pct', 'pill', 'drawEquity', 'renderMarkdown', 'cleanReading', 'stripPreamble']) assert.equal(typeof context[fn], 'function', fn);
  await assert.rejects(started, e => e.name === 'ReferenceError' && /document/.test(e.message));
 }
});

test('daily helpers format pills and strip reading preamble and trailing JSON', () => {
 const context = createContext({Intl});
 new Script(scripts(dashboardPage())[0].replace(/\n\(async function loadDaily[\s\S]*$/, '')).runInContext(context);
 assert.equal(context.pill('short', true), '<span class="pill short">空</span>');
 assert.equal(context.pill('unclear'), '<span class="pill flat">观望</span>');
 assert.equal(context.pct(.0211), '+2.11%');
 assert.equal(context.drawdown(.0296), '−2.96%');
 const reading = 'Data is in hand.\n\n# SPY daily\n**Always In Short**\n\n```json\n{"always_in":"short"}\n```';
 assert.equal(context.cleanReading(reading), '# SPY daily\n**Always In Short**');
 assert.doesNotMatch(context.renderMarkdown('<img src=x onerror=1>'), /<img/);
});

test('reading permalink page escapes HTML and renders markdown', () => {
 const html = readingPage({id: 1, symbol: 'SPY', asof: '2026-11-19', condition: 'skill', always_in: 'short', p_up_5: .42,
  close: 715.87, target: 700, stop: 741, model: '<m>', skill_sha: 'abc', reading: '# T\n<script>alert(1)</script>\n\n**b**'});
 assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
 assert.doesNotMatch(html, /<script>alert|<m>/);
 assert.match(html, /<h2>T<\/h2>/);
 assert.match(html, /Claude \+ Brooks/);
 assert.match(html, /42%/);
});

test('recap page: header, 整体判断 card, annotated chart, stripped preamble, history and pager', () => {
 const html = recapPage('SPY', history, recap, bars);
 for (const text of ['5分钟日内复盘', '整体判断', '走势图', '关键价位', '复盘全文', '往期复盘', '较昨收 730.20', '周四'])
  assert.ok(html.includes(text), text);
 assert.ok(html.indexOf('overall-title') < html.indexOf('chart-title'), '整体判断 sits above the chart');
 assert.match(html, /class="card overall"[\s\S]*反弹 约60%[\s\S]*<\/section>/);
 assert.doesNotMatch(html, /I have everything I need/);
 assert.match(html, /class="pill soft short">Bear trend day &lt;b&gt;/);
 assert.match(html, /<svg class="live"/);
 assert.match(html, /class="ann"/);
 assert.match(html, /Gap-up HOD &lt;\/text&gt;&lt;img&gt;/);
 assert.match(html, /class="axis glevel"/);
 assert.match(html, /昨收 730\.20/);
 assert.match(html, /href="\/recap\/2026-11-18\?symbol=SPY">← 前一天 11-18/);
 assert.match(html, /href="\/recap\/2026-11-20\?symbol=SPY">后一天 11-20 →/);
 assert.match(html, /aria-current="page"><a href="\/recap\/2026-11-19/);
 assert.match(html, /<h2>明日关注<\/h2>/);
 assert.doesNotMatch(html, /<script|<img|<b>Bear/);
 const old = recapPage('SPY', history, {...recap, markdown: '# 旧复盘\n- a'}, bars);
 assert.doesNotMatch(old, /overall-title/);
 assert.match(recapPage('QQQ', [], null, []), /还没有复盘/);
});

test('markdown helpers: preamble, rules, fences, emphasis and 整体判断 split', () => {
 assert.equal(stripPreamble('Sure! Here it is.\n\n# Title\nbody'), '# Title\nbody');
 assert.equal(stripPreamble('no heading at all'), 'no heading at all');
 const html = renderMarkdown('para *em* and **b**\n\n---\n\n```\n<x>\n```');
 assert.match(html, /<p>para <em>em<\/em> and <strong>b<\/strong><\/p>/);
 assert.match(html, /<hr>/);
 assert.match(html, /<pre><code>&lt;x&gt;<\/code><\/pre>/);
 const {overall, rest} = splitOverall('**整体判断**\n日线\n- A 约60%\n\n**K线**\n- x');
 assert.equal(overall, '日线\n- A 约60%');
 assert.equal(rest, '**K线**\n- x');
 assert.deepEqual(splitOverall('# a'), {overall: '', rest: '# a'});
});
