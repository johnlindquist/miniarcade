'use strict';
/* Shared good/bad feedback-legibility contract (owner directive 2026-07-12).
 *
 * "You can't tell when something good or bad happens" is a release blocker:
 * every significant sim event must be VISIBLY represented on screen, and good
 * must read differently from bad. This module proves it with real pixels:
 *
 *   1. The game keeps an append-only ledger of curated good/bad sim events:
 *        __feedbackProbe() -> {finite, serial, events:[{serial, frame, show,
 *                              kind:'good'|'bad', id, sx, sy}], ...}
 *      sx/sy are SCREEN coordinates captured at fire time so the payoff
 *      location can be cropped later. The ledger is bookkeeping only — the
 *      sim never reads it.
 *   2. Two rendered runtimes advance in lockstep on the same seed: live, and
 *      a twin with the game's payoff-FX ablation (default __NO_PAYOFF_FX)
 *      active. Their sim signatures must stay byte-identical, so every pixel
 *      the pair disagrees on is, by construction, feedback presentation.
 *   3. For each sampled event, the crop around (sx, sy) must differ between
 *      the pair (the event has on-screen FX beyond physics), and the changed
 *      pixels must carry the right palette signature: good events show the
 *      game's good colors, bad events its bad colors. Palette separation is
 *      what makes good/bad DISTINGUISHABLE rather than merely "busy".
 *
 * The eval fails the cheap implementations it exists to prevent: FX deleted
 * (zero diff), FX that secretly changes the sim (signature drift), one
 * uniform celebration color for everything (palette floors), and categories
 * that silently stop firing (coverage).
 */
const{bootRenderedGame}=require('../render/runtime');

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function colorNear(r,g,b,palette,tolerance){
  for(const[pr,pg,pb]of palette){
    const dr=r-pr,dg=g-pg,db=b-pb;
    if(dr*dr+dg*dg+db*db<=tolerance*tolerance)return true;
  }
  return false;
}
function hexPalette(colors){
  return colors.map(c=>{const v=parseInt(c.slice(1),16);return[v>>16&255,v>>8&255,v&255];});
}

// Compare the live/twin native frames inside a box around one event.
// Returns {changed, goodShare, badShare} over the changed-pixel set.
function eventDelta(live,twin,event,options){
  const radius=options.radius,tolerance=options.paletteTolerance;
  const width=live.width,height=live.height;
  const x0=clamp(event.sx-radius,0,width-1),x1=clamp(event.sx+radius,0,width-1);
  const y0=clamp(event.sy-radius,0,height-1),y1=clamp(event.sy+radius,0,height-1);
  let changed=0,good=0,bad=0;
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const i=(y*width+x)*4;
    const dr=live.rgba[i]-twin.rgba[i],dg=live.rgba[i+1]-twin.rgba[i+1],db=live.rgba[i+2]-twin.rgba[i+2];
    if(Math.abs(dr)+Math.abs(dg)+Math.abs(db)<12)continue;
    changed++;
    if(colorNear(live.rgba[i],live.rgba[i+1],live.rgba[i+2],options.goodPalette,tolerance))good++;
    if(colorNear(live.rgba[i],live.rgba[i+1],live.rgba[i+2],options.badPalette,tolerance))bad++;
  }
  return{changed,goodPixels:good,badPixels:bad,
    goodShare:changed?good/changed:0,badShare:changed?bad/changed:0,box:{x0,y0,x1,y1}};
}

/* Run the lockstep pair and sample every new ledger event.
 * options: {
 *   seed, frames,            simulation length
 *   ablation                 global switch name (default '__NO_PAYOFF_FX')
 *   feedbackProbe            probe name (default '__feedbackProbe')
 *   signatureProbe           REQUIRED game signature fn name for the no-op proof
 *   poll                     frames between ledger polls/snapshots (default 5;
 *                            must stay under the shortest-lived FX)
 *   radius                   half-size of the event crop (default 26)
 *   perCategory              max sampled events per category (default 4)
 *   goodPalette,badPalette   arrays of '#rrggbb' signature colors
 *   paletteTolerance         RGB distance for a palette match (default 55)
 * }
 */
