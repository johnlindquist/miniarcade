#!/usr/bin/env node
'use strict';
const{bootGame}=require('./harness');

const FOOTER=`
globalThis.__ssEval={matches:0,wrecks:0,kills:[0,0,0,0],deaths:[0,0,0,0],
  uses:{DISC:0,MINE:0,FLUX:0},hits:{DISC:0,MINE:0,FLUX:0},pickups:0,pulses:0,
  phases:new Set(),finite:true,entityFinite:true,arenaSafe:true,cannonHits:0,rams:0,maxShots:0,maxMines:0};
const __wreck0=wreckCar;wreckCar=function(victim,source,kind){
  const before=cars.map(c=>c.kills),deathsBefore=victim.deaths,out=__wreck0(victim,source,kind);
  if(victim.deaths>deathsBefore){__ssEval.wrecks++;__ssEval.deaths[victim.id]++;
    cars.forEach((c,i)=>__ssEval.kills[i]+=c.kills-before[i]);}return out;};
const __special0=useSpecial;useSpecial=function(car){const type=car.weapon,out=__special0(car);
  if(out)__ssEval.uses[type]++;return out;};
const __damage0=damageCar;damageCar=function(victim,amount,source,kind,...rest){
  const out=__damage0(victim,amount,source,kind,...rest);
  if(out&&__ssEval.hits[kind]!==undefined)__ssEval.hits[kind]++;if(out&&kind==='RIVET')__ssEval.cannonHits++;return out;};
const __pickup0=collectPickup;collectPickup=function(car,pickup){const out=__pickup0(car,pickup);
  if(out)__ssEval.pickups++;return out;};
const __core0=stepCore;stepCore=function(){const before=CORE.pulses,out=__core0();
  __ssEval.pulses+=CORE.pulses-before;return out;};
const __phase0=updatePhase;updatePhase=function(){const out=__phase0();__ssEval.phases.add(roundPhase);return out;};
const __over0=matchOver;matchOver=function(win,reason){const before=matchState,out=__over0(win,reason);
  if(before!=='over'&&matchState==='over')__ssEval.matches++;return out;};
const __collisions0=carCollisions;carCollisions=function(){const before=ramHits,out=__collisions0();
  __ssEval.rams+=ramHits-before;return out;};
const __physics0=physicsStep;physicsStep=function(){const out=__physics0();
  __ssEval.maxShots=Math.max(__ssEval.maxShots,shots.length);__ssEval.maxMines=Math.max(__ssEval.maxMines,mines.length);
  if(!cars.every(c=>[c.x,c.y,c.vx,c.vy,c.a,c.hp,c.nitro].every(Number.isFinite)))__ssEval.finite=false;
  if(![...shots,...mines].every(item=>[item.x,item.y,item.vx===undefined?0:item.vx,item.vy===undefined?0:item.vy,item.ttl].every(Number.isFinite)))__ssEval.entityFinite=false;
  if(cars.some(c=>active(c)&&(c.x<ARENA.x0||c.x>ARENA.x1||c.y<ARENA.y0||c.y>ARENA.y1||pointInWall(c.x,c.y,0))))__ssEval.arenaSafe=false;
  return out;};
globalThis.__ssProbe=()=>({matches:__ssEval.matches,wrecks:__ssEval.wrecks,kills:[...__ssEval.kills],
  deaths:[...__ssEval.deaths],uses:{...__ssEval.uses},hits:{...__ssEval.hits},pickups:__ssEval.pickups,
  pulses:__ssEval.pulses,phases:[...__ssEval.phases],finite:__ssEval.finite,entityFinite:__ssEval.entityFinite,
  arenaSafe:__ssEval.arenaSafe,cannonHits:__ssEval.cannonHits,rams:__ssEval.rams,
  maxShots:__ssEval.maxShots,maxMines:__ssEval.maxMines,state:matchState,clock,
  cars:cars.map(c=>({x:c.x,y:c.y,vx:c.vx,vy:c.vy,hp:c.hp,lives:c.lives,kills:c.kills,
    weapon:c.weapon,ammo:c.ammo,nitro:c.nitro,mode:c.aiMode,shots:c.shots,specials:c.specials}))});
globalThis.__ssWeaponFixture=type=>{
  resetGame();matchState='play';shots=[];mines=[];barrels.forEach(b=>b.dead=1e9);
  const attacker=cars[0],victim=cars[1];cars[2].lives=cars[3].lives=0;cars[2].dead=cars[3].dead=1e9;
  Object.assign(attacker,{x:45,y:58,a:0,vx:0,vy:0,weapon:type,ammo:WAMMO[type],specialCd:0,inv:0});
  Object.assign(victim,{x:type==='MINE'?37:57,y:58,a:Math.PI,vx:0,vy:0,hp:victim.maxHp,inv:0,dead:0,lives:3});
  const before=victim.hp,ammo=attacker.ammo,ok=useSpecial(attacker);
  for(let i=0;i<100;i++){frame++;if(type==='MINE')stepMines();else stepShots();}
  return{ok,ammoBefore:ammo,ammoAfter:attacker.ammo,damage:before-victim.hp,
    shots:shots.length,mines:mines.length};
};
globalThis.__ssPickupFixture=()=>{
  resetGame();const car=cars[0],repair=pickups.find(p=>p.type==='repair'),
    weapon=pickups.find(p=>p.type==='weapon'),nitro=pickups.find(p=>p.type==='nitro');
  car.hp=1;car.ammo=0;car.nitro=0;
  const repaired=collectPickup(car,repair),armed=collectPickup(car,weapon),filled=collectPickup(car,nitro);
  return{repaired,armed,filled,hp:car.hp,weapon:car.weapon,ammo:car.ammo,nitro:car.nitro,
    timers:[repair.t,weapon.t,nitro.t]};
};
globalThis.__ssBarrelFixture=()=>{
  resetGame();matchState='play';const attacker=cars[0],victim=cars[1],barrel=barrels[0];
  Object.assign(attacker,{x:barrel.x-20,y:barrel.y,inv:0});
  Object.assign(victim,{x:barrel.x+8,y:barrel.y,hp:victim.maxHp,inv:0});
  cars[2].lives=cars[3].lives=0;const before=victim.hp,booms=explosions;
  damageBarrel(barrel,2,attacker);
  return{dead:barrel.dead,damage:before-victim.hp,explosions:explosions-booms};
};
globalThis.__ssCoreFixture=()=>{
  resetGame();matchState='play';const car=cars[0];cars.slice(1).forEach(other=>{other.lives=0;other.dead=1e9;});
  Object.assign(car,{x:CORE.x+CORE.r,y:CORE.y,vx:0,vy:0,hp:car.maxHp,inv:0});
  roundPhase='OPEN SHIFT';CORE.t=phasePeriod()-62;frame=0;const before=car.hp;stepCore();
  return{state:CORE.state,pulses:CORE.pulses,damage:before-car.hp,vx:car.vx,vy:car.vy};
};
globalThis.__ssRamFixture=()=>{
  resetGame();matchState='play';const attacker=cars[0],victim=cars[1];cars[2].lives=cars[3].lives=0;
  Object.assign(attacker,{x:50,y:60,vx:2.5,vy:0,a:0,inv:0,ramCd:0,boosting:true});
  Object.assign(victim,{x:61.5,y:60,vx:-.5,vy:0,a:Math.PI,hp:victim.maxHp,inv:0,ramCd:0});
  const before=victim.hp;carCollisions();return{damage:before-victim.hp,ramHits,attackerCd:attacker.ramCd,victimCd:victim.ramCd};
};
globalThis.__ssAiFixture=()=>{
  resetGame();CORE.state='idle';mines=[];shots=[];const car=cars[0],repair=pickups.find(p=>p.type==='repair');
  Object.assign(car,{x:45,y:55,a:0,hp:1,escape:0,retarget:0});Object.assign(repair,{x:62,y:55,t:0});
  const intent=decide(car);return{mode:car.aiMode,intent,repair:{x:repair.x,y:repair.y}};
};
globalThis.__ssCannonFixture=()=>{
  resetGame();matchState='play';shots=[];mines=[];barrels.forEach(b=>b.dead=1e9);
  const attacker=cars[0],victim=cars[1];cars[2].lives=cars[3].lives=0;cars[2].dead=cars[3].dead=1e9;
  Object.assign(attacker,{x:45,y:58,a:0,vx:0,vy:0,gunCd:0,inv:0,kills:0});
  Object.assign(victim,{x:62,y:58,vx:0,vy:0,hp:.5,inv:0,dead:0,lives:3});
  const fired=fireCannon(attacker);for(let i=0;i<20;i++){frame++;stepShots();}
  return{fired,shots:shots.length,kills:attacker.kills,victimLives:victim.lives,victimDead:victim.dead};
};
globalThis.__ssChainFixture=()=>{
  resetGame();matchState='play';shots=[];mines=[];const attacker=cars[0],victim=cars[1],first=barrels[0],second=barrels[1];
  barrels.slice(2).forEach(b=>b.dead=1e9);cars[2].lives=cars[3].lives=0;cars[2].dead=cars[3].dead=1e9;
  Object.assign(attacker,{x:45,y:60,a:0,vx:0,vy:0,gunCd:0,inv:0});Object.assign(victim,{x:76,y:60,hp:victim.maxHp,inv:0});
  Object.assign(first,{x:58,y:60,hp:1,dead:0});Object.assign(second,{x:68,y:60,hp:2,dead:0});
  const before=victim.hp,booms=explosions,fired=fireCannon(attacker);for(let i=0;i<8;i++){frame++;stepShots();}
  const chained={fired,first:first.dead,second:second.dead,damage:before-victim.hp,explosions:explosions-booms};
  for(let i=0;i<600;i++)stepPickups();
  return{...chained,respawned:first.dead===0&&second.dead===0&&first.hp===2&&second.hp===2};
};
globalThis.__ssLifeFixture=()=>{
  resetGame();matchState='play';const attacker=cars[0],victim=cars[1],idle={steer:0,throttle:0,boost:false,fire:false,special:false};
  victim.inv=0;victim.hp=.1;wreckCar(victim,attacker,'RIVET');const wrecked={lives:victim.lives,dead:victim.dead,kills:attacker.kills};
  for(let i=0;i<112;i++)carStep(victim,idle);const respawned={lives:victim.lives,dead:victim.dead,hp:victim.hp,inv:victim.inv};
  resetGame();matchState='play';clock=0;cars.forEach(c=>{c.kills=1;c.lives=3;c.hp=c.maxHp;});checkMatch();const tied={overtime,state:matchState};
  cars[1].inv=0;cars[1].hp=.1;wreckCar(cars[1],cars[0],'RIVET');const sudden={state:matchState,winner:winner&&winner.id};
  resetGame();matchState='play';cars[1].lives=cars[2].lives=cars[3].lives=0;checkMatch();const last={state:matchState,winner:winner&&winner.id};
  resetGame();matchState='play';clock=30*60;updatePhase();const phase=roundPhase;
  return{wrecked,respawned,tied,sudden,last,phase};
};
globalThis.__ssRepairRun=()=>{
  resetGame();matchState='play';CORE.state='idle';mines=[];shots=[];const car=cars[0],repair=pickups.find(p=>p.type==='repair');
  cars.slice(1).forEach(other=>{other.lives=0;other.dead=1e9;});pickups.filter(p=>p!==repair).forEach(p=>p.t=1e9);
  Object.assign(car,{x:45,y:55,a:0,vx:0,vy:0,hp:1,escape:0,retarget:0});Object.assign(repair,{x:62,y:55,t:0});
  let steps=0;for(;steps<240&&car.hp===1;steps++){frame++;carStep(car);stepPickups();}
  return{steps,hp:car.hp,pickupT:repair.t,distance:Math.hypot(car.x-repair.x,car.y-repair.y)};
};
globalThis.__ssWinFixture=()=>{
  resetGame();matchState='play';cars[0].kills=4;const before=playing();matchOver(cars[0],'LAST RIG');
  return{before,after:playing(),state:matchState,winner:winner&&winner.id};
};
`;

