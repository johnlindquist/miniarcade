#!/usr/bin/env node
/* Meat Lad generation + progression eval.
 *
 * Run:  node evals/meatlad-eval.js   (from the here-now directory)
 *
 * Asserts three invariants and exits non-zero if any fails:
 *  1. TILE INDEX — packed numeric keys round-trip negative world rows and
 *     the row masks used by collision stay synchronized with the tile set.
 *  2. SOLVABILITY — for difficulty levels 1..40, every generated hop is
 *     completable, proven with the same physics simulator the runtime AI
 *     uses for its jump planning (hopSolvable).
 *  3. PROGRESS — full 10-minute AI runs never stall: the longest window
 *     without (level, node) progress stays under 25 seconds, and the AI
 *     still clears a healthy number of levels as difficulty ramps.
 *
 * Runs are deterministic. Override the default with --seed N or
 * MEATLAD_EVAL_SEED=N; the printed seed replays the complete eval exactly.
 */
'use strict';
const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(dir,'meatlad.html'),'utf8');
let src=html.split('<script>')[1].split('</script>')[0];
src=fs.readFileSync(path.join(dir,'engine.js'),'utf8')+'\n'+src;

function hashSeed(raw){
  const text=String(raw);
  if(/^(?:0x[\da-f]+|\d+)$/i.test(text))return Number(text)>>>0;
  let h=2166136261;
  for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);
  return h>>>0;
}
function requestedSeed(){
  const eq=process.argv.find(a=>a.startsWith('--seed='));
  const at=process.argv.indexOf('--seed');
  if(at>=0&&process.argv[at+1]===undefined){
    console.error('Missing value after --seed');process.exit(2);
  }
  return hashSeed(eq?eq.slice(7):(at>=0?process.argv[at+1]:(process.env.MEATLAD_EVAL_SEED||0x4d454154)));
}
function deriveSeed(base,label){
  let h=(base^2166136261)>>>0;
  for(let i=0;i<label.length;i++)h=Math.imul(h^label.charCodeAt(i),16777619);
  return h>>>0;
}
function seededRandom(seed){
  let a=seed>>>0;
  return()=>{
    a=(a+0x6d2b79f5)|0;
    let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);
    return((t^(t>>>14))>>>0)/4294967296;
  };
}
const seed=requestedSeed();
console.log(`seed: ${seed} (replay: node evals/meatlad-eval.js --seed ${seed})`);

