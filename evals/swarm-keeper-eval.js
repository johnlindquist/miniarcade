#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');

const FOOTER=`
globalThis.__skApplied=[];
{const __a0=applyIntent;applyIntent=intent=>{const out=__a0(intent);globalThis.__skApplied.push({
  frame:runFrame,moveX:intent.moveX,advance:!!intent.advance,job:intent.job,workers:intent.workers,
  rescueId:intent.rescueId,rescueWorkers:intent.rescueWorkers,tactic:intent.tactic});
  if(globalThis.__skApplied.length>240)globalThis.__skApplied.shift();return out;};}
globalThis.__skClearApplied=()=>{globalThis.__skApplied.length=0;};
globalThis.__skLastApplied=()=>globalThis.__skApplied.at(-1)||null;
globalThis.__skRoute=()=>({routeSeed,persona:persona.name,challenges:challenges.map(c=>({kind:c.kind,x:c.x,y:c.y,side:c.side})),
  roles:members.map(m=>m.role)});
globalThis.__skPlanOnce=()=>baseIntent(true);
globalThis.__skSkill=()=>({skill:crewSkill.skill,precision:crewSkill.precision,risk:crewSkill.risk,
  status:crewSkill.status(runFrame)});
globalThis.__skNestedFiniteFixture=()=>{const c=challenges.find(c=>c.enemies&&c.enemies.length),e=c.enemies[0],x=e.x;
  e.x=NaN;const finite=allFinite();e.x=x;return finite;};
globalThis.__skEndingLog=[];
{const __e0=finishJourney;finishJourney=()=>{const before=stats.endings,out=__e0();
  if(stats.endings>before)globalThis.__skEndingLog.push({showFrame,runFrame,y:leader.y,swarm:swarmCount(),
    losses:stats.losses,clears:stats.clears,outcome,state});return out;};}
globalThis.__skMaxStep=0;
{const __s0=stepMembers;stepMembers=()=>{const before=new Map(members.map(m=>[m.id,[m.x,m.y,m.state]])),out=__s0();
  for(const m of members){const p=before.get(m.id);if(!p||p[2]!==m.state)continue;
    globalThis.__skMaxStep=Math.max(globalThis.__skMaxStep,Math.hypot(m.x-p[0],m.y-p[1]));}return out;};}
`;

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const mean=a=>a.reduce((n,v)=>n+v,0)/a.length;
const range=a=>[Math.min(...a),Math.max(...a)];
const inBands=(p,bands,label)=>{for(const[k,[lo,hi]]of Object.entries(bands)){
  const v=k==='swarm'?p.swarm:k==='journeyY'?p.leader.y:p.stats[k];
  if(v<lo||v>hi)fail(`${label}: ${k} ${v} outside measured band ${lo}..${hi}`);
}};
const pairNotes=(p,id,warn,minPairs,label)=>{
  const notes=p.acts.notes.filter(n=>n.id===id),warnings=notes.filter(n=>n.kind==='act-warning'),lands=notes.filter(n=>n.kind==='act-land');
  if(warnings.length<minPairs||lands.length!==warnings.length)
    fail(`${label}: ${id} emitted ${warnings.length} warnings / ${lands.length} lands (need ${minPairs}+ complete pairs)`);
  for(let i=0;i<Math.min(warnings.length,lands.length);i++)if(lands[i].tag-warnings[i].tag!==warn)
    fail(`${label}: ${id} pair ${i} warned ${lands[i].tag-warnings[i].tag}f, expected ${warn}`);
  return warnings.length;
};

// Thirty fixed ten-minute seeds were measured on 2026-07-10 before these
// permanent bands were set (0x6500 + i*211). Observed min..max:
// clears 13..13, swarm 22..25, journey y 2904.5..3004.8, downs 12..14,
// rescues 10..13, losses 1..2, growth 12..14, work beats 52..52,
// beetles 10..13, trail beats 80..83, landmarks 3..3, lapses 0..9,
// rallies 0..0, events 219..229, progress 161..165, event lull 646..656f,
// progress lull 646..679f, shown tiers 138..150 / 26..33 / 3,
// and exact 18 held / 72 slowed / 144 admire frames. Bands add margin on
// both sides; notably, losses have a lower bound because emotional cost is a
// design contract rather than a failure to optimize away.
const WATCH_BANDS={
  clears:[12,14],swarm:[19,27],journeyY:[2800,3120],bridges:[2,5],carries:[2,5],
  fights:[2,5],lostlings:[2,5],downs:[8,16],rescues:[7,14],losses:[1,5],growth:[10,17],
  workBeats:[48,56],enemies:[8,16],trailBeats:[75,90],landmarks:[3,4],lapses:[0,12],
  rallies:[0,1],events:[200,245],progress:[150,175]
};