function runFeedbackVisibility(name,options){
  const ablation=options.ablation||'__NO_PAYOFF_FX';
  const probeName=options.feedbackProbe||'__feedbackProbe';
  const poll=options.poll||5,perCategory=options.perCategory===undefined?4:options.perCategory;
  const deltaOptions={
    radius:options.radius||26,
    paletteTolerance:options.paletteTolerance||55,
    goodPalette:hexPalette(options.goodPalette),
    badPalette:hexPalette(options.badPalette)
  };
  const live=bootRenderedGame(name,{seed:options.seed});
  const twin=bootRenderedGame(name,{seed:options.seed});
  twin.sandbox[ablation]=1;
  if(typeof live.sandbox[probeName]!=='function')
    throw new Error(`${name} must expose ${probeName}() for the feedback contract`);
  const samples=[],counts={},sampled={};
  let seenSerial=-1,frame=0;
  while(frame<options.frames){
    frame+=poll;
    live.advanceTo(frame,{renderEvery:poll,renderLast:true});
    twin.advanceTo(frame,{renderEvery:poll,renderLast:true});
    const probe=live.sandbox[probeName]();
    if(probe.finite===false)throw new Error(`${name} feedback probe went non-finite at frame ${frame}`);
    const fresh=probe.events.filter(e=>e.serial>seenSerial);
    if(!fresh.length)continue;
    seenSerial=probe.events.at(-1).serial;
    let snapLive=null,snapTwin=null;
    for(const event of fresh){
      const key=event.kind+':'+event.id;
      counts[key]=(counts[key]||0)+1;
      if((sampled[key]||0)>=perCategory)continue;
      sampled[key]=(sampled[key]||0)+1;
      if(!snapLive){snapLive=live.snapshot({native:true});snapTwin=twin.snapshot({native:true});}
      const delta=eventDelta(snapLive,snapTwin,event,deltaOptions);
      samples.push(Object.assign({key,kind:event.kind,id:event.id,frame:event.show,
        lag:frame-event.show,sx:event.sx,sy:event.sy},delta));
    }
  }
  const signaturesMatch=options.signatureProbe?
    live.evaluate(options.signatureProbe+'()')===twin.evaluate(options.signatureProbe+'()'):null;
  return{samples,counts,sampled,signaturesMatch,frames:options.frames,seed:options.seed};
}

/* Assert the contract over one or more runFeedbackVisibility results.
 * limits: {
 *   required        [ 'good:escape', ... ] categories that must appear in the
 *                   union of runs (coverage is part of the fixture contract)
 *   minChanged      { default, 'good:near-miss': smaller, ... } minimum
 *                   changed pixels for a sampled event to count as visible
 *   minSignature    { default, per-key } minimum ABSOLUTE pixels of the
 *                   event's own palette (good colors for good events, bad for
 *                   bad) among the changed pixels. Absolute, not a share:
 *                   concurrent feedback (skid rubber under a slide, a glory
 *                   trail during a graze) legitimately shares the crop, but
 *                   the beat's own signature color must still be present.
 *   maxInvisible    sampled events allowed below their pixel floor (default 0)
 * }
 */
function assertFeedback(label,runs,limits,fail){
  const required=limits.required||[];
  const floorOf=(table,key,fallback)=>{const t=table||{};
    return t[key]===undefined?(t.default===undefined?fallback:t.default):t[key];};
  const maxInvisible=limits.maxInvisible||0;
  const seen=new Set();
  let invisible=0;
  for(const run of runs){
    if(run.signaturesMatch===false)fail(`${label}: FX ablation changed the simulation signature`);
    for(const key of Object.keys(run.counts))seen.add(key);
    for(const sample of run.samples){
      const floor=floorOf(limits.minChanged,sample.key,12);
      const sigFloor=floorOf(limits.minSignature,sample.key,8);
      if(sample.changed<floor){invisible++;
        fail(`${label}: ${sample.key} at frame ${sample.frame} drew only ${sample.changed}px of feedback (floor ${floor})`);continue;}
      const sig=sample.kind==='good'?sample.goodPixels:sample.badPixels;
      if(sig<sigFloor)
        fail(`${label}: ${sample.key} at frame ${sample.frame} carried ${sig}px of its ${sample.kind}-palette signature (floor ${sigFloor})`);
    }
  }
  for(const key of required)if(!seen.has(key))
    fail(`${label}: required feedback category ${key} never fired`);
  if(invisible>maxInvisible)fail(`${label}: ${invisible} sampled events were invisible (allowed ${maxInvisible})`);
  return{seen:[...seen].sort(),invisible};
}

function feedbackLine(runs){
  const totals={};let samples=0,minChanged=Infinity;
  for(const run of runs)for(const sample of run.samples){samples++;
    totals[sample.kind]=(totals[sample.kind]||0)+1;minChanged=Math.min(minChanged,sample.changed);}
  return`${samples} sampled beats (${totals.good||0} good / ${totals.bad||0} bad), thinnest ${minChanged===Infinity?'-':minChanged}px`;
}

module.exports={runFeedbackVisibility,assertFeedback,feedbackLine};
