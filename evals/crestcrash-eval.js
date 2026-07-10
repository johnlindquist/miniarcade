#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');

const FOOTER=`
globalThis.__ccApplied=[];
{const __cca0=applyIntent;applyIntent=intent=>{const out=__cca0(intent);
  globalThis.__ccApplied.push({frame:runFrame,dive:!!intent.dive,trim:intent.trim,brace:!!intent.brace,
    targetId:intent.targetId,tactic:intent.tactic});
  if(globalThis.__ccApplied.length>240)globalThis.__ccApplied.shift();return out;};}
globalThis.__ccClearApplied=()=>{globalThis.__ccApplied.length=0;};
globalThis.__ccLastApplied=()=>globalThis.__ccApplied.at(-1)||null;
globalThis.__ccManualFlight=()=>{body.grounded=false;body.y=terrainY(body.x)-38;body.vx=2.4;body.vy=-.4;body.intent=null;
  return globalThis.__crestcrashManual();};
globalThis.__ccPhysical=()=>[Math.round(body.x*1e6),Math.round(body.y*1e6),Math.round(body.vx*1e6),
  Math.round(body.vy*1e6),body.grounded,body.intent&&body.intent.dive,body.intent&&body.intent.trim].join('|');
globalThis.__ccPlanOnce=()=>buildPlan(activeTarget());
globalThis.__ccNextRandom=()=>E.random();
globalThis.__ccPlannerFixture=()=>{
  resetRun(true);const t=activeTarget(),before=globalThis.__crestcrashSignature(),a=buildPlan(t),middle=globalThis.__crestcrashSignature(),
    b=buildPlan(t),after=globalThis.__crestcrashSignature(),pred=simulatePlan(t,a.releaseX,a.trim),r=Object.assign({},body),
    joint=targetJoint(t,true);let min=1e9,impactSpeed=0,launched=false;
  for(let f=0;f<360;f++){
    const intent={dive:r.grounded&&r.x<a.releaseX,trim:r.grounded?0:a.trim,brace:false};
    const ev=advanceBody(r,intent,forecastWind(f),true);if(ev.launched)launched=true;
    const d=Math.hypot(r.x-joint.x,r.y-joint.y);if(d<min){min=d;impactSpeed=Math.hypot(r.vx,r.vy);}
    if(r.x>t.x+30)break;
  }
  return{pure:before===middle&&middle===after,repeat:JSON.stringify(a)===JSON.stringify(b),
    error:Math.max(Math.abs(pred.min-min),Math.abs(pred.impactSpeed-impactSpeed)),predicted:pred,
    runtime:{min,impactSpeed,launched},finite:finiteObject(r)};
};
globalThis.__ccStartRecovery=()=>{resetRun(true);body.grounded=false;body.y-=120;body.vy=.5;body.integrity=1;
  hardImpact(8);return globalThis.__ccRecoveryState();};
globalThis.__ccRecoveryState=()=>({x:body.x,y:body.y,vx:body.vx,vy:body.vy,repairT:body.repairT,
  groundY:terrainY(body.x)-RADIUS,grounded:body.grounded,integrity:body.integrity,
  repairs:stats.repairs,recoveries:stats.recoveries,finite:allFinite()});
globalThis.__ccRecoveryFrames=n=>{for(let i=0;i<n;i++)stepWorld();return globalThis.__ccRecoveryState();};
globalThis.__ccSupportFixture=()=>{
  resetRun(true);const t=makeTarget(16);targets=[t];targetSerial=16;const count=t.blocks.length,
    anchored=t.blocks.filter(b=>b.supports.includes('anchor')).length;
  breakTarget(t);const unsupported=t.blocks.filter(b=>b.unsupported).length,initial=t.blocks.filter(b=>b.falling).length;
  stepTargets();const afterOne=t.blocks.filter(b=>b.falling).length;stepTargets();const afterTwo=t.blocks.filter(b=>b.falling).length;
  for(let i=0;i<48;i++)stepTargets();const eventual=t.blocks.filter(b=>b.falling).length;
  for(let i=0;i<1200;i++)stepTargets();const settled=t.blocks.filter(b=>b.settled).length,snapshot=t.blocks.map(b=>[b.x,b.y,b.rot]);
  for(let i=0;i<240;i++)stepTargets();const jitter=Math.max(...t.blocks.map((b,i)=>Math.hypot(b.x-snapshot[i][0],b.y-snapshot[i][1],b.rot-snapshot[i][2])));
  return{count,anchored,unsupported,initial,afterOne,afterTwo,eventual,settled,jitter,broken:t.broken,anchorAlive:t.anchorAlive,finite:allFinite()};
};
globalThis.__ccSweepFixture=()=>{
  resetRun(true);const t=activeTarget(),j=targetJoint(t,false);t.jointHP=.1;
  Object.assign(body,{lastX:j.x-30,lastY:j.y,x:j.x+30,y:j.y,vx:4.2,vy:0,grounded:false,
    hitT:0,repairT:0,integrity:100,intent:{dive:false,trim:0,brace:true,targetId:t.id,tactic:'FIXTURE'}});
  const endpointMiss=Math.min(Math.hypot(body.lastX-j.x,body.lastY-j.y),Math.hypot(body.x-j.x,body.y-j.y));
  collideTargets();return{endpointMiss,contactRadius:RADIUS+7,broken:t.broken,jointBreaks:stats.jointBreaks,finite:allFinite()};
};
globalThis.__ccCoilFixture=()=>{
  resetRun(true);body.needsCoil=true;body.coilT=120;const before={x:body.x,y:body.y,recoveries:stats.recoveries,coil:stats.coilRecoveries};
  stepWorld();return{before,after:{x:body.x,y:body.y,vx:body.vx,vy:body.vy,coilT:body.coilT,
    needsCoil:body.needsCoil,recoveries:stats.recoveries,coil:stats.coilRecoveries},finite:allFinite()};
};
globalThis.__ccCrestFixture=()=>{
  resetRun(true);const estimate=crestAfter(body.x);let peakX=estimate,peakY=Infinity;
  for(let x=estimate-24;x<=estimate+24;x+=.125){const y=terrainY(x);if(y<peakY){peakY=y;peakX=x;}}
  const h=.001,numeric=(terrainY(peakX+h)-terrainY(peakX-h))/(2*h),slope=terrainSlope(peakX),tan=tangentAt(peakX),normal={x:-tan.y,y:tan.x};
  return{estimate,peakX,delta:Math.abs(estimate-peakX),slope,numeric,error:Math.abs(slope-numeric),
    tangentLength:Math.hypot(tan.x,tan.y),normalLength:Math.hypot(normal.x,normal.y),dot:tan.x*normal.x+tan.y*normal.y};
};
globalThis.__ccTerrainSweepFixture=()=>{
  resetRun(true);const estimate=crestAfter(body.x);let peakX=estimate,peakY=Infinity;
  for(let x=estimate-24;x<=estimate+24;x+=.125){const y=terrainY(x);if(y<peakY){peakY=y;peakX=x;}}
  let span=12,bottom=peakY+2;for(let s=12;s<=24;s++)if(terrainY(peakX-s)-bottom>3&&terrainY(peakX+s)-bottom>3){span=s;break;}
  const start={x:peakX-span,y:bottom-RADIUS},end={x:peakX+span,y:bottom-RADIUS},hit=sweepTerrain(start.x,start.y,end.x,end.y),
    b={x:start.x,y:start.y,vx:(end.x-start.x)/.999,vy:-GRAV,rot:0,grounded:false,compression:0},
    startClear=terrainY(start.x)-(start.y+RADIUS),endClear=terrainY(end.x)-(end.y+RADIUS),ev=advanceBody(b,{dive:false,trim:0,brace:false},0,true);
  return{start,end,startClear,endClear,hit,landed:ev.landed,body:b,finite:finiteObject(b)};
};
globalThis.__ccExposeFixture=()=>{
  resetRun(true);const t=activeTarget(),base=t.jointY;t.exposed=true;t.exposeT=1;t.exposeDrop=0;
  const planned=targetJoint(t,true).y;stepTargets();const one=t.exposeDrop;
  for(let i=1;i<18;i++)stepTargets();const half=t.exposeDrop;
  for(let i=18;i<36;i++)stepTargets();const full=t.exposeDrop;
  return{base,planned,one,half,full,visual:targetJoint(t,false).y,finite:allFinite()};
};
globalThis.__ccExposePayoffFixture=()=>{
  resetRun(true);const t=activeTarget(),pathY=t.jointY+18;t.exposed=true;t.jointHP=.1;
  for(const b of t.blocks)b.x+=200;
  if(typeof globalThis.__NO_EXPOSED_RECOVERY==='undefined'){t.exposeT=1;plan=null;planAt=-1e9;}
  for(let i=0;i<36;i++)stepTargets();
  const joint=targetJoint(t,false);Object.assign(body,{lastX:t.jointX-30,lastY:pathY,x:t.jointX+30,y:pathY,
    vx:4.2,vy:0,grounded:false,hitT:0,repairT:0,integrity:100,
    intent:{dive:false,trim:0,brace:true,targetId:t.id,tactic:'FIXTURE'}});
  const path=[body.lastX,body.lastY,body.x,body.y].join('|');collideTargets();
  return{path,pathY,jointY:joint.y,drop:t.exposeDrop,broken:t.broken,jointBreaks:stats.jointBreaks,finite:allFinite()};
};
globalThis.__ccBreakFrames=[];globalThis.__ccEffectivePlates=0;
{const __ccb0=breakTarget;breakTarget=t=>{const n=stats.jointBreaks,out=__ccb0(t);
  if(stats.jointBreaks>n)globalThis.__ccBreakFrames.push(showFrame);return out;};}
globalThis.__ccBreakGap=()=>{const a=globalThis.__ccBreakFrames;let max=a.length?a[0]:showFrame;
  for(let i=1;i<a.length;i++)max=Math.max(max,a[i]-a[i-1]);if(a.length)max=Math.max(max,showFrame-a.at(-1));return max;};
{const __ccs0=stepActs;stepActs=()=>{const was=plating.phase,id=plating.targetId,t=targets.find(v=>v.id===id),n=t?t.blocks.length:-1,
    out=__ccs0();if(was==='warn'&&plating.phase==='live'){const q=targets.find(v=>v.id===id),added=q&&q.blocks.at(-1);
      if(q&&!q.resolved&&!q.broken&&q.shifted&&q.blocks.length===n+1&&added.material==='alloy'&&added.supports.includes('anchor'))
        globalThis.__ccEffectivePlates++;}return out;};}
globalThis.__ccContinuity={max:0,from:null,to:null};
{const __ccw0=stepWorld;stepWorld=()=>{const from={x:body.x,y:body.y},out=__ccw0(),to={x:body.x,y:body.y},d=Math.hypot(to.x-from.x,to.y-from.y);
  if(d>globalThis.__ccContinuity.max)globalThis.__ccContinuity={max:d,from,to};return out;};}
globalThis.__ccWorld=()=>({terrainAmp,terrainRipple,worldVariant});
globalThis.__ccNearApexSetup=()=>{
  resetRun(true);stats.jointBreaks=runBase.jointBreaks+80;stats.coreBreaks=runBase.coreBreaks+10;stats.crownBreaks=runBase.crownBreaks+1;
  runFrame=53999;SHOW.offer({id:'fixture-apex',tier:3,at:showFrame,tag:'DRAIN TEST',expiresAt:showFrame+120});
  return{runFrame,showFrame,show:SHOW.probe()};
};
globalThis.__ccStoryFlight=(dx,dy,vx,vy)=>{
  const t=activeTarget(),j=targetJoint(t,true);
  Object.assign(body,{x:j.x+dx,y:j.y+dy,vx,vy,grounded:false,hitT:0,repairT:0});
  body.lastX=body.x;body.lastY=body.y;
  return globalThis.__crestcrashViewerProbe();
};
globalThis.__ccEndingLog=[];
{const __cce0=finishRun;finishRun=()=>{const before=stats.endings,out=__cce0();
  if(stats.endings>before)globalThis.__ccEndingLog.push({showFrame,runFrame,state,resultT,outcome:lastOutcome,
    jointBreaks:runCount('jointBreaks'),coreBreaks:runCount('coreBreaks'),crownBreaks:runCount('crownBreaks')});return out;};}
`;

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const minmax=a=>[Math.min(...a),Math.max(...a)];
const median=a=>{const b=a.slice().sort((x,y)=>x-y),m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])/2;};
const mean=a=>a.reduce((n,v)=>n+v,0)/a.length;
const rate=p=>p.jointBreaks/(p.jointBreaks+p.misses);
// Pre-registered 30-seed x 10-minute calibration on 2026-07-09, seeds
// 0xcd00..1d, game SHA-256 232b6f19... . Observed p05..p95:
// launches 111..126, landings 108..122, impacts 108..120,
// breaks 90..99, cores 13..15, misses 21..30, tumbles 14..22,
// repairs 3..4, recoveries 6..9, coil rescues 3..5, lapses 6..7,
// events 374..418, progress 186..204. Viewer-time break-gap p95 was
// 1003f and the measured maximum 1193f; all 30 runs landed both acts 4x
// and made all four Plating lands structurally effective.
// A paired full-run __NO_EXPOSED_RECOVERY panel on the same seeds measured
// five >1200f payoff-lull breaches (p95 1668f, max 2624f) versus zero here.
// Bands below add explicit margin around those percentiles and extrema.
const WATCH_BANDS={
  jointBreaks:[84,104],coreBreaks:[9,18],launches:[105,131],landings:[102,126],impacts:[100,126],
  misses:[17,37],tumbles:[9,29],repairs:[2,5],recoveries:[4,12],coilRecoveries:[2,8],lapses:[4,9]
};
// The same five-minute bands cover both policies in the 12-pair ablation:
// planned is competent, reactive is visibly worse, neither becomes inert or
// absurdly chaotic. Calibrated combined extrema were launch 55..101,
// miss 10..70, tumble 5..20, repair 1..3, collapse 34..50, coil 1..4.
const POLICY_BANDS={launches:[50,106],misses:[6,76],tumbles:[4,25],repairs:[1,4],collapses:[30,55],coilRecoveries:[1,5]};
const inBands=(p,bands,label)=>{for(const[k,[lo,hi]]of Object.entries(bands))if(p[k]<lo||p[k]>hi)
  fail(`${label}: ${k} ${p[k]} outside shared measured band ${lo}..${hi}`);};
