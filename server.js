require("dotenv").config();
const express=require("express");
const path=require("path");
const crypto=require("crypto");
const {Pool}=require("pg");
const {timingSafeEqual}=crypto;

const app=express();
const port=Number(process.env.PORT||3000);
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const DISASTER_TYPES=["Flood","Earthquake","Cyclone","Fire","Landslide","Tsunami","Heatwave","Drought","Industrial Accident","Gas Leak","Chemical Hazard","Building Collapse","Other"];
const SEVERITIES=["CRITICAL","WARNING","INFO"];
const INCIDENT_STATUSES=["ACTIVE","UNDER RESPONSE","RESOLVED"];
const TEAM_STATUSES=["AVAILABLE","DEPLOYED","EN ROUTE","OFFLINE"];
const DISPATCH_STATUSES=["PENDING","ACTIVE","EN ROUTE","COMPLETED"];
const PRIORITIES=["LOW","NORMAL","HIGH","CRITICAL"];

app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(__dirname));

function hash(v){return crypto.createHash("sha256").update(v).digest("hex");}
function verifyPassword(password,stored){
  const parts=String(stored||"").split("$");
  if(parts.length!==6||parts[0]!=="scrypt")return false;
  const [,n,r,p,salt,expected]=parts;
  try{
    const actual=crypto.scryptSync(password,salt,64,{N:Number(n),r:Number(r),p:Number(p),maxmem:64*1024*1024}).toString("base64");
    const a=Buffer.from(actual),b=Buffer.from(expected);
    return a.length===b.length&&timingSafeEqual(a,b);
  }catch{return false;}
}
function cookieToken(req){
  const raw=req.headers.cookie||"";
  const m=raw.match(/(?:^|; )sentinel_session=([^;]+)/);
  return m?decodeURIComponent(m[1]):null;
}
async function currentUser(req){
  const token=cookieToken(req);
  if(!token)return null;
  const {rows}=await pool.query("SELECT u.id,u.email,u.name,u.role FROM sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()",[hash(token)]);
  return rows[0]||null;
}
function requireAuth(handler){
  return async(req,res,next)=>{
    try{
      const user=await currentUser(req);
      if(!user)return res.status(401).json({error:"Authentication required."});
      req.user=user;
      await handler(req,res);
    }catch(e){next(e);}
  };
}
function requireRole(...roles){
  return handler=>requireAuth(async(req,res)=>{
    if(!roles.includes(req.user.role))return res.status(403).json({error:"You do not have permission for this operation."});
    await handler(req,res);
  });
}
async function audit(userId,action,entity,entityId,details){
  await pool.query("INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES($1,$2,$3,$4,$5)",[userId,action,entity,entityId,details]);
}
async function notifyAll(type,title,message){
  await pool.query("INSERT INTO notifications(user_id,type,title,message) SELECT id,$1,$2,$3 FROM app_users",[type,title,message]);
}
function numeric(v,fallback=0){const n=Number(v);return Number.isFinite(n)?n:fallback;}
function clean(v,max=500){return String(v??"").trim().slice(0,max);}
function validEnum(v,list){return list.includes(String(v||"").toUpperCase());}

app.get("/",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.get("/login",(req,res)=>res.sendFile(path.join(__dirname,"login.html")));

app.get("/api/me",async(req,res,next)=>{try{const user=await currentUser(req);res.json({signedIn:!!user,user:user?{id:user.id,email:user.email,name:user.name,role:user.role}:null});}catch(e){next(e);}});

app.post("/api/login",async(req,res,next)=>{
  try{
    const email=clean(req.body.email,200).toLowerCase(),password=String(req.body.password||"");
    if(!email||!password)return res.status(400).json({error:"Email and password are required."});
    const {rows}=await pool.query("SELECT id,email,name,password_hash,role FROM app_users WHERE email=$1",[email]);
    if(!rows.length||!verifyPassword(password,rows[0].password_hash))return res.status(401).json({error:"Invalid email or password."});
    const token=crypto.randomBytes(32).toString("hex"),days=Math.max(1,Number(process.env.SESSION_DAYS||7));
    await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+($3 || ' days')::interval)",[rows[0].id,hash(token),String(days)]);
    const secure=process.env.NODE_ENV==="production"?" Secure;":"";
    res.setHeader("Set-Cookie",`sentinel_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days*86400};${secure}`);
    await audit(rows[0].id,"LOGIN","session",null,"Successful command-center login");
    res.json({ok:true,user:{id:rows[0].id,email:rows[0].email,name:rows[0].name,role:rows[0].role}});
  }catch(e){next(e);}
});
app.post("/api/logout",async(req,res,next)=>{try{const token=cookieToken(req);if(token)await pool.query("DELETE FROM sessions WHERE token_hash=$1",[hash(token)]);res.setHeader("Set-Cookie","sentinel_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");res.json({ok:true});}catch(e){next(e);}});

