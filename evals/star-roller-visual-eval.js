#!/usr/bin/env node
'use strict';

// STAR ROLLER real-pixel release gate. Behavioral truth lives in
// star-roller-eval.js; this suite stages deterministic authored visual beats,
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
const GAME_PATH=path.join(__dirname,'..','star-roller.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','star-roller');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','star-roller.json');
const PRESERVED_CONTACT_PATH=path.join(__dirname,'visual-receipts','star-roller-contact-sheet.png');
const CLIP_PATH=path.join(ARTIFACT_DIR,'star-roller-30s.mp4');
const SEED=0x57a00001,PRE_ROLL=120,RENDER_EVERY=2;
const WORLD_CROP={x:0,y:38,width:160,height:322};
const ACTOR_THRESHOLD=8,ACTOR_PADDING=10;

if(!fs.existsSync(GAME_PATH)){
  console.error('STAR ROLLER VISUAL EVAL FAILED: missing '+GAME_PATH);
  process.exit(1);
}

const median=values=>quantile(values,.5);
const visible=(box,crop)=>!!box&&box.x<crop.x+crop.width&&box.x+box.width>crop.x&&
  box.y<crop.y+crop.height&&box.y+box.height>crop.y;

function visualProbe(runtime){
  const visualFn=runtime.sandbox.__starRollerVisualProbe,fullFn=runtime.sandbox.__starRollerProbe;
  if(typeof visualFn!=='function'||typeof fullFn!=='function')
    throw new Error('star-roller.html must expose __starRollerVisualProbe() and __starRollerProbe()');
  const value=visualFn(),full=fullFn();
  if(!value||value.finite===false||!full||full.finite===false)
    throw new Error('star-roller visual fixture produced non-finite state');
  const sweeperBoxes=Array.from(value.sweeperBoxes||[]);
  return Object.assign({},value,{
    d:full.d,show:full.show,actType:full.act.type,outcome:full.outcome,
    visibleSweeperCount:sweeperBoxes.filter(box=>visible(box,WORLD_CROP)).length
  });
}

function captureFixture(name,offsets,options){
  options=options||{};
  const runtime=bootRenderedGame('star-roller',{seed:SEED});
  if(options.beforeSet)options.beforeSet(runtime);
  const setBeat=runtime.sandbox.__starRollerSetVisualBeat;
  if(typeof setBeat!=='function')throw new Error('star-roller.html must expose __starRollerSetVisualBeat(name)');
  if(setBeat(name)!==true)throw new Error('unknown Star Roller visual beat: '+name);
  if(options.selector!==undefined)runtime.sandbox.__SR_VISUAL_ONLY_SUBJECT=options.selector;
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

// Furniture-quiet gate (owner directive 2026-07-16, recurring problem): the
// floor and the zone edges are the STAGE, not the show. Speckle density counts
// pixels that fight BOTH horizontal neighbours in luma — isolated one-pixel
// marks — inside actor-free crops of the corridor floor and the two side
// bands. Ceilings are calibrated below from the shipped build and must fail a
// deliberately busier build at ~2x (measured offline, recorded in the comment).
const QUIET_FLOOR_CROP={x:14,y:60,width:132,height:230};
const QUIET_SIDE_CROPS=[{x:0,y:60,width:11,height:230},{x:149,y:60,width:11,height:230}];
function speckleDensity(input,crop){
  const src=toNativeFrame(input);let n=0,total=0;
  for(let y=crop.y;y<crop.y+crop.height;y++)for(let x=crop.x+1;x<crop.x+crop.width-1;x++){
    const i=(y*src.width+x)*4,l=src.rgba[i]*.299+src.rgba[i+1]*.587+src.rgba[i+2]*.114;
    const j=(y*src.width+x-1)*4,l1=src.rgba[j]*.299+src.rgba[j+1]*.587+src.rgba[j+2]*.114;
    const k=(y*src.width+x+1)*4,l2=src.rgba[k]*.299+src.rgba[k+1]*.587+src.rgba[k+2]*.114;
    if(Math.abs(l-l1)>42&&Math.abs(l-l2)>42)n++;
    total++;
  }
  return n/total;
}
const QUIET_FLOOR_MAX=.016,QUIET_SIDES_MAX=.045;

// Drawn-pixel actor-scale gates (small-actors-big-worlds law): the game
// isolates any probe actor through __SR_VISUAL_ONLY_SUBJECT and the caps below
// encode the directive with a little margin, locked with the band calibration
// comment below from measurements on the shipped art.
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
  if(actor.kind==='player')return{maxWidth:48,maxHeight:48,label:`katamari ${actor.type}`};
  if(actor.kind==='sweeper')return{maxWidth:30,maxHeight:26,label:`sweeper ${actor.type}`};
  if(actor.kind==='pet')return{maxWidth:36,maxHeight:30,label:`pet ${actor.type}`};
  return{maxWidth:48,maxHeight:50,label:`vehicle ${actor.type}`};
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
  const actors=sample.measurements,sumArea=actors.reduce((n,m)=>n+m.bboxArea,0);
  return{fixture:sample.fixture,actorCount:actors.length,sumBboxArea:sumArea,
    sumFraction:+(sumArea/area).toFixed(6),ok:actors.every(m=>m.assertion.ok&&!m.clipped)&&sumArea/area<=.20};
}

