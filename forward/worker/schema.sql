CREATE TABLE IF NOT EXISTS bars (
 symbol TEXT NOT NULL, date DATE NOT NULL, open REAL NOT NULL, high REAL NOT NULL,
 low REAL NOT NULL, close REAL NOT NULL, PRIMARY KEY(symbol,date)
);
CREATE TABLE IF NOT EXISTS predictions (
 id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, asof DATE NOT NULL, condition TEXT NOT NULL,
 model TEXT, skill_sha TEXT, always_in TEXT NOT NULL CHECK(always_in IN ('long','short','unclear')),
 p_up_5 REAL NOT NULL, target REAL, stop REAL, horizon INTEGER NOT NULL DEFAULT 5,
 state TEXT, close REAL, reading TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(symbol,asof,condition)
);
CREATE TABLE IF NOT EXISTS runs (
 id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT, host TEXT, ok INTEGER, log TEXT
);
CREATE INDEX IF NOT EXISTS predictions_asof ON predictions(asof);
