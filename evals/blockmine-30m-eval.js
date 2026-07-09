#!/usr/bin/env node
/* Block Mine 30-minute good-run eval.
 *
 * Searches deterministic Math.random seeds for a full 30-minute attract-mode
 * story that never gets stuck, then prints the winning seed for the offline
 * renderer.
 *
 * "Never stuck" means:
 *   - repaths / stuckRecoveries === 0  (SMART REPATH never fired)
 *   - max progress stall ≤ 30s         (same bar as the 10-minute story eval)
 *   - finite player + camera state
 * plus a competence floor so a still-looking-busy death spiral does not pass:
 *   - depth ≥ 120m, tool ≥ iron, goals ≥ 20, deaths ≤ 12
 *
 * Usage:
 *   node evals/blockmine-30m-eval.js
 *   node evals/blockmine-30m-eval.js --seeds 8 --minutes 30
 *   node evals/blockmine-30m-eval.js --seed 0xB10C0001
 */
'use strict';
const fs=require('fs'),path=require('path');
const{seededRandom,inlineScript}=require('./harness');

const dir=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(dir,'blockmine.html'),'utf8');
const inline=inlineScript(html);
const engine=fs.readFileSync(path.join(dir,'engine.js'),'utf8');
const autoplay=fs.readFileSync(path.join(dir,'autoplay.js'),'utf8');

function parseArgs(argv){
  const flags={seeds:12,minutes:30,base:0xB10C0000};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--seeds')flags.seeds=+argv[++i];
    else if(a==='--minutes')flags.minutes=+argv[++i];
    else if(a==='--seed')flags.seed=Number(argv[++i]);
    else if(a==='--base')flags.base=Number(argv[++i]);
    else if(a==='--help'||a==='-h')flags.help=true;
    else throw new Error('unknown arg: '+a);
  }
  return flags;
}

const flags=parseArgs(process.argv.slice(2));
if(flags.help){
  console.log('Usage: node evals/blockmine-30m-eval.js [--seed N] [--seeds K] [--minutes M]');
  process.exit(0);
}

const FRAMES=Math.round(flags.minutes*60*60); // minutes * 60s * 60fps
const LIMITS={
  maxStall:1800,   // 30s without progressFrame advance
  repaths:0,       // never stuck
  deaths:12,
  depth:120,
  tool:3,
  goalsDone:20,
  lights:5,
  builds:4
};

function boot(randomSeed){
  // Wipe previous game globals so successive boots do not leak state.
  for(const k of Object.keys(globalThis))if(k.startsWith('__bm'))delete globalThis[k];
  Math.random=seededRandom(randomSeed);
  const listeners={};
  const ctx=new Proxy({},{get:(t,p)=>p==='measureText'?()=>({width:10}):()=>{},set:()=>true});
  const canvas={getContext:()=>ctx,width:320,height:720};
  global.document={getElementById:()=>canvas,addEventListener:(type,fn)=>{listeners[type]=fn;}};
  global.requestAnimationFrame=()=>{};
  global.location={search:'',href:''};
  const footer=`
;globalThis.__bmStep=step;
globalThis.__bmProbe=()=>({
  depth:deepest,tool:P.tool,wood:P.wood,diamonds:P.diamond,kills,lights:torches.length,
  cx:P.cx,cy:P.cy,trapKills,trapBuilds,buildScore,builds:structures.length,deaths,repaths,
  mobs:mobs.length,mode:P.aiMode,goalStage:goalState.stage,goalsDone:goalState.completed,
  goalLabel:primaryGoal().label,progress:P.progressFrame,frame,stuck:P.stuckRecoveries,
  finite:Number.isFinite(P.x)&&Number.isFinite(P.y)&&Number.isFinite(camY)
});
globalThis.__bmStoryRun=n=>{
  let last=-1,stall=0,maxStall=0,maxDepth=0,maxTool=0;
  for(let i=0;i<n;i++){
    step();
    const progress=P.progressFrame;
    if(progress>last){last=progress;stall=0;}else{stall++;maxStall=Math.max(maxStall,stall);}
    if(deepest>maxDepth)maxDepth=deepest;
    if(P.tool>maxTool)maxTool=P.tool;
  }
  return Object.assign({maxStall,maxDepth,maxTool},globalThis.__bmProbe());
};
`;
  // Fresh Function scope would be cleaner, but blockmine/engine expect the
  // same global document/requestAnimationFrame layout as the 10-minute eval.
  eval((engine+'\n'+autoplay+'\n'+inline).replace(/'use strict';/g,'')+footer);
}

