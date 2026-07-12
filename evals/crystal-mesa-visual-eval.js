#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const{bootRenderedGame,encodeRgbaPng}=require('../render/runtime');
const{
  sha256,analyzeFrame,frameDifference,structureDistance,analyzeBurst,
  measureDrawnActorExtent,assertActorScale,writeContactSheet,verifyReviewReceipt,writeJson
}=require('./visual-harness');

const GAME='crystal-mesa',SEED=0xc3a19b,RENDER_EVERY=1;
const ROOT=path.join(__dirname,'..'),ARTIFACT_DIR=path.join(ROOT,'.artifacts/visual/crystal-mesa');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'crystal-mesa-contact-sheet.png');
const TRACKED_CONTACT_PATH=path.join(__dirname,'visual-receipts/crystal-mesa-contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json'),REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews/crystal-mesa.json');
const CLIP_PATH=path.join(ARTIFACT_DIR,'crystal-mesa-30s.mp4');
// playfield below the HUD strip; the corridor is the whole show
const WORLD_CROP={x:10,y:16,width:140,height:334},ACTOR_THRESHOLD=8,ACTOR_PADDING=10;
const OFFSETS=[2,5,8,11,14,17];
const CONTACT_BEATS=[
  {id:'opening',label:'anomaly labs',fixture:'opening',offset:4},
  {id:'hurl',label:'charged hurl',fixture:'hurl',offset:4},
  {id:'catch',label:'bolt catch',fixture:'catch',offset:4},
  {id:'shield',label:'shield break',fixture:'shield',offset:6},
  {id:'slot',label:'cell slot',fixture:'slot',offset:4},
  {id:'zone1',label:'bio wing',fixture:'zone1',offset:4},
  {id:'later',label:'transit line',fixture:'later',offset:4},
  {id:'boss',label:'tripod guard',fixture:'boss',offset:6},
  {id:'apex',label:'tripod down',fixture:'apex',offset:10}
];

const median=values=>{const sorted=[...values].sort((a,b)=>a-b),middle=(sorted.length-1)/2,lo=Math.floor(middle),hi=Math.ceil(middle);return(sorted[lo]+sorted[hi])/2};
const round=value=>+value.toFixed(6);
const gates=[];
function gate(name,ok,detail){gates.push({name,ok:!!ok,detail});}

