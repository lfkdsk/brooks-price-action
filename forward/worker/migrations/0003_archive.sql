-- Additive archive tables. Safe to run more than once (IF NOT EXISTS only).
CREATE TABLE IF NOT EXISTS ibars1m (
 symbol TEXT NOT NULL, ts TEXT NOT NULL, session DATE NOT NULL,
 minute INTEGER NOT NULL CHECK(minute BETWEEN 1 AND 390),
 open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL,
 PRIMARY KEY(symbol,ts)
);
CREATE INDEX IF NOT EXISTS ibars1m_session ON ibars1m(symbol,session,minute);
CREATE TABLE IF NOT EXISTS metrics_snapshots (
 scope TEXT NOT NULL CHECK(scope IN ('daily','intraday')), as_of DATE NOT NULL,
 condition TEXT NOT NULL, symbol TEXT NOT NULL DEFAULT '*',
 metrics_json TEXT NOT NULL, rolling20_json TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(scope,as_of,condition,symbol)
);
CREATE TABLE IF NOT EXISTS llm_calls (
 id INTEGER PRIMARY KEY, ts TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope IN ('daily','intraday','recap')),
 symbol TEXT, session_or_asof DATE, condition TEXT, model TEXT,
 duration_ms INTEGER, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
 cost_usd REAL, ok INTEGER NOT NULL DEFAULT 1 CHECK(ok IN (0,1)), error_type TEXT
);
CREATE INDEX IF NOT EXISTS llm_calls_scope ON llm_calls(scope,session_or_asof);