app.get("/api/dashboard",requireAuth(async(req,res)=>{
  const [a,c,s,t,d,alerts]=await Promise.all([
    pool.query("SELECT COUNT(*)::int count FROM incidents WHERE status<>'RESOLVED'"),
    pool.query("SELECT COUNT(*)::int count FROM incidents WHERE status<>'RESOLVED' AND severity='CRITICAL'"),
    pool.query("SELECT COUNT(*)::int count FROM sensors WHERE status='ONLINE'"),
    pool.query("SELECT COUNT(*)::int count FROM response_teams WHERE status='AVAILABLE'"),
    pool.query("SELECT COUNT(*)::int count FROM dispatches WHERE status IN ('PENDING','ACTIVE','EN ROUTE')"),
    pool.query("SELECT COUNT(*)::int count FROM alerts WHERE status='ACTIVE' AND (expires_at IS NULL OR expires_at>NOW())")
  ]);
  const risk=await calculateRisk(false);
  res.json({active_incidents:a.rows[0].count,critical_incidents:c.rows[0].count,sensors_online:s.rows[0].count,available_teams:t.rows[0].count,active_dispatches:d.rows[0].count,active_alerts:alerts.rows[0].count,risk});
}));

app.get("/api/incidents",requireAuth(async(req,res)=>{
  const {rows}=await pool.query(`SELECT i.*,t.name assigned_team_name FROM incidents i LEFT JOIN response_teams t ON t.id=i.assigned_team ORDER BY i.created_at DESC LIMIT 100`);
  res.json({incidents:rows});
}));
app.get("/api/incidents/:id",requireAuth(async(req,res)=>{
  const {rows}=await pool.query(`SELECT i.*,t.name assigned_team_name FROM incidents i LEFT JOIN response_teams t ON t.id=i.assigned_team WHERE i.id=$1`,[req.params.id]);
  if(!rows.length)return res.status(404).json({error:"Incident not found."});
  const auditRows=await pool.query("SELECT action,details,created_at FROM audit_logs WHERE entity='incident' AND entity_id=$1 ORDER BY created_at",[req.params.id]);
  res.json({incident:rows[0],timeline:auditRows.rows});
}));
app.post("/api/incidents",requireRole("ADMIN","OPERATOR")(async(req,res)=>{
  const title=clean(req.body.title),location=clean(req.body.location),type=DISASTER_TYPES.includes(req.body.disaster_type)?req.body.disaster_type:"Other";
  const severity=String(req.body.severity||"WARNING").toUpperCase();
  if(!title||!location||!SEVERITIES.includes(severity))return res.status(400).json({error:"Valid title, location and severity are required."});
  const {rows}=await pool.query(`INSERT INTO incidents(title,disaster_type,location,description,severity,status,latitude,longitude,created_by,reporter,assigned_team) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$8,$9,$10) RETURNING *`,
    [title,type,location,clean(req.body.description,2000),severity,numeric(req.body.latitude,null),numeric(req.body.longitude,null),req.user.id,req.user.name,req.body.assigned_team||null]);
  await audit(req.user.id,"CREATE","incident",rows[0].id,`${type}: ${title}`);
  if(severity==="CRITICAL")await notifyAll("INCIDENT","Critical incident created",`${title} at ${location}`);
  res.status(201).json({incident:rows[0]});
}));
app.patch("/api/incidents",requireRole("ADMIN","OPERATOR","RESPONDER")(async(req,res)=>{
  const id=clean(req.body.id,80),status=String(req.body.status||"").toUpperCase();
  if(!id||!INCIDENT_STATUSES.includes(status))return res.status(400).json({error:"Invalid incident status."});
  const assigned=req.body.assigned_team||null;
  const {rows}=await pool.query(`UPDATE incidents SET status=$1,assigned_team=COALESCE($2,assigned_team),updated_at=NOW() WHERE id=$3 RETURNING *`,[status,assigned,id]);
  if(!rows.length)return res.status(404).json({error:"Incident not found."});
  await audit(req.user.id,"UPDATE","incident",id,status+(assigned?" · team assigned":""));
  if(status==="UNDER RESPONSE"&&rows[0].assigned_team)await pool.query("UPDATE response_teams SET status='DEPLOYED',updated_at=NOW() WHERE id=$1",[rows[0].assigned_team]);
  if(status==="RESOLVED")await notifyAll("INCIDENT","Incident resolved",rows[0].title);
  res.json({incident:rows[0]});
}));

