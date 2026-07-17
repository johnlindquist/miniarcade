#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
const{runMotion,analyzeMotion,assertMotion,motionLine}=require('./motion');
const{runFeedbackVisibility,assertFeedback,feedbackLine}=require('./feedback');

// Observation only: none of these hooks make decisions, touch physics values,
// draw, or consume either RNG stream.
const FOOTER=String.raw`
globalThis.__arApplied=[];
{const old=advanceBike;advanceBike=function(body,intent,env){const out=old(body,intent,env);
  if(body===player){globalThis.__arApplied.push({showFrame,runFrame,steer:intent.steer,throttle:intent.throttle,
    brake:!!intent.brake,boost:!!intent.boost,swing:intent.swing||0,targetX:intent.targetX,tactic:intent.tactic});
    if(globalThis.__arApplied.length>360)globalThis.__arApplied.shift();}return out;};}
globalThis.__arClearApplied=()=>{globalThis.__arApplied.length=0;};
globalThis.__arLastApplied=()=>globalThis.__arApplied.at(-1)||null;
globalThis.__arContinuity={max:0,from:null,to:null};
{const old=stepPlayer;stepPlayer=function(){const from={x:player.x,y:player.y},out=old(),to={x:player.x,y:player.y},
  d=Math.hypot(to.x-from.x,to.y-from.y);if(d>globalThis.__arContinuity.max)globalThis.__arContinuity={max:d,from,to};return out;};}
globalThis.__arReset=()=>resetRun(true);
globalThis.__arRivalKinds=()=>{const out={};for(const r of rivals)out[r.kind]=(out[r.kind]||0)+1;return out;};
globalThis.__arActRivalPositions=()=>rivals.map(r=>[r.id,round(r.x,4),round(r.y,4),r.state]);
globalThis.__arTrafficState=()=>traffic.map(t=>({x:Math.round(t.x),y:Math.round(t.y),speed:+t.speed.toFixed(3)}));
// Overlap contract (owner directive 2026-07-16): nobody rides on top of
// anybody. Hard overlap = deeper than the drawn bodies allow; the resolver
// must clear it within a few frames, always.
globalThis.__arOverlap={worst:0,maxRun:0,run:0};
globalThis.__arOverlapScan=()=>{
  const bodies=[player,...rivals.filter(r=>r.respawnT<=0&&r.state!=='down')];
  let hard=0;
  for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
    const a=bodies[i],b=bodies[j];
    if(Math.abs(a.x-b.x)<4.5&&Math.abs(a.y-b.y)<8)hard++;
  }
  for(const t of traffic)for(const b of bodies){
    if(Math.abs(b.x-t.x)<6&&Math.abs(b.y-t.y)<9)hard++;
  }
  for(let i=0;i<traffic.length;i++)for(let j=i+1;j<traffic.length;j++){
    const a=traffic[i],b=traffic[j];
    if(Math.abs(a.x-b.x)<6&&Math.abs(a.y-b.y)<9)hard++;
  }
  const O=globalThis.__arOverlap;O.worst=Math.max(O.worst,hard);
  O.run=hard?O.run+1:0;O.maxRun=Math.max(O.maxRun,O.run);
  return hard;
};
{const old=stepWorld;stepWorld=function(){const out=old();globalThis.__arOverlapScan();return out;};}
// Eval-only hooks: top up nitro for keyboard checks, and stage a hard overlap
// the resolver must clear. Neither runs during measured sweeps.
globalThis.__arTopBoost=()=>{player.boost=100;};
globalThis.__arContactFixture=()=>{
  player.x=80;player.y=5000;player.vx=0;player.speed=1.6;player.wobbleT=0;player.wreckT=0;
  rivals.length=0;traffic.length=0;
  const a=makeRival('veteran',81,5001),b=makeRival('bruiser',120,5400);
  rivals.push(a,b);traffic.push({id:9001,x:80,y:5008,vx:0,speed:.8,kind:'sedan',color:'#c96a5a',hit:false,hitCd:0,wob:0});
  return{player:{x:player.x,y:player.y},rival:{x:a.x,y:a.y},car:{x:80,y:5008}};
};
globalThis.__arQueueFixture=()=>{
  player.x=80;player.y=5000;player.vx=0;player.speed=1.6;player.wobbleT=0;player.wreckT=0;
  rivals.length=0;traffic.length=0;
  traffic.push({id:9002,x:80,y:5060,vx:0,speed:1.05,kind:'sedan',color:'#6aa8b8',hit:false,hitCd:0,wob:0},
    {id:9003,x:81,y:5052,vx:0,speed:.5,kind:'pickup',color:'#c9a24e',hit:false,hitCd:0,wob:0});
  return traffic.map(t=>({x:t.x,y:t.y,speed:t.speed}));
};
globalThis.__arHardOverlapNow=()=>{
  const bodies=[player,...rivals.filter(r=>r.respawnT<=0&&r.state!=='down')];
  let hard=0;
  for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
    const a=bodies[i],b=bodies[j];
    if(Math.abs(a.x-b.x)<4.5&&Math.abs(a.y-b.y)<8)hard++;
  }
  for(const t of traffic)for(const b of bodies){
    if(Math.abs(b.x-t.x)<6&&Math.abs(b.y-t.y)<9)hard++;
  }
  for(let i=0;i<traffic.length;i++)for(let j=i+1;j<traffic.length;j++){
    const a=traffic[i],b=traffic[j];
    if(Math.abs(a.x-b.x)<6&&Math.abs(a.y-b.y)<9)hard++;
  }
  return hard;
};
// Pose-honesty telemetry: the drawn lean must track actual travel. Persistence
// counters, because honest yaw inertia is ALLOWED to lag a few frames through a
// lateral flip or a wobble — a cosmetic lean would sit wrong-signed for whole
// transits, which no persistence window forgives.
globalThis.__arPose={frames:0,wrongWayRun:0,wrongWayMax:0,wrongWayViolations:0,straightRun:0,crabViolations:0};
{const P=globalThis.__arPose,old=stepPlayer;stepPlayer=function(){const out=old();
  if(player.wreckT>0||player.wobbleT>0||player.contactT>0||player.swingPhase!=='ready')return out; // tumbles/wobbles/bumps/swings pose by their own rules
  P.frames++;
  const va=Math.atan2(player.vx,Math.max(.5,player.speed)),angle=player.angle;
  const wrongWay=Math.abs(player.vx)>.3&&Math.sign(angle)!==Math.sign(va)&&Math.abs(angle)>.06;
  P.wrongWayRun=wrongWay?P.wrongWayRun+1:0;P.wrongWayMax=Math.max(P.wrongWayMax,P.wrongWayRun);
  if(P.wrongWayRun>8)P.wrongWayViolations++;
  const straight=Math.abs(player.vx)<.06&&Math.abs((player.intent&&player.intent.steer)||0)<.1;
  P.straightRun=straight?P.straightRun+1:0;
  if(P.straightRun>20&&Math.abs(angle-va)>.035)P.crabViolations++;
  return out;};}
// Scripted pose fixtures through the SHARED integrator: each one fails a
// cosmetic-lean build (steadyRight must lean INTO travel; release must
// straighten; a wobble must not snap the body opposite the motion).
globalThis.__arPoseFixture=()=>{
  const drive=(b,intent,frames)=>{for(let i=0;i<frames;i++)
    advanceBike(b,Object.assign({steer:0,throttle:1,brake:false,boost:false,swing:0,targetX:80,tactic:'FIXTURE'},intent),{offroad:false,wet:false});
    return{angle:b.angle,vx:b.vx,va:Math.atan2(b.vx,Math.max(.5,b.speed))};};
  const fresh=()=>{const b=makePlayer(80,900);b.speed=2;return b;};
  const straightenBody=fresh();drive(straightenBody,{steer:1},30);
  return{
    steadyRight:drive(fresh(),{steer:1},40),
    straighten:drive(straightenBody,{steer:0},50),
    steadyLeft:drive(fresh(),{steer:-1},40)
  };};
`;

