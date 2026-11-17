"""Forward scoring and opt-in candidate execution. Never launches jobs without --run-candidates."""
import argparse, hashlib, json, math, pathlib, random, re, shutil, statistics, subprocess, tempfile
from make_samples import ROOT
from prompts import prompt

def parse_prediction(text):
    blocks=re.findall(r'```(?:json)?\s*(.*?)```',text,re.S|re.I)
    candidates=blocks[::-1]+[text.strip()]
    for raw in candidates:
        try:
            p=json.loads(raw)
            if not isinstance(p,dict): continue
            if p['always_in'] not in ('long','short','unclear'): continue
            # state is descriptive only (not scored): normalize free-form labels instead of rejecting the forecast
            st=str(p.get('state','')).lower()
            if st not in ('bull_trend','bear_trend','trading_range'):
                p['state_raw']=p.get('state')
                p['state']='trading_range' if 'range' in st else 'bull_trend' if 'bull' in st else 'bear_trend' if 'bear' in st else 'other'
            if type(p['p_up_5']) not in (int,float) or not math.isfinite(p['p_up_5']) or not 0<=p['p_up_5']<=1: continue
            if type(p.get('horizon_bars',5)) is not int or not 1<=p.get('horizon_bars',5)<=20: p['horizon_bars']=5
            for k in ('target','stop'):
                if p[k] is not None and (type(p[k]) not in (int,float) or not math.isfinite(p[k])): raise ValueError(k)
            return p
        except (ValueError,KeyError,TypeError): pass
    raise ValueError('No valid prediction JSON block')

def position(p): return {'long':1,'short':-1,'unclear':0}[p['always_in']]

def barrier(p, forward, entry=1000):
    d=position(p); t=p['target']; s=p['stop']
    if not d or t is None or s is None: return 'not_applicable'
    if d*(t-entry)<=0 or d*(s-entry)>=0: return 'invalid_levels'
    for b in forward[:p['horizon_bars']]:
        stop=b['low']<=s if d==1 else b['high']>=s
        target=b['high']>=t if d==1 else b['low']<=t
        if stop: return 'stop'  # Includes ambiguous same-bar hits.
        if target: return 'target'
    return 'neither'

def mean(x): return statistics.mean(x) if x else None

def sharpe(r):
    return mean(r)/statistics.stdev(r)*math.sqrt(252/5) if len(r)>1 and statistics.stdev(r)>0 else None

def metrics(keys, preds, costs=1):
    pairs=[(k,preds[k['id']]) for k in keys if k['id'] in preds]; hits=[]; bs=[]; ll=[]; calibration=[[] for _ in range(10)]; returns=[]; equity=[]; outcomes={}; wealth=peak=1.; dd=0.; last_exit=-1; traded=0
    for k,p in sorted(pairs,key=lambda kp:kp[0]['index']):
        y=int(k['forward'][4]['close']>k['history'][-1]['close']); d=position(p); prob=p['p_up_5']
        if d: hits.append(int((d==1)==bool(y)))
        bs.append((prob-y)**2); q=min(1-1e-15,max(1e-15,prob)); ll.append(-y*math.log(q)-(1-y)*math.log(1-q)); calibration[min(9,int(prob*10))].append((prob,y))
        f=[{**b,**{v:b[v]*k['scale']+k['offset'] for v in ('open','high','low','close')}} for b in k['forward']]
        outcome=barrier(p,f); outcomes[outcome]=outcomes.get(outcome,0)+1
        # Greedy chronological selection guarantees no overlapping 5-bar positions (holiday weeks included).
        if k['index']<last_exit: continue
        last_exit=k['index']+5; entry=k['history'][-1]['close']
        r=d*(k['forward'][4]['close']-entry)/entry-(costs*.25/entry if d else 0)
        returns.append(r); traded+=bool(d); wealth*=1+r; peak=max(peak,wealth); dd=max(dd,1-wealth/peak)
        equity.append({'id':k['id'],'asof':k['asof'],'equity':wealth,'return':r})
    applicable=sum(outcomes.get(x,0) for x in ('target','stop','neither'))
    return {'n':len(pairs),'direction_coverage':len(hits)/len(pairs) if pairs else 0,'direction_hit_rate':mean(hits),'brier':mean(bs),'log_loss':mean(ll),
            'calibration':[{'decile':i,'n':len(v),'mean_probability':mean([a for a,b in v]),'observed_up':mean([b for a,b in v])} for i,v in enumerate(calibration)],
            'target_stop':outcomes,'target_before_stop_rate':outcomes.get('target',0)/applicable if applicable else None,
            'strategy':{'n':len(returns),'active':traded,'total_return':wealth-1,'annualized_sharpe':sharpe(returns),'max_drawdown':dd,'hit_rate':mean([int(r>0) for r in returns]),'equity_curve':equity}}

