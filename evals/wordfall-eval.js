#!/usr/bin/env node
'use strict';
const{bootGame}=require('./harness');

const FOOTER=`
globalThis.__wordStats={kills:0,deaths:0,resets:0,maxEnemies:0,guesses:0,solves:0};
const __kill0=killEnemy;killEnemy=e=>{if(!e.dead)globalThis.__wordStats.kills++;return __kill0(e);};
const __hurt0=hurtPlayer;hurtPlayer=n=>{const was=mode,out=__hurt0(n);
  if(was!=='dead'&&mode==='dead')globalThis.__wordStats.deaths++;return out;};
const __reset0=resetGame;resetGame=k=>{globalThis.__wordStats.resets++;return __reset0(k);};
// solves is per-life power state, so cumulative word progress is counted here.
const __choose0=chooseAltar;chooseAltar=a=>{const live=a&&altars.includes(a),s0=solves;
  const out=__choose0(a);
  if(live){globalThis.__wordStats.guesses++;if(solves>s0)globalThis.__wordStats.solves++;}
  return out;};
const __combat0=updateCombat;updateCombat=()=>{const out=__combat0();
  globalThis.__wordStats.maxEnemies=Math.max(globalThis.__wordStats.maxEnemies,enemies.length);return out;};
globalThis.__probe=()=>{
  const actors=[P,...enemies,...arrows,...gems,...shots,...altars,...arrows.flatMap(a=>a.trail)];
  return{...globalThis.__wordStats,playing:playing(),mode,
    player:{x:P.x,y:P.y,vx:P.vx,vy:P.vy,jumps:P.jumps,dodge:P.dodge,inv:P.inv},
    finite:actors.every(o=>['x','y','vx','vy','hp'].every(k=>o[k]===undefined||Number.isFinite(o[k])))
  };
};
globalThis.__persistFixture=()=>{
  resetGame();target='ARROW';guesses=[{word:'SLATE',marks:markWord('ARROW','SLATE')}];
  P.hp=1;P.inv=0;P.dodge=0;hurtPlayer(1);
  for(let i=0;i<120;i++)step(); // attract death timer fires resetGame(true)
  const kept={guesses:guesses.length,target,mode};
  resetGame(); // a fresh player session must not inherit attract clues
  return{kept,freshGuesses:guesses.length};
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
  console.log(`  run ${run}: ${p.kills} kills, ${p.deaths} deaths, max swarm ${p.maxEnemies}, `+
    `${p.solves} solves in ${p.guesses} guesses`);
  if(!p.finite)fail(`run ${run}: non-finite actor state`);
  if(p.kills<100||p.kills>180)fail(`run ${run}: ${p.kills} kills outside competence band 100..180`);
  if(p.deaths<3||p.deaths>9)fail(`run ${run}: ${p.deaths} deaths outside watchable band 3..9`);
  if(p.maxEnemies<5||p.maxEnemies>20)fail(`run ${run}: max swarm ${p.maxEnemies} outside band 5..20`);
  if(p.resets<p.deaths-1)fail(`run ${run}: dead attract run did not restart`);
  if(p.solves<1)fail(`run ${run}: the headline Wordle mechanic never completed a word`);
  if(p.guesses<3)fail(`run ${run}: only ${p.guesses} altar guesses — rune rounds are not flowing`);
  if(p.guesses<=p.solves)fail(`run ${run}: ${p.solves} solves in ${p.guesses} guesses — solver looks omniscient`);
}

console.log('2) mechanics: duplicate-safe marks, rune solve, real projectile kill, story persistence');
let game=bootGame('wordfall',{seed:0x720200,footer:FOOTER});
const kept=game.sandbox.__persistFixture();
const word=game.sandbox.__wordFixture(),shot=game.sandbox.__projectileFixture();
console.log(`  marks ${word.marks.join('/')}; solve floor ${word.floorNo}; shot ${shot.kills} kill/${shot.gems} gem; `+
  `death kept ${kept.kept.guesses} clue(s), fresh session ${kept.freshGuesses}`);
if(kept.kept.guesses!==1||kept.kept.target!=='ARROW'||kept.kept.mode!=='combat')
  fail('attract death dropped the half-solved rune word');
if(kept.freshGuesses!==0)fail('fresh session inherited attract-mode clues');
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

console.log('4) rune storm act + show ladder: telegraphed, survivor clears the lanes');
{
  const FOOT=`
