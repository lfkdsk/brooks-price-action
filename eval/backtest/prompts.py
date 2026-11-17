"""Prompts contain no instrument, date, source path, or private metadata."""
CONTRACT = '''Instrument and dates are hidden on purpose; do not guess them. Only use supplied bars.
All bars are closed daily bars; bar 0 is the as-of close. Weekly bars are pre-aggregated,
with the oldest week possibly partial. Prices use an affine anonymized scale, grid 0.25.
Do not use retrieval, external data, other directories, or similar_cases.py.
Give a reading under 500 words. Predict close at +5 strictly greater than close at 0.
Always In is the directional position for the next five bars. Optional target and stop
must be on the favorable/adverse sides of 1000 for that direction; otherwise use null.
Horizon must be 1..20. End your response with a fenced ```json block containing exactly
these fields (replace example values with your forecast):
```json
{"always_in":"unclear","p_up_5":0.5,"target":null,"stop":null,"horizon_bars":5,"state":"trading_range"}
```'''

def prompt(condition):
    if condition=='skill':
        start='''Read skill/SKILL.md and follow its reading procedure and references. Override its
instrument/date requests, retrieval step and --weekly instruction with this experiment's rules.
Run python3 skill/scripts/bar_features.py bars.csv --tick 0.25 --last 60
Run python3 skill/scripts/bar_features.py weekly.csv --tick 0.25 --last 12
Use the latter as weekly context, without --weekly (integer labels are not ISO dates).
'''
    elif condition=='baseline':
        start='Give a Brooks-style chart reading from bars.csv and weekly.csv. Cover state, bulls/bears, Always In, levels and next conditions.\n'
    else: raise ValueError(condition)
    return start+CONTRACT
