import {buildOverlay, candles, escapeHtml, liveChart, priorLevels, ptClock} from './intraday-chart.js';

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


const lightVars = `--bg:#f5f5f3;--card:#fff;--ink:#1c1c1a;--muted:#5f5e59;--faint:#8b8a85;--line:#e3e2dd;--accent:#2a6fc4;
--long:#14824b;--short:#c43a3a;--flat:#7b7a75;--long-soft:rgba(20,130,75,.13);--short-soft:rgba(196,58,58,.12);--flat-soft:rgba(123,122,117,.15);
--ema:#2a78d6;--candle-up:#fff;--pill-ink:#fff;--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--s6:#6250d6`;
const darkVars = `color-scheme:dark;--bg:#121211;--card:#1d1d1b;--ink:#eceae5;--muted:#aeada6;--faint:#86857f;--line:#353431;--accent:#6aa5ee;
--long:#3dbd78;--short:#f06c6c;--flat:#9b9a94;--long-soft:rgba(61,189,120,.16);--short-soft:rgba(240,108,108,.15);--flat-soft:rgba(155,154,148,.16);
--ema:#5598e7;--candle-up:#1d1d1b;--pill-ink:#111;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--s6:#9085e9`;

const intradayCss = `
:root{color-scheme:light;${lightVars}}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){${darkVars}}}
:root[data-theme=dark]{${darkVars}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-text-size-adjust:100%}
a{color:var(--accent)}button{font:inherit;color:inherit}
.top{max-width:980px;margin:auto;padding:10px 16px 0;font-size:14px;color:var(--muted)}.top a{margin-right:12px;text-decoration:none}.top a[aria-current]{color:var(--ink);font-weight:600}
main{max-width:980px;margin:auto;padding:8px 16px 40px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:0 0 12px}
h1{font-size:15px;margin:0;font-weight:600;color:var(--muted)}
h2{font-size:17px;margin:0 0 10px}
.hint,.legend,.meta,.status{color:var(--muted);font-size:13px;margin:8px 0 0}
.pos{color:var(--long)}.neg{color:var(--short)}
.ov-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.ov-head form{display:flex;gap:6px;align-items:center}
.ov-head input{width:5.5em;padding:4px 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;text-transform:uppercase}
.ov-head button,.ov-foot select{padding:4px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);cursor:pointer;color:var(--ink);font:inherit}
.chip{font-size:12px;padding:3px 10px;border-radius:999px;background:var(--flat-soft);color:var(--muted);white-space:nowrap}
.chip.live{background:var(--long-soft);color:var(--long)}.chip.live::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:currentColor;margin-right:6px;vertical-align:1px}
.ov-price{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:8px}
.price{font-size:34px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
.change{font-size:16px;font-weight:600;font-variant-numeric:tabular-nums}.change .vs{font-size:13px;font-weight:400;color:var(--muted);margin-left:8px}
.summary{margin:10px 0 0;padding:10px 12px;border-radius:10px;background:var(--bg);font-size:15px}
.summary .k{color:var(--muted);font-size:13px;display:block;margin-bottom:2px}.summary .dt{overflow-wrap:anywhere}
.ov-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:14px;color:var(--muted)}
.pill{display:inline-block;min-width:3.2em;text-align:center;padding:2px 9px;border-radius:999px;font-size:13px;font-weight:600;color:var(--pill-ink);white-space:nowrap}
.pill.long{background:var(--long)}.pill.short{background:var(--short)}.pill.flat{background:var(--flat)}
.ghead{font-size:12px;color:var(--muted);margin:12px 0 4px;padding-top:8px;border-top:1px dashed var(--line)}
.grow{border-bottom:1px solid var(--line)}.grow:last-child{border-bottom:0}
.grow-main{display:grid;grid-template-columns:1fr auto 4.6em 4.6em;gap:8px;align-items:center;width:100%;padding:9px 0 2px;border:0;background:none;text-align:left;cursor:pointer}
.gname{font-weight:600;font-size:14px;line-height:1.3}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:1px}
.gnum{text-align:right;font-variant-numeric:tabular-nums;line-height:1.2}.gnum small{display:block;color:var(--muted);font-size:11px}.gnum b{font-size:14px}
.gdesc{font-size:12.5px;color:var(--muted);padding:0 0 8px 15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.grow.open .gdesc{white-space:normal}
.gmore{font-size:13px;padding:0 0 10px 15px}
.link{border:0;background:none;color:var(--accent);padding:0;cursor:pointer;text-decoration:underline}
.seg{display:flex;gap:4px;overflow-x:auto;padding:3px;background:var(--bg);border-radius:10px;margin-bottom:10px;scrollbar-width:none}
.seg button{flex:1 0 auto;border:0;background:none;padding:6px 10px;border-radius:8px;font-size:14px;cursor:pointer;color:var(--muted);white-space:nowrap}
.seg button[aria-pressed=true]{background:var(--card);color:var(--ink);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.18)}
.chart-scroll,.strip-scroll,.table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
svg.live{display:block}
svg text{font:11px system-ui,-apple-system,sans-serif;fill:var(--muted)}
svg .grid{stroke:var(--line);stroke-width:1}svg .baseline{stroke:var(--faint)}svg .tick{stroke:var(--faint)}
svg .axis.sub{fill:var(--faint);font-size:10px}
.candle path{stroke:var(--ink);stroke-width:1}.candle rect{stroke:var(--ink);stroke-width:1}
.candle.up rect{fill:var(--candle-up)}.candle.down rect{fill:var(--ink)}
.ema{fill:none;stroke:var(--ema);stroke-width:2}
.shade-long{fill:var(--long-soft)}.shade-short{fill:var(--short-soft)}
.guide{fill:none;stroke-width:1.3}.g-prior{stroke:var(--faint);fill:var(--muted)}.g-target{stroke:var(--long);fill:var(--long)}.g-stop{stroke:var(--short);fill:var(--short)}
.glabel{font-weight:600;stroke:var(--card);stroke-width:3px;paint-order:stroke;stroke-linejoin:round}
.lastline{stroke:var(--ink);stroke-width:1;stroke-dasharray:1 3}
.pricetag{fill:var(--ink)}.pricetag-text{fill:var(--card);font-weight:700;font-size:12px}
.dm{cursor:pointer;outline:none}.dm .hit{fill:transparent}
.dm path,.dm circle{stroke:var(--card);stroke-width:1.5}
.dm-long path{fill:var(--long)}.dm-short path{fill:var(--short)}.dm-flat circle{fill:var(--card);stroke:var(--flat);stroke-width:2}
.dm.active path,.dm.active circle,.dm:focus-visible path,.dm:focus-visible circle{stroke:var(--ink);stroke-width:2.5}
.legend .k{white-space:nowrap;margin-right:10px;display:inline-block}
.legend .up{color:var(--long)}.legend .dn{color:var(--short)}.legend .fl{color:var(--flat)}.legend .em{color:var(--ema)}
.strip{display:grid;gap:4px 3px;align-items:center;width:max-content;padding-right:8px}
.strip .sl{position:sticky;left:0;background:var(--card);font-size:12.5px;padding-right:8px;white-space:nowrap;z-index:1}
.strip .sh{font-size:10.5px;color:var(--faint);white-space:nowrap;overflow:visible;height:14px}
.cell{width:16px;height:16px;border-radius:3px;border:0;padding:0;cursor:pointer}
.cell.c-long{background:var(--long)}.cell.c-short{background:var(--short)}.cell.c-flat{background:var(--flat);opacity:.55}
.cell.c-miss{background:none;border:1.5px solid var(--faint)}.cell.c-none{background:var(--bg);cursor:default}
.cell.sel{outline:2px solid var(--ink);outline-offset:1px}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:-1px;margin-right:3px}
table{border-collapse:collapse;width:100%;font-size:13.5px;font-variant-numeric:tabular-nums}
th,td{padding:8px 4px;border-bottom:1px solid var(--line);text-align:right;vertical-align:middle}
th{font-size:12px;color:var(--muted);font-weight:500;line-height:1.25}th small{display:block;font-size:11px}th:last-child{white-space:nowrap}
th:first-child,td:first-child{text-align:left}
td.gcell{font-size:13px;line-height:1.3}
td .few{color:var(--faint)}td small{color:var(--muted);font-size:11px;display:block}
.note-gray{color:var(--faint);font-size:12.5px;margin:8px 0 0}
details>summary{cursor:pointer;font-weight:600;padding:4px 0}
#advanced{margin-top:12px;border-top:1px solid var(--line);padding-top:8px}
#adv table{min-width:640px}#adv td,#adv th{white-space:nowrap}
.defs{font-size:13px;color:var(--muted);margin:10px 0 0;padding:0}
.defs div{margin:4px 0}.defs b{color:var(--ink);font-weight:600}
h3{font-size:14px;margin:14px 0 6px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chips button{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:3px 10px;font-size:12.5px;cursor:pointer}
.chips button[aria-pressed=true]{border-color:var(--ink);font-weight:600}
svg.eq .zero{stroke:var(--faint)}svg.eq .ln{fill:none;stroke-linejoin:round;stroke-linecap:round}
.help ul{margin:8px 0 0;padding-left:20px;font-size:14px}.help li{margin:5px 0}
.disclaimer{font-size:12px;color:var(--faint);text-align:center;margin:16px 0}
.sheet{position:fixed;left:0;right:0;bottom:0;max-height:72vh;overflow:auto;background:var(--card);border-top:1px solid var(--line);border-radius:16px 16px 0 0;box-shadow:0 -6px 28px rgba(0,0,0,.25);padding:6px 16px 20px;z-index:10;max-width:720px;margin:auto}
.sheet-head{display:flex;align-items:center;justify-content:space-between;gap:8px;position:sticky;top:-6px;background:var(--card);padding:8px 0}
.sheet-head h3{margin:0;font-size:16px}
.sheet-head button{border:0;background:var(--bg);border-radius:50%;width:32px;height:32px;font-size:20px;line-height:1;cursor:pointer}
.sub{color:var(--muted);font-size:13px;margin:0 0 8px}
.kv{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.kv div{background:var(--bg);border-radius:8px;padding:6px 10px}
.kv dt{font-size:12px;color:var(--muted)}.kv dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}
.reading{font-size:14px;overflow-wrap:anywhere;max-height:7.5em;overflow:hidden;position:relative;border-top:1px solid var(--line);margin-top:8px}
.reading.full{max-height:none}.reading:not(.full)::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2.5em;background:linear-gradient(transparent,var(--card))}
.reading h2,.reading h3,.reading h4{font-size:14px;margin:8px 0 4px}.reading p,.reading ul,.reading ol{margin:6px 0}
.navrow{display:flex;justify-content:space-between;margin-top:12px}
.navrow button{border:1px solid var(--line);background:var(--bg);border-radius:8px;padding:5px 12px;cursor:pointer}
.navrow button:disabled{opacity:.4;cursor:default}
.empty{color:var(--muted);padding:16px}
@media(min-width:700px){.price{font-size:40px}.grow-main{grid-template-columns:1fr auto 6em 6em}}
`;

