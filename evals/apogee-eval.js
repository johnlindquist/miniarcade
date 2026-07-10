#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
const MISSION_FRAMES=15*60*60,IGNITE_AT=13*60*60+20*60;
const ARC_SEEDS=Array.from({length:20},(_,i)=>0xad00+i);

const FOOTER=`
const __aq=n=>Math.round(n*1e6);
const __abody=b=>b&&[b.id,b.kind,__aq(b.x),__aq(b.y),__aq(b.vx),__aq(b.vy),!!b.dead,!!b.captured,
  b.surfaceT||0,b.recoverCd||0,b.targetCd||0,b.replanT||0,b.bounces||0,__aq(b.depotLift||0)];
const __aphys=b=>b&&[b.id,b.kind,__aq(b.x),__aq(b.y),__aq(b.vx),__aq(b.vy)];
globalThis.__apoSig=()=>JSON.stringify({frame,showFrame,missionFrame,state,segments,segmentParts,buildParts,partsSpent,reserveParts,ringLevel,ignited,targetSince,
  dock:__aq(dockAngle),targetId,act:[act.kind,act.phase,act.warnAt,act.landAt,act.endAt,__aq(act.angle)],
  tug:[...__abody(tug),__aq(tug.fuel),__aq(tug.heat),tug.crashT,tug.active,tug.intent&&tug.intent.tactic],
  cargo:__abody(cargo),salvage:salvage.map(__abody),fragments:fragments.map(__abody),debris:debris.map(__abody),
  stats:{...stats},life:{...lifetime}});
globalThis.__apoMotionSig=()=>JSON.stringify({
  tug:[__aq(tug.x),__aq(tug.y),__aq(tug.vx),__aq(tug.vy),__aq(tug.angle)],cargo:__aphys(cargo),
  salvage:salvage.map(__aphys),debris:debris.map(__aphys)});
globalThis.__apoManual=()=>({playing:playing(),tug:{x:tug.x,y:tug.y,vx:tug.vx,vy:tug.vy,angle:tug.angle,
  fuel:tug.fuel,heat:tug.heat,intent:{...tug.intent}},cargo:cargo&&{...cargo},captures:stats.captures,docks:stats.docks,finite:finiteBody(tug)});
globalThis.__apoManualTarget=()=>{
  const s={id:nextId++,kind:'salvage',x:tug.x+7,y:tug.y,vx:tug.vx,vy:tug.vy,mass:.52,dead:false,
    spin:0,shape:0,value:2,age:0,targeted:true,captured:false};salvage=[s];targetId=s.id;return s.id;
};
globalThis.__apoOrbitFixture=()=>{
  const r=72,a=bodyAt(r,0,true,9001,'fixture'),e0=orbitalEnergy(a);let min=r,max=r;
  for(let i=0;i<7200;i++){integrateBody(a);const q=radius(a);min=Math.min(min,q);max=Math.max(max,q);}
  const base=bodyAt(r,0,true,9002,'fixture'),pro={...base},retro={...base};
  integrateBody(pro,0,.012);integrateBody(retro,0,-.012);
  return{min,max,drift:max-min,e0,e1:orbitalEnergy(a),pro:orbitalEnergy(pro),retro:orbitalEnergy(retro),finite:finiteBody(a)};
};
globalThis.__apoPropagationFixture=()=>{
  const source={x:CX+68,y:CY-9,vx:.028,vy:.126},angle=.71,burn=23,power=.00131,steps=240,
    planned=propagateBody(source,240,.71,23,.00131),runtime={...source};
  for(let i=0;i<240;i++)integrateBody(runtime,i<23?Math.cos(.71)*.00131:0,i<23?Math.sin(.71)*.00131:0);
  const err=Math.hypot(planned.x-runtime.x,planned.y-runtime.y,planned.vx-runtime.vx,planned.vy-runtime.vy);
  return{planned,runtime,err};
};
globalThis.__apoCallPlanner=()=>{const t=pickTarget();return phasePlan(tug,t,'capture');};
globalThis.__apoNextRandom=()=>random();
globalThis.__apoMechanicsFixture=()=>{
  resetMission();salvage=[];fragments=[];debris=[];cargo=null;segments=0;segmentParts=0;buildParts=0;partsSpent=0;reserveParts=0;missionFrame=50000;
  const builtWithoutParts=advanceConstruction();
  const far={id:9100,kind:'salvage',x:tug.x+tractorRadius()+1,y:tug.y,vx:tug.vx,vy:tug.vy,mass:.52,dead:false,captured:false},
    fast={id:9101,kind:'salvage',x:tug.x+5,y:tug.y,vx:tug.vx+.5,vy:tug.vy,mass:.52,dead:false,captured:false};
  const farReject=!captureCargo(far),fastReject=!captureCargo(fast);
  const dockOne=kind=>{
    const s={id:nextId++,kind:kind||'salvage',x:tug.x+6,y:tug.y,vx:tug.vx,vy:tug.vy,mass:kind==='fragment'?.18:.52,
      dead:false,captured:false,spin:0,shape:0,value:1,age:0,targeted:false};salvage.push(s);
    const captured=captureCargo(s),d=nearestDock(cargo);Object.assign(cargo,{x:d.x,y:d.y,vx:d.vx,vy:d.vy});
    const high={vx:cargo.vx,vy:cargo.vy};cargo.vx+=.5;const highReject=!dockCargo();Object.assign(cargo,high);
    const docked=dockCargo();return{captured,highReject,docked};
  };
  tug.fuel=25;const one=dockOne('salvage'),fuelAfterOne=tug.fuel,frag=dockOne('fragment'),three=dockOne('salvage');
  const raw={id:9200,kind:'salvage',x:CX+70,y:CY,vx:0,vy:circularSpeed(70),mass:.52,dead:false,captured:false,
    spin:0,shape:1,value:2,age:0,targeted:false};salvage=[raw];const broke=fragmentCargo(raw,'FIXTURE'),pieces=salvage.filter(s=>s.kind==='fragment'&&!s.dead).length;
  tug.fuel=8;const d=nearestDock(tug);Object.assign(tug,{x:d.x,y:d.y,vx:d.vx,vy:d.vy});const serviced=serviceDock(),fuelAfterService=tug.fuel;
  return{farReject,fastReject,one,frag,three,fuelAfterOne,serviced,fuelAfterService,pieces,broke,
    captures:stats.captures,docks:stats.docks,fragmentRecoveries:stats.fragmentRecoveries,segments,segmentParts,buildParts,partsSpent,builtWithoutParts,
    fuelRecovered:stats.fuelRecovered,finite:[tug,...salvage].every(finiteBody)};
};
globalThis.__apoFragmentRecoveryFixture=()=>{
  resetMission();salvage=[];fragments=[];cargo=null;
  const a=-.8,r=PLANET_R+1.7,nx=Math.cos(a),ny=Math.sin(a),s={id:9300,kind:'fragment',x:CX+nx*r,y:CY+ny*r,
    vx:-nx*.01,vy:-ny*.01,mass:.18,dead:false,captured:false,spin:.02,shape:1,value:1,age:0,targeted:false};
  salvage=[s];fragments=[s];for(let i=0;i<260;i++)updateBodies();
  return{landings:stats.depotLandings,launches:stats.depotLaunches,bounces:stats.fragmentBounces,
    invisibleResets:stats.invisibleResets,invisibleVelocityResets:stats.invisibleVelocityResets,
    maxStep:stats.maxFragmentStep,maxCorrection:stats.maxFragmentCorrection,maxSilentDv:stats.maxSilentFragmentDv,
    x:s.x,y:s.y,vx:s.vx,vy:s.vy,surfaceT:s.surfaceT||0,recoverable:salvage.includes(s)&&!s.dead,finite:finiteBody(s)};
};
globalThis.__apoUpgradeFixture=()=>{
  resetMission();salvage=[];cargo=null;const levels=[];for(let level=0;level<=3;level++){ringLevel=level;segments=Math.min(12,level*4);levels.push({...upgradeState()});}
  ringLevel=0;const base=bodyAt(62,-Math.PI/2,true,9400,'tug');Object.assign(base,{angle:0,fuel:100,heat:0,mass:1.5});
  const baseTurn={...base},crownTurn={...base};stepTugNumeric(baseTurn,{turn:1,thrust:0},0);stepTugNumeric(crownTurn,{turn:1,thrust:0},3);
  const baseShip={...base,x:80,y:125,vx:.13,vy:0},baseLoad={x:98,y:125,vx:.13,vy:0,mass:.52},
    strongShip={...baseShip},strongLoad={...baseLoad};stepTetherNumeric(baseShip,baseLoad,0);stepTetherNumeric(strongShip,strongLoad,2);
  Object.assign(tug,base);const reach={id:9401,kind:'salvage',x:tug.x+15,y:tug.y,vx:tug.vx,vy:tug.vy,mass:.52,dead:false,captured:false};
  ringLevel=0;const baseReach=captureCargo(reach);cargo=null;reach.captured=false;ringLevel=2;const upgradedReach=captureCargo(reach);cargo=null;
  return{levels,turn0:baseTurn.angle,turn3:crownTurn.angle,baseReach,upgradedReach,
    tether0:Math.hypot(baseLoad.vx-.13,baseLoad.vy),tether2:Math.hypot(strongLoad.vx-.13,strongLoad.vy),
    parts:STAGES.map(s=>s.parts),radii:STAGES.map(s=>s.radius)};
};
globalThis.__apoOverlayFixture=mode=>{
  resetMission();globalThis.__NO_ACTS=1;missionFrame=1000;segments=8;segmentParts=0;ringLevel=2;salvage=[];fragments=[];debris=[];cargo=null;targetId=0;targetSince=0;plan=null;lapseActive=false;
  if(mode==='capture'){
    const s=bodyAt(86,-.35,true,9500,'salvage');Object.assign(s,{spin:0,shape:0,value:2,age:0,targeted:true,captured:false});salvage=[s];targetId=s.id;
  }else if(mode==='dock'){
    const s={id:9501,kind:'salvage',x:tug.x-9,y:tug.y,vx:tug.vx,vy:tug.vy,mass:.52,dead:false,captured:true,
      spin:0,shape:0,value:2,age:0,targeted:false};salvage=[s];cargo=s;tractorLatched=true;
  }else tug.replanT=300;
  rawBotIntent();const predicted=predictTrajectory(30),actual=[];
  for(let i=0;i<predicted.length;i++){
    missionFrame++;const sr=stageSpec().radius;dockAngle=angleWrap(dockAngle+Math.sqrt(MU/(sr*sr*sr)));
    const intent=rawBotIntent();applyIntent(intent);updateTether();updateBodies();actual.push({x:tug.x,y:tug.y,vx:tug.vx,vy:tug.vy,angle:tug.angle,
      cargo:cargo&&{x:cargo.x,y:cargo.y,vx:cargo.vx,vy:cargo.vy}});
  }
  let maxTug=0,maxCargo=0;for(let i=0;i<actual.length;i++){const p=predicted[i],a=actual[i];
    maxTug=Math.max(maxTug,Math.hypot(p.x-a.x,p.y-a.y,p.vx-a.vx,p.vy-a.vy,angleWrap(p.angle-a.angle)));
    if(p.cargo&&a.cargo)maxCargo=Math.max(maxCargo,Math.hypot(p.cargo.x-a.cargo.x,p.cargo.y-a.cargo.y,p.cargo.vx-a.cargo.vx,p.cargo.vy-a.cargo.vy));}
  delete globalThis.__NO_ACTS;return{mode,samples:actual.length,maxTug,maxCargo,predicted,actual};
};
globalThis.__apoForceCrash=()=>crashTug('FIXTURE CRASH');
globalThis.__apoRecovery=()=>({active:tug.active,crashT:tug.crashT,relaunches:stats.relaunches,crashes:stats.crashes,
  wrecks:fragments.filter(f=>f.kind==='wreck').length,x:tug.x,y:tug.y,finite:finiteBody(tug)});
globalThis.__apoAct=()=>({frame:missionFrame,kind:act.kind,phase:act.phase,x:tug.x,y:tug.y,r:radius(tug),
  tactic:tug.intent&&tug.intent.tactic});
globalThis.__apoJumpAct=kind=>{resetMission();missionFrame=kind==='flare'?7199:14999;
  act={kind:'none',phase:'calm',warnAt:0,landAt:0,endAt:0,angle:0,index:0};plan=null;targetId=0;return missionFrame;};
globalThis.__apoShow=()=>SHOW.probe();
globalThis.__apoSoakRotationFixture=()=>{const before=__soakProbe().sig,old=dockAngle;dockAngle+=1.234;const after=__soakProbe().sig;dockAngle=old;return{before,after};};
globalThis.__apoNotes=[];
{const __an0=SHOW.note;SHOW.note=e=>{globalThis.__apoNotes.push({kind:e.kind,id:e.id,tag:e.tag,landsAt:e.landsAt});return __an0(e);};}
globalThis.__apoAdmire={commands:0,current:0,maxRun:0,exits:0,first:-1,last:-1};
{const __ai0=applyIntent;applyIntent=intent=>{const admired=!!(intent&&intent.tactic==='ADMIRE'),a=globalThis.__apoAdmire;
  if(admired){a.commands++;a.current++;a.maxRun=Math.max(a.maxRun,a.current);if(a.first<0)a.first=missionFrame;a.last=missionFrame;}
  else if(a.current){a.exits++;a.current=0;}return __ai0(intent);};}
`;

