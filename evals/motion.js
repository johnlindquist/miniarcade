'use strict';
/* Shared per-actor motion contract.
 *
 * Three rules, on top of the world-level soak invariants:
 *   1. NO SPIN-IN-PLACE — an AI-driven actor that stays in the same location
 *      for more than half a second (30 sim frames) fails, unless the game is
 *      showing an authored emote/thought for that actor, and even then the
 *      pause must stay inside a bounded budget.
 *   2. NO COMPUTED-PATH GUIDELINES IN EXPLORATION GAMES — no navigation line,
 *      breadcrumb trail, or waypoint overlay may pre-draw the bot's route.
 *      That is enforced per game by code + visual review; this module provides
 *      the motion half.
 *   3. PACE — actors need momentum; per-game evals set measured speed floors.
 *
 * Each game's eval installs a `__motionProbe` via its boot footer:
 *   __motionProbe() -> {actors:[{id, x, y, emote}], finite}
 *     id     stable identifier for one watched AI actor
 *     x,y    the actor's sim position in playfield pixels
 *     emote  true while the game renders an authored emote/thought state
 *            for this actor (searching, plotting, stunned, celebrating, ...)
 *     finite false once any tracked numeric goes non-finite
 * Only report actors the viewer is meant to watch move (protagonists, active
 * enemies). Do not report intentionally static set pieces (planted turrets,
 * buildings); those are structures, not characters.
 */
const{bootGame}=require('./harness');

const HALF_SECOND=30; // frames; the hard directive — do not widen per game.
const MAX_SAMPLE_STEP=5; // close enough that a 31f stall cannot hide between probes.

function runMotion(name,options){
  const game=bootGame(name,{seed:options.seed,footer:options.footer});
  const frames=Math.round((options.minutes||10)*3600);
  const step=options.sampleEvery||5; // fine enough to resolve a 30f window
  const samples=[];
  for(let f=0;f<frames;f+=step){
    game.frames(step,false);
    const p=game.sandbox.__motionProbe();
    samples.push({at:f+step,actors:p.actors,finite:p.finite!==false});
  }
  return{game,samples,step};
}

