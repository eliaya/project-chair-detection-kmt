-- main.py now excludes people whose box height/width exceeds staff_aspect_ratio (standing).
-- 1.5 also excludes many seated people, so the untouched default becomes 2.0.
UPDATE settings
SET value = json_set(value, '$.staff_aspect_ratio', 2.0)
WHERE key = 'thresholds' AND json_extract(value, '$.staff_aspect_ratio') = 1.5;