let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const median=values=>{const a=values.slice().sort((x,y)=>x-y),m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2;};
const percentile=(values,q)=>{const a=values.slice().sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor((a.length-1)*q))];};

console.log('1) orbital mechanics: circular stability and honest prograde/retrograde energy response');
let game=bootGame('apogee',{seed:0xa001,footer:FOOTER});
const orbit=game.sandbox.__apoOrbitFixture();
console.log(`  120s circular orbit radius ${orbit.min.toFixed(4)}..${orbit.max.toFixed(4)}; energy ${orbit.retro.toFixed(6)} < ${orbit.e0.toFixed(6)} < ${orbit.pro.toFixed(6)}`);
if(!orbit.finite||orbit.drift>.2||Math.abs(orbit.e1-orbit.e0)>1e-7)fail(`circular orbit drifted: ${JSON.stringify(orbit)}`);
if(!(orbit.retro<orbit.e0&&orbit.pro>orbit.e0))fail(`burn direction did not change orbital energy honestly: ${JSON.stringify(orbit)}`);

console.log('2) planner/runtime parity: copied state uses the exact fixed-step integrator and no RNG');
const propagation=game.sandbox.__apoPropagationFixture();
const control=bootGame('apogee',{seed:0xa002,footer:FOOTER}),planned=bootGame('apogee',{seed:0xa002,footer:FOOTER});
planned.sandbox.__apoCallPlanner();const rngAfterPlan=planned.sandbox.__apoNextRandom(),rngControl=control.sandbox.__apoNextRandom();
console.log(`  propagation error ${propagation.err}; next RNG ${rngAfterPlan.toFixed(8)} / ${rngControl.toFixed(8)}`);
if(propagation.err!==0)fail(`planner propagation diverged from runtime by ${propagation.err}`);
if(rngAfterPlan!==rngControl)fail('phase planner consumed engine RNG for simulation-invisible work');
for(const mode of['capture','dock','recovery']){
  const g=bootGame('apogee',{seed:0xa020+(mode==='dock'?1:mode==='recovery'?2:0),footer:FOOTER}),path=g.sandbox.__apoOverlayFixture(mode);
  console.log(`  ${mode} overlay/runtime: ${path.samples} executed samples, tug error ${path.maxTug}, cargo error ${path.maxCargo}`);
  if(path.samples!==30||path.maxTug>1e-10||path.maxCargo>1e-10)
    fail(`${mode} overlay does not execute the displayed guidance/tether path: ${JSON.stringify({samples:path.samples,maxTug:path.maxTug,maxCargo:path.maxCargo})}`);
}
if(game.sandbox.__apogeeProbe().overlayWidth<2)fail('predicted orbit overlay is too thin at native 160px scale');

