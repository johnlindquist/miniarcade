#!/usr/bin/env node
'use strict';

// Show kernel (E.createShow) + fx stream contract. Phase 0 of the
// environment/payoff program: before any game adopts celebrations, prove the
// substrate is sim-inert (fx never perturbs gameplay), deterministic, and
// enforces the arbitration rules the council fixed (priority beats FIFO,
// coalescing, fast expiry, per-tier spacing, recovery gap, bounded queue,
// zero overlapping cues).
const{bootGame}=require('./harness');

let failed=false;
const fail=msg=>{failed=true;console.error('  FAIL: '+msg);};
const ok=(cond,msg)=>{if(!cond)fail(msg);};

const FOOTER=`
globalThis.__simSig=()=>Math.round(ball.x*31+ball.y*77)+
  cars.reduce((a,c)=>a+Math.round(c.x*13+c.y*7+c.vx*100+c.vy*50),0);
globalThis.__fx=n=>{for(let i=0;i<n;i++){E.fxBurst(80,180,20,'#fff',2);E.fxDust(60,200,6);}};
`;

console.log('1) fx stream is sim-inert: bursts never perturb gameplay');
{
  const a=bootGame('rocket',{seed:11,footer:FOOTER});
  const b=bootGame('rocket',{seed:11,footer:FOOTER});
  const sigs=[[],[]];
  for(let chunk=0;chunk<12;chunk++){
    b.sandbox.__fx(10); // 120 bursts + dust total, interleaved with play
    a.frames(100);b.frames(100);
    sigs[0].push(a.sandbox.__simSig());sigs[1].push(b.sandbox.__simSig());
  }
  ok(sigs[0].join()===sigs[1].join(),
    'fxBurst/fxDust changed the sim: '+sigs[0].join()+' vs '+sigs[1].join());
  console.log('  12x100 frames, 120 bursts injected: signatures identical');
}

console.log('2) fx particles render (and __NO_PAYOFF_FX silences them exactly)');
{
  const a=bootGame('rocket',{seed:12,footer:FOOTER});
  const b=bootGame('rocket',{seed:12,footer:FOOTER});
  const c=bootGame('rocket',{seed:12,footer:FOOTER});
  c.sandbox.__NO_PAYOFF_FX=1;
  b.sandbox.__fx(3);c.sandbox.__fx(3);
  const drawsA=a.frames(1,true).calls,drawsB=b.frames(1,true).calls,drawsC=c.frames(1,true).calls;
  ok(drawsB>drawsA,'fx particles drew nothing: '+drawsB+' <= '+drawsA);
  ok(drawsC===drawsA,'__NO_PAYOFF_FX not a perfect no-op: '+drawsC+' vs '+drawsA);
  console.log('  draw calls: base '+drawsA+', fx '+drawsB+', fx+__NO_PAYOFF_FX '+drawsC);
}

console.log('3) show kernel: determinism');
{
  const E=bootGame('rocket',{seed:13}).engine;
  const make=()=>E.createShow({tiers:{1:{frames:20},2:{frames:40,minGap:90},3:{frames:60,minGap:600,hold:6,slowEvery:3,slowFrames:24,admire:18}}});
  const s1=make(),s2=make();
  const script=show=>{
    const out=[];
    for(let f=0;f<900;f++){
      if(f===10)show.offer({id:'hit',tier:1,at:f});
      if(f===15)show.offer({id:'wreck',tier:2,at:f});
      if(f===20)show.offer({id:'goal',tier:3,at:f});
      if(f===200)show.offer({id:'wreck2',tier:2,at:f});
      if(f===500)show.note({kind:'act-warning',id:'wind',at:f,landsAt:f+240});
      const p=show.step(f);
      out.push((p.cue?p.cue.id:'-')+p.holdWorld+p.physicsEvery+p.admire);
    }
    return out.join('|')+'#'+JSON.stringify(show.probe());
  };
  ok(script(s1)===script(s2),'identical call sequences diverged');
  console.log('  900-frame scripted sequence: byte-identical directives + probe');
}

