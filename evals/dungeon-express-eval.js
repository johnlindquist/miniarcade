#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');

// Observation-only receipt: every runtime controller result must cross the one
// game-owned applyIntent boundary. Nothing here changes an intent or world value.
const FOOTER=String.raw`
globalThis.__deApplied=[];
{const __deApply0=applyIntent;applyIntent=function(intent){
  globalThis.__deApplied.push({runFrame,dx:intent.dx,dy:intent.dy,attack:!!intent.attack,
    dash:!!intent.dash,action:!!intent.action,target:intent.target,tactic:intent.tactic});
  if(globalThis.__deApplied.length>256)globalThis.__deApplied.shift();
  return __deApply0(intent);
};}
globalThis.__deClearApplied=()=>{globalThis.__deApplied.length=0};
globalThis.__deLastApplied=()=>globalThis.__deApplied.at(-1)||null;
`;

let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code)};
const sum=(items,key)=>items.reduce((total,p)=>total+p.stats[key],0);
const relayScore=p=>p.stats.laps*1000-p.stats.distance;
const splitArc=p=>{const triples=[];for(let i=0;i+2<p.stats.splits.length;i+=3)triples.push(p.stats.splits.slice(i,i+3));const improved=triples.filter(q=>q[0]>(q[1]+q[2])/2).length,first=triples.reduce((n,q)=>n+q[0],0),later=triples.reduce((n,q)=>n+q[1]+q[2],0)/2;return{triples,improved,ratio:later?first/later:0}};
const inBands=(p,bands,label)=>{for(const[key,[low,high]]of Object.entries(bands)){
  const value=p.stats[key];if(value<low||value>high)fail(`${label}: ${key} ${value} outside measured band ${low}..${high}`);
}};
const notePairs=(p,label,minPairs)=>{const notes=p.actNotes.filter(n=>n.id==='ward-seal'),warnings=notes.filter(n=>n.kind==='act-warning'),lands=notes.filter(n=>n.kind==='act-land'),pending=warnings.length===lands.length+1&&p.act.phase==='warn';
  if(lands.length<minPairs||!(warnings.length===lands.length||pending))fail(`${label}: ${warnings.length} warnings / ${lands.length} lands`);
  for(let i=0;i<lands.length;i++){if(warnings[i].edgeId<0||lands[i].edgeId<0)fail(`${label}: act pair ${i} had no physical gate`);if(lands[i].at-warnings[i].at!==240)fail(`${label}: viewer warning ${i} was ${lands[i].at-warnings[i].at}f`);if(lands[i].tag-warnings[i].tag!==240)fail(`${label}: simulation warning ${i} was ${lands[i].tag-warnings[i].tag}f`)}return lands.length;
};

// Preserved cautious-policy calibration, measured after the no-stall fix over
// twenty paired 10-minute seeds 0xde100 + i*137. Route memory won all 20:
// 1,849 vs 1,578 laps and 611 vs 521 floors. Smart extrema were floors
// 29..31, laps 88..95, rooms 114..127, kills 265..293, boss kills 88..95,
// hits 75..101, lapses 4..15, actual remembered-cut crossings 13..39,
// events 1,544..1,586, progress 442..473, distance 2,460..2,606. Baseline
// remained fully active: 75..82 laps, 283..313 kills, 86..100 real
// verification-room arrivals, and exactly zero shortcut crossings.
// The shared two-minute policy bands below come from the same policies over the
// permanent 0xde300 panel and retain margin on both sides.
const POLICY_BANDS={
  floors:[3,7],laps:[12,21],rooms:[17,32],keys:[4,8],tools:[4,8],shortcuts:[4,8],
  enemyKills:[42,75],bossKills:[12,21],hits:[7,30],knockouts:[0,2],lapses:[0,8],
  revisions:[1,4],actsLanded:[2,2],events:[270,350],progress:[75,110],
  maxEventLull:[150,230],maxProgressLull:[150,380],distance:[450,750]
};

