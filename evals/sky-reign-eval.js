#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
const{runMotion,analyzeMotion,assertMotion,motionLine}=require('./motion');
const{runFeedbackVisibility,assertFeedback,feedbackLine}=require('./feedback');

// Observation only: none of these hooks make decisions, touch physics values,
// draw, or consume either RNG stream.
const FOOTER=String.raw`
globalThis.__srApplied=[];
{const old=advanceCraft;advanceCraft=function(body,intent,env){const out=old(body,intent,env);
  if(body===dragon){globalThis.__srApplied.push({showFrame,runFrame,steer:intent.steer,climb:intent.climb,
    fire:intent.fire||0,targetX:intent.targetX,targetAlt:intent.targetAlt,tactic:intent.tactic});
    if(globalThis.__srApplied.length>360)globalThis.__srApplied.shift();}return out;};}
globalThis.__srClearApplied=()=>{globalThis.__srApplied.length=0;};
globalThis.__srLastApplied=()=>globalThis.__srApplied.at(-1)||null;
globalThis.__srContinuity={max:0,from:null,to:null};
{const old=stepDragon;stepDragon=function(){const from={x:dragon.x,y:dragon.worldY},out=old(),
  to={x:dragon.x,y:dragon.worldY},d=Math.hypot(to.x-from.x,to.y-from.y);
  if(d>globalThis.__srContinuity.max)globalThis.__srContinuity={max:d,from,to};return out;};}
globalThis.__srReset=()=>resetRun(true);
globalThis.__srWingKinds=()=>{const out={};for(const w of wings)out[w.kind]=(out[w.kind]||0)+1;return out;};
globalThis.__srActPositions=()=>({wings:wings.map(w=>[w.id,round(w.x,4),round(w.alt,3),round(w.worldY,4),w.state]),
  wyrm:wyrm?[round(wyrm.x,4),round(wyrm.alt,3),round(wyrm.worldY,4),wyrm.state]:null,
  dust:dust?round(dust.worldY,4):null,wind:round(act.wind,5)});
// Overlap contract: nobody flies through anybody. Hard overlap = deeper than
// the drawn bodies allow; the resolver must clear it within a few frames.
globalThis.__srOverlap={worst:0,maxRun:0,run:0};
globalThis.__srOverlapScan=()=>{
  const bodies=[dragon,...wings.filter(w=>w.respawnT<=0&&w.state!=='down'),...swarm.filter(s=>s.hp>0&&!s.turret)];
  let hard=0;
  for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
    const a=bodies[i],b=bodies[j];
    if(Math.abs(a.x-b.x)<4.5&&Math.abs(a.worldY-b.worldY)<7&&Math.abs(a.alt-b.alt)<5)hard++;
  }
  const O=globalThis.__srOverlap;O.worst=Math.max(O.worst,hard);
  O.run=hard?O.run+1:0;O.maxRun=Math.max(O.maxRun,O.run);
  return hard;
};
{const old=stepWorld;stepWorld=function(){const out=old();globalThis.__srOverlapScan();return out;};}
// Eval-only hooks: stage a hard overlap the resolver must clear. Never runs
// during measured sweeps.
globalThis.__srContactFixture=()=>{
  dragon.x=80;dragon.alt=26;dragon.worldY=5000;dragon.vx=0;dragon.valt=0;dragon.wreckT=0;dragon.invulnT=0;
  wings.length=0;swarm.length=0;bolts.length=0;missiles.length=0;lances.length=0;wyrm=null;dust=null;
  const a=makeWing('vyr',81,5001,27,0),b=makeWing('wasp',120,5400,30,1);
  wings.push(a,b);swarm.push(makeSwarm('manta',79,4998,25));
  return{dragon:{x:dragon.x,y:dragon.worldY,alt:dragon.alt},wing:{x:a.x,y:a.worldY,alt:a.alt}};
};
globalThis.__srHardOverlapNow=()=>{
  const bodies=[dragon,...wings.filter(w=>w.respawnT<=0&&w.state!=='down'),...swarm.filter(s=>s.hp>0&&!s.turret)];
  let hard=0;
  for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
    const a=bodies[i],b=bodies[j];
    if(Math.abs(a.x-b.x)<4.5&&Math.abs(a.worldY-b.worldY)<7&&Math.abs(a.alt-b.alt)<5)hard++;
  }
  return hard;
};
// Pose-honesty telemetry: the drawn bank must track actual travel. Persistence
// counters, because honest yaw inertia is ALLOWED to lag a few frames through
// a lateral flip or a bump — a cosmetic lean would sit wrong-signed for whole
// transits, which no persistence window forgives.
globalThis.__srPose={frames:0,wrongWayRun:0,wrongWayMax:0,wrongWayViolations:0,straightRun:0,crabViolations:0};
{const P=globalThis.__srPose,old=stepDragon;stepDragon=function(){const out=old();
  if(dragon.wreckT>0||dragon.contactT>0)return out; // tumbles and bumps pose by their own rules
  P.frames++;
  const va=Math.atan2(dragon.vx,Math.max(.5,Math.abs(dragon.speed))),bank=dragon.bank;
  const wrongWay=Math.abs(dragon.vx)>.3&&Math.sign(bank)!==Math.sign(va)&&Math.abs(bank)>.06;
  P.wrongWayRun=wrongWay?P.wrongWayRun+1:0;P.wrongWayMax=Math.max(P.wrongWayMax,P.wrongWayRun);
  if(P.wrongWayRun>8)P.wrongWayViolations++;
  const straight=Math.abs(dragon.vx)<.06&&Math.abs((dragon.intent&&dragon.intent.steer)||0)<.1;
  P.straightRun=straight?P.straightRun+1:0;
  if(P.straightRun>20&&Math.abs(bank-va)>.035)P.crabViolations++;
  return out;};}
// Scripted pose fixtures through the SHARED integrator: each one fails a
// cosmetic-lean build (steadyRight must bank INTO travel; release must
// straighten; steadyLeft mirrors).
globalThis.__srPoseFixture=()=>{
  const drive=(b,intent,frames)=>{for(let i=0;i<frames;i++)
    advanceCraft(b,Object.assign({steer:0,climb:0,fire:0,targetX:80,targetAlt:26,tactic:'FIXTURE'},intent),{wind:0,speedMul:1});
    return{bank:b.bank,vx:b.vx,va:Math.atan2(b.vx,Math.max(.5,Math.abs(b.speed)))};};
  const fresh=()=>{const b=makeDragon();b.worldY=900;b.speed=2;return b;};
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
const policyScore=p=>3*p.stats.kills+10*p.stats.volleyKills+25*p.stats.volleyWipes+15*p.stats.phaseBreaks+
  40*p.stats.wyrmKills+2*p.stats.lanceHits-5*p.stats.hitsTaken-10*p.stats.wrecks-2*p.stats.collisions;
const failures=p=>p.stats.hitsTaken+4*p.stats.wrecks+p.stats.collisions;
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

// Re-measured 2026-07-17 (ascension + charge-hold build) from a fresh ten-seed
// paired five-minute sweep (0x4f00 + i*37, .artifacts/sky-reign-sweep.js),
// planned-route extrema: markers 121..122, biomes 9, kills 130..178,
// volleyKills 113..159, volleys 95..117, volleyWipes 10..19, locks 380..477,
// lanceHits 1..10, lances 6..29, boltsFaced 196..214, nearMisses 66..93,
// hitsTaken 23..39, shieldBreaks 1..8, wounds 0..12, collisions 18..35,
// wrecks 0, lapses 1..4, acts 3, actClears 2, storms 2, stormClears 2, wyrms 1,
// phaseBreaks 3, wyrmKills 1, dodges 71..83, contacts 69..109, upgrades 2,
// fullRacks 64..86, maxRack 4, events 1020..1147, progress 277..334.
// Old->new: kill/volley bands shifted DOWN (tier-0 opens at a 2-lock rack and
// the bot now holds a full rack charged for CHARGE_HOLD frames before release);
// wounds/shieldBreaks widened because early racks release fewer simultaneous
// kills. ~15-25% margin as before.
const POLICY_BANDS={
  markers:[114,128],biomes:[8,10],kills:[104,213],volleyKills:[90,191],volleys:[76,140],
  volleyWipes:[7,25],locks:[304,572],lanceHits:[0,14],lances:[3,36],boltsFaced:[157,257],
  nearMisses:[53,112],hitsTaken:[18,47],shieldBreaks:[0,10],wounds:[0,15],collisions:[14,42],
  wrecks:[0,1],lapses:[0,5],acts:[3,3],actClears:[1,3],storms:[2,2],stormClears:[1,3],
  wyrms:[1,1],phaseBreaks:[2,4],wyrmKills:[0,1],dodges:[57,100],contacts:[55,131],
  upgrades:[2,2],fullRacks:[51,103],maxRack:[4,4],
  events:[816,1376],progress:[222,401]
};
// Same 2026-07-17 sweep, __NO_ROUTE_PLAN baseline extrema: markers 120..122,
// biomes 9, kills 116..162, volleyKills 93..134, volleys 90..108, volleyWipes
// 6..14, locks 353..437, lanceHits 2..8, lances 3..20, boltsFaced 199..243,
// nearMisses 111..150, hitsTaken 52..63, shieldBreaks 4..13, wounds 14..27,
// collisions 42..55, wrecks 0..2, lapses 1..4, acts 3, actClears 2, storms 2,
// stormClears 2, wyrms 1, phaseBreaks 3, wyrmKills 1, dodges 61..85, contacts
// 80..129, upgrades 2, fullRacks 56..77, maxRack 4, events 1031..1223,
// progress 259..311.
const REACTIVE_BANDS={
  markers:[114,128],biomes:[8,10],kills:[93,194],volleyKills:[74,161],volleys:[72,130],
  volleyWipes:[4,18],locks:[282,524],lanceHits:[0,12],lances:[2,26],boltsFaced:[159,292],
  nearMisses:[89,180],hitsTaken:[42,76],shieldBreaks:[3,17],wounds:[10,33],collisions:[34,66],
  wrecks:[0,3],lapses:[0,5],acts:[3,3],actClears:[1,3],storms:[2,2],stormClears:[1,3],
  wyrms:[1,1],phaseBreaks:[2,4],wyrmKills:[0,1],dodges:[49,102],contacts:[64,155],
  upgrades:[2,2],fullRacks:[45,93],maxRack:[4,4],
  events:[825,1468],progress:[207,373]
};
// Re-measured 2026-07-17 from six independent ten-minute soaks (0x5200, 0x52d4,
// 0x5468, 0x55fc, 0x5788, 0x5914): still 0s, quiet 1-2s, stall 2s, events
// 2205..2246, progress 569..602, continuityMax 2.34, tier3 shown 14..22,
// markers 242..244, biomes 18, kills 270..295, volleyKills 226..260, volleys
// 197..218, volleyWipes 18..30, locks 835..881, lanceHits 7..15, lances 21..38,
// boltsFaced 397..431, nearMisses 150..180, hitsTaken 63..80, shieldBreaks
// 5..10, wounds 2..17, collisions 56..72, wrecks 0..1, lapses 2..5, acts 7,
// actClears 4, storms 4, stormClears 4, wyrms 3, phaseBreaks 9, wyrmKills 3,
// dodges 143..173, contacts 161..189, upgrades 2, fullRacks 128..148, maxRack
// 4. ~15-25% margin.
const SOAK_BANDS={
  markers:[230,256],biomes:[16,20],kills:[216,354],volleyKills:[181,312],volleys:[158,262],
  volleyWipes:[13,39],locks:[668,1057],lanceHits:[5,20],lances:[15,48],boltsFaced:[318,517],
  nearMisses:[120,216],hitsTaken:[50,96],shieldBreaks:[3,14],wounds:[0,22],collisions:[45,86],
  wrecks:[0,1],lapses:[1,6],acts:[7,7],actClears:[3,5],storms:[4,4],stormClears:[3,5],
  wyrms:[3,3],phaseBreaks:[8,10],wyrmKills:[2,3],dodges:[114,208],contacts:[129,227],
  upgrades:[2,2],fullRacks:[102,178],maxRack:[4,4],
  events:[1764,2695],progress:[455,722]
};
// Aggregate A/B margins from the same 2026-07-17 sweep: score 20054 vs 15273
// (ratio 1.313), failures 609 vs 1105 (ratio 0.551), hits 324 vs 572, wrecks 0
// vs 15, wipes 135 vs 101; scoreWins 9/10, failureWins 10/10.
// Old->new: measured score ratio moved 1.534 -> 1.313 because both arms now
// share the same tier-0 opening and charge-hold; the floors keep clear margin
// under the fresh measurement (1.15 < 1.313, 14000 < 20054, .62 > .551).
const AGGREGATE_SCORE_FLOOR=14000,AGGREGATE_SCORE_RATIO=1.15,AGGREGATE_FAIL_RATIO=.62;
const BASELINE_KILLS_FLOOR=1000,BASELINE_VOLLEYS_FLOOR=700,BASELINE_EVENTS_FLOOR=8000;
// Soak floors: measured events 2205..2246, progress 569..602; continuity 2.34px.
const SOAK_MIN_EVENTS=1700,SOAK_MIN_PROGRESS=450,CONTINUITY_CAP=3.4;
// Motion-contract pace floors, measured 2026-07-17 over seeds 0x6100/0x613d
// three-minute motion runs: dragon 2.054..2.064 px/f, pack mean 1.079..1.083
// px/f. Floors keep ~12-17% margin under the measured minima.
const RIDER_PACE_FLOOR=1.8,PACK_PACE_FLOOR=.9;
const paceOf=run=>{const per=new Map();let prev=null;
  for(const s of run.samples){if(prev)for(const a of s.actors){const b=prev.actors.find(q=>q.id===a.id);if(!b)continue;
    const d=Math.hypot(a.x-b.x,a.y-b.y),t=per.get(a.id)||{d:0,f:0};t.d+=d;t.f+=run.step;per.set(a.id,t);}prev=s;}
  const pack=[...per.entries()].filter(([id])=>id!=='dragon'&&id!=='wyrm').map(([,t])=>t.d/t.f),d=per.get('dragon');
  return{rider:d?d.d/d.f:0,packMean:pack.length?pack.reduce((a,b)=>a+b,0)/pack.length:0,packCount:pack.length};};

console.log('1) fixed 60 Hz determinism, render parity, chunk parity, and finite renderer');
{
  const a=bootGame('sky-reign',{seed:0x4e01,footer:FOOTER}),
    b=bootGame('sky-reign',{seed:0x4e01,footer:FOOTER}),
    rendered=bootGame('sky-reign',{seed:0x4e01,footer:FOOTER});
  a.frames(3600,false);b.frames(3600,false);const draws=rendered.frames(3600,true);
  const sa=a.sandbox.__skyReignSignature(),sb=b.sandbox.__skyReignSignature(),sr=rendered.sandbox.__skyReignSignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${draws.calls} draw calls`);
  if(sa!==sb)fail('same seed diverged at fixed 60 Hz');
  if(sa!==sr)fail('render traversal changed simulation state or RNG');
  if(!a.sandbox.__skyReignProbe().finite||!rendered.sandbox.__skyReignProbe().finite)fail('headless or rendered replay became non-finite');
  if(draws.calls<1000||!draws.byMethod.fillRect||!draws.byMethod.beginPath||!draws.byMethod.fillText)
    fail(`renderer was not genuinely exercised: ${JSON.stringify(draws.byMethod)}`);

  const mono=bootGame('sky-reign',{seed:0x4e02,footer:FOOTER}),chunked=bootGame('sky-reign',{seed:0x4e02,footer:FOOTER});
  mono.frames(2400,false);for(let i=0;i<240;i++)chunked.frames(10,false);
  const same=mono.sandbox.__skyReignSignature()===chunked.sandbox.__skyReignSignature();
  console.log(`  2,400 monolithic frames vs 240 x 10: ${same?'identical':'DIFFERENT'}`);
  if(!same)fail('headless batching changed fixed-step simulation');
}