export function intradayPage() {
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>日内模拟仓 · Brooks Forward</title>
<style>${intradayCss}</style>
<header class="top"><nav aria-label="页面"><a href="/">每日</a><a href="/intraday" aria-current="page">日内</a><a href="/recap">复盘</a></nav></header>
<main>
<section class="card" id="overview" aria-labelledby="ov-title">
 <div class="ov-head"><h1 id="ov-title">今日概览 · 5分钟模拟仓</h1><span id="chip" class="chip">加载中…</span></div>
 <div class="ov-price"><span id="last-price" class="price">—</span><span id="change" class="change"></span></div>
 <p id="ov-meta" class="meta"></p>
 <div id="ov-summary" class="summary">正在读取数据…</div>
 <div class="ov-foot">
  <form id="symbol-form" action="/intraday" class="ov-head"><input id="symbol" name="symbol" value="SPY" maxlength="24" aria-label="代码" required><button>查看</button></form>
  <label>交易日 <select id="session"><option value="">最新</option></select></label>
  <a id="recap" href="/recap">今日复盘 →</a>
 </div>
</section>
<section class="card" aria-labelledby="groups-title"><h2 id="groups-title">各组现在怎么看</h2>
 <div id="groups"></div><p class="hint">点一行展开说明。盈亏已扣交易成本；「累计」是所有交易日连乘。</p></section>
<section class="card" aria-labelledby="chart-title"><h2 id="chart-title">走势图</h2>
 <div id="seg" class="seg" role="group" aria-label="选择在图上显示哪一组"></div>
 <div id="chart" class="chart-scroll"></div>
 <p class="legend"><span class="k"><b class="up">▲</b>做多 <b class="dn">▼</b>做空 <b class="fl">○</b>观望（点标记看详情）</span><span class="k"><span class="sw" style="background:var(--long-soft)"></span>持多 <span class="sw" style="background:var(--short-soft)"></span>持空</span><span class="k"><b class="em">—</b> 20均线</span><span>虚线：昨收/昨低、目标/止损。</span><span>横轴：K线序号 + 太平洋时间</span></p>
</section>
<section class="card" aria-labelledby="strip-title"><h2 id="strip-title">观点时间轴</h2>
 <div id="strip" class="strip-scroll"></div>
 <p class="legend"><span class="k"><span class="sw" style="background:var(--long)"></span>做多</span><span class="k"><span class="sw" style="background:var(--short)"></span>做空</span><span class="k"><span class="sw" style="background:var(--flat);opacity:.55"></span>观望</span><span class="k"><span class="sw" style="border:1.5px solid var(--faint)"></span>漏掉（没按时运行）</span><br>每格是一个 15 分钟判断点，点格子看详情；上方是判断时刻（太平洋时间）。</p>
</section>
<section class="card" aria-labelledby="board-title"><h2 id="board-title">谁更准</h2>
 <div id="board" class="table-scroll"></div>
 <details id="advanced"><summary>高级指标</summary><div id="adv"></div></details>
</section>
<section class="card" aria-labelledby="equity-title"><h2 id="equity-title">累计收益</h2>
 <div id="equity"></div><div id="equity-legend" class="chips" role="group" aria-label="高亮某一组"></div></section>
<details class="card help"><summary>怎么看这个页面</summary><ul>
 <li>开盘后每 15 分钟（第 3、6、9…根 5 分钟K线收盘时）每组给出一次判断：做多、做空或观望。</li>
 <li>判断出来后，在<b>下一根K线的开盘价</b>模拟成交；观望就是不持仓。</li>
 <li>收盘时（最后一根K线收盘价）全部平仓，不持仓过夜，第二天从空仓开始。</li>
 <li>每次开仓、平仓或反手按 <span id="cost">1</span> 个基点（0.01%）扣交易成本，图表和表格里的收益都已扣除。</li>
 <li>「对照组」是不用 AI 的简单规则（均线、开盘方向、一直持有）。Claude 组要长期跑赢它们才算有用。</li>
 <li>只有几天的数据时，收益和准确率主要是运气（噪声）；通常要几十个交易日、上百次判断才值得参考。</li>
 <li>这里只是模拟记录，不是真实下单，不构成投资建议；与 Brooks Trading Course 无关。</li>
</ul></details>
<p id="status" class="status" role="status"></p>
<p class="disclaimer">模拟交易，仅供研究，不构成投资建议。</p>
</main>
<div id="sheet" class="sheet" hidden role="dialog" aria-labelledby="sheet-title"><div class="sheet-head"><h3 id="sheet-title"></h3><button id="sheet-close" aria-label="关闭">×</button></div><div id="sheet-body"></div></div>
<script>// wrangler/esbuild keep_names wraps serialized functions in __name(); define it for the browser.
var __name = (fn, _name) => fn;
const escapeHtml = ${escapeHtml.toString()};
${[renderMarkdown, buildOverlay, priorLevels, ptClock, liveChart, drawEquity].map(fn => fn.toString()).join('\n')}
(${loadIntraday.toString()})()</script></html>`;
}

async function loadIntraday() {
 const $ = id => document.getElementById(id);
 const GROUPS = [
  ['skill_chart', 'Claude + Brooks（看图）', '看图', 'Claude 先看一张K线图，再按 Brooks 价格行为方法判断方向。'],
  ['skill', 'Claude + Brooks（读数据）', '读数据', 'Claude 读K线数字和算好的特征，按 Brooks 价格行为方法判断方向。'],
  ['baseline', 'Claude（不用 Brooks）', '无Brooks', '同一个 Claude，但不给 Brooks 方法，用来检验 Brooks 方法有没有加分。'],
  ['ema20_5m', '均线规则（EMA20）', '均线', '对照组：价格在 20 均线上方就做多，下方就做空。'],
  ['opening_bar', '开盘方向规则', '开盘', '对照组：跟着开盘第一根K线的方向做；第一根实体太小就观望。'],
  ['buy_hold', '一直持有（参照）', '持有', '对照组：开盘后买入、收盘卖出，代表当天大盘本身的涨跌。']
 ].map(([key, name, short, desc], i) => ({key, name, short, desc, control: i >= 3, color: 'var(--s' + (i + 1) + ')'}));
 const known = Object.fromEntries(GROUPS.map(g => [g.key, g]));
 const groupOf = key => known[key] || {key, name: key, short: key, desc: '', control: false, color: 'var(--faint)'};
 const sideOf = v => v === 'long' ? ['做多', 'long'] : v === 'short' ? ['做空', 'short'] : ['观望', 'flat'];
 const pill = v => '<span class="pill ' + sideOf(v)[1] + '">' + sideOf(v)[0] + '</span>';
 const ok = v => typeof v === 'number' && Number.isFinite(v);
 const pct = (v, d = 2) => !ok(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(d) + '%';
 const ratio = (v, d = 1) => !ok(v) ? '—' : (v * 100).toFixed(d) + '%';
 const num = (v, d = 2) => !ok(v) ? '—' : v.toFixed(d);
 const tone = v => !ok(v) || Math.abs(v) < 5e-6 ? '' : v > 0 ? 'pos' : 'neg';
 const parts = (zone, date) => Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: zone, weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
  .formatToParts(date).map(p => [p.type, p.value]));
 const get = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
 };
 const params = new URLSearchParams(location.search);
 const symbol = params.get('symbol') || 'SPY';
 const query = new URLSearchParams({symbol});
 $('symbol').value = symbol;
 const select = $('session');
 const state = {condition: known[params.get('group')] ? params.get('group') : 'skill_chart',
  data: null, stats: null, expanded: new Set(), sheet: null, version: 0};

 const todayBars = () => state.data.bars.filter(b => b.session === state.data.session);
 const decisionsOf = key => state.data.predictions.filter(p => p.condition === key).sort((a, b) => a.bar - b.bar);
 const presentGroups = () => {
  const keys = new Set([...Object.keys(state.data?.positions || {}), ...Object.keys(state.stats?.conditions || {})]);
  keys.delete('missed');
  return [...GROUPS.filter(g => keys.has(g.key) || !keys.size), ...[...keys].filter(k => !known[k]).map(groupOf)];
 };
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
    (open ? '<div class="gmore">' + (p ? '最新判断：第 ' + p.bar + ' 根K线收盘（' + ptClock(p.bar + 1) + ' PT）' +
     (g.control ? '' : '，上涨概率 ' + Math.round(p.p_up_6 * 100) + '%') +
     ' · <button class="link" data-open="' + escapeHtml(g.key) + '" data-bar="' + p.bar + '">查看详情</button>' : '这个交易日还没有判断。') + '</div>' : '') +
    '</div>';
  }
  $('groups').innerHTML = html;
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
  const overlay = buildOverlay(d.bars, d.predictions, d.session, state.condition);
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
  const rows = presentGroups().filter(g => s.conditions[g.key])
   .map(g => [g, s.conditions[g.key]]).sort((a, b) => (b[1].account.total_return ?? -1) - (a[1].account.total_return ?? -1));
  if (!rows.length) { $('board').innerHTML = '<p class="empty">还没有统计数据。</p>'; $('adv').innerHTML = ''; return; }
  let few = false;
  $('board').innerHTML = '<table><thead><tr><th>组别</th><th>累计收益</th><th>最大回撤</th><th>方向准确率<small>（样本数）</small></th><th>交易日</th></tr></thead><tbody>' +
   rows.map(([g, m]) => {
    const n = Math.round((m.direction_coverage || 0) * (m.mature || 0));
    const small = n < 100;
    few = few || small;
    return '<tr><td class="gcell"><i class="dot" style="background:' + g.color + '"></i>' + escapeHtml(g.name) + '</td>' +
     '<td class="' + tone(m.account.total_return) + '">' + pct(m.account.total_return) + '</td>' +
     '<td>' + (ok(m.account.max_drawdown) && m.account.max_drawdown > 0 ? '−' + (m.account.max_drawdown * 100).toFixed(2) + '%' : '0.00%') + '</td>' +
     '<td' + (small ? ' class="few"' : '') + '><span' + (small ? ' class="few"' : '') + '>' + ratio(m.direction_hit_rate) + (small ? '*' : '') + '</span><small>（' + n + '）</small></td>' +
     '<td>' + m.account.days + '</td></tr>';
   }).join('') + '</tbody></table>' +
   (few ? '<p class="note-gray">* 样本太少，仅供参考（已出结果的多/空判断少于 100 个）。</p>' : '') +
   '<p class="note-gray">按累计收益排序。方向准确率 = 做多/做空后 30 分钟（6 根K线）价格方向猜对的比例，观望不计入。</p>';
  const cols = [['决策数', 'decisions', v => v],
   ['夏普', m => m.account.annualized_sharpe, v => num(v)], ['持仓时间', m => m.account.exposure, v => ratio(v, 0)],
   ['覆盖率', 'direction_coverage', v => ratio(v, 0)], ['Brier', 'brier', v => num(v, 3)], ['Log loss', 'log_loss', v => num(v, 3)],
   ['目标先到', 'target_before_stop_rate', v => ratio(v, 0)], ['待定+6', 'pending_6', v => v],
   ['待定目标/止损', 'pending_horizon', v => v], ['待定入场', 'pending_entries', v => v]];
  const pick = (m, k) => typeof k === 'function' ? k(m) : m[k];
  const pairs = [];
  for (const [g] of rows) for (const [base, p] of Object.entries(s.paired?.[g.key] || {})) if (p.n) pairs.push([g, groupOf(base), p]);
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
    ['待定入场', '下一根K线还没开盘、尚未模拟成交的判断数。']
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
  const groups = presentGroups().filter(g => s.conditions[g.key]);
  drawEquity($('equity'), groups.map(g => ({key: g.key, name: g.short, color: g.color, curve: s.conditions[g.key].account.equity_curve})), state.condition);
  $('equity-legend').innerHTML = groups.map(g => '<button data-key="' + escapeHtml(g.key) + '" aria-pressed="' + (g.key === state.condition) + '"><span class="sw" style="background:' +
   g.color + '"></span>' + escapeHtml(g.short) + ' ' + pct(s.conditions[g.key].account.total_return) + '</button>').join('');
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
   const reading = (p.reading || '').replace(/\n*\x60\x60\x60(?:json)?[\s\S]*?\x60\x60\x60\s*$/i, '').trim();
   html += '<div>' + pill(p.always_in) + (p.always_in === 'unclear' ? ' <span class="sub">不持仓</span>' : '') + '</div>' +
    '<dl class="kv"><div><dt>30 分钟后更高的概率</dt><dd>' + (g.control ? '—（规则组不估概率）' : Math.round(p.p_up_6 * 100) + '%') + '</dd></div>' +
    '<div><dt>判断时价格</dt><dd>' + num(p.close) + '</dd></div>' +
    '<div><dt>目标</dt><dd class="pos">' + num(p.target) + '</dd></div><div><dt>止损</dt><dd class="neg">' + num(p.stop) + '</dd></div></dl>' +
    (p.day_type ? '<p><span class="sub">盘面类型：</span>' + escapeHtml(p.day_type) + '</p>' : '') +
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
  renderSeg();
  renderChart();
  renderEquity();
  renderSheet();
 };

 function renderAll() {
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
  if (select.value) p.set('session', select.value);
  const [session, stats] = await Promise.allSettled([get('/api/intraday/session?' + p), get('/api/intraday/stats?' + query)]);
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

function drawEquity(parent, series, selected) {
 const days = [...new Set(series.flatMap(s => s.curve.map(d => d.date)))].sort();
 if (!days.length) { parent.innerHTML = '<p class="empty">还没有收益数据。</p>'; return; }
 const width = Math.max(300, parent.clientWidth || 600), height = width < 600 ? 220 : 280;
 const left = 54, right = 90, top = 12, bottom = 28;
 const values = series.flatMap(s => s.curve.map(d => d.equity - 1));
 let lo = Math.min(0, ...values), hi = Math.max(0, ...values);
 const pad = Math.max(.0005, (hi - lo) * .12);
 lo -= pad;
 hi += pad;
 const x = i => left + i / days.length * (width - left - right);
 const y = v => top + (hi - v) / (hi - lo) * (height - top - bottom);
 const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(Math.abs(hi - lo) < .02 ? 2 : 1) + '%';
 const out = [];
 for (let i = 0; i <= 4; i++) {
  const v = lo + (hi - lo) * (i + .5) / 5;
  out.push('<path class="grid" d="M' + left + ' ' + y(v) + 'H' + (width - right) + '"/><text x="' + (left - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + sign(v) + '</text>');
 }
 out.push('<path class="zero" d="M' + left + ' ' + y(0) + 'H' + (width - right) + '"/>');
 const every = Math.max(1, Math.ceil((days.length + 1) * 46 / (width - left - right)));
 ['起点', ...days.map(d => d.slice(5))].forEach((label, i) => {
  if (i % every === 0 || i === days.length) out.push('<text x="' + x(i) + '" y="' + (height - 8) + '" text-anchor="middle">' + label + '</text>');
 });
 const index = new Map(days.map((d, i) => [d, i + 1]));
 const ordered = [...series.filter(s => s.key !== selected), ...series.filter(s => s.key === selected)];
 for (const s of ordered) {
  if (!s.curve.length) continue;
  const on = s.key === selected;
  const pts = [[index.get(s.curve[0].date) - 1, 0], ...s.curve.map(d => [index.get(d.date), d.equity - 1])];
  out.push('<polyline class="ln" points="' + pts.map(([i, v]) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ') + '" stroke="' + s.color +
   '" stroke-width="' + (on ? 3 : 1.6) + '" opacity="' + (on ? 1 : .45) + '"/>');
  if (on) {
   for (const [i, v] of pts.slice(1)) out.push('<circle cx="' + x(i) + '" cy="' + y(v) + '" r="4" fill="' + s.color + '" stroke="var(--card)" stroke-width="2"><title>' +
    s.name + ' ' + days[i - 1] + '：' + sign(v) + '</title></circle>');
   const [li, lv] = pts.at(-1);
   out.push('<text x="' + (x(li) + 8) + '" y="' + (y(lv) + 4) + '" style="fill:var(--ink);font-weight:600">' + s.name + ' ' + (lv > 0 ? '+' : lv < 0 ? '−' : '') + Math.abs(lv * 100).toFixed(2) + '%</text>');
  }
 }
 parent.innerHTML = '<svg class="eq" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height +
  '" role="img" aria-label="各组累计收益（百分比）">' + out.join('') + '</svg>';
}
