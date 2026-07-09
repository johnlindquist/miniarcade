#!/usr/bin/env node
'use strict';
const{bootGame}=require('./harness');

const FOOTER=`
globalThis.__ddRouteLog={clears:0,wipeouts:0,shorts:0,finishes:[]};
const __ddFinish0=finishRoute;
finishRoute=reason=>{
  if(state==='route'){
    const kind=reason==='WIPEOUT'?'wipeout':delivered>=QUOTA?'clear':'short';
    globalThis.__ddRouteLog[kind==='clear'?'clears':kind==='wipeout'?'wipeouts':'shorts']++;
    globalThis.__ddRouteLog.finishes.push({kind,delivered,routeFrame});
  }
  return __ddFinish0(reason);
};
let __ddLandedTricks=0;
const __ddUpdatePlayer0=updatePlayer;
updatePlayer=intent=>{
  const beforeTrick=P.trick,beforeAir=P.airT;
  const out=__ddUpdatePlayer0(intent);
  if(beforeTrick&&beforeAir===1&&P.airT===0&&P.bailT===0&&!P.trick)__ddLandedTricks++;
  return out;
};
const __ddFinite=o=>Object.values(o).filter(v=>typeof v==='number').every(Number.isFinite);
const __ddAllFinite=()=>[
  {frame,stateT,routeFrame,routeNo,distance,speed,lives,papers,delivered,offered,missed,
    routeScore,comboPoints,comboCount,comboT,press,frontPage,lastProgressFrame},P,stats,
  ...houses,...obstacles,...rails,...ramps,...bundles,...flyers
].every(__ddFinite);
globalThis.__ddProbe=()=>({
  frame,state,stateT,routeFrame,routeNo,distance,speed,lives,papers,delivered,offered,missed,
  routeScore,comboPoints,comboCount,comboT,comboLabel,press,frontPage,
  ...stats,landedTricks:__ddLandedTricks,hybridMail:stats.airMail+stats.railMail,
  lapses:globalThis.__ddLapses,
  routeLog:{clears:globalThis.__ddRouteLog.clears,wipeouts:globalThis.__ddRouteLog.wipeouts,
    shorts:globalThis.__ddRouteLog.shorts,finishes:globalThis.__ddRouteLog.finishes.map(o=>({...o}))},
  rider:{...P},playing:playing(),finite:__ddAllFinite()
});
const __ddNeutral=()=>({steer:0,throttle:0,jump:false,throw:false,throwSide:0,trick:false,grind:false});
globalThis.__ddLapses=0;
{const __d0=courierSkill.decide;let __was=false;
 courierSkill.decide=(f,c,d,l)=>{const out=__d0(f,c,d,l);
   const now=courierSkill.isLapsed(f);if(now&&!__was)globalThis.__ddLapses++;__was=now;return out;};}

globalThis.__ddDeliveryFixture=()=>{
  resetRoute();houses=[];obstacles=[];rails=[];ramps=[];bundles=[];flyers=[];
  papers=5;routeScore=0;frontPage=0;resetCombo();
  stats.deliveries=0;stats.throws=0;stats.airMail=0;stats.railMail=0;
  Object.assign(P,{x:80,airT:0,airMax:0,grindId:0,bailT:0,throwCd:0});
  const h=makeHouse(200,-1);h.premium=false;houses=[h];
  const launched=throwPaper(-1);
  const flightFrames=flyers[0]&&flyers[0].life;
  for(let i=0;i<flightFrames;i++)updateFlyers();
  const once={delivered,stat:stats.deliveries,throws:stats.throws,papers,routeScore,
    comboPoints,comboCount,label:comboLabel,house:h.delivered,flyers:flyers.length};
  for(let i=0;i<20;i++)updateFlyers();deliver(h);
  const twice={delivered,stat:stats.deliveries,throws:stats.throws,papers,routeScore,
    comboPoints,comboCount,label:comboLabel,house:h.delivered,flyers:flyers.length};
  return{launched,flightFrames,once,twice,finite:__ddAllFinite()};
};

globalThis.__ddTrickBankFixture=()=>{
  resetRoute();houses=[];obstacles=[];rails=[];ramps=[];bundles=[];flyers=[];
  routeScore=0;frontPage=0;resetCombo();stats.tricks=0;stats.bestCombo=0;stats.bestMult=0;
  Object.assign(P,{x:80,airT:0,airMax:0,grindId:0,bailT:0,inv:0});
  const launched=launchOllie(false),tricked=trickNow(1);
  const line={points:comboPoints,count:comboCount,label:comboLabel,tricks:stats.tricks};
  for(let i=0;i<40;i++)updatePlayer(__ddNeutral());
  const landed={airT:P.airT,trick:P.trick,trickAge:P.trickAge,bailT:P.bailT};
  for(let i=0;i<53;i++)updateCombo();
  const beforeBank={routeScore,points:comboPoints,count:comboCount,timer:comboT};
  updateCombo();const banked=routeScore;
  return{launched,tricked,line,landed,beforeBank,banked,routeScore,bestCombo:stats.bestCombo,
    after:{points:comboPoints,count:comboCount,timer:comboT},finite:__ddAllFinite()};
};

globalThis.__ddGrindFixture=()=>{
  resetRoute();houses=[];obstacles=[];rails=[];ramps=[];bundles=[];flyers=[];
  routeScore=0;frontPage=0;resetCombo();stats.grinds=0;
  const rail={id:9001,x:55,y:PY-12,len:80,side:-1};rails=[rail];
  Object.assign(P,{x:55,airT:18,airMax:40,h:8,grindId:0,bailT:0,inv:0});
  const captured=captureRail(rail);P.balance=0;P.balanceV=0;
  const start={id:P.grindId,frames:P.grindFrames,points:comboPoints,count:comboCount,grinds:stats.grinds};
  for(let i=0;i<24;i++)updatePlayer(__ddNeutral());
  const held={id:P.grindId,frames:P.grindFrames,points:comboPoints,count:comboCount,balance:P.balance};
  releaseGrind();const released={id:P.grindId,airT:P.airT,airMax:P.airMax};
  const banked=bankCombo();
  return{captured,start,held,released,banked,routeScore,finite:__ddAllFinite()};
};

globalThis.__ddBailFixture=()=>{
  resetRoute();houses=[];obstacles=[];rails=[];ramps=[];bundles=[];flyers=[];
  resetCombo();stats.crashes=0;
  addLine('TEST OLLIE',40,'fixture-ollie');addLine('TEST MAIL',60,'fixture-mail');
  const before={points:comboPoints,count:comboCount,lives};
  const bailed=bail('TEST BAIL');
  const lost={points:comboPoints,count:comboCount,timer:comboT,lives,bailT:P.bailT,crashes:stats.crashes};
  for(let i=0;i<91;i++)updatePlayer(__ddNeutral());
  const beforeRecovery={x:P.x,bailT:P.bailT,inv:P.inv};
  updatePlayer(__ddNeutral());
  const recovered={x:P.x,bailT:P.bailT,inv:P.inv,trick:P.trick};
  const canRide=launchOllie(false);
  return{before,bailed,lost,beforeRecovery,recovered,canRide,airT:P.airT,finite:__ddAllFinite()};
};

globalThis.__ddMovementFixture=()=>{
  resetRoute();houses=[];obstacles=[];rails=[];ramps=[];bundles=[];flyers=[];
  Object.assign(P,{x:80,vx:0,airT:0,airMax:0,h:0,grindId:0,bailT:0,inv:0});speed=CRUISE_SPEED;
  const start=speed,push={...__ddNeutral(),throttle:1},brake={...__ddNeutral(),throttle:-1};
  for(let i=0;i<90;i++)updateSpeed(push);const boosted=speed;
  for(let i=0;i<25;i++)updateSpeed(brake);const braked=speed;
  speed=3;P.x=80;P.vx=0;const middle=boardHeading();
  const rightIntent={...__ddNeutral(),steer:1};for(let i=0;i<120;i++)updatePlayer(rightIntent);
  const right={x:P.x,heading:boardHeading()};
  const leftIntent={...__ddNeutral(),steer:-1};for(let i=0;i<240;i++)updatePlayer(leftIntent);
  const left={x:P.x,heading:boardHeading()};
  P.x=80;P.vx=2;const angle=boardHeading(),axis={x:Math.sin(angle),y:-Math.cos(angle)},
    mag=Math.hypot(P.vx,speed),dot=(axis.x*P.vx+axis.y*-speed)/mag;
  return{start,boosted,braked,middle,right,left,span:right.x-left.x,dot,finite:__ddAllFinite()};
};

globalThis.__ddRampFixture=()=>{
  resetRoute();houses=[];obstacles=[];rails=[];ramps=[];bundles=[];flyers=[];resetCombo();stats.ramps=0;
  Object.assign(P,{x:80,vx:0,airT:0,airMax:0,h:0,grindId:0,bailT:0,inv:0,rampAir:0});
  speed=4;launchOllie(false);const normalMax=P.airMax;let normalPeak=0;
  while(P.airT>0){updatePlayer(__ddNeutral());normalPeak=Math.max(normalPeak,P.h);}
  resetCombo();Object.assign(P,{x:80,vx:0,airT:0,airMax:0,h:0,grindId:0,bailT:0,inv:0,rampAir:0});
  speed=4;const ramp={id:9002,x:80,y:PY,w:20,power:1.1,used:false};ramps=[ramp];streetCollisions();
  const rampMax=P.airMax,takeoffSpeed=speed;let rampPeak=0;
  while(P.airT>0){updatePlayer(__ddNeutral());rampPeak=Math.max(rampPeak,P.h);}
  return{used:ramp.used,ramps:stats.ramps,normalMax,normalPeak,rampMax,rampPeak,takeoffSpeed,
    landed:P.airT===0&&P.rampAir===0,landT:P.landT,finite:__ddAllFinite()};
};

globalThis.__ddVisualState=mode=>{
  resetRoute();houses=[];obstacles=[];rails=[];ramps=[];bundles=[];flyers=[];texts=[];
  Object.assign(P,{x:80,vx:0,h:0,airT:0,airMax:0,grindId:0,bailT:0,inv:0,rampAir:0,landT:0});
  speed=CRUISE_SPEED;
  if(mode==='fast')speed=MAX_SPEED;
  else if(mode==='air'){speed=4.2;Object.assign(P,{airT:34,airMax:68,rampAir:1,launchSpeed:4.2});P.h=riderHeight();}
  else if(mode==='grind'){
    const rail={id:9003,x:80,y:PY-30,len:90,side:1};rails=[rail];P.x=80;P.grindId=rail.id;P.h=7;
  }
  return{speed,h:P.h,heading:boardHeading()};
};`;

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};

