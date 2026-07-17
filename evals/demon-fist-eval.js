#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
const{runMotion,analyzeMotion,assertMotion,motionLine}=require('./motion');
const{runFeedbackVisibility,assertFeedback,feedbackLine}=require('./feedback');

// Observation only: none of these hooks make decisions, touch physics values,
// draw, or consume either RNG stream.
const FOOTER=String.raw`
globalThis.__dfApplied=[];
{const old=advanceBrawler;advanceBrawler=function(b,move,opts){const out=old(b,move,opts);
  if(b===fighter){globalThis.__dfApplied.push({showFrame,runFrame,move,
    attack:fighter.intent&&fighter.intent.attack,dodge:fighter.intent&&fighter.intent.dodge,
    tactic:fighter.intent&&fighter.intent.tactic});
    if(globalThis.__dfApplied.length>360)globalThis.__dfApplied.shift();}return out;};}
globalThis.__dfClearApplied=()=>{globalThis.__dfApplied.length=0;};
globalThis.__dfLastApplied=()=>globalThis.__dfApplied.at(-1)||null;
globalThis.__dfContinuity={max:0,from:null,to:null};
{const old=stepPlayer;stepPlayer=function(){const from={x:fighter.x,y:fighter.y},out=old(),to={x:fighter.x,y:fighter.y},
  d=Math.hypot(to.x-from.x,to.y-from.y);if(d>globalThis.__dfContinuity.max)globalThis.__dfContinuity={max:d,from,to};return out;};}
globalThis.__dfReset=()=>resetRun(true);
globalThis.__dfActEnemyPositions=()=>enemies.map(e=>[e.id,e.kind,round(e.x,4),round(e.y,4),e.state]);
// Overlap contract: nobody fights on top of anybody. Hard overlap = deeper
// than the drawn bodies allow; the resolver must clear it within a few frames.
globalThis.__dfOverlap={worst:0,maxRun:0,run:0};
globalThis.__dfOverlapScan=()=>{
  const bodies=[fighter,...aliveEnemies().filter(e=>e.state!=='down'&&e.state!=='launched'&&e.state!=='vanish'&&e.state!=='appear'&&e.state!=='flee')];
  let hard=0;
  for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
    const a=bodies[i],b=bodies[j];
    if(a.y>6||b.y>6)continue;
    if(Math.abs(a.x-b.x)<4.5)hard++;
  }
  const O=globalThis.__dfOverlap;O.worst=Math.max(O.worst,hard);
  O.run=hard?O.run+1:0;O.maxRun=Math.max(O.maxRun,O.run);
  return hard;
};
{const old=stepWorld;stepWorld=function(){const out=old();globalThis.__dfOverlapScan();return out;};}
// Eval-only hooks: top up the meter for keyboard checks, and stage a hard
// overlap the resolver must clear. Neither runs during measured sweeps.
globalThis.__dfTopMeter=()=>{fighter.meter=100;};
globalThis.__dfInvuln=()=>{fighter.invulnT=999999;fighter.hp=60;};
// Manual-purity fixtures: park the fighter on an empty stretch (or stage one
// enemy) so keyboard-driven runs can assert that NOTHING moves the fighter but
// the human's mapped intent. Never used during measured sweeps.
globalThis.__dfClearStreet=x=>{enemies.length=0;fighter.x=x;fighter.vx=0;fighter.vy=0;fighter.y=0;
  fighter.state='free';fighter.knockT=0;fighter.invulnT=0;fighter.lockFace=false;fighter.face=1;
  fighter.sprintT=0;fighter.jumpCd=0;fighter.dodgeCd=0;fighter.meter=0;fighter.combo=0;
  while(waveCursor<waveTriggers.length&&waveTriggers[waveCursor].x<fighter.x+700)waveCursor++;
  pendingWaves=new Set();lastClearFrame=runFrame;prevAlive=0;camX=Math.max(0,fighter.x-52);};
globalThis.__dfSpawnAt=(kind,dx,state)=>{const e=spawnEnemy(kind,fighter.x+dx,dx<0?1:-1);
  if(state){e.state=state[0];e.stateT=state[1]||0;if(state[0]==='windup'||state[0]==='strike')e.lockFace=true;}
  return e.id;};
globalThis.__dfEnemy=id=>{const e=enemies.find(q=>q.id===id);
  return e?{x:round(e.x,4),state:e.state,baited:!!e.baited}:null;};
globalThis.__dfFighterNow=()=>({x:round(fighter.x,4),y:round(fighter.y,4),vx:round(fighter.vx,4),
  face:fighter.face,state:fighter.state,atkDir:fighter.atkDir,atkKind:fighter.atkKind,
  meter:round(fighter.meter,2),hp:fighter.hp,sprintT:fighter.sprintT,jumpCd:fighter.jumpCd});
globalThis.__dfSetVitals=(hp,meter)=>{fighter.hp=hp;fighter.meter=meter;};
globalThis.__dfContactFixture=()=>{
  fighter.x=8000;fighter.y=0;fighter.vx=0;fighter.vy=0;fighter.state='free';fighter.knockT=0;fighter.invulnT=0;fighter.lockFace=false;
  enemies.length=0;
  const a=spawnEnemy('thug',8001,-1),b=spawnEnemy('bruiser',8003,-1);
  return{player:{x:fighter.x},a:{x:a.x},b:{x:b.x}};
};
globalThis.__dfHardOverlapNow=()=>{
  const bodies=[fighter,...aliveEnemies().filter(e=>e.state!=='down'&&e.state!=='launched'&&e.state!=='vanish'&&e.state!=='appear'&&e.state!=='flee')];
  let hard=0;
  for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
    const a=bodies[i],b=bodies[j];
    if(a.y>6||b.y>6)continue;
    if(Math.abs(a.x-b.x)<4.5)hard++;
  }
  return hard;
};
// Pose-honesty telemetry: the drawn body must face actual travel in free
// movement, and square up to the threat when idle. Attack/dodge/slam/super/
// down are authored pose states and pose by their own rules.
globalThis.__dfPose={frames:0,wrongWayRun:0,wrongWayMax:0,wrongWayViolations:0,straightRun:0,crabViolations:0};
{const P=globalThis.__dfPose,old=stepPlayer;stepPlayer=function(){const out=old();
  if(fighter.state!=='free'||fighter.knockT>0)return out;
  P.frames++;
  const wrongWay=Math.abs(fighter.vx)>.3&&fighter.face!==Math.sign(fighter.vx);
  P.wrongWayRun=wrongWay?P.wrongWayRun+1:0;P.wrongWayMax=Math.max(P.wrongWayMax,P.wrongWayRun);
  if(P.wrongWayRun>8)P.wrongWayViolations++;
  const straight=Math.abs(fighter.vx)<.06&&Math.abs((fighter.intent&&fighter.intent.move)||0)<.1;
  P.straightRun=straight?P.straightRun+1:0;
  if(P.straightRun>20){P.straightRun=0;
    const near=enemies.filter(e=>e.state!=='flee'&&e.hp>0&&Math.abs(e.x-fighter.x)<70).sort((a,b)=>Math.abs(a.x-fighter.x)-Math.abs(b.x-fighter.x))[0];
    if(near&&fighter.face!==Math.sign(near.x-fighter.x))P.crabViolations++;}
  return out;};}
// Scripted pose fixtures through the SHARED integrator: each one fails a
// cosmetic-facing build (free travel faces travel; a locked windup pose holds
// its committed facing while the body backpedals).
globalThis.__dfPoseFixture=()=>{
  const drive=(b,move,opts,frames)=>{for(let i=0;i<frames;i++)advanceBrawler(b,move,Object.assign({top:1},opts));return{face:b.face,vx:round(b.vx,4)};};
  const fresh=()=>{const b=makeFighter(900);return b;};
  const locked=fresh();advanceBrawler(locked,1,{top:1,lockFace:true});const lockFace=locked.face;
  for(let i=0;i<30;i++)advanceBrawler(locked,-1,{top:1,lockFace:true});
  return{
    steadyRight:drive(fresh(),1,{},40),
    steadyLeft:drive(fresh(),-1,{},40),
    straighten:drive(fresh(),0,{},50),
    lockedWalk:{face:lockFace,vx:round(locked.vx,4)}
  };};
`;

