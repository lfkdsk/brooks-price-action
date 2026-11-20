export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c =>
 ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

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

// The shared SVG renderer runs in the Worker for recaps and in the browser for live sessions.
export function candles(bars, {session, prior, annotations = [], overlay}) {
 let ema;
 const series = bars.flatMap(b => {
  ema = ema === undefined ? b.close : ema + 2 / 21 * (b.close - ema);
  return b.session === session ? [{...b, ema}] : [];
 });
 if (!series.length) return '<p>Session bars are unavailable.</p>';
 const guides = prior ? [[prior.close, 'Prior close'], [prior.low, 'Prior low']] : [];
 const lo = Math.min(...series.flatMap(b => [b.low, b.ema]), ...guides.map(([v]) => v));
 const hi = Math.max(...series.flatMap(b => [b.high, b.ema]), ...guides.map(([v]) => v));
 const spread = Math.max(.01, hi - lo);
 const y = price => 406 - 348 * (price - lo) / spread;
 const count = series.at(-1).bar;
 const step = 970 / count;
 const x = bar => 25 + (bar - .5) * step;
 const width = Math.min(13, step * .72);
 const byBar = new Map(series.map(b => [b.bar, b]));
 const grid = Array.from({length: 6}, (_, i) => {
  const price = lo + (hi - lo) * i / 5;
  return `<path class="grid" d="M25 ${y(price)}H995"/><text x="1002" y="${y(price) + 4}">${price.toFixed(2)}</text>`;
 }).join('');
 const axis = series.filter(b => b.bar === 1 || b.bar % 5 === 0)
  .map(b => `<text x="${x(b.bar)}" y="438" text-anchor="middle">${b.bar}</text>`).join('');
 const bodies = series.map(b => {
  const cx = x(b.bar), top = y(Math.max(b.open, b.close));
  return `<g class="candle"><path d="M${cx} ${y(b.high)}V${y(b.low)}"/>
<rect x="${cx - width / 2}" y="${top}" width="${width}" height="${Math.max(1, y(Math.min(b.open, b.close)) - top)}" fill="${b.close >= b.open ? 'white' : 'black'}"><title>Bar ${b.bar} · O ${b.open} H ${b.high} L ${b.low} C ${b.close}</title></rect></g>`;
 }).join('');
 const lines = guides.map(([price, name], i) => `<path d="M25 ${y(price)}H995" stroke="#828282" stroke-dasharray="${i ? '3 4' : '8 4'}"><title>${name} ${price.toFixed(2)}</title></path>`).join('');
 const labels = annotations.map(a => {
  const b = byBar.get(a.bar);
  if (!b) return '';
  const cx = x(b.bar), cy = y(a.pos === 'above' ? b.high : b.low);
  const offset = a.pos === 'above' ? -17 : 19;
  const label = a.label.length > 22 ? a.label.slice(0, 21) + '…' : a.label;
  const labelX = Math.min(1080, Math.max(8, cx));
  const anchor = cx < 130 ? 'start' : cx > 900 ? 'end' : 'middle';
  return `<g class="annotation"><title>Bar ${a.bar} · ${escapeHtml(a.label)}</title><line x1="${cx}" x2="${cx}" y1="${cy}" y2="${cy + offset * .6}"/><text text-anchor="${anchor}" x="${labelX}" y="${cy + offset}">${escapeHtml(label)}</text></g>`;
 }).join('');
 const shading = (overlay?.segments || []).filter(s => s.side !== 'flat').map(s =>
  `<rect x="${x(s.start) - step / 2}" y="42" width="${(s.end - s.start) * step}" height="380"
  fill="${s.side === 'long' ? '#279d65' : '#d84957'}" opacity=".2"/>`).join('');
 const markers = (overlay?.markers || []).map(m => {
  const cx = x(m.bar), cy = y(byBar.get(m.bar)[m.price]);
  return m.type === 'exit'
   ? `<rect x="${cx - 3}" y="${cy - 17}" width="6" height="6" fill="#d17929"><title>Exit ${m.side} · bar ${m.bar}</title></rect>`
   : `<path d="M${cx} ${cy + 4}l-5 8h10Z" fill="${m.side === 'long' ? '#279d65' : '#d84957'}"><title>Enter ${m.side} · bar ${m.bar}</title></path>`;
 }).join('') + (overlay?.decisions || []).map(p => {
  const cx = x(p.bar);
  return `<circle class="decision" cx="${cx}" cy="24" r="5" tabindex="0" role="button" data-bar="${p.bar}"
  aria-label="Decision at bar ${p.bar}"><title>Decision at bar ${p.bar}</title></circle>`;
 }).join('');
 return `<div class="scroll"><svg class="candles" viewBox="0 0 1090 455" role="${overlay ? 'group' : 'img'}" aria-label="Five-minute candlesticks with EMA20">
${shading}${grid}${lines}${axis}${bodies}<polyline fill="none" stroke="#438bdb" stroke-width="2" points="${series.map(b => x(b.bar) + ',' + y(b.ema)).join(' ')}"/>${labels}${markers}</svg></div>
<p>Blue · EMA20${prior ? ' · Dashed · prior close ' + prior.close.toFixed(2) + ' / prior low ' + prior.low.toFixed(2) : ''}</p>`;
}