console.log('1) autonomous newspaper lines: 3 x 5 simulated minutes');
let autonomousClears=0,autonomousLapses=0;
for(let run=1;run<=3;run++){
  const seed=0xdead102+run;
  const game=bootGame('deadline-deck',{seed,footer:FOOTER});
  game.frames(18000,false);const p=game.sandbox.__ddProbe();
  console.log(`  run ${run} seed ${seed}: ${p.routes} routes (${p.routeLog.clears} clear), `+
    `${p.deliveries} deliveries, ${p.landedTricks}/${p.tricks} landed tricks, ${p.grinds} grinds, `+
    `${p.airMail}+${p.railMail} hybrid mail, ${p.ramps} ramps, top ${p.topSpeed.toFixed(2)}, `+
    `combo ${p.bestCombo}, ${p.crashes} crashes, ${p.lapses} lapses, `+
    `stall ${(p.maxStall/60).toFixed(1)}s`);
  if(!p.finite)fail(`run ${run}: non-finite route, rider, or entity state`);
  autonomousClears+=p.clears;
  autonomousLapses+=p.lapses;
  if(p.lapses>12)fail(`run ${run}: ${p.lapses} lapses in 5 min — courier is zoning out constantly`);
  if(p.routes<3||p.routes>6)fail(`run ${run}: ${p.routes} completed routes outside band 3..6`);
  if(p.deliveries<120)fail(`run ${run}: only ${p.deliveries} successful deliveries`);
  if(p.tricks<85||p.landedTricks<60)fail(`run ${run}: weak trick line (${p.landedTricks}/${p.tricks} landed)`);
  if(p.grinds<50)fail(`run ${run}: only ${p.grinds} rail grinds`);
  if(p.ramps<80||p.topSpeed<4.65||p.topSpeed>4.81)fail(`run ${run}: ramp/speed loop weak (${p.ramps} ramps, ${p.topSpeed.toFixed(2)} speed)`);
  if(p.airMail<40||p.railMail<30)fail(`run ${run}: hybrid mail weak (${p.airMail} air, ${p.railMail} rail)`);
  if(p.bestMult<8||p.bestCombo<25000)fail(`run ${run}: best line only x${p.bestMult} / ${p.bestCombo}`);
  if(p.crashes>8)fail(`run ${run}: ${p.crashes} crashes exceed the watchable limit 8`);
  if(p.maxStall>480)fail(`run ${run}: progress stalled ${(p.maxStall/60).toFixed(1)}s (limit 8s)`);
}
if(autonomousClears<6)fail(`autonomous routes cleared quota only ${autonomousClears}/9 times`);
// Human-like imperfection is the watchability mechanism; a lapseChance
// regression to zero must fail loudly, not pass as "extra competent".
if(autonomousLapses<3)fail(`skill-profile lapses fired only ${autonomousLapses}x across 15 minutes — courier is robotically perfect`);