console.log('3) capture, dock-relative velocity, honest parts, fragment recovery, and real refuel');
game=bootGame('apogee',{seed:0xa003,footer:FOOTER});const mechanics=game.sandbox.__apoMechanicsFixture();
console.log(`  ${mechanics.captures} captures -> ${mechanics.docks} docks -> segment ${mechanics.segments}+${mechanics.segmentParts}; `+
  `${mechanics.pieces} persistent fragments; fuel ${mechanics.fuelAfterOne.toFixed(1)} then service ${mechanics.fuelAfterService.toFixed(1)}`);
if(!mechanics.farReject||!mechanics.fastReject)fail(`tractor accepted out-of-contract cargo: ${JSON.stringify(mechanics)}`);
for(const [name,result] of Object.entries({one:mechanics.one,frag:mechanics.frag,three:mechanics.three}))
  if(!result.captured||!result.highReject||!result.docked)fail(`${name} capture/dock fixture failed: ${JSON.stringify(result)}`);
if(mechanics.captures!==3||mechanics.docks!==3||mechanics.fragmentRecoveries!==1||mechanics.segments!==3||mechanics.segmentParts!==0||
  mechanics.buildParts!==3||mechanics.partsSpent!==3||mechanics.builtWithoutParts!==0)
  fail(`construction accounting regressed: ${JSON.stringify(mechanics)}`);
