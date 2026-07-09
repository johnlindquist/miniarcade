#!/usr/bin/env node
/* Block Mine autonomous-story eval.
 *
 * Run:  node evals/blockmine-eval.js   (from the here-now directory)
 *
 * Proves the narrow-screen mining loop does not merely animate in place:
 * each ten-minute run must craft upgraded tools, descend through the ore
 * bands, place lights, remain finite, and avoid long progress stalls.
 */
'use strict';
const fs=require('fs'),path=require('path');
const{seededRandom,inlineScript}=require('./harness');
const dir=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(dir,'blockmine.html'),'utf8');
const inline=inlineScript(html);
const engine=fs.readFileSync(path.join(dir,'engine.js'),'utf8');
const autoplay=fs.readFileSync(path.join(dir,'autoplay.js'),'utf8');

function boot(randomSeed=0xB10C){
  Math.random=seededRandom(randomSeed);
  const listeners={};
  const ctx=new Proxy({},{get:(t,p)=>p==='measureText'?()=>({width:10}):()=>{},set:()=>true});
  const canvas={getContext:()=>ctx,width:320,height:720};
  global.document={getElementById:()=>canvas,addEventListener:(type,fn)=>{listeners[type]=fn;}};
  global.requestAnimationFrame=()=>{};
  const footer=`
;globalThis.__bmStep=step;
globalThis.__bmGrantTrap=()=>{P.cobble+=10;};
globalThis.__bmProbe=()=>({
  depth:deepest,tool:P.tool,wood:P.wood,diamonds:P.diamond,kills,lights:torches.length,cx:P.cx,cy:P.cy,
  trapKills,trapBuilds,buildScore,builds:structures.length,deaths,repaths,mobs:mobs.length,mode:P.aiMode,
  goalStage:goalState.stage,goalsDone:goalState.completed,goalLabel:primaryGoal().label,
  progress:P.progressFrame,frame,dur:P.dur,durMax:P.durMax,homing:!!P.homing,caravans,gold:P.gold,
  food:P.food,ammo:P.ammo,torch:P.torch,caravanTarget:goalState.caravanTarget,atCamp:campNear(),
  discoveryPasses,
  finite:Number.isFinite(P.x)&&Number.isFinite(P.y)&&Number.isFinite(camY),playing:playing()
});
globalThis.__bmStoryRun=n=>{
  let last=-1,stall=0,maxStall=0;
  for(let i=0;i<n;i++){step();const progress=P.progressFrame;
    if(progress>last){last=progress;stall=0;}else{stall++;maxStall=Math.max(maxStall,stall);}}
  return Object.assign({maxStall},globalThis.__bmProbe());
};
globalThis.__bmPathFixture=()=>{
  resetGame();for(let y=16;y<=46;y++)for(let x=1;x<COLS-1;x++)setTile(x,y,AIR);
  for(let y=16;y<=46;y++)if(y!==35)setTile(9,y,BEDROCK);
  const r=findRoute(3,28,15,28,{airOnly:true});
  return{ok:!!r&&r.length>0,crosses:!!r&&r.some(c=>c.x===9&&c.y===35),length:r?r.length:0};
};
globalThis.__bmBreachFixture=()=>{
  resetGame();for(let y=30;y<=48;y++)for(let x=1;x<COLS-1;x++)setTile(x,y,BEDROCK);
  setTile(10,40,AIR);setTile(10,39,STONE);setTile(10,38,AIR);
  Object.assign(P,{cx:10,cy:40,x:centerX(10),y:centerY(40),toX:10,toY:40,tool:4,bow:false,
    cobble:20,buildCd:1e9,lastBuildDepth:40,route:[],target:null,progressFrame:frame});
  mobs=[{kind:'zombie',x:centerX(10),y:centerY(38),hp:4,hit:0,charge:0,vx:0,vy:0,dead:0,
    route:null,repathAt:0,shotCd:100,trapCd:0}];nextMob=1e9;
};
globalThis.__bmCombatFixture=()=>{
  resetGame();for(let y=33;y<=47;y++)for(let x=1;x<COLS-1;x++)setTile(x,y,BEDROCK);
  for(let y=39;y<=41;y++)for(let x=2;x<=17;x++)setTile(x,y,AIR);
  Object.assign(P,{cx:10,cy:40,x:centerX(10),y:centerY(40),toX:10,toY:40,tool:3,bow:true,
    ammo:30,cobble:35,coal:4,powder:3,food:3,buildCd:1e9,lastBuildDepth:40,route:[],target:null,progressFrame:frame});
  const mk=(kind,x,y,hp)=>({kind,x:centerX(x),y:centerY(y),hp,hit:0,charge:0,vx:0,vy:0,dead:0,
    route:null,repathAt:0,shotCd:60,trapCd:0});
  mobs=[mk('zombie',6,40,4),mk('creeper',4,40,3),mk('skeleton',2,40,2)];nextMob=1e9;
};
globalThis.__bmBuildFixture=()=>{
  resetGame();for(let y=35;y<=45;y++)for(let x=3;x<=17;x++)setTile(x,y,AIR);
  Object.assign(P,{cx:10,cy:40,x:centerX(10),y:centerY(40),cobble:40,diamond:10,tool:4,lastBuildDepth:0,buildCd:0});
  const outpost=buildOutpost();P.buildCd=0;const beacon=buildBeacon();
  return{outpost,beacon,builds:structures.length,score:buildScore,forts:[...blocks.values()].filter(t=>t===FORT).length};
};
globalThis.__bmFluidFixture=()=>{
  resetGame();for(let y=29;y<=45;y++)for(let x=2;x<=17;x++)setTile(x,y,BEDROCK);
  for(let y=30;y<=44;y++)for(let x=3;x<=16;x++){setTile(x,y,AIR);discovered.add(key(x,y));}
  Object.assign(P,{cx:10,cy:36,x:centerX(10),y:centerY(36),dead:1e9});nextMob=1e9;
  setFluidCell(5,30,LAVA);setFluidCell(13,30,WATER);
};
globalThis.__bmFluidProbe=()=>{
  let water=0,lava=0,stone=0,maxWater=0,maxLava=0;
  for(let y=30;y<=44;y++)for(let x=3;x<=16;x++){const t=tile(x,y);if(t===WATER){water++;maxWater=Math.max(maxWater,y);}
    else if(t===LAVA){lava++;maxLava=Math.max(maxLava,y);}else if(t===STONE)stone++;}
  return{water,lava,stone,maxWater,maxLava,queued:fluidQueue.length};
};
globalThis.__bmFallFixture=()=>{
  resetGame();for(let y=28;y<=44;y++)for(let x=1;x<COLS-1;x++)setTile(x,y,BEDROCK);
  for(let y=30;y<=42;y++)for(let x=9;x<=11;x++)setTile(x,y,AIR);
  // No climbing stock: the rope-catch reflex would otherwise arrest the fall.
  Object.assign(P,{cx:10,cy:30,x:centerX(10),y:centerY(30),toX:10,toY:30,hp:5,dead:0,
    ladder:0,rope:0,wood:0,silk:0,cobble:0,
    route:[],target:null,mine:null,fallD:0,invT:0,progressFrame:frame});
  mobs=[];nextMob=1e9;
};
globalThis.__bmFallProbe=()=>({hp:P.hp,cy:P.cy,deaths,fallD:P.fallD});
globalThis.__bmClimbFixture=()=>{
  resetGame();for(let y=26;y<=44;y++)for(let x=1;x<COLS-1;x++)setTile(x,y,BEDROCK);
  for(let y=29;y<=41;y++)setTile(10,y,AIR);
  setTile(11,32,DIAMOND);
  Object.assign(P,{cx:10,cy:41,x:centerX(10),y:centerY(41),toX:10,toY:41,tool:4,
    wood:6,ladder:0,rope:0,silk:0,cobble:0,route:[],target:null,mine:null,progressFrame:frame});
  goalState.stage=3;mobs=[];nextMob=1e9;
};
globalThis.__bmClimbProbe=()=>{
  let rungs=0;for(const t of blocks.values())if(t===LADDER||t===ROPE)rungs++;
  return{cy:P.cy,rungs,diamonds:P.diamond,wood:P.wood,ladder:P.ladder};
};
globalThis.__bmFogFixture=()=>{
  resetGame();goalState.stage=3;P.cobble=10;P.tool=4;
  Object.assign(P,{cx:10,cy:42,x:centerX(10),y:centerY(42),toX:10,toY:42,route:[],target:null});
  setTile(10,55,DIAMOND);
  pickTarget();const before=P.target?{x:P.target.x,y:P.target.y}:null;
  P.target=null;P.route=[];discoverAround(10,55,3);
  pickTarget();const after=P.target?{x:P.target.x,y:P.target.y}:null;
  return{before,after,fogHitBefore:!!before&&before.x===10&&before.y===55,
    seesAfter:!!after&&after.x===10&&after.y===55};
};
globalThis.__bmGoalFixture=()=>{
  resetGame();const first=activeGoals().map(g=>g.label);
  P.tool=4;P.diamond=8;P.cobble=30;P.cy=80;deepest=120;trapKills=3;buildScore=600;
  structures.push({kind:'outpost',x:10,y:40});P.beaconBuilt=true;updateGoals();
  return{first,stage:goalState.stage,done:goalState.completed,active:activeGoals().map(g=>({label:g.label,value:g.value,target:g.target}))};
};
globalThis.__bmDurabilityFixture=()=>{
  resetGame();grantTool(3);const max=P.durMax;wearTool(12.5);const worn=P.dur;
  P.dur=0.25;wearTool(0.5);const shattered={tool:P.tool,dur:P.dur,max:P.durMax};
  P.homing=true;P.tripEnd=999;P.stairDir=-1;P.dur=7;P.durMax=9;resetGame();
  return{max,worn,shattered,reset:{homing:!!P.homing,tripEnd:P.tripEnd,stairDir:P.stairDir,dur:P.dur,max:P.durMax}};
};
globalThis.__bmReforgeFixture=()=>{
  resetGame();grantTool(3);P.dur=7;
  for(let i=0;i<89;i++)campServices();const before=P.dur;campServices();
  return{before,after:P.dur,max:P.durMax,forgeT,tool:P.tool};
};
globalThis.__bmCaravanFixture=()=>{
  resetGame();P.gold=3;P.hp=1;day=0;campServices();
  const night={gold:P.gold,caravans,score:buildScore};day=0.5;campServices();updateGoals();
  return{night,day:{gold:P.gold,caravans,score:buildScore,food:P.food,ammo:P.ammo,torch:P.torch,hp:P.hp,
    done:goalState.completed,target:goalState.caravanTarget,nextTripF}};
};
globalThis.__bmHomeFixture=()=>{
  resetGame();for(let y=SURFACE-1;y<=32;y++)setTile(CAMP_X,y,LADDER);
  Object.assign(P,{cx:CAMP_X,cy:32,x:centerX(CAMP_X),y:centerY(32),toX:CAMP_X,toY:32,
    moveT:0,mine:null,route:[],target:null,gold:5,homing:false,progressFrame:frame});
  grantTool(3);P.dur=8;goalState.stage=3;day=0.45;mobs=[];nextMob=1e9;
};
globalThis.__bmHomeRun=n=>{
  let sawHoming=false,p=null;
  for(let i=0;i<n;i++){step();p=globalThis.__bmProbe();sawHoming=sawHoming||p.homing;
    if(p.atCamp&&p.caravans===1&&p.dur===p.durMax)break;}
  return Object.assign({sawHoming},p);
};
globalThis.__bmDiscoveryFixture=()=>{
  resetGame();P.dead=1e9;nextMob=1e9;for(let i=0;i<120;i++)step();const idle=discoveryPasses;
  setTile(P.cx+1,P.cy,STONE);setTile(P.cx+1,P.cy,AIR);step();
  return{idle,afterOpen:discoveryPasses};
};`;
  eval((engine+'\n'+autoplay+'\n'+inline).replace(/'use strict';/g,'')+footer);
  globalThis.__bmKey=(type,code)=>listeners[type]&&listeners[type]({code,preventDefault(){}});
}
const run=n=>{for(let i=0;i<n;i++)globalThis.__bmStep();};

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
console.log('autonomous story: 3 x 10 simulated minutes');
for(let run=1;run<=3;run++){
  boot(0xB10C0000+run);const p=globalThis.__bmStoryRun(36000),maxStall=p.maxStall;
  console.log(`  run ${run}: ${p.depth}m, tool tier ${p.tool}, ${p.diamonds} diamonds, `+
    `${p.kills} mobs (${p.trapKills} trapped), ${p.builds} builds / ${p.buildScore} BLD, `+
    `${p.goalsDone} goals, worst action stall ${(maxStall/60).toFixed(1)}s`);
  if(!p.finite)fail(`run ${run}: non-finite player or camera state`);
  if(p.depth<60)fail(`run ${run}: reached only ${p.depth}m (limit 60m)`);
  if(p.tool<3)fail(`run ${run}: only reached tool tier ${p.tool} (limit iron)`);
  if(p.lights<3)fail(`run ${run}: placed only ${p.lights} torches (limit 3)`);
  if(p.builds<2||p.buildScore<300)fail(`run ${run}: construction loop did not establish multiple rewarded builds`);
  // Falls, pits, fog, spiders and siege golems made the caves deliberately
  // lethal; respawn is part of the attract-mode story, so the bar is "doesn't
  // die constantly", not "never dies".
  if(p.deaths>5)fail(`run ${run}: died ${p.deaths} times (limit 5)`);
  if(p.repaths>5)fail(`run ${run}: needed ${p.repaths} stuck recoveries (limit 5)`);
  // Visible progress = the beacon milestone, or (on ore-poor seeds under
  // strict fog) a heavy volume of recurring goals still churning.
  if(p.goalsDone<8||(p.goalStage<6&&p.goalsDone<12))fail(`run ${run}: goal ladder did not visibly progress (stage ${p.goalStage}, ${p.goalsDone} complete)`);
  if(maxStall>1800)fail(`run ${run}: stalled ${(maxStall/60).toFixed(1)}s (limit 30s)`);
}

