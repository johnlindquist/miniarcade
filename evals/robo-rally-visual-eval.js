#!/usr/bin/env node
'use strict';

// Real-pixel release gate for ROBO RALLY. The game supplies deterministic
// authored beats and search boxes; every size, motion, richness, structure,
// and payoff measurement below comes from the actual rendered RGBA at 160x360.
const fs=require('fs');
const path=require('path');
const{bootRenderedGame,rgbaFrame,encodeRgbaPng}=require('../render/runtime');
const{
  sha256,toNativeFrame,analyzeFrame,frameDifference,structureDistance,analyzeBurst,
  measureDrawnActorExtent,assertActorScale,writeContactSheet,verifyReviewReceipt,writeJson,quantile
}=require('./visual-harness');

const ROOT=path.join(__dirname,'..','..'),GAME_PATH=path.join(__dirname,'..','robo-rally.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','robo-rally'),FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const TRACKED_CONTACT_PATH=path.join(__dirname,'visual-receipts','robo-rally-contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json'),REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','robo-rally.json');
const CLIP_PATH=path.join(ARTIFACT_DIR,'robo-rally-30s.mp4');
const SEED=0xa100,RENDER_EVERY=2,WORLD_CROP={x:0,y:101,width:160,height:251};
const ACTOR_PADDING=8,ACTOR_THRESHOLD=8;
const median=a=>quantile(a,.5);

if(!fs.existsSync(GAME_PATH)){console.error('ROBO RALLY VISUAL EVAL FAILED: missing '+GAME_PATH);process.exit(1);}

function probe(runtime){const fn=runtime.sandbox.__roboRallyVisualProbe;if(typeof fn!=='function')throw new Error('missing __roboRallyVisualProbe');
  const value=fn();if(!value||value.finite===false)throw new Error('non-finite visual fixture');return value;}
function captureFixture(name,offsets,options){options=options||{};const runtime=bootRenderedGame('robo-rally',{seed:SEED});
  if(options.beforeSet)options.beforeSet(runtime);const set=runtime.sandbox.__roboRallySetVisualBeat;
  if(typeof set!=='function'||set(name)!==true)throw new Error('unknown visual beat '+name);
  if(options.selector!==undefined)runtime.sandbox.__RR_VISUAL_ONLY_ACTOR=options.selector;
  if(options.afterSet)options.afterSet(runtime);const frames=new Map();
  for(const target of[...new Set(offsets)].sort((a,b)=>a-b)){runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});
    const frame=runtime.snapshot({native:true});frame.probe=probe(runtime);frame.fixture=name;frame.offset=target;frames.set(target,frame);}
  return frames;
}
function captureTimeline(game,seed,targets){const runtime=bootRenderedGame(game,{seed}),frames=new Map();
  for(const target of targets){const cold=Math.max(runtime.frame,target-120);if(cold>runtime.frame)runtime.advanceTo(cold);runtime.advanceTo(target,{renderEvery:2,renderLast:true});frames.set(target,runtime.snapshot({native:true}));}return frames;}
function fixtureActors(probeValue,label){if(!Array.isArray(probeValue.actors)||!probeValue.actors.length)throw new Error(label+': actors[] missing');
  const ids=new Set();for(const actor of probeValue.actors){if(!actor.id||!actor.kind||ids.has(actor.id))throw new Error(label+': malformed/duplicate actor');ids.add(actor.id);
    if(!actor.box||![actor.box.x,actor.box.y,actor.box.width,actor.box.height].every(Number.isFinite))throw new Error(label+': bad actor box '+actor.id);}return probeValue.actors;}
