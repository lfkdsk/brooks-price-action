# brooks-price-action

A Claude Code skill (plus tooling and an evaluation harness) for reading candlestick charts in the style of
**Al Brooks' price action** analysis: bar-by-bar context, trend vs. trading range, Always In direction,
bulls-vs-bears arguments, measured-move/magnet targets and "traders will watch" conditions.

> 中文简介：一个让 Claude 用 Al Brooks 价格行为方法读图的 skill，配套 OHLC 特征脚本、相似历史案例检索，
> 以及对照 Brooks Trading Course 周末分析帖的盲测评测框架。

**Not affiliated with Brooks Trading Course.** This repo contains no posts, chart images or other content
from brookstradingcourse.com. The reference files are notes written in our own words, with short cited
quotations for commentary. If you want the source material, read it on the
[official site](https://www.brookstradingcourse.com/analysis/). Nothing here is financial advice.

## Layout

```
skill/brooks-price-action/        # the Claude Code skill
  SKILL.md                        # reading procedure, focus rules, output template, hard rules
  references/methodology.md       # market cycle, Always In, breakouts, reversals, bar counting, stated odds (cited)
  references/glossary.md          # ~130 terms & abbreviations
  references/examples.md          # paraphrased worked examples (weekly / daily / pre-open / 5-min)
  scripts/bar_features.py         # OHLC -> bar types, EMA gap bars, swings (minor + major), H/L counts,
                                  #   wedge candidates, measured moves, trading-range evidence, weekly resample
  scripts/similar_cases.py        # optional: nearest past readings by chart-state features (needs a local index)
scripts/                          # build a local study corpus (personal use; not redistributed)
  fetch_posts.py  parse_posts.py  fetch_images.py  fetch_es_yahoo.py  build_eval_cases.py
eval/run_eval.py                  # blind eval: Claude reads OHLC -> Codex judges vs the analyst's reading
eval/RESULTS.md                   # current numbers and takeaways
docs/codex_design_report.md       # design notes produced by Codex
```

## Install the skill

```bash
mkdir -p ~/.claude/skills
cp -r skill/brooks-price-action ~/.claude/skills/
```

Then ask Claude Code something like *"Brooks-style read of ES daily"* with a CSV or chart screenshot.
`bar_features.py` is stdlib-only Python 3.9+:

```bash
python3 skill/brooks-price-action/scripts/bar_features.py es_daily.csv --tick 0.25 --last 40 --weekly --drop-last
```

## Optional: local corpus, retrieval index and eval

These steps download public posts for **your own local study**; the outputs are git-ignored. Respect the
site's terms and do not republish what you download.

```bash
python3 scripts/fetch_posts.py data/raw                 # WordPress REST API, polite rate limit
python3 scripts/parse_posts.py data/raw data/posts.jsonl
python3 scripts/fetch_es_yahoo.py data/es_daily_yahoo.csv
python3 skill/brooks-price-action/scripts/similar_cases.py build \
    --posts data/posts.jsonl --ohlc data/es_daily_yahoo.csv --out skill/brooks-price-action/data/case_index.jsonl
python3 scripts/build_eval_cases.py data/posts.jsonl eval/es_daily_cases.jsonl
python3 eval/run_eval.py --n 12 --split dev --conditions skill,baseline --out eval/runs/dev   # needs `claude` and `codex` CLIs
```

## Status

On 12 dev cases the skill does **not** yet beat the base model (≈40/60 for all variants); see
[eval/RESULTS.md](eval/RESULTS.md) for numbers, likely confounds and next steps.

## License

Code: MIT. Notes in `skill/…/references/` are original summaries; quoted fragments remain © their authors.

## Forward test

[forward/](forward/README.md) provides a prospective daily **paper-trading test (模拟仓)**:
Claude with/without the skill versus mechanical baselines, a Cloudflare Worker/D1 dashboard,
and a Python collector with Linux scheduling instructions. Predictions are recorded before
future outcomes exist. Setup is operator-run; no orders are placed and nothing is deployed
by default. Paper trading only, not financial advice.
