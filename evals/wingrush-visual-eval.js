#!/usr/bin/env node
'use strict';

// WINGRUSH real-pixel release gate. Behavioral truth comes from wingrush-eval;
// this suite locates representative beats through __wingrushProbe(), renders
// the actual canvas, computes independent RGBA evidence, and requires a fresh
// human/vision comparison against MACHINE HUNT and BLOCK MINE.
const fs=require('fs');
const path=require('path');
const{createRequire}=require('module');
const{
  bootRenderedGame,rgbaFrame,encodeRgbaPng
}=require('../render/runtime');
const{
  sha256,toNativeFrame,analyzeFrame,frameDifference,structureDistance,
  analyzeBurst,extractSkyline,skylineDistance,writeContactSheet,verifyReviewReceipt,writeJson,quantile
}=require('./visual-harness');
const OLD_TOPPLE_RECEIPTS=require('./visual-baselines/old-topple-range');

const ROOT=path.join(__dirname,'..');
const GAME_ROOT=ROOT;
const GAME_PATH=path.join(__dirname,'..','wingrush.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','wingrush');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','wingrush.json');
const PRESERVED_CONTACT_PATH=path.join(__dirname,'visual-receipts','wingrush-contact-sheet.png');
const SEED=0x571a6001,NATURAL_SEED=0x7907,PRE_ROLL=120,RENDER_EVERY=2;
const WORLD_CROP={x:0,y:30,width:160,height:330};
const ROUTE_CROP={x:0,y:337,width:160,height:23};

const canvasRequire=createRequire(path.join(ROOT,'render','package.json'));
const{createCanvas,loadImage}=canvasRequire('@napi-rs/canvas');

if(!fs.existsSync(GAME_PATH)){
  console.error('WINGRUSH VISUAL EVAL FAILED: missing '+GAME_PATH);
  process.exit(1);
}

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const num=(...values)=>values.find(finite);
const text=(...values)=>values.find(value=>typeof value==='string'&&value.trim())||'';
const object=value=>value&&typeof value==='object'?value:{};
const median=values=>quantile(values,.5);
const ratio=(n,d)=>d?n/d:0;

function normalizeProbe(raw){
  raw=object(raw);
  const body=object(raw.body||raw.bird||raw.player||raw.rider),visual=object(raw.visual),tower=object(raw.tower),target=object(raw.target),stats=object(raw.stats);
  const vx=num(body.vx,raw.vx,raw.speed,0),vy=num(body.vy,raw.vy,0);
  const speed=num(raw.speed,Math.hypot(vx||0,vy||0),0);
  const box=raw.playerBox||visual.playerBox||body.screenBox||null;
  const towerDistance=num(target.distance,tower.distance,raw.towerDistance,raw.targetDistance);
  const phase=text(tower.phase,raw.towerPhase,visual.towerPhase).toLowerCase();
  return{
    frame:num(raw.showFrame,raw.frame,raw.runFrame),
    biome:text(raw.biome&&raw.biome.id,raw.biome&&raw.biome.name,raw.biome,raw.biomeId,visual.biome),
    hillFamily:text(raw.hillFamily,raw.family,raw.hill&&raw.hill.family,raw.terrain&&raw.terrain.family,visual.hillFamily),
    speed,vx,vy,x:num(body.x,raw.x),y:num(body.y,raw.y),
    airborne:!!(raw.airborne??body.airborne??(!body.grounded&&body.grounded!==undefined)),
    airHeight:num(raw.airHeight,raw.altitude,body.airHeight,body.altitude,visual.airHeight,0),
    pose:text(body.pose,raw.pose,visual.pose),
    danger:!!(raw.danger??visual.danger??tower.danger??(finite(towerDistance)&&towerDistance<70)),
    towerPhase:phase,towerDistance,targetId:num(target.id,raw.targetId),targetKind:text(target.kind,raw.targetKind),targetLead:num(target.lockFrames,raw.targetLead,0),
    targetHits:num(stats.targetHits,raw.targetHits,0),targets:num(stats.targets,raw.targets,0),landings:num(stats.landings,raw.landings,0),
    guidedLandings:num(stats.guidedLandings,raw.guidedLandings,0),guidedAttempts:num(stats.guidedAttempts,raw.guidedAttempts,0),
    roughLandings:num(stats.roughLandings,raw.roughLandings,0),lastLandingError:num(stats.lastLandingError,raw.lastLandingError,0),
    routeVisible:raw.routeVisible!==false,landing:raw.landing||null,
    towerImpacts:num(stats.towerImpacts,stats.impacts,raw.towerImpacts,raw.impactSerial,0),
    majorFlights:num(stats.majorFlights,stats.highFlights,stats.flights,raw.majorFlights,raw.flightSerial,0),
    playerBox:box&&{x:num(box.x,0),y:num(box.y,0),width:num(box.width,box.w,0),height:num(box.height,box.h,0)},
    bodyBox:raw.bodyBox||visual.bodyBox||null,scarfBox:raw.scarfBox||visual.scarfBox||null,fortBox:raw.fortBox||visual.fortBox||null,
    finite:raw.finite!==false
  };
}

