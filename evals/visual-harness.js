#!/usr/bin/env node
'use strict';

// Real-pixel capture and analysis helpers for SIDE/QUEST visual evals. These
// helpers deliberately compute evidence from rendered RGBA. A game may expose
// checkpoint timing and subject bounds, but it never supplies quality scores.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const{bootGame}=require('./harness');
const{
  NATIVE_WIDTH,NATIVE_HEIGHT,bootRenderedGame,downsampleRgba,rgbaFrame,
  rgbaToCanvas,makeGameCanvas
}=require('../render/runtime');

const REVIEW_CATEGORIES=[
  'characterCraft','environmentCraft','levelVariety','animationImpact','readability','artDirectionCohesion'
];

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const round=(value,digits)=>+value.toFixed(digits===undefined?6:digits);
const luma=(r,g,b)=>0.2126*r+0.7152*g+0.0722*b;

function sha256(data){
  if(typeof data==='string')data=fs.readFileSync(data);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function asFrame(input,options){
  options=options||{};
  if(input&&input.rgba&&Number.isInteger(input.width)&&Number.isInteger(input.height))return input;
  if(input&&typeof input.data==='function'&&Number.isInteger(input.width)&&Number.isInteger(input.height))
    return rgbaFrame(input.data(),input.width,input.height,input.meta);
  if(Buffer.isBuffer(input)||ArrayBuffer.isView(input)){
    const width=options.width,height=options.height;
    if(!Number.isInteger(width)||!Number.isInteger(height))throw new Error('Raw RGBA needs width and height');
    return rgbaFrame(input,width,height,options.meta);
  }
  throw new Error('Expected {rgba,width,height}, a canvas, or raw RGBA with dimensions');
}

function toNativeFrame(input,options){
  const frame=asFrame(input,options);
  if(frame.width===NATIVE_WIDTH&&frame.height===NATIVE_HEIGHT)
    return Object.assign({},frame,{rgba:Buffer.from(frame.rgba),width:NATIVE_WIDTH,height:NATIVE_HEIGHT});
  const sx=frame.width/NATIVE_WIDTH,sy=frame.height/NATIVE_HEIGHT;
  if(sx!==sy||!Number.isInteger(sx)||sx<1)
    throw new Error(`Frame ${frame.width}x${frame.height} is not an integer multiple of 160x360`);
  const native=downsampleRgba(frame.rgba,frame.width,frame.height,sx);
  return Object.assign({},frame,native,{rgba:native.rgba,width:NATIVE_WIDTH,height:NATIVE_HEIGHT});
}

function normalizeCrop(crop,width,height){
  crop=crop||{};
  const x=clamp(Math.floor(crop.x||0),0,width),y=clamp(Math.floor(crop.y||0),0,height);
  const w=clamp(Math.floor(crop.width===undefined?width-x:crop.width),0,width-x);
  const h=clamp(Math.floor(crop.height===undefined?height-y:crop.height),0,height-y);
  if(!w||!h)throw new Error('Crop has no pixels');
  return{x,y,width:w,height:h};
}

function pixelLuma(frame,x,y){
  const i=(y*frame.width+x)*4;
  return luma(frame.rgba[i],frame.rgba[i+1],frame.rgba[i+2]);
}

function quantile(values,q){
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b),p=(sorted.length-1)*q,lo=Math.floor(p),hi=Math.ceil(p);
  return sorted[lo]+(sorted[hi]-sorted[lo])*(p-lo);
}

function edgeStats(frame,crop,scale,threshold){
  let total=0,count=0,strong=0;
  for(let y=crop.y;y<crop.y+crop.height;y++)for(let x=crop.x;x<crop.x+crop.width;x++){
    const a=pixelLuma(frame,x,y);
    if(x+scale<crop.x+crop.width){const d=Math.abs(a-pixelLuma(frame,x+scale,y));total+=d;count++;if(d>=threshold)strong++;}
    if(y+scale<crop.y+crop.height){const d=Math.abs(a-pixelLuma(frame,x,y+scale));total+=d;count++;if(d>=threshold)strong++;}
  }
  return{energy:count?total/count/255:0,density:count?strong/count:0};
}

