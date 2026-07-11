#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');

const FOOTER=String.raw`
globalThis.__ccApplied=[];
{const old=applyIntent;applyIntent=function(intent){const before=plan&&{angle:plan.angle,power:plan.power},out=old(intent),after=plan&&{angle:plan.angle,power:plan.power};globalThis.__ccApplied.push({intent:Object.assign({},intent),before,after});if(globalThis.__ccApplied.length>240)globalThis.__ccApplied.shift();return out;};}
globalThis.__ccLastApplied=()=>globalThis.__ccApplied.at(-1)||null;
`;

let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code)};
const score=s=>s.blocks+s.breaches*12+s.bigCollapses*4-s.misses*3;
const sum=(runs,key)=>runs.reduce((n,p)=>n+p.stats[key],0);
function bands(stats,spec,label){for(const[key,[lo,hi]]of Object.entries(spec)){const value=stats[key];if(value<lo||value>hi)fail(label+': '+key+' '+value+' outside measured band '+lo+'..'+hi)}}
function notePairs(p,label,minPairs){
  const warn=p.act.notes.filter(n=>n.kind==='act-warning'),land=p.act.notes.filter(n=>n.kind==='act-land'),pending=warn.length===land.length+1&&p.act.phase==='warn';
  if(land.length<minPairs||!(warn.length===land.length||pending))fail(label+': warning/land pairing '+warn.length+'/'+land.length);
  for(let i=0;i<land.length;i++)if(land[i].at-warn[i].at!==240||land[i].tag-warn[i].tag!==240)fail(label+': act pair '+i+' was not exactly 240 frames');
}

// Baseline-first receipt, 2026-07-10. The working center-mass policy was
// measured before collapse planning over ten fixed five-minute seeds
// (0xc100 + i*233): 32..33 shots, 24..29 hits, 3..9 misses, 144..207 fallen
// blocks, 18..26 cascades, 20..27 breaches, 279..294 events, and 64..81
// progress marks. The accepted support-graph policy was then paired on the
// first eight of those seeds after final SHOW pacing. It won 8/8: composite
// 5,301 vs 4,047, blocks 1,821 vs 1,384 (+31%), and breaches 232 vs 189
// (+23%). Both policies retain shorts, true shots, fortunate overperformance,
// misses, and skill-profile lapses.
const SMART_POLICY_BANDS={shots:[31,35],hits:[24,34],misses:[0,8],shorts:[0,9],longs:[0,8],trueShots:[16,28],fortuneShots:[1,11],blocks:[195,270],cascades:[24,34],bigCollapses:[16,32],breaches:[24,34],lapses:[1,15],acts:[5,5],events:[270,325],progress:[70,106],maxEventLull:[0,240],maxProgressLull:[300,1600]};
const BASE_POLICY_BANDS={shots:[31,35],hits:[18,33],misses:[0,15],shorts:[3,15],longs:[0,14],trueShots:[8,22],fortuneShots:[1,11],blocks:[105,225],cascades:[12,28],bigCollapses:[9,25],breaches:[14,29],lapses:[1,15],acts:[5,5],events:[265,320],progress:[48,90],maxEventLull:[0,240],maxProgressLull:[700,1700]};

// Thirty independent ten-minute seeds (0xcc000 + i*233) calibrated the
// shipping contract after the high-arc planner, forecast uncertainty, gust
// act, and final SHOW cadence. Observed: shots 64..65, hits 56..63, misses
// 1..9, shorts 6..15, longs 1..9, true shots 32..49, fortune shots 5..19,
// blocks 407..521, cascades 54..63, big collapses 38..60, breaches 54..63,
// lapses 5..18, events 567..593, progress 163..188, event lull exactly 212f,
// and progress lull 848..1385f. Bands retain measured margin on both sides.
const SOAK_BANDS={shots:[62,68],hits:[52,66],misses:[0,12],shorts:[4,18],longs:[1,12],trueShots:[28,53],fortuneShots:[3,22],blocks:[380,550],cascades:[50,67],bigCollapses:[34,65],breaches:[50,67],builds:[62,68],upgrades:[49,66],lapses:[3,22],acts:[11,11],smartPlans:[62,72],announcements:[62,72],events:[540,620],progress:[150,202],maxEventLull:[0,240],maxProgressLull:[360,1650]};

