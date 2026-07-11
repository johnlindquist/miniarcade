#!/usr/bin/env node
'use strict';
const{bootGame}=require('./harness');

const FOOTER=`
globalThis.__rocketStats={goals:[0,0],demos:0,matches:0};
const __goal0=goal;goal=team=>{globalThis.__rocketStats.goals[team]++;return __goal0(team);};
const __demo0=demo;demo=(victim,by)=>{globalThis.__rocketStats.demos++;return __demo0(victim,by);};
const __over0=matchOver;matchOver=winner=>{globalThis.__rocketStats.matches++;return __over0(winner);};
globalThis.__probe=()=>({
  playing:playing(),state,clock,score:[...score],goals:[...globalThis.__rocketStats.goals],
  demos:globalThis.__rocketStats.demos,matches:globalThis.__rocketStats.matches,
  car:{x:cars[0].x,y:cars[0].y,vx:cars[0].vx,vy:cars[0].vy,boost:cars[0].boost,
    boosting:cars[0].boosting},
  profiles:cars.map(c=>c.profile?c.profile.id:null),salt:profileSalt,
  stats:cars.map(c=>({...c.stats})),
  finite:[ball,...cars].every(o=>['x','y','vx','vy'].every(k=>Number.isFinite(o[k])))&&
    cars.every(c=>Number.isFinite(c.a)&&Number.isFinite(c.boost))
});
globalThis.__sig=()=>JSON.stringify([Math.round(ball.x*100),Math.round(ball.y*100),
  ...cars.map(c=>[Math.round(c.x*100),Math.round(c.y*100),Math.round(c.a*100),c.dead]),score]);
globalThis.__padFixture=big=>{
  resetGame();state='play';
  const p=pads[big?6:0],c=cars[1];
  Object.assign(c,{x:p.x,y:p.y,vx:0,vy:0,boost:0,dead:0,launch:0});p.t=0;
  carStep(c);return{boost:c.boost,cooldown:p.t,big:p.big};
};
globalThis.__goalFixture=()=>{
  resetGame();state='play';Object.assign(ball,{x:80,y:FL.y0-11,vx:0,vy:-1});ballStep();
  return{score:[...score],state,launch:cars.map(c=>c.launch)};
};
globalThis.__wiggleFixture=()=>{
  // build a committed right slide, then slam full opposite lock: a sliding
  // car carries yaw inertia — the tail must NOT whip instantly to the left
  resetGame();state='play';
  const c=cars[0];
  Object.assign(c,{x:80,y:180,vx:2.2,vy:0,a:0,boost:60,dead:0,launch:0,
    drift:0,av:0,avLast:0,wasDrifting:false});
  for(let i=0;i<12;i++)advanceCar(c,{steer:1,throttle:1,boosting:false,drifting:true});
  const avPeak=c.av;
  for(let i=0;i<8;i++)advanceCar(c,{steer:-1,throttle:1,boosting:false,drifting:true});
  return{avPeak,avAfter:c.av};
};
globalThis.__predictFixture=()=>{
  resetGame();state='countdown'; // countdown: ballStep never fires goal()
  Object.assign(ball,{x:40,y:60,vx:2.1,vy:-1.9,trail:[]});
  const p=predictBall(30);
  for(let i=0;i<30;i++)ballStep();
  return{err:Math.hypot(p.x-ball.x,p.y-ball.y)};
};`;

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};

