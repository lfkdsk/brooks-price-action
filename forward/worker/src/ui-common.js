// Shared look and helpers for the three public pages (/, /intraday, /recap).
// Functions below that run in the browser are serialized with .toString(); keep them
// self-contained (they may only call each other and escapeHtml / renderMarkdown).

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c =>
 ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// Drop conversational lead-in ("I have everything I need…") stored before the real
// content: everything before the first line that starts with '#' or '**'.
export function stripPreamble(markdown) {
 const lines = String(markdown ?? '').split(/\r?\n/);
 const first = lines.findIndex(line => /^\s*(#|\*\*)/.test(line));
 return (first > 0 ? lines.slice(first) : lines).join('\n').trim();
}

// Tiny, safe markdown: headings, paragraphs, lists, rules, fenced code, `code`, **bold**, *em*.
// Every piece of text is escaped before any tag is added.
export function renderMarkdown(markdown) {
 const inline = text => escapeHtml(text).replace(/`([^`]+)`|\*\*([^*]+)\*\*/g,
  (_, code, bold) => code === undefined ? '<strong>' + bold + '</strong>' : '<code>' + code + '</code>')
  .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<em>$2</em>');
 const html = [];
 let block = '', lines = [];
 function flush() {
  if (block === 'p') html.push('<p>' + inline(lines.join(' ')) + '</p>');
  if (block === 'ul' || block === 'ol') {
   html.push('<' + block + '>' + lines.map(line => '<li>' + inline(line) + '</li>').join('') + '</' + block + '>');
  }
  if (block === 'pre') html.push('<pre><code>' + escapeHtml(lines.join('\n')) + '</code></pre>');
  block = '';
  lines = [];
 }
 for (const raw of String(markdown ?? '').split(/\r?\n/)) {
  const line = raw.trim();
  if (block === 'pre') {
   if (/^```/.test(line)) flush();
   else lines.push(raw);
   continue;
  }
  if (/^```/.test(line)) { flush(); block = 'pre'; continue; }
  if (!line) { flush(); continue; }
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flush(); html.push('<hr>'); continue; }
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

// ---- Browser helpers (serialized into page scripts) ----
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function pct(v, d = 2) { return !isNum(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(d) + '%'; }
function ratio(v, d = 1) { return !isNum(v) ? '—' : (v * 100).toFixed(d) + '%'; }
function num(v, d = 2) { return !isNum(v) ? '—' : v.toFixed(d); }
function tone(v) { return !isNum(v) || Math.abs(v) < 5e-6 ? '' : v > 0 ? 'pos' : 'neg'; }
function sideOf(v) { return v === 'long' ? ['做多', 'long', '多'] : v === 'short' ? ['做空', 'short', '空'] : ['观望', 'flat', '观望']; }
function pill(v, short) { const s = sideOf(v); return '<span class="pill ' + s[1] + '">' + (short ? s[2] : s[0]) + '</span>'; }
function drawdown(v) { return isNum(v) && v > 0 ? '−' + (v * 100).toFixed(2) + '%' : '0.00%'; }

// Cumulative-return lines in percent; the selected series is drawn last and labelled.
function drawEquity(parent, series, selected) {
 const days = [...new Set(series.flatMap(s => s.curve.map(d => d.date)))].sort();
 if (!days.length) { parent.innerHTML = '<p class="empty">还没有收益数据。</p>'; return; }
 const width = Math.max(300, parent.clientWidth || 600), height = width < 600 ? 220 : 280;
 const sel = series.find(s => s.key === selected);
 // Leave room on the right for the selected series' end label.
 const left = 54, right = Math.max(90, Math.min(160, width * .28, ((sel?.name || '').length + 8) * 7 + 12)), top = 12, bottom = 28;
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

export const clientHelpers = {isNum, pct, ratio, num, tone, sideOf, pill, drawdown, drawEquity};
export {isNum, pct, ratio, num, tone, sideOf, pill, drawdown, drawEquity};

// Opening of every inline page script: the __name shim MUST stay the first statement
// (wrangler/esbuild keep_names wraps serialized functions in __name()).
// Serialize a browser function under every name the page code may use: its source name, which a bundler may have
// renamed (num -> num2), the keep_names name (fn.name) and an explicit key. Bundled callers may use either.
export function emitFunction(fn, key) {
 const src = fn.toString();
 const own = (src.match(/^(?:async\s+)?function\s*\*?\s*([\w$]+)/) || [])[1];
 const names = [...new Set([key, fn.name, own].filter(n => n && /^[A-Za-z_$][\w$]*$/.test(n)))];
 if (!names.length) throw new Error('cannot serialize anonymous function');
 return 'var ' + names[0] + ' = ' + src + ';' + names.slice(1).map(n => ' var ' + n + ' = ' + names[0] + ';').join('');
}

export function scriptPrelude(extra = []) {
 return `// wrangler/esbuild keep_names wraps serialized functions in __name(); define it for the browser.
var __name = (fn, _name) => fn;
${emitFunction(escapeHtml, 'escapeHtml')}
${[emitFunction(stripPreamble, 'stripPreamble'), emitFunction(renderMarkdown, 'renderMarkdown'),
   ...Object.entries(clientHelpers).map(([k, fn]) => emitFunction(fn, k)), ...extra.map(fn => emitFunction(fn))].join('\n')}`;
}

// ---- Shared CSS ----
const lightVars = `--bg:#f5f5f3;--card:#fff;--ink:#1c1c1a;--muted:#5f5e59;--faint:#8b8a85;--line:#e3e2dd;--accent:#2a6fc4;
--long:#14824b;--short:#c43a3a;--flat:#7b7a75;--long-soft:rgba(20,130,75,.13);--short-soft:rgba(196,58,58,.12);--flat-soft:rgba(123,122,117,.15);
--warn-soft:rgba(214,150,0,.16);--warn:#9a6a00;--annotation:#b3261e;--level:#6250d6;
--ema:#2a78d6;--candle-up:#fff;--pill-ink:#fff;--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--s6:#6250d6`;
const darkVars = `color-scheme:dark;--bg:#121211;--card:#1d1d1b;--ink:#eceae5;--muted:#aeada6;--faint:#86857f;--line:#353431;--accent:#6aa5ee;
--long:#3dbd78;--short:#f06c6c;--flat:#9b9a94;--long-soft:rgba(61,189,120,.16);--short-soft:rgba(240,108,108,.15);--flat-soft:rgba(155,154,148,.16);
--warn-soft:rgba(230,170,30,.16);--warn:#e7b443;--annotation:#ff8a80;--level:#a79cf0;
--ema:#5598e7;--candle-up:#1d1d1b;--pill-ink:#111;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--s6:#9085e9`;

export const baseCss = `
:root{color-scheme:light;${lightVars}}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){${darkVars}}}
:root[data-theme=dark]{${darkVars}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-text-size-adjust:100%}
a{color:var(--accent)}button{font:inherit;color:inherit}
.top{max-width:980px;margin:auto;padding:10px 16px 0;font-size:14px;color:var(--muted)}.top a{margin-right:12px;text-decoration:none}.top a[aria-current]{color:var(--ink);font-weight:600}
main{max-width:980px;margin:auto;padding:8px 16px 40px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:0 0 12px;min-width:0}
h1{font-size:15px;margin:0;font-weight:600;color:var(--muted)}
h2{font-size:17px;margin:0 0 10px}
h3{font-size:14px;margin:14px 0 6px}
.hint,.legend,.meta,.status{color:var(--muted);font-size:13px;margin:8px 0 0}
.pos{color:var(--long)}.neg{color:var(--short)}
.chip{font-size:12px;padding:3px 10px;border-radius:999px;background:var(--flat-soft);color:var(--muted);white-space:nowrap}
.chip.live{background:var(--long-soft);color:var(--long)}.chip.live::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:currentColor;margin-right:6px;vertical-align:1px}
.chip.warn{background:var(--warn-soft);color:var(--warn)}
.pill{display:inline-block;min-width:3.2em;text-align:center;padding:2px 9px;border-radius:999px;font-size:13px;font-weight:600;color:var(--pill-ink);white-space:nowrap}
.pill.long{background:var(--long)}.pill.short{background:var(--short)}.pill.flat{background:var(--flat)}
.pill.soft{color:var(--ink);background:var(--flat-soft);font-weight:500;min-width:0;white-space:normal;text-align:left}
.pill.soft.long{background:var(--long-soft);color:var(--long)}.pill.soft.short{background:var(--short-soft);color:var(--short)}
.ghead{font-size:12px;color:var(--muted);margin:12px 0 4px;padding-top:8px;border-top:1px dashed var(--line)}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:1px}
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
.g-level{stroke:var(--level);opacity:.75}svg text.glevel{fill:var(--level);font-weight:600}
.glabel{font-weight:600;stroke:var(--card);stroke-width:3px;paint-order:stroke;stroke-linejoin:round}
.ann line{stroke:var(--annotation);stroke-width:1}.ann circle{fill:var(--annotation)}
.ann text{fill:var(--annotation);font-weight:600;stroke:var(--card);stroke-width:3px;paint-order:stroke;stroke-linejoin:round}
.lastline{stroke:var(--ink);stroke-width:1;stroke-dasharray:1 3}
.pricetag{fill:var(--ink)}.pricetag-text{fill:var(--card);font-weight:700;font-size:12px}
.legend .k{white-space:nowrap;margin-right:10px;display:inline-block}
.legend .up{color:var(--long)}.legend .dn{color:var(--short)}.legend .fl{color:var(--flat)}.legend .em{color:var(--ema)}.legend .an{color:var(--annotation)}.legend .lv{color:var(--level)}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:-1px;margin-right:3px}
table{border-collapse:collapse;width:100%;font-size:13.5px;font-variant-numeric:tabular-nums}
th,td{padding:8px 4px;border-bottom:1px solid var(--line);text-align:right;vertical-align:middle}
th{font-size:12px;color:var(--muted);font-weight:500;line-height:1.25}th small{display:block;font-size:11px}th:last-child{white-space:nowrap}
th:first-child,td:first-child{text-align:left}
td.gcell{font-size:13px;line-height:1.3}
td .few{color:var(--faint)}td small{color:var(--muted);font-size:11px;display:block}
.note-gray{color:var(--faint);font-size:12.5px;margin:8px 0 0}
details>summary{cursor:pointer;font-weight:600;padding:4px 0}
.adv-wrap{margin-top:12px;border-top:1px solid var(--line);padding-top:8px}
.adv-wrap table.wide{min-width:640px}.adv-wrap table.wide td,.adv-wrap table.wide th{white-space:nowrap}
.defs{font-size:13px;color:var(--muted);margin:10px 0 0;padding:0}
.defs div{margin:4px 0}.defs b{color:var(--ink);font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chips button{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:3px 10px;font-size:12.5px;cursor:pointer}
.chips button[aria-pressed=true]{border-color:var(--ink);font-weight:600}
svg.eq .zero{stroke:var(--faint)}svg.eq .ln{fill:none;stroke-linejoin:round;stroke-linecap:round}
.help ul{margin:8px 0 0;padding-left:20px;font-size:14px}.help li{margin:5px 0}
.disclaimer{font-size:12px;color:var(--faint);text-align:center;margin:16px 0}
.sub{color:var(--muted);font-size:13px;margin:0 0 8px}
.kv{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.kv div{background:var(--bg);border-radius:8px;padding:6px 10px}
.kv dt{font-size:12px;color:var(--muted)}.kv dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}
.reading{font-size:14px;overflow-wrap:anywhere;max-height:7.5em;overflow:hidden;position:relative;border-top:1px solid var(--line);margin-top:8px}
.reading.full{max-height:none}.reading:not(.full)::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2.5em;background:linear-gradient(transparent,var(--card))}
.reading h2,.reading h3,.reading h4,.reading h5{font-size:14px;margin:8px 0 4px}.reading p,.reading ul,.reading ol{margin:6px 0}
.md{font-size:15px;line-height:1.7;overflow-wrap:anywhere}
.md h2{font-size:18px;margin:16px 0 8px}.md h3{font-size:16px;margin:16px 0 6px}.md h4,.md h5,.md h6{font-size:15px;margin:12px 0 4px}
.md p{margin:8px 0}.md ul,.md ol{margin:8px 0;padding-left:22px}.md li{margin:4px 0}
.md>:first-child{margin-top:0}
.md hr,.reading hr{border:0;border-top:1px solid var(--line);margin:12px 0}
.md code,.reading code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);padding:1px 4px;border-radius:4px}
.md pre,.reading pre{background:var(--bg);padding:10px;border-radius:8px;overflow-x:auto;font-size:12.5px}
.md pre code,.reading pre code{padding:0;background:none}
.md em{color:var(--muted)}
.empty{color:var(--muted);padding:16px}
`;

export function topNav(current) {
 const links = [['/', '每日', 'daily'], ['/intraday', '日内', 'intraday'], ['/recap', '复盘', 'recap']];
 return '<header class="top"><nav aria-label="页面">' + links.map(([href, text, key]) =>
  '<a href="' + href + '"' + (key === current ? ' aria-current="page"' : '') + '>' + text + '</a>').join('') + '</nav></header>';
}

export function pageShell({title, current, css = '', body, after = '', script = ''}) {
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>${baseCss}${css}</style>
${topNav(current)}
<main>
${body}
<p class="disclaimer">模拟交易，仅供研究，不构成投资建议；与 Brooks Trading Course 无关。</p>
</main>${after}${script ? '\n<script>' + script + '</script>' : ''}</html>`;
}
