import {buildOverlay, candles, escapeHtml, priorLevels} from './intraday-chart.js';

export {escapeHtml};

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
#live-chart .candles{min-width:520px}.decision{fill:#438bdb;cursor:pointer;stroke:currentColor;stroke-width:1}
.decision:focus,.decision:hover{stroke-width:3}
#condition-toggles{display:flex;flex-wrap:wrap;gap:.4rem;margin:.8rem 0}
#condition-toggles button{padding:.3rem .6rem;cursor:pointer}
#condition-toggles button[aria-pressed=true]{outline:2px solid #438bdb}
#positions table{width:auto}#positions td,#positions th{padding:5px 9px}
article{max-width:76ch}nav{margin-bottom:1rem}form{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
</style>${nav}<main><h1>${escapeHtml(title)}</h1>${content}</main></html>`;

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
<p id="status" role="status">Loading…</p>
<h2>Five-minute chart</h2>
<label>Session <select id="session"><option value="">Latest session</option></select></label>
<div id="condition-toggles" role="group" aria-label="Chart condition"></div>
<div id="live-chart"></div><pre id="decision-detail" aria-live="polite" hidden></pre>
<h2>Session positions</h2><div class="scroll" id="positions"></div>
<h2>Cumulative equity</h2><div class="scroll" id="equity"></div>
<h2>Metrics by condition</h2><div class="scroll" id="metrics"></div>
<h2 id="timeline-title">Session decisions</h2><div class="scroll" id="timeline"></div>
<h2>Latest readings</h2><div id="readings"></div>
<details><summary>Paired comparisons</summary><pre id="paired"></pre></details>
<script>const escapeHtml = ${escapeHtml.toString()};
${[buildOverlay, priorLevels, candles, drawEquity].map(fn => fn.toString()).join('\n')}
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
 const select = el('session');
 let condition = 'skill', selected = null, activeDecision = null, version = 0;
 const ny = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
 });
 const local = now => Object.fromEntries(ny.formatToParts(now).map(p => [p.type, p.value]));
 const renderChart = (resetScroll = false) => {
  const {bars, predictions, session} = selected;
  const overlay = buildOverlay(bars, predictions, session, condition);
  const chart = el('live-chart');
  const scroll = resetScroll ? 0 : chart.querySelector('.scroll')?.scrollLeft || 0;
  chart.innerHTML = candles(bars, {session, prior: priorLevels(bars, session), overlay});
  if (scroll && chart.querySelector('.scroll')) chart.querySelector('.scroll').scrollLeft = scroll;
  const showDecision = bar => {
   activeDecision = bar;
   const p = overlay.decisions.find(row => row.bar === bar);
   const detail = el('decision-detail');
   detail.hidden = !p;
   detail.textContent = p ? [
    condition + ' · Bar ' + p.bar + ' · ' + p.always_in,
    'p_up_6 ' + fmt(p.p_up_6) + ' · Target ' + fmt(p.target) + ' · Stop ' + fmt(p.stop),
    p.reading
   ].filter(Boolean).join('\n') : '';
  };
  for (const marker of chart.querySelectorAll('.decision')) {
   const show = () => showDecision(Number(marker.dataset.bar));
   marker.addEventListener('click', show);
   marker.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); }
   });
  }
  showDecision(activeDecision);
 };
 const loadSession = async () => {
  const request = ++version;
  const params = new URLSearchParams(query);
  if (select.value) params.set('session', select.value);
  try {
   const data = await get('/api/intraday/session?' + params);
   if (request !== version) return;
   const switched = data.session !== selected?.session;
   if (switched) activeDecision = null;
   selected = data;
   const value = select.value;
   select.replaceChildren(new Option(data.sessions.length ? 'Latest (' + data.sessions[0] + ')' : 'Latest session', ''),
    ...data.sessions.map(day => new Option(day, day)));
   select.value = value;
   const names = Object.keys(data.positions);
   el('condition-toggles').replaceChildren(...names.map(name => {
    const button = document.createElement('button');
    button.textContent = name;
    button.setAttribute('aria-pressed', name === condition);
    button.onclick = () => {
     condition = name;
     activeDecision = null;
     for (const toggle of button.parentElement.children)
      toggle.setAttribute('aria-pressed', toggle === button);
     renderChart();
    };
    return button;
   }));
   renderChart(switched);
   table('positions', ['Condition', 'Position', 'P&L (net)'], names.map(name => {
    const row = data.positions[name];
    return [name, row.position, row.return == null ? null : (100 * row.return).toFixed(3) + '%'];
   }));
   const byBar = new Map();
   for (const p of data.predictions) {
    if (!byBar.has(p.bar)) byBar.set(p.bar, new Map());
    byBar.get(p.bar).set(p.condition, p.always_in);
   }
   el('timeline-title').textContent = data.session ? 'Session decisions · ' + data.session + ' ET' : 'Session decisions';
   if (!byBar.size) el('timeline').textContent = 'No decisions recorded for this session.';
   else table('timeline', ['Bar', ...names], [...byBar].sort(([a], [b]) => a - b)
    .map(([bar, row]) => [bar, ...names.map(n => row.has('missed') ? 'Missed' : row.get(n))]));
   el('recap').href = (data.session && value ? '/recap/' + data.session : '/recap') + '?' + query;
  } catch (e) {
   if (request !== version) return;
   if (!selected || params.has('session')) {
    el('live-chart').textContent = 'Unable to load session data (' + e.message + ').';
    el('decision-detail').hidden = true;
   }
  }
 };
 const loadStats = async () => {
  try {
   const [s, recent] = await Promise.all([
    get('/api/intraday/stats?' + query), get('/api/intraday/predictions?' + query + '&limit=75')
   ]);
   el('status').textContent = symbol + ' · ' + s.cost_bps + ' bps per unit changed · ' + s.missed + ' missed points';
   const conditions = Object.entries(s.conditions);
   table('metrics', ['Condition', 'Decisions', 'Return', 'Sharpe', 'Max DD', 'Exposure', '+6 hit', 'Coverage', 'Brier',
    'Log loss', 'Target first', 'Pending +6', 'Pending target/stop', 'Pending entry'], conditions.map(([name, m]) =>
    [name, m.decisions, m.account.total_return, m.account.annualized_sharpe, m.account.max_drawdown, m.account.exposure,
     m.direction_hit_rate, m.direction_coverage, m.brier, m.log_loss, m.target_before_stop_rate,
     m.pending_6, m.pending_horizon, m.pending_entries]));
   el('readings').replaceChildren();
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
   el('status').textContent = 'Unable to load metrics (' + e.message + ').';
  }
 };
 select.addEventListener('change', loadSession);
 const refresh = () => Promise.all([loadSession(), loadStats()]);
 const minutes = d => Number(d.hour) * 60 + Number(d.minute);
 const sessionOpen = d => {
  const today = d.year + '-' + d.month + '-' + d.day;
  return !['Sat', 'Sun'].includes(d.weekday) && minutes(d) >= 570 && minutes(d) < 960 &&
   !(selected?.sessions[0] === today && selected.latest_final);
 };
 const schedule = () => {
  const now = new Date(), d = local(now);
  if (sessionOpen(d)) {
   setTimeout(async () => {
    if (sessionOpen(local(new Date()))) await refresh();
    schedule();
   }, 60000);
   return;
  }
  // Schedule one wakeup for the next weekday open, with no polling overnight.
  let day = Date.UTC(Number(d.year), Number(d.month) - 1, Number(d.day), 14, 30);
  if (minutes(d) >= 570) day += 86400000;
  while ([0, 6].includes(new Date(day).getUTCDay())) day += 86400000;
  const open = day - (Number(local(day).hour) - 9) * 3600000;
  setTimeout(async () => { await refresh(); schedule(); }, Math.max(60000, open - now));
 };
 await refresh();
 schedule();
}

function drawEquity(parent, conditions) {
 const days = [...new Set(conditions.flatMap(([, m]) => m.account.equity_curve.map(d => d.date)))].sort();
 if (!days.length) { parent.textContent = 'No equity data yet.'; return; }
 const values = conditions.flatMap(([, m]) => m.account.equity_curve.map(d => d.equity));
 const min = Math.min(1, ...values), max = Math.max(1, ...values), span = Math.max(.0001, max - min);
 const dateIndex = new Map(days.map((d, i) => [d, i + 1]));
 const x = i => 65 + i / days.length * 725, y = v => 207 - (v - min) / span * 175;
 const colors = ['#438bdb', '#e28830', '#32a778', '#b265c9', '#df5463', '#13858c'];
 const svg = (tag, attrs, label) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (label !== undefined) el.textContent = label;
  return el;
 };
 const chart = svg('svg', {viewBox: '0 0 820 287', role: 'img', 'aria-label': 'Cumulative equity by condition'});
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
  const legendX = 65 + i % 5 * 142, legendY = 247 + Math.floor(i / 5) * 20;
  chart.append(svg('polyline', {points: points.map(p => p.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': 2}),
   svg('line', {x1: legendX, x2: legendX + 16, y1: legendY, y2: legendY, stroke: color, 'stroke-width': 3}),
   svg('text', {x: legendX + 22, y: legendY + 4}, name));
 });
 parent.replaceChildren(chart);
}
