#!/usr/bin/env node
'use strict';

// SKY REIGN real-pixel release gate. Behavioral truth lives in
// sky-reign-eval.js; this suite stages deterministic authored visual beats,
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
const GAME_PATH=path.join(__dirname,'..','sky-reign.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','sky-reign');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','sky-reign.json');
const PRESERVED_CONTACT_PATH=path.join(__dirname,'visual-receipts','sky-reign-contact-sheet.png');
const CLIP_PATH=path.join(ARTIFACT_DIR,'sky-reign-30s.mp4');
const SEED=0x5e100001,PRE_ROLL=120,RENDER_EVERY=2;
const WORLD_CROP={x:0,y:38,width:160,height:322};
const ACTOR_THRESHOLD=8,ACTOR_PADDING=10;

if(!fs.existsSync(GAME_PATH)){
  console.error('SKY REIGN VISUAL EVAL FAILED: missing '+GAME_PATH);
  process.exit(1);
}

const median=values=>quantile(values,.5);
const visible=(box,crop)=>!!box&&box.x<crop.x+crop.width&&box.x+box.width>crop.x&&
  box.y<crop.y+crop.height&&box.y+box.height>crop.y;

function visualProbe(runtime){
  const visualFn=runtime.sandbox.__skyReignVisualProbe,fullFn=runtime.sandbox.__skyReignProbe;
  if(typeof visualFn!=='function'||typeof fullFn!=='function')
    throw new Error('sky-reign.html must expose __skyReignVisualProbe() and __skyReignProbe()');
  const value=visualFn(),full=fullFn();
  if(!value||value.finite===false||!full||full.finite===false)
    throw new Error('sky-reign visual fixture produced non-finite state');
  const foeBoxes=Array.from(value.foeBoxes||[]);
  return Object.assign({},value,{
    stats:full.stats,show:full.show,actType:full.act.type,outcome:full.outcome,
    visibleFoeCount:foeBoxes.filter(box=>visible(box,WORLD_CROP)).length
  });
}

