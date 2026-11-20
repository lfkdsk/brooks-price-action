import {escapeHtml} from './ui-common.js';

export {escapeHtml};

export function buildOverlay(bars, predictions, session, condition) {
 const today = bars.filter(b => b.session === session);
 const available = new Set(today.map(b => b.bar));
 const last = today.at(-1);
 const matching = predictions.filter(p => p.session === session && p.condition === condition)
  .sort((a, b) => a.bar - b.bar);
 const decisions = matching.filter(p => available.has(p.bar));
 const entries = matching.filter(p => available.has(p.bar + 1));
 const segments = [], markers = [];
 let position = 'flat';
 for (const [i, p] of entries.entries()) {
  const start = p.bar + 1;
  const side = ['long', 'short'].includes(p.always_in) ? p.always_in : 'flat';
  segments.push({start, end: (entries[i + 1]?.bar ?? last.bar) + 1, side});
  if (side !== position) {
   if (position !== 'flat') markers.push({bar: start, side: position, type: 'exit', price: 'open'});
   if (side !== 'flat') markers.push({bar: start, side, type: 'entry', price: 'open'});
   position = side;
  }
 }
 if (position !== 'flat' && (last.final || last.bar === 78))
  markers.push({bar: last.bar, side: position, type: 'exit', price: 'close'});
 return {segments, markers, decisions};
}

export function priorLevels(bars, session) {
 const previous = bars.filter(b => b.session < session).at(-1);
 if (!previous) return null;
 return {close: previous.close, low: Math.min(...bars.filter(b => b.session === previous.session).map(b => b.low))};
}

// Pacific clock time for the start of regular-session bar n (09:30 ET = 06:30 PT all year).
export function ptClock(n) {
 const m = 390 + (n - 1) * 5;
 return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
}

