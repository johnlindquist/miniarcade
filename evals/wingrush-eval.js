#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
const{runFeedbackVisibility,assertFeedback,feedbackLine}=require('./feedback');

// Eval-only observation and fixture hooks. Natural-play sections do not alter
// decisions, physics, RNG, or draw traversal. Isolated fixtures call the same
// game-owned terrain, planning, body, core, and collapse functions as runtime.
const FOOTER=String.raw`
globalThis.__wrApplied=[];
{const base=advanceBody;advanceBody=function(r,intent,env,collide){
  const runtime=r===bird,beforeEnergy=r.energy,out=base(r,intent,env,collide);
  if(runtime){globalThis.__wrApplied.push({showFrame,runFrame,dive:!!intent.dive,
    vertical:intent.vertical||0,brace:!!intent.brace,targetId:intent.targetId,
    coreId:intent.coreId,tactic:intent.tactic,beforeEnergy,afterEnergy:r.energy});
    if(globalThis.__wrApplied.length>360)globalThis.__wrApplied.shift();}
  return out;
};}
globalThis.__wrClearApplied=()=>{globalThis.__wrApplied.length=0;};
globalThis.__wrLastApplied=()=>globalThis.__wrApplied.at(-1)||null;
globalThis.__wrPhysical=()=>[bird.x,bird.y,bird.vx,bird.vy,bird.speed,bird.grounded,
  bird.charge,bird.energy,bird.ram,bird.wing,bird.hitT,bird.tumbleT,bird.boostT]
  .map(v=>typeof v==='number'?round(v,7):v).join('|');
globalThis.__wrFullSignature=()=>JSON.stringify({
  state,runFrame,showFrame,worldSeed,chapter,persona:persona.name,lockedTarget,
  bird:[bird.x,bird.y,bird.vx,bird.vy,bird.speed,bird.grounded,bird.charge,bird.energy,
    bird.ram,bird.wing,bird.hitT,bird.tumbleT,bird.boostT,bird.combo,bird.pose,bird.flightMode,bird.landedAtX,bird.guidanceAttempted]
    .map(v=>typeof v==='number'?round(v,5):v),
  plan:plan&&[plan.targetId,plan.coreId,plan.releaseX,plan.bias,plan.gain,plan.min,plan.score]
    .map(v=>typeof v==='number'?round(v,5):v),
  landing:landingPlan&&[landingPlan.x,landingPlan.y,landingPlan.slope,landingPlan.aimX,landingPlan.aimY,landingPlan.predictedX,
    landingPlan.hard,landingPlan.frames,landingPlan.error,landingPlan.madeAt].map(v=>round(v,5)),
  towers:towers.map(t=>[t.id,t.toppled,t.resolved,t.hit,t.lockAt,
    ...t.cores.flatMap(c=>[c.id,c.kind,c.triggered,c.flash]),
    ...t.blocks.flatMap(b=>[b.id,b.broken,b.falling,b.settled,round(b.hp,4),round(b.x,3),round(b.y,3),round(b.vx,3),round(b.vy,3),round(b.rot,3)])]),
  rings:airRings.map(r=>[r.id,r.taken]),coins:groundCoins.map(c=>[c.id,c.taken]),
  scarf:typeof scarf==='object'&&scarf&&scarf.nodes?scarf.nodes.flatMap(n=>[round(n.x,4),round(n.y,4),round(n.px,4),round(n.py,4)]):null,
  act:[act.phase,act.type,act.warnAt,act.landAt,act.endAt,act.index,act.dir],
  stats:Object.keys(stats).sort().map(k=>[k,typeof stats[k]==='number'?round(stats[k],7):stats[k]])
});
globalThis.__wrContinuity={max:0,from:null,to:null};
{const base=updateBird;updateBird=function(){const from={x:bird.x,y:bird.y},out=base(),
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
globalThis.__wrEnergyFixture=()=>{
  let start=80,valley=-1,release=-1,phase='crest';
  for(let x=80,prev=terrainSlope(80);x<SEG*3;x+=2){const s=terrainSlope(x);
    if(phase==='crest'&&prev<0&&s>=0){start=x+8;phase='valley';}
    else if(phase==='valley'&&prev>0&&s<=0){valley=x;phase='exit';}
    else if(phase==='exit'&&prev<0&&s>=0){release=x-12;break;}prev=s;}
  if(valley<0||release<0){start=100;valley=260;release=410;}
  const launch=useDive=>{const r=makeBird(start);r.speed=1.35;
    for(let f=0;f<720;f++){const ev=advanceBody(r,{dive:useDive&&r.grounded&&r.x<release,
      vertical:0,brace:false},{wind:0,lift:0,slick:0},true);if(ev.launched)return Object.assign({},r);}
    return Object.assign({},r);};
  const powered=launch(true),coast=launch(false);
  const sim=(vertical,energy)=>{const r=Object.assign({},powered,{energy}),y0=r.y;let minY=r.y,spent=0;
    for(let f=0;f<120;f++){const ev=advanceBody(r,{dive:vertical>.3,vertical,brace:false},
      {wind:0,lift:0,slick:0},false);spent+=ev.energySpent||0;minY=Math.min(minY,r.y);}
    return{dy:r.y-y0,rise:y0-minY,energy:r.energy,spent,vx:r.vx,vy:r.vy,frames:120};};
  return{start,valley,release,earned:{dive:powered.energy,coast:coast.energy,
      diveRam:powered.ram,coastRam:coast.ram},
    climb:sim(-1,powered.energy),neutral:sim(0,powered.energy),descend:sim(1,powered.energy),
    emptyClimb:sim(-1,0),finite:[powered,coast].every(r=>
      [r.x,r.y,r.vx,r.vy,r.energy,r.ram].every(Number.isFinite))};
};
globalThis.__wrPolicyPhysicsParity=()=>{
  const had=Object.prototype.hasOwnProperty.call(globalThis,'__NO_LOOKAHEAD'),prior=globalThis.__NO_LOOKAHEAD;
  const simulate=(x,disabled)=>{
    if(disabled)globalThis.__NO_LOOKAHEAD=1;else delete globalThis.__NO_LOOKAHEAD;
    const r=makeBird(x);Object.assign(r,{speed:3.2,charge:1.4,landedAtX:x-200});
    const events=[];for(let f=0;f<60;f++){const out=advanceBody(r,{dive:false,vertical:-.4,brace:false},
      {wind:0,lift:0,slick:0},true);if(out.launched||out.landed)events.push([f,out.launched,out.landed,round(out.hard,7),out.kiss]);}
    return{events,state:[r.x,r.y,r.vx,r.vy,r.speed,r.grounded,r.charge,r.energy,r.ram,r.wing,r.landedAtX]
      .map(v=>typeof v==='number'?round(v,7):v)};
  };
  let sample=null;for(let x=80;x<SEG*3;x+=2){if(terrainSlope(x)>=-.16)continue;
    const planned=simulate(x,false);if(!planned.events.some(e=>e[1]))continue;
    const reactive=simulate(x,true);sample={x,planned,reactive,same:JSON.stringify(planned)===JSON.stringify(reactive)};break;}
  if(had)globalThis.__NO_LOOKAHEAD=prior;else delete globalThis.__NO_LOOKAHEAD;
  return sample||{missing:true,same:false};
};
globalThis.__wrPlannerFixture=()=>{const t=activeTower();if(!t)return{missing:true};
  bird.x=t.x-400;bird.y=terrainY(bird.x)-RADIUS;Object.assign(bird,{grounded:true,
    speed:3.2,vx:3.2,vy:0,charge:1.4,energy:0,ram:3.2});
  const before=globalThis.__wrFullSignature(),a=buildPlan(t),mid=globalThis.__wrFullSignature(),
    b=buildPlan(t),after=globalThis.__wrFullSignature();
  return{pure:before===mid&&mid===after,repeat:JSON.stringify(a)===JSON.stringify(b),plan:a,finite:finite()};};
function __wrPrimeSky(type){
  towers=[];airRings=[];groundCoins=[];towerSerial=0;coinSerial=0;
  const t=makeTower(0,type);towers=[t];towerSerial=1;bird=makeBird(t.x-120);
  const c=t.cores[0],p=corePos(t,c);Object.assign(bird,{x:p.x-8,y:p.y,vx:4,vy:0,
    grounded:false,energy:.45,ram:4,lastX:p.x-16,lastY:p.y});
  bird.intent={dive:false,vertical:0,brace:true,targetId:t.id,coreId:c.id,tactic:'FIXTURE STRIKE'};
  t.lockAt=showFrame-300;lockedTarget=t.id;stats.targets=1;return t;
}
globalThis.__wrSkyCatalog=()=>[0,1,2,3,4].map(type=>{const t=makeTower(20+type,type);
  return{type,altitude:t.ground-t.base,coreAltitudes:t.cores.map(c=>t.ground-corePos(t,c).y),
    blockClearance:Math.min(...t.blocks.map(b=>t.ground-(b.y+b.h/2))),blocks:t.blocks.length,cores:t.cores.length};});
globalThis.__wrSkyCoreFixture=kind=>{const type={gust:0,blast:1,spring:2,star:4}[kind],
  t=__wrPrimeSky(type),c=t.cores.find(v=>v.kind===kind),before={vx:bird.vx,vy:bird.vy,
    energy:bird.energy,ram:bird.ram,impacts:stats.impacts};if(!c)return{kind,missing:true};
  const p=corePos(t,c);Object.assign(bird,{x:p.x-8,y:p.y,vx:4,vy:0,lastX:p.x-16,lastY:p.y});bird.intent.coreId=c.id;collideStructures();
  return{kind:c.kind,before,after:{vx:bird.vx,vy:bird.vy,energy:bird.energy,ram:bird.ram,
      grounded:bird.grounded,boostT:bird.boostT,combo:bird.combo},altitude:t.ground-t.base,
    blocks:t.blocks.filter(b=>b.broken).length,targetHits:stats.targetHits,cores:stats.cores,impacts:stats.impacts-before.impacts,
    boosts:stats.boosts,finite:finite()};};
globalThis.__wrSkyCollapseFixture=()=>{const t=__wrPrimeSky(4),before=t.blocks.length,
  bases=t.blocks.filter(b=>b.supports.includes('ground'));for(const b of bases)breakBlock(t,b,4,0);
  unsupportedCascade(t);for(let f=0;f<1800&&(!t.toppled||t.blocks.some(b=>b.broken&&!b.settled));f++)stepTowers();
  return{type:t.type,altitude:t.ground-t.base,before,bases:bases.length,
    broken:t.blocks.filter(b=>b.broken).length,settled:t.blocks.filter(b=>b.settled).length,
    toppled:t.toppled,towersToppled:stats.towersToppled,blocksBroken:stats.blocksBroken,finite:finite()};};
globalThis.__wrManualFlight=()=>{bird.grounded=false;bird.y=terrainY(bird.x)-72;bird.vx=3;
  bird.vy=-.35;bird.energy=.72;bird.ram=3.8;bird.wing=.7;bird.lastX=bird.x;bird.lastY=bird.y;
  return globalThis.__wingrushManual();};
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
const sum=(a,key)=>a.reduce((n,p)=>n+p.stats[key],0);
const round=(v,n=3)=>Math.round(v*10**n)/10**n;
const ratio=(n,d)=>d?n/d:0;
const targetMetrics=p=>({
  targets:p.stats.targets,hits:p.stats.targetHits,hitRatio:ratio(p.stats.targetHits,p.stats.targets),
  first:p.stats.firstTargetHit,minLead:p.stats.targetHits?p.stats.minTargetLead:0,
  avgLead:p.stats.targetHits?p.stats.targetLeadTotal/p.stats.targetHits:0,
  coins:p.stats.coins,air:p.stats.airControlFrames,landings:p.stats.landings,
  launches:p.stats.launches,x:p.bird.x,guidedAttempts:p.stats.guidedAttempts,
  guidedRatio:ratio(p.stats.guidedLandings,p.stats.guidedAttempts),roughRatio:ratio(p.stats.roughLandings,p.stats.landings),
  micro:p.stats.microHops,lapses:p.stats.lapses
});
const metricLine=p=>{const m=targetMetrics(p);return`${m.hits}/${m.targets} targets (${(m.hitRatio*100).toFixed(0)}%), `+
  `first ${m.first}f, lead ${m.minLead}/${m.avgLead.toFixed(0)}f, ${m.coins} coins, `+
  `${m.air} air, ${m.landings} landings, ${(m.guidedRatio*100).toFixed(0)}% guided, ${(m.roughRatio*100).toFixed(0)}% rough, ${m.micro} micro`;};
const inRange=(value,[lo,hi],label)=>{if(value<lo||value>hi)fail(`${label} ${round(value)} outside measured band ${lo}..${hi}`);};
const notePairs=(p,id,label,minPairs)=>{
  const notes=p.act.notes.filter(n=>n.id===id),warn=notes.filter(n=>n.kind==='act-warning'),
    land=notes.filter(n=>n.kind==='act-land'),pending=warn.length===land.length+1&&p.act.phase==='warn'&&
      (!land.length||warn.at(-1).tag>land.at(-1).tag);
  if(land.length<minPairs||!(land.length===warn.length||pending))
    fail(`${label}: ${id} emitted ${warn.length} warnings / ${land.length} lands (need ${minPairs}+ pairs)`);
  for(let i=0;i<land.length;i++){
    if(land[i].tag-warn[i].tag!==240)fail(`${label}: ${id} warning ${i} lasted ${land[i].tag-warn[i].tag} run frames`);
    if(land[i].at-warn[i].at!==240)fail(`${label}: ${id} warning ${i} lasted ${land[i].at-warn[i].at} viewer frames`);
  }
};

// Registered after the operational landing/scale pass over natural 60-second
// seeds 0x7900..09. Observed: 7..10 direct hits, .778..909 hit ratio, first hit
// 225..408f, 164..230 coins, 1,372..1,871 controlled-air frames, 8..10 landings,
// .778..1 completed-guidance ratio, 0..50% per-seed rough ratio (25.3% aggregate),
// and no micro-flights. The corrected guidance denominator is actual attempts,
// while aggregate completion and roughness stay under strict paired gates below.
const NATURAL={targets:[7,12],hits:[6,11],hitRatio:[.70,.93],first:[180,520],
  minLead:[180,400],avgLead:[280,450],coins:[145,250],air:[1250,2000],
  landings:[7,11],launches:[7,11],x:[6500,11500],guidedAttempts:[7,12],guidedRatio:[.75,1],roughRatio:[0,.55],micro:[0,1]};

// Final planner sweep 0x7700..09 observed 16..20 targets, 11..18 direct hits,
// .69..95 hit ratio, 292..400 coins, 3,095..3,922 air frames, and x 18k..20.4k.
// With identical launch physics, the reactive ablation remains active while the
// planner's current registered sweep retains an 8/10 win and clear aggregate gain.
// The honest reactive policy travels 18,007..21,586px, strikes 9..15 targets,
// and makes 0..5 short target-miss flights; the shipping planner remains at 0..1.
const POLICY={targets:[15,21],hits:[10,19],hitRatio:[.60,.98],first:[180,900],
  minLead:[180,650],avgLead:[280,700],coins:[270,430],air:[2900,4100],
  landings:[10,24],launches:[10,24],x:[15500,21500],guidedAttempts:[10,24],guidedRatio:[.80,1],roughRatio:[0,.55],micro:[0,1]};

// Final independent ten-minute seeds 0x7810/11 measured on native macOS and
// Linux Node 24 observed 91..92 targets, 72..81 direct hits, ratios .783..890,
// first hit 240..803f, shortest target telegraph 177..238f, 1,717..1,802 coins,
// 17,151..19,015 controlled-air frames, 85..90 landings, .976..1 completed
// guidance, 21..30% rough landings, and 0..1 micro-flights. Bands retain margin
// around the combined two-platform distribution rather than renderer-local math.
const SOAK={targets:[86,98],hits:[68,85],hitRatio:[.74,.92],first:[180,900],
  minLead:[140,260],avgLead:[350,410],coins:[1650,1900],air:[16000,20000],
  landings:[80,92],launches:[80,94],x:[93000,102000],guidedAttempts:[80,94],guidedRatio:[.92,1],roughRatio:[.12,.32],micro:[0,1]};

function assertTargetBands(p,bands,label){
  const m=targetMetrics(p);for(const key of Object.keys(bands))inRange(m[key],bands[key],`${label}: ${key}`);
  if(!p.finite||p.stats.invisibleResets!==0)fail(`${label}: non-finite state or ${p.stats.invisibleResets} invisible resets`);
  if(m.hits<1||m.first<0)fail(`${label}: no direct natural target hit`);
}

console.log('1) deterministic fixed-step, render, and chunk parity over full redesigned state');
{
  const a=bootGame('wingrush',{seed:0x7601,footer:FOOTER}),
    b=bootGame('wingrush',{seed:0x7601,footer:FOOTER}),
    rendered=bootGame('wingrush',{seed:0x7601,footer:FOOTER});
  a.frames(3600,false);b.frames(3600,false);const draws=rendered.frames(3600,true),
    sa=a.sandbox.__wrFullSignature(),sb=b.sandbox.__wrFullSignature(),sr=rendered.sandbox.__wrFullSignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${draws.calls} draw calls`);
  if(sa!==sb)fail('same seed diverged under identical fixed 60 Hz stepping');
  if(sa!==sr)fail('render traversal changed energy, targeting, pickups, scarf, or simulation state');
  if(!a.sandbox.__wingrushProbe().finite||!rendered.sandbox.__wingrushProbe().finite)fail('headless or rendered replay became non-finite');
  if(draws.calls<1000||!draws.byMethod.fillRect||!draws.byMethod.beginPath)fail(`real renderer was not exercised: ${JSON.stringify(draws.byMethod)}`);
  const mono=bootGame('wingrush',{seed:0x7602,footer:FOOTER}),chunked=bootGame('wingrush',{seed:0x7602,footer:FOOTER});
  mono.frames(1800,false);for(let i=0;i<180;i++)chunked.frames(10,false);
  const same=mono.sandbox.__wrFullSignature()===chunked.sandbox.__wrFullSignature();
  console.log(`  1,800 monolithic vs 180 x 10 frames: ${same?'identical':'DIFFERENT'}`);
  if(!same)fail('frame batching changed the redesigned simulation');
}

