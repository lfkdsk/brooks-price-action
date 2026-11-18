import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{authorized} from '../src/index.js';
class FakeD1 {
 constructor(){this.bars=[];this.predictions=[];this.runs=[];this.calls=[];}
 prepare(sql){const db=this;let args=[];return {bind(...a){args=a;return this},async run(){db.calls.push({sql,args});if(sql.startsWith('INSERT INTO bars')){const b=Object.fromEntries(['symbol','date','open','high','low','close'].map((k,i)=>[k,args[i]]));db.bars=db.bars.filter(x=>x.symbol!==b.symbol||x.date!==b.date);db.bars.push(b)}else if(sql.startsWith('INSERT INTO predictions')){const cols=sql.match(/predictions\(([^)]+)/)[1].split(','),p=Object.fromEntries(cols.map((k,i)=>[k,args[i]]));const old=db.predictions.find(x=>x.symbol===p.symbol&&x.asof===p.asof&&x.condition===p.condition);if(old)Object.assign(old,p);else db.predictions.push({...p,id:db.predictions.length+1})}else db.runs.push(args);return {success:true}},async all(){if(sql.includes('FROM bars'))return {results:db.bars};let rows=db.predictions.slice(),i=0;for(const k of ['symbol','condition'])if(sql.includes(`${k}=?`))rows=rows.filter(p=>p[k]===args[i++]);rows.sort((a,b)=>b.asof.localeCompare(a.asof)||b.id-a.id);if(sql.includes('LIMIT'))rows=rows.slice(0,args.at(-1));return {results:rows}},async first(){return db.predictions.find(p=>p.id===args[0])||null}}}
}
const make=()=>({DB:new FakeD1(),WRITE_TOKEN:'test-secret'});
const call=(env,path,method='GET',body,auth='Bearer test-secret')=>worker.fetch(new Request('https://unit.test'+path,{method,headers:{authorization:auth},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
const p={symbol:'SPY',asof:'2026-11-01',condition:'skill',model:'test',skill_sha:'abc',always_in:'long',p_up_5:.6,target:null,stop:null,horizon:5,state:'bull_trend',close:100,reading:'<script>alert(1)</script>'};
test('auth rejects absent/wrong tokens; all writes protected',async()=>{
 const env=make();for(const path of ['/api/bars','/api/predictions','/api/runs','/api/intraday/bars','/api/intraday/predictions','/api/recaps'])for(const token of ['', 'Bearer wrong'])assert.equal((await call(env,path,'POST',{},token)).status,401);
 assert.equal(await authorized('Bearer test-secret','test-secret'),true);assert.equal(await authorized('Bearer test-secret',''),false);assert.equal(env.DB.calls.length,0);
});
test('upsert bars and predictions, filter, limit, reading escaping',async()=>{
 const env=make();const bar={symbol:'SPY',date:p.asof,open:100,high:101,low:99,close:100};
 for(let i=0;i<2;i++){assert.equal((await call(env,'/api/bars','POST',{bars:[bar]})).status,200);assert.equal((await call(env,'/api/predictions','POST',{...p,p_up_5:.6+i*.1})).status,200)}
 assert.equal(env.DB.predictions.length,1);assert.equal(env.DB.bars.length,1);
 const r=await (await call(env,'/api/predictions?symbol=SPY&condition=skill&limit=1')).json();assert.equal(r.predictions.length,1);assert.equal(r.predictions[0].p_up_5,.7);
 assert.equal((await (await call(env,'/api/predictions?symbol=QQQ')).json()).predictions.length,0);
 const html=await (await call(env,'/reading/1')).text();assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>alert'));
 assert.equal((await call(env,'/reading/999')).status,404);
});
test('public dashboard stats equity and routing',async()=>{
 const env=make();for(const path of ['/','/api/stats','/api/equity','/api/predictions'])assert.equal((await call(env,path,'GET',undefined,'')).status,200);
 assert.equal((await call(env,'/missing')).status,404);assert.equal((await call(env,'/api/stats','DELETE')).status,405);
 assert.equal((await call(env,'/api/predictions','POST',{...p,p_up_5:2})).status,400);
 assert.equal((await call(env,'/api/bars','POST',{bars:[{symbol:'SPY'}]})).status,400);
 assert.equal((await call(env,'/api/runs','POST',{started_at:'now',finished_at:'now',host:'test',ok:true,log:'done'})).status,200);
});
