#!/usr/bin/env node
'use strict';

// FROG CONVOY real-pixel release gate. Behavioral truth lives in the paired
// and soak suite; this renders the actual canvas at native 160x360, measures
// authored beats, compares them beside MACHINE HUNT and BLOCK MINE, and binds
// the semantic judgment to the exact montage bytes.
const fs=require('fs');
const path=require('path');
const{bootRenderedGame,rgbaFrame,encodeRgbaPng}=require('../render/runtime');
const{sha256,toNativeFrame,analyzeFrame,frameDifference,structureDistance,analyzeBurst,
  measureDrawnActorExtent,assertActorScale,writeContactSheet,verifyReviewReceipt,writeJson,quantile}=require('./visual-harness');

const ROOT=path.join(__dirname,'..');
const GAME_PATH=path.join(__dirname,'..','frog-convoy.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','frog-convoy');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','frog-convoy.json');
const PRESERVED_CONTACT_PATH=path.join(__dirname,'visual-receipts','frog-convoy-contact-sheet.png');
const SEED=0xf09c0,RENDER_EVERY=2;
const WORLD_CROP={x:0,y:28,width:160,height:308};
const ACTOR_THRESHOLD=8,ACTOR_PADDING=10;
const median=values=>quantile(values,.5);

if(!fs.existsSync(GAME_PATH)){console.error('FROG CONVOY VISUAL EVAL FAILED: missing '+GAME_PATH);process.exit(1);}

