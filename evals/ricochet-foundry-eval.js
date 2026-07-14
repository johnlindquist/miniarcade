#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
const{runMotion,analyzeMotion,assertMotion,motionLine}=require('./motion');
const evidence=require('./evidence');

const SOURCE=fs.readFileSync(path.join(__dirname,'..','ricochet-foundry.html'),'utf8');
const forbiddenPresentation=[/\bfunction\s+draw(?:Route|Path)s?\b/,/\bdrawRoutes?\s*\(/,/\broute(?:Points|Hash)\s*:/,/VISIBLE (?:ROUTE )?PLAN|FOLLOW THE (?:PATH|LINE)|CHECK THE PLAN/,/\.setLineDash\s*\(/];
const noVisiblePath=forbiddenPresentation.every(pattern=>!pattern.test(SOURCE));
const FOOTER=String.raw`
globalThis.__rfApplied=[];
{const old=applyIntent;applyIntent=function(intent){const out=old(intent);globalThis.__rfApplied.push(Object.assign({},intent));if(globalThis.__rfApplied.length>240)globalThis.__rfApplied.shift();return out;};}
globalThis.__rfLastApplied=()=>globalThis.__rfApplied.at(-1)||null;
`;

let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code)};
const sum=(runs,key)=>runs.reduce((total,run)=>total+run.stats[key],0);

function validateNaturalEvidence(label,ambient){
  const report=evidence.validateEvidence(ambient.ledger),events=report.ledger?report.ledger.events:[];
  if(!report.ok){for(const violation of report.violations)fail(`${label}: [${violation.code}] ${violation.message}`);return null}
  const forbidden=new Set(['locomotion','movement','walk','turn','replan','replanning','navigation','path']);
  if(events.some(event=>forbidden.has(event.kind)))fail(label+': ledger credited ordinary locomotion or replanning');
  if(events.some(event=>(event.kind==='response'||event.kind==='commit')&&event.actorId!=='operator'))fail(label+': response/commit changed persistent operator identity');
  if(events.some((event,index)=>!Number.isInteger(event.showFrame)||!Number.isInteger(event.runFrame)||event.frame!==event.showFrame||index&&(event.frame<events[index-1].frame||event.serial<=events[index-1].serial)))fail(label+': evidence lost monotonic show-frame or serial order');
  const kinds=new Set(events.map(event=>event.kind));for(const kind of['setup','threat','response','commit','payoff','progress','environment'])if(!kinds.has(kind))fail(label+': natural ledger missed '+kind);
  const sources=new Set(events.map(event=>event.source));for(const source of['order-issued','choice-ready','pressure-warning','operator-counter','shot-commit','cast-complete','machine-transition','foundry-state'])if(!sources.has(source))fail(label+': natural ledger missed '+source);
  const bySerial=new Map(events.map(event=>[event.serial,event]));
  for(const response of events.filter(event=>event.kind==='response')){const threat=bySerial.get(response.causeSerial);if(!threat||threat.kind!=='threat'||threat.serial>=response.serial||threat.actorId!==response.hazardId)fail(label+': operator response lost its prior hazard cause')}
  for(const payoff of events.filter(event=>event.kind==='payoff')){const setup=bySerial.get(payoff.setupSerial),commit=bySerial.get(payoff.commitSerial);if(!setup||setup.kind!=='setup'||!commit||commit.kind!=='commit'||setup.orderId!==payoff.orderId||commit.orderSetupSerial!==setup.serial||setup.serial>=commit.serial||commit.serial>=payoff.serial)fail(label+': cast payoff lost its order -> shot -> cast chain')}
  return evidence.deriveEvidence(ambient.ledger);
}

console.log('1) fixed 60 Hz replay, rendered/headless parity, chunk parity, finite renderer');
{
  const a=bootGame('ricochet-foundry',{seed:0xf001}),b=bootGame('ricochet-foundry',{seed:0xf001}),rendered=bootGame('ricochet-foundry',{seed:0xf001});
  a.frames(9000,false);b.frames(9000,false);const draws=rendered.frames(9000,true),sa=a.sandbox.__ricochetFoundrySignature(),sb=b.sandbox.__ricochetFoundrySignature(),sr=rendered.sandbox.__ricochetFoundrySignature();
  console.log(`  same seed ${sa===sb?'identical':'DIFFERENT'}, rendered ${sa===sr?'identical':'DIFFERENT'}, ${draws.calls} canvas calls`);
  if(sa!==sb)fail('same-seed replay diverged');if(sa!==sr)fail('render traversal changed simulation or RNG');
  if(!a.sandbox.__ricochetFoundryProbe().finite||!rendered.sandbox.__ricochetFoundryProbe().finite)fail('finite replay contract failed');
  if(draws.calls<50000||!draws.byMethod.fillRect||!draws.byMethod.beginPath||!draws.byMethod.fillText)fail('renderer was not genuinely exercised: '+JSON.stringify(draws.byMethod));
  const mono=bootGame('ricochet-foundry',{seed:0xf002}),chunked=bootGame('ricochet-foundry',{seed:0xf002});mono.frames(9000,false);for(let i=0;i<900;i++)chunked.frames(10,false);
  if(mono.sandbox.__ricochetFoundrySignature()!==chunked.sandbox.__ricochetFoundrySignature())fail('monolithic and chunked fixed steps diverged');
}