function judge(p){
  const fails=[];
  if(!p.finite)fails.push('non-finite player or camera');
  if(p.repaths>LIMITS.repaths)fails.push(`stuck recoveries ${p.repaths} (limit ${LIMITS.repaths})`);
  if(p.maxStall>LIMITS.maxStall)fails.push(`stalled ${(p.maxStall/60).toFixed(1)}s (limit ${LIMITS.maxStall/60}s)`);
  if(p.deaths>LIMITS.deaths)fails.push(`died ${p.deaths} times (limit ${LIMITS.deaths})`);
  if(p.depth<LIMITS.depth)fails.push(`reached only ${p.depth}m (limit ${LIMITS.depth}m)`);
  if(p.tool<LIMITS.tool)fails.push(`tool tier ${p.tool} (limit iron=${LIMITS.tool})`);
  if(p.goalsDone<LIMITS.goalsDone)fails.push(`only ${p.goalsDone} goals (limit ${LIMITS.goalsDone})`);
  if(p.lights<LIMITS.lights)fails.push(`only ${p.lights} torches (limit ${LIMITS.lights})`);
  if(p.builds<LIMITS.builds)fails.push(`only ${p.builds} builds (limit ${LIMITS.builds})`);
  return fails;
}

function formatRun(seed,p,wallMs){
  return `seed 0x${(seed>>>0).toString(16)}: ${p.depth}m tool${p.tool} `+
    `${p.diamonds}◆ ${p.kills} kills ${p.goalsDone} goals ${p.deaths} deaths `+
    `${p.repaths} repaths maxStall ${(p.maxStall/60).toFixed(1)}s `+
    `(${(wallMs/1000).toFixed(1)}s wall)`;
}

const seeds=flags.seed!==undefined
  ?[flags.seed>>>0]
  :Array.from({length:flags.seeds},(_,i)=>(flags.base+i+1)>>>0);

console.log(`blockmine ${flags.minutes}-minute good-run search (${seeds.length} seed(s), ${FRAMES} frames each)`);
console.log('limits:',JSON.stringify(LIMITS));

let failed=false;
const results=[];
let winner=null;

for(const seed of seeds){
  const t0=Date.now();
  boot(seed);
  const p=globalThis.__bmStoryRun(FRAMES);
  const wallMs=Date.now()-t0;
  const fails=judge(p);
  const row={seed,seedHex:'0x'+(seed>>>0).toString(16),wallMs,...p,fails,ok:!fails.length};
  results.push(row);
  console.log((row.ok?'  PASS ':'  fail ')+formatRun(seed,p,wallMs));
  if(fails.length){
    for(const f of fails)console.log('       -',f);
    failed=true;
  }else if(!winner)winner=row;
}

const outDir=path.join(dir,'..','.artifacts','blockmine-30m');
fs.mkdirSync(outDir,{recursive:true});
const reportPath=path.join(outDir,'eval-report.json');
fs.writeFileSync(reportPath,JSON.stringify({
  minutes:flags.minutes,frames:FRAMES,limits:LIMITS,results,winner
},null,2));
console.log('report:',reportPath);

if(winner){
  console.log('\nWINNER seed',winner.seedHex,'('+winner.seed+')');
  console.log('Render with:');
  console.log(`  node render/render.js blockmine ${flags.minutes*60} .artifacts/blockmine-30m/blockmine-${flags.minutes}m.mp4 --seed ${winner.seedHex} --probe`);
  // Single-seed mode: exit 0 only if that seed passed.
  if(flags.seed!==undefined)process.exit(0);
  // Multi-seed search: success if any seed is a good never-stuck run.
  process.exit(0);
}

console.log('\nEVAL FAILED: no seed produced a never-stuck 30-minute run');
process.exit(1);
