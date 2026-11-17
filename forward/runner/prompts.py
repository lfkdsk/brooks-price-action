"""Frozen forward-reading prompt. Only staging inputs are named."""

def prompt(condition, symbol, asof):
    instruction = (
        'Read skill/SKILL.md and follow its full procedure. Run '
        '`python3 skill/scripts/bar_features.py bars.csv --weekly --last 40`. '
        'Read the staged references as needed. Do not use retrieval.'
        if condition == 'skill' else
        'Give a Brooks-style price action reading using bars.csv, without any skill. '
        'Discuss weekly context, recent bars, market cycle, bulls/bears, levels, Always In and what traders will watch.'
    )
    return f'''This is a live forward paper-trading experiment, not an order request.
Instrument {symbol}, daily regular-session OHLC, as of closed bar {asof}, America/Los_Angeles.
bars.csv contains only information available through that date. Real symbols and dates are intentional.
{instruction}
Use only the supplied bars and staged files. Do not browse or inspect other filesystem paths.
Weekly data may include a partial current week: label it incomplete. Do not invent future information.
Write the full reading, then end with exactly one fenced json object with this contract:
```json
{{"always_in":"long|short|unclear","p_up_5":0.5,"target":null,"stop":null,"horizon_bars":5,"state":"bull_trend|bear_trend|trading_range"}}
```
p_up_5 is the probability close five trading bars later is strictly above the current close.
Choose one allowed always_in value. target/stop are price numbers on the correct sides of the current
close for your direction, or null when no setup. horizon_bars is an integer 1–20 (default 5).
Paper trading only; not advice. No orders.'''