let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const sum=(runs,key)=>runs.reduce((total,p)=>total+p.stats[key],0);
const policyScore=p=>p.stats.overtakes+12*p.stats.kos+3*(p.stats.nitros+p.stats.wrenches+p.stats.weapons)+
  2*p.stats.barrierThreads+p.stats.nearMisses-8*p.stats.wrecks-4*p.stats.barrierHits-4*p.stats.trafficHits-2*p.stats.hitsTaken;
const failures=p=>4*p.stats.wrecks+2*p.stats.barrierHits+p.stats.trafficHits+p.stats.hitsTaken;
const inBands=(p,bands,label)=>{for(const[key,[lo,hi]]of Object.entries(bands)){
  const value=key==='rank'?p.rank:p.stats[key];
  if(value<lo||value>hi)fail(`${label}: ${key} ${value} outside measured band ${lo}..${hi}`);
}};
function notePairs(p,id,label,minPairs){
  const notes=p.act.notes.filter(note=>note.id===id),warn=notes.filter(note=>note.kind==='act-warning'),
    land=notes.filter(note=>note.kind==='act-land'),pending=warn.length===land.length+1&&p.act.phase==='warn'&&
      (!land.length||warn.at(-1).tag>land.at(-1).tag);
  if(land.length<minPairs||!(land.length===warn.length||pending))
    fail(`${label}: ${id} emitted ${warn.length} warnings / ${land.length} lands`);
  for(let i=0;i<land.length;i++){
    if(land[i].tag-warn[i].tag!==240)fail(`${label}: ${id} simulation warning ${land[i].tag-warn[i].tag}f != 240`);
    // Viewer time may only STRETCH past 240 (tier-3 slow-mo), never shrink.
    if(land[i].at-warn[i].at<240)fail(`${label}: ${id} viewer warning ${land[i].at-warn[i].at}f < 240`);
  }
}