if(mechanics.fuelAfterOne<=25||!mechanics.serviced||mechanics.fuelAfterService<=8||mechanics.fuelRecovered<=0)
  fail(`fuel recovery was not tied to a real cargo/service dock: ${JSON.stringify(mechanics)}`);
if(!mechanics.broke||mechanics.pieces!==3||!mechanics.finite)fail(`fragment recovery contract failed: ${JSON.stringify(mechanics)}`);

const physicalRecovery=game.sandbox.__apoFragmentRecoveryFixture(),upgrades=game.sandbox.__apoUpgradeFixture();
console.log(`  depot recovery: ${physicalRecovery.landings} landing/${physicalRecovery.launches} launch, max step ${physicalRecovery.maxStep.toFixed(3)}px, correction ${physicalRecovery.maxCorrection.toFixed(3)}px; `+
  `upgrades ${upgrades.levels.map(x=>x.stage).join(' -> ')}, costs ${upgrades.parts.join('/')}`);
if(physicalRecovery.landings<1||physicalRecovery.launches<1||physicalRecovery.invisibleResets!==0||physicalRecovery.invisibleVelocityResets!==0||
  physicalRecovery.maxStep>1||physicalRecovery.maxCorrection>.25||physicalRecovery.maxSilentDv>.02||!physicalRecovery.recoverable||!physicalRecovery.finite)
  fail(`fragment recovery used an invisible or unbounded state reset: ${JSON.stringify(physicalRecovery)}`);
if(upgrades.parts.join(',')!=='1,2,2'||upgrades.radii.join(',')!=='44,51,59'||
  upgrades.levels[0].fuelCap!==100||upgrades.levels[1].fuelCap!==125||
  upgrades.levels[1].tractor||!upgrades.levels[2].tractor||!upgrades.levels[3].shield||!upgrades.levels[3].authority||
  !upgrades.upgradedReach||upgrades.baseReach||upgrades.turn3<=upgrades.turn0||upgrades.tether2<=upgrades.tether0)
  fail(`relay/habitat/crown upgrades do not change mechanics: ${JSON.stringify(upgrades)}`);

console.log('4) visible crash recovery: wreck persists and gantry relaunch waits exactly 180 frames');
game=bootGame('apogee',{seed:0xa004,footer:FOOTER});game.sandbox.__apoForceCrash();
const fallen=game.sandbox.__apoRecovery();game.frames(179,false);const waiting=game.sandbox.__apoRecovery();game.frames(1,false);const relaunched=game.sandbox.__apoRecovery();
console.log(`  wrecks ${fallen.wrecks}; countdown ${fallen.crashT}->${waiting.crashT}; relaunches ${relaunched.relaunches}`);
if(fallen.active||fallen.crashT!==180||fallen.wrecks<1||waiting.active||waiting.crashT!==1)
  fail(`crash countdown/recoverable wreck regressed: ${JSON.stringify({fallen,waiting})}`);
if(!relaunched.active||relaunched.crashT!==0||relaunched.relaunches!==1||!relaunched.finite)
  fail(`gantry did not relaunch visibly on frame 180: ${JSON.stringify(relaunched)}`);