console.log('2) exact terrain plus momentum earned by diving a valley');
{
  const game=bootGame('wingrush',{seed:0x7603,footer:FOOTER}),c=game.sandbox.__wrTerrainContinuity(),
    terrain=game.sandbox.__wingrushTerrainFixture(),union=new Set(terrain.flatMap(q=>q.families)),
    signatures=new Set(terrain.map(q=>q.families.slice().sort().join('|'))),m=game.sandbox.__wingrushMomentumFixture();
  console.log(`  ${c.boundaries.length} boundaries; seam ${c.maxSeam.toExponential(2)}; ${terrain.length} biomes / ${union.size} hill families`);
  console.log(`  bank ${m.dive.bank.toFixed(2)} vs ${m.coast.bank.toFixed(2)}; charge ${m.dive.charge.toFixed(2)} vs ${m.coast.charge.toFixed(2)}; flight ${m.dive.flightDistance.toFixed(0)}px / ${m.dive.airFrames}f`);
  if(!c.exact||c.maxValueError!==0||c.maxSeam>.01||c.maxSlopeSeam>.01)fail(`terrain continuity regressed: ${JSON.stringify({exact:c.exact,value:c.maxValueError,seam:c.maxSeam,slope:c.maxSlopeSeam})}`);
  if(terrain.length!==5||terrain.some(q=>q.families.length<2||q.range<70)||union.size<8||signatures.size<4)fail('terrain lost biome/family/relief variety');
  if(!m.finite||m.dive.bank<m.coast.bank+.4||m.dive.charge<m.coast.charge+.35)fail(`diving did not earn momentum: ${JSON.stringify(m.advantage)}`);
  if(Math.abs(m.dive.launchX-m.dive.releaseX)>14||m.dive.flightDistance<160||m.dive.airFrames<55)fail(`valley release no longer creates a material flight: ${JSON.stringify(m.dive)}`);
  if(m.advantage.distance<140||m.advantage.airFrames<45)fail(`diving payoff too close to coasting: ${JSON.stringify(m.advantage)}`);
}

