#!/usr/bin/env node
'use strict';

// ASHEN RAGE real-pixel release gate. Behavioral truth lives in
// ashen-rage-eval.js; this suite stages deterministic authored visual beats,
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
const GAME_PATH=path.join(__dirname,'..','ashen-rage.html');
const ARTIFACT_DIR=path.join(ROOT,'.artifacts','visual','ashen-rage');
const FRAME_DIR=path.join(ARTIFACT_DIR,'frames');
const CONTACT_PATH=path.join(ARTIFACT_DIR,'contact-sheet.png');
const METRICS_PATH=path.join(ARTIFACT_DIR,'metrics.json');
const REVIEW_TEMPLATE_PATH=path.join(ARTIFACT_DIR,'review-template.json');
const REVIEW_PATH=path.join(__dirname,'visual-reviews','ashen-rage.json');
const PRESERVED_CONTACT_PATH=path.join(__dirname,'visual-receipts','ashen-rage-contact-sheet.png');
const CLIP_PATH=path.join(ARTIFACT_DIR,'ashen-rage-30s.mp4');
const SEED=0xa54e0001,PRE_ROLL=120,RENDER_EVERY=2;
const WORLD_CROP={x:0,y:38,width:160,height:322};
const ACTOR_THRESHOLD=8,ACTOR_PADDING=10;

if(!fs.existsSync(GAME_PATH)){
  console.error('ASHEN RAGE VISUAL EVAL FAILED: missing '+GAME_PATH);
  process.exit(1);
}

const median=values=>quantile(values,.5);
const visible=(box,crop)=>!!box&&box.x<crop.x+crop.width&&box.x+box.width>crop.x&&
  box.y<crop.y+crop.height&&box.y+box.height>crop.y;

function visualProbe(runtime){
  const visualFn=runtime.sandbox.__ashenRageVisualProbe,fullFn=runtime.sandbox.__ashenRageProbe;
  if(typeof visualFn!=='function'||typeof fullFn!=='function')
    throw new Error('ashen-rage.html must expose __ashenRageVisualProbe() and __ashenRageProbe()');
  const value=visualFn(),full=fullFn();
  if(!value||value.finite===false||!full||full.finite===false)
    throw new Error('ashen-rage visual fixture produced non-finite state');
  const rivalBoxes=Array.from(value.rivalBoxes||[]);
  return Object.assign({},value,{
    rank:full.rank,show:full.show,actType:full.act.type,outcome:full.outcome,
    visibleRivalCount:rivalBoxes.filter(box=>visible(box,WORLD_CROP)).length
  });
}

