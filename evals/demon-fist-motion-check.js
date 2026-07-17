'use strict';
const{runMotion,analyzeMotion,motionLine}=require('./motion');
let allClean=true;
for(const [seed,minutes] of [[0x5200,10],[0x6100,2],[0x613d,3],[0x52d4,3]]){
  const run=runMotion('demon-fist',{seed,minutes});
  const riderReport=analyzeMotion({step:run.step,samples:run.samples.map(s=>Object.assign({},s,{actors:s.actors.filter(a=>a.id==='fighter')}))},{emoteFrames:240,emoteShare:.35,requiredIds:['fighter']});
  const packReport=analyzeMotion(run,{emoteFrames:240,emoteShare:.5,requiredIds:['fighter'],identityTurnoverAllowance:4});
  const bare=[...riderReport.violations,...packReport.violations];
  console.log(seed.toString(16),'rider:',motionLine(riderReport),'| pack:',motionLine(packReport),'| viol:',bare.slice(0,3));
  if(bare.length)allClean=false;
}
console.log('ALL CLEAN:',allClean);
