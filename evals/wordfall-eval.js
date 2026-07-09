#!/usr/bin/env node
'use strict';
const{bootGame}=require('./harness');

const FOOTER=`
globalThis.__wordStats={kills:0,deaths:0,resets:0,maxEnemies:0};
const __kill0=killEnemy;killEnemy=e=>{if(!e.dead)globalThis.__wordStats.kills++;return __kill0(e);};
const __hurt0=hurtPlayer;hurtPlayer=n=>{const was=mode,out=__hurt0(n);
  if(was!=='dead'&&mode==='dead')globalThis.__wordStats.deaths++;return out;};
const __reset0=resetGame;resetGame=()=>{globalThis.__wordStats.resets++;return __reset0();};
const __combat0=updateCombat;updateCombat=()=>{const out=__combat0();
  globalThis.__wordStats.maxEnemies=Math.max(globalThis.__wordStats.maxEnemies,enemies.length);return out;};
globalThis.__probe=()=>{
  const actors=[P,...enemies,...arrows,...gems,...shots,...altars,...arrows.flatMap(a=>a.trail)];
  return{...globalThis.__wordStats,playing:playing(),mode,
    player:{x:P.x,y:P.y,vx:P.vx,vy:P.vy,jumps:P.jumps,dodge:P.dodge,inv:P.inv},
    finite:actors.every(o=>['x','y','vx','vy','hp'].every(k=>o[k]===undefined||Number.isFinite(o[k])))
  };
};
globalThis.__wordFixture=()=>{
  const marks=markWord('ALIVE','ANGLE');
  resetGame();target='ALIVE';
  const altar={word:'ALIVE',x:80,y:100,life:100,born:frame,pulse:0};altars=[altar];chooseAltar(altar);
  return{marks,solves,floorNo,greenRunes,yellowRunes,altars:altars.length,chargeNeed,puzzleDone};
};
globalThis.__projectileFixture=()=>{
  resetGame();P.x=80;P.y=200;
  const s=enemyStats('bat'),e={kind:'bat',x:92,y:200,vx:0,vy:0,hp:s.hp,maxHp:s.hp,
    sp:s.sp,r:s.r,t:0,hit:0,shoot:99,orbCd:0,dead:false};
  enemies=[e];fireArrow(e,false,false);for(let i=0;i<10;i++)updateProjectiles();
  return{kills,gems:gems.length,enemies:enemies.filter(x=>!x.dead).length,arrows:arrows.length};
};`;

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};

console.log('1) autonomous runs: 3 x 3 simulated minutes');
for(let run=1;run<=3;run++){
  const game=bootGame('wordfall',{seed:0x720100+run,footer:FOOTER});
  game.frames(10800,false);const p=game.sandbox.__probe();
  console.log(`  run ${run}: ${p.kills} kills, ${p.deaths} deaths, max swarm ${p.maxEnemies}`);
  if(!p.finite)fail(`run ${run}: non-finite actor state`);
  if(p.kills<100||p.kills>180)fail(`run ${run}: ${p.kills} kills outside competence band 100..180`);
  if(p.deaths<3||p.deaths>9)fail(`run ${run}: ${p.deaths} deaths outside watchable band 3..9`);
  if(p.maxEnemies<5||p.maxEnemies>20)fail(`run ${run}: max swarm ${p.maxEnemies} outside band 5..20`);
  if(p.resets<p.deaths-1)fail(`run ${run}: dead attract run did not restart`);
}

console.log('2) mechanics: duplicate-safe marks, rune solve, real projectile kill');
let game=bootGame('wordfall',{seed:0x720200,footer:FOOTER});
const word=game.sandbox.__wordFixture(),shot=game.sandbox.__projectileFixture();
console.log(`  marks ${word.marks.join('/')}; solve floor ${word.floorNo}; shot ${shot.kills} kill/${shot.gems} gem`);
if(word.marks.join(',')!=='green,miss,miss,yellow,green')fail('Wordle mark accounting regressed');
if(word.solves!==1||word.floorNo!==1||word.greenRunes!==5||word.yellowRunes!==0)
  fail('correct altar did not grant the expected rune/floor progress');
if(word.altars!==0||word.chargeNeed!==21||word.puzzleDone!=='solved')fail('solved altar cleanup/progression regressed');
if(shot.kills!==1||shot.gems!==1||shot.enemies!==0||shot.arrows!==0)fail('arrow-to-kill-to-gem loop regressed');

console.log('3) session + manual movement: Enter gate, run, double jump, dodge');
game=bootGame('wordfall',{seed:0x720300,footer:FOOTER});
if(game.sandbox.__probe().playing)fail('session started in playing mode');
press(game,'Enter');if(game.sandbox.__probe().playing)fail('first Enter skipped instructions');
press(game,'Enter');if(!game.sandbox.__probe().playing)fail('second Enter did not start play');
const x0=game.sandbox.__probe().player.x;
game.key('keydown','ArrowRight');game.frames(20,false);game.key('keyup','ArrowRight');
const moved=game.sandbox.__probe();press(game,'ArrowUp');const jump1=game.sandbox.__probe();
press(game,'ArrowUp');const jump2=game.sandbox.__probe();press(game,'Space');const dodged=game.sandbox.__probe();
console.log(`  moved ${(moved.player.x-x0).toFixed(1)}px, jumps ${jump1.player.jumps}->${jump2.player.jumps}, dodge ${dodged.player.dodge}f`);
if(moved.player.x-x0<8)fail('manual right input did not move the player');
if(jump1.player.jumps!==1||jump1.player.vy>=0)fail('manual ground jump failed');
if(jump2.player.jumps!==2||jump2.player.vy>=0)fail('manual air jump failed');
if(dodged.player.dodge<=0||dodged.player.inv<=0)fail('manual dodge did not grant movement/invulnerability');
if(!dodged.finite)fail('manual mechanics produced non-finite state');

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
