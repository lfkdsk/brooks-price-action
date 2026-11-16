# Brooks Price Action — Methodology Reference

Distilled from the local brookstradingcourse.com corpus (`data/posts.jsonl`): all 25 "How To Trade Manual" posts (only 11 have public text; 14 are member-only stubs), ~35 technical "Ask Al" transcripts, and sentence-level mining of Al's own "Emini & Forex Daily Reports" for 2015–2021. Every rule is paraphrased; short quotes are marked. Sources are cited as (YYYY-MM-DD, title). Titles are shortened where the original is very long.

**Health warning from Al himself:** the percentages are rough guidelines from experience, not backtested statistics. Al says he has not tested a figure like "70%" and treats such numbers as rules of thumb meant to contrast with the default 50/50 (2016-04-10, Ask Al: Trading statistics & probabilities). Use them to rank scenarios, not as precise odds.

---

## 0. How to read a chart with this file (quick procedure)

1. **Where are we in the market cycle?** Strong breakout (spike), channel (tight or broad), or trading range (TR)? (§2)
2. **Which way is Always In?** If a trader had to hold a position, long or short? How strong is it? (§3)
3. **Context before signal.** Look at all the bars to the left: trend vs TR, nearby support and resistance (magnets), higher-timeframe position. A setup needs both a signal and supportive context (2020-04-23, Price action and candlestick charts). (§11)
4. **Count the bars:** H1/H2/L1/L2, wedge pushes, consecutive trend bars, micro channel length, bars since the last touch of the EMA. (§8)
5. **Judge the signal bar and entry/follow-through bars.** (§9)
6. **Write the bull case and the bear case**, each with a probability from the vocabulary in §12, then state what each side needs next. (§13)
7. **Check the trader's equation** for any trade idea: probability × reward against (1 − probability) × risk. (§10)

---

## 1. Foundational premises

- **There is an institution on both sides of every trade.** A "perfect" setup (high probability AND big reward relative to risk) cannot exist, because no institution would take the other side. Every trade gives up something: probability, reward, or risk (2020-11-15, Is there a perfect trade setup; 2020-04-24, Importance of institutional trading).
- **The 40–60 rule.** Outside strong breakouts, the chance that the market goes X ticks up before X ticks down is between 40% and 60% (2020-05-17, Beginners should enter with stop orders). For a reward equal to the risk, assume a 95% chance that the true probability is 40–60%. The other ~5% of bars are strong breakouts, where continuation is often about 70% (2020-04-24, Importance of institutional trading).
- **About 90% of bars are tradeable both ways.** Roughly 10% of bars are high-probability (60%+) for one side. On the other 90%, a long or a short can both be set up profitably if structured and managed correctly (2017-01-08, Ask Al: Structuring limit and stop order trades; 2020-05-17, The folly of trading fundamentals: "Except during the 10% of the time when the market is breaking out strongly, the market is very balanced").
- **Setup = signal + context.** All bars to the left must support the trade. A perfect candle pattern in the middle of a tight TR "will consistently lose money" (2020-04-23, Price action and candlestick charts).
- **Markets are fractal.** The same analysis applies to every market and timeframe. Al uses a 5-minute chart for day trading and suggests no more than about 20 bars per hour (2020-04-24, Price action is genetically based; 2020-12-20, My day trading setup).
- **Indicators are optional.** Al uses only a 20-bar EMA (plus the 60-minute 20-bar EMA plotted on the 5-minute chart), because both act as support and resistance (2020-12-20, My day trading setup; 2020-11-08, The surefire folly of trading with Technical Analysis Indicators).
- **Time matters as well as price.** A bear flag that keeps rising bar after bar shows relentless bulls even before it breaks out. The early bars of a new bull trend often still look like a bear flag (2020-12-20, My day trading setup).

---

## 2. The market cycle: breakout → channel → trading range

- The cycle never ends: a trend starts with a breakout (spike). When pullbacks begin, it becomes a channel. Two-sided trading then grows until the channel becomes a TR. "The seeds of the next trend are planted in every trading range" (2020-10-25, Trading ranges – areas of confusion).
- A TR is the market searching for a price both sides accept as fair, an "area of confusion". A breakout means both sides agree the price is wrong, and the market moves quickly to the next area of confusion (2020-10-25, Trading ranges – areas of confusion).
- **The 20-bar rule.** A pullback that grows beyond about 20 bars loses most of the prior trend's influence. Reversal and resumption then become roughly equally likely, and Al calls it a TR rather than a pullback (2020-10-25, Trading ranges – areas of confusion; 2018-03-19 daily report: "Once a pullback grows to 20 or more bars… I then use the term 'trading range'"; 2016-05-16, Intraday market update: a TR in a bull trend of 20+ bars → bull-breakout odds fall to ~50%).
- **Trade each phase differently:**
  - **Breakout/spike:** go with it, buying or selling the close or at the market. The breakout phase gives about a 60% chance of reaching a measured move (2016-09-04, Ask Al: Book recommendation trade probabilities).
  - **Tight channel:** mostly with-trend entries only.
  - **Broad channel:** both directions.
  - **TR:** buy low, sell high, scalp (2016-09-04, same; 2020-10-25).
