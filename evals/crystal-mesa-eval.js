#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
const{runMotion,analyzeMotion,assertMotion}=require('./motion');

// Observation-only receipts: every controller result crosses the one game-owned
// applyIntent boundary, and act notes are collected outside the kernel's bounded log.
const FOOTER=String.raw`
globalThis.__cmApplied=[];
{const __a0=applyIntent;applyIntent=function(intent){
  globalThis.__cmApplied.push({wf,mx:intent.mx,my:intent.my,grab:!!intent.grab,
    fire:!!intent.fire,zap:!!intent.zap,tactic:intent.tactic});
  if(globalThis.__cmApplied.length>256)globalThis.__cmApplied.shift();
  return __a0(intent);
};}
globalThis.__cmClearApplied=()=>{globalThis.__cmApplied.length=0};
globalThis.__cmLastApplied=()=>globalThis.__cmApplied.at(-1)||null;
globalThis.__cmActNotes=[];
{const __n0=SHOW.note;SHOW.note=e=>{if(e&&String(e.kind).startsWith('act-'))
  globalThis.__cmActNotes.push(Object.assign({},e));return __n0(e);};}
`;

let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code)};
const inBands=(stats,bands,label)=>{for(const[key,[low,high]]of Object.entries(bands)){
  const value=stats[key];if(value<low||value>high)fail(`${label}: ${key} ${value} outside measured band ${low}..${high}`);
}};

// 12-seed 10-minute sweep on the shipped sim (2026-07-11, seeds 0xc3a000+i*137,
// final art/gen pass — the world-gen RNG stream includes crystal/deco draws).
// Measured extrema — kills 83..155, propKills 56..113, throws 90..158, grabs
// 151..215, catches 25..51, catchKills 6..20, shieldBreaks 23..39, slots
// 9..15, deaths 6..18, bossKills 0..4 (per-seed lottery: whether a run camps
// a boss zone late), surges 8..12, metersMax 988..1652, lapseFrames 49..145.
// Bands add margin on both sides. The metersMax floor of 800 is the honest
// "this run visibly climbed" contract: the pre-fix stale-latch bug shipped
// 27m/117m/585m runs, and this floor catches that entire class of quiet
// starvation. Boss pressure is asserted as an aggregate across the three
// fixed soak seeds because any single seed may legitimately roll 0.
const SOAK_BANDS={
  kills:[60,200],propKills:[40,150],throws:[60,210],grabs:[110,280],
  catches:[16,66],shieldBreaks:[16,50],slots:[6,19],deaths:[3,26],
  bossKills:[0,6],surges:[5,15],metersMax:[800,2000],lapseFrames:[20,320]
};

console.log('1) deterministic fixed-step replay, render parity, and finite state');
{
  const a=bootGame('crystal-mesa',{seed:0xc31001}),b=bootGame('crystal-mesa',{seed:0xc31001}),rendered=bootGame('crystal-mesa',{seed:0xc31001});
  a.frames(3600,false);b.frames(3600,false);const draws=rendered.frames(3600,true);
  const sa=a.sandbox.__cmSignature(),sb=b.sandbox.__cmSignature(),sr=rendered.sandbox.__cmSignature();
  console.log(`  replay ${sa===sb?'identical':'DIFFERENT'}; render ${sa===sr?'identical':'DIFFERENT'}; ${draws.calls} draw calls`);
  if(sa!==sb)fail('same seed diverged under fixed 60 Hz stepping');
  if(sa!==sr)fail('render traversal changed simulation state');
  if(!a.sandbox.__cmProbe().finite||!rendered.sandbox.__cmProbe().finite)fail('state became non-finite');
  if(draws.calls<400||!draws.byMethod.fillRect)fail(`real renderer was not exercised: ${JSON.stringify(draws.byMethod)}`);
  const mono=bootGame('crystal-mesa',{seed:0xc31002}),chunked=bootGame('crystal-mesa',{seed:0xc31002});
  mono.frames(2400,false);for(let i=0;i<240;i++)chunked.frames(10,false);
  if(mono.sandbox.__cmSignature()!==chunked.sandbox.__cmSignature())fail('chunked fixed-step replay diverged');
}

