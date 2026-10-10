/* Lazy-load WebGL only when the skin workspace is visible. */
(() => {
  const stage=document.getElementById('dino-stage');
  if(!stage)return;
  const fallback=document.getElementById('dino-svg-wrapper');
  const host=document.createElement('div');host.className='skin-3d-host';host.id='skin-3d-host';stage.prepend(host);
  const status=document.createElement('div');status.className='skin-3d-status';status.setAttribute('role','status');status.textContent='Đang chuẩn bị mô hình 3D…';stage.append(status);
  const hint=document.createElement('span');hint.className='skin-3d-hint';hint.textContent='Kéo để xoay · Cuộn / chụm để zoom';stage.append(hint);
  const toolbar=document.createElement('div');toolbar.className='skin-3d-toolbar';toolbar.setAttribute('aria-label','Điều khiển mô hình 3D');
  toolbar.innerHTML='<div><button type="button" data-view="studio" title="Đặt lại góc nhìn">↺ Góc studio</button><button type="button" data-view="side">Ngang</button><button type="button" data-view="front">Chính diện</button><button type="button" id="skin-auto-rotate" aria-pressed="false">Xoay tự động</button></div><div><label>Chất lượng <select id="skin-3d-quality"><option value="auto">Tự động</option><option value="low">Tiết kiệm</option><option value="high">Cao</option></select></label><button type="button" id="skin-export-image">↓ Ảnh PNG</button></div>';
  stage.after(toolbar);
  const lighting=document.createElement('label');lighting.className='skin-3d-light';lighting.innerHTML='Ánh sáng <input id="skin-3d-light" type="range" min="0.5" max="2.5" value="1.25" step="0.05"><output id="skin-3d-light-value">1.25</output>';
  toolbar.after(lighting);
  const retry=document.createElement('button');retry.type='button';retry.className='skin-3d-retry';retry.textContent='Thử tải 3D lại';retry.hidden=true;lighting.after(retry);
  const updateNote=()=>{const note=document.querySelector('.skin-preview-note');if(note)note.textContent='Mô hình 3D minh họa do ST25 tạo · Kết quả trong game có thể khác.';};
  updateNote();document.addEventListener('DOMContentLoaded',updateNote,{once:true});
  let viewer,loading=false,failed=false,disposed=false,presentationPaused=false;
  const currentState=()=>({...getSkinPayload(),mode:currentMode});
  function setStatus(message,state){
    status.textContent=message;host.dataset.state=state;status.classList.toggle('is-ready',state==='ready');stage.classList.toggle('has-3d',state==='ready');
    if(state==='lost'||state==='error'){fallback.hidden=false;host.style.visibility='hidden';retry.hidden=false;}
    if(state==='ready'){fallback.hidden=true;host.style.visibility='visible';retry.hidden=true;hint.textContent='Kéo để xoay · Cuộn / chụm để zoom';}
  }
  async function start(){
    if(viewer||loading||disposed||presentationPaused)return;
    loading=true;failed=false;setStatus('Đang tải trình xem 3D…','loading');
    try{
      const {SkinViewer}=await import('./skin-viewer.mjs?v=20261010-illustrations1');
      if(disposed)return;
      viewer=new SkinViewer(host,currentState(),setStatus);
      viewer.setPresentationPaused(presentationPaused);
      window.ST25Skin3D.viewer=viewer;
      fallback.hidden=true;
      for(const button of toolbar.querySelectorAll('button'))button.disabled=false;
    }catch(error){
      failed=true;fallback.hidden=false;setStatus('3D không khả dụng trên thiết bị này. Bản xem 2D vẫn dùng được.','error');
      hint.textContent='Xem màu 2D';for(const button of toolbar.querySelectorAll('button'))button.disabled=true;
      console.warn('ST25 3D fallback:',error.message);
    }finally{loading=false;}
  }
  window.ST25Skin3D={sync(){viewer?.setState(currentState());},viewer:null,start,
    setPresentationPaused(paused){presentationPaused=!!paused;viewer?.setPresentationPaused(paused);if(!paused&&!failed)start();}
  };
  host.addEventListener('viewerrotate',event=>document.getElementById('skin-auto-rotate').setAttribute('aria-pressed',String(event.detail)));
  retry.addEventListener('click',()=>{viewer?.dispose();viewer=null;window.ST25Skin3D.viewer=null;start();});
  for(const button of toolbar.querySelectorAll('button'))button.disabled=true;
  const visibility=new IntersectionObserver(entries=>{if(entries[0].isIntersecting&&!failed)start();},{rootMargin:'100px'});visibility.observe(stage);
  toolbar.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||!viewer)return;
    if(button.dataset.view)viewer.setView(button.dataset.view);
    if(button.id==='skin-auto-rotate')viewer.setAutoRotate(!viewer.autoRotate);
    if(button.id==='skin-export-image'){
      button.disabled=true;
      try{const blob=await viewer.exportPNG();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`ST25-${currentSpecies}-skin.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
      catch(error){App.showToast(error.message,'error');}finally{button.disabled=false;}
    }
  });
  document.getElementById('skin-3d-quality').addEventListener('change',event=>viewer?.setQuality(event.target.value));
  document.getElementById('skin-3d-light').addEventListener('input',event=>{document.getElementById('skin-3d-light-value').value=Number(event.target.value).toFixed(2);viewer?.setLight(event.target.value);});
  for(const id of ['skin-pattern-idx','skin-variation'])document.getElementById(id)?.addEventListener('input',()=>window.ST25Skin3D.sync());
  window.addEventListener('pagehide',event=>{if(!event.persisted){disposed=true;visibility.disconnect();}});
})();
