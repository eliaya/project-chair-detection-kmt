-- Admin accounts for the management UI.
CREATE TABLE admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Edge devices (Raspberry Pi). Only the SHA-256 of the API token is stored.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE cameras (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  device_path TEXT NOT NULL DEFAULT '/dev/video0',
  fps INTEGER NOT NULL DEFAULT 1,
  width INTEGER NOT NULL DEFAULT 1920,
  height INTEGER NOT NULL DEFAULT 1080
);

-- seats: JSON, one array per table (format changed in 0002_seat_polygons.sql).
CREATE TABLE zones (
  id TEXT PRIMARY KEY,
  camera_id TEXT NOT NULL REFERENCES cameras(id),
  description TEXT NOT NULL DEFAULT '',
  vertices TEXT NOT NULL,
  seats TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES (
  'thresholds',
  '{"confidence":0.5,"confirm_frames":3,"leave_grace_s":10.0,"staff_aspect_ratio":1.5,"staff_speed_px":50}'
);

-- Latest status per seat id sent by main.py (e.g. zone_A_s00 = table 0 of zone_A).
CREATE TABLE seat_state (
  seat_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL,
  since TEXT NOT NULL
);

-- One row per status change.
CREATE TABLE occupancy_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seat_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX occupancy_events_ts ON occupancy_events (ts);
