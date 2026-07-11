#!/usr/bin/env node
'use strict';

// GHOST SHIFT real-pixel release gate. Behavioral truth remains in
// ghost-shift-eval.js. This suite renders deterministic authored fixtures from
// the actual canvas, measures the native 160x360 pixels, and records a hashed
// reference review for the judgments pixel statistics cannot make.
const fs=require('fs');
const path=require('path');
const{
  bootRenderedGame,rgbaFrame,encodeRgbaPng
}=require('../render/runtime');
const{
  sha256,toNativeFrame,analyzeFrame,frameDifference,measureDrawnActorExtent,assertActorScale,structureDistance,analyzeBurst,
  writeContactSheet,verifyReviewReceipt,writeJson,quantile
}=require('./visual-harness');

const ROOT=path.join(__dirname,'..');
const GAME_PATH=path.join(__dirname,'..','ghost-shift.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','ghost-shift');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','ghost-shift.json');
const PRESERVED_CONTACT_PATH=path.join(__dirname,'visual-receipts','ghost-shift-contact-sheet.png');
const SEED=0x47534854,PRE_ROLL=120,RENDER_EVERY=2;
const WORLD_CROP={x:0,y:46,width:160,height:276};

if(!fs.existsSync(GAME_PATH)){
  console.error('GHOST SHIFT VISUAL EVAL FAILED: missing '+GAME_PATH);
  process.exit(1);
}

const median=values=>quantile(values,.5);

function visualProbe(runtime){
  const fn=runtime.sandbox.__ghostShiftVisualProbe;
  if(typeof fn!=='function')throw new Error('ghost-shift.html must expose __ghostShiftVisualProbe()');
  const value=fn();
  if(!value||value.finite===false)throw new Error('ghost-shift visual fixture produced non-finite state');
  return value;
}

function captureFixture(name,offsets,options){
  options=options||{};
  const runtime=bootRenderedGame('ghost-shift',{seed:SEED,footer:options.footer||''});
  const setBeat=runtime.sandbox.__ghostShiftSetVisualBeat;
  if(typeof setBeat!=='function')throw new Error('ghost-shift.html must expose __ghostShiftSetVisualBeat(name)');
  if(setBeat(name)!==true)throw new Error('unknown Ghost Shift visual beat: '+name);
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
  size=size||44;
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

function subjectContrast(frame,box,pad){
  if(!box)return null;
  const source=toNativeFrame(frame),p=pad||4;
  const inner={x:Math.floor(box.x),y:Math.floor(box.y),r:Math.ceil(box.x+box.width),b:Math.ceil(box.y+box.height)};
  const outer={x:inner.x-p,y:inner.y-p,r:inner.r+p,b:inner.b+p};
  const sums={inner:[0,0,0,0],outer:[0,0,0,0]};
  for(let y=Math.max(0,outer.y);y<Math.min(source.height,outer.b);y++)for(let x=Math.max(0,outer.x);x<Math.min(source.width,outer.r);x++){
    const inBox=x>=inner.x&&x<inner.r&&y>=inner.y&&y<inner.b,key=inBox?'inner':'outer',i=(y*source.width+x)*4;
    sums[key][0]+=source.rgba[i];sums[key][1]+=source.rgba[i+1];sums[key][2]+=source.rgba[i+2];sums[key][3]++;
  }
  if(!sums.inner[3]||!sums.outer[3])return null;
  const mean=key=>sums[key].slice(0,3).map(value=>value/sums[key][3]),a=mean('inner'),b=mean('outer');
  const luma=v=>(.2126*v[0]+.7152*v[1]+.0722*v[2])/255;
  return{
    lumaContrast:+Math.abs(luma(a)-luma(b)).toFixed(6),
    rgbContrast:+(Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])/(255*Math.sqrt(3))).toFixed(6),
    innerRgb:a.map(value=>+value.toFixed(3)),outerRgb:b.map(value=>+value.toFixed(3))
  };
}

function alignedDifference(a,b,boxField,size){
  const boxA=a.probe&&a.probe[boxField],boxB=b.probe&&b.probe[boxField];
  if(!boxA||!boxB)return null;
  return frameDifference(fixedCrop(a,boxA,size),fixedCrop(b,boxB,size),{native:false});
}