console.log('1) autonomous league: 3 x 6 simulated minutes');
for(let run=1;run<=3;run++){
  const game=bootGame('rocket',{seed:0x710000+run,footer:FOOTER});
  game.frames(21600,false);const p=game.sandbox.__probe(),total=p.goals[0]+p.goals[1];
  const sum=k=>p.stats.reduce((a,s)=>a+s[k],0);
  const ds=sum('driftStarts'),bo=sum('driftBoostOuts'),att=sum('demoAttempts'),lp=sum('lapses');
  const lu=sum('lineupDrifts'),lt=sum('lineupTouches');
  const ws=sum('wallSaves'),wc=sum('wallCrashes');
  const share=sum('hardTurnDrifts')/Math.max(1,sum('hardTurns'));
  console.log(`  run ${run}: ${p.goals[0]}-${p.goals[1]} goals, ${p.matches} matches, ${p.demos} demos, `+
    `${ds} drifts (${bo} boost-outs, ${lu} line-ups -> ${lt} touches, ${ws} wall saves), `+
    `${att} hunts, ${wc} wall crashes, ${(share*100).toFixed(0)}% hard turns drifted `+
    `[${p.profiles.join(',')}]`);
  if(!p.finite)fail(`run ${run}: non-finite ball or car state`);
  if(p.matches<1||p.matches>3)fail(`run ${run}: ${p.matches} completed matches (expected 1..3)`);
  if(p.goals[0]<2||p.goals[1]<2)fail(`run ${run}: one team failed to score competently`);
  if(total<10||total>30)fail(`run ${run}: ${total} goals outside watchable band 10..30`);
  if(p.demos<2||p.demos>20)fail(`run ${run}: ${p.demos} demos outside watchable band 2..20`);
  // floors from the 12-seed sweep (2026-07-11, slide-inertia sim): drifts
  // 1022..1220, boost-outs 296..376, demos 4..14 — wide margins
  if(ds<500)fail(`run ${run}: only ${ds} drift starts (sweep floor 500)`);
  if(bo<150)fail(`run ${run}: only ${bo} drift boost-outs (sweep floor 150)`);
  // strategic drifting: swing around the ball onto the shot line. 12-seed
  // sweep 2026-07-11: 94..136 line-ups, 19..31 converted to a touch <55f
  // after the catch — floors at roughly half the observed minima
  if(lu<40)fail(`run ${run}: only ${lu} line-up drifts (sweep floor 40) — bots stopped using drift to get behind the ball`);
  if(lt<8)fail(`run ${run}: only ${lt} line-up drifts converted to a touch (sweep floor 8)`);
  // cornering skill is a release gate: drift is THE fast-turn tool (12-seed
  // sweep: 55..59% of hard turns drifted, 250..350 wall saves) and fast
  // head-on wall impacts stay capped (sweep 175..212; pre-cornering 319..380)
  if(share<0.40)fail(`run ${run}: only ${(share*100).toFixed(0)}% of hard turns drifted (floor 40%)`);
  if(ws<120)fail(`run ${run}: only ${ws} wall-save drifts (sweep floor 120)`);
  if(wc>300)fail(`run ${run}: ${wc} fast wall crashes (ceiling 300) — bots are pounding the boards again`);
  if(att<2)fail(`run ${run}: only ${att} demo hunts committed (floor 2)`);
  if(lp<5||lp>600)fail(`run ${run}: ${lp} lapse frames outside 5..600 seasoning band`);
  if(new Set(p.profiles).size!==4)fail(`run ${run}: profiles not all distinct (${p.profiles})`);
}

console.log('2) mechanics: small/big pads, goal blast, prediction fidelity');
let game=bootGame('rocket',{seed:0x710100,footer:FOOTER});
const small=game.sandbox.__padFixture(false),big=game.sandbox.__padFixture(true),goalFx=game.sandbox.__goalFixture();
const predict=game.sandbox.__predictFixture();
console.log(`  pads +${small.boost}/${small.cooldown}f and +${big.boost}/${big.cooldown}f; goal launch ${goalFx.launch.join(',')}; `+
  `30f prediction error ${predict.err.toFixed(4)}px`);
if(predict.err>0.001)fail(`predictBall drifted ${predict.err.toFixed(3)}px from real ball physics over 30 frames`);
if(small.boost!==12||small.cooldown!==300||small.big!==0)fail('small boost pad contract regressed');
if(big.boost!==100||big.cooldown!==600||big.big!==1)fail('big boost pad contract regressed');
if(goalFx.score[0]!==1||goalFx.score[1]!==0||goalFx.state!=='goal')fail('top-goal scoring contract regressed');
if(goalFx.launch.some(t=>t!==80))fail('goal blast did not launch every active car');

console.log('3) session + manual drive: two-stage Enter, steering and boost');
game=bootGame('rocket',{seed:0x710200,footer:FOOTER});
if(game.sandbox.__probe().playing)fail('session started in playing mode');
press(game,'Enter');if(game.sandbox.__probe().playing)fail('first Enter skipped instructions');
press(game,'Enter');if(!game.sandbox.__probe().playing)fail('second Enter did not start play');
game.frames(120,false);const before=game.sandbox.__probe();
game.key('keydown','ArrowUp');game.key('keydown','ArrowRight');game.key('keydown','Space');
game.frames(30,false);
game.key('keyup','ArrowUp');game.key('keyup','ArrowRight');game.key('keyup','Space');
const after=game.sandbox.__probe(),travel=Math.hypot(after.car.x-before.car.x,after.car.y-before.car.y);
console.log(`  drove ${travel.toFixed(1)}px, boost ${before.car.boost.toFixed(1)} -> ${after.car.boost.toFixed(1)}`);
if(before.state!=='play')fail(`manual test never reached live play (${before.state})`);
if(travel<10)fail(`manual throttle/steering moved only ${travel.toFixed(1)}px`);
if(after.car.boost>=before.car.boost||!after.car.boosting)fail('manual boost was not applied');
if(!after.finite)fail('manual drive produced non-finite state');

