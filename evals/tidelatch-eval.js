#!/usr/bin/env node
'use strict';
const{bootGame}=require('./harness');

const FOOTER=`
globalThis.__tlNotes=[];
{const __tln0=SHOW.note;SHOW.note=e=>{globalThis.__tlNotes.push({kind:e.kind,id:e.id,tag:e.tag,landsAt:e.landsAt});return __tln0(e);};}
const __tlCore=S=>JSON.stringify({power:S.power,level:S.level,source:S.source,delivered:S.delivered,spilled:S.spilled,returned:S.returned,
  sourceSed:S.sourceSed,sedWaste:S.sedWaste,nodes:S.nodes.map(n=>[n.v,n.sed]),
  edges:S.edges.map(e=>[e.pipe,e.sed,e.gate,e.gateTarget,e.pumpDir,e.energyCarry,e.flowPhase,e.broken,e.wear])});
globalThis.__tlSimSig=()=>JSON.stringify({core:__tlCore(WORLD),districts:districts.map(d=>[d.unlocked,d.active,d.need,d.got,d.deadline,d.nextAt,d.seq,d.services,d.misses,d.satisfaction]),
  stats:{...stats},cloud:{...cloud},silt:{...silt},crowned,crownCharge,crownWave,drone:{...drone},cityFrame,personaIndex,cityVariant});
globalThis.__tlOrderFixture=()=>{
  const base=cloneWorld(WORLD);base.level=4;base.power=900;
  base.nodes.forEach(n=>{n.v=0;n.sed=0;});base.edges.forEach(e=>{e.pipe=0;e.sed=0;e.broken=false;e.gate=e.gateTarget=100;e.pumpDir=1;e.energyCarry=0;});
  base.nodes[0].v=4100;base.nodes[0].sed=310;base.nodes[3].v=900;base.nodes[4].v=700;base.nodes[5].v=800;
  base.edges[0].pipe=270;base.edges[0].sed=45;base.edges[1].pipe=250;base.edges[1].sed=35;
  base.initial=currentWater(base);base.initialSed=currentSed(base);base.source=base.delivered=base.spilled=base.returned=base.sourceSed=base.sedWaste=0;
  const a=cloneWorld(base),b=cloneWorld(base),forward=a.edges.map((_,i)=>i),reverse=forward.slice().reverse();
  for(let i=0;i<90;i++){flowKernel(a,forward);flowKernel(b,reverse);}
  return{same:__tlCore(a)===__tlCore(b),a:__tlCore(a),b:__tlCore(b),waterA:waterLedger(a),waterB:waterLedger(b),
    sedimentA:sedLedger(a),sedimentB:sedLedger(b),initial:base.initial,initialSed:base.initialSed};
};
globalThis.__tlFrozenMotionFixture=()=>{
  const S=cloneWorld(WORLD);S.level=4;S.edges.forEach(e=>{e.gate=e.gateTarget=0;e.pipe=0;e.sed=0;e.flowPhase=0;e.broken=false;});
  const d={x:80,y:330,target:-1,mode:'idle',repairT:0},before=motionSignature(S,d);
  for(let i=0;i<240;i++)flowKernel(S);const after=motionSignature(S,d);
  const moving=cloneWorld(S);moving.edges[0].gate=moving.edges[0].gateTarget=100;moving.nodes[0].v=1000;moving.nodes[1].v=0;
  const activeBefore=motionSignature(moving,d);flowKernel(moving);const activeAfter=motionSignature(moving,d);
  return{before,after,frozen:before===after,activeBefore,activeAfter,moved:activeBefore!==activeAfter};
};
globalThis.__tlPumpFixture=()=>{
  const make=dir=>{const S=cloneWorld(WORLD);S.level=4;S.power=12;S.nodes.forEach(n=>{n.v=0;n.sed=0;});
    S.edges.forEach(e=>{e.pipe=0;e.sed=0;e.gate=e.gateTarget=0;e.broken=false;e.energyCarry=0;});
    const e=S.edges[10];e.gate=e.gateTarget=100;e.pumpDir=dir;const src=dir>0?e.a:e.b,dst=dir>0?e.b:e.a;
    S.nodes[src].v=1000;S.initial=currentWater(S);S.source=S.delivered=S.spilled=S.returned=0;
    const p0=S.power;for(let i=0;i<150;i++)flowKernel(S);
    return{src,dst,source:S.nodes[src].v,target:S.nodes[dst].v,pipe:e.pipe,power0:p0,power:S.power,carry:e.energyCarry,
      ledger:waterLedger(S),initial:S.initial};};
  return{forward:make(1),reverse:make(-1)};
};
globalThis.__tlSedimentFixture=()=>{
  const S=cloneWorld(WORLD);S.level=4;S.power=900;S.nodes.forEach(n=>{n.v=0;n.sed=0;});
  S.edges.forEach(e=>{e.pipe=0;e.sed=0;e.gate=e.gateTarget=0;e.broken=false;e.energyCarry=0;});
  S.nodes[4].v=1800;S.nodes[4].sed=900;const e=S.edges[17];e.gate=e.gateTarget=100;
  S.initial=currentWater(S);S.initialSed=currentSed(S);S.source=S.delivered=S.spilled=S.returned=S.sourceSed=S.sedWaste=0;
  const startRate=gateRate(e),clogRate=gateRate({...e,sed:900});for(let i=0;i<900;i++)flowKernel(S);const downstream=S.nodes[10].sed+e.sed;
  return{centralWater:S.nodes[4].v,centralSed:S.nodes[4].sed,downstream,pipeSed:e.sed,startRate,clogRate,endRate:gateRate(e),
    ledger:waterLedger(S),sedLedger:sedLedger(S),initial:S.initial,initialSed:S.initialSed};
};
globalThis.__tlRepairFixture=()=>{
  resetCity();const e=WORLD.edges[6],p=edgePoint(e,.52),start=Math.hypot(drone.x-p.x,drone.y-p.y);breachEdge(e.id,true);
  let frames=0,maxTravel=0,sawTravel=false,sawRepair=false;
  while(e.broken&&frames++<2400){cityFrame++;stepDrone();maxTravel=Math.max(maxTravel,drone.travel);sawTravel=sawTravel||drone.mode==='travel';sawRepair=sawRepair||drone.mode==='repair';}
  return{start,frames,maxTravel,sawTravel,sawRepair,repaired:!e.broken,repairs:stats.repairs,mode:drone.mode,
    travelAverage:stats.repairTravel,finite:finiteState()};
};
globalThis.__tlPlannerFixture=()=>{
  resetCity();for(let i=0;i<120;i++){cityFrame++;stepGates();stepSource();flowKernel(WORLD);stepDistricts();stepCatch();}
  const snap=plannerSnapshot(),before=__tlCore(WORLD),candidate={mode:'BALANCE',target:0};
  const a=simulateSchedule(snap,candidate),middle=__tlCore(WORLD),b=simulateSchedule(snap,candidate),after=__tlCore(WORLD);
  return{pure:before===middle&&middle===after,repeat:JSON.stringify(a)===JSON.stringify(b),a,b,finite:finiteState()};
};
globalThis.__tlAdmireFixture=()=>{
  resetCity();delete globalThis.__NO_ADMIRE;presentation={admire:false};lastIntent=null;nextPlanFrame=0;
  const normal=botIntent();presentation={admire:true};const admire=botIntent();presentation={admire:false};const after=botIntent();
  globalThis.__NO_ADMIRE=1;presentation={admire:true};const ablated=botIntent();presentation={admire:false};const ablatedAfter=botIntent();
  delete globalThis.__NO_ADMIRE;presentation={admire:false};
  return{normal:normal.tactic,admire:admire.tactic,after:after.tactic,ablated:ablated.tactic,ablatedAfter:ablatedAfter.tactic};
};
globalThis.__tlActSetup=(kind,at)=>{
  resetCity();globalThis.__tlNotes.length=0;cloud.next=kind==='cloudburst'?at:1e9;silt.next=kind==='silt-bore'?at:1e9;
  return{persona:persona.name};
};
globalThis.__tlActState=()=>({cityFrame,cloud:{...cloud},silt:{...silt},signature:worldSignature(WORLD),
  gates:WORLD.edges.map(e=>e.gateTarget),tactic:stats.tactic,notes:globalThis.__tlNotes.map(e=>({...e}))});
globalThis.__tlManualState=()=>({playing:playing(),selectedGate,selectedPump,
  gateId:gateIds[selectedGate],gate:{...WORLD.edges[gateIds[selectedGate]]},pumpId:pumpIds[selectedPump],pump:{...WORLD.edges[pumpIds[selectedPump]]}});
globalThis.__tlManualUnlock=()=>{WORLD.level=4;return WORLD.level;};
`;

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const median=a=>{const b=a.slice().sort((x,y)=>x-y),m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])/2;};