console.log('2) route lookahead is pure, repeatable, RNG-inert, and uses the shared integrator');
{
  const planned=bootGame('sky-reign',{seed:0x4e10,footer:FOOTER}),control=bootGame('sky-reign',{seed:0x4e10,footer:FOOTER}),
    fixture=planned.sandbox.__skyReignPlannerFixture();
  const nextPlanned=planned.sandbox.__skyReignNextRandom(),nextControl=control.sandbox.__skyReignNextRandom();
  console.log(`  pure ${fixture.pure}; repeat ${fixture.repeat}; spot ${fixture.plan&&fixture.plan.targetX}@${fixture.plan&&fixture.plan.targetAlt}; RNG ${nextPlanned.toFixed(8)}/${nextControl.toFixed(8)}`);
  if(!fixture.pure||!fixture.repeat||!fixture.finite||!fixture.plan||!Number.isFinite(fixture.plan.score))
    fail(`planner fixture regressed: ${JSON.stringify(fixture)}`);
  if(nextPlanned!==nextControl)fail('route planning consumed engine RNG for simulation-invisible work');
}

console.log('3) baseline-first route-policy A/B: ten paired five-minute seeds');
{
  const smart=[],reactive=[];let scoreWins=0,failureWins=0;
  for(let i=0;i<10;i++){
    const seed=0x4f00+i*37,a=bootGame('sky-reign',{seed,footer:FOOTER}),b=bootGame('sky-reign',{seed,footer:FOOTER});
    b.sandbox.__NO_ROUTE_PLAN=1;a.frames(18000,false);b.frames(18000,false);
    const pa=a.sandbox.__skyReignProbe(),pb=b.sandbox.__skyReignProbe();smart.push(pa);reactive.push(pb);
    if(policyScore(pa)>policyScore(pb))scoreWins++;if(failures(pa)<failures(pb))failureWins++;
    inBands(pa,POLICY_BANDS,`seed ${seed.toString(16)} planned`);
    inBands(pb,REACTIVE_BANDS,`seed ${seed.toString(16)} reactive`);
    for(const[p,label]of[[pa,'planned'],[pb,'reactive']]){
      if(!p.finite)fail(`seed ${seed.toString(16)} ${label}: non-finite state`);
      if(p.stats.maxEventLull>360||p.stats.maxProgressLull>420)fail(`seed ${seed.toString(16)} ${label}: story lull ${p.stats.maxEventLull}/${p.stats.maxProgressLull}f`);
    }
    console.log(`  ${seed.toString(16)} ${pa.persona.padEnd(10)} score ${policyScore(pa)}/${policyScore(pb)}, `+
      `wipes ${pa.stats.volleyWipes}/${pb.stats.volleyWipes}, failures ${failures(pa)}/${failures(pb)}`);
  }
  const score=[sum(smart,'kills')*3+10*sum(smart,'volleyKills')+25*sum(smart,'volleyWipes')+15*sum(smart,'phaseBreaks')+
      40*sum(smart,'wyrmKills')+2*sum(smart,'lanceHits')-5*sum(smart,'hitsTaken')-10*sum(smart,'wrecks')-2*sum(smart,'collisions'),
    sum(reactive,'kills')*3+10*sum(reactive,'volleyKills')+25*sum(reactive,'volleyWipes')+15*sum(reactive,'phaseBreaks')+
      40*sum(reactive,'wyrmKills')+2*sum(reactive,'lanceHits')-5*sum(reactive,'hitsTaken')-10*sum(reactive,'wrecks')-2*sum(reactive,'collisions')],
    bad=[smart.reduce((n,p)=>n+failures(p),0),reactive.reduce((n,p)=>n+failures(p),0)],
    hitSums=[sum(smart,'hitsTaken'),sum(reactive,'hitsTaken')],wreckSums=[sum(smart,'wrecks'),sum(reactive,'wrecks')],
    wipeSums=[sum(smart,'volleyWipes'),sum(reactive,'volleyWipes')],
    baseline={kills:sum(reactive,'kills'),volleyKills:sum(reactive,'volleyKills'),volleys:sum(reactive,'volleys'),
      locks:sum(reactive,'locks'),events:sum(reactive,'events')};
  console.log(`  ${scoreWins}/10 score wins; ${failureWins}/10 failure wins; score ${score[0]}/${score[1]}, `+
    `failures ${bad[0]}/${bad[1]}, hits ${hitSums[0]}/${hitSums[1]}, wrecks ${wreckSums[0]}/${wreckSums[1]}, wipes ${wipeSums[0]}/${wipeSums[1]}`);
  if(scoreWins<7||failureWins<9)fail(`route plan did not win clearly enough (${scoreWins}/10 score, ${failureWins}/10 failures)`);
  // Aggregate margins locked from the dated sweep comment above POLICY_BANDS.
  if(score[0]<AGGREGATE_SCORE_FLOOR||score[0]<score[1]*AGGREGATE_SCORE_RATIO||bad[0]>bad[1]*AGGREGATE_FAIL_RATIO)
    fail(`aggregate route-policy win regressed: ${JSON.stringify({score,bad,hitSums,wreckSums})}`);
  if(baseline.kills<BASELINE_KILLS_FLOOR||baseline.volleys<BASELINE_VOLLEYS_FLOOR||baseline.events<BASELINE_EVENTS_FLOOR)
    fail(`__NO_ROUTE_PLAN baseline stopped honestly participating: ${JSON.stringify(baseline)}`);
}

