#!/usr/bin/env node
'use strict';

// MISREGISTER's game-owned eval helpers deliberately keep exact state-machine
// fixtures beside the mechanics they exercise. This suite owns the cross-run
// evidence: deterministic replay, render/FX parity, measured autoplay bands,
// paired policy comparison, acts/show budgets, manual routing, and the soak.
const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');

const FOOTER=`
globalThis.__mrNotes=[];
{const __mrNote0=SHOW.note;SHOW.note=e=>{globalThis.__mrNotes.push({kind:e.kind,id:e.id,tag:e.tag,
  landsAt:e.landsAt});return __mrNote0(e);};}
globalThis.__mrProbe=()=>__misregisterProbe();
globalThis.__mrSignature=()=>__misregisterSignature();
globalThis.__mrAdmireFixture=()=>{
  const old=pres;pres={cue:{id:'fixture-apex',tier:3},t:8,holdWorld:false,physicsEvery:3,admire:true};
  delete globalThis.__NO_ADMIRE;const admired=rawBotIntent();globalThis.__NO_ADMIRE=1;
  const gated=rawBotIntent();delete globalThis.__NO_ADMIRE;pres=old;
  return{admired:admired.tactic,gated:gated.tactic};
};

// Runtime scenario drivers live only in the injected eval scope. Wrappers make
// the proof depend on calls to the shipping mechanics instead of duplicate
// fixture logic or a self-attested flag.
globalThis.__mrRuntimeCalls={begin:0,apply:0,land:0,chute:0,entities:0,landLog:[]};
{const oldBegin=beginTransfer,oldApply=applyIntent,oldLand=landTransfer,oldChute=startChute,oldEntities=stepEntities;
beginTransfer=function(...args){__mrRuntimeCalls.begin++;return oldBegin(...args);};
applyIntent=function(...args){__mrRuntimeCalls.apply++;return oldApply(...args);};
landTransfer=function(...args){const entry={runFrame,transferT:P.transferT,phase:P.phase,hit:P.transferHit,vx:P.vx};
  __mrRuntimeCalls.land++;const out=oldLand(...args);entry.after=P.phase;entry.tumble=P.tumble;__mrRuntimeCalls.landLog.push(entry);return out;};
startChute=function(...args){__mrRuntimeCalls.chute++;return oldChute(...args);};
stepEntities=function(...args){__mrRuntimeCalls.entities++;return oldEntities(...args);};}
const __mrDelta=before=>({begin:__mrRuntimeCalls.begin-before.begin,apply:__mrRuntimeCalls.apply-before.apply,
  land:__mrRuntimeCalls.land-before.land,chute:__mrRuntimeCalls.chute-before.chute,
  entities:__mrRuntimeCalls.entities-before.entities});
const __mrBefore=()=>({begin:__mrRuntimeCalls.begin,apply:__mrRuntimeCalls.apply,land:__mrRuntimeCalls.land,
  chute:__mrRuntimeCalls.chute,entities:__mrRuntimeCalls.entities,log:__mrRuntimeCalls.landLog.length});

globalThis.__misregisterTransferFixture=()=>{
  const before=__mrBefore(),prepare=()=>{
    runFrame=0;stats=freshStats();locks=[null,null,null];marks=[];mites=[];blades=[];surfacePhase=[0,0,0];resetActs();
    P={x:600,vx:PLANES[0].speed,plane:0,z:0,phase:'grounded',from:0,to:0,transferT:0,cooldown:0,
      stun:0,tumble:0,chuteT:0,chuteStartX:0,brace:false,riskFast:false,riskMiss:false,transferHit:false,transferMove:0};
  },tick=intent=>{runFrame++;for(let i=0;i<3;i++)surfacePhase[i]+=planeSpeed(i);applyIntent(intent);},
    intent=(targetPlane,cancelTransfer=false)=>({move:0,targetPlane,cancelTransfer,brace:false,targetMarkId:-1,tactic:'FIXTURE'});

  prepare();const cancelStarted=beginTransfer(1,0);for(let f=1;f<=10;f++)tick(intent(1));tick(intent(1,true));
  const cancelAt11={cancelled:cancelStarted&&stats.transfers.cancels===1,commits:stats.transfers.commits,phase:P.phase};

  prepare();const rejectedNonAdjacent=!beginTransfer(2,0),started=beginTransfer(1,0),zs=[],steps=[];let commitCooldown=-1,
    vxBeforeCommit=0,vxAfterCommit=0;
  for(let frame=1;frame<=48;frame++){
    const beforeX=P.x;if(frame===12)vxBeforeCommit=P.vx;tick(intent(frame>12?2:1,frame>12));
    if(frame===12){commitCooldown=P.cooldown;vxAfterCommit=P.vx;}steps.push(Math.abs(wrappedDelta(beforeX,P.x)));
    if(frame>12&&frame<48)zs.push(P.z);
  }
  const calls=__mrDelta(before),land=__mrRuntimeCalls.landLog[before.log];
  return{runtime:calls.begin>=3&&calls.apply>=59&&calls.land===1,calls,cancelAt11,
    commitAt12:{committed:started&&stats.transfers.commits===1,cancelled:stats.transfers.cancels>0,
      targetChanged:P.from!==0||P.to!==1,cooldown:commitCooldown},
    landAt48:{frame:land&&land.transferT,validated:!!land&&land.after==='grounded',phase:P.phase,z:P.z,targetPlane:P.to},
    continuous:zs.every((v,i)=>i===0||v>zs[i-1]),minIntermediateZ:Math.min(...zs),maxIntermediateZ:Math.max(...zs),
    momentumConserved:Math.abs(vxBeforeCommit)>.1&&vxBeforeCommit===vxAfterCommit&&Math.max(...steps)<4&&steps.every(Number.isFinite),
    adjacentOnly:rejectedNonAdjacent&&started};
};

globalThis.__misregisterLandingFixture=()=>{
  const before=__mrBefore(),landingFrame=1000,to=1,from=0,vx=PLANES[to].speed,
    prepare=(x,speed=vx)=>{
      runFrame=landingFrame;stats=freshStats();locks=[null,null,null];marks=[];mites=[];blades=[];surfacePhase=[0,0,0];resetActs();
      P={x,vx:speed,plane:from,z:to,phase:'transit',from,to,transferT:48,cooldown:0,stun:0,tumble:0,chuteT:0,
        chuteStartX:0,brace:false,riskFast:false,riskMiss:false,transferHit:false,transferMove:0};
    };
  let safeX=0;prepare(0);for(let x=0;x<WORLD;x++)if(landingAssessment({from,to,x,vx,landingFrame,transferHit:false}).success){safeX=x;break;}

  prepare(safeX);landTransfer();const safe={success:stats.transfers.successes===1,chute:P.phase==='chute',tumbled:P.tumble>0,footprint:14};

  prepare(seamCenter(to,landingFrame));marks=[{id:11,plane:1,x:P.x,correct:true,captured:true,pulse:0}];
  locks=[null,{at:7,expiry:landingFrame+600,commission:1},null];landTransfer();
  const startedChute=P.phase==='chute',path=[{x:P.x,z:P.z}],startFrame=runFrame;
  while(P.phase==='chute'&&runFrame-startFrame<80){runFrame++;for(let i=0;i<3;i++)surfacePhase[i]+=planeSpeed(i);
    applyIntent({move:0,targetPlane:1,cancelTransfer:false,brace:false,targetMarkId:-1,tactic:'FIXTURE'});path.push({x:P.x,z:P.z});}
  const maxJump=Math.max(...path.slice(1).map((v,i)=>Math.abs(wrappedDelta(path[i].x,v.x)))),
    miss={success:stats.transfers.successes>0,chute:startedChute,chuteFrames:runFrame-startFrame,
      visible:path.some(v=>v.z>1.5),lostNewestLock:!locks[1]&&!marks[0].captured,returnPlane:P.plane,snapped:maxJump>8};

  prepare(safeX,vx+2.8);const relativeSpeed=Math.abs(P.vx-planeSpeedAt(to,landingFrame));landTransfer();
  const fast={success:stats.transfers.successes>0,tumbled:P.tumble>0,smudged:stats.smudges===1,relativeSpeed};

  prepare(0);const grip=gripperState(runFrame);P.x=grip.x;P.z=grip.z;const wasTransit=P.phase==='transit';stepEntities();
  const hit=P.transferHit;P.x=safeX;P.vx=vx;landTransfer();
  const crossDepth={hit,duringTransfer:wasTransit,tumbled:P.tumble>0,smudged:stats.smudges===1,z:grip.z},calls=__mrDelta(before);
  return{runtime:calls.land===4&&calls.chute===1&&calls.apply===72&&calls.entities===1,calls,safe,miss,fast,crossDepth};
};

globalThis.__misregisterSurfaceFixture=()=>{
  runFrame=0;stats=freshStats();locks=[null,null,null];mites=[];blades=[];rushT=0;surfacePhase=[0,0,0];resetActs();
  marks=[{id:1,plane:1,x:30,correct:true,captured:false,pulse:0}];
  const before={mark:marks[0].x,seam:seamCenter(1),blade:bladeWorldX(1)};runFrame=1;stepSurfaces();
  const forward={mark:wrappedDelta(before.mark,marks[0].x),seam:wrappedDelta(before.seam,seamCenter(1)),
    blade:wrappedDelta(before.blade,bladeWorldX(1)),textureScreen:projectX(wrap(30+surfacePhase[1]),1),
    markScreen:projectX(marks[0].x,1)};

  surfacePhase[1]=959.9;marks[0].x=959.9;const wrapBefore={mark:marks[0].x,seam:seamCenter(1),blade:bladeWorldX(1)};
  runFrame=2;stepSurfaces();const acrossWrap={mark:wrappedDelta(wrapBefore.mark,marks[0].x),
    seam:wrappedDelta(wrapBefore.seam,seamCenter(1)),blade:wrappedDelta(wrapBefore.blade,bladeWorldX(1))};

  surfacePhase[1]=20;marks[0].x=50;jam.plane=1;jam.landAt=3;jam.phase='warn';
  const reverseBefore={mark:marks[0].x,seam:seamCenter(1),blade:bladeWorldX(1)};runFrame=3;stepSurfaces();
  const reverse={mark:wrappedDelta(reverseBefore.mark,marks[0].x),seam:wrappedDelta(reverseBefore.seam,seamCenter(1)),
    blade:wrappedDelta(reverseBefore.blade,bladeWorldX(1)),landingSpeed:planeSpeedAt(1,3)};
  return{forward,acrossWrap,reverse};
};
`;