function boot(runSeed){ // fresh dom-stubbed game instance
  Math.random=seededRandom(runSeed);
  const ctx=new Proxy({},{get:(t,p)=>p==='measureText'?()=>({width:10}):()=>{},set:()=>true});
  const canvas={getContext:()=>ctx,width:320,height:720};
  global.document={getElementById:()=>canvas};
  global.requestAnimationFrame=f=>{global.__cb=f;};
  const footer=`
;globalThis.__tileCheck=()=>{
  clearSolids();
  const cells=[[0,-4097],[7,-1],[19,0],[3,2048]];
  for(const [x,y] of cells)addSolid(x,y);
  const roundTrips=cells.every(([x,y])=>{const k=key(x,y);return keyX(k)===x&&keyY(k)===y&&solid(x,y);});
  const absent=!solid(1,-4097)&&!solid(6,-1)&&!solid(18,0)&&!solid(4,2048);
  const middle=key(7,-1);deleteSolidKey(middle);
  const deletion=!solids.has(middle)&&!solid(7,-1)&&cells.filter(c=>c[0]!==7||c[1]!==-1).every(c=>solid(c[0],c[1]));
  clearSolids();
  return{ok:roundTrips&&absent&&deletion&&solids.size===0&&solidRows.size===0};
};
;globalThis.__solvCheck=(L)=>{
  clearSolids();bouncy.clear();icy.clear();spiky.clear();
  saws=[];stains=[];bandages=[];items=[];level=L;
  const base={tx:7,ty:0,w:6};
  plat(base.tx,base.ty,base.w);plat(5,1,10);plat(3,2,14);
  nodes=genLevel(base);
  let bad=0;
  for(let i=0;i+1<nodes.length;i++){
    const a=nodes[i],b=nodes[i+1];
    if(a.type==='ch'||b.via==='pad')continue;
    if(!hopSolvable(a,b))bad++;
  }
  return{nodes:nodes.length,saws:saws.length,bad};
};
globalThis.__probe=()=>({lvl:level,prog:level*1000+(P.best||0),idx:P.idx,best:P.best||0,nodeCount:nodes.length,deaths,
  x:P.x,y:P.y,vx:P.vx,vy:P.vy,onGround:P.onGround,rescueIntent:P.rescueIntent||0,
  finite:[P.x,P.y,P.vx,P.vy,camY].every(Number.isFinite),streak:deathStreak?{...deathStreak}:null,
  rescue:rescue?{level:rescue.level,from:rescue.from,to:rescue.to,state:rescue.state,forceUse:rescue.forceUse,
    x:rescue.x,y:rescue.y,launchVx:rescue.launchVx,launchVy:rescue.launchVy,contacts:rescue.contacts,
    fromTy:nodes[rescue.from]&&nodes[rescue.from].ty,targetTy:nodes[rescue.to]&&nodes[rescue.to].ty}:null,
  rescueStats:{...rescueStats}});
globalThis.__showP=()=>SHOW.probe();
globalThis.__sig=()=>Math.round(P.x*31+P.y*7)+level*1009+deaths*97+bandCt*17+
  rescueStats.spawns*19+rescueStats.contacts*23+rescueStats.landings*29;
globalThis.__rescueFixture=()=>{
  clearSolids();bouncy.clear();icy.clear();spiky.clear();saws=[];stains=[];bandages=[];items=[];
  level=7;deaths=0;deathStreak=null;rescue=null;for(const k in rescueStats)rescueStats[k]=typeof rescueStats[k]==='string'?'':0;
  nodes=[{tx:7,ty:0,w:6,err:0},{tx:14,ty:-2,w:4,err:0},{tx:8,ty:-4,w:4,err:0}];
  plat(7,0,6);plat(14,-2,4);plat(8,-4,4);girl={n:nodes[2],t:0,gone:false};placeAt(nodes[0]);P.onGround=true;camY=-230;
  return globalThis.__probe();
};
globalThis.__fixtureDie=c=>{die(c);return globalThis.__probe();};
globalThis.__fixtureLand=j=>{const n=nodes[j];P.x=(n.tx+n.w/2)*T;P.y=n.ty*T-3.01;P.onGround=true;commitPhysicalLanding(j);return globalThis.__probe();};
globalThis.__fixtureForce=()=>{if(rescue){rescue.state='armed';rescue.armT=0;rescue.forceUse=true;}return globalThis.__probe();};
globalThis.__fixtureWatchdog=()=>{const n=nodes[1];n.stuckT=421;n.rescues=2;P.onGround=true;P.stall=0;think();return globalThis.__probe();};
globalThis.__fixtureReset=()=>{resetGame();return globalThis.__probe();};
globalThis.__rescueFinalFixture=()=>{globalThis.__rescueFixture();nodes=nodes.slice(0,2);girl={n:nodes[1],t:0,gone:false};return globalThis.__probe();};
globalThis.__generatedPadFixture=()=>{const before=rescueStats.contacts;clearSolids();bouncy.clear();addSolid(7,0);bouncy.add(key(7,0));
  P.x=7.5*T;P.y=-5;P.vx=0;P.vy=2;P.onGround=false;P.bounceCt=0;rescue=null;physStep(P,0,0);
  return{vy:P.vy,bounceCt:P.bounceCt,rescueContactsUnchanged:rescueStats.contacts===before};};
globalThis.__fixtureStep=()=>{frame++;if(rescue){if(rescue.compress>0)rescue.compress--;if(rescue.state==='arming'&&--rescue.armT<=0)rescue.state='armed';if(rescue.state==='retiring'&&--rescue.retireT<=0)rescue=null;}think();hazards();return globalThis.__probe();};`;
  eval(src.replace(/'use strict';/g,'')+footer);
}
function runFrames(n){let t=0;for(let i=0;i<n;i++){const f=global.__cb;global.__cb=null;f(t+=1000/60);}}

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};

// ---- 1. packed tile index preserves negative rows and row-mask integrity
console.log('1) packed tile index');
boot(deriveSeed(seed,'tile-index'));
const tileCheck=globalThis.__tileCheck();
if(!tileCheck.ok)fail('packed keys or collision row masks lost synchronization');
else console.log('  OK: negative rows round-trip and row masks track add/delete/clear');

// ---- 2. repeated deaths offer an optional physical rescue, never progress
console.log('2) rescue checkpoint invariant and choice fixture');
boot(deriveSeed(seed,'rescue-fixture'));
globalThis.__rescueFixture();
let r=globalThis.__fixtureDie('saw');
if(r.idx!==0||r.best!==0||r.lvl!==7||r.rescue||!r.streak||r.streak.count!==1)
  fail(`first death changed checkpoint or spawned early (${JSON.stringify(r)})`);
