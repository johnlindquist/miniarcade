#!/usr/bin/env node
'use strict';

const{HALF_SECOND,analyzeMotion,assertMotion,analyzeLocalOscillation,assertLocalOscillation}=require('./motion');
let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true};
const makeRun=(frames,actorAt,step=5)=>({step,samples:Array.from({length:Math.ceil(frames/step)},(_,index)=>{
  const at=(index+1)*step,value=actorAt(at,index);return{at,actors:Array.isArray(value)?value:value?[value]:[],finite:true};
})});

console.log('1) real travel and a bounded authored pause pass');
{
  const moving=analyzeMotion(makeRun(300,(at,index)=>({id:'hero',x:index*3,y:0,emote:at<=30}))),errors=[];
  assertMotion('moving',moving,message=>errors.push(message));
  if(errors.length)fail('valid moving actor was rejected: '+errors.join('; '));
  if(moving.actors[0].worstEmoteStillFrames!==30||moving.actors[0].emoteStillShare!==.1)fail('bounded emote accounting is not wall-clock exact');
  console.log(`  travel accepted; 30f emote is ${(moving.actors[0].emoteStillShare*100).toFixed(0)}% of the run`);
}

console.log('2) unexplained standing past half a second fails');
{
  const still=analyzeMotion(makeRun(40,()=>({id:'hero',x:0,y:0,emote:false}))),errors=[];
  assertMotion('still',still,message=>errors.push(message));
  if(!errors.some(message=>message.includes(`limit ${HALF_SECOND}f`)))fail('40f bare stand was accepted');
  console.log('  40f bare stand rejected at the fixed '+HALF_SECOND+'f limit');
}

console.log('3) moving artwork cannot hide an overlong emote');
{
  const sway=analyzeMotion(makeRun(130,(at,index)=>({id:'guard',x:index%2?4:0,y:0,emote:true}))),errors=[];
  assertMotion('sway',sway,message=>errors.push(message));
  if(!errors.some(message=>message.includes('emote pause ran 130f')))fail('render/sim sway hid a 130f emote');
  if(!errors.some(message=>message.includes('emote-paused 100.0%')))fail('moving emote escaped share accounting');
  console.log('  130f swaying emote rejected by duration and share');
}

console.log('4) non-finite probe state fails closed');
{
  const run=makeRun(10,(at,index)=>({id:'hero',x:index*3,y:0,emote:false}));run.samples[1].finite=false;
  const report=analyzeMotion(run),errors=[];assertMotion('finite',report,message=>errors.push(message));
  if(!errors.some(message=>message.includes('non-finite')))fail('non-finite motion sample was accepted');
  const badCoordinate=makeRun(10,()=>({id:'hero',x:NaN,y:0,emote:false})),badReport=analyzeMotion(badCoordinate),badErrors=[];
  assertMotion('coordinate',badReport,message=>badErrors.push(message));
  if(!badErrors.some(message=>message.includes('non-finite')))fail('non-finite actor coordinate was accepted');
  let coarseRejected=false;try{analyzeMotion(makeRun(120,(at,index)=>({id:'hero',x:index*4,y:0,emote:false}),10))}catch(error){coarseRejected=/at most every 5 frames/.test(error.message)}
  if(!coarseRejected)fail('coarse sampling could hide a 31-frame stationary violation');
  console.log('  non-finite sample and coarse sampling rejected');
}

console.log('5) empty streams, ID churn, and omission laundering fail closed');
{
  const cases=[
    ['empty',{step:5,samples:Array.from({length:12},(_,i)=>({at:(i+1)*5,actors:[],finite:true}))},'contain no watched actors'],
    ['churn',makeRun(120,(at,index)=>({id:'actor-'+index,x:index*4,y:0,emote:false})),'no stable watched actor'],
    ['omission',makeRun(80,(at,index)=>index%7===6?null:{id:'hero',x:0,y:0,emote:false}),'stood still']
  ];
  for(const[label,run,needle]of cases){const report=analyzeMotion(run),errors=[];assertMotion(label,report,message=>errors.push(message));if(!errors.some(message=>message.includes(needle)))fail(`${label} loophole survived: ${errors.join('; ')}`)}
  console.log('  empty actors, rotating IDs, and brief disappear/reappear streak resets rejected');
}