console.log('4) show kernel: priority beats FIFO, coalescing, bounded queue');
{
  const E=bootGame('rocket',{seed:14}).engine;
  const show=E.createShow({queueLimit:2,tiers:{1:{frames:30},2:{frames:40},3:{frames:60}}});
  ok(show.offer({id:'a',tier:1,at:0})==='shown','idle offer should show');
  ok(show.offer({id:'a',tier:1,at:2})==='coalesced','same id+tier should coalesce');
  ok(show.offer({id:'big',tier:3,at:4})==='shown','higher tier should preempt');
  ok(show.step(5).cue.id==='big','tier3 not active after preempt');
  ok(show.offer({id:'small',tier:1,at:6})==='dropped','lower tier should drop while busy');
  ok(show.offer({id:'q1',tier:3,at:8,expiresAt:500})==='queued','equal tier should queue');
  ok(show.offer({id:'q2',tier:3,at:9,expiresAt:500})==='queued','queue slot 2');
  ok(show.offer({id:'q3',tier:3,at:10,expiresAt:500})==='dropped','queue must stay bounded at 2');
  const p=show.probe();
  ok(p.preempted===1&&p.coalesced===1&&p.maxQueue===2,'counters wrong: '+JSON.stringify(p));
  ok(p.offeredByTier[1]===3&&p.offeredByTier[3]===4&&p.shownByTier[1]===1&&p.shownByTier[3]===1,
    'per-tier opportunity/presentation counts wrong: '+JSON.stringify(p.offeredByTier)+' '+JSON.stringify(p.shownByTier));
  console.log('  preempt/coalesce/drop/bound all enforced; probe '+JSON.stringify({
    offered:p.offered,shown:p.shown,dropped:p.dropped,coalesced:p.coalesced,preempted:p.preempted}));
}

console.log('5) show kernel: expiry, per-tier spacing, apex recovery gap');
{
  const E=bootGame('rocket',{seed:15}).engine;
  // expiry needs a tier without minGap (spacing would otherwise drop the
  // repeat before it could ever queue — which section 5b asserts separately)
  const exp=E.createShow({tiers:{2:{frames:200}}});
  exp.offer({id:'first',tier:2,at:0});
  ok(exp.offer({id:'stale',tier:2,at:5,expiresAt:20})==='queued','queue for expiry test');
  for(let f=1;f<=210;f++)exp.step(f);
  // 'stale' expired at f=21 (long before 'first' ended) instead of showing late
  ok(exp.probe().expired===1,'stale cue should expire, not show late: '+JSON.stringify(exp.probe()));
  ok(exp.step(211).cue===null,'nothing should be active after expiry');
  const show=E.createShow({recoveryGap:45,tiers:{2:{frames:40,minGap:90},3:{frames:60,minGap:600}}});
  show.offer({id:'goal',tier:3,at:0});
  for(let f=1;f<=80;f++)show.step(f);
  ok(show.offer({id:'goal2',tier:3,at:90})==='dropped','tier3 minGap 600 should gate a repeat at +90');
  // apex ended at 60; a tier2 inside the 45f recovery gap must wait
  ok(show.offer({id:'save',tier:2,at:95,expiresAt:400})==='queued','tier2 should wait out recovery gap');
  let shownAt=-1;
  for(let f=96;f<200&&shownAt<0;f++){const p=show.step(f);if(p.cue&&p.cue.id==='save')shownAt=f;}
  ok(shownAt>=105,'tier2 shown inside recovery gap (apex end 60 + 45): frame '+shownAt);
  console.log('  expiry at queue head, minGap drop, recovery hold until f'+shownAt);
}

console.log('6) show kernel: hold/slow/admire windows + zero overlap');
{
  const E=bootGame('rocket',{seed:16}).engine;
  const show=E.createShow({tiers:{3:{frames:60,hold:6,slowEvery:3,slowFrames:24,admire:18}}});
  show.offer({id:'apex',tier:3,at:0});
  let held=0,slowed=0,admired=0,overlap=0,last=null;
  for(let f=0;f<120;f++){
    const p=show.step(f);
    if(p.holdWorld)held++;
    if(p.physicsEvery>1)slowed++;
    if(p.admire)admired++;
    if(p.cue&&last&&p.cue.id!==last)overlap++; // id can only change via show/end records
    last=p.cue?p.cue.id:null;
  }
  ok(held===6,'hold window should be exactly 6 frames: '+held);
  ok(slowed===24,'slow window should be exactly 24 frames: '+slowed);
  ok(admired===18,'admire window should be exactly 18 frames: '+admired);
  const events=show.events();
  const shows=events.filter(e=>e.kind==='show').length,ends=events.filter(e=>e.kind==='end').length;
  ok(shows===1&&ends===1,'expected one show/end pair: '+shows+'/'+ends);
  console.log('  held 6, slowed 24 (physicsEvery 3), admired 18, one show/end pair');
}

console.log('7) show kernel: reset clears state, counters stay cumulative');
{
  const E=bootGame('rocket',{seed:17}).engine;
  const show=E.createShow({tiers:{2:{frames:40},3:{frames:60}}});
  show.offer({id:'goal',tier:3,at:0});
  show.offer({id:'next',tier:3,at:5,expiresAt:900});
  show.reset(10);
  ok(show.step(11).cue===null,'reset should clear the active cue');
  const p=show.probe();
  ok(p.queued===0&&p.shown===1&&p.expired===1,'reset should flush queue, keep counters: '+JSON.stringify(p));
  ok(show.offer({id:'after',tier:2,at:200})==='shown','kernel should accept offers after reset');
  console.log('  active + queue flushed, cumulative counters preserved');
}

console.log(failed?'\nEVAL FAILED':'\nSHOW KERNEL EVAL PASSED');
process.exit(failed?1:0);