function visualProbe(runtime){const fn=runtime.sandbox.__cmVisualProbe;if(typeof fn!=='function')throw new Error('crystal-mesa.html must expose __cmVisualProbe()');const value=fn();if(!value||value.finite===false)throw new Error('Crystal Mesa visual fixture became non-finite');return value;}
function captureFixture(name,offsets,options){options=options||{};const runtime=bootRenderedGame(GAME,{seed:SEED});if(options.beforeSet)options.beforeSet(runtime);const set=runtime.sandbox.__cmSetVisualBeat;if(typeof set!=='function'||set(name)!==true)throw new Error('unknown Crystal Mesa visual beat: '+name);if(options.selector!==undefined)runtime.sandbox.__CM_VISUAL_ONLY_SUBJECT=options.selector;if(options.afterSet)options.afterSet(runtime);const frames=new Map();for(const target of[...new Set(offsets)].sort((a,b)=>a-b)){runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});const frame=runtime.snapshot({native:true});frame.probe=visualProbe(runtime);frame.fixture=options.id||name;frame.offset=target;frames.set(target,frame)}return frames;}
function captureTimeline(game,seed,targets){const runtime=bootRenderedGame(game,{seed}),frames=new Map(),preRoll=120;for(const target of targets){if(target-runtime.frame>preRoll)runtime.advanceTo(target-preRoll);runtime.advanceTo(target,{renderEvery:2,renderLast:true});frames.set(target,runtime.snapshot({native:true}))}return frames;}
function probeSubjects(probe,fixture){if(!Array.isArray(probe&&probe.actors))throw new Error(`${fixture}: visual probe must expose actors[]`);const ids=new Set();for(const actor of probe.actors){if(!actor||typeof actor.id!=='string'||!actor.id||typeof actor.kind!=='string')throw new Error(`${fixture}: malformed subject`);if(ids.has(actor.id))throw new Error(`${fixture}: duplicate subject ${actor.id}`);ids.add(actor.id);const b=actor.box;if(!b||![b.x,b.y,b.width,b.height].every(Number.isFinite)||!(b.width>0&&b.height>0))throw new Error(`${fixture}: invalid box for ${actor.id}`)}return probe.actors;}
function limitsFor(actor){if(actor.kind==='boss')return{maxWidth:34,maxHeight:34,label:`boss ${actor.type}`};if(actor.kind==='structure')return{maxWidth:24,maxHeight:24,label:`structure ${actor.type}`};if(actor.kind==='prop')return{maxWidth:20,maxHeight:20,label:`prop ${actor.type}`};return{maxWidth:20,maxHeight:32,label:`actor ${actor.type}`};}
function measureSubjects(fixture,offset){const baseline=captureFixture(fixture,[offset],{selector:'none',id:fixture+'-none'}).get(offset),actors=probeSubjects(baseline.probe,fixture),measurements=[];for(const actor of actors){const isolated=captureFixture(fixture,[offset],{selector:actor.id,id:`${fixture}-${actor.id}`}).get(offset),measurement=measureDrawnActorExtent(isolated,baseline,{id:actor.id,kind:actor.kind,type:actor.type,probeBox:actor.box,padding:ACTOR_PADDING,threshold:ACTOR_THRESHOLD}),assertion=assertActorScale(measurement,limitsFor(actor));measurements.push(Object.assign(measurement,{assertion:{ok:assertion.ok,failures:assertion.failures,limits:assertion.limits}}))}return{fixture,offset,probe:baseline.probe,measurements};}
function footprint(sample){const playfield=sample.probe.layout&&sample.probe.layout.playfield,area=playfield.width*playfield.height,actors=sample.measurements.filter(m=>m.kind==='standard'||m.kind==='boss'),sumArea=actors.reduce((n,m)=>n+m.bboxArea,0);return{fixture:sample.fixture,playfield,actorCount:actors.length,sumBboxArea:sumArea,sumFraction:round(sumArea/area),ok:actors.every(m=>m.assertion.ok&&!m.clipped)&&sumArea/area<=.20};}
function cropFromBox(box,pad){pad=pad||5;return{x:Math.max(0,Math.floor(box.x-pad)),y:Math.max(0,Math.floor(box.y-pad)),width:Math.ceil(box.width+pad*2),height:Math.ceil(box.height+pad*2)};}
function isolatedBurst(fixture,id){const frames=captureFixture(fixture,OFFSETS,{selector:id,id:`${fixture}-${id}-motion`}),ordered=OFFSETS.map(offset=>frames.get(offset)),subject=ordered[0].probe.actors.find(a=>a.id===id);if(!subject)throw new Error(`${fixture}: missing animated subject ${id}`);return analyzeBurst(ordered,{native:false,crop:cropFromBox(subject.box,4)});}
function reviewTemplate(montageSha){const command=`node render/render.js crystal-mesa 30 .artifacts/visual/crystal-mesa/crystal-mesa-30s.mp4 --seed ${SEED} --probe --fps 30`;return{schema:1,game:GAME,verdict:'pending',references:['horizon','blockmine'],montageSha256:montageSha,reviewedAt:'2026-07-11',reviewer:'complete after native-size review',seed:'0x'+SEED.toString(16),checkpoints:CONTACT_BEATS.map(b=>`${b.fixture}@${b.offset}`),guidelineOverlays:'none: the grav beam depicts a live physical force on a grabbed object; no path lines, predicted arcs, or future-position reticles are drawn at any sampled beat',categories:Object.fromEntries(['characterCraft','environmentCraft','levelVariety','animationImpact','readability','artDirectionCohesion'].map(name=>[name,{meetsMachineHunt:false,meetsBlockMine:false,note:''}])),renderReceipt:{seed:'0x'+SEED.toString(16),seconds:30,fps:30,codec:'h264',dimensions:'320x720',bytes:0,sha256:'',command}};}