console.log('pathfinding: route around an unbreakable wall through its only gap');
boot();const pathProbe=globalThis.__bmPathFixture();
console.log(`  route ${pathProbe.length} cells, required gap used: ${pathProbe.crosses}`);
if(!pathProbe.ok||!pathProbe.crosses)fail('A* did not solve the forced-gap maze');

console.log('breach tactics: wall-separated zombie regression');
boot();globalThis.__bmBreachFixture();run(600);
const breachProbe=globalThis.__bmProbe();
console.log(`  kills ${breachProbe.kills}, enemies left ${breachProbe.mobs}, mode ${breachProbe.mode}`);
if(breachProbe.kills<1||breachProbe.mobs>0)fail('AI failed to breach the wall and clear the enemy');

console.log('combat tactics: outnumbered arena uses traps and survives');
boot();globalThis.__bmCombatFixture();run(2400);
const combatProbe=globalThis.__bmProbe();
console.log(`  kills ${combatProbe.kills}, trapped ${combatProbe.trapKills}, traps built ${combatProbe.trapBuilds}, deaths ${combatProbe.deaths}`);
if(combatProbe.kills<3||combatProbe.mobs>0)fail('combat planner did not clear the arena');
if(combatProbe.trapBuilds<1||combatProbe.trapKills<1)fail('combat planner did not convert a trap into a kill');
if(combatProbe.deaths>0)fail('combat fixture killed the main character');

