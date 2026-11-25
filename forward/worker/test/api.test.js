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

test('public intraday sessions default to stored bars and accept skill_chart writes', async () => {
 const earlier = '2026-11-16', latest = '2026-11-17';
 const bar = (session, n, extras = {}) => ({symbol: 'SPY', session, bar: n, open: 100,
  high: 104, low: 98, close: 100, final: 0, ...extras});
 const bars = [bar(earlier, 78, {final: 1}), bar(latest, 1), bar(latest, 3), bar(latest, 4, {close: 103})];
 const predictions = [];
 const env = {...make(), DB: {prepare(sql) {
  return {bind(...args) {
   assert.equal(args[0], 'SPY');
   return {
    async all() {
     if (sql.includes('GROUP BY session')) return {results: [{session: latest, final: 0}, {session: earlier, final: 1}]};
     if (sql.includes('FROM ibars')) return {results: bars.filter(b => b.session <= args[1])};
     assert.match(sql, /FROM ipredictions/);
     return {results: predictions.filter(row => row.session === args[1])};
    },
    async run() {
     assert.match(sql, /INSERT INTO ipredictions/);
     const columns = sql.match(/ipredictions\(([^)]+)\)/)[1].split(',');
     predictions.push(Object.fromEntries(columns.map((key, i) => [key, args[i]])));
    }
   };
  }};
 }}};
 const decision = {symbol: 'SPY', session: latest, bar: 3, ts: '2026-11-17T14:40:00Z',
  condition: 'skill_chart', model: 'test', skill_sha: 'abc', always_in: 'long',
  p_up_6: .6, target: null, stop: null, horizon: 6, day_type: 'trend', close: 100, reading: 'test'};
 assert.equal((await call(env, '/api/intraday/predictions', 'POST', decision)).status, 200);
 const get = suffix => call(env, '/api/intraday/session' + suffix, 'GET', undefined, '');
 const data = await (await get('?v=1')).json();
 assert.deepEqual(data.sessions, [latest, earlier]);
 assert.equal(data.session, latest);
 assert.equal(data.bars.length, 4);
 assert.deepEqual(data.predictions, [decision]);
 assert.equal(data.positions.skill_chart.position, 'long');
 assert.ok(Math.abs(data.positions.skill_chart.return - .0299) < 1e-9);
 const past = await (await get('?v=1&session=' + earlier)).json();
 assert.equal(past.session, earlier);
 assert.equal(past.bars.length, 1);
 assert.deepEqual(past.predictions, []);
 assert.equal((await get('?session=2026-11-15')).status, 404);
});