console.log('1) fixed-point water: conservation and edge-order independence');
let game=bootGame('tidelatch',{seed:0x71d001,footer:FOOTER});
const order=game.sandbox.__tlOrderFixture();
console.log(`  forward/reverse identical ${order.same}; water ${order.waterA}/${order.initial}; sediment ${order.sedimentA}/${order.initialSed}`);
if(!order.same)fail('reversing edge traversal changed the double-buffered flow result');
if(order.waterA!==order.initial||order.waterB!==order.initial)fail(`water was created/lost (${order.waterA}/${order.waterB}, expected ${order.initial})`);
if(order.sedimentA!==order.initialSed||order.sedimentB!==order.initialSed)fail(`sediment was created/lost (${order.sedimentA}/${order.sedimentB})`);
const frozen=game.sandbox.__tlFrozenMotionFixture();
console.log(`  motion signature frozen ${frozen.before}->${frozen.after}; active flow ${frozen.activeBefore}->${frozen.activeAfter}`);
if(!frozen.frozen||!frozen.moved)fail(`motion signature uses time/counters or misses real flow: ${JSON.stringify(frozen)}`);

console.log('2) pumps: both directions move conserved water and debit stored power');
const pumps=game.sandbox.__tlPumpFixture();
for(const[name,p]of Object.entries(pumps)){
  console.log(`  ${name}: source ${p.source}, target ${p.target}, pipe ${p.pipe}, power ${p.power0}->${p.power}`);
  if(p.target<300||p.source>700)fail(`${name} pump barely moved water: ${JSON.stringify(p)}`);
  if(!(p.power<p.power0&&p.power>=0&&p.carry>=0&&p.carry<64))fail(`${name} pump accounting regressed: ${JSON.stringify(p)}`);
  if(p.ledger!==p.initial)fail(`${name} pump violated conservation: ${JSON.stringify(p)}`);
}

