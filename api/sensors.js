import { db } from "hatchable";
export const access = "user";
export const methods = ["GET"];
export default async function (req, res) {
  const { rows } = await db.query("SELECT id, name, category, value, unit, status, location, battery, updated_at FROM sensors ORDER BY category, name");
  res.json({ sensors: rows });
}