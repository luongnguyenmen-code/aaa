(() => {
  const $=id=>document.getElementById(id),names={red:'Đỏ',black:'Đen',green:'Xanh'},multipliers={red:2,black:2,green:14};
  const statuses={debit_pending:'Đang đối soát tiền gửi',placed:'Đã gửi',credit_pending:'Đang đối soát tiền trả',settled:'Đã kết thúc',review:'Cần đối soát — liên hệ hỗ trợ'};
  let data,busy=false,reading=false,settling=false,timer,clock,offset=0,animation,animationKey='',motion,trackPosition=15,lastHistory='',demoBet,disposed=false,lastAccount,lastOwnSignature,closeRequested;
  const esc=value=>App.escapeHTML(value),amount=()=>$('roll-amount'),color=()=>document.querySelector('input[name=color]:checked').value;
  const money=value=>Number(value).toLocaleString('vi-VN')+' Lúa';
  const order=[1,8,2,9,3,10,4,0,11,5,12,6,13,7,14];
  $('roll-track').innerHTML=Array.from({length:120},(_,i)=>{const n=order[i%15],c=n===0?'green':n<=7?'red':'black';return `<span class="roll-tile ${c}">${n}</span>`;}).join('');
  $('roll-track').style.transform=`translateX(${-35-trackPosition*76}px)`;
  function reelMetrics(){const tiles=$('roll-track').children,width=tiles[0].getBoundingClientRect().width,step=tiles[1].getBoundingClientRect().left-tiles[0].getBoundingClientRect().left;return {half:width/2,step:step||76};}
  function feedback(text){$('roll-feedback').textContent=text;}
  function ownBet(){return data?.bets.find(b=>Number(b.round_id)===data.round.id);}
  function quote(){const value=Number(amount().value),total=value*multipliers[color()];$('roll-quote').textContent=`Thắng: nhận tổng ${money(total)} · Lãi ${money(total-value)}`;}
  function updateClock(){
    if(!data)return;
    const now=Date.now()+offset,open=now<data.round.closesAt,seconds=Math.max(0,((open?data.round.closesAt:data.round.endsAt)-now)/1000);
    $('roll-clock').textContent=seconds.toFixed(2)+'s';$('roll-phase').textContent=open?'Chọn màu và gửi Lúa':'';
    $('roll-clock').hidden=!open;$('roll-phase').hidden=!open;
    document.querySelector('.roll-arena').classList.toggle('is-spinning',!open);
    if(!open&&now<data.round.endsAt){
      if(Number.isInteger(data.round.result))animate(90+order.indexOf(data.round.result),Math.max(0,data.round.endsAt-now),'result:'+data.round.id,true);
      else{animate(75,900,'spin:'+data.round.id);if(!reading&&!busy&&closeRequested!==data.round.id){closeRequested=data.round.id;clearTimeout(timer);refresh();}}
    }
    const bet=ownBet(),locked=bet&&bet.status!=='placed';
    $('roll-submit').disabled=busy||!open||(!data.demo&&(!data.authenticated||locked));
    $('roll-submit').textContent=busy?'Đang xử lý…':!open?'Chờ vòng tiếp theo':data.demo?'Thử Roll miễn phí':!data.authenticated?'Liên kết Steam để gửi':bet?'Đổi màu gửi':'Gửi bằng Lúa';
    amount().disabled=busy||!!bet;
    document.querySelectorAll('[data-amount]').forEach(b=>b.disabled=busy||!!bet);
    document.querySelectorAll('input[name=color]').forEach(x=>x.disabled=busy||!open||!!locked);
  }
  // Tile-space motion is rebased by full cycles without changing the visible slot.
  const cycle=value=>15+((value%15)+15)%15,cruiseSpeed=9;
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  function sampleMotion(now){
    if(!motion)return {position:trackPosition,velocity:0};
    const elapsed=Math.max(0,(now-motion.started)/1000);
    if(motion.spinning)return {position:motion.from+cruiseSpeed*elapsed,velocity:cruiseSpeed};
    if(motion.cruise!==undefined){
      if(elapsed<motion.cruise)return {position:motion.from+cruiseSpeed*elapsed,velocity:cruiseSpeed};
      const u=Math.min(1,(elapsed-motion.cruise)/motion.brake),p=motion.power;
      return {position:motion.from+cruiseSpeed*motion.cruise+cruiseSpeed*motion.brake*(u-Math.pow(u,p+1)/(p+1)),
        velocity:u===1?0:cruiseSpeed*(1-Math.pow(u,p))};
    }
    const u=Math.min(1,elapsed/motion.seconds),d=motion.target-motion.from,m=motion.velocity*motion.seconds;
    // Hermite curve preserves entry velocity and reaches zero velocity at the deadline.
    return {position:motion.from+m*u+(3*d-2*m)*u*u+(m-2*d)*u*u*u,
      velocity:u===1?0:(m+2*(3*d-2*m)*u+3*(m-2*d)*u*u)/motion.seconds};
  }
  function paint(position){
    const {half,step}=reelMetrics();
    $('roll-track').style.transform='translateX('+(-half-cycle(position)*step)+'px)';
  }
  function stopMotion(){
    cancelAnimationFrame(animation);animation=undefined;
    if(motion)trackPosition=cycle(sampleMotion(performance.now()).position);
    motion=null;document.querySelector('.roll-arena').classList.remove('is-revealing');paint(trackPosition);
  }
  function animate(target,duration,key,timed=false){
    if(animationKey===key)return;
    const now=performance.now(),current=sampleMotion(now),spinning=key.startsWith('spin:'),first=!animationKey;
    animationKey=key;cancelAnimationFrame(animation);
    const from=cycle(current.position),arena=document.querySelector('.roll-arena');
    arena.classList.remove('is-revealing');
    if(spinning){motion={spinning:true,from,started:now};}
    else{
      const slot=target%15,seconds=Math.max(0,duration/1000);
      if(!seconds||document.hidden||reducedMotion.matches||(first&&!timed)){
        trackPosition=15+slot;motion=null;paint(trackPosition);return;
      }
      // v*T/3 bounds entry velocity to keep the stop monotone with late results.
      const cruise=Math.max(0,seconds-4),brake=seconds-cruise;
      const brakeFrom=from+cruiseSpeed*cruise;
      const plannedTarget=Math.ceil((brakeFrom+cruiseSpeed*brake/2-slot)/15)*15+slot;
      const brakeDistance=plannedTarget-brakeFrom;
      if(brakeDistance<cruiseSpeed*brake){
        // Integral of 9*(1-u^p): exact target with continuous, decreasing velocity.
        const power=brakeDistance/(cruiseSpeed*brake-brakeDistance);
        motion={from,target:plannedTarget,seconds,cruise,brake,power,started:now};
      }else{
      // A very late server result may leave too little distance for a 9-tile/s stop.
      const distance=Math.max(1,current.velocity*seconds/3);
      target=Math.ceil((from+distance-slot)/15)*15+slot;
      const velocity=current.velocity||3*(target-from)/seconds;
      motion={spinning:false,from,target,seconds,velocity,started:now};
      }
      arena.classList.add('is-revealing');
    }
    function frame(time){
      if(disposed||document.hidden)return;
      paint(sampleMotion(time).position);
      if(!motion.spinning&&time>=motion.started+motion.seconds*1000){
        trackPosition=cycle(motion.target);motion=null;animation=undefined;
        arena.classList.remove('is-revealing');paint(trackPosition);return;
      }
      animation=requestAnimationFrame(frame);
    }
    animation=requestAnimationFrame(frame);
  }
  function render(){
    $('roll-notice').textContent=data.message;$('roll-round').textContent=data.round.id;
    $('roll-login').hidden=data.authenticated;$('roll-balance').textContent=Number.isFinite(data.balance)?money(data.balance):'—';
    const historyKey=JSON.stringify(data.history.map(x=>[x.id,x.result]));
    if(historyKey!==lastHistory){
      lastHistory=historyKey;
      $('roll-history').innerHTML=data.history.map(x=>`<span class="roll-dot ${x.color}" title="Vòng ${x.id}: ${names[x.color]} ${x.result}">${x.result}</span>`).join('');
      $('roll-counts').innerHTML=['red','black','green'].map(c=>`<span><i class="roll-dot ${c}" style="width:6px;height:6px"></i>${data.history.filter(x=>x.color===c).length}</span>`).join('');
      const last=data.history[0];if(last){
        $('roll-result').textContent=`Vòng ${last.id}: ${names[last.color]} · Số ${last.result}`;
        if(Date.now()+offset<data.round.closesAt)animate(90+order.indexOf(last.result),0,'result:'+last.id,true);
      }
      if(demoBet&&last?.id===demoBet.roundId){const won=last.color===demoBet.color;feedback(won?'Thử miễn phí: bạn chọn đúng màu! Không cộng Lúa.':'Thử miễn phí: chưa trúng màu. Không trừ Lúa.');demoBet=null;}
    }
    $('roll-totals').innerHTML=['red','green','black'].map(c=>{const total=data.totals.find(x=>x.color===c)||{amount:0,players:0},own=ownBet();return `<div class="roll-total ${c}"><div class="roll-total-head"><span class="roll-dot ${c}"></span><span>${names[c]}</span><small>${total.players}</small><strong>${money(total.amount)}</strong></div>${own?.color===c?`<div class="roll-total-own"><span>Bạn · ${esc(statuses[own.status])}</span><b>${money(own.amount)}</b></div>`:`<p class="roll-total-empty">${total.players?'Đã có lượt gửi trong vòng':'Chưa có lượt gửi'}</p>`}</div>`;}).join('');
    const bet=ownBet();
    $('roll-own-bet').textContent=bet?`Bạn gửi ${money(bet.amount)} vào ${names[bet.color]} · ${statuses[bet.status]}`:'Bạn chưa gửi vòng này.';
    const signature=bet?JSON.stringify([bet.id,bet.amount,bet.color]):'';
    if(bet&&signature!==lastOwnSignature){amount().value=bet.amount;document.querySelector(`input[name=color][value=${bet.color}]`).checked=true;}lastOwnSignature=signature;
    $('roll-my-history').innerHTML=data.bets.length?data.bets.map(b=>`<tr><td>${Number(b.round_id)}</td><td>${names[b.color]||'—'}</td><td>${money(b.amount)}</td><td>${b.status==='settled'?money(b.payout):'—'}</td><td>${esc(statuses[b.status]||b.status)}</td></tr>`).join(''):`<tr><td colspan="5">${data.authenticated?'Chưa có gửi bằng Lúa.':'Liên kết Steam để xem lịch sử gửi.'}</td></tr>`;
    quote();updateClock();
  }
  async function post(url,body){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Không xử lý được yêu cầu.');return result;
    }catch(error){if(error.name==='AbortError')throw Error('Chưa nhận được xác nhận. Kiểm tra lịch sử gửi trước khi gửi lại.');throw error;}
    finally{clearTimeout(timeout);}
  }
  async function refresh(){
    if(reading||busy||disposed||document.hidden)return;reading=true;
    const account=App.user?.steam_id||App.user?.steamId||null;
    try{
      const next=await App.readJSON(ST25API.routes.rollState);
      if(account!==(App.user?.steam_id||App.user?.steamId||null))return;
      data=next;offset=data.serverTime-Date.now();render();
      const due=data.pendingCount>0||data.bets.some(b=>b.status==='placed'&&Number(b.round_id)<data.round.id);
      if(due&&!settling&&!busy){settling=true;try{await post(ST25API.routes.rollSettle,{});}catch(e){feedback(e.message);}finally{settling=false;}}
    }catch(e){$('roll-notice').textContent='Mất kết nối Roll. Đang thử kết nối lại…';$('roll-submit').disabled=true;data=null;}
    finally{reading=false;clearTimeout(timer);if(!disposed&&!document.hidden)timer=setTimeout(refresh,data&&Date.now()+offset>=data.round.closesAt?300:2000);}
  }
  $('roll-form').addEventListener('submit',async e=>{
    e.preventDefault();if(busy||!data||Date.now()+offset>=data.round.closesAt)return;
    if(!amount().checkValidity()){amount().reportValidity();return;}
    if(data.demo){demoBet={roundId:data.round.id,color:color()};feedback('Đã chọn '+names[color()]+' cho vòng thử miễn phí. Không sử dụng Lúa.');return;}
    if(!data.authenticated){location.href='lien-ket-steam.html';return;}
    busy=true;updateClock();feedback('Đang gửi gửi…');
    const account=App.user?.steam_id||App.user?.steamId||null;
    try{
      const response=await post(ST25API.routes.rollBet,{roundId:data.round.id,color:color(),amount:Number(amount().value),requestId:crypto.randomUUID()});
      if(!data||account!==(App.user?.steam_id||App.user?.steamId||null))return;
      data.bets=[response.bet,...data.bets.filter(b=>b.id!==response.bet.id)];if(Number.isFinite(response.balance))data.balance=response.balance;
      feedback(response.replayed?'Gửi trước đã được ghi nhận.':'Đã ghi nhận gửi bằng Lúa.');render();
    }catch(e){feedback(e.message);}finally{busy=false;updateClock();refresh();}
  });
  amount().addEventListener('input',quote);document.querySelectorAll('input[name=color]').forEach(x=>x.addEventListener('change',quote));
  document.querySelectorAll('.roll-choice').forEach(label=>label.addEventListener('click',()=>queueMicrotask(()=>{if(!$('roll-submit').disabled)$('roll-form').requestSubmit();})));
  document.querySelectorAll('[data-amount]').forEach(button=>button.addEventListener('click',()=>{
    const value=Number(amount().value)||1,cap=Math.min(1000,Math.max(1,Math.floor(data?.balance||1000)));
    amount().value=button.dataset.amount==='half'?Math.max(1,Math.floor(value/2)):button.dataset.amount==='double'?Math.min(cap,value*2):button.dataset.amount==='max'?cap:Number(button.dataset.amount);quote();
  }));
  const unsubscribe=App.subscribeUser(user=>{const account=user?.steam_id||user?.steamId||null;if(account!==lastAccount){lastAccount=account;data=null;$('roll-submit').disabled=true;refresh();}});
  function visibility(){clearTimeout(timer);clearInterval(clock);stopMotion();animationKey='';if(!document.hidden&&!disposed){clock=setInterval(updateClock,50);refresh();}}
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',()=>{disposed=true;clearTimeout(timer);clearInterval(clock);stopMotion();unsubscribe();document.removeEventListener('visibilitychange',visibility);},{once:true});
  clock=setInterval(updateClock,50);refresh();
})();
