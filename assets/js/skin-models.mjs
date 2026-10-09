import * as THREE from '../vendor/three/three.module.min.mjs';

// Original procedural illustrations. Dimensions are artistic, not extracted game assets.
export const SPECIES = Object.freeze({
  Tyrannosaurus: {head:1.15, arms:.32, bulk:1.05},
  Carnotaurus: {head:.78, arms:.2, horns:'brow', legs:1.12},
  Ceratosaurus: {head:.92, arms:.5, horns:'nose', ridge:true},
  Omniraptor: {head:.64, arms:.8, slim:.72, sickle:true},
  Dilophosaurus: {head:.72, arms:.68, slim:.85, crest:true},
  Herrerasaurus: {head:.68, arms:.72, slim:.8},
  Troodon: {head:.6, arms:.8, slim:.65, sickle:true, feathers:true},
  Gallimimus: {head:.43, arms:.9, slim:.72, neck:1.3, beak:true},
  Beipiaosaurus: {head:.5, arms:1.05, neck:1.15, feathers:true},
  Tenontosaurus: {head:.55, arms:.8, bulk:1.15, neck:.85},
  Hypsilophodon: {head:.45, arms:.55, slim:.6, beak:true},
  Pachycephalosaurus: {head:.7, arms:.48, dome:true},
  Triceratops: {kind:'quad', head:.85, bulk:1.3, frill:true, horns:'three'},
  Diabloceratops: {kind:'quad', head:.78, bulk:1.15, frill:true, horns:'frill'},
  Stegosaurus: {kind:'quad', head:.36, bulk:1.3, plates:true},
  Deinosuchus: {kind:'croc', head:1.35, bulk:.65, ridge:true},
  Pteranodon: {kind:'fly', head:.6, slim:.55, beak:true}
});

