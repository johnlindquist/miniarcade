'use strict';
/* Shared per-actor motion contract (owner directive 2026-07-11).
 *
 * Three rules, on top of the world-level soak invariants:
 *   1. NO SPIN-IN-PLACE — an AI-driven actor that stays in the same location
 *      for more than half a second (30 sim frames) fails, unless the game is
 *      showing an authored emote/thought for that actor, and even then the
 *      pause must stay inside a bounded budget.
 *   2. NO GUIDELINES — nothing may pre-draw where an actor or enemy is going
 *      (path lines, arrows, ghost trails, predicted arcs, outlined landing/
 *      collapse zones). That is enforced per game by code + visual review;
 *      this module only provides the motion half.
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
// }
function analyzeMotion(run,limits){
  limits=limits||{};
  const radius=limits.stillRadius===undefined?2:limits.stillRadius;
  const emoteFrames=limits.emoteFrames===undefined?120:limits.emoteFrames;
  const emoteShare=limits.emoteShare===undefined?0.15:limits.emoteShare;
  const actors=new Map();
  let finite=true;
  for(const sample of run.samples){
    if(!sample.finite)finite=false;
    for(const a of sample.actors){
      let t=actors.get(a.id);
      if(!t){t={id:a.id,anchor:{x:a.x,y:a.y},stillFrames:0,emoteCovered:true,
        worstBare:0,worstEmote:0,emoteStillTotal:0,seen:0};actors.set(a.id,t);}
      t.seen+=run.step;
      const dx=a.x-t.anchor.x,dy=a.y-t.anchor.y;
      if(dx*dx+dy*dy<=radius*radius){
        t.stillFrames+=run.step;
        t.emoteCovered=t.emoteCovered&&!!a.emote;
        if(a.emote)t.emoteStillTotal+=run.step;
        const worst=t.emoteCovered?'worstEmote':'worstBare';
        if(t.stillFrames>t[worst])t[worst]=t.stillFrames;
      }else{
        t.anchor={x:a.x,y:a.y};t.stillFrames=0;t.emoteCovered=true;
      }
    }
  }
  const report={finite,actors:[...actors.values()].map(t=>({
    id:t.id,worstBareStillFrames:t.worstBare,worstEmoteStillFrames:t.worstEmote,
    emoteStillShare:t.seen?t.emoteStillTotal/t.seen:0}))};
  report.violations=[];
  for(const a of report.actors){
    if(a.worstBareStillFrames>HALF_SECOND)
      report.violations.push(`${a.id}: stood still ${a.worstBareStillFrames}f with no emote (limit ${HALF_SECOND}f)`);
    if(a.worstEmoteStillFrames>emoteFrames)
      report.violations.push(`${a.id}: emote pause ran ${a.worstEmoteStillFrames}f (limit ${emoteFrames}f)`);
    if(a.emoteStillShare>emoteShare)
      report.violations.push(`${a.id}: emote-paused ${(a.emoteStillShare*100).toFixed(1)}% of run (limit ${(emoteShare*100).toFixed(0)}%)`);
  }
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

module.exports={HALF_SECOND,runMotion,analyzeMotion,assertMotion,motionLine};
