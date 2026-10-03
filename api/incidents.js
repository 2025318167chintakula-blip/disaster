import { db } from "hatchable";

export const access = "public";
export const methods = ["GET", "POST"];

export default async function (req, res) {
  if (req.method === "GET") {
    const { rows } = await db.query(
      "SELECT id, title, location, severity, status, created_at FROM incidents ORDER BY created_at DESC"
    );
    return res.json({ incidents: rows });
  }

  const body = req.body || {};
  const title = String(body.title || "").trim();
  const location = String(body.location || "").trim();
  const severity = String(body.severity || "WARNING").trim().toUpperCase();

  if (!title || !location) {
    return res.status(400).json({ error: "Title and location are required." });
  }

  const allowed = ["CRITICAL", "WARNING", "INFO"];
  if (!allowed.includes(severity)) {
    return res.status(400).json({ error: "Invalid severity." });
  }

  const { rows } = await db.query(
    "INSERT INTO incidents (title, location, severity, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id, title, location, severity, status, created_at",
    [title, location, severity]
  );

  return res.status(201).json({ incident: rows[0] });
}