;globalThis.__storm=()=>({phase:stormPhase,x:[...stormX]});
globalThis.__px=()=>P.x;
globalThis.__showP=()=>SHOW.probe();globalThis.__showE=()=>SHOW.events();
globalThis.__stats=()=>({kills,solves,deaths:0});
globalThis.__sig=()=>Math.round(P.x*31+P.y*7)+kills*1009+solves*31337+enemies.length*13+Math.round(charge)*7;`;
  const a=bootGame('wordfall',{seed:0x720601,footer:FOOT});
  const b=bootGame('wordfall',{seed:0x720601,footer:FOOT});
  b.sandbox.__NO_ACTS=1;
  const laneDist=(x,lanes)=>Math.min(...lanes.map(sx=>{
    let dx=Math.abs(x-sx);return Math.min(dx,160-dx);}));
  let liveSamples=0,distA=0,distB=0;
  for(let f=0;f<10800;f+=20){
    a.frames(20,false);b.frames(20,false);
    const s=a.sandbox.__storm();
    if(s.phase==='live'){liveSamples++;
      distA+=laneDist(a.sandbox.__px(),s.x);distB+=laneDist(b.sandbox.__px(),s.x);}
  }
  const ev=a.sandbox.__showE(),p=a.sandbox.__showP();
  const storms=[];let pend=null;
  for(const e of ev){
    if(e.kind==='act-warning'&&e.id==='storm')pend=e;
    else if(e.kind==='act-land'&&e.id==='storm'&&pend){storms.push(e.tag-pend.tag);pend=null;}
  }
  const o=p.offeredByTier,s3=p.shownByTier[3]||0;
  console.log(`  ${storms.length} storms landed (telegraphs ${storms.join(',')} run-frames), `+
    `live lane distance ${liveSamples?(distA/liveSamples).toFixed(1):'?'} vs unaware ${liveSamples?(distB/liveSamples).toFixed(1):'?'}, `+
    `tiers ${JSON.stringify(o)}, spellbounds ${s3} (held ${p.heldFrames}f)`);
  if(storms.length<2)fail(`only ${storms.length} telegraphed storms landed in 3 minutes`);
  for(const t of storms)if(t<180||t>300)fail(`storm telegraph ${t} run-frames outside 180..300`);
  if(liveSamples<20)fail(`storm live phase barely observable (${liveSamples} samples)`);
  if(distA<=distB)fail(`survivor ignored the storm lanes (${(distA/Math.max(1,liveSamples)).toFixed(1)} vs ${(distB/Math.max(1,liveSamples)).toFixed(1)})`);
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)))fail(`ladder opportunities not strictly ordered (${JSON.stringify(o)})`);
  if(s3>=1&&p.heldFrames!==6*s3)fail(`spellbound hitstop ${p.heldFrames}f != 6f per solve (${s3})`);
  const c=bootGame('wordfall',{seed:0x720611,footer:FOOT});
  const d=bootGame('wordfall',{seed:0x720611,footer:FOOT});
  d.sandbox.__NO_PAYOFF_FX=1;
  c.frames(10800,false);d.frames(10800,false);
  if(c.sandbox.__sig()!==d.sandbox.__sig())fail('__NO_PAYOFF_FX changed the sim: payoff confetti leaked into gameplay');
  else console.log('  __NO_PAYOFF_FX: sim signatures identical over 3 minutes');
}

console.log('5) ten-minute soak: moving, happening, progressing');
{
  const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
  const SOAK_FOOTER=`
;globalThis.__soakN={events:0,progress:0};
{const k0=killEnemy;killEnemy=e=>{if(!e.dead)globalThis.__soakN.events++;return k0(e);};
 const c0=chooseAltar;chooseAltar=a=>{const live=a&&altars.includes(a),s0=solves;const out=c0(a);
   if(live){globalThis.__soakN.progress++;if(solves>s0)globalThis.__soakN.progress+=3;}return out;};}
globalThis.__soakProbe=()=>({sig:Math.round(P.x*7+P.y*13)+enemies.length*1009,
  events:globalThis.__soakN.events,progress:globalThis.__soakN.progress,
  finite:[P,...enemies].every(o=>['x','y'].every(k=>Number.isFinite(o[k])))});`;
  const{samples}=runSoak('wordfall',{seed:0x720501,footer:SOAK_FOOTER,minutes:10});
  const report=analyzeSoak(samples);
  console.log('  '+soakLine(report));
  // re-measured 2026-07-09 with the rune storm: stall 39-65s on 0x720501/02
  // (was 55-174s — storm bolts kill swarms whose gems feed the altar economy,
  // closing the AI-AUDIT story-cadence gap), quiet 5s, 673-718 ev, 44-49 prog
  assertSoak('soak',report,{still:10,quiet:20,stall:120,minEvents:450,minProgress:25},fail);
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
