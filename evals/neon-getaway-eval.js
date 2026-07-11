#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
const{runMotion,analyzeMotion,assertMotion,motionLine}=require('./motion');

// Observation only: copied planner cars are ignored, and none of these hooks
// make decisions, touch physics values, draw, or consume either RNG stream.
const FOOTER=String.raw`
globalThis.__ngApplied=[];
{const old=advanceCar;advanceCar=function(body,intent,env){const out=old(body,intent,env);
  if(body===player){globalThis.__ngApplied.push({showFrame,runFrame,steer:intent.steer,throttle:intent.throttle,
    brake:!!intent.brake,handbrake:!!intent.handbrake,action:!!intent.action,targetX:intent.targetX,tactic:intent.tactic});
    if(globalThis.__ngApplied.length>360)globalThis.__ngApplied.shift();}return out;};}
globalThis.__ngClearApplied=()=>{globalThis.__ngApplied.length=0;};
globalThis.__ngLastApplied=()=>globalThis.__ngApplied.at(-1)||null;
globalThis.__ngContinuity={max:0,from:null,to:null};
{const old=stepPlayer;stepPlayer=function(){const from={x:player.x,y:player.y},out=old(),to={x:player.x,y:player.y},
  d=Math.hypot(to.x-from.x,to.y-from.y);if(d>globalThis.__ngContinuity.max)globalThis.__ngContinuity={max:d,from,to};return out;};}
globalThis.__ngCopKinds={};
{const old=spawnCop;spawnCop=function(){const out=old(),c=police.at(-1);if(c)globalThis.__ngCopKinds[c.type]=(globalThis.__ngCopKinds[c.type]||0)+1;return out;};}
globalThis.__ngReset=()=>resetRun(true);
globalThis.__ngPoliceKinds=()=>Object.assign({},globalThis.__ngCopKinds);
globalThis.__ngShowApex=()=>{SHOW.reset(showFrame);SHOW.offer({id:'eval-apex',tier:3,at:showFrame,tag:'fixture',expiresAt:showFrame+120});};
`;

let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const sum=(runs,key)=>runs.reduce((total,p)=>total+p.stats[key],0);
const policyScore=p=>p.stats.intersections+12*p.stats.escapes+3*p.stats.swaps+3*p.stats.disguises+
  2*p.stats.rampClears+p.stats.roadblocksAvoided-8*p.stats.busts-4*p.stats.roadblockHits;
const failures=p=>4*p.stats.busts+2*p.stats.roadblockHits+p.stats.trafficHits;
const authoredRoutes=p=>p.stats.escapes+p.stats.swaps+p.stats.disguises+p.stats.alleyUses+
  p.stats.rampLaunches+p.stats.rampClears;
const inBands=(p,bands,label)=>{for(const[key,[lo,hi]]of Object.entries(bands)){
  const value=key==='police'?p.police:key==='maxWanted'?p.maxWanted:p.stats[key];
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
    if(land[i].at-warn[i].at!==240)fail(`${label}: ${id} viewer warning ${land[i].at-warn[i].at}f != 240`);
  }
}

// Registered 2026-07-10 (SHA ce221ade...) and RE-DERIVED 2026-07-11 after the
// motion-contract limp change (__NO_LIMP): wrecked police now roll to the
// shoulder instead of parking, so they stay in the pursuit window longer and
// the whole post-crash distribution shifts. Fresh ten-seed paired five-minute
// sweep (0x4f00 + i*37), shared smart/reactive union extrema: intersections
// 130..160, maxWanted 4..5, escapes 3..7, swaps 0..8, alleyUses 14..36,
// rampLaunches 2..12, alleyEscapes 1..5, rampClears 0..5, disguises 0..5,
// lapses 0..3. Bands keep margin on both sides; keys whose old bands still
// contained the new extrema were kept as-is.
const POLICY_BANDS={
  intersections:[120,170],districts:[9,13],maxWanted:[4,5],escapes:[2,8],swaps:[0,9],
  disguises:[0,6],alleyUses:[10,42],alleyEscapes:[0,7],rampLaunches:[1,14],rampClears:[0,7],
  transitRampClears:[0,1],roadblocksAvoided:[2,18],roadblockHits:[4,19],policeCrashes:[10,18],
  trafficHits:[1,36],nearMisses:[5,34],busts:[2,11],wantedUps:[12,29],lapses:[0,4],acts:[3,3],
  paintEscapes:[0,4],swapEscapes:[0,4],events:[250,340],progress:[145,220],maxStep:[2,2.7]
};