console.log('4) crosswind act + show ladder: telegraphed, wind-true, bots pre-position');
{
  const FOOT=`
;globalThis.__wind=()=>({phase:windPhase,dir:windDir,ax:windAx});
globalThis.__showP=()=>SHOW.probe();globalThis.__showE=()=>SHOW.events();
globalThis.__cars=()=>cars.map(c=>[Math.round(c.x*10),Math.round(c.y*10)]);
globalThis.__goals={t:0};const __g1=goal;goal=t=>{globalThis.__goals.t++;return __g1(t);};`;
  const a=bootGame('rocket',{seed:0x710602,footer:FOOT});
  const b=bootGame('rocket',{seed:0x710602,footer:FOOT});
  b.sandbox.__NO_ACTS=1;
  let warnSamples=0,liveSamples=0,warnAxLeak=false,divergedInWarn=false;
  for(let f=0;f<21600;f+=30){
    a.frames(30,false);b.frames(30,false);
    const w=a.sandbox.__wind();
    if(w.phase==='warn'){warnSamples++;if(w.ax!==0)warnAxLeak=true;
      if(JSON.stringify(a.sandbox.__cars())!==JSON.stringify(b.sandbox.__cars()))divergedInWarn=true;}
    else if(w.phase==='live')liveSamples++;
  }
  const ev=a.sandbox.__showE(),p=a.sandbox.__showP();
  const winds=[];let pendWind=null;
  for(const e of ev){
    if(e.kind==='act-warning'&&e.id==='wind')pendWind=e;
    else if(e.kind==='act-land'&&e.id==='wind'&&pendWind){
      winds.push({t:e.tag-pendWind.tag,frames:e.frame-pendWind.frame});pendWind=null;}
  }
  console.log(`  ${winds.length} wind acts landed (telegraphs ${winds.map(x=>x.t).join(',')} match-frames), `+
    `warn/live samples ${warnSamples}/${liveSamples}, goals A ${a.sandbox.__goals.t} vs no-acts B ${b.sandbox.__goals.t}`);
  console.log(`  ladder: opportunities ${JSON.stringify(p.offeredByTier)}, presented ${JSON.stringify(p.shownByTier)}, `+
    `slow-mo ${p.slowedFrames}f over ${p.shownByTier[3]||0} goal replays`);
  if(winds.length<2)fail(`only ${winds.length} telegraphed wind acts landed in 6 minutes`);
  for(const x of winds){
    if(x.t<180||x.t>300)fail(`wind telegraph ${x.t} match-frames outside 180..300`);
    if(x.frames<x.t)fail(`wind landed after only ${x.frames} wall frames (< ${x.t} planned)`);
  }
  if(warnSamples<4)fail(`warning phase barely observable (${warnSamples} samples)`);
  if(warnAxLeak)fail('wind force applied during the warning phase — telegraph must not strike early');
  if(!divergedInWarn)fail('bots ignored the crosswind warning: no pre-positioning before landfall');
  if(a.sandbox.__goals.t<10||a.sandbox.__goals.t>30)fail(`goals with acts ${a.sandbox.__goals.t} outside 10..30`);
  if(b.sandbox.__goals.t<10||b.sandbox.__goals.t>30)fail(`goals without acts ${b.sandbox.__goals.t} outside 10..30`);
  const o=p.offeredByTier;
  if(!((o[1]||0)>(o[2]||0)&&(o[1]||0)>(o[3]||0)))fail(`tier-1 opportunities not dominant (${JSON.stringify(o)})`);
  if((p.shownByTier[3]||0)<1)fail('no goal replay presented through the kernel');
  const goals3=p.shownByTier[3]||0;
  if(Math.abs(p.slowedFrames-84*goals3)>2*goals3+4)
    fail(`goal slow-mo ${p.slowedFrames}f drifted from the 84f-per-goal contract (${goals3} goals)`);
  if(p.heldFrames!==0)fail(`unexpected world holds (${p.heldFrames}f)`);
}
{
  const FOOT=';globalThis.__sig=()=>Math.round(ball.x*997+ball.y*31)+cars.reduce((s,c)=>s+Math.round(c.x*13+c.y*7),0)+score[0]*1e6+score[1]*2e6;';
  const a=bootGame('rocket',{seed:0x710611,footer:FOOT});
  const b=bootGame('rocket',{seed:0x710611,footer:FOOT});
  b.sandbox.__NO_PAYOFF_FX=1;
  a.frames(10800,false);b.frames(10800,false);
  if(a.sandbox.__sig()!==b.sandbox.__sig())fail('__NO_PAYOFF_FX changed the sim: goal confetti leaked into gameplay');
  else console.log('  __NO_PAYOFF_FX: sim signatures identical over 3 minutes');
}