function spatialRichness(frame,crop,columns,rows,quantBits){
  let rich=0,active=0;
  const cells=[];
  for(let gy=0;gy<rows;gy++)for(let gx=0;gx<columns;gx++){
    const x0=crop.x+Math.floor(gx*crop.width/columns),x1=crop.x+Math.floor((gx+1)*crop.width/columns);
    const y0=crop.y+Math.floor(gy*crop.height/rows),y1=crop.y+Math.floor((gy+1)*crop.height/rows);
    let sum=0,sum2=0,n=0,min=255,max=0;
    const colors=new Set(),shift=8-quantBits;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      const i=(y*frame.width+x)*4,r=frame.rgba[i],g=frame.rgba[i+1],b=frame.rgba[i+2],v=luma(r,g,b);
      sum+=v;sum2+=v*v;n++;min=Math.min(min,v);max=Math.max(max,v);
      colors.add(((r>>shift)<<(quantBits*2))|((g>>shift)<<quantBits)|(b>>shift));
    }
    const deviation=n?Math.sqrt(Math.max(0,sum2/n-(sum/n)**2)):0;
    const isActive=max-min>=5||colors.size>=4,isRich=deviation>=5&&colors.size>=6;
    if(isActive)active++;if(isRich)rich++;
    cells.push({x:gx,y:gy,deviation:round(deviation,3),colors:colors.size,active:isActive,rich:isRich});
  }
  return{richFraction:rich/(columns*rows),activeFraction:active/(columns*rows),cells};
}

function analyzeFrame(input,options){
  options=options||{};
  const frame=options.native===false?asFrame(input,options):toNativeFrame(input,options);
  const crop=normalizeCrop(options.crop,frame.width,frame.height);
  const quantBits=options.quantBits||4,shift=8-quantBits,hist=new Map();
  let n=0,opaque=0,sum=0,sum2=0,saturation=0,largest=0;
  const bandSums=[0,0,0],bandCounts=[0,0,0];
  for(let y=crop.y;y<crop.y+crop.height;y++)for(let x=crop.x;x<crop.x+crop.width;x++){
    const i=(y*frame.width+x)*4,r=frame.rgba[i],g=frame.rgba[i+1],b=frame.rgba[i+2],a=frame.rgba[i+3];
    const v=luma(r,g,b),key=((r>>shift)<<(quantBits*2))|((g>>shift)<<quantBits)|(b>>shift);
    const count=(hist.get(key)||0)+1;hist.set(key,count);largest=Math.max(largest,count);
    sum+=v;sum2+=v*v;saturation+=(Math.max(r,g,b)-Math.min(r,g,b))/255;
    if(a>=250)opaque++;
    const band=Math.min(2,Math.floor((y-crop.y)*3/crop.height));bandSums[band]+=v;bandCounts[band]++;
    n++;
  }
  let entropy=0;
  for(const count of hist.values()){const p=count/n;entropy-=p*Math.log2(p);}
  const mean=sum/n,deviation=Math.sqrt(Math.max(0,sum2/n-mean*mean));
  const scales=options.edgeScales||[1,2,4,8],edges={};
  for(const scale of scales){const stat=edgeStats(frame,crop,scale,options.edgeThreshold||16);
    edges[scale]={energy:round(stat.energy),density:round(stat.density)};}
  const grid=spatialRichness(frame,crop,options.gridColumns||5,options.gridRows||9,quantBits);
  const bandLuma=bandSums.map((value,i)=>round(value/Math.max(1,bandCounts[i]),3));
  return{
    sha256:sha256(frame.rgba),width:frame.width,height:frame.height,crop,pixels:n,
    opaqueFraction:round(opaque/n),meanLuma:round(mean/255),lumaStdDev:round(deviation/255),
    meanSaturation:round(saturation/n),quantizedColors:hist.size,colorEntropy:round(entropy),
    largestColorShare:round(largest/n),edge:edges,
    activeCellFraction:round(grid.activeFraction),richCellFraction:round(grid.richFraction),bandLuma
  };
}

