#!/usr/bin/env node
/* Reusable autoplay toolkit eval.
 *
 * Run:  node evals/autoplay-eval.js   (from the here-now directory)
 *
 * Exercises every public behavior family without a DOM. The checks are kept
 * deterministic so failures can be replayed exactly from their seed.
 */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const AI=require('../autoplay.js');

let failed=false,checks=0;
function check(condition,message){
  checks++;
  if(!condition){console.error('  FAIL:',message);failed=true;}
}
function equal(actual,expected,message){
  check(Object.is(actual,expected),`${message} (got ${String(actual)}, expected ${String(expected)})`);
}
function near(actual,expected,message,epsilon=1e-9){
  check(Math.abs(actual-expected)<=epsilon,`${message} (got ${actual}, expected ${expected})`);
}

console.log('1) seeded RNG: replay, state restore, fork, and helpers');
{
  const a=AI.createRng('gallery-run-42'),b=AI.createRng('gallery-run-42');
  const seqA=Array.from({length:8},()=>a.uint32()),seqB=Array.from({length:8},()=>b.uint32());
  check(seqA.every((n,i)=>n===seqB[i]),'same seed did not replay the same stream');
  const state=a.getState(),next=a();a.setState(state);equal(a(),next,'restored RNG state diverged');
  const forkA=a.fork('planner'),forkB=a.fork('planner');equal(forkA(),forkB(),'named forks were not stable');
  const ints=Array.from({length:100},()=>a.int(-3,4));
  check(ints.every(n=>Number.isInteger(n)&&n>=-3&&n<=4),'integer helper escaped inclusive bounds');
  const shuffled=a.shuffle([1,2,3,4,5]);
  check(shuffled.length===5&&new Set(shuffled).size===5,'shuffle lost or duplicated entries');
  check(AI.hashSeed('x')===AI.hashSeed('x')&&AI.hashSeed('x')!==AI.hashSeed('y'),'seed hashing is not stable');
  console.log(`  seed ${a.seed}, replayed ${seqA.length} uint32 values`);
}

console.log('2) controller mux: human/AI routing preserves game-owned intents');
{
  const humanIntent={throttle:1,jump:false,weapon:'web'};
  const botIntent={throttle:-0.5,jump:true,weapon:null};
  const control=AI.controllerMux({
    human:()=>humanIntent,ai:()=>botIntent,manual:ctx=>ctx.manual
  });
  check(control({manual:true})===humanIntent,'human intent identity was wrapped or changed');
  check(control({manual:false})===botIntent,'AI intent identity was wrapped or changed');
  check(control({},'human')===humanIntent,'explicit controller mode did not override selection');
  equal(control.select({manual:false}),'ai','controller selector chose the wrong mode');
  const fallback=AI.controllerMux({controllers:{bot:()=>42},defaultMode:'missing',fallback:'bot'});
  equal(fallback({}),42,'named controller fallback failed');
  console.log('  exact car/fighter-style intent objects survived routing');
}

console.log('3) decision helpers: nearest, best score, and first applicable rule');
{
  const actors=[{id:'far',p:{x:9,y:0},hp:10},{id:'hurt',p:{x:4,y:0},hp:2},{id:'near',p:{x:2,y:0},hp:8}];
  equal(AI.nearest(actors,{x:0,y:0},{position:a=>a.p}).id,'near','nearest chose the wrong actor');
  equal(AI.bestBy(actors,a=>a.hp).id,'far','bestBy failed to maximize score');
  equal(AI.bestBy(actors,a=>a.hp,{maximize:false,filter:a=>a.id!=='hurt'}).id,'near',
    'bestBy minimize/filter combination failed');
  const action=AI.firstApplicable([
    [ctx=>ctx.hp<2,()=>({type:'heal'})],
    ctx=>ctx.enemy?{type:'attack',id:ctx.enemy}:null,
    ()=>({type:'wander'})
  ],{hp:4,enemy:'slime'});
  check(action.type==='attack'&&action.id==='slime','firstApplicable skipped the first viable rule');
  equal(AI.firstApplicable([()=>null],{},'idle'),'idle','firstApplicable fallback failed');
  console.log('  selectors remained stable and rules short-circuited');
}

