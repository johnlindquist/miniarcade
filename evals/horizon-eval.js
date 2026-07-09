#!/usr/bin/env node
'use strict';
const{bootGame}=require('./harness');

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const footer=`
globalThis.__downs=0;
const __hurtAloy=hurtAloy;hurtAloy=(...args)=>{const was=aloy.down;__hurtAloy(...args);if(was===0&&aloy.down>0)globalThis.__downs++;};
globalThis.__hzProbe=()=>({meters,kills,power,downs:globalThis.__downs,state:aloy.state,hp:aloy.hp,
  x:aloy.x,y:aloy.y,machines:machines.length,playing:playing(),
  finite:[aloy.x,aloy.y,camY,meters,power].every(Number.isFinite)});`;

console.log('autonomous hunt: 3 seeded ten-minute expeditions');
for(let run=1;run<=3;run++){
  const game=bootGame('horizon',{seed:0xa1020000+run,footer});
  game.frames(36000,false);const p=game.sandbox.__hzProbe();
  console.log(`  run ${run}: ${p.meters}m, ${p.kills} kills, power ${p.power}, downs ${p.downs}`);
  if(!p.finite)fail(`run ${run}: non-finite state`);
  if(p.meters<650)fail(`run ${run}: advanced only ${p.meters}m`);
  if(p.kills<30)fail(`run ${run}: only ${p.kills} kills`);
  if(p.downs>25)fail(`run ${run}: ${p.downs} downs is a bloodbath`);
}

console.log('manual controls: two-step start, movement, dodge, and shot');
const game=bootGame('horizon',{seed:0xa1021000,footer});
game.key('keydown','Enter');game.frames(1,false);game.key('keyup','Enter');
if(game.sandbox.__hzProbe().playing)fail('first Enter skipped instructions');
game.key('keydown','Enter');game.frames(1,false);game.key('keyup','Enter');
if(!game.sandbox.__hzProbe().playing)fail('second Enter did not begin play');
const before=game.sandbox.__hzProbe();
game.key('keydown','ArrowUp');game.key('keydown','ArrowRight');game.frames(45,false);
game.key('keydown','Space');game.frames(1,false);game.key('keyup','Space');
game.key('keydown','KeyX');game.frames(30,false);game.key('keyup','KeyX');
game.key('keyup','ArrowUp');game.key('keyup','ArrowRight');
const after=game.sandbox.__hzProbe();
console.log(`  moved (${before.x.toFixed(1)},${before.y.toFixed(1)}) -> (${after.x.toFixed(1)},${after.y.toFixed(1)})`);
if(Math.hypot(after.x-before.x,after.y-before.y)<10)fail('manual movement did not travel');
if(!after.finite)fail('manual controls produced non-finite state');
const calls=game.frames(1,true).calls;if(calls<=0)fail('render emitted no canvas calls');

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
