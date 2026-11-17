import {computeMetrics} from './metrics.js';
import {dashboard,readingPage} from './dashboard.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
// Hash to fixed-length digests before comparing every byte (no token-length early exit).
export async function authorized(header,token){
 if(!token)return false;
 const digest=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const [a,b]=await Promise.all([digest(header||''),digest('Bearer '+token)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const number=x=>typeof x==='number'&&Number.isFinite(x);
const symbol=s=>typeof s==='string'&&/^[A-Za-z0-9^=._-]{1,24}$/.test(s);
const text=(s,n=200)=>typeof s==='string'&&s.length<=n;
async function all(db,sql,args=[]){return (await db.prepare(sql).bind(...args).all()).results;}
export default {async fetch(request,env){
 const u=new URL(request.url),path=u.pathname,db=env.DB;
 try{
 if(request.method==='POST'){
  if(!['/api/bars','/api/predictions','/api/runs'].includes(path))return json({error:'Not found'},404);
  if(!await authorized(request.headers.get('authorization'),env.WRITE_TOKEN))return json({error:'Unauthorized'},401);
  if(Number(request.headers.get('content-length'))>2000000)return json({error:'Body too large'},413);
  const raw=await request.text();if(raw.length>2000000)return json({error:'Body too large'},413);
  let body;try{body=JSON.parse(raw)}catch{return json({error:'Invalid JSON'},400)}
  if(path==='/api/bars'){
   const rows=body.bars;if(!Array.isArray(rows)||!rows.length||rows.length>2000||rows.some(b=>!symbol(b.symbol)||!date(b.date)||!['open','high','low','close'].every(k=>number(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close)))return json({error:'Invalid bars'},400);
   for(const b of rows)await db.prepare('INSERT INTO bars(symbol,date,open,high,low,close) VALUES(?,?,?,?,?,?) ON CONFLICT(symbol,date) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close').bind(b.symbol,b.date,b.open,b.high,b.low,b.close).run();
   return json({ok:true,count:rows.length});
  }
  if(path==='/api/predictions'){
   const p=body;if(!symbol(p.symbol)||!date(p.asof)||!text(p.condition,60)||!p.condition||!['long','short','unclear'].includes(p.always_in)||!number(p.p_up_5)||p.p_up_5<0||p.p_up_5>1||!Number.isInteger(p.horizon)||p.horizon<1||p.horizon>20||!number(p.close)||p.close<=0||!['target','stop'].every(k=>p[k]===null||number(p[k]))||!text(p.reading,200000)||!text(p.model)||!text(p.skill_sha)||!text(p.state))return json({error:'Invalid prediction'},400);
   const cols=['symbol','asof','condition','model','skill_sha','always_in','p_up_5','target','stop','horizon','state','close','reading'];
   await db.prepare(`INSERT INTO predictions(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')}) ON CONFLICT(symbol,asof,condition) DO UPDATE SET ${cols.slice(3).map(k=>`${k}=excluded.${k}`).join(',')}`).bind(...cols.map(k=>p[k])).run();return json({ok:true});
  }
  const r=body;if(!text(r.started_at)||!text(r.finished_at)||!text(r.host)||typeof r.ok!=='boolean'||!text(r.log,200000))return json({error:'Invalid run'},400);
  await db.prepare('INSERT INTO runs(started_at,finished_at,host,ok,log) VALUES(?,?,?,?,?)').bind(r.started_at,r.finished_at,r.host,+r.ok,r.log).run();return json({ok:true});
 }
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 if(path==='/')return new Response(dashboard,{headers:{'content-type':'text/html; charset=utf-8'}});
 if(path==='/api/predictions'){
  const clauses=[],args=[];for(const k of ['symbol','condition'])if(u.searchParams.has(k)){clauses.push(`${k}=?`);args.push(u.searchParams.get(k));}
  const requested=Number(u.searchParams.get('limit')||100),limit=Number.isFinite(requested)?Math.max(1,Math.min(1000,Math.floor(requested))):100;
  return json({predictions:await all(db,`SELECT * FROM predictions${clauses.length?' WHERE '+clauses.join(' AND '):''} ORDER BY asof DESC,id DESC LIMIT ?`,[...args,limit])});
 }
 if(path==='/api/stats'||path==='/api/equity'){
  const [bars,preds]=await Promise.all([all(db,'SELECT * FROM bars ORDER BY symbol,date'),all(db,'SELECT * FROM predictions ORDER BY symbol,asof')]);const stats=computeMetrics(bars,preds);
  const first=preds.map(p=>p.created_at||p.asof).sort()[0];stats.days_running=first?Math.max(0,Math.floor((Date.now()-Date.parse(first.endsWith('Z')?first:first.replace(' ','T')+'Z'))/86400000)):0;
  return json(path==='/api/stats'?stats:Object.fromEntries(Object.entries(stats.conditions).map(([c,m])=>[c,m.account.equity_curve])));
 }
 if(/^\/reading\/\d+$/.test(path)){const p=await db.prepare('SELECT * FROM predictions WHERE id=?').bind(Number(path.split('/')[2])).first();return p?new Response(readingPage(p),{headers:{'content-type':'text/html; charset=utf-8'}}):json({error:'Not found'},404);}
 return json({error:'Not found'},404);
 }catch(e){return json({error:'Request failed'},500);}
}};