- **Breakout Mode (BOM).** A TR, triangle, ii, ioi, oo, or any balanced pattern. There is about a 50% chance of a successful breakout up or down, and about 50% of first breakouts fail and reverse (2016-09-30, S&P500 Emini outside down day; 2019-05-22, Emini buying pressure in 3 week correction; 2015-03-18 daily: "About 50% of breakout mode setups go the wrong way and reverse").

---

## 3. Always In (AI)

- **Concept.** If you had to be in the market at all times, which side would you hold? Al's end-of-day setup charts "present an Always In perspective" and show where a trader with no position would logically enter (boilerplate in nearly every 2018–2021 daily report, e.g., 2021-12-23).
- **What makes the market Always In:** a strong breakout that most traders believe. Typical evidence in the corpus:
  - consecutive big trend bars closing near their extremes ("The consecutive bear bars on the open make the Emini Always In Short" — 2016-12-21, Trump year end rally pausing);
  - consecutive big bull bars after a failed break of a prior low (2017-12-06, Emini sell signal bar before December 8);
  - a reversal "strong enough" to flip it (2015-06-05, Intraday market update);
  - on higher timeframes, a 2nd strong trend bar (2017-07-27, Emini buy climax continuing higher: a 2nd strong bear day would make the daily chart AIS);
  - 4 consecutive bull bars on the weekly "begin to flip the trend" (2017-01-12, Intraday market update).
- **AI direction ≠ strong trend.** Reports constantly qualify it: "Always In Long, but the bulls need follow-through", or "AIL but in a tight TR, so probability is really only 50%" (2015-08-28; 2015-07-27; 2016-06-01: AIL but bulls need stronger bars before traders will swing). Always grade the strength.
- **Flip criteria and management.** AI swing traders hold until the market clearly flips; strictly, bulls stay long while every pullback stays above the bottom of the last strong leg up (2016-09-25, Ask Al: Breakouts, when to exit or hold?). Professionals do not exit on the first reversal against them. They wait for a test and a second signal (double top, lower high) before switching (2016-03-27, Ask Al: Always In trading with less stress). A day can stay AIL even when the bears try several times: "it never really became Always In Short" (2015-07-26, Ask Al: Always In trading and breakout scalps).
- **Late flips create MTRs.** Bears who saw a strong first sell-off sell the first ~50% pullback. That lower high becomes the LH major trend reversal (2016-03-27, same).

---

## 4. Trends vs trading ranges

### 4.1 The 80% rule (inertia)
- **In a TR, about 80% of breakout attempts fail** (2020-10-25, Trading ranges – areas of confusion: "when a market is in a trading range, 80% of breakouts up and down will fail"; 2018-07-31, Emini follow-through selling in sell climax; 2016-08-28, Ask Al: Trading range days—Two legs or swing, which calls it the "80 Percent Rule (Inertia Rule)").
- **In a trend, about 80% of reversal attempts fail** (2016-03-06, Ask Al: Trading range days price action; 2021-01-13 daily: "My 80% Rule says '80% of trend reversal attempts fail'").
- Al calls both figures subjective: "Pick a number — 80 percent of breakouts fail and 80 percent of trend reversals fail" (2016-04-10, Ask Al: Trading statistics & probabilities).
- Practical meaning: in a TR, don't buy highs or sell lows. Fade strong closes at the extremes (2020-10-25). In a trend, assume every support level, wedge bottom, or measured-move target in the trend's path will fail (2016-03-06).

### 4.2 Trading-range tactics
- **BLSHS: Buy Low, Sell High, Scalp.** Avoid the middle third of the range (2020-10-25, Trading ranges – areas of confusion). The third part, Scalp, means taking profits quickly (2015-04-25, Ask Al: Bull scalping in a bear channel). On a TR day, take at least half off at 2 points, or all of it with one contract (same).
- Experienced traders fade with limit orders: buy below bars in the bottom third and sell above bars in the top third, scaling in (2020-10-25). Beginners should still use stop entries (2020-05-17, Beginners should enter with stop orders).
- **Tight TR:** most traders should not trade. A range is too tight when its height is only about twice a scalp's size. A tight TR is a breakout-mode setup, likely to give a breakout and a swing, but in either direction (2020-10-25). Stops placed 1–2 ticks beyond a tight range's edges are a losing strategy. Use stops at least 3–5 ticks beyond the extreme (2015-07-18, Ask Al: Trading Stops in Tight Trading Ranges).
- **Second-leg trap.** In a TR, a second leg that looks especially strong but does not break above major resistance (or below major support) is usually a trap: a buy or sell climax rather than a breakout (2016-08-28, Ask Al: Trading range days; 2015-10-18, Ask Al: Second leg traps in trading ranges; 2016-02-07, Ask Al: Advice on 2nd leg traps). If the context still looks like a TR or channel, treat a big breakout as a probable trap. If it is clearly above all resistance, treat it as a likely measuring gap (2016-02-07).
- **TR day mindset.** Al assumes every breakout will reverse until he is "hit over the head" by a clear trend. He then switches from limit-order scalps to swinging part of the position (2016-03-06, Ask Al: Trading range days price action; 2015-12-27, Ask Al: Trading range breakout failures).
- **TR after a reversal:** if a bull reversal follows a 4–5 bar plunge on a TR day, buy it. There is probably a 70% chance of a return to the prior high area (2016-03-06).
- **Breakout tests in a TR:** in a daily TR, any rally keeps at least a 40% chance of being a bull trap that leads to a bear breakout (2018-05-14, Emini pullback from breakout above April high).

