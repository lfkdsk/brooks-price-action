import {buildOverlay, liveChart, priorLevels, ptClock} from './intraday-chart.js';
import {escapeHtml, isNum, pageShell, renderMarkdown, scriptPrelude, stripPreamble, tone} from './ui-common.js';

export {escapeHtml, renderMarkdown};

const intradayCss = `
.ov-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.ov-head form{display:flex;gap:6px;align-items:center}
.ov-head input{width:5.5em;padding:4px 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;text-transform:uppercase}
.ov-head button,.ov-foot select{padding:4px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);cursor:pointer;color:var(--ink);font:inherit}
.ov-price{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:8px}
.price{font-size:34px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
.change{font-size:16px;font-weight:600;font-variant-numeric:tabular-nums}.change .vs{font-size:13px;font-weight:400;color:var(--muted);margin-left:8px}
.summary{margin:10px 0 0;padding:10px 12px;border-radius:10px;background:var(--bg);font-size:15px}
.summary .k{color:var(--muted);font-size:13px;display:block;margin-bottom:2px}.summary .dt{overflow-wrap:anywhere}
.ov-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:14px;color:var(--muted)}
.grow{border-bottom:1px solid var(--line)}.grow:last-child{border-bottom:0}
.grow-main{display:grid;grid-template-columns:1fr auto 4.6em 4.6em;gap:8px;align-items:center;width:100%;padding:9px 0 2px;border:0;background:none;text-align:left;cursor:pointer}
.gname{font-weight:600;font-size:14px;line-height:1.3}
.gnum{text-align:right;font-variant-numeric:tabular-nums;line-height:1.2}.gnum small{display:block;color:var(--muted);font-size:11px}.gnum b{font-size:14px}
.gdesc{font-size:12.5px;color:var(--muted);padding:0 0 8px 15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.grow.open .gdesc{white-space:normal}
.gmore{font-size:13px;padding:0 0 10px 15px}
.dm{cursor:pointer;outline:none}.dm .hit{fill:transparent}
.dm path,.dm circle{stroke:var(--card);stroke-width:1.5}
.dm-long path{fill:var(--long)}.dm-short path{fill:var(--short)}.dm-flat circle{fill:var(--card);stroke:var(--flat);stroke-width:2}
.dm.active path,.dm.active circle,.dm:focus-visible path,.dm:focus-visible circle{stroke:var(--ink);stroke-width:2.5}
.strip{display:grid;gap:4px 3px;align-items:center;width:max-content;padding-right:8px}
.strip .sl{position:sticky;left:0;background:var(--card);font-size:12.5px;padding-right:8px;white-space:nowrap;z-index:1}
.strip .sh{font-size:10.5px;color:var(--faint);white-space:nowrap;overflow:visible;height:14px}
.cell{width:16px;height:16px;border-radius:3px;border:0;padding:0;cursor:pointer}
.cell.c-long{background:var(--long)}.cell.c-short{background:var(--short)}.cell.c-flat{background:var(--flat);opacity:.55}
.cell.c-miss{background:none;border:1.5px solid var(--faint)}.cell.c-none{background:var(--bg);cursor:default}
.cell.sel{outline:2px solid var(--ink);outline-offset:1px}
#advanced{margin-top:12px;border-top:1px solid var(--line);padding-top:8px}
#adv table{min-width:640px}#adv td,#adv th{white-space:nowrap}
.sheet{position:fixed;left:0;right:0;bottom:0;max-height:72vh;overflow:auto;background:var(--card);border-top:1px solid var(--line);border-radius:16px 16px 0 0;box-shadow:0 -6px 28px rgba(0,0,0,.25);padding:6px 16px 20px;z-index:10;max-width:720px;margin:auto}
.sheet-head{display:flex;align-items:center;justify-content:space-between;gap:8px;position:sticky;top:-6px;background:var(--card);padding:8px 0}
.sheet-head h3{margin:0;font-size:16px}
.sheet-head button{border:0;background:var(--bg);border-radius:50%;width:32px;height:32px;font-size:20px;line-height:1;cursor:pointer}
.navrow{display:flex;justify-content:space-between;margin-top:12px}
.navrow button{border:1px solid var(--line);background:var(--bg);border-radius:8px;padding:5px 12px;cursor:pointer}
.navrow button:disabled{opacity:.4;cursor:default}
@media(min-width:700px){.price{font-size:40px}.grow-main{grid-template-columns:1fr auto 6em 6em}}
`;

