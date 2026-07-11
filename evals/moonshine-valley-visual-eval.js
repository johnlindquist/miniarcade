#!/usr/bin/env node
'use strict';

// MOONSHINE VALLEY real-pixel release gate. The game supplies deterministic
// visual fixtures and probe geometry; every quality metric below is computed
// from the actual native 160x360 RGBA produced by the shipping renderer.
const fs=require('fs');
const path=require('path');
const{bootRenderedGame,rgbaFrame,encodeRgbaPng}=require('../render/runtime');
const{
  sha256,toNativeFrame,analyzeFrame,frameDifference,structureDistance,analyzeBurst,
  measureDrawnActorExtent,assertActorScale,writeContactSheet,verifyReviewReceipt,
  writeJson,quantile
}=require('./visual-harness');

const ROOT=path.join(__dirname,'..');
const GAME_PATH=path.join(__dirname,'..','moonshine-valley.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','moonshine-valley');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const TRACKED_CONTACT_PATH=path.join(__dirname,'visual-receipts','moonshine-valley-contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','moonshine-valley.json');
const SEED=0x4d565931;
const WORLD_CROP={x:0,y:42,width:160,height:292};
const REFERENCE_TARGETS=[60,600,1200,2400,3600,5400,7200,9000,12000];
const RENDER_EVERY=2,PRE_ROLL=120,ACTOR_PADDING=8,ACTOR_THRESHOLD=8;
const median=values=>quantile(values,.5);

if(!fs.existsSync(GAME_PATH)){
  console.error('MOONSHINE VALLEY VISUAL EVAL FAILED: missing '+GAME_PATH);
  process.exit(1);
}

function visualProbe(runtime){
  const fn=runtime.sandbox.__moonshineValleyVisualProbe;
  if(typeof fn!=='function')throw new Error('moonshine-valley.html must expose __moonshineValleyVisualProbe()');
  const value=fn();
  if(!value||value.finite===false)throw new Error('Moonshine Valley visual fixture produced non-finite state');
  return value;
}

function captureFixture(name,offsets,options){
  options=options||{};
  const runtime=bootRenderedGame('moonshine-valley',{seed:SEED});
  if(options.beforeSet)options.beforeSet(runtime);
  const setBeat=runtime.sandbox.__moonshineValleySetVisualBeat;
  if(typeof setBeat!=='function')throw new Error('moonshine-valley.html must expose __moonshineValleySetVisualBeat(name)');
  if(setBeat(name)!==true)throw new Error('unknown Moonshine Valley visual beat: '+name);
  if(options.actorSelector!==undefined)runtime.sandbox.__MV_VISUAL_ONLY_ACTOR=options.actorSelector;
  if(options.afterSet)options.afterSet(runtime);
  const frames=new Map();
  for(const target of[...new Set(offsets)].sort((a,b)=>a-b)){
    runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});
    const frame=runtime.snapshot({native:true});
    frame.probe=visualProbe(runtime);
    frame.fixture=options.id||name;
    frame.offset=target;
    frames.set(target,frame);
  }
  return frames;
}

function captureTimeline(gameName,seed,targets){
  const runtime=bootRenderedGame(gameName,{seed}),frames=new Map();
  for(const target of targets){
    if(target-runtime.frame>PRE_ROLL)runtime.advanceTo(target-PRE_ROLL);
    runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});
    frames.set(target,runtime.snapshot({native:true}));
  }
  return frames;
}

function fixedCrop(frame,box,size){
  size=size||36;
  const source=toNativeFrame(frame),cx=Math.round(box.x+box.width/2),cy=Math.round(box.y+box.height/2);
  const rgba=Buffer.alloc(size*size*4),left=cx-Math.floor(size/2),top=cy-Math.floor(size/2);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const sx=left+x,sy=top+y,dst=(y*size+x)*4;
    if(sx<0||sy<0||sx>=source.width||sy>=source.height){rgba[dst+3]=255;continue;}
    const src=(sy*source.width+sx)*4;
    rgba[dst]=source.rgba[src];rgba[dst+1]=source.rgba[src+1];
    rgba[dst+2]=source.rgba[src+2];rgba[dst+3]=source.rgba[src+3];
  }
  return rgbaFrame(rgba,size,size,{frame:frame.frame,fixture:frame.fixture,offset:frame.offset});
}

