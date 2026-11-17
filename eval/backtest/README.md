# Forward chart-reading backtest

This measures realized outcomes after a reading, rather than agreement with an analyst.
All implementation files are new; the existing evaluation and skill are untouched.
Python 3 standard library only. No LLM job is launched by tests, sampling, extraction-job
preparation, or scoring cached candidates. Candidate execution requires `--run-candidates`.

## Workflow

From the repository root:

```sh
python3 eval/backtest/make_samples.py --n 100 --seed 7 --since 2016-01-01 --until 2026-11-30 --stratify-by-year --out /tmp/chart-samples
python3 -m unittest discover -s eval/backtest -p test_backtest.py -v
# Operator launches this only in an isolated candidate environment (see below):
python3 eval/backtest/run_backtest.py --samples /tmp/chart-samples --out /tmp/chart-results --run-candidates --cost-ticks 1 --bootstrap 1000
# Re-score cached responses without launching a CLI:
python3 eval/backtest/run_backtest.py --samples /tmp/chart-samples --out /tmp/chart-results
```

Omit `--n` for all eligible weeks. A sample requires 500 past bars including as-of and
20 subsequent bars. Week ends use ISO weeks and actual last trading days, including
Thursday holiday closes. The latest incomplete/data-end weeks are ineligible. Stratification
round-robins shuffled years (approximately equal year counts, not population weighting).
Set `--data data/spx_daily_yahoo.csv` for SPX; costs remain 0.25 source price units per tick
and should be changed/interpreted accordingly. Paths can be absolute.

Each public sample contains `bars.csv` and `weekly.csv`, both with `bar,open,high,low,close`.
Daily labels are -499..0. The feature script falls back to row index for its internal time
labels, which refer to positions 0..499 rather than these signed labels. Weekly data is
precomputed using actual ISO weeks privately, then labeled by week index. Its oldest
week may be partial because the window starts midweek. Run the feature script on each
file separately, WITHOUT `--weekly`; that flag tries to parse ISO dates and will fail.
Both prompts end with the requested fenced JSON forecast contract.

Prices are transformed by `anonymous = original * scale + offset`, where scale is
500 divided by the historical high-low span and offset makes the final close exactly
1000. Each price is rounded to the nearest 0.25 output units (Python ties-to-even).
This is a fixed anonymized tick-equivalent, not the original contract's transformed tick;
rounding perturbs each value by at most 0.125 and each range by at most 0.25. Positive
scale preserves geometry before rounding. Forward scoring transforms raw future prices
without quantization so thresholds refer to actual source observations. Strategy returns
and costs always use original prices, never the artificial price denominator.

`private/key.json` stores history dates, as-of dates, forward bars, scale/offset, source
indices and expanding historical base rates. Its directory is mode 0700. IDs are seeded
random numbers independent of dates; only these IDs appear in the public manifest.
`asof >= 2026-07-01` defines the private `post_cutoff` flag, never exposed to candidates.

## Leakage and contamination controls

- All transformations, EMA and momentum features use only bars through as-of. Base rates
  use only historical five-bar outcomes already observable at as-of (never the test labels).
- Forward bar 1 is the next trading bar; the direction label compares forward bar 5 with
  the as-of close, strictly greater. There are no publication texts in candidate inputs.