console.log('3) sediment: a real flush carries silt through the canal without deleting it');
const sediment=game.sandbox.__tlSedimentFixture();
console.log(`  central silt ${sediment.centralSed}, downstream ${sediment.downstream}, clean/clogged rate ${sediment.startRate}/${sediment.clogRate}`);
if(sediment.centralSed>180||sediment.downstream<700)fail(`flush did not physically transport most sediment: ${JSON.stringify(sediment)}`);
if(!(sediment.clogRate<sediment.startRate))fail(`sediment no longer reduces pipe capacity: ${JSON.stringify(sediment)}`);
if(sediment.ledger!==sediment.initial||sediment.sedLedger!==sediment.initialSed)fail(`flush violated a conservation ledger: ${JSON.stringify(sediment)}`);

console.log('4) breach recovery: the drone travels to the pipe, works, then seals it');
const repair=game.sandbox.__tlRepairFixture();
console.log(`  ${repair.start.toFixed(1)}px trip, ${repair.frames}f to seal, traveled ${repair.maxTravel.toFixed(1)}px, mode ${repair.mode}`);
if(!repair.sawTravel||!repair.sawRepair||!repair.repaired||repair.repairs!==1)fail(`repair phases were not all visible: ${JSON.stringify(repair)}`);
if(repair.frames<repair.start/.48+180||repair.maxTravel<repair.start-.6)fail(`repair completed without paying physical travel+work time: ${JSON.stringify(repair)}`);
if(!repair.finite)fail('repair fixture produced non-finite state');

console.log('5) planner: copied four-second schedule is repeatable and sim-state pure');
const planner=game.sandbox.__tlPlannerFixture();
console.log(`  repeat ${planner.repeat}, pure ${planner.pure}, served ${planner.a.served.toFixed(0)}, score ${planner.a.score.toFixed(0)}`);
if(!planner.pure||!planner.repeat)fail(`flow schedule planning mutated runtime state or was nondeterministic: ${JSON.stringify(planner)}`);
if(planner.a.served<=0||!Number.isFinite(planner.a.score)||!planner.finite)fail(`planner did not evaluate a meaningful finite schedule: ${JSON.stringify(planner.a)}`);
const admire=game.sandbox.__tlAdmireFixture();
console.log(`  admire gate: normal ${admire.normal}, directive ${admire.admire}, after ${admire.after}; ablated ${admire.ablated}, after ${admire.ablatedAfter}`);
if(admire.normal==='ADMIRE'||admire.admire!=='ADMIRE'||admire.after==='ADMIRE'||admire.ablated==='ADMIRE'||admire.ablatedAfter==='ADMIRE')
  fail(`__NO_ADMIRE did not gate the bot-only pause cleanly: ${JSON.stringify(admire)}`);

