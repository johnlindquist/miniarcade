#!/usr/bin/env node
'use strict';

// Real-pixel visual release gate. The shared eval harness intentionally mocks
// Canvas, so this suite boots the same engine/game source into @napi-rs/canvas,
// downsamples the 320x720 backing store to its actual 160x360 viewing size,
// and judges rendered pixels rather than draw-call counts.
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const{createCanvas}=require('../render/node_modules/@napi-rs/canvas');
const{ROOT,seededRandom,inlineScript}=require('./harness');

const ARTIFACTS=path.join(ROOT,'..','.artifacts','swarm-keeper-visual');
const RECEIPTS=path.join(__dirname,'visual-receipts');
fs.mkdirSync(ARTIFACTS,{recursive:true});
fs.mkdirSync(RECEIPTS,{recursive:true});
let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};

function bootPixels(name,seed,footer){
  const html=fs.readFileSync(path.join(ROOT,name+'.html'),'utf8'),
    engine=fs.readFileSync(path.join(ROOT,'engine.js'),'utf8'),
    autoplay=fs.readFileSync(path.join(ROOT,'autoplay.js'),'utf8'),
    wordPuzzle=fs.readFileSync(path.join(ROOT,'word-puzzle.js'),'utf8');
  const canvas=createCanvas(320,720),listeners={},rng=seededRandom(seed),storage=new Map();
  const document={hidden:false,getElementById:()=>canvas,
    createElement:tag=>tag==='canvas'?createCanvas(320,720):{style:{},remove(){},click(){},set src(v){this._src=v;},get src(){return this._src;}},
    addEventListener:(type,fn)=>{listeners[type]=fn;},body:{appendChild(){}},head:{appendChild(node){if(node.onload)node.onload();}}};
  const math=Object.create(Math);math.random=rng;
  const sandbox={console,document,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))},
    location:{search:''},performance,URLSearchParams,Math:math,requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{},
    setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,clearInterval:()=>{},Blob:global.Blob,URL:global.URL};
  sandbox.globalThis=sandbox;sandbox.__NO_UI=1;
  const common=`\n;globalThis.__engine=E;globalThis.__drawNow=()=>render();\n`+(footer||'');
  vm.createContext(sandbox);
  vm.runInContext((engine+'\n'+autoplay+'\n'+wordPuzzle+'\n'+inlineScript(html)).replace(/'use strict';/g,'')+common,sandbox,
    {filename:name+'.visual.js'});
  return{sandbox,canvas,frames:n=>sandbox.__engine.runFrames(n,{render:false})};
}