console.log('2) exact delivery: one paper, one doorstep, no double score');
let game=bootGame('deadline-deck',{seed:0xdead201,footer:FOOTER});
const delivery=game.sandbox.__ddDeliveryFixture();
console.log(`  launched ${delivery.launched}; papers ${delivery.once.papers}; `+
  `${delivery.once.comboPoints} line points; deliveries ${delivery.once.delivered}`);
if(!delivery.launched||delivery.flightFrames!==14||!delivery.once.house||delivery.once.delivered!==1||delivery.once.stat!==1||
  delivery.once.throws!==1||delivery.once.papers!==4||delivery.once.flyers!==0)
  fail(`delivery flight contract regressed: ${JSON.stringify(delivery.once)}`);
if(delivery.once.routeScore!==0||delivery.once.comboPoints!==220||delivery.once.comboCount!==1||delivery.once.label!=='DOORSTEP')
  fail(`doorstep line value regressed: ${JSON.stringify(delivery.once)}`);
if(JSON.stringify(delivery.once)!==JSON.stringify(delivery.twice))fail('delivered house scored more than once');
if(!delivery.finite)fail('delivery fixture produced non-finite state');

console.log('3) trick line: ollie + shove-it lands clean and banks exactly');
game=bootGame('deadline-deck',{seed:0xdead202,footer:FOOTER});
const trick=game.sandbox.__ddTrickBankFixture();
console.log(`  line ${trick.line.points} x${trick.line.count}; bank ${trick.banked}; `+
  `landed ${trick.landed.bailT===0?'clean':'bailed'}`);
