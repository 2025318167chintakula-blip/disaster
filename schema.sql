CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'OPERATOR' CHECK (role IN ('ADMIN','OPERATOR','RESPONDER')),
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
  disaster_type TEXT NOT NULL DEFAULT 'Other',
  location TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL','WARNING','INFO')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','UNDER RESPONSE','RESOLVED')),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_by TEXT,
  reporter TEXT,
  assigned_team UUID REFERENCES response_teams(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sensors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  value TEXT NOT NULL,
  unit TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ONLINE' CHECK (status IN ('ONLINE','OFFLINE','MAINTENANCE')),
  location TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  battery INTEGER NOT NULL DEFAULT 100 CHECK (battery BETWEEN 0 AND 100),
  threshold_warning DOUBLE PRECISION,
  threshold_critical DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS response_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  location TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','DEPLOYED','EN ROUTE','OFFLINE')),
  members INTEGER NOT NULL DEFAULT 4,
  current_mission TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
  team_id UUID REFERENCES response_teams(id) ON DELETE SET NULL,
  mission TEXT NOT NULL,
  destination TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','CRITICAL')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','EN ROUTE','COMPLETED')),
  created_by TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  disaster_type TEXT NOT NULL DEFAULT 'General',
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL','WARNING','INFORMATION')),
  location TEXT NOT NULL,
  message TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','DISMISSED')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk_history (
  id BIGSERIAL PRIMARY KEY,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  level TEXT NOT NULL,
  drivers TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS emergency_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  phone TEXT NOT NULL,
  location TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS preparedness_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disaster_type TEXT NOT NULL,
  title TEXT NOT NULL,
  before_steps TEXT[] NOT NULL DEFAULT '{}',
  during_steps TEXT[] NOT NULL DEFAULT '{}',
  after_steps TEXT[] NOT NULL DEFAULT '{}'
);

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'OPERATOR';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS disaster_type TEXT NOT NULL DEFAULT 'Other';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reporter TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_team UUID REFERENCES response_teams(id) ON DELETE SET NULL;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS threshold_warning DOUBLE PRECISION;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS threshold_critical DOUBLE PRECISION;
ALTER TABLE response_teams ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE response_teams ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE response_teams ADD COLUMN IF NOT EXISTS current_mission TEXT;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE app_users SET role='OPERATOR' WHERE role IS NULL;
UPDATE incidents SET updated_at=created_at WHERE updated_at IS NULL;
UPDATE dispatches SET updated_at=created_at WHERE updated_at IS NULL;

INSERT INTO app_users (email,name,password_hash,role)
VALUES ('demo@sentinel.local','Demo Operator','scrypt$16384$8$1$sentinel-demo-salt-2026$T1nPZuL5pq1zn/7OejYp21CcS8BjQONDWyZyc7Ktn1e7lhFjET45ECMDM9gMLmeo5X2WEZH8LM4alZPyvL7FnA==','ADMIN')
ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,role='ADMIN';

INSERT INTO sensors (name,category,value,unit,status,location,latitude,longitude,battery,threshold_warning,threshold_critical)
SELECT * FROM (VALUES
('Yamuna Water Level','WATER','92','cm','ONLINE','Yamuna Sector 4',28.6139,77.2090,91,70.0,90.0),
('Zone 7 Vibration','VIBRATION','0.84','g','ONLINE','Zone 7',28.6200,77.2150,87,0.60,0.80),
('Industrial B Smoke','SMOKE','68','ppm','ONLINE','Industrial B',28.6250,77.2250,78,40.0,75.0),
('Gas Monitor B','GAS','14','ppm','ONLINE','Industrial B',28.6250,77.2250,83,10.0,20.0)
) AS v(name,category,value,unit,status,location,latitude,longitude,battery,threshold_warning,threshold_critical)
WHERE NOT EXISTS (SELECT 1 FROM sensors);

INSERT INTO response_teams (name,specialty,location,latitude,longitude,status,members,current_mission)
SELECT * FROM (VALUES
('Alpha Rescue Unit','Flood Rescue','Mathura North',28.6500,77.2100,'AVAILABLE',8,NULL),
('Bravo Medical Unit','Medical Response','Mathura Central',28.6350,77.2050,'DEPLOYED',6,'Medical support'),
('Charlie Fire Unit','Fire & Hazmat','Industrial B',28.6250,77.2250,'AVAILABLE',7,NULL),
('Delta Search Unit','Search & Rescue','Zone 7',28.6200,77.2150,'EN ROUTE',9,'Urban search')
) AS v(name,specialty,location,latitude,longitude,status,members,current_mission)
WHERE NOT EXISTS (SELECT 1 FROM response_teams);