function frameDifference(aInput,bInput,options){
  options=options||{};
  const a=options.native===false?asFrame(aInput,options):toNativeFrame(aInput,options);
  const b=options.native===false?asFrame(bInput,options):toNativeFrame(bInput,options);
  if(a.width!==b.width||a.height!==b.height)throw new Error('Frame dimensions differ');
  const crop=normalizeCrop(options.crop,a.width,a.height),threshold=options.threshold===undefined?12:options.threshold;
  let n=0,changed=0,sum=0,sum2=0,bright=0,dark=0,minX=Infinity,minY=Infinity,maxX=-1,maxY=-1;
  const columns=options.gridColumns||5,rows=options.gridRows||9,cellChanged=new Uint32Array(columns*rows),cellTotal=new Uint32Array(columns*rows);
  for(let y=crop.y;y<crop.y+crop.height;y++)for(let x=crop.x;x<crop.x+crop.width;x++){
    const i=(y*a.width+x)*4,dr=Math.abs(a.rgba[i]-b.rgba[i]),dg=Math.abs(a.rgba[i+1]-b.rgba[i+1]),db=Math.abs(a.rgba[i+2]-b.rgba[i+2]);
    const delta=(dr+dg+db)/3/255,maxDelta=Math.max(dr,dg,db),la=luma(a.rgba[i],a.rgba[i+1],a.rgba[i+2]),lb=luma(b.rgba[i],b.rgba[i+1],b.rgba[i+2]);
    sum+=delta;sum2+=delta*delta;n++;
    const gx=Math.min(columns-1,Math.floor((x-crop.x)*columns/crop.width)),gy=Math.min(rows-1,Math.floor((y-crop.y)*rows/crop.height)),cell=gy*columns+gx;
    cellTotal[cell]++;
    if(maxDelta>=threshold){changed++;cellChanged[cell]++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    if(lb-la>=threshold)bright++;else if(la-lb>=threshold)dark++;
  }
  let changedCells=0;
  for(let i=0;i<cellTotal.length;i++)if(cellTotal[i]&&cellChanged[i]/cellTotal[i]>=0.02)changedCells++;
  const bounds=maxX<0?null:{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1};
  return{
    meanDelta:round(sum/n),rmsDelta:round(Math.sqrt(sum2/n)),changedFraction:round(changed/n),
    brightenedFraction:round(bright/n),darkenedFraction:round(dark/n),
    changedGridFraction:round(changedCells/cellTotal.length),
    changedBounds:bounds,changedBoundsFraction:round(bounds?bounds.width*bounds.height/(crop.width*crop.height):0)
  };
}

// Measure the pixels an actor actually paints by comparing an isolated actor
// render with a same-state clean plate. The probe box is only a search hint:
// the returned bounds always come from native RGBA, and touching the padded
// crop is reported so a too-small probe cannot turn clipping into a false pass.
function measureDrawnActorExtent(actorInput,baselineInput,options){
  options=options||{};
  const actor=options.native===false?asFrame(actorInput,options):toNativeFrame(actorInput,options);
  const baseline=options.native===false?asFrame(baselineInput,options):toNativeFrame(baselineInput,options);
  if(actor.width!==baseline.width||actor.height!==baseline.height)
    throw new Error('Actor and baseline frame dimensions differ');
  const threshold=options.threshold===undefined?8:options.threshold;
  if(typeof threshold!=='number'||!Number.isFinite(threshold)||threshold<0||threshold>255)
    throw new Error('Actor extent threshold must be between 0 and 255');
  const probeBox=options.probeBox||options.box||null,padding=options.padding===undefined?8:options.padding;
  if(typeof padding!=='number'||!Number.isFinite(padding)||padding<0)
    throw new Error('Actor extent padding must be a non-negative number');
  let requestedCrop=options.crop;
  if(!requestedCrop&&probeBox){
    if(![probeBox.x,probeBox.y,probeBox.width,probeBox.height].every(Number.isFinite)||
      !(probeBox.width>0&&probeBox.height>0))throw new Error('Actor probe box must be finite and non-empty');
    const left=Math.floor(probeBox.x-padding),top=Math.floor(probeBox.y-padding);
    const right=Math.ceil(probeBox.x+probeBox.width+padding),bottom=Math.ceil(probeBox.y+probeBox.height+padding);
    requestedCrop={x:left,y:top,width:right-left,height:bottom-top};
  }
  const crop=normalizeCrop(requestedCrop,actor.width,actor.height);
  let drawnPixels=0,minX=Infinity,minY=Infinity,maxX=-1,maxY=-1;
  for(let y=crop.y;y<crop.y+crop.height;y++)for(let x=crop.x;x<crop.x+crop.width;x++){
    const i=(y*actor.width+x)*4;
    const delta=Math.max(Math.abs(actor.rgba[i]-baseline.rgba[i]),
      Math.abs(actor.rgba[i+1]-baseline.rgba[i+1]),Math.abs(actor.rgba[i+2]-baseline.rgba[i+2]),
      Math.abs(actor.rgba[i+3]-baseline.rgba[i+3]));
    if(delta<threshold)continue;
    drawnPixels++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
  }
  const bounds=maxX<0?null:{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1};
  const clipped=!!bounds&&(bounds.x===crop.x||bounds.y===crop.y||
    bounds.x+bounds.width===crop.x+crop.width||bounds.y+bounds.height===crop.y+crop.height);
  let probeOverflow=null;
  if(bounds&&probeBox){
    const left=Math.max(0,Math.floor(probeBox.x)-bounds.x),top=Math.max(0,Math.floor(probeBox.y)-bounds.y);
    const right=Math.max(0,bounds.x+bounds.width-Math.ceil(probeBox.x+probeBox.width));
    const bottom=Math.max(0,bounds.y+bounds.height-Math.ceil(probeBox.y+probeBox.height));
    probeOverflow={left,top,right,bottom,any:left>0||top>0||right>0||bottom>0};
  }
  return{
    id:options.id||null,kind:options.kind||null,type:options.type||null,
    bounds,width:bounds?bounds.width:0,height:bounds?bounds.height:0,
    drawnPixels,bboxArea:bounds?bounds.width*bounds.height:0,
    changedFraction:round(drawnPixels/(crop.width*crop.height)),threshold,crop,
    probeBox:probeBox?Object.assign({},probeBox):null,probeOverflow,clipped
  };
}

// Return structured failures instead of throwing so visual suites can preserve
// the failed measurement in metrics.json. Arrays are accepted as a convenience
// for games that apply one cap to a family of actor variants.
function assertActorScale(measurement,limits){
  limits=limits||{};
  if(Array.isArray(measurement)){
    const results=measurement.map(value=>assertActorScale(value,limits));
    return{ok:results.every(value=>value.ok),failures:results.flatMap(value=>value.failures),results,limits:Object.assign({},limits)};
  }
  const failures=[],label=limits.label||measurement&&measurement.id||measurement&&measurement.type||'actor';
  if(!measurement||!measurement.bounds||measurement.drawnPixels<(limits.minPixels===undefined?1:limits.minPixels))
    failures.push(`${label}: no rendered actor pixels measured`);
  if(measurement&&measurement.bounds){
    if(limits.maxWidth!==undefined&&measurement.width>limits.maxWidth)
      failures.push(`${label}: drawn width ${measurement.width}px > ${limits.maxWidth}px`);
    if(limits.maxHeight!==undefined&&measurement.height>limits.maxHeight)
      failures.push(`${label}: drawn height ${measurement.height}px > ${limits.maxHeight}px`);
    if(limits.allowClipped!==true&&measurement.clipped)failures.push(`${label}: drawn extent touches its measurement crop`);
    if(limits.allowProbeOverflow!==true&&measurement.probeOverflow&&measurement.probeOverflow.any)
      failures.push(`${label}: drawn extent exceeds its probe box`);
  }
  return{ok:failures.length===0,failures,measurement,limits:Object.assign({},limits)};
}

function coarseLuma(frame,crop,columns,rows){
  const values=new Float64Array(columns*rows);
  for(let gy=0;gy<rows;gy++)for(let gx=0;gx<columns;gx++){
    const x0=crop.x+Math.floor(gx*crop.width/columns),x1=crop.x+Math.floor((gx+1)*crop.width/columns);
    const y0=crop.y+Math.floor(gy*crop.height/rows),y1=crop.y+Math.floor((gy+1)*crop.height/rows);
    let sum=0,n=0;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){sum+=pixelLuma(frame,x,y);n++;}
    values[gy*columns+gx]=sum/Math.max(1,n);
  }
  return values;
}