if(!trick.launched||!trick.tricked||trick.line.points!==135||trick.line.count!==2||
  trick.line.label!=='SHOVE-IT'||trick.line.tricks!==1)fail(`trick line setup regressed: ${JSON.stringify(trick.line)}`);
if(trick.landed.airT!==0||trick.landed.trick!==''||trick.landed.trickAge!==0||trick.landed.bailT!==0)
  fail(`trick did not land cleanly: ${JSON.stringify(trick.landed)}`);
if(trick.beforeBank.routeScore!==0||trick.beforeBank.points!==135||trick.beforeBank.count!==2||trick.beforeBank.timer!==1)
  fail(`combo banked before its exact timeout: ${JSON.stringify(trick.beforeBank)}`);
if(trick.banked!==270||trick.routeScore!==270||trick.bestCombo!==270||
  trick.after.points!==0||trick.after.count!==0||trick.after.timer!==0)
  fail(`trick bank contract regressed: ${JSON.stringify(trick)}`);
if(!trick.finite)fail('trick fixture produced non-finite state');

console.log('4) grind line: capture, 24-frame bonus, release, bank');
game=bootGame('deadline-deck',{seed:0xdead203,footer:FOOTER});
const grind=game.sandbox.__ddGrindFixture();
console.log(`  rail ${grind.start.id}; ${grind.held.frames} frames; ${grind.held.points} points; bank ${grind.banked}`);
if(!grind.captured||grind.start.id!==9001||grind.start.frames!==0||grind.start.points!==80||
  grind.start.count!==1||grind.start.grinds!==1)fail(`rail capture regressed: ${JSON.stringify(grind.start)}`);
if(grind.held.id!==9001||grind.held.frames!==24||grind.held.points!==100||
  grind.held.count!==1||grind.held.balance!==0)fail(`grind hold bonus regressed: ${JSON.stringify(grind.held)}`);