// Ground-plane scroll coherence: the floor must flow DOWN-screen with the
// world as the katamari rolls north. Render the same beat at two sim times,
// find the vertical pixel shift that best explains the floor strip, and
// require it to match the ball's measured world advance with a clear margin
// over every zero/upward shift.
const SCROLL_CROP={x:20,y:44,width:120,height:200};
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
  const runtime=bootRenderedGame('star-roller',{seed:SEED});
  const setBeat=runtime.sandbox.__starRollerSetVisualBeat;
  if(setBeat(beat)!==true)throw new Error('unknown Star Roller visual beat: '+beat);
  runtime.evaluate("visualIntent={steer:0,throttle:1,brake:false,tuck:false,dash:false,targetX:ball.x,tactic:'ROLL OUT'}");
  if(prep)runtime.evaluate(prep);
  runtime.advanceTo(fromOffset,{renderEvery:RENDER_EVERY,renderLast:true});
  const y0=runtime.evaluate('ball.y'),before=lumaGrid(runtime.snapshot({native:true}),SCROLL_CROP);
  runtime.advanceTo(toOffset,{renderEvery:RENDER_EVERY,renderLast:true});
  const y1=runtime.evaluate('ball.y'),after=lumaGrid(runtime.snapshot({native:true}),SCROLL_CROP);
  const expected=Math.round(y1-y0),scores=verticalShiftScores(before,after,SCROLL_CROP,16);
  const best=scores.reduce((m,s)=>s.sad<m.sad?s:m);
  const counterScrollSad=Math.min(...scores.filter(s=>s.dy<=0).map(s=>s.sad));
  return{beat,expected,bestDy:best.dy,bestSad:best.sad,counterScrollSad,
    ok:expected>=4&&Math.abs(best.dy-expected)<=2&&best.sad<counterScrollSad*.8};
}

