/* Approximate illustration masks, independent of the game's unavailable UV masks. */
(() => {
  const image=document.getElementById('fallback');
  const species=document.title.split(' •')[0];
  const defaults=['#897559','#352f2a','#594a35','#d3b48b','#000000','#6c3729','#ffdfcb','#e8e2d0','#7a3b3b','#3a3a3a'];
  const channels=['body','markings','flank','underbelly','detail1','male_display','eyes','teeth','mouth','claws'];
  const profiles={
    Tyrannosaurus:{flank:[.51,.43,.18,.19],belly:[.46,.56,.18,.07],eye:[.155,.107,.009,.01],mouth:[.11,.255,.096,.025],teeth:[.078,.26,.071,.014],display:[.19,.069,.08,.025],claws:[[.415,.932,.095,.037],[.586,.947,.072,.033],[.347,.572,.025,.035]]},
    Triceratops:{flank:[.54,.42,.23,.2],belly:[.53,.68,.18,.055],eye:[.224,.368,.009,.015],mouth:[.131,.562,.051,.025],teeth:[.135,.573,.02,.016],display:[.295,.191,.1,.19],claws:[[.405,.977,.05,.021],[.335,.973,.04,.022],[.594,.948,.043,.025],[.696,.952,.04,.026]]},
    Troodon:{flank:[.42,.41,.18,.14],belly:[.361,.526,.15,.051],eye:[.154,.078,.012,.016],mouth:[.092,.151,.081,.012],teeth:[.052,.155,.026,.006],display:[.183,.039,.047,.016],claws:[[.51,.965,.036,.028],[.364,.954,.063,.027],[.305,.684,.019,.055]]}
  };
  const profile=profiles[species];if(!profile)return;
  let original,zones,canvas,context,pending={},scheduled=0,revision=0;
  const ellipse=(u,v,e)=>((u-e[0])/e[2])**2+((v-e[1])/e[3])**2<1;
  function prepare() {
    if(!image.naturalWidth)return;
    canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return;
    context.drawImage(image,0,0);original=context.getImageData(0,0,canvas.width,canvas.height);
    zones=new Uint8Array(canvas.width*canvas.height);
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const i=y*canvas.width+x;if(!original.data[i*4+3])continue;
      const u=x/canvas.width,v=y/canvas.height;let zone=0;
      if(ellipse(u,v,profile.flank))zone=2;
      if(v<profile.belly[1] && u>.28 && Math.sin(u*64+v*11)>.65)zone=1;
      if(ellipse(u,v,profile.belly))zone=3;
      if((Math.floor(x/5)+Math.floor(y/5)*7)%61===0 && zone<3)zone=4;
      if(ellipse(u,v,profile.display))zone=5;
      if(ellipse(u,v,profile.mouth))zone=8;
      if(ellipse(u,v,profile.teeth))zone=7;
      if(ellipse(u,v,profile.eye))zone=6;
      if(profile.claws.some(e=>ellipse(u,v,e)))zone=9;
      zones[i]=zone;
    }
    apply();
  }
  function apply() {
    scheduled=0;if(!original)return;
    const colors=channels.map((key,i)=>/^#[0-9a-f]{6}$/i.test(pending[key]||'')?pending[key].toLowerCase():defaults[i]);
    const changed=colors.map((color,i)=>color!==defaults[i]);
    const rgb=colors.map(color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)));
    const output=new ImageData(new Uint8ClampedArray(original.data),canvas.width,canvas.height);
    let changedPixels=0,checksum=0;
    for(let i=0;i<zones.length;i++){
      const at=i*4;if(!output.data[at+3])continue;
      const zone=zones[i];
      if(changed[zone]){
        const shade=.24+(original.data[at]*.2126+original.data[at+1]*.7152+original.data[at+2]*.0722)/255;
        for(let c=0;c<3;c++)output.data[at+c]=original.data[at+c]*.12+Math.min(255,rgb[zone][c]*shade)*.88;
        changedPixels++;
      }
      checksum=(checksum+output.data[at]*3+output.data[at+1]*5+output.data[at+2]*7)>>>0;
    }
    context.putImageData(output,0,0);window.ST25PaletteSource=canvas;
    // The fallback also updates when canvas drawing is unavailable.
    image.style.animationPlayState=document.getElementById('play').textContent==='Tiếp tục'?'paused':'running';
    parent.postMessage({type:'st25-illustration-palette',revision:++revision,changedPixels,checksum},'*');
  }
  window.addEventListener('message',event=>{
    if(event.source!==parent || event.data?.type!=='st25-illustration-colors')return;
    pending=event.data.colors||{};
    if(!scheduled)scheduled=requestAnimationFrame(apply);
  });
  if(image.complete)prepare();else image.addEventListener('load',prepare,{once:true});
})();
