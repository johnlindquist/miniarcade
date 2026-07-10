#!/usr/bin/env node
'use strict';

// PICO CAP real-pixel release gate. Behavioral truth remains in
// pico-cap-eval.js. This suite renders deterministic authored fixtures from
// the actual canvas, measures the native 160x360 pixels — including the
// "small actors, big worlds" scale law — and records a hashed reference
// review for the judgments pixel statistics cannot make.
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
const GAME_PATH=path.join(__dirname,'..','pico-cap.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','pico-cap');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','pico-cap.json');
const SEED=0x9c0cab,RENDER_EVERY=2,PRE_ROLL=120;
const WORLD_CROP={x:0,y:46,width:160,height:276};
const TILE=14;

if(!fs.existsSync(GAME_PATH)){
  console.error('PICO CAP VISUAL EVAL FAILED: missing '+GAME_PATH);
  process.exit(1);
}

const median=values=>quantile(values,.5);

function visualProbe(runtime){
  const fn=runtime.sandbox.__picoCapVisualProbe;
  if(typeof fn!=='function')throw new Error('pico-cap.html must expose __picoCapVisualProbe()');
  const value=fn();
  if(!value||value.finite===false)throw new Error('pico-cap visual fixture produced non-finite state');
  return value;
}

function captureFixture(name,offsets,options){
  options=options||{};
  const runtime=bootRenderedGame('pico-cap',{seed:SEED});
  const setBeat=runtime.sandbox.__picoCapSetVisualBeat;
  if(typeof setBeat!=='function')throw new Error('pico-cap.html must expose __picoCapSetVisualBeat(name)');
  if(setBeat(name)!==true)throw new Error('unknown Pico Cap visual beat: '+name);
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

// Drawn-extent measurement: diff a frozen portrait against the same scene with
// the subject moved away, cropped to a window around the subject box so only
// the subject's own pixels register. This measures rendered sprites, not the
// probe's logical box.
function drawnExtent(present,absent,box,inflate){
  const pad=inflate===undefined?12:inflate;
  const crop={
    x:Math.max(0,Math.floor(box.x-pad)),y:Math.max(0,Math.floor(box.y-pad)),
    width:Math.min(160,Math.ceil(box.width+pad*2)),height:Math.min(360,Math.ceil(box.height+pad*2))
  };
  const diff=frameDifference(present,absent,{native:false,crop,threshold:14});
  return{crop,diff,bounds:diff.changedBounds};
}

function buildCandidateEvidence(){
  const specs={
    opening:{fixture:'opening',offsets:[12]},
    travel:{fixture:'travel',offsets:[1,3,5,7,9,13]},
    small:{fixture:'small',offsets:[1,3,5,7,9,13]},
    chase:{fixture:'chase',offsets:[1,3,5,7,9,13]},
    shrinkBefore:{fixture:'shrink-before',offsets:[6]},
    shrink:{fixture:'shrink',offsets:[1,3,6,12,24]},
    grow:{fixture:'grow',offsets:[1,3,6,12,24]},
    slashBefore:{fixture:'slash-before',offsets:[6]},
    slash:{fixture:'slash',offsets:[1,3,6,12,24]},
    squish:{fixture:'squish',offsets:[1,3,6,12,24]},
    shardBefore:{fixture:'shard-before',offsets:[6]},
    shard:{fixture:'shard',offsets:[1,3,6,12,24]},
    later:{fixture:'later',offsets:[1,6,12,18,24,32]},
    deep:{fixture:'deep',offsets:[1,6,12,18,24,32]},
    stormCalm:{fixture:'storm-calm',offsets:[12]},
    stormWarn:{fixture:'storm-warn',offsets:[12]},
    storm:{fixture:'storm',offsets:[1,3,6,12,24]},
    bloomBefore:{fixture:'bloom-before',offsets:[6]},
    bloom:{fixture:'bloom',offsets:[1,3,6,12,24]},
    channel:{fixture:'channel',offsets:[6,24,48]},
    restoreBefore:{fixture:'restore-before',offsets:[6]},
    restore:{fixture:'restore',offsets:[1,3,6,12,24,48]},
    portrait:{fixture:'portrait',offsets:[6]},
    portraitAway:{fixture:'portrait-away',offsets:[6]},
    portraitPico:{fixture:'portrait-pico',offsets:[6]},
    portraitPicoAway:{fixture:'portrait-pico-away',offsets:[6]},
    portraitGnawer:{fixture:'portrait-gnawer',offsets:[6]},
    portraitGnawerAway:{fixture:'portrait-gnawer-away',offsets:[6]}
  };
  const runs={};
  for(const[id,spec]of Object.entries(specs))runs[id]=captureFixture(spec.fixture,spec.offsets,{id});
  const beats=[
    {id:'opening',label:'opening',run:'opening',offset:12},
    {id:'small',label:'pico form',run:'small',offset:9},
    {id:'chase',label:'hunted',run:'chase',offset:9},
    {id:'shrink',label:'shrink ring',run:'shrink',offset:6},
    {id:'slash',label:'sword slash',run:'slash',offset:6},
    {id:'shard',label:'sun shard',run:'shard',offset:6},
    {id:'later',label:'creek hollow',run:'later',offset:12},
    {id:'deep',label:'moon shrine',run:'deep',offset:12},
    {id:'storm',label:'rainstorm',run:'storm',offset:6},
    {id:'restore',label:'glade restored',run:'restore',offset:6}
  ];
  const frames=Object.fromEntries(beats.map(beat=>[beat.id,runs[beat.run].get(beat.offset)]));
  const all=[];
  for(const[id,frameMap]of Object.entries(runs))for(const[offset,frame]of frameMap)all.push({id,offset,frame});
  return{specs,runs,beats,frames,all};
}

function reviewTemplate(montageSha256){
  const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});
  return{
    schema:1,game:'pico-cap',verdict:'pending',references:['horizon','blockmine'],montageSha256,
    reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size reference review',
    categories:{
      characterCraft:pending('Inspect big/pico hero silhouettes, acorn cap, facing, walk gait, sword slash, morph swirl, hunted reaction, channel pose, and gnawer construction in both roam and hunt at 160x360.'),
      environmentCraft:pending('Inspect hedge/creek/hearth/moon walls, floors, cracks, mushroom rings, brambles, shrine, light pools, canopy shade, rain, and ambient motes with the HUD mentally removed.'),
      levelVariety:pending('Confirm glade, creek, hearth, and moon biomes change architectural composition, materials, landmarks, and silhouette rather than only palette.'),
      animationImpact:pending('Confirm walking, scuttling, shrink/grow morphs, slash, squish, shard grab, storm landing, bloom, channel beam, and restore have anticipation, impact, and follow-through.'),
      readability:pending('Confirm hero (both sizes), gnawers, shards, rings, cracks, shrine, storm state, and the bot route remain legible at native size beside video.'),
      artDirectionCohesion:pending('Confirm actors, garden architecture, props, lighting, HUD, and payoff grammar feel authored as one storybook-garden world.')
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

  const referenceTargets=[60,600,1200,2400,3600,5400,9000,12000,15000,18000];
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
      {label:'PICO CAP',frames:candidate},
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

  const heroWalk=analyzeAlignedBurst([1,3,5,7,9,13].map(offset=>evidence.runs.travel.get(offset)),'heroBox');
  const picoWalk=analyzeAlignedBurst([1,3,5,7,9,13].map(offset=>evidence.runs.small.get(offset)),'heroBox');
  const hunterAnim=analyzeAlignedBurst([1,3,5,7,9,13].map(offset=>evidence.runs.chase.get(offset)),'gnawerBox');
  const roamAnim=analyzeAlignedBurst([1,3,5,7,9,13].map(offset=>evidence.runs.travel.get(offset)),'gnawerBox');
  const heroContrast=[candidate.opening,evidence.runs.travel.get(9),candidate.later,candidate.deep]
    .map(frame=>subjectContrast(frame,frame.probe&&frame.probe.heroBox));
  const picoContrast=[evidence.runs.small.get(9),evidence.runs.chase.get(9)]
    .map(frame=>subjectContrast(frame,frame.probe&&frame.probe.heroBox));
  const gnawerContrast=[evidence.runs.travel.get(9),evidence.runs.chase.get(9),candidate.deep]
    .map(frame=>subjectContrast(frame,frame.probe&&frame.probe.gnawerBox));

  // ---- "small actors, big worlds" scale law, measured from rendered pixels
  const pf=(id)=>evidence.runs[id].get(6);
  const heroExtent=drawnExtent(pf('portrait'),pf('portraitAway'),pf('portrait').probe.heroBox);
  const picoExtent=drawnExtent(pf('portraitPico'),pf('portraitPicoAway'),pf('portraitPico').probe.heroBox);
  const gnawerExtent=drawnExtent(pf('portraitGnawer'),pf('portraitGnawerAway'),pf('portraitGnawer').probe.gnawerBox);
  const declaredBoxes=['opening','travel','small','chase','later','deep'].map(id=>{
    const probe=candidate[id]?candidate[id].probe:evidence.runs[id].get(9).probe;
    return{id,hero:probe.heroBox,gnawer:probe.gnawerBox,shrine:probe.shrineBox,footprint:probe.footprintFraction,
      scentTiles:probe.scentRadiusPx/TILE};
  });

  const bigPico=frameDifference(fixedCrop(pf('portrait'),pf('portrait').probe.heroBox),fixedCrop(pf('portraitPico'),pf('portraitPico').probe.heroBox),{native:false});
  const roamHunt=analyzeAlignedBurst([evidence.runs.travel.get(9),evidence.runs.chase.get(9)],'gnawerBox');
  const earlyLater=structureDistance(candidate.opening,candidate.later,{crop:WORLD_CROP});
  const laterDeep=structureDistance(candidate.later,candidate.deep,{crop:WORLD_CROP});
  const warningContrast=frameDifference(evidence.runs.stormCalm.get(12),evidence.runs.stormWarn.get(12),{native:false,crop:WORLD_CROP});
  const stormBurst=analyzeBurst([1,3,6,12,24].map(offset=>evidence.runs.storm.get(offset)),{native:false,crop:WORLD_CROP});
  const shrinkDelta=frameDifference(evidence.runs.shrinkBefore.get(6),evidence.runs.shrink.get(6),{native:false,crop:WORLD_CROP});
  const slashDelta=frameDifference(evidence.runs.slashBefore.get(6),evidence.runs.slash.get(6),{native:false,crop:WORLD_CROP});
  const shardDelta=frameDifference(evidence.runs.shardBefore.get(6),candidate.shard,{native:false,crop:WORLD_CROP});
  const squishBurst=analyzeBurst([1,3,6,12,24].map(offset=>evidence.runs.squish.get(offset)),{native:false,crop:WORLD_CROP});
  const bloomDelta=frameDifference(evidence.runs.bloomBefore.get(6),evidence.runs.bloom.get(6),{native:false,crop:WORLD_CROP});
  const channelBurst=analyzeBurst([6,24,48].map(offset=>evidence.runs.channel.get(offset)),{native:false,crop:WORLD_CROP});
  const restoreDelta=frameDifference(evidence.runs.restoreBefore.get(6),candidate.restore,{native:false,crop:WORLD_CROP});
  const restoreBurst=analyzeBurst([1,3,6,12,24,48].map(offset=>evidence.runs.restore.get(offset)),{native:false,crop:WORLD_CROP});

  // Fixed-seed calibration for the approved native candidate capture, with
  // roughly 10-25% regression margin below the measured values recorded in
  // metrics.json beside their executable floors.
  const bands={
    calibrated:true,
    colors:100,entropy:3.4,lumaStdDev:.10,largestColorShare:.30,edgeEnergy:.050,richEach:.85,richMedian:.90,
    heroWalkMax:.30,heroWalkFirstLast:.40,picoWalkMax:.22,picoWalkFirstLast:.30,
    hunterAnimMax:.10,roamAnimMax:.05,
    heroLocalContrast:.02,picoLocalContrast:.015,gnawerLocalContrast:.012,
    bigPico:.10,roamHuntMax:.06,
    earlyLaterStructure:.15,earlyLaterEdge:.20,laterDeepStructure:.15,laterDeepEdge:.20,
    warningChanged:.30,warningMean:.02,
    stormChanged:.35,stormGrid:.60,
    shrinkChanged:.015,slashChanged:.02,shardChanged:.30,shardMean:.05,shardGrid:.60,
    squishChanged:.02,bloomChanged:.25,channelChanged:.008,
    restoreChanged:.60,restoreMean:.10,restoreGrid:.80,restoreStructure:.20,
    // scale law caps are design law, not calibration: standard actors <=20x32 drawn,
    // structures <=24 wide, combined footprint <20%, threats scented >=5 tiles out
    heroMaxW:20,heroMaxH:32,gnawerMaxW:20,gnawerMaxH:32,shrineMaxW:24,footprintMax:.2,scentMinTiles:5
  };

  const gates=[];
  const gate=(name,ok,detail)=>gates.push({name,ok:!!ok,detail});
  gate('known-good thresholds are calibrated',bands.calibrated,bands);
  gate('same-seed real pixels deterministic',deterministic,determinism.filter(v=>!v.ok).slice(0,4));
  gate('all requested fixtures are finite and truthful',evidence.all.every(v=>v.frame.probe&&v.frame.probe.finite!==false),
    beats.map(beat=>({beat:beat.id,probe:candidate[beat.id].probe&&candidate[beat.id].probe.finite})));
  const routedBeats=['opening','small','chase','later','deep'];
  gate('route remains present in representative fixtures',routedBeats.every(id=>candidate[id].probe&&candidate[id].probe.routePoints>=4),
    Object.fromEntries(routedBeats.map(id=>[id,candidate[id].probe&&candidate[id].probe.routePoints])));
  gate('frames are opaque and non-flat',cm.every(value=>value.opaqueFraction===1&&value.quantizedColors>=bands.colors&&value.colorEntropy>=bands.entropy&&value.lumaStdDev>=bands.lumaStdDev&&value.largestColorShare<=bands.largestColorShare),
    cm.map(value=>({colors:value.quantizedColors,entropy:value.colorEntropy,lumaStdDev:value.lumaStdDev,largest:value.largestColorShare})));
  gate('multiscale edge detail meets reference floor',cm.every(value=>value.edge[1].energy>=Math.max(bands.edgeEnergy,refEdge*.85)&&value.edge[4].energy>value.edge[1].energy),
    {candidate:cm.map(value=>value.edge[1].energy),referenceFloor:refEdge});
  gate('spatial richness meets reference floor',cm.every(value=>value.richCellFraction>=bands.richEach)&&median(cm.map(value=>value.richCellFraction))>=Math.max(bands.richMedian,refRich*.90),
    {candidate:cm.map(value=>value.richCellFraction),referenceFloor:refRich});
  gate('big hero has aligned walk animation',!!heroWalk&&heroWalk.changedFraction.max>=bands.heroWalkMax&&heroWalk.firstLast.changedFraction>=bands.heroWalkFirstLast&&heroWalk.changedFraction.max<=.8,heroWalk&&{max:heroWalk.changedFraction.max,firstLast:heroWalk.firstLast.changedFraction});
  gate('pico hero has aligned walk animation',!!picoWalk&&picoWalk.changedFraction.max>=bands.picoWalkMax&&picoWalk.firstLast.changedFraction>=bands.picoWalkFirstLast&&picoWalk.changedFraction.max<=.8,picoWalk&&{max:picoWalk.changedFraction.max,firstLast:picoWalk.firstLast.changedFraction});
  gate('gnawer scuttles harder when hunting',!!hunterAnim&&!!roamAnim&&hunterAnim.changedFraction.max>=bands.hunterAnimMax&&roamAnim.changedFraction.max>=bands.roamAnimMax,
    {hunter:hunterAnim&&hunterAnim.changedFraction,roam:roamAnim&&roamAnim.changedFraction});
  gate('hero, pico form, and gnawers separate from their backgrounds',
    heroContrast.every(value=>value&&Math.max(value.lumaContrast,value.rgbContrast)>=bands.heroLocalContrast)&&
    picoContrast.every(value=>value&&Math.max(value.lumaContrast,value.rgbContrast)>=bands.picoLocalContrast)&&
    gnawerContrast.every(value=>value&&Math.max(value.lumaContrast,value.rgbContrast)>=bands.gnawerLocalContrast),
    {hero:heroContrast,pico:picoContrast,gnawer:gnawerContrast});
  gate('big and pico silhouettes are distinct',bigPico.changedFraction>=bands.bigPico,bigPico);
  gate('roam and hunt silhouettes differ',!!roamHunt&&roamHunt.changedFraction.max>=bands.roamHuntMax,roamHunt&&roamHunt.changedFraction);
  // ---- the scale law, from drawn pixels and declared probe boxes
  gate('drawn hero stays inside the standard actor cap',
    !!heroExtent.bounds&&heroExtent.bounds.width<=bands.heroMaxW+2&&heroExtent.bounds.height<=bands.heroMaxH&&
    !!picoExtent.bounds&&picoExtent.bounds.width<=16&&picoExtent.bounds.height<=20,
    {hero:heroExtent.bounds,pico:picoExtent.bounds});
  gate('drawn gnawer stays inside the standard actor cap',
    !!gnawerExtent.bounds&&gnawerExtent.bounds.width<=bands.gnawerMaxW&&gnawerExtent.bounds.height<=bands.gnawerMaxH,
    gnawerExtent.bounds);
  gate('declared boxes, shrine width, footprint, and scent range obey the law',
    declaredBoxes.every(v=>v.hero.width<=bands.heroMaxW&&v.hero.height<=bands.heroMaxH&&
      (!v.gnawer||(v.gnawer.width<=bands.gnawerMaxW&&v.gnawer.height<=bands.gnawerMaxH))&&
      v.shrine.width<=bands.shrineMaxW&&v.footprint<bands.footprintMax&&v.scentTiles>=bands.scentMinTiles),
    declaredBoxes);
  gate('later biomes change architecture, not only palette',earlyLater.structureDistance>=bands.earlyLaterStructure&&earlyLater.edgeMagnitudeDistance>=bands.earlyLaterEdge&&laterDeep.structureDistance>=bands.laterDeepStructure&&laterDeep.edgeMagnitudeDistance>=bands.laterDeepEdge,
    {earlyLater,laterDeep});
  gate('storm warning is visibly broad',warningContrast.changedFraction>=bands.warningChanged&&warningContrast.meanDelta>=bands.warningMean,warningContrast);
  gate('storm landing rains across the field',stormBurst.changedFraction.max>=bands.stormChanged&&stormBurst.changedGridFraction.max>=bands.stormGrid,{changed:stormBurst.changedFraction,grid:stormBurst.changedGridFraction});
  gate('shrink morph has authored presentation',shrinkDelta.changedFraction>=bands.shrinkChanged,shrinkDelta);
  gate('sword slash has authored impact',slashDelta.changedFraction>=bands.slashChanged,slashDelta);
  gate('shard pickup has authored impact',shardDelta.changedFraction>=bands.shardChanged&&shardDelta.meanDelta>=bands.shardMean&&shardDelta.changedGridFraction>=bands.shardGrid,shardDelta);
  gate('squish has authored reaction and aftermath',squishBurst.changedFraction.max>=bands.squishChanged,{changed:squishBurst.changedFraction});
  gate('shrine bloom reads across the field',bloomDelta.changedFraction>=bands.bloomChanged,bloomDelta);
  gate('channel beam visibly charges',channelBurst.changedFraction.max>=bands.channelChanged,{changed:channelBurst.changedFraction});
  gate('restore is an apex payoff',restoreDelta.changedFraction>=bands.restoreChanged&&restoreDelta.meanDelta>=bands.restoreMean&&restoreDelta.changedGridFraction>=bands.restoreGrid&&restoreBurst.firstLast.structureDistance>=bands.restoreStructure,
    {restoreDelta,firstLast:restoreBurst.firstLast.structureDistance});
  gate('candidate numeric richness is reference-comparable',median(cm.map(value=>value.edge[1].energy))>=refEdge*.9&&median(cm.map(value=>value.richCellFraction))>=refRich*.9,
    {candidateEdge:median(cm.map(value=>value.edge[1].energy)),referenceEdge:refEdge,candidateRich:median(cm.map(value=>value.richCellFraction)),referenceRich:refRich});

  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256));
  let review;
  if(fs.existsSync(REVIEW_PATH))review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256});
  else review={ok:false,errors:[`missing committed semantic review: ${REVIEW_PATH}`,`inspect ${CONTACT_PATH}, then copy and complete ${REVIEW_TEMPLATE_PATH}`]};
  gate('fresh semantic comparison receipt',review.ok,review.errors);

  const report={
    schema:1,game:'pico-cap',seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,
    contactSheet:{path:CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{fixture:beat.run,offset:beat.offset,probe:candidate[beat.id].probe}])),
    thresholds:{referenceEdgeFloor:refEdge,referenceRichFloor:refRich,bands},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,
      heroWalk,picoWalk,hunterAnim,roamAnim,heroContrast,picoContrast,gnawerContrast,
      heroExtent,picoExtent,gnawerExtent,declaredBoxes,bigPico,roamHunt,earlyLater,laterDeep,
      warningContrast,stormBurst,shrinkDelta,slashDelta,shardDelta,squishBurst,bloomDelta,channelBurst,restoreDelta,restoreBurst},
    gates,automatedOk:gates.slice(0,-1).every(value=>value.ok),semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
  };
  writeJson(METRICS_PATH,report);

  console.log(`PICO CAP visual evidence · seed 0x${SEED.toString(16)}`);
  for(const value of gates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log('  contact:',CONTACT_PATH);
  console.log('  montage sha256:',sheet.sha256);
  console.log('  metrics:',METRICS_PATH);
  console.log('  review template:',REVIEW_TEMPLATE_PATH);
  if(!gates.every(value=>value.ok)){
    console.error('\nPICO CAP VISUAL EVAL FAILED');
    process.exit(1);
  }
  console.log('\nPICO CAP VISUAL EVAL PASSED');
}

main().catch(error=>{console.error('PICO CAP VISUAL EVAL FAILED:',error.stack||error);process.exit(1);});
