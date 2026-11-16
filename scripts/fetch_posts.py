"""Fetch all posts from brookstradingcourse.com via the public WP REST API into JSONL (resumable)."""
import json, sys, time, urllib.request, pathlib
OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
API = "https://www.brookstradingcourse.com/wp-json/wp/v2/posts"
FIELDS = "id,date,slug,link,title,content,excerpt,categories,tags,author"
page = 1
while True:
    f = OUT / f"posts_{page:03d}.json"
    if not f.exists():
        url = f"{API}?per_page=100&page={page}&orderby=date&order=desc&_fields={FIELDS}"
        req = urllib.request.Request(url, headers={"User-Agent": "personal-study-fetcher/1.0"})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    total_pages = int(r.headers.get("X-WP-TotalPages", 0)); body = r.read()
                break
            except urllib.error.HTTPError as e:
                if e.code == 400: print("done"); sys.exit(0)
                time.sleep(5 * (attempt + 1))
            except Exception: time.sleep(5 * (attempt + 1))
        else: sys.exit(f"failed page {page}")
        f.write_bytes(body); print(f"page {page}/{total_pages} {len(body)//1024}KB", flush=True)
        time.sleep(1.5)
    page += 1