export function intradayPage() {
 return pageShell({title: '日内模拟仓 · Brooks Forward', current: 'intraday', css: intradayCss, body: `<div id="proto" class="proto" aria-label="统计规则切换"></div>
<section class="card" id="overview" aria-labelledby="ov-title">
 <div class="ov-head"><h1 id="ov-title">今日概览 · 5分钟模拟仓</h1><span id="chip" class="chip">加载中…</span></div>
 <div class="ov-price"><span id="last-price" class="price">—</span><span id="change" class="change"></span></div>
 <p id="ov-meta" class="meta"></p>
 <div id="ov-summary" class="summary">正在读取数据…</div>
 <div class="ov-foot">
  <form id="symbol-form" action="/intraday" class="ov-head"><input type="hidden" name="v" id="form-v" disabled><input id="symbol" name="symbol" value="SPY" maxlength="24" aria-label="代码" required><button>查看</button></form>
  <label>交易日 <select id="session"><option value="">最新</option></select></label>
  <a id="recap" href="/recap">今日复盘 →</a>
 </div>
</section>
<section class="card" aria-labelledby="groups-title"><h2 id="groups-title">各组现在怎么看</h2>
 <div id="groups"></div><p class="hint">点一行展开说明。盈亏已扣交易成本；「累计」是所有交易日连乘。<span id="counted"></span></p></section>
<section class="card" aria-labelledby="chart-title"><h2 id="chart-title">走势图</h2>
 <div id="seg" class="seg" role="group" aria-label="选择在图上显示哪一组"></div>
 <div id="chart" class="chart-scroll"></div>
 <p class="legend"><span class="k"><b class="up">▲</b>做多 <b class="dn">▼</b>做空 <b class="fl">○</b>观望（点标记看详情）</span><span class="k"><span class="sw" style="background:var(--long-soft)"></span>持多 <span class="sw" style="background:var(--short-soft)"></span>持空</span><span class="k"><b class="em">—</b> 20均线</span><span>虚线：昨收/昨低、目标/止损。</span><span>横轴：K线序号 + 太平洋时间</span></p>
</section>
<section class="card" aria-labelledby="strip-title"><h2 id="strip-title">观点时间轴</h2>
 <div id="strip" class="strip-scroll"></div>
 <p class="legend"><span class="k"><span class="sw" style="background:var(--long)"></span>做多</span><span class="k"><span class="sw" style="background:var(--short)"></span>做空</span><span class="k"><span class="sw" style="background:var(--flat);opacity:.55"></span>观望</span><span class="k"><span class="sw" style="border:1.5px solid var(--faint)"></span>漏掉（没按时运行）</span><br>每格是一个 15 分钟判断点，点格子看详情；上方是判断时刻（太平洋时间）。</p>
</section>
<section class="card" aria-labelledby="board-title"><div class="bhead"><h2 id="board-title">谁更准</h2><button id="ts-toggle" class="ts-btn" aria-pressed="false" hidden>显示执行目标/止损版</button></div>
 <div id="board" class="table-scroll"></div>
 <p class="note-gray">「Claude（不用 Brooks）」拿不到「读数据」组的那份算好的特征文件（features.txt），所以这两组的差距不等于纯 Brooks 方法的效果，也包含了特征文件的作用。</p>
 <details id="advanced"><summary>高级指标</summary><div id="adv"></div></details>
</section>
<section class="card" aria-labelledby="equity-title"><h2 id="equity-title">累计收益</h2>
 <div id="equity"></div><div id="equity-legend" class="chips" role="group" aria-label="高亮某一组"></div></section>
<details class="card help"><summary>怎么看这个页面</summary><ul>
 <li>开盘后每 15 分钟（第 3、6、9…根 5 分钟K线收盘时）每组给出一次判断：做多、做空或观望。</li>
 <li><b>新规则 v2</b>（默认，从 2026-11-27 的交易日开始统计）：判断写入之后，在<b>第一根开始时间不早于写入时间的1分钟K线开盘价</b>成交；没有1分钟数据时用之后第一根5分钟K线的开盘价；最后一根K线之前都没有，就不成交（保持原仓位）。漏掉的判断点也保持原仓位。观望就是不持仓。</li>
 <li><b>旧规则 v1</b>（?v=1）：按下一根5分钟K线的开盘价成交。判断通常在收盘后约 40 秒才写入，那个开盘价已经过去，所以偏乐观，仅供参考。两种规则用的是同一批判断记录。</li>
 <li>「执行目标/止损」版：方向和成交相同，但之后的1分钟K线碰到该判断的目标或止损就出场（同一根K线都碰到算止损，跳空按开盘价），之后空仓到下一次判断。没给或方向不对的价位不执行。</li>
 <li>收盘时（最后一根K线收盘价）全部平仓，不持仓过夜，第二天从空仓开始；提前收盘的日子在当天最后一根K线平仓。</li>
 <li>每次开仓、平仓或反手按 <span id="cost">1</span> 个基点（0.01%）扣交易成本，图表和表格里的收益都已扣除。</li>
 <li>「对照组」是不用 AI 的简单规则（均线、开盘方向、一直持有）。Claude 组要长期跑赢它们才算有用。</li>
 <li>只有几天的数据时，收益和准确率主要是运气（噪声）；通常要几十个交易日、上百次判断才值得参考。</li>
 <li>这里只是模拟记录，不是真实下单，不构成投资建议；与 Brooks Trading Course 无关。</li>
</ul></details>
<p id="status" class="status" role="status"></p>`,
  after: `
<div id="sheet" class="sheet" hidden role="dialog" aria-labelledby="sheet-title"><div class="sheet-head"><h3 id="sheet-title"></h3><button id="sheet-close" aria-label="关闭">×</button></div><div id="sheet-body"></div></div>
`,
  script: scriptPrelude([buildOverlay, priorLevels, ptClock, liveChart]) + `\n(${loadIntraday.toString()})()`});
}