console.log('6) measured outcomes + paired A/B: 10 same-seed ten-minute cities');
const smartRuns=[],greedyRuns=[];let wins=0,smartFailures=0,totalBreaches=0;
for(let i=0;i<10;i++){
  const seed=0x71d100+i,a=bootGame('tidelatch',{seed,footer:FOOTER}),b=bootGame('tidelatch',{seed,footer:FOOTER});
  b.sandbox.__NO_FLOW_PLAN=1;a.frames(36000,false);b.frames(36000,false);
  const pa=a.sandbox.__tlProbe(),pb=b.sandbox.__tlProbe();smartRuns.push(pa);greedyRuns.push(pb);
  const scoreA=pa.stats.deliveries-pa.stats.misses*.7,scoreB=pb.stats.deliveries-pb.stats.misses*.7;if(scoreA>scoreB)wins++;
  smartFailures+=pa.stats.misses+pa.stats.breaches;
  totalBreaches+=pa.stats.breaches;
  console.log(`  seed ${seed.toString(16)} ${pa.persona.padEnd(11)} smart ${pa.stats.deliveries} flow/${pa.stats.misses} dry/${pa.stats.breaches} breach `+
    `vs greedy ${pb.stats.deliveries}/${pb.stats.misses}/${pb.stats.breaches}; lull ${(pa.stats.maxDry/60).toFixed(1)}s`);
  if(!pa.finite||pa.ledger!==5700||pa.sedLedger!==0)fail(`seed ${seed.toString(16)}: non-finite or non-conservative smart run`);
  if(pa.stats.activations!==4)fail(`seed ${seed.toString(16)}: only ${pa.stats.activations}/4 districts activated`);
  if(pa.stats.deliveries<125||pa.stats.deliveries>190)fail(`seed ${seed.toString(16)}: ${pa.stats.deliveries} deliveries outside measured band 125..190`);
  if(pa.stats.misses<1||pa.stats.misses>35)fail(`seed ${seed.toString(16)}: ${pa.stats.misses} dry failures outside honest band 1..35`);
  if(pa.stats.breaches<0||pa.stats.breaches>8)fail(`seed ${seed.toString(16)}: ${pa.stats.breaches} breaches outside 0..8`);
  if(pa.stats.repairs>pa.stats.breaches||pa.stats.repairs<pa.stats.breaches-1)fail(`seed ${seed.toString(16)}: repair accounting ${pa.stats.repairs}/${pa.stats.breaches}`);
  if(pa.stats.maxDry>1800)fail(`seed ${seed.toString(16)}: city went dry for ${(pa.stats.maxDry/60).toFixed(1)}s (limit 30s)`);
  if(pa.stats.planSims<250||pb.stats.planSims!==0)fail(`seed ${seed.toString(16)}: planner ablation was not real (${pa.stats.planSims}/${pb.stats.planSims})`);
}
const smartDeliveries=smartRuns.map(p=>p.stats.deliveries),greedyDeliveries=greedyRuns.map(p=>p.stats.deliveries),
  smartMedian=median(smartDeliveries),greedyMedian=median(greedyDeliveries),gain=(smartMedian-greedyMedian)/greedyMedian;
const variants=new Set(smartRuns.map(p=>p.cityVariant)),personas=new Set(smartRuns.map(p=>p.persona)),signatures=new Set(smartRuns.map(p=>p.signature));
console.log(`  planner wins ${wins}/10; median ${smartMedian} vs ${greedyMedian} (${(gain*100).toFixed(1)}%); retained failures ${smartFailures}; `+
  `diversity ${variants.size} city variants/${personas.size} personas/${signatures.size} endings`);
if(wins<8)fail(`flow planner won only ${wins}/10 paired seeds`);
if(gain<.15)fail(`median fulfilled-demand gain ${(gain*100).toFixed(1)}% is below 15%`);
if(smartFailures<=0)fail('planner eliminated all breaches/dry districts — play became robotically perfect');
if(totalBreaches<3)fail(`only ${totalBreaches} honest breaches across 10 seeds — failure spectacle nearly disappeared`);
if(variants.size<8||personas.size<3||signatures.size<8)fail(`seed freshness too low (${variants.size} variants, ${personas.size} personas, ${signatures.size} endings)`);

