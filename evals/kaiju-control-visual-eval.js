#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const{bootRenderedGame,rgbaFrame,encodeRgbaPng}=require('../render/runtime');
const{
  sha256,toNativeFrame,analyzeFrame,frameDifference,structureDistance,analyzeBurst,
  measureDrawnActorExtent,assertActorScale,writeContactSheet,verifyReviewReceipt,writeJson,quantile
}=require('./visual-harness');

const ROOT=path.join(__dirname,'..','..'),GAME_PATH=path.join(__dirname,'..','kaiju-control.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','kaiju-control'),FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png'),METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const TRACKED_CONTACT_PATH=path.join(__dirname,'visual-receipts','kaiju-control-contact-sheet.png');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','kaiju-control.json');
const SEED=0x4b434954,WORLD_CROP={x:0,y:42,width:160,height:280},RENDER_EVERY=2,PADDING=8,THRESHOLD=8;
const median=values=>quantile(values,.5);

if(!fs.existsSync(GAME_PATH)){console.error('KAIJU CONTROL VISUAL EVAL FAILED: missing game');process.exit(1)}

function visualProbe(runtime){const fn=runtime.sandbox.__kaijuControlVisualProbe;if(typeof fn!=='function')throw new Error('missing __kaijuControlVisualProbe');const p=fn();if(!p||p.finite===false)throw new Error('non-finite visual fixture');return p}
function captureFixture(name,offsets,options){
  options=options||{};const runtime=bootRenderedGame('kaiju-control',{seed:SEED});if(options.beforeSet)options.beforeSet(runtime);
  const set=runtime.sandbox.__kaijuControlSetVisualBeat;if(typeof set!=='function'||set(name)!==true)throw new Error('unknown visual beat '+name);
  if(options.actorSelector!==undefined)runtime.sandbox.__KC_VISUAL_ONLY_ACTOR=options.actorSelector;
  if(options.hideRoute)runtime.sandbox.__KC_HIDE_ROUTE=1;if(options.afterSet)options.afterSet(runtime);
  const frames=new Map();for(const target of[...new Set(offsets)].sort((a,b)=>a-b)){runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});const frame=runtime.snapshot({native:true});frame.probe=visualProbe(runtime);frame.fixture=name;frame.offset=target;frames.set(target,frame)}return frames;
}
function captureTimeline(game,seed,targets){const runtime=bootRenderedGame(game,{seed}),frames=new Map();for(const target of targets){runtime.advanceTo(Math.max(runtime.frame,target-120));runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});frames.set(target,runtime.snapshot({native:true}))}return frames}
function fixedCrop(frame,box,size){size=size||42;const source=toNativeFrame(frame),cx=Math.round(box.x+box.width/2),cy=Math.round(box.y+box.height/2),rgba=Buffer.alloc(size*size*4),left=cx-(size>>1),top=cy-(size>>1);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const sx=left+x,sy=top+y,d=(y*size+x)*4;if(sx<0||sy<0||sx>=source.width||sy>=source.height){rgba[d+3]=255;continue}const s=(sy*source.width+sx)*4;rgba[d]=source.rgba[s];rgba[d+1]=source.rgba[s+1];rgba[d+2]=source.rgba[s+2];rgba[d+3]=source.rgba[s+3]}return rgbaFrame(rgba,size,size)}
function alignedBurst(frames,boxName,size){const crops=[];for(const frame of frames){const box=frame.probe&&frame.probe[boxName];if(!box)return null;crops.push(fixedCrop(frame,box,size))}const differences=[];for(let i=1;i<crops.length;i++)differences.push(frameDifference(crops[i-1],crops[i],{native:false}));const values=differences.map(d=>d.changedFraction);return{frames:crops.length,differences,changedFraction:{min:Math.min(...values),median:median(values),max:Math.max(...values)},firstLast:frameDifference(crops[0],crops.at(-1),{native:false})}}
function actorLimits(actor){if(actor.kind==='boss')return{maxWidth:34,maxHeight:34};if(actor.kind==='structure')return{maxWidth:24,maxHeight:24};return{maxWidth:20,maxHeight:32}}
function measureActors(fixture,offset,probe){const actors=probe.actors;if(!Array.isArray(actors)||!actors.length)throw new Error(fixture+': actors missing');const base=captureFixture(fixture,[offset],{actorSelector:'none'}).get(offset),measurements=[];
  for(const actor of actors){const isolated=captureFixture(fixture,[offset],{actorSelector:actor.id}).get(offset),measurement=measureDrawnActorExtent(isolated,base,{id:actor.id,kind:actor.kind,type:actor.type,probeBox:actor.box,padding:PADDING,threshold:THRESHOLD}),assertion=assertActorScale(measurement,Object.assign({label:actor.kind+' '+actor.type},actorLimits(actor)));measurements.push(Object.assign(measurement,{assertion:{ok:assertion.ok,failures:assertion.failures,limits:assertion.limits}}))}return{fixture,offset,measurements}}