function wingProbe(sandbox){
  const fn=sandbox.__wingrushProbe,visualFn=sandbox.__wingrushVisualProbe;
  if(typeof fn!=='function')throw new Error('wingrush.html must expose globalThis.__wingrushProbe() for behavioral and visual evidence');
  const base=fn(),visual=typeof visualFn==='function'?visualFn():{};
  return normalizeProbe(Object.assign({},base,visual,{bird:base.bird,stats:base.stats,finite:base.finite}));
}

function captureTimeline(gameName,seed,targets,probe){
  const runtime=bootRenderedGame(gameName,{seed,root:GAME_ROOT});
  const unique=[...new Set(targets)].sort((a,b)=>a-b),frames=new Map();
  for(const target of unique){
    if(target<runtime.frame)throw new Error(`unordered capture ${target} after ${runtime.frame}`);
    if(target-runtime.frame>PRE_ROLL)runtime.advanceTo(target-PRE_ROLL);
    if(target>runtime.frame)runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});
    const frame=runtime.snapshot({native:true});
    frame.probe=probe?probe(runtime.sandbox):null;
    frames.set(target,frame);
  }
  return frames;
}

function captureFixture(name,offsets,footer){
  const runtime=bootRenderedGame('wingrush',{seed:SEED,root:GAME_ROOT,footer:footer||''});
  if(typeof runtime.sandbox.__wingrushSetVisualBeat!=='function')
    throw new Error('wingrush.html must expose __wingrushSetVisualBeat(name)');
  if(name.startsWith('fort-scale-'))runtime.sandbox.__wingrushSetFortScale(Number(name.slice(-1)));
  else runtime.sandbox.__wingrushSetVisualBeat(name);
  const frames=new Map();
  for(const target of [...new Set(offsets)].sort((a,b)=>a-b)){
    runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});
    const frame=runtime.snapshot({native:true});frame.probe=wingProbe(runtime.sandbox);frame.fixture=name;
    frames.set(target,frame);
  }
  return frames;
}

function layerMask(a,b,crop){
  a=toNativeFrame(a);b=toNativeFrame(b);crop=crop||{x:0,y:0,width:a.width,height:a.height};let minX=Infinity,minY=Infinity,maxX=-1,maxY=-1,pixels=0,delta=0;
  for(let y=crop.y;y<crop.y+crop.height;y++)for(let x=crop.x;x<crop.x+crop.width;x++){
    const i=(y*a.width+x)*4,d=Math.abs(a.rgba[i]-b.rgba[i])+Math.abs(a.rgba[i+1]-b.rgba[i+1])+Math.abs(a.rgba[i+2]-b.rgba[i+2]);
    if(d<18)continue;pixels++;delta+=d;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  }
  return{pixels,meanDelta:pixels?delta/pixels:0,bounds:pixels?{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1}:null};
}

function measureFixtureLayer(name,offset,flag){
  const shared=flag==='__HIDE_BIRD'?'globalThis.__HIDE_MOTION_TRAILS=1;':'',normal=captureFixture(name,[offset],shared).get(offset),
    hidden=captureFixture(name,[offset],shared+`globalThis.${flag}=1;`).get(offset);
  return{name,offset,flag,...layerMask(normal,hidden,WORLD_CROP)};
}

