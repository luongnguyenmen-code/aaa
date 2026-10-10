const fs=require('node:fs'),path=require('node:path');
let pool,initialization,memDb,memInit;
function createMemPool(){
  const {newDb}=require('pg-mem'),locks=new Set();
  const db=newDb();
  db.public.registerFunction({name:'hashtext',args:['text'],returns:'integer',implementation:s=>Array.from(s).reduce((h,c)=>(h*31+c.charCodeAt(0))|0,0)});
  db.public.registerFunction({name:'pg_try_advisory_lock',args:['integer','integer'],returns:'bool',impure:true,implementation:(a,b)=>{const k=a+':'+b;if(locks.has(k))return false;locks.add(k);return true;}});
  db.public.registerFunction({name:'pg_advisory_unlock',args:['integer','integer'],returns:'bool',impure:true,implementation:(a,b)=>locks.delete(a+':'+b)});
  return db.adapters.createPg();
}
async function database(){
  if(!process.env.ROLL_DATABASE_URL||process.env.ROLL_DATABASE_URL.includes('local-st25:mem')){
    if(!memDb){
      const pg=createMemPool();
      memDb=new pg.Pool();
      memInit=memDb.query(fs.readFileSync(path.join(__dirname,'roll-schema.sql'),'utf8')).catch(err=>{memInit=null;throw err;});
    }
    await memInit;
    return memDb;
  }
  const address=new URL(process.env.ROLL_DATABASE_URL);
  if(/pooler|pgbouncer/i.test(address.hostname)||address.port==='6543')throw Object.assign(Error('Roll cần kết nối PostgreSQL trực tiếp: tắt Connection pooling khi sao chép URL.'),{status:503});
  if(!pool){const {Pool}=require('pg');pool=new Pool({connectionString:process.env.ROLL_DATABASE_URL,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,query_timeout:10000});pool.on('error',()=>console.error('Roll database connection failed'));}
  if(!initialization)initialization=pool.query(fs.readFileSync(path.join(__dirname,'roll-schema.sql'),'utf8')).catch(error=>{initialization=null;throw error;});
  await initialization;return pool;
}
function mapRound(row){return {id:Number(row.id),startsAt:Number(row.starts_at),closesAt:Number(row.closes_at),endsAt:Number(row.ends_at),seed:row.seed,commitment:row.commitment,result:row.result};}
async function ensureRound(round,client){
  const db=client||await database();
  await db.query('INSERT INTO st25_roll_rounds(id,starts_at,closes_at,ends_at,seed,commitment,result) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING',[round.id,round.startsAt,round.closesAt,round.endsAt,round.seed,round.commitment,round.result]);
  return mapRound((await db.query('SELECT * FROM st25_roll_rounds WHERE id=$1',[round.id])).rows[0]);
}
async function withPlayer(steamId,task){
  const client=await (await database()).connect();let locked=false;
  try{
    locked=(await client.query("SELECT pg_try_advisory_lock(hashtext('st25-roll'),hashtext($1)) AS locked",[steamId])).rows[0].locked;
    if(!locked)throw Object.assign(Error('Cược trước đang xử lý. Vui lòng đợi.'),{status:429});
    return await task(client);
  }finally{let broken=false;if(locked)try{await client.query("SELECT pg_advisory_unlock(hashtext('st25-roll'),hashtext($1))",[steamId]);}catch{broken=true;}client.release(broken);}
}
async function numberingOrigin(roundId){
  const db=await database();
  await db.query("INSERT INTO st25_roll_settings(key,value) VALUES('numbering_origin_v1',$1) ON CONFLICT(key) DO NOTHING",[roundId]);
  const result=await db.query("SELECT value FROM st25_roll_settings WHERE key='numbering_origin_v1'");
  return Number(result.rows[0].value);
}
module.exports={database,ensureRound,mapRound,withPlayer,numberingOrigin};
