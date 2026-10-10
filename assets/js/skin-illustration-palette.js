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
  const contours={
    Tyrannosaurus:{flank:[[.32,.28],[.48,.25],[.65,.35],[.69,.46],[.60,.57],[.43,.58],[.34,.46]],belly:[[.23,.38],[.34,.47],[.48,.54],[.66,.48],[.62,.57],[.48,.62],[.32,.54],[.22,.43]]},
    Triceratops:{flank:[[.36,.28],[.52,.22],[.69,.28],[.76,.42],[.70,.59],[.53,.64],[.39,.55]],belly:[[.30,.57],[.46,.63],[.63,.63],[.74,.54],[.71,.67],[.56,.73],[.40,.69],[.30,.63]]},
    Troodon:{flank:[[.28,.28],[.38,.25],[.54,.34],[.59,.43],[.48,.53],[.33,.49]],belly:[[.22,.37],[.31,.46],[.45,.49],[.56,.43],[.49,.54],[.35,.58],[.25,.48]]}
  }[species];
  let original,zones,canvas,context,pending={},scheduled=0,revision=0;
  const ellipse=(u,v,e)=>((u-e[0])/e[2])**2+((v-e[1])/e[3])**2<1;
  function polygon(u,v,points) {
    let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const [ax,ay]=points[i],[bx,by]=points[j];
      if((ay>v)!==(by>v) && u<(bx-ax)*(v-ay)/(by-ay)+ax)inside=!inside;
    }
    return inside;
  }
  function prepare() {
    if(!image.naturalWidth)return;
    canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return;
    context.drawImage(image,0,0);original=context.getImageData(0,0,canvas.width,canvas.height);
    zones=new Uint8Array(canvas.width*canvas.height);
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const i=y*canvas.width+x;if(!original.data[i*4+3])continue;
      const u=x/canvas.width,v=y/canvas.height;let zone=0;
      const side=polygon(u,v,contours.flank);
      if(side)zone=2;
      // Curved bands follow the torso rather than a screen-aligned stripe grid.
      if(side && Math.sin(u*70+(v-profile.flank[1])**2*38)>.72)zone=1;
      if(polygon(u,v,contours.belly))zone=3;
      // A narrow dorsal band replaces the previous scattered square pixels.
      if(side && v<profile.flank[1]-.09 && Math.sin(u*105)>.2)zone=4;
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
    const radius=Math.max(1,Math.round(canvas.width/500));
    const offsets=[-radius,radius,-radius*canvas.width,radius*canvas.width];
    let changedPixels=0,checksum=0;
    for(let i=0;i<zones.length;i++){
      const at=i*4;if(!output.data[at+3])continue;
      const zone=zones[i],x=i%canvas.width,y=Math.floor(i/canvas.width);
      const shade=.24+(original.data[at]*.2126+original.data[at+1]*.7152+original.data[at+2]*.0722)/255;
      // Feather shared boundaries while retaining the small eye/teeth regions.
      let touched=changed[zone];
      for(let c=0;c<3;c++){
        const tint=region=>changed[region]?original.data[at+c]*.12+Math.min(255,rgb[region][c]*shade)*.88:original.data[at+c];
        let value=.6*tint(zone);
        for(let n=0;n<4;n++){
          const valid=n===0?x>=radius:n===1?x+radius<canvas.width:n===2?y>=radius:y+radius<canvas.height;
          const sample=i+offsets[n];
          const region=valid&&original.data[sample*4+3]?zones[sample]:zone;
          value+=.1*tint(region);touched ||= changed[region];
        }
        output.data[at+c]=value;
      }
      if(touched)changedPixels++;
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