function actorBox(frame,id){
  const actors=frame.probe&&frame.probe.actors;
  const actor=Array.isArray(actors)&&actors.find(value=>value.id===id);
  return actor&&actor.box;
}

function alignedBurst(frames,boxSource,size){
  const crops=[];
  for(const frame of frames){
    const box=typeof boxSource==='function'?boxSource(frame):frame.probe&&frame.probe[boxSource];
    if(!box||!(box.width>0&&box.height>0))return null;
    crops.push(fixedCrop(frame,box,size));
  }
  const differences=[];
  for(let i=1;i<crops.length;i++)differences.push(frameDifference(crops[i-1],crops[i],{native:false}));
  const values=differences.map(value=>value.changedFraction);
  return{
    frames:crops.length,cropSize:size,differences,
    changedFraction:{min:Math.min(...values),median:median(values),max:Math.max(...values)},
    firstLast:frameDifference(crops[0],crops.at(-1),{native:false})
  };
}

function probeActors(probe,fixture){
  if(!probe||!Array.isArray(probe.actors)||!probe.actors.length)
    throw new Error(fixture+': visual probe must expose a non-empty actors[]');
  const ids=new Set();
  for(const actor of probe.actors){
    if(!actor||typeof actor.id!=='string'||!actor.id||typeof actor.kind!=='string'||!actor.kind)
      throw new Error(fixture+': every actor needs a string id and kind');
    if(ids.has(actor.id))throw new Error(fixture+': duplicate actor id '+actor.id);
    ids.add(actor.id);
    const box=actor.box;
    if(!box||![box.x,box.y,box.width,box.height].every(Number.isFinite)||!(box.width>0&&box.height>0))
      throw new Error(fixture+': actor '+actor.id+' has an invalid probe box');
  }
  return probe.actors;
}

function actorLimits(actor){
  if(actor.kind==='structure')return{maxWidth:24,maxHeight:24};
  if(actor.kind==='farmer'||actor.kind==='crop'||actor.kind==='creature')return{maxWidth:20,maxHeight:32};
  throw new Error('unclassified Moonshine Valley actor kind: '+actor.kind);
}

function validMeasurement(value){
  return!!value&&!!value.bounds&&value.drawnPixels>=1&&!value.clipped&&
    !(value.probeOverflow&&value.probeOverflow.any);
}