let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const pct=(part,total)=>total?part/total:0;
const entropy=frames=>{
  const total=frames.reduce((sum,n)=>sum+n,0);if(!total)return 0;
  return-frames.reduce((sum,n)=>{const p=n/total;return p?sum+p*Math.log(p):sum;},0)/Math.log(3);
};
const nearly=(a,b,epsilon=1e-9)=>Math.abs(a-b)<=epsilon;

console.log('1) wrapped projection: every plane round-trips across both press seams');
{
  const game=bootGame('misregister',{seed:0x6d7201,footer:FOOTER});
  const p=game.sandbox.__misregisterProjectionFixture();
  console.log(`  ${p.samples} samples, max world error ${p.maxWorldError}, max screen error ${p.maxScreenError}`);
  if(p.samples<18||p.maxWorldError>1e-9||p.maxScreenError>1e-9||!p.allPlanes||!p.crossedWrap)
    fail(`projection/unprojection contract regressed: ${JSON.stringify(p)}`);
}

console.log('2) transfer state machine: frame-11 cancel, frame-12 commit, frame-48 validation');
{
  const game=bootGame('misregister',{seed:0x6d7202,footer:FOOTER});
  const t=game.sandbox.__misregisterTransferFixture();
  console.log(`  cancel ${t.cancelAt11&&t.cancelAt11.phase}; commit ${t.commitAt12&&t.commitAt12.committed}; `+
    `land ${t.landAt48&&t.landAt48.frame}f, cooldown ${t.commitAt12&&t.commitAt12.cooldown}`);
  if(!t.runtime)fail('transfer fixture did not exercise the runtime state machine');
  if(!t.cancelAt11||!t.cancelAt11.cancelled||t.cancelAt11.commits!==0||t.cancelAt11.phase!=='grounded')
    fail(`transfer did not cancel cleanly at frame 11: ${JSON.stringify(t.cancelAt11)}`);
  if(!t.commitAt12||!t.commitAt12.committed||t.commitAt12.cancelled||t.commitAt12.targetChanged||
      t.commitAt12.cooldown!==72)
    fail(`transfer commit did not become immutable at frame 12: ${JSON.stringify(t.commitAt12)}`);
  if(!t.landAt48||t.landAt48.frame!==48||!t.landAt48.validated||t.landAt48.phase!=='grounded'||
      !nearly(t.landAt48.z,t.landAt48.targetPlane))
    fail(`transfer did not validate on frame 48: ${JSON.stringify(t.landAt48)}`);
  if(!t.continuous||t.minIntermediateZ<=0||t.maxIntermediateZ>=2||!t.momentumConserved||!t.adjacentOnly)
    fail(`depth travel stopped being continuous/adjacent or lost momentum: ${JSON.stringify(t)}`);
}

