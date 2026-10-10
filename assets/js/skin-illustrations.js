/* Species-specific supplied illustrations, loaded only when selected and visible. */
(() => {
  const stage=document.getElementById('dino-stage');
  if(!stage || !window.ST25IllustrationCatalog) return;
  const catalog=window.ST25IllustrationCatalog;
  const loading=document.createElement('span');loading.className='skin-motion-loading';
  loading.setAttribute('role','status');loading.hidden=true;stage.append(loading);
  let effective='2d', frame=null, visible=false, disposed=false,lastPalette='';
  const fallback=document.getElementById('dino-svg-wrapper');
  function sendColors() {
    if(frame?.dataset.ready!=='true')return;
    const colors=getSkinPayload().colors,signature=JSON.stringify(colors);
    if(signature===lastPalette)return;lastPalette=signature;
    frame.contentWindow.postMessage({type:'st25-illustration-colors',colors},'*');
  }

  function removeFrame() { frame?.remove();frame=null;lastPalette='';loading.hidden=true; }
  function mount(species,entry) {
    if(frame?.dataset.species===species || !visible || document.hidden || disposed) return;
    removeFrame();
    frame=document.createElement('iframe');
    frame.id='skin-motion-frame';frame.className='skin-motion-frame';
    frame.title=`${species} · Minh họa chuyển động từ ảnh`;
    frame.dataset.species=species;frame.setAttribute('sandbox','allow-scripts');
    loading.textContent=`Đang tải minh họa ${species}…`;loading.hidden=false;
    frame.addEventListener('error',()=>{loading.textContent='Chưa tải được minh họa. Hãy chọn lại loài để thử tải lại.';});
    frame.src=`/illustrations/${entry.file}?embed=1`;
    stage.append(frame);
  }
  function sync() {
    if(disposed) return;
    const species=getSkinPayload().species;
    const entry=Object.hasOwn(catalog,species) ? catalog[species] : null;
    effective=entry ? 'motion' : '2d';
    stage.dataset.previewMode=effective;
    fallback.hidden=effective==='motion';
    const note=document.querySelector('.skin-preview-note');
    if(note) note.textContent=effective==='motion'
      ? `${species} · Phân vùng màu gần đúng trên ảnh minh họa; màu trong game có thể khác.`
      : 'Bản phối màu 2D minh họa · Kết quả trong game có thể khác.';
    if(effective==='motion') mount(species,entry);
    else removeFrame();
    sendColors();
  }
  window.addEventListener('message',event=>{
    if(!frame || event.source!==frame.contentWindow || !event.data?.type) return;
    if(event.data.type==='st25-illustration-palette'){
      for(const key of ['revision','changedPixels','checksum'])frame.dataset[key]=String(event.data[key]);
      return;
    }
    if(event.data.type!=='st25-illustration-ready')return;
    frame.dataset.ready=String(!!event.data.image);
    frame.dataset.rendered=String(!!event.data.rendered);
    frame.dataset.reportedSpecies=event.data.species;
    loading.hidden=!!event.data.image;
    sendColors();
    if(!event.data.image) loading.textContent='Ảnh minh họa chưa tải được. Hãy chọn lại loài để thử tải lại.';
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
  window.ST25SkinIllustrations={sync,get mode(){return effective;}};
  sync();
})();
