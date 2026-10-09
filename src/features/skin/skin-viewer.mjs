import * as THREE from '../../../assets/vendor/three/three.module.min.mjs';
import { OrbitControls } from '../../../assets/vendor/three/OrbitControls.mjs';
import { createIllustration, disposeIllustration } from './skin-models.mjs';

export class SkinViewer {
  constructor(host, state, onStatus) {
    this.host=host; this.onStatus=onStatus; this.visible=false; this.frame=0; this.draws=0; this.disposed=false;
    this.autoRotate=false; this.lastFrame=0; this.state={}; this.cleanups=[];
    // Retain the last frame while demand rendering is idle (including scroll/capture).
    this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'low-power'});
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.25;
    this.canvas=this.renderer.domElement;
    this.canvas.id='skin-3d-canvas'; this.canvas.tabIndex=0;
    this.canvas.setAttribute('role','img');
    this.canvas.setAttribute('aria-label','Mô hình khủng long 3D. Kéo để xoay, cuộn hoặc dùng hai ngón tay để zoom. Phím mũi tên để xoay, cộng trừ để zoom.');
    host.append(this.canvas);
    this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(36,1,.05,80);
    this.camera.position.set(3.8,3.1,8.5);
    this.controls=new OrbitControls(this.camera,this.canvas);
    this.controls.target.set(0,1.4,0);
    this.controls.enablePan=false; this.controls.enableDamping=false;
    this.controls.minDistance=4.5;this.controls.maxDistance=20;
    this.controls.minPolarAngle=.2;this.controls.maxPolarAngle=Math.PI*.49;
    this.controls.rotateSpeed=.65;this.controls.zoomSpeed=.8;this.controls.update();
    this.listen(this.controls,'change',()=>this.invalidate());
    this.listen(this.controls,'start',()=>this.setAutoRotate(false));
    this.scene.add(new THREE.HemisphereLight(0xc8d7e5,0x625343,2.2));
    const key=new THREE.DirectionalLight(0xffe8c8,3.3);key.position.set(4,7,5);this.scene.add(key);
    const rim=new THREE.DirectionalLight(0x9fbfd9,2.8);rim.position.set(-4,4,-5);this.scene.add(rim);
    const fill=new THREE.DirectionalLight(0xffffff,1.1);fill.position.set(0,2,7);this.scene.add(fill);
    this.bump=this.makeScaleTexture();
    this.uniforms={};
    for(const key of ['body','markings','flank','underbelly']) this.uniforms[key]={value:new THREE.Color()};
    this.uniforms.pattern={value:0};this.uniforms.variation={value:0};
    const skin=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8,bumpMap:this.bump,bumpScale:.075});
    skin.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,{stBody:this.uniforms.body,stMark:this.uniforms.markings,stFlank:this.uniforms.flank,stBelly:this.uniforms.underbelly,stPattern:this.uniforms.pattern,stVariation:this.uniforms.variation});
      shader.vertexShader=shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 stUv;\nvarying vec3 stNormal;\nvarying vec3 stPosition;');
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nstUv=uv; stNormal=normal; stPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        varying vec2 stUv; varying vec3 stNormal; varying vec3 stPosition;
        uniform vec3 stBody; uniform vec3 stMark; uniform vec3 stFlank; uniform vec3 stBelly;
        uniform float stPattern; uniform float stVariation;
        float stNoise(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float belly=smoothstep(.15,.8,-stNormal.y);
        float flank=(1.0-abs(stNormal.y))*.65;
        vec3 hide=mix(stBody,stFlank,flank);
        float stripe=sin(stPosition.x*(12.0+stVariation*.5)+sin(stPosition.y*4.5+stPosition.z*5.0)*2.2);
        float mark=smoothstep(.45,.8,stripe)*smoothstep(-.4,.3,stNormal.y)*.85;
        if(stPattern>0.5 && stPattern<1.5) mark=smoothstep(.73,.84,stNoise(floor(stUv*vec2(32.0,46.0))))*.75;
        if(stPattern>1.5 && stPattern<2.5) mark=smoothstep(.25,.85,sin(stUv.y*28.0)*sin(stUv.x*19.0))*.8;
        if(stPattern>2.5 && stPattern<3.5) mark=smoothstep(.55,.85,stNormal.y)*.85;
        if(stPattern>3.5) mark=0.0;
        hide=mix(hide,stMark,mark); hide=mix(hide,stBelly,belly);
        diffuseColor.rgb*=hide;`);
    };
    skin.customProgramCacheKey=()=> 'st25-skin-illustration-v2';
    this.materials={skin};
    for(const key of ['flank','underbelly','detail1','male_display','eyes','teeth','mouth','claws'])
      this.materials[key]=new THREE.MeshStandardMaterial({color:0xffffff,roughness:key==='eyes' ? .18 : .72,side:THREE.DoubleSide});
    this.materials.pupil=new THREE.MeshStandardMaterial({color:0x090806,roughness:.26});
    this.materials.shine=new THREE.MeshBasicMaterial({color:0xffffff});
    // Cheap contact shadow: a small texture, with no real-time shadow render pass.
    const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;
    const ctx=shadowCanvas.getContext('2d');const gradient=ctx.createRadialGradient(64,64,2,64,64,63);
    gradient.addColorStop(0,'rgba(0,0,0,.55)');gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
    this.shadowTexture=new THREE.CanvasTexture(shadowCanvas);
    this.shadow=new THREE.Mesh(new THREE.PlaneGeometry(7,3),new THREE.MeshBasicMaterial({map:this.shadowTexture,transparent:true,depthWrite:false}));
    this.shadow.rotation.x=-Math.PI/2;this.shadow.position.y=.015;this.scene.add(this.shadow);
    this.resizeObserver=new ResizeObserver(()=>{this.resize();this.invalidate();});this.resizeObserver.observe(host);
    this.intersection=new IntersectionObserver(entries=>{this.visible=entries[0].isIntersecting;this.invalidate();},{threshold:.01});this.intersection.observe(host);
    this.listen(document,'visibilitychange',()=>this.invalidate());
    this.listen(this.canvas,'keydown',event=>this.keyControl(event));
    this.listen(this.canvas,'webglcontextlost',event=>{event.preventDefault();this.contextLost=true;this.stop();this.onStatus('Mất kết nối đồ họa. Đang chờ trình duyệt khôi phục…','lost');});
    this.listen(this.canvas,'webglcontextrestored',()=>{this.contextLost=false;this.onStatus('Mô hình minh họa 3D','ready');this.invalidate();});
    this.listen(window,'pagehide',event=>{if(!event.persisted)this.dispose();else this.stop();});
    this.listen(window,'pageshow',()=>this.invalidate());
    this.setState(state);this.resize();
    this.onStatus('Mô hình minh họa 3D','ready');
  }
  listen(target,event,handler){target.addEventListener(event,handler);this.cleanups.push(()=>target.removeEventListener(event,handler));}
  makeScaleTexture(){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#656565';ctx.fillRect(0,0,256,256);
    for(let row=0;row<32;row++)for(let col=0;col<32;col++){
      const x=col*8+(row%2)*4,y=row*8;
      const shade=110+Math.round(35*Math.sin(col*13.7+row*7.3));
      ctx.fillStyle=`rgb(${shade},${shade},${shade})`;ctx.beginPath();ctx.ellipse(x,y,3.7,3.1,0,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#999';ctx.lineWidth=.55;ctx.stroke();
    }
    const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(3,2);
    return texture;
  }
  setState(state){
    if(this.disposed)return;
    const species=state.species || 'Tyrannosaurus';
    const speciesChanged=this.state.species!==species;
    if(speciesChanged){
      if(this.model){this.scene.remove(this.model);disposeIllustration(this.model);}
      const illustration=createIllustration(species,this.materials);
      this.model=new THREE.Group();this.model.add(illustration);this.model.userData.illustration=illustration;this.scene.add(this.model);
      this.canvas.setAttribute('aria-label',`${species} 3D minh họa. Kéo để xoay, cuộn để zoom; mũi tên và cộng trừ cũng điều khiển được.`);
      this.host.dataset.species=species;
    }
    for(const [key,value] of Object.entries(state.colors || {})){
      if(!/^#[0-9a-f]{6}$/i.test(value))continue;
      if(this.uniforms[key])this.uniforms[key].value.set(value);
      if(this.materials[key])this.materials[key].color.set(value);
    }
    this.uniforms.pattern.value=Math.max(0,Math.min(4,Number(state.pattern)||0));
    this.uniforms.variation.value=Math.max(0,Math.min(10,Number(state.variation)||0));
    this.model.scale.setScalar(.55+.45*Math.max(.1,Math.min(1,Number(state.growth)||1)));
    this.materials.male_display.color.set(state.colors?.male_display || '#6c3729');
    if(state.female)this.materials.male_display.color.lerp(this.uniforms.body.value,.65);
    this.materials.skin.emissive.set(state.mode==='glitch' ? '#073b3b' : '#000000');
    this.state={...state,species,colors:{...state.colors}};
    if(speciesChanged)this.fitView();
    this.invalidate();
  }
  fitView(){
    if(!this.model||!this.host.clientWidth||!this.host.clientHeight)return;
    const scale=this.model.scale.clone();this.model.scale.setScalar(1);
    const bounds=new THREE.Box3().setFromObject(this.model);this.model.scale.copy(scale);this.model.updateMatrixWorld(true);
    const direction=this.camera.position.clone().sub(this.controls.target).normalize();
    const right=new THREE.Vector3().crossVectors(this.camera.up,direction).normalize();
    const up=new THREE.Vector3().crossVectors(direction,right).normalize();
    const vertical=Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2)),horizontal=vertical*this.camera.aspect;
    let distance=4;
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
      const corner=new THREE.Vector3(x,y,z).sub(this.controls.target),depth=corner.dot(direction);
      distance=Math.max(distance,depth+Math.abs(corner.dot(right))/horizontal,depth+Math.abs(corner.dot(up))/vertical);
    }
    distance*=1.14;
    this.camera.position.copy(direction.multiplyScalar(distance).add(this.controls.target));
    this.controls.minDistance=distance*.45;this.controls.maxDistance=distance*2.5;this.controls.update();
  }
  resize(){
    if(this.disposed)return;
    const width=Math.round(this.host.clientWidth),height=Math.round(this.host.clientHeight);
    if(!width||!height)return;
    const cap=this.quality==='low' ? 1 : this.quality==='high' ? 2 : width<600 ? 1.25 : 1.5;
    const dpr=Math.min(window.devicePixelRatio||1,cap,Math.sqrt(2200000/(width*height)));
    if(this.renderer.getPixelRatio()!==dpr||this.lastWidth!==width||this.lastHeight!==height){
      this.renderer.setPixelRatio(dpr);this.renderer.setSize(width,height,false);
    }
    this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
    if(this.lastWidth!==width||this.lastHeight!==height){this.lastWidth=width;this.lastHeight=height;this.fitView();}
  }
  invalidate(){
    if(this.disposed||this.contextLost||document.hidden||!this.visible){this.stop();return;}
    if(!this.frame)this.frame=requestAnimationFrame(time=>this.render(time));
  }
  render(time=0){
    this.frame=0;
    if(this.disposed||document.hidden||!this.visible||this.contextLost)return;
    if(this.autoRotate){
      const delta=Math.min(.05,Math.max(0,(time-(this.lastFrame||time))/1000));
      this.camera.position.sub(this.controls.target).applyAxisAngle(new THREE.Vector3(0,1,0),delta*.3).add(this.controls.target);
      this.controls.update();
    }
    this.lastFrame=time;this.renderer.render(this.scene,this.camera);this.draws++;
    this.host.dataset.draws=String(this.draws);
    if(this.autoRotate)this.invalidate();
  }
  stop(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;this.lastFrame=0;}
  setAutoRotate(enabled){this.autoRotate=!!enabled;this.host.dispatchEvent(new CustomEvent('viewerrotate',{detail:this.autoRotate}));this.invalidate();}
  setQuality(value){this.quality=value;this.resize();this.invalidate();}
  setLight(value){this.renderer.toneMappingExposure=Math.max(.5,Math.min(2.5,Number(value)||1.25));this.invalidate();}
  setView(view='studio'){
    this.setAutoRotate(false);
    this.controls.target.set(0,1.4,0);
    this.camera.position.set(...({side:[0,2.5,10],front:[10,2.5,0],studio:[3.8,3.1,8.5]}[view]||[3.8,3.1,8.5]));
    this.controls.update();this.fitView();this.invalidate();
  }
  keyControl(event){
    const keys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'];if(!keys.includes(event.key))return;
    event.preventDefault();this.setAutoRotate(false);
    const sphere=new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    if(event.key==='ArrowLeft')sphere.theta-=.12;if(event.key==='ArrowRight')sphere.theta+=.12;
    if(event.key==='ArrowUp')sphere.phi-=.08;if(event.key==='ArrowDown')sphere.phi+=.08;
    if(event.key==='+'||event.key==='=')sphere.radius*=.9;if(event.key==='-')sphere.radius*=1.1;
    sphere.phi=THREE.MathUtils.clamp(sphere.phi,.2,Math.PI*.49);sphere.radius=THREE.MathUtils.clamp(sphere.radius,this.controls.minDistance,this.controls.maxDistance);
    this.camera.position.setFromSpherical(sphere).add(this.controls.target);this.controls.update();this.invalidate();
  }
  async exportPNG(){
    if(this.disposed||this.contextLost)throw new Error('Trình xem 3D chưa sẵn sàng.');
    this.renderer.render(this.scene,this.camera);
    const blob=await new Promise(resolve=>this.canvas.toBlob(resolve,'image/png'));
    if(!blob)throw new Error('Không thể xuất ảnh từ trình duyệt.');
    return blob;
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;this.stop();
    this.resizeObserver.disconnect();this.intersection.disconnect();this.cleanups.forEach(fn=>fn());this.controls.dispose();
    disposeIllustration(this.model);Object.values(this.materials).forEach(material=>material.dispose());
    this.bump.dispose();this.shadowTexture.dispose();this.shadow.geometry.dispose();this.shadow.material.dispose();
    this.renderer.dispose();this.renderer.forceContextLoss();this.canvas.remove();
  }
}