console.log('3) transfer outcomes: safe footprint, miss chute, excess-speed tumble, cross-depth strike');
{
  const game=bootGame('misregister',{seed:0x6d7203,footer:FOOTER});
  const x=game.sandbox.__misregisterLandingFixture();
  console.log(`  safe ${x.safe&&x.safe.success?'landed':'failed'}, miss ${x.miss&&x.miss.chuteFrames}f chute, `+
    `fast ${x.fast&&x.fast.tumbled?'tumble':'accepted'}, depth hit ${x.crossDepth&&x.crossDepth.hit}`);
  if(!x.runtime)fail('landing fixture did not exercise runtime transfer/chute functions');
  if(!x.safe||!x.safe.success||x.safe.chute||x.safe.tumbled)
    fail(`safe 14-unit footprint did not land: ${JSON.stringify(x.safe)}`);
  if(!x.miss||!x.miss.chute||x.miss.chuteFrames!==72||!x.miss.visible||!x.miss.lostNewestLock||
      x.miss.returnPlane!==1||x.miss.snapped)
    fail(`missing footprint did not pay the visible chute cost: ${JSON.stringify(x.miss)}`);
  if(!x.fast||!x.fast.tumbled||!x.fast.smudged||x.fast.relativeSpeed<=2.4)
    fail(`excess relative speed did not tumble/smudge: ${JSON.stringify(x.fast)}`);
  if(!x.crossDepth||!x.crossDepth.hit||!x.crossDepth.duringTransfer||!x.crossDepth.tumbled||!x.crossDepth.smudged)
    fail(`cross-depth hazard did not carry through a real landing outcome: ${JSON.stringify(x.crossDepth)}`);
}