function main(){fs.mkdirSync(ARTIFACT_DIR,{recursive:true});fs.mkdirSync(path.dirname(TRACKED_CONTACT_PATH),{recursive:true});
  const candidate={};for(const beat of CONTACT_BEATS){const run=captureFixture(beat.fixture,[beat.offset],{id:beat.id});candidate[beat.id]=run.get(beat.offset);const duplicate=captureFixture(beat.fixture,[beat.offset],{id:beat.id+'-duplicate'}).get(beat.offset);gate(`${beat.id} fixture is real-pixel deterministic`,sha256(candidate[beat.id].rgba)===sha256(duplicate.rgba),{first:sha256(candidate[beat.id].rgba),second:sha256(duplicate.rgba)});fs.writeFileSync(path.join(ARTIFACT_DIR,`${String(CONTACT_BEATS.indexOf(beat)+1).padStart(2,'0')}-${beat.id}.png`),encodeRgbaPng(candidate[beat.id]))}

  const referenceTargets=[60,600,1200,2400,3600,5400,7200,9000,12000];
  const horizon=captureTimeline('horizon',0xa1020401,referenceTargets),blockmine=captureTimeline('blockmine',0xb10c0050,referenceTargets),horizonBy={},blockmineBy={};
  CONTACT_BEATS.forEach((beat,i)=>{horizonBy[beat.id]=horizon.get(referenceTargets[i]);blockmineBy[beat.id]=blockmine.get(referenceTargets[i])});
  const sheet=writeContactSheet({beats:CONTACT_BEATS.map(b=>({id:b.id,label:b.label})),rows:[{label:'CRYSTAL MESA',frames:candidate},{label:'MACHINE HUNT',frames:horizonBy},{label:'BLOCK MINE',frames:blockmineBy}],outPath:CONTACT_PATH,labelWidth:92});
  // the tracked montage is preserved only via `node evals/preserve-visual-review.js crystal-mesa`

  const candidateMetrics=CONTACT_BEATS.map(b=>Object.assign({id:b.id},analyzeFrame(candidate[b.id],{native:false,crop:WORLD_CROP}))),horizonMetrics=CONTACT_BEATS.map(b=>analyzeFrame(horizonBy[b.id],{native:false,crop:WORLD_CROP})),blockmineMetrics=CONTACT_BEATS.map(b=>analyzeFrame(blockmineBy[b.id],{native:false,crop:WORLD_CROP}));
  // absolute floors pinned to the shipped art's measured beats (2026-07-11: colors
  // 86..121, entropy 2.18..3.49, edge .0102...0181, rich .69...96, share .22...47)
  // — a regression from today's density fails these before any reference math.
  const bands={colors:75,entropy:1.9,lumaStdDev:.05,largestColorShare:.55,edgeEnergy:.008,richEach:.6,richMedian:.75};
  const candidateMedian={colors:median(candidateMetrics.map(m=>m.quantizedColors)),entropy:median(candidateMetrics.map(m=>m.colorEntropy)),edge:median(candidateMetrics.map(m=>m.edge[1].energy)),rich:median(candidateMetrics.map(m=>m.richCellFraction))};
  const referenceMedian={horizon:{colors:median(horizonMetrics.map(m=>m.quantizedColors)),entropy:median(horizonMetrics.map(m=>m.colorEntropy)),edge:median(horizonMetrics.map(m=>m.edge[1].energy)),rich:median(horizonMetrics.map(m=>m.richCellFraction))},blockmine:{colors:median(blockmineMetrics.map(m=>m.quantizedColors)),entropy:median(blockmineMetrics.map(m=>m.colorEntropy)),edge:median(blockmineMetrics.map(m=>m.edge[1].energy)),rich:median(blockmineMetrics.map(m=>m.richCellFraction))}};
  gate('frames are opaque, non-flat, and spatially rich',candidateMetrics.every(m=>m.opaqueFraction===1&&m.quantizedColors>=bands.colors&&m.colorEntropy>=bands.entropy&&m.lumaStdDev>=bands.lumaStdDev&&m.largestColorShare<=bands.largestColorShare&&m.edge[1].energy>=bands.edgeEnergy&&m.richCellFraction>=bands.richEach)&&candidateMedian.rich>=bands.richMedian,{candidateMetrics:candidateMetrics.map(m=>({id:m.id,colors:m.quantizedColors,entropy:round(m.colorEntropy),luma:round(m.lumaStdDev),share:round(m.largestColorShare),edge:round(m.edge[1].energy),rich:round(m.richCellFraction)}))});
  // reference floor = the weaker of the two named references per metric. Measured
  // 2026-07-11: crystal-mesa (115/2.43/.0142/.82) sits BETWEEN machine hunt
  // (45/1.09/.0044/.47) and block mine (158/3.56/.027/.64) on every metric —
  // block mine is a full tile-mosaic whose raw entropy a readable corridor must
  // not chase (richness is not noise); machine hunt is the legibility-side floor.
  const referenceColor=Math.min(referenceMedian.horizon.colors,referenceMedian.blockmine.colors),referenceEntropy=Math.min(referenceMedian.horizon.entropy,referenceMedian.blockmine.entropy),referenceEdge=Math.min(referenceMedian.horizon.edge,referenceMedian.blockmine.edge),referenceRich=Math.min(referenceMedian.horizon.rich,referenceMedian.blockmine.rich);
  gate('multiscale world detail is reference-comparable',candidateMedian.colors>=referenceColor*.85&&candidateMedian.entropy>=referenceEntropy*.85&&candidateMedian.edge>=referenceEdge*.85&&candidateMedian.rich>=referenceRich*.85,{candidateMedian,referenceMedian});

  const scale=measureSubjects('actor-scale',4);
  const scaleOk=scale.measurements.every(m=>m.assertion.ok&&!m.clipped&&!(m.probeOverflow&&m.probeOverflow.any));
  gate('drawn hero, mite, warden, tripod, and props obey the scale caps',scaleOk,scale.measurements.map(m=>({id:m.id,kind:m.kind,bounds:m.bounds,failures:m.assertion.failures})));
  const normalSamples={};for(const fixture of['opening','zone1','later'])normalSamples[fixture]=measureSubjects(fixture,4);
  const footprints=Object.fromEntries(Object.entries(normalSamples).map(([name,sample])=>[name,footprint(sample)]));
  gate('sampled normal-play actors obey caps and stay below 20% footprint',Object.values(footprints).every(f=>f.ok),footprints);

  // threats get the corridor: a warden staged 200px up-field is fully on screen for its whole approach
  const approach=measureSubjects('approach',4),warden=approach.measurements.find(m=>m.kind==='standard'&&m.id!=='hero'),ap=approach.probe.layout.approach;
  const ratio=ap?ap.visible/ap.travel:0;
  gate('threat approach is visible across at least 55% of its travel axis',!!warden&&!!ap&&ap.travel>=160&&ratio>=.55&&warden.bounds&&warden.bounds.y>=0,{approach:ap,ratio:round(ratio),bounds:warden&&warden.bounds});

  // surge warning: crystals pulse hard and the banner blinks BEFORE anything lands
  const warnFrame=captureFixture('surge-warning',[8]).get(8),calmFrame=captureFixture('surge-calm',[8]).get(8);
  const warnDelta=frameDifference(calmFrame,warnFrame,{native:false,crop:WORLD_CROP});
  gate('resonance-surge warning visibly transforms the corridor',warnDelta.changedFraction>=.004&&warnDelta.changedGridFraction>=.04,warnDelta);

  // zone identity: four biomes rebuild palette and composition
  const levelPairs=[['opening','zone1'],['zone1','later'],['opening','later'],['zone1','apex']].map(([a,b])=>({a,b,...structureDistance(candidate[a],candidate[b]||candidate.apex,{crop:WORLD_CROP})}));
  const zonePairs=levelPairs.slice(0,3);
  gate('biome floors rebuild material and composition',zonePairs.every(d=>d.structureDistance>=.18&&d.hashDistance>=.16),zonePairs);

  // authored locomotion survives at native size
  const motion={hero:isolatedBurst('actor-motion','hero')};
  const motionProbe=captureFixture('actor-motion',[2]).get(2).probe;
  for(const actor of motionProbe.actors){if(actor.id==='hero')continue;
    motion[actor.type+'-'+actor.id]=isolatedBurst('actor-motion',actor.id);}
  const motionValues=Object.values(motion);
  gate('authored actor locomotion survives at native size',motionValues.every(b=>b.changedFraction.max>=.02&&b.changedGridFraction.max>=.06),Object.fromEntries(Object.entries(motion).map(([k,b])=>[k,{cf:round(b.changedFraction.max),cg:round(b.changedGridFraction.max)}])));

  // each biome keeps ambient environmental motion with every actor removed
  const environmentMotion={};
  for(const fixture of['opening','zone1','zone2','later']){
    const frames=captureFixture(fixture,OFFSETS,{selector:'env'});
    environmentMotion[fixture]=analyzeBurst(OFFSETS.map(o=>frames.get(o)),{native:false,crop:WORLD_CROP});}
  gate('each biome retains ambient environmental motion',Object.values(environmentMotion).every(b=>b.changedFraction.max>=.0012&&b.meanDelta.max>=.0003),Object.fromEntries(Object.entries(environmentMotion).map(([k,b])=>[k,{cf:round(b.changedFraction.max),md:round(b.meanDelta.max)}])));

  // apex payoff: the kill is authored physically; particles are a subordinate sim-inert layer
  const apexBefore=captureFixture('apex-before',[10]).get(10);
  const apexNoFx=captureFixture('apex',[10],{beforeSet:r=>{r.sandbox.__NO_PAYOFF_FX=1}}).get(10);
  const apexPhysical=frameDifference(apexBefore,apexNoFx,{native:false,crop:WORLD_CROP});
  const apexFx=frameDifference(apexNoFx,candidate.apex,{native:false,crop:WORLD_CROP});
  gate('apex has authored physical presentation without particles',apexPhysical.changedFraction>=.005&&apexPhysical.changedGridFraction>=.02,apexPhysical);
  gate('sim-inert payoff FX add a subordinate impact layer',apexFx.changedFraction>=.0004&&apexFx.changedFraction<=.08,apexFx);

  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256));
  let review;if(fs.existsSync(REVIEW_PATH))review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256,preservedPath:TRACKED_CONTACT_PATH});else review={ok:false,errors:[`missing committed semantic review: ${REVIEW_PATH}`,`inspect ${CONTACT_PATH} and complete ${REVIEW_TEMPLATE_PATH}`]};
  gate('fresh semantic comparison receipt',review.ok,review.errors);
  const expectedReview=reviewTemplate(sheet.sha256),reviewClip=review.receipt&&review.receipt.renderReceipt,localClip=fs.existsSync(CLIP_PATH)?{path:CLIP_PATH,bytes:fs.statSync(CLIP_PATH).size,sha256:sha256(CLIP_PATH)}:null;
  gate('rendered autoplay clip receipt is complete',!!reviewClip&&reviewClip.bytes>100000&&/^[a-f0-9]{64}$/.test(reviewClip.sha256||'')&&reviewClip.seed===`0x${SEED.toString(16)}`&&reviewClip.command===expectedReview.renderReceipt.command,reviewClip);
  gate('local rendered clip matches receipt when available',!localClip||reviewClip&&localClip.bytes===reviewClip.bytes&&localClip.sha256===reviewClip.sha256,{localClip,reviewClip});

  const report={schema:1,game:GAME,seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,contactSheet:{path:CONTACT_PATH,trackedPath:TRACKED_CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},clip:localClip,thresholds:{bands,actorScale:{standard:{maxWidth:20,maxHeight:32},boss:{maxWidth:34,maxHeight:34},prop:{maxWidth:20,maxHeight:20},footprint:.20,approach:.55,threshold:ACTOR_THRESHOLD}},metrics:{candidate:candidateMetrics,candidateMedian,referenceMedian,scale:scale.measurements,footprints,approach:{probe:ap,ratio},warnDelta,zonePairs,motion,apexPhysical,apexFx,environmentMotion},gates,automatedOk:gates.filter(g=>!['fresh semantic comparison receipt','rendered autoplay clip receipt is complete','local rendered clip matches receipt when available'].includes(g.name)).every(g=>g.ok),semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}};
  writeJson(METRICS_PATH,report);
  console.log(`CRYSTAL MESA visual evidence · seed 0x${SEED.toString(16)}`);
  for(const item of gates)console.log(`  ${item.ok?'PASS':'FAIL'} ${item.name}`);
  console.log('  contact:',CONTACT_PATH);console.log('  montage sha256:',sheet.sha256);console.log('  metrics:',METRICS_PATH);
  if(!gates.every(g=>g.ok)){console.error('\nCRYSTAL MESA VISUAL EVAL FAILED');process.exit(1)}
  console.log('\nCRYSTAL MESA VISUAL EVAL PASSED');
}

try{main()}catch(error){console.error('CRYSTAL MESA VISUAL EVAL FAILED:',error.stack||error);process.exit(1)}
