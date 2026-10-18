-- Seats now carry their own polygon inside zones.seats
-- ([[{"name": "A01", "vertices": [[x, y], ...]}, ...], ...]), so the zone outline is unused.
-- Zones in the old format (seat names only) have no seat polygons and must be redrawn.
ALTER TABLE zones DROP COLUMN vertices;