console.log('construction: outpost + diamond beacon award build score');
boot();const buildProbe=globalThis.__bmBuildFixture();
console.log(`  outpost ${buildProbe.outpost}, beacon ${buildProbe.beacon}, ${buildProbe.forts} fort blocks, ${buildProbe.score} BLD`);
if(!buildProbe.outpost||!buildProbe.beacon||buildProbe.builds<2||buildProbe.score<500)fail('rewarded construction fixture failed');

console.log('fluids: discovered water and lava fill a sealed chamber and react');
boot();globalThis.__bmFluidFixture();run(1200);
const fluidProbe=globalThis.__bmFluidProbe();
console.log(`  water ${fluidProbe.water} cells to row ${fluidProbe.maxWater}, lava ${fluidProbe.lava} cells to row ${fluidProbe.maxLava}, solidified ${fluidProbe.stone}`);
if(fluidProbe.water<8||fluidProbe.lava<8)fail('discovered fluids did not spread through the chamber');
if(fluidProbe.maxWater<43||fluidProbe.maxLava<43)fail('fluids did not flow down into the discovered chamber');
if(fluidProbe.stone<1)fail('water and lava never reacted into stone');

console.log('falls: an open shaft drops the miner and charges fall damage');
boot();globalThis.__bmFallFixture();run(600);
const fallProbe=globalThis.__bmFallProbe();
console.log(`  landed at row ${fallProbe.cy}, hp ${fallProbe.hp}, deaths ${fallProbe.deaths}`);
if(fallProbe.cy<42)fail('gravity did not pull the miner down the open shaft');
if(fallProbe.hp>=5)fail('a 12-cell plunge charged no fall damage');
if(fallProbe.deaths>0)fail('capped fall damage should not be lethal from full health');