console.log('2) six-bank planner is pure, exhaustive, RNG-inert, and shares one intent schema');
{
  const planned=bootGame('ricochet-foundry',{seed:0xf010}),control=bootGame('ricochet-foundry',{seed:0xf010}),fixture=planned.sandbox.__ricochetFoundryPlannerFixture(),schema=planned.sandbox.__ricochetFoundryIntentFixture();
  const nextPlanned=planned.sandbox.__ricochetFoundryNextRandom(),nextControl=control.sandbox.__ricochetFoundryNextRandom();
  if(!fixture.pure||!fixture.repeat||fixture.candidateCount!==6||fixture.candidates.length!==6||fixture.budget>360)fail('planner purity/repeatability/exhaustiveness fixture failed: '+JSON.stringify(fixture));
  if(nextPlanned!==nextControl)fail('private planning consumed engine RNG');
  if(schema.aiKeys.join('|')!==schema.humanKeys.join('|')||schema.actions.length!==6||new Set(schema.actions.map(action=>action.port+':'+action.director)).size!==6)fail('human/bot intent schemas or action bank differ: '+JSON.stringify(schema));
  for(const name of['side','ceiling','horizontal','vertical','cup','director-left','director-right']){const hit=planned.sandbox.__ricochetFoundryCollisionFixture(name),resolved=name==='cup'?hit.charge.mode==='cup':hit.charge.collisionHistory.length>0;if(!hit.finite||!hit.quantized||!resolved)fail(name+' collision fixture was not finite, quantized, and resolved')}
  const manufacturing={
    'raw-furnace':q=>q.charge.stage===1&&q.events.some(e=>e.type==='recipe-transition'),
    'heated-stamp':q=>q.charge.stage===2&&q.charge.stampCount===1,
    'shaped-quench':q=>q.charge.stage===3,
    'tempered-die':q=>q.charge.mode==='cast'&&q.component&&q.component.type==='gear',
    'raw-stamp':q=>q.charge.mode==='scrap'&&q.charge.stage===4,
    'heart-double':q=>q.charge.stage===2&&q.charge.stampCount===2
  };
  for(const[name,accept]of Object.entries(manufacturing)){const result=planned.sandbox.__ricochetFoundryManufacturingFixture(name);if(!accept(result))fail(name+' manufacturing fixture failed: '+JSON.stringify(result))}
  console.log(`  ${fixture.candidateCount} deterministic banks, ${fixture.outcomes.join('/')} outcomes, quantized collision and recipe fixtures pass`);
}

console.log('3) thermal lookahead causally counters the warned drop while the same-seed baseline remains active');
{
  const live=bootGame('ricochet-foundry',{seed:0xf020}),baseline=bootGame('ricochet-foundry',{seed:0xf020});baseline.sandbox.__NO_THERMAL_LOOKAHEAD=1;live.sandbox.__ricochetFoundryReset();baseline.sandbox.__ricochetFoundryReset();
  const left=live.sandbox.__ricochetFoundryActFixture(),right=baseline.sandbox.__ricochetFoundryActFixture();
  if(live.sandbox.__ricochetFoundryPhysical()!==baseline.sandbox.__ricochetFoundryPhysical())fail('hazard A/B did not start physically identical');
  if(left.liveIntent.tactic!=='COUNTER THE DROP'||right.liveIntent.tactic==='COUNTER THE DROP'||left.landAt-left.warnAt!==240||right.landAt-right.warnAt!==240)fail('fixture did not isolate a 240f warned counter decision');
  let first=-1,phase='';for(let frame=1;frame<=300;frame++){live.frames(1,false);baseline.frames(1,false);if(first<0&&live.sandbox.__ricochetFoundryPhysical()!==baseline.sandbox.__ricochetFoundryPhysical()){first=frame;phase=live.sandbox.__ricochetFoundryProbe().hazard.phase}}
  const lp=live.sandbox.__ricochetFoundryProbe(),bp=baseline.sandbox.__ricochetFoundryProbe(),warn=lp.acts.find(note=>note.kind==='act-warning'),land=bp.acts.find(note=>note.kind==='act-land');
  if(first<1||first>=240||phase!=='warn')fail('lookahead did not first change physical intent inside the warning');
  if(!warn||!land||land.at-warn.at!==240)fail('warning and baseline land were not exactly 240 viewer frames apart');
  if(lp.stats.hazardCounters<1||lp.stats.playerResponses<1||bp.stats.jamLands<1||bp.stats.hazardCounters!==0||bp.stats.progress<1||bp.stats.events<2)fail('ablation removed the game instead of only thermal lookahead');
  console.log(`  first physical divergence ${first}f in ${phase}; counters/jams ${lp.stats.hazardCounters}/${bp.stats.jamLands}`);
}

