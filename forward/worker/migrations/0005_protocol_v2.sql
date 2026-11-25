-- Scoring protocol v2 snapshots. Additive and safe to run more than once; v1 rows in metrics_snapshots stay untouched.
CREATE TABLE IF NOT EXISTS metrics_snapshots_v2 (
 scope TEXT NOT NULL CHECK(scope IN ('daily','intraday')), as_of DATE NOT NULL,
 condition TEXT NOT NULL, symbol TEXT NOT NULL DEFAULT '*',
 metrics_json TEXT NOT NULL, rolling20_json TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(scope,as_of,condition,symbol)
);
