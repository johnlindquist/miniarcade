#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');

const FOOTER=`
globalThis.__mbApplied=[];
{const __mba0=applyIntent;applyIntent=intent=>{const out=__mba0(intent);
  globalThis.__mbApplied.push({frame:runFrame,state,steer:intent.steer,turbo:!!intent.turbo,
    brake:!!intent.brake,jump:!!intent.jump,juke:intent.juke,pick:intent.pick,tactic:intent.tactic});
  if(globalThis.__mbApplied.length>240)globalThis.__mbApplied.shift();return out;};}
globalThis.__mbClearApplied=()=>{globalThis.__mbApplied.length=0;};
globalThis.__mbLastApplied=()=>globalThis.__mbApplied.at(-1)||null;
globalThis.__mbNextRandom=()=>E.random();
globalThis.__mbEndingLog=[];
{const __mbe0=finishMatch;finishMatch=()=>{const before=stats.endings,out=__mbe0();
  if(stats.endings>before)globalThis.__mbEndingLog.push({showFrame,runFrame,state,resultT,outcome,
    homeScore,rivalScore,tds:stats.tds,turnovers:stats.turnovers});return out;};}
globalThis.__mbPlanOnce=()=>buildPlan();
globalThis.__mbWorld=()=>({terrain:JSON.parse(JSON.stringify(terrain)),persona:persona.name,wave});
globalThis.__mbTdFrames=[];
{const __mbt0=touchdown;touchdown=()=>{const n=stats.tds,out=__mbt0();
  if(stats.tds>n)globalThis.__mbTdFrames.push(showFrame);return out;};}
globalThis.__mbScoreGap=()=>{const a=globalThis.__mbTdFrames;let max=a.length?a[0]:showFrame;
  for(let i=1;i<a.length;i++)max=Math.max(max,a[i]-a[i-1]);if(a.length)max=Math.max(max,showFrame-a.at(-1));return max;};
globalThis.__mbForceSnap=()=>{if(state==='huddle'){stateT=1;stepWorld();}return state;};
globalThis.__mbHeatUp=v=>{rusher.heat=v;return rusher.heat;};
`;

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const minmax=a=>[Math.min(...a),Math.max(...a)];
const median=a=>{const b=a.slice().sort((x,y)=>x-y),m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])/2;};
const mean=a=>a.reduce((n,v)=>n+v,0)/a.length;
const ypp=p=>p.stats.yards/Math.max(1,p.stats.plays);
const keyedRate=p=>p.stats.keyedPlays/Math.max(1,p.stats.plays);

// Pre-registered 30-seed x 10-minute calibration on 2026-07-10 (seeds
// 0xd000 + i*233). Observed min..max: plays 136..148, tds 6..17, first downs
// 56..73, tackles 120..142, broken 2..31, hurdles 3..19, jukes 57..122,
// blocks 260..289, launches 6..28, overheats 0..8, tumbles 4..16, turnovers
// 3..13, keyed 8..33, lapses 1..6, events 817..929, progress 198..217,
// event lull exactly 262f (the TD-celebration + kickoff pipeline), story
// lull max 717f. Bands below add explicit margin around those extrema.
const WATCH_BANDS={
  plays:[125,165],tds:[4,22],firstDowns:[45,85],tackles:[105,158],
  brokenTackles:[1,40],hurdles:[2,28],jukes:[45,140],blocks:[235,320],
  launches:[4,38],overheats:[0,12],tumbles:[2,24],turnovers:[2,18],
  keyedPlays:[5,42],lapses:[1,8]
};
// Both policies from the 10-pair lane-plan ablation must stay watchable:
// planned is competent, reactive visibly worse, neither inert nor absurd.
const POLICY_BANDS={plays:[50,110],tds:[0,14],tackles:[40,105],turnovers:[0,16],blocks:[90,200]};
const inBands=(p,bands,label)=>{for(const[k,[lo,hi]]of Object.entries(bands)){
  const v=p.stats?p.stats[k]:p[k];
  if(v<lo||v>hi)fail(`${label}: ${k} ${v} outside measured band ${lo}..${hi}`);}};