console.log('1) fixed 60 Hz determinism, rendered/headless parity, chunk parity, and finite renderer');
{
  const a=bootGame('castle-crasher',{seed:0xcc451,footer:FOOTER}),b=bootGame('castle-crasher',{seed:0xcc451,footer:FOOTER}),rendered=bootGame('castle-crasher',{seed:0xcc451,footer:FOOTER});
  a.frames(2400,false);b.frames(2400,false);const draws=rendered.frames(2400,true),sa=a.sandbox.__castleCrasherSignature(),sb=b.sandbox.__castleCrasherSignature(),sr=rendered.sandbox.__castleCrasherSignature();
  console.log('  same seed '+(sa===sb?'identical':'DIFFERENT')+', rendered '+(sa===sr?'identical':'DIFFERENT')+', '+draws.calls+' canvas calls');
  if(sa!==sb)fail('same seed diverged');if(sa!==sr)fail('render traversal changed simulation or RNG');
  if(!a.sandbox.__castleCrasherProbe().finite||!rendered.sandbox.__castleCrasherProbe().finite)fail('finite replay contract failed');
  if(draws.calls<20000||!draws.byMethod.fillRect||!draws.byMethod.beginPath||!draws.byMethod.fillText)fail('renderer was not genuinely exercised: '+JSON.stringify(draws.byMethod));
  const mono=bootGame('castle-crasher',{seed:0xcc452}),chunked=bootGame('castle-crasher',{seed:0xcc452});mono.frames(3600,false);for(let i=0;i<360;i++)chunked.frames(10,false);
  if(mono.sandbox.__castleCrasherSignature()!==chunked.sandbox.__castleCrasherSignature())fail('monolithic and chunked fixed steps diverged');
}

console.log('2) structural planner is pure, repeatable, RNG-inert, announces a real collapse, and shares the human schema');
{
  const planned=bootGame('castle-crasher',{seed:0xcc460}),control=bootGame('castle-crasher',{seed:0xcc460}),fixture=planned.sandbox.__castleCrasherPlannerFixture(),schema=planned.sandbox.__castleCrasherIntentFixture();
  const nextPlanned=planned.sandbox.__castleCrasherNextRandom(),nextControl=control.sandbox.__castleCrasherNextRandom(),p=fixture.plan;
  console.log('  pure '+fixture.pure+', repeat '+fixture.repeat+', '+p.call+', expected '+p.expected+', arc points '+p.points.length+', RNG '+nextPlanned.toFixed(8)+'/'+nextControl.toFixed(8));
  if(!fixture.pure||!fixture.repeat||!p||!p.smart||p.expected<4||p.points.length<7||!p.predictedHitId||!String(p.call).match(/FOUNDATION|LOAD|ARCH/))fail('planner fixture did not produce a pure structural announcement');
  if(nextPlanned!==nextControl)fail('planning consumed engine RNG for invisible work');
  if(schema.aiKeys.join('|')!==schema.humanKeys.join('|'))fail('human and bot intent schemas differ: '+JSON.stringify(schema));
}

console.log('3) baseline-first paired A/B: collapse planning beats working center-mass fire on eight seeds');
{
  const smart=[],baseline=[];let wins=0,blockWins=0,breachWins=0;
  for(let i=0;i<8;i++){
    const seed=0xc100+i*233,a=bootGame('castle-crasher',{seed}),b=bootGame('castle-crasher',{seed});b.sandbox.__NO_COLLAPSE_PLAN=1;a.sandbox.__castleCrasherReset();b.sandbox.__castleCrasherReset();a.frames(18000,false);b.frames(18000,false);
    const pa=a.sandbox.__castleCrasherProbe(),pb=b.sandbox.__castleCrasherProbe();smart.push(pa);baseline.push(pb);if(score(pa.stats)>score(pb.stats))wins++;if(pa.stats.blocks>pb.stats.blocks)blockWins++;if(pa.stats.breaches>pb.stats.breaches)breachWins++;
    bands(pa.stats,SMART_POLICY_BANDS,'seed '+seed.toString(16)+' planned');bands(pb.stats,BASE_POLICY_BANDS,'seed '+seed.toString(16)+' center-mass');
    if(!pa.finite||!pb.finite||pa.stats.invisibleResets||pb.stats.invisibleResets)fail('seed '+seed.toString(16)+': non-finite or invisible reset');
    if(pa.stats.smartPlans<30||pa.stats.baselinePlans!==0||pb.stats.smartPlans!==0||pb.stats.baselinePlans<30)fail('seed '+seed.toString(16)+': ablation did not isolate planner policy');
    console.log('  '+seed.toString(16)+' score '+score(pa.stats)+'/'+score(pb.stats)+', blocks '+pa.stats.blocks+'/'+pb.stats.blocks+', breaches '+pa.stats.breaches+'/'+pb.stats.breaches+', misses '+pa.stats.misses+'/'+pb.stats.misses);
  }
  const totals={smartScore:smart.reduce((n,p)=>n+score(p.stats),0),baseScore:baseline.reduce((n,p)=>n+score(p.stats),0),smartBlocks:sum(smart,'blocks'),baseBlocks:sum(baseline,'blocks'),smartBreaches:sum(smart,'breaches'),baseBreaches:sum(baseline,'breaches')};
  console.log('  '+wins+'/8 score wins, '+blockWins+'/8 block wins, '+breachWins+'/8 breach wins; '+JSON.stringify(totals));
  if(wins<7||blockWins<7||breachWins<6||totals.smartScore<totals.baseScore*1.25||totals.smartBlocks<totals.baseBlocks*1.30||totals.smartBreaches<totals.baseBreaches*1.15)fail('aggregate collapse-plan win regressed: '+JSON.stringify(totals));
}