console.log('6) power drift: physics fixture + same-seed A/B vs __NO_DRIFT');
{
  const FOOT=FOOTER+`
;globalThis.__driftFixture=useDrift=>{
  resetGame();state='play';
  const c=cars[0];
  Object.assign(c,{x:60,y:180,a:0,vx:2,vy:0,boost:100,dead:0,launch:0,drift:0,slip:0});
  const a0=c.a,x0=c.x,y0=c.y;let peakSlip=0;
  for(let i=0;i<30;i++){ // 15f committed turn, then 15f catch-and-drive-out
    const turning=i<15;
    advanceCar(c,{steer:turning?1:0,throttle:1,boosting:false,drifting:useDrift&&turning});
    peakSlip=Math.max(peakSlip,Math.abs(c.slip));
  }
  return{heading:Math.abs(angDiff(c.a-a0)),peakSlip,
    speed:Math.hypot(c.vx,c.vy),disp:Math.hypot(c.x-x0,c.y-y0),skid:c.skid.length,
    finite:['x','y','vx','vy','a'].every(k=>Number.isFinite(c[k]))};
};`;
  const g=bootGame('rocket',{seed:0x710300,footer:FOOT});
  const base=g.sandbox.__driftFixture(false),drift=g.sandbox.__driftFixture(true);
  console.log(`  30f full-lock turn: heading ${base.heading.toFixed(2)} -> ${drift.heading.toFixed(2)} rad, `+
    `slip ${drift.peakSlip.toFixed(2)} rad, speed ${base.speed.toFixed(2)} -> ${drift.speed.toFixed(2)}, `+
    `travel ${drift.disp.toFixed(1)}px`);
  if(!base.finite||!drift.finite)fail('drift fixture produced non-finite state');
  if(drift.heading<base.heading+0.35)fail(`drift turned only ${drift.heading.toFixed(2)} rad vs base ${base.heading.toFixed(2)} — rear grip never broke`);
  if(drift.peakSlip<0.30)fail(`peak slip ${drift.peakSlip.toFixed(2)} rad under 0.30 — no visible tail-out`);
  // measured 2026-07-11: drift turns +0.80 rad over the grip turn while
  // keeping 87% speed (2.00 vs 2.30) — the rotate-faster/carry-speed tradeoff
  if(drift.speed<base.speed*0.80||drift.speed<1.85)
    fail(`drift bled speed to ${drift.speed.toFixed(2)} (base ${base.speed.toFixed(2)}) — momentum not carried through the slide`);
  if(drift.speed>base.speed*1.05)fail(`drift GAINED speed ${drift.speed.toFixed(2)} vs ${base.speed.toFixed(2)} — release must not invent velocity`);
  if(drift.disp<35)fail(`drift displaced only ${drift.disp.toFixed(1)}px — reads as spinning in place`);
  if(drift.skid<10)fail(`drift laid only ${drift.skid} skid samples — the rear-swing arc is invisible`);
  if(base.skid!==0)fail(`grip driving deposited ${base.skid} skid samples — rubber must mean drift`);
  g.sandbox.__NO_DRIFT=1;
  const offA=g.sandbox.__driftFixture(false),offB=g.sandbox.__driftFixture(true);
  if(JSON.stringify(offA)!==JSON.stringify(offB))fail('__NO_DRIFT did not make the drifting intent a physics no-op');
  delete g.sandbox.__NO_DRIFT;
  // same-seed A/B: drift bot vs ablated bot must diverge during live play,
  // and the ablated run must never record a drift start
  const a=bootGame('rocket',{seed:0x710301,footer:FOOTER});
  const b=bootGame('rocket',{seed:0x710301,footer:FOOTER});
  b.sandbox.__NO_DRIFT=1;
  a.frames(21600,false);b.frames(21600,false);
  const pa=a.sandbox.__probe(),pb=b.sandbox.__probe();
  const sum=(p,k)=>p.stats.reduce((s2,s)=>s2+s[k],0);
  console.log(`  A/B: drift run ${sum(pa,'driftStarts')} starts / ${sum(pa,'driftBoostOuts')} boost-outs, `+
    `ablated ${sum(pb,'driftStarts')} starts; diverged ${a.sandbox.__sig()!==b.sandbox.__sig()}`);
  if(sum(pa,'driftStarts')<250)fail('drift-enabled bots barely drifted in the A/B run');
  if(sum(pb,'driftStarts')!==0||sum(pb,'driftBoostOuts')!==0)fail('__NO_DRIFT run still recorded drift activity');
  if(a.sandbox.__sig()===b.sandbox.__sig())fail('drift A/B runs never diverged — the feature is simulation-invisible');
  if(!pb.finite)fail('__NO_DRIFT run went non-finite');
  // line-up ablation: __NO_LINEUP removes ONLY the strategic swing-behind-the-
  // ball drift; reactive turn/kickoff drifts must survive
  const c2=bootGame('rocket',{seed:0x710301,footer:FOOTER});
  c2.sandbox.__NO_LINEUP=1;
  c2.frames(21600,false);
  const pc=c2.sandbox.__probe();
  console.log(`  line-up A/B: full ${sum(pa,'lineupDrifts')} line-ups -> ${sum(pa,'lineupTouches')} touches; `+
    `__NO_LINEUP ${sum(pc,'lineupDrifts')} line-ups, ${sum(pc,'driftStarts')} other drifts`);
  if(sum(pa,'lineupDrifts')<40||sum(pa,'lineupTouches')<8)
    fail('strategic line-up drifting under-fired on the A/B seed');
  if(sum(pc,'lineupDrifts')!==0||sum(pc,'lineupTouches')!==0)
    fail('__NO_LINEUP run still recorded line-up drifts');
  if(sum(pc,'driftStarts')===0)fail('__NO_LINEUP wrongly disabled ALL drifting');
  if(a.sandbox.__sig()===c2.sandbox.__sig())fail('line-up drifting never changed the sim on its A/B seed');
  // cornering ablation: __NO_CORNERING restores the pre-cornering policy
  // (high drift entry, near-wall suppression, no wall saves, no arrival
  // braking). The full bot must drift a larger share of its hard turns AND
  // crash into walls measurably less on the same seed.
  const d2=bootGame('rocket',{seed:0x710301,footer:FOOTER});
  d2.sandbox.__NO_CORNERING=1;
  d2.frames(21600,false);
  const pd=d2.sandbox.__probe();
  const shr=p=>sum(p,'hardTurnDrifts')/Math.max(1,sum(p,'hardTurns'));
  console.log(`  cornering A/B: full ${(shr(pa)*100).toFixed(0)}% hard turns drifted / `+
    `${sum(pa,'wallCrashes')} wall crashes; __NO_CORNERING ${(shr(pd)*100).toFixed(0)}% / `+
    `${sum(pd,'wallCrashes')} crashes, ${sum(pd,'wallSaves')} wall saves`);
  if(shr(pa)<shr(pd)+0.10)
    fail(`cornering did not raise the hard-turn drift share (${(shr(pa)*100).toFixed(0)}% vs ${(shr(pd)*100).toFixed(0)}%)`);
  if(sum(pa,'wallCrashes')>sum(pd,'wallCrashes')*0.85)
    fail(`cornering did not cut wall crashes (${sum(pa,'wallCrashes')} vs ${sum(pd,'wallCrashes')})`);
  if(sum(pd,'wallSaves')!==0)fail('__NO_CORNERING run still recorded wall-save drifts');
  if(a.sandbox.__sig()===d2.sandbox.__sig())fail('cornering never changed the sim on its A/B seed');
  if(!pd.finite)fail('__NO_CORNERING run went non-finite');
  // slide inertia (owner directive 2026-07-11): a drifting car is a sliding
  // mass — no instant tail wiggle. Fixture: 12f committed right slide, then
  // 8f of full opposite lock; the yaw rate must not have fully reversed.
  const wf=bootGame('rocket',{seed:0x710302,footer:FOOTER});
  const wiggle=wf.sandbox.__wiggleFixture();
  wf.sandbox.__NO_SLIDE_INERTIA=1;
  const whip=wf.sandbox.__wiggleFixture();
  console.log(`  slide inertia: committed slide yaw ${wiggle.avPeak.toFixed(3)}, after 8f counter-steer `+
    `${wiggle.avAfter.toFixed(3)} (instant-yaw model: ${whip.avAfter.toFixed(3)})`);
  if(wiggle.avPeak<0.05)fail(`committed slide only reached yaw ${wiggle.avPeak.toFixed(3)} — handbrake bite missing`);
  if(wiggle.avAfter<-0.04)fail(`counter-steer whipped the tail to ${wiggle.avAfter.toFixed(3)} in 8 frames — sliding body must carry yaw inertia`);
  if(whip.avAfter>-0.05)fail('__NO_SLIDE_INERTIA did not restore the instant-yaw model');
  // run-level: committed slides rarely reverse yaw mid-drift
  const e2=bootGame('rocket',{seed:0x710301,footer:FOOTER});
  e2.sandbox.__NO_SLIDE_INERTIA=1;
  e2.frames(21600,false);
  const pe=e2.sandbox.__probe();
  console.log(`  mid-slide yaw flips over 6 min: ${sum(pa,'slideFlips')} with inertia vs `+
    `${sum(pe,'slideFlips')} instant`);
  if(sum(pa,'slideFlips')*2>sum(pe,'slideFlips'))
    fail(`slide inertia did not cut mid-drift yaw wiggle (${sum(pa,'slideFlips')} vs ${sum(pe,'slideFlips')})`);
  if(a.sandbox.__sig()===e2.sandbox.__sig())fail('slide inertia never changed the sim on its A/B seed');
}

