#!/usr/bin/env node
'use strict';

// DEMON FIST real-pixel release gate. Behavioral truth lives in
// demon-fist-eval.js; this suite stages deterministic authored visual beats,
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
const GAME_PATH=path.join(__dirname,'..','demon-fist.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','demon-fist');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','demon-fist.json');
const PRESERVED_CONTACT_PATH=path.join(__dirname,'visual-receipts','demon-fist-contact-sheet.png');
const CLIP_PATH=path.join(ARTIFACT_DIR,'demon-fist-30s.mp4');
const SEED=0xdf150001,PRE_ROLL=120,RENDER_EVERY=2;
const WORLD_CROP={x:0,y:38,width:160,height:322};
const ACTOR_THRESHOLD=8,ACTOR_PADDING=10;
const CALIBRATE=!!process.env.DF_CALIBRATE;

if(!fs.existsSync(GAME_PATH)){
  console.error('DEMON FIST VISUAL EVAL FAILED: missing '+GAME_PATH);
  process.exit(1);
}

const median=values=>quantile(values,.5);
const visible=(box,crop)=>!!box&&box.x<crop.x+crop.width&&box.x+box.width>crop.x&&
  box.y<crop.y+crop.height&&box.y+box.height>crop.y;

function visualProbe(runtime){
  const visualFn=runtime.sandbox.__demonFistVisualProbe,fullFn=runtime.sandbox.__demonFistProbe;
  if(typeof visualFn!=='function'||typeof fullFn!=='function')
    throw new Error('demon-fist.html must expose __demonFistVisualProbe() and __demonFistProbe()');
  const value=visualFn(),full=fullFn();
  if(!value||value.finite===false||!full||full.finite===false)
    throw new Error('demon-fist visual fixture produced non-finite state');
  const enemyBoxes=Array.from(value.enemyBoxes||[]);
  return Object.assign({},value,{
    show:full.show,actType:full.act.type,stats:full.stats,
    visibleEnemyCount:enemyBoxes.filter(box=>visible(box,WORLD_CROP)).length
  });
}

