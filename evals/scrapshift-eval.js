#!/usr/bin/env node
'use strict';
const{bootGame}=require('./harness');

const FOOTER=`
globalThis.__ssEval={matches:0,wrecks:0,kills:[0,0,0,0],deaths:[0,0,0,0],
  uses:{DISC:0,MINE:0,FLUX:0},hits:{DISC:0,MINE:0,FLUX:0},pickups:0,pulses:0,
  phases:new Set(),finite:true,entityFinite:true,arenaSafe:true,cannonHits:0,rams:0,maxShots:0,maxMines:0,
  activeSteps:0,lowSteps:0,wallContacts:0,unsafeSpecials:0,validTargets:0,invalidTargets:0,
  damageLull:0,maxDamageLull:0,directorDrops:0,directorSweeps:0,wins:[0,0,0,0],
  modes:[new Set(),new Set(),new Set(),new Set()]};
const __wreck0=wreckCar;wreckCar=function(victim,source,kind){
  const before=cars.map(c=>c.kills),deathsBefore=victim.deaths,out=__wreck0(victim,source,kind);
  if(victim.deaths>deathsBefore){__ssEval.wrecks++;__ssEval.deaths[victim.id]++;
    cars.forEach((c,i)=>__ssEval.kills[i]+=c.kills-before[i]);}return out;};
const __special0=useSpecial;useSpecial=function(car){const type=car.weapon,out=__special0(car);
  if(out){__ssEval.uses[type]++;if(/DODGE|ESCAPE|REPAIR|REARM|REFUEL|REPLAN/.test(car.aiMode))__ssEval.unsafeSpecials++;}return out;};
const __damage0=damageCar;damageCar=function(victim,amount,source,kind,...rest){
  const out=__damage0(victim,amount,source,kind,...rest);
  if(out){__ssEval.damageLull=0;if(__ssEval.hits[kind]!==undefined)__ssEval.hits[kind]++;if(kind==='RIVET')__ssEval.cannonHits++;}return out;};
const __pickup0=collectPickup;collectPickup=function(car,pickup){const out=__pickup0(car,pickup);
  if(out)__ssEval.pickups++;return out;};
const __core0=stepCore;stepCore=function(){const before=CORE.pulses,out=__core0();
  __ssEval.pulses+=CORE.pulses-before;return out;};
const __phase0=updatePhase;updatePhase=function(){const out=__phase0();__ssEval.phases.add(roundPhase);return out;};
const __over0=matchOver;matchOver=function(win,reason){const before=matchState,out=__over0(win,reason);
  if(before!=='over'&&matchState==='over'){__ssEval.matches++;if(win)__ssEval.wins[win.id]++;}return out;};
const __collisions0=carCollisions;carCollisions=function(){const before=ramHits,out=__collisions0();
  __ssEval.rams+=ramHits-before;return out;};
const __carStep0=carStep;carStep=function(car,intent){const walls=car.wallHits,out=__carStep0(car,intent);
  if(matchState==='play'&&active(car)){__ssEval.activeSteps++;if(Math.hypot(car.vx,car.vy)<.38)__ssEval.lowSteps++;
    __ssEval.wallContacts+=car.wallHits-walls;__ssEval.modes[car.id].add(car.aiMode);
    if(active(cars[car.target]))__ssEval.validTargets++;else __ssEval.invalidTargets++;}return out;};
const __reset0=resetGame;resetGame=function(){const out=__reset0();__ssEval.damageLull=0;return out;};
const __physics0=physicsStep;physicsStep=function(){const drops=director.drops,sweeps=director.sweeps;
  if(matchState==='play'){__ssEval.damageLull++;__ssEval.maxDamageLull=Math.max(__ssEval.maxDamageLull,__ssEval.damageLull);}
  const out=__physics0();__ssEval.directorDrops+=Math.max(0,director.drops-drops);__ssEval.directorSweeps+=Math.max(0,director.sweeps-sweeps);
  __ssEval.maxShots=Math.max(__ssEval.maxShots,shots.length);__ssEval.maxMines=Math.max(__ssEval.maxMines,mines.length);
  if(!cars.every(c=>[c.x,c.y,c.vx,c.vy,c.a,c.hp,c.nitro].every(Number.isFinite)))__ssEval.finite=false;
  if(![...shots,...mines].every(item=>[item.x,item.y,item.vx===undefined?0:item.vx,item.vy===undefined?0:item.vy,item.ttl].every(Number.isFinite)))__ssEval.entityFinite=false;
  if(cars.some(c=>active(c)&&(c.x<ARENA.x0||c.x>ARENA.x1||c.y<ARENA.y0||c.y>ARENA.y1||pointInWall(c.x,c.y,0))))__ssEval.arenaSafe=false;
  return out;};
globalThis.__ssProbe=()=>({matches:__ssEval.matches,wrecks:__ssEval.wrecks,kills:[...__ssEval.kills],
  deaths:[...__ssEval.deaths],uses:{...__ssEval.uses},hits:{...__ssEval.hits},pickups:__ssEval.pickups,
  pulses:__ssEval.pulses,phases:[...__ssEval.phases],finite:__ssEval.finite,entityFinite:__ssEval.entityFinite,
  arenaSafe:__ssEval.arenaSafe,cannonHits:__ssEval.cannonHits,rams:__ssEval.rams,
  maxShots:__ssEval.maxShots,maxMines:__ssEval.maxMines,state:matchState,clock,wins:[...__ssEval.wins],
  wallRate:__ssEval.wallContacts/Math.max(1,__ssEval.activeSteps),lowRate:__ssEval.lowSteps/Math.max(1,__ssEval.activeSteps),
  invalidTargetRate:__ssEval.invalidTargets/Math.max(1,__ssEval.validTargets+__ssEval.invalidTargets),
  unsafeSpecials:__ssEval.unsafeSpecials,maxDamageLull:__ssEval.maxDamageLull,
  directorDrops:__ssEval.directorDrops,directorSweeps:__ssEval.directorSweeps,modes:__ssEval.modes.map(set=>[...set]),
  cars:cars.map(c=>({x:c.x,y:c.y,vx:c.vx,vy:c.vy,hp:c.hp,lives:c.lives,kills:c.kills,
    weapon:c.weapon,ammo:c.ammo,nitro:c.nitro,mode:c.aiMode,shots:c.shots,specials:c.specials}))});
globalThis.__ssWeaponFixture=type=>{
  resetGame();matchState='play';shots=[];mines=[];barrels.forEach(b=>b.dead=1e9);
  const attacker=cars[0],victim=cars[1];cars[2].lives=cars[3].lives=0;cars[2].dead=cars[3].dead=1e9;
  Object.assign(attacker,{x:45,y:58,a:0,aimA:0,vx:0,vy:0,weapon:type,ammo:WAMMO[type],specialCd:0,inv:0});
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
  Object.assign(attacker,{x:45,y:58,a:0,aimA:0,vx:0,vy:0,gunCd:0,inv:0,kills:0});
  Object.assign(victim,{x:62,y:58,vx:0,vy:0,hp:.5,inv:0,dead:0,lives:3});
  const fired=fireCannon(attacker);for(let i=0;i<20;i++){frame++;stepShots();}
  return{fired,shots:shots.length,kills:attacker.kills,victimLives:victim.lives,victimDead:victim.dead};
};
globalThis.__ssChainFixture=()=>{
  resetGame();matchState='play';shots=[];mines=[];const attacker=cars[0],victim=cars[1],first=barrels[0],second=barrels[1];
  barrels.slice(2).forEach(b=>b.dead=1e9);cars[2].lives=cars[3].lives=0;cars[2].dead=cars[3].dead=1e9;
  Object.assign(attacker,{x:45,y:60,a:0,aimA:0,vx:0,vy:0,gunCd:0,inv:0});Object.assign(victim,{x:76,y:60,hp:victim.maxHp,inv:0});
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
function __ssFixture(activeIds){
  resetGame();matchState='play';roundPhase='OPEN SHIFT';CORE.state='idle';CORE.t=0;lastCoreState='idle';shots=[];mines=[];
  barrels.forEach(b=>b.dead=1e9);cars.forEach(c=>{if(activeIds.includes(c.id))Object.assign(c,{dead:0,lives:3,inv:0,vx:0,vy:0,target:-1,retarget:0,escape:0});
    else Object.assign(c,{dead:1e9,lives:0});});
}
globalThis.__ssTargetFixture=()=>{
  __ssFixture([0,1,2,3]);const hunter=cars[0];Object.assign(hunter,{x:40,y:55,a:0,aimA:0});
  Object.assign(cars[1],{x:60,y:55,hp:cars[1].maxHp,kills:0});Object.assign(cars[2],{x:100,y:55,hp:2,kills:0});
  Object.assign(cars[3],{x:70,y:55,hp:cars[3].maxHp,kills:3});
  let target=targetFor(hunter),finish={id:target.id,reason:hunter.targetReason};
  hunter.target=-1;hunter.retarget=0;cars[2].inv=30;target=targetFor(hunter);const invulnerable={id:target.id,reason:hunter.targetReason};
  cars[2].inv=0;Object.assign(cars[1],{x:70,y:55,hp:cars[1].maxHp,kills:0});Object.assign(cars[2],{x:72,y:55,hp:cars[2].maxHp-1,kills:0});
  cars[3].lives=0;hunter.target=1;hunter.retarget=20;target=targetFor(hunter);
  return{finish,invulnerable,hysteresis:{id:target.id,current:targetUtility(hunter,cars[1]),challenger:targetUtility(hunter,cars[2])}};
};
globalThis.__ssThreatFixture=()=>{
  __ssFixture([0,1]);const car=cars[0],foe=cars[1];Object.assign(car,{x:80,y:60,a:-Math.PI/2,aimA:0,nitro:80});Object.assign(foe,{x:130,y:60});
  shots=[{kind:'rivet',owner:1,x:40,y:60,vx:4.7,vy:0,a:0,ttl:30,target:-1}];
  const threat=incomingThreat(car),intent=decide(car),incoming={kind:threat&&threat.kind,t:threat&&threat.t,score:threat&&threat.score,mode:car.aiMode,intent};
  shots=[{kind:'rivet',owner:1,x:72,y:61,vx:-4.7,vy:0,a:Math.PI,ttl:30,target:-1}];const receding=incomingThreat(car);
  shots=[{kind:'rivet',owner:1,x:40,y:74,vx:4.7,vy:0,a:0,ttl:30,target:-1}];const miss=incomingThreat(car);
  shots=[];Object.assign(car,{x:60,y:60,vx:3,vy:0});mines=[{owner:1,x:105,y:60,arm:0,ttl:300,blink:0}];const mine=incomingThreat(car);
  return{incoming,receding:receding&&receding.kind,miss:miss&&miss.kind,mine:{kind:mine&&mine.kind,t:mine&&mine.t,score:mine&&mine.score}};
};
globalThis.__ssRouteFixture=()=>{
  __ssFixture([0]);const car=cars[0],repair=pickups.find(p=>p.type==='repair'),goal={x:80,y:153};
  pickups.forEach(p=>p.t=1e9);Object.assign(repair,{x:goal.x,y:goal.y,t:0});
  Object.assign(car,{x:80,y:114,a:Math.PI/2,aimA:Math.PI/2,hp:1,navX:80,navY:114,navGoalX:80,navGoalY:114,navT:0,
    goalX:80,goalY:114,bestGoal:1e9,goalT:0,progressX:80,progressY:114,progressT:0,wallHits:0});
  const direct=clearLane(car,goal,6.5),path=findDrivePath(car,goal,false).map(n=>n.id);let steps=0,inside=false,maxDistance=0,replans=0,lastMode='';
  for(;steps<240&&car.hp===1;steps++){frame++;carStep(car);stepPickups();inside||=pointInWall(car.x,car.y,6);
    maxDistance=Math.max(maxDistance,Math.hypot(car.x-goal.x,car.y-goal.y));if(car.aiMode==='REPLAN'&&lastMode!=='REPLAN')replans++;lastMode=car.aiMode;}
  const routed={direct,path,steps,hp:car.hp,pickupT:repair.t,inside,maxDistance,wallHits:car.wallHits,replans};
  __ssFixture([0]);Object.assign(cars[0],{x:14,y:153,navX:14,navY:153,navGoalX:14,navGoalY:153,navT:0});const puddleGoal={x:45,y:201},risk=laneDanger(cars[0],puddleGoal,cars[0],false),waypoint=navigate(cars[0],puddleGoal,false);
  return{...routed,puddle:{risk,waypoint,direct:clearLane(cars[0],puddleGoal,6.5)}};
};
globalThis.__ssRoleFixture=()=>{
  __ssFixture([0,1]);Object.assign(cars[0],{x:40,y:55,a:0,aimA:0});Object.assign(cars[1],{x:90,y:55,hp:5});let intent=decide(cars[0]);
  const hunter={mode:cars[0].aiMode,fire:intent.fire,special:intent.special};
  __ssFixture([0,1]);Object.assign(cars[1],{x:80,y:114,a:0,aimA:0,planT:0,stage:0});Object.assign(cars[0],{x:50,y:114,vx:1});intent=decide(cars[1]);
  const trapper={mode:cars[1].aiMode,special:intent.special,plan:[cars[1].planX,cars[1].planY],goal:[intent.goalX,intent.goalY]};
  __ssFixture([0,2]);Object.assign(cars[2],{x:35,y:180,a:0,aimA:0});Object.assign(cars[0],{x:80,y:180});intent=decide(cars[2]);
  const brawler={mode:cars[2].aiMode,boost:intent.boost,goal:[intent.goalX,intent.goalY]};
  __ssFixture([0,3]);Object.assign(cars[3],{x:40,y:300,a:0,aimA:0,orbitDir:-1,planT:0});Object.assign(cars[0],{x:100,y:300});intent=decide(cars[3]);
  const flanker={mode:cars[3].aiMode,orbit:cars[3].orbitDir,goal:[intent.goalX,intent.goalY],lateral:Math.abs(intent.goalY-cars[3].y)};
  const lead=interceptPoint({x:40,y:60,vx:0,vy:0},{x:90,y:60,vx:0,vy:1.5},4.7);
  return{hunter,trapper,brawler,flanker,lead};
};
globalThis.__ssUnsafeFixture=()=>{
  __ssFixture([0,1]);Object.assign(cars[0],{x:40,y:133,a:0,aimA:0});Object.assign(cars[1],{x:120,y:133,hp:5});let intent=decide(cars[0]);const blocked=intent.special;
  __ssFixture([0,1]);Object.assign(cars[0],{x:40,y:60,a:0,aimA:0});Object.assign(cars[1],{x:90,y:60,hp:5,inv:30});intent=decide(cars[0]);const invulnerable=intent.special;
  __ssFixture([0,1]);Object.assign(cars[1],{x:60,y:55,a:0,aimA:0,plan:'BAIT',planT:50,stage:1});Object.assign(cars[0],{x:100,y:55});intent=decide(cars[1]);const mine=intent.special;
  __ssFixture([0,2]);Object.assign(cars[2],{x:60,y:180,a:0,aimA:0});Object.assign(cars[0],{x:82,y:180});intent=decide(cars[2]);const fluxSolo=intent.special;
  __ssFixture([0,1,2]);Object.assign(cars[2],{x:60,y:180,a:0,aimA:0});Object.assign(cars[0],{x:82,y:180});Object.assign(cars[1],{x:70,y:190});intent=decide(cars[2]);
  return{blocked,invulnerable,mine,fluxSolo,fluxCluster:intent.special};
};
globalThis.__ssCollisionSafetyFixture=()=>{
  __ssFixture([0,1]);const a=cars[0],b=cars[1];Object.assign(a,{x:50,y:60,vx:-2,vy:0,hp:a.maxHp,ramCd:0});Object.assign(b,{x:61.5,y:60,vx:2,vy:0,hp:b.maxHp,ramCd:0});
  const hp=[a.hp,b.hp],rams=ramHits;carCollisions();return{damage:[hp[0]-a.hp,hp[1]-b.hp],rams:ramHits-rams,velocity:[a.vx,b.vx]};
};
globalThis.__ssBarrelAiFixture=()=>{
  __ssFixture([0,1]);const car=cars[0],foe=cars[1],barrel=barrels[0];Object.assign(barrel,{x:70,y:60,hp:2,dead:0});
  Object.assign(car,{x:45,y:60,a:0,aimA:0});Object.assign(foe,{x:78,y:60});const intent=decide(car);
  return{mode:car.aiMode,fire:intent.fire,goal:[intent.goalX,intent.goalY],finite:[intent.goalX,intent.goalY].every(Number.isFinite)};
};
globalThis.__ssDirectorFixture=()=>{
  __ssFixture([0,1]);for(let i=0;i<149;i++)stepDirector();const early={drops:director.drops,sweeps:director.sweeps};stepDirector();const drop={drops:director.drops,sweeps:director.sweeps,quiet:director.quietT};
  for(let i=0;i<89;i++)stepDirector();const beforeSweep={sweeps:director.sweeps};stepDirector();const first={sweeps:director.sweeps,next:director.nextSweep,sweepT:director.sweepT};
  const car=cars[0];cars[1].lives=0;Object.assign(car,{x:14,y:180,vx:0,vy:0,inv:0});stepCore();const pull={state:CORE.state,vx:car.vx,pulses:CORE.pulses};
  for(let i=0;i<210;i++)stepDirector();const repeat={sweeps:director.sweeps,next:director.nextSweep};car.inv=0;damageCar(car,.1,null,'RIVET');const reset={quiet:director.quietT,dropSent:director.dropSent,next:director.nextSweep};
  __ssFixture([0,1]);Object.assign(cars[0],{x:60,y:180,a:0,aimA:0});Object.assign(cars[1],{x:100,y:180});director.sweepT=50;const intent=decide(cars[0]);
  return{early,drop,beforeSweep,first,pull,repeat,reset,showdown:{mode:cars[0].aiMode,fire:intent.fire,goal:[intent.goalX,intent.goalY]}};
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
  console.log(`    intelligence: walls ${(p.wallRate*100).toFixed(1)}%, low-speed ${(p.lowRate*100).toFixed(1)}%, `+
    `invalid targets ${(p.invalidTargetRate*100).toFixed(2)}%, max lull ${p.maxDamageLull}f, director ${p.directorDrops}/${p.directorSweeps}`);
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
  if(p.wallRate>.03)fail(`run ${run}: wall contacts ${(p.wallRate*100).toFixed(1)}% exceeded 3%`);
  if(p.lowRate>.43)fail(`run ${run}: low-speed time ${(p.lowRate*100).toFixed(1)}% exceeded 43%`);
  if(p.invalidTargetRate>.01)fail(`run ${run}: invalid target time ${(p.invalidTargetRate*100).toFixed(2)}% exceeded 1%`);
  if(p.unsafeSpecials!==0)fail(`run ${run}: ${p.unsafeSpecials} specials fired during survival/resource plans`);
  if(p.maxDamageLull>480)fail(`run ${run}: live-play damage lull reached ${p.maxDamageLull}f (>8s)`);
  if(p.directorDrops<1||p.directorSweeps<1)fail(`run ${run}: anti-stall director never completed both beats (${p.directorDrops}/${p.directorSweeps})`);
  if(!p.modes[0].includes('EXECUTE')||!p.modes[0].includes('DISC RAM')||!p.modes[1].includes('MINE AMBUSH')||!p.modes[1].includes('BAIT')||
    !p.modes[2].includes('HERD')||!p.modes[3].includes('FLANK'))fail(`run ${run}: a signature role plan was missing (${JSON.stringify(p.modes)})`);
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

console.log('4) tactical intelligence: targets, prediction, routing, roles, restraint, and anti-stall');
const target=game.sandbox.__ssTargetFixture(),threat=game.sandbox.__ssThreatFixture(),route=game.sandbox.__ssRouteFixture(),
  roles=game.sandbox.__ssRoleFixture(),unsafe=game.sandbox.__ssUnsafeFixture(),separating=game.sandbox.__ssCollisionSafetyFixture(),
  barrelAi=game.sandbox.__ssBarrelAiFixture(),director=game.sandbox.__ssDirectorFixture();
console.log(`  target finish/invulnerable/hysteresis: ${target.finish.id}/${target.invulnerable.id}/${target.hysteresis.id}; threat ${threat.incoming.kind} @ ${threat.incoming.t.toFixed(1)}f`);
console.log(`  route ${route.path.join(' > ')} in ${route.steps}f; roles ${roles.hunter.mode}/${roles.trapper.mode}/${roles.brawler.mode}/${roles.flanker.mode}`);
console.log(`  restraint ${Object.values(unsafe).join('/')}; director drop ${director.drop.quiet}f, sweep ${director.first.sweeps} + repeat ${director.repeat.sweeps}`);
if(target.finish.id!==2||target.finish.reason!=='FINISH'||target.invulnerable.id!==3||target.invulnerable.reason!=='LEADER'||target.hysteresis.id!==1||
  target.hysteresis.challenger<=target.hysteresis.current)fail(`target utility/hysteresis regressed: ${JSON.stringify(target)}`);
if(threat.incoming.kind!=='RIVET'||threat.incoming.t<8||threat.incoming.t>10||threat.incoming.score<=26||threat.incoming.mode!=='DODGE RIVET'||
  !threat.incoming.intent.boost||threat.incoming.intent.fire||threat.incoming.intent.special||threat.receding||threat.miss||threat.mine.kind!=='MINE')
  fail(`predictive threat response regressed: ${JSON.stringify(threat)}`);
if(route.direct||route.path.length<3||route.path.at(-1)!=='goal'||route.hp!==6||route.pickupT<=0||route.steps>240||route.inside||
  route.maxDistance>80||route.wallHits>2||route.replans>1||!route.puddle.direct||route.puddle.risk<12||
  (Math.abs(route.puddle.waypoint.x-45)<.01&&Math.abs(route.puddle.waypoint.y-201)<.01))fail(`safe routing regressed: ${JSON.stringify(route)}`);
if(roles.hunter.mode!=='EXECUTE'||!roles.hunter.fire||!roles.hunter.special||roles.trapper.mode!=='MINE AMBUSH'||!roles.trapper.special||
  Math.hypot(roles.trapper.plan[0]-75,roles.trapper.plan[1]-114)>1||roles.brawler.mode!=='HERD'||!roles.brawler.boost||
  roles.flanker.mode!=='FLANK'||roles.flanker.orbit!==1||roles.flanker.lateral<25||roles.lead.y<=60)
  fail(`role doctrine regressed: ${JSON.stringify(roles)}`);
if(unsafe.blocked||unsafe.invulnerable||unsafe.mine||unsafe.fluxSolo||!unsafe.fluxCluster)fail(`special restraint regressed: ${JSON.stringify(unsafe)}`);
if(separating.damage.some(n=>n!==0)||separating.rams!==0||separating.velocity[0]>=0||separating.velocity[1]<=0)
  fail(`separating vehicles registered a false ram: ${JSON.stringify(separating)}`);
if(barrelAi.mode!=='BARREL SHOT'||!barrelAi.fire||!barrelAi.finite)fail(`barrel opportunity planning regressed: ${JSON.stringify(barrelAi)}`);
if(director.early.drops!==0||director.early.sweeps!==0||director.drop.drops!==1||director.drop.quiet!==150||director.beforeSweep.sweeps!==0||
  director.first.sweeps!==1||director.first.next!==450||director.first.sweepT!==150||director.pull.state!=='active'||director.pull.vx<=.02||
  director.repeat.sweeps!==2||director.repeat.next!==660||director.reset.quiet!==0||director.reset.dropSent||director.reset.next!==240||
  director.showdown.mode!=='SHOWDOWN'||!director.showdown.fire)fail(`anti-stall director regressed: ${JSON.stringify(director)}`);

console.log('5) session + manual takeover: two-stage Enter, drive, cannon, special, nitro');
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

console.log('6) show ladder + act telegraphs: warnings land, tiers ordered, payoffs sim-inert');
const SHOW_FOOTER=`
globalThis.__showProbe=()=>SHOW.probe();
globalThis.__showEvents=()=>SHOW.events();
globalThis.__modeSeen={escape:0,stock:0,admire:0};
const __setMode1=setMode;setMode=function(c,mode){
  if(mode==='PRESS ESCAPE'&&CORE.state==='warn')globalThis.__modeSeen.escape++;
  if(mode==='STOCK UP')globalThis.__modeSeen.stock++;
  if(mode==='ADMIRE')globalThis.__modeSeen.admire++;
  return __setMode1(c,mode);};
