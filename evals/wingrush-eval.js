#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');

// Eval-only observation hooks. They never alter a decision, physics value, RNG
// stream, or draw path; fixtures below call the same game-owned functions that
// runtime play uses.
const FOOTER=String.raw`
globalThis.__wrApplied=[];
{const __wra0=advanceBody;advanceBody=function(r,intent,env,collide){
  const runtime=r===bird,out=__wra0(r,intent,env,collide);
  if(runtime){globalThis.__wrApplied.push({showFrame,runFrame,dive:!!intent.dive,trim:intent.trim,
    brace:!!intent.brace,targetId:intent.targetId,coreId:intent.coreId,tactic:intent.tactic});
    if(globalThis.__wrApplied.length>300)globalThis.__wrApplied.shift();}
  return out;
};}
globalThis.__wrClearApplied=()=>{globalThis.__wrApplied.length=0;};
globalThis.__wrLastApplied=()=>globalThis.__wrApplied.at(-1)||null;
globalThis.__wrPhysical=()=>[round(bird.x,7),round(bird.y,7),round(bird.vx,7),round(bird.vy,7),
  round(bird.speed,7),bird.grounded,round(bird.charge,7),round(bird.wing,7)].join('|');
globalThis.__wrContinuity={max:0,from:null,to:null};
{const __wru0=updateBird;updateBird=function(){const from={x:bird.x,y:bird.y},out=__wru0(),
  to={x:bird.x,y:bird.y},d=Math.hypot(to.x-from.x,to.y-from.y);
  if(d>globalThis.__wrContinuity.max)globalThis.__wrContinuity={max:d,from,to};return out;};}
globalThis.__wrTerrainContinuity=()=>{
  let exact=true,maxValueError=0,maxSeam=0,maxSlopeSeam=0;const boundaries=[];
  for(let i=0;i<=BIOMES.length*24;i++){
    const x=i*SEG,expected=boundaryY(i),actual=terrainY(x),eps=.001,
      seam=Math.abs(terrainY(x-eps)-terrainY(x+eps)),
      slopeSeam=Math.abs(terrainSlope(x-eps)-terrainSlope(x+eps));
    if(actual!==expected)exact=false;maxValueError=Math.max(maxValueError,Math.abs(actual-expected));
    maxSeam=Math.max(maxSeam,seam);maxSlopeSeam=Math.max(maxSlopeSeam,slopeSeam);
    boundaries.push({i,actual,expected,seam,slopeSeam});
  }
  return{exact,maxValueError,maxSeam,maxSlopeSeam,boundaries};
};
globalThis.__wrCoreDetail=kind=>{const q=globalThis.__wingrushCoreFixture(kind);
  return Object.assign({},q,{bird:{vx:bird.vx,vy:bird.vy,grounded:bird.grounded,wing:bird.wing,
    boostT:bird.boostT,combo:bird.combo},cores:stats.cores,boosts:stats.boosts});};
globalThis.__wrTowerFixture=()=>{
  primeAt(1100,4);const t=activeTower(),before=t.blocks.length,
    bases=t.blocks.filter(b=>b.supports.includes('ground'));
  for(const b of bases)breakBlock(t,b,4,0);unsupportedCascade(t);
  for(let i=0;i<900&&!t.toppled;i++)stepTowers();
  for(let i=0;i<900&&t.blocks.some(b=>b.broken&&!b.settled);i++)stepTowers();
  return{type:t.type,before,bases:bases.length,broken:t.blocks.filter(b=>b.broken).length,
    settled:t.blocks.filter(b=>b.settled).length,toppled:t.toppled,towersToppled:stats.towersToppled,
    blocksBroken:stats.blocksBroken,finite:finite()};
};
globalThis.__wrManualFlight=()=>{bird.grounded=false;bird.y=terrainY(bird.x)-52;bird.vx=2.7;bird.vy=-.35;
  bird.wing=.6;bird.lastX=bird.x;bird.lastY=bird.y;return globalThis.__wingrushManual();};
globalThis.__wrIntentSchemas=()=>{const h=humanIntent(),b=botIntent();return{human:h,bot:b,
  humanKeys:Object.keys(h).sort(),botKeys:Object.keys(b).sort()};};
globalThis.__wrAdmireFixture=()=>{const old=pres;
  pres={cue:{id:'fixture'},t:1,holdWorld:false,physicsEvery:1,admire:true};
  delete globalThis.__NO_ADMIRE;const admired=botIntent();globalThis.__NO_ADMIRE=1;
  const gated=botIntent();delete globalThis.__NO_ADMIRE;pres=old;return{admired,gated};};
`;

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const mean=a=>a.reduce((n,v)=>n+v,0)/a.length;
const sum=(a,key)=>a.reduce((n,p)=>n+p.stats[key],0);
const destructive=p=>p.stats.blocksBroken+10*p.stats.towersToppled+4*p.stats.cores;
const inBands=(p,bands,label)=>{for(const[k,[lo,hi]]of Object.entries(bands)){
  const v=k==='x'?p.bird.x:p.stats[k];
  if(v<lo||v>hi)fail(`${label}: ${k} ${v} outside measured band ${lo}..${hi}`);
}};
const notePairs=(p,id,label,minPairs)=>{
  const notes=p.act.notes.filter(n=>n.id===id),warn=notes.filter(n=>n.kind==='act-warning'),
    land=notes.filter(n=>n.kind==='act-land'),pending=warn.length===land.length+1&&p.act.phase==='warn'&&
      (!land.length||warn.at(-1).tag>land.at(-1).tag);
  if(land.length<minPairs||!(land.length===warn.length||pending))
    fail(`${label}: ${id} emitted ${warn.length} warnings / ${land.length} lands (need ${minPairs}+ pairs)`);
  for(let i=0;i<land.length;i++){
    if(land[i].tag-warn[i].tag!==240)fail(`${label}: ${id} pair ${i} run warning was ${land[i].tag-warn[i].tag}f, expected 240`);
    if(land[i].at-warn[i].at!==240)fail(`${label}: ${id} pair ${i} viewer warning was ${land[i].at-warn[i].at}f, expected 240`);
  }
  return land.length;
};

