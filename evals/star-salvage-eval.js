#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');

const FOOTER=`
globalThis.__ssApplied=[];
{const __ssa0=applyIntent;applyIntent=intent=>{const out=__ssa0(intent);globalThis.__ssApplied.push({frame:runFrame,...intent});if(globalThis.__ssApplied.length>240)globalThis.__ssApplied.shift();return out;};}
globalThis.__ssClearApplied=()=>{globalThis.__ssApplied.length=0;};
globalThis.__ssLastApplied=()=>globalThis.__ssApplied.at(-1)||null;
globalThis.__ssNextRandom=()=>E.random();
globalThis.__ssPlanOnce=()=>simulateGreedRoute(pickLoose(true)||null);
globalThis.__ssEndingLog=[];
{const __sse0=finishShift;finishShift=()=>{const before=stats.endings,out=__sse0();if(stats.endings>before)globalThis.__ssEndingLog.push({showFrame,runFrame,state,resultT,outcome,bankedValue,bankedPieces,stats:{...stats}});return out;};}
`;

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const mean=a=>a.reduce((n,v)=>n+v,0)/a.length;
const sum=(a,key)=>a.reduce((n,p)=>n+(key?p.stats[key]:p),0);

// Thirty fixed ten-minute seeds (0x5c000 + i*233), measured 2026-07-10
// after the visible cache nudge and final chain economy. Observed min..max:
// value 379..714, pieces 72..112, bonus 88..172, trips 21..36, rocks
// 21..31, tethers 97..136, train 4..6, overloaded homes 0..4, deliberate
// drops 0..7, snaps 12..31, lost cargo 16..37, impacts/rescues 0,
// lapses 0..9, visible replans 0..6, apexes 3..4, events 245..337,
// progress 141..198, event lull 721f, story lull 902..2190f, planner calls
// 327..407. Bands add margin on both sides; they are not provisional vibes.
const WATCH_BANDS={
  bankedValue:[340,780],bankedPieces:[60,125],haulBonus:[70,200],bankTrips:[17,42],
  rocksBroken:[17,38],tethers:[85,150],maxTrain:[4,7],overloadHomes:[0,7],
  voluntaryDrops:[0,10],snaps:[7,40],cargoLost:[10,48],impacts:[0,2],rescues:[0,1],
  lapses:[0,12],replans:[0,8],apexes:[2,6],events:[220,370],progress:[125,225],
  plannerCalls:[280,460]
};
const SMART_POLICY={bankedValue:[300,820],bankedPieces:[55,135],bankTrips:[15,48],
  maxTrain:[4,7],cargoLost:[5,58],snaps:[3,48],events:[190,410],progress:[110,245]};
const BASE_POLICY={bankedValue:[260,650],bankedPieces:[50,125],bankTrips:[18,52],
  maxTrain:[3,3],cargoLost:[2,45],snaps:[1,42],events:[170,410],progress:[105,245]};
function inBands(p,bands,label){for(const[k,[lo,hi]]of Object.entries(bands)){
  const v=p.stats[k];if(v<lo||v>hi)fail(`${label}: ${k} ${v} outside measured band ${lo}..${hi}`);
}}
function actPairs(p,id,warn,label,minPairs){
  const notes=p.act.notes.filter(n=>n.id===id),warnings=notes.filter(n=>n.kind==='act-warning'),lands=notes.filter(n=>n.kind==='act-land');
  if(warnings.length<minPairs||lands.length!==warnings.length)fail(`${label}: ${id} emitted ${warnings.length} warnings / ${lands.length} lands`);
  for(let i=0;i<Math.min(warnings.length,lands.length);i++)if(lands[i].tag-warnings[i].tag!==warn)
    fail(`${label}: ${id} pair ${i} warned ${lands[i].tag-warnings[i].tag}f, expected ${warn}`);
}