### 4.3 Day-type base rates (Emini, daily reports)
- Big gap open → a TR opening for the first 60–90 minutes about 80% of the time (2019-07-01, Emini oo consecutive outside bar buy signal on monthly chart). A big gap gives only about a 20% chance of a strong trend from the open lasting all day (2019-09-05, Emini just below August ledge top magnet above).
- Trend from the open (bull or bear): about 20–25% of days (2020-09-02, Emini buy climax broke above August high; 2017-11-13, Emini test of wedge top).
- After a buy or sell climax day: about a 75% chance of at least 2 hours of sideways-to-opposite trading starting by the end of the 2nd hour; about a 50% chance of follow-through in the 1st hour or two; only about a 25% chance of another strong trend day (2015-07-28, Emini market update; 2016-03-01, Intraday market update; 2017-07-17, Trump rally targeting 2500).
- After 5–6 consecutive bear days in a multi-month daily TR, the odds favor a bull day, meaning a close above the open (2018-03-19, Emini in breakout mode awaiting March FOMC).
- After 11 a.m. PT, if the Emini is within ~5 points of the open, the open tends to act as a magnet (2018-03-19, same).

---

## 5. Trend channels

- **Tight channel** (small pullbacks, mostly trend bars, overlapping): trade only with the trend. Buying above a small bull bar in a tight bear channel is low probability even though the risk looks small (2017-02-05, Ask Al: Small pullback bear trend – bought many times).
- **Broad channel:** both directions are tradeable. In a broad bear channel Al "will buy new lows and sell rallies" of about 50% of the prior leg (2017-05-21, Ask Al: China Futures Daily Q&A Part 1).
- **Small pullback trend:** pullbacks last 1–3 bars and stay shallow. Counter-trend scalps are traps (2016-12-11, Ask Al: Missing swing trades, measured moves, trading spikes).
- **Reversal of a tight channel needs a transition.** A tight bull channel has only about a 20% chance of reversing straight into a bear trend without at least a micro double top or a TR first (2018-03-20, Emini island top and weekly sell signal before FOMC). A sell climax in a tight bear channel has only about a 20% chance of an MTR without at least a micro double bottom (2018-05-04, Emini buy signal bar on daily chart at 2600). After a tight bull channel, bears probably need at least a 2-hour TR first, about 80% (2018-03-27, Emini expanding triangle buy setup).
- **Channel breakouts usually fail.** A breakout against a channel's slope (below a bull channel's bottom, or a bear breakout below a bear channel) has about a 30% chance of success and a 70% chance of reversing back toward the other side within a few bars (2016-04-10, Ask Al: Trading statistics & probabilities). More than 60% of breakout attempts from a reasonable wedge or parallel channel fail (same).
- **Wedge-shaped channel:** about a 75% chance of an opposite breakout (a bull breakout from a wedge-shaped bear channel), followed by a TR or swing. Only about 25% chance of with-trend acceleration (2015-09-11, Intraday market update; 2015-11-23, Intraday market update).
- **Spike and channel:** about a 75% chance of a breakout against the channel and then about 10 bars and 2 legs sideways-to-opposite. Only about 25% chance of a strong with-trend breakout (2016-09-01, September unemployment report…; 2016-08-31). After a spike-and-channel bull day, about a 75% chance the next day breaks below the bull trend line (2021-08-04, Emini outside up bar ahead of August unemployment). After a spike-and-channel top, about a 60% chance the reversal is just a bear leg in a TR (2016-08-08, August stock market correction not likely this week).
- **Micro channel** (every bar's low above the prior bar's low in a bull MC, or every high below the prior high in a bear MC):
  - A long one shows strong, "relentless, confident" trend traders (2021-04-14).
  - 10+ bars is extreme and climactic (2021-04-12; 2016-05-07: "An 11 bar micro channel is unsustainable and therefore climactic").
  - The first pullback below a bull micro channel is usually bought, followed by a new high (2015-10-05; 2016-04-29).
  - After 10+ bars: about a 90% chance of at least a 1-bar pullback soon (2016-06-30, Futures trading strategies after a buy climax); about a 60% chance of re-testing the micro channel's extreme after the pullback (2016-05-25).
  - Very extreme micro channels can be followed by deeper, longer pullbacks than expected (2016-02-18).
  - In a 10-bar micro channel on the 60-minute chart, "the first breakout will be sold, but the second one will be bought" (2016-04-10).
