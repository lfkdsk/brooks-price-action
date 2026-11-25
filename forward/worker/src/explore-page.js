import {emitFunction, pageShell, scriptPrelude} from './ui-common.js';

// /explore: filterable history for both paper accounts. Data comes from /api/explore; every
// browser helper is serialized through emitFunction so bundler renames cannot drop a name.

const GROUPS = {
 daily: [
  ['skill', 'Claude + Brooks', 'Claude +Brooks'], ['baseline', 'Claude（不用 Brooks）', 'Claude 无Brooks'],
  ['ema20', '均线规则（EMA20）', 'EMA20'], ['momentum20', '20日动量规则', '动量'], ['buy_hold', '一直持有（参照）', '持有']],
 intraday: [
  ['skill_chart', 'Claude + Brooks（看图）', '看图'], ['skill', 'Claude + Brooks（读数据）', '读数据'],
  ['baseline', 'Claude（不用 Brooks）', '无Brooks'], ['ema20_5m', '均线规则（EMA20）', '均线'],
  ['opening_bar', '开盘方向规则', '开盘'], ['buy_hold', '一直持有（参照）', '持有']]
};
const CONTROLS = {daily: 2, intraday: 3};
const SYMBOL_HINTS = {SPY: '标普500', QQQ: '纳指100', IWM: '小盘股', DIA: '道指', TLT: '长期美债', GLD: '黄金'};

const exploreCss = `
.fgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:4px}
.fgrid label{display:flex;flex-direction:column;gap:3px;font-size:12.5px;color:var(--muted);min-width:0}
.fgrid input,.fgrid select{width:100%;min-width:0;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;font-size:14px}
.flabel{font-size:12.5px;color:var(--muted);margin:10px 0 0}
.quick{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.quick button,.btn{border:1px solid var(--line);background:var(--bg);border-radius:8px;padding:4px 10px;font-size:13px;cursor:pointer;color:var(--ink);text-decoration:none;display:inline-block}
.frow{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
.btn.primary{border-color:var(--accent);color:var(--accent);font-weight:600}
.chips button .sw{margin-right:5px}
.chips button[aria-pressed=false]{opacity:.55}
svg.lc .zero,svg.cal .diag{stroke:var(--faint);stroke-dasharray:4 4}svg.lc .ln,svg.cal .ln{fill:none;stroke-linejoin:round;stroke-linecap:round}
svg.cal .frame{fill:none;stroke:var(--line)}
.lc-wrap{margin-top:4px}
.costs td,.costs th{white-space:nowrap}
.src{font-size:12px;color:var(--faint);margin:6px 0 0}
@media(max-width:520px){.fgrid{grid-template-columns:1fr 1fr}.fgrid label.sym{grid-column:1/-1}}
`;

