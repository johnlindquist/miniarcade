#!/usr/bin/env node
'use strict';

// BURROW BOSS real-pixel release gate. Behavioral truth lives in
// burrow-boss-eval.js; this suite stages deterministic authored beats, renders
// the actual canvas, measures native 160x360 RGBA, enforces the scale law from
// isolated sprites, and binds the semantic review to the generated montage.
const fs=require('fs');
const path=require('path');
const{
  bootRenderedGame,rgbaFrame,encodeRgbaPng
}=require('../render/runtime');
const{
  sha256,toNativeFrame,analyzeFrame,frameDifference,structureDistance,analyzeBurst,
  measureDrawnActorExtent,assertActorScale,writeContactSheet,verifyReviewReceipt,
  writeJson,quantile
}=require('./visual-harness');

const ROOT=path.join(__dirname,'..');
const GAME_PATH=path.join(__dirname,'..','burrow-boss.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','burrow-boss');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const TRACKED_CONTACT_PATH=path.join(__dirname,'visual-receipts','burrow-boss-contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','burrow-boss.json');
const SEED=0x42555252,PRE_ROLL=120,RENDER_EVERY=2;
const WORLD_CROP={x:0,y:39,width:160,height:321};
const SCALE_OFFSET=12,ACTOR_PADDING=8,ACTOR_THRESHOLD=8;

if(!fs.existsSync(GAME_PATH)){
  console.error('BURROW BOSS VISUAL EVAL FAILED: missing '+GAME_PATH);
  process.exit(1);
}

const median=values=>quantile(values,.5);

function visualProbe(runtime){
  const fn=runtime.sandbox.__burrowBossVisualProbe;
  if(typeof fn!=='function')throw new Error('burrow-boss.html must expose __burrowBossVisualProbe()');
  const value=fn();
  if(!value||value.finite===false)throw new Error('Burrow Boss visual fixture produced non-finite state');
  return value;
}

function captureFixture(name,offsets,options){
  options=options||{};
  const runtime=bootRenderedGame('burrow-boss',{seed:SEED});
  if(options.beforeSet)options.beforeSet(runtime);
  const setBeat=runtime.sandbox.__burrowBossSetVisualBeat;
  if(typeof setBeat!=='function')throw new Error('burrow-boss.html must expose __burrowBossSetVisualBeat(name)');
  if(setBeat(name)!==true)throw new Error('unknown Burrow Boss visual beat: '+name);
  if(options.actorSelector!==undefined)runtime.sandbox.__BB_VISUAL_ONLY_ACTOR=options.actorSelector;
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
  width=width||44;height=height||width;
  const source=toNativeFrame(frame),cx=Math.round(box.x+box.width/2),cy=Math.round(box.y+box.height/2);
  const out=Buffer.alloc(width*height*4),left=cx-Math.floor(width/2),top=cy-Math.floor(height/2);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=left+x,sy=top+y,dst=(y*width+x)*4;
    if(sx<0||sy<0||sx>=source.width||sy>=source.height){out[dst+3]=255;continue;}
    const src=(sy*source.width+sx)*4;
    out[dst]=source.rgba[src];out[dst+1]=source.rgba[src+1];out[dst+2]=source.rgba[src+2];out[dst+3]=source.rgba[src+3];
  }
  return rgbaFrame(out,width,height,{frame:frame.frame,fixture:frame.fixture,offset:frame.offset});
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
    if(ids.has(actor.id))throw new Error(`${fixture}: duplicate actor id ${actor.id}`);
    ids.add(actor.id);
    const box=actor.box;
    if(!box||![box.x,box.y,box.width,box.height].every(Number.isFinite)||!(box.width>0&&box.height>0))
      throw new Error(`${fixture}: actor ${actor.id} has an invalid probe box`);
  }
  return actors;
}

