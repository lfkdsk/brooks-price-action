"""Build eval cases from weekend E-mini reports (daily-chart section = reference). Usage: build_eval_cases.py posts.jsonl out.jsonl"""
import collections, datetime, json, random, re, sys
out = []
for l in open(sys.argv[1]):
    r = json.loads(l)
    if "Market Analysis" not in r["categories"]: continue
    if datetime.date.fromisoformat(r["date"][:10]).weekday() < 5: continue  # weekend reports: written after Friday close
    secs = {(s["heading"] or "").lower(): s for s in r["sections"]}
    daily = next((s for h, s in secs.items() if "daily" in h and re.search(r"e-?mini|s&p", h) and len(s["text"]) >= 5), None)
    if not daily: continue
    weekly = next((s for h, s in secs.items() if "weekly" in h and re.search(r"e-?mini|s&p", h) and len(s["text"]) >= 5), None)
    overview = next((s["text"] for h, s in secs.items() if "overview" in h), [])
    out.append({"id": r["id"], "date": r["date"], "title": r["title"], "link": r["link"], "timeframe": "daily", "instrument": "ES",
                "images": [i["url"] for i in daily["images"]], "reference": overview + daily["text"],
                "weekly_reference": weekly["text"] if weekly else []})
random.Random(0).shuffle(out)
for i, o in enumerate(out): o["split"] = "dev" if i % 3 == 0 else "test"
with open(sys.argv[2], "w") as f:
    for o in sorted(out, key=lambda x: x["date"]): f.write(json.dumps(o, ensure_ascii=False) + "\n")
print(len(out), collections.Counter(o["split"] for o in out))