function analyzeAlignedBurst(frames,boxField,size){
  const crops=[];
  for(const frame of frames){
    const box=frame.probe&&frame.probe[boxField];
    if(!box||!(box.width>0&&box.height>0))return null;
    crops.push(fixedCrop(frame,box,size));
  }
  const differences=[];
  for(let i=1;i<crops.length;i++)differences.push(frameDifference(crops[i-1],crops[i],{native:false}));
  return{
    frames:crops.length,differences,
    changedFraction:{
      min:Math.min(...differences.map(value=>value.changedFraction)),
      median:median(differences.map(value=>value.changedFraction)),
      max:Math.max(...differences.map(value=>value.changedFraction))
    },
    firstLast:frameDifference(crops[0],crops.at(-1),{native:false})
  };
}

function buildCandidateEvidence(){
  const specs={
    opening:{fixture:'opening',offsets:[12]},
    patrol:{fixture:'patrol',offsets:[1,3,5,7,9,13]},
    chase:{fixture:'chase',offsets:[1,3,5,7,9,13]},
    sigilBefore:{fixture:'sigil-before',offsets:[6]},
    sigil:{fixture:'sigil',offsets:[1,3,6,12,24]},
    sigilSolve:{fixture:'sigil-solve',offsets:[1,3,6,12,24]},
    relayBefore:{fixture:'relay-before',offsets:[6]},
    relay:{fixture:'relay',offsets:[1,3,6,12,24]},
    relaySolve:{fixture:'relay-solve',offsets:[1,3,6,12,24]},
    pulse:{fixture:'pulse',offsets:[1,3,6,12,24]},
    lootBefore:{fixture:'loot-before',offsets:[6]},
    loot:{fixture:'loot',offsets:[1,3,6,12,24]},
    unlockBefore:{fixture:'unlock-before',offsets:[6]},
    unlock:{fixture:'unlock',offsets:[1,3,6,12,24]},
    nearMiss:{fixture:'near-miss',offsets:[1,3,6,12,24]},
    later:{fixture:'later',offsets:[1,6,12,18,24,32]},
    deep:{fixture:'deep',offsets:[1,6,12,18,24,32]},
    warningCalm:{fixture:'warning-calm',offsets:[12]},
    warning:{fixture:'warning',offsets:[12]},
    lockdown:{fixture:'lockdown',offsets:[1,3,6,12,24]},
    deliveryBefore:{fixture:'delivery-before',offsets:[6]},
    delivery:{fixture:'delivery',offsets:[1,3,6,12,24,48]}
  };
  const runs={};
  for(const[id,spec]of Object.entries(specs))runs[id]=captureFixture(spec.fixture,spec.offsets,{id});
  const beats=[
    {id:'opening',label:'opening',run:'opening',offset:12},
    {id:'patrol',label:'patrol',run:'patrol',offset:9},
    {id:'chase',label:'spotted',run:'chase',offset:9},
    {id:'sigilBefore',label:'rune setup',run:'sigilBefore',offset:6},
    {id:'sigil',label:'rune pressed',run:'sigil',offset:6},
    {id:'sigilSolve',label:'seal solved',run:'sigilSolve',offset:6},
    {id:'relayBefore',label:'relay setup',run:'relayBefore',offset:6},
    {id:'relaySolve',label:'grid solved',run:'relaySolve',offset:6},
    {id:'pulse',label:'phase pulse',run:'pulse',offset:6},
    {id:'later',label:'later shift',run:'later',offset:12},
    {id:'lockdown',label:'lockdown',run:'lockdown',offset:6},
    {id:'delivery',label:'delivery',run:'delivery',offset:6}
  ];
  const frames=Object.fromEntries(beats.map(beat=>[beat.id,runs[beat.run].get(beat.offset)]));
  const all=[];
  for(const[id,frameMap]of Object.entries(runs))for(const[offset,frame]of frameMap)all.push({id,offset,frame});
  return{specs,runs,beats,frames,all};
}