if(grind.released.id!==0||grind.released.airT!==22||grind.released.airMax!==22||
  grind.banked!==100||grind.routeScore!==100)fail(`grind release/bank regressed: ${JSON.stringify(grind)}`);
if(!grind.finite)fail('grind fixture produced non-finite state');

console.log('5) combo loss + recovery: bail clears line and rider returns');
game=bootGame('deadline-deck',{seed:0xdead204,footer:FOOTER});
const bail=game.sandbox.__ddBailFixture();
console.log(`  lost ${bail.before.points} x${bail.before.count}; lives ${bail.before.lives}->${bail.lost.lives}; `+
  `recovered at x${bail.recovered.x}`);
if(bail.before.points!==100||bail.before.count!==2||!bail.bailed||bail.lost.points!==0||
  bail.lost.count!==0||bail.lost.timer!==0||bail.lost.lives!==2||bail.lost.bailT!==92||bail.lost.crashes!==1)
  fail(`bail did not clear the active line exactly: ${JSON.stringify(bail)}`);
if(bail.beforeRecovery.bailT!==1||bail.beforeRecovery.inv!==0)
  fail(`bail recovery completed before frame 92: ${JSON.stringify(bail.beforeRecovery)}`);
if(bail.recovered.x!==80||bail.recovered.bailT!==0||bail.recovered.inv!==75||bail.recovered.trick!==''||
  !bail.canRide||bail.airT!==40)fail(`rider did not recover cleanly: ${JSON.stringify(bail.recovered)}`);
if(!bail.finite)fail('bail fixture produced non-finite state');

console.log('6) movement: push, brake, full-width carve, board follows travel');
game=bootGame('deadline-deck',{seed:0xdead205,footer:FOOTER});
const movement=game.sandbox.__ddMovementFixture();
console.log(`  speed ${movement.start.toFixed(2)} -> ${movement.boosted.toFixed(2)} -> ${movement.braked.toFixed(2)}; `+
  `carve ${movement.left.x.toFixed(1)}..${movement.right.x.toFixed(1)}; heading ${movement.left.heading.toFixed(2)} / ${movement.middle.toFixed(2)} / ${movement.right.heading.toFixed(2)}`);
if(movement.boosted-movement.start<1.4||movement.boosted>4.81)
  fail(`push did not build substantial capped speed: ${JSON.stringify(movement)}`);
if(movement.boosted-movement.braked<1.15)fail(`brake did not scrub speed: ${JSON.stringify(movement)}`);
if(movement.left.x>30.1||movement.right.x<129.9||movement.span<99.5)
  fail(`carve did not span the widened route: ${JSON.stringify(movement)}`);
if(Math.abs(movement.middle)>.001||movement.left.heading>=-.35||movement.right.heading<=.35||movement.dot<.995)
  fail(`board heading does not follow travel: ${JSON.stringify(movement)}`);
if(!movement.finite)fail('movement fixture produced non-finite state');

console.log('7) ramp aerial: wider ramp produces a higher, longer, faster launch');
game=bootGame('deadline-deck',{seed:0xdead206,footer:FOOTER});
const ramp=game.sandbox.__ddRampFixture();
console.log(`  ollie ${ramp.normalMax}f / ${ramp.normalPeak.toFixed(1)}px; ramp ${ramp.rampMax}f / `+
  `${ramp.rampPeak.toFixed(1)}px at ${ramp.takeoffSpeed.toFixed(2)} speed`);
if(!ramp.used||ramp.ramps!==1||ramp.rampMax<ramp.normalMax+20||ramp.rampPeak<ramp.normalPeak+12||
  ramp.takeoffSpeed<=4||!ramp.landed||ramp.landT!==18)fail(`ramp aerial contract regressed: ${JSON.stringify(ramp)}`);
if(!ramp.finite)fail('ramp fixture produced non-finite state');

console.log('8) motion render: speed, aerial, and grind states add readable effects');
game=bootGame('deadline-deck',{seed:0xdead207,footer:FOOTER});
const renderMode=mode=>{game.sandbox.__ddVisualState(mode);game.counter.calls=0;game.counter.byMethod={};
  game.sandbox.draw();return{calls:game.counter.calls,fills:game.counter.byMethod.fillRect||0};};