async function loadIntraday() {
 const $ = id => document.getElementById(id);
 const GROUPS = [
  ['skill_chart', 'Claude + Brooks（看图）', '看图', 'Claude 先看一张K线图，再按 Brooks 价格行为方法判断方向。'],
  ['skill', 'Claude + Brooks（读数据）', '读数据', 'Claude 读K线数字和算好的特征，按 Brooks 价格行为方法判断方向。'],
  ['baseline', 'Claude（不用 Brooks）', '无Brooks', '同一个 Claude，但不给 Brooks 方法，也没有算好的特征文件，所以差距不全是 Brooks 方法的效果。'],
  ['ema20_5m', '均线规则（EMA20）', '均线', '对照组：价格在 20 均线上方就做多，下方就做空。'],
  ['opening_bar', '开盘方向规则', '开盘', '对照组：跟着开盘第一根K线的方向做；第一根实体太小就观望。'],
  ['buy_hold', '一直持有（参照）', '持有', '对照组：开盘后买入、收盘卖出，代表当天大盘本身的涨跌。']
 ].map(([key, name, short, desc], i) => ({key, name, short, desc, control: i >= 3, color: 'var(--s' + (i + 1) + ')'}));
 const known = Object.fromEntries(GROUPS.map(g => [g.key, g]));
 const groupOf = key => known[key] || {key, name: key, short: key, desc: '', control: false, color: 'var(--faint)'};
 // sideOf, pill, pct, ratio, num, tone, drawdown, drawEquity come from the shared ui-common prelude.
 const ok = isNum;
 const parts = (zone, date) => Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: zone, weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
  .formatToParts(date).map(p => [p.type, p.value]));
 const get = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
 };
 const params = new URLSearchParams(location.search);
 const version = protocolVersion();
 const symbol = params.get('symbol') || 'SPY';
 const query = new URLSearchParams({symbol});
 $('symbol').value = symbol;
 if (version === 1) { $('form-v').value = '1'; $('form-v').disabled = false; }
 const select = $('session');
 const state = {showTs: false, condition: known[params.get('group')] ? params.get('group') : 'skill_chart',
  data: null, stats: null, expanded: new Set(), sheet: null, version: 0};

 const todayBars = () => state.data.bars.filter(b => b.session === state.data.session);
 const decisionsOf = key => state.data.predictions.filter(p => p.condition === key).sort((a, b) => a.bar - b.bar);
 const presentGroups = () => {
  const keys = new Set([...Object.keys(state.data?.positions || {}), ...Object.keys(state.stats?.conditions || {})]);
  for (const k of [...keys]) if (k === 'missed' || isTsKey(k)) keys.delete(k);
  return [...GROUPS.filter(g => keys.has(g.key) || !keys.size), ...[...keys].filter(k => !known[k]).map(groupOf)];
 };
 // Statistics rows, including the derived target/stop variants under their base group.
 const statRows = () => {
  const c = state.stats?.conditions || {};
  return presentGroups().flatMap(g => [g, tsGroup(g)]).filter(g => c[g.key]).map(g => [g, c[g.key]]);
 };
 const emptyStats = text => version === 2 && state.stats?.protocol && !Object.keys(state.stats.conditions).length ? protocolEmpty(state.stats.protocol.from) : text;
 const isLive = () => {
  const d = state.data, et = parts('America/New_York', new Date());
  return !!d.session && d.sessions[0] === d.session && !d.latest_final && d.session === et.year + '-' + et.month + '-' + et.day;
 };

 function renderOverview() {
  const d = state.data;
  const live = isLive();
  $('chip').textContent = live ? '盘中·每15分钟更新' : '已收盘';
  $('chip').className = 'chip' + (live ? ' live' : '');
  const bars = todayBars();
  const last = bars.at(-1);
  if (!last) {
   $('last-price').textContent = '—';
   $('change').textContent = '';
   $('ov-meta').textContent = symbol + ' · 还没有交易日数据';
   $('ov-summary').textContent = '还没有记录到这个代码的日内K线。';
   return;
  }
  const prior = priorLevels(d.bars, d.session);
  $('last-price').textContent = num(last.close);
  if (prior) {
   const ch = last.close - prior.close;
   $('change').innerHTML = '<span class="' + tone(ch) + '">' + (ch > 0 ? '+' : ch < 0 ? '−' : '') + Math.abs(ch).toFixed(2) +
    '（' + pct(ch / prior.close) + '）</span><span class="vs">较昨收 ' + num(prior.close) + '</span>';
  } else $('change').textContent = '';
  $('ov-meta').textContent = symbol + ' · 交易日 ' + d.session + '（美东）· 最新第 ' + last.bar + ' 根K线 ' +
   ptClock(last.bar) + '–' + ptClock(last.bar + 1) + ' PT';
  const lead = ['skill_chart', 'skill'].map(k => decisionsOf(k).at(-1)).find(Boolean);
  if (lead) {
   const g = groupOf(lead.condition);
   $('ov-summary').innerHTML = '<span class="k">一句话盘面 · ' + escapeHtml(g.name) + '，' + ptClock(lead.bar + 1) + ' PT</span>' +
    pill(lead.always_in) + ' <span class="dt">' + escapeHtml(lead.day_type || '') + '</span>';
  } else $('ov-summary').textContent = '今天还没有 Claude 的判断（第一个判断在开盘 15 分钟后）。';
  const latest = d.sessions[0] === d.session;
  $('recap').textContent = latest && live ? '复盘（收盘后生成）→' : latest ? '今日复盘 →' : '当日复盘 →';
  $('recap').href = (live ? '/recap' : '/recap/' + d.session) + '?' + query;
 }

 function renderGroups() {
  const d = state.data, totals = state.stats?.conditions || {};
  const label = isLive() || d.sessions[0] === d.session ? '今日' : '当日';
  let html = '', controls = false;
  for (const g of presentGroups()) {
   if (g.control && !controls) {
    controls = true;
    html += '<div class="ghead">对照组 · 简单规则，用来比较</div>';
   }
   const p = decisionsOf(g.key).at(-1);
   const today = d.positions?.[g.key]?.return;
   const total = totals[g.key]?.account?.total_return;
   const open = state.expanded.has(g.key);
   html += '<div class="grow' + (open ? ' open' : '') + '"><button class="grow-main" data-key="' + escapeHtml(g.key) + '" aria-expanded="' + open + '">' +
    '<span class="gname"><i class="dot" style="background:' + g.color + '"></i>' + escapeHtml(g.name) + '</span>' + pill(p?.always_in) +
    '<span class="gnum"><small>' + label + '</small><b class="' + tone(today) + '">' + pct(today) + '</b></span>' +
    '<span class="gnum"><small>累计</small><b class="' + tone(total) + '">' + pct(total) + '</b></span></button>' +
    '<div class="gdesc">' + escapeHtml(g.desc) + '</div>' +
    (state.showTs && d.positions?.[g.key + '_ts'] ? '<div class="gmore">└ 执行目标/止损：' + label + ' <b class="' + tone(d.positions[g.key + '_ts'].return) + '">' + pct(d.positions[g.key + '_ts'].return) +
     '</b> · 累计 <b class="' + tone(totals[g.key + '_ts']?.account?.total_return) + '">' + pct(totals[g.key + '_ts']?.account?.total_return) + '</b></div>' : '') +
    (open ? '<div class="gmore">' + (p ? '最新判断：第 ' + p.bar + ' 根K线收盘（' + ptClock(p.bar + 1) + ' PT）' +
     (g.control ? '' : '，上涨概率 ' + Math.round(p.p_up_6 * 100) + '%') +
     ' · <button class="link" data-open="' + escapeHtml(g.key) + '" data-bar="' + p.bar + '">查看详情</button>' : '这个交易日还没有判断。') + '</div>' : '') +
    '</div>';
  }
  $('groups').innerHTML = html;
  $('counted').textContent = version === 2 && d.protocol && d.session && !d.protocol.counted ? '这个交易日早于新规则起始日，当日盈亏按新规则试算，不计入累计。' : '';
 }

 function renderSeg() {
  $('seg').innerHTML = presentGroups().map(g => '<button data-key="' + escapeHtml(g.key) + '" aria-pressed="' +
   (g.key === state.condition) + '">' + escapeHtml(g.short) + '</button>').join('');
 }

 function renderChart() {
  const box = $('chart'), d = state.data;
  const keep = box.scrollLeft;
  const pinned = !box.firstElementChild || box.scrollLeft + box.clientWidth >= box.scrollWidth - 8;
  if (!todayBars().length) { box.innerHTML = '<p class="empty">这个交易日还没有K线数据。</p>'; return; }
  const overlay = buildOverlay(d.bars, d.predictions, d.session, state.condition, version === 2 ? d.fills?.[state.condition] : undefined);
  const phone = box.clientWidth < 600;
  box.innerHTML = liveChart(d.bars, {session: d.session, prior: priorLevels(d.bars, d.session), overlay,
   latest: overlay.decisions.at(-1), activeBar: state.sheet?.key === state.condition ? state.sheet.bar : null,
   viewWidth: box.clientWidth || 360, height: phone ? 320 : 420, minStep: phone ? 10 : 8});
  box.scrollLeft = pinned ? box.scrollWidth : keep;
 }

 function renderStrip() {
  const box = $('strip'), d = state.data;
  const keep = box.scrollLeft;
  const pinned = !box.firstElementChild || box.scrollLeft + box.clientWidth >= box.scrollWidth - 8;
  const last = todayBars().at(-1)?.bar || 0;
  const cols = [];
  for (let n = 3; n <= Math.min(75, last); n += 3) cols.push(n);
  if (!cols.length) { box.innerHTML = '<p class="empty">第一个判断在开盘 15 分钟后（第 3 根K线收盘）。</p>'; return; }
  const by = new Map(d.predictions.map(p => [p.condition + ':' + p.bar, p]));
  const html = ['<div class="strip" style="grid-template-columns:auto repeat(' + cols.length + ',16px)"><span class="sl"></span>'];
  for (const n of cols) html.push('<span class="sh">' + (n % 6 === 0 ? ptClock(n + 1) : '') + '</span>');
  for (const g of presentGroups()) {
   html.push('<span class="sl"><i class="dot" style="background:' + g.color + '"></i>' + escapeHtml(g.short) + '</span>');
   for (const n of cols) {
    const p = by.get(g.key + ':' + n);
    const missed = !p && by.has('missed:' + n);
    const cls = p ? sideOf(p.always_in)[1] : missed ? 'miss' : 'none';
    const word = p ? sideOf(p.always_in)[0] : missed ? '漏掉' : '无记录';
    const sel = state.sheet && state.sheet.key === g.key && state.sheet.bar === n ? ' sel' : '';
    html.push('<button class="cell c-' + cls + sel + '" data-open="' + escapeHtml(g.key) + '" data-bar="' + n + '" title="' +
     escapeHtml(g.short) + ' · ' + ptClock(n + 1) + ' PT · ' + word + '" aria-label="' + escapeHtml(g.name) + '，' + ptClock(n + 1) + '，' + word + '"' +
     (cls === 'none' ? ' disabled' : '') + '></button>');
   }
  }
  box.innerHTML = html.join('') + '</div>';
  box.scrollLeft = pinned ? box.scrollWidth : keep;
 }

 function renderBoard() {
  const s = state.stats;
  if (!s) return;
  $('cost').textContent = s.cost_bps;
  const every = statRows().sort((a, b) => (b[1].account.total_return ?? -1) - (a[1].account.total_return ?? -1));
  tsToggle($('ts-toggle'), every, state.showTs);
  const rows = tsRows(every, state.showTs);
  if (!rows.length) { $('board').innerHTML = emptyStats('<p class="empty">还没有统计数据。</p>'); $('adv').innerHTML = ''; return; }
  let few = false;
  $('board').innerHTML = '<table><thead><tr><th>组别</th><th>累计收益</th><th>最大回撤</th><th>方向准确率<small>（样本数）</small></th><th>交易日</th></tr></thead><tbody>' +
   rows.map(([g, m]) => {
    const n = Math.round((m.direction_coverage || 0) * (m.mature || 0));
    const small = n < 100;
    few = few || small;
    return '<tr' + (g.ts ? ' class="ts-row"' : '') + '><td class="gcell"><i class="dot" style="background:' + g.color + '"></i>' + escapeHtml(g.name) + '</td>' +
     '<td class="' + tone(m.account.total_return) + '">' + pct(m.account.total_return) + '</td>' +
     '<td>' + drawdown(m.account.max_drawdown) + '</td>' +
     '<td' + (small ? ' class="few"' : '') + '><span' + (small ? ' class="few"' : '') + '>' + ratio(m.direction_hit_rate) + (small ? '*' : '') + '</span><small>（' + n + '）</small></td>' +
     '<td>' + m.account.days + '</td></tr>';
   }).join('') + '</tbody></table>' +
   (few ? '<p class="note-gray">* 样本太少，仅供参考（已出结果的多/空判断少于 100 个）。</p>' : '') +
   '<p class="note-gray">按累计收益排序。方向准确率 = 做多/做空后 30 分钟（6 根K线）价格方向猜对的比例，观望不计入。</p>';
  const cols = [['决策数', 'decisions', v => v],
   ['夏普', m => m.account.annualized_sharpe, v => num(v)], ['持仓时间', m => m.account.exposure, v => ratio(v, 0)],
   ['覆盖率', 'direction_coverage', v => ratio(v, 0)], ['Brier', 'brier', v => num(v, 3)], ['Log loss', 'log_loss', v => num(v, 3)],
   ['目标先到', 'target_before_stop_rate', v => ratio(v, 0)], ['待定+6', 'pending_6', v => v],
   ['待定目标/止损', 'pending_horizon', v => v], ['待定入场', 'pending_entries', v => v],
   ...(version === 2 ? [['未成交', 'unfilled', v => v ?? '—'], ['被取代', 'superseded', v => v ?? '—'],
    ['目标/止损出场', m => isNum(m.target_exits) ? m.target_exits + '/' + m.stop_exits : '—', v => v], ['忽略价位', 'levels_ignored', v => v ?? '—']] : [])];
  const pick = (m, k) => typeof k === 'function' ? k(m) : m[k];
  const pairs = [];
  for (const [g] of rows) if (!g.ts) for (const [base, p] of Object.entries(s.paired?.[g.key] || {})) if (p.n) pairs.push([g, groupOf(base), p]);
  $('adv').innerHTML = '<div class="table-scroll"><table><thead><tr><th>组别</th>' + cols.map(c => '<th>' + c[0] + '</th>').join('') + '</tr></thead><tbody>' +
   rows.map(([g, m]) => '<tr><td>' + escapeHtml(g.short) + '</td>' + cols.map(c => '<td>' + c[2](pick(m, c[1])) + '</td>').join('') + '</tr>').join('') +
   '</tbody></table></div><div class="defs">' + [
    ['决策数', '记录下来的判断次数。'],
    ['夏普', '年化夏普比率：收益除以波动，越高越好；交易日少于几十天时基本没有意义。'],
    ['持仓时间', '盘中有仓位（多或空）的时间占比。'],
    ['覆盖率', '给出明确做多/做空（而不是观望）的判断比例。'],
    ['Brier', '概率准确度，越小越好；<0.25 才比瞎猜（永远 50%）好。'],
    ['Log loss', '概率的对数损失，越小越好；<0.693 才比瞎猜好。'],
    ['目标先到', '给了目标价和止损的判断里，先碰到目标的比例。'],
    ['待定+6', '还没走完 6 根K线、暂时无法判对错的判断数。'],
    ['待定目标/止损', '目标和止损都还没碰到、时间也没到的判断数。'],
    ['待定入场', version === 2 ? '写入之后的K线还没到、尚未模拟成交的判断数。' : '下一根K线还没开盘、尚未模拟成交的判断数。'],
    ...(version === 2 ? [['未成交', '最后一根K线之前没有可成交K线的判断数（保持原仓位）。'], ['被取代', '写入太晚、更新的判断已先成交而不再执行的判断数。'],
     ['目标/止损出场', '「执行目标/止损」版里碰到目标 / 碰到止损出场的次数。'], ['忽略价位', '没给或相对成交价方向不对、因而不执行的目标/止损个数。']] : [])
   ].map(([k, v]) => '<div><b>' + k + '：</b>' + v + '</div>').join('') + '</div>' +
   (pairs.length ? '<h3>配对比较（只比两组都有判断的同一时间点）</h3><div class="table-scroll"><table><thead><tr><th>组别</th><th>对比</th><th>配对数</th><th>准确率差</th><th>收益差</th></tr></thead><tbody>' +
    pairs.map(([g, b, p]) => '<tr><td>' + escapeHtml(g.short) + '</td><td>' + escapeHtml(b.short) + '</td><td>' + p.n + '</td><td class="' + tone(p.delta.direction_hit_rate) + '">' +
     pct(p.delta.direction_hit_rate, 1) + '</td><td class="' + tone(p.delta.total_return) + '">' + pct(p.delta.total_return) + '</td></tr>').join('') +
    '</tbody></table></div><p class="note-gray">正数表示左边的组更好。</p>' : '') +
   '<p class="note-gray">交易成本：每单位仓位变化 ' + s.cost_bps + ' 个基点；漏掉的判断点共 ' + s.missed + ' 个。</p>';
 }

 function renderEquity() {
  const s = state.stats;
  if (!s) return;
  const groups = tsRows(statRows(), state.showTs).map(row => row[0]);
  drawEquity($('equity'), groups.map(g => ({key: g.key, name: g.short, color: g.color, dash: g.ts, curve: s.conditions[g.key].account.equity_curve})), state.condition);
  if (!groups.length) $('equity').innerHTML = emptyStats($('equity').innerHTML);
  $('equity-legend').innerHTML = groups.map(g => '<button data-key="' + escapeHtml(g.key) + '" aria-pressed="' + (g.key === state.condition) + '"><span class="sw" style="background:' +
   g.color + '"></span>' + escapeHtml(g.short) + ' ' + pct(s.conditions[g.key].account.total_return) + '</button>').join('');
 }

 function fillText(s) {
  const f = version === 2 ? state.data.fills?.[s.key]?.find(x => x.bar === s.bar) : null;
  if (!f) return '';
  if (f.status === 'pending') return '<p class="sub">模拟成交：等待成交</p>';
  if (f.status === 'unfilled') return '<p class="sub">模拟成交：未成交（最后一根K线之前没有可成交的K线）</p>';
  if (f.status === 'superseded') return '<p class="sub">模拟成交：未执行（更新的判断已先成交）</p>';
  const t = parts('America/Los_Angeles', new Date(f.ts));
  return '<p class="sub">模拟成交：' + t.hour + ':' + t.minute + ' PT · ' + num(f.price) + (f.source === '1m' ? '（1分钟K线开盘）' : '（缺1分钟数据，用5分钟K线开盘）') + '</p>';
 }

 function renderSheet() {
  const sheet = $('sheet'), s = state.sheet;
  for (const el of document.querySelectorAll('.cell.sel')) el.classList.remove('sel');
  for (const el of document.querySelectorAll('.dm')) el.classList.toggle('active', !!s && s.key === state.condition && Number(el.dataset.bar) === s.bar);
  if (!s) { sheet.hidden = true; return; }
  const d = state.data, g = groupOf(s.key);
  for (const el of document.querySelectorAll('.cell')) if (el.dataset.open === s.key && Number(el.dataset.bar) === s.bar) el.classList.add('sel');
  const p = d.predictions.find(x => x.condition === s.key && x.bar === s.bar);
  const missed = !p && d.predictions.some(x => x.condition === 'missed' && x.bar === s.bar);
  const list = decisionsOf(s.key).map(x => x.bar);
  const i = list.indexOf(s.bar);
  $('sheet-title').textContent = g.name;
  let html = '<p class="sub">第 ' + s.bar + ' 根K线收盘 · ' + ptClock(s.bar + 1) + ' PT · ' + d.session + '</p>';
  if (!p) html += '<p>' + (missed ? '这个时间点程序没有按时运行，没有判断（记为漏掉）。' : '这个时间点没有记录。') + '</p>';
  else {
   const reading = stripPreamble((p.reading || '').replace(/\n*\x60\x60\x60(?:json)?[\s\S]*?\x60\x60\x60\s*$/i, ''));
   html += '<div>' + pill(p.always_in) + levelsTag(p) + (p.always_in === 'unclear' ? ' <span class="sub">不持仓</span>' : '') + '</div>' +
    '<dl class="kv"><div><dt>30 分钟后更高的概率</dt><dd>' + (g.control ? '—（规则组不估概率）' : Math.round(p.p_up_6 * 100) + '%') + '</dd></div>' +
    '<div><dt>判断时价格</dt><dd>' + num(p.close) + '</dd></div>' +
    '<div><dt>目标</dt><dd class="pos">' + num(p.target) + '</dd></div><div><dt>止损</dt><dd class="neg">' + num(p.stop) + '</dd></div></dl>' +
    fillText(s) + (p.day_type ? '<p><span class="sub">盘面类型：</span>' + escapeHtml(p.day_type) + '</p>' : '') +
    (reading ? '<div class="reading' + (s.full ? ' full' : '') + '">' + renderMarkdown(reading) + '</div><button class="link" id="sheet-more">' +
     (s.full ? '收起' : '展开全文') + '</button>' : '<p class="sub">' + (g.control ? '机械规则，没有文字解读。' : '没有文字解读。') + '</p>');
  }
  html += '<div class="navrow"><button data-step="-1"' + (i > 0 ? '' : ' disabled') + '>← 上一次</button><button data-step="1"' +
   (i >= 0 && i < list.length - 1 ? '' : ' disabled') + '>下一次 →</button></div>';
  $('sheet-body').innerHTML = html;
  sheet.hidden = false;
 }
 const openSheet = (key, bar) => {
  state.sheet = {key, bar, full: false};
  renderSheet();
  $('sheet-body').scrollTop = 0;
 };

 const selectGroup = key => {
  state.condition = key;
  const u = new URL(location.href);
  u.searchParams.set('group', key);
  history.replaceState(null, '', u);
  $('proto').innerHTML = protocolBar(version);
  renderSeg();
  renderChart();
  renderEquity();
  renderSheet();
 };

 function renderAll() {
  $('proto').innerHTML = protocolBar(version);
  if (state.data) {
   renderOverview();
   renderGroups();
   renderSeg();
   renderChart();
   renderStrip();
  }
  renderBoard();
  renderEquity();
  if (state.data && state.sheet) renderSheet();
 }

 const refresh = async () => {
  const request = ++state.version;
  const p = new URLSearchParams(query);
  p.set('v', String(version));
  if (select.value) p.set('session', select.value);
  const [session, stats] = await Promise.allSettled([get('/api/intraday/session?' + p), get('/api/intraday/stats?' + query + '&v=' + version)]);
  if (request !== state.version) return;
  if (session.status === 'fulfilled') {
   const data = session.value;
   if (data.session !== state.data?.session) state.sheet = null;
   state.data = data;
   const value = select.value;
   select.replaceChildren(new Option(data.sessions.length ? '最新（' + data.sessions[0] + '）' : '最新', ''),
    ...data.sessions.map(day => new Option(day, day)));
   select.value = value;
  }
  if (stats.status === 'fulfilled') state.stats = stats.value;
  renderAll();
  const failed = [session, stats].filter(r => r.status === 'rejected');
  const t = parts('America/Los_Angeles', new Date());
  $('status').textContent = failed.length ? '部分数据加载失败（' + failed[0].reason.message + '），稍后自动重试。' :
   '更新于 ' + t.hour + ':' + t.minute + ' PT' + (isLive() ? ' · 盘中每分钟自动刷新' : '');
  if (!state.data && failed.length) $('chart').innerHTML = '<p class="empty">无法加载K线数据。</p>';
 };

 $('ts-toggle').addEventListener('click', () => { state.showTs = !state.showTs; if (state.data) renderGroups(); renderBoard(); renderEquity(); });
 $('groups').addEventListener('click', e => {
  const open = e.target.closest('[data-open]');
  if (open) return openSheet(open.dataset.open, Number(open.dataset.bar));
  const row = e.target.closest('.grow-main');
  if (!row) return;
  const k = row.dataset.key;
  state.expanded.has(k) ? state.expanded.delete(k) : state.expanded.add(k);
  renderGroups();
 });
 $('seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) selectGroup(b.dataset.key); });
 $('equity-legend').addEventListener('click', e => { const b = e.target.closest('button'); if (b) selectGroup(b.dataset.key); });
 $('strip').addEventListener('click', e => { const c = e.target.closest('.cell'); if (c && !c.disabled) openSheet(c.dataset.open, Number(c.dataset.bar)); });
 const marker = e => e.target.closest('.dm');
 $('chart').addEventListener('click', e => { const m = marker(e); if (m) openSheet(state.condition, Number(m.dataset.bar)); });
 $('chart').addEventListener('keydown', e => {
  const m = marker(e);
  if (m && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSheet(state.condition, Number(m.dataset.bar)); }
 });
 $('sheet').addEventListener('click', e => {
  if (e.target.id === 'sheet-close') { state.sheet = null; return renderSheet(); }
  if (e.target.id === 'sheet-more') { state.sheet.full = !state.sheet.full; return renderSheet(); }
  const step = e.target.closest('[data-step]');
  if (step) {
   const list = decisionsOf(state.sheet.key).map(x => x.bar);
   const next = list[list.indexOf(state.sheet.bar) + Number(step.dataset.step)];
   if (next) openSheet(state.sheet.key, next);
  }
 });
 document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.sheet) { state.sheet = null; renderSheet(); } });
 select.addEventListener('change', () => { state.sheet = null; refresh(); });
 let resizing;
 addEventListener('resize', () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => { if (state.data) renderChart(); renderEquity(); renderSheet(); }, 150);
 });

 const minutes = d => Number(d.hour) * 60 + Number(d.minute);
 const sessionOpen = d => {
  const today = d.year + '-' + d.month + '-' + d.day;
  return !['Sat', 'Sun'].includes(d.weekday) && minutes(d) >= 570 && minutes(d) < 965 &&
   !(state.data?.sessions[0] === today && state.data.latest_final);
 };
 const local = when => parts('America/New_York', when);
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