console.log('7) personalities: deterministic assignment + measured divergence');
{
  const boot=seed=>{const g=bootGame('rocket',{seed,footer:FOOTER});g.frames(1,false);return g;};
  const a=boot(0x710400),b=boot(0x710400);
  const pa=a.sandbox.__probe(),pb=b.sandbox.__probe();
  console.log(`  seed 0x710400 -> [${pa.profiles.join(',')}] salt ${pa.salt}`);
  if(JSON.stringify(pa.profiles)!==JSON.stringify(pb.profiles)||pa.salt!==pb.salt)
    fail('same seed produced different profile assignments');
  if(new Set(pa.profiles).size!==4)fail('the four aggression levels are not all present');
  const orders=new Set();
  for(let i=0;i<6;i++)orders.add(boot(0x710410+i).sandbox.__probe().profiles.join(','));
  if(orders.size<2)fail(`6 seeds produced only ${orders.size} profile ordering — assignment is not random`);
  const legacy=bootGame('rocket',{seed:0x710400,footer:FOOTER});
  legacy.sandbox.__NO_PROFILES=1;legacy.frames(7200,false);
  const pl=legacy.sandbox.__probe();
  if(pl.profiles.some(id=>id!=='LEGACY'))fail(`__NO_PROFILES still assigned personalities (${pl.profiles})`);
  if(pl.stats.reduce((s2,s)=>s2+s.lapses,0)!==0)fail('__NO_PROFILES run recorded skill lapses');
  // forced-profile A/B on one seed: swap ONLY car 0 between the two extremes
  // (everyone else pinned) and require measurably different appetites
  const FORCE=FOOTER+`
;globalThis.__forceCar0=id=>{
  const apply=()=>{const specs=[id,'BALANCED','PRESSER','BALANCED'];
    cars.forEach((c,i)=>{const p=BOT_PROFILES[specs[i]];
      c.profile=p;
      c.skill=AI.skillProfile({...p.skill,rng:AI.createRng(AI.hashSeed('force:'+i+':'+p.id))});});};
  apply();
  const a0=assignProfiles;assignProfiles=()=>{a0();apply();};
};`;
  const runForced=(id,seed)=>{
    const g=bootGame('rocket',{seed,footer:FORCE});
    g.frames(1,false);g.sandbox.__forceCar0(id);g.frames(21600,false);
    return g.sandbox.__probe().stats[0];
  };
  const combine=id=>[0x710420,0x710421].map(s2=>runForced(id,s2))
    .reduce((a2,s)=>({starts:a2.starts+s.challengeStarts,dist:a2.dist+s.challengeDistanceSum,
      boost:a2.boost+s.boostFrames,hunts:a2.hunts+s.demoAttempts}),{starts:0,dist:0,boost:0,hunts:0});
  const rot=combine('ROTATOR'),man=combine('MANIAC');
  const cd=s=>s.starts?s.dist/s.starts:0;
  console.log(`  car0 over 2 seeds — ROTATOR: ${rot.starts} challenges (mean ${cd(rot).toFixed(1)}px), `+
    `boost ${rot.boost}f, hunts ${rot.hunts} | MANIAC: ${man.starts} challenges (mean ${cd(man).toFixed(1)}px), `+
    `boost ${man.boost}f, hunts ${man.hunts}`);
  // measured 2026-07-11 (2 seeds): MANIAC 108 challenges / 8468 boost frames /
  // 32 hunts vs ROTATOR 44 / 2688 / 0 — count and appetite carry the contrast;
  // mean challenge DISTANCE barely separates (the near-goal emergency clause
  // dominates both), so it stays telemetry, not a contract
  if(rot.hunts!==0)fail('ROTATOR committed demo hunts — demoSeek 0 must mean zero intent');
  if(man.hunts<2)fail(`MANIAC committed only ${man.hunts} demo hunts over 2 forced seeds`);
  if(man.boost<rot.boost*1.5)
    fail(`MANIAC boost appetite ${man.boost}f not >=1.5x ROTATOR ${rot.boost}f`);
}