console.log('3) sustained vertical flight authority exists only after earned energy');
{
  const game=bootGame('wingrush',{seed:0x7615,footer:FOOTER}),f=game.sandbox.__wrEnergyFixture();
  console.log(`  energy ${f.earned.dive.toFixed(3)} vs ${f.earned.coast.toFixed(3)}; ram ${f.earned.diveRam.toFixed(2)} vs ${f.earned.coastRam.toFixed(2)}`);
  console.log(`  120f climb ${f.climb.dy.toFixed(1)}px, neutral ${f.neutral.dy.toFixed(1)}px, descend ${f.descend.dy.toFixed(1)}px, empty-climb ${f.emptyClimb.dy.toFixed(1)}px`);
  if(!f.finite)fail('energy/control fixture became non-finite');
  if(f.earned.dive<f.earned.coast+.2||f.earned.diveRam<f.earned.coastRam+1)fail(`valley momentum did not fund materially more flight energy/ram: ${JSON.stringify(f.earned)}`);
  if(f.earned.dive<.5||f.climb.spent<.18||f.climb.energy<=.05)fail(`earned energy did not sustain controlled climb for 120f: ${JSON.stringify(f.climb)}`);
  if(f.climb.rise<60||f.neutral.dy-f.climb.dy<180||f.descend.dy-f.neutral.dy<180)fail(`up/neutral/down paths are not materially controllable: ${JSON.stringify({climb:f.climb,neutral:f.neutral,descend:f.descend})}`);
  if(f.emptyClimb.dy-f.climb.dy<320||f.emptyClimb.dy<60||f.emptyClimb.vy<2)fail(`empty energy sustained climb instead of merely coasting on launch momentum: ${JSON.stringify({powered:f.climb,empty:f.emptyClimb})}`);
}

