#!/usr/bin/env node
'use strict';
const{bootGame}=require('./harness');

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};

console.log('seeded engine RNG: repeatable streams');
let game=bootGame('rocket',{seed:7,search:'?seed=7&profile=1',footer:'globalThis.__frame=()=>frame;'});
const a=[game.engine.random(),game.engine.random(),game.engine.random()];
game.engine.seedRandom(7);
const b=[game.engine.random(),game.engine.random(),game.engine.random()];
console.log(' ',a.map(n=>n.toFixed(6)).join(', '));
if(a.some((n,i)=>n!==b[i]))fail('re-seeding did not reproduce the RNG stream');

console.log('render isolation: visual effects do not advance simulation RNG');
game.engine.seedRandom(19);
const expected=[game.engine.random(),game.engine.random(),game.engine.random()];
game.engine.seedRandom(19);
for(let i=0;i<64;i++){
  game.engine.shake(6);game.engine.preDraw();game.engine.postDraw();
}
const afterFx=[game.engine.random(),game.engine.random(),game.engine.random()];
console.log(' ',afterFx.map(n=>n.toFixed(6)).join(', '));
if(expected.some((n,i)=>n!==afterFx[i]))fail('render-only shake consumed simulation RNG');

console.log('render parity: draw-free and 60fps runs keep identical game state');
const parityCases=[
  ['rocket',`globalThis.__parity=()=>({score:[...score],clock,state,stateT,
    ball:[ball.x,ball.y,ball.vx,ball.vy],
    cars:cars.map(c=>[c.x,c.y,c.a,c.vx,c.vy,c.boost,c.dead,c.launch]),next:E.random()});`],
  ['wordfall',`globalThis.__parity=()=>({frame,kills,floorNo,charge,combatT,mode,target,
    player:[P.x,P.y,P.vx,P.vy,P.hp,P.dodge],enemies:enemies.length,next:E.random()});`],
  ['hexcascade',`globalThis.__parity=()=>({frame,elapsed,phase,phaseT,cascade,kills,totalMatches,
    bestCascade,specialsMade,spawnCd,bossMark,dead,deadT,bannerT,cameraZoom,
    board:board.map(row=>row.map(tile=>tile&&[tile.type,tile.special,tile.drop,tile.flash])),
    activeClear:[...activeClear].sort((a,b)=>a-b),powers:[...powers],matchCounts:[...matchCounts],powerPulse:[...powerPulse],
    cursor:[cursor.r,cursor.c],selected:selected&&[selected.r,selected.c],
    player:[P.x,P.y,P.hp,P.maxHp,P.inv,P.shield,P.attackCd,P.hit],
    enemies:enemies.map(e=>[e.kind,e.x,e.y,e.vx,e.vy,e.hp,e.sp,e.cap,e.hit,e.orbCd,e.t,e.dead]),
    bolts:bolts.map(b=>[b.x,b.y,b.vx,b.vy,b.dmg,b.pierce,b.life,b.c,
      b.trail.map(t=>[t.x,t.y])]),links:links.map(l=>[l.x1,l.y1,l.x2,l.y2,l.t,l.c]),
    texts:texts.map(t=>[t.x,t.y,t.s,t.c,t.t]),next:E.random()});`],
  ['webslam',`globalThis.__parity=()=>({score:[...score],clock,state,stateT,citySeed,
    ball:[ball.x,ball.y,ball.vx,ball.vy,ball.hot,ball.airTouches,ball.last,ball.breach,ball.idleT],
    walls:walls.map(side=>[...side]),wallFlash:wallFlash.map(side=>[...side]),
    fighters:fighters.map(f=>[f.x,f.y,f.vx,f.vy,f.damage,f.respawn]),next:E.random()});`],
  ['deadline-deck',`globalThis.__parity=()=>({frame,state,stateT,routeFrame,routeNo,finishReason,distance,speed,
    genY,blockNo,nextId,nextSide,lives,papers,delivered,offered,missed,routeScore,
    combo:[comboPoints,comboCount,comboT,comboLabel,[...comboSeen].sort()],press,frontPage,
    player:Object.values(P),houses:houses.map(h=>Object.values(h)),
    obstacles:obstacles.map(o=>Object.values(o)),rails:rails.map(r=>Object.values(r)),
    ramps:ramps.map(r=>Object.values(r)),bundles:bundles.map(b=>Object.values(b)),
    flyers:flyers.map(p=>Object.values(p)),stats:Object.values(stats),next:E.random()});`],
  ['scrapshift',`globalThis.__parity=()=>({frame,clock,matchState,stateT,roundPhase,overtime,
    wrecks,deaths,pickupsTaken,explosions,ramHits,wreckSlow,weaponUses:{...weaponUses},weaponHits:{...weaponHits},
    core:Object.values(CORE),cars:cars.map(c=>Object.values(c)),shots:shots.map(s=>Object.values(s)),
    mines:mines.map(m=>Object.values(m)),pickups:pickups.map(p=>Object.values(p)),
    barrels:barrels.map(b=>Object.values(b)),feed:feed.map(f=>Object.values(f)),banner,bannerT,next:E.random()});`]
];
for(const [name,footer] of parityCases){
  const headless=bootGame(name,{seed:42,search:'?seed=42',footer});
  const rendered=bootGame(name,{seed:42,search:'?seed=42',footer});
  headless.frames(3600,false);rendered.frames(3600,true);
  const left=JSON.stringify(headless.sandbox.__parity());
  const right=JSON.stringify(rendered.sandbox.__parity());
  console.log(`  ${name}: ${left===right?'identical':'DIVERGED'}`);
  if(left!==right)fail(`${name}: rendering changed simulation state`);
}

console.log('scheduler: 60Hz simulation, 30Hz preview on a 120Hz display');
game=bootGame('rocket',{seed:9,search:'?preview=1&profile=1',footer:'globalThis.__frame=()=>frame;'});
for(let i=0;i<240;i++)game.tick(1000/120);
const p=game.engine.profileReport();
console.log(`  ${p.steps} steps / ${p.renders} renders`);
if(p.steps<118||p.steps>121)fail(`expected ~120 simulation steps, got ${p.steps}`);
if(p.renders<59||p.renders>62)fail(`expected ~60 preview renders including initial paint, got ${p.renders}`);

console.log('visibility: hidden games consume no simulation budget');
const before=game.sandbox.__frame();game.sandbox.document.hidden=true;
for(let i=0;i<120;i++)game.tick(1000/120);
const after=game.sandbox.__frame();
console.log(`  frame ${before} -> ${after}`);
if(after!==before)fail('hidden document continued simulating');

console.log('headless runner: direct steps do not draw unless requested');
game.sandbox.document.hidden=false;
const calls0=game.frames(120,false).calls,calls1=game.frames(1,true).calls;
console.log(`  headless canvas calls ${calls0}; explicit render calls ${calls1}`);
if(calls0!==0)fail('headless frames touched the canvas');
if(calls1<=0)fail('explicit render did not touch the canvas');

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