// RE-DERIVED 2026-07-11 with the limp change, from ten independent ten-minute
// seeds (0x5200, 0x5235, 0x5200 + i*53): all finite, 0s still, 2-3s quiet,
// 3-4s progress stalls, 559..617 events, 352..396 progress, max wanted 5,
// 8..11 escapes, dragnet x3 + transit x2 lands everywhere. Measured extrema
// that moved: disguises 0..9, alleyEscapes 4..10, rampLaunches 8..22,
// nearMisses 9..24, busts 7..11. Vans reach the pursuit in 5/10 seeds now
// (limping wrecks suppress fresh spawns), so the four-kind assert runs on
// seeds measured to include them (0x5200, 0x52d4).
const SOAK_BANDS={
  intersections:[270,310],districts:[19,23],maxWanted:[5,5],escapes:[7,12],swaps:[3,13],
  disguises:[0,10],alleyUses:[32,60],alleyEscapes:[3,11],rampLaunches:[7,24],rampClears:[3,9],
  transitRampClears:[2,2],roadblocksAvoided:[12,26],roadblockHits:[13,29],policeCrashes:[23,32],
  trafficHits:[12,37],nearMisses:[7,30],busts:[6,14],wantedUps:[38,50],lapses:[1,5],acts:[5,5],
  paintEscapes:[0,2],swapEscapes:[1,4],events:[540,630],progress:[350,410],maxStep:[2.2,2.7]
};

// Motion-contract pace floors (owner directive 2026-07-11), measured over the
// ten 0x6100+i*61 three-minute seeds plus both ten-minute soak seeds with the
// limp active: driver mean speed 1.650..1.937 px/f, pursuit fleet mean
// 1.819..2.042 px/f. Floors keep ~12% margin under the measured minima.
const DRIVER_PACE_FLOOR=1.45,COP_PACE_FLOOR=1.60;
const paceOf=run=>{const per=new Map();let prev=null;
  for(const s of run.samples){if(prev)for(const a of s.actors){const b=prev.actors.find(q=>q.id===a.id);if(!b)continue;
    const d=Math.hypot(a.x-b.x,a.y-b.y),t=per.get(a.id)||{d:0,f:0};t.d+=d;t.f+=run.step;per.set(a.id,t);}prev=s;}
  const cops=[...per.entries()].filter(([id])=>id!=='driver').map(([,t])=>t.d/t.f),d=per.get('driver');
  return{driver:d?d.d/d.f:0,copMean:cops.length?cops.reduce((a,b)=>a+b,0)/cops.length:0,copCount:cops.length};};

