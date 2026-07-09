#!/usr/bin/env node
'use strict';
const{bootGame}=require('./harness');

const FOOTER=`
globalThis.__webStats={goals:[0,0],kos:[0,0],matches:0,webs:0,recoveryWebs:0,
  wallHits:[0,0],wallDamage:[0,0],opened:[0,0],phases:[0,0,0],lets:0};
const __point0=scorePoint;scorePoint=(by,reason)=>{if(state==='play')globalThis.__webStats.goals[by]++;return __point0(by,reason);};
const __damage0=damageWall;damageWall=(side,index,phase=ballPhase())=>{const out=__damage0(side,index,phase);
  if(out.damaged){globalThis.__webStats.wallHits[side]++;globalThis.__webStats.wallDamage[side]+=out.damaged;
    globalThis.__webStats.opened[side]+=out.opened;globalThis.__webStats.phases[phase]++;}return out;};
const __let0=letRally;letRally=()=>{if(state==='play')globalThis.__webStats.lets++;return __let0();};
const __ko0=knockout;knockout=(f,by)=>{if(state==='play'&&f.respawn<=0)globalThis.__webStats.kos[by]++;return __ko0(f,by);};
const __match0=finishMatch;finishMatch=by=>{globalThis.__webStats.matches++;return __match0(by);};
const __attach0=attachWeb;attachWeb=(f,a)=>{const had=!!f.web,out=__attach0(f,a);
  if(!had&&f.web){globalThis.__webStats.webs++;if(a&&a.recovery)globalThis.__webStats.recoveryWebs++;}return out;};
globalThis.__probe=()=>({
  ...globalThis.__webStats,playing:playing(),state,score:[...score],walls:walls.map(w=>[...w]),
  ball:{x:ball.x,y:ball.y,vx:ball.vx,vy:ball.vy,phase:ballPhase(),airTouches:ball.airTouches},
  fighter:{x:fighters[0].x,y:fighters[0].y,vx:fighters[0].vx,vy:fighters[0].vy,
    ground:fighters[0].ground,swing:fighters[0].swing,swingCd:fighters[0].swingCd},
  finite:[ball,...fighters].every(o=>['x','y','vx','vy'].every(k=>Number.isFinite(o[k])))&&
    fighters.every(f=>Number.isFinite(f.damage))&&Number.isFinite(ball.airTouches)&&
    walls.every(w=>w.every(v=>Number.isInteger(v)&&v>=0&&v<=2))
});
globalThis.__strikeFixture=()=>{
  resetGame();state='play';const f=fighters[0];
  Object.assign(f,{x:60,y:250,face:1,swing:13,swingCd:23,vx:0,vy:0,respawn:0});
  const tip=racketTip(f);Object.assign(ball,{x:tip.x,y:tip.y,vx:-1,vy:1,last:1,hot:2,airTouches:1});hitBall(f);
  return{last:ball.last,hot:ball.hot,airTouches:ball.airTouches,phase:ballPhase(),vx:ball.vx,vy:ball.vy,swing:f.swing};
};
globalThis.__pullFixture=()=>{
  resetGame();state='play';const f=fighters[0];
  Object.assign(f,{x:50,y:250,face:1,pullCd:0,respawn:0,ground:true});
  Object.assign(ball,{x:70,y:235,vx:0,vy:0,last:1,hot:1,airTouches:3});webPull(f);
  return{last:ball.last,hot:ball.hot,airTouches:ball.airTouches,phase:ballPhase(),vx:ball.vx,vy:ball.vy,pullCd:f.pullCd};
};
globalThis.__wallFixture=()=>{
  resetGame();state='play';score=[0,0];const index=3;
  ball.last=0;ball.airTouches=1;
  const first=damageWall(1,index,0),afterFirst=walls[1][index];
  const second=damageWall(1,index,0),afterSecond=walls[1][index];
  ball.last=1;ball.airTouches=4;const ownBefore=[...walls[1]];damageWall(1,0,2);
  const ownSafe=walls[1].every((v,i)=>v===ownBefore[i]);
  resetWalls();ball.last=0;ball.airTouches=4;const splash=damageWall(1,3,2);
  const splashCount=walls[1].filter(v=>v===1).length;
  return{first,second,afterFirst,afterSecond,ownSafe,splash,splashCount,score:[...score]};
};
globalThis.__breachFixture=()=>{
  resetGame();state='play';score=[0,0];fighters[server].serveT=0;const index=4;
  walls[1][index]=2;Object.assign(ball,{x:W-6,y:wallTileY(index),vx:3.4,vy:0,last:0,
    breach:-1,airTouches:4,idleT:0});
  for(let i=0;i<12&&state==='play';i++){frame++;ballStep();}
  const scored={score:[...score],state,walls:walls.map(w=>[...w])};
  stateT=1;step();
  return{...scored,nextState:state,sealed:walls.every(w=>w.every(v=>v===0))};
};
globalThis.__floorFixture=()=>{
  resetGame();state='play';score=[0,0];fighters[server].serveT=0;
  Object.assign(ball,{x:40,y:FLOOR-ball.r-1,vx:1,vy:2,last:0,airTouches:4,idleT:0});ballStep();
  return{score:[...score],state,airTouches:ball.airTouches};
};
globalThis.__koFixture=()=>{
  resetGame();state='play';score=[0,0];walls[1][2]=1;const f=fighters[1];
  knockout(f,0);return{score:[...score],state,respawn:f.respawn,wall:walls[1][2]};
};
globalThis.__recoveryFixture=damage=>{
  resetGame();state='play';score=[0,0];const f=fighters[1];resetFighter(f,1);
  Object.assign(f,{x:W+8,y:300,vx:4,vy:2,damage,ground:false,web:null,webCd:0,respawn:0});
  let attached=false,inside=false,ko=false;
  const attach0=attachWeb;attachWeb=(ff,a)=>{const out=attach0(ff,a);
    if(ff===f&&ff.web&&ff.web.a.recovery)attached=true;return out;};
  for(let i=0;i<240;i++){
    frame++;fighterStep(f);
    if(f.x>10&&f.x<W-10&&f.y<FLOOR-20)inside=true;
    if(f.respawn>0){ko=true;break;}
  }
  attachWeb=attach0;return{attached,inside,ko,score:[...score],state,x:f.x,y:f.y};
};`;

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};

