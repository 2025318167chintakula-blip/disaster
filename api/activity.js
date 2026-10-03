import { db } from "hatchable";
export const access = "user";
export const methods = ["GET"];
export default async function (req, res) {
  const { rows } = await db.query("SELECT action, entity, details, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 12");
  res.json({ activity: rows });
}