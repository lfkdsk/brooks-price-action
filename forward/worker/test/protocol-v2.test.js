// Protocol v2. Expected numbers are worked out by hand in the comments, never taken from the code under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {Script, createContext} from 'node:vm';
import worker from '../src/index.js';
import {runSnapshots} from '../src/archive-api.js';
import {computeMetrics} from '../src/metrics.js';
import {computeMetricsV2, dailyOutcomeV2, sessionOpenMillis} from '../src/metrics-v2.js';
import {computeIntradayMetrics} from '../src/intraday-metrics.js';
import {computeIntradayMetricsV2, indexMinutes, planFills, sessionPositionsV2, simulateSession} from '../src/intraday-metrics-v2.js';
import {barExit, protocolFor, tradeLevels, utcMillis} from '../src/protocol.js';
import {buildOverlay} from '../src/intraday-chart.js';
import {dashboardPage} from '../src/dashboard.js';
import {intradayPage} from '../src/intraday-pages.js';
import {explorePage} from '../src/explore-page.js';
import {MIGRATIONS, SqliteD1, python3Available} from './sqlite-d1.js';
import {NOW, PATHS, fixtureSql, rowsSql} from './fixtures/v1-fixture.js';

const sql = {skip: !python3Available && 'python3 with sqlite3 is required'};
const near = (a, b, why) => assert.ok(typeof a === 'number' && Math.abs(a - b) < 1e-9, `${why || ''} ${a} ≠ ${b}`);