// The coherent ablation is the original one-worker greedy policy restored by
// __NO_CREW_PLAN. A baseline-first 10-pair five-minute panel (0x5a00+i*173)
// measured: baseline clears 5, rescues 1..2, losses 3..4, events 87..94,
// progress 65..67, y 1235..1302; coordinated clears 6, rescues 4..6,
// losses 1, events 104..108, progress 77..79, y 1471..1503. Both policies
// remained finite, active, and rescue-capable. These policy bands add margin.
const POLICY_BANDS={clears:[4,7],rescues:[0,6],losses:[0,5],downs:[3,8],events:[78,114],
  progress:[58,84],swarm:[11,19],journeyY:[1200,1580],rallies:[0,1]};

console.log('1) deterministic fixed-step replay, batching, render parity, and planner purity');
{
  const a=bootGame('swarm-keeper',{seed:0x5101,footer:FOOTER}),b=bootGame('swarm-keeper',{seed:0x5101,footer:FOOTER}),
    rendered=bootGame('swarm-keeper',{seed:0x5101,footer:FOOTER});
  a.frames(7200,false);b.frames(7200,false);rendered.frames(7200,true);
  const sa=a.sandbox.__swarmKeeperSignature(),sb=b.sandbox.__swarmKeeperSignature(),sr=rendered.sandbox.__swarmKeeperSignature();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${rendered.counter.calls} canvas calls`);
  if(sa!==sb)fail('same seed diverged under identical 60 Hz steps');
  if(sa!==sr)fail('render traversal changed simulation or the engine RNG stream');
  if(!a.sandbox.__swarmKeeperProbe().finite)fail('deterministic replay ended non-finite');
  if(a.sandbox.__skNestedFiniteFixture())fail('nested enemy non-finite state escaped the probe');
  const mono=bootGame('swarm-keeper',{seed:0x5102,footer:FOOTER}),chunk=bootGame('swarm-keeper',{seed:0x5102,footer:FOOTER});
  mono.frames(18000,false);for(let i=0;i<1800;i++)chunk.frames(10,false);
  const same=mono.sandbox.__swarmKeeperSignature()===chunk.sandbox.__swarmKeeperSignature();
  console.log(`  18,000 monolithic vs 1,800 x 10 steps: ${same?'identical':'DIFFERENT'}`);
  if(!same)fail('batch size changed the fixed-step result');
  const planned=bootGame('swarm-keeper',{seed:0x5103,footer:FOOTER}),control=bootGame('swarm-keeper',{seed:0x5103,footer:FOOTER});
  const before=planned.sandbox.__swarmKeeperSignature(),p1=planned.sandbox.__skPlanOnce(),p2=planned.sandbox.__skPlanOnce(),after=planned.sandbox.__swarmKeeperSignature();
  const rp=planned.sandbox.__swarmKeeperNextRandom(),rc=control.sandbox.__swarmKeeperNextRandom();
  console.log(`  crew plan repeat ${JSON.stringify(p1)===JSON.stringify(p2)}, pure ${before===after}, next RNG ${rp.toFixed(8)}/${rc.toFixed(8)}`);
  if(JSON.stringify(p1)!==JSON.stringify(p2)||before!==after||rp!==rc)fail('crew planning was stateful or consumed engine RNG');
}

console.log('2) generated journey + shared controller intent: varied roads, four roles, two-Enter manual gate');
{
  const routes=[],personas=new Set();
  for(let i=0;i<8;i++){
    const g=bootGame('swarm-keeper',{seed:0x6500+i*211,footer:FOOTER}),r=g.sandbox.__skRoute();routes.push(JSON.stringify(r.challenges));personas.add(r.persona);
    if(r.challenges.length!==20||new Set(r.challenges.map(c=>c.kind)).size!==4)fail(`seed ${i}: route omitted a job family`);
    if(new Set(r.roles).size!==4)fail(`seed ${i}: opening swarm omitted a role family`);
  }
  console.log(`  ${new Set(routes).size}/8 distinct roads; ${personas.size} personas`);
  if(new Set(routes).size!==8||personas.size<3)fail('seeded journey/persona generation lacks visible variety');

  const game=bootGame('swarm-keeper',{seed:0x5210,footer:FOOTER}),initial=game.sandbox.__swarmKeeperManual();
  press(game,'Enter');const instructions=game.sandbox.__swarmKeeperManual();press(game,'Enter');const started=game.sandbox.__swarmKeeperManual();
  console.log(`  playing ${initial.playing}->${instructions.playing}->${started.playing}`);
  if(initial.playing||instructions.playing||!started.playing)fail('manual session skipped the two-Enter instructions gate');
  game.sandbox.__skClearApplied();game.key('keydown','ArrowRight');game.frames(6,false);game.key('keyup','ArrowRight');
  const steer=game.sandbox.__skLastApplied();
  game.sandbox.__swarmKeeperVisualFixture('rescue');game.sandbox.__skClearApplied();
  game.key('keydown','KeyX');game.frames(3,false);game.key('keyup','KeyX');const rescue=game.sandbox.__skLastApplied();
  console.log(`  shared intents: ${steer&&steer.tactic}, target ${steer&&steer.moveX.toFixed(1)}; rescue crew ${rescue&&rescue.rescueWorkers}`);
  if(!steer||steer.tactic!=='MANUAL'||steer.moveX<=started.leader.x)fail('manual steering bypassed the common intent path');
  if(!rescue||rescue.tactic!=='MANUAL'||rescue.rescueWorkers!==2||rescue.rescueId===null)fail('manual rescue bypassed the common intent path');
  const fresh=bootGame('swarm-keeper',{seed:0x5211,footer:FOOTER});fresh.sandbox.__swarmKeeperVisualFixture('late');
  const old=fresh.sandbox.__swarmKeeperProbe();press(fresh,'Enter');press(fresh,'Enter');const clean=fresh.sandbox.__swarmKeeperProbe();
  console.log(`  takeover resets journey ledger ${old.stats.clears}->${clean.stats.clears}, losses ${old.stats.losses}->${clean.stats.losses}`);
  if(old.stats.clears!==15||clean.stats.clears!==0||clean.stats.losses!==0||!clean.playing)
    fail('fresh player journey inherited attract-mode progress or losses');
}

console.log('3) coordinated crew A/B: eight paired five-minute seeds against one-worker greedy assignment');
{
  let wins=0,smartClears=0,baseClears=0,smartRescues=0,baseRescues=0,smartLosses=0,baseLosses=0;
  const deltas=[];
  for(let i=0;i<8;i++){
    const seed=0x5a00+i*173,a=bootGame('swarm-keeper',{seed,footer:FOOTER}),b=bootGame('swarm-keeper',{seed,footer:FOOTER});
    b.sandbox.__NO_CREW_PLAN=1;a.frames(18000,false);b.frames(18000,false);
    const p=a.sandbox.__swarmKeeperProbe(),q=b.sandbox.__swarmKeeperProbe();
    inBands(p,POLICY_BANDS,`seed ${seed.toString(16)} coordinated`);inBands(q,POLICY_BANDS,`seed ${seed.toString(16)} greedy`);
    if(!p.finite||!q.finite)fail(`seed ${seed.toString(16)}: non-finite crew policy`);
    const sp=p.stats.clears*100+p.stats.rescues*12-p.stats.losses*20+p.stats.progress,
      sq=q.stats.clears*100+q.stats.rescues*12-q.stats.losses*20+q.stats.progress;
    if(sp>sq)wins++;deltas.push(sp-sq);smartClears+=p.stats.clears;baseClears+=q.stats.clears;
    smartRescues+=p.stats.rescues;baseRescues+=q.stats.rescues;smartLosses+=p.stats.losses;baseLosses+=q.stats.losses;
    console.log(`  ${seed.toString(16)} ${p.persona.padEnd(6)} coordinated ${p.stats.clears} clear/${p.stats.rescues} save/${p.stats.losses} lost `+
      `vs greedy ${q.stats.clears}/${q.stats.rescues}/${q.stats.losses} (+${sp-sq})`);
  }
  console.log(`  ${wins}/8 wins, mean composite +${mean(deltas).toFixed(1)}; clears ${smartClears}/${baseClears}, rescues ${smartRescues}/${baseRescues}, losses ${smartLosses}/${baseLosses}`);
  if(wins<7)fail(`coordinated crews won only ${wins}/8 paired seeds`);
  if(smartClears<baseClears+7)fail(`coordinated clear gain ${smartClears}/${baseClears} below seven`);
  if(smartRescues<baseRescues+10)fail(`coordinated rescue gain ${smartRescues}/${baseRescues} below ten`);
  if(smartLosses>=baseLosses)fail(`coordinated crew did not reduce visible losses (${smartLosses}/${baseLosses})`);
}

console.log('4) measured ten-minute watchability panel: movement, jobs, rescues, losses, acts, and tier shape');
{
  const seeds=[0x6500,0x691f,0x6e11,0x7b41],runs=[];
  for(const seed of seeds){
    const g=bootGame('swarm-keeper',{seed,footer:FOOTER});g.frames(36000,false);const p=g.sandbox.__swarmKeeperProbe();runs.push(p);
    inBands(p,WATCH_BANDS,`seed ${seed.toString(16)} ${p.persona}`);
    pairNotes(p,'surge',240,4,`seed ${seed.toString(16)}`);pairNotes(p,'owl',210,3,`seed ${seed.toString(16)}`);
    if(!p.finite)fail(`seed ${seed.toString(16)}: non-finite actor or challenge`);
    if(p.maxEventLull>720||p.maxProgressLull>720)fail(`seed ${seed.toString(16)}: lulls ${p.maxEventLull}/${p.maxProgressLull} exceed 12s`);
    if(p.memorials!==p.stats.losses||p.swarm!==12+p.stats.growth-p.stats.losses)
      fail(`seed ${seed.toString(16)}: physical bodies/memorials disagree with growth and loss ledger`);
    if(g.sandbox.__skMaxStep>1.05)fail(`seed ${seed.toString(16)}: a member teleported ${g.sandbox.__skMaxStep.toFixed(3)}px in one step`);
    const s=p.show.shownByTier;
    if(!((s[1]||0)>(s[2]||0)&&(s[2]||0)>(s[3]||0)&&(s[3]||0)>=3))fail(`seed ${seed.toString(16)}: shown ladder not strictly ordered ${JSON.stringify(s)}`);
    console.log(`  ${seed.toString(16)} ${p.persona.padEnd(6)}: ${p.stats.clears} jobs, swarm ${p.swarm}, `+
      `${p.stats.rescues} rescued/${p.stats.losses} lost, ${p.stats.events} events/${p.stats.progress} progress, `+
      `lulls ${(p.maxEventLull/60).toFixed(1)}/${(p.maxProgressLull/60).toFixed(1)}s, tiers ${s[1]}/${s[2]}/${s[3]}`);
  }
  const losses=runs.map(p=>p.stats.losses),rescues=runs.map(p=>p.stats.rescues);
  console.log(`  panel losses ${range(losses).join('..')}; rescues ${range(rescues).join('..')}`);
}

console.log('5) shared skillProfile imperfection: bounded onsets and a perfect ablation');
{
  const normal=bootGame('swarm-keeper',{seed:0x691f,footer:FOOTER}),perfect=bootGame('swarm-keeper',{seed:0x691f,footer:FOOTER});
  perfect.sandbox.__NO_LAPSE=1;normal.frames(36000,false);perfect.frames(36000,false);
  const a=normal.sandbox.__swarmKeeperProbe(),b=perfect.sandbox.__swarmKeeperProbe(),skill=normal.sandbox.__skSkill();
  console.log(`  skill ${skill.skill.toFixed(2)} precision ${skill.precision.toFixed(2)} risk ${skill.risk.toFixed(2)}: ${a.stats.lapses} onsets; ablated ${b.stats.lapses}`);
  if(a.stats.lapses<1||a.stats.lapses>12)fail(`skillProfile lapse onsets ${a.stats.lapses} outside measured 1..12 fixture band`);
  if(b.stats.lapses!==0)fail('__NO_LAPSE did not restore a perfect count');
  if(a.stats.clears<12||b.stats.clears<12)fail('normal or perfect profile fell below the journey competence floor');
}

console.log('6) environmental acts: exact warning pairs and first physical divergence before land');
for(const spec of[{id:'surge',warn:240,tactic:'CLIMB TO HIGH GROUND'},{id:'owl',warn:210,tactic:'HUDDLE UNDER COVER'}]){
  const a=bootGame('swarm-keeper',{seed:0xade0,footer:FOOTER}),b=bootGame('swarm-keeper',{seed:0xade0,footer:FOOTER});
  a.sandbox.__swarmKeeperSetAct(spec.id);b.sandbox.__swarmKeeperSetAct(spec.id);b.sandbox.__NO_ACTS=1;
  let first=-1,phase='',tactic='';
  for(let f=1;f<=spec.warn+80;f++){
    a.frames(1,false);b.frames(1,false);
    if(first<0&&a.sandbox.__swarmKeeperMotion()!==b.sandbox.__swarmKeeperMotion()){
      first=f;const p=a.sandbox.__swarmKeeperProbe();phase=p.acts[spec.id];tactic=p.leader.tactic;break;
    }
  }
  a.frames(spec.warn+160,false);b.frames(spec.warn+160,false);
  const p=a.sandbox.__swarmKeeperProbe(),q=b.sandbox.__swarmKeeperProbe(),notes=p.acts.notes.filter(n=>n.id===spec.id),
    warning=notes.find(n=>n.kind==='act-warning'),land=notes.find(n=>n.kind==='act-land');
  console.log(`  ${spec.id}: ${warning&&land?land.tag-warning.tag:'?'}f warning; first body/intent divergence ${first}f in ${phase}, ${tactic}`);
  if(!warning||!land||land.tag-warning.tag!==spec.warn)fail(`${spec.id}: warning/land pair was not exactly ${spec.warn} simulation frames`);
  if(first<0||phase!=='warn'||tactic!==spec.tactic)fail(`${spec.id}: first physical divergence was not its legible warning response`);
  if(q.acts.notes.some(n=>n.id===spec.id))fail(`__NO_ACTS emitted ${spec.id} notes`);
}
{
  const g=bootGame('swarm-keeper',{seed:0xade1,footer:FOOTER});g.sandbox.__swarmKeeperSetAct('surge');g.frames(80,false);
  const warning=g.sandbox.__swarmKeeperProbe();press(g,'Enter');press(g,'Enter');const reset=g.sandbox.__swarmKeeperProbe();g.frames(420,false);
  const stale=g.sandbox.__swarmKeeperProbe().acts.notes.filter(n=>n.id==='surge'&&n.kind==='act-land').length;
  console.log(`  session reset during warning: ${warning.acts.surge}->${reset.acts.surge}; stale lands ${stale}`);
  if(warning.acts.surge!=='warn'||reset.acts.surge!=='calm'||stale!==0)fail('reset leaked a stale flood landing');
}

console.log('7) payoff ladder + earned ending: strict frequencies and exact 6/24/48 apex budgets');
{
  const g=bootGame('swarm-keeper',{seed:0x6500,footer:FOOTER});g.frames(36000,false);const p=g.sandbox.__swarmKeeperProbe(),s=p.show.shownByTier,s3=s[3]||0,
    admire=g.sandbox.__swarmKeeperAdmireFixture();
  console.log(`  shown ${JSON.stringify(s)}; hold ${p.show.heldFrames}, slow ${p.show.slowedFrames}, admire ${p.show.admireFrames}; gate ${admire.admired}/${admire.gated}`);
  if(!((s[1]||0)>(s[2]||0)&&(s[2]||0)>s3&&s3>=3))fail(`payoff ladder not strictly ordered: ${JSON.stringify(s)}`);
  if(p.show.heldFrames!==6*s3)fail(`apex hitstop ${p.show.heldFrames} != 6*${s3}`);
  if(p.show.slowedFrames!==24*s3)fail(`apex slow motion ${p.show.slowedFrames} != 24*${s3}`);
  if(p.show.admireFrames!==48*s3)fail(`apex admire ${p.show.admireFrames} != 48*${s3}`);
  if(admire.admired!=='REMEMBER THIS MOMENT'||admire.gated==='REMEMBER THIS MOMENT')fail(`__NO_ADMIRE did not gate the bot-only pause: ${JSON.stringify(admire)}`);
}
{
  const g=bootGame('swarm-keeper',{seed:0x6500,footer:FOOTER});
  while(!g.sandbox.__skEndingLog.length&&g.sandbox.__swarmKeeperProbe().showFrame<60000)g.frames(300,false);
  g.frames(240,false);const end=g.sandbox.__skEndingLog[0],p=g.sandbox.__swarmKeeperProbe(),s3=p.show.shownByTier[3]||0;
  console.log(`  ending at ${(end&&end.showFrame/60).toFixed(1)}s, ${end&&end.clears} jobs, ${end&&end.swarm} arrived/${end&&end.losses} remembered; `+
    `budgets ${p.show.heldFrames}/${p.show.slowedFrames}/${p.show.admireFrames} over ${s3} apexes`);
  if(!end||end.state!=='ending'||end.outcome!=='STAR GARDEN REACHED'||end.clears!==20||end.runFrame<50000||end.runFrame>55000)
    fail(`journey did not earn a roughly fifteen-minute ending: ${JSON.stringify(end)}`);
  if(p.show.heldFrames!==6*s3||p.show.slowedFrames!==24*s3||p.show.admireFrames!==48*s3)
    fail('ending failed to drain the active apex to exact budgets');
}

console.log('8) payoff-FX parity: the separate particle stream is a perfect simulation no-op');
{
  const a=bootGame('swarm-keeper',{seed:0x5f01,footer:FOOTER}),b=bootGame('swarm-keeper',{seed:0x5f01,footer:FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;a.frames(18000,false);b.frames(18000,false);
  const same=a.sandbox.__swarmKeeperSignature()===b.sandbox.__swarmKeeperSignature();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} after ${a.sandbox.__swarmKeeperProbe().stats.workBeats} work payoffs`);
  if(!same)fail('__NO_PAYOFF_FX changed a body, challenge, act, loss, or outcome');
}

