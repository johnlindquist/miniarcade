#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');

const FOOTER=`
globalThis.__fcApplied=[];
{const __fca0=applyIntent;applyIntent=intent=>{const out=__fca0(intent);globalThis.__fcApplied.push({frame:runFrame,...intent});if(globalThis.__fcApplied.length>240)globalThis.__fcApplied.shift();return out;};}
globalThis.__fcClearApplied=()=>{globalThis.__fcApplied.length=0;};
globalThis.__fcLastApplied=()=>globalThis.__fcApplied.at(-1)||null;
globalThis.__fcNextRandom=()=>E.random();
`;

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const sum=(rows,key)=>rows.reduce((n,p)=>n+p.stats[key],0);
const familyScore=p=>p.stats.delivered+p.stats.wholeArrivals*5-p.stats.passengerLosses*2-p.stats.leadFalls*5;

// Actual calibration, 2026-07-10: thirty fixed ten-minute smart runs and
// thirty paired reactive-baseline runs (seed 0xfc000 + i*233), after the
// viewer-clock act and real SHOW-directive fixes. Smart observed: hops
// 780..840, pickups 118..136, losses 12..27, sacrifices 7..18, lead falls
// 0..3, arrivals 29..34, whole arrivals 14..22, partials 7..18, delivered
// 125..148, road/river clears 30..34 / 29..34, close calls 20..39, collapsed
// logs 2..12, lapses 0..8, events 1056..1164, progress 474..546, planner
// calls 676..842, event lull 216..302f, progress lull 742..1791f. Baseline
// stayed busy (34..37 arrivals) with 22..45 losses and 7..17 whole arrivals.
// Both complete contracts below add measured margin on every watchability stat.
const WATCH_BANDS={
  hops:[750,875],pickups:[108,148],maxChain:[5,5],passengerLosses:[8,34],sacrifices:[4,23],leadFalls:[0,6],
  arrivals:[27,38],wholeArrivals:[11,26],partialArrivals:[4,23],delivered:[115,160],roadClears:[28,38],riverClears:[27,38],
  closeCalls:[15,46],logsCollapsed:[1,16],lapses:[0,11],actsWarned:[8,10],actsLanded:[8,10],apexes:[11,26],
  events:[1000,1230],progress:[440,590],plannerCalls:[620,920],plannerSteps:[35000,52000],expeditions:[29,40]
};
const SMART_POLICY={...WATCH_BANDS};
const BASE_POLICY={
  hops:[820,930],pickups:[125,165],maxChain:[5,5],passengerLosses:[16,52],sacrifices:[0,16],leadFalls:[0,7],
  arrivals:[31,42],wholeArrivals:[4,21],partialArrivals:[13,35],delivered:[130,170],roadClears:[32,42],riverClears:[31,42],
  closeCalls:[28,65],logsCollapsed:[1,16],lapses:[0,10],actsWarned:[8,10],actsLanded:[8,10],apexes:[4,21],
  events:[1120,1340],progress:[510,660],plannerCalls:[0,0],plannerSteps:[0,0],expeditions:[33,46]
};
function inBands(p,bands,label){for(const[k,[lo,hi]]of Object.entries(bands)){const v=p.stats[k];if(v<lo||v>hi)fail(`${label}: ${k} ${v} outside measured band ${lo}..${hi}`);}}
function actPairs(p,id,warn,label,minPairs){
  const notes=p.act.notes.filter(n=>n.id===id),warnings=notes.filter(n=>n.kind==='act-warning'),lands=notes.filter(n=>n.kind==='act-land'),responses=notes.filter(n=>n.kind==='act-response');
  if(warnings.length<minPairs||lands.length>warnings.length||warnings.length-lands.length>1)fail(`${label}: ${id} emitted ${warnings.length} warnings / ${lands.length} lands`);
  for(let i=0;i<lands.length;i++){
    const w=warnings[i],l=lands[i],response=responses.find(r=>r.at>=w.at&&r.at<l.at);
    if(l.at-w.at!==warn||l.at!==w.landsAt)fail(`${label}: ${id} pair ${i} occupied ${l.at-w.at} viewer frames, expected ${warn}`);
    if(!response||!response.tactic||!/RALLY|HOLD|RACE/.test(response.tactic))fail(`${label}: ${id} pair ${i} had no legible pre-land response`);
  }
  if(warnings.length>lands.length&&warnings.at(-1).landsAt<=p.showFrame)fail(`${label}: ${id} left an overdue warning unlanded`);
}