// Twenty final 10-minute smart runs above established the shipping contract.
// Bounds add measurement margin without widening away honest hits, map
// revisions, deliberate lapses, shortcut use, or the three-lap floor rhythm.
const SOAK_BANDS={
  floors:[27,34],laps:[84,100],rooms:[108,135],keys:[28,35],tools:[28,35],shortcuts:[27,35],
  enemyKills:[245,315],bossKills:[84,100],hits:[65,115],knockouts:[0,3],lapses:[1,20],
  revisions:[8,12],memoryCuts:[10,45],shortcutCrossings:[28,65],actsLanded:[9,10],events:[1450,1650],
  progress:[420,510],maxEventLull:[180,240],maxProgressLull:[240,450],distance:[2350,2750]
};

console.log('1) deterministic fixed-step replay, render parity, and finite state');
{
  const a=bootGame('dungeon-express',{seed:0xdd001,footer:FOOTER}),b=bootGame('dungeon-express',{seed:0xdd001,footer:FOOTER}),rendered=bootGame('dungeon-express',{seed:0xdd001,footer:FOOTER});
  a.frames(3600,false);b.frames(3600,false);const draws=rendered.frames(3600,true),sa=a.sandbox.__dungeonExpressSignature(),sb=b.sandbox.__dungeonExpressSignature(),sr=rendered.sandbox.__dungeonExpressSignature();
  console.log(`  replay ${sa===sb?'identical':'DIFFERENT'}; render ${sa===sr?'identical':'DIFFERENT'}; ${draws.calls} draw calls`);
  if(sa!==sb)fail('same seed diverged under fixed 60 Hz stepping');if(sa!==sr)fail('render traversal changed simulation state');
  if(!a.sandbox.__dungeonExpressProbe().finite||!rendered.sandbox.__dungeonExpressProbe().finite)fail('headless or rendered state became non-finite');
  if(draws.calls<10000||!draws.byMethod.fillRect||!draws.byMethod.beginPath)fail(`real renderer was not exercised: ${JSON.stringify(draws.byMethod)}`);
  const mono=bootGame('dungeon-express',{seed:0xdd002}),chunked=bootGame('dungeon-express',{seed:0xdd002});mono.frames(2400,false);for(let i=0;i<240;i++)chunked.frames(10,false);
  if(mono.sandbox.__dungeonExpressSignature()!==chunked.sandbox.__dungeonExpressSignature())fail('chunked fixed-step replay diverged');
}

console.log('2) generated floors are connected, seeded, and structurally varied');
{
  const layouts=new Set(),shortcuts=new Set();
  for(let i=0;i<24;i++){const game=bootGame('dungeon-express',{seed:0xdd100+i*97}),q=game.sandbox.__dungeonExpressLayoutFixture();
    if(!q.finite||q.rooms.length!==6||q.edges.length!==7||q.edges.filter(e=>e.shortcut).length!==1)fail(`seed ${i}: malformed six-room dungeon`);
    layouts.add(q.grid+'|'+q.edges.map(e=>`${e.x},${e.y}`).join(';'));shortcuts.add(q.edges.find(e=>e.shortcut).id);
  }
  console.log(`  ${layouts.size}/24 layout signatures; ${shortcuts.size}/7 shortcut positions`);
  if(layouts.size<16||shortcuts.size<6)fail('seed panel did not create enough topology/door variety');
}

console.log('3) route preview is repeatable and consumes no engine RNG');
{
  const control=bootGame('dungeon-express',{seed:0xdd200}),planned=bootGame('dungeon-express',{seed:0xdd200}),one=planned.sandbox.__dungeonExpressPlanPreview(),two=planned.sandbox.__dungeonExpressPlanPreview();
  const rp=planned.sandbox.__dungeonExpressNextRandom(),rc=control.sandbox.__dungeonExpressNextRandom();
  console.log(`  repeat ${JSON.stringify(one)===JSON.stringify(two)}; path ${one.path.length}; next RNG ${rp.toFixed(8)}/${rc.toFixed(8)}`);
  if(JSON.stringify(one)!==JSON.stringify(two)||!one.target||!one.path.length)fail('same-state route preview was not repeatable and useful');
  if(rp!==rc)fail('route planning consumed engine RNG for simulation-invisible work');
}

