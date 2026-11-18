# Forward paper-trading test · 模拟仓

A daily, prospective comparison of Claude with this skill, plain Claude, EMA20,
20-bar momentum and buy-and-hold. Predictions and full readings live in Cloudflare D1;
a dependency-free ES-module Worker serves public JSON and a responsive dashboard.
A Python standard-library collector runs on Precision7960 and pushes completed bars
and readings. It never places orders. Not investment advice; not affiliated with
Brooks Trading Course.

## Start here

Follow [Precision setup](deploy/precision-setup.md) for operator-run provisioning,
secret setup, test collection and scheduling. Nothing has been deployed by adding
these files. The only required Worker secret is `WRITE_TOKEN`; the D1 binding is `DB`.
Set database_id and api_base placeholders before use. Default collection is six
symbols × two LLM conditions, approximately **12 LLM calls/day**, plus one retry for
invalid forecast JSON. Mechanical conditions make no model calls.

Local tests (no network, CLI execution or deployment):

```sh
node --test forward/worker/test
python3 -m unittest discover -s forward/runner
```

On the development Mac the Node executable is
`/Applications/Switchboard.app/Contents/Resources/runtime/bin/node`.
No npm install or Python packages are needed. Python requires zoneinfo (3.9+) and
timezone data; the Worker runtime supplies Web Crypto and D1.

## Why a prospective test

The historical backtest's anonymous charts still mostly predate model training.
A real forecast recorded before its outcome exists avoids historical shape/date
memorization of that outcome and subjective analyst-agreement judging. These are
post-training-cutoff observations only **relative to the deployed model version**:
model updates can change the cutoff and behavior. Record the returned model ID
(or `unknown` when metadata is absent) and repository HEAD as `skill_sha` on every
prediction. HEAD is meaningful only with a clean checkout. Freeze prompts/settings
for a study period, annotate version changes, and compare paired observations.
This does not establish profitability or eliminate all sources of bias.

## Daily collection

Yahoo chart API requests five years of daily OHLC with retries/backoff, then retains
700 bars by default. Dates use Pacific time. Today's bar is dropped until **13:15 PT**,
including early-close days: this is deliberately more conservative than the normal
13:00 close or the usual early close. Future dates and missing/invalid OHLC are dropped.
Weekends/holidays normally produce no new asof. A stale Yahoo feed can delay collection;
there is no attempt to invent bars or retrospectively generate missed forecasts.

For each symbol, push about 30 recent bars, extended back to the most recent stored forecast
within the lookback to repair gaps after an outage. Bars persist indefinitely in D1.
For each condition query stored predictions and skip matching (symbol, asof, condition).
The API also supports upsert with that unique key; direct writes can revise a reading,
so this is procedural immutability rather than a tamper-proof timestamped ledger.
Use the provided flock wrapper for overlapping invocations. API retries are bounded;
a successful rerun fills missing predictions without replacing stored ones.

