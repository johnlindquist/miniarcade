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
  measureDrawnActorExtent,assertActorScale,writeContactSheet,verifyReviewReceipt,writeJson,quantile
}=require('./visual-harness');

const ROOT=path.join(__dirname,'..');
const GAME_PATH=path.join(__dirname,'..','pico-cap.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','pico-cap');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','pico-cap.json');
const PRESERVED_CONTACT_PATH=path.join(__dirname,'visual-receipts','pico-cap-contact-sheet.png');
const CLIP_PATH=path.join(ARTIFACT_DIR,'pico-cap-30s.mp4');
const GAME_SOURCE=fs.readFileSync(GAME_PATH,'utf8');
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
  const runtime=bootRenderedGame('pico-cap',{seed:SEED,footer:options.footer||''});
  const setBeat=runtime.sandbox.__picoCapSetVisualBeat;
  if(typeof setBeat!=='function')throw new Error('pico-cap.html must expose __picoCapSetVisualBeat(name)');
  if(setBeat(name)!==true)throw new Error('unknown Pico Cap visual beat: '+name);
  if(options.selector!==undefined)runtime.sandbox.__PICOCAP_VISUAL_ONLY_SUBJECT=options.selector;
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

// Drawn-extent measurement (crystal-mesa pattern): render the frozen portrait
// once with __PICOCAP_VISUAL_ONLY_SUBJECT='none' (empty plate) and once with
// only the subject, then let measureDrawnActorExtent report the sprite's real
// painted bounds. This measures rendered pixels, never the probe's logical box.
function measureSubject(fixture,id,offset){
  const base=captureFixture(fixture,[offset],{id:`${fixture}-plate-${id}`,selector:'none'}).get(offset);
  const isolated=captureFixture(fixture,[offset],{id:`${fixture}-only-${id}`,selector:id}).get(offset);
  const actor=(base.probe.actors||[]).find(value=>value.id===id);
  if(!actor)throw new Error(`${fixture}: visual probe exposes no actor ${id}`);
  return measureDrawnActorExtent(isolated,base,{id,kind:actor.kind,type:actor.type,probeBox:actor.box,padding:10,threshold:8});
}

