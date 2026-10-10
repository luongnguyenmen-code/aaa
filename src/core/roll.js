module.exports=Object.freeze({
  roundMs:23000,betMs:15000,minBet:1,maxBet:1000,
  // Shared demo origin, matching the first observed production numbering round.
  // Keep this fixed across deployments and serverless cold starts.
  demoNumberingStartsAt:1791648687000,
  slots:['green',...Array(7).fill('red'),...Array(7).fill('black')],
  payouts:{red:2,black:2,green:14},
  enabled:()=>process.env.ROLL_ENABLED==='true'
});
