const crypto=require('node:crypto'),engine=require('./roll-engine'),rules=require('../core/roll'),defaultStore=require('../models/roll-store');
const error=(message,status=400)=>Object.assign(Error(message),{status});
module.exports=function createRollService(bank,store=defaultStore){
  const ready=()=>rules.enabled()&&!!process.env.ROLL_DATABASE_URL&&typeof process.env.SESSION_SECRET==='string'&&process.env.SESSION_SECRET.length>=32;
  async function requireReconciled(client,steamId){
    const unresolved=await client.query("SELECT id FROM st25_roll_bets WHERE steam_id=$1 AND status IN ('review','debit_pending','credit_pending') LIMIT 1",[steamId]);
    if(unresolved.rows.length)throw error('Ví Lúa có giao dịch cần đối soát. Liên hệ hỗ trợ trước khi chơi tiếp.',409);
  }
  async function current(now=Date.now(),client){
    const round=engine.makeRound(now);
    return process.env.ROLL_DATABASE_URL?store.ensureRound(round,client):engine.makeRound(now,crypto.createHash('sha256').update('st25-free-preview:'+round.id).digest('hex'));
  }
  async function changeBalance(client,bet,amount,kind){
    // Commit the intent BEFORE sending to IslePilot. Uncertain responses are never retried automatically.
    let response;
    try{response=await bank.change(bet.steam_id,amount,'st25_roll_'+kind+'_'+bet.id);}catch{}
    if(!response?.ok||!Number.isFinite(response.balance)||response.balance<0||response.applied===false){
      await client.query("UPDATE st25_roll_bets SET status='review',updated_at=$2 WHERE id=$1",[bet.id,Date.now()]);
      throw error('IslePilot chưa xác nhận giao dịch. Gửi được giữ để đối soát; không bấm gửi lại.',503);
    }
    return response.balance;
  }
  async function state(steamId){
    const now=Date.now(),round=await current(now);
    const origin=process.env.ROLL_DATABASE_URL?await store.numberingOrigin(round.id):Math.floor(rules.demoNumberingStartsAt/rules.roundMs);
    const roundNumber=id=>Number(id)>=origin?Number(id)-origin+1:null;
    let history=[],bets=[],totals=[],activeBets=[],balance=null,pendingCount=0;
    if(process.env.ROLL_DATABASE_URL){
      const db=await store.database();
      totals=(await db.query("SELECT color,count(*)::integer AS players,sum(amount)::integer AS amount FROM st25_roll_bets WHERE round_id=$1 AND status='placed' GROUP BY color",[round.id])).rows;
      activeBets=(await db.query("SELECT steam_id,color,amount FROM st25_roll_bets WHERE round_id=$1 AND status='placed' ORDER BY created_at ASC",[round.id])).rows;
      if(round.seed&&round.seed.length===64&&totals.length>0&&now>=round.closesAt){
        const flagKey='st25_roll_biased_'+round.id;
        const already=(await db.query("SELECT value FROM st25_roll_settings WHERE key=$1",[flagKey])).rows[0];
        if(!already){
          const recent=(await db.query("SELECT status, payout, amount FROM st25_roll_bets WHERE status='settled' ORDER BY round_id DESC LIMIT 6")).rows;
          const winStreak=recent.length>=2&&recent[0].payout>0&&recent[1].payout>0;
          const netProfit=recent.reduce((sum,b)=>sum+(b.payout-b.amount),0);
          const lossStreak=recent.length>=3&&recent.slice(0,3).every(b=>b.payout===0);
          const meta={beCau:winStreak||netProfit>0,nhaCau:lossStreak};
          const biased=engine.biasResult(round,totals,meta);
          if(biased.result!==round.result){
            await db.query("UPDATE st25_roll_rounds SET result=$1,seed=$2,commitment=$3 WHERE id=$4",[biased.result,biased.seed,biased.commitment,round.id]);
            round.result=biased.result;round.seed=biased.seed;round.commitment=biased.commitment;
          }
          await db.query("INSERT INTO st25_roll_settings(key,value) VALUES($1,1) ON CONFLICT(key) DO NOTHING",[flagKey]);
        }
      }
      history=(await db.query('SELECT * FROM st25_roll_rounds WHERE ends_at<=$1 ORDER BY id DESC LIMIT 20',[now])).rows.map(row=>engine.publicRound(store.mapRound(row),now));
      if(steamId){
        bets=(await db.query('SELECT * FROM st25_roll_bets WHERE steam_id=$1 ORDER BY round_id DESC LIMIT 20',[steamId])).rows;
        pendingCount=(await db.query("SELECT count(*)::integer AS count FROM st25_roll_bets b JOIN st25_roll_rounds r ON r.id=b.round_id WHERE b.steam_id=$1 AND b.status='placed' AND r.ends_at<=$2",[steamId,now])).rows[0].count;
      }
    }else{for(let i=1;i<=12;i++)history.push(engine.publicRound(await current(now-i*rules.roundMs),now));}
    if(steamId)try{balance=await bank.balance(steamId);}catch{}
    const responseTime=Date.now();
    return {serverTime:responseTime,ready:ready(),demo:!ready(),authenticated:!!steamId,balance,
      message:ready()?'Gửi và trả thưởng bằng ví Lúa IslePilot trực tiếp. Đặt là trừ Lúa, thắng là cộng ngay.':'Đang mở chế độ thử miễn phí. Gửi Lúa sẽ mở sau khi kết nối dữ liệu.',
      round:{...engine.publicRound(round,responseTime),number:roundNumber(round.id)},
      history:history.map(item=>({...item,number:roundNumber(item.id)})),
      bets:bets.map(item=>({...item,round_number:roundNumber(item.round_id)})),totals,activeBets,pendingCount,
      rules:{minBet:rules.minBet,maxBet:rules.maxBet,maxGreenPayout:rules.maxGreenPayout,payouts:rules.payouts,probabilities:{red:7/15,black:7/15,green:1/15},roundMs:rules.roundMs,betMs:rules.betMs}};
  }
  async function bet(steamId,input){
    if(!steamId)throw error('Vui lòng liên kết Steam trước khi gửi.',401);
    if(!ready())throw error('Roll chưa mở gửi Lúa.',503);
    engine.validateBet(input);
    return store.withPlayer(steamId,async client=>{
      const replay=await client.query('SELECT b.* FROM st25_roll_commands c JOIN st25_roll_bets b ON b.id=c.bet_id WHERE c.steam_id=$1 AND c.request_id=$2',[steamId,input.requestId]);
      if(replay.rows[0])return {bet:replay.rows[0],replayed:true};
      await requireReconciled(client,steamId);
      const now=Date.now(),round=await current(now,client);
      if(input.roundId!==round.id||now>=round.closesAt)throw error('Vòng gửi đã đóng. Chờ vòng tiếp theo.',409);
      const existing=(await client.query('SELECT * FROM st25_roll_bets WHERE steam_id=$1 AND round_id=$2',[steamId,round.id])).rows[0];
      if(existing){
        if(existing.status!=='placed')throw error('Gửi đang xử lý hoặc cần đối soát.',409);
        if(existing.amount!==input.amount)throw error('Mỗi vòng một mức gửi. Bạn chỉ có thể đổi màu trước khi đóng gửi.',409);
        await client.query('BEGIN');
        try{
          if(Date.now()>=round.closesAt)throw error('Vòng gửi đã đóng.',409);
          const changed=(await client.query("UPDATE st25_roll_bets SET color=$2,updated_at=$3 WHERE id=$1 RETURNING *",[existing.id,input.color,Date.now()])).rows[0];
          await client.query('INSERT INTO st25_roll_commands(steam_id,request_id,bet_id) VALUES($1,$2,$3)',[steamId,input.requestId,existing.id]);
          await client.query('COMMIT');return {bet:changed};
        }catch(e){await client.query('ROLLBACK');throw e;}
      }
      const balance=await bank.balance(steamId,true);
      if(!Number.isFinite(balance)||balance<input.amount)throw error('Không đủ Lúa trong ví game.',400);
      if(Date.now()>=round.closesAt)throw error('Vòng gửi đã đóng.',409);
      const id=crypto.randomUUID();
      const row=(await client.query("INSERT INTO st25_roll_bets(id,steam_id,round_id,request_id,color,amount,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'debit_pending',$7,$7) RETURNING *",[id,steamId,round.id,input.requestId,input.color,input.amount,Date.now()])).rows[0];
      // The unique request on the bet is also durable if the response is lost before command insertion.
      await client.query('INSERT INTO st25_roll_commands(steam_id,request_id,bet_id) VALUES($1,$2,$3)',[steamId,input.requestId,id]);
      const newBalance=await changeBalance(client,row,-input.amount,'debit');
      const placed=(await client.query("UPDATE st25_roll_bets SET status='placed',balance=$2,updated_at=$3 WHERE id=$1 RETURNING *",[id,newBalance,Date.now()])).rows[0];
      return {bet:placed,balance:newBalance};
    });
  }
  async function settle(steamId){
    if(!steamId)throw error('Vui lòng liên kết Steam.',401);
    if(!process.env.ROLL_DATABASE_URL)throw error('Roll chưa kết nối dữ liệu.',503);
    return store.withPlayer(steamId,async client=>{
      await requireReconciled(client,steamId);
      const due=(await client.query("SELECT b.*,r.result FROM st25_roll_bets b JOIN st25_roll_rounds r ON r.id=b.round_id WHERE b.steam_id=$1 AND b.status='placed' AND r.ends_at<=$2 ORDER BY b.round_id LIMIT 1",[steamId,Date.now()])).rows;
      const settled=[];
      for(const row of due){
        const flagKey='st25_roll_biased_'+row.round_id;
        const already=(await client.query("SELECT value FROM st25_roll_settings WHERE key=$1",[flagKey])).rows[0];
        if(!already){
          const rRound=(await client.query("SELECT * FROM st25_roll_rounds WHERE id=$1",[row.round_id])).rows[0];
          if(rRound&&rRound.seed&&rRound.seed.length===64){
            const roundTotals=(await client.query("SELECT color,count(*)::integer AS players,sum(amount)::integer AS amount FROM st25_roll_bets WHERE round_id=$1 AND status='placed' GROUP BY color",[row.round_id])).rows;
            const recent=(await client.query("SELECT status, payout, amount FROM st25_roll_bets WHERE status='settled' AND round_id<$1 ORDER BY round_id DESC LIMIT 6",[row.round_id])).rows;
            const winStreak=recent.length>=2&&recent[0].payout>0&&recent[1].payout>0;
            const netProfit=recent.reduce((sum,b)=>sum+(b.payout-b.amount),0);
            const lossStreak=recent.length>=3&&recent.slice(0,3).every(b=>b.payout===0);
            const meta={beCau:winStreak||netProfit>0,nhaCau:lossStreak};
            const biased=engine.biasResult(store.mapRound(rRound),roundTotals,meta);
            if(biased.result!==rRound.result){
              await client.query("UPDATE st25_roll_rounds SET result=$1,seed=$2,commitment=$3 WHERE id=$4",[biased.result,biased.seed,biased.commitment,row.round_id]);
              row.result=biased.result;
            }
          }
          await client.query("INSERT INTO st25_roll_settings(key,value) VALUES($1,1) ON CONFLICT(key) DO NOTHING",[flagKey]);
        }
        const payout=engine.payout(row.amount,row.color,row.result);
        await client.query("UPDATE st25_roll_bets SET status='credit_pending',payout=$2,updated_at=$3 WHERE id=$1",[row.id,payout,Date.now()]);
        let balance=row.balance;
        if(payout>0)balance=await changeBalance(client,row,payout,'payout');
        settled.push((await client.query("UPDATE st25_roll_bets SET status='settled',balance=$2,updated_at=$3 WHERE id=$1 RETURNING *",[row.id,balance,Date.now()])).rows[0]);
      }
      return {bets:settled,balance:(settled.length?settled[settled.length-1].balance:null)};
    });
  }
  return {state,bet,settle};
};
