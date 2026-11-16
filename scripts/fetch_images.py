"""Download chart images for posts in a category (resumable). Usage: fetch_images.py posts.jsonl outdir "Market Analysis" """
import json, sys, time, pathlib, urllib.request, concurrent.futures as cf
posts, out, cat = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3]
SKIP = ("thumbnail", "youtube", "eod-review", "logo", "avatar", "banner")
jobs = []
for l in open(posts):
    r = json.loads(l)
    if cat not in r["categories"]: continue
    for s in r["sections"]:
        for im in s["images"]:
            u = im["url"]
            if any(k in u.lower() for k in SKIP): continue
            jobs.append((r["id"], u))
print(len(jobs), "images", flush=True)
def get(job):
    pid, u = job; f = out / str(pid) / u.rsplit("/", 1)[-1]
    if f.exists() and f.stat().st_size > 0: return "skip"
    f.parent.mkdir(parents=True, exist_ok=True)
    for a in range(4):
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "personal-study-fetcher/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r: data = r.read()
            f.write_bytes(data); time.sleep(0.3); return "ok"
        except urllib.error.HTTPError as e:
            if e.code == 404: return "404"
            time.sleep(3 * (a + 1))
        except Exception: time.sleep(3 * (a + 1))
    return "fail"
stats = {}
with cf.ThreadPoolExecutor(4) as ex:
    for i, res in enumerate(ex.map(get, jobs)):
        stats[res] = stats.get(res, 0) + 1
        if i % 500 == 0: print(i, stats, flush=True)
print("done", stats)
