"""Parse raw WP API pages into one JSONL record per post, split into heading sections with images + text."""
import json, glob, re, html, sys, pathlib
from html.parser import HTMLParser
raw, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
cats = {158:"Announcements",159:"Ask Al",1904:"Bitcoin",1892:"Crude Oil",1698:"DAX 40",153:"Emini & Forex Daily Reports",
        1842:"Forex",1697:"FTSE 100",1964:"Gold",1849:"NASDAQ 100",1851:"Nifty 50",136:"Market Analysis",1843:"SP500 Emini",
        241:"Video",135:"How To Trade Manual",323:"Cryptocurrency",115:"Futures Market",132:"Trading Strategies"}
class P(HTMLParser):
    def __init__(s): super().__init__(); s.secs=[{"heading":None,"images":[],"text":[]}]; s.h=None; s.buf=[]
    def handle_starttag(s,t,a):
        a=dict(a)
        if t in("h1","h2","h3","h4"): s.h=[]
        elif t=="img":
            src=a.get("data-src") or a.get("src") or ""
            if "wp-content/uploads" in src:
                full=re.sub(r"-\d+x\d+(\.\w+)$",r"\1",src)
                s.secs[-1]["images"].append({"url":full,"alt":a.get("alt","")})
        elif t in("p","li","br","div") and s.buf: s.flush()
    def handle_endtag(s,t):
        if t in("h1","h2","h3","h4") and s.h is not None:
            s.flush(); s.secs.append({"heading":re.sub(r"\s+"," ",html.unescape("".join(s.h))).strip(),"images":[],"text":[]}); s.h=None
        elif t in("p","li"): s.flush()
    def handle_data(s,d):
        (s.h if s.h is not None else s.buf).append(d)
    def flush(s):
        t=re.sub(r"\s+"," ","".join(s.buf)).strip(); s.buf=[]
        if t: s.secs[-1]["text"].append(t)
n=0
with open(out,"w") as fo:
    for f in sorted(glob.glob(str(raw/"posts_*.json"))):
        for p in json.load(open(f)):
            pr=P(); pr.feed(p["content"]["rendered"]); pr.flush()
            secs=[s for s in pr.secs if s["text"] or s["images"]]
            rec={"id":p["id"],"date":p["date"],"title":html.unescape(p["title"]["rendered"]),"link":p["link"],
                 "author_id":p["author"],"categories":[cats.get(c,str(c)) for c in p["categories"]],
                 "n_words":sum(len(" ".join(s["text"]).split()) for s in secs),
                 "n_images":sum(len(s["images"]) for s in secs),"sections":secs}
            fo.write(json.dumps(rec,ensure_ascii=False)+"\n"); n+=1
print("wrote",n)
