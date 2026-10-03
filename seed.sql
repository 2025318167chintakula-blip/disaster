INSERT INTO incidents (title, location, severity, status)
SELECT 'Flood Warning', 'Yamuna Sector 4', 'CRITICAL', 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM incidents WHERE title = 'Flood Warning' AND location = 'Yamuna Sector 4')