// Registered from the frozen game SHA-256 16aacc66... over the ten paired
// two-minute seeds 0x7700..0x7709. Combined observed extrema (lookahead and
// reactive): launches 17..66, high flights 9..14, impacts 6..17, blocks
// 0..25, towers 0..4, cores 0..7, misses 10..14, events 83..172, progress
// 41..61, x 24,755..30,166. These shared bands add margin on both sides so neither
// policy may win by becoming inert or absurdly perfect.
const POLICY_BANDS={
  launches:[12,75],landings:[12,75],highFlights:[6,20],perfectLandings:[1,52],
  roughLandings:[8,25],tumbles:[10,34],impacts:[4,24],blocksBroken:[0,34],
  towersToppled:[0,7],cores:[0,10],boosts:[0,8],rings:[0,12],misses:[7,18],
  lapses:[1,3],acts:[1,1],biomes:[1,1],events:[65,210],progress:[32,75],
  maxSpeed:[8.5,13],maxAir:[150,800],x:[22000,33500]
};

// Registered from frozen SHA-256 16aacc66... over two independent ten-minute
// autoplay soaks (0x7810/0x7811). Observed: launches 127..206, high flights
// 51..61, towers 8..11, cores 14..16, misses 61..62, events 491..616,
// progress 256..280, max air 772..856. The bounds retain deliberate failures
// and broad mechanical room.
const SOAK_BANDS={
  launches:[100,250],landings:[100,250],highFlights:[40,80],perfectLandings:[35,150],
  roughLandings:[50,95],tumbles:[80,135],impacts:[50,90],blocksBroken:[40,75],
  towersToppled:[6,15],cores:[10,22],boosts:[7,18],rings:[5,38],misses:[52,72],
  lapses:[7,9],acts:[4,5],biomes:[3,4],events:[400,750],progress:[225,315],
  maxSpeed:[10,12.5],maxAir:[650,950],x:[120000,160000]
};