console.log('1) autonomous wall-break matches: 3 x 3 simulated minutes');
const totals={goals:0,matches:0,phases:[0,0,0]};
for(let run=1;run<=3;run++){
  const game=bootGame('webslam',{seed:0x730100+run,footer:FOOTER});
  game.frames(10800,false);const p=game.sandbox.__probe(),goals=p.goals[0]+p.goals[1],kos=p.kos[0]+p.kos[1];
  console.log(`  run ${run}: goals ${p.goals[0]}-${p.goals[1]}, ${p.matches} matches, wall damage ${p.wallDamage[0]}-${p.wallDamage[1]}, phases ${p.phases.join('/')}, ${p.lets} lets, ${kos} K.O.`);
  totals.goals+=goals;totals.matches+=p.matches;p.phases.forEach((n,i)=>totals.phases[i]+=n);
  if(!p.finite)fail(`run ${run}: non-finite fighter/ball/wall state`);
  if(goals<2||goals>12)fail(`run ${run}: ${goals} breaches outside watchable band 2..12`);
  if(!p.goals.every(n=>n>=1))fail(`run ${run}: one side never breached the wall`);
  if(p.matches<1||p.matches>4)fail(`run ${run}: ${p.matches} completed matches outside band 1..4`);
  if(p.wallDamage[0]<8||p.wallDamage[1]<8)fail(`run ${run}: one wall took too little damage`);
  if(p.webs<12||p.webs>110)fail(`run ${run}: ${p.webs} web saves outside movement band 12..110`);
  if(p.lets>18)fail(`run ${run}: ${p.lets} dead-rally lets overwhelm play`);
  if(kos>8)fail(`run ${run}: ${kos} K.O.s overwhelm wall play`);
}
if(totals.phases.some((n,i)=>n<(i===2?2:8)))fail(`charge phases under-exercised across runs: ${totals.phases.join('/')}`);