console.log('4) gust act changes the physical plan during an exact 240f warning and resets cleanly');
{
  const a=bootGame('castle-crasher',{seed:0xcc470}),b=bootGame('castle-crasher',{seed:0xcc470});a.sandbox.__castleCrasherActFixture();b.sandbox.__castleCrasherActFixture();b.sandbox.__NO_ACTS=1;
  if(a.sandbox.__castleCrasherPhysical()!==b.sandbox.__castleCrasherPhysical())fail('paired act fixture did not start identical');let first=-1,phase='',tactic='',wind=0;
  for(let frame=1;frame<=270;frame++){a.frames(1,false);b.frames(1,false);if(first<0&&a.sandbox.__castleCrasherPhysical()!==b.sandbox.__castleCrasherPhysical()){first=frame;const p=a.sandbox.__castleCrasherProbe();phase=p.act.phase;tactic=p.intent&&p.intent.tactic;wind=p.plan&&p.plan.wind}}
  const pa=a.sandbox.__castleCrasherProbe(),pb=b.sandbox.__castleCrasherProbe(),warn=pa.act.notes.find(n=>n.kind==='act-warning'),land=pa.act.notes.find(n=>n.kind==='act-land');
  console.log('  first plan/crew divergence '+first+'f in '+phase+' ('+tactic+', wind '+wind+')');
  if(!warn||!land||land.at-warn.at!==240||land.tag-warn.tag!==240)fail('warning/land pair was not exactly 240 frames');
  if(first<1||first>=240||phase!=='warn'||tactic!=='COUNTER THE GUST'||!wind)fail('act did not force a real warn-phase counter-aim');
  if(pb.act.notes.length)fail('__NO_ACTS emitted act notes');
  const reset=bootGame('castle-crasher',{seed:0xcc471});reset.sandbox.__castleCrasherActFixture();reset.frames(100,false);reset.sandbox.__castleCrasherReset();reset.frames(300,false);const pr=reset.sandbox.__castleCrasherProbe();
  if(pr.act.phase!=='calm'||pr.act.notes.some(n=>n.kind==='act-land'))fail('reset during warning left a stale gust land');
}

console.log('5) human takeover uses the same intent and aim/counterweight path');
{
  const game=bootGame('castle-crasher',{seed:0xcc480,footer:FOOTER});press(game,'Enter');press(game,'Enter');game.frames(125,false);const before=game.sandbox.__castleCrasherProbe();game.key('keydown','ArrowUp');game.key('keydown','ArrowRight');game.frames(6,false);game.key('keyup','ArrowUp');game.key('keyup','ArrowRight');const after=game.sandbox.__castleCrasherProbe(),applied=game.sandbox.__ccLastApplied();
  console.log('  '+after.phase+', angle '+before.plan.angle.toFixed(4)+' -> '+after.plan.angle.toFixed(4)+', power '+before.plan.power.toFixed(3)+' -> '+after.plan.power.toFixed(3));
  if(!applied||applied.intent.tactic!=='MANUAL ENGINEER'||applied.intent.aimDelta!==1||applied.intent.powerDelta!==1)fail('manual intent did not traverse applyIntent');
  if(after.plan.angle<=before.plan.angle||after.plan.power<=before.plan.power)fail('manual trim did not alter the shared announced shot');
  if(!after.finite)fail('manual control produced non-finite state');
}