- **Shrinking breakouts in a channel:** successive new lows in a bear channel should get smaller. A bigger breakout late flushes weak scale-in bulls (2015-07-12, Ask Al: Scaling in, gaps, and stops). While a bear trend keeps leaving gaps (bar highs below prior lows), buying new lows is lower probability than once the gaps start closing (same).
- **Pullback depth tracks trend strength.** Strong trends have small pullbacks, so don't wait for 50%. The more two-sided the market, the deeper the pullbacks, and traders wait for ~50% retracements (2016-05-01, Ask Al: Pullbacks—when to enter).

---

## 6. Breakouts, follow-through, failed breakouts

- **Strength is judged by:**
  - consecutive big trend bars;
  - closes on or near the extreme;
  - small tails;
  - gaps (bars not overlapping, or not trading below the prior close);
  - urgency: traders buying at the market rather than with limit orders, and limit orders at the prior close going unfilled (2017-01-15, Ask Al: Buy the Close bull trend or reversal?).
- **Breakout probabilities:**
  - Strong breakouts: about 60% chance of a measured move (2016-09-04, Ask Al: Book recommendation trade probabilities).
  - "Probably somewhere around 80 percent that there will be follow-through" (2016-04-10, Ask Al: Trading statistics & probabilities).
  - "During strong breakouts, the probability of continuation can be 70% or higher, but the stop is then far away" (2020-05-17, Beginners should enter with stop orders).
  - Highest-probability trade of a day was a sudden strong reversal spike, "probably 70 percent" chance of a measured move (2016-08-21, Ask Al: High probability trades).
- **Enter fast on surprise spikes.** When a strong surprise breakout is clearly underway, buy or sell at the market. Hesitating only adds risk and cuts profit (2016-08-21; 2016-12-11). On strong trend days "it's never too late to enter" (2016-12-11).
- **Follow-through is the confirmation.** Reports routinely say "the bulls/bears need follow-through" before calling a trend (e.g., 2015-12-16; 2017-09-25: bears "need a strong breakout and follow-through before traders will believe" a bear trend has begun). A bad follow-through bar (bear bar after a bull breakout, a lower low, or a doji) traps breakout traders. Their breakeven exits then fuel the reversal (2015-10-18, Ask Al: Second leg traps in trading ranges).
- **Your own trade:** if the market breaks out against you and gets follow-through, exit. Don't scale in, because the move may become a measuring gap (2016-06-12, Ask Al: Trade management examples: "We're getting a bull breakout of a bear flag. I'm just got to get out").
- **Breakout Mode:** 50% chance the first breakout fails (2016-06-22; 2019-08-08). A breakout from a 6-day tight TR has about a 50% chance of a measured move and 50% of reversing for an opposite measured move (2016-04-08).
- **Gaps:**
  - A big trend bar late in a trend is more likely an exhaustion gap than a measuring gap (2015-09-13, Ask Al: V-bottoms, gaps, and climaxes: "always, always, always Exhaustion Gap is more likely than Measuring Gap"). Exhaustion usually leads to a couple of legs sideways-to-opposite lasting ~10 bars (same).
  - On TR days, assume every potential measuring gap will close (2016-12-11).
  - Higher-timeframe breakout gaps often close: "a 70% chance that the gap… will close" before a big measured move (2016-10-07; 2016-11-03).
- **Climaxes:** see §4.3. Consecutive buy climaxes (3 pushes in a day) usually lead to sideways trading (2017-01-15). After 8 consecutive bull bars on the daily chart, about a 70% chance of a meaningful correction within days (2016-03-24). 7 consecutive bull bars: only a 40% chance of a strong rally before a pullback (2016-08-22).
- **Surprise bars:** a big surprise bar usually gets at least a small second leg in its direction, often after a ~5-bar tight TR (2019-04-08, Bull surprise bar on Emini weekly chart; 2019-03-05; 2021-05-03). A huge surprise day: about a 75% chance of at least a small 2nd leg within 5 bars (2018-10-11, Emini correction could give back all of 2018 gains). A Bull Major Surprise Bar "made a bear trend unlikely" (2019-12-12).
- **The first pullback after a strong breakout gets bought or sold.** Both early bulls and late bulls buy it. About a 75% chance of at least a small 2nd leg (2016-02-01, Intraday market update). After a strong move there is "at least a 60% chance of a 2nd leg" (2017-10-26). After a strong 6-week rally, about a 70% chance the bulls buy the first reversal down (2020-04-28, Emini weekly buy signal but at 20 week EMA).
- **Limit-order entries in a breakout:** only on the very first pullback after a strong breakout. In weaker trends, wait for ~50% pullbacks (2016-05-01).

---

## 7. Trend reversals