// Lines over dates for one measure (one y-axis). series: [{key,name,color,points:[{date,value,n}]}].
function drawLines(parent, series, opts) {
 const o = opts || {};
 const days = [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort();
 const values = series.flatMap(s => s.points.map(p => p.value)).filter(v => typeof v === 'number' && Number.isFinite(v));
 if (!days.length || !values.length) { parent.innerHTML = '<p class="empty">' + (o.empty || '还没有数据。') + '</p>'; return; }
 const width = Math.max(300, parent.clientWidth || 600), height = width < 600 ? 190 : 230;
 const left = 50, right = 14, top = 10, bottom = 26;
 const center = typeof o.center === 'number' ? o.center : 0;
 let lo = Math.min(center, ...values), hi = Math.max(center, ...values);
 if (o.fixed) { lo = Math.min(lo, o.fixed[0]); hi = Math.max(hi, o.fixed[1]); }
 const pad = Math.max(.0005, (hi - lo) * .08);
 lo -= pad; hi += pad;
 const x = i => left + (days.length === 1 ? (width - left - right) / 2 : i / (days.length - 1) * (width - left - right));
 const y = v => top + (hi - v) / (hi - lo) * (height - top - bottom);
 const fmt = o.format || (v => +(v * 100).toFixed(1) + '%');
 const out = [];
 // Round tick values (1, 2, 2.5 or 5 × 10^k) so the axis reads 40% / 50% / 60%, not 45.8%.
 const raw = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
 const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= raw) || raw;
 for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) {
  if (Math.abs(v) < step / 1e6) v = 0;
  out.push('<path class="grid" d="M' + left + ' ' + y(v).toFixed(1) + 'H' + (width - right) + '"/><text x="' + (left - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + fmt(v) + '</text>');
 }
 out.push('<path class="zero" d="M' + left + ' ' + y(center).toFixed(1) + 'H' + (width - right) + '"/>');
 const every = Math.max(1, Math.ceil(days.length * 50 / (width - left - right)));
 days.forEach((d, i) => { if (i % every === 0 || i === days.length - 1) out.push('<text x="' + x(i).toFixed(1) + '" y="' + (height - 8) + '" text-anchor="middle">' + d.slice(5) + '</text>'); });
 const index = new Map(days.map((d, i) => [d, i]));
 for (const s of series) {
  const pts = s.points.filter(p => typeof p.value === 'number' && Number.isFinite(p.value));
  if (!pts.length) continue;
  const on = !o.selected || s.key === o.selected;
  out.push('<polyline class="ln" points="' + pts.map(p => x(index.get(p.date)).toFixed(1) + ',' + y(p.value).toFixed(1)).join(' ') + '" stroke="' + s.color +
   '" stroke-width="' + (on ? 2.5 : 1.5) + '" opacity="' + (on ? 1 : .4) + '"' + (s.dash ? ' stroke-dasharray="5 4"' : '') + '/>');
  for (const p of pts) out.push('<circle cx="' + x(index.get(p.date)).toFixed(1) + '" cy="' + y(p.value).toFixed(1) + '" r="' + (on ? 3.5 : 2.5) + '" fill="' + s.color +
   '" stroke="var(--card)" stroke-width="1.5" opacity="' + (on ? 1 : .5) + '"><title>' + escapeHtml(s.name) + ' ' + p.date + '：' + fmt(p.value) + (p.n != null ? '（样本 ' + p.n + '）' : '') + '</title></circle>');
 }
 parent.innerHTML = '<svg class="lc" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escapeHtml(o.label || '') + '">' + out.join('') + '</svg>';
}