console.log('4) paired natural panel preserves throughput while lookahead wins hazard safety');
{
  const live=[],baseline=[];
  for(let i=0;i<4;i++){
    const seed=0xf040+i*233,a=bootGame('ricochet-foundry',{seed}),b=bootGame('ricochet-foundry',{seed});b.sandbox.__NO_THERMAL_LOOKAHEAD=1;a.sandbox.__ricochetFoundryReset();b.sandbox.__ricochetFoundryReset();a.frames(18000,false);b.frames(18000,false);
    const pa=a.sandbox.__ricochetFoundryProbe(),pb=b.sandbox.__ricochetFoundryProbe();live.push(pa);baseline.push(pb);
    if(pa.stats.hazardCounters<8||pa.stats.jamLands>3||pb.stats.hazardCounters!==0||pb.stats.jamLands<8||pb.stats.progress<60||pb.stats.casts<5||pa.stats.engineStarts<1||pb.stats.engineStarts<1)fail(seed.toString(16)+': paired policy activity regressed '+JSON.stringify({live:pa.stats,baseline:pb.stats}));
    console.log(`  ${seed.toString(16)} casts ${pa.stats.casts}/${pb.stats.casts}, counters ${pa.stats.hazardCounters}/${pb.stats.hazardCounters}, jam lands ${pa.stats.jamLands}/${pb.stats.jamLands}`);
  }
  if(sum(live,'hazardCounters')<32||sum(baseline,'jamLands')<32||sum(live,'casts')<sum(baseline,'casts'))fail('aggregate lookahead safety/throughput result regressed');
}

console.log('5) natural evidence names authored choices, threats, responses, casts, and permanent foundry state');
{
  for(const seed of[0xf060,0xf149,0xf232]){
    const game=bootGame('ricochet-foundry',{seed});game.frames(18000,false);const p=game.sandbox.__ricochetFoundryProbe(),ambient=game.sandbox.__ambientProbe(),derived=validateNaturalEvidence(seed.toString(16),ambient);
    if(ambient.protocol!==evidence.PROTOCOL||ambient.schema!==1||ambient.game!=='ricochet-foundry'||ambient.stateSignature!==game.sandbox.__ricochetFoundrySignature()||ambient.stateDigest!==ambient.stateSignature||!ambient.finite)fail(seed.toString(16)+': ambient envelope drifted');
    if(!same(ambient.soak,game.sandbox.__soakProbe())||!same(ambient.motion,game.sandbox.__motionProbe())||!same(ambient.counters,p.stats)||ambient.serial!==ambient.ledger.serial||!same(ambient.events,ambient.ledger.events))fail(seed.toString(16)+': ambient aliases drifted');
    if(ambient.topology.ports!==3||ambient.topology.directorStates!==2||ambient.topology.processMachines!==4||ambient.topology.authoredOrders!==4)fail(seed.toString(16)+': truthful foundry topology regressed');
    for(const kind of['setup','threat','response','commit','payoff'])if(ambient.evidence.decisions[kind].count<2)fail(seed.toString(16)+': natural decision category too thin: '+kind);
    if(!derived||derived.payoffs!==p.stats.casts||derived.maxDeadAir>420||p.stats.ordersCompleted<6||p.stats.partsInstalled<6||p.stats.engineStarts<1||p.stats.maxTacticalLull>300)fail(seed.toString(16)+': natural progression/evidence floors regressed '+JSON.stringify({derived,stats:p.stats}));
    console.log(`  ${seed.toString(16)} ${derived.eventCount} facts, ${p.stats.casts} casts, ${p.stats.partsInstalled} installs, ${p.stats.engineStarts} engine start`);
  }
}

