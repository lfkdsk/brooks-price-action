---
name: brooks-price-action
description: Read candlestick charts the way Al Brooks / Brooks Trading Course analysis posts do — bar-by-bar context, trend vs trading range, Always In direction, bulls-vs-bears arguments, measured-move/magnet targets and "traders will watch" conditions. Use when the user shares a chart screenshot or OHLC data (or names a symbol + timeframe) and asks for price-action / Brooks-style reading, 读图, K线分析, Always In, H2/L2, wedge, MTR, trading range, breakout follow-through, or a weekly/daily/5-minute market update.
---

# Brooks-style price action reading

Goal: produce the kind of reading a Brooks Trading Course analysis post gives — not a pattern label, but
*where the market is in the cycle, what each side wants and needs, which way is Always In, and what
specific evidence next would change the read*. Describe; never promise. This is analysis, not advice.

References (load as needed):
- `references/methodology.md` — market cycle, Always In, trends vs ranges, breakouts, reversals, bar counting,
  trader's equation, stated probabilities (with corpus sources).
- `references/glossary.md` — terms and abbreviations (H1/H2, L1/L2, ii, oo, MTR, BOM, 20GB, final flag…).
- `references/examples.md` — short paraphrased examples of real weekly / daily / 5-min readings.
- `scripts/bar_features.py` — computes bar facts from OHLC so you do not eyeball them.

## 0. Get the data straight first

1. Identify instrument, timeframe, session, timezone, and the as-of time. Ask only if truly unknowable.
2. **Prefer OHLC.** If you have a data tool (e.g. a brokerage historicals tool) or a CSV, write the bars to a
   CSV (`date,open,high,low,close`) and run:
   `python3 scripts/bar_features.py bars.csv --tick <tick> --last 40 [--drop-last] [--weekly]`
   Use `--drop-last` if the latest bar has not closed (e.g. today's daily bar intraday, this week's weekly bar).
   Give at least ~100 bars so the 20-bar EMA and swings are meaningful; for weekly reads use 2+ years.
3. **Screenshot only:** say what you can see vs what you cannot. Describe structure (legs, ranges, the EMA
   relation, obvious bars) and refer to bars by date or "the third bar from the right". Never invent exact
   prices from pixels; use the axis labels only when legible. Treat any arrows/text already drawn on the chart
   as someone else's annotation, not as fact.
4. Multi-timeframe: read the higher timeframe first (weekly → daily → 5-min). A bull weekly chart does not
   mean buy the 5-min chart now; keep both reads.

5. **Similar past readings (E-mini daily/weekly).** If `data/case_index.jsonl` exists, run
   `python3 scripts/similar_cases.py query --index data/case_index.jsonl --csv bars.csv --k 3`
   It returns the 3 most similar past chart states with the reading the analysts wrote then. Use them to calibrate
   *what to emphasize* and *how Brooks frames similar situations* (which swings anchor the wedge, what the default
   expectation was). Do not copy their dates or prices — re-derive everything from the current bars. Only past
   cases are returned, so there is no look-ahead.

The script's thresholds are engineering approximations, not Brooks rules. Its output is evidence; you still
judge context. Its H/L counts and wedge flags are candidates — confirm them by looking at the legs.

## 1. Reading order (do every step)

**Focus rule — one main story.** Brooks posts revolve around *what the most recent bars just did relative to
what traders expected*, and what that implies for the next 1–3 bars. Before writing, answer in one sentence:
"The latest bars were a [strong breakout / disappointing follow-through / failed breakout / climax / pullback
test of X], so the next bars are more likely to [second leg / sideways / test of X]." Build everything around
that. Name at most 2–3 structures (the ones the market is actually reacting to now); a long list of
speculative wedges and targets is worse than one correct emphasis.

**Default expectations to test first** (from the methodology file; check them before anything exotic):
- A strong breakout (consecutive big trend bars closing near extremes, gaps) is usually followed by at least a
  small second leg; the first pullback is usually bought/sold. Do not call "range top test" when the market has
  just broken out strongly with follow-through — say *breakout*, note trapped traders, and expect a second leg.
- Weak follow-through after a breakout bar (doji, tail, bar opposite colour) is a *disappointment*: odds shift
  toward sideways / test back into the range. Say so explicitly ("follow-through was disappointing").
- After a climax (big bar(s) late in a move, far from the EMA) expect sideways-to-opposite (TBTL: ~10 bars, 2
  legs) rather than immediate continuation.
- Inside a trading range most breakout attempts fail: buy low, sell high, expect tests of the middle.
- A pullback in a strong trend tends to find buyers/sellers at the EMA or the prior breakout point; a test of
  the extreme after a trend-line break is where MTRs form.
- Two consecutive strong bars against the prior direction are what make traders wonder whether Always In
  flipped; one bar rarely does.

