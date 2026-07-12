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
;globalThis.__lapses=0;
{const __d0=runnerSkill.decide;let __was=false;
 runnerSkill.decide=(f,c,d,l)=>{const out=__d0(f,c,d,l);
   const now=runnerSkill.isLapsed(f);if(now&&!__was)globalThis.__lapses++;__was=now;return out;};}
globalThis.__probe=()=>({dist,deaths,state,spd,lapses:globalThis.__lapses,
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
  if(p.lapses!==0)fail(`run ${run}: __NO_LAPSE run still recorded ${p.lapses} lapses`);
}
// ---- 3. drama band with lapses on
console.log('3) drama: 2 x 10 minutes, lapses on');
for(let run=1;run<=2;run++){
  boot(0x51de3000+run);
  game.frames(36000,false);
  const p=probe();
  console.log(`  run ${run}: deaths ${p.deaths}, lapses ${p.lapses}`);
  if(p.deaths<1)fail(`run ${run}: zero deaths in 10 min — no drama`);
  if(p.deaths>14)fail(`run ${run}: ${p.deaths} deaths in 10 min — bloodbath`);
  // The stumble mechanic is the drama engine: it must visibly fire, but a
  // stumble-storm reads as a broken runner. Measured 23-24 on these seeds.
  if(p.lapses<5)fail(`run ${run}: only ${p.lapses} lapses in 10 min — runner is robotically perfect`);
  if(p.lapses>60)fail(`run ${run}: ${p.lapses} lapses in 10 min — stumble storm`);
}

// ---- 4. express wave act + show ladder
console.log('4) express wave + show ladder: telegraphed surge, runner holds a lane, slow-mo budgeted');
{
  const ACT_FOOTER=`
;globalThis.__notes=[];
{const __n0=SHOW.note;SHOW.note=e=>{globalThis.__notes.push({kind:e.kind,id:e.id,tag:e.tag});return __n0(e);};}
globalThis.__rush=()=>({phase:rushPhase,deaths,dist,
  dyn:obs.reduce((n,o)=>n+(o.kind==='mov'||o.kind==='crawl'?1:0),0)});
globalThis.__showP=()=>SHOW.probe();
globalThis.__sig=()=>Math.round(P.x*31+dist*7)+coinCt*1009+deaths*97+P.tl*17;`;
  // Seed picked so the pre-positioning situation actually arises during the
  // first warn window (runner off-corridor / loot tempting the unaware twin).
  // Re-derived 2026-07-11 after the chase layer + shortened bust/intro beats
  // shifted run timing: 40-seed sweep, warn-phase divergence on 0x51de4010/11/
  // 18/1c/1e/20/21/24/27; 0x51de4010 diverges at 2180 during 'warn' with live
  // trains 0.37 vs 0.01 and 2 deaths.
  const SEED=0x51de4010;
  const a=bootGame('surfers',{seed:SEED,footer:ACT_FOOTER});
  const b=bootGame('surfers',{seed:SEED,footer:ACT_FOOTER});
  b.sandbox.__NO_ACTS=1;
  let firstDiverge=-1,divergePhase='',liveSamples=0,dynA=0,dynB=0;
  for(let f=0;f<18000;f+=10){
    a.frames(10,false);b.frames(10,false);
    const g=a.sandbox.__rush();
    if(g.phase==='live'){liveSamples++;dynA+=g.dyn;dynB+=b.sandbox.__rush().dyn;}
    if(firstDiverge<0&&a.sandbox.__sig()!==b.sandbox.__sig()){firstDiverge=f+10;divergePhase=g.phase;}
  }
  const ev=a.sandbox.__notes,p=a.sandbox.__showP();
  const waves=[];let pend=null;
  for(const e of ev){
    if(e.kind==='act-warning'&&e.id==='express')pend=e;
    else if(e.kind==='act-land'&&e.id==='express'&&pend){waves.push(e.tag-pend.tag);pend=null;}
  }
  const o=p.offeredByTier,s3=p.shownByTier[3]||0;
  const pa=a.sandbox.__rush();
  console.log(`  ${waves.length} waves landed (telegraphs ${waves.join(',')} run-frames), `+
    `diverged at ${firstDiverge} during '${divergePhase}', live trains ${liveSamples?(dynA/liveSamples).toFixed(2):'?'} `+
    `vs unaware ${liveSamples?(dynB/liveSamples).toFixed(2):'?'}, tiers ${JSON.stringify(o)}, `+
    `waves cleared ${o[3]||0} (slowed ${p.slowedFrames}f, held ${p.heldFrames}f), ${pa.deaths} deaths`);
  if(waves.length<2)fail(`only ${waves.length} express waves landed in 5 minutes`);
  for(const t of waves)if(t<180||t>300)fail(`express telegraph ${t} run-frames outside 180..300`);
  if(liveSamples<30)fail(`express live phase barely observable (${liveSamples} samples)`);
  if(dynA<=dynB)fail(`express wave did not surge live trains (${(dynA/Math.max(1,liveSamples)).toFixed(2)} vs ${(dynB/Math.max(1,liveSamples)).toFixed(2)})`);
  if(firstDiverge<0)fail('runner never responded to the express call (A/B identical)');
  else if(divergePhase!=='warn')fail(`runner first diverged during '${divergePhase}', not the telegraph`);
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=1))fail(`ladder not strictly ordered (${JSON.stringify(o)})`);
  if(p.heldFrames!==0)fail(`hitstop not configured yet counted ${p.heldFrames} held frames`);
  if(p.slowedFrames>24*s3)fail(`slow-mo overspent: ${p.slowedFrames}f for ${s3} apexes (budget 24f each)`);
  if(pa.deaths>7)fail(`express run deaths ${pa.deaths} exceed watchable half-band 7 in 5 minutes`);
  const c=bootGame('surfers',{seed:0x51de4011,footer:ACT_FOOTER});
  const d=bootGame('surfers',{seed:0x51de4011,footer:ACT_FOOTER});
  d.sandbox.__NO_PAYOFF_FX=1;
  c.frames(10800,false);d.frames(10800,false);
  if(c.sandbox.__sig()!==d.sandbox.__sig())fail('__NO_PAYOFF_FX changed the sim: payoff confetti leaked into gameplay');
  else console.log('  __NO_PAYOFF_FX: sim signatures identical over 3 minutes');
}

