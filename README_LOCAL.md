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

The original Hatchable API files remain in `api/` for the deployed Hatchable version. Local development uses `server.js` and the same frontend routes (`/api/*`), so the UI workflows remain consistent.