// Registered 2026-07-16 (full contact-model build: bike/bike, bike/car,
// car/car queueing) from a fresh ten-seed paired five-minute sweep
// (0x4f00 + i*37), planned-route extrema: markers 179..188, districts 15..16,
// kos 5..14, hits 11..29, hitsTaken 2..15, overtakes 4..12, drops 0..4,
// boosts 15..22, nitros 4..13, wrenches 6..12, weapons 0..7, nearMisses
// 18..48, trafficHits 3..14, oils 1..6, barrierThreads 18..27, barrierHits
// 10..19, wrecks 0..4, lapses 0..3, acts 3, grudgeKos 0..1, actClears 2..3,
// dodges 5..27, whiffs 3..5, counters 0..2, contacts 17..78, packTrafficHits
// 36..89, events 364..508, progress 233..247, rank always 1. ~15-25% margin.
const POLICY_BANDS={
  markers:[165,205],districts:[13,18],kos:[3,17],hits:[8,35],hitsTaken:[1,19],overtakes:[3,15],drops:[0,6],
  boosts:[11,27],nitros:[3,16],wrenches:[4,15],weapons:[0,9],nearMisses:[13,58],trafficHits:[2,17],oils:[0,8],
  barrierThreads:[14,33],barrierHits:[7,24],wrecks:[0,6],lapses:[0,4],acts:[3,3],grudgeKos:[0,3],actClears:[1,3],
  dodges:[3,34],whiffs:[2,8],counters:[0,4],contacts:[12,94],packTrafficHits:[27,107],events:[330,570],
  progress:[210,275],rank:[1,2]
};
// Same sweep, __NO_ROUTE_PLAN baseline extrema: markers 166..176, districts
// 14..15, kos 12..32, hits 17..41, hitsTaken 7..30, overtakes 3..22, drops
// 1..7, boosts 19..28, nitros 2..13, wrenches 2..12, weapons 0..7, nearMisses
// 71..92, trafficHits 20..32, oils 1..5, barrierThreads 6..18, barrierHits
// 17..29, wrecks 5..10, lapses 0..3, acts 3, grudgeKos 0..2, actClears 1..3,
// dodges 15..71, whiffs 3..10, counters 1..4, contacts 32..83, packTrafficHits
// 90..140, events 519..680, progress 225..258, rank 1..4.
const REACTIVE_BANDS={
  markers:[150,190],districts:[12,17],kos:[9,38],hits:[13,49],hitsTaken:[5,36],overtakes:[2,26],drops:[0,10],
  boosts:[14,34],nitros:[1,16],wrenches:[1,15],weapons:[0,9],nearMisses:[60,106],trafficHits:[15,38],oils:[0,7],
  barrierThreads:[4,22],barrierHits:[13,35],wrecks:[4,13],lapses:[0,4],acts:[3,3],grudgeKos:[0,3],actClears:[1,3],
  dodges:[11,82],whiffs:[2,13],counters:[0,6],contacts:[24,96],packTrafficHits:[75,160],events:[460,750],
  progress:[200,285],rank:[1,5]
};

// Measured 2026-07-16 (full contact-model build) from two independent
// ten-minute soaks (0x5200, 0x52d4): still 0s, quiet 1s, stall 1s, events
// 722..758, progress 485..490, rank 1, acts x6 lands, tier3 shown 3..4, lulls
// 131..134 / 130..149.
const SOAK_BANDS={
  markers:[345,420],districts:[27,36],kos:[4,13],hits:[8,21],hitsTaken:[1,8],overtakes:[4,10],drops:[0,6],
  boosts:[28,46],nitros:[16,30],wrenches:[17,31],weapons:[7,17],nearMisses:[46,86],trafficHits:[10,23],oils:[2,9],
  barrierThreads:[40,62],barrierHits:[19,36],wrecks:[0,4],lapses:[0,5],acts:[5,6],grudgeKos:[0,3],actClears:[2,6],
  dodges:[7,21],whiffs:[3,14],counters:[0,4],contacts:[32,66],packTrafficHits:[30,70],events:[640,850],
  progress:[410,550],rank:[1,2]
};

// Motion-contract pace floors, measured over seed 0x6100 three-minute motion
// run on the shared-integrator build: rider mean 2.185 px/f, pack mean
// 2.073..2.161 px/f. Floors keep ~10% margin under the measured minima.
const RIDER_PACE_FLOOR=1.9,PACK_PACE_FLOOR=1.85;
const paceOf=run=>{const per=new Map();let prev=null;
  for(const s of run.samples){if(prev)for(const a of s.actors){const b=prev.actors.find(q=>q.id===a.id);if(!b)continue;
    const d=Math.hypot(a.x-b.x,a.y-b.y),t=per.get(a.id)||{d:0,f:0};t.d+=d;t.f+=run.step;per.set(a.id,t);}prev=s;}
  const pack=[...per.entries()].filter(([id])=>id!=='rider').map(([,t])=>t.d/t.f),d=per.get('rider');
  return{rider:d?d.d/d.f:0,packMean:pack.length?pack.reduce((a,b)=>a+b,0)/pack.length:0,packCount:pack.length};};