// Live-session SVG for /intraday. Rendered in the browser at the container's pixel width
// so text stays legible on phones; wider than the container means horizontal scroll.
export function liveChart(bars, {session, prior, overlay, latest, activeBar = null, viewWidth = 900, height = 420, minStep = 9,
 annotations = [], levels = []}) {
 let ema;
 const series = bars.flatMap(b => {
  ema = ema === undefined ? b.close : ema + 2 / 21 * (b.close - ema);
  return b.session === session ? [{...b, ema}] : [];
 });
 if (!series.length) return '<p class="empty">这个交易日还没有K线数据。</p>';
 const last = series.at(-1);
 const byBar = new Map(series.map(b => [b.bar, b]));
 const left = 6, right = 66, top = 10, bottom = 40;
 const slots = Math.min(80, Math.max(last.bar + 3, 24));
 const width = Math.max(viewWidth, Math.ceil(slots * minStep) + left + right);
 const plotRight = width - right;
 const step = (plotRight - left) / slots;
 const x = n => left + (n - .5) * step;
 const coreLo = Math.min(...series.flatMap(b => [b.low, b.ema]));
 const coreHi = Math.max(...series.flatMap(b => [b.high, b.ema]));
 const core = Math.max(.05, coreHi - coreLo);
 const guides = [];
 if (prior) guides.push({price: prior.close, label: '昨收', cls: 'g-prior', dash: '7 4', from: 1},
  {price: prior.low, label: '昨低', cls: 'g-prior', dash: '2 4', from: 1});
 for (const l of levels || []) {
  // Recap key levels; skip ones that repeat a line already drawn (e.g. prior close).
  if (guides.some(g => Math.abs(g.price - l.price) <= l.price * 2e-4)) continue;
  guides.push({price: l.price, label: l.label, cls: 'g-level', dash: '4 3', from: 1});
 }
 if (latest) {
  if (latest.target != null) guides.push({price: latest.target, label: '目标', cls: 'g-target', dash: '6 3', from: latest.bar});
  if (latest.stop != null) guides.push({price: latest.stop, label: '止损', cls: 'g-stop', dash: '6 3', from: latest.bar});
 }
 const reach = core * .6;
 for (const g of guides) g.inside = g.price >= coreLo - reach && g.price <= coreHi + reach;
 const inside = guides.filter(g => g.inside).map(g => g.price);
 let lo = Math.min(coreLo, ...inside), hi = Math.max(coreHi, ...inside);
 const pad = Math.max(.02, (hi - lo) * (annotations.length ? .15 : .09));
 lo -= pad;
 hi += pad;
 const plotBottom = height - bottom;
 const y = p => top + (hi - p) / (hi - lo) * (plotBottom - top);
 const f2 = v => v.toFixed(2);
 const out = [];
 for (const s of overlay?.segments || []) {
  if (s.side === 'flat') continue;
  out.push(`<rect class="shade-${s.side}" x="${x(s.start) - step / 2}" y="${top}" width="${(s.end - s.start) * step}" height="${plotBottom - top}"/>`);
 }
 const tagY = y(last.close);
 // Key levels carry only their price, in the right-hand axis gutter (names are listed under the chart).
 const gutter = [];
 for (const g of guides.filter(g => g.cls === 'g-level' && g.inside).sort((a, b) => b.price - a.price)) {
  const py = y(g.price) + 4;
  const ok = v => v >= top + 8 && v <= plotBottom && Math.abs(v - tagY - 4) >= 15 && !gutter.some(o => Math.abs(o - v) < 12);
  const gy = [0, 11, -11, 22, -22, 33, -33].map(d => py + d).find(ok);
  if (gy === undefined) continue;
  gutter.push(gy);
  out.push(`<text class="axis glevel" x="${plotRight + 6}" y="${gy}"><title>${escapeHtml(g.label)}</title>${f2(g.price)}</text>`);
 }
 for (let i = 0; i <= 4; i++) {
  const p = lo + (hi - lo) * (i + .5) / 5;
  out.push(`<path class="grid" d="M${left} ${y(p)}H${plotRight}"/>`);
  if (Math.abs(y(p) - tagY) > 14 && !gutter.some(v => Math.abs(v - y(p) - 4) < 15))
   out.push(`<text class="axis" x="${plotRight + 6}" y="${y(p) + 4}">${f2(p)}</text>`);
 }
 for (let n = 1; n <= Math.min(78, slots); n += 6) {
  out.push(`<path class="tick" d="M${x(n)} ${plotBottom}v4"/><text class="axis" text-anchor="middle" x="${x(n)}" y="${plotBottom + 16}">${n}</text>` +
   `<text class="axis sub" text-anchor="middle" x="${x(n)}" y="${plotBottom + 31}">${ptClock(n)}</text>`);
 }
 out.push(`<path class="baseline" d="M${left} ${plotBottom}H${plotRight}"/>`);
 const placed = [];
 const labelAt = (g, py, text) => {
  const side = g.cls === 'g-prior' ? 'left' : 'right';
  // Labels sit just above their line; a crowded label moves below it, then further out.
  const free = v => v >= top + 9 && v <= plotBottom - 2 && !placed.some(p => p.side === side && Math.abs(p.y - v) < 13);
  let ly = [-4, 13, -17, 26, -30, 39, -43, 52, -56, 65].map(d => py + d).find(free) ?? py - 4;
  placed.push({side, y: ly});
  const lx = side === 'left' ? left + 4 : plotRight - 4;
  return `<text class="glabel ${g.cls}" x="${lx}" y="${ly}" text-anchor="${side === 'left' ? 'start' : 'end'}">${escapeHtml(text)}</text>`;
 };
 for (const g of guides) {
  if (g.cls === 'g-level') {
   if (g.inside) out.push(`<path class="guide g-level" stroke-dasharray="${g.dash}" d="M${left} ${y(g.price)}H${plotRight}"><title>${escapeHtml(g.label + ' ' + f2(g.price))}</title></path>`);
   continue;
  }
  if (g.inside) {
   out.push(`<path class="guide ${g.cls}" stroke-dasharray="${g.dash}" d="M${g.cls === 'g-prior' ? left : x(g.from)} ${y(g.price)}H${plotRight}"/>` +
    labelAt(g, y(g.price), g.label + ' ' + f2(g.price)));
  } else {
   const above = g.price > hi;
   out.push(labelAt(g, above ? top + 14 : plotBottom - 2, g.label + ' ' + f2(g.price) + (above ? ' ↑' : ' ↓')));
  }
 }
 const body = Math.max(2, Math.min(12, step * .66));
 for (const b of series) {
  const cx = x(b.bar), t = y(Math.max(b.open, b.close));
  out.push(`<g class="candle ${b.close >= b.open ? 'up' : 'down'}"><path d="M${cx} ${y(b.high)}V${y(b.low)}"/>` +
   `<rect x="${cx - body / 2}" y="${t}" width="${body}" height="${Math.max(1, y(Math.min(b.open, b.close)) - t)}"/>` +
   `<title>第${b.bar}根 ${ptClock(b.bar)} PT · 开 ${f2(b.open)} 高 ${f2(b.high)} 低 ${f2(b.low)} 收 ${f2(b.close)}</title></g>`);
 }
 out.push(`<polyline class="ema" points="${series.map(b => x(b.bar).toFixed(1) + ',' + y(b.ema).toFixed(1)).join(' ')}"/>`);
 const boxes = [];
 for (const a of annotations || []) {
  const b = byBar.get(a.bar);
  if (!b) continue;
  const above = a.pos === 'above', cx = x(a.bar), cy = y(above ? b.high : b.low);
  const text = a.label.length > 24 ? a.label.slice(0, 23) + '…' : a.label;
  const w = [...text].reduce((n, c) => n + (c.charCodeAt(0) > 0x2e80 ? 11 : 6.3), 0);
  const lx = Math.min(plotRight - w / 2, Math.max(left + w / 2, cx));
  // Stack away from the bar until the label box clears earlier labels.
  let ly = above ? cy - 14 : cy + 22;
  for (let k = 0; k < 12 && boxes.some(o => Math.abs(o.x - lx) < (o.w + w) / 2 + 4 && Math.abs(o.y - ly) < 13); k++) ly += above ? -13 : 13;
  ly = Math.min(plotBottom - 3, Math.max(top + 10, ly));
  boxes.push({x: lx, y: ly, w});
  out.push(`<g class="ann"><title>第${a.bar}根 ${ptClock(a.bar)} PT · ${escapeHtml(a.label)}</title><circle cx="${cx}" cy="${above ? cy - 3 : cy + 3}" r="2.2"/>` +
   `<line x1="${cx}" x2="${cx}" y1="${above ? cy - 3 : cy + 3}" y2="${above ? ly + 3 : ly - 11}"/>` +
   `<text text-anchor="middle" x="${lx}" y="${ly}">${escapeHtml(text)}</text></g>`);
 }
 for (const p of overlay?.decisions || []) {
  const b = byBar.get(p.bar);
  if (!b) continue;
  const cx = x(p.bar);
  const side = p.always_in === 'long' ? 'long' : p.always_in === 'short' ? 'short' : 'flat';
  const word = side === 'long' ? '做多' : side === 'short' ? '做空' : '观望';
  const cy = side === 'long' ? y(b.low) + 12 : y(b.high) - 12;
  const shape = side === 'long' ? `<path d="M${cx} ${cy - 6}l6 10h-12Z"/>` :
   side === 'short' ? `<path d="M${cx} ${cy + 6}l6 -10h-12Z"/>` : `<circle cx="${cx}" cy="${cy}" r="4.5"/>`;
  out.push(`<g class="dm dm-${side}${p.bar === activeBar ? ' active' : ''}" data-bar="${p.bar}" tabindex="0" role="button" aria-label="第${p.bar}根K线收盘时的判断：${word}">` +
   `<rect class="hit" x="${cx - 11}" y="${cy - 12}" width="22" height="24"/>${shape}</g>`);
 }
 out.push(`<path class="lastline" d="M${x(last.bar)} ${tagY}H${plotRight}"/>` +
  `<rect class="pricetag" x="${plotRight + 2}" y="${tagY - 10}" width="${right - 4}" height="20" rx="4"/>` +
  `<text class="pricetag-text" x="${plotRight + 6}" y="${tagY + 4}">${f2(last.close)}</text>`);
 return `<svg class="live" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="5分钟K线图，含20均线、昨收与各组判断">${out.join('')}</svg>`;
}
