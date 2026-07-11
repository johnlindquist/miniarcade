#!/usr/bin/env node
'use strict';

// STAR SALVAGE real-pixel release gate. Gameplay truth lives in the behavioral
// suite; this file renders the actual @napi canvas at native 160x360, measures
// the authored beats, and binds a human comparison against MACHINE HUNT and
// BLOCK MINE to the exact montage bytes.
const fs=require('fs');
const path=require('path');
const{bootRenderedGame,rgbaFrame,encodeRgbaPng}=require('../render/runtime');
const{
  sha256,toNativeFrame,analyzeFrame,frameDifference,structureDistance,
  analyzeBurst,writeContactSheet,verifyReviewReceipt,writeJson,quantile
}=require('./visual-harness');

const ROOT=path.join(__dirname,'..');
const GAME_PATH=path.join(__dirname,'..','star-salvage.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','star-salvage');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','star-salvage.json');
const PRESERVED_CONTACT_PATH=path.join(__dirname,'visual-receipts','star-salvage-contact-sheet.png');
const SEED=0x5a1a6e,RENDER_EVERY=2;
const WORLD_CROP={x:0,y:28,width:160,height:306};
const DOCK_CROP={x:0,y:235,width:160,height:99};
const CLAMP_CROP={x:40,y:270,width:80,height:64};

if(!fs.existsSync(GAME_PATH)){
  console.error('STAR SALVAGE VISUAL EVAL FAILED: missing '+GAME_PATH);
  process.exit(1);
}

const median=values=>quantile(values,.5);
const object=value=>value&&typeof value==='object'?value:{};

function visualProbe(runtime){
  return JSON.parse(JSON.stringify(object(runtime.probe('__starSalvageVisualProbe'))));
}

function captureFixture(name,offsets){
  const runtime=bootRenderedGame('star-salvage',{seed:SEED});
  if(typeof runtime.sandbox.__starSalvageSetVisualBeat!=='function')
    throw new Error('star-salvage.html must expose __starSalvageSetVisualBeat(name)');
  runtime.sandbox.__starSalvageSetVisualBeat(name);
  const frames=new Map();
  for(const target of [...new Set(offsets)].sort((a,b)=>a-b)){
    runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});
    const frame=runtime.snapshot({native:true});
    frame.probe=visualProbe(runtime);frame.fixture=name;frame.offset=target;
    frames.set(target,frame);
  }
  return frames;
}

function captureTimeline(name,seed,targets){
  const runtime=bootRenderedGame(name,{seed}),frames=new Map();
  for(const target of [...targets].sort((a,b)=>a-b)){
    runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});
    frames.set(target,runtime.snapshot({native:true}));
  }
  return frames;
}

function buildCandidate(){
  const specs={
    opening:[1,12],normal:[1,3,5,7,12],overloaded:[1,12,24],
    later:[1,12],danger:[1,12,24],apex:[1,6,12,24,48,72]
  },runs={};
  for(const[name,offsets]of Object.entries(specs))runs[name]=captureFixture(name,offsets);
  const beats=[
    {id:'opening',label:'opening',offset:12},
    {id:'normal',label:'normal play',offset:12},
    {id:'overloaded',label:'overloaded',offset:12},
    {id:'later',label:'graveyard',offset:12},
    {id:'danger',label:'act warning',offset:12},
    {id:'apex',label:'homecoming',offset:24}
  ];
  const frames=Object.fromEntries(beats.map(beat=>[beat.id,runs[beat.id].get(beat.offset)]));
  const all=[];
  for(const[fixture,map]of Object.entries(runs))for(const[offset,frame]of map)all.push({fixture,offset,frame});
  return{specs,runs,beats,frames,all};
}

function fixedCrop(frame,box,size){
  size=size||40;const source=toNativeFrame(frame),out=Buffer.alloc(size*size*4),
    cx=Math.round(box.x+box.width/2),cy=Math.round(box.y+box.height/2),left=cx-Math.floor(size/2),top=cy-Math.floor(size/2);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const sx=left+x,sy=top+y,dst=(y*size+x)*4;
    if(sx<0||sy<0||sx>=source.width||sy>=source.height){out[dst+3]=255;continue;}
    const src=(sy*source.width+sx)*4;
    out[dst]=source.rgba[src];out[dst+1]=source.rgba[src+1];out[dst+2]=source.rgba[src+2];out[dst+3]=source.rgba[src+3];
  }
  return rgbaFrame(out,size,size,{fixture:frame.fixture,offset:frame.offset});
}