console.log('1) fixed 60 Hz determinism, render parity, chunk parity, and finite renderer');
{
  const a=bootGame('ashen-rage',{seed:0x4e01,footer:FOOTER}),
    b=bootGame('ashen-rage',{seed:0x4e01,footer:FOOTER}),
    rendered=bootGame('ashen-rage',{seed:0x4e01,footer:FOOTER});
  a.frames(3600,false);b.frames(3600,false);const draws=rendered.frames(3600,true);
  const sa=a.sandbox.__ashenRageSignature(),sb=b.sandbox.__ashenRageSignature(),sr=rendered.sandbox.__ashenRageSignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${draws.calls} draw calls`);
  if(sa!==sb)fail('same seed diverged at fixed 60 Hz');
  if(sa!==sr)fail('render traversal changed simulation state or RNG');
  if(!a.sandbox.__ashenRageProbe().finite||!rendered.sandbox.__ashenRageProbe().finite)fail('headless or rendered replay became non-finite');
  if(draws.calls<1000||!draws.byMethod.fillRect||!draws.byMethod.beginPath||!draws.byMethod.fillText)
    fail(`renderer was not genuinely exercised: ${JSON.stringify(draws.byMethod)}`);

  const mono=bootGame('ashen-rage',{seed:0x4e02,footer:FOOTER}),chunked=bootGame('ashen-rage',{seed:0x4e02,footer:FOOTER});
  mono.frames(2400,false);for(let i=0;i<240;i++)chunked.frames(10,false);
  const same=mono.sandbox.__ashenRageSignature()===chunked.sandbox.__ashenRageSignature();
  console.log(`  2,400 monolithic frames vs 240 x 10: ${same?'identical':'DIFFERENT'}`);
  if(!same)fail('headless batching changed fixed-step simulation');
}

console.log('2) route lookahead is pure, repeatable, RNG-inert, and uses the shared integrator');
{
  const planned=bootGame('ashen-rage',{seed:0x4e10,footer:FOOTER}),control=bootGame('ashen-rage',{seed:0x4e10,footer:FOOTER}),
    fixture=planned.sandbox.__ashenRagePlannerFixture();
  const nextPlanned=planned.sandbox.__ashenRageNextRandom(),nextControl=control.sandbox.__ashenRageNextRandom();
  console.log(`  pure ${fixture.pure}; repeat ${fixture.repeat}; route ${fixture.plan&&fixture.plan.route} @ ${fixture.plan&&fixture.plan.targetX}; RNG ${nextPlanned.toFixed(8)}/${nextControl.toFixed(8)}`);
  if(!fixture.pure||!fixture.repeat||!fixture.finite||!fixture.plan||!Number.isFinite(fixture.plan.score))
    fail(`planner fixture regressed: ${JSON.stringify(fixture)}`);
  if(nextPlanned!==nextControl)fail('route planning consumed engine RNG for simulation-invisible work');
}

console.log('3) baseline-first route-policy A/B: ten paired five-minute seeds');
{
  const smart=[],reactive=[];let scoreWins=0,failureWins=0;
  for(let i=0;i<10;i++){
    const seed=0x4f00+i*37,a=bootGame('ashen-rage',{seed,footer:FOOTER}),b=bootGame('ashen-rage',{seed,footer:FOOTER});
    b.sandbox.__NO_ROUTE_PLAN=1;a.frames(18000,false);b.frames(18000,false);
    const pa=a.sandbox.__ashenRageProbe(),pb=b.sandbox.__ashenRageProbe();smart.push(pa);reactive.push(pb);
    if(policyScore(pa)>policyScore(pb))scoreWins++;if(failures(pa)<failures(pb))failureWins++;
    inBands(pa,POLICY_BANDS,`seed ${seed.toString(16)} planned`);
    inBands(pb,REACTIVE_BANDS,`seed ${seed.toString(16)} reactive`);
    for(const[p,label]of[[pa,'planned'],[pb,'reactive']]){
      if(!p.finite)fail(`seed ${seed.toString(16)} ${label}: non-finite state`);
      if(p.stats.maxEventLull>360||p.stats.maxProgressLull>420)fail(`seed ${seed.toString(16)} ${label}: story lull ${p.stats.maxEventLull}/${p.stats.maxProgressLull}f`);
    }
    console.log(`  ${seed.toString(16)} ${pa.persona.padEnd(10)} score ${policyScore(pa)}/${policyScore(pb)}, `+
      `KOs ${pa.stats.kos}/${pb.stats.kos}, failures ${failures(pa)}/${failures(pb)}`);
  }
  const score=[sum(smart,'overtakes')+12*sum(smart,'kos')+3*(sum(smart,'nitros')+sum(smart,'wrenches')+sum(smart,'weapons'))+
      2*sum(smart,'barrierThreads')+sum(smart,'nearMisses')-8*sum(smart,'wrecks')-4*sum(smart,'barrierHits')-4*sum(smart,'trafficHits')-2*sum(smart,'hitsTaken'),
    sum(reactive,'overtakes')+12*sum(reactive,'kos')+3*(sum(reactive,'nitros')+sum(reactive,'wrenches')+sum(reactive,'weapons'))+
      2*sum(reactive,'barrierThreads')+sum(reactive,'nearMisses')-8*sum(reactive,'wrecks')-4*sum(reactive,'barrierHits')-4*sum(reactive,'trafficHits')-2*sum(reactive,'hitsTaken')],
    bad=[smart.reduce((n,p)=>n+failures(p),0),reactive.reduce((n,p)=>n+failures(p),0)],
    traffic=[sum(smart,'trafficHits'),sum(reactive,'trafficHits')],wreckSums=[sum(smart,'wrecks'),sum(reactive,'wrecks')],
    baseline={kos:sum(reactive,'kos'),overtakes:sum(reactive,'overtakes'),boosts:sum(reactive,'boosts'),
      nitros:sum(reactive,'nitros'),events:sum(reactive,'events')};
  console.log(`  ${scoreWins}/10 score wins; ${failureWins}/10 failure wins; score ${score[0]}/${score[1]}, `+
    `failures ${bad[0]}/${bad[1]}, traffic hits ${traffic[0]}/${traffic[1]}, wrecks ${wreckSums[0]}/${wreckSums[1]}`);
  if(scoreWins<7||failureWins<9)fail(`route plan did not win clearly enough (${scoreWins}/10 score, ${failureWins}/10 failures)`);
  // Measured 2026-07-16 sweep (full contact-model build): score 1232 vs 768,
  // failures 509 vs 1144, traffic hits ~78 vs ~258, wrecks ~25 vs ~75 across
  // the ten paired seeds.
  if(score[0]<700||score[0]<score[1]*1.3||bad[0]>bad[1]*.55||traffic[0]>traffic[1]*.45||wreckSums[0]>wreckSums[1]*.55)
    fail(`aggregate route-policy win regressed: ${JSON.stringify({score,bad,traffic,wreckSums})}`);
  if(baseline.kos<80||baseline.overtakes<40||baseline.events<4000)
    fail(`__NO_ROUTE_PLAN baseline stopped honestly participating: ${JSON.stringify(baseline)}`);
}

console.log('4) GRUDGE and PACK TURNS change the world during an exact 240f warning');
for(const type of['grudge','pack']){
  const seed=type==='grudge'?0x5010:0x5011,a=bootGame('ashen-rage',{seed,footer:FOOTER}),b=bootGame('ashen-rage',{seed,footer:FOOTER});
  a.sandbox.__ashenRageActFixture(type);b.sandbox.__ashenRageActFixture(type);b.sandbox.__NO_ACTS=1;
  const phys=sandbox=>{const p=sandbox.__ashenRageProbe();
    return sandbox.__ashenRagePhysical()+'|'+p.player.rank+'|'+JSON.stringify(sandbox.__arActRivalPositions?sandbox.__arActRivalPositions():[]);};
  if(phys(a.sandbox)!==phys(b.sandbox))fail(`${type}: paired act fixture did not start identical`);
  let first=-1,phase='';
  for(let frame=1;frame<=270;frame++){
    a.frames(1,false);b.frames(1,false);
    if(first<0&&phys(a.sandbox)!==phys(b.sandbox)){first=frame;phase=a.sandbox.__ashenRageProbe().act.phase;}
  }
  const pa=a.sandbox.__ashenRageProbe(),pb=b.sandbox.__ashenRageProbe(),warn=pa.act.notes.find(n=>n.kind==='act-warning'),land=pa.act.notes.find(n=>n.kind==='act-land');
  console.log(`  ${type}: first physical divergence ${first}f in ${phase}; warning ${warn&&land?land.tag-warn.tag:'?'}f`);
  if(!warn||!land||land.tag-warn.tag!==240)fail(`${type}: warning/land pair was not exactly 240 frames`);
  if(warn&&land&&land.at-warn.at<240)fail(`${type}: viewer warning shrank below 240 frames`);
  if(first<1||first>=240||phase!=='warn')fail(`${type}: act did not physically change the world during warning`);
  if(pb.act.notes.length)fail(`${type}: __NO_ACTS emitted notes`);
}
{
  const game=bootGame('ashen-rage',{seed:0x5012,footer:FOOTER});game.sandbox.__ashenRageActFixture('grudge');game.frames(100,false);
  game.sandbox.__arReset();game.frames(300,false);const p=game.sandbox.__ashenRageProbe();
  if(p.act.phase!=='calm'||p.act.notes.some(n=>n.kind==='act-land'))fail('reset during act warning left a stale land');
}

console.log('5) human takeover shares the bot intent schema and runtime bike physics');
{
  const game=bootGame('ashen-rage',{seed:0x5020,footer:FOOTER}),initial=game.sandbox.__ashenRageManual();
  press(game,'Enter');const instructions=game.sandbox.__ashenRageManual();press(game,'Enter');const started=game.sandbox.__ashenRageManual();
  const schema=game.sandbox.__ashenRageIntentSchemas();game.sandbox.__arClearApplied();
  game.key('keydown','ArrowLeft');game.frames(5,false);game.key('keyup','ArrowLeft');const steer=game.sandbox.__arLastApplied();
  game.sandbox.__arClearApplied();game.key('keydown','ArrowUp');game.frames(4,false);game.key('keyup','ArrowUp');const throttle=game.sandbox.__arLastApplied();
  game.sandbox.__arClearApplied();game.key('keydown','KeyX');game.frames(2,false);game.key('keyup','KeyX');const swing=game.sandbox.__arLastApplied();
  console.log(`  playing ${initial.playing}->${instructions.playing}->${started.playing}; schema ${schema.humanKeys.join(',')}; steer ${steer&&steer.steer}, throttle ${throttle&&throttle.throttle}, swing ${swing&&swing.swing}`);
  if(initial.playing||instructions.playing||!started.playing)fail('manual session skipped the two-Enter gate');
  if(schema.humanKeys.join('|')!==schema.botKeys.join('|'))fail(`human/bot intent schemas differ: ${JSON.stringify(schema)}`);
  if(!steer||steer.steer!==-1||steer.tactic!=='MANUAL RAGE')fail('manual steering did not traverse runtime advanceBike');
  if(!throttle||throttle.throttle!==1||throttle.tactic!=='MANUAL RAGE')fail('manual throttle did not traverse runtime advanceBike');
  if(!swing||swing.swing!==1||swing.tactic!=='MANUAL RAGE')fail('manual swing did not traverse runtime advanceBike');
  if(!game.sandbox.__ashenRageProbe().finite)fail('manual control produced non-finite state');
}

console.log('5b) every mapped key is responsive, and simultaneous presses compose in one intent');
{
  const game=bootGame('ashen-rage',{seed:0x5021,footer:FOOTER});
  press(game,'Enter');press(game,'Enter');
  if(!game.sandbox.__ashenRageManual().playing)fail('keyboard fixtures need playing mode');
  const applied=()=>{const a=game.sandbox.__arLastApplied();game.sandbox.__arClearApplied();return a;};
  const hold=(codes,frames)=>{for(const c of codes)game.key('keydown',c);game.frames(frames,false);
    const a=game.sandbox.__arLastApplied();for(const c of codes)game.key('keyup',c);game.sandbox.__arClearApplied();return a;};
  const checks=[
    ['ArrowLeft',{steer:-1}],['ArrowRight',{steer:1}],['ArrowUp',{throttle:1}],['ArrowDown',{brake:true}],
    ['KeyX',{swing:1}],['KeyZ',{swing:-1}],['KeyJ',{swing:1}],['KeyK',{swing:1}],
    ['ShiftLeft',{swing:-1}],['ShiftRight',{swing:-1}]
  ];
  for(const[code,want]of checks){
    const a=hold([code],4);
    const ok=a&&Object.entries(want).every(([k,v])=>a[k]===v)&&a.tactic==='MANUAL RAGE';
    console.log(`  ${code.padEnd(11)} ${ok?'responds':'DEAD'} (steer ${a&&a.steer}, throttle ${a&&a.throttle}, brake ${a&&a.brake}, swing ${a&&a.swing})`);
    if(!ok)fail(`key ${code} did not produce ${JSON.stringify(want)} in the applied intent`);
  }
  game.sandbox.__arTopBoost();
  const boost=hold(['Space'],4);
  console.log(`  Space       ${boost&&boost.boost?'responds':'DEAD'} (boost ${boost&&boost.boost})`);
  if(!boost||!boost.boost)fail('Space did not produce boost in the applied intent');
  // Simultaneous chord: steer + throttle + boost + swing in ONE applied intent.
  game.sandbox.__arTopBoost();
  const chord=hold(['ArrowLeft','ArrowUp','Space','KeyX'],5);
  const chordOk=chord&&chord.steer===-1&&chord.throttle===1&&chord.boost===true&&chord.swing===1&&chord.tactic==='MANUAL RAGE';
  console.log(`  LEFT+UP+SPACE+X chord: ${chordOk?'composed':'INTERFERED'} (${JSON.stringify(chord)})`);
  if(!chordOk)fail(`simultaneous keys interfered: ${JSON.stringify(chord)}`);
  // Opposing pairs cancel honestly, and keys stay responsive after chords.
  const oppose=hold(['ArrowLeft','ArrowRight'],4);
  if(!oppose||oppose.steer!==0)fail(`opposing arrows did not cancel: ${JSON.stringify(oppose)}`);
  const both=hold(['KeyX','KeyZ'],4);
  if(!both||both.swing!==1)fail(`X+Z precedence broke: ${JSON.stringify(both)}`);
  const after=hold(['ArrowRight'],4);
  if(!after||after.steer!==1)fail('keys went dead after a chord');
  if(!game.sandbox.__ashenRageProbe().finite)fail('keyboard storm produced non-finite state');
}

console.log('6) ten-minute soaks: moving highway, pack combat, position race, and exact SHOW budgets');
for(const seed of[0x5200,0x52d4]){
  const{game,samples}=runSoak('ashen-rage',{seed,minutes:10,footer:FOOTER}),report=analyzeSoak(samples),p=game.sandbox.__ashenRageProbe(),
    show=p.show,offered=show.offeredByTier,shown=show.shownByTier,s3=shown[3]||0,kinds=game.sandbox.__arRivalKinds(),continuity=game.sandbox.__arContinuity;
  console.log(`  ${seed.toString(16)} ${soakLine(report)}; KOs ${p.stats.kos}, hits taken ${p.stats.hitsTaken}, `+
    `rank P${p.rank}, tiers ${JSON.stringify(shown)}, pack ${JSON.stringify(kinds)}`);
  assertSoak(seed.toString(16),report,{still:1,quiet:5,stall:5,minEvents:560,minProgress:380},fail);
  inBands(p,SOAK_BANDS,`seed ${seed.toString(16)} soak`);
  if(!p.finite)fail(`seed ${seed.toString(16)}: non-finite state`);
  if(continuity.max>3.4)fail(`seed ${seed.toString(16)}: unaccounted ${continuity.max.toFixed(2)}px one-step discontinuity`);
  for(const kind of['bruiser','weasel','veteran','maniac'])if(!kinds[kind])fail(`seed ${seed.toString(16)}: ${kind} never joined the pack`);
  notePairs(p,'grudge',`seed ${seed.toString(16)}`,2);notePairs(p,'pack',`seed ${seed.toString(16)}`,2);
  if(!((offered[1]||0)>(offered[2]||0)&&(offered[2]||0)>(offered[3]||0)&&(offered[3]||0)>=2))
    fail(`seed ${seed.toString(16)}: offered tiers not strictly ordered ${JSON.stringify(offered)}`);
  if(!((shown[1]||0)>(shown[2]||0)&&(shown[2]||0)>(shown[3]||0)&&(shown[3]||0)>=2))
    fail(`seed ${seed.toString(16)}: shown tiers not strictly ordered ${JSON.stringify(shown)}`);
  if(show.heldFrames!==6*s3)fail(`seed ${seed.toString(16)}: apex hold ${show.heldFrames} != 6*${s3}`);
  if(show.slowedFrames!==24*s3)fail(`seed ${seed.toString(16)}: apex slow ${show.slowedFrames} != 24*${s3}`);
  if(show.admireFrames!==48*s3)fail(`seed ${seed.toString(16)}: apex admire ${show.admireFrames} != 48*${s3}`);
}
console.log('6b) motion contract: nobody parks bare, emote budgets measured, pace floors hold');
for(const[seed,minutes]of[[0x5200,10],[0x6100,2]]){
  const run=runMotion('ashen-rage',{seed,minutes}),pace=paceOf(run);
  const riderReport=analyzeMotion({step:run.step,samples:run.samples.map(s=>Object.assign({},s,{actors:s.actors.filter(a=>a.id==='rider')}))},{});
  const packReport=analyzeMotion(run,{emoteFrames:160,emoteShare:.30,requiredIds:['rider']});
  console.log(`  ${seed.toString(16)} (${minutes}m) rider[${motionLine(riderReport)}] pack[${motionLine(packReport)}] · rider ${pace.rider.toFixed(3)} px/f · pack mean ${pace.packMean.toFixed(3)} px/f over ${pace.packCount} rivals`);
  assertMotion(seed.toString(16)+' rider',riderReport,fail);
  assertMotion(seed.toString(16)+' pack',packReport,fail);
  if(run.samples.some(s=>!s.actors.some(a=>a.id==='rider')))fail(`${seed.toString(16)}: motion probe lost the rider`);
  if(pace.rider<RIDER_PACE_FLOOR)fail(`${seed.toString(16)}: rider pace ${pace.rider.toFixed(3)} px/f under floor ${RIDER_PACE_FLOOR}`);
  if(pace.packMean<PACK_PACE_FLOOR)fail(`${seed.toString(16)}: pack pace ${pace.packMean.toFixed(3)} px/f under floor ${PACK_PACE_FLOOR}`);
}
console.log('6c) __NO_EMOTE ablation re-proves the motion fix and stays sim-honest');
{
  const uncovered=analyzeMotion(runMotion('ashen-rage',{seed:0x613d,minutes:3,footer:'globalThis.__NO_EMOTE=1;'}),{});
  console.log(`  __NO_EMOTE violations ${uncovered.violations.length}`);
  if(!uncovered.violations.some(v=>/rival.*no emote/.test(v)))fail('__NO_EMOTE ablation: motion gate no longer requires authored emote coverage');
  const a=bootGame('ashen-rage',{seed:0x613d}),b=bootGame('ashen-rage',{seed:0x613d});
  b.sandbox.__NO_EMOTE=1;a.frames(18000,false);b.frames(18000,false);
  if(a.sandbox.__ashenRageSignature()!==b.sandbox.__ashenRageSignature())
    fail('__NO_EMOTE changed simulation state (emotes must be render/probe-only)');
}

console.log('6d) contact contract: overlaps resolve in frames, pack weaves the commute');
{
  const game=bootGame('ashen-rage',{seed:0x5292,footer:FOOTER});
  const staged=game.sandbox.__arContactFixture();
  const before=game.sandbox.__arHardOverlapNow();
  game.frames(60,false);
  const after=game.sandbox.__arHardOverlapNow(),probe=game.sandbox.__ashenRageProbe();
  console.log(`  staged hard overlap ${before} -> ${after} after 60f (contacts ${probe.stats.contacts}, pack-traffic ${probe.stats.packTrafficHits})`);
  if(before<2)fail(`contact fixture did not stage overlapping bodies: ${JSON.stringify(staged)}`);
  if(after!==0)fail(`hard overlap survived the resolver: ${after} pairs after 60f`);
  const queue=bootGame('ashen-rage',{seed:0x5295,footer:FOOTER});
  const beforeQ=queue.sandbox.__arQueueFixture(),beforeOverlap=queue.sandbox.__arHardOverlapNow();
  queue.frames(120,false);
  const afterOverlap=queue.sandbox.__arHardOverlapNow();
  const speeds=queue.sandbox.__arTrafficState();
  console.log(`  car queue: overlap ${beforeOverlap} -> ${afterOverlap} after 120f; rear ${beforeQ[1].speed} chases ${beforeQ[0].speed}`);
  if(beforeOverlap<1)fail('queue fixture did not stage two closing cars');
  if(afterOverlap!==0)fail(`cars still overlap after 120f of queueing: ${JSON.stringify(speeds)}`);
  if(!(speeds[1].speed<=speeds[0].speed+.01))fail(`rear car did not slow behind the leader: ${JSON.stringify(speeds)}`);
  for(const seed of[0x5293,0x5294]){
    const run=bootGame('ashen-rage',{seed,footer:FOOTER});run.frames(7200,false);
    const p=run.sandbox.__ashenRageProbe(),o=run.sandbox.__arOverlap;
    console.log(`  ${seed.toString(16)}: worst overlap ${o.worst} pairs, longest ${o.maxRun}f; bumps ${p.stats.contacts}, pack-traffic ${p.stats.packTrafficHits}`);
    if(o.worst>2)fail(`${seed.toString(16)}: ${o.worst} bodies hard-overlapped at once`);
    if(o.maxRun>8)fail(`${seed.toString(16)}: hard overlap persisted ${o.maxRun} frames (limit 8)`);
    if(p.stats.contacts<3)fail(`${seed.toString(16)}: pack stopped making contact (${p.stats.contacts} bumps)`);
  }
}

{
  const game=bootGame('ashen-rage',{seed:0x5290,footer:FOOTER}),fixture=game.sandbox.__ashenRageAdmireFixture();
  if(fixture.admired.tactic!=='SAVOR THE CROWN'||fixture.gated.tactic==='SAVOR THE CROWN')
    fail(`__NO_ADMIRE did not gate the bot-only coast: ${JSON.stringify(fixture)}`);
  const perfect=bootGame('ashen-rage',{seed:0x5291,footer:FOOTER});perfect.sandbox.__NO_LAPSE=1;perfect.frames(18000,false);
  if(perfect.sandbox.__ashenRageProbe().stats.lapses!==0)fail('__NO_LAPSE did not eliminate skill-profile lapse onsets');
}

console.log('7) payoff FX is a perfect same-seed simulation no-op');
{
  const a=bootGame('ashen-rage',{seed:0x5300,footer:FOOTER}),b=bootGame('ashen-rage',{seed:0x5300,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);
  const same=a.sandbox.__ashenRageSignature()===b.sandbox.__ashenRageSignature(),p=a.sandbox.__ashenRageProbe();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} through ${p.stats.events} events / ${p.stats.kos} KOs`);
  if(!same)fail('__NO_PAYOFF_FX changed simulation state');
  if(p.stats.kos<1)fail('FX no-op window did not exercise a knockout payoff');
}

