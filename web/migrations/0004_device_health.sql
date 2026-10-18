-- Connection feedback in the admin UI: when the Pi last fetched its config, and the
-- health main.py reports with each heartbeat (cameras, outbox size, inference time, version).
ALTER TABLE devices ADD COLUMN config_fetched_at TEXT;
ALTER TABLE devices ADD COLUMN health TEXT;