function captureFixture(name,offsets,options){
  options=options||{};
  const runtime=bootRenderedGame('demon-fist',{seed:SEED});
  if(options.beforeSet)options.beforeSet(runtime);
  const setBeat=runtime.sandbox.__demonFistSetVisualBeat;
  if(typeof setBeat!=='function')throw new Error('demon-fist.html must expose __demonFistSetVisualBeat(name)');
  if(setBeat(name)!==true)throw new Error('unknown Demon Fist visual beat: '+name);
  if(options.selector!==undefined)runtime.sandbox.__DF_VISUAL_ONLY_SUBJECT=options.selector;
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

// Furniture-quiet gate: the street and the flanks are the STAGE, not the show.
// Speckle density counts pixels that fight BOTH horizontal neighbours in luma —
// isolated one-pixel marks — inside actor-free crops of the street band and the
// two side strips. Busy-build and calm-build measurements are locked in the
// band comment below.
const QUIET_STREET_CROP={x:16,y:316,width:128,height:24};
const QUIET_SIDE_CROPS=[{x:0,y:44,width:14,height:240},{x:146,y:44,width:14,height:240}];
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

// Drawn-pixel actor-scale gates (small-actors-big-worlds law): the game
// isolates any probe actor through __DF_VISUAL_ONLY_SUBJECT and the caps below
// encode the directive with a little margin, measured on the shipped art.
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
  if(actor.kind==='elite')return{maxWidth:22,maxHeight:38,label:`elite ${actor.type}`};
  if(actor.kind==='heavy')return{maxWidth:18,maxHeight:32,label:`heavy ${actor.type}`};
  if(actor.kind==='fighter')return{maxWidth:20,maxHeight:32,label:`fighter ${actor.type}`};
  return{maxWidth:16,maxHeight:28,label:`enemy ${actor.type}`};
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

// Ground-plane scroll coherence: the street must flow LEFT with travel as the
// fighter walks right. Render the same beat at two sim times, find the
// horizontal pixel shift that best explains the street strip, and require it
// to match the fighter's measured world advance with a clear margin over every
// zero/rightward shift.
const SCROLL_CROP={x:10,y:312,width:140,height:26};
function lumaGrid(input,crop){
  const source=toNativeFrame(input),out=new Float64Array(crop.width*crop.height);
  for(let y=0;y<crop.height;y++)for(let x=0;x<crop.width;x++){
    const src=((crop.y+y)*source.width+crop.x+x)*4;
    out[y*crop.width+x]=source.rgba[src]*.299+source.rgba[src+1]*.587+source.rgba[src+2]*.114;
  }
  return out;
}
function horizontalShiftScores(before,after,crop,maxShift){
  const scores=[];
  for(let dx=-maxShift;dx<=maxShift;dx++){
    let sum=0,n=0;
    for(let x=Math.max(0,dx);x<crop.width+Math.min(0,dx);x++)
      for(let y=0;y<crop.height;y++){sum+=Math.abs(after[y*crop.width+x]-before[y*crop.width+x-dx]);n++;}
    scores.push({dx,sad:sum/n});
  }
  return scores;
}
// Background stability gate (owner directive 2026-07-17: "the sky scape
// lights flicker waaaay too much... backgrounds should always feel stable").
// Renders the environment layer ALONE (actors and HUD excluded by the env
// subject selector) for the same primed beat at nearby sim times with the
// camera and world frozen — any changed pixel is pure background animation.
const BG_CROP={x:0,y:34,width:160,height:309};
function backgroundStability(beat){
  const runtime=bootRenderedGame('demon-fist',{seed:SEED});
  const setBeat=runtime.sandbox.__demonFistSetVisualBeat;
  if(setBeat(beat)!==true)throw new Error('unknown Demon Fist visual beat: '+beat);
  runtime.sandbox.__DF_VISUAL_ONLY_SUBJECT='env';
  const shot=t=>{runtime.evaluate(`showFrame=${t};render()`);return runtime.snapshot({native:true});};
  const rows=[];
  for(const base of[1000,1009]){
    const first=shot(base);
    for(const delta of[6,12,30]){
      const diff=frameDifference(first,shot(base+delta),{native:false,crop:BG_CROP});
      rows.push({base,delta,changedFraction:diff.changedFraction,meanDelta:diff.meanDelta});
    }
  }
  return{beat,maxChanged:Math.max(...rows.map(r=>r.changedFraction)),rows};
}

function scrollCoherence(beat,fromOffset,toOffset){
  const runtime=bootRenderedGame('demon-fist',{seed:SEED});
  const setBeat=runtime.sandbox.__demonFistSetVisualBeat;
  if(setBeat(beat)!==true)throw new Error('unknown Demon Fist visual beat: '+beat);
  runtime.evaluate("visualIntent={move:1,attack:null,dodge:false,tactic:'ADVANCE'}");
  runtime.advanceTo(fromOffset,{renderEvery:RENDER_EVERY,renderLast:true});
  const x0=runtime.evaluate('camX'),before=lumaGrid(runtime.snapshot({native:true}),SCROLL_CROP);
  runtime.advanceTo(toOffset,{renderEvery:RENDER_EVERY,renderLast:true});
  const x1=runtime.evaluate('camX'),after=lumaGrid(runtime.snapshot({native:true}),SCROLL_CROP);
  const expected=-Math.round(x1-x0),scores=horizontalShiftScores(before,after,SCROLL_CROP,18);
  const best=scores.reduce((m,s)=>s.sad<m.sad?s:m);
  const counterScrollSad=Math.min(...scores.filter(s=>s.dx>=0).map(s=>s.sad));
  return{beat,expected,bestDx:best.dx,bestSad:best.sad,counterScrollSad,
    ok:expected<=-4&&Math.abs(best.dx-expected)<=2&&best.sad<counterScrollSad*.8};
}

function buildCandidateEvidence(){
  const specs={
    opening:{fixture:'opening',offsets:[1,6,12,24]},
    brawl:{fixture:'mob',offsets:[1,3,5,7,9,13,24]},
    jab:{fixture:'jab-chain',offsets:[1,4,8,12,24]},
    launcher:{fixture:'launcher',offsets:[1,4,8,12,24]},
    launcherNoFx:{fixture:'launcher',offsets:[8],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}},
    slam:{fixture:'juggle-slam',offsets:[1,4,8,12,20,32]},
    drop:{fixture:'demon-drop',offsets:[1,6,12,16,20,24,30]},
    dropNoFx:{fixture:'demon-drop',offsets:[24],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}},
    sweep:{fixture:'sweep',offsets:[1,4,8,12,24]},
    counter:{fixture:'counter',offsets:[1,4,8,12,24]},
    warn:{fixture:'gate-warn',offsets:[1,6,12,24]},
    warnCalm:{fixture:'gate-warn',offsets:[12],afterSet:runtime=>runtime.evaluate("act.phase='calm'")},
    land:{fixture:'gate-land',offsets:[1,6,12,24]},
    mob:{fixture:'mob',offsets:[1,6,12,24]},
    super:{fixture:'super',offsets:[1,4,8,12,24]},
    superNoFx:{fixture:'super',offsets:[8],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}},
    market:{fixture:'market',offsets:[1,6,12,24]},
    dojo:{fixture:'dojo',offsets:[1,6,12,24]},
    gate:{fixture:'demon-gate',offsets:[1,6,12,24]},
    finale:{fixture:'finale',offsets:[1,6,12,24,48]},
    finaleNoFx:{fixture:'finale',offsets:[12],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}}
  };
  // No-guideline pairs: the fight planner's output may NEVER reach the canvas.
  // Forcing opposite committed plans before rendering must change ZERO pixels
  // at every planning beat — fixtures drive the fighter through visualIntent,
  // so the injected plan is simulation-inert and any pixel delta is an overlay.
  const forcePlan=targetX=>runtime=>runtime.evaluate(
    `plan={targetX:${targetX},score:500,min:20,stance:'edge'};`);
  for(const[id,fixture,offset]of[['brawl','mob',13],['jab','jab-chain',12],['warn','gate-warn',12],['land','gate-land',12],['super','super',12]]){
    specs['planLeft_'+id]={fixture,offsets:[offset],afterSet:forcePlan(26)};
    specs['planRight_'+id]={fixture,offsets:[offset],afterSet:forcePlan(134)};
  }
  const runs={};
  for(const[id,spec]of Object.entries(specs))
    runs[id]=captureFixture(spec.fixture,spec.offsets,{id,beforeSet:spec.beforeSet,afterSet:spec.afterSet});
  const beats=[
    {id:'opening',label:'opening',run:'opening',offset:12},
    {id:'brawl',label:'the mob',run:'brawl',offset:13},
    {id:'jab',label:'jab chain',run:'jab',offset:8},
    {id:'launcher',label:'launcher',run:'launcher',offset:8},
    {id:'slam',label:'air slam',run:'slam',offset:12},
    {id:'drop',label:'demon drop',run:'drop',offset:12},
    {id:'sweep',label:'sweep',run:'sweep',offset:8},
    {id:'counter',label:'counter',run:'counter',offset:8},
    {id:'warn',label:'gate warning',run:'warn',offset:12},
    {id:'land',label:'gatekeeper',run:'land',offset:12},
    {id:'mob',label:'mob rush',run:'mob',offset:12},
    {id:'super',label:'god wheel',run:'super',offset:12},
    {id:'market',label:'market roof',run:'market',offset:12},
    {id:'dojo',label:'old dojo',run:'dojo',offset:12},
    {id:'gate',label:'demon gate',run:'gate',offset:12},
    {id:'finale',label:'finale',run:'finale',offset:12}
  ];
  const frames=Object.fromEntries(beats.map(beat=>[beat.id,runs[beat.run].get(beat.offset)]));
  const all=[];
  for(const[id,frameMap]of Object.entries(runs))for(const[offset,frame]of frameMap)all.push({id,offset,frame});
  return{specs,runs,beats,frames:frames,all};
}