console.log('5) five-minute watchability bands: active salvage, paced construction, honest mistakes');
for(const seed of[1,2,3]){
  game=bootGame('apogee',{seed,footer:FOOTER});game.frames(18000,false);const p=game.sandbox.__apogeeProbe(),s=p.stats;
  console.log(`  seed ${seed}: ${s.captures} captures, ${s.docks} docks, ${p.segments}+${p.segmentParts} staged parts, `+
    `${s.collisions} collisions + ${s.skims} shield skims, ${s.crashes} crashes, ${s.fragmentRecoveries} recycled, `+
    `lulls ${(s.maxEventLull/60).toFixed(1)}s/${(s.maxProgressLull/60).toFixed(1)}s`);
  if(!p.finite)fail(`seed ${seed}: non-finite orbit/cargo state`);
  if(s.captures<12||s.captures>30)fail(`seed ${seed}: captures ${s.captures} outside measured 12..30`);
  if(s.docks<9||s.docks>24)fail(`seed ${seed}: docks ${s.docks} outside measured 9..24`);
  if(s.collisions<1||s.collisions>14)fail(`seed ${seed}: collisions ${s.collisions} outside drama band 1..14`);
  if(s.crashes>5)fail(`seed ${seed}: ${s.crashes} tug crashes exceed 5`);
  if(s.fragmentRecoveries<1)fail(`seed ${seed}: persistent fragments were never recovered`);
  if(p.segments<6||p.segments>7||p.ringLevel!==1||!p.upgrades.tanks||p.upgrades.tractor)
    fail(`seed ${seed}: five-minute relay/habitat construction is unpaced: ${JSON.stringify({segments:p.segments,parts:p.segmentParts,upgrades:p.upgrades})}`);
  if(s.lapses<4||s.lapses>14)fail(`seed ${seed}: bounded persona cutoffs ${s.lapses} outside 4..14`);
  if(s.maxEventLull>720||s.maxProgressLull>3600)fail(`seed ${seed}: watchability lull exceeded 12s/60s`);
  if(s.minFuel<=0||s.maxHeat>=100)fail(`seed ${seed}: bot exhausted fuel or saturated heat (${s.minFuel}/${s.maxHeat})`);
  if(s.invisibleResets!==0||s.invisibleVelocityResets!==0||s.maxFragmentStep>1||s.maxFragmentCorrection>.25||s.maxSilentFragmentDv>.02||s.depotLaunches>s.depotLandings)
    fail(`seed ${seed}: fragment recovery violated bounded visible motion: ${JSON.stringify({invisible:s.invisibleResets,invisibleVelocity:s.invisibleVelocityResets,maxStep:s.maxFragmentStep,maxCorrection:s.maxFragmentCorrection,maxSilentDv:s.maxSilentFragmentDv,land:s.depotLandings,launch:s.depotLaunches})}`);
}

console.log('6) phase-plan A/B: 10 identical seeds against current-position chase');
{
  const smart=[],chase=[];let wins=0,smartCollisions=0;
  for(let i=0;i<10;i++){
    const seed=0xa901+i,a=bootGame('apogee',{seed}),b=bootGame('apogee',{seed});
    b.sandbox.__NO_PHASE_PLAN=1;a.frames(18000,false);b.frames(18000,false);
    const sa=a.sandbox.__apogeeProbe().stats,sb=b.sandbox.__apogeeProbe().stats;
    smart.push(sa);chase.push(sb);if(sa.docks>sb.docks)wins++;smartCollisions+=sa.collisions;
    console.log(`  ${seed.toString(16)}: phase ${sa.docks} docks/${sa.firstCapture}f first vs chase ${sb.docks}/${sb.firstCapture}f`);
  }
  const smartMed=median(smart.map(s=>s.docks)),chaseMed=median(chase.map(s=>s.docks)),
    smartP95=percentile(smart.map(s=>s.firstCapture<0?18001:s.firstCapture),.95),
    chaseP95=percentile(chase.map(s=>s.firstCapture<0?18001:s.firstCapture),.95);
  console.log(`  wins ${wins}/10; median docks ${smartMed} vs ${chaseMed}; p95 first capture ${smartP95}f vs ${chaseP95}f; ${smartCollisions} smart-policy collisions`);
  if(wins<8)fail(`phase planning won only ${wins}/10 same-seed dock races`);
  if(smartMed<chaseMed*1.25)fail(`phase planning improved median docks <25% (${smartMed} vs ${chaseMed})`);
  if(smartP95>chaseP95*.8)fail(`phase planning improved p95 first-capture time <20% (${smartP95} vs ${chaseP95})`);
  if(smartCollisions<5)fail(`phase planner erased honest collision drama (${smartCollisions} across 10 runs)`);
}