console.log('climbing: sealed shaft forces crafted ladders to reach high ore');
boot();globalThis.__bmClimbFixture();run(1500);
const climbProbe=globalThis.__bmClimbProbe();
console.log(`  climbed to row ${climbProbe.cy}, ${climbProbe.rungs} rungs placed, ${climbProbe.diamonds} diamonds`);
if(climbProbe.rungs<5)fail('miner did not build a ladder run up the shaft');
if(climbProbe.diamonds<1)fail('miner never reached the diamond above');

console.log('fog of war: hidden ore is invisible to the planner until discovered');
boot();const fogProbe=globalThis.__bmFogFixture();
console.log(`  before discovery targeted ${JSON.stringify(fogProbe.before)}, after ${JSON.stringify(fogProbe.after)}`);
if(fogProbe.fogHitBefore)fail('planner targeted a diamond it has never seen');
if(!fogProbe.seesAfter)fail('planner ignored the diamond after it was discovered');

console.log('goals: progression ladder advances and keeps recurring objectives active');
boot();const goalProbe=globalThis.__bmGoalFixture();
console.log(`  ${goalProbe.first[0]} -> stage ${goalProbe.stage}, ${goalProbe.done} completed, active: ${goalProbe.active.map(g=>g.label).join(' / ')}`);
if(goalProbe.first[0]!=='CHOP WOOD'||goalProbe.stage<6||goalProbe.done<8)fail('goal ladder did not advance across milestone state');
if(goalProbe.active.length<4||!goalProbe.active.some(g=>g.label==='EXPLORE DEEPER'))fail('recurring active goals are missing');

