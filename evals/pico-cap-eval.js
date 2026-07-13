#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
const{assertEntertainment}=require('./entertainment');
const{runMotion,analyzeMotion,assertMotion,motionLine}=require('./motion');
const{validateEvidence,deriveEvidence}=require('./evidence');
let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true};
const source=fs.readFileSync(path.join(__dirname,'..','pico-cap.html'),'utf8');
const noVisiblePath=!/\bfunction\s+drawRoute\b/.test(source)&&!/\bdrawRoute\s*\(/.test(source)&&!/\.setLineDash\s*\(/.test(source)&&!/routePoints\s*:/.test(source);
const EVIDENCE_SOURCES={
  'room-read':'setup','room-choice':'commit','shrink-choice':'commit','commit-briar':'commit',
  'enemy-tell':'threat','enemy-engage':'threat',dodge:'response',parry:'response',fight:'commit',
  'sun-key':'payoff','gate-open':'payoff','shrine-ready':'payoff','room-complete':'payoff'
};
const HERO_SOURCES=new Set(['room-choice','shrink-choice','commit-briar','dodge','parry','fight']);
function entertainmentOf(p){const kind=key=>p.decisionKinds[key]||0;return{
  noVisiblePath,
  topology:{rooms:3,branches:6,maxStraight:p.stats.maxStraightSteps},
  puzzle:{transitions:p.stats.gatesOpened,completions:p.stats.glades},
  agency:{enemyActions:p.stats.charges,playerResponses:p.stats.chargeDodges+p.stats.parries},
  decisions:{
    puzzle:{count:kind('room-read')+kind('room-choice')+kind('shrink-choice')+kind('commit-briar'),source:'room-read+room-choice+shrink-choice+commit-briar'},
    threat:{count:kind('enemy-tell')+kind('enemy-engage'),source:'enemy-tell+enemy-engage'},
    response:{count:kind('dodge')+kind('parry'),source:'dodge+parry'},
    combat:{count:kind('fight'),source:'fight'},
    payoff:{count:kind('sun-key')+kind('gate-open')+kind('shrine-ready')+kind('room-complete'),source:'sun-key+gate-open+shrine-ready+room-complete'}
  },
  maxDeadAir:p.stats.maxTravelWithoutDecision
}}
function checkAmbient(game,p,label){const ambient=game.sandbox.__ambientProbe(),ledger=ambient.ledger;
  if(ambient.protocol!=='ambient-evidence/v1'||ambient.schema!==1||ambient.game!=='pico-cap')fail(label+': ambient envelope drifted '+JSON.stringify({protocol:ambient.protocol,schema:ambient.schema,game:ambient.game}));
  if(!ambient.frame||ambient.frame.run!==p.runFrame||ambient.frame.show!==p.showFrame||ambient.runFrame!==p.runFrame||ambient.showFrame!==p.showFrame||ambient.stateSignature!==game.sandbox.__picoCapSignature()||ambient.stateDigest!==ambient.stateSignature||!ambient.finite)fail(label+': ambient frame/signature/finite mismatch');
  if(JSON.stringify(ambient.soak)!==JSON.stringify(game.sandbox.__soakProbe())||JSON.stringify(ambient.motion)!==JSON.stringify(game.sandbox.__motionProbe()))fail(label+': ambient soak/motion adapters diverged');
  if(JSON.stringify(ambient.counters)!==JSON.stringify(p.stats))fail(label+': ambient counters diverged from authoritative stats');
  const expectedEntertainment=entertainmentOf(p);if(JSON.stringify(ambient.evidence)!==JSON.stringify(expectedEntertainment)||JSON.stringify(ambient.entertainment)!==JSON.stringify(expectedEntertainment)||JSON.stringify(ambient.topology)!==JSON.stringify(expectedEntertainment.topology))fail(label+': ambient entertainment evidence drifted '+JSON.stringify({expected:expectedEntertainment,actual:ambient.evidence}));
  if(!ledger||ambient.serial!==ledger.serial||JSON.stringify(ambient.events)!==JSON.stringify(ledger.events))fail(label+': ambient ledger aliases drifted');
  const report=validateEvidence(ledger);for(const violation of report.violations)fail(label+': ['+violation.code+'] '+violation.message);
  if(!ledger.enabled||ledger.dropped!==0||ledger.events.length<100)fail(label+': natural evidence ledger was disabled, truncated, or empty');
  const sources=Object.fromEntries(ledger.sources.map(item=>[item.id,item]));
  if(Object.keys(sources).sort().join(',')!==Object.keys(EVIDENCE_SOURCES).sort().join(','))fail(label+': evidence source registry drifted '+Object.keys(sources).sort().join(','));
  for(const[id,kind]of Object.entries(EVIDENCE_SOURCES)){const item=sources[id];if(!item||item.kind!==kind)fail(label+': source '+id+' kind '+(item&&item.kind)+' != '+kind);if(HERO_SOURCES.has(id)&&(item.actorId!=='hero'||item.stableActor!==true))fail(label+': source '+id+' lost stable hero identity')}
  const derived=report.ok?deriveEvidence(ledger):null;if(derived)for(const id of Object.keys(EVIDENCE_SOURCES))if((derived.countsBySource[id]||0)!==(p.decisionKinds[id]||0))fail(label+': source '+id+' count '+(derived.countsBySource[id]||0)+' != decision '+(p.decisionKinds[id]||0));
  const bySerial=new Map(ledger.events.map(event=>[event.serial,event])),banned=/locomotion|movement|walk|turn|route|replan|navigation|path/i;
  for(const event of ledger.events){if(banned.test(event.source)||banned.test(event.kind))fail(label+': locomotion/replan received evidence credit '+event.source+'/'+event.kind);if(!Number.isFinite(event.showFrame)||!Number.isFinite(event.runFrame)||event.frame<event.showFrame||event.frame>=event.showFrame+1)fail(label+': serialized evidence lost its actual frame payload');if(HERO_SOURCES.has(event.source)&&event.actorId!=='hero')fail(label+': '+event.source+' laundered hero identity '+event.actorId);
    if(event.kind==='threat'&&!/^glade:\d+:gnawer:\d+$/.test(event.actorId))fail(label+': threat lost ledger appearance identity '+event.actorId);
    if(event.kind==='response'){const cause=bySerial.get(event.causeSerial);if(!cause||cause.kind!=='threat'||cause.frame>=event.frame)fail(label+': response '+event.serial+' lacks a prior threat');if(event.actorId!=='hero'||!/^glade:\d+:gnawer:\d+$/.test(event.enemyActorId)||event.causeKey!==event.enemyActorId+':charge:'+event.chargeSerial)fail(label+': response '+event.serial+' lost chargeSerial causality')}
  }
  return ambient;
}

console.log('1) deterministic fixed-step replay and render parity');
{
  const a=bootGame('pico-cap',{seed:0x9c51}),b=bootGame('pico-cap',{seed:0x9c51}),r=bootGame('pico-cap',{seed:0x9c51});
  a.frames(12000,false);b.frames(12000,false);r.frames(12000,true);
  const signature=a.sandbox.__picoCapSignature();
  if(signature!==b.sandbox.__picoCapSignature())fail('same seed diverged');
  if(signature!==r.sandbox.__picoCapSignature())fail('render consumed simulation state');
  console.log('  identical headless/rendered; '+r.counter.calls+' draw calls');
}

console.log('1b) payoff FX no-op, shared intent schema, and seed-varied lapses');
{
  const a=bootGame('pico-cap',{seed:0x9c52}),b=bootGame('pico-cap',{seed:0x9c52,footer:'globalThis.__NO_PAYOFF_FX=true;'}),lapse=bootGame('pico-cap',{seed:0x9c53}),gated=bootGame('pico-cap',{seed:0x9c53,footer:'globalThis.__NO_LAPSE=true;'});
  a.frames(18000,false);b.frames(18000,false);lapse.frames(18000,false);gated.frames(18000,false);
  if(a.sandbox.__picoCapSignature()!==b.sandbox.__picoCapSignature())fail('payoff FX changed same-seed simulation');
  const pa=lapse.sandbox.__picoCapProbe(),pc=gated.sandbox.__picoCapProbe();
  if(pa.stats.lapses<1)fail('skill-profile daydreams never fired: '+pa.stats.lapses);
  if(pc.stats.lapses!==0)fail('__NO_LAPSE did not silence lapses: '+pc.stats.lapses);
  if(lapse.sandbox.__picoCapSignature()===gated.sandbox.__picoCapSignature())fail('__NO_LAPSE was a sim no-op');
  const fixture=a.sandbox.__picoCapIntentFixture(),botKeys=Object.keys(fixture.bot).sort().join(','),humanKeys=Object.keys(fixture.human).sort().join(',');
  if(botKeys!==humanKeys||fixture.human.dx!==1)fail('human/bot intent schema diverged: '+JSON.stringify(fixture));
  console.log('  FX signature identical; '+pa.stats.lapses+' lapses (0 gated); intent keys '+botKeys);
}

console.log('1c) Ambient Evidence ledger is a same-seed simulation and RNG no-op');
{
  const seed=0x9c54,a=bootGame('pico-cap',{seed}),b=bootGame('pico-cap',{seed,footer:'globalThis.__NO_EVIDENCE_LEDGER=true;'});a.frames(18000,false);b.frames(18000,false);
  const pa=a.sandbox.__picoCapProbe(),pb=b.sandbox.__picoCapProbe(),sa=a.sandbox.__picoCapSignature(),sb=b.sandbox.__picoCapSignature(),ra=a.sandbox.__engine.random(),rb=b.sandbox.__engine.random(),on=a.sandbox.__ambientProbe(),off=b.sandbox.__ambientProbe();
  if(sa!==sb)fail('__NO_EVIDENCE_LEDGER changed the same-seed signature');if(ra!==rb)fail('__NO_EVIDENCE_LEDGER changed RNG state');if(JSON.stringify(pa.stats)!==JSON.stringify(pb.stats))fail('__NO_EVIDENCE_LEDGER changed stats');if(JSON.stringify(pa.decisionKinds)!==JSON.stringify(pb.decisionKinds))fail('__NO_EVIDENCE_LEDGER changed decisionKinds');
  if(JSON.stringify(on.evidence)!==JSON.stringify(off.evidence))fail('__NO_EVIDENCE_LEDGER changed the entertainment evidence aggregate');if(!on.ledger.enabled||on.ledger.events.length<100)fail('normal evidence run did not retain a natural ledger');if(off.ledger.enabled||off.ledger.events.length||off.ledger.serial!==0||off.ledger.dropped!==0||off.serial!==0||off.events.length)fail('__NO_EVIDENCE_LEDGER did not expose empty disabled ledger aliases');
  console.log('  signature/stats/decisions/evidence identical; next RNG '+ra.toFixed(8)+'; '+on.ledger.events.length+' observations vs 0 gated');
}

console.log('2) authored Zelda-room topology is solvable and never renders the planner');
{
  const game=bootGame('pico-cap',{seed:0x9c70}),layouts=new Set(),receipts=[];
  let lastGlade=0;
  for(let frame=0;frame<12000&&layouts.size<4;frame++){
    const p=game.sandbox.__picoCapProbe();
    if(p.glade!==lastGlade){
      const fixture=game.sandbox.__picoCapPuzzleFixture();receipts.push({glade:p.glade,...fixture});layouts.add(fixture.layoutSignature);lastGlade=p.glade;
      if(!fixture.solvable)fail('glade '+p.glade+' authored state is not solvable');
      if(fixture.rooms!==3||fixture.gateNeeds.join(',')!=='1,2')fail('glade '+p.glade+' lost three-room 1/2-key progression');
      if(fixture.choices.some(choice=>choice.join(',')!=='BRIAR,CRACK'))fail('glade '+p.glade+' lost crack/briar route choice '+JSON.stringify(fixture.choices));
    }
    game.frames(1,false);
  }
  if(layouts.size<4)fail('four biome room compositions were not structurally distinct: '+layouts.size);
  if(!noVisiblePath)fail('computed navigation path still has a renderer/probe surface');
  console.log('  4/4 distinct solvable layouts; 3 rooms, 6 route solutions, gates 1 -> 2; path overlay absent');
}

console.log('3) natural ten-minute panel proves puzzle pace, enemy agency, and no dead walking');
{
  const panel=[];
  for(const seed of[0x9c61,0x9c62]){
    const{game,samples}=runSoak('pico-cap',{seed,minutes:10}),soak=analyzeSoak(samples),p=game.sandbox.__picoCapProbe(),s=p.stats,ambient=checkAmbient(game,p,seed.toString(16));
    console.log('  '+seed.toString(16)+' '+soakLine(soak)+'; rooms '+s.glades+', keys '+s.crackKeys+'/'+s.briarKeys+' crack/briar, charges '+s.charges+', dodge/parry '+s.chargeDodges+'/'+s.parries+', straight '+s.maxStraightSteps+', dead-air '+s.maxTravelWithoutDecision+' steps; ledger '+ambient.ledger.events.length);
    assertSoak(seed.toString(16),soak,{still:3,quiet:5,stall:45,minEvents:1800,minProgress:180},message=>fail(message));
    if(!p.finite)fail(seed.toString(16)+': non-finite state');
    if(s.glades<24||s.glades>40)fail(seed.toString(16)+': room completions outside measured band '+s.glades);
    if(s.shards<72||s.shards>120)fail(seed.toString(16)+': sun-key pace outside measured band '+s.shards);
    if(s.crackKeys<20||s.briarKeys<45)fail(seed.toString(16)+': both room solutions not exercised '+s.crackKeys+'/'+s.briarKeys);
    if(s.gatesOpened<48||s.roomReads<80)fail(seed.toString(16)+': weak puzzle progression gates/reads '+s.gatesOpened+'/'+s.roomReads);
    if(s.charges<60||s.charges>110||s.chargeDodges<30||s.parries<40)fail(seed.toString(16)+': charge drama outside measured band '+s.charges+' actions, '+s.chargeDodges+'/'+s.parries+' responses');
    if(s.slashes<90||s.squishes<25||s.squishes>75)fail(seed.toString(16)+': combat drama outside measured band slash/squish '+s.slashes+'/'+s.squishes);
    if(s.maxStraightSteps>7||s.maxTravelWithoutDecision>8)fail(seed.toString(16)+': inert traversal returned straight/dead-air '+s.maxStraightSteps+'/'+s.maxTravelWithoutDecision);
    panel.push(p);
  }
  const sum=key=>panel.reduce((total,p)=>total+(p.stats[key]||0),0),kind=key=>panel.reduce((total,p)=>total+(p.decisionKinds[key]||0),0);
  const evidence={
    noVisiblePath,
    topology:{rooms:3,branches:6,maxStraight:Math.max(...panel.map(p=>p.stats.maxStraightSteps))},
    puzzle:{transitions:sum('gatesOpened'),completions:sum('glades')},
    agency:{enemyActions:sum('charges'),playerResponses:sum('chargeDodges')+sum('parries')},
    decisions:{
      puzzle:{count:kind('room-read')+kind('room-choice')+kind('shrink-choice')+kind('commit-briar'),source:'room-read+room-choice+shrink-choice+commit-briar'},
      threat:{count:kind('enemy-tell')+kind('enemy-engage'),source:'enemy-tell+enemy-engage'},
      response:{count:kind('dodge')+kind('parry'),source:'dodge+parry'},
      combat:{count:kind('fight'),source:'fight'},
      payoff:{count:kind('sun-key')+kind('gate-open')+kind('shrine-ready')+kind('room-complete'),source:'sun-key+gate-open+shrine-ready+room-complete'}
    },
    maxDeadAir:Math.max(...panel.map(p=>p.stats.maxTravelWithoutDecision))
  };
  const receipt=assertEntertainment('PICO CAP natural panel',evidence,{minRooms:3,minBranches:6,maxStraight:7,minPuzzleTransitions:96,minPuzzleCompletions:48,minEnemyActions:120,minPlayerResponses:140,requiredDecisionKinds:['puzzle','threat','response','combat','payoff'],minPerDecisionKind:50,maxDeadAir:8,deadAirUnit:'hero tile steps'},fail);
  console.log('  entertainment receipt '+JSON.stringify(receipt.report));
}

console.log('3b) shared motion contract: watched actors move within half a second and Pico carries pace');
{
  for(const seed of[0x9c61,0x9c62]){
    const run=runMotion('pico-cap',{seed,minutes:10}),motion=analyzeMotion(run,{requiredIds:['hero']}),heroSamples=run.samples.map(sample=>sample.actors.find(actor=>actor.id==='hero')).filter(Boolean);
    let physicalPairs=0,movingPairs=0,physicalDistance=0;
    for(let i=1;i<heroSamples.length;i++){
      const distance=Math.hypot(heroSamples[i].x-heroSamples[i-1].x,heroSamples[i].y-heroSamples[i-1].y);
      if(distance>20)continue; // glade resets are scene changes, not physical carry
      physicalPairs++;if(distance>.5){movingPairs++;physicalDistance+=distance}
    }
    const movingShare=physicalPairs?movingPairs/physicalPairs:0,meanCarry=movingPairs?physicalDistance/movingPairs:0,pace=physicalPairs?physicalDistance/(physicalPairs*run.step):0,hero=motion.actors.find(actor=>actor.id==='hero');
    console.log('  '+seed.toString(16)+' '+motionLine(motion)+'; hero bare '+hero.worstBareStillFrames+'f / emote '+hero.worstEmoteStillFrames+'f / share '+(hero.emoteStillShare*100).toFixed(1)+'%; moving '+(movingShare*100).toFixed(1)+'%, carry '+meanCarry.toFixed(2)+'px, pace '+pace.toFixed(3)+'px/f');
    assertMotion(seed.toString(16),motion,message=>fail(message));
    // Six 10-minute seeds measured 80.7..81.4% moving, 4.72..4.81px carry,
    // and .764..783px/f. These floors retain margin without admitting a slow glide.
    if(movingShare<.75||meanCarry<4.5||pace<.70)fail(seed.toString(16)+': physical pace regressed '+JSON.stringify({movingShare,meanCarry,pace}));
  }
}

console.log('4) size-and-threat planner A/B beats a working longest-route baseline');
{
  let smart=0,baseline=0,wins=0;
  for(const seed of[0x9c20,0x9c21,0x9c22,0x9c23,0x9c24,0x9c25]){
    const a=bootGame('pico-cap',{seed}),b=bootGame('pico-cap',{seed,footer:'globalThis.__NO_SIZE_PLAN=true;'});a.frames(18000,false);b.frames(18000,false);
    const pa=a.sandbox.__picoCapProbe(),pb=b.sandbox.__picoCapProbe();
    const score=p=>p.stats.glades*50+p.stats.shards*4+p.stats.chargeDodges*2+p.stats.parries-p.stats.squishes*3,sa=score(pa),sb=score(pb);
    smart+=sa;baseline+=sb;if(sa>sb)wins++;
    console.log('  '+seed.toString(16)+': tactical '+sa+' vs baseline '+sb+'; rooms '+pa.stats.glades+'/'+pb.stats.glades+', squishes '+pa.stats.squishes+'/'+pb.stats.squishes);
    if(pb.stats.glades<5)fail(seed.toString(16)+': baseline stopped functioning');
  }
  console.log('  aggregate '+smart+' vs '+baseline+', wins '+wins+'/6');
  if(smart<=baseline*1.35||wins<5)fail('room tactics did not clearly win paired panel');
}

console.log('5) telegraphed storm acts and exact show budgets');
{
  const a=bootGame('pico-cap',{seed:0x9c30}),b=bootGame('pico-cap',{seed:0x9c30,footer:'globalThis.__NO_ACTS=true;'});let warnAt=-1,divergeAt=-1,landAt=-1;
  for(let frame=1;frame<=6000&&landAt<0;frame++){
    a.frames(1,false);b.frames(1,false);const p=a.sandbox.__picoCapProbe();
    if(warnAt<0&&p.act.phase==='warn')warnAt=frame;if(divergeAt<0&&a.sandbox.__picoCapSignature()!==b.sandbox.__picoCapSignature())divergeAt=frame;if(p.act.phase==='live')landAt=frame;
  }
  if(warnAt<0||landAt<0)fail('storm never telegraphed/landed');
  if(divergeAt<warnAt)fail('act A/B diverged before warning');
  if(divergeAt<0||divergeAt>=landAt)fail('act did not change behavior before landing');
  a.frames(30000,false);const p=a.sandbox.__picoCapProbe(),notes=p.actNotes,t=p.show.shownByTier;
  if(notes.filter(n=>n.kind==='act-warning').length<2||notes.filter(n=>n.kind==='act-land').length<2)fail('acts did not recur in warning/land pairs');
  if(p.stats.heldFrames!==6*(t[3]||0))fail('apex hold budget drifted');
  if(p.stats.slowedFrames>24*(t[3]||0))fail('apex slow budget drifted');
  if(!((t[1]||0)>(t[2]||0)&&(t[2]||0)>(t[3]||0)))fail('tier frequencies not strictly ordered '+JSON.stringify(t));
  const admire=a.sandbox.__picoCapAdmireFixture();if(admire.admired.target!=='ADMIRE'||admire.gated.target==='ADMIRE')fail('__NO_ADMIRE did not gate bot pause');
  console.log('  warn@'+warnAt+' diverge@'+divergeAt+' land@'+landAt+'; '+notes.length+' notes; tiers '+JSON.stringify(t));
}

if(failed){console.error('\nPICO CAP EVALS FAILED');process.exit(1)}
console.log('\nPICO CAP EVALS PASSED');