console.log('4) sky forts, direct core powers, physical collapse, and pure planner');
{
  const game=bootGame('wingrush',{seed:0x7620,footer:FOOTER}),catalog=game.sandbox.__wrSkyCatalog(),
    look=game.sandbox.__wrPlannerFixture(),physics=game.sandbox.__wrPolicyPhysicsParity(),control=bootGame('wingrush',{seed:0x7621,footer:FOOTER}),
    planned=bootGame('wingrush',{seed:0x7621,footer:FOOTER});
  planned.sandbox.__wrPlannerFixture();
  const rp=planned.sandbox.__wingrushNextRandom(),rc=control.sandbox.__wingrushNextRandom();
  console.log('  '+catalog.map(t=>`T${t.type} ${t.altitude}px / cores ${t.coreAltitudes.map(round).join(',')}`).join('; '));
  console.log(`  planner toggle launch physics ${physics.same?'identical':'DIFFERENT'} from x ${physics.x}`);
  if(catalog.length!==5||catalog.some(t=>t.altitude<80||t.blockClearance<70||t.cores<2||t.coreAltitudes.some(a=>a<95)))fail(`a structure is not materially airborne: ${JSON.stringify(catalog)}`);
  if(!look.pure||!look.repeat||!look.plan||!Number.isFinite(look.plan.min)||look.plan.min>55||look.plan.air<80||!look.finite)fail(`planner fixture regressed: ${JSON.stringify(look)}`);
  if(physics.missing||!physics.same||!physics.planned.events.some(e=>e[1]))fail(`__NO_LOOKAHEAD changed same-state physics: ${JSON.stringify(physics)}`);
  if(rp!==rc)fail('planner consumed simulation RNG for invisible work');
  for(const kind of['gust','spring','blast','star']){
    const g=bootGame('wingrush',{seed:0x7630,footer:FOOTER}),q=g.sandbox.__wrSkyCoreFixture(kind);
    console.log(`  ${kind}: ${q.altitude}px high, ${q.blocks} blocks, energy ${q.before.energy.toFixed(2)} -> ${q.after.energy.toFixed(2)}`);
    if(q.missing||q.kind!==kind||q.impacts!==1||q.targetHits!==1||q.cores!==1||!q.finite)fail(`${kind} did not register exactly one physical braced sky-target impact: ${JSON.stringify(q)}`);
    if(kind==='gust'&&(q.after.vx<4.2||q.after.energy<.7||q.after.boostT<240||q.boosts!==1))fail('gust core lost its flight extension after physical contact damping');
    if(kind==='spring'&&(q.after.grounded||q.after.vy> -2.7||q.after.energy<.8||q.after.boostT<300||q.boosts!==1))fail('spring core lost its high-flight launch');
    if(kind==='star'&&(q.after.energy!==1||q.after.ram<4.7||q.after.combo<3||q.after.boostT<480||q.boosts!==1))fail('star core lost its full-energy combo');
    if(kind==='blast'&&(q.blocks<5||q.boosts!==0))fail('blast core did not physically fracture its fort');
  }
  const tower=bootGame('wingrush',{seed:0x7640,footer:FOOTER}).sandbox.__wrSkyCollapseFixture();
  console.log(`  crown fort ${tower.altitude}px high: ${tower.bases} foundations -> ${tower.broken}/${tower.before} broken, ${tower.settled} settled`);
  if(tower.type!==4||tower.altitude<100||tower.bases<3||tower.broken!==tower.before||tower.settled!==tower.before||!tower.toppled||tower.towersToppled!==1||tower.blocksBroken!==tower.before||!tower.finite)fail(`sky-fort collapse regressed: ${JSON.stringify(tower)}`);
}

