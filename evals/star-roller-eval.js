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
{const old=advanceBall;advanceBall=function(body,intent,env){const out=old(body,intent,env);
  if(body===ball){globalThis.__srApplied.push({showFrame,runFrame,steer:intent.steer,throttle:intent.throttle,
    brake:!!intent.brake,tuck:!!intent.tuck,dash:!!intent.dash,targetX:intent.targetX,tactic:intent.tactic});
    if(globalThis.__srApplied.length>360)globalThis.__srApplied.shift();}return out;};}
globalThis.__srClearApplied=()=>{globalThis.__srApplied.length=0;};
globalThis.__srLastApplied=()=>globalThis.__srApplied.at(-1)||null;
globalThis.__srContinuity={max:0,from:null,to:null};
{const old=stepBall;stepBall=function(){const from={x:ball.x,y:ball.y},out=old(),to={x:ball.x,y:ball.y},
  d=Math.hypot(to.x-from.x,to.y-from.y);if(d>globalThis.__srContinuity.max)globalThis.__srContinuity={max:d,from,to};return out;};}
globalThis.__srReset=()=>resetRun(true);
// Cumulative run tracking: per-run stats reset on each resetRun, so the eval
// measures windows (5-min A/B) and soaks across run boundaries honestly.
globalThis.__srEndedRuns=[];
{const old=resetRun;resetRun=function(full){
  if(runFrame>3000)globalThis.__srEndedRuns.push({stats:JSON.parse(JSON.stringify(stats)),d:ball.d,runFrame,outcome,state,notes:act.notes.slice()});
  return old(full);};}
globalThis.__srCumulative=()=>{
  const out=Object.assign({},stats),er=globalThis.__srEndedRuns;
  let maxD=ball.d,runs=1;
  for(const r of er){for(const k in r.stats){if(k==='maxEventLull'||k==='maxProgressLull'){out[k]=Math.max(out[k]||0,r.stats[k]||0);}
    else if(typeof r.stats[k]==='number')out[k]=(out[k]||0)+r.stats[k];}
    maxD=Math.max(maxD,r.d);runs++;}
  return{stats:out,runs,maxD};};
globalThis.__srActNotes=()=>[...globalThis.__srEndedRuns.flatMap(r=>r.notes),...act.notes];
// Act A/B divergence surface: ball physics, sweeper positions, rain/items,
// the King's descent, and pet positions (they scurry for the royal warning).
globalThis.__srActWorld=()=>globalThis.__starRollerPhysical()+'|'+JSON.stringify({
  sweepers:sweepers.map(s=>[s.id,round(s.x,3),round(s.y,3),s.state]),
  items:items.length,rain:items.filter(i=>i.state==='rain').length,
  kingY:round(king.y,3),
  pets:items.filter(i=>i.mover==='pet'&&i.state==='loose').map(i=>[i.id,round(i.x,3),round(i.y,3)])});
// Overlap contract: nobody rides inside anybody. Hard overlap = deeper than
// the drawn bodies allow; the resolver must clear it within a few frames.
globalThis.__srOverlap={worst:0,maxRun:0,run:0};
globalThis.__srOverlapScan=()=>{
  let hard=0;
  const bodies=[ball,...sweepers];
  for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
    const a=bodies[i],b=bodies[j];
    if(Math.abs(a.x-b.x)<7&&Math.abs(a.y-b.y)<9)hard++;
  }
  for(const t of cars){if(t.size<ball.d)continue;
    if(Math.abs(ball.x-t.x)<6&&Math.abs(ball.y-t.y)<8)hard++;}
  const O=globalThis.__srOverlap;O.worst=Math.max(O.worst,hard);
  O.run=hard?O.run+1:0;O.maxRun=Math.max(O.maxRun,O.run);
  return hard;
};
{const old=stepWorld;stepWorld=function(){const out=old();globalThis.__srOverlapScan();return out;};}
// Eval-only fixture: stage a hard overlap the resolver must clear.
globalThis.__srContactFixture=()=>{
  ball.x=80;ball.y=5000;ball.vx=0;ball.speed=1.6;ball.wobbleT=0;ball.invulnT=0;
  items=items.filter(i=>Math.abs(i.y-ball.y)>300);cars=[];sweepers=[];
  const s=makeSweeper();s.x=82;s.y=5005;sweepers.push(s);
  const p=makeItem('snail',79,5014);items.push(p);
  cars.push(makeCar('car',81,5006,24));
  return{ball:{x:ball.x,y:ball.y},sweeper:{x:s.x,y:s.y}};
};
// Pose-honesty telemetry: the drawn lean must track actual travel. Persistence
// counters, because honest yaw inertia is ALLOWED to lag a few frames through
// a lateral flip or a wobble — a cosmetic lean would sit wrong-signed for
// whole transits, which no persistence window forgives.
globalThis.__srPose={frames:0,wrongWayRun:0,wrongWayMax:0,wrongWayViolations:0,straightRun:0,crabViolations:0};
{const P=globalThis.__srPose,old=stepBall;stepBall=function(){const out=old();
  if(state!=='run'||ball.wobbleT>0||ball.contactT>0)return out; // wobbles and bump-shoves pose by their own rules
  P.frames++;
  const va=Math.atan2(ball.vx,Math.max(.5,ball.speed)),angle=ball.angle;
  const wrongWay=Math.abs(ball.vx)>.3&&Math.sign(angle)!==Math.sign(va)&&Math.abs(angle)>.06;
  P.wrongWayRun=wrongWay?P.wrongWayRun+1:0;P.wrongWayMax=Math.max(P.wrongWayMax,P.wrongWayRun);
  if(P.wrongWayRun>8)P.wrongWayViolations++;
  const straight=Math.abs(ball.vx)<.06&&Math.abs((ball.intent&&ball.intent.steer)||0)<.1;
  P.straightRun=straight?P.straightRun+1:0;
  if(P.straightRun>20&&Math.abs(angle-va)>.035)P.crabViolations++;
  return out;};}