const idleFx=renderMode('idle'),fastFx=renderMode('fast'),airFx=renderMode('air'),grindFx=renderMode('grind');
console.log(`  canvas calls idle ${idleFx.calls}, fast ${fastFx.calls}, air ${airFx.calls}, grind ${grindFx.calls}`);
if(fastFx.calls<idleFx.calls+10||airFx.calls<idleFx.calls+14||grindFx.calls<idleFx.calls+6)
  fail(`motion effects are not materially visible in render work: ${JSON.stringify({idleFx,fastFx,airFx,grindFx})}`);

console.log('9) session + manual courier: Enter gate, push, steer, jump, throw, trick');
game=bootGame('deadline-deck',{seed:0xdead300,footer:FOOTER});
if(game.sandbox.__ddProbe().playing)fail('session started in playing mode');
press(game,'Enter');if(game.sandbox.__ddProbe().playing)fail('first Enter skipped instructions');
press(game,'Enter');if(!game.sandbox.__ddProbe().playing)fail('second Enter did not start the route');
const started=game.sandbox.__ddProbe();
game.key('keydown','ArrowUp');game.frames(90,false);game.key('keyup','ArrowUp');
const pushed=game.sandbox.__ddProbe();
game.key('keydown','ArrowRight');game.frames(20,false);game.key('keyup','ArrowRight');
const steered=game.sandbox.__ddProbe();
press(game,'Space');const jumped=game.sandbox.__ddProbe();
press(game,'KeyX');const threw=game.sandbox.__ddProbe();
press(game,'KeyZ');const tricked=game.sandbox.__ddProbe();
console.log(`  speed ${started.speed.toFixed(2)} -> ${pushed.speed.toFixed(2)}; steered ${(steered.rider.x-pushed.rider.x).toFixed(1)}px; jump ${jumped.rider.airT}f; `+
  `papers ${jumped.papers}->${threw.papers}; trick ${tricked.rider.trick}`);
if(pushed.speed-started.speed<1.4)fail('manual Up did not build speed');
if(steered.rider.x-pushed.rider.x<24)fail('manual right input did not carve responsively across the road');
if(jumped.rider.airT<=0||jumped.rider.h<=0)fail('manual Space did not launch an ollie');
if(threw.throws!==jumped.throws+1||threw.papers!==jumped.papers-1)fail('manual X did not throw exactly one paper');
if(!tricked.rider.trick||tricked.tricks!==threw.tricks+1)fail('manual Z did not start one aerial trick');
if(!tricked.finite)fail('manual courier produced non-finite state');

