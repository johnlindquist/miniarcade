#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const{bootRenderedGame,rgbaFrame,encodeRgbaPng}=require('../render/runtime');
const{
  sha256,toNativeFrame,analyzeFrame,frameDifference,structureDistance,analyzeBurst,
  measureDrawnActorExtent,assertActorScale,writeContactSheet,verifyReviewReceipt,writeJson,quantile
}=require('./visual-harness');

const ROOT=path.join(__dirname,'..','..'),GAME_PATH=path.join(__dirname,'..','tower-panic.html'),GAME_SOURCE=fs.readFileSync(GAME_PATH,'utf8');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','tower-panic'),FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png'),METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json'),TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const TRACKED_CONTACT_PATH=path.join(__dirname,'visual-receipts','tower-panic-contact-sheet.png');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','tower-panic.json');
const SEED=0x745052,WORLD_CROP={x:0,y:40,width:160,height:282},RENDER_EVERY=2,PADDING=8,THRESHOLD=8;
const CLIP_PATH=path.join(ARTIFACT_DIR,'tower-panic-30s.mp4');
const RENDER_COMMAND='node render/render.js tower-panic 30 ../.artifacts/visual/tower-panic/tower-panic-30s.mp4 --seed 0x745052 --probe --fps 30';
const median=values=>quantile(values,.5);

if(!fs.existsSync(GAME_PATH)){console.error('TOWER PANIC VISUAL EVAL FAILED: missing game');process.exit(1)}