console.log('3b) __NO_VOLLEY ablation: homing artillery is causal, the baseline stays armed and mobile');
{
  // Measured 2026-07-17 over eight paired five-minute seeds (0x7a00 + i*53,
  // .artifacts/sky-reign-sweep.js): live kills 130..166, volleys 102..112,
  // volleyKills 111..151, locks 400..462, volleyWipes 9..18, sweeps
  // 10875..12862, phaseBreaks 3; __NO_VOLLEY kills 86..99, lances 321..383,
  // lanceHits 86..108, nearMisses 143..216, markers 123, events 980..1179,
  // progress 222..235, lulls <=147/147, and volleys/volleyKills/locks/sweeps/
  // volleyWipes/fullRacks/maxRack/phaseBreaks all exactly 0. Bands keep
  // ~20-25% margin; the zeros are hard.
  const LIVE_VOLLEY_BANDS={volleys:[82,134],volleyKills:[89,181],locks:[320,554],volleyWipes:[7,24]};
  const ABLATED_FLOORS={kills:64,lances:240,lanceHits:64,nearMisses:107,markers:114,events:780,progress:177};
  for(let i=0;i<8;i++){
    const seed=0x7a00+i*53,a=bootGame('sky-reign',{seed,footer:FOOTER}),b=bootGame('sky-reign',{seed,footer:FOOTER});
    b.sandbox.__NO_VOLLEY=1;
    // Decision window: the live dragon must acquire its first lock and diverge
    // physically from the volley-less twin early in the run.
    let firstLock=-1,firstDiverge=-1;
    for(let f=0;f<3600;f+=60){
      a.frames(60,false);b.frames(60,false);
      if(firstLock<0&&a.sandbox.__skyReignProbe().stats.locks>0)firstLock=f+60;
      if(firstDiverge<0&&a.sandbox.__skyReignPhysical()!==b.sandbox.__skyReignPhysical())firstDiverge=f+60;
    }
    a.frames(18000-3600,false);b.frames(18000-3600,false);
    const pa=a.sandbox.__skyReignProbe(),pb=b.sandbox.__skyReignProbe();
    console.log(`  ${seed.toString(16)} ${pa.persona.padEnd(10)} live volleys ${pa.stats.volleys} wipes ${pa.stats.volleyWipes} `+
      `sweeps ${pa.stats.sweeps} kills ${pa.stats.kills} | ablated kills ${pb.stats.kills} lances ${pb.stats.lances} `+
      `lanceHits ${pb.stats.lanceHits} | first lock ${firstLock}f, diverged ${firstDiverge}f`);
    inBands(pa,LIVE_VOLLEY_BANDS,`seed ${seed.toString(16)} live volley`);
    if(firstLock<0||firstDiverge<0||firstDiverge>firstLock+600)
      fail(`seed ${seed.toString(16)}: volley mechanic did not change decisions in the setup window (lock ${firstLock}f, diverge ${firstDiverge}f)`);
    for(const key of['volleys','volleyKills','locks','sweeps','volleyWipes','fullRacks','maxRack'])
      if(pb.stats[key]!==0)fail(`seed ${seed.toString(16)}: __NO_VOLLEY still recorded ${key}=${pb.stats[key]}`);
    if(pa.stats.phaseBreaks<2||pb.stats.phaseBreaks>1)
      fail(`seed ${seed.toString(16)}: volley causality on the wyrm regressed (${pa.stats.phaseBreaks} vs ${pb.stats.phaseBreaks} breaks)`);
    for(const[key,floor]of Object.entries(ABLATED_FLOORS))
      if(pb.stats[key]<floor)fail(`seed ${seed.toString(16)}: __NO_VOLLEY baseline lost capability: ${key} ${pb.stats[key]} < ${floor}`);
    if(pb.stats.maxEventLull>360||pb.stats.maxProgressLull>420)
      fail(`seed ${seed.toString(16)}: __NO_VOLLEY baseline went dead-air (${pb.stats.maxEventLull}/${pb.stats.maxProgressLull}f)`);
    if(!pa.finite||!pb.finite)fail(`seed ${seed.toString(16)}: non-finite state in volley A/B`);
    if(pa.stats.kills<=pb.stats.kills)fail(`seed ${seed.toString(16)}: volleys did not out-kill the lance baseline (${pa.stats.kills} vs ${pb.stats.kills})`);
  }
}