function structureDistance(aInput,bInput,options){
  options=options||{};
  const a=toNativeFrame(aInput,options),b=toNativeFrame(bInput,options);
  if(a.width!==b.width||a.height!==b.height)throw new Error('Frame dimensions differ');
  const crop=normalizeCrop(options.crop,a.width,a.height),columns=options.columns||40,rows=options.rows||90;
  const av=coarseLuma(a,crop,columns,rows),bv=coarseLuma(b,crop,columns,rows);
  let lumaDelta=0,magDelta=0,magUnion=0,directionDelta=0,directionWeight=0,hashChanged=0,hashCount=0;
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++)lumaDelta+=Math.abs(av[y*columns+x]-bv[y*columns+x]);
  for(let y=0;y<rows-1;y++)for(let x=0;x<columns-1;x++){
    const i=y*columns+x,adx=av[i+1]-av[i],ady=av[i+columns]-av[i],bdx=bv[i+1]-bv[i],bdy=bv[i+columns]-bv[i];
    const am=Math.hypot(adx,ady),bm=Math.hypot(bdx,bdy),weight=Math.min(am,bm);
    magDelta+=Math.abs(am-bm);magUnion+=Math.max(am,bm);
    if(weight>2){const cosine=clamp((adx*bdx+ady*bdy)/(am*bm),-1,1);directionDelta+=(1-cosine)*0.5*weight;directionWeight+=weight;}
    if(Math.max(Math.abs(adx),Math.abs(bdx))>3){hashCount++;if((adx>=0)!==(bdx>=0))hashChanged++;}
  }
  const edgeMagnitudeDelta=magUnion?magDelta/magUnion:0,edgeDirectionDelta=directionWeight?directionDelta/directionWeight:0;
  const hashDistance=hashCount?hashChanged/hashCount:0;
  return{
    lumaDistance:round(lumaDelta/(av.length*255)),edgeMagnitudeDistance:round(edgeMagnitudeDelta),
    edgeDirectionDistance:round(edgeDirectionDelta),hashDistance:round(hashDistance),
    structureDistance:round(edgeMagnitudeDelta*0.45+edgeDirectionDelta*0.35+hashDistance*0.20)
  };
}