let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true;};
const press=(game,code,frames=1)=>{game.key('keydown',code);game.frames(frames,false);game.key('keyup',code);};

console.log('1) autonomous press yard: 3 seeded 400-second shifts');
for(let run=1;run<=3;run++){
  const game=bootGame('scrapshift',{seed:0x551f00+run,footer:FOOTER});
  game.frames(24000,false);const p=game.sandbox.__ssProbe();
  console.log(`  run ${run}: ${p.matches} matches, ${p.wrecks} wrecks, kills ${p.kills.join('/')}, `+
    `specials ${p.uses.DISC}/${p.uses.MINE}/${p.uses.FLUX}, pickups ${p.pickups}, press pulses ${p.pulses}`);
  if(!p.finite)fail(`run ${run}: non-finite vehicle state`);
  if(!p.entityFinite)fail(`run ${run}: non-finite projectile or mine state`);
  if(!p.arenaSafe)fail(`run ${run}: a living rig escaped the arena or remained inside a wall`);
  if(p.matches<2||p.matches>7)fail(`run ${run}: ${p.matches} completed matches outside 2..7`);
  if(p.wrecks<30||p.wrecks>75)fail(`run ${run}: ${p.wrecks} wrecks outside watchable band 30..75`);
  if(p.kills.some(k=>k<4))fail(`run ${run}: at least one rig never fought competently (${p.kills.join('/')})`);
  if(Object.values(p.uses).some(n=>n<10))fail(`run ${run}: an equipped special stayed unused (${JSON.stringify(p.uses)})`);
  if(Object.values(p.hits).some(n=>n<4))fail(`run ${run}: a special never landed consistently (${JSON.stringify(p.hits)})`);
  if(p.cannonHits<40)fail(`run ${run}: rivet cannons landed only ${p.cannonHits} hits`);
  if(p.rams<12)fail(`run ${run}: vehicle combat produced only ${p.rams} damaging rams`);
  if(p.pickups<60)fail(`run ${run}: only ${p.pickups} supply pickups collected`);
  if(p.pulses<15)fail(`run ${run}: magnetic press pulsed only ${p.pulses} times`);
  if(!p.phases.includes('OPEN SHIFT')||!p.phases.includes('MAGNET HOT'))fail(`run ${run}: escalation phases missing (${p.phases.join(', ')})`);
  if(p.maxShots>18||p.maxMines>10)fail(`run ${run}: projectile clutter reached ${p.maxShots} shots / ${p.maxMines} mines`);
}

