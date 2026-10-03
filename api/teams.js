import { db } from "hatchable";
export const access = "user";
export const methods = ["GET"];
export default async function (req, res) {
  const { rows } = await db.query("SELECT id, name, specialty, location, status, members, updated_at FROM response_teams ORDER BY name");
  res.json({ teams: rows });
}