globalThis.__simSig=()=>cars.reduce((a,c)=>a+Math.round(c.x*13+c.y*7+c.hp*100)+c.kills*1e4,0)+wrecks*31;
`;
for(const seed of[0x550511,0x550512,0x550513]){
  const g=bootGame('scrapshift',{seed,footer:SHOW_FOOTER});
  g.frames(10800,false);
  const ev=g.sandbox.__showEvents(),p=g.sandbox.__showProbe(),modes=g.sandbox.__modeSeen;
  // pair act warnings with landings; a phase change or a sweep supersedes a
  // pending press telegraph (the strike legitimately moves), so those pairs
  // are excluded from the duration band, not from existence checks
  const pend={},press=[],sweeps=[];let lastPhase=-1e9;
  for(const e of ev){
    // a warning born on a phase boundary starts already compressed: the phase
    // shift moved the strike threshold under it — same-frame phase+warn case
    if(e.kind==='act-warning')pend[e.id]={at:e.frame,planned:e.landsAt-e.frame,
      cut:e.id==='press'&&e.frame-lastPhase<=2};
    else if(e.kind==='phase'){lastPhase=e.frame;if(pend.press)pend.press.cut=true;}
    else if(e.kind==='act-land'){
      if(e.id==='sweep'&&pend.press)pend.press.cut=true;
      const w=pend[e.id];delete pend[e.id];
      if(w)(e.id==='press'?press:sweeps).push({gap:e.frame-w.at,planned:w.planned,cut:w.cut});
    }
  }
  const uncut=press.filter(x=>!x.cut);
  const o=p.offeredByTier,s=p.shownByTier;
  console.log(`  seed ${seed.toString(16)}: press gaps ${press.map(x=>x.gap+(x.cut?'*':'')).join(',')} | `+
    `sweep gaps ${sweeps.map(x=>x.gap).join(',')} | tiers ${JSON.stringify(o)} shown ${JSON.stringify(s)} | `+
    `responses ${JSON.stringify(modes)}`);
  if(press.length<3)fail(`seed ${seed.toString(16)}: only ${press.length} press telegraph pairs`);
  if(uncut.length<2)fail(`seed ${seed.toString(16)}: only ${uncut.length} uninterrupted press telegraphs`);
  for(const x of uncut)if(x.gap<180||x.gap>320)fail(`seed ${seed.toString(16)}: press telegraph ${x.gap}f outside 180..320`);
  if(sweeps.length<1)fail(`seed ${seed.toString(16)}: no telegraphed sweep landed`);
  for(const x of sweeps){
    if(x.gap<=0)fail(`seed ${seed.toString(16)}: sweep landed without warning`);
    if(x.planned>=186&&(x.gap<180||x.gap>320))fail(`seed ${seed.toString(16)}: sweep telegraph ${x.gap}f outside 180..320`);
  }
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=1))
    fail(`seed ${seed.toString(16)}: ladder opportunities not strictly ordered (${JSON.stringify(o)})`);
  if(p.heldFrames!==0)fail(`seed ${seed.toString(16)}: unexpected world holds (${p.heldFrames}f)`);
  if(p.slowedFrames>18*((s[2]||0)+(s[3]||0)))fail(`seed ${seed.toString(16)}: slow-mo ${p.slowedFrames}f exceeded wreck budget`);
  if((s[2]||0)<5)fail(`seed ${seed.toString(16)}: only ${s[2]||0} wreck beats presented`);
  if(modes.escape<1||modes.stock<1||modes.admire<1)
    fail(`seed ${seed.toString(16)}: a telegraph/payoff bot response never fired (${JSON.stringify(modes)})`);
}
{
  const a=bootGame('scrapshift',{seed:0x550521,footer:SHOW_FOOTER});
  const b=bootGame('scrapshift',{seed:0x550521,footer:SHOW_FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;
  a.frames(10800,false);b.frames(10800,false);
  if(a.sandbox.__simSig()!==b.sandbox.__simSig())fail('__NO_PAYOFF_FX changed the sim: payoff fx leaked into gameplay');
  else console.log('  __NO_PAYOFF_FX: sim signatures identical over 3 minutes');
}
for(const[sw,label]of[['__NO_ACT_TELEGRAPH','telegraphs off'],['__NO_ADMIRE','admire off']]){
  const g=bootGame('scrapshift',{seed:0x551f02,footer:FOOTER});
  g.sandbox[sw]=1;g.frames(24000,false);
  const p=g.sandbox.__ssProbe();
  console.log(`  paired A/B ${label}: ${p.matches} matches, ${p.wrecks} wrecks (bands must hold both ways)`);
  if(p.wrecks<30||p.wrecks>75)fail(`${label}: wrecks ${p.wrecks} outside 30..75`);
  if(p.matches<2||p.matches>7)fail(`${label}: matches ${p.matches} outside 2..7`);
}

console.log('ten-minute soak: moving, happening, progressing');
{
  const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
  const SOAK_FOOTER=`