function measureFixtureActors(fixture,offset,probe,onlyIds){
  const actors=probeActors(probe,fixture).filter(actor=>!onlyIds||onlyIds.has(actor.id));
  const baseline=captureFixture(fixture,[offset],{id:fixture+'-clean-plate',actorSelector:'none'}).get(offset);
  const measurements=[];
  for(const actor of actors){
    const isolated=captureFixture(fixture,[offset],{id:fixture+'-'+actor.id,actorSelector:actor.id}).get(offset);
    const measurement=measureDrawnActorExtent(isolated,baseline,{
      id:actor.id,kind:actor.kind,type:actor.type||null,probeBox:actor.box,
      padding:ACTOR_PADDING,threshold:ACTOR_THRESHOLD
    });
    const limits=Object.assign({label:actor.kind+' '+(actor.type||actor.id)},actorLimits(actor));
    const assertion=assertActorScale(measurement,limits);
    measurements.push(Object.assign(measurement,{fixture,
      assertion:{ok:assertion.ok,failures:assertion.failures,limits:assertion.limits}}));
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

function summarizeFootprint(label,actorSet,layout){
  const playfield=layout&&layout.playfield;
  const validPlayfield=!!playfield&&[playfield.x,playfield.y,playfield.width,playfield.height].every(Number.isFinite)&&
    playfield.x===WORLD_CROP.x&&playfield.y===WORLD_CROP.y&&
    playfield.width===WORLD_CROP.width&&playfield.height===WORLD_CROP.height;
  if(!validPlayfield)return{label,ok:false,errors:['probe playfield must match the 160x292 world crop'],playfield};
  const visible=actorSet.measurements.map(value=>intersectBounds(value.bounds,playfield)).filter(Boolean);
  const sumBboxArea=visible.reduce((sum,box)=>sum+box.width*box.height,0);
  const area=playfield.width*playfield.height,sumFraction=sumBboxArea/area;
  const invalid=actorSet.measurements.flatMap(value=>{
    const errors=[];
    if(!validMeasurement(value))errors.push(value.id+': rendered extent is missing, clipped, or outside its probe box');
    return errors.concat(value.assertion.failures);
  });
  if(sumFraction>.20)invalid.push(label+': summed actor footprint '+sumFraction.toFixed(4)+' > 0.20');
  return{
    label,ok:invalid.length===0,errors:invalid,playfield,actors:actorSet.measurements.length,
    sumBboxArea,sumFraction:+sumFraction.toFixed(6),measurements:actorSet.measurements
  };
}

function measureApproaches(layout){
  const approaches=layout&&layout.approaches;
  if(!Array.isArray(approaches))return[];
  return approaches.map(value=>{
    const visibleSpawn=value.visibleSpawn,contact=value.contact,goal=value.goal;
    const reported=value.approachVisibilityFraction;
    const denominator=Math.abs(goal-visibleSpawn),measured=denominator?Math.abs(contact-visibleSpawn)/denominator:NaN;
    const finite=[visibleSpawn,contact,goal,reported,measured].every(Number.isFinite);
    const matches=finite&&Math.abs(measured-reported)<=1e-6;
    return Object.assign({},value,{
      reported,measured:Number.isFinite(measured)?+measured.toFixed(6):null,matches,
      ok:finite&&measured>=.55&&reported>=.55&&measured<=1&&matches
    });
  });
}

function gameEvidence(){
  const specs={
    opening:{fixture:'opening',offsets:[12]},
    growth:{fixture:'growth',offsets:[1,4,8,12,20,28]},
    harvest:{fixture:'harvest',offsets:[1,4,8,12,20,28]},
    warning:{fixture:'warning',offsets:[12]},
    night:{fixture:'night',offsets:[1,4,8,12,20,28]},
    danger:{fixture:'danger',offsets:[12]},
    dawn:{fixture:'dawn',offsets:[1,6,12,24,48]},
    later:{fixture:'later',offsets:[12]},
    apex:{fixture:'apex',offsets:[1,6,12,24,48]}
  };
  const runs={};
  for(const[id,spec]of Object.entries(specs))runs[id]=captureFixture(spec.fixture,spec.offsets,{id});
  const beats=[
    {id:'opening',label:'opening farm',run:'opening',offset:12},
    {id:'growth',label:'crop growth',run:'growth',offset:12},
    {id:'harvest',label:'harvest',run:'harvest',offset:12},
    {id:'warning',label:'dusk warning',run:'warning',offset:12},
    {id:'night',label:'moonlit defense',run:'night',offset:12},
    {id:'danger',label:'west row danger',run:'danger',offset:12},
    {id:'dawn',label:'dawn survival',run:'dawn',offset:12},
    {id:'later',label:'cider autumn',run:'later',offset:12},
    {id:'apex',label:'frost moon apex',run:'apex',offset:12}
  ];
  const frames=Object.fromEntries(beats.map(beat=>[beat.id,runs[beat.run].get(beat.offset)]));
  const all=[];
  for(const[id,frameMap]of Object.entries(runs))for(const[offset,frame]of frameMap)all.push({id,offset,frame});
  return{specs,runs,beats,frames,all};
}

function reviewTemplate(montageSha256,gameSha256,beats,specs){
  const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});
  return{
    schema:1,game:'moonshine-valley',verdict:'pending',references:['horizon','blockmine'],
    montageSha256,gameSha256,seed:'0x'+SEED.toString(16),
    checkpoints:beats.map(beat=>specs[beat.run].fixture+'@'+beat.offset),
    reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size reference review',
    categories:{
      characterCraft:pending('Inspect the tiny farmer across walk, water, harvest, carry, sling, and hammer poses; four crop stages; and mireling, moth, and boar silhouettes at 160x360.'),
      environmentCraft:pending('Inspect the built valley, farmhouse, barn, windmill, well, workshop, tilled beds, fence, layered mountains, seasonal landmarks, sky, and foreground material separation with the HUD mentally hidden.'),
      levelVariety:pending('Confirm spring opening, summer night, autumn harvest, and frost-moon apex change landmark silhouettes, crop state, fortification, lighting, and spatial composition rather than palette alone.'),
      animationImpact:pending('Confirm farmer gait and task poses, crop sway, creature locomotion, moonlamp pulse/fire, dusk anticipation, harvest particles, dawn hold, and frost-moon payoff have readable anticipation and follow-through.'),
      readability:pending('Confirm the small actors, full-field threat runway, target route, crop rows, dusk warning, danger banner, ward line, objective, and day clock remain legible beside video.'),
      artDirectionCohesion:pending('Confirm the moonlit folk-farm shapes, seasonal palette, crop and creature language, structures, HUD, warnings, and payoff effects feel authored as one world.')
    }
  };
}