console.log('9) shared ten-minute autoplay soak: the swarm moves, acts, and advances without rescues from the engine');
{
  const{samples}=runSoak('swarm-keeper',{seed:0x6500,footer:FOOTER,minutes:10}),report=analyzeSoak(samples);
  console.log('  '+soakLine(report));
  assertSoak('swarm-keeper soak',report,{still:2,quiet:13,stall:13,minEvents:200,minProgress:150},fail);
}

console.log('10) viewer story: plain goal and assignment truth, presentation-only rendered A/B');
{
  const g=bootGame('swarm-keeper',{seed:0x6001,footer:FOOTER});g.frames(1,true);let v=g.sandbox.__swarmKeeperViewerProbe();
  console.log(`  opening "${v.drawn.title}" / "${v.drawn.verb}" / ${v.drawn.goal}`);
  if(!v.enabled||v.drawn.title!=='SWARM KEEPER'||v.drawn.swarm!==v.truth.swarm||v.drawn.zone!==v.truth.zone||v.drawn.verb!==v.truth.verb)
    fail(`opening viewer story disagreed with simulation: ${JSON.stringify(v)}`);
  g.frames(11999,false);g.frames(1,true);v=g.sandbox.__swarmKeeperViewerProbe();const p=g.sandbox.__swarmKeeperProbe();
  if(v.drawn.swarm!==p.swarm||v.drawn.goal!=='STAR GARDEN '+p.stats.clears+'/20'||v.drawn.zone!==p.zone||!v.drawn.verb)
    fail(`mid-journey story disagreed with simulation: ${JSON.stringify({v,p})}`);
  const a=bootGame('swarm-keeper',{seed:0x6002,footer:FOOTER}),b=bootGame('swarm-keeper',{seed:0x6002,footer:FOOTER});
  b.sandbox.__NO_VIEWER_STORY=1;a.frames(7200,true);b.frames(7200,true);
  const same=a.sandbox.__swarmKeeperSignature()===b.sandbox.__swarmKeeperSignature(),ra=a.sandbox.__swarmKeeperNextRandom(),rb=b.sandbox.__swarmKeeperNextRandom(),
    va=a.sandbox.__swarmKeeperViewerProbe(),vb=b.sandbox.__swarmKeeperViewerProbe();
  console.log(`  rendered story A/B ${same?'identical':'DIFFERENT'}; next RNG ${ra.toFixed(8)}/${rb.toFixed(8)}; enabled ${va.enabled}/${vb.enabled}`);
  if(!same||ra!==rb)fail('viewer story changed simulation or engine RNG');
  if(!va.enabled||vb.enabled)fail('__NO_VIEWER_STORY did not cleanly ablate presentation');
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
