#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');

// Observation only: this records the one shared application path and hunter
// continuity without changing decisions, physics, timing, or either RNG stream.
const FOOTER=String.raw`
globalThis.__hhApplied=[];
{const old=applyIntent;applyIntent=function(intent){const before={x:hunter.x,vx:hunter.vx},out=old(intent),after={x:hunter.x,vx:hunter.vx};
  globalThis.__hhApplied.push({runFrame,move:intent.move,action:!!intent.action,targetX:intent.targetX,tactic:intent.tactic,
    focus:intent.focus,wardSide:intent.wardSide,before,after});if(globalThis.__hhApplied.length>480)globalThis.__hhApplied.shift();return out;};}
globalThis.__hhClearApplied=()=>{globalThis.__hhApplied.length=0;};
globalThis.__hhLastApplied=()=>globalThis.__hhApplied.at(-1)||null;
globalThis.__hhContinuity={max:0,from:null,to:null};
{const old=applyIntent;applyIntent=function(intent){const from={x:hunter.x},out=old(intent),to={x:hunter.x},d=Math.abs(to.x-from.x);
  if(d>globalThis.__hhContinuity.max)globalThis.__hhContinuity={max:d,from,to};return out;};}
`;

let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const sum=(runs,key)=>runs.reduce((n,p)=>n+p.stats[key],0);
const containScore=p=>30*p.stats.floors+5*p.stats.captures+8*p.stats.blocks-
  22*p.stats.escapes-2*p.stats.spooks;
function inBands(p,bands,label){for(const[key,[lo,hi]]of Object.entries(bands)){
  const v=p.stats[key];if(v<lo||v>hi)fail(`${label}: ${key} ${v} outside measured band ${lo}..${hi}`);
}}
function actPairs(p,label,minPairs){
  const warn=p.actNotes.filter(n=>n.kind==='act-warning'),land=p.actNotes.filter(n=>n.kind==='act-land'),
    pending=warn.length===land.length+1&&p.act.phase==='warn'&&(!land.length||warn.at(-1).tag>land.at(-1).tag);
  if(land.length<minPairs||!(land.length===warn.length||pending))fail(`${label}: ${warn.length} warnings / ${land.length} lands`);
  for(let i=0;i<land.length;i++){
    if(land[i].tag-warn[i].tag!==240)fail(`${label}: simulation warning ${land[i].tag-warn[i].tag}f != 240`);
    if(land[i].at-warn[i].at!==240)fail(`${label}: viewer warning ${land[i].at-warn[i].at}f != 240`);
    if(warn[i].landsAt-warn[i].at!==240)fail(`${label}: warning landsAt was not +240`);
  }
}

// Registered 2026-07-10 from ten paired five-minute seeds
// (0x6a00 + i*41), with __NO_LAPSE on both policies so the only delta is the
// containment planner. The smart/reactive extrema were: floors 16..18,
// captures 35..40, escapes 0..15, sweeps 36..109, blocks 0..16,
// spooks 32..54, events 707..827, progress 44..85. These shared bands leave
// measured margin without letting either policy stop honestly playing.
const POLICY_BANDS={floors:[15,20],captures:[32,43],reveals:[32,60],sweeps:[32,115],emptySweeps:[0,85],
  escapes:[0,18],repossessions:[0,18],wards:[0,36],blocks:[0,18],planBreaks:[0,40],spooks:[28,60],
  acts:[3,5],lapses:[0,0],events:[650,900],progress:[40,92],distance:[7400,11000]};

// Registered from twelve independent ten-minute seeds
// (0x6c00 + i*97). Measured extrema: 34..35 floors, 76..79 captures,
// 79..83 reveals, 3..5 vent escapes/repossessions, 60..65 wards,
// 20..33 blocks, 74..83 spooks, 1..6 lapse onsets, 1504..1536 events,
// 110..116 progress marks, 177..227f event lulls, 1008..1370f story lulls.
const SOAK_BANDS={floors:[33,36],rooms:[66,72],captures:[73,82],reveals:[76,86],sweeps:[76,86],
  emptySweeps:[0,2],escapes:[2,7],repossessions:[2,7],wards:[57,68],blocks:[17,36],planBreaks:[4,14],
  spooks:[70,87],acts:[8,8],lapses:[1,8],events:[1470,1570],progress:[107,120],distance:[17800,19000]};