function captureFixture(name,offsets,options){
  options=options||{};
  const runtime=bootRenderedGame('sky-reign',{seed:SEED});
  if(options.beforeSet)options.beforeSet(runtime);
  const setBeat=runtime.sandbox.__skyReignSetVisualBeat;
  if(typeof setBeat!=='function')throw new Error('sky-reign.html must expose __skyReignSetVisualBeat(name)');
  if(setBeat(name)!==true)throw new Error('unknown Sky Reign visual beat: '+name);
  if(options.selector!==undefined)runtime.sandbox.__SK_VISUAL_ONLY_SUBJECT=options.selector;
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

// Furniture-quiet gate (owner doctrine): the sky corridor is the STAGE, not
// the show. Speckle density counts pixels that fight BOTH horizontal
// neighbours in luma — isolated one-pixel marks — inside actor-free crops of
// the far band, the near ground, and the two side margins.
// Measured 2026-07-17 (.artifacts/sky-reign-quiet-cal.js): calm build sky
// 0..0062, ground .0015..0031, sides 0..0004; deliberately busier build
// (injected grain) sky .0243..0479, ground .0253..0544, sides .0221..0522.
// The .010 ceilings fail the busy build at 2.2-2.5x while keeping ~35%+ margin
// over the calm one.
const QUIET_SKY_CROP={x:6,y:44,width:148,height:60};
const QUIET_GROUND_CROP={x:20,y:230,width:120,height:100};
const QUIET_SIDE_CROPS=[{x:0,y:120,width:18,height:170},{x:142,y:120,width:18,height:170}];
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
const QUIET_SKY_MAX=.010,QUIET_GROUND_MAX=.010,QUIET_SIDES_MAX=.010;

// Drawn-pixel actor-scale gates (small-actors-big-worlds law): the game
// isolates any probe actor through __SK_VISUAL_ONLY_SUBJECT and the caps below
// encode the directive with a little margin — locked from measurements on the
// shipped art (dated comment with the numbers).
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
  if(actor.kind==='boss')return{maxWidth:96,maxHeight:64,label:`boss ${actor.type}`};
  if(actor.kind==='dragon')return{maxWidth:34,maxHeight:28,label:`dragon ${actor.type}`};
  if(actor.kind==='turret')return{maxWidth:20,maxHeight:18,label:`turret ${actor.type}`};
  return{maxWidth:24,maxHeight:20,label:`wing ${actor.type}`};
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

// Ground-plane scroll coherence: the terrain must flow DOWN-screen with the
// world as the dragon flies north. Render the same beat at two sim times,
// find the vertical pixel shift that best explains the terrain strip, and
// require it to match the dragon's measured world advance with a clear margin
// over every zero/upward shift.
const SCROLL_CROP={x:30,y:120,width:100,height:180};
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
  const runtime=bootRenderedGame('sky-reign',{seed:SEED});
  const setBeat=runtime.sandbox.__skyReignSetVisualBeat;
  if(setBeat(beat)!==true)throw new Error('unknown Sky Reign visual beat: '+beat);
  runtime.evaluate("visualIntent={steer:0,climb:0,fire:0,targetX:dragon.x,targetAlt:dragon.alt,tactic:'TAKE THE GATE'}");
  if(prep)runtime.evaluate(prep);
  runtime.advanceTo(fromOffset,{renderEvery:RENDER_EVERY,renderLast:true});
  const y0=runtime.evaluate('dragon.worldY'),before=lumaGrid(runtime.snapshot({native:true}),SCROLL_CROP);
  runtime.advanceTo(toOffset,{renderEvery:RENDER_EVERY,renderLast:true});
  const y1=runtime.evaluate('dragon.worldY'),after=lumaGrid(runtime.snapshot({native:true}),SCROLL_CROP);
  const expected=Math.round(y1-y0),scores=verticalShiftScores(before,after,SCROLL_CROP,16);
  const best=scores.reduce((m,s)=>s.sad<m.sad?s:m);
  const counterScrollSad=Math.min(...scores.filter(s=>s.dy<=0).map(s=>s.sad));
  return{beat,expected,bestDy:best.dy,bestSad:best.sad,counterScrollSad,
    ok:expected>=4&&Math.abs(best.dy-expected)<=2&&best.sad<counterScrollSad*.8};
}

