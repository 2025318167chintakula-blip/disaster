import { db } from "hatchable";

export const access = "public";
export const methods = ["GET"];

export default async function (req, res) {
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS active_incidents, COUNT(*) FILTER (WHERE severity = 'CRITICAL')::int AS critical_incidents FROM incidents WHERE status = 'ACTIVE'"
  );
  return res.json(rows[0]);
}