app.get("/api/sensors",requireAuth(async(req,res)=>{
  const {rows}=await pool.query("SELECT * FROM sensors ORDER BY category,name");
  res.json({sensors:rows.map(s=>({...s,value:numeric(s.value),threshold_status:s.status!=='ONLINE'?'OFFLINE':numeric(s.value)>=numeric(s.threshold_critical,Infinity)?'CRITICAL':numeric(s.value)>=numeric(s.threshold_warning,Infinity)?'WARNING':'NORMAL'}))});
}));
app.patch("/api/sensors",requireRole("ADMIN","OPERATOR")(async(req,res)=>{
  const id=clean(req.body.id,80),value=numeric(req.body.value,NaN),status=String(req.body.status||"ONLINE").toUpperCase();
  if(!id||!Number.isFinite(value)||!["ONLINE","OFFLINE","MAINTENANCE"].includes(status))return res.status(400).json({error:"Valid sensor id, numeric value and status are required."});
  const {rows}=await pool.query("UPDATE sensors SET value=$1,status=$2,updated_at=NOW() WHERE id=$3 RETURNING *",[String(value),status,id]);
  if(!rows.length)return res.status(404).json({error:"Sensor not found."});
  await audit(req.user.id,"UPDATE","sensor",id,`${rows[0].name} → ${value} ${rows[0].unit}`);
  if(numeric(rows[0].threshold_critical,Infinity)<=value)await notifyAll("SENSOR","Critical sensor threshold",`${rows[0].name} has reached a critical value.`);
  res.json({sensor:rows[0]});
}));

app.get("/api/teams",requireAuth(async(req,res)=>{const {rows}=await pool.query("SELECT * FROM response_teams ORDER BY name");res.json({teams:rows});}));
app.patch("/api/teams",requireRole("ADMIN","OPERATOR","RESPONDER")(async(req,res)=>{
  const id=clean(req.body.id,80),status=String(req.body.status||"").toUpperCase();
  if(!id||!TEAM_STATUSES.includes(status))return res.status(400).json({error:"Invalid team status."});
  const {rows}=await pool.query("UPDATE response_teams SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *",[status,id]);
  if(!rows.length)return res.status(404).json({error:"Response team not found."});
  await audit(req.user.id,"UPDATE","team",id,`${rows[0].name} → ${status}`);
  await notifyAll("TEAM","Response team updated",`${rows[0].name} is now ${status}.`);
  res.json({team:rows[0]});
}));

