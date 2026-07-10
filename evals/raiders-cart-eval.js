#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');

// Observation and isolated mechanics helpers only. The wrapper records intents
// after controllerMux has selected one, ignores copied planner bodies, and never
// changes a decision, physics value, draw path, or RNG stream.
const FOOTER=String.raw`
globalThis.__rcApplied=[];
{const old=applyIntent;applyIntent=function(intent){const out=old(intent);
  globalThis.__rcApplied.push({showFrame,runFrame,state,move:intent.move,action:intent.action,
    targetX:intent.targetX,tactic:intent.tactic});
  if(globalThis.__rcApplied.length>360)globalThis.__rcApplied.shift();return out;};}
globalThis.__rcClearApplied=()=>{globalThis.__rcApplied.length=0;};
globalThis.__rcLastApplied=()=>globalThis.__rcApplied.at(-1)||null;
globalThis.__rcManual=()=>({playing:playing(),state,roomFrame,x:player.x,y:player.y,
  intent:player.intent&&Object.assign({},player.intent)});
globalThis.__rcIntentSchemas=()=>{const human=humanIntent(),bot=rawBotIntent();return{human,bot,
  humanKeys:Object.keys(human).sort(),botKeys:Object.keys(bot).sort()};};
globalThis.__rcNextRandom=()=>E.random();
globalThis.__rcReset=()=>resetRun();
globalThis.__rcWaterContacts=[];
{const old=handleMechanicEvents;handleMechanicEvents=function(ev){
  if(ev.waterHit)globalThis.__rcWaterContacts.push({roomNo,cartX:mech.cart.x,frontX:mech.water.frontX,
    delta:Math.abs(mech.cart.x-mech.water.frontX)});return old(ev);};}
globalThis.__rcRoomPlans=()=>ROOMS.map(room=>{const candidates=PERMS.map(order=>
  simulateOrder(order,makeMechanics(room),room)).sort((a,b)=>b.score-a.score||
    a.order.join('').localeCompare(b.order.join('')));return{name:room.name,best:candidates[0],
    successfulOrders:candidates.filter(q=>q.sealBroken).length,candidates};});
globalThis.__rcContinuity={max:0,from:null,to:null};
{const old=stepWorld;stepWorld=function(){const from={x:player.x,y:player.y,roomNo,state},out=old(),
  to={x:player.x,y:player.y,roomNo,state},d=Math.hypot(to.x-from.x,to.y-from.y);
  if(from.roomNo===to.roomNo&&d>globalThis.__rcContinuity.max)
    globalThis.__rcContinuity={max:d,from,to};return out;};}
`;

let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const sum=(runs,key)=>runs.reduce((total,p)=>total+p.stats[key],0);
// Forecast quality rewards the moments this feature exists to create: a clean
// multi-body payoff and a loaded cart, while visible panic recovery and crushes
// remain costly. Plain room throughput still participates but cannot hide a
// repetitive recovery-driven policy.
const chainScore=p=>p.stats.rooms*20+p.stats.artifacts*30+p.stats.perfectChains*300+
  p.stats.rockLoads*25-p.stats.panics*40-p.stats.crushes*100;
const inBands=(p,bands,label)=>{for(const[key,[lo,hi]]of Object.entries(bands)){
  const value=p.stats[key];if(value<lo||value>hi)
    fail(`${label}: ${key} ${value} outside measured band ${lo}..${hi}`);
}};
const assertActPairs=(p,id,warnFrames,label,minPairs)=>{
  const notes=p.act.notes.filter(n=>n.id===id),warnings=notes.filter(n=>n.kind==='act-warning'),
    lands=notes.filter(n=>n.kind==='act-land'),pending=warnings.length===lands.length+1&&
      p.act.phase==='warn'&&(!lands.length||warnings.at(-1).tag>lands.at(-1).tag);
  if(lands.length<minPairs||!(lands.length===warnings.length||pending))
    fail(`${label}: ${id} emitted ${warnings.length} warnings / ${lands.length} lands`);
  for(let i=0;i<lands.length;i++){
    if(lands[i].tag-warnings[i].tag!==warnFrames)
      fail(`${label}: ${id} simulation warning ${lands[i].tag-warnings[i].tag}f != ${warnFrames}`);
    if(lands[i].at-warnings[i].at!==warnFrames)
      fail(`${label}: ${id} viewer warning ${lands[i].at-warnings[i].at}f != ${warnFrames}`);
    if(warnings[i].landsAt-warnings[i].at!==warnFrames)
      fail(`${label}: ${id} advertised warning ${warnings[i].landsAt-warnings[i].at}f != ${warnFrames}`);
    if(warnings[i].roomNo!==lands[i].roomNo)
      fail(`${label}: ${id} warning crossed rooms ${warnings[i].roomNo}->${lands[i].roomNo}`);
  }
};