console.log('3c) __NO_UPGRADE ablation: ascension is real, visible in telemetry, and causal for wipes');
{
  // Measured 2026-07-17 over eight paired five-minute seeds (0x7b00 + i*61,
  // .artifacts/sky-reign-sweep.js): live upgrades 2, maxRack 4, volleyWipes
  // 9..20, fullRacks 65..83; __NO_UPGRADE upgrades 0, maxRack 2, volleyWipes 0,
  // volleys 202..217, fullRacks 193..211 (the frozen build volleys MORE often
  // with its small rack — capacity, not activity, is what ascension buys).
  // The eval replays the first four seeds.
  for(let i=0;i<4;i++){
    const seed=0x7b00+i*61,a=bootGame('sky-reign',{seed,footer:FOOTER}),b=bootGame('sky-reign',{seed,footer:FOOTER});
    b.sandbox.__NO_UPGRADE=1;a.frames(18000,false);b.frames(18000,false);
    const pa=a.sandbox.__skyReignProbe(),pb=b.sandbox.__skyReignProbe();
    console.log(`  ${seed.toString(16)} live tier ${pa.dragon.tier} upgrades ${pa.stats.upgrades} maxRack ${pa.stats.maxRack} `+
      `wipes ${pa.stats.volleyWipes} fullRacks ${pa.stats.fullRacks} | frozen maxRack ${pb.stats.maxRack} `+
      `wipes ${pb.stats.volleyWipes} volleys ${pb.stats.volleys}`);
    if(pa.stats.upgrades!==2||pa.dragon.tier!==2||pa.stats.maxRack!==4)
      fail(`seed ${seed.toString(16)}: dragon did not ascend across a natural run (${JSON.stringify({upgrades:pa.stats.upgrades,tier:pa.dragon.tier,maxRack:pa.stats.maxRack})})`);
    if(pa.stats.volleyWipes<7)fail(`seed ${seed.toString(16)}: ascended run lost its wipes (${pa.stats.volleyWipes})`);
    if(pb.stats.upgrades!==0||pb.stats.maxRack!==2||pb.stats.volleyWipes!==0)
      fail(`seed ${seed.toString(16)}: __NO_UPGRADE leaked tier growth (${JSON.stringify({upgrades:pb.stats.upgrades,maxRack:pb.stats.maxRack,wipes:pb.stats.volleyWipes})})`);
    if(pb.stats.volleys<162||pb.stats.fullRacks<150)
      fail(`seed ${seed.toString(16)}: __NO_UPGRADE baseline stopped volleying (${pb.stats.volleys} volleys, ${pb.stats.fullRacks} full racks)`);
  }
  // Tier timing: ascensions land exactly on the kill milestones and the rack
  // capacity follows 2 -> 3 -> 4.
  const game=bootGame('sky-reign',{seed:0x7d01,footer:FOOTER});
  const seen=[];let lastTier=0;
  for(let f=0;f<18000&&seen.length<2;f+=30){
    game.frames(30,false);
    const p=game.sandbox.__skyReignProbe();
    if(p.dragon.tier!==lastTier){seen.push({tier:p.dragon.tier,kills:p.stats.kills,cap:p.dragon.cap});lastTier=p.dragon.tier;}
  }
  console.log(`  tier timeline: ${JSON.stringify(seen)}`);
  if(seen.length!==2||seen[0].tier!==1||seen[0].kills<12||seen[0].cap!==3||
    seen[1].tier!==2||seen[1].kills<30||seen[1].cap!==4)
    fail(`ascension milestones drifted from kills 12/30 with caps 3/4: ${JSON.stringify(seen)}`);
}

