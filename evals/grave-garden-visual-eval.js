#!/usr/bin/env node
'use strict';

// GRAVE GARDEN real-pixel release gate. Behavioral truth lives in
// grave-garden-eval.js; this suite asks the game for deterministic authored
// visual fixtures, renders the actual canvas, and measures the resulting RGBA
// at the native 160x360 viewer size. A separate hashed semantic receipt records
// the reference-based visual judgment that pixel statistics cannot make.
const fs=require('fs');
const path=require('path');
const{createRequire}=require('module');
const{
  bootRenderedGame,rgbaFrame,encodeRgbaPng
}=require('../render/runtime');
const{
  sha256,toNativeFrame,analyzeFrame,frameDifference,structureDistance,analyzeBurst,
  measureDrawnActorExtent,assertActorScale,writeContactSheet,verifyReviewReceipt,writeJson,quantile
}=require('./visual-harness');

const ROOT=path.join(__dirname,'..');
const GAME_PATH=path.join(__dirname,'..','grave-garden.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','grave-garden');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const TRACKED_CONTACT_PATH=path.join(__dirname,'visual-receipts','grave-garden-scale-contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','grave-garden.json');
const BASELINE_DIR=path.join(__dirname,'visual-baselines','grave-garden-v1');
const BASELINE_MANIFEST_PATH=path.join(BASELINE_DIR,'manifest.json');
const SEED=0x6752444e,PRE_ROLL=120,RENDER_EVERY=2;
const WORLD_CROP={x:0,y:52,width:160,height:240};
const SCALE_OFFSET=12,ACTOR_PADDING=8,ACTOR_THRESHOLD=8;
const canvasRequire=createRequire(path.join(ROOT,'render','package.json'));
const{createCanvas,loadImage}=canvasRequire('@napi-rs/canvas');

if(!fs.existsSync(GAME_PATH)){
  console.error('GRAVE GARDEN VISUAL EVAL FAILED: missing '+GAME_PATH);
  process.exit(1);
}

const median=values=>quantile(values,.5);

async function loadBaselineFrames(){
  if(!fs.existsSync(BASELINE_MANIFEST_PATH))throw new Error('missing Grave Garden v1 visual baseline manifest');
  const manifest=JSON.parse(fs.readFileSync(BASELINE_MANIFEST_PATH,'utf8'));
  if(manifest.schema!==1||manifest.game!=='grave-garden'||manifest.seed!=='0x'+SEED.toString(16))
    throw new Error('invalid Grave Garden v1 visual baseline manifest identity');
  if(manifest.width!==160||manifest.height!==360)throw new Error('Grave Garden v1 baseline is not native 160x360');
  if(!Array.isArray(manifest.frames)||!manifest.frames.length)throw new Error('Grave Garden v1 baseline has no frames');
  const frames=new Map();
  for(const receipt of manifest.frames){
    if(!receipt||typeof receipt.id!=='string'||typeof receipt.file!=='string'||typeof receipt.sha256!=='string')
      throw new Error('malformed Grave Garden v1 frame receipt');
    const filePath=path.join(BASELINE_DIR,receipt.file),encoded=fs.readFileSync(filePath);
    if(sha256(encoded)!==receipt.sha256)throw new Error('Grave Garden v1 frame hash mismatch: '+receipt.id);
    const image=await loadImage(encoded);
    if(image.width!==manifest.width||image.height!==manifest.height)
      throw new Error(`Grave Garden v1 ${receipt.id} is ${image.width}x${image.height}, expected 160x360`);
    const canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');
    ctx.imageSmoothingEnabled=false;ctx.drawImage(image,0,0);
    if(frames.has(receipt.id))throw new Error('duplicate Grave Garden v1 frame id: '+receipt.id);
    frames.set(receipt.id,rgbaFrame(canvas.data(),canvas.width,canvas.height,
      {source:'grave-garden-v1/'+receipt.file,fixture:receipt.fixture,offset:receipt.offset}));
  }
  const montage=manifest.contactSheet||{},montagePath=path.join(BASELINE_DIR,montage.file||'');
  if(!montage.file||!fs.existsSync(montagePath)||sha256(fs.readFileSync(montagePath))!==montage.sha256)
    throw new Error('Grave Garden v1 contact-sheet receipt hash mismatch');
  return{manifest,frames};
}