console.log('4) route-memory A/B: ten paired two-minute seeds beat cautious rechecking');
{
  const smart=[],baseline=[];let wins=0;
  for(let i=0;i<10;i++){const seed=0xde300+i*137,a=bootGame('dungeon-express',{seed,footer:FOOTER}),b=bootGame('dungeon-express',{seed,footer:FOOTER});
    b.sandbox.__NO_ROUTE_MEMORY=1;a.sandbox.__dungeonExpressReset();b.sandbox.__dungeonExpressReset();a.frames(7200,false);b.frames(7200,false);const pa=a.sandbox.__dungeonExpressProbe(),pb=b.sandbox.__dungeonExpressProbe();smart.push(pa);baseline.push(pb);if(relayScore(pa)>relayScore(pb))wins++;
    inBands(pa,POLICY_BANDS,`seed ${seed.toString(16)} memory`);inBands(pb,POLICY_BANDS,`seed ${seed.toString(16)} cautious`);
    const arc=splitArc(pa);if(!pa.finite||!pb.finite)fail(`seed ${seed.toString(16)} became non-finite`);if(pb.stats.detourRooms<12)fail(`seed ${seed.toString(16)} baseline stopped reaching verification rooms`);if(pa.stats.memoryCuts<4||pa.stats.shortcutCrossings<6||pb.stats.memoryCuts!==0||pb.stats.shortcutCrossings!==0)fail(`seed ${seed.toString(16)} actual shortcut-memory contract regressed`);if(arc.triples.length<5||arc.improved<5||arc.ratio<1.6)fail(`seed ${seed.toString(16)} scout-to-speedrun split compression regressed: ${JSON.stringify(arc)}`);
    console.log(`  ${seed.toString(16)} memory ${pa.stats.laps} laps/${pa.stats.distance} steps/${pa.stats.memoryCuts} cuts (${arc.improved}/${arc.triples.length}, ${arc.ratio.toFixed(2)}x) vs cautious ${pb.stats.laps}/${pb.stats.distance}/${pb.stats.detourRooms} checks`);
  }
  const scoreA=smart.reduce((n,p)=>n+relayScore(p),0),scoreB=baseline.reduce((n,p)=>n+relayScore(p),0),laps=[sum(smart,'laps'),sum(baseline,'laps')],floors=[sum(smart,'floors'),sum(baseline,'floors')];
  console.log(`  ${wins}/10 score wins; laps ${laps[0]}/${laps[1]}, floors ${floors[0]}/${floors[1]}, aggregate ${scoreA}/${scoreB}`);
  if(wins<8||laps[0]<laps[1]*1.08||floors[0]<floors[1]*1.08||scoreA<scoreB*1.08)fail('route memory did not deliver a clear paired win');
}

console.log('5) environmental ward act changes the line during its exact warning');
{
  const a=bootGame('dungeon-express',{seed:0xdd300}),b=bootGame('dungeon-express',{seed:0xdd300});a.sandbox.__dungeonExpressActFixture();b.sandbox.__dungeonExpressActFixture();b.sandbox.__NO_ACTS=1;
  if(a.sandbox.__dungeonExpressPhysicalSignature()!==b.sandbox.__dungeonExpressPhysicalSignature())fail('act pair did not start physically identical');let first=-1,phase='';
  for(let frame=1;frame<=250;frame++){a.frames(1,false);b.frames(1,false);if(first<0&&a.sandbox.__dungeonExpressPhysicalSignature()!==b.sandbox.__dungeonExpressPhysicalSignature()){first=frame;phase=a.sandbox.__dungeonExpressProbe().act.phase}}
  const pa=a.sandbox.__dungeonExpressProbe(),pb=b.sandbox.__dungeonExpressProbe(),warn=pa.actNotes.find(n=>n.kind==='act-warning'),land=pa.actNotes.find(n=>n.kind==='act-land');
  console.log(`  first physical divergence ${first}f in ${phase}; warning ${warn&&land?land.at-warn.at:'?'}f`);
  if(first<0||first>=240||phase!=='warn')fail('bot body did not move onto a revised line before the ward landed');if(!warn||!land||warn.edgeId<0||land.edgeId<0||land.at-warn.at!==240||land.tag-warn.tag!==240)fail('act warning lacked a gate or was not exactly 240 viewer and simulation frames');if(pb.actNotes.length)fail('__NO_ACTS still emitted notes');
}

