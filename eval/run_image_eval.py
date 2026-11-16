#!/usr/bin/env python3
"""Screenshot-only blind candidate track; references are supplied only to judges."""
import argparse
import concurrent.futures as cf
import json
import random
import shutil
from pathlib import Path

from run_eval import ROOT, CASES, SKILL, run, judge, cached_score, summarize

CONDITIONS = ('image_clean', 'image_labels', 'image_clean_skill')
PROMPT = """Read the PNG at {image} using Read. Give a Brooks-style reading of the S&P 500 E-mini
(ES) DAILY chart as of the last visible bar. This is screenshot mode: no OHLC is supplied.
Use only the chart{skill_clause}. Do not browse the web, search for analyst posts, inspect other files,
or retrieve historical examples. Do not infer hidden bars or claim precise dates or prices you cannot read.
Cover market state, Always In direction, major swing anchors and patterns, bulls versus bears,
key levels/magnets, and what traders will watch next. Write in English, fewer than 500 words.
{instruction}"""


def one(case, cond, out, prepared, judges=3):
    d = out / f"{case['id']}_{cond}"; d.mkdir(parents=True, exist_ok=True)
    cached = cached_score(d, judges)
    if cached is not None: return cached
    image = d / 'chart.png'
    shutil.copyfile(prepared['labels' if cond == 'image_labels' else 'clean'], image)
    skill = cond == 'image_clean_skill'
    prompt = PROMPT.format(image=image, skill_clause=' and the skill instructions' if skill else '',
                           instruction=f'Read {SKILL}/SKILL.md first. Follow its screenshot procedure and template; you may read its methodology and glossary, but do not use examples or retrieval data.' if skill else '')
    cmd = ['claude', '-p', prompt, '--allowedTools', 'Read', '--add-dir', str(d)]
    if skill: cmd.append(str(SKILL))
    candidate_path = d / 'candidate.md'
    cand = candidate_path.read_text() if candidate_path.exists() else run(cmd, cwd=d)
    candidate_path.write_text(cand)
    score = judge(case, cand, d, judges)
    score.update(id=case['id'], date=case['date'][:10], cond=cond)
    (d / 'score.json').write_text(json.dumps(score, indent=2))
    return score


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--n', type=int, default=8); p.add_argument('--seed', type=int, default=1)
    p.add_argument('--conditions', default=','.join(CONDITIONS))
    p.add_argument('--out', default='eval/runs/image_dev')
    p.add_argument('--manifest', type=Path, default=ROOT / 'eval/runs/images/manifest.json')
    p.add_argument('--since', default='2016-01-01'); p.add_argument('--split', default='dev')
    p.add_argument('--workers', type=int, default=3); p.add_argument('--judges', type=int, default=3)
    a = p.parse_args()
    if a.judges < 1 or a.workers < 1: p.error('judges and workers must be positive')
    conditions = a.conditions.split(',')
    if not set(conditions) <= set(CONDITIONS): p.error('unknown condition')
    prepared = {str(r['id']): r for r in json.loads(a.manifest.read_text())['records'] if r['status'] == 'ok' and r.get('blind_eligible', False)}
    cases = [c for c in map(json.loads, CASES.read_text().splitlines()) if c['date'] >= a.since and c.get('split') == a.split]
    random.Random(a.seed).shuffle(cases)
    # Select before checking availability, so missing images do not silently change the sample.
    cases = cases[:a.n]
    out = (ROOT / a.out).resolve(); out.mkdir(parents=True, exist_ok=True)
    skipped = [{'id': c['id'], 'reason': 'no successful blind-eligible prepared image'} for c in cases if str(c['id']) not in prepared]
    (out / 'skipped.json').write_text(json.dumps(skipped, indent=2))
    jobs = [(c, k) for c in cases if str(c['id']) in prepared for k in conditions]
    res = []
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for s in ex.map(lambda j: one(*j, out, prepared[str(j[0]['id'])], a.judges), jobs):
            print(json.dumps(s)[:300], flush=True); res.append(s)
    summarize(res, conditions, out)


if __name__ == '__main__': main()