- **Most reversal attempts fail.** About 80% in a trend (§4.1). "Since the 1st reversal up from a strong bear trend only has a 20% chance of growing into a bull trend, the rally will be a minor reversal" (2018-05-10, Emini buy signal and test of 2700). The first reversal in a strong trend is usually minor even if it is large in points (2018-01-24).
- **Minor reversal = usually a pullback or TR leg,** not a new trend. Island tops and bottoms are usually minor (2017-10-23). After big multi-day trends, expect a minor reversal of a couple of weeks to about a 50% pullback (2021-04-21).
- **Major Trend Reversal (MTR):**
  - Structure: it is always a double-top or double-bottom type pattern, which makes it a kind of TR (2016-12-31, 2017 stock, bond, and Forex market predictions; 2016-01-27).
  - Variants: higher-low / lower-low MTR at bottoms, lower-high / higher-high MTR at tops.
  - Typical sequence: a strong counter-trend move (often a break of the trend line), then a test of the extreme, which becomes the signal. An HL MTR is "always a 2nd leg up from the bottom" (2017-04-19, Five percent correction after Trump rally).
  - Probability: only about 40% lead to a swing or measured move; 60% become a TR or fail into trend resumption (2016-02-10, Intraday market update; 2018-10-11; 2015-10-13; 2017-05-09).
  - Often needs a 2nd or 3rd signal. The first reversal attempt succeeds only ~50% even in good context (2017-04-27, S&P500 double top at all time high).
  - Confirmation comes only with a strong breakout bar in the new direction (2016-07-22, Micro double top buy climax: "The major trend reversal was confirmed only after the strong bull breakout bar").
  - After a tight channel, the reversing side usually needs a TR of an hour or more to build pressure first (2015-08-20; 2015-07-08).
  - Not every reversal is an MTR. A ~20-bar trend reversing is "more of a minor reversal". A lower high inside a broad bear channel is a channel short, not an MTR (2016-07-31, Ask Al: Always In and Major Trend Reversal trading analysis).
- **When context is good, a strong reversal gives a 2nd leg.** "When there is a strong trend reversal, especially when the context is good… there is a 60% chance of at least one more leg up" (2015-12-22).
- **Ways strong trends end without an MTR:** an **endless pullback**, a slightly sloping tight TR that grinds against the trend and later breaks out (2014-08-01, Emini weekly update; 2017-11-28: "An endless pullback is a tight trading range that is sloped down slightly"); a **final flag**; a **parabolic wedge** climax.
- **Final flag:** a late-trend flag whose breakout fails and reverses. If a bear breakout from a late bear flag occurs, there is at least a 50% chance it fails and that flag becomes the final flag (2016-05-16). A long trend gives about a 50% chance of a final-flag top within 5 bars (2016-07-25). Nested final flags and expanding triangles on several timeframes raised the odds of a top to at least 60% (2016-08-09, Nested expanding triangles and final flags).
- **Wedges (3 pushes):** wedge tops and bottoms target at least a ~50% retracement or the start of the wedge. A common expectation is 10 bars and 2 legs (TBTL) (2016-04-10; 2016-04-04; 2017-04-21). A wedge bottom still has about a 25% chance of a with-trend bear breakout (2017-04-17). A parabolic wedge is a climactic 3-push move that often leads to an endless pullback or TR (2019-01-23; 2018-03-19).
- **Head and shoulders:** about 60% of breakouts below H&S tops fail and create triangles or wedge bull flags (2015-12-21). An H&S bottom "always is a trading range" (2016-01-27).
- **V-bottoms "are almost always something else"**: a micro double bottom, micro wedge, final flag, or expanding triangle on another timeframe. A higher-low MTR often follows (2015-09-13, Ask Al: V-bottoms, gaps, and climaxes).
- **Gap bars and the EMA:**
  - 20 Gap Bar setup = first pullback to the moving average after 20+ bars entirely beyond it (2017-08-24, Trump rally probably has evolved into bear channel).
  - 75% of the time there is then a test of the trend's high after a 20-gap-bar buy (2021-09-23, Emini September rally needs to continue…).
  - Moving-average gap bars in a bull trend: about a 60% chance of a test of the high (2021-09-23).
  - A sell-off from gap bars in a bear trend: about a 60% chance of becoming an MTR buy setup (2015-12-09). Al calls the move from MA gap bars "the final bear leg before a major trend reversal attempt" (2015-06-24).
  - Gap bars appearing 50 bars into a trend: the bulls must do more to prove a new trend (2016-02-07).
- **Expanding triangles** are reversal patterns at tops and bottoms (2017-01-15; 2016-08-09).
- **Strong vs weak traders at reversals.** A big trend bar late in a weak channel is often a "gift" exit for strong traders. Weak traders chase it and capitulate, which creates a reversal bar (2015-11-15, Ask Al: Strong and weak bulls and bears).

---

## 8. Bar counting (H1/H2/L1/L2, wedge flags, resets)