console.log('2) zone generation is seeded and varied');
{
  const sockets=new Set(),layouts=new Set();
  for(let i=0;i<16;i++){
    const game=bootGame('crystal-mesa',{seed:0xc32000+i*97,
      footer:';globalThis.__cmGen=()=>zones.slice(0,2).map(z=>[z.socket.x,z.deco.length,z.crystals.length,z.boss?1:0,'+
        'foes.filter(f=>kOf(f.y)===z.k).length,props.filter(p=>kOf(p.y)===z.k).length].join(","));'});
    const g=game.sandbox.__cmGen();
    sockets.add(g[0].split(',')[0]);layouts.add(g.join('|'));
  }
  console.log(`  ${layouts.size}/16 layout signatures; ${sockets.size} socket sides`);
  if(layouts.size<12)fail('seed panel did not vary zone furnishing/population');
  if(sockets.size<2)fail('socket side never varied');
}

console.log('3) grav-claw A/B: the gun IS the game (paired seeds, __NO_GRAVGUN)');
{
  let wins=0,totA=0,totB=0;
  for(let i=0;i<6;i++){const seed=0xc33000+i*137;
    const a=bootGame('crystal-mesa',{seed}),b=bootGame('crystal-mesa',{seed,footer:';globalThis.__NO_GRAVGUN=1;'});
    a.frames(10800,false);b.frames(10800,false);
    const pa=a.sandbox.__cmProbe(),pb=b.sandbox.__cmProbe();
    totA+=pa.stats.kills;totB+=pb.stats.kills;
    if(pa.stats.kills>pb.stats.kills)wins++;
    if(pb.stats.throws!==0||pb.stats.propKills!==0||pb.stats.grabs!==0||pb.stats.catches!==0)
      fail(`seed ${seed.toString(16)}: __NO_GRAVGUN still used the claw`);
    if(a.sandbox.__cmSignature()===b.sandbox.__cmSignature())fail(`seed ${seed.toString(16)}: ablation did not diverge`);
    console.log(`  ${seed.toString(16)} claw ${pa.stats.kills} kills (${pa.stats.throws} throws) vs zap-only ${pb.stats.kills}`);
  }
  if(wins<6||totA<totB*2)fail(`grav claw did not clearly out-kill zap-only: ${totA} vs ${totB}, ${wins}/6 wins`);
}

console.log('4) personas: deterministic, distinct, and __NO_PERSONAS collapses to BALANCED');
{
  const a=bootGame('crystal-mesa',{seed:0xc34001}),b=bootGame('crystal-mesa',{seed:0xc34001});
  a.frames(6000,false);b.frames(6000,false);
  if(a.sandbox.__cmSignature()!==b.sandbox.__cmSignature())fail('persona assignment broke same-seed determinism');
  const n1=bootGame('crystal-mesa',{seed:0xc34002,footer:';globalThis.__NO_PERSONAS=1;'});
  n1.frames(1200,false);
  if(n1.sandbox.__cmProbe().persona!=='BALANCED')fail('__NO_PERSONAS did not force BALANCED');
  // forced-persona dials, 4 seeds each (measured 2026-07-11 on the shipped sim:
  // foeThrows JUGGLER 73 / HAULER 34 / POACHER 77; throws 292/222/251 — poach
  // appetite and hurl cadence are the robust separations; catch counts turned
  // out to track warden proximity, not catch radius, so they are not asserted)
  const tot={};
  for(const P of['JUGGLER','HAULER','POACHER']){
    tot[P]={ca:0,ft:0,th:0};
    for(let i=0;i<4;i++){
      const g=bootGame('crystal-mesa',{seed:0xbead+i*137,footer:`;globalThis.__CM_FORCE_PERSONA='${P}';`});
      for(let s=0;s<300;s++)g.frames(60,false);
      const st=g.sandbox.__cmProbe().stats;
      if(g.sandbox.__cmProbe().persona!==P)fail(`forced persona ${P} was not applied`);
      tot[P].ca+=st.catches;tot[P].ft+=st.foeThrows;tot[P].th+=st.throws;
    }
    console.log(`  ${P} throws ${tot[P].th}, catches ${tot[P].ca}, live-mite hurls ${tot[P].ft}`);
  }
  if(!(tot.POACHER.ft>=tot.HAULER.ft*1.5))fail('POACHER did not out-poach HAULER');
  if(!(tot.JUGGLER.ft>=tot.HAULER.ft*1.4))fail('JUGGLER did not out-poach patient HAULER');
  if(!(tot.JUGGLER.th>tot.HAULER.th))fail('JUGGLER cadence did not beat HAULER patience');
}