function visualProbe(runtime){
  const fn=runtime.sandbox.__graveGardenVisualProbe;
  if(typeof fn!=='function')throw new Error('grave-garden.html must expose __graveGardenVisualProbe()');
  const value=fn();
  if(!value||value.finite===false)throw new Error('grave-garden visual fixture produced non-finite state');
  return value;
}

function captureFixture(name,offsets,options){
  options=options||{};
  const runtime=bootRenderedGame('grave-garden',{seed:SEED});
  if(options.beforeSet)options.beforeSet(runtime);
  const setBeat=runtime.sandbox.__graveGardenSetVisualBeat;
  if(typeof setBeat!=='function')throw new Error('grave-garden.html must expose __graveGardenSetVisualBeat(name)');
  if(setBeat(name)!==true)throw new Error('unknown Grave Garden visual beat: '+name);
  if(options.actorSelector!==undefined)runtime.sandbox.__GG_VISUAL_ONLY_ACTOR=options.actorSelector;
  if(options.afterSet)options.afterSet(runtime);
  const frames=new Map();
  for(const target of [...new Set(offsets)].sort((a,b)=>a-b)){
    runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});
    const frame=runtime.snapshot({native:true});
    frame.probe=visualProbe(runtime);frame.fixture=options.id||name;frame.offset=target;
    frames.set(target,frame);
  }
  return frames;
}

function captureTimeline(gameName,seed,targets){
  const runtime=bootRenderedGame(gameName,{seed}),frames=new Map();
  for(const target of [...new Set(targets)].sort((a,b)=>a-b)){
    if(target-runtime.frame>PRE_ROLL)runtime.advanceTo(target-PRE_ROLL);
    runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});
    frames.set(target,runtime.snapshot({native:true}));
  }
  return frames;
}

function fixedCrop(frame,box,size){
  size=size||40;
  const source=toNativeFrame(frame),cx=Math.round(box.x+box.width/2),cy=Math.round(box.y+box.height/2);
  const out=Buffer.alloc(size*size*4),left=cx-Math.floor(size/2),top=cy-Math.floor(size/2);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const sx=left+x,sy=top+y,dst=(y*size+x)*4;
    if(sx<0||sy<0||sx>=source.width||sy>=source.height){out[dst+3]=255;continue;}
    const src=(sy*source.width+sx)*4;
    out[dst]=source.rgba[src];out[dst+1]=source.rgba[src+1];out[dst+2]=source.rgba[src+2];out[dst+3]=source.rgba[src+3];
  }
  return rgbaFrame(out,size,size,{frame:frame.frame,fixture:frame.fixture,offset:frame.offset});
}

function analyzeAlignedBurst(frames,boxSource,options){
  options=options||{};const cropSize=options.cropSize||40;
  const crops=[];
  for(const frame of frames){
    const box=typeof boxSource==='string'?frame.probe&&frame.probe[boxSource]:boxSource;
    if(!box||!(box.width>0&&box.height>0))return null;
    crops.push(fixedCrop(frame,box,cropSize));
  }
  const differences=[];
  for(let i=1;i<crops.length;i++)differences.push(frameDifference(crops[i-1],crops[i],{native:false}));
  return{
    frames:crops.length,cropSize,differences,
    changedFraction:{
      min:Math.min(...differences.map(value=>value.changedFraction)),
      median:median(differences.map(value=>value.changedFraction)),
      max:Math.max(...differences.map(value=>value.changedFraction))
    },
    firstLast:frameDifference(crops[0],crops.at(-1),{native:false})
  };
}

function probeActors(probe,fixture){
  const actors=probe&&probe.actors;
  if(!Array.isArray(actors))throw new Error(`${fixture}: visual probe must expose actors[]`);
  const ids=new Set();
  for(const actor of actors){
    if(!actor||typeof actor.id!=='string'||!actor.id||typeof actor.kind!=='string'||!actor.kind)
      throw new Error(`${fixture}: every probed actor needs string id/kind`);
    if(ids.has(actor.id))throw new Error(`${fixture}: duplicate actor id ${actor.id}`);ids.add(actor.id);
    const box=actor.box;
    if(!box||![box.x,box.y,box.width,box.height].every(Number.isFinite)||!(box.width>0&&box.height>0))
      throw new Error(`${fixture}: actor ${actor.id} has an invalid probe box`);
  }
  return actors;
}