console.log('4) SANDSTORM FRONT and CARRIER WYRM change the world during an exact 240f warning');
for(const type of['sandstorm','wyrm']){
  const seed=type==='sandstorm'?0x5010:0x5011,a=bootGame('sky-reign',{seed,footer:FOOTER}),b=bootGame('sky-reign',{seed,footer:FOOTER});
  a.sandbox.__skyReignActFixture(type);b.sandbox.__skyReignActFixture(type);b.sandbox.__NO_ACTS=1;
  const phys=sandbox=>{const p=sandbox.__skyReignProbe();
    return sandbox.__skyReignPhysical()+'|'+JSON.stringify(sandbox.__srActPositions?sandbox.__srActPositions():[]);};
  if(phys(a.sandbox)!==phys(b.sandbox))fail(`${type}: paired act fixture did not start identical`);
  let first=-1,phase='';
  for(let frame=1;frame<=270;frame++){
    a.frames(1,false);b.frames(1,false);
    if(first<0&&phys(a.sandbox)!==phys(b.sandbox)){first=frame;phase=a.sandbox.__skyReignProbe().act.phase;}
  }
  const pa=a.sandbox.__skyReignProbe(),pb=b.sandbox.__skyReignProbe(),warn=pa.act.notes.find(n=>n.kind==='act-warning'),land=pa.act.notes.find(n=>n.kind==='act-land');
  console.log(`  ${type}: first physical divergence ${first}f in ${phase}; warning ${warn&&land?land.tag-warn.tag:'?'}f`);
  if(!warn||!land||land.tag-warn.tag!==240)fail(`${type}: warning/land pair was not exactly 240 frames`);
  if(warn&&land&&land.at-warn.at<240)fail(`${type}: viewer warning shrank below 240 frames`);
  if(first<1||first>=240||phase!=='warn')fail(`${type}: act did not physically change the world during warning`);
  if(pb.act.notes.length)fail(`${type}: __NO_ACTS emitted notes`);
}
{
  const game=bootGame('sky-reign',{seed:0x5012,footer:FOOTER});game.sandbox.__skyReignActFixture('sandstorm');game.frames(100,false);
  game.sandbox.__srReset();game.frames(300,false);const p=game.sandbox.__skyReignProbe();
  if(p.act.phase!=='calm'||p.act.notes.some(n=>n.kind==='act-land'))fail('reset during act warning left a stale land');
}