function nativeFrame(boot,label){
  boot.sandbox.__drawNow();
  const canvas=createCanvas(160,360),ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  ctx.drawImage(boot.canvas,0,0,160,360);
  const data=Buffer.from(canvas.data()),hash=crypto.createHash('sha256').update(data).digest('hex').slice(0,12);
  return{label,canvas,data,hash};
}
const rgb=h=>{const n=parseInt(h.slice(1),16);return[n>>16&255,n>>8&255,n&255];};
const lum=(r,g,b)=>.2126*r+.7152*g+.0722*b;
const sat=(r,g,b)=>Math.max(r,g,b)-Math.min(r,g,b);
function region(frame,x0,y0,x1,y1){
  x0=clampI(x0,0,160);x1=clampI(x1,0,160);y0=clampI(y0,0,360);y1=clampI(y1,0,360);
  let n=0,ls=0,ss=0,bright=0,dark=0,edges=0;const hist=new Map();
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const i=(y*160+x)*4,r=frame.data[i],g=frame.data[i+1],b=frame.data[i+2],l=lum(r,g,b);
    n++;ls+=l;ss+=sat(r,g,b);if(l>185)bright++;if(l<24)dark++;
    const k=(r>>4)*256+(g>>4)*16+(b>>4);hist.set(k,(hist.get(k)||0)+1);
    if(x+1<x1){const j=i+4;if(Math.abs(r-frame.data[j])+Math.abs(g-frame.data[j+1])+Math.abs(b-frame.data[j+2])>66)edges++;}
    if(y+1<y1){const j=i+160*4;if(Math.abs(r-frame.data[j])+Math.abs(g-frame.data[j+1])+Math.abs(b-frame.data[j+2])>66)edges++;}
  }
  let entropy=0;for(const v of hist.values()){const p=v/n;entropy-=p*Math.log2(p);}
  return{pixels:n,meanLum:ls/n,meanSat:ss/n,bright:bright/n,dark:dark/n,unique:hist.size,entropy,edge:edges/(n*2),hist};
}
function clampI(v,a,b){return Math.max(a,Math.min(b,Math.round(v)));}
function histDistance(a,b){
  const keys=new Set([...a.hist.keys(),...b.hist.keys()]);let sum=0;
  for(const k of keys)sum+=Math.abs((a.hist.get(k)||0)/a.pixels-(b.hist.get(k)||0)/b.pixels);
  return sum/2;
}
function colorCount(frame,color,tol,box){
  const [cr,cg,cb]=rgb(color);box=box||[0,0,160,360];let n=0;
  for(let y=box[1];y<box[3];y++)for(let x=box[0];x<box[2];x++){
    const i=(y*160+x)*4;if(Math.abs(frame.data[i]-cr)<=tol&&Math.abs(frame.data[i+1]-cg)<=tol&&Math.abs(frame.data[i+2]-cb)<=tol)n++;
  }return n;
}
function pixelDiff(a,b,box,threshold){
  box=box||[0,0,160,360];threshold=threshold||24;let n=0,total=0;
  for(let y=box[1];y<box[3];y++)for(let x=box[0];x<box[2];x++){
    const i=(y*160+x)*4;total++;
    if(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])>threshold)n++;
  }return{pixels:n,ratio:n/total};
}
function meanColor(frame,box){
  let r=0,g=0,b=0,n=0;for(let y=box[1];y<box[3];y++)for(let x=box[0];x<box[2];x++){
    const i=(y*160+x)*4;r+=frame.data[i];g+=frame.data[i+1];b+=frame.data[i+2];n++;}
  return[r/n,g/n,b/n];
}
const colorDistance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
function save(frame,name){fs.writeFileSync(path.join(ARTIFACTS,name+'.png'),frame.canvas.toBuffer('image/png'));}

const SK_FOOTER=`
globalThis.__pixelMeta=()=>({leader:{x:leader.x,y:sy(leader.y)},members:members.filter(m=>m.state!=='lost').map(m=>({x:m.x,y:sy(m.y),role:m.role,state:m.state}))});
`;
const HZ_FOOTER=`globalThis.__pixelMeta=()=>({leader:{x:aloy.x,y:aloy.y-camY}});`;
const BM_FOOTER=`globalThis.__pixelMeta=()=>({leader:{x:P.x,y:P.y-camY}});`;

console.log('1) deterministic real-canvas receipts at native 160x360');
const openBoot=bootPixels('swarm-keeper',0x6500,SK_FOOTER);openBoot.frames(300);const opening=nativeFrame(openBoot,'OPENING');
const openTwin=bootPixels('swarm-keeper',0x6500,SK_FOOTER);openTwin.frames(300);const twin=nativeFrame(openTwin,'OPENING TWIN');
console.log(`  opening ${opening.hash}, twin ${twin.hash}, ${opening.data.length} RGBA bytes`);
if(opening.hash!==twin.hash)fail('same seed/frame produced different real pixels');
if(opening.data.length!==160*360*4)fail('receipt is not the native 160x360 surface');

