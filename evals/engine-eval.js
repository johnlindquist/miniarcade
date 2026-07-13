#!/usr/bin/env node
'use strict';
const path=require('path');
const{bootGame}=require('./harness');
const{bootRenderedGame}=require('../render/runtime');

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
    ball:[ball.x,ball.y,ball.vx,ball.vy,ball.hot],
    fighters:fighters.map(f=>[f.x,f.y,f.vx,f.vy,f.damage,f.stocks]),next:E.random()});`],
  ['deadline-deck',`globalThis.__parity=()=>({frame,state,stateT,routeFrame,routeNo,finishReason,distance,speed,
    genY,blockNo,nextId,nextSide,lives,papers,delivered,offered,missed,routeScore,
    combo:[comboPoints,comboCount,comboT,comboLabel,[...comboSeen].sort()],press,frontPage,
    player:Object.values(P),houses:houses.map(h=>Object.values(h)),
    obstacles:obstacles.map(o=>Object.values(o)),rails:rails.map(r=>Object.values(r)),
    ramps:ramps.map(r=>Object.values(r)),bundles:bundles.map(b=>Object.values(b)),
    flyers:flyers.map(p=>Object.values(p)),stats:Object.values(stats),next:E.random()});`],
  ['scrapshift',`globalThis.__parity=()=>({frame,clock,matchState,stateT,roundPhase,overtime,
    wrecks,deaths,pickupsTaken,explosions,ramHits,weaponUses:{...weaponUses},weaponHits:{...weaponHits},
    tactics:{...tacticStats},director:{...director},lastCoreState,core:Object.values(CORE),cars:cars.map(c=>Object.values(c)),shots:shots.map(s=>Object.values(s)),
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

console.log('runtime chunking: monolithic, chunked, and one-frame runs are identical');
const chunkTotal=360;
const chunkPatterns={monolithic:[chunkTotal],chunked:[7,31,2,89,1,54,176],oneFrame:Array(chunkTotal).fill(1)};
const chunkFooter=`globalThis.__runtimeParity=()=>({score:[...score],clock,state,stateT,frame,
  ball:[ball.x,ball.y,ball.vx,ball.vy],cars:cars.map(c=>[c.x,c.y,c.a,c.vx,c.vy,c.boost,c.dead,c.launch]),next:E.random()});`;
const chunkStates=[];
for(const [label,chunks] of Object.entries(chunkPatterns)){
  const headless=bootGame('rocket',{seed:0x51ce,search:'?seed=20942',footer:chunkFooter});
  for(const count of chunks)headless.frames(count,false);
  const rendered=bootRenderedGame('rocket',{seed:0x51ce,search:'?seed=20942',footer:chunkFooter});
  for(const count of chunks)rendered.advance(count);
  const headlessState=JSON.stringify(headless.sandbox.__runtimeParity());
  const renderedState=JSON.stringify(rendered.sandbox.__runtimeParity());
  chunkStates.push([label,headlessState,renderedState]);
  console.log(`  ${label}: ${headlessState===renderedState?'headless/rendered identical':'DIVERGED'}`);
  if(headlessState!==renderedState)fail(`${label}: headless and rendered runtimes diverged`);
}
const chunkReference=chunkStates[0][1];
for(const [label,headlessState,renderedState] of chunkStates){
  if(headlessState!==chunkReference||renderedState!==chunkReference)fail(`${label}: frame chunking changed simulation state`);
}

console.log('callback frames: repeated direct runs keep cumulative frame numbers');
const callbackFooter=`globalThis.__callbackFrames=[];
  E.start(f=>globalThis.__callbackFrames.push(f),()=>{},{headless:true});`;
const callbackPatterns={monolithic:[24],chunked:[3,5,1,7,8],oneFrame:Array(24).fill(1)};
for(const [label,chunks] of Object.entries(callbackPatterns)){
  const expected=Array.from({length:24},(_,index)=>index+1);
  const headless=bootGame('rocket',{seed:17,footer:callbackFooter});
  for(const count of chunks)headless.frames(count,false);
  const rendered=bootRenderedGame('rocket',{seed:17,footer:callbackFooter});
  for(const count of chunks)rendered.advance(count);
  const headlessFrames=JSON.stringify(headless.sandbox.__callbackFrames);
  const renderedFrames=JSON.stringify(rendered.sandbox.__callbackFrames);
  const want=JSON.stringify(expected);
  console.log(`  ${label}: ${headlessFrames===want&&renderedFrames===want?'1..24 in both runtimes':'BAD SEQUENCE'}`);
  if(headlessFrames!==want||renderedFrames!==want)fail(`${label}: callback frames were not cumulative`);
  if(headless.frame!==24||rendered.frame!==24)fail(`${label}: public runtime frame did not reach 24`);
}

console.log('script fidelity: strict mode and event listeners match browser behavior');
const fidelityFooter=`globalThis.__strictSource=(()=>{
    const strictFunction=fn=>{try{void fn.caller;return false}catch(error){return error instanceof TypeError}};
    return strictFunction(E.runFrames)&&strictFunction(mkCar);
  })();
  globalThis.__listenerLog=[];
  (()=>{
    const first=event=>globalThis.__listenerLog.push('first:'+event.code);
    const second=event=>globalThis.__listenerLog.push('second:'+event.code);
    const removed=event=>globalThis.__listenerLog.push('removed:'+event.code);
    document.addEventListener('keydown',first);
    document.addEventListener('keydown',first);
    document.addEventListener('keydown',second);
    document.addEventListener('keydown',removed);
    document.removeEventListener('keydown',removed);
  })();`;
const fidelityHeadless=bootGame('rocket',{seed:23,footer:fidelityFooter});
const fidelityRendered=bootRenderedGame('rocket',{seed:23,footer:fidelityFooter});
fidelityHeadless.key('keydown','KeyA');fidelityRendered.key('keydown','KeyA');
const listenerExpected=JSON.stringify(['first:KeyA','second:KeyA']);
const headlessListeners=JSON.stringify(fidelityHeadless.sandbox.__listenerLog);
const renderedListeners=JSON.stringify(fidelityRendered.sandbox.__listenerLog);
console.log(`  strict headless/rendered ${fidelityHeadless.sandbox.__strictSource}/${fidelityRendered.sandbox.__strictSource}; listeners ${headlessListeners}`);
if(!fidelityHeadless.sandbox.__strictSource||!fidelityRendered.sandbox.__strictSource)fail('game script lost its strict-mode directive');
if(headlessListeners!==listenerExpected||renderedListeners!==listenerExpected)fail('multiple/removeEventListener behavior diverged');

console.log('source discovery: headless and rendered dependency sets are exact');
const expectedSources={
  meatlad:['engine.js','meatlad.html'],
  wordfall:['engine.js','autoplay.js','word-puzzle.js','wordfall.html']
};
for(const [name,expected] of Object.entries(expectedSources)){
  const headless=bootGame(name,{seed:29});
  const rendered=bootRenderedGame(name,{seed:29});
  const left=headless.sourceFiles.map(file=>path.basename(file));
  const leftDependencies=headless.dependencyFiles.map(file=>path.basename(file));
  console.log(`  ${name}: ${left.join(', ')}`);
  if(JSON.stringify(headless.sourceFiles)!==JSON.stringify(rendered.sourceFiles)||
    JSON.stringify(headless.dependencyFiles)!==JSON.stringify(rendered.dependencyFiles))
    fail(`${name}: headless/rendered source files differ`);
  if(JSON.stringify(left)!==JSON.stringify(expected)||JSON.stringify(leftDependencies)!==JSON.stringify(expected.slice(0,-1)))
    fail(`${name}: discovered the wrong source dependency set`);
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

console.log('viewer sessions: the takeover affordance is delayed and absent from previews');
game=bootGame('rocket',{seed:10,search:'?seed=10'});delete game.sandbox.__NO_UI;game.engine.initSession('viewer-fixture',[],{viewer:true});
for(let i=0;i<480;i++)game.engine.sessionStep({reset(){}});
game.counter.calls=0;game.counter.byMethod={};game.engine.drawSession(false);const earlyCalls=game.counter.calls;
game.engine.sessionStep({reset(){}});game.counter.calls=0;game.counter.byMethod={};game.engine.drawSession(false);const lateCalls=game.counter.calls;
const viewerProbe=game.engine.sessionProbe();
const previewGame=bootGame('rocket',{seed:10,search:'?seed=10&preview=1'});delete previewGame.sandbox.__NO_UI;previewGame.engine.initSession('viewer-fixture',[],{viewer:true});
for(let i=0;i<481;i++)previewGame.engine.sessionStep({reset(){}});
previewGame.counter.calls=0;previewGame.counter.byMethod={};previewGame.engine.drawSession(false);const previewCalls=previewGame.counter.calls;
console.log(`  direct early ${earlyCalls} calls, delayed ${lateCalls} calls; preview ${previewCalls} calls`);
if(!viewerProbe.viewer||viewerProbe.mode!=='attract')fail(`viewer session metadata regressed: ${JSON.stringify(viewerProbe)}`);
if(earlyCalls!==0||lateCalls<2||previewCalls!==0)fail('viewer takeover affordance was early, missing, or leaked into previews');

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