function visualProbe(runtime){
  const value=runtime.probe('__frogConvoyVisualProbe');
  if(!value||value.finite===false)throw new Error('frog-convoy visual fixture produced non-finite state');
  return JSON.parse(JSON.stringify(value));
}
function captureFixture(name,offsets,options){
  options=options||{};const runtime=bootRenderedGame('frog-convoy',{seed:SEED});
  if(typeof runtime.sandbox.__frogConvoySetVisualBeat!=='function')throw new Error('frog-convoy.html must expose __frogConvoySetVisualBeat(name)');
  runtime.sandbox.__frogConvoySetVisualBeat(name);
  if(options.selector!==undefined)runtime.sandbox.__FC_VISUAL_ONLY_SUBJECT=options.selector;
  if(options.afterSet)options.afterSet(runtime);
  const frames=new Map();for(const target of [...new Set(offsets)].sort((a,b)=>a-b)){
    runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});const frame=runtime.snapshot({native:true});
    frame.probe=visualProbe(runtime);frame.fixture=options.id||name;frame.offset=target;frames.set(target,frame);
  }return frames;
}
// Owner scale directive (2026-07-11), measured on drawn pixels via isolated
// subject renders. Redrawn art measures: leader 9x11, passengers 7x7..7x9,
// pickup 8x12, car 15x11, truck 23x11, bus 23x12, log 55x12, croc 32x17.
// Caps encode the directive with small margin — hero <=14 (Block Mine 12 is
// the largest a hero may ever be), routine frogs <=12, car at the Pocket
// League 14px reference, large vehicles <=24. Logs keep their full simulated
// standing length (drawing them shorter would lie about where frogs can
// stand), so the platform cap is length-derived, and only their girth is art.
function limitsFor(actor){
  if(actor.kind==='boss')return{maxWidth:34,maxHeight:18,label:'boss '+actor.type};
  if(actor.kind==='platform')return{maxWidth:58,maxHeight:15,label:'platform '+actor.type};
  if(actor.kind==='vehicle')return actor.type==='car'?{maxWidth:16,maxHeight:12,label:'vehicle car'}:{maxWidth:24,maxHeight:14,label:'vehicle '+actor.type};
  if(actor.type==='leader')return{maxWidth:14,maxHeight:14,label:'frog leader'};
  if(actor.type==='pickup')return{maxWidth:12,maxHeight:14,label:'frog pickup'};
  return{maxWidth:12,maxHeight:12,label:'frog '+actor.type};
}
function probeSubjects(probe,fixture){
  if(!Array.isArray(probe&&probe.actors)||!probe.actors.length)throw new Error(`${fixture}: visual probe must expose actors[]`);
  const ids=new Set();
  for(const actor of probe.actors){
    if(!actor||typeof actor.id!=='string'||!actor.id||typeof actor.kind!=='string')throw new Error(`${fixture}: malformed subject`);
    if(ids.has(actor.id))throw new Error(`${fixture}: duplicate subject ${actor.id}`);ids.add(actor.id);
    const b=actor.box;if(!b||![b.x,b.y,b.width,b.height].every(Number.isFinite)||!(b.width>0&&b.height>0))throw new Error(`${fixture}: invalid box for ${actor.id}`);
  }return probe.actors;
}
function measureSubjects(fixture,offset){
  const baseline=captureFixture(fixture,[offset],{selector:'none',id:fixture+'-none'}).get(offset),actors=probeSubjects(baseline.probe,fixture),measurements=[];
  for(const actor of actors){
    const isolated=captureFixture(fixture,[offset],{selector:actor.id,id:`${fixture}-${actor.id}`}).get(offset),
      measurement=measureDrawnActorExtent(isolated,baseline,{id:actor.id,kind:actor.kind,type:actor.type,probeBox:actor.box,padding:ACTOR_PADDING,threshold:ACTOR_THRESHOLD}),
      assertion=assertActorScale(measurement,limitsFor(actor));
    measurements.push(Object.assign(measurement,{assertion:{ok:assertion.ok,failures:assertion.failures,limits:assertion.limits}}));
  }return{fixture,offset,probe:baseline.probe,measurements};
}
// The scale gate proves every drawn extent fits inside its probe box, so the
// probe boxes are honest upper bounds and footprint can be summed cheaply.
function probeFootprint(frame){
  const probe=frame.probe,playfield=probe.layout&&probe.layout.playfield;
  if(!playfield)throw new Error(frame.fixture+': probe must expose layout.playfield');
  const counted=probeSubjects(probe,frame.fixture).filter(a=>a.kind==='frog'||a.kind==='vehicle'||a.kind==='boss'),
    sum=counted.reduce((n,a)=>n+a.box.width*a.box.height,0);
  return{fixture:frame.fixture,actorCount:counted.length,sumBoxArea:sum,sumFraction:sum/(playfield.width*playfield.height)};
}
function captureTimeline(name,seed,targets){
  const runtime=bootRenderedGame(name,{seed}),frames=new Map();for(const target of [...targets].sort((a,b)=>a-b)){
    runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});frames.set(target,runtime.snapshot({native:true}));
  }return frames;
}
function fixedCrop(frame,box,size){
  size=size||44;const source=toNativeFrame(frame),out=Buffer.alloc(size*size*4),cx=Math.round(box.x+box.width/2),cy=Math.round(box.y+box.height/2),left=cx-Math.floor(size/2),top=cy-Math.floor(size/2);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const sx=left+x,sy=top+y,dst=(y*size+x)*4;if(sx<0||sy<0||sx>=source.width||sy>=source.height){out[dst+3]=255;continue;}
    const src=(sy*source.width+sx)*4;out[dst]=source.rgba[src];out[dst+1]=source.rgba[src+1];out[dst+2]=source.rgba[src+2];out[dst+3]=source.rgba[src+3];}
  return rgbaFrame(out,size,size,{fixture:frame.fixture,offset:frame.offset});
}
function alignedBurst(frames,boxAt){
  const crops=frames.map((frame,index)=>fixedCrop(frame,boxAt(frame,index),44)),differences=[];
  for(let i=1;i<crops.length;i++)differences.push(frameDifference(crops[i-1],crops[i],{native:false}));
  return{frames:crops.length,differences,changedFraction:{min:Math.min(...differences.map(v=>v.changedFraction)),median:median(differences.map(v=>v.changedFraction)),max:Math.max(...differences.map(v=>v.changedFraction))},
    firstLast:frameDifference(crops[0],crops.at(-1),{native:false})};
}
function buildCandidate(){
  const specs={
    opening:[1,12],normal:[1,3,5,7,12,18],family:[1,3,5,7,12],danger:[1,12,24],
    sacrifice:[1,6,12,24,36],later:[1,12,24],apex:[1,6,12,24,48,72,96,120]
  },runs={};for(const[name,offsets]of Object.entries(specs))runs[name]=captureFixture(name,offsets);
  runs.dangerCalm=captureFixture('danger',[12],{id:'dangerCalm',afterSet:r=>r.evaluate("globalThis.__NO_ACTS=1;act.phase='calm';banner.t=0;")});
  runs.sacrificeCalm=captureFixture('sacrifice',[12],{id:'sacrificeCalm',afterSet:r=>r.evaluate("lostGhosts=[];banner.t=0;leader.panicT=0;leader.lookT=0;for(const f of passengers)f.panicT=0;")});
  runs.apexCalm=captureFixture('apex',[1],{id:'apexCalm',afterSet:r=>r.evaluate("state='run';arrival=null;banner.t=0;pres={cue:null,t:0,holdWorld:false,physicsEvery:1,admire:false};SHOW.reset(showFrame);")});
  for(let i=0;i<4;i++)runs['season'+i]=captureFixture('family',[12],{id:'season'+i,afterSet:r=>r.evaluate(`seasonIndex=${i};act.phase='calm';banner.t=0;`)});
  const beats=[
    {id:'opening',label:'opening',offset:12},{id:'normal',label:'road convoy',offset:12},
    {id:'family',label:'five together',offset:12},{id:'danger',label:'flood warning',offset:12},
    {id:'sacrifice',label:'sacrifice',offset:12},{id:'later',label:'flood season',offset:12},
    {id:'apex',label:'whole family',offset:120}
  ],frames=Object.fromEntries(beats.map(b=>[b.id,runs[b.id].get(b.offset)])),all=[];
  for(const[id,map]of Object.entries(runs))for(const[offset,frame]of map)all.push({id,offset,frame});return{specs,runs,beats,frames,all};
}
function reviewTemplate(hash){const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});return{
  schema:1,game:'frog-convoy',verdict:'pending',references:['horizon','blockmine'],montageSha256:hash,reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size reference review',seed:'0x'+SEED.toString(16),
  categories:{
    characterCraft:pending('Inspect lead construction, passenger identities, facing, hop poses, reactions, and sacrifice at 160x360.'),
    environmentCraft:pending('Inspect layered town, road materials, river current, logs, vehicles, banks, landmarks, and foreground reeds with HUD ignored.'),
    levelVariety:pending('Confirm spring, midsummer, autumn, and flood seasons change silhouettes and landmarks, not only palette.'),
    animationImpact:pending('Confirm convoy delay, leap arcs, danger warning, sacrifice flight, sequential arrival, and broad homecoming have anticipation and follow-through.'),
    readability:pending('Confirm lead, passengers, vehicle gaps, logs, warning refuge, family count, and tactic remain legible at native size, and that no guideline overlays (path lines, predicted arcs, future-position reticles) are drawn at any beat.'),
    artDirectionCohesion:pending('Confirm frog anatomy, marsh material triples, traffic, landmark language, HUD, and payoff colors feel authored as one world.')
  }};}