console.log('8) demolitions v2: impact geometry, respawn contract, legacy branch');
{
  const FOOT=FOOTER+`
;globalThis.__demoFixture=kind=>{
  resetGame();state='play';
  const a=cars[0],v=cars[2];
  for(const c of cars)Object.assign(c,{vx:0,vy:0,dead:0,launch:0,demoImmune:0,respawn:null,boost:60});
  cars[1].x=30;cars[1].y=300;cars[3].x=130;cars[3].y=60; // park the others
  Object.assign(a,{x:40,y:120,a:0,vx:2.7,vy:0}); // clear of the kickoff ball
  Object.assign(v,{x:49,y:120,a:Math.PI/2,vx:0,vy:0});
  if(kind==='slow')a.vx=2.4;
  if(kind==='sideswipe'){a.vx=0;a.vy=2.7;}
  if(kind==='headon')v.vx=-2.7;
  if(kind==='immune')v.demoImmune=10;
  if(kind==='goalstate')state='goal';
  for(const c of cars)c.sup=Math.hypot(c.vx,c.vy)>2.5; // legacy rules read the flag
  const ballBefore=JSON.stringify([ball.x,ball.y,ball.vx,ball.vy]);
  collisions();
  const out={aDead:a.dead,vDead:v.dead,aVx:a.vx,vImmune:v.demoImmune,
    ballSame:ballBefore===JSON.stringify([ball.x,ball.y,ball.vx,ball.vy])};
  if(kind==='respawn'){
    state='play';
    let latchAt=-1;
    for(let i=0;i<130;i++){const before=v.respawn;carStep(v);
      if(!before&&v.respawn)latchAt=v.dead;}
    out.latchAt=latchAt;out.back={x:v.x,y:v.y,dead:v.dead,boost:v.boost,immune:v.demoImmune};
  }
  if(kind==='kickoff'){ // mid-telegraph demolition swept up by a goal reset
    v.dead=20;v.respawn={x:0,y:0,a:0};v.demoImmune=9;
    kickoffPos();out.after={dead:v.dead,respawn:v.respawn,immune:v.demoImmune};
  }
  return out;
};`;
  const g=bootGame('rocket',{seed:0x710450,footer:FOOT});
  const F=k=>g.sandbox.__demoFixture(k);
  const valid=F('valid');
  if(valid.vDead!==130)fail(`clean supersonic hit did not demolish (dead ${valid.vDead})`);
  if(valid.aVx!==2.7)fail(`demoer velocity changed (${valid.aVx}) — the attacker must keep rolling`);
  if(!valid.ballSame)fail('a demolition mutated the ball');
  if(F('slow').vDead!==0)fail('sub-threshold hit (2.4) demolished — speed gate broken');
  if(F('sideswipe').vDead!==0)fail('zero-closing side contact demolished — facing/closing gate broken');
  const ho=F('headon');
  if((ho.aDead>0)===(ho.vDead>0))fail(`head-on supersonic tie must demolish exactly one car (a:${ho.aDead} v:${ho.vDead})`);
  if(F('immune').vDead!==0)fail('respawn immunity did not block a re-demo');
  if(F('goalstate').vDead!==0)fail('a demo fired during the goal replay — demos are live-play only');
  const rs=F('respawn');
  if(rs.latchAt!==30)fail(`respawn telegraph latched at dead=${rs.latchAt}, expected 30`);
  if(rs.back.dead!==0||rs.back.boost!==34||rs.back.immune!==75)
    fail(`respawn contract broke (dead ${rs.back.dead}, boost ${rs.back.boost}, immunity ${rs.back.immune})`);
  if(rs.back.y>120)fail(`orange victim respawned at y=${rs.back.y.toFixed(0)} — outside its defensive third`);
  const ko=F('kickoff');
  if(ko.after.dead!==0||ko.after.respawn!==null||ko.after.immune!==0)
    fail('kickoffPos left stale demo state — goal replays could strand a dead car');
  console.log(`  geometry gates hold; telegraph at 30f, back with 34 boost + 75f immunity; kickoff scrubs state`);
  const lg=bootGame('rocket',{seed:0x710450,footer:FOOT});
  lg.sandbox.__NO_DEMOS=1;
  const lv=lg.sandbox.__demoFixture('valid');
  if(lv.vDead!==130)fail('legacy sup-vs-non-sup demo lost under __NO_DEMOS');
  if(lg.sandbox.__demoFixture('headon').vDead!==0)
    fail('legacy branch demolished a supersonic victim — old rules must survive under __NO_DEMOS');
  console.log('  __NO_DEMOS reproduces the legacy supersonic-only rules');
}