console.log('4) plane physics: the same intent produces three materially different surfaces');
{
  const game=bootGame('misregister',{seed:0x6d7204,footer:FOOTER});
  const p=game.sandbox.__misregisterPhysicsFixture(),s=game.sandbox.__misregisterSurfaceFixture(),a=p.acceleration,b=p.braking,
    coast=p.coast,rebound=p.rebound,top=p.topSpeed,collision=p.collision;
  console.log(`  accel ${a.map(n=>n.toFixed(3)).join('/')}, brake ${b.map(n=>n.toFixed(3)).join('/')}, `+
    `coast ${coast.map(n=>n.toFixed(3)).join('/')}, collision ${collision.map(n=>n.toFixed(3)).join('/')}`);
  if(!(a[0]<a[1]&&a[1]<a[2]))fail(`plane acceleration ordering regressed: ${a}`);
  if(!(b[0]<b[1]&&b[1]<b[2]))fail(`plane braking ordering regressed: ${b}`);
  if(!(coast[0]>coast[1]&&coast[1]>coast[2]))fail(`yellow no longer coasts longest: ${coast}`);
  if(!(rebound[1]>rebound[0]&&rebound[1]>rebound[2])||
      !(Math.abs(collision[1])>Math.abs(collision[0])&&Math.abs(collision[1])>Math.abs(collision[2])))
    fail(`cyan no longer produces the strongest runtime rebound: ${JSON.stringify({rebound,collision})}`);
  if(!(top[0]>top[1]&&top[1]>top[2])||!p.collisionDistinct||!p.finite)
    fail(`surface velocity/collision identities collapsed: ${JSON.stringify(p)}`);
  if(!(s.forward.mark>0&&nearly(s.forward.mark,s.forward.seam)&&nearly(s.forward.blade,s.forward.mark*1.7)&&
      nearly(s.forward.textureScreen,s.forward.markScreen)))
    fail(`forward surface texture/seam/hazards lost one physical phase: ${JSON.stringify(s.forward)}`);
  if(!(s.acrossWrap.mark>0&&nearly(s.acrossWrap.mark,s.acrossWrap.seam)&&
      nearly(s.acrossWrap.blade,s.acrossWrap.mark*1.7)))
    fail(`surface phase wrapped with a visible/collision teleport: ${JSON.stringify(s.acrossWrap)}`);
  if(!(s.reverse.mark<0&&nearly(s.reverse.mark,s.reverse.seam)&&nearly(s.reverse.blade,s.reverse.mark*1.7)&&
      nearly(s.reverse.landingSpeed,s.reverse.mark)))
    fail(`paper-jam reversal split visual and collision motion: ${JSON.stringify(s.reverse)}`);
}