function reviewTemplate(montageSha256){
  const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});
  return{
    schema:1,game:'ghost-shift',verdict:'pending',references:['horizon','blockmine'],montageSha256,
    reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size reference review',
    categories:{
      characterCraft:pending('Inspect courier silhouette, room-reading scan, gait, pulse posture, bag carry, reactions, and patrol/cutoff/chase/stun sentry construction at 160x360.'),
      environmentCraft:pending('Inspect vault steel, open chambers, rune circuits, relay pedestals, laser gates, glass, pipes, vents, light pools, shadows, and motion with the HUD mentally removed.'),
      levelVariety:pending('Confirm rune, relay, and vault chambers have distinct purpose and composition and later shifts load different blueprints, landmarks, materials, and silhouettes.'),
      animationImpact:pending('Confirm scanning, rune pressure, seal opening, relay link, phase pulse, stun, narrow escape, lockdown, and delivery have anticipation, impact, and follow-through.'),
      readability:pending('Confirm the puzzle state, target interactable, courier, sentry modes, gates, and payoffs read at native size without any computed route or breadcrumb overlay.'),
      artDirectionCohesion:pending('Confirm actors, puzzle chambers, circuit language, surveillance lighting, HUD, and payoff grammar feel authored as one puzzle-heist world.')
    }
  };
}