- Candidates run in a temporary staging directory with only the two anonymous CSVs and,
  for `skill`, SKILL.md, references/*.md and bar_features.py. No retrieval script, index,
  private key, source data or evaluator files are copied. Baseline sees no staged skill.
  CLI stdin is DEVNULL. Responses are cached by sample, condition and SHA256 of prompt
  and staged file contents. Invalid JSON/CLI failures are recorded, excluded from scores,
  and counted explicitly. Missing cached candidates do not trigger jobs by default.
- **Staging, CLI allowedTools, and chmod are not a security sandbox.** The supplied runner
  does not prevent an agent or its Python subprocess from reading absolute repository
  paths, user-installed skills, ambient Claude configuration, or network resources. For a
  leakage-controlled experiment, the operator must run candidates in a container/VM with
  only staging inputs mounted, a clean home/config, and network access restricted to the
  model API. Keep private keys and scoring in a separate host process. The convenience
  runner alone supports procedural blinding, not adversarial isolation. Audit raw responses.
- Anonymization reduces date/level cues but distinctive shapes can still be memorized.
  Skill references can themselves encode historical examples. The post-cutoff subset is
  a sensitivity analysis, not proof of exclusion from training. Model version/cutoff is
  operator-dependent. Do not tune prompts on test outcomes; freeze prompts/model/settings
  and report sample seed, selection, failures, full coverage and post-cutoff counts.
- Tests verify date-free inputs, transform errors and endpoint, feature-script compatibility,
  future perturbation invariance, week-end selection, forward alignment, past-only baselines,
  strict prediction validation, same-bar stops, overlap handling and toy scoring.

## Scoring conventions

The report and JSON contain overall and post-cutoff results, calibration deciles,
parse/execution failures, target/stop outcomes, and dated equity curves.
Always In determines +1/-1/0; unclear is excluded only from directional hit rate and its
coverage is reported. Probabilities are scored even for unclear. Equality at +5 is a
negative outcome for the stated strictly-up event. Log loss clips probabilities to
[1e-15,1-1e-15]. Deciles use [0,.1), ..., [.9,1].

Target/stop scoring requires both levels on the appropriate sides of 1000 and a nonzero
direction. Invalid levels are reported separately. On each of at most 20 daily bars,
stop is checked first, including if both barriers are hit. Unreached, invalid and absent
setups are distinguished; target-first rate divides by valid setups including neither-hit.
It is a barrier event statistic, not a fill-price/P&L simulation; gap fills are not modeled.

The strategy enters at as-of close, exits close +5, compounds source-price returns and
subtracts `cost_ticks * 0.25 / entry` per active round trip. Close entry assumes execution
at the observed close (potential optimism). To ensure no overlapping positions even on
holiday weeks, greedily keep chronological entries at least five source bars apart.
Direction/probability scores still use all selected observations. Cash periods count as
zero strategy return. Strategy hit rate includes cash as non-winning. Sharpe uses sample
standard deviation, zero risk-free rate and sqrt(252/5); zero variance yields null.
Drawdown includes initial equity 1. Returns are unlevered price returns, not futures margin
returns, interest, collateral income or contract-dollar P&L.

Mechanical comparisons use exactly the candidate's valid sample IDs (and the same
nonoverlap rule): `buy_hold` is always-long during selected five-bar windows, `ema20` uses
500-bar-seeded EMA20, `momentum20` compares closes 20 bars apart (ties cash), and
`base_rate` forecasts the expanding past-only up frequency with no directional position.
Thus buy_hold is a matched-window long benchmark, not continuous calendar buy-and-hold
across unsampled gaps. Coin flip has independent fair long/short draws and probability
0.5; metrics are averaged over 1000 seeded draws. Its equity path is not meaningful as an
average, so only scalar strategy metrics are reported. Deterministic directional baselines
forecast probabilities 0/1, which can incur very large clipped log loss.

For every comparison, deltas are candidate minus baseline; lower Brier is better.
Paired percentile bootstrap resamples sample IDs jointly and recomputes hit rate, Brier
and Sharpe, including coverage behavior. Bootstrap strategy draws are synthetic consecutive
five-bar periods (duplicates allowed); original chronological overlap skipping does not
apply inside a bootstrap draw. Coin-flip CIs also integrate fresh random directions per
draw. Null metrics (no coverage or zero variance) are omitted from that CI and valid-draw
counts are reported. Base-rate hit/Sharpe deltas are null because it abstains from direction.
IID bootstrap is approximate: adjacent five-bar labels can overlap and returns have serial
correlation. Use block bootstrap and larger samples for stronger inference. Multiple
baseline/subset comparisons are not multiplicity-adjusted.

## Brooks' own directional bias

```sh
python3 eval/backtest/brooks_bias.py --out /tmp/brooks-extraction
# Operator supplies JSON object keyed by post ID, values raw judge responses or forecast objects:
python3 eval/backtest/brooks_bias.py --extractions /tmp/extractions.json --out /tmp/brooks-scored
```

Preparation writes extraction prompts and a strict JSON schema, without calling an LLM.
Judge sees only the fixed daily text (including heading), and must separate the analyst's
net bias from opposing scenarios. Targets/stops are null; rough probability is explicitly
an interpretation, not necessarily a numeric claim in the original post. Scoring uses the
last source close strictly before weekend publication, real source prices and the same
metrics/baselines. Duplicate as-of dates are kept once. Extractions with insufficient
history/forward data are ineligible. This track is inherently unblinded and susceptible
to text memorization; compare its scores descriptively, not as a fair anonymous-model contest.

## Limits

Five-bar outcomes are noisy, small samples and the post-cutoff subset have wide uncertainty,
and weekly dates are not perfectly five trading bars apart. Sparse samples' equity curves
omit unsampled market exposure; Sharpe annualization assumes five-bar observation cadence,
not actual elapsed calendar years. Yahoo continuous ES has roll gaps and vendor/session
mismatches. No volume, intraday path, realistic slippage or executable trading rules are
modeled. Readings may describe good long-horizon structure while failing this short test.
