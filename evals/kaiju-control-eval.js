#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true};
const score=p=>{const s=p.stats;return s.evacuated*5+s.districtsSaved*40+s.decoyHits*12+s.repairs*4-
  s.buildingsLost*25-s.casualties*8};
const band=(label,value,min,max)=>{if(value<min||value>max)fail(`${label} ${value} outside ${min}..${max}`)};

console.log('1) deterministic fixed-step replay and render parity');
{
  const a=bootGame('kaiju-control',{seed:0x6b4301});
  const b=bootGame('kaiju-control',{seed:0x6b4301});
  const rendered=bootGame('kaiju-control',{seed:0x6b4301});
  a.frames(15000,false);b.frames(15000,false);rendered.frames(15000,true);
  const signature=a.sandbox.__kaijuControlSignature();
  if(signature!==b.sandbox.__kaijuControlSignature())fail('same seed diverged');
  if(signature!==rendered.sandbox.__kaijuControlSignature())fail('render consumed simulation state or RNG');
  console.log(`  identical headless/rendered; ${rendered.counter.calls} canvas calls`);
}

console.log('1b) payoff FX is a simulation no-op; planner is pure and RNG-inert');
{
  const a=bootGame('kaiju-control',{seed:0x6b4302});
  const noFx=bootGame('kaiju-control',{seed:0x6b4302,footer:'globalThis.__NO_PAYOFF_FX=1;'});
  a.frames(24000,false);noFx.frames(24000,false);
  if(a.sandbox.__kaijuControlSignature()!==noFx.sandbox.__kaijuControlSignature())
    fail('__NO_PAYOFF_FX changed same-seed simulation');

  const planGame=bootGame('kaiju-control',{seed:0x6b4303});
  const control=bootGame('kaiju-control',{seed:0x6b4303});
  const fixture=planGame.sandbox.__kaijuControlPlannerFixture();
  if(!fixture.pure||!fixture.repeat||!fixture.finite)fail('triage planner mutated state or was not repeatable');
  const afterPlan=planGame.sandbox.__kaijuControlNextRandom();
  const untouched=control.sandbox.__kaijuControlNextRandom();
  if(afterPlan!==untouched)fail('triage planner consumed engine RNG');

  const intents=planGame.sandbox.__kaijuControlIntentFixture();
  if(JSON.stringify(intents.aiKeys)!==JSON.stringify(intents.humanKeys)||intents.human.next<0)
    fail('human/bot intent schemas or normalized keyboard routing diverged: '+JSON.stringify(intents));
  console.log('  signatures identical; planner repeatable; intent keys '+intents.aiKeys.join(','));
}

console.log('2) two independent ten-minute autoplay soaks');
const soakRuns=[];
// Calibrated from thirty fixed ten-minute smart-policy seeds (0x6c000+i*137):
// evac 72, attacks 3..11, decoy hits 21..27, repairs 3..15, act saves 4..6,
// lapses 1..9, events 111..124, progress 101..109. Floors/ceilings retain
// measured margin without erasing the intended drama band.
for(const seed of[0x6bc01,0x6bc02]){
  const{game,samples}=runSoak('kaiju-control',{seed,minutes:10});
  const report=analyzeSoak(samples),p=game.sandbox.__kaijuControlProbe(),s=p.stats;
  soakRuns.push({game,report,p});
  console.log(`  ${seed.toString(16)} ${soakLine(report)} · evac ${s.evacuated}, attacks ${s.attacks}, diversions ${s.decoyHits}, act saves ${s.actSaves}`);
  assertSoak(seed.toString(16),report,{still:4,quiet:20,stall:22,minEvents:95,minProgress:88},fail);
  if(!p.finite)fail(seed.toString(16)+': non-finite state');
  band(seed.toString(16)+' districts',s.districts,5,5);
  band(seed.toString(16)+' districts saved',s.districtsSaved,5,5);
  band(seed.toString(16)+' civilians evacuated',s.evacuated,70,72);
  band(seed.toString(16)+' kaiju attacks',s.attacks,2,14);
  band(seed.toString(16)+' decoy hits',s.decoyHits,18,30);
  band(seed.toString(16)+' repairs',s.repairs,2,18);
  band(seed.toString(16)+' act saves',s.actSaves,3,6);
  band(seed.toString(16)+' honest lapses',s.lapses,1,11);
  band(seed.toString(16)+' activity events',s.events,105,130);
  band(seed.toString(16)+' progress marks',s.progress,96,115);
  band(seed.toString(16)+' building losses',s.buildingsLost,0,1);
  band(seed.toString(16)+' casualties',s.casualties,0,2);
  if(s.invisibleRescues!==0)fail(seed.toString(16)+': invisible rescue fired');
}