console.log('8) drawn lean is honest: the bike tracks travel, never crabs');
{
  const fixture=bootGame('ashen-rage',{seed:0x6001,footer:FOOTER}).sandbox.__arPoseFixture();
  console.log(`  steadyRight angle ${fixture.steadyRight.angle.toFixed(3)} (vx ${fixture.steadyRight.vx.toFixed(3)}); `+
    `straighten angle ${fixture.straighten.angle.toFixed(4)}; steadyLeft angle ${fixture.steadyLeft.angle.toFixed(3)}`);
  if(!(fixture.steadyRight.vx>.2&&fixture.steadyRight.angle>.08))
    fail(`steady right steer must lean the bike INTO the travel direction: ${JSON.stringify(fixture.steadyRight)}`);
  if(!(Math.abs(fixture.straighten.angle)<.02&&Math.abs(fixture.straighten.vx)<.05))
    fail(`released steering must straighten the bike: ${JSON.stringify(fixture.straighten)}`);
  if(!(fixture.steadyLeft.vx<-.2&&fixture.steadyLeft.angle<-.08))
    fail(`steady left steer must lean the bike INTO the travel direction: ${JSON.stringify(fixture.steadyLeft)}`);
  for(const seed of[0x6100,0x613d]){
    const game=bootGame('ashen-rage',{seed,footer:FOOTER});game.frames(10800,false);
    const p=game.sandbox.__arPose;
    console.log(`  ${seed.toString(16)}: ${p.frames}f riding · wrong-way runs max ${p.wrongWayMax} (viol ${p.wrongWayViolations}) · crab viol ${p.crabViolations}`);
    if(p.frames<5000)fail(`${seed.toString(16)}: pose telemetry lost the rider (${p.frames} frames)`);
    if(p.wrongWayViolations>0)fail(`${seed.toString(16)}: bike leaned AWAY from travel for >8 consecutive frames x${p.wrongWayViolations}`);
    if(p.crabViolations>0)fail(`${seed.toString(16)}: phantom crab while cruising straight x${p.crabViolations}`);
  }
}