console.log('5) ten paired two-minute seeds: planner beats __NO_LOOKAHEAD on direct target hits');
{
  const smart=[],reactive=[];let hitWins=0;
  for(let i=0;i<10;i++){
    const seed=0x7700+i,a=bootGame('wingrush',{seed,footer:FOOTER}),b=bootGame('wingrush',{seed,footer:FOOTER});
    b.sandbox.__NO_LOOKAHEAD=1;a.frames(7200,false);b.frames(7200,false);
    const pa=a.sandbox.__wingrushProbe(),pb=b.sandbox.__wingrushProbe();smart.push(pa);reactive.push(pb);
    assertTargetBands(pa,POLICY,`seed ${seed.toString(16)} planner`);
    if(!pb.finite||pb.stats.invisibleResets!==0||pb.stats.targets<15||pb.bird.x<17000||pb.stats.targetHits<8||pb.stats.microHops>5)fail(`seed ${seed.toString(16)} reactive policy left the active/safe ablation contract: ${JSON.stringify({finite:pb.finite,resets:pb.stats.invisibleResets,targets:pb.stats.targets,x:Math.round(pb.bird.x),hits:pb.stats.targetHits,micro:pb.stats.microHops})}`);
    if(pa.stats.targetHits>pb.stats.targetHits)hitWins++;
    console.log(`  ${seed.toString(16)} ${pa.persona.padEnd(11)} ${pa.stats.targetHits}/${pa.stats.targets} hits, ${pa.stats.towersToppled} topples vs reactive ${pb.stats.targetHits}/${pb.stats.targets}, ${pb.stats.towersToppled}, x ${Math.round(pb.bird.x)}`);
  }
  const hits=[sum(smart,'targetHits'),sum(reactive,'targetHits')],targets=[sum(smart,'targets'),sum(reactive,'targets')],
    hitRatios=[ratio(hits[0],targets[0]),ratio(hits[1],targets[1])],topples=[sum(smart,'towersToppled'),sum(reactive,'towersToppled')],
    cores=[sum(smart,'cores'),sum(reactive,'cores')];
  console.log(`  ${hitWins}/10 direct-hit wins; hits ${hits[0]}/${hits[1]} (${(hitRatios[0]*100).toFixed(1)}%/${(hitRatios[1]*100).toFixed(1)}%), topples ${topples[0]}/${topples[1]}, cores ${cores[0]}/${cores[1]}`);
  if(hitWins<8)fail(`planner won direct target hits on only ${hitWins}/10 seeds`);
  if(hits[0]<hits[1]*1.1||hitRatios[0]<hitRatios[1]*1.15||hitRatios[0]<.52)fail(`planner direct-hit improvement was not clear: ${JSON.stringify({hits,targets,hitRatios})}`);
  if(topples[0]<topples[1]*1.1||cores[0]<cores[1]*1.05)fail(`direct hits did not convert to structural payoff: ${JSON.stringify({topples,cores})}`);
}

