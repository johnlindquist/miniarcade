#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const{bootRenderedGame,rgbaFrame,encodeRgbaPng}=require('../render/runtime');
const{
  sha256,toNativeFrame,analyzeFrame,frameDifference,structureDistance,analyzeBurst,
  measureDrawnActorExtent,assertActorScale,writeContactSheet,verifyReviewReceipt,writeJson,quantile
}=require('./visual-harness');

const ROOT=path.join(__dirname,'..','..'),GAME_PATH=path.join(__dirname,'..','hotel-haunt.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','hotel-haunt'),FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png'),METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json'),
  TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const TRACKED_CONTACT_PATH=path.join(__dirname,'visual-receipts','hotel-haunt-contact-sheet.png');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','hotel-haunt.json');
const SEED=0x484854,WORLD_CROP={x:0,y:42,width:160,height:284},RENDER_EVERY=2,PADDING=8,THRESHOLD=8;
const median=v=>quantile(v,.5);

if(!fs.existsSync(GAME_PATH)){console.error('HOTEL HAUNT VISUAL EVAL FAILED: missing game');process.exit(1)}

function visualProbe(runtime){const fn=runtime.sandbox.__hotelHauntVisualProbe;if(typeof fn!=='function')throw new Error('missing __hotelHauntVisualProbe');const p=fn();if(!p||p.finite===false)throw new Error('non-finite visual fixture');return p}
function captureFixture(name,offsets,options){
  options=options||{};const runtime=bootRenderedGame('hotel-haunt',{seed:SEED});if(options.beforeSet)options.beforeSet(runtime);
  const set=runtime.sandbox.__hotelHauntSetVisualBeat;if(typeof set!=='function'||set(name)!==true)throw new Error('unknown visual beat '+name);
  if(options.actorSelector!==undefined)runtime.sandbox.__HH_VISUAL_ONLY_ACTOR=options.actorSelector;
  if(options.hideRoute)runtime.sandbox.__HH_HIDE_ROUTE=1;if(options.afterSet)options.afterSet(runtime);
  const frames=new Map();for(const target of[...new Set(offsets)].sort((a,b)=>a-b)){
    if(target===runtime.frame)runtime.evaluate('render()');else runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});const frame=runtime.snapshot({native:true});
    frame.probe=visualProbe(runtime);frame.fixture=name;frame.offset=target;frames.set(target,frame);
  }return frames;
}
function captureTimeline(game,seed,targets){const runtime=bootRenderedGame(game,{seed}),frames=new Map();for(const target of targets){runtime.advanceTo(Math.max(runtime.frame,target-120));runtime.advanceTo(target,{renderEvery:RENDER_EVERY,renderLast:true});frames.set(target,runtime.snapshot({native:true}))}return frames}
function cleanPlateMask(actorFrame,baselineFrame){
  const actor=toNativeFrame(actorFrame),baseline=toNativeFrame(baselineFrame);if(actor.width!==baseline.width||actor.height!==baseline.height)throw new Error('actor mask frame dimensions differ');
  const rgba=Buffer.alloc(actor.width*actor.height*4);for(let i=0;i<rgba.length;i+=4){
    rgba[i]=Math.abs(actor.rgba[i]-baseline.rgba[i]);rgba[i+1]=Math.abs(actor.rgba[i+1]-baseline.rgba[i+1]);
    rgba[i+2]=Math.abs(actor.rgba[i+2]-baseline.rgba[i+2]);rgba[i+3]=255;
  }return rgbaFrame(rgba,actor.width,actor.height);
}
function cleanPlateActorBurst(fixture,offsets,actorId){
  const actorFrames=captureFixture(fixture,offsets,{actorSelector:actorId}),baselines=captureFixture(fixture,offsets,{actorSelector:'none'}),masks=[];
  for(const offset of offsets)masks.push(cleanPlateMask(actorFrames.get(offset),baselines.get(offset)));
  const differences=[];for(let i=1;i<masks.length;i++)differences.push(frameDifference(masks[i-1],masks[i],{native:false,crop:WORLD_CROP}));
  const values=differences.map(d=>d.changedFraction);return{actorId,cleanPlate:true,frames:masks.length,differences,
    changedFraction:{min:Math.min(...values),median:median(values),max:Math.max(...values)},
    firstLast:frameDifference(masks[0],masks.at(-1),{native:false,crop:WORLD_CROP})};
}
function actorLimits(actor){if(actor.kind==='structure')return{maxWidth:24,maxHeight:24};if(actor.kind==='boss')return{maxWidth:34,maxHeight:34};return{maxWidth:20,maxHeight:32}}
function measureActors(fixture,offset,probe){
  const actors=probe.actors;if(!Array.isArray(actors)||!actors.length)throw new Error(fixture+': actors missing');
  const base=captureFixture(fixture,[offset],{actorSelector:'none'}).get(offset),measurements=[];
  for(const actor of actors){const isolated=captureFixture(fixture,[offset],{actorSelector:actor.id}).get(offset),
    measurement=measureDrawnActorExtent(isolated,base,{id:actor.id,kind:actor.kind,type:actor.type,probeBox:actor.box,padding:PADDING,threshold:THRESHOLD}),
    assertion=assertActorScale(measurement,Object.assign({label:actor.kind+' '+actor.type},actorLimits(actor)));
    measurements.push(Object.assign(measurement,{floor:actor.floor,scope:actor.scope,assertion:{ok:assertion.ok,failures:assertion.failures,limits:assertion.limits}}));
  }return{fixture,offset,measurements};
}
function intersectBounds(bounds,playfield){if(!bounds||!playfield)return null;const x=Math.max(bounds.x,Math.ceil(playfield.x)),y=Math.max(bounds.y,Math.ceil(playfield.y)),right=Math.min(bounds.x+bounds.width,Math.floor(playfield.x+playfield.width)),bottom=Math.min(bounds.y+bounds.height,Math.floor(playfield.y+playfield.height));return right>x&&bottom>y?{x,y,width:right-x,height:bottom-y}:null}
// Footprint scope is every interactive active-floor actor plus any possessed
// furniture visibly twitching on another floor. Static cleared furniture is
// environmental hotel dressing, matching the actor/environment split used by
// the reference suites; actor isolation deliberately leaves it on the plate.
function footprint(label,set,playfield){
  const valid=playfield&&[playfield.x,playfield.y,playfield.width,playfield.height].every(Number.isFinite)&&playfield.width===160&&playfield.height===284;
  if(!valid)return{label,ok:false,errors:['probe playfield must be 160x284'],playfield};
  const visible=set.measurements.map(m=>intersectBounds(m.bounds,playfield)).filter(Boolean),area=playfield.width*playfield.height,
    sum=visible.reduce((n,b)=>n+b.width*b.height,0),invalid=set.measurements.flatMap(m=>{const errors=[];if(!m.bounds||m.drawnPixels<1)errors.push(m.id+': no rendered actor pixels measured');if(m.clipped)errors.push(m.id+': drawn extent touches its measurement crop');if(m.probeOverflow&&m.probeOverflow.any)errors.push(m.id+': drawn extent exceeds its probe box');return errors}),
    failures=set.measurements.flatMap(m=>m.assertion.failures),fraction=sum/area,errors=[...invalid,...failures];if(fraction>.20)errors.push(label+': summed actor footprint '+fraction.toFixed(4)+' > 0.20');
  return{label,scope:'active + visible possession; static inactive furniture is environment',actors:set.measurements.length,scopeCounts:set.measurements.reduce((out,m)=>(out[m.scope]=(out[m.scope]||0)+1,out),{}),sumBboxArea:sum,fraction:+fraction.toFixed(6),scaleOk:!failures.length,failures,errors,ok:!errors.length};
}
function approaches(layout){return(layout&&layout.approaches||[]).map(a=>{const measured=Math.abs(a.contact-a.visibleSpawn)/Math.abs(a.goal-a.visibleSpawn);return{...a,measured:+measured.toFixed(6),matches:Math.abs(measured-a.reported)<1e-6,ok:measured>=.55&&Math.abs(measured-a.reported)<1e-6}})}
function routeEvidence(fixture,offset){const on=captureFixture(fixture,[offset]).get(offset),off=captureFixture(fixture,[offset],{hideRoute:true}).get(offset);return{on,off,delta:frameDifference(off,on,{native:false,crop:WORLD_CROP}),probe:on.probe}}
function reviewTemplate(montageHash,gameHash,beats){const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});return{schema:1,game:'hotel-haunt',verdict:'pending',references:['horizon','blockmine'],montageSha256:montageHash,gameSha256:gameHash,seed:'0x'+SEED.toString(16),checkpoints:beats.map(b=>b.id+'@'+b.offset),reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size review',categories:{characterCraft:pending('Inspect the tiny hunter construction, gait, sweep, vacuum, brace and spook poses plus wisp, rascal, bellhop and concierge silhouettes at 160x360.'),environmentCraft:pending('Inspect the built cutaway hotel, facade, elevator, vents, room materials, furniture silhouettes, lighting depth and HUD-free sense of place.'),levelVariety:pending('Confirm lobby, suites, spa and ballroom change composition, landmarks, materials and silhouettes rather than only palette.'),animationImpact:pending('Confirm furniture twitch, sweeping, reveal, vent transit, chase, possession, warning arrival, capture and broad relight have anticipation and follow-through.'),readability:pending('Confirm the small cast, dotted containment plan, target order, sealed vents, ghost routes, room state and permanent tower progress remain clear beside video.'),artDirectionCohesion:pending('Confirm spectral cyan/lilac, brass relight, haunted-hotel materials, character shapes, route grammar and broadcast HUD form one authored visual language.')}}}

function gameEvidence(){
  const specs={
    opening:{fixture:'opening',offsets:[1,4,8,12]},plan:{fixture:'plan',offsets:[1,4,8,12]},sweep:{fixture:'sweep-b',offsets:[0]},
    reveal:{fixture:'reveal',offsets:[1,4,8,12]},vent:{fixture:'vent',offsets:[1,4,8,12]},danger:{fixture:'danger',offsets:[1,4,8,12]},
    relight:{fixture:'relight',offsets:[1,6,12,24]},suites:{fixture:'suites',offsets:[1,4,8,12]},later:{fixture:'later',offsets:[1,4,8,12]},
    warning:{fixture:'warning',offsets:[1,4,8,12]},checkin:{fixture:'act-land',offsets:[1,4,8,12]},penthouse:{fixture:'penthouse',offsets:[1,4,8,12]},
    apex:{fixture:'apex',offsets:[1,6,12,24,48]}
  },runs={};for(const[id,s]of Object.entries(specs))runs[id]=captureFixture(s.fixture,s.offsets);
  const beats=[
    {id:'opening',label:'opening',offset:12},{id:'plan',label:'sweep plan',offset:12},{id:'sweep',label:'sweep',offset:0},
    {id:'reveal',label:'reveal',offset:8},{id:'vent',label:'vent flee',offset:8},{id:'danger',label:'broken plan',offset:8},
    {id:'relight',label:'floor relit',offset:12},{id:'suites',label:'moon suites',offset:12},{id:'later',label:'thermal spa',offset:12},
    {id:'warning',label:'warning',offset:12},{id:'checkin',label:'check-in',offset:8},{id:'penthouse',label:'concierge',offset:8},
    {id:'apex',label:'wing relit',offset:12}
  ];return{specs,runs,beats,frames:Object.fromEntries(beats.map(b=>[b.id,runs[b.id].get(b.offset)]))};
}

async function main(){
  fs.mkdirSync(FRAME_DIR,{recursive:true});for(const file of fs.readdirSync(FRAME_DIR))if(file.endsWith('.png'))fs.unlinkSync(path.join(FRAME_DIR,file));
  const evidence=gameEvidence(),repeat=gameEvidence(),determinism=evidence.beats.map(b=>({beat:b.id,a:sha256(evidence.frames[b.id].rgba),b:sha256(repeat.frames[b.id].rgba),ok:sha256(evidence.frames[b.id].rgba)===sha256(repeat.frames[b.id].rgba)}));
  const refTargets=[60,420,900,1500,2400,3600,4800,6000,7200,9000,11000,13500,16000],horizon=captureTimeline('horizon',0xa1020401,refTargets),blockmine=captureTimeline('blockmine',0xb10c0050,refTargets),horizonFrames={},blockmineFrames={};
  evidence.beats.forEach((beat,i)=>{horizonFrames[beat.id]=horizon.get(refTargets[i]);blockmineFrames[beat.id]=blockmine.get(refTargets[i]);fs.writeFileSync(path.join(FRAME_DIR,String(i+1).padStart(2,'0')+'-'+beat.id+'.png'),encodeRgbaPng(evidence.frames[beat.id]))});
  const sheet=writeContactSheet({beats:evidence.beats.map(b=>({id:b.id,label:b.label})),rows:[{label:'HOTEL HAUNT',frames:evidence.frames},{label:'MACHINE HUNT',frames:horizonFrames},{label:'BLOCK MINE',frames:blockmineFrames}],outPath:CONTACT_PATH});

  const candidateMetrics=Object.fromEntries(evidence.beats.map(b=>[b.id,analyzeFrame(evidence.frames[b.id],{native:false,crop:WORLD_CROP})])),cm=Object.values(candidateMetrics),
    horizonMetrics=evidence.beats.map(b=>analyzeFrame(horizonFrames[b.id],{native:false,crop:WORLD_CROP})),blockmineMetrics=evidence.beats.map(b=>analyzeFrame(blockmineFrames[b.id],{native:false,crop:WORLD_CROP}));
  const refEdge=Math.min(median(horizonMetrics.map(m=>m.edge[1].energy)),median(blockmineMetrics.map(m=>m.edge[1].energy))),
    refRich=Math.min(median(horizonMetrics.map(m=>m.richCellFraction)),median(blockmineMetrics.map(m=>m.richCellFraction)));

  const scaleFixtures=['opening','suites','later','reveal','danger','act-land','penthouse'],scaleSets={},scaleMeasurements=[],scaleKinds=new Map();
  for(const fixture of scaleFixtures){const frame=captureFixture(fixture,[1]).get(1),set=measureActors(fixture,1,frame.probe);scaleSets[fixture]=set;scaleMeasurements.push(...set.measurements);for(const m of set.measurements){const types=scaleKinds.get(m.kind)||new Set();types.add(m.type);scaleKinds.set(m.kind,types)}}
  const footprintSets={};for(const id of['plan','danger','later','penthouse']){const fixture=evidence.specs[id].fixture,frame=captureFixture(fixture,[1]).get(1),set=measureActors(fixture,1,frame.probe);footprintSets[id]=footprint(id,set,frame.probe.layout.playfield)}
  const runway=approaches(evidence.frames.opening.probe.layout);
  const planRoute=routeEvidence('plan',12),warningRoute=routeEvidence('warning',12),calmRoute=routeEvidence('warning-calm',12);
  const revealBefore=captureFixture('reveal-before',[1]).get(1),reveal=captureFixture('reveal',[1]).get(1),revealDelta=frameDifference(revealBefore,reveal,{native:false,crop:WORLD_CROP});
  const possessed=captureFixture('possessed',[1]).get(1),possessionDelta=frameDifference(evidence.frames.opening,possessed,{native:false,crop:WORLD_CROP});
  const relightBefore=captureFixture('relight-before',[1]).get(1),relight=captureFixture('relight',[1]).get(1),relightDelta=frameDifference(relightBefore,relight,{native:false,crop:WORLD_CROP});
  const warningDelta=frameDifference(calmRoute.on,warningRoute.on,{native:false,crop:WORLD_CROP}),checkin=captureFixture('act-land',[12]).get(12),checkinDelta=frameDifference(warningRoute.on,checkin,{native:false,crop:WORLD_CROP});
  const apexNoFx=captureFixture('apex',[12],{beforeSet:r=>{r.sandbox.__NO_PAYOFF_FX=1}}).get(12),apexDelta=frameDifference(apexNoFx,evidence.frames.apex,{native:false,crop:WORLD_CROP}),
    apexBefore=captureFixture('apex-before',[1],{beforeSet:r=>{r.sandbox.__NO_PAYOFF_FX=1}}).get(1),apexPhysical=frameDifference(apexBefore,apexNoFx,{native:false,crop:WORLD_CROP});
  const environment={opening:captureFixture('opening',[1],{actorSelector:'none',hideRoute:true}).get(1),suites:captureFixture('suites',[1],{actorSelector:'none',hideRoute:true}).get(1),later:captureFixture('later',[1],{actorSelector:'none',hideRoute:true}).get(1),penthouse:captureFixture('penthouse',[1],{actorSelector:'none',hideRoute:true}).get(1)},zonePairs={};
  for(const[a,b]of[['opening','suites'],['opening','later'],['opening','penthouse'],['suites','later'],['suites','penthouse'],['later','penthouse']])zonePairs[a+'-'+b]=structureDistance(environment[a],environment[b],{crop:WORLD_CROP});
  const motionOffsets=[1,4,8,12],dangerGhost=evidence.runs.danger.get(motionOffsets[0]).probe.actors.find(a=>a.id.startsWith('ghost-'));
  if(!dangerGhost)throw new Error('danger fixture has no rendered ghost actor');
  const hunterBurst=cleanPlateActorBurst('plan',motionOffsets,'hunter'),ghostBurst=cleanPlateActorBurst('danger',motionOffsets,dangerGhost.id),
    sweepPair=frameDifference(captureFixture('sweep-a',[0]).get(0),captureFixture('sweep-b',[0]).get(0),{native:false,crop:WORLD_CROP}),
    apexBurst=analyzeBurst([1,6,12,24,48].map(o=>evidence.runs.apex.get(o)),{native:false,crop:WORLD_CROP});

  // Locked observations from the fixed-seed native captures approved in the
  // tracked montage. Bands retain 80-90% of a required signal (or allow 20%
  // growth for the one upper bound) so this remains an executable regression
  // ratchet instead of deriving an always-passing threshold from the run under
  // test. Update these observations only with a newly reviewed montage.
  const knownGood={colors:200,entropy:5.206349,luma:.187111,largest:.104533,edge:.042896,richEach:1,richMedian:1,
    routeChanged:.004225,routeGrid:.088889,revealChanged:.013886,possessionChanged:.072799,relightChanged:.084067,
    warningChanged:.103191,checkinChanged:.119344,zonePair:.202789,hunterAnim:.006228,hunterTravel:.009177,
    ghostAnim:.005568,ghostTravel:.008781,sweepAnim:.001915,apexFx:.003675,apexPhysical:.148636,apexBurst:.111466};
  const retain=(value,margin=.20)=>+(value*(1-margin)).toFixed(6),allowGrowth=(value,margin=.20)=>+(value*(1+margin)).toFixed(6);
  const bands={colors:Math.floor(retain(knownGood.colors)),entropy:retain(knownGood.entropy),luma:retain(knownGood.luma),largest:allowGrowth(knownGood.largest),
    edge:retain(knownGood.edge),richEach:retain(knownGood.richEach,.15),richMedian:retain(knownGood.richMedian,.10),
    routeChanged:retain(knownGood.routeChanged),routeGrid:retain(knownGood.routeGrid),revealChanged:retain(knownGood.revealChanged),
    possessionChanged:retain(knownGood.possessionChanged),relightChanged:retain(knownGood.relightChanged),warningChanged:retain(knownGood.warningChanged),
    checkinChanged:retain(knownGood.checkinChanged),zonePair:retain(knownGood.zonePair),hunterAnim:retain(knownGood.hunterAnim),
    hunterTravel:retain(knownGood.hunterTravel),ghostAnim:retain(knownGood.ghostAnim),ghostTravel:retain(knownGood.ghostTravel),
    sweepAnim:retain(knownGood.sweepAnim),apexFx:retain(knownGood.apexFx),apexPhysical:retain(knownGood.apexPhysical),apexBurst:retain(knownGood.apexBurst)};
  const gates=[],gate=(name,ok,detail)=>gates.push({name,ok:!!ok,detail});
  gate('same-seed real pixels deterministic',determinism.every(d=>d.ok),determinism);
  gate('all checkpoints are finite and semantically staged',evidence.beats.every(b=>evidence.frames[b.id].probe&&evidence.frames[b.id].probe.finite)&&
    evidence.frames.opening.probe.floor===0&&evidence.frames.suites.probe.floor===1&&evidence.frames.later.probe.floor===2&&evidence.frames.penthouse.probe.floor===3&&
    evidence.frames.reveal.probe.ghostStates.includes('flee')&&evidence.frames.vent.probe.ghostStates.includes('venting')&&evidence.frames.relight.probe.lit&&
    evidence.frames.warning.probe.act==='warn'&&evidence.frames.checkin.probe.ghostStates.includes('arrival')&&evidence.frames.apex.probe.lit,evidence.beats.map(b=>({id:b.id,probe:evidence.frames[b.id].probe})));
  gate('scale evidence covers hunter, four ghost roles, and all twenty-four furniture silhouettes',(scaleKinds.get('standard')||new Set()).has('hunter')&&(scaleKinds.get('standard')||new Set()).has('wisp')&&
    (scaleKinds.get('standard')||new Set()).has('bellhop')&&(scaleKinds.get('boss')||new Set()).has('concierge')&&(scaleKinds.get('structure')||new Set()).size===24,Object.fromEntries([...scaleKinds].map(([k,v])=>[k,[...v]])));
  gate('drawn extents obey 20x32 actors, 24x24 structures, and 34x34 boss caps',scaleMeasurements.every(m=>m.assertion.ok),scaleMeasurements);
  gate('normal-play interactive actor footprints remain under twenty percent',Object.values(footprintSets).every(v=>v.ok),footprintSets);
  gate('every furniture reveal gives a ghost at least fifty-five percent runway',runway.length===6&&runway.every(a=>a.ok),runway);
  gate('frames remain opaque, rich, contrasted, and non-flat',cm.every(m=>m.opaqueFraction===1&&m.quantizedColors>=bands.colors&&m.colorEntropy>=bands.entropy&&m.lumaStdDev>=bands.luma&&m.largestColorShare<=bands.largest),cm.map(m=>({colors:m.quantizedColors,entropy:m.colorEntropy,luma:m.lumaStdDev,largest:m.largestColorShare})));
  gate('native detail remains reference-comparable',cm.every(m=>m.edge[1].energy>=bands.edge&&m.edge[4].energy>m.edge[1].energy)&&median(cm.map(m=>m.edge[1].energy))>=refEdge*.82,{candidate:cm.map(m=>m.edge),referenceFloor:refEdge});
  gate('spatial richness fills the full strip',cm.every(m=>m.richCellFraction>=bands.richEach)&&median(cm.map(m=>m.richCellFraction))>=Math.max(bands.richMedian,refRich*.85),{candidate:cm.map(m=>m.richCellFraction),referenceFloor:refRich});
  gate('containment forecast route paints real pixels',planRoute.probe.planPoints.length>=4&&planRoute.delta.changedFraction>=bands.routeChanged&&planRoute.delta.changedGridFraction>=bands.routeGrid,planRoute.delta);
  gate('possession and reveal materially alter real rendered pixels',possessed.probe.possession.length&&reveal.probe.ghostStates.includes('flee')&&possessionDelta.changedFraction>=bands.possessionChanged&&revealDelta.changedFraction>=bands.revealChanged,{possessionDelta,revealDelta});
  gate('permanent relight changes both rooms and the tower composition',relight.probe.lit&&relight.probe.rooms.every(Boolean)&&relightDelta.changedFraction>=bands.relightChanged,relightDelta);
  gate('lobby, suites, spa, and penthouse change physical composition',Object.values(zonePairs).every(v=>v.structureDistance>=bands.zonePair),zonePairs);
  gate('warning changes the containment route before the bellhop lands',warningRoute.probe.act==='warn'&&calmRoute.probe.act==='calm'&&warningDelta.changedFraction>=bands.warningChanged&&checkinDelta.changedFraction>=bands.checkinChanged,{warningDelta,checkinDelta,calm:calmRoute.probe.planPoints,warn:warningRoute.probe.planPoints});
  gate('hunter and ghost actors animate in clean-plate pixel evidence',hunterBurst&&ghostBurst&&hunterBurst.cleanPlate&&ghostBurst.cleanPlate&&
    hunterBurst.changedFraction.max>=bands.hunterAnim&&hunterBurst.firstLast.changedFraction>=bands.hunterTravel&&
    ghostBurst.changedFraction.max>=bands.ghostAnim&&ghostBurst.firstLast.changedFraction>=bands.ghostTravel,{hunterBurst,ghostBurst});
  gate('authored sweep presentation changes real rendered pixels',sweepPair.changedFraction>=bands.sweepAnim,sweepPair);
  gate('wing apex has physical relight staging plus sim-inert payoff paint',apexPhysical.changedFraction>=bands.apexPhysical&&apexDelta.changedFraction>=bands.apexFx&&apexBurst.changedFraction.max>=bands.apexBurst,{apexPhysical,apexDelta,apexBurst});

  const gameHash=sha256(GAME_PATH);writeJson(TEMPLATE_PATH,reviewTemplate(sheet.sha256,gameHash,evidence.beats));let review;
  if(fs.existsSync(REVIEW_PATH)){review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256,preservedPath:TRACKED_CONTACT_PATH});if(review.receipt.game!=='hotel-haunt'||review.receipt.gameSha256!==gameHash||review.receipt.seed!=='0x'+SEED.toString(16)||JSON.stringify(review.receipt.checkpoints)!==JSON.stringify(evidence.beats.map(b=>b.id+'@'+b.offset))){review.ok=false;review.errors.push('review identity, game hash, seed, or checkpoints are stale')}}
  else review={ok:false,errors:['missing semantic review '+REVIEW_PATH,'inspect '+CONTACT_PATH+' and complete '+TEMPLATE_PATH]};
  gate('fresh native-size semantic comparison receipt',review.ok,review.errors);
  const report={schema:1,game:'hotel-haunt',gameSha256:gameHash,seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,
    contactSheet:{path:CONTACT_PATH,trackedPath:TRACKED_CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(evidence.beats.map(b=>[b.id,{fixture:evidence.specs[b.id].fixture,offset:b.offset,probe:evidence.frames[b.id].probe}])),
    thresholds:{actorScale:{standard:{maxWidth:20,maxHeight:32},structure:{maxWidth:24,maxHeight:24},boss:{maxWidth:34,maxHeight:34},runway:.55,footprint:.20,extentThreshold:THRESHOLD},knownGood,bands,referenceEdge:refEdge,referenceRich:refRich},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,scale:scaleMeasurements,footprints:footprintSets,runway,planDelta:planRoute.delta,possessionDelta,revealDelta,relightDelta,warningDelta,checkinDelta,zonePairs,hunterBurst,ghostBurst,sweepPair,apexPhysical,apexDelta,apexBurst},
    gates,automatedOk:gates.slice(0,-1).every(g=>g.ok),semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}};writeJson(METRICS_PATH,report);
  console.log('HOTEL HAUNT visual evidence · seed 0x'+SEED.toString(16));for(const g of gates)console.log('  '+(g.ok?'PASS':'FAIL')+' '+g.name);
  console.log('  contact: '+CONTACT_PATH);console.log('  tracked contact: '+TRACKED_CONTACT_PATH);console.log('  montage sha256: '+sheet.sha256);console.log('  metrics: '+METRICS_PATH);console.log('  review template: '+TEMPLATE_PATH);
  if(!gates.every(g=>g.ok)){console.error('\nHOTEL HAUNT VISUAL EVAL FAILED');process.exit(1)}console.log('\nHOTEL HAUNT VISUAL EVAL PASSED');
}
main().catch(error=>{console.error('HOTEL HAUNT VISUAL EVAL FAILED:',error.stack||error);process.exit(1)});
