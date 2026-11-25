import {escapeHtml, isNum, levelsTag, num, pageShell, pill, renderMarkdown, scriptPrelude, stripPreamble} from './ui-common.js';

// Daily paper account: names and hints shared by the page script and the reading page.
const GROUP_NAMES = {skill: 'Claude + Brooks', baseline: 'Claude（不用 Brooks）', ema20: '均线规则（EMA20）',
 momentum20: '20日动量规则', buy_hold: '一直持有（参照）'};
const SYMBOL_HINTS = {SPY: '标普500', QQQ: '纳指100', IWM: '小盘股', DIA: '道指', TLT: '长期美债', GLD: '黄金'};

// Readings end with the machine-readable JSON block; the page shows those fields itself.
function cleanReading(text) {
 return stripPreamble(String(text || '').replace(/\n*```(?:json)?\s*\{[\s\S]*?```\s*$/i, ''));
}

const dailyCss = `
.ov-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.ov-label{font-size:13px;color:var(--muted);margin-top:8px}
.ov-big{font-size:26px;font-weight:700;margin:6px 0 0;letter-spacing:-.3px;font-variant-numeric:tabular-nums}
.ov-big small{font-size:14px;font-weight:500;color:var(--muted);margin-left:6px}
.summary{margin:10px 0 0;padding:10px 12px;border-radius:10px;background:var(--bg);font-size:14px}
.summary div{margin:2px 0}.summary .k{color:var(--muted);margin-right:6px}
.mx{border-collapse:separate;border-spacing:0;min-width:470px}
.mx thead tr:last-child th{white-space:normal;line-height:1.25;min-width:3.6em}
.mx th,.mx td{text-align:center;padding:7px 4px;white-space:nowrap}
.mx thead th{vertical-align:bottom}
.mx .grp th{border-bottom:0;padding-bottom:0;font-size:11px;color:var(--faint)}
.mx .grp th.ctl{border-top:1px dashed var(--line)}
.mx th:first-child,.mx td:first-child{position:sticky;left:0;z-index:1;background:var(--card);text-align:left;padding-right:10px;box-shadow:1px 0 0 var(--line)}
.mx td small{display:block;margin-top:3px;color:var(--muted);font-size:11.5px}
.mx td.ctl,.mx th.ctl{background:color-mix(in srgb,var(--bg) 55%,transparent)}
.mx tr.split td{background:var(--warn-soft)}
.mx tr.split td:first-child{background:linear-gradient(var(--warn-soft),var(--warn-soft)),var(--card)}
.mx .sym{font-weight:700;font-size:14px}.mx .hint2{display:block;font-size:11.5px;color:var(--muted);font-weight:400}
.mx tbody tr{cursor:pointer}
.tag{display:inline-block;font-size:11px;font-weight:600;color:var(--warn);background:var(--warn-soft);border-radius:4px;padding:0 5px;margin-left:4px;vertical-align:1px}
.mx tr.split .tag{background:var(--card)}
.ritem{border-bottom:1px solid var(--line);padding:10px 0}.ritem:last-child{border-bottom:0}
.rtop{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rtop .gname{font-weight:600;font-size:14px;flex:1;min-width:9em}
.rnums{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums;margin-top:4px}
.rnums b{color:var(--ink);font-weight:600}.rnums span{margin-right:12px;white-space:nowrap}
.ractions{display:flex;gap:14px;font-size:13px;margin-top:4px}
.cal td,.cal th{white-space:nowrap}
@media(min-width:700px){.mx{min-width:0}}
`;