function analyzeBurst(inputs,options){
  if(!Array.isArray(inputs)||inputs.length<2)throw new Error('A burst needs at least two frames');
  const differences=[];
  for(let i=1;i<inputs.length;i++)differences.push(frameDifference(inputs[i-1],inputs[i],options));
  const field=name=>differences.map(value=>value[name]);
  return{
    frames:inputs.length,pairs:differences.length,differences,
    changedFraction:{min:round(Math.min(...field('changedFraction'))),median:round(quantile(field('changedFraction'),.5)),max:round(Math.max(...field('changedFraction')))},
    meanDelta:{min:round(Math.min(...field('meanDelta'))),median:round(quantile(field('meanDelta'),.5)),max:round(Math.max(...field('meanDelta')))},
    changedGridFraction:{median:round(quantile(field('changedGridFraction'),.5)),max:round(Math.max(...field('changedGridFraction')))},
    peakBrightenedFraction:round(Math.max(...field('brightenedFraction'))),
    peakDarkenedFraction:round(Math.max(...field('darkenedFraction'))),
    firstLast:structureDistance(inputs[0],inputs.at(-1),options)
  };
}

function extractSkyline(input,options){
  options=options||{};
  const frame=toNativeFrame(input,options),crop=normalizeCrop(options.crop,frame.width,frame.height),raw=[];
  const yMin=clamp(options.yMin===undefined?crop.y+1:options.yMin,crop.y+1,crop.y+crop.height-1);
  const yMax=clamp(options.yMax===undefined?crop.y+crop.height-1:options.yMax,yMin,crop.y+crop.height-1);
  for(let x=crop.x;x<crop.x+crop.width;x++){
    let bestY=yMin,best=-1;
    for(let y=yMin;y<=yMax;y++){
      const strength=Math.abs(pixelLuma(frame,x,y)-pixelLuma(frame,x,y-1));
      if(strength>best){best=strength;bestY=y;}
    }
    raw.push(bestY);
  }
  const radius=options.smoothRadius===undefined?2:options.smoothRadius;
  const values=raw.map((_,i)=>quantile(raw.slice(Math.max(0,i-radius),Math.min(raw.length,i+radius+1)),.5));
  const mean=values.reduce((a,b)=>a+b,0)/values.length,slopes=[],curves=[];
  for(let i=1;i<values.length;i++)slopes.push(values[i]-values[i-1]);
  for(let i=1;i<slopes.length;i++)curves.push(slopes[i]-slopes[i-1]);
  const rms=arr=>Math.sqrt(arr.reduce((sum,value)=>sum+value*value,0)/Math.max(1,arr.length));
  return{values,mean:round(mean,3),amplitude:round(Math.max(...values)-Math.min(...values),3),slopeRms:round(rms(slopes),3),curvatureRms:round(rms(curves),3),crop};
}

