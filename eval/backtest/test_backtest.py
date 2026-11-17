import importlib.util, json, pathlib, re, subprocess, sys, tempfile, unittest
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from make_samples import *
from run_backtest import *

class BacktestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.rows=load(ROOT/'data/es_daily_yahoo.csv')
    def test_anonymization_and_alignment(self):
        i=eligible(self.rows,'2016-01-01','2016-12-31')[0]; h=self.rows[i-499:i+1]; b,s,o=anonymize(h)
        self.assertEqual(b[-1]['close'],1000); self.assertEqual([r['bar'] for r in b],list(range(-499,1)))
        self.assertFalse(re.search(r'\d{4}-\d{2}-\d{2}',json.dumps(b)))
        for x,y in zip(h,b):
            self.assertAlmostEqual((x['high']-x['low'])*s,y['high']-y['low'],delta=.251)
        with tempfile.TemporaryDirectory() as t:
            out=pathlib.Path(t)/'sample'; keys=build(self.rows,[i],out)
            k=keys[0]; self.assertEqual(k['history'][-1]['date'],self.rows[i]['date']); self.assertEqual(k['forward'][0],self.rows[i+1]); self.assertEqual(k['forward'][4],self.rows[i+5]); self.assertEqual(len(k['forward']),20)
            for f in (out/'public').rglob('*.csv'):
                self.assertFalse(re.search(r'\d{4}-\d{2}-\d{2}',f.read_text()))
                result=subprocess.run(['python3',str(ROOT/'skill/brooks-price-action/scripts/bar_features.py'),str(f),'--json'],capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
            changed=[dict(r) for r in self.rows]; changed[i+1]['high']*=10
            self.assertEqual(anonymize(changed[i-499:i+1]),(b,s,o))
    def test_week_end(self):
        for i in eligible(self.rows,'2016-01-01','2026-12-31'):
            self.assertNotEqual(week(self.rows[i]['date']),week(self.rows[i+1]['date']))
    def test_parse(self):
        p=prediction(1,.6); self.assertEqual(parse_prediction('text\n```json\n'+json.dumps(p)+'\n```'),p)
        self.assertEqual(parse_prediction(json.dumps(p)),p)
        for val in [True,-.1,1.1,float('nan')]:
            with self.assertRaises(ValueError): parse_prediction(json.dumps({**p,'p_up_5':val}))
        with self.assertRaises(ValueError): parse_prediction('```json\n{}\n```')
    def test_barriers(self):
        p={**prediction(1),'target':1010,'stop':990}
        self.assertEqual(barrier(p,[{'high':1020,'low':980}]),'stop')
        self.assertEqual(barrier(p,[{'high':1011,'low':995}]),'target')
        self.assertEqual(barrier({**p,'always_in':'short','target':990,'stop':1010},[{'high':1020,'low':980}]),'stop')
    def test_metrics(self):
        k={'id':'a','index':500,'asof':'2020-01-03','history':[{'close':100}], 'scale':1,'offset':900,'forward':[{'open':100,'high':102,'low':99,'close':101}]*20}
        m=metrics([k],{'a':prediction(1,.8)},0)
        self.assertEqual(m['direction_hit_rate'],1); self.assertAlmostEqual(m['brier'],.04); self.assertAlmostEqual(m['log_loss'],-math.log(.8)); self.assertAlmostEqual(m['strategy']['total_return'],.01)
        m=metrics([k],{'a':prediction(0,.5)}); self.assertEqual(m['direction_coverage'],0); self.assertIsNone(m['direction_hit_rate']); self.assertEqual(m['strategy']['total_return'],0)
    def test_baseline_uses_past(self):
        i=eligible(self.rows,'2016-01-01','2016-12-31')[0]
        with tempfile.TemporaryDirectory() as t:
            keys=build(self.rows,[i],pathlib.Path(t)/'s'); a=baselines(keys); keys[0]['forward'][0]['close']=1e9; self.assertEqual(a,baselines(keys))
    def test_overlap(self):
        def key(i): return {'id':str(i),'index':i,'asof':'2020-01-03','history':[{'close':100}],'scale':1,'offset':900,'forward':[{'open':100,'high':102,'low':99,'close':101}]*20}
        keys=[key(i) for i in (500,504,510)]; m=metrics(keys,{k['id']:prediction(1,.6) for k in keys},0)
        self.assertEqual(m['n'],3); self.assertEqual(m['strategy']['n'],2)
if __name__=='__main__': unittest.main()
