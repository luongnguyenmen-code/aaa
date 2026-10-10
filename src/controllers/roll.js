const API=require('../api/endpoints'),Pilot=require('../api/upstream-endpoints');
module.exports=(app,context)=>{
  const service=require('../services/roll')({balance:context.getLivePlayerBalance,
    change:async(steamId,amount,reason)=>{
      const result=await context.callIslePilot(Pilot.playerCurrency(steamId),'POST',{amount,reason});
      context.clearPlayerCache(steamId);return result;
    }});
  const handle=action=>async(req,res)=>{try{res.json(await action(req));}catch(error){if(error.status)res.status(error.status).json({error:error.message});else throw error;}};
  app.get(API.routes.rollState,handle(req=>service.state(context.getRequestSteamId(req))));
  app.post(API.routes.rollBet,handle(req=>service.bet(context.getRequestSteamId(req),req.body)));
  app.post(API.routes.rollSettle,handle(req=>service.settle(context.getRequestSteamId(req))));
};
