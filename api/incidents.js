import { db } from "hatchable";

export const access = "user";
export const methods = ["GET", "POST", "PATCH"];

export default async function (req, res) {
  if (req.method === "GET") {
    const { rows } = await db.query("SELECT id, title, location, severity, status, created_at FROM incidents ORDER BY created_at DESC LIMIT 50");
    return res.json({ incidents: rows });
  }
  if (req.method === "PATCH") {
    const id = String(req.body?.id || "").trim();
    const status = String(req.body?.status || "").trim().toUpperCase();
    if (!id || !["ACTIVE","RESOLVED"].includes(status)) return res.status(400).json({ error: "Invalid incident update." });
    const { rows } = await db.query("UPDATE incidents SET status = $1 WHERE id = $2 RETURNING id, title, location, severity, status, created_at", [status, id]);
    if (!rows.length) return res.status(404).json({ error: "Incident not found." });
    await db.query("INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)", [req.user.id, "UPDATE", "incident", id, status]);
    return res.json({ incident: rows[0] });
  }
  const title = String(req.body?.title || "").trim();
  const location = String(req.body?.location || "").trim();
  const severity = String(req.body?.severity || "WARNING").trim().toUpperCase();
  if (!title || !location) return res.status(400).json({ error: "Incident name and location are required." });
  if (!["CRITICAL","WARNING","INFO"].includes(severity)) return res.status(400).json({ error: "Invalid severity." });
  const { rows } = await db.query("INSERT INTO incidents (title, location, severity, status, created_by) VALUES ($1, $2, $3, 'ACTIVE', $4) RETURNING id, title, location, severity, status, created_at", [title, location, severity, req.user.id]);
  await db.query("INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)", [req.user.id, "CREATE", "incident", rows[0].id, title]);
  return res.status(201).json({ incident: rows[0] });
}