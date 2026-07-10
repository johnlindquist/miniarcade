#!/usr/bin/env node
'use strict';

// NEON GETAWAY real-pixel release gate. Behavioral truth lives in
// neon-getaway-eval.js; this suite stages deterministic authored visual beats,
// renders the real canvas at the native 160x360 viewer size, and measures the
// resulting RGBA. A separate hashed semantic receipt must approve what pixel
// statistics cannot judge against MACHINE HUNT and BLOCK MINE.
const fs=require('fs');
const path=require('path');
const{
  bootRenderedGame,rgbaFrame,encodeRgbaPng
}=require('../render/runtime');
const{
  sha256,toNativeFrame,analyzeFrame,frameDifference,structureDistance,analyzeBurst,
  writeContactSheet,verifyReviewReceipt,writeJson,quantile
}=require('./visual-harness');

const ROOT=path.join(__dirname,'..');
const GAME_PATH=path.join(__dirname,'..','neon-getaway.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','neon-getaway');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','neon-getaway.json');
const SEED=0x4e454f4e,PRE_ROLL=120,RENDER_EVERY=2;
const WORLD_CROP={x:0,y:38,width:160,height:322};

if(!fs.existsSync(GAME_PATH)){
  console.error('NEON GETAWAY VISUAL EVAL FAILED: missing '+GAME_PATH);
  process.exit(1);
}

const median=values=>quantile(values,.5);
const visible=(box,crop)=>!!box&&box.x<crop.x+crop.width&&box.x+box.width>crop.x&&
  box.y<crop.y+crop.height&&box.y+box.height>crop.y;

function visualProbe(runtime){
  const visualFn=runtime.sandbox.__neonGetawayVisualProbe,fullFn=runtime.sandbox.__neonGetawayProbe;
  if(typeof visualFn!=='function'||typeof fullFn!=='function')
    throw new Error('neon-getaway.html must expose __neonGetawayVisualProbe() and __neonGetawayProbe()');
  const value=visualFn(),full=fullFn();
  if(!value||value.finite===false||!full||full.finite===false)
    throw new Error('neon-getaway visual fixture produced non-finite state');
  const decoyBoxes=runtime.evaluate("decoys.map(d=>({x:d.x-15,y:sy(d.y)-19,width:30,height:38,kind:d.kind,ghost:!!d.ghost}))");
  const policeBoxes=Array.from(value.policeBoxes||[]);
  return Object.assign({},value,{
    playerKind:full.player.kind,playerZ:full.player.z,playerSpeed:full.player.speed,
    show:full.show,actType:full.act.type,decoyBoxes:Array.from(decoyBoxes||[]),
    visiblePoliceCount:policeBoxes.filter(box=>visible(box,WORLD_CROP)).length,
    visibleDecoyCount:Array.from(decoyBoxes||[]).filter(box=>visible(box,WORLD_CROP)).length
  });
}

function captureFixture(name,offsets,options){
  options=options||{};
  const runtime=bootRenderedGame('neon-getaway',{seed:SEED});
  if(options.beforeSet)options.beforeSet(runtime);
  const setBeat=runtime.sandbox.__neonGetawaySetVisualBeat;
  if(typeof setBeat!=='function')throw new Error('neon-getaway.html must expose __neonGetawaySetVisualBeat(name)');
  if(setBeat(name)!==true)throw new Error('unknown Neon Getaway visual beat: '+name);
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

function fixedCrop(input,box,width,height){
  width=width||48;height=height||56;
  const source=toNativeFrame(input),cx=Math.round(box.x+box.width/2),cy=Math.round(box.y+box.height/2);
  const out=Buffer.alloc(width*height*4),left=cx-Math.floor(width/2),top=cy-Math.floor(height/2);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=left+x,sy=top+y,dst=(y*width+x)*4;
    if(sx<0||sy<0||sx>=source.width||sy>=source.height){out[dst+3]=255;continue;}
    const src=(sy*source.width+sx)*4;
    out[dst]=source.rgba[src];out[dst+1]=source.rgba[src+1];out[dst+2]=source.rgba[src+2];out[dst+3]=source.rgba[src+3];
  }
  return rgbaFrame(out,width,height,{frame:input.frame,fixture:input.fixture,offset:input.offset});
}

