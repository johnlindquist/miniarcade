#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const evidence=require('./evidence');
const ablation=require('./ablation');

let failed=false;
const fail=message=>{failed=true;console.error('  FAIL:',message)};
const ok=(condition,message)=>{if(!condition)fail(message)};
const copy=value=>JSON.parse(JSON.stringify(value));
const ledger=value=>Object.assign({protocol:evidence.PROTOCOL,version:evidence.VERSION},value);
const expectReason=(label,input,code,options)=>{
  const report=evidence.validateEvidence(input,options);
  if(!report.reasons.includes(code))fail(`${label}: expected ${code}, got ${report.reasons.join(', ')||'none'}`);
  return report;
};
const expectAblation=(label,pair,contract,code)=>{
  const report=ablation.analyzeAblationPair(pair,contract);
  if(!report.reasons.includes(code))fail(`${label}: expected ${code}, got ${report.reasons.join(', ')||'none'}`);
  return report;
};

const SOURCES=[
  {id:'room-state',kind:'setup'},
  {id:'enemy-tell',kind:'threat'},
  {id:'player-dodge',kind:'response',stableActor:true},
  {id:'player-commit',kind:'commit',stableActor:true},
  {id:'room-payoff',kind:'payoff'}
];
const VALID={protocol:evidence.PROTOCOL,version:1,sources:SOURCES,events:[
  {serial:1,frame:10,source:'room-state',kind:'setup',x:20,y:30},
  {serial:2,frame:20,source:'enemy-tell',kind:'threat',x:50,y:30},
  {serial:3,frame:25,source:'player-dodge',kind:'response',causeSerial:2,actorId:'hero',x:25,y:30},
  {serial:4,frame:30,source:'player-commit',kind:'commit',actorId:'hero',x:35,y:30},
  {serial:5,frame:40,source:'room-payoff',kind:'payoff',setupSerial:1,commitSerial:4,x:80,y:40}
]};

console.log('1) E.createEvidence is deterministic, bounded, cloned, and RNG-inert');
{
  const game=bootGame('rocket',{seed:0xe101}),E=game.engine;
  E.seedRandom(0xe102);const expected=[E.random(),E.random(),E.random()];
  E.seedRandom(0xe102);
  const ledger=E.createEvidence({limit:3,sources:SOURCES});
  const offered={frame:10,x:20,y:30,data:{door:'closed'}};
  ledger.record('room-state',offered);offered.data.door='mutated';
  ledger.record('enemy-tell',{frame:20,x:50,y:30});
  ledger.record('player-dodge',{frame:25,causeSerial:2,actorId:'hero',x:25,y:30});
  ledger.record('player-commit',{frame:30,actorId:'hero',x:35,y:30});
  const returned=ledger.record('room-payoff',{frame:40,setupSerial:1,commitSerial:4,x:80,y:40});returned.x=-999;
  const after=[E.random(),E.random(),E.random()],probe=ledger.probe(),fresh=ledger.eventsSince(3);
  ok(expected.every((value,index)=>value===after[index]),'evidence calls consumed engine RNG');
  ok(probe.events.length===3&&probe.events[0].serial===3&&probe.events[2].serial===5&&probe.dropped===2,'bounded ledger did not retain the newest three serials');
  ok(fresh.length===2&&fresh[0].serial===4&&fresh[1].serial===5,'eventsSince did not return cloned serial suffix');
  fresh[0].x=-500;ok(ledger.eventsSince(3)[0].x===35,'eventsSince leaked mutable event references');
  ok(ledger.probe().events.at(-1).x===80,'record return leaked mutable retained state');
  const simultaneous=ledger.record('room-state',{frame:40});
  ok(simultaneous.serial===6&&simultaneous.frame===40,'ledger rejected a distinct same-frame fact');
  let fractionalRejected=false,decreasingRejected=false;
  try{ledger.record('room-state',{frame:40.5})}catch(error){fractionalRejected=/nonnegative integers/.test(error.message)}
  try{ledger.record('room-state',{frame:39})}catch(error){decreasingRejected=/nondecreasing/.test(error.message)}
  ok(fractionalRejected&&decreasingRejected,'ledger accepted a fractional or decreasing frame');
  game.sandbox.__NO_EVIDENCE_LEDGER=false;
  E.seedRandom(0xe103);const noOpExpected=E.random();E.seedRandom(0xe103);
  ok(ledger.record('room-state',{frame:50})===null,'__NO_EVIDENCE_LEDGER record was not a no-op');
  const off=ledger.probe();ok(!off.enabled&&off.events.length===0&&off.serial===0,'__NO_EVIDENCE_LEDGER exposed retained observations');
  ok(E.random()===noOpExpected,'__NO_EVIDENCE_LEDGER consumed RNG');
  delete game.sandbox.__NO_EVIDENCE_LEDGER;
  ok(ledger.reset()&&ledger.probe().events.length===0&&ledger.probe().epoch===1,'reset did not begin a clean epoch');
  console.log('  newest 3 retained; same-frame facts ordered by serial; writes/reads clone-isolated; ablation empty; RNG stream identical');
}