// Reliability diagram: mean predicted probability vs observed up rate per bucket, with the diagonal.
function drawCalibration(parent, series) {
 const live = series.map(s => ({...s, buckets: (s.buckets || []).filter(b => b.n && typeof b.mean_probability === 'number')})).filter(s => s.buckets.length);
 if (!live.length) { parent.innerHTML = '<p class="empty">还没有已出结果的概率判断。</p>'; return; }
 const size = Math.max(260, Math.min(420, parent.clientWidth || 360)), left = 44, right = 12, top = 10, bottom = 34;
 const w = size - left - right, h = size - top - bottom;
 const x = v => left + v * w, y = v => top + (1 - v) * h;
 const max = Math.max(...live.flatMap(s => s.buckets.map(b => b.n)));
 const out = ['<rect class="frame" x="' + left + '" y="' + top + '" width="' + w + '" height="' + h + '"/>'];
 for (const v of [0, .25, .5, .75, 1]) {
  out.push('<path class="grid" d="M' + x(v) + ' ' + top + 'V' + (top + h) + 'M' + left + ' ' + y(v) + 'H' + (left + w) + '"/>' +
   '<text x="' + x(v) + '" y="' + (top + h + 14) + '" text-anchor="middle">' + v * 100 + '%</text><text x="' + (left - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v * 100 + '%</text>');
 }
 out.push('<path class="diag" d="M' + x(0) + ' ' + y(0) + 'L' + x(1) + ' ' + y(1) + '"/>');
 out.push('<text x="' + (left + w / 2) + '" y="' + (size - 4) + '" text-anchor="middle">预测上涨概率</text>');
 for (const s of live) {
  if (s.buckets.length > 1) out.push('<polyline class="ln" points="' + s.buckets.map(b => x(b.mean_probability).toFixed(1) + ',' + y(b.observed_up).toFixed(1)).join(' ') + '" stroke="' + s.color + '" stroke-width="2" opacity=".85"/>');
  for (const b of s.buckets) out.push('<circle cx="' + x(b.mean_probability).toFixed(1) + '" cy="' + y(b.observed_up).toFixed(1) + '" r="' + (4 + 6 * Math.sqrt(b.n / max)).toFixed(1) +
   '" fill="' + s.color + '" fill-opacity=".75" stroke="var(--card)" stroke-width="2"><title>' + escapeHtml(s.name) + '：预测 ' + Math.round(b.mean_probability * 100) + '%，实际上涨 ' +
   Math.round(b.observed_up * 100) + '%（' + b.n + ' 个）</title></circle>');
 }
 parent.innerHTML = '<svg class="cal" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="概率校准：横轴预测上涨概率，纵轴实际上涨比例">' + out.join('') + '</svg>';
}

export const exploreHelpers = {drawLines, drawCalibration};

export function explorePage(helpers = exploreHelpers) {
 const config = {GROUPS, CONTROLS, SYMBOL_HINTS};
 return pageShell({title: '数据分析 · Brooks Forward', current: 'explore', css: exploreCss, body: `<div id="proto" class="proto" aria-label="统计规则切换"></div>
<section class="card" aria-labelledby="ex-title">
 <h1 id="ex-title">数据分析 · 按时间段、标的和组别回看</h1>
 <div id="scope" class="seg" role="group" aria-label="范围" style="margin-top:10px"><button data-scope="daily" aria-pressed="true">日线</button><button data-scope="intraday" aria-pressed="false">日内（5分钟）</button></div>
 <div class="fgrid">
  <label>日期从<input type="date" id="from"></label>
  <label>到<input type="date" id="to"></label>
  <label class="sym">标的<select id="symbol"><option value="">全部</option></select></label>
 </div>
 <div class="quick" role="group" aria-label="快捷时间段"><button data-days="20">近 20 个交易日</button><button data-days="60">近 60 个</button><button data-days="0">全部</button></div>
 <p class="flabel">组别（点击选择/取消）</p>
 <div id="groups" class="chips" role="group" aria-label="组别"></div>
 <div class="frow"><span id="summary" class="meta" style="margin:0">正在读取数据…</span><a id="csv" class="btn primary" href="/api/export.csv" download>下载 CSV</a></div>
</section>
<section class="card" aria-labelledby="board-title"><div class="bhead"><h2 id="board-title">谁更准</h2><button id="ts-toggle" class="ts-btn" aria-pressed="false" hidden>显示执行目标/止损版</button></div>
 <div id="board" class="table-scroll"></div>
 <details class="adv-wrap"><summary>高级指标</summary><div id="adv"></div></details>
</section>
<section class="card" aria-labelledby="equity-title"><h2 id="equity-title">累计收益</h2>
 <div id="equity"></div><div id="equity-legend" class="chips" role="group" aria-label="高亮某一组"></div>
 <p class="hint">所选时间段内的组合收益（已扣交易成本），从 0% 起算；点标签高亮某一组。</p></section>
<section class="card" aria-labelledby="roll-title"><h2 id="roll-title">滚动 20 日表现</h2>
 <h3>方向准确率</h3><div id="roll-hit" class="lc-wrap"></div>
 <h3>20 日收益</h3><div id="roll-ret" class="lc-wrap"></div>
 <div id="roll-legend" class="chips" role="group" aria-label="高亮某一组"></div>
 <p class="hint">每个点：截至当天、最近 20 个交易日（日内为 20 个交易日）的方向准确率和收益，只用当天已知的数据。灰色虚线是 50% 准确率 / 0% 收益。</p>
 <p id="roll-src" class="src"></p></section>
<section class="card" aria-labelledby="cal-title"><h2 id="cal-title">概率校准</h2>
 <div id="calib"></div><div id="cal-legend" class="chips"></div>
 <p class="hint">横轴是 Claude 给的「上涨概率」（按 10% 分组取平均），纵轴是这些判断实际上涨的比例；点越大样本越多。越贴近灰色对角线越准；规则组固定 50%，不画。</p></section>
<section class="card" aria-labelledby="cost-title"><h2 id="cost-title">模型花费与耗时</h2>
 <div id="costs" class="table-scroll"></div></section>
<details class="card help"><summary>怎么用这个页面</summary><ul>
 <li>先选范围：日线是 6 个 ETF 的每日模拟仓，日内是 5 分钟K线、每 15 分钟一次判断的模拟仓。</li>
 <li>日期按判断日（日内按交易日）筛选；判断的结果（5 日 / 30 分钟后方向、目标止损）会用之后的K线计算，所以最近的判断可能还在「待定」。</li>
 <li><b>新规则 v2</b>（默认）：日线判断在次日开盘成交、持有到再下一个开盘，时间段结束后再等这两个开盘；日内判断在写入后第一根1分钟K线的开盘成交（缺1分钟数据时用之后第一根5分钟K线），收盘平仓。只统计 2026-11-25（日线）/ 2026-11-27（日内）起的判断。</li>
 <li><b>旧规则 v1</b>：日线按收盘价进出并在时间段结束后的第一个收盘平仓，日内按下一根5分钟K线开盘成交，成交价不可执行，仅供参考。</li>
 <li>「执行目标/止损」版：方向和成交相同，碰到该判断的目标或止损就出场（同一根K线都碰到算止损），之后空仓到下一次判断。</li>
 <li>「下载 CSV」导出当前筛选下每一条判断及其结果，可用 Excel / Python 自己分析。</li>
 <li>模型花费来自每次调用 Claude 时记录的 token 和费用；开始记录之前的判断没有花费数据。</li>
 <li>样本少时结果主要是噪声；这里只是模拟记录，不构成投资建议。</li>
</ul></details>
<p id="status" class="status" role="status"></p>`,
  script: scriptPrelude() + '\n' + Object.entries(helpers).map(([k, fn]) => emitFunction(fn, k)).join('\n') +
   `\n(${loadExplore.toString()})(${JSON.stringify(config)})`});
}

async function loadExplore({GROUPS, CONTROLS, SYMBOL_HINTS}) {
 const $ = id => document.getElementById(id);
 const groupsFor = scope => GROUPS[scope].map(([key, name, short], i) => ({key, name, short, control: i >= CONTROLS[scope], color: 'var(--s' + (i + 1) + ')'}));
 const params = new URLSearchParams(location.search);
 const state = {scope: params.get('scope') === 'intraday' ? 'intraday' : 'daily', from: params.get('from') || '', to: params.get('to') || '',
  symbol: params.get('symbol') || '', conditions: params.get('conditions') ? params.get('conditions').split(',') : null,
  data: null, selected: null, version: 0, showTs: false};
 const rules = protocolVersion();
 const groupOf = key => isTsKey(key) ? tsGroup(groupOf(key.slice(0, -3))) : groupsFor(state.scope).find(g => g.key === key) ||
  (key === 'recap' ? {key, name: '收盘复盘', short: '复盘', control: false, color: 'var(--faint)'} : {key, name: key, short: key, control: false, color: 'var(--faint)'});
 const order = key => { const i = GROUPS[state.scope].findIndex(g => g[0] === key); return i < 0 ? 99 : i; };
 const query = () => {
  const q = new URLSearchParams({scope: state.scope});
  if (state.from) q.set('from', state.from);
  if (state.to) q.set('to', state.to);
  if (state.symbol) q.set('symbol', state.symbol);
  if (state.conditions) q.set('conditions', state.conditions.join(','));
  if (rules === 1) q.set('v', '1');
  return q;
 };
 const apiQuery = () => { const q = query(); q.set('v', String(rules)); return q; };
 const get = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
 };
 const money = v => !isNum(v) ? '—' : '$' + (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4));
 const secs = v => !isNum(v) ? '—' : (v / 1000).toFixed(v >= 100000 ? 0 : 1) + ' 秒';
 const big = v => !isNum(v) ? '—' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(v);

 function renderFilters() {
  for (const b of $('scope').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.scope === state.scope));
  $('from').value = state.from;
  $('to').value = state.to;
  const o = state.data?.options;
  const syms = o?.symbols || [];
  $('symbol').innerHTML = '<option value="">全部</option>' + syms.map(s => '<option value="' + escapeHtml(s) + '"' + (s === state.symbol ? ' selected' : '') + '>' +
   escapeHtml(s) + (SYMBOL_HINTS[s] ? ' ' + SYMBOL_HINTS[s] : '') + '</option>').join('');
  const keys = (o?.conditions || []).slice().sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  $('groups').innerHTML = keys.map(k => {
   const g = groupOf(k), on = !state.conditions || state.conditions.includes(k);
   return '<button data-key="' + escapeHtml(k) + '" aria-pressed="' + on + '"><span class="sw" style="background:' + g.color + '"></span>' + escapeHtml(g.name) + '</button>';
  }).join('') || '<span class="meta">还没有组别数据</span>';
  $('csv').href = '/api/export.csv?' + apiQuery();
 }

 const rows = () => tsRows(allRows(), state.showTs);
 const allRows = () => Object.entries(state.data?.metrics || {}).map(([k, m]) => [groupOf(k), m])
  .sort((a, b) => (b[1].account.total_return ?? -1) - (a[1].account.total_return ?? -1));
 // Before the first v2 decision (as opposed to a filter that matches nothing).
 const noData = text => {
  const d = state.data;
  return d?.protocol?.from && !((d.options?.last || '') >= d.protocol.from) ? protocolEmpty(d.protocol.from) : text;
 };
 const samples = m => Math.round((m.direction_coverage || 0) * (m.mature || 0));

 function renderBoard() {
  const list = rows(), daily = state.scope === 'daily';
  tsToggle($('ts-toggle'), allRows(), state.showTs);
  if (!list.length) { $('board').innerHTML = noData('<p class="empty">这个筛选条件下没有判断。</p>'); $('adv').innerHTML = ''; return; }
  let few = false;
  $('board').innerHTML = '<table><thead><tr><th>组别</th><th>累计收益</th><th>最大回撤</th><th>' + (daily ? '5日准确率' : '方向准确率') + '<small>（样本数）</small></th><th>' + (daily ? '天数' : '交易日') + '</th></tr></thead><tbody>' +
   list.map(([g, m]) => {
    const n = samples(m), small = n < 100;
    few = few || (small && n > 0);
    const acc = isNum(m.direction_hit_rate) ? '<span' + (small ? ' class="few"' : '') + '>' + ratio(m.direction_hit_rate) + (small ? '*' : '') + '</span>' : '<span class="few">待定</span>';
    return '<tr' + (g.ts ? ' class="ts-row"' : '') + '><td class="gcell"><i class="dot" style="background:' + g.color + '"></i>' + escapeHtml(g.name) + (g.control ? ' <small>对照组</small>' : '') + '</td>' +
     '<td class="' + tone(m.account.total_return) + '">' + pct(m.account.total_return) + '</td><td>' + drawdown(m.account.max_drawdown) + '</td>' +
     '<td>' + acc + '<small>（' + n + '）</small></td><td>' + m.account.days + '</td></tr>';
   }).join('') + '</tbody></table>' +
   (few ? '<p class="note-gray">* 样本太少，仅供参考（已出结果的多/空判断少于 100 个）。</p>' : '') +
   '<p class="note-gray">按累计收益排序。方向准确率 = 做多/做空后' + (daily ? '第 5 个交易日收盘' : ' 30 分钟（6 根K线）') + '价格方向猜对的比例，观望不计入。</p>';
  const cols = [[daily ? '判断数' : '决策数', m => m.predictions ?? m.decisions, v => v ?? '—'], ['夏普', m => m.account.annualized_sharpe, v => num(v)],
   ['持仓时间', m => m.account.exposure, v => ratio(v, 0)], ['覆盖率', m => m.direction_coverage, v => ratio(v, 0)],
   ['Brier', m => m.brier, v => num(v, 3)], ['Log loss', m => m.log_loss, v => num(v, 3)],
   ['目标先到', m => m.target_before_stop_rate, v => ratio(v, 0)], ['已出结果', m => m.mature, v => v ?? '—'],
   [daily ? '待定5日' : '待定+6', m => daily ? m.pending_5 : m.pending_6, v => v ?? '—'], ['待定目标/止损', m => m.pending_horizon, v => v ?? '—'],
   ['方向异常', m => m.levels_inverted, v => v ? '<span class="neg">' + v + '</span>' : (v ?? '—')],
   ...(rules === 2 ? [[daily ? '迟到判断' : '未成交', m => daily ? m.late : m.unfilled, v => v ?? '—'], ...(daily ? [] : [['被取代', m => m.superseded, v => v ?? '—']]),
    ['目标/止损出场', m => isNum(m.target_exits) ? m.target_exits + '/' + m.stop_exits : null, v => v ?? '—'], ['忽略价位', m => m.levels_ignored, v => v ?? '—']] : [])];
  let html = '<div class="table-scroll"><table class="wide"><thead><tr><th>组别</th>' + cols.map(c => '<th>' + c[0] + '</th>').join('') + '</tr></thead><tbody>' +
   list.map(([g, m]) => '<tr><td>' + escapeHtml(g.short) + '</td>' + cols.map(c => '<td>' + c[2](c[1](m)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' +
   '<div class="defs">' + [['夏普', '年化夏普比率，交易日少于几十天时基本没有意义。'], ['持仓时间', '有仓位（多或空）的时间占比。'],
    ['覆盖率', '已出结果的判断中，给出明确做多/做空的比例。'], ['Brier', '概率准确度，越小越好；<0.25 才比瞎猜好。'],
    ['Log loss', '概率的对数损失，越小越好；<0.693 才比瞎猜好。'], ['目标先到', '给了目标和止损的判断里，先碰到目标的比例。'],
    ['方向异常', '目标/止损方向异常：做多时目标不高于或止损不低于判断时价格（做空相反）的判断数，判断照常计入。'],
    ...(rules === 2 ? [[daily ? '迟到判断' : '未成交', daily ? '写入时次日已开盘的判断数（当天算空仓）。' : '最后一根K线之前没有可成交K线的判断数（保持原仓位）。'],
     ['目标/止损出场', '「执行目标/止损」版里碰到目标 / 止损出场的次数。'], ['忽略价位', '没给或相对成交价方向不对、因而不执行的目标/止损个数。']] : [])]
    .map(([k, v]) => '<div><b>' + k + '：</b>' + v + '</div>').join('') + '</div>';
  const pairs = [];
  for (const [g] of list) if (!g.ts) for (const [base, p] of Object.entries(state.data.paired?.[g.key] || {})) if (p.n) pairs.push([g, groupOf(base), p]);
  if (pairs.length) html += '<h3>配对比较（只比两组都有判断的同一时间点）</h3><div class="table-scroll"><table class="wide"><thead><tr><th>组别</th><th>对比</th><th>配对数</th><th>准确率差</th><th>Brier差</th></tr></thead><tbody>' +
   pairs.map(([g, b, p]) => '<tr><td>' + escapeHtml(g.short) + '</td><td>' + escapeHtml(b.short) + '</td><td>' + p.n + '</td><td class="' + tone(p.delta.direction_hit_rate) + '">' +
    pct(p.delta.direction_hit_rate, 1) + '</td><td class="' + (isNum(p.delta.brier) ? tone(-p.delta.brier) : '') + '">' + (isNum(p.delta.brier) ? (p.delta.brier > 0 ? '+' : p.delta.brier < 0 ? '−' : '') + Math.abs(p.delta.brier).toFixed(3) : '—') + '</td></tr>').join('') +
   '</tbody></table></div><p class="note-gray">准确率差为正、Brier 差为负，表示左边的组更好。</p>';
  html += '<p class="note-gray">交易成本：每单位仓位变化 ' + escapeHtml(state.data.cost_bps) + ' 个基点。</p>';
  $('adv').innerHTML = html;
 }

 function legend(id) {
  $(id).innerHTML = rows().map(([g, m]) => '<button data-key="' + escapeHtml(g.key) + '" aria-pressed="' + (g.key === state.selected) + '"><span class="sw" style="background:' +
   g.color + '"></span>' + escapeHtml(g.short) + (id === 'equity-legend' ? ' ' + pct(m.account.total_return) : '') + '</button>').join('');
 }

 function renderCharts() {
  const list = rows();
  if (!state.selected || !list.some(([g]) => g.key === state.selected)) state.selected = list.find(([g]) => !g.control)?.[0].key || list[0]?.[0].key || null;
  drawEquity($('equity'), list.map(([g, m]) => ({key: g.key, name: g.short, color: g.color, dash: g.ts, curve: m.account.equity_curve || []})), state.selected);
  if (!list.length) $('equity').innerHTML = noData($('equity').innerHTML);
  legend('equity-legend');
  const roll = state.data?.rolling || {};
  const series = field => list.map(([g]) => ({key: g.key, name: g.short, color: g.color, dash: g.ts,
   points: (roll[g.key] || []).map(p => ({date: p.date, value: p[field], n: field === 'direction_hit_rate' ? p.n : null}))}));
  drawLines($('roll-hit'), series('direction_hit_rate'), {center: .5, fixed: [.4, .6], selected: state.selected, label: '滚动20日方向准确率', empty: '还没有已出结果的判断。'});
  drawLines($('roll-ret'), series('total_return'), {center: 0, selected: state.selected, label: '滚动20日收益', format: v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(1) + '%'});
  legend('roll-legend');
  const src = state.data?.rolling_source;
  $('roll-src').textContent = src === 'snapshots' ? '数据来源：每日指标快照。' : src === 'mixed' ? '数据来源：每日指标快照；没有快照的日子按同样规则现算。' : '数据来源：按同样规则现算（还没有每日快照）。';
  const cal = list.filter(([g]) => !g.control && !g.ts).map(([g, m]) => ({key: g.key, name: g.short, color: g.color, buckets: m.calibration || []}));
  drawCalibration($('calib'), cal);
  $('cal-legend').innerHTML = cal.filter(s => s.buckets.some(b => b.n)).map(s => '<span class="chip"><span class="sw" style="background:' + s.color + '"></span>' + escapeHtml(s.name) + '</span>').join('');
 }

 function renderCosts() {
  const llm = state.data?.llm;
  if (!llm) { $('costs').innerHTML = '<p class="empty">还没有调用记录（需要先应用数据库迁移 0003）。</p>'; return; }
  if (!llm.length) { $('costs').innerHTML = '<p class="empty">这个筛选条件下没有模型调用记录。</p>'; return; }
  const total = llm.reduce((a, r) => a + (r.cost_usd || 0), 0), calls = llm.reduce((a, r) => a + r.calls, 0);
  $('costs').innerHTML = '<table class="costs"><thead><tr><th>组别</th><th>调用<small>（成功）</small></th><th>总花费</th><th>每次平均</th><th>平均耗时</th><th>tokens<small>输入 / 输出 / 缓存读</small></th></tr></thead><tbody>' +
   llm.sort((a, b) => order(a.condition) - order(b.condition)).map(r => {
    const g = groupOf(r.condition);
    return '<tr><td class="gcell"><i class="dot" style="background:' + g.color + '"></i>' + escapeHtml(g.short) + '</td><td>' + r.calls + '<small>（' + (r.ok ?? 0) + '）</small></td><td>' + money(r.cost_usd) +
     '</td><td>' + money(r.avg_cost_usd) + '</td><td>' + secs(r.avg_duration_ms) + '</td><td>' + big(r.input_tokens) + ' / ' + big(r.output_tokens) + ' / ' + big(r.cache_read_tokens) + '</td></tr>';
   }).join('') + '<tr><td><b>合计</b></td><td>' + calls + '</td><td><b>' + money(total) + '</b></td><td>' + money(calls ? total / calls : null) + '</td><td></td><td></td></tr></tbody></table>' +
   '<p class="note-gray">每次调用 Claude 记录一行（解析失败重试也算一次）；费用是 Claude CLI 报告的估算值（美元）。不记录提示词和输出。</p>';
 }

 function renderAll() {
  $('proto').innerHTML = protocolBar(rules);
  renderFilters();
  renderBoard();
  renderCharts();
  renderCosts();
  const d = state.data;
  if (d) {
   const n = Object.values(d.metrics).filter(m => !m.derived_from).reduce((a, m) => a + (m.predictions ?? m.decisions ?? 0), 0);
   $('summary').textContent = (state.scope === 'daily' ? '日线' : '日内') + ' · ' + (d.range.first ? d.range.first + ' 至 ' + d.range.last : '无数据') + ' · ' + n + ' 个判断' +
    (state.symbol ? ' · ' + state.symbol : '');
  }
 }

 const refresh = async () => {
  const v = ++state.version;
  history.replaceState(null, '', location.pathname + '?' + query());
  $('proto').innerHTML = protocolBar(rules);
  $('csv').href = '/api/export.csv?' + apiQuery();
  try {
   const data = await get('/api/explore?' + apiQuery());
   if (v !== state.version) return;
   state.data = data;
   renderAll();
   $('status').textContent = '';
  } catch (e) {
   if (v !== state.version) return;
   $('status').textContent = '数据加载失败（' + e.message + '），请稍后刷新。';
   renderFilters();
  }
 };

 $('ts-toggle').addEventListener('click', () => { state.showTs = !state.showTs; renderBoard(); renderCharts(); });
 $('scope').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.dataset.scope === state.scope) return;
  state.scope = b.dataset.scope;
  state.symbol = '';
  state.conditions = null;
  state.selected = null;
  state.data = null;
  refresh();
 });
 for (const id of ['from', 'to']) $(id).addEventListener('change', () => { state[id] = $(id).value; refresh(); });
 $('symbol').addEventListener('change', () => { state.symbol = $('symbol').value; refresh(); });
 $('groups').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const all = state.data?.options?.conditions || [];
  const on = new Set(state.conditions || all);
  on.has(b.dataset.key) ? on.delete(b.dataset.key) : on.add(b.dataset.key);
  if (!on.size) return;
  state.conditions = all.every(k => on.has(k)) ? null : all.filter(k => on.has(k));
  refresh();
 });
 document.querySelector('.quick').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const days = Number(b.dataset.days), last = state.data?.options?.last;
  state.to = '';
  state.from = days && last ? new Date(Date.parse(last + 'T12:00:00Z') - Math.ceil(days * 7 / 5) * 86400000).toISOString().slice(0, 10) : '';
  refresh();
 });
 for (const id of ['equity-legend', 'roll-legend']) $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (b) { state.selected = b.dataset.key; renderCharts(); } });
 let resizing;
 addEventListener('resize', () => { clearTimeout(resizing); resizing = setTimeout(() => state.data && renderCharts(), 150); });
 await refresh();
}