function analyzeAlignedBurst(frames,boxFor,width,height){
  const crops=[];
  for(const frame of frames){
    const box=boxFor(frame);
    if(!box||!(box.width>0&&box.height>0))return null;
    crops.push(fixedCrop(frame,box,width,height));
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
    changedGridMax:Math.max(...differences.map(value=>value.changedGridFraction)),
    firstLast:frameDifference(crops[0],crops.at(-1),{native:false})
  };
}

function allPairs(values,fn){
  const out=[];
  for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++)out.push(fn(values[i],values[j],i,j));
  return out;
}

function buildCandidateEvidence(){
  const specs={
    opening:{fixture:'opening',offsets:[1,6,12,24]},
    street:{fixture:'street-chase',offsets:[1,3,5,7,9,13,24]},
    alley:{fixture:'alley',offsets:[1,6,12,24]},
    ramp:{fixture:'ramp',offsets:[1,6,12,24,36,48]},
    swapAnticipation:{fixture:'swap-anticipation',offsets:[1,6,12,24]},
    swapPayoff:{fixture:'swap-payoff',offsets:[1,6,12,18,24,36,47]},
    later:{fixture:'later-district',offsets:[1,6,12,24]},
    warning:{fixture:'dragnet',offsets:[1,6,12,24]},
    warningCalm:{fixture:'dragnet',offsets:[12],afterSet:runtime=>runtime.evaluate("act.phase='calm'")},
    dragnetLand:{fixture:'dragnet-land',offsets:[1,6,12,24]},
    danger:{fixture:'danger',offsets:[1,3,5,7,9,13,24]},
    apex:{fixture:'escape-apex',offsets:[1,6,12,24,48]},
    apexNoFx:{fixture:'escape-apex',offsets:[1,6,12,24,48],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}}
  };
  const runs={};
  for(const[id,spec]of Object.entries(specs))
    runs[id]=captureFixture(spec.fixture,spec.offsets,{id,beforeSet:spec.beforeSet,afterSet:spec.afterSet});
  const beats=[
    {id:'opening',label:'opening',run:'opening',offset:12},
    {id:'street',label:'street chase',run:'street',offset:13},
    {id:'alley',label:'market alley',run:'alley',offset:12},
    {id:'ramp',label:'port ramp',run:'ramp',offset:12},
    {id:'swapReady',label:'swap ready',run:'swapAnticipation',offset:12},
    {id:'swap',label:'swap payoff',run:'swapPayoff',offset:12},
    {id:'later',label:'civic crown',run:'later',offset:12},
    {id:'warning',label:'dragnet warning',run:'warning',offset:12},
    {id:'land',label:'dragnet land',run:'dragnetLand',offset:12},
    {id:'danger',label:'five star',run:'danger',offset:13},
    {id:'apex',label:'five star fade',run:'apex',offset:6}
  ];
  const frames=Object.fromEntries(beats.map(beat=>[beat.id,runs[beat.run].get(beat.offset)]));
  const all=[];
  for(const[id,frameMap]of Object.entries(runs))for(const[offset,frame]of frameMap)all.push({id,offset,frame});
  return{specs,runs,beats,frames,all};
}

