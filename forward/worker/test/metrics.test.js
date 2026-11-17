import test from 'node:test';
import assert from 'node:assert/strict';
import {computeMetrics,barrier} from '../src/metrics.js';
const bars=(prices,symbol='SPY')=>prices.map((close,i)=>({symbol,date:`2026-11-${String(i+1).padStart(2,'0')}`,open:close,high:close+1,low:close-1,close}));
const pred=(i,always_in='long',condition='skill',symbol='SPY',extra={})=>({symbol,asof:`2026-11-${String(i+1).padStart(2,'0')}`,condition,always_in,p_up_5:.7,horizon:5,target:null,stop:null,...extra});
const metric=(bb,pp,cost_bps=0)=>computeMetrics(bb,pp,{cost_bps}).conditions.skill;
test('next trading bar alignment, no future information selects position',()=>{
 const p=[pred(0),pred(1,'short'),pred(2,'unclear')];
 const a=metric(bars([100,110,99]),p), b=metric(bars([100,90,120]),p);
 assert.ok(Math.abs(a.account.equity_curve[0].return-.1)<1e-10);
 assert.ok(Math.abs(a.account.equity_curve[1].return-.1)<1e-10);
 assert.ok(Math.abs(b.account.equity_curve[0].return+.1)<1e-10);
 assert.equal(a.pending_5,3);assert.equal(a.mature,0);
});
test('entry, reversal, terminal exit costs charged per position unit',()=>{
 const m=metric(bars([100,100,100,100]),[pred(0),pred(1),pred(2,'short'),pred(3,'unclear')],2);
 m.account.equity_curve.forEach((x,i)=>assert.ok(Math.abs(x.return-[-.0002,0,-.0006][i])<1e-12));
});
test('missing predictions become cash and exit, no carried signals',()=>{
 const m=metric(bars([100,110,121,133.1]),[pred(0)],2);
 assert.ok(Math.abs(m.account.equity_curve[1].return+.0002)<1e-12);
 assert.equal(m.account.equity_curve[2].return,0);
});
test('pending horizon, strict up direction, probability clipping and coverage',()=>{
 const bb=bars([100,101,102,103,104,100,106]);
 const pp=[pred(0,'short','skill','SPY',{p_up_5:0}),pred(1,'unclear'),pred(2)];
 const m=metric(bb,pp);assert.equal(m.mature,2);assert.equal(m.pending_5,1);
 assert.equal(m.direction_hit_rate,1);assert.equal(m.direction_coverage,.5);assert.ok(Number.isFinite(m.log_loss));
 const longH=metric(bb,[pred(0,'long','skill','SPY',{horizon:10})]);assert.equal(longH.mature,0);assert.equal(longH.pending_horizon,1);
});
test('same-bar double hit is stop; invalid and absent barriers',()=>{
 const p=pred(0,'long','skill','SPY',{target:110,stop:90});
 assert.equal(barrier(p,[{high:111,low:89}],100),'stop');
 assert.equal(barrier({...p,always_in:'short',target:90,stop:110},[{high:111,low:89}],100),'stop');
 assert.equal(barrier({...p,target:99},[],100),'invalid_levels');
 assert.equal(barrier({...p,target:null},[],100),'not_applicable');
});
test('equal weights symbols each day and paired symbol/date matching',()=>{
 const bb=[...bars([100,110,120,130,140,150]),...bars([100,90,80,70,60,50],'QQQ')];
 const pp=[pred(0),pred(0,'long','skill','QQQ'),pred(0,'long','buy_hold'),pred(1,'long','buy_hold','QQQ')];
 const m=computeMetrics(bb,pp,{cost_bps:0});assert.ok(Math.abs(m.conditions.skill.account.equity_curve[0].return)<1e-12);
 assert.equal(m.paired.skill.buy_hold.n,1);assert.equal(m.paired.skill.buy_hold.delta.brier,0);
 assert.ok(m.per_symbol.skill.QQQ.account.total_return<0);
});
test('max drawdown includes initial equity, no data is well defined',()=>{
 assert.ok(Math.abs(metric(bars([100,90]),[pred(0)]).account.max_drawdown-.1)<1e-12);
 assert.deepEqual(computeMetrics([],[]).conditions,{});
});