app.get("/api/dispatches",requireAuth(async(req,res)=>{
  const {rows}=await pool.query(`SELECT d.*,t.name team_name,i.title incident_title FROM dispatches d LEFT JOIN response_teams t ON t.id=d.team_id LEFT JOIN incidents i ON i.id=d.incident_id ORDER BY d.created_at DESC LIMIT 100`);
  res.json({dispatches:rows});
}));
app.post("/api/dispatches",requireRole("ADMIN","OPERATOR")(async(req,res)=>{
  const mission=clean(req.body.mission),destination=clean(req.body.destination),priority=String(req.body.priority||"NORMAL").toUpperCase();
  const teamId=req.body.teamId?clean(req.body.teamId,80):null,incidentId=req.body.incidentId?clean(req.body.incidentId,80):null;
  if(!mission||!destination||!PRIORITIES.includes(priority))return res.status(400).json({error:"Valid mission, destination and priority are required."});
  if(teamId){const team=await pool.query("SELECT status FROM response_teams WHERE id=$1",[teamId]);if(!team.rows.length)return res.status(404).json({error:"Response team not found."});}
  const {rows}=await pool.query(`INSERT INTO dispatches(incident_id,team_id,mission,destination,priority,status,created_by,started_at) VALUES($1,$2,$3,$4,$5,'PENDING',$6,NULL) RETURNING *`,[incidentId,teamId,mission,destination,priority,req.user.id]);
  if(teamId)await pool.query("UPDATE response_teams SET status='EN ROUTE',current_mission=$1,updated_at=NOW() WHERE id=$2",[mission,teamId]);
  if(incidentId)await pool.query("UPDATE incidents SET status='UNDER RESPONSE',assigned_team=$1,updated_at=NOW() WHERE id=$2",[teamId,incidentId]);
  await audit(req.user.id,"CREATE","dispatch",rows[0].id,mission);
  await notifyAll("DISPATCH","New response mission",mission);
  res.status(201).json({dispatch:rows[0]});
}));
app.patch("/api/dispatches",requireRole("ADMIN","OPERATOR","RESPONDER")(async(req,res)=>{
  const id=clean(req.body.id,80),status=String(req.body.status||"").toUpperCase();
  if(!id||!DISPATCH_STATUSES.includes(status))return res.status(400).json({error:"Invalid dispatch status."});
  const {rows}=await pool.query("SELECT * FROM dispatches WHERE id=$1",[id]);
  if(!rows.length)return res.status(404).json({error:"Dispatch not found."});
  const d=rows[0];
  const started=status==="ACTIVE"||status==="EN ROUTE"?d.started_at||new Date():d.started_at;
  const completed=status==="COMPLETED"?new Date():null;
  const updated=await pool.query("UPDATE dispatches SET status=$1,started_at=$2,completed_at=$3,updated_at=NOW() WHERE id=$4 RETURNING *",[status,started,completed,id]);
  if(d.team_id){
    const teamStatus=status==="COMPLETED"?"AVAILABLE":status==="ACTIVE"||status==="EN ROUTE"?"EN ROUTE":"EN ROUTE";
    await pool.query("UPDATE response_teams SET status=$1,current_mission=$2,updated_at=NOW() WHERE id=$3",[teamStatus,status==="COMPLETED"?null:d.mission,d.team_id]);
  }
  if(status==="COMPLETED"&&d.incident_id)await pool.query("UPDATE incidents SET status='RESOLVED',updated_at=NOW() WHERE id=$1",[d.incident_id]);
  await audit(req.user.id,"UPDATE","dispatch",id,status);
  await notifyAll("DISPATCH","Mission status changed",`${d.mission} → ${status}`);
  res.json({dispatch:updated.rows[0]});
}));

