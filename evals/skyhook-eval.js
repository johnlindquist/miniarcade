#!/usr/bin/env node
'use strict';
const{bootGame}=require('./harness');

const FOOTER=`
globalThis.__skyEval={releases:[],catches:[],crashes:[],launchAt:[],liftAt:[],launchEndAt:[],launchOutcomes:[],preLaunchSignatures:[]};
{const r0=releaseCargo;releaseCargo=reason=>{const before=stats.releases,out=r0(reason);
  if(stats.releases>before)globalThis.__skyEval.releases.push(showFrame);return out;};
 const c0=completeCatch;completeCatch=perfect=>{globalThis.__skyEval.catches.push({perfect,
   miss:Math.abs(cargo.x-target.x),speed:Math.hypot(cargo.vx,cargo.vy),type:cargo.type});return c0(perfect);};
 const x0=crashCargo;crashCargo=reason=>{const before=stats.crashes,out=x0(reason);
   if(stats.crashes>before)globalThis.__skyEval.crashes.push({at:showFrame,reason});return out;};
 const l0=beginLaunch;beginLaunch=()=>{globalThis.__skyEval.launchAt.push(showFrame);globalThis.__skyEval.preLaunchSignatures.push(signature());
   globalThis.__skyEval.launchOutcomes.push({catches:stats.catches,perfects:stats.perfects,crashes:stats.crashes,
     salvages:stats.salvages,releases:stats.releases,modules:stats.modules,finalEngines:stats.finalEngines});return l0();};
 const z0=resetCraft;resetCraft=full=>{if(state==='launch')globalThis.__skyEval.launchEndAt.push(showFrame);return z0(full);};
 const p0=physicsStep;physicsStep=()=>{const out=p0();if(state==='launch'&&launchT===90&&
   globalThis.__skyEval.liftAt.at(-1)!==showFrame)globalThis.__skyEval.liftAt.push(showFrame);return out;};}
globalThis.__skyMotion=()=>{const c=cargo||{x:0,y:0,vx:0,vy:0};return[
  state,Math.round(T.x*1e5),Math.round(T.vx*1e5),Math.round(T.theta*1e7),Math.round(T.L*1e4),
  Math.round(c.x*1e4),Math.round(c.y*1e4),Math.round(c.vx*1e4),Math.round(c.vy*1e4),
  stats.releases,stats.catches,stats.crashes].join('|');};
globalThis.__skyActState=()=>({runFrame,gust:gust.phase,moor:moor.phase});
globalThis.__skyIsolateAct=kind=>{
  resetCraft(true);runFrame=0;__skyhookSetManualSwing();
  if(kind==='gust')T.omega=-.025;
  Object.assign(gust,{phase:'calm',warnAt:kind==='gust'?60:999999,landAt:kind==='gust'?300:1000239,
    endAt:kind==='gust'?720:1001139,dir:1,count:0});
  Object.assign(moor,{phase:'calm',warnAt:kind==='mooring'?1:999999,landAt:kind==='mooring'?181:1000179,
    endAt:kind==='mooring'?541:1000539,count:0});
  target.baseX=113;target.futureX=113;actNotes.length=0;windAx=0;planAt=-1e9;releasePlan=null;
  return __skyActState();
};
globalThis.__skyAdmireRuntime=gated=>{
  if(gated)globalThis.__NO_ADMIRE=1;else delete globalThis.__NO_ADMIRE;
  SHOW.reset(showFrame);SHOW.offer({id:'fixture-apex',tier:3,at:showFrame});
  let directive=0,admired=0,sticky=0;
  for(let i=0;i<110;i++){showFrame++;pres=SHOW.step(showFrame);const out=botIntent();
    if(pres.admire)directive++;if(out.tactic==='ADMIRE')admired++;if(!pres.admire&&out.tactic==='ADMIRE')sticky++;}
  delete globalThis.__NO_ADMIRE;return{directive,admired,sticky};
};
globalThis.__skyReleaseGaps=()=>{
  const a=globalThis.__skyEval.releases;let max=a.length?a[0]:Infinity;
  for(let i=1;i<a.length;i++)max=Math.max(max,a[i]-a[i-1]);
  if(a.length)max=Math.max(max,showFrame-a.at(-1));return{count:a.length,max};
};
globalThis.__skySetTrolleyVelocity=v=>T.vx=v;
globalThis.__skyTrolleyVelocity=()=>T.vx;
`;