- **High 1 (H1):** the first attempt to resume a bull trend after a pullback, when a bar trades above the prior bar's high. **High 2 (H2):** the 2nd attempt. Likewise **L1/L2** in bear trends. "A low 2 sell setup… is a 2nd attempt to resume the bear trend" (2015-09-21, Intraday market update). H2 = "2nd attempt to resume up" (2020-12-10, Emini has consecutive outside bars at the all-time high).
- **H3/H4, L3/L4 and wedge flags.** A 3rd push is usually a wedge flag. A Low 4 or High 4 is a later variant. Al notes that "a Low 5 top is a variation of a Low 4" when one leg is itself a wedge (2015-11-09; 2015-11-03: "a Low 4 top (really a Low 5 since the 2nd top is a wedge and it has 3 legs)"). A Low 4 with three pushes up is effectively a wedge top short (2016-11-27, Ask Al: Tight stops selling wedge top).
- **When H1/L1 is good:** only in strong trends. An L1 in a strong bear trend is a sell signal (2020-03-24). A Low 1 bear flag at the bottom of a TR is a low-probability sell (2021-01-20). An H1 after a buy climax at resistance usually leads to a breakout lasting only a bar or two, or a TR (2017-05-02; 2017-02-17). A weak H1 bull flag raises the chance of a tail on the entry bar (2017-05-26).
- **When H2/L2 is good:** a pullback in a bull trend or broad channel, often near the EMA, as "a High 2 or wedge bull flag closer to the moving average" (2016-02-16). In TRs, H2 or L2 at the extremes are second entries with about 60% probability (2016-09-04). Without strong context, an H2 buy or L2 sell can offer reward much bigger than risk but low probability (2015-09-30). A micro double top can be read as an L2 bear flag (2019-05-07).
- **Second entries are better than first entries.** "2nd attempts have a slightly higher probability" (2017-02-03). "A 2nd attempt to sell off has a higher probability of success" (2020-05-14). Beginners on TR days should wait for 2nd entries with good signal bars, or for strong breakouts with follow-through (2015-08-25; 2015-08-06).
- **Resetting the count.** If a leg is strong enough (a strong breakout or new extreme), traders restart counting pushes or attempts from that leg. Typical wording: "the rally reset the count and became the first and no longer the 2nd leg of the wedge" (2015-01-08); "strong enough to reset the count… traders will expect one more brief push" (2016-03-21); 2020-02-15.
- **Other counts traders track:** consecutive trend bars, micro channel length, bars without touching the EMA (e.g., a monthly chart 33 bars above the MA, rare and climactic: 2016-04-10), and consecutive bull or bear days on the daily chart (2018-03-19; 2021-04-14: 13 consecutive bull days).

---

## 9. Signal-bar and entry-bar quality

- **Good buy signal bar:** a bull body closing near its high, a small top tail, a reasonable size, and good context (a second entry at support). Mirror this for sells. **Weak:** a doji, a bear body on a buy bar, a big tail on the trade side ("the signal bar had a big tail and was therefore weak" — 2017-09-25), or appearing after consecutive opposite trend bars (2021-06-18; 2020-11-06; 2020-03-27).
- **Bad bar in great context can still work** when higher timeframes are very overbought or oversold. Al notes a selloff can begin from a bad signal bar (2015-04-30).
- **Sizing up the setup:** a strong signal bar, then a strong entry bar, then strong follow-through raise the odds of a 2–4 hour swing (2016-01-04). A good signal bar on a major pattern still gives only about a 40% chance of a major move (2019-05-22).
- **Small signal bars mean low probability with tight stops.** With a 1-tick stop beyond a 3-tick signal bar, "probably 70% chance you're going to get stopped out". Use a stop several ticks or points farther away (2016-11-27, Ask Al: Tight stops selling wedge top). In general, "the smaller the risk… the smaller the probability" (same; 2017-02-05).
- **Big signal bars** in a tight TR after a strong move are poor (2015-07-23).
- **Outside bars** matter only with context. An outside bar after a good signal bar is an entry bar. In a tight TR outside bars are meaningless (2016-05-15, Ask Al: Outside Bars).
- **ii, ioi, oo** are breakout-mode patterns: both a buy and a sell setup (2019-06-27; 2020-08-27; 2020-12-28).
- **Big trend bars closing on extremes** in the direction of a strong trend are "buy/sell the close" bars. Late in a trend, or in a TR, they are often exhaustion (§6).
- **Entry mechanics:** the standard stop entry is 1 tick beyond the signal bar, with a protective stop 1 tick beyond its other end (2020-05-17, Beginners should enter with stop orders). "Every limit order is the opposite side of a stop order" (same).

---

## 10. The trader's equation and trade management

- **Equation:** probability × reward must exceed (1 − probability) × risk. Every trade has three variables: risk, reward, and probability. Looking only at risk (tiny stops) ignores probability (2017-02-05, Ask Al: Small pullback bear trend).
- **Swing vs scalp:**
  - **Swing:** reward at least 2× risk (initial or actual risk), at least two legs, sitting through one pullback. For the Emini, a ~4-point minimum (2015-08-16, Ask Al: Swing trading definition and discussion). A typical swing setup has about a 40% chance of success (2020-05-10, Trading psychology and the importance of happiness).
  - **Scalp:** reward ≈ risk, so it needs 60%+ probability (same). Scalpers allow no pullback, or only a brief one; swingers allow one pullback but not two (2015-08-16).
  - Most traders should swing. The best scalpers win ~90% of the time, but this is rare and usually involves scaling in (2020-05-10; 2020-05-17).
