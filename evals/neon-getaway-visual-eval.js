#!/usr/bin/env node
'use strict';

// NEON GETAWAY real-pixel release gate. Behavioral truth lives in
// neon-getaway-eval.js; this suite stages deterministic authored visual beats,
// renders the real canvas at the native 160x360 viewer size, and measures the
// resulting RGBA. A separate hashed semantic receipt must approve what pixel
// statistics cannot judge against MACHINE HUNT and BLOCK MINE.
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
const GAME_PATH=path.join(__dirname,'..','neon-getaway.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','neon-getaway');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','neon-getaway.json');
const PRESERVED_CONTACT_PATH=path.join(__dirname,'visual-receipts','neon-getaway-contact-sheet.png');
const CLIP_PATH=path.join(ARTIFACT_DIR,'neon-getaway-30s.mp4');
const SEED=0x4e454f4e,PRE_ROLL=120,RENDER_EVERY=2;
const WORLD_CROP={x:0,y:38,width:160,height:322};
const ACTOR_THRESHOLD=8,ACTOR_PADDING=10;

if(!fs.existsSync(GAME_PATH)){
  console.error('NEON GETAWAY VISUAL EVAL FAILED: missing '+GAME_PATH);
  process.exit(1);
}

const median=values=>quantile(values,.5);
const visible=(box,crop)=>!!box&&box.x<crop.x+crop.width&&box.x+box.width>crop.x&&
  box.y<crop.y+crop.height&&box.y+box.height>crop.y;

function visualProbe(runtime){
  const visualFn=runtime.sandbox.__neonGetawayVisualProbe,fullFn=runtime.sandbox.__neonGetawayProbe;
  if(typeof visualFn!=='function'||typeof fullFn!=='function')
    throw new Error('neon-getaway.html must expose __neonGetawayVisualProbe() and __neonGetawayProbe()');
  const value=visualFn(),full=fullFn();
  if(!value||value.finite===false||!full||full.finite===false)
    throw new Error('neon-getaway visual fixture produced non-finite state');
  const decoyBoxes=runtime.evaluate("decoys.map(d=>({x:d.x-15,y:sy(d.y)-19,width:30,height:38,kind:d.kind,ghost:!!d.ghost}))");
  const policeBoxes=Array.from(value.policeBoxes||[]);
  return Object.assign({},value,{
    playerKind:full.player.kind,playerZ:full.player.z,playerSpeed:full.player.speed,
    show:full.show,actType:full.act.type,decoyBoxes:Array.from(decoyBoxes||[]),
    visiblePoliceCount:policeBoxes.filter(box=>visible(box,WORLD_CROP)).length,
    visibleDecoyCount:Array.from(decoyBoxes||[]).filter(box=>visible(box,WORLD_CROP)).length
  });
}

function captureFixture(name,offsets,options){
  options=options||{};
  const runtime=bootRenderedGame('neon-getaway',{seed:SEED});
  if(options.beforeSet)options.beforeSet(runtime);
  const setBeat=runtime.sandbox.__neonGetawaySetVisualBeat;
  if(typeof setBeat!=='function')throw new Error('neon-getaway.html must expose __neonGetawaySetVisualBeat(name)');
  if(setBeat(name)!==true)throw new Error('unknown Neon Getaway visual beat: '+name);
  if(options.selector!==undefined)runtime.sandbox.__NG_VISUAL_ONLY_SUBJECT=options.selector;
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

function fixedCrop(input,box,width,height){
  width=width||48;height=height||56;
  const source=toNativeFrame(input),cx=Math.round(box.x+box.width/2),cy=Math.round(box.y+box.height/2);
  const out=Buffer.alloc(width*height*4),left=cx-Math.floor(width/2),top=cy-Math.floor(height/2);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=left+x,sy=top+y,dst=(y*width+x)*4;
    if(sx<0||sy<0||sx>=source.width||sy>=source.height){out[dst+3]=255;continue;}
    const src=(sy*source.width+sx)*4;
    out[dst]=source.rgba[src];out[dst+1]=source.rgba[src+1];out[dst+2]=source.rgba[src+2];out[dst+3]=source.rgba[src+3];
  }
  return rgbaFrame(out,width,height,{frame:input.frame,fixture:input.fixture,offset:input.offset});
}