const actPairs=(p,id,warn,label,minPairs)=>{
  const notes=p.acts.notes.filter(n=>n.id===id),warnings=notes.filter(n=>n.kind==='act-warning'),
    lands=notes.filter(n=>n.kind==='act-land');
  if(warnings.length<minPairs||lands.length!==warnings.length)
    fail(`${label}: ${id} emitted ${warnings.length} warnings / ${lands.length} lands (need ${minPairs}+ pairs)`);
  for(let i=0;i<Math.min(warnings.length,lands.length);i++)if(lands[i].tag-warnings[i].tag!==warn)
    fail(`${label}: ${id} pair ${i} warned ${lands[i].tag-warnings[i].tag}f, expected ${warn}`);
  return lands.length;
};

console.log('1) deterministic replay + render parity: one seed, one complete simulation');
{
  const a=bootGame('motobowl',{seed:0xb001,footer:FOOTER}),b=bootGame('motobowl',{seed:0xb001,footer:FOOTER}),
    rendered=bootGame('motobowl',{seed:0xb001,footer:FOOTER});
  a.frames(7200,false);b.frames(7200,false);rendered.frames(7200,true);
  const sa=a.sandbox.__motobowlSignature(),sb=b.sandbox.__motobowlSignature(),sr=rendered.sandbox.__motobowlSignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${rendered.counter.calls} draw calls on final frame`);
  if(sa!==sb)fail('same seed diverged under identical fixed 60 Hz headless steps');
  if(sa!==sr)fail('render traversal changed simulation state or RNG');
  if(!a.sandbox.__motobowlProbe().finite)fail('deterministic replay ended non-finite');
  const mono=bootGame('motobowl',{seed:0xb002,footer:FOOTER}),chunked=bootGame('motobowl',{seed:0xb002,footer:FOOTER});
  mono.frames(18000,false);for(let i=0;i<1800;i++)chunked.frames(10,false);
  const chunkSame=mono.sandbox.__motobowlSignature()===chunked.sandbox.__motobowlSignature();
  console.log(`  18,000 monolithic frames vs 1,800 x 10: ${chunkSame?'identical':'DIFFERENT'}`);
  if(!chunkSame)fail('headless batching changed the deterministic fixed-step result');
}

console.log('2) lane planner: copied-state rollout is exact, repeatable, pure, and RNG-free');
{
  const game=bootGame('motobowl',{seed:0xb003,footer:FOOTER}),f=game.sandbox.__motobowlPlannerFixture();
  console.log(`  pure ${f.pure}; repeat ${f.repeat}; replay error ${f.error}; plan lane ${f.plan.targetX} turbo ${f.plan.turboOn} gain ${f.plan.gain.toFixed(1)}px`);
  if(!f.pure||!f.repeat||f.error!==0||f.state!=='play'||!f.finite)
    fail(`planner fixture regressed: ${JSON.stringify(f)}`);
  const control=bootGame('motobowl',{seed:0xb004,footer:FOOTER}),planned=bootGame('motobowl',{seed:0xb004,footer:FOOTER});
  planned.sandbox.__mbForceSnap();planned.sandbox.__mbPlanOnce();
  const rp=planned.sandbox.__mbNextRandom();
  control.sandbox.__mbForceSnap();
  const rc=control.sandbox.__mbNextRandom();
  console.log(`  next RNG after planning ${rp.toFixed(8)} vs control ${rc.toFixed(8)}`);
  if(rp!==rc)fail('lane planning consumed engine RNG for simulation-invisible work');
}

console.log('3) physics + level gen fixtures: ramps, overheat, tackles, keyed reads, 100 valid drives');
{
  const game=bootGame('motobowl',{seed:0xb005,footer:FOOTER});
  const ramp=game.sandbox.__motobowlRampFixture();
  console.log('  ramp airtime by speed: '+ramp.map(r=>`${r.v}->${r.air}f`).join(' '));
  if(!ramp.every(r=>r.launched&&r.finite))fail('a ramp crossing failed to launch');
  for(let i=1;i<ramp.length;i++)if(ramp[i].air<=ramp[i-1].air)
    fail(`ramp airtime is not monotonic in approach speed: ${JSON.stringify(ramp)}`);
  const heat=game.sandbox.__motobowlOverheatFixture();
  console.log(`  overheat: stall ${heat.stallAt.stallT}f at heat ${heat.stallAt.heat}, recovered after ${heat.recoveredAfter}f`);
  if(!heat.stallAt.overheated||heat.stallAt.stallT!==100||heat.recoveredAfter!==100||!heat.finite)
    fail(`overheat stall is not an exact visible 100-frame penalty: ${JSON.stringify(heat)}`);
  const tackle=game.sandbox.__motobowlTackleFixture();
  console.log(`  tackle: ${tackle.before.state}->${tackle.after.state}, down ${tackle.after.down}`);
  if(tackle.before.state!=='play'||tackle.after.state!=='dead'||tackle.after.tackles!==tackle.before.tackles+1||
    tackle.after.down!==2||!tackle.finite)
    fail(`contact did not resolve into an honest tackled down: ${JSON.stringify(tackle)}`);
  const key=game.sandbox.__motobowlKeyFixture();
  console.log(`  coordinator keys: all-left->${key.allLeft}, right-heavy->${key.mostlyRight}, fresh->${key.fresh}`);
  if(key.allLeft!==0||key.mostlyRight!==2||key.fresh!==1)
    fail(`tendency chart is not honest history math: ${JSON.stringify(key)}`);
  const gen=game.sandbox.__motobowlGenFixture(100);
  const valid=gen.filter(g=>g.valid).length,shapes=new Set(gen.map(g=>[g.ramps,g.muds,g.oils,g.whoops].join(',')));
  console.log(`  level gen: ${valid}/100 drives valid, ${shapes.size} distinct layout shapes`);
  if(valid!==100)fail(`${100-valid} generated drives failed corridor validation`);
  if(shapes.size<10)fail(`level gen variety too low: ${shapes.size} distinct shapes over 100 drives`);
}

console.log('4) measured ten-minute watchability distribution: four representative calibrated seeds');
const watch=[],watchSeeds=[0xd000,0xd000+233*7,0xd000+233*16,0xd000+233*29];
for(const seed of watchSeeds){
  const game=bootGame('motobowl',{seed,footer:FOOTER});game.frames(36000,false);
  const p=game.sandbox.__motobowlProbe();p.scoreGap=game.sandbox.__mbScoreGap();watch.push(p);
  console.log(`  ${seed.toString(16)} ${p.persona.padEnd(8)}: ${p.stats.tds} tds/${p.stats.firstDowns} fd, `+
    `${p.stats.tackles} tackles/${p.stats.brokenTackles} broken, ${p.stats.hurdles} hurdles/${p.stats.jukes} jukes, `+
    `${p.stats.blocks} blocks, ${p.stats.launches} launches, ${p.stats.overheats} overheats, `+
    `${p.stats.turnovers} to, lulls ${(p.scoreGap/60).toFixed(1)}s td/${(p.maxProgressLull/60).toFixed(1)}s story`);
  if(!p.finite)fail(`seed ${seed.toString(16)}: non-finite rusher, defender, or blocker state`);
  actPairs(p,'storm',240,`seed ${seed.toString(16)}`,3);
  actPairs(p,'blitz',210,`seed ${seed.toString(16)}`,3);
  inBands(p,WATCH_BANDS,`seed ${seed.toString(16)} ${p.persona}`);
  if(p.stats.events<770||p.stats.events>1000||p.stats.progress<185||p.stats.progress>235)
    fail(`seed ${seed.toString(16)}: event/progress totals ${p.stats.events}/${p.stats.progress} outside measured margin 770..1000 / 185..235`);
  if(p.maxEventLull>420)fail(`seed ${seed.toString(16)}: visible-event lull ${p.maxEventLull}f exceeds 420f`);
  if(p.scoreGap>15000)fail(`seed ${seed.toString(16)}: touchdown drought ${p.scoreGap}f exceeds 15000f`);
  if(p.maxProgressLull>1200)fail(`seed ${seed.toString(16)}: story-progress lull ${p.maxProgressLull}f exceeds hard 1200f`);
  // Landings may trail launches: a flight that crosses the goal line scores
  // mid-air and never lands. A large deficit still means physics is broken.
  if(p.stats.landings<p.stats.launches-10)fail(`seed ${seed.toString(16)}: ${p.stats.launches} launches but only ${p.stats.landings} landings`);
}
{
  const personas=new Set(watch.map(p=>p.persona));
  const layouts=new Set(watch.map((p,i)=>{
    const game=bootGame('motobowl',{seed:watchSeeds[i],footer:FOOTER});
    return JSON.stringify(game.sandbox.__mbWorld().terrain);
  }));
  console.log(`  freshness: ${personas.size} personas, ${layouts.size} distinct opening layouts`);
  if(personas.size<2)fail(`seed freshness too low: ${personas.size} personas across four seeds`);
  if(layouts.size!==watch.length)fail('two calibrated seeds opened on identical generated terrain');
}

console.log('5) lane-plan A/B: ten paired five-minute seeds against widest-gap reactive running');
{
  const smart=[],reactive=[];let wins=0;
  for(let i=0;i<10;i++){
    const seed=0xce00+i,a=bootGame('motobowl',{seed,footer:FOOTER}),b=bootGame('motobowl',{seed,footer:FOOTER});
    b.sandbox.__NO_LANE_PLAN=1;a.frames(18000,false);b.frames(18000,false);
    const pa=a.sandbox.__motobowlProbe(),pb=b.sandbox.__motobowlProbe();
    smart.push(pa);reactive.push(pb);if(ypp(pa)>ypp(pb))wins++;
    inBands(pa,POLICY_BANDS,`seed ${seed.toString(16)} planned`);inBands(pb,POLICY_BANDS,`seed ${seed.toString(16)} reactive`);
    console.log(`  ${seed.toString(16)} ${pa.persona.padEnd(8)} planned ${ypp(pa).toFixed(2)} yd/play, ${pa.stats.tds} td `+
      `vs reactive ${ypp(pb).toFixed(2)}, ${pb.stats.tds} td`);
  }
  const meanSmart=mean(smart.map(ypp)),meanReactive=mean(reactive.map(ypp)),
    tdsSmart=smart.reduce((n,p)=>n+p.stats.tds,0),tdsReactive=reactive.reduce((n,p)=>n+p.stats.tds,0);
  console.log(`  ${wins}/10 yd/play wins; mean ${meanSmart.toFixed(2)} vs ${meanReactive.toFixed(2)} `+
    `(+${(meanSmart-meanReactive).toFixed(2)}); tds ${tdsSmart} vs ${tdsReactive}`);
  if(wins<8)fail(`lane planner won yards-per-play on only ${wins}/10 seeds`);
  if(meanSmart-meanReactive<2)fail(`lane planner mean yd/play gain ${(meanSmart-meanReactive).toFixed(2)} below 2.0`);
  if(tdsSmart<tdsReactive*1.3)fail(`lane planner touchdown gain ${tdsSmart}/${tdsReactive} below 30%`);
  const hardSmart=Math.max(...smart.map(p=>p.maxProgressLull)),hardReactive=Math.max(...reactive.map(p=>p.maxProgressLull));
  if(hardSmart>1500||hardReactive>1500)fail(`policy hard progress lull ${hardSmart}/${hardReactive}f exceeds 1500f`);
}

console.log('6) play-mix A/B: eight paired seeds against tendency-blind argmax play calling');
{
  const mixed=[],blind=[];let wins=0;
  for(let i=0;i<8;i++){
    const seed=0xcf00+i,a=bootGame('motobowl',{seed,footer:FOOTER}),b=bootGame('motobowl',{seed,footer:FOOTER});
    b.sandbox.__NO_PLAY_MIX=1;a.frames(18000,false);b.frames(18000,false);
    const pa=a.sandbox.__motobowlProbe(),pb=b.sandbox.__motobowlProbe();
    mixed.push(pa);blind.push(pb);if(keyedRate(pa)<keyedRate(pb))wins++;
    console.log(`  ${seed.toString(16)} ${pa.persona.padEnd(8)} mixed ${(keyedRate(pa)*100).toFixed(1)}% keyed `+
      `vs blind ${(keyedRate(pb)*100).toFixed(1)}%`);
  }
  const meanMixed=mean(mixed.map(keyedRate)),meanBlind=mean(blind.map(keyedRate));
  console.log(`  ${wins}/8 keyed-rate wins; mean ${(meanMixed*100).toFixed(1)}% vs ${(meanBlind*100).toFixed(1)}% `+
    `(-${((meanBlind-meanMixed)*100).toFixed(1)}pp)`);
  if(wins<7)fail(`tendency mixing beat the coordinator on only ${wins}/8 seeds`);
  if(meanBlind-meanMixed<.15)fail(`tendency mixing keyed-rate gain ${((meanBlind-meanMixed)*100).toFixed(1)}pp below 15pp`);
  const dodges=mixed.reduce((n,p)=>n+p.stats.readsDodged,0);
  if(dodges<8)fail(`only ${dodges} charted reads were deliberately dodged across eight runs`);
}

console.log('7) acts: exact note pairs and first act-independent divergence during warning');
for(const spec of[{id:'storm',warn:240,tactic:'CUT TURBO'},{id:'blitz',warn:210,tactic:'SPREAD WIDE'}]){
  const seed=spec.id==='storm'?0xaca1:0xaca2,a=bootGame('motobowl',{seed,footer:FOOTER}),b=bootGame('motobowl',{seed,footer:FOOTER});
  a.sandbox.__motobowlSetAct(spec.id);b.sandbox.__motobowlSetAct(spec.id);b.sandbox.__NO_ACTS=1;
  let first=-1,phase='',tactic='';
  for(let f=1;f<=60+spec.warn+90;f++){
    a.frames(1,false);b.frames(1,false);
    if(first<0&&a.sandbox.__motobowlMotion()!==b.sandbox.__motobowlMotion()){
      first=f;const s=a.sandbox.__motobowlActState();phase=s[spec.id];tactic=s.tactic;break;
    }
  }
  a.frames(60+spec.warn+90,false);b.frames(60+spec.warn+90,false);
  const pa=a.sandbox.__motobowlProbe(),pb=b.sandbox.__motobowlProbe(),
    notes=pa.acts.notes.filter(n=>n.id===spec.id),
    warning=notes.find(n=>n.kind==='act-warning'),land=notes.find(n=>n.kind==='act-land'),
    lead=warning&&land?land.tag-warning.tag:null;
  console.log(`  ${spec.id}: ${lead}f warning; first body/intent divergence ${first}f in ${phase}, tactic ${tactic}`);
  if(!warning||!land||lead!==spec.warn)fail(`${spec.id}: warning/land note pair was not exactly ${spec.warn} frames`);
  if(first<0||phase!=='warn'||tactic!==spec.tactic)
    fail(`${spec.id}: first physical/control divergence was not the legible warning response (${first}f/${phase}/${tactic})`);
  if(pb.acts.notes.some(n=>n.id===spec.id))fail(`__NO_ACTS emitted ${spec.id} notes`);
}
{
  const game=bootGame('motobowl',{seed:0xaca3,footer:FOOTER});game.sandbox.__motobowlSetAct('storm');game.frames(80,false);
  const warning=game.sandbox.__motobowlProbe();press(game,'Enter');press(game,'Enter');const reset=game.sandbox.__motobowlProbe();
  game.frames(400,false);const after=game.sandbox.__motobowlProbe(),
    staleLands=after.acts.notes.filter(n=>n.id==='storm'&&n.kind==='act-land').length;
  console.log(`  session reset during warning: ${warning.acts.storm}->${reset.acts.storm}; stale lands ${staleLands}`);
  if(warning.acts.storm!=='warn'||reset.acts.storm!=='calm'||staleLands!==0||!after.finite||!after.playing)
    fail('session reset leaked or landed the canceled warning act');
}

console.log('8) manual takeover: two Enter gate and all human fields traverse applyIntent');
{
  const game=bootGame('motobowl',{seed:0xacb1,footer:FOOTER}),initial=game.sandbox.__motobowlManual();
  press(game,'Enter');const instructions=game.sandbox.__motobowlManual();
  press(game,'Enter');const started=game.sandbox.__motobowlManual();
  console.log(`  playing ${initial.playing}->${instructions.playing}->${started.playing}`);
  if(initial.playing||instructions.playing||!started.playing)fail('manual session skipped the two-Enter instructions gate');
  game.sandbox.__mbClearApplied();
  game.key('keydown','ArrowLeft');game.frames(6,false);game.key('keyup','ArrowLeft');
  const pickLeft=game.sandbox.__mbLastApplied();
  const m=game.sandbox.__motobowlManual();
  if(!pickLeft||pickLeft.tactic!=='MANUAL'||pickLeft.steer!==-1||m.pick!==0)
    fail(`manual Left in the huddle did not steer the play call: ${JSON.stringify({pickLeft,pick:m.pick})}`);
  game.frames(120,false); // snap fires
  game.sandbox.__mbClearApplied();
  game.key('keydown','ArrowUp');game.frames(8,false);game.key('keyup','ArrowUp');
  const turbo=game.sandbox.__mbLastApplied();
  game.sandbox.__mbClearApplied();
  game.key('keydown','Space');game.frames(2,false);game.key('keyup','Space');
  const jump=game.sandbox.__mbLastApplied();
  game.sandbox.__mbClearApplied();
  game.key('keydown','ArrowRight');game.key('keydown','KeyX');game.frames(2,false);
  game.key('keyup','KeyX');game.key('keyup','ArrowRight');
  const juke=game.sandbox.__mbLastApplied();
  const p=game.sandbox.__motobowlProbe();
  console.log(`  intents turbo ${turbo&&turbo.turbo}, jump ${jump&&jump.jump}, juke ${juke&&juke.juke}, applied ${p.stats.appliedIntents}`);
  if(!turbo||!turbo.turbo||turbo.tactic!=='MANUAL')fail('manual Up did not reach common applyIntent as turbo');
  if(!jump||!jump.jump||jump.tactic!=='MANUAL')fail('manual Space did not reach common applyIntent as jump');
  if(!juke||juke.juke!==1||juke.tactic!=='MANUAL')fail('manual X did not reach common applyIntent as a juke');
  if(p.stats.appliedIntents<25)fail('manual controller bypassed the shared intent application path');
}

console.log('9) 15-minute title match + payoff ladder: exact apex budgets and admire gate');
{
  const game=bootGame('motobowl',{seed:0xe000+377*6,footer:FOOTER});
  while(!game.sandbox.__mbEndingLog.length&&game.sandbox.__motobowlProbe().showFrame<62000)game.frames(600,false);
  game.frames(420,false);
  const p=game.sandbox.__motobowlProbe(),ending=game.sandbox.__mbEndingLog[0],show=p.show,
    o=show.offeredByTier,s=show.shownByTier,s3=s[3]||0,
    admire=game.sandbox.__motobowlAdmireFixture();
  console.log(`  ending ${ending&&ending.runFrame} runf ${ending&&ending.outcome} ${ending&&ending.homeScore}-${ending&&ending.rivalScore}; `+
    `tiers ${JSON.stringify(o)} shown ${JSON.stringify(s)}; hold ${show.heldFrames}, slow ${show.slowedFrames}, admire ${show.admireFrames}`);
  if(!ending||ending.runFrame!==54000||ending.state!=='ending'||ending.resultT!==360||p.stats.endings!==1)
    fail(`the title match did not culminate exactly at run frame 54000: ${JSON.stringify(ending)}`);
  if(ending.outcome!=='TITLE WON'||ending.homeScore<=ending.rivalScore||ending.rivalScore!==98)
    fail(`15-minute arc ended without an earned title on the calibrated seed: ${JSON.stringify(ending)}`);
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=1))fail(`offered payoff ladder not strictly ordered: ${JSON.stringify(o)}`);
  if(!((s[1]||0)>(s[2]||0)&&(s[2]||0)>(s[3]||0)&&(s[3]||0)>=1))fail(`shown payoff ladder not strictly ordered: ${JSON.stringify(s)}`);
  if(show.heldFrames!==6*s3)fail(`apex hitstop ${show.heldFrames} != 6*${s3}`);
  if(show.slowedFrames!==24*s3)fail(`apex slow motion ${show.slowedFrames} != 24*${s3}`);
  if(show.admireFrames!==48*s3)fail(`apex admire ${show.admireFrames} != 48*${s3}`);
  if(admire.admired!=='ADMIRE'||admire.gated==='ADMIRE')fail(`__NO_ADMIRE did not gate the bot-only pause: ${JSON.stringify(admire)}`);
}
{
  const game=bootGame('motobowl',{seed:0xacb2,footer:FOOTER});game.sandbox.__motobowlNearApexSetup();
  for(let i=0;i<100&&!game.sandbox.__mbEndingLog.length;i++)game.frames(1,false);
  const ending=game.sandbox.__mbEndingLog[0],active=game.sandbox.__motobowlProbe().show.active;
  game.frames(120,false);const drained=game.sandbox.__motobowlProbe(),s3=drained.show.shownByTier[3]||0;
  console.log(`  near-apex completion: ending at ${ending&&ending.runFrame} with active tier ${active&&active.tier}; `+
    `drained ${drained.show.heldFrames}/${drained.show.slowedFrames}/${drained.show.admireFrames}f over ${s3} apex`);
  if(!ending||!active||active.tier!==3||drained.state!=='ending'||drained.show.active||s3!==1||
    drained.show.heldFrames!==6||drained.show.slowedFrames!==24||drained.show.admireFrames!==48)
    fail(`match completion did not safely drain the active tier-3 cue: ${JSON.stringify({ending,active,show:drained.show})}`);
}

console.log('10) payoff FX parity: disabling sim-inert bursts changes no outcome state');
{
  const a=bootGame('motobowl',{seed:0xacc1,footer:FOOTER}),b=bootGame('motobowl',{seed:0xacc1,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);
  const same=a.sandbox.__motobowlSignature()===b.sandbox.__motobowlSignature();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} after ${a.sandbox.__motobowlProbe().stats.tds} touchdowns`);
  if(!same)fail('__NO_PAYOFF_FX changed rusher, defense, terrain, act, or score state');
}

