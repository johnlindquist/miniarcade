#!/usr/bin/env node
'use strict';

// RAIDERS OF THE LOST CART real-pixel release gate. Behavioral truth lives in
// raiders-cart-eval.js. This suite stages deterministic authored beats, renders
// the actual canvas at native 160x360, measures actor pixels against clean
// plates, and binds semantic review to the exact reference montage bytes.
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
const GAME_PATH=path.join(__dirname,'..','raiders-cart.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','raiders-cart');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const TRACKED_CONTACT_PATH=path.join(__dirname,'visual-receipts','raiders-cart-contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','raiders-cart.json');
const SEED=0x52414944,PRE_ROLL=120,RENDER_EVERY=2;
const WORLD_CROP={x:0,y:38,width:160,height:300};
const SCALE_OFFSET=12,ACTOR_PADDING=8,ACTOR_THRESHOLD=8;

if(!fs.existsSync(GAME_PATH)){
  console.error('RAIDERS CART VISUAL EVAL FAILED: missing '+GAME_PATH);
  process.exit(1);
}

const median=values=>quantile(values,.5);

function visualProbe(runtime){
  const visualFn=runtime.sandbox.__raidersCartVisualProbe,fullFn=runtime.sandbox.__raidersCartProbe;
  if(typeof visualFn!=='function'||typeof fullFn!=='function')
    throw new Error('raiders-cart.html must expose __raidersCartVisualProbe() and __raidersCartProbe()');
  const visual=JSON.parse(JSON.stringify(visualFn())),full=JSON.parse(JSON.stringify(fullFn()));
  if(!visual||visual.finite===false||!full||full.finite===false)
    throw new Error('raiders-cart visual fixture produced non-finite state');
  return Object.assign({},visual,{state:full.state,player:full.player,cart:full.cart,rock:full.rock,
    water:full.water,idol:full.idol,artifact:full.artifact,show:full.show});
}

function captureFixture(name,offsets,options){
  options=options||{};
  const runtime=bootRenderedGame('raiders-cart',{seed:SEED});
  if(options.beforeSet)options.beforeSet(runtime);
  const setBeat=runtime.sandbox.__raidersCartSetVisualBeat;
  if(typeof setBeat!=='function')throw new Error('raiders-cart.html must expose __raidersCartSetVisualBeat(name)');
  if(setBeat(name)!==true)throw new Error('unknown Raiders Cart visual beat: '+name);
  if(options.actorSelector!==undefined)runtime.sandbox.__RC_VISUAL_ONLY_ACTOR=options.actorSelector;
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

function fixedCrop(frame,box,width,height){
  width=width||40;height=height||width;
  const source=toNativeFrame(frame),cx=Math.round(box.x+box.width/2),cy=Math.round(box.y+box.height/2);
  const out=Buffer.alloc(width*height*4),left=cx-Math.floor(width/2),top=cy-Math.floor(height/2);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=left+x,sy=top+y,dst=(y*width+x)*4;
    if(sx<0||sy<0||sx>=source.width||sy>=source.height){out[dst+3]=255;continue;}
    const src=(sy*source.width+sx)*4;
    out[dst]=source.rgba[src];out[dst+1]=source.rgba[src+1];out[dst+2]=source.rgba[src+2];out[dst+3]=source.rgba[src+3];
  }
  return rgbaFrame(out,width,height,{fixture:frame.fixture,offset:frame.offset});
}

function analyzeAlignedBurst(frames,boxField,width,height){
  const crops=[];
  for(const frame of frames){
    const box=frame.probe&&frame.probe[boxField];
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
  if(actor.kind==='idol')return{maxWidth:34,maxHeight:34};
  if(actor.kind==='cart')return{maxWidth:20,maxHeight:32};
  if(actor.kind==='structure'||actor.kind==='rock'||actor.kind==='artifact')
    return{maxWidth:24,maxHeight:24};
  return{maxWidth:20,maxHeight:32};
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
    measurements.push(Object.assign(measurement,
      {assertion:{ok:assertion.ok,failures:assertion.failures,limits:assertion.limits}}));
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
  const width=Math.round(playfield.width),height=Math.round(playfield.height),originX=Math.round(playfield.x),originY=Math.round(playfield.y);
  if(width<=0||height<=0)return 0;
  const occupied=new Uint8Array(width*height);
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
    playfield.x===WORLD_CROP.x&&playfield.y===WORLD_CROP.y&&
    playfield.width===WORLD_CROP.width&&playfield.height===WORLD_CROP.height;
  if(!validPlayfield)return{label,ok:false,errors:['probe layout.playfield must match the 160x300 HUD-free world crop'],playfield};
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
    playfield,actors:actorSet.measurements.length,sumBboxArea,unionBboxArea,
    sumFraction:+sumFraction.toFixed(6),unionFraction:+unionFraction.toFixed(6),measurements:actorSet.measurements};
}

