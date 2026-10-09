// Local visual audit. The fixture blocks mutations and never contacts IslePilot.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
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
const fallback={success:true,items:[],data:[],players:[],quests:[],trades:[],incomingTrades:[],outgoingTrades:[],listings:[],marketListings:[],inventory:[],garage:[],dinos:[],skins:[],ownedSkins:[],crates:[],tickets:[],types:[],locations:[],rules:[],leaderboard:[],referrals:[],balance:202,coins:202,lua:202};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');if(req.method!=='GET'){res.writeHead(403);return res.end(JSON.stringify({error:'Offline fixture blocks live actions'}));}return res.end(JSON.stringify(fixtures[url.pathname]||fallback));}
  const requested=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!requested.startsWith(root+path.sep)||!/(?:\.html|\.css|\.js|\.png|\.jpg|\.webp|\.ico|\.ttf|\.json)$/.test(requested)){res.writeHead(404);return res.end();}
  const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ttf':'font/ttf','.json':'application/json'};
  try{res.setHeader('Content-Type',types[path.extname(requested)]||'application/octet-stream');res.end(fs.readFileSync(requested));}catch{res.writeHead(404);res.end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const profile=path.join(__dirname,`.redesign-browser-${Date.now()}`);
  const child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless','--disable-gpu','--no-first-run','--disable-background-networking',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{windowsHide:true,stdio:'ignore'});
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let socket;
  try{
    const portFile=path.join(profile,'DevToolsActivePort');for(let i=0;i<100&&!fs.existsSync(portFile);i++)await pause(100);
    const port=fs.readFileSync(portFile,'utf8').split('\n')[0];const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    let id=0;const pending=new Map();let errors=[];
    socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);const task=pending.get(message.id);if(task){pending.delete(message.id);message.error?task.reject(message.error):task.resolve(message.result);}};
    const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    await call('Runtime.enable');await call('Network.enable');
    await call('Network.setBlockedURLs',{urls:['*islepilot.eu*','*steamcommunity.com*','*api.steampowered.com*']});
    const pages=['index.html','bando.html','gara.html','nhiem-vu.html','giao-dich.html','hom-qua.html','skin.html','bxh.html','ho-tro.html','noi-quy.html','tai-hud.html','moi-ban.html','tha-xac.html','lien-ket-steam.html','cai-dat.html'];
    const cases=process.env.ST25_SKIN_AUDIT ? [1440,1024,768,390,320].map(width=>({page:'skin.html',width})) : [...pages.map(page=>({page,width:1440})),...['index.html','bando.html','gara.html','nhiem-vu.html','giao-dich.html'].map(page=>({page,width:390}))];
    const results=[];
    for(const {page,width} of cases){errors=[];await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await call('Page.navigate',{url:origin+'/'+page});
      for(let attempt=0;attempt<40;attempt++){await pause(100);const ready=await call('Runtime.evaluate',{expression:'document.readyState !== "loading" && typeof App !== "undefined" && App.authResolved && !!window.ST25UI',returnByValue:true});if(ready.result.value)break;}
      await pause(300);
      if (process.env.ST25_SKIN_AUDIT) {
        const exercise=await call('Runtime.evaluate',{expression:`JSON.stringify((()=>{
          const select=document.getElementById('dino-species-select');
          document.querySelector('[data-species="Carnotaurus"]').click();
          const species=select.value==='Carnotaurus' && document.getElementById('selected-species-badge').textContent==='Carnotaurus';
          onHexInputChange('body','#123456');
          const color=document.getElementById('svg-body').getAttribute('fill')==='#123456';
          toggleLockChannel('body');randomizeColors();
          const lock=document.getElementById('hex-body').value==='#123456';
          document.getElementById('skin-workspace-tab-1').click();
          const owned=!document.getElementById('owned-skin-grid').closest('section').hidden && document.querySelector('.editor-layout').hidden;
          document.getElementById('skin-workspace-tab-2').click();
          const shop=!document.getElementById('skin-shop-grid').closest('section').hidden;
          document.getElementById('skin-workspace-tab-0').click();
          exportSkinCode();
          const code=!!document.getElementById('skin-code-output').value;
          onHexInputChange('body','#654321');
          const freshCode=document.getElementById('skin-code-output').value===generateEvrimaCode();
          applyPreset('golden_rice');
          const preset=document.querySelector('.skin-quick-presets .active')?.getAttribute('aria-pressed')==='true';
          const savedRaw=localStorage.getItem('st25_user_skin_presets');
          localStorage.setItem('st25_user_skin_presets','{}');loadSavedPresets();
          const corruptStorage=readSavedSkinPresets().length===0;
          const unsafeName="Skin O'Neil <img src=x onerror=alert(1)>";
          localStorage.setItem('st25_user_skin_presets',JSON.stringify([{name:unsafeName,species:'Carnotaurus',colors:{...currentColors}}]));loadSavedPresets();
          const escapedName=!document.querySelector('#saved-presets-list img') && document.getElementById('saved-presets-list').textContent.includes(unsafeName);
          renderOwnedSkins([{id:"owned'1",name:unsafeName}]);
          const ownedName=document.querySelector('#owned-skin-grid button').dataset.name===unsafeName && !document.querySelector('#owned-skin-grid img');
          const originalSet=Storage.prototype.setItem;
          let blockedStorage=false;
          try {Storage.prototype.setItem=()=>{throw new Error('Blocked storage');};blockedStorage=writeSavedSkinPresets([])===false;}finally{Storage.prototype.setItem=originalSet;}
          if(savedRaw===null)localStorage.removeItem('st25_user_skin_presets');else localStorage.setItem('st25_user_skin_presets',savedRaw);
          const oneAuthRead=performance.getEntriesByType('resource').filter(r=>new URL(r.name).pathname==='/api/player/me').length===1;
          const beforeInvalid=getSkinPayload().colors.body;
          const invalidImport=parseAndApplySkinInput(JSON.stringify({colors:{body:'#not-a-color'}}))===false && getSkinPayload().colors.body===beforeInvalid;
          const exported=generateEvrimaCode();
          changeSpecies('Troodon');onHexInputChange('body','#112233');
          const roundTrip=parseAndApplySkinInput(exported) && generateEvrimaCode()===exported && select.value==='Carnotaurus';
          return {species,color,lock,owned,shop,code,freshCode,preset,corruptStorage,escapedName,ownedName,blockedStorage,oneAuthRead,invalidImport,roundTrip,tiles:document.querySelectorAll('.skin-species-tile').length,channels:document.querySelectorAll('.color-channel-row').length};
        })())`,returnByValue:true});
        const checks=JSON.parse(exercise.result.value);console.log(JSON.stringify({skinChecks:checks}));
        if(Object.values(checks).some(value=>!value))errors.push('Skin interaction check failed');
        const concurrency=await call('Runtime.evaluate',{expression:`(async()=>{
          const originalFetch=window.fetch,originalConfirm=window.confirm;
          let sends=0,release;
          try {
            window.confirm=()=>true;
            window.fetch=()=>{sends++;return new Promise(resolve=>release=()=>resolve({ok:false,json:async()=>({error:'Offline mutation test'})}));};
            const first=handleApplyOwnedPreset('fixture','fixture');
            const second=handleApplyOwnedPreset('fixture','fixture');
            const third=handleBuySkin('fixture','fixture',1);
            const blocked=sends===1;
            release();await Promise.all([first,second,third]);
            return blocked && skinMutationBusy===false;
          } finally {window.fetch=originalFetch;window.confirm=originalConfirm;}
        })()`,awaitPromise:true,returnByValue:true});
        if(concurrency.result.value!==true)errors.push('Concurrent skin mutations were not blocked or released');
        await call('Page.reload');
        await pause(800);
      }
      const check=await call('Runtime.evaluate',{expression:'JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,icons:document.querySelectorAll(".site-header .st25-line-icon").length,dock:!!document.getElementById("st25-live-dock"),hud:!!document.querySelector(".player-hud-bar"),brokenImages:[...document.images].filter(i=>i.getAttribute("src")&&i.complete&&!i.naturalWidth).map(i=>i.getAttribute("src"))})',returnByValue:true});
      const metrics=JSON.parse(check.result.value);const result={page,width,...metrics,errors:[...errors]};results.push(result);
      console.log(JSON.stringify(result));
      if(['index.html','bando.html','nhiem-vu.html','skin.html'].includes(page)){const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(__dirname,`redesign-${page.replace('.html','')}-${width}.png`),Buffer.from(shot.data,'base64'));}
    }
    fs.writeFileSync(path.join(__dirname,process.env.ST25_SKIN_AUDIT?'skin-audit-results.json':'redesign-audit-results.json'),JSON.stringify({scope:'Offline mocks; transactions blocked; not a live API test',results},null,2));
    await call('Browser.close');
    if(results.some(r=>r.scroll>r.width||r.errors.length))process.exitCode=1;
  }finally{socket?.close();child.kill();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