console.log('6) human and bot share one seven-field intent and applyIntent path');
{
  const game=bootGame('dungeon-express',{seed:0xdd400,footer:FOOTER}),schema=game.sandbox.__dungeonExpressIntentFixture();if(schema.botKeys.join('|')!==schema.humanKeys.join('|'))fail(`intent schemas differ: ${JSON.stringify(schema)}`);
  const before=game.sandbox.__dungeonExpressProbe();press(game,'Enter');const instructions=game.sandbox.__engine.sessionProbe();press(game,'Enter');const playingState=game.sandbox.__engine.sessionProbe();game.frames(40,false);game.sandbox.__deClearApplied();game.key('keydown','ArrowRight');game.key('keydown','Space');game.frames(1,false);const applied=game.sandbox.__deLastApplied();game.key('keyup','ArrowRight');game.key('keyup','Space');
  console.log(`  schema ${schema.humanKeys.join(',')}; session ${before.showFrame}/${instructions.mode}/${playingState.mode}; applied ${JSON.stringify(applied)}`);
  if(instructions.mode!=='instructions'||playingState.mode!=='playing')fail('manual session skipped the two-Enter gate');if(!applied||applied.dx!==1||!applied.attack||applied.tactic!=='MANUAL RELAY')fail('manual intent did not traverse runtime applyIntent');
}

console.log('7) three ten-minute soaks: moving, eventful, progressing, and cinematic');
for(const seed of[0xdf010,0xdf011,0xe7015]){
  const{game,samples}=runSoak('dungeon-express',{seed,minutes:10,footer:FOOTER}),report=analyzeSoak(samples),p=game.sandbox.__dungeonExpressProbe(),show=p.show,offered=show.offeredByTier,shown=show.shownByTier,s3=shown[3]||0;
  console.log(`  ${seed.toString(16)} ${soakLine(report)}; ${p.stats.laps} laps/${p.stats.floors} floors/${p.stats.memoryCuts} remembered cuts; tiers ${JSON.stringify(shown)}`);
  assertSoak(seed.toString(16),report,{still:3,quiet:4,stall:6,minEvents:1450,minProgress:420},fail);inBands(p,SOAK_BANDS,`seed ${seed.toString(16)} soak`);notePairs(p,seed.toString(16),9);
  if(!((offered[1]||0)>(offered[2]||0)&&(offered[2]||0)>(offered[3]||0)&&(offered[3]||0)>=28))fail(`seed ${seed.toString(16)} offered tiers not ordered ${JSON.stringify(offered)}`);
  if(!((shown[1]||0)>(shown[2]||0)&&(shown[2]||0)>(shown[3]||0)&&(shown[3]||0)>=28))fail(`seed ${seed.toString(16)} shown tiers not ordered ${JSON.stringify(shown)}`);
  if(show.heldFrames!==6*s3)fail(`seed ${seed.toString(16)} apex hold ${show.heldFrames} != 6*${s3}`);if(show.slowedFrames!==24*s3)fail(`seed ${seed.toString(16)} apex slow ${show.slowedFrames} != 24*${s3}`);if(show.admireFrames!==48*s3)fail(`seed ${seed.toString(16)} apex admire ${show.admireFrames} != 48*${s3}`);
}
{
  const game=bootGame('dungeon-express',{seed:0xdf012}),admire=game.sandbox.__dungeonExpressAdmireFixture();if(admire.admired.tactic!=='SALUTE THE SPLIT'||admire.gated.tactic==='SALUTE THE SPLIT')fail(`__NO_ADMIRE did not gate the bot pause: ${JSON.stringify(admire)}`);
  game.sandbox.__NO_LAPSE=1;game.sandbox.__dungeonExpressReset();game.frames(36000,false);if(game.sandbox.__dungeonExpressProbe().stats.lapses!==0)fail('__NO_LAPSE still produced a lapse');
}

console.log('8) payoff FX is a perfect same-seed simulation no-op');
{
  const a=bootGame('dungeon-express',{seed:0xdd500}),b=bootGame('dungeon-express',{seed:0xdd500});b.sandbox.__NO_PAYOFF_FX=1;a.frames(4200,false);b.frames(4200,false);const same=a.sandbox.__dungeonExpressSignature()===b.sandbox.__dungeonExpressSignature(),p=a.sandbox.__dungeonExpressProbe();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} through ${p.stats.laps} laps/${p.stats.floors} apexes`);if(!same)fail('__NO_PAYOFF_FX changed simulation state');if(p.stats.floors<2)fail('FX parity did not cross enough apex payoffs');
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
