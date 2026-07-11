#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const score=p=>p.stats.flags*80+p.stats.distance*2+p.stats.hits*4-p.stats.wipeouts*18-p.stats.collisions*3;
const sum=(runs,key)=>runs.reduce((n,p)=>n+p.stats[key],0);
const notePairs=(probe,id)=>{
  const notes=probe.act.notes.filter(n=>n.id===id),warn=notes.filter(n=>n.kind==='act-warning'),land=notes.filter(n=>n.kind==='act-land');
  if(warn.length!==land.length)fail(`${id}: ${warn.length} warnings / ${land.length} lands`);
  for(let i=0;i<Math.min(warn.length,land.length);i++)if(land[i].at-warn[i].at!==240||land[i].tag-warn[i].tag!==240)
    fail(`${id}: warning ${i} lasted ${land[i].at-warn[i].at}/${land[i].tag-warn[i].tag}f, expected 240/240`);
  return land.length;
};
const inBands=(p,bands,label)=>{for(const[k,[lo,hi]]of Object.entries(bands)){
  const v=p.stats[k];if(v<lo||v>hi)fail(`${label}: ${k} ${v} outside measured band ${lo}..${hi}`);
}};

// Measured 2026-07-10 over twenty fixed ten-minute seeds (0xa100+i*137).
// Observed: 56..64 flags, 859..948 distance, 21..59 collision participants,
// 1..11 physical 3-bot pileups, 7..23 wipeouts, 2..10 crusher hits,
// 4..25 oil spins, 8..18 last-card disasters, 20..42 skill lapses,
// 1068..1181 events, 700..782 progress, and 7..8 arena changes. These
// shipping bands retain margin on both sides rather than rewarding a sterile,
// perfect bot or an inert one.
const TEN_MINUTE_BANDS={
  rounds:[76,85],registers:[360,410],moves:[750,900],distance:[820,1020],flags:[48,72],
  stageChanges:[5,9],collisions:[15,65],pileups:[1,12],shots:[165,230],hits:[15,50],
  wipeouts:[4,28],conveyors:[38,90],crushes:[1,13],oils:[3,30],pits:[0,10],
  lastInstructionDisasters:[6,24],lapses:[16,50],acts:[9,9],surprises:[1,12],
  events:[1020,1220],progress:[650,830]
};

// Baseline-first panel, then forecast implementation, measured over eight
// paired five-minute seeds (0x9200+i*101). Combined policy extrema with margin:
// flags 3..33, distance 147..500, collisions 11..31, wipeouts 4..13,
// shots 48..112, events 299..606, progress 114..416. Both policies must stay
// inside the same contracts while the forecast wins; winning by becoming a
// bloodless time trial or by killing the baseline would fail here.
const POLICY_BANDS={flags:[2,40],distance:[130,540],collisions:[8,38],pileups:[0,8],
  wipeouts:[2,15],crushes:[0,9],oils:[1,20],shots:[44,120],hits:[0,26],
  lastInstructionDisasters:[1,15],lapses:[8,24],acts:[4,4],events:[270,640],progress:[90,460]};

console.log('1) deterministic fixed-step replay, chunking, render parity, and finite renderer');
{
  const a=bootGame('robo-rally',{seed:0x9001}),b=bootGame('robo-rally',{seed:0x9001}),rendered=bootGame('robo-rally',{seed:0x9001});
  a.frames(9000,false);b.frames(9000,false);const draws=rendered.frames(9000,true);
  const sa=a.sandbox.__roboRallySignature(),sb=b.sandbox.__roboRallySignature(),sr=rendered.sandbox.__roboRallySignature();
  console.log(`  same seed ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${draws.calls} canvas calls`);
  if(sa!==sb)fail('same-seed fixed-step replay diverged');if(sa!==sr)fail('render traversal changed simulation or RNG state');
  if(!a.sandbox.__roboRallyProbe().finite||draws.calls<10000||!draws.byMethod.fillRect||!draws.byMethod.beginPath)fail('finite real renderer was not exercised');
  const mono=bootGame('robo-rally',{seed:0x9002}),chunked=bootGame('robo-rally',{seed:0x9002});mono.frames(3600,false);for(let i=0;i<360;i++)chunked.frames(10,false);
  if(mono.sandbox.__roboRallySignature()!==chunked.sandbox.__roboRallySignature())fail('batched stepping changed the fixed 60 Hz result');
}

console.log('2) forecast planner is copied-state pure, repeatable, and engine-RNG inert');
{
  const planned=bootGame('robo-rally',{seed:0x9010}),control=bootGame('robo-rally',{seed:0x9010}),f=planned.sandbox.__roboRallyPlannerFixture();
  const rp=planned.sandbox.__roboRallyNextRandom(),rc=control.sandbox.__roboRallyNextRandom();
  console.log(`  pure ${f.pure}; repeat ${f.repeat}; next RNG ${rp.toFixed(8)}/${rc.toFixed(8)}`);
  if(!f.pure||!f.repeat||!f.finite||f.programs.length!==4||f.programs.some(p=>p.length!==5))fail('forecast fixture regressed');
  if(rp!==rc)fail('forecast consumed engine RNG for simulation-invisible work');
}