export function dashboardPage() {
 return pageShell({title: '每日模拟仓 · Brooks Forward', current: 'daily', css: dailyCss, body: `<div id="proto" class="proto" aria-label="统计规则切换"></div>
<section class="card" id="overview" aria-labelledby="ov-title">
 <div class="ov-head"><h1 id="ov-title">今日概览 · 每日模拟仓</h1><span id="chip" class="chip">加载中…</span></div>
 <div class="ov-label">最新判断日（收盘后做出，针对下一个交易日）</div><div id="ov-big" class="ov-big">—</div>
 <p id="ov-meta" class="meta">正在读取数据…</p>
 <div id="ov-summary" class="summary"></div>
</section>
<section class="card" aria-labelledby="matrix-title"><h2 id="matrix-title">各组现在怎么看</h2>
 <div id="matrix" class="table-scroll"></div>
 <p class="hint">每格是该组对<b>下一个交易日</b>的方向：多 / 空 / 观望；「上涨 45%」是 Claude 估计 5 个交易日后收盘更高的概率。<span class="tag">分歧</span> 表示两个 Claude 组看法不同。点一行看判断原文。</p>
</section>
<section class="card" aria-labelledby="board-title"><div class="bhead"><h2 id="board-title">谁更准</h2><button id="ts-toggle" class="ts-btn" aria-pressed="false" hidden>显示执行目标/止损版</button></div>
 <div id="board" class="table-scroll"></div>
 <details class="adv-wrap"><summary>高级指标</summary><div id="adv"></div></details>
</section>
<section class="card" aria-labelledby="equity-title"><h2 id="equity-title">累计收益</h2>
 <div id="equity"></div><div id="equity-legend" class="chips" role="group" aria-label="高亮某一组"></div>
 <p class="hint">6 个 ETF 等权的组合收益，已扣交易成本；点下方标签高亮某一组。</p></section>
<section class="card" id="readings-card" aria-labelledby="readings-title"><h2 id="readings-title">最新判断</h2>
 <div id="symseg" class="seg" role="group" aria-label="选择代码"></div>
 <div id="readings"></div>
</section>
<details class="card help"><summary>怎么看这个页面</summary><ul>
 <li>每个交易日收盘后（太平洋时间 13:40 左右），各组看完当天的日线，决定<b>下一个交易日</b>该做多、做空还是观望（Brooks 说的 Always In 方向）。</li>
 <li><b>新规则 v2</b>（默认，从 2026-11-25 的判断开始统计）：收盘后的判断在<b>次日开盘价</b>成交，持有到再下一个交易日的开盘；要等那个开盘价出来才记一笔收益。没有判断、或判断写入时次日已开盘，当天算空仓。6 个 ETF 等权，观望就是不持仓。</li>
 <li><b>旧规则 v1</b>（?v=1）：按判断当天的收盘价进出、持有到下一个收盘。判断 13:40 PT 才开始做，那时收盘价已经买不到，所以成交价不可执行，仅供参考。两种规则用的是同一批判断记录。</li>
 <li>「执行目标/止损」版：方向和成交价相同，但当天K线碰到该判断的目标或止损就出场（同一根K线都碰到算止损，跳空按开盘价成交），之后空仓到下一次判断。没给或方向不对的价位不执行。</li>
 <li>每单位仓位变化扣 <span id="cost">2</span> 个基点（0.0<span id="cost2">2</span>%）交易成本，反手算两个单位；所有收益都已扣除。</li>
 <li>「5日方向准确率」看判断后第 5 个交易日的收盘价是否朝判断方向走，所以要等满 5 个交易日才有第一批结果（新规则对所有判断都是正好 5 天；旧规则遇到更长的判断期限会等更久）；观望不计入。</li>
 <li>「对照组」是不用 AI 的简单规则（20 日均线、20 日动量、一直持有）。Claude 组要长期跑赢它们才算有用。</li>
 <li>只有几天的数据时，收益和准确率主要是运气（噪声）；通常要几十个交易日、上百个已出结果的判断才值得参考。</li>
 <li>这里只是模拟记录，不是真实下单，不构成投资建议；与 Brooks Trading Course 无关。</li>
</ul></details>
<p id="status" class="status" role="status"></p>`,
  script: scriptPrelude([cleanReading]) + `\n(${loadDaily.toString()})(${JSON.stringify({GROUP_NAMES, SYMBOL_HINTS})})`});
}

// Kept for the router: the page is static, data comes from /api/stats and /api/predictions.
export const dashboard = dashboardPage();