let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const pct=(a,b)=>b?Math.round((a/b-1)*100):Infinity;
const median=values=>{const a=[...values].sort((x,y)=>x-y),m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2;};
let cachedNaturalLaunch=null;

console.log('1) deterministic fixed-step replay: same seed, same complete sim signature');
{
  const a=bootGame('skyhook',{seed:0x5a001,footer:FOOTER});
  const b=bootGame('skyhook',{seed:0x5a001,footer:FOOTER});
  a.frames(7200,false);b.frames(7200,false);
  const pa=a.sandbox.__skyhookProbe(),pb=b.sandbox.__skyhookProbe();
  console.log(`  ${pa.releases} releases, ${pa.catches} catches, ${pa.crashes} crashes; signatures ${a.sandbox.__skyhookSignature()===b.sandbox.__skyhookSignature()?'match':'DIFFER'}`);
  if(a.sandbox.__skyhookSignature()!==b.sandbox.__skyhookSignature())fail('same seed diverged under identical 60Hz headless steps');
  if(!pa.finite||!pb.finite)fail('deterministic replay produced non-finite state');
}

console.log('2) rope mechanics: exact constraint, stable pendulum, mass changes motor/wind response');
{
  const game=bootGame('skyhook',{seed:0x5a002,footer:FOOTER});
  const m=game.sandbox.__skyhookMechanicsFixture();
  console.log(`  rope error ${m.maxErr.toExponential(2)}, peak omega ${m.peak.toFixed(4)}, light/heavy trolley ${m.lightX.toFixed(2)}/${m.heavyX.toFixed(2)}, angles ${m.lightTheta.toFixed(3)}/${m.heavyTheta.toFixed(3)}`);
  if(!m.finite||m.maxErr>1e-9)fail(`rope constraint drifted: ${JSON.stringify(m)}`);
  if(m.peak<.005||m.peak>.04)fail(`pendulum response outside stable physical range: ${m.peak}`);
  if(m.lightX-m.heavyX<2||Math.abs(m.lightTheta-m.heavyTheta)<.01)
    fail(`cargo mass stopped affecting crane/wind response: ${JSON.stringify(m)}`);
}

console.log('3) release forecast: displayed miss predicts the actual runtime catcher crossing');
{
  const game=bootGame('skyhook',{seed:0x5a003,footer:FOOTER});
  const t=game.sandbox.__skyhookReleaseOutcomeFixture();
  console.log(`  plan delay ${t.plan.delay}f; forecast ${t.release.predictedMiss.toFixed(6)}px, `+
    `actual ${t.release.actualMiss.toFixed(6)}px, error ${t.release.error.toExponential(2)}, ${t.release.outcome}`);
  if(!t.finite||!t.release.done||t.release.actualMiss===null||t.release.error>1e-9||t.release.outcome!=='catch')
    fail(`release-time forecast did not survive actual runtime steps: ${JSON.stringify(t)}`);
}

console.log('4) catcher + failure path: tolerant lock, visible crash, parachute salvage');
{
  let game=bootGame('skyhook',{seed:0x5a004,footer:FOOTER});const c=game.sandbox.__skyhookCatchFixture();
  game=bootGame('skyhook',{seed:0x5a005,footer:FOOTER});const r=game.sandbox.__skyhookRecoveryFixture();
  console.log(`  catcher ${c.caught?'locked':'missed'}; salvage impact (${r.impact.x},${r.impact.y}) → `+
    `first (${r.first&&r.first.x},${r.first&&r.first.y}), ${r.steps}f, max step ${r.maxStep.toFixed(3)}px`);
  if(!c.caught||!c.finite)fail(`catcher tolerance fixture failed: ${JSON.stringify(c)}`);
  if(!r.crashed||!r.salvaged||r.state!=='supply'||!r.first||r.first.x!==r.impact.x||r.first.y!==r.impact.y||
    r.maxStep>1.34||!r.finite)
    fail(`crash did not travel through visible salvage recovery: ${JSON.stringify(r)}`);
}