// Scripted pose fixtures through the SHARED integrator: each one fails a
// cosmetic-lean build (steadyRight must lean INTO travel; release must
// straighten; a leftward steer must mirror it).
globalThis.__srPoseFixture=()=>{
  const drive=(b,intent,frames)=>{for(let i=0;i<frames;i++)
    advanceBall(b,Object.assign({steer:0,throttle:1,brake:false,tuck:false,dash:false,targetX:80,tactic:'FIXTURE'},intent),{});
    return{angle:b.angle,vx:b.vx,va:Math.atan2(b.vx,Math.max(.5,b.speed))};};
  const fresh=()=>{const b=makeBall(80,900);b.speed=2;return b;};
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
const policyScore=s=>s.maxD*s.maxD+s.stats.milestones*800+s.stats.stars*20000+s.stats.sweepersEaten*1500+
  s.stats.threads*40+s.stats.carsEaten*150+s.stats.rainCaught*60-s.stats.bumps*150-s.stats.shelfHits*120-
  s.stats.sweeperHits*300-Math.round(s.stats.hazardHits*.25);
const failures=s=>2*s.stats.bumps+3*s.stats.shelfHits+2*s.stats.sweeperHits;
const inBands=(s,bands,label)=>{for(const[key,[lo,hi]]of Object.entries(bands)){
  const value=key==='maxD'?s.maxD:s.stats[key];
  if(value<lo||value>hi)fail(`${label}: ${key} ${value} outside measured band ${lo}..${hi}`);
}};
function notePairs(notes,id,label,minPairs){
  let pairs=0,open=null;
  for(const n of notes){
    if(n.id!==id)continue;
    if(n.kind==='act-warning'){open=n;continue;}
    if(n.kind==='act-land'&&open){
      if(n.tag-open.tag!==240)fail(`${label}: ${id} simulation warning ${n.tag-open.tag}f != 240`);
      // Viewer time may only STRETCH past 240 (tier-3 slow-mo), never shrink.
      if(n.at-open.at<240)fail(`${label}: ${id} viewer warning ${n.at-open.at}f < 240`);
      pairs++;open=null;
    }
  }
  if(pairs<minPairs)fail(`${label}: ${id} produced ${pairs} warn/land pairs (floor ${minPairs})`);
}

// Registered 2026-07-17 from a fresh ten-seed paired five-minute window sweep
// (0x5f00 + i*37), planned-route cumulative extrema: pickups 467..735,
// milestones 8..15, streaks 22..37, chains 37..56, threads 3..10, shelves
// 24..26, shelfHits 8..14, bumps 38..72, scatters 46..110, sweeperHits 1..3,
// sweepersEaten 1..5, hazardHits 22..60, petsEaten 34..101, carsEaten 12..32,
// rainCaught 21..80, kingBonus 0..22, stars 1..2, fizzles 0, dashes 25..44,
// lapses 0..4, acts 3..4, actClears 2..3, dodges 10..18, flawless 0..0, grazes
// 14..28, contacts 0..85, zones 12..13, events 895..1206, progress 176..196,
// maxD 201..220, failures 120..179. ~15-25% margin.
const POLICY_BANDS={
  pickups:[375,885],milestones:[6,18],streaks:[17,45],chains:[28,68],threads:[2,13],shelves:[18,32],
  shelfHits:[6,18],bumps:[29,88],scatters:[35,135],sweeperHits:[0,5],sweepersEaten:[0,6],
  hazardHits:[17,74],petsEaten:[26,124],carsEaten:[9,39],rainCaught:[16,98],kingBonus:[0,28],
  stars:[1,3],fizzles:[0,1],dashes:[19,54],lapses:[0,5],acts:[2,5],actClears:[1,4],dodges:[7,23],
  flawless:[0,1],grazes:[10,34],contacts:[0,104],zones:[9,16],events:[720,1450],progress:[140,240],
  maxD:[190,265],failures:[95,220]
};
// Same sweep, __NO_ROUTE_PLAN baseline cumulative extrema: pickups 371..507,
// milestones 5..8, streaks 17..30, chains 30..44, threads 0..5, shelves 22..24,
// shelfHits 9..17, bumps 63..101, scatters 80..167, sweeperHits 1..6,
// sweepersEaten 1..5, hazardHits 48..87, petsEaten 10..42, carsEaten 0..15,
// rainCaught 15..69, kingBonus 3..33, stars 1..2, fizzles 0, dashes 2..6,
// lapses 0..4, acts 3..4, actClears 3..4, dodges 8..23, flawless 0..1, grazes
// 9..27, contacts 22..66, zones 10..12, events 760..907, progress 157..172,
// maxD 200..212, failures 169..245.
const REACTIVE_BANDS={
  pickups:[295,610],milestones:[4,10],streaks:[13,37],chains:[23,54],threads:[0,7],shelves:[17,29],
  shelfHits:[7,21],bumps:[48,124],scatters:[62,204],sweeperHits:[0,8],sweepersEaten:[0,6],
  hazardHits:[37,106],petsEaten:[7,52],carsEaten:[0,19],rainCaught:[11,84],kingBonus:[2,40],
  stars:[0,3],fizzles:[0,1],dashes:[1,8],lapses:[0,5],acts:[2,5],actClears:[2,5],dodges:[6,28],
  flawless:[0,2],grazes:[7,33],contacts:[17,80],zones:[7,15],events:[610,1090],progress:[122,210],
  maxD:[180,255],failures:[135,295]
};

// Measured 2026-07-17 from two independent ten-minute soaks (0x5200, 0x52d4):
// still 0s, quiet 2s, stall 3s, events 1789..1803, progress 340..348, runs
// 3..4, maxD 211..214, act pairs magnet [4..5,4..5] / king [2..3,2..3], tier3
// shown 5..9, lulls 69..135 / 92..201. Cumulative stat extrema below.
const SOAK_BANDS={
  pickups:[560,1100],milestones:[7,19],streaks:[26,62],chains:[42,94],threads:[8,19],shelves:[34,57],
  shelfHits:[13,22],bumps:[130,210],scatters:[135,215],sweeperHits:[3,8],sweepersEaten:[0,6],
  hazardHits:[115,185],petsEaten:[54,100],carsEaten:[18,36],rainCaught:[35,83],kingBonus:[26,47],
  stars:[1,4],fizzles:[0,1],dashes:[28,73],lapses:[0,5],acts:[4,10],actClears:[4,8],dodges:[28,48],
  flawless:[0,1],grazes:[17,28],contacts:[150,240],zones:[17,29],events:[1450,2150],progress:[265,425],
  maxD:[195,265]
};

// Motion-contract pace floors, measured 2026-07-17 over seed 0x6100 three-minute
// motion runs across builds: ball mean 1.79..3.06 px/f (dash frequency),
// sweepers 0.944..1.094 px/f. Floors keep ~15-20% margin under the minima.
const BALL_PACE_FLOOR=1.5,SWEEPER_PACE_FLOOR=.75;
const paceOf=run=>{const per=new Map();let prev=null;
  for(const s of run.samples){if(prev)for(const a of s.actors){const b=prev.actors.find(q=>q.id===a.id);if(!b)continue;
    const d=Math.hypot(a.x-b.x,a.y-b.y),t=per.get(a.id)||{d:0,f:0};t.d+=d;t.f+=run.step;per.set(a.id,t);}prev=s;}
  const sweep=[...per.entries()].filter(([id])=>id!=='ball').map(([,t])=>t.d/t.f),d=per.get('ball');
  return{ball:d?d.d/d.f:0,sweeperMean:sweep.length?sweep.reduce((a,b)=>a+b,0)/sweep.length:0,sweeperCount:sweep.length};};

console.log('1) fixed 60 Hz determinism, render parity, chunk parity, and finite renderer');
{
  const a=bootGame('star-roller',{seed:0x4e01,footer:FOOTER}),
    b=bootGame('star-roller',{seed:0x4e01,footer:FOOTER}),
    rendered=bootGame('star-roller',{seed:0x4e01,footer:FOOTER});
  a.frames(3600,false);b.frames(3600,false);const draws=rendered.frames(3600,true);
  const sa=a.sandbox.__starRollerSignature(),sb=b.sandbox.__starRollerSignature(),sr=rendered.sandbox.__starRollerSignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${draws.calls} draw calls`);
  if(sa!==sb)fail('same seed diverged at fixed 60 Hz');
  if(sa!==sr)fail('render traversal changed simulation state or RNG');
  if(!a.sandbox.__starRollerProbe().finite||!rendered.sandbox.__starRollerProbe().finite)fail('headless or rendered replay became non-finite');
  if(draws.calls<1000||!draws.byMethod.fillRect||!draws.byMethod.beginPath||!draws.byMethod.fillText)
    fail(`renderer was not genuinely exercised: ${JSON.stringify(draws.byMethod)}`);

  const mono=bootGame('star-roller',{seed:0x4e02,footer:FOOTER}),chunked=bootGame('star-roller',{seed:0x4e02,footer:FOOTER});
  mono.frames(2400,false);for(let i=0;i<240;i++)chunked.frames(10,false);
  const same=mono.sandbox.__starRollerSignature()===chunked.sandbox.__starRollerSignature();
  console.log(`  2,400 monolithic frames vs 240 x 10: ${same?'identical':'DIFFERENT'}`);
  if(!same)fail('headless batching changed fixed-step simulation');
}

console.log('2) route lookahead is pure, repeatable, RNG-inert, and uses the shared integrator');
{
  const planned=bootGame('star-roller',{seed:0x4e10,footer:FOOTER}),control=bootGame('star-roller',{seed:0x4e10,footer:FOOTER}),
    fixture=planned.sandbox.__starRollerPlannerFixture();
  const nextPlanned=planned.sandbox.__starRollerNextRandom(),nextControl=control.sandbox.__starRollerNextRandom();
  console.log(`  pure ${fixture.pure}; repeat ${fixture.repeat}; lane ${fixture.plan&&fixture.plan.targetX} score ${fixture.plan&&fixture.plan.score.toFixed(1)}; RNG ${nextPlanned.toFixed(8)}/${nextControl.toFixed(8)}`);
  if(!fixture.pure||!fixture.repeat||!fixture.finite||!fixture.plan||!Number.isFinite(fixture.plan.score))
    fail(`planner fixture regressed: ${JSON.stringify(fixture)}`);
  if(nextPlanned!==nextControl)fail('route planning consumed engine RNG for simulation-invisible work');
}

console.log('3) baseline-first route-policy A/B: ten paired five-minute seeds');
{
  let scoreWins=0,failureWins=0,starSum=[0,0];
  const agg={score:[0,0],failures:[0,0],pickups:[0,0],events:[0,0],progress:[0,0]};
  for(let i=0;i<10;i++){
    const seed=0x5f00+i*37,a=bootGame('star-roller',{seed,footer:FOOTER}),b=bootGame('star-roller',{seed,footer:FOOTER});
    b.sandbox.__NO_ROUTE_PLAN=1;a.frames(18000,false);b.frames(18000,false);
    const ca=a.sandbox.__srCumulative(),cb=b.sandbox.__srCumulative();
    const sa=policyScore(ca),sb=policyScore(cb),fa=failures(ca),fb=failures(cb);
    if(sa>sb)scoreWins++;if(fa<fb)failureWins++;
    starSum[0]+=ca.stats.stars;starSum[1]+=cb.stats.stars;
    agg.score[0]+=sa;agg.score[1]+=sb;agg.failures[0]+=fa;agg.failures[1]+=fb;
    agg.pickups[0]+=ca.stats.pickups;agg.pickups[1]+=cb.stats.pickups;
    agg.events[0]+=ca.stats.events;agg.events[1]+=cb.stats.events;
    agg.progress[0]+=ca.stats.progress;agg.progress[1]+=cb.stats.progress;
    inBands(ca,POLICY_BANDS,`seed ${seed.toString(16)} planned`);
    inBands(cb,REACTIVE_BANDS,`seed ${seed.toString(16)} reactive`);
    for(const[c,label]of[[ca,'planned'],[cb,'reactive']]){
      if(!a.sandbox.__starRollerProbe().finite||!b.sandbox.__starRollerProbe().finite)fail(`seed ${seed.toString(16)} ${label}: non-finite state`);
      if(c.stats.maxEventLull>360||c.stats.maxProgressLull>420)fail(`seed ${seed.toString(16)} ${label}: story lull ${c.stats.maxEventLull}/${c.stats.maxProgressLull}f`);
    }
    console.log(`  ${seed.toString(16)} ${a.sandbox.__starRollerProbe().persona.padEnd(10)} score ${Math.round(sa)}/${Math.round(sb)}, `+
      `stars ${ca.stats.stars}/${cb.stats.stars}, maxD ${Math.round(ca.maxD)}/${Math.round(cb.maxD)}, failures ${fa}/${fb}`);
  }
  console.log(`  ${scoreWins}/10 score wins; ${failureWins}/10 failure wins; score ${Math.round(agg.score[0])}/${Math.round(agg.score[1])}, `+
    `failures ${agg.failures[0]}/${agg.failures[1]}, stars ${starSum[0]}/${starSum[1]}`);
  if(scoreWins<7||failureWins<8)fail(`route plan did not win clearly enough (${scoreWins}/10 score, ${failureWins}/10 failures)`);
  // Measured 2026-07-17 sweep (lane-clustered rain-feast build): score 895727
  // vs 617462 (1.45x), failures 1401 vs 2149 (0.65x), stars 18 vs 11, score
  // wins 10/10, failure wins 10/10 across the ten paired seeds. The reactive
  // baseline still stars (adaptive content is honest food) but pays for it in
  // shelf/hazard churn and slower class progress.
  if(agg.score[0]<400000||agg.score[0]<agg.score[1]*1.25||agg.failures[0]>agg.failures[1]*.85||starSum[0]<starSum[1]+2)
    fail(`aggregate route-policy win regressed: ${JSON.stringify({score:agg.score.map(Math.round),failures:agg.failures,starSum})}`);
  if(agg.pickups[1]<2600||agg.events[1]<5600||agg.progress[1]<1100)
    fail(`__NO_ROUTE_PLAN baseline stopped honestly participating: ${JSON.stringify(agg)}`);
}

console.log('4) MAGNET RAIN and THE KING WATCHES change the world during an exact 240f warning');
for(const type of['magnet','king']){
  const seed=type==='magnet'?0x5010:0x5011,a=bootGame('star-roller',{seed,footer:FOOTER}),b=bootGame('star-roller',{seed,footer:FOOTER});
  a.sandbox.__starRollerActFixture(type);b.sandbox.__starRollerActFixture(type);b.sandbox.__NO_ACTS=1;
  const phys=sandbox=>sandbox.__srActWorld();
  if(phys(a.sandbox)!==phys(b.sandbox))fail(`${type}: paired act fixture did not start identical`);
  let first=-1,phase='';
  for(let frame=1;frame<=270;frame++){
    a.frames(1,false);b.frames(1,false);
    if(first<0&&phys(a.sandbox)!==phys(b.sandbox)){first=frame;phase=a.sandbox.__starRollerProbe().act.phase;}
  }
  const pa=a.sandbox.__starRollerProbe(),pb=b.sandbox.__starRollerProbe(),
    warn=pa.act.notes.find(n=>n.kind==='act-warning'),land=pa.act.notes.find(n=>n.kind==='act-land');
  console.log(`  ${type}: first physical divergence ${first}f in ${phase}; warning ${warn&&land?land.tag-warn.tag:'?'}f`);
  if(!warn||!land||land.tag-warn.tag!==240)fail(`${type}: warning/land pair was not exactly 240 frames`);
  if(warn&&land&&land.at-warn.at<240)fail(`${type}: viewer warning shrank below 240 frames`);
  if(first<1||first>=240||phase!=='warn')fail(`${type}: act did not physically change the world during warning`);
  if(pb.act.notes.length)fail(`${type}: __NO_ACTS emitted notes`);
}
{
  const game=bootGame('star-roller',{seed:0x5012,footer:FOOTER});game.sandbox.__starRollerActFixture('magnet');game.frames(100,false);
  game.sandbox.__srReset();game.frames(300,false);const p=game.sandbox.__starRollerProbe();
  if(p.act.phase!=='calm'||p.act.notes.some(n=>n.kind==='act-land'))fail('reset during act warning left a stale land');
}

console.log('5) human takeover shares the bot intent schema and runtime ball physics');
{
  const game=bootGame('star-roller',{seed:0x5020,footer:FOOTER}),initial=game.sandbox.__starRollerManual();
  press(game,'Enter');const instructions=game.sandbox.__starRollerManual();press(game,'Enter');const started=game.sandbox.__starRollerManual();
  const schema=game.sandbox.__starRollerIntentSchemas();game.sandbox.__srClearApplied();
  game.key('keydown','ArrowLeft');game.frames(5,false);game.key('keyup','ArrowLeft');const steer=game.sandbox.__srLastApplied();
  game.sandbox.__srClearApplied();game.key('keydown','ArrowUp');game.frames(4,false);game.key('keyup','ArrowUp');const throttle=game.sandbox.__srLastApplied();
  game.sandbox.__srClearApplied();game.key('keydown','Space');game.frames(2,false);game.key('keyup','Space');const dash=game.sandbox.__srLastApplied();
  console.log(`  playing ${initial.playing}->${instructions.playing}->${started.playing}; schema ${schema.humanKeys.join(',')}; steer ${steer&&steer.steer}, throttle ${throttle&&throttle.throttle}, dash ${dash&&dash.dash}`);
  if(initial.playing||instructions.playing||!started.playing)fail('manual session skipped the two-Enter gate');
  if(schema.humanKeys.join('|')!==schema.botKeys.join('|'))fail(`human/bot intent schemas differ: ${JSON.stringify(schema)}`);
  if(!steer||steer.steer!==-1||steer.tactic!=='MANUAL ROLL')fail('manual steering did not traverse runtime advanceBall');
  if(!throttle||throttle.throttle!==1||throttle.tactic!=='MANUAL ROLL')fail('manual throttle did not traverse runtime advanceBall');
  if(!dash||dash.dash!==true||dash.tactic!=='MANUAL ROLL')fail('manual dash did not traverse runtime advanceBall');
  if(!game.sandbox.__starRollerProbe().finite)fail('manual control produced non-finite state');
}

console.log('5b) every mapped key is responsive, and simultaneous presses compose in one intent');
{
  const game=bootGame('star-roller',{seed:0x5021,footer:FOOTER});
  press(game,'Enter');press(game,'Enter');
  if(!game.sandbox.__starRollerManual().playing)fail('keyboard fixtures need playing mode');
  const hold=(codes,frames)=>{for(const c of codes)game.key('keydown',c);game.frames(frames,false);
    const a=game.sandbox.__srLastApplied();for(const c of codes)game.key('keyup',c);game.sandbox.__srClearApplied();return a;};
  const checks=[
    ['ArrowLeft',{steer:-1}],['ArrowRight',{steer:1}],['ArrowUp',{throttle:1}],['ArrowDown',{brake:true}],
    ['Space',{dash:true}],['KeyX',{dash:true}],['KeyJ',{dash:true}],['KeyK',{dash:true}],
    ['KeyZ',{tuck:true}],['ShiftLeft',{tuck:true}],['ShiftRight',{tuck:true}]
  ];
  for(const[code,want]of checks){
    const a=hold([code],4);
    const ok=a&&Object.entries(want).every(([k,v])=>a[k]===v)&&a.tactic==='MANUAL ROLL';
    console.log(`  ${code.padEnd(11)} ${ok?'responds':'DEAD'} (steer ${a&&a.steer}, throttle ${a&&a.throttle}, brake ${a&&a.brake}, tuck ${a&&a.tuck}, dash ${a&&a.dash})`);
    if(!ok)fail(`key ${code} did not produce ${JSON.stringify(want)} in the applied intent`);
  }
  // Simultaneous chord: steer + throttle + dash + tuck in ONE applied intent.
  const chord=hold(['ArrowLeft','ArrowUp','Space','KeyZ'],5);
  const chordOk=chord&&chord.steer===-1&&chord.throttle===1&&chord.dash===true&&chord.tuck===true&&chord.tactic==='MANUAL ROLL';
  console.log(`  LEFT+UP+SPACE+Z chord: ${chordOk?'composed':'INTERFERED'} (${JSON.stringify(chord)})`);
  if(!chordOk)fail(`simultaneous keys interfered: ${JSON.stringify(chord)}`);
  // Opposing pairs cancel honestly, and keys stay responsive after chords.
  const oppose=hold(['ArrowLeft','ArrowRight'],4);
  if(!oppose||oppose.steer!==0)fail(`opposing arrows did not cancel: ${JSON.stringify(oppose)}`);
  const both=hold(['Space','KeyX'],4);
  if(!both||both.dash!==true)fail(`SPACE+X dash precedence broke: ${JSON.stringify(both)}`);
  const after=hold(['ArrowRight'],4);
  if(!after||after.steer!==1)fail('keys went dead after a chord');
  if(!game.sandbox.__starRollerProbe().finite)fail('keyboard storm produced non-finite state');
}

console.log('6) ten-minute soaks: rolling world, class ladder, sweepers, and exact SHOW budgets');
for(const seed of[0x5200,0x52d4]){
  const{game,samples}=runSoak('star-roller',{seed,minutes:10,footer:FOOTER}),report=analyzeSoak(samples),
    p=game.sandbox.__starRollerProbe(),show=p.show,offered=show.offeredByTier,shown=show.shownByTier,s3=shown[3]||0,
    cum=game.sandbox.__srCumulative(),continuity=game.sandbox.__srContinuity,notes=game.sandbox.__srActNotes();
  console.log(`  ${seed.toString(16)} ${soakLine(report)}; runs ${cum.runs}, maxD ${Math.round(cum.maxD)}, stars ${cum.stats.stars}, tiers ${JSON.stringify(shown)}`);
  assertSoak(seed.toString(16),report,{still:1,quiet:5,stall:5,minEvents:1200,minProgress:240},fail);
  inBands(cum,SOAK_BANDS,`seed ${seed.toString(16)} soak`);
  if(!p.finite)fail(`seed ${seed.toString(16)}: non-finite state`);
  if(continuity.max>3.6)fail(`seed ${seed.toString(16)}: unaccounted ${continuity.max.toFixed(2)}px one-step discontinuity`);
  notePairs(notes,'magnet',`seed ${seed.toString(16)}`,2);notePairs(notes,'king',`seed ${seed.toString(16)}`,2);
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
  const run=runMotion('star-roller',{seed,minutes,footer:FOOTER}),pace=paceOf(run);
  const ballReport=analyzeMotion({step:run.step,samples:run.samples.map(s=>Object.assign({},s,{actors:s.actors.filter(a=>a.id==='ball')}))},{});
  const castReport=analyzeMotion(run,{emoteFrames:160,emoteShare:.30,requiredIds:['ball']});
  console.log(`  ${seed.toString(16)} (${minutes}m) ball[${motionLine(ballReport)}] cast[${motionLine(castReport)}] · ball ${pace.ball.toFixed(3)} px/f · sweeper mean ${pace.sweeperMean.toFixed(3)} px/f over ${pace.sweeperCount} sweepers`);
  assertMotion(seed.toString(16)+' ball',ballReport,fail);
  assertMotion(seed.toString(16)+' cast',castReport,fail);
  if(run.samples.some(s=>!s.actors.some(a=>a.id==='ball')))fail(`${seed.toString(16)}: motion probe lost the ball`);
  if(pace.ball<BALL_PACE_FLOOR)fail(`${seed.toString(16)}: ball pace ${pace.ball.toFixed(3)} px/f under floor ${BALL_PACE_FLOOR}`);
  if(pace.sweeperMean<SWEEPER_PACE_FLOOR)fail(`${seed.toString(16)}: sweeper pace ${pace.sweeperMean.toFixed(3)} px/f under floor ${SWEEPER_PACE_FLOOR}`);
}
console.log('6c) __NO_EMOTE ablation re-proves the motion fix and stays sim-honest');
{
  const uncovered=analyzeMotion(runMotion('star-roller',{seed:0x613d,minutes:3,footer:'globalThis.__NO_EMOTE=1;'}),{});
  console.log(`  __NO_EMOTE violations ${uncovered.violations.length}`);
  if(!uncovered.violations.some(v=>/sweeper.*no emote/.test(v)))fail('__NO_EMOTE ablation: motion gate no longer requires authored emote coverage');
  const a=bootGame('star-roller',{seed:0x613d}),b=bootGame('star-roller',{seed:0x613d});
  b.sandbox.__NO_EMOTE=1;a.frames(18000,false);b.frames(18000,false);
  if(a.sandbox.__starRollerSignature()!==b.sandbox.__starRollerSignature())
    fail('__NO_EMOTE changed simulation state (emotes must be render/probe-only)');
}

console.log('6d) contact contract: overlaps resolve in frames, nobody rides through anybody');
{
  const game=bootGame('star-roller',{seed:0x5292,footer:FOOTER});
  const staged=game.sandbox.__srContactFixture();
  const before=game.sandbox.__srOverlapScan();
  game.frames(60,false);
  const after=game.sandbox.__srOverlapScan(),probe=game.sandbox.__starRollerProbe();
  console.log(`  staged hard overlap ${before} -> ${after} after 60f (contacts ${probe.stats.contacts}, sweeps ${probe.stats.sweeperHits})`);
  if(before<2)fail(`contact fixture did not stage overlapping bodies: ${JSON.stringify(staged)}`);
  if(after!==0)fail(`hard overlap survived the resolver: ${after} pairs after 60f`);
  for(const seed of[0x5293,0x5294]){
    const run=bootGame('star-roller',{seed,footer:FOOTER});run.frames(7200,false);
    const p=run.sandbox.__starRollerProbe(),o=run.sandbox.__srOverlap;
    console.log(`  ${seed.toString(16)}: worst overlap ${o.worst} pairs, longest ${o.maxRun}f; bumps ${p.stats.bumps}, grazes ${p.stats.grazes}`);
    if(o.worst>2)fail(`${seed.toString(16)}: ${o.worst} bodies hard-overlapped at once`);
    if(o.maxRun>8)fail(`${seed.toString(16)}: hard overlap persisted ${o.maxRun} frames (limit 8)`);
  }
}

{
  const game=bootGame('star-roller',{seed:0x5290,footer:FOOTER}),fixture=game.sandbox.__starRollerAdmireFixture();
  if(fixture.admired.tactic!=='SAVOR THE STAR'||fixture.gated.tactic==='SAVOR THE STAR')
    fail(`__NO_ADMIRE did not gate the bot-only coast: ${JSON.stringify(fixture)}`);
  const perfect=bootGame('star-roller',{seed:0x5291,footer:FOOTER});perfect.sandbox.__NO_LAPSE=1;perfect.frames(18000,false);
  if(perfect.sandbox.__starRollerProbe().stats.lapses!==0)fail('__NO_LAPSE did not eliminate skill-profile lapse onsets');
}

console.log('7) payoff FX is a perfect same-seed simulation no-op');
{
  const a=bootGame('star-roller',{seed:0x5300,footer:FOOTER}),b=bootGame('star-roller',{seed:0x5300,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);
  const same=a.sandbox.__starRollerSignature()===b.sandbox.__starRollerSignature(),p=a.sandbox.__starRollerProbe();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} through ${p.stats.events} events / ${p.stats.milestones} milestones`);
  if(!same)fail('__NO_PAYOFF_FX changed simulation state');
  if(p.stats.milestones<1)fail('FX no-op window did not exercise a milestone payoff');
}

