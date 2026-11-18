CREATE TABLE IF NOT EXISTS ibars (
 symbol TEXT NOT NULL, ts TEXT NOT NULL, session DATE NOT NULL,
 bar INTEGER NOT NULL CHECK(bar BETWEEN 1 AND 78),
 open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
 volume REAL, final INTEGER NOT NULL DEFAULT 0 CHECK(final IN (0,1)),
 PRIMARY KEY(symbol,ts), UNIQUE(symbol,session,bar)
);
CREATE TABLE IF NOT EXISTS ipredictions (
 id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, session DATE NOT NULL,
 bar INTEGER NOT NULL CHECK(bar BETWEEN 3 AND 75 AND bar % 3 = 0),
 ts TEXT NOT NULL, condition TEXT NOT NULL, model TEXT NOT NULL, skill_sha TEXT NOT NULL,
 always_in TEXT NOT NULL CHECK(always_in IN ('long','short','unclear')),
 p_up_6 REAL NOT NULL, target REAL, stop REAL, horizon INTEGER NOT NULL,
 day_type TEXT NOT NULL, close REAL, reading TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(symbol,session,bar,condition)
);
CREATE INDEX IF NOT EXISTS ipredictions_session ON ipredictions(session DESC,bar DESC,id DESC);
CREATE TABLE IF NOT EXISTS recaps (
 symbol TEXT NOT NULL, session DATE NOT NULL, day_type TEXT NOT NULL,
 markdown TEXT NOT NULL, annotations TEXT NOT NULL, levels TEXT NOT NULL, prior TEXT,
 model TEXT NOT NULL, skill_sha TEXT NOT NULL,
 PRIMARY KEY(symbol,session)
);
