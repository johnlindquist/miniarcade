#!/usr/bin/env node
/* Small Guys generation + show-flow eval.
 *
 * Run:  node evals/smallguys-eval.js   (from the here-now directory)
 *
 * Asserts and exits non-zero on failure:
 *  1. GENERATION — door walls always have at least one real door; ladder
 *     courses keep every main-spine hop within bean jump reach.
 *  2. SHOW FLOW — 10-minute AI runs keep crowning winners: episodes keep
 *     completing, nothing stalls longer than 15s, no bean coordinate goes
 *     non-finite.
 */
'use strict';
const{bootGame}=require('./harness');
let game;

function boot(seed){ // fresh deterministic headless game instance
  const footer=`
;globalThis.__wins=0;globalThis.__b0wins=0;globalThis.__finals=0;globalThis.__b0finals=0;
const _wr=winRound;winRound=b=>{globalThis.__wins++;if(b&&b.i===0)globalThis.__b0wins++;_wr(b);};
const _br=buildRound;buildRound=()=>{_br();
  if(type==='final'){globalThis.__finals++;if(beans.some(b=>b.i===0))globalThis.__b0finals++;}};
globalThis.__genCheck=t=>{
  beans=[];for(let i=0;i<10;i++)beans.push(newBean(i));
  plan=[t,t,'final'];round=0;buildRound();
  if(t==='doors'){
    let bad=0;
    for(const f of floors)if(!f.slots.some(s=>s.st==='shut'))bad++;
    return{bad,n:floors.length};
  }
  const mains=plats.filter(p=>p.main);
  let bad=0;
  for(let i=1;i<mains.length;i++){
    const a=mains[i-1],b=mains[i];
    const gap=b.x0>a.x1?b.x0-a.x1:a.x0>b.x1?a.x0-b.x1:0;
    if(b.y!==a.y-24||gap>26)bad++;
  }
  return{bad,n:mains.length};
};
globalThis.__probe=()=>({
  ep:episode,wins:globalThis.__wins,
  bad:beans.some(b=>!isFinite(b.x)||!isFinite(b.y)),
  sig:episode*1e9+round*1e8+{intro:0,play:1,result:2,win:3}[phase]*1e7+qCount*1e5
    +Math.max(0,Math.floor(-Math.min(0,...beans.filter(b=>b.st==='run').map(b=>b.y),0)))
});`;
  game=bootGame('smallguys',{seed,footer});
  return game;
}
const probe=()=>game.sandbox.__probe();

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};

// ---- 1. generation invariants
console.log('1) generation: 200 courses per round type');
boot(0x5a110001);
for(const t of['doors','whirly','slime','final']){
  let bad=0,n=0;
  for(let g=0;g<200;g++){const r=game.sandbox.__genCheck(t);bad+=r.bad;n+=r.n;}
  if(bad>0)fail(`${t}: ${bad} bad rows/walls across 200 generations`);
  else console.log(`  OK: ${t} — ${n} rows, all sound`);
}

// ---- 2. show flow: episodes keep completing, no stalls, bean 0 stays in the show
console.log('2) show flow: 3 x 10 simulated minutes');
let finals=0,b0finals=0,b0wins=0,wins=0;
for(let run=1;run<=3;run++){
  boot(0x5a112000+run);
  let prev=-1,stall=0,maxStall=0,badFrames=0;
  for(let i=1;i<=36000;i++){
    game.frames(1,false);
    const p=probe();
    if(p.bad)badFrames++;
    if(p.sig===prev){stall++;if(stall>maxStall)maxStall=stall;}
    else{stall=0;prev=p.sig;}
  }
  const end=probe(),s=game.sandbox;
  finals+=s.__finals;b0finals+=s.__b0finals;
  wins+=s.__wins;b0wins+=s.__b0wins;
  console.log(`  run ${run}: ${end.wins} crowns (${s.__b0wins} by bean 0), `+
    `bean 0 in ${s.__b0finals}/${s.__finals} finals, worst stall ${(maxStall/60).toFixed(1)}s`);
  if(badFrames>0)fail(`run ${run}: ${badFrames} frames with non-finite bean coords`);
  if(maxStall>900)fail(`run ${run}: stalled ${(maxStall/60).toFixed(1)}s (limit 15s)`);
  if(end.wins<3)fail(`run ${run}: only ${end.wins} episodes crowned in 10 min (limit 3)`);
}
console.log(`  bean 0 overall: ${b0finals}/${finals} finals, ${b0wins}/${wins} crowns`);
if(finals>0&&b0finals/finals<0.55)fail(`bean 0 reached only ${b0finals}/${finals} finals (limit 55%)`);
if(finals>0&&b0wins/finals<0.2)fail(`bean 0 won only ${b0wins}/${finals} episodes (limit 20%)`);