console.log('durability: wear, shatter, and reset state are exact');
boot();const durabilityProbe=globalThis.__bmDurabilityFixture();
console.log(`  iron ${durabilityProbe.max} -> ${durabilityProbe.worn}, shatter -> tier ${durabilityProbe.shattered.tool} / ${durabilityProbe.shattered.dur}, reset ${JSON.stringify(durabilityProbe.reset)}`);
if(durabilityProbe.max!==520||durabilityProbe.worn!==507.5)fail('tool wear did not subtract exact fractional durability');
if(durabilityProbe.shattered.tool!==1||durabilityProbe.shattered.dur!==50||durabilityProbe.shattered.max!==50)fail('shattered tool did not become the documented scrap pick');
if(durabilityProbe.reset.homing||durabilityProbe.reset.tripEnd!==0||durabilityProbe.reset.stairDir!==0||durabilityProbe.reset.dur!==0||durabilityProbe.reset.max!==0)fail('reset leaked homing or durability state');

console.log('surface anvil: a full service takes exactly 90 camp ticks');
boot();const reforgeProbe=globalThis.__bmReforgeFixture();
console.log(`  before tick 90: ${reforgeProbe.before}, after: ${reforgeProbe.after}/${reforgeProbe.max}`);
if(reforgeProbe.before!==7||reforgeProbe.after!==520||reforgeProbe.forgeT!==0||reforgeProbe.tool!==3)fail('camp anvil did not reforge the worn iron pick on schedule');

