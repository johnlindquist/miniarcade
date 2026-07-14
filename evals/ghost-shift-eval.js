#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
const{runMotion,analyzeMotion,assertMotion,motionLine}=require('./motion');
const{assertEntertainment}=require('./entertainment');
const AEP=require('./evidence');
let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true};
const source=fs.readFileSync(path.join(__dirname,'..','ghost-shift.html'),'utf8');
// This is source/render evidence, not a self-reported game flag. The planner may
// keep an internal route, but no renderer or HUD surface may expose it.
const noVisiblePath=!source.includes('function drawRoute')&&!source.includes('drawRoute()')&&!/fillText\(['"]ROUTE['"]/.test(source)&&!source.includes('route remains present in representative fixtures');

function dependencyReport(log){
  const groups=new Map();
  for(const entry of log){if(!groups.has(entry.shift))groups.set(entry.shift,[]);groups.get(entry.shift).push(entry)}
  let complete=0,valid=0;
  for(const entries of groups.values()){
    const escape=entries.findIndex(e=>e.kind==='escape');if(escape<0)continue;
    const at=(kind,index)=>entries.findIndex(e=>e.kind===kind&&(index===undefined||e.index===index));
    const s0=at('sigil',0),s1=at('sigil',1),g0=at('gate',0),r0=at('relay',0),r1=at('relay',1),g1=at('gate',1),room1=at('room',1),room2=at('room',2);if(s0<0)continue;complete++;
    const gate0=entries[g0],gate1=entries[g1];
    if(s0>=0&&s1>s0&&g0>=s1&&room1>g0&&r0>=0&&r1>=0&&g1>Math.max(r0,r1)&&room2>g1&&escape>room2&&gate0.plateStage===2&&gate0.relays===0&&gate0.gates===1&&gate1.relays===2&&gate1.gates===2)valid++;
  }
  return{complete,valid};
}

function paceByActor(run){
  const tracks=new Map();
  for(const sample of run.samples)for(const actor of sample.actors){
    let track=tracks.get(actor.id);
    if(!track){track={last:actor,distance:0,frames:0};tracks.set(actor.id,track);continue}
    const distance=Math.hypot(actor.x-track.last.x,actor.y-track.last.y);
    // Room resets can relocate the cast; exclude those cuts from cruising pace.
    if(distance<=20)track.distance+=distance;
    track.frames+=run.step;track.last=actor;
  }
  return Object.fromEntries([...tracks].map(([id,t])=>[id,t.frames?t.distance/t.frames*60:0]));
}

console.log('1) deterministic fixed-step replay and render parity');
{
  const a=bootGame('ghost-shift',{seed:0x6501}),b=bootGame('ghost-shift',{seed:0x6501}),r=bootGame('ghost-shift',{seed:0x6501});
  a.frames(12000,false);b.frames(12000,false);r.frames(12000,true);
  const signature=a.sandbox.__ghostShiftSignature();
  if(signature!==b.sandbox.__ghostShiftSignature())fail('same seed diverged');
  if(signature!==r.sandbox.__ghostShiftSignature())fail('render consumed simulation state');
  console.log('  identical headless/rendered; '+r.counter.calls+' draw calls');
}

console.log('1b) payoff FX no-op, shared intent schema, and hidden computed path');
{
  const a=bootGame('ghost-shift',{seed:0x6502}),b=bootGame('ghost-shift',{seed:0x6502,footer:'globalThis.__NO_PAYOFF_FX=true;'});
  a.frames(18000,false);b.frames(18000,false);
  if(a.sandbox.__ghostShiftSignature()!==b.sandbox.__ghostShiftSignature())fail('payoff FX changed same-seed simulation');
  const fixture=a.sandbox.__ghostShiftIntentFixture(),botKeys=Object.keys(fixture.bot).sort().join(','),humanKeys=Object.keys(fixture.human).sort().join(',');
  if(botKeys!==humanKeys||fixture.human.dx!==1)fail('human/bot intent schema diverged: '+JSON.stringify(fixture));
  if(!noVisiblePath)fail('computed route is wired into the renderer or HUD');
  console.log('  FX signature identical; intent keys '+botKeys+'; computed route has no render/HUD consumer');
}

console.log('1c) ambient evidence is additive, RNG-inert, and signature-neutral');
{
  const a=bootGame('ghost-shift',{seed:0x6503}),b=bootGame('ghost-shift',{seed:0x6503,footer:'globalThis.__NO_EVIDENCE_LEDGER=true;'});
  a.frames(18000,false);b.frames(18000,false);
  const signature=a.sandbox.__ghostShiftSignature(),offSignature=b.sandbox.__ghostShiftSignature();
  const pa=a.sandbox.__ghostShiftProbe(),pb=b.sandbox.__ghostShiftProbe(),ambient=a.sandbox.__ambientProbe(),off=b.sandbox.__ambientProbe();
  if(signature!==offSignature)fail('evidence ledger changed same-seed simulation signature');
  if(JSON.stringify(pa.stats)!==JSON.stringify(pb.stats)||pa.events!==pb.events||pa.progress!==pb.progress)fail('evidence ledger changed natural counters');
  if(a.engine.random()!==b.engine.random())fail('evidence ledger changed engine RNG state');
  if(ambient.stateDigest!==signature||off.stateDigest!==offSignature)fail('ambient state digest diverged from existing signature');
  if(off.ledger.enabled||off.ledger.events.length||off.ledger.serial!==0)fail('__NO_EVIDENCE_LEDGER did not expose an empty disabled ledger');
  console.log('  signatures, RNG, stats, event/progress counters identical; disabled ledger empty');
}

console.log('2) ten-minute authored-room soak: puzzles, pressure, choices, no dead air');
for(const seed of[0x6510,0x6511]){
  const{game,samples}=runSoak('ghost-shift',{seed,minutes:10}),soak=analyzeSoak(samples),p=game.sandbox.__ghostShiftProbe();
  console.log('  '+seed.toString(16)+' '+soakLine(soak));
  assertSoak(seed.toString(16),soak,{still:3,quiet:4,stall:12,minEvents:700,minProgress:250},message=>fail(message));
  const evidence={
    noVisiblePath,
    topology:{rooms:p.level.rooms,branches:p.level.branchCells,maxStraight:Math.max(p.level.maxRun,p.stats.maxStraightRun)},
    puzzle:{transitions:p.stats.keys+p.stats.relays+p.stats.doors,completions:p.stats.escapes},
    agency:{enemyActions:p.stats.engagements,playerResponses:p.stats.pulses+p.stats.dodges},
    decisions:{puzzle:{count:p.stats.puzzleSteps,source:'stats.puzzleSteps'},threat:{count:p.stats.engagements,source:'stats.engagements'},response:{count:p.stats.pulses+p.stats.dodges,source:'stats.pulses+stats.dodges'},combat:{count:p.stats.stuns,source:'stats.stuns'},payoff:{count:p.stats.loot+p.stats.escapes,source:'stats.loot+stats.escapes'}},
    maxDeadAir:p.stats.maxInertFrames
  };
  const ambient=game.sandbox.__ambientProbe(),ledger=ambient.ledger,ledgerReport=AEP.validateEvidence(ledger);
  if(ambient.protocol!==AEP.PROTOCOL||ambient.schema!==1||ambient.game!=='ghost-shift'||ambient.frame.run!==p.runFrame||ambient.frame.show!==p.showFrame||ambient.showFrame!==p.showFrame||ambient.runFrame!==p.runFrame||!ambient.finite)fail(seed.toString(16)+': ambient probe envelope drifted');
  if(ambient.stateSignature!==game.sandbox.__ghostShiftSignature()||ambient.stateDigest!==ambient.stateSignature)fail(seed.toString(16)+': ambient signature aliases differ from the existing simulation signature');
  if(JSON.stringify(ambient.counters)!==JSON.stringify(p.stats)||ambient.serial!==ledger.serial||JSON.stringify(ambient.events)!==JSON.stringify(ledger.events))fail(seed.toString(16)+': ambient counter or ledger aliases drifted');
  if(JSON.stringify(evidence)!==JSON.stringify(ambient.evidence)||JSON.stringify(ambient.entertainment)!==JSON.stringify(evidence))fail(seed.toString(16)+': existing entertainment evidence differs from ambient declaration');
  if(JSON.stringify(ambient.motion)!==JSON.stringify(game.sandbox.__motionProbe())||JSON.stringify(ambient.soak)!==JSON.stringify(game.sandbox.__soakProbe()))fail(seed.toString(16)+': ambient probe changed motion/soak adapters');
  if(JSON.stringify(ambient.topology)!==JSON.stringify(evidence.topology))fail(seed.toString(16)+': ambient topology differs from entertainment topology');
  if(!ledgerReport.ok)fail(seed.toString(16)+': ambient ledger invalid '+ledgerReport.reasons.join(','));
  const bySerial=new Map(ledger.events.map(event=>[event.serial,event])),responses=ledger.events.filter(event=>event.kind==='response'),commits=ledger.events.filter(event=>event.kind==='commit'),payoffs=ledger.events.filter(event=>event.kind==='payoff'),threats=ledger.events.filter(event=>event.kind==='threat');
  if(!responses.length||!commits.length||!payoffs.length||!threats.length)fail(seed.toString(16)+': ambient ledger omitted a causal evidence category');
  if(responses.some(event=>event.actorId!=='courier'||!event.setupSerial||bySerial.get(event.causeSerial)?.kind!=='threat'))fail(seed.toString(16)+': response identity or threat causality drifted');
  if(commits.some(event=>event.actorId!=='courier'||bySerial.get(event.setupSerial)?.kind!=='setup'))fail(seed.toString(16)+': commit identity or setup causality drifted');
  if(payoffs.some(event=>bySerial.get(event.setupSerial)?.kind!=='setup'||!['commit','response'].includes(bySerial.get(event.commitSerial)?.kind)))fail(seed.toString(16)+': payoff causal chain drifted');
  if(threats.some(event=>!/^shift:\d+:drone:\d+$/.test(event.actorId)))fail(seed.toString(16)+': sentry appearance identity drifted');
  const motionIds=ambient.motion.actors.map(actor=>actor.id);
  if(!motionIds.includes('courier')||motionIds.some(id=>id!=='courier'&&!/^drone-\d+$/.test(id)))fail(seed.toString(16)+': motion role IDs changed '+motionIds.join(','));
  const locomotionKinds=new Set(['locomotion','movement','walk','turn','replan','replanning','navigation','path']);
  if(ledger.sources.some(source=>locomotionKinds.has(source.kind))||ledger.events.some(event=>locomotionKinds.has(event.kind)))fail(seed.toString(16)+': ordinary locomotion/replanning received evidence credit');
  const entertainment=assertEntertainment(seed.toString(16),evidence,{
    minRooms:3,minBranches:70,maxStraight:9,minPuzzleTransitions:190,minPuzzleCompletions:28,
    minEnemyActions:350,minPlayerResponses:600,requiredDecisionKinds:['puzzle','threat','response','combat','payoff'],
    minPerDecisionKind:100,maxDeadAir:200,deadAirUnit:'simulation frames'
  },message=>fail(message));
  const dependencies=dependencyReport(p.puzzles.log);
  if(dependencies.complete<12||dependencies.valid!==dependencies.complete)fail(seed.toString(16)+': puzzle dependency order drifted '+JSON.stringify(dependencies));
  if(p.stats.puzzleSteps<200||p.stats.relays<65||p.stats.doors<65)fail(seed.toString(16)+': weak chamber state change '+JSON.stringify(p.stats));
  // Ten 10-minute seeds measured 159..168 pulses, 465..546 physical evades,
  // and 110..126 separately observed near misses. Keep each signal honest.
  if(p.stats.engagements<350||p.stats.cutoffs<100||p.stats.pulses<150||p.stats.dodges<440||p.stats.nearMisses<100)fail(seed.toString(16)+': enemies/player did not visibly adapt '+JSON.stringify(p.stats));
  if(p.stats.caught<20||p.stats.caught>90)fail(seed.toString(16)+': challenge outside measured watchability band '+p.stats.caught);
  console.log('    entertainment '+JSON.stringify(entertainment.report)+'; dependencies '+dependencies.valid+'/'+dependencies.complete);
}

console.log('3) tactical planning A/B: same seeds survive active threat-blind play');
let smartScore=0,baseScore=0,wins=0,survivalWins=0;
for(const seed of[0x6520,0x6521,0x6522,0x6523,0x6524,0x6525]){
  const a=bootGame('ghost-shift',{seed}),b=bootGame('ghost-shift',{seed,footer:'globalThis.__NO_THREAT_PLAN=true;'});
  a.frames(18000,false);b.frames(18000,false);
  const pa=a.sandbox.__ghostShiftProbe(),pb=b.sandbox.__ghostShiftProbe();
  const score=p=>p.stats.escapes*30+p.stats.loot*3-p.stats.caught*4+p.stats.pulses*.2,sa=score(pa),sb=score(pb);
  smartScore+=sa;baseScore+=sb;if(sa>sb)wins++;if(pa.stats.caught*2.5<pb.stats.caught)survivalWins++;
    // Six 5-minute smart runs measured 82..84 pulses, 245..277 physical
    // evades, and 55..77 cutoffs after near misses were split out.
    if(pa.stats.pulses<75||pa.stats.dodges<230||pa.stats.cutoffs<45)fail(seed.toString(16)+': tactical policy became inactive');
  console.log('  '+seed.toString(16)+': tactical '+sa.toFixed(1)+' vs active blind '+sb.toFixed(1)+'; catches '+pa.stats.caught+'/'+pb.stats.caught+', escapes '+pa.stats.escapes+'/'+pb.stats.escapes);
}
console.log('  aggregate '+smartScore.toFixed(1)+' vs '+baseScore.toFixed(1)+', score wins '+wins+'/6, survival wins '+survivalWins+'/6');
if(smartScore<=baseScore||wins<5||survivalWins<5)fail('threat planning did not clearly beat the active same-seed baseline');

console.log('3b) shared motion contract: active cast keeps moving or emotes briefly');
{
  const run=runMotion('ghost-shift',{seed:0x6526,minutes:10}),motion=analyzeMotion(run,{requiredIds:['courier']});
  const pace=paceByActor(run);
  assertMotion('6526',motion,message=>fail(message));
  // Ten-seed sweep 0x6526..0x652f measured 78.2..79.4 px/s for the
  // courier and 34.4..40.7 px/s for sentries after reset cuts were removed.
  if(pace.courier<75)fail('6526: courier pace '+pace.courier.toFixed(1)+'px/s below 75px/s floor');
  for(const[id,speed]of Object.entries(pace))if(id.startsWith('drone-')&&speed<31)fail('6526: '+id+' pace '+speed.toFixed(1)+'px/s below 31px/s floor');
  console.log('  '+motionLine(motion)+'; '+motion.actors.map(a=>a.id+' bare '+a.worstBareStillFrames+'f / emote '+a.worstEmoteStillFrames+'f / share '+(a.emoteStillShare*100).toFixed(1)+'%').join('; '));
  console.log('  pace '+Object.entries(pace).map(([id,speed])=>id+' '+speed.toFixed(1)+'px/s').join('; '));
}

console.log('4) telegraphed lockdown acts and exact show budgets');
{
  const a=bootGame('ghost-shift',{seed:0x6530}),b=bootGame('ghost-shift',{seed:0x6530,footer:'globalThis.__NO_ACTS=true;'});
  let divergence=-1,phase='';
  for(let frame=1;frame<=5000;frame++){
    a.frames(1,false);b.frames(1,false);
    if(a.sandbox.__ghostShiftSignature()!==b.sandbox.__ghostShiftSignature()){divergence=frame;phase=a.sandbox.__ghostShiftProbe().act.phase;break}
  }
  if(divergence<0||phase!=='warn')fail('first act divergence did not occur during warning; frame '+divergence+' phase '+phase);
  a.frames(10500,false);b.frames(10500,false);
  const p=a.sandbox.__ghostShiftProbe(),notes=p.actNotes,tiers=p.show.shownByTier;
  if(notes.length<4)fail('lockdown warning/land notes missing');
  if(p.stats.heldFrames!==6*(tiers[3]||0))fail('apex hold budget drifted');
  if(p.stats.slowedFrames>24*(tiers[3]||0))fail('apex slow budget drifted');
  if(!((tiers[1]||0)>(tiers[2]||0)&&(tiers[2]||0)>(tiers[3]||0)))fail('tier frequencies not strictly ordered '+JSON.stringify(tiers));
  const admire=a.sandbox.__ghostShiftAdmireFixture();
  if(admire.admired.target!=='ADMIRE'||admire.gated.target==='ADMIRE')fail('__NO_ADMIRE did not gate bot pause');
  console.log('  first divergence frame '+divergence+' in warning; '+notes.length+' notes; tiers '+JSON.stringify(tiers));
}

if(failed){console.error('\nGHOST SHIFT EVALS FAILED');process.exit(1)}
console.log('\nGHOST SHIFT EVALS PASSED');