console.log('1) deterministic fixed-step replay, render parity, and batching');
{
  const a=bootGame('star-salvage',{seed:0x551001,footer:FOOTER}),b=bootGame('star-salvage',{seed:0x551001,footer:FOOTER}),r=bootGame('star-salvage',{seed:0x551001,footer:FOOTER});
  a.frames(7200,false);b.frames(7200,false);r.frames(7200,true);
  const sa=a.sandbox.__starSalvageSignature(),sb=b.sandbox.__starSalvageSignature(),sr=r.sandbox.__starSalvageSignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${r.counter.calls} canvas calls on final frame`);
  if(sa!==sb)fail('same seed diverged under fixed headless steps');if(sa!==sr)fail('render traversal changed simulation or RNG');if(!a.sandbox.__starSalvageProbe().finite)fail('replay ended non-finite');
  const mono=bootGame('star-salvage',{seed:0x551002,footer:FOOTER}),chunk=bootGame('star-salvage',{seed:0x551002,footer:FOOTER});
  mono.frames(18000,false);for(let i=0;i<1800;i++)chunk.frames(10,false);const same=mono.sandbox.__starSalvageSignature()===chunk.sandbox.__starSalvageSignature();
  console.log(`  18,000 monolithic vs 1,800 x 10: ${same?'identical':'DIFFERENT'}`);if(!same)fail('step batching changed simulation');
}

console.log('2) shared physics + copied greed planner are finite, pure, repeatable, and RNG-free');
{
  const game=bootGame('star-salvage',{seed:0x551010,footer:FOOTER}),physics=game.sandbox.__starSalvagePhysicsFixture(),plan=game.sandbox.__starSalvagePlannerFixture();
  console.log(`  physics pure ${physics.pure}; planner pure ${plan.pure}, repeat ${plan.repeat}, ${plan.route.steps} exact integrator steps`);
  if(!physics.pure||!physics.finite)fail(`shared advanceShip fixture regressed: ${JSON.stringify(physics)}`);
  if(!plan.pure||!plan.repeat||!plan.finite||!plan.route.got)fail(`greed planner fixture regressed: ${JSON.stringify(plan)}`);
  const control=bootGame('star-salvage',{seed:0x551011,footer:FOOTER}),planned=bootGame('star-salvage',{seed:0x551011,footer:FOOTER});
  planned.sandbox.__ssPlanOnce();const rp=planned.sandbox.__ssNextRandom(),rc=control.sandbox.__ssNextRandom();
  console.log(`  next engine RNG after planning ${rp.toFixed(8)} vs control ${rc.toFixed(8)}`);if(rp!==rc)fail('planner consumed engine RNG');
}

console.log('3) measured ten-minute watchability distribution: four panel seeds');
const watch=[],watchSeeds=[0x5c000,0x5c000+233*7,0x5c000+233*16,0x5c000+233*29];
for(const seed of watchSeeds){
  const game=bootGame('star-salvage',{seed,footer:FOOTER});game.frames(36000,false);const p=game.sandbox.__starSalvageProbe();watch.push(p);
  console.log(`  ${seed.toString(16)} ${p.persona.padEnd(4)}: ${p.stats.bankedValue} value/${p.stats.bankedPieces} pcs, ${p.stats.bankTrips} homes, train ${p.stats.maxTrain}, `+
    `${p.stats.cargoLost} lost/${p.stats.snaps} snaps, ${p.stats.lapses} lapses, lulls ${(p.maxEventLull/60).toFixed(1)}s/${(p.maxProgressLull/60).toFixed(1)}s`);
  if(!p.finite)fail(`${seed.toString(16)}: non-finite body state`);inBands(p,WATCH_BANDS,seed.toString(16));
  if(p.stats.actsWarned!==8||p.stats.actsLanded!==8)fail(`${seed.toString(16)}: acts ${p.stats.actsWarned}/${p.stats.actsLanded}, expected 8/8`);
  actPairs(p,'squall',240,seed.toString(16),4);actPairs(p,'meteor',210,seed.toString(16),4);
  if(p.maxEventLull>780)fail(`${seed.toString(16)}: event lull ${p.maxEventLull}f > 780f`);
  if(p.maxProgressLull>2400)fail(`${seed.toString(16)}: progress lull ${p.maxProgressLull}f > 2400f`);
}
{
  const personas=new Set(watch.map(p=>p.persona)),lapses=sum(watch,'lapses');
  console.log(`  freshness: ${personas.size} personas; ${lapses} honest lapse onsets`);
  if(personas.size<2)fail('representative panel did not vary persona');if(lapses<2)fail('skill-profile imperfection disappeared');
}

console.log('4) greed-plan A/B: eight same-seed ten-minute pairs vs fixed three-piece return');
{
  const smart=[],base=[];let wins=0;
  for(let i=0;i<8;i++){
    const seed=0x5b100+i*191,a=bootGame('star-salvage',{seed,footer:FOOTER}),b=bootGame('star-salvage',{seed,footer:FOOTER});b.sandbox.__NO_GREED_PLAN=1;
    a.frames(36000,false);b.frames(36000,false);const pa=a.sandbox.__starSalvageProbe(),pb=b.sandbox.__starSalvageProbe();smart.push(pa);base.push(pb);if(pa.stats.bankedValue>pb.stats.bankedValue)wins++;
    inBands(pa,SMART_POLICY,`${seed.toString(16)} smart`);inBands(pb,BASE_POLICY,`${seed.toString(16)} baseline`);
    if(pa.stats.plannerCalls<=0||pb.stats.plannerCalls!==0)fail(`${seed.toString(16)}: ablation did not fully restore old planner policy`);
    console.log(`  ${seed.toString(16)} ${pa.persona.padEnd(4)} smart ${pa.stats.bankedValue} value/train ${pa.stats.maxTrain} vs baseline ${pb.stats.bankedValue}/train ${pb.stats.maxTrain}`);
  }
  const sv=sum(smart,'bankedValue'),bv=sum(base,'bankedValue'),gain=sv/bv-1;
  console.log(`  ${wins}/8 value wins; aggregate ${sv} vs ${bv} (+${(gain*100).toFixed(1)}%)`);
  if(wins<7)fail(`greed planner won only ${wins}/8 paired seeds`);if(gain<.20)fail(`greed planner aggregate gain ${(gain*100).toFixed(1)}% below 20%`);
  if(Math.max(...smart.map(p=>p.stats.maxTrain))<5||Math.max(...base.map(p=>p.stats.maxTrain))!==3)fail('A/B lost the visible train-length tradeoff');
  if(sum(smart,'cargoLost')<=0)fail('smart policy erased honest cargo losses');
}

console.log('5) acts: exact warning pairs and first physical/control divergence before land');
for(const spec of[{id:'squall',warn:240},{id:'meteor',warn:210}]){
  const seed=spec.id==='squall'?0x552001:0x552002,a=bootGame('star-salvage',{seed,footer:FOOTER}),b=bootGame('star-salvage',{seed,footer:FOOTER});
  a.sandbox.__starSalvageSetAct(spec.id);b.sandbox.__starSalvageSetAct(spec.id);b.sandbox.__NO_ACTS=1;
  let first=-1,phase='',tactic='';
  for(let f=1;f<=60+spec.warn+60;f++){
    a.frames(1,false);b.frames(1,false);if(first<0&&a.sandbox.__starSalvageMotion()!==b.sandbox.__starSalvageMotion()){
      first=f;const s=a.sandbox.__starSalvageActState();phase=s.phase;tactic=s.tactic;break;
    }
  }
  a.frames(60+spec.warn+80,false);b.frames(60+spec.warn+80,false);
  const pa=a.sandbox.__starSalvageProbe(),pb=b.sandbox.__starSalvageProbe(),notes=pa.act.notes.filter(n=>n.id===spec.id),w=notes.find(n=>n.kind==='act-warning'),l=notes.find(n=>n.kind==='act-land');
  console.log(`  ${spec.id}: first divergence f${first} in ${phase} as ${tactic}; note lead ${w&&l?l.tag-w.tag:'missing'}f`);
  if(!w||!l||l.tag-w.tag!==spec.warn)fail(`${spec.id}: warning/land pair not exactly ${spec.warn}f`);
  if(first<0||phase!=='warn'||first>60+spec.warn)fail(`${spec.id}: first physical divergence was not in warning`);
  if(!/FRONT|SHELTER/.test(tactic||''))fail(`${spec.id}: warning response was not legible: ${tactic}`);
  if(pb.act.notes.some(n=>n.id===spec.id))fail(`__NO_ACTS emitted ${spec.id} notes`);
}
{
  const g=bootGame('star-salvage',{seed:0x552003,footer:FOOTER});g.sandbox.__starSalvageSetAct('squall');g.frames(80,false);const before=g.sandbox.__starSalvageProbe();press(g,'Enter');press(g,'Enter');const reset=g.sandbox.__starSalvageProbe();g.frames(400,false);const after=g.sandbox.__starSalvageProbe();
  const stale=after.act.notes.filter(n=>n.kind==='act-land').length;console.log(`  reset during warning: ${before.act.phase}->${reset.act.phase}; stale lands ${stale}`);
  if(before.act.phase!=='warn'||reset.act.phase!=='calm'||stale||!after.playing||!after.finite)fail('session reset leaked a canceled act');
}

console.log('6) manual takeover: two-Enter gate and every human field uses applyIntent');
{
  const g=bootGame('star-salvage',{seed:0x553001,footer:FOOTER});let p=g.sandbox.__starSalvageProbe();if(p.playing)fail('session started in playing mode');press(g,'Enter');if(g.sandbox.__starSalvageProbe().playing)fail('first Enter skipped instructions');press(g,'Enter');if(!g.sandbox.__starSalvageProbe().playing)fail('second Enter did not start');
  g.sandbox.__ssClearApplied();g.key('keydown','ArrowLeft');g.key('keydown','ArrowUp');g.frames(3,false);g.key('keyup','ArrowLeft');g.key('keyup','ArrowUp');const move=g.sandbox.__ssLastApplied();
  g.sandbox.__ssClearApplied();g.key('keydown','KeyX');g.frames(2,false);g.key('keyup','KeyX');const fire=g.sandbox.__ssLastApplied();
  g.sandbox.__ssClearApplied();g.key('keydown','Space');g.key('keydown','ShiftLeft');g.frames(2,false);g.key('keyup','Space');g.key('keyup','ShiftLeft');const cargo=g.sandbox.__ssLastApplied();p=g.sandbox.__starSalvageProbe();
  console.log(`  move ${move&&move.turn}/${move&&move.thrust}; fire ${fire&&fire.fire}; tether/drop ${cargo&&cargo.tether}/${cargo&&cargo.dropTail}`);
  if(!move||move.tactic!=='MANUAL'||move.turn!==-1||!move.thrust)fail('manual move bypassed shared intent');
  if(!fire||fire.tactic!=='MANUAL'||!fire.fire)fail('manual fire bypassed shared intent');
  if(!cargo||cargo.tactic!=='MANUAL'||!cargo.tether||!cargo.dropTail)fail('manual tether/drop bypassed shared intent');
  if(p.stats.appliedIntents<7)fail('common applyIntent did not receive manual frames');
}

console.log('7) 15-minute Star Ark ending + strict payoff ladder and exact budgets');
{
  const g=bootGame('star-salvage',{seed:0x5b935,footer:FOOTER});
  while(!g.sandbox.__ssEndingLog.length&&g.sandbox.__starSalvageProbe().showFrame<62000)g.frames(600,false);
  g.frames(180,false);const p=g.sandbox.__starSalvageProbe(),ending=g.sandbox.__ssEndingLog[0],show=p.show,o=show.offeredByTier,s=show.shownByTier,s3=s[3]||0,admire=g.sandbox.__starSalvageAdmireFixture();
  console.log(`  ${ending&&ending.outcome} at run ${ending&&ending.runFrame}, ${ending&&ending.bankedValue} value; tiers ${JSON.stringify(o)} shown ${JSON.stringify(s)}; budgets ${show.heldFrames}/${show.slowedFrames}/${show.admireFrames}`);
  if(!ending||ending.runFrame!==54000||ending.state!=='ending'||ending.resultT!==360)fail(`ending did not start exactly at run frame 54000: ${JSON.stringify(ending)}`);
  if(ending.outcome!=='STAR ARK LAUNCHED'||ending.bankedValue<260||ending.stats.endings!==1||ending.stats.wins!==1)fail('calibrated 15-minute arc did not earn the Star Ark');
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=1))fail(`offered ladder not strictly ordered: ${JSON.stringify(o)}`);
  if(!((s[1]||0)>(s[2]||0)&&(s[2]||0)>(s[3]||0)&&(s[3]||0)>=1))fail(`shown ladder not strictly ordered: ${JSON.stringify(s)}`);
  if(show.heldFrames!==6*s3)fail(`hitstop ${show.heldFrames} != 6*${s3}`);if(show.slowedFrames!==24*s3)fail(`slow ${show.slowedFrames} != 24*${s3}`);if(show.admireFrames!==48*s3)fail(`admire ${show.admireFrames} != 48*${s3}`);
  if(admire.admired!=='ADMIRE'||admire.gated==='ADMIRE')fail(`__NO_ADMIRE failed: ${JSON.stringify(admire)}`);
}
{
  const g=bootGame('star-salvage',{seed:0x553002,footer:FOOTER});g.sandbox.__starSalvageNearApex();g.frames(120,false);const p=g.sandbox.__starSalvageProbe(),s3=p.show.shownByTier[3]||0;
  console.log(`  isolated apex drained: ${p.show.heldFrames}/${p.show.slowedFrames}/${p.show.admireFrames}, shown ${s3}`);
  if(s3!==1||(p.show.active&&p.show.active.tier===3)||p.show.heldFrames!==6||p.show.slowedFrames!==24||p.show.admireFrames!==48)fail('isolated homecoming did not drain exact apex budget');
}

console.log('8) payoff FX is a perfect same-seed simulation no-op');
{
  const a=bootGame('star-salvage',{seed:0x554001,footer:FOOTER}),b=bootGame('star-salvage',{seed:0x554001,footer:FOOTER});b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);const pa=a.sandbox.__starSalvageProbe(),same=a.sandbox.__starSalvageSignature()===b.sandbox.__starSalvageSignature();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} after ${pa.stats.bankTrips} banked hauls / ${pa.stats.apexes} apexes`);if(!same)fail('__NO_PAYOFF_FX changed simulation');if(pa.stats.bankTrips<5||pa.stats.apexes<1)fail('FX parity proof was vacuous');
}

