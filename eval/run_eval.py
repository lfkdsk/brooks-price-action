#!/usr/bin/env python3
"""Blind eval: candidate reads ES daily OHLC as of a Brooks post date; Codex judges vs the post's daily-chart text.

Usage: run_eval.py --n 8 --seed 1 --conditions skill,baseline --out eval/runs/<name>
Candidate = `claude -p` (headless).  Judge = `codex exec`.  Reference text never reaches the candidate.
"""
import argparse, csv, json, os, random, subprocess, pathlib, concurrent.futures as cf, statistics, math

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skill" / "brooks-price-action"
CASES = ROOT / "eval" / "es_daily_cases.jsonl"
OHLC = ROOT / "data" / "es_daily_yahoo.csv"
CODEX = os.path.expanduser("~/.local/bin/codex")

def cut_ohlc(date, dst, n=700):
    rows = list(csv.reader(open(OHLC)))
    hdr, body = rows[0], [r for r in rows[1:] if r[0] < date[:10]]   # strictly before publication day
    with open(dst, "w", newline="") as f:
        w = csv.writer(f); w.writerow(hdr); w.writerows(body[-n:])
    return body[-1][0]

PROMPT_SKILL = """You are evaluating a chart-reading skill. Read {skill}/SKILL.md first and follow it, consulting its
references/ files as it says. Task: give a Brooks-style reading of the S&P 500 E-mini (ES) DAILY chart as of the
close of {last}. OHLC (continuous futures, may differ from other data vendors by a roll offset) is at {csv}.
Run: python3 {skill}/scripts/bar_features.py {csv} --tick 0.25 --last 60 --weekly
Use ONLY that data; do not search the web or look for posts about this date. Write the final reading in English
using the skill's template headings. Keep it under 500 words."""

PROMPT_RAG = PROMPT_SKILL.replace("Use ONLY that data;",
 "Also run: python3 {skill}/scripts/similar_cases.py query --index {skill}/data/case_index.jsonl --csv {csv} --k 3\nand use those past readings as calibration (step 0.5 of the skill: similar past readings). Use ONLY that data;")

PROMPT_BASE = """Give an Al Brooks price-action style reading of the S&P 500 E-mini (ES) DAILY chart as of the close
of {last}. OHLC data is at {csv} (you may read it with any tool). Use ONLY that data; do not search the web.
Cover the current market state, bulls vs bears, Always In direction, and what traders will watch next.
Write in English, under 500 words."""

JUDGE = """You are grading a price-action chart reading against a reference reading written by a Brooks Trading
Course analyst for the same chart and date. Price levels may be offset because data vendors differ; judge
structure and reasoning, not exact numbers. Score each dimension 0-10 and return ONLY JSON:
{{"always_in": <0-10 agreement on Always In / directional bias (unclear vs unclear counts as agreement)>,
 "market_state": <trend vs trading range vs pullback; cycle phase>,
 "patterns": <overlap of named structures: wedge, DT/DB, flags, MTR, final flag, measured move...>,
 "levels": <same key swing points / EMA / magnets identified (by date or role)>,
 "bulls_bears": <both sides' wants/needs similar to the reference>,
 "watch": <the 'traders will watch' conditions match>,
 "hallucination_penalty": <0-10, 10 = invents facts not supported by data>,
 "summary": "<one sentence on the biggest difference>"}}

The reference may also discuss the weekly chart; the candidate may use weekly context too.

REFERENCE ({date}, {title}):
{ref}

CANDIDATE:
{cand}
"""

def run(cmd, cwd=None, timeout=900):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
    if p.returncode:
        raise RuntimeError(f"{cmd[0]} exited {p.returncode}: {p.stderr[-500:]}")
    return p.stdout.strip() or p.stderr.strip()

DIMS = ["always_in", "market_state", "patterns", "levels", "bulls_bears", "watch", "hallucination_penalty"]


