#!/usr/bin/env node
'use strict';

// GRAVE GARDEN real-pixel release gate. Behavioral truth lives in
// grave-garden-eval.js; this suite asks the game for deterministic authored
// visual fixtures, renders the actual canvas, and measures the resulting RGBA
// at the native 160x360 viewer size. A separate hashed semantic receipt records
// the reference-based visual judgment that pixel statistics cannot make.
const fs=require('fs');
const path=require('path');
const{
  bootRenderedGame,rgbaFrame,encodeRgbaPng
}=require('../../render/runtime');
const{
  sha256,toNativeFrame,analyzeFrame,frameDifference,structureDistance,analyzeBurst,
  writeContactSheet,verifyReviewReceipt,writeJson,quantile
}=require('./visual-harness');

const ROOT=path.join(__dirname,'..','..');
const GAME_PATH=path.join(__dirname,'..','grave-garden.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','grave-garden');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','grave-garden.json');
const SEED=0x6752444e,PRE_ROLL=120,RENDER_EVERY=2;
const WORLD_CROP={x:0,y:52,width:160,height:240};

if(!fs.existsSync(GAME_PATH)){
  console.error('GRAVE GARDEN VISUAL EVAL FAILED: missing '+GAME_PATH);
  process.exit(1);
}

const median=values=>quantile(values,.5);

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

function analyzeAlignedBurst(frames,boxSource){
  const crops=[];
  for(const frame of frames){
    const box=typeof boxSource==='string'?frame.probe&&frame.probe[boxSource]:boxSource;
    if(!box||!(box.width>0&&box.height>0))return null;
    crops.push(fixedCrop(frame,box,40));
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
    {id:'later',label:'later garden',run:'later',offset:12},
    {id:'apex',label:'apex',run:'apex',offset:6}
  ];
  const frames=Object.fromEntries(beats.map(beat=>[beat.id,runs[beat.run].get(beat.offset)]));
  const all=[];
  for(const[id,frameMap]of Object.entries(runs))for(const[offset,frame]of frameMap)all.push({id,offset,frame});
  return{specs,runs,beats,frames,all};
}

function reviewTemplate(montageSha256){
  const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});
  return{
    schema:1,game:'grave-garden',verdict:'pending',references:['horizon','blockmine'],montageSha256,
    reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size reference review',
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

  const evidence=buildCandidateEvidence(),repeat=buildCandidateEvidence();
  const determinism=evidence.all.map(value=>{
    const other=repeat.runs[value.id].get(value.offset),a=sha256(value.frame.rgba),b=sha256(other.rgba);
    return{fixture:value.id,offset:value.offset,a,b,ok:a===b};
  });
  const deterministic=determinism.every(value=>value.ok);
  const{beats,frames:candidate}=evidence;

  const referenceTargets=[60,600,1200,2400,3600,5400,9000,12000];
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
      {label:'GRAVE GARDEN',frames:candidate},
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

  const gardenerBurst=analyzeAlignedBurst([1,3,5,7,9,13].map(offset=>evidence.runs.anticipation.get(offset)),'gardenerBox');
  // Later's lane-one PEA WARD fires on frame 35. Align its authored head and
  // recoil rather than accepting the idle lane-three plant returned by the
  // general-purpose visual probe.
  const plantBurst=analyzeAlignedBurst([32,34,35,37,41].map(offset=>evidence.runs.later.get(offset)),
    {x:56,y:68,width:24,height:32});
  const zombieBurst=analyzeAlignedBurst([1,8,16,24,32].map(offset=>evidence.runs.later.get(offset)),'zombieBox');
  const earlyLater=structureDistance(candidate.opening,candidate.later,{crop:WORLD_CROP});
  const warningContrast=frameDifference(evidence.runs.warningCalm.get(12),candidate.warning,{native:false,crop:WORLD_CROP});
  const saveDelta=frameDifference(candidate.anticipation,candidate.payoff,{native:false,crop:WORLD_CROP});
  const saveBurst=analyzeBurst([1,3,6,12,24].map(offset=>evidence.runs.payoff.get(offset)),{native:false,crop:WORLD_CROP});
  const apexDelta=frameDifference(evidence.runs.apexCalm.get(1),evidence.runs.apex.get(1),{native:false,crop:WORLD_CROP});
  const apexBurst=analyzeBurst([1,6,12,24,48].map(offset=>evidence.runs.apex.get(offset)),{native:false,crop:WORLD_CROP});

  // Fixed-seed calibration for the approved candidate capture, with roughly
  // 10-20% regression margin rather than permissive existence checks:
  // candidate minima were 129 colors / 4.647 entropy / .130 luma deviation /
  // .024 one-pixel edge energy / .933 rich cells; actor and beat measurements
  // are preserved in metrics.json beside these executable floors.
  const bands={
    colors:110,entropy:4.2,lumaStdDev:.11,largestColorShare:.18,
    edgeEnergy:.020,richEach:.82,richMedian:.88,
    gardenerMax:.045,gardenerFirstLast:.05,gardenerGrid:.30,
    plantMax:.034,plantFirstLast:.030,plantGrid:.14,
    zombieMax:.050,zombieFirstLast:.12,zombieGrid:.45,
    earlyLaterStructure:.23,earlyLaterEdge:.38,
    warningChanged:.14,warningMean:.0085,warningGrid:.30,warningBounds:.14,
    saveChanged:.13,saveMean:.011,saveGrid:.30,saveBounds:.14,
    saveBurstChanged:.24,saveBurstGrid:.80,saveBurstStructure:.24,
    apexChanged:.82,apexMean:.055,apexGrid:.90,apexBounds:.90,apexBurstGrid:.43
  };

  const gates=[];
  const gate=(name,ok,detail)=>gates.push({name,ok:!!ok,detail});
  gate('same-seed real pixels deterministic',deterministic,determinism);
  gate('all requested fixtures are finite and truthful',beats.every(beat=>candidate[beat.id].probe&&candidate[beat.id].probe.finite!==false),
    beats.map(beat=>({beat:beat.id,probe:candidate[beat.id].probe})));
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

  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256));
  let review;
  if(fs.existsSync(REVIEW_PATH))review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256});
  else review={ok:false,errors:[`missing committed semantic review: ${REVIEW_PATH}`,`inspect ${CONTACT_PATH}, then copy and complete ${REVIEW_TEMPLATE_PATH}`]};
  gate('fresh semantic comparison receipt',review.ok,review.errors);

  const report={
    schema:1,game:'grave-garden',seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,
    contactSheet:{path:CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{fixture:beat.run,offset:beat.offset,probe:candidate[beat.id].probe}])),
    thresholds:{referenceEdgeFloor:refEdge,referenceRichFloor:refRich,bands},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,
      gardenerBurst,plantBurst,zombieBurst,earlyLater,warningContrast,saveDelta,saveBurst,apexDelta,apexBurst},
    gates,automatedOk:gates.slice(0,-1).every(value=>value.ok),semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
  };
  writeJson(METRICS_PATH,report);

  console.log(`GRAVE GARDEN visual evidence · seed 0x${SEED.toString(16)}`);
  for(const value of gates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log('  contact:',CONTACT_PATH);
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