function actorLimits(actor){
  if(actor.kind==='digger')return{maxWidth:20,maxHeight:32};
  if(actor.kind==='boss')return{maxWidth:34,maxHeight:34};
  if(actor.kind==='structure')return{maxWidth:24,maxHeight:24};
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
    measurements.push(Object.assign(measurement,{
      assertion:{ok:assertion.ok,failures:assertion.failures,limits:assertion.limits}
    }));
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
    Number.isInteger(playfield.width)&&Number.isInteger(playfield.height)&&
    playfield.width===160&&playfield.height>0;
  if(!validPlayfield)return{label,ok:false,errors:['probe layout.playfield must be an integer 160px-wide region'],playfield};
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
  const errors=[...invalid];
  if(sumFraction>.20)errors.push(`${label}: summed actor footprint ${sumFraction.toFixed(4)} > 0.20`);
  return{label,ok:errors.length===0,errors,scaleOk:scaleFailures.length===0,scaleFailures,
    playfield,actors:actorSet.measurements.length,sumBboxArea,unionBboxArea,
    sumFraction:+sumFraction.toFixed(6),unionFraction:+unionFraction.toFixed(6),
    measurements:actorSet.measurements};
}

function measureApproach(layout){
  layout=layout||{};
  const{visibleSpawnX,contactX,goalX,approachVisibilityFraction,
    trapRunways,minApproachVisibilityFraction}=layout;
  const finite=[visibleSpawnX,contactX,goalX,approachVisibilityFraction,minApproachVisibilityFraction].every(Number.isFinite);
  const denominator=visibleSpawnX-goalX;
  const selectedMeasured=finite&&denominator>0?(visibleSpawnX-contactX)/denominator:NaN;
  const rows=Array.isArray(trapRunways)?trapRunways.map(value=>{
    const measured=finite&&denominator>0&&value&&Number.isFinite(value.contactX)
      ?(visibleSpawnX-value.contactX)/denominator:NaN;
    return{id:value&&value.id,contactX:value&&value.contactX,reported:value&&value.fraction,
      measured:Number.isFinite(measured)?+measured.toFixed(6):null,
      matchesProbe:Number.isFinite(measured)&&Number.isFinite(value&&value.fraction)&&
        Math.abs(measured-value.fraction)<=1e-6,
      passes:Number.isFinite(measured)&&measured>=.55};
  }):[];
  const uniqueIds=new Set(rows.map(value=>value.id)),minMeasured=rows.length?Math.min(...rows.map(value=>value.measured)):NaN;
  const selectedMatchesProbe=Number.isFinite(selectedMeasured)&&Math.abs(selectedMeasured-approachVisibilityFraction)<=1e-6;
  const minMatchesProbe=Number.isFinite(minMeasured)&&Math.abs(minMeasured-minApproachVisibilityFraction)<=1e-6;
  const coverageOk=rows.length===8&&uniqueIds.size===rows.length&&rows.every(value=>Number.isFinite(value.id));
  return{visibleSpawnX,contactX,goalX,denominator,
    selected:{reported:approachVisibilityFraction,measured:Number.isFinite(selectedMeasured)?+selectedMeasured.toFixed(6):null,
      matchesProbe:selectedMatchesProbe},
    reportedMin:minApproachVisibilityFraction,minMeasured:Number.isFinite(minMeasured)?+minMeasured.toFixed(6):null,
    minMatchesProbe,coverageOk,runways:rows,
    ok:finite&&denominator>0&&coverageOk&&selectedMatchesProbe&&minMatchesProbe&&
      rows.every(value=>value.matchesProbe&&value.passes)&&minMeasured>=.55};
}

