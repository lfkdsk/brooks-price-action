"""Create candidate-only views and separate private scoring keys (stdlib)."""
import argparse, csv, datetime as dt, json, pathlib, random
ROOT = pathlib.Path(__file__).resolve().parents[2]
FIELDS = ('open', 'high', 'low', 'close')

def load(path):
    with open(path, newline='') as f:
        rows = [{**r, **{k: float(r[k]) for k in FIELDS}} for r in csv.DictReader(f)]
    if any(a['date'] >= b['date'] for a,b in zip(rows, rows[1:])):
        raise ValueError('dates must be unique and sorted')
    return rows

def week(date):
    return dt.date.fromisoformat(date).isocalendar()[:2]

def eligible(rows, since, until):
    return [i for i in range(499, len(rows)-20) if since <= rows[i]['date'] <= until
            and week(rows[i]['date']) != week(rows[i+1]['date'])]

def anonymize(history):
    # Fixed output grid; scale depends ONLY on past prices. Translation hides absolute level.
    span = max(r['high'] for r in history)-min(r['low'] for r in history)
    scale = 500 / span if span else 1.0
    offset = 1000-history[-1]['close']*scale
    bars = [{ 'bar': i-len(history)+1, **{k: round((r[k]*scale+offset)*4)/4 for k in FIELDS}}
            for i,r in enumerate(history)]
    return bars, scale, offset

def weekly(history, scale, offset):
    out=[]; key=None
    for r in history:
        if week(r['date']) != key:
            out.append(dict(r)); key=week(r['date'])
        else:
            out[-1]['high']=max(out[-1]['high'],r['high']); out[-1]['low']=min(out[-1]['low'],r['low']); out[-1]['close']=r['close']
    return [{'bar': i-len(out)+1, **{k: round((r[k]*scale+offset)*4)/4 for k in FIELDS}} for i,r in enumerate(out)]

def write_csv(path, bars):
    with open(path,'x',newline='') as f:
        w=csv.DictWriter(f,fieldnames=['bar',*FIELDS]); w.writeheader(); w.writerows(bars)

def build(rows, indices, out, seed=1):
    out=pathlib.Path(out); out.mkdir(parents=True,exist_ok=False)
    public=out/'public'; public.mkdir(); private=out/'private'; private.mkdir(mode=0o700)
    keys=[]
    # Random opaque IDs, independent of chronology.
    rng=random.Random(seed); ids=rng.sample(range(100000000,999999999),len(indices))
    for sid,i in zip(ids,sorted(indices)):
        sid=str(sid); h=rows[i-499:i+1]; bars,s,o=anonymize(h)
        d=public/sid; d.mkdir(); write_csv(d/'bars.csv',bars); write_csv(d/'weekly.csv',weekly(h,s,o))
        keys.append({'id':sid,'asof':rows[i]['date'],'index':i,'post_cutoff':rows[i]['date']>='2026-07-01',
                     'scale':s,'offset':o,'history':h,'forward':rows[i+1:i+21],
                     'past_base_rate':sum(rows[j+5]['close']>rows[j]['close'] for j in range(0,i-4))/max(1,i-4)})
    (private/'key.json').write_text(json.dumps(keys,indent=2)); (public/'manifest.json').write_text(json.dumps(ids))
    return keys

def main():
    p=argparse.ArgumentParser(); p.add_argument('--data',default=str(ROOT/'data/es_daily_yahoo.csv')); p.add_argument('--out',required=True)
    p.add_argument('--n',type=int); p.add_argument('--seed',type=int,default=1); p.add_argument('--since',default='2016-01-01'); p.add_argument('--until',default='9999-12-31'); p.add_argument('--stratify-by-year',action='store_true'); a=p.parse_args()
    rows=load(a.data); pool=eligible(rows,a.since,a.until); rng=random.Random(a.seed)
    if a.n is not None and not 0<a.n<=len(pool): p.error('--n must be positive and no larger than eligible pool')
    if a.stratify_by_year:
        groups={}
        for i in pool: groups.setdefault(rows[i]['date'][:4],[]).append(i)
        for v in groups.values(): rng.shuffle(v)
        pool=[]
        while any(groups.values()):
            years=list(groups); rng.shuffle(years)
            for y in years:
                if groups[y]: pool.append(groups[y].pop())
    else: rng.shuffle(pool)
    keys=build(rows,pool[:a.n],a.out,a.seed); print(f'Wrote {len(keys)} samples; private key must never be exposed to candidates.')
if __name__=='__main__': main()