let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const sum=(runs,key)=>runs.reduce((total,p)=>total+p.stats[key],0);
const policyScore=p=>p.stats.segments*3+p.stats.blocks*40+p.stats.kos*12+p.stats.comboMilestones*3+p.stats.slams*4+
  p.stats.sweeps*2+p.stats.counters*2+p.stats.eliteKos*10+p.stats.mobClears*6-
  p.stats.knockdowns*8-p.stats.hitsTaken*3-p.stats.comboDrops*4;
const failures=p=>4*p.stats.knockdowns+p.stats.hitsTaken+2*p.stats.comboDrops;
const inBands=(p,bands,label)=>{for(const[key,[lo,hi]]of Object.entries(bands)){
  const value=p.stats[key];
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

// Re-registered 2026-07-17 (TMNT pacing overhaul: base walk 1.0 -> 1.45 px/f,
// clear-runway sprint at 2.35 behind a 200px street-clear gate, DEMON DROP
// leap with intercept lead + landing quake, planner far-runway candidates on
// empty stretches; old bands recorded a walk-1.0 sim and are void) from a
// fresh ten-seed paired five-minute sweep (0x4f00 + i*37), planned extrema:
// segments 53..68, blocks 5, kos 120..140, hits 299..338, hitsTaken 15..26,
// launchers 20..28, slams 9..14, sweeps 5..14, sweepHits 9..23, dodges 44..53,
// counters 34..53, cracks 10..21, supers 27..31, comboMilestones 4..10,
// comboDrops 0..4, knockdowns 2..6, waves 44..50, waveClears 44..49, acts 3,
// eliteKos 2, mobClears 1, lapses 0..4, whiffs 52..69, contacts 535..1304,
// jabs 54..88, finishers 12..26, jumps 64..73, jumpHits 41..48, sprints
// 37..47, sprintArrivals 31..39, events 1157..1299, progress 363..417, event
// lull 150..178, progress lull 265..362. Bands hold ~15-25% margin both sides.
const POLICY_BANDS={
  segments:[42,82],blocks:[4,5],kos:[100,165],hits:[250,400],hitsTaken:[10,33],launchers:[15,36],
  slams:[6,19],sweeps:[3,18],sweepHits:[6,30],dodges:[34,66],counters:[26,66],cracks:[7,27],
  supers:[21,38],comboMilestones:[2,14],comboDrops:[0,6],knockdowns:[1,8],waves:[36,60],
  waveClears:[35,59],acts:[3,3],eliteKos:[2,3],mobClears:[1,2],noHitMobs:[0,2],actClears:[1,2],
  lapses:[0,5],whiffs:[40,85],contacts:[380,1650],jabs:[40,110],finishers:[8,34],
  jumps:[50,90],jumpHits:[30,60],sprints:[28,60],sprintArrivals:[23,50],
  events:[980,1560],progress:[300,500]
};
// Same sweep, __NO_ROUTE_PLAN baseline extrema (the baseline keeps the full
// acrobatics grammar — only the stance planner is ablated): segments 36..46,
// blocks 5, kos 122..137, hits 290..320, hitsTaken 17..23, launchers 16..33,
// slams 8..16, sweeps 9..19, sweepHits 15..31, dodges 38..56, counters 40..69,
// cracks 11..22, supers 27..31, comboMilestones 3..7, comboDrops 0..2,
// knockdowns 2..4, waves 48..53, waveClears 47..52, lapses 0..4, whiffs
// 47..67, contacts 446..845, jabs 47..85, finishers 11..21, jumps 56..73,
// jumpHits 42..56, sprints 61..74, sprintArrivals 35..45, events 1178..1258,
// progress 360..390, event lull 146..157, progress lull 229..471.
const REACTIVE_BANDS={
  segments:[28,56],blocks:[4,5],kos:[100,165],hits:[240,385],hitsTaken:[11,30],launchers:[12,41],
  slams:[5,21],sweeps:[6,25],sweepHits:[10,40],dodges:[29,70],counters:[30,85],cracks:[8,28],
  supers:[21,38],comboMilestones:[1,10],comboDrops:[0,4],knockdowns:[1,6],waves:[38,64],
  waveClears:[37,63],acts:[3,3],eliteKos:[2,3],mobClears:[1,2],noHitMobs:[0,2],actClears:[1,2],
  lapses:[0,5],whiffs:[36,82],contacts:[320,1100],jabs:[35,106],finishers:[7,28],
  jumps:[42,90],jumpHits:[31,70],sprints:[47,92],sprintArrivals:[26,58],
  events:[1000,1510],progress:[300,470]
};

// Measured 2026-07-17 (TMNT pacing build) from two independent ten-minute
// soaks (0x5200, 0x52d4): still 0s, quiet 2s, stall 4..5s (walk-1.0 build:
// 5..6s — the sprint SHORTENS droughts), events 2584..2656, progress 824..871,
// blocks 5, acts 7 lands, tier3 shown 38..41, lulls 156..175 / 293..357.
// Extrema: segments 125..130, kos 268..285, hits 731..734, hitsTaken 34..43,
// launchers 67..73, slams 20..28, sweeps 17, sweepHits 28..30, dodges
// 100..119, counters 99..106, cracks 40..45, supers 58..71, comboMilestones
// 24..25, comboDrops 6, knockdowns 7..10, waves 91..97, waveClears 90..96,
// eliteKos 4, mobClears 3, lapses 3..4, whiffs 131..150, contacts 1102..2569,
// jabs 137..178, finishers 43..46, jumps 124..134, jumpHits 88, sprints
// 79..89, sprintArrivals 67..71.
const SOAK_BANDS={
  segments:[95,165],blocks:[5,5],kos:[210,350],hits:[560,920],hitsTaken:[24,58],launchers:[50,92],
  slams:[14,38],sweeps:[10,28],sweepHits:[18,45],dodges:[75,150],counters:[72,140],cracks:[29,58],
  supers:[44,90],comboMilestones:[15,35],comboDrops:[3,12],knockdowns:[4,15],waves:[70,120],
  waveClears:[69,119],acts:[6,8],eliteKos:[3,5],mobClears:[2,4],noHitMobs:[0,3],actClears:[2,4],
  lapses:[1,6],whiffs:[98,190],contacts:[800,3200],jabs:[100,230],finishers:[30,62],
  jumps:[93,170],jumpHits:[62,115],sprints:[59,115],sprintArrivals:[48,92],
  events:[2050,3300],progress:[640,1100]
};

// Motion-contract pace floors, measured 2026-07-17 on the TMNT pacing build
// (0x6100 2min 1.155, 0x613d 3min 1.125, 0x52d4 3min ~1.13 fighter px/f; pack
// 0.921..1.095): the faster walk nearly doubled the old 0.641..0.699 fighter
// pace. Floors keep ~15% margin under the measured minima.
const FIGHTER_PACE_FLOOR=.95,PACK_PACE_FLOOR=.8;
const paceOf=run=>{const per=new Map();let prev=null;
  for(const s of run.samples){if(prev)for(const a of s.actors){const b=prev.actors.find(q=>q.id===a.id);if(!b)continue;
    const d=Math.hypot(a.x-b.x,a.y-b.y),t=per.get(a.id)||{d:0,f:0};t.d+=d;t.f+=run.step;per.set(a.id,t);}prev=s;}
  const pack=[...per.entries()].filter(([id])=>id!=='fighter').map(([,t])=>t.d/t.f),d=per.get('fighter');
  return{rider:d?d.d/d.f:0,packMean:pack.length?pack.reduce((a,b)=>a+b,0)/pack.length:0,packCount:pack.length};};

console.log('1) fixed 60 Hz determinism, render parity, chunk parity, and finite renderer');
{
  const a=bootGame('demon-fist',{seed:0x4e01,footer:FOOTER}),
    b=bootGame('demon-fist',{seed:0x4e01,footer:FOOTER}),
    rendered=bootGame('demon-fist',{seed:0x4e01,footer:FOOTER});
  a.frames(3600,false);b.frames(3600,false);const draws=rendered.frames(3600,true);
  const sa=a.sandbox.__demonFistSignature(),sb=b.sandbox.__demonFistSignature(),sr=rendered.sandbox.__demonFistSignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${draws.calls} draw calls`);
  if(sa!==sb)fail('same seed diverged at fixed 60 Hz');
  if(sa!==sr)fail('render traversal changed simulation state or RNG');
  if(!a.sandbox.__demonFistProbe().finite||!rendered.sandbox.__demonFistProbe().finite)fail('headless or rendered replay became non-finite');
  if(draws.calls<1000||!draws.byMethod.fillRect||!draws.byMethod.beginPath||!draws.byMethod.fillText)
    fail(`renderer was not genuinely exercised: ${JSON.stringify(draws.byMethod)}`);

  const mono=bootGame('demon-fist',{seed:0x4e02,footer:FOOTER}),chunked=bootGame('demon-fist',{seed:0x4e02,footer:FOOTER});
  mono.frames(2400,false);for(let i=0;i<240;i++)chunked.frames(10,false);
  const same=mono.sandbox.__demonFistSignature()===chunked.sandbox.__demonFistSignature();
  console.log(`  2,400 monolithic frames vs 240 x 10: ${same?'identical':'DIFFERENT'}`);
  if(!same)fail('headless batching changed fixed-step simulation');
}

console.log('2) fight lookahead is pure, repeatable, RNG-inert, and uses the shared integrator');
{
  const planned=bootGame('demon-fist',{seed:0x4e10,footer:FOOTER}),control=bootGame('demon-fist',{seed:0x4e10,footer:FOOTER}),
    fixture=planned.sandbox.__demonFistPlannerFixture();
  const nextPlanned=planned.sandbox.__demonFistNextRandom(),nextControl=control.sandbox.__demonFistNextRandom();
  console.log(`  pure ${fixture.pure}; repeat ${fixture.repeat}; stance ${fixture.plan&&fixture.plan.stance} @ ${fixture.plan&&fixture.plan.targetX}; RNG ${nextPlanned.toFixed(8)}/${nextControl.toFixed(8)}`);
  if(!fixture.pure||!fixture.repeat||!fixture.finite||!fixture.plan||!Number.isFinite(fixture.plan.score))
    fail(`planner fixture regressed: ${JSON.stringify(fixture)}`);
  if(nextPlanned!==nextControl)fail('fight planning consumed engine RNG for simulation-invisible work');
}

console.log('3) baseline-first fight-policy A/B: ten paired five-minute seeds');
{
  const smart=[],reactive=[];let segmentWins=0,scoreWins=0;
  for(let i=0;i<10;i++){
    const seed=0x4f00+i*37,a=bootGame('demon-fist',{seed,footer:FOOTER}),b=bootGame('demon-fist',{seed,footer:FOOTER});
    b.sandbox.__NO_ROUTE_PLAN=1;a.frames(18000,false);b.frames(18000,false);
    const pa=a.sandbox.__demonFistProbe(),pb=b.sandbox.__demonFistProbe();smart.push(pa);reactive.push(pb);
    if(pa.stats.segments>pb.stats.segments)segmentWins++;if(policyScore(pa)>policyScore(pb))scoreWins++;
    inBands(pa,POLICY_BANDS,`seed ${seed.toString(16)} planned`);
    inBands(pb,REACTIVE_BANDS,`seed ${seed.toString(16)} reactive`);
    for(const[p,label]of[[pa,'planned'],[pb,'reactive']]){
      if(!p.finite)fail(`seed ${seed.toString(16)} ${label}: non-finite state`);
      // Measured 2026-07-17 lull extrema on the TMNT pacing build: event
      // 150..178 (planned) / 146..157 (reactive), progress 265..362 / 229..471.
      // Ceilings tightened from 340/540/580 with the sim change — the sprint
      // shortens droughts and the gates keep that.
      if(p.stats.maxEventLull>300)fail(`seed ${seed.toString(16)} ${label}: event lull ${p.stats.maxEventLull}f`);
      if(label==='planned'&&p.stats.maxProgressLull>500)fail(`seed ${seed.toString(16)} planned: progress lull ${p.stats.maxProgressLull}f`);
      if(label==='reactive'&&p.stats.maxProgressLull>580)fail(`seed ${seed.toString(16)} reactive: progress lull ${p.stats.maxProgressLull}f`);
    }
    console.log(`  ${seed.toString(16)} score ${policyScore(pa)}/${policyScore(pb)}, `+
      `KOs ${pa.stats.kos}/${pb.stats.kos}, segments ${pa.stats.segments}/${pb.stats.segments}, failures ${failures(pa)}/${failures(pb)}`);
  }
  const score=[sum(smart,'segments')*3+sum(smart,'blocks')*40+sum(smart,'kos')*12+sum(smart,'comboMilestones')*3+sum(smart,'slams')*4+sum(smart,'sweeps')*2+sum(smart,'counters')*2+
      sum(smart,'eliteKos')*10+sum(smart,'mobClears')*6-sum(smart,'knockdowns')*8-sum(smart,'hitsTaken')*3-sum(smart,'comboDrops')*4,
    sum(reactive,'segments')*3+sum(reactive,'blocks')*40+sum(reactive,'kos')*12+sum(reactive,'comboMilestones')*3+sum(reactive,'slams')*4+sum(reactive,'sweeps')*2+sum(reactive,'counters')*2+
      sum(reactive,'eliteKos')*10+sum(reactive,'mobClears')*6-sum(reactive,'knockdowns')*8-sum(reactive,'hitsTaken')*3-sum(reactive,'comboDrops')*4],
    bad=[smart.reduce((n,p)=>n+failures(p),0),reactive.reduce((n,p)=>n+failures(p),0)],
    segments=[sum(smart,'segments'),sum(reactive,'segments')],
    supers=[sum(smart,'supers'),sum(reactive,'supers')],
    baseline={kos:sum(reactive,'kos'),events:sum(reactive,'events'),supers:sum(reactive,'supers'),eliteKos:sum(reactive,'eliteKos')};
  console.log(`  ${segmentWins}/10 segment wins; ${scoreWins}/10 score wins; score ${score[0]}/${score[1]}, `+
    `segments ${segments[0]}/${segments[1]}, supers ${supers[0]}/${supers[1]}, failures ${bad[0]}/${bad[1]}`);
  // Re-calibrated 2026-07-17 with the pacing overhaul. On the walk-1.0 build
  // the planner won 10/10 on goal score because it monopolized traversal
  // (blocks 4..5 vs 3). Both builds now share the acrobatics grammar and both
  // reach block 5, so kos are wave-diet-capped and score is parity noise
  // (20034 vs 19896, 6/10 wins). The planner's causal signature is transit
  // DECISIVENESS: planned segments 53..68 vs reactive 36..46 — disjoint
  // ranges, 10/10 per-seed wins, aggregate 1.45x — at score parity and a
  // bounded failure cost (430 vs 332, 1.30x). The asserts encode exactly that
  // shape: a planner that stops out-advancing, sacrifices the show for
  // transit, or turns reckless fails.
  if(segmentWins<9)fail(`planner stopped out-advancing per seed (${segmentWins}/10 segment wins)`);
  if(score[0]<15000||score[0]<score[1]*.96)fail(`planner sacrificed the show for transit: ${JSON.stringify({score})}`);
  if(segments[0]<segments[1]*1.25)fail(`planner stopped out-advancing the baseline: ${segments}`);
  if(supers[0]<supers[1]*.95)fail(`planner stopped setting up supers: ${supers}`);
  if(bad[0]>bad[1]*2.0)fail(`planned build became reckless: ${bad}`);
  if(baseline.kos<1150||baseline.events<11000||baseline.supers<250||baseline.eliteKos<18)
    fail(`__NO_ROUTE_PLAN baseline stopped honestly participating: ${JSON.stringify(baseline)}`);
}

console.log('3b) __NO_ACROBATICS same-seed A/B: the leap and sprint change real outcomes');
{
  // The switch disables exactly the named mechanic — the DEMON DROP leap and
  // the clear-runway sprint — and nothing else: the ablated build keeps the
  // 1.45 walk, full combat grammar, planner, acts and waves. Measured
  // 2026-07-17 over three paired five-minute seeds: live segments 47..59 vs
  // ablated 35..47, live jumps 57..60 (hits 36..40), sprints 36..39 (arrivals
  // 30..32); ablated all zero with kos 102..111 and blocks 5 — active and
  // capable of progress, just slower down the street.
  let liveSegs=0,ablSegs=0;
  for(const seed of[0x4f00,0x4f25,0x4f4a]){
    const a=bootGame('demon-fist',{seed,footer:FOOTER}),b=bootGame('demon-fist',{seed,footer:FOOTER});
    b.sandbox.__NO_ACROBATICS=1;
    let first=-1;
    for(let frame=1;frame<=600&&first<0;frame++){
      a.frames(1,false);b.frames(1,false);
      if(a.sandbox.__demonFistPhysical()!==b.sandbox.__demonFistPhysical())first=frame;
    }
    a.frames(18000-600,false);b.frames(18000-600,false);
    const pa=a.sandbox.__demonFistProbe(),pb=b.sandbox.__demonFistProbe();
    liveSegs+=pa.stats.segments;ablSegs+=pb.stats.segments;
    console.log(`  ${seed.toString(16)}: diverged at ${first}f; live jumps ${pa.stats.jumps} (hits ${pa.stats.jumpHits}), `+
      `sprints ${pa.stats.sprints} (arrivals ${pa.stats.sprintArrivals}), segments ${pa.stats.segments}/${pb.stats.segments}, KOs ${pa.stats.kos}/${pb.stats.kos}`);
    if(first<1||first>600)fail(`${seed.toString(16)}: acrobatics never physically diverged (${first})`);
    if(!pa.finite||!pb.finite)fail(`${seed.toString(16)}: non-finite acrobatics A/B state`);
    if(pa.stats.jumps<40||pa.stats.jumpHits<25||pa.stats.sprints<25||pa.stats.sprintArrivals<18)
      fail(`${seed.toString(16)}: live build stopped using acrobatics deliberately: ${JSON.stringify({jumps:pa.stats.jumps,jumpHits:pa.stats.jumpHits,sprints:pa.stats.sprints,arrivals:pa.stats.sprintArrivals})}`);
    if(pb.stats.jumps!==0||pb.stats.jumpHits!==0||pb.stats.sprints!==0||pb.stats.sprintArrivals!==0)
      fail(`${seed.toString(16)}: __NO_ACROBATICS leaked acrobatics: ${JSON.stringify({jumps:pb.stats.jumps,sprints:pb.stats.sprints})}`);
    if(pb.stats.kos<80||pb.stats.segments<25||pb.stats.blocks<4)
      fail(`${seed.toString(16)}: ablated baseline stopped functioning: ${JSON.stringify({kos:pb.stats.kos,segments:pb.stats.segments,blocks:pb.stats.blocks})}`);
  }
  console.log(`  aggregate segments live ${liveSegs} vs ablated ${ablSegs}`);
  if(liveSegs<=ablSegs)fail(`acrobatics stopped changing traversal outcomes: ${liveSegs} vs ${ablSegs}`);
}

console.log('4) DEMON GATE and THE MOB change the world during an exact 240f warning');
for(const type of['gate','mob']){
  const seed=type==='gate'?0x5010:0x5011,a=bootGame('demon-fist',{seed,footer:FOOTER}),b=bootGame('demon-fist',{seed,footer:FOOTER});
  a.sandbox.__demonFistActFixture(type);b.sandbox.__demonFistActFixture(type);b.sandbox.__NO_ACTS=1;
  const phys=sandbox=>{const p=sandbox.__demonFistProbe();
    return sandbox.__demonFistPhysical()+'|'+JSON.stringify(sandbox.__dfActEnemyPositions?sandbox.__dfActEnemyPositions():[]);};
  if(phys(a.sandbox)!==phys(b.sandbox))fail(`${type}: paired act fixture did not start identical`);
  let first=-1,phase='';
  for(let frame=1;frame<=270;frame++){
    a.frames(1,false);b.frames(1,false);
    if(first<0&&phys(a.sandbox)!==phys(b.sandbox)){first=frame;phase=a.sandbox.__demonFistProbe().act.phase;}
  }
  const pa=a.sandbox.__demonFistProbe(),pb=b.sandbox.__demonFistProbe(),warn=pa.act.notes.find(n=>n.kind==='act-warning'),land=pa.act.notes.find(n=>n.kind==='act-land');
  console.log(`  ${type}: first physical divergence ${first}f in ${phase}; warning ${warn&&land?land.tag-warn.tag:'?'}f`);
  if(!warn||!land||land.tag-warn.tag!==240)fail(`${type}: warning/land pair was not exactly 240 frames`);
  if(warn&&land&&land.at-warn.at<240)fail(`${type}: viewer warning shrank below 240 frames`);
  if(first<1||first>=240||phase!=='warn')fail(`${type}: act did not physically change the world during warning`);
  if(pb.act.notes.length)fail(`${type}: __NO_ACTS emitted notes`);
}
{
  const game=bootGame('demon-fist',{seed:0x5012,footer:FOOTER});game.sandbox.__demonFistActFixture('gate');game.frames(100,false);
  game.sandbox.__dfReset();game.frames(300,false);const p=game.sandbox.__demonFistProbe();
  if(p.act.phase!=='calm'||p.act.notes.some(n=>n.kind==='act-land'))fail('reset during act warning left a stale land');
}

console.log('5) human takeover shares the bot intent schema and runtime brawler physics');
{
  const game=bootGame('demon-fist',{seed:0x5020,footer:FOOTER}),initial=game.sandbox.__demonFistManual();
  press(game,'Enter');const instructions=game.sandbox.__demonFistManual();press(game,'Enter');const started=game.sandbox.__demonFistManual();
  const schema=game.sandbox.__demonFistIntentSchemas();game.sandbox.__dfClearApplied();
  game.key('keydown','ArrowLeft');game.frames(5,false);game.key('keyup','ArrowLeft');const move=game.sandbox.__dfLastApplied();
  game.sandbox.__dfClearApplied();game.key('keydown','KeyX');game.frames(3,false);game.key('keyup','KeyX');const jab=game.sandbox.__dfLastApplied();
  game.sandbox.__dfClearApplied();game.key('keydown','ArrowDown');game.frames(3,false);game.key('keyup','ArrowDown');const dodge=game.sandbox.__dfLastApplied();
  console.log(`  playing ${initial.playing}->${instructions.playing}->${started.playing}; schema ${schema.humanKeys.join(',')}; move ${move&&move.move}, jab ${jab&&jab.attack}, dodge ${dodge&&dodge.dodge}`);
  if(initial.playing||instructions.playing||!started.playing)fail('manual session skipped the two-Enter gate');
  if(schema.humanKeys.join('|')!==schema.botKeys.join('|'))fail(`human/bot intent schemas differ: ${JSON.stringify(schema)}`);
  if(!move||move.move!==-1||move.tactic!=='MANUAL FIST')fail('manual movement did not traverse runtime advanceBrawler');
  if(!jab||jab.attack!=='jab'||jab.tactic!=='MANUAL FIST')fail('manual jab did not reach the intent');
  if(!dodge||dodge.dodge!==true||dodge.tactic!=='MANUAL FIST')fail('manual dodge did not reach the intent');
  if(!game.sandbox.__demonFistProbe().finite)fail('manual control produced non-finite state');
}

console.log('5b) every mapped key is responsive, and simultaneous presses compose in one intent');
{
  const game=bootGame('demon-fist',{seed:0x5021,footer:FOOTER});
  press(game,'Enter');press(game,'Enter');
  if(!game.sandbox.__demonFistManual().playing)fail('keyboard fixtures need playing mode');
  game.sandbox.__dfInvuln(); // input-mapping checks must not be interrupted by a punch
  const hold=(codes,frames)=>{for(const c of codes)game.key('keydown',c);game.frames(frames,false);
    const a=game.sandbox.__dfLastApplied();for(const c of codes)game.key('keyup',c);game.sandbox.__dfClearApplied();return a;};
  const checks=[
    ['ArrowLeft',{move:-1}],['ArrowRight',{move:1}],['ArrowDown',{dodge:true}],
    ['ArrowUp',{attack:'jump'}],['Space',{attack:'sweep'}],
    ['KeyX',{attack:'jab'}],['KeyJ',{attack:'jab'}],['KeyK',{attack:'jab'}],
    ['KeyZ',{attack:'launcher'}],['ShiftLeft',{attack:'launcher'}],['ShiftRight',{attack:'launcher'}]
  ];
  for(const[code,want]of checks){
    const a=hold([code],4);
    const ok=a&&Object.entries(want).every(([k,v])=>a[k]===v)&&a.tactic==='MANUAL FIST';
    console.log(`  ${code.padEnd(11)} ${ok?'responds':'DEAD'} (move ${a&&a.move}, attack ${a&&a.attack}, dodge ${a&&a.dodge})`);
    if(!ok)fail(`key ${code} did not produce ${JSON.stringify(want)} in the applied intent`);
  }
  game.sandbox.__dfTopMeter();
  const superChord=hold(['KeyZ','KeyX'],4);
  console.log(`  X+Z         ${superChord&&superChord.attack==='super'?'responds':'DEAD'} (attack ${superChord&&superChord.attack})`);
  if(!superChord||superChord.attack!=='super')fail('X+Z chord did not produce the GOD WHEEL intent at full meter');
  // Chords compose in the INTENT fields (attack/dodge); feet belong to the
  // resulting state machine (a fired jab steps in with its own motion).
  const chord=hold(['ArrowLeft','ArrowUp','Space','KeyX'],5);
  const chordOk=chord&&chord.attack==='jab'&&chord.dodge===false&&chord.tactic==='MANUAL FIST';
  console.log(`  LEFT+UP+SPACE+X chord: ${chordOk?'composed':'INTERFERED'} (${JSON.stringify(chord)})`);
  if(!chordOk)fail(`simultaneous keys interfered: ${JSON.stringify(chord)}`);
  const oppose=hold(['ArrowLeft','ArrowRight'],4);
  if(!oppose||oppose.move!==0)fail(`opposing arrows did not cancel: ${JSON.stringify(oppose)}`);
  const dodgeChord=hold(['ArrowLeft','ArrowDown','KeyZ'],4);
  if(!dodgeChord||dodgeChord.attack!=='launcher'||dodgeChord.dodge!==true)
    fail(`LEFT+DOWN+Z chord did not compose: ${JSON.stringify(dodgeChord)}`);
  game.frames(60,false); // let the state machine settle back to free
  const after=hold(['ArrowRight'],4);
  if(!after||after.move!==1)fail('keys went dead after a chord');
  if(!game.sandbox.__demonFistProbe().finite)fail('keyboard storm produced non-finite state');
}

console.log('5c) manual purity: a human owns the fighter completely — zero bot leakage');
{
  // Root-cause fixtures for the 2026-07-17 owner report "the ai isn\'t fully
  // given up controls". Each one FAILS on the pre-fix build:
  //  - no-input stillness: old build drifted 5.57px with |vx| spikes to 1.57
  //    over 120 idle frames (the bot anti-stall backstop shoved the fighter
  //    every ~11 stationary frames, outside the controller mux).
  //  - held-direction attack: old build answered RIGHT+jab by spinning LEFT
  //    (atkDir -1) to auto-target the enemy behind.
  //  - held-direction dodge: old build auto-evaded against the held arrow.
  //  - comeback chord: old humanIntent gated the GOD WHEEL at hp<40 while the
  //    sim charges 50 meter at hp<50 — X+Z at hp 45 / meter 60 produced a jab.
  const boot=()=>{
    const game=bootGame('demon-fist',{seed:0x5030,footer:FOOTER});
    press(game,'Enter');press(game,'Enter');
    if(!game.sandbox.__demonFistManual().playing)fail('manual purity fixtures need playing mode');
    game.sandbox.__dfClearStreet(2600);
    return game;
  };
  {
    const game=boot();game.sandbox.__dfClearApplied();
    const x0=game.sandbox.__dfFighterNow().x;let maxVx=0,minX=x0,maxX=x0,impure=null;
    for(let i=0;i<110;i++){
      game.frames(1,false);
      const now=game.sandbox.__dfFighterNow(),applied=game.sandbox.__dfLastApplied();
      maxVx=Math.max(maxVx,Math.abs(now.vx));minX=Math.min(minX,now.x);maxX=Math.max(maxX,now.x);
      if(applied&&(applied.move!==0||applied.attack!==null||applied.dodge!==false||applied.tactic!=='MANUAL FIST'))
        impure=impure||applied;
    }
    const drift=maxX-minX;
    console.log(`  no-input stillness: drift ${drift.toFixed(2)}px, max|vx| ${maxVx.toFixed(2)} over 110f (old build: 5.57px / 1.57)`);
    if(impure)fail(`idle human frames carried non-human intent: ${JSON.stringify(impure)}`);
    if(drift>1||maxVx>.25)fail(`fighter moved without input in manual mode: drift ${drift.toFixed(2)}px, |vx| ${maxVx.toFixed(2)}`);
  }
  {
    const game=boot();
    game.sandbox.__dfSpawnAt('thug',-12);
    game.key('keydown','ArrowRight');game.frames(2,false);
    game.key('keydown','KeyX');game.frames(2,false);
    const held=game.sandbox.__dfFighterNow();
    game.key('keyup','KeyX');game.key('keyup','ArrowRight');
    console.log(`  RIGHT+jab with the enemy on the LEFT: atkDir ${held.atkDir}, face ${held.face} (old build: -1)`);
    if(held.state!=='attack'||held.atkDir!==1||held.face!==1)
      fail(`attack ignored the held arrow: ${JSON.stringify(held)}`);
    game.frames(40,false);game.sandbox.__dfClearStreet(2600);game.sandbox.__dfSpawnAt('thug',-12);
    game.key('keydown','KeyX');game.frames(2,false);
    const assist=game.sandbox.__dfFighterNow();game.key('keyup','KeyX');
    if(assist.state!=='attack'||assist.atkDir!==-1)
      fail(`neutral jab lost the auto-target assist: ${JSON.stringify(assist)}`);
  }
  {
    const game=boot();
    const id=game.sandbox.__dfSpawnAt('thug',10,['windup',12]);
    const x0=game.sandbox.__dfFighterNow().x;
    game.key('keydown','ArrowRight');game.key('keydown','ArrowDown');game.frames(6,false);
    const now=game.sandbox.__dfFighterNow(),foe=game.sandbox.__dfEnemy(id);
    game.key('keyup','ArrowRight');game.key('keyup','ArrowDown');
    console.log(`  RIGHT+dodge past the windup: face ${now.face}, travel ${(now.x-x0).toFixed(2)}px, baited ${foe&&foe.baited} (old build: away from the arrow)`);
    if(now.state!=='dodge'||now.face!==-1||now.x-x0<1)
      fail(`dodge ignored the held arrow: ${JSON.stringify({now,from:x0})}`);
    if(!foe||!foe.baited)fail('held-direction dodge stopped baiting the windup');
  }
  {
    const game=boot();
    game.sandbox.__dfSpawnAt('thug',20);
    game.sandbox.__dfSetVitals(45,60);
    game.key('keydown','KeyX');game.key('keydown','KeyZ');game.frames(3,false);
    const now=game.sandbox.__dfFighterNow();
    game.key('keyup','KeyX');game.key('keyup','KeyZ');
    console.log(`  X+Z at hp 45 / meter 60: state ${now.state} (old build: attack — the chord died in the mapping)`);
    if(now.state!=='super')fail(`comeback GOD WHEEL chord did not fire: ${JSON.stringify(now)}`);
  }
  {
    const game=boot();
    game.key('keydown','ArrowRight');
    let peak=0;for(let i=0;i<80;i++){game.frames(1,false);peak=Math.max(peak,game.sandbox.__dfFighterNow().vx);}
    game.key('keyup','ArrowRight');
    console.log(`  held-right on a clear street: peak vx ${peak.toFixed(2)} px/f (walk 1.45, sprint 2.35; old build: 1.0)`);
    if(peak<2||peak>2.5)fail(`manual sprint out of range: peak vx ${peak.toFixed(2)}`);
    game.sandbox.__dfClearStreet(2600);
    game.key('keydown','ArrowUp');game.frames(10,false);game.key('keyup','ArrowUp');
    const air=game.sandbox.__dfFighterNow();
    game.frames(60,false);
    const landed=game.sandbox.__dfFighterNow();
    console.log(`  UP from the street: state ${air.state} at y ${air.y.toFixed(1)} -> ${landed.state}`);
    if(air.state!=='jump'||air.y<=2)fail(`manual jump never left the ground: ${JSON.stringify(air)}`);
    if(landed.state!=='free'||landed.y!==0)fail(`manual jump never landed clean: ${JSON.stringify(landed)}`);
    if(!game.sandbox.__demonFistProbe().finite)fail('manual acrobatics produced non-finite state');
  }
}

console.log('6) ten-minute soaks: moving street, live fights, block advance, and exact SHOW budgets');
for(const seed of[0x5200,0x52d4]){
  const{game,samples}=runSoak('demon-fist',{seed,minutes:10,footer:FOOTER}),report=analyzeSoak(samples),p=game.sandbox.__demonFistProbe(),
    show=p.show,offered=show.offeredByTier,shown=show.shownByTier,s3=shown[3]||0,continuity=game.sandbox.__dfContinuity;
  console.log(`  ${seed.toString(16)} ${soakLine(report)}; KOs ${p.stats.kos}, hits taken ${p.stats.hitsTaken}, `+
    `blocks ${p.stats.blocks}, tiers ${JSON.stringify(shown)}`);
  // Floors re-measured 2026-07-17 on the TMNT pacing build: events 2584..2656,
  // progress 824..871 (walk-1.0 build: 1981..2008 / 729..762). Stall ceiling
  // stays 7s; the sprint brought the measured stall DOWN to 4..5s.
  assertSoak(seed.toString(16),report,{still:1,quiet:5,stall:7,minEvents:2050,minProgress:640},fail);
  inBands(p,SOAK_BANDS,`seed ${seed.toString(16)} soak`);
  if(!p.finite)fail(`seed ${seed.toString(16)}: non-finite state`);
  if(continuity.max>7)fail(`seed ${seed.toString(16)}: unaccounted ${continuity.max.toFixed(2)}px one-step discontinuity`);
  for(const kind of['thug','sprinter','bruiser','demon'])if((p.stats[kind]||0)<3)fail(`seed ${seed.toString(16)}: ${kind} never joined the street (${p.stats[kind]})`);
  if(p.stats.elite<2)fail(`seed ${seed.toString(16)}: the keeper never walked in (${p.stats.elite})`);
  notePairs(p,'gate',`seed ${seed.toString(16)}`,2);notePairs(p,'mob',`seed ${seed.toString(16)}`,2);
  if(!((offered[1]||0)>(offered[2]||0)&&(offered[2]||0)>(offered[3]||0)&&(offered[3]||0)>=2))
    fail(`seed ${seed.toString(16)}: offered tiers not strictly ordered ${JSON.stringify(offered)}`);
  if(!((shown[1]||0)>(shown[2]||0)&&(shown[2]||0)>(shown[3]||0)&&(shown[3]||0)>=2))
    fail(`seed ${seed.toString(16)}: shown tiers not strictly ordered ${JSON.stringify(shown)}`);
  // Exact budgets, tolerant of one mid-flight final show: the ladder never
  // over-presents, and every completed show honors its windows. A show
  // truncated by the probe horizon is not a leak.
  if(show.heldFrames>6*s3||show.heldFrames<6*(s3-1))
    fail(`seed ${seed.toString(16)}: apex hold ${show.heldFrames} outside [${6*(s3-1)},${6*s3}]`);
  if(show.slowedFrames>24*s3||show.slowedFrames<24*(s3-1))
    fail(`seed ${seed.toString(16)}: apex slow ${show.slowedFrames} outside [${24*(s3-1)},${24*s3}]`);
  if(show.admireFrames>48*s3||show.admireFrames<48*(s3-1))
    fail(`seed ${seed.toString(16)}: apex admire ${show.admireFrames} outside [${48*(s3-1)},${48*s3}]`);
}
console.log('6b) motion contract: nobody parks bare, emote budgets measured, pace floors hold');
for(const[seed,minutes]of[[0x5200,10],[0x6100,2]]){
  const run=runMotion('demon-fist',{seed,minutes}),pace=paceOf(run);
  // Measured 2026-07-17 on this build: fighter worst emote pause 165f and
  // share 20..23%; pack worst pause 165f, share <=45.1%, turnover excess <=2.
  const riderReport=analyzeMotion({step:run.step,samples:run.samples.map(s=>Object.assign({},s,{actors:s.actors.filter(a=>a.id==='fighter')}))},{emoteFrames:240,emoteShare:.35,requiredIds:['fighter']});
  const packReport=analyzeMotion(run,{emoteFrames:240,emoteShare:.5,requiredIds:['fighter'],identityTurnoverAllowance:4});
  console.log(`  ${seed.toString(16)} (${minutes}m) rider[${motionLine(riderReport)}] pack[${motionLine(packReport)}] · fighter ${pace.rider.toFixed(3)} px/f · pack mean ${pace.packMean.toFixed(3)} px/f over ${pace.packCount} enemies`);
  assertMotion(seed.toString(16)+' rider',riderReport,fail);
  assertMotion(seed.toString(16)+' pack',packReport,fail);
  if(run.samples.some(s=>!s.actors.some(a=>a.id==='fighter')))fail(`${seed.toString(16)}: motion probe lost the fighter`);
  if(pace.rider<FIGHTER_PACE_FLOOR)fail(`${seed.toString(16)}: fighter pace ${pace.rider.toFixed(3)} px/f under floor ${FIGHTER_PACE_FLOOR}`);
  if(pace.packMean<PACK_PACE_FLOOR)fail(`${seed.toString(16)}: pack pace ${pace.packMean.toFixed(3)} px/f under floor ${PACK_PACE_FLOOR}`);
}
console.log('6c) __NO_EMOTE ablation re-proves the motion fix and stays sim-honest');
{
  const uncovered=analyzeMotion(runMotion('demon-fist',{seed:0x613d,minutes:3,footer:'globalThis.__NO_EMOTE=1;'}),{});
  console.log(`  __NO_EMOTE violations ${uncovered.violations.length}`);
  if(!uncovered.violations.some(v=>/no emote/.test(v)))fail('__NO_EMOTE ablation: motion gate no longer requires authored emote coverage');
  const a=bootGame('demon-fist',{seed:0x613d}),b=bootGame('demon-fist',{seed:0x613d});
  b.sandbox.__NO_EMOTE=1;a.frames(18000,false);b.frames(18000,false);
  if(a.sandbox.__demonFistSignature()!==b.sandbox.__demonFistSignature())
    fail('__NO_EMOTE changed simulation state (emotes must be render/probe-only)');
}

console.log('6d) contact contract: overlaps resolve in frames, the street keeps personal space');
{
  const game=bootGame('demon-fist',{seed:0x5292,footer:FOOTER});
  const staged=game.sandbox.__dfContactFixture();
  const before=game.sandbox.__dfHardOverlapNow();
  game.frames(60,false);
  const after=game.sandbox.__dfHardOverlapNow(),probe=game.sandbox.__demonFistProbe();
  console.log(`  staged hard overlap ${before} -> ${after} after 60f (contacts ${probe.stats.contacts})`);
  if(before<2)fail(`contact fixture did not stage overlapping bodies: ${JSON.stringify(staged)}`);
  if(after!==0)fail(`hard overlap survived the resolver: ${after} pairs after 60f`);
  for(const seed of[0x5293,0x5294]){
    const run=bootGame('demon-fist',{seed,footer:FOOTER});run.frames(7200,false);
    const p=run.sandbox.__demonFistProbe(),o=run.sandbox.__dfOverlap;
    console.log(`  ${seed.toString(16)}: worst overlap ${o.worst} pairs, longest ${o.maxRun}f; contacts ${p.stats.contacts}`);
    // Measured 2026-07-17 on the queue-discipline build across three 7200f
    // runs: worst 1..2 pairs, longest 5..11f. A brawler crowd jostles; a grind
    // that outlasts the band is the bug.
    if(o.worst>2)fail(`${seed.toString(16)}: ${o.worst} bodies hard-overlapped at once`);
    if(o.maxRun>12)fail(`${seed.toString(16)}: hard overlap persisted ${o.maxRun} frames (limit 12)`);
    if(p.stats.contacts<3)fail(`${seed.toString(16)}: the street stopped making contact (${p.stats.contacts})`);
  }
}

{
  const game=bootGame('demon-fist',{seed:0x5290,footer:FOOTER}),fixture=game.sandbox.__demonFistAdmireFixture();
  if(fixture.admired.tactic!=='SAVOR THE FIST'||fixture.gated.tactic==='SAVOR THE FIST')
    fail(`__NO_ADMIRE did not gate the bot-only savor: ${JSON.stringify(fixture)}`);
  const perfect=bootGame('demon-fist',{seed:0x5291,footer:FOOTER});perfect.sandbox.__NO_LAPSE=1;perfect.frames(18000,false);
  if(perfect.sandbox.__demonFistProbe().stats.lapses!==0)fail('__NO_LAPSE did not eliminate skill-profile lapse onsets');
}

console.log('7) payoff FX is a perfect same-seed simulation no-op');
{
  const a=bootGame('demon-fist',{seed:0x5300,footer:FOOTER}),b=bootGame('demon-fist',{seed:0x5300,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);
  const same=a.sandbox.__demonFistSignature()===b.sandbox.__demonFistSignature(),p=a.sandbox.__demonFistProbe();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} through ${p.stats.events} events / ${p.stats.kos} KOs`);
  if(!same)fail('__NO_PAYOFF_FX changed simulation state');
  if(p.stats.kos<1)fail('FX no-op window did not exercise a knockout payoff');
}

console.log('8) drawn facing is honest: the body tracks travel, attack poses stay authored');
{
  const fixture=bootGame('demon-fist',{seed:0x6001,footer:FOOTER}).sandbox.__dfPoseFixture();
  console.log(`  steadyRight face ${fixture.steadyRight.face} (vx ${fixture.steadyRight.vx}); `+
    `steadyLeft face ${fixture.steadyLeft.face}; lockedWalk face ${fixture.lockedWalk.face} (vx ${fixture.lockedWalk.vx})`);
  if(!(fixture.steadyRight.vx>.3&&fixture.steadyRight.face===1))
    fail(`free right travel must face RIGHT: ${JSON.stringify(fixture.steadyRight)}`);
  if(!(fixture.steadyLeft.vx<-.3&&fixture.steadyLeft.face===-1))
    fail(`free left travel must face LEFT: ${JSON.stringify(fixture.steadyLeft)}`);
  if(!(fixture.lockedWalk.face===1&&fixture.lockedWalk.vx<-.3))
    fail(`a locked authored pose must hold its facing while backpedaling: ${JSON.stringify(fixture.lockedWalk)}`);
  for(const seed of[0x6100,0x613d]){
    const game=bootGame('demon-fist',{seed,footer:FOOTER});game.frames(10800,false);
    const p=game.sandbox.__dfPose;
    console.log(`  ${seed.toString(16)}: ${p.frames}f free · wrong-way runs max ${p.wrongWayMax} (viol ${p.wrongWayViolations}) · crab viol ${p.crabViolations}`);
    if(p.frames<3000)fail(`${seed.toString(16)}: pose telemetry lost the fighter (${p.frames} frames)`);
    if(p.wrongWayViolations>0)fail(`${seed.toString(16)}: body faced AWAY from travel for >8 consecutive frames x${p.wrongWayViolations}`);
    if(p.crabViolations>0)fail(`${seed.toString(16)}: phantom crab while squared up idle x${p.crabViolations}`);
  }
}

console.log('9) feedback legibility: every good/bad sim event is visibly represented on screen');
{
  const config={frames:11000,poll:5,radius:26,perCategory:3,
    goodPalette:['#ffd166','#ffb02e','#67e8a2','#59d8f5','#fff3da'],badPalette:['#ff5d4f','#c92c3c','#ffffff'],
    signatureProbe:'__demonFistSignature'};
  // Seed 0x5302 replaced 0x5300 on 2026-07-17: the pacing build drops combos
  // by hit far less often, and 0x5302 is a measured seed where bad:combo-drop
  // still fires (x2) inside the 11000-frame window alongside every other
  // category, including the new good:jump quake (x28).
  const runs=[runFeedbackVisibility('demon-fist',Object.assign({seed:0x5302},config)),
    runFeedbackVisibility('demon-fist',Object.assign({seed:0x52d4},config))];
  for(const run of runs){
    const byKey={};for(const s of run.samples)byKey[s.key]=(byKey[s.key]||[]).concat(
      [`${s.changed}px sig${s.kind==='good'?s.goodPixels:s.badPixels}`]);
    console.log(`  ${run.seed.toString(16)}: ${Object.entries(run.counts).map(([k,v])=>`${k} x${v}`).join(', ')}`);
    console.log(`    samples: ${Object.entries(byKey).map(([k,v])=>`${k}[${v.join(' ')}]`).join(' ')}`);
  }
  console.log(`  ${feedbackLine(runs)}; signatures ${runs.every(r=>r.signaturesMatch)?'identical':'DIFFERENT'}`);
  assertFeedback('feedback',runs,{
    required:['good:ko','good:launcher','good:juggle','good:counter','good:combo','good:elite-ko','good:mob-clear','good:super',
      'good:jump','bad:hit-taken','bad:combo-drop','bad:knockdown'],
    minChanged:{default:12,'good:counter':8,'bad:combo-drop':8,'good:combo':8},
    minSignature:{default:8,'good:counter':4,'bad:combo-drop':4,'good:combo':4},
    maxInvisible:0
  },fail);
}

console.log(failed?'\nDEMON FIST EVAL FAILED':'\nDEMON FIST EVAL PASSED');
process.exit(failed?1:0);