function actorLimits(actor){
  if(actor.kind==='barrow')return{maxWidth:24,maxHeight:24};
  if(actor.kind==='plant'||actor.kind==='gardener'||actor.kind==='zombie')return{maxWidth:20,maxHeight:32};
  return{};
}

function validActorMeasurement(value){
  return!!value&&!!value.bounds&&value.drawnPixels>=1&&!value.clipped&&
    !(value.probeOverflow&&value.probeOverflow.any);
}

function measureFixtureActors(fixture,offset,probe){
  const actors=probeActors(probe,fixture),baseline=captureFixture(fixture,[offset],
    {id:`${fixture}-actors-none`,actorSelector:'none'}).get(offset),measurements=[];
  for(const actor of actors){
    const isolated=captureFixture(fixture,[offset],
      {id:`${fixture}-actor-${actor.id}`,actorSelector:actor.id}).get(offset);
    const measurement=measureDrawnActorExtent(isolated,baseline,{
      id:actor.id,kind:actor.kind,type:actor.type||null,probeBox:actor.box,
      padding:ACTOR_PADDING,threshold:ACTOR_THRESHOLD
    });
    const limits=Object.assign({label:`${actor.kind} ${actor.type||actor.id}`},actorLimits(actor));
    const assertion=assertActorScale(measurement,limits);
    measurements.push(Object.assign(measurement,{assertion:{ok:assertion.ok,failures:assertion.failures,limits:assertion.limits}}));
  }
  return{fixture,offset,actors,measurements};
}

function intersectBounds(bounds,playfield){
  if(!bounds||!playfield)return null;
  const x=Math.max(bounds.x,Math.ceil(playfield.x)),y=Math.max(bounds.y,Math.ceil(playfield.y));
  const right=Math.min(bounds.x+bounds.width,Math.floor(playfield.x+playfield.width));
  const bottom=Math.min(bounds.y+bounds.height,Math.floor(playfield.y+playfield.height));
  return right>x&&bottom>y?{x,y,width:right-x,height:bottom-y}:null;
}

function unionBoundsArea(bounds,playfield){
  const width=Math.round(playfield.width),height=Math.round(playfield.height);
  if(width<=0||height<=0)return 0;
  const occupied=new Uint8Array(width*height),originX=Math.round(playfield.x),originY=Math.round(playfield.y);
  for(const raw of bounds){
    const box=intersectBounds(raw,playfield);if(!box)continue;
    for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++)
      occupied[(y-originY)*width+x-originX]=1;
  }
  let area=0;for(const value of occupied)area+=value;return area;
}

function summarizeFootprint(label,actorSet,layout){
  const playfield=layout&&layout.playfield,validPlayfield=!!playfield&&
    [playfield.x,playfield.y,playfield.width,playfield.height].every(Number.isFinite)&&
    Number.isInteger(playfield.x)&&Number.isInteger(playfield.y)&&
    playfield.width===160&&playfield.height===240;
  if(!validPlayfield)return{label,ok:false,errors:['probe layout.playfield must be exactly 160x240'],playfield};
  const visible=actorSet.measurements.map(value=>intersectBounds(value.bounds,playfield)).filter(Boolean);
  const playfieldArea=playfield.width*playfield.height;
  const sumBboxArea=visible.reduce((sum,box)=>sum+box.width*box.height,0);
  const unionBboxArea=unionBoundsArea(visible,playfield);
  const invalid=actorSet.measurements.flatMap(value=>{
    const errors=[];
    if(!value.bounds||value.drawnPixels<1)errors.push(`${value.id}: no rendered actor pixels measured`);
    if(value.clipped)errors.push(`${value.id}: drawn extent touches its measurement crop`);
    if(value.probeOverflow&&value.probeOverflow.any)errors.push(`${value.id}: drawn extent exceeds its probe box`);
    return errors;
  });
  const scaleFailures=actorSet.measurements.flatMap(value=>value.assertion.failures)
    .filter(value=>/drawn (width|height)/.test(value));
  const sumFraction=sumBboxArea/playfieldArea,unionFraction=unionBboxArea/playfieldArea;
  const errors=[...invalid];if(sumFraction>.20)errors.push(`${label}: summed actor footprint ${sumFraction.toFixed(4)} > 0.20`);
  return{label,ok:errors.length===0,errors,scaleOk:scaleFailures.length===0,scaleFailures,
    playfield,actors:actorSet.measurements.length,
    sumBboxArea,unionBboxArea,sumFraction:+sumFraction.toFixed(6),unionFraction:+unionFraction.toFixed(6),
    measurements:actorSet.measurements};
}