console.log('5) autonomous watchability: 4 x 5 measured minutes, bounded on both sides');
for(let run=0;run<4;run++){
  const seed=0x5a600+run,game=bootGame('skyhook',{seed,footer:FOOTER});game.frames(18000,false);
  const p=game.sandbox.__skyhookProbe(),g=game.sandbox.__skyReleaseGaps(),records=game.sandbox.__skyhookForecasts();
  console.log(`  seed ${seed.toString(16)} ${p.persona}: ${p.catches} catches (${p.perfects} perfect), `+
    `${p.crashes} crashes/${p.salvages} salvage, ${p.releases} releases, ${p.modules} modules, `+
    `${p.lapses} lapses, event ${(p.maxEventLull/60).toFixed(1)}s, progress ${(p.maxProgressLull/60).toFixed(1)}s, release gap ${(g.max/60).toFixed(1)}s`);
  if(!p.finite)fail(`seed ${seed.toString(16)}: non-finite crane/cargo state`);
  if(p.catches<28||p.catches>42)fail(`seed ${seed.toString(16)}: catches ${p.catches} outside measured band 28..42`);
  if(p.releases<34||p.releases>44)fail(`seed ${seed.toString(16)}: releases ${p.releases} outside 34..44`);
  if(p.perfects<6||p.perfects>18)fail(`seed ${seed.toString(16)}: perfect catches ${p.perfects} outside 6..18`);
  if(p.crashes<1||p.crashes>8)fail(`seed ${seed.toString(16)}: honest crashes ${p.crashes} outside 1..8`);
  if(p.salvages>p.crashes||p.salvages+p.lostModules<p.crashes-1)
    fail(`seed ${seed.toString(16)}: ${p.salvages} salvage + ${p.lostModules} shattered do not account for ${p.crashes} crashes`);
  if(p.modules<9||p.modules>14)fail(`seed ${seed.toString(16)}: module progress ${p.modules} outside 9..14`);
  if(p.lapses<1||p.lapses>10)fail(`seed ${seed.toString(16)}: persona lapses ${p.lapses} outside 1..10`);
  if(p.maxEventLull>720||p.maxProgressLull>2100||p.maxSwing>720)
    fail(`seed ${seed.toString(16)}: dead-air contract failed (event ${p.maxEventLull}, progress ${p.maxProgressLull}, swing ${p.maxSwing})`);
  if(g.count<34||g.max>1200)fail(`seed ${seed.toString(16)}: release cadence weak (${g.count}, max ${(g.max/60).toFixed(1)}s)`);
  if(p.maxRecoveryStep>1.34)fail(`seed ${seed.toString(16)}: salvage jumped ${p.maxRecoveryStep.toFixed(3)}px in one frame`);
  if(p.forecasts<25||p.maxForecastError>1e-9||records.filter(r=>r.actualMiss!==null&&r.error>1e-9).length)
    fail(`seed ${seed.toString(16)}: displayed arc stopped predicting runtime miss (${p.forecasts}, ${p.maxForecastError})`);
}

console.log('6) manual controls: two-Enter gate, trolley, winch, magnet, release, brake');
{
  const game=bootGame('skyhook',{seed:0x5a200,footer:FOOTER});
  if(game.sandbox.__skyhookProbe().playing)fail('session began in player mode');
  press(game,'Enter');if(game.sandbox.__skyhookProbe().playing)fail('first Enter skipped instructions');
  press(game,'Enter');if(!game.sandbox.__skyhookProbe().playing)fail('second Enter did not start manual yard');
  let p=game.sandbox.__skyhookProbe(),x0=p.trolley.x,l0=p.trolley.L;
  game.key('keydown','ArrowRight');game.frames(24,false);game.key('keyup','ArrowRight');p=game.sandbox.__skyhookProbe();const right=p.trolley.x;
  game.key('keydown','ArrowUp');game.frames(18,false);game.key('keyup','ArrowUp');p=game.sandbox.__skyhookProbe();const short=p.trolley.L;
  game.sandbox.__skyhookSetManualPickup();press(game,'Space');const latched=game.sandbox.__skyhookProbe();
  game.sandbox.__skyhookSetManualSwing();press(game,'KeyX');const released=game.sandbox.__skyhookProbe();
  game.sandbox.__skyhookSetManualPickup();game.sandbox.__skySetTrolleyVelocity(2);const vb=game.sandbox.__skyTrolleyVelocity();
  game.key('keydown','KeyX');game.frames(1,false);game.key('keyup','KeyX');const va=game.sandbox.__skyTrolleyVelocity();
  console.log(`  trolley ${x0.toFixed(1)}→${right.toFixed(1)}, rope ${l0.toFixed(1)}→${short.toFixed(1)}, `+
    `magnet ${latched.state}, release ${released.state}, brake ${vb.toFixed(2)}→${va.toFixed(2)}`);
  if(right-x0<10)fail('manual Right did not move the trolley materially');
  if(l0-short<12)fail('manual Up did not shorten the winch');
  if(latched.state!=='swing'||!latched.cargo.attached)fail('manual Space did not latch the prepared module');
  if(released.state!=='flight'||released.cargo.attached)fail('manual X did not release the attached module');
  if(!(va<vb*.8))fail('manual X brake did not slow an unlatched trolley');
}

