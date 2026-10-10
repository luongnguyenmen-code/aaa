(() => {
  const $=id=>document.getElementById(id),names={red:'Đỏ',black:'Đen',green:'Xanh'},multipliers={red:2,black:2,green:14};
  const statuses={debit_pending:'Đang đối soát tiền gửi',placed:'Đã gửi',credit_pending:'Đang đối soát tiền trả',settled:'Đã kết thúc',review:'Cần đối soát — liên hệ hỗ trợ'};
  let data,busy=false,reading=false,settling=false,timer,clock,offset=0,animation,animationKey='',lastHistory='',demoBet,disposed=false,lastAccount,lastOwnSignature;
  const esc=value=>App.escapeHTML(value),amount=()=>$('roll-amount'),color=()=>document.querySelector('input[name=color]:checked').value;
  const money=value=>Number(value).toLocaleString('vi-VN')+' Lúa';
  const order=[1,8,2,9,3,10,4,0,11,5,12,6,13,7,14];
  $('roll-track').innerHTML=Array.from({length:60},(_,i)=>{const n=order[i%15],c=n===0?'green':n<=7?'red':'black';return `<span class="roll-tile ${c}">${n}</span>`;}).join('');
  $('roll-track').style.transform='translateX(-35px)';
  function feedback(text){$('roll-feedback').textContent=text;}
  function ownBet(){return data?.bets.find(b=>Number(b.round_id)===data.round.id);}
  function quote(){const value=Number(amount().value),total=value*multipliers[color()];$('roll-quote').textContent=`Thắng: nhận tổng ${money(total)} · Lãi ${money(total-value)}`;}
  function updateClock(){
    if(!data)return;
    const now=Date.now()+offset,open=now<data.round.closesAt,seconds=Math.max(0,Math.ceil(((open?data.round.closesAt:data.round.endsAt)-now)/1000));
    $('roll-clock').textContent=seconds+'s';$('roll-phase').textContent=open?'ĐANG NHẬN GỬI':'ĐANG QUAY';
    const bet=ownBet(),locked=bet&&bet.status!=='placed';
    $('roll-submit').disabled=busy||!open||(!data.demo&&(!data.authenticated||locked));
    $('roll-submit').textContent=busy?'Đang xử lý…':!open?'Chờ vòng tiếp theo':data.demo?'Thử Roll miễn phí':!data.authenticated?'Liên kết Steam để gửi':bet?'Đổi màu gửi':'Gửi bằng Lúa';
    amount().disabled=busy||!!bet;
    document.querySelectorAll('[data-amount]').forEach(b=>b.disabled=busy||!!bet);
  }
  function animate(target,duration,key){
    if(animationKey===key)return;animationKey=key;
    const track=$('roll-track'),from=getComputedStyle(track).transform;
    animation?.cancel();const transform=`translateX(${-35-target*76}px)`;
    track.style.transform=transform;
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.hidden){animation=track.animate([{transform:from==='none'?'translateX(-35px)':from},{transform}],{duration,easing:'cubic-bezier(.12,.65,.18,1)'});}
  }
  function render(){
    $('roll-notice').textContent=data.message;$('roll-round').textContent=data.round.id;
    $('roll-login').hidden=data.authenticated;$('roll-balance').textContent=Number.isFinite(data.balance)?money(data.balance):'—';
    const historyKey=JSON.stringify(data.history.map(x=>[x.id,x.result]));
    if(historyKey!==lastHistory){
      lastHistory=historyKey;
      $('roll-history').innerHTML=data.history.map(x=>`<span class="roll-dot ${x.color}" title="Vòng ${x.id}: ${names[x.color]} ${x.result}">${x.result}</span>`).join('');
      const last=data.history[0];if(last){
        $('roll-result').textContent=`Vòng ${last.id}: ${names[last.color]} · Số ${last.result}`;
        animate(30+order.indexOf(last.result),900,'result:'+last.id);
      }
      if(demoBet&&last?.id===demoBet.roundId){const won=last.color===demoBet.color;feedback(won?'Thử miễn phí: bạn chọn đúng màu! Không cộng Lúa.':'Thử miễn phí: chưa trúng màu. Không trừ Lúa.');demoBet=null;}
    }
    if(data.round.phase==='spinning')animate(45,Math.max(200,data.round.endsAt-Date.now()-offset),'spin:'+data.round.id);
    $('roll-totals').innerHTML=['red','black','green'].map(c=>{const total=data.totals.find(x=>x.color===c)||{amount:0,players:0};return `<div class="roll-total"><span class="roll-dot ${c}">${multipliers[c]}x</span><div>${names[c]}<small>${total.players} người chơi</small></div><strong>${money(total.amount)}</strong></div>`;}).join('');
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
    finally{reading=false;clearTimeout(timer);if(!disposed&&!document.hidden)timer=setTimeout(refresh,2000);}
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
  document.querySelectorAll('[data-amount]').forEach(button=>button.addEventListener('click',()=>{
    const value=Number(amount().value)||1,cap=Math.min(1000,Math.max(1,Math.floor(data?.balance||1000)));
    amount().value=button.dataset.amount==='half'?Math.max(1,Math.floor(value/2)):button.dataset.amount==='double'?Math.min(cap,value*2):cap;quote();
  }));
  const unsubscribe=App.subscribeUser(user=>{const account=user?.steam_id||user?.steamId||null;if(account!==lastAccount){lastAccount=account;data=null;$('roll-submit').disabled=true;refresh();}});
  function visibility(){clearTimeout(timer);clearInterval(clock);animation?.cancel();animationKey='';if(!document.hidden&&!disposed){clock=setInterval(updateClock,250);refresh();}}
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',()=>{disposed=true;clearTimeout(timer);clearInterval(clock);animation?.cancel();unsubscribe();document.removeEventListener('visibilitychange',visibility);},{once:true});
  clock=setInterval(updateClock,250);refresh();
})();
