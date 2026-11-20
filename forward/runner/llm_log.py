"""Best-effort cost/latency log for every `claude -p --output-format json` call.

Only metadata is recorded (model, duration, token counts, cost, ok, error type); never prompts,
outputs, environment values or tokens. Logging failures never fail a collection run.
"""
import datetime as dt
import json
import math


def _count(value):
    return value if type(value) is int and value >= 0 else None


def _sum(values):
    values = [v for v in values if v is not None]
    return sum(values) if values else None


def usage(raw):
    """Parse a Claude CLI JSON result envelope into llm_calls fields (missing fields are None).

    input_tokens counts uncached input plus cache writes; cache_read_tokens counts cache reads.
    Totals prefer the per-model `modelUsage` breakdown and fall back to the top-level `usage`.
    """
    out = dict(model=None, duration_ms=None, input_tokens=None, output_tokens=None,
               cache_read_tokens=None, cost_usd=None)
    try:
        obj = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return out
    if not isinstance(obj, dict):
        return out
    per_model = obj.get('modelUsage') if isinstance(obj.get('modelUsage'), dict) else {}
    per_model = {k: v for k, v in per_model.items() if isinstance(v, dict)}
    model = obj.get('model') if isinstance(obj.get('model'), str) else None
    out['model'] = (model or ','.join(sorted(per_model)) or None)
    if out['model']:
        out['model'] = out['model'][:200]
    out['duration_ms'] = _count(obj.get('duration_ms'))
    cost = obj.get('total_cost_usd', obj.get('cost_usd'))
    if type(cost) in (int, float) and math.isfinite(cost) and cost >= 0:
        out['cost_usd'] = float(cost)
    if per_model:
        rows = per_model.values()
        fresh = _sum(_count(r.get('inputTokens')) for r in rows)
        writes = _sum(_count(r.get('cacheCreationInputTokens')) for r in rows)
        out['input_tokens'] = _sum([fresh, writes])
        out['output_tokens'] = _sum(_count(r.get('outputTokens')) for r in rows)
        out['cache_read_tokens'] = _sum(_count(r.get('cacheReadInputTokens')) for r in rows)
        if out['cost_usd'] is None:
            costs = [r.get('costUSD') for r in rows if type(r.get('costUSD')) in (int, float) and math.isfinite(r['costUSD'])]
            out['cost_usd'] = float(sum(costs)) if costs else None
    if out['output_tokens'] is None and isinstance(obj.get('usage'), dict):
        u = obj['usage']
        out['input_tokens'] = _sum([_count(u.get('input_tokens')), _count(u.get('cache_creation_input_tokens'))])
        out['output_tokens'] = _count(u.get('output_tokens'))
        out['cache_read_tokens'] = _count(u.get('cache_read_input_tokens'))
    return out


def row(raw, *, scope, symbol=None, session_or_asof=None, condition=None, ok=True,
        error_type=None, elapsed_ms=None, now=None):
    """One /api/llm_calls row. elapsed_ms (wall clock) is used when the CLI reports no duration."""
    fields = usage(raw)
    if fields['duration_ms'] is None and elapsed_ms is not None:
        fields['duration_ms'] = max(0, int(elapsed_ms))
    ts = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
    return dict(fields, ts=ts.isoformat(timespec='seconds').replace('+00:00', 'Z'), scope=scope,
                symbol=symbol, session_or_asof=session_or_asof, condition=condition,
                ok=bool(ok), error_type=(error_type or None) and str(error_type)[:60])


def recorder(api, **context):
    """Return log(raw, ok=..., error_type=..., elapsed_ms=...) that POSTs one row, swallowing errors."""
    if api is None:
        return None

    def log(raw, **result):
        try:
            api.request('POST', '/api/llm_calls', row(raw, **context, **result))
        except Exception as exc:  # noqa: BLE001 - logging is best effort
            print(f'llm_calls log skipped ({type(exc).__name__})')
    return log


def emit(log, raw, **result):
    """Call a recorder if one was given; never raise."""
    if log is None:
        return
    try:
        log(raw, **result)
    except Exception as exc:  # noqa: BLE001
        print(f'llm_calls log skipped ({type(exc).__name__})')


def run_cli(run, command, log=None, unwrap=None, **kwargs):
    """Run one CLI call with `run` (the caller's subprocess.run) and log failures.

    Returns (stdout, reading, model, finish) where finish(ok, error_type=None) logs the outcome
    once the caller has parsed the reading. Timeouts, non-zero exits and error envelopes are
    logged here and re-raised.
    """
    import subprocess
    import time
    started = time.monotonic()
    elapsed = lambda: (time.monotonic() - started) * 1000  # noqa: E731
    try:
        proc = run(command, **kwargs)
    except subprocess.TimeoutExpired:
        emit(log, None, ok=False, error_type='timeout', elapsed_ms=elapsed())
        raise
    if proc.returncode:
        emit(log, proc.stdout, ok=False, error_type=f'exit_{proc.returncode}', elapsed_ms=elapsed())
        raise RuntimeError(f'Claude exited {proc.returncode}')
    took = elapsed()
    try:
        reading, model = unwrap(proc.stdout)
    except RuntimeError:
        emit(log, proc.stdout, ok=False, error_type='cli_error', elapsed_ms=took)
        raise

    def finish(ok, error_type=None):
        emit(log, proc.stdout, ok=ok, error_type=error_type, elapsed_ms=took)
    return proc.stdout, reading, model, finish


def levels_ok(always_in, target, stop, close):
    """1 if target/stop sit on the correct side of the entry close, 0 if inverted, None if n/a.

    Long: target > close and stop < close. Short: the opposite. Missing levels are skipped.
    """
    side = {'long': 1, 'short': -1}.get(always_in)
    finite = lambda v: type(v) in (int, float) and math.isfinite(v)  # noqa: E731
    if not side or not finite(close):
        return None
    checks = []
    if finite(target):
        checks.append(side * (target - close) > 0)
    if finite(stop):
        checks.append(side * (stop - close) < 0)
    return int(all(checks)) if checks else None
