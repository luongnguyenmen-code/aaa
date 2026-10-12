(() => {
  const $=id=>document.getElementById('plinko-'+id),money=n=>Number(n).toLocaleString('vi-VN')+' Lúa',esc=s=>App.escapeHTML(String(s));
  let state,prepared,busy=false,automatic=false,stop=false,frame,disposed=false,games=[],ball=null,currentTable,finishAnimation,trail=[],impact=null;
  const canvas=$('board'),ctx=canvas.getContext('2d'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const boardLayer=document.createElement('canvas'),boardContext=boardLayer.getContext('2d');
  let motionEnabled=!reduced.matches;
  try{const preference=localStorage.getItem('st25-plinko-motion');if(preference!==null)motionEnabled=preference==='on'&&!reduced.matches;}catch{}
  function motionControl(){$('motion').textContent='Hiệu ứng: '+(motionEnabled&&!reduced.matches?'Bật':'Tắt');$('motion').setAttribute('aria-pressed',String(motionEnabled&&!reduced.matches));}
  motionControl();
  $('motion').onclick=()=>{motionEnabled=!(motionEnabled&&!reduced.matches);try{localStorage.setItem('st25-plinko-motion',motionEnabled?'on':'off');}catch{}motionControl();if(!motionEnabled)finishAnimation?.();};
  reduced.addEventListener('change',()=>{motionControl();if(reduced.matches)finishAnimation?.();});
  $('seed').value=crypto.randomUUID();
  const feedback=s=>$('feedback').textContent=s;
  const selected=()=>state?.tables.find(t=>t.rows===Number($('rows').value)&&t.risk===$('risk').value);
  async function post(url,body){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);try{const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});const data=await res.json();if(!res.ok)throw Error(data.error||'Không xử lý được yêu cầu.');return data;}catch(e){if(e.name==='AbortError')throw Error('Chưa nhận được xác nhận. Dừng chơi và kiểm tra lịch sử; không gửi lại.');throw e;}finally{clearTimeout(timeout);}}
  function controls(){document.querySelectorAll('#plinko-form input,#plinko-form select,#plinko-form button[data-size],.plinko-tabs button,#plinko-seed').forEach(e=>e.disabled=busy);$('play').disabled=busy||!currentTable||($('mode').value==='wallet'&&(!state?.ready||!state?.authenticated));$('stop').hidden=!busy||!automatic;$('play').textContent=busy?'Đang thả bóng…':automatic?'Bắt đầu tự động':'Thả bóng ↓';}
  function point(row,right){const step=42,dy=37,rows=Number($('rows').value);return{x:500+(2*right-row)*step/2,y:row===rows?canvas.height-8:50+row*dy};}
  function cacheBoard(){
    boardLayer.width=canvas.width;boardLayer.height=canvas.height;
    const rows=Number($('rows').value);
    for(let r=0;r<rows;r++)for(let k=-1;k<=r+1;k++){
      const p=point(r,k),edge=k<0||k>r;
      boardContext.beginPath();boardContext.arc(p.x,p.y,edge?2.5:3.7,0,2*Math.PI);
      boardContext.fillStyle=edge?'#5d425f':'#c4aac9';boardContext.fill();
      if(!edge){boardContext.beginPath();boardContext.arc(p.x-0.7,p.y-1,1.1,0,2*Math.PI);boardContext.fillStyle='#f8eafa';boardContext.fill();}
    }
  }
  function paint(){
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(boardLayer,0,0);
    if(impact){ctx.beginPath();ctx.arc(impact.x,impact.y,7+impact.phase*14,0,2*Math.PI);ctx.strokeStyle=`rgba(251,164,210,${(1-impact.phase)*0.7})`;ctx.lineWidth=2;ctx.stroke();}
    trail.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,2+i/trail.length*4,0,2*Math.PI);ctx.fillStyle=`rgba(255,130,189,${i/trail.length*0.3})`;ctx.fill();});
    if(ball){ctx.shadowBlur=18;ctx.shadowColor='#ff70b1';ctx.beginPath();ctx.arc(ball.x,ball.y,8,0,2*Math.PI);ctx.fillStyle='#ffb5d9';ctx.fill();ctx.shadowBlur=0;ctx.beginPath();ctx.arc(ball.x-2,ball.y-2,3,0,2*Math.PI);ctx.fillStyle='#fff0f7';ctx.fill();}
  }
  function renderTable(){currentTable=selected();if(!currentTable)return;const t=currentTable,amount=Number($('amount').value)||1;canvas.height=t.rows*37+110;canvas.style.aspectRatio='1000/'+canvas.height;$('slots').style.marginInline=((1000-(t.rows+1)*42)/20)+'%';$('slots').style.setProperty('--slots',t.multipliers.length);$('slots').innerHTML=t.multipliers.map((m,k)=>`<button type="button" style="--hue:${330-Math.abs(2*k/t.rows-1)*300}" title="Ô ${k+1}: ${(t.probabilities[k]*100).toFixed(6)}% · ${m}×" aria-label="Ô ${k+1}, hệ số ${m}, xác suất ${(t.probabilities[k]*100).toFixed(6)} phần trăm">${m>=1000?(m/1000).toFixed(1)+'k':m.toFixed(m<1?2:m<10?1:0).replace(/^0\./,".")}</button>`).join('');$('slots').querySelectorAll('button').forEach((b,k)=>b.onclick=()=>feedback(`Ô ${k+1} · ${t.multipliers[k]}× · xác suất ${(100*t.probabilities[k]).toFixed(6)}%`));const effective=t.probabilities.reduce((sum,p,k)=>sum+p*Math.floor(amount*t.multipliers[k])/amount,0);$('rtp').textContent=(t.rtp*100).toFixed(2)+'% · thực nhận '+(effective*100).toFixed(2)+'%';$('max').textContent=money(Math.floor(amount*Math.max(...t.multipliers)));$('odds').innerHTML=t.multipliers.map((m,k)=>`<tr><td>${k+1}</td><td>${(t.probabilities[k]*100).toFixed(6)}%</td><td>${m}×</td><td>${money(Math.floor(amount*m))}</td></tr>`).join('');ball=null;trail=[];impact=null;cacheBoard();paint();controls();}
  function history(){$('recent').innerHTML=games.filter(g=>g.status==='settled').slice(0,8).map(g=>`<span class="plinko-recent-chip ${g.multiplier>=1?'positive':''}" title="${g.demo?'Demo':'Lua'}">${esc(g.multiplier)}×</span>`).join('')||'<span>Lượt vừa chơi xuất hiện ở đây</span>';const statuses={settled:'Hoàn tất',review:'Cần đối soát',debit_pending:'Chờ xác nhận trừ',credit_pending:'Chờ xác nhận cộng'};$('history').innerHTML=games.length?games.slice(0,30).map((g,i)=>`<tr><td>${g.demo?'Thử miễn phí':'Lúa game'}</td><td>${money(g.amount)}</td><td>${g.multiplier}×</td><td>${g.status==='settled'?money(g.payout):'—'}</td><td>${statuses[g.status]||esc(g.status)}</td><td>${g.serverSeed?`<button type="button" data-proof="${i}">Kiểm tra</button>`:'—'}</td></tr>`).join(''):'<tr><td colspan="6">Chưa có lượt chơi.</td></tr>';$('history').querySelectorAll('[data-proof]').forEach(b=>b.onclick=()=>verify(games[Number(b.dataset.proof)]));}
  const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  async function browserDraw(seed,clientSeed,rows){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(seed),{name:'HMAC',hash:'SHA-256'},false,['sign']);const path=[];for(let r=1;r<=rows;r++){const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(clientSeed+':'+r));path.push(new DataView(digest).getUint32(0)<2**31?'L':'R');}return{path,slot:path.filter(d=>d==='R').length};}
  async function verify(g){try{const commitment=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(g.serverSeed)));const result=await browserDraw(g.serverSeed,g.clientSeed,g.rows);const table=state.tables.find(t=>t.rows===g.rows&&t.risk===g.risk),multiplier=table.multipliers[result.slot],payout=Math.floor(g.amount*multiplier);const valid=commitment===g.commitment&&result.slot===g.slot&&result.path.join('')===g.path.join('')&&multiplier===g.multiplier&&payout===g.payout;$('proof').textContent=JSON.stringify({verified:valid,mode:g.demo?'demo':'wallet',algorithm:g.algorithm,serverSeed:g.serverSeed,commitment:g.commitment,clientSeed:g.clientSeed,path:result.path.join(''),tile:result.slot+1,multiplier,payout},null,2);$('proof').closest('details').open=true;$('proof').scrollIntoView({block:'nearest'});}catch{feedback('Không xác minh được lượt này.');}}
  function animate(g){return new Promise(resolve=>{
    cancelAnimationFrame(frame);trail=[];impact=null;let start,finished=false;
    const duration=motionEnabled&&!reduced.matches&&!document.hidden?1800:0;
    let right=0;const points=[point(0,0)];g.path.forEach((d,r)=>{if(d==='R')right++;points.push(point(r+1,right));});
    const finish=()=>{if(finished)return;finished=true;cancelAnimationFrame(frame);finishAnimation=null;trail=[];impact=null;motionControl();
      if(!disposed){ball=points.at(-1);paint();$('slots').children[g.slot]?.classList.add('winner');$('result').classList.toggle('positive',g.payout>=g.amount);$('result').textContent=`Ô ${g.slot+1} · ${g.multiplier}× · ${g.demo?'Thử: ':'Nhận '}${money(g.payout)}`;}resolve();};
    finishAnimation=finish;$('result').classList.remove('positive');$('result').textContent='Đang thả bóng…';
    function tick(now){if(disposed||document.hidden||reduced.matches||!motionEnabled){finish();return;}if(start===undefined)start=now;
      const progress=duration?Math.max(0,Math.min(1,(now-start)/duration)):1,position=progress*g.rows,index=Math.min(g.rows-1,Math.floor(position)),p=progress===1?1:position-index;
      const a=points[index],b=points[index+1];ball={x:a.x+(b.x-a.x)*p,y:a.y+(b.y-a.y)*p-8*Math.sin(p*Math.PI)};
      trail.push({...ball});if(trail.length>8)trail.shift();impact=p<0.65?{...a,phase:p/0.65}:null;paint();
      if(progress<1)frame=requestAnimationFrame(tick);else finish();
    }tick(performance.now());
  });}
  function syncBalance(balance){if(!Number.isFinite(balance))return;$('balance').textContent=money(balance);if(state)state.balance=balance;if(App.user){App.user.balance=balance;App.publishUser();}}
  async function refresh(){const account=App.user?.steam_id||App.user?.steamId||null;const next=await App.readJSON(ST25API.routes.plinkoState);if(disposed||account!==(App.user?.steam_id||App.user?.steamId||null))return;state=next;$('balance').textContent=Number.isFinite(next.balance)?money(next.balance):'—';$('login').hidden=next.authenticated;$('notice').textContent=next.message;games=[...games.filter(g=>g.demo),...next.history].slice(0,30);history();renderTable();}
  async function drop(){const amount=Number($('amount').value),rows=Number($('rows').value),risk=$('risk').value,clientSeed=$('seed').value;if(!clientSeed)throw Error('Nhập client seed.');const account=App.user?.steam_id||App.user?.steamId||null;let game;
    if($('mode').value==='demo'){const serverSeed=hex(crypto.getRandomValues(new Uint8Array(32))),commitment=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serverSeed))),result=await browserDraw(serverSeed,clientSeed,rows),multiplier=currentTable.multipliers[result.slot];game={id:crypto.randomUUID(),demo:true,amount,rows,risk,clientSeed,serverSeed,commitment,...result,multiplier,payout:Math.floor(amount*multiplier),status:'settled',algorithm:'hmac-sha256-row-v1'};}
    else{prepared=await post(ST25API.routes.plinkoPrepare,{});$('proof').textContent='Cam kết trước lượt: '+prepared.commitment;const response=await post(ST25API.routes.plinkoPlay,{gameId:prepared.id,amount,rows,risk,clientSeed});if(account!==(App.user?.steam_id||App.user?.steamId||null))throw Error('Tài khoản đã thay đổi. Kiểm tra lịch sử.');game=response.game;if(game.commitment!==prepared.commitment)throw Error('Cam kết seed không khớp. Liên hệ hỗ trợ.');syncBalance(response.balance??game.balance);}
    games=[game,...games.filter(g=>g.id!==game.id)];await animate(game);history();feedback(game.demo?'Lượt thử hoàn tất. Không cộng/trừ Lúa.':`Đã trừ ${money(amount)}, cộng ${money(game.payout)} vào ví game.`);
  }
  $('form').addEventListener('submit',async e=>{e.preventDefault();if(busy||!currentTable)return;if(!$('form').reportValidity())return;const count=automatic?Number($('count').value):1;if(!Number.isInteger(count)||count<1||count>20)return;busy=true;stop=false;controls();try{for(let i=0;i<count&&!stop&&!disposed;i++){if(document.hidden){stop=true;break;}await drop();}}catch(e){feedback(e.message);stop=true;try{await refresh();}catch{}}finally{busy=false;controls();}});
  $('stop').onclick=()=>{stop=true;feedback('Sẽ dừng sau bóng hiện tại.');};
  for(const mode of ['manual','auto'])$(mode).onclick=()=>{automatic=mode==='auto';$('auto-options').hidden=!automatic;for(const x of ['manual','auto']){$(x).classList.toggle('selected',x===mode);$(x).setAttribute('aria-pressed',String(x===mode));}controls();};
  for(const id of ['risk','rows','amount'])$(id).addEventListener('change',renderTable);
  $('mode').onchange=()=>{$('mode-label').textContent=$('mode').value==='demo'?'THỬ MIỄN PHÍ':'VÍ LÚA TRONG GAME';feedback($('mode').value==='demo'?'Chế độ thử không sử dụng ví Lúa.':'Mỗi bóng trừ Lúa, nhận thưởng cộng vào ví game.');controls();};
  document.querySelectorAll('[data-size]').forEach(b=>b.onclick=()=>{const n=Number($('amount').value)||1;$('amount').value=b.dataset.size==='half'?Math.max(1,Math.floor(n/2)):b.dataset.size==='double'?Math.min(500,n*2):Math.min(500,Math.max(1,Math.floor(state?.balance??500)));renderTable();});
  let lastAccount;
  const unsubscribe=App.subscribeUser(()=>{const account=App.user?.steam_id||App.user?.steamId||null;if(account===lastAccount)return;lastAccount=account;prepared=null;games=[];state=null;if(!busy)refresh().catch(()=>{$('notice').textContent='Không kết nối được Plinko. Thử tải lại trang.';});else{stop=true;feedback('Tài khoản đã thay đổi. Kiểm tra lịch sử.');}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stop=true;finishAnimation?.();}});
  window.addEventListener('pagehide',()=>{disposed=true;stop=true;finishAnimation?.();cancelAnimationFrame(frame);unsubscribe();},{once:true});
  cacheBoard();paint();refresh().catch(()=>{$('notice').textContent='Không kết nối được Plinko. Thử tải lại trang.';});
})();