console.log('8) drawn lean is honest: the ball tracks travel, never crabs');
{
  const fixture=bootGame('star-roller',{seed:0x6001,footer:FOOTER}).sandbox.__srPoseFixture();
  console.log(`  steadyRight angle ${fixture.steadyRight.angle.toFixed(3)} (vx ${fixture.steadyRight.vx.toFixed(3)}); `+
    `straighten angle ${fixture.straighten.angle.toFixed(4)}; steadyLeft angle ${fixture.steadyLeft.angle.toFixed(3)}`);
  if(!(fixture.steadyRight.vx>.2&&fixture.steadyRight.angle>.08))
    fail(`steady right steer must lean the ball INTO the travel direction: ${JSON.stringify(fixture.steadyRight)}`);
  if(!(Math.abs(fixture.straighten.angle)<.02&&Math.abs(fixture.straighten.vx)<.05))
    fail(`released steering must straighten the ball: ${JSON.stringify(fixture.straighten)}`);
  if(!(fixture.steadyLeft.vx<-.2&&fixture.steadyLeft.angle<-.08))
    fail(`steady left steer must lean the ball INTO the travel direction: ${JSON.stringify(fixture.steadyLeft)}`);
  for(const seed of[0x6100,0x613d]){
    const game=bootGame('star-roller',{seed,footer:FOOTER});game.frames(10800,false);
    const p=game.sandbox.__srPose;
    console.log(`  ${seed.toString(16)}: ${p.frames}f rolling · wrong-way runs max ${p.wrongWayMax} (viol ${p.wrongWayViolations}) · crab viol ${p.crabViolations}`);
    if(p.frames<4000)fail(`${seed.toString(16)}: pose telemetry lost the ball (${p.frames} frames)`);
    if(p.wrongWayViolations>0)fail(`${seed.toString(16)}: ball leaned AWAY from travel for >8 consecutive frames x${p.wrongWayViolations}`);
    if(p.crabViolations>0)fail(`${seed.toString(16)}: phantom crab while cruising straight x${p.crabViolations}`);
  }
}