function skylineDistance(a,b){
  const av=Array.isArray(a)?a:a.values,bv=Array.isArray(b)?b:b.values;
  if(av.length!==bv.length||!av.length)throw new Error('Skyline lengths differ');
  const am=av.reduce((x,y)=>x+y,0)/av.length,bm=bv.reduce((x,y)=>x+y,0)/bv.length;
  let sum=0,slope=0;
  for(let i=0;i<av.length;i++){const d=(av[i]-am)-(bv[i]-bm);sum+=d*d;
    if(i){const sd=(av[i]-av[i-1])-(bv[i]-bv[i-1]);slope+=sd*sd;}}
  return{shapeRms:round(Math.sqrt(sum/av.length),4),slopeRms:round(Math.sqrt(slope/Math.max(1,av.length-1)),4)};
}

function discoverBeatFrame(game,options){
  options=options||{};
  if(typeof options.predicate!=='function')throw new Error('discoverBeatFrame needs a predicate(sandbox, frame)');
  const boot=bootGame(game,{seed:options.seed===undefined?1:options.seed,footer:options.footer||'',search:options.search||''});
  const maxFrames=options.maxFrames||36000,chunk=options.chunk||1;
  let frame=0;
  if(options.predicate(boot.sandbox,frame))return{frame,boot};
  while(frame<maxFrames){const count=Math.min(chunk,maxFrames-frame);boot.frames(count,false);frame+=count;
    if(options.predicate(boot.sandbox,frame))return{frame,boot};}
  throw new Error(`${game}: visual checkpoint not found within ${maxFrames} frames`);
}