export function createIllustration(species, materials) {
  const p = SPECIES[species] || SPECIES.Tyrannosaurus;
  const root = new THREE.Group();
  root.name = species;
  root.userData.illustration = true;
  const quad = p.kind === 'quad', croc = p.kind === 'croc', fly = p.kind === 'fly';
  const slim = p.slim || 1, bulk = p.bulk || slim;
  const height = croc ? .68 : quad ? 1.4 : 2.0;
  const eyeMeshes = [], displayMeshes = [];
  function mesh(geometry, channel='skin') {
    const object = new THREE.Mesh(geometry, materials[channel]);
    object.name = channel;
    root.add(object);
    if (channel === 'male_display') displayMeshes.push(object);
    return object;
  }
  function oval(pos, scale, channel='skin', rotation=0) {
    const object = mesh(new THREE.SphereGeometry(1, 28, 18), channel);
    object.position.set(...pos); object.scale.set(...scale); object.rotation.z = rotation;
    return object;
  }
  function sweep(points, radii, channel='skin', flat=1, segments=42, sides=18) {
    const curve = new THREE.CatmullRomCurve3(points.map(point=>new THREE.Vector3(...point)));
    const frames = curve.computeFrenetFrames(segments, false);
    const positions=[], normals=[], uvs=[], indices=[];
    for(let i=0;i<=segments;i++) {
      const t=i/segments, center=curve.getPointAt(t), ri=t*(radii.length-1), r0=Math.floor(ri);
      const radius=THREE.MathUtils.lerp(radii[r0],radii[Math.min(r0+1,radii.length-1)],ri-r0);
      for(let j=0;j<=sides;j++) {
        const a=j/sides*Math.PI*2;
        const n=frames.normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a)*flat);
        const v=center.clone().addScaledVector(n,radius);
        positions.push(v.x,v.y,v.z); n.normalize(); normals.push(n.x,n.y,n.z); uvs.push(j/sides,t);
        if(i<segments&&j<sides) {const k=i*(sides+1)+j; indices.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1);}
      }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2)); geometry.setIndex(indices);
    return mesh(geometry, channel);
  }
  function spike(start, end, radius, channel='detail1') {
    return sweep([start,[(start[0]+end[0])/2,(start[1]+end[1])/2,(start[2]+end[2])/2],end],[radius,radius*.55,.004],channel,1,12,10);
  }
  // Organic continuous torso and curved tapering tail.
  sweep([[-4.05,height-.28,.38],[-3.0,height-.3,.08],[-2.0,height-.06,0],[-1.3,height,0],[-.6,height+.05,0],[.2,height+.06,0],[.95,height+.11,0]],[.006,.13,.28,.45*bulk,.68*bulk,.57*bulk,.32*bulk],'skin',croc ? 1.6 : .85,86,26);
  const neckRise = croc ? .02 : quad ? .13 : .58*(p.neck || 1);
  sweep([[.65,height+.04,0],[1.15,height+.18,0],[1.52,height+neckRise,0]],[.52*bulk,.39*slim,.3*slim],'skin',1,32,22);
  const hx=1.75, hy=height+neckRise, head=p.head || .8;
  if(croc) {
    oval([1.85,hy,0],[1.0,.26,.36]);
    oval([2.45,hy-.08,0],[.68,.15,.28]);
    oval([2.18,hy-.23,0],[1.03,.12,.3],'underbelly');
  } else {
    sweep([[hx-.52*head,hy+.1,0],[hx-.1*head,hy+.2,0],[hx+.4*head,hy+.13,0],[hx+.9*head,hy+.08,0],[hx+1.08*head,hy+.08,0]],[.21*head,.42*head,.31*head,.2*head,.004],'skin',.82,44,24);
    oval([hx+.32*head,hy-.22*head,0],[.66*head,.13*head,.29*head],'underbelly');
    oval([hx+.48*head,hy-.08*head,0],[.52*head,.025,.285*head],'mouth');
  }
  if(p.beak || fly) {
    sweep([[hx+.35,hy+.12,0],[hx+.85,hy+.07,0],[hx+1.28,hy-.03,0]],[.18,.12,.005],'detail1',.8,24,14);
  }
  // Eyes, eyebrow ridges, nostrils, pupils, catchlights and individual teeth.
  for(const sign of [-1,1]) {
    const ex=croc ? 1.64 : hx+.12*head, ey=hy+.23*head, ez=sign*.31*head;
    oval([ex-.04,ey+.08,ez],[.22*head,.1,.11],'skin',-.2);
    const eye=oval([ex,ey,ez],[.082*head,.082*head,.03],'eyes'); eyeMeshes.push(eye);
    oval([ex+.014,ey,ez+sign*.026],[.02,.052*head,.008],'pupil');
    oval([ex+.029,ey+.025,ez+sign*.034],[.015,.016,.004],'shine');
    oval([hx+.78*head,hy+.1,sign*.235*head],[.035,.026,.012],'pupil');
    if(!p.beak && !quad) for(let t=0;t<9;t++) {
      const x=(croc ? 1.92 : hx+.1*head)+t*.082*head;
      spike([x,hy-.025,sign*.27*head],[x+.018,hy-.135,sign*.255*head],.028*head,'teeth');
    }
  }
  // Weighted hind limbs, heel, ankle and three clawed toes.
  for(const sign of [-1,1]) {
    const z=sign*(croc ? .78 : .48*bulk), hip=-.7, knee=quad ? -.8 : -.05;
    oval([hip,height-(croc ? .15 : .4),z],croc ? [.33,.24,.27] : [.43*bulk,.65*bulk,.35*bulk],'skin',-.3);
    const ankleY=croc ? .2 : .48;
    sweep([[hip,height-.37,z],[knee,height*.52,z*1.18],[-.62,ankleY,z*1.15],[-.43,.16,z*1.15]],[.3*bulk,.23*bulk,.11,.13],'skin',1,28,16);
    for(let toe=0;toe<3;toe++) {
      const tz=z*1.15+(toe-1)*.13;
      sweep([[-.43,.17,tz],[-.1,.11,tz+sign*.025],[.08,.09,tz+sign*.03]],[.08,.06,.015],'skin',.65,12,10);
      spike([.035,.09,tz],[.18,.045,tz],.045,'claws');
    }
    if(p.sickle) spike([-.15,.22,z*1.15-sign*.16],[.16,.35,z*1.15-sign*.15],.065,'claws');
    if(quad||croc) {
      const fz=sign*(croc ? .65 : .52*bulk);
      sweep([[.8,height-.22,fz],[1.0,height*.5,fz*1.12],[.91,.18,fz*1.24]],[.23*bulk,.15,.09],'skin',1,26,16);
      oval([1.03,.13,fz*1.24],[.23,.1,.16]);
      for(let i=0;i<3;i++) spike([1.15,.1,fz*1.24+(i-1)*.09],[1.3,.05,fz*1.24+(i-1)*.09],.033,'claws');
    } else if(!fly) {
      const length=p.arms || .5;
      sweep([[.95,height-.08,sign*.4*slim],[1.17,height-.35-length*.38,sign*.48],[1.45,height-.22-length*.55,sign*.53]],[.13*slim,.085,.06],'skin',1,22,12);
      for(let i=0;i<3;i++) spike([1.43,height-.22-length*.55,sign*.53+(i-1)*.05],[1.64,height-.32-length*.55,sign*.53+(i-1)*.07],.027,'claws');
    }
  }
  if(p.horns==='brow'||p.horns==='three') for(const sign of [-1,1])
    spike([hx-.08,hy+.48,sign*.24],[hx+.42,hy+(quad ? 1.1 : .78),sign*.35],quad ? .12 : .09,'male_display');
  if(p.horns==='nose'||p.horns==='three') spike([hx+.62*head,hy+.32,0],[hx+.78*head,hy+.66,0],.09,'detail1');
  if(p.frill) {
    oval([1.36,hy+.35,0],[.16,.85,.72],'male_display',-.2);
    for(const sign of [-1,1]) {
      if(p.horns==='frill') spike([1.32,hy+.85,sign*.43],[1.18,hy+1.36,sign*.65],.11,'detail1');
      for(let i=0;i<5;i++) spike([1.33,hy+.46+i*.1,sign*(.68-i*.055)],[1.26,hy+.5+i*.14,sign*(.82-i*.065)],.052,'detail1');
    }
  }
  if(p.crest) for(const sign of [-1,1]) oval([hx,hy+.59,sign*.15],[.38,.23,.055],'male_display',.2);
  if(p.dome) oval([hx-.08,hy+.52,0],[.38,.3,.28],'male_display');
  if(p.plates) for(let i=0;i<10;i++) {
    const x=-2.25+i*.36, rise=.2+Math.sin(i/9*Math.PI)*.62;
    const plate=mesh(new THREE.ConeGeometry(.28,rise,4),'male_display');
    plate.position.set(x,height+.5+rise/2, (i%2 ? 1 : -1)*.13); plate.scale.z=.3;
  }
  if(p.plates) for(const sign of [-1,1]) {
    spike([-3.0,height-.23,sign*.14],[-3.52,height+.1,sign*.72],.1,'detail1');
    spike([-3.45,height-.23,sign*.1],[-3.92,height+.03,sign*.57],.085,'detail1');
  }
  if(p.ridge) for(let i=0;i<16;i++) oval([-2.6+i*.24,height+.27+Math.sin(i/15*Math.PI)*.44,0],[.1,.1,.09],'detail1');
  if(p.feathers) for(const sign of [-1,1]) for(let i=0;i<9;i++)
    oval([-.85+i*.16,height+.5,sign*.17],[.19,.23,.035],'male_display',.5);
  if(fly) {
    for(const sign of [-1,1]) {
      const outline=[[.75,height,.25*sign],[.25,height+.13,1.5*sign],[-.7,height+.4,3.1*sign],[-1.3,height-.06,1.5*sign],[-1.1,height-.12,.3*sign]];
      const positions=[]; for(let i=1;i<outline.length-1;i++) positions.push(...outline[0],...outline[i],...outline[i+1]);
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(positions.map((_,i)=>i%3===0 ? .5 : 0).slice(0,positions.length/3*2),2));g.computeVertexNormals();
      mesh(g,'flank');
      sweep(outline.slice(0,3),[.09,.06,.012],'skin',1,30,12);
    }
    spike([hx-.2,hy+.37,0],[hx-.98,hy+.78,0],.18,'male_display');
  }
  const bounds=new THREE.Box3().setFromObject(root), center=bounds.getCenter(new THREE.Vector3());
  root.position.x=-center.x; root.position.z=-center.z; root.position.y=.045-bounds.min.y;
  root.userData.displayMeshes=displayMeshes;
  root.userData.kind=p.kind || 'biped';
  return root;
}

export function disposeIllustration(root) {
  root?.traverse(object=>object.geometry?.dispose());
}