const motionBefore=opening;openBoot.frames(8);const motionAfter=nativeFrame(openBoot,'LOCOMOTION');
const bridgeBoot=bootPixels('swarm-keeper',0x6500,SK_FOOTER);bridgeBoot.sandbox.__swarmKeeperVisualFixture('bridge');const bridge=nativeFrame(bridgeBoot,'BRIDGE WORK');
const rescueBoot=bootPixels('swarm-keeper',0x6500,SK_FOOTER);rescueBoot.sandbox.__swarmKeeperVisualFixture('rescue');rescueBoot.frames(18);const rescue=nativeFrame(rescueBoot,'RESCUE DANGER');
const warnBoot=bootPixels('swarm-keeper',0x6500,SK_FOOTER);warnBoot.sandbox.__swarmKeeperSetAct('surge');warnBoot.frames(90);const warning=nativeFrame(warnBoot,'FLOOD WARNING');
const lateBoot=bootPixels('swarm-keeper',0x6500,SK_FOOTER);lateBoot.sandbox.__swarmKeeperVisualFixture('late');const late=nativeFrame(lateBoot,'STAR GARDEN');
const apexBoot=bootPixels('swarm-keeper',0x6500,SK_FOOTER);apexBoot.sandbox.__swarmKeeperVisualFixture('apex');apexBoot.frames(2);const apex=nativeFrame(apexBoot,'ALL ACROSS');
const apexNoFxBoot=bootPixels('swarm-keeper',0x6500,SK_FOOTER);apexNoFxBoot.sandbox.__NO_PAYOFF_FX=1;
apexNoFxBoot.sandbox.__swarmKeeperVisualFixture('apex');apexNoFxBoot.frames(2);const apexNoFx=nativeFrame(apexNoFxBoot,'ALL ACROSS NO FX');

for(const [f,n]of[[opening,'eval-opening'],[bridge,'eval-bridge'],[rescue,'eval-rescue'],[warning,'eval-warning'],[late,'eval-late'],[apex,'eval-apex']])save(f,n);
const sheet=createCanvas(6*160,360),sheetCtx=sheet.getContext('2d');sheetCtx.imageSmoothingEnabled=false;
[opening,bridge,rescue,warning,late,apex].forEach((f,i)=>sheetCtx.drawImage(f.canvas,i*160,0));
fs.writeFileSync(path.join(ARTIFACTS,'eval-contact-sheet.png'),sheet.toBuffer('image/png'));
console.log(`  receipts: ${path.relative(path.join(ROOT,'..'),path.join(ARTIFACTS,'eval-contact-sheet.png'))}`);

