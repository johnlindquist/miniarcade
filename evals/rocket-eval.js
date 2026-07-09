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
  finite:[ball,...cars].every(o=>['x','y','vx','vy'].every(k=>Number.isFinite(o[k])))&&
    cars.every(c=>Number.isFinite(c.a)&&Number.isFinite(c.boost))
});
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
  console.log(`  run ${run}: ${p.goals[0]}-${p.goals[1]} goals, ${p.matches} matches, ${p.demos} demos`);
  if(!p.finite)fail(`run ${run}: non-finite ball or car state`);
  if(p.matches<1||p.matches>3)fail(`run ${run}: ${p.matches} completed matches (expected 1..3)`);
  if(p.goals[0]<2||p.goals[1]<2)fail(`run ${run}: one team failed to score competently`);
  if(total<10||total>30)fail(`run ${run}: ${total} goals outside watchable band 10..30`);
  if(p.demos<2||p.demos>20)fail(`run ${run}: ${p.demos} demos outside watchable band 2..20`);
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