console.log('7) release planning A/B: 10 paired seeds vs reactive line-of-sight');
{
  let wins=0,smartC=0,reactC=0,smartX=0,reactX=0,missSeeds=0;const smartRuns=[],reactRuns=[];
  for(let i=0;i<10;i++){
    const seed=0x5a700+i,a=bootGame('skyhook',{seed,footer:FOOTER}),b=bootGame('skyhook',{seed,footer:FOOTER});
    b.sandbox.__NO_RELEASE_PLAN=1;a.frames(7200,false);b.frames(7200,false);
    const pa=a.sandbox.__skyhookProbe(),pb=b.sandbox.__skyhookProbe();
    if(pa.catches>pb.catches)wins++;if(pa.crashes>0)missSeeds++;
    smartRuns.push(pa.catches);reactRuns.push(pb.catches);
    smartC+=pa.catches;reactC+=pb.catches;smartX+=pa.crashes;reactX+=pb.crashes;
    console.log(`  ${seed.toString(16)}: planned ${pa.catches}c/${pa.crashes}x vs reactive ${pb.catches}c/${pb.crashes}x`);
  }
  const gain=pct(smartC,reactC),reduction=reactX?Math.round((1-smartX/reactX)*100):0,
    smartMedian=median(smartRuns),reactMedian=median(reactRuns),medianGain=pct(smartMedian,reactMedian);
  console.log(`  total: ${wins}/10 wins, catches ${smartC} vs ${reactC} (+${gain}%), median ${smartMedian} vs ${reactMedian} (+${medianGain}%), crashes ${smartX} vs ${reactX} (-${reduction}%)`);
  if(wins<8)fail(`release planner won only ${wins}/10 paired seeds`);
  if(smartC<reactC*1.2)fail(`planner catch gain ${gain}% below required 20%`);
  if(smartMedian<reactMedian*1.2)fail(`planner median catch gain ${medianGain}% below required 20%`);
  if(smartX>reactX*.75)fail(`planner crash reduction ${reduction}% below required 25%`);
  // Five-minute and ten-minute sections carry the per-run honest-miss bands;
  // this shorter paired window only guards against total perfection.
  if(smartX<1||missSeeds<1)fail(`planner became robotically perfect (${smartX} crashes across ${missSeeds} seeds)`);
}

console.log('8) stale-release guard A/B: exact old policy vs catcher check + drama dial');
{
  let guardC=0,oldC=0,guardX=0,oldX=0,lower=0;const guardRuns=[],oldRuns=[];
  for(let i=0;i<10;i++){
    const seed=0x5a740+i,a=bootGame('skyhook',{seed,footer:FOOTER}),b=bootGame('skyhook',{seed,footer:FOOTER});
    b.sandbox.__NO_RELEASE_GUARD=1;a.frames(7200,false);b.frames(7200,false);
    const pa=a.sandbox.__skyhookProbe(),pb=b.sandbox.__skyhookProbe();
    guardC+=pa.catches;oldC+=pb.catches;guardX+=pa.crashes;oldX+=pb.crashes;
    guardRuns.push(pa.crashes);oldRuns.push(pb.crashes);if(pa.crashes<pb.crashes)lower++;
    console.log(`  ${seed.toString(16)}: guarded ${pa.catches}c/${pa.crashes}x vs old ${pb.catches}c/${pb.crashes}x`);
  }
  const guardMedian=median(guardRuns),oldMedian=median(oldRuns),reduction=Math.round((1-guardX/oldX)*100);
  console.log(`  total: catches ${guardC} vs ${oldC}; crashes ${guardX} vs ${oldX} (-${reduction}%), `+
    `median ${guardMedian} vs ${oldMedian}, ${lower}/10 lower-crash pairs`);
  if(guardX>=oldX*.8)fail(`stale-release guard crash reduction ${reduction}% below required 20%`);
  if(guardMedian>=oldMedian)fail(`stale-release guard median ${guardMedian} did not beat old policy ${oldMedian}`);
  if(lower<5)fail(`stale-release guard improved only ${lower}/10 paired seeds`);
  if(guardC<oldC*.95)fail(`stale-release guard lost too many catches (${guardC} vs ${oldC})`);
  if(guardX<10)fail(`stale-release guard erased honest failure (${guardX} crashes)`);
}

