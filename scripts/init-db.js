require("dotenv").config();
const fs=require("fs");
const path=require("path");
const {Client}=require("pg");

async function main(){
  if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is missing. Copy .env.example to .env and set it.");
  const client=new Client({connectionString:process.env.DATABASE_URL});
  await client.connect();
  const schema=fs.readFileSync(path.join(__dirname,"..","schema.sql"),"utf8");
  await client.query(schema);
  console.log("Database initialized or upgraded successfully.");
  await client.end();
}
main().catch(err=>{console.error(err.message);process.exit(1);});
