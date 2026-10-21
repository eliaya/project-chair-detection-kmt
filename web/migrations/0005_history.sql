-- History: closed periods written by the Worker as seats change between used and empty.
-- period_since is when the seat's current used/empty period began (NULL: not known yet,
-- so that first period is not logged).
ALTER TABLE seat_state ADD COLUMN period_since TEXT;

-- A table is empty while every one of its seats is empty.
CREATE TABLE table_state (
  table_id TEXT PRIMARY KEY,
  empty INTEGER NOT NULL,
  since TEXT NOT NULL
);

-- kind: seat_used / seat_empty (target = seat id), table_empty (target = table id).
CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_s REAL NOT NULL
);
CREATE INDEX history_ended_at ON history (ended_at);

-- Keys for third-party programs calling /api/v1/*. Only the SHA-256 is stored.
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
