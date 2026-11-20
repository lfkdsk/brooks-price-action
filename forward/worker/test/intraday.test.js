import test from 'node:test';
import assert from 'node:assert/strict';
import {Script, createContext} from 'node:vm';
import {computeIntradayMetrics, decisionBar, sessionPositions} from '../src/intraday-metrics.js';
import {buildOverlay, liveChart, priorLevels, ptClock} from '../src/intraday-chart.js';
import {intradayPage, recapPage, renderMarkdown} from '../src/intraday-pages.js';

const session = '2026-11-17';
const bar = (n, overrides = {}) => ({symbol: 'SPY', session, bar: n, open: 100, high: 103,
 low: 97, close: 100, ...overrides});
const prediction = (n, overrides = {}) => ({symbol: 'SPY', session, bar: n, condition: 'skill',
 always_in: 'long', p_up_6: .7, target: null, stop: null, horizon: 6, ...overrides});
const closeTo = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('next open, reversal at next open, final close, and per-unit cost', () => {
 const bars = [bar(1), bar(3, {close: 103}), bar(4, {open: 101}),
  bar(6), bar(7, {open: 104}), bar(8, {close: 102, final: 1})];
 const {account} = computeIntradayMetrics(bars, [prediction(3),
  prediction(6, {always_in: 'short'})], {cost_bps: 10}).conditions.skill;
 closeTo(account.total_return, .03 + .02 - .004);
 closeTo(account.exposure, 5 / 8);
 assert.equal(account.equity_curve[0].final, true);
});

test('sessions never share entries, horizons, or exposure', () => {
 const tomorrow = '2026-11-18';
 const bars = [bar(1), bar(4, {open: 102, close: 104}), bar(6, {close: 105, final: 1}),
  bar(1, {session: tomorrow, open: 300, close: 300}),
  bar(7, {session: tomorrow, open: 300, close: 300, final: 1})];
 const result = computeIntradayMetrics(bars, [prediction(3), prediction(6)], {cost_bps: 0}).conditions.skill;
 closeTo(result.account.total_return, .03);
 assert.equal(result.account.days, 1);
 assert.equal(result.unavailable_6, 1);
 assert.equal(result.missing_bars, 1);
});

test('cadence, same-bar stop, exact +6, pending counts and matched pairing', () => {
 assert.deepEqual(Array.from({length: 79}, (_, i) => i).filter(decisionBar),
  Array.from({length: 25}, (_, i) => 3 * (i + 1)));
 const bars = Array.from({length: 9}, (_, i) => bar(i + 1, i === 8 ? {close: 101} : {}));
 const p = [prediction(3, {target: 102, stop: 98}), prediction(6, {condition: 'missed'}),
  prediction(6, {always_in: 'unclear', horizon: 12, target: 102, stop: 98}),
  prediction(7), prediction(9, {target: 102, stop: 98}),
  prediction(3, {condition: 'ema20_5m', always_in: 'short', p_up_6: .5})];
 const s = computeIntradayMetrics(bars, p);
 assert.equal(s.missed, 1);
 assert.equal(s.conditions.skill.decisions, 3);
 assert.equal(s.conditions.skill.target_stop.stop, 1);
 assert.equal(s.conditions.skill.pending_horizon, 1);
 assert.equal(s.conditions.skill.pending_entries, 1);
 assert.equal(s.conditions.skill.pending_6, 2);
 assert.equal(s.conditions.skill.direction_hit_rate, 1);
 closeTo(s.conditions.skill.brier, .09);
 assert.equal(s.paired.skill.ema20_5m.n, 1);
 assert.equal(s.paired.skill.ema20_5m.delta.direction_hit_rate, 1);
});

test('recap headings, lists, code, bold, paragraphs and SVG labels escape HTML', () => {
 const markdown = '# <img src=x onerror=alert(1)>\n\n**<b>** \x60<script>\x60\n\n- a & b\n\n1. c';
 const rendered = renderMarkdown(markdown);
 assert.match(rendered, /<h2>&lt;img/);
 assert.match(rendered, /<p><strong>&lt;b&gt;<\/strong> <code>&lt;script&gt;/);
 assert.match(rendered, /<ul><li>a &amp; b<\/li><\/ul>/);
 assert.match(rendered, /<ol><li>c<\/li><\/ol>/);
 const payload = {session, markdown, day_type: '<script>', prior: {close: 101, low: 98},
  annotations: [{bar: 1, pos: 'above', label: '</text><script>'}], levels: [{price: 101, label: '<img>'}]};
 const html = recapPage('SPY', [payload], payload, [bar(1)]);
 assert.match(html, /<svg/);
 assert.match(html, /stroke-dasharray/);
 assert.match(html, /&lt;\/text&gt;&lt;script&gt;/);
 assert.doesNotMatch(html, /<script>|<img/);
 new Script(intradayPage().match(/<script>([\s\S]+)<\/script>/)[1]);
});

test('overlay begins at next open, leaves unclear flat, and marks actual transitions', () => {
 const bars = Array.from({length: 13}, (_, i) => bar(i + 1, {final: +(i === 12)}));
 const predictions = [prediction(3), prediction(6, {always_in: 'unclear'}),
  prediction(9, {always_in: 'short'}), prediction(12, {always_in: 'short'})];
 const overlay = buildOverlay(bars, predictions, session, 'skill');
 assert.deepEqual(overlay.segments, [
  {start: 4, end: 7, side: 'long'}, {start: 7, end: 10, side: 'flat'},
  {start: 10, end: 13, side: 'short'}, {start: 13, end: 14, side: 'short'}
 ]);
 assert.deepEqual(overlay.markers.map(m => [m.bar, m.type, m.price]),
  [[4, 'entry', 'open'], [7, 'exit', 'open'], [10, 'entry', 'open'], [13, 'exit', 'close']]);
 const active = buildOverlay(bars.slice(0, 9), predictions, session, 'skill');
 assert.equal(active.decisions.at(-1).bar, 9);
 assert.equal(active.segments.at(-1).side, 'flat');
});