console.log('2) valid causal evidence derives independently and hashes canonical samples/completeness');
{
  const report=evidence.validateEvidence(VALID),derived=evidence.deriveEvidence(VALID);
  ok(report.ok,'valid causal ledger rejected: '+report.reasons.join(', '));
  ok(derived.activity===5&&derived.progress===2&&derived.payoffs===1&&derived.chains[0].setup===1&&derived.chains[0].commit===4,'causal derivation totals are wrong');
  const reordered={version:1,protocol:evidence.PROTOCOL,sources:[...SOURCES].reverse().map(source=>({kind:source.kind,id:source.id,...Object.fromEntries(Object.entries(source).filter(([key])=>key!=='kind'&&key!=='id'))})),events:VALID.events.map(event=>Object.fromEntries(Object.entries(event).reverse()))};
  ok(evidence.canonicalEvidenceHash(VALID)===evidence.canonicalEvidenceHash(reordered),'canonical evidence hash depends on key or source registration order');
  const sampled=ledger({enabled:true,epoch:2,limit:10,serial:5,dropped:0,lastFrame:40,sources:SOURCES,events:VALID.events,samples:[
    {frame:0,actors:[{id:'hero',role:'hero',x:1,y:2,emote:false},{id:'foe',x:8,y:9,emote:false}]}
  ]});
  const sampleReordered=copy(sampled);sampleReordered.samples[0].actors.reverse();
  ok(evidence.canonicalEvidenceHash(sampled)===evidence.canonicalEvidenceHash(sampleReordered),'canonical evidence hash depends on actor order inside one sample');
  const moved=copy(sampled);moved.samples[0].actors.find(actor=>actor.id==='hero').x=3;
  ok(evidence.canonicalEvidenceHash(sampled)!==evidence.canonicalEvidenceHash(moved),'canonical evidence hash ignored actor samples');
  const dropped=copy(sampled);dropped.dropped=1;
  const limited=copy(sampled);limited.limit=11;
  ok(evidence.canonicalEvidenceHash(sampled)!==evidence.canonicalEvidenceHash(dropped),'canonical evidence hash ignored dropped completeness');
  ok(evidence.canonicalEvidenceHash(sampled)!==evidence.canonicalEvidenceHash(limited),'canonical evidence hash ignored ledger limit completeness');
  ok(/^[0-9a-f]{64}$/.test(derived.hash),'derived canonical digest is not SHA-256');
  console.log(`  ${derived.activity} credited observations, ${derived.progress} progress beats; samples and completeness are digest-bound`);
}