console.log('5) human takeover shares the bot intent schema and runtime craft physics');
{
  const game=bootGame('sky-reign',{seed:0x5020,footer:FOOTER}),initial=game.sandbox.__skyReignManual();
  press(game,'Enter');const instructions=game.sandbox.__skyReignManual();press(game,'Enter');const started=game.sandbox.__skyReignManual();
  const schema=game.sandbox.__skyReignIntentSchemas();game.sandbox.__srClearApplied();
  game.key('keydown','ArrowLeft');game.frames(5,false);game.key('keyup','ArrowLeft');const steer=game.sandbox.__srLastApplied();
  game.sandbox.__srClearApplied();game.key('keydown','ArrowUp');game.frames(4,false);game.key('keyup','ArrowUp');const climb=game.sandbox.__srLastApplied();
  game.sandbox.__srClearApplied();game.key('keydown','KeyX');game.frames(2,false);game.key('keyup','KeyX');const lock=game.sandbox.__srLastApplied();
  console.log(`  playing ${initial.playing}->${instructions.playing}->${started.playing}; schema ${schema.humanKeys.join(',')}; steer ${steer&&steer.steer}, climb ${climb&&climb.climb}, fire ${lock&&lock.fire}`);
  if(initial.playing||instructions.playing||!started.playing)fail('manual session skipped the two-Enter gate');
  if(schema.humanKeys.join('|')!==schema.botKeys.join('|'))fail(`human/bot intent schemas differ: ${JSON.stringify(schema)}`);
  if(!steer||steer.steer!==-1||steer.tactic!=='MANUAL REIGN')fail('manual steering did not traverse runtime advanceCraft');
  if(!climb||climb.climb!==1||climb.tactic!=='MANUAL REIGN')fail('manual climb did not traverse runtime advanceCraft');
  if(!lock||lock.fire!==2||lock.tactic!=='MANUAL REIGN')fail('manual lock-hold did not traverse runtime advanceCraft');
  if(!game.sandbox.__skyReignProbe().finite)fail('manual control produced non-finite state');
}

console.log('5b) every mapped key is responsive, and simultaneous presses compose in one intent');
{
  const game=bootGame('sky-reign',{seed:0x5021,footer:FOOTER});
  press(game,'Enter');press(game,'Enter');
  if(!game.sandbox.__skyReignManual().playing)fail('keyboard fixtures need playing mode');
  const hold=(codes,frames)=>{for(const c of codes)game.key('keydown',c);game.frames(frames,false);
    const a=game.sandbox.__srLastApplied();for(const c of codes)game.key('keyup',c);game.sandbox.__srClearApplied();return a;};
  const checks=[
    ['ArrowLeft',{steer:-1}],['ArrowRight',{steer:1}],['ArrowUp',{climb:1}],['ArrowDown',{climb:-1}],
    ['Space',{fire:1}],['KeyX',{fire:2}],['KeyJ',{fire:2}],['KeyK',{fire:2}],
    ['KeyZ',{fire:2}],['ShiftLeft',{fire:2}],['ShiftRight',{fire:2}]
  ];
  for(const[code,want]of checks){
    const a=hold([code],4);
    const ok=a&&Object.entries(want).every(([k,v])=>a[k]===v)&&a.tactic==='MANUAL REIGN';
    console.log(`  ${code.padEnd(11)} ${ok?'responds':'DEAD'} (steer ${a&&a.steer}, climb ${a&&a.climb}, fire ${a&&a.fire})`);
    if(!ok)fail(`key ${code} did not produce ${JSON.stringify(want)} in the applied intent`);
  }
  // Simultaneous chord: steer + climb + lance + lock-hold in ONE applied intent.
  const chord=hold(['ArrowLeft','ArrowUp','Space','KeyX'],5);
  const chordOk=chord&&chord.steer===-1&&chord.climb===1&&chord.fire===2&&chord.tactic==='MANUAL REIGN';
  console.log(`  LEFT+UP+SPACE+X chord: ${chordOk?'composed':'INTERFERED'} (${JSON.stringify(chord)})`);
  if(!chordOk)fail(`simultaneous keys interfered: ${JSON.stringify(chord)}`);
  // Opposing pairs cancel honestly, and keys stay responsive after chords.
  const oppose=hold(['ArrowLeft','ArrowRight'],4);
  if(!oppose||oppose.steer!==0)fail(`opposing arrows did not cancel: ${JSON.stringify(oppose)}`);
  const opposeV=hold(['ArrowUp','ArrowDown'],4);
  if(!opposeV||opposeV.climb!==0)fail(`opposing verticals did not cancel: ${JSON.stringify(opposeV)}`);
  const after=hold(['ArrowRight'],4);
  if(!after||after.steer!==1)fail('keys went dead after a chord');
  if(!game.sandbox.__skyReignProbe().finite)fail('keyboard storm produced non-finite state');
}