console.log('2) arsenal contracts: each limited weapon spends one charge and deals damage');
let game=bootGame('scrapshift',{seed:0x551f80,footer:FOOTER});
for(const type of['DISC','MINE','FLUX']){
  const p=game.sandbox.__ssWeaponFixture(type);
  console.log(`  ${type.toLowerCase()}: ${p.damage.toFixed(2)} damage, ammo ${p.ammoBefore} -> ${p.ammoAfter}`);
  if(!p.ok||p.ammoAfter!==p.ammoBefore-1)fail(`${type}: did not consume exactly one charge`);
  if(p.damage<1.5)fail(`${type}: dealt only ${p.damage.toFixed(2)} fixture damage`);
  if(p.shots!==0||p.mines!==0)fail(`${type}: fixture left a live projectile behind`);
}

console.log('3) yard systems: supplies, projectile chain, press pull, boost ram, and repair routing');
const supply=game.sandbox.__ssPickupFixture(),barrel=game.sandbox.__ssBarrelFixture(),
  core=game.sandbox.__ssCoreFixture(),ram=game.sandbox.__ssRamFixture(),ai=game.sandbox.__ssAiFixture(),
  cannon=game.sandbox.__ssCannonFixture(),chain=game.sandbox.__ssChainFixture(),repair=game.sandbox.__ssRepairRun(),
  life=game.sandbox.__ssLifeFixture();