console.log('3) protocol, chronology, actor, and causal bypasses fail closed');
{
  expectReason('missing protocol',{version:1,sources:SOURCES,events:VALID.events},evidence.REASONS.INVALID_PROTOCOL);
  expectReason('wrong protocol',{protocol:'ambient-evidence/v0',version:1,sources:SOURCES,events:VALID.events},evidence.REASONS.INVALID_PROTOCOL);
  expectReason('missing version',{protocol:evidence.PROTOCOL,sources:SOURCES,events:VALID.events},evidence.REASONS.UNSUPPORTED_VERSION);
  expectReason('unsupported version',{protocol:evidence.PROTOCOL,version:2,sources:SOURCES,events:VALID.events},evidence.REASONS.UNSUPPORTED_VERSION);
  expectReason('disabled ledger',ledger({enabled:false,sources:SOURCES,events:[]}),evidence.REASONS.DISABLED_LEDGER);

  const simultaneous=copy(VALID);simultaneous.events[2].frame=20;
  ok(evidence.validateEvidence(simultaneous).ok,'distinct serials at one frame should be accepted');
  const sameFrameChain=copy(VALID);sameFrameChain.events.forEach(event=>{event.frame=10});
  ok(evidence.validateEvidence(sameFrameChain).ok,'same-frame causal chain with prior serials should be accepted');
  let bad=copy(VALID);bad.events[2].serial=2;expectReason('duplicate serial',bad,evidence.REASONS.DUPLICATE_SERIAL);
  bad=copy(VALID);bad.events[2].serial=0;expectReason('decreasing serial',bad,evidence.REASONS.DECREASING_SERIAL);
  bad=copy(VALID);bad.events[2].frame=15;expectReason('decreasing frame',bad,evidence.REASONS.DECREASING_FRAME);
  bad=copy(VALID);bad.events[2].frame=20.5;expectReason('fractional event frame',bad,evidence.REASONS.INVALID_EVENT);
  bad=copy(VALID);bad.events[0].frame=-1;expectReason('negative event frame',bad,evidence.REASONS.INVALID_EVENT);
  bad=copy(sameFrameChain);bad.events[2].causeSerial=4;expectReason('future same-frame response cause',bad,evidence.REASONS.RESPONSE_WITHOUT_THREAT);
  expectReason('commit before setup',ledger({sources:[{id:'commit',kind:'commit',stableActor:true},{id:'setup',kind:'setup'},{id:'payoff',kind:'payoff'}],events:[
    {serial:1,frame:10,source:'commit',kind:'commit',actorId:'hero'},
    {serial:2,frame:10,source:'setup',kind:'setup'},
    {serial:3,frame:10,source:'payoff',kind:'payoff',setupSerial:2,commitSerial:1}
  ]}),evidence.REASONS.PAYOFF_WITHOUT_COMMIT);
  bad=copy(VALID);bad.events[1].source='invented-counter';expectReason('unknown source',bad,evidence.REASONS.UNKNOWN_SOURCE);
  bad=copy(VALID);bad.sources.push({id:'alias-a',kind:'setup',signal:'stats.one'}, {id:'alias-b',kind:'threat',signal:'stats.one'});expectReason('aliased source',bad,evidence.REASONS.ALIASED_SOURCE);
  bad=copy(VALID);bad.events[1].kind='setup';expectReason('source kind',bad,evidence.REASONS.SOURCE_KIND_MISMATCH);
  bad=copy(VALID);delete bad.events[2].causeSerial;expectReason('orphan response',bad,evidence.REASONS.RESPONSE_WITHOUT_THREAT);
  bad=copy(VALID);delete bad.events[4].setupSerial;expectReason('payoff setup',bad,evidence.REASONS.PAYOFF_WITHOUT_SETUP);
  bad=copy(VALID);delete bad.events[4].commitSerial;expectReason('payoff commit',bad,evidence.REASONS.PAYOFF_WITHOUT_COMMIT);
  expectReason('scored locomotion',ledger({sources:[{id:'steps',kind:'locomotion'}],events:[{serial:1,frame:1,source:'steps',kind:'locomotion',scored:true,actorId:'hero',x:0,y:0}]}),evidence.REASONS.SCORED_LOCOMOTION);
  expectReason('scored replan',ledger({sources:[{id:'plans',kind:'replan'}],events:[{serial:1,frame:1,source:'plans',kind:'replan',scored:true}]}),evidence.REASONS.SCORED_REPLAN);
  bad=copy(VALID);bad.events[1].x=NaN;expectReason('non-finite coordinate',bad,evidence.REASONS.NONFINITE_COORDINATE);
  bad=copy(VALID);bad.events[2].gameScore=1000;expectReason('game score',bad,evidence.REASONS.GAME_SCORE_FIELD);
  bad=copy(VALID);delete bad.events[2].actorId;expectReason('actor omission',bad,evidence.REASONS.ACTOR_OMISSION);
  bad=copy(VALID);delete bad.events[2].actorId;bad.events[2].actor={};expectReason('empty stable response actor',bad,evidence.REASONS.ACTOR_OMISSION);
  bad=copy(VALID);delete bad.events[3].actorId;bad.events[3].actor={};expectReason('empty stable commit actor',bad,evidence.REASONS.ACTOR_OMISSION);
  expectReason('identity laundering',ledger({sources:[{id:'watch',kind:'motion'}],events:[
    {serial:1,frame:1,source:'watch',kind:'motion',actorId:'hero-a',role:'hero',x:0,y:0},
    {serial:2,frame:2,source:'watch',kind:'motion',actorId:'hero-b',role:'hero',x:1,y:0}
  ]}),evidence.REASONS.ACTOR_IDENTITY_LAUNDERING);

  const sampleBase=extra=>ledger({sources:SOURCES,events:VALID.events,samples:Array.from({length:8},(_,index)=>({frame:index*5,actors:[{id:'hero',role:'hero',x:index*3,y:10,emote:false}]})),...extra});
  bad=sampleBase();bad.samples[2].frame=bad.samples[1].frame;expectReason('duplicate sample frame',bad,evidence.REASONS.INVALID_SAMPLE_FRAME);
  bad=sampleBase();bad.samples[2].frame=-1;expectReason('negative sample frame',bad,evidence.REASONS.INVALID_SAMPLE_FRAME);
  bad=sampleBase();bad.samples[2].frame=10.5;expectReason('fractional sample frame',bad,evidence.REASONS.INVALID_SAMPLE_FRAME);
  bad=sampleBase();bad.samples[2].actors[0].x=Infinity;expectReason('non-finite actor sample',bad,evidence.REASONS.NONFINITE_COORDINATE);
  bad=sampleBase();bad.samples[2].actors[0].id=' ';expectReason('empty actor sample id',bad,evidence.REASONS.ACTOR_OMISSION);
  expectReason('stillness',ledger({sources:SOURCES,events:VALID.events,samples:Array.from({length:8},(_,index)=>({frame:index*5,actors:[{id:'hero',role:'hero',x:10,y:10,emote:false}]}))}),evidence.REASONS.ACTOR_STILLNESS,{requiredActorIds:['hero']});
  expectReason('unbounded emote',ledger({sources:SOURCES,events:VALID.events,samples:Array.from({length:27},(_,index)=>({frame:index*5,actors:[{id:'hero',role:'hero',x:10,y:10,emote:true}]}))}),evidence.REASONS.ACTOR_EMOTE_DURATION,{requiredActorIds:['hero']});
  expectReason('emote share laundering',ledger({sources:SOURCES,events:VALID.events,samples:Array.from({length:8},(_,index)=>({frame:index*5,actors:[{id:'hero',role:'hero',x:index*3,y:10,emote:index<4}]}))}),evidence.REASONS.ACTOR_EMOTE_SHARE,{requiredActorIds:['hero']});
  bad=sampleBase();bad.samples[3].actors=[{id:'foe',role:'enemy',x:9,y:10,emote:false}];expectReason('required protagonist omission',bad,evidence.REASONS.ACTOR_OMISSION,{requiredActorIds:['hero']});
  bad=sampleBase();for(let index=0;index<bad.samples.length;index++)bad.samples[index].actors[0].id='hero-'+index;expectReason('role identity rotation',bad,evidence.REASONS.ACTOR_IDENTITY_LAUNDERING);
  bad=sampleBase();
  for(let index=0;index<bad.samples.length;index++){bad.samples[index].actors[0].id='actor-'+index;delete bad.samples[index].actors[0].role}
  expectReason('roleless identity rotation',bad,evidence.REASONS.ACTOR_OMISSION);
  console.log('  exact protocol/version, disabled state, equal-frame ordering, causal serials, stable actors, finite samples, and emote budgets enforced');
}