r=globalThis.__fixtureDie('fall');
if(r.idx!==0||r.best!==0||r.lvl!==7||!r.rescue||r.streak.count!==2)
  fail(`second same-hop death did not arm rescue without progress (${JSON.stringify(r)})`);
else console.log(`  same hop, different causes: ${r.rescue.state} pad at ${r.rescue.x.toFixed(1)},${r.rescue.y.toFixed(1)}; checkpoint 0`);
// The available pad must remain optional: the normal controller gets a full try.
for(let i=0;i<900;i++)globalThis.__fixtureStep();r=globalThis.__probe();
if(r.rescueStats.contacts!==0||r.rescueStats.normalClears<1||r.best<1)
  fail(`normal route did not clear while ignoring the rescue (${JSON.stringify(r)})`);
// Force the exact same prop on a fresh fixture and require contact then real landing.
globalThis.__rescueFixture();globalThis.__fixtureDie('saw');globalThis.__fixtureDie('fall');globalThis.__fixtureDie('stall');globalThis.__fixtureForce();
let sawContact=false,landed=false,contactCheckpointClean=true;
for(let i=0;i<1200&&!landed;i++){const p=globalThis.__fixtureStep();
  if(!sawContact&&p.rescueStats.contacts>0)contactCheckpointClean=p.idx===0&&p.best===0&&p.lvl===7;
  sawContact=sawContact||p.rescueStats.contacts>0;landed=p.rescueStats.landings>0&&p.best>=1;}
r=globalThis.__probe();
if(!sawContact||!landed||!contactCheckpointClean||r.rescueStats.contacts!==1)
  fail(`forced Plan B did not produce one contact and physical landing (${JSON.stringify(r)})`);
else console.log(`  forced Plan B: ${r.rescueStats.contacts} contact, ${r.rescueStats.landings} physical landing`);
// A new obstacle starts a new streak; watchdog escalation may arm help but not warp.
globalThis.__rescueFixture();globalThis.__fixtureDie('saw');globalThis.__fixtureDie('fall');globalThis.__fixtureLand(1);r=globalThis.__fixtureDie('spike');
if(!r.streak||r.streak.from!==1||r.streak.to!==2||r.streak.count!==1||r.idx!==1||r.best!==1)
  fail(`different obstacle inherited progress/streak (${JSON.stringify(r)})`);
globalThis.__rescueFixture();r=globalThis.__fixtureWatchdog();
if(r.idx!==0||r.best!==0||r.lvl!==7||!r.rescue||!r.rescue.forceUse)
  fail(`watchdog still advanced progress instead of forcing Plan B (${JSON.stringify(r)})`);
// A final-node rescue may clear only after the authored arc lands on that node.
globalThis.__rescueFinalFixture();globalThis.__fixtureDie('saw');globalThis.__fixtureDie('fall');globalThis.__fixtureDie('stall');globalThis.__fixtureForce();
let contactLevel=0,landingLevel=0;
for(let i=0;i<300&&!landingLevel;i++){const p=globalThis.__fixtureStep();if(!contactLevel&&p.rescueStats.contacts)contactLevel=p.lvl;if(p.rescueStats.landings)landingLevel=p.lvl;}
if(contactLevel!==7||landingLevel!==8)fail(`final rescue cleared before physical landing (${contactLevel} -> ${landingLevel})`);
const pad=globalThis.__generatedPadFixture();
if(pad.vy!==-5.2||pad.bounceCt!==1||!pad.rescueContactsUnchanged)fail(`generated pad contract changed (${JSON.stringify(pad)})`);
r=globalThis.__fixtureReset();if(r.rescue||r.streak)fail('resetGame retained rescue or death streak');

// ---- 3. solvability sweep across the difficulty curve
console.log('3) solvability sweep: 40 difficulty levels x 25 generations');
boot(deriveSeed(seed,'solvability'));
const ramp=[];
for(let L=1;L<=40;L++){
  let bad=0,sawSum=0,nodeSum=0;
  for(let g=0;g<25;g++){
    const r=globalThis.__solvCheck(L);
    bad+=r.bad;sawSum+=r.saws;nodeSum+=r.nodes;
  }
  ramp.push({L,saws:+(sawSum/25).toFixed(1),nodes:+(nodeSum/25).toFixed(1)});
  if(bad>0)fail(`level ${L}: ${bad} unsolvable hops across 25 generations`);
}
console.log('  ramp (avg per level):',
  [1,5,10,20,40].map(L=>{const r=ramp[L-1];return `L${L}: ${r.nodes}n/${r.saws}s`;}).join('  '));