// limits: {
//   stillRadius   px an actor may jitter and still count as "same location" (default 2)
//   emoteFrames   max frames one emote-covered pause may last (default 120 = 2s)
//   emoteShare    max fraction of sampled time an actor may spend emote-paused (default 0.15)
//   minPresenceShare minimum share required for at least one stable watched actor (default .95)
//   requiredIds   stable protagonist/role IDs which must meet minPresenceShare
//   identityTurnoverAllowance extra IDs allowed to rotate through one 30f window
//                    beyond the peak simultaneous cast (default 1 for a real swap)
// }
function analyzeMotion(run,limits){
  limits=limits||{};
  const radius=limits.stillRadius===undefined?2:limits.stillRadius;
  const emoteFrames=limits.emoteFrames===undefined?120:limits.emoteFrames;
  const emoteShare=limits.emoteShare===undefined?0.15:limits.emoteShare;
  const minPresenceShare=limits.minPresenceShare===undefined?.95:limits.minPresenceShare;
  const requiredIds=limits.requiredIds||[];
  const identityTurnoverAllowance=limits.identityTurnoverAllowance===undefined?1:limits.identityTurnoverAllowance;
  if(!run||!Number.isFinite(run.step)||run.step<=0||run.step>MAX_SAMPLE_STEP||!Array.isArray(run.samples))throw new Error(`motion run needs samples at most every ${MAX_SAMPLE_STEP} frames`);
  if(!Number.isFinite(radius)||radius<0||!Number.isFinite(emoteFrames)||emoteFrames<0||
    !Number.isFinite(emoteShare)||emoteShare<0||emoteShare>1||!Number.isFinite(minPresenceShare)||minPresenceShare<=0||minPresenceShare>1||
    !Array.isArray(requiredIds)||requiredIds.some(id=>typeof id!=='string'||!id)||new Set(requiredIds).size!==requiredIds.length||
    !Number.isInteger(identityTurnoverAllowance)||identityTurnoverAllowance<0)
    throw new Error('motion limits must be finite and in range with unique required IDs');
  const actors=new Map();
  const identityWindow=[],identityWindowSamples=Math.floor(HALF_SECOND/run.step)+1;
  let finite=true,emptySamples=0,lastAt=-Infinity,worstIdentityTurnover={excess:0,distinct:0,concurrent:0,at:0};
  for(const sample of run.samples){
    if(!sample||!Number.isFinite(sample.at)||sample.at<=lastAt)finite=false;
    else lastAt=sample.at;
    if(!sample.finite)finite=false;
    if(!Array.isArray(sample.actors)){finite=false;continue}
    const ids=new Set(),validActors=[];
    for(const actor of sample.actors){
      if(!actor||typeof actor.id!=='string'||!actor.id||ids.has(actor.id)||!Number.isFinite(actor.x)||!Number.isFinite(actor.y))finite=false;
      else{ids.add(actor.id);validActors.push(actor)}
    }
    if(!validActors.length)emptySamples++;
    const visible=new Set(validActors.map(a=>a.id));
    identityWindow.push(visible);if(identityWindow.length>identityWindowSamples)identityWindow.shift();
    const windowIds=new Set();let concurrent=0;
    for(const set of identityWindow){concurrent=Math.max(concurrent,set.size);for(const id of set)windowIds.add(id)}
    const excess=windowIds.size-concurrent;
    if(excess>worstIdentityTurnover.excess)worstIdentityTurnover={excess,distinct:windowIds.size,concurrent,at:sample.at};
    for(const t of actors.values())if(t.active&&!visible.has(t.id)){
      // A one-sample omission must not launder a stationary streak. Only a real
      // despawn longer than the half-second contract starts a new appearance.
      t.missingFrames+=run.step;
      if(t.missingFrames>HALF_SECOND){t.active=false;t.bareFrames=0;t.emoteFrames=0}
    }
    for(const a of validActors){
      let t=actors.get(a.id);
      if(!t){t={id:a.id,anchor:{x:a.x,y:a.y},bareFrames:0,emoteFrames:0,
        worstBare:0,worstEmote:0,emoteTotal:0,seen:0,active:true,missingFrames:0};actors.set(a.id,t);}
      else if(!t.active){t.anchor={x:a.x,y:a.y};t.bareFrames=0;t.emoteFrames=0;t.active=true;}
      t.missingFrames=0;
      t.seen+=run.step;
      // Authored emote budgets are wall-clock presentation contracts. A sway,
      // orbit, recoil, or other in-place animation must not make a long emote
      // disappear from the duration/share accounting merely by crossing the
      // still-radius threshold.
      if(a.emote){t.emoteFrames+=run.step;t.emoteTotal+=run.step;if(t.emoteFrames>t.worstEmote)t.worstEmote=t.emoteFrames;}
      else t.emoteFrames=0;
      const dx=a.x-t.anchor.x,dy=a.y-t.anchor.y;
      if(dx*dx+dy*dy<=radius*radius){
        if(a.emote)t.bareFrames=0;
        else{t.bareFrames+=run.step;if(t.bareFrames>t.worstBare)t.worstBare=t.bareFrames;}
      }else{
        t.anchor={x:a.x,y:a.y};t.bareFrames=0;
      }
    }
  }
  const totalFrames=run.samples.length*run.step;
  const report={finite,actors:[...actors.values()].map(t=>({
    id:t.id,worstBareStillFrames:t.worstBare,worstEmoteStillFrames:t.worstEmote,
    emoteStillShare:t.seen?t.emoteTotal/t.seen:0,presenceShare:totalFrames?t.seen/totalFrames:0})),
    identityTurnover:{...worstIdentityTurnover,allowance:identityTurnoverAllowance,windowFrames:HALF_SECOND}};
  report.violations=[];
  for(const a of report.actors){
    if(a.worstBareStillFrames>HALF_SECOND)
      report.violations.push(`${a.id}: stood still ${a.worstBareStillFrames}f with no emote (limit ${HALF_SECOND}f)`);
    if(a.worstEmoteStillFrames>emoteFrames)
      report.violations.push(`${a.id}: emote pause ran ${a.worstEmoteStillFrames}f (limit ${emoteFrames}f)`);
    if(a.emoteStillShare>emoteShare)
      report.violations.push(`${a.id}: emote-paused ${(a.emoteStillShare*100).toFixed(1)}% of run (limit ${(emoteShare*100).toFixed(0)}%)`);
  }
  if(!run.samples.length)report.violations.push('motion run contains no samples');
  if(emptySamples)report.violations.push(`${emptySamples} motion samples contain no watched actors`);
  const persistent=report.actors.filter(a=>a.presenceShare>=minPresenceShare);
  if(!persistent.length)report.violations.push(`no stable watched actor appears in ${(minPresenceShare*100).toFixed(0)}% of the run`);
  for(const id of requiredIds){const actor=report.actors.find(a=>a.id===id);if(!actor||actor.presenceShare<minPresenceShare)report.violations.push(`${id}: required watched actor appears in ${actor?(actor.presenceShare*100).toFixed(1):'0.0'}% of run (floor ${(minPresenceShare*100).toFixed(0)}%)`)}
  if(worstIdentityTurnover.excess>identityTurnoverAllowance)report.violations.push(
    `${worstIdentityTurnover.distinct} watched actor IDs rotated through a ${HALF_SECOND}f window with only ${worstIdentityTurnover.concurrent} concurrent actors (turnover allowance ${identityTurnoverAllowance}); use stable role IDs`);
  if(!finite)report.violations.push('non-finite state during motion run');
  return report;
}

function assertMotion(label,report,fail){
  for(const v of report.violations)fail(`${label}: ${v}`);
  return report.violations.length===0;
}

const motionLine=r=>{
  const worst=r.actors.reduce((m,a)=>Math.max(m,a.worstBareStillFrames),0);
  const emote=r.actors.reduce((m,a)=>Math.max(m,a.worstEmoteStillFrames),0);
  return`${r.actors.length} actors, worst bare still ${worst}f, worst emote pause ${emote}f`;
};

module.exports={HALF_SECOND,MAX_SAMPLE_STEP,runMotion,analyzeMotion,assertMotion,motionLine};