// Registered 2026-07-10 from thirty fixed ten-minute seeds
// (0x7c000 + i*233) after spatial water contact and real exit-climbing landed.
// Observed min..max: rooms/artifacts/seals 37..39, perfect chains 25..30,
// crushes 0..2, digs/pushes/valves 38..40, rock loads 30..32, water hits
// 36..39, impacts 45..47, panics 8..13, stumbles 81..86, near misses 1..2,
// lapses 0..9, acts 8/8, events 411..428, progress 149..156, distance
// 8,060..8,713. Lulls were 458..500f activity and 1,311..1,503f story.
// Bands add measured margin on both sides and keep imperfect play bounded.
const WATCH_BANDS={
  rooms:[34,42],artifacts:[34,42],seals:[34,42],perfectChains:[22,34],crushes:[0,4],
  digs:[35,43],pushes:[35,43],valves:[35,43],rockLoads:[27,35],waterHits:[33,43],
  cartImpacts:[41,52],panics:[6,16],stumbles:[72,96],nearMisses:[0,5],lapses:[0,12],
  actWarnings:[7,9],actLands:[7,9],events:[390,450],progress:[140,168],distance:[7400,9500]
};

// Combined observed extrema from ten paired five-minute chain-plan/reactive
// runs (0x7200 + i*37): rooms/artifacts/seals 18..19, perfect chains 7..15,
// crushes 0, all actions 18..20, rock loads 8..15, water hits 17..19,
// impacts 23..27, panics 4..12, events 199..214, progress 72..76, distance
// 4,140..4,626. One shared band keeps both policies active.
const POLICY_BANDS={
  rooms:[16,22],artifacts:[16,22],seals:[16,22],perfectChains:[5,18],crushes:[0,3],
  digs:[16,23],pushes:[16,23],valves:[16,23],rockLoads:[6,18],waterHits:[15,22],
  cartImpacts:[20,32],panics:[2,15],stumbles:[34,50],nearMisses:[0,3],lapses:[0,9],
  actWarnings:[3,5],actLands:[3,5],events:[185,230],progress:[65,85],distance:[3800,5200]
};