function measureNaturalFortVisibility(seed,sequence){
  const normal=bootRenderedGame('wingrush',{seed,root:GAME_ROOT}),hidden=bootRenderedGame('wingrush',{seed,root:GAME_ROOT,footer:'globalThis.__HIDE_FORTS=1;'}),samples=[];
  const frames=[];for(let frame=sequence.launchFrame;frame<=sequence.hitFrame;frame+=4)frames.push(frame);if(frames.at(-1)!==sequence.hitFrame)frames.push(sequence.hitFrame);
  for(const frame of frames){normal.advanceTo(frame,{renderLast:true});hidden.advanceTo(frame,{renderLast:true});const mask=layerMask(normal.snapshot({native:true}),hidden.snapshot({native:true}),WORLD_CROP);samples.push({frame,pixels:mask.pixels,bounds:mask.bounds});}
  const maxPixels=Math.max(0,...samples.map(value=>value.pixels)),materialFloor=Math.max(6,Math.floor(maxPixels*.25)),material=samples.filter(value=>value.pixels>=materialFloor),
    fraction=ratio(material.length,samples.length),firstMaterial=material.length?material[0].frame:-1;
  return{launchFrame:sequence.launchFrame,hitFrame:sequence.hitFrame,sampledFrames:samples.length,maxPixels,materialFloor,materialFrames:material.length,fraction,firstMaterial,samples};
}

function discoverNaturalSequence(seed){
  const runtime=bootRenderedGame('wingrush',{seed,root:GAME_ROOT}),lockByTarget=new Map();
  let previousHits=0,previousLaunches=0,hitFrame=-1,hitTarget=-1,lockFrame=-1,launchFrame=-1,landingFrame=-1,
    landingForecast=-1,landingCommit=-1,forecastX=null,commitX=null,touchdownX=null,flightFrame=-1,bestAirHeight=-1,lastProbe=null,lastLaunch=null;
  for(let frame=1;frame<=3600;frame++){
    runtime.advance(1);const probe=wingProbe(runtime.sandbox);lastProbe=probe;
    if(finite(probe.targetId)&&!lockByTarget.has(probe.targetId))lockByTarget.set(probe.targetId,frame-Math.max(0,probe.targetLead||0));
    const launches=runtime.sandbox.__wingrushProbe().stats.launches;if(launches>previousLaunches){lastLaunch={frame,targetId:probe.targetId};previousLaunches=launches;}
    if(probe.airborne&&finite(probe.towerDistance)&&probe.towerDistance>80&&probe.towerDistance<560&&probe.airHeight>bestAirHeight){bestAirHeight=probe.airHeight;flightFrame=frame;}
    if(probe.targetHits>previousHits){hitFrame=frame;hitTarget=probe.targetId;lockFrame=lockByTarget.get(hitTarget)??Math.max(1,frame-(probe.targetLead||0));
      launchFrame=lastLaunch&&lastLaunch.targetId===hitTarget?lastLaunch.frame:Math.max(lockFrame,hitFrame-180);previousHits=probe.targetHits;break;}
    previousHits=probe.targetHits;
  }
  if(hitFrame<0)throw new Error(`natural seed 0x${seed.toString(16)} produced no direct target hit in 60 seconds`);
  let previousGuided=lastProbe&&lastProbe.guidedLandings||0;
  for(let frame=hitFrame+1;frame<=Math.min(3600,hitFrame+900);frame++){
    runtime.advance(1);const probe=wingProbe(runtime.sandbox);lastProbe=probe;
    if(probe.landing&&finite(probe.landing.x)){if(landingForecast<0){landingForecast=frame;forecastX=probe.landing.x;}landingCommit=frame;commitX=probe.landing.x;}
    if(probe.guidedLandings>previousGuided){landingFrame=frame;touchdownX=probe.x;break;}previousGuided=probe.guidedLandings;
  }
  if(landingFrame<0)throw new Error(`natural seed 0x${seed.toString(16)} produced no guided post-hit landing by frame ${Math.min(3600,hitFrame+900)}`);
  if(landingForecast<0||landingCommit<landingForecast||!finite(forecastX)||!finite(commitX)||!finite(touchdownX))throw new Error('guided landing lacked a truthful forecast/commit/touchdown sequence');
  const approach=Math.max(lockFrame+45,hitFrame-120),danger=Math.max(approach+1,hitFrame-24),recovery=Math.min(3600,hitFrame+72);
  return{seed,hitFrame,hitTarget,lockFrame,launchFrame,leadFrames:hitFrame-lockFrame,flightFrame:flightFrame<0?approach:Math.min(flightFrame,hitFrame-1),approach,danger,recovery,
    landingForecast,landingCommit,landingFrame,landingAftermath:Math.min(3600,landingFrame+18),forecastX,commitX,touchdownX,
    forecastShift:Math.abs(commitX-forecastX),landingError:Math.abs(touchdownX-commitX)};
}