console.log('2) reference-calibrated material and focal complexity: MACHINE HUNT + BLOCK MINE floors');
const hzBoot=bootPixels('horizon',0x6500,HZ_FOOTER);hzBoot.frames(3600);const horizon=nativeFrame(hzBoot,'MACHINE HUNT 60S');
const hzLateBoot=bootPixels('horizon',0x6500,HZ_FOOTER);hzLateBoot.frames(10800);const horizonLate=nativeFrame(hzLateBoot,'MACHINE HUNT 3M');
const bmEarlyBoot=bootPixels('blockmine',0x6500,BM_FOOTER);bmEarlyBoot.frames(300);const blockEarly=nativeFrame(bmEarlyBoot,'BLOCK MINE OPEN');
const bmLateBoot=bootPixels('blockmine',0x6500,BM_FOOTER);bmLateBoot.frames(10800);const blockLate=nativeFrame(bmLateBoot,'BLOCK MINE 3M');
const comparison=createCanvas(3*160,2*360),comparisonCtx=comparison.getContext('2d');comparisonCtx.imageSmoothingEnabled=false;
[[opening,horizon,blockEarly],[late,horizonLate,blockLate]].forEach((row,y)=>row.forEach((f,x)=>comparisonCtx.drawImage(f.canvas,x*160,y*360)));
const comparisonPng=comparison.toBuffer('image/png');
fs.writeFileSync(path.join(ARTIFACTS,'reference-contact-sheet.png'),comparisonPng);
fs.writeFileSync(path.join(RECEIPTS,'swarm-keeper-contact-sheet.png'),comparisonPng);
console.log('  comparison: columns SWARM KEEPER / MACHINE HUNT / BLOCK MINE; rows opening / late');
const all={opening:region(opening,0,0,160,360),horizon:region(horizon,0,0,160,360),block:region(blockLate,0,0,160,360),late:region(late,0,0,160,360)};
for(const[k,s]of Object.entries(all))console.log(`  ${k.padEnd(7)} unique ${String(s.unique).padStart(3)}, entropy ${s.entropy.toFixed(2)}, edge ${(s.edge*100).toFixed(1)}%, sat ${s.meanSat.toFixed(1)}, bright ${(s.bright*100).toFixed(1)}%`);
const refUnique=Math.min(all.horizon.unique,all.block.unique),refEntropy=Math.min(all.horizon.entropy,all.block.entropy),refEdge=Math.min(all.horizon.edge,all.block.edge);
if(all.opening.unique<refUnique*.72)fail(`opening quantized palette ${all.opening.unique} below 72% reference floor ${refUnique}`);
if(all.opening.entropy<refEntropy*.9)fail(`opening material entropy ${all.opening.entropy.toFixed(2)} below reference floor`);
if(all.opening.edge<refEdge*.72)fail(`opening edge construction ${(all.opening.edge*100).toFixed(1)}% below reference floor`);
if(all.opening.unique>620||all.opening.entropy>7.2)fail('opening palette is noisy rather than cohesive');

const skMeta=openBoot.sandbox.__pixelMeta(),hzMeta=hzBoot.sandbox.__pixelMeta(),
  skBox=[clampI(skMeta.leader.x-18,0,160),clampI(skMeta.leader.y-25,0,360),clampI(skMeta.leader.x+19,0,160),clampI(skMeta.leader.y+25,0,360)],
  hzBox=[clampI(hzMeta.leader.x-18,0,160),clampI(hzMeta.leader.y-25,0,360),clampI(hzMeta.leader.x+19,0,160),clampI(hzMeta.leader.y+25,0,360)];
const skActor=region(opening,...skBox),hzActor=region(horizon,...hzBox);
console.log(`  focal crop: keeper ${skActor.unique} colors/${(skActor.edge*100).toFixed(1)}% edges vs huntress ${hzActor.unique}/${(hzActor.edge*100).toFixed(1)}%`);
if(skActor.unique<hzActor.unique*.72||skActor.edge<hzActor.edge*.72)fail('keeper/swarm focal construction falls below MACHINE HUNT crop floor');

console.log('3) authored characters: leader, all four role colors, facing details, and locomotion delta');
const leaderPixels=colorCount(opening,'#e2644e',18),roles=['#f2bd55','#72c7ee','#ff796b','#8ee6a8'].map(c=>colorCount(opening,c,14)),
  actorDiff=pixelDiff(motionBefore,motionAfter,skBox,28);
console.log(`  leader coral ${leaderPixels}px; role pixels ${roles.join('/')}; 8f focal delta ${actorDiff.pixels}px (${(actorDiff.ratio*100).toFixed(1)}%)`);
if(leaderPixels<20)fail('authored leader silhouette lacks its dominant coat color');
if(roles.some(n=>n<3))fail(`one or more job roles do not survive native-size rendering: ${roles.join('/')}`);
if(actorDiff.pixels<45||actorDiff.ratio>.72)fail(`locomotion delta ${actorDiff.pixels}px is frozen or unreadably noisy`);

console.log('4) built environment planes: path/ground separation, water material, persistent bridge construction');
const sideColor=meanColor(opening,[3,80,34,325]),roadColor=meanColor(opening,[61,80,101,325]),planeDelta=colorDistance(sideColor,roadColor),
  water=colorCount(bridge,'#285a75',18),wood=colorCount(bridge,'#9a6238',18),foreground=region(opening,0,70,24,350);