function analyzeAlignedBurst(frames,boxFor,width,height){
  const crops=[];
  for(const frame of frames){
    const box=boxFor(frame);
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

function allPairs(values,fn){
  const out=[];
  for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++)out.push(fn(values[i],values[j],i,j));
  return out;
}

// Drawn-pixel actor-scale gates (owner directive 2026-07-11, crystal-mesa
// pattern): the game isolates any probe actor through __NG_VISUAL_ONLY_SUBJECT
// and the caps below encode the small-actors-big-worlds directive with a
// little margin — NOT the loose 20x32 repo ceiling. Measured on the shipped
// art (2026-07-11, seed 0x4e454f4e): getaway coupe/taxi 10x18, muscle 11x18,
// bike w/ damage smoke 8x22, cruiser 11x19, interceptor 11x17, police bike
// 5x16, police van 13x21, traffic sedan 8x14 / compact 8x13 / delivery 8x17,
// pedestrian 3x9 (8x9 with alarm arms), helicopter 32x15, abandoned swap
// decoy (0.35rad pose + open door) 17x19.
function probeSubjects(probe,fixture){
  if(!Array.isArray(probe&&probe.actors))throw new Error(`${fixture}: visual probe must expose actors[]`);
  const ids=new Set();
  for(const actor of probe.actors){
    if(!actor||typeof actor.id!=='string'||!actor.id||typeof actor.kind!=='string')throw new Error(`${fixture}: malformed subject`);
    if(ids.has(actor.id))throw new Error(`${fixture}: duplicate subject ${actor.id}`);
    ids.add(actor.id);
    const box=actor.box;
    if(!box||![box.x,box.y,box.width,box.height].every(Number.isFinite)||!(box.width>0&&box.height>0))
      throw new Error(`${fixture}: invalid box for ${actor.id}`);
  }
  return probe.actors;
}
function limitsFor(actor){
  if(actor.kind==='boss')return{maxWidth:34,maxHeight:24,label:`boss ${actor.type}`};
  if(actor.kind==='heavy')return{maxWidth:16,maxHeight:24,label:`heavy vehicle ${actor.type}`};
  if(actor.kind==='decoy')return{maxWidth:20,maxHeight:24,label:`abandoned decoy ${actor.type}`};
  if(actor.kind==='ped')return{maxWidth:9,maxHeight:12,label:`pedestrian ${actor.type}`};
  return{maxWidth:14,maxHeight:24,label:`vehicle ${actor.type}`};
}
function measureSubjects(fixture,offset){
  const baseline=captureFixture(fixture,[offset],{selector:'none',id:fixture+'-none'}).get(offset);
  const actors=probeSubjects(baseline.probe,fixture),measurements=[];
  for(const actor of actors){
    const isolated=captureFixture(fixture,[offset],{selector:actor.id,id:`${fixture}-${actor.id}`}).get(offset);
    const measurement=measureDrawnActorExtent(isolated,baseline,{id:actor.id,kind:actor.kind,type:actor.type,
      probeBox:actor.box,padding:ACTOR_PADDING,threshold:ACTOR_THRESHOLD});
    const assertion=assertActorScale(measurement,limitsFor(actor));
    measurements.push(Object.assign(measurement,{assertion:{ok:assertion.ok,failures:assertion.failures,limits:assertion.limits}}));
  }
  return{fixture,offset,probe:baseline.probe,measurements};
}
function footprintOf(sample){
  const playfield=sample.probe.layout&&sample.probe.layout.playfield,area=playfield.width*playfield.height;
  const actors=sample.measurements.filter(m=>m.kind!=='ped'),sumArea=actors.reduce((n,m)=>n+m.bboxArea,0);
  return{fixture:sample.fixture,actorCount:actors.length,sumBboxArea:sumArea,
    sumFraction:+(sumArea/area).toFixed(6),ok:actors.every(m=>m.assertion.ok&&!m.clipped)&&sumArea/area<=.20};
}

// Ground-plane scroll coherence (2026-07-11): the road paint must flow
// DOWN-screen with the world as the car drives north. Render the same beat at
// two sim times, find the vertical pixel shift that best explains the road
// strip, and require it to match the car's measured world advance with a clear
// margin over every zero/upward shift. The counter-scrolled decal bug (lane
// dashes and district decals drifting toward the horizon — the "driving
// backwards" illusion fixed 2026-07-11) leaves no coherent downward shift and
// fails the margin test.
const SCROLL_CROP={x:40,y:44,width:80,height:200};
function lumaGrid(input,crop){
  const source=toNativeFrame(input),out=new Float64Array(crop.width*crop.height);
  for(let y=0;y<crop.height;y++)for(let x=0;x<crop.width;x++){
    const src=((crop.y+y)*source.width+crop.x+x)*4;
    out[y*crop.width+x]=source.rgba[src]*.299+source.rgba[src+1]*.587+source.rgba[src+2]*.114;
  }
  return out;
}
function verticalShiftScores(before,after,crop,maxShift){
  const scores=[];
  for(let dy=-maxShift;dy<=maxShift;dy++){
    let sum=0,n=0;
    for(let y=Math.max(0,dy);y<crop.height+Math.min(0,dy);y++)
      for(let x=0;x<crop.width;x++){sum+=Math.abs(after[y*crop.width+x]-before[(y-dy)*crop.width+x]);n++;}
    scores.push({dy,sad:sum/n});
  }
  return scores;
}
function scrollCoherence(beat,fromOffset,toOffset,prep){
  const runtime=bootRenderedGame('neon-getaway',{seed:SEED});
  const setBeat=runtime.sandbox.__neonGetawaySetVisualBeat;
  if(setBeat(beat)!==true)throw new Error('unknown Neon Getaway visual beat: '+beat);
  runtime.evaluate("visualIntent={steer:0,throttle:1,brake:false,handbrake:false,action:false,targetX:player.x,tactic:'THREAD THE TRAFFIC'}");
  if(prep)runtime.evaluate(prep);
  runtime.advanceTo(fromOffset,{renderEvery:RENDER_EVERY,renderLast:true});
  const y0=runtime.evaluate('player.y'),before=lumaGrid(runtime.snapshot({native:true}),SCROLL_CROP);
  runtime.advanceTo(toOffset,{renderEvery:RENDER_EVERY,renderLast:true});
  const y1=runtime.evaluate('player.y'),after=lumaGrid(runtime.snapshot({native:true}),SCROLL_CROP);
  const expected=Math.round(y1-y0),scores=verticalShiftScores(before,after,SCROLL_CROP,16);
  const best=scores.reduce((m,s)=>s.sad<m.sad?s:m);
  const counterScrollSad=Math.min(...scores.filter(s=>s.dy<=0).map(s=>s.sad));
  return{beat,expected,bestDy:best.dy,bestSad:best.sad,counterScrollSad,
    ok:expected>=4&&Math.abs(best.dy-expected)<=2&&best.sad<counterScrollSad*.8};
}

function buildCandidateEvidence(){
  const specs={
    opening:{fixture:'opening',offsets:[1,6,12,24]},
    street:{fixture:'street-chase',offsets:[1,3,5,7,9,13,24]},
    drift:{fixture:'drift',offsets:[1,6,12,18,24]},
    driftNoFx:{fixture:'drift',offsets:[18],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}},
    wreck:{fixture:'wreck',offsets:[1,8,16,24]},
    wreckNoFx:{fixture:'wreck',offsets:[8],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}},
    alley:{fixture:'alley',offsets:[1,6,12,24]},
    ramp:{fixture:'ramp',offsets:[1,6,12,24,36,48]},
    swapAnticipation:{fixture:'swap-anticipation',offsets:[1,6,12,24]},
    swapPayoff:{fixture:'swap-payoff',offsets:[1,6,12,18,24,36,47]},
    later:{fixture:'later-district',offsets:[1,6,12,24]},
    warning:{fixture:'dragnet',offsets:[1,6,12,24]},
    warningCalm:{fixture:'dragnet',offsets:[12],afterSet:runtime=>runtime.evaluate("act.phase='calm'")},
    dragnetLand:{fixture:'dragnet-land',offsets:[1,6,12,24]},
    danger:{fixture:'danger',offsets:[1,3,5,7,9,13,24]},
    apex:{fixture:'escape-apex',offsets:[1,6,12,24,48]},
    apexNoFx:{fixture:'escape-apex',offsets:[1,6,12,24,48],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}}
  };
  // No-guideline pairs (owner directive 2026-07-11): the route planner's
  // output may NEVER reach the canvas. Forcing opposite committed plans
  // (alley-left vs alley-right) before rendering must change ZERO pixels at
  // every planning beat — fixtures drive the car through visualIntent, so the
  // injected plan is simulation-inert and any pixel delta is a drawn overlay.
  const forcePlan=targetX=>runtime=>runtime.evaluate(
    `plan={targetX:${targetX},score:500,min:20,projectedY:player.y+220,route:'alley'};player.routeX=${targetX};`);
  for(const[id,fixture,offset]of[['street','street-chase',13],['alley','alley',12],['warning','dragnet',12],
    ['danger','danger',13],['apex','escape-apex',6]]){
    specs['planLeft_'+id]={fixture,offsets:[offset],afterSet:forcePlan(26)};
    specs['planRight_'+id]={fixture,offsets:[offset],afterSet:forcePlan(134)};
  }
  // Ghost decoys are police BELIEF (where the pursuit *thinks* the driver is);
  // injecting one must also change zero pixels — only physical door-open swap
  // cars may render.
  specs.ghostDecoy={fixture:'street-chase',offsets:[13],afterSet:runtime=>runtime.evaluate(
    "decoys.push({id:9001,x:109,y:player.y+40,kind:'muscle',t:900,door:0,ghost:true});")};
  const runs={};
  for(const[id,spec]of Object.entries(specs))
    runs[id]=captureFixture(spec.fixture,spec.offsets,{id,beforeSet:spec.beforeSet,afterSet:spec.afterSet});
  const beats=[
    {id:'opening',label:'opening',run:'opening',offset:12},
    {id:'street',label:'street chase',run:'street',offset:13},
    {id:'drift',label:'handbrake slide',run:'drift',offset:18},
    {id:'alley',label:'market alley',run:'alley',offset:12},
    {id:'ramp',label:'port ramp',run:'ramp',offset:12},
    {id:'swapReady',label:'swap ready',run:'swapAnticipation',offset:12},
    {id:'swap',label:'swap payoff',run:'swapPayoff',offset:12},
    {id:'later',label:'civic crown',run:'later',offset:12},
    {id:'warning',label:'dragnet warning',run:'warning',offset:12},
    {id:'land',label:'dragnet land',run:'dragnetLand',offset:12},
    {id:'danger',label:'five star',run:'danger',offset:13},
    {id:'wreck',label:'roadblock crunch',run:'wreck',offset:8},
    {id:'apex',label:'five star fade',run:'apex',offset:6}
  ];
  const frames=Object.fromEntries(beats.map(beat=>[beat.id,runs[beat.run].get(beat.offset)]));
  const all=[];
  for(const[id,frameMap]of Object.entries(runs))for(const[offset,frame]of frameMap)all.push({id,offset,frame});
  return{specs,runs,beats,frames,all};
}