console.log('1) fixed 60 Hz determinism, render parity, chunk parity, and finite renderer');
{
  const a=bootGame('neon-getaway',{seed:0x4e01,footer:FOOTER}),
    b=bootGame('neon-getaway',{seed:0x4e01,footer:FOOTER}),
    rendered=bootGame('neon-getaway',{seed:0x4e01,footer:FOOTER});
  a.frames(3600,false);b.frames(3600,false);const draws=rendered.frames(3600,true);
  const sa=a.sandbox.__neonGetawaySignature(),sb=b.sandbox.__neonGetawaySignature(),sr=rendered.sandbox.__neonGetawaySignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${draws.calls} draw calls`);
  if(sa!==sb)fail('same seed diverged at fixed 60 Hz');
  if(sa!==sr)fail('render traversal changed simulation state or RNG');
  if(!a.sandbox.__neonGetawayProbe().finite||!rendered.sandbox.__neonGetawayProbe().finite)fail('headless or rendered replay became non-finite');
  if(draws.calls<1000||!draws.byMethod.fillRect||!draws.byMethod.beginPath||!draws.byMethod.fillText)
    fail(`renderer was not genuinely exercised: ${JSON.stringify(draws.byMethod)}`);

  const mono=bootGame('neon-getaway',{seed:0x4e02,footer:FOOTER}),chunked=bootGame('neon-getaway',{seed:0x4e02,footer:FOOTER});
  mono.frames(2400,false);for(let i=0;i<240;i++)chunked.frames(10,false);
  const same=mono.sandbox.__neonGetawaySignature()===chunked.sandbox.__neonGetawaySignature();
  console.log(`  2,400 monolithic frames vs 240 x 10: ${same?'identical':'DIFFERENT'}`);
  if(!same)fail('headless batching changed fixed-step simulation');
}

console.log('2) route lookahead is pure, repeatable, RNG-inert, and uses the shared integrator');
{
  const planned=bootGame('neon-getaway',{seed:0x4e10,footer:FOOTER}),control=bootGame('neon-getaway',{seed:0x4e10,footer:FOOTER}),
    fixture=planned.sandbox.__neonGetawayPlannerFixture();
  const nextPlanned=planned.sandbox.__neonGetawayNextRandom(),nextControl=control.sandbox.__neonGetawayNextRandom();
  console.log(`  pure ${fixture.pure}; repeat ${fixture.repeat}; route ${fixture.plan&&fixture.plan.route} @ ${fixture.plan&&fixture.plan.targetX}; RNG ${nextPlanned.toFixed(8)}/${nextControl.toFixed(8)}`);
  if(!fixture.pure||!fixture.repeat||!fixture.finite||!fixture.plan||!Number.isFinite(fixture.plan.score))
    fail(`planner fixture regressed: ${JSON.stringify(fixture)}`);
  if(nextPlanned!==nextControl)fail('route planning consumed engine RNG for simulation-invisible work');
}

console.log('3) baseline-first route-policy A/B: ten paired five-minute seeds');
{
  const smart=[],reactive=[];let scoreWins=0,failureWins=0;
  for(let i=0;i<10;i++){
    const seed=0x4f00+i*37,a=bootGame('neon-getaway',{seed,footer:FOOTER}),b=bootGame('neon-getaway',{seed,footer:FOOTER});
    b.sandbox.__NO_ROUTE_PLAN=1;a.frames(18000,false);b.frames(18000,false);
    const pa=a.sandbox.__neonGetawayProbe(),pb=b.sandbox.__neonGetawayProbe();smart.push(pa);reactive.push(pb);
    if(policyScore(pa)>policyScore(pb))scoreWins++;if(failures(pa)<failures(pb))failureWins++;
    for(const[p,label]of[[pa,'planned'],[pb,'reactive']]){
      inBands(p,POLICY_BANDS,`seed ${seed.toString(16)} ${label}`);
      if(!p.finite||p.stats.invisibleRescues!==0)fail(`seed ${seed.toString(16)} ${label}: non-finite or invisible rescue`);
      if(p.stats.maxEventLull>360||p.stats.maxProgressLull>420)fail(`seed ${seed.toString(16)} ${label}: story lull ${p.stats.maxEventLull}/${p.stats.maxProgressLull}f`);
    }
    console.log(`  ${seed.toString(16)} ${pa.persona.padEnd(10)} score ${policyScore(pa)}/${policyScore(pb)}, `+
      `escapes ${pa.stats.escapes}/${pb.stats.escapes}, failures ${failures(pa)}/${failures(pb)}`);
  }
  const escape=[sum(smart,'escapes'),sum(reactive,'escapes')],route=[smart.reduce((n,p)=>n+authoredRoutes(p),0),reactive.reduce((n,p)=>n+authoredRoutes(p),0)],
    bad=[smart.reduce((n,p)=>n+failures(p),0),reactive.reduce((n,p)=>n+failures(p),0)],distance=[sum(smart,'intersections'),sum(reactive,'intersections')],
    score=[smart.reduce((n,p)=>n+policyScore(p),0),reactive.reduce((n,p)=>n+policyScore(p),0)],
    transit=[sum(smart,'transitRampClears'),sum(reactive,'transitRampClears')],
    baseline={swaps:sum(reactive,'swaps'),disguises:sum(reactive,'disguises'),alleyUses:sum(reactive,'alleyUses'),
      rampLaunches:sum(reactive,'rampLaunches'),rampClears:sum(reactive,'rampClears')};
  console.log(`  ${scoreWins}/10 score wins; ${failureWins}/10 failure wins; score ${score[0]}/${score[1]}, escapes ${escape[0]}/${escape[1]}, `+
    `authored routes ${route[0]}/${route[1]}, transit clears ${transit[0]}/${transit[1]}, failures ${bad[0]}/${bad[1]}, intersections ${distance[0]}/${distance[1]}`);
  if(scoreWins<9||failureWins<9)fail(`route plan did not win clearly enough (${scoreWins}/10 score, ${failureWins}/10 failures)`);
  // Transit-clear margin re-measured 2026-07-11 after the limp change:
  // smart 10 vs reactive 3 across the ten paired seeds (was 10 vs ~1).
  if(score[0]<score[1]*1.5||escape[0]<escape[1]||route[0]<route[1]*1.04||bad[0]>bad[1]*.7||distance[0]<distance[1]*.95||
    transit[0]<9||transit[0]<transit[1]+6)
    fail(`aggregate route-policy win regressed: ${JSON.stringify({score,escape,route,transit,bad,distance})}`);
  if(baseline.swaps<15||baseline.disguises<10||baseline.alleyUses<150||baseline.rampLaunches<40||baseline.rampClears<8)
    fail(`__NO_ROUTE_PLAN baseline stopped honestly participating: ${JSON.stringify(baseline)}`);
}

console.log('4) DRAGNET and TRANSIT LOCK change the bot during an exact 240f warning');
for(const type of['dragnet','transit']){
  const seed=type==='dragnet'?0x5010:0x5011,a=bootGame('neon-getaway',{seed,footer:FOOTER}),b=bootGame('neon-getaway',{seed,footer:FOOTER});
  a.sandbox.__neonGetawayActFixture(type);b.sandbox.__neonGetawayActFixture(type);b.sandbox.__NO_ACTS=1;
  if(a.sandbox.__neonGetawayPhysical()!==b.sandbox.__neonGetawayPhysical())fail(`${type}: paired act fixture did not start identical`);
  let first=-1,phase='',tactic='';
  for(let frame=1;frame<=270;frame++){
    a.frames(1,false);b.frames(1,false);
    if(first<0&&a.sandbox.__neonGetawayPhysical()!==b.sandbox.__neonGetawayPhysical()){
      first=frame;const p=a.sandbox.__neonGetawayProbe();phase=p.act.phase;tactic=p.player.tactic;}
  }
  const pa=a.sandbox.__neonGetawayProbe(),pb=b.sandbox.__neonGetawayProbe(),warn=pa.act.notes.find(n=>n.kind==='act-warning'),land=pa.act.notes.find(n=>n.kind==='act-land');
  console.log(`  ${type}: first physical divergence ${first}f in ${phase} (${tactic}); warning ${warn&&land?land.tag-warn.tag:'?'}f`);
  if(!warn||!land||land.tag-warn.tag!==240||land.at-warn.at!==240)fail(`${type}: warning/land pair was not exactly 240 frames`);
  if(first<1||first>=240||phase!=='warn')fail(`${type}: bot did not physically reroute during warning`);
  if(pb.act.notes.length)fail(`${type}: __NO_ACTS emitted notes`);
}
{
  const game=bootGame('neon-getaway',{seed:0x5012,footer:FOOTER});game.sandbox.__neonGetawayActFixture('dragnet');game.frames(100,false);
  game.sandbox.__ngReset();game.frames(300,false);const p=game.sandbox.__neonGetawayProbe();
  if(p.act.phase!=='calm'||p.act.notes.some(n=>n.kind==='act-land'))fail('reset during act warning left a stale land');
}

console.log('5) human takeover shares the bot intent schema and runtime vehicle physics');
{
  const game=bootGame('neon-getaway',{seed:0x5020,footer:FOOTER}),initial=game.sandbox.__neonGetawayManual();
  press(game,'Enter');const instructions=game.sandbox.__neonGetawayManual();press(game,'Enter');const started=game.sandbox.__neonGetawayManual();
  const schema=game.sandbox.__neonGetawayIntentSchemas();game.sandbox.__ngClearApplied();
  game.key('keydown','ArrowLeft');game.frames(5,false);game.key('keyup','ArrowLeft');const steer=game.sandbox.__ngLastApplied();
  game.sandbox.__ngClearApplied();game.key('keydown','ArrowUp');game.frames(4,false);game.key('keyup','ArrowUp');const throttle=game.sandbox.__ngLastApplied();
  game.sandbox.__ngClearApplied();game.key('keydown','Space');game.frames(2,false);game.key('keyup','Space');const brake=game.sandbox.__ngLastApplied();
  console.log(`  playing ${initial.playing}->${instructions.playing}->${started.playing}; schema ${schema.humanKeys.join(',')}; steer ${steer&&steer.steer}, throttle ${throttle&&throttle.throttle}, handbrake ${brake&&brake.handbrake}`);
  if(initial.playing||instructions.playing||!started.playing)fail('manual session skipped the two-Enter gate');
  if(schema.humanKeys.join('|')!==schema.botKeys.join('|'))fail(`human/bot intent schemas differ: ${JSON.stringify(schema)}`);
  if(!steer||steer.steer!==-1||steer.tactic!=='MANUAL GETAWAY')fail('manual steering did not traverse runtime advanceCar');
  if(!throttle||throttle.throttle!==1||throttle.tactic!=='MANUAL GETAWAY')fail('manual throttle did not traverse runtime advanceCar');
  if(!brake||!brake.handbrake||brake.tactic!=='MANUAL GETAWAY')fail('manual handbrake did not traverse runtime advanceCar');
  if(!game.sandbox.__neonGetawayProbe().finite)fail('manual control produced non-finite state');
}

console.log('6) ten-minute soaks: moving city, escalation, tactics, progress, and exact SHOW budgets');
for(const seed of[0x5200,0x52d4]){
  const{game,samples}=runSoak('neon-getaway',{seed,minutes:10,footer:FOOTER}),report=analyzeSoak(samples),p=game.sandbox.__neonGetawayProbe(),
    show=p.show,offered=show.offeredByTier,shown=show.shownByTier,s3=shown[3]||0,kinds=game.sandbox.__ngPoliceKinds(),continuity=game.sandbox.__ngContinuity;
  console.log(`  ${seed.toString(16)} ${soakLine(report)}; escapes ${p.stats.escapes}, swaps ${p.stats.swaps}, `+
    `wanted max ${p.maxWanted}, tiers ${JSON.stringify(shown)}, cops ${JSON.stringify(kinds)}`);
  assertSoak(seed.toString(16),report,{still:1,quiet:5,stall:5,minEvents:450,minProgress:320},fail);
  inBands(p,SOAK_BANDS,`seed ${seed.toString(16)} soak`);
  if(!p.finite||p.stats.invisibleRescues!==0)fail(`seed ${seed.toString(16)}: non-finite or invisible rescue`);
  if(continuity.max>3.1)fail(`seed ${seed.toString(16)}: unaccounted ${continuity.max.toFixed(2)}px one-step discontinuity`);
  if(!p.wantedFrames[1]||!p.wantedFrames[2]||!p.wantedFrames[3]||!p.wantedFrames[4]||!p.wantedFrames[5])
    fail(`seed ${seed.toString(16)}: wanted escalation skipped a level ${JSON.stringify(p.wantedFrames)}`);
  for(const kind of['cruiser','bike','interceptor','van'])if(!kinds[kind])fail(`seed ${seed.toString(16)}: ${kind} tactic never joined the pursuit`);
  notePairs(p,'dragnet',`seed ${seed.toString(16)}`,3);notePairs(p,'transit',`seed ${seed.toString(16)}`,2);
  if(!((offered[1]||0)>(offered[2]||0)&&(offered[2]||0)>(offered[3]||0)&&(offered[3]||0)>=4))
    fail(`seed ${seed.toString(16)}: offered tiers not strictly ordered ${JSON.stringify(offered)}`);
  if(!((shown[1]||0)>(shown[2]||0)&&(shown[2]||0)>(shown[3]||0)&&(shown[3]||0)>=4))
    fail(`seed ${seed.toString(16)}: shown tiers not strictly ordered ${JSON.stringify(shown)}`);
  if(show.heldFrames!==6*s3)fail(`seed ${seed.toString(16)}: apex hold ${show.heldFrames} != 6*${s3}`);
  if(show.slowedFrames!==24*s3)fail(`seed ${seed.toString(16)}: apex slow ${show.slowedFrames} != 24*${s3}`);
  if(show.admireFrames!==48*s3)fail(`seed ${seed.toString(16)}: apex admire ${show.admireFrames} != 48*${s3}`);
}
console.log('6b) motion contract: nobody parks bare, emote budgets measured, pace floors hold');
for(const[seed,minutes]of[[0x5200,10],[0x6100,2]]){
  const run=runMotion('neon-getaway',{seed,minutes}),pace=paceOf(run);
  // The driver answers the strict default budgets alone. The pursuit fleet
  // carries measured wreck-emote budgets: this analyzer counts emote DURATION
  // even while the actor moves, a wrecked cop emotes through its whole
  // disabled window while limping to the shoulder, and a short-lived wreck
  // spends up to .247 of its own on-screen life emoting (measured 2026-07-11
  // over these exact seeds: max pause 140f, max share .247, driver pause 120f
  // and share .064). Fleet budgets keep margin; the driver stays at defaults.
  const driverReport=analyzeMotion({step:run.step,samples:run.samples.map(s=>Object.assign({},s,{actors:s.actors.filter(a=>a.id==='driver')}))},{});
  const fleetReport=analyzeMotion(run,{emoteFrames:160,emoteShare:.30});
  console.log(`  ${seed.toString(16)} (${minutes}m) driver[${motionLine(driverReport)}] fleet[${motionLine(fleetReport)}] · driver ${pace.driver.toFixed(3)} px/f · fleet mean ${pace.copMean.toFixed(3)} px/f over ${pace.copCount} cops`);
  assertMotion(seed.toString(16)+' driver',driverReport,fail);
  assertMotion(seed.toString(16)+' fleet',fleetReport,fail);
  if(run.samples.some(s=>!s.actors.some(a=>a.id==='driver')))fail(`${seed.toString(16)}: motion probe lost the driver`);
  if(run.samples.filter(s=>s.actors.length<2).length>run.samples.length*.02)
    fail(`${seed.toString(16)}: pursuit left the motion probe (no cops in >2% of samples)`);
  if(pace.driver<DRIVER_PACE_FLOOR)fail(`${seed.toString(16)}: driver pace ${pace.driver.toFixed(3)} px/f under floor ${DRIVER_PACE_FLOOR}`);
  if(pace.copMean<COP_PACE_FLOOR)fail(`${seed.toString(16)}: pursuit pace ${pace.copMean.toFixed(3)} px/f under floor ${COP_PACE_FLOOR}`);
}

console.log('6c) __NO_LIMP / __NO_EMOTE ablations re-prove the motion fix and stay sim-honest');
{
  // Re-measured 2026-07-11 under this analyzer: wrecked cops emote through
  // their whole disabled window and accelerate out of the still radius when
  // it ends, so __NO_LIMP produces zero budget violations — the limp win is
  // proven by displacement instead. Emoting (wrecked) cops roll at the .62
  // px/f shoulder floor with the limp (stalled share .010/.000 across seeds
  // 0x6100/0x613d) and sit parked in 40-48% of wreck samples with __NO_LIMP.
  const emoteSteps=run=>{const out=[];let prev=null;
    for(const s of run.samples){if(prev)for(const a of s.actors){if(a.id==='driver'||!a.emote)continue;
      const b=prev.actors.find(q=>q.id===a.id&&q.emote);if(b)out.push(Math.hypot(a.x-b.x,a.y-b.y)/run.step);}prev=s;}
    return out;};
  const stalledShare=steps=>steps.filter(v=>v<.3).length/Math.max(1,steps.length);
  const limpSteps=emoteSteps(runMotion('neon-getaway',{seed:0x6100,minutes:3})),
    parkSteps=emoteSteps(runMotion('neon-getaway',{seed:0x6100,minutes:3,footer:'globalThis.__NO_LIMP=1;'}));
  const uncovered=analyzeMotion(runMotion('neon-getaway',{seed:0x613d,minutes:3,footer:'globalThis.__NO_EMOTE=1;'}),{});
  console.log(`  limp stalled ${(stalledShare(limpSteps)*100).toFixed(1)}% of ${limpSteps.length} wreck samples; `+
    `__NO_LIMP stalled ${(stalledShare(parkSteps)*100).toFixed(1)}% of ${parkSteps.length}; __NO_EMOTE violations ${uncovered.violations.length}`);
  if(limpSteps.length<100||stalledShare(limpSteps)>.05)fail(`limping wrecks stopped rolling to the shoulder (${limpSteps.length} samples, ${(stalledShare(limpSteps)*100).toFixed(1)}% stalled)`);
  if(stalledShare(parkSteps)<.25)fail('__NO_LIMP ablation: parked wrecks no longer measurable, limp win unproven');
  if(!uncovered.violations.some(v=>/driver.*no emote/.test(v)))fail('__NO_EMOTE ablation: motion gate no longer requires authored emote coverage');
  const a=bootGame('neon-getaway',{seed:0x613d}),b=bootGame('neon-getaway',{seed:0x613d});
  b.sandbox.__NO_EMOTE=1;a.frames(18000,false);b.frames(18000,false);
  if(a.sandbox.__neonGetawaySignature()!==b.sandbox.__neonGetawaySignature())
    fail('__NO_EMOTE changed simulation state (emotes must be render/probe-only)');
}

{
  const game=bootGame('neon-getaway',{seed:0x5290,footer:FOOTER}),fixture=game.sandbox.__neonGetawayAdmireFixture();
  if(fixture.admired.tactic!=='WATCH THEM OVERSHOOT'||fixture.gated.tactic==='WATCH THEM OVERSHOOT')
    fail(`__NO_ADMIRE did not gate the bot-only coast: ${JSON.stringify(fixture)}`);
  const perfect=bootGame('neon-getaway',{seed:0x5291,footer:FOOTER});perfect.sandbox.__NO_LAPSE=1;perfect.frames(18000,false);
  if(perfect.sandbox.__neonGetawayProbe().stats.lapses!==0)fail('__NO_LAPSE did not eliminate skill-profile lapse onsets');
}

console.log('7) payoff FX is a perfect same-seed simulation no-op');
{
  const a=bootGame('neon-getaway',{seed:0x5300,footer:FOOTER}),b=bootGame('neon-getaway',{seed:0x5300,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);
  const same=a.sandbox.__neonGetawaySignature()===b.sandbox.__neonGetawaySignature(),p=a.sandbox.__neonGetawayProbe();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} through ${p.stats.events} events / ${p.stats.escapes} escapes`);
  if(!same)fail('__NO_PAYOFF_FX changed simulation state');
  if(p.stats.escapes<1)fail('FX no-op window did not exercise an escape payoff');
}

console.log(failed?'\nNEON GETAWAY EVAL FAILED':'\nNEON GETAWAY EVAL PASSED');
process.exit(failed?1:0);