console.log('10) roadwork act + show ladder: telegraphed closure, courier reroutes, hitstop budgeted');
{
  const ACT_FOOTER=FOOTER+`
;globalThis.__work=()=>({phase:workPhase,laneX:workPhase==='calm'?-1:LANE_X[workLane],routeFrame,x:P.x});
// SHOW.events() is a bounded log and this game's offer volume evicts early
// act notes over 5 minutes — collect notes unboundedly for telegraph pairing
globalThis.__notes=[];
{const __n0=SHOW.note;SHOW.note=e=>{globalThis.__notes.push({kind:e.kind,id:e.id,tag:e.tag});return __n0(e);};}
globalThis.__showP=()=>SHOW.probe();
globalThis.__cones=()=>obstacles.filter(o=>o.work).length;
globalThis.__sig=()=>Math.round(P.x*31+distance*7)+delivered*1009+stats.crashes*97+Math.round(speed*100);`;
  const SEED=0xdead401;
  const a=bootGame('deadline-deck',{seed:SEED,footer:ACT_FOOTER});
  const b=bootGame('deadline-deck',{seed:SEED,footer:ACT_FOOTER});
  b.sandbox.__NO_ACTS=1;
  let firstDiverge=-1,divergePhase='',earlyCones=false,liveCones=0,
    liveSamples=0,distA=0,distB=0;
  for(let f=0;f<18000;f+=10){
    a.frames(10,false);b.frames(10,false);
    const g=a.sandbox.__work();
    if(g.phase==='warn'&&a.sandbox.__cones()>0)earlyCones=true;
    if(g.phase==='live'){liveSamples++;liveCones=Math.max(liveCones,a.sandbox.__cones());
      distA+=Math.abs(g.x-g.laneX);distB+=Math.abs(b.sandbox.__work().x-g.laneX);}
    if(firstDiverge<0&&a.sandbox.__sig()!==b.sandbox.__sig()){firstDiverge=f+10;divergePhase=g.phase;}
  }
  const ev=a.sandbox.__notes,p=a.sandbox.__showP();
  const works=[];let pend=null;
  for(const e of ev){
    if(e.kind==='act-warning'&&e.id==='roadwork')pend=e;
    else if(e.kind==='act-land'&&e.id==='roadwork'&&pend){works.push(e.tag-pend.tag);pend=null;}
  }
  const o=p.offeredByTier,s3=p.shownByTier[3]||0;
  const pa=a.sandbox.__ddProbe();
  console.log(`  ${works.length} closures landed (telegraphs ${works.join(',')} route-frames), `+
    `diverged at ${firstDiverge} during '${divergePhase}', live lane distance ${liveSamples?(distA/liveSamples).toFixed(1):'?'} `+
    `vs unaware ${liveSamples?(distB/liveSamples).toFixed(1):'?'} (${liveCones} cones), `+
    `tiers ${JSON.stringify(o)}, apexes ${s3} (held ${p.heldFrames}f, slowed ${p.slowedFrames}f), `+
    `${pa.deliveries} deliveries / ${pa.crashes} crashes`);
  if(works.length<2)fail(`only ${works.length} roadwork closures landed in 5 minutes`);
  for(const t of works)if(t<180||t>300)fail(`roadwork telegraph ${t} route-frames outside 180..300`);
  if(earlyCones)fail('cones spawned during the warning phase (telegraph must precede the strike)');
  if(liveCones<6)fail(`closed lane barely coned (${liveCones} cones)`);
  if(liveSamples<30)fail(`closure live phase barely observable (${liveSamples} samples)`);
  if(distA<=distB)fail(`courier ignored the closed lane (${(distA/Math.max(1,liveSamples)).toFixed(1)} vs ${(distB/Math.max(1,liveSamples)).toFixed(1)})`);
  if(firstDiverge<0)fail('courier never responded to roadwork (A/B identical)');
  else if(divergePhase!=='warn')fail(`courier first diverged during '${divergePhase}', not the telegraph`);
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=1))fail(`ladder not strictly ordered (${JSON.stringify(o)})`);
  if(p.heldFrames!==6*s3)fail(`hitstop ${p.heldFrames}f != 6f per apex (${s3})`);
  if(p.slowedFrames>18*s3)fail(`slow-mo overspent: ${p.slowedFrames}f for ${s3} apexes (budget 18f each)`);
  if(pa.deliveries<120)fail(`roadwork run deliveries ${pa.deliveries} fell below watchable floor 120`);
  if(pa.crashes>8)fail(`roadwork run crashes ${pa.crashes} exceed watchable limit 8`);
  const c=bootGame('deadline-deck',{seed:0xdead411,footer:ACT_FOOTER});
  const d=bootGame('deadline-deck',{seed:0xdead411,footer:ACT_FOOTER});
  d.sandbox.__NO_PAYOFF_FX=1;
  c.frames(10800,false);d.frames(10800,false);
  if(c.sandbox.__sig()!==d.sandbox.__sig())fail('__NO_PAYOFF_FX changed the sim: payoff confetti leaked into gameplay');
  else console.log('  __NO_PAYOFF_FX: sim signatures identical over 3 minutes');
}

console.log('11) ten-minute soak: moving, happening, progressing');
{
  const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
  const SOAK_FOOTER=`
;globalThis.__soakN={events:0,progress:0};
{const a0=addLine;addLine=(label,points,kind)=>{globalThis.__soakN.events++;
  if(kind==='delivery')globalThis.__soakN.progress++;return a0(label,points,kind);};}
globalThis.__soakProbe=()=>({sig:Math.round(P.x*7+distance),
  events:globalThis.__soakN.events,progress:globalThis.__soakN.progress,
  finite:[P].every(o=>['x','h'].every(k=>Number.isFinite(o[k])))&&Number.isFinite(distance)});`;
  const{samples}=runSoak('deadline-deck',{seed:0xdead501,footer:SOAK_FOOTER,minutes:10});
  const report=analyzeSoak(samples);
  console.log('  '+soakLine(report));
  // measured seeds 0xdead501/02: still 2s, quiet 4-5s, stall 17-31s, ~1380 ev, ~145 prog
  assertSoak('soak',report,{still:10,quiet:15,stall:60,minEvents:800,minProgress:90},fail);
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