async function loadDaily({GROUP_NAMES, SYMBOL_HINTS}) {
 const $ = id => document.getElementById(id);
 const GROUPS = [
  ['skill', 'Claude +Brooks', 'Claude 读日线，按 Brooks 价格行为方法判断下一天的方向，并估计 5 日上涨概率。'],
  ['baseline', 'Claude 无Brooks', '同一个 Claude，但不给 Brooks 方法，用来检验 Brooks 方法有没有加分。'],
  ['ema20', 'EMA20', '对照组：收盘价在 20 日均线上方就做多，下方就做空。'],
  ['momentum20', '动量', '对照组：比 20 个交易日前高就做多，低就做空。'],
  ['buy_hold', '持有', '对照组：一直做多，代表这 6 个 ETF 本身的涨跌。']
 ].map(([key, short, desc], i) => ({key, name: GROUP_NAMES[key], short, desc, control: i >= 2, color: 'var(--s' + (i + 1) + ')'}));
 const known = Object.fromEntries(GROUPS.map(g => [g.key, g]));
 const groupOf = key => known[key] || {key, name: key, short: key, desc: '', control: false, color: 'var(--faint)'};
 const ORDER = Object.keys(SYMBOL_HINTS);
 const symSort = (a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b);
 const WEEK = '日一二三四五六';
 const weekday = day => '周' + WEEK[new Date(day + 'T12:00:00Z').getUTCDay()];
 const get = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
 };
 const ptNow = () => Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: 'America/Los_Angeles',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
  .formatToParts(new Date()).map(p => [p.type, p.value]));
 const params = new URLSearchParams(location.search);
 const version = protocolVersion();
 const state = {showTs: false, stats: null, preds: [], latest: null, symbol: params.get('symbol'), selected: 'skill', open: new Set()};

 // Weekday calendar arithmetic on PT dates (holidays are not known here).
 const shift = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
 const isWeekday = day => ![0, 6].includes(new Date(day + 'T12:00:00Z').getUTCDay());
 function schedule() {
  const t = ptNow(), today = t.year + '-' + t.month + '-' + t.day, minutes = Number(t.hour) * 60 + Number(t.minute);
  let next = today;
  if (!isWeekday(next) || minutes >= 13 * 60 + 40) do next = shift(next, 1); while (!isWeekday(next));
  let expected = today;
  if (!isWeekday(expected) || minutes < 14 * 60 + 30) do expected = shift(expected, -1); while (!isWeekday(expected));
  const running = isWeekday(today) && minutes >= 13 * 60 + 40 && minutes < 14 * 60 + 30;
  return {today, next, expected, running};
 }

 const visible = () => GROUPS.filter(g => state.stats?.conditions?.[g.key] || state.preds.some(p => p.condition === g.key))
  .concat(Object.keys(state.stats?.conditions || {}).filter(k => !known[k] && !isTsKey(k)).map(groupOf));
 // Statistics rows, including the derived target/stop variants under their base group.
 const statRows = () => {
  const c = state.stats?.conditions || {};
  return visible().flatMap(g => [g, tsGroup(g)]).filter(g => c[g.key]).map(g => [g, c[g.key]]);
 };
 const emptyStats = text => version === 2 && state.stats?.protocol && !Object.keys(state.stats.conditions).length ? protocolEmpty(state.stats.protocol.from) : text;
 const latestRows = () => state.preds.filter(p => p.asof === state.latest);
 const findPred = (sym, key) => latestRows().find(p => p.symbol === sym && p.condition === key);
 const symbols = () => [...new Set(latestRows().map(p => p.symbol))].sort(symSort);
 const upText = p => p && !known[p.condition]?.control && isNum(p.p_up_5) ? '上涨 ' + Math.round(p.p_up_5 * 100) + '%' : '';
 const splitRow = sym => {
  const a = findPred(sym, 'skill'), b = findPred(sym, 'baseline');
  return !!(a && b && a.always_in !== b.always_in);
 };

 function renderOverview() {
  const s = state.stats, sc = schedule();
  const chip = $('chip');
  if (!state.latest) {
   chip.textContent = '还没有数据';
   chip.className = 'chip';
  } else if (state.latest >= sc.expected) {
   chip.textContent = '已更新';
   chip.className = 'chip live';
  } else if (sc.running) {
   chip.textContent = '正在更新';
   chip.className = 'chip warn';
  } else {
   chip.textContent = '可能延迟或休市';
   chip.className = 'chip warn';
  }
  $('ov-big').innerHTML = state.latest ? escapeHtml(state.latest) + '<small>' + weekday(state.latest) + '</small>' : '还没有判断';
  const days = s?.conditions?.skill?.account?.days ?? Math.max(0, ...Object.values(s?.conditions || {}).map(m => m.account.days));
  $('ov-meta').textContent = (version === 2 ? '新规则已运行 ' : '已运行 ') + (s?.days_running ?? '—') + ' 天 · 已结算 ' + (days || 0) + ' 个交易日 · ' +
   symbols().length + ' 个 ETF · ' + visible().length + ' 组';
  const lines = ['<div><span class="k">更新时间</span>每个交易日收盘后 13:40 PT 更新</div>',
   '<div><span class="k">下次更新</span>' + sc.next.slice(5) + '（' + weekday(sc.next) + '）13:40 PT 左右</div>'];
  const lead = latestRows().filter(p => p.condition === 'skill');
  if (lead.length) {
   const count = side => lead.filter(p => (p.always_in === 'long' ? 'long' : p.always_in === 'short' ? 'short' : 'flat') === side).length;
   const splits = symbols().filter(splitRow);
   lines.push('<div><span class="k">Claude + Brooks</span><b class="pos">多 ' + count('long') + '</b> · <b class="neg">空 ' +
    count('short') + '</b> · 观望 ' + count('flat') +
    (splits.length ? ' · 与不用 Brooks 的 Claude 分歧：' + splits.map(escapeHtml).join('、') : '') + '</div>');
  }
  $('ov-summary').innerHTML = lines.join('');
 }

 function renderMatrix() {
  const groups = visible(), syms = symbols();
  if (!syms.length) { $('matrix').innerHTML = '<p class="empty">还没有判断。</p>'; return; }
  const claude = groups.filter(g => !g.control), ctl = groups.filter(g => g.control);
  let html = '<table class="mx"><thead><tr class="grp"><th></th>' + (claude.length ? '<th colspan="' + claude.length + '">Claude</th>' : '') +
   (ctl.length ? '<th class="ctl" colspan="' + ctl.length + '">对照组</th>' : '') + '</tr><tr><th>代码</th>' +
   groups.map(g => '<th' + (g.control ? ' class="ctl"' : '') + '><i class="dot" style="background:' + g.color + '"></i>' + escapeHtml(g.short) + '</th>').join('') + '</tr></thead><tbody>';
  for (const sym of syms) {
   const split = splitRow(sym);
   html += '<tr data-sym="' + escapeHtml(sym) + '"' + (split ? ' class="split"' : '') + '><td><span class="sym">' + escapeHtml(sym) + '</span>' +
    (split ? '<span class="tag">分歧</span>' : '') + '<span class="hint2">' + escapeHtml(SYMBOL_HINTS[sym] || '') + '</span></td>' +
    groups.map(g => {
     const p = findPred(sym, g.key);
     return '<td' + (g.control ? ' class="ctl"' : '') + '>' + (p ? pill(p.always_in, true) + (upText(p) ? '<small>' + upText(p) + '</small>' : '') : '—') + '</td>';
    }).join('') + '</tr>';
  }
  $('matrix').innerHTML = html + '</tbody></table>';
 }

 function renderBoard() {
  const s = state.stats;
  if (!s) return;
  $('cost').textContent = s.cost_bps;
  $('cost2').textContent = s.cost_bps;
  const every = statRows().sort((a, b) => (b[1].account.total_return ?? -1) - (a[1].account.total_return ?? -1));
  tsToggle($('ts-toggle'), every, state.showTs);
  const rows = tsRows(every, state.showTs);
  if (!rows.length) { $('board').innerHTML = emptyStats('<p class="empty">还没有统计数据。</p>'); $('adv').innerHTML = ''; return; }
  const samples = m => Math.round((m.direction_coverage || 0) * (m.mature || 0));
  let few = false;
  const pending = Math.max(...rows.map(([, m]) => m.pending_5 || 0));
  const noneMature = rows.every(([, m]) => !m.mature);
  $('board').innerHTML = '<table><thead><tr><th>组别</th><th>累计收益</th><th>最大回撤</th><th>5日准确率<small>（样本数）</small></th><th>天数</th></tr></thead><tbody>' +
   rows.map(([g, m]) => {
    const n = samples(m), small = n < 100;
    few = few || (small && n > 0);
    const acc = isNum(m.direction_hit_rate) ? '<span' + (small ? ' class="few"' : '') + '>' + ratio(m.direction_hit_rate) + (small ? '*' : '') + '</span>' : '<span class="few">待定</span>';
    return '<tr' + (g.ts ? ' class="ts-row"' : '') + '><td class="gcell"><i class="dot" style="background:' + g.color + '"></i>' + escapeHtml(g.name) + (g.control ? ' <small>对照组</small>' : '') + '</td>' +
     '<td class="' + tone(m.account.total_return) + '">' + pct(m.account.total_return) + '</td>' +
     '<td>' + drawdown(m.account.max_drawdown) + '</td>' +
     '<td>' + acc + '<small>（' + n + '）</small></td><td>' + m.account.days + '</td></tr>';
   }).join('') + '</tbody></table>' +
   (few ? '<p class="note-gray">* 样本太少，仅供参考（已出结果的多/空判断少于 100 个）。</p>' : '') +
   (version === 2 && rows.every(([, m]) => !m.account.days) ? '<p class="note-gray">已有判断，但还没有可结算的收益：要等次日和再下一个交易日的开盘价。</p>' : '') +
   (noneMature ? '<p class="note-gray">5日方向准确率要等判断后满 5 个交易日才出结果，目前还没有（每组约 ' + pending + ' 个判断在等待）。</p>' :
    '<p class="note-gray">5日方向准确率只统计满 5 个交易日的判断；更新的判断还在等待。</p>') +
   '<p class="note-gray">按累计收益排序。方向准确率 = 做多/做空后第 5 个交易日收盘价方向猜对的比例，观望不计入。</p>';
  renderAdvanced(rows);
 }

 function renderAdvanced(rows) {
  const s = state.stats;
  const cols = [['判断数', 'predictions', v => v], ['夏普', m => m.account.annualized_sharpe, v => num(v)],
   ['持仓时间', m => m.account.exposure, v => ratio(v, 0)], ['覆盖率', 'direction_coverage', v => ratio(v, 0)],
   ['Brier', 'brier', v => num(v, 3)], ['Log loss', 'log_loss', v => num(v, 3)],
   ['目标先到', 'target_before_stop_rate', v => ratio(v, 0)], ['已出结果', 'mature', v => v],
   ['待定5日', 'pending_5', v => v], ['待定目标/止损', 'pending_horizon', v => v], ['缺K线', 'missing_bars', v => v],
   ...(version === 2 ? [['迟到判断', 'late', v => v ?? '—'], ['目标/止损出场', m => isNum(m.target_exits) ? m.target_exits + '/' + m.stop_exits : '—', v => v], ['忽略价位', 'levels_ignored', v => v ?? '—']] : [])];
  const pick = (m, k) => typeof k === 'function' ? k(m) : m[k];
  let html = '<div class="table-scroll"><table class="wide"><thead><tr><th>组别</th>' + cols.map(c => '<th>' + c[0] + '</th>').join('') + '</tr></thead><tbody>' +
   rows.map(([g, m]) => '<tr><td>' + escapeHtml(g.short) + '</td>' + cols.map(c => '<td>' + c[2](pick(m, c[1])) + '</td>').join('') + '</tr>').join('') +
   '</tbody></table></div><div class="defs">' + [
    ['判断数', '记录下来的判断次数（每个 ETF 每个交易日一次）。'],
    ['夏普', '年化夏普比率：平均日收益除以波动，越高越好；交易日少于几十天时基本没有意义。'],
    ['持仓时间（Exposure）', '有仓位（多或空）的时间占比；观望时为 0。'],
    ['覆盖率（Coverage）', '已出结果的判断中，给出明确做多/做空（而不是观望）的比例。'],
    ['Brier', '「上涨概率」的准确度，越小越好；<0.25 才比瞎猜（永远 50%）好。'],
    ['Log loss', '概率的对数损失，越小越好；<0.693 才比瞎猜好，过度自信会被重罚。'],
    ['目标先到', '给了目标价和止损的判断里，在判断期限内先碰到目标的比例。'],
    ['已出结果', '已满 5 个交易日、可以判断对错的判断数。'],
    ['待定5日', '还没满 5 个交易日、暂时无法判对错的判断数。'],
    ['待定目标/止损', '还没走完判断期限、目标和止损都无法下结论的判断数。'],
    ['缺K线', '找不到判断当天K线的判断数（正常应为 0）。'],
    ...(version === 2 ? [['迟到判断', '写入时次日已经开盘、不能按开盘价成交的判断数（当天算空仓）。'],
     ['目标/止损出场', '「执行目标/止损」版里碰到目标 / 碰到止损出场的次数。'],
     ['忽略价位', '「执行目标/止损」版里没给、或相对成交价方向不对而不执行的目标/止损个数。']] : [])
   ].map(([k, v]) => '<div><b>' + k + '：</b>' + v + '</div>').join('') + '</div>';
  // Per symbol: cumulative return plus 5-day accuracy for each group.
  const per = s.per_symbol || {};
  const syms = [...new Set(Object.values(per).flatMap(o => Object.keys(o)))].sort(symSort);
  if (syms.length) {
   html += '<h3>分代码表现</h3><div class="table-scroll"><table class="wide"><thead><tr><th>代码</th>' +
    rows.map(([g]) => '<th>' + escapeHtml(g.short) + '</th>').join('') + '</tr></thead><tbody>' +
    syms.map(sym => '<tr><td>' + escapeHtml(sym) + ' <small>' + escapeHtml(SYMBOL_HINTS[sym] || '') + '</small></td>' + rows.map(([g]) => {
     const m = per[g.key]?.[sym];
     if (!m) return '<td>—</td>';
     const n = Math.round((m.direction_coverage || 0) * (m.mature || 0));
     return '<td><span class="' + tone(m.account.total_return) + '">' + pct(m.account.total_return) + '</span><small>准确率 ' +
      (isNum(m.direction_hit_rate) ? ratio(m.direction_hit_rate, 0) : '待定') + '（' + n + '）</small></td>';
    }).join('') + '</tr>').join('') + '</tbody></table></div><p class="note-gray">每格：该代码的累计收益，下方是 5 日方向准确率（样本数）。</p>';
  }
  // Paired: the two Claude groups against each rule, on the same symbol/date pairs only.
  const pairs = [];
  for (const [g] of rows) if (!g.control && !g.ts) for (const [base, p] of Object.entries(s.paired?.[g.key] || {})) if (p.n) pairs.push([g, groupOf(base), p]);
  if (pairs.length) {
   const diff = (v, better) => '<td class="' + (isNum(v) ? tone(better * v) : '') + '">' + (isNum(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(3) : '—') + '</td>';
   html += '<h3>配对比较（只比两组都有判断的同一代码、同一天）</h3><div class="table-scroll"><table class="wide"><thead><tr><th>组别</th><th>对比</th><th>配对数</th><th>准确率差</th><th>Brier差</th><th>Log loss差</th></tr></thead><tbody>' +
    pairs.map(([g, b, p]) => '<tr><td>' + escapeHtml(g.short) + '</td><td>' + escapeHtml(b.short) + '</td><td>' + p.n + '</td><td class="' + tone(p.delta.direction_hit_rate) + '">' +
     pct(p.delta.direction_hit_rate, 1) + '</td>' + diff(p.delta.brier, -1) + diff(p.delta.log_loss, -1) + '</tr>').join('') +
    '</tbody></table></div><p class="note-gray">准确率差为正、Brier/Log loss 差为负，表示左边的组更好；结果出来前显示「—」。</p>';
  }
  // Calibration: when Claude says 60%, does it go up ~60% of the time?
  const cal = rows.filter(([g]) => !g.control && !g.ts).flatMap(([g, m]) => (m.calibration || []).filter(b => b.n).map(b => [g, b]));
  html += '<h3>概率校准</h3>' + (cal.length ? '<div class="table-scroll"><table class="cal"><thead><tr><th>组别</th><th>预测上涨概率</th><th>样本</th><th>平均预测</th><th>实际上涨</th></tr></thead><tbody>' +
   cal.map(([g, b]) => '<tr><td>' + escapeHtml(g.short) + '</td><td>' + b.bucket * 10 + '–' + (b.bucket + 1) * 10 + '%</td><td>' + b.n + '</td><td>' +
    ratio(b.mean_probability, 0) + '</td><td>' + ratio(b.observed_up, 0) + '</td></tr>').join('') + '</tbody></table></div>' :
   '<p class="note-gray">还没有已出结果的判断。校准是看「说 60% 会涨」时，实际是否约 60% 上涨。</p>');
  html += '<p class="note-gray">交易成本：每单位仓位变化 ' + s.cost_bps + ' 个基点。</p>';
  $('adv').innerHTML = html;
 }

 function renderEquity() {
  const s = state.stats;
  if (!s) return;
  const groups = tsRows(statRows(), state.showTs).map(row => row[0]);
  if (!groups.some(g => g.key === state.selected) && groups.length) state.selected = groups[0].key;
  drawEquity($('equity'), groups.map(g => ({key: g.key, name: g.short, color: g.color, dash: g.ts, curve: s.conditions[g.key].account.equity_curve})), state.selected);
  if (!groups.length) $('equity').innerHTML = emptyStats($('equity').innerHTML);
  $('equity-legend').innerHTML = groups.map(g => '<button data-key="' + escapeHtml(g.key) + '" aria-pressed="' + (g.key === state.selected) + '"><span class="sw" style="background:' +
   g.color + '"></span>' + escapeHtml(g.short) + ' ' + pct(s.conditions[g.key].account.total_return) + '</button>').join('');
 }

 function renderReadings() {
  const syms = symbols();
  if (!syms.length) { $('symseg').innerHTML = ''; $('readings').innerHTML = '<p class="empty">还没有判断。</p>'; return; }
  if (!syms.includes(state.symbol)) state.symbol = syms[0];
  $('symseg').innerHTML = syms.map(sym => '<button data-sym="' + escapeHtml(sym) + '" aria-pressed="' + (sym === state.symbol) + '">' + escapeHtml(sym) +
   (splitRow(sym) ? ' <span class="tag">分歧</span>' : '') + '</button>').join('');
  const sym = state.symbol;
  let html = '<p class="sub">' + escapeHtml(sym) + ' ' + escapeHtml(SYMBOL_HINTS[sym] || '') + ' · ' + escapeHtml(state.latest) + ' 收盘后 · 收盘价 ' +
   num(latestRows().find(p => p.symbol === sym)?.close) + '</p>';
  let controls = false;
  for (const g of visible()) {
   const p = findPred(sym, g.key);
   if (g.control && !controls) { controls = true; html += '<div class="ghead">对照组 · 简单规则，用来比较</div>'; }
   if (!p) { html += '<div class="ritem"><div class="rtop"><span class="gname"><i class="dot" style="background:' + g.color + '"></i>' + escapeHtml(g.name) + '</span>—</div></div>'; continue; }
   const reading = g.control ? '' : cleanReading(p.reading);
   const open = state.open.has(p.id);
   const nums = [];
   if (upText(p)) nums.push('<span>5日上涨概率 <b>' + Math.round(p.p_up_5 * 100) + '%</b></span>');
   if (isNum(p.target)) nums.push('<span>目标 <b class="pos">' + num(p.target) + '</b></span>');
   if (isNum(p.stop)) nums.push('<span>止损 <b class="neg">' + num(p.stop) + '</b></span>');
   html += '<div class="ritem"><div class="rtop"><span class="gname"><i class="dot" style="background:' + g.color + '"></i>' + escapeHtml(g.name) + '</span>' + pill(p.always_in) + levelsTag(p) + '</div>' +
    (nums.length ? '<div class="rnums">' + nums.join('') + '</div>' : '') +
    (reading ? '<div class="reading' + (open ? ' full' : '') + '">' + renderMarkdown(reading) + '</div><div class="ractions"><button class="link" data-more="' + p.id + '">' +
     (open ? '收起' : '展开全文') + '</button><a href="/reading/' + encodeURIComponent(p.id) + '">单独打开</a></div>' :
     '<div class="rnums">' + escapeHtml(g.desc) + '</div>') + '</div>';
  }
  $('readings').innerHTML = html;
 }

 function renderAll() {
  $('proto').innerHTML = protocolBar(version);
  renderOverview();
  renderMatrix();
  renderBoard();
  renderEquity();
  renderReadings();
 }

 $('ts-toggle').addEventListener('click', () => { state.showTs = !state.showTs; renderBoard(); renderEquity(); });
 $('matrix').addEventListener('click', e => {
  const row = e.target.closest('tr[data-sym]');
  if (!row) return;
  state.symbol = row.dataset.sym;
  renderReadings();
  $('readings-card').scrollIntoView({behavior: 'smooth', block: 'start'});
 });
 $('symseg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { state.symbol = b.dataset.sym; renderReadings(); } });
 $('readings').addEventListener('click', e => {
  const b = e.target.closest('[data-more]');
  if (!b) return;
  const id = Number(b.dataset.more);
  state.open.has(id) ? state.open.delete(id) : state.open.add(id);
  renderReadings();
 });
 $('equity-legend').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { state.selected = b.dataset.key; renderEquity(); } });
 let resizing;
 addEventListener('resize', () => { clearTimeout(resizing); resizing = setTimeout(renderEquity, 150); });

 const [stats, preds] = await Promise.allSettled([get('/api/stats?v=' + version), get('/api/predictions?limit=60')]);
 if (stats.status === 'fulfilled') state.stats = stats.value;
 if (preds.status === 'fulfilled') {
  state.preds = preds.value.predictions || [];
  state.latest = state.preds.map(p => p.asof).sort().at(-1) || null;
 }
 renderAll();
 const failed = [stats, preds].filter(r => r.status === 'rejected');
 const t = ptNow();
 $('status').textContent = failed.length ? '部分数据加载失败（' + failed[0].reason.message + '），请稍后刷新。' : '页面数据读取于 ' + t.hour + ':' + t.minute + ' PT';
}