console.log('daylight caravan: night refusal, trade rewards, and recurring goal');
boot();const caravanProbe=globalThis.__bmCaravanFixture();
console.log(`  night kept ${caravanProbe.night.gold} gold; dawn paid ${caravanProbe.day.score} BLD, ${caravanProbe.day.ammo} arrows, ${caravanProbe.day.torch} torches, goal ${caravanProbe.day.done}/${caravanProbe.day.target}`);
if(caravanProbe.night.gold!==3||caravanProbe.night.caravans!==0||caravanProbe.night.score!==0)fail('caravan traded during the night');
if(caravanProbe.day.gold!==0||caravanProbe.day.caravans!==1||caravanProbe.day.score!==90||
  caravanProbe.day.food!==4||caravanProbe.day.ammo!==9||caravanProbe.day.torch!==10||caravanProbe.day.hp!==5)fail('daylight caravan rewards were incomplete');
if(caravanProbe.day.done!==1||caravanProbe.day.target!==2||caravanProbe.day.nextTripF!==3600)fail('caravan goal/cooldown did not advance');

console.log('return home: worn miner climbs a viable route and receives both services');
boot();globalThis.__bmHomeFixture();const homeProbe=globalThis.__bmHomeRun(1200);
console.log(`  homing ${homeProbe.sawHoming}, row ${homeProbe.cy}, camp ${homeProbe.atCamp}, durability ${homeProbe.dur}/${homeProbe.durMax}, caravans ${homeProbe.caravans}`);
if(!homeProbe.sawHoming)fail('low durability/gold never engaged homing');
if(!homeProbe.atCamp||homeProbe.caravans!==1||homeProbe.gold!==0||homeProbe.dur!==homeProbe.durMax)fail('viable surface route did not deliver both camp services');
if(homeProbe.homing)fail('homing state did not clear at camp');

console.log('discovery scheduling: idle frames do no repeated flood work');
boot();const discoveryProbe=globalThis.__bmDiscoveryFixture();
console.log(`  ${discoveryProbe.idle} initial pass, ${discoveryProbe.afterOpen} after opening a nearby face`);
if(discoveryProbe.idle!==1||discoveryProbe.afterOpen!==2)fail('discovery flood was not movement/topology driven');

console.log('manual controls: enter for instructions, enter to play, move + mine, place torch');
boot();
globalThis.__bmKey('keydown','Enter');globalThis.__bmStep();globalThis.__bmKey('keyup','Enter');
if(globalThis.__bmProbe().playing)fail('first enter skipped the instructions screen');
globalThis.__bmKey('keydown','Enter');globalThis.__bmStep();globalThis.__bmKey('keyup','Enter');
if(!globalThis.__bmProbe().playing)fail('second enter did not start play');
globalThis.__bmKey('keydown','ArrowRight');globalThis.__bmKey('keydown','KeyX');
run(180);
globalThis.__bmKey('keyup','ArrowRight');globalThis.__bmKey('keyup','KeyX');
globalThis.__bmKey('keydown','Space');globalThis.__bmStep();globalThis.__bmKey('keyup','Space');
globalThis.__bmGrantTrap();globalThis.__bmKey('keydown','KeyZ');globalThis.__bmStep();globalThis.__bmKey('keyup','KeyZ');
const manualProbe=globalThis.__bmProbe();
console.log(`  moved to column ${manualProbe.cx}, mined ${manualProbe.wood} wood, placed ${manualProbe.lights} torch, armed ${manualProbe.trapBuilds} trap`);
if(manualProbe.cx<=10)fail('manual movement did not advance');
if(manualProbe.wood<1)fail('directional mining did not break the tree');
if(manualProbe.lights!==1)fail('space did not place exactly one torch');
if(manualProbe.trapBuilds!==1)fail('Z did not arm exactly one manual trap');
console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
