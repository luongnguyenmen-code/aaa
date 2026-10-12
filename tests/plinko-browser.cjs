// Headless browser QA against offline fixtures only. Never contacts the game wallet.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {renderPage,readPublicAsset}=require('./helpers/source.cjs'),engine=require('../src/services/plinko-engine');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.build-cache/plinko-browser');fs.mkdirSync(out,{recursive:true});
const steam='76561198000000001',games=new Map();let balance=202,prepareCount=0,playCount=0;
const tables=Array.from({length:9},(_,i)=>engine.risks.map(risk=>engine.table(i+8,risk))).flat();
const user=()=>({linked:true,isLoggedIn:true,steam_id:steam,persona_name:'Offline QA',avatar:'/assets/imges/st25-favicon.png',balance,coins:balance,lua:balance,notifications:[]});
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
    res.setHeader('Content-Type','application/json');let result={success:true,items:[],data:[],players:[],quests:[],trades:[],incomingTrades:[],outgoingTrades:[],listings:[],inventory:[],garage:[],dinos:[],tickets:[]};
    if(url.pathname==='/api/player/me')result=user();
    if(url.pathname==='/api/plinko/state')result={ready:true,authenticated:true,balance,tables,history:[...games.values()].filter(g=>g.status==='settled'),message:'Offline fixtures only'};
    if(req.method!=='GET'){
      if(!['/api/plinko/prepare','/api/plinko/play'].includes(url.pathname)){res.writeHead(403);return res.end(JSON.stringify({error:'All other mutations blocked'}));}
      if(url.pathname.endsWith('/prepare')){prepareCount++;const id=crypto.randomUUID(),serverSeed=crypto.randomBytes(32).toString('hex');games.set(id,{id,serverSeed,commitment:engine.commitment(serverSeed),status:'prepared'});const g=games.get(id);result={id,commitment:g.commitment};}
      else{playCount++;let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);engine.validate(body);const g=games.get(body.gameId),draw=engine.draw(g.serverSeed,body.clientSeed,body.rows),multiplier=engine.table(body.rows,body.risk).multipliers[draw.slot],payout=Math.floor(body.amount*multiplier);balance+=payout-body.amount;Object.assign(g,body,draw,{multiplier,payout,balance,status:'settled',algorithm:'hmac-sha256-row-v1'});result={game:g,balance};}
    }
    return res.end(JSON.stringify(result));
  }
  try{const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+path.sep))throw Error('outside');const ext=path.extname(file);res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.svg':'image/svg+xml'}[ext]||'application/octet-stream');if(/^\/[\w-]+\.html$/.test(url.pathname))return res.end(renderPage(path.basename(file)));if(/^\/assets\/js\/(?:core\.js|api\/|features\/)/.test(url.pathname))return res.end(readPublicAsset(url.pathname));res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,profile=path.join(out,'profile-'+Date.now());
  const child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless','--disable-gpu','--no-first-run','--disable-background-networking',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{windowsHide:true,stdio:'ignore'});
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let socket;const errors=[],metrics=[];
  try{
    const portFile=path.join(profile,'DevToolsActivePort');let port;for(let i=0;i<100;i++){try{port=fs.readFileSync(portFile,'utf8').split('\n')[0].trim();if(/^\d+$/.test(port))break;}catch{}await pause(100);}if(!port)throw Error('Headless Chrome unavailable');
    const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});let id=0;const pending=new Map();
    socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);const task=pending.get(m.id);if(task){pending.delete(m.id);m.error?task.reject(m.error):task.resolve(m.result);}};
    const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timeout=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout '+method));},15000);pending.set(key,{resolve:r=>{clearTimeout(timeout);resolve(r);},reject:e=>{clearTimeout(timeout);reject(e);}});socket.send(JSON.stringify({id:key,method,params}));});
    const evaluate=async expression=>{const response=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);return response.result.value;};
    const until=async expression=>{for(let i=0;i<80;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Condition timed out: '+expression+' '+await evaluate('JSON.stringify({feedback:document.getElementById("plinko-feedback")?.textContent,hidden:document.hidden,proof:document.getElementById("plinko-proof")?.textContent,button:document.getElementById("plinko-play")?.textContent,disabled:document.getElementById("plinko-play")?.disabled})')); };
    await call('Runtime.enable');await call('Network.enable');await call('Network.setBlockedURLs',{urls:['*islepilot.eu*','*steamcommunity.com*','*api.steampowered.com*']});
    for(const width of [1440,768,390,320]){
      await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await call('Page.navigate',{url:origin+'/plinko.html?qa='+width});await until(`location.search==='?qa=${width}' && document.readyState==='complete' && typeof App!=='undefined' && App.authResolved && document.querySelectorAll('#plinko-slots button').length===17 && !document.getElementById('plinko-play').disabled`);await evaluate('document.fonts.ready.then(()=>true)');
      const metric=JSON.parse(await evaluate(`JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,slots:document.querySelectorAll("#plinko-slots button").length,menuLinks:Array.from(document.links).filter(a=>a.getAttribute("href")==="plinko.html").length})`));assert(metric.scroll<=metric.width,JSON.stringify(metric));assert(metric.menuLinks>=2);metrics.push(metric);
      const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,`plinko-${width}.png`),Buffer.from(shot.data,'base64'));
    }
    await evaluate('document.getElementById("plinko-form").requestSubmit()');await until('document.querySelector("#plinko-history [data-proof]")!==null');assert.equal(playCount,0,'Demo must never call game wallet');
    await evaluate('document.querySelector("#plinko-history [data-proof]").click()');await until('document.getElementById("plinko-proof").textContent.includes(String.fromCharCode(34)+"verified"+String.fromCharCode(34)+": true")');
    for(const rows of [8,12,16])for(const risk of engine.risks){await evaluate(`document.getElementById('plinko-rows').value='${rows}';document.getElementById('plinko-risk').value='${risk}';document.getElementById('plinko-rows').dispatchEvent(new Event('change'))`);assert.equal(await evaluate('document.querySelectorAll("#plinko-slots button").length'),rows+1);}
    await evaluate('document.getElementById("plinko-mode").value="wallet";document.getElementById("plinko-mode").dispatchEvent(new Event("change"));document.getElementById("plinko-form").requestSubmit()');await until('document.getElementById("plinko-feedback").textContent.includes("vào ví game")');assert.equal(playCount,1);assert.equal(prepareCount,1);await until('!document.getElementById("plinko-play").disabled && !document.getElementById("plinko-auto").disabled');
    await evaluate('document.getElementById("plinko-auto").click();document.getElementById("plinko-count").value="2";document.getElementById("plinko-form").requestSubmit()');await until('!document.getElementById("plinko-play").disabled');assert.equal(playCount,3,'Auto mode must finish both balls: '+await evaluate('JSON.stringify({feedback:document.getElementById("plinko-feedback").textContent,auto:document.getElementById("plinko-auto").getAttribute("aria-pressed"),valid:document.getElementById("plinko-form").checkValidity(),count:document.getElementById("plinko-count").value})')); 
    await evaluate('document.querySelector("#plinko-history [data-proof]").click()');await until('document.getElementById("plinko-proof").textContent.includes(String.fromCharCode(34)+"verified"+String.fromCharCode(34)+": true")');assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({scope:'offline fixtures; no real wallet operations',metrics,prepareCount,playCount,errors},null,2));console.log('PASS Plinko browser: four responsive widths, demo has zero wallet calls, 12 risk/row switches, HMAC proofs, wallet UI, two-ball auto sequence, no JS errors');await call('Browser.close');
  }finally{if(errors.length)console.log(JSON.stringify(errors));socket?.close();child.kill();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