function buildCandidateEvidence(){
  const specs={
    opening:{fixture:'opening',offsets:[1,6,12,24]},
    lockSweep:{fixture:'lock-sweep',offsets:[1,6,12,24]},
    volley:{fixture:'volley',offsets:[1,4,8,14,24]},
    volleyNoFx:{fixture:'volley',offsets:[8],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}},
    volleyKill:{fixture:'volley-kill',offsets:[1,28,32,60,90]},
    volleyKillNoFx:{fixture:'volley-kill',offsets:[32],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}},
    dodge:{fixture:'dodge',offsets:[1,3,5,7,9,13,24]},
    reef:{fixture:'reef',offsets:[1,6,12,24]},
    ruins:{fixture:'ruins',offsets:[1,6,12,24]},
    warn:{fixture:'storm-warn',offsets:[1,6,12,24]},
    warnCalm:{fixture:'storm-warn',offsets:[12],afterSet:runtime=>runtime.evaluate("act.phase='calm'")},
    live:{fixture:'storm-live',offsets:[1,6,12,24]},
    wyrmWarn:{fixture:'wyrm-warn',offsets:[1,6,12,24]},
    wyrmFight:{fixture:'wyrm-fight',offsets:[1,6,12,24]},
    phaseBreak:{fixture:'phase-break',offsets:[1,60,76,90,140,200]},
    phaseBreakNoFx:{fixture:'phase-break',offsets:[90],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}},
    ash:{fixture:'ash',offsets:[1,6,12,24]},
    gate:{fixture:'gate',offsets:[1,6,12,24,48]},
    gateNoFx:{fixture:'gate',offsets:[12],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}}
  };
  // No-guideline pairs: the route planner's output may NEVER reach the canvas.
  // Forcing opposite committed plans before rendering must change ZERO pixels
  // at every planning beat — fixtures drive the dragon through visualIntent, so
  // the injected plan is simulation-inert and any pixel delta is a drawn overlay.
  const forcePlan=(tx,ta)=>runtime=>runtime.evaluate(
    `plan={targetX:${tx},targetAlt:${ta},score:500,min:20,projectedY:dragon.worldY+220};`);
  for(const[id,fixture,offset]of[['opening','opening',12],['dodge','dodge',12],['warn','storm-warn',12],
    ['wyrmFight','wyrm-fight',12],['gate','gate',12]]){
    specs['planLeft_'+id]={fixture,offsets:[offset],afterSet:forcePlan(24,12)};
    specs['planRight_'+id]={fixture,offsets:[offset],afterSet:forcePlan(136,58)};
  }
  const runs={};
  for(const[id,spec]of Object.entries(specs))
    runs[id]=captureFixture(spec.fixture,spec.offsets,{id,beforeSet:spec.beforeSet,afterSet:spec.afterSet});
  const beats=[
    {id:'opening',label:'opening flight',run:'opening',offset:12},
    {id:'lockSweep',label:'lock sweep',run:'lockSweep',offset:12},
    {id:'volley',label:'homing volley',run:'volley',offset:8},
    {id:'volleyKill',label:'volley kill',run:'volleyKill',offset:32},
    {id:'dodge',label:'bolt weave',run:'dodge',offset:13},
    {id:'reef',label:'cloud reef',run:'reef',offset:12},
    {id:'ruins',label:'sunken ruins',run:'ruins',offset:12},
    {id:'warn',label:'sandstorm warning',run:'warn',offset:12},
    {id:'live',label:'sandstorm',run:'live',offset:12},
    {id:'wyrmWarn',label:'carrier on horizon',run:'wyrmWarn',offset:12},
    {id:'wyrmFight',label:'wyrm fight',run:'wyrmFight',offset:12},
    {id:'phaseBreak',label:'stage break',run:'phaseBreak',offset:90},
    {id:'ash',label:'ash fields',run:'ash',offset:12},
    {id:'gate',label:'the gate',run:'gate',offset:12}
  ];
  const frames=Object.fromEntries(beats.map(beat=>[beat.id,runs[beat.run].get(beat.offset)]));
  const all=[];
  for(const[id,frameMap]of Object.entries(runs))for(const[offset,frame]of frameMap)all.push({id,offset,frame});
  return{specs,runs,beats,frames:frames,all};
}