function buildCandidateEvidence(){
  const specs={
    opening:{fixture:'opening',offsets:[1,6,12,24]},
    feast:{fixture:'first-feast',offsets:[1,4,8,12,24]},
    milestone:{fixture:'toy-milestone',offsets:[1,4,8,12,24]},
    milestoneNoFx:{fixture:'toy-milestone',offsets:[8],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}},
    pets:{fixture:'garden-pets',offsets:[1,6,12,24]},
    bump:{fixture:'bump',offsets:[1,4,8,12,24]},
    bumpNoFx:{fixture:'bump',offsets:[8],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}},
    magnetWarn:{fixture:'magnet-warn',offsets:[1,6,12,24]},
    magnetWarnCalm:{fixture:'magnet-warn',offsets:[12],afterSet:runtime=>runtime.evaluate("act.phase='calm'")},
    magnetLand:{fixture:'magnet-land',offsets:[1,6,12,24]},
    kingWarn:{fixture:'king-warn',offsets:[1,6,12,24]},
    kingLive:{fixture:'king-live',offsets:[1,6,12,24]},
    street:{fixture:'street',offsets:[1,6,12,24]},
    harbor:{fixture:'harbor',offsets:[1,6,12,24]},
    sweeper:{fixture:'sweeper-chase',offsets:[1,4,8,12,24]},
    orbit:{fixture:'orbit',offsets:[1,6,12,24]},
    finale:{fixture:'star-finale',offsets:[1,6,12,24,48]},
    finaleNoFx:{fixture:'star-finale',offsets:[12],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}}
  };
  // No-guideline pairs: the route planner's output may NEVER reach the canvas.
  // Forcing opposite committed plans before rendering must change ZERO pixels
  // at every planning beat — fixtures drive the ball through visualIntent, so
  // the injected plan is simulation-inert and any pixel delta is a drawn overlay.
  const forcePlan=targetX=>runtime=>runtime.evaluate(
    `plan={targetX:${targetX},score:500,gain:100,risk:0,minClear:20,reactive:false};`);
  for(const[id,fixture,offset]of[['feast','first-feast',12],['bump','bump',12],
    ['magnetWarn','magnet-warn',12],['sweeper','sweeper-chase',12],['orbit','orbit',12]]){
    specs['planLeft_'+id]={fixture,offsets:[offset],afterSet:forcePlan(24)};
    specs['planRight_'+id]={fixture,offsets:[offset],afterSet:forcePlan(136)};
  }
  const runs={};
  for(const[id,spec]of Object.entries(specs))
    runs[id]=captureFixture(spec.fixture,spec.offsets,{id,beforeSet:spec.beforeSet,afterSet:spec.afterSet});
  const beats=[
    {id:'opening',label:'opening',run:'opening',offset:12},
    {id:'feast',label:'first feast',run:'feast',offset:12},
    {id:'milestone',label:'toy class',run:'milestone',offset:8},
    {id:'pets',label:'garden pets',run:'pets',offset:12},
    {id:'bump',label:'the bump',run:'bump',offset:8},
    {id:'magnetWarn',label:'magnet warn',run:'magnetWarn',offset:12},
    {id:'magnetLand',label:'magnet land',run:'magnetLand',offset:12},
    {id:'kingWarn',label:'king descends',run:'kingWarn',offset:12},
    {id:'kingLive',label:'king watches',run:'kingLive',offset:12},
    {id:'street',label:'main street',run:'street',offset:12},
    {id:'harbor',label:'harbor',run:'harbor',offset:12},
    {id:'sweeper',label:'sweeper windup',run:'sweeper',offset:8},
    {id:'orbit',label:'orbit tide',run:'orbit',offset:12},
    {id:'finale',label:'a star is born',run:'finale',offset:12}
  ];
  const frames=Object.fromEntries(beats.map(beat=>[beat.id,runs[beat.run].get(beat.offset)]));
  const all=[];
  for(const[id,frameMap]of Object.entries(runs))for(const[offset,frame]of frameMap)all.push({id,offset,frame});
  return{specs,runs,beats,frames:frames,all};
}