function measureApproach(layout){
  layout=layout||{};
  const{visibleSpawnX,contactX,goalX,approachVisibilityFraction}=layout;
  const finite=[visibleSpawnX,contactX,goalX,approachVisibilityFraction].every(Number.isFinite);
  const denominator=visibleSpawnX-goalX;
  const measured=finite&&denominator>0?(visibleSpawnX-contactX)/denominator:NaN;
  return{visibleSpawnX,contactX,goalX,reported:approachVisibilityFraction,
    measured:Number.isFinite(measured)?+measured.toFixed(6):null,
    matchesProbe:Number.isFinite(measured)&&Math.abs(measured-approachVisibilityFraction)<=1e-6,
    ok:Number.isFinite(measured)&&measured>=.55&&Math.abs(measured-approachVisibilityFraction)<=1e-6};
}

function buildCandidateEvidence(){
  const specs={
    opening:{fixture:'opening',offsets:[12]},
    formation:{fixture:'formation',offsets:[1,3,5,7,12]},
    warning:{fixture:'warning',offsets:[12]},
    danger:{fixture:'danger',offsets:[12]},
    anticipation:{fixture:'save-anticipation',offsets:[1,3,5,6,7,9,13]},
    payoff:{fixture:'save-payoff',offsets:[1,3,6,12,24]},
    later:{fixture:'later',offsets:[1,8,12,16,24,32,34,35,37,41]},
    apex:{fixture:'apex',offsets:[1,6,12,24,48]},
    warningCalm:{fixture:'warning',offsets:[12],afterSet:runtime=>runtime.evaluate("act.phase='calm';")},
    apexCalm:{fixture:'apex',offsets:[1],
      beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;},
      afterSet:runtime=>runtime.evaluate("SHOW.reset(showFrame);texts=[];pres={cue:null,t:0,holdWorld:false,physicsEvery:1,admire:false};")}
  };
  const runs={};
  for(const[id,spec]of Object.entries(specs))runs[id]=captureFixture(spec.fixture,spec.offsets,{id,beforeSet:spec.beforeSet,afterSet:spec.afterSet});
  const beats=[
    {id:'opening',label:'opening',run:'opening',offset:12},
    {id:'formation',label:'formation',run:'formation',offset:12},
    {id:'warning',label:'warning',run:'warning',offset:12},
    {id:'danger',label:'danger',run:'danger',offset:12},
    {id:'anticipation',label:'save ready',run:'anticipation',offset:6},
    {id:'payoff',label:'save payoff',run:'payoff',offset:6},
    {id:'later',label:'later garden',run:'later',offset:35},
    {id:'apex',label:'apex',run:'apex',offset:6}
  ];
  const frames=Object.fromEntries(beats.map(beat=>[beat.id,runs[beat.run].get(beat.offset)]));
  const all=[];
  for(const[id,frameMap]of Object.entries(runs))for(const[offset,frame]of frameMap)all.push({id,offset,frame});
  return{specs,runs,beats,frames,all};
}