console.log('5) commissions + planner: generated continuations are reachable and copied lookahead is pure');
{
  const game=bootGame('misregister',{seed:0x6d7205,footer:FOOTER});
  const c=game.sandbox.__misregisterCommissionFixture(240),p=game.sandbox.__misregisterPlannerFixture();
  console.log(`  ${c.count} commissions, ${c.unreachable} unreachable; planner ${p.steps} copied steps, `+
    `repeat ${p.repeat}, pure ${p.pure}`);
  if(c.count<200||c.unreachable!==0||!c.allThreePlanes||!c.withinCaps||!c.finite)
    fail(`commission generation lost a reachable continuation: ${JSON.stringify(c)}`);
  if(!p.repeat||!p.pure||!p.finite||p.steps<360||p.horizon!==360||p.engineRngChanged)
    fail(`register lookahead mutated runtime/RNG state or lost its horizon: ${JSON.stringify(p)}`);
}

console.log('6) controller parity: two-step Enter gate and human intent uses common physics');
{
  const game=bootGame('misregister',{seed:0x6d7206,footer:FOOTER});
  const initial=game.sandbox.__mrProbe();press(game,'Enter');const instructions=game.sandbox.__mrProbe();
  press(game,'Enter');const started=game.sandbox.__mrProbe();
  game.key('keydown','ArrowRight');game.frames(30,false);game.key('keyup','ArrowRight');
  const moved=game.sandbox.__mrProbe();
  const parity=game.sandbox.__misregisterManualFixture();
  console.log(`  playing ${initial.playing}/${instructions.playing}/${started.playing}; `+
    `manual dx ${(moved.actor.x-started.actor.x).toFixed(2)}, intent ${JSON.stringify(parity.intent)}`);
  if(initial.playing||instructions.playing||!started.playing)fail('two-step Enter session gate regressed');
  if(Math.abs(moved.actor.x-started.actor.x)<2)fail('manual Right did not move through surface physics');
  if(!parity.sameShape||!parity.samePhysicsPath||!parity.upTargetsAdjacent||!parity.downTargetsAdjacent||
      !parity.braceMapped||!parity.finite)
    fail(`manual/bot controller contract diverged: ${JSON.stringify(parity)}`);
}

console.log('7) deterministic replay: per-second signatures match for ten minutes');
{
  const seed=0x6d7301,a=bootGame('misregister',{seed,footer:FOOTER}),
    b=bootGame('misregister',{seed,footer:FOOTER});let mismatch=-1;
  for(let second=1;second<=600;second++){
    a.frames(60,false);b.frames(60,false);
    if(mismatch<0&&a.sandbox.__mrSignature()!==b.sandbox.__mrSignature())mismatch=second;
  }
  const p=a.sandbox.__mrProbe();
  console.log(`  signatures ${mismatch<0?'match':'diverge at '+mismatch+'s'}; ${p.posters} posters, `+
    `${p.transfers.commits} committed transfers`);
  if(mismatch>=0)fail(`same-seed replay first diverged at ${mismatch}s`);
  if(!p.finite)fail('ten-minute deterministic replay ended non-finite');
}

console.log('8) render isolation: headless and rendered stepping end at the same simulation state');
{
  const seed=0x6d7302,a=bootGame('misregister',{seed,footer:FOOTER}),
    b=bootGame('misregister',{seed,footer:FOOTER});
  a.frames(7200,false);const render=b.frames(7200,true),same=a.sandbox.__mrSignature()===b.sandbox.__mrSignature();
  console.log(`  signatures ${same?'identical':'DIFFER'} after 2 minutes; ${render.calls} canvas calls`);
  if(!same)fail('render traversal consumed simulation RNG or mutated simulation state');
  if(render.calls<1000)fail('rendered stepping did not materially draw the three-plane press');
}