async function main(){
  if(fs.existsSync(FRAME_DIR))for(const file of fs.readdirSync(FRAME_DIR))if(file.endsWith('.png'))fs.unlinkSync(path.join(FRAME_DIR,file));
  fs.mkdirSync(FRAME_DIR,{recursive:true});

  const evidence=buildCandidateEvidence(),repeat=buildCandidateEvidence(),
    plannerClean=captureFixture('patrol',[1],{id:'planner-clean'}).get(1),
    plannerDirty=captureFixture('patrol',[1],{id:'planner-dirty',afterSet:runtime=>runtime.sandbox.__ghostShiftPlannerContamination()}).get(1),
    plannerHashes={clean:sha256(plannerClean.rgba),contaminated:sha256(plannerDirty.rgba)},
    castFrame=captureFixture('patrol',[1],{id:'cast'}).get(1),
    courierPlate=captureFixture('patrol',[1],{id:'courier-plate',footer:'globalThis.__HIDE_COURIER=true;'}).get(1),
    dronePlate=captureFixture('patrol',[1],{id:'drone-plate',footer:'globalThis.__HIDE_DRONE_INDEX=0;'}).get(1),
    courierExtent=measureDrawnActorExtent(castFrame,courierPlate,{id:'courier',probeBox:castFrame.probe.courierBox,padding:10,threshold:10}),
    droneExtent=measureDrawnActorExtent(castFrame,dronePlate,{id:'drone',probeBox:castFrame.probe.droneBox,padding:10,threshold:10}),
    courierScale=assertActorScale(courierExtent,{label:'courier',maxWidth:20,maxHeight:32,allowProbeOverflow:true}),
    droneScale=assertActorScale(droneExtent,{label:'drone',maxWidth:20,maxHeight:32,allowProbeOverflow:true});
  const determinism=evidence.all.map(value=>{
    const other=repeat.runs[value.id].get(value.offset),a=sha256(value.frame.rgba),b=sha256(other.rgba);
    return{fixture:value.id,offset:value.offset,a,b,ok:a===b};
  });
  const deterministic=determinism.every(value=>value.ok);
  const{beats,frames:candidate}=evidence;

  const referenceTargets=[60,600,1200,2400,3600,5400,7200,9000,10800,12600,15000,18000];
  const horizon=captureTimeline('horizon',0xa1020401,referenceTargets);
  const blockmine=captureTimeline('blockmine',0xb10c0050,referenceTargets);
  const horizonByBeat={},blockmineByBeat={};
  beats.forEach((beat,index)=>{
    horizonByBeat[beat.id]=horizon.get(referenceTargets[index]);
    blockmineByBeat[beat.id]=blockmine.get(referenceTargets[index]);
    fs.writeFileSync(path.join(FRAME_DIR,`${String(index+1).padStart(2,'0')}-${beat.id}.png`),encodeRgbaPng(candidate[beat.id]));
  });
  const sheet=writeContactSheet({
    beats:beats.map(beat=>({id:beat.id,label:beat.label})),
    rows:[
      {label:'GHOST SHIFT',frames:candidate},
      {label:'MACHINE HUNT',frames:horizonByBeat},
      {label:'BLOCK MINE',frames:blockmineByBeat}
    ],outPath:CONTACT_PATH
  });

  const candidateMetrics=Object.fromEntries(beats.map(beat=>[beat.id,analyzeFrame(candidate[beat.id],{native:false,crop:WORLD_CROP})]));
  const horizonMetrics=beats.map(beat=>analyzeFrame(horizonByBeat[beat.id],{native:false,crop:WORLD_CROP}));
  const blockmineMetrics=beats.map(beat=>analyzeFrame(blockmineByBeat[beat.id],{native:false,crop:WORLD_CROP}));
  const cm=Object.values(candidateMetrics);
  const refEdge=Math.min(median(horizonMetrics.map(value=>value.edge[1].energy)),median(blockmineMetrics.map(value=>value.edge[1].energy)));
  const refRich=Math.min(median(horizonMetrics.map(value=>value.richCellFraction)),median(blockmineMetrics.map(value=>value.richCellFraction)));

  const courierWalk=analyzeAlignedBurst([1,3,5,7,9,13].map(offset=>evidence.runs.patrol.get(offset)),'courierBox');
  const patrolDrone=analyzeAlignedBurst([1,3,5,7,9,13].map(offset=>evidence.runs.patrol.get(offset)),'droneBox');
  const chaseDrone=analyzeAlignedBurst([1,3,5,7,9,13].map(offset=>evidence.runs.chase.get(offset)),'droneBox');
  const courierContrast=[candidate.opening,evidence.runs.patrol.get(9),evidence.runs.chase.get(9),candidate.later]
    .map(frame=>subjectContrast(frame,frame.probe&&frame.probe.courierBox));
  const droneContrast=[evidence.runs.patrol.get(9),evidence.runs.chase.get(9),candidate.later]
    .map(frame=>subjectContrast(frame,frame.probe&&frame.probe.droneBox));
  const loadPose=alignedDifference(candidate.opening,evidence.runs.lootBefore.get(6),'courierBox');
  const spottedPose=alignedDifference(evidence.runs.patrol.get(9),evidence.runs.chase.get(9),'courierBox');
  const patrolChase=alignedDifference(evidence.runs.patrol.get(9),evidence.runs.chase.get(9),'droneBox');
  const earlyLater=structureDistance(candidate.opening,candidate.later,{crop:WORLD_CROP});
  const laterDeep=structureDistance(candidate.later,evidence.runs.deep.get(12),{crop:WORLD_CROP});
  const warningContrast=frameDifference(evidence.runs.warningCalm.get(12),evidence.runs.warning.get(12),{native:false,crop:WORLD_CROP});
  const sigilPressure=frameDifference(evidence.runs.sigilBefore.get(6),evidence.runs.sigil.get(6),{native:false,crop:WORLD_CROP});
  const sigilSolve=frameDifference(evidence.runs.sigil.get(6),evidence.runs.sigilSolve.get(6),{native:false,crop:WORLD_CROP});
  const relayPressure=frameDifference(evidence.runs.relayBefore.get(6),evidence.runs.relay.get(6),{native:false,crop:WORLD_CROP});
  const relaySolve=frameDifference(evidence.runs.relay.get(6),evidence.runs.relaySolve.get(6),{native:false,crop:WORLD_CROP});
  const pulseBurst=analyzeBurst([1,3,6,12,24].map(offset=>evidence.runs.pulse.get(offset)),{native:false,crop:WORLD_CROP});
  const lootDelta=frameDifference(evidence.runs.lootBefore.get(6),evidence.runs.loot.get(6),{native:false,crop:WORLD_CROP});
  const unlockDelta=frameDifference(evidence.runs.unlockBefore.get(6),evidence.runs.unlock.get(6),{native:false,crop:WORLD_CROP});
  const nearMissBurst=analyzeBurst([1,3,6,12,24].map(offset=>evidence.runs.nearMiss.get(offset)),{native:false,crop:WORLD_CROP});
  const lockdownBurst=analyzeBurst([1,3,6,12,24].map(offset=>evidence.runs.lockdown.get(offset)),{native:false,crop:WORLD_CROP});
  const deliveryDelta=frameDifference(evidence.runs.deliveryBefore.get(6),candidate.delivery,{native:false,crop:WORLD_CROP});
  const deliveryBurst=analyzeBurst([1,3,6,12,24,48].map(offset=>evidence.runs.delivery.get(offset)),{native:false,crop:WORLD_CROP});

  // Fixed-seed calibration for the approved native candidate capture, with
  // roughly 10-20% regression margin: candidate minima were 118 colors,
  // 3.673 entropy, .157 luma deviation, .058 one-pixel edge energy, and 1.0
  // rich cells. Actor/pose, progression, and beat deltas are preserved in
  // metrics.json beside their executable floors.
  const bands={
    calibrated:true,
    colors:100,entropy:3.3,lumaStdDev:.14,largestColorShare:.255,edgeEnergy:.050,richEach:.88,richMedian:.92,
    courierWalkMax:.45,courierWalkFirstLast:.65,courierWalkGrid:.80,
    patrolDroneMax:.105,patrolDroneFirstLast:.17,chaseDroneMax:.20,chaseDroneFirstLast:.24,
    courierLocalContrast:.014,droneLocalContrast:.015,
    loadPose:.68,spottedPose:.08,patrolChase:.15,
    earlyLaterStructure:.16,earlyLaterEdge:.24,laterDeepStructure:.15,laterDeepEdge:.23,
    warningChanged:.68,warningMean:.032,warningGrid:.85,
    sigilPressureChanged:.015,sigilPressureMean:.004,sigilSolveChanged:.18,sigilSolveMean:.012,
    relayPressureChanged:.027,relayPressureMean:.005,relaySolveChanged:.18,relaySolveMean:.012,
    pulseChanged:.18,pulseGrid:.35,pulseStructure:.08,
    lootChanged:.80,lootMean:.075,lootGrid:.85,
    unlockChanged:.45,unlockMean:.09,unlockGrid:.85,
    nearMissChanged:.52,nearMissGrid:.85,nearMissStructure:.195,
    lockdownChanged:.82,lockdownGrid:.85,lockdownStructure:.35,
    deliveryChanged:.82,deliveryMean:.19,deliveryGrid:.85,deliveryBurstGrid:.85,deliveryStructure:.34
  };

  const gates=[];
  const gate=(name,ok,detail)=>gates.push({name,ok:!!ok,detail});
  gate('known-good thresholds are calibrated',bands.calibrated,bands);
  gate('same-seed real pixels deterministic',deterministic,determinism);
  gate('all requested fixtures are finite and truthful',beats.every(beat=>candidate[beat.id].probe&&candidate[beat.id].probe.finite!==false),
    beats.map(beat=>({beat:beat.id,probe:candidate[beat.id].probe})));
  const gameSource=fs.readFileSync(GAME_PATH,'utf8');
  gate('computed path is absent from renderer and HUD',!gameSource.includes('function drawRoute')&&!gameSource.includes('drawRoute()')&&!/fillText\(['"]ROUTE['"]/.test(gameSource),
    {drawRoute:gameSource.includes('drawRoute'),routeHud:/fillText\(['"]ROUTE['"]/.test(gameSource)});
  gate('mutating private future waypoints is an exact real-pixel no-op',plannerHashes.clean===plannerHashes.contaminated,plannerHashes);
  gate('drawn courier and drone obey the standard actor cap',courierScale.ok&&droneScale.ok,{courier:courierScale,drone:droneScale});
  gate('watched cast footprint stays below one fifth of the playfield',castFrame.probe.castFootprintFraction<.20,{footprint:castFrame.probe.castFootprintFraction});
  gate('puzzle fixtures expose setup pressure and solve truth',
    candidate.sigilBefore.probe.puzzle.activeSigils===0&&candidate.sigil.probe.puzzle.activeSigils===1&&candidate.sigilSolve.probe.puzzle.activeSigils===2&&candidate.sigilSolve.probe.puzzle.openGates===1&&
    candidate.relayBefore.probe.puzzle.activeRelays===0&&evidence.runs.relay.get(6).probe.puzzle.activeRelays===1&&candidate.relaySolve.probe.puzzle.activeRelays===2&&candidate.relaySolve.probe.puzzle.openGates===2,
    {sigilBefore:candidate.sigilBefore.probe.puzzle,sigil:candidate.sigil.probe.puzzle,sigilSolve:candidate.sigilSolve.probe.puzzle,relayBefore:candidate.relayBefore.probe.puzzle,relay:evidence.runs.relay.get(6).probe.puzzle,relaySolve:candidate.relaySolve.probe.puzzle});
  const puzzleFrames=[candidate.sigilBefore,candidate.sigil,candidate.sigilSolve,candidate.relayBefore,evidence.runs.relay.get(6),candidate.relaySolve];
  gate('puzzle evidence is not contaminated by the combat pulse',puzzleFrames.every(frame=>frame.probe.cue!=='pulse'&&!frame.probe.art.some(event=>event.kind==='pulse'))&&candidate.pulse.probe.cue==='pulse'&&candidate.pulse.probe.art.some(event=>event.kind==='pulse'),
    {puzzle:puzzleFrames.map(frame=>({fixture:frame.fixture,cue:frame.probe.cue,art:frame.probe.art})),explicitPulse:{cue:candidate.pulse.probe.cue,art:candidate.pulse.probe.art}});
  gate('frames are opaque and non-flat',cm.every(value=>value.opaqueFraction===1&&value.quantizedColors>=bands.colors&&value.colorEntropy>=bands.entropy&&value.lumaStdDev>=bands.lumaStdDev&&value.largestColorShare<=bands.largestColorShare),
    cm.map(value=>({colors:value.quantizedColors,entropy:value.colorEntropy,lumaStdDev:value.lumaStdDev,largest:value.largestColorShare})));
  gate('multiscale edge detail meets reference floor',cm.every(value=>value.edge[1].energy>=Math.max(bands.edgeEnergy,refEdge*.85)&&value.edge[4].energy>value.edge[1].energy),
    {candidate:cm.map(value=>value.edge),referenceFloor:refEdge});
  gate('spatial richness meets reference floor',cm.every(value=>value.richCellFraction>=bands.richEach)&&median(cm.map(value=>value.richCellFraction))>=Math.max(bands.richMedian,refRich*.90),
    {candidate:cm.map(value=>value.richCellFraction),candidateMedian:median(cm.map(value=>value.richCellFraction)),referenceFloor:refRich});
  gate('courier has aligned walk animation',!!courierWalk&&courierWalk.changedFraction.max>=bands.courierWalkMax&&courierWalk.firstLast.changedFraction>=bands.courierWalkFirstLast&&courierWalk.firstLast.changedGridFraction>=bands.courierWalkGrid&&courierWalk.changedFraction.max<=.80,courierWalk);
  gate('patrol drone has aligned mechanical motion',!!patrolDrone&&patrolDrone.changedFraction.max>=bands.patrolDroneMax&&patrolDrone.firstLast.changedFraction>=bands.patrolDroneFirstLast&&patrolDrone.changedFraction.max<=.78,patrolDrone);
  gate('chase drone has aligned alert animation',!!chaseDrone&&chaseDrone.changedFraction.max>=bands.chaseDroneMax&&chaseDrone.firstLast.changedFraction>=bands.chaseDroneFirstLast&&chaseDrone.changedFraction.max<=.78,chaseDrone);
  gate('courier and drones separate from their local backgrounds',courierContrast.every(value=>value&&Math.max(value.lumaContrast,value.rgbContrast)>=bands.courierLocalContrast)&&droneContrast.every(value=>value&&Math.max(value.lumaContrast,value.rgbContrast)>=bands.droneLocalContrast),
    {courier:courierContrast,drones:droneContrast});
  gate('carry, spotted, and patrol/chase silhouettes differ',!!loadPose&&!!spottedPose&&!!patrolChase&&loadPose.changedFraction>=bands.loadPose&&spottedPose.changedFraction>=bands.spottedPose&&patrolChase.changedFraction>=bands.patrolChase,
    {loadPose,spottedPose,patrolChase});
  gate('later shifts change architecture, not only palette',earlyLater.structureDistance>=bands.earlyLaterStructure&&earlyLater.edgeMagnitudeDistance>=bands.earlyLaterEdge&&laterDeep.structureDistance>=bands.laterDeepStructure&&laterDeep.edgeMagnitudeDistance>=bands.laterDeepEdge,
    {earlyLater,laterDeep});
  gate('lockdown warning is visibly broad',warningContrast.changedFraction>=bands.warningChanged&&warningContrast.meanDelta>=bands.warningMean&&warningContrast.changedGridFraction>=bands.warningGrid,warningContrast);
  gate('ordered rune pressure and solved seal visibly change the room',sigilPressure.changedFraction>=bands.sigilPressureChanged&&sigilPressure.meanDelta>=bands.sigilPressureMean&&sigilSolve.changedFraction>=bands.sigilSolveChanged&&sigilSolve.meanDelta>=bands.sigilSolveMean,{sigilPressure,sigilSolve});
  gate('relay pressure and solved laser grid visibly change the room',relayPressure.changedFraction>=bands.relayPressureChanged&&relayPressure.meanDelta>=bands.relayPressureMean&&relaySolve.changedFraction>=bands.relaySolveChanged&&relaySolve.meanDelta>=bands.relaySolveMean,{relayPressure,relaySolve});
  gate('phase pulse has authored enemy response and aftermath',pulseBurst.changedFraction.max>=bands.pulseChanged&&pulseBurst.changedGridFraction.max>=bands.pulseGrid&&pulseBurst.firstLast.structureDistance>=bands.pulseStructure,pulseBurst);
  gate('loot pickup has authored impact',lootDelta.changedFraction>=bands.lootChanged&&lootDelta.meanDelta>=bands.lootMean&&lootDelta.changedGridFraction>=bands.lootGrid,lootDelta);
  gate('key unlock has authored impact',unlockDelta.changedFraction>=bands.unlockChanged&&unlockDelta.meanDelta>=bands.unlockMean&&unlockDelta.changedGridFraction>=bands.unlockGrid,unlockDelta);
  gate('narrow escape has authored reaction and aftermath',nearMissBurst.changedFraction.max>=bands.nearMissChanged&&nearMissBurst.changedGridFraction.max>=bands.nearMissGrid&&nearMissBurst.firstLast.structureDistance>=bands.nearMissStructure,nearMissBurst);
  gate('lockdown landing is spatially broad',lockdownBurst.changedFraction.max>=bands.lockdownChanged&&lockdownBurst.changedGridFraction.max>=bands.lockdownGrid&&lockdownBurst.firstLast.structureDistance>=bands.lockdownStructure,lockdownBurst);
  gate('delivery is an apex payoff',deliveryDelta.changedFraction>=bands.deliveryChanged&&deliveryDelta.meanDelta>=bands.deliveryMean&&deliveryDelta.changedGridFraction>=bands.deliveryGrid&&deliveryBurst.changedGridFraction.max>=bands.deliveryBurstGrid&&deliveryBurst.firstLast.structureDistance>=bands.deliveryStructure,
    {deliveryDelta,deliveryBurst});
  gate('candidate numeric richness is reference-comparable',median(cm.map(value=>value.edge[1].energy))>=refEdge*.9&&median(cm.map(value=>value.richCellFraction))>=refRich*.9,
    {candidateEdge:median(cm.map(value=>value.edge[1].energy)),referenceEdge:refEdge,candidateRich:median(cm.map(value=>value.richCellFraction)),referenceRich:refRich});

  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256));
  let review;
  if(fs.existsSync(REVIEW_PATH))review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256,preservedPath:PRESERVED_CONTACT_PATH});
  else review={ok:false,errors:[`missing committed semantic review: ${REVIEW_PATH}`,`inspect ${CONTACT_PATH}, then copy and complete ${REVIEW_TEMPLATE_PATH}`]};
  gate('fresh semantic comparison receipt',review.ok,review.errors);

  const report={
    schema:1,game:'ghost-shift',seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,
    contactSheet:{path:CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{fixture:beat.run,offset:beat.offset,probe:candidate[beat.id].probe}])),
    thresholds:{referenceEdgeFloor:refEdge,referenceRichFloor:refRich,bands},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,
      courierWalk,patrolDrone,chaseDrone,courierContrast,droneContrast,loadPose,spottedPose,patrolChase,earlyLater,laterDeep,
      warningContrast,sigilPressure,sigilSolve,relayPressure,relaySolve,pulseBurst,lootDelta,unlockDelta,nearMissBurst,lockdownBurst,deliveryDelta,deliveryBurst,plannerHashes,courierExtent,droneExtent,castFootprintFraction:castFrame.probe.castFootprintFraction},
    gates,automatedOk:gates.slice(0,-1).every(value=>value.ok),semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
  };
  writeJson(METRICS_PATH,report);

  console.log(`GHOST SHIFT visual evidence · seed 0x${SEED.toString(16)}`);
  for(const value of gates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log('  contact:',CONTACT_PATH);
  console.log('  montage sha256:',sheet.sha256);
  console.log('  metrics:',METRICS_PATH);
  console.log('  review template:',REVIEW_TEMPLATE_PATH);
  if(!gates.every(value=>value.ok)){
    console.error('\nGHOST SHIFT VISUAL EVAL FAILED');
    process.exit(1);
  }
  console.log('\nGHOST SHIFT VISUAL EVAL PASSED');
}

main().catch(error=>{console.error('GHOST SHIFT VISUAL EVAL FAILED:',error.stack||error);process.exit(1);});
