'use strict';
/* Shared 10-minute autoplay soak.
 *
 * The three invariants that make or break watchability, per VISION.md:
 * players are MOVING, things are HAPPENING, and PROGRESS is being made.
 * A stuck bot or a silently broken game must fail here, on every game.
 *
 * Each game's eval installs a `__soakProbe` via its boot footer:
 *   __soakProbe() -> {sig, events, progress, finite}
 *     sig      motion signature — any number that changes while actors move
 *     events   cumulative visible-activity count (hits, kills, matches, ...)
 *     progress cumulative forward-story count (goals, solves, deliveries, ...)
 *     finite   false once any tracked numeric state goes non-finite
 * Counters must be cumulative across attract-mode resets (wrap functions in
 * the footer; do not read per-life globals that reset on death).
 */
const{bootGame}=require('./harness');

function runSoak(name,options){
  const game=bootGame(name,{seed:options.seed,footer:options.footer});
  const seconds=Math.round((options.minutes||10)*60);
  const samples=[];
  for(let s=0;s<seconds;s++){
    game.frames(60,false);
    samples.push(game.sandbox.__soakProbe());
  }
  return{game,samples};
}

function analyzeSoak(samples){
  let maxStill=0,still=0,maxQuiet=0,quiet=0,maxStall=0,stall=0,finite=true,last=null;
  for(const p of samples){
    if(!p.finite)finite=false;
    if(last){
      still=p.sig===last.sig?still+1:0;
      quiet=p.events>last.events?0:quiet+1;
      stall=p.progress>last.progress?0:stall+1;
      if(still>maxStill)maxStill=still;
      if(quiet>maxQuiet)maxQuiet=quiet;
      if(stall>maxStall)maxStall=stall;
    }
    last=p;
  }
  const end=samples[samples.length-1];
  return{maxStillSec:maxStill,maxQuietSec:maxQuiet,maxStallSec:maxStall,
    events:end.events,progress:end.progress,finite,minutes:samples.length/60};
}

// limits: {still, quiet, stall (seconds), minEvents, minProgress}
function assertSoak(label,report,limits,fail){
  const bad=[];
  if(!report.finite)bad.push('non-finite state');
  if(report.maxStillSec>limits.still)
    bad.push(`world froze for ${report.maxStillSec}s (limit ${limits.still}s)`);
  if(report.maxQuietSec>limits.quiet)
    bad.push(`no visible activity for ${report.maxQuietSec}s (limit ${limits.quiet}s)`);
  if(report.maxStallSec>limits.stall)
    bad.push(`no progress for ${report.maxStallSec}s (limit ${limits.stall}s)`);
  if(report.events<limits.minEvents)
    bad.push(`only ${report.events} activity events in ${report.minutes} min (floor ${limits.minEvents})`);
  if(report.progress<limits.minProgress)
    bad.push(`only ${report.progress} progress marks in ${report.minutes} min (floor ${limits.minProgress})`);
  for(const b of bad)fail(`${label}: ${b}`);
  return bad.length===0;
}

const soakLine=r=>`still ${r.maxStillSec}s, quiet ${r.maxQuietSec}s, stall ${r.maxStallSec}s, `+
  `${r.events} events, ${r.progress} progress`;

module.exports={runSoak,analyzeSoak,assertSoak,soakLine};
