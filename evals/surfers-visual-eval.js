#!/usr/bin/env node
'use strict';

// SIDE SURFERS visual eval — real-pixel evidence on the crystal-mesa template.
// The 2026-07-11 rescue rebuilt the game around the chase fantasy: a 9x14
// runner (Block Mine ceiling is ~12-13px; the old runner drew 15x23), an
// inspector + K-9 pursuit layer, four rotating line themes, and vehicles
// treated as perspective lane obstacles capped at a fixed reference depth.
const fs=require('fs');
const path=require('path');
const{bootRenderedGame,encodeRgbaPng}=require('../render/runtime');
const{
  sha256,analyzeFrame,frameDifference,structureDistance,analyzeBurst,
  measureDrawnActorExtent,assertActorScale,writeContactSheet,verifyReviewReceipt,writeJson
}=require('./visual-harness');

const GAME='surfers',SEED=0x5f5eed,RENDER_EVERY=1;
const ROOT=path.join(__dirname,'..'),ARTIFACT_DIR=path.join(ROOT,'.artifacts/visual/surfers');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'surfers-contact-sheet.png');
const TRACKED_CONTACT_PATH=path.join(__dirname,'visual-receipts/surfers-contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json'),REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews/surfers.json');
const CLIP_PATH=path.join(ARTIFACT_DIR,'surfers-30s.mp4');
// playfield below the HUD strip; the whole tunnel is the show
const WORLD_CROP={x:0,y:14,width:160,height:344},ACTOR_THRESHOLD=8,ACTOR_PADDING=10;
const OFFSETS=[2,5,8,11,14,17];
const CONTACT_BEATS=[
  {id:'opening',label:'tag + spotted',fixture:'opening',offset:30},
  {id:'run',label:'metro line',fixture:'run',offset:4},
  {id:'stumble',label:'stumble',fixture:'stumble',offset:4},
  {id:'danger',label:'oncoming express',fixture:'danger',offset:6},
  {id:'jet',label:'jetpack',fixture:'jet',offset:6},
  {id:'zone2',label:'uptown line',fixture:'zone2',offset:4},
  {id:'later',label:'depot line',fixture:'later',offset:4},
  {id:'apex',label:'express cleared',fixture:'apex',offset:16},
  {id:'busted',label:'busted',fixture:'busted',offset:24}
];

const median=values=>{const sorted=[...values].sort((a,b)=>a-b),middle=(sorted.length-1)/2,lo=Math.floor(middle),hi=Math.ceil(middle);return(sorted[lo]+sorted[hi])/2};
const round=value=>+value.toFixed(6);
const gates=[];
function gate(name,ok,detail){gates.push({name,ok:!!ok,detail});}