function limitsFor(actor){return actor.kind==='structure'?{maxWidth:24,maxHeight:24}:{maxWidth:20,maxHeight:32};}
function measureActors(name,offset){const normal=captureFixture(name,[offset]).get(offset),actors=fixtureActors(normal.probe,name),
  baseline=captureFixture(name,[offset],{selector:'none'}).get(offset),measurements=[];
  for(const actor of actors){const isolated=captureFixture(name,[offset],{selector:actor.id}).get(offset),m=measureDrawnActorExtent(isolated,baseline,
    {id:actor.id,kind:actor.kind,type:actor.type,probeBox:actor.box,padding:ACTOR_PADDING,threshold:ACTOR_THRESHOLD}),a=assertActorScale(m,Object.assign({label:actor.id},limitsFor(actor)));
    measurements.push(Object.assign(m,{assertion:{ok:a.ok,failures:a.failures,limits:a.limits}}));}
  return{fixture:name,offset,normal,measurements};
}
function footprint(set){const playfield=set.normal.probe.layout.playfield,area=playfield.width*playfield.height;
  const sum=set.measurements.reduce((n,m)=>n+(m.bounds?m.bounds.width*m.bounds.height:0),0),fraction=sum/area,
    failures=set.measurements.flatMap(m=>m.assertion.failures).concat(set.measurements.filter(m=>m.clipped||m.probeOverflow&&m.probeOverflow.any).map(m=>m.id+': clipped or outside probe'));
  if(fraction>.20)failures.push(`summed actor footprint ${fraction.toFixed(4)} > .20`);
  return{fixture:set.fixture,actors:set.measurements.length,playfield,sumBboxArea:sum,fraction:+fraction.toFixed(6),ok:failures.length===0,failures,measurements:set.measurements};
}
function approach(layout){const denominator=layout.visibleSpawnY-layout.goalY,measured=(layout.visibleSpawnY-layout.contactY)/denominator;
  return{visibleSpawnY:layout.visibleSpawnY,contactY:layout.contactY,goalY:layout.goalY,reported:layout.approachVisibilityFraction,
    measured:+measured.toFixed(6),ok:denominator>0&&measured>=.55&&Math.abs(measured-layout.approachVisibilityFraction)<1e-6};}
function cropAround(frame,box,size){const source=toNativeFrame(frame),cx=Math.round(box.x+box.width/2),cy=Math.round(box.y+box.height/2),left=cx-size/2,top=cy-size/2,out=Buffer.alloc(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const sx=left+x,sy=top+y,d=(y*size+x)*4;if(sx<0||sy<0||sx>=source.width||sy>=source.height){out[d+3]=255;continue;}const s=(sy*source.width+sx)*4;out[d]=source.rgba[s];out[d+1]=source.rgba[s+1];out[d+2]=source.rgba[s+2];out[d+3]=source.rgba[s+3];}
  return rgbaFrame(out,size,size);
}
function alignedBurst(frames,id,size){const crops=frames.map(frame=>{const actor=frame.probe.actors.find(a=>a.id===id);if(!actor)throw new Error('missing '+id);return cropAround(frame,actor.box,size);}),differences=[];
  for(let i=1;i<crops.length;i++)differences.push(frameDifference(crops[i-1],crops[i],{native:false}));
  return{frames:crops.length,differences,changedFraction:{min:Math.min(...differences.map(d=>d.changedFraction)),median:median(differences.map(d=>d.changedFraction)),max:Math.max(...differences.map(d=>d.changedFraction))},
    firstLast:frameDifference(crops[0],crops.at(-1),{native:false})};}
function reviewTemplate(montageSha256,beats){const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});return{schema:1,game:'robo-rally',verdict:'pending',references:['horizon','blockmine'],montageSha256,
  reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size review',seed:'0x'+SEED.toString(16),checkpoints:beats.map(b=>b.fixture+'@'+b.offset),
  categories:{characterCraft:pending('Inspect all four constructed silhouettes, facing, gait, recoil, panic, and collision poses.'),
    environmentCraft:pending('Inspect foundry, refinery, and skydock material grammar, landmarks, depth, and motion with the HUD mentally hidden.'),
    levelVariety:pending('Confirm later arenas rebuild composition and hazard silhouettes rather than recolor one board.'),
    animationImpact:pending('Confirm reveal anticipation, simultaneous execution, pileup, final-card failure, and apex have readable timing and aftermath.'),
    readability:pending('Confirm five real instructions per racer and projected paths remain forecastable beside video at 160x360.'),
    artDirectionCohesion:pending('Confirm broadcast deck, tiny robots, industrial courses, hazards, and payoff language feel authored as one world.')},
  renderReceipt:{seed:'0x'+SEED.toString(16),seconds:30,fps:30,dimensions:'320x720',command:'node render/render.js robo-rally 30 .artifacts/visual/robo-rally/robo-rally-30s.mp4 --seed 41216 --probe --fps 30'}};}