console.log('4) wrapped geometry and steering: seam-aware, clamped motion');
{
  equal(AI.wrappedDelta(98,2,100),4,'wrapped delta missed the short forward seam');
  equal(AI.wrappedDelta(2,98,100),-4,'wrapped delta missed the short reverse seam');
  equal(AI.wrappedDistance({x:98,y:0},{x:2,y:3},{width:100}),5,
    '2D wrapped distance was incorrect');
  const desired=AI.seek({x:98,y:0},{x:2,y:0},{maxSpeed:2,wrap:{width:100}});
  near(desired.x,2,'seek pointed away from the wrapped target');near(desired.y,0,'seek added vertical drift');
  const force=AI.steer({x:0,y:0},{x:3,y:4},2);
  near(Math.hypot(force.x,force.y),2,'steering force exceeded its clamp');
  near(AI.moveToward(0,10,3),3,'moveToward did not respect its step');
  near(AI.steerAngle(Math.PI*1.9,0.1,0.2),Math.PI*1.9+0.2,
    'angle steering did not take the short turn');
  console.log('  target across x-wrap produced +2 velocity with a 2-unit force cap');
}

console.log('5) skill profile: deterministic lapse, recovery, reaction cache, and aim noise');
{
  const chanceScript=[true,false,false];
  function scripted(){return 0.5;}
  scripted.chance=p=>chanceScript.length?chanceScript.shift():p>=1;
  scripted.int=(a,b)=>Math.min(b,Math.max(a,3));
  scripted.range=(a,b)=>(a+b)/2;
  const profile=AI.createSkillProfile({rng:scripted,skill:0.8,precision:1,risk:0,recovery:1,
    reactionFrames:2,lapseChance:0.5,lapseFrames:3});
  let decisions=0;
  const decide=()=>({n:++decisions}),lapse=()=>({n:0,lapsed:true});
  check(profile.decide(0,{},decide,lapse).lapsed,'scripted lapse did not start');
  check(profile.decide(1,{},decide,lapse).lapsed,'lapse ended too early');
  equal(profile.decide(3,{},decide,lapse).n,1,'decision did not resume after lapse');
  equal(profile.decide(4,{},decide,lapse).n,1,'reaction delay did not reuse the cached intent');
  equal(profile.decide(5,{},decide,lapse).n,2,'reaction cache did not expire on schedule');
  equal(profile.imprecise(7,100),7,'perfect precision still added aim noise');
  check(!profile.takeRisk()&&profile.attemptRecovery(),'risk/recovery profile probabilities were ignored');
  console.log('  3-frame lapse recovered into a 2-frame decision cadence');
}

console.log('6) progress watchdog: escalating recovery resets on real progress');
{
  const watchdog=AI.createProgressWatchdog({escalations:[
    {after:3,action:'repath'},
    {after:6,action:(_ctx,event)=>'reset@'+event.now}
  ]});
  check(watchdog.observe(10,0).progressed,'first observation was not treated as progress');
  check(!watchdog.observe(10,2).stalled,'watchdog fired before its threshold');
  equal(watchdog.observe(10,3).event.action,'repath','first watchdog escalation was wrong');
  const severe=watchdog.observe(10,7);
  equal(severe.event.action,'reset@7','second watchdog escalation was wrong');equal(severe.level,2,'watchdog level did not escalate');
  const recovered=watchdog.observe(11,8);
  check(recovered.progressed&&!recovered.stalled&&recovered.level===0,'progress did not reset the watchdog');
  console.log('  recovery ladder: repath at 3 ticks, reset at 6, clear at progress');
}

console.log('7) behavior memory: TTL, cooldowns, visits, and blacklist');
{
  const memory=AI.createMemory();
  memory.set('target',{x:4},3);memory.cooldown('jump',5);memory.visit('4,2');memory.visit('4,2',2);
  memory.blacklist('lava',2,'hot');
  equal(memory.get('target').x,4,'TTL value was not stored');
  check(!memory.ready('jump')&&memory.remaining('jump')===5,'cooldown did not arm');
  equal(memory.visits('4,2'),3,'visit counts did not accumulate');
  equal(memory.blacklistReason('lava'),'hot','blacklist reason was lost');
  memory.tick(2);check(!memory.isBlacklisted('lava'),'blacklist did not expire at its TTL');
  memory.tick(1);check(!memory.has('target'),'remembered value did not expire at its TTL');
  check(!memory.useCooldown('jump',5),'active cooldown was consumed twice');
  memory.tick(2);check(memory.useCooldown('jump',4),'expired cooldown did not become ready');
  check(memory.snapshot().visits.length===1,'memory snapshot omitted visit state');
  console.log('  independent clocks expired tactical state without losing visit history');
}