function visualProbe(runtime){const fn=runtime.sandbox.__sfVisualProbe;if(typeof fn!=='function')throw new Error('surfers.html must expose __sfVisualProbe()');const value=fn();if(!value||value.finite===false)throw new Error('Side Surfers visual fixture became non-finite');return value;}
function captureFixture(name,offsets,options){options=options||{};const runtime=bootRenderedGame(GAME,{seed:SEED});if(options.beforeSet)options.beforeSet(runtime);const set=runtime.sandbox.__sfSetVisualBeat;if(typeof set!=='function'||set(name)!==true)throw new Error('unknown Side Surfers visual beat: '+name);if(options.selector!==undefined)runtime.sandbox.__SF_VISUAL_ONLY_SUBJECT=options.selector;if(options.afterSet)options.afterSet(runtime);const start=runtime.frame,frames=new Map();for(const target of[...new Set(offsets)].sort((a,b)=>a-b)){runtime.advanceTo(start+target,{renderEvery:RENDER_EVERY,renderLast:true});const frame=runtime.snapshot({native:true});frame.probe=visualProbe(runtime);frame.fixture=options.id||name;frame.offset=target;frames.set(target,frame)}return frames;}
function captureTimeline(game,seed,targets){const runtime=bootRenderedGame(game,{seed}),frames=new Map(),preRoll=120;for(const target of targets){if(target-runtime.frame>preRoll)runtime.advanceTo(target-preRoll);runtime.advanceTo(target,{renderEvery:2,renderLast:true});frames.set(target,runtime.snapshot({native:true}))}return frames;}
function probeSubjects(probe,fixture){if(!Array.isArray(probe&&probe.actors))throw new Error(`${fixture}: visual probe must expose actors[]`);const ids=new Set();for(const actor of probe.actors){if(!actor||typeof actor.id!=='string'||!actor.id||typeof actor.kind!=='string')throw new Error(`${fixture}: malformed subject`);if(ids.has(actor.id))throw new Error(`${fixture}: duplicate subject ${actor.id}`);ids.add(actor.id);const b=actor.box;if(!b||![b.x,b.y,b.width,b.height].every(Number.isFinite)||!(b.width>0&&b.height>0))throw new Error(`${fixture}: invalid box for ${actor.id}`)}return probe.actors;}
// Caps ENCODE the 2026-07-11 owner directive, not the loose repo ceiling:
// Block Mine's ~12px hero is the largest a hero may ever be. Measured drawn
// sizes on the shipped art: runner 9x14, inspector 10x15, dog 10x6.
// Vehicles are lane obstacles rendered in pseudo-3D: their near-plane loom is
// perspective, not actor bloat, so the cap applies at the fixture's fixed
// reference depth (near face staged at z=180; measured 21x26 there) and at
// every staged fixture depth (deepest measured 22x30 incl. projected length).
function limitsFor(actor){
  if(actor.kind==='vehicle')return{maxWidth:24,maxHeight:36,label:`vehicle ${actor.type}`};
  if(actor.type==='dog')return{maxWidth:12,maxHeight:10,label:'dog'};
  return{maxWidth:14,maxHeight:18,label:`actor ${actor.type}`};
}
function measureSubjects(fixture,offset){const baseline=captureFixture(fixture,[offset],{selector:'none',id:fixture+'-none'}).get(offset),actors=probeSubjects(baseline.probe,fixture),measurements=[];for(const actor of actors){const isolated=captureFixture(fixture,[offset],{selector:actor.id,id:`${fixture}-${actor.id}`}).get(offset),measurement=measureDrawnActorExtent(isolated,baseline,{id:actor.id,kind:actor.kind,type:actor.type,probeBox:actor.box,padding:ACTOR_PADDING,threshold:ACTOR_THRESHOLD}),assertion=assertActorScale(measurement,limitsFor(actor));measurements.push(Object.assign(measurement,{assertion:{ok:assertion.ok,failures:assertion.failures,limits:assertion.limits}}))}return{fixture,offset,probe:baseline.probe,measurements};}
function footprint(sample){const playfield=sample.probe.layout&&sample.probe.layout.playfield,area=playfield.width*playfield.height,actors=sample.measurements.filter(m=>m.kind==='standard'||m.kind==='boss'),sumArea=actors.reduce((n,m)=>n+m.bboxArea,0);return{fixture:sample.fixture,playfield,actorCount:actors.length,sumBboxArea:sumArea,sumFraction:round(sumArea/area),ok:actors.every(m=>m.assertion.ok&&!m.clipped)&&sumArea/area<=.20};}
function cropFromBox(box,pad){pad=pad||5;return{x:Math.max(0,Math.floor(box.x-pad)),y:Math.max(0,Math.floor(box.y-pad)),width:Math.ceil(box.width+pad*2),height:Math.ceil(box.height+pad*2)};}
function isolatedBurst(fixture,id){const frames=captureFixture(fixture,OFFSETS,{selector:id,id:`${fixture}-${id}-motion`}),ordered=OFFSETS.map(offset=>frames.get(offset)),subject=ordered[0].probe.actors.find(a=>a.id===id);if(!subject)throw new Error(`${fixture}: missing animated subject ${id}`);return analyzeBurst(ordered,{native:false,crop:cropFromBox(subject.box,4)});}
function reviewTemplate(montageSha){const command=`node render/render.js surfers 30 .artifacts/visual/surfers/surfers-30s.mp4 --seed ${SEED} --probe --fps 30`;return{schema:1,game:GAME,verdict:'pending',references:['horizon','blockmine'],montageSha256:montageSha,reviewedAt:'2026-07-11',reviewer:'complete after native-size review',seed:'0x'+SEED.toString(16),checkpoints:CONTACT_BEATS.map(b=>`${b.fixture}@${b.offset}`),guidelineOverlays:'none: no path lines, route plans, arrows, ghost trails, predicted arcs, or future-position reticles at any sampled beat. The oncoming train\'s wig-wag headlight pre-glow and the express signal heads are diegetic world/actor telegraphs; the runner\'s intent reads from lane motion, jump/roll poses, and the stumble flail + "!" bubble.',categories:Object.fromEntries(['characterCraft','environmentCraft','levelVariety','animationImpact','readability','artDirectionCohesion'].map(name=>[name,{meetsMachineHunt:false,meetsBlockMine:false,note:''}])),renderReceipt:{seed:'0x'+SEED.toString(16),seconds:30,fps:30,codec:'h264',dimensions:'320x720',bytes:0,sha256:'',command}};}