;globalThis.__soakN={events:0,progress:0};
{const d0=damageCar;damageCar=(v,a,s,k,...r)=>{const out=d0(v,a,s,k,...r);if(out)globalThis.__soakN.events++;return out;};
 const w0=wreckCar;wreckCar=(v,s,k)=>{const before=v.deaths,out=w0(v,s,k);if(v.deaths>before)globalThis.__soakN.progress++;return out;};
 const p0=collectPickup;collectPickup=(c,p)=>{const out=p0(c,p);if(out)globalThis.__soakN.events++;return out;};}
globalThis.__soakProbe=()=>({
  sig:cars.reduce((a,c)=>a+Math.round(c.x*3+c.y*7),0),
  events:globalThis.__soakN.events,progress:globalThis.__soakN.progress,
  finite:cars.every(c=>[c.x,c.y,c.vx,c.vy,c.hp].every(Number.isFinite))});`;
  const{samples}=runSoak('scrapshift',{seed:0x550501,footer:SOAK_FOOTER,minutes:10});
  const report=analyzeSoak(samples);
  console.log('  '+soakLine(report));
  // measured seeds 0x550501/02: still 5-6s, quiet 7s, stall 19-41s, 2159-2394 ev, 95-108 prog
  assertSoak('soak',report,{still:15,quiet:20,stall:90,minEvents:1300,minProgress:60},fail);
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
