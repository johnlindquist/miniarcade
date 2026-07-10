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
  writeContactSheet,verifyReviewReceipt,writeJson,quantile}=require('./visual-harness');

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
  runtime.sandbox.__frogConvoySetVisualBeat(name);if(options.afterSet)options.afterSet(runtime);
  const frames=new Map();for(const target of [...new Set(offsets)].sort((a,b)=>a-b)){
    runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});const frame=runtime.snapshot({native:true});
    frame.probe=visualProbe(runtime);frame.fixture=options.id||name;frame.offset=target;frames.set(target,frame);
  }return frames;
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
    readability:pending('Confirm lead, passengers, route cue, vehicle gaps, logs, warning refuge, family count, and tactic remain legible at native size.'),
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
  // Approved fixture measurement before margin: 213..401 colors, 4.73..5.14
  // entropy, .123..163 luma deviation, .141..197 largest share.
  gate('native frames are opaque and non-flat',cm.every(m=>m.width===160&&m.height===360&&m.opaqueFraction===1&&m.quantizedColors>=185&&m.colorEntropy>=4.45&&m.lumaStdDev>=.11&&m.largestColorShare<=.23),cm.map(m=>({colors:m.quantizedColors,entropy:m.colorEntropy,lumaStdDev:m.lumaStdDev,largest:m.largestColorShare})));
  gate('foreground, midground, and background retain value separation',bandSeparations.every(v=>v>=2.5)&&median(bandSeparations)>=8,bandSeparations);
  gate('multiscale detail is reference-comparable',median(cm.map(m=>m.edge[1].energy))>=refEdge*.72&&median(cm.map(m=>m.richCellFraction))>=refRich*.72&&cm.every(m=>m.richCellFraction>=.78),
    {candidateEdge:median(cm.map(m=>m.edge[1].energy)),referenceEdge:refEdge,candidateRich:median(cm.map(m=>m.richCellFraction)),referenceRich:refRich});
  gate('authored lead has aligned hop animation',leadBurst.changedFraction.max>=.05&&leadBurst.firstLast.changedFraction>=.05&&leadBurst.firstLast.changedGridFraction>=.25&&leadBurst.changedFraction.max<=.72,leadBurst);
  gate('passenger has delayed locomotion animation',passengerBurst.changedFraction.max>=.035&&passengerBurst.firstLast.changedFraction>=.035&&passengerBurst.firstLast.changedGridFraction>=.18&&passengerBurst.changedFraction.max<=.72,passengerBurst);
  // Same-state, same-actor captures isolate the authored season structures.
  // Approved distances are .082 spring/summer, .131 spring/autumn, .145
  // summer/autumn, and .274..281 for every drowned-town flood pair. The
  // quiet mill transition retains margin while the median and flood floors
  // require real silhouette replacement rather than palette drift.
  gate('season progression changes composition, not only palette',seasonPairs.every(p=>p.structureDistance>=.075)&&median(seasonPairs.map(p=>p.structureDistance))>=.19&&Math.max(...seasonPairs.map(p=>p.structureDistance))>=.25,seasonPairs);
  gate('flood warning changes the world before land',candidate.danger.probe.act==='warn'&&candidate.danger.probe.passengers>=4&&/FLOOD|CREST/.test(candidate.danger.probe.tactic)&&warningDelta.changedFraction>=.08&&warningDelta.changedGridFraction>=.45&&warningDelta.changedBoundsFraction>=.40,warningDelta);
  gate('sacrifice is bodily visible and spatially authored',candidate.sacrifice.probe.sacrifice===true&&sacrificeDelta.changedFraction>=.012&&sacrificeDelta.changedGridFraction>=.12&&sacrificeBurst.changedFraction.max>=.035&&sacrificeBurst.firstLast.structureDistance>=.035,{probe:candidate.sacrifice.probe,sacrificeDelta,sacrificeBurst});
  gate('whole-family arrival is truthful and spatially broad',candidate.apex.probe.whole===true&&candidate.apex.probe.passengers===5&&apexDelta.changedFraction>=.09&&apexDelta.changedGridFraction>=.55&&apexBurst.changedFraction.max>=.08&&apexBurst.changedGridFraction.max>=.65&&apexBurst.firstLast.structureDistance>=.10,{probe:candidate.apex.probe,apexDelta,apexBurst});

  gate('preserved native contact sheet matches current render',fs.existsSync(PRESERVED_CONTACT_PATH)&&sha256(PRESERVED_CONTACT_PATH)===sheet.sha256,
    {path:PRESERVED_CONTACT_PATH,expected:sheet.sha256,actual:fs.existsSync(PRESERVED_CONTACT_PATH)?sha256(PRESERVED_CONTACT_PATH):null});
  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256));let review=fs.existsSync(REVIEW_PATH)?verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256}):{ok:false,errors:[`missing committed semantic review: ${REVIEW_PATH}`,`inspect ${CONTACT_PATH}, then complete ${REVIEW_TEMPLATE_PATH}`]};
  gate('fresh semantic comparison receipt',review.ok,review.errors);
  const report={schema:1,game:'frog-convoy',seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,contactSheet:{path:CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(b=>[b.id,{fixture:b.id,offset:b.offset,probe:candidate[b.id].probe}])),thresholds:{referenceEdgeFloor:refEdge,referenceRichFloor:refRich},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,bandSeparations,leadBurst,passengerBurst,seasonPairs,warningDelta,sacrificeDelta,sacrificeBurst,apexDelta,apexBurst},gates,automatedOk:gates.slice(0,-1).every(v=>v.ok),semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}};
  writeJson(METRICS_PATH,report);
  console.log(`FROG CONVOY visual evidence · seed 0x${SEED.toString(16)}`);for(const value of gates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log('  contact:',CONTACT_PATH);console.log('  montage sha256:',sheet.sha256);console.log('  metrics:',METRICS_PATH);console.log('  review template:',REVIEW_TEMPLATE_PATH);
  if(!gates.every(v=>v.ok)){console.error('\nFROG CONVOY VISUAL EVAL FAILED');process.exit(1);}console.log('\nFROG CONVOY VISUAL EVAL PASSED');
}

try{main();}catch(error){console.error('FROG CONVOY VISUAL EVAL FAILED:',error.stack||error);process.exit(1);}
