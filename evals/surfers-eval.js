#!/usr/bin/env node
/* Side Surfers generation + survival eval.
 *
 * Run:  node evals/surfers-eval.js   (from the here-now directory)
 *
 * Asserts and exits non-zero on failure:
 *  1. GENERATION — for long generated streams, a ground-only path always
 *     exists (conservative DP: lane changes need 48px of double-open track;
 *     barriers/gantries count as passable, trains block).
 *  2. PERFECT RUN — with AI lapses disabled, 3 x 10-minute runs never die:
 *     the track never presents an unavoidable death.
 *  3. DRAMA — with lapses enabled, deaths land in a watchable band
 *     (not immortal, not a bloodbath) and distance keeps growing.
 */
'use strict';
const{bootGame}=require('./harness');
let game;

function boot(seed){
  const footer=`
;globalThis.__probe=()=>({dist,deaths,state,spd,
  bad:!isFinite(P.x)||!isFinite(dist)});
globalThis.__streamCheck=(nSeg)=>{
  // build a long static track, then DP a ground path through it
  startRun();
  spd=4.3; // worst case: fastest lane changes needed
  for(let i=0;i<nSeg;i++)genSegment();
  const still=obs.filter(o=>o.kind==='train'); // static structure only
  let minY=0;
  for(const o of still)minY=Math.min(minY,o.y);
  const RS=4,rows=Math.ceil((-minY+80)/RS);
  const blocked=(l,r)=>{ // row r counts up from y=0 going more negative
    const y=-r*RS;
    for(const o of still)if(o.lane===l&&y>o.y-2&&y<o.y+o.len+2)return true;
    return false;
  };
  const CH=12; // rows of double-open track a lane change needs (48px)
  const reach=[];
  for(let r=0;r<rows;r++){
    reach.push([false,false,false]);
    for(let l=0;l<3;l++){
      if(blocked(l,r))continue;
      if(r===0){reach[r][l]=true;continue;}
      if(reach[r-1][l]){reach[r][l]=true;continue;}
      for(const d of[-1,1]){
        const l2=l+d;
        if(l2<0||l2>2||r<CH||!reach[r-CH][l2])continue;
        let clear=true;
        for(let k=r-CH;k<=r;k++)if(blocked(l,k)||blocked(l2,k)){clear=false;break;}
        if(clear){reach[r][l]=true;break;}
      }
    }
  }
  let topReach=0;
  for(let r=0;r<rows;r++)if(reach[r].some(Boolean))topReach=r;
  return{rows,topReach,ok:topReach>=rows-30};
};`;
  game=bootGame('surfers',{seed,footer});
  return game;
}
const probe=()=>game.sandbox.__probe();

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};

// ---- 1. generation: ground path always exists
console.log('1) generation: 30 streams x 120 segments, DP ground-path check');
boot(0x51de1001);
let bad=0;
for(let g=0;g<30;g++){
  const r=game.sandbox.__streamCheck(120);
  if(!r.ok){bad++;console.error(`  stream ${g}: path dies at row ${r.topReach}/${r.rows}`);}
}
if(bad>0)fail(`${bad}/30 streams had no continuous ground path`);
else console.log('  OK: every stream fully traversable on the ground');

// ---- 2. perfect AI never dies
console.log('2) perfect run: 3 x 10 minutes, lapses off');
for(let run=1;run<=3;run++){
  boot(0x51de2000+run);
  game.sandbox.__NO_LAPSE=1;
  game.frames(36000,false);
  const p=probe();
  console.log(`  run ${run}: ${Math.round(p.dist/10)}m, deaths ${p.deaths}, top speed ${p.spd.toFixed(2)}`);
  if(p.bad)fail(`run ${run}: non-finite state`);
  if(p.deaths>0)fail(`run ${run}: perfect AI died ${p.deaths}x — track presented an unavoidable death`);
  if(p.dist<150000)fail(`run ${run}: only ${Math.round(p.dist/10)}m in 10 min — speed curve regressed`);
}
// ---- 3. drama band with lapses on
console.log('3) drama: 2 x 10 minutes, lapses on');
for(let run=1;run<=2;run++){
  boot(0x51de3000+run);
  game.frames(36000,false);
  const p=probe();
  console.log(`  run ${run}: deaths ${p.deaths}`);
  if(p.deaths<1)fail(`run ${run}: zero deaths in 10 min — no drama`);
  if(p.deaths>14)fail(`run ${run}: ${p.deaths} deaths in 10 min — bloodbath`);
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
