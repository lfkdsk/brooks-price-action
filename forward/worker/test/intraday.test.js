import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {computeIntradayMetrics, decisionBar} from '../src/intraday-metrics.js';
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