console.log('6) a persistent hero cannot mask rotating enemy IDs');
{
  const mixed=makeRun(120,(at,index)=>[
    {id:'hero',x:index*3,y:0,emote:false},
    {id:'enemy-'+index,x:20,y:20,emote:false}
  ]),report=analyzeMotion(mixed,{requiredIds:['hero']}),errors=[];
  assertMotion('mixed-churn',report,message=>errors.push(message));
  if(!errors.some(message=>message.includes('rotated through')))fail('persistent hero masked rotating enemy IDs: '+errors.join('; '));
  if(errors.some(message=>message.includes('no stable watched actor')))fail('mixed churn did not recognize the persistent hero');
  console.log(`  hero stayed stable; ${report.identityTurnover.distinct} IDs across ${report.identityTurnover.concurrent} watched slots were rejected`);
}

console.log('7) prolonged cell reversals fail without rejecting tactical returns');
{
  const event=(at,cx,cy,extra)=>Object.assign({at,id:'miner',cx,cy,mode:'TEST',segment:0},extra||{});
  const alternating=[event(0,4,8)];for(let i=1;i<=30;i++)alternating.push(event(i*8,4+i%2,8));
  const bad=analyzeLocalOscillation(alternating),badErrors=[];
  assertLocalOscillation('alternating',bad,message=>badErrors.push(message));
  if(!badErrors.some(message=>message.includes('local oscillation')))fail('sustained A/B reversal was accepted');
  const pacing=[event(0,4,8)],pattern=[5,6,5,4];for(let i=1;i<=30;i++)pacing.push(event(i*8,pattern[(i-1)%pattern.length],8));
  if(!analyzeLocalOscillation(pacing).violations.length)fail('sustained three-cell pacing was accepted');
  const cases=[
    ['dodge-return',[event(0,0,0),event(30,1,0),event(60,0,0),event(90,0,1),event(120,0,2),event(180,0,3),event(240,0,4)]],
    ['corridor',Array.from({length:13},(_,i)=>event(i*20,i,0))],
    ['mining',[event(0,2,2),event(240,2,2)]],
    ['short-bait',[event(0,2,2),event(20,3,2),event(40,2,2),event(60,3,2),event(80,3,3),event(160,3,4),event(240,3,5)]],
    ['portal',[event(0,2,2),event(40,3,2),event(80,12,40,{segment:1}),event(120,13,40,{segment:1}),event(240,18,40,{segment:1})]]
  ];
  for(const[label,events]of cases){const report=analyzeLocalOscillation(events),errors=[];assertLocalOscillation(label,report,message=>errors.push(message));if(errors.length)fail(`${label} was rejected: ${errors.join('; ')}`)}
  const omitted=alternating.filter((_,i)=>i!==12&&i!==13),omittedReport=analyzeLocalOscillation(omitted);
  if(!omittedReport.violations.length)fail('briefly omitted arrivals erased an active oscillation');
  const churn=alternating.map((e,i)=>Object.assign({},e,{id:'miner-'+i})),churnErrors=[];
  assertLocalOscillation('churn',analyzeLocalOscillation(churn),message=>churnErrors.push(message));
  if(!churnErrors.some(message=>message.includes('stable actor ID')))fail('rotating IDs laundered local oscillation telemetry');
  const segmentChurn=alternating.map((e,i)=>Object.assign({},e,{segment:i})),segmentErrors=[];
  assertLocalOscillation('segment-churn',analyzeLocalOscillation(segmentChurn),message=>segmentErrors.push(message));
  if(!segmentErrors.some(message=>message.includes('segments only for spatial discontinuities')))fail('rotating segments laundered local oscillation telemetry');
  console.log(`  ${bad.violations[0].moves} moves / ${bad.violations[0].reversals} reversals rejected; three-cell pacing and telemetry churn rejected`);
}

if(failed){console.error('\nMOTION EVAL FAILED');process.exit(1)}
console.log('\nMOTION EVAL PASSED');