console.log('9) feedback legibility: every good/bad sim event is visibly represented on screen');
{
  const config={frames:9000,poll:5,radius:26,perCategory:3,
    goodPalette:['#ffd166','#ffb02e','#67e8a2','#59d8f5','#fff3da'],badPalette:['#ff5d4f','#c92c3c','#ffffff'],
    signatureProbe:'__ashenRageSignature'};
  const runs=[runFeedbackVisibility('ashen-rage',Object.assign({seed:0x5300},config)),
    runFeedbackVisibility('ashen-rage',Object.assign({seed:0x52d4},config))];
  for(const run of runs){
    const byKey={};for(const s of run.samples)byKey[s.key]=(byKey[s.key]||[]).concat(
      [`${s.changed}px sig${s.kind==='good'?s.goodPixels:s.badPixels}`]);
    console.log(`  ${run.seed.toString(16)}: ${Object.entries(run.counts).map(([k,v])=>`${k} x${v}`).join(', ')}`);
    console.log(`    samples: ${Object.entries(byKey).map(([k,v])=>`${k}[${v.join(' ')}]`).join(' ')}`);
  }
  console.log(`  ${feedbackLine(runs)}; signatures ${runs.every(r=>r.signaturesMatch)?'identical':'DIFFERENT'}`);
  assertFeedback('feedback',runs,{
    required:['good:hit','good:ko','good:overtake','good:pickup-nitro','good:pickup-wrench','good:boost','good:near-miss','good:thread',
      'bad:hit-taken','bad:wreck','bad:traffic-hit','bad:oil','bad:barrier-hit','bad:dropped'],
    minChanged:{default:12,'good:near-miss':6,'good:thread':6,'good:boost':6,'bad:oil':6,'bad:lapse':6},
    minSignature:{default:8,'good:near-miss':4,'good:thread':4,'good:boost':4,'bad:oil':4,'bad:lapse':4},
    maxInvisible:0
  },fail);
}

console.log(failed?'\nASHEN RAGE EVAL FAILED':'\nASHEN RAGE EVAL PASSED');
process.exit(failed?1:0);