console.log('3) forecast triage A/B beats the honest reactive baseline');
let smartTotal=0,baseTotal=0,wins=0;
for(const seed of[0x6b700,0x6b7ad,0x6b85a,0x6b907,0x6b9b4,0x6ba61]){
  const smart=bootGame('kaiju-control',{seed});
  const base=bootGame('kaiju-control',{seed,footer:'globalThis.__NO_TRIAGE_PLAN=1;'});
  smart.frames(18000,false);base.frames(18000,false);
  const a=smart.sandbox.__kaijuControlProbe(),b=base.sandbox.__kaijuControlProbe(),sa=score(a),sb=score(b);
  smartTotal+=sa;baseTotal+=sb;if(sa>sb)wins++;
  if(b.stats.evacuated<28||b.stats.events<50)fail(seed.toString(16)+': baseline is not a functioning policy');
  console.log(`  ${seed.toString(16)} smart ${sa} vs baseline ${sb} · evac ${a.stats.evacuated}/${b.stats.evacuated}, diversions ${a.stats.decoyHits}/${b.stats.decoyHits}, casualties ${a.stats.casualties}/${b.stats.casualties}`);
}
console.log(`  aggregate ${smartTotal} vs ${baseTotal}; wins ${wins}/6`);
if(wins<5||smartTotal<=baseTotal*1.12)fail('forecast triage did not clearly win the paired panel');

console.log('4) acts change the physical plan during the exact 240f warning');
{
  const active=bootGame('kaiju-control',{seed:0x6bd10});
  const ablated=bootGame('kaiju-control',{seed:0x6bd10,footer:'globalThis.__NO_ACTS=1;'});
  active.sandbox.__kaijuControlActFixture();ablated.sandbox.__kaijuControlActFixture();
  if(active.sandbox.__kaijuControlSignature()!==ablated.sandbox.__kaijuControlSignature())
    fail('act fixture differed before warning');
  let first=-1;
  for(let frame=1;frame<240;frame++){
    active.frames(1,false);ablated.frames(1,false);
    if(first<0&&active.sandbox.__kaijuControlPhysical()!==ablated.sandbox.__kaijuControlPhysical())first=frame;
  }
  const warned=active.sandbox.__kaijuControlProbe();
  if(first<1||warned.act.phase!=='warn')fail('act did not physically reroute CIVIC-1 before land');
  active.frames(2,false);ablated.frames(2,false);
  const landed=active.sandbox.__kaijuControlProbe(),off=ablated.sandbox.__kaijuControlProbe();
  if(landed.act.phase!=='live'||off.act.notes.length!==0)fail('act land/ablation contract failed');
  const warning=landed.act.notes.find(n=>n.kind==='act-warning'),land=landed.act.notes.find(n=>n.kind==='act-land');
  if(!warning||!land||land.at-warning.at!==240||warning.landsAt!==land.at)
    fail('warning/land pair did not span exactly 240 viewer frames');
  console.log(`  first physical divergence +${first}f; warning ${warning&&warning.at} -> land ${land&&land.at}`);
}

console.log('5) SHOW ladder order, exact apex budgets, admire and lapse gates');
for(const{p}of soakRuns){
  const t=p.show.shownByTier,s3=t[3]||0;
  if(!((t[1]||0)>(t[2]||0)&&(t[2]||0)>s3))fail('tier frequencies not strictly ordered '+JSON.stringify(t));
  if(p.show.heldFrames!==6*s3)fail(`heldFrames ${p.show.heldFrames} !== 6 * ${s3}`);
  if(p.show.slowedFrames!==24*s3)fail(`slowedFrames ${p.show.slowedFrames} !== 24 * ${s3}`);
  const notes=p.act.notes;
  for(let i=0;i<notes.length;i+=2){const warn=notes[i],land=notes[i+1];if(!land||warn.kind!=='act-warning'||land.kind!=='act-land'||warn.id!==land.id||land.at-warn.at!==240)
    fail('long-run act notes are not exact warning/land pairs: '+JSON.stringify([warn,land]));}
}
{
  const g=bootGame('kaiju-control',{seed:0x6be10});
  const admire=g.sandbox.__kaijuControlAdmireFixture();
  if(admire.admired.targetKind!=='admire'||admire.gated.targetKind==='admire')fail('__NO_ADMIRE did not gate the bot pause');
  const noLapse=bootGame('kaiju-control',{seed:0x6be11,footer:'globalThis.__NO_LAPSE=1;'});
  noLapse.frames(18000,false);
  if(noLapse.sandbox.__kaijuControlProbe().stats.lapses!==0)fail('__NO_LAPSE still recorded lapses');
  console.log('  tiers and budgets exact; admire and lapse switches effective');
}

if(failed){console.error('\nKAIJU CONTROL EVALS FAILED');process.exit(1)}
console.log('\nKAIJU CONTROL EVALS PASSED');
