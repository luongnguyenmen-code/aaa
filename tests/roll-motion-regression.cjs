const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('src/features/roll.js','utf8');
const curve=source.slice(source.indexOf('  const cycle='),source.indexOf('  function paint('));
const context=vm.createContext({motion:null,trackPosition:15,matchMedia:()=>({matches:false})});
vm.runInContext(curve+';this.sample=sampleMotion;',context);
for(const seconds of [5,1,.1])for(let slot=0;slot<15;slot++){
 const from=22.4,velocity=15/.9,target=Math.ceil((from+Math.max(1,velocity*seconds/3)-slot)/15)*15+slot;
 context.motion={from,target,velocity,seconds,started:0};
 assert(Math.abs(context.sample(0).velocity-velocity)<1e-9);
 let prior=from;
 for(let i=0;i<=100;i++){const v=context.sample(i*seconds*10);assert(v.position>=prior-1e-9);assert(v.velocity>=-1e-9);prior=v.position;}
 assert(Math.abs(context.sample(seconds*1000).position-target)<1e-9);assert.equal(context.sample(seconds*1000).velocity,0);
}
console.log('PASS motion: all 15 slots, continuous entry velocity, monotone travel, exact stop, late results at 1s and 0.1s');

for(const seconds of [8,7.8,4])for(let slot=0;slot<15;slot++){
 const from=22.4,cruise=Math.max(0,seconds-4),brake=seconds-cruise,brakeFrom=from+9*cruise;
 const target=Math.ceil((brakeFrom+9*brake/2-slot)/15)*15+slot,d=target-brakeFrom,power=d/(9*brake-d);
 context.motion={from,target,seconds,cruise,brake,power,started:0};
 let prior=from,lastSpeed=9;
 for(let i=0;i<=800;i++){
  const t=seconds*i/800,v=context.sample(t*1000);
  assert(v.position>=prior-1e-8);assert(v.velocity<=lastSpeed+1e-8);assert(v.velocity>=0);
  if(t<cruise)assert.equal(v.velocity,9);
  prior=v.position;lastSpeed=v.velocity;
 }
 assert(Math.abs(context.sample(cruise*1000).velocity-9)<1e-8);
 assert(Math.abs(context.sample(seconds*1000).position-target)<1e-8);
 assert.equal(context.sample(seconds*1000).velocity,0);
}
console.log('PASS 8s motion: cruise at 9 tiles/s, continuous handoff at 4s, decreasing speed, all 15 exact targets');
