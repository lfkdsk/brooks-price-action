-- Nullable target/stop direction check (1 = consistent, 0 = inverted, NULL = not applicable/unknown).
-- ALTER TABLE ADD COLUMN cannot use IF NOT EXISTS in SQLite: run this file exactly once
-- (a second run fails harmlessly with "duplicate column name").
ALTER TABLE predictions ADD COLUMN levels_ok INTEGER;
ALTER TABLE ipredictions ADD COLUMN levels_ok INTEGER;