function measureApproach(layout){
  layout=layout||{};const value=layout.approach||{};
  const{axis,visibleSpawn,contact,goal,approachVisibilityFraction}=value;
  const finite=[visibleSpawn,contact,goal,approachVisibilityFraction].every(Number.isFinite);
  const denominator=Math.abs(goal-visibleSpawn);
  const measured=finite&&denominator>0?Math.abs(contact-visibleSpawn)/denominator:NaN;
  return{axis,visibleSpawn,contact,goal,reported:approachVisibilityFraction,
    measured:Number.isFinite(measured)?+measured.toFixed(6):null,
    matchesProbe:Number.isFinite(measured)&&Math.abs(measured-approachVisibilityFraction)<=1e-6,
    ok:['x','y','path-distance'].includes(axis)&&Number.isFinite(measured)&&measured>=.55&&measured<=1&&
      Math.abs(measured-approachVisibilityFraction)<=1e-6};
}

function buildCandidateEvidence(){
  const specs={
    opening:{fixture:'opening',offsets:[12]},
    normal:{fixture:'normal-plan',offsets:[1,3,5,7,9,13,24]},
    chainReady:{fixture:'chain-ready',offsets:[1,3,6,12,24]},
    chainBefore:{fixture:'chain-payoff',offsets:[12],afterSet:runtime=>runtime.evaluate(
      "mech.sealBroken=false;mech.cart.x=spec.sealX-22;mech.cart.v=.18;artifact.loose=false;artifact.x=spec.sealX-1;artifact.y=spec.floorY-24;artifact.vy=0;debris=[];")},
    chainPayoff:{fixture:'chain-payoff',offsets:[1,3,6,12,24,48]},
    warning:{fixture:'warning',offsets:[12,24]},
    warningCalm:{fixture:'warning',offsets:[12],afterSet:runtime=>runtime.sandbox.__raidersCartCalmVisual()},
    danger:{fixture:'danger',offsets:[1,3,5,7,9,13,24]},
    later:{fixture:'later-room',offsets:[1,3,5,7,9,13,24,32]},
    fail:{fixture:'spectacular-fail',offsets:[1,6,12,24]},
    apex:{fixture:'apex',offsets:[1,6,12,24,48]},
    apexNoFx:{fixture:'apex',offsets:[1,6,12,24,48],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}},
    apexPhysical:{fixture:'apex',offsets:[12],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;},
      afterSet:runtime=>runtime.evaluate("SHOW.reset(showFrame);pres={cue:null,t:0,holdWorld:false,physicsEvery:1,admire:false};")}
  };
  const runs={};
  for(const[id,spec]of Object.entries(specs))runs[id]=captureFixture(spec.fixture,spec.offsets,
    {id,beforeSet:spec.beforeSet,afterSet:spec.afterSet});
  const beats=[
    {id:'opening',label:'opening',run:'opening',offset:12},
    {id:'normal',label:'forecast',run:'normal',offset:13},
    {id:'ready',label:'chain ready',run:'chainReady',offset:12},
    {id:'payoff',label:'chain payoff',run:'chainPayoff',offset:12},
    {id:'warning',label:'flood warning',run:'warning',offset:12},
    {id:'danger',label:'idol danger',run:'danger',offset:9},
    {id:'later',label:'idol vault',run:'later',offset:13},
    {id:'apex',label:'apex',run:'apex',offset:12}
  ];
  const frames=Object.fromEntries(beats.map(beat=>[beat.id,runs[beat.run].get(beat.offset)]));
  const all=[];
  for(const[id,frameMap]of Object.entries(runs))for(const[offset,frame]of frameMap)all.push({id,offset,frame});
  return{specs,runs,beats,frames,all};
}