function footprint(label,set,playfield){const area=playfield.width*playfield.height,sum=set.measurements.reduce((n,m)=>n+(m.bounds?m.width*m.height:0),0),failures=set.measurements.flatMap(m=>m.assertion.failures),fraction=sum/area;return{label,actors:set.measurements.length,sumBboxArea:sum,fraction:+fraction.toFixed(6),scaleOk:failures.length===0,failures,measurements:set.measurements,ok:failures.length===0&&fraction<=.20}}
function approach(layout){const list=layout&&layout.approaches||[];return list.map(a=>{const measured=Math.abs(a.contact-a.visibleSpawn)/Math.abs(a.goal-a.visibleSpawn);return Object.assign({},a,{measured:+measured.toFixed(6),matches:Math.abs(measured-a.reported)<1e-6,ok:measured>=.55&&Math.abs(measured-a.reported)<1e-6})})}
function routeEvidence(fixture){const on=captureFixture(fixture,[12]).get(12),off=captureFixture(fixture,[12],{hideRoute:true}).get(12);return{on,off,delta:frameDifference(off,on,{native:false,crop:WORLD_CROP}),probe:on.probe}}
function gameEvidence(){const specs={
  opening:{fixture:'opening',offsets:[12]},plan:{fixture:'triage-plan',offsets:[3,7,12]},evacuation:{fixture:'evacuation',offsets:[1,4,8,12,18]},decoy:{fixture:'decoy',offsets:[3,7,12]},
  danger:{fixture:'kaiju-danger',offsets:[1,4,8,12,20]},warning:{fixture:'warning',offsets:[12]},land:{fixture:'act-land',offsets:[3,7,12,20]},later:{fixture:'later',offsets:[3,7,12]},
  recovery:{fixture:'recovery',offsets:[3,7,12,20]},apex:{fixture:'apex',offsets:[1,6,12,24,48]}
  },runs={};for(const[id,s]of Object.entries(specs))runs[id]=captureFixture(s.fixture,s.offsets);const beats=[
    {id:'opening',label:'opening',offset:12},{id:'plan',label:'triage plan',offset:12},{id:'evacuation',label:'evacuation',offset:8},{id:'decoy',label:'decoy line',offset:12},{id:'danger',label:'kaiju impact',offset:8},
    {id:'warning',label:'act warning',offset:12},{id:'land',label:'city systems hit',offset:12},{id:'later',label:'crown grid',offset:12},{id:'recovery',label:'city recovery',offset:12},{id:'apex',label:'district survives',offset:12}
  ];return{specs,runs,beats,frames:Object.fromEntries(beats.map(b=>[b.id,runs[b.id].get(b.offset)]))}}
function reviewTemplate(montageHash,gameHash,beats){const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});return{schema:1,game:'kaiju-control',verdict:'pending',references:['horizon','blockmine'],montageSha256:montageHash,gameSha256:gameHash,seed:'0x'+SEED.toString(16),checkpoints:beats.map(b=>b.id+'@'+b.offset),reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size review',categories:{
  characterCraft:pending('Inspect the articulated CIVIC-1 response rig, civilian bodies and panic poses, the singular plated kaiju silhouette, facing, stomp cycle, jaw, recoil, stun, and rescue load at 160x360.'),
  environmentCraft:pending('Inspect harbor warehouses and tidewall, old-row roofs/tram/plaza, Crown glass parcels/monorail, roads, lamps, trees, cables, windows, rubble, smoke, lighting, and foreground depth with HUD mentally hidden.'),
  levelVariety:pending('Confirm Tideward Harbor, Lantern Row, and Crown Grid change road rhythm, parcel massing, landmarks, materials, rooflines, and silhouette rather than only palette.'),
  animationImpact:pending('Confirm responder drive/load/repair, civilian agitation, kaiju gait/roar/impact, decoy pulse, warning front, blackout/aftershock/surge land, relight, and district-survival payoff have anticipation and follow-through.'),
  readability:pending('Confirm tiny responders/civilians, 34px kaiju, both forecast routes, threatened block, decoy, city condition, and live triage verb remain legible beside video.'),
  artDirectionCohesion:pending('Confirm municipal signage, emergency amber/mint/coral grammar, authored parcel materials, disaster damage, routes, HUD, and celebrations feel like one city-crisis world.')
  }}}