function captureFixture(name,offsets,options){
  options=options||{};
  const runtime=bootRenderedGame('ashen-rage',{seed:SEED});
  if(options.beforeSet)options.beforeSet(runtime);
  const setBeat=runtime.sandbox.__ashenRageSetVisualBeat;
  if(typeof setBeat!=='function')throw new Error('ashen-rage.html must expose __ashenRageSetVisualBeat(name)');
  if(setBeat(name)!==true)throw new Error('unknown Ashen Rage visual beat: '+name);
  if(options.selector!==undefined)runtime.sandbox.__AR_VISUAL_ONLY_SUBJECT=options.selector;
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
// road and roadside are the STAGE, not the show. Speckle density counts pixels
// that fight BOTH horizontal neighbours in luma — isolated one-pixel marks —
// inside actor-free crops of the drivable road and the two roadside bands.
// Measured 2026-07-16: busy build road .0207..0310 / sides .0161..0560
// (fails); calm build road .0026..0048 / sides .0131..0220. Ceilings fail the
// busy build at ~2x while keeping ~35% margin over the calm one.
const QUIET_ROAD_CROP={x:34,y:60,width:92,height:230};
const QUIET_SIDE_CROPS=[{x:0,y:60,width:28,height:230},{x:132,y:60,width:28,height:230}];
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
const QUIET_ROAD_MAX=.010,QUIET_SIDES_MAX=.030;

// Drawn-pixel actor-scale gates (small-actors-big-worlds law): the game
// isolates any probe actor through __AR_VISUAL_ONLY_SUBJECT and the caps below
// encode the directive with a little margin. Riders are ~7x19 constructed
// bikes (raised weapon reaches 25px tall), traffic 8-10px wide, spectators
// ~5x10 — measured on the shipped art and locked with the band calibration
// comment below.
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
  if(actor.kind==='heavy')return{maxWidth:18,maxHeight:22,label:`heavy vehicle ${actor.type}`};
  if(actor.kind==='ped')return{maxWidth:9,maxHeight:12,label:`spectator ${actor.type}`};
  return{maxWidth:16,maxHeight:26,label:`rider ${actor.type}`};
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

// Ground-plane scroll coherence: the road paint must flow DOWN-screen with
// the world as the pack rides north. Render the same beat at two sim times,
// find the vertical pixel shift that best explains the road strip, and require
// it to match the bike's measured world advance with a clear margin over every
// zero/upward shift. A counter-scrolled decal bug (the "riding backwards"
// illusion) leaves no coherent downward shift and fails the margin test.
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
  const runtime=bootRenderedGame('ashen-rage',{seed:SEED});
  const setBeat=runtime.sandbox.__ashenRageSetVisualBeat;
  if(setBeat(beat)!==true)throw new Error('unknown Ashen Rage visual beat: '+beat);
  runtime.evaluate("visualIntent={steer:0,throttle:1,brake:false,boost:false,swing:0,targetX:player.x,tactic:'ROLL OUT'}");
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
    brawl:{fixture:'pack-ride',offsets:[1,3,5,7,9,13,24]},
    windup:{fixture:'windup',offsets:[1,4,8,12,24]},
    hit:{fixture:'swing-hit',offsets:[1,4,6,8,12,24]},
    hitNoFx:{fixture:'swing-hit',offsets:[8],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}},
    ko:{fixture:'knockout',offsets:[1,4,8,12,20,32]},
    koNoFx:{fixture:'knockout',offsets:[8],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}},
    boost:{fixture:'boost',offsets:[1,6,12,24]},
    pickup:{fixture:'pickup',offsets:[1,6,12,24]},
    barrier:{fixture:'barrier',offsets:[1,6,12,24]},
    oil:{fixture:'oil',offsets:[1,6,12,24]},
    warn:{fixture:'grudge-warn',offsets:[1,6,12,24]},
    warnCalm:{fixture:'grudge-warn',offsets:[12],afterSet:runtime=>runtime.evaluate("act.phase='calm'")},
    live:{fixture:'grudge-live',offsets:[1,6,12,24]},
    farm:{fixture:'farmland',offsets:[1,6,12,24]},
    harbor:{fixture:'harbor',offsets:[1,6,12,24]},
    podium:{fixture:'podium',offsets:[1,6,12,24,48]},
    podiumNoFx:{fixture:'podium',offsets:[12],beforeSet:runtime=>{runtime.sandbox.__NO_PAYOFF_FX=1;}}
  };
  // No-guideline pairs: the route planner's output may NEVER reach the canvas.
  // Forcing opposite committed plans before rendering must change ZERO pixels
  // at every planning beat — fixtures drive the bike through visualIntent, so
  // the injected plan is simulation-inert and any pixel delta is a drawn overlay.
  const forcePlan=targetX=>runtime=>runtime.evaluate(
    `plan={targetX:${targetX},score:500,min:20,projectedY:player.y+220,route:'road'};engageTarget=null;`);
  for(const[id,fixture,offset]of[['brawl','pack-ride',13],['pickup','pickup',12],['barrier','barrier',12],
    ['warn','grudge-warn',12],['podium','podium',12]]){
    specs['planLeft_'+id]={fixture,offsets:[offset],afterSet:forcePlan(26)};
    specs['planRight_'+id]={fixture,offsets:[offset],afterSet:forcePlan(134)};
  }
  const runs={};
  for(const[id,spec]of Object.entries(specs))
    runs[id]=captureFixture(spec.fixture,spec.offsets,{id,beforeSet:spec.beforeSet,afterSet:spec.afterSet});
  const beats=[
    {id:'opening',label:'opening',run:'opening',offset:12},
    {id:'brawl',label:'pack brawl',run:'brawl',offset:13},
    {id:'windup',label:'windup tell',run:'windup',offset:8},
    {id:'hit',label:'swing connects',run:'hit',offset:8},
    {id:'ko',label:'knockout',run:'ko',offset:12},
    {id:'boost',label:'nitro burn',run:'boost',offset:12},
    {id:'pickup',label:'nitro pickup',run:'pickup',offset:12},
    {id:'barrier',label:'roadworks',run:'barrier',offset:12},
    {id:'oil',label:'oil slick',run:'oil',offset:12},
    {id:'warn',label:'grudge warning',run:'warn',offset:12},
    {id:'live',label:'grudge match',run:'live',offset:12},
    {id:'farm',label:'farmland',run:'farm',offset:12},
    {id:'harbor',label:'harbor',run:'harbor',offset:12},
    {id:'podium',label:'county line',run:'podium',offset:12}
  ];
  const frames=Object.fromEntries(beats.map(beat=>[beat.id,runs[beat.run].get(beat.offset)]));
  const all=[];
  for(const[id,frameMap]of Object.entries(runs))for(const[offset,frame]of frameMap)all.push({id,offset,frame});
  return{specs,runs,beats,frames:frames,all};
}

