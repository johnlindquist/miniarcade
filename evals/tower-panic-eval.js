#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
const{assertEntertainment}=require('./entertainment');
const evidence=require('./evidence');
const{runMotion,analyzeMotion,assertMotion,motionLine}=require('./motion');
const GAME_SOURCE=fs.readFileSync(path.join(__dirname,'..','tower-panic.html'),'utf8');
const forbiddenPresentation=[/\bfunction\s+draw(?:Route|Path)s?\b/,/\bdrawRoutes?\s*\(/,/\broute(?:Points|Hash)\s*:/,/function\s+(?:probe|visualProbe)\(\)\{[^\n]*\broute\s*:/,/VISIBLE (?:ROUTE )?PLAN|FOLLOW THE (?:PATH|LINE)|CLIMB THE LINE|CHECK THE PLAN/,/\.setLineDash\s*\(/];
const noVisiblePath=forbiddenPresentation.every(pattern=>!pattern.test(GAME_SOURCE));

const FOOTER=String.raw`
globalThis.__tpApplied=[];
{const old=applyIntent;applyIntent=function(intent){const x=hero.x,y=hero.y,out=old(intent),d=Math.hypot(hero.x-x,hero.y-y);
  globalThis.__tpApplied.push({intent:Object.assign({},intent),distance:d});if(globalThis.__tpApplied.length>240)globalThis.__tpApplied.shift();return out;};}
globalThis.__tpLastApplied=()=>globalThis.__tpApplied.at(-1)||null;
`;

let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const score=s=>s.rescues*10+s.extractions*80+s.deflections*2-s.hits*8-s.downs*20;
const sum=(runs,key)=>runs.reduce((n,p)=>n+p.stats[key],0);
function bands(stats,spec,label){for(const[key,[lo,hi]]of Object.entries(spec)){const value=stats[key];if(value<lo||value>hi)fail(label+': '+key+' '+value+' outside measured band '+lo+'..'+hi)}}
function notePairs(p,label,minPairs){
  const warn=p.act.notes.filter(n=>n.kind==='act-warning'),land=p.act.notes.filter(n=>n.kind==='act-land'),pending=warn.length===land.length+1&&p.act.phase==='warn';
  if(land.length<minPairs||!(warn.length===land.length||pending))fail(label+': warning/land pairing '+warn.length+'/'+land.length);
  for(let i=0;i<land.length;i++)if(land[i].at-warn[i].at!==240||land[i].tag-warn[i].tag!==240)fail(label+': act pair '+i+' was not exactly 240 frames');
}
function entertainmentEvidence(p,topology){return{
  noVisiblePath,
  topology:{rooms:topology.rooms,branches:topology.branches,maxStraight:topology.maxStraight},
  puzzle:{transitions:p.stats.objectiveTransitions,completions:p.stats.objectiveCompletions},
  agency:{enemyActions:p.stats.enemyActions,playerResponses:p.stats.playerResponses},
  decisions:{
    puzzle:{count:p.stats.puzzleDecisions,source:'stats.puzzleDecisions'},
    threat:{count:p.stats.threatDecisions,source:'stats.threatDecisions'},
    response:{count:p.stats.responseDecisions,source:'stats.responseDecisions'},
    payoff:{count:p.stats.payoffDecisions,source:'stats.payoffDecisions'}
  },
  maxDeadAir:p.stats.maxDecisionDeadAir
}}
function validateNaturalEvidence(label,ambient){
  const report=evidence.validateEvidence(ambient.ledger),events=report.ledger?report.ledger.events:[],locomotion=new Set(['locomotion','movement','walk','turn','replan','replanning','navigation','path']);
  if(!report.ok){for(const violation of report.violations)fail(label+': ['+violation.code+'] '+violation.message);return null}
  const bySerial=new Map(events.map(event=>[event.serial,event]));
  if(events.some(event=>locomotion.has(event.kind)))fail(label+': ledger credited locomotion or replanning');
  if(events.some(event=>(event.kind==='response'||event.kind==='commit')&&event.actorId!=='hero'))fail(label+': response/commit changed persistent hero identity');
  if(events.some((event,index)=>!Number.isInteger(event.showFrame)||!Number.isInteger(event.runFrame)||event.frame!==event.showFrame||index&&(event.frame<events[index-1].frame||event.serial<=events[index-1].serial)))fail(label+': evidence lost integer show-frame payload or serial order');
  if(events.some(event=>event.source==='hazard-consequence'&&(!bySerial.has(event.causeSerial)||bySerial.get(event.causeSerial).kind!=='threat'||bySerial.get(event.causeSerial).serial>=event.serial)))fail(label+': hazard consequence lost its prior threat cause');
  if(!events.some(event=>event.kind==='threat')||!events.some(event=>event.kind==='response')||!events.some(event=>event.kind==='setup')||!events.some(event=>event.kind==='commit')||!events.some(event=>event.kind==='payoff')||!events.some(event=>event.kind==='environment'))fail(label+': natural ledger missed a tactical evidence category');
  if(!events.some(event=>event.source==='hero-response'&&event.brace===true))fail(label+': natural ledger missed an authored brace deflection');
  if(!events.some(event=>event.source==='extraction-ready')||!events.some(event=>event.source==='hero-commit'&&event.action==='board-extraction')||!events.some(event=>event.kind==='payoff'&&event.objective==='tower-cleared'))fail(label+': extraction setup/commit/payoff chain was absent');
  if(!events.some(event=>event.source==='tower-reversal'))fail(label+': natural ledger missed meaningful reversal observations');
  if(events.some(event=>event.kind==='threat'&&!/^stage:\d+:(?:barrel|fire|machine|cascade):\d+$/.test(event.actorId||'')))fail(label+': hazard actor ID was not stage-scoped');
  if(events.some(event=>(event.source==='worker-ready'||event.kind==='payoff'&&event.objective==='rescue')&&!/^stage:\d+:worker:\d+$/.test(event.actorId||'')))fail(label+': worker actor ID was not stage-scoped');
  return evidence.deriveEvidence(ambient.ledger)
}

// Baseline-first registration receipt, 2026-07-10. Eight paired five-minute
// seeds (0x7a00 + i*233) measured the shortest-path __NO_CASCADE_LOOKAHEAD
// policy before accepting forecast routing. Smart observed: 29..42 rescues,
// 7..10 extractions, 0..3 hits, 54..66 deflections, 764..826 events and
// 461..497 progress marks. Baseline observed: 24..38 rescues, 6..9
// extractions, 59..68 hits, 16..21 downs, 703..757 events, 347..413 progress.
// Forecast won the composite on 8/8 seeds, 8,806 vs -558 aggregate, while
// improving rescue/extraction totals 271/65 vs 233/53.
const SMART_POLICY_BANDS={rescues:[26,45],extractions:[6,11],hits:[0,5],downs:[0,1],deflections:[48,72],nearMisses:[48,75],convoyScares:[92,175],reroutes:[0,3],lapses:[3,16],acts:[4,4],barrels:[85,98],floors:[33,57],events:[720,870],progress:[430,530],maxEventLull:[0,300],maxProgressLull:[180,240]};
const BASE_POLICY_BANDS={rescues:[21,42],extractions:[5,10],hits:[54,74],downs:[14,24],deflections:[0,0],nearMisses:[45,75],convoyScares:[120,215],reroutes:[3,14],lapses:[4,17],acts:[4,4],barrels:[84,98],floors:[27,53],events:[660,800],progress:[320,450],maxEventLull:[0,330],maxProgressLull:[180,300]};

// Thirty independent ten-minute seeds (0x74000 + i*233), measured after the
// accepted policy and reachability validator: rescues 51..84, extractions
// 12..21, hits 0..7, deflections 106..133, near misses 97..141, convoy scares
// 207..331, lapses 6..25, events 1440..1666, progress 829..1013. Every tower
// remained finite; max event/progress gaps were 272f/202f. Bands retain roughly
// 10-20% margin on both sides without deleting honest mistakes or escalation.
const SOAK_BANDS={rescues:[45,92],extractions:[11,23],hits:[0,10],downs:[0,1],deflections:[95,145],nearMisses:[85,155],convoyScares:[180,360],reroutes:[0,5],lapses:[4,30],acts:[9,9],barrels:[175,198],floors:[55,115],events:[1350,1760],progress:[760,1100],maxEventLull:[0,330],maxProgressLull:[180,240]};

console.log('1) fixed 60 Hz determinism, rendered/headless parity, chunk parity, finite renderer');
{
  const a=bootGame('tower-panic',{seed:0x7401,footer:FOOTER}),b=bootGame('tower-panic',{seed:0x7401,footer:FOOTER}),rendered=bootGame('tower-panic',{seed:0x7401,footer:FOOTER});
  a.frames(2400,false);b.frames(2400,false);const draws=rendered.frames(2400,true),sa=a.sandbox.__towerPanicSignature(),sb=b.sandbox.__towerPanicSignature(),sr=rendered.sandbox.__towerPanicSignature();
  console.log('  same seed '+(sa===sb?'identical':'DIFFERENT')+', rendered '+(sa===sr?'identical':'DIFFERENT')+', '+draws.calls+' canvas calls');
  if(sa!==sb)fail('same seed diverged');if(sa!==sr)fail('render traversal changed simulation or RNG');
  if(!a.sandbox.__towerPanicProbe().finite||!rendered.sandbox.__towerPanicProbe().finite)fail('finite replay contract failed');
  if(draws.calls<10000||!draws.byMethod.fillRect||!draws.byMethod.beginPath||!draws.byMethod.fillText)fail('renderer was not genuinely exercised: '+JSON.stringify(draws.byMethod));
  const mono=bootGame('tower-panic',{seed:0x7402}),chunked=bootGame('tower-panic',{seed:0x7402});mono.frames(3600,false);for(let i=0;i<360;i++)chunked.frames(10,false);
  if(mono.sandbox.__towerPanicSignature()!==chunked.sandbox.__towerPanicSignature())fail('monolithic and chunked fixed steps diverged');
}

console.log('2) cascade forecast is pure, repeatable, RNG-inert, and controller schemas match');
{
  const planned=bootGame('tower-panic',{seed:0x7410}),control=bootGame('tower-panic',{seed:0x7410}),fixture=planned.sandbox.__towerPanicPlannerFixture(),schema=planned.sandbox.__towerPanicIntentFixture();
  const nextPlanned=planned.sandbox.__towerPanicNextRandom(),nextControl=control.sandbox.__towerPanicNextRandom();
  console.log('  pure '+fixture.pure+', repeat '+fixture.repeat+', path '+fixture.path.join('-')+', RNG '+nextPlanned.toFixed(8)+'/'+nextControl.toFixed(8));
  if(!fixture.pure||!fixture.repeat||!fixture.path.length)fail('planner purity/repeatability fixture failed');
  if(nextPlanned!==nextControl)fail('planning consumed engine RNG for invisible work');
  if(schema.aiKeys.join('|')!==schema.humanKeys.join('|'))fail('human and bot intent schemas differ: '+JSON.stringify(schema));
}

console.log('3) baseline-first paired A/B: forecast routing beats shortest-path panic on eight seeds');
{
  const smart=[],baseline=[];let wins=0,safetyWins=0;
  for(let i=0;i<8;i++){
    const seed=0x7a00+i*233,a=bootGame('tower-panic',{seed}),b=bootGame('tower-panic',{seed});b.sandbox.__NO_CASCADE_LOOKAHEAD=1;a.sandbox.__towerPanicReset();b.sandbox.__towerPanicReset();a.frames(18000,false);b.frames(18000,false);
    const pa=a.sandbox.__towerPanicProbe(),pb=b.sandbox.__towerPanicProbe();smart.push(pa);baseline.push(pb);if(score(pa.stats)>score(pb.stats))wins++;if(pa.stats.hits<pb.stats.hits)safetyWins++;
    bands(pa.stats,SMART_POLICY_BANDS,'seed '+seed.toString(16)+' forecast');bands(pb.stats,BASE_POLICY_BANDS,'seed '+seed.toString(16)+' shortest');
    if(!pa.finite||!pb.finite||pa.stats.invisibleResets||pb.stats.invisibleResets)fail('seed '+seed.toString(16)+': non-finite or invisible reset');
    if(pa.stats.smartPlans<50||pa.stats.baselinePlans!==0||pb.stats.smartPlans!==0||pb.stats.baselinePlans<50)fail('seed '+seed.toString(16)+': ablation did not isolate planner policy');
    console.log('  '+seed.toString(16)+' score '+score(pa.stats)+'/'+score(pb.stats)+', rescues '+pa.stats.rescues+'/'+pb.stats.rescues+', extracts '+pa.stats.extractions+'/'+pb.stats.extractions+', hits '+pa.stats.hits+'/'+pb.stats.hits);
  }
  const totals={smartScore:smart.reduce((n,p)=>n+score(p.stats),0),baseScore:baseline.reduce((n,p)=>n+score(p.stats),0),smartRescues:sum(smart,'rescues'),baseRescues:sum(baseline,'rescues'),smartExtractions:sum(smart,'extractions'),baseExtractions:sum(baseline,'extractions'),smartHits:sum(smart,'hits'),baseHits:sum(baseline,'hits')};
  console.log('  '+wins+'/8 score wins, '+safetyWins+'/8 safety wins; '+JSON.stringify(totals));
  if(wins<8||safetyWins<8||totals.smartScore<totals.baseScore+6000||totals.smartRescues<totals.baseRescues*1.08||totals.smartExtractions<totals.baseExtractions*1.12||totals.smartHits>totals.baseHits*.08)fail('aggregate forecast win regressed: '+JSON.stringify(totals));
}

console.log('4) overload cascade changes physical intent during an exact 240f warning');
{
  const a=bootGame('tower-panic',{seed:0x7420}),b=bootGame('tower-panic',{seed:0x7420});a.sandbox.__towerPanicActFixture();b.sandbox.__towerPanicActFixture();b.sandbox.__NO_ACTS=1;
  if(a.sandbox.__towerPanicPhysical()!==b.sandbox.__towerPanicPhysical())fail('paired act fixture did not start identical');let first=-1,phase='',tactic='';
  for(let frame=1;frame<=270;frame++){a.frames(1,false);b.frames(1,false);if(first<0&&a.sandbox.__towerPanicPhysical()!==b.sandbox.__towerPanicPhysical()){first=frame;const p=a.sandbox.__towerPanicProbe();phase=p.act.phase;tactic=p.hero.intent&&p.hero.intent.tactic}}
  const pa=a.sandbox.__towerPanicProbe(),pb=b.sandbox.__towerPanicProbe(),warn=pa.act.notes.find(n=>n.kind==='act-warning'),land=pa.act.notes.find(n=>n.kind==='act-land');
  console.log('  first physical/intent divergence '+first+'f in '+phase+' ('+tactic+')');
  if(!warn||!land||land.at-warn.at!==240||land.tag-warn.tag!==240)fail('warning/land pair was not exactly 240 frames');
  if(first<1||first>=240||phase!=='warn'||!String(tactic).includes('REROUTE'))fail('act did not force a real warn-phase reroute');
  if(pb.act.notes.length)fail('__NO_ACTS emitted act notes');
  const reset=bootGame('tower-panic',{seed:0x7421});reset.sandbox.__towerPanicActFixture();reset.frames(100,false);reset.sandbox.__towerPanicReset();reset.frames(300,false);const pr=reset.sandbox.__towerPanicProbe();
  if(pr.act.phase!=='calm'||pr.act.notes.some(n=>n.kind==='act-land'))fail('reset during warning left a stale act land');
}

console.log('5) human takeover uses the shared intent and movement path');
{
  const game=bootGame('tower-panic',{seed:0x7430,footer:FOOTER});press(game,'Enter');press(game,'Enter');const before=game.sandbox.__towerPanicProbe();game.key('keydown','ArrowRight');game.frames(8,false);game.key('keyup','ArrowRight');const after=game.sandbox.__towerPanicProbe(),applied=game.sandbox.__tpLastApplied();
  console.log('  playing '+after.hero.intent.tactic+', x '+before.hero.x.toFixed(2)+' -> '+after.hero.x.toFixed(2));
  if(!applied||applied.intent.tactic!=='MANUAL RESCUE'||applied.intent.dx!==1)fail('manual intent did not traverse applyIntent');
  if(after.hero.to===after.hero.node&&after.hero.x===before.hero.x)fail('manual movement did not enter the shared graph physics path');
  if(!after.finite)fail('manual control produced non-finite state');
}

console.log('6) exact SHOW ladder budgets, admire gate, and skill-profile lapse switch');
{
  const game=bootGame('tower-panic',{seed:0x7440});game.sandbox.__towerPanicFreezeShow();
  for(let i=0;i<3;i++){game.sandbox.__towerPanicForceShow(1,'routine-'+i);game.frames(20,false)}
  for(let i=0;i<2;i++){game.sandbox.__towerPanicForceShow(2,'milestone-'+i);game.frames(100,false)}
  game.sandbox.__towerPanicForceShow(3,'apex');game.frames(120,false);const show=game.sandbox.__towerPanicProbe().show,shown=show.shownByTier,s3=shown[3]||0;
  console.log('  tiers '+JSON.stringify(shown)+', hold/slow/admire '+show.heldFrames+'/'+show.slowedFrames+'/'+show.admireFrames);
  if(!((shown[1]||0)>(shown[2]||0)&&(shown[2]||0)>s3&&s3===1))fail('tier ladder is not strictly ordered');
  if(show.heldFrames!==6*s3||show.slowedFrames!==24*s3||show.admireFrames!==48*s3)fail('apex time budgets are not exact');
  const admire=game.sandbox.__towerPanicAdmireFixture();if(admire.admired.tactic!=='COUNT EVERY HELMET'||admire.gated.tactic==='COUNT EVERY HELMET')fail('__NO_ADMIRE did not gate bot-only rooftop pause');
  const perfect=bootGame('tower-panic',{seed:0x7441});perfect.sandbox.__NO_LAPSE=1;perfect.frames(18000,false);if(perfect.sandbox.__towerPanicProbe().stats.lapses!==0)fail('__NO_LAPSE did not remove skill-profile lapse onsets');
}

console.log('7) two independent ten-minute soaks keep moving, escalating, rescuing, and extracting');
const entertainmentPanel=[];
for(const seed of[0x74000,0x75a5d]){
  const{game,samples}=runSoak('tower-panic',{seed,minutes:10,footer:FOOTER}),report=analyzeSoak(samples),p=game.sandbox.__towerPanicProbe(),ambient=game.sandbox.__ambientProbe();
  const topology=game.sandbox.__towerPanicTopologyFixture();console.log('  '+seed.toString(16)+' '+soakLine(report)+'; rescues '+p.stats.rescues+', extractions '+p.stats.extractions+', responses '+p.stats.playerResponses+', enemy actions '+p.stats.enemyActions+', dead air '+p.stats.maxDecisionDeadAir+'f');
  assertSoak(seed.toString(16),report,{still:1,quiet:6,stall:5,minEvents:1300,minProgress:720},fail);bands(p.stats,SOAK_BANDS,'seed '+seed.toString(16)+' soak');notePairs(p,'seed '+seed.toString(16),8);
  if(!p.finite||p.stats.invisibleResets!==0||p.stats.extractions<11||p.stats.rescues<45)fail('seed '+seed.toString(16)+': soak lost visible progress');
  if(p.stats.objectiveTransitions!==p.stats.rescues||p.stats.objectiveCompletions!==p.stats.extractions||p.stats.enemyActions!==p.stats.barrels||p.stats.playerResponses!==p.stats.deflections||p.stats.puzzleDecisions!==p.stats.objectiveTransitions||p.stats.threatDecisions!==p.stats.enemyActions||p.stats.responseDecisions!==p.stats.playerResponses||p.stats.payoffDecisions!==p.stats.objectiveCompletions)fail('seed '+seed.toString(16)+': entertainment telemetry aliases walking/replans or lost its truthful event source');
  const expectedEntertainment=entertainmentEvidence(p,topology),derived=validateNaturalEvidence('seed '+seed.toString(16),ambient);
  if(ambient.protocol!==evidence.PROTOCOL||ambient.schema!==1||ambient.game!=='tower-panic'||ambient.frame.run!==p.runFrame||ambient.frame.show!==p.showFrame||ambient.showFrame!==p.showFrame||ambient.runFrame!==p.runFrame||ambient.stateSignature!==game.sandbox.__towerPanicSignature()||ambient.stateDigest!==ambient.stateSignature||!ambient.finite)fail('seed '+seed.toString(16)+': ambient envelope metadata/digest drifted');
  if(JSON.stringify(ambient.soak)!==JSON.stringify(game.sandbox.__soakProbe())||JSON.stringify(ambient.motion)!==JSON.stringify(game.sandbox.__motionProbe()))fail('seed '+seed.toString(16)+': ambient probe did not preserve the existing soak/motion contracts');
  if(JSON.stringify(ambient.counters)!==JSON.stringify(p.stats)||JSON.stringify(ambient.evidence)!==JSON.stringify(expectedEntertainment)||JSON.stringify(ambient.entertainment)!==JSON.stringify(expectedEntertainment)||ambient.serial!==ambient.ledger.serial||JSON.stringify(ambient.events)!==JSON.stringify(ambient.ledger.events))fail('seed '+seed.toString(16)+': ambient evidence, counters, or ledger aliases drifted');
  if(derived&&derived.payoffs!==p.stats.rescues+p.stats.extractions)fail('seed '+seed.toString(16)+': ledger payoff total lost rescue/extraction outcomes');
  const offered=p.show.offeredByTier,shown=p.show.shownByTier;if(!((offered[1]||0)>(offered[2]||0)&&(offered[2]||0)>(offered[3]||0)))fail('seed '+seed.toString(16)+': offered tiers not ordered');if(!((shown[1]||0)>(shown[2]||0)&&(shown[2]||0)>(shown[3]||0)))fail('seed '+seed.toString(16)+': shown tiers not ordered');
  entertainmentPanel.push({p,topology,ambient,derived});
}

console.log('7b) authored tower choices, active hazards, responses, and payoff pass the shared entertainment contract');
{
  const total=key=>entertainmentPanel.reduce((n,item)=>n+item.p.stats[key],0),topologies=entertainmentPanel.map(item=>item.topology),evidence={
    noVisiblePath,
    topology:{rooms:Math.min(...topologies.map(q=>q.rooms)),branches:Math.min(...topologies.map(q=>q.branches)),maxStraight:Math.max(...topologies.map(q=>q.maxStraight))},
    puzzle:{transitions:total('objectiveTransitions'),completions:total('objectiveCompletions')},
    agency:{enemyActions:total('enemyActions'),playerResponses:total('playerResponses')},
    decisions:{
      puzzle:{count:total('puzzleDecisions'),source:'stats.puzzleDecisions'},
      threat:{count:total('threatDecisions'),source:'stats.threatDecisions'},
      response:{count:total('responseDecisions'),source:'stats.responseDecisions'},
      payoff:{count:total('payoffDecisions'),source:'stats.payoffDecisions'}
    },
    maxDeadAir:Math.max(...entertainmentPanel.map(item=>item.p.stats.maxDecisionDeadAir))
  };
  const receipt=assertEntertainment('TOWER PANIC natural panel',evidence,{minRooms:6,minBranches:8,maxStraight:6,minPuzzleTransitions:90,minPuzzleCompletions:22,minEnemyActions:350,minPlayerResponses:190,requiredDecisionKinds:['puzzle','threat','response','payoff'],minPerDecisionKind:20,maxDeadAir:270,deadAirUnit:'tactical frames'},fail);
  console.log('  entertainment receipt '+JSON.stringify(receipt.report));if(!noVisiblePath)fail('computed planner state regained a route renderer, public route probe, guideline dash, or follow-the-line copy');
}

console.log('7c) shared motion contract proves a persistent rigger, bounded authored braces, and physical pace');
for(const seed of[0x74000,0x75a5d]){
  const run=runMotion('tower-panic',{seed,minutes:10,sampleEvery:5}),report=analyzeMotion(run,{stillRadius:2,emoteFrames:120,emoteShare:.15,requiredIds:['hero']}),heroSamples=run.samples.map(sample=>sample.actors.find(actor=>actor.id==='hero')).filter(Boolean);let physicalPairs=0,movingPairs=0,physicalDistance=0;
  for(let i=1;i<heroSamples.length;i++){const d=Math.hypot(heroSamples[i].x-heroSamples[i-1].x,heroSamples[i].y-heroSamples[i-1].y);if(d>25)continue;physicalPairs++;physicalDistance+=d;if(d>.5)movingPairs++}
  const pace=physicalDistance/(run.samples.length*run.step),movingShare=physicalPairs?movingPairs/physicalPairs:0,meanCarry=movingPairs?physicalDistance/movingPairs:0;console.log('  '+seed.toString(16)+' '+motionLine(report)+', pace '+pace.toFixed(3)+'px/f, moving '+(movingShare*100).toFixed(1)+'%, carry '+meanCarry.toFixed(2)+'px');assertMotion(seed.toString(16),report,fail);if(pace<.65||movingShare<.90||meanCarry<3.4)fail('seed '+seed.toString(16)+': physical momentum regressed: '+pace.toFixed(3)+'px/f, '+movingShare.toFixed(3)+' moving, '+meanCarry.toFixed(2)+'px carry')
}

console.log('7d) Ambient Evidence is causal, locomotion-free, and a perfect simulation/RNG/statistics no-op');
{
  const a=bootGame('tower-panic',{seed:0x744e}),b=bootGame('tower-panic',{seed:0x744e});b.sandbox.__NO_EVIDENCE_LEDGER=1;a.sandbox.__towerPanicReset();b.sandbox.__towerPanicReset();a.frames(18000,false);b.frames(18000,false);
  const sa=a.sandbox.__towerPanicSignature(),sb=b.sandbox.__towerPanicSignature(),pa=a.sandbox.__towerPanicProbe(),pb=b.sandbox.__towerPanicProbe(),aa=a.sandbox.__ambientProbe(),ab=b.sandbox.__ambientProbe(),ra=a.sandbox.__towerPanicNextRandom(),rb=b.sandbox.__towerPanicNextRandom(),derived=validateNaturalEvidence('evidence-on twin',aa);
  console.log('  '+(derived&&derived.eventCount||0)+' curated events, '+(derived&&derived.payoffs||0)+' causal payoffs; signatures '+(sa===sb?'identical':'DIFFERENT')+', RNG '+ra.toFixed(8)+'/'+rb.toFixed(8));
  if(sa!==sb)fail('__NO_EVIDENCE_LEDGER changed simulation signature');
  if(JSON.stringify(pa.stats)!==JSON.stringify(pb.stats))fail('__NO_EVIDENCE_LEDGER changed exact statistics');
  if(ra!==rb)fail('__NO_EVIDENCE_LEDGER changed engine RNG state');
  if(!aa.ledger.enabled||!aa.ledger.events.length||ab.ledger.enabled||ab.ledger.events.length||ab.ledger.serial!==0)fail('__NO_EVIDENCE_LEDGER did not expose an empty disabled ledger twin');
  if(aa.stateDigest!==ab.stateDigest)fail('__NO_EVIDENCE_LEDGER changed ambient state digest');
  if(/\brecordEvidence\([^;\n]*\beventSerial\b/.test(GAME_SOURCE)||aa.ledger.sources.some(source=>JSON.stringify(source).includes('eventSerial')))fail('Ambient Evidence derived credit from generic movement-incremented eventSerial');
}

console.log('8) payoff FX is a non-vacuous perfect same-seed simulation no-op');
{
  const a=bootGame('tower-panic',{seed:0x7450}),b=bootGame('tower-panic',{seed:0x7450});b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);const same=a.sandbox.__towerPanicSignature()===b.sandbox.__towerPanicSignature(),p=a.sandbox.__towerPanicProbe();
  console.log('  signatures '+(same?'identical':'DIFFERENT')+' through '+p.stats.extractions+' apex extractions / '+p.stats.events+' events');
  if(!same)fail('__NO_PAYOFF_FX changed simulation state');if(p.stats.extractions<4)fail('FX no-op window did not exercise rooftop apexes');
}

console.log(failed?'\nTOWER PANIC EVAL FAILED':'\nTOWER PANIC EVAL PASSED');
process.exit(failed?1:0);
