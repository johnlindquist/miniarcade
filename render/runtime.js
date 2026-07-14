'use strict';

// Reusable real-pixel runtime for offline rendering and visual evals. Each
// boot gets an isolated VM and its own seeded Math.random stream, while canvas
// drawing uses the exact @napi-rs/canvas + pixel-font path used by render.js.
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const{inlineScript,needsAutoplay,needsWordPuzzle,gameSource:discoverGameSource,executeScripts}=require('../game-source');

let canvasApi;
try{
  // Resolution starts beside this file, so `npm --prefix render ci` is enough;
  // callers under here-now/evals do not need a second node_modules tree.
  canvasApi=require('@napi-rs/canvas');
}catch(error){
  if(error&&error.code==='MODULE_NOT_FOUND'){
    const wrapped=new Error('Real-pixel rendering requires @napi-rs/canvas. Run: npm --prefix render ci');
    wrapped.cause=error;
    throw wrapped;
  }
  throw error;
}

const{createCanvas,GlobalFonts,ImageData}=canvasApi;
const GAME_ROOT=(()=>{const nested=path.join(__dirname,'..','here-now');return fs.existsSync(nested)?nested:path.join(__dirname,'..');})();
const DEVICE_WIDTH=320,DEVICE_HEIGHT=720,NATIVE_WIDTH=160,NATIVE_HEIGHT=360;
const PIXEL_FONT_FAMILY='SidequestPixel';
const PIXEL_FONT_PATH=path.join(__dirname,'fonts','Silkscreen-Regular.ttf');
let pixelFontReady;

function seededRandom(seed){
  let s=(Number(seed)>>>0)||1;
  return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);
    t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
}

function ensurePixelFont(){
  if(pixelFontReady!==undefined)return pixelFontReady;
  if(!fs.existsSync(PIXEL_FONT_PATH))return(pixelFontReady=false);
  GlobalFonts.registerFromPath(PIXEL_FONT_PATH,PIXEL_FONT_FAMILY);
  return(pixelFontReady=true);
}

function fontPx(font){
  const m=String(font||'').match(/(\d+(?:\.\d+)?)px/);
  return m?Math.max(1,+m[1]):10;
}

function toPixelFont(font,devicePx){
  return String(font||'10px monospace')
    .replace(/\bbold\s+/ig,'')
    .replace(/[\d.]+px/,Math.max(8,devicePx)+'px')
    .replace(/monospace|"?Courier New"?|"?Menlo"?|"?Monaco"?/ig,'"'+PIXEL_FONT_FAMILY+'"');
}

function patchPixelText(ctx){
  ctx.imageSmoothingEnabled=false;
  if('imageSmoothingQuality' in ctx)ctx.imageSmoothingQuality='low';
  if(!ensurePixelFont())return;
  const rawFill=ctx.fillText.bind(ctx);
  const rawStroke=typeof ctx.strokeText==='function'?ctx.strokeText.bind(ctx):null;
  function drawPixel(kind,text,x,y,maxWidth){
    text=String(text??'');
    if(!text)return;
    const m=typeof ctx.getTransform==='function'?ctx.getTransform():{a:1,b:0,c:0,d:1,e:0,f:0};
    const sy=Math.max(0.001,Math.abs(m.d)||Math.hypot(m.c,m.d));
    const devicePx=Math.round(fontPx(ctx.font)*sy);
    const dx=Math.round(m.a*x+m.c*y+m.e),dy=Math.round(m.b*x+m.d*y+m.f);
    const prevFont=ctx.font;
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.imageSmoothingEnabled=false;
    ctx.font=toPixelFont(prevFont,devicePx);
    ctx.textAlign=ctx.textAlign||'left';
    ctx.textBaseline=ctx.textBaseline||'alphabetic';
    if(kind==='stroke'&&rawStroke){
      if(maxWidth===undefined)rawStroke(text,dx,dy);
      else rawStroke(text,dx,dy,maxWidth*sy);
    }else if(maxWidth===undefined)rawFill(text,dx,dy);
    else rawFill(text,dx,dy,maxWidth*sy);
    ctx.restore();
  }
  ctx.fillText=(text,x,y,maxWidth)=>drawPixel('fill',text,x,y,maxWidth);
  if(rawStroke)ctx.strokeText=(text,x,y,maxWidth)=>drawPixel('stroke',text,x,y,maxWidth);
  ctx.__rawFillText=rawFill;
}