function reviewTemplate(montageSha256){
  const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});
  return{
    schema:1,game:'neon-getaway',verdict:'pending',references:['horizon','blockmine'],montageSha256,
    reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size reference review',
    categories:{
      characterCraft:pending('Inspect the wheelman, five getaway vehicles, police cruiser/interceptor/bike/van, traffic, pedestrians, swap driver, facing, body roll, sirens, damage, and reaction poses at 160x360.'),
      environmentCraft:pending('Inspect each district with the HUD mentally removed: road material, alleys, roofs, market awnings, canal water and bridges, port rails and crane, civic roundabout, foreground lights, traffic, and depth planes.'),
      levelVariety:pending('Confirm the five districts change spatial landmarks, road grammar, material silhouette, hazards, and composition rather than only palette and facade texture.'),
      animationImpact:pending('Confirm aligned vehicle and police crops animate, the ramp has takeoff/apex/landing, the swap stages old car to driver to new car, the dragnet warning lands physically, and the five-star fade has visible pursuit redirection plus FX.'),
      readability:pending('Confirm wanted escalation, visible police count, route intent, alley/ramp/swap targets, warning safe line, player silhouette, and apex remain legible beside video at native size.'),
      artDirectionCohesion:pending('Confirm neon-noir palette, pixel construction, HUD, district materials, vehicle lighting, pursuit grammar, and payoff language feel like one authored city.')
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
  const deterministic=determinism.every(value=>value.ok),{beats,frames:candidate,runs}=evidence;

  const referenceTargets=[60,600,1200,2400,3600,5400,7200,9000,12000,15000,18000];
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
      {label:'NEON GETAWAY',frames:candidate},
      {label:'MACHINE HUNT',frames:horizonByBeat},
      {label:'BLOCK MINE',frames:blockmineByBeat}
    ],outPath:CONTACT_PATH
  });

  const candidateMetrics=Object.fromEntries(beats.map(beat=>[beat.id,analyzeFrame(candidate[beat.id],{native:false,crop:WORLD_CROP})]));
  const horizonMetrics=beats.map(beat=>analyzeFrame(horizonByBeat[beat.id],{native:false,crop:WORLD_CROP}));
  const blockmineMetrics=beats.map(beat=>analyzeFrame(blockmineByBeat[beat.id],{native:false,crop:WORLD_CROP}));
  const cm=Object.values(candidateMetrics);
  const ref={
    edge:Math.max(median(horizonMetrics.map(value=>value.edge[1].energy)),median(blockmineMetrics.map(value=>value.edge[1].energy))),
    rich:Math.max(median(horizonMetrics.map(value=>value.richCellFraction)),median(blockmineMetrics.map(value=>value.richCellFraction))),
    entropy:Math.max(median(horizonMetrics.map(value=>value.colorEntropy)),median(blockmineMetrics.map(value=>value.colorEntropy))),
    luma:Math.max(median(horizonMetrics.map(value=>value.lumaStdDev)),median(blockmineMetrics.map(value=>value.lumaStdDev)))
  };

  const playerBurst=analyzeAlignedBurst([1,3,5,7,9,13,24].map(offset=>runs.street.get(offset)),
    frame=>frame.probe.playerBox,48,56);
  const policeBurst=analyzeAlignedBurst([1,3,5,7,9,13,24].map(offset=>runs.danger.get(offset)),
    frame=>frame.probe.policeBoxes&&frame.probe.policeBoxes[0],48,56);
  const swapBurst=analyzeAlignedBurst([1,6,12,18,24,36,47].map(offset=>runs.swapPayoff.get(offset)),frame=>{
    const box=frame.probe.playerBox;
    return box&&{x:box.x-26,y:box.y-14,width:box.width+52,height:box.height+28};
  },92,76);

  const districtBeats=['opening','alley','ramp','swapReady','later'];
  const districtFrames=districtBeats.map(id=>candidate[id]);
  const districtPairs=allPairs(districtFrames,(a,b,i,j)=>({
    a:candidate[districtBeats[i]].probe.district,b:candidate[districtBeats[j]].probe.district,
    structure:structureDistance(a,b,{crop:WORLD_CROP})
  }));
  const warningContrast=frameDifference(runs.warningCalm.get(12),runs.warning.get(12),{native:false,crop:WORLD_CROP});
  const warningLand=frameDifference(runs.warning.get(12),runs.dragnetLand.get(12),{native:false,crop:WORLD_CROP});
  const rampBurst=analyzeBurst([1,6,12,24,36,48].map(offset=>runs.ramp.get(offset)),{native:false,crop:WORLD_CROP});
  const apexFx=frameDifference(runs.apexNoFx.get(12),runs.apex.get(12),{native:false,crop:WORLD_CROP,threshold:1});
  const playerBox=runs.apex.get(12).probe.playerBox;
  const apexCrop={
    x:Math.max(0,playerBox.x-36),y:Math.max(WORLD_CROP.y,playerBox.y-34),
    width:Math.min(160,playerBox.x+playerBox.width+36)-Math.max(0,playerBox.x-36),
    height:Math.min(360,playerBox.y+playerBox.height+34)-Math.max(WORLD_CROP.y,playerBox.y-34)
  };
  const apexFxNear=frameDifference(runs.apexNoFx.get(12),runs.apex.get(12),{native:false,crop:apexCrop,threshold:1});
  const apexPhysical=frameDifference(runs.danger.get(13),runs.apexNoFx.get(12),{native:false,crop:WORLD_CROP});
  const apexStructure=structureDistance(runs.danger.get(13),runs.apexNoFx.get(12),{crop:WORLD_CROP});
  const apexBurst=analyzeBurst([1,6,12,24,48].map(offset=>runs.apex.get(offset)),{native:false,crop:WORLD_CROP});

  // Locked-candidate calibration, seed 0x4e454f4e. Across the eleven approved
  // fixture cells the measured minima were 133 colors / 3.515 entropy / .124
  // luma deviation / .0242 one-pixel edge energy / .956 rich cells, with a
  // .322 largest-color maximum. Floors retain roughly 12-18% regression margin.
  const bands={
    colors:115,entropy:3.10,lumaStdDev:.105,largestColorShare:.38,
    edgeEnergy:.0205,richEach:.82,richMedian:.88,
    playerMedian:.12,playerFirstLast:.24,playerGrid:.75,
    policeMedian:.20,policeFirstLast:.52,policeGrid:.75,
    swapMedian:.08,swapMax:.09,swapFirstLast:.22,swapGrid:.55,
    districtMedian:.35,districtEach:.28,
    warningChanged:.85,warningMean:.075,warningGrid:.90,warningBounds:.90,
    landChanged:.85,landMean:.08,landGrid:.90,landBounds:.90,
    apexPhysicalChanged:.65,apexPhysicalStructure:.34,
    apexFxChanged:.0022,apexFxMean:.0008,apexFxBounds:.030,
    apexNearChanged:.011,apexNearMean:.0042,apexNearGrid:.11,apexNearBounds:.15
  };

  const automatedGates=[];
  const gate=(name,ok,detail)=>automatedGates.push({name,ok:!!ok,detail});
  gate('same-seed real pixels deterministic',deterministic,determinism);
  gate('all requested fixtures are finite and truthful',beats.every(beat=>candidate[beat.id].probe&&candidate[beat.id].probe.finite!==false),
    beats.map(beat=>({beat:beat.id,probe:candidate[beat.id].probe})));
  gate('frames are opaque and non-flat',cm.every(value=>value.opaqueFraction===1&&value.quantizedColors>=bands.colors&&
    value.colorEntropy>=bands.entropy&&value.lumaStdDev>=bands.lumaStdDev&&value.largestColorShare<=bands.largestColorShare),
    cm.map(value=>({colors:value.quantizedColors,entropy:value.colorEntropy,lumaStdDev:value.lumaStdDev,largest:value.largestColorShare})));
  gate('multiscale edge detail holds its measured floor',cm.every(value=>value.edge[1].energy>=bands.edgeEnergy&&value.edge[4].energy>value.edge[1].energy),
    cm.map(value=>value.edge));
  gate('spatial richness holds its measured floor',cm.every(value=>value.richCellFraction>=bands.richEach)&&
    median(cm.map(value=>value.richCellFraction))>=bands.richMedian,
    {values:cm.map(value=>value.richCellFraction),median:median(cm.map(value=>value.richCellFraction))});
  gate('wheelman vehicle has aligned temporal animation',!!playerBurst&&playerBurst.changedFraction.median>=bands.playerMedian&&
    playerBurst.firstLast.changedFraction>=bands.playerFirstLast&&playerBurst.firstLast.changedGridFraction>=bands.playerGrid&&
    playerBurst.changedFraction.max<=.65,playerBurst);
  gate('police vehicle has aligned pursuit and siren animation',!!policeBurst&&policeBurst.changedFraction.median>=bands.policeMedian&&
    policeBurst.firstLast.changedFraction>=bands.policeFirstLast&&policeBurst.firstLast.changedGridFraction>=bands.policeGrid&&
    policeBurst.changedFraction.max<=.80,policeBurst);
  const swapFirst=runs.swapPayoff.get(1).probe,swapLast=runs.swapPayoff.get(47).probe;
  gate('vehicle swap has aligned old-car driver new-car choreography',!!swapBurst&&swapBurst.changedFraction.median>=bands.swapMedian&&
    swapBurst.changedFraction.max>=bands.swapMax&&swapBurst.firstLast.changedFraction>=bands.swapFirstLast&&
    swapBurst.firstLast.changedGridFraction>=bands.swapGrid&&swapFirst.playerKind==='coupe'&&swapLast.playerKind==='taxi'&&
    swapFirst.escapeSerial===0&&swapLast.escapeSerial===0,{swapBurst,first:swapFirst,last:swapLast});
  gate('five districts change structure, not only palette',new Set(districtBeats.map(id=>candidate[id].probe.district)).size===5&&
    median(districtPairs.map(pair=>pair.structure.structureDistance))>=bands.districtMedian&&
    districtPairs.every(pair=>pair.structure.structureDistance>=bands.districtEach),districtPairs);
  const ramp1=runs.ramp.get(1).probe,ramp12=runs.ramp.get(12).probe,ramp24=runs.ramp.get(24).probe,ramp48=runs.ramp.get(48).probe;
  gate('ramp checkpoint is a truthful takeoff apex landing arc',ramp1.airborne&&ramp12.airborne&&ramp24.airborne&&
    ramp12.playerZ>=16&&!ramp48.airborne&&ramp48.playerZ===0&&ramp12.tactic==='HIT THE RAMP'&&visible(ramp12.rampBox,WORLD_CROP)&&
    rampBurst.changedFraction.max>=.25,{ramp1,ramp12,ramp24,ramp48,rampBurst});
  gate('dragnet warning is visibly distinct from identical calm state',warningContrast.changedFraction>=bands.warningChanged&&
    warningContrast.meanDelta>=bands.warningMean&&warningContrast.changedGridFraction>=bands.warningGrid&&
    warningContrast.changedBoundsFraction>=bands.warningBounds&&visible(runs.warning.get(12).probe.roadblockBox,WORLD_CROP),warningContrast);
  const landProbe=runs.dragnetLand.get(12).probe;
  gate('dragnet land is a physical formation, not only a tint',warningLand.changedFraction>=bands.landChanged&&
    warningLand.meanDelta>=bands.landMean&&warningLand.changedGridFraction>=bands.landGrid&&
    warningLand.changedBoundsFraction>=bands.landBounds&&landProbe.act==='live'&&landProbe.visiblePoliceCount>=3&&
    visible(landProbe.roadblockBox,WORLD_CROP),{warningLand,probe:landProbe});
  gate('wanted escalation is visible on the native strip',candidate.opening.probe.visiblePoliceCount===1&&
    candidate.street.probe.visiblePoliceCount>=3&&candidate.danger.probe.visiblePoliceCount>=4,
    {opening:candidate.opening.probe.policeBoxes,street:candidate.street.probe.policeBoxes,danger:candidate.danger.probe.policeBoxes});
  const apexProbe=runs.apex.get(12).probe;
  gate('five-star fade has physical actors beyond payoff FX',apexPhysical.changedFraction>=bands.apexPhysicalChanged&&
    apexStructure.structureDistance>=bands.apexPhysicalStructure&&apexProbe.escapeSerial===1&&apexProbe.wanted===1&&
    apexProbe.visiblePoliceCount>=3&&apexProbe.visibleDecoyCount>=1&&apexProbe.show&&apexProbe.show.active&&
    apexProbe.show.active.tier===3,{apexPhysical,apexStructure,probe:apexProbe});
  gate('five-star payoff FX land on the physical escape actors',apexFx.changedFraction>=bands.apexFxChanged&&
    apexFx.meanDelta>=bands.apexFxMean&&apexFx.changedBoundsFraction>=bands.apexFxBounds&&
    apexFxNear.changedFraction>=bands.apexNearChanged&&apexFxNear.meanDelta>=bands.apexNearMean&&
    apexFxNear.changedGridFraction>=bands.apexNearGrid&&apexFxNear.changedBoundsFraction>=bands.apexNearBounds,
    {apexFx,apexFxNear,apexCrop,apexBurst});
  gate('candidate numeric richness meets both reference medians',median(cm.map(value=>value.edge[1].energy))>=ref.edge*.95&&
    median(cm.map(value=>value.richCellFraction))>=ref.rich*.95&&median(cm.map(value=>value.colorEntropy))>=ref.entropy*.95&&
    median(cm.map(value=>value.lumaStdDev))>=ref.luma*.90,
    {candidate:{edge:median(cm.map(value=>value.edge[1].energy)),rich:median(cm.map(value=>value.richCellFraction)),
      entropy:median(cm.map(value=>value.colorEntropy)),luma:median(cm.map(value=>value.lumaStdDev))},reference:ref});

  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256));
  let review;
  if(fs.existsSync(REVIEW_PATH))review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256});
  else review={ok:false,errors:[`missing committed semantic review: ${REVIEW_PATH}`,`inspect ${CONTACT_PATH}, then copy and complete ${REVIEW_TEMPLATE_PATH}`]};
  const semanticGate={name:'fresh semantic comparison receipt',ok:review.ok,detail:review.errors};
  const gates=[...automatedGates,semanticGate],automatedOk=automatedGates.every(value=>value.ok);
  const gameSha256=sha256(GAME_PATH);
  const report={
    schema:1,game:'neon-getaway',gameSha256,seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,
    contactSheet:{path:CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{fixture:beat.run,offset:beat.offset,probe:candidate[beat.id].probe}])),
    thresholds:{referenceMedians:ref,bands},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,
      playerBurst,policeBurst,swapBurst,districtPairs,rampBurst,warningContrast,warningLand,
      apexPhysical,apexStructure,apexFx,apexFxNear,apexBurst},
    gates,automatedOk,semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
  };
  writeJson(METRICS_PATH,report);

  console.log(`NEON GETAWAY visual evidence · seed 0x${SEED.toString(16)} · game ${gameSha256.slice(0,12)}`);
  for(const value of automatedGates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log(`  ${review.ok?'PASS':'PENDING'} ${semanticGate.name}`);
  console.log('  contact:',CONTACT_PATH);
  console.log('  montage sha256:',sheet.sha256);
  console.log('  metrics:',METRICS_PATH);
  console.log('  review template:',REVIEW_TEMPLATE_PATH);
  if(!automatedOk){console.error('\nNEON GETAWAY AUTOMATED VISUAL GATES FAILED');process.exit(1);}
  if(!review.ok){console.error('\nNEON GETAWAY AUTOMATED VISUAL GATES PASSED; SEMANTIC REVIEW PENDING');process.exit(1);}
  console.log('\nNEON GETAWAY VISUAL EVAL PASSED');
}

main().catch(error=>{console.error('NEON GETAWAY VISUAL EVAL FAILED:',error.stack||error);process.exit(1);});