console.log(`  side/road color distance ${planeDelta.toFixed(1)}; water ${water}px, built wood ${wood}px; foreground edges ${(foreground.edge*100).toFixed(1)}%`);
if(planeDelta<25)fail('background ground and midground road do not separate at native size');
if(water<500||wood<70)fail(`bridge fixture lacks authored water/plank materials (${water}/${wood}px)`);
if(foreground.edge<.025)fail('foreground foliage plane is visually empty');

console.log('5) visible progression: meadow -> Star Garden must rival BLOCK MINE place change');
const skChange=histDistance(region(opening,0,43,160,360),region(late,0,43,160,360)),
  bmChange=histDistance(region(blockEarly,0,43,160,360),region(blockLate,0,43,160,360));
console.log(`  composition histogram distance keeper ${skChange.toFixed(3)} vs block mine ${bmChange.toFixed(3)}`);
if(skChange<.30||skChange<bmChange*.75)fail('late biome does not produce a BLOCK MINE-scale change of place');
if(pixelDiff(opening,late,[0,43,160,360],35).ratio<.48)fail('late level remains compositionally too similar to the opening');

console.log('6) authored danger and payoff presentation: rescue, warning, and apex pixels land on screen');
// Accepted native-size measurement (2026-07-10, seed 0x6500): rescue changes
// 20.7% of world pixels and contains 210 coral danger pixels; the flood warning
// contains 1,470 exact cyan pixels; the active apex contains 2,166 gold pixels
// versus 29 at the opening, with 108 FX-only pixels overlapping its actors.
// Floors retain margin while still rejecting missing bodies/tethers, a
// translucent-only warning, misplaced particles, or a routine-looking apex.
const rescueCoral=colorCount(rescue,'#ff796b',18),warnBlue=colorCount(warning,'#5eb6d8',18)+colorCount(warning,'#8ad8d1',18),
  apexGold=colorCount(apex,'#ffd166',18),openGold=colorCount(opening,'#ffd166',18),rescueDelta=pixelDiff(opening,rescue,[0,43,160,360],36),
  apexDelta=pixelDiff(bridge,apex,[0,43,160,360],36),apexMeta=apexBoot.sandbox.__pixelMeta(),
  fxNear=pixelDiff(apex,apexNoFx,[clampI(apexMeta.leader.x-42,0,160),clampI(apexMeta.leader.y-58,43,360),
    clampI(apexMeta.leader.x+43,0,160),clampI(apexMeta.leader.y+18,43,360)],12);
console.log(`  rescue coral ${rescueCoral}px/delta ${(rescueDelta.ratio*100).toFixed(1)}%; warning cyan ${warnBlue}px; apex gold ${apexGold}px (opening ${openGold}), delta ${(apexDelta.ratio*100).toFixed(1)}%`);
console.log(`  payoff particles overlap the apex actors at ${fxNear.pixels} native pixels`);
if(rescueCoral<150||rescueDelta.ratio<.18||rescueBoot.sandbox.__swarmKeeperProbe().downed!==1)
  fail('individual rescue danger does not visibly change the native frame');
if(warnBlue<900)fail('flood telegraph is not a dominant pre-land visual instruction');
if(apexGold<openGold+120||apexDelta.ratio<.28)fail('tier-3 payoff lacks authored impact beyond the routine scene');
if(fxNear.pixels<18)fail('payoff particles are missing or projected away from their world actors');
const apexProbe=apexBoot.sandbox.__swarmKeeperProbe();
if(!apexProbe.show.active||apexProbe.show.active.tier!==3)fail('apex receipt was not captured from a real active tier-3 cue');

console.log(failed?'\nVISUAL EVAL FAILED':'\nVISUAL EVAL PASSED');
process.exit(failed?1:0);