async function calculateRisk(record=true){
  const sensors=await pool.query("SELECT category,value FROM sensors WHERE status='ONLINE'");
  const incidents=await pool.query("SELECT severity FROM incidents WHERE status<>'RESOLVED'");
  const val=c=>numeric(sensors.rows.find(x=>x.category===c)?.value);
  const water=val("WATER"),vibration=val("VIBRATION"),smoke=val("SMOKE"),gas=val("GAS");
  const critical=incidents.rows.filter(x=>x.severity==="CRITICAL").length,warning=incidents.rows.filter(x=>x.severity==="WARNING").length;
  const score=Math.min(100,Math.round(18+water*.42+vibration*18+smoke*.25+gas*.5+critical*12+warning*5));
  const level=score>=75?"HIGH":score>=50?"ELEVATED":score>=30?"MODERATE":"LOW";
  const drivers=[];
  if(water>=70)drivers.push("High water level");
  if(vibration>=.6)drivers.push("Elevated vibration");
  if(smoke>=40)drivers.push("Smoke concentration");
  if(gas>=10)drivers.push("Gas concentration");
  if(critical)drivers.push(`${critical} critical incident${critical>1?"s":""}`);
  if(!drivers.length)drivers.push("No major threshold breaches detected");
  const result={score,level,drivers,calculated_at:new Date().toISOString(),metrics:{water,vibration,smoke,gas,critical,warning}};
  if(record)await pool.query("INSERT INTO risk_history(score,level,drivers) VALUES($1,$2,$3)",[score,level,drivers.join(" · ")]);
  return result;
}
app.get("/api/risk",requireAuth(async(req,res)=>res.json(await calculateRisk(true))));
app.get("/api/risk/history",requireAuth(async(req,res)=>{const {rows}=await pool.query("SELECT score,level,drivers,created_at FROM risk_history ORDER BY created_at DESC LIMIT 50");res.json({history:rows});}));

app.get("/api/reports",requireAuth(async(req,res)=>{
  const from=clean(req.query.from,30),to=clean(req.query.to,30);
  const where=from?"WHERE created_at >= $1 AND created_at < COALESCE($2::timestamptz,NOW())":"WHERE created_at >= NOW()-INTERVAL '30 days'";
  const params=from?[from,to||null]:[];
  const [week,avg,completed,util,byType,bySeverity,overTime,teamUtil,sensorStatus]=await Promise.all([
    pool.query("SELECT COUNT(*)::int count FROM incidents WHERE created_at>=NOW()-INTERVAL '7 days'"),
    pool.query("SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (d.started_at-i.created_at))/60)::numeric,1),0) value FROM dispatches d JOIN incidents i ON i.id=d.incident_id WHERE d.started_at IS NOT NULL AND d.created_at>=NOW()-INTERVAL '30 days'"),
    pool.query("SELECT COUNT(*)::int count FROM dispatches WHERE status='COMPLETED'"),
    pool.query("SELECT CASE WHEN COUNT(*)=0 THEN 0 ELSE ROUND((COUNT(*) FILTER(WHERE status<>'AVAILABLE')::numeric/COUNT(*)::numeric)*100) END value FROM response_teams"),
    pool.query(`SELECT disaster_type name,COUNT(*)::int value FROM incidents ${where} GROUP BY disaster_type ORDER BY value DESC`,params),
    pool.query(`SELECT severity name,COUNT(*)::int value FROM incidents ${where} GROUP BY severity ORDER BY value DESC`,params),
    pool.query("SELECT TO_CHAR(DATE_TRUNC('day',created_at),'DD Mon') label,COUNT(*)::int value FROM incidents WHERE created_at>=NOW()-INTERVAL '30 days' GROUP BY 1 ORDER BY MIN(created_at)"),
    pool.query("SELECT status name,COUNT(*)::int value FROM response_teams GROUP BY status ORDER BY value DESC"),
    pool.query("SELECT status name,COUNT(*)::int value FROM sensors GROUP BY status ORDER BY value DESC")
  ]);
  res.json({incidents_week:week.rows[0].count,avg_response_minutes:Number(avg.rows[0].value||0),missions_completed:completed.rows[0].count,resource_utilization:Number(util.rows[0].value||0),by_type:byType.rows,by_severity:bySeverity.rows,over_time:overTime.rows,team_utilization:teamUtil.rows,sensor_status:sensorStatus.rows});
}));

app.get("/api/activity",requireAuth(async(req,res)=>{const {rows}=await pool.query("SELECT action,entity,details,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 30");res.json({activity:rows});}));
app.get("/api/audit",requireRole("ADMIN","OPERATOR")(async(req,res)=>{const {rows}=await pool.query("SELECT a.*,u.name user_name,u.email FROM audit_logs a LEFT JOIN app_users u ON u.id::text=a.user_id ORDER BY a.created_at DESC LIMIT 100");res.json({audit:rows});}));

