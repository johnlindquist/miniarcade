#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');

// Read-only observation hooks and deterministic fixtures. The wrappers record
// the same runtime intent path without changing decisions, physics, or RNG.
const FOOTER=String.raw`
globalThis.__bbApplied=[];
{const __bbApply0=applyIntent;applyIntent=function(intent){const out=__bbApply0(intent);
  globalThis.__bbApplied.push(Object.assign({},intent));
  if(globalThis.__bbApplied.length>300)globalThis.__bbApplied.shift();return out;};}
globalThis.__bbContinuity={diggerMax:0,bossMax:0,digger:null,boss:null,samples:0};
{const __bbStep0=step;step=function(){
  const arena=arenaNo,df=digger&&{x:digger.x,y:digger.y},bf=boss&&{x:boss.x,y:boss.y},out=__bbStep0();
  if(arena===arenaNo&&df&&bf&&digger&&boss){
    const dd=Math.hypot(digger.x-df.x,digger.y-df.y),bd=Math.hypot(boss.x-bf.x,boss.y-bf.y);globalThis.__bbContinuity.samples++;
    if(dd>globalThis.__bbContinuity.diggerMax)Object.assign(globalThis.__bbContinuity,{diggerMax:dd,digger:{from:df,to:{x:digger.x,y:digger.y},showFrame}});
    if(bd>globalThis.__bbContinuity.bossMax)Object.assign(globalThis.__bbContinuity,{bossMax:bd,boss:{from:bf,to:{x:boss.x,y:boss.y},showFrame}});
  }return out;
};}
globalThis.__bbClearApplied=()=>{globalThis.__bbApplied.length=0;};
globalThis.__bbLastApplied=()=>globalThis.__bbApplied.at(-1)||null;
globalThis.__bbAppliedTactics=()=>globalThis.__bbApplied.map(q=>q.tactic);
globalThis.__bbRawCalls=0;
{const __bbRaw0=rawBotDecision;rawBotDecision=function(){globalThis.__bbRawCalls++;return __bbRaw0();};}
globalThis.__bbReactionFrames=()=>({skill:skill.reactionFrames.slice(),perfect:perfectSkill.reactionFrames.slice()});
globalThis.__bbPhysical=()=>[round(digger.x,7),round(digger.y,7),round(digger.vx,7),round(digger.vy,7),
  round(boss.x,7),round(boss.y,7),round(boss.vx,7),round(boss.vy,7)].join('|');
globalThis.__bbIntentMotion=()=>globalThis.__bbPhysical()+'|'+JSON.stringify(digger.intent&&{
  dx:round(digger.intent.dx,5),dy:round(digger.intent.dy,5),dig:!!digger.intent.dig,
  set:!!digger.intent.set,taunt:!!digger.intent.taunt,detonate:!!digger.intent.detonate,
  trapId:digger.intent.trapId,tactic:digger.intent.tactic});
globalThis.__bbTrapSequence=()=>{
  resetGame(true);const before=Object.assign({},stats),outlined=startPlan(),t=traps[outlined.trapId];
  digger.x=cellX(t.anchor.x);digger.y=cellY(t.anchor.y);
  for(let i=0;i<72;i++)applyIntent(targetIntent(t.anchor,'SET THE SHORING CHARGE',{set:true,trapId:t.id}));
  plan.stage='bait';digger.x=cellX(t.bait.x);digger.y=cellY(t.bait.y);
  boss.x=154;boss.y=cellY(t.row);boss.vx=-boss.speed;boss.vy=0;boss.homeRow=t.row;boss.retreat=0;
  const bait=rawBotDecision();applyIntent(bait),lureStage=plan&&plan.stage;
  boss.x=cellX(t.cx);boss.y=cellY(t.row);boss.vx=0;boss.vy=0;boss.hp=1;
  const commit=rawBotDecision();applyIntent(commit);
  const planDuringFall=!!(plan&&plan.trapId===t.id&&t.used&&!t.impact);
  for(let i=0;i<25;i++)stepTraps();
  return{outlined:!!outlined,points:outlined&&outlined.points.length,trapId:t.id,
    armed:t.armed,arming:t.arming,bait:{taunt:bait.taunt,tactic:bait.tactic},lureStage,
    commit:{detonate:commit.detonate,tactic:commit.tactic},planDuringFall,
    fall:t.fall,impact:t.impact,hit:t.hit,bossHp:boss.hp,state,
    delta:{plans:stats.plans-before.plans,trapsSet:stats.trapsSet-before.trapsSet,
      lures:stats.lures-before.lures,caveIns:stats.caveIns-before.caveIns,
      hits:stats.hits-before.hits,bosses:stats.bosses-before.bosses,
      apexes:stats.apexes-before.apexes},finite:finite()};
};
`;

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const sum=(arr,key)=>arr.reduce((n,p)=>n+p.stats[key],0);
const value=(p,key)=>Object.prototype.hasOwnProperty.call(p.stats,key)?p.stats[key]:p[key];
const range=(arr,key)=>[Math.min(...arr.map(p=>value(p,key))),Math.max(...arr.map(p=>value(p,key)))];
const inBands=(p,bands,label)=>{for(const[key,[lo,hi]]of Object.entries(bands)){
  const v=value(p,key);if(v<lo||v>hi)fail(`${label}: ${key} ${v} outside measured band ${lo}..${hi}`);
}};
const trapScore=p=>p.stats.hits*6+p.stats.bosses*25-p.stats.slips*2-p.stats.downs*.5;
const actPairs=(p,id,lead,label,minPairs)=>{
  const notes=p.act.notes.filter(n=>n.id===id),warn=notes.filter(n=>n.kind==='act-warning'),
    land=notes.filter(n=>n.kind==='act-land'),pending=warn.length===land.length+1&&p.act.phase==='warn';
  if(land.length<minPairs||!(warn.length===land.length||pending))
    fail(`${label}: ${id} emitted ${warn.length} warnings / ${land.length} lands`);
  for(let i=0;i<land.length;i++){
    if(land[i].tag-warn[i].tag!==lead||land[i].at-warn[i].at!==lead)
      fail(`${label}: ${id} pair ${i} lead ${land[i].tag-warn[i].tag}/${land[i].at-warn[i].at}, expected ${lead}`);
  }
  return land.length;
};
const assertShow=(show,label,minApex)=>{
  const o=show.offeredByTier,s=show.shownByTier,s3=s[3]||0;
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=minApex))
    fail(`${label}: offered tiers not strictly ordered ${JSON.stringify(o)}`);
  if(!((s[1]||0)>(s[2]||0)&&(s[2]||0)>(s[3]||0)&&(s[3]||0)>=minApex))
    fail(`${label}: shown tiers not strictly ordered ${JSON.stringify(s)}`);
  if(show.heldFrames!==6*s3)fail(`${label}: apex hold ${show.heldFrames} != 6*${s3}`);
  if(show.slowedFrames!==24*s3)fail(`${label}: apex slow ${show.slowedFrames} != 24*${s3}`);
  if(show.admireFrames!==48*s3)fail(`${label}: apex admire ${show.admireFrames} != 48*${s3}`);
};
const assertContinuity=(game,label)=>{
  const c=game.sandbox.__bbContinuity;
  // Measured authored maxima are 1.25px for the digger's caught knockback and
  // 1.05px for the boss's cave-in stagger; anything above these narrow margins
  // is an unaccounted teleport unless arenaNo changed in the wrapped step.
  if(!c||c.samples<100||c.diggerMax>1.3||c.bossMax>1.1)
    fail(`${label}: unaccounted one-step displacement ${JSON.stringify(c)}`);
};