- **Al's simplification:** "certain 60 percent, uncertain 40 percent". In a strong breakout or a 2nd entry at a TR extreme, assume 60% and reward ≥ risk is acceptable. If confused, assume 40% and require reward ≥ 2× actual risk (2016-09-04, Ask Al: Book recommendation trade probabilities).
- **Example equation:** Emini with a 2-pt stop and 4-pt target → about 40% winners, 40% full losers, 20% small wins and losses → positive (2020-05-10).
- **Don't convert swings into scalps.** Taking scalp profits on low-probability swing setups loses money over time (2020-05-10).
- **Wide stops and scaling in raise probability but also risk.** Risking 4 points for 1 point needs ~90% wins unless you scale in. A 100-point stop with scale-ins might win ~80% but occasionally loses big (2015-12-06, Ask Al: Breakout pullbacks trading 4 point stop for 1 point scalp; 2017-01-08).
- **Avoid "skunk stops"** placed halfway, often near a 50% pullback where strong traders enter. Either exit early or use the full swing stop (2016-06-19, Ask Al: Skunk stops).
- **Trapped?** If the market comes within a tick of your breakeven exit two or three times and misses, you are on the wrong side. Get out (2017-02-19, Ask Al: Scaling in — small range day). Three consecutive opposite bars against a scalp is a common exit signal, and that exit itself creates the next bar (2016-08-28).
- **Position size follows stop distance.** If the needed stop doubles, halve the size. If the open risk grows in a runaway breakout, take partial profits to bring risk back to normal (2020-04-24, What should my trading position size be?). Trade the "I don't care" size: whatever you think it is, cut it by 50–75% (same).

---

## 11. Support, resistance, and magnets

- **Price is always racing to support or resistance,** where it either breaks out or reverses (2020-05-17, The folly of trading fundamentals). Strong breakouts run to resistance, where traders take profits (2020-11-08).
- **Magnet list used in reports:**
  - the 20-bar EMA on the current and higher timeframes (5-minute and 60-minute);
  - prior day high, low, close, and open; the open of the day or week;
  - prior swing highs and lows, and the major higher low or lower high;
  - measured-move targets: Leg 1 = Leg 2, the height of a TR or breakout projected from the breakout point, or the height of a spike;
  - the 50% pullback of a leg;
  - breakout points and gaps (to be "tested" or "closed");
  - trend lines and trend channel lines;
  - Big Round Numbers (2500, 3000, 4000);
  - the yearly or quarterly close, the start of a wedge, and the bottom of a bull-bar streak;
  - percentage corrections (5%, 10%, 20%).
  
  Example list: "The magnets around 3200 are the Big Round Number, the close of 2019, a 10% correction, the June 5 high, and the July 30 bottom of the streak of 9 consecutive bull bars" (2020-09-24, Emini back below the August low).
- **Magnets pull harder when close.** When a target is near, odds of reaching it rise above 50% (2015-11-25; 2017-02-23; 2015-12-28: the yearly close ~1% away will probably be tested).
- **Measured-move targets are ordinary support and resistance.** They are no better or worse than prior highs and lows or trend lines. Fade them when context is TR-like or climactic. Don't fade them in a strong trend (2016-03-06, Ask Al: Trading range days price action).
- **50% pullbacks:** buyers below or sellers above at about a 50% retracement are a constant theme (2018-06-06; 2019-01-30; 2019-02-26). An upside breakout will "probably retrace at least 50% of the selloff" (2016-08-08).
- **Confluence:** several S/R types at one price, plus higher-timeframe agreement (daily/weekly/monthly), increase the odds of a reaction (2016-10-02, Ask Al: Buying and selling pressure; 2016-08-21).
- **20+ bars without touching the EMA** sets up a 20-gap-bar test (§7). Al notes the monthly chart rarely stays 30+ bars above its MA, and both prior cases ended in 20%+ corrections (2016-04-10).

---

## 12. Probability vocabulary (as Al uses it)