function captureNaturalSequence(seed,sequence){
  const targets=[sequence.flightFrame,sequence.approach,sequence.danger,Math.max(sequence.approach,sequence.hitFrame-6),sequence.hitFrame,
    Math.min(3600,sequence.hitFrame+12),Math.min(3600,sequence.hitFrame+36),sequence.recovery,sequence.landingForecast,sequence.landingCommit,
    sequence.landingFrame,sequence.landingAftermath];
  return captureTimeline('wingrush',seed,targets,wingProbe);
}

function buildCandidateEvidence(){
  const specs={
    opening:[12],momentum:[1,3,5,7,12],'major-flight':[12],tower:[12,24],
    impact:[1,6,12,24,48,72],'fort-crown':[12],'later-biome':[12],apex:[12,24]
  },runs={};
  for(const[name,offsets]of Object.entries(specs))runs[name]=captureFixture(name,offsets);
  const natural=discoverNaturalSequence(NATURAL_SEED);runs.natural=captureNaturalSequence(NATURAL_SEED,natural);
  const cell=(fixture,offset)=>runs[fixture].get(offset);
  const beats=[
    {id:'opening',label:'opening',fixture:'opening',offset:12},
    {id:'normal',label:'momentum',fixture:'momentum',offset:12},
    {id:'biome1',label:'meadow',fixture:'opening',offset:12},
    {id:'biome2',label:'canyon',fixture:'major-flight',offset:12},
    {id:'biome3',label:'moss',fixture:'tower',offset:12},
    {id:'biome4',label:'frost',fixture:'later-biome',offset:12},
    {id:'biome5',label:'aurora',fixture:'apex',offset:12},
    {id:'danger',label:'natural danger',fixture:'natural',offset:natural.danger},
    {id:'flight',label:'natural flight',fixture:'natural',offset:natural.flightFrame},
    {id:'towerAnticipation',label:'natural lock',fixture:'natural',offset:natural.approach},
    {id:'towerImpact',label:'natural hit',fixture:'natural',offset:natural.hitFrame},
    {id:'towerRecovery',label:'natural recovery',fixture:'natural',offset:natural.recovery},
    {id:'landingForecast',label:'landing forecast',fixture:'natural',offset:natural.landingForecast},
    {id:'landingCommit',label:'landing commit',fixture:'natural',offset:natural.landingCommit},
    {id:'touchdown',label:'guided touchdown',fixture:'natural',offset:natural.landingFrame},
    {id:'landingAftermath',label:'landing aftermath',fixture:'natural',offset:natural.landingAftermath},
    {id:'apex',label:'apex',fixture:'apex',offset:24}
  ];
  const frames=Object.fromEntries(beats.map(beat=>[beat.id,cell(beat.fixture,beat.offset)]));
  const biomes=beats.filter(beat=>beat.id.startsWith('biome')).map(beat=>{
    const probe=frames[beat.id].probe;return{key:probe.biome+':'+probe.hillFamily,biome:probe.biome,family:probe.hillFamily,beat:beat.id};
  });
  const all=[];
  for(const[fixture,frameMap]of Object.entries(runs))for(const[offset,frame]of frameMap)all.push({fixture,offset,frame});
  const impactOffsets=[Math.max(natural.approach,natural.hitFrame-24),Math.max(natural.approach,natural.hitFrame-6),natural.hitFrame,
    Math.min(3600,natural.hitFrame+12),Math.min(3600,natural.hitFrame+36)];
  return{runs,beats,frames,biomes,all,natural,
    characterFrames:[1,3,5,7].map(offset=>runs.momentum.get(offset)),
    impactFrames:impactOffsets.map(offset=>runs.natural.get(offset))};
}

