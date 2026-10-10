/* Species-specific supplied illustrations, loaded only when selected and visible. */
(() => {
  const stage=document.getElementById('dino-stage');
  if(!stage || !window.ST25IllustrationCatalog) return;
  const catalog=window.ST25IllustrationCatalog;
  const modes=document.createElement('div');
  modes.className='skin-preview-modes';modes.setAttribute('role','group');
  modes.setAttribute('aria-label','Chọn chế độ minh họa khủng long');
  modes.innerHTML='<button type="button" data-preview="3d" aria-pressed="true">Mô hình 3D</button><button type="button" data-preview="motion" aria-pressed="false">Minh họa chuyển động</button>';
  stage.before(modes);
  const loading=document.createElement('span');loading.className='skin-motion-loading';
  loading.setAttribute('role','status');loading.hidden=true;stage.append(loading);
  let preferred='3d', effective='3d', frame=null, visible=false, disposed=false;

  function removeFrame() { frame?.remove();frame=null;loading.hidden=true; }
  function mount(species,entry) {
    if(frame?.dataset.species===species || !visible || document.hidden || disposed) return;
    removeFrame();
    frame=document.createElement('iframe');
    frame.id='skin-motion-frame';frame.className='skin-motion-frame';
    frame.title=`${species} · Minh họa chuyển động từ ảnh`;
    frame.dataset.species=species;frame.setAttribute('sandbox','allow-scripts');
    loading.textContent=`Đang tải minh họa ${species}…`;loading.hidden=false;
    frame.addEventListener('error',()=>{loading.textContent='Chưa tải được minh họa. Hãy chọn Mô hình 3D.';});
    frame.src=`/illustrations/${entry.file}?embed=1`;
    stage.append(frame);
  }
  function sync() {
    if(disposed) return;
    const species=getSkinPayload().species;
    const entry=Object.hasOwn(catalog,species) ? catalog[species] : null;
    effective=preferred==='motion' && entry ? 'motion' : '3d';
    stage.dataset.previewMode=effective;
    for(const button of modes.querySelectorAll('button')) {
      button.setAttribute('aria-pressed',String(button.dataset.preview===effective));
      if(button.dataset.preview==='motion') {
        button.disabled=!entry;
        button.title=entry ? `Xem minh họa chuyển động ${species}` : `Chưa có minh họa chuyển động ${species}`;
      }
    }
    window.ST25Skin3D?.setPresentationPaused(effective==='motion');
    const note=document.querySelector('.skin-preview-note');
    if(note) note.textContent=effective==='motion'
      ? `${species} · Minh họa chuyển động từ ảnh gốc. Chọn Mô hình 3D để xem bảng màu đang phối.`
      : 'Mô hình 3D minh họa do ST25 tạo · Kết quả trong game có thể khác.';
    if(effective==='motion') mount(species,entry);
    else removeFrame();
  }
  function setMode(mode) {
    if(!['3d','motion'].includes(mode)) return;
    if(mode==='motion' && !Object.hasOwn(catalog,getSkinPayload().species)) return;
    preferred=mode;sync();
  }
  modes.addEventListener('click',event=>{
    const button=event.target.closest('button[data-preview]');
    if(button && !button.disabled) setMode(button.dataset.preview);
  });
  window.addEventListener('message',event=>{
    if(!frame || event.source!==frame.contentWindow || event.data?.type!=='st25-illustration-ready') return;
    frame.dataset.ready=String(!!event.data.image);
    frame.dataset.rendered=String(!!event.data.rendered);
    frame.dataset.reportedSpecies=event.data.species;
    loading.hidden=!!event.data.image;
    if(!event.data.image) loading.textContent='Ảnh minh họa chưa tải được. Hãy chọn Mô hình 3D.';
  });
  const visibility=new IntersectionObserver(entries=>{
    visible=entries[0].isIntersecting;
    if(!visible) removeFrame();
    else sync();
  },{rootMargin:'100px'});
  visibility.observe(stage);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)removeFrame();else sync();});
  document.addEventListener('DOMContentLoaded',sync,{once:true});
  window.addEventListener('pagehide',event=>{removeFrame();if(!event.persisted){disposed=true;visibility.disconnect();}});
  window.addEventListener('pageshow',sync);
  window.ST25SkinIllustrations={sync,setMode,get mode(){return effective;}};
  sync();
})();