// ---------- daily ----------
const D = ['2026-11-25', '2026-11-27', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'];
const dbar = (i, open, extra = {}) => ({symbol: 'SPY', date: D[i], open, high: open + 1, low: open - 1, close: open, ...extra});
const dp = (i, always_in = 'long', extra = {}) => ({symbol: 'SPY', asof: D[i], condition: 'skill', always_in, p_up_5: .7, horizon: 5, target: null, stop: null, ...extra});
const daily = (bars, preds, cost_bps = 2) => computeMetricsV2(bars, preds, {cost_bps}).conditions;
const returns = m => m.account.equity_curve.map(r => r.return);

test('daily: fills at open t+1, held to open t+2, missing day is flat, turnover costs, last period not recorded', () => {
 const bars = [dbar(0, 100), dbar(1, 110, {close: 50}), dbar(2, 121, {close: 60}), dbar(3, 118.58), dbar(4, 120)];
 const m = daily(bars, [dp(0), dp(1, 'short'), dp(3)]).skill;
 // D0 long 110→121 = +10% − 1 unit (2 bp); D1 short 121→118.58 = +2% − reversal (4 bp); D2 missing: flat − 2 bp. D3 has no open[t+2].
 assert.deepEqual(m.account.equity_curve.map(r => r.date), [D[2], D[3], D[4]]);
 [.0998, .0196, -.0002].forEach((x, i) => near(returns(m)[i], x));
 near(m.account.total_return, 1.0998 * 1.0196 * .9998 - 1);
 near(m.account.exposure, 2 / 3);
 // Closes never matter, and later bars never change an already recorded period.
 const other = daily([...bars.slice(0, 3).map(b => ({...b, close: 999})), dbar(3, 1), dbar(4, 5000)], [dp(0), dp(1, 'short'), dp(3)]).skill;
 near(returns(other)[0], .0998);
});

test('daily: two bars record nothing (no mark-to-market); the data edge liquidates only into a flat next decision', () => {
 assert.deepEqual(daily([dbar(0, 100), dbar(1, 110)], [dp(0)]).skill.account.equity_curve, []);
 const bars = [dbar(0, 100), dbar(1, 110), dbar(2, 121)];
 near(returns(daily(bars, [dp(0), dp(1)]).skill)[0], .0998);            // still long: entry only
 near(returns(daily(bars, [dp(0), dp(1, 'unclear')]).skill)[0], .0996); // exit at open t+2
 near(returns(daily(bars, [dp(0)]).skill)[0], .0996);                   // missing next decision = flat
});

test('daily: a decision stored at or after the 09:30 New York fill open is not executed', () => {
 assert.equal(sessionOpenMillis('2026-11-27'), Date.parse('2026-11-27T14:30:00Z'));
 assert.equal(sessionOpenMillis('2026-07-09'), Date.parse('2026-07-09T13:30:00Z'));
 const bars = [dbar(0, 100), dbar(1, 110), dbar(2, 121)];
 const ok = daily(bars, [dp(0, 'long', {created_at: '2026-11-27 14:29:59'})], 0).skill, late = daily(bars, [dp(0, 'long', {created_at: '2026-11-27 14:30:00'})], 0).skill;
 near(returns(ok)[0], .1);
 assert.equal(ok.late, 0);
 assert.equal(returns(late)[0], 0);
 assert.equal(late.late, 1);
 assert.equal(late.predictions, 1);
 assert.equal(dailyOutcomeV2(dp(0, 'long', {created_at: '2026-11-27T14:30:00Z'}), bars).fill_status, 'late');
});

test('daily: every forecast matures after exactly five later bars; barriers keep the declared horizon', () => {
 const closes = [100, 99, 99, 99, 99, 101];
 const bars = closes.map((c, i) => dbar(i, 100, {close: c, high: 102, low: 98}));
 const p = dp(0, 'long', {horizon: 10, target: 103, stop: 97});
 const v2 = daily(bars, [p]).skill;
 assert.equal(v2.mature, 1);
 assert.equal(v2.pending_5, 0);
 assert.equal(v2.direction_hit_rate, 1);       // 101 > 100
 near(v2.brier, .09);                          // (.7 − 1)²
 assert.equal(v2.pending_horizon, 1);          // 10 bars not there yet
 assert.deepEqual(v2.target_stop, {});
 assert.equal(computeMetrics(bars, [p]).conditions.skill.mature, 0); // v1 still waits for 10
 assert.equal(daily(bars.slice(0, 5), [p]).skill.mature, 0);         // four later bars are not enough
 assert.equal(daily(bars.map((b, i) => i === 5 ? {...b, close: 100} : b), [p]).skill.direction_hit_rate, 0); // equality is not up
});

test('daily target/stop: same-bar stop, target, wrong side, one level, re-entry and costs', () => {
 const bars = [dbar(0, 100), dbar(1, 110, {high: 115, low: 105}), dbar(2, 121, {high: 122, low: 120}), dbar(3, 121)];
 const run = (p, next = dp(1)) => daily(bars, [p, next])['skill_ts'];
 // Both levels inside 105–115: stop 106. −4/110 − entry − exit; D1 re-enters (1 unit) 121→121, then flat edge exit (1 unit).
 let m = run(dp(0, 'long', {target: 114, stop: 106}));
 near(returns(m)[0], -4 / 110 - .0004);
 near(returns(m)[1], -.0004);
 assert.deepEqual([m.target_exits, m.stop_exits, m.levels_ignored, m.levels_missing, m.levels_wrong_side], [0, 1, 2, 2, 0]); // D1 gave no levels
 m = run(dp(0, 'long', {target: 114, stop: 104}));
 near(returns(m)[0], 4 / 110 - .0004);
 assert.equal(m.target_exits, 1);
 // Target 109 is below the fill 110 although above close 100: ignored; the stop alone still works.
 m = run(dp(0, 'long', {target: 109, stop: 106}), dp(1, 'unclear'));
 near(returns(m)[0], -4 / 110 - .0004);
 near(returns(m)[1], 0);
 assert.deepEqual([m.levels_ignored, m.levels_wrong_side], [1, 1]);
 // Short: target below, stop above. 110 → 106 = +4/110.
 m = run(dp(0, 'short', {target: 106, stop: 116}), dp(1, 'unclear'));
 near(returns(m)[0], 4 / 110 - .0004);
 // No usable level: identical to the base condition.
 m = daily(bars, [dp(0, 'long', {target: 100, stop: 120}), dp(1)]);
 assert.deepEqual(m.skill_ts.account, m.skill.account);
 assert.equal(m.skill_ts.levels_ignored, 4);
 assert.equal(m.skill_ts.derived_from, 'skill');
 assert.equal(m.skill_ts.direction_hit_rate, m.skill.direction_hit_rate);
 // Derived variants exist only for the LLM conditions.
 assert.deepEqual(Object.keys(daily(bars, ['skill', 'baseline', 'ema20'].map(condition => dp(0, 'long', {condition})))).sort(), ['baseline', 'baseline_ts', 'ema20', 'skill', 'skill_ts']);
});

test('bar exits: gaps fill at the open (worse or better), levels on the fill price are ignored', () => {
 const bar = (open, high, low) => ({open, high, low});
 assert.deepEqual(barExit(bar(95, 96, 94), 1, {target: 110, stop: 98}), {reason: 'stop', price: 95});
 assert.deepEqual(barExit(bar(112, 113, 111), 1, {target: 110, stop: 98}), {reason: 'target', price: 112});
 assert.deepEqual(barExit(bar(112, 113, 111), -1, {target: 90, stop: 110}), {reason: 'stop', price: 112});
 assert.deepEqual(barExit(bar(88, 89, 87), -1, {target: 90, stop: 110}), {reason: 'target', price: 88});
 assert.deepEqual(barExit(bar(100, 110, 98), 1, {target: 110, stop: 98}), {reason: 'stop', price: 98});
 assert.deepEqual(barExit(bar(100, 110, 90), -1, {target: 90, stop: 110}), {reason: 'stop', price: 110});
 assert.deepEqual(barExit(bar(100, 110, 99), 1, {target: 110, stop: 98}), {reason: 'target', price: 110});
 assert.deepEqual(barExit(bar(112, 113, 95), 1, {target: 110, stop: 98}), {reason: 'target', price: 112}); // opened beyond the target first
 assert.equal(barExit(bar(100, 109, 99), 1, {target: 110, stop: 98}), null);
 assert.equal(barExit(bar(100, 999, 0), 1, {target: null, stop: null}), null);
 assert.deepEqual(tradeLevels({target: 100, stop: null}, 1, 100), {target: null, stop: null, ignored: 2, missing: 1, wrong_side: 1});
});

test('created_at parsing: D1 text is UTC, ISO accepted, junk rejected; v parameter', () => {
 const t = Date.UTC(2026, 10, 27, 14, 45, 3);
 for (const s of ['2026-11-27 14:45:03', '2026-11-27T14:45:03', '2026-11-27T14:45:03Z', '2026-11-27T09:45:03-05:00']) assert.equal(utcMillis(s), t, s);
 for (const s of [null, undefined, '', 'now', 5, '2026-11-27']) assert.ok(Number.isNaN(utcMillis(s)));
 const q = s => protocolFor('intraday', new URLSearchParams(s));
 assert.deepEqual([q('').version, q('').from, q('v=2&all=1').from, q('v=1').version, q('v=3')], [2, '2026-11-27', null, 1, null]);
 assert.equal(protocolFor('daily', new URLSearchParams('')).from, '2026-11-25');
});

// ---------- intraday (2026-11-27 is a half-day: 09:30–13:00 ET = 14:30–18:00Z, 42 bars) ----------
const S = '2026-11-27', T0 = Date.parse(S + 'T14:30:00Z');
const stamp = (min, sec = 0) => new Date(T0 + min * 60000 + sec * 1000).toISOString().slice(0, 19).replace('T', ' '); // D1 format
const five = (n, o = {}) => ({symbol: 'SPY', session: S, bar: n, ts: new Date(T0 + (n - 1) * 300000).toISOString().replace('.000', ''),
 open: 100, high: 100, low: 100, close: 100, final: 0, ...o});
const half = (over = {}) => Array.from({length: 42}, (_, i) => five(i + 1, {final: +(i === 41), ...over[i + 1]}));
const minute = (m, o = {}) => ({symbol: 'SPY', session: S, ts: new Date(T0 + m * 60000).toISOString().replace('.000', ''), open: 100, high: 100, low: 100, close: 100, ...o});
const minutes = (over = {}, skip = []) => Array.from({length: 210}, (_, m) => m).filter(m => !skip.includes(m)).map(m => minute(m, over[m]));
const ip = (bar, created, always_in = 'long', o = {}) => ({symbol: 'SPY', session: S, bar, condition: 'skill', always_in, p_up_6: .6, target: null, stop: null, horizon: 6, created_at: created, ...o});
const fills = (bb, mm, pp) => planFills(bb, indexMinutes(mm).get(JSON.stringify(['SPY', S])), pp).map(f => [f.status, f.t === null ? null : (f.t - T0) / 60000, f.price, f.source]);
const sim = (bb, mm, pp, {ts = true, cost = 0} = {}) => simulateSession(bb, pp, cost, {minutes: indexMinutes(mm), ts});

test('intraday: first 1-minute bar starting at or after created_at (exact boundary, between minutes, ISO)', () => {
 const bb = half(), mm = minutes({15: {open: 101}, 16: {open: 102}});
 assert.deepEqual(fills(bb, mm, [ip(3, stamp(15))]), [['filled', 15, 101, '1m']]);
 assert.deepEqual(fills(bb, mm, [ip(3, stamp(15, 1))]), [['filled', 16, 102, '1m']]);
 assert.deepEqual(fills(bb, mm, [ip(3, stamp(15, 44))]), [['filled', 16, 102, '1m']]);
 assert.deepEqual(fills(bb, mm, [ip(3, stamp(15, 44).replace(' ', 'T') + 'Z')]), [['filled', 16, 102, '1m']]);
 // Never inside the decision's own 5-minute bar, whatever the clock says.
 assert.deepEqual(fills(bb, mm, [ip(3, stamp(11))]), [['filled', 15, 101, '1m']]);
});

test('intraday: 5-minute fallback without covering 1-minute bars; a single missing minute keeps the next 1-minute bar', () => {
 const bb = half({5: {open: 105}, 6: {open: 106}});
 assert.deepEqual(fills(bb, [], [ip(3, stamp(15, 44))]), [['filled', 20, 105, '5m']]);
 assert.deepEqual(fills(bb, [], [ip(3, stamp(20))]), [['filled', 20, 105, '5m']]);                      // exact 5-minute boundary
 assert.deepEqual(fills(bb, minutes({}, [...Array(200).keys()]), [ip(3, stamp(15, 44))]), [['filled', 20, 105, '5m']]); // archive starts much later
 assert.deepEqual(fills(bb, minutes({17: {open: 103}}, [16]), [ip(3, stamp(15, 44))]), [['filled', 17, 103, '1m']]);
 assert.deepEqual(fills(bb, minutes({21: {open: 103}}, [20]), [ip(3, stamp(19, 30))]), [['filled', 21, 103, '1m']]);
});

test('intraday: nothing fills in or after the final bar (half-day bar 42), unreadable created_at is unfilled, live is pending', () => {
 const bb = half(), mm = minutes();
 assert.deepEqual(fills(bb, mm, [ip(39, stamp(204, 0))])[0].slice(0, 2), ['filled', 204]);
 assert.equal(fills(bb, mm, [ip(39, stamp(204, 1))])[0][0], 'unfilled'); // next minute is 205 = inside final bar 42
 assert.equal(fills(bb, mm, [ip(42, stamp(210, 40))])[0][0], 'unfilled');
 assert.equal(fills(bb, mm, [ip(3, null)])[0][0], 'unfilled');
 assert.equal(fills(bb, mm, [ip(3, '2026-11-28 15:00:00')])[0][0], 'unfilled'); // stored the next day
 const m = computeIntradayMetricsV2(bb, [ip(39, stamp(204, 1)), ip(42, stamp(210, 40))], {minutes: indexMinutes(mm)}).conditions.skill;
 assert.equal(m.unfilled, 2);
 assert.equal(m.account.total_return, 0);
 assert.equal(m.pending_entries, 0);
 // In progress: bar 3 just closed, no bar after created_at is stored yet.
 const live = bb.slice(0, 3), lm = mm.slice(0, 16);
 assert.equal(fills(live, lm, [ip(3, stamp(15, 44))])[0][0], 'pending');
 assert.equal(computeIntradayMetricsV2(live, [ip(3, stamp(15, 44))], {minutes: indexMinutes(lm)}).conditions.skill.pending_entries, 1);
});

test('intraday: a full session ends at bar 78 and early closes end at the flagged bar only', () => {
 const full = Array.from({length: 78}, (_, i) => five(i + 1, {final: 0}));
 assert.deepEqual(fills(full, [], [ip(75, stamp(375, 44))])[0].slice(0, 2), ['filled', 380]); // bar 77
 assert.equal(fills(full, [], [ip(75, stamp(380, 1))])[0][0], 'unfilled');                    // bar 78 is final
 assert.deepEqual(fills(full, [], [ip(42, stamp(210, 40))])[0].slice(0, 2), ['filled', 215]);  // an ordinary day continues after 42
});

test('intraday: account, flat at the half-day close, turnover cost, exposure; missed points keep the position', () => {
 const bb = half({1: {open: 100}, 42: {close: 106}}), mm = minutes({16: {open: 101}, 46: {open: 104}});
 // Long 101→104, short 104→106 (close): +3 −2 = +1 on base 100; costs 1 + 2 + 1 units × 10 bp.
 const pp = [ip(3, stamp(15, 44)), ip(9, stamp(45, 30), 'short')];
 const m = computeIntradayMetricsV2(bb, [...pp, ip(6, stamp(31), 'unclear', {condition: 'missed'})], {cost_bps: 10, minutes: indexMinutes(mm)});
 near(m.conditions.skill.account.total_return, .01 - .004);
 near(m.conditions.skill.account.exposure, (210 - 16) / 210);
 assert.equal(m.missed, 1);
 assert.equal(m.conditions.skill.decisions, 2);
 // The missed point at bar 6 changes nothing: same as having no row there at all (also true in v1).
 near(computeIntradayMetricsV2(bb, pp, {cost_bps: 10, minutes: indexMinutes(mm)}).conditions.skill.account.total_return, .006);
 const v1 = [...pp, ip(6, stamp(31), 'unclear', {condition: 'missed'})];
 near(computeIntradayMetrics(bb, v1, {cost_bps: 10}).conditions.skill.account.total_return, computeIntradayMetrics(bb, pp, {cost_bps: 10}).conditions.skill.account.total_return);
 // An unfilled decision keeps the previous position too.
 near(computeIntradayMetricsV2(bb, [pp[0], ip(39, stamp(206), 'short')], {cost_bps: 0, minutes: indexMinutes(mm)}).conditions.skill.account.total_return, .05);
 // Mechanical groups use their own created_at.
 const rules = computeIntradayMetricsV2(bb, [ip(3, stamp(15, 0), 'long', {condition: 'buy_hold'})], {cost_bps: 0, minutes: indexMinutes(minutes({15: {open: 99}}))});
 near(rules.conditions.buy_hold.account.total_return, .07);
 assert.deepEqual(Object.keys(rules.conditions), ['buy_hold']);
});

test('intraday: a late older decision never overrides a newer one, and equal fills use the newer decision', () => {
 const bb = half(), mm = minutes();
 assert.deepEqual(fills(bb, mm, [ip(3, stamp(32, 10)), ip(6, stamp(30, 44), 'short')]).map(f => f.slice(0, 2)), [['superseded', 33], ['filled', 31]]);
 assert.deepEqual(fills(bb, mm, [ip(6, stamp(30, 50), 'short'), ip(3, stamp(30, 20))]).map(f => f.slice(0, 2)), [['superseded', 31], ['filled', 31]]);
 const r = sim(half({42: {close: 90}}), mm, [ip(3, stamp(32, 10)), ip(6, stamp(30, 44), 'short')], {ts: false});
 near(r.return, .1); // short 100 → 90; the older long never trades
 assert.equal(r.counts.superseded, 1);
 const m = computeIntradayMetricsV2(bb, [ip(3, stamp(32, 10)), ip(6, stamp(30, 44), 'short')], {minutes: indexMinutes(mm)}).conditions.skill;
 assert.equal(m.superseded, 1);
});

test('intraday: an open session is marked at the newest stored close, never at a close older than the fill', () => {
 const bb = half({3: {close: 90}}).slice(0, 3), mm = minutes({16: {open: 100, close: 101, high: 101}}).slice(0, 17);
 const r = sim(bb, mm, [ip(3, stamp(15, 44))], {ts: false, cost: .001});
 near(r.return, .01 - .001); // 100 → 101 (minute 16), not the 90 close of bar 3 that preceded the fill; no exit cost yet
 assert.equal(r.position, 'long');
 near(sim(half({4: {close: 102}}).slice(0, 4), mm, [ip(3, stamp(15, 44))], {ts: false}).return, .02);
});

test('intraday target/stop: target, stop, same minute = stop, gaps, fill bar included, costs', () => {
 const p = o => [ip(3, stamp(15, 44), 'long', o)], lv = {target: 103, stop: 98};
 near(sim(half(), minutes({30: {high: 103}}), p(lv)).return, .03);
 near(sim(half(), minutes({30: {high: 103}}), p(lv), {cost: .0001}).return, .03 - .0002); // entry + exit, none at the close
 near(sim(half(), minutes({30: {low: 98}}), p(lv)).return, -.02);
 near(sim(half(), minutes({30: {high: 104, low: 97}}), p(lv)).return, -.02);
 near(sim(half(), minutes({30: {open: 95, high: 96, low: 94, close: 95}}), p(lv)).return, -.05);   // gap: worse
 near(sim(half(), minutes({30: {open: 105, high: 106, low: 104, close: 105}}), p(lv)).return, .05); // gap: better
 near(sim(half(), minutes({16: {low: 98}}), p(lv)).return, -.02);  // the fill minute counts
 near(sim(half({42: {close: 101}}), minutes({15: {low: 90}}), p(lv)).return, .01); // the minute before the fill does not
 near(sim(half(), minutes({209: {low: 98}}), p(lv)).return, -.02); // half-day: last minute before 13:00 ET still counts
 near(sim(half({42: {close: 101}}), [...minutes(), minute(212, {low: 90})], p(lv)).return, .01); // nothing after the final bar
 const r = sim(half(), minutes({30: {low: 98}}), p(lv));
 assert.equal(r.position, 'flat');
 near(r.exposure, (31 - 16) / 210);
});

test('intraday target/stop: wrong side of the FILL, null levels, one level alone, short side', () => {
 const mm = minutes({16: {open: 104, high: 104, low: 104}, 30: {high: 110, low: 98}});
 // Fill 104 is already above target 103: target ignored, stop 98 still works: (98 − 104)/100.
 let r = sim(half(), mm, [ip(3, stamp(15, 44), 'long', {target: 103, stop: 98})]);
 near(r.return, -.06);
 assert.deepEqual([r.counts.levels_ignored, r.counts.levels_wrong_side, r.counts.stop_exits], [1, 1, 1]);
 r = sim(half(), minutes({30: {high: 103}}), [ip(3, stamp(15, 44), 'long', {target: 103})]);
 near(r.return, .03);
 assert.deepEqual([r.counts.levels_ignored, r.counts.levels_missing, r.counts.target_exits], [1, 1, 1]);
 r = sim(half(), minutes({30: {low: 97, high: 102}}), [ip(3, stamp(15, 44), 'short', {target: 97, stop: 103})]);
 near(r.return, .03);
 r = sim(half({42: {close: 102}}), minutes({30: {low: 1, high: 999}}), [ip(3, stamp(15, 44))]);
 near(r.return, .02);
 assert.equal(r.counts.levels_ignored, 2);
});

test('intraday target/stop: flat until the next decision, re-entry pays turnover with its own levels; decisions replace levels', () => {
 const mm = minutes({20: {low: 98}, 25: {open: 99}, 31: {open: 101, high: 101, low: 101}, 40: {open: 101, high: 102}});
 const pp = [ip(3, stamp(15, 44), 'long', {target: 103, stop: 98}), ip(6, stamp(30, 40), 'long', {target: 102, stop: 95})];
 // −2 (100→98), flat, re-enter 101 → target 102 = +1. Costs: in, out, in, out = 4 units × 10 bp.
 const r = sim(half({42: {close: 150}}), mm, pp, {cost: .001});
 near(r.return, -.02 + .01 - .004);
 assert.deepEqual([r.counts.stop_exits, r.counts.target_exits], [1, 1]);
 near(sim(half({42: {close: 150}}), mm, [pp[0]]).return, -.02); // no later decision: stays flat
 // While the trade is open a same-side decision keeps the position (no turnover) but replaces the levels: 98 no longer stops.
 const keep = sim(half({42: {close: 104}}), minutes({40: {low: 97.5}}), [pp[0], ip(6, stamp(30, 40), 'long', {target: 110, stop: 95})], {cost: .001});
 near(keep.return, .04 - .002);
 // Base condition ignores every level.
 near(sim(half({42: {close: 104}}), mm, pp, {ts: false}).return, .04);
});

test('intraday target/stop: 5-minute fallback bars, and a missing minute cannot hide a stop', () => {
 const p = [ip(3, stamp(15, 44), 'long', {target: 103, stop: 98})];
 near(sim(half({7: {low: 97}}), [], p).return, -.02);
 near(sim(half({7: {low: 97, high: 104}}), [], p).return, -.02);
 near(sim(half({5: {low: 97}}), [], p).return, -.02); // fill bar (bar 5 open) included
 near(sim(half({4: {low: 97}, 42: {close: 101}}), [], p).return, .01); // bar 4 is before the fill
 near(sim(half({7: {open: 96, low: 95}}), [], p).return, -.04); // gap
 near(sim(half({7: {low: 97}}), minutes({}, [32]), p).return, -.02); // minute 32 missing: 5-minute bar 7 is used
 near(sim(half({7: {low: 97}, 42: {close: 101}}), minutes(), p).return, .01); // complete 1-minute data wins
});

test('intraday: session positions, fills and derived variants for the page; overlay follows the fills', () => {
 const bb = half({42: {close: 104}}), mm = indexMinutes(minutes({30: {low: 98}}));
 const pp = [ip(3, stamp(15, 44), 'long', {target: 110, stop: 98}), ip(6, stamp(206), 'short')];
 const s = sessionPositionsV2(bb, pp, ['skill', 'ema20_5m'], 0, mm);
 assert.deepEqual(Object.keys(s.positions), ['skill', 'skill_ts', 'ema20_5m']);
 near(s.positions.skill.return, .04);
 near(s.positions.skill_ts.return, -.02);
 assert.deepEqual(s.positions.ema20_5m, {position: 'flat', return: null});
 assert.deepEqual(s.fills.skill, [{bar: 3, status: 'filled', ts: '2026-11-27T14:46:00Z', price: 100, source: '1m', fill_bar: 4},
  {bar: 6, status: 'unfilled', ts: null, price: null, source: null, fill_bar: null}]);
 assert.deepEqual(buildOverlay(bb, pp, S, 'skill', s.fills.skill).segments, [{start: 4, end: 43, side: 'long'}]);
 assert.equal(buildOverlay(bb, pp, S, 'skill').segments.length, 2); // v1 overlay unchanged
 assert.deepEqual(sessionPositionsV2([], [], ['skill'], 0, new Map()).positions, {skill: {position: 'flat', return: null}, skill_ts: {position: 'flat', return: null}});
});

test('intraday: paired comparisons and forecast metrics are the v1 ones on v2 fills', () => {
 const bb = half({9: {close: 101}, 42: {close: 102}}), mm = indexMinutes(minutes());
 const pp = [ip(3, stamp(15, 44)), ip(3, stamp(15, 5), 'short', {condition: 'buy_hold', p_up_6: .5})];
 const m = computeIntradayMetricsV2(bb, pp, {cost_bps: 0, minutes: mm}), old = computeIntradayMetrics(bb, pp, {cost_bps: 0});
 for (const k of ['mature', 'direction_hit_rate', 'brier', 'log_loss', 'target_stop']) assert.deepEqual(m.conditions.skill[k], old.conditions.skill[k], k);
 near(m.paired.skill.buy_hold.delta.total_return, .04);
 assert.equal(m.conditions.skill_ts.derived_from, 'skill');
 assert.equal(m.paired.skill_ts, undefined);
});

// ---------- API ----------
const request = (env, path, method = 'GET', body) => worker.fetch(new Request('https://unit.test' + path, {method, headers: {authorization: 'Bearer t'},
 ...(body === undefined ? {} : {body: JSON.stringify(body)})}), env);
const getJson = async (env, path) => { const r = await request(env, path); assert.equal(r.status, 200, path); return r.json(); };
const makeEnv = (files = MIGRATIONS) => ({DB: new SqliteD1(files), WRITE_TOKEN: 't', INTRADAY_COST_BPS: '1'});
const frozen = async fn => { const now = Date.now; Date.now = () => NOW; try { return await fn(); } finally { Date.now = now; } };
const noNaN = text => assert.doesNotMatch(text, /NaN|Infinity|undefined/);

test('v=1 responses and v1 snapshots are byte-identical to the pre-v2 Worker', sql, async () => {
 const golden = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/golden-v1.json.gz', import.meta.url))));
 const env = makeEnv();
 env.DB.exec(fixtureSql());
 await frozen(async () => {
  await runSnapshots(env.DB, {created_at: 'fixed'});
  const rows = (await env.DB.prepare('SELECT * FROM metrics_snapshots ORDER BY scope,condition,symbol').bind().all()).results;
  assert.deepEqual(rows, golden.snapshots.rows);
  for (const path of PATHS) {
   const r = await request(env, path + (path.includes('?') ? '&' : '?') + 'v=1');
   assert.equal(r.status, golden[path].status, path);
   assert.ok(await r.text() === golden[path].body, path + ' differs from the golden body');
   if (r.status === 200) assert.equal(JSON.parse(r.headers.get('x-scoring-protocol')).version, 1);
  }
 });
 // The fixture's 11-25 daily decisions are the only ones in v2 scope.
 const v2 = (await env.DB.prepare("SELECT DISTINCT scope FROM metrics_snapshots_v2").bind().all()).results;
 assert.deepEqual(v2, [{scope: 'daily'}]);
});

// Decisions on both sides of the protocol starts.
function v2Rows() {
 const days = ['2026-11-23', '2026-11-24', ...D.slice(0, 5)];
 const opens = [100, 100, 100, 110, 121, 121, 121];
 const bars = days.map((date, i) => ({symbol: 'SPY', date, open: opens[i], high: opens[i] + 1, low: opens[i] - 1, close: opens[i]}));
 const predictions = days.slice(0, 4).map(asof => ({symbol: 'SPY', asof, condition: 'skill', model: 'm', skill_sha: 's', always_in: 'long', p_up_5: .6,
  target: null, stop: null, horizon: 5, state: 'x', close: 100, reading: 'r', created_at: asof + ' 21:41:00'}));
 const ibars = [...half({42: {close: 104}}), ...Array.from({length: 42}, (_, i) => five(i + 1, {session: '2026-11-24', ts: new Date(Date.parse('2026-11-24T14:30:00Z') + i * 300000).toISOString().replace('.000', ''), final: +(i === 41), close: i === 41 ? 95 : 100, low: 95}))]
  .map(b => ({...b, high: Math.max(b.high, b.close), volume: 1}));
 const ibars1m = minutes({16: {open: 101, high: 101}}).map((b, i) => ({...b, minute: i + 1, volume: 1}));
 const row = (session, created_at, condition = 'skill', bar = 3) => ({symbol: 'SPY', session, bar, ts: session + 'T14:40:00Z', condition, model: 'm', skill_sha: 's', always_in: 'long',
  p_up_6: .6, target: null, stop: null, horizon: 6, day_type: 'x', close: 100, reading: 'r', created_at});
 return {bars, predictions, ibars, ibars1m, ipredictions: [row(S, stamp(15, 44)), row('2026-11-24', '2026-11-24 14:45:44'), row('2026-11-24', '2026-11-24 15:00:44', 'missed', 6)]};
}

test('protocol start filtering, all=1, protocol metadata and bad versions', sql, async () => {
 const env = makeEnv();
 env.DB.exec(Object.entries(v2Rows()).map(([t, r]) => rowsSql(t, r)).join('\n'));
 const stats = await getJson(env, '/api/stats');
 assert.equal(stats.conditions.skill.predictions, 2); // 11-25, 11-27
 assert.deepEqual([stats.protocol.version, stats.protocol.from], [2, '2026-11-25']);
 // 11-25: 110→121 (+10%, entry 2 bp); 11-27 long 121→121; then flat: exit 2 bp.
 near(stats.conditions.skill.account.total_return, 1.0998 * 1 * .9998 - 1);
 const all = await getJson(env, '/api/stats?all=1');
 assert.equal(all.conditions.skill.predictions, 4);
 assert.equal(all.protocol.all, true);
 const equity = await getJson(env, '/api/equity');
 assert.deepEqual(equity.skill.map(r => r.date), ['2026-11-30', '2026-12-01', '2026-12-02']);
 assert.equal(equity.protocol.version, 2);
 const intra = await getJson(env, '/api/intraday/stats?symbol=SPY');
 assert.equal(intra.conditions.skill.decisions, 1);
 assert.equal(intra.missed, 0);
 near(intra.conditions.skill.account.total_return, .03 - .0002); // 101 → 104
 const intraAll = await getJson(env, '/api/intraday/stats?all=1');
 assert.equal(intraAll.conditions.skill.decisions, 2);
 assert.equal(intraAll.missed, 1);
 near(intraAll.conditions.skill.account.total_return, (1 - .05 - .0002) * (1 + .03 - .0002) - 1); // 11-24 uses the 5-minute fallback 100 → 95
 const today = await getJson(env, '/api/intraday/session');
 assert.equal(today.protocol.counted, true);
 near(today.positions.skill.return, .0298);
 assert.equal(today.fills.skill[0].ts, '2026-11-27T14:46:00Z');
 const before = await getJson(env, '/api/intraday/session?session=2026-11-24');
 assert.equal(before.protocol.counted, false);
 near(before.positions.skill.return, -.0502);
 const ex = await getJson(env, '/api/explore?scope=daily');
 assert.equal(ex.metrics.skill.predictions, 2);
 assert.ok(ex.metrics.skill_ts);
 assert.equal(ex.protocol.from, '2026-11-25');
 // Account stops at the second open after `to`.
 const cut = await getJson(env, '/api/explore?scope=daily&to=2026-11-25');
 assert.deepEqual(cut.metrics.skill.account.equity_curve.map(r => r.date), ['2026-11-30']);
 near(cut.metrics.skill.account.total_return, .0996);
 assert.equal((await getJson(env, '/api/explore?scope=daily&all=1')).metrics.skill.predictions, 4);
 assert.equal((await getJson(env, '/api/explore?scope=daily&from=2026-11-27')).metrics.skill.predictions, 1);
 assert.deepEqual(Object.keys((await getJson(env, '/api/explore?scope=daily&conditions=skill_ts')).metrics), ['skill_ts']);
 const exi = await getJson(env, '/api/explore?scope=intraday');
 assert.equal(exi.metrics.skill.decisions, 1);
 near(exi.rolling.skill[0].total_return, .0298);
 const csv = async q => (await (await request(env, '/api/export.csv?' + q)).text()).trim().split('\r\n');
 assert.equal((await csv('scope=daily')).length, 3);
 assert.equal((await csv('scope=daily&all=1')).length, 5);
 const lines = await csv('scope=intraday');
 assert.equal(lines.length, 2);
 const head = lines[0].replace('﻿', '').split(','), cells = lines[1].split(',');
 assert.deepEqual(['fill_status', 'fill_ts', 'fill_price', 'fill_source', 'protocol'].map(k => cells[head.indexOf(k)]), ['filled', '2026-11-27T14:46:00Z', '101', '1m', '2']);
 for (const path of ['/api/stats', '/api/equity', '/api/intraday/stats', '/api/intraday/session', '/api/explore', '/api/export.csv'])
  assert.equal((await request(env, path + '?v=3')).status, 400, path);
 // Snapshots: both tables, idempotent, v1 rows unaffected, optional reader.
 const first = await runSnapshots(env.DB, {created_at: 'x'});
 assert.equal(await runSnapshots(env.DB, {created_at: 'x'}), first);
 const count = async t => (await env.DB.prepare('SELECT COUNT(*) AS n FROM ' + t).bind().all()).results[0].n;
 assert.equal(await count('metrics_snapshots'), 3);      // daily *, daily SPY, intraday *
 assert.equal(await count('metrics_snapshots_v2'), 6);   // the same plus skill_ts
 const snap = (await getJson(env, '/api/snapshots?scope=daily&symbol=all&condition=skill&v=2')).snapshots;
 near(snap[0].metrics.account.total_return, 1.0998 * .9998 - 1);
 assert.equal((await getJson(env, '/api/snapshots?scope=daily&symbol=all')).snapshots[0].metrics.predictions, 4);
 // Minutes are read only for the sessions in scope, through the join with decisions.
 env.DB.statements.length = 0;
 await getJson(env, '/api/intraday/stats');
 assert.equal(env.DB.statements.filter(s => /ibars1m/.test(s)).length, 1);
 env.DB.statements.length = 0;
 await getJson(env, '/api/intraday/stats?v=1');
 assert.equal(env.DB.statements.filter(s => /ibars1m/.test(s)).length, 0);
});

test('before any v2 data: every API is clean, newest positions and readings still show', sql, async () => {
 const apis = ['/api/stats', '/api/equity', '/api/intraday/stats', '/api/intraday/session', '/api/explore?scope=daily', '/api/explore?scope=intraday',
  '/api/export.csv?scope=daily', '/api/export.csv?scope=intraday', '/api/snapshots?v=2'];
 const rows = v2Rows();
 const old = {...rows, predictions: rows.predictions.slice(0, 2), ibars: rows.ibars.filter(b => b.session < S), ipredictions: rows.ipredictions.slice(1)};
 for (const env of [makeEnv(), makeEnv(), makeEnv(MIGRATIONS.slice(0, 2)), makeEnv(MIGRATIONS.slice(0, 4))].map((e, i) => {
  if (i === 1) e.DB.exec(['bars', 'predictions', 'ibars', 'ipredictions'].map(t => rowsSql(t, old[t])).join('\n'));
  return e;
 })) {
  for (const path of apis) {
   const r = await request(env, path), text = await r.text();
   assert.equal(r.status, 200, path);
   noNaN(text);
   if (text.startsWith('{') && !path.includes('snapshots')) assert.equal(JSON.parse(text).protocol.version, 2, path);
  }
  const stats = await getJson(env, '/api/stats');
  assert.deepEqual([stats.conditions, stats.days_running], [{}, 0]);
  assert.deepEqual((await getJson(env, '/api/explore?scope=intraday')).metrics, {});
  assert.deepEqual((await getJson(env, '/api/intraday/stats')).conditions, {});
 }
 const env = makeEnv(MIGRATIONS.slice(0, 4)); // before migration 0005
 env.DB.exec(Object.entries(rows).map(([t, r]) => rowsSql(t, r)).join('\n'));
 assert.equal(await runSnapshots(env.DB, {created_at: 'x'}), 3);
 assert.equal((await getJson(env, '/api/explore?scope=daily')).rolling_source, 'computed');
});

test('newest session shows v2 positions although its statistics are empty', sql, async () => {
 const rows = v2Rows(), env = makeEnv();
 env.DB.exec([rowsSql('ibars', rows.ibars.filter(b => b.session < S)), rowsSql('ipredictions', rows.ipredictions.slice(1))].join('\n'));
 const s = await getJson(env, '/api/intraday/session');
 assert.equal(s.protocol.counted, false);
 near(s.positions.skill.return, -.0502);
 assert.equal(s.predictions.length, 2);
});

test('re-posting a prediction changes nothing: daily and intraday are both insert-only', sql, async () => {
 const env = makeEnv();
 const d = {symbol: 'SPY', asof: '2026-11-25', condition: 'skill', model: 'm', skill_sha: 's', always_in: 'long', p_up_5: .6, target: null, stop: null, horizon: 5, state: 'x', close: 100, reading: 'r'};
 const i = {symbol: 'SPY', session: S, bar: 3, ts: S + 'T14:40:00Z', condition: 'skill', model: 'm', skill_sha: 's', always_in: 'long', p_up_6: .6, target: null, stop: null, horizon: 6, day_type: 'x', close: 100, reading: 'r'};
 await request(env, '/api/predictions', 'POST', d);
 await request(env, '/api/intraday/predictions', 'POST', i);
 env.DB.exec("UPDATE predictions SET created_at='2026-11-25 21:41:00';UPDATE ipredictions SET created_at='2026-11-27 14:45:44';");
 await request(env, '/api/predictions', 'POST', {...d, always_in: 'short', created_at: '2000-01-01 00:00:00'});
 await request(env, '/api/intraday/predictions', 'POST', {...i, always_in: 'short', created_at: '2000-01-01 00:00:00'});
 const a = (await env.DB.prepare('SELECT * FROM predictions').bind().all()).results, b = (await env.DB.prepare('SELECT * FROM ipredictions').bind().all()).results;
 assert.deepEqual(a.map(p => [p.created_at, p.always_in]), [['2026-11-25 21:41:00', 'long']]);
 assert.deepEqual(b.map(p => [p.created_at, p.always_in]), [['2026-11-27 14:45:44', 'long']]);
});

test('migration 0005 is idempotent and keeps existing rows', sql, () => {
 const db = new SqliteD1(MIGRATIONS), file = readFileSync(new URL('../migrations/0005_protocol_v2.sql', import.meta.url), 'utf8');
 db.exec("INSERT INTO metrics_snapshots_v2(scope,as_of,condition,metrics_json) VALUES('daily','2026-11-25','skill','{}');");
 db.exec(file);
 db.exec(file);
 assert.equal(db.call({sql: 'SELECT COUNT(*) AS n FROM metrics_snapshots_v2', args: []}).results[0].n, 1);
});

// ---------- pages ----------
const script = html => html.match(/<script>([\s\S]*?)<\/script>/)[1];
test('pages: switch, explanation, empty state, v1 warning, target/stop toggle, help and baseline note', () => {
 for (const [name, html] of Object.entries({daily: dashboardPage(), intraday: intradayPage(), explore: explorePage()})) {
  for (const text of ['id="proto"', '新规则 v2', '旧规则 v1', '旧规则：成交价不可执行，仅供参考', '2026-11-25（日线）/ 2026-11-27（日内）', '开始统计，暂无数据', '（执行目标/止损）', '显示执行目标/止损版'])
   assert.ok(html.includes(text), name + ': ' + text);
  new Script(script(html));
 }
 assert.match(intradayPage(), /拿不到[^<]*特征文件[^<]*不等于纯 Brooks/);
 assert.match(dashboardPage(), /次日开盘价/);
});

test('page helpers: version from the URL, links keep other parameters, _ts rows sit under their base and stay hidden', () => {
 const run = search => {
  const ctx = createContext({URL, URLSearchParams, location: {search, href: 'https://x.test/intraday' + search}});
  new Script(script(dashboardPage()).replace(/\n\(async function loadDaily[\s\S]*$/, '')).runInContext(ctx);
  return ctx;
 };
 assert.deepEqual(['', '?v=2', '?v=1', '?v=x'].map(s => run(s).protocolVersion()), [2, 2, 1, 2]);
 const c = run('?symbol=QQQ&v=1');
 assert.equal(c.protocolHref(2), '/intraday?symbol=QQQ');
 assert.equal(run('?symbol=QQQ').protocolHref(1), '/intraday?symbol=QQQ&v=1');
 assert.match(c.protocolBar(1), /旧规则：成交价不可执行/);
 assert.doesNotMatch(c.protocolBar(2), /class="chip warn"/);
 assert.match(c.protocolEmpty('2026-11-25'), /新规则从 2026-11-25 开始统计，暂无数据。<a href="[^"]*v=1">/);
 const g = {key: 'skill', name: 'A', short: 'a'}, ts = c.tsGroup(g), e = {key: 'ema20', name: 'E', short: 'e'};
 assert.equal(ts.name, 'A（执行目标/止损）');
 const rows = [[ts, 1], [e, 2], [g, 3]];
 const keys = show => [...c.tsRows(rows, show)].map(r => r[0].key).join();
 assert.equal(keys(true), 'ema20,skill,skill_ts');
 assert.equal(keys(false), 'ema20,skill');
});