console.log('4) generic causal ablation pair enforces isolation and relevance');
{
  const pair={
    live:{initialDigest:'same',timeline:[{frame:0,digest:'same'},{frame:10,digest:'same-10'},{frame:20,digest:'live-20'}],activity:12,progress:6,sourceCounts:{planner:4,motion:8},outcome:9,invariantDigests:{physics:'p',seed:'s'}},
    baseline:{initialDigest:'same',timeline:[{frame:0,digest:'same'},{frame:10,digest:'same-10'},{frame:20,digest:'base-20'}],activity:9,progress:4,sourceCounts:{planner:0,motion:7},outcome:4,invariantDigests:{physics:'p',seed:'s'}}
  };
  const contract={firstDivergenceWindow:[15,25],minBaselineActivity:5,minBaselineProgress:2,removedSources:['planner'],preservedSources:['motion'],relevantEffect:{metric:'outcome',direction:'greater',minDelta:3},invariantDigests:['physics','seed']};
  const valid=ablation.analyzeAblationPair(pair,contract);
  ok(valid.ok&&valid.firstDivergence===20,'valid causal ablation rejected: '+valid.reasons.join(', '));
  let bad=copy(pair);bad.live.initialDigest='other';expectAblation('initial identity',bad,contract,ablation.REASONS.INITIAL_IDENTITY_MISMATCH);
  bad=copy(pair);bad.live.timeline=copy(bad.baseline.timeline);expectAblation('no divergence',bad,contract,ablation.REASONS.NO_DIVERGENCE);
  bad=copy(pair);bad.live.timeline[1].digest='early';expectAblation('early divergence',bad,contract,ablation.REASONS.DIVERGENCE_BEFORE_WINDOW);
  bad=copy(pair);bad.live.timeline.push({frame:30,digest:'late'});bad.live.timeline[2].digest=bad.baseline.timeline[2].digest;bad.baseline.timeline.push({frame:30,digest:'base-late'});expectAblation('late divergence',bad,contract,ablation.REASONS.DIVERGENCE_AFTER_WINDOW);
  bad=copy(pair);bad.baseline.activity=0;expectAblation('inactive baseline',bad,contract,ablation.REASONS.BASELINE_INACTIVE);
  bad=copy(pair);bad.baseline.progress=0;expectAblation('stalled baseline',bad,contract,ablation.REASONS.BASELINE_NO_PROGRESS);
  bad=copy(pair);bad.live.sourceCounts.planner=0;expectAblation('removed missing live',bad,contract,ablation.REASONS.REMOVED_SOURCE_MISSING_LIVE);
  bad=copy(pair);bad.baseline.sourceCounts.planner=1;expectAblation('removed survived',bad,contract,ablation.REASONS.REMOVED_SOURCE_PRESENT_BASELINE);
  bad=copy(pair);bad.live.sourceCounts.motion=0;expectAblation('preserved missing live',bad,contract,ablation.REASONS.PRESERVED_SOURCE_MISSING_LIVE);
  bad=copy(pair);bad.baseline.sourceCounts.motion=0;expectAblation('preserved missing baseline',bad,contract,ablation.REASONS.PRESERVED_SOURCE_MISSING_BASELINE);
  bad=copy(pair);bad.live.outcome=5;expectAblation('irrelevant effect',bad,contract,ablation.REASONS.IRRELEVANT_EFFECT);
  bad=copy(pair);bad.baseline.invariantDigests.physics='changed';expectAblation('invariant drift',bad,contract,ablation.REASONS.INVARIANT_DIGEST_MISMATCH);
  bad=copy(pair);bad.live.timeline=[];const empty=expectAblation('empty live schedule',bad,contract,ablation.REASONS.INVALID_TIMELINE_SCHEDULE);
  ok(!empty.reasons.includes(ablation.REASONS.NO_DIVERGENCE),'invalid empty schedule also reported a misleading no-divergence result');
  bad=copy(pair);bad.live.timeline[1].frame=bad.live.timeline[0].frame;expectAblation('duplicate live frame',bad,contract,ablation.REASONS.INVALID_TIMELINE_SCHEDULE);
  bad=copy(pair);bad.live.timeline[1].frame=10.5;expectAblation('fractional live frame',bad,contract,ablation.REASONS.INVALID_TIMELINE_SCHEDULE);
  bad=copy(pair);bad.baseline.timeline.splice(1,1);const mismatch=expectAblation('sparse baseline schedule',bad,contract,ablation.REASONS.TIMELINE_SCHEDULE_MISMATCH);
  ok(mismatch.firstDivergence===null&&!mismatch.reasons.includes(ablation.REASONS.DIVERGENCE_AFTER_WINDOW),'mismatched schedule fabricated a comparable divergence');
  console.log('  identity, exact timeline schedule, divergence timing, active baseline, source isolation, outcome, and invariants enforced');
}

if(failed){console.error('\nAMBIENT EVIDENCE EVAL FAILED');process.exit(1)}
console.log('\nAMBIENT EVIDENCE EVAL PASSED');