// Registered from ten 10-minute smart-policy runs, seeds 0xb100 + i*211, on
// frozen game SHA-256 e56aeaa7.... Final observed outcome extrema: cave-ins
// 68..72, hits 22..29, slips 40..48, bosses 2..5, downs 4..8, events 620..657,
// progress 157..166, event lulls 315..442f, progress lulls 548..1058f. Bounds
// add margin on both sides; a policy change must rerun the full panel before
// moving any floor or ceiling.
const CAL_BANDS={
  plans:[64,79],trapsSet:[64,79],lures:[64,82],caveIns:[62,79],hits:[15,34],
  slips:[35,58],bosses:[1,9],downs:[2,12],tilesDug:[34,56],acts:[5,7],
  lapses:[1,12],events:[560,710],progress:[145,180],apexes:[1,9],nearMisses:[2,12],
  chapters:[7,14],panicDrops:[0,3],appliedIntents:[33000,35400],arenaNo:[7,13],
  maxEventLull:[250,550],maxProgressLull:[480,1100]
};

// Combined extrema from the final eight paired five-minute seeds in section 5:
// plans/traps/cave-ins 33..39, hits 1..18, slips 17..37, bosses 0..4,
// downs 2..12, tiles 21..27, progress 76..85, panic drops 0..1.
// Both sides must stay lively; the planner cannot win by making the plausible
// late-commit baseline inert or by becoming an implausibly perfect machine.
const POLICY_BANDS={
  plans:[29,44],trapsSet:[29,44],lures:[28,50],caveIns:[28,44],hits:[0,23],
  slips:[13,43],bosses:[0,7],downs:[1,16],tilesDug:[17,33],acts:[2,4],
  lapses:[0,10],events:[270,390],progress:[70,92],apexes:[0,7],nearMisses:[0,25],
  chapters:[3,9],panicDrops:[0,3]
};

