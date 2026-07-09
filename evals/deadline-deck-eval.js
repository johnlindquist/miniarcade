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
  frame,state,stateT,routeFrame,routeNo,distance,lives,papers,delivered,offered,missed,
  routeScore,comboPoints,comboCount,comboT,comboLabel,press,frontPage,
  ...stats,landedTricks:__ddLandedTricks,hybridMail:stats.airMail+stats.railMail,
  routeLog:{clears:globalThis.__ddRouteLog.clears,wipeouts:globalThis.__ddRouteLog.wipeouts,
    shorts:globalThis.__ddRouteLog.shorts,finishes:globalThis.__ddRouteLog.finishes.map(o=>({...o}))},
  rider:{...P},playing:playing(),finite:__ddAllFinite()
});
const __ddNeutral=()=>({steer:0,jump:false,throw:false,throwSide:0,trick:false,grind:false});

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
};`;

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};

console.log('1) autonomous newspaper lines: 3 x 5 simulated minutes');
let autonomousClears=0;
for(let run=1;run<=3;run++){
  const seed=0xdead102+run;
  const game=bootGame('deadline-deck',{seed,footer:FOOTER});
  game.frames(18000,false);const p=game.sandbox.__ddProbe();
  console.log(`  run ${run} seed ${seed}: ${p.routes} routes (${p.routeLog.clears} clear), `+
    `${p.deliveries} deliveries, ${p.landedTricks}/${p.tricks} landed tricks, ${p.grinds} grinds, `+
    `${p.airMail}+${p.railMail} hybrid mail, combo ${p.bestCombo}, ${p.crashes} crashes, `+
    `stall ${(p.maxStall/60).toFixed(1)}s`);
  if(!p.finite)fail(`run ${run}: non-finite route, rider, or entity state`);
  autonomousClears+=p.clears;
  if(p.routes<3||p.routes>6)fail(`run ${run}: ${p.routes} completed routes outside band 3..6`);
  if(p.deliveries<120)fail(`run ${run}: only ${p.deliveries} successful deliveries`);
  if(p.tricks<85||p.landedTricks<60)fail(`run ${run}: weak trick line (${p.landedTricks}/${p.tricks} landed)`);
  if(p.grinds<50)fail(`run ${run}: only ${p.grinds} rail grinds`);
  if(p.airMail<40||p.railMail<30)fail(`run ${run}: hybrid mail weak (${p.airMail} air, ${p.railMail} rail)`);
  if(p.bestMult<8||p.bestCombo<25000)fail(`run ${run}: best line only x${p.bestMult} / ${p.bestCombo}`);
  if(p.crashes>8)fail(`run ${run}: ${p.crashes} crashes exceed the watchable limit 8`);
  if(p.maxStall>480)fail(`run ${run}: progress stalled ${(p.maxStall/60).toFixed(1)}s (limit 8s)`);
}
if(autonomousClears<6)fail(`autonomous routes cleared quota only ${autonomousClears}/9 times`);

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

console.log('6) session + manual courier: Enter gate, steer, jump, throw, trick');
game=bootGame('deadline-deck',{seed:0xdead300,footer:FOOTER});
if(game.sandbox.__ddProbe().playing)fail('session started in playing mode');
press(game,'Enter');if(game.sandbox.__ddProbe().playing)fail('first Enter skipped instructions');
press(game,'Enter');if(!game.sandbox.__ddProbe().playing)fail('second Enter did not start the route');
const started=game.sandbox.__ddProbe();
game.key('keydown','ArrowRight');game.frames(20,false);game.key('keyup','ArrowRight');
const steered=game.sandbox.__ddProbe();
press(game,'Space');const jumped=game.sandbox.__ddProbe();
press(game,'KeyX');const threw=game.sandbox.__ddProbe();
press(game,'KeyZ');const tricked=game.sandbox.__ddProbe();
console.log(`  steered ${(steered.rider.x-started.rider.x).toFixed(1)}px; jump ${jumped.rider.airT}f; `+
  `papers ${jumped.papers}->${threw.papers}; trick ${tricked.rider.trick}`);
if(steered.rider.x-started.rider.x<15)fail('manual right input did not carve across the road');
if(jumped.rider.airT<=0||jumped.rider.h<=0)fail('manual Space did not launch an ollie');
if(threw.throws!==jumped.throws+1||threw.papers!==jumped.papers-1)fail('manual X did not throw exactly one paper');
if(!tricked.rider.trick||tricked.tricks!==threw.tricks+1)fail('manual Z did not start one aerial trick');
if(!tricked.finite)fail('manual courier produced non-finite state');

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