console.log('8) candidate simulation: bounded, fair, and scored with real caller state');
{
  const rollout=AI.simulateCandidates([-1,1,2],{
    initialState:{x:0},horizon:4,
    step:(state,action)=>{state.x+=action;},
    score:state=>-Math.abs(7-state.x)
  });
  equal(rollout.best,2,'lookahead selected the wrong candidate');
  equal(rollout.steps,12,'full lookahead ran the wrong number of steps');
  check(rollout.results.every(r=>r.steps===4),'round-robin candidates received unequal horizons');
  const bounded=AI.simulateCandidates([1,2,3],{
    initialState:{x:0},horizon:20,maxCandidates:2,maxSteps:3,
    step:(state,action)=>{state.x+=action;},score:state=>state.x
  });
  check(bounded.truncated&&bounded.candidateLimitReached&&bounded.budgetExhausted,
    'candidate/step bounds were not reported');
  check(bounded.results.every(r=>r.steps>=1)&&bounded.steps===3,
    'bounded rollout starved a retained candidate');
  console.log(`  chose action ${rollout.best}; bounded probe stopped at ${bounded.steps} total steps`);
}

console.log('9) binary heap + A*: forced-gap route, costs, and iteration bound');
{
  const heap=new AI.BinaryHeap((a,b)=>a-b);[5,1,4,2,3].forEach(n=>heap.push(n));
  const popped=[];while(heap.size)popped.push(heap.pop());
  equal(popped.join(','),'1,2,3,4,5','binary heap violated priority order');

  const wall=new Set(['2,0','2,1','2,2','2,3']);
  const pathOptions={
    start:{x:0,y:0},goal:{x:4,y:0},key:AI.pointKey,
    neighbors:p=>[[1,0],[-1,0],[0,1],[0,-1]].map(d=>({x:p.x+d[0],y:p.y+d[1]}))
      .filter(p=>p.x>=0&&p.x<5&&p.y>=0&&p.y<5&&!wall.has(AI.pointKey(p))),
    heuristic:(p,g)=>Math.abs(g.x-p.x)+Math.abs(g.y-p.y)
  };
  const search=AI.searchPath(pathOptions);
  check(search.found&&search.path.length===12&&search.cost===12,'A* did not solve the forced-gap maze optimally');
  check(search.path.some(p=>p.x===2&&p.y===4),'A* route did not cross the wall gap');
  equal(AI.findPath(pathOptions).length,12,'findPath convenience wrapper lost the route');
  const cutOff=AI.searchPath(Object.assign({},pathOptions,{maxIterations:1}));
  check(!cutOff.found&&cutOff.truncated&&cutOff.reason==='maxIterations','A* ignored its expansion bound');
  const same=AI.findPath(Object.assign({},pathOptions,{goal:{x:0,y:0}}));
  check(Array.isArray(same)&&same.length===0,'start-equals-goal should return an empty route');
  console.log(`  optimal route ${search.path.length} cells through (2,4), ${search.iterations} expansions`);
}

console.log('10) generate-and-prove: retries stop on the first valid candidate');
{
  const generated=AI.generateValidated(attempt=>({attempt}),value=>({ok:value.attempt===3}));
  check(generated.ok&&generated.attempts===3&&generated.value.attempt===3,'validated generation did not stop at the first proof');
  const failedGeneration=AI.generateValidated(attempt=>attempt,()=>false,{maxAttempts:2});
  check(!failedGeneration.ok&&failedGeneration.attempts===2,'validated generation ignored its attempt bound');
}

console.log('11) packaging: dependency-free CommonJS and global AI agree');
check(globalThis.AI===AI,'CommonJS export and global AI are different objects');
check(Object.isFrozen(AI)&&AI.VERSION==='1.0.0','public API/version is not stable');
const sandbox={};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','autoplay.js'),'utf8'),sandbox);
check(sandbox.AI&&sandbox.AI.VERSION===AI.VERSION,'plain browser-global branch did not publish AI');
check(typeof sandbox.AI.createRng==='function','browser-global API is incomplete');

console.log(failed?`\nAUTOPLAY EVAL FAILED (${checks} checks)`:`\nAUTOPLAY EVAL PASSED (${checks} checks)`);
process.exit(failed?1:0);