console.log('9) payoff FX: __NO_PAYOFF_FX is a 36,000-frame simulation no-op');
{
  const seed=0x6d7303,a=bootGame('misregister',{seed,footer:FOOTER}),
    b=bootGame('misregister',{seed,footer:FOOTER});b.sandbox.__NO_PAYOFF_FX=1;
  a.frames(36000,false);b.frames(36000,false);const same=a.sandbox.__mrSignature()===b.sandbox.__mrSignature();
  console.log(`  signatures ${same?'identical':'DIFFER'} after ten minutes and ${a.sandbox.__mrProbe().posters} posters`);
  if(!same)fail('__NO_PAYOFF_FX changed actor, surfaces, entities, acts, locks, or progression');
}

console.log('10) acts: exact warnings and the bot first responds before each landfall');
for(const spec of[{kind:'paper-jam',warning:240},{kind:'solvent-wash',warning:210}]){
  const seed=spec.kind==='paper-jam'?0x6d7401:0x6d7402,
    a=bootGame('misregister',{seed,footer:FOOTER}),b=bootGame('misregister',{seed,footer:FOOTER});
  a.sandbox.__misregisterActSetup(spec.kind,600);b.sandbox.__misregisterActSetup(spec.kind,600);
  b.sandbox.__NO_ACTS=1;let firstIntent=-1,intentPhase='',firstMotion=-1,motionPhase='',tactic='',response=false;
  for(let f=1;f<=1800;f++){
    a.frames(1,false);b.frames(1,false);const sa=a.sandbox.__misregisterActState(),sb=b.sandbox.__misregisterActState();
    response=response||!!sa.warningResponse;
    if(firstIntent<0&&sa.physicalIntentSignature!==sb.physicalIntentSignature){firstIntent=f;intentPhase=sa.phase;tactic=sa.tactic;}
    if(firstMotion<0&&sa.motionSignature!==sb.motionSignature){firstMotion=f;motionPhase=sa.phase;}
  }
  const notes=a.sandbox.__mrNotes.filter(e=>e.id===spec.kind),warn=notes.find(e=>e.kind==='act-warning'),
    land=notes.find(e=>e.kind==='act-land'),lead=warn&&land?land.tag-warn.tag:-1;
  console.log(`  ${spec.kind}: ${lead}f warning, intent/motion diverge ${firstIntent}f/${firstMotion}f in ${intentPhase}/${motionPhase}, tactic ${tactic}`);
  if(!warn||!land||lead!==spec.warning)fail(`${spec.kind}: warning/land note pair was ${lead}f, expected ${spec.warning}`);
  if(firstIntent<0||intentPhase!=='warn'||firstIntent>=600+spec.warning||
      firstMotion<0||motionPhase!=='warn'||firstMotion>=600+spec.warning||!response)
    fail(`${spec.kind}: bot did not physically respond during warning (${firstIntent}/${firstMotion}, ${intentPhase}/${motionPhase}, ${response})`);
}

console.log('11) payoff ladder: opportunities are ordered and apex budgets are exact after flush');
{
  const game=bootGame('misregister',{seed:0x6d7501,footer:FOOTER});game.frames(36000,false);
  const flushed=game.sandbox.__misregisterFlushShow(),p=game.sandbox.__mrProbe(),show=p.show,
    offers=show.offeredByTier,shown=show.shownByTier,s3=shown[3]||0,admire=game.sandbox.__mrAdmireFixture();
  console.log(`  offers ${JSON.stringify(offers)}, shown ${JSON.stringify(shown)}, apex ${s3}; `+
    `held ${show.heldFrames}, slowed ${show.slowedFrames}, admire ${show.admireFrames}, flush ${flushed.frames}f`);
  if(!((offers[1]||0)>(offers[2]||0)&&(offers[2]||0)>(offers[3]||0)&&(offers[3]||0)>=1))
    fail(`tier opportunities are not strictly ordered: ${JSON.stringify(offers)}`);
  if(s3<1)fail('ten-minute press run never showed a completed-poster apex');
  if(show.heldFrames!==6*s3)fail(`apex hitstop ${show.heldFrames}f != 6*${s3}`);
  if(show.slowedFrames!==18*s3)fail(`apex slow-mo ${show.slowedFrames}f != 18*${s3}`);
  if(show.admireFrames!==42*s3)fail(`bot admire ${show.admireFrames}f != 42*${s3}`);
  if(admire.admired!=='ADMIRE'||admire.gated==='ADMIRE')fail(`__NO_ADMIRE did not gate bot-only pause: ${JSON.stringify(admire)}`);
  if(!flushed.clean||flushed.escapedRunBranch)fail(`show flush escaped the live-run branch: ${JSON.stringify(flushed)}`);
}