def prediction(d,p=None):
    return {'always_in':'long' if d>0 else 'short' if d<0 else 'unclear','p_up_5':float(d>0) if p is None else p,'state':'trading_range','target':None,'stop':None,'horizon_bars':5}

def baselines(keys):
    out={name:{} for name in ('buy_hold','ema20','momentum20','base_rate')}
    for k in keys:
        c=[r['close'] for r in k['history']]; e=c[0]
        for v in c[1:]: e=2/21*v+19/21*e
        for name,p in [('buy_hold',prediction(1)),('ema20',prediction(1 if c[-1]>e else -1)),('momentum20',prediction((c[-1]>c[-21])-(c[-1]<c[-21]))),('base_rate',prediction(0,k['past_base_rate']))]: out[name][k['id']]=p
    return out

def delta(a,b):
    vals=[(a['direction_hit_rate'],b['direction_hit_rate']),(a['brier'],b['brier']),(a['strategy']['annualized_sharpe'],b['strategy']['annualized_sharpe'])]
    return {name:x-y if x is not None and y is not None else None for name,(x,y) in zip(('hit_rate','brier','sharpe'),vals)}

def intervals(keys,preds,base,costs,draws,seed,coin=False):
    rng=random.Random(seed); dist={k:[] for k in ('hit_rate','brier','sharpe')}
    for _ in range(draws):
        sample=[dict(rng.choice(keys)) for _ in keys]
        # Synthetic indices preserve bootstrap draw order and avoid overlap filtering duplicate rows.
        pp={}; bb={}
        for i,k in enumerate(sample):
            old=k['id']; k['id']=str(i); k['index']=i*5; pp[str(i)]=preds[old]; bb[str(i)]=prediction(rng.choice((-1,1)),.5) if coin else base[old]
        for name,v in delta(metrics(sample,pp,costs),metrics(sample,bb,costs)).items():
            if v is not None: dist[name].append(v)
    result={}
    for name,v in dist.items():
        v.sort(); result[name]={'ci95':[v[int(.025*(len(v)-1))],v[int(.975*(len(v)-1))]] if v else None,'valid_draws':len(v)}
    return result

def evaluate(keys,conditions,costs=1,draws=1000,seed=1):
    report={}
    for subset,kk in [('overall',keys),('post_cutoff',[k for k in keys if k['post_cutoff']])]:
        result={}
        for name,preds in conditions.items():
            paired=[k for k in kk if k['id'] in preds]; m=metrics(kk,preds,costs); comparisons={}
            for bn,bp in baselines(paired).items():
                bm=metrics(paired,bp,costs); comparisons[bn]={'metrics':bm,'delta':delta(m,bm),'paired_bootstrap':intervals(paired,preds,bp,costs,draws,seed) if paired else {}}
            rng=random.Random(seed); coin_metrics=[]
            for _ in range(1000):
                cp={k['id']:prediction(rng.choice((-1,1)),.5) for k in paired}; coin_metrics.append(metrics(paired,cp,costs))
            cm={'draws':1000,'direction_hit_rate':mean([x['direction_hit_rate'] for x in coin_metrics if x['direction_hit_rate'] is not None]),'brier':mean([x['brier'] for x in coin_metrics if x['brier'] is not None]),'log_loss':mean([x['log_loss'] for x in coin_metrics if x['log_loss'] is not None]),'strategy':{field:mean([x['strategy'][field] for x in coin_metrics if x['strategy'][field] is not None]) for field in ('total_return','annualized_sharpe','max_drawdown','hit_rate')}}
            comparisons['coin_flip']={'metrics':cm,'delta':delta(m,cm),'paired_bootstrap':intervals(paired,preds,{},costs,draws,seed,coin=True) if paired else {}}
            result[name]={'metrics':m,'missing_or_failed':len(kk)-len(paired),'comparisons':comparisons}
        report[subset]=result
    return report