function buildCandidateEvidence(){
  const specs={
    opening:{fixture:'opening',offsets:[12]},
    tunneling:{fixture:'tunneling',offsets:[1,3,5,7,9,13]},
    trapPlan:{fixture:'trap-plan',offsets:[1,6,12,24]},
    trapPlanNoOutline:{fixture:'trap-plan',offsets:[12],afterSet:runtime=>runtime.evaluate('plan=null;texts=[];')},
    lure:{fixture:'lure',offsets:[1,6,12,24]},
    pursuit:{fixture:'pursuit',offsets:[1,3,5,7,9,13,24]},
    danger:{fixture:'danger',offsets:[1,3,5,7,9,13]},
    warning:{fixture:'warning',offsets:[12]},
    warningCalm:{fixture:'warning',offsets:[12],afterSet:runtime=>runtime.evaluate("act.phase='calm';act.safe=null;texts=[];")},
    collapse:{fixture:'collapse',offsets:[1,3,6,9,12,24,36]},
    slip:{fixture:'slip',offsets:[1,6,12,24]},
    slipCaught:{fixture:'slip',offsets:[12],afterSet:runtime=>runtime.evaluate('boss.x=cellX(traps[1].cx);boss.slipT=0;')},
    later:{fixture:'later',offsets:[12]},
    apex:{fixture:'apex',offsets:[1,6,12,24,48]},
    apexNoFx:{fixture:'apex',offsets:[6],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}},
    apexBefore:{fixture:'apex',offsets:[6],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;},afterSet:runtime=>runtime.evaluate(
      "const t=traps[1];t.used=false;t.fall=0;t.impact=false;t.hit=false;t.crack=0;boss.hp=3;boss.stun=0;boss.pose='charge';boss.hitT=0;texts=[];SHOW.reset(showFrame);pres={cue:null,t:0,holdWorld:false,physicsEvery:1,admire:false};")}
  };
  const runs={};
  for(const[id,spec]of Object.entries(specs))runs[id]=captureFixture(spec.fixture,spec.offsets,
    {id,beforeSet:spec.beforeSet,afterSet:spec.afterSet});
  const beats=[
    {id:'opening',label:'opening',run:'opening',offset:12},
    {id:'tunneling',label:'tunneling',run:'tunneling',offset:9},
    {id:'trapPlan',label:'trap outline',run:'trapPlan',offset:12},
    {id:'lure',label:'bait',run:'lure',offset:12},
    {id:'pursuit',label:'pursuit',run:'pursuit',offset:13},
    {id:'danger',label:'close call',run:'danger',offset:9},
    {id:'warning',label:'magma warning',run:'warning',offset:12},
    {id:'collapse',label:'cave-in',run:'collapse',offset:9},
    {id:'slip',label:'monster slips',run:'slip',offset:12},
    {id:'later',label:'prism deep',run:'later',offset:12},
    {id:'apex',label:'boss buried',run:'apex',offset:6}
  ];
  const frames=Object.fromEntries(beats.map(beat=>[beat.id,runs[beat.run].get(beat.offset)]));
  const all=[];
  for(const[id,frameMap]of Object.entries(runs))for(const[offset,frame]of frameMap)all.push({id,offset,frame});
  return{specs,runs,beats,frames,all};
}