INSERT INTO incidents (title,disaster_type,location,description,severity,status,latitude,longitude,reporter)
SELECT 'Yamuna flood warning','Flood','Yamuna Sector 4','Rising water level requires perimeter assessment and preparedness.','CRITICAL','ACTIVE',28.6139,77.2090,'Demo Operator'
WHERE NOT EXISTS (SELECT 1 FROM incidents);

INSERT INTO dispatches (incident_id,team_id,mission,destination,priority,status,started_at)
SELECT i.id,t.id,'Flood perimeter assessment',i.location,'CRITICAL','EN ROUTE',NOW()
FROM incidents i JOIN response_teams t ON t.name='Alpha Rescue Unit'
WHERE NOT EXISTS (SELECT 1 FROM dispatches);

INSERT INTO alerts (title,disaster_type,severity,location,message,recommended_action,expires_at)
SELECT 'Yamuna water level elevated','Flood','CRITICAL','Yamuna Sector 4',
'Simulated telemetry indicates a critical water-level threshold breach.',
'Keep flood-response resources ready and follow official local advisories.',
NOW()+INTERVAL '6 hours'
WHERE NOT EXISTS (SELECT 1 FROM alerts);

INSERT INTO emergency_services (name,service_type,phone,location,latitude,longitude,notes)
SELECT * FROM (VALUES
('National Emergency','Emergency','112','India',28.6139,77.2090,'Verify current official contact information before relying on this directory.'),
('Fire & Rescue','Fire','101','India',28.6139,77.2090,'Verify current official contact information before relying on this directory.'),
('Ambulance','Medical','108','India',28.6139,77.2090,'Verify current official contact information before relying on this directory.'),
('Police','Police','100','India',28.6139,77.2090,'Verify current official contact information before relying on this directory.'),
('Disaster Management','Disaster','1078','India',28.6139,77.2090,'Verify current official contact information before relying on this directory.')
) AS v(name,service_type,phone,location,latitude,longitude,notes)
WHERE NOT EXISTS (SELECT 1 FROM emergency_services);

INSERT INTO preparedness_guides (disaster_type,title,before_steps,during_steps,after_steps)
SELECT * FROM (VALUES
('Flood','Flood Safety',
ARRAY['Keep documents and medicines in a waterproof bag.','Know the nearest safe higher ground and evacuation route.','Store clean drinking water and essential food.'],
ARRAY['Move to higher ground and avoid walking or driving through moving water.','Switch off electricity only if it is safe to do so.','Follow official evacuation and weather instructions.'],
ARRAY['Return only when authorities say the area is safe.','Avoid contaminated water and damaged electrical systems.','Document damage and contact appropriate authorities or insurers.']),
('Earthquake','Earthquake Safety',
ARRAY['Secure heavy furniture and identify safe shelter points.','Keep an emergency kit and shoes accessible.'],
ARRAY['Drop, cover and hold on.','Stay away from windows and damaged structures.','If outdoors, move to an open area away from buildings and power lines.'],
ARRAY['Expect aftershocks.','Check for injuries and hazards before moving around.','Follow official instructions before re-entering damaged buildings.']),
('Fire','Fire Safety',
ARRAY['Keep exits clear and know two ways out.','Keep smoke alarms and extinguishers maintained.'],
ARRAY['Raise the alarm and evacuate quickly.','Stay low under smoke and never use lifts during a fire.','Do not re-enter until authorities declare it safe.'],
ARRAY['Seek medical attention for smoke inhalation or burns.','Report hazards and preserve evidence where appropriate.']),
('Cyclone','Cyclone Safety',
ARRAY['Monitor official weather alerts and secure loose outdoor objects.','Charge phones and prepare food, water and medicines.'],
ARRAY['Stay indoors away from windows.','Evacuate if instructed by authorities.','Avoid flooded roads and coastal areas.'],
ARRAY['Watch for further warnings and damaged utilities.','Help vulnerable people only when it is safe to do so.'])
) AS v(disaster_type,title,before_steps,during_steps,after_steps)
WHERE NOT EXISTS (SELECT 1 FROM preparedness_guides);

CREATE INDEX IF NOT EXISTS idx_incidents_status_created ON incidents(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_type ON incidents(disaster_type);
CREATE INDEX IF NOT EXISTS idx_incidents_coords ON incidents(latitude,longitude);
CREATE INDEX IF NOT EXISTS idx_sensors_status_category ON sensors(status,category);
CREATE INDEX IF NOT EXISTS idx_dispatches_status_created ON dispatches(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_status_created ON alerts(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_history_created ON risk_history(created_at DESC);