def judge(case, cand, d, judges=1):
    """Independent judge processes; population std measures within-case judge dispersion."""
    ref = "\n".join("- " + t for t in case["reference"])
    jp = JUDGE.format(date=case["date"][:10], title=case.get("title", ""), ref=ref, cand=cand)
    scores = []
    for i in range(judges):
        path = d / ("judge.txt" if judges == 1 else f"judge_{i + 1}.txt")
        txt = ""
        try:
            path.unlink(missing_ok=True)
            raw = run([CODEX, "exec", "--skip-git-repo-check", "-o", str(path), jp], cwd=d)
            txt = path.read_text() if path.exists() else raw
            score = json.loads(txt[txt.index("{"): txt.rindex("}") + 1])
            for dim in DIMS:
                v = score[dim]
                if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 10:
                    raise ValueError(f"invalid {dim}")
            scores.append(score)
        except (ValueError, KeyError, TypeError, RuntimeError, OSError, subprocess.TimeoutExpired) as e:
            scores.append({"error": str(e), "raw": txt[-500:]})
    result = {"judges": judges, "judge_scores": scores}
    valid = [s for s in scores if "error" not in s]
    result["valid_judges"] = len(valid)
    if len(valid) != judges:
        result["error"] = "One or more judges failed; incomplete scores excluded from summaries"
    if valid:
        means = {dim: statistics.mean(s[dim] for s in valid) for dim in DIMS}
        result.update(means)  # preserve existing top-level scoring interface
        result["mean"] = means
        result["std"] = {dim: statistics.pstdev(s[dim] for s in valid) for dim in DIMS}
        result["summary"] = valid[0].get("summary", "")
    return result


def cached_score(d, judges):
    path = d / "score.json"
    if path.exists():
        score = json.loads(path.read_text())
        if score.get("judges", 1) == judges and "error" not in score:
            return score


def one(case, cond, out, judges=1):
    d = out / f"{case['id']}_{cond}"; d.mkdir(parents=True, exist_ok=True)
    cached = cached_score(d, judges)
    if cached is not None: return cached
    csvp = d / "bars.csv"; last = cut_ohlc(case["date"], csvp)
    prompt = {"skill": PROMPT_SKILL, "skillrag": PROMPT_RAG, "baseline": PROMPT_BASE}[cond].format(skill=SKILL, csv=csvp, last=last)
    candidate_path = d / "candidate.md"
    cand = candidate_path.read_text() if candidate_path.exists() else run(["claude", "-p", prompt, "--allowedTools", "Bash(python3:*) Read", "--add-dir", str(SKILL), str(d)], cwd=d)
    candidate_path.write_text(cand)
    s = judge(case, cand, d, judges)
    s.update({"id": case["id"], "date": case["date"][:10], "cond": cond})
    (d / "score.json").write_text(json.dumps(s, indent=1))
    return s


def summarize(res, conditions, out):
    for k in conditions:
        rs = [r for r in res if r["cond"] == k and "error" not in r]
        if not rs: continue
        avg = {d: round(sum(r[d] for r in rs) / len(rs), 2) for d in DIMS}
        avg["total"] = round(sum(avg[d] for d in DIMS[:-1]) - avg["hallucination_penalty"], 2)
        print(k, len(rs), avg)
        (out / f"summary_{k}.json").write_text(json.dumps(avg, indent=1))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=8); ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--conditions", default="skill,baseline"); ap.add_argument("--out", default="eval/runs/dev")
    ap.add_argument("--since", default="2016-01-01"); ap.add_argument("--split", default="dev"); ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--judges", type=int, default=1)
    a = ap.parse_args()
    if a.judges < 1: ap.error("--judges must be positive")
    cases = [c for c in map(json.loads, open(CASES)) if c["date"] >= a.since and c.get("split") == a.split]
    random.Random(a.seed).shuffle(cases); cases = cases[: a.n]
    out = ROOT / a.out; out.mkdir(parents=True, exist_ok=True)
    jobs = [(c, k) for c in cases for k in a.conditions.split(",")]
    res = []
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for s in ex.map(lambda j: one(*j, out, a.judges), jobs):
            print(json.dumps(s)[:300], flush=True); res.append(s)
    summarize(res, a.conditions.split(","), out)

if __name__ == "__main__":
    main()