console.log('6) manual takeover uses the same port/director/commit intent boundary');
{
  const game=bootGame('ricochet-foundry',{seed:0xf070,footer:FOOTER});press(game,'Enter');press(game,'Enter');game.key('keydown','ArrowRight');game.key('keydown','ArrowUp');game.key('keydown','Space');game.frames(2,false);game.key('keyup','ArrowRight');game.key('keyup','ArrowUp');game.key('keyup','Space');const applied=game.sandbox.__rfLastApplied(),p=game.sandbox.__ricochetFoundryProbe();
  if(!applied||applied.port!==2||applied.director!==-1||!applied.commit||applied.tactic!=='MANUAL FORGE'||p.stats.shotsCommitted<1)fail('manual intent did not traverse shared applyIntent/launch mechanics: '+JSON.stringify({applied,stats:p.stats}));
  if(!p.finite)fail('manual takeover produced non-finite state');
}

console.log('7) payoff FX and Ambient Evidence are simulation/RNG/statistics no-ops');
{
  for(const flag of['__NO_PAYOFF_FX','__NO_EVIDENCE_LEDGER']){
    const a=bootGame('ricochet-foundry',{seed:0xf080}),b=bootGame('ricochet-foundry',{seed:0xf080});b.sandbox[flag]=1;a.sandbox.__ricochetFoundryReset();b.sandbox.__ricochetFoundryReset();a.frames(18000,false);b.frames(18000,false);
    const pa=a.sandbox.__ricochetFoundryProbe(),pb=b.sandbox.__ricochetFoundryProbe();
    if(a.sandbox.__ricochetFoundrySignature()!==b.sandbox.__ricochetFoundrySignature())fail(flag+' changed simulation signature');
    if(a.engine.random()!==b.engine.random())fail(flag+' changed RNG state');
    if(!same(pa.stats,pb.stats))fail(flag+' changed exact statistics');
    const ledger=b.sandbox.__ambientProbe().ledger;if(flag==='__NO_EVIDENCE_LEDGER'&&(ledger.enabled!==false||ledger.serial!==0||ledger.events.length))fail('__NO_EVIDENCE_LEDGER did not expose an empty disabled ledger');
    if(pa.stats.casts<6)fail(flag+' parity window was vacuous');
    console.log('  '+flag+' no-op pass');
  }
}

console.log('8) shared motion contract tracks the persistent charge and bounded installation cheer');
{
  const report=analyzeMotion(runMotion('ricochet-foundry',{seed:0xf090,minutes:10,sampleEvery:5}),{requiredIds:['charge'],minPresenceShare:.94,emoteFrames:260,emoteShare:1,identityTurnoverAllowance:1});
  assertMotion('ricochet-foundry',report,fail);const charge=report.actors.find(actor=>actor.id==='charge'),operator=report.actors.find(actor=>actor.id==='operator');
  if(!charge||charge.worstBareStillFrames>30||charge.presenceShare<.94||!operator||operator.worstEmoteStillFrames>180)fail('watched workpiece/installation motion receipt regressed: '+JSON.stringify(report));
  console.log('  '+motionLine(report)+`; charge presence ${(charge.presenceShare*100).toFixed(1)}%`);
}

console.log('9) two ten-minute soaks stay finite, moving, eventful, and complete repeated engines');
{
  for(const seed of[0xf0a0,0xf189]){const{game,samples}=runSoak('ricochet-foundry',{seed,minutes:10}),report=analyzeSoak(samples),p=game.sandbox.__ricochetFoundryProbe();assertSoak(seed.toString(16),report,{still:3,quiet:6,stall:8,minEvents:200,minProgress:125},fail);if(p.stats.casts<14||p.stats.partsInstalled<14||p.stats.engineStarts<3||p.stats.hazardCounters<17||p.stats.jamLands>6)fail(seed.toString(16)+': ten-minute foundry progression regressed '+JSON.stringify(p.stats));console.log('  '+seed.toString(16)+' '+soakLine(report)+`; casts ${p.stats.casts}, installs ${p.stats.partsInstalled}, engines ${p.stats.engineStarts}`)}
}

console.log('10) source keeps private bank forecasts invisible as plan overlays');
if(!noVisiblePath)fail('source contains a visible route/path/waypoint overlay pattern');else console.log('  no future route, breadcrumb, waypoint, dashed-plan, or predicted-arc renderer found');

if(failed){console.error('\nRICOCHET FOUNDRY EVAL FAILED');process.exit(1)}
console.log('\nRICOCHET FOUNDRY EVAL PASSED');
