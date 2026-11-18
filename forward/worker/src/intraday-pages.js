export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c =>
 ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function renderMarkdown(markdown) {
 const inline = text => escapeHtml(text).replace(/`([^`]+)`|\*\*([^*]+)\*\*/g,
  (_, code, bold) => code === undefined ? '<strong>' + bold + '</strong>' : '<code>' + code + '</code>');
 const html = [];
 let block = '', lines = [];
 function flush() {
  if (block === 'p') html.push('<p>' + inline(lines.join(' ')) + '</p>');
  if (block === 'ul' || block === 'ol') {
   html.push('<' + block + '>' + lines.map(line => '<li>' + inline(line) + '</li>').join('') + '</' + block + '>');
  }
  block = '';
  lines = [];
 }
 for (const raw of markdown.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line) { flush(); continue; }
  const heading = line.match(/^(#{1,6})\s+(.+)$/);
  if (heading) {
   flush();
   const n = Math.min(6, heading[1].length + 1);
   html.push('<h' + n + '>' + inline(heading[2]) + '</h' + n + '>');
   continue;
  }
  const list = line.match(/^([-+*]|\d+\.)\s+(.+)$/);
  const type = !list ? 'p' : list[1].endsWith('.') ? 'ol' : 'ul';
  if (type !== block) flush();
  block = type;
  lines.push(list ? list[2] : line);
 }
 flush();
 return html.join('\n');
}

const nav = '<nav aria-label="Dashboards"><a href="/">Daily</a> · <a href="/intraday">Intraday</a> · <a href="/recap">Recaps</a></nav>';
const shell = (title, content) => `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--wick:#303030;--annotation:#a72127}
@media(prefers-color-scheme:dark){:root{--wick:#aaa;--annotation:#ff8589}}
body{font:16px system-ui;max-width:1200px;margin:auto;padding:20px}a{color:#438bdb}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;padding:9px;border-bottom:1px solid #8885;white-space:nowrap}
.scroll{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}
details{padding:10px;border-bottom:1px solid #8885}summary{cursor:pointer}.note{padding:15px;background:#8882}
svg{display:block;width:100%;height:auto}#equity svg{min-width:480px}.candles{min-width:980px}
svg text{fill:currentColor;font:12px system-ui}.grid{stroke:currentColor;opacity:.2}
.candle{stroke:var(--wick)}.annotation,.annotation text{fill:var(--annotation)}.annotation line{stroke:var(--annotation)}
article{max-width:76ch}nav{margin-bottom:1rem}form{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
</style>${nav}<main><h1>${escapeHtml(title)}</h1>${content}</main></html>`;

function candles(bars, recap) {
 let ema;
 const series = bars.flatMap(b => {
  ema = ema === undefined ? b.close : ema + 2 / 21 * (b.close - ema);
  return b.session === recap.session ? [{...b, ema}] : [];
 });
 if (!series.length) return '<p>Session bars are unavailable.</p>';
 const prior = recap.prior;
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
 const annotations = recap.annotations.map(a => {
  const b = byBar.get(a.bar);
  if (!b) return '';
  const cx = x(b.bar), cy = y(a.pos === 'above' ? b.high : b.low);
  const offset = a.pos === 'above' ? -17 : 19;
  const label = a.label.length > 22 ? a.label.slice(0, 21) + '…' : a.label;
  const labelX = Math.min(1080, Math.max(8, cx));
  const anchor = cx < 130 ? 'start' : cx > 900 ? 'end' : 'middle';
  return `<g class="annotation"><title>Bar ${a.bar} · ${escapeHtml(a.label)}</title><line x1="${cx}" x2="${cx}" y1="${cy}" y2="${cy + offset * .6}"/><text text-anchor="${anchor}" x="${labelX}" y="${cy + offset}">${escapeHtml(label)}</text></g>`;
 }).join('');
 return `<div class="scroll"><svg class="candles" viewBox="0 0 1090 455" role="img" aria-label="Five-minute candlesticks with EMA20 and annotated bars">
${grid}${lines}${axis}${bodies}<polyline fill="none" stroke="#438bdb" stroke-width="2" points="${series.map(b => x(b.bar) + ',' + y(b.ema)).join(' ')}"/>${annotations}</svg></div>
<p>Blue · EMA20${prior ? ' · Dashed · prior close ' + prior.close.toFixed(2) + ' / prior low ' + prior.low.toFixed(2) : ''}</p>`;
}

export function recapPage(symbol, history, recap, bars) {
 const content = recap ? `<h2>${escapeHtml(recap.session)} · ${escapeHtml(recap.day_type)}</h2>
${candles(bars, recap)}
<article lang="zh">${renderMarkdown(recap.markdown)}</article>
${recap.levels.length ? '<h2>Key levels</h2><ul>' + recap.levels.map(l => '<li>' + l.price.toFixed(2) + ' · ' + escapeHtml(l.label) + '</li>').join('') + '</ul>' : ''}` :
  '<p>No recaps are available for this symbol yet.</p>';
 return shell(symbol + ' · 日内复盘', `<form action="/recap"><label>Symbol <input name="symbol" value="${escapeHtml(symbol)}" pattern="[A-Za-z0-9^=._\\-]{1,24}" required></label><button>View</button></form>
${content}<h2>Past recaps</h2><ul>${history.map(r => '<li><a href="/recap/' + encodeURIComponent(r.session) +
 '?symbol=' + encodeURIComponent(symbol) + '">' + escapeHtml(r.session) + '</a> · ' + escapeHtml(r.day_type) + '</li>').join('')}</ul>`);
}

export function intradayPage() {
 return shell('Brooks Forward · 5 分钟模拟仓', `<p class="note">Paper trading only. Simulated next-open prices, not executable orders.</p>
<form action="/intraday"><label>Symbol <input id="symbol" name="symbol" value="SPY" maxlength="24" required></label><button>View</button><a id="recap" href="/recap">View recap</a></form>
<p id="status" role="status">Loading…</p><h2>Cumulative equity</h2><div class="scroll" id="equity"></div>
<h2>Metrics by condition</h2><div class="scroll" id="metrics"></div>
<h2 id="timeline-title">Today's decisions</h2><div class="scroll" id="timeline"></div>
<h2>Latest readings</h2><div id="readings"></div>
<details><summary>Paired comparisons</summary><pre id="paired"></pre></details>
<script>${drawEquity.toString()}
(${loadIntraday.toString()})()</script>`);
}

async function loadIntraday() {
 const el = id => document.getElementById(id);
 const fmt = v => v == null ? '—' : typeof v === 'number' ? Number.isInteger(v) ? v : v.toFixed(4) : v;
 const table = (id, headers, rows) => {
  const t = document.createElement('table');
  for (const [i, row] of [headers, ...rows].entries()) {
   const tr = t.insertRow();
   for (const value of row) {
    const cell = document.createElement(i ? 'td' : 'th');
    cell.textContent = fmt(value);
    tr.append(cell);
   }
  }
  el(id).replaceChildren(t);
 };
 const get = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
 };
 const symbol = new URLSearchParams(location.search).get('symbol') || 'SPY';
 el('symbol').value = symbol;
 const query = new URLSearchParams({symbol});
 el('recap').href = '/recap?' + query;
 const parts = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'})
  .formatToParts(new Date());
 const date = Object.fromEntries(parts.map(p => [p.type, p.value]));
 const session = date.year + '-' + date.month + '-' + date.day;
 try {
  const [s, today, recent] = await Promise.all([
   get('/api/intraday/stats?' + query), get('/api/intraday/predictions?' + query + '&session=' + session + '&limit=200'),
   get('/api/intraday/predictions?' + query + '&limit=75')
  ]);
  el('status').textContent = symbol + ' · ' + s.cost_bps + ' bps per unit changed · ' + s.missed + ' missed points';
  const conditions = Object.entries(s.conditions);
  table('metrics', ['Condition', 'Decisions', 'Return', 'Sharpe', 'Max DD', 'Exposure', '+6 hit', 'Coverage', 'Brier',
   'Log loss', 'Target first', 'Pending +6', 'Pending target/stop', 'Pending entry'], conditions.map(([name, m]) =>
   [name, m.decisions, m.account.total_return, m.account.annualized_sharpe, m.account.max_drawdown, m.account.exposure,
    m.direction_hit_rate, m.direction_coverage, m.brier, m.log_loss, m.target_before_stop_rate,
    m.pending_6, m.pending_horizon, m.pending_entries]));
  const names = ['skill', 'baseline', 'ema20_5m', 'opening_bar', 'buy_hold'];
  const byBar = new Map();
  for (const p of today.predictions) {
   if (!byBar.has(p.bar)) byBar.set(p.bar, new Map());
   byBar.get(p.bar).set(p.condition, p.always_in);
  }
  el('timeline-title').textContent = "Today's decisions · " + session + ' ET';
  if (!byBar.size) el('timeline').textContent = 'No decisions recorded today.';
  else table('timeline', ['Bar', ...names], [...byBar].sort(([a], [b]) => a - b)
   .map(([bar, row]) => [bar, ...names.map(n => row.has('missed') ? 'Missed' : row.get(n))]));
  for (const p of recent.predictions.filter(p => p.reading && p.condition !== 'missed')) {
   const details = document.createElement('details');
   const summary = document.createElement('summary'), pre = document.createElement('pre');
   summary.textContent = p.session + ' · Bar ' + p.bar + ' · ' + p.condition + ' · ' + p.always_in + ' · ' + p.model;
   pre.textContent = p.reading;
   details.append(summary, pre);
   el('readings').append(details);
  }
  if (!el('readings').children.length) el('readings').textContent = 'No readings available.';
  el('paired').textContent = JSON.stringify(s.paired, null, 2);
  drawEquity(el('equity'), conditions);
 } catch (e) {
  el('status').textContent = 'Unable to load data: ' + e.message;
 }
}

function drawEquity(parent, conditions) {
 const days = [...new Set(conditions.flatMap(([, m]) => m.account.equity_curve.map(d => d.date)))].sort();
 if (!days.length) { parent.textContent = 'No equity data yet.'; return; }
 const values = conditions.flatMap(([, m]) => m.account.equity_curve.map(d => d.equity));
 const min = Math.min(1, ...values), max = Math.max(1, ...values), span = Math.max(.0001, max - min);
 const dateIndex = new Map(days.map((d, i) => [d, i + 1]));
 const x = i => 65 + i / days.length * 725, y = v => 207 - (v - min) / span * 175;
 const colors = ['#438bdb', '#e28830', '#32a778', '#b265c9', '#df5463'];
 const svg = (tag, attrs, label) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (label !== undefined) el.textContent = label;
  return el;
 };
 const chart = svg('svg', {viewBox: '0 0 820 265', role: 'img', 'aria-label': 'Cumulative equity by condition'});
 for (let i = 0; i <= 4; i++) {
  const v = min + span * i / 4;
  chart.append(svg('line', {x1: 65, x2: 790, y1: y(v), y2: y(v), class: 'grid'}),
   svg('text', {x: 2, y: y(v) + 4}, v.toFixed(4)));
 }
 chart.append(svg('text', {x: 65, y: 228}, days[0]));
 if (days.length > 1) chart.append(svg('text', {x: 790, y: 228, 'text-anchor': 'end'}, days.at(-1)));
 conditions.forEach(([name, m], i) => {
  const curve = m.account.equity_curve;
  if (!curve.length) return;
  const color = colors[i % colors.length];
  const points = [[x(dateIndex.get(curve[0].date) - 1), y(1)], ...curve.map(d => [x(dateIndex.get(d.date)), y(d.equity)])];
  chart.append(svg('polyline', {points: points.map(p => p.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': 2}),
   svg('line', {x1: 65 + i * 142, x2: 81 + i * 142, y1: 247, y2: 247, stroke: color, 'stroke-width': 3}),
   svg('text', {x: 87 + i * 142, y: 251}, name));
 });
 parent.append(chart);
}
