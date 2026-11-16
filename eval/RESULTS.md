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