**Anchor big structures on major swings.** Brooks names wedges, measured moves, final flags and MTRs with
*major* swing points spanning weeks to months (e.g. "wedge top: May 19, Jul 3, Aug 13"; "Leg 1 = Leg 2 from the
Apr 21 low to the May 19 high"). Use the script's `[major swings]` block for these, and the small swings only for
recent pullbacks / micro double tops. Always state measured-move targets with their leg (start → end) and the
all-time high/low or year extremes when the market is near them.

**Use the weekly context for daily reads.** Run the script with `--weekly` (daily data) and say in one or two
lines what the weekly bar and weekly structure imply (e.g. "the week was a bull inside bar at the 20-week EMA —
a pullback in a bull trend"). The daily read must agree with or explicitly contrast with it.

**A. The latest bars.** Describe the last 1–3 bars like a post does: bull/bear/doji, size vs recent bars,
where it closed (near high/low/middle), tails, inside/outside, gap, relation to the 20-bar EMA — and whether
they *met, exceeded or disappointed* the expectation set by the bars before them.
> "This week formed a bear bar closing near its low with a prominent upper tail, closing around the 20-week EMA."

**B. Where in the market cycle?** Strong breakout (spike) → channel (tight → broad) → trading range → breakout
again. Decide: bull trend / bear trend / trading range, and how strong. Evidence of a strong trend:
consecutive big trend bars closing near extremes, little overlap, small tails, gaps (EMA gap bars, 20+ gap
bars), shallow 1–3 bar pullbacks, micro channels. Evidence of a range: overlapping bars, dojis, prominent
tails both ways, repeated EMA crossings, failed breakouts, buy-low-sell-high behaviour, price near the middle.
Default: most markets are in trading ranges most of the time; most breakout attempts from a range fail.

**C. Key levels / magnets.** 20-bar EMA, prior swing highs/lows (name them by date), range high/low/middle,
breakout points and gaps, measured-move targets (leg 1 = leg 2; height of a range projected; spike height),
round numbers, prior week/day/month open/high/low. Say which are likely magnets.

**D. Patterns, as candidates with context.** Double top/bottom (and DT/DB bull/bear flags), wedge (3 pushes;
embedded/parabolic wedge), H1/H2/L1/L2 pullbacks, final flag, MTR (needs a trend-line break, then a test of the
extreme — HL/LL/DB or LH/HH/DT — then a reversal signal), expanding triangle, ii/oo breakout mode, climax/
exhaustion, surprise bar. A pattern only matters at the right place: a sell signal at the bottom of a range is
a weak sell.

**E. Bulls vs bears.** Write both sides explicitly, in this order of thought:
- *Bulls see…* (their interpretation) / *Bulls want…* (the outcome) / *Bulls need…* (the proof: e.g.
  "consecutive strong bull bars closing near their highs above X") / *If the market trades lower, bulls want Y
  to act as support.*
- Same for bears. Mention trapped traders if a breakout just failed.

**F. Always In.** Long, Short, or unclear (if you had to hold a position, which?). It flips only on strong
evidence — a strong breakout with follow-through, or consecutive strong trend bars — not on one weak bar. Say
how confident and what would flip it.

**G. Probabilities.** Use Brooks' vocabulary and keep it honest: likely/probably ≈ 60%+, "about 50%" for breakout
mode, "40% chance" for the minority side. Tie each probability to an event and horizon ("a second leg down
within a few bars is likely"). Never output false precision; say "the odds favor…", "more likely…than…".

**H. Traders will watch whether…** End with 2–3 concrete, falsifiable conditions for the next bar(s):
> "Traders will watch whether bears get follow-through selling below the September 16 low, or whether the
> market finds support at the 20-week EMA and forms a double-bottom bull flag."

## 2. Output template (respond in the user's language; keep Brooks terms in English)

```
**<Instrument> <timeframe> — <one-line thesis, like a post title>**
概览: 2–3 sentences: cycle phase + what bulls/bears need next.

**最近的K线**: …
**市场状态 / Context**: trend or TR, strength evidence, key levels (dated swings, EMA, MM targets)
**形态候选**: … (with location and quality)
**Bulls**: see / want / need / fallback support
**Bears**: see / want / need / fallback resistance
**Always In**: Long | Short | unclear — why, what flips it
**概率判断**: event + horizon + rough odds
**Traders will watch**: 2–3 conditions
**不确定性**: data limits, alternative counts
```

For 5-min / intraday, also number bars from the open (bar 1 = first bar of the day session) and refer to them
("bars 1–3 were strong bear bars; Always In Short on the close of bar 2").

## 3. Hard rules
- Do not use information after the as-of time. Do not treat an unclosed bar as closed.
- Do not call a candidate pattern confirmed; do not turn a pattern name directly into a trade.
- Do not attribute your thresholds or numbers to Brooks; only quote probabilities the methodology file cites.
- Do not force a setup: "no clear trade, trading range, wait" is a valid reading.
- Not financial advice. Do not place orders based on a reading unless the user explicitly asks and confirms.