console.log('5) resonance surge: exact 240-frame telegraph that changes the plan before landing');
{
  const a=bootGame('crystal-mesa',{seed:0xc35001,footer:FOOTER}),b=bootGame('crystal-mesa',{seed:0xc35001,footer:FOOTER+';globalThis.__NO_ACTS=1;'});
  a.sandbox.__cmActFixture();b.sandbox.__cmActFixture();
  if(a.sandbox.__cmPhysicalSignature()!==b.sandbox.__cmPhysicalSignature())fail('act pair did not start physically identical');
  let first=-1,phase='';
  for(let frame=1;frame<=460;frame++){a.frames(1,false);b.frames(1,false);
    if(first<0&&a.sandbox.__cmPhysicalSignature()!==b.sandbox.__cmPhysicalSignature()){
      first=frame;phase=a.sandbox.__cmProbe().act.phase;}}
  const notes=a.sandbox.__cmActNotes,warn=notes.find(n=>n.kind==='act-warning'),land=notes.find(n=>n.kind==='act-land');
  console.log(`  first physical divergence ${first}f in '${phase}'; viewer warning ${warn&&land?land.at-warn.at:'?'}f; sim warning ${warn&&land?land.tag-warn.tag:'?'}f`);
  if(first<0||phase!=='warn')fail('bot did not physically brace during the warning');
  if(!warn||!land||land.at-warn.at!==240)fail('surge warning was not exactly 240 viewer frames');
  // sim frames may run slightly short of 240 if an apex slow-mo overlaps the warn window
  if(!warn||!land||land.tag-warn.tag<200||land.tag-warn.tag>240)fail('surge sim warning outside 200..240 world frames');
  if(b.sandbox.__cmActNotes.length)fail('__NO_ACTS still emitted act notes');
  if(b.sandbox.__cmProbe().stats.surges!==0)fail('__NO_ACTS still landed a surge');
}