console.log('1) deterministic fixed-step replay, render parity, and batching');
{
  const a=bootGame('frog-convoy',{seed:0xfc1001,footer:FOOTER}),b=bootGame('frog-convoy',{seed:0xfc1001,footer:FOOTER}),r=bootGame('frog-convoy',{seed:0xfc1001,footer:FOOTER});
  a.frames(7200,false);b.frames(7200,false);r.frames(7200,true);
  const sa=a.sandbox.__frogConvoySignature(),sb=b.sandbox.__frogConvoySignature(),sr=r.sandbox.__frogConvoySignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${r.counter.calls} canvas calls on final frame`);
  if(sa!==sb)fail('same seed diverged under fixed headless steps');if(sa!==sr)fail('render traversal changed simulation or RNG');if(!a.sandbox.__frogConvoyProbe().finite)fail('replay ended non-finite');
  const mono=bootGame('frog-convoy',{seed:0xfc1002,footer:FOOTER}),chunk=bootGame('frog-convoy',{seed:0xfc1002,footer:FOOTER});
  mono.frames(18000,false);for(let i=0;i<1800;i++)chunk.frames(10,false);const same=mono.sandbox.__frogConvoySignature()===chunk.sandbox.__frogConvoySignature();
  console.log(`  18,000 monolithic vs 1,800 x 10: ${same?'identical':'DIFFERENT'}`);if(!same)fail('step batching changed simulation');
}

console.log('2) shared hop physics + copied family planner are finite, pure, repeatable, and RNG-free');
{
  const game=bootGame('frog-convoy',{seed:0xfc1010,footer:FOOTER}),physics=game.sandbox.__frogConvoyPhysicsFixture(),plan=game.sandbox.__frogConvoyPlannerFixture();
  console.log(`  physics pure ${physics.pure}, ${physics.started} start/${physics.landed} land; planner pure ${plan.pure}, repeat ${plan.repeat}, ${plan.route.steps} exact steps`);
  if(!physics.pure||!physics.finite||physics.started!==1||physics.landed!==1)fail(`shared advanceFrog fixture regressed: ${JSON.stringify(physics)}`);
  if(!plan.pure||!plan.repeat||!plan.finite||!plan.route.finite||!plan.route.moved)fail(`family planner fixture regressed: ${JSON.stringify(plan)}`);
  const control=bootGame('frog-convoy',{seed:0xfc1011,footer:FOOTER}),planned=bootGame('frog-convoy',{seed:0xfc1011,footer:FOOTER});
  planned.sandbox.__frogConvoyPlanOnce();const rp=planned.sandbox.__fcNextRandom(),rc=control.sandbox.__fcNextRandom();
  console.log(`  next engine RNG after planning ${rp.toFixed(8)} vs control ${rc.toFixed(8)}`);if(rp!==rc)fail('planner consumed engine RNG');
}

console.log('3) measured ten-minute watchability distribution: four panel seeds');
const watch=[],watchSeeds=[0xfc000,0xfc000+233*7,0xfc000+233*16,0xfc000+233*29];
for(const seed of watchSeeds){
  const game=bootGame('frog-convoy',{seed,footer:FOOTER});game.frames(36000,false);const p=game.sandbox.__frogConvoyProbe();watch.push(p);
  console.log(`  ${seed.toString(16)} ${p.persona.padEnd(10)}: ${p.stats.wholeArrivals}/${p.stats.arrivals} whole, ${p.stats.delivered} home, `+
    `${p.stats.passengerLosses} lost/${p.stats.sacrifices} sacrifices, ${p.stats.logsCollapsed} logs, lulls ${(p.maxEventLull/60).toFixed(1)}s/${(p.maxProgressLull/60).toFixed(1)}s`);
  if(!p.finite)fail(`${seed.toString(16)}: non-finite state`);inBands(p,WATCH_BANDS,seed.toString(16));
  actPairs(p,'rush',240,seed.toString(16),4);actPairs(p,'flood',210,seed.toString(16),4);
  if(p.maxEventLull>360)fail(`${seed.toString(16)}: event lull ${p.maxEventLull}f > 360f`);
  if(p.maxProgressLull>2100)fail(`${seed.toString(16)}: progress lull ${p.maxProgressLull}f > 2100f`);
}
{
  const personas=new Set(watch.flatMap(p=>p.personas||[p.persona])),lapses=sum(watch,'lapses'),losses=sum(watch,'passengerLosses'),whole=sum(watch,'wholeArrivals');
  console.log(`  freshness: ${personas.size} personas; ${lapses} lapse onsets; ${losses} honest losses; ${whole} apex arrivals`);
  if(personas.size<2)fail('panel did not vary persona');if(lapses<2)fail('skill-profile imperfection disappeared');if(losses<20)fail('smart play erased escort stakes');if(whole<40)fail('whole-family payoff went missing');
}

console.log('4) family-lookahead A/B: eight same-seed ten-minute pairs vs lead-only gap reading');
{
  const smart=[],base=[];let scoreWins=0,wholeWins=0;
  for(let i=0;i<8;i++){
    const seed=0xf100+i*191,a=bootGame('frog-convoy',{seed,footer:FOOTER}),b=bootGame('frog-convoy',{seed,footer:FOOTER});b.sandbox.__NO_FAMILY_LOOKAHEAD=1;
    a.frames(36000,false);b.frames(36000,false);const pa=a.sandbox.__frogConvoyProbe(),pb=b.sandbox.__frogConvoyProbe();smart.push(pa);base.push(pb);
    if(familyScore(pa)>familyScore(pb))scoreWins++;if(pa.stats.wholeArrivals>pb.stats.wholeArrivals)wholeWins++;
    inBands(pa,SMART_POLICY,`${seed.toString(16)} smart`);inBands(pb,BASE_POLICY,`${seed.toString(16)} baseline`);
    if(pa.maxEventLull>360||pa.maxProgressLull>2100)fail(`${seed.toString(16)} smart lulls ${pa.maxEventLull}/${pa.maxProgressLull} exceed measured margins`);
    if(pb.maxEventLull>340||pb.maxProgressLull>1200)fail(`${seed.toString(16)} baseline lulls ${pb.maxEventLull}/${pb.maxProgressLull} exceed measured margins`);
    if(pa.stats.plannerCalls<=0||pb.stats.plannerCalls!==0)fail(`${seed.toString(16)}: ablation did not fully restore reactive policy`);
    console.log(`  ${seed.toString(16)} smart ${pa.stats.wholeArrivals}/${pa.stats.arrivals} whole, ${pa.stats.passengerLosses} lost, score ${familyScore(pa)} `+
      `vs base ${pb.stats.wholeArrivals}/${pb.stats.arrivals}, ${pb.stats.passengerLosses} lost, score ${familyScore(pb)}`);
  }
  const sw=sum(smart,'wholeArrivals'),bw=sum(base,'wholeArrivals'),sl=sum(smart,'passengerLosses'),bl=sum(base,'passengerLosses'),gain=sw/bw-1,lossDrop=1-sl/bl;
  console.log(`  family score wins ${scoreWins}/8; whole-family wins ${wholeWins}/8; whole arrivals ${sw} vs ${bw} (+${(gain*100).toFixed(1)}%); losses ${sl} vs ${bl} (-${(lossDrop*100).toFixed(1)}%)`);
  if(scoreWins<7||wholeWins<6)fail(`lookahead did not win clearly (${scoreWins}/8 score, ${wholeWins}/8 whole)`);
  if(gain<.35)fail(`whole-family gain ${(gain*100).toFixed(1)}% below 35%`);if(lossDrop<.25)fail(`passenger-loss reduction ${(lossDrop*100).toFixed(1)}% below 25%`);
  if(sl<=0||sum(smart,'sacrifices')<=0)fail('lookahead erased honest losses or sacrifice drama');
}

console.log('5) acts: exact warning pairs and first physical/control divergence before land');
for(const spec of[{id:'rush',warn:240},{id:'flood',warn:210}]){
  const seed=spec.id==='rush'?0xfc2001:0xfc2002,a=bootGame('frog-convoy',{seed,footer:FOOTER}),b=bootGame('frog-convoy',{seed,footer:FOOTER});
  a.sandbox.__frogConvoySetAct(spec.id);b.sandbox.__frogConvoySetAct(spec.id);b.sandbox.__NO_ACTS=1;let first=-1,phase='',tactic='';
  for(let f=1;f<=60+spec.warn+50;f++){a.frames(1,false);b.frames(1,false);if(first<0&&a.sandbox.__frogConvoyMotion()!==b.sandbox.__frogConvoyMotion()){
    first=f;const s=a.sandbox.__frogConvoyActState();phase=s.phase;tactic=s.tactic;}}
  a.frames(90,false);b.frames(90,false);const pa=a.sandbox.__frogConvoyProbe(),pb=b.sandbox.__frogConvoyProbe(),notes=pa.act.notes.filter(n=>n.id===spec.id),w=notes.find(n=>n.kind==='act-warning'),l=notes.find(n=>n.kind==='act-land');
  console.log(`  ${spec.id}: first divergence f${first} in ${phase} as ${tactic}; viewer lead ${w&&l?l.at-w.at:'missing'}f`);
  if(!w||!l||l.at-w.at!==spec.warn||l.at!==w.landsAt)fail(`${spec.id}: warning/land pair not exactly ${spec.warn} viewer frames`);
  if(first<0||phase!=='warn'||first>60+spec.warn)fail(`${spec.id}: first divergence was not in warning`);
  if(!/RALLY|HOLD|RACE/.test(tactic||''))fail(`${spec.id}: warning response was not legible: ${tactic}`);
  if(pb.act.notes.some(n=>n.id===spec.id))fail(`__NO_ACTS emitted ${spec.id} notes`);
}
{
  const g=bootGame('frog-convoy',{seed:0xfc2003,footer:FOOTER});g.sandbox.__frogConvoySetAct('flood');g.frames(80,false);const before=g.sandbox.__frogConvoyProbe();press(g,'Enter');press(g,'Enter');const reset=g.sandbox.__frogConvoyProbe();g.frames(400,false);const after=g.sandbox.__frogConvoyProbe(),stale=after.act.notes.filter(n=>n.kind==='act-land').length;
  console.log(`  reset during warning: ${before.act.phase}->${reset.act.phase}; stale lands ${stale}`);
  if(before.act.phase!=='warn'||reset.act.phase!=='calm'||stale||!after.playing||!after.finite)fail('session reset leaked a canceled act');
}

console.log('6) manual takeover: two-Enter gate and human hop/guard use applyIntent');
{
  const g=bootGame('frog-convoy',{seed:0xfc3001,footer:FOOTER});if(g.sandbox.__frogConvoyProbe().playing)fail('session started in playing mode');press(g,'Enter');if(g.sandbox.__frogConvoyProbe().playing)fail('first Enter skipped instructions');press(g,'Enter');if(!g.sandbox.__frogConvoyProbe().playing)fail('second Enter did not start');
  g.sandbox.__fcClearApplied();g.key('keydown','ArrowLeft');g.frames(3,false);g.key('keyup','ArrowLeft');const move=g.sandbox.__fcLastApplied();
  g.sandbox.__fcClearApplied();g.key('keydown','Space');g.frames(2,false);g.key('keyup','Space');const guard=g.sandbox.__fcLastApplied(),p=g.sandbox.__frogConvoyProbe();
  console.log(`  move ${move&&move.dx}/${move&&move.hop}; guard ${guard&&guard.guard}; applied ${p.stats.appliedIntents}`);
  if(!move||move.tactic!=='MANUAL CONVOY'||move.dx!==-1||!move.hop)fail('manual hop bypassed shared intent');
  if(!guard||guard.tactic!=='MANUAL CONVOY'||!guard.guard)fail('manual guard bypassed shared intent');
}

console.log('7) strict payoff ladder, exact apex budgets, and admire gating');
{
  const g=bootGame('frog-convoy',{seed:0xfc000,footer:FOOTER});g.frames(36000,false);let p=g.sandbox.__frogConvoyProbe(),guard=0;
  while(p.show.active&&p.show.active.tier===3&&guard++<200){g.frames(1,false);p=g.sandbox.__frogConvoyProbe();}
  const show=p.show,o=show.offeredByTier,s=show.shownByTier,s3=s[3]||0,admire=g.sandbox.__frogConvoyAdmireFixture();
  console.log(`  tiers offered ${JSON.stringify(o)} shown ${JSON.stringify(s)}; budgets ${show.heldFrames}/${show.slowedFrames}/${show.admireFrames}; admire ${admire.admired}/${admire.gated}`);
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=1))fail(`offered ladder not strictly ordered: ${JSON.stringify(o)}`);
  if(!((s[1]||0)>(s[2]||0)&&(s[2]||0)>(s[3]||0)&&(s[3]||0)>=1))fail(`shown ladder not strictly ordered: ${JSON.stringify(s)}`);
  if(show.heldFrames!==6*s3)fail(`hitstop ${show.heldFrames} != 6*${s3}`);if(show.slowedFrames!==24*s3)fail(`slow ${show.slowedFrames} != 24*${s3}`);if(show.admireFrames!==48*s3)fail(`admire ${show.admireFrames} != 48*${s3}`);
  if(p.stats.admireIntents!==show.admireFrames)fail(`real bot admire intents ${p.stats.admireIntents} != kernel admire frames ${show.admireFrames}`);
  if(admire.admired!=='ADMIRE THE WHOLE FAMILY'||admire.gated==='ADMIRE THE WHOLE FAMILY')fail(`__NO_ADMIRE failed: ${JSON.stringify(admire)}`);
}
{
  const a=bootGame('frog-convoy',{seed:0xfc3003,footer:FOOTER}),b=bootGame('frog-convoy',{seed:0xfc3003,footer:FOOTER});b.sandbox.__NO_ADMIRE=1;
  a.sandbox.__frogConvoyNearApex();b.sandbox.__frogConvoyNearApex();a.frames(80,false);b.frames(80,false);const pa=a.sandbox.__frogConvoyProbe(),pb=b.sandbox.__frogConvoyProbe();
  console.log(`  real directives @80f: stateT ${pa.stateT}/${pb.stateT}, fan ${pa.arrival&&pa.arrival.progress}/${pb.arrival&&pb.arrival.progress}, admire ${pa.stats.admireIntents}/${pb.stats.admireIntents}`);
  if(pa.stateT!==122||pb.stateT!==122)fail(`hold/slow directives did not produce exact stateT 122: ${pa.stateT}/${pb.stateT}`);
  if(!pa.arrival||!pb.arrival||pa.arrival.progress!==32||pb.arrival.progress!==58)fail('bot admire did not independently pause the arrival fan');
  if(pa.stats.admireIntents!==48||pb.stats.admireIntents!==0)fail('__NO_ADMIRE did not gate real apex intent frames');
}
{
  const g=bootGame('frog-convoy',{seed:0xfc3002,footer:FOOTER});g.sandbox.__frogConvoyNearApex();g.frames(140,false);const p=g.sandbox.__frogConvoyProbe(),s3=p.show.shownByTier[3]||0;
  console.log(`  isolated whole-family apex: ${p.show.heldFrames}/${p.show.slowedFrames}/${p.show.admireFrames}, shown ${s3}`);
  if(s3!==1||(p.show.active&&p.show.active.tier===3)||p.show.heldFrames!==6||p.show.slowedFrames!==24||p.show.admireFrames!==48)fail('isolated apex did not drain exact budget');
}

console.log('8) payoff FX is a perfect same-seed simulation no-op');
{
  const a=bootGame('frog-convoy',{seed:0xfc4001,footer:FOOTER}),b=bootGame('frog-convoy',{seed:0xfc4001,footer:FOOTER});b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);
  const pa=a.sandbox.__frogConvoyProbe(),same=a.sandbox.__frogConvoySignature()===b.sandbox.__frogConvoySignature();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} after ${pa.stats.arrivals} arrivals / ${pa.stats.wholeArrivals} apexes / ${pa.stats.sacrifices} sacrifices`);
  if(!same)fail('__NO_PAYOFF_FX changed simulation');if(pa.stats.wholeArrivals<3||pa.stats.sacrifices<1)fail('FX parity proof was vacuous');
}