function main(){fs.mkdirSync(ARTIFACT_DIR,{recursive:true});fs.mkdirSync(path.dirname(TRACKED_CONTACT_PATH),{recursive:true});
  const candidate={};for(const beat of CONTACT_BEATS){const run=captureFixture(beat.fixture,[beat.offset],{id:beat.id});candidate[beat.id]=run.get(beat.offset);const duplicate=captureFixture(beat.fixture,[beat.offset],{id:beat.id+'-duplicate'}).get(beat.offset);gate(`${beat.id} fixture is real-pixel deterministic`,sha256(candidate[beat.id].rgba)===sha256(duplicate.rgba),{first:sha256(candidate[beat.id].rgba),second:sha256(duplicate.rgba)});fs.writeFileSync(path.join(ARTIFACT_DIR,`${String(CONTACT_BEATS.indexOf(beat)+1).padStart(2,'0')}-${beat.id}.png`),encodeRgbaPng(candidate[beat.id]))}

  const referenceTargets=[60,600,1200,2400,3600,5400,7200,9000,12000];
  const horizon=captureTimeline('horizon',0xa1020401,referenceTargets),blockmine=captureTimeline('blockmine',0xb10c0050,referenceTargets),horizonBy={},blockmineBy={};
  CONTACT_BEATS.forEach((beat,i)=>{horizonBy[beat.id]=horizon.get(referenceTargets[i]);blockmineBy[beat.id]=blockmine.get(referenceTargets[i])});
  const sheet=writeContactSheet({beats:CONTACT_BEATS.map(b=>({id:b.id,label:b.label})),rows:[{label:'SIDE SURFERS',frames:candidate},{label:'MACHINE HUNT',frames:horizonBy},{label:'BLOCK MINE',frames:blockmineBy}],outPath:CONTACT_PATH,labelWidth:92});
  // the tracked montage is preserved only via `node evals/preserve-visual-review.js surfers`

  const candidateMetrics=CONTACT_BEATS.map(b=>Object.assign({id:b.id},analyzeFrame(candidate[b.id],{native:false,crop:WORLD_CROP}))),horizonMetrics=CONTACT_BEATS.map(b=>analyzeFrame(horizonBy[b.id],{native:false,crop:WORLD_CROP})),blockmineMetrics=CONTACT_BEATS.map(b=>analyzeFrame(blockmineBy[b.id],{native:false,crop:WORLD_CROP}));
  // absolute floors pinned to the shipped art's measured beats (2026-07-11:
  // colors 119..187, entropy 2.59..3.23, luma .061...084, share .227...411,
  // edge .0104...0152, rich .82...96) — a density regression from today's
  // tunnel fails these before any reference math.
  const bands={colors:100,entropy:2.3,lumaStdDev:.05,largestColorShare:.5,edgeEnergy:.009,richEach:.72,richMedian:.8};
  const candidateMedian={colors:median(candidateMetrics.map(m=>m.quantizedColors)),entropy:median(candidateMetrics.map(m=>m.colorEntropy)),edge:median(candidateMetrics.map(m=>m.edge[1].energy)),rich:median(candidateMetrics.map(m=>m.richCellFraction))};
  const referenceMedian={horizon:{colors:median(horizonMetrics.map(m=>m.quantizedColors)),entropy:median(horizonMetrics.map(m=>m.colorEntropy)),edge:median(horizonMetrics.map(m=>m.edge[1].energy)),rich:median(horizonMetrics.map(m=>m.richCellFraction))},blockmine:{colors:median(blockmineMetrics.map(m=>m.quantizedColors)),entropy:median(blockmineMetrics.map(m=>m.colorEntropy)),edge:median(blockmineMetrics.map(m=>m.edge[1].energy)),rich:median(blockmineMetrics.map(m=>m.richCellFraction))}};
  gate('frames are opaque, non-flat, and spatially rich',candidateMetrics.every(m=>m.opaqueFraction===1&&m.quantizedColors>=bands.colors&&m.colorEntropy>=bands.entropy&&m.lumaStdDev>=bands.lumaStdDev&&m.largestColorShare<=bands.largestColorShare&&m.edge[1].energy>=bands.edgeEnergy&&m.richCellFraction>=bands.richEach)&&candidateMedian.rich>=bands.richMedian,{candidateMetrics:candidateMetrics.map(m=>({id:m.id,colors:m.quantizedColors,entropy:round(m.colorEntropy),luma:round(m.lumaStdDev),share:round(m.largestColorShare),edge:round(m.edge[1].energy),rich:round(m.richCellFraction)}))});
  // reference floor = the weaker of the two named references per metric. A dark
  // chase tunnel must not chase Block Mine's tile-mosaic entropy (readability
  // over noise); Machine Hunt is the legibility-side floor.
  const referenceColor=Math.min(referenceMedian.horizon.colors,referenceMedian.blockmine.colors),referenceEntropy=Math.min(referenceMedian.horizon.entropy,referenceMedian.blockmine.entropy),referenceEdge=Math.min(referenceMedian.horizon.edge,referenceMedian.blockmine.edge),referenceRich=Math.min(referenceMedian.horizon.rich,referenceMedian.blockmine.rich);
  gate('multiscale world detail is reference-comparable',candidateMedian.colors>=referenceColor*.85&&candidateMedian.entropy>=referenceEntropy*.85&&candidateMedian.edge>=referenceEdge*.85&&candidateMedian.rich>=referenceRich*.85,{candidateMedian,referenceMedian});

  // drawn-pixel actor scale at the fixed reference depth (train near face at z=180)
  const scale=measureSubjects('actor-scale',4);
  const scaleOk=scale.measurements.every(m=>m.assertion.ok&&!m.clipped&&!(m.probeOverflow&&m.probeOverflow.any));
  gate('drawn runner, inspector, dog, and reference-depth vehicle obey the scale caps',scaleOk,scale.measurements.map(m=>({id:m.id,kind:m.kind,bounds:m.bounds,failures:m.assertion.failures})));
  const normalSamples={};for(const fixture of['run','zone1','later'])normalSamples[fixture]=measureSubjects(fixture,4);
  const footprints=Object.fromEntries(Object.entries(normalSamples).map(([name,sample])=>[name,footprint(sample)]));
  gate('sampled normal-play actors obey caps and stay below 20% footprint',Object.values(footprints).every(f=>f.ok),footprints);

  // threats get the corridor: an oncoming express staged deep in the tunnel is
  // telegraphed (wig-wag headlight pre-glow) across >=55% of its travel axis
  const approach=measureSubjects('approach',40),mov=approach.measurements.find(m=>m.kind==='vehicle'),ap=approach.probe.layout.approach;
  const ratio=ap?ap.visible/ap.travel:0;
  gate('threat approach is visible across at least 55% of its travel axis',!!mov&&!!ap&&ap.travel>=600&&ratio>=.55&&mov.drawnPixels>=8&&!mov.clipped,{approach:ap,ratio:round(ratio),drawnPixels:mov&&mov.drawnPixels,bounds:mov&&mov.bounds});

  // express warning: signal heads + red wash + banner land BEFORE the wave
  const warnFrame=captureFixture('express-warn',[8]).get(8),calmFrame=captureFixture('express-calm',[8]).get(8);
  const warnDelta=frameDifference(calmFrame,warnFrame,{native:false,crop:WORLD_CROP});
  gate('express warning visibly transforms the tunnel mouth',warnDelta.changedFraction>=.005&&warnDelta.changedGridFraction>=.06,warnDelta);

  // line identity: four themes rebuild materials, furniture, and lighting
  // (measured 2026-07-11: sd .365...440, hash .249...326 across all pairs)
  const zoneFrames={run:candidate.run,zone1:captureFixture('zone1',[4],{id:'zone1'}).get(4),zone2:candidate.zone2,later:candidate.later};
  const zonePairs=[['run','zone1'],['zone1','zone2'],['zone2','later'],['run','later']].map(([a,b])=>({a,b,...structureDistance(zoneFrames[a],zoneFrames[b],{crop:WORLD_CROP})}));
  gate('line themes rebuild material and composition',zonePairs.every(d=>d.structureDistance>=.25&&d.hashDistance>=.18),zonePairs);

  // authored locomotion survives at native size (runner gait, inspector sprint, dog scramble)
  const motionProbe=captureFixture('actor-motion',[2]).get(2).probe;
  const motion={};
  for(const actor of motionProbe.actors)motion[actor.type+'-'+actor.id]=isolatedBurst('actor-motion',actor.id);
  const motionValues=Object.values(motion);
  gate('authored actor locomotion survives at native size',motionValues.length>=3&&motionValues.every(b=>b.changedFraction.max>=.02&&b.changedGridFraction.max>=.06),Object.fromEntries(Object.entries(motion).map(([k,b])=>[k,{cf:round(b.changedFraction.max),cg:round(b.changedGridFraction.max)}])));

  // each theme keeps ambient environmental motion with every actor removed
  const environmentMotion={};
  for(const fixture of['run','zone1','zone2','later']){
    const frames=captureFixture(fixture,OFFSETS,{selector:'env'});
    environmentMotion[fixture]=analyzeBurst(OFFSETS.map(o=>frames.get(o)),{native:false,crop:WORLD_CROP});}
  gate('each line theme retains ambient environmental motion',Object.values(environmentMotion).every(b=>b.changedFraction.max>=.05&&b.meanDelta.max>=.005),Object.fromEntries(Object.entries(environmentMotion).map(([k,b])=>[k,{cf:round(b.changedFraction.max),md:round(b.meanDelta.max)}])));

  // apex payoff: EXPRESS CLEARED is authored physically (banner, signal state,
  // slow-mo world); particles are a subordinate sim-inert layer
  const apexBefore=captureFixture('apex-before',[16]).get(16);
  const apexNoFx=captureFixture('apex',[16],{beforeSet:r=>{r.sandbox.__NO_PAYOFF_FX=1}}).get(16);
  const apexPhysical=frameDifference(apexBefore,apexNoFx,{native:false,crop:WORLD_CROP});
  const apexFx=frameDifference(apexNoFx,candidate.apex,{native:false,crop:WORLD_CROP});
  gate('apex has authored physical presentation without particles',apexPhysical.changedFraction>=.02&&apexPhysical.changedGridFraction>=.15,apexPhysical);
  gate('sim-inert payoff FX add a subordinate impact layer',apexFx.changedFraction>=.0002&&apexFx.changedFraction<=.08,apexFx);

  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256));
  let review;if(fs.existsSync(REVIEW_PATH))review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256,preservedPath:TRACKED_CONTACT_PATH});else review={ok:false,errors:[`missing committed semantic review: ${REVIEW_PATH}`,`inspect ${CONTACT_PATH} and complete ${REVIEW_TEMPLATE_PATH}`]};
  gate('fresh semantic comparison receipt',review.ok,review.errors);
  const expectedReview=reviewTemplate(sheet.sha256),reviewClip=review.receipt&&review.receipt.renderReceipt,localClip=fs.existsSync(CLIP_PATH)?{path:CLIP_PATH,bytes:fs.statSync(CLIP_PATH).size,sha256:sha256(CLIP_PATH)}:null;
  gate('rendered autoplay clip receipt is complete',!!reviewClip&&reviewClip.bytes>100000&&/^[a-f0-9]{64}$/.test(reviewClip.sha256||'')&&reviewClip.seed===`0x${SEED.toString(16)}`&&reviewClip.command===expectedReview.renderReceipt.command,reviewClip);
  gate('local rendered clip matches receipt when available',!localClip||reviewClip&&localClip.bytes===reviewClip.bytes&&localClip.sha256===reviewClip.sha256,{localClip,reviewClip});

  const report={schema:1,game:GAME,seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,contactSheet:{path:CONTACT_PATH,trackedPath:TRACKED_CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},clip:localClip,thresholds:{bands,actorScale:{standard:{maxWidth:14,maxHeight:18},dog:{maxWidth:12,maxHeight:10},vehicle:{maxWidth:24,maxHeight:36},footprint:.20,approach:.55,threshold:ACTOR_THRESHOLD}},metrics:{candidate:candidateMetrics,candidateMedian,referenceMedian,scale:scale.measurements,footprints,approach:{probe:ap,ratio},warnDelta,zonePairs,motion,apexPhysical,apexFx,environmentMotion},gates,automatedOk:gates.filter(g=>!['fresh semantic comparison receipt','rendered autoplay clip receipt is complete','local rendered clip matches receipt when available'].includes(g.name)).every(g=>g.ok),semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}};
  writeJson(METRICS_PATH,report);
  console.log(`SIDE SURFERS visual evidence · seed 0x${SEED.toString(16)}`);
  for(const item of gates)console.log(`  ${item.ok?'PASS':'FAIL'} ${item.name}`);
  console.log('  contact:',CONTACT_PATH);console.log('  montage sha256:',sheet.sha256);console.log('  metrics:',METRICS_PATH);
  if(!gates.every(g=>g.ok)){console.error('\nSIDE SURFERS VISUAL EVAL FAILED');process.exit(1)}
  console.log('\nSIDE SURFERS VISUAL EVAL PASSED');
}

try{main()}catch(error){console.error('SIDE SURFERS VISUAL EVAL FAILED:',error.stack||error);process.exit(1)}