console.log('11) shared ten-minute soak: moving, happening, and scoring');
{
  const{samples}=runSoak('motobowl',{seed:0xd000,footer:FOOTER,minutes:10}),report=analyzeSoak(samples);
  console.log('  '+soakLine(report));
  assertSoak('motobowl soak',report,{still:4,quiet:8,stall:20,minEvents:770,minProgress:185},fail);
}

console.log('12) viewer story: plain goal from frame one, truthful receipts, presentation-only A/B');
{
  const game=bootGame('motobowl',{seed:0xacd1,footer:FOOTER});game.frames(1,true);
  const v=game.sandbox.__motobowlViewerProbe();
  console.log(`  opening "${v.drawn.hud}" / "${v.drawn.verb}" / "${v.drawn.downLine}" chains ${v.drawn.chainDrawn}`);
  if(!v.enabled||!v.drawn.enabled||v.drawn.frame!==game.sandbox.__motobowlProbe().showFrame||
    v.drawn.hud!=='MOTO BOWL  HOME 0 · AWAY 0'||v.drawn.hud!==v.hud||
    v.drawn.downLine!=='1ST & 10'||v.drawn.downLine!==v.downLine||
    !v.drawn.verb||v.drawn.verb!==v.verb||!v.drawn.chainDrawn)
    fail(`first rendered frame did not plainly explain the show: ${JSON.stringify(v)}`);
  game.frames(7199,true);
  const p=game.sandbox.__motobowlProbe(),v2=game.sandbox.__motobowlViewerProbe();
  console.log(`  2 minutes in: "${v2.drawn.hud}", down "${v2.drawn.downLine}"`);
  if(v2.homeScore!==p.homeScore||v2.rivalScore!==p.rivalScore||v2.drawn.hud!==v2.hud||
    v2.drawn.downLine!==v2.downLine||v2.drawn.verb!==v2.verb||p.homeScore<1||
    !v2.hud.includes('HOME '+p.homeScore)||!v2.hud.includes('AWAY '+p.rivalScore))
    fail(`persistent goal HUD disagreed with simulation truth: ${JSON.stringify({v2,home:p.homeScore,rival:p.rivalScore})}`);

  const labels=new Map();let checked=0;
  for(let i=0;i<240;i++){
    game.frames(30,false);
    const pp=game.sandbox.__motobowlProbe(),vv=game.sandbox.__motobowlViewerProbe();
    if(!vv.forecast)continue;
    checked++;labels.set(vv.forecast,(labels.get(vv.forecast)||0)+1);
    const projected=pp.rusher.y+vv.forecastGain,toGain=pp.toGainYd*7;
    const ok=vv.forecast==='TO THE HOUSE'?projected>=700:
      vv.forecast==='CHAINS AHEAD'?projected>=toGain:
      vv.forecast==='SHORT OF CHAINS'?projected<toGain:false;
    if(!ok)fail(`drive forecast lied: ${vv.forecast} with projected ${projected.toFixed(1)} vs chains ${toGain}`);
  }
  console.log(`  forecasts over 2 minutes: ${JSON.stringify([...labels])} (${checked} samples)`);
  if(checked<20||labels.size<2)fail(`forecast layer too quiet: ${checked} samples, ${labels.size} labels`);

  const a=bootGame('motobowl',{seed:0xacd3,footer:FOOTER}),b=bootGame('motobowl',{seed:0xacd3,footer:FOOTER});
  b.sandbox.__NO_VIEWER_STORY=1;a.frames(7200,true);b.frames(7200,true);
  const same=a.sandbox.__motobowlSignature()===b.sandbox.__motobowlSignature(),
    ra=a.sandbox.__mbNextRandom(),rb=b.sandbox.__mbNextRandom(),
    va=a.sandbox.__motobowlViewerProbe(),vb=b.sandbox.__motobowlViewerProbe();
  console.log(`  2-minute rendered A/B signatures ${same?'identical':'DIFFER'}; next RNG ${ra.toFixed(8)}/${rb.toFixed(8)}; story ${va.enabled}/${vb.enabled}`);
  if(!same)fail('viewer story rendering changed the same-seed simulation');
  if(ra!==rb)fail('viewer story consumed engine RNG for simulation-invisible work');
  if(!va.enabled||vb.enabled||vb.drawn.hud!==''||vb.drawn.verb!==''||vb.drawn.downLine!==''||vb.drawn.chainDrawn)
    fail(`__NO_VIEWER_STORY did not cleanly ablate the presentation layer: ${JSON.stringify({va,vb})}`);
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