| Phrase in reports | Approximate meaning | Corpus usage |
|---|---|---|
| "probably", "likely", "the odds favor", "more likely" | ≥ 60% (Al's "certain" bucket) | "probably" ~14.0k, "likely" ~13.2k, "odds favor" ~3.75k, "more likely" ~3.76k |
| "50%", "50-50", "neutral", "Breakout Mode" | balanced; either side | BOM statements, ~20-bar TRs |
| "40% chance" / "less likely" / "only 40%" | the uncertain bucket; minimum odds for a swing | MTR, wedge breakouts, first reversals |
| "unlikely", "only 25%/20%" | low-probability tail scenario, still worth stating | strong trend day after climax, tight channel reversing without a TR |
| "70%", "75%", "80%" | strong situational bias (after climaxes, channel breakouts, 80% rule) | climax follow-up, channel/spike-and-channel |
| "90%" | near-certain, used for small events (≥1-bar pullback after a 10+ bar micro channel) | micro channel |

Rules of the vocabulary:
- **Default band:** 40–60% for any equal risk/reward trade (2020-04-24).
- **Strong breakout:** 60–80% follow-through (2016-04-10; 2016-09-04; 2020-05-17).
- **"Likely" ≈ 60%; "uncertain" ≈ 40%** (2016-09-04, Ask Al: Book recommendation trade probabilities).
- **"High probability" in Al's mouth = 70–80%** (2016-05-01, Ask Al: Pullbacks—when to enter: "What's high probability? 70 percent, 80 percent").
- The daily reports state a probability with an explicit number about 4.9k times ("X% chance") across the corpus.

### Typical stated probabilities by setup (cheat sheet)

| Situation | Stated probability | Source |
|---|---|---|
| Breakout attempt from a TR fails | ~80% | 2020-10-25, Trading ranges – areas of confusion |
| Reversal attempt in a trend fails | ~80% | 2016-03-06, Ask Al: Trading range days price action |
| First breakout of a Breakout Mode pattern fails | ~50% | 2016-09-30; 2019-05-22 |
| TR > ~20 bars: bull vs bear breakout | ~50/50 | 2016-05-16; 2017-06-26 |
| Strong breakout reaches a measured move | ~60% | 2016-09-04 |
| Strong breakout gets follow-through | ~70–80% | 2016-04-10; 2020-05-17 |
| Major trend reversal leads to a swing/trend | ~40% (60% TR or failure) | 2016-02-10; 2018-10-11 |
| First reversal from a strong trend becomes a trend | ~20% | 2018-05-10 |
| Tight channel reverses without MDT/MDB or TR first | ~20% | 2018-03-20; 2018-05-04 |
| Breakout against a channel's slope succeeds | ~30% (70% reverses) | 2016-04-10 |
| Wedge-shaped channel breaks out against the trend | ~75% | 2015-09-11; 2015-11-23 |
| Spike and channel: opposite breakout then ~10 bars, 2 legs | ~75% | 2016-09-01 |
| Day after a buy/sell climax: ≥2h sideways-to-opposite starting by end of 2nd hour | ~75% | 2015-07-28; 2016-03-01 |
| Day after a climax: another strong trend day | ~25% | 2017-07-17; 2018-09-18 |
| Day after a climax: follow-through in 1st hour | ~50% | 2016-03-01 |
| Big gap open → TR for first 60–90 min | ~80% | 2019-07-01 |
| Trend from the open | ~20–25% | 2020-09-02; 2017-11-13 |
| 10+ bar micro channel → at least 1-bar pullback soon | ~90% | 2016-06-30 |
| Micro channel ≥10 bars → retest of its extreme after the pullback | ~60% | 2016-05-25 |
| 20 Gap Bar buy → test of the high | ~75% | 2021-09-23 |
| MA gap bars in a bull trend → test of the high | ~60% | 2021-09-23 |
| First pullback after strong leg → small 2nd leg | ~75% | 2016-02-01 |
| Surprise day → small 2nd leg within 5 bars | ~75% | 2018-10-11 |
| H&S top breakout fails | ~60% | 2015-12-21 |
| Wedge bottom gets a bear breakout instead | ~25% | 2017-04-17 |
| Second entry at TR extreme / strong breakout | ~60% | 2016-09-04 |
| Typical swing setup | ~40% | 2020-05-10 |
| 1-tick stop beyond a 3-tick signal bar gets hit | ~70% | 2016-11-27 |

---

## 13. Report-writing templates found in the corpus

Daily-report structure (2015–2021): **Pre-Open market analysis** (daily/weekly context) → **Overnight Emini Globex trading** → **Emini 5-minute chart and what to expect today** → **Yesterday's setups** (Always In stop-entry setups) → **EURUSD Forex** sections → **Summary of today's price action and what to expect tomorrow**.

Recurring sentence frames (counts are corpus-wide occurrences of the core phrase):
- "The bulls want… / The bears want…" (~4.4k / ~4.5k). State each side's goal.
- "The bulls need… / The bears need…" (~1.5k / ~1.6k). State what is missing ("follow-through", "a 2nd entry", "a strong break below the major higher low").
- "The bulls see… / The bears see…" (~1.4k each). The same bars read two ways.
- "The bulls hope… / The bears hope…" (~0.9k / ~0.7k).
- "Traders will…" (~7.3k), "Traders will watch…" (~0.5k), "Traders will look for…". These describe expected behavior, not certainty.
- "The odds favor…" (~3.75k), "There is a X% chance…" (~4.9k), "…is more likely than…" (~3.8k), "Less likely…".
- "At the moment, the Emini is Always In Long/Short, but…" (strength qualifier).
- "Yesterday/Today is a buy/sell signal bar for… (High 1 bull flag / Low 2 bear flag / wedge…)", followed by "but it is a weak setup because…" (bear body, tail, doji, in the middle of a TR).
- "Since/Because [context], [probability]. Therefore/Consequently, [expectation]. However, [alternative]." This causal chain is the basic paragraph unit.
- "If the bulls get…, then… If instead…" (conditional scenarios with thresholds such as "a break above the major lower high").
- Always-In setup boilerplate: entries "would be logical times for him to enter"; "most swing setups do not lead to swing trades"; "If the risk is too big for your account, you should wait for trades with less risk".