console.log('6b) sensor-policy A/B: depot handoff and pursuit recovery stay independently re-provable');
{
  const filtered=bootGame('apogee',{seed:0xad00}),legacyFilter=bootGame('apogee',{seed:0xad00});
  filtered.sandbox.__NO_PURSUIT_WATCHDOG=1;legacyFilter.sandbox.__NO_PURSUIT_WATCHDOG=1;
  legacyFilter.sandbox.__NO_DEPOT_TARGET_FILTER=1;filtered.frames(30000,false);legacyFilter.frames(30000,false);
  const fp=filtered.sandbox.__apogeeProbe(),lp=legacyFilter.sandbox.__apogeeProbe(),fs=fp.stats,ls=lp.stats;
  console.log(`  depot filter: max progress lull ${ls.maxProgressLull}->${fs.maxProgressLull}f, docks ${ls.docks}->${fs.docks}, segments ${lp.segments}->${fp.segments}`);
  if(fs.maxProgressLull>2700||fs.maxProgressLull>ls.maxProgressLull*.35||fs.docks<ls.docks+6||fp.segments<lp.segments+1||
    fs.invisibleResets||fs.invisibleVelocityResets)
    fail(`depot target filter did not eliminate the same-seed handed-off-fragment stall: ${JSON.stringify({filtered:{lull:fs.maxProgressLull,docks:fs.docks,segments:fp.segments},ablated:{lull:ls.maxProgressLull,docks:ls.docks,segments:lp.segments}})}`);

  const watched=bootGame('apogee',{seed:0xad0f}),legacyWatch=bootGame('apogee',{seed:0xad0f});legacyWatch.sandbox.__NO_PURSUIT_WATCHDOG=1;
  watched.frames(10000,false);legacyWatch.frames(10000,false);const wp=watched.sandbox.__apogeeProbe(),op=legacyWatch.sandbox.__apogeeProbe(),ws=wp.stats,os=op.stats;
  console.log(`  pursuit watchdog: max progress lull ${os.maxProgressLull}->${ws.maxProgressLull}f, docks ${os.docks}->${ws.docks}, segments ${op.segments}->${wp.segments}; ${ws.targetReplans} replan/${ws.calibrations} calibration`);
  if(ws.maxProgressLull>2400||ws.maxProgressLull>os.maxProgressLull*.45||ws.docks<os.docks+3||wp.segments<op.segments+1||
    ws.targetReplans<1||ws.targetReplans>2||ws.calibrations<1||ws.calibrations>ws.targetReplans||ws.recoveryCommands<300||ws.recoveryCommands>1200)
    fail(`pursuit watchdog did not replace the same-seed outer-orbit stall with a bounded physical calibration: ${JSON.stringify({watched:{lull:ws.maxProgressLull,docks:ws.docks,segments:wp.segments,replans:ws.targetReplans,calibrations:ws.calibrations,recoveryCommands:ws.recoveryCommands},ablated:{lull:os.maxProgressLull,docks:os.docks,segments:op.segments}})}`);
}

console.log('7) acts: exact telegraphs and first physical divergence during each warning');
{
  const expected={flare:'SEEK SHADOW',debris:'DODGE ORBIT'},duration={flare:240,debris:210};
  for(const id of['flare','debris']){
    const a=bootGame('apogee',{seed:0xaa01,footer:FOOTER}),b=bootGame('apogee',{seed:0xaa01,footer:FOOTER});
    a.sandbox.__apoJumpAct(id);b.sandbox.__apoJumpAct(id);b.sandbox.__NO_ACTS=1;
    let first=null;
    for(let f=0;f<=duration[id]+2;f++){
      a.frames(1,false);b.frames(1,false);const state=a.sandbox.__apoAct();
      if(!first&&state.phase==='warn'&&a.sandbox.__apoMotionSig()!==b.sandbox.__apoMotionSig())
        first={frame:state.frame,tactic:state.tactic,control:b.sandbox.__apoAct().tactic};
    }
    const notes=a.sandbox.__apoNotes,warn=notes.find(n=>n.kind==='act-warning'&&n.id===id),
      land=notes.find(n=>n.kind==='act-land'&&n.id===id),actual=warn&&land?land.tag-warn.tag:null;
    console.log(`  ${id}: ${actual}f warning; first physical divergence ${first&&first.frame}f, ${first&&first.tactic} vs ${first&&first.control}`);
    if(actual!==duration[id])fail(`${id} warning duration ${actual}f != ${duration[id]}f`);
    if(!first)fail(`${id} warning did not change act-independent bot/physics state before landing`);
    else if(first.tactic!==expected[id]||first.control===expected[id])fail(`${id} warning tactic was not isolated: ${JSON.stringify(first)}`);
    if(b.sandbox.__apoNotes.length)fail(`__NO_ACTS emitted ${id} notes`);
  }
}

console.log('8) manual takeover: two-Enter gate, rotation, prograde/retro burns, tractor toggle');
game=bootGame('apogee',{seed:0xab01,footer:FOOTER});const initial=game.sandbox.__apoManual();
press(game,'Enter');const instructions=game.sandbox.__apoManual();press(game,'Enter');const started=game.sandbox.__apoManual();
game.key('keydown','ArrowRight');game.frames(12,false);game.key('keyup','ArrowRight');const turned=game.sandbox.__apoManual();
game.key('keydown','ArrowUp');game.frames(45,false);game.key('keyup','ArrowUp');const prograde=game.sandbox.__apoManual();
game.key('keydown','ArrowDown');game.frames(30,false);game.key('keyup','ArrowDown');const retro=game.sandbox.__apoManual();
game.sandbox.__apoManualTarget();press(game,'Space');const latched=game.sandbox.__apoManual();press(game,'Space');const released=game.sandbox.__apoManual();
console.log(`  angle ${started.tug.angle.toFixed(2)} -> ${turned.tug.angle.toFixed(2)}; fuel ${turned.tug.fuel.toFixed(2)} -> ${prograde.tug.fuel.toFixed(2)} -> ${retro.tug.fuel.toFixed(2)}; tractor ${!!latched.cargo}->${!!released.cargo}`);
if(initial.playing||instructions.playing||!started.playing)fail('manual session skipped the two-Enter instructions gate');
if(Math.abs(angleDelta(turned.tug.angle,started.tug.angle))<.35)fail('manual right did not rotate the tug');
if(prograde.tug.fuel>=turned.tug.fuel||retro.tug.fuel>=prograde.tug.fuel)fail('manual prograde/retro burns did not consume fuel');
if(!latched.cargo||released.cargo||!released.finite)fail('Space did not toggle tractor capture/release');