// Re-derived 2026-07-09 from 30 diversified ten-minute shipping runs. Seeds
// use (0x6d7900 + (i+1)*0x9e3779b1) >>> 0, i=0..29, so the calibration does
// not rely on a friendly contiguous RNG neighborhood. Observed shipping
// ranges: 20..28 posters, 87..122 starts, 92.0..95.1% successful commits,
// 28.6..38.1% plane shares, 61..85 locks, 8..11 smudges, 0..1 chutes,
// 4..10 lapses, 7.8..9.0s event lull, 32.4..62.0s poster lull, and 0 hard
// interventions. The paired reactive policy extends the joint envelope to
// 18 posters, 56 starts, 91.2% success, 30.3% minimum plane share, and 55
// locks. Bounds include explicit margins; posterLull was re-derived to 70s
// after the physically honest wash response produced one measured 61.95s run.
const BANDS={posters:[17,33],transfers:[50,125],success:[.88,.97],occupancy:[.27,.42],
  locks:[55,100],smudges:[5,13],chutes:[0,2],lapses:[3,11],eventLull:540,posterLull:4200,edgeMin:20};
function checkRun(label,p){
  const dwell=p.planeDwell,totalDwell=dwell.reduce((sum,n)=>sum+n,0),occupancy=dwell.map(n=>pct(n,totalDwell)),
    success=pct(p.transfers.successes,p.transfers.commits),entities=p.entities||{},caps=p.entityCaps||{};
  if(!p.finite)fail(`${label}: non-finite tracked state`);
  if(p.posters<BANDS.posters[0]||p.posters>BANDS.posters[1])fail(`${label}: posters ${p.posters} outside ${BANDS.posters.join('..')}`);
  if(p.transfers.starts<BANDS.transfers[0]||p.transfers.starts>BANDS.transfers[1])fail(`${label}: transfers ${p.transfers.starts} outside ${BANDS.transfers.join('..')}`);
  if(success<BANDS.success[0]||success>BANDS.success[1])fail(`${label}: successful commits ${(success*100).toFixed(1)}% outside ${BANDS.success[0]*100}..${BANDS.success[1]*100}%`);
  occupancy.forEach((share,i)=>{if(share<BANDS.occupancy[0]||share>BANDS.occupancy[1])
    fail(`${label}: plane ${i} occupancy ${(share*100).toFixed(1)}% outside ${BANDS.occupancy[0]*100}..${BANDS.occupancy[1]*100}%`);});
  if(p.locks.total<BANDS.locks[0]||p.locks.total>BANDS.locks[1])fail(`${label}: locks ${p.locks.total} outside ${BANDS.locks.join('..')}`);
  if(p.smudges<BANDS.smudges[0]||p.smudges>BANDS.smudges[1])fail(`${label}: smudges ${p.smudges} outside ${BANDS.smudges.join('..')}`);
  if(p.transfers.chutes<BANDS.chutes[0]||p.transfers.chutes>BANDS.chutes[1])fail(`${label}: chutes ${p.transfers.chutes} outside ${BANDS.chutes.join('..')}`);
  if(p.lapses<BANDS.lapses[0]||p.lapses>BANDS.lapses[1])fail(`${label}: lapses ${p.lapses} outside ${BANDS.lapses.join('..')}`);
  if(p.maxEventLull>BANDS.eventLull||p.maxPosterLull>BANDS.posterLull)fail(`${label}: lulls ${(p.maxEventLull/60).toFixed(1)}s/${(p.maxPosterLull/60).toFixed(1)}s`);
  if(p.transferEdges[0]<BANDS.edgeMin||p.transferEdges[1]<BANDS.edgeMin)
    fail(`${label}: adjacent edges underused (${p.transferEdges}; floor ${BANDS.edgeMin})`);
  if(p.invisibleResets!==0)fail(`${label}: ${p.invisibleResets} invisible resets`);
  if((p.watchdogs.hard||0)!==0)fail(`${label}: ${p.watchdogs.hard} hard MAKE READY interventions`);
  for(const[name,value]of Object.entries(entities))if(!Number.isFinite(value)||value<0||value>(caps[name]??Infinity))
    fail(`${label}: entity pool ${name} ${value} exceeds cap ${caps[name]}`);
  return{occupancy,entropy:entropy(dwell),success};
}

