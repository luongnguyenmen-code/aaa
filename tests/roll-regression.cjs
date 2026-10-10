const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {newDb}=require('pg-mem'),engine=require('../src/services/roll-engine'),rules=require('../src/core/roll');
const createService=require('../src/services/roll');
const originalNow=Date.now,originalEnv={url:process.env.ROLL_DATABASE_URL,enabled:process.env.ROLL_ENABLED};
let now=600005000;Date.now=()=>now;
process.env.ROLL_DATABASE_URL='postgres://fixture:fixture@offline.invalid/roll';process.env.ROLL_ENABLED='true';
const sid='76561198000000001',other='76561198000000002';
function fixture(){
  const db=newDb(),locks=new Set();
  db.public.registerFunction({name:'hashtext',args:['text'],returns:'integer',implementation:s=>Array.from(s).reduce((h,c)=>(h*31+c.charCodeAt(0))|0,0)});
  db.public.registerFunction({name:'pg_try_advisory_lock',args:['integer','integer'],returns:'bool',impure:true,implementation:(a,b)=>{const key=a+':'+b;if(locks.has(key))return false;locks.add(key);return true;}});
  db.public.registerFunction({name:'pg_advisory_unlock',args:['integer','integer'],returns:'bool',impure:true,implementation:(a,b)=>locks.delete(a+':'+b)});
  const pg=db.adapters.createPg(),module={exports:{}};
  vm.runInNewContext(fs.readFileSync('src/models/roll-store.js','utf8'),{module,process,URL,__dirname:path.resolve('src/models'),console,require:name=>name==='pg'?pg:require(name)});
  let balance=100,calls=[],failure=false;
  const bank={balance:async()=>balance,change:async(steamId,amount,reason)=>{calls.push({steamId,amount,reason});if(failure)return null;balance+=amount;return {ok:true,balance,applied:true};}};
  return {store:module.exports,service:createService(bank,module.exports),calls,getBalance:()=>balance,fail:()=>{failure=true;}};
}
const input=(roundId,color='red',amount=10)=>({roundId,color,amount,requestId:crypto.randomUUID()});
(async()=>{
  for(let i=0;i<15;i++){
    assert.equal(engine.payout(10,'red',i),i>=1&&i<=7?20:0);
    assert.equal(engine.payout(10,'black',i),i>=8?20:0);
    assert.equal(engine.payout(10,'green',i),i===0?140:0);
  }
  assert.equal(rules.slots.filter(c=>c==='red').length,7);assert.equal(rules.slots.filter(c=>c==='green').length,1);
  const round=engine.makeRound(now,'proof-fixture');assert.equal(round.result,engine.draw(round.seed));
  assert.equal(round.commitment,crypto.createHash('sha256').update(round.seed).digest('hex'));
  assert(!('seed' in engine.publicRound(round,round.closesAt)));assert(!('result' in engine.publicRound(round,round.closesAt-1)));assert.equal(engine.publicRound(round,round.closesAt).result,round.result);assert.equal(round.closesAt-round.startsAt,15000);assert.equal(round.endsAt-round.closesAt,8000);
  assert.equal(engine.publicRound(round,round.endsAt).result,round.result);
  for(const body of [input(-1),input(round.id,'purple'),input(round.id,'red',0),input(round.id,'red',1001),input(round.id,'red',1.5),{...input(round.id),requestId:'invalid'}])assert.throws(()=>engine.validateBet(body));
  const f=fixture();await f.store.database();
  let seed='winning';while(engine.draw(seed)<1||engine.draw(seed)>7)seed+='x';
  const winningRound=await f.store.ensureRound(engine.makeRound(now,seed)),request=input(winningRound.id);
  const placed=await f.service.bet(sid,request);assert.equal(placed.bet.status,'placed');assert.equal(f.getBalance(),90);
  const replay=await f.service.bet(sid,request);assert.equal(replay.replayed,true);assert.equal(f.calls.length,1);
  await assert.rejects(f.service.bet(sid,input(winningRound.id,'black',20)),e=>e.status===409);
  const switched=await f.service.bet(sid,input(winningRound.id,'black'));assert.equal(switched.bet.color,'black');assert.equal(f.calls.length,1);
  await f.service.bet(sid,input(winningRound.id,'red'));
  const state=await f.service.state(sid);assert.equal(state.bets.length,1);assert.equal(state.totals[0].players,1);assert.equal(state.balance,90);
  assert.equal((await f.service.state(other)).bets.length,0);
  now=winningRound.closesAt;await assert.rejects(f.service.bet(other,input(winningRound.id)),e=>e.status===409);
  now=winningRound.endsAt;const settled=await f.service.settle(sid);assert.equal(settled.bets[0].payout,20);assert.equal(f.getBalance(),110);
  await f.service.settle(sid);assert.equal(f.calls.length,2);assert.equal(f.getBalance(),110);
  const payoutFailure=fixture();const payoutRound=await payoutFailure.store.ensureRound(engine.makeRound(now+5000,seed));
  now+=5000;await payoutFailure.service.bet(sid,input(payoutRound.id));payoutFailure.fail();now=payoutRound.endsAt;
  await assert.rejects(payoutFailure.service.settle(sid),e=>e.status===503);
  await payoutFailure.service.settle(sid);assert.equal(payoutFailure.calls.length,2);
  assert.equal((await payoutFailure.service.state(sid)).bets[0].status,'review');
  now+=5000;const failed=fixture();failed.fail();const next=await failed.store.ensureRound(engine.makeRound(now));
  const ambiguous=input(next.id);await assert.rejects(failed.service.bet(sid,ambiguous),e=>e.status===503);
  await failed.service.bet(sid,ambiguous);assert.equal(failed.calls.length,1);
  assert.equal((await failed.service.state(sid)).bets[0].status,'review');
  // Distributed database locks reject a second player operation while the first is still waiting.
  let release;const held=failed.store.withPlayer(sid,()=>new Promise(resolve=>{release=resolve;}));
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(failed.store.withPlayer(sid,async()=>{}),e=>e.status===429);release();await held;
  await failed.store.withPlayer(sid,async()=>{});
  await assert.rejects(failed.service.bet(null,input(next.id)),e=>e.status===401);
  process.env.ROLL_ENABLED='false';await assert.rejects(failed.service.bet(sid,input(next.id)),e=>e.status===503);
  console.log('PASS Roll: 15 slots, x2/x14 payouts, hidden seed/result, input validation, PostgreSQL schema, duplicate requests, color change without double debit, closed rounds, private history, confirmed payout once, uncertain debit/payout review, distributed lock release and disabled mode; no live currency calls');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
  Date.now=originalNow;
  for(const [key,value] of [['ROLL_DATABASE_URL',originalEnv.url],['ROLL_ENABLED',originalEnv.enabled]])if(value===undefined)delete process.env[key];else process.env[key]=value;
});