console.log('5b) ten paired two-minute seeds: target guidance beats the translated old feel-only policy');
{
  const guided=[],legacy=[];let wins=0;
  for(let i=0;i<10;i++){
    const seed=0x7720+i,a=bootGame('wingrush',{seed,footer:FOOTER}),b=bootGame('wingrush',{seed,footer:FOOTER});
    b.sandbox.__NO_TARGET_GUIDANCE=1;a.frames(7200,false);b.frames(7200,false);
    const pa=a.sandbox.__wingrushProbe(),pb=b.sandbox.__wingrushProbe();guided.push(pa);legacy.push(pb);
    if(pa.stats.targetHits>pb.stats.targetHits)wins++;
    if(!pb.finite||pb.stats.targets<15||pb.bird.x<16000||pb.stats.targetHits<1)fail(`seed ${seed.toString(16)} old-like targeting became an inert straw man`);
    console.log(`  ${seed.toString(16)} guided ${pa.stats.targetHits}/${pa.stats.targets} vs old-like ${pb.stats.targetHits}/${pb.stats.targets}, x ${Math.round(pa.bird.x)}/${Math.round(pb.bird.x)}`);
  }
  const hits=[sum(guided,'targetHits'),sum(legacy,'targetHits')],targets=[sum(guided,'targets'),sum(legacy,'targets')],
    ratios=[ratio(hits[0],targets[0]),ratio(hits[1],targets[1])],air=[sum(guided,'airControlFrames'),sum(legacy,'airControlFrames')],
    x=[guided.reduce((n,p)=>n+p.bird.x,0),legacy.reduce((n,p)=>n+p.bird.x,0)];
  console.log(`  ${wins}/10 wins; hits ${hits[0]}/${hits[1]} (${(ratios[0]*100).toFixed(1)}%/${(ratios[1]*100).toFixed(1)}%), air ${air[0]}/${air[1]}`);
  if(wins<8||hits[0]<hits[1]*1.25||ratios[0]<ratios[1]*1.2)fail(`target guidance improvement was not clear: ${JSON.stringify({wins,hits,targets,ratios})}`);
  if(air[1]<air[0]*.6||x[1]<x[0]*.8)fail(`old-like target policy was not active enough for a fair ablation: ${JSON.stringify({air,x})}`);
}

console.log('6) paired natural minutes: every run hits, and landing guidance turns forecasts into soft touchdowns');
{
let guided=0,attempts=0,roughOn=0,roughOff=0,landOn=0,landOff=0,hitsOn=0,hitsOff=0,microOn=0,microOff=0;
for(let i=0;i<10;i++){
  const seed=0x7900+i,game=bootGame('wingrush',{seed,footer:FOOTER}),unguided=bootGame('wingrush',{seed,footer:FOOTER});unguided.sandbox.__NO_LANDING_GUIDANCE=1;
  game.frames(3600,false);unguided.frames(3600,false);
  const p=game.sandbox.__wingrushProbe(),u=unguided.sandbox.__wingrushProbe();console.log(`  ${seed.toString(16)} ${p.persona.padEnd(11)} ${metricLine(p)}; off ${u.stats.roughLandings}/${u.stats.landings} rough`);
  assertTargetBands(p,NATURAL,`seed ${seed.toString(16)} natural`);
  if(p.stats.maxEventLull>720||p.stats.maxProgressLull>720)fail(`seed ${seed.toString(16)} natural viewer lull ${p.stats.maxEventLull}/${p.stats.maxProgressLull}f`);
  if(!u.finite||u.stats.targetHits<4||u.stats.landings<5)fail(`seed ${seed.toString(16)} no-landing-guidance policy became inert`);
  guided+=p.stats.guidedLandings;attempts+=p.stats.guidedAttempts;roughOn+=p.stats.roughLandings;roughOff+=u.stats.roughLandings;
  landOn+=p.stats.landings;landOff+=u.stats.landings;hitsOn+=p.stats.targetHits;hitsOff+=u.stats.targetHits;microOn+=p.stats.microHops;microOff+=u.stats.microHops;
}
console.log(`  landing A/B: ${guided}/${attempts} guided; rough ${roughOn}/${landOn} vs ${roughOff}/${landOff}; hits ${hitsOn}/${hitsOff}; micro ${microOn}/${microOff}`);
// The paired sweep measured 21/83 rough with guidance versus 71/73 without;
// a 27% ceiling retains margin around the measured 25.3% while rejecting smashy play.
if(ratio(guided,attempts)<.9||roughOn>landOn*.27||roughOn>=roughOff*.30)fail(`landing guidance did not clearly improve truthful touchdowns: ${JSON.stringify({guided,attempts,roughOn,roughOff,landOn,landOff})}`);
if(hitsOn<hitsOff*.9||microOn>2)fail(`landing guidance damaged targeting or reintroduced micro-flights: ${JSON.stringify({hitsOn,hitsOff,microOn,microOff})}`);
}

