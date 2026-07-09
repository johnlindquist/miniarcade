#!/usr/bin/env node
'use strict';
const{bootGame}=require('./harness');

const BEFORE={rocket:87,wordfall:458,webslam:269,scrapshift:null};
const MAX={rocket:80,wordfall:60,webslam:150,scrapshift:230};
let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const snap=c=>({calls:c.calls,byMethod:{...c.byMethod}});

console.log('static scene layers: steady-state canvas work');
for(const name of Object.keys(BEFORE)){
  const footer=name==='rocket'?'globalThis.__hideSceneDynamic=()=>{pads.length=0;};':
    name==='webslam'?'globalThis.__hideSceneDynamic=()=>{ANCHORS.length=0;};':'';
  const game=bootGame(name,{seed:123,footer});
  const cached=snap(game.frames(1,true));
  console.log(`  ${name}: ${BEFORE[name]===null?'cached':BEFORE[name]+' ->'} ${cached.calls} context calls, `+
    `${cached.byMethod.drawImage||0} cached blit`);
  if((cached.byMethod.drawImage||0)!==1)fail(`${name}: expected one cached scene blit`);
  if(cached.calls>MAX[name])fail(`${name}: ${cached.calls} calls exceeds budget ${MAX[name]}`);

  let fxBase=cached;
  if(footer){
    const normal=cached.byMethod;game.sandbox.__hideSceneDynamic();
    fxBase=snap(game.frames(1,true));const without=fxBase.byMethod;
    const arcs=(normal.arc||0)-(without.arc||0),fills=(normal.fillRect||0)-(without.fillRect||0);
    if(name==='rocket'&&(arcs!==2||fills!==8))
      fail(`rocket: boost pads are not isolated in the live layer (${arcs} arcs, ${fills} fills)`);
    if(name==='webslam'&&(arcs!==6||fills!==6))
      fail(`webslam: anchors are not isolated in the live layer (${arcs} arcs, ${fills} fills)`);
  }

  // A particle added after cache construction must still render live.
  game.engine.spawn({x:12,y:90,vx:0,vy:0,t:10,drag:1,c:'#fff'});
  const withFx=snap(game.frames(1,true));
  if((withFx.byMethod.fillRect||0)<=(fxBase.byMethod.fillRect||0))
    fail(`${name}: dynamic particle was swallowed by the static layer`);
}

console.log('webslam cache invalidation: city seed rebuilds exactly once');
const web=bootGame('webslam',{seed:321,footer:`
globalThis.__resetScene=resetGame;
globalThis.__sceneState=()=>({citySeed,sceneLayerSeed});`});
const steady=snap(web.frames(1,true));
const oldSeed=web.sandbox.__sceneState().citySeed;
web.sandbox.__resetScene();
const newSeed=web.sandbox.__sceneState().citySeed;
const rebuilt=snap(web.frames(1,true));
const settled=snap(web.frames(1,true));
console.log(`  seed ${oldSeed} -> ${newSeed}: rebuild ${rebuilt.calls} calls, settled ${settled.calls}`);
if(oldSeed===newSeed)fail('webslam: reset did not change the city seed');
if(web.sandbox.__sceneState().sceneLayerSeed!==newSeed)fail('webslam: cached seed did not advance');
if(rebuilt.calls<=steady.calls*2)fail('webslam: changed city did not rebuild the static scene');
if(settled.calls!==steady.calls)fail('webslam: scene rebuilt more than once');

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