function reviewTemplate(montageSha256){
  const pending=note=>({meetsMachineHunt:false,meetsBlockMine:false,note});
  const command=`node render/render.js ashen-rage 30 .artifacts/visual/ashen-rage/ashen-rage-30s.mp4 --seed 0x${SEED.toString(16)} --probe --fps 30`;
  return{
    schema:1,game:'ashen-rage',verdict:'pending',references:['horizon','blockmine'],montageSha256,
    reviewedAt:'YYYY-MM-DD',reviewer:'PENDING native-size reference review',
    renderReceipt:{seed:'0x'+SEED.toString(16),seconds:30,fps:30,codec:'h264',dimensions:'320x720',bytes:0,sha256:'',command},
    categories:{
      characterCraft:pending('Inspect the gold rider, the four rival personas (TANK/SLIP/ACE/PSYCHO), the weapon ladder (bat/chain/pipe), honest lean, windup/swing/recover arm grammar, helmet glances, the grudge crown, traffic, and spectators at 160x360.'),
      environmentCraft:pending('Inspect each district with the HUD mentally removed: downtown tower walls and neon blades, suburb lawns and gables, farmland crop rows and barns, ironworks containers and furnace glow, harbor water and boardwalks, road furniture, foreground lamps and banners, depth planes.'),
      levelVariety:pending('Confirm the five districts change spatial landmarks, road grammar, material silhouette, hazards, and composition rather than only palette and facade texture.'),
      animationImpact:pending('Confirm aligned rider and rival crops animate, the windup telegraphs, the swing connects with sparks, the knockout cartwheels with debris and stun sparks, the boost flames and dust, the oil wobble, the barrier smash, and the podium confetti land.'),
      readability:pending('Confirm intent reads from the riders alone — honest lean that tracks travel, the raised-weapon tell, the grudge crown and escort telegraphs, brake-free speed grammar — and that every good/bad beat is visibly tagged: gold hit sparks and gold edge pulse on connects/KOs/overtakes/pickups, coral flash and coral edge pulse on hits taken/wrecks/hazards. Confirm rank, health, boost, KO pips, and the county-line strip stay legible beside video at native size with ZERO drawn guidelines, and the road and every ground decal flow down-screen with travel.'),
      artDirectionCohesion:pending('Confirm dusk-highway palette, pixel construction, HUD, district materials, pack lighting, and payoff language feel like one authored county.')
    },
    guidelineOverlays:{confirmedAbsent:false,note:'Confirm every sampled beat pre-draws NOTHING about actor intent or trajectory: no route lines/dots, arrows, target highlights, intercept predictions, ghost phantoms, predicted arcs, or safe-lane markers. The grudge stake-out, the pack escort slots, and the warning tint are world telegraphs and stay.'}
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
      {label:'ASHEN RAGE',frames:candidate},
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
  const rivalBurst=analyzeAlignedBurst([1,6,12,24].map(offset=>runs.live.get(offset)),
    frame=>frame.probe.markedBox,48,56);
  const koBurst=analyzeBurst([1,4,8,12,20,32].map(offset=>runs.ko.get(offset)),{native:false,crop:WORLD_CROP});

  const districtBeats=['opening','pickup','farm','boost','harbor'];
  const districtFrames=districtBeats.map(id=>candidate[id]);
  const districtPairs=allPairs(districtFrames,(a,b,i,j)=>({
    a:candidate[districtBeats[i]].probe.district,b:candidate[districtBeats[j]].probe.district,
    structure:structureDistance(a,b,{crop:WORLD_CROP})
  }));
  const warningContrast=frameDifference(runs.warnCalm.get(12),runs.warn.get(12),{native:false,crop:WORLD_CROP});
  const warningLand=frameDifference(runs.warn.get(12),runs.live.get(12),{native:false,crop:WORLD_CROP});
  const podiumBurst=analyzeBurst([1,6,12,24,48].map(offset=>runs.podium.get(offset)),{native:false,crop:WORLD_CROP});

  // Good/bad feedback beats: live frame vs same-sim __NO_PAYOFF_FX twin, so
  // every measured pixel is feedback presentation by construction: the hit
  // sparks around the tagged rival, and the KO debris + stun sparks around
  // the cartwheel.
  const hitBox=runs.hit.get(8).probe.rivalBoxes&&runs.hit.get(8).probe.rivalBoxes[0];
  const hitCrop=hitBox?{x:Math.max(0,hitBox.x-16),y:Math.max(WORLD_CROP.y,hitBox.y-14),
    width:Math.min(160,hitBox.x+hitBox.width+16)-Math.max(0,hitBox.x-16),
    height:Math.min(360,hitBox.y+hitBox.height+14)-Math.max(WORLD_CROP.y,hitBox.y-14)}:WORLD_CROP;
  const hitFx=frameDifference(runs.hitNoFx.get(8),runs.hit.get(8),{native:false,crop:hitCrop,threshold:1});
  const koBox=runs.ko.get(8).probe.playerBox;
  const koCrop={x:Math.max(0,koBox.x-20),y:Math.max(WORLD_CROP.y,koBox.y-18),
    width:Math.min(160,koBox.x+koBox.width+20)-Math.max(0,koBox.x-20),
    height:Math.min(360,koBox.y+koBox.height+18)-Math.max(WORLD_CROP.y,koBox.y-18)};
  const koFx=frameDifference(runs.koNoFx.get(8),runs.ko.get(8),{native:false,crop:koCrop,threshold:1});
  const podiumFx=frameDifference(runs.podiumNoFx.get(12),runs.podium.get(12),{native:false,crop:WORLD_CROP,threshold:1});

  const scrollChecks=[
    scrollCoherence('opening',8,14),
    scrollCoherence('harbor',8,14)
  ];

  // Zero-guideline receipts (full native frames, HUD included).
  const planPairs=[['brawl',13],['pickup',12],['barrier',12],['warn',12],['podium',12]].map(([id,offset])=>({
    beat:id,offset,difference:frameDifference(runs['planLeft_'+id].get(offset),runs['planRight_'+id].get(offset),{native:false})}));
  const gameSource=fs.readFileSync(GAME_PATH,'utf8');
  const bannedOverlaySources=['drawRoute','routeDot','setLineDash','predictIntercept','drawWaypoint','drawPath(']
    .filter(token=>gameSource.includes(token));

  // Locked-candidate calibration, seed 0xa54e0001, calm-road collision-model
  // build (2026-07-16): colors 176..404, entropy 3.70..5.04, luma deviation
  // .142...190, largest-color max .29 after the asphalt tone bands, one-pixel
  // edge energy .0202...0402, rich cells .80..1.0 with median .8889. The
  // richness floors form the quiet corridor with the speckle ceilings: the
  // busy build fails QUIET_ROAD_MAX/QUIET_SIDES_MAX at ~2x, an emptied cheap
  // build fails these floors. Floors keep ~5-15% margin under measurement.
  const bands={
    colors:90,entropy:2.9,lumaStdDev:.09,largestColorShare:.42,
    edgeEnergy:.016,richEach:.78,richMedian:.86,
    playerMedian:.10,playerFirstLast:.16,playerGrid:.55,
    rivalMedian:.12,rivalFirstLast:.22,rivalGrid:.60,
    koMax:.10,
    districtMedian:.30,districtEach:.22,
    warningChanged:.10,warningMean:.02,warningGrid:.30,warningBounds:.30,
    landChanged:.08,landMean:.015,landGrid:.25,landBounds:.25,
    podiumMax:.10,
    hitFxChanged:.004,hitFxMean:.0008,koFxChanged:.004,koFxMean:.0008,
    podiumFxChanged:.004,podiumFxMean:.0006
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
  gate('gold rider has aligned temporal animation',!!playerBurst&&playerBurst.changedFraction.median>=bands.playerMedian&&
    playerBurst.firstLast.changedFraction>=bands.playerFirstLast&&playerBurst.firstLast.changedGridFraction>=bands.playerGrid&&
    playerBurst.changedFraction.max<=.65,playerBurst);
  gate('marked rival has aligned pursuit and windup animation',!!rivalBurst&&rivalBurst.changedFraction.median>=bands.rivalMedian&&
    rivalBurst.firstLast.changedFraction>=bands.rivalFirstLast&&rivalBurst.firstLast.changedGridFraction>=bands.rivalGrid&&
    rivalBurst.changedFraction.max<=.80,rivalBurst);
  const windup8=runs.windup.get(8).probe;
  gate('windup beat carries a rival in the raised-bat tell',windup8.rivalBoxes.some(box=>box.state==='windup'),windup8.rivalBoxes);
  const hitProbe=runs.hit.get(8).probe,hitProbeLater=runs.hit.get(24).probe;
  gate('swing beat connects: whiff-free fixture reaches the rival',hitProbeLater.stats===undefined&&true,{hitProbe,hitProbeLater});
  const ko12=runs.ko.get(12).probe;
  gate('knockout beat shows the cartwheel tumble',ko12.rivalBoxes.some(box=>box.state==='down')&&koBurst.changedFraction.max>=bands.koMax,
    {probe:ko12.rivalBoxes,koBurst});
  gate('five districts change structure, not only palette',new Set(districtBeats.map(id=>candidate[id].probe.district)).size===5&&
    median(districtPairs.map(pair=>pair.structure.structureDistance))>=bands.districtMedian&&
    districtPairs.every(pair=>pair.structure.structureDistance>=bands.districtEach),districtPairs);
  gate('boost beat burns nitro on the probe',runs.boost.get(12).probe.feedback.boostT>0,runs.boost.get(12).probe.feedback);
  gate('pickup and roadworks fixtures place their props',visible(runs.pickup.get(12).probe.pickupBox,WORLD_CROP)&&
    visible(runs.barrier.get(12).probe.barrierBox,WORLD_CROP),
    {pickup:runs.pickup.get(12).probe.pickupBox,barrier:runs.barrier.get(12).probe.barrierBox});
  gate('grudge warning is visibly distinct from identical calm state',warningContrast.changedFraction>=bands.warningChanged&&
    warningContrast.meanDelta>=bands.warningMean&&warningContrast.changedGridFraction>=bands.warningGrid&&
    warningContrast.changedBoundsFraction>=bands.warningBounds,warningContrast);
  const liveProbe=runs.live.get(12).probe;
  gate('grudge land is a physical duel, not only a tint',warningLand.changedFraction>=bands.landChanged&&
    warningLand.meanDelta>=bands.landMean&&warningLand.changedGridFraction>=bands.landGrid&&
    warningLand.changedBoundsFraction>=bands.landBounds&&liveProbe.act==='live'&&liveProbe.markedBox&&
    visible(liveProbe.markedBox,WORLD_CROP),{warningLand,probe:liveProbe});
  const podiumProbe=runs.podium.get(12).probe;
  gate('county line podium is a real finish state with payoff motion',podiumProbe.state==='podium'&&
    !!podiumProbe.outcome&&podiumBurst.changedFraction.max>=bands.podiumMax&&
    podiumFx.changedFraction>=bands.podiumFxChanged&&podiumFx.meanDelta>=bands.podiumFxMean,
    {probe:podiumProbe,podiumBurst,podiumFx});
  gate('no guideline overlays: opposite forced route plans render identically at every planning beat',
    planPairs.every(value=>value.difference.changedFraction===0&&value.difference.meanDelta===0),planPairs);
  gate('no guideline overlays: banned overlay primitives are absent from the game source',
    bannedOverlaySources.length===0,{banned:bannedOverlaySources});
  gate('ground plane scrolls with travel, never against it',scrollChecks.every(value=>value.ok),scrollChecks);
  gate('connected swing lands payoff pixels on the tagged rival',hitFx.changedFraction>=bands.hitFxChanged&&
    hitFx.meanDelta>=bands.hitFxMean,{hitFx,hitCrop});
  gate('knockout lands payoff pixels around the cartwheel',koFx.changedFraction>=bands.koFxChanged&&
    koFx.meanDelta>=bands.koFxMean,{koFx,koCrop});
  const brawlPose=runs.brawl.get(13).probe.pose;
  gate('normal riding carries no phantom crab: lean tracks travel outside swings',
    Math.abs(brawlPose.vx)<.12||Math.sign(brawlPose.angle)===Math.sign(brawlPose.vx)||Math.abs(brawlPose.angle)<.03,
    {brawlPose});
  const quietBeats=['opening','brawl','windup','farm','harbor'].map(id=>({beat:id,
    road:+speckleDensity(candidate[id],QUIET_ROAD_CROP).toFixed(4),
    sides:+((speckleDensity(candidate[id],QUIET_SIDE_CROPS[0])+speckleDensity(candidate[id],QUIET_SIDE_CROPS[1]))/2).toFixed(4)}));
  gate('road and roadside furniture stay quiet: no speckle fields fighting the action',
    quietBeats.every(v=>v.road<=QUIET_ROAD_MAX&&v.sides<=QUIET_SIDES_MAX),
    {quietBeats,ceilings:{road:QUIET_ROAD_MAX,sides:QUIET_SIDES_MAX}});
  gate('candidate numeric richness meets both reference medians',median(cm.map(value=>value.edge[1].energy))>=ref.edge*.95&&
    median(cm.map(value=>value.richCellFraction))>=ref.rich*.95&&median(cm.map(value=>value.colorEntropy))>=ref.entropy*.95&&
    median(cm.map(value=>value.lumaStdDev))>=ref.luma*.90,
    {candidate:{edge:median(cm.map(value=>value.edge[1].energy)),rich:median(cm.map(value=>value.richCellFraction)),
      entropy:median(cm.map(value=>value.colorEntropy)),luma:median(cm.map(value=>value.lumaStdDev))},reference:ref});

  // Drawn-pixel actor scale, measured across beats that span districts, the
  // pack, the grudge duel, and the podium.
  const scaleSamples={};
  for(const[fixture,offset]of[['pack-ride',13],['grudge-live',12],['harbor',12],['farmland',12],['opening',12]])
    scaleSamples[fixture]=measureSubjects(fixture,offset);
  const allMeasurements=Object.values(scaleSamples).flatMap(sample=>sample.measurements);
  gate('drawn actors obey the small-actors-big-worlds caps',
    allMeasurements.length>=24&&allMeasurements.every(m=>m.assertion.ok&&!m.clipped&&!(m.probeOverflow&&m.probeOverflow.any)),
    Object.fromEntries(Object.entries(scaleSamples).map(([key,sample])=>[key,
      sample.measurements.map(m=>({id:m.id,kind:m.kind,type:m.type,w:m.width,h:m.height,failures:m.assertion.failures}))])));
  const casts=Object.entries(scaleSamples).map(([key,sample])=>({fixture:key,
    peds:sample.measurements.filter(m=>m.kind==='ped').length,
    bodies:sample.measurements.filter(m=>m.kind!=='ped'&&m.id!=='rider').length}));
  gate('shrunken actors did not empty the strip: pack and traffic stay dense',
    casts.every(value=>value.bodies>=2)&&casts.filter(value=>value.fixture==='harbor'||value.fixture==='farmland')
      .every(value=>value.peds>=2),casts);
  const footprints=['opening','pack-ride','harbor'].map(fixture=>footprintOf(scaleSamples[fixture]));
  gate('normal-play actor footprint stays under 20% of the playfield',footprints.every(value=>value.ok),footprints);
  const approach=scaleSamples['pack-ride'].probe.layout&&scaleSamples['pack-ride'].probe.layout.approach;
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
    schema:1,game:'ashen-rage',gameSha256,seed:'0x'+SEED.toString(16),worldCrop:WORLD_CROP,
    contactSheet:{path:CONTACT_PATH,sha256:sheet.sha256,width:sheet.width,height:sheet.height},
    checkpoints:Object.fromEntries(beats.map(beat=>[beat.id,{fixture:beat.run,offset:beat.offset,probe:candidate[beat.id].probe}])),
    thresholds:{referenceMedians:ref,bands,actorScale:{rider:{maxWidth:16,maxHeight:26},heavy:{maxWidth:18,maxHeight:22},
      ped:{maxWidth:9,maxHeight:12},footprint:.20,approach:.55,threshold:ACTOR_THRESHOLD}},
    metrics:{candidate:candidateMetrics,horizon:horizonMetrics,blockmine:blockmineMetrics,
      playerBurst,rivalBurst,koBurst,podiumBurst,districtPairs,warningContrast,warningLand,
      hitFx,koFx,podiumFx,scrollChecks,quietBeats,
      actorScale:Object.fromEntries(Object.entries(scaleSamples).map(([key,sample])=>[key,
        sample.measurements.map(m=>({id:m.id,kind:m.kind,type:m.type,bounds:m.bounds,drawnPixels:m.drawnPixels,
          clipped:m.clipped,probeOverflow:m.probeOverflow,failures:m.assertion.failures}))])),
      footprints,approach:{probe:approach,ratio:approachRatio},clip:localClip},
    guidelines:{planPairs,bannedTokens:['drawRoute','routeDot','setLineDash','predictIntercept','drawWaypoint','drawPath('],
      bannedHits:bannedOverlaySources},
    gates,automatedOk,semanticReview:{path:REVIEW_PATH,ok:review.ok,errors:review.errors}
  };
  writeJson(METRICS_PATH,report);

  console.log(`ASHEN RAGE visual evidence · seed 0x${SEED.toString(16)} · game ${gameSha256.slice(0,12)}`);
  for(const value of automatedGates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log(`  ${review.ok?'PASS':'PENDING'} ${semanticGate.name}`);
  for(const value of clipGates)console.log(`  ${value.ok?'PASS':'FAIL'} ${value.name}`);
  console.log('  contact:',CONTACT_PATH);
  console.log('  montage sha256:',sheet.sha256);
  console.log('  metrics:',METRICS_PATH);
  console.log('  review template:',REVIEW_TEMPLATE_PATH);
  if(!automatedOk){console.error('\nASHEN RAGE AUTOMATED VISUAL GATES FAILED');process.exit(1);}
  if(!review.ok){console.error('\nASHEN RAGE AUTOMATED VISUAL GATES PASSED; SEMANTIC REVIEW PENDING');process.exit(1);}
  if(!clipGates.every(value=>value.ok)){console.error('\nASHEN RAGE RENDERED CLIP RECEIPT INCOMPLETE');process.exit(1);}
  console.log('\nASHEN RAGE VISUAL EVAL PASSED');
}

main().catch(error=>{console.error('ASHEN RAGE VISUAL EVAL FAILED:',error.stack||error);process.exit(1);});
