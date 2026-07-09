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
globalThis.__probe=()=>({lvl:level,prog:level*1000+Math.max(P.idx,P.best||0),deaths});`;
  eval(src.replace(/'use strict';/g,'')+footer);
}

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};

// ---- 1. packed tile index preserves negative rows and row-mask integrity
console.log('1) packed tile index');
boot(deriveSeed(seed,'tile-index'));
const tileCheck=globalThis.__tileCheck();
if(!tileCheck.ok)fail('packed keys or collision row masks lost synchronization');
else console.log('  OK: negative rows round-trip and row masks track add/delete/clear');

// ---- 2. solvability sweep across the difficulty curve
console.log('2) solvability sweep: 40 difficulty levels x 25 generations');
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
console.log('3) progress runs: 3 x 10 simulated minutes');
for(let run=1;run<=3;run++){
  boot(deriveSeed(seed,`progress-${run}`));
  let prev=-1,stall=0,maxStall=0,t=0;
  for(let i=1;i<=36000;i++){
    const f=global.__cb;global.__cb=null;f(t+=1000/60);
    const p=globalThis.__probe();
    if(p.prog===prev){stall++;if(stall>maxStall)maxStall=stall;}
    else{stall=0;prev=p.prog;}
  }
  const end=globalThis.__probe();
  console.log(`  run ${run}: level ${end.lvl}, deaths ${end.deaths}, worst stall ${(maxStall/60).toFixed(1)}s`);
  if(maxStall>1500)fail(`run ${run}: stalled ${(maxStall/60).toFixed(1)}s (limit 25s)`);
  if(end.lvl<20)fail(`run ${run}: only reached level ${end.lvl} in 10 min (limit 20)`);
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