function makeGameCanvas(width, height, options){
  options=options||{};
  const canvas=createCanvas(width||DEVICE_WIDTH,height||DEVICE_HEIGHT);
  const rawGet=canvas.getContext.bind(canvas);
  canvas.getContext=(type,attrs)=>{
    const ctx=rawGet(type,attrs);
    if(ctx&&type==='2d'&&!ctx.__pixelTextPatched&&!options.smoothText){
      patchPixelText(ctx);
      ctx.__pixelTextPatched=true;
    }
    return ctx;
  };
  return canvas;
}

function rgbaFrame(rgba,width,height,meta){
  if(!rgba||rgba.length!==width*height*4)throw new Error(`RGBA length does not match ${width}x${height}`);
  return Object.assign({rgba:Buffer.from(rgba),width,height},meta||{});
}

function downsampleRgba(rgba,width,height,scale){
  scale=scale||2;
  if(!Number.isInteger(scale)||scale<1||width%scale||height%scale)
    throw new Error(`Cannot downsample ${width}x${height} by ${scale}`);
  const outWidth=width/scale,outHeight=height/scale,out=Buffer.allocUnsafe(outWidth*outHeight*4);
  for(let y=0;y<outHeight;y++)for(let x=0;x<outWidth;x++){
    const src=((y*scale)*width+x*scale)*4,dst=(y*outWidth+x)*4;
    out[dst]=rgba[src];out[dst+1]=rgba[src+1];out[dst+2]=rgba[src+2];out[dst+3]=rgba[src+3];
  }
  return rgbaFrame(out,outWidth,outHeight);
}

function rgbaToCanvas(frame,options){
  const canvas=makeGameCanvas(frame.width,frame.height,options);
  const ctx=canvas.getContext('2d');
  const data=new Uint8ClampedArray(frame.rgba.buffer,frame.rgba.byteOffset,frame.rgba.byteLength);
  ctx.putImageData(new ImageData(data,frame.width,frame.height),0,0);
  return canvas;
}

function encodeRgbaPng(frame){
  return rgbaToCanvas(frame,{smoothText:true}).encodeSync('png');
}

function gameSource(name,root){return discoverGameSource(name,root||GAME_ROOT);}

function eventTarget(){
  const listeners=new Map();
  function addEventListener(type,listener){
    if(typeof listener!=='function'&&!(listener&&typeof listener.handleEvent==='function'))return;
    const list=listeners.get(type)||[];
    if(!list.includes(listener)){list.push(listener);listeners.set(type,list);}
  }
  function removeEventListener(type,listener){
    const list=listeners.get(type);if(!list)return;
    const index=list.indexOf(listener);if(index>=0)list.splice(index,1);
  }
  function dispatch(target,type,event){
    event=event||{};
    for(const listener of[...(listeners.get(type)||[])]){
      if(!(listeners.get(type)||[]).includes(listener))continue;
      if(typeof listener==='function')listener.call(target,event);
      else listener.handleEvent.call(listener,event);
    }
  }
  return{listeners,addEventListener,removeEventListener,dispatch};
}