function captureBeat(game,options){
  options=options||{};
  const baseFrame=options.frame||0,offsets=options.sampleOffsets||[0,2,6,12];
  if(!Number.isInteger(baseFrame)||baseFrame<0)throw new Error('captureBeat frame must be a non-negative integer');
  if(!offsets.length||offsets.some(offset=>!Number.isInteger(offset)||baseFrame+offset<0))throw new Error('Invalid sample offsets');
  const ordered=[...new Set(offsets)].sort((a,b)=>a-b),earliest=baseFrame+ordered[0],preRoll=options.preRoll===undefined?120:options.preRoll;
  const runtime=bootRenderedGame(game,{seed:options.seed===undefined?1:options.seed,footer:options.footer||'',search:options.search||'',smoothText:!!options.smoothText});
  let coldStop=Math.max(0,earliest-preRoll);
  if(coldStop===earliest&&earliest>0)coldStop--;
  runtime.advanceTo(coldStop);
  const byOffset=new Map(),renderEvery=options.renderEvery||2;
  for(const offset of ordered){
    const target=baseFrame+offset;
    runtime.advanceTo(target,{renderEvery,renderLast:true});
    const frame=runtime.snapshot({native:options.native!==false});
    const meta=typeof options.probe==='function'?options.probe(runtime,target,offset):undefined;
    byOffset.set(offset,Object.assign(frame,{offset,checkpointFrame:baseFrame,meta}));
  }
  const frames=offsets.map(offset=>byOffset.get(offset));
  return{game,seed:runtime.seed,checkpointFrame:baseFrame,preRoll,renderEvery,offsets:[...offsets],frames,
    metrics:frames.map(frame=>analyzeFrame(frame,{native:false,crop:options.crop})),
    burst:frames.length>1?analyzeBurst(frames,{native:false,crop:options.crop}):null,
    finalProbe:typeof options.finalProbe==='function'?options.finalProbe(runtime):undefined};
}

function contactCell(row,beat,index){
  if(Array.isArray(row.frames))return row.frames[index];
  return row.frames&&row.frames[typeof beat==='string'?beat:beat.id];
}

function writeContactSheet(options){
  options=options||{};
  const rows=options.rows||[],beats=options.beats||[];
  if(!rows.length||!beats.length)throw new Error('Contact sheet needs rows and beats');
  const cellWidth=NATIVE_WIDTH,cellHeight=NATIVE_HEIGHT,gap=options.gap===undefined?4:options.gap;
  const labelWidth=options.labelWidth===undefined?84:options.labelWidth,headerHeight=options.headerHeight===undefined?18:options.headerHeight;
  const width=labelWidth+beats.length*cellWidth+(beats.length-1)*gap;
  const height=headerHeight+rows.length*cellHeight+(rows.length-1)*gap;
  const canvas=makeGameCanvas(width,height,{smoothText:false}),ctx=canvas.getContext('2d');
  ctx.imageSmoothingEnabled=false;ctx.fillStyle=options.background||'#080b12';ctx.fillRect(0,0,width,height);
  ctx.font='8px monospace';ctx.textBaseline='middle';ctx.fillStyle=options.labelColor||'#e8ebf2';
  for(let column=0;column<beats.length;column++){
    const beat=beats[column],label=typeof beat==='string'?beat:beat.label||beat.id;
    const x=labelWidth+column*(cellWidth+gap);ctx.fillText(String(label).toUpperCase(),x+3,headerHeight/2);
  }
  for(let rowIndex=0;rowIndex<rows.length;rowIndex++){
    const row=rows[rowIndex],y=headerHeight+rowIndex*(cellHeight+gap);
    ctx.fillStyle=options.labelColor||'#e8ebf2';ctx.fillText(String(row.label||row.id||'').toUpperCase().slice(0,16),4,y+10);
    for(let column=0;column<beats.length;column++){
      const x=labelWidth+column*(cellWidth+gap),value=contactCell(row,beats[column],column);
      if(!value){ctx.fillStyle='#151a25';ctx.fillRect(x,y,cellWidth,cellHeight);continue;}
      const frame=toNativeFrame(value),source=rgbaToCanvas(frame,{smoothText:true});
      ctx.drawImage(source,x,y,cellWidth,cellHeight);
    }
  }
  const png=canvas.encodeSync('png');
  if(options.outPath){fs.mkdirSync(path.dirname(options.outPath),{recursive:true});fs.writeFileSync(options.outPath,png);}
  return{canvas,png,width,height,path:options.outPath||null,sha256:sha256(png)};
}

