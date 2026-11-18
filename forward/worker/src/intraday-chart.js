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

