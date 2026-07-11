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
globalThis.__crunchFixture=speed=>{
  // aim square at the right wall and drive into it; report the impact ledger
  resetGame();state='play';
  const c=cars[0];
  Object.assign(c,{x:FL.x1-30,y:180,a:0,vx:speed,vy:0,boost:0,dead:0,launch:0,
    drift:0,av:0,recover:0,crunchSpin:0});
  ball.x=80;ball.y=180; // ball far away: this is an open-field mistake
  let pre=0;
  for(let i=0;i<40&&c.x<FL.x1;i++){
    pre=Math.hypot(c.vx,c.vy);
    advanceCar(c,{steer:0,throttle:speed>1.5?1:0,boosting:false,drifting:false});
  }
  return{pre,post:Math.hypot(c.vx,c.vy),recover:c.recover,
    spin:c.crunchSpin,crunches:c.stats.crunches};
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
  const ws=sum('wallSaves'),wc=sum('wallCrashes'),dm=sum('driftManeuvers');
  const share=sum('hardTurnDrifts')/Math.max(1,sum('hardTurns'));
  const maxSlip=Math.max(...p.stats.map(s=>s.maxHeldSlip));
  console.log(`  run ${run}: ${p.goals[0]}-${p.goals[1]} goals, ${p.matches} matches, ${p.demos} demos, `+
    `${dm} drift maneuvers/${ds} starts (${bo} boost-outs, ${lu} line-ups -> ${lt} touches, ${ws} wall saves), `+
    `${att} hunts, ${wc} wall crashes, ${(share*100).toFixed(0)}% hard turns drifted, `+
    `max held slip ${maxSlip.toFixed(2)} [${p.profiles.join(',')}]`);
  // impossible-motion invariants (owner audit 2026-07-11): hard zeroes, not
  // bands — any tick means a physics cheat came back
  if(sum('catchSnapFrames')!==0)fail(`run ${run}: ${sum('catchSnapFrames')} catch-snap frames — velocity rotated faster than tire force allows`);
  if(sum('reverseDriftFrames')!==0)fail(`run ${run}: ${sum('reverseDriftFrames')} frames of backward travel inside a held drift`);
  if(sum('microReentries')!==0)fail(`run ${run}: ${sum('microReentries')} drift starts fired inside a live slide`);
  if(sum('uncaughtBoostFrames')!==0)fail(`run ${run}: ${sum('uncaughtBoostFrames')} boost-out frames while momentum was uncaught (|slip|>=0.45)`);
  if(sum('positiveTireWorkFrames')!==0)fail(`run ${run}: front tire added kinetic energy on ${sum('positiveTireWorkFrames')} frames`);
  if(maxSlip>1.75)fail(`run ${run}: held slip reached ${maxSlip.toFixed(2)} rad — slides wrap toward backward travel again`);
  if(!p.finite)fail(`run ${run}: non-finite ball or car state`);
  if(p.matches<1||p.matches>3)fail(`run ${run}: ${p.matches} completed matches (expected 1..3)`);
  if(p.goals[0]<2||p.goals[1]<2)fail(`run ${run}: one team failed to score competently`);
  if(total<10||total>30)fail(`run ${run}: ${total} goals outside watchable band 10..30`);
  if(p.demos<2||p.demos>20)fail(`run ${run}: ${p.demos} demos outside watchable band 2..20`);
  // floors from the 12-seed sweep (2026-07-11, honest-forces sim + free-roll
  // latch): maneuvers 945..1093, physics starts 817..946, boost-outs 123..181
  // (the momentum-alignment gate cut them from the old 296..376 — re-derived,
  // not weakened), demos 6..13 — wide margins
  if(dm<450)fail(`run ${run}: only ${dm} drift maneuvers (sweep floor 450)`);
  if(ds<500)fail(`run ${run}: only ${ds} drift starts (sweep floor 500)`);
  if(bo<65)fail(`run ${run}: only ${bo} drift boost-outs (sweep floor 65)`);
  // strategic drifting: swing around the ball onto the shot line. 12-seed
  // sweep 2026-07-11 (honest forces): 96..113 line-ups, 16..24 converted to a
  // touch <55f after the catch — floors at roughly half the observed minima
  if(lu<40)fail(`run ${run}: only ${lu} line-up drifts (sweep floor 40) — bots stopped using drift to get behind the ball`);
  if(lt<8)fail(`run ${run}: only ${lt} line-up drifts converted to a touch (sweep floor 8)`);
  // cornering skill is a release gate: drift is THE fast-turn tool (12-seed
  // sweep: 55..58% of hard turns drifted, 234..287 wall saves) and fast
  // head-on wall impacts stay capped (sweep 162..217; pre-cornering 319..380)
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

console.log('4) show ladder: tier discipline + goal replays');
// the crosswind act was removed by owner directive (2026-07-11): the match
// structure (kickoffs, demos, match point) IS this game's act timeline
{
  const FOOT=`
;globalThis.__showP=()=>SHOW.probe();
globalThis.__goals={t:0};const __g1=goal;goal=t=>{globalThis.__goals.t++;return __g1(t);};`;
  const a=bootGame('rocket',{seed:0x710602,footer:FOOT});
  a.frames(21600,false);
  const p=a.sandbox.__showP();
  console.log(`  goals ${a.sandbox.__goals.t}; ladder: opportunities ${JSON.stringify(p.offeredByTier)}, `+
    `presented ${JSON.stringify(p.shownByTier)}, slow-mo ${p.slowedFrames}f over ${p.shownByTier[3]||0} goal replays`);
  if(a.sandbox.__goals.t<10||a.sandbox.__goals.t>30)fail(`goals ${a.sandbox.__goals.t} outside 10..30`);
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
  Object.assign(c,{x:60,y:180,a:0,vx:2,vy:0,boost:100,dead:0,launch:0,drift:0,slip:0,
    av:0,avLast:0,wasDrifting:false,recover:0});
  const a0=c.a,x0=c.x,y0=c.y;let peakSlip=0,maxDva=0,minRad=1e9,lastVa=Math.atan2(c.vy,c.vx);
  for(let i=0;i<30;i++){ // 15f committed turn, then 15f catch-and-drive-out
    const turning=i<15;
    advanceCar(c,{steer:turning?1:0,throttle:1,boosting:false,drifting:useDrift&&turning});
    peakSlip=Math.max(peakSlip,Math.abs(c.slip));
    // the catch is judged on the CENTER-OF-MASS path (velocity heading), not
    // body yaw: the audited defect was momentum turning tighter than any force
    const sp=Math.hypot(c.vx,c.vy),va=Math.atan2(c.vy,c.vx);
    const dva=Math.abs(angDiff(va-lastVa));lastVa=va;
    if(i>=15){maxDva=Math.max(maxDva,dva);
      if(sp>1.5&&dva>1e-9)minRad=Math.min(minRad,sp/dva);}
  }
  return{heading:Math.abs(angDiff(c.a-a0)),peakSlip,maxDva,minRad,
    speed:Math.hypot(c.vx,c.vy),disp:Math.hypot(c.x-x0,c.y-y0),skid:c.skid.length,
    finite:['x','y','vx','vy','a'].every(k=>Number.isFinite(c[k]))};
};
globalThis.__ledgerFixture=()=>{ // one committed-slide frame: reconstruct the
  // non-thrust force and prove the tire never adds kinetic energy
  resetGame();state='play';
  const c=cars[0];
  Object.assign(c,{x:80,y:180,a:0,vx:1.5*Math.cos(-Math.PI/3),vy:1.5*Math.sin(-Math.PI/3),
    boost:0,dead:0,launch:0,drift:1,av:0.09,avLast:0,wasDrifting:true,recover:0});
  const vx0=c.vx,vy0=c.vy;
  advanceCar(c,{steer:1,throttle:0.16,boosting:false,drifting:true});
  const drag=0.985+0.007*1;
  const fxv=c.vx/drag-Math.cos(c.a)*(0.08*0.16)-vx0;
  const fyv=c.vy/drag-Math.sin(c.a)*(0.08*0.16)-vy0;
  return{work:0.5*((vx0+fxv)**2+(vy0+fyv)**2)-0.5*(vx0*vx0+vy0*vy0),
    mag:Math.hypot(fxv,fyv)};
};
globalThis.__pumpFixture=()=>{ // 15f low-throttle full-lock slide from 1.5:
  // an honest drift LOSES speed; the old rear kick made it energy-positive
  resetGame();state='play';
  const c=cars[0];
  Object.assign(c,{x:80,y:180,a:0,vx:1.5,vy:0,boost:0,dead:0,launch:0,drift:0,
    av:0,avLast:0,wasDrifting:false,recover:0});
  for(let i=0;i<15;i++)advanceCar(c,{steer:1,throttle:0.16,boosting:false,drifting:true});
  return{speed:Math.hypot(c.vx,c.vy)};
};
globalThis.__dropoutFixture=()=>{ // steering crosses zero INSIDE a held slide:
  // the handbrake must stay latched — no re-entry impulse, no blend dip
  resetGame();state='play';
  const c=cars[0];
  Object.assign(c,{x:80,y:180,a:0,vx:2.2,vy:0,boost:0,dead:0,launch:0,drift:0,
    av:0,avLast:0,wasDrifting:false,recover:0});
  const s0=c.stats.driftStarts;let minBlendLate=1,peakAv=0,reached=false;
  const run=(n,steer)=>{for(let i=0;i<n;i++){
    advanceCar(c,{steer,throttle:1,boosting:false,drifting:true});
    if(c.drift>=0.999)reached=true;
    if(reached)minBlendLate=Math.min(minBlendLate,c.drift);
    peakAv=Math.max(peakAv,Math.abs(c.av));}};
  run(8,1);run(1,0);run(3,1);
  return{starts:c.stats.driftStarts-s0,minBlendLate,peakAv};
};
globalThis.__holdFixture=()=>{ // 42f sustained full lock: slip envelope, no
  // wrap through +/-pi, and forward flow never goes negative while held
  resetGame();state='play';
  const c=cars[0];
  Object.assign(c,{x:80,y:180,a:0,vx:2.3,vy:0,boost:0,dead:0,launch:0,drift:0,
    av:0,avLast:0,wasDrifting:false,recover:0});
  let maxSlip=0,wrap=false,minFwd=1e9,prev=0;
  for(let i=0;i<42;i++){
    advanceCar(c,{steer:1,throttle:1,boosting:false,drifting:true});
    if(prev<-2.8&&c.slip>2.8||prev>2.8&&c.slip<-2.8)wrap=true;
    prev=c.slip;maxSlip=Math.max(maxSlip,Math.abs(c.slip));
    if(c.driftHeld)minFwd=Math.min(minFwd,c.vx*Math.cos(c.a)+c.vy*Math.sin(c.a));
  }
  return{maxSlip,wrap,minFwd};
};
globalThis.__reverseFixture=()=>{ // moving exactly backward relative to the
  // nose: the handbrake must reject entry (no drift, no start recorded)
  resetGame();state='play';
  const c=cars[0];
  Object.assign(c,{x:80,y:180,a:Math.PI,vx:2,vy:0,boost:0,dead:0,launch:0,drift:0,
    av:0,avLast:0,wasDrifting:false,recover:0});
  const s0=c.stats.driftStarts;
  advanceCar(c,{steer:1,throttle:1,boosting:false,drifting:true});
  return{drift:c.drift,starts:c.stats.driftStarts-s0};
};
globalThis.__continuityFixture=()=>{ // yaw rate must ease through the blend's
  // zero crossing, not snap to zero while momentum snaps the other way
  resetGame();state='play';
  const c=cars[0];
  Object.assign(c,{x:80,y:180,a:0,vx:2.3,vy:0,boost:0,dead:0,launch:0,drift:0,
    av:0,avLast:0,wasDrifting:false,recover:0});
  for(let i=0;i<15;i++)advanceCar(c,{steer:1,throttle:1,boosting:false,drifting:true});
  let lastAv=c.av,step=-1;
  for(let i=0;i<30;i++){
    const before=c.drift;
    advanceCar(c,{steer:0,throttle:1,boosting:false,drifting:false});
    if(before>0&&c.drift<=0){step=Math.abs(c.av-lastAv);break;}
    lastAv=c.av;
  }
  return{step};
};
globalThis.__freerollFixture=hold=>{ // rocket-league powerslide semantics
  // (owner 2026-07-11): the button is NOT a brake — held with centered wheels
  // and no slip it must free-roll at exactly the normal cruise speed
  resetGame();state='play';
  const c=cars[0];
  Object.assign(c,{x:80,y:330,a:-Math.PI/2,vx:0,vy:-1.0,boost:0,dead:0,launch:0,
    drift:0,av:0,avLast:0,wasDrifting:false,recover:0,slip:0});
  for(let i=0;i<120;i++)advanceCar(c,{steer:0,throttle:1,boosting:false,drifting:hold});
  return{speed:Math.hypot(c.vx,c.vy),drift:c.drift};
};
globalThis.__straightenFixture=()=>{ // slide, then center the wheel with the
  // button still held: the latch rides the slip out, then grip returns —
  // cruise speed never drops while straightening
  resetGame();state='play';
  const c=cars[0];
  Object.assign(c,{x:30,y:330,a:-Math.PI/2,vx:0,vy:-2.3,boost:0,dead:0,launch:0,
    drift:0,av:0,avLast:0,wasDrifting:false,recover:0,slip:0});
  for(let i=0;i<12;i++)advanceCar(c,{steer:1,throttle:1,boosting:false,drifting:true});
  let minSpeed=1e9,rel=-1;
  for(let i=0;i<45;i++){
    advanceCar(c,{steer:0,throttle:1,boosting:false,drifting:true});
    minSpeed=Math.min(minSpeed,Math.hypot(c.vx,c.vy));
    if(rel<0&&c.drift<=0)rel=i;
  }
  return{minSpeed,released:rel};
};
globalThis.__skidFixture=()=>{ // owner bug 2026-07-11: skid rubber laid
  // before a goal froze mid-field through the replay (launched cars stop
  // running advanceCar, and expired marks drew with an ignored negative
  // alpha). Lay rubber, blast a goal, run the real pipeline: every surviving
  // sample must still be inside its 34f fade window (+slow-mo overshoot).
  resetGame();state='play';
  const c=cars[0];
  Object.assign(c,{x:60,y:180,a:0,vx:2.2,vy:0,boost:0,dead:0,launch:0,drift:0,
    av:0,avLast:0,wasDrifting:false,recover:0});
  for(let i=0;i<12;i++)advanceCar(c,{steer:1,throttle:1,boosting:false,drifting:true});
  const laid=c.skid.length;
  Object.assign(ball,{x:80,y:FL.y0-11,vx:0,vy:-1});ballStep(); // top goal
  for(let i=0;i<50;i++)step(); // goal blast, launch tumble, slow-mo replay
  const ages=cars.flatMap(cc=>cc.skid.map(s=>frame-s.f));
  return{laid,launched:c.launch>0,maxAge:ages.length?Math.max(...ages):0};
};
globalThis.__boostGateFixture=slip=>{ // boost-out means physically caught:
  // an open window must refuse to fire while |slip| says momentum is elsewhere
  resetGame();state='play';
  const c=cars[0];
  Object.assign(c,{x:80,y:100,a:0,vx:2,vy:0,boost:100,dead:0,launch:0,recover:0});
  c.slip=slip;
  const ai=c.ai;
  ai.driftUntil=0;ai.boostOutUntil=frame+10;ai.boostOutCounted=false;
  ai.driftCooldown=frame+999; // keep the start triggers out of the fixture
  const intent=applyBotDrift(c,{steer:0,throttle:1,boosting:false,
    turnError:0,targetDist:40},LEGACY_STYLE);
  return{boosting:!!intent.boosting};
};`;
  const g=bootGame('rocket',{seed:0x710300,footer:FOOT});
  const base=g.sandbox.__driftFixture(false),drift=g.sandbox.__driftFixture(true);
  console.log(`  30f full-lock turn: heading ${base.heading.toFixed(2)} -> ${drift.heading.toFixed(2)} rad, `+
    `slip ${drift.peakSlip.toFixed(2)} rad, speed ${base.speed.toFixed(2)} -> ${drift.speed.toFixed(2)}, `+
    `travel ${drift.disp.toFixed(1)}px, catch ${drift.maxDva.toFixed(3)} rad/f max, `+
    `min path radius ${drift.minRad.toFixed(1)}px`);
  if(!base.finite||!drift.finite)fail('drift fixture produced non-finite state');
  if(drift.heading<base.heading+0.35)fail(`drift turned only ${drift.heading.toFixed(2)} rad vs base ${base.heading.toFixed(2)} — rear grip never broke`);
  if(drift.heading<1.25||drift.heading>1.75)fail(`drift heading ${drift.heading.toFixed(2)} outside 1.25..1.75 envelope`);
  if(drift.peakSlip<0.45||drift.peakSlip>1.25)fail(`peak slip ${drift.peakSlip.toFixed(2)} rad outside 0.45..1.25 — tail-out envelope broken`);
  // measured 2026-07-11 (honest forces): drift turns +0.47 rad over the grip
  // turn while keeping 93% speed (2.14 vs 2.30) and travelling 60.9px
  if(drift.speed<base.speed*0.80||drift.speed<1.85)
    fail(`drift bled speed to ${drift.speed.toFixed(2)} (base ${base.speed.toFixed(2)}) — momentum not carried through the slide`);
  if(drift.speed>base.speed*1.05)fail(`drift GAINED speed ${drift.speed.toFixed(2)} vs ${base.speed.toFixed(2)} — release must not invent velocity`);
  if(drift.disp<45)fail(`drift displaced only ${drift.disp.toFixed(1)}px — reads as spinning in place`);
  if(drift.skid<10)fail(`drift laid only ${drift.skid} skid samples — the rear-swing arc is invisible`);
  if(base.skid!==0)fail(`grip driving deposited ${base.skid} skid samples — rubber must mean drift`);
  // the impossible-movement audit (2026-07-11): the catch must be earned by
  // bounded tire force — momentum may never turn faster than 0.095 rad/f, and
  // the COM path radius above 1.5 px/f never dips under 22px (the old catch
  // teleport measured 0.179 rad/f and a 10.3px radius)
  if(drift.maxDva>0.095)fail(`release turned momentum ${drift.maxDva.toFixed(3)} rad/f — catch is reassigning the velocity vector again`);
  if(drift.minRad<22)fail(`catch path radius ${drift.minRad.toFixed(1)}px under 22 — tighter than any honest force allows`);
  g.sandbox.__NO_DRIFT=1;
  const offA=g.sandbox.__driftFixture(false),offB=g.sandbox.__driftFixture(true);
  if(JSON.stringify(offA)!==JSON.stringify(offB))fail('__NO_DRIFT did not make the drifting intent a physics no-op');
  delete g.sandbox.__NO_DRIFT;
  // switch fidelity: __NO_DRIFT_FORCES must reproduce the pre-audit slide
  // kinematics exactly (it is the regression oracle), and that old model must
  // FAIL the new honest-catch contracts — proof the fixture catches the cheat
  g.sandbox.__NO_DRIFT_FORCES=1;
  const legacy=g.sandbox.__driftFixture(true);
  delete g.sandbox.__NO_DRIFT_FORCES;
  console.log(`  __NO_DRIFT_FORCES fidelity: heading ${legacy.heading.toFixed(6)}, slip ${legacy.peakSlip.toFixed(6)}, `+
    `speed ${legacy.speed.toFixed(6)}, catch ${legacy.maxDva.toFixed(3)} rad/f / ${legacy.minRad.toFixed(1)}px radius`);
  if(Math.abs(legacy.heading-1.6846500992)>1e-6||Math.abs(legacy.peakSlip-1.0573887496)>1e-6||
     Math.abs(legacy.speed-2.0367346464)>1e-6||Math.abs(legacy.disp-53.0699859851)>1e-6)
    fail('__NO_DRIFT_FORCES no longer reproduces the recorded pre-audit kinematics');
  if(legacy.maxDva<=0.095&&legacy.minRad>=22)
    fail('the pre-audit model PASSES the honest-catch contracts — the fixture lost its teeth');
  // force/energy ledger: reconstruct the single-frame non-thrust force in a
  // committed slide — bounded magnitude, and it must never add kinetic energy
  const ledger=g.sandbox.__ledgerFixture();
  const pump=g.sandbox.__pumpFixture();
  g.sandbox.__NO_DRIFT_FORCES=1;
  const pumpOld=g.sandbox.__pumpFixture();
  delete g.sandbox.__NO_DRIFT_FORCES;
  console.log(`  tire ledger: work ${ledger.work.toFixed(5)}, |force| ${ledger.mag.toFixed(4)}; `+
    `15f low-throttle slide from 1.50: ${pump.speed.toFixed(3)} (pre-audit model: ${pumpOld.speed.toFixed(3)})`);
  if(ledger.work>1e-9)fail(`front tire ADDED ${ledger.work.toFixed(5)} kinetic energy in one frame`);
  if(ledger.mag>0.0450001)fail(`front tire force ${ledger.mag.toFixed(4)} exceeds the 0.045 deep-slide cap`);
  if(pump.speed>=1.5)fail(`low-throttle slide GAINED speed (${pump.speed.toFixed(3)} from 1.50) — an energy pump is back`);
  if(pumpOld.speed<=1.5)fail('pre-audit model no longer shows the rear-kick energy pump — ablation branch drifted');
  // steering-zero dropout: the latched handbrake must survive steer crossing
  // zero — one start, no blend dip, bounded yaw rate
  const drop=g.sandbox.__dropoutFixture();
  console.log(`  steer-zero dropout: ${drop.starts} start(s), blend floor ${drop.minBlendLate.toFixed(2)}, peak yaw ${drop.peakAv.toFixed(3)}`);
  if(drop.starts!==1)fail(`steer dropout recorded ${drop.starts} drift starts inside ONE held maneuver`);
  if(drop.minBlendLate<0.999)fail(`drift blend dipped to ${drop.minBlendLate.toFixed(2)} when steering crossed zero`);
  if(drop.peakAv>0.115)fail(`stacked entry impulses pushed yaw to ${drop.peakAv.toFixed(3)} rad/f (cap 0.115)`);
  // sustained hold: slip stays bounded, never wraps past pi, never backward
  const hold=g.sandbox.__holdFixture();
  console.log(`  42f full-lock hold: max slip ${hold.maxSlip.toFixed(2)} rad, wrap ${hold.wrap}, min forward flow ${hold.minFwd.toFixed(2)}`);
  if(hold.maxSlip>1.45)fail(`sustained hold reached ${hold.maxSlip.toFixed(2)} rad slip — body rotates through sideways again`);
  if(hold.wrap)fail('slip wrapped through +/-pi mid-hold — the backward-slide flip is back');
  if(hold.minFwd<0)fail(`car travelled backward (${hold.minFwd.toFixed(2)}) inside a held drift`);
  // reverse entry, release continuity, boost-out slip gate
  const rev=g.sandbox.__reverseFixture();
  const cont=g.sandbox.__continuityFixture();
  const gateHot=g.sandbox.__boostGateFixture(1.0),gateCold=g.sandbox.__boostGateFixture(0.3);
  g.sandbox.__NO_DRIFT_FORCES=1;
  const revOld=g.sandbox.__reverseFixture();
  const gateHotOld=g.sandbox.__boostGateFixture(1.0);
  delete g.sandbox.__NO_DRIFT_FORCES;
  console.log(`  reverse entry: drift ${rev.drift} / ${rev.starts} starts (pre-audit: ${revOld.drift.toFixed(2)}); `+
    `release yaw step ${cont.step.toFixed(4)}; boost gate slip 1.0 -> ${gateHot.boosting} (pre-audit ${gateHotOld.boosting}), 0.3 -> ${gateCold.boosting}`);
  if(rev.drift!==0||rev.starts!==0)fail('backward-moving car entered a drift — reverse gate missing');
  if(revOld.drift<0.19)fail('pre-audit model stopped accepting reverse entry — ablation branch drifted');
  if(cont.step<0||cont.step>0.020)fail(`yaw rate stepped ${cont.step.toFixed(4)} rad/f when the blend hit zero (cap 0.020)`);
  if(gateHot.boosting)fail('boost-out fired while |slip|=1.0 — momentum was not caught');
  if(!gateCold.boosting)fail('boost-out refused to fire with momentum caught (|slip|=0.3)');
  if(!gateHotOld.boosting)fail('pre-audit model stopped boosting uncaught — ablation branch drifted');
  // powerslide is not a brake (owner 2026-07-11): held with centered wheels
  // it free-rolls bit-identical to normal driving, and straightening out of a
  // real slide with the button still down never bleeds cruise speed
  const rollOff=g.sandbox.__freerollFixture(false),rollOn=g.sandbox.__freerollFixture(true);
  const straighten=g.sandbox.__straightenFixture();
  console.log(`  free roll: 120f straight at ${rollOn.speed.toFixed(2)} with powerslide held `+
    `(identical ${rollOff.speed===rollOn.speed}); slide->straighten min speed ${straighten.minSpeed.toFixed(2)}, `+
    `latch released at +${straighten.released}f`);
  if(rollOff.speed!==rollOn.speed||rollOn.drift!==0)
    fail(`powerslide held while driving straight braked the car (${rollOff.speed.toFixed(3)} vs ${rollOn.speed.toFixed(3)}, drift ${rollOn.drift})`);
  if(straighten.minSpeed<2.2)
    fail(`straightening with powerslide held bled cruise speed to ${straighten.minSpeed.toFixed(2)}`);
  if(straighten.released<0)
    fail('the drift latch never released after the car straightened out');
  // skid rubber retires through the goal blast: launched cars must not carry
  // frozen full-bright marks through the replay (owner bug 2026-07-11)
  const skidFx=g.sandbox.__skidFixture();
  console.log(`  goal-blast skids: ${skidFx.laid} samples laid, launched ${skidFx.launched}, `+
    `oldest surviving ${skidFx.maxAge}f (fade window 34f)`);
  if(skidFx.laid<10)fail('skid fixture never laid rubber before the goal');
  if(!skidFx.launched)fail('skid fixture goal never launched the drifting car');
  if(skidFx.maxAge>36)
    fail(`a skid sample survived ${skidFx.maxAge}f into the goal replay — stale rubber freezes mid-field again`);
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
  // honest-forces A/B: same seed against the pre-audit drift model. The new
  // model keeps every impossible-motion invariant at zero; the old model must
  // still trip the catch-snap counter (proof the run-level telemetry bites).
  const f2=bootGame('rocket',{seed:0x710301,footer:FOOTER});
  f2.sandbox.__NO_DRIFT_FORCES=1;
  f2.frames(21600,false);
  const pf=f2.sandbox.__probe();
  console.log(`  forces A/B: honest model ${sum(pa,'catchSnapFrames')} catch-snaps / `+
    `${sum(pa,'reverseDriftFrames')} reverse frames; pre-audit model ${sum(pf,'catchSnapFrames')} / `+
    `${sum(pf,'reverseDriftFrames')}; diverged ${a.sandbox.__sig()!==f2.sandbox.__sig()}`);
  if(a.sandbox.__sig()===f2.sandbox.__sig())fail('__NO_DRIFT_FORCES never changed the sim on its A/B seed');
  if(!pf.finite)fail('__NO_DRIFT_FORCES run went non-finite');
  if(sum(pa,'catchSnapFrames')!==0||sum(pa,'reverseDriftFrames')!==0||
     sum(pa,'microReentries')!==0||sum(pa,'uncaughtBoostFrames')!==0)
    fail('honest-forces run tripped an impossible-motion invariant on the A/B seed');
  if(sum(pf,'catchSnapFrames')+sum(pf,'reverseDriftFrames')+sum(pf,'microReentries')===0)
    fail('pre-audit model tripped NO invariant counters — the telemetry lost its teeth');
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

console.log('10) wall crunch: momentum dies against the boards, recovery costs');
{
  const g=bootGame('rocket',{seed:0x710470,footer:FOOTER});
  const hard=g.sandbox.__crunchFixture(2.3);
  const soft=g.sandbox.__crunchFixture(1.0);
  console.log(`  head-on at ${hard.pre.toFixed(2)}: kept ${(hard.post/hard.pre*100).toFixed(0)}% speed, `+
    `recover ${hard.recover}f, stagger ${hard.spin.toFixed(3)}; graze at ${soft.pre.toFixed(2)}: recover ${soft.recover}f`);
  if(hard.crunches<1||hard.recover<=0)fail('hard wall impact did not crunch');
  if(hard.post>hard.pre*0.35)fail(`crunched car kept ${(hard.post/hard.pre*100).toFixed(0)}% of its speed — the wall must eat momentum`);
  if(hard.spin===0)fail('crunch applied no recovery stagger');
  if(soft.recover!==0||soft.crunches!==hard.crunches)fail('a gentle wall touch must NOT crunch');
  g.sandbox.__NO_CRUNCH=1;
  const off=g.sandbox.__crunchFixture(2.3);
  if(off.recover!==0)fail('__NO_CRUNCH still crunched');
  if(off.post<off.pre*0.35)fail('__NO_CRUNCH did not restore the legacy 40% bounce');
  // same-seed A/B: the punishment is sim-visible and bots still live in-band
  const a=bootGame('rocket',{seed:0x710471,footer:FOOTER});
  const b=bootGame('rocket',{seed:0x710471,footer:FOOTER});
  b.sandbox.__NO_CRUNCH=1;
  a.frames(21600,false);b.frames(21600,false);
  const pa=a.sandbox.__probe(),pb=b.sandbox.__probe();
  const sum=(p,k)=>p.stats.reduce((s2,s)=>s2+s[k],0);
  console.log(`  A/B: ${sum(pa,'crunches')} crunches with punishment vs ${sum(pb,'crunches')} ablated; `+
    `goals ${pa.goals[0]+pa.goals[1]} vs ${pb.goals[0]+pb.goals[1]}`);
  if(sum(pa,'crunches')<5)fail('bots never crunched in 6 minutes — the punishment is unreachable');
  if(sum(pb,'crunches')!==0)fail('__NO_CRUNCH run still recorded crunches');
  if(a.sandbox.__sig()===b.sandbox.__sig())fail('wall crunch never changed the sim on its A/B seed');
  if(!pa.finite)fail('crunch run went non-finite');
}

console.log('9) motion contract: no dead standing, measured pace');
{
  const{runMotion,analyzeMotion,assertMotion,motionLine}=require('./motion');
  const MFOOT=FOOTER+`
;globalThis.__motionProbe=()=>({
  // cars are watched in EVERY state: countdown is an authored emote pause
  // (115f, inside the 120f budget), and the match-over beat runs victory
  // donuts / the sulk crawl home — never a frozen strip. During the goal
  // replay (tier-3 apex, 85f) cars are blast-launched into a slow-mo tumble;
  // the fast tumble is real motion, and only its decayed-to-rest tail counts
  // as the authored celebration pause (speed < 0.5, ~15% of replays)
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