console.log('7) manual takeover shares vertical intent and the runtime physics path');
{
  const game=bootGame('wingrush',{seed:0x7760,footer:FOOTER}),initial=game.sandbox.__wingrushManual();
  press(game,'Enter');const instructions=game.sandbox.__wingrushManual();press(game,'Enter');const started=game.sandbox.__wingrushManual(),schemas=game.sandbox.__wrIntentSchemas();
  game.sandbox.__wrManualFlight();game.sandbox.__wrClearApplied();
  game.key('keydown','ArrowUp');game.frames(4,false);game.key('keyup','ArrowUp');const up=game.sandbox.__wrLastApplied();
  game.sandbox.__wrClearApplied();game.key('keydown','ArrowDown');game.frames(4,false);game.key('keyup','ArrowDown');const down=game.sandbox.__wrLastApplied();
  game.sandbox.__wrClearApplied();game.key('keydown','KeyX');game.frames(2,false);game.key('keyup','KeyX');const brace=game.sandbox.__wrLastApplied(),p=game.sandbox.__wingrushProbe();
  console.log(`  playing ${initial.playing}->${instructions.playing}->${started.playing}; schema ${schemas.humanKeys.join(',')}; up ${up&&up.vertical}, down ${down&&down.vertical}, brace ${brace&&brace.brace}`);
  if(initial.playing||instructions.playing||!started.playing)fail('manual session skipped the two-Enter gate');
  if(schemas.humanKeys.join('|')!==schemas.botKeys.join('|')||schemas.humanKeys.join('|')!=='brace|coreId|dive|tactic|targetId|vertical')fail(`human/bot vertical intent schemas differ: ${JSON.stringify(schemas)}`);
  if(!up||up.vertical!==-1||up.dive||up.tactic!=='MANUAL FLIGHT')fail(`ArrowUp did not request climb through advanceBody: ${JSON.stringify(up)}`);
  if(!down||down.vertical!==1||!down.dive||down.tactic!=='MANUAL FLIGHT')fail(`ArrowDown did not request descent through advanceBody: ${JSON.stringify(down)}`);
  if(!brace||!brace.brace||brace.tactic!=='MANUAL FLIGHT'||!p.finite)fail('manual brace missed the shared physics path or became non-finite');
}

console.log('8) environmental acts warn exactly 240f and alter flight before landing');
for(const type of['gust','rain']){
  const seed=type==='gust'?0x7750:0x7751,a=bootGame('wingrush',{seed,footer:FOOTER}),b=bootGame('wingrush',{seed,footer:FOOTER});
  a.sandbox.__wingrushActFixture(type);b.sandbox.__wingrushActFixture(type);b.sandbox.__NO_ACTS=1;
  if(a.sandbox.__wrPhysical()!==b.sandbox.__wrPhysical())fail(`${type}: paired act fixture did not start physically identical`);
  let first=-1,phase='',tactic='';for(let f=1;f<=270;f++){a.frames(1,false);b.frames(1,false);
    if(first<0&&a.sandbox.__wrPhysical()!==b.sandbox.__wrPhysical()){first=f;const p=a.sandbox.__wingrushProbe();phase=p.act.phase;tactic=p.bird.tactic;}}
  const pa=a.sandbox.__wingrushProbe(),pb=b.sandbox.__wingrushProbe(),notes=pa.act.notes.filter(n=>n.id===type),
    warn=notes.find(n=>n.kind==='act-warning'),land=notes.find(n=>n.kind==='act-land');
  console.log(`  ${type}: first body divergence ${first}f in ${phase} (${tactic}); warning ${warn&&land?land.tag-warn.tag:'?'}f`);
  if(!warn||!land||land.tag-warn.tag!==240||land.at-warn.at!==240)fail(`${type}: warning/land timing was not exactly 240f`);
  if(first<0||first>=240||phase!=='warn')fail(`${type}: bot did not react during the warning`);
  if(pb.act.notes.length)fail(`${type}: __NO_ACTS still emitted act notes`);
}