export function readingPage(p) {
 const name = GROUP_NAMES[p.condition] || p.condition;
 const reading = cleanReading(p.reading);
 const hint = SYMBOL_HINTS[p.symbol] ? ' ' + SYMBOL_HINTS[p.symbol] : '';
 return pageShell({title: p.symbol + ' ' + p.asof + ' · ' + name, current: 'daily', body: `<section class="card">
 <h1>${escapeHtml(p.symbol + hint)} · ${escapeHtml(p.asof)} 收盘后的判断</h1>
 <h2 style="margin:8px 0 4px">${escapeHtml(name)}</h2>
 <div>${pill(p.always_in)}${levelsTag(p)}</div>
 <dl class="kv"><div><dt>5日上涨概率</dt><dd>${isNum(p.p_up_5) ? Math.round(p.p_up_5 * 100) + '%' : '—'}</dd></div><div><dt>判断时收盘价</dt><dd>${num(p.close)}</dd></div>
 <div><dt>目标</dt><dd class="pos">${num(p.target)}</dd></div><div><dt>止损</dt><dd class="neg">${num(p.stop)}</dd></div></dl>
 <p class="sub">模型：${escapeHtml(p.model)} · 方法版本：${escapeHtml(String(p.skill_sha ?? '').slice(0, 7))} · <a href="/">← 返回每日模拟仓</a></p>
</section>
<section class="card"><h2>判断原文</h2><article class="md" lang="zh">${reading ? renderMarkdown(reading) : '<p class="sub">机械规则，没有文字解读。</p>'}</article></section>`});
}