console.log('  fresh band sweep: 10 additional ten-minute cities (20 measured seeds total)');
{
  const fresh=[];
  for(let i=0;i<10;i++){
    const seed=0x71d800+i,g=bootGame('tidelatch',{seed,footer:FOOTER});g.frames(36000,false);
    const p=g.sandbox.__tlProbe();fresh.push(p);
    if(!p.finite||p.ledger!==5700||p.sedLedger!==0)fail(`fresh seed ${seed.toString(16)}: non-finite or non-conservative run`);
    if(p.stats.activations!==4)fail(`fresh seed ${seed.toString(16)}: only ${p.stats.activations}/4 districts activated`);
    if(p.stats.deliveries<125||p.stats.deliveries>190)fail(`fresh seed ${seed.toString(16)}: ${p.stats.deliveries} deliveries outside 125..190`);
    if(p.stats.misses<1||p.stats.misses>35)fail(`fresh seed ${seed.toString(16)}: ${p.stats.misses} dry failures outside 1..35`);
    if(p.stats.breaches<0||p.stats.breaches>8)fail(`fresh seed ${seed.toString(16)}: ${p.stats.breaches} breaches outside 0..8`);
    if(p.stats.repairs>p.stats.breaches||p.stats.repairs<p.stats.breaches-1)fail(`fresh seed ${seed.toString(16)}: repair accounting ${p.stats.repairs}/${p.stats.breaches}`);
    if(p.stats.maxDry>1800)fail(`fresh seed ${seed.toString(16)}: city went dry for ${(p.stats.maxDry/60).toFixed(1)}s`);
    if(p.stats.planSims<250)fail(`fresh seed ${seed.toString(16)}: planner did not stay active (${p.stats.planSims} simulations)`);
  }
  const delivery=fresh.map(p=>p.stats.deliveries),misses=fresh.map(p=>p.stats.misses),breaches=fresh.map(p=>p.stats.breaches);
  console.log(`  fresh ranges: ${Math.min(...delivery)}..${Math.max(...delivery)} deliveries, ${Math.min(...misses)}..${Math.max(...misses)} dry failures, ${Math.min(...breaches)}..${Math.max(...breaches)} breaches`);
}

console.log('7) city arc + show ladder: River Crown after ten minutes with exact apex budget');
game=bootGame('tidelatch',{seed:0x71d300,footer:FOOTER});game.frames(43200,false);const arc=game.sandbox.__tlProbe(),show=arc.show,
  offered=show.offeredByTier,s3=show.shownByTier[3]||0;
console.log(`  ${arc.stats.deliveries} deliveries, ${arc.stats.crowns} crown; tiers ${JSON.stringify(offered)}, held ${show.heldFrames}f, slowed ${show.slowedFrames}f, admire ${show.admireFrames}f`);
if(!arc.crowned||arc.stats.crowns!==1||s3!==1)fail('12-minute city never culminated in exactly one River Crown');
if(!((offered[1]||0)>(offered[2]||0)&&(offered[2]||0)>(offered[3]||0)&&(offered[3]||0)>=1))
  fail(`payoff opportunities are not strictly tier-ordered: ${JSON.stringify(offered)}`);
if(show.heldFrames!==6*s3)fail(`apex hitstop ${show.heldFrames}f != 6f per crown`);
if(show.slowedFrames!==18*s3)fail(`apex slow-mo ${show.slowedFrames}f != 18f per crown`);
if(show.admireFrames!==36*s3)fail(`bot admire window ${show.admireFrames}f != 36f per crown`);

