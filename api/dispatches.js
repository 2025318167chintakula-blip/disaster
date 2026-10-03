import { db } from "hatchable";
export const access = "user";
export const methods = ["GET", "POST", "PATCH"];
export default async function (req, res) {
  if (req.method === "GET") {
    const { rows } = await db.query("SELECT d.id, d.mission, d.destination, d.priority, d.status, d.created_at, t.name AS team_name, i.title AS incident_title FROM dispatches d LEFT JOIN response_teams t ON t.id = d.team_id LEFT JOIN incidents i ON i.id = d.incident_id ORDER BY d.created_at DESC LIMIT 30");
    return res.json({ dispatches: rows });
  }
  if (req.method === "PATCH") {
    const id = String(req.body?.id || "").trim();
    const status = String(req.body?.status || "").trim().toUpperCase();
    if (!id || !["PENDING","ACTIVE","EN ROUTE","COMPLETED"].includes(status)) return res.status(400).json({ error: "Invalid dispatch update." });
    const { rows } = await db.query("UPDATE dispatches SET status = $1 WHERE id = $2 RETURNING id, mission, destination, priority, status", [status, id]);
    if (!rows.length) return res.status(404).json({ error: "Dispatch not found." });
    return res.json({ dispatch: rows[0] });
  }
  const mission = String(req.body?.mission || "").trim();
  const destination = String(req.body?.destination || "").trim();
  const priority = String(req.body?.priority || "NORMAL").trim().toUpperCase();
  const teamId = req.body?.teamId ? String(req.body.teamId) : null;
  const incidentId = req.body?.incidentId ? String(req.body.incidentId) : null;
  if (!mission || !destination) return res.status(400).json({ error: "Mission and destination are required." });
  if (!["LOW","NORMAL","HIGH","CRITICAL"].includes(priority)) return res.status(400).json({ error: "Invalid priority." });
  const { rows } = await db.query("INSERT INTO dispatches (incident_id, team_id, mission, destination, priority, status, created_by) VALUES ($1, $2, $3, $4, $5, 'PENDING', $6) RETURNING id, mission, destination, priority, status, created_at", [incidentId, teamId, mission, destination, priority, req.user.id]);
  await db.query("INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)", [req.user.id, "CREATE", "dispatch", rows[0].id, mission]);
  res.status(201).json({ dispatch: rows[0] });
}