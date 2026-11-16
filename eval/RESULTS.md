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