// Pacific clock time for the start of regular-session bar n (09:30 ET = 06:30 PT all year).
export function ptClock(n) {
 const m = 390 + (n - 1) * 5;
 return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
}

// Live-session SVG for /intraday. Rendered in the browser at the container's pixel width
// so text stays legible on phones; wider than the container means horizontal scroll.
export function liveChart(bars, {session, prior, overlay, latest, activeBar = null, viewWidth = 900, height = 420, minStep = 9}) {
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
 if (latest) {
  if (latest.target != null) guides.push({price: latest.target, label: '目标', cls: 'g-target', dash: '6 3', from: latest.bar});
  if (latest.stop != null) guides.push({price: latest.stop, label: '止损', cls: 'g-stop', dash: '6 3', from: latest.bar});
 }
 const reach = core * .6;
 for (const g of guides) g.inside = g.price >= coreLo - reach && g.price <= coreHi + reach;
 const inside = guides.filter(g => g.inside).map(g => g.price);
 let lo = Math.min(coreLo, ...inside), hi = Math.max(coreHi, ...inside);
 const pad = Math.max(.02, (hi - lo) * .09);
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
 for (let i = 0; i <= 4; i++) {
  const p = lo + (hi - lo) * (i + .5) / 5;
  out.push(`<path class="grid" d="M${left} ${y(p)}H${plotRight}"/>`);
  if (Math.abs(y(p) - tagY) > 14) out.push(`<text class="axis" x="${plotRight + 6}" y="${y(p) + 4}">${f2(p)}</text>`);
 }
 for (let n = 1; n <= Math.min(78, slots); n += 6) {
  out.push(`<path class="tick" d="M${x(n)} ${plotBottom}v4"/><text class="axis" text-anchor="middle" x="${x(n)}" y="${plotBottom + 16}">${n}</text>` +
   `<text class="axis sub" text-anchor="middle" x="${x(n)}" y="${plotBottom + 31}">${ptClock(n)}</text>`);
 }
 out.push(`<path class="baseline" d="M${left} ${plotBottom}H${plotRight}"/>`);
 const placed = [];
 const labelAt = (g, py, text) => {
  const side = g.cls === 'g-prior' ? 'left' : 'right';
  // Labels sit just above their line; a crowded label flips below it.
  let ly = py - 4;
  if (placed.some(p => p.side === side && Math.abs(p.y - ly) < 13)) ly = py + 13;
  placed.push({side, y: ly});
  const lx = side === 'left' ? left + 4 : plotRight - 4;
  return `<text class="glabel ${g.cls}" x="${lx}" y="${ly}" text-anchor="${side === 'left' ? 'start' : 'end'}">${text}</text>`;
 };
 for (const g of guides) {
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