const actPairs=(p,id,warn,label)=>{
  const notes=p.acts.notes.filter(n=>n.id===id),warnings=notes.filter(n=>n.kind==='act-warning'),lands=notes.filter(n=>n.kind==='act-land');
  if(warnings.length<2||lands.length!==warnings.length)fail(`${label}: ${id} emitted ${warnings.length} warnings / ${lands.length} lands`);
  for(let i=0;i<Math.min(warnings.length,lands.length);i++)if(lands[i].tag-warnings[i].tag!==warn)
    fail(`${label}: ${id} pair ${i} warned ${lands[i].tag-warnings[i].tag}f, expected ${warn}`);
  return lands.length;
};

console.log('1) deterministic replay + render parity: one seed, one complete simulation');
{
  const a=bootGame('crestcrash',{seed:0xcc01,footer:FOOTER}),b=bootGame('crestcrash',{seed:0xcc01,footer:FOOTER}),
    rendered=bootGame('crestcrash',{seed:0xcc01,footer:FOOTER});
  a.frames(7200,false);b.frames(7200,false);rendered.frames(7200,true);
  const sa=a.sandbox.__crestcrashSignature(),sb=b.sandbox.__crestcrashSignature(),sr=rendered.sandbox.__crestcrashSignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${rendered.counter.calls} draw calls on final frame`);
  if(sa!==sb)fail('same seed diverged under identical fixed 60 Hz headless steps');
  if(sa!==sr)fail('render traversal changed simulation state or RNG');
  if(!a.sandbox.__crestcrashProbe().finite)fail('deterministic replay ended non-finite');
  const mono=bootGame('crestcrash',{seed:0xcc05,footer:FOOTER}),chunked=bootGame('crestcrash',{seed:0xcc05,footer:FOOTER});
  mono.frames(18000,false);for(let i=0;i<1800;i++)chunked.frames(10,false);
  const chunkSame=mono.sandbox.__crestcrashSignature()===chunked.sandbox.__crestcrashSignature();
  console.log(`  18,000 monolithic frames vs 1,800 x 10: ${chunkSame?'identical':'DIFFERENT'}`);
  if(!chunkSame)fail('headless batching changed the deterministic fixed-step result');
}

console.log('2) arc planner: copied runtime integrator is exact, repeatable, pure, and RNG-free');
{
  const game=bootGame('crestcrash',{seed:0xcc02,footer:FOOTER}),f=game.sandbox.__ccPlannerFixture();
  const control=bootGame('crestcrash',{seed:0xcc03,footer:FOOTER}),planned=bootGame('crestcrash',{seed:0xcc03,footer:FOOTER});
  planned.sandbox.__ccPlanOnce();const rp=planned.sandbox.__ccNextRandom(),rc=control.sandbox.__ccNextRandom();
  console.log(`  error ${f.error}; pure ${f.pure}; repeat ${f.repeat}; min ${f.predicted.min.toFixed(3)}px; next RNG ${rp.toFixed(8)}/${rc.toFixed(8)}`);
  if(!f.pure||!f.repeat||f.error!==0||!f.runtime.launched||!f.finite)
    fail(`planner/runtime fixture regressed: ${JSON.stringify(f)}`);
  if(rp!==rc)fail('arc planning consumed engine RNG for simulation-invisible work');
  const crest=game.sandbox.__ccCrestFixture();
  console.log(`  crest estimate delta ${crest.delta.toFixed(3)}px; analytic/numeric slope ${crest.slope.toFixed(6)}/${crest.numeric.toFixed(6)}`);
  if(crest.delta>12||Math.abs(crest.slope)>.03||crest.error>1e-5||Math.abs(crest.tangentLength-1)>1e-12||
    Math.abs(crest.normalLength-1)>1e-12||Math.abs(crest.dot)>1e-12)
    fail(`crest tangent/normal fixture regressed: ${JSON.stringify(crest)}`);
  const terrain=game.sandbox.__ccTerrainSweepFixture();
  console.log(`  max-speed crest crossing: endpoints clear ${terrain.startClear.toFixed(1)}/${terrain.endClear.toFixed(1)}px, `+
    `contact t=${terrain.hit&&terrain.hit.t.toFixed(3)} in ${terrain.hit&&terrain.hit.steps} chords`);
  if(terrain.startClear<=3||terrain.endClear<=3||!terrain.hit||terrain.hit.t<=0||terrain.hit.t>=1||terrain.hit.steps<=1||
    terrain.hit.steps>24||!terrain.landed||terrain.body.x<=terrain.start.x||terrain.body.x>=terrain.end.x||!terrain.finite)
    fail(`maximum-speed terrain sweep tunneled through a crest: ${JSON.stringify(terrain)}`);
}

console.log('3) honest impact: a braced, fast joint strike topples physical blocks');
{
  const game=bootGame('crestcrash',{seed:0xcc03,footer:FOOTER}),p=game.sandbox.__crestcrashImpactFixture(),
    support=game.sandbox.__ccSupportFixture(),sweep=game.sandbox.__ccSweepFixture();
  console.log(`  broken ${p.broken}; ${p.falling} blocks falling, ${p.settled} settled; ${p.jointBreaks} joint break`);
  if(!p.broken||p.jointBreaks!==1||p.falling<7||p.settled<1||!p.finite)
    fail(`joint impact/topple fixture failed: ${JSON.stringify(p)}`);
  console.log(`  support graph ${support.anchored} anchors -> ${support.unsupported}/${support.count} unsupported; falling ${support.initial}->${support.afterOne}->${support.afterTwo}->${support.eventual}`);
  if(!support.broken||support.anchorAlive||support.anchored<2||support.unsupported!==support.count||support.initial!==0||
    support.afterOne!==0||support.afterTwo<1||support.eventual!==support.count||support.settled!==support.count||support.jitter!==0||!support.finite)
    fail(`support-chain collapse lost its staggered physical propagation: ${JSON.stringify(support)}`);
  console.log(`  swept strike endpoints miss by ${sweep.endpointMiss.toFixed(1)}px; joint broken ${sweep.broken}`);
  if(sweep.endpointMiss<=sweep.contactRadius||!sweep.broken||sweep.jointBreaks<1||!sweep.finite)
    fail(`swept collision tunneled through the relay joint: ${JSON.stringify(sweep)}`);
}

console.log('4) visible failure recovery: disabled shell falls, settles, and repairs in exactly 180 frames');
{
  const game=bootGame('crestcrash',{seed:0xcc04,footer:FOOTER}),fallen=game.sandbox.__ccStartRecovery();
  const falling=game.sandbox.__ccRecoveryFrames(30),waiting=game.sandbox.__ccRecoveryFrames(149),recovered=game.sandbox.__ccRecoveryFrames(1);
  console.log(`  repair ${fallen.repairT}->${falling.repairT}->${waiting.repairT}->${recovered.repairT}; `+
    `fall ${fallen.y.toFixed(1)}->${falling.y.toFixed(1)}->${waiting.y.toFixed(1)}; shell ${fallen.integrity}->${recovered.integrity}`);
  if(fallen.grounded||fallen.repairT!==180||fallen.repairs!==1||falling.repairT!==150||falling.y<=fallen.y)
    fail(`disabled shell did not visibly fall during field repair: ${JSON.stringify({fallen,falling})}`);
  if(waiting.repairT!==1||waiting.recoveries!==0||!waiting.grounded||Math.abs(waiting.y-waiting.groundY)>.001)
    fail(`field repair did not visibly wait on the terrain for frame 180: ${JSON.stringify(waiting)}`);
  if(recovered.repairT!==0||recovered.integrity!==100||recovered.recoveries!==1||!recovered.finite)
    fail(`field repair did not return through the runtime recovery path: ${JSON.stringify(recovered)}`);
  if(waiting.x!==recovered.x||waiting.y!==recovered.y)
    fail('repair teleported the shell away from its visible landing site');
  const coil=game.sandbox.__ccCoilFixture(),speed=Math.hypot(coil.after.vx,coil.after.vy);
  console.log(`  coil recovery ${coil.before.coil}->${coil.after.coil}; speed ${speed.toFixed(2)}, moved ${(coil.after.x-coil.before.x).toFixed(2)}px`);
  if(coil.after.coil!==coil.before.coil+1||coil.after.recoveries!==coil.before.recoveries+1||coil.after.coilT!==0||
    coil.after.needsCoil||speed<1.9||coil.after.x===coil.before.x||!coil.finite)
    fail(`visible coil anti-stall recovery regressed: ${JSON.stringify(coil)}`);
  const exposed=game.sandbox.__ccExposeFixture();
  console.log(`  exposed joint drops ${exposed.one}->${exposed.half}->${exposed.full}px; planned/visible y ${exposed.planned.toFixed(1)}/${exposed.visual.toFixed(1)}`);
  if(exposed.one!==.5||exposed.half!==9||exposed.full!==18||exposed.planned!==exposed.base+18||
    exposed.visual!==exposed.base+18||!exposed.finite)
    fail(`exposed-joint recovery was not an honest visible 36-frame geometry change: ${JSON.stringify(exposed)}`);
}

console.log('5) measured ten-minute watchability distribution: four representative calibrated seeds');
const watch=[],watchSeeds=[0xcd00,0xcd01,0xcd0f,0xcd17];
for(const seed of watchSeeds){
  const game=bootGame('crestcrash',{seed,footer:FOOTER});game.frames(36000,false);const p=game.sandbox.__crestcrashProbe();
  p.breakGap=game.sandbox.__ccBreakGap();p.effectivePlates=game.sandbox.__ccEffectivePlates;
  p.world=game.sandbox.__ccWorld();p.continuity=game.sandbox.__ccContinuity;watch.push(p);
  console.log(`  ${seed.toString(16)} ${p.persona.padEnd(9)}: ${p.jointBreaks} breaks/${p.coreBreaks} cores, ${p.launches} launch/${p.landings} land, `+
    `${p.misses} miss, ${p.tumbles} tumble, ${p.repairs} repair/${p.coilRecoveries} coil, `+
    `lulls ${(p.breakGap/60).toFixed(1)}s destructive/${(p.maxProgressLull/60).toFixed(1)}s story, ${p.effectivePlates} plates`);
  if(!p.finite)fail(`seed ${seed.toString(16)}: non-finite shell, target, or debris state`);
  if(p.stats.invisibleResets!==0)fail(`seed ${seed.toString(16)}: ${p.stats.invisibleResets} invisible resets`);
  if(p.continuity.max>20)fail(`seed ${seed.toString(16)}: unaccounted ${p.continuity.max.toFixed(2)}px one-step position discontinuity`);
  actPairs(p,'headwind',240,`seed ${seed.toString(16)}`);actPairs(p,'plating',210,`seed ${seed.toString(16)}`);
  if(p.effectivePlates<2)fail(`seed ${seed.toString(16)}: only ${p.effectivePlates} Plating lands changed the structure`);
}
{
  const keys=['jointBreaks','coreBreaks','launches','landings','impacts','misses','tumbles','repairs','recoveries','coilRecoveries','lapses'];
  console.log('  distribution '+keys.map(k=>`${k} ${minmax(watch.map(p=>p[k])).join('..')}`).join('; '));
  for(let i=0;i<watch.length;i++){
    const p=watch[i],seed=watchSeeds[i].toString(16);inBands(p,WATCH_BANDS,`seed ${seed} ${p.persona}`);
    if(p.stats.events<350||p.stats.events>435||p.stats.progress<174||p.stats.progress>214)
      fail(`seed ${seed}: event/progress totals ${p.stats.events}/${p.stats.progress} outside measured-margin 350..435 / 174..214`);
    if(p.maxEventLull>420)fail(`seed ${seed}: visible-event lull ${p.maxEventLull}f exceeds 420f measured margin`);
    if(p.breakGap>1200)fail(`seed ${seed}: destructive-payoff lull ${p.breakGap}f exceeds hard 1200f`);
    if(p.maxProgressLull>1800)fail(`seed ${seed}: story-progress lull ${p.maxProgressLull}f exceeds hard 1800f`);
  }
  const variants=new Set(watch.map(p=>p.world.worldVariant)),personas=new Set(watch.map(p=>p.persona));
  if(variants.size!==watch.length||personas.size!==3)fail(`seed freshness too low: ${variants.size} variants / ${personas.size} personas`);
}

console.log('6) arc-plan A/B: twelve paired five-minute seeds against crest-only reactive release');
{
  const smart=[],reactive=[];let wins=0;
  for(let i=0;i<12;i++){
    const seed=0xce00+i,a=bootGame('crestcrash',{seed,footer:FOOTER}),b=bootGame('crestcrash',{seed,footer:FOOTER});
    b.sandbox.__NO_ARC_PLAN=1;a.frames(18000,false);b.frames(18000,false);
    const pa=a.sandbox.__crestcrashProbe(),pb=b.sandbox.__crestcrashProbe();pa.breakGap=a.sandbox.__ccBreakGap();pb.breakGap=b.sandbox.__ccBreakGap();
    pa.rate=rate(pa);pb.rate=rate(pb);smart.push(pa);reactive.push(pb);if(pa.rate>pb.rate)wins++;
    inBands(pa,POLICY_BANDS,`seed ${seed.toString(16)} planned`);inBands(pb,POLICY_BANDS,`seed ${seed.toString(16)} reactive`);
    console.log(`  ${seed.toString(16)} ${pa.persona.padEnd(9)} planned ${(pa.rate*100).toFixed(1)}%/${pa.coreBreaks} core/${pa.breakGap}f `+
      `vs reactive ${(pb.rate*100).toFixed(1)}%/${pb.coreBreaks}/${pb.breakGap}f`);
  }
  const meanSmart=mean(smart.map(p=>p.rate)),meanReactive=mean(reactive.map(p=>p.rate)),
    coresSmart=smart.reduce((n,p)=>n+p.coreBreaks,0),coresReactive=reactive.reduce((n,p)=>n+p.coreBreaks,0),
    lullSmart=median(smart.map(p=>p.breakGap)),lullReactive=median(reactive.map(p=>p.breakGap)),
    hardSmart=Math.max(...smart.map(p=>p.maxProgressLull)),hardReactive=Math.max(...reactive.map(p=>p.maxProgressLull));
  console.log(`  ${wins}/12 rate wins; mean ${(meanSmart*100).toFixed(1)}% vs ${(meanReactive*100).toFixed(1)}% `+
    `(+${((meanSmart-meanReactive)*100).toFixed(1)}pp); cores ${coresSmart}/${coresReactive}; median payoff lull ${lullSmart}/${lullReactive}f`);
  if(wins<9)fail(`arc planner won called-shot payoff rate on only ${wins}/12 seeds`);
  if(meanSmart-meanReactive<.15)fail(`arc planner mean called-shot gain ${((meanSmart-meanReactive)*100).toFixed(1)}pp below 15pp`);
  if(coresSmart<coresReactive*1.2)fail(`arc planner core gain ${coresSmart}/${coresReactive} below 20%`);
  if(lullSmart>lullReactive)fail(`arc planner worsened median destructive-payoff lull ${lullSmart}/${lullReactive}f`);
  if(hardSmart>1800||hardReactive>1800)fail(`policy hard progress lull ${hardSmart}/${hardReactive}f exceeds 1800f`);

  const physical=bootGame('crestcrash',{seed:0xcd01,footer:FOOTER}),physicalOff=bootGame('crestcrash',{seed:0xcd01,footer:FOOTER});
  physicalOff.sandbox.__NO_EXPOSED_RECOVERY=1;const fp=physical.sandbox.__ccExposePayoffFixture(),fa=physicalOff.sandbox.__ccExposePayoffFixture();
  console.log(`  exposed physical A/B: ${fp.drop}px drop / broken ${fp.broken} vs ${fa.drop}px / ${fa.broken}; same swept path ${fp.path===fa.path}`);
  if(fp.path!==fa.path||fp.drop!==18||fa.drop!==0||fp.jointY!==fp.pathY||fa.jointY===fa.pathY||
    !fp.broken||fa.broken||fp.jointBreaks!==1||fa.jointBreaks!==0||!fp.finite||!fa.finite)
    fail(`visible exposed-joint geometry did not create a same-path physical payoff: ${JSON.stringify({on:fp,off:fa})}`);

  // Strongest pre-registered seed from the final 30-pair, ten-minute panel:
  // default 98 breaks/14 cores/30 misses/203 progress/885f gap;
  // ablated 94/13/35/195/2624f. Five of 30 ablated seeds breached 1200f.
  const recovered=bootGame('crestcrash',{seed:0xcd01,footer:FOOTER}),ablated=bootGame('crestcrash',{seed:0xcd01,footer:FOOTER});
  ablated.sandbox.__NO_EXPOSED_RECOVERY=1;recovered.frames(36000,false);ablated.frames(36000,false);
  const pr=recovered.sandbox.__crestcrashProbe(),pa=ablated.sandbox.__crestcrashProbe(),gr=recovered.sandbox.__ccBreakGap(),ga=ablated.sandbox.__ccBreakGap();
  console.log(`  exposed recovery A/B: ${pr.jointBreaks} breaks/${pr.coreBreaks} cores/${pr.misses} misses/${pr.stats.progress} progress/${gr}f `+
    `vs ${pa.jointBreaks}/${pa.coreBreaks}/${pa.misses}/${pa.stats.progress}/${ga}f ablated`);
  if(gr>1200||ga<=1800||ga-gr<1000||pr.jointBreaks<pa.jointBreaks+2||pr.coreBreaks<pa.coreBreaks||
    pr.misses>pa.misses-2||pr.stats.progress<pa.stats.progress+4)
    fail(`visible exposed-joint recovery did not re-prove its measured viewer-time win: ${JSON.stringify({breaks:[pr.jointBreaks,pa.jointBreaks],cores:[pr.coreBreaks,pa.coreBreaks],misses:[pr.misses,pa.misses],progress:[pr.stats.progress,pa.stats.progress],gaps:[gr,ga]})}`);
}

console.log('7) acts: exact note pairs and first act-independent divergence during warning');
for(const spec of[{id:'headwind',warn:240,tactic:'CUT HEADWIND'},{id:'plating',warn:210,tactic:'BEAT PLATING'}]){
  const seed=spec.id==='headwind'?0xcca1:0xcca2,a=bootGame('crestcrash',{seed,footer:FOOTER}),b=bootGame('crestcrash',{seed,footer:FOOTER});
  a.sandbox.__crestcrashSetAct(spec.id);b.sandbox.__crestcrashSetAct(spec.id);b.sandbox.__NO_ACTS=1;
  let first=-1,phase='',tactic='';
  for(let f=1;f<=spec.warn+90;f++){
    a.frames(1,false);b.frames(1,false);
    if(first<0&&a.sandbox.__ccPhysical()!==b.sandbox.__ccPhysical()){
      first=f;const s=a.sandbox.__crestcrashActState();phase=s[spec.id];tactic=s.tactic;
    }
  }
  const pa=a.sandbox.__crestcrashProbe(),pb=b.sandbox.__crestcrashProbe(),notes=pa.acts.notes.filter(n=>n.id===spec.id),
    warning=notes.find(n=>n.kind==='act-warning'),land=notes.find(n=>n.kind==='act-land'),lead=warning&&land?land.tag-warning.tag:null;
  console.log(`  ${spec.id}: ${lead}f warning; first body/intent divergence ${first}f in ${phase}, tactic ${tactic}`);
  if(notes.length!==2||!warning||!land||lead!==spec.warn)fail(`${spec.id}: warning/land note pair was not exactly ${spec.warn} frames`);
  if(first<0||phase!=='warn'||tactic!==spec.tactic)fail(`${spec.id}: first physical/control divergence was not the legible warning response`);
  if(pb.acts.notes.some(n=>n.id===spec.id))fail(`__NO_ACTS emitted ${spec.id} notes`);
}
{
  const game=bootGame('crestcrash',{seed:0xcca3,footer:FOOTER});game.sandbox.__crestcrashSetAct('headwind');game.frames(60,false);
  const warning=game.sandbox.__crestcrashProbe();press(game,'Enter');press(game,'Enter');const reset=game.sandbox.__crestcrashProbe();
  game.frames(300,false);const after=game.sandbox.__crestcrashProbe(),staleLands=after.acts.notes.filter(n=>n.id==='headwind'&&n.kind==='act-land').length;
  console.log(`  session reset during warning: ${warning.acts.headwind}->${reset.acts.headwind}; run ${reset.runFrame}->${after.runFrame}, stale lands ${staleLands}`);
  if(warning.acts.headwind!=='warn'||reset.acts.headwind!=='calm'||reset.runFrame!==1||staleLands!==0||!after.finite||!after.playing)
    fail('session reset leaked or landed the canceled warning act');
}

console.log('8) manual takeover: two Enter gate and all human fields traverse applyIntent');
{
  const game=bootGame('crestcrash',{seed:0xccb1,footer:FOOTER}),initial=game.sandbox.__crestcrashManual();
  press(game,'Enter');const instructions=game.sandbox.__crestcrashManual();press(game,'Enter');const started=game.sandbox.__crestcrashManual();
  game.sandbox.__ccClearApplied();game.key('keydown','ArrowDown');game.frames(12,false);game.key('keyup','ArrowDown');const dive=game.sandbox.__ccLastApplied();
  game.sandbox.__ccManualFlight();game.sandbox.__ccClearApplied();game.key('keydown','ArrowRight');game.frames(12,false);game.key('keyup','ArrowRight');const trim=game.sandbox.__ccLastApplied();
  game.sandbox.__ccClearApplied();game.key('keydown','KeyX');game.frames(1,false);game.key('keyup','KeyX');const brace=game.sandbox.__ccLastApplied();
  const p=game.sandbox.__crestcrashProbe();
  console.log(`  playing ${initial.playing}->${instructions.playing}->${started.playing}; intents ${JSON.stringify({dive,trim,brace})}`);
  if(initial.playing||instructions.playing||!started.playing)fail('manual session skipped the two-Enter instructions gate');
  if(!dive||!dive.dive||dive.tactic!=='MANUAL')fail('manual Down did not reach common applyIntent as dive');
  if(!trim||trim.trim!==1||trim.tactic!=='MANUAL')fail('manual Right did not reach common applyIntent as flight trim');
  if(!brace||!brace.brace||brace.tactic!=='MANUAL')fail('manual X did not reach common applyIntent as brace');
  if(p.stats.appliedIntents<25)fail('manual controller bypassed the shared intent application path');
}

console.log('9) 15-minute ending + payoff ladder: exact apex budgets and admire gate');
{
  const game=bootGame('crestcrash',{seed:0xcc10,footer:FOOTER});
  while(!game.sandbox.__ccEndingLog.length&&game.sandbox.__crestcrashProbe().showFrame<57000)game.frames(300,false);
  game.frames(420,false);
  const p=game.sandbox.__crestcrashProbe(),ending=game.sandbox.__ccEndingLog[0],show=p.show,o=show.offeredByTier,s=show.shownByTier,s3=s[3]||0,
    admire=game.sandbox.__crestcrashAdmireFixture();
  console.log(`  ending ${ending&&ending.runFrame} runf/${ending&&ending.showFrame} showf; tiers ${JSON.stringify(o)} shown ${JSON.stringify(s)}; `+
    `hold ${show.heldFrames}, slow ${show.slowedFrames}, admire ${show.admireFrames}`);
  if(!ending||ending.runFrame!==54000||ending.state!=='ending'||ending.resultT!==360||p.stats.endings!==1)
    fail(`range did not culminate visibly and exactly at run frame 54000: ${JSON.stringify(ending)}`);
  if(ending.outcome!=='RANGE COMPLETE'||ending.jointBreaks<80||ending.coreBreaks<10||ending.crownBreaks<1)
    fail(`15-minute arc ended without earning the relay/core victory: ${JSON.stringify(ending)}`);
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=1))fail(`offered payoff ladder not strictly ordered: ${JSON.stringify(o)}`);
  if(!((s[1]||0)>(s[2]||0)&&(s[2]||0)>(s[3]||0)&&(s[3]||0)>=1))fail(`shown payoff ladder not strictly ordered: ${JSON.stringify(s)}`);
  if(show.heldFrames!==6*s3)fail(`apex hitstop ${show.heldFrames} != 6*${s3}`);
  if(show.slowedFrames!==24*s3)fail(`apex slow motion ${show.slowedFrames} != 24*${s3}`);
  if(show.admireFrames!==48*s3)fail(`apex admire ${show.admireFrames} != 48*${s3}`);
  if(admire.admired!=='ADMIRE'||admire.gated==='ADMIRE')fail(`__NO_ADMIRE did not gate bot-only pause: ${JSON.stringify(admire)}`);
}
{
  const game=bootGame('crestcrash',{seed:0xccb2,footer:FOOTER});game.sandbox.__ccNearApexSetup();
  for(let i=0;i<100&&!game.sandbox.__ccEndingLog.length;i++)game.frames(1,false);
  const atEnd=game.sandbox.__crestcrashProbe(),ending=game.sandbox.__ccEndingLog[0],active=atEnd.show.active;
  game.frames(100,false);const drained=game.sandbox.__crestcrashProbe(),s3=drained.show.shownByTier[3]||0;
  console.log(`  near-apex completion: ending at ${ending&&ending.runFrame} with active tier ${active&&active.tier}; `+
    `drained ${drained.show.heldFrames}/${drained.show.slowedFrames}/${drained.show.admireFrames}f`);
  if(!ending||ending.outcome!=='RANGE COMPLETE'||!active||active.tier!==3||drained.state!=='ending'||drained.show.active||s3!==1||
    drained.show.heldFrames!==6||drained.show.slowedFrames!==24||drained.show.admireFrames!==48)
    fail(`mission completion did not safely drain the active tier-3 cue: ${JSON.stringify({ending,active,show:drained.show,state:drained.state})}`);
}

console.log('10) payoff FX parity: disabling sim-inert bursts changes no outcome state');
{
  const a=bootGame('crestcrash',{seed:0xccc1,footer:FOOTER}),b=bootGame('crestcrash',{seed:0xccc1,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);
  const same=a.sandbox.__crestcrashSignature()===b.sandbox.__crestcrashSignature();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} after ${a.sandbox.__crestcrashProbe().jointBreaks} topples`);
  if(!same)fail('__NO_PAYOFF_FX changed shell, terrain, target, act, or outcome state');
}