Each LLM job gets a new temporary directory containing only bars.csv and, for skill,
SKILL.md, scripts/bar_features.py and references/*.md. No config, token, retrieval index
or other repository files are copied. Skill runs features with --weekly; its current
week must be labeled partial when incomplete. Baseline receives only bars.csv.
The CLI uses JSON output metadata, stdin DEVNULL, a 900-second timeout, at most one
parse retry and default concurrency two. Free-form state is normalized and unrecognized
horizons default to five. CLI failures do not block other symbols/conditions.

The collector token comes from WRITE_TOKEN or ~/.config/brooks-forward/token (must be
mode 600). It is removed from the CLI environment and never logged. Staging and tool
permissions are **not an OS security sandbox**: the CLI can potentially access ambient
home/config files, including a token stored on disk. Run under a suitable isolated user
or container if stronger isolation is required. Full model output is public; keep inputs
non-sensitive. No external messages or orders are sent.

Each invocation posts a run summary. Exit is nonzero on total collection failure;
partial failures are logged and runs.ok is false, while valid saved/skipped predictions
allow exit zero. Startup/configuration failures also exit nonzero. A failed run-record
upload is printed locally; completed predictions remain stored.

## Metric definitions

Metrics are recomputed from stored bars and predictions, by condition and symbol:

- **Account:** signal at close t is +1 long, −1 short, or 0 unclear, held only to the
  next available trading bar's close. Return is position × (next close/current close − 1).
  Future bars never choose the position. This assumes hypothetical execution at the
  already observed close, despite the reading being generated later: it is a diagnostic
  close-to-close paper account, with optimistic execution timing, not an executable strategy.
- **Costs:** default 2 bps per unit of position change: entry/exit 2 bps, reversal 4 bps.
  Consecutive same-side signals do not pay a new round trip. Missing predictions mean
  cash, so a missed run exits rather than carrying the previous signal. Changes are
  charged in the interval beginning at the change's close. At the final observed close,
  a cash signal (including missing) liquidates the previous interval's position there;
  a nonzero newest signal remains open/pending, with its change cost booked once its
  own next-bar interval is observable. Terminal exits are included in the last return.
  Forecast target/stop events never determine the daily account position or P&L.
- **Portfolio:** each symbol enters the accounting universe on its condition's first
  forecast date. Include later zero/cash intervals. Average symbol returns available
  on each realized date with equal weights, then compound 1+return from initial equity 1.
  Different listing/calendars and incomplete condition coverage can change weights.
  There is no extra charge for cross-symbol equal-weight rebalancing.
- **Total return** is final equity − 1. **Sharpe** uses daily portfolio mean / sample
  standard deviation × sqrt(252), zero risk-free rate; zero variance yields null.
  **Max drawdown** includes initial equity 1. **Exposure** averages absolute position
  first across symbols per date, then across dates. **Days** counts observed return dates,
  while **days running** is elapsed calendar days since the first persisted prediction.
- **Forecasts:** only score probability/direction once max(5, declared horizon) trading
  bars have elapsed. Event is strictly close[t+5] > close[t]; equality is not up.
  Direction hit rate excludes unclear; coverage is directional forecasts / mature
  forecasts. All mature probabilities enter Brier (mean squared error) and binary log
  loss (natural log; clip to [1e-6, 1−1e-6]). Calibration uses ten buckets [0,.1), …,
  [.9,1], with count, mean probability and observed up rate. Empty metrics are null.
- **Target before stop:** separately requires the complete declared horizon (1–20).
  Long target must be above entry and stop below; short is reversed. Check each future
  bar's high/low, stop first when both touch on one bar. Report target, stop, neither,
  invalid_levels and not_applicable separately. Target-first rate divides by all valid
  setups, including neither. This is a barrier event, not a fill simulation.
  Pending five-bar and declared-horizon counts are separate; missing asof bars are reported.
- **Paired comparisons:** each condition versus each mechanical condition on identical
  (symbol, asof) keys. Report matched count, full candidate/baseline metrics and forecast
  deltas (candidate minus baseline; lower Brier/log loss is better). Mature forecast
  denominators follow the same horizon rule; if horizons differ, inspect both counts.
  These are descriptive comparisons, with no significance/independence claim.

Mechanical forecasts all use probability .5, no target/stop, horizon five. EMA20 is
seeded at the first retained close and long only when latest close > EMA20 (else short).
Momentum20 compares the latest close with the close **20 trading intervals earlier**
(Python c[-21]); ties are unclear. buy_hold is long on all collected forecast days,
with cash on missing forecast days; it is not a continuous benchmark over outages.

## API and dashboard

All POSTs require `Authorization: Bearer <WRITE_TOKEN>`; authorization hashes both
strings and compares every digest byte without token-content early exits. GETs are public.

| Route | Body / result |
|---|---|
| POST /api/bars | `{ "bars": [{symbol,date,open,high,low,close}] }` (max 2000 bars) |
| POST /api/predictions | One prediction: symbol, asof, condition, model, skill_sha, always_in, p_up_5, target, stop, horizon, state, close, reading |
| POST /api/runs | started_at, finished_at, host, ok (boolean), log |
| GET /api/predictions?symbol=&condition=&limit= | `{predictions:[…]}`, newest first; default 100, cap 1000 |
| GET /api/stats | Condition, symbol, forecast, paired and account metrics, cost_bps, days_running |
| GET /api/equity | Condition → dated equity curve |
| GET / | Dashboard, Chart.js 4.4.1 from cdnjs, inline CSS/JS |
| GET /reading/:id | Escaped full reading with model and revision |

Dashboard includes exposure, pending forecasts, full readings, paired/calibration JSON,
light/dark system preference and mobile tables. Without the chart CDN the tables and
readings still work. No Worker cron is needed. Public statistics currently scan the
stored history: monitor D1 row-read/Worker CPU quotas as months accumulate; cache or
materialize aggregates if necessary. No automated retention or backups are configured.

## Limitations and extending

Yahoo can lag, throttle, revise OHLC, omit bars and use split adjustments inconsistently;
raw quote OHLC excludes dividends and other total-return effects. A missing vendor bar
changes trading-bar alignment. Recent upserts can revise past outcomes. Data gaps beyond
the configured lookback need operator bar backfill; never backfill historical LLM calls
as if they had been prospective. Overnight gaps, intraday paths, borrow/funding, interest,
slippage, market impact, actual closing fills and taxes are not modeled. Five-bar outcomes
overlap and symbols correlate, so small apparent edges and ordinary IID significance
tests are unreliable. Model drift, optional stopping and repeated prompt tuning confound
comparisons; collect months and preserve version information before drawing conclusions.

Add a Yahoo symbol to config.json's symbols array; ensure it follows the US-session policy.
Add/remove mechanical names in conditions and implement their rule in mechanical();
add LLM prompt/dispatch explicitly for a new LLM condition. Worker condition names are
open text and appear automatically in statistics/dashboard. A new condition starts when
first collected, so use paired metrics for unequal coverage. Freeze and document any
changes; changing a rule under the same condition name mixes regimes.

## Five-minute paper trading and daily recap

Open `/intraday?symbol=SPY` for equity, metrics, decisions and readings. Open
`/recap?symbol=SPY` for the latest Chinese review and chart, or
`/recap/YYYY-MM-DD?symbol=SPY` for a specific session. The symbols default to SPY
in `runner/config.json` (`intraday_symbols`). Change `intraday_model` to override
Sonnet for the two prediction conditions. Recaps use the Claude CLI default model.
A normal session has 25 decision points and up to 50 forecast calls per symbol,
plus one recap and up to one retry per invalid model response.

Yahoo 5-minute OHLC is filtered to regular-session starts in 09:30–15:55 ET.
The runner uses New York zoneinfo, excludes the closing auction and waits 20
seconds after a bar closes. Bar numbers are clock slots, so vendor gaps do not
renumber later bars. Forecasts use today's tape through the decision and up to
two previous sessions as context. A timer runs after bars 3, 6, …, 75. Each run
can generate forecasts only for the latest eligible point, skips stored
conditions, and records older uncollected points from the current session as
missed. Recap requires a contiguous completed session and uses the prior daily
close, high and low from Yahoo. Holidays with no session bars are skipped.

- Skill and plain Claude run in parallel. The skill receives computed features.
  EMA20 uses the two prior sessions and today's closes through the decision.
  Opening bar follows its body direction, with bodies at or below 25% of the
  range treated as dojis. Buy and hold stays long after its first eligible entry.
  Mechanical forecasts use probability .5 and have no target/stop.
- Positions change at the exact next bar's open and flatten at the last session
  bar's close. A missed signal leaves an existing position in place until the next
  available decision entry or the close. Each symbol/day starts flat. Next-open
  prices are hypothetical since the collection buffer and model latency occur
  after that open. Target and stop evaluation is separate from the account.
- Daily P&L uses fixed session-open notional, including the configured
  `INTRADAY_COST_BPS` (default 1) per unit of position change. Daily returns are
  equal-weighted across symbols with decisions and compounded from equity 1.
  Sharpe uses completed days and sample standard deviation scaled by sqrt(252).
  Exposure is the fraction of observed session slots spent long or short.
  In-progress equity is marked at the latest stored close. The final bar of an
  early-close session depends on Yahoo's regular trading period metadata.
- Direction and probability use the exact same-session close six slots later.
  A tie counts as no up move. Unclear is excluded from direction hits and
  included in Brier and log loss. Target/stop use same-session high/low with
  stop winning a double touch. Pending outcomes and unavailable outcomes
  (session ends or bar gaps) are counted separately. Paired metrics use matched
  symbol, session and decision points.

| Route | Body / result |
|---|---|
| POST /api/intraday/bars | `{bars:[{symbol,ts,session,bar,open,high,low,close,volume,final?}]}` |
| POST /api/intraday/predictions | One forecast with `symbol,session,bar,ts,condition,model,skill_sha,always_in,p_up_6,target,stop,horizon,day_type,close,reading` |
| GET /api/intraday/predictions?symbol=&session=&condition=&limit= | `{predictions:[…]}`, newest first |
| GET /api/intraday/stats?symbol= | Account, forecast and paired metrics |
| POST /api/recaps | `{symbol,session,day_type,markdown,annotations,levels,model,skill_sha,prior?,force?}` |
| GET /api/recaps?symbol=&session= | `{recaps:[…]}`, latest first, symbol defaults to SPY |

Timestamps are UTC bar starts. All writes use the existing Bearer token.
Intraday predictions are insert-only at their decision key. Recaps are
insert-only at their session key unless explicitly forced. Follow the
[Precision setup](deploy/precision-setup.md#add-intraday-to-an-existing-production-installation)
for the additive D1 migration and independent timers. Stats read intraday history
for the requested symbol (or all symbols when omitted).