console.log('9) shared ten-minute soak: moving, happening, and progressing');
{
  const{samples}=runSoak('frog-convoy',{seed:0xfc000,footer:FOOTER,minutes:10}),report=analyzeSoak(samples);console.log('  '+soakLine(report));
  assertSoak('frog-convoy soak',report,{still:5,quiet:5,stall:28,minEvents:1000,minProgress:440},fail);
}

console.log('10) viewer story and skill-profile ablation remain truthful');
{
  const g=bootGame('frog-convoy',{seed:0xfc5001,footer:FOOTER});g.frames(1,true);const v=g.sandbox.__frogConvoyViewerProbe(),p=g.sandbox.__frogConvoyProbe();
  console.log(`  opening "${v.drawn.hud}" / "${v.drawn.tactic}" / "${v.drawn.family}" / "${v.drawn.season}"`);
  if(v.drawn.frame!==p.showFrame||v.drawn.hud!=='FROG CONVOY'||v.drawn.family!=='FAMILY 1/5'||!v.drawn.leaderBox||v.drawn.chainBoxes.length!==1)fail(`opening story receipt is false: ${JSON.stringify(v)}`);
  const perfect=bootGame('frog-convoy',{seed:0xfc000,footer:FOOTER});perfect.sandbox.__NO_LAPSE=1;perfect.frames(36000,false);const pp=perfect.sandbox.__frogConvoyProbe();
  console.log(`  __NO_LAPSE: ${pp.stats.lapses} lapses, ${pp.stats.wholeArrivals} whole arrivals, ${pp.stats.passengerLosses} losses, finite ${pp.finite}`);
  if(pp.stats.lapses!==0||!pp.finite||pp.stats.wholeArrivals<12||pp.stats.arrivals<27)fail('__NO_LAPSE did not restore competent perfect play');
}

console.log(failed?'\nFROG CONVOY EVAL FAILED':'\nFROG CONVOY EVAL PASSED');
process.exit(failed?1:0);