console.log('1) deterministic fixed-step replay, render parity, and finite renderer');
{
  const a=bootGame('wingrush',{seed:0x7601,footer:FOOTER}),
    b=bootGame('wingrush',{seed:0x7601,footer:FOOTER}),
    rendered=bootGame('wingrush',{seed:0x7601,footer:FOOTER});
  a.frames(3600,false);b.frames(3600,false);const draws=rendered.frames(3600,true);
  const sa=a.sandbox.__wingrushSignature(),sb=b.sandbox.__wingrushSignature(),sr=rendered.sandbox.__wingrushSignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${draws.calls} draw calls`);
  if(sa!==sb)fail('same seed diverged under identical fixed 60 Hz stepping');
  if(sa!==sr)fail('render traversal changed simulation state or RNG');
  if(!a.sandbox.__wingrushProbe().finite||!rendered.sandbox.__wingrushProbe().finite)fail('headless or rendered replay ended non-finite');
  if(draws.calls<1000||!draws.byMethod.fillRect||!draws.byMethod.beginPath)fail(`real render path was not exercised: ${JSON.stringify(draws.byMethod)}`);

  const mono=bootGame('wingrush',{seed:0x7602,footer:FOOTER}),chunked=bootGame('wingrush',{seed:0x7602,footer:FOOTER});
  mono.frames(1800,false);for(let i=0;i<180;i++)chunked.frames(10,false);
  const same=mono.sandbox.__wingrushSignature()===chunked.sandbox.__wingrushSignature();
  console.log(`  1,800 monolithic frames vs 180 x 10: ${same?'identical':'DIFFERENT'}`);
  if(!same)fail('headless batching changed the fixed-step result');
}

console.log('2) authored terrain: exact seams, five biomes, and distinct hill families');
{
  const game=bootGame('wingrush',{seed:0x7603,footer:FOOTER}),c=game.sandbox.__wrTerrainContinuity(),
    terrain=game.sandbox.__wingrushTerrainFixture(),union=new Set(terrain.flatMap(q=>q.families)),
    signatures=new Set(terrain.map(q=>q.families.slice().sort().join('|')));
  console.log(`  ${c.boundaries.length} exact segment boundaries; seam ${c.maxSeam.toExponential(2)}; `+
    `${terrain.length} biomes / ${union.size} hill families / ${signatures.size} family palettes`);
  console.log('  '+terrain.map(q=>`${q.biome}: ${q.families.join(', ')} (${q.range.toFixed(1)}px)`).join('; '));
  if(!c.exact||c.maxValueError!==0)fail(`terrain did not hit shared boundary values exactly (max ${c.maxValueError})`);
  if(c.maxSeam>.01||c.maxSlopeSeam>.01)fail(`terrain seam discontinuity ${c.maxSeam}/${c.maxSlopeSeam}`);
  if(terrain.length!==5||terrain.some(q=>q.families.length<2||q.range<70))fail('a biome lacks measured hill-shape or relief variety');
  if(union.size<8||signatures.size<4)fail(`only ${union.size} hill families / ${signatures.size} distinct biome palettes`);
}

console.log('3) Tiny-Wings momentum: dive the valley, bank speed, release, and truly fly');
{
  const game=bootGame('wingrush',{seed:0x7715,footer:FOOTER}),m=game.sandbox.__wingrushMomentumFixture();
  console.log(`  bank ${m.dive.bank.toFixed(2)} vs ${m.coast.bank.toFixed(2)}; charge ${m.dive.charge.toFixed(2)} vs ${m.coast.charge.toFixed(2)}; `+
    `flight ${m.dive.flightDistance.toFixed(0)}px / ${m.dive.apexRise.toFixed(0)}px rise / ${m.dive.airFrames}f`);
  if(!m.finite)fail('momentum fixture became non-finite');
  if(m.dive.bank<m.coast.bank+.4||m.dive.charge<m.coast.charge+.4)fail(`diving did not bank a clear speed/charge advantage: ${JSON.stringify(m.advantage)}`);
  if(Math.abs(m.dive.launchX-m.dive.releaseX)>12)fail(`bird did not release at the chosen exit crest (${m.dive.launchX}/${m.dive.releaseX})`);
  if(m.dive.flightDistance<400||m.dive.apexRise<90||m.dive.airFrames<135)
    fail(`crest release did not produce a major flight: ${JSON.stringify(m.dive)}`);
  if(m.advantage.distance<300||m.advantage.airFrames<100)fail(`dive/release payoff was not materially larger than coasting: ${JSON.stringify(m.advantage)}`);
}

console.log('4) lookahead purity and all four power cores plus physical tower collapse');
{
  const game=bootGame('wingrush',{seed:0x7620,footer:FOOTER});game.sandbox.__wingrushSetVisualBeat('momentum');
  const f=game.sandbox.__wingrushLookaheadFixture(),
    control=bootGame('wingrush',{seed:0x7621,footer:FOOTER}),planned=bootGame('wingrush',{seed:0x7621,footer:FOOTER});
  control.sandbox.__wingrushSetVisualBeat('momentum');planned.sandbox.__wingrushSetVisualBeat('momentum');
  planned.sandbox.__wingrushLookaheadFixture();const rp=planned.sandbox.__wingrushNextRandom(),rc=control.sandbox.__wingrushNextRandom();
  console.log(`  planner pure ${f.pure}; repeat ${f.repeat}; miss ${f.plan&&f.plan.min.toFixed(2)}px; next RNG ${rp.toFixed(8)}/${rc.toFixed(8)}`);
  if(!f.pure||!f.repeat||!f.plan||!Number.isFinite(f.plan.min)||f.plan.min>80||f.plan.air<1||!f.finite)
    fail(`lookahead fixture regressed: ${JSON.stringify(f)}`);
  if(rp!==rc)fail('lookahead consumed engine RNG for simulation-invisible work');

  const cores={};for(const kind of['gust','spring','blast','star']){
    const g=bootGame('wingrush',{seed:0x7630,footer:FOOTER});cores[kind]=g.sandbox.__wrCoreDetail(kind);
    console.log(`  ${kind}: speed ${cores[kind].before.toFixed(2)} -> ${cores[kind].after.toFixed(2)}, `+
      `${cores[kind].blocks} blocks, boost ${cores[kind].bird.boostT}`);
    if(cores[kind].missing||cores[kind].kind!==kind||!cores[kind].triggered||cores[kind].cores!==1||!cores[kind].finite)
      fail(`${kind} core fixture missed its actual runtime core: ${JSON.stringify(cores[kind])}`);
  }
  if(cores.gust.bird.vx<5.2||cores.gust.bird.boostT<240||cores.gust.boosts!==1)fail('gust core did not deliver its long forward booster');
  if(cores.spring.bird.grounded||cores.spring.bird.vy> -3.2||cores.spring.bird.wing!==1||cores.spring.bird.boostT<300||cores.spring.boosts!==1)
    fail('spring core did not produce the high-flight launch booster');
  if(cores.star.bird.vx<4.75||cores.star.bird.combo<3||cores.star.bird.boostT<480||cores.star.boosts!==1)
    fail('star cage did not produce its momentum/combo power-up');
  if(cores.blast.blocks<5||cores.blast.boosts!==0)fail('blast heart did not physically destroy the tower around it');

  const tower=bootGame('wingrush',{seed:0x7640,footer:FOOTER}).sandbox.__wrTowerFixture();
  console.log(`  crown keep: ${tower.bases} foundations -> ${tower.broken}/${tower.before} broken, ${tower.settled} settled, toppled ${tower.toppled}`);
  if(tower.type!==4||tower.bases<3||tower.broken!==tower.before||tower.settled!==tower.before||!tower.toppled||
    tower.towersToppled!==1||tower.blocksBroken!==tower.before||!tower.finite)fail(`tower collapse fixture regressed: ${JSON.stringify(tower)}`);
}

console.log('5) lookahead A/B: ten paired two-minute seeds against reactive release');
{
  const smart=[],reactive=[];let wins=0;
  for(let i=0;i<10;i++){
    const seed=0x7700+i,a=bootGame('wingrush',{seed,footer:FOOTER}),b=bootGame('wingrush',{seed,footer:FOOTER});
    b.sandbox.__NO_LOOKAHEAD=1;a.frames(7200,false);b.frames(7200,false);
    const pa=a.sandbox.__wingrushProbe(),pb=b.sandbox.__wingrushProbe();smart.push(pa);reactive.push(pb);
    if(destructive(pa)>destructive(pb))wins++;
    for(const[p,label]of[[pa,'lookahead'],[pb,'reactive']]){
      inBands(p,POLICY_BANDS,`seed ${seed.toString(16)} ${label}`);
      if(!p.finite||p.stats.invisibleResets!==0)fail(`seed ${seed.toString(16)} ${label}: non-finite state or invisible reset`);
      if(p.stats.maxEventLull>720||p.stats.maxProgressLull>700)fail(`seed ${seed.toString(16)} ${label}: viewer lull ${p.stats.maxEventLull}/${p.stats.maxProgressLull}f`);
    }
    console.log(`  ${seed.toString(16)} ${pa.persona.padEnd(11)} planned ${pa.stats.blocksBroken} blocks/${pa.stats.towersToppled} towers/${pa.stats.cores} cores `+
      `vs reactive ${pb.stats.blocksBroken}/${pb.stats.towersToppled}/${pb.stats.cores}`);
  }
  const blocks=[sum(smart,'blocksBroken'),sum(reactive,'blocksBroken')],towers=[sum(smart,'towersToppled'),sum(reactive,'towersToppled')],
    cores=[sum(smart,'cores'),sum(reactive,'cores')],score=[smart.reduce((n,p)=>n+destructive(p),0),reactive.reduce((n,p)=>n+destructive(p),0)];
  console.log(`  ${wins}/10 destructive-score wins; blocks ${blocks[0]}/${blocks[1]}, towers ${towers[0]}/${towers[1]}, `+
    `cores ${cores[0]}/${cores[1]}, aggregate ${score[0]}/${score[1]}`);
  if(wins<6)fail(`lookahead won destructive payoff on only ${wins}/10 seeds`);
  if(blocks[0]<blocks[1]*1.45||towers[0]<towers[1]*1.45||cores[0]<cores[1]*1.45||score[0]<score[1]*1.5)
    fail(`lookahead aggregate win was not clear: ${JSON.stringify({blocks,towers,cores,score})}`);
}

console.log('6) environmental acts: exact notes and first divergence during the warning');
for(const type of['gust','rain']){
  const seed=type==='gust'?0x7750:0x7751,a=bootGame('wingrush',{seed,footer:FOOTER}),b=bootGame('wingrush',{seed,footer:FOOTER});
  a.sandbox.__wingrushSetVisualBeat('major-flight');b.sandbox.__wingrushSetVisualBeat('major-flight');
  a.sandbox.__wingrushActFixture(type);b.sandbox.__wingrushActFixture(type);b.sandbox.__NO_ACTS=1;
  if(a.sandbox.__wrPhysical()!==b.sandbox.__wrPhysical())fail(`${type}: paired fixture did not begin physically identical`);
  let first=-1,phase='',tactic='';
  for(let f=1;f<=270;f++){
    a.frames(1,false);b.frames(1,false);
    if(first<0&&a.sandbox.__wrPhysical()!==b.sandbox.__wrPhysical()){
      first=f;const p=a.sandbox.__wingrushProbe();phase=p.act.phase;tactic=p.bird.tactic;
    }
  }
  const pa=a.sandbox.__wingrushProbe(),pb=b.sandbox.__wingrushProbe(),notes=pa.act.notes.filter(n=>n.id===type),
    warn=notes.find(n=>n.kind==='act-warning'),land=notes.find(n=>n.kind==='act-land');
  console.log(`  ${type}: first body divergence ${first}f in ${phase} (${tactic}); warning ${warn&&land?land.tag-warn.tag:'?'}f`);
  if(!warn||!land||land.tag-warn.tag!==240||land.at-warn.at!==240)fail(`${type}: warning/land pair was not exactly 240 frames`);
  if(first<0||first>=240||phase!=='warn')fail(`${type}: act did not visibly change the bot before landing`);
  if(pb.act.notes.length)fail(`${type}: __NO_ACTS still emitted act notes`);
}

console.log('7) manual takeover uses the same intent schema and physics path');
{
  const game=bootGame('wingrush',{seed:0x7760,footer:FOOTER}),initial=game.sandbox.__wingrushManual();
  press(game,'Enter');const instructions=game.sandbox.__wingrushManual();press(game,'Enter');const started=game.sandbox.__wingrushManual();
  const schemas=game.sandbox.__wrIntentSchemas();game.sandbox.__wrClearApplied();
  game.key('keydown','ArrowDown');game.frames(5,false);game.key('keyup','ArrowDown');const dive=game.sandbox.__wrLastApplied();
  game.sandbox.__wrManualFlight();game.sandbox.__wrClearApplied();
  game.key('keydown','ArrowRight');game.frames(4,false);game.key('keyup','ArrowRight');const trim=game.sandbox.__wrLastApplied();
  game.sandbox.__wrClearApplied();game.key('keydown','KeyX');game.frames(2,false);game.key('keyup','KeyX');const brace=game.sandbox.__wrLastApplied();
  const p=game.sandbox.__wingrushProbe();
  console.log(`  playing ${initial.playing}->${instructions.playing}->${started.playing}; `+
    `schema ${schemas.humanKeys.join(',')}; dive ${dive&&dive.dive}, trim ${trim&&trim.trim}, brace ${brace&&brace.brace}`);
  if(initial.playing||instructions.playing||!started.playing)fail('manual session skipped the two-Enter gate');
  if(schemas.humanKeys.join('|')!==schemas.botKeys.join('|'))fail(`human/bot intent schemas differ: ${JSON.stringify(schemas)}`);
  if(!dive||!dive.dive||dive.tactic!=='MANUAL FLIGHT')fail('manual dive did not traverse runtime advanceBody');
  if(!trim||trim.trim!==1||trim.tactic!=='MANUAL FLIGHT')fail('manual flight trim did not traverse runtime advanceBody');
  if(!brace||!brace.brace||brace.tactic!=='MANUAL FLIGHT')fail('manual brace did not traverse runtime advanceBody');
  if(!p.finite)fail('manual control produced non-finite state');
}

console.log('8) two ten-minute soaks: moving, active, progressing, honest, and cinematic');
for(const seed of[0x7810,0x7811]){
  const{game,samples}=runSoak('wingrush',{seed,minutes:10,footer:FOOTER}),report=analyzeSoak(samples),p=game.sandbox.__wingrushProbe(),
    show=p.show,o=show.offeredByTier,s=show.shownByTier,s3=s[3]||0,continuity=game.sandbox.__wrContinuity;
  console.log(`  ${seed.toString(16)} ${soakLine(report)}; ${p.stats.towersToppled} towers/${p.stats.cores} cores, `+
    `${p.stats.highFlights} great flights, tiers ${JSON.stringify(s)}`);
  assertSoak(seed.toString(16),report,{still:2,quiet:12,stall:12,minEvents:400,minProgress:225},fail);
  inBands(p,SOAK_BANDS,`seed ${seed.toString(16)} soak`);
  if(!p.finite||p.stats.invisibleResets!==0)fail(`seed ${seed.toString(16)}: non-finite state or ${p.stats.invisibleResets} invisible resets`);
  if(continuity.max>15)fail(`seed ${seed.toString(16)}: unaccounted ${continuity.max.toFixed(2)}px one-step position discontinuity`);
  if(p.stats.maxEventLull>750||p.stats.maxProgressLull>750)fail(`seed ${seed.toString(16)}: viewer lull ${p.stats.maxEventLull}/${p.stats.maxProgressLull}f`);
  notePairs(p,'gust',`seed ${seed.toString(16)}`,2);notePairs(p,'rain',`seed ${seed.toString(16)}`,2);
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=4))fail(`seed ${seed.toString(16)}: offered tiers not strictly ordered ${JSON.stringify(o)}`);
  if(!((s[1]||0)>(s[2]||0)&&(s[2]||0)>(s[3]||0)&&(s[3]||0)>=4))fail(`seed ${seed.toString(16)}: shown tiers not strictly ordered ${JSON.stringify(s)}`);
  if(show.heldFrames!==6*s3)fail(`seed ${seed.toString(16)}: apex hold ${show.heldFrames} != 6*${s3}`);
  if(show.slowedFrames!==24*s3)fail(`seed ${seed.toString(16)}: apex slow ${show.slowedFrames} != 24*${s3}`);
  if(show.admireFrames!==48*s3)fail(`seed ${seed.toString(16)}: apex admire ${show.admireFrames} != 48*${s3}`);
}
{
  const game=bootGame('wingrush',{seed:0x7812,footer:FOOTER}),a=game.sandbox.__wrAdmireFixture();
  if(a.admired.tactic!=='ADMIRE THE FALL'||a.gated.tactic==='ADMIRE THE FALL')fail(`__NO_ADMIRE did not gate bot-only pause: ${JSON.stringify(a)}`);
}

console.log('9) payoff FX switch is a perfect same-seed simulation no-op');
{
  const a=bootGame('wingrush',{seed:0x7820,footer:FOOTER}),b=bootGame('wingrush',{seed:0x7820,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;a.frames(3600,false);b.frames(3600,false);
  const same=a.sandbox.__wingrushSignature()===b.sandbox.__wingrushSignature(),events=a.sandbox.__wingrushProbe().stats.events;
  console.log(`  signatures ${same?'identical':'DIFFERENT'} through ${events} visible events`);
  if(!same)fail('__NO_PAYOFF_FX changed simulation state');
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
