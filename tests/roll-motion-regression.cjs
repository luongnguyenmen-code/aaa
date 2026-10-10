const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('src/features/roll.js','utf8');
const code=source.slice(source.indexOf('  const cycle='),source.indexOf('  function publishResult('));
(async()=>{
 for(let slot=0;slot<15;slot++){
  const classes=new Set(),calls=[];let finish;
  const winners=new Set();const children=Array.from({length:120},(_,i)=>({classList:{add:()=>winners.add(i),remove:()=>winners.delete(i)}}));
  const track={children,querySelectorAll:()=>[...winners].map(i=>children[i]),style:{},animate:(frames,options)=>{calls.push({frames,options});return {finished:new Promise(resolve=>finish=resolve),cancel(){}};}};
  const context=vm.createContext({data:null,publishResult:()=>{},animation:undefined,animationKey:'',trackPosition:15,setTimeout,clearTimeout,document:{hidden:false,querySelector:()=>({classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)}})},$:()=>track,reelMetrics:()=>({half:35,step:76}),matchMedia:()=>({matches:false})});
  vm.runInContext(code+';this.run=animate;',context);
  context.run(90+slot,8000,'result:1',true);context.run(90+slot,7900,'result:1',true);
  assert.equal(calls.length,1);assert.equal(calls[0].options.duration,8000);
  assert.equal(calls[0].options.easing,'cubic-bezier(0.1, 0.8, 0.1, 1)');
  const x=Number(calls[0].frames[1].transform.match(/translateX\((.*)px\)/)[1]);
  assert.equal(((-35-x)/76)%15,slot);assert(classes.has('is-revealing'));
  assert.equal(winners.size,0);finish();await Promise.resolve();assert(!classes.has('is-revealing'));assert.equal(context.trackPosition%15,slot);assert.deepEqual([...winners],[15+slot]);
  context.run(75,900,"spin:2");assert.equal(winners.size,0);
 }
 const nodes={};const get=id=>nodes[id]??=( {innerHTML:'',textContent:''} );
 const recent=Array.from({length:20},(_,i)=>({id:100-i,number:100-i,result:i%15,color:'red'}));
 const historyContext=vm.createContext({data:{round:{closesAt:0},history:recent},completedRound:undefined,animation:true,animationKey:'result:100',winnerTimer:undefined,lastHistory:'',demoBet:null,offset:0,names:{red:'Red'},$:get,animate:()=>{throw Error('History interrupted a spin');}});
 const historyCode=source.slice(source.indexOf('  function publishResult('),source.indexOf('  function render()'));
 vm.runInContext(historyCode+';this.show=renderHistory;this.publish=publishResult;',historyContext);
 historyContext.show();assert.equal((nodes['roll-history'].innerHTML.match(/roll-dot/g)||[]).length,14);
 assert(!nodes['roll-result'].textContent.includes('100'));
 historyContext.animation=undefined;historyContext.publish(recent[0]);
 assert(nodes['roll-result'].textContent.includes('100'));
 assert.equal((nodes['roll-history'].innerHTML.match(/roll-dot/g)||[]).length,14);
 historyContext.data.history=recent.slice(1);historyContext.show();
 assert(nodes['roll-result'].textContent.includes('100'));
 console.log('PASS result publication: hidden until landing, 14 unique results, latest retained during stale polling');
 console.log('PASS native cubic-bezier: 8s, all 15 centered server targets, no polling restarts, completion cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