function visualProbe(runtime){const fn=runtime.sandbox.__towerPanicVisualProbe;if(typeof fn!=='function')throw new Error('missing __towerPanicVisualProbe');const p=fn();if(!p||p.finite===false)throw new Error('non-finite visual fixture');return p}
function captureFixture(name,offsets,options){
  options=options||{};const runtime=bootRenderedGame('tower-panic',{seed:SEED});if(options.beforeSet)options.beforeSet(runtime);const set=runtime.sandbox.__towerPanicSetVisualBeat;if(typeof set!=='function'||set(name)!==true)throw new Error('unknown visual beat '+name);if(options.actorSelector!==undefined)runtime.sandbox.__TP_VISUAL_ONLY_ACTOR=options.actorSelector;if(options.afterSet)options.afterSet(runtime);
  const frames=new Map();for(const target of[...new Set(offsets)].sort((a,b)=>a-b)){runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});const frame=runtime.snapshot({native:true});frame.probe=visualProbe(runtime);frame.fixture=name;frame.offset=target;frames.set(target,frame)}return frames;
}
function captureTimeline(game,seed,targets){const runtime=bootRenderedGame(game,{seed}),frames=new Map();for(const target of targets){runtime.advanceTo(Math.max(runtime.frame,target-120));runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});frames.set(target,runtime.snapshot({native:true}))}return frames}
function fixedCrop(frame,box,size){
  size=size||36;const source=toNativeFrame(frame),cx=Math.round(box.x+box.width/2),cy=Math.round(box.y+box.height/2),rgba=Buffer.alloc(size*size*4),left=cx-(size>>1),top=cy-(size>>1);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const sx=left+x,sy=top+y,d=(y*size+x)*4;if(sx<0||sy<0||sx>=source.width||sy>=source.height){rgba[d+3]=255;continue}const s=(sy*source.width+sx)*4;rgba[d]=source.rgba[s];rgba[d+1]=source.rgba[s+1];rgba[d+2]=source.rgba[s+2];rgba[d+3]=source.rgba[s+3]}return rgbaFrame(rgba,size,size);
}
function alignedBurst(frames,boxName,size){const crops=[];for(const frame of frames){const box=frame.probe&&frame.probe[boxName];if(!box)return null;crops.push(fixedCrop(frame,box,size))}const differences=[];for(let i=1;i<crops.length;i++)differences.push(frameDifference(crops[i-1],crops[i],{native:false}));const values=differences.map(d=>d.changedFraction);return{frames:crops.length,differences,changedFraction:{min:Math.min(...values),median:median(values),max:Math.max(...values)},firstLast:frameDifference(crops[0],crops.at(-1),{native:false})}}
// Caps encode the 2026-07-11 reference-scale directive (Machine Hunt hunter
// ~10px, Block Mine hero ~12px is the ceiling), measured on seed 0x745052
// fixtures after the redraw: rigger 8-9x15 drawn (was 16x21), workers 8x12
// (panic "!" adds ~3 rows), barrels 7-8x8 (was 12x12), fires 10x13, pistons
// 14x16..23 at full reach, cage 24x23. The old 20x32 repo ceiling let the
// chunky rigger pass; these caps fail it.
function limits(actor){
  if(actor.kind==='rigger')return{maxWidth:12,maxHeight:16};
  if(actor.kind==='worker')return{maxWidth:11,maxHeight:15};
  if(actor.kind==='barrel')return{maxWidth:10,maxHeight:11};
  if(actor.kind==='hazard')return{maxWidth:12,maxHeight:15};
  if(actor.kind==='machine')return{maxWidth:16,maxHeight:24};
  if(actor.kind==='structure')return{maxWidth:24,maxHeight:24};
  return{maxWidth:14,maxHeight:16};
}
function measureActors(fixture,offset,probe){
  const actors=probe.actors;if(!Array.isArray(actors)||!actors.length)throw new Error(fixture+': actors missing');const base=captureFixture(fixture,[offset],{actorSelector:'none'}).get(offset),measurements=[];
  for(const actor of actors){const isolated=captureFixture(fixture,[offset],{actorSelector:actor.id}).get(offset),measurement=measureDrawnActorExtent(isolated,base,{id:actor.id,kind:actor.kind,type:actor.type,probeBox:actor.box,padding:PADDING,threshold:THRESHOLD}),assertion=assertActorScale(measurement,Object.assign({label:actor.kind+' '+actor.type},limits(actor)));measurements.push(Object.assign(measurement,{assertion:{ok:assertion.ok,failures:assertion.failures,limits:assertion.limits}}))}return{fixture,offset,measurements};
}
function footprint(label,set,playfield){const area=playfield.width*playfield.height,sum=set.measurements.reduce((n,m)=>n+(m.bounds?m.width*m.height:0),0),failures=set.measurements.flatMap(m=>m.assertion.failures);return{label,actors:set.measurements.length,sumBboxArea:sum,fraction:+(sum/area).toFixed(6),scaleOk:failures.length===0,failures,ok:failures.length===0&&sum/area<=.20}}
function approach(layout){const list=layout&&layout.approaches||[];return list.map(a=>{const measured=Math.abs(a.contact-a.visibleSpawn)/Math.abs(a.goal-a.visibleSpawn);return Object.assign({},a,{measured:+measured.toFixed(6),matches:Math.abs(measured-a.reported)<1e-6,ok:measured>=.55&&Math.abs(measured-a.reported)<1e-6})})}
function gameEvidence(){
  const specs={
    opening:{fixture:'opening',offsets:[12]},objective:{fixture:'objective',offsets:[3,7,12]},climb:{fixture:'climb',offsets:[1,4,8,12]},cascade:{fixture:'cascade',offsets:[1,4,8,12,20]},purge:{fixture:'purge-response',offsets:[12]},rescue:{fixture:'rescue',offsets:[1,4,8,12,20]},danger:{fixture:'danger',offsets:[12]},later:{fixture:'later',offsets:[1,5,9,12]},apex:{fixture:'apex',offsets:[1,12,36,72,120]}
  },runs={};for(const[id,s]of Object.entries(specs))runs[id]=captureFixture(s.fixture,s.offsets);const beats=[
    {id:'opening',label:'opening',offset:12},{id:'objective',label:'rescue priority',offset:12},{id:'climb',label:'ladder climb',offset:8},{id:'cascade',label:'cascade',offset:12},{id:'purge',label:'purge response',offset:12},{id:'rescue',label:'worker joins',offset:8},{id:'danger',label:'danger',offset:12},{id:'later',label:'dynamo spire',offset:12},{id:'apex',label:'extraction',offset:12}
  ];return{specs,runs,beats,frames:Object.fromEntries(beats.map(b=>[b.id,runs[b.id].get(b.offset)]))};
}
function reviewTemplate(montageHash,gameHash,beats){const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});return{schema:1,game:'tower-panic',verdict:'pending',references:['horizon','blockmine'],montageSha256:montageHash,gameSha256:gameHash,seed:'0x'+SEED.toString(16),checkpoints:beats.map(b=>b.id+'@'+b.offset),reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size review',categories:{characterCraft:pending('Inspect the rigger, four worker trades, barrel construction, facing, gait, climbing, bracing, hurt, panic, and convoy poses at 160x360.'),environmentCraft:pending('Inspect built steel decks, ladders, broken gantries, pipes, tanks, turbines, crane, skyline, foreground, lighting, and material separation with HUD mentally hidden.'),levelVariety:pending('Confirm freight, boiler, dynamo, and crane compositions change silhouettes, landmarks, light, props, and structure rather than palette alone.'),animationImpact:pending('Confirm climbing, convoy gait, rotating barrels, pistons, purge response, warning, cascade, rescue join, cage boarding/ascent, and rooftop extraction have anticipation and follow-through.'),readability:pending('Confirm rescue priority, threat state, small actors, full-width hazard runway, warning column, convoy count, and extraction remain legible without computed waypoints beside video.'),artDirectionCohesion:pending('Confirm the industrial material language, helmet colors, safety accents, hazard grammar, HUD, and celebration effects feel authored as one game.')},renderReceipt:{seed:'0x'+SEED.toString(16),seconds:30,fps:30,codec:'h264',dimensions:'320x720',bytes:0,sha256:'',command:RENDER_COMMAND}}}

async function main(){
  fs.mkdirSync(FRAME_DIR,{recursive:true});for(const f of fs.readdirSync(FRAME_DIR))if(f.endsWith('.png'))fs.unlinkSync(path.join(FRAME_DIR,f));
  const evidence=gameEvidence(),repeat=gameEvidence(),determinism=[];for(const beat of evidence.beats){const a=evidence.frames[beat.id],b=repeat.frames[beat.id];determinism.push({beat:beat.id,a:sha256(a.rgba),b:sha256(b.rgba),ok:sha256(a.rgba)===sha256(b.rgba)})}
  const refTargets=[60,600,1200,2400,3600,5400,7200,9000,12000],horizon=captureTimeline('horizon',0xa1020401,refTargets),blockmine=captureTimeline('blockmine',0xb10c0050,refTargets),horizonFrames={},blockmineFrames={};
  evidence.beats.forEach((beat,i)=>{horizonFrames[beat.id]=horizon.get(refTargets[i]);blockmineFrames[beat.id]=blockmine.get(refTargets[i]);fs.writeFileSync(path.join(FRAME_DIR,String(i+1).padStart(2,'0')+'-'+beat.id+'.png'),encodeRgbaPng(evidence.frames[beat.id]))});
  const sheet=writeContactSheet({beats:evidence.beats.map(b=>({id:b.id,label:b.label})),rows:[{label:'TOWER PANIC',frames:evidence.frames},{label:'MACHINE HUNT',frames:horizonFrames},{label:'BLOCK MINE',frames:blockmineFrames}],outPath:CONTACT_PATH});

  const candidateMetrics=Object.fromEntries(evidence.beats.map(b=>[b.id,analyzeFrame(evidence.frames[b.id],{native:false,crop:WORLD_CROP})])),cm=Object.values(candidateMetrics),horizonMetrics=evidence.beats.map(b=>analyzeFrame(horizonFrames[b.id],{native:false,crop:WORLD_CROP})),blockmineMetrics=evidence.beats.map(b=>analyzeFrame(blockmineFrames[b.id],{native:false,crop:WORLD_CROP}));
  const refEdge=Math.min(median(horizonMetrics.map(m=>m.edge[1].energy)),median(blockmineMetrics.map(m=>m.edge[1].energy))),refRich=Math.min(median(horizonMetrics.map(m=>m.richCellFraction)),median(blockmineMetrics.map(m=>m.richCellFraction)));

  const scaleFrame=captureFixture('scale-contract',[12]).get(12),scale=measureActors('scale-contract',12,scaleFrame.probe),scaleKinds=new Map();for(const m of scale.measurements){const set=scaleKinds.get(m.kind)||new Set();set.add(m.type);scaleKinds.set(m.kind,set)}
  const footprintSets={};for(const id of['objective','cascade','convoy']){const fixture=id==='convoy'?'convoy':id,frame=id==='convoy'?captureFixture('convoy',[12]).get(12):evidence.frames[id],set=measureActors(fixture,12,frame.probe);footprintSets[id]=footprint(id,set,frame.probe.layout.playfield)}
  const approaches=approach(scaleFrame.probe.layout),warningCalm=captureFixture('warning-calm',[12]).get(12),warningFrame=captureFixture('warning',[12]).get(12),warning=frameDifference(warningCalm,warningFrame,{native:false,crop:WORLD_CROP}),land=captureFixture('land',[12]).get(12),landDelta=frameDifference(warningFrame,land,{native:false,crop:WORLD_CROP});
  const plannerClean=captureFixture('objective',[1]).get(1),plannerDirty=captureFixture('objective',[1],{afterSet:r=>r.sandbox.__towerPanicPlannerContamination()}).get(1),plannerHashes={clean:sha256(plannerClean.rgba),contaminated:sha256(plannerDirty.rgba)};
  const apexNoFx=captureFixture('apex',[12],{beforeSet:r=>{r.sandbox.__NO_PAYOFF_FX=1}}).get(12),apexDelta=frameDifference(apexNoFx,evidence.frames.apex,{native:false,crop:WORLD_CROP});
  const environment={opening:captureFixture('opening',[12],{actorSelector:'none'}).get(12),later:captureFixture('later',[12],{actorSelector:'none'}).get(12),crown:captureFixture('apex',[12],{actorSelector:'none',beforeSet:r=>{r.sandbox.__NO_PAYOFF_FX=1}}).get(12)},zonePairs={};for(const[a,b]of[['opening','later'],['opening','crown'],['later','crown']])zonePairs[a+'-'+b]=structureDistance(environment[a],environment[b],{crop:WORLD_CROP});
  const heroBurst=alignedBurst([1,4,8,12].map(o=>evidence.runs.climb.get(o)),'heroBox',32),workerBurst=alignedBurst([1,4,8,12,20].map(o=>evidence.runs.rescue.get(o)),'workerBox',28),barrelBurst=alignedBurst([1,4,8,12,20].map(o=>evidence.runs.cascade.get(o)),'barrelBox',28),apexBurst=analyzeBurst([1,12,36,72,120].map(o=>evidence.runs.apex.get(o)),{native:false,crop:WORLD_CROP});

  // Re-derived 2026-07-11 for the reference-scale art + deck dressing (the old
  // floors measured the old chunky-actor frames). Candidate cells measured
  // 121..175 quantized colors, 3.822..4.523 entropy, .146..183 luma deviation,
  // .140..215 largest share, .0372..049 edge energy, and 1.0 rich cells on
  // every beat. Warning delta measured .1316/.4667, land delta .808/1.0, zone
  // structure distance .344..445, aligned bursts hero .421 / worker .232 /
  // barrel .324 max, apex FX delta .0081/.1556, apex burst .84/1.0. Floors
  // keep ~15-30% regression margin; semantic art quality remains independently
  // bound to the native-size review receipt.
  const bands={colors:105,entropy:3.5,luma:.13,largest:.25,edge:.031,richEach:.92,richMedian:.95,warningChanged:.09,warningGrid:.35,landChanged:.55,landGrid:.80,zonePair:.27,heroAnim:.28,workerAnim:.16,barrelAnim:.22,apexFx:.0062,apexFxGrid:.12,apexBurst:.45,apexBurstGrid:.60};
  const gates=[],gate=(name,ok,detail)=>gates.push({name,ok:!!ok,detail});
  gate('same-seed real pixels deterministic',determinism.every(d=>d.ok),determinism);
  gate('all native checkpoints are finite and semantic',evidence.beats.every(b=>evidence.frames[b.id].probe&&evidence.frames[b.id].probe.finite),evidence.beats.map(b=>({id:b.id,probe:evidence.frames[b.id].probe})));
  gate('scale fixture covers rigger, four trades, rolling/falling barrels, fire, machinery, and cage',(scaleKinds.get('rigger')||new Set()).size===1&&(scaleKinds.get('worker')||new Set()).size===4&&(scaleKinds.get('barrel')||new Set()).has('rolling')&&(scaleKinds.get('barrel')||new Set()).has('falling')&&(scaleKinds.get('hazard')||new Set()).has('fire')&&(scaleKinds.get('machine')||new Set()).has('piston')&&(scaleKinds.get('structure')||new Set()).has('cage'),Object.fromEntries([...scaleKinds].map(([k,v])=>[k,[...v]])));
  gate('drawn actor extents obey the reference-scale caps (rigger 12x16, workers 11x15, barrels 10x11, fires 12x15, pistons 16x24, cage 24x24)',scale.measurements.every(m=>m.assertion.ok),scale.measurements);
  gate('normal, cascade, and full-convoy footprints remain under 20%',Object.values(footprintSets).every(v=>v.ok),footprintSets);
  gate('rolling threat has at least 55% visible runway',approaches.length&&approaches.every(a=>a.ok),approaches);
  gate('frames are opaque, rich, contrasted, and non-flat',cm.every(m=>m.opaqueFraction===1&&m.quantizedColors>=bands.colors&&m.colorEntropy>=bands.entropy&&m.lumaStdDev>=bands.luma&&m.largestColorShare<=bands.largest),cm.map(m=>({colors:m.quantizedColors,entropy:m.colorEntropy,luma:m.lumaStdDev,largest:m.largestColorShare})));
  gate('multiscale industrial detail is reference-comparable',cm.every(m=>m.edge[1].energy>=bands.edge&&m.edge[4].energy>m.edge[1].energy)&&median(cm.map(m=>m.edge[1].energy))>=refEdge*.85,{candidate:cm.map(m=>m.edge),referenceFloor:refEdge});
  gate('spatial richness fills the native strip',cm.every(m=>m.richCellFraction>=bands.richEach)&&median(cm.map(m=>m.richCellFraction))>=Math.max(bands.richMedian,refRich*.88),{candidate:cm.map(m=>m.richCellFraction),referenceFloor:refRich});
  const forbiddenPresentation={routeRenderer:/\bfunction\s+draw(?:Route|Path)s?\b|\bdrawRoutes?\s*\(/.test(GAME_SOURCE),routeProbe:/\broute(?:Points|Hash)\s*:/.test(GAME_SOURCE),publicRouteArray:/function\s+(?:probe|visualProbe)\(\)\{[^\n]*\broute\s*:/.test(GAME_SOURCE),guidelineDash:/\.setLineDash\s*\(/.test(GAME_SOURCE),visiblePlanCopy:/VISIBLE PLAN|FOLLOW THE LINE|CLIMB THE LINE|CHECK THE PLAN/.test(GAME_SOURCE)};
  gate('computed waypoints, planner copy, reticles, and guideline overlays have no presentation surface',Object.values(forbiddenPresentation).every(value=>!value)&&evidence.beats.every(beat=>evidence.frames[beat.id].probe.guidelines===0),{forbiddenPresentation,guidelines:Object.fromEntries(evidence.beats.map(beat=>[beat.id,evidence.frames[beat.id].probe.guidelines]))});
  gate('mutating the private planned route tail is an exact real-pixel no-op',plannerHashes.clean===plannerHashes.contaminated,plannerHashes);
  gate('overload warning and physical cascade land are visually distinct',warning.changedFraction>=bands.warningChanged&&warning.changedGridFraction>=bands.warningGrid&&landDelta.changedFraction>=bands.landChanged&&landDelta.changedGridFraction>=bands.landGrid,{warning,landDelta});
  gate('freight, dynamo, and crane environments change composition',Object.values(zonePairs).every(v=>v.structureDistance>=bands.zonePair),zonePairs);
  gate('rigger climbing, worker joining, and barrels animate in aligned crops',heroBurst&&workerBurst&&barrelBurst&&heroBurst.changedFraction.max>=bands.heroAnim&&workerBurst.changedFraction.max>=bands.workerAnim&&barrelBurst.changedFraction.max>=bands.barrelAnim,{heroBurst,workerBurst,barrelBurst});
  gate('rooftop extraction has physical staging plus authored payoff motion',apexNoFx.probe.rescued===4&&apexDelta.changedFraction>=bands.apexFx&&apexDelta.changedGridFraction>=bands.apexFxGrid&&apexBurst.changedFraction.max>=bands.apexBurst&&apexBurst.changedGridFraction.max>=bands.apexBurstGrid,{apexNoFx:apexNoFx.probe,apexDelta,apexBurst});

  const gameHash=sha256(GAME_PATH);writeJson(TEMPLATE_PATH,reviewTemplate(sheet.sha256,gameHash,evidence.beats));let review;if(fs.existsSync(REVIEW_PATH)){review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256,preservedPath:TRACKED_CONTACT_PATH});if(review.receipt.game!=='tower-panic'||review.receipt.gameSha256!==gameHash||review.receipt.seed!=='0x'+SEED.toString(16)||JSON.stringify(review.receipt.checkpoints)!==JSON.stringify(evidence.beats.map(b=>b.id+'@'+b.offset))){review.ok=false;review.errors.push('review identity, game hash, seed, or checkpoints are stale')}}else review={ok:false,errors:['missing semantic review '+REVIEW_PATH,'inspect '+CONTACT_PATH+' and complete '+TEMPLATE_PATH]};gate('fresh native-size semantic comparison receipt',review.ok,review.errors);
  const reviewClip=review.receipt&&review.receipt.renderReceipt,localClip=fs.existsSync(CLIP_PATH)?{path:CLIP_PATH,bytes:fs.statSync(CLIP_PATH).size,sha256:sha256(CLIP_PATH)}:null;
  gate('rendered autoplay clip receipt is complete',!!reviewClip&&reviewClip.bytes>100000&&/^[a-f0-9]{64}$/.test(reviewClip.sha256||'')&&reviewClip.seed==='0x'+SEED.toString(16)&&reviewClip.command===RENDER_COMMAND,reviewClip);
  gate('local rendered clip matches receipt when available',!localClip||!!reviewClip&&localClip.bytes===reviewClip.bytes&&localClip.sha256===reviewClip.sha256,{localClip,reviewClip});
  const report={schema:1,game:'tower-panic',gameSha256:gameHash,seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,contactSheet:{path:CONTACT_PATH,trackedPath:TRACKED_CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},checkpoints:Object.fromEntries(evidence.beats.map(b=>[b.id,{fixture:evidence.specs[b.id].fixture,offset:b.offset,probe:evidence.frames[b.id].probe}])),thresholds:{actorScale:{rigger:{maxWidth:12,maxHeight:16},worker:{maxWidth:11,maxHeight:15},barrel:{maxWidth:10,maxHeight:11},hazard:{maxWidth:12,maxHeight:15},machine:{maxWidth:16,maxHeight:24},structure:{maxWidth:24,maxHeight:24},runway:.55,footprint:.20,extentThreshold:THRESHOLD},bands,referenceEdge:refEdge,referenceRich:refRich},clip:localClip,metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,scale:scale.measurements,footprints:footprintSets,approaches,plannerHashes,warning,landDelta,zonePairs,heroBurst,workerBurst,barrelBurst,apexDelta,apexBurst},gates,automatedOk:gates.filter(g=>!['fresh native-size semantic comparison receipt','rendered autoplay clip receipt is complete','local rendered clip matches receipt when available'].includes(g.name)).every(g=>g.ok),semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}};writeJson(METRICS_PATH,report);
  console.log('TOWER PANIC visual evidence · seed 0x'+SEED.toString(16));for(const g of gates)console.log('  '+(g.ok?'PASS':'FAIL')+' '+g.name);console.log('  contact: '+CONTACT_PATH);console.log('  tracked contact: '+TRACKED_CONTACT_PATH);console.log('  montage sha256: '+sheet.sha256);console.log('  metrics: '+METRICS_PATH);console.log('  review template: '+TEMPLATE_PATH);if(!gates.every(g=>g.ok)){console.error('\nTOWER PANIC VISUAL EVAL FAILED');process.exit(1)}console.log('\nTOWER PANIC VISUAL EVAL PASSED');
}
main().catch(error=>{console.error('TOWER PANIC VISUAL EVAL FAILED:',error.stack||error);process.exit(1)});
