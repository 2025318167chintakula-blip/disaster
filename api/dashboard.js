import { db } from "hatchable";

export const access = "user";
export const methods = ["GET"];

export default async function (req, res) {
  const [incidents, critical, sensors, teams, dispatches] = await Promise.all([
    db.query("SELECT COUNT(*)::int AS count FROM incidents WHERE status = 'ACTIVE'"),
    db.query("SELECT COUNT(*)::int AS count FROM incidents WHERE status = 'ACTIVE' AND severity = 'CRITICAL'"),
    db.query("SELECT COUNT(*)::int AS count FROM sensors WHERE status = 'ONLINE'"),
    db.query("SELECT COUNT(*)::int AS count FROM response_teams WHERE status IN ('AVAILABLE','DEPLOYED','EN ROUTE')"),
    db.query("SELECT COUNT(*)::int AS count FROM dispatches WHERE status IN ('PENDING','ACTIVE','EN ROUTE')")
  ]);
  return res.json({ active_incidents: incidents.rows[0].count, critical_incidents: critical.rows[0].count, sensors_online: sensors.rows[0].count, response_teams: teams.rows[0].count, active_dispatches: dispatches.rows[0].count });
}