console.log('3) exact shared intent schema and manual register traverse the common apply path');
{
  const game=bootGame('robo-rally',{seed:0x9020}),schemas=game.sandbox.__roboRallyIntentSchemas();
  if(schemas.humanKeys.join('|')!==schemas.botKeys.join('|'))fail(`human/bot schemas differ: ${JSON.stringify(schemas)}`);
  press(game,'Enter');press(game,'Enter');game.key('keydown','ArrowRight');game.frames(190,false);game.key('keyup','ArrowRight');
  const p=game.sandbox.__roboRallyProbe(),brass=p.robots[0];
  console.log(`  schema ${schemas.humanKeys.join(',')}; BRASS ${brass.tactic}; ${p.stats.appliedIntents} applied intents`);
  if(!p.playing||brass.tactic!=='MANUAL REGISTER'||p.stats.appliedIntents<4)fail('manual intent did not pass through simultaneous runtime application');
}

console.log('3b) simultaneous register outcome is invariant to racer array order');
{
  const a=bootGame('robo-rally',{seed:0x9021}).sandbox.__roboRallyOrderFixture(false),b=bootGame('robo-rally',{seed:0x9021}).sandbox.__roboRallyOrderFixture(true);
  console.log(`  forward/reversed ${JSON.stringify(a)===JSON.stringify(b)?'identical':'DIFFERENT'}; victim card ${a.actors[1].cmd} completed at row ${a.actors[1].r} before knockout`);
  if(JSON.stringify(a)!==JSON.stringify(b))fail(`register result depends on robot array order: ${JSON.stringify({a,b})}`);
  if(!a.victimCompleted||a.stats.shots!==1||a.stats.hits!==1||a.stats.wipeouts!==1||a.stats.appliedIntents!==4)fail(`snapshot register fixture regressed: ${JSON.stringify(a)}`);
}

console.log('3c) simultaneous conveyors resolve conflicts from one board snapshot');
{
  const a=bootGame('robo-rally',{seed:0x9022}).sandbox.__roboRallyBoardOrderFixture(false),b=bootGame('robo-rally',{seed:0x9022}).sandbox.__roboRallyBoardOrderFixture(true);
  console.log(`  forward/reversed ${JSON.stringify(a)===JSON.stringify(b)?'identical':'DIFFERENT'}; converging belts held ${a.conflictHeld}`);
  if(JSON.stringify(a)!==JSON.stringify(b)||!a.conflictHeld||!a.finite)fail(`board effects depend on robot array order: ${JSON.stringify({a,b})}`);
}

console.log('4) payoff FX is a perfect same-seed simulation no-op');
{
  const a=bootGame('robo-rally',{seed:0x9030}),b=bootGame('robo-rally',{seed:0x9030});b.sandbox.__NO_PAYOFF_FX=1;
  a.frames(24000,false);b.frames(24000,false);const same=a.sandbox.__roboRallySignature()===b.sandbox.__roboRallySignature();
  console.log('  400 seconds with/without payoff FX: '+(same?'identical':'DIFFERENT'));if(!same)fail('__NO_PAYOFF_FX changed simulation state');
}

console.log('5) paired forecast A/B beats the hazard-blind program release inside shared bands');
{
  const smart=[],baseline=[];let wins=0;
  for(let i=0;i<8;i++){
    const seed=0x9200+i*101,a=bootGame('robo-rally',{seed}),b=bootGame('robo-rally',{seed});
    b.sandbox.__NO_FORECAST=1;a.sandbox.__roboRallyReset();b.sandbox.__roboRallyReset();a.frames(18000,false);b.frames(18000,false);
    const pa=a.sandbox.__roboRallyProbe(),pb=b.sandbox.__roboRallyProbe(),sa=score(pa),sb=score(pb);smart.push(pa);baseline.push(pb);if(sa>sb)wins++;
    inBands(pa,POLICY_BANDS,`${seed.toString(16)} forecast`);inBands(pb,POLICY_BANDS,`${seed.toString(16)} baseline`);
    console.log(`  ${seed.toString(16)} ${sa}/${sb} · flags ${pa.stats.flags}/${pb.stats.flags} · collisions ${pa.stats.collisions}/${pb.stats.collisions}`);
  }
  const aggregate=[smart.reduce((n,p)=>n+score(p),0),baseline.reduce((n,p)=>n+score(p),0)],flags=[sum(smart,'flags'),sum(baseline,'flags')];
  console.log(`  ${wins}/8 wins; aggregate ${aggregate[0]}/${aggregate[1]}; flags ${flags[0]}/${flags[1]}`);
  if(wins<7||aggregate[0]<aggregate[1]*2.5||flags[0]<flags[1]*2.2)fail('forecast did not deliver a clear paired win');
}