function reviewTemplate(montageSha256){
  const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});
  const command=`node render/render.js neon-getaway 30 .artifacts/visual/neon-getaway/neon-getaway-30s.mp4 --seed 0x${SEED.toString(16)} --probe --fps 30`;
  return{
    schema:1,game:'neon-getaway',verdict:'pending',references:['horizon','blockmine'],montageSha256,
    reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size reference review',
    renderReceipt:{seed:'0x'+SEED.toString(16),seconds:30,fps:30,codec:'h264',dimensions:'320x720',bytes:0,sha256:'',command},
    categories:{
      characterCraft:pending('Inspect the wheelman, five getaway vehicles, police cruiser/interceptor/bike/van, traffic, pedestrians, swap driver, facing, body roll, sirens, damage, and reaction poses at 160x360.'),
      environmentCraft:pending('Inspect each district with the HUD mentally removed: road material, alleys, roofs, market awnings, canal water and bridges, port rails and crane, civic roundabout, foreground lights, traffic, and depth planes.'),
      levelVariety:pending('Confirm the five districts change spatial landmarks, road grammar, material silhouette, hazards, and composition rather than only palette and facade texture.'),
      animationImpact:pending('Confirm aligned vehicle and police crops animate, the ramp has takeoff/apex/landing, the swap stages old car to driver to new car, the dragnet warning lands physically, the handbrake slide fishtails with rubber and smoke pouring off the rear wheels, the roadblock crunch flashes the body and throws debris, and the five-star fade has visible pursuit redirection plus FX.'),
      readability:pending('Confirm intent reads from the driver alone — an HONEST heading that tracks actual travel (no permanent crab), committed fishtail slides, brake lights, swap-duck choreography, GO! launch beat, stun sparks on wrecked units — and that every good/bad beat is visibly tagged: coral/white damage flash and coral edge pulse on hits, gold glory shimmer and gold edge pulse on escapes, skid rubber aftermath that fades on the world clock. Confirm wanted escalation, visible police count, player silhouette, and apex stay legible beside video at native size with ZERO drawn guidelines, the road and every ground decal flow down-screen with travel (no counter-scroll), and the goal telemetry (escape pips, city-limits strip) reads at native size.'),
      artDirectionCohesion:pending('Confirm neon-noir palette, pixel construction, HUD, district materials, vehicle lighting, pursuit grammar, and payoff language feel like one authored city.')
    },
    guidelineOverlays:{confirmedAbsent:false,note:'Confirm every sampled beat pre-draws NOTHING about actor intent or trajectory: no route lines/dots, arrows, alley/ramp/swap target highlights, police intercept predictions, ghost phantom cars, predicted arcs, or safe-lane markers. The assembling dragnet (vans arriving, officers carrying barriers) and the warning tint are world telegraphs and stay.'}
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

  const referenceTargets=[60,600,1200,2400,3600,5400,7200,9000,10800,12600,15000,16800,18000];
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
      {label:'NEON GETAWAY',frames:candidate},
      {label:'MACHINE HUNT',frames:horizonByBeat},
      {label:'BLOCK MINE',frames:blockmineByBeat}
    ],outPath:CONTACT_PATH
  });

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

  const playerBurst=analyzeAlignedBurst([1,3,5,7,9,13,24].map(offset=>runs.street.get(offset)),
    frame=>frame.probe.playerBox,48,56);
  const policeBurst=analyzeAlignedBurst([1,3,5,7,9,13,24].map(offset=>runs.danger.get(offset)),
    frame=>frame.probe.policeBoxes&&frame.probe.policeBoxes[0],48,56);
  const swapBurst=analyzeAlignedBurst([1,6,12,18,24,36,47].map(offset=>runs.swapPayoff.get(offset)),frame=>{
    const box=frame.probe.playerBox;
    return box&&{x:box.x-26,y:box.y-14,width:box.width+52,height:box.height+28};
  },92,76);

  const districtBeats=['opening','alley','ramp','swapReady','later'];
  const districtFrames=districtBeats.map(id=>candidate[id]);
  const districtPairs=allPairs(districtFrames,(a,b,i,j)=>({
    a:candidate[districtBeats[i]].probe.district,b:candidate[districtBeats[j]].probe.district,
    structure:structureDistance(a,b,{crop:WORLD_CROP})
  }));
  const warningContrast=frameDifference(runs.warningCalm.get(12),runs.warning.get(12),{native:false,crop:WORLD_CROP});
  const warningLand=frameDifference(runs.warning.get(12),runs.dragnetLand.get(12),{native:false,crop:WORLD_CROP});
  const rampBurst=analyzeBurst([1,6,12,24,36,48].map(offset=>runs.ramp.get(offset)),{native:false,crop:WORLD_CROP});
  const apexFx=frameDifference(runs.apexNoFx.get(12),runs.apex.get(12),{native:false,crop:WORLD_CROP,threshold:1});
  const playerBox=runs.apex.get(12).probe.playerBox;
  const apexCrop={
    x:Math.max(0,playerBox.x-36),y:Math.max(WORLD_CROP.y,playerBox.y-34),
    width:Math.min(160,playerBox.x+playerBox.width+36)-Math.max(0,playerBox.x-36),
    height:Math.min(360,playerBox.y+playerBox.height+34)-Math.max(WORLD_CROP.y,playerBox.y-34)
  };
  const apexFxNear=frameDifference(runs.apexNoFx.get(12),runs.apex.get(12),{native:false,crop:apexCrop,threshold:1});
  const apexPhysical=frameDifference(runs.danger.get(13),runs.apexNoFx.get(12),{native:false,crop:WORLD_CROP});
  const apexStructure=structureDistance(runs.danger.get(13),runs.apexNoFx.get(12),{crop:WORLD_CROP});
  const apexBurst=analyzeBurst([1,6,12,24,48].map(offset=>runs.apex.get(offset)),{native:false,crop:WORLD_CROP});

  // Good/bad feedback beats (owner directive 2026-07-12). Both compare the
  // live frame against a same-sim __NO_PAYOFF_FX twin, so every measured
  // pixel is feedback presentation by construction: the slide's rubber/smoke
  // trail behind the car, and the crunch's body flash + debris around it.
  const trailCropOf=frame=>{const box=frame.probe.playerBox;return{
    x:Math.max(0,box.x-26),y:Math.max(WORLD_CROP.y,box.y-12),
    width:Math.min(160,box.x+box.width+26)-Math.max(0,box.x-26),
    height:Math.min(360,box.y+box.height+52)-Math.max(WORLD_CROP.y,box.y-12)};};
  const driftFx=frameDifference(runs.driftNoFx.get(18),runs.drift.get(18),
    {native:false,crop:trailCropOf(runs.drift.get(18)),threshold:1});
  const wreckFx=frameDifference(runs.wreckNoFx.get(8),runs.wreck.get(8),
    {native:false,crop:trailCropOf(runs.wreck.get(8)),threshold:1});
  const driftBurst=analyzeBurst([1,6,12,18,24].map(offset=>runs.drift.get(offset)),{native:false,crop:WORLD_CROP});

  // Two districts cover both scroll paths: drawRoadBase/neon decals (opening)
  // and the cross-anchored civic decals (later). The helicopter is parked for
  // the later check so its static spotlight cannot bias the shift search.
  const scrollChecks=[
    scrollCoherence('opening',8,14),
    scrollCoherence('later-district',8,14,"heat=2.4;wanted=3;heli.active=false;heli.spot=0;")
  ];

  // Zero-guideline receipts (full native frames, HUD included).
  const planPairs=[['street',13],['alley',12],['warning',12],['danger',13],['apex',6]].map(([id,offset])=>({
    beat:id,offset,difference:frameDifference(runs['planLeft_'+id].get(offset),runs['planRight_'+id].get(offset),{native:false})}));
  const ghostDelta=frameDifference(runs.ghostDecoy.get(13),runs.street.get(13),{native:false});
  const gameSource=fs.readFileSync(GAME_PATH,'utf8');
  const bannedOverlaySources=['drawRoute','routeDot','setLineDash','predictIntercept','act.safeX+(i-1)',
    'if(d.ghost)ctx.globalAlpha'].filter(token=>gameSource.includes(token));

  // Locked-candidate calibration, seed 0x4e454f4e; re-measured 2026-07-11
  // after the actor-scale redraw (vehicles now 10-13px wide constructed
  // bodies instead of 16-18px slabs; walkers ~5x10; heli airframe 31px) and
  // the road-furniture pass (lane cats-eyes, manholes + steam, storefront
  // glow spill, crosswalk wear). Across the eleven approved fixture cells:
  // colors 131..244, entropy 3.464..3.979, luma deviation .1117...1686,
  // largest-color max .340, one-pixel edge energy .0230...0432, rich cells
  // .978..1.0 (the furniture pass RAISED richness as the actors shrank).
  // Aligned bursts on the smaller sprites: player median .217 / firstLast
  // .315 / grid .956; police median .227 / .497 / .911; swap median .0709 /
  // max .0914 / firstLast .206 / grid .667. Floors keep ~12-20% margin under
  // these fresh measurements.
  const bands={
    colors:115,entropy:3.10,lumaStdDev:.10,largestColorShare:.38,
    edgeEnergy:.0205,richEach:.90,richMedian:.95,
    playerMedian:.18,playerFirstLast:.27,playerGrid:.80,
    policeMedian:.19,policeFirstLast:.42,policeGrid:.77,
    swapMedian:.06,swapMax:.078,swapFirstLast:.17,swapGrid:.55,
    districtMedian:.35,districtEach:.28,
    warningChanged:.85,warningMean:.075,warningGrid:.90,warningBounds:.90,
    landChanged:.85,landMean:.08,landGrid:.90,landBounds:.90,
    apexPhysicalChanged:.65,apexPhysicalStructure:.34,
    apexFxChanged:.0022,apexFxMean:.0008,apexFxBounds:.030,
    apexNearChanged:.011,apexNearMean:.0042,apexNearGrid:.11,apexNearBounds:.15,
    // Feedback beats measured 2026-07-12 on the shipped FX (drift trail crop
    // .0200 changed / .0032 mean; wreck crop .0226 / .0077); floors keep
    // ~30% margin so deleted rubber, smoke, flash, or debris fail loudly.
    driftFxChanged:.014,driftFxMean:.0022,wreckFxChanged:.015,wreckFxMean:.005
  };

  const automatedGates=[];
  const gate=(name,ok,detail)=>automatedGates.push({name,ok:!!ok,detail});
  gate('same-seed real pixels deterministic',deterministic,determinism);
  gate('all requested fixtures are finite and truthful',beats.every(beat=>candidate[beat.id].probe&&candidate[beat.id].probe.finite!==false),
    beats.map(beat=>({beat:beat.id,probe:candidate[beat.id].probe})));
  gate('frames are opaque and non-flat',cm.every(value=>value.opaqueFraction===1&&value.quantizedColors>=bands.colors&&
    value.colorEntropy>=bands.entropy&&value.lumaStdDev>=bands.lumaStdDev&&value.largestColorShare<=bands.largestColorShare),
    cm.map(value=>({colors:value.quantizedColors,entropy:value.colorEntropy,lumaStdDev:value.lumaStdDev,largest:value.largestColorShare})));
  gate('multiscale edge detail holds its measured floor',cm.every(value=>value.edge[1].energy>=bands.edgeEnergy&&value.edge[4].energy>value.edge[1].energy),
    cm.map(value=>value.edge));
  gate('spatial richness holds its measured floor',cm.every(value=>value.richCellFraction>=bands.richEach)&&
    median(cm.map(value=>value.richCellFraction))>=bands.richMedian,
    {values:cm.map(value=>value.richCellFraction),median:median(cm.map(value=>value.richCellFraction))});
  gate('wheelman vehicle has aligned temporal animation',!!playerBurst&&playerBurst.changedFraction.median>=bands.playerMedian&&
    playerBurst.firstLast.changedFraction>=bands.playerFirstLast&&playerBurst.firstLast.changedGridFraction>=bands.playerGrid&&
    playerBurst.changedFraction.max<=.65,playerBurst);
  gate('police vehicle has aligned pursuit and siren animation',!!policeBurst&&policeBurst.changedFraction.median>=bands.policeMedian&&
    policeBurst.firstLast.changedFraction>=bands.policeFirstLast&&policeBurst.firstLast.changedGridFraction>=bands.policeGrid&&
    policeBurst.changedFraction.max<=.80,policeBurst);
  const swapFirst=runs.swapPayoff.get(1).probe,swapLast=runs.swapPayoff.get(47).probe;
  gate('vehicle swap has aligned old-car driver new-car choreography',!!swapBurst&&swapBurst.changedFraction.median>=bands.swapMedian&&
    swapBurst.changedFraction.max>=bands.swapMax&&swapBurst.firstLast.changedFraction>=bands.swapFirstLast&&
    swapBurst.firstLast.changedGridFraction>=bands.swapGrid&&swapFirst.playerKind==='coupe'&&swapLast.playerKind==='taxi'&&
    swapFirst.escapeSerial===0&&swapLast.escapeSerial===0,{swapBurst,first:swapFirst,last:swapLast});
  gate('five districts change structure, not only palette',new Set(districtBeats.map(id=>candidate[id].probe.district)).size===5&&
    median(districtPairs.map(pair=>pair.structure.structureDistance))>=bands.districtMedian&&
    districtPairs.every(pair=>pair.structure.structureDistance>=bands.districtEach),districtPairs);
  const ramp1=runs.ramp.get(1).probe,ramp12=runs.ramp.get(12).probe,ramp24=runs.ramp.get(24).probe,ramp48=runs.ramp.get(48).probe;
  gate('ramp checkpoint is a truthful takeoff apex landing arc',ramp1.airborne&&ramp12.airborne&&ramp24.airborne&&
    ramp12.playerZ>=16&&!ramp48.airborne&&ramp48.playerZ===0&&ramp12.tactic==='HIT THE RAMP'&&visible(ramp12.rampBox,WORLD_CROP)&&
    rampBurst.changedFraction.max>=.25,{ramp1,ramp12,ramp24,ramp48,rampBurst});
  gate('dragnet warning is visibly distinct from identical calm state',warningContrast.changedFraction>=bands.warningChanged&&
    warningContrast.meanDelta>=bands.warningMean&&warningContrast.changedGridFraction>=bands.warningGrid&&
    warningContrast.changedBoundsFraction>=bands.warningBounds&&visible(runs.warning.get(12).probe.roadblockBox,WORLD_CROP),warningContrast);
  const landProbe=runs.dragnetLand.get(12).probe;
  gate('dragnet land is a physical formation, not only a tint',warningLand.changedFraction>=bands.landChanged&&
    warningLand.meanDelta>=bands.landMean&&warningLand.changedGridFraction>=bands.landGrid&&
    warningLand.changedBoundsFraction>=bands.landBounds&&landProbe.act==='live'&&landProbe.visiblePoliceCount>=3&&
    visible(landProbe.roadblockBox,WORLD_CROP),{warningLand,probe:landProbe});
  gate('wanted escalation is visible on the native strip',candidate.opening.probe.visiblePoliceCount===1&&
    candidate.street.probe.visiblePoliceCount>=3&&candidate.danger.probe.visiblePoliceCount>=4,
    {opening:candidate.opening.probe.policeBoxes,street:candidate.street.probe.policeBoxes,danger:candidate.danger.probe.policeBoxes});
  const apexProbe=runs.apex.get(12).probe;
  gate('five-star fade has physical actors beyond payoff FX',apexPhysical.changedFraction>=bands.apexPhysicalChanged&&
    apexStructure.structureDistance>=bands.apexPhysicalStructure&&apexProbe.escapeSerial===1&&apexProbe.wanted===1&&
    apexProbe.visiblePoliceCount>=3&&apexProbe.visibleDecoyCount>=1&&apexProbe.show&&apexProbe.show.active&&
    apexProbe.show.active.tier===3,{apexPhysical,apexStructure,probe:apexProbe});
  gate('no guideline overlays: opposite forced route plans render identically at every planning beat',
    planPairs.every(value=>value.difference.changedFraction===0&&value.difference.meanDelta===0),planPairs);
  gate('no guideline overlays: police-belief ghost decoys draw zero pixels',
    ghostDelta.changedFraction===0&&ghostDelta.meanDelta===0,ghostDelta);
  gate('no guideline overlays: banned overlay primitives are absent from the game source',
    bannedOverlaySources.length===0,{banned:bannedOverlaySources});
  gate('ground plane scrolls with travel, never against it',scrollChecks.every(value=>value.ok),scrollChecks);
  gate('five-star payoff FX land on the physical escape actors',apexFx.changedFraction>=bands.apexFxChanged&&
    apexFx.meanDelta>=bands.apexFxMean&&apexFx.changedBoundsFraction>=bands.apexFxBounds&&
    apexFxNear.changedFraction>=bands.apexNearChanged&&apexFxNear.meanDelta>=bands.apexNearMean&&
    apexFxNear.changedGridFraction>=bands.apexNearGrid&&apexFxNear.changedBoundsFraction>=bands.apexNearBounds,
    {apexFx,apexFxNear,apexCrop,apexBurst});
  const driftPose=runs.drift.get(18).probe.pose,driftFb=runs.drift.get(18).probe.feedback;
  gate('committed handbrake slide reads on the actor: fishtail past travel, rubber and smoke aftermath',
    driftPose.slideT>=20&&Math.abs(driftPose.slip)>=.15&&Math.abs(driftPose.angle)>=.35&&
    Math.sign(driftPose.angle)===Math.sign(driftPose.vx)&&driftFb.skids>=16&&
    driftFx.changedFraction>=bands.driftFxChanged&&driftFx.meanDelta>=bands.driftFxMean&&
    driftBurst.changedFraction.max>=.10,
    {driftPose,driftFb,driftFx,driftBurst});
  const wreck1=runs.wreck.get(1).probe,wreck8=runs.wreck.get(8).probe,wreck16=runs.wreck.get(16).probe;
  gate('roadblock crunch is felt: body flash, debris, scrubbed speed, bad pulse',
    wreck1.feedback.damage===0&&wreck1.feedback.hitFlashT===0&&
    wreck8.feedback.damage>=28&&wreck8.feedback.hitFlashT>0&&wreck8.feedback.badPulse>=.5&&
    wreck8.feedback.speed<wreck1.feedback.speed*.6&&wreck16.feedback.badPulse>0&&
    wreckFx.changedFraction>=bands.wreckFxChanged&&wreckFx.meanDelta>=bands.wreckFxMean,
    {wreck1:wreck1.feedback,wreck8:wreck8.feedback,wreck16:wreck16.feedback,wreckFx});
  const streetPose=runs.street.get(13).probe.pose;
  gate('normal driving carries no phantom crab: heading tracks travel outside slides',
    Math.abs(streetPose.slip)<=.10&&(Math.abs(streetPose.vx)<.12||Math.sign(streetPose.angle)===Math.sign(streetPose.vx)),
    {streetPose});
  gate('candidate numeric richness meets both reference medians',median(cm.map(value=>value.edge[1].energy))>=ref.edge*.95&&
    median(cm.map(value=>value.richCellFraction))>=ref.rich*.95&&median(cm.map(value=>value.colorEntropy))>=ref.entropy*.95&&
    median(cm.map(value=>value.lumaStdDev))>=ref.luma*.90,
    {candidate:{edge:median(cm.map(value=>value.edge[1].energy)),rich:median(cm.map(value=>value.richCellFraction)),
      entropy:median(cm.map(value=>value.colorEntropy)),luma:median(cm.map(value=>value.lumaStdDev))},reference:ref});

  // Drawn-pixel actor scale, measured across five beats that span districts,
  // pursuit escalation, the swap decoy, the damaged bike, and the helicopter.
  const scaleSamples={};
  for(const[fixture,offset]of[['street-chase',13],['danger',13],['later-district',12],['escape-apex',6],['opening',12]])
    scaleSamples[fixture]=measureSubjects(fixture,offset);
  const allMeasurements=Object.values(scaleSamples).flatMap(sample=>sample.measurements);
  gate('drawn actors obey the small-actors-big-worlds caps',
    allMeasurements.length>=40&&allMeasurements.every(m=>m.assertion.ok&&!m.clipped&&!(m.probeOverflow&&m.probeOverflow.any)),
    Object.fromEntries(Object.entries(scaleSamples).map(([key,sample])=>[key,
      sample.measurements.map(m=>({id:m.id,kind:m.kind,type:m.type,w:m.width,h:m.height,failures:m.assertion.failures}))])));
  const casts=Object.entries(scaleSamples).map(([key,sample])=>({fixture:key,
    peds:sample.measurements.filter(m=>m.kind==='ped').length,
    vehicles:sample.measurements.filter(m=>m.kind!=='ped'&&m.id!=='driver'&&m.id!=='heli').length}));
  gate('shrunken actors did not empty the strip: walkers and vehicles stay dense',
    casts.every(value=>value.peds>=6&&value.vehicles>=2),casts);
  const footprints=['opening','street-chase','later-district'].map(fixture=>footprintOf(scaleSamples[fixture]));
  gate('normal-play actor footprint stays under 20% of the playfield',footprints.every(value=>value.ok),footprints);
  const approach=scaleSamples['street-chase'].probe.layout&&scaleSamples['street-chase'].probe.layout.approach;
  const approachRatio=approach?approach.visible/approach.travel:0;
  gate('threats get at least 55% of the travel axis before contact',
    !!approach&&approach.travel>=300&&approachRatio>=.55,{approach,approachRatio:+approachRatio.toFixed(4)});

  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256));
  let review;
  if(fs.existsSync(REVIEW_PATH))review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256,preservedPath:PRESERVED_CONTACT_PATH});
  else review={ok:false,errors:[`missing committed semantic review: ${REVIEW_PATH}`,`inspect ${CONTACT_PATH}, then copy and complete ${REVIEW_TEMPLATE_PATH}`]};
  // Motion-contract 2c: the receipt must explicitly confirm zero guideline
  // overlays at every sampled beat, in addition to the six category grades.
  if(review.ok&&!(review.receipt&&review.receipt.guidelineOverlays&&review.receipt.guidelineOverlays.confirmedAbsent===true)){
    review.ok=false;review.errors=[...(review.errors||[]),'receipt must confirm guidelineOverlays.confirmedAbsent=true with a review note'];
  }
  const semanticGate={name:'fresh semantic comparison receipt',ok:review.ok,detail:review.errors};
  // The receipt must carry a real rendered-clip record (crystal-mesa
  // convention): exact command, non-trivial bytes, and a sha the reviewer can
  // reproduce; a local clip, when present, must match those bytes.
  const expectedReview=reviewTemplate(sheet.sha256),reviewClip=review.receipt&&review.receipt.renderReceipt;
  const localClip=fs.existsSync(CLIP_PATH)?{path:CLIP_PATH,bytes:fs.statSync(CLIP_PATH).size,sha256:sha256(CLIP_PATH)}:null;
  const clipGates=[
    {name:'rendered autoplay clip receipt is complete',ok:!!reviewClip&&reviewClip.bytes>100000&&
      /^[a-f0-9]{64}$/.test(reviewClip.sha256||'')&&reviewClip.seed===`0x${SEED.toString(16)}`&&
      reviewClip.command===expectedReview.renderReceipt.command,detail:reviewClip},
    {name:'local rendered clip matches receipt when available',ok:!localClip||!!reviewClip&&
      localClip.bytes===reviewClip.bytes&&localClip.sha256===reviewClip.sha256,detail:{localClip,reviewClip}}
  ];
  const gates=[...automatedGates,semanticGate,...clipGates],automatedOk=automatedGates.every(value=>value.ok);
  const gameSha256=sha256(GAME_PATH);
  const report={
    schema:1,game:'neon-getaway',gameSha256,seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,
    contactSheet:{path:CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{fixture:beat.run,offset:beat.offset,probe:candidate[beat.id].probe}])),
    thresholds:{referenceMedians:ref,bands,actorScale:{vehicle:{maxWidth:14,maxHeight:24},heavy:{maxWidth:16,maxHeight:24},
      decoy:{maxWidth:20,maxHeight:24},ped:{maxWidth:9,maxHeight:12},boss:{maxWidth:34,maxHeight:24},
      footprint:.20,approach:.55,threshold:ACTOR_THRESHOLD}},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,
      playerBurst,policeBurst,swapBurst,districtPairs,rampBurst,warningContrast,warningLand,
      apexPhysical,apexStructure,apexFx,apexFxNear,apexBurst,driftFx,wreckFx,driftBurst,scrollChecks,
      actorScale:Object.fromEntries(Object.entries(scaleSamples).map(([key,sample])=>[key,
        sample.measurements.map(m=>({id:m.id,kind:m.kind,type:m.type,bounds:m.bounds,drawnPixels:m.drawnPixels,
          clipped:m.clipped,probeOverflow:m.probeOverflow,failures:m.assertion.failures}))])),
      footprints,approach:{probe:approach,ratio:approachRatio},clip:localClip},
    guidelines:{planPairs,ghostDelta,bannedTokens:['drawRoute','routeDot','setLineDash','predictIntercept',
      'act.safeX+(i-1)','if(d.ghost)ctx.globalAlpha'],bannedHits:bannedOverlaySources},
    gates,automatedOk,semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
  };
  writeJson(METRICS_PATH,report);

  console.log(`NEON GETAWAY visual evidence · seed 0x${SEED.toString(16)} · game ${gameSha256.slice(0,12)}`);
  for(const value of automatedGates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log(`  ${review.ok?'PASS':'PENDING'} ${semanticGate.name}`);
  for(const value of clipGates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log('  contact:',CONTACT_PATH);
  console.log('  montage sha256:',sheet.sha256);
  console.log('  metrics:',METRICS_PATH);
  console.log('  review template:',REVIEW_TEMPLATE_PATH);
  if(!automatedOk){console.error('\nNEON GETAWAY AUTOMATED VISUAL GATES FAILED');process.exit(1);}
  if(!review.ok){console.error('\nNEON GETAWAY AUTOMATED VISUAL GATES PASSED; SEMANTIC REVIEW PENDING');process.exit(1);}
  if(!clipGates.every(value=>value.ok)){console.error('\nNEON GETAWAY RENDERED CLIP RECEIPT INCOMPLETE');process.exit(1);}
  console.log('\nNEON GETAWAY VISUAL EVAL PASSED');
}

main().catch(error=>{console.error('NEON GETAWAY VISUAL EVAL FAILED:',error.stack||error);process.exit(1);});