console.log('6) claw fixtures: hurl kills, bolt catch, shield break, thrown-cell slot');
{
  const g=bootGame('crystal-mesa',{seed:0xc36001});
  g.sandbox.__cmThrowFixture();
  let st0=g.sandbox.__cmProbe().stats;
  g.frames(900,false);
  let st=g.sandbox.__cmProbe().stats;
  if(st.grabs<=st0.grabs)fail('throw fixture: bot never grabbed the staged crate');
  if(st.throws<=st0.throws)fail('throw fixture: bot never hurled');
  if(st.propKills<=st0.propKills)fail('throw fixture: staged mites survived the hurl');
  const c=bootGame('crystal-mesa',{seed:0xc36002});
  c.sandbox.__cmCatchFixture();st0=c.sandbox.__cmProbe().stats;
  c.frames(1200,false);st=c.sandbox.__cmProbe().stats;
  if(st.catches<=st0.catches)fail('catch fixture: bot never caught the staged bolt');
  const nc=bootGame('crystal-mesa',{seed:0xc36002,footer:';globalThis.__NO_CATCH=1;'});
  nc.sandbox.__cmCatchFixture();nc.frames(1200,false);
  if(nc.sandbox.__cmProbe().stats.catches!==0)fail('__NO_CATCH still caught bolts');
  const sh=bootGame('crystal-mesa',{seed:0xc36003});
  sh.sandbox.__cmShieldFixture();st0=sh.sandbox.__cmProbe().stats;
  sh.frames(900,false);st=sh.sandbox.__cmProbe().stats;
  if(st.shieldBreaks<=st0.shieldBreaks)fail('shield fixture: warden shield never broke to a prop');
  const sl=bootGame('crystal-mesa',{seed:0xc36004});
  sl.sandbox.__cmSlotFixture();st0=sl.sandbox.__cmProbe().stats;
  sl.frames(600,false);st=sl.sandbox.__cmProbe().stats;
  if(st.slots<=st0.slots)fail('slot fixture: held cell never reached the socket');
  const bo=bootGame('crystal-mesa',{seed:0xc36005});
  bo.sandbox.__cmBossFixture();
  bo.frames(7200,false);st=bo.sandbox.__cmProbe().stats;
  if(st.bossKills<1)fail('boss fixture: staged tripod survived 2 minutes of props');
  console.log('  hurl, catch, shield, slot, and tripod fixtures all converted');
}

console.log('7) human and bot share one intent schema and applyIntent path');
{
  const game=bootGame('crystal-mesa',{seed:0xc37001,footer:FOOTER});
  game.frames(60,false);
  const bot=game.sandbox.__cmLastIntent(),human=game.sandbox.__cmHumanIntentKeys();
  if(bot!==human)fail(`intent schemas differ: bot ${bot} vs human ${human}`);
  press(game,'Enter');const instructions=game.sandbox.__engine.sessionProbe();
  press(game,'Enter');const playingState=game.sandbox.__engine.sessionProbe();
  game.frames(30,false);game.sandbox.__cmClearApplied();
  game.key('keydown','ArrowUp');game.frames(1,false);
  const applied=game.sandbox.__cmLastApplied();
  game.key('keyup','ArrowUp');
  console.log(`  schema ${bot}; session ${instructions.mode}/${playingState.mode}; applied ${JSON.stringify(applied)}`);
  if(instructions.mode!=='instructions'||playingState.mode!=='playing')fail('manual session skipped the two-Enter gate');
  if(!applied||applied.my!==-1||applied.tactic!=='human')fail('manual intent did not traverse applyIntent');
}

console.log('8) three ten-minute soaks: moving, eventful, progressing, tiers ordered, budgets exact');
let soakBossKills=0;
for(const seed of[0xc3a000,0xc3a19b,0xc38015]){
  const{game,samples}=runSoak('crystal-mesa',{seed,minutes:10,footer:FOOTER});
  const report=analyzeSoak(samples),p=game.sandbox.__cmProbe();
  const show=p.show,offered=show.offeredByTier,shown=show.shownByTier,s3=shown[3]||0;
  console.log(`  ${seed.toString(16)} ${soakLine(report)}; ${p.stats.kills} kills/${p.stats.slots} slots/${p.stats.metersMax}m; tiers ${JSON.stringify(shown)}`);
  assertSoak(seed.toString(16),report,{still:3,quiet:30,stall:100,minEvents:300,minProgress:1400},fail); // quiet 11..19s, stall 43..63s measured; a boss siege freezes meters honestly
  inBands(p.stats,SOAK_BANDS,`seed ${seed.toString(16)} soak`);
  if(!((offered[1]||0)>(offered[2]||0)&&(offered[2]||0)>(offered[3]||0)))fail(`seed ${seed.toString(16)} offered tiers not ordered ${JSON.stringify(offered)}`);
  if(!((shown[1]||0)>(shown[2]||0)&&(shown[2]||0)>=(shown[3]||0)))fail(`seed ${seed.toString(16)} shown tiers not ordered ${JSON.stringify(shown)}`);
  if(show.heldFrames!==6*s3)fail(`seed ${seed.toString(16)} apex hold ${show.heldFrames} != 6*${s3}`);
  if(show.slowedFrames!==12*s3)fail(`seed ${seed.toString(16)} apex slow ${show.slowedFrames} != 12*${s3}`);
  if(show.admireFrames!==48*s3)fail(`seed ${seed.toString(16)} apex admire ${show.admireFrames} != 48*${s3}`);
  const warns=game.sandbox.__cmActNotes.filter(n=>n.kind==='act-warning').length;
  const lands=game.sandbox.__cmActNotes.filter(n=>n.kind==='act-land').length;
  if(lands<2||warns<lands)fail(`seed ${seed.toString(16)} surge acts did not keep landing: ${warns}/${lands}`);
  soakBossKills+=p.stats.bossKills;
}
if(soakBossKills<2)fail(`tripods survived the whole soak panel: ${soakBossKills} boss kills across three runs`);