console.log('1) deterministic fixed-step replay, render parity, chunk parity, and finite canvas path');
{
  const a=bootGame('burrow-boss',{seed:0xbb01,footer:FOOTER}),
    b=bootGame('burrow-boss',{seed:0xbb01,footer:FOOTER}),
    rendered=bootGame('burrow-boss',{seed:0xbb01,footer:FOOTER});
  a.frames(900,false);b.frames(900,false);const draws=rendered.frames(900,true),
    sa=a.sandbox.__burrowBossSignature(),sb=b.sandbox.__burrowBossSignature(),
    sr=rendered.sandbox.__burrowBossSignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${draws.calls} draw calls`);
  if(sa!==sb)fail('same seed diverged under identical fixed 60 Hz stepping');
  if(sa!==sr)fail('render traversal changed simulation state or RNG');
  if(!a.sandbox.__burrowBossProbe().finite||!rendered.sandbox.__burrowBossProbe().finite)fail('headless or rendered state became non-finite');
  if(draws.calls<100000||!draws.byMethod.fillRect||!draws.byMethod.beginPath)fail(`real renderer not exercised: ${JSON.stringify(draws.byMethod)}`);

  const mono=bootGame('burrow-boss',{seed:0xbb02,footer:FOOTER}),chunked=bootGame('burrow-boss',{seed:0xbb02,footer:FOOTER});
  mono.frames(3600,false);for(let i=0;i<360;i++)chunked.frames(10,false);
  const same=mono.sandbox.__burrowBossSignature()===chunked.sandbox.__burrowBossSignature();
  console.log(`  3,600 monolithic frames vs 360 x 10: ${same?'identical':'DIFFERENT'}`);
  if(!same)fail('headless batching changed the fixed-step result');
}

console.log('2) trap planner is pure, repeatable, geometrically legible, and engine-RNG isolated');
{
  const planned=bootGame('burrow-boss',{seed:0xbb10,footer:FOOTER}),
    control=bootGame('burrow-boss',{seed:0xbb10,footer:FOOTER}),
    f=planned.sandbox.__burrowBossPlannerFixture();
  const rp=planned.sandbox.__burrowBossNextRandom(),rc=control.sandbox.__burrowBossNextRandom();
  console.log(`  pure ${f.pure}; repeat ${f.repeat}; trap ${f.plan&&f.plan.trapId}; `+
    `runway ${f.plan&&f.plan.runway.toFixed(3)}; next RNG ${rp.toFixed(8)}/${rc.toFixed(8)}`);
  if(!f.pure||!f.repeat||!f.plan||f.candidates.length!==8||f.plan.points.length!==3||f.plan.runway<.55||!f.finite)
    fail(`planner fixture regressed: ${JSON.stringify(f)}`);
  if(rp!==rc)fail('trap planning consumed engine RNG for simulation-invisible work');
}

console.log('3) core hunt sequence: outline, brace, bait, lure, delayed physical cave-in, and apex');
{
  const game=bootGame('burrow-boss',{seed:0xbb20,footer:FOOTER}),q=game.sandbox.__bbTrapSequence();
  console.log(`  trap ${q.trapId}: ${q.points} outline points, armed ${q.arming}f, `+
    `${q.bait.tactic} -> ${q.commit.tactic}, fall ${q.fall}f, hit ${q.hit}, state ${q.state}`);
  if(!q.outlined||q.points!==3||!q.armed||q.arming!==72||!q.bait.taunt||q.lureStage!=='lure'||
    !q.commit.detonate||!q.planDuringFall||q.fall!==26||!q.impact||!q.hit||q.bossHp!==0||q.state!=='victory'||!q.finite)
    fail(`core trap sequence regressed: ${JSON.stringify(q)}`);
  for(const[k,v]of Object.entries(q.delta))if(v!==1)fail(`core sequence ${k} delta ${v}, expected 1`);
  game.frames(120,false);const show=game.sandbox.__burrowBossProbe().show,s3=show.shownByTier[3]||0;
  if(s3!==1||show.heldFrames!==6||show.slowedFrames!==24||show.admireFrames!==48)
    fail(`single apex did not drain exact 6/24/48 budgets: ${JSON.stringify(show)}`);
}

console.log('4) registered smart-policy calibration: ten independent ten-minute hunts');
const calibration=[],calibrationContinuity=[];
for(let i=0;i<10;i++){
  const seed=0xb100+i*211,game=bootGame('burrow-boss',{seed,footer:FOOTER});game.frames(36000,false);
  const p=game.sandbox.__burrowBossProbe();calibration.push(p);
  calibrationContinuity.push(game.sandbox.__bbContinuity);
  console.log(`  ${seed.toString(16)} ${p.persona.padEnd(8)}: ${p.stats.hits}/${p.stats.caveIns} hits, `+
    `${p.stats.bosses} bosses, ${p.stats.slips} slips, ${p.stats.downs} downs, `+
    `${p.stats.events}/${p.stats.progress} events/progress, lulls ${p.maxEventLull}/${p.maxProgressLull}f`);
  inBands(p,CAL_BANDS,`seed ${seed.toString(16)} ${p.persona}`);
  if(!p.finite||p.stats.invisibleResets!==0)fail(`seed ${seed.toString(16)}: non-finite state or invisible reset`);
  assertContinuity(game,`seed ${seed.toString(16)}`);
  if(p.stats.plans>p.stats.caveIns+3)fail(`seed ${seed.toString(16)}: ${p.stats.plans} plans for ${p.stats.caveIns} cave-ins; outline churn returned`);
  actPairs(p,'tremor',240,`seed ${seed.toString(16)}`,3);
  actPairs(p,'magma',210,`seed ${seed.toString(16)}`,3);
  let show=p.show,guard=0;
  while(show.active&&show.active.tier===3&&guard++<120){game.frames(1,false);show=game.sandbox.__burrowBossProbe().show;}
  assertShow(show,`seed ${seed.toString(16)}`,1);
}
{
  const fmt=key=>range(calibration,key).join('..'),d=Math.max(...calibrationContinuity.map(c=>c.diggerMax)),
    b=Math.max(...calibrationContinuity.map(c=>c.bossMax));
  console.log(`  observed plans ${fmt('plans')}, cave-ins ${fmt('caveIns')}, hits ${fmt('hits')}, slips ${fmt('slips')}, `+
    `bosses ${fmt('bosses')}, downs ${fmt('downs')}, panic drops ${fmt('panicDrops')}, `+
    `lulls ${fmt('maxEventLull')}/${fmt('maxProgressLull')}f; continuity ${d.toFixed(2)}/${b.toFixed(2)}px`);
}

console.log('5) baseline-first trap-plan A/B: eight paired five-minute hunts');
{
  const baseline=[],smart=[];let wins=0;
  for(let i=0;i<8;i++){
    const seed=0xb500+i*173,b=bootGame('burrow-boss',{seed,footer:FOOTER});
    b.sandbox.__NO_TRAP_PLAN=1;b.frames(18000,false);const pb=b.sandbox.__burrowBossProbe();baseline.push(pb);
    const a=bootGame('burrow-boss',{seed,footer:FOOTER});a.frames(18000,false);const pa=a.sandbox.__burrowBossProbe();smart.push(pa);
    if(trapScore(pa)>trapScore(pb))wins++;
    inBands(pb,POLICY_BANDS,`seed ${seed.toString(16)} reactive baseline`);
    inBands(pa,POLICY_BANDS,`seed ${seed.toString(16)} smart planner`);
    for(const[p,label]of[[pb,'baseline'],[pa,'smart']]){
      if(!p.finite||p.stats.invisibleResets!==0)fail(`seed ${seed.toString(16)} ${label}: non-finite state or invisible reset`);
      if(p.maxEventLull>1600||p.maxProgressLull>2600)fail(`seed ${seed.toString(16)} ${label}: viewer lull ${p.maxEventLull}/${p.maxProgressLull}f`);
    }
    console.log(`  ${seed.toString(16)} baseline ${pb.stats.hits} hits/${pb.stats.bosses} bosses/${pb.stats.slips} slips `+
      `-> smart ${pa.stats.hits}/${pa.stats.bosses}/${pa.stats.slips} (score ${trapScore(pb).toFixed(1)} -> ${trapScore(pa).toFixed(1)})`);
  }
  const bh=sum(baseline,'hits'),sh=sum(smart,'hits'),bb=sum(baseline,'bosses'),sb=sum(smart,'bosses'),
    bs=sum(baseline,'slips'),ss=sum(smart,'slips'),bScore=baseline.reduce((n,p)=>n+trapScore(p),0),
    sScore=smart.reduce((n,p)=>n+trapScore(p),0);
  console.log(`  ${wins}/8 payoff-score wins; hits ${sh}/${bh}, bosses ${sb}/${bb}, slips ${ss}/${bs}, score ${sScore.toFixed(1)}/${bScore.toFixed(1)}`);
  if(wins<6)fail(`smart trap plan won payoff score on only ${wins}/8 seeds`);
  if(sh<bh*4)fail(`smart hit gain ${sh}/${bh} below measured 4x floor`);
  if(sb<12||bb>1)fail(`boss defeats did not separate clearly: smart ${sb}, baseline ${bb}`);
  if(ss>bs*.72)fail(`smart slips ${ss} not at least 28% below baseline ${bs}`);
  if(sScore<700||sScore-bScore<1000)
    fail(`smart aggregate payoff ${sScore.toFixed(1)} did not clear baseline ${bScore.toFixed(1)} by the measured margin`);
}

console.log('6) acts: exact tremor/magma notes and physical plus intent divergence during warning');
for(const spec of[{id:'tremor',lead:240,tactic:'BRACE FOR THE TREMOR'},{id:'magma',lead:210,tactic:'CLIMB ABOVE THE MAGMA'}]){
  const seed=spec.id==='tremor'?0xbb30:0xbb31,
    a=bootGame('burrow-boss',{seed,footer:FOOTER}),b=bootGame('burrow-boss',{seed,footer:FOOTER});
  a.sandbox.__burrowBossActFixture(spec.id);b.sandbox.__burrowBossActFixture(spec.id);b.sandbox.__NO_ACTS=1;
  if(a.sandbox.__bbPhysical()!==b.sandbox.__bbPhysical())fail(`${spec.id}: fixture did not begin physically identical`);
  let firstIntent=-1,firstPhysical=-1,intentPhase='',physicalPhase='',tactic='';
  for(let f=1;f<=spec.lead+25;f++){
    a.frames(1,false);b.frames(1,false);
    if(firstIntent<0&&a.sandbox.__bbIntentMotion()!==b.sandbox.__bbIntentMotion()){
      firstIntent=f;const p=a.sandbox.__burrowBossProbe();intentPhase=p.act.phase;tactic=p.digger.tactic;}
    if(firstPhysical<0&&a.sandbox.__bbPhysical()!==b.sandbox.__bbPhysical()){
      firstPhysical=f;physicalPhase=a.sandbox.__burrowBossProbe().act.phase;}
  }
  const pa=a.sandbox.__burrowBossProbe(),pb=b.sandbox.__burrowBossProbe(),
    notes=pa.act.notes.filter(n=>n.id===spec.id),warn=notes.find(n=>n.kind==='act-warning'),land=notes.find(n=>n.kind==='act-land');
  console.log(`  ${spec.id}: intent ${firstIntent}f / physical ${firstPhysical}f in warning, ${warn&&land?land.tag-warn.tag:'?'}f lead (${tactic})`);
  if(!warn||!land||land.tag-warn.tag!==spec.lead||land.at-warn.at!==spec.lead||warn.landsAt!==land.at)
    fail(`${spec.id}: warning/land pair was not exactly ${spec.lead} frames`);
  if(firstIntent<0||firstIntent>=spec.lead||intentPhase!=='warn'||tactic!==spec.tactic)
    fail(`${spec.id}: intent did not visibly respond during warning (${firstIntent}/${intentPhase}/${tactic})`);
  if(firstPhysical<0||firstPhysical>=spec.lead||physicalPhase!=='warn')
    fail(`${spec.id}: body did not diverge during warning (${firstPhysical}/${physicalPhase})`);
  if(pb.act.notes.some(n=>n.id===spec.id))fail(`${spec.id}: __NO_ACTS emitted act notes`);
}

console.log('7) manual takeover: two-Enter gate, identical schema, and shared applyIntent path');
{
  const game=bootGame('burrow-boss',{seed:0xbb40,footer:FOOTER}),initial=game.sandbox.__burrowBossManual();
  press(game,'Enter');const instructions=game.sandbox.__burrowBossManual();press(game,'Enter');const started=game.sandbox.__burrowBossManual(),
    schemas=game.sandbox.__burrowBossIntentSchemas();
  if(initial.playing||instructions.playing||!started.playing)fail('manual session skipped the two-Enter instructions gate');
  if(schemas.humanKeys.join('|')!==schemas.botKeys.join('|'))fail(`human/bot intent schemas differ: ${JSON.stringify(schemas)}`);
  const sample=code=>{game.sandbox.__bbClearApplied();game.key('keydown',code);game.frames(2,false);game.key('keyup',code);return game.sandbox.__bbLastApplied();};
  const move=sample('ArrowRight'),set=sample('Space'),taunt=sample('KeyX'),drop=sample('KeyZ'),p=game.sandbox.__burrowBossProbe();
  console.log(`  playing ${initial.playing}->${instructions.playing}->${started.playing}; schema ${schemas.humanKeys.join(',')}; `+
    `move ${move&&move.dx}, set ${set&&set.set}, taunt ${taunt&&taunt.taunt}, drop ${drop&&drop.detonate}`);
  if(!move||move.dx!==1||move.tactic!=='MANUAL HUNT')fail('manual movement bypassed common applyIntent');
  if(!set||!set.set||set.tactic!=='MANUAL HUNT')fail('manual brace intent bypassed common applyIntent');
  if(!taunt||!taunt.taunt||taunt.tactic!=='MANUAL HUNT')fail('manual taunt bypassed common applyIntent');
  if(!drop||!drop.detonate||drop.tactic!=='MANUAL HUNT')fail('manual cave-in intent bypassed common applyIntent');
  if(p.stats.appliedIntents<8||!p.finite)fail(`manual common-path count/finite state regressed: ${p.stats.appliedIntents}/${p.finite}`);
}

console.log('8) shared ten-minute soak: moving, active, progressing, and exact payoff ladder');
{
  const{game,samples}=runSoak('burrow-boss',{seed:0xbc10,minutes:10,footer:FOOTER}),report=analyzeSoak(samples),p=game.sandbox.__burrowBossProbe();
  console.log(`  ${soakLine(report)}; ${p.stats.hits}/${p.stats.caveIns} hits, ${p.stats.bosses} bosses, tiers ${JSON.stringify(p.show.shownByTier)}`);
  assertSoak('burrow-boss soak',report,{still:4,quiet:8,stall:20,minEvents:570,minProgress:95},fail);
  inBands(p,CAL_BANDS,'ten-minute soak');
  assertContinuity(game,'ten-minute soak');
  let show=p.show,guard=0;while(show.active&&show.active.tier===3&&guard++<120){game.frames(1,false);show=game.sandbox.__burrowBossProbe().show;}
  assertShow(show,'ten-minute soak',1);
}

console.log('9) a real apex reaches production admire intents and __NO_ADMIRE gates them');
{
  const a=bootGame('burrow-boss',{seed:0xbb50,footer:FOOTER}),b=bootGame('burrow-boss',{seed:0xbb50,footer:FOOTER});
  b.sandbox.__NO_ADMIRE=1;const qa=a.sandbox.__bbTrapSequence(),qb=b.sandbox.__bbTrapSequence();
  a.sandbox.__bbClearApplied();b.sandbox.__bbClearApplied();a.frames(60,false);b.frames(60,false);
  const ta=a.sandbox.__bbAppliedTactics(),tb=b.sandbox.__bbAppliedTactics(),ac=ta.filter(x=>x==='ADMIRE THE CAVE-IN').length,
    bc=tb.filter(x=>x==='ADMIRE THE CAVE-IN').length,direct=a.sandbox.__burrowBossAdmireFixture();
  console.log(`  real apex applied ${ac} admire intents vs gated ${bc}; fallback ${tb.find(x=>x==='CIRCLE THE TROPHY')||'missing'}`);
  if(qa.delta.apexes!==1||qb.delta.apexes!==1||ac<5||bc!==0||!tb.includes('CIRCLE THE TROPHY'))
    fail(`production __NO_ADMIRE path regressed: ${JSON.stringify({qa,qb,ta,tb})}`);
  if(direct.admired!=='ADMIRE THE CAVE-IN'||direct.gated==='ADMIRE THE CAVE-IN')
    fail(`direct __NO_ADMIRE gate regressed: ${JSON.stringify(direct)}`);
}

console.log('10) payoff FX switch is a perfect same-seed simulation and engine-RNG no-op');
{
  const a=bootGame('burrow-boss',{seed:0xbb60,footer:FOOTER}),b=bootGame('burrow-boss',{seed:0xbb60,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;const qa=a.sandbox.__bbTrapSequence(),qb=b.sandbox.__bbTrapSequence();
  a.frames(120,false);b.frames(120,false);const same=a.sandbox.__burrowBossSignature()===b.sandbox.__burrowBossSignature(),
    ra=a.sandbox.__burrowBossNextRandom(),rb=b.sandbox.__burrowBossNextRandom();
  console.log(`  apex ${qa.delta.apexes}/${qb.delta.apexes}; signatures ${same?'identical':'DIFFERENT'}; next RNG ${ra.toFixed(8)}/${rb.toFixed(8)}`);
  if(qa.delta.apexes!==1||qb.delta.apexes!==1||!same)fail('__NO_PAYOFF_FX changed the guaranteed cave-in apex simulation');
  if(ra!==rb)fail('__NO_PAYOFF_FX changed the engine RNG stream');
}

console.log('11) skill-profile lapse ablation is deterministic, observable, and still active');
{
  const a=bootGame('burrow-boss',{seed:0xb44c,footer:FOOTER}),b=bootGame('burrow-boss',{seed:0xb44c,footer:FOOTER});
  b.sandbox.__NO_LAPSE=1;a.frames(12000,false);b.frames(12000,false);
  const pa=a.sandbox.__burrowBossProbe(),pb=b.sandbox.__burrowBossProbe(),different=a.sandbox.__burrowBossSignature()!==b.sandbox.__burrowBossSignature(),
    ca=a.sandbox.__bbRawCalls,cb=b.sandbox.__bbRawCalls,reaction=a.sandbox.__bbReactionFrames();
  console.log(`  profile ${pa.stats.lapses} lapses / ${pa.stats.caveIns} cave-ins / ${pa.stats.progress} progress; `+
    `ablated ${pb.stats.lapses} / ${pb.stats.caveIns} / ${pb.stats.progress}; raw decisions ${ca}/${cb}; signatures ${different?'diverge':'match'}`);
  if(pa.stats.lapses<1||pb.stats.lapses!==0||!different)fail(`__NO_LAPSE did not cleanly expose skill-profile imperfection: ${JSON.stringify({a:pa.stats.lapses,b:pb.stats.lapses,different})}`);
  if(reaction.skill.join('|')!=='2|4'||reaction.perfect.join('|')!=='2|4'||Math.abs(ca-cb)>Math.max(12,cb*.08))
    fail(`__NO_LAPSE changed reaction cadence instead of only lapse chance: ${JSON.stringify({reaction,ca,cb})}`);
  if(!pa.finite||!pb.finite||pa.stats.caveIns<8||pb.stats.caveIns<8||pa.stats.progress<15||pb.stats.progress<15)
    fail(`lapse A/B became inert or non-finite: ${JSON.stringify({a:pa.stats,b:pb.stats})}`);
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