console.log('1) fixed 60 Hz replay, render parity, chunk parity, and finite renderer');
{
  const a=bootGame('raiders-cart',{seed:0x7101,footer:FOOTER}),
    b=bootGame('raiders-cart',{seed:0x7101,footer:FOOTER}),
    rendered=bootGame('raiders-cart',{seed:0x7101,footer:FOOTER});
  a.frames(3600,false);b.frames(3600,false);const draws=rendered.frames(3600,true);
  const sa=a.sandbox.__raidersCartSignature(),sb=b.sandbox.__raidersCartSignature(),
    sr=rendered.sandbox.__raidersCartSignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${draws.calls} draw calls`);
  if(sa!==sb)fail('same seed diverged under identical fixed stepping');
  if(sa!==sr)fail('render traversal changed simulation state or RNG');
  if(!a.sandbox.__raidersCartProbe().finite||!rendered.sandbox.__raidersCartProbe().finite)
    fail('headless or rendered replay became non-finite');
  if(draws.calls<100000||!draws.byMethod.fillRect||!draws.byMethod.beginPath||!draws.byMethod.fillText)
    fail(`real render path was not exercised: ${JSON.stringify(draws.byMethod)}`);

  const mono=bootGame('raiders-cart',{seed:0x7102,footer:FOOTER}),
    chunked=bootGame('raiders-cart',{seed:0x7102,footer:FOOTER});
  mono.frames(2400,false);for(let i=0;i<240;i++)chunked.frames(10,false);
  const same=mono.sandbox.__raidersCartSignature()===chunked.sandbox.__raidersCartSignature();
  console.log(`  2,400 monolithic frames vs 240 x 10: ${same?'identical':'DIFFERENT'}`);
  if(!same)fail('chunked headless stepping changed the deterministic result');
}

console.log('2) chain planner is pure, repeatable, exact, RNG-inert, and room geometry matters');
{
  const planned=bootGame('raiders-cart',{seed:0x7110,footer:FOOTER}),
    control=bootGame('raiders-cart',{seed:0x7110,footer:FOOTER}),
    fixture=planned.sandbox.__raidersCartPlannerFixture();
  const nextPlanned=planned.sandbox.__rcNextRandom(),nextControl=control.sandbox.__rcNextRandom();
  console.log(`  pure ${fixture.pure}; repeat ${fixture.repeat}; exact ${fixture.exact}; `+
    `${fixture.plan.order.join(' > ')} score ${fixture.plan.score}; RNG ${nextPlanned.toFixed(8)}/${nextControl.toFixed(8)}`);
  if(!fixture.pure||!fixture.repeat||!fixture.exact||!fixture.finite||!fixture.plan.sealBroken||
    fixture.plan.signature!==fixture.replay.signature||fixture.plan.order.length!==3||
    new Set(fixture.plan.order).size!==3)
    fail(`planner fixture regressed: ${JSON.stringify(fixture)}`);
  if(nextPlanned!==nextControl)fail('chain planning consumed engine RNG for simulation-invisible work');

  const rooms=planned.sandbox.__rcRoomPlans(),orders=new Set(rooms.map(r=>r.best.order.join('>')));
  console.log('  '+rooms.map(r=>`${r.name}: ${r.best.order.join('>')} (${r.successfulOrders}/6 viable)`).join('; '));
  if(rooms.length!==5||rooms.some(r=>r.candidates.length!==6||!r.best.sealBroken||r.best.load!==1||
    r.best.order.length!==3||new Set(r.best.order).size!==3))
    fail(`a room stopped exercising the full cart/rock/water kernel: ${JSON.stringify(rooms)}`);
  if(orders.size<4)fail(`room geometry collapsed to only ${orders.size} winning action orders`);
  if(!rooms.some(r=>r.successfulOrders===1)||!rooms.some(r=>r.successfulOrders===2)||
    rooms.some(r=>r.successfulOrders<1||r.successfulOrders>2))
    fail('room plans lost the measured selective one-or-two-route mechanics contract');
}

console.log('3) measured ten-minute watchability panel: chains, failures, acts, and progress');
const watch=[];
for(const seed of[0x7400,0x749f,0x753e,0x7612]){
  const game=bootGame('raiders-cart',{seed,footer:FOOTER});game.frames(36000,false);
  const p=game.sandbox.__raidersCartProbe();watch.push(p);
  console.log(`  ${seed.toString(16)} ${p.persona.padEnd(9)} ${p.stats.rooms} rooms/${p.stats.artifacts} idols, `+
    `${p.stats.perfectChains} perfect/${p.stats.crushes} crushed, ${p.stats.panics} panics, `+
    `${p.stats.events} events/${p.stats.progress} progress, lulls ${p.stats.maxEventLull}/${p.stats.maxProgressLull}f`);
  if(!p.finite)fail(`seed ${seed.toString(16)} became non-finite`);
  inBands(p,WATCH_BANDS,`seed ${seed.toString(16)} ${p.persona}`);
  if(p.stats.maxEventLull>900||p.stats.maxProgressLull>1800)
    fail(`seed ${seed.toString(16)} viewer lull ${p.stats.maxEventLull}/${p.stats.maxProgressLull}f`);
  const contacts=game.sandbox.__rcWaterContacts;
  if(contacts.length!==p.stats.waterHits||contacts.some(value=>value.delta>15))
    fail(`seed ${seed.toString(16)} water accelerated the cart without drawn contact: ${JSON.stringify(contacts)}`);
  assertActPairs(p,'flood',240,`seed ${seed.toString(16)}`,3);
  assertActPairs(p,'cavein',210,`seed ${seed.toString(16)}`,3);
}
if(new Set(watch.map(p=>p.persona)).size<2)fail('watchability panel did not exercise at least two personas');

console.log('4) chain-plan A/B: eight paired five-minute seeds against reactive fixed order');
{
  const smart=[],reactive=[];let wins=0;
  for(let i=0;i<8;i++){
    const seed=0x7200+i*37,a=bootGame('raiders-cart',{seed,footer:FOOTER}),
      b=bootGame('raiders-cart',{seed,footer:FOOTER});
    b.sandbox.__NO_CHAIN_PLAN=1;a.frames(18000,false);b.frames(18000,false);
    const pa=a.sandbox.__raidersCartProbe(),pb=b.sandbox.__raidersCartProbe(),
      sa=chainScore(pa),sb=chainScore(pb);smart.push(pa);reactive.push(pb);if(sa>sb)wins++;
    inBands(pa,POLICY_BANDS,`seed ${seed.toString(16)} planned`);
    inBands(pb,POLICY_BANDS,`seed ${seed.toString(16)} reactive`);
    if(!pa.finite||!pb.finite)fail(`seed ${seed.toString(16)} policy A/B became non-finite`);
    if(pa.stats.maxProgressLull>2100||pb.stats.maxProgressLull>2100)
      fail(`seed ${seed.toString(16)} policy progress lull ${pa.stats.maxProgressLull}/${pb.stats.maxProgressLull}f`);
    console.log(`  ${seed.toString(16)} ${pa.persona.padEnd(9)} score ${sa}/${sb}; `+
      `rooms ${pa.stats.rooms}/${pb.stats.rooms}, perfect ${pa.stats.perfectChains}/${pb.stats.perfectChains}, `+
      `crush ${pa.stats.crushes}/${pb.stats.crushes}`);
  }
  const smartScore=smart.reduce((n,p)=>n+chainScore(p),0),baseScore=reactive.reduce((n,p)=>n+chainScore(p),0),
    baselineActions=sum(reactive,'digs')+sum(reactive,'pushes')+sum(reactive,'valves');
  console.log(`  ${wins}/8 wins; aggregate ${smartScore}/${baseScore} (${(smartScore/baseScore).toFixed(2)}x); `+
    `baseline ${baselineActions} actions, ${sum(reactive,'seals')} seals, ${sum(reactive,'perfectChains')} perfect chains`);
  if(wins<7)fail(`chain planner won only ${wins}/8 paired seeds`);
  if(smartScore<baseScore*1.5)fail(`chain planner aggregate advantage ${smartScore}/${baseScore} below 50%`);
  if(baselineActions<280||sum(reactive,'seals')<75||sum(reactive,'perfectChains')<8)
    fail('reactive baseline stopped honestly participating in the mechanics');
}

console.log('5) FLOOD and CAVE-IN warn exactly and change behavior before landing');
for(const spec of[{type:'flood',warn:240,tactic:'CLIMB ABOVE FLOOD'},
  {type:'cavein',warn:210,tactic:'CLEAR THE FALL LINE'}]){
  const seed=spec.type==='flood'?0x7500:0x7501,
    a=bootGame('raiders-cart',{seed,footer:FOOTER}),b=bootGame('raiders-cart',{seed,footer:FOOTER});
  a.sandbox.__raidersCartSetAct(spec.type);b.sandbox.__raidersCartSetAct(spec.type);b.sandbox.__NO_ACTS=1;
  if(a.sandbox.__raidersCartPhysical()!==b.sandbox.__raidersCartPhysical())
    fail(`${spec.type}: act fixture did not start physically identical`);
  let first=-1,phase='',tactic='';
  for(let frame=1;frame<=60+spec.warn+30;frame++){
    a.frames(1,false);b.frames(1,false);
    if(first<0&&a.sandbox.__raidersCartPhysical()!==b.sandbox.__raidersCartPhysical()){
      first=frame;const state=a.sandbox.__raidersCartActState();phase=state.phase;tactic=state.tactic;}
  }
  const pa=a.sandbox.__raidersCartProbe(),pb=b.sandbox.__raidersCartProbe(),
    warning=pa.act.notes.find(n=>n.kind==='act-warning'),land=pa.act.notes.find(n=>n.kind==='act-land');
  console.log(`  ${spec.type}: warning ${warning&&land?land.tag-warning.tag:'?'}f; first physical/intent divergence f${first} in ${phase} (${tactic})`);
  if(!warning||!land||warning.tag!==60||warning.at!==60||
    land.tag-warning.tag!==spec.warn||land.at-warning.at!==spec.warn||
    warning.landsAt-warning.at!==spec.warn)
    fail(`${spec.type}: warning/tag/at timing was not exact`);
  if(first!==60||phase!=='warn'||tactic!==spec.tactic)
    fail(`${spec.type}: first divergence was not the legible warning response (${first}/${phase}/${tactic})`);
  if(pb.act.notes.length)fail(`${spec.type}: __NO_ACTS still emitted act notes`);
}
{
  const game=bootGame('raiders-cart',{seed:0x7502,footer:FOOTER});
  game.sandbox.__raidersCartSetAct('flood');game.frames(100,false);
  const warning=game.sandbox.__raidersCartProbe();game.sandbox.__rcReset();game.frames(400,false);
  const after=game.sandbox.__raidersCartProbe();
  console.log(`  reset during warning: ${warning.act.phase}->${after.act.phase}; ${after.act.notes.length} surviving notes`);
  if(warning.act.phase!=='warn'||after.act.phase!=='calm'||after.act.notes.some(n=>n.kind==='act-land')||!after.finite)
    fail('reset during warning leaked a stale act land');
}

console.log('6) two-Enter manual takeover uses the shared intent schema and applyIntent path');
{
  const game=bootGame('raiders-cart',{seed:0x7510,footer:FOOTER}),initial=game.sandbox.__rcManual();
  press(game,'Enter');const instructions=game.sandbox.__rcManual();press(game,'Enter');const started=game.sandbox.__rcManual();
  game.frames(120,false);const schemas=game.sandbox.__rcIntentSchemas(),pushesBefore=game.sandbox.__raidersCartProbe().stats.pushes;
  game.key('keydown','KeyX');game.frames(100,false);game.key('keyup','KeyX');
  const pushesAfter=game.sandbox.__raidersCartProbe().stats.pushes;
  const apply=(code,frames)=>{game.sandbox.__rcClearApplied();game.key('keydown',code);game.frames(frames||3,false);
    game.key('keyup',code);return game.sandbox.__rcLastApplied();};
  const left=apply('ArrowLeft'),dig=apply('Space'),push=apply('KeyX'),valve=apply('KeyZ'),p=game.sandbox.__raidersCartProbe();
  console.log(`  playing ${initial.playing}->${instructions.playing}->${started.playing}; schema ${schemas.humanKeys.join(',')}; `+
    `move ${left&&left.move}, actions ${dig&&dig.action}/${push&&push.action}/${valve&&valve.action}`);
  if(initial.playing||instructions.playing||!started.playing)fail('manual session skipped the two-Enter gate');
  if(schemas.humanKeys.join('|')!==schemas.botKeys.join('|'))fail(`human/bot schemas differ: ${JSON.stringify(schemas)}`);
  if(!left||left.move!==-1||left.tactic!=='MANUAL MOVE')fail('manual movement bypassed common applyIntent');
  if(!dig||dig.action!=='DIG'||dig.tactic!=='MANUAL DIG')fail('manual DIG bypassed common applyIntent');
  if(!push||push.action!=='PUSH'||push.tactic!=='MANUAL PUSH')fail('manual PUSH bypassed common applyIntent');
  if(!valve||valve.action!=='VALVE'||valve.tactic!=='MANUAL VALVE')fail('manual VALVE bypassed common applyIntent');
  if(pushesAfter!==pushesBefore)fail('manual PUSH activated remotely without reaching the cart');
  if(!p.finite)fail('manual controller produced non-finite state');
}

console.log('7) SHOW ladder order, exact apex budgets, skill lapses, and admire gate');
for(let i=0;i<watch.length;i++){
  const p=watch[i],show=p.show,offered=show.offeredByTier,shown=show.shownByTier,s3=shown[3]||0,
    label=['7400','749f','753e','7612'][i];
  if(!((offered[1]||0)>(offered[2]||0)&&(offered[2]||0)>(offered[3]||0)&&(offered[3]||0)>=7))
    fail(`seed ${label}: offered tiers not strictly ordered ${JSON.stringify(offered)}`);
  if(!((shown[1]||0)>(shown[2]||0)&&(shown[2]||0)>(shown[3]||0)&&(shown[3]||0)>=7))
    fail(`seed ${label}: shown tiers not strictly ordered ${JSON.stringify(shown)}`);
  if(show.heldFrames!==6*s3)fail(`seed ${label}: apex hold ${show.heldFrames} != 6*${s3}`);
  if(show.slowedFrames!==24*s3)fail(`seed ${label}: apex slow ${show.slowedFrames} != 24*${s3}`);
  if(show.admireFrames!==48*s3)fail(`seed ${label}: apex admire ${show.admireFrames} != 48*${s3}`);
  console.log(`  ${label}: tiers ${JSON.stringify(shown)}, budgets ${show.heldFrames}/${show.slowedFrames}/${show.admireFrames}`);
}
if(sum(watch,'lapses')<1)fail('skill-profile lapses never fired across the watchability panel');
{
  const game=bootGame('raiders-cart',{seed:0x7520,footer:FOOTER}),admire=game.sandbox.__raidersCartAdmireFixture();
  if(admire.admired.tactic!=='ADMIRE THE CHAIN'||admire.gated.tactic==='ADMIRE THE CHAIN')
    fail(`__NO_ADMIRE did not gate the bot pause: ${JSON.stringify(admire)}`);
  const perfect=bootGame('raiders-cart',{seed:0x7521,footer:FOOTER});perfect.sandbox.__NO_LAPSE=1;
  perfect.frames(18000,false);if(perfect.sandbox.__raidersCartProbe().stats.lapses!==0)
    fail('__NO_LAPSE did not eliminate skill-profile lapse onsets');
}

console.log('8) payoff FX switch is a perfect same-seed simulation no-op');
{
  const a=bootGame('raiders-cart',{seed:0x7600,footer:FOOTER}),
    b=bootGame('raiders-cart',{seed:0x7600,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);
  const same=a.sandbox.__raidersCartSignature()===b.sandbox.__raidersCartSignature(),p=a.sandbox.__raidersCartProbe();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} through ${p.stats.events} events / ${p.stats.perfectChains} apex chains`);
  if(!same)fail('__NO_PAYOFF_FX changed mechanics, pursuit, acts, score, or policy state');
  if(p.stats.perfectChains<2||p.stats.seals<10)fail('FX parity window did not exercise real chain payoffs');
}

console.log('9) ten-minute soak: moving, active, progressing, finite, and no invisible jumps');
{
  const{game,samples}=runSoak('raiders-cart',{seed:0x7400,minutes:10,footer:FOOTER}),
    report=analyzeSoak(samples),p=game.sandbox.__raidersCartProbe(),continuity=game.sandbox.__rcContinuity;
  console.log(`  ${soakLine(report)}; max same-room step ${continuity.max.toFixed(3)}px; `+
    `${p.stats.rooms} rooms/${p.stats.perfectChains} perfect/${p.stats.crushes} crushed`);
  assertSoak('raiders-cart soak',report,{still:3,quiet:10,stall:28,minEvents:390,minProgress:140},fail);
  inBands(p,WATCH_BANDS,'ten-minute soak');
  if(continuity.max>1.1)fail(`unaccounted ${continuity.max.toFixed(3)}px mid-room explorer jump`);
  if(!p.finite)fail('ten-minute soak ended non-finite');
}

console.log(failed?'\nRAIDERS CART EVAL FAILED':'\nRAIDERS CART EVAL PASSED');
process.exit(failed?1:0);