function reviewTemplate(montageSha256,beats,specs){
  const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});
  return{
    schema:1,game:'grave-garden',verdict:'pending',references:['horizon','blockmine'],montageSha256,
    reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size reference review',
    seed:'0x'+SEED.toString(16),
    checkpoints:beats.map(beat=>`${specs[beat.run].fixture}@${beat.offset}`),
    oldBaseline:{version:'v1-overscale',seed:'0x'+SEED.toString(16),pairedBeats:true},
    categories:{
      characterCraft:pending('Inspect gardener, plants, and undead construction, silhouettes, facing, locomotion, and reaction poses at 160x360.'),
      environmentCraft:pending('Inspect greenhouse, cultivated beds, grave corridor, sky, landmarks, and foreground material layering with the HUD mentally removed.'),
      levelVariety:pending('Confirm opening and later chapters change landmark composition and silhouette, not only palette.'),
      animationImpact:pending('Confirm the aligned actors animate and the save/apex read as anticipation, contact, follow-through, and aftermath rather than particle flashes.'),
      readability:pending('Confirm formation gaps, incoming lane, weak-lane danger, gardener intent, enemies, and projectiles remain legible beside video.'),
      artDirectionCohesion:pending('Confirm character, garden, graveyard, HUD, material highlights, and payoff grammar feel authored as one world.')
    }
  };
}