console.log(`  supplies: ${supply.hp} HP, ${supply.weapon} x${supply.ammo}, ${supply.nitro} nitro`);
console.log(`  barrel: ${barrel.damage.toFixed(2)} splash / ${chain.explosions} chained blasts; press: ${core.damage.toFixed(2)} damage / vx ${core.vx.toFixed(2)}; ram: ${ram.damage.toFixed(2)} damage`);
console.log(`  cannon credited ${cannon.kills} wreck; repair route completed in ${repair.steps}f; overtime winner ${life.sudden.winner}`);
if(!supply.repaired||!supply.armed||!supply.filled||supply.hp!==6||supply.weapon!=='DISC'||supply.ammo!==3||supply.nitro!==100)
  fail(`supply contract regressed: ${JSON.stringify(supply)}`);
if(supply.timers.some(t=>t<=0))fail('collected supply pads did not enter cooldown');
if(barrel.dead!==600||barrel.damage<2||barrel.explosions!==1)fail(`barrel chain contract regressed: ${JSON.stringify(barrel)}`);
if(core.state!=='active'||core.pulses!==1||core.damage<=0||core.vx>=0)fail(`magnetic press contract regressed: ${JSON.stringify(core)}`);
if(ram.damage<2||ram.ramHits!==1||ram.attackerCd<=0||ram.victimCd<=0)fail(`ram collision contract regressed: ${JSON.stringify(ram)}`);
if(ai.mode!=='REPAIR'||!Number.isFinite(ai.intent.steer)||Math.abs(ai.intent.steer)>.2||ai.intent.throttle<=0)fail(`low-health repair tactic regressed: ${JSON.stringify(ai)}`);
if(!cannon.fired||cannon.shots!==0||cannon.kills!==1||cannon.victimLives!==2||cannon.victimDead<=0)fail(`rivet damage/credit contract regressed: ${JSON.stringify(cannon)}`);
if(!chain.fired||chain.first<=0||chain.second<=0||chain.explosions!==2||chain.damage<=0||!chain.respawned)fail(`projectile barrel chain/respawn regressed: ${JSON.stringify(chain)}`);
if(repair.hp!==6||repair.pickupT<=0||repair.steps>=240)fail(`repair-seeking AI never completed its route: ${JSON.stringify(repair)}`);
if(life.wrecked.lives!==2||life.wrecked.dead!==112||life.wrecked.kills!==1||life.respawned.dead!==0||life.respawned.hp!==15||
  !life.tied.overtime||life.tied.state!=='play'||life.sudden.state!=='over'||life.sudden.winner!==0||
  life.last.state!=='over'||life.last.winner!==0||life.phase!=='REDLINE')fail(`match lifecycle regressed: ${JSON.stringify(life)}`);

