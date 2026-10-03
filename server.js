require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { timingSafeEqual } = require("crypto");

const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, expected] = parts;
  try {
    const actual = crypto.scryptSync(password, salt, 64, { N:Number(n), r:Number(r), p:Number(p), maxmem:64*1024*1024 }).toString("base64");
    const a = Buffer.from(actual), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a,b);
  } catch { return false; }
}
async function audit(userId, action, entity, entityId, details) {
  await pool.query("INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES($1,$2,$3,$4,$5)", [userId,action,entity,entityId,details]);
}
function cookieToken(req) {
  const raw = req.headers.cookie || "";
  const m = raw.match(/(?:^|; )sentinel_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
async function currentUser(req) {
  const token = cookieToken(req);
  if (!token) return null;
  const { rows } = await pool.query(
    "SELECT u.id,u.email,u.name FROM sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()",
    [hash(token)]
  );
  return rows[0] || null;
}
function requireAuth(handler) {
  return async (req,res,next) => {
    try {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error:"Authentication required." });
      req.user = user;
      await handler(req,res);
    } catch (e) { next(e); }
  };
}

app.get("/login", (req,res) => res.sendFile(path.join(__dirname,"public","login.html")));
app.get("/api/me", async (req,res,next) => { try {
  const user = await currentUser(req);
  res.json({ signedIn:!!user, user:user ? {id:user.id,email:user.email,name:user.name} : null });
} catch(e){next(e);} });

app.post("/api/login", async (req,res,next) => { try {
  const email=String(req.body.email||"").trim().toLowerCase();
  const password=String(req.body.password||"");
  if(!email||!password) return res.status(400).json({error:"Email and password are required."});
  const {rows}=await pool.query("SELECT id,email,name,password_hash FROM app_users WHERE email=$1",[email]);
  if(!rows.length || !verifyPassword(password, rows[0].password_hash)) return res.status(401).json({error:"Invalid email or password."});
  const token=crypto.randomBytes(32).toString("hex");
  const days=Number(process.env.SESSION_DAYS||7);
  await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+($3 || ' days')::interval)",[rows[0].id,hash(token),String(days)]);
  res.setHeader("Set-Cookie",`sentinel_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days*86400}`);
  await audit(rows[0].id,'LOGIN','session',null,'Successful command-center login');
  res.json({ok:true,user:{id:rows[0].id,email:rows[0].email,name:rows[0].name}});
} catch(e){next(e);} });

app.post("/api/logout", async (req,res,next)=>{try{
  const token=cookieToken(req); if(token) await pool.query("DELETE FROM sessions WHERE token_hash=$1",[hash(token)]);
  res.setHeader("Set-Cookie","sentinel_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax");
  res.json({ok:true});
}catch(e){next(e);}});

app.get("/api/dashboard",requireAuth(async(req,res)=>{
  const [a,c,s,t,d]=await Promise.all([
    pool.query("SELECT COUNT(*)::int count FROM incidents WHERE status='ACTIVE'"),
    pool.query("SELECT COUNT(*)::int count FROM incidents WHERE status='ACTIVE' AND severity='CRITICAL'"),
    pool.query("SELECT COUNT(*)::int count FROM sensors WHERE status='ONLINE'"),
    pool.query("SELECT COUNT(*)::int count FROM response_teams WHERE status IN ('AVAILABLE','DEPLOYED','EN ROUTE')"),
    pool.query("SELECT COUNT(*)::int count FROM dispatches WHERE status IN ('PENDING','ACTIVE','EN ROUTE')")
  ]);
  res.json({active_incidents:a.rows[0].count,critical_incidents:c.rows[0].count,sensors_online:s.rows[0].count,response_teams:t.rows[0].count,active_dispatches:d.rows[0].count});
}));

