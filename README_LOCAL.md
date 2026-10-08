# Sentinel DM — Integrated Disaster Management, Risk Monitoring & Emergency Response Platform

Sentinel DM is a full-stack disaster-management command center built on the existing project architecture:

**Browser → Node.js / Express → PostgreSQL**

It demonstrates how incident reporting, simulated environmental telemetry, risk assessment, response-team coordination, mission dispatch, emergency alerts, analytics and audit tracking can be combined into one operational workflow.

> **Simulation environment:** sensor telemetry, locations and emergency records are demo data. This project does not claim official government, NDRF, satellite or real-time emergency integrations.

## 1. Problem Statement

During a disaster, information about incidents, field conditions, available teams and response actions can become fragmented. A centralized command interface can reduce this fragmentation by presenting operational information in one place.

## 2. Proposed Solution

Sentinel DM provides a browser-based Emergency Operations Center with:

- Incident lifecycle management
- Simulated environmental sensor telemetry
- Rule-based disaster risk scoring
- Response-team availability and mission control
- Interactive Leaflet/OpenStreetMap situation map
- Emergency alerts and in-app notifications
- Operational analytics and charts
- Preparedness guides
- Configurable emergency contacts
- Role-aware authentication
- Audit logging
- Local rule-based safety assistant
- PostgreSQL-backed demo data

## 3. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js 18+, Express.js |
| Database | PostgreSQL 14+ |
| Mapping | Leaflet + OpenStreetMap |
| Charts | Chart.js |
| Authentication | HTTP-only session cookie + PostgreSQL sessions |
| Password security | Node.js scrypt verification |
| Runtime | Localhost |

No React conversion or unnecessary infrastructure is required.

## 4. System Architecture

```
User Browser
    ↓
HTML / CSS / JavaScript
    ↓
REST API
    ↓
Express.js
    ↓
Authentication + Role Checks
    ↓
PostgreSQL
    ↓
Incidents / Sensors / Teams / Dispatches / Alerts / Analytics / Audit
```

## 5. Core Database Design

Main tables:

- `app_users` — authenticated users and roles
- `sessions` — hashed session tokens and expiry
- `incidents` — disaster events, severity, coordinates and lifecycle
- `sensors` — simulated telemetry and thresholds
- `response_teams` — specialties, availability and coordinates
- `dispatches` — missions and response lifecycle
- `audit_logs` — operational accountability
- `alerts` — emergency safety messages
- `notifications` — in-app user notifications
- `risk_history` — risk score history
- `emergency_services` — configurable contact directory
- `preparedness_guides` — BEFORE / DURING / AFTER safety content

The schema uses additive migrations such as `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` so existing installations can be upgraded without deleting the original core tables.

## 6. Authentication & Roles

The local demo user is an ADMIN account.

Roles:

- **ADMIN** — full operational access
- **OPERATOR** — incidents, sensors, teams, dispatches, reports and alerts
- **RESPONDER** — assigned response workflow and team status updates

State-changing API operations are protected by authentication and role checks.

Session tokens are stored hashed in PostgreSQL. Passwords are verified using Node.js scrypt.

## 7. Incident Workflow

```
Reported
   ↓
Verified / assessed
   ↓
Team assigned
   ↓
UNDER RESPONSE
   ↓
Mission ACTIVE / EN ROUTE
   ↓
Mission COMPLETED
   ↓
Incident RESOLVED
```

Every major update is written to the audit log.

Disaster types include:

Flood, Earthquake, Cyclone, Fire, Landslide, Tsunami, Heatwave, Drought, Industrial Accident, Gas Leak, Chemical Hazard and Building Collapse.

## 8. Sensor Monitoring

The Environmental Monitoring Center displays:

- Current value
- Unit
- Status
- Battery
- Location
- Warning threshold
- Critical threshold
- Last update

The **Simulate reading** control allows a viva/demo operator to change a value from the UI without manually editing PostgreSQL.

The UI clearly labels these values as **SIMULATED TELEMETRY**.

## 9. Risk Assessment

Risk score is generated from simulated sensor readings and active incidents.

- 0–29: LOW
- 30–49: MODERATE
- 50–74: ELEVATED
- 75–100: HIGH

The score displays its main drivers and is stored in `risk_history`.

The score is an academic rule-based decision-support demonstration, not an official warning system.

## 10. Mission Control

A dispatcher can create a mission with:

- Incident
- Destination
- Priority
- Response team

Mission status:

- PENDING
- ACTIVE
- EN ROUTE
- COMPLETED

