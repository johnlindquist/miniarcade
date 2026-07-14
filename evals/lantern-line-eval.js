#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const{bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
const{runMotion,analyzeMotion,assertMotion,motionLine}=require('./motion');
const{assertAblationPair}=require('./ablation');
const evidence=require('./evidence');

const SOURCE=fs.readFileSync(path.join(__dirname,'..','lantern-line.html'),'utf8');
const forbiddenPresentation=[/\bfunction\s+draw(?:Route|Path)s?\b/,/\bdrawRoutes?\s*\(/,/\broute(?:Points|Hash)\s*:/,/VISIBLE (?:ROUTE )?PLAN|FOLLOW THE (?:PATH|LINE)|CHECK THE PLAN/,/\.setLineDash\s*\(/];
const noVisiblePath=forbiddenPresentation.every(pattern=>!pattern.test(SOURCE));
const FOOTER=String.raw`
globalThis.__llApplied=[];
{const old=applyIntent;applyIntent=function(intent){const before={x:world.keeper.x,y:world.keeper.y},out=old(intent);globalThis.__llApplied.push({intent:Object.assign({},intent),before,velocity:{x:world.keeper.vx,y:world.keeper.vy}});if(globalThis.__llApplied.length>240)globalThis.__llApplied.shift();return out;};}
globalThis.__llLastApplied=()=>globalThis.__llApplied.at(-1)||null;
globalThis.__llRecipeDistance=(raw,target,lane)=>recipeDistance(raw,target,lane);
`;
let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function validateMisfireChain(receipt){
  const failures=[],events=receipt.events||[],jam=events.find(event=>event.stage==='jam-landed'),transform=events.find(event=>event.source==='mote-transform'&&event.moteId===receipt.moteId&&event.moduleId==='coil:1'),payoff=events.find(event=>event.source==='imperfect-lantern'&&event.lanternId===receipt.lantern.id);
  if(!receipt.landedOnOccupied)failures.push('threat did not land on the occupied coil');
  for(const [key,value] of Object.entries({threatId:receipt.threatId,jamId:receipt.jamId,misfireId:receipt.misfireId,moteId:receipt.moteId,productionCommitId:receipt.productionCommitId}))if(value===null||value===undefined||value==='')failures.push('missing '+key);
  if(!jam||jam.threatId!==receipt.threatId||jam.jamId!==receipt.jamId||jam.misfireId!==receipt.misfireId)failures.push('jam receipt is not bound to the hidden threat and armed misfire');
  if(!transform||transform.threatId!==receipt.threatId||transform.jamId!==receipt.jamId||transform.misfireId!==receipt.misfireId||transform.productionCommitId!==receipt.productionCommitId||transform.expectedCharge===transform.actualCharge)failures.push('coil transform is not bound to the armed misfire and production mote');
  if(!payoff||payoff.threatId!==receipt.threatId||payoff.jamId!==receipt.jamId||payoff.misfireId!==receipt.misfireId||payoff.moteId!==receipt.moteId||payoff.productionCommitId!==receipt.productionCommitId)failures.push('imperfect lantern is not bound to the transformed production mote');
  if(!receipt.lantern||receipt.lantern.exact!==false||receipt.stats.imperfectLanterns!==1||receipt.stats.exactLanterns!==0)failures.push('misfire chain did not resolve as one imperfect lantern');
  return failures;
}
function validateNaturalEvidence(label,ambient){
  const report=evidence.validateEvidence(ambient.ledger),events=report.ledger?report.ledger.events:[];
  if(!report.ok){for(const violation of report.violations)fail(`${label}: [${violation.code}] ${violation.message}`);return null}
  const forbidden=new Set(['locomotion','movement','walk','turn','replan','replanning','navigation','path']);
  if(events.some(event=>forbidden.has(event.kind)))fail(label+': ledger credited ordinary locomotion or replanning');
  if(events.some(event=>(event.kind==='response'||event.kind==='commit')&&event.actorId!=='keeper'))fail(label+': response/commit changed persistent keeper identity');
  if(events.some((event,index)=>!Number.isInteger(event.showFrame)||!Number.isInteger(event.runFrame)||event.frame!==event.showFrame||index&&(event.frame<events[index-1].frame||event.serial<=events[index-1].serial)))fail(label+': evidence lost monotonic show-frame or serial order');
  const kinds=new Set(events.map(event=>event.kind));for(const kind of['setup','commit','threat','response','environment','payoff','progress'])if(!kinds.has(kind))fail(label+': natural ledger missed '+kind);
  const sources=new Set(events.map(event=>event.source));for(const source of['order-open','route-commit','sootling-windup','keeper-anticipation','mote-transform','exact-lantern','district-lit'])if(!sources.has(source))fail(label+': natural ledger missed '+source);
  const byProductionId=new Map(events.filter(event=>event.source==='route-commit').map(event=>[event.productionCommitId,event]));for(const payoff of events.filter(event=>event.source==='exact-lantern')){const refs=[[payoff.productionCommitId,payoff.planId],...(payoff.secondProductionCommitId?[[payoff.secondProductionCommitId,payoff.secondPlanId]]:[])];for(const[productionCommitId,planId]of refs){const commit=byProductionId.get(productionCommitId),transforms=events.filter(event=>event.source==='mote-transform'&&event.productionCommitId===productionCommitId&&event.orderId===payoff.orderId&&event.planId===planId);if(!commit||commit.source!=='route-commit'||commit.orderId!==payoff.orderId||commit.planId!==planId||!String(planId).startsWith('exact:')||commit.frame>=payoff.frame)fail(label+': exact payoff referenced an unrelated production commit '+JSON.stringify({payoff,commit,planId}));if(!commit||transforms.length<2||transforms.some(event=>event.frame<=commit.frame||!event.moduleId.endsWith(':'+commit.lane)))fail(label+': exact payoff commit was not consumed by its declared transform path '+JSON.stringify({payoff,commit,transforms}))}}
  return evidence.deriveEvidence(ambient.ledger);
}

console.log('1) fixed-step replay, rendered/headless parity, chunk parity, finite renderer');
{
  const a=bootGame('lantern-line',{seed:0x1a11}),b=bootGame('lantern-line',{seed:0x1a11}),rendered=bootGame('lantern-line',{seed:0x1a11});
  a.frames(9000,false);b.frames(9000,false);const draws=rendered.frames(9000,true),sa=a.sandbox.__lanternLineSignature(),sb=b.sandbox.__lanternLineSignature(),sr=rendered.sandbox.__lanternLineSignature();
  console.log(`  same seed ${sa===sb?'identical':'DIFFERENT'}, rendered ${sa===sr?'identical':'DIFFERENT'}, ${draws.calls} canvas calls`);
  if(sa!==sb)fail('same-seed 9,000-frame replay diverged');if(sa!==sr)fail('render traversal changed simulation or RNG');
  if(!a.sandbox.__lanternLineProbe().finite||!rendered.sandbox.__lanternLineProbe().finite)fail('finite replay contract failed');
  if(draws.calls<50000||!draws.byMethod.fillRect||!draws.byMethod.beginPath||!draws.byMethod.fillText)fail('renderer was not genuinely exercised: '+JSON.stringify(draws.byMethod));
  const mono=bootGame('lantern-line',{seed:0x1a12}),chunked=bootGame('lantern-line',{seed:0x1a12});mono.frames(9000,false);for(let i=0;i<900;i++)chunked.frames(10,false);
  if(mono.sandbox.__lanternLineSignature()!==chunked.sandbox.__lanternLineSignature())fail('monolithic and chunked fixed steps diverged');
}

console.log('2) pure planner, shared manual actions, exhaustive recipes, truthful lane topology');
{
  const game=bootGame('lantern-line',{seed:0x1a21,footer:FOOTER}),fixture=game.sandbox.__lanternLinePlannerFixture(),schema=game.sandbox.__lanternLineIntentFixture(),topology=game.sandbox.__lanternLineTopologyFixture();
  if(!fixture.pure||!fixture.repeat||!fixture.finite)fail('planner purity/repeatability fixture failed');
  if(schema.aiKeys.join('|')!==schema.humanKeys.join('|')||schema.aiKeys.join('|')!==schema.required.join('|'))fail('human and bot intent schemas differ: '+JSON.stringify(schema));
  const threatPlanner=bootGame('lantern-line',{seed:0x1a22}),threatTwin=bootGame('lantern-line',{seed:0x1a22});threatPlanner.sandbox.__lanternLineThreatFixture();threatTwin.sandbox.__lanternLineThreatFixture();const threatFixture=threatPlanner.sandbox.__lanternLinePlannerFixture();if(!threatFixture.pure||!threatFixture.repeat||threatPlanner.sandbox.__lanternLineSignature()!==threatTwin.sandbox.__lanternLineSignature()||!same(threatPlanner.sandbox.__ambientProbe().ledger,threatTwin.sandbox.__ambientProbe().ledger)||threatPlanner.engine.random()!==threatTwin.engine.random())fail('threat-state planning mutated simulation, evidence, or RNG');
  let solved=0;for(let rh=0;rh<3;rh++)for(let rg=0;rg<2;rg++)for(let th=0;th<3;th++)for(let tg=0;tg<2;tg++)for(let tc=1;tc<=2;tc++)for(let lane=0;lane<3;lane++){
    const raw={hue:rh,glyph:rg,charge:0},target={hue:th,glyph:tg,charge:tc},recipe=game.sandbox.__llRecipeDistance(raw,target,lane),out={hue:(raw.hue+recipe.turns)%3,glyph:recipe.glyphFlip?1-raw.glyph:raw.glyph,charge:recipe.charge};
    if(out.hue!==target.hue||out.glyph!==target.glyph||out.charge!==target.charge)fail('unsolved recipe '+JSON.stringify({raw,target,lane,recipe,out}));else solved++;
  }
  if(solved!==216||topology.lanes!==3||topology.processingStages!==3||!topology.independentLaneRoutes||topology.responseBranches.length!==4||!topology.rework||!topology.purgeDependency||topology.routes.some(route=>route.length!==5))fail('authored topology/recipe coverage regressed: '+JSON.stringify({solved,topology}));
  press(game,'Enter');press(game,'Enter');game.key('keydown','ArrowRight');game.frames(8,false);game.key('keyup','ArrowRight');const applied=game.sandbox.__llLastApplied();if(!applied||applied.intent.tactic!=='MANUAL LIGHTWORK'||applied.intent.moveX!==1||applied.velocity.x<=0)fail('manual movement did not traverse shared applyIntent');
  game.sandbox.__lanternLineManualActionFixture('scrub');const scrubBefore=game.sandbox.__lanternLineManualProbe();press(game,'Space');const scrubAfter=game.sandbox.__lanternLineManualProbe();if(scrubBefore.modules.find(m=>m.id==='coil:1').jamT<=0||scrubAfter.modules.find(m=>m.id==='coil:1').jamT!==0||scrubAfter.modules.find(m=>m.id==='coil:1').soot!==0||scrubAfter.stats.reactiveResponses!==scrubBefore.stats.reactiveResponses+1)fail('manual SPACE did not scrub through shared mechanics');
  game.sandbox.__lanternLineManualActionFixture('rotate');press(game,'KeyX');const rotateAfter=game.sandbox.__lanternLineManualProbe(),prism=rotateAfter.modules.find(m=>m.id==='prism:1'),mote=rotateAfter.motes.find(m=>m.id==='manual-transform');if(prism.orientation!==1||!mote||mote.hue!==1||!(mote.transformMask&1))fail('manual X did not rotate the production prism path');
  game.sandbox.__lanternLineManualActionFixture('purge');const purgeBefore=game.sandbox.__lanternLineManualProbe();press(game,'KeyZ');const purgeAfter=game.sandbox.__lanternLineManualProbe();if(purgeAfter.stats.purgeCaptures!==purgeBefore.stats.purgeCaptures+1||purgeAfter.stats.clogsAvoided!==purgeBefore.stats.clogsAvoided+1||purgeAfter.sootlings[0].state!=='FLEE')fail('manual Z did not purge through shared mechanics');
  const routine=bootGame('lantern-line',{seed:0x1a23});routine.sandbox.__lanternLineNoThreatFixture();routine.frames(1000,false);if(routine.sandbox.__lanternLineProbe().stats.planReversals!==0)fail('routine order/half planning earned tactical reversal credit');
  console.log(`  ${solved} recipes; ${topology.lanes} independent lanes; SPACE/X/Z shared actions pass; threat planner pure`);
}

console.log('3) same-seed clog-forecast ablation first diverges inside windup and leaves baseline active');
{
  const live=bootGame('lantern-line',{seed:0x1a31}),baseline=bootGame('lantern-line',{seed:0x1a31});live.sandbox.__lanternLineThreatFixture();baseline.sandbox.__lanternLineThreatFixture();baseline.sandbox.__NO_CLOG_FORECAST=1;
  const left0=live.sandbox.__lanternLineFoundryProbe(),right0=baseline.sandbox.__lanternLineFoundryProbe();if(!same(left0.environment,right0.environment))fail('forecast fixture did not start with an identical environment');
  const timelineLive=[{frame:0,digest:evidence.canonicalHash(left0.environment)}],timelineBaseline=[{frame:0,digest:evidence.canonicalHash(right0.environment)}];
  for(let frame=1;frame<=1200;frame++){live.frames(1,false);baseline.frames(1,false);timelineLive.push({frame,digest:evidence.canonicalHash(live.sandbox.__lanternLineFoundryProbe().intent)});timelineBaseline.push({frame,digest:evidence.canonicalHash(baseline.sandbox.__lanternLineFoundryProbe().intent)})}
  const lp=live.sandbox.__lanternLineProbe(),bp=baseline.sandbox.__lanternLineProbe(),ll=live.sandbox.__ambientProbe().ledger,bl=baseline.sandbox.__ambientProbe().ledger,schedule=evidence.canonicalHash({sha:left0.environment.scheduleSha256});
  const report=assertAblationPair('clog forecast',{live:{initialDigest:timelineLive[0].digest,timeline:timelineLive,activity:lp.stats.events,progress:lp.stats.progress,effect:lp.stats.clogsAvoided,ledger:ll,invariantDigests:{schedule}},baseline:{initialDigest:timelineBaseline[0].digest,timeline:timelineBaseline,activity:bp.stats.events,progress:bp.stats.progress,effect:bp.stats.clogsAvoided,ledger:bl,invariantDigests:{schedule}}},{firstDivergenceWindow:[1,5],minBaselineActivity:10,minBaselineProgress:1,removedSources:['keeper-anticipation'],preservedSources:['order-open','route-commit','sootling-windup','mote-transform'],relevantEffect:{path:'effect',direction:'more',minDelta:1},invariantDigests:['schedule']},fail);
  console.log(`  first intent divergence ${report.firstDivergence}f; avoided clogs ${lp.stats.clogsAvoided}/${bp.stats.clogsAvoided}; baseline progress ${bp.stats.progress}`);
}

console.log('3b) one hidden threat causally binds jam, misfire, transform, and imperfect lantern');
{
  const live=bootGame('lantern-line',{seed:0x1a39}),control=bootGame('lantern-line',{seed:0x1a39}),left=live.sandbox.__lanternLineMisfireFixture(false),right=control.sandbox.__lanternLineMisfireFixture(true),problems=validateMisfireChain(left);
  if(problems.length)for(const problem of problems)fail('misfire chain: '+problem);
  if(left.scheduleSha256!==right.scheduleSha256||left.threatId!==right.threatId||left.jamId!==right.jamId||left.moteId!==right.moteId||left.productionCommitId!==right.productionCommitId)fail('misfire ablation changed the deterministic schedule or causal identities');
  if(right.misfireId!==null||right.actualCharge!==right.expectedCharge||!right.lantern||right.lantern.exact!==true||right.stats.exactLanterns!==1||right.stats.imperfectLanterns!==0)fail('misfire-only control did not preserve the correct transform and exact lantern');
  for(const field of['threatId','jamId','misfireId','moteId','productionCommitId']){const forged=JSON.parse(JSON.stringify(left));forged[field]=null;if(!validateMisfireChain(forged).length)fail('misfire evaluator accepted missing '+field)}
  console.log(`  ${left.threatId} -> ${left.jamId} -> ${left.misfireId} -> ${left.moteId} -> ${left.lantern.id}; control exact`);
}

console.log('4) natural 9,000-frame panel lights the skyline with honest pressure and causal evidence');
{
  let purgeTotal=0,reactiveTotal=0;
  for(const seed of[0x1a41,0x1ae7,0x1b8d]){
    const game=bootGame('lantern-line',{seed});game.frames(9000,false);const p=game.sandbox.__lanternLineProbe(),derived=validateNaturalEvidence(seed.toString(16),game.sandbox.__ambientProbe());purgeTotal+=p.stats.purgeCaptures;reactiveTotal+=p.stats.reactiveResponses;
    if(!p.finite||p.stats.exactLanterns<16||p.stats.districtsLit!==4||p.stats.windups<8||p.stats.forecastResponses<5||p.stats.maxDecisionDeadAir>180)fail(seed.toString(16)+': natural run missed measured activity floors '+JSON.stringify(p.stats));
    if(!derived||derived.payoffs<16||derived.maxDeadAir>180)fail(seed.toString(16)+': independently derived evidence regressed '+JSON.stringify(derived));
    console.log(`  ${seed.toString(16)} exact ${p.stats.exactLanterns}, districts ${p.stats.districtsLit}, forecast/reactive ${p.stats.forecastResponses}/${p.stats.reactiveResponses}, purge ${p.stats.purgeCaptures}, jams ${p.stats.jams}, evidence ${derived&&derived.eventCount}`);
  }
  if(purgeTotal<1)fail('natural panel never selected the authored purge-bait response');if(reactiveTotal<3)fail('natural panel did not preserve an active reactive recovery path');
}

console.log('5) payoff-FX and evidence-ledger ablations are simulation/RNG/statistics no-ops');
{
  for(const flag of['__NO_PAYOFF_FX','__NO_EVIDENCE_LEDGER']){
    const live=bootGame('lantern-line',{seed:0x1a51}),twin=bootGame('lantern-line',{seed:0x1a51});twin.sandbox[flag]=1;live.sandbox.__lanternLineReset();twin.sandbox.__lanternLineReset();live.frames(9000,false);twin.frames(9000,false);
    if(live.sandbox.__lanternLineSignature()!==twin.sandbox.__lanternLineSignature())fail(flag+' changed simulation signature');
    if(live.engine.random()!==twin.engine.random())fail(flag+' changed RNG receipt');
    if(!same(live.sandbox.__lanternLineProbe().stats,twin.sandbox.__lanternLineProbe().stats))fail(flag+' changed statistics');
    const ledger=twin.sandbox.__ambientProbe().ledger;if(flag==='__NO_EVIDENCE_LEDGER'&&(ledger.enabled!==false||ledger.events.length))fail('__NO_EVIDENCE_LEDGER still emitted evidence');
    console.log('  '+flag+' no-op pass');
  }
}

console.log('6) shared motion contract keeps stable watched actors physically active');
{
  const report=analyzeMotion(runMotion('lantern-line',{seed:0x1a61,minutes:10,sampleEvery:5}),{requiredIds:['keeper','sootling:0'],emoteFrames:120,emoteShare:.2,minPresenceShare:.95,identityTurnoverAllowance:1});
  assertMotion('lantern-line',report,fail);console.log('  '+motionLine(report));
}

console.log('7) two independent ten-minute soaks remain finite, eventful, and progressing');
{
  for(const seed of[0x1a71,0x1b17]){const{game,samples}=runSoak('lantern-line',{seed,minutes:10}),report=analyzeSoak(samples),p=game.sandbox.__lanternLineProbe();assertSoak(seed.toString(16),report,{still:1,quiet:6,stall:9,minEvents:450,minProgress:180},fail);if(p.stats.districtsLit!==4||p.stats.exactLanterns<75)fail(seed.toString(16)+': ten-minute skyline progression regressed '+JSON.stringify(p.stats));console.log('  '+seed.toString(16)+' '+soakLine(report)+`; exact ${p.stats.exactLanterns}, districts ${p.stats.districtsLit}`)}
}

console.log('8) source keeps authored machinery invisible as a plan overlay');
if(!noVisiblePath)fail('source contains a visible route/path/waypoint overlay pattern');
else console.log('  no future route, breadcrumb, waypoint, or dashed-plan renderer found');

if(failed){console.error('\nLANTERN LINE EVAL FAILED');process.exit(1)}
console.log('\nLANTERN LINE EVAL PASSED');
