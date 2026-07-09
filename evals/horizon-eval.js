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

console.log('herd migration + show ladder: telegraphed stampede, huntress takes cover, apex budgets');
{
  const ACT_FOOTER=footer+`
;globalThis.__notes=[];
{const __n0=SHOW.note;SHOW.note=e=>{globalThis.__notes.push({kind:e.kind,id:e.id,tag:e.tag});return __n0(e);};}
globalThis.__mig=()=>({phase:migPhase,herd:machines.filter(m=>m.mig&&!m.dead).length});
globalThis.__showP=()=>SHOW.probe();
globalThis.__sig=()=>Math.round(aloy.x*31+aloy.y*7)+kills*1009+power*97+Math.round(meters)*13;`;
  const SEED=0xa1020401;
  const a=bootGame('horizon',{seed:SEED,footer:ACT_FOOTER});
  const b=bootGame('horizon',{seed:SEED,footer:ACT_FOOTER});
  b.sandbox.__NO_ACTS=1;
  let firstDiverge=-1,divergePhase='',liveSamples=0,herdMax=0;
  for(let f=0;f<18000;f+=10){
    a.frames(10,false);b.frames(10,false);
    const g=a.sandbox.__mig();
    if(g.phase==='live'){liveSamples++;herdMax=Math.max(herdMax,g.herd);}
    if(firstDiverge<0&&a.sandbox.__sig()!==b.sandbox.__sig()){firstDiverge=f+10;divergePhase=g.phase;}
  }
  const ev=a.sandbox.__notes,p=a.sandbox.__showP();
  const migs=[];let pend=null;
  for(const e of ev){
    if(e.kind==='act-warning'&&e.id==='herd')pend=e;
    else if(e.kind==='act-land'&&e.id==='herd'&&pend){migs.push(e.tag-pend.tag);pend=null;}
  }
  const o=p.offeredByTier,s3=p.shownByTier[3]||0;
  const pa=a.sandbox.__hzProbe();
  console.log(`  ${migs.length} stampedes landed (telegraphs ${migs.join(',')} frames), `+
    `diverged at ${firstDiverge} during '${divergePhase}', herd peak ${herdMax}, `+
    `tiers ${JSON.stringify(o)}, jaws ${s3} (held ${p.heldFrames}f, slowed ${p.slowedFrames}f, `+
    `admired ${p.admireFrames}f), ${pa.meters}m / ${pa.downs} downs`);
  if(migs.length<2)fail(`only ${migs.length} telegraphed stampedes landed in 5 minutes`);
  for(const t of migs)if(t<180||t>300)fail(`stampede telegraph ${t} frames outside 180..300`);
  if(liveSamples<20)fail(`stampede live phase barely observable (${liveSamples} samples)`);
  if(herdMax<5)fail(`stampede herd too thin (peak ${herdMax})`);
  if(firstDiverge<0)fail('huntress never responded to the herd call (A/B identical)');
  else if(divergePhase!=='warn')fail(`huntress first diverged during '${divergePhase}', not the telegraph`);
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)))fail(`ladder not strictly ordered (${JSON.stringify(o)})`);
  if(p.heldFrames!==6*s3)fail(`hitstop ${p.heldFrames}f != 6f per thunderjaw (${s3})`);
  if(p.slowedFrames>24*s3)fail(`slow-mo overspent: ${p.slowedFrames}f for ${s3} apexes (budget 24f each)`);
  if(p.admireFrames>24*s3)fail(`admire overspent: ${p.admireFrames}f for ${s3} apexes (budget 24f each)`);
  if(pa.downs>13)fail(`stampede run downs ${pa.downs} exceed watchable half-band 13 in 5 minutes`);
  const c=bootGame('horizon',{seed:0xa1020411,footer:ACT_FOOTER});
  const d=bootGame('horizon',{seed:0xa1020411,footer:ACT_FOOTER});
  d.sandbox.__NO_PAYOFF_FX=1;
  c.frames(10800,false);d.frames(10800,false);
  if(c.sandbox.__sig()!==d.sandbox.__sig())fail('__NO_PAYOFF_FX changed the sim: payoff confetti leaked into gameplay');
  else console.log('  __NO_PAYOFF_FX: sim signatures identical over 3 minutes');
}

console.log('ten-minute soak: moving, happening, progressing');
{
  const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
  const SOAK_FOOTER=`
;globalThis.__soakN={events:0,progress:0,lastK:0,lastM:0};
globalThis.__soakProbe=()=>{const n=globalThis.__soakN;
  if(kills>=n.lastK)n.events+=kills-n.lastK;n.lastK=kills;
  if(meters>=n.lastM)n.progress+=meters-n.lastM;n.lastM=meters;
  return{sig:Math.round(aloy.x*7+aloy.y*13+machines.reduce((a,m)=>a+m.x*3+m.y,0)),
    events:n.events,progress:n.progress,
    finite:[aloy.x,aloy.y,camY,meters].every(Number.isFinite)};};`;
  const{samples}=runSoak('horizon',{seed:0xa1020501,footer:SOAK_FOOTER,minutes:10});
  const report=analyzeSoak(samples);
  console.log('  '+soakLine(report));
  // measured seeds 0xa1020501/02: still 0-1s (world motion; Aloy alone may hold
  // a stealth hide for ~28s), quiet 20-38s, stall 9-29s, ~120 kills, ~1250m
  assertSoak('soak',report,{still:10,quiet:90,stall:90,minEvents:70,minProgress:700},fail);
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