console.log('4) session + manual takeover: two-stage Enter, drive, cannon, special, nitro');
game=bootGame('scrapshift',{seed:0x551fc0,footer:FOOTER});
let p=game.sandbox.__ssProbe();if(p.cars[0].shots!==0)fail('fresh player rig already fired');
press(game,'Enter');if(game.sandbox.__ssProbe().state!=='countdown'||game.sandbox.__engine.playing())fail('first Enter skipped instructions');
press(game,'Enter');if(!game.sandbox.__engine.playing())fail('second Enter did not start the scored run');
game.frames(125,false);const before=game.sandbox.__ssProbe().cars[0];
game.key('keydown','ArrowUp');game.key('keydown','ArrowRight');game.key('keydown','ShiftLeft');game.frames(60,false);
game.key('keyup','ArrowUp');game.key('keyup','ArrowRight');game.key('keyup','ShiftLeft');
const driven=game.sandbox.__ssProbe().cars[0],travel=Math.hypot(driven.x-before.x,driven.y-before.y);
press(game,'Space');const fired=game.sandbox.__ssProbe().cars[0];press(game,'KeyX');const armed=game.sandbox.__ssProbe().cars[0];
console.log(`  drove ${travel.toFixed(1)}px, nitro ${before.nitro.toFixed(1)} -> ${driven.nitro.toFixed(1)}, cannon ${fired.shots}, ammo ${fired.ammo} -> ${armed.ammo}`);
if(travel<12)fail(`manual drive moved only ${travel.toFixed(1)}px`);
if(driven.nitro>=before.nitro)fail('manual nitro did not drain');
if(fired.shots<=before.shots)fail('Space did not fire the player rivet cannon');
if(armed.ammo!==fired.ammo-1||armed.specials<=fired.specials)fail('X did not consume and fire the equipped special');
if(![armed.x,armed.y,armed.vx,armed.vy,armed.hp].every(Number.isFinite))fail('manual control produced non-finite state');
const rendered=game.frames(1,true),calls=rendered.calls;console.log(`  rendered frame: ${calls} canvas commands / ${rendered.byMethod.drawImage||0} cached arena blit`);
if(calls<50||calls>280)fail(`render command count ${calls} outside expected cached-arena band 50..280`);
if((rendered.byMethod.drawImage||0)!==1)fail('render did not use exactly one cached arena blit');
const win=game.sandbox.__ssWinFixture();
if(!win.before||win.after||win.state!=='over'||win.winner!==0)fail(`scored match did not enter shared game-over state: ${JSON.stringify(win)}`);

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