console.log('12) isolated register lookahead A/B: 12 paired ten-minute seeds, measured watchability held');
{
  let winsOrTies=0,smartPosters=0,reactPosters=0,smartChutes=0,reactChutes=0,smartEntropy=0,reactEntropy=0;
  for(let i=0;i<12;i++){
    const seed=0x6d7600+i,a=bootGame('misregister',{seed,footer:FOOTER}),b=bootGame('misregister',{seed,footer:FOOTER});
    b.sandbox.__NO_REGISTER_LOOKAHEAD=1;a.frames(36000,false);b.frames(36000,false);
    const pa=a.sandbox.__mrProbe(),pb=b.sandbox.__mrProbe(),ma=checkRun(`seed ${seed.toString(16)} smart`,pa),
      mb=checkRun(`seed ${seed.toString(16)} reactive`,pb);
    if(pa.posters>=pb.posters)winsOrTies++;
    smartPosters+=pa.posters;reactPosters+=pb.posters;smartChutes+=pa.transfers.chutes;reactChutes+=pb.transfers.chutes;
    smartEntropy+=ma.entropy;reactEntropy+=mb.entropy;
    console.log(`  ${seed.toString(16)}: smart ${pa.posters}p/${pa.transfers.chutes}c/H${ma.entropy.toFixed(3)} `+
      `vs reactive ${pb.posters}p/${pb.transfers.chutes}c/H${mb.entropy.toFixed(3)}`);
    if(pa.planSims<=0||pb.planSims!==0)fail(`seed ${seed.toString(16)}: lookahead ablation was not real (${pa.planSims}/${pb.planSims})`);
  }
  const gain=pct(smartPosters-reactPosters,reactPosters),meanSmart=smartEntropy/12,meanReact=reactEntropy/12;
  console.log(`  total: ${winsOrTies}/12 wins-or-ties, posters ${smartPosters} vs ${reactPosters} (+${(gain*100).toFixed(1)}%), `+
    `chutes ${smartChutes}/${reactChutes}, entropy ${meanSmart.toFixed(3)}/${meanReact.toFixed(3)}`);
  if(winsOrTies<10)fail(`lookahead won/tied only ${winsOrTies}/12 seeds`);
  if(gain<.08)fail(`pooled poster gain ${(gain*100).toFixed(1)}% is below 8%`);
  // Chutes are a watchability band, not an intelligence objective; each paired
  // run is already held to the same 0..2 contract by checkRun above.
  if(meanSmart<.99||meanReact<.99)fail(`a policy lost balanced plane occupancy (${meanSmart} vs ${meanReact})`);
}

console.log('13) ten-minute soak: actor moves, press acts, posters progress, every plane/edge used');
{
  const SOAK_FOOTER=FOOTER+`
globalThis.__soakProbe=()=>{const p=__misregisterProbe();return{
  sig:[Math.round(p.actor.x*10),Math.round(p.actor.z*100),Math.round(p.actor.vx*100)].join('|'),
  events:p.events,progress:p.locks.total+p.posters*3,finite:p.finite};};`;
  const{game,samples}=runSoak('misregister',{seed:0x6d7701,footer:SOAK_FOOTER,minutes:10}),
    report=analyzeSoak(samples),p=game.sandbox.__mrProbe(),m=checkRun('soak',p);
  console.log(`  ${soakLine(report)}; planes ${m.occupancy.map(n=>(n*100).toFixed(1)+'%').join('/')}, `+
    `edges ${p.transferEdges}, posters ${p.posters}, watchdogs ${JSON.stringify(p.watchdogs)}`);
  assertSoak('soak',report,{still:12,quiet:12,stall:55,minEvents:45,minProgress:40},fail);
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