const recapCss = `
.rc-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.rc-date{font-size:26px;font-weight:700;margin:6px 0 2px;letter-spacing:-.3px;font-variant-numeric:tabular-nums}
.rc-date small{font-size:15px;font-weight:500;color:var(--muted);margin-left:6px}
.rc-type{margin:6px 0 0}.rc-type .pill{font-size:14px;padding:4px 12px;line-height:1.35}
.rc-change{font-size:16px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:8px}.rc-change .vs{font-size:13px;font-weight:400;color:var(--muted);margin-left:8px}
.kv.ohlc{grid-template-columns:repeat(4,1fr)}
.pager{display:flex;justify-content:space-between;gap:8px;margin-top:12px;font-size:14px}
.pager a,.pager span{padding:5px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);text-decoration:none;white-space:nowrap}
.pager span{opacity:.4}
.levels{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0;padding:0;list-style:none;font-size:12.5px}
.levels li{border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-variant-numeric:tabular-nums}.levels b{color:var(--level);margin-right:4px}
.history{list-style:none;margin:0;padding:0}
.history li{border-bottom:1px solid var(--line)}.history li:last-child{border-bottom:0}
.history a{display:flex;gap:10px;align-items:center;padding:9px 0;text-decoration:none;color:var(--ink)}
.history .d{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.history .t{flex:1;min-width:0;font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.history li[aria-current] .d::after{content:"（本页）";font-weight:400;color:var(--muted);font-size:12px}
.history .tag{width:9px;height:9px;border-radius:50%;flex:none;background:var(--flat)}.history .tag.long{background:var(--long)}.history .tag.short{background:var(--short)}
.rc-form{display:flex;gap:6px;align-items:center;margin-top:12px;font-size:14px;color:var(--muted)}
.rc-form input{width:5.5em;padding:4px 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;text-transform:uppercase}
.rc-form button{padding:4px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);cursor:pointer;color:var(--ink)}
.overall{border-color:var(--accent);background:linear-gradient(color-mix(in srgb,var(--accent) 7%,transparent),transparent),var(--card);border-width:1.5px}
.overall h2{color:var(--accent)}.overall .md{font-size:15px}.overall .md p,.overall .md ul{margin:4px 0}
.foot-meta{font-size:12px;color:var(--faint);margin:10px 0 0;overflow-wrap:anywhere}
`;

