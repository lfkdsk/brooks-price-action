# Eval results (dev split, 12 cases, seed 2)

Task: Brooks-style reading of the ES **daily** chart as of the Friday close before a weekend report.
Candidate = headless Claude Code; judge = Codex, comparing against the report's daily-chart section
(never shown to the candidate). Each dimension 0–10; total = six dimensions − hallucination penalty (max 60).

| Condition | Always In | State | Patterns | Levels | Bulls/Bears | Watch | Halluc. ↓ | **Total** |
|---|---|---|---|---|---|---|---|---|
| baseline (no skill) | 8.4 | 8.2 | 5.2 | 6.2 | 7.4 | 6.8 | 2.7 | **39.7** |
| v2 skill (rules + focus) | 8.3 | 8.2 | 5.4 | 6.8 | 7.4 | 6.8 | 2.8 | **40.2** |
| v3 skill (+ major swings) | 8.4 | 8.0 | 5.4 | 6.8 | 7.2 | 6.8 | 2.8 | **39.8** |
| v4 skill + similar-case retrieval | 8.5 | 8.1 | 5.5 | 6.5 | 7.3 | 6.7 | 3.1 | **39.5** |

An earlier v1 run (10 weekday cases) gave 30.7 (skill) vs 31.2 (baseline); those cases had an as-of mismatch
(pre-open posts referring to the same day's overnight action) and were replaced by weekend-only cases.

## Takeaways
- The base model already knows Brooks' vocabulary and reasoning; the skill does not measurably change scores yet.
- Largest remaining gaps: **which major swings anchor wedges / measured moves**, and naming the analyst's single
  main story (e.g. "parabolic wedge buy climax", "expanding triangle", "final flag").
- Likely confounds: Yahoo `ES=F` is an unadjusted continuous contract (roll gaps shift swing points vs. the
  analysts' charts); single-sample LLM judging is noisy; 12 cases is too few to detect a 1–2 point effect.

## Next
- Re-run on an index series without roll gaps (e.g. `^GSPC`), judge each case 3× to measure noise, then run the
  208-case test split.
- Image-based eval: give the chart image (annotations cropped) instead of OHLC.

---

# Round 2 (2026-11-16): judge noise + image track

Same 12 dev cases (seed 2). Every reading judged **3×** by independent Codex calls.

**Judge noise is small:** mean per-case SD of the total across 3 judges = 0.6–1.3 points. The case-to-case
spread (SE ≈ 1.0–1.4 over 12 cases) dominates, so more cases matter more than more judges.

| Condition | n | Total (mean ± SE) | Levels | Halluc. ↓ |
|---|---|---|---|---|
| OHLC baseline (v2 candidates re-judged) | 12 | 38.7 ± 1.4 | 6.0 | 2.7 |
| OHLC skill v2 (re-judged) | 12 | 39.9 ± 1.1 | 6.7 | 2.7 |
| Image, annotations removed | 6 | 38.4 ± 2.6 | 7.3 | 3.9 |
| Image, annotations kept (title cropped) | 6 | 39.7 ± 3.8 | 7.9 | 3.7 |
| Image, annotations removed + skill | 6 | 39.4 ± 2.8 | 7.4 | 3.7 |

Paired differences: OHLC skill − baseline = **+1.2 ± 1.0** (skill wins 8/12); image labels − clean = +1.3 ± 1.4;
image skill − clean = +0.9 ± 0.6. Only 6/12 cases had a blind-eligible daily image (older layouts are skipped).

Reading:
- The skill's effect is small and positive but not yet significant; needs ~40+ paired test cases.
- Reading the analyst's own chart image gives better **levels** (7.3–7.9 vs 6.0–6.7) — the image's window and
  scale match what the analyst looked at, which addresses the swing-anchor gap — but more hallucinated detail.
- Annotations (red swing-date labels) help a little, consistent with anchor choice being the main gap.

---

# Round 3 (2026-11-16): 40-case test split + forward backtest

## Agreement with analysts, test split (n=40, seed 3, 1 judge)
| Condition | Total |
|---|---|
| OHLC baseline | 37.5 |
| OHLC skill v4 | 37.4 |

Paired skill − baseline = **−0.2 ± 0.6** (16 wins / 20 losses / 4 ties). On held-out cases the skill does not change
agreement with the analysts. (The dev-set +1.2 did not replicate.)

## Forward backtest (does the reading predict the next 5 bars?)
60 weekly as-of points 2016–2026 (stratified by year, seed 7), **anonymized** (no dates/instrument, last close =
1000). The candidate ends with a JSON forecast; scored on the following real bars. Responses audited: none mention
real years, instrument names or data files. Only 1 sample is after 2026-07-01, so the post-cutoff subset is unusable.

| | 5-bar direction hit (coverage) | Brier (p_up_5) | Strategy Sharpe* | Target before stop |
|---|---|---|---|---|
| Claude + skill | 63.5% (87%) | 0.241 | 0.34 | 37% |
| Claude, no skill | 63.2% (95%) | 0.237 | 0.52 | 44% |
| buy & hold | ~58% | — | ~−0.2 | — |
| EMA20 side | ~57% | — | ~−0.4 | — |
| coin flip | ~50% | — | — | — |
| constant historical base rate | — | ~0.235 | — | — |

*Hold the Always In direction for 5 bars on 60 non-overlapping weeks, 1 tick cost; Sharpe from 60 points is very noisy.

Reading:
- Both LLM conditions call 5-bar direction ~5–6 points better than buy & hold / EMA20 and ~13 points better than a
  coin, but **every bootstrap 95% CI on those deltas includes 0** at n=60.
- **Probabilities are not informative**: Brier ≈ the constant base-rate forecast.
- The skill does not beat plain Claude on any forward metric (slightly fewer target-first outcomes).
- Earlier JSON-parse failures came from free-form `state` labels; the parser now normalizes `state` (unscored).
