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

console.log('2) mechanics: small/big pads and goal blast');
let game=bootGame('rocket',{seed:0x710100,footer:FOOTER});
const small=game.sandbox.__padFixture(false),big=game.sandbox.__padFixture(true),goalFx=game.sandbox.__goalFixture();
console.log(`  pads +${small.boost}/${small.cooldown}f and +${big.boost}/${big.cooldown}f; goal launch ${goalFx.launch.join(',')}`);
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

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