// ---- 5. motion contract: runner + inspector never stall, pauses are authored
console.log('5) motion contract: 2 x 10 minutes, strict per-actor analyzer');
{
  const{runMotion,analyzeMotion,assertMotion,motionLine}=require('./motion');
  for(const seed of[0x51de5001,0x51de5002]){
    const report=analyzeMotion(runMotion('surfers',{seed,minutes:10}),
      {requiredIds:['runner','inspector']});
    console.log(`  seed 0x${seed.toString(16)}: ${motionLine(report)}`);
    assertMotion(`motion seed 0x${seed.toString(16)}`,report,fail);
  }
}

// ---- 6. chase layer: the inspector surges on stumbles and bends the runner's play
console.log('6) chase: inspector heat tracks stumbles, safe-play response diverges vs __NO_CHASE');
{
  const CHASE_FOOTER=`
;globalThis.__lapseStarts=[];globalThis.__totDist=0;
{const __d0=runnerSkill.decide;let __was=false;
 runnerSkill.decide=(f,c,d,l)=>{const out=__d0(f,c,d,l);
   const now=runnerSkill.isLapsed(f);if(now&&!__was)globalThis.__lapseStarts.push(frame);__was=now;return out;};}
{const __s0=startRun;startRun=()=>{globalThis.__totDist+=dist;__s0();};}
globalThis.__chase=()=>({heat:INS.heat,peak:INS.peak,deaths,
  dist:globalThis.__totDist+dist,
  sig:Math.round(P.x*31+dist*7)+coinCt*1009+deaths*97+P.tl*17});`;
  let totalLapses=0,totalSurges=0;
  for(let s=1;s<=6;s++){
    const seed=0x51de6000+s;
    const a=bootGame('surfers',{seed,footer:CHASE_FOOTER});
    const b=bootGame('surfers',{seed,footer:CHASE_FOOTER});
    b.sandbox.__NO_CHASE=1;
    let firstDiverge=-1,heatAfterSpike=[],maxHeatB=0;
    const spikes=[];
    for(let f=0;f<10800;f+=10){
      a.frames(10,false);b.frames(10,false);
      const ca=a.sandbox.__chase(),cb=b.sandbox.__chase();
      maxHeatB=Math.max(maxHeatB,cb.heat);
      if(firstDiverge<0&&ca.sig!==cb.sig)firstDiverge=f+10;
      for(const lf of a.sandbox.__lapseStarts){
        if(!spikes.includes(lf)&&f+10>=lf+40&&f+10<=lf+60){spikes.push(lf);heatAfterSpike.push(ca.heat);}
      }
    }
    const ca=a.sandbox.__chase(),cb=b.sandbox.__chase();
    const lapses=a.sandbox.__lapseStarts.length;
    totalLapses+=lapses;
    const surged=heatAfterSpike.filter(h=>h>=35).length;
    totalSurges+=surged;
    console.log(`  seed 0x${seed.toString(16)}: lapses ${lapses}, surges ${surged}/${heatAfterSpike.length}, `+
      `peak heat ${ca.peak.toFixed(0)}, diverged @${firstDiverge}, dist ${Math.round(ca.dist/10)}m vs ${Math.round(cb.dist/10)}m, `+
      `deaths ${ca.deaths} vs ${cb.deaths}`);
    // the ablated twin must truly have no pursuit pressure, yet still play
    if(cb.heat!==0||maxHeatB!==0)fail(`seed ${s}: __NO_CHASE twin still accumulated heat`);
    if(cb.dist<30000)fail(`seed ${s}: __NO_CHASE baseline stalled (${Math.round(cb.dist/10)}m total in 3 min)`);
    if(ca.dist<30000)fail(`seed ${s}: chase runner stalled (${Math.round(ca.dist/10)}m total in 3 min)`);
    // the live layer must actually change decisions: initial pursuit heat (70)
    // keeps the runner off loot until ~250f, so divergence lands early
    if(firstDiverge<0)fail(`seed ${s}: chase policy never diverged from the ablated twin`);
    else if(firstDiverge>900)fail(`seed ${s}: chase divergence too late (${firstDiverge})`);
    if(ca.deaths>7)fail(`seed ${s}: chase runner deaths ${ca.deaths} bust the 3-minute half-band`);
    // every measured stumble must pull the inspector to at least warm pursuit
    if(heatAfterSpike.some(h=>h<35))fail(`seed ${s}: a stumble failed to surge the inspector (heat ${heatAfterSpike.map(h=>h.toFixed(0)).join(',')})`);
  }
  if(totalLapses>=2&&totalSurges<1)fail('no stumble surge observed across six 3-minute runs');
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