def candidate(public, sid, condition, cache, execute=False):
    source=public/sid; skill=ROOT/'skill/brooks-price-action'; files=[source/'bars.csv',source/'weekly.csv']
    skillfiles=sorted([skill/'SKILL.md',skill/'scripts/bar_features.py',*list((skill/'references').glob('*.md'))]) if condition=='skill' else []
    digest=hashlib.sha256(prompt(condition).encode()+b''.join(f.read_bytes() for f in files+skillfiles)).hexdigest()
    dest=cache/sid/condition/digest; dest.mkdir(parents=True,exist_ok=True); raw=dest/'candidate.md'
    if not raw.exists():
        if not execute: raise ValueError('No cached candidate (use --run-candidates explicitly)')
        with tempfile.TemporaryDirectory(prefix='chart-candidate-') as temp:
            stage=pathlib.Path(temp)
            for f in files: shutil.copyfile(f,stage/f.name)
            for f in skillfiles:
                target=stage/'skill'/f.relative_to(skill); target.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(f,target)
            # Tool permission limits are NOT an OS sandbox. Operator must isolate filesystem/network.
            proc=subprocess.run(['claude','-p',prompt(condition),'--allowedTools','Bash(python3:*) Read','--add-dir',str(stage)],cwd=stage,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=900)
            if proc.returncode: raise RuntimeError(proc.stderr[-1000:])
            raw.write_text(proc.stdout)
    return parse_prediction(raw.read_text())

def write_report(report,out,failures=None):
    out=pathlib.Path(out); out.mkdir(parents=True,exist_ok=True)
    (out/'results.json').write_text(json.dumps({'results':report,'failures':failures or []},indent=2,allow_nan=False))
    lines=['# Forward chart-reading backtest','', 'Deltas are candidate minus baseline; lower Brier is better. Bootstrap intervals are paired percentile intervals.','']
    for subset,conditions in report.items():
        lines.extend([f'## {subset}',''])
        for name,r in conditions.items():
            m=r['metrics']; lines.extend([f'### {name}', '',f"n={m['n']}; missing/failed={r['missing_or_failed']}; coverage={m['direction_coverage']:.3f}; hit={m['direction_hit_rate']}; Brier={m['brier']}; log loss={m['log_loss']}",f"Strategy: {json.dumps({k:v for k,v in m['strategy'].items() if k!='equity_curve'})}",f"Target/stop: {m['target_stop']}; target-first rate={m['target_before_stop_rate']}",'','Calibration:','', '| Decile | n | Forecast | Observed up |','|---|---:|---:|---:|'])
            for v in m['calibration']: lines.append(f"| {v['decile']} | {v['n']} | {v['mean_probability']} | {v['observed_up']} |")
            for bn,b in r['comparisons'].items(): lines.extend(['',f"**{bn}**: delta {json.dumps(b['delta'])}; 95% CIs {json.dumps(b['paired_bootstrap'])}",f"Baseline metrics: {json.dumps({k:v for k,v in b['metrics'].items() if k not in ('calibration','strategy')})}; strategy {json.dumps({k:v for k,v in b['metrics']['strategy'].items() if k!='equity_curve'})}"])
    lines.extend(['',f'Failures: {json.dumps(failures or [])}']); (out/'report.md').write_text('\n'.join(lines)+'\n')

def main():
    p=argparse.ArgumentParser(); p.add_argument('--samples',required=True); p.add_argument('--out',required=True); p.add_argument('--conditions',default='skill,baseline'); p.add_argument('--run-candidates',action='store_true'); p.add_argument('--cost-ticks',type=float,default=1); p.add_argument('--bootstrap',type=int,default=1000); p.add_argument('--seed',type=int,default=1); p.add_argument('--workers',type=int,default=1); a=p.parse_args()
    if a.cost_ticks<0 or a.bootstrap<1: p.error('cost must be nonnegative and bootstrap positive')
    samples=pathlib.Path(a.samples).resolve(); out=pathlib.Path(a.out).resolve(); keys=json.loads((samples/'private/key.json').read_text()); conditions={}; failures=[]
    import concurrent.futures as cf
    def job(k, cond):
        try: return cond, k['id'], candidate(samples/'public',k['id'],cond,out/'cache',a.run_candidates), None
        except (ValueError,RuntimeError,OSError,subprocess.TimeoutExpired) as e: return cond, k['id'], None, str(e)
    for cond in a.conditions.split(','): conditions[cond]={}
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for cond, sid, pred, err in ex.map(lambda j: job(*j), [(k, c) for c in a.conditions.split(',') for k in keys]):
            if err is None: conditions[cond][sid]=pred
            else: failures.append({'id':sid,'condition':cond,'error':err})
    write_report(evaluate(keys,conditions,a.cost_ticks,a.bootstrap,a.seed),out,failures)
if __name__=='__main__': main()