console.log('9) shared ten-minute soak: moving, happening, and progressing');
{
  const{samples}=runSoak('star-salvage',{seed:0x5c000,footer:FOOTER,minutes:10}),report=analyzeSoak(samples);console.log('  '+soakLine(report));
  assertSoak('star-salvage soak',report,{still:2,quiet:14,stall:36,minEvents:220,minProgress:125},fail);
}

console.log('10) viewer story + skill-profile ablation stay truthful');
{
  const g=bootGame('star-salvage',{seed:0x555001,footer:FOOTER});g.frames(1,true);const v=g.sandbox.__starSalvageViewerProbe(),p=g.sandbox.__starSalvageProbe();
  console.log(`  opening "${v.drawn.hud}" / "${v.drawn.verb}" / "${v.drawn.goal}"`);
  if(v.drawn.frame!==p.showFrame||v.drawn.hud!=='STAR SALVAGE'||v.drawn.goal!=='BUILD STAR ARK 000/260'||v.drawn.load!=='0 PCS · 0 VALUE'||!v.drawn.shipBox)fail(`opening story receipt is false: ${JSON.stringify(v)}`);
  g.frames(7199,true);const p2=g.sandbox.__starSalvageProbe(),v2=g.sandbox.__starSalvageViewerProbe(),raw=p2.train.reduce((n,f)=>n+f.value,0);
  console.log(`  2m: ${v2.drawn.goal}; ${v2.drawn.load}; tactic ${v2.drawn.verb}`);
  if(v2.drawn.frame!==p2.showFrame||!v2.drawn.goal.includes(String(p2.bankedValue).padStart(3,'0')+'/260')||v2.drawn.load!==p2.train.length+' PCS · '+raw+' VALUE')fail('rendered story disagrees with live bank/load truth');
  const perfect=bootGame('star-salvage',{seed:0x5c000,footer:FOOTER});perfect.sandbox.__NO_LAPSE=1;perfect.frames(36000,false);const pp=perfect.sandbox.__starSalvageProbe();
  console.log(`  __NO_LAPSE: ${pp.stats.lapses} lapses, ${pp.stats.bankedValue} value, finite ${pp.finite}`);if(pp.stats.lapses!==0||!pp.finite||pp.stats.bankedValue<260)fail('__NO_LAPSE did not cleanly restore competent perfect play');
}

console.log(failed?'\nSTAR SALVAGE EVAL FAILED':'\nSTAR SALVAGE EVAL PASSED');
process.exit(failed?1:0);