console.log('9) motion contract: no stalls, budgeted emotes, measured pace floor');
for(const seed of[0xc39001,0xc39002]){
  const run=runMotion('crystal-mesa',{seed,minutes:10});
  const report=analyzeMotion(run,{});
  assertMotion(seed.toString(16),report,fail);
  const hero=report.actors.find(a=>a.id==='custodian');
  console.log(`  ${seed.toString(16)}: ${report.actors.length} actors, hero bare ${hero?hero.worstBareStillFrames:'?'}f, emote share ${(hero?hero.emoteStillShare*100:0).toFixed(1)}%`);
}
{
  // live pace floor: measured 0.795..0.821 px/f over two 3-minute seeds (2026-07-11)
  const g=bootGame('crystal-mesa',{seed:0xc39003,
    footer:';globalThis.__hp=()=>({x:hero.x,y:hero.y,dead:hero.dead,hold:pres.holdWorld,pe:pres.physicsEvery,adm:pres.admire});'});
  let sum=0,n=0,prev=null;
  for(let i=0;i<3*3600;i+=5){
    g.frames(5,false);
    const h=g.sandbox.__hp();
    if(prev&&h.dead<=0&&prev.dead<=0&&!h.hold&&h.pe===1&&!h.adm){sum+=Math.hypot(h.x-prev.x,h.y-prev.y)/5;n++;}
    prev=h;
  }
  const pace=sum/n;
  console.log(`  live pace ${pace.toFixed(3)} px/f`);
  if(pace<0.55)fail(`custodian live pace ${pace.toFixed(3)} below 0.55 px/f floor`);
}

console.log('10) deliberate imperfection fires, and __NO_LAPSE silences it');
{
  const a=bootGame('crystal-mesa',{seed:0xc3b001});
  a.frames(36000,false);
  const lf=a.sandbox.__cmProbe().stats.lapseFrames;
  console.log(`  lapse frames ${lf}`);
  if(lf<15||lf>600)fail(`lapse frames ${lf} outside 15..600 (measured 40..199 over 12 seeds)`);
  const b=bootGame('crystal-mesa',{seed:0xc3b001,footer:';globalThis.__NO_LAPSE=1;'});
  b.frames(36000,false);
  if(b.sandbox.__cmProbe().stats.lapseFrames!==0)fail('__NO_LAPSE still lapsed');
}

console.log('11) payoff FX is a perfect same-seed simulation no-op');
{
  const a=bootGame('crystal-mesa',{seed:0xc3c001}),b=bootGame('crystal-mesa',{seed:0xc3c001,footer:';globalThis.__NO_PAYOFF_FX=1;'});
  a.frames(9000,false);b.frames(9000,false);
  const same=a.sandbox.__cmSignature()===b.sandbox.__cmSignature(),p=a.sandbox.__cmProbe();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} through ${p.stats.kills} kills/${p.stats.slots} slots`);
  if(!same)fail('__NO_PAYOFF_FX changed simulation state');
  if(p.stats.kills<10)fail('FX parity run saw too little action to prove anything');
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