function getMetric(object,key){return key.split('.').reduce((value,part)=>value===undefined?undefined:value[part],object);}

function checkMetricBands(metrics,bands){
  const failures=[];
  for(const[key,band]of Object.entries(bands||{})){
    const value=getMetric(metrics,key);
    if(typeof value!=='number'||!Number.isFinite(value))failures.push(`${key}: missing numeric value`);
    else if(band.min!==undefined&&value<band.min)failures.push(`${key}: ${value} < ${band.min}`);
    else if(band.max!==undefined&&value>band.max)failures.push(`${key}: ${value} > ${band.max}`);
  }
  return{ok:failures.length===0,failures};
}

function deriveBand(values,options){
  options=options||{};
  if(!values.length||values.some(value=>typeof value!=='number'||!Number.isFinite(value)))throw new Error('deriveBand needs finite numbers');
  const low=quantile(values,options.lowQuantile===undefined ? .1 : options.lowQuantile);
  const high=quantile(values,options.highQuantile===undefined ? .9 : options.highQuantile);
  const padding=options.padding===undefined?Math.max((high-low)*.25,Math.abs((low+high)/2)*.05):options.padding;
  return{min:round(low-padding),max:round(high+padding),samples:values.length};
}

function verifyReviewReceipt(receiptOrPath,options){
  options=options||{};
  const receipt=typeof receiptOrPath==='string'?JSON.parse(fs.readFileSync(receiptOrPath,'utf8')):receiptOrPath;
  const errors=[];
  if(!receipt||receipt.verdict!=='pass')errors.push('review verdict is not pass');
  const refs=new Set(receipt&&receipt.references||[]);
  if(!refs.has('horizon')||!refs.has('blockmine'))errors.push('review must compare horizon and blockmine');
  for(const category of REVIEW_CATEGORIES){
    const grade=receipt&&receipt.categories&&receipt.categories[category];
    if(!grade||grade.meetsMachineHunt!==true||grade.meetsBlockMine!==true)
      errors.push(`${category}: must meet both reference games`);
    if(!grade||typeof grade.note!=='string'||!grade.note.trim())errors.push(`${category}: review note missing`);
  }
  const expectedHash=options.montageSha256||(options.montagePath?sha256(options.montagePath):null);
  if(expectedHash&&receipt&&receipt.montageSha256!==expectedHash)errors.push('review montage hash is stale');
  return{ok:errors.length===0,errors,receipt};
}

function writeJson(outPath,value){
  fs.mkdirSync(path.dirname(outPath),{recursive:true});
  fs.writeFileSync(outPath,JSON.stringify(value,null,2)+'\n');
  return outPath;
}

module.exports={
  REVIEW_CATEGORIES,sha256,asFrame,toNativeFrame,normalizeCrop,quantile,
  analyzeFrame,frameDifference,measureDrawnActorExtent,assertActorScale,
  structureDistance,analyzeBurst,extractSkyline,skylineDistance,
  discoverBeatFrame,captureBeat,writeContactSheet,checkMetricBands,deriveBand,verifyReviewReceipt,writeJson
};
