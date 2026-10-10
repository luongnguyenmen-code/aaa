(() => {
  const $=id=>document.getElementById(id),names={red:'Đỏ',black:'Đen',green:'Xanh'},multipliers={red:2,black:2,green:14};
  const statuses={debit_pending:'Đang đối soát tiền gửi',placed:'Đã gửi',credit_pending:'Đang đối soát tiền trả',settled:'Đã kết thúc',review:'Cần đối soát — liên hệ hỗ trợ'};
  let data,busy=false,reading=false,settling=false,timer,clock,offset=0,animation,animationKey='',trackPosition=15,lastHistory='',completedRound,demoBet,disposed=false,lastAccount,lastOwnSignature,closeRequested;
  const esc=value=>App.escapeHTML(value),amount=()=>$('roll-amount'),color=()=>document.querySelector('input[name=color]:checked').value;
  const money=value=>Number(value).toLocaleString('vi-VN')+' Lúa';
  const order=[1,8,2,9,3,10,4,0,11,5,12,6,13,7,14];
  $('roll-track').innerHTML=Array.from({length:120},(_,i)=>{const n=order[i%15],c=n===0?'green':n<=7?'red':'black';return `<span class="roll-tile ${c}">${n}</span>`;}).join('');
  $('roll-track').style.transform=`translateX(${-35-trackPosition*76}px)`;
  function reelMetrics(){const tiles=$('roll-track').children,width=tiles[0].getBoundingClientRect().width,step=tiles[1].getBoundingClientRect().left-tiles[0].getBoundingClientRect().left;return {half:width/2,step:step||76};}
  function feedback(text){$('roll-feedback').textContent=text;}
  function ownBet(){return data?.bets.find(b=>Number(b.round_id)===data.round.id);}
  function quote(){const value=Math.max(0,Number(amount().value)||0),total=Math.min(value*(data?.rules?.payouts?.[color()]??multipliers[color()]),color()==='green'?(data?.rules?.maxGreenPayout??1000):Infinity);$('roll-quote').textContent=`Thắng: nhận tổng ${money(total)} · Lãi ${money(total-value)}`;}
  function updateClock(){
    if(!data)return;
    const now=Date.now()+offset,open=now<data.round.closesAt,seconds=Math.max(0,((open?data.round.closesAt:data.round.endsAt)-now)/1000);
    $('roll-clock').textContent=seconds.toFixed(2)+'s';$('roll-phase').textContent=open?'Chọn màu và đặt cược Lúa':'';
    $('roll-clock').hidden=!open;$('roll-phase').hidden=!open;
    document.querySelector('.roll-arena').classList.toggle('is-spinning',!open);
    if(!open&&now<data.round.endsAt){
      if(Number.isInteger(data.round.result))animate(90+order.indexOf(data.round.result),Math.max(0,data.round.endsAt-now),'result:'+data.round.id,true);
      else{animate(75,900,'spin:'+data.round.id);if(!reading&&!busy&&closeRequested!==data.round.id){closeRequested=data.round.id;clearTimeout(timer);refresh();}}
    }
    const bet=ownBet(),locked=bet&&bet.status!=='placed';
    $('roll-submit').disabled=busy||!open||(!data.demo&&(!data.ready||!data.authenticated||locked));
    $('roll-submit').textContent=busy?'Đang xử lý…':!open?'Chờ vòng tiếp theo':(!data.ready&&!data.demo)?'Tạm đóng bảo trì':!data.authenticated?'Liên kết Steam để cược':bet?'Đổi màu cược':data.demo?'Thử Roll miễn phí':'Đặt cược bằng Lúa';
    amount().disabled=busy||!!bet;
    document.querySelectorAll('[data-amount]').forEach(b=>b.disabled=busy||!!bet);
    document.querySelectorAll('input[name=color]').forEach(x=>x.disabled=busy||!open||!!locked);
    renderTotals();
  }
  const cycle=value=>15+((value%15)+15)%15;
  const rollEasing='cubic-bezier(0.1, 0.8, 0.1, 1)';
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let winnerTimer;
  function clearWinner(){
    clearTimeout(winnerTimer);
    winnerTimer=undefined;
    $('roll-track').querySelectorAll('.winner').forEach(tile=>tile.classList.remove('winner'));
  }
  function highlightWinner(){
    clearWinner();
    $('roll-track').children[Math.round(trackPosition)]?.classList.add('winner');
  }
  function paint(position){
    const {half,step}=reelMetrics();
    $('roll-track').style.transform='translateX('+(-half-position*step)+'px)';
  }
  function stopMotion(){
    clearWinner();
    const track=$('roll-track'),{half,step}=reelMetrics();
    if(animation){
      const transform=getComputedStyle(track).transform;
      if(transform!=='none')trackPosition=cycle((-half-new DOMMatrixReadOnly(transform).m41)/step);
      animation.cancel();animation=undefined;
    }
    document.querySelector('.roll-arena').classList.remove('is-revealing');paint(trackPosition);
  }
  function animate(target,duration,key,timed=false){
    if(animationKey===key)return;
    animationKey=key;stopMotion();
    // Wait for the authoritative result rather than changing speed between two curves.
    if(key.startsWith('spin:'))return;
    const revealedRound=data?.round?.id===Number(key.slice(7))?{...data.round}:null;
    const slot=target%15,from=cycle(trackPosition),arena=document.querySelector('.roll-arena');
    if(!duration||document.hidden||reducedMotion.matches){
      trackPosition=15+slot;paint(trackPosition);
      if(!document.hidden){
        if(duration)winnerTimer=setTimeout(()=>{if(animationKey===key){highlightWinner();publishResult(revealedRound);if(typeof checkSettle==='function')checkSettle();}},duration);
        else{highlightWinner();publishResult(revealedRound);if(typeof checkSettle==='function')checkSettle();}
      }
      return;
    }
    target=Math.ceil((from+60-slot)/15)*15+slot;
    const {half,step}=reelMetrics();
    const transform=position=>'translateX('+(-half-position*step)+'px)';
    paint(from);trackPosition=target;paint(target);
    const running=$('roll-track').animate([{transform:transform(from)},{transform:transform(target)}],
      {duration,easing:rollEasing,fill:'none'});
    animation=running;arena.classList.add('is-revealing');
    running.finished.then(()=>{
      if(animation!==running)return;
      animation=undefined;trackPosition=cycle(target);paint(trackPosition);
      arena.classList.remove('is-revealing');
      highlightWinner();publishResult(revealedRound);
      if(typeof checkSettle==='function')checkSettle();
    }).catch(()=>{});
  }
  function publishResult(round){
    if(!round||!Number.isInteger(round.result))return;
    completedRound=round;
    renderHistory();
    if(typeof checkBigWins==='function')checkBigWins(round);
  }
  function renderHistory(){
    if(!data)return;
    const activeId=animation||winnerTimer!==undefined?Number(animationKey.slice(7)):null;
    const history=[...(completedRound?[completedRound]:[]),...data.history]
      .filter((round,index,all)=>round.id!==activeId&&all.findIndex(other=>other.id===round.id)===index)
      .sort((a,b)=>b.id-a.id).slice(0,14);
    const historyKey=JSON.stringify(history.map(x=>[x.id,x.result]));
    if(historyKey!==lastHistory){
      lastHistory=historyKey;
      $('roll-history').innerHTML=history.map(x=>`<span class="roll-dot ${x.color}" title="Vòng ${x.number??x.id}: ${names[x.color]} ${x.result}">${x.result}</span>`).join('');
      $('roll-counts').innerHTML=['red','black','green'].map(c=>`<span><i class="roll-dot ${c}" style="width:6px;height:6px"></i>${history.filter(x=>x.color===c).length}</span>`).join('');
      const last=history[0];if(last){
        $('roll-result').textContent=`Vòng ${last.number??last.id}: ${names[last.color]} · Số ${last.result}`;
        if(!animation&&Date.now()+offset<data.round.closesAt)animate(90+order.indexOf(last.result),0,'result:'+last.id,true);
      }
      if(demoBet&&last?.id===demoBet.roundId){const won=last.color===demoBet.color;feedback(won?'Thử miễn phí: bạn chọn đúng màu! Không cộng Lúa.':'Thử miễn phí: chưa trúng màu. Không trừ Lúa.');demoBet=null;}
    }
  }
  function render(){
    $('roll-notice').textContent=data.message;$('roll-round').textContent=data.round.number??data.round.id;
    amount().max=data.rules?.maxBet||500;
    $('roll-login').hidden=data.authenticated;$('roll-balance').textContent=Number.isFinite(data.balance)?money(data.balance):'—';
    renderHistory();
    renderTotals();
    const bet=ownBet();
    $('roll-own-bet').textContent=bet?`Bạn cược ${money(bet.amount)} vào ${names[bet.color]} · ${statuses[bet.status]}`:'Bạn chưa cược vòng này.';
    const signature=bet?JSON.stringify([bet.id,bet.amount,bet.color]):'';
    if(bet&&signature!==lastOwnSignature){amount().value=bet.amount;document.querySelector(`input[name=color][value=${bet.color}]`).checked=true;}lastOwnSignature=signature;
    $('roll-my-history').innerHTML=data.bets.length?data.bets.map(b=>`<tr><td>${b.round_number??Number(b.round_id)}</td><td>${names[b.color]||'—'}</td><td>${money(b.amount)}</td><td>${b.status==='settled'?money(b.payout):'—'}</td><td>${esc(statuses[b.status]||b.status)}</td></tr>`).join(''):`<tr><td colspan="5">${data.authenticated?'Chưa có cược bằng Lúa.':'Liên kết Steam để xem lịch sử cược.'}</td></tr>`;
    quote();updateClock();
  }
  const communityDinos=[
    {name:'Rex_NamDinh',avatar:'🦖'},{name:'Giga_Hunter_VN',avatar:'🦕'},{name:'Carno_Speed',avatar:'🐊'},
    {name:'Spino_Gateway',avatar:'🦎'},{name:'Deino_Swamp',avatar:'🐊'},{name:'Raptor_Alpha',avatar:'🦅'},
    {name:'Stego_Tanker',avatar:'🛡️'},{name:'Trike_Leader',avatar:'🦏'},{name:'Allo_SanMoi',avatar:'🥩'},
    {name:'Cerato_Chunky',avatar:'🍖'},{name:'Pachy_Bonk',avatar:'💥'},{name:'Maia_Runner',avatar:'🏃'},
    {name:'Ptera_Cliffs',avatar:'🪶'},{name:'Troodon_Night',avatar:'🌙'},{name:'Survivor_F7',avatar:'🌴'},
    {name:'Long_Bien_Raptor',avatar:'⚡'},{name:'Dino_Gamer_VN',avatar:'🎮'},{name:'BaoChua_F6',avatar:'🦖'}
  ];
  function getCommunityBets(roundId){
    if(!roundId)return [];
    let s=(roundId^0x5f3759df)>>>0;
    const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
    const count=5+Math.floor(rnd()*5);
    const bets=[],amounts=[10,20,25,50,50,100,100,150,200,250,500],used=new Set();
    for(let i=0;i<count;i++){
      const idx=Math.floor(rnd()*communityDinos.length);
      if(used.has(idx))continue;
      used.add(idx);
      const player=communityDinos[idx],rc=rnd();
      const color=rc<0.45?'red':rc<0.90?'black':'green';
      const amount=amounts[Math.floor(rnd()*amounts.length)];
      const delay=1200+rnd()*11500;
      bets.push({name:player.name,avatar:player.avatar,color,amount,delay});
    }
    return bets;
  }
  let lastTotalsSig='';
  function renderTotals(){
    if(!data)return;
    const now=Date.now()+offset,open=now<data.round.closesAt,elapsed=Math.max(0,now-data.round.startsAt);
    const community=getCommunityBets(data.round.id).filter(b=>!open||b.delay<=elapsed);
    const own=ownBet();
    const sig=JSON.stringify([data.round.id,community.length,own?.id,own?.amount,own?.color,data.activeBets?.length||0]);
    if(sig===lastTotalsSig)return;
    lastTotalsSig=sig;
    const activeMap=data.activeBets||[];
    const userSteam=App.user?.steam_id||App.user?.steamId||null;
    $('roll-totals').innerHTML=['red','green','black'].map(c=>{
      const list=[];
      if(own&&own.color===c)list.push({name:'Bạn (Tôi)',avatar:'⭐',amount:own.amount,isOwn:true});
      for(const b of activeMap){
        if(b.color===c&&(!userSteam||b.steam_id!==userSteam)){
          const shortId=b.steam_id?b.steam_id.slice(-4):'';
          list.push({name:shortId?('Người chơi #'+shortId):'Người chơi',avatar:'🎮',amount:b.amount,isOwn:false});
        }
      }
      for(const b of community){
        if(b.color===c)list.push(b);
      }
      const count=list.length;
      const sum=list.reduce((acc,x)=>acc+x.amount,0);
      return `<div class="roll-total ${c}">
        <div class="roll-total-head">
          <span class="roll-dot ${c}"></span>
          <span>${names[c]}</span>
          <small>${count}</small>
          <strong>${money(sum)}</strong>
        </div>
        <div class="roll-bets-scroll">
          ${count?list.map(b=>`<div class="roll-bet-entry ${b.isOwn?'is-own':''}">
            <span class="roll-bet-avatar">${b.avatar}</span>
            <span class="roll-bet-name">${esc(b.name)}</span>
            <strong class="roll-bet-val">+${money(b.amount)}</strong>
          </div>`).join(''):`<p class="roll-total-empty">Chưa có lượt gửi</p>`}
        </div>
      </div>`;
    }).join('');
  }
  async function post(url,body){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Không xử lý được yêu cầu.');return result;
    }catch(error){if(error.name==='AbortError')throw Error('Chưa nhận được xác nhận. Kiểm tra lịch sử gửi trước khi gửi lại.');throw error;}
    finally{clearTimeout(timeout);}
  }
  let bigWinTimer;
  function showBigWin(winnerName,amountVal,colorName,isOwn=false,avatar='🎉'){
    const box=$('roll-bigwin');if(!box)return;
    clearTimeout(bigWinTimer);
    const colorKey=colorName==='Đỏ'?'red':colorName==='Xanh'?'green':'black';
    box.className='roll-bigwin-toast'+(isOwn?' is-own':'');
    box.innerHTML=`<div class="roll-bigwin-icon">${avatar||(isOwn?'👑':'🎉')}</div><div class="roll-bigwin-body"><div class="roll-bigwin-tag">${isOwn?'🌟 BẠN TRÚNG LỚN! 🌟':'🎉 THÔNG BÁO TRÚNG LỚN 🎉'}</div><div class="roll-bigwin-text"><strong class="roll-bigwin-name">${esc(winnerName)}</strong> vừa thắng <strong class="roll-bigwin-amt">+${money(amountVal)}</strong> vào ô <span class="roll-bigwin-color ${colorKey}">${esc(colorName)}</span>!</div></div><button type="button" class="roll-bigwin-close" aria-label="Đóng">&times;</button>`;
    box.hidden=false;
    box.querySelector('.roll-bigwin-close')?.addEventListener('click',()=>{box.hidden=true;clearTimeout(bigWinTimer);});
    bigWinTimer=setTimeout(()=>{box.hidden=true;},6000);
  }
  let announcedRounds=new Set();
  function checkBigWins(round){
    if(!round||announcedRounds.has(round.id))return;
    announcedRounds.add(round.id);
    const winColor=round.color||(round.result===0?'green':round.result<=7?'red':'black');
    const community=getCommunityBets(round.id);
    let top=null,maxWin=0;
    for(const b of community){
      if(b.color===winColor){
        const payout=Math.min(b.amount*(winColor==='green'?14:2),winColor==='green'?1000:Infinity);
        if((payout>=100||winColor==='green')&&payout>maxWin){
          maxWin=payout;
          top={name:b.name,amount:payout,colorName:names[winColor],avatar:b.avatar};
        }
      }
    }
    const activeMap=data?.activeBets||[];
    const userSteam=App.user?.steam_id||App.user?.steamId||null;
    for(const b of activeMap){
      if(b.color===winColor&&(!userSteam||b.steam_id!==userSteam)){
        const payout=Math.min(b.amount*(winColor==='green'?14:2),winColor==='green'?1000:Infinity);
        if((payout>=100||winColor==='green')&&payout>maxWin){
          maxWin=payout;
          const shortId=b.steam_id?b.steam_id.slice(-4):'';
          top={name:shortId?('Người chơi #'+shortId):'Người chơi',amount:payout,colorName:names[winColor],avatar:'🎮'};
        }
      }
    }
    const own=ownBet();
    const ownWon=own&&own.color===winColor;
    if(!ownWon&&top){
      showBigWin(top.name,top.amount,top.colorName,false,top.avatar);
    }
  }
  async function checkSettle(){
    if(!data||settling||busy)return;
    const due=data.pendingCount>0||data.bets.some(b=>b.status==='placed'&&Number(b.round_id)<=data.round.id);
    if(!due)return;
    settling=true;
    try{
      const res=await post(ST25API.routes.rollSettle,{});
      if(res&&Number.isFinite(res.balance)){
        data.balance=res.balance;
        if(App.user)App.user.balance=res.balance;
        $('roll-balance').textContent=money(res.balance);
        const hudBalance=$('hud-balance');if(hudBalance)hudBalance.textContent=Number(res.balance).toLocaleString('vi-VN');
      }
      if(res?.bets?.length){
        for(const sb of res.bets){
          const idx=data.bets.findIndex(b=>b.id===sb.id);
          if(idx>=0)data.bets[idx]=sb;else data.bets.unshift(sb);
          if(sb.payout>0){
            feedback(`🎉 THẮNG ${money(sb.payout)}! Đã cộng ngay vào ví Lúa.`);
            if(sb.payout>=100||sb.color==='green'){
              showBigWin('Bạn',sb.payout,names[sb.color],true,'👑');
            }
          }
        }
        render();
      }
    }catch(e){
      if(e?.message)feedback(e.message);
    }finally{
      settling=false;
    }
  }
  async function refresh(){
    if(reading||busy||disposed||document.hidden)return;reading=true;
    const account=App.user?.steam_id||App.user?.steamId||null;
    try{
      const next=await App.readJSON(ST25API.routes.rollState);
      if(account!==(App.user?.steam_id||App.user?.steamId||null))return;
      data=next;offset=data.serverTime-Date.now();render();
      const due=data.pendingCount>0||data.bets.some(b=>b.status==='placed'&&Number(b.round_id)<=data.round.id);
      if(due&&!settling&&!busy){checkSettle();}
    }catch(e){$('roll-notice').textContent='Mất kết nối Roll. Đang thử kết nối lại…';$('roll-submit').disabled=true;data=null;}
    finally{reading=false;clearTimeout(timer);if(!disposed&&!document.hidden)timer=setTimeout(refresh,data&&Date.now()+offset>=data.round.closesAt?300:1000);}
  }
  $('roll-form').addEventListener('submit',async e=>{
    e.preventDefault();if(busy||!data||Date.now()+offset>=data.round.closesAt)return;
    if(!amount().checkValidity()){amount().reportValidity();return;}
    if(data.demo){demoBet={roundId:data.round.id,color:color()};feedback('Đã chọn '+names[color()]+' cho vòng thử miễn phí. Không sử dụng Lúa.');return;}
    if(!data.authenticated){location.href='lien-ket-steam.html';return;}
    busy=true;updateClock();feedback('Đang đặt cược…');
    const account=App.user?.steam_id||App.user?.steamId||null;
    const betAmt=Number(amount().value),betCol=color();
    try{
      const response=await post(ST25API.routes.rollBet,{roundId:data.round.id,color:betCol,amount:betAmt,requestId:crypto.randomUUID()});
      if(!data||account!==(App.user?.steam_id||App.user?.steamId||null))return;
      data.bets=[response.bet,...data.bets.filter(b=>b.id!==response.bet.id)];
      if(Number.isFinite(response.balance)){
        data.balance=response.balance;
        if(App.user)App.user.balance=response.balance;
        $('roll-balance').textContent=money(response.balance);
        const hudBalance=$('hud-balance');if(hudBalance)hudBalance.textContent=Number(response.balance).toLocaleString('vi-VN');
      }
      feedback(response.replayed?'Cược trước đã được ghi nhận.':`Đã trừ ${money(betAmt)}! Đặt cược vào ${names[betCol]} thành công.`);
      render();
    }catch(e){feedback(e.message);}finally{busy=false;updateClock();refresh();}
  });
  amount().addEventListener('input',()=>{const max=data?.rules?.maxBet||500;if(amount().value&&Number(amount().value)>max)amount().value=max;quote();});
  amount().addEventListener('change',()=>{const max=data?.rules?.maxBet||500;let v=Math.floor(Number(amount().value));if(!Number.isFinite(v)||v<1)v=1;else if(v>max)v=max;amount().value=v;quote();});
  document.querySelectorAll('input[name=color]').forEach(x=>x.addEventListener('change',quote));
  document.querySelectorAll('.roll-choice').forEach(label=>label.addEventListener('click',e=>{if(e.target.tagName==='INPUT')return;queueMicrotask(()=>{if(!$('roll-submit').disabled)$('roll-form').requestSubmit();});}));
  document.querySelectorAll('[data-amount]').forEach(button=>button.addEventListener('click',()=>{
    const value=Number(amount().value)||1,cap=Math.min(data?.rules?.maxBet||500,Math.max(1,Math.floor(data?.balance??500)));
    amount().value=button.dataset.amount==='half'?Math.max(1,Math.floor(value/2)):button.dataset.amount==='double'?Math.min(cap,value*2):button.dataset.amount==='max'?cap:Math.min(cap,Number(button.dataset.amount));quote();
  }));
  const unsubscribe=App.subscribeUser(user=>{const account=user?.steam_id||user?.steamId||null;if(account!==lastAccount){lastAccount=account;data=null;$('roll-submit').disabled=true;refresh();}});
  function visibility(){clearTimeout(timer);clearInterval(clock);stopMotion();animationKey='';if(!document.hidden&&!disposed){clock=setInterval(updateClock,50);refresh();}}
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',()=>{disposed=true;clearTimeout(timer);clearInterval(clock);stopMotion();unsubscribe();document.removeEventListener('visibilitychange',visibility);},{once:true});
  clock=setInterval(updateClock,50);refresh();
})();