function reviewTemplate(montageSha256,beats,specs){
  const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});
  return{
    schema:1,game:'burrow-boss',verdict:'pending',references:['horizon','blockmine'],montageSha256,
    reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size reference review',seed:'0x'+SEED.toString(16),
    checkpoints:beats.map(beat=>`${specs[beat.run].fixture}@${beat.offset}`),
    categories:{
      characterCraft:pending('Inspect the small articulated digger and all four set-piece monsters for silhouette, facing, gait, working, lure, pursuit, slip, impact, and reaction poses at 160x360.'),
      environmentCraft:pending('Inspect strata, tunnel lips, mineworks, roots, fossil choir, ember forge, prism cathedral, survey props, lighting, and foreground rubble with the HUD mentally hidden.'),
      levelVariety:pending('Confirm later chambers change tunnel composition, landmarks, materials, hazards, and silhouettes rather than only palette.'),
      animationImpact:pending('Confirm digging, boss gait, bait, chase, warning, falling geometry, slip, burial, camera response, and aftermath show anticipation, contact, and follow-through.'),
      readability:pending('Confirm the planned cave-in outline, lure path, boss pursuit tell, actors, safe route, collapse, and miss/hit outcomes remain legible beside video at native size.'),
      artDirectionCohesion:pending('Confirm the mining materials, authored actors, gold-mint planning grammar, red danger grammar, chamber palettes, HUD, and payoff treatment feel like one world.')
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
      {label:'BURROW BOSS',frames:candidate},
      {label:'MACHINE HUNT',frames:horizonByBeat},
      {label:'BLOCK MINE',frames:blockmineByBeat}
    ],outPath:CONTACT_PATH
  });
  fs.mkdirSync(path.dirname(TRACKED_CONTACT_PATH),{recursive:true});

  const candidateMetrics=Object.fromEntries(beats.map(beat=>[beat.id,analyzeFrame(candidate[beat.id],{native:false,crop:WORLD_CROP})]));
  const horizonMetrics=beats.map(beat=>analyzeFrame(horizonByBeat[beat.id],{native:false,crop:WORLD_CROP}));
  const blockmineMetrics=beats.map(beat=>analyzeFrame(blockmineByBeat[beat.id],{native:false,crop:WORLD_CROP}));
  const cm=Object.values(candidateMetrics);
  const referenceMedians={
    edge:Math.max(median(horizonMetrics.map(value=>value.edge[1].energy)),median(blockmineMetrics.map(value=>value.edge[1].energy))),
    rich:Math.max(median(horizonMetrics.map(value=>value.richCellFraction)),median(blockmineMetrics.map(value=>value.richCellFraction))),
    entropy:Math.max(median(horizonMetrics.map(value=>value.colorEntropy)),median(blockmineMetrics.map(value=>value.colorEntropy))),
    luma:Math.max(median(horizonMetrics.map(value=>value.lumaStdDev)),median(blockmineMetrics.map(value=>value.lumaStdDev)))
  };
  const referenceFloors={
    edge:Math.min(median(horizonMetrics.map(value=>value.edge[1].energy)),median(blockmineMetrics.map(value=>value.edge[1].energy))),
    rich:Math.min(median(horizonMetrics.map(value=>value.richCellFraction)),median(blockmineMetrics.map(value=>value.richCellFraction)))
  };

  const scaleContracts=[];
  for(let variant=0;variant<4;variant++){
    const fixture=`scale-contract:${variant}`;
    const frame=captureFixture(fixture,[SCALE_OFFSET],{id:fixture}).get(SCALE_OFFSET);
    scaleContracts.push(measureFixtureActors(fixture,SCALE_OFFSET,frame.probe));
  }
  const scaleMeasurements=scaleContracts.flatMap(value=>value.measurements);
  const bossScale=scaleMeasurements.filter(value=>value.kind==='boss');
  const diggerScale=scaleMeasurements.filter(value=>value.kind==='digger');
  const structureScale=scaleMeasurements.filter(value=>value.kind==='structure');
  const scaleCoverage={
    bosses:bossScale.length===4&&new Set(bossScale.map(value=>value.type)).size===4,
    digger:diggerScale.length===4,
    structures:structureScale.length===4
  };

  const footprintSamples={};
  // Opening deliberately introduces the boss through the right screen edge;
  // sample fully visible normal-play poses for footprint and scale instead.
  for(const id of['pursuit','danger','later']){
    const beat=beats.find(value=>value.id===id),fixture=evidence.specs[beat.run].fixture;
    const actorSet=measureFixtureActors(fixture,beat.offset,candidate[id].probe);
    footprintSamples[id]=summarizeFootprint(id,actorSet,candidate[id].probe&&candidate[id].probe.layout);
  }
  const approach=measureApproach(candidate.pursuit.probe&&candidate.pursuit.probe.layout);
  const laterMeasurements=footprintSamples.later.measurements,laterCoverage={
    actors:laterMeasurements.length,
    diggers:laterMeasurements.filter(value=>value.kind==='digger').length,
    bosses:laterMeasurements.filter(value=>value.kind==='boss').length,
    structures:laterMeasurements.filter(value=>value.kind==='structure').length,
    structureIds:laterMeasurements.filter(value=>value.kind==='structure').map(value=>value.id),
    sumFraction:footprintSamples.later.sumFraction
  };
  laterCoverage.ok=laterCoverage.actors===10&&laterCoverage.diggers===1&&laterCoverage.bosses===1&&
    laterCoverage.structures===8&&new Set(laterCoverage.structureIds).size===8&&
    footprintSamples.later.ok&&laterCoverage.sumFraction<=.20;

  const diggerBurst=analyzeAlignedBurst([1,3,5,7,9,13].map(offset=>runs.tunneling.get(offset)),'diggerBox',44,44);
  const bossBurst=analyzeAlignedBurst([1,3,5,7,9,13,24].map(offset=>runs.pursuit.get(offset)),'bossBox',52,48);
  const trapOutlineDelta=frameDifference(runs.trapPlanNoOutline.get(12),candidate.trapPlan,{native:false,crop:WORLD_CROP});
  const trapOutlineBurst=analyzeBurst([1,6,12,24].map(offset=>runs.trapPlan.get(offset)),{native:false,crop:WORLD_CROP});
  const warningContrast=frameDifference(runs.warningCalm.get(12),candidate.warning,{native:false,crop:WORLD_CROP});
  const earlyLater=structureDistance(candidate.opening,candidate.later,{crop:WORLD_CROP});
  const collapseBurst=analyzeBurst([1,3,6,9,12,24,36].map(offset=>runs.collapse.get(offset)),{native:false,crop:WORLD_CROP});
  const collapseContact=frameDifference(runs.collapse.get(1),runs.collapse.get(9),{native:false,crop:WORLD_CROP});
  const slipDelta=frameDifference(runs.slipCaught.get(12),candidate.slip,{native:false,crop:WORLD_CROP});
  const slipBoss=candidate.slip.probe.actors.find(value=>value.kind==='boss');
  const slipTrap=candidate.slip.probe.actors.find(value=>value.kind==='structure');
  const slipSeparation=slipBoss&&slipTrap?Math.abs(
    slipBoss.box.x+slipBoss.box.width/2-(slipTrap.box.x+slipTrap.box.width/2)):null;
  const apexPhysical=frameDifference(runs.apexBefore.get(6),candidate.apex,{native:false,crop:WORLD_CROP,threshold:1});
  const apexStructure=structureDistance(runs.apexBefore.get(6),candidate.apex,{crop:WORLD_CROP});
  const apexFx=frameDifference(runs.apexNoFx.get(6),candidate.apex,{native:false,crop:WORLD_CROP,threshold:1});
  const apexBurst=analyzeBurst([1,6,12,24,48].map(offset=>runs.apex.get(offset)),{native:false,crop:WORLD_CROP});

  // Fixed-seed calibration for the approved candidate capture, retaining
  // roughly 10-20% regression margin. Across the eleven native cells the
  // measured minima were 97 colors, 3.231 entropy, .106 luma deviation,
  // .0256 one-pixel edge energy, and .956 rich cells. Local actor, plan,
  // collapse, slip, warning, and apex measurements are preserved below in
  // metrics.json beside these executable floors.
  const bands={
    colors:85,entropy:2.90,lumaStdDev:.095,largestColorShare:.47,
    edgeEnergy:.022,richEach:.84,richMedian:.90,
    diggerMedian:.022,diggerFirstLast:.04,diggerGrid:.18,
    bossMedian:.021,bossFirstLast:.026,bossGrid:.18,
    outlineChanged:.014,outlineMean:.0022,outlineGrid:.088,outlineBounds:.045,outlineBurst:.0038,
    warningChanged:.68,warningMean:.031,warningGrid:.85,warningBounds:.84,
    laterStructure:.38,laterEdge:.44,
    collapseChanged:.0045,collapseMean:.00070,collapseGrid:.035,collapseBounds:.040,
    collapseBurstChanged:.0035,collapseBurstGrid:.035,collapseStructure:.0075,
    slipChanged:.014,slipMean:.0035,slipGrid:.035,slipBounds:.020,slipSeparation:15,
    apexChanged:.82,apexMean:.052,apexGrid:.85,apexBounds:.82,apexStructure:.065,
    apexFxChanged:.0024,apexFxMean:.00060,apexFxGrid:.035,apexFxBounds:.011,apexBurstGrid:.066
  };

  const automatedGates=[];
  const gate=(name,ok,detail)=>automatedGates.push({name,ok:!!ok,detail});
  gate('same-seed real pixels deterministic',deterministic,determinism);
  gate('all requested fixtures are finite and truthful',beats.every(beat=>candidate[beat.id].probe&&candidate[beat.id].probe.finite!==false),
    beats.map(beat=>({beat:beat.id,probe:candidate[beat.id].probe})));
  gate('scale fixture covers all four bosses, digger, and trap structure',Object.values(scaleCoverage).every(Boolean),
    {coverage:scaleCoverage,bossTypes:bossScale.map(value=>value.type)});
  gate('isolated actor pixels are present, unclipped, and probe-contained',scaleMeasurements.every(validActorMeasurement),scaleMeasurements);
  gate('all four drawn bosses are at most 34px wide',bossScale.length===4&&bossScale.every(value=>value.assertion.ok),bossScale);
  gate('drawn digger obeys 20x32 cap',diggerScale.length===4&&diggerScale.every(value=>value.assertion.ok),diggerScale);
  gate('drawn trap structures obey 24px cap',structureScale.length===4&&structureScale.every(value=>value.assertion.ok),structureScale);
  gate('sampled normal-play actor poses obey native-size caps',Object.values(footprintSamples).every(value=>value.scaleOk),
    Object.fromEntries(Object.entries(footprintSamples).map(([id,value])=>[id,value.scaleFailures])));
  gate('all eight trap runways recompute exactly and worst case is at least 55%',approach.ok,approach);
  gate('normal-play actor footprints stay within 20% of the playfield',Object.values(footprintSamples).every(value=>value.ok),footprintSamples);
  gate('later footprint covers digger, boss, and all eight trap structures within 20%',laterCoverage.ok,laterCoverage);
  gate('frames are opaque and non-flat',cm.every(value=>value.opaqueFraction===1&&value.quantizedColors>=bands.colors&&
    value.colorEntropy>=bands.entropy&&value.lumaStdDev>=bands.lumaStdDev&&value.largestColorShare<=bands.largestColorShare),
    cm.map(value=>({colors:value.quantizedColors,entropy:value.colorEntropy,lumaStdDev:value.lumaStdDev,largest:value.largestColorShare})));
  gate('multiscale edge detail meets measured and reference floors',cm.every(value=>value.edge[1].energy>=Math.max(bands.edgeEnergy,referenceFloors.edge*.85)&&value.edge[4].energy>value.edge[1].energy),
    {candidate:cm.map(value=>value.edge),referenceFloor:referenceFloors.edge});
  gate('spatial richness meets measured and reference floors',cm.every(value=>value.richCellFraction>=bands.richEach)&&
    median(cm.map(value=>value.richCellFraction))>=Math.max(bands.richMedian,referenceFloors.rich*.90),
    {candidate:cm.map(value=>value.richCellFraction),candidateMedian:median(cm.map(value=>value.richCellFraction)),referenceFloor:referenceFloors.rich});
  gate('digger has aligned work animation',!!diggerBurst&&diggerBurst.changedFraction.median>=bands.diggerMedian&&
    diggerBurst.firstLast.changedFraction>=bands.diggerFirstLast&&diggerBurst.firstLast.changedGridFraction>=bands.diggerGrid&&
    diggerBurst.changedFraction.max<=.75,diggerBurst);
  gate('boss has aligned pursuit animation',!!bossBurst&&bossBurst.changedFraction.median>=bands.bossMedian&&
    bossBurst.firstLast.changedFraction>=bands.bossFirstLast&&bossBurst.firstLast.changedGridFraction>=bands.bossGrid&&
    bossBurst.changedFraction.max<=.75,bossBurst);
  gate('planned cave-in outline and lure route are visibly present',trapOutlineDelta.changedFraction>=bands.outlineChanged&&
    trapOutlineDelta.meanDelta>=bands.outlineMean&&trapOutlineDelta.changedGridFraction>=bands.outlineGrid&&
    trapOutlineDelta.changedBoundsFraction>=bands.outlineBounds&&trapOutlineBurst.changedFraction.max>=bands.outlineBurst,
    {trapOutlineDelta,trapOutlineBurst});
  gate('environmental warning is visibly broad',warningContrast.changedFraction>=bands.warningChanged&&
    warningContrast.meanDelta>=bands.warningMean&&warningContrast.changedGridFraction>=bands.warningGrid&&
    warningContrast.changedBoundsFraction>=bands.warningBounds,warningContrast);
  gate('later chamber changes structure, not only palette',earlyLater.structureDistance>=bands.laterStructure&&
    earlyLater.edgeMagnitudeDistance>=bands.laterEdge,earlyLater);
  gate('cave-in has physical falling geometry and aftermath',collapseContact.changedFraction>=bands.collapseChanged&&
    collapseContact.meanDelta>=bands.collapseMean&&collapseContact.changedGridFraction>=bands.collapseGrid&&
    collapseContact.changedBoundsFraction>=bands.collapseBounds&&collapseBurst.changedFraction.max>=bands.collapseBurstChanged&&
    collapseBurst.changedGridFraction.max>=bands.collapseBurstGrid&&collapseBurst.firstLast.structureDistance>=bands.collapseStructure,
    {collapseContact,collapseBurst});
  gate('monster slip is visibly outside the cave-in contact',Number.isFinite(slipSeparation)&&slipSeparation>=bands.slipSeparation&&
    slipDelta.changedFraction>=bands.slipChanged&&slipDelta.meanDelta>=bands.slipMean&&
    slipDelta.changedGridFraction>=bands.slipGrid&&slipDelta.changedBoundsFraction>=bands.slipBounds,
    {slipSeparation,slipDelta,boss:slipBoss,structure:slipTrap});
  gate('boss burial is a broad physical apex',apexPhysical.changedFraction>=bands.apexChanged&&
    apexPhysical.meanDelta>=bands.apexMean&&apexPhysical.changedGridFraction>=bands.apexGrid&&
    apexPhysical.changedBoundsFraction>=bands.apexBounds&&apexStructure.structureDistance>=bands.apexStructure,
    {apexPhysical,apexStructure});
  gate('apex payoff FX land on the physical burial',apexFx.changedFraction>=bands.apexFxChanged&&
    apexFx.meanDelta>=bands.apexFxMean&&apexFx.changedGridFraction>=bands.apexFxGrid&&
    apexFx.changedBoundsFraction>=bands.apexFxBounds&&
    apexBurst.changedGridFraction.max>=bands.apexBurstGrid,{apexFx,apexBurst});
  gate('candidate numeric richness meets both reference medians',median(cm.map(value=>value.edge[1].energy))>=referenceMedians.edge*.85&&
    median(cm.map(value=>value.richCellFraction))>=referenceMedians.rich*.90&&
    median(cm.map(value=>value.colorEntropy))>=referenceMedians.entropy*.90&&
    median(cm.map(value=>value.lumaStdDev))>=referenceMedians.luma*.65,
    {candidate:{edge:median(cm.map(value=>value.edge[1].energy)),rich:median(cm.map(value=>value.richCellFraction)),
      entropy:median(cm.map(value=>value.colorEntropy)),luma:median(cm.map(value=>value.lumaStdDev))},reference:referenceMedians});

  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256,beats,evidence.specs));
  let review;
  if(fs.existsSync(REVIEW_PATH))review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256,preservedPath:TRACKED_CONTACT_PATH});
  else review={ok:false,errors:[`missing committed semantic review: ${REVIEW_PATH}`,`inspect ${CONTACT_PATH}, then copy and complete ${REVIEW_TEMPLATE_PATH}`]};
  const semanticGate={name:'fresh semantic comparison receipt',ok:review.ok,detail:review.errors};
  const gates=[...automatedGates,semanticGate],automatedOk=automatedGates.every(value=>value.ok);
  const gameSha256=sha256(GAME_PATH);
  const report={
    schema:1,game:'burrow-boss',gameSha256,seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,
    contactSheet:{path:CONTACT_PATH,trackedPath:TRACKED_CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{fixture:evidence.specs[beat.run].fixture,offset:beat.offset,probe:candidate[beat.id].probe}])),
    thresholds:{referenceMedians,referenceFloors,
      actorScale:{digger:{maxWidth:20,maxHeight:32},boss:{maxWidth:34,maxHeight:34},structure:{maxWidth:24,maxHeight:24},
        approachVisibilityFraction:.55,maxFootprintFraction:.20,extentThreshold:ACTOR_THRESHOLD},bands},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,
      scaleContract:scaleMeasurements,scaleCoverage,approach,footprintSamples,laterCoverage,diggerBurst,bossBurst,
      trapOutlineDelta,trapOutlineBurst,warningContrast,earlyLater,collapseContact,collapseBurst,
      slipDelta,slipSeparation,apexPhysical,apexStructure,apexFx,apexBurst},
    gates,automatedOk,semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
  };
  writeJson(METRICS_PATH,report);

  console.log(`BURROW BOSS visual evidence · seed 0x${SEED.toString(16)} · game ${gameSha256.slice(0,12)}`);
  for(const value of automatedGates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log(`  ${review.ok?'PASS':'PENDING'} ${semanticGate.name}`);
  console.log('  contact:',CONTACT_PATH);
  console.log('  tracked contact:',TRACKED_CONTACT_PATH);
  console.log('  montage sha256:',sheet.sha256);
  console.log('  metrics:',METRICS_PATH);
  console.log('  review template:',REVIEW_TEMPLATE_PATH);
  if(!automatedOk){console.error('\nBURROW BOSS AUTOMATED VISUAL GATES FAILED');process.exit(1);}
  if(!review.ok){console.error('\nBURROW BOSS AUTOMATED VISUAL GATES PASSED; SEMANTIC REVIEW PENDING');process.exit(1);}
  console.log('\nBURROW BOSS VISUAL EVAL PASSED');
}

main().catch(error=>{console.error('BURROW BOSS VISUAL EVAL FAILED:',error.stack||error);process.exit(1);});
