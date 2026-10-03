# Sentinel DM — Local Setup

## Requirements
- Node.js 18+
- PostgreSQL 14+

## 1. Install dependencies
```bash
npm install
```

## 2. Create the database
Create a PostgreSQL database named `disaster_management`.

Example with psql:
```sql
CREATE DATABASE disaster_management;
```

## 3. Configure environment
Copy `.env.example` to `.env` and update `DATABASE_URL` if your PostgreSQL username/password differs.

## 4. Initialize database
```bash
npm run db:init
```

This creates the local schema and demonstration data.

## 5. Start
Development:
```bash
npm run dev
```

Normal:
```bash
npm start
```

Open **http://localhost:3000**

## Demo login
- Email: `demo@sentinel.local`
- Password: `local-demo-password`

Change this demo credential before using the project outside a classroom/demo environment.

## Architecture
Browser → Express/Node.js → PostgreSQL

Local development is intentionally self-contained. The application uses Express for the web/API layer and PostgreSQL for authentication, incidents, telemetry, teams, dispatches and audit history. The old hosted-platform files are not required to run this version.


## What this project demonstrates

- Role-ready authenticated command-center workflow
- PostgreSQL-backed incident lifecycle
- Live sensor telemetry and risk calculation
- Emergency team availability and dispatch lifecycle
- Audit logging for operational actions
- Health endpoint for local service verification
- Responsive command-center UI suitable for academic demonstration

## Important

This is an academic emergency-response simulation, not a certified real-world emergency service. Do not use the demo credentials or simulated sensor values for actual emergency decisions.