test('switching session and condition resets the chart to matching decisions and prior levels', () => {
 const tomorrow = '2026-11-18';
 const bars = [bar(3), bar(4, {close: 102}), bar(3, {session: tomorrow}), bar(4, {session: tomorrow})];
 const predictions = [prediction(3), prediction(3, {session: tomorrow, condition: 'skill_chart', always_in: 'short'})];
 assert.equal(buildOverlay(bars, predictions, session, 'skill').segments[0].side, 'long');
 assert.deepEqual(buildOverlay(bars, predictions, tomorrow, 'skill').segments, []);
 assert.deepEqual(buildOverlay(bars, predictions, tomorrow, 'skill_chart').segments, [{start: 4, end: 5, side: 'short'}]);
 assert.deepEqual(priorLevels(bars, tomorrow), {close: 102, low: 97});
});

test('skill_chart pairs with skill on matching decisions and uses shared next-open position accounting', () => {
 const bars = [bar(1), bar(3), bar(4, {close: 102}), bar(6, {close: 103})];
 const predictions = [prediction(3), prediction(3, {condition: 'skill_chart'}),
  prediction(6, {condition: 'skill_chart', always_in: 'short'}), prediction(3, {condition: 'buy_hold'})];
 const metrics = computeIntradayMetrics(bars, predictions);
 assert.equal(metrics.paired.skill_chart.skill.n, 1);
 assert.equal(metrics.paired.skill_chart.buy_hold.n, 1);
 const positions = sessionPositions(bars, predictions, ['skill_chart', 'baseline'], 1);
 assert.equal(positions.skill_chart.position, 'long');
 closeTo(positions.skill_chart.return, .03 - .0001);
 assert.deepEqual(positions.baseline, {position: 'flat', return: null});
});

test('intraday page script defines the __name shim and runs top-level code in a DOM-less sandbox', async () => {
 const html = intradayPage();
 const script = html.match(/<script>([\s\S]+)<\/script>/)[1];
 assert.match(script, /^\/\/[^\n]*\nvar __name = \(fn, _name\) => fn;/);
 for (const text of ['今日概览', '各组现在怎么看', '走势图', '观点时间轴', '谁更准', '高级指标', '累计收益', '怎么看这个页面'])
  assert.ok(html.includes(text), text);
 assert.ok(script.includes('样本太少，仅供参考'));
 // Simulate esbuild keep_names wrapping a serialized helper.
 const wrapped = script.replace('const $ = id => document.getElementById(id);',
  'const $ = __name(id => document.getElementById(id), "$");');
 assert.notEqual(wrapped, script);
 for (const source of [script, wrapped]) {
  // Browser globals other than the DOM, so the boot reaches its first `document` access.
  const context = createContext({URL, URLSearchParams, Intl, setTimeout() {}, clearTimeout() {}, addEventListener() {},
   location: {search: '?symbol=SPY', href: 'https://example.test/intraday?symbol=SPY'}, history: {replaceState() {}}});
  const started = new Script(source).runInContext(context);
  assert.equal(typeof context.__name, 'function');
  assert.equal(typeof context.liveChart, 'function');
  // Every global the boot needs before touching the DOM must exist: the first failure is `document`.
  await assert.rejects(started, e => e.name === 'ReferenceError' && /document/.test(e.message));
 }
});

test('live chart draws Chinese guides, triangle markers, PT axis and scrolls on narrow screens', () => {
 assert.equal(ptClock(1), '6:30');
 assert.equal(ptClock(7), '7:00');
 assert.equal(ptClock(79), '13:00');
 const prior = '2026-11-16';
 const bars = [bar(78, {session: prior, close: 99, low: 96}),
  ...Array.from({length: 40}, (_, i) => bar(i + 1, {close: 100 + (i % 3) - 1}))];
 const predictions = [prediction(3), prediction(6, {always_in: 'short'}),
  prediction(9, {always_in: 'unclear', target: 102.5, stop: 97.5})];
 const overlay = buildOverlay(bars, predictions, session, 'skill');
 const svg = liveChart(bars, {session, prior: priorLevels(bars, session), overlay, latest: overlay.decisions.at(-1),
  activeBar: 6, viewWidth: 360, height: 320, minStep: 10});
 assert.match(svg, /昨收 99\.00/);
 assert.match(svg, /目标 102\.50/);
 assert.match(svg, /止损 97\.50/);
 assert.match(svg, /class="dm dm-long" data-bar="3"/);
 assert.match(svg, /class="dm dm-short active" data-bar="6"/);
 assert.match(svg, /class="dm dm-flat" data-bar="9"[\s\S]*<circle/);
 assert.match(svg, />7:00</);
 assert.match(svg, /class="shade-long"/);
 assert.doesNotMatch(svg, /fill="#438bdb"/);
 const width = Number(svg.match(/width="(\d+)"/)[1]);
 assert.ok(width > 360, 'phone chart should be wider than the viewport and scroll');
 assert.match(liveChart([], {session}), /还没有K线/);
});