console.log('2) mechanics: charge, crack, open, breach, power-play K.O., recovery');
let game=bootGame('webslam',{seed:0x730200,footer:FOOTER});
const strike=game.sandbox.__strikeFixture(),pull=game.sandbox.__pullFixture(),wall=game.sandbox.__wallFixture();
const breach=game.sandbox.__breachFixture(),floor=game.sandbox.__floorFixture(),ko=game.sandbox.__koFixture();
const low=game.sandbox.__recoveryFixture(20),high=game.sandbox.__recoveryFixture(120);
console.log(`  strike phase ${strike.phase+1}; pull phase ${pull.phase+1}; tile ${wall.afterFirst}->${wall.afterSecond}; splash ${wall.splashCount}; breach ${breach.score.join('-')}; recovery low=${low.inside?'SAVE':'K.O.'} high=${high.ko?'K.O.':'SAVE'}`);
if(strike.last!==0||strike.hot!==3||strike.airTouches!==2||strike.phase!==1||strike.vx<=0||strike.vy>=0||strike.swing!==4)fail('racket charge contract regressed');
if(pull.last!==0||pull.hot!==2||pull.airTouches!==4||pull.phase!==2||pull.pullCd!==70||pull.vx>=0)fail('web-pull charge contract regressed');
if(wall.afterFirst!==1||wall.afterSecond!==2||!wall.ownSafe||wall.splashCount!==5||wall.score.some(Boolean))fail('wall crack/open/splash ownership contract regressed');
if(breach.score[0]!==1||breach.score[1]!==0||breach.state!=='point'||breach.nextState!=='countdown'||!breach.sealed)fail('open-wall breach/reset contract regressed');
if(floor.score.some(Boolean)||floor.state!=='play'||floor.airTouches!==0)fail('floor bounce should discharge without scoring');
if(ko.score.some(Boolean)||ko.state!=='play'||ko.respawn!==95||ko.wall!==1)fail('K.O. should create a power play without scoring or repairing walls');
if(!low.attached||!low.inside||low.ko||low.score[0]!==0)fail('low-damage launch did not recover cleanly');
if(!high.attached||high.inside||!high.ko||high.score.some(Boolean)||high.state!=='play')fail('high-damage launch did not create a scoreless K.O. power play');

console.log('3) session + manual fighter: Enter gate, run, jump, racket');
game=bootGame('webslam',{seed:0x730300,footer:FOOTER});
if(game.sandbox.__probe().playing)fail('session started in playing mode');
press(game,'Enter');if(game.sandbox.__probe().playing)fail('first Enter skipped instructions');
press(game,'Enter');if(!game.sandbox.__probe().playing)fail('second Enter did not start play');
game.frames(120,false);const before=game.sandbox.__probe();
game.key('keydown','ArrowRight');game.frames(20,false);game.key('keyup','ArrowRight');
const moved=game.sandbox.__probe();press(game,'Space');const jumped=game.sandbox.__probe();
press(game,'KeyX');const swung=game.sandbox.__probe();
console.log(`  ran ${(moved.fighter.x-before.fighter.x).toFixed(1)}px, jump vy ${jumped.fighter.vy.toFixed(2)}, swing ${swung.fighter.swing}f`);
if(before.state!=='play')fail(`manual test never reached live play (${before.state})`);
if(moved.fighter.x-before.fighter.x<12)fail('manual run input did not move fighter');
if(jumped.fighter.ground||jumped.fighter.vy>=0)fail('manual jump input did not launch fighter');
if(swung.fighter.swing<=0||swung.fighter.swingCd<=0)fail('manual racket input did not start swing');
if(!swung.finite)fail('manual fighter produced non-finite state');

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