console.log('11) shared ten-minute soak: moving, happening, and toppling relays');
{
  const{samples}=runSoak('crestcrash',{seed:0xcd00,footer:FOOTER,minutes:10}),report=analyzeSoak(samples);
  console.log('  '+soakLine(report));
  // 30-seed calibration measured 362..423 events and 186..204 progress;
  // the shared sampler additionally enforces the hard 240f ordinary-stillness
  // and 1800f story-stall contracts.
  assertSoak('crestcrash soak',report,{still:4,quiet:8,stall:30,minEvents:340,minProgress:170},fail);
}

console.log('12) viewer story: plain goal from frame one, truthful receipts, presentation-only A/B');
{
  const game=bootGame('crestcrash',{seed:0xccd1,footer:FOOTER});game.frames(1,true);
  const v=game.sandbox.__crestcrashViewerProbe();
  console.log(`  opening "${v.drawn.hud}" / "${v.drawn.verb}" / ${v.drawn.targetLabel}`);
  if(!v.enabled||!v.drawn.enabled||v.drawn.frame!==game.sandbox.__crestcrashProbe().showFrame||
    v.drawn.hud!=='TOPPLE RANGE 00/80'||v.drawn.hud!==v.hud||!v.drawn.verb||v.drawn.verb!==v.verb||
    v.drawn.targetLabel!=='RELAY AHEAD'||v.drawn.barFrac!==0||v.drawn.corePips!==0||v.drawn.crownLit)
    fail(`first rendered frame did not plainly explain the show: ${JSON.stringify(v)}`);
  game.frames(7199,true);
  const p=game.sandbox.__crestcrashProbe(),v2=game.sandbox.__crestcrashViewerProbe();
  console.log(`  2 minutes in: "${v2.drawn.hud}", ${v2.drawn.corePips} core pips, bar ${(v2.drawn.barFrac*100).toFixed(1)}%`);
  if(v2.relays!==p.run.jointBreaks||v2.cores!==p.run.coreBreaks||v2.drawn.hud!==v2.hud||
    v2.drawn.barFrac!==v2.barFrac||v2.drawn.corePips!==v2.corePips||v2.drawn.verb!==v2.verb||
    p.run.jointBreaks<1||!v2.drawn.hud.includes('/80'))
    fail(`persistent goal HUD disagreed with simulation truth: ${JSON.stringify({v2,run:p.run})}`);

  const flight=bootGame('crestcrash',{seed:0xccd2,footer:FOOTER}),labels=[];
  for(const[expect,args]of[['ON LINE',[-30,-20,3,1]],['SHORT',[-120,-10,1,0]],['LONG',[10,-40,3,-1]]]){
    const s=flight.sandbox.__ccStoryFlight(...args);labels.push(`${s.forecast} (min ${s.forecastMin.toFixed(1)}px, delta ${s.forecastDelta.toFixed(1)})`);
    const truthful=s.forecast==='ON LINE'?s.forecastMin<=s.forecastTolerance:
      s.forecast==='SHORT'?s.forecastMin>s.forecastTolerance&&s.forecastDelta<0:
      s.forecast==='LONG'?s.forecastMin>s.forecastTolerance&&s.forecastDelta>=0:false;
    if(s.forecast!==expect||!truthful)
      fail(`flight forecast lied: expected ${expect}, got ${JSON.stringify(s)}`);
  }
  console.log(`  forecasts ${labels.join('; ')}`);
  flight.sandbox.__ccStoryFlight(-30,-20,3,1);flight.frames(1,true);
  const inFlight=flight.sandbox.__crestcrashViewerProbe();
  if(!inFlight.drawn.forecast||inFlight.drawn.forecast!==inFlight.forecast)
    fail(`airborne frame did not draw its own truthful forecast: ${JSON.stringify(inFlight)}`);

  const a=bootGame('crestcrash',{seed:0xccd3,footer:FOOTER}),b=bootGame('crestcrash',{seed:0xccd3,footer:FOOTER});
  b.sandbox.__NO_VIEWER_STORY=1;a.frames(7200,true);b.frames(7200,true);
  const same=a.sandbox.__crestcrashSignature()===b.sandbox.__crestcrashSignature(),
    ra=a.sandbox.__ccNextRandom(),rb=b.sandbox.__ccNextRandom(),
    va=a.sandbox.__crestcrashViewerProbe(),vb=b.sandbox.__crestcrashViewerProbe();
  console.log(`  2-minute rendered A/B signatures ${same?'identical':'DIFFER'}; next RNG ${ra.toFixed(8)}/${rb.toFixed(8)}; story ${va.enabled}/${vb.enabled}`);
  if(!same)fail('viewer story rendering changed the same-seed simulation');
  if(ra!==rb)fail('viewer story consumed engine RNG for simulation-invisible work');
  if(!va.enabled||vb.enabled||vb.drawn.hud!==''||vb.drawn.verb!==''||vb.drawn.forecast!==''||vb.drawn.targetLabel!=='')
    fail(`__NO_VIEWER_STORY did not cleanly ablate the presentation layer: ${JSON.stringify({va,vb})}`);
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
