#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');

const FOOTER=`
globalThis.__ggApplied=[];
{const __gga0=applyIntent;applyIntent=intent=>{const out=__gga0(intent);
  globalThis.__ggApplied.push(Object.assign({},out));
  if(globalThis.__ggApplied.length>240)globalThis.__ggApplied.shift();return out;};}
globalThis.__ggClearApplied=()=>{globalThis.__ggApplied.length=0;};
globalThis.__ggLastApplied=()=>globalThis.__ggApplied.at(-1)||null;
globalThis.__ggFormationFixture=()=>{
  const incoming=forecastByLane(),defense=defenseByLane(),projection=projectFormation(null),types={};
  for(const p of slots.flat().filter(Boolean))types[p.type]=(types[p.type]||0)+1;
  return{lanes:slots.length,slots:slots.map(r=>r.length),plants:slots.flat().filter(Boolean).length,
    lanePlants:slots.map(r=>r.filter(Boolean).length),types,waveSize:wavePlan.length,
    uniqueWaveIds:new Set(wavePlan.map(q=>q.id)).size,incoming,defense,
    projection:projection.lanes.map(x=>({lane:x.lane,load:x.load,hold:x.hold,risk:x.risk,margin:x.margin})),
    greenhouse,greenhouseMax:GREENHOUSE_MAX,finite:allFinite()};
};
`;

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const sum=(a,fn)=>a.reduce((n,v)=>n+fn(v),0);

// Fresh 20-seed x 10-minute calibration on 2026-07-10
// (0x6800 + i*173): held 28..39, kills 292..376, breaches 0..74,
// builds 48..77, transplants 4..24, saves 11..50, lapses 0..10,
// events 2094..2958, progress 472..511, event lull 185..256f, story
// lull 469..661f. All reached wave 40 / stage 3 with six chapters.
// The bands add measured margin while preserving both competence and drama.
const WATCH_BANDS={
  wavesHeld:[25,40],kills:[270,400],breaches:[0,85],plants:[42,85],
  transplants:[2,30],saves:[8,58],lapses:[0,14],events:[1900,3200],progress:[450,535]
};
// The same ten-seed reactive ablation measured held 28..33, kills 294..348,
// breaches 30..72, builds 76..96, transplants 0, saves 38..72,
// events 2263..2895, and progress 481..510.
const REACTIVE_BANDS={
  wavesHeld:[25,36],kills:[270,370],breaches:[24,85],plants:[70,105],
  transplants:[0,0],saves:[32,80],lapses:[1,13],events:[2100,3050],progress:[455,535]
};
function inBands(p,bands,label){
  for(const[k,[lo,hi]]of Object.entries(bands)){
    const v=p.stats[k];
    if(v<lo||v>hi)fail(`${label}: ${k} ${v} outside measured band ${lo}..${hi}`);
  }
}
function actPairs(p,label,minPairs){
  const notes=p.act.notes.filter(n=>n.id==='blood-moon'),warnings=notes.filter(n=>n.kind==='act-warning'),
    lands=notes.filter(n=>n.kind==='act-land');
  if(warnings.length<minPairs||lands.length!==warnings.length)
    fail(`${label}: Blood Moon emitted ${warnings.length} warnings / ${lands.length} lands (need ${minPairs}+ pairs)`);
  for(let i=0;i<Math.min(warnings.length,lands.length);i++){
    if(lands[i].tag-warnings[i].tag!==240)
      fail(`${label}: Blood Moon pair ${i} warned ${lands[i].tag-warnings[i].tag}f, expected 240`);
    if(warnings[i].landsAt!==warnings[i].at+240)
      fail(`${label}: Blood Moon pair ${i} published a false landing frame`);
  }
}
function expectedForecast(f){
  return f.risk<.35?'FORMATION HOLDS':f.risk<1.35?`LANE ${f.lane+1} STRAINS`:
    `BREACH LIKELY · LANE ${f.lane+1}`;
}

