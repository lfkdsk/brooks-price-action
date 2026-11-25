// Scoring protocols. v1 = the original rules (kept for reproducibility), v2 = fills at prices that were still
// available when the decision existed. Stored predictions are the same rows under both.
export const PROTOCOL_FROM = {daily: '2026-11-25', intraday: '2026-11-27'};
export const TS_SUFFIX = '_ts';
export const TS_CONDITIONS = {daily: ['skill', 'baseline'], intraday: ['skill', 'skill_chart', 'baseline']};
const NOTES = {
 daily: 'Decision as of close t fills at open t+1 and is held to open t+2; forecasts mature after exactly 5 bars.',
 intraday: 'Decision fills at the open of the first 1-minute bar starting at or after created_at (5-minute fallback).'
};

// {version, from, note[, all]} from the v / all query parameters; null when v is not 1 or 2.
export function protocolFor(scope, params) {
 const v = params.get('v');
 if (v === '1') return {version: 1, from: null, note: 'Original optimistic fills: close t (daily), next 5-minute open (intraday).'};
 if (v !== null && v !== '' && v !== '2') return null;
 const all = params.get('all') === '1';
 return {version: 2, from: all ? null : PROTOCOL_FROM[scope], note: NOTES[scope], ...(all ? {all: true} : {})};
}

// v1 bodies stay byte-identical, so the protocol travels in a header on every versioned response.
export function tagProtocol(response, protocol) {
 response.headers.set('x-scoring-protocol', JSON.stringify(protocol));
 return response;
}

// D1 CURRENT_TIMESTAMP ('YYYY-MM-DD HH:MM:SS') is UTC; ISO strings are accepted too. NaN when unusable.
export function utcMillis(value) {
 if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(value)) return NaN;
 const iso = value.trim().replace(' ', 'T');
 return Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso : iso + 'Z');
}

const numeric = v => typeof v === 'number' && Number.isFinite(v);

// Levels usable by a trade in direction d filled at `fill`. Null or wrong-side levels are ignored (and counted).
export function tradeLevels(p, d, fill) {
 const out = {target: null, stop: null, ignored: 0, missing: 0, wrong_side: 0};
 for (const [k, sign] of [['target', 1], ['stop', -1]]) {
  if (!numeric(p[k])) { out.ignored++; out.missing++; }
  else if (sign * d * (p[k] - fill) > 0) out[k] = p[k];
  else { out.ignored++; out.wrong_side++; }
 }
 return out;
}

// Exit inside one bar: a gap through a level fills at the bar's open; both levels in one bar count as the stop.
export function barExit(bar, d, {target, stop}) {
 if (stop !== null && d * (bar.open - stop) <= 0) return {reason: 'stop', price: bar.open};
 if (target !== null && d * (bar.open - target) >= 0) return {reason: 'target', price: bar.open};
 if (stop !== null && (d > 0 ? bar.low <= stop : bar.high >= stop)) return {reason: 'stop', price: stop};
 if (target !== null && (d > 0 ? bar.high >= target : bar.low <= target)) return {reason: 'target', price: target};
 return null;
}
export const emptyTsCounts = () => ({levels_ignored: 0, levels_missing: 0, levels_wrong_side: 0, target_exits: 0, stop_exits: 0});
export function countLevels(counts, levels, exit) {
 counts.levels_ignored += levels.ignored;
 counts.levels_missing += levels.missing;
 counts.levels_wrong_side += levels.wrong_side;
 if (exit) counts[exit.reason + '_exits']++;
}
