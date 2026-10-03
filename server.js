require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
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
  if(!rows.length || rows[0].password_hash!==password) return res.status(401).json({error:"Invalid login. Use the demo account shown on the sign-in page."});
  const token=crypto.randomBytes(32).toString("hex");
  const days=Number(process.env.SESSION_DAYS||7);
  await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+($3 || ' days')::interval)",[rows[0].id,hash(token),String(days)]);
  res.setHeader("Set-Cookie",`sentinel_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days*86400}`);
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
  await pool.query("INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES($1,'CREATE','incident',$2,$3)",[req.user.id,rows[0].id,title]);
  res.status(201).json({incident:rows[0]});
}));
app.patch("/api/incidents",requireAuth(async(req,res)=>{
  const id=String(req.body.id||""),status=String(req.body.status||"").toUpperCase();
  if(!id||!["ACTIVE","RESOLVED"].includes(status)) return res.status(400).json({error:"Invalid incident update."});
  const {rows}=await pool.query("UPDATE incidents SET status=$1 WHERE id=$2 RETURNING id,title,location,severity,status,created_at",[status,id]);
  if(!rows.length) return res.status(404).json({error:"Incident not found."});
  await pool.query("INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES($1,'UPDATE','incident',$2,$3)",[req.user.id,id,status]);
  res.json({incident:rows[0]});
}));

app.get("/api/sensors",requireAuth(async(req,res)=>{const {rows}=await pool.query("SELECT id,name,category,value,unit,status,location,battery,updated_at FROM sensors ORDER BY category,name");res.json({sensors:rows});}));
app.get("/api/teams",requireAuth(async(req,res)=>{const {rows}=await pool.query("SELECT id,name,specialty,location,status,members,updated_at FROM response_teams ORDER BY name");res.json({teams:rows});}));
app.get("/api/dispatches",requireAuth(async(req,res)=>{const {rows}=await pool.query("SELECT d.id,d.mission,d.destination,d.priority,d.status,d.created_at,t.name team_name,i.title incident_title FROM dispatches d LEFT JOIN response_teams t ON t.id=d.team_id LEFT JOIN incidents i ON i.id=d.incident_id ORDER BY d.created_at DESC LIMIT 30");res.json({dispatches:rows});}));
app.post("/api/dispatches",requireAuth(async(req,res)=>{
  const mission=String(req.body.mission||"").trim(),destination=String(req.body.destination||"").trim(),priority=String(req.body.priority||"NORMAL").toUpperCase(),teamId=req.body.teamId?String(req.body.teamId):null,incidentId=req.body.incidentId?String(req.body.incidentId):null;
  if(!mission||!destination||!["LOW","NORMAL","HIGH","CRITICAL"].includes(priority)) return res.status(400).json({error:"Valid mission, destination and priority are required."});
  const {rows}=await pool.query("INSERT INTO dispatches(incident_id,team_id,mission,destination,priority,status,created_by) VALUES($1,$2,$3,$4,$5,'PENDING',$6) RETURNING id,mission,destination,priority,status,created_at",[incidentId,teamId,mission,destination,priority,req.user.id]);
  await pool.query("INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES($1,'CREATE','dispatch',$2,$3)",[req.user.id,rows[0].id,mission]);
  res.status(201).json({dispatch:rows[0]});
}));
app.patch("/api/dispatches",requireAuth(async(req,res)=>{
  const id=String(req.body.id||""),status=String(req.body.status||"").toUpperCase();
  if(!id||!["PENDING","ACTIVE","EN ROUTE","COMPLETED"].includes(status)) return res.status(400).json({error:"Invalid dispatch update."});
  const {rows}=await pool.query("UPDATE dispatches SET status=$1 WHERE id=$2 RETURNING id,mission,destination,priority,status",[status,id]);
  if(!rows.length)return res.status(404).json({error:"Dispatch not found."}); res.json({dispatch:rows[0]});
}));
app.get("/api/activity",requireAuth(async(req,res)=>{const {rows}=await pool.query("SELECT action,entity,details,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 12");res.json({activity:rows});}));
app.get("/api/risk",requireAuth(async(req,res)=>{
  const sensors=await pool.query("SELECT category,value FROM sensors WHERE status='ONLINE'"), incidents=await pool.query("SELECT severity FROM incidents WHERE status='ACTIVE'");
  const val=c=>Number(sensors.rows.find(x=>x.category===c)?.value||0), water=val("WATER"), vibration=val("VIBRATION"), smoke=val("SMOKE"), gas=val("GAS");
  const critical=incidents.rows.filter(x=>x.severity==="CRITICAL").length,warning=incidents.rows.filter(x=>x.severity==="WARNING").length;
  const score=Math.min(100,Math.round(18+water*.42+vibration*18+smoke*.25+gas*.5+critical*12+warning*5)),level=score>=75?"HIGH":score>=50?"ELEVATED":score>=30?"MODERATE":"LOW";
  const drivers=[]; if(water>=70)drivers.push("High water-level telemetry"); if(vibration>=.6)drivers.push("Elevated vibration telemetry"); if(smoke>=40)drivers.push("Increased smoke concentration"); if(gas>=10)drivers.push("Increased gas concentration"); if(critical)drivers.push(`${critical} active critical incident${critical>1?"s":""}`); if(!drivers.length)drivers.push("No major threshold breaches detected");
  res.json({score,level,drivers,calculated_at:new Date().toISOString()});
}));

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Server error. Check the terminal for details."});});
app.listen(port,()=>console.log(`Sentinel DM running at http://localhost:${port}`));