function main(){
  fs.mkdirSync(FRAME_DIR,{recursive:true});for(const file of fs.readdirSync(FRAME_DIR))if(file.endsWith('.png'))fs.unlinkSync(path.join(FRAME_DIR,file));
  const evidence=buildCandidate(),{beats,frames:candidate}=evidence,determinism=beats.map(beat=>{const other=captureFixture(beat.id,[beat.offset]).get(beat.offset),a=sha256(candidate[beat.id].rgba),b=sha256(other.rgba);return{fixture:beat.id,offset:beat.offset,a,b,ok:a===b};}),
    refTargets=[60,420,780,1140,1500,1860,2220],horizon=captureTimeline('horizon',0xa1020401,refTargets),blockmine=captureTimeline('blockmine',0xb10c0050,refTargets),horizonByBeat={},blockmineByBeat={};
  beats.forEach((beat,index)=>{horizonByBeat[beat.id]=horizon.get(refTargets[index]);blockmineByBeat[beat.id]=blockmine.get(refTargets[index]);
    fs.writeFileSync(path.join(FRAME_DIR,`${String(index+1).padStart(2,'0')}-${beat.id}.png`),encodeRgbaPng(candidate[beat.id]));});
  for(const[id,map]of Object.entries(evidence.runs))for(const[offset,frame]of map)fs.writeFileSync(path.join(FRAME_DIR,`burst-${id}-${String(offset).padStart(3,'0')}.png`),encodeRgbaPng(frame));
  const sheet=writeContactSheet({beats:beats.map(b=>({id:b.id,label:b.label})),rows:[{label:'FROG CONVOY',frames:candidate},{label:'MACHINE HUNT',frames:horizonByBeat},{label:'BLOCK MINE',frames:blockmineByBeat}],outPath:CONTACT_PATH});

  const candidateMetrics=Object.fromEntries(beats.map(b=>[b.id,analyzeFrame(candidate[b.id],{native:false,crop:WORLD_CROP})])),cm=Object.values(candidateMetrics),
    horizonMetrics=beats.map(b=>analyzeFrame(horizonByBeat[b.id],{native:false,crop:WORLD_CROP})),blockmineMetrics=beats.map(b=>analyzeFrame(blockmineByBeat[b.id],{native:false,crop:WORLD_CROP})),
    refEdge=Math.min(median(horizonMetrics.map(m=>m.edge[1].energy)),median(blockmineMetrics.map(m=>m.edge[1].energy))),refRich=Math.min(median(horizonMetrics.map(m=>m.richCellFraction)),median(blockmineMetrics.map(m=>m.richCellFraction)));
  const normalFrames=[1,3,5,7,12,18].map(o=>evidence.runs.normal.get(o)),leadBurst=alignedBurst(normalFrames,f=>f.probe.leaderBox),
    passengerBurst=alignedBurst(normalFrames,f=>f.probe.chainBoxes[0]),seasonFrames=Object.fromEntries([0,1,2,3].map(i=>['season'+i,evidence.runs['season'+i].get(12)])),
    seasonPairs=[['season0','season1'],['season0','season2'],['season0','season3'],['season1','season2'],['season1','season3'],['season2','season3']].map(([a,b])=>({a,b,...structureDistance(seasonFrames[a],seasonFrames[b],{crop:WORLD_CROP})})),
    warningDelta=frameDifference(evidence.runs.dangerCalm.get(12),candidate.danger,{native:false,crop:WORLD_CROP}),
    sacrificeDelta=frameDifference(evidence.runs.sacrificeCalm.get(12),candidate.sacrifice,{native:false,crop:WORLD_CROP}),
    sacrificeBurst=analyzeBurst([1,6,12,24,36].map(o=>evidence.runs.sacrifice.get(o)),{native:false,crop:WORLD_CROP}),
    apexDelta=frameDifference(evidence.runs.apexCalm.get(1),evidence.runs.apex.get(1),{native:false,crop:WORLD_CROP}),
    apexBurst=analyzeBurst([1,6,24,48,72,96,120].map(o=>evidence.runs.apex.get(o)),{native:false,crop:WORLD_CROP}),
    bandSeparations=cm.map(m=>Math.max(...m.bandLuma)-Math.min(...m.bandLuma));

  const gates=[],gate=(name,ok,detail)=>gates.push({name,ok:!!ok,detail});
  gate('same-seed real pixels deterministic',determinism.every(v=>v.ok),determinism);
  gate('all authored fixtures are finite and truthful',beats.every(b=>candidate[b.id].probe&&candidate[b.id].probe.finite!==false),beats.map(b=>({beat:b.id,probe:candidate[b.id].probe})));
  // Re-derived on the 2026-07-11 reference-scale art (small actors + density
  // pass): measured 286..373 colors, 4.73..5.22 entropy, .124..171 luma
  // deviation, .126..172 largest share. Floors pin that density with margin.
  gate('native frames are opaque and non-flat',cm.every(m=>m.width===160&&m.height===360&&m.opaqueFraction===1&&m.quantizedColors>=230&&m.colorEntropy>=4.3&&m.lumaStdDev>=.10&&m.largestColorShare<=.21),cm.map(m=>({colors:m.quantizedColors,entropy:m.colorEntropy,lumaStdDev:m.lumaStdDev,largest:m.largestColorShare})));
  // Measured band separations on the shipped art: 11.1..30.0, median 22.4.
  gate('foreground, midground, and background retain value separation',bandSeparations.every(v=>v>=7)&&median(bandSeparations)>=14,bandSeparations);
  // Measured rich-cell fraction .933..956 per beat after the density pass.
  gate('multiscale detail is reference-comparable',median(cm.map(m=>m.edge[1].energy))>=refEdge*.72&&median(cm.map(m=>m.richCellFraction))>=refRich*.72&&cm.every(m=>m.richCellFraction>=.85),
    {candidateEdge:median(cm.map(m=>m.edge[1].energy)),referenceEdge:refEdge,candidateRich:median(cm.map(m=>m.richCellFraction)),referenceRich:refRich});
  // Hop-cycle bursts, re-measured on the small frogs (aligned 44px crops):
  // lead max .583 / firstLast .659 / grid 1.0; passenger max .512 / .663 / 1.0.
  gate('authored lead has aligned hop animation',leadBurst.changedFraction.max>=.2&&leadBurst.firstLast.changedFraction>=.3&&leadBurst.firstLast.changedGridFraction>=.5&&leadBurst.changedFraction.max<=.72,leadBurst);
  gate('passenger has delayed locomotion animation',passengerBurst.changedFraction.max>=.2&&passengerBurst.firstLast.changedFraction>=.3&&passengerBurst.firstLast.changedGridFraction>=.5&&passengerBurst.changedFraction.max<=.72,passengerBurst);
  // Same-state, same-actor captures isolate the authored season structures.
  // Re-measured 2026-07-11 on the reference-scale art: .099 spring/summer,
  // .148 spring/autumn, .167 summer/autumn, .306..316 for every drowned-town
  // flood pair (median .237). Floors require real silhouette replacement.
  gate('season progression changes composition, not only palette',seasonPairs.every(p=>p.structureDistance>=.09)&&median(seasonPairs.map(p=>p.structureDistance))>=.19&&Math.max(...seasonPairs.map(p=>p.structureDistance))>=.27,seasonPairs);
  // Measured warn-vs-calm delta: cf .436, grid .733, bounds .688.
  gate('flood warning changes the world before land',candidate.danger.probe.act==='warn'&&candidate.danger.probe.passengers>=4&&/FLOOD|CREST/.test(candidate.danger.probe.tactic)&&warningDelta.changedFraction>=.15&&warningDelta.changedGridFraction>=.5&&warningDelta.changedBoundsFraction>=.45,warningDelta);
  // Measured sacrifice evidence: delta cf .157 / grid .444, burst max .124,
  // firstLast structure .189 — small frogs still carry the beat bodily.
  gate('sacrifice is bodily visible and spatially authored',candidate.sacrifice.probe.sacrifice===true&&sacrificeDelta.changedFraction>=.05&&sacrificeDelta.changedGridFraction>=.2&&sacrificeBurst.changedFraction.max>=.06&&sacrificeBurst.firstLast.structureDistance>=.08,{probe:candidate.sacrifice.probe,sacrificeDelta,sacrificeBurst});
  // Measured apex evidence: delta cf .939 / grid 1.0, burst max .783 / grid
  // 1.0, firstLast structure .229.
  gate('whole-family arrival is truthful and spatially broad',candidate.apex.probe.whole===true&&candidate.apex.probe.passengers===5&&apexDelta.changedFraction>=.3&&apexDelta.changedGridFraction>=.7&&apexBurst.changedFraction.max>=.3&&apexBurst.changedGridFraction.max>=.8&&apexBurst.firstLast.structureDistance>=.12,{probe:candidate.apex.probe,apexDelta,apexBurst});

  // Drawn-pixel actor scale census: one exemplar of every actor family on the
  // frozen 'scale' fixture, measured from isolated renders against a clean
  // plate. Fails on cap overshoot, crop clipping, or probe-box overflow.
  const scale=measureSubjects('scale',4);
  const scaleOk=scale.measurements.every(m=>m.assertion.ok&&!m.clipped&&!(m.probeOverflow&&m.probeOverflow.any));
  const scaleKinds=new Set(scale.measurements.map(m=>m.kind));
  gate('drawn frogs, vehicles, logs, and croc obey the reference scale caps',scaleOk&&['frog','vehicle','platform','boss'].every(k=>scaleKinds.has(k)),
    scale.measurements.map(m=>({id:m.id,kind:m.kind,type:m.type,bounds:m.bounds,failures:m.assertion.failures})));
  // Probe-box footprint (proven honest above) stays under 20% of the
  // playfield in sampled normal-play beats. Measured: .066/.072/.096.
  const footprints=['normal','family','later'].map(id=>probeFootprint(candidate[id]));
  gate('sampled actor footprint stays below 20% of the playfield',footprints.every(f=>f.actorCount>=4&&f.sumFraction<=.20),footprints);
  // Hazards wrap a 210px track and are visible across the whole 160px strip
  // before contact: 76% of the travel axis (>=55% contract floor).
  const approach=candidate.normal.probe.layout&&candidate.normal.probe.layout.approach;
  const approachRatio=approach?approach.visible/approach.travel:0;
  gate('threats are visible across at least 55% of their travel axis',!!approach&&approach.travel>=160&&approachRatio>=.55,{approach,ratio:approachRatio});
  // The world keeps ambient motion with every actor removed (current lines,
  // dragonflies, butterflies, mill wheel). Measured env burst: cf .0075..0097,
  // meanDelta .00078..00104; a frozen backdrop measures near zero.
  const ENV_OFFSETS=[1,5,9,13,17];
  const envFrames=captureFixture('family',ENV_OFFSETS,{selector:'env',id:'family-env'});
  const envBurst=analyzeBurst(ENV_OFFSETS.map(o=>envFrames.get(o)),{native:false,crop:WORLD_CROP});
  gate('world retains ambient environmental motion without actors',envBurst.changedFraction.max>=.004&&envBurst.meanDelta.max>=.0004,{cf:envBurst.changedFraction,md:envBurst.meanDelta});

  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256));let review=fs.existsSync(REVIEW_PATH)?verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256}):{ok:false,errors:[`missing committed semantic review: ${REVIEW_PATH}`,`inspect ${CONTACT_PATH}, then complete ${REVIEW_TEMPLATE_PATH}`]};
  const preservedHash=fs.existsSync(PRESERVED_CONTACT_PATH)?sha256(PRESERVED_CONTACT_PATH):null,
    exactPreserved=preservedHash===sheet.sha256,
    approvedCrossPlatform=review.platformDriftAccepted===true&&preservedHash===review.receipt.montageSha256;
  gate('preserved native contact sheet is exact or source-bound cross-platform',exactPreserved||approvedCrossPlatform,
    {path:PRESERVED_CONTACT_PATH,expected:sheet.sha256,actual:preservedHash,reviewed:review.receipt&&review.receipt.montageSha256,
      platformDriftAccepted:review.platformDriftAccepted===true,approvedCrossPlatform});
  gate('fresh semantic comparison receipt',review.ok,review.errors);
  const report={schema:1,game:'frog-convoy',seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,contactSheet:{path:CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(b=>[b.id,{fixture:b.id,offset:b.offset,probe:candidate[b.id].probe}])),
    thresholds:{referenceEdgeFloor:refEdge,referenceRichFloor:refRich,actorScale:{leader:{maxWidth:14,maxHeight:14},frog:{maxWidth:12,maxHeight:12},pickup:{maxWidth:12,maxHeight:14},car:{maxWidth:16,maxHeight:12},largeVehicle:{maxWidth:24,maxHeight:14},platform:{maxWidth:58,maxHeight:15},boss:{maxWidth:34,maxHeight:18},footprint:.20,approach:.55,threshold:ACTOR_THRESHOLD}},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,bandSeparations,leadBurst,passengerBurst,seasonPairs,warningDelta,sacrificeDelta,sacrificeBurst,apexDelta,apexBurst,scale:scale.measurements,footprints,approach:{probe:approach,ratio:approachRatio},envBurst},gates,automatedOk:gates.slice(0,-1).every(v=>v.ok),semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}};
  writeJson(METRICS_PATH,report);
  console.log(`FROG CONVOY visual evidence · seed 0x${SEED.toString(16)}`);for(const value of gates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log('  contact:',CONTACT_PATH);console.log('  montage sha256:',sheet.sha256);console.log('  metrics:',METRICS_PATH);console.log('  review template:',REVIEW_TEMPLATE_PATH);
  if(!gates.every(v=>v.ok)){console.error('\nFROG CONVOY VISUAL EVAL FAILED');process.exit(1);}console.log('\nFROG CONVOY VISUAL EVAL PASSED');
}

try{main();}catch(error){console.error('FROG CONVOY VISUAL EVAL FAILED:',error.stack||error);process.exit(1);}