console.log('9) dock acts: exact telegraphs and first physical divergence during each warning');
for(const kind of['gust','mooring']){
  const seed=kind==='gust'?0x5a801:0x5a802;
  const a=bootGame('skyhook',{seed,footer:FOOTER}),b=bootGame('skyhook',{seed,footer:FOOTER});
  a.sandbox.__skyIsolateAct(kind);b.sandbox.__skyIsolateAct(kind);b.sandbox.__NO_ACTS=1;
  let first=-1,phase='';for(let f=1;f<=760;f++){
    a.frames(1,false);b.frames(1,false);
    if(first<0&&a.sandbox.__skyMotion()!==b.sandbox.__skyMotion()){
      first=f;const s=a.sandbox.__skyActState();phase=kind==='gust'?s.gust:s.moor;}
  }
  const notes=a.sandbox.__skyhookProbe().notes.filter(e=>e.id===kind),warn=notes.find(e=>e.kind==='act-warning'),land=notes.find(e=>e.kind==='act-land');
  const lead=warn&&land?land.tag-warn.tag:-1,expected=kind==='gust'?240:180;
  console.log(`  ${kind}: telegraph ${lead}f, first body divergence ${first}f during ${phase}`);
  if(!warn||!land||lead!==expected)fail(`${kind}: missing or wrong warning/land pair (${lead}f, expected ${expected})`);
  if(first<0||phase!=='warn')fail(`${kind}: bot first diverged at ${first} during '${phase}', not warning`);
}

console.log('10) progression + falsification: escalation, 100 legal jobs, native 60s spectacle');
{
  let game=bootGame('skyhook',{seed:0x5a850,footer:FOOTER});const p=game.sandbox.__skyhookProgressionFixture();
  console.log(`  early catcher ${p.early.x0.toFixed(1)}→${p.early.x120.toFixed(1)} / screen ${p.early.screen}; `+
    `late ${p.late.x0.toFixed(1)}→${p.late.x120.toFixed(1)} / screen ${p.late.screen}; `+
    `deadlines light ${p.lightDeadline}, engine ${p.heavyDeadline}→${p.heavyLate}; final ${p.final}`);
  if(p.early.screen||p.early.x0!==p.early.x120||!p.late.screen||Math.abs(p.late.x0-p.late.x120)<1||
    !(p.heavyLate<p.heavyDeadline&&p.heavyDeadline<p.lightDeadline)||p.final!=='ENGINE')
    fail(`progression escalation regressed: ${JSON.stringify(p)}`);
  const jobs=game.sandbox.__skyhookSolvabilityFixture();
  console.log(`  solvability ${jobs.solved}/${jobs.jobs}, worst miss ${jobs.worstMiss.toFixed(2)}px, max release plan ${jobs.maxDelay}f`);
  if(jobs.solved!==100||jobs.failures.length)fail(`unsolvable generated job: ${JSON.stringify(jobs.failures[0])}`);
  game=bootGame('skyhook',{seed:0x5a600,footer:FOOTER});const render=game.frames(3600,true),one=game.sandbox.__skyhookProbe();
  console.log(`  native 60s: ${one.releases} releases, ${one.catches} catches, ${render.calls} canvas calls`);
  if(one.releases<5||one.catches<3||render.calls<100000)fail('native 60-second falsification lacked five readable release cycles');
}

console.log('11) 10–15 minute arc + show ladder: final engine, unfold, launch, exact apex budgets');
{
  const game=bootGame('skyhook',{seed:0x5a601,footer:FOOTER});game.frames(54000,false);
  const p=game.sandbox.__skyhookProbe(),launchAt=game.sandbox.__skyEval.launchAt[0],liftAt=game.sandbox.__skyEval.liftAt[0],o=p.show.offeredByTier,s=p.show.shownByTier,s3=s[3]||0;
  const admireGame=bootGame('skyhook',{seed:0x5a610,footer:FOOTER}),admire=admireGame.sandbox.__skyAdmireRuntime(false);
  const gatedGame=bootGame('skyhook',{seed:0x5a611,footer:FOOTER}),gated=gatedGame.sandbox.__skyAdmireRuntime(true);
  console.log(`  launch ${(launchAt/3600).toFixed(2)} min; ${p.catches} catches, ${p.modules} modules, `+
    `tiers ${JSON.stringify(o)}, shown ${JSON.stringify(s)}, hold ${p.show.heldFrames}, slow ${p.show.slowedFrames}, admire ${p.show.admireFrames}`);
  if(p.launches<1||!launchAt||launchAt<36000||launchAt>54000)fail(`airship did not culminate inside 10..15 minutes (${launchAt})`);
  if(p.finalEngines<1)fail('final hull slot was not a forced ENGINE placement');
  if(!liftAt||liftAt<=launchAt+90||liftAt>launchAt+220)fail(`hull did not visibly unfold before lift (${launchAt} -> ${liftAt})`);
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=1))fail(`payoff opportunities not strictly ordered: ${JSON.stringify(o)}`);
  if(s3<1)fail('airship launch never presented a tier-3 apex');
  if(p.show.heldFrames!==6*s3)fail(`apex hold ${p.show.heldFrames} != 6*${s3}`);
  if(p.show.slowedFrames!==24*s3)fail(`apex slow ${p.show.slowedFrames} != 24*${s3}`);
  if(p.show.admireFrames!==48*s3)fail(`apex admire ${p.show.admireFrames} != 48*${s3}`);
  if(admire.directive!==48||admire.admired!==48||admire.sticky!==0||gated.directive!==48||gated.admired!==0||gated.sticky!==0)
    fail(`runtime admire did not exactly follow the directive: ${JSON.stringify({admire,gated})}`);
  if(!p.finite)fail('15-minute airship arc ended non-finite');
  cachedNaturalLaunch={game,p};
}