console.log('8) acts: Cloudburst and Silt Bore telegraph, pair notes, and change the bot before landing');
for(const spec of[{kind:'cloudburst',warn:240},{kind:'silt-bore',warn:210}]){
  const seed=spec.kind==='cloudburst'?0x71d401:0x71d402,a=bootGame('tidelatch',{seed,footer:FOOTER}),b=bootGame('tidelatch',{seed,footer:FOOTER});
  a.sandbox.__tlActSetup(spec.kind,600);b.sandbox.__tlActSetup(spec.kind,600);b.sandbox.__NO_ACTS=1;
  let first=-1,phase='',divergeTactic='';for(let f=0;f<1200;f++){a.frames(1,false);b.frames(1,false);const sa=a.sandbox.__tlActState(),sb=b.sandbox.__tlActState();
    if(first<0&&sa.signature!==sb.signature){first=f+1;phase=spec.kind==='cloudburst'?sa.cloud.phase:sa.silt.phase;divergeTactic=sa.tactic;}}
  const s=a.sandbox.__tlActState(),warn=s.notes.find(e=>e.kind==='act-warning'&&e.id===spec.kind),land=s.notes.find(e=>e.kind==='act-land'&&e.id===spec.kind);
  console.log(`  ${spec.kind}: ${warn&&land?land.tag-warn.tag:'?'}f warning, first divergence ${first}f in ${phase}, tactic ${divergeTactic}`);
  if(!warn||!land||land.tag-warn.tag!==spec.warn)fail(`${spec.kind} note pair/telegraph regressed: ${JSON.stringify(s.notes)}`);
  if(first<0||phase!=='warn')fail(`${spec.kind} bot first diverged in '${phase}' at ${first}, not during warning`);
  const expected=spec.kind==='cloudburst'?'VENT':'FLUSH';if(divergeTactic!==expected)fail(`${spec.kind} warning divergence was '${divergeTactic}', expected ${expected}`);
}

console.log('9) payoff FX: same-seed complete simulation signature is identical');
{
  const a=bootGame('tidelatch',{seed:0x71d500,footer:FOOTER}),b=bootGame('tidelatch',{seed:0x71d500,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;a.frames(14400,false);b.frames(14400,false);
  const sa=a.sandbox.__tlSimSig(),sb=b.sandbox.__tlSimSig();
  console.log(`  4-minute signatures ${sa===sb?'identical':'DIFFERENT'}`);if(sa!==sb)fail('__NO_PAYOFF_FX changed fluid, district, act, drone, or score state');
}

console.log('10) session + manual controls: gate select/toggle and pump select/reverse');
game=bootGame('tidelatch',{seed:0x71d600,footer:FOOTER});let m0=game.sandbox.__tlManualState();
press(game,'Enter');let m1=game.sandbox.__tlManualState();press(game,'Enter');let m2=game.sandbox.__tlManualState();
game.sandbox.__tlManualUnlock();press(game,'ArrowRight');let m3=game.sandbox.__tlManualState();const target0=m3.gate.gateTarget;press(game,'Space');let m4=game.sandbox.__tlManualState();
press(game,'ArrowDown');let m5=game.sandbox.__tlManualState();const dir0=m5.pump.pumpDir;press(game,'KeyX');let m6=game.sandbox.__tlManualState();
console.log(`  gate ${m2.gateId}->${m3.gateId}, target ${target0}->${m4.gate.gateTarget}; pump ${m2.pumpId}->${m5.pumpId}, dir ${dir0}->${m6.pump.pumpDir}`);
if(m0.playing||m1.playing||!m2.playing)fail('two-step Enter session gate regressed');
if(m3.gateId===m2.gateId)fail('manual Right did not select a different gate');
if(m4.gate.gateTarget===target0)fail('manual Space did not toggle the selected gate through common intent physics');
if(m5.pumpId===m2.pumpId)fail('manual Down did not select a different pump');
if(m6.pump.pumpDir!==-dir0)fail('manual X did not reverse the selected pump');

console.log('11) ten-minute soak: water moves, events happen, districts progress');
{
  const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
  const{samples}=runSoak('tidelatch',{seed:0x71d700,footer:FOOTER,minutes:10}),report=analyzeSoak(samples);
  console.log('  '+soakLine(report));
  assertSoak('soak',report,{still:2,quiet:12,stall:30,minEvents:1200,minProgress:120},fail);
}

console.log('12) browser-first render: network, districts, water, drone, and HUD draw materially');
game=bootGame('tidelatch',{seed:0x71d800,footer:FOOTER});game.frames(360,false);game.counter.calls=0;game.counter.byMethod={};game.sandbox.draw();
console.log(`  ${game.counter.calls} canvas calls, ${game.counter.byMethod.fillRect||0} pixel fills, ${game.counter.byMethod.lineTo||0} routed segments`);
if(game.counter.calls<220||(game.counter.byMethod.fillRect||0)<60||(game.counter.byMethod.lineTo||0)<30)fail('native render lacks material network/route detail');

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