async function main(){
  fs.mkdirSync(FRAME_DIR,{recursive:true});
  for(const file of fs.readdirSync(FRAME_DIR))if(file.endsWith('.png'))fs.unlinkSync(path.join(FRAME_DIR,file));

  const evidence=gameEvidence(),repeat=gameEvidence();
  const determinism=evidence.all.map(value=>{
    const other=repeat.runs[value.id].get(value.offset),a=sha256(value.frame.rgba),b=sha256(other.rgba);
    return{fixture:value.id,offset:value.offset,a,b,ok:a===b};
  });
  const{beats,frames:candidate}=evidence;

  const horizon=captureTimeline('horizon',0xa1020401,REFERENCE_TARGETS);
  const blockmine=captureTimeline('blockmine',0xb10c0050,REFERENCE_TARGETS);
  const horizonByBeat={},blockmineByBeat={};
  beats.forEach((beat,index)=>{
    horizonByBeat[beat.id]=horizon.get(REFERENCE_TARGETS[index]);
    blockmineByBeat[beat.id]=blockmine.get(REFERENCE_TARGETS[index]);
    fs.writeFileSync(path.join(FRAME_DIR,String(index+1).padStart(2,'0')+'-'+beat.id+'.png'),
      encodeRgbaPng(candidate[beat.id]));
  });
  const sheet=writeContactSheet({
    beats:beats.map(beat=>({id:beat.id,label:beat.label})),
    rows:[
      {label:'MOONSHINE VALLEY',frames:candidate},
      {label:'MACHINE HUNT',frames:horizonByBeat},
      {label:'BLOCK MINE',frames:blockmineByBeat}
    ],outPath:CONTACT_PATH
  });
  fs.mkdirSync(path.dirname(TRACKED_CONTACT_PATH),{recursive:true});

  const candidateMetrics=Object.fromEntries(beats.map(beat=>[
    beat.id,analyzeFrame(candidate[beat.id],{native:false,crop:WORLD_CROP})
  ]));
  const horizonMetrics=beats.map(beat=>analyzeFrame(horizonByBeat[beat.id],{native:false,crop:WORLD_CROP}));
  const blockmineMetrics=beats.map(beat=>analyzeFrame(blockmineByBeat[beat.id],{native:false,crop:WORLD_CROP}));
  const cm=Object.values(candidateMetrics);
  const refEdge=Math.min(median(horizonMetrics.map(value=>value.edge[1].energy)),
    median(blockmineMetrics.map(value=>value.edge[1].energy)));
  const refRich=Math.min(median(horizonMetrics.map(value=>value.richCellFraction)),
    median(blockmineMetrics.map(value=>value.richCellFraction)));

  const scaleFrame=captureFixture('scale-contract',[12],{id:'scale-contract'}).get(12);
  const scaleContract=measureFixtureActors('scale-contract',12,scaleFrame.probe);
  const apexScale=measureFixtureActors('apex',12,candidate.apex.probe,new Set(['farmer']));
  const scaleMeasurements=[...scaleContract.measurements,...apexScale.measurements];
  const scaleKinds=new Map();
  for(const actor of scaleContract.actors){
    const values=scaleKinds.get(actor.kind)||new Set();values.add(actor.type||actor.id);scaleKinds.set(actor.kind,values);
  }
  const scaleCoverage={
    farmer:(scaleKinds.get('farmer')||new Set()).size>=1,
    crops:['stage-1','stage-2','stage-3','stage-4'].every(type=>(scaleKinds.get('crop')||new Set()).has(type)),
    creatures:['mireling','moth','boar'].every(type=>(scaleKinds.get('creature')||new Set()).has(type)),
    structure:(scaleKinds.get('structure')||new Set()).has('moonlamp'),
    celebration:apexScale.actors.some(actor=>actor.id==='farmer'&&actor.type==='celebrate')
  };
  const footprints={};
  for(const id of['opening','night','later']){
    const beat=beats.find(value=>value.id===id),frame=candidate[id];
    footprints[id]=summarizeFootprint(id,
      measureFixtureActors(evidence.specs[beat.run].fixture,beat.offset,frame.probe),frame.probe.layout);
  }
  const approaches=measureApproaches(scaleFrame.probe&&scaleFrame.probe.layout);

  const actorBursts={
    farmer:alignedBurst([...captureFixture('growth',[1,4,8,12,20,28],{actorSelector:'farmer'}).values()],
      frame=>actorBox(frame,'farmer'),34),
    crop:alignedBurst([...captureFixture('growth',[1,4,8,12,20,28],{actorSelector:'crop:2'}).values()],
      frame=>actorBox(frame,'crop:2'),28),
    creature:alignedBurst([...captureFixture('night',[1,4,8,12,20,28],{actorSelector:'enemy:0'}).values()],
      frame=>actorBox(frame,'enemy:0'),30),
    moonlamp:alignedBurst([...captureFixture('night',[1,4,8,12,20,28],{actorSelector:'ward:0'}).values()],
      frame=>actorBox(frame,'ward:0'),32)
  };

  const environments={
    opening:captureFixture('opening',[12],{actorSelector:'none'}).get(12),
    night:captureFixture('night',[12],{actorSelector:'none'}).get(12),
    dawn:captureFixture('dawn',[12],{actorSelector:'none',beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}}).get(12),
    later:captureFixture('later',[12],{actorSelector:'none'}).get(12)
  };
  const environmentPairs={};
  for(const[a,b]of[['opening','night'],['opening','later'],['night','dawn'],['night','later'],['dawn','later']])
    environmentPairs[a+'-'+b]=structureDistance(environments[a],environments[b],{crop:WORLD_CROP});

  const warningOn=captureFixture('warning',[12],{actorSelector:'none'}).get(12);
  const warningCalm=captureFixture('warning',[12],{actorSelector:'none',
    afterSet:runtime=>runtime.evaluate("actPhase='day';banner.t=0;")}).get(12);
  const warningDelta=frameDifference(warningCalm,warningOn,{native:false,crop:WORLD_CROP});

  const harvestNoFx=captureFixture('harvest',[20],{
    beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}
  }).get(20);
  const apexNoFx=captureFixture('apex',[12],{
    beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}
  }).get(12);
  const harvestDelta=frameDifference(harvestNoFx,evidence.runs.harvest.get(20),{native:false,crop:WORLD_CROP});
  const apexDelta=frameDifference(apexNoFx,candidate.apex,{native:false,crop:WORLD_CROP});
  const harvestBurst=analyzeBurst([1,4,8,12,20,28].map(offset=>evidence.runs.harvest.get(offset)),
    {native:false,crop:WORLD_CROP});
  const apexBurst=analyzeBurst([1,6,12,24,48].map(offset=>evidence.runs.apex.get(offset)),
    {native:false,crop:WORLD_CROP});

  // Locked from the fixed-seed native captures above after the authored-world
  // pass. The nine cells measured 170..225 quantized colors, 3.855..5.024
  // entropy, .073..150 luma deviation, .0121..0313 one-pixel edge energy,
  // .756..1.0 rich cells, and .311..410 pairwise environment structure
  // distance. Aligned animation peaks measured .446 farmer, .075 crop, .371
  // creature, and .055 moonlamp. Isolated payoff deltas measured .0020 harvest
  // and .0034 apex, while follow-through peaked at .019 and .032. Floors retain
  // roughly 10-20% regression margin. Semantic art quality remains independently
  // bound to the hashed native-size reference review receipt.
  const bands={
    colors:150,entropy:3.45,luma:.065,largest:.45,edge:.0108,richEach:.68,richMedian:.76,
    environmentPair:.27,warningChanged:.85,warningMean:.05,warningGrid:.90,
    farmerAnim:.38,cropAnim:.06,creatureAnim:.31,moonlampAnim:.045,
    harvestFx:.0017,harvestFxGrid:.02,harvestAnim:.016,harvestAnimGrid:.13,
    apexFx:.003,apexFxGrid:.04,apexAnim:.027,apexAnimGrid:.24
  };

  const automatedGates=[],gate=(name,ok,detail)=>automatedGates.push({name,ok:!!ok,detail});
  gate('same-seed real pixels are deterministic',determinism.every(value=>value.ok),determinism);
  gate('all nine native checkpoints are finite and fixture-identified',beats.every(beat=>{
    const frame=candidate[beat.id],probe=frame.probe;
    return frame.width===160&&frame.height===360&&probe&&probe.finite&&
      probe.fixture===evidence.specs[beat.run].fixture;
  }),beats.map(beat=>({id:beat.id,probe:candidate[beat.id].probe})));
  gate('scale contract covers farmer, four crop stages, three creatures, and moonlamp',
    Object.values(scaleCoverage).every(Boolean),{
      coverage:scaleCoverage,kinds:Object.fromEntries([...scaleKinds].map(([kind,types])=>[kind,[...types]]))
    });
  gate('isolated actor pixels are present, unclipped, and probe-contained',
    scaleMeasurements.every(validMeasurement),scaleMeasurements);
  gate('farmer, crops, creatures, and structures obey 20x32 / 24x24 drawn-pixel caps',
    scaleMeasurements.every(value=>value.assertion.ok),scaleMeasurements);
  gate('opening, night, and later actor footprints stay within 20% of the world',
    Object.values(footprints).every(value=>value.ok),footprints);
  gate('every reported threat runway is measured, truthful, and at least 55%',
    approaches.length>0&&approaches.every(value=>value.ok),approaches);
  gate('frames are opaque, contrasted, and non-flat',cm.every(value=>
    value.opaqueFraction===1&&value.quantizedColors>=bands.colors&&value.colorEntropy>=bands.entropy&&
    value.lumaStdDev>=bands.luma&&value.largestColorShare<=bands.largest),
  cm.map(value=>({colors:value.quantizedColors,entropy:value.colorEntropy,luma:value.lumaStdDev,largest:value.largestColorShare})));
  gate('multiscale farm detail is reference-comparable',cm.every(value=>
    value.edge[1].energy>=bands.edge&&value.edge[4].energy>value.edge[1].energy)&&
    median(cm.map(value=>value.edge[1].energy))>=refEdge*.82,
  {candidate:cm.map(value=>value.edge),candidateMedian:median(cm.map(value=>value.edge[1].energy)),referenceFloor:refEdge});
  gate('spatial richness fills the native strip',cm.every(value=>value.richCellFraction>=bands.richEach)&&
    median(cm.map(value=>value.richCellFraction))>=Math.max(bands.richMedian,refRich*.85),
  {candidate:cm.map(value=>value.richCellFraction),candidateMedian:median(cm.map(value=>value.richCellFraction)),referenceFloor:refRich});
  gate('spring, summer night, dawn, and autumn environments change structure',
    Object.values(environmentPairs).every(value=>value.structureDistance>=bands.environmentPair),environmentPairs);
  gate('dusk warning changes the battlefield before night lands',warningOn.probe.actPhase==='warn'&&
    warningCalm.probe.actPhase==='day'&&warningDelta.changedFraction>=bands.warningChanged&&
    warningDelta.meanDelta>=bands.warningMean&&warningDelta.changedGridFraction>=bands.warningGrid,warningDelta);
  gate('farmer, crop, creature, and moonlamp have aligned temporal animation',
    actorBursts.farmer&&actorBursts.crop&&actorBursts.creature&&actorBursts.moonlamp&&
    actorBursts.farmer.changedFraction.max>=bands.farmerAnim&&
    actorBursts.crop.changedFraction.max>=bands.cropAnim&&
    actorBursts.creature.changedFraction.max>=bands.creatureAnim&&
    actorBursts.moonlamp.changedFraction.max>=bands.moonlampAnim,actorBursts);
  gate('harvest has authored payoff pixels and follow-through',harvestDelta.changedFraction>=bands.harvestFx&&
    harvestDelta.changedGridFraction>=bands.harvestFxGrid&&harvestBurst.changedFraction.max>=bands.harvestAnim&&
    harvestBurst.changedGridFraction.max>=bands.harvestAnimGrid,{harvestDelta,harvestBurst});
  gate('frost-moon apex has broad payoff pixels and motion',apexDelta.changedFraction>=bands.apexFx&&
    apexDelta.changedGridFraction>=bands.apexFxGrid&&apexBurst.changedFraction.max>=bands.apexAnim&&
    apexBurst.changedGridFraction.max>=bands.apexAnimGrid,{apexDelta,apexBurst});
  const automatedOk=automatedGates.every(value=>value.ok);

  const gameSha256=sha256(GAME_PATH);
  const checkpointIdentity=beats.map(beat=>evidence.specs[beat.run].fixture+'@'+beat.offset);
  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256,gameSha256,beats,evidence.specs));
  let review;
  if(fs.existsSync(REVIEW_PATH)){
    review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256,preservedPath:TRACKED_CONTACT_PATH});
    const receipt=review.receipt||{};
    if(receipt.game!=='moonshine-valley'||receipt.gameSha256!==gameSha256||
      receipt.seed!=='0x'+SEED.toString(16)||JSON.stringify(receipt.checkpoints)!==JSON.stringify(checkpointIdentity)){
      review.ok=false;review.errors.push('review identity, game hash, seed, or checkpoints are stale');
    }
  }else review={ok:false,errors:[
    'missing semantic review '+REVIEW_PATH,
    'inspect '+CONTACT_PATH+' and complete '+REVIEW_TEMPLATE_PATH
  ]};
  const semanticGate={name:'fresh native-size semantic comparison receipt',ok:review.ok,detail:review.errors};
  const gates=[...automatedGates,semanticGate];

  const report={
    schema:1,game:'moonshine-valley',gameSha256,seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,
    contactSheet:{path:CONTACT_PATH,trackedPath:TRACKED_CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{
      fixture:evidence.specs[beat.run].fixture,offset:beat.offset,probe:candidate[beat.id].probe
    }])),
    thresholds:{actorScale:{standard:{maxWidth:20,maxHeight:32},structure:{maxWidth:24,maxHeight:24},
      runway:.55,footprint:.20,extentThreshold:ACTOR_THRESHOLD},bands,referenceEdge:refEdge,referenceRich:refRich},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,
      scaleContract:scaleMeasurements,scaleCoverage,footprints,approaches,actorBursts,
      environmentPairs,warningDelta,payoffOffsets:{harvest:20,apex:12},
      harvestDelta,harvestBurst,apexDelta,apexBurst},
    gates,automatedOk,semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
  };
  writeJson(METRICS_PATH,report);

  console.log('MOONSHINE VALLEY visual evidence · seed 0x'+SEED.toString(16));
  for(const value of automatedGates)console.log('  '+(value.ok?'PASS':'FAIL')+' '+value.name);
  console.log('  '+(review.ok?'PASS':'PENDING')+' '+semanticGate.name);
  console.log('  contact:',CONTACT_PATH);
  console.log('  tracked contact:',TRACKED_CONTACT_PATH);
  console.log('  montage sha256:',sheet.sha256);
  console.log('  metrics:',METRICS_PATH);
  console.log('  review template:',REVIEW_TEMPLATE_PATH);
  if(!automatedOk){console.error('\nMOONSHINE VALLEY AUTOMATED VISUAL GATES FAILED');process.exit(1);}
  if(!review.ok){console.error('\nMOONSHINE VALLEY AUTOMATED VISUAL GATES PASSED; SEMANTIC REVIEW PENDING');process.exit(1);}
  console.log('\nMOONSHINE VALLEY VISUAL EVAL PASSED');
}

main().catch(error=>{
  console.error('MOONSHINE VALLEY VISUAL EVAL FAILED:',error.stack||error);
  process.exit(1);
});