console.log('1) deterministic replay + render + chunk parity at fixed 60 Hz');
{
  const a=bootGame('grave-garden',{seed:0x6710,footer:FOOTER}),
    b=bootGame('grave-garden',{seed:0x6710,footer:FOOTER}),
    rendered=bootGame('grave-garden',{seed:0x6710,footer:FOOTER});
  a.frames(7200,false);b.frames(7200,false);rendered.frames(7200,true);
  const sa=a.sandbox.__graveGardenSignature(),sb=b.sandbox.__graveGardenSignature(),
    sr=rendered.sandbox.__graveGardenSignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; `+
    `${rendered.counter.calls} canvas calls`);
  if(sa!==sb)fail('same-seed headless runs diverged');
  if(sa!==sr)fail('render traversal changed simulation state or RNG');
  if(!a.sandbox.__graveGardenProbe().finite)fail('deterministic replay ended non-finite');

  const mono=bootGame('grave-garden',{seed:0x6712,footer:FOOTER}),
    chunked=bootGame('grave-garden',{seed:0x6712,footer:FOOTER});
  mono.frames(18000,false);for(let i=0;i<1800;i++)chunked.frames(10,false);
  const same=mono.sandbox.__graveGardenSignature()===chunked.sandbox.__graveGardenSignature();
  console.log(`  18,000 monolithic frames vs 1,800 x 10: ${same?'identical':'DIFFERENT'}`);
  if(!same)fail('headless batching changed the fixed-step result');
}

console.log('2) planner purity + RNG isolation, then a complete physical opening wave');
{
  const planned=bootGame('grave-garden',{seed:0x6702,footer:FOOTER}),
    control=bootGame('grave-garden',{seed:0x6702,footer:FOOTER});
  const f=planned.sandbox.__graveGardenPlannerFixture(),rp=planned.sandbox.__graveGardenNextRandom(),
    rc=control.sandbox.__graveGardenNextRandom();
  console.log(`  pure ${f.pure}; repeat ${f.repeat}; ${f.plan.action} ${f.plan.type||''} at `+
    `${f.plan.lane}/${f.plan.col}; next RNG ${rp.toFixed(8)}/${rc.toFixed(8)}`);
  if(!f.pure||!f.repeat||!f.finite)fail(`formation planner fixture regressed: ${JSON.stringify(f)}`);
  if(!f.plan||!['build','move','wait'].includes(f.plan.action)||!f.projection||f.projection.lanes.length!==4)
    fail(`planner returned an invalid copied-state result: ${JSON.stringify(f)}`);
  if(f.projection.lanes.some(l=>![l.load,l.hold,l.risk,l.margin].every(Number.isFinite)))
    fail('planner projection contains non-finite lane values');
  if(rp!==rc)fail('formation planning consumed engine RNG');

  const game=bootGame('grave-garden',{seed:0x6701,footer:FOOTER}),base=game.sandbox.__ggFormationFixture();
  console.log(`  opening: ${base.plants} plants, ${base.waveSize} telegraphed attackers, `+
    `lane defense ${base.defense.map(v=>v.toFixed(1)).join('/')}, glass ${base.greenhouse}/${base.greenhouseMax}`);
  if(!base.finite||base.lanes!==4||base.slots.some(n=>n!==3)||base.plants!==8||
    base.lanePlants.some(n=>n!==2)||base.types.bloom!==2||base.types.pea!==4||base.types.thorn!==2)
    fail(`authored opening formation changed or became invalid: ${JSON.stringify(base)}`);
  if(base.waveSize!==4||base.uniqueWaveIds!==base.waveSize||base.incoming.reduce((n,v)=>n+v,0)<=0||
    base.defense.some(v=>!(v>0))||base.projection.some(l=>![l.load,l.hold,l.risk,l.margin].every(Number.isFinite)))
    fail(`opening wave/formation projection is not physically coherent: ${JSON.stringify(base)}`);
  if(base.greenhouse!==200||base.greenhouseMax!==200)
    fail(`greenhouse contract is ${base.greenhouse}/${base.greenhouseMax}, expected 200/200`);

  game.frames(900,false);const p=game.sandbox.__graveGardenProbe();
  console.log(`  first cycle: wave ${p.waveNo}, ${p.stats.kills} kills, ${p.stats.plants} builds, `+
    `${p.stats.wavesHeld} held, gardener ${p.gardener.pose} at ${p.gardener.x.toFixed(1)},${p.gardener.y.toFixed(1)}`);
  if(!p.finite||p.waveNo!==2||p.stats.waves!==2||p.stats.wavesHeld!==1||p.stats.kills<2||
    p.stats.plants<2||p.stats.progress<5||p.stats.appliedIntents<890||p.plants<=base.plants)
    fail(`the first physical wave did not move, build, fight, and resolve: ${JSON.stringify(p)}`);
}

console.log('3) measured ten-minute watchability: ten representative smart seeds');
const watch=[],watchSeeds=Array.from({length:10},(_,i)=>0x6700+i*137);
for(const seed of watchSeeds){
  const game=bootGame('grave-garden',{seed,footer:FOOTER});game.frames(36000,false);
  const p=game.sandbox.__graveGardenProbe();watch.push(p);
  console.log(`  ${seed.toString(16)} ${p.persona.padEnd(5)}: ${p.stats.wavesHeld}/40 held, `+
    `${p.stats.kills} kills, ${p.stats.breaches} breaches, ${p.stats.plants} builds, `+
    `${p.stats.transplants} moves, ${p.stats.saves} saves, ${p.stats.lapses} lapses, glass ${p.greenhouse}`);
  if(!p.finite)fail(`seed ${seed.toString(16)}: non-finite world state`);
  inBands(p,WATCH_BANDS,`seed ${seed.toString(16)} ${p.persona}`);
  if(p.waveNo!==40||p.stats.waves!==40||p.stage!==3||p.stats.chapters!==6)
    fail(`seed ${seed.toString(16)}: expected wave 40/stage 3/six chapters, got `+
      `${p.waveNo}/${p.stage}/${p.stats.chapters}`);
  if(p.greenhouse<130||p.greenhouse>200)
    fail(`seed ${seed.toString(16)}: greenhouse ${p.greenhouse} outside measured 130..200`);
  if(p.maxEventLull>300)fail(`seed ${seed.toString(16)}: event lull ${p.maxEventLull}f exceeds 300f`);
  if(p.maxProgressLull>840)fail(`seed ${seed.toString(16)}: progress lull ${p.maxProgressLull}f exceeds 840f`);
  actPairs(p,`seed ${seed.toString(16)}`,5);
}

console.log('4) formation-plan A/B: ten paired ten-minute seeds vs reactive gardening');
{
  let heldWins=0,smartBreaches=0,reactiveBreaches=0,smartHeld=0,reactiveHeld=0;
  for(const seed of watchSeeds){
    const reactive=bootGame('grave-garden',{seed,footer:FOOTER}),
      smart=bootGame('grave-garden',{seed,footer:FOOTER});
    reactive.sandbox.__NO_FORMATION_PLAN=1;
    // Run the baseline first: the pair is independent but the report retains
    // the baseline-first measurement discipline used to derive this feature.
    reactive.frames(36000,false);smart.frames(36000,false);
    const pb=reactive.sandbox.__graveGardenProbe(),pa=smart.sandbox.__graveGardenProbe();
    if(pa.stats.wavesHeld>=pb.stats.wavesHeld)heldWins++;
    smartBreaches+=pa.stats.breaches;reactiveBreaches+=pb.stats.breaches;
    smartHeld+=pa.stats.wavesHeld;reactiveHeld+=pb.stats.wavesHeld;
    inBands(pa,WATCH_BANDS,`seed ${seed.toString(16)} smart`);
    inBands(pb,REACTIVE_BANDS,`seed ${seed.toString(16)} reactive`);
    if(!pa.finite||!pb.finite||pa.waveNo!==40||pb.waveNo!==40)
      fail(`seed ${seed.toString(16)}: policy pair did not finish ten valid minutes`);
    if(pa.greenhouse<130||pa.greenhouse>200||pb.greenhouse<125||pb.greenhouse>190)
      fail(`seed ${seed.toString(16)}: policy glass outside measured bands ${pa.greenhouse}/${pb.greenhouse}`);
    console.log(`  ${seed.toString(16)} ${pa.persona.padEnd(5)} smart ${pa.stats.wavesHeld} held/${pa.stats.breaches} breach `+
      `vs reactive ${pb.stats.wavesHeld}/${pb.stats.breaches}`);
  }
  const ratio=smartBreaches/Math.max(1,reactiveBreaches);
  console.log(`  ${heldWins}/10 held-wave wins or ties; held ${smartHeld}/${reactiveHeld}; `+
    `breaches ${smartBreaches}/${reactiveBreaches} (${(ratio*100).toFixed(1)}%)`);
  if(heldWins<8)fail(`formation planner won or tied held waves on only ${heldWins}/10 seeds`);
  if(smartBreaches>reactiveBreaches*.75)
    fail(`formation planner breaches ${smartBreaches}/${reactiveBreaches} exceed the 75% ceiling`);
  if(smartHeld<=reactiveHeld)fail(`formation planner did not improve aggregate held waves ${smartHeld}/${reactiveHeld}`);
}

console.log('5) Blood Moon: exact warning pair and first real divergence during warn');
{
  const a=bootGame('grave-garden',{seed:0x6a11,footer:FOOTER}),
    b=bootGame('grave-garden',{seed:0x6a11,footer:FOOTER});
  a.sandbox.__graveGardenSetAct();b.sandbox.__graveGardenSetAct();b.sandbox.__NO_ACTS=1;
  let first=-1,phase='',tactic='',target=-1;
  for(let f=1;f<=390;f++){
    a.frames(1,false);b.frames(1,false);
    if(first<0&&a.sandbox.__graveGardenMotion()!==b.sandbox.__graveGardenMotion()){
      first=f;const s=a.sandbox.__graveGardenActState();phase=s.phase;tactic=s.tactic;target=s.targetLane;
    }
  }
  const pa=a.sandbox.__graveGardenProbe(),pb=b.sandbox.__graveGardenProbe(),
    warning=pa.act.notes.find(n=>n.kind==='act-warning'&&n.id==='blood-moon'),
    land=pa.act.notes.find(n=>n.kind==='act-land'&&n.id==='blood-moon'),
    lead=warning&&land?land.tag-warning.tag:null;
  console.log(`  ${lead}f warning; first motion/intent divergence f${first} in ${phase}, `+
    `target lane ${target+1}, tactic ${tactic}`);
  if(!warning||!land||lead!==240||warning.landsAt-warning.at!==240)
    fail('Blood Moon warning/land telemetry was not exactly 240 frames');
  if(first<0||phase!=='warn'||tactic!=='FORTIFY MOON LANE')
    fail(`first Blood Moon divergence was not the legible warn response: ${first}/${phase}/${tactic}`);
  if(pb.act.notes.length||pb.act.phase!=='calm')fail('__NO_ACTS emitted notes or left an act phase live');
  if(!pa.finite||!pb.finite)fail('Blood Moon paired fixture became non-finite');
}

console.log('6) manual controller: two-Enter gate and shared applyIntent path');
{
  const game=bootGame('grave-garden',{seed:0x6800,footer:FOOTER}),initial=game.sandbox.__graveGardenManual();
  press(game,'Enter');const instructions=game.sandbox.__graveGardenManual();
  press(game,'Enter');const started=game.sandbox.__graveGardenManual();
  console.log(`  playing ${initial.playing}->${instructions.playing}->${started.playing}`);
  if(initial.playing||instructions.playing||!started.playing)fail('manual session skipped the two-Enter gate');
  game.sandbox.__ggClearApplied();press(game,'ArrowRight');press(game,'ArrowRight');press(game,'Space');
  const applied=game.sandbox.__ggLastApplied(),task=game.sandbox.__graveGardenManual().task;
  console.log(`  applied ${applied&&applied.action} ${applied&&applied.type} at `+
    `${applied&&applied.lane}/${applied&&applied.col}`);
  if(!applied||applied.tactic!=='MANUAL'||applied.action!=='build'||applied.type!=='pea'||
    applied.lane!==0||applied.col!==2||!task||task.action!=='build')
    fail(`manual plant did not traverse the common intent/task path: ${JSON.stringify({applied,task})}`);
  game.frames(220,false);const p=game.sandbox.__graveGardenProbe();
  if(p.stats.appliedIntents<220||p.stats.plants!==1||p.plants!==9||!p.finite)
    fail(`manual task did not physically walk, dig, and plant: ${JSON.stringify(p)}`);
}

console.log('7) payoff ladder: strict tiers, exact 6/24/42 apex budgets, admire gate');
{
  const game=bootGame('grave-garden',{seed:0x6711,footer:FOOTER});game.frames(36000,false);
  const p=game.sandbox.__graveGardenProbe(),show=p.show,o=show.offeredByTier,s=show.shownByTier,
    s3=s[3]||0,admire=game.sandbox.__graveGardenAdmireFixture();
  console.log(`  offered ${JSON.stringify(o)}, shown ${JSON.stringify(s)}; `+
    `hold ${show.heldFrames}, slow ${show.slowedFrames}, admire ${show.admireFrames}`);
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=1))
    fail(`offered payoff ladder not strictly ordered: ${JSON.stringify(o)}`);
  if(!((s[1]||0)>(s[2]||0)&&(s[2]||0)>(s[3]||0)&&(s[3]||0)>=1))
    fail(`shown payoff ladder not strictly ordered: ${JSON.stringify(s)}`);
  if(s3!==p.stats.chapters||s3!==6)fail(`expected one shown apex per chapter, got ${s3}/${p.stats.chapters}`);
  if(show.heldFrames!==6*s3)fail(`apex hitstop ${show.heldFrames} != 6*${s3}`);
  if(show.slowedFrames!==24*s3)fail(`apex slow motion ${show.slowedFrames} != 24*${s3}`);
  if(show.admireFrames!==42*s3)fail(`apex admire ${show.admireFrames} != 42*${s3}`);
  if(admire.admired!=='ADMIRE THE GARDEN'||admire.gated==='ADMIRE THE GARDEN')
    fail(`__NO_ADMIRE did not gate the bot-only pause: ${JSON.stringify(admire)}`);
}

console.log('8) payoff FX parity: the presentation switch is an exact sim no-op');
{
  const a=bootGame('grave-garden',{seed:0x68f1,footer:FOOTER}),
    b=bootGame('grave-garden',{seed:0x68f1,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);
  const same=a.sandbox.__graveGardenSignature()===b.sandbox.__graveGardenSignature(),
    ra=a.sandbox.__graveGardenNextRandom(),rb=b.sandbox.__graveGardenNextRandom(),
    p=a.sandbox.__graveGardenProbe();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} through ${p.stats.kills} kills / `+
    `${p.stats.chapters} apexes; next RNG ${ra.toFixed(8)}/${rb.toFixed(8)}`);
  if(!same)fail('__NO_PAYOFF_FX changed garden, enemies, wave, act, or outcome state');
  if(ra!==rb)fail('__NO_PAYOFF_FX changed the engine RNG stream');
  if(p.stats.kills<100||p.stats.chapters<2)fail('payoff parity run did not traverse enough real payoff events');
}

