#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
const{assertEntertainment}=require('./entertainment');
const{runMotion,analyzeMotion,assertMotion,motionLine}=require('./motion');
const evidence=require('./evidence');
const GAME_SOURCE=fs.readFileSync(path.join(__dirname,'..','dungeon-express.html'),'utf8');

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
const longestStraight=grid=>{const rows=grid.split('/'),runs=[];for(const row of rows)for(const run of row.split('1'))runs.push(run.length);for(let x=0;x<rows[0].length;x++){let run=0;for(let y=0;y<rows.length;y++){if(rows[y][x]==='0')run++;else{runs.push(run);run=0}}runs.push(run)}return Math.max(...runs)};
const forbiddenPresentation=[/\bfunction\s+drawPath\b/,/\bdrawRoutes\s*\(/,/\bdrawMemoryCues\s*\(/,/VISIBLE ROUTE PLAN/,/ROUTE REVISED/,/route\.map\(p=>roomOf/,/trail\.slice\s*\(/,/fillText\s*\(\s*tactic\b/,/function\s+drawMiniMap\(\)[^\n]*for\(const e of edges\)\{/];
const noVisiblePath=forbiddenPresentation.every(pattern=>!pattern.test(GAME_SOURCE));
const inBands=(p,bands,label)=>{for(const[key,[low,high]]of Object.entries(bands)){
  const value=p.stats[key];if(value<low||value>high)fail(`${label}: ${key} ${value} outside measured band ${low}..${high}`);
}};
const entertainmentEvidence=(p,layout)=>{const degree=layout.rooms.map(room=>layout.edges.filter(e=>e.a===room.id||e.b===room.id).length);return{noVisiblePath,topology:{rooms:layout.rooms.length,branches:degree.filter(value=>value>=3).length,maxStraight:longestStraight(layout.grid)},puzzle:{transitions:p.stats.puzzleTransitions,completions:p.stats.puzzleCompletions},agency:{enemyActions:p.stats.enemyActions,playerResponses:p.stats.playerResponses},decisions:{puzzle:{count:p.stats.puzzleTransitions,source:'stats.puzzleTransitions'},threat:{count:p.stats.enemyTells+p.stats.enemyActions,source:'stats.enemyTells+stats.enemyActions'},response:{count:p.stats.playerResponses,source:'stats.playerResponses'},combat:{count:p.stats.combatBeats,source:'stats.combatBeats'},payoff:{count:p.stats.payoffs,source:'stats.payoffs'}},maxDeadAir:p.stats.maxDecisionDeadAir}};
const validateNaturalEvidence=(label,ambient,p)=>{const ledger=ambient.ledger,report=evidence.validateEvidence(ledger);if(!report.ok){for(const violation of report.violations)fail(`${label}: [${violation.code}] ${violation.message}`);return null}const events=report.ledger.events,bySerial=new Map(events.map(event=>[event.serial,event])),locomotion=/locomotion|movement|walk|turn|replan|replanning|navigation|path|route/i;
  if(report.ledger.dropped)fail(`${label}: evidence ledger dropped ${report.ledger.dropped} causal facts`);if(events.some((event,index)=>!Number.isInteger(event.showFrame)||!Number.isInteger(event.runFrame)||event.frame!==event.showFrame||index&&(event.frame<events[index-1].frame||event.serial<=events[index-1].serial)))fail(`${label}: evidence lost integer show-frame payload or serial order`);if(!events.some((event,index)=>index&&event.frame===events[index-1].frame))fail(`${label}: same-frame facts were not retained in serial order`);
  if(report.ledger.sources.some(source=>locomotion.test(source.id)||locomotion.test(source.kind))||events.some(event=>locomotion.test(event.source)||locomotion.test(event.kind)))fail(`${label}: ordinary locomotion/replanning received evidence credit`);
  const responses=events.filter(event=>event.kind==='response'),commits=events.filter(event=>event.kind==='commit'),payoffs=events.filter(event=>event.kind==='payoff'),threats=events.filter(event=>event.kind==='threat');if(!responses.length||!commits.length||!payoffs.length||!threats.length||!events.some(event=>event.kind==='environment'))fail(`${label}: natural ledger omitted a tactical evidence category`);
  if([...responses,...commits].some(event=>event.actorId!=='hero'))fail(`${label}: response/commit changed persistent hero identity`);if(responses.some(event=>bySerial.get(event.causeSerial)?.kind!=='threat'||bySerial.get(event.causeSerial).serial>=event.serial||event.tellId!==event.respondedId||!/^floor:\d+:lap:\d+:(?:foe-\d+|warden)$/.test(event.instanceId||'')))fail(`${label}: dodge/brace/counter lost stable threat causality`);if(payoffs.some(event=>bySerial.get(event.setupSerial)?.kind!=='setup'||!['commit','response'].includes(bySerial.get(event.commitSerial)?.kind)||bySerial.get(event.setupSerial).serial>=event.serial||bySerial.get(event.commitSerial).serial>=event.serial))fail(`${label}: payoff lost setup plus commit/response causality`);if(threats.filter(event=>event.source==='enemy-tell'||event.source==='enemy-action').some(event=>!/^floor:\d+:lap:\d+:(?:foe-\d+|warden)$/.test(event.instanceId||'')||!/^foe-\d+$|^warden$/.test(event.actorId||'')))fail(`${label}: ledger enemy instance/role identity drifted`);
  const sourceCount=id=>events.filter(event=>event.source===id).length,puzzleFacts=sourceCount('puzzle-first-sigil')+sourceCount('puzzle-second-sigil')+sourceCount('shortcut-cut'),threatFacts=sourceCount('enemy-tell')+sourceCount('enemy-action'),responseFacts=sourceCount('hero-dodge')+sourceCount('hero-brace'),combatFacts=sourceCount('hero-strike')+sourceCount('combat-impact');if(puzzleFacts!==p.stats.puzzleTransitions||threatFacts!==p.stats.enemyTells+p.stats.enemyActions||responseFacts!==p.stats.playerResponses||combatFacts!==p.stats.combatBeats||payoffs.length!==p.stats.payoffs)fail(`${label}: ledger facts drifted from the preserved entertainment source formulas`);if(!events.some(event=>event.source==='ward-warning')||!events.some(event=>event.source==='ward-land')||!events.some(event=>event.source==='ward-release'))fail(`${label}: natural ledger missed ward reversal phases`);return evidence.deriveEvidence(ledger)};
const notePairs=(p,label,minPairs)=>{const notes=p.actNotes.filter(n=>n.id==='ward-seal'),warnings=notes.filter(n=>n.kind==='act-warning'),lands=notes.filter(n=>n.kind==='act-land'),pending=warnings.length===lands.length+1&&p.act.phase==='warn';
  if(lands.length<minPairs||!(warnings.length===lands.length||pending))fail(`${label}: ${warnings.length} warnings / ${lands.length} lands`);
  for(let i=0;i<lands.length;i++){if(warnings[i].edgeId<0||lands[i].edgeId<0)fail(`${label}: act pair ${i} had no physical gate`);if(lands[i].at-warnings[i].at!==240)fail(`${label}: viewer warning ${i} was ${lands[i].at-warnings[i].at}f`);if(lands[i].tag-warnings[i].tag!==240)fail(`${label}: simulation warning ${i} was ${lands[i].tag-warnings[i].tag}f`)}return lands.length;
};

// Ten paired two-minute seeds measured after the authored-room repair. The
// internal remembered-route policy still won 10/10 while both policies solved
// sigil rooms and fought active enemies. These bands cover both the smart and
// cautious policies with margin; the entertainment proof below does not award
// either policy credit for walking, replanning, or merely entering a room.
const POLICY_BANDS={
  floors:[3,6],laps:[9,16],rooms:[14,23],keys:[3,6],tools:[3,6],shortcuts:[3,6],
  enemyKills:[42,58],bossKills:[9,16],hits:[0,10],knockouts:[0,1],lapses:[0,8],
  revisions:[1,3],actsLanded:[1,2],progress:[84,116],
  maxProgressLull:[190,550],distance:[600,850]
};

// A ten-seed 10-minute sweep (0xdf010 + i*131) after the physical tell/recovery
// repair established 22..23 floors, 66..71 laps, 110..120 puzzle transitions,
// 44..48 solved vaults, 193..216 enemy tells, 191..212 visible responses,
// 39..63 near misses, and 145..270f maximum tactical dead air. Bounds retain
// measured margin without counting locomotion as a viewer beat.
const SOAK_BANDS={
  floors:[21,26],laps:[63,76],rooms:[80,102],keys:[21,26],tools:[21,26],shortcuts:[21,26],
  enemyKills:[225,255],bossKills:[63,76],hits:[24,48],knockouts:[0,1],lapses:[1,16],
  revisions:[8,11],memoryCuts:[12,42],shortcutCrossings:[27,66],actsLanded:[8,10],
  progress:[445,535],maxProgressLull:[320,650],distance:[3450,3650],puzzleTransitions:[105,132],
  puzzleCompletions:[42,53],enemyTells:[168,245],enemyActions:[168,245],playerResponses:[158,240],
  nearMisses:[35,82],counters:[85,145],combatBeats:[500,570],payoffs:[190,225],maxDecisionDeadAir:[140,280]
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

console.log('1b) Ambient Evidence is a byte-identical simulation, RNG, statistics, and decision no-op');
{
  const a=bootGame('dungeon-express',{seed:0xdd081}),b=bootGame('dungeon-express',{seed:0xdd081});b.sandbox.__NO_EVIDENCE_LEDGER=1;a.sandbox.__dungeonExpressReset();b.sandbox.__dungeonExpressReset();a.frames(18000,false);b.frames(18000,false);
  const sa=a.sandbox.__dungeonExpressSignature(),sb=b.sandbox.__dungeonExpressSignature(),pha=a.sandbox.__dungeonExpressPhysicalSignature(),phb=b.sandbox.__dungeonExpressPhysicalSignature(),pa=a.sandbox.__dungeonExpressProbe(),pb=b.sandbox.__dungeonExpressProbe(),aa=a.sandbox.__ambientProbe(),ab=b.sandbox.__ambientProbe(),ra=a.sandbox.__dungeonExpressNextRandom(),rb=b.sandbox.__dungeonExpressNextRandom(),derived=validateNaturalEvidence('evidence-on twin',aa,pa);
  console.log(`  ${derived&&derived.eventCount||0} facts/${derived&&derived.payoffs||0} payoffs; signatures ${sa===sb?'identical':'DIFFERENT'}; RNG ${ra.toFixed(8)}/${rb.toFixed(8)}`);
  if(sa!==sb||pha!==phb)fail('__NO_EVIDENCE_LEDGER changed full or physical simulation signature');if(JSON.stringify(pa.stats)!==JSON.stringify(pb.stats)||pa.events!==pb.events||pa.progress!==pb.progress)fail('__NO_EVIDENCE_LEDGER changed exact statistics or decisions');if(ra!==rb)fail('__NO_EVIDENCE_LEDGER changed engine RNG state');if(!aa.ledger.enabled||!aa.ledger.events.length||ab.ledger.enabled||ab.ledger.events.length||ab.ledger.serial!==0||ab.serial!==0||ab.events.length)fail('__NO_EVIDENCE_LEDGER did not expose an empty disabled ledger');if(aa.stateSignature!==sa||aa.stateDigest!==sa||ab.stateSignature!==sb||ab.stateDigest!==sb||aa.stateSignature!==ab.stateSignature)fail('ambient signature aliases did not preserve the existing full signature');
}

console.log('2) generated floors are connected, seeded, and structurally varied');
{
  const layouts=new Set(),shortcuts=new Set(),straights=[],branches=[];
  for(let i=0;i<24;i++){const game=bootGame('dungeon-express',{seed:0xdd100+i*97}),q=game.sandbox.__dungeonExpressLayoutFixture();
    if(!q.finite||q.rooms.length!==6||q.edges.length!==7||q.edges.filter(e=>e.shortcut).length!==1)fail(`seed ${i}: malformed six-room dungeon`);
    layouts.add(q.grid+'|'+q.edges.map(e=>`${e.x},${e.y}`).join(';'));shortcuts.add(q.edges.find(e=>e.shortcut).id);straights.push(longestStraight(q.grid));branches.push(q.rooms.filter(room=>q.edges.filter(e=>e.a===room.id||e.b===room.id).length>=3).length);
  }
  console.log(`  ${layouts.size}/24 layout signatures; ${shortcuts.size}/7 shortcut positions; ${Math.min(...branches)} branches; straight ${Math.min(...straights)}..${Math.max(...straights)}`);
  if(layouts.size<16||shortcuts.size<6||Math.min(...branches)<2||Math.max(...straights)>9)fail('seed panel did not preserve authored choices and bounded traversals');
  if(!noVisiblePath)fail('computed route, breadcrumb, or execution trail regained a renderer/probe surface');
}

console.log('3) both sigil orders solve the actual room dependency without RNG drift');
{
  for(const kind of['tool','key'])for(const order of[[0,1],[1,0]]){const control=bootGame('dungeon-express',{seed:0xdd180}),game=bootGame('dungeon-express',{seed:0xdd180}),result=game.sandbox.__dungeonExpressSolveOrderFixture(kind,order),next=game.sandbox.__dungeonExpressNextRandom(),expected=control.sandbox.__dungeonExpressNextRandom();
    console.log(`  ${kind} ${order.join('→')} => ${result&&result.solution}, ${result&&result.transitionDelta} transitions`);
    if(!result||!result.solved||result.first!==order[0]||result.transitionDelta!==2||result.completionDelta!==1)fail(`${kind} order ${order.join(',')} did not solve through two real state changes`);if(next!==expected)fail(`${kind} order fixture consumed engine RNG`)}
}

console.log('4) private route planner is repeatable and consumes no engine RNG');
{
  const control=bootGame('dungeon-express',{seed:0xdd200}),planned=bootGame('dungeon-express',{seed:0xdd200}),one=planned.sandbox.__dungeonExpressPlanPreview(),two=planned.sandbox.__dungeonExpressPlanPreview();
  const rp=planned.sandbox.__dungeonExpressNextRandom(),rc=control.sandbox.__dungeonExpressNextRandom();
  console.log(`  repeat ${JSON.stringify(one)===JSON.stringify(two)}; path ${one.path.length}; next RNG ${rp.toFixed(8)}/${rc.toFixed(8)}`);
  if(JSON.stringify(one)!==JSON.stringify(two)||!one.target||!one.path.length)fail('same-state route preview was not repeatable and useful');
  if(rp!==rc)fail('route planning consumed engine RNG for simulation-invisible work');
}

console.log('5) route-memory A/B: ten paired two-minute seeds beat cautious rechecking');
{
  const smart=[],baseline=[];let wins=0;
  for(let i=0;i<10;i++){const seed=0xde300+i*137,a=bootGame('dungeon-express',{seed,footer:FOOTER}),b=bootGame('dungeon-express',{seed,footer:FOOTER});
    b.sandbox.__NO_ROUTE_MEMORY=1;a.sandbox.__dungeonExpressReset();b.sandbox.__dungeonExpressReset();a.frames(7200,false);b.frames(7200,false);const pa=a.sandbox.__dungeonExpressProbe(),pb=b.sandbox.__dungeonExpressProbe();smart.push(pa);baseline.push(pb);if(relayScore(pa)>relayScore(pb))wins++;
    inBands(pa,POLICY_BANDS,`seed ${seed.toString(16)} memory`);inBands(pb,POLICY_BANDS,`seed ${seed.toString(16)} cautious`);
    const arc=splitArc(pa);if(!pa.finite||!pb.finite)fail(`seed ${seed.toString(16)} became non-finite`);if(pb.stats.detourRooms<10)fail(`seed ${seed.toString(16)} baseline stopped reaching verification rooms`);if(pa.stats.memoryCuts<2||pb.stats.memoryCuts!==0)fail(`seed ${seed.toString(16)} actual shortcut-memory contract regressed`);if(arc.triples.length<4||arc.improved<4||arc.ratio<2.1)fail(`seed ${seed.toString(16)} scout-to-speedrun split compression regressed: ${JSON.stringify(arc)}`);
    console.log(`  ${seed.toString(16)} memory ${pa.stats.laps} laps/${pa.stats.distance} steps/${pa.stats.memoryCuts} cuts (${arc.improved}/${arc.triples.length}, ${arc.ratio.toFixed(2)}x) vs cautious ${pb.stats.laps}/${pb.stats.distance}/${pb.stats.detourRooms} checks`);
  }
  const scoreA=smart.reduce((n,p)=>n+relayScore(p),0),scoreB=baseline.reduce((n,p)=>n+relayScore(p),0),laps=[sum(smart,'laps'),sum(baseline,'laps')],floors=[sum(smart,'floors'),sum(baseline,'floors')];
  console.log(`  ${wins}/10 score wins; laps ${laps[0]}/${laps[1]}, floors ${floors[0]}/${floors[1]}, aggregate ${scoreA}/${scoreB}`);
  if(wins<8||laps[0]<laps[1]*1.08||floors[0]<floors[1]*1.08||scoreA<scoreB*1.08)fail('route memory did not deliver a clear paired win');
}

console.log('6) environmental ward act changes the body before its exact warning lands');
{
  const a=bootGame('dungeon-express',{seed:0xdd300}),b=bootGame('dungeon-express',{seed:0xdd300});a.sandbox.__dungeonExpressActFixture();b.sandbox.__dungeonExpressActFixture();b.sandbox.__NO_ACTS=1;
  if(a.sandbox.__dungeonExpressPhysicalSignature()!==b.sandbox.__dungeonExpressPhysicalSignature())fail('act pair did not start physically identical');let first=-1,phase='';
  for(let frame=1;frame<=250;frame++){a.frames(1,false);b.frames(1,false);if(first<0&&a.sandbox.__dungeonExpressPhysicalSignature()!==b.sandbox.__dungeonExpressPhysicalSignature()){first=frame;phase=a.sandbox.__dungeonExpressProbe().act.phase}}
  const pa=a.sandbox.__dungeonExpressProbe(),pb=b.sandbox.__dungeonExpressProbe(),warn=pa.actNotes.find(n=>n.kind==='act-warning'),land=pa.actNotes.find(n=>n.kind==='act-land');
  console.log(`  first physical divergence ${first}f in ${phase}; warning ${warn&&land?land.at-warn.at:'?'}f`);
  if(first<0||first>=240||phase!=='warn')fail('bot body did not move onto a revised line before the ward landed');if(!warn||!land||warn.edgeId<0||land.edgeId<0||land.at-warn.at!==240||land.tag-warn.tag!==240)fail('act warning lacked a gate or was not exactly 240 viewer and simulation frames');if(pb.actNotes.length)fail('__NO_ACTS still emitted notes');
}

console.log('7) enemy-agency A/B forces a pre-contact response while baseline still plays');
{
  const live=bootGame('dungeon-express',{seed:0xdd350}),simple=bootGame('dungeon-express',{seed:0xdd350});simple.sandbox.__NO_ENEMY_AI=1;live.sandbox.__dungeonExpressEnemyFixture();simple.sandbox.__dungeonExpressEnemyFixture();if(live.sandbox.__dungeonExpressPhysicalSignature()!==simple.sandbox.__dungeonExpressPhysicalSignature())fail('enemy A/B fixture did not start physically identical');let first=-1,response=-1,responseMoved=false,state='';
  for(let frame=1;frame<=80;frame++){live.frames(1,false);simple.frames(1,false);const p=live.sandbox.__dungeonExpressProbe();if(response<0&&p.stats.playerResponses>0){response=frame;responseMoved=p.hero.move>0&&p.stats.dodges>0}if(first<0&&live.sandbox.__dungeonExpressPhysicalSignature()!==simple.sandbox.__dungeonExpressPhysicalSignature()){first=frame;state=p.enemies.find(e=>e.state==='TELL'||e.state==='CHARGE'||e.state==='INTERCEPT')?.state||''}}
  console.log(`  controlled divergence ${first}f in ${state}; moving hero response ${response}f`);if(first<0||first>6||state!=='TELL'||response<0||response>30||!responseMoved)fail('live guard did not force a displaced response during its tell window');if(simple.sandbox.__dungeonExpressProbe().stats.playerResponses!==0)fail('__NO_ENEMY_AI baseline fabricated a tactical response');
  const blocked=bootGame('dungeon-express',{seed:0xdd351}).sandbox.__dungeonExpressBlockedResponseFixture();console.log(`  blocked lane => ${blocked.intent.target}, response ${blocked.responseDelta}, dodge ${blocked.dodgeDelta}, brace ${blocked.braceDelta}`);if(!blocked.intent.target.startsWith('brace:')||blocked.move!==0||blocked.responseDelta!==1||blocked.dodgeDelta!==0||blocked.braceDelta!==1||blocked.art!=='brace')fail(`blocked response fabricated a dodge: ${JSON.stringify(blocked)}`);
  let liveHits=0,simpleHits=0;for(let i=0;i<6;i++){const seed=0xdac00+i*149,a=bootGame('dungeon-express',{seed}),b=bootGame('dungeon-express',{seed});b.sandbox.__NO_ENEMY_AI=1;a.sandbox.__dungeonExpressReset();b.sandbox.__dungeonExpressReset();a.frames(7200,false);b.frames(7200,false);const pa=a.sandbox.__dungeonExpressProbe(),pb=b.sandbox.__dungeonExpressProbe();liveHits+=pa.stats.hits;simpleHits+=pb.stats.hits;console.log(`  ${seed.toString(16)} live ${pa.stats.dodges} dodges+${pa.stats.braces} braces/${pa.stats.nearMisses} near/${pa.stats.hits} hits vs simple ${pb.stats.laps} laps/${pb.stats.hits} hits`);if(pa.stats.enemyTells<20||pa.stats.enemyActions<20||pa.stats.playerResponses<20||pa.stats.dodges<20||pa.stats.counters<15||pa.stats.dodges+pa.stats.braces!==pa.stats.playerResponses)fail(`seed ${seed.toString(16)} live agency/response density regressed`);if(pb.stats.playerResponses!==0||pb.stats.dodges!==0||pb.stats.braces!==0||pb.stats.floors<3||pb.stats.laps<9||pb.stats.enemyActions<20)fail(`seed ${seed.toString(16)} simple baseline stopped being active and capable`)}
  if(liveHits>simpleHits*.65)fail(`readable tells did not materially reduce hits: ${liveHits}/${simpleHits}`);console.log(`  aggregate hits ${liveHits}/${simpleHits}`);
}

console.log('8) human and bot share one seven-field intent and applyIntent path');
{
  const game=bootGame('dungeon-express',{seed:0xdd400,footer:FOOTER}),schema=game.sandbox.__dungeonExpressIntentFixture();if(schema.botKeys.join('|')!==schema.humanKeys.join('|'))fail(`intent schemas differ: ${JSON.stringify(schema)}`);
  const before=game.sandbox.__dungeonExpressProbe();press(game,'Enter');const instructions=game.sandbox.__engine.sessionProbe();press(game,'Enter');const playingState=game.sandbox.__engine.sessionProbe();game.frames(40,false);game.sandbox.__deClearApplied();game.key('keydown','ArrowRight');game.key('keydown','Space');game.frames(1,false);const applied=game.sandbox.__deLastApplied();game.key('keyup','ArrowRight');game.key('keyup','Space');
  console.log(`  schema ${schema.humanKeys.join(',')}; session ${before.showFrame}/${instructions.mode}/${playingState.mode}; applied ${JSON.stringify(applied)}`);
  if(instructions.mode!=='instructions'||playingState.mode!=='playing')fail('manual session skipped the two-Enter gate');if(!applied||applied.dx!==1||!applied.attack||applied.tactic!=='MANUAL RELAY')fail('manual intent did not traverse runtime applyIntent');
}

console.log('9) three ten-minute soaks: authored decisions, bounded dead air, and cinematic progress');
for(const seed of[0xdf010,0xdf011,0xe7015]){
  const{game,samples}=runSoak('dungeon-express',{seed,minutes:10,footer:FOOTER}),report=analyzeSoak(samples),p=game.sandbox.__dungeonExpressProbe(),show=p.show,offered=show.offeredByTier,shown=show.shownByTier,s3=shown[3]||0;
  console.log(`  ${seed.toString(16)} ${soakLine(report)}; ${p.stats.puzzleTransitions} puzzle/${p.stats.enemyTells} tells/${p.stats.playerResponses} responses/${p.stats.nearMisses} near; dead air ${p.stats.maxDecisionDeadAir}f; ${p.stats.laps} laps/${p.stats.floors} floors`);
  assertSoak(seed.toString(16),report,{still:3,quiet:9,stall:8,minEvents:1350,minProgress:450},fail);inBands(p,SOAK_BANDS,`seed ${seed.toString(16)} soak`);notePairs(p,seed.toString(16),8);
  const layout=game.sandbox.__dungeonExpressLayoutFixture(),expectedEntertainment=entertainmentEvidence(p,layout),ambient=game.sandbox.__ambientProbe(),derived=validateNaturalEvidence(`seed ${seed.toString(16)}`,ambient,p);
  if(ambient.protocol!==evidence.PROTOCOL||ambient.schema!==1||ambient.game!=='dungeon-express'||ambient.frame.run!==p.runFrame||ambient.frame.show!==p.showFrame||ambient.showFrame!==p.showFrame||ambient.runFrame!==p.runFrame||!ambient.finite)fail(`seed ${seed.toString(16)}: ambient envelope drifted`);const stateSignature=game.sandbox.__dungeonExpressSignature();if(ambient.stateSignature!==stateSignature||ambient.stateDigest!==stateSignature)fail(`seed ${seed.toString(16)}: ambient state signature aliases are not the existing full signature`);if(JSON.stringify(ambient.soak)!==JSON.stringify(game.sandbox.__soakProbe())||JSON.stringify(ambient.motion)!==JSON.stringify(game.sandbox.__motionProbe()))fail(`seed ${seed.toString(16)}: ambient probe changed existing soak/motion adapters`);if(JSON.stringify(ambient.evidence)!==JSON.stringify(expectedEntertainment)||JSON.stringify(ambient.entertainment)!==JSON.stringify(expectedEntertainment)||JSON.stringify(ambient.topology)!==JSON.stringify(expectedEntertainment.topology))fail(`seed ${seed.toString(16)}: ambient entertainment changed exact source strings or topology`);if(JSON.stringify(ambient.counters)!==JSON.stringify(p.stats)||ambient.serial!==ambient.ledger.serial||JSON.stringify(ambient.events)!==JSON.stringify(ambient.ledger.events))fail(`seed ${seed.toString(16)}: canonical counter/serial/event aliases drifted from authoritative probes`);if(derived&&derived.payoffs!==p.stats.payoffs)fail(`seed ${seed.toString(16)}: derived payoff count ${derived.payoffs} != stats.payoffs ${p.stats.payoffs}`);
  assertEntertainment(seed.toString(16),expectedEntertainment,{minRooms:6,minBranches:2,maxStraight:9,minPuzzleTransitions:105,minPuzzleCompletions:42,minEnemyActions:165,minPlayerResponses:155,requiredDecisionKinds:['puzzle','threat','response','combat','payoff'],minPerDecisionKind:100,maxDeadAir:280,deadAirUnit:'tactical frames'},fail);
  const decisionMarks=p.stats.puzzleTransitions+p.stats.puzzleCompletions+p.stats.enemyTells+p.stats.enemyActions+p.stats.playerResponses+p.stats.nearMisses+p.stats.counters+p.stats.combatBeats+p.stats.payoffs+p.stats.reversals+p.stats.lapses;if(p.stats.events>decisionMarks)fail(`seed ${seed.toString(16)} event stream double-counted beats: ${p.stats.events} events > ${decisionMarks} decisions`);
  if(p.stats.puzzleCompletions<p.stats.keys+p.stats.tools-1||p.stats.puzzleTransitions<p.stats.puzzleCompletions*2+p.stats.shortcuts-2)fail(`seed ${seed.toString(16)} item collection bypassed the two-stage room dependency`);if(p.stats.leftSolutions<8||p.stats.rightSolutions<8)fail(`seed ${seed.toString(16)} did not naturally exercise both sigil orders`);
  if(!((offered[1]||0)>(offered[2]||0)&&(offered[2]||0)>(offered[3]||0)&&(offered[3]||0)>=21))fail(`seed ${seed.toString(16)} offered tiers not ordered ${JSON.stringify(offered)}`);
  if(!((shown[1]||0)>(shown[2]||0)&&(shown[2]||0)>(shown[3]||0)&&(shown[3]||0)>=21))fail(`seed ${seed.toString(16)} shown tiers not ordered ${JSON.stringify(shown)}`);
  if(show.heldFrames!==6*s3)fail(`seed ${seed.toString(16)} apex hold ${show.heldFrames} != 6*${s3}`);if(show.slowedFrames!==24*s3)fail(`seed ${seed.toString(16)} apex slow ${show.slowedFrames} != 24*${s3}`);if(show.admireFrames!==48*s3)fail(`seed ${seed.toString(16)} apex admire ${show.admireFrames} != 48*${s3}`);
}
{
  const game=bootGame('dungeon-express',{seed:0xdf012}),admire=game.sandbox.__dungeonExpressAdmireFixture();if(admire.admired.tactic!=='SALUTE THE SPLIT'||admire.gated.tactic==='SALUTE THE SPLIT')fail(`__NO_ADMIRE did not gate the bot pause: ${JSON.stringify(admire)}`);
  game.sandbox.__NO_LAPSE=1;game.sandbox.__dungeonExpressReset();game.frames(36000,false);if(game.sandbox.__dungeonExpressProbe().stats.lapses!==0)fail('__NO_LAPSE still produced a lapse');
}

console.log('10) shared motion contract rejects dead standing and measures physical pace');
for(const seed of[0xd001,0xd002,0xd003]){
  const run=runMotion('dungeon-express',{seed,footer:FOOTER,minutes:12000/3600,sampleEvery:5}),report=analyzeMotion(run,{stillRadius:2,emoteFrames:120,emoteShare:.15,requiredIds:['hero']}),p=run.game.sandbox.__dungeonExpressProbe(),pace=p.stats.distance/12000,heroSamples=run.samples.map(sample=>sample.actors.find(actor=>actor.id==='hero')).filter(Boolean);let movingPairs=0,physicalPairs=0,physicalDistance=0;for(let i=1;i<heroSamples.length;i++){const dx=heroSamples[i].x-heroSamples[i-1].x,dy=heroSamples[i].y-heroSamples[i-1].y,d=Math.hypot(dx,dy);if(d>25)continue;physicalPairs++;if(d>.5){movingPairs++;physicalDistance+=d}}const movingShare=physicalPairs?movingPairs/physicalPairs:0,meanCarry=movingPairs?physicalDistance/movingPairs:0;console.log(`  ${seed.toString(16)} ${motionLine(report)}, pace ${pace.toFixed(3)} cells/f, moving ${(movingShare*100).toFixed(1)}%, carry ${meanCarry.toFixed(2)}px`);assertMotion(seed.toString(16),report,fail);if(pace<.075||movingShare<.28||meanCarry<2.5)fail(`seed ${seed.toString(16)} momentum regressed: pace ${pace.toFixed(3)}, moving ${movingShare.toFixed(3)}, carry ${meanCarry.toFixed(2)}px`)
}

console.log('11) payoff FX is a perfect same-seed simulation no-op');
{
  const a=bootGame('dungeon-express',{seed:0xdd500}),b=bootGame('dungeon-express',{seed:0xdd500});b.sandbox.__NO_PAYOFF_FX=1;a.frames(4200,false);b.frames(4200,false);const same=a.sandbox.__dungeonExpressSignature()===b.sandbox.__dungeonExpressSignature(),p=a.sandbox.__dungeonExpressProbe();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} through ${p.stats.laps} laps/${p.stats.floors} apexes`);if(!same)fail('__NO_PAYOFF_FX changed simulation state');if(p.stats.floors<2)fail('FX parity did not cross enough apex payoffs');
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