console.log('6) ten-minute soaks: moving corridor, pack combat, volley economy, and exact SHOW budgets');
for(const seed of[0x5200,0x52d4]){
  const{game,samples}=runSoak('sky-reign',{seed,minutes:10,footer:FOOTER}),report=analyzeSoak(samples),p=game.sandbox.__skyReignProbe(),
    show=p.show,offered=show.offeredByTier,shown=show.shownByTier,s3=shown[3]||0,kinds=game.sandbox.__srWingKinds(),continuity=game.sandbox.__srContinuity;
  console.log(`  ${seed.toString(16)} ${soakLine(report)}; kills ${p.stats.kills}, volleys ${p.stats.volleys}, `+
    `wipes ${p.stats.volleyWipes}, tiers ${JSON.stringify(shown)}, pack ${JSON.stringify(kinds)}`);
  assertSoak(seed.toString(16),report,{still:1,quiet:5,stall:5,minEvents:SOAK_MIN_EVENTS,minProgress:SOAK_MIN_PROGRESS},fail);
  inBands(p,SOAK_BANDS,`seed ${seed.toString(16)} soak`);
  if(!p.finite)fail(`seed ${seed.toString(16)}: non-finite state`);
  if(continuity.max>CONTINUITY_CAP)fail(`seed ${seed.toString(16)}: unaccounted ${continuity.max.toFixed(2)}px one-step discontinuity`);
  for(const kind of['vyr','manta','wasp','spire'])if(!kinds[kind])fail(`seed ${seed.toString(16)}: ${kind} never joined the pack`);
  notePairs(p,'sandstorm',`seed ${seed.toString(16)}`,2);notePairs(p,'wyrm',`seed ${seed.toString(16)}`,2);
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
  const run=runMotion('sky-reign',{seed,minutes}),pace=paceOf(run);
  const riderReport=analyzeMotion({step:run.step,samples:run.samples.map(s=>Object.assign({},s,{actors:s.actors.filter(a=>a.id==='dragon')}))},{});
  const packReport=analyzeMotion(run,{emoteFrames:160,emoteShare:.30,requiredIds:['dragon']});
  console.log(`  ${seed.toString(16)} (${minutes}m) dragon[${motionLine(riderReport)}] pack[${motionLine(packReport)}] · dragon ${pace.rider.toFixed(3)} px/f · pack mean ${pace.packMean.toFixed(3)} px/f over ${pace.packCount} wings`);
  assertMotion(seed.toString(16)+' dragon',riderReport,fail);
  assertMotion(seed.toString(16)+' pack',packReport,fail);
  if(run.samples.some(s=>!s.actors.some(a=>a.id==='dragon')))fail(`${seed.toString(16)}: motion probe lost the dragon`);
  if(pace.rider<RIDER_PACE_FLOOR)fail(`${seed.toString(16)}: dragon pace ${pace.rider.toFixed(3)} px/f under floor ${RIDER_PACE_FLOOR}`);
  if(pace.packMean<PACK_PACE_FLOOR)fail(`${seed.toString(16)}: pack pace ${pace.packMean.toFixed(3)} px/f under floor ${PACK_PACE_FLOOR}`);
}
console.log('6c) __NO_EMOTE ablation re-proves the motion fix and stays sim-honest');
{
  const uncovered=analyzeMotion(runMotion('sky-reign',{seed:0x613d,minutes:3,footer:'globalThis.__NO_EMOTE=1;'}),{});
  console.log(`  __NO_EMOTE violations ${uncovered.violations.length}`);
  if(!uncovered.violations.some(v=>/wing.*no emote/.test(v)))fail('__NO_EMOTE ablation: motion gate no longer requires authored emote coverage');
  const a=bootGame('sky-reign',{seed:0x613d}),b=bootGame('sky-reign',{seed:0x613d});
  b.sandbox.__NO_EMOTE=1;a.frames(18000,false);b.frames(18000,false);
  if(a.sandbox.__skyReignSignature()!==b.sandbox.__skyReignSignature())
    fail('__NO_EMOTE changed simulation state (emotes must be render/probe-only)');
}

console.log('6d) contact contract: overlaps resolve in frames, the pack weaves the corridor');
{
  const game=bootGame('sky-reign',{seed:0x5292,footer:FOOTER});
  const staged=game.sandbox.__srContactFixture();
  const before=game.sandbox.__srHardOverlapNow();
  game.frames(60,false);
  const after=game.sandbox.__srHardOverlapNow(),probe=game.sandbox.__skyReignProbe();
  console.log(`  staged hard overlap ${before} -> ${after} after 60f (contacts ${probe.stats.contacts})`);
  if(before<2)fail(`contact fixture did not stage overlapping bodies: ${JSON.stringify(staged)}`);
  if(after!==0)fail(`hard overlap survived the resolver: ${after} pairs after 60f`);
  for(const seed of[0x5293,0x5294]){
    const run=bootGame('sky-reign',{seed,footer:FOOTER});run.frames(7200,false);
    const p=run.sandbox.__skyReignProbe(),o=run.sandbox.__srOverlap;
    console.log(`  ${seed.toString(16)}: worst overlap ${o.worst} pairs, longest ${o.maxRun}f; bumps ${p.stats.contacts}`);
    if(o.worst>2)fail(`${seed.toString(16)}: ${o.worst} bodies hard-overlapped at once`);
    if(o.maxRun>8)fail(`${seed.toString(16)}: hard overlap persisted ${o.maxRun} frames (limit 8)`);
    if(p.stats.contacts<3)fail(`${seed.toString(16)}: pack stopped making contact (${p.stats.contacts} bumps)`);
  }
}