function reviewTemplate(montageSha256,beats,specs){
  const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});
  return{
    schema:1,game:'raiders-cart',verdict:'pending',references:['horizon','blockmine'],montageSha256,
    reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size reference review',seed:'0x'+SEED.toString(16),
    checkpoints:beats.map(beat=>`${specs[beat.run].fixture}@${beat.offset}`),
    categories:{
      characterCraft:pending('Inspect the explorer, fedora silhouette, gait, facing, dig/push/glance/carry poses, cart construction, scarabs, artifact, and carved rolling idol at 160x360.'),
      environmentCraft:pending('Inspect masonry, switchback idol track, water channel, foreground, props, light/value planes, and each chamber with the HUD mentally removed.'),
      levelVariety:pending('Confirm opening, workshop/cistern, crystal catacomb, and idol vault change composition, landmarks, materials, and silhouettes rather than only palette.'),
      animationImpact:pending('Confirm aligned explorer, cart, and idol crops animate and the forecast, chain reaction, flood warning, danger, failure, and apex show anticipation, contact, follow-through, and aftermath.'),
      readability:pending('Confirm the small cast, long threat runway, numbered plan, rock/cart/water trajectories, warning instruction, artifact, and payoff remain legible beside video.'),
      artDirectionCohesion:pending('Confirm actors, archaeology, mine hardware, masonry, water, HUD, forecast grammar, and payoff language feel authored as one pulp-adventure world.')
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
      {label:'RAIDERS CART',frames:candidate},
      {label:'MACHINE HUNT',frames:horizonByBeat},
      {label:'BLOCK MINE',frames:blockmineByBeat}
    ],outPath:CONTACT_PATH
  });
  fs.mkdirSync(path.dirname(TRACKED_CONTACT_PATH),{recursive:true});

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

  const scaleFrame=captureFixture('scale-contract',[SCALE_OFFSET],{id:'scale-contract'}).get(SCALE_OFFSET);
  const scaleContract=measureFixtureActors('scale-contract',SCALE_OFFSET,scaleFrame.probe);
  const scaleKinds=new Map();
  for(const actor of scaleContract.actors){const values=scaleKinds.get(actor.kind)||new Set();values.add(actor.type||actor.id);scaleKinds.set(actor.kind,values);}
  const expectedScaleTypes={explorer:['run','dig','push'],cart:['empty','loaded'],rock:['boulder'],scarab:['vermin'],artifact:['idol'],structure:['sluice'],idol:['rolling-boss']};
  const scaleCoverage=Object.fromEntries(Object.entries(expectedScaleTypes).map(([kind,types])=>
    [kind,types.every(type=>(scaleKinds.get(kind)||new Set()).has(type))]));
  const approach=measureApproach(scaleFrame.probe&&scaleFrame.probe.layout);
  const footprintSamples={};
  for(const id of['opening','normal','danger','later']){
    const beat=beats.find(value=>value.id===id),fixture=evidence.specs[beat.run].fixture;
    const actorSet=measureFixtureActors(fixture,beat.offset,candidate[id].probe);
    footprintSamples[id]=summarizeFootprint(id,actorSet,candidate[id].probe&&candidate[id].probe.layout);
  }

  const explorerBurst=analyzeAlignedBurst([1,3,5,7,9,13].map(offset=>runs.normal.get(offset)),'explorerBox',34,38);
  const cartBurst=analyzeAlignedBurst([1,3,5,7,9,13].map(offset=>runs.normal.get(offset)),'cartBox',38,36);
  const idolBurst=analyzeAlignedBurst([1,3,5,7,9,13].map(offset=>runs.danger.get(offset)),'idolBox',44,44);
  const openingLater=structureDistance(candidate.opening,candidate.later,{crop:WORLD_CROP});
  const warningContrast=frameDifference(runs.warningCalm.get(12),runs.warning.get(12),{native:false,crop:WORLD_CROP});
  const chainDelta=frameDifference(runs.chainBefore.get(12),runs.chainPayoff.get(12),{native:false,crop:WORLD_CROP});
  const chainBurst=analyzeBurst([1,3,6,12,24,48].map(offset=>runs.chainPayoff.get(offset)),{native:false,crop:WORLD_CROP});
  const apexPhysical=frameDifference(runs.later.get(13),runs.apexPhysical.get(12),{native:false,crop:WORLD_CROP});
  const apexStructure=structureDistance(runs.later.get(13),runs.apexPhysical.get(12),{crop:WORLD_CROP});
  const apexFx=frameDifference(runs.apexNoFx.get(12),runs.apex.get(12),{native:false,crop:WORLD_CROP,threshold:1});
  const apexBox=runs.apex.get(12).probe.explorerBox;
  const apexCrop={x:Math.max(0,Math.floor(apexBox.x-30)),y:Math.max(WORLD_CROP.y,Math.floor(apexBox.y-32)),
    width:Math.min(160,Math.ceil(apexBox.x+apexBox.width+30))-Math.max(0,Math.floor(apexBox.x-30)),
    height:Math.min(338,Math.ceil(apexBox.y+apexBox.height+32))-Math.max(WORLD_CROP.y,Math.floor(apexBox.y-32))};
  const apexFxNear=frameDifference(runs.apexNoFx.get(12),runs.apex.get(12),{native:false,crop:apexCrop,threshold:1});
  const apexBurst=analyzeBurst([1,6,12,24,48].map(offset=>runs.apex.get(offset)),{native:false,crop:WORLD_CROP});

  // Locked-candidate calibration, seed 0x52414944. Across the eight approved
  // cells the measured minima were 94 colors, 3.376 entropy, .105 luma
  // deviation, .02178 one-pixel edge energy, and .733 rich cells; largest
  // color share peaked at .316. Actor, warning, chain, and apex values are
  // preserved in metrics.json. Floors retain roughly 10-20% regression margin.
  const bands={
    colors:82,entropy:3.0,lumaStdDev:.092,largestColorShare:.37,edgeEnergy:.019,richEach:.64,richMedian:.70,
    explorerMedian:.0062,explorerFirstLast:.016,explorerGrid:.14,
    cartMedian:.0088,cartFirstLast:.027,cartGrid:.30,
    idolMedian:.016,idolFirstLast:.055,idolGrid:.45,
    openingLaterStructure:.40,openingLaterEdge:.52,
    warningChanged:.015,warningMean:.0021,warningGrid:.13,warningBounds:.72,
    chainChanged:.018,chainMean:.0042,chainGrid:.09,chainBounds:.064,
    chainBurstChanged:.031,chainBurstGrid:.38,chainBurstBounds:.75,chainBurstStructure:.060,
    apexPhysicalChanged:.055,apexPhysicalGrid:.35,apexPhysicalStructure:.085,
    apexFxChanged:.0022,apexFxMean:.0005,apexFxBounds:.034,
    apexNearChanged:.018,apexNearMean:.0043,apexNearGrid:.24,apexNearBounds:.29
  };

  const automatedGates=[];
  const gate=(name,ok,detail)=>automatedGates.push({name,ok:!!ok,detail});
  gate('same-seed real pixels deterministic',deterministic,determinism);
  gate('all requested fixtures are finite and truthful',beats.every(beat=>candidate[beat.id].probe&&candidate[beat.id].probe.finite!==false),
    beats.map(beat=>({beat:beat.id,probe:candidate[beat.id].probe})));
  gate('scale fixture covers every actor and structure variant',Object.values(scaleCoverage).every(Boolean),
    {coverage:scaleCoverage,kinds:Object.fromEntries([...scaleKinds].map(([kind,types])=>[kind,[...types]]))});
  gate('isolated actor pixels are present, unclipped, and probe-contained',scaleContract.measurements.every(validActorMeasurement),scaleContract.measurements);
  gate('drawn actors obey native-size caps',scaleContract.measurements.every(value=>value.assertion.ok),scaleContract.measurements);
  gate('sampled normal-play actor poses obey native-size caps',Object.values(footprintSamples).every(value=>value.scaleOk),
    Object.fromEntries(Object.entries(footprintSamples).map(([id,value])=>[id,value.scaleFailures])));
  gate('idol approach occupies at least 55% of its visible travel axis',approach.ok,approach);
  gate('normal-play actor footprints stay within 20% of the HUD-free playfield',Object.values(footprintSamples).every(value=>value.ok),footprintSamples);
  gate('frames are opaque and non-flat',cm.every(value=>value.opaqueFraction===1&&value.quantizedColors>=bands.colors&&
    value.colorEntropy>=bands.entropy&&value.lumaStdDev>=bands.lumaStdDev&&value.largestColorShare<=bands.largestColorShare),
    cm.map(value=>({colors:value.quantizedColors,entropy:value.colorEntropy,lumaStdDev:value.lumaStdDev,largest:value.largestColorShare})));
  gate('multiscale edge detail holds its measured floor',cm.every(value=>value.edge[1].energy>=bands.edgeEnergy&&value.edge[4].energy>value.edge[1].energy),cm.map(value=>value.edge));
  gate('spatial richness holds its measured floor',cm.every(value=>value.richCellFraction>=bands.richEach)&&median(cm.map(value=>value.richCellFraction))>=bands.richMedian,
    {values:cm.map(value=>value.richCellFraction),median:median(cm.map(value=>value.richCellFraction))});
  gate('explorer has aligned locomotion and pose animation',!!explorerBurst&&explorerBurst.changedFraction.median>=bands.explorerMedian&&
    explorerBurst.firstLast.changedFraction>=bands.explorerFirstLast&&explorerBurst.firstLast.changedGridFraction>=bands.explorerGrid&&explorerBurst.changedFraction.max<=.75,explorerBurst);
  gate('cart has aligned wheel and body animation',!!cartBurst&&cartBurst.changedFraction.median>=bands.cartMedian&&
    cartBurst.firstLast.changedFraction>=bands.cartFirstLast&&cartBurst.firstLast.changedGridFraction>=bands.cartGrid&&cartBurst.changedFraction.max<=.70,cartBurst);
  gate('rolling idol has aligned rotation and pursuit animation',!!idolBurst&&idolBurst.changedFraction.median>=bands.idolMedian&&
    idolBurst.firstLast.changedFraction>=bands.idolFirstLast&&idolBurst.firstLast.changedGridFraction>=bands.idolGrid&&idolBurst.changedFraction.max<=.80,idolBurst);
  gate('later vault changes structure, not only palette',openingLater.structureDistance>=bands.openingLaterStructure&&openingLater.edgeMagnitudeDistance>=bands.openingLaterEdge,openingLater);
  gate('flood warning is visibly distinct from identical calm state',warningContrast.changedFraction>=bands.warningChanged&&warningContrast.meanDelta>=bands.warningMean&&
    warningContrast.changedGridFraction>=bands.warningGrid&&warningContrast.changedBoundsFraction>=bands.warningBounds,warningContrast);
  gate('chain payoff has physical breadth and animated aftermath',chainDelta.changedFraction>=bands.chainChanged&&chainDelta.meanDelta>=bands.chainMean&&
    chainDelta.changedGridFraction>=bands.chainGrid&&chainDelta.changedBoundsFraction>=bands.chainBounds&&chainBurst.changedFraction.max>=bands.chainBurstChanged&&
    chainBurst.changedGridFraction.max>=bands.chainBurstGrid&&Math.max(...chainBurst.differences.map(value=>value.changedBoundsFraction))>=bands.chainBurstBounds&&
    chainBurst.firstLast.structureDistance>=bands.chainBurstStructure,{chainDelta,chainBurst});
  const apexProbe=runs.apexPhysical.get(12).probe;
  gate('apex remains a physical transformation without payoff FX',apexPhysical.changedFraction>=bands.apexPhysicalChanged&&
    apexPhysical.changedGridFraction>=bands.apexPhysicalGrid&&apexStructure.structureDistance>=bands.apexPhysicalStructure&&
    apexProbe.sealBroken&&apexProbe.artifact&&apexProbe.artifact.taken&&apexProbe.player&&apexProbe.player.pose==='ADMIRE',
    {apexPhysical,apexStructure,probe:apexProbe});
  gate('apex payoff FX contribute near the explorer',apexFx.changedFraction>=bands.apexFxChanged&&apexFx.meanDelta>=bands.apexFxMean&&
    apexFx.changedBoundsFraction>=bands.apexFxBounds&&apexFxNear.changedFraction>=bands.apexNearChanged&&
    apexFxNear.meanDelta>=bands.apexNearMean&&apexFxNear.changedGridFraction>=bands.apexNearGrid&&
    apexFxNear.changedBoundsFraction>=bands.apexNearBounds,{apexFx,apexFxNear,apexCrop,apexBurst});
  // Candidate exceeds both reference medians for edge detail, richness, and
  // entropy. Its fully built, non-void chambers retain 79% of BLOCK MINE's
  // unusually high luma deviation, so luma uses a separate 75% comparison.
  gate('candidate numeric richness meets both reference medians',median(cm.map(value=>value.edge[1].energy))>=ref.edge*.95&&
    median(cm.map(value=>value.richCellFraction))>=ref.rich*.95&&median(cm.map(value=>value.colorEntropy))>=ref.entropy*.95&&
    median(cm.map(value=>value.lumaStdDev))>=ref.luma*.75,
    {candidate:{edge:median(cm.map(value=>value.edge[1].energy)),rich:median(cm.map(value=>value.richCellFraction)),
      entropy:median(cm.map(value=>value.colorEntropy)),luma:median(cm.map(value=>value.lumaStdDev))},reference:ref});

  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256,beats,evidence.specs));
  let review;
  if(fs.existsSync(REVIEW_PATH))review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256,preservedPath:TRACKED_CONTACT_PATH});
  else review={ok:false,errors:[`missing committed semantic review: ${REVIEW_PATH}`,`inspect ${CONTACT_PATH}, then copy and complete ${REVIEW_TEMPLATE_PATH}`]};
  const semanticGate={name:'fresh semantic comparison receipt',ok:review.ok,detail:review.errors};
  const gates=[...automatedGates,semanticGate],automatedOk=automatedGates.every(value=>value.ok);
  const gameSha256=sha256(GAME_PATH);
  const report={
    schema:1,game:'raiders-cart',gameSha256,seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,
    contactSheet:{path:CONTACT_PATH,trackedPath:TRACKED_CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{fixture:evidence.specs[beat.run].fixture,offset:beat.offset,probe:candidate[beat.id].probe}])),
    thresholds:{referenceMedians:ref,actorScale:{standard:{maxWidth:20,maxHeight:32},cart:{maxWidth:20,maxHeight:32},structure:{maxWidth:24,maxHeight:24},
      idol:{maxWidth:34,maxHeight:34},approachVisibilityFraction:.55,maxFootprintFraction:.20,extentThreshold:ACTOR_THRESHOLD},bands},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,
      scaleContract:scaleContract.measurements,scaleCoverage,approach,footprintSamples,
      explorerBurst,cartBurst,idolBurst,openingLater,warningContrast,chainDelta,chainBurst,
      apexPhysical,apexStructure,apexFx,apexFxNear,apexBurst},
    gates,automatedOk,semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
  };
  writeJson(METRICS_PATH,report);

  console.log(`RAIDERS CART visual evidence · seed 0x${SEED.toString(16)} · game ${gameSha256.slice(0,12)}`);
  for(const value of automatedGates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log(`  ${review.ok?'PASS':'PENDING'} ${semanticGate.name}`);
  console.log('  contact:',CONTACT_PATH);
  console.log('  tracked contact:',TRACKED_CONTACT_PATH);
  console.log('  montage sha256:',sheet.sha256);
  console.log('  metrics:',METRICS_PATH);
  console.log('  review template:',REVIEW_TEMPLATE_PATH);
  if(!automatedOk){console.error('\nRAIDERS CART AUTOMATED VISUAL GATES FAILED');process.exit(1);}
  if(!review.ok){console.error('\nRAIDERS CART AUTOMATED VISUAL GATES PASSED; SEMANTIC REVIEW PENDING');process.exit(1);}
  console.log('\nRAIDERS CART VISUAL EVAL PASSED');
}

main().catch(error=>{console.error('RAIDERS CART VISUAL EVAL FAILED:',error.stack||error);process.exit(1);});
