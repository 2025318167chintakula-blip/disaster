CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Core indexes keep command-center queries fast as the dataset grows.

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL','WARNING','INFO')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RESOLVED')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sensors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  value TEXT NOT NULL,
  unit TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ONLINE',
  location TEXT NOT NULL,
  battery INTEGER NOT NULL DEFAULT 100,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS response_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  location TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  members INTEGER NOT NULL DEFAULT 4,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
  team_id UUID REFERENCES response_teams(id) ON DELETE SET NULL,
  mission TEXT NOT NULL,
  destination TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_users (email,name,password_hash)
VALUES ('demo@sentinel.local','Demo Operator','scrypt$16384$8$1$sentinel-demo-salt-2026$T1nPZuL5pq1zn/7OejYp21CcS8BjQONDWyZyc7Ktn1e7lhFjET45ECMDM9gMLmeo5X2WEZH8LM4alZPyvL7FnA==')
ON CONFLICT (email) DO NOTHING;

INSERT INTO sensors (name,category,value,unit,status,location,battery)
SELECT * FROM (VALUES
('Yamuna Water Level','WATER','92','cm','ONLINE','Yamuna Sector 4',91),
('Zone 7 Vibration','VIBRATION','0.84','g','ONLINE','Zone 7',87),
('Industrial B Smoke','SMOKE','68','ppm','ONLINE','Industrial B',78),
('Gas Monitor B','GAS','14','ppm','ONLINE','Industrial B',83)
) AS v(name,category,value,unit,status,location,battery)
WHERE NOT EXISTS (SELECT 1 FROM sensors);

INSERT INTO response_teams (name,specialty,location,status,members)
SELECT * FROM (VALUES
('Alpha Rescue Unit','Flood Rescue','Mathura North','AVAILABLE',8),
('Bravo Medical Unit','Medical Response','Mathura Central','DEPLOYED',6),
('Charlie Fire Unit','Fire & Hazmat','Industrial B','AVAILABLE',7),
('Delta Search Unit','Urban Search & Rescue','Zone 7','EN ROUTE',9)
) AS v(name,specialty,location,status,members)
WHERE NOT EXISTS (SELECT 1 FROM response_teams);

INSERT INTO incidents (title,location,severity,status)
SELECT 'Flood Warning','Yamuna Sector 4','CRITICAL','ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM incidents);


CREATE INDEX IF NOT EXISTS idx_incidents_status_created ON incidents(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sensors_status_category ON sensors(status, category);
CREATE INDEX IF NOT EXISTS idx_dispatches_status_created ON dispatches(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

INSERT INTO dispatches (incident_id, team_id, mission, destination, priority, status)
SELECT i.id, t.id, 'Flood perimeter assessment', i.location, 'CRITICAL', 'ACTIVE'
FROM incidents i CROSS JOIN LATERAL (SELECT id FROM response_teams WHERE name='Alpha Rescue Unit' LIMIT 1) t
WHERE NOT EXISTS (SELECT 1 FROM dispatches);