function buildCandidateEvidence(){
  const specs={
    opening:{fixture:'opening',offsets:[12]},
    travel:{fixture:'travel',offsets:[1,3,5,7,9,13]},
    choice:{fixture:'choice',offsets:[6,12,24]},
    gateClosed:{fixture:'gate-closed',offsets:[6]},
    gateOpen:{fixture:'gate-open',offsets:[1,3,6,12,24]},
    windupBefore:{fixture:'windup-before',offsets:[6]},
    windup:{fixture:'windup',offsets:[1,3,6,12,24]},
    charge:{fixture:'charge',offsets:[1,3,6,12,24]},
    dodge:{fixture:'dodge',offsets:[1,3,6,12,24]},
    parry:{fixture:'parry',offsets:[1,3,6,12,24]},
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
    portraitPico:{fixture:'portrait-pico',offsets:[6]},
    portraitGnawer:{fixture:'portrait-gnawer',offsets:[6]}
  };
  const runs={};
  for(const[id,spec]of Object.entries(specs))runs[id]=captureFixture(spec.fixture,spec.offsets,{id,footer:spec.footer});
  const beats=[
    {id:'opening',label:'opening',run:'opening',offset:12},
    {id:'choice',label:'two-route room',run:'choice',offset:12},
    {id:'windup',label:'charge tell',run:'windup',offset:6},
    {id:'dodge',label:'pico dodge',run:'dodge',offset:6},
    {id:'parry',label:'big parry',run:'parry',offset:6},
    {id:'gateOpen',label:'sun gate opens',run:'gateOpen',offset:6},
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
  const command=`node render/render.js pico-cap 30 .artifacts/visual/pico-cap/pico-cap-30s.mp4 --seed ${SEED} --probe --fps 30`;
  return{
    schema:1,game:'pico-cap',verdict:'pending',references:['horizon','blockmine'],montageSha256,
    seed:'0x'+SEED.toString(16),
    checkpoints:['opening@12','choice@12','windup@6','dodge@6','parry@6','gateOpen@6','later@12','deep@12','storm@6','restore@6'],
    reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size reference review',
    guidelineOverlays:'PENDING: confirm no path lines, breadcrumbs, predicted arcs, or future-position reticles are drawn for any actor at any sampled beat (the beetle windup lane is a diegetic enemy attack tell).',
    categories:{
      characterCraft:pending('Inspect big/pico hero silhouettes, acorn cap, facing, walk gait, sword slash, morph swirl, hunted reaction, channel pose, and gnawer construction in both roam and hunt at 160x360.'),
      environmentCraft:pending('Inspect hedge/creek/hearth/moon walls, floors, cracks, mushroom rings, brambles, shrine, light pools, canopy shade, rain, and ambient motes with the HUD mentally removed.'),
      levelVariety:pending('Confirm glade, creek, hearth, and moon biomes change architectural composition, materials, landmarks, and silhouette rather than only palette.'),
      animationImpact:pending('Confirm walking, scuttling, shrink/grow morphs, slash, squish, shard grab, storm landing, bloom, channel beam, and restore have anticipation, impact, and follow-through.'),
      readability:pending('Confirm the two room solutions, closed/open sun gates, enemy charge lane, pico dodge, big parry, shrine, and storm state remain legible at native size without exposing the computed navigation path.'),
      artDirectionCohesion:pending('Confirm actors, garden architecture, props, lighting, HUD, and payoff grammar feel authored as one storybook-garden world.')
    },
    renderReceipt:{seed:'0x'+SEED.toString(16),seconds:30,fps:30,codec:'h264',dimensions:'320x720',bytes:0,sha256:'',command}
  };
}

async function main(){
  if(fs.existsSync(FRAME_DIR))for(const file of fs.readdirSync(FRAME_DIR))if(file.endsWith('.png'))fs.unlinkSync(path.join(FRAME_DIR,file));
  fs.mkdirSync(FRAME_DIR,{recursive:true});

  const evidence=buildCandidateEvidence(),repeat=buildCandidateEvidence(),
    plannerClean=captureFixture('opening',[1],{id:'planner-clean'}).get(1),
    plannerDirty=captureFixture('opening',[1],{id:'planner-dirty',afterSet:runtime=>runtime.sandbox.__picoCapPlannerContamination()}).get(1),
    plannerHashes={clean:sha256(plannerClean.rgba),contaminated:sha256(plannerDirty.rgba)};
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
  const heroExtent=measureSubject('portrait','hero',6);
  const picoExtent=measureSubject('portrait-pico','hero',6);
  const gnawerExtent=measureSubject('portrait-gnawer','gnawer-0',6);
  const shrineExtent=measureSubject('portrait','shrine',6);
  const playfield=pf('portrait').probe.layout.playfield;
  const liveGnawers=candidate.opening.probe.actors.filter(value=>value.kind==='standard'&&value.id!=='hero').length;
  const measuredFootprint=(heroExtent.bboxArea+liveGnawers*gnawerExtent.bboxArea)/(playfield.width*playfield.height);
  const declaredBoxes=['opening','travel','small','chase','later','deep'].map(id=>{
    const probe=candidate[id]?candidate[id].probe:evidence.runs[id].get(9).probe;
    return{id,hero:probe.heroBox,gnawer:probe.gnawerBox,shrine:probe.shrineBox,footprint:probe.footprintFraction,
      scentTiles:probe.scentRadiusPx/TILE};
  });

  // each biome keeps authored ambient motion with every actor and the hero's
  // light pool removed (motes, canopy glints, waterfall seams, candle flicker)
  const environmentMotion={};
  for(const fixture of['opening','later','deep']){
    const frames=captureFixture(fixture,[1,3,5,7,9,13],{id:fixture+'-env',selector:'env'});
    environmentMotion[fixture]=analyzeBurst([1,3,5,7,9,13].map(offset=>frames.get(offset)),{native:false,crop:WORLD_CROP});
  }

  const bigPico=frameDifference(fixedCrop(pf('portrait'),pf('portrait').probe.heroBox),fixedCrop(pf('portraitPico'),pf('portraitPico').probe.heroBox),{native:false});
  const roamHunt=analyzeAlignedBurst([evidence.runs.travel.get(9),evidence.runs.chase.get(9)],'gnawerBox');
  const earlyLater=structureDistance(candidate.opening,candidate.later,{crop:WORLD_CROP});
  const laterDeep=structureDistance(candidate.later,candidate.deep,{crop:WORLD_CROP});
  const warningContrast=frameDifference(evidence.runs.stormCalm.get(12),evidence.runs.stormWarn.get(12),{native:false,crop:WORLD_CROP});
  const stormBurst=analyzeBurst([1,3,6,12,24].map(offset=>evidence.runs.storm.get(offset)),{native:false,crop:WORLD_CROP});
  const shrinkDelta=frameDifference(evidence.runs.shrinkBefore.get(6),evidence.runs.shrink.get(6),{native:false,crop:WORLD_CROP});
  const slashDelta=frameDifference(evidence.runs.slashBefore.get(6),evidence.runs.slash.get(6),{native:false,crop:WORLD_CROP});
  const shardDelta=frameDifference(evidence.runs.shardBefore.get(6),evidence.runs.shard.get(6),{native:false,crop:WORLD_CROP});
  const squishBurst=analyzeBurst([1,3,6,12,24].map(offset=>evidence.runs.squish.get(offset)),{native:false,crop:WORLD_CROP});
  const bloomDelta=frameDifference(evidence.runs.bloomBefore.get(6),evidence.runs.bloom.get(6),{native:false,crop:WORLD_CROP});
  const channelBurst=analyzeBurst([6,24,48].map(offset=>evidence.runs.channel.get(offset)),{native:false,crop:WORLD_CROP});
  const restoreDelta=frameDifference(evidence.runs.restoreBefore.get(6),candidate.restore,{native:false,crop:WORLD_CROP});
  const restoreBurst=analyzeBurst([1,3,6,12,24,48].map(offset=>evidence.runs.restore.get(offset)),{native:false,crop:WORLD_CROP});
  const gateDelta=frameDifference(evidence.runs.gateClosed.get(6),evidence.runs.gateOpen.get(6),{native:false,crop:WORLD_CROP});
  const tellDelta=frameDifference(evidence.runs.windupBefore.get(6),evidence.runs.windup.get(6),{native:false,crop:WORLD_CROP});
  const chargeBurst=analyzeBurst([1,3,6,12,24].map(offset=>evidence.runs.charge.get(offset)),{native:false,crop:WORLD_CROP});
  const dodgeDelta=frameDifference(evidence.runs.windup.get(6),evidence.runs.dodge.get(6),{native:false,crop:WORLD_CROP});
  const parryDelta=frameDifference(evidence.runs.charge.get(6),evidence.runs.parry.get(6),{native:false,crop:WORLD_CROP});
  const noVisiblePath=!/\bfunction\s+drawRoute\b/.test(GAME_SOURCE)&&!/\bdrawRoute\s*\(/.test(GAME_SOURCE)&&!/\.setLineDash\s*\(/.test(GAME_SOURCE)&&!/routePoints\s*:/.test(GAME_SOURCE);

  // Fixed-seed calibration for the approved native candidate capture, with
  // roughly 10-25% regression margin below the measured values recorded in
  // metrics.json beside their executable floors. Recalibrated 2026-07-11 for
  // the reference-scale art pass (hero 10x21 -> 9x12 drawn, gnawer 13x12 ->
  // 10x8): measured heroWalk max .455/firstLast .572, picoWalk .426/.620,
  // hunterAnim median .0372/max .0475, roamAnim max .0232, roamHunt .0408,
  // bigPico .551, weakest contrasts hero .036 / pico .073 / gnawer .066,
  // env-only ambient motion maxes .0045/.0075/.0046, frames colors 103..181 /
  // entropy 3.78..4.02 / edge .060..074 / rich 1.0.
  const bands={
    calibrated:true,
    colors:100,entropy:3.4,lumaStdDev:.10,largestColorShare:.30,edgeEnergy:.050,richEach:.85,richMedian:.90,
    heroWalkMax:.30,heroWalkFirstLast:.40,picoWalkMax:.22,picoWalkFirstLast:.30,
    hunterAnimMax:.038,hunterAnimMedian:.03,roamAnimMax:.015,
    heroLocalContrast:.02,picoLocalContrast:.015,gnawerLocalContrast:.012,
    bigPico:.10,roamHuntMax:.032,
    earlyLaterStructure:.15,earlyLaterEdge:.20,laterDeepStructure:.15,laterDeepEdge:.20,
    warningChanged:.22,warningMean:.02,warningGrid:.9,
    stormChanged:.35,stormGrid:.60,
    shrinkChanged:.015,slashChanged:.02,shardChanged:.30,shardMean:.05,shardGrid:.60,
    squishChanged:.02,bloomChanged:.25,channelChanged:.008,
    restoreChanged:.60,restoreMean:.10,restoreGrid:.80,restoreStructure:.20,
    gateChanged:.18,gateGrid:.28,tellChanged:.009,tellGrid:.08,chargeChanged:.03,dodgeChanged:.02,parryChanged:.02,
    envMotionMin:.003,
    // Scale caps encode the 2026-07-11 owner directive, not the loose 20x32 repo
    // ceiling: Block Mine's ~12px hero is the ceiling for any hero. Measured on
    // the shipped art (drawn pixels, portrait fixtures): big knight 9x12, pico
    // knight 9x9 aura included, gnawer 10x8, shrine 16x25. Caps carry 1-3px of
    // margin; probe boxes (big 11x14, pico 11x11, gnawer 13x12, shrine 18x26)
    // get the same margin. Footprint <20%, threats scented >=5 tiles out.
    heroMaxW:11,heroMaxH:14,picoMaxW:11,picoMaxH:11,gnawerMaxW:12,gnawerMaxH:10,shrineMaxW:20,shrineMaxH:28,
    heroBoxMaxW:12,heroBoxMaxH:15,gnawerBoxMaxW:14,gnawerBoxMaxH:13,shrineBoxMaxW:20,
    footprintMax:.2,scentMinTiles:5
  };
  const scaleChecks={
    hero:assertActorScale(heroExtent,{maxWidth:bands.heroMaxW,maxHeight:bands.heroMaxH,label:'big knight'}),
    pico:assertActorScale(picoExtent,{maxWidth:bands.picoMaxW,maxHeight:bands.picoMaxH,label:'pico knight'}),
    gnawer:assertActorScale(gnawerExtent,{maxWidth:bands.gnawerMaxW,maxHeight:bands.gnawerMaxH,label:'gnawer'}),
    shrine:assertActorScale(shrineExtent,{maxWidth:bands.shrineMaxW,maxHeight:bands.shrineMaxH,label:'shrine structure'})
  };

  const gates=[];
  const gate=(name,ok,detail)=>gates.push({name,ok:!!ok,detail});
  gate('known-good thresholds are calibrated',bands.calibrated,bands);
  gate('same-seed real pixels deterministic',deterministic,determinism.filter(v=>!v.ok).slice(0,4));
  gate('all requested fixtures are finite and truthful',evidence.all.every(v=>v.frame.probe&&v.frame.probe.finite!==false),
    beats.map(beat=>({beat:beat.id,probe:candidate[beat.id].probe&&candidate[beat.id].probe.finite})));
  gate('computed navigation path has no renderer or probe surface',noVisiblePath,{drawRoute:/\bdrawRoute\s*\(/.test(GAME_SOURCE),setLineDash:/\.setLineDash\s*\(/.test(GAME_SOURCE),routePoints:/routePoints\s*:/.test(GAME_SOURCE)});
  gate('mutating private future waypoints is an exact real-pixel no-op',plannerHashes.clean===plannerHashes.contaminated,plannerHashes);
  gate('frames are opaque and non-flat',cm.every(value=>value.opaqueFraction===1&&value.quantizedColors>=bands.colors&&value.colorEntropy>=bands.entropy&&value.lumaStdDev>=bands.lumaStdDev&&value.largestColorShare<=bands.largestColorShare),
    cm.map(value=>({colors:value.quantizedColors,entropy:value.colorEntropy,lumaStdDev:value.lumaStdDev,largest:value.largestColorShare})));
  gate('multiscale edge detail meets reference floor',cm.every(value=>value.edge[1].energy>=Math.max(bands.edgeEnergy,refEdge*.85)&&value.edge[4].energy>value.edge[1].energy),
    {candidate:cm.map(value=>value.edge[1].energy),referenceFloor:refEdge});
  gate('spatial richness meets reference floor',cm.every(value=>value.richCellFraction>=bands.richEach)&&median(cm.map(value=>value.richCellFraction))>=Math.max(bands.richMedian,refRich*.90),
    {candidate:cm.map(value=>value.richCellFraction),referenceFloor:refRich});
  gate('big hero has aligned walk animation',!!heroWalk&&heroWalk.changedFraction.max>=bands.heroWalkMax&&heroWalk.firstLast.changedFraction>=bands.heroWalkFirstLast&&heroWalk.changedFraction.max<=.8,heroWalk&&{max:heroWalk.changedFraction.max,firstLast:heroWalk.firstLast.changedFraction});
  gate('pico hero has aligned walk animation',!!picoWalk&&picoWalk.changedFraction.max>=bands.picoWalkMax&&picoWalk.firstLast.changedFraction>=bands.picoWalkFirstLast&&picoWalk.changedFraction.max<=.8,picoWalk&&{max:picoWalk.changedFraction.max,firstLast:picoWalk.firstLast.changedFraction});
  gate('gnawer scuttles harder when hunting',!!hunterAnim&&!!roamAnim&&hunterAnim.changedFraction.max>=bands.hunterAnimMax&&hunterAnim.changedFraction.median>=bands.hunterAnimMedian&&roamAnim.changedFraction.max>=bands.roamAnimMax&&hunterAnim.changedFraction.median>roamAnim.changedFraction.median*1.5,
    {hunter:hunterAnim&&hunterAnim.changedFraction,roam:roamAnim&&roamAnim.changedFraction});
  gate('hero, pico form, and gnawers separate from their backgrounds',
    heroContrast.every(value=>value&&Math.max(value.lumaContrast,value.rgbContrast)>=bands.heroLocalContrast)&&
    picoContrast.every(value=>value&&Math.max(value.lumaContrast,value.rgbContrast)>=bands.picoLocalContrast)&&
    gnawerContrast.every(value=>value&&Math.max(value.lumaContrast,value.rgbContrast)>=bands.gnawerLocalContrast),
    {hero:heroContrast,pico:picoContrast,gnawer:gnawerContrast});
  gate('big and pico silhouettes are distinct',bigPico.changedFraction>=bands.bigPico,bigPico);
  gate('roam and hunt silhouettes differ',!!roamHunt&&roamHunt.changedFraction.max>=bands.roamHuntMax,roamHunt&&roamHunt.changedFraction);
  // ---- the scale law, from isolated-subject drawn pixels and declared probe boxes
  gate('drawn big and pico knights stay inside the reference-scale caps',
    scaleChecks.hero.ok&&scaleChecks.pico.ok,
    {hero:{bounds:heroExtent.bounds,failures:scaleChecks.hero.failures},pico:{bounds:picoExtent.bounds,failures:scaleChecks.pico.failures}});
  gate('drawn gnawer and shrine stay inside the reference-scale caps',
    scaleChecks.gnawer.ok&&scaleChecks.shrine.ok,
    {gnawer:{bounds:gnawerExtent.bounds,failures:scaleChecks.gnawer.failures},shrine:{bounds:shrineExtent.bounds,failures:scaleChecks.shrine.failures}});
  gate('measured actor footprint stays far below 20% of the playfield',
    liveGnawers>=4&&measuredFootprint<=bands.footprintMax,
    {playfield,liveGnawers,heroArea:heroExtent.bboxArea,gnawerArea:gnawerExtent.bboxArea,measuredFootprint:+measuredFootprint.toFixed(5)});
  gate('declared boxes, shrine width, footprint, and scent range obey the law',
    declaredBoxes.every(v=>v.hero.width<=bands.heroBoxMaxW&&v.hero.height<=bands.heroBoxMaxH&&
      (!v.gnawer||(v.gnawer.width<=bands.gnawerBoxMaxW&&v.gnawer.height<=bands.gnawerBoxMaxH))&&
      v.shrine.width<=bands.shrineBoxMaxW&&v.footprint<bands.footprintMax&&v.scentTiles>=bands.scentMinTiles),
    declaredBoxes);
  gate('each biome keeps ambient environmental motion with actors removed',
    Object.values(environmentMotion).every(value=>value.changedFraction.max>=bands.envMotionMin),
    Object.fromEntries(Object.entries(environmentMotion).map(([key,value])=>[key,{max:value.changedFraction.max,median:value.changedFraction.median}])));
  gate('later biomes change architecture, not only palette',earlyLater.structureDistance>=bands.earlyLaterStructure&&earlyLater.edgeMagnitudeDistance>=bands.earlyLaterEdge&&laterDeep.structureDistance>=bands.laterDeepStructure&&laterDeep.edgeMagnitudeDistance>=bands.laterDeepEdge,
    {earlyLater,laterDeep});
  gate('storm warning is visibly broad',warningContrast.changedFraction>=bands.warningChanged&&warningContrast.meanDelta>=bands.warningMean&&warningContrast.changedGridFraction>=bands.warningGrid,warningContrast);
  gate('storm landing rains across the field',stormBurst.changedFraction.max>=bands.stormChanged&&stormBurst.changedGridFraction.max>=bands.stormGrid,{changed:stormBurst.changedFraction,grid:stormBurst.changedGridFraction});
  gate('shrink morph has authored presentation',shrinkDelta.changedFraction>=bands.shrinkChanged,shrinkDelta);
  gate('sword slash has authored impact',slashDelta.changedFraction>=bands.slashChanged,slashDelta);
  gate('shard pickup has authored impact',shardDelta.changedFraction>=bands.shardChanged&&shardDelta.meanDelta>=bands.shardMean&&shardDelta.changedGridFraction>=bands.shardGrid,shardDelta);
  gate('squish has authored reaction and aftermath',squishBurst.changedFraction.max>=bands.squishChanged,{changed:squishBurst.changedFraction});
  gate('shrine bloom reads across the field',bloomDelta.changedFraction>=bands.bloomChanged,bloomDelta);
  gate('channel beam visibly charges',channelBurst.changedFraction.max>=bands.channelChanged,{changed:channelBurst.changedFraction});
  gate('restore is an apex payoff',restoreDelta.changedFraction>=bands.restoreChanged&&restoreDelta.meanDelta>=bands.restoreMean&&restoreDelta.changedGridFraction>=bands.restoreGrid&&restoreBurst.firstLast.structureDistance>=bands.restoreStructure,
    {restoreDelta,firstLast:restoreBurst.firstLast.structureDistance});
  gate('sun gate visibly changes puzzle state',gateDelta.changedFraction>=bands.gateChanged&&gateDelta.changedGridFraction>=bands.gateGrid,gateDelta);
  gate('gnawer charge has a broad anticipatory lane tell',tellDelta.changedFraction>=bands.tellChanged&&tellDelta.changedGridFraction>=bands.tellGrid,tellDelta);
  gate('charge, pico dodge, and big parry each change the authored frame',chargeBurst.changedFraction.max>=bands.chargeChanged&&dodgeDelta.changedFraction>=bands.dodgeChanged&&parryDelta.changedFraction>=bands.parryChanged,
    {charge:chargeBurst.changedFraction,dodge:dodgeDelta,parry:parryDelta});
  gate('candidate numeric richness is reference-comparable',median(cm.map(value=>value.edge[1].energy))>=refEdge*.9&&median(cm.map(value=>value.richCellFraction))>=refRich*.9,
    {candidateEdge:median(cm.map(value=>value.edge[1].energy)),referenceEdge:refEdge,candidateRich:median(cm.map(value=>value.richCellFraction)),referenceRich:refRich});

  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256));
  let review;
  if(fs.existsSync(REVIEW_PATH))review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256,preservedPath:PRESERVED_CONTACT_PATH});
  else review={ok:false,errors:[`missing committed semantic review: ${REVIEW_PATH}`,`inspect ${CONTACT_PATH}, then copy and complete ${REVIEW_TEMPLATE_PATH}`]};
  gate('fresh semantic comparison receipt',review.ok,review.errors);
  const expectedReview=reviewTemplate(sheet.sha256),reviewClip=review.receipt&&review.receipt.renderReceipt,
    localClip=fs.existsSync(CLIP_PATH)?{path:CLIP_PATH,bytes:fs.statSync(CLIP_PATH).size,sha256:sha256(CLIP_PATH)}:null;
  gate('rendered autoplay clip receipt is complete',!!reviewClip&&reviewClip.bytes>100000&&/^[a-f0-9]{64}$/.test(reviewClip.sha256||'')&&reviewClip.seed===`0x${SEED.toString(16)}`&&reviewClip.command===expectedReview.renderReceipt.command,reviewClip);
  gate('local rendered clip matches receipt when available',!localClip||reviewClip&&localClip.bytes===reviewClip.bytes&&localClip.sha256===reviewClip.sha256,{localClip,reviewClip});

  const RECEIPT_GATES=['fresh semantic comparison receipt','rendered autoplay clip receipt is complete','local rendered clip matches receipt when available'];
  const report={
    schema:1,game:'pico-cap',seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,
    contactSheet:{path:CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{fixture:beat.run,offset:beat.offset,probe:candidate[beat.id].probe}])),
    thresholds:{referenceEdgeFloor:refEdge,referenceRichFloor:refRich,bands},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,
      heroWalk,picoWalk,hunterAnim,roamAnim,heroContrast,picoContrast,gnawerContrast,
      heroExtent,picoExtent,gnawerExtent,shrineExtent,scaleChecks,playfield,liveGnawers,
      measuredFootprint:+measuredFootprint.toFixed(5),environmentMotion,declaredBoxes,bigPico,roamHunt,earlyLater,laterDeep,
      warningContrast,stormBurst,shrinkDelta,slashDelta,shardDelta,squishBurst,bloomDelta,channelBurst,restoreDelta,restoreBurst,gateDelta,tellDelta,chargeBurst,dodgeDelta,parryDelta,noVisiblePath,plannerHashes,clip:localClip},
    gates,automatedOk:gates.filter(value=>!RECEIPT_GATES.includes(value.name)).every(value=>value.ok),semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
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