console.log('9) ten-minute soak: moving, happening, and visibly assembling');
{
  const rotation=bootGame('apogee',{seed:0xac00,footer:FOOTER}).sandbox.__apoSoakRotationFixture();
  if(rotation.before!==rotation.after)fail('soak movement signature can be advanced by habitat rotation alone');
  const{samples}=runSoak('apogee',{seed:0xac01,minutes:10});const report=analyzeSoak(samples);
  console.log('  '+soakLine(report));
  assertSoak('apogee soak',report,{still:5,quiet:15,stall:100,minEvents:150,minProgress:35},fail);
}

console.log('10) twenty-seed Max arc: honest staged construction, bounded endings, show/admire, freshness, and FX parity');
{
  const arcs=[];
  for(const seed of ARC_SEEDS){
    const g=bootGame('apogee',{seed,footer:FOOTER});g.frames(18000,false);const five=g.sandbox.__apogeeProbe();
    g.frames(18000,false);const ten=g.sandbox.__apogeeProbe();g.frames(9000,false);const twelve=g.sandbox.__apogeeProbe();
    g.frames(9000,false);const end=g.sandbox.__apogeeProbe(),show=g.sandbox.__apoShow(),admire={...g.sandbox.__apoAdmire},s=end.stats;
    arcs.push({seed,g,five,ten,twelve,end,show,admire});
    console.log(`  ${seed.toString(16)} ${end.persona}: ${five.segments}/${ten.segments}/${twelve.segments} segments, `+
      `${end.partsSpent}/${end.buildParts} parts, ${s.captures} captures/${s.docks} docks/${s.collisions} hits -> ignition ${end.ignited}`);
    if(five.segments<6||five.segments>7||five.ringLevel!==1||five.partsSpent<8||five.partsSpent>10||
      !five.upgrades.tanks||five.upgrades.tractor)
      fail(`seed ${seed.toString(16)}: Relay/Habitat checkpoint unpaced: ${JSON.stringify({segments:five.segments,buildParts:five.buildParts,partsSpent:five.partsSpent,upgrades:five.upgrades})}`);
    if(ten.segments!==10||ten.ringLevel!==2||ten.partsSpent!==16||!ten.upgrades.tanks||!ten.upgrades.tractor||ten.upgrades.shield)
      fail(`seed ${seed.toString(16)}: Habitat/Crown checkpoint unpaced: ${JSON.stringify({segments:ten.segments,buildParts:ten.buildParts,partsSpent:ten.partsSpent,upgrades:ten.upgrades})}`);
    if(twelve.segments!==12||twelve.ringLevel!==3||twelve.partsSpent!==20||twelve.buildParts<20||twelve.ignited||
      !twelve.upgrades.tanks||!twelve.upgrades.tractor||!twelve.upgrades.shield||!twelve.upgrades.authority)
      fail(`seed ${seed.toString(16)}: Crown checkpoint did not consume 20 honest parts before ignition: ${JSON.stringify({segments:twelve.segments,buildParts:twelve.buildParts,partsSpent:twelve.partsSpent,ignited:twelve.ignited,upgrades:twelve.upgrades})}`);
    if(!end.ignited||s.ignitions!==1||end.segments!==12||end.partsSpent!==20||end.buildParts<20||
      end.missionFrame<IGNITE_AT||end.missionFrame>MISSION_FRAMES)
      fail(`seed ${seed.toString(16)}: 15-minute ending missing, forced, or mistimed: ${JSON.stringify({missionFrame:end.missionFrame,ignited:end.ignited,segments:end.segments,buildParts:end.buildParts,partsSpent:end.partsSpent,stats:s})}`);
    if(s.captures<30||s.captures>70||s.docks<25||s.docks>58||s.collisions<5||s.collisions>22||s.crashes>4||
      s.fragmentRecoveries<6||s.fragmentRecoveries>30||s.lapses<18||s.lapses>30)
      fail(`seed ${seed.toString(16)}: ending outside measured watchability bands: ${JSON.stringify({captures:s.captures,docks:s.docks,collisions:s.collisions,crashes:s.crashes,recoveries:s.fragmentRecoveries,lapses:s.lapses})}`);
    // After fixing the handed-off-fragment pursuit, this 20-seed set measures
    // 29..64s between real progress events (formerly 167s). Keep only 5s of
    // margin over the original 60s gate rather than normalizing a bot stall.
    if(s.maxEventLull>720||s.maxProgressLull>3900||s.minFuel<=70||s.maxHeat>=70)
      fail(`seed ${seed.toString(16)}: ending stalled or exhausted resources: ${JSON.stringify({eventLull:s.maxEventLull,progressLull:s.maxProgressLull,minFuel:s.minFuel,maxHeat:s.maxHeat})}`);
    const recoveryShare=s.recoveryCommands/Math.max(1,end.missionFrame);
    if(s.targetReplans<1||s.targetReplans>12||s.calibrations<1||s.calibrations>s.targetReplans||
      s.recoveryCommands>9000||recoveryShare>.17)
      fail(`seed ${seed.toString(16)}: pursuit recovery became absent or rescue spam: ${JSON.stringify({targetReplans:s.targetReplans,calibrations:s.calibrations,recoveryCommands:s.recoveryCommands,recoveryShare})}`);
    if(s.invisibleResets!==0||s.invisibleVelocityResets!==0||s.maxFragmentStep>1||s.maxFragmentCorrection>.25||
      s.maxSilentFragmentDv>.02||s.depotLaunches>s.depotLandings)
      fail(`seed ${seed.toString(16)}: ending used invisible fragment recovery: ${JSON.stringify({invisible:s.invisibleResets,invisibleVelocity:s.invisibleVelocityResets,maxStep:s.maxFragmentStep,maxCorrection:s.maxFragmentCorrection,maxSilentDv:s.maxSilentFragmentDv,land:s.depotLandings,launch:s.depotLaunches})}`);
    const o=show.offeredByTier,shown=show.shownByTier,s3=shown[3]||0;
    if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)===1))fail(`seed ${seed.toString(16)}: offered ladder not strictly ordered: ${JSON.stringify(o)}`);
    if(!((shown[1]||0)>(shown[2]||0)&&(shown[2]||0)>(shown[3]||0)&&(shown[3]||0)===1))fail(`seed ${seed.toString(16)}: shown ladder not strictly ordered: ${JSON.stringify(shown)}`);
    if(show.heldFrames!==6*s3||show.slowedFrames!==24*s3||show.admireFrames!==60*s3)
      fail(`seed ${seed.toString(16)}: apex budget ${show.heldFrames} held/${show.slowedFrames} slow/${show.admireFrames} admire for ${s3} ignition(s)`);
    if(admire.commands!==38*s3||admire.maxRun!==38*s3||admire.current!==0||admire.exits!==s3||s.admireCommands!==38*s3||end.tug.intent.tactic==='ADMIRE')
      fail(`seed ${seed.toString(16)}: executed admire pause was absent, sticky, or outside its exact budget: ${JSON.stringify({admire,stats:s.admireCommands,tactic:end.tug.intent.tactic})}`);
  }
  const personas=new Set(arcs.map(a=>a.end.persona)),outcomes=new Set(arcs.map(a=>{
    const s=a.end.stats;return[a.end.persona,s.captures,s.docks,s.collisions,s.crashes,s.fragmentRecoveries,a.end.reserveParts].join(':');
  }));
  const maxRecoveryShare=Math.max(...arcs.map(a=>a.end.stats.recoveryCommands/Math.max(1,a.end.missionFrame)));
  console.log(`  completed ${arcs.filter(a=>a.end.ignited).length}/${arcs.length}; freshness ${personas.size} personas / ${outcomes.size} distinct outcomes; max recovery share ${(maxRecoveryShare*100).toFixed(1)}%`);
  if(personas.size!==3||outcomes.size<15)fail(`cross-seed freshness collapsed: ${personas.size} personas, ${outcomes.size}/20 distinct outcomes`);

  const canonical=arcs.find(a=>a.seed===0xad01),a=canonical.g,signature=a.sandbox.__apoSig(),
    b=bootGame('apogee',{seed:canonical.seed,footer:FOOTER});b.sandbox.__NO_PAYOFF_FX=1;b.frames(MISSION_FRAMES,false);const replay=b.sandbox.__apogeeProbe();
  if(signature!==b.sandbox.__apoSig())fail('__NO_PAYOFF_FX changed the 15-minute simulation or deterministic ending');
  if(!replay.ignited||replay.stats.ignitions!==1)fail('__NO_PAYOFF_FX replay failed to reach Ring Ignition');
  const admiredAtEnd=a.sandbox.__apoAdmire.commands;a.frames(120,false);const stickyCommands=a.sandbox.__apoAdmire.commands-admiredAtEnd;
  if(stickyCommands!==0||a.sandbox.__apoAdmire.current!==0||a.sandbox.__apogeeProbe().tug.intent.tactic==='ADMIRE')
    fail(`ADMIRE remained sticky after its window (${stickyCommands} later commands)`);
  const noAdmire=bootGame('apogee',{seed:canonical.seed,footer:FOOTER});noAdmire.sandbox.__NO_ADMIRE=1;noAdmire.frames(50000,false);
  const noTrace=noAdmire.sandbox.__apoAdmire,noProbe=noAdmire.sandbox.__apogeeProbe();
  console.log(`  canonical show: held ${canonical.show.heldFrames}, slow ${canonical.show.slowedFrames}, kernel admire ${canonical.show.admireFrames}, executed ${canonical.admire.commands}, sticky ${stickyCommands}, ablated ${noTrace.commands}`);
  if(noTrace.commands!==0||noTrace.current!==0||noProbe.stats.admireCommands!==0||noProbe.tug.intent.tactic==='ADMIRE')
    fail(`__NO_ADMIRE did not gate actual bot pauses: ${JSON.stringify({trace:noTrace,stats:noProbe.stats.admireCommands,tactic:noProbe.tug.intent.tactic})}`);
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);

function angleDelta(a,b){let d=(a-b+Math.PI)%(Math.PI*2);if(d<0)d+=Math.PI*2;return d-Math.PI;}