app.get("/api/alerts",requireAuth(async(req,res)=>{const {rows}=await pool.query("SELECT * FROM alerts WHERE status='ACTIVE' AND (expires_at IS NULL OR expires_at>NOW()) ORDER BY created_at DESC LIMIT 30");res.json({alerts:rows});}));
app.post("/api/alerts",requireRole("ADMIN","OPERATOR")(async(req,res)=>{
  const severity=String(req.body.severity||"WARNING").toUpperCase();
  if(!["CRITICAL","WARNING","INFORMATION"].includes(severity))return res.status(400).json({error:"Invalid alert severity."});
  const {rows}=await pool.query("INSERT INTO alerts(title,disaster_type,severity,location,message,recommended_action,expires_at,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8) RETURNING *",
    [clean(req.body.title),clean(req.body.disaster_type,80)||"General",severity,clean(req.body.location),clean(req.body.message,2000),clean(req.body.recommended_action,1000),req.body.expires_at||null,req.user.id]);
  await audit(req.user.id,"CREATE","alert",rows[0].id,rows[0].title);
  await notifyAll("ALERT","Emergency alert issued",rows[0].title);
  res.status(201).json({alert:rows[0]});
}));
app.patch("/api/alerts/:id",requireRole("ADMIN","OPERATOR")(async(req,res)=>{const status=String(req.body.status||"").toUpperCase();if(!["ACTIVE","EXPIRED","DISMISSED"].includes(status))return res.status(400).json({error:"Invalid alert status."});const {rows}=await pool.query("UPDATE alerts SET status=$1 WHERE id=$2 RETURNING *",[status,req.params.id]);if(!rows.length)return res.status(404).json({error:"Alert not found."});await audit(req.user.id,"UPDATE","alert",req.params.id,status);res.json({alert:rows[0]});}));

app.get("/api/notifications",requireAuth(async(req,res)=>{
  const {rows}=await pool.query("SELECT id,type,title,message,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30",[req.user.id]);
  res.json({notifications:rows,unread:rows.filter(x=>!x.read_at).length});
}));
app.patch("/api/notifications/:id/read",requireAuth(async(req,res)=>{const {rows}=await pool.query("UPDATE notifications SET read_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING id",[req.params.id,req.user.id]);if(!rows.length)return res.status(404).json({error:"Notification not found."});res.json({ok:true});}));

app.get("/api/map",requireAuth(async(req,res)=>{
  const [i,t,s,e]=await Promise.all([
    pool.query("SELECT id,title,disaster_type,severity,status,location,latitude,longitude FROM incidents WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND status<>'RESOLVED'"),
    pool.query("SELECT id,name,specialty,status,location,latitude,longitude FROM response_teams WHERE latitude IS NOT NULL AND longitude IS NOT NULL"),
    pool.query("SELECT id,name,category,status,location,latitude,longitude,value,unit FROM sensors WHERE latitude IS NOT NULL AND longitude IS NOT NULL"),
    pool.query("SELECT id,name,service_type,phone,location,latitude,longitude FROM emergency_services WHERE latitude IS NOT NULL AND longitude IS NOT NULL")
  ]);
  res.json({incidents:i.rows,teams:t.rows,sensors:s.rows,emergency_services:e.rows});
}));
app.get("/api/emergency-services",requireAuth(async(req,res)=>{const {rows}=await pool.query("SELECT * FROM emergency_services ORDER BY service_type,name");res.json({services:rows});}));
app.get("/api/preparedness",async(req,res,next)=>{try{const {rows}=await pool.query("SELECT * FROM preparedness_guides ORDER BY disaster_type");res.json({guides:rows});}catch(e){next(e);}});

app.get("/api/health",async(req,res)=>{try{await pool.query("SELECT 1");res.json({status:"ok",database:"connected",time:new Date().toISOString(),version:"2.0.0"});}catch(e){res.status(503).json({status:"degraded",database:"unavailable"});}});

app.use((req,res,next)=>{if(req.path.startsWith("/api/"))return res.status(404).json({error:"API endpoint not found."});res.status(404).sendFile(path.join(__dirname,"index.html"));});
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Server error. Check the terminal for details."});});

app.listen(port,()=>console.log(`Sentinel DM v2 running at http://localhost:${port}`));
