// All calculations depend only on persisted bars and submitted signals.
const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
const side = p => ({long:1,short:-1,unclear:0}[p?.always_in] ?? 0);
// Ten probability buckets [0,.1), …, [.9,1] of [probability, outcome] pairs (shared with intraday).
export function calibration(pairs) {
 const buckets=Array.from({length:10},()=>[]);
 for(const [q,y] of pairs) buckets[Math.min(9,Math.max(0,Math.floor(q*10)))].push([q,y]);
 return buckets.map((a,i)=>({bucket:i,n:a.length,mean_probability:mean(a.map(x=>x[0])),observed_up:mean(a.map(x=>x[1]))}));
}
// Target/stop direction check against the entry close: 1 consistent, 0 inverted, null when no
// directional side or no level is given. Long: target > close, stop < close; short reversed.
export function levelsOk(p, close) {
 const d=side(p);
 if(!d || typeof close!=='number' || !Number.isFinite(close)) return null;
 const checks=[];
 if(typeof p.target==='number' && Number.isFinite(p.target)) checks.push(d*(p.target-close)>0);
 if(typeof p.stop==='number' && Number.isFinite(p.stop)) checks.push(d*(p.stop-close)<0);
 return checks.length ? +checks.every(Boolean) : null;
}
// Per-prediction outcome fields for exports, using the same alignment as score().
export function dailyOutcome(p, bb) {
 const i=bb.findIndex(b=>b.date===p.asof);
 if(i<0) return {outcome_status:'missing_bar'};
 const future=bb.slice(i+1), h=p.horizon??5, d=side(p), next=future[0], fifth=future[4];
 const up=fifth?+(fifth.close>bb[i].close):null;
 return {next_date:next?.date??null, next_return:next?d*(next.close/bb[i].close-1):null,
  close_5:fifth?.close??null, up_5:up, direction_hit:up==null||!d||future.length<Math.max(5,h)?null:+((d===1)===!!up),
  barrier:future.length<h?'pending':barrier(p,future,bb[i].close),
  outcome_status:future.length<Math.max(5,h)?'pending':'mature'};
}
export function barrier(p, future, entry) {
 const d=side(p), t=p.target, s=p.stop;
 if (!d || t==null || s==null) return 'not_applicable';
 if(d*(t-entry)<=0 || d*(s-entry)>=0) return 'invalid_levels';
 for(const b of future.slice(0,p.horizon ?? 5)) {
  if(d===1 ? b.low<=s : b.high>=s) return 'stop';
  if(d===1 ? b.high>=t : b.low<=t) return 'target';
 }
 return 'neither';
}
function account(rows) {
 const dates=new Map();
 for(const r of rows) { const a=dates.get(r.date)||[]; a.push(r); dates.set(r.date,a); }
 let equity=1,peak=1,dd=0; const curve=[];
 for(const [date,a] of [...dates].sort(([a],[b])=>a.localeCompare(b))) {
  const ret=mean(a.map(x=>x.return)); equity*=1+ret; peak=Math.max(peak,equity); dd=Math.max(dd,1-equity/peak);
  curve.push({date,return:ret,equity,exposure:mean(a.map(x=>x.exposure)),symbols:a.length});
 }
 const rr=curve.map(x=>x.return), avg=mean(rr), variance=rr.length>1?rr.reduce((a,r)=>a+(r-avg)**2,0)/(rr.length-1):0;
 return {days:rr.length,total_return:equity-1,annualized_sharpe:variance>0?avg/Math.sqrt(variance)*Math.sqrt(252):null,max_drawdown:dd,exposure:mean(curve.map(x=>x.exposure)),equity_curve:curve};
}
function score(bars,preds,cost) {
 const bySymbol=new Map(); for(const b of bars) {const a=bySymbol.get(b.symbol)||[]; a.push(b); bySymbol.set(b.symbol,a);}
 const rows=[], hits=[],bs=[],ll=[],pairs=[], outcomes={};
 let pending5=0,pendingHorizon=0,missing=0,mature=0;
 for(const [symbol,bb] of bySymbol) {
  bb.sort((a,b)=>a.date.localeCompare(b.date)); const pp=preds.filter(p=>p.symbol===symbol), map=new Map(pp.map(p=>[p.asof,p]));
  if(!pp.length) continue;
  const first=pp.map(p=>p.asof).sort()[0]; let prev=0;
  for(let i=0;i<bb.length-1;i++) {
   if(bb[i].date<first) continue;
   const d=side(map.get(bb[i].date));
   // A reversal changes two units; cash entry/exit changes one. At the data edge,
   // liquidation is charged at the final observed close when the next signal is cash.
   let fee=Math.abs(d-prev)*cost;
   if(i===bb.length-2 && side(map.get(bb[i+1].date))===0) fee+=Math.abs(d)*cost;
   rows.push({symbol,asof:bb[i].date,date:bb[i+1].date,return:d*(bb[i+1].close/bb[i].close-1)-fee,exposure:Math.abs(d)}); prev=d;
  }
 }
 for(const p of preds) {
  const bb=bySymbol.get(p.symbol)||[], i=bb.findIndex(b=>b.date===p.asof);
  if(i<0) {missing++; continue;}
  const future=bb.slice(i+1), h=p.horizon??5;
  if(future.length<h) pendingHorizon++;
  else {const o=barrier(p,future,bb[i].close); outcomes[o]=(outcomes[o]||0)+1;}
  // Direction/probability event always means five bars; require declared horizon too.
  if(future.length<Math.max(5,h)) {pending5++; continue;}
  mature++; const y=+(future[4].close>bb[i].close), d=side(p), q=Math.max(1e-6,Math.min(1-1e-6,p.p_up_5));
  if(d) hits.push(+((d===1)===!!y)); bs.push((p.p_up_5-y)**2); ll.push(-y*Math.log(q)-(1-y)*Math.log(1-q)); pairs.push([p.p_up_5,y]);
 }
 const valid=['target','stop','neither'].reduce((a,k)=>a+(outcomes[k]||0),0);
 return {predictions:preds.length,mature,pending_5:pending5,pending_horizon:pendingHorizon,missing_bars:missing,direction_coverage:mature?hits.length/mature:0,direction_hit_rate:mean(hits),brier:mean(bs),log_loss:mean(ll),calibration:calibration(pairs),target_stop:outcomes,target_before_stop_rate:valid?(outcomes.target||0)/valid:null,account:account(rows)};
}
export function computeMetrics(bars,predictions,{cost_bps=2}={}) {
 const conditions={},per_symbol={},paired={};
 for(const c of [...new Set(predictions.map(p=>p.condition))].sort()) {
  const pp=predictions.filter(p=>p.condition===c); conditions[c]=score(bars,pp,cost_bps/10000); per_symbol[c]={};
  for(const s of new Set(pp.map(p=>p.symbol))) per_symbol[c][s]=score(bars.filter(b=>b.symbol===s),pp.filter(p=>p.symbol===s),cost_bps/10000);
  paired[c]={};
  for(const m of ['ema20','momentum20','buy_hold']) {
   if(c===m) continue; const baseline=predictions.filter(p=>p.condition===m), keys=new Set(baseline.map(p=>`${p.symbol}/${p.asof}`)), matched=pp.filter(p=>keys.has(`${p.symbol}/${p.asof}`)), mk=new Set(matched.map(p=>`${p.symbol}/${p.asof}`));
   const a=score(bars,matched,cost_bps/10000), b=score(bars,baseline.filter(p=>mk.has(`${p.symbol}/${p.asof}`)),cost_bps/10000);
   paired[c][m]={n:matched.length,candidate:a,baseline:b,delta:Object.fromEntries(['direction_hit_rate','brier','log_loss'].map(k=>[k,a[k]==null||b[k]==null?null:a[k]-b[k]]))};
  }
 }
 return {cost_bps,conditions,per_symbol,paired};
}