{
  const game=bootGame('sky-reign',{seed:0x5290,footer:FOOTER}),fixture=game.sandbox.__skyReignAdmireFixture();
  if(fixture.admired.tactic!=='RIDE THE WIND'||fixture.gated.tactic==='RIDE THE WIND')
    fail(`__NO_ADMIRE did not gate the bot-only coast: ${JSON.stringify(fixture)}`);
  const perfect=bootGame('sky-reign',{seed:0x5291,footer:FOOTER});perfect.sandbox.__NO_LAPSE=1;perfect.frames(18000,false);
  if(perfect.sandbox.__skyReignProbe().stats.lapses!==0)fail('__NO_LAPSE did not eliminate skill-profile lapse onsets');
}

console.log('7) payoff FX is a perfect same-seed simulation no-op');
{
  const a=bootGame('sky-reign',{seed:0x5300,footer:FOOTER}),b=bootGame('sky-reign',{seed:0x5300,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);
  const same=a.sandbox.__skyReignSignature()===b.sandbox.__skyReignSignature(),p=a.sandbox.__skyReignProbe();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} through ${p.stats.events} events / ${p.stats.kills} kills`);
  if(!same)fail('__NO_PAYOFF_FX changed simulation state');
  if(p.stats.kills<1)fail('FX no-op window did not exercise a volley payoff');
}

console.log('8) drawn bank is honest: the dragon tracks travel, never crabs');
{
  const fixture=bootGame('sky-reign',{seed:0x6001,footer:FOOTER}).sandbox.__srPoseFixture();
  console.log(`  steadyRight bank ${fixture.steadyRight.bank.toFixed(3)} (vx ${fixture.steadyRight.vx.toFixed(3)}); `+
    `straighten bank ${fixture.straighten.bank.toFixed(4)}; steadyLeft bank ${fixture.steadyLeft.bank.toFixed(3)}`);
  if(!(fixture.steadyRight.vx>.2&&fixture.steadyRight.bank>.08))
    fail(`steady right steer must bank the dragon INTO the travel direction: ${JSON.stringify(fixture.steadyRight)}`);
  if(!(Math.abs(fixture.straighten.bank)<.02&&Math.abs(fixture.straighten.vx)<.05))
    fail(`released steering must straighten the dragon: ${JSON.stringify(fixture.straighten)}`);
  if(!(fixture.steadyLeft.vx<-.2&&fixture.steadyLeft.bank<-.08))
    fail(`steady left steer must bank the dragon INTO the travel direction: ${JSON.stringify(fixture.steadyLeft)}`);
  for(const seed of[0x6100,0x613d]){
    const game=bootGame('sky-reign',{seed,footer:FOOTER});game.frames(10800,false);
    const p=game.sandbox.__srPose;
    console.log(`  ${seed.toString(16)}: ${p.frames}f flying · wrong-way runs max ${p.wrongWayMax} (viol ${p.wrongWayViolations}) · crab viol ${p.crabViolations}`);
    if(p.frames<5000)fail(`${seed.toString(16)}: pose telemetry lost the dragon (${p.frames} frames)`);
    if(p.wrongWayViolations>0)fail(`${seed.toString(16)}: dragon banked AWAY from travel for >8 consecutive frames x${p.wrongWayViolations}`);
    if(p.crabViolations>0)fail(`${seed.toString(16)}: phantom crab while cruising straight x${p.crabViolations}`);
  }
}

console.log('9) feedback legibility: every good/bad sim event is visibly represented on screen');
{
  const config={frames:10800,poll:5,radius:26,perCategory:3,
    goodPalette:['#ffd166','#ffb02e','#67e8a2','#59d8f5','#fff3da'],badPalette:['#ff5d4f','#c92c3c','#ffffff'],
    signatureProbe:'__skyReignSignature'};
  const runs=[runFeedbackVisibility('sky-reign',Object.assign({seed:0x5300},config)),
    runFeedbackVisibility('sky-reign',Object.assign({seed:0x536e},config))];
  for(const run of runs){
    const byKey={};for(const s of run.samples)byKey[s.key]=(byKey[s.key]||[]).concat(
      [`${s.changed}px sig${s.kind==='good'?s.goodPixels:s.badPixels}`]);
    console.log(`  ${run.seed.toString(16)}: ${Object.entries(run.counts).map(([k,v])=>`${k} x${v}`).join(', ')}`);
    console.log(`    samples: ${Object.entries(byKey).map(([k,v])=>`${k}[${v.join(' ')}]`).join(' ')}`);
  }
  console.log(`  ${feedbackLine(runs)}; signatures ${runs.every(r=>r.signaturesMatch)?'identical':'DIFFERENT'}`);
  assertFeedback('feedback',runs,{
    required:['good:lock','good:volley-kill','good:dodge','good:boss-break','good:wyrm-hit','good:ascend',
      'bad:hit-taken','bad:shield-down','bad:wyrm-wound'],
    minChanged:{default:12,'good:lock':6,'good:dodge':6,'good:lance-hit':6,'good:wyrm-hit':6,'bad:wyrm-wound':6},
    minSignature:{default:8,'good:lock':4,'good:dodge':4,'good:lance-hit':4,'good:wyrm-hit':4,'bad:wyrm-wound':4},
    maxInvisible:0
  },fail);
}

console.log(failed?'\nSKY REIGN EVAL FAILED':'\nSKY REIGN EVAL PASSED');
process.exit(failed?1:0);