console.log('9) feedback legibility: every good/bad sim event is visibly represented on screen');
{
  const config={frames:9000,poll:5,radius:26,perCategory:3,
    goodPalette:['#ffd166','#ffb02e','#67e8a2','#59d8f5','#fff3da'],badPalette:['#ff5d4f','#c92c3c','#ffffff'],
    signatureProbe:'__starRollerSignature'};
  const runs=[runFeedbackVisibility('star-roller',Object.assign({seed:0x5300},config)),
    runFeedbackVisibility('star-roller',Object.assign({seed:0x52d4},config))];
  for(const run of runs){
    const byKey={};for(const s of run.samples)byKey[s.key]=(byKey[s.key]||[]).concat(
      [`${s.changed}px sig${s.kind==='good'?s.goodPixels:s.badPixels}`]);
    console.log(`  ${run.seed.toString(16)}: ${Object.entries(run.counts).map(([k,v])=>`${k} x${v}`).join(', ')}`);
    console.log(`    samples: ${Object.entries(byKey).map(([k,v])=>`${k}[${v.join(' ')}]`).join(' ')}`);
  }
  console.log(`  ${feedbackLine(runs)}; signatures ${runs.every(r=>r.signaturesMatch)?'identical':'DIFFERENT'}`);
  assertFeedback('feedback',runs,{
    required:['good:pickup','good:chain','good:streak','good:milestone','good:thread','good:rain-catch','good:king-bonus',
      'bad:bump','bad:scatter','bad:sweeper-hit','bad:hazard-hit','bad:shelf-hit','bad:lapse'],
    minChanged:{default:12,'good:thread':6,'good:chain':6,'good:rain-catch':6,'good:king-bonus':6,'bad:scatter':6,'bad:lapse':6,'bad:shelf-hit':6},
    minSignature:{default:8,'good:thread':4,'good:chain':4,'good:rain-catch':4,'good:king-bonus':4,'bad:scatter':4,'bad:lapse':4,'bad:shelf-hit':4},
    maxInvisible:0
  },fail);
}

console.log(failed?'\nSTAR ROLLER EVAL FAILED':'\nSTAR ROLLER EVAL PASSED');
process.exit(failed?1:0);