async function main(){
  if(fs.existsSync(FRAME_DIR))for(const file of fs.readdirSync(FRAME_DIR))if(file.endsWith('.png'))fs.unlinkSync(path.join(FRAME_DIR,file));
  fs.mkdirSync(FRAME_DIR,{recursive:true});

  const evidence=buildCandidateEvidence(),repeat=buildCandidateEvidence(),oldBaseline=await loadBaselineFrames();
  const determinism=evidence.all.map(value=>{
    const other=repeat.runs[value.id].get(value.offset),a=sha256(value.frame.rgba),b=sha256(other.rgba);
    return{fixture:value.id,offset:value.offset,a,b,ok:a===b};
  });
  const deterministic=determinism.every(value=>value.ok);
  const{beats,frames:candidate}=evidence;

  const referenceTargets=[60,600,1200,2400,3600,5400,9000,12000];
  const horizon=captureTimeline('horizon',0xa1020401,referenceTargets);
  const blockmine=captureTimeline('blockmine',0xb10c0050,referenceTargets);
  const horizonByBeat={},blockmineByBeat={},oldByBeat={};
  beats.forEach((beat,index)=>{
    horizonByBeat[beat.id]=horizon.get(referenceTargets[index]);
    blockmineByBeat[beat.id]=blockmine.get(referenceTargets[index]);
    const oldReceipt=oldBaseline.manifest.frames.find(value=>value.id===beat.id);
    const fixture=evidence.specs[beat.run].fixture;
    if(!oldReceipt||oldReceipt.fixture!==fixture||oldReceipt.offset!==beat.offset)
      throw new Error(`Grave Garden v1 ${beat.id} is not paired to ${fixture}@${beat.offset}`);
    oldByBeat[beat.id]=oldBaseline.frames.get(beat.id);
    fs.writeFileSync(path.join(FRAME_DIR,`${String(index+1).padStart(2,'0')}-${beat.id}.png`),encodeRgbaPng(candidate[beat.id]));
  });
  const sheet=writeContactSheet({
    beats:beats.map(beat=>({id:beat.id,label:beat.label})),
    rows:[
      {label:'OLD GRAVE GARDEN',frames:oldByBeat},
      {label:'GRAVE GARDEN',frames:candidate},
      {label:'MACHINE HUNT',frames:horizonByBeat},
      {label:'BLOCK MINE',frames:blockmineByBeat}
    ],outPath:CONTACT_PATH
  });
  fs.mkdirSync(path.dirname(TRACKED_CONTACT_PATH),{recursive:true});

  const candidateMetrics=Object.fromEntries(beats.map(beat=>[beat.id,analyzeFrame(candidate[beat.id],{native:false,crop:WORLD_CROP})]));
  const horizonMetrics=beats.map(beat=>analyzeFrame(horizonByBeat[beat.id],{native:false,crop:WORLD_CROP}));
  const blockmineMetrics=beats.map(beat=>analyzeFrame(blockmineByBeat[beat.id],{native:false,crop:WORLD_CROP}));
  const cm=Object.values(candidateMetrics);
  const refEdge=Math.min(median(horizonMetrics.map(value=>value.edge[1].energy)),median(blockmineMetrics.map(value=>value.edge[1].energy)));
  const refRich=Math.min(median(horizonMetrics.map(value=>value.richCellFraction)),median(blockmineMetrics.map(value=>value.richCellFraction)));

  const scaleFrame=captureFixture('scale-contract',[SCALE_OFFSET],{id:'scale-contract'}).get(SCALE_OFFSET);
  const scaleContract=measureFixtureActors('scale-contract',SCALE_OFFSET,scaleFrame.probe);
  const scaleKinds=new Map();
  for(const actor of scaleContract.actors){const values=scaleKinds.get(actor.kind)||new Set();values.add(actor.type||actor.id);scaleKinds.set(actor.kind,values);}
  const expectedScaleTypes={plant:['bloom','pea','thorn','lantern'],zombie:['shambler','hound','bucket','brute']};
  const scaleCoverage={
    gardener:(scaleKinds.get('gardener')||new Set()).size>=1,
    barrow:(scaleKinds.get('barrow')||new Set()).size>=1,
    plant:expectedScaleTypes.plant.every(type=>(scaleKinds.get('plant')||new Set()).has(type)),
    zombie:expectedScaleTypes.zombie.every(type=>(scaleKinds.get('zombie')||new Set()).has(type))
  };
  const cappedScaleMeasurements=scaleContract.measurements.filter(value=>
    value.kind==='plant'||value.kind==='gardener'||value.kind==='zombie'||value.kind==='barrow');
  const approach=measureApproach(scaleFrame.probe&&scaleFrame.probe.layout);
  const footprintSamples={};
  for(const id of['opening','danger','later']){
    const beat=beats.find(value=>value.id===id),fixture=evidence.specs[beat.run].fixture;
    const actorSet=measureFixtureActors(fixture,beat.offset,candidate[id].probe);
    footprintSamples[id]=summarizeFootprint(id,actorSet,candidate[id].probe&&candidate[id].probe.layout);
  }

  const gardenerBurst=analyzeAlignedBurst([1,3,5,7,9,13].map(offset=>evidence.runs.anticipation.get(offset)),
    'gardenerBox',{cropSize:32});
  // Later's lane-one PEA WARD fires on frame 35. Align its authored head and
  // recoil rather than accepting the idle lane-three plant returned by the
  // general-purpose visual probe.
  const plantBurst=analyzeAlignedBurst([32,34,35,37,41].map(offset=>evidence.runs.later.get(offset)),
    'plantBox',{cropSize:28});
  const zombieBurst=analyzeAlignedBurst([1,8,16,24,32].map(offset=>evidence.runs.later.get(offset)),'zombieBox');
  const earlyLater=structureDistance(candidate.opening,candidate.later,{crop:WORLD_CROP});
  const warningContrast=frameDifference(evidence.runs.warningCalm.get(12),candidate.warning,{native:false,crop:WORLD_CROP});
  const saveDelta=frameDifference(candidate.anticipation,candidate.payoff,{native:false,crop:WORLD_CROP});
  const saveBurst=analyzeBurst([1,3,6,12,24].map(offset=>evidence.runs.payoff.get(offset)),{native:false,crop:WORLD_CROP});
  const apexDelta=frameDifference(evidence.runs.apexCalm.get(1),evidence.runs.apex.get(1),{native:false,crop:WORLD_CROP});
  const apexBurst=analyzeBurst([1,6,12,24,48].map(offset=>evidence.runs.apex.get(offset)),{native:false,crop:WORLD_CROP});

  // Fixed-seed calibration for the approved scale-rework capture, retaining
  // roughly 10-20% regression margin: the eight native cells measured 113..184
  // colors, 4.451..4.864 entropy, .124..168 luma deviation, .0271..0430 edge
  // energy, and .978 rich cells. Aligned actor and payoff measurements are
  // preserved in metrics.json beside the executable floors below.
  const bands={
    colors:100,entropy:3.9,lumaStdDev:.105,largestColorShare:.23,
    edgeEnergy:.0225,richEach:.82,richMedian:.88,
    gardenerMax:.045,gardenerFirstLast:.054,gardenerGrid:.26,
    plantMax:.047,plantFirstLast:.047,plantGrid:.18,
    zombieMax:.052,zombieFirstLast:.123,zombieGrid:.59,
    earlyLaterStructure:.19,earlyLaterEdge:.29,
    warningChanged:.062,warningMean:.0031,warningGrid:.11,warningBounds:.062,
    saveChanged:.115,saveMean:.0105,saveGrid:.18,saveBounds:.125,
    saveBurstChanged:.26,saveBurstGrid:.82,saveBurstStructure:.245,
    apexChanged:.83,apexMean:.058,apexGrid:.84,apexBounds:.84,apexBurstGrid:.28
  };

  const gates=[];
  const gate=(name,ok,detail)=>gates.push({name,ok:!!ok,detail});
  gate('same-seed real pixels deterministic',deterministic,determinism);
  gate('v1 frames are hash-verified and paired to identical beats',beats.every(beat=>!!oldByBeat[beat.id]),
    {manifest:BASELINE_MANIFEST_PATH,sourceCommit:oldBaseline.manifest.sourceCommit,seed:oldBaseline.manifest.seed});
  gate('all requested fixtures are finite and truthful',beats.every(beat=>candidate[beat.id].probe&&candidate[beat.id].probe.finite!==false),
    beats.map(beat=>({beat:beat.id,probe:candidate[beat.id].probe})));
  gate('scale fixture covers every standard actor variant',Object.values(scaleCoverage).every(Boolean),
    {coverage:scaleCoverage,kinds:Object.fromEntries([...scaleKinds].map(([kind,types])=>[kind,[...types]]))});
  gate('isolated actor pixels are present, unclipped, and probe-contained',
    scaleContract.measurements.every(validActorMeasurement),scaleContract.measurements);
  gate('drawn standard actors and barrows obey native-size caps',
    cappedScaleMeasurements.length>=10&&cappedScaleMeasurements.every(value=>value.assertion.ok),cappedScaleMeasurements);
  gate('sampled normal-play actor poses obey native-size caps',
    Object.values(footprintSamples).every(value=>value.scaleOk),
    Object.fromEntries(Object.entries(footprintSamples).map(([id,value])=>[id,value.scaleFailures])));
  gate('threat approach occupies at least 55% of its visible travel axis',approach.ok,approach);
  gate('normal-play actor footprints stay within 20% of the 160x240 playfield',
    Object.values(footprintSamples).every(value=>value.ok),footprintSamples);
  gate('frames are opaque and non-flat',cm.every(value=>value.opaqueFraction===1&&value.quantizedColors>=bands.colors&&value.colorEntropy>=bands.entropy&&value.lumaStdDev>=bands.lumaStdDev&&value.largestColorShare<=bands.largestColorShare),
    cm.map(value=>({colors:value.quantizedColors,entropy:value.colorEntropy,lumaStdDev:value.lumaStdDev,largest:value.largestColorShare})));
  gate('multiscale edge detail meets reference floor',cm.every(value=>value.edge[1].energy>=Math.max(bands.edgeEnergy,refEdge*.85)&&value.edge[4].energy>value.edge[1].energy),
    {candidate:cm.map(value=>value.edge),referenceFloor:refEdge});
  gate('spatial richness meets reference floor',cm.every(value=>value.richCellFraction>=bands.richEach)&&median(cm.map(value=>value.richCellFraction))>=Math.max(bands.richMedian,refRich*.90),
    {candidate:cm.map(value=>value.richCellFraction),candidateMedian:median(cm.map(value=>value.richCellFraction)),referenceFloor:refRich});
  gate('gardener has aligned temporal animation',!!gardenerBurst&&gardenerBurst.changedFraction.max>=bands.gardenerMax&&gardenerBurst.firstLast.changedFraction>=bands.gardenerFirstLast&&gardenerBurst.firstLast.changedGridFraction>=bands.gardenerGrid&&gardenerBurst.changedFraction.max<=.70,gardenerBurst);
  gate('plant has aligned temporal animation',!!plantBurst&&plantBurst.changedFraction.max>=bands.plantMax&&plantBurst.firstLast.changedFraction>=bands.plantFirstLast&&plantBurst.firstLast.changedGridFraction>=bands.plantGrid&&plantBurst.changedFraction.max<=.65,plantBurst);
  gate('undead has aligned locomotion animation',!!zombieBurst&&zombieBurst.changedFraction.max>=bands.zombieMax&&zombieBurst.firstLast.changedFraction>=bands.zombieFirstLast&&zombieBurst.firstLast.changedGridFraction>=bands.zombieGrid&&zombieBurst.changedFraction.max<=.65,zombieBurst);
  gate('later garden changes structure, not only palette',earlyLater.structureDistance>=bands.earlyLaterStructure&&earlyLater.edgeMagnitudeDistance>=bands.earlyLaterEdge,earlyLater);
  gate('blood-moon warning is visibly distinct',warningContrast.changedFraction>=bands.warningChanged&&warningContrast.meanDelta>=bands.warningMean&&warningContrast.changedGridFraction>=bands.warningGrid&&warningContrast.changedBoundsFraction>=bands.warningBounds,warningContrast);
  gate('last-second save is spatially broad',saveDelta.changedFraction>=bands.saveChanged&&saveDelta.meanDelta>=bands.saveMean&&saveDelta.changedGridFraction>=bands.saveGrid&&saveDelta.changedBoundsFraction>=bands.saveBounds&&saveBurst.changedFraction.max>=bands.saveBurstChanged&&saveBurst.changedGridFraction.max>=bands.saveBurstGrid&&saveBurst.firstLast.structureDistance>=bands.saveBurstStructure,
    {saveDelta,saveBurst});
  gate('apex presentation is spatially broad',apexDelta.changedFraction>=bands.apexChanged&&apexDelta.meanDelta>=bands.apexMean&&apexDelta.changedGridFraction>=bands.apexGrid&&apexDelta.changedBoundsFraction>=bands.apexBounds&&apexBurst.changedGridFraction.max>=bands.apexBurstGrid,
    {apexDelta,apexBurst});
  gate('candidate numeric richness is reference-comparable',median(cm.map(value=>value.edge[1].energy))>=refEdge*.9&&median(cm.map(value=>value.richCellFraction))>=refRich*.9,
    {candidateEdge:median(cm.map(value=>value.edge[1].energy)),referenceEdge:refEdge,candidateRich:median(cm.map(value=>value.richCellFraction)),referenceRich:refRich});

  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256,beats,evidence.specs));
  let review;
  if(fs.existsSync(REVIEW_PATH))review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256,preservedPath:TRACKED_CONTACT_PATH});
  else review={ok:false,errors:[`missing committed semantic review: ${REVIEW_PATH}`,`inspect ${CONTACT_PATH}, then copy and complete ${REVIEW_TEMPLATE_PATH}`]};
  gate('fresh semantic comparison receipt',review.ok,review.errors);

  const report={
    schema:1,game:'grave-garden',seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,
    contactSheet:{path:CONTACT_PATH,trackedPath:TRACKED_CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    oldBaseline:{manifest:BASELINE_MANIFEST_PATH,sourceCommit:oldBaseline.manifest.sourceCommit,seed:oldBaseline.manifest.seed},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{fixture:evidence.specs[beat.run].fixture,offset:beat.offset,probe:candidate[beat.id].probe}])),
    thresholds:{referenceEdgeFloor:refEdge,referenceRichFloor:refRich,
      actorScale:{standard:{maxWidth:20,maxHeight:32},barrow:{maxWidth:24,maxHeight:24},
        approachVisibilityFraction:.55,maxFootprintFraction:.20,extentThreshold:ACTOR_THRESHOLD},bands},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,
      scaleContract:scaleContract.measurements,scaleCoverage,approach,footprintSamples,
      gardenerBurst,plantBurst,zombieBurst,earlyLater,warningContrast,saveDelta,saveBurst,apexDelta,apexBurst},
    gates,automatedOk:gates.slice(0,-1).every(value=>value.ok),semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
  };
  writeJson(METRICS_PATH,report);

  console.log(`GRAVE GARDEN visual evidence · seed 0x${SEED.toString(16)}`);
  for(const value of gates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log('  contact:',CONTACT_PATH);
  console.log('  tracked contact:',TRACKED_CONTACT_PATH);
  console.log('  montage sha256:',sheet.sha256);
  console.log('  metrics:',METRICS_PATH);
  console.log('  review template:',REVIEW_TEMPLATE_PATH);
  if(!gates.every(value=>value.ok)){
    console.error('\nGRAVE GARDEN VISUAL EVAL FAILED');
    process.exit(1);
  }
  console.log('\nGRAVE GARDEN VISUAL EVAL PASSED');
}

main().catch(error=>{console.error('GRAVE GARDEN VISUAL EVAL FAILED:',error.stack||error);process.exit(1);});