app.get("/api/incidents",requireAuth(async(req,res)=>{
  const {rows}=await pool.query("SELECT id,title,location,severity,status,created_at FROM incidents ORDER BY created_at DESC LIMIT 50"); res.json({incidents:rows});
}));
app.post("/api/incidents",requireAuth(async(req,res)=>{
  const title=String(req.body.title||"").trim(), location=String(req.body.location||"").trim(), severity=String(req.body.severity||"WARNING").toUpperCase();
  if(!title||!location||!["CRITICAL","WARNING","INFO"].includes(severity)) return res.status(400).json({error:"Valid incident name, location and severity are required."});
  const {rows}=await pool.query("INSERT INTO incidents(title,location,severity,status,created_by) VALUES($1,$2,$3,'ACTIVE',$4) RETURNING id,title,location,severity,status,created_at",[title,location,severity,req.user.id]);
  await audit(req.user.id,'CREATE','incident',rows[0].id,title);
  res.status(201).json({incident:rows[0]});
}));
app.patch("/api/incidents",requireAuth(async(req,res)=>{
  const id=String(req.body.id||""),status=String(req.body.status||"").toUpperCase();
  if(!id||!["ACTIVE","RESOLVED"].includes(status)) return res.status(400).json({error:"Invalid incident update."});
  const {rows}=await pool.query("UPDATE incidents SET status=$1 WHERE id=$2 RETURNING id,title,location,severity,status,created_at",[status,id]);
  if(!rows.length) return res.status(404).json({error:"Incident not found."});
  await audit(req.user.id,'UPDATE','incident',id,status);
  res.json({incident:rows[0]});
}));