function reviewTemplate(montageSha256){
  const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});
  const command=`node render/render.js demon-fist 30 .artifacts/visual/demon-fist/demon-fist-30s.mp4 --seed 0x${SEED.toString(16)} --probe --fps 30`;
  return{
    schema:1,game:'demon-fist',verdict:'pending',references:['horizon','blockmine'],montageSha256,
    reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size reference review',
    renderReceipt:{seed:'0x'+SEED.toString(16),seconds:30,fps:30,codec:'h264',dimensions:'320x720',bytes:0,sha256:'',command},
    categories:{
      characterCraft:pending('Inspect the white-gi fighter with the oversized cursed fist (jab chain, launcher uppercut, sweep spin, backstep dodge, air slam, the DEMON DROP leap with tucked-leg arc and landing quake, the clear-street sprint, GOD WHEEL roulette), the four street demons (jacket thug, lean sprinter, armored mohawk bruiser, horned demon), the crowned GATEKEEPER elite, honest travel facing, and windup tells at 160x360.'),
      environmentCraft:pending('Inspect each block with the HUD mentally removed: BACK ALLEY brick walls, fire escapes and the always-lit FIST neon; MARKET ROOF awnings, lantern strings and water towers; DOCK SIDE cranes, container stacks and water; OLD DOJO shoji screens, paper lanterns and pagoda roofs; DEMON GATE obsidian spikes, chains, lava seams and the horned gate. The stage must read STABLE: no twinkling, strobing, or pulsing ambience anywhere.'),
      levelVariety:pending('Confirm the five blocks change spatial landmarks, wall grammar, material silhouette, and composition rather than only palette.'),
      animationImpact:pending('Confirm aligned fighter and elite crops animate, the windup tells telegraph, jabs connect with sparks, the launcher pops airborne, the slam spikes down, the DEMON DROP arcs over a body and fells one with the quake, sweeps knock the cluster, the counter backsteps on the tell, GOD WHEEL spins with afterimages, and the finale celebration lands.'),
      readability:pending('Confirm intent reads from the bodies alone — honest facing that tracks travel, raised-fist windup tells, the keeper crown, the flanking mob — and that every good/bad beat is tagged gold vs coral with static aftermath decals (including the gold quake chevrons). Confirm HP/meter/combo/block pips sit beside the fighter at the bottom with ZERO drawn guidelines, and the street flows left with travel while the skyline holds still.'),
      artDirectionCohesion:pending('Confirm the five-block dusk-city palette, pixel construction, HUD, and payoff language feel like one authored street.')
    },
    guidelineOverlays:{confirmedAbsent:false,note:'Confirm every sampled beat pre-draws NOTHING about actor intent or trajectory: no route lines/dots, arrows, target highlights, intercept predictions, ghost phantoms, predicted arcs, or safe-lane markers. The keeper march, the mob flanking, and the warning banner are physical world telegraphs and stay.'}
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

  const referenceTargets=[60,600,1200,2400,3600,5400,7200,9000,10800,12600,15000,16800,18000,19800,21600,22800];
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
      {label:'DEMON FIST',frames:candidate},
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

  const playerBurst=analyzeAlignedBurst([1,3,5,7,9,13,24].map(offset=>runs.brawl.get(offset)),
    frame=>frame.probe.playerBox,48,56);
  const eliteBurst=analyzeAlignedBurst([1,6,12,24].map(offset=>runs.land.get(offset)),
    frame=>frame.probe.eliteBox,48,56);
  const slamBurst=analyzeBurst([1,4,8,12,20,32].map(offset=>runs.slam.get(offset)),{native:false,crop:WORLD_CROP});
  const dropBurst=analyzeBurst([1,6,12,16,20,24,30].map(offset=>runs.drop.get(offset)),{native:false,crop:WORLD_CROP});

  const blockBeats=['opening','launcher','sweep','dojo','gate'];
  const blockFrames=blockBeats.map(id=>candidate[id]);
  const blockPairs=allPairs(blockFrames,(a,b,i,j)=>({
    a:candidate[blockBeats[i]].probe.block,b:candidate[blockBeats[j]].probe.block,
    structure:structureDistance(a,b,{crop:WORLD_CROP})
  }));
  const warningContrast=frameDifference(runs.warnCalm.get(12),runs.warn.get(12),{native:false,crop:WORLD_CROP});
  const warningLand=frameDifference(runs.warn.get(12),runs.land.get(12),{native:false,crop:WORLD_CROP});
  const finaleBurst=analyzeBurst([1,6,12,24,48].map(offset=>runs.finale.get(offset)),{native:false,crop:WORLD_CROP});

  // Good/bad feedback beats: live frame vs same-sim __NO_PAYOFF_FX twin, so
  // every measured pixel is feedback presentation by construction.
  const launchBox=runs.launcher.get(8).probe.enemyBoxes&&runs.launcher.get(8).probe.enemyBoxes[0];
  const launchCrop=launchBox?{x:Math.max(0,launchBox.x-16),y:Math.max(WORLD_CROP.y,launchBox.y-14),
    width:Math.min(160,launchBox.x+launchBox.width+16)-Math.max(0,launchBox.x-16),
    height:Math.min(360,launchBox.y+launchBox.height+14)-Math.max(WORLD_CROP.y,launchBox.y-14)}:WORLD_CROP;
  const launchFx=frameDifference(runs.launcherNoFx.get(8),runs.launcher.get(8),{native:false,crop:launchCrop,threshold:1});
  const dropBox=runs.drop.get(24).probe.playerBox;
  const dropCrop={x:Math.max(0,dropBox.x-26),y:Math.max(WORLD_CROP.y,dropBox.y-16),
    width:Math.min(160,dropBox.x+dropBox.width+26)-Math.max(0,dropBox.x-26),
    height:Math.min(360,dropBox.y+dropBox.height+16)-Math.max(WORLD_CROP.y,dropBox.y-16)};
  const dropFx=frameDifference(runs.dropNoFx.get(24),runs.drop.get(24),{native:false,crop:dropCrop,threshold:1});
  const superBox=runs.super.get(8).probe.playerBox;
  const superCrop={x:Math.max(0,superBox.x-24),y:Math.max(WORLD_CROP.y,superBox.y-20),
    width:Math.min(160,superBox.x+superBox.width+24)-Math.max(0,superBox.x-24),
    height:Math.min(360,superBox.y+superBox.height+20)-Math.max(WORLD_CROP.y,superBox.y-20)};
  const superFx=frameDifference(runs.superNoFx.get(8),runs.super.get(8),{native:false,crop:superCrop,threshold:1});
  const finaleFx=frameDifference(runs.finaleNoFx.get(12),runs.finale.get(12),{native:false,crop:WORLD_CROP,threshold:1});

  const scrollChecks=[
    scrollCoherence('opening',8,16),
    scrollCoherence('market',8,16)
  ];
  const bgChecks=['opening','market','juggle-slam','dojo','demon-gate'].map(backgroundStability);

  // Zero-guideline receipts (full native frames, HUD included).
  const planPairs=[['brawl',13],['jab',12],['warn',12],['land',12],['super',12]].map(([id,offset])=>({
    beat:id,offset,difference:frameDifference(runs['planLeft_'+id].get(offset),runs['planRight_'+id].get(offset),{native:false})}));
  const gameSource=fs.readFileSync(GAME_PATH,'utf8');
  const bannedOverlaySources=['drawRoute','routeDot','setLineDash','predictIntercept','drawWaypoint','drawPath(']
    .filter(token=>gameSource.includes(token));

  // Locked-candidate calibration, seed 0xdf150001 (2026-07-17):
  const bands={
    colors:80,entropy:2.7,lumaStdDev:.08,largestColorShare:.48,
    edgeEnergy:.012,richEach:.5,richMedian:.58,
    playerMedian:.08,playerFirstLast:.14,playerGrid:.5,
    eliteMedian:.1,eliteFirstLast:.18,eliteGrid:.55,
    slamMax:.06,
    dropMax:.06,dropFxChanged:.003,dropFxMean:.0006,
    blockMedian:.24,blockEach:.16,
    warningChanged:.06,warningMean:.008,warningGrid:.2,warningBounds:.25,
    landChanged:.06,landMean:.012,landGrid:.22,landBounds:.22,
    finaleMax:.08,
    launchFxChanged:.003,launchFxMean:.0006,superFxChanged:.003,superFxMean:.0006,
    finaleFxChanged:.003,finaleFxMean:.0005
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
  gate('fighter has aligned temporal animation',!!playerBurst&&playerBurst.changedFraction.median>=bands.playerMedian&&
    playerBurst.firstLast.changedFraction>=bands.playerFirstLast&&playerBurst.firstLast.changedGridFraction>=bands.playerGrid&&
    playerBurst.changedFraction.max<=.7,playerBurst);
  gate('gatekeeper has aligned pursuit and windup animation',!!eliteBurst&&eliteBurst.changedFraction.median>=bands.eliteMedian&&
    eliteBurst.firstLast.changedFraction>=bands.eliteFirstLast&&eliteBurst.firstLast.changedGridFraction>=bands.eliteGrid&&
    eliteBurst.changedFraction.max<=.85,eliteBurst);
  const jab8=runs.jab.get(8).probe;
  gate('jab-chain beat shows the fighter mid-combo',jab8.pose.state==='attack'&&jab8.pose.atkKind&&jab8.pose.atkKind.startsWith('jab'),jab8.pose);
  const launcher8=runs.launcher.get(8).probe;
  gate('launcher beat carries an airborne bruiser',launcher8.enemyBoxes.some(box=>box.state==='launched'),launcher8.enemyBoxes);
  const slam8=runs.slam.get(8).probe;
  gate('slam beat spikes downward with payoff motion',slamBurst.changedFraction.max>=bands.slamMax&&
    (slam8.pose.state==='slam'||slam8.enemyBoxes.some(box=>box.state==='launched'||box.state==='down')),{slamBurst,probe:slam8.pose});
  const drop6=runs.drop.get(6).probe,drop20=runs.drop.get(20).probe,drop24=runs.drop.get(24).probe;
  gate('demon drop leaps a real airborne arc over the street',
    drop6.pose.state==='jump'&&drop6.pose.atkPhase==='air'&&
    drop6.playerBox.y<=drop20.playerBox.y-8&&dropBurst.changedFraction.max>=bands.dropMax,
    {air:drop6.pose,airBoxY:drop6.playerBox.y,nearLandBoxY:drop20.playerBox.y,dropBurst:dropBurst.changedFraction});
  gate('landing quake fells a body and lands payoff pixels at the impact',
    drop24.enemyBoxes.some(box=>box.state==='down')&&
    dropFx.changedFraction>=bands.dropFxChanged&&dropFx.meanDelta>=bands.dropFxMean,
    {enemies:drop24.enemyBoxes,dropFx,dropCrop});
  // Calibrated 2026-07-17 against both builds (env-only render, showFrame
  // deltas 6/12/30 from bases 1000/1009, native crop y34..343). Pre-fix build
  // (strobing FIST neon, pulsing gate ember windows, drifting sky embers,
  // breathing lava, sine curb accents, water shimmer) measured per-block max
  // changed fractions: BACK ALLEY .00307, MARKET ROOF .0019, DOCK SIDE
  // .00247, OLD DOJO .00247, DEMON GATE .02221 — four of five blocks above
  // the ceiling, so the old build fails this gate. The static-stage build
  // measures 0 everywhere except the slow dock-water drift (max .000728),
  // keeping ~2.7x margin under the ceiling.
  const BG_MAX=.002;
  gate('background is a stable stage: skyline luma holds still across nearby sim times',
    bgChecks.every(value=>value.maxChanged<=BG_MAX),
    {ceiling:BG_MAX,bgChecks:bgChecks.map(v=>({beat:v.beat,maxChanged:+v.maxChanged.toFixed(6)}))});
  const sweep8=runs.sweep.get(8).probe;
  gate('sweep beat shows the cluster spin',sweep8.pose.atkKind==='sweep'&&sweep8.visibleEnemyCount>=2,sweep8);
  const counter4=runs.counter.get(4).probe;
  gate('counter beat backsteps on the tell',counter4.pose.state==='dodge'&&counter4.enemyBoxes.some(box=>box.state==='windup'),counter4);
  gate('five blocks change structure, not only palette',new Set(blockBeats.map(id=>candidate[id].probe.block)).size===5&&
    median(blockPairs.map(pair=>pair.structure.structureDistance))>=bands.blockMedian&&
    blockPairs.every(pair=>pair.structure.structureDistance>=bands.blockEach),blockPairs);
  const warnProbe=runs.warn.get(12).probe;
  gate('gate warning is visibly distinct from identical calm state',warningContrast.changedFraction>=bands.warningChanged&&
    warningContrast.meanDelta>=bands.warningMean&&warningContrast.changedGridFraction>=bands.warningGrid&&
    warningContrast.changedBoundsFraction>=bands.warningBounds,{warningContrast,eliteVisible:warnProbe.eliteBox&&visible(warnProbe.eliteBox,WORLD_CROP)});
  const landProbe=runs.land.get(12).probe;
  gate('gate land is a physical duel, not only a tint',warningLand.changedFraction>=bands.landChanged&&
    warningLand.meanDelta>=bands.landMean&&warningLand.changedGridFraction>=bands.landGrid&&
    warningLand.changedBoundsFraction>=bands.landBounds&&landProbe.act==='live'&&landProbe.eliteBox&&
    visible(landProbe.eliteBox,WORLD_CROP),{warningLand,probe:landProbe});
  const mobProbe=runs.mob.get(12).probe;
  gate('mob rush fields a real swarm',mobProbe.visibleEnemyCount>=4&&mobProbe.actType==='mob',mobProbe);
  const superProbe=runs.super.get(12).probe;
  gate('god wheel spins with the roulette pose',superProbe.pose.state==='super',superProbe.pose);
  const finaleProbe=runs.finale.get(12).probe;
  gate('finale is a real finish state with payoff motion',finaleProbe.state==='finale'&&
    finaleBurst.changedFraction.max>=bands.finaleMax&&
    finaleFx.changedFraction>=bands.finaleFxChanged&&finaleFx.meanDelta>=bands.finaleFxMean,
    {probe:finaleProbe,finaleBurst,finaleFx});
  gate('no guideline overlays: opposite forced route plans render identically at every planning beat',
    planPairs.every(value=>value.difference.changedFraction===0&&value.difference.meanDelta===0),planPairs);
  gate('no guideline overlays: banned overlay primitives are absent from the game source',
    bannedOverlaySources.length===0,{banned:bannedOverlaySources});
  gate('ground plane scrolls with travel, never against it',scrollChecks.every(value=>value.ok),scrollChecks);
  gate('launcher lands payoff pixels on the airborne bruiser',launchFx.changedFraction>=bands.launchFxChanged&&
    launchFx.meanDelta>=bands.launchFxMean,{launchFx,launchCrop});
  gate('god wheel lands payoff pixels around the spin',superFx.changedFraction>=bands.superFxChanged&&
    superFx.meanDelta>=bands.superFxMean,{superFx,superCrop});
  const brawlPose=runs.brawl.get(13).probe.pose;
  gate('normal movement carries no phantom crab: facing tracks travel outside attacks',
    Math.abs(brawlPose.vx)<.12||Math.sign(brawlPose.face)===Math.sign(brawlPose.vx)||brawlPose.state!=='free',
    {brawlPose});
  // Status-near-fighter contract: the player's own numbers (health, meter,
  // combo, block pips) live in a compact cluster beside the fighter at the
  // bottom — never exiled to the far top.
  const hudStatus=runs.brawl.get(13).probe.layout&&runs.brawl.get(13).probe.layout.hudStatus;
  const hudPalette=(()=>{
    if(!hudStatus)return null;
    const src=toNativeFrame(candidate.brawl),colors={health:0,meter:0};
    for(let y=hudStatus.y;y<hudStatus.y+hudStatus.height;y++)for(let x=hudStatus.x;x<hudStatus.x+hudStatus.width;x++){
      const i=(y*src.width+x)*4,r=src.rgba[i],g=src.rgba[i+1],b=src.rgba[i+2];
      const near=(pr,pg,pb,t)=>(r-pr)*(r-pr)+(g-pg)*(g-pg)+(b-pb)*(b-pb)<=t*t;
      if(near(103,232,162,55)||near(255,93,79,55))colors.health++;
      if(near(255,176,46,55)||near(255,209,102,55))colors.meter++;
    }
    return colors;
  })();
  gate('player status cluster lives beside the fighter with the bars in it',
    !!hudStatus&&hudStatus.y>=308+20&&hudStatus.y+hudStatus.height<=360&&
    hudStatus.y-308<=80&&!!hudPalette&&hudPalette.health>4&&hudPalette.meter>2,
    {hudStatus,hudPalette});
  const quietBeats=['opening','brawl','jab','sweep','market'].map(id=>({beat:id,
    street:+speckleDensity(candidate[id],QUIET_STREET_CROP).toFixed(4),
    sides:+((speckleDensity(candidate[id],QUIET_SIDE_CROPS[0])+speckleDensity(candidate[id],QUIET_SIDE_CROPS[1]))/2).toFixed(4)}));
  // Measured 2026-07-17 on the calm line-based build: street 0, sides
  // .0000-.0068 across all five sampled blocks. A deliberately busier build
  // (isolated 1px marks peppered at ~2x reference noise density) measures
  // street .0771 and sides .1149 — the ceilings fail it at ~6.4x and ~3.3x
  // while the calm build keeps an order of magnitude of margin.
  const QUIET_STREET_MAX=.012,QUIET_SIDES_MAX=.035;
  gate('street and flank furniture stay quiet: no speckle fields fighting the action',
    quietBeats.every(v=>v.street<=QUIET_STREET_MAX&&v.sides<=QUIET_SIDES_MAX),
    {quietBeats,ceilings:{street:QUIET_STREET_MAX,sides:QUIET_SIDES_MAX}});
  gate('candidate numeric richness meets both reference medians',median(cm.map(value=>value.edge[1].energy))>=ref.edge*.95&&
    median(cm.map(value=>value.richCellFraction))>=ref.rich*.95&&median(cm.map(value=>value.colorEntropy))>=ref.entropy*.95&&
    median(cm.map(value=>value.lumaStdDev))>=ref.luma*.90,
    {candidate:{edge:median(cm.map(value=>value.edge[1].energy)),rich:median(cm.map(value=>value.richCellFraction)),
      entropy:median(cm.map(value=>value.colorEntropy)),luma:median(cm.map(value=>value.lumaStdDev))},reference:ref});

  // Drawn-pixel actor scale, measured across beats that span the blocks, the
  // pack, the elite duel, and the finale.
  const scaleSamples={};
  for(const[fixture,offset]of[['mob',13],['gate-land',12],['demon-gate',12],['dojo',12],['opening',12],['sweep',8]])
    scaleSamples[fixture]=measureSubjects(fixture,offset);
  const allMeasurements=Object.values(scaleSamples).flatMap(sample=>sample.measurements);
  gate('drawn actors obey the small-actors-big-worlds caps',
    allMeasurements.length>=18&&allMeasurements.every(m=>m.assertion.ok&&!m.clipped&&!(m.probeOverflow&&m.probeOverflow.any)),
    Object.fromEntries(Object.entries(scaleSamples).map(([key,sample])=>[key,
      sample.measurements.map(m=>({id:m.id,kind:m.kind,type:m.type,w:m.width,h:m.height,failures:m.assertion.failures}))])));
  const casts=Object.entries(scaleSamples).map(([key,sample])=>({fixture:key,
    bodies:sample.measurements.filter(m=>m.id!=='fighter').length}));
  gate('shrunken actors did not empty the strip: the street stays populated',
    casts.every(value=>value.bodies>=1),casts);
  const footprints=['opening','mob','demon-gate'].map(fixture=>footprintOf(scaleSamples[fixture]));
  gate('normal-play actor footprint stays under 20% of the playfield',footprints.every(value=>value.ok),footprints);
  const approach=scaleSamples['mob'].probe.layout&&scaleSamples['mob'].probe.layout.approach;
  const approachRatio=approach?approach.visible/approach.travel:0;
  gate('threats get at least 55% of the travel axis before contact',
    !!approach&&approach.travel>=150&&approachRatio>=.55,{approach,approachRatio:+approachRatio.toFixed(4)});

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
    schema:1,game:'demon-fist',gameSha256,seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,
    contactSheet:{path:CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{fixture:beat.run,offset:beat.offset,probe:candidate[beat.id].probe}])),
    thresholds:{referenceMedians:ref,bands,actorScale:{fighter:{maxWidth:20,maxHeight:32},standard:{maxWidth:16,maxHeight:28},
      heavy:{maxWidth:18,maxHeight:32},elite:{maxWidth:22,maxHeight:38},footprint:.20,approach:.55,threshold:ACTOR_THRESHOLD},
      quiet:{street:QUIET_STREET_MAX,sides:QUIET_SIDES_MAX}},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,
      playerBurst,eliteBurst,slamBurst,dropBurst,finaleBurst,blockPairs,warningContrast,warningLand,
      launchFx,superFx,dropFx,finaleFx,scrollChecks,quietBeats,bgChecks,
      actorScale:Object.fromEntries(Object.entries(scaleSamples).map(([key,sample])=>[key,
        sample.measurements.map(m=>({id:m.id,kind:m.kind,type:m.type,bounds:m.bounds,drawnPixels:m.drawnPixels,
          clipped:m.clipped,probeOverflow:m.probeOverflow,failures:m.assertion.failures}))])),
      footprints,approach:{probe:approach,ratio:approachRatio},clip:localClip},
    guidelines:{planPairs,bannedTokens:['drawRoute','routeDot','setLineDash','predictIntercept','drawWaypoint','drawPath('],
      bannedHits:bannedOverlaySources},
    gates,automatedOk,semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
  };
  writeJson(METRICS_PATH,report);

  if(CALIBRATE){
    console.log('=== DEMON FIST VISUAL CALIBRATION ===');
    for(const beat of beats){
      const m=candidateMetrics[beat.id];
      console.log(`${beat.id.padEnd(10)} colors ${m.quantizedColors} entropy ${m.colorEntropy} luma ${m.lumaStdDev} largest ${m.largestColorShare} edge1 ${m.edge[1].energy} edge4 ${m.edge[4].energy} rich ${m.richCellFraction} opaque ${m.opaqueFraction}`);
    }
    console.log('reference medians',JSON.stringify(ref));
    console.log('playerBurst',JSON.stringify(playerBurst&&{median:playerBurst.changedFraction.median,firstLast:playerBurst.firstLast.changedFraction,grid:playerBurst.firstLast.changedGridFraction,max:playerBurst.changedFraction.max}));
    console.log('eliteBurst',JSON.stringify(eliteBurst&&{median:eliteBurst.changedFraction.median,firstLast:eliteBurst.firstLast.changedFraction,grid:eliteBurst.firstLast.changedGridFraction,max:eliteBurst.changedFraction.max}));
    console.log('slamBurst',JSON.stringify(slamBurst&&slamBurst.changedFraction));
    console.log('finaleBurst',JSON.stringify(finaleBurst&&finaleBurst.changedFraction));
    console.log('blockPairs',JSON.stringify(blockPairs.map(p=>p.structure.structureDistance)));
    console.log('warningContrast',JSON.stringify(warningContrast));
    console.log('warningLand',JSON.stringify(warningLand));
    console.log('launchFx',JSON.stringify(launchFx));
    console.log('superFx',JSON.stringify(superFx));
    console.log('finaleFx',JSON.stringify(finaleFx));
    console.log('scrollChecks',JSON.stringify(scrollChecks));
    console.log('quietBeats',JSON.stringify(quietBeats));
    console.log('hudPalette',JSON.stringify(hudPalette),'hudStatus',JSON.stringify(hudStatus));
    for(const[key,sample]of Object.entries(scaleSamples)){
      console.log('scale',key,JSON.stringify(sample.measurements.map(m=>({id:m.id,kind:m.kind,w:m.width,h:m.height,bbox:m.bboxArea,clipped:m.clipped,overflow:m.probeOverflow&&m.probeOverflow.any,fail:m.assertion.failures}))));
    }
    console.log('footprints',JSON.stringify(footprints));
    console.log('approach',JSON.stringify({approach,approachRatio}));
  }

  console.log(`DEMON FIST visual evidence · seed 0x${SEED.toString(16)} · game ${gameSha256.slice(0,12)}`);
  for(const value of automatedGates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log(`  ${review.ok?'PASS':'PENDING'} ${semanticGate.name}`);
  for(const value of clipGates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log('  contact:',CONTACT_PATH);
  console.log('  montage sha256:',sheet.sha256);
  console.log('  metrics:',METRICS_PATH);
  console.log('  review template:',REVIEW_TEMPLATE_PATH);
  if(!automatedOk){console.error('\nDEMON FIST AUTOMATED VISUAL GATES FAILED');process.exit(1);}
  if(!review.ok){console.error('\nDEMON FIST AUTOMATED VISUAL GATES PASSED; SEMANTIC REVIEW PENDING');process.exit(1);}
  if(!clipGates.every(value=>value.ok)){console.error('\nDEMON FIST RENDERED CLIP RECEIPT INCOMPLETE');process.exit(1);}
  console.log('\nDEMON FIST VISUAL EVAL PASSED');
}

main().catch(error=>{console.error('DEMON FIST VISUAL EVAL FAILED:',error.stack||error);process.exit(1);});