if(!failed)console.log('  OK: 1000 generated levels, every hop provably completable');

// ---- 3. long-run progress: no stalls, difficulty stays playable
console.log('4) progress runs: 3 x 10 simulated minutes');
let naturalSpawns=0,naturalContacts=0,naturalLandings=0,naturalNormal=0;
for(let run=1;run<=3;run++){
  boot(deriveSeed(seed,`progress-${run}`));
  let bestSeen=-1,stall=0,maxStall=0,t=0;
  for(let i=1;i<=36000;i++){
    const f=global.__cb;global.__cb=null;f(t+=1000/60);
    const p=globalThis.__probe();
    if(p.prog>bestSeen){stall=0;bestSeen=p.prog;}
    else{stall++;if(stall>maxStall)maxStall=stall;}
  }
  const end=globalThis.__probe();
  console.log(`  run ${run}: level ${end.lvl}, deaths ${end.deaths}, worst stall ${(maxStall/60).toFixed(1)}s, `+
    `springs ${end.rescueStats.spawns}/${end.rescueStats.contacts}/${end.rescueStats.landings}, `+
    `placeFail ${end.rescueStats.placementFails} streak ${end.rescueStats.maxStreak}, normal ${end.rescueStats.normalClears}, `+
    `flight deaths ${end.rescueStats.flightDeaths}:${end.rescueStats.lastFlightCause||'-'} `+
    `ground ${end.rescueStats.lastFlightRow}@${(+end.rescueStats.lastFlightX).toFixed(1)} `+
    `at ${end.idx}/${end.best}/${end.nodeCount} streak ${end.streak?`${end.streak.from}->${end.streak.to}:${end.streak.count}`:'-'} `+
    `rescue ${end.rescue?`${end.rescue.state}:${end.rescue.from}->${end.rescue.to}:${end.rescue.forceUse}`:'-'}`);
  naturalSpawns+=end.rescueStats.spawns;naturalContacts+=end.rescueStats.contacts;
  naturalLandings+=end.rescueStats.landings;naturalNormal+=end.rescueStats.normalClears;
  if(!end.finite)fail(`run ${run}: non-finite player/camera state`);
  if(end.rescueStats.contacts!==end.rescueStats.landings)fail(`run ${run}: ${end.rescueStats.contacts} contacts but ${end.rescueStats.landings} landings`);
  if(end.rescueStats.placementFails)fail(`run ${run}: ${end.rescueStats.placementFails} rescue placement failures`);
  if(maxStall>1500)fail(`run ${run}: stalled ${(maxStall/60).toFixed(1)}s (limit 25s)`);
  if(end.lvl<20)fail(`run ${run}: only reached level ${end.lvl} in 10 min (limit 20)`);
}
if(!naturalSpawns||!naturalContacts||!naturalLandings||!naturalNormal)
  fail(`natural runs missed rescue choice sequence (${naturalSpawns}/${naturalContacts}/${naturalLandings}, normal ${naturalNormal})`);

// ---- 4. payoff ladder: rescues celebrated with exact apex budgets, fx sim-inert
console.log('5) show ladder: rescues celebrated, apex budgets exact, fx sim-inert');
{
  boot(deriveSeed(seed,'ladder'));
  runFrames(18000);
  const p=globalThis.__showP(),o=p.offeredByTier,s3=p.shownByTier[3]||0;
  console.log(`  tiers ${JSON.stringify(o)}, rescues ${s3} shown `+
    `(held ${p.heldFrames}f, slowed ${p.slowedFrames}f), level ${globalThis.__probe().lvl}`);
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=3))fail(`ladder not strictly ordered (${JSON.stringify(o)})`);
  if(p.heldFrames!==6*s3)fail(`rescue hitstop ${p.heldFrames}f != 6f per rescue (${s3})`);
  if(p.slowedFrames>24*s3)fail(`slow-mo overspent: ${p.slowedFrames}f for ${s3} rescues (budget 24f each)`);
  boot(deriveSeed(seed,'fx'));runFrames(10800);const sigA=globalThis.__sig();
  globalThis.__NO_PAYOFF_FX=1;
  boot(deriveSeed(seed,'fx'));runFrames(10800);const sigB=globalThis.__sig();
  delete globalThis.__NO_PAYOFF_FX;
  if(sigA!==sigB)fail('__NO_PAYOFF_FX changed the sim: payoff confetti leaked into gameplay');
  else console.log('  __NO_PAYOFF_FX: sim signatures identical over 3 minutes');
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