app.get("/api/sensors",requireAuth(async(req,res)=>{const {rows}=await pool.query("SELECT id,name,category,value,unit,status,location,battery,updated_at FROM sensors ORDER BY category,name");res.json({sensors:rows});}));
app.patch("/api/sensors",requireAuth(async(req,res)=>{
  const id=String(req.body.id||""), value=String(req.body.value??"").trim(), status=String(req.body.status||"ONLINE").toUpperCase();
  if(!id || value==="" || !["ONLINE","OFFLINE","MAINTENANCE"].includes(status)) return res.status(400).json({error:"Valid sensor id, value and status are required."});
  const {rows}=await pool.query("UPDATE sensors SET value=$1,status=$2,updated_at=NOW() WHERE id=$3 RETURNING id,name,category,value,unit,status,location,battery,updated_at",[value,status,id]);
  if(!rows.length) return res.status(404).json({error:"Sensor not found."});
  await audit(req.user.id,'UPDATE','sensor',id,rows[0].name+" → "+value+" "+rows[0].unit);
  res.json({sensor:rows[0]});
}));
app.get("/api/teams",requireAuth(async(req,res)=>{const {rows}=await pool.query("SELECT id,name,specialty,location,status,members,updated_at FROM response_teams ORDER BY name");res.json({teams:rows});}));
app.patch("/api/teams",requireAuth(async(req,res)=>{
  const id=String(req.body.id||""), status=String(req.body.status||"").toUpperCase();
  if(!id || !["AVAILABLE","DEPLOYED","EN ROUTE","OFFLINE"].includes(status)) return res.status(400).json({error:"Invalid team status."});
  const {rows}=await pool.query("UPDATE response_teams SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING id,name,specialty,location,status,members,updated_at",[status,id]);
  if(!rows.length) return res.status(404).json({error:"Response team not found."});
  await audit(req.user.id,'UPDATE','team',id,rows[0].name+" → "+status);
  res.json({team:rows[0]});
}));
app.get("/api/dispatches",requireAuth(async(req,res)=>{const {rows}=await pool.query("SELECT d.id,d.mission,d.destination,d.priority,d.status,d.created_at,t.name team_name,i.title incident_title FROM dispatches d LEFT JOIN response_teams t ON t.id=d.team_id LEFT JOIN incidents i ON i.id=d.incident_id ORDER BY d.created_at DESC LIMIT 30");res.json({dispatches:rows});}));
app.post("/api/dispatches",requireAuth(async(req,res)=>{
  const mission=String(req.body.mission||"").trim(),destination=String(req.body.destination||"").trim(),priority=String(req.body.priority||"NORMAL").toUpperCase(),teamId=req.body.teamId?String(req.body.teamId):null,incidentId=req.body.incidentId?String(req.body.incidentId):null;
  if(!mission||!destination||!["LOW","NORMAL","HIGH","CRITICAL"].includes(priority)) return res.status(400).json({error:"Valid mission, destination and priority are required."});
  const {rows}=await pool.query("INSERT INTO dispatches(incident_id,team_id,mission,destination,priority,status,created_by) VALUES($1,$2,$3,$4,$5,'PENDING',$6) RETURNING id,mission,destination,priority,status,created_at",[incidentId,teamId,mission,destination,priority,req.user.id]);
  await audit(req.user.id,'CREATE','dispatch',rows[0].id,mission);
  res.status(201).json({dispatch:rows[0]});
}));
app.patch("/api/dispatches",requireAuth(async(req,res)=>{
  const id=String(req.body.id||""),status=String(req.body.status||"").toUpperCase();
  if(!id||!["PENDING","ACTIVE","EN ROUTE","COMPLETED"].includes(status)) return res.status(400).json({error:"Invalid dispatch update."});
  const {rows}=await pool.query("UPDATE dispatches SET status=$1 WHERE id=$2 RETURNING id,mission,destination,priority,status,team_id",[status,id]);
  if(!rows.length)return res.status(404).json({error:"Dispatch not found."});
  if(rows[0].team_id) {
    const teamStatus = status === "COMPLETED" ? "AVAILABLE" : status === "PENDING" ? "AVAILABLE" : "EN ROUTE";
    await pool.query("UPDATE response_teams SET status=$1,updated_at=NOW() WHERE id=$2",[teamStatus,rows[0].team_id]);
  }
  await audit(req.user.id,'UPDATE','dispatch',id,status);
  res.json({dispatch:rows[0]});
}));
app.get("/api/reports",requireAuth(async(req,res)=>{
  const [week,avg,located,util]=await Promise.all([
    pool.query("SELECT COUNT(*)::int count FROM incidents WHERE created_at >= NOW()-INTERVAL '7 days'"),
    pool.query("SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (d.created_at-i.created_at))/60)::numeric,1),0) value FROM dispatches d JOIN incidents i ON i.id=d.incident_id WHERE d.created_at >= NOW()-INTERVAL '30 days'"),
    pool.query("SELECT COUNT(*)::int count FROM dispatches WHERE status='COMPLETED'"),
    pool.query("SELECT CASE WHEN COUNT(*)=0 THEN 0 ELSE ROUND((COUNT(*) FILTER (WHERE status <> 'AVAILABLE')::numeric/COUNT(*)::numeric)*100) END value FROM response_teams")
  ]);
  res.json({incidents_week:week.rows[0].count,avg_response_minutes:Number(avg.rows[0].value||0),missions_completed:located.rows[0].count,resource_utilization:Number(util.rows[0].value||0)});
}));
app.get("/api/health",async(req,res)=>{try{await pool.query("SELECT 1");res.json({status:"ok",database:"connected",time:new Date().toISOString()});}catch(e){res.status(503).json({status:"degraded",database:"unavailable"});}});
app.get("/api/activity",requireAuth(async(req,res)=>{const {rows}=await pool.query("SELECT action,entity,details,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 12");res.json({activity:rows});}));
app.get("/api/risk",requireAuth(async(req,res)=>{
  const sensors=await pool.query("SELECT category,value FROM sensors WHERE status='ONLINE'"), incidents=await pool.query("SELECT severity FROM incidents WHERE status='ACTIVE'");
  const val=c=>Number(sensors.rows.find(x=>x.category===c)?.value||0), water=val("WATER"), vibration=val("VIBRATION"), smoke=val("SMOKE"), gas=val("GAS");
  const critical=incidents.rows.filter(x=>x.severity==="CRITICAL").length,warning=incidents.rows.filter(x=>x.severity==="WARNING").length;
  const score=Math.min(100,Math.round(18+water*.42+vibration*18+smoke*.25+gas*.5+critical*12+warning*5)),level=score>=75?"HIGH":score>=50?"ELEVATED":score>=30?"MODERATE":"LOW";
  const drivers=[]; if(water>=70)drivers.push("High water-level telemetry"); if(vibration>=.6)drivers.push("Elevated vibration telemetry"); if(smoke>=40)drivers.push("Increased smoke concentration"); if(gas>=10)drivers.push("Increased gas concentration"); if(critical)drivers.push(`${critical} active critical incident${critical>1?"s":""}`); if(!drivers.length)drivers.push("No major threshold breaches detected");
  res.json({score,level,drivers,calculated_at:new Date().toISOString(),metrics:{water,vibration,smoke,gas,critical,warning}});
}));

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Server error. Check the terminal for details."});});
app.listen(port,()=>console.log(`Sentinel DM running at http://localhost:${port}`));
