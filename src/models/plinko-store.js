const crypto=require('node:crypto');
let pool,initialization;
const databaseURL=()=>process.env.PLINKO_DATABASE_URL||process.env.PORTAL_DATABASE_URL;
async function database(){
  if(!databaseURL())throw Object.assign(Error('Plinko chưa kết nối kho giao dịch.'),{status:503});
  const address=new URL(databaseURL());
  if(/pooler|pgbouncer/i.test(address.hostname)||address.port==='6543')throw Object.assign(Error('Plinko cần PostgreSQL trực tiếp, không dùng transaction pooler.'),{status:503});
  if(!pool){const {Pool}=require('pg');pool=new Pool({connectionString:databaseURL(),max:3,connectionTimeoutMillis:5000,query_timeout:10000});pool.on('error',()=>console.error('Plinko database unavailable'));}
  if(!initialization)initialization=pool.query(`CREATE TABLE IF NOT EXISTS st25_plinko_games (
    id uuid PRIMARY KEY, steam_id varchar(17) NOT NULL, seed text NOT NULL,
    status text NOT NULL CHECK(status IN ('prepared','debit_pending','credit_pending','settled','review')),
    payload jsonb NOT NULL DEFAULT '{}', created_at bigint NOT NULL);
    CREATE INDEX IF NOT EXISTS st25_plinko_history ON st25_plinko_games(steam_id,created_at DESC)`)
    .catch(e=>{initialization=null;throw e;});
  await initialization;return pool;
}
async function withPlayer(steamId,task){
  const client=await(await database()).connect();let locked=false,broken=false;
  try{locked=(await client.query("SELECT pg_try_advisory_lock(hashtext('st25-plinko'),hashtext($1)) AS locked",[steamId])).rows[0].locked;
    if(!locked)throw Object.assign(Error('Lượt trước đang xử lý. Vui lòng chờ.'),{status:429});
    return await task(client);
  }finally{if(locked)try{await client.query("SELECT pg_advisory_unlock(hashtext('st25-plinko'),hashtext($1))",[steamId]);}catch{broken=true;}client.release(broken);}
}
const get=async(client,id,sid)=>(await client.query('SELECT * FROM st25_plinko_games WHERE id=$1 AND steam_id=$2',[id,sid])).rows[0];
const history=async sid=>(await(await database()).query("SELECT * FROM st25_plinko_games WHERE steam_id=$1 AND status!='prepared' ORDER BY created_at DESC LIMIT 30",[sid])).rows;
const unresolved=async(client,sid)=>(await client.query("SELECT id FROM st25_plinko_games WHERE steam_id=$1 AND status IN ('debit_pending','credit_pending','review') LIMIT 1",[sid])).rows.length>0;
async function prepare(client,sid){
  const existing=(await client.query("SELECT * FROM st25_plinko_games WHERE steam_id=$1 AND status='prepared' ORDER BY created_at DESC LIMIT 1",[sid])).rows[0];if(existing)return existing;
  return(await client.query("INSERT INTO st25_plinko_games(id,steam_id,seed,status,created_at) VALUES($1,$2,$3,'prepared',$4) RETURNING *",[crypto.randomUUID(),sid,crypto.randomBytes(32).toString('hex'),Date.now()])).rows[0];
}
async function update(client,row,status,payload=row.payload){return(await client.query('UPDATE st25_plinko_games SET status=$2,payload=$3 WHERE id=$1 RETURNING *',[row.id,status,JSON.stringify(payload)])).rows[0];}
module.exports={database,withPlayer,get,history,unresolved,prepare,update};