Team state is automatically coordinated with mission progress.

## 11. Live Situation Map

Leaflet and OpenStreetMap provide an interactive map.

Map layers include:

- 🔴 Critical incidents
- 🟠 Warning incidents
- 🔵 Response teams
- 🟣 Sensors
- 🟢 Emergency services

Coordinates are stored in PostgreSQL and returned through `/api/map`.

## 12. Alerts & Notifications

Emergency alerts contain:

- Title
- Disaster type
- Severity
- Location
- Message
- Recommended action
- Expiration
- Status

Critical alerts are surfaced on the dashboard. In-app notifications are generated for important incident, sensor, team and dispatch events.

## 13. Analytics

Reports use PostgreSQL data rather than hardcoded dashboard values.

Included analytics:

- Incidents by disaster type
- Severity distribution
- Incidents over time
- Average response time
- Completed missions
- Resource utilization
- Team status
- Sensor status

## 14. Preparedness Center

Citizen-facing guidance is organized into:

- Flood Safety
- Earthquake Safety
- Fire Safety
- Cyclone Safety

Each guide contains:

**BEFORE → DURING → AFTER**

## 15. API Structure

Existing core endpoints are preserved:

- `GET /api/me`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/dashboard`
- `GET /api/incidents`
- `POST /api/incidents`
- `PATCH /api/incidents`
- `GET /api/sensors`
- `PATCH /api/sensors`
- `GET /api/teams`
- `PATCH /api/teams`
- `GET /api/dispatches`
- `POST /api/dispatches`
- `PATCH /api/dispatches`
- `GET /api/reports`
- `GET /api/activity`
- `GET /api/risk`
- `GET /api/health`

Additional endpoints:

- `GET /api/incidents/:id`
- `GET /api/risk/history`
- `GET /api/audit`
- `GET /api/alerts`
- `POST /api/alerts`
- `PATCH /api/alerts/:id`
- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `GET /api/map`
- `GET /api/emergency-services`
- `GET /api/preparedness`

## 16. Local Installation

### Requirements

- Node.js 18+
- PostgreSQL 14+

### Install

```bash
npm install
```

### Create database

Using psql:

```sql
CREATE DATABASE disaster_management;
```

### Configure environment

Copy `.env.example` to `.env` and change `DATABASE_URL` if necessary.

### Initialize / upgrade database

```bash
npm run db:init
```

The schema is designed to be repeatable and additive.

### Start development server

```bash
npm run dev
```

Open:

**http://localhost:3000**

## 17. Demo Credentials

- Email: `demo@sentinel.local`
- Password: `local-demo-password`

Change the demo credential before using the application in a production environment.

## 18. Recommended Demonstration

1. Login as the demo operator.
2. Show the Emergency Operations Center dashboard.
3. Explain live database-backed KPI values.
4. Open Sensor Network.
5. Increase a simulated water/smoke value using **Adjust simulated value**.
6. Show the risk score and drivers changing.
7. Create a critical flood incident.
8. Show it in the incident queue and situation map.
9. Create a dispatch and assign a response team.
10. Move the mission from PENDING → ACTIVE → EN ROUTE.
11. Complete the mission.
12. Resolve the incident.
13. Open Audit Log.
14. Open Reports & Analytics.
15. Show preparedness, emergency contacts and the local safety assistant.

This gives a complete end-to-end operational workflow without manual database editing.

## 19. Security Notes

- Database credentials remain in environment variables.
- Session tokens are hashed before storage.
- Session cookies are HTTP-only.
- Authentication and authorization middleware protect operational APIs.
- SQL uses parameterized queries.
- User input is validated at API boundaries.
- Demo/simulated values are clearly labelled.

## 20. Limitations

This is a college project and simulation. It does not provide:

- Verified government emergency integration
- Real NDRF data
- Real satellite monitoring
- Real IoT hardware telemetry
- Certified emergency dispatch
- Guaranteed emergency advice

## 21. Future Scope

Possible future extensions:

- Verified government and weather APIs
- Real IoT gateway integration
- SMS / push notification providers
- Advanced GIS layers
- ML-based risk prediction
- Offline-first responder application
- Role administration UI
- Cloud deployment with managed PostgreSQL
- Real-time event streaming

## 22. Project Positioning

**Sentinel DM: An Integrated Disaster Management, Risk Monitoring and Emergency Response Coordination Platform**

The project combines:

**Incident Management + Sensor Monitoring + Risk Assessment + Response Teams + Mission Dispatch + Emergency Alerts + Analytics + Audit Tracking**

This is the central story of the platform.