const WEEKDAYS = '日一二三四五六';
const weekday = day => '周' + WEEKDAYS[new Date(day + 'T12:00:00Z').getUTCDay()];
// Colour a free-text day type: bear-only → red, bull-only → green, otherwise neutral.
export function dayTone(dayType) {
 const t = String(dayType || '');
 const bear = /bear|空头|下跌|熊/i.test(t), bull = /bull|多头|上涨|牛/i.test(t);
 return bear && !bull ? 'short' : bull && !bear ? 'long' : 'flat';
}

// Newer recaps open with a "**整体判断**" section; pull it out for its own card.
export function splitOverall(markdown, title = '整体判断') {
 const lines = String(markdown ?? '').split(/\r?\n/);
 const start = lines.findIndex(line => line.trim() === '**' + title + '**');
 if (start < 0) return {overall: '', rest: String(markdown ?? '')};
 let end = start + 1;
 while (end < lines.length && !/^\s*(#{1,6}\s|\*\*[^*]+\*\*[:：]?\s*$|(-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[end])) end++;
 return {overall: lines.slice(start + 1, end).join('\n').trim(),
  rest: [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*\n/, '').trim()};
}

export function recapPage(symbol, history, recap, bars) {
 const q = '?symbol=' + encodeURIComponent(symbol);
 const link = day => '/recap/' + encodeURIComponent(day) + q;
 const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '');
 const f2 = v => isNum(v) ? v.toFixed(2) : '—';
 let content = '';
 if (recap) {
  const day = recap.session;
  const today = bars.filter(b => b.session === day);
  const prior = recap.prior?.close && recap.prior?.low ? recap.prior : priorLevels(bars, day);
  const i = history.findIndex(h => h.session === day);
  const older = i >= 0 ? history[i + 1] : undefined, newer = i > 0 ? history[i - 1] : undefined;
  let ohlc = '<p class="sub">这一天没有K线数据。</p>';
  if (today.length) {
   const o = today[0].open, c = today.at(-1).close;
   const h = Math.max(...today.map(b => b.high)), l = Math.min(...today.map(b => b.low));
   const ch = prior ? c - prior.close : null;
   ohlc = (prior ? '<div class="rc-change"><span class="' + tone(ch) + '">' + sign(ch) + Math.abs(ch).toFixed(2) + '（' + sign(ch) +
    Math.abs(ch / prior.close * 100).toFixed(2) + '%）</span><span class="vs">较昨收 ' + f2(prior.close) + '</span></div>' : '') +
    '<dl class="kv ohlc"><div><dt>开</dt><dd>' + f2(o) + '</dd></div><div><dt>高</dt><dd>' + f2(h) + '</dd></div>' +
    '<div><dt>低</dt><dd>' + f2(l) + '</dd></div><div><dt>收</dt><dd>' + f2(c) + '</dd></div></dl>';
  }
  const chart = liveChart(bars, {session: day, prior, annotations: recap.annotations || [], levels: recap.levels || [],
   viewWidth: 918, height: 440, minStep: 10});
  const levels = [...(recap.levels || [])].sort((a, b) => b.price - a.price);
  const {overall, rest: afterOverall} = splitOverall(stripPreamble(recap.markdown));
  const {overall: vooSignals, rest} = splitOverall(afterOverall, 'VOO 分批信号');
  content = `<section class="card" aria-labelledby="rc-title">
 <div class="rc-head"><h1 id="rc-title">${escapeHtml(symbol)} · 5分钟日内复盘</h1><span class="chip">收盘后生成</span></div>
 <div class="rc-date">${escapeHtml(day)}<small>${weekday(day)}</small></div>
 <div class="rc-type"><span class="pill soft ${dayTone(recap.day_type)}">${escapeHtml(recap.day_type)}</span></div>
 ${ohlc}
 <nav class="pager" aria-label="翻页">${older ? '<a href="' + link(older.session) + '">← 前一天 ' + escapeHtml(older.session.slice(5)) + '</a>' : '<span>← 前一天</span>'}${
  newer ? '<a href="' + link(newer.session) + '">后一天 ' + escapeHtml(newer.session.slice(5)) + ' →</a>' : '<span>后一天 →</span>'}</nav>
</section>
${overall ? `<section class="card overall" aria-labelledby="overall-title"><h2 id="overall-title">整体判断</h2>
 <div class="md">${renderMarkdown(overall)}</div></section>` : ''}
${vooSignals ? `<section class="card overall" aria-labelledby="voo-title"><h2 id="voo-title">VOO 分批信号</h2>
 <div class="md">${renderMarkdown(vooSignals)}</div><p class="sub">按固定规则计算的 Brooks 信号近似，仅供学习参考，不构成投资建议。</p></section>` : ''}
<section class="card" aria-labelledby="chart-title"><h2 id="chart-title">走势图</h2>
 <div class="chart-scroll">${chart}</div>
 <p class="legend"><span class="k"><b class="an">●</b> 红字：复盘标注</span><span class="k"><b class="lv">┄</b> 紫色虚线：关键价位（右侧紫字为价格，名称见下方）</span><span class="k">灰虚线：昨收/昨低</span><span class="k"><b class="em">—</b> 20均线</span><span>横轴：K线序号 + 太平洋时间；手机上可左右滑动。</span></p>
 ${levels.length ? '<h3>关键价位</h3><ul class="levels">' + levels.map(l => '<li><b>' + f2(l.price) + '</b>' + escapeHtml(l.label) + '</li>').join('') + '</ul>' : ''}
</section>
<section class="card" aria-labelledby="md-title"><h2 id="md-title">复盘全文</h2>
 <article class="md" lang="zh">${renderMarkdown(rest)}</article>
 <p class="foot-meta">由 ${escapeHtml(recap.model || '模型')} 按 Brooks 价格行为方法生成${recap.skill_sha ? ' · 方法版本 ' + escapeHtml(String(recap.skill_sha).slice(0, 7)) : ''}。仅供学习交流。</p>
</section>`;
 } else {
  content = `<section class="card"><div class="rc-head"><h1>${escapeHtml(symbol)} · 5分钟日内复盘</h1></div>
 <p class="empty">这个代码还没有复盘。复盘在每个交易日收盘后生成。</p></section>`;
 }
 const list = history.length ? '<ul class="history">' + history.map(h => '<li' + (h.session === recap?.session ? ' aria-current="page"' : '') +
  '><a href="' + link(h.session) + '"><i class="tag ' + dayTone(h.day_type) + '"></i><span class="d">' + escapeHtml(h.session) + ' ' + weekday(h.session) +
  '</span><span class="t">' + escapeHtml(h.day_type) + '</span></a></li>').join('') + '</ul>' : '<p class="empty">暂无。</p>';
 return pageShell({title: symbol + ' 日内复盘' + (recap ? ' · ' + recap.session : ''), current: 'recap', css: recapCss, body: content +
  `\n<section class="card" aria-labelledby="hist-title"><h2 id="hist-title">往期复盘</h2>${list}
 <form class="rc-form" action="/recap"><label for="rc-symbol">换个代码</label><input id="rc-symbol" name="symbol" value="${escapeHtml(symbol)}" maxlength="24" pattern="[A-Za-z0-9^=._\\-]{1,24}" required><button>查看</button>
 <a href="/intraday${q}" style="margin-left:auto">日内模拟仓 →</a></form>
</section>`});
}