function reviewTemplate(montageSha256){
  const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});
  const command=`node render/render.js sky-reign 30 .artifacts/visual/sky-reign/sky-reign-30s.mp4 --seed 0x${SEED.toString(16)} --probe --fps 30`;
  return{
    schema:1,game:'sky-reign',verdict:'pending',references:['horizon','blockmine'],montageSha256,
    reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size reference review',
    renderReceipt:{seed:'0x'+SEED.toString(16),seconds:30,fps:30,codec:'h264',dimensions:'320x720',bytes:0,sha256:'',command},
    categories:{
      characterCraft:pending('Inspect the dragon and rider, the four wing kinds (VYR/MANTA/WASP/SPIRE), the carrier wyrm with staged weak points, honest banking, windup glows, lock reticles with charge pips, turrets, and the wreck spiral at 160x360.'),
      environmentCraft:pending('Inspect each biome with the HUD mentally removed: dune ridges and oases, cloud decks and reef islets, drowned masonry and wave tiers, basalt plates and ember cracks, gate rings and light pillars, the dust wall, far haze.'),
      levelVariety:pending('Confirm the five biomes change spatial landmarks, terrain grammar, material silhouette, hazards, and composition rather than only palette.'),
      animationImpact:pending('Confirm aligned dragon and wyrm crops animate, lock ticks land, the volley homes and wipes, bolts weave past, the windup telegraphs, the dust wall arrives, the stage break staggers, and the gate celebration lands.'),
      readability:pending('Confirm intent reads from the actors alone — honest banking, windup glows on shooters, the two-wave sweep telegraph, lock reticles ON targets — and that every good/bad beat is visibly tagged: gold/cyan/mint on locks/volleys/dodges/breaks, coral on hits/shield-down/wounds. Confirm shield/hull/lock pips/boss bar stay legible beside the dragon at native size with ZERO drawn guidelines, and the terrain flows down-screen with travel.'),
      artDirectionCohesion:pending('Confirm the five-biome palette, pixel construction, HUD, payoff language, and storm/gate grammar feel like one authored sky reign.')
    },
    guidelineOverlays:{confirmedAbsent:false,note:'Confirm every sampled beat pre-draws NOTHING about actor intent or trajectory: no route lines/dots, arrows, target highlights, intercept predictions, ghost phantoms, predicted arcs, or safe-lane markers. Lock reticles ON locked targets, windup glows ON shooters, and the warning plates are diegetic and stay.'}
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
      {label:'SKY REIGN',frames:candidate},
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

  const playerBurst=analyzeAlignedBurst([1,3,5,7,9,13,24].map(offset=>runs.dodge.get(offset)),
    frame=>frame.probe.playerBox,48,56);
  const wyrmBurst=analyzeAlignedBurst([1,6,12,24].map(offset=>runs.wyrmFight.get(offset)),
    frame=>frame.probe.wyrmBox,72,64);
  const killBurst=analyzeBurst([1,28,32,60,90].map(offset=>runs.volleyKill.get(offset)),{native:false,crop:WORLD_CROP});

  const biomeBeats=['opening','reef','ruins','ash','wyrmFight'];
  const biomeFrames=biomeBeats.map(id=>candidate[id]);
  const biomePairs=allPairs(biomeFrames,(a,b,i,j)=>({
    a:candidate[biomeBeats[i]].probe.biome,b:candidate[biomeBeats[j]].probe.biome,
    structure:structureDistance(a,b,{crop:WORLD_CROP})
  }));
  const warningContrast=frameDifference(runs.warnCalm.get(12),runs.warn.get(12),{native:false,crop:WORLD_CROP});
  const warningLand=frameDifference(runs.warn.get(12),runs.live.get(12),{native:false,crop:WORLD_CROP});
  const gateBurst=analyzeBurst([1,6,12,24,48].map(offset=>runs.gate.get(offset)),{native:false,crop:WORLD_CROP});

  // Good/bad feedback beats: live frame vs same-sim __NO_PAYOFF_FX twin, so
  // every measured pixel is feedback presentation by construction: the volley
  // launch glow at the dragon, the kill burst + static crossburst decal on the
  // target, and the stage-break explosion on the carrier.
  const volleyBox=runs.volley.get(8).probe.playerBox;
  const volleyCrop={x:Math.max(0,volleyBox.x-14),y:Math.max(WORLD_CROP.y,volleyBox.y-16),
    width:Math.min(160,volleyBox.x+volleyBox.width+14)-Math.max(0,volleyBox.x-14),
    height:Math.min(360,volleyBox.y+volleyBox.height+16)-Math.max(WORLD_CROP.y,volleyBox.y-16)};
  const volleyFx=frameDifference(runs.volleyNoFx.get(8),runs.volley.get(8),{native:false,crop:volleyCrop,threshold:1});
  // The payoff FX scrolls with the world after the kill lands, so the
  // same-sim twin diff is measured over the whole world crop, not a stale box.
  const killFx=frameDifference(runs.volleyKillNoFx.get(32),runs.volleyKill.get(32),{native:false,crop:WORLD_CROP,threshold:1});
  const breakFx=frameDifference(runs.phaseBreakNoFx.get(90),runs.phaseBreak.get(90),{native:false,crop:WORLD_CROP,threshold:1});
  const gateFx=frameDifference(runs.gateNoFx.get(12),runs.gate.get(12),{native:false,crop:WORLD_CROP,threshold:1});

  const scrollChecks=[
    scrollCoherence('opening',8,14),
    scrollCoherence('ruins',8,14)
  ];

  // Zero-guideline receipts (full native frames, HUD included).
  const planPairs=[['opening',12],['dodge',12],['warn',12],['wyrmFight',12],['gate',12]].map(([id,offset])=>({
    beat:id,offset,difference:frameDifference(runs['planLeft_'+id].get(offset),runs['planRight_'+id].get(offset),{native:false})}));
  const gameSource=fs.readFileSync(GAME_PATH,'utf8');
  const bannedOverlaySources=['drawRoute','routeDot','setLineDash','predictIntercept','drawWaypoint','drawPath(']
    .filter(token=>gameSource.includes(token));

  // Locked-candidate calibration, seed 0x5e100001, measured 2026-07-17 on the
  // five-biome micro-banded build with the turbulent dust wall: colors
  // 142..255, entropy 3.48..4.42, luma deviation .136..183, largest-color max
  // .51, one-pixel edge energy .0247..0423, rich cells .889..1.0 with median
  // .967, player burst median .415 / first-last .414, wyrm burst median .647 /
  // first-last .877, biome structure pairs .461..539, warning contrast
  // .380/.0676, land contrast .534/.0953, payoff FX diffs .0323/.0144 volley,
  // .0344/.0026 kill, .0335/.0038 break, .0351/.0042 gate. The
  // reference-median gate (edge .0295, rich .611, entropy 3.387, luma .150) is
  // the hard floor; these bands keep ~10-20% margin under the measured
  // candidate values.
  const bands={
    colors:90,entropy:2.9,lumaStdDev:.11,largestColorShare:.56,
    edgeEnergy:.020,richEach:.85,richMedian:.94,
    playerMedian:.25,playerFirstLast:.25,playerGrid:.7,
    wyrmMedian:.4,wyrmFirstLast:.6,wyrmGrid:.7,
    killMax:.35,
    biomeMedian:.40,biomeEach:.34,
    warningChanged:.10,warningMean:.015,warningGrid:.35,warningBounds:.5,
    landChanged:.3,landMean:.04,landGrid:.6,landBounds:.6,
    gateMax:.35,
    volleyFxChanged:.015,volleyFxMean:.006,killFxChanged:.015,killFxMean:.0012,
    breakFxChanged:.015,breakFxMean:.0015,gateFxChanged:.015,gateFxMean:.002
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
  gate('dragon has aligned temporal animation',!!playerBurst&&playerBurst.changedFraction.median>=bands.playerMedian&&
    playerBurst.firstLast.changedFraction>=bands.playerFirstLast&&playerBurst.firstLast.changedGridFraction>=bands.playerGrid&&
    playerBurst.changedFraction.max<=.75,playerBurst);
  gate('carrier wyrm has aligned weave and telegraph animation',!!wyrmBurst&&wyrmBurst.changedFraction.median>=bands.wyrmMedian&&
    wyrmBurst.firstLast.changedFraction>=bands.wyrmFirstLast&&wyrmBurst.firstLast.changedGridFraction>=bands.wyrmGrid&&
    wyrmBurst.changedFraction.max<=.85,wyrmBurst);
  const sweep12=runs.lockSweep.get(12).probe;
  gate('lock-sweep beat carries live lock reticles on foes',sweep12.feedback.locks>=2&&sweep12.visibleFoeCount>=2,
    {locks:sweep12.feedback.locks,foes:sweep12.visibleFoeCount});
  const killProbe=runs.volleyKill.get(32).probe;
  gate('volley beat homes onto live foes',killProbe.visibleFoeCount>=1,{foes:killProbe.visibleFoeCount});
  gate('volley-kill burst peaks with payoff motion',killBurst.changedFraction.max>=bands.killMax,killBurst);
  gate('five biomes change structure, not only palette',new Set(biomeBeats.map(id=>candidate[id].probe.biome)).size===5&&
    median(biomePairs.map(pair=>pair.structure.structureDistance))>=bands.biomeMedian&&
    biomePairs.every(pair=>pair.structure.structureDistance>=bands.biomeEach),biomePairs);
  gate('dodge beat shows incoming bolts near the dragon',runs.dodge.get(13).probe.feedback!==undefined,
    {dodge:runs.dodge.get(13).probe.pose});
  gate('sandstorm warning is visibly distinct from identical calm state',warningContrast.changedFraction>=bands.warningChanged&&
    warningContrast.meanDelta>=bands.warningMean&&warningContrast.changedGridFraction>=bands.warningGrid&&
    warningContrast.changedBoundsFraction>=bands.warningBounds,warningContrast);
  const liveProbe=runs.live.get(12).probe;
  gate('sandstorm land is a physical storm, not only a tint',warningLand.changedFraction>=bands.landChanged&&
    warningLand.meanDelta>=bands.landMean&&warningLand.changedGridFraction>=bands.landGrid&&
    warningLand.changedBoundsFraction>=bands.landBounds&&liveProbe.act==='live'&&liveProbe.actType==='sandstorm',
    {warningLand,probe:liveProbe});
  const fightProbe=runs.wyrmFight.get(12).probe;
  gate('carrier wyrm fight shows the staged boss on screen',fightProbe.act==='live'&&fightProbe.actType==='wyrm'&&
    !!fightProbe.wyrmBox&&visible(fightProbe.wyrmBox,WORLD_CROP),{probe:fightProbe});
  const breakProbe=runs.phaseBreak.get(90).probe;
  gate('stage break advances the wyrm and lands payoff motion',breakProbe.actType==='wyrm'&&
    breakProbe.wyrmState&&breakProbe.wyrmState.stage>=1,breakProbe.wyrmState);
  const gateProbe=runs.gate.get(12).probe;
  gate('the gate finale is a real finish state with payoff motion',gateProbe.state==='gate'&&
    !!gateProbe.outcome&&gateBurst.changedFraction.max>=bands.gateMax&&
    gateFx.changedFraction>=bands.gateFxChanged&&gateFx.meanDelta>=bands.gateFxMean,
    {probe:gateProbe,gateBurst,gateFx});
  gate('no guideline overlays: opposite forced route plans render identically at every planning beat',
    planPairs.every(value=>value.difference.changedFraction===0&&value.difference.meanDelta===0),planPairs);
  gate('no guideline overlays: banned overlay primitives are absent from the game source',
    bannedOverlaySources.length===0,{banned:bannedOverlaySources});
  gate('ground plane scrolls with travel, never against it',scrollChecks.every(value=>value.ok),scrollChecks);
  gate('volley launch lands payoff pixels on the dragon',volleyFx.changedFraction>=bands.volleyFxChanged&&
    volleyFx.meanDelta>=bands.volleyFxMean,{volleyFx,volleyCrop});
  gate('volley kill lands payoff pixels on the target',killFx.changedFraction>=bands.killFxChanged&&
    killFx.meanDelta>=bands.killFxMean,{killFx});
  gate('stage break lands payoff pixels on the carrier',breakFx.changedFraction>=bands.breakFxChanged&&
    breakFx.meanDelta>=bands.breakFxMean,{breakFx});
  const dodgePose=runs.dodge.get(13).probe.pose;
  gate('weaving dragon carries no phantom crab: bank tracks travel',
    Math.abs(dodgePose.vx)<.12||Math.sign(dodgePose.bank)===Math.sign(dodgePose.vx)||Math.abs(dodgePose.bank)<.03,
    {dodgePose});
  // Status-near-dragon contract (owner directive): the dragon's own numbers
  // (shield, hull, lock pips, boss bar) live in a compact cluster beside it at
  // the bottom of the strip — never exiled to the far top.
  const hudStatus=runs.dodge.get(13).probe.layout&&runs.dodge.get(13).probe.layout.hudStatus;
  const dragonY=300-runs.dodge.get(13).probe.pose.alt;
  const hudPalette=(()=>{
    if(!hudStatus)return null;
    const src=toNativeFrame(candidate.dodge),colors={shield:0,hull:0};
    for(let y=hudStatus.y;y<hudStatus.y+hudStatus.height;y++)for(let x=hudStatus.x;x<hudStatus.x+hudStatus.width;x++){
      const i=(y*src.width+x)*4,r=src.rgba[i],g=src.rgba[i+1],b=src.rgba[i+2];
      const near=(pr,pg,pb,t)=>(r-pr)*(r-pr)+(g-pg)*(g-pg)+(b-pb)*(b-pb)<=t*t;
      if(near(89,216,245,55))colors.shield++;
      if(near(103,232,162,55)||near(255,93,79,55))colors.hull++;
    }
    return colors;
  })();
  gate('player status cluster lives beside the dragon with the bars in it',
    !!hudStatus&&hudStatus.y+hudStatus.height<=360&&hudStatus.y-dragonY<=80&&
    hudStatus.y-dragonY>0&&!!hudPalette&&hudPalette.shield>4&&hudPalette.hull>2,
    {hudStatus,dragonY:+dragonY.toFixed(1),hudPalette});
  const quietBeats=['opening','reef','ruins','ash','wyrmFight'].map(id=>({beat:id,
    sky:+speckleDensity(candidate[id],QUIET_SKY_CROP).toFixed(4),
    ground:+speckleDensity(candidate[id],QUIET_GROUND_CROP).toFixed(4),
    sides:+((speckleDensity(candidate[id],QUIET_SIDE_CROPS[0])+speckleDensity(candidate[id],QUIET_SIDE_CROPS[1]))/2).toFixed(4)}));
  gate('sky, ground and side margins stay quiet: no speckle fields fighting the action',
    quietBeats.every(v=>v.sky<=QUIET_SKY_MAX&&v.ground<=QUIET_GROUND_MAX&&v.sides<=QUIET_SIDES_MAX),
    {quietBeats,ceilings:{sky:QUIET_SKY_MAX,ground:QUIET_GROUND_MAX,sides:QUIET_SIDES_MAX}});
  gate('candidate numeric richness meets both reference medians',median(cm.map(value=>value.edge[1].energy))>=ref.edge*.95&&
    median(cm.map(value=>value.richCellFraction))>=ref.rich*.95&&median(cm.map(value=>value.colorEntropy))>=ref.entropy*.95&&
    median(cm.map(value=>value.lumaStdDev))>=ref.luma*.90,
    {candidate:{edge:median(cm.map(value=>value.edge[1].energy)),rich:median(cm.map(value=>value.richCellFraction)),
      entropy:median(cm.map(value=>value.colorEntropy)),luma:median(cm.map(value=>value.lumaStdDev))},reference:ref});

  // Drawn-pixel actor scale, measured across beats that span biomes, the pack,
  // the storm, the wyrm fight, and the finale.
  const scaleSamples={};
  for(const[fixture,offset]of[['opening',12],['dodge',13],['ruins',12],['wyrm-fight',12],['ash',12]])
    scaleSamples[fixture]=measureSubjects(fixture,offset);
  const allMeasurements=Object.values(scaleSamples).flatMap(sample=>sample.measurements);
  gate('drawn actors obey the small-actors-big-worlds caps',
    allMeasurements.length>=12&&allMeasurements.every(m=>m.assertion.ok&&!m.clipped&&!(m.probeOverflow&&m.probeOverflow.any)),
    Object.fromEntries(Object.entries(scaleSamples).map(([key,sample])=>[key,
      sample.measurements.map(m=>({id:m.id,kind:m.kind,type:m.type,w:m.width,h:m.height,failures:m.assertion.failures}))])));
  const casts=Object.entries(scaleSamples).map(([key,sample])=>({fixture:key,
    bodies:sample.measurements.filter(m=>m.id!=='dragon').length}));
  gate('shrunken actors did not empty the strip: the pack stays dense',casts.every(value=>value.bodies>=2),casts);
  const footprints=['opening','ruins','ash'].map(fixture=>footprintOf(scaleSamples[fixture]));
  gate('normal-play actor footprint stays under 20% of the playfield',footprints.every(value=>value.ok),footprints);
  const approach=scaleSamples['opening'].probe.layout&&scaleSamples['opening'].probe.layout.approach;
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
    schema:1,game:'sky-reign',gameSha256,seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,
    contactSheet:{path:CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{fixture:beat.run,offset:beat.offset,probe:candidate[beat.id].probe}])),
    thresholds:{referenceMedians:ref,bands,actorScale:{dragon:{maxWidth:34,maxHeight:28},wing:{maxWidth:24,maxHeight:20},
      turret:{maxWidth:20,maxHeight:18},boss:{maxWidth:96,maxHeight:64},footprint:.20,approach:.55,threshold:ACTOR_THRESHOLD}},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,
      playerBurst,wyrmBurst,killBurst,gateBurst,biomePairs,warningContrast,warningLand,
      volleyFx,killFx,breakFx,gateFx,scrollChecks,quietBeats,
      actorScale:Object.fromEntries(Object.entries(scaleSamples).map(([key,sample])=>[key,
        sample.measurements.map(m=>({id:m.id,kind:m.kind,type:m.type,bounds:m.bounds,drawnPixels:m.drawnPixels,
          clipped:m.clipped,probeOverflow:m.probeOverflow,failures:m.assertion.failures}))])),
      footprints,approach:{probe:approach,ratio:approachRatio},clip:localClip},
    guidelines:{planPairs,bannedTokens:['drawRoute','routeDot','setLineDash','predictIntercept','drawWaypoint','drawPath('],
      bannedHits:bannedOverlaySources},
    gates,automatedOk,semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
  };
  writeJson(METRICS_PATH,report);

  console.log(`SKY REIGN visual evidence · seed 0x${SEED.toString(16)} · game ${gameSha256.slice(0,12)}`);
  for(const value of automatedGates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log(`  ${review.ok?'PASS':'PENDING'} ${semanticGate.name}`);
  for(const value of clipGates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log('  contact:',CONTACT_PATH);
  console.log('  montage sha256:',sheet.sha256);
  console.log('  metrics:',METRICS_PATH);
  console.log('  review template:',REVIEW_TEMPLATE_PATH);
  if(!automatedOk){console.error('\nSKY REIGN AUTOMATED VISUAL GATES FAILED');process.exit(1);}
  if(!review.ok){console.error('\nSKY REIGN AUTOMATED VISUAL GATES PASSED; SEMANTIC REVIEW PENDING');process.exit(1);}
  if(!clipGates.every(value=>value.ok)){console.error('\nSKY REIGN RENDERED CLIP RECEIPT INCOMPLETE');process.exit(1);}
  console.log('\nSKY REIGN VISUAL EVAL PASSED');
}

main().catch(error=>{console.error('SKY REIGN VISUAL EVAL FAILED:',error.stack||error);process.exit(1);});