function reviewTemplate(montageSha256){
  const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});
  const command=`node render/render.js star-roller 30 .artifacts/visual/star-roller/star-roller-30s.mp4 --seed 0x${SEED.toString(16)} --probe --fps 30`;
  return{
    schema:1,game:'star-roller',verdict:'pending',references:['horizon','blockmine'],montageSha256,
    reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size reference review',
    renderReceipt:{seed:'0x'+SEED.toString(16),seconds:30,fps:30,codec:'h264',dimensions:'320x720',bytes:0,sha256:'',command},
    categories:{
      characterCraft:pending('Inspect the katamari (class-colored core, stuck-item knobs that sell the spin, honest tilt), the Royal Sweeper (patrol/chase/windup-flare/lunge/stunned grammar), the pets (snail, beetle, frog, mouse, crab, gull, cat, pigeon, mote), the vehicles, and the descending King at 160x360.'),
      environmentCraft:pending('Inspect each zone with the HUD mentally removed: kitchen checker tiles and counters, garden mow stripes and soil beds, main street asphalt and parked silhouettes, harbor planks and open water, orbit starfield and planet arcs, shelves, foreground props, haze bands.'),
      levelVariety:pending('Confirm the five zones change spatial landmarks, floor grammar, material silhouette, item tables, and composition rather than only palette.'),
      animationImpact:pending('Confirm aligned katamari and sweeper bursts animate, the ball spins and tilts with travel, pickups stick and grow it, the bump wobbles and scatters pieces, the magnet shower falls and lands, the sweeper windup telegraphs, the finale starburst lands.'),
      readability:pending('Confirm intent reads from the world alone — relative item sizes, shelf gaps and hazard trim, the sweeper spin-up, the portal and the King are physical telegraphs — and that every good/bad beat is visibly tagged: gold/mint pickups, streaks, milestones, threads; coral bumps, sweeps, shelf hits. Confirm size, class pips, time and score stay legible beside video at native size with ZERO drawn guidelines, and the floor flows down-screen with travel.'),
      artDirectionCohesion:pending('Confirm warm kitchen, green garden, night street, teal harbor, and indigo orbit stay one authored world under one HUD, one payoff language, and one royal fiction.')
    },
    guidelineOverlays:{confirmedAbsent:false,note:'Confirm every sampled beat pre-draws NOTHING about actor intent or trajectory: no route lines/dots, arrows, target highlights, pickup halos, predicted arcs, or safe-lane markers. The shelf gap trim, the portal, the King, and the sweeper windup are world telegraphs and stay.'}
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

  const referenceTargets=[60,600,1200,2400,3600,5400,7200,9000,10800,12600,15000,16800,18000,19800];
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
      {label:'STAR ROLLER',frames:candidate},
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

  const playerBurst=analyzeAlignedBurst([1,4,8,12,24].map(offset=>runs.feast.get(offset)),
    frame=>frame.probe.playerBox,48,56);
  const sweeperBurst=analyzeAlignedBurst([1,4,8,12,24].map(offset=>runs.sweeper.get(offset)),
    frame=>(frame.probe.sweeperBoxes||[])[0],48,56);
  const finaleBurst=analyzeBurst([1,6,12,24,48].map(offset=>runs.finale.get(offset)),{native:false,crop:WORLD_CROP});

  const zoneBeats=['opening','pets','street','harbor','orbit'];
  const zoneFrames=zoneBeats.map(id=>candidate[id]);
  const zonePairs=allPairs(zoneFrames,(a,b,i,j)=>({
    a:candidate[zoneBeats[i]].probe.zone,b:candidate[zoneBeats[j]].probe.zone,
    structure:structureDistance(a,b,{crop:WORLD_CROP})
  }));
  const warningContrast=frameDifference(runs.magnetWarnCalm.get(12),runs.magnetWarn.get(12),{native:false,crop:WORLD_CROP});
  const warningLand=frameDifference(runs.magnetWarn.get(12),runs.magnetLand.get(12),{native:false,crop:WORLD_CROP});

  // Good/bad feedback beats: live frame vs same-sim __NO_PAYOFF_FX twin, so
  // every measured pixel is feedback presentation by construction: the
  // milestone ring decal and burst around the ball, the bump crack decal,
  // and the finale confetti.
  const msBox=runs.milestone.get(8).probe.playerBox;
  const msCrop={x:Math.max(0,msBox.x-16),y:Math.max(WORLD_CROP.y,msBox.y-14),
    width:Math.min(160,msBox.x+msBox.width+16)-Math.max(0,msBox.x-16),
    height:Math.min(360,msBox.y+msBox.height+14)-Math.max(WORLD_CROP.y,msBox.y-14)};
  const msFx=frameDifference(runs.milestoneNoFx.get(8),runs.milestone.get(8),{native:false,crop:msCrop,threshold:1});
  const bumpBox=runs.bump.get(8).probe.playerBox;
  const bumpCrop={x:Math.max(0,bumpBox.x-16),y:Math.max(WORLD_CROP.y,bumpBox.y-14),
    width:Math.min(160,bumpBox.x+bumpBox.width+16)-Math.max(0,bumpBox.x-16),
    height:Math.min(360,bumpBox.y+bumpBox.height+14)-Math.max(WORLD_CROP.y,bumpBox.y-14)};
  const bumpFx=frameDifference(runs.bumpNoFx.get(8),runs.bump.get(8),{native:false,crop:bumpCrop,threshold:1});
  const finaleFx=frameDifference(runs.finaleNoFx.get(12),runs.finale.get(12),{native:false,crop:WORLD_CROP,threshold:1});

  const scrollChecks=[
    scrollCoherence('opening',8,14),
    scrollCoherence('harbor',8,14)
  ];

  // Zero-guideline receipts (full native frames, HUD included).
  const planPairs=[['feast',12],['bump',12],['magnetWarn',12],['sweeper',12],['orbit',12]].map(([id,offset])=>({
    beat:id,offset,difference:frameDifference(runs['planLeft_'+id].get(offset),runs['planRight_'+id].get(offset),{native:false})}));
  const gameSource=fs.readFileSync(GAME_PATH,'utf8');
  const bannedOverlaySources=['drawRoute','routeDot','setLineDash','predictIntercept','drawWaypoint','drawPath(']
    .filter(token=>gameSource.includes(token));

  // Locked-candidate calibration, seed 0x57a0001 (re-measured 2026-07-17 on
  // the readability-pass art: directional sphere roll, item contact shadows,
  // haze veil -> 34px horizon glow, orbit nebula dust; bands unchanged —
  // every beat still clears them with margin): colors 186..360, entropy
  // 3.14..3.97, luma deviation .129...180, largest-color max .541 (pets;
  // orbit dropped .580->.326 once nebula dust replaced the flat slab the old
  // haze veil had been papering over), one-pixel edge .0212...0384, rich
  // cells .867..1.0 with median .989, zone structure median .565 (min .507),
  // warning contrast .163 changed/.0243 mean, land .205/.0347, bursts player
  // .395 med / sweeper .269 med, finale burst max .232, payoff diffs ms
  // .0154 / bump .0228 / finale .0352 changed. Quiet-corridor calibration:
  // calm floors .0025-.0061 / sides .0005-.0251; a deliberate 1px-gravel busy
  // build floors .0273-.0300 fails QUIET_FLOOR_MAX at ~1.9x. Floors keep
  // ~10-30% margin under measurement; ceilings keep ~1.8-4x margin over calm.
  const bands={
    colors:90,entropy:2.7,lumaStdDev:.10,largestColorShare:.55,
    edgeEnergy:.014,richEach:.75,richMedian:.92,
    playerMedian:.10,playerFirstLast:.16,playerGrid:.55,
    sweeperMedian:.10,sweeperFirstLast:.20,sweeperGrid:.60,
    finaleMax:.10,
    zoneMedian:.40,zoneEach:.30,
    warningChanged:.10,warningMean:.012,warningGrid:.35,warningBounds:.50,
    landChanged:.12,landMean:.02,landGrid:.50,landBounds:.50,
    msFxChanged:.008,msFxMean:.002,bumpFxChanged:.008,bumpFxMean:.0015,
    finaleFxChanged:.008,finaleFxMean:.0015
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
  gate('katamari has aligned temporal animation',!!playerBurst&&playerBurst.changedFraction.median>=bands.playerMedian&&
    playerBurst.firstLast.changedFraction>=bands.playerFirstLast&&playerBurst.firstLast.changedGridFraction>=bands.playerGrid&&
    playerBurst.changedFraction.max<=.75,playerBurst);
  gate('sweeper has aligned windup and pursuit animation',!!sweeperBurst&&sweeperBurst.changedFraction.median>=bands.sweeperMedian&&
    sweeperBurst.firstLast.changedFraction>=bands.sweeperFirstLast&&sweeperBurst.firstLast.changedGridFraction>=bands.sweeperGrid&&
    sweeperBurst.changedFraction.max<=.85,sweeperBurst);
  const sweeperProbe=runs.sweeper.get(8).probe;
  gate('sweeper beat carries the spin-up tell',sweeperProbe.sweeperBoxes.some(box=>box.state==='windup'),sweeperProbe.sweeperBoxes);
  const finaleProbe=runs.finale.get(12).probe;
  gate('finale is a real star state with payoff motion',finaleProbe.state==='star'&&!!finaleProbe.outcome&&
    finaleBurst.changedFraction.max>=bands.finaleMax&&finaleFx.changedFraction>=bands.finaleFxChanged&&finaleFx.meanDelta>=bands.finaleFxMean,
    {probe:finaleProbe,finaleBurst,finaleFx});
  gate('five zones change structure, not only palette',new Set(zoneBeats.map(id=>candidate[id].probe.zone)).size===5&&
    median(zonePairs.map(pair=>pair.structure.structureDistance))>=bands.zoneMedian&&
    zonePairs.every(pair=>pair.structure.structureDistance>=bands.zoneEach),zonePairs);
  gate('magnet warning is visibly distinct from identical calm state',warningContrast.changedFraction>=bands.warningChanged&&
    warningContrast.meanDelta>=bands.warningMean&&warningContrast.changedGridFraction>=bands.warningGrid&&
    warningContrast.changedBoundsFraction>=bands.warningBounds,warningContrast);
  const landProbe=runs.magnetLand.get(12).probe;
  const rainCount=runs.magnetLand.get(12).probe.act==='live';
  gate('magnet land is a physical shower, not only a tint',warningLand.changedFraction>=bands.landChanged&&
    warningLand.meanDelta>=bands.landMean&&warningLand.changedGridFraction>=bands.landGrid&&
    warningLand.changedBoundsFraction>=bands.landBounds&&landProbe.act==='live'&&rainCount,
    {warningLand,probe:landProbe});
  gate('king warn descends the royal face',runs.kingWarn.get(12).probe.kingY>-80&&runs.kingWarn.get(12).probe.act==='warn'&&
    runs.kingLive.get(12).probe.kingY>20, {warn:runs.kingWarn.get(12).probe.kingY,live:runs.kingLive.get(12).probe.kingY});
  gate('no guideline overlays: opposite forced route plans render identically at every planning beat',
    planPairs.every(value=>value.difference.changedFraction===0&&value.difference.meanDelta===0),planPairs);
  gate('no guideline overlays: banned overlay primitives are absent from the game source',
    bannedOverlaySources.length===0,{banned:bannedOverlaySources});
  gate('ground plane scrolls with travel, never against it',scrollChecks.every(value=>value.ok),scrollChecks);
  gate('milestone lands payoff pixels around the ball',msFx.changedFraction>=bands.msFxChanged&&
    msFx.meanDelta>=bands.msFxMean,{msFx,msCrop});
  gate('the bump lands payoff pixels around the ball',bumpFx.changedFraction>=bands.bumpFxChanged&&
    bumpFx.meanDelta>=bands.bumpFxMean,{bumpFx,bumpCrop});
  const feastPose=runs.feast.get(12).probe.pose;
  gate('normal rolling carries no phantom crab: lean tracks travel',
    Math.abs(feastPose.vx)<.12||Math.sign(feastPose.angle)===Math.sign(feastPose.vx)||Math.abs(feastPose.angle)<.03,
    {feastPose});
  // Status-near-ball contract: the player's own numbers (size, class pips,
  // time, score) live in a compact cluster beside the katamari at the bottom
  // of the strip — never exiled to the far top. The probe carries the box;
  // the pixels carry the pips.
  const hudStatus=runs.feast.get(12).probe.layout&&runs.feast.get(12).probe.layout.hudStatus;
  const hudPalette=(()=>{
    if(!hudStatus)return null;
    const src=toNativeFrame(candidate.feast),colors={pips:0,text:0};
    for(let y=hudStatus.y;y<hudStatus.y+hudStatus.height;y++)for(let x=hudStatus.x;x<hudStatus.x+hudStatus.width;x++){
      const i=(y*src.width+x)*4,r=src.rgba[i],g=src.rgba[i+1],b=src.rgba[i+2];
      const near=(pr,pg,pb,t)=>(r-pr)*(r-pr)+(g-pg)*(g-pg)+(b-pb)*(b-pb)<=t*t;
      if(near(255,209,102,55)||near(103,232,162,55)||near(89,216,245,55))colors.pips++;
      if(near(255,243,218,55))colors.text++;
    }
    return colors;
  })();
  gate('player status cluster lives beside the ball with live pips in it',
    !!hudStatus&&hudStatus.y>=292+25&&hudStatus.y+hudStatus.height<=360&&
    hudStatus.y-292<=80&&!!hudPalette&&hudPalette.pips>4&&hudPalette.text>2,
    {hudStatus,hudPalette});
  const quietBeats=['opening','pets','street','harbor'].map(id=>({beat:id,
    floor:+speckleDensity(candidate[id],QUIET_FLOOR_CROP).toFixed(4),
    sides:+((speckleDensity(candidate[id],QUIET_SIDE_CROPS[0])+speckleDensity(candidate[id],QUIET_SIDE_CROPS[1]))/2).toFixed(4)}));
  gate('corridor floor and zone edges stay quiet: no speckle fields fighting the action',
    quietBeats.every(v=>v.floor<=QUIET_FLOOR_MAX&&v.sides<=QUIET_SIDES_MAX),
    {quietBeats,ceilings:{floor:QUIET_FLOOR_MAX,sides:QUIET_SIDES_MAX}});
  gate('candidate numeric richness meets both reference medians',median(cm.map(value=>value.edge[1].energy))>=ref.edge*.95&&
    median(cm.map(value=>value.richCellFraction))>=ref.rich*.95&&median(cm.map(value=>value.colorEntropy))>=ref.entropy*.95&&
    median(cm.map(value=>value.lumaStdDev))>=ref.luma*.90,
    {candidate:{edge:median(cm.map(value=>value.edge[1].energy)),rich:median(cm.map(value=>value.richCellFraction)),
      entropy:median(cm.map(value=>value.colorEntropy)),luma:median(cm.map(value=>value.lumaStdDev))},reference:ref});

  // Drawn-pixel actor scale, measured across beats that span zones, the
  // sweeper duel, pets, vehicles, and the finale approach.
  const scaleSamples={};
  for(const[fixture,offset]of[['first-feast',12],['sweeper-chase',8],['street',12],['garden-pets',12],['orbit',12]])
    scaleSamples[fixture]=measureSubjects(fixture,offset);
  const allMeasurements=Object.values(scaleSamples).flatMap(sample=>sample.measurements);
  gate('drawn actors obey the small-actors-big-worlds caps',
    allMeasurements.length>=8&&allMeasurements.every(m=>m.assertion.ok&&!m.clipped&&!(m.probeOverflow&&m.probeOverflow.any)),
    Object.fromEntries(Object.entries(scaleSamples).map(([key,sample])=>[key,
      sample.measurements.map(m=>({id:m.id,kind:m.kind,type:m.type,w:m.width,h:m.height,failures:m.assertion.failures}))])));
  const casts=Object.entries(scaleSamples).map(([key,sample])=>({fixture:key,
    bodies:sample.measurements.filter(m=>m.id!=='player').length}));
  gate('shrunken actors did not empty the strip: cast stays dense',
    casts.every(value=>value.bodies>=1),casts);
  const footprints=['first-feast','street','orbit'].map(fixture=>footprintOf(scaleSamples[fixture]));
  gate('normal-play actor footprint stays under 20% of the playfield',footprints.every(value=>value.ok),footprints);
  const approach=scaleSamples['first-feast'].probe.layout&&scaleSamples['first-feast'].probe.layout.approach;
  const approachRatio=approach?approach.visible/approach.travel:0;
  gate('threats get at least 55% of the travel axis before contact',
    !!approach&&approach.travel>=300&&approachRatio>=.55,{approach,approachRatio:+approachRatio.toFixed(4)});

  writeJson(REVIEW_TEMPLATE_PATH,reviewTemplate(sheet.sha256));
  let review;
  if(fs.existsSync(REVIEW_PATH))review=verifyReviewReceipt(REVIEW_PATH,{montageSha256:sheet.sha256,preservedPath:PRESERVED_CONTACT_PATH});
  else review={ok:false,errors:[`missing committed semantic review: ${REVIEW_PATH}`,`inspect ${CONTACT_PATH}, then copy and complete ${REVIEW_TEMPLATE_PATH}`]};
  if(review.ok&&!(review.receipt&&review.receipt.guidelineOverlays&&review.receipt.guidelineOverlays.confirmedAbsent===true)){
    review.ok=false;review.errors=[...(review.errors||[]),'receipt must confirm guidelineOverlays.confirmedAbsent=true with a review note'];
  }
  const semanticGate={name:'fresh semantic comparison receipt',ok:review.ok,detail:review.errors};
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
    schema:1,game:'star-roller',gameSha256,seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,
    contactSheet:{path:CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{fixture:beat.run,offset:beat.offset,probe:candidate[beat.id].probe}])),
    thresholds:{referenceMedians:ref,bands,actorScale:{player:{maxWidth:48,maxHeight:48},sweeper:{maxWidth:30,maxHeight:26},
      pet:{maxWidth:36,maxHeight:30},vehicle:{maxWidth:48,maxHeight:50},footprint:.20,approach:.55,threshold:ACTOR_THRESHOLD}},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,
      playerBurst,sweeperBurst,finaleBurst,zonePairs,warningContrast,warningLand,
      msFx,bumpFx,finaleFx,scrollChecks,quietBeats,
      actorScale:Object.fromEntries(Object.entries(scaleSamples).map(([key,sample])=>[key,
        sample.measurements.map(m=>({id:m.id,kind:m.kind,type:m.type,bounds:m.bounds,drawnPixels:m.drawnPixels,
          clipped:m.clipped,probeOverflow:m.probeOverflow,failures:m.assertion.failures}))])),
      footprints,approach:{probe:approach,ratio:approachRatio},clip:localClip},
    guidelines:{planPairs,bannedTokens:['drawRoute','routeDot','setLineDash','predictIntercept','drawWaypoint','drawPath('],
      bannedHits:bannedOverlaySources},
    gates,automatedOk,semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
  };
  writeJson(METRICS_PATH,report);

  console.log(`STAR ROLLER visual evidence · seed 0x${SEED.toString(16)} · game ${gameSha256.slice(0,12)}`);
  for(const value of automatedGates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log(`  ${review.ok?'PASS':'PENDING'} ${semanticGate.name}`);
  for(const value of clipGates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log('  contact:',CONTACT_PATH);
  console.log('  montage sha256:',sheet.sha256);
  console.log('  metrics:',METRICS_PATH);
  console.log('  review template:',REVIEW_TEMPLATE_PATH);
  if(!automatedOk){console.error('\nSTAR ROLLER AUTOMATED VISUAL GATES FAILED');process.exit(1);}
  if(!review.ok){console.error('\nSTAR ROLLER AUTOMATED VISUAL GATES PASSED; SEMANTIC REVIEW PENDING');process.exit(1);}
  if(!clipGates.every(value=>value.ok)){console.error('\nSTAR ROLLER RENDERED CLIP RECEIPT INCOMPLETE');process.exit(1);}
  console.log('\nSTAR ROLLER VISUAL EVAL PASSED');
}

main().catch(error=>{console.error('STAR ROLLER VISUAL EVAL FAILED:',error.stack||error);process.exit(1)});