console.log('1) fixed 60 Hz replay, chunk, render, and finite-state parity');
{
  const a=bootGame('hotel-haunt',{seed:0x6901,footer:FOOTER}),b=bootGame('hotel-haunt',{seed:0x6901,footer:FOOTER}),
    rendered=bootGame('hotel-haunt',{seed:0x6901,footer:FOOTER});
  a.frames(3600,false);b.frames(3600,false);const draws=rendered.frames(3600,true);
  const sa=a.sandbox.__hotelHauntSignature(),sb=b.sandbox.__hotelHauntSignature(),sr=rendered.sandbox.__hotelHauntSignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${draws.calls} draw calls`);
  if(sa!==sb)fail('same-seed fixed-step replay diverged');
  if(sa!==sr)fail('render traversal changed simulation or RNG state');
  if(!a.sandbox.__hotelHauntProbe().finite||!rendered.sandbox.__hotelHauntProbe().finite)fail('headless or rendered state became non-finite');
  if(draws.calls<10000||!draws.byMethod.fillRect||!draws.byMethod.beginPath||!draws.byMethod.fillText)
    fail(`real renderer was not exercised: ${JSON.stringify(draws.byMethod)}`);
  const mono=bootGame('hotel-haunt',{seed:0x6902,footer:FOOTER}),chunk=bootGame('hotel-haunt',{seed:0x6902,footer:FOOTER});
  mono.frames(3000,false);for(let i=0;i<300;i++)chunk.frames(10,false);
  const same=mono.sandbox.__hotelHauntSignature()===chunk.sandbox.__hotelHauntSignature();
  console.log(`  3,000 frames monolithic vs 300 x 10: ${same?'identical':'DIFFERENT'}`);
  if(!same)fail('chunking changed fixed-step simulation');
}

console.log('2) vent-aware planning is pure, repeatable, and engine-RNG inert');
{
  const planned=bootGame('hotel-haunt',{seed:0x6910}),control=bootGame('hotel-haunt',{seed:0x6910}),
    fixture=planned.sandbox.__hotelHauntPlannerFixture();
  const nr=planned.sandbox.__hotelHauntNextRandom(),cr=control.sandbox.__hotelHauntNextRandom();
  console.log(`  pure ${fixture.pure}; repeat ${fixture.repeat}; smart ${fixture.a.join(',')}; baseline ${fixture.baseline.join(',')}; RNG ${nr.toFixed(8)}/${cr.toFixed(8)}`);
  if(!fixture.pure||!fixture.repeat||fixture.before!==fixture.after)fail(`planner mutated live state: ${JSON.stringify(fixture)}`);
  if(!fixture.a.length||!fixture.baseline.length)fail('planner fixture returned no sweep order');
  if(nr!==cr)fail('planning consumed engine RNG for simulation-invisible work');
}

console.log('3) baseline-first containment A/B: ten paired five-minute seeds');
{
  const smart=[],baseline=[];let wins=0,escapeWins=0,floorGuards=0;
  for(let i=0;i<10;i++){
    const seed=0x6a00+i*41,a=bootGame('hotel-haunt',{seed,footer:FOOTER}),b=bootGame('hotel-haunt',{seed,footer:FOOTER});
    a.sandbox.__NO_LAPSE=1;b.sandbox.__NO_LAPSE=1;b.sandbox.__NO_CONTAIN_PLAN=1;
    a.frames(18000,false);b.frames(18000,false);const pa=a.sandbox.__hotelHauntProbe(),pb=b.sandbox.__hotelHauntProbe();
    smart.push(pa);baseline.push(pb);const sa=containScore(pa),sb=containScore(pb);if(sa>sb)wins++;if(pa.stats.escapes<pb.stats.escapes)escapeWins++;if(pa.stats.floors>=pb.stats.floors)floorGuards++;
    inBands(pa,POLICY_BANDS,`${seed.toString(16)} planned`);inBands(pb,POLICY_BANDS,`${seed.toString(16)} reactive`);
    if(!pa.finite||!pb.finite)fail(`${seed.toString(16)}: policy run became non-finite`);
    console.log(`  ${seed.toString(16)} score ${sa}/${sb}; floors ${pa.stats.floors}/${pb.stats.floors}; `+
      `escapes ${pa.stats.escapes}/${pb.stats.escapes}; blocks ${pa.stats.blocks}/${pb.stats.blocks}; sweeps ${pa.stats.sweeps}/${pb.stats.sweeps}`);
  }
  const score=[smart.reduce((n,p)=>n+containScore(p),0),baseline.reduce((n,p)=>n+containScore(p),0)],
    escapes=[sum(smart,'escapes'),sum(baseline,'escapes')],blocks=[sum(smart,'blocks'),sum(baseline,'blocks')],
    sweeps=[sum(smart,'sweeps'),sum(baseline,'sweeps')],floors=[sum(smart,'floors'),sum(baseline,'floors')],basePlay={floors:sum(baseline,'floors'),captures:sum(baseline,'captures'),events:sum(baseline,'events')};
  console.log(`  ${wins}/10 score wins, ${escapeWins}/10 escape wins, ${floorGuards}/10 floor guards; aggregate score ${score[0]}/${score[1]}, floors ${floors[0]}/${floors[1]}, escapes ${escapes[0]}/${escapes[1]}, blocks ${blocks[0]}/${blocks[1]}, sweeps ${sweeps[0]}/${sweeps[1]}`);
  if(wins<9||escapeWins<9||floorGuards<9||floors[0]<floors[1]||score[0]<score[1]*1.7||escapes[0]>escapes[1]*.25||blocks[0]<80||sweeps[0]>sweeps[1]*.42)
    fail(`containment win regressed: ${JSON.stringify({wins,escapeWins,floorGuards,score,floors,escapes,blocks,sweeps})}`);
  if(basePlay.floors<160||basePlay.captures<360||basePlay.events<7600||escapes[1]<120)
    fail(`__NO_CONTAIN_PLAN baseline stopped honestly participating: ${JSON.stringify(basePlay)}`);
}

console.log('4) MIDNIGHT CHECK-IN changes physical behavior during an exact 240f warning');
{
  const a=bootGame('hotel-haunt',{seed:0x6b10,footer:FOOTER}),b=bootGame('hotel-haunt',{seed:0x6b10,footer:FOOTER});
  a.sandbox.__hotelHauntArmActFixture();b.sandbox.__hotelHauntArmActFixture();b.sandbox.__NO_ACTS=1;
  if(a.sandbox.__hotelHauntPhysical()!==b.sandbox.__hotelHauntPhysical())fail('paired act fixture did not start physically identical');
  let first=-1,phase='',tactic='';
  for(let frame=1;frame<=270;frame++){
    a.frames(1,false);b.frames(1,false);
    if(first<0&&a.sandbox.__hotelHauntPhysical()!==b.sandbox.__hotelHauntPhysical()){
      first=frame;const p=a.sandbox.__hotelHauntProbe();phase=p.act.phase;tactic=p.hunter.tactic;
    }
  }
  const pa=a.sandbox.__hotelHauntProbe(),pb=b.sandbox.__hotelHauntProbe(),warn=pa.actNotes.find(n=>n.kind==='act-warning'),land=pa.actNotes.find(n=>n.kind==='act-land');
  console.log(`  first physical divergence ${first}f in ${phase} (${tactic}); warning ${warn&&land?land.tag-warn.tag:'?'}f`);
  if(first<1||first>=240||phase!=='warn')fail('bot did not physically pre-contain during warning');
  if(!warn||!land||land.tag-warn.tag!==240||land.at-warn.at!==240)fail('warning/land span was not exactly 240 frames');
  if(pb.actNotes.length)fail('__NO_ACTS emitted act notes');
  const reset=bootGame('hotel-haunt',{seed:0x6b11,footer:FOOTER});reset.sandbox.__hotelHauntArmActFixture();reset.frames(100,false);
  reset.sandbox.__hotelHauntReset();reset.frames(300,false);const pr=reset.sandbox.__hotelHauntProbe();
  if(pr.actNotes.some(n=>n.kind==='act-land'))fail('reset during warning emitted a stale act land');
}

console.log('5) human and bot intents share one runtime physics path');
{
  const game=bootGame('hotel-haunt',{seed:0x6b20,footer:FOOTER}),schema=game.sandbox.__hotelHauntIntentFixture();
  const initial=game.engine.sessionProbe();press(game,'Enter');const instructions=game.engine.sessionProbe();press(game,'Enter');const started=game.engine.sessionProbe();
  game.sandbox.__hhClearApplied();game.key('keydown','ArrowLeft');game.frames(6,false);game.key('keyup','ArrowLeft');const move=game.sandbox.__hhLastApplied();
  game.sandbox.__hhClearApplied();game.key('keydown','Space');game.frames(3,false);game.key('keyup','Space');const action=game.sandbox.__hhLastApplied();
  console.log(`  session ${initial.mode}->${instructions.mode}->${started.mode}; schema ${schema.humanKeys.join(',')}; move ${move&&move.move}; action ${action&&action.action}`);
  if(initial.mode!=='attract'||instructions.mode!=='instructions'||started.mode!=='playing')fail('manual session skipped the two-Enter gate');
  if(schema.humanKeys.join('|')!==schema.botKeys.join('|'))fail(`intent schemas differ: ${JSON.stringify(schema)}`);
  if(!move||move.move!==-1||move.tactic!=='MANUAL')fail('manual movement did not traverse applyIntent');
  if(!action||!action.action||action.tactic!=='VACUUM / SWEEP')fail('manual action did not traverse applyIntent');
  if(!game.sandbox.__hotelHauntProbe().finite)fail('manual physics became non-finite');
}

console.log('6) ten-minute autoplay soaks, measured watchability bands, acts, and exact SHOW budgets');
// 0x9093 is the original floor-transition report; under the faster containment
// policy 0x729b is the replay that would stretch warning #4 to 440f without the
// floor-clear gate. Both stay inside the registered ten-minute bands.
for(const seed of[0x6c00,0x6ea7,0x9093,0x729b]){
  const{game,samples}=runSoak('hotel-haunt',{seed,minutes:10,footer:FOOTER}),report=analyzeSoak(samples),p=game.sandbox.__hotelHauntProbe(),
    shown=p.show.shownByTier,offered=p.show.offeredByTier,s3=shown[3]||0;
  console.log(`  ${seed.toString(16)} ${soakLine(report)}; floors ${p.stats.floors}, captures ${p.stats.captures}, `+
    `escapes ${p.stats.escapes}, repossessions ${p.stats.repossessions}, tiers ${JSON.stringify(shown)}`);
  assertSoak(seed.toString(16),report,{still:2,quiet:4,stall:30,minEvents:1470,minProgress:107},fail);
  inBands(p,SOAK_BANDS,`${seed.toString(16)} soak`);actPairs(p,seed.toString(16),7);
  if(p.stats.maxEventLull>300||p.stats.maxProgressLull>2100)fail(`${seed.toString(16)}: pacing lull ${p.stats.maxEventLull}/${p.stats.maxProgressLull}f`);
  if(!((offered[1]||0)>(offered[2]||0)&&(offered[2]||0)>(offered[3]||0)&&(offered[3]||0)>=6))fail(`${seed.toString(16)}: offered ladder not ordered ${JSON.stringify(offered)}`);
  if(!((shown[1]||0)>(shown[2]||0)&&(shown[2]||0)>(shown[3]||0)&&(shown[3]||0)>=6))fail(`${seed.toString(16)}: shown ladder not ordered ${JSON.stringify(shown)}`);
  if(p.show.heldFrames!==6*s3||p.stats.heldFrames!==6*s3)fail(`${seed.toString(16)}: held ${p.show.heldFrames}/${p.stats.heldFrames} != 6*${s3}`);
  if(p.show.slowedFrames!==24*s3||p.stats.slowedFrames!==24*s3)fail(`${seed.toString(16)}: slowed ${p.show.slowedFrames}/${p.stats.slowedFrames} != 24*${s3}`);
  if(p.show.admireFrames!==48*s3||p.stats.admireFrames!==48*s3)fail(`${seed.toString(16)}: admire ${p.show.admireFrames}/${p.stats.admireFrames} != 48*${s3}`);
  if(game.sandbox.__hhContinuity.max>1.3)fail(`${seed.toString(16)}: hunter jumped ${game.sandbox.__hhContinuity.max.toFixed(2)}px in one physics step`);
}
{
  const admire=bootGame('hotel-haunt',{seed:0x6901}),gated=bootGame('hotel-haunt',{seed:0x6901}),manualRun=bootGame('hotel-haunt',{seed:0x6901});gated.sandbox.__NO_ADMIRE=1;
  let paused=false,resumed=false,gatedMoved=false,manualMoved=false,manualArmed=false,pauseAt=-1,resumeAt=-1,
    prevA=admire.sandbox.__hotelHauntProbe().hunter.x,prevB=gated.sandbox.__hotelHauntProbe().hunter.x,prevM=manualRun.sandbox.__hotelHauntProbe().hunter.x;
  for(let frame=1;frame<=9000&&!resumed;frame++){
    admire.frames(1,false);gated.frames(1,false);manualRun.frames(1,false);const pa=admire.sandbox.__hotelHauntProbe(),pb=gated.sandbox.__hotelHauntProbe(),pm=manualRun.sandbox.__hotelHauntProbe(),
      da=Math.abs(pa.hunter.x-prevA),db=Math.abs(pb.hunter.x-prevB),dm=Math.abs(pm.hunter.x-prevM),wing=pa.show.active&&pa.show.active.id==='wing';
    if(wing&&!manualArmed){manualRun.key('keydown','ArrowRight');manualRun.key('keyup','ArrowRight');manualArmed=true}
    if(!paused&&!wing&&admire.sandbox.__hotelHauntPhysical()!==gated.sandbox.__hotelHauntPhysical())fail(`__NO_ADMIRE diverged before the live wing apex at frame ${frame}`);
    if(wing&&pa.phase==='relight'&&pa.hunter.tactic==='ADMIRE THE WING'){
      if(!paused){paused=true;pauseAt=frame}
      if(da>1e-9)fail(`live admire moved the hunter ${da}px at frame ${frame}`);
      if(db>.05)gatedMoved=true;
      if(pm.phase==='relight'&&pm.hunter.tactic==='ROOMS RELIT'&&dm>.05)manualMoved=true;
    }else if(paused&&pa.phase==='relight'&&pa.hunter.tactic==='ROOMS RELIT'&&da>.05){resumed=true;resumeAt=frame}
    prevA=pa.hunter.x;prevB=pb.hunter.x;prevM=pm.hunter.x;
  }
  console.log(`  live wing admire paused @${pauseAt}, gated/manual relight moved ${gatedMoved}/${manualMoved}, normal relight resumed @${resumeAt}`);
  if(!paused||!gatedMoved||!manualMoved||!resumed)fail(`live __NO_ADMIRE A/B failed: ${JSON.stringify({paused,gatedMoved,manualMoved,resumed,pauseAt,resumeAt})}`);
  const perfect=bootGame('hotel-haunt',{seed:0x6f91});perfect.sandbox.__NO_LAPSE=1;perfect.frames(18000,false);
  if(perfect.sandbox.__hotelHauntProbe().stats.lapses!==0)fail('__NO_LAPSE did not eliminate skill-profile lapse onsets');
}

console.log('7) payoff FX is a perfect same-seed simulation no-op');
{
  const a=bootGame('hotel-haunt',{seed:0x7000,footer:FOOTER}),b=bootGame('hotel-haunt',{seed:0x7000,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);const same=a.sandbox.__hotelHauntSignature()===b.sandbox.__hotelHauntSignature(),p=a.sandbox.__hotelHauntProbe();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} through ${p.stats.captures} captures, ${p.stats.escapes} escapes, ${p.stats.floors} relit floors`);
  if(!same)fail('__NO_PAYOFF_FX changed simulation state');
  if(p.stats.captures<25||p.stats.floors<10)fail('FX no-op window did not exercise payoff ladder');
}

console.log(failed?'\nHOTEL HAUNT EVAL FAILED':'\nHOTEL HAUNT EVAL PASSED');
process.exit(failed?1:0);