function bootRenderedGame(name,options){
  options=options||{};
  const root=options.root||GAME_ROOT;
  const loaded=gameSource(name,root);
  const seed=options.seed===undefined?1:Number(options.seed);
  if(!Number.isFinite(seed))throw new Error('Bad seed: '+options.seed);
  const seed32=seed>>>0;
  const canvas=makeGameCanvas(options.width||DEVICE_WIDTH,options.height||DEVICE_HEIGHT,
    {smoothText:!!options.smoothText});
  const documentEvents=eventTarget(),windowEvents=eventTarget(),storage=new Map();
  const element=()=>({style:{},remove(){},click(){},addEventListener(){},removeEventListener(){},
    set src(value){this._src=value;},get src(){return this._src;}});
  const document={
    hidden:false,title:name,
    getElementById:()=>canvas,
    createElement:tag=>tag==='canvas'?makeGameCanvas(DEVICE_WIDTH,DEVICE_HEIGHT,{smoothText:!!options.smoothText}):element(),
    addEventListener:documentEvents.addEventListener,removeEventListener:documentEvents.removeEventListener,
    body:{appendChild(){}},head:{appendChild(node){if(node&&node.onload)node.onload();}}
  };
  const sandbox={
    console:options.console||console,
    document,
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key),clear:()=>storage.clear()},
    location:{search:options.search||'',href:''},
    performance:global.performance||require('perf_hooks').performance,
    URLSearchParams,
    Math:Object.create(Math),
    requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},
    setTimeout:options.setTimeout||(()=>0),clearTimeout:()=>{},setInterval:()=>0,clearInterval:()=>{},
    Blob:global.Blob,URL:global.URL,
    addEventListener:windowEvents.addEventListener,removeEventListener:windowEvents.removeEventListener
  };
  sandbox.Math.random=seededRandom(seed32);
  sandbox.globalThis=sandbox;sandbox.window=sandbox;sandbox.self=sandbox;
  if(options.noUi!==false)sandbox.__NO_UI=1;
  executeScripts(loaded,sandbox);
  executeScripts([],sandbox,{footer:'globalThis.__engine=E;',footerFilename:name+'.engine-export.js'});
  if(options.footer)executeScripts([],sandbox,{footer:options.footer,footerFilename:name+'.render-footer.js'});
  const engine=sandbox.__engine;
  if(!engine||typeof engine.runFrames!=='function')
    throw new Error('Engine E.runFrames unavailable for '+name+'; did the game call E.start?');

  let frame=0,lastRenderedFrame=0;
  function advance(count,advanceOptions){
    advanceOptions=advanceOptions||{};
    if(!Number.isInteger(count)||count<0)throw new Error('advance count must be a non-negative integer');
    const every=advanceOptions.renderEvery||0;
    if(every!==0&&(!Number.isInteger(every)||every<1))throw new Error('renderEvery must be a positive integer');
    for(let i=0;i<count;i++){
      const next=frame+1;
      const render=!!((every&&next%every===0)||(advanceOptions.renderLast&&i===count-1));
      engine.runFrames(1,{render,startFrame:frame});
      frame=next;
      if(render)lastRenderedFrame=frame;
    }
    return frame;
  }
  function advanceTo(target,advanceOptions){
    if(!Number.isInteger(target)||target<frame)throw new Error(`Cannot seek from frame ${frame} to ${target}`);
    return advance(target-frame,advanceOptions);
  }
  function snapshot(snapshotOptions){
    snapshotOptions=snapshotOptions||{};
    let out=rgbaFrame(canvas.data(),canvas.width,canvas.height,{frame,seed:seed32,game:name});
    if(snapshotOptions.native){
      const sx=out.width/NATIVE_WIDTH,sy=out.height/NATIVE_HEIGHT;
      if(sx!==sy||!Number.isInteger(sx))throw new Error(`Canvas ${out.width}x${out.height} is not an integer multiple of 160x360`);
      out=Object.assign(downsampleRgba(out.rgba,out.width,out.height,sx),{frame,seed:seed32,game:name});
    }
    return out;
  }
  function capturePng(snapshotOptions){return encodeRgbaPng(snapshot(snapshotOptions));}
  function captureRgba(snapshotOptions){return snapshot(snapshotOptions).rgba;}
  function key(type,code){documentEvents.dispatch(document,type,{code,preventDefault(){}});}
  function evaluate(source){return vm.runInContext(source,sandbox,{filename:name+'.visual-footer.js'});}
  function probe(probeName,...args){const value=sandbox[probeName];return typeof value==='function'?value(...args):value;}

  return{
    name,seed:seed32,canvas,sandbox,engine,sourceFiles:loaded.files,dependencyFiles:loaded.dependencyFiles,
    pixelFontReady:!!ensurePixelFont(),advance,advanceTo,snapshot,captureFrame:snapshot,captureRgba,capturePng,key,evaluate,probe,
    get frame(){return frame;},get lastRenderedFrame(){return lastRenderedFrame;}
  };
}

module.exports={
  GAME_ROOT,DEVICE_WIDTH,DEVICE_HEIGHT,NATIVE_WIDTH,NATIVE_HEIGHT,PIXEL_FONT_FAMILY,PIXEL_FONT_PATH,
  seededRandom,inlineScript,needsAutoplay,needsWordPuzzle,ensurePixelFont,patchPixelText,makeGameCanvas,
  rgbaFrame,downsampleRgba,rgbaToCanvas,encodeRgbaPng,gameSource,bootRenderedGame
};