console.log('6) environmental acts reprogram racers during the warning, then land exactly');
for(const type of['crusher-rush','polarity-flip']){
  const a=bootGame('robo-rally',{seed:0x9700}),b=bootGame('robo-rally',{seed:0x9700});
  a.sandbox.__roboRallyActFixture(type);b.sandbox.__roboRallyActFixture(type);b.sandbox.__NO_ACTS=1;
  if(a.sandbox.__roboRallyPhysical()!==b.sandbox.__roboRallyPhysical())fail(`${type}: paired fixture did not begin physically identical`);
  let first=-1,firstPhase='';for(let f=1;f<=260;f++){a.frames(1,false);b.frames(1,false);if(first<0&&a.sandbox.__roboRallyPhysical()!==b.sandbox.__roboRallyPhysical()){
    first=f;firstPhase=a.sandbox.__roboRallyProbe().act.phase;}}
  const pa=a.sandbox.__roboRallyProbe(),pb=b.sandbox.__roboRallyProbe();notePairs(pa,type);
  console.log(`  ${type}: first applied-intent divergence ${first}f in ${firstPhase}; warning ${pa.act.notes[1].at-pa.act.notes[0].at}f`);
  if(first<0||first>=240||firstPhase!=='warn')fail(`${type}: bot did not visibly change before act land`);
  if(pb.act.notes.length)fail(`${type}: __NO_ACTS still emitted notes`);
}

console.log('7) ten-minute autoplay soaks: moving, active, progressing, and dramatic');
for(const seed of[0xa100,0xa324]){
  const{game,samples}=runSoak('robo-rally',{seed,minutes:10}),report=analyzeSoak(samples),p=game.sandbox.__roboRallyProbe();
  console.log(`  ${seed.toString(16)} ${soakLine(report)} · ${p.stats.flags} flags, ${p.stats.pileups} pileups, ${p.stats.lastInstructionDisasters} last cards`);
  assertSoak(seed.toString(16),report,{still:6,quiet:5,stall:12,minEvents:1000,minProgress:640},m=>fail(m));
  inBands(p,TEN_MINUTE_BANDS,seed.toString(16));
  if(p.stats.invisibleRescues!==0||p.maxEventLull>300||p.maxProgressLull>1000)fail(`${seed.toString(16)}: invisible rescue or pacing lull ${p.maxEventLull}/${p.maxProgressLull}`);
}

console.log('8) skill-profile imperfection fires, ablates cleanly, and show budgets are exact');
{
  const normal=bootGame('robo-rally',{seed:0x9800}),perfect=bootGame('robo-rally',{seed:0x9800});perfect.sandbox.__NO_LAPSE=1;
  normal.sandbox.__roboRallyReset();perfect.sandbox.__roboRallyReset();normal.frames(18000,false);perfect.frames(18000,false);
  const pn=normal.sandbox.__roboRallyProbe(),pp=perfect.sandbox.__roboRallyProbe();
  if(pn.stats.lapses<8||pn.stats.lapses>24||pp.stats.lapses!==0)fail(`skill-profile lapse contract ${pn.stats.lapses}/${pp.stats.lapses}`);
  const long=bootGame('robo-rally',{seed:0xa324});long.frames(36000,false);const p=long.sandbox.__roboRallyProbe(),shown=p.show.shownByTier,s3=shown[3]||0;
  console.log(`  lapses ${pn.stats.lapses}/0; shown tiers ${JSON.stringify(shown)}; budgets ${p.stats.heldFrames}/${p.stats.slowedFrames}/${p.stats.admireFrames}`);
  if(!((shown[1]||0)>(shown[2]||0)&&(shown[2]||0)>s3&&s3>=5))fail('show tiers are not strictly ordered');
  if(p.stats.heldFrames!==6*s3||p.stats.slowedFrames!==24*s3||p.stats.admireFrames!==48*s3)fail('apex show time budgets drifted');
  if(notePairs(p,'crusher-rush')<4||notePairs(p,'polarity-flip')<3)fail('ten-minute act warning/land cadence regressed');
  const admire=long.sandbox.__roboRallyAdmireFixture();if(admire.admired.tactic!=='ADMIRE THE WRECK'||admire.gated.tactic==='ADMIRE THE WRECK')fail('__NO_ADMIRE did not gate the bot pause');
}

if(failed){console.error('\nROBO RALLY EVALS FAILED');process.exit(1);}
console.log('\nROBO RALLY EVALS PASSED');