async function main(){fs.mkdirSync(FRAME_DIR,{recursive:true});for(const f of fs.readdirSync(FRAME_DIR))if(f.endsWith('.png'))fs.unlinkSync(path.join(FRAME_DIR,f));
  const specs={
    opening:{fixture:'opening',offsets:[3,8,12]},reveal:{fixture:'program-reveal',offsets:[3,8,12]},execution:{fixture:'execution',offsets:[1,4,8,12,16]},
    pileup:{fixture:'pileup',offsets:[1,4,6,10,16]},warning:{fixture:'warning',offsets:[3,8,12]},later:{fixture:'later',offsets:[3,8,12]},
    last:{fixture:'last-card',offsets:[1,4,6,10,16]},apex:{fixture:'apex',offsets:[1,4,6,10,18]}
  };
  const runs={},repeat={};for(const[id,s]of Object.entries(specs)){runs[id]=captureFixture(s.fixture,s.offsets);repeat[id]=captureFixture(s.fixture,s.offsets);}
  const beats=[
    {id:'opening',label:'opening',run:'opening',fixture:'opening',offset:8},{id:'reveal',label:'program reveal',run:'reveal',fixture:'program-reveal',offset:12},
    {id:'execution',label:'execution',run:'execution',fixture:'execution',offset:12},{id:'pileup',label:'pileup',run:'pileup',fixture:'pileup',offset:6},
    {id:'warning',label:'act warning',run:'warning',fixture:'warning',offset:12},{id:'later',label:'later course',run:'later',fixture:'later',offset:12},
    {id:'last',label:'last card',run:'last',fixture:'last-card',offset:6},{id:'apex',label:'apex',run:'apex',fixture:'apex',offset:6}
  ];
  const candidate=Object.fromEntries(beats.map(b=>[b.id,runs[b.run].get(b.offset)]));
  const determinism=beats.map(b=>({beat:b.id,a:sha256(candidate[b.id].rgba),b:sha256(repeat[b.run].get(b.offset).rgba)}));
  const referenceTargets=[60,600,1200,2400,3600,5400,9000,12000],horizon=captureTimeline('horizon',0xa1020401,referenceTargets),blockmine=captureTimeline('blockmine',0xb10c0050,referenceTargets),horizonBy={},blockmineBy={};
  beats.forEach((b,i)=>{horizonBy[b.id]=horizon.get(referenceTargets[i]);blockmineBy[b.id]=blockmine.get(referenceTargets[i]);fs.writeFileSync(path.join(FRAME_DIR,`${String(i+1).padStart(2,'0')}-${b.id}.png`),encodeRgbaPng(candidate[b.id]));});
  const sheet=writeContactSheet({beats:beats.map(b=>({id:b.id,label:b.label})),rows:[{label:'ROBO RALLY',frames:candidate},{label:'MACHINE HUNT',frames:horizonBy},{label:'BLOCK MINE',frames:blockmineBy}],outPath:CONTACT_PATH});

  const metrics=Object.fromEntries(beats.map(b=>[b.id,analyzeFrame(candidate[b.id],{native:false,crop:WORLD_CROP})])),cm=Object.values(metrics);
  const hm=beats.map(b=>analyzeFrame(horizonBy[b.id],{native:false,crop:WORLD_CROP})),bm=beats.map(b=>analyzeFrame(blockmineBy[b.id],{native:false,crop:WORLD_CROP}));
  const referenceEdge=Math.min(median(hm.map(m=>m.edge[1].energy)),median(bm.map(m=>m.edge[1].energy))),referenceRich=Math.min(median(hm.map(m=>m.richCellFraction)),median(bm.map(m=>m.richCellFraction)));
  const scale=measureActors('scale-contract',8),samples={opening:footprint(measureActors('opening',8)),pileup:footprint(measureActors('pileup',6)),later:footprint(measureActors('later',12))};
  const runApproach=approach(scale.normal.probe.layout),robotBurst=alignedBurst([1,4,8,12,16].map(n=>runs.execution.get(n)),'robot-1',32);
  const pileupBurst=analyzeBurst([1,4,6,10,16].map(n=>runs.pileup.get(n)),{native:false,crop:WORLD_CROP}),lastBurst=analyzeBurst([1,4,6,10,16].map(n=>runs.last.get(n)),{native:false,crop:WORLD_CROP}),apexBurst=analyzeBurst([1,4,6,10,18].map(n=>runs.apex.get(n)),{native:false,crop:WORLD_CROP});
  const warningCalm=captureFixture('warning',[12],{afterSet:r=>r.evaluate("act.phase='calm';visualFixture='fixture';")}).get(12),warningDelta=frameDifference(warningCalm,candidate.warning,{native:false,crop:WORLD_CROP});
  const apexCalm=captureFixture('apex',[6],{beforeSet:r=>{r.sandbox.__NO_PAYOFF_FX=1;},afterSet:r=>r.evaluate("transitionT=0;visualFixture='fixture';pres={cue:null,t:0,holdWorld:false,physicsEvery:1,admire:false};impact=null;")}).get(6),apexNoFx=captureFixture('apex',[6],{beforeSet:r=>{r.sandbox.__NO_PAYOFF_FX=1;}}).get(6),apexPhysical=frameDifference(apexCalm,apexNoFx,{native:false,crop:WORLD_CROP}),apexFx=frameDifference(apexNoFx,candidate.apex,{native:false,crop:WORLD_CROP});
  const levelDistance=structureDistance(candidate.opening,candidate.later,{crop:WORLD_CROP}),deckDelta=frameDifference(candidate.reveal,candidate.execution,{native:false,crop:{x:4,y:5,width:152,height:94}});

  // Floors are calibrated from this fixed-seed approval capture and preserve
  // roughly 10-20% room below its measured values. The metrics file retains
  // the exact evidence alongside reference medians for later re-derivation.
  const bands={colors:90,entropy:2.85,lumaStdDev:.085,largest:.34,edge:.018,richEach:.72,richMedian:.82,
    robotAnim:.045,robotStructure:.035,levelStructure:.12,deckChanged:.08,warningChanged:.12,
    pileupChanged:.028,pileupGrid:.24,lastChanged:.022,lastGrid:.22,apexChanged:.019,apexGrid:.28,
    apexPhysical:.12,apexFx:.0045};
  const gates=[],gate=(name,ok,detail)=>gates.push({name,ok:!!ok,detail});
  gate('same-seed real pixels deterministic',determinism.every(v=>v.a===v.b),determinism);
  gate('all representative probes are finite and truthful',beats.every(b=>candidate[b.id].probe&&candidate[b.id].probe.finite!==false),beats.map(b=>({id:b.id,probe:candidate[b.id].probe})));
  gate('scale fixture covers four robot silhouettes and placed structures',scale.measurements.filter(m=>m.kind==='robot').length===4&&scale.measurements.some(m=>m.kind==='structure'),scale.measurements.map(m=>({id:m.id,kind:m.kind,type:m.type})));
  gate('drawn robot and structure pixels obey native scale caps',scale.measurements.every(m=>m.assertion.ok&&!m.clipped&&!(m.probeOverflow&&m.probeOverflow.any)),scale.measurements);
  gate('normal-play drawn actors obey caps and stay under 20% footprint',Object.values(samples).every(s=>s.ok),samples);
  gate('rival approach remains visible across at least 55% of travel axis',runApproach.ok,runApproach);
  gate('frames are opaque, non-flat, and spatially rich',cm.every(m=>m.opaqueFraction===1&&m.quantizedColors>=bands.colors&&m.colorEntropy>=bands.entropy&&m.lumaStdDev>=bands.lumaStdDev&&m.largestColorShare<=bands.largest&&m.richCellFraction>=bands.richEach)&&median(cm.map(m=>m.richCellFraction))>=bands.richMedian,cm);
  gate('multiscale world detail is reference-comparable',cm.every(m=>m.edge[1].energy>=Math.max(bands.edge,referenceEdge*.85))&&median(cm.map(m=>m.richCellFraction))>=Math.max(bands.richMedian,referenceRich*.9),{candidateEdge:cm.map(m=>m.edge[1].energy),referenceEdge,candidateRich:cm.map(m=>m.richCellFraction),referenceRich});
  gate('constructed robot has aligned locomotion animation',robotBurst.changedFraction.max>=bands.robotAnim&&robotBurst.firstLast.changedFraction>=bands.robotStructure&&robotBurst.changedFraction.max<.7,robotBurst);
  gate('program deck visibly changes from reveal to execution',deckDelta.changedFraction>=bands.deckChanged,deckDelta);
  gate('later skydock rebuilds course structure',levelDistance.structureDistance>=bands.levelStructure,levelDistance);
  gate('act warning is spatially broad before landing',warningDelta.changedFraction>=bands.warningChanged&&warningDelta.changedGridFraction>=.75,warningDelta);
  gate('pileup carries impact and aftermath',pileupBurst.changedFraction.max>=bands.pileupChanged&&pileupBurst.changedGridFraction.max>=bands.pileupGrid,pileupBurst);
  gate('last instruction failure reads across the board',lastBurst.changedFraction.max>=bands.lastChanged&&lastBurst.changedGridFraction.max>=bands.lastGrid,lastBurst);
  gate('apex has authored physical presentation without particles',apexPhysical.changedFraction>=bands.apexPhysical&&apexPhysical.changedGridFraction>=.40,apexPhysical);
  gate('payoff FX add a broad sim-inert layer',apexFx.changedFraction>=bands.apexFx&&apexFx.changedBoundsFraction>=.12&&apexBurst.changedFraction.max>=bands.apexChanged&&apexBurst.changedGridFraction.max>=bands.apexGrid,{apexFx,apexBurst});

  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256,beats));let review;
  if(fs.existsSync(REVIEW_PATH))review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256,preservedPath:TRACKED_CONTACT_PATH});else review={ok:false,errors:[`missing committed semantic review: ${REVIEW_PATH}`,`inspect ${CONTACT_PATH} and complete ${REVIEW_TEMPLATE_PATH}`]};
  gate('fresh semantic comparison receipt',review.ok,review.errors);
  const clip=fs.existsSync(CLIP_PATH)?{path:CLIP_PATH,bytes:fs.statSync(CLIP_PATH).size,sha256:sha256(CLIP_PATH),seed:'0x'+SEED.toString(16),seconds:30,fps:30,dimensions:'320x720',
    command:'node render/render.js robo-rally 30 .artifacts/visual/robo-rally/robo-rally-30s.mp4 --seed 41216 --probe --fps 30'}:null;
  const reviewClip=review.receipt&&review.receipt.renderReceipt;
  gate('rendered autoplay clip receipt is complete',!!reviewClip&&reviewClip.bytes>100000&&/^[a-f0-9]{64}$/.test(reviewClip.sha256||'')&&reviewClip.seed===`0x${SEED.toString(16)}`&&reviewClip.command===reviewTemplate(sheet.sha256,beats).renderReceipt.command,reviewClip);
  gate('local rendered clip matches its receipt when available',!clip||reviewClip.sha256===clip.sha256&&reviewClip.bytes===clip.bytes&&reviewClip.seed===clip.seed,{clip,reviewClip});
  const report={schema:1,game:'robo-rally',seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,contactSheet:{path:CONTACT_PATH,trackedPath:TRACKED_CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},clip,
    checkpoints:Object.fromEntries(beats.map(b=>[b.id,{fixture:b.fixture,offset:b.offset,probe:candidate[b.id].probe}])),thresholds:{actorScale:{robot:{maxWidth:20,maxHeight:32},structure:{maxWidth:24,maxHeight:24},approach:.55,footprint:.20,threshold:ACTOR_THRESHOLD},bands,referenceEdge,referenceRich},
    metrics:{frames:metrics,horizon:hm,blockmine:bm,scale:scale.measurements,footprints:samples,approach:runApproach,robotBurst,deckDelta,levelDistance,warningDelta,pileupBurst,lastBurst,apexPhysical,apexFx,apexBurst},
    gates,automatedOk:gates.filter(g=>g.name!=='fresh semantic comparison receipt').every(g=>g.ok),semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}};
  writeJson(METRICS_PATH,report);
  console.log(`ROBO RALLY visual evidence · seed 0x${SEED.toString(16)}`);for(const g of gates)console.log(`  ${g.ok?'PASS':'FAIL'} ${g.name}`);
  console.log('  contact:',CONTACT_PATH);console.log('  tracked contact:',TRACKED_CONTACT_PATH);console.log('  montage sha256:',sheet.sha256);console.log('  metrics:',METRICS_PATH);console.log('  review template:',REVIEW_TEMPLATE_PATH);
  if(!gates.every(g=>g.ok)){console.error('\nROBO RALLY VISUAL EVAL FAILED');process.exit(1);}console.log('\nROBO RALLY VISUAL EVAL PASSED');
}
main().catch(error=>{console.error('ROBO RALLY VISUAL EVAL FAILED:',error.stack||error);process.exit(1);});