async function loadOldFrame(receipt){
  const encoded=Buffer.from(receipt.base64,'base64');
  if(sha256(encoded)!==receipt.sha256)throw new Error('legacy receipt hash mismatch: '+receipt.id);
  const image=await loadImage(encoded);
  if(image.width!==receipt.width||image.height!==receipt.height)
    throw new Error(`legacy receipt dimensions changed: ${receipt.id} is ${image.width}x${image.height}`);
  const canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');
  ctx.imageSmoothingEnabled=false;ctx.drawImage(image,0,0);
  return toNativeFrame(rgbaFrame(canvas.data(),canvas.width,canvas.height,{source:'embedded:'+receipt.id}));
}

function fixedCrop(frame,box,size){
  size=size||32;
  const source=toNativeFrame(frame),cx=Math.round(box.x+box.width/2),cy=Math.round(box.y+box.height/2);
  const out=Buffer.alloc(size*size*4),left=cx-Math.floor(size/2),top=cy-Math.floor(size/2);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const sx=left+x,sy=top+y,dst=(y*size+x)*4;
    if(sx<0||sy<0||sx>=source.width||sy>=source.height){out[dst+3]=255;continue;}
    const src=(sy*source.width+sx)*4;out[dst]=source.rgba[src];out[dst+1]=source.rgba[src+1];out[dst+2]=source.rgba[src+2];out[dst+3]=source.rgba[src+3];
  }
  return rgbaFrame(out,size,size,{frame:frame.frame});
}

function allPairs(values,fn){
  const out=[];for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++)out.push(fn(values[i],values[j],i,j));return out;
}

function analyzeAlignedBurst(frames){
  const differences=[];
  for(let i=1;i<frames.length;i++)differences.push(frameDifference(frames[i-1],frames[i],{native:false}));
  return{
    frames:frames.length,differences,
    changedFraction:{
      min:Math.min(...differences.map(value=>value.changedFraction)),
      median:median(differences.map(value=>value.changedFraction)),
      max:Math.max(...differences.map(value=>value.changedFraction))
    },
    firstLast:frameDifference(frames[0],frames.at(-1),{native:false})
  };
}

