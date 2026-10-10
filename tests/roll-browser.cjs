// Local visual audit. The fixture blocks mutations and never contacts IslePilot.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const {renderPage, readPublicAsset}=require('./helpers/source.cjs');
const steam='76561198000000001';
const dino={species:'Tyrannosaurus',gender:'Đực (Male)',growth:90,health:51,hunger:99,thirst:99,stamina:100,grid:'F7',lat:450,lng:500,position:{x:0,y:0}};
const user={linked:true,isLoggedIn:true,steam_id:steam,persona_name:'ST25 Survivor',avatar:'/assets/imges/st25-favicon.png',balance:202,coins:202,lua:202,role:'Thành viên',roleKey:'default',maxSlots:20,totalParked:6,notifications:[],dino};
const fixtures={
  '/api/skin/info':{balance:202,isOnline:true,personaName:'ST25 Survivor',steamId:steam,species:'Tyrannosaurus',growth:90,ownedSkins:[],shopSkins:[]},
  '/api/player/me':user,'/api/player/vitals':{steam_id:steam,dino},
  '/api/server/status':{name:'ST25 VIETNAM',status:'online',online:true,online_players:17,max_players:100,map:'Gateway'},
  '/api/server/environment':{isDay:true,displayBadge:'🌤️ Ban ngày · Trời quang 29°C',weatherIcon:'🌤️'},
  '/api/player/quests':{steamId:steam,isLoggedIn:true,player:{name:user.persona_name,species:dino.species,gender:dino.gender,growth:90,online:true,avatar:user.avatar},coins:202,serverQuests:[{id:'1',name:'Bậc thầy sinh tồn',description:'Sinh tồn 120 phút trên đảo Gateway.',period:'daily',progress:82,config:{minutes:120},rewardAmount:12},{id:'2',name:'Khám phá Gateway',description:'Di chuyển 25 km trên đảo.',period:'daily',progress:5300,config:{km:25},rewardAmount:15}],primeQuests:[]},
  '/api/player/map':{...dino,steam_id:steam,linked:true,online:true,name:user.persona_name,dino,player:user},
  '/api/player/team':{members:[],team:[]},'/api/map/zones':{zones:[],pois:[]},
  '/api/player/garage':{steamId:steam,activeDino:dino,maxSlots:20,totalParked:0,garage:[],slots:[],dinos:[],roleName:'Thành viên',roleKey:'default'},
  '/api/admin/check':{isAdmin:false,isSuperAdmin:false},'/api/casino/stats':{enabled:false}
};
if(process.env.ST25_3D_GUEST) fixtures['/api/player/me']={linked:false,isLoggedIn:false};
const fallback={success:true,items:[],data:[],players:[],quests:[],trades:[],incomingTrades:[],outgoingTrades:[],listings:[],marketListings:[],inventory:[],garage:[],dinos:[],skins:[],ownedSkins:[],crates:[],tickets:[],types:[],locations:[],rules:[],leaderboard:[],referrals:[],balance:202,coins:202,lua:202};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');if(req.method!=='GET'){res.writeHead(403);return res.end(JSON.stringify({error:'Offline fixture blocks live actions'}));}return res.end(JSON.stringify(fixtures[url.pathname]||fallback));}
  const requested=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!requested.startsWith(root+path.sep)||!/(?:\.html|\.css|\.js|\.mjs|\.png|\.jpg|\.webp|\.ico|\.ttf|\.json)$/.test(requested)){res.writeHead(404);return res.end();}
  const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ttf':'font/ttf','.json':'application/json'};
  try{
    res.setHeader('Content-Type',types[path.extname(requested)]||'application/octet-stream');
    if (/^\/[a-zA-Z0-9_-]+\.html$/.test(url.pathname) || url.pathname==='/') res.end(renderPage(path.basename(requested)));
    else if (/^\/assets\/js\/(?:core\.js|api\/|features\/)/.test(url.pathname)) res.end(readPublicAsset(url.pathname));
    else res.end(fs.readFileSync(requested));
  }catch{res.writeHead(404);res.end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const profile=path.join(__dirname,`.redesign-browser-${Date.now()}`);
  const child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless','--disable-gpu',...(process.env.ST25_3D_FALLBACK?['--disable-webgl']:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']),'--no-first-run','--disable-background-networking',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{windowsHide:true,stdio:'ignore'});
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let socket;
  try{
    const portFile=path.join(profile,'DevToolsActivePort');let port;
    for(let i=0;i<100;i++) {
      try {const candidate=fs.readFileSync(portFile,'utf8').split('\n')[0].trim();if(/^\d+$/.test(candidate)){port=candidate;break;}}catch{}
      await pause(100);
    }
    if(!port)throw new Error('Chrome debugging port did not become ready');
    const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    let id=0;const pending=new Map();let errors=[];
    socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);if(process.env.ST25_3D_AUDIT && message.method==='Runtime.consoleAPICalled' && message.params.type==='error' && !(process.env.ST25_3D_FALLBACK && message.params.args.some(arg=>/WebGL.*context|Error creating WebGL/.test(String(arg.value))))) errors.push(message.params.args.map(arg=>arg.value||arg.description||'').join(' '));const task=pending.get(message.id);if(task){pending.delete(message.id);message.error?task.reject(message.error):task.resolve(message.result);}};
    const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    await call('Runtime.enable');await call('Network.enable');
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await call('Network.setBlockedURLs',{urls:['*islepilot.eu*','*steamcommunity.com*','*api.steampowered.com*']});

    const results=[];
    const snapshot=()=>{const now=Date.now();return {serverTime:now,ready:false,demo:true,authenticated:true,balance:202,message:'FREE PREVIEW',round:{id:123,startsAt:now,closesAt:now+60000,endsAt:now+90000,commitment:'abc123',phase:'betting'},history:[{id:122,result:0,color:'green',seed:'test',commitment:'proof'}],bets:[],totals:[],rules:{payouts:{red:2,black:2,green:14}}};};
    for(const width of [1440,768,390,320]){
      errors=[];fixtures['/api/roll/state']=snapshot();
      await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
      await call('Page.navigate',{url:origin+'/roll.html'});
      for(let attempt=0;attempt<60;attempt++){await pause(100);const ready=await call('Runtime.evaluate',{expression:"document.getElementById('roll-notice')?.textContent==='FREE PREVIEW' && App.authResolved && !document.getElementById('roll-submit').disabled",returnByValue:true});if(ready.result.value)break;}
      const exercise=await call('Runtime.evaluate',{expression:`(()=>{
        const amount=document.getElementById('roll-amount');amount.value='50';amount.dispatchEvent(new Event('input'));
        const red=document.getElementById('roll-quote').textContent.includes('100');
        document.querySelector('input[name=color][value=green]').click();
        const green=document.getElementById('roll-quote').textContent.includes('700');
        document.getElementById('roll-submit').click();
        return {redQuote:red,greenQuote:green,demoChoice:document.getElementById('roll-feedback').textContent.includes('Lúa'),menu:!!document.querySelector('a[href="roll.html"]'),tiles:document.querySelectorAll('.roll-tile').length===120,overflow:document.documentElement.scrollWidth>innerWidth};
      })()`,returnByValue:true});
      const spin=snapshot();spin.round.closesAt=Date.now()-500;spin.round.endsAt=Date.now()+6000;spin.round.phase='betting';fixtures['/api/roll/state']=spin;
      await pause(2400);
      const motion=await call('Runtime.evaluate',{expression:"document.querySelector('.roll-arena').classList.contains('is-spinning') && document.getElementById('roll-track').getAnimations().length===1 && document.getElementById('roll-submit').disabled",returnByValue:true});
      if(!motion.result.value)throw Error('Spin animation or closed-round controls failed');
      const reelBefore=await call('Runtime.evaluate',{expression:"getComputedStyle(document.getElementById('roll-track')).transform",returnByValue:true});
      await pause(3400);
      const reelAfter=await call('Runtime.evaluate',{expression:"getComputedStyle(document.getElementById('roll-track')).transform",returnByValue:true});
      if(reelBefore.result.value===reelAfter.result.value)throw Error('Reel stopped instead of continuing its spin');
      const next=snapshot();next.round.id=124;next.history.unshift({id:123,result:0,color:'green',seed:'test123',commitment:'abc123'});fixtures['/api/roll/state']=next;
      await pause(2400);
      const check=await call('Runtime.evaluate',{expression:"({result:document.getElementById('roll-result').textContent.includes('123'),proof:!document.getElementById('roll-proof-data')&&!document.querySelector('.roll-proof'),demoWon:document.getElementById('roll-feedback').textContent.includes('đúng màu'),alerts:document.querySelectorAll('[role=alert]').length})",returnByValue:true});
      await pause(6700);
      const centered=await call('Runtime.evaluate',{expression:"(()=>{const marker=document.querySelector('.roll-marker').getBoundingClientRect(),mid=(marker.left+marker.right)/2;const tile=[...document.querySelectorAll('.roll-tile')].find(x=>{const b=x.getBoundingClientRect();return b.left<=mid&&b.right>=mid});return tile?.textContent==='0'&&Math.abs((tile.getBoundingClientRect().left+tile.getBoundingClientRect().right)/2-mid)<1})()",returnByValue:true});
      if(!centered.result.value)throw Error('Reel does not stop centered on the declared result');
      const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(__dirname,'roll-'+width+'.png'),Buffer.from(shot.data,'base64'));
      const record={width,exercise:exercise.result.value,checks:check.result.value,errors};results.push(record);console.log(JSON.stringify(record));
    }
    fs.writeFileSync(path.join(__dirname,'roll-browser-results.json'),JSON.stringify(results,null,2));
    await call('Browser.close');
    if(results.some(r=>r.errors.length||r.exercise.overflow||!r.exercise.redQuote||!r.exercise.greenQuote||!r.exercise.demoChoice||!r.exercise.menu||!r.exercise.tiles||!r.checks.result||!r.checks.proof||!r.checks.demoWon||r.checks.alerts))process.exitCode=1;
  }finally{socket?.close();child.kill();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});