console.log('9) two deterministic ten-minute soaks: sustained flight, direct hits, and exact show budgets');
for(const seed of[0x7810,0x7811]){
  const{game,samples}=runSoak('wingrush',{seed,minutes:10,footer:FOOTER}),report=analyzeSoak(samples),
    p=game.sandbox.__wingrushProbe(),show=p.show,o=show.offeredByTier,s=show.shownByTier,s3=s[3]||0,
    continuity=game.sandbox.__wrContinuity;
  console.log(`  ${seed.toString(16)} ${soakLine(report)}; ${metricLine(p)}, tiers ${JSON.stringify(s)}`);
  assertSoak(seed.toString(16),report,{still:2,quiet:12,stall:12,minEvents:1200,minProgress:220},fail);
  assertTargetBands(p,SOAK,`seed ${seed.toString(16)} soak`);
  if(continuity.max>15)fail(`seed ${seed.toString(16)}: unaccounted ${continuity.max.toFixed(2)}px one-step jump`);
  if(p.stats.towersToppled<28||p.stats.cores<45||p.stats.misses>40)fail(`seed ${seed.toString(16)}: sky-target payoff band regressed (${p.stats.towersToppled} topples/${p.stats.cores} cores/${p.stats.misses} misses)`);
  notePairs(p,'gust',`seed ${seed.toString(16)}`,2);notePairs(p,'rain',`seed ${seed.toString(16)}`,2);
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=15))fail(`seed ${seed.toString(16)}: offered tiers not ordered ${JSON.stringify(o)}`);
  // Final measured shown-apex distribution is 13..17; keep one event of
  // margin while preserving strict tier ordering and exact time budgets.
  if(!((s[1]||0)>(s[2]||0)&&(s[2]||0)>(s[3]||0)&&(s[3]||0)>=12))fail(`seed ${seed.toString(16)}: shown tiers not ordered ${JSON.stringify(s)}`);
  if(show.heldFrames!==6*s3)fail(`seed ${seed.toString(16)}: apex hold ${show.heldFrames} != 6*${s3}`);
  if(show.slowedFrames!==24*s3)fail(`seed ${seed.toString(16)}: apex slow ${show.slowedFrames} != 24*${s3}`);
  if(show.admireFrames!==48*s3)fail(`seed ${seed.toString(16)}: apex admire ${show.admireFrames} != 48*${s3}`);
}
{
  const game=bootGame('wingrush',{seed:0x7812,footer:FOOTER}),a=game.sandbox.__wrAdmireFixture();
  if(a.admired.tactic!=='ADMIRE THE FALL'||a.gated.tactic==='ADMIRE THE FALL')fail(`__NO_ADMIRE did not gate bot-only pause: ${JSON.stringify(a)}`);
}
{
  const a=bootGame('wingrush',{seed:0x7813,footer:FOOTER}),b=bootGame('wingrush',{seed:0x7813,footer:FOOTER});b.sandbox.__NO_LAPSE=1;
  a.frames(7200,false);b.frames(7200,false);const pa=a.sandbox.__wingrushProbe(),pb=b.sandbox.__wingrushProbe();
  console.log(`  lapse switch: natural ${pa.stats.lapses}, competence anchor ${pb.stats.lapses}`);
  if(pa.stats.lapses<1||pb.stats.lapses!==0||!pb.finite)fail('__NO_LAPSE did not preserve a zero-lapse competence anchor');
}

console.log('10) payoff FX switch is a perfect full-state same-seed no-op');
{
  const a=bootGame('wingrush',{seed:0x7820,footer:FOOTER}),b=bootGame('wingrush',{seed:0x7820,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;a.frames(3600,false);b.frames(3600,false);
  const same=a.sandbox.__wrFullSignature()===b.sandbox.__wrFullSignature(),events=a.sandbox.__wingrushProbe().stats.events;
  console.log(`  signatures ${same?'identical':'DIFFERENT'} through ${events} visible events`);
  if(!same)fail('__NO_PAYOFF_FX changed energy, targets, pickups, scarf, or simulation state');
}

console.log('11) good/bad feedback legibility: every curated beat renders palette-separated pixels');
{
  // Lockstep live vs __NO_PAYOFF_FX twins on rendered runtimes (contract in
  // feedback.js): each sampled ledger beat must differ around its fire-time
  // screen position AND carry its own palette (gold/mint/cream/core colors for
  // good, coral for bad). Seeds chosen for coverage: 0x5301 fires all twelve
  // categories in 90s, 0x5302 backs up everything except the rare lapse.
  // Floors sit ~50% under the per-category darwin minima measured across both
  // seeds (bounced 137px changed / 15px coral, core 40/38, fort-down 40/38,
  // ram 42/42, kiss 60/49, high-flight 60/22, rough-landing 49/10, ring 14/11,
  // coin-line 22/22, launch 10/10, lapse 18/18, fort-missed 182/20) so an FX
  // deletion or one-color celebration fails while concurrent-FX dilution and
  // cross-platform rasterization drift do not.
  const GOOD_COLORS=['#ffd15c','#61e5bd','#fff2cf','#63e9dc','#a9ef67','#ff8a55','#ffe27a'];
  const BAD_COLORS=['#ff705f'];
  const runs=[0x5301,0x5302].map(seed=>runFeedbackVisibility('wingrush',{seed,frames:5400,
    signatureProbe:'__wingrushSignature',goodPalette:GOOD_COLORS,badPalette:BAD_COLORS}));
  const report=assertFeedback('wingrush',runs,{
    required:['good:launch','good:kiss','good:high-flight','good:ring','good:coin-line',
      'good:ram','good:core','good:fort-down','bad:bounced','bad:rough-landing','bad:fort-missed','bad:lapse'],
    minChanged:{default:20,'bad:bounced':70,'bad:fort-missed':90,'bad:lapse':9,'bad:rough-landing':24,
      'good:coin-line':11,'good:high-flight':30,'good:kiss':30,'good:launch':5,'good:ring':7},
    minSignature:{default:19,'bad:bounced':7,'bad:fort-missed':10,'bad:lapse':9,'bad:rough-landing':5,
      'good:coin-line':11,'good:high-flight':11,'good:kiss':24,'good:launch':5,'good:ring':5}
  },fail);
  for(const run of runs)console.log(`  ${run.seed.toString(16)}: ${feedbackLine([run])}`);
  console.log(`  categories: ${report.seen.join(', ')}`);
}

console.log(failed?'\nWINGRUSH EVAL FAILED':'\nWINGRUSH EVAL PASSED');
process.exit(failed?1:0);