console.log('9) shared ten-minute soak: moving, happening, and progressing');
{
  const{samples}=runSoak('grave-garden',{seed:0x6700,footer:FOOTER,minutes:10}),report=analyzeSoak(samples);
  console.log('  '+soakLine(report));
  // Current fixed-seed observation is 3s still / 3s quiet / 11s stalled;
  // retain one to four seconds of measured margin rather than hiding a freeze.
  assertSoak('grave-garden soak',report,{still:4,quiet:5,stall:15,minEvents:2200,minProgress:450},fail);
}

console.log('10) viewer story: truthful first frame and render-only ablation parity');
{
  const game=bootGame('grave-garden',{seed:0x68f2,footer:FOOTER});game.frames(1,true);
  const p=game.sandbox.__graveGardenProbe(),v=game.sandbox.__graveGardenViewerProbe(),expected=expectedForecast(p.forecast);
  console.log(`  opening "${v.drawn.hud}" / "${v.drawn.forecast}" / "${v.drawn.verb}"`);
  if(!v.enabled||v.drawn.frame!==p.showFrame||v.hud!=='KEEP THE GREENHOUSE ALIVE'||
    v.drawn.hud!==v.hud||v.forecast!==expected||v.drawn.forecast!==expected||
    v.drawn.greenhouse!==p.greenhouse||v.drawn.wave!==p.waveNo||!v.drawn.verb)
    fail(`first rendered frame did not truthfully explain the show: ${JSON.stringify({p,v,expected})}`);
  game.frames(7199,true);const p2=game.sandbox.__graveGardenProbe(),v2=game.sandbox.__graveGardenViewerProbe(),
    expected2=expectedForecast(p2.forecast);
  if(v2.drawn.frame!==p2.showFrame||v2.drawn.hud!==v2.hud||v2.drawn.forecast!==expected2||
    v2.drawn.greenhouse!==p2.greenhouse||v2.drawn.wave!==p2.waveNo||!v2.drawn.verb)
    fail(`two-minute viewer story drifted from simulation truth: ${JSON.stringify({p2,v2,expected2})}`);

  const a=bootGame('grave-garden',{seed:0x68f3,footer:FOOTER}),
    b=bootGame('grave-garden',{seed:0x68f3,footer:FOOTER});
  b.sandbox.__NO_VIEWER_STORY=1;a.frames(7200,true);b.frames(7200,true);
  const same=a.sandbox.__graveGardenSignature()===b.sandbox.__graveGardenSignature(),
    ra=a.sandbox.__graveGardenNextRandom(),rb=b.sandbox.__graveGardenNextRandom(),
    va=a.sandbox.__graveGardenViewerProbe(),vb=b.sandbox.__graveGardenViewerProbe();
  console.log(`  rendered A/B ${same?'identical':'DIFFERENT'}; next RNG ${ra.toFixed(8)}/${rb.toFixed(8)}; `+
    `story ${va.enabled}/${vb.enabled}`);
  if(!same||ra!==rb)fail('viewer story rendering changed simulation state or RNG');
  if(!va.enabled||vb.enabled||!va.drawn.hud||!va.drawn.forecast||!va.drawn.verb||
    vb.drawn.hud||vb.drawn.forecast||vb.drawn.verb)
    fail(`__NO_VIEWER_STORY did not cleanly ablate rendered story fields: ${JSON.stringify({va,vb})}`);
}