function alignedBurst(frames){
  const differences=[];
  for(let i=1;i<frames.length;i++)differences.push(frameDifference(frames[i-1],frames[i],{native:false}));
  return{
    pairs:differences.length,differences,
    medianChanged:median(differences.map(v=>v.changedFraction)),
    maxChanged:Math.max(...differences.map(v=>v.changedFraction)),
    firstLast:frameDifference(frames[0],frames.at(-1),{native:false})
  };
}

function allPairs(entries,fn){
  const out=[];for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++)out.push(fn(entries[i],entries[j],i,j));return out;
}

function cleanArtifacts(){
  fs.mkdirSync(FRAME_DIR,{recursive:true});
  for(const file of fs.readdirSync(FRAME_DIR))if(file.endsWith('.png'))fs.unlinkSync(path.join(FRAME_DIR,file));
}

function main(){
  cleanArtifacts();
  const evidence=buildCandidate(),repeat=buildCandidate(),{beats,frames:candidate}=evidence;
  const deterministicRows=evidence.all.map(entry=>{
    const other=repeat.runs[entry.fixture].get(entry.offset),a=sha256(entry.frame.rgba),b=sha256(other.rgba);
    return{fixture:entry.fixture,offset:entry.offset,a,b,ok:a===b};
  });

  const refTargets=beats.map((_,i)=>60+i*600),horizon=captureTimeline('horizon',0xa1020401,refTargets),
    blockmine=captureTimeline('blockmine',0xb10c0050,refTargets),horizonByBeat={},blockmineByBeat={};
  beats.forEach((beat,index)=>{
    horizonByBeat[beat.id]=horizon.get(refTargets[index]);blockmineByBeat[beat.id]=blockmine.get(refTargets[index]);
    fs.writeFileSync(path.join(FRAME_DIR,`${String(index+1).padStart(2,'0')}-${beat.id}.png`),encodeRgbaPng(candidate[beat.id]));
  });
  for(const[fixture,map]of Object.entries(evidence.runs))for(const[offset,frame]of map)
    fs.writeFileSync(path.join(FRAME_DIR,`burst-${fixture}-${String(offset).padStart(3,'0')}.png`),encodeRgbaPng(frame));

  const sheet=writeContactSheet({
    beats:beats.map(beat=>({id:beat.id,label:beat.label})),
    rows:[
      {label:'STAR SALVAGE',frames:candidate},
      {label:'MACHINE HUNT',frames:horizonByBeat},
      {label:'BLOCK MINE',frames:blockmineByBeat}
    ],outPath:CONTACT_PATH
  });

  const candidateMetrics=Object.fromEntries(beats.map(beat=>[beat.id,analyzeFrame(candidate[beat.id],{native:false,crop:WORLD_CROP})]));
  const horizonMetrics=beats.map(beat=>analyzeFrame(horizonByBeat[beat.id],{native:false,crop:WORLD_CROP}));
  const blockmineMetrics=beats.map(beat=>analyzeFrame(blockmineByBeat[beat.id],{native:false,crop:WORLD_CROP}));
  const cm=Object.values(candidateMetrics),refEdge=Math.min(median(horizonMetrics.map(m=>m.edge[1].energy)),median(blockmineMetrics.map(m=>m.edge[1].energy))),
    refRich=Math.min(median(horizonMetrics.map(m=>m.richCellFraction)),median(blockmineMetrics.map(m=>m.richCellFraction)));

  const normalFrames=[1,3,5,7].map(offset=>evidence.runs.normal.get(offset));
  const normalCrops=normalFrames.map(frame=>fixedCrop(frame,frame.probe.shipBox,40));
  const characterBurst=alignedBurst(normalCrops);
  const apexFrames=[1,6,12,24,48,72].map(offset=>evidence.runs.apex.get(offset));
  const apexBurst=analyzeBurst(apexFrames,{native:false,crop:DOCK_CROP});
  const apexClamp=analyzeBurst(apexFrames,{native:false,crop:CLAMP_CROP});
  const openingApex=frameDifference(candidate.opening,candidate.apex,{native:false,crop:DOCK_CROP});
  const progression=['opening','overloaded','later'].map(id=>({id,frame:candidate[id]}));
  const progressionPairs=allPairs(progression,(a,b)=>({a:a.id,b:b.id,...structureDistance(a.frame,b.frame,{crop:WORLD_CROP})}));
  const bandSeparations=cm.map(m=>Math.max(...m.bandLuma)-Math.min(...m.bandLuma));

  const gates=[];const gate=(name,ok,detail)=>gates.push({name,ok:!!ok,detail});
  gate('same-seed real pixels deterministic',deterministicRows.every(row=>row.ok),deterministicRows);
  // Final measured ranges: 117..157 quantized colors, 2.752..4.417 bits of
  // entropy, .0927..1112 luma deviation, and .151..504 largest-color share.
  // The margins reject blank/flat captures while retaining the intentional
  // low-contrast meteor-warning wash.
  gate('native frames are opaque and non-flat',cm.every(m=>m.width===160&&m.height===360&&m.opaqueFraction===1&&m.quantizedColors>=105&&m.colorEntropy>=2.55&&m.lumaStdDev>=.085&&m.largestColorShare<=.57),
    cm.map(m=>({colors:m.quantizedColors,entropy:m.colorEntropy,lumaStdDev:m.lumaStdDev,largest:m.largestColorShare})));
  // The six known-good frames measure 6.16..17.385 luma points of vertical
  // separation (median 11.65), including two deliberately quiet opening bays.
  gate('foreground, midground, and background retain value separation',bandSeparations.every(v=>v>=5.5)&&median(bandSeparations)>=10,bandSeparations);
  gate('multiscale detail is reference-comparable',median(cm.map(m=>m.edge[1].energy))>=refEdge*.72&&median(cm.map(m=>m.richCellFraction))>=refRich*.72,
    {candidateEdge:median(cm.map(m=>m.edge[1].energy)),referenceEdge:refEdge,candidateRich:median(cm.map(m=>m.richCellFraction)),referenceRich:refRich});
  gate('authored tug has aligned locomotion/reaction animation',characterBurst.medianChanged>=.025&&characterBurst.maxChanged<=.55&&characterBurst.firstLast.changedFraction>=.04,
    characterBurst);
  gate('sector progression changes composition, not only palette',progressionPairs.every(pair=>pair.structureDistance>=.24),progressionPairs);
  gate('overloaded train is visibly truthful',candidate.overloaded.probe.train===6&&candidate.overloaded.probe.sector===1&&/REEL|HOME/.test(candidate.overloaded.probe.tactic),candidate.overloaded.probe);
  gate('warning keeps the cargo and changes the world before land',candidate.danger.probe.act==='warn'&&candidate.danger.probe.train>=4&&candidate.danger.probe.tactic==='BEAT THE FRONT',candidate.danger.probe);
  gate('apex fixture has sequential intake and active clamps',candidate.apex.probe.bankGhosts>=5&&candidate.apex.probe.dockCelebration>0&&candidate.apex.probe.dockApex===true&&candidate.apex.probe.ghosts.length>=5,candidate.apex.probe);
  gate('homecoming animates clamp beams and intake',apexClamp.changedFraction.max>=.035&&apexClamp.meanDelta.max>=.012&&apexClamp.changedGridFraction.max>=.35,apexClamp);
  gate('bay-wide launch pulse has authored spatial impact',apexBurst.changedFraction.max>=.09&&apexBurst.meanDelta.max>=.018&&apexBurst.changedGridFraction.max>=.6&&apexBurst.firstLast.structureDistance>=.12,
    apexBurst);
  gate('apex dock silhouette differs from opening',openingApex.changedFraction>=.22&&openingApex.changedGridFraction>=.7,openingApex);

  const automatedOk=gates.every(value=>value.ok);
  let review={ok:false,errors:['review receipt missing']};
  if(fs.existsSync(REVIEW_PATH))review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256,preservedPath:PRESERVED_CONTACT_PATH});
  gate('fresh semantic comparison receipt',review.ok,review.errors);
  const report={
    schema:1,game:'star-salvage',seed:'0x'+SEED.toString(16),
    contactSheet:{path:CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{fixture:beat.id,offset:beat.offset,probe:candidate[beat.id].probe}])),
    thresholds:{worldCrop:WORLD_CROP,dockCrop:DOCK_CROP,clampCrop:CLAMP_CROP,referenceEdgeFloor:refEdge,referenceRichFloor:refRich},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,bandSeparations,characterBurst,progressionPairs,apexBurst,apexClamp,openingApex},
    gates,automatedOk,semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
  };
  writeJson(METRICS_PATH,report);

  console.log(`STAR SALVAGE visual evidence · seed 0x${SEED.toString(16)}`);
  for(const value of gates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log('  contact:',CONTACT_PATH);console.log('  montage sha256:',sheet.sha256);console.log('  metrics:',METRICS_PATH);
  if(!gates.every(value=>value.ok)){console.error('\nSTAR SALVAGE VISUAL EVAL FAILED');process.exit(1);}
  console.log('\nSTAR SALVAGE VISUAL EVAL PASSED');
}

try{main();}catch(error){console.error('STAR SALVAGE VISUAL EVAL FAILED:',error.stack||error);process.exit(1);}