console.log('12) payoff FX parity: confetti stream is a complete same-seed sim no-op');
{
  const a=bootGame('skyhook',{seed:0x5a901,footer:FOOTER}),b=bootGame('skyhook',{seed:0x5a901,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);
  const same=a.sandbox.__skyhookSignature()===b.sandbox.__skyhookSignature();
  console.log(`  signatures ${same?'identical':'DIFFER'} after 5 minutes and ${a.sandbox.__skyhookProbe().perfects} perfect catches`);
  if(!same)fail('__NO_PAYOFF_FX changed trolley, rope, cargo, hull, act, or outcome state');
}

let cachedTenMinute=null;
const assertTenMinuteBand=(label,p,g)=>{
  if(!p.finite)fail(`${label}: non-finite crane/cargo state`);
  if(p.catches<55||p.catches>80)fail(`${label}: catches ${p.catches} outside measured 55..80`);
  if(p.modules<18||p.modules>26)fail(`${label}: modules ${p.modules} outside measured 18..26`);
  if(g.count<65||g.count>82||g.max>1200)
    fail(`${label}: release cadence ${g.count}, max ${(g.max/60).toFixed(1)}s (required 65..82 and <=20s)`);
  if(p.maxEventLull>720||p.maxProgressLull>2100||p.maxSwing>900)
    fail(`${label}: lulls exceeded contract (event ${p.maxEventLull}, progress ${p.maxProgressLull}, swing ${p.maxSwing})`);
  if(p.crashes<2||p.crashes>14)fail(`${label}: crashes ${p.crashes} outside required 2..14`);
  if(p.salvages<1||p.salvages>12)fail(`${label}: salvage recoveries ${p.salvages} outside required 1..12`);
  if(p.salvages>p.crashes||p.salvages+p.lostModules<p.crashes-1)
    fail(`${label}: ${p.salvages} salvage + ${p.lostModules} shattered do not account for ${p.crashes} crashes`);
  if(p.maxRecoveryStep>1.34)fail(`${label}: salvage displacement ${p.maxRecoveryStep.toFixed(3)}px/frame exceeded cap`);
  if(p.forecasts<55||p.maxForecastError>1e-9)
    fail(`${label}: release forecast proof weak (${p.forecasts}, error ${p.maxForecastError})`);
};

console.log('13) ten-minute soak: strict cadence, measured failure/recovery bands, finite progress');
{
  const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
  const{game,samples}=runSoak('skyhook',{seed:0x5a900,footer:FOOTER,minutes:10});
  const report=analyzeSoak(samples),g=game.sandbox.__skyReleaseGaps(),p=game.sandbox.__skyhookProbe();
  console.log(`  ${soakLine(report)}, ${g.count} releases, max release gap ${(g.max/60).toFixed(1)}s`);
  assertSoak('soak',report,{still:5,quiet:12,stall:35,minEvents:200,minProgress:75},fail);
  assertTenMinuteBand('soak',p,g);cachedTenMinute={seed:0x5a900,game,p,g};
}

console.log('14) twenty-seed ten-minute band: both measured seed families stay inside contract');
{
  const runs=[];
  for(const base of[0x5a800,0x5a900])for(let i=0;i<10;i++){
    const seed=base+i;let game,p,g;
    if(cachedTenMinute&&seed===cachedTenMinute.seed){({game,p,g}=cachedTenMinute);}
    else{game=bootGame('skyhook',{seed,footer:FOOTER});game.frames(36000,false);
      p=game.sandbox.__skyhookProbe();g=game.sandbox.__skyReleaseGaps();}
    const label=`seed ${seed.toString(16)}`;assertTenMinuteBand(label,p,g);
    runs.push({seed,catches:p.catches,crashes:p.crashes,salvages:p.salvages,modules:p.modules,
      releases:g.count,gap:g.max,event:p.maxEventLull,progress:p.maxProgressLull});
    console.log(`  ${seed.toString(16)}: ${p.catches} catches, ${p.crashes} crashes/${p.salvages} salvage, `+
      `${p.modules} modules, ${g.count} releases, gaps ${(g.max/60).toFixed(1)}s, `+
      `event ${(p.maxEventLull/60).toFixed(1)}s, progress ${(p.maxProgressLull/60).toFixed(1)}s`);
  }
  const range=key=>{
    const values=runs.map(o=>o[key]);return`${Math.min(...values)}..${Math.max(...values)}`;
  };
  console.log(`  ranges: catches ${range('catches')}, crashes ${range('crashes')}, salvage ${range('salvages')}, `+
    `modules ${range('modules')}, releases ${range('releases')}, max gap ${(Math.max(...runs.map(o=>o.gap))/60).toFixed(1)}s`);
}

console.log('15) viewer story: immediate plain goal, truthful draw receipt, presentation-only A/B');
{
  let game=bootGame('skyhook',{seed:0x5aa01,footer:FOOTER});game.frames(1,true);
  const opening=game.sandbox.__skyhookViewerProbe();
  console.log(`  opening: "${opening.drawn.hud}" / "${opening.drawn.verb}" / ${opening.drawn.targetLabel}; ghost ${opening.drawn.ghost}`);
  if(opening.drawn.frame!==game.sandbox.__skyhookProbe().showFrame||!opening.drawn.enabled||
    opening.drawn.hud!=='BUILD AIRSHIP 00/26'||opening.drawn.hud!==opening.hud||
    opening.drawn.verb!=='PICK UP CARGO'||opening.drawn.verb!==opening.verb||
    opening.drawn.targetLabel!=='DROP HERE'||!opening.drawn.ghost||opening.drawn.phase!==opening.phase)
    fail(`first rendered frame did not plainly explain the show: ${JSON.stringify(opening)}`);

  const a=bootGame('skyhook',{seed:0x5aa02,footer:FOOTER}),b=bootGame('skyhook',{seed:0x5aa02,footer:FOOTER});
  b.sandbox.__NO_VIEWER_STORY=1;b.sandbox.__NO_PARTIAL_HULL=1;
  a.frames(7200,true);b.frames(7200,true);
  const same=a.sandbox.__skyhookSignature()===b.sandbox.__skyhookSignature(),va=a.sandbox.__skyhookViewerProbe(),vb=b.sandbox.__skyhookViewerProbe();
  console.log(`  2-minute rendered A/B signatures ${same?'identical':'DIFFER'}; story ${va.enabled}/${vb.enabled}, partial ${va.partialHull}/${vb.partialHull}`);
  if(!same)fail('viewer story or partial-hull rendering changed the same-seed simulation');
  if(!va.enabled||vb.enabled||!va.partialHull||vb.partialHull)fail('viewer presentation switches did not report their actual state');
}

console.log('16) visible causality: every credited catch persists and forecast labels tell the truth');
{
  let game=bootGame('skyhook',{seed:0x5aa10,footer:FOOTER});
  const fills=[];
  for(let catchNo=1;catchNo<=3;catchNo++){
    game.sandbox.__skyhookCatchFixture();game.frames(1,true);const v=game.sandbox.__skyhookViewerProbe();
    fills.push(`${v.moduleFill}/3 -> ${v.drawn.visiblePartialCount} visible, hull ${game.sandbox.__skyhookProbe().hull}`);
    if(v.placedPieces!==v.moduleFill||v.expectedVisiblePartialCount!==v.moduleFill||v.drawn.visiblePartialCount!==v.moduleFill)
      fail(`catch ${catchNo} vanished instead of persisting: ${JSON.stringify(v)}`);
    if(v.drawn.hud!==v.hud||v.drawn.phase!==v.phase||!v.drawn.ghost)
      fail(`catch ${catchNo} draw receipt disagreed with viewer metadata: ${JSON.stringify(v)}`);
  }
  console.log(`  catches: ${fills.join('; ')}`);
  const built=game.sandbox.__skyhookProbe();
  if(built.hull!==1||built.moduleFill!==0)fail(`three catches did not lock exactly one module: ${JSON.stringify(built)}`);

  game=bootGame('skyhook',{seed:0x5aa11,footer:FOOTER});game.sandbox.__skyhookCatchFixture();
  game.sandbox.__NO_PARTIAL_HULL=1;game.frames(1,true);const muted=game.sandbox.__skyhookViewerProbe();
  if(muted.moduleFill!==1||muted.drawn.visiblePartialCount!==0||muted.partialHull)
    fail(`__NO_PARTIAL_HULL did not cleanly ablate only the credited-part drawing: ${JSON.stringify(muted)}`);

  game=bootGame('skyhook',{seed:0x5aa12,footer:FOOTER});const stages=[];
  for(const count of[0,6,13,20,26]){
    game.sandbox.__skyhookSetViewerHull(count);game.frames(1,true);const v=game.sandbox.__skyhookViewerProbe();
    stages.push(`${count}:${v.drawn.phase}`);
    const expected=[0,1,2,3,4][stages.length-1];
    if(v.phaseIndex!==expected||v.drawn.silhouetteStage!==expected||!v.drawn.ghost)
      fail(`hull milestone ${count} did not visibly advance its silhouette stage: ${JSON.stringify(v)}`);
  }
  console.log(`  silhouette stages ${stages.join(' | ')}`);

  game=bootGame('skyhook',{seed:0x5aa13,footer:FOOTER});game.sandbox.__skyhookSetManualSwing();
  let forecast=null;for(let i=0;i<40&&!forecast;i++){game.frames(1,true);const v=game.sandbox.__skyhookViewerProbe();if(v.trajectory)forecast=v;}
  if(!forecast)fail('viewer never received a plain-language landing forecast');
  else{
    const{trajectory:t,trajectoryDelta:d,trajectoryTolerance:tol}=forecast;
    const truthful=t==='ON TARGET'?Math.abs(d)<=tol:t==='SHORT'?d< -tol:t==='LONG'?d>tol:false;
    console.log(`  forecast ${t}: delta ${d===null?'n/a':d.toFixed(2)}, tolerance ${tol}; drawn ${forecast.drawn.trajectory}`);
    if(!truthful||forecast.drawn.trajectory!==t)fail(`trajectory label was not mathematically truthful: ${JSON.stringify(forecast)}`);
  }
}

console.log('17) long launch A/B: identical natural pre-launch run, 15–20 second ceremony, exact show budgets');
{
  const longGame=cachedNaturalLaunch.game,legacy=bootGame('skyhook',{seed:0x5a601,footer:FOOTER});
  legacy.sandbox.__NO_LONG_LAUNCH=1;legacy.frames(54000,false);
  const le=longGame.sandbox.__skyEval,se=legacy.sandbox.__skyEval,
    lp=longGame.sandbox.__skyhookProbe(),sp=legacy.sandbox.__skyhookProbe(),
    longFrames=le.launchEndAt[0]-le.launchAt[0],shortFrames=se.launchEndAt[0]-se.launchAt[0];
  const preSame=le.launchAt[0]===se.launchAt[0]&&le.liftAt[0]===se.liftAt[0]&&
    le.preLaunchSignatures[0]===se.preLaunchSignatures[0]&&
    JSON.stringify(le.launchOutcomes[0])===JSON.stringify(se.launchOutcomes[0]);
  console.log(`  pre-launch ${preSame?'identical':'DIFFER'} at ${(le.launchAt[0]/3600).toFixed(2)}m; ceremony ${longFrames}f vs legacy ${shortFrames}f`);
  if(!preSame)fail(`long launch altered a natural pre-launch outcome: ${JSON.stringify({long:le.launchOutcomes[0],legacy:se.launchOutcomes[0]})}`);
  if(longFrames<900||longFrames>1200||shortFrames>=500||longFrames-shortFrames<500)
    fail(`launch duration contract failed (${longFrames}f long, ${shortFrames}f legacy)`);
  for(const[label,p]of[['long',lp],['legacy',sp]]){
    const s3=p.show.shownByTier[3]||0;
    if(s3<1||p.show.heldFrames!==6*s3||p.show.slowedFrames!==24*s3||p.show.admireFrames!==48*s3)
      fail(`${label} launch broke exact show budgets: ${JSON.stringify(p.show)}`);
  }
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