async function main(){
  if(fs.existsSync(FRAME_DIR))for(const file of fs.readdirSync(FRAME_DIR))
    if(file.endsWith('.png'))fs.unlinkSync(path.join(FRAME_DIR,file));
  fs.mkdirSync(FRAME_DIR,{recursive:true});
  const evidence=buildCandidateEvidence(),repeat=buildCandidateEvidence();
  const{beats,frames:candidateByBeat,biomes,characterFrames,impactFrames,natural}=evidence;
  const determinismRows=evidence.all.map(value=>{
    const other=repeat.runs[value.fixture].get(value.offset),a=sha256(value.frame.rgba),b=sha256(other.rgba);
    return{fixture:value.fixture,offset:value.offset,a,b,ok:a===b};
  });
  const deterministic=determinismRows.every(value=>value.ok);

  const refFrames=beats.map((_,index)=>60+index*600);
  const horizon=captureTimeline('horizon',0xa1020401,refFrames);
  const blockmine=captureTimeline('blockmine',0xb10c0050,refFrames);
  const old=await Promise.all(OLD_TOPPLE_RECEIPTS.map(loadOldFrame));

  const horizonByBeat={},blockmineByBeat={},oldByBeat={};
  beats.forEach((beat,index)=>{
    horizonByBeat[beat.id]=horizon.get(refFrames[index]);
    blockmineByBeat[beat.id]=blockmine.get(refFrames[index]);
    oldByBeat[beat.id]=old[Math.min(old.length-1,Math.floor(index*old.length/beats.length))];
    fs.writeFileSync(path.join(FRAME_DIR,`${String(index+1).padStart(2,'0')}-${beat.id}.png`),encodeRgbaPng(candidateByBeat[beat.id]));
  });
  const sheet=writeContactSheet({
    beats:beats.map(beat=>({id:beat.id,label:beat.label})),
    rows:[
      {label:'OLD TOPPLE',frames:oldByBeat},
      {label:'WINGRUSH',frames:candidateByBeat},
      {label:'MACHINE HUNT',frames:horizonByBeat},
      {label:'BLOCK MINE',frames:blockmineByBeat}
    ],outPath:CONTACT_PATH
  });

  const candidateMetrics=Object.fromEntries(beats.map(beat=>[beat.id,analyzeFrame(candidateByBeat[beat.id],{native:false,crop:WORLD_CROP})]));
  const horizonMetrics=beats.map(beat=>analyzeFrame(horizonByBeat[beat.id],{native:false,crop:WORLD_CROP}));
  const blockmineMetrics=beats.map(beat=>analyzeFrame(blockmineByBeat[beat.id],{native:false,crop:WORLD_CROP}));
  const oldMetrics=beats.map(beat=>analyzeFrame(oldByBeat[beat.id],{native:false,crop:WORLD_CROP}));
  const biomeFrames=beats.filter(beat=>beat.id.startsWith('biome')).map(beat=>candidateByBeat[beat.id]);
  const biomePairs=allPairs(biomeFrames,(a,b,i,j)=>({
    a:biomes[i].key,b:biomes[j].key,
    structure:structureDistance(a,b,{crop:WORLD_CROP}),
    skyline:skylineDistance(extractSkyline(a,{crop:{x:0,y:180,width:160,height:175}}),extractSkyline(b,{crop:{x:0,y:180,width:160,height:175}}))
  }));

  const characterBoxes=characterFrames.map(frame=>frame.probe&&frame.probe.playerBox);
  const characterCrops=characterBoxes.every(box=>box&&box.width>0&&box.height>0)
    ?characterFrames.map((frame,index)=>fixedCrop(frame,characterBoxes[index],36)):[];
  const characterBurst=characterCrops.length?analyzeAlignedBurst(characterCrops):null;
  const impactBurst=analyzeBurst(impactFrames,{native:false,crop:WORLD_CROP});
  const anticipationImpact=frameDifference(candidateByBeat.towerAnticipation,candidateByBeat.towerImpact,{native:false,crop:WORLD_CROP});
  const impactRecovery=frameDifference(candidateByBeat.towerImpact,candidateByBeat.towerRecovery,{native:false,crop:WORLD_CROP});
  const routeMetric=analyzeFrame(candidateByBeat.towerAnticipation,{native:false,crop:ROUTE_CROP});
  const actorLayers=[1,3,5,7].map(offset=>measureFixtureLayer('momentum',offset,'__HIDE_BIRD')),
    fortLayers=[0,1,2,3,4].map(type=>measureFixtureLayer(`fort-scale-${type}`,1,'__HIDE_FORTS')),
    fortVisibility=measureNaturalFortVisibility(NATURAL_SEED,natural),
    landingForecastCommit=frameDifference(candidateByBeat.landingForecast,candidateByBeat.landingCommit,{native:false,crop:WORLD_CROP}),
    landingCommitTouchdown=frameDifference(candidateByBeat.landingCommit,candidateByBeat.touchdown,{native:false,crop:WORLD_CROP}),
    landingAftermath=frameDifference(candidateByBeat.touchdown,candidateByBeat.landingAftermath,{native:false,crop:WORLD_CROP});

  const gates=[];
  const gate=(name,ok,detail)=>gates.push({name,ok:!!ok,detail});
  gate('same-seed real pixels deterministic',deterministic,determinismRows);
  gate('four distinct biome/hill identities',new Set(biomes.map(value=>value.biome)).size>=4&&new Set(biomes.map(value=>value.key)).size>=4,biomes.map(value=>value.key));
  const cm=Object.values(candidateMetrics),refEdge=Math.min(median(horizonMetrics.map(m=>m.edge[1].energy)),median(blockmineMetrics.map(m=>m.edge[1].energy)));
  const refRich=Math.min(median(horizonMetrics.map(m=>m.richCellFraction)),median(blockmineMetrics.map(m=>m.richCellFraction)));
  // Floors below are taken from the current measured candidate with margin:
  // colors 148+, entropy 3.24+, luma deviation .116+, largest share <=.338.
  gate('frames are opaque and non-flat',cm.every(m=>m.opaqueFraction===1&&m.quantizedColors>=100&&m.colorEntropy>=2.5&&m.lumaStdDev>=.08&&m.largestColorShare<=.55),
    cm.map(m=>({colors:m.quantizedColors,entropy:m.colorEntropy,lumaStdDev:m.lumaStdDev,largest:m.largestColorShare})));
  gate('multiscale edge detail meets reference floor',cm.every(m=>m.edge[1].energy>=Math.max(.003,refEdge*.85)&&m.edge[4].energy>m.edge[1].energy),
    {candidate:cm.map(m=>m.edge),referenceFloor:refEdge});
  gate('spatial richness meets reference floor',cm.every(m=>m.richCellFraction>=.35)&&median(cm.map(m=>m.richCellFraction))>=Math.max(.48,refRich),
    {candidateMedian:median(cm.map(m=>m.richCellFraction)),referenceFloor:refRich});
  // Aligned 36px crops measured .307-.336 adjacent-frame change and .626
  // first-to-last; the band catches both a frozen token and a full-frame swap.
  gate('character has aligned temporal animation',!!characterBurst&&characterBurst.changedFraction.median>=.15&&characterBurst.changedFraction.max<=.70&&characterBurst.firstLast.changedFraction>=.30,
    characterBurst||'playerBox missing from __wingrushProbe()');
  const declaredBodies=characterFrames.map(frame=>frame.probe&&frame.probe.bodyBox),maxActorPixels=Math.max(...actorLayers.map(value=>value.pixels)),maxFortPixels=Math.max(...fortLayers.map(value=>value.pixels));
  gate('Courier Finch body obeys the standard actor cap and cloth stays compact',declaredBodies.every(box=>box&&box.width<=20&&box.height<=32)&&
    actorLayers.every(value=>value.bounds&&value.bounds.width<=32&&value.bounds.height<=32&&value.pixels>=20),{declaredBodies,rendered:actorLayers});
  gate('all five recurring fort rigs obey the WINGRUSH set-piece cap',fortLayers.every(value=>value.bounds&&value.bounds.width<=40&&value.bounds.height<=65&&value.pixels>=30),fortLayers);
  gate('combined actor and fort footprint leaves most of the portrait as world',(maxActorPixels+maxFortPixels)/(WORLD_CROP.width*WORLD_CROP.height)<.10,
    {actorPixels:maxActorPixels,fortPixels:maxFortPixels,fraction:(maxActorPixels+maxFortPixels)/(WORLD_CROP.width*WORLD_CROP.height)});
  const expectedBiomePairs=biomeFrames.length*(biomeFrames.length-1)/2,requiredDifferentPairs=Math.ceil(expectedBiomePairs*.67);
  gate('biomes change structure, not only palette',biomePairs.length===expectedBiomePairs&&median(biomePairs.map(pair=>pair.structure.structureDistance))>=.35&&biomePairs.filter(pair=>pair.structure.structureDistance>=.25).length>=requiredDifferentPairs,
    biomePairs.map(pair=>({a:pair.a,b:pair.b,distance:pair.structure.structureDistance})));
  gate('hill silhouettes materially vary',biomePairs.length===expectedBiomePairs&&median(biomePairs.map(pair=>pair.skyline.shapeRms))>=15&&biomePairs.filter(pair=>pair.skyline.shapeRms>=8).length>=requiredDifferentPairs,
    biomePairs.map(pair=>({a:pair.a,b:pair.b,...pair.skyline})));
  const approachProbe=candidateByBeat.towerAnticipation.probe,impactProbe=candidateByBeat.towerImpact.probe;
  gate('natural autoplay hits a selected sky fort promptly',natural.hitFrame<=720&&impactProbe.targetHits>approachProbe.targetHits,
    {sequence:natural,approach:approachProbe,impact:impactProbe});
  gate('natural target lock telegraphs intent for three seconds',natural.leadFrames>=180&&natural.approach<natural.hitFrame,
    {lockFrame:natural.lockFrame,approach:natural.approach,hitFrame:natural.hitFrame,leadFrames:natural.leadFrames});
  gate('the actual rendered fort occupies most of the airborne attack',fortVisibility.fraction>=.55&&fortVisibility.firstMaterial>=natural.launchFrame&&fortVisibility.firstMaterial<natural.hitFrame,
    fortVisibility);
  gate('bottom route ribbon is rendered information, not a flat bar',routeMetric.quantizedColors>=8&&routeMetric.colorEntropy>=1&&routeMetric.edge[1].energy>=.01&&routeMetric.lumaStdDev>=.05,routeMetric);
  gate('natural sky-fort impact has visible spatial payoff',impactBurst.changedFraction.max>=.14&&impactBurst.meanDelta.max>=.02&&impactBurst.changedGridFraction.max>=.45&&impactBurst.firstLast.structureDistance>=.28,
    {impactBurst,anticipationImpact});
  gate('natural sky-fort recovery is visually distinct',impactRecovery.changedFraction>=.12&&impactRecovery.changedGridFraction>=.45,impactRecovery);
  const forecastProbe=candidateByBeat.landingForecast.probe,commitProbe=candidateByBeat.landingCommit.probe,touchProbe=candidateByBeat.touchdown.probe;
  gate('natural landing forecast remains truthful through touchdown',natural.landingFrame-natural.hitFrame<=480&&natural.landingError<=40&&
    forecastProbe.landing&&commitProbe.landing&&Math.abs(forecastProbe.landing.x-commitProbe.landing.x)<=60&&touchProbe.guidedLandings>commitProbe.guidedLandings,
    {sequence:natural,forecast:forecastProbe.landing,commit:commitProbe.landing,touchdown:{x:touchProbe.x,guided:touchProbe.guidedLandings}});
  // Natural touchdown is a precise contact beat rather than an apex: the final
  // candidate measured .041 changed pixels / .378 grid spread, while the 18f
  // follow-through measured .098 / .467. Margins still reject a frozen token.
  gate('guided touchdown and aftermath are visibly staged',landingCommitTouchdown.changedFraction>=.035&&landingCommitTouchdown.changedGridFraction>=.30&&
    landingAftermath.changedFraction>=.05&&landingAftermath.changedGridFraction>=.20,{landingForecastCommit,landingCommitTouchdown,landingAftermath});
  const flightProbe=candidateByBeat.flight.probe;
  gate('major flight checkpoint is truthful',flightProbe&&flightProbe.airborne&&(flightProbe.airHeight>=24||flightProbe.majorFlights>0),flightProbe);
  gate('candidate numeric richness is reference-comparable',
    median(cm.map(m=>m.edge[1].energy))>=refEdge*.75&&median(cm.map(m=>m.richCellFraction))>=refRich*.75,
    {candidateEdge:median(cm.map(m=>m.edge[1].energy)),referenceEdge:refEdge,candidateRich:median(cm.map(m=>m.richCellFraction)),referenceRich:refRich});

  const automatedOk=gates.every(value=>value.ok);
  const review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256,preservedPath:PRESERVED_CONTACT_PATH});
  gate('fresh semantic comparison receipt',review.ok,review.errors);
  const report={
    schema:2,game:'wingrush',seed:'0x'+SEED.toString(16),naturalSeed:'0x'+NATURAL_SEED.toString(16),naturalSequence:natural,
    contactSheet:{path:CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{fixture:beat.fixture,offset:beat.offset,probe:candidateByBeat[beat.id].probe}])),
    thresholds:{worldCrop:WORLD_CROP,routeCrop:ROUTE_CROP,referenceEdgeFloor:refEdge,referenceRichFloor:refRich},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,oldTopple:oldMetrics,characterBurst,actorLayers,fortLayers,fortVisibility,
      biomePairs,impactBurst,anticipationImpact,impactRecovery,routeMetric,landingForecastCommit,landingCommitTouchdown,landingAftermath},
    gates,automatedOk,semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
  };
  writeJson(METRICS_PATH,report);

  console.log(`WINGRUSH visual evidence · seed 0x${SEED.toString(16)}`);
  console.log(`  natural 0x${NATURAL_SEED.toString(16)} lock ${natural.lockFrame} -> hit ${natural.hitFrame} (${natural.leadFrames}f)`);
  for(const value of gates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log('  contact:',CONTACT_PATH);
  console.log('  montage sha256:',sheet.sha256);
  console.log('  metrics:',METRICS_PATH);
  if(!gates.every(value=>value.ok)){
    console.error('\nWINGRUSH VISUAL EVAL FAILED');
    process.exit(1);
  }
  console.log('\nWINGRUSH VISUAL EVAL PASSED');
}

main().catch(error=>{console.error('WINGRUSH VISUAL EVAL FAILED:',error.stack||error);process.exit(1);});