async function main(){
  fs.mkdirSync(FRAME_DIR,{recursive:true});for(const file of fs.readdirSync(FRAME_DIR))if(file.endsWith('.png'))fs.unlinkSync(path.join(FRAME_DIR,file));
  const evidence=gameEvidence(),repeat=gameEvidence(),determinism=[];for(const beat of evidence.beats){const a=evidence.frames[beat.id],b=repeat.frames[beat.id];determinism.push({beat:beat.id,a:sha256(a.rgba),b:sha256(b.rgba),ok:sha256(a.rgba)===sha256(b.rgba)})}
  const refTargets=[60,600,1200,2400,3600,5400,7200,9000,12000,15000],horizon=captureTimeline('horizon',0xa1020401,refTargets),blockmine=captureTimeline('blockmine',0xb10c0050,refTargets),horizonFrames={},blockmineFrames={};
  evidence.beats.forEach((beat,i)=>{horizonFrames[beat.id]=horizon.get(refTargets[i]);blockmineFrames[beat.id]=blockmine.get(refTargets[i]);fs.writeFileSync(path.join(FRAME_DIR,String(i+1).padStart(2,'0')+'-'+beat.id+'.png'),encodeRgbaPng(evidence.frames[beat.id]))});
  const sheet=writeContactSheet({beats:evidence.beats.map(b=>({id:b.id,label:b.label})),rows:[{label:'KAIJU CONTROL',frames:evidence.frames},{label:'MACHINE HUNT',frames:horizonFrames},{label:'BLOCK MINE',frames:blockmineFrames}],outPath:CONTACT_PATH});fs.mkdirSync(path.dirname(TRACKED_CONTACT_PATH),{recursive:true});fs.writeFileSync(TRACKED_CONTACT_PATH,sheet.png);

  const candidateMetrics=Object.fromEntries(evidence.beats.map(b=>[b.id,analyzeFrame(evidence.frames[b.id],{native:false,crop:WORLD_CROP})])),cm=Object.values(candidateMetrics),horizonMetrics=evidence.beats.map(b=>analyzeFrame(horizonFrames[b.id],{native:false,crop:WORLD_CROP})),blockmineMetrics=evidence.beats.map(b=>analyzeFrame(blockmineFrames[b.id],{native:false,crop:WORLD_CROP}));
  const refEdge=Math.min(median(horizonMetrics.map(m=>m.edge[1].energy)),median(blockmineMetrics.map(m=>m.edge[1].energy))),refRich=Math.min(median(horizonMetrics.map(m=>m.richCellFraction)),median(blockmineMetrics.map(m=>m.richCellFraction)));
  const scaleFrame=captureFixture('scale-contract',[12]).get(12),scale=measureActors('scale-contract',12,scaleFrame.probe),scaleKinds=new Map();for(const m of scale.measurements){const set=scaleKinds.get(m.kind)||new Set();set.add(m.type);scaleKinds.set(m.kind,set)}
  const footprintSets={};for(const[id,fixture]of[['opening','opening'],['decoy','decoy'],['danger','kaiju-danger'],['later','later']]){const frame=id==='danger'?evidence.frames.danger:evidence.frames[id],set=measureActors(fixture,12,frame.probe);footprintSets[id]=footprint(id,set,frame.probe.layout.playfield)}
  const approaches=approach(scaleFrame.probe.layout),planRoute=routeEvidence('triage-plan'),warningRoute=routeEvidence('warning'),calmRoute=routeEvidence('warning-calm');
  const warningDelta=frameDifference(calmRoute.on,warningRoute.on,{native:false,crop:WORLD_CROP}),landDelta=frameDifference(warningRoute.on,evidence.frames.land,{native:false,crop:WORLD_CROP});
  const env={harbor:captureFixture('opening',[12],{actorSelector:'none',hideRoute:true}).get(12),old:captureFixture('warning-calm',[12],{actorSelector:'none',hideRoute:true}).get(12),core:captureFixture('later',[12],{actorSelector:'none',hideRoute:true}).get(12)},districtPairs={};for(const[a,b]of[['harbor','old'],['harbor','core'],['old','core']])districtPairs[a+'-'+b]=structureDistance(env[a],env[b],{crop:WORLD_CROP});
  const recoveryDelta=frameDifference(evidence.frames.later,evidence.frames.recovery,{native:false,crop:WORLD_CROP}),decoyDelta=frameDifference(evidence.frames.plan,evidence.frames.decoy,{native:false,crop:WORLD_CROP});
  const heroBurst=alignedBurst([1,4,8,12,18].map(o=>evidence.runs.evacuation.get(o)),'heroBox',34),kaijuBurst=alignedBurst([1,4,8,12,20].map(o=>evidence.runs.danger.get(o)),'kaijuBox',42);
  const apexNoFx=captureFixture('apex',[12],{beforeSet:r=>{r.sandbox.__NO_PAYOFF_FX=1}}).get(12),apexFx=frameDifference(apexNoFx,evidence.frames.apex,{native:false,crop:WORLD_CROP}),apexBurst=analyzeBurst([1,6,12,24,48].map(o=>evidence.runs.apex.get(o)),{native:false,crop:WORLD_CROP});

  // Locked from this fixed seed after native inspection. The candidate's
  // actual minima/medians remain recorded in metrics.json; these floors retain
  // roughly 10-20% regression room while the semantic receipt binds art craft.
  const bands={colors:85,entropy:2.85,luma:.13,largest:.39,edge:.031,richEach:.88,richMedian:.92,routeChanged:.002,routeGrid:.035,warningChanged:.035,warningGrid:.28,landChanged:.09,landGrid:.45,districtPair:.10,recoveryChanged:.09,recoveryGrid:.55,decoyChanged:.025,heroAnim:.018,kaijuAnim:.02,apexFx:.005,apexFxGrid:.10,apexBurst:.02,apexBurstGrid:.22};
  const gates=[],gate=(name,ok,detail)=>gates.push({name,ok:!!ok,detail});
  gate('same-seed real pixels are deterministic',determinism.every(d=>d.ok),determinism);
  gate('all native checkpoints are finite and semantic',evidence.beats.every(b=>evidence.frames[b.id].probe&&evidence.frames[b.id].probe.finite),evidence.beats.map(b=>({id:b.id,probe:evidence.frames[b.id].probe})));
  gate('scale fixture covers responder, civilian group, five civic structures, decoy, and singular boss',(scaleKinds.get('responder')||new Set()).size>=1&&(scaleKinds.get('civilian-group')||new Set()).size>=1&&(scaleKinds.get('structure')||new Set()).size>=6&&(scaleKinds.get('boss')||new Set()).size===1,Object.fromEntries([...scaleKinds].map(([k,v])=>[k,[...v]])));
  gate('drawn extents obey 20x32 standard, 24x24 structure, and 34x34 boss caps',scale.measurements.every(m=>m.assertion.ok),scale.measurements);
  gate('sampled normal-play actor footprints remain under 20%',Object.values(footprintSets).every(v=>v.ok),footprintSets);
  gate('kaiju has at least 55% visible approach runway',approaches.length&&approaches.every(a=>a.ok),approaches);
  gate('frames are opaque, rich, contrasted, and non-flat',cm.every(m=>m.opaqueFraction===1&&m.quantizedColors>=bands.colors&&m.colorEntropy>=bands.entropy&&m.lumaStdDev>=bands.luma&&m.largestColorShare<=bands.largest),cm.map(m=>({colors:m.quantizedColors,entropy:m.colorEntropy,luma:m.lumaStdDev,largest:m.largestColorShare})));
  gate('multiscale city detail is reference-comparable',cm.every(m=>m.edge[1].energy>=bands.edge&&m.edge[4].energy>m.edge[1].energy)&&median(cm.map(m=>m.edge[1].energy))>=refEdge*.85,{candidate:cm.map(m=>m.edge),referenceFloor:refEdge});
  gate('spatial richness fills the native strip',cm.every(m=>m.richCellFraction>=bands.richEach)&&median(cm.map(m=>m.richCellFraction))>=Math.max(bands.richMedian,refRich*.88),{candidate:cm.map(m=>m.richCellFraction),referenceFloor:refRich});
  gate('both bot and kaiju forecasts paint visible native pixels',planRoute.probe.routePoints>=3&&planRoute.probe.kaijuRoutePoints>=3&&planRoute.delta.changedFraction>=bands.routeChanged&&planRoute.delta.changedGridFraction>=bands.routeGrid,planRoute.delta);
  gate('act warning changes route identity and lands broadly',calmRoute.probe.routePoints>=3&&warningRoute.probe.routePoints>=3&&warningRoute.delta.changedFraction>=bands.routeChanged&&warningDelta.changedFraction>=bands.warningChanged&&warningDelta.changedGridFraction>=bands.warningGrid&&landDelta.changedFraction>=bands.landChanged&&landDelta.changedGridFraction>=bands.landGrid,{calm:calmRoute.probe,warning:warningRoute.probe,warningDelta,landDelta});
  gate('harbor, old row, and Crown Grid change composition',Object.values(districtPairs).every(v=>v.structureDistance>=bands.districtPair),districtPairs);
  gate('damage-to-recovery and decoy diversion are visibly authored',recoveryDelta.changedFraction>=bands.recoveryChanged&&recoveryDelta.changedGridFraction>=bands.recoveryGrid&&decoyDelta.changedFraction>=bands.decoyChanged,{recoveryDelta,decoyDelta});
  gate('responder movement and kaiju reaction animate in aligned crops',heroBurst&&kaijuBurst&&heroBurst.changedFraction.max>=bands.heroAnim&&kaijuBurst.changedFraction.max>=bands.kaijuAnim,{heroBurst,kaijuBurst});
  gate('district survival has physical staging plus authored payoff motion',apexNoFx.probe.evacuated===12&&apexFx.changedFraction>=bands.apexFx&&apexFx.changedGridFraction>=bands.apexFxGrid&&apexBurst.changedFraction.max>=bands.apexBurst&&apexBurst.changedGridFraction.max>=bands.apexBurstGrid,{apexNoFx:apexNoFx.probe,apexFx,apexBurst});

  const gameHash=sha256(GAME_PATH);writeJson(TEMPLATE_PATH,reviewTemplate(sheet.sha256,gameHash,evidence.beats));let review;if(fs.existsSync(REVIEW_PATH)){review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256});if(review.receipt.game!=='kaiju-control'||review.receipt.gameSha256!==gameHash||review.receipt.seed!=='0x'+SEED.toString(16)||JSON.stringify(review.receipt.checkpoints)!==JSON.stringify(evidence.beats.map(b=>b.id+'@'+b.offset))){review.ok=false;review.errors.push('review identity, game hash, seed, or checkpoints are stale')}}else review={ok:false,errors:['missing semantic review '+REVIEW_PATH,'inspect '+CONTACT_PATH+' and complete '+TEMPLATE_PATH]};gate('fresh native-size semantic comparison receipt',review.ok,review.errors);
  const report={schema:1,game:'kaiju-control',gameSha256:gameHash,seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,contactSheet:{path:CONTACT_PATH,trackedPath:TRACKED_CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},renderedClip:{path:path.join(ARTIFACT_DIR,'kaiju-control-final-60s.mp4'),seed:'0x4b433954',seconds:60,fps:30,sha256:'1d5a29ceffa5c5124d7c1a07167f5c895a732332857fcec534138e4ac9653e23'},checkpoints:Object.fromEntries(evidence.beats.map(b=>[b.id,{fixture:evidence.specs[b.id].fixture,offset:b.offset,probe:evidence.frames[b.id].probe}])),thresholds:{actorScale:{standard:{maxWidth:20,maxHeight:32},structure:{maxWidth:24,maxHeight:24},boss:{maxWidth:34,maxHeight:34},runway:.55,footprint:.20,extentThreshold:THRESHOLD},bands,referenceEdge:refEdge,referenceRich:refRich},metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,scale:scale.measurements,footprints:footprintSets,approaches,planRoute:planRoute.delta,warningRoute:warningRoute.delta,warningDelta,landDelta,districtPairs,recoveryDelta,decoyDelta,heroBurst,kaijuBurst,apexFx,apexBurst},gates,automatedOk:gates.slice(0,-1).every(g=>g.ok),semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}};writeJson(METRICS_PATH,report);
  console.log('KAIJU CONTROL visual evidence · seed 0x'+SEED.toString(16));for(const g of gates)console.log('  '+(g.ok?'PASS':'FAIL')+' '+g.name);console.log('  contact: '+CONTACT_PATH);console.log('  tracked contact: '+TRACKED_CONTACT_PATH);console.log('  montage sha256: '+sheet.sha256);console.log('  game sha256: '+gameHash);console.log('  metrics: '+METRICS_PATH);console.log('  review template: '+TEMPLATE_PATH);if(!gates.every(g=>g.ok)){console.error('\nKAIJU CONTROL VISUAL EVAL FAILED');process.exit(1)}console.log('\nKAIJU CONTROL VISUAL EVAL PASSED');
}
main().catch(error=>{console.error('KAIJU CONTROL VISUAL EVAL FAILED:',error.stack||error);process.exit(1)});
