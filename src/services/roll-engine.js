const crypto=require('node:crypto'),rules=require('../core/roll');
function draw(seed){
  const limit=Math.floor(2**32/15)*15;
  for(let nonce=0;;nonce++){
    const value=crypto.createHash('sha256').update(seed+':roll:'+nonce).digest().readUInt32BE();
    if(value<limit)return value%15;
  }
}
function makeRound(now=Date.now(),seed=crypto.randomBytes(32).toString('hex')){
  const id=Math.floor(now/rules.roundMs),startsAt=id*rules.roundMs;
  return {id,startsAt,closesAt:startsAt+rules.betMs,endsAt:startsAt+rules.roundMs,seed,
    commitment:crypto.createHash('sha256').update(seed).digest('hex'),result:draw(seed)};
}
function publicRound(round,now=Date.now()){
  const revealed=now>=round.endsAt;
  return {id:round.id,startsAt:round.startsAt,closesAt:round.closesAt,endsAt:round.endsAt,
    commitment:round.commitment,phase:now<round.closesAt?'betting':revealed?'finished':'spinning',
    ...(now>=round.closesAt?{result:round.result,color:rules.slots[round.result]}:{}),
    ...(revealed?{seed:round.seed}: {})};
}
function validateBet(body){
  if(!Number.isSafeInteger(body?.roundId)||body.roundId<0||typeof body?.color!=='string'||!Object.hasOwn(rules.payouts,body.color)||
    !Number.isSafeInteger(body?.amount)||body.amount<rules.minBet||body.amount>rules.maxBet||
    typeof body?.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.requestId))throw Object.assign(Error(`Cược không hợp lệ: chọn màu và số Lúa nguyên từ ${rules.minBet} đến ${rules.maxBet}.`),{status:400});
  return body;
}
module.exports={draw,makeRound,publicRound,validateBet,payout:(amount,color,result)=>rules.slots[result]===color?Math.min(amount*rules.payouts[color],color==='green'?rules.maxGreenPayout:Infinity):0};