console.log('11) human-flavored lapse texture: default floor and exact ablation');
{
  const totalDefault=sum(watch,p=>p.stats.lapses),minDefault=Math.min(...watch.map(p=>p.stats.lapses));
  let noLapse=0;
  for(let i=0;i<6;i++){
    const seed=watchSeeds[i],game=bootGame('grave-garden',{seed,footer:FOOTER});
    game.sandbox.__NO_LAPSE=1;game.frames(36000,false);const p=game.sandbox.__graveGardenProbe();
    noLapse+=p.stats.lapses;
    if(!p.finite||p.waveNo!==40)fail(`__NO_LAPSE seed ${seed.toString(16)} did not remain a valid ten-minute show`);
  }
  console.log(`  default ${totalDefault} lapses across ten seeds (minimum ${minDefault}); ablated ${noLapse} across six`);
  if(minDefault<2||totalDefault<40)fail(`default lapse texture too quiet: minimum ${minDefault}, total ${totalDefault}`);
  if(noLapse!==0)fail(`__NO_LAPSE still recorded ${noLapse} lapses`);
}

console.log('12) fifteen-minute dawn: fixed ending, final chapter, and drained apex');
{
  const game=bootGame('grave-garden',{seed:0x68ad,footer:FOOTER});let displayFrames=0;
  while(game.sandbox.__graveGardenProbe().state==='play'&&displayFrames<60000){
    game.frames(60,false);displayFrames+=60;
  }
  const ending=game.sandbox.__graveGardenProbe();game.frames(150,false);
  const drained=game.sandbox.__graveGardenProbe(),s3=drained.show.shownByTier[3]||0;
  console.log(`  ${ending.outcome} at run frame ${ending.runFrame}: wave ${ending.waveNo}, stage ${ending.stage}, `+
    `glass ${ending.greenhouse}, ${ending.stats.wavesHeld} held / ${ending.stats.breaches} breaches; `+
    `apex ${drained.show.heldFrames}/${drained.show.slowedFrames}/${drained.show.admireFrames}`);
  if(ending.state!=='ending'||ending.runFrame!==54000||ending.waveNo!==60||ending.stage!==5||
    ending.outcome!=='DAWN SAVED'||ending.greenhouse<=0||ending.stats.waves!==60||ending.stats.chapters!==9)
    fail(`the calibrated fifteen-minute garden did not earn dawn exactly: ${JSON.stringify(ending)}`);
  if(drained.state!=='ending'||drained.show.active||s3!==10||drained.show.heldFrames!==6*s3||
    drained.show.slowedFrames!==24*s3||drained.show.admireFrames!==42*s3)
    fail(`the final dawn apex did not drain exact show budgets: ${JSON.stringify(drained.show)}`);
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
