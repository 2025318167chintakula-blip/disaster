import { db } from "hatchable";

export const access = "user";
export const methods = ["GET"];

export default async function (req, res) {
  const sensors = await db.query("SELECT category, value FROM sensors WHERE status = 'ONLINE'");
  const incidents = await db.query("SELECT severity FROM incidents WHERE status = 'ACTIVE'");
  const water = Number(sensors.rows.find(x => x.category === "WATER")?.value || 0);
  const vibration = Number(sensors.rows.find(x => x.category === "VIBRATION")?.value || 0);
  const smoke = Number(sensors.rows.find(x => x.category === "SMOKE")?.value || 0);
  const gas = Number(sensors.rows.find(x => x.category === "GAS")?.value || 0);
  const critical = incidents.rows.filter(x => x.severity === "CRITICAL").length;
  const warning = incidents.rows.filter(x => x.severity === "WARNING").length;
  const score = Math.min(100, Math.round(18 + water * 0.42 + vibration * 18 + smoke * 0.25 + gas * 0.5 + critical * 12 + warning * 5));
  const level = score >= 75 ? "HIGH" : score >= 50 ? "ELEVATED" : score >= 30 ? "MODERATE" : "LOW";
  const drivers = [];
  if (water >= 70) drivers.push("High water-level telemetry");
  if (vibration >= 0.6) drivers.push("Elevated vibration telemetry");
  if (smoke >= 40) drivers.push("Increased smoke concentration");
  if (gas >= 10) drivers.push("Increased gas concentration");
  if (critical > 0) drivers.push(critical + " active critical incident" + (critical > 1 ? "s" : ""));
  if (!drivers.length) drivers.push("No major threshold breaches detected");
  res.json({ score, level, drivers, calculated_at: new Date().toISOString() });
}