console.log('6) exact SHOW ladder budgets, admire gate, and skill-profile lapse switch');
{
  const game=bootGame('castle-crasher',{seed:0xcc490});game.sandbox.__castleCrasherFreezeShow();
  for(let i=0;i<4;i++){game.sandbox.__castleCrasherForceShow(1,'routine-'+i);game.frames(20,false)}
  for(let i=0;i<2;i++){game.sandbox.__castleCrasherForceShow(2,'milestone-'+i);game.frames(250,false)}
  game.sandbox.__castleCrasherForceShow(3,'apex');game.frames(120,false);const show=game.sandbox.__castleCrasherProbe().show,shown=show.shownByTier,s3=shown[3]||0;
  console.log('  tiers '+JSON.stringify(shown)+', hold/slow/admire '+show.heldFrames+'/'+show.slowedFrames+'/'+show.admireFrames);
  if(!((shown[1]||0)>(shown[2]||0)&&(shown[2]||0)>s3&&s3===1))fail('tier ladder is not strictly ordered');
  if(show.heldFrames!==6*s3||show.slowedFrames!==24*s3||show.admireFrames!==48*s3)fail('apex time budgets are not exact');
  const admire=game.sandbox.__castleCrasherAdmireFixture();if(admire.admired.tactic!=='ADMIRE THE RUIN'||admire.gated.tactic==='ADMIRE THE RUIN')fail('__NO_ADMIRE did not gate bot-only pause');
  const perfect=bootGame('castle-crasher',{seed:0xcc491});perfect.sandbox.__NO_LAPSE=1;perfect.frames(18000,false);if(perfect.sandbox.__castleCrasherProbe().stats.lapses!==0)fail('__NO_LAPSE did not remove skill-profile lapse onsets');
}

console.log('7) two independent ten-minute soaks keep crews moving, shots resolving, walls falling, and chapters advancing');
for(const seed of[0xcc000,0xcd406]){
  const{game,samples}=runSoak('castle-crasher',{seed,minutes:10,footer:FOOTER}),report=analyzeSoak(samples),p=game.sandbox.__castleCrasherProbe();
  console.log('  '+seed.toString(16)+' '+soakLine(report)+'; shots '+p.stats.shots+', blocks '+p.stats.blocks+', breaches '+p.stats.breaches+', outcomes '+p.stats.shorts+'/'+p.stats.trueShots+'/'+p.stats.fortuneShots);
  assertSoak(seed.toString(16),report,{still:3,quiet:4,stall:25,minEvents:550,minProgress:145},fail);bands(p.stats,SOAK_BANDS,'seed '+seed.toString(16)+' soak');notePairs(p,'seed '+seed.toString(16),9);
  if(!p.finite||p.stats.invisibleResets!==0||p.stats.breaches<50||p.stats.blocks<400)fail('seed '+seed.toString(16)+': soak lost visible siege progress');
  const offered=p.show.offeredByTier,shown=p.show.shownByTier;if(!((offered[1]||0)>(offered[2]||0)&&(offered[2]||0)>(offered[3]||0)))fail('seed '+seed.toString(16)+': offered tiers not ordered');if(!((shown[1]||0)>(shown[2]||0)&&(shown[2]||0)>(shown[3]||0)))fail('seed '+seed.toString(16)+': shown tiers not ordered');
  const s3=shown[3]||0;if(p.show.heldFrames!==6*s3||p.show.slowedFrames!==24*s3||p.show.admireFrames!==48*s3)fail('seed '+seed.toString(16)+': long-run SHOW budgets not exact');
}

console.log('8) payoff FX is a non-vacuous perfect same-seed simulation no-op');
{
  const a=bootGame('castle-crasher',{seed:0xcc4a0}),b=bootGame('castle-crasher',{seed:0xcc4a0});b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);const same=a.sandbox.__castleCrasherSignature()===b.sandbox.__castleCrasherSignature(),p=a.sandbox.__castleCrasherProbe();
  console.log('  signatures '+(same?'identical':'DIFFERENT')+' through '+p.stats.breaches+' breach apexes / '+p.stats.blocks+' fallen blocks');
  if(!same)fail('__NO_PAYOFF_FX changed simulation state');if(p.stats.breaches<20||p.stats.blocks<180)fail('FX no-op window did not exercise structural apexes');
}

console.log(failed?'\nCASTLE CRASHER EVAL FAILED':'\nCASTLE CRASHER EVAL PASSED');
process.exit(failed?1:0);