// ---- 3. episode modifiers + show ladder
console.log('3) episode modifiers + show ladder: announced, wired exactly, crown budgets exact');
{
  const ACT_FOOTER=`
;globalThis.__wins=0;
const _wr=winRound;winRound=b=>{globalThis.__wins++;_wr(b);};
globalThis.__notes=[];
{const __n0=SHOW.note;SHOW.note=e=>{globalThis.__notes.push({kind:e.kind,id:e.id,tag:e.tag});return __n0(e);};}
globalThis.__mod=()=>({mod,type,phase,wins:globalThis.__wins,
  maxSpd:sweeps.reduce((m,s)=>Math.max(m,Math.abs(s.spd)),0),slimeV});
globalThis.__showP=()=>SHOW.probe();
globalThis.__modFixture=()=>{
  beans=[];for(let i=0;i<10;i++)beans.push(newBean(i));
  episode=101;plan=['slime','whirly','final'];round=0;buildRound();
  const s={mod,slimeV};
  episode=101;plan=['doors','whirly','final'];round=0;buildRound();
  const d={mod,tLimit};
  return{s,d};
};
globalThis.__sig=()=>Math.round(beans.reduce((a,b2)=>a+b2.x*3+b2.y*7,0))+episode*31337+round*997;`;
  const a=bootGame('smallguys',{seed:0x5a114001,footer:ACT_FOOTER});
  const b=bootGame('smallguys',{seed:0x5a114001,footer:ACT_FOOTER});
  b.sandbox.__NO_ACTS=1;
  let frenzyMax=0,frenzySeen=false,hungryFast=false;
  for(let f=0;f<18000;f+=10){
    a.frames(10,false);b.frames(10,false);
    const g=a.sandbox.__mod();
    if(g.mod==='frenzy'){frenzySeen=true;frenzyMax=Math.max(frenzyMax,g.maxSpd);}
    if(g.mod==='hungry'&&g.slimeV>=0.14)hungryFast=true;
  }
  const notesA=a.sandbox.__notes.filter(e=>e.kind==='modifier'&&e.id!=='none').length;
  const notesB=b.sandbox.__notes.filter(e=>e.kind==='modifier'&&e.id!=='none').length;
  const p=a.sandbox.__showP(),o=p.offeredByTier,s3=p.shownByTier[3]||0;
  const wins=a.sandbox.__mod().wins;
  console.log(`  ${notesA} modified rounds announced (unaware twin ${notesB}), frenzy max spin ${frenzyMax.toFixed(4)}, `+
    `hungry slime seen ${hungryFast}, tiers ${JSON.stringify(o)}, crowns ${wins}/${s3} shown `+
    `(held ${p.heldFrames}f, slowed ${p.slowedFrames}f)`);
  if(notesA<3)fail(`only ${notesA} modified rounds in 5 minutes`);
  if(notesB!==0)fail(`__NO_ACTS run still rolled ${notesB} modifiers`);
  if(!frenzySeen)fail('no FRENZY GEARS round observed in 5 minutes');
  else if(frenzyMax<=0.0345)fail(`frenzy never spun sweeps past the base cap (max ${frenzyMax.toFixed(4)})`);
  if(!hungryFast)fail('no HUNGRY SLIME round reached the boosted rise speed');
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=1))fail(`ladder not strictly ordered (${JSON.stringify(o)})`);
  if(p.heldFrames!==6*s3)fail(`crown hitstop ${p.heldFrames}f != 6f per crown (${s3})`);
  if(p.slowedFrames>24*s3)fail(`slow-mo overspent: ${p.slowedFrames}f for ${s3} crowns (budget 24f each)`);
  if(wins<1)fail(`no episode crowned in 5 minutes with modifiers on`);
  const fx=bootGame('smallguys',{seed:0x5a114002,footer:ACT_FOOTER});
  const mf=fx.sandbox.__modFixture();
  console.log(`  wiring: slime -> ${mf.s.mod} v${mf.s.slimeV}, doors -> ${mf.d.mod} ${mf.d.tLimit/60}s`);
  if(mf.s.mod!=='hungry'||Math.abs(mf.s.slimeV-0.145)>1e-9)fail(`HUNGRY SLIME wiring regressed: ${JSON.stringify(mf.s)}`);
  if(mf.d.mod!=='blitz'||mf.d.tLimit!==3120)fail(`DOOR BLITZ wiring regressed: ${JSON.stringify(mf.d)}`);
  const c=bootGame('smallguys',{seed:0x5a114011,footer:ACT_FOOTER});
  const d=bootGame('smallguys',{seed:0x5a114011,footer:ACT_FOOTER});
  d.sandbox.__NO_PAYOFF_FX=1;
  c.frames(10800,false);d.frames(10800,false);
  if(c.sandbox.__sig()!==d.sandbox.__sig())fail('__NO_PAYOFF_FX changed the sim: payoff confetti leaked into gameplay');
  else console.log('  __NO_PAYOFF_FX: sim signatures identical over 3 minutes');
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