console.log('9) motion contract: no dead standing, measured pace');
{
  const{runMotion,analyzeMotion,assertMotion,motionLine}=require('./motion');
  const MFOOT=FOOTER+`
;globalThis.__motionProbe=()=>({
  // cars are watched in EVERY state: countdown is an authored emote pause
  // (115f, inside the 120f budget), goal launches them, and the match-over
  // beat runs victory donuts / the sulk crawl home — never a frozen strip
  actors:cars.filter(c=>c.dead<=0).map(c=>({id:'car-'+c.i,x:c.x,y:c.y,
    emote:state==='countdown'})),
  finite:[ball,...cars].every(o=>['x','y','vx','vy'].every(k=>Number.isFinite(o[k])))
});`;
  const run=runMotion('rocket',{seed:0x710460,footer:MFOOT,minutes:10});
  const report=analyzeMotion(run,{});
  console.log('  '+motionLine(report));
  assertMotion('motion',report,fail);
  // pace floor from the same samples: mean per-frame travel of live cars
  let dist=0,steps=0,fast=0;
  const last=new Map();
  for(const s of run.samples){
    const seen=new Set();
    for(const a2 of s.actors){
      seen.add(a2.id);
      const p2=last.get(a2.id);
      if(p2&&s.at-p2.at===run.step&&!a2.emote&&!p2.emote){
        const d2=Math.hypot(a2.x-p2.x,a2.y-p2.y)/run.step;
        dist+=d2;steps++;if(d2>0.5)fast++;
      }
      last.set(a2.id,{x:a2.x,y:a2.y,at:s.at,emote:a2.emote});
    }
    for(const k of[...last.keys()])if(!seen.has(k))last.delete(k);
  }
  const mean=steps?dist/steps:0,share=steps?fast/steps:0;
  console.log(`  pace: mean ${mean.toFixed(2)} px/f over ${steps} samples, ${(share*100).toFixed(0)}% above 0.5`);
  if(mean<0.85)fail(`mean live-car pace ${mean.toFixed(2)} px/f under the 0.85 floor`);
  if(share<0.65)fail(`only ${(share*100).toFixed(0)}% of samples above 0.5 px/f (floor 65%)`);
}

console.log('5) ten-minute soak: moving, happening, progressing');
{
  const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
  const SOAK_FOOTER=`
;globalThis.__soakN={events:0,progress:0};
{const g0=goal;goal=t=>{globalThis.__soakN.progress++;globalThis.__soakN.events++;return g0(t);};
 const d0=demo;demo=(v,b)=>{globalThis.__soakN.events++;return d0(v,b);};}
globalThis.__soakProbe=()=>({
  sig:Math.round(ball.x*3+ball.y*7)+cars.reduce((a,c)=>a+Math.round(c.x+c.y*3),0),
  events:globalThis.__soakN.events,progress:globalThis.__soakN.progress,
  finite:[ball,...cars].every(o=>['x','y','vx','vy'].every(k=>Number.isFinite(o[k])))});`;
  const{samples}=runSoak('rocket',{seed:0x710501,footer:SOAK_FOOTER,minutes:10});
  const report=analyzeSoak(samples);
  console.log('  '+soakLine(report));
  // measured seeds 0x710501/02: still 3-4s, quiet 29-75s, stall 47-86s, 51-59 ev, 35-42 prog
  assertSoak('soak',report,{still:12,quiet:120,stall:150,minEvents:30,minProgress:20},fail);
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
