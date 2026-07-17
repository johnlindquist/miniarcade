#!/usr/bin/env node
'use strict';

// DEMON FIST band sweep: boots N paired five-minute seeds (planned vs
// __NO_ROUTE_PLAN reactive) plus two ten-minute soaks and prints the measured
// extrema that evals/demon-fist-eval.js locks into bands. Re-run after ANY sim
// change; never edit bands without a fresh sweep.
const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,soakLine}=require('./soak');

const KEYS=['segments','blocks','kos','hits','hitsTaken','launchers','slams','sweeps','sweepHits',
  'dodges','counters','cracks','supers','comboMilestones','comboDrops','knockdowns','waves','waveClears',
  'acts','eliteKos','mobClears','noHitMobs','actClears','lapses','whiffs','contacts','jabs','finishers',
  'jumps','jumpHits','sprints','sprintArrivals',
  'events','progress','maxEventLull','maxProgressLull'];
const policyScore=p=>{const s=p.stats;
  return 3*s.segments+40*s.blocks+12*s.kos+3*s.comboMilestones+4*s.slams+2*s.sweeps+2*s.counters+10*s.eliteKos+6*s.mobClears-8*s.knockdowns-3*s.hitsTaken-4*s.comboDrops;};
const failures=p=>{const s=p.stats;return 4*s.knockdowns+s.hitsTaken+2*s.comboDrops;};

function run(seed,reactive,frames){
  const game=bootGame('demon-fist',{seed});
  if(reactive)game.sandbox.__NO_ROUTE_PLAN=1;
  game.frames(frames,false);
  return game.sandbox.__demonFistProbe();
}
function extrema(rows){
  const out={};
  for(const k of KEYS){
    const vs=rows.map(p=>p.stats[k]);
    out[k]=[Math.min(...vs),Math.max(...vs)];
  }
  return out;
}
function printExtrema(label,rows){
  const ex=extrema(rows);
  console.log(`\n${label} extrema (${rows.length} runs):`);
  console.log(KEYS.map(k=>`${k} ${ex[k][0]}..${ex[k][1]}`).join(', '));
  return ex;
}
const scoreline=p=>`score ${policyScore(p)} failures ${failures(p)}`;

const seeds=[];for(let i=0;i<10;i++)seeds.push(0x4f00+i*37);
const planned=[],reactive=[];
for(const seed of seeds){
  const a=run(seed,false,18000),b=run(seed,true,18000);
  planned.push(a);reactive.push(b);
  const show=a.show;
  console.log(`${seed.toString(16)} planned[${scoreline(a)} kos ${a.stats.kos} taken ${a.stats.hitsTaken} downs ${a.stats.knockdowns}] reactive[${scoreline(b)} kos ${b.stats.kos} taken ${b.stats.hitsTaken} downs ${b.stats.knockdowns}] tiers shown ${JSON.stringify(show.shownByTier)}`);
}
const exP=printExtrema('PLANNED',planned),exR=printExtrema('REACTIVE',reactive);
const scoreWins=planned.filter((p,i)=>policyScore(p)>policyScore(reactive[i])).length;
const failureWins=planned.filter((p,i)=>failures(p)<failures(reactive[i])).length;
const agg=(rows,fn)=>rows.reduce((t,p)=>t+fn(p),0);
console.log(`\nscore wins ${scoreWins}/10 failure wins ${failureWins}/10`);
console.log(`aggregate score ${agg(planned,policyScore)} vs ${agg(reactive,policyScore)}`);
console.log(`aggregate failures ${agg(planned,failures)} vs ${agg(reactive,failures)}`);
console.log(`reactive baseline: kos ${agg(reactive,p=>p.stats.kos)} hits ${agg(reactive,p=>p.stats.hits)} events ${agg(reactive,p=>p.stats.events)} supers ${agg(reactive,p=>p.stats.supers)}`);
console.log(`planned hitsTaken ${exP.hitsTaken[0]}..${exP.hitsTaken[1]} vs reactive ${exR.hitsTaken[0]}..${exR.hitsTaken[1]}`);

const soakRows=[];
for(const seed of[0x5200,0x52d4]){
  const{game,samples}=runSoak('demon-fist',{seed,minutes:10});
  const report=analyzeSoak(samples),p=game.sandbox.__demonFistProbe(),show=p.show;
  soakRows.push(p);
  console.log(`\nsoak ${seed.toString(16)}: ${soakLine(report)}`);
  console.log(`  ${scoreline(p)} kos ${p.stats.kos} taken ${p.stats.hitsTaken} downs ${p.stats.knockdowns} tiers offered ${JSON.stringify(show.offeredByTier)} shown ${JSON.stringify(show.shownByTier)} held ${show.heldFrames} slowed ${show.slowedFrames} admire ${show.admireFrames}`);
  const kinds=['thug','sprinter','bruiser','demon','elite'].map(k=>`${k} ${p.stats[k]}`).join(' ');
  console.log(`  seen: ${kinds} | notes: ${p.act.notes.length}`);
}
printExtrema('SOAK',soakRows);
