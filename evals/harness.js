#!/usr/bin/env node
'use strict';

// Shared deterministic, headless boot surface for SIDE/QUEST evals. Games keep
// their browser-first single-file shape; the harness supplies the tiny DOM they
// need and exposes the engine's direct step runner so evals never traverse draw
// code unless a rendering assertion explicitly requests it.
const{DEFAULT_ROOT:ROOT,inlineScript,gameSource,executeScripts}=require('../game-source');

function seededRandom(seed){
  let s=(Number(seed)>>>0)||1;
  return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);
    t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
}

function eventTarget(){
  const listeners=Object.create(null),lists=Object.create(null);
  function addEventListener(type,listener){
    if(typeof listener!=='function'&&!(listener&&typeof listener.handleEvent==='function'))return;
    const list=lists[type]||(lists[type]=[]);
    if(!list.includes(listener))list.push(listener);
    if(!listeners[type])listeners[type]=function(event){dispatch(this,type,event);};
  }
  function removeEventListener(type,listener){
    const list=lists[type];if(!list)return;
    const index=list.indexOf(listener);if(index>=0)list.splice(index,1);
  }
  function dispatch(target,type,event){
    event=event||{};
    for(const listener of[...(lists[type]||[])]){
      if(!(lists[type]||[]).includes(listener))continue;
      if(typeof listener==='function')listener.call(target,event);
      else listener.handleEvent.call(listener,event);
    }
  }
  return{listeners,addEventListener,removeEventListener,dispatch};
}

function makeContext(counter){
  const gradient={addColorStop(){}};
  const noop=()=>{};
  return new Proxy({}, {
    get(target,prop){
      if(prop==='measureText')return text=>({width:String(text).length*5});
      if(prop==='createLinearGradient'||prop==='createRadialGradient')return()=>gradient;
      if(prop==='canvas')return target.canvas;
      return(...args)=>{counter.calls++;counter.byMethod[prop]=(counter.byMethod[prop]||0)+1;return noop(...args);};
    },
    set(target,prop,value){target[prop]=value;return true;}
  });
}

function bootGame(name,options){
  options=options||{};
  const loaded=gameSource(name,options.root||ROOT);
  const documentEvents=eventTarget(),windowEvents=eventTarget();
  const listeners=documentEvents.listeners;
  const counter={calls:0,byMethod:{}};
  const ctx=makeContext(counter);
  const canvas={width:320,height:720,getContext:()=>ctx,captureStream:()=>({})};
  ctx.canvas=canvas;
  const raf={next:null,time:0};
  const rng=seededRandom(options.seed===undefined?1:options.seed);
  const storage=new Map();
  const document={
    hidden:false,title:name,
    getElementById:()=>canvas,
    createElement:tag=>tag==='canvas'?{...canvas,getContext:()=>makeContext(counter)}:
      {style:{},remove(){},click(){},addEventListener(){},removeEventListener(){},
        set src(v){this._src=v;},get src(){return this._src;}},
    addEventListener:documentEvents.addEventListener,removeEventListener:documentEvents.removeEventListener,
    body:{appendChild(){}},head:{appendChild(node){if(node.onload)node.onload();}}
  };
  const sandbox={
    console,
    document,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))},
    location:{search:options.search||''},
    performance,
    URLSearchParams,
    Math:Object.create(Math),
    requestAnimationFrame:fn=>{raf.next=fn;return 1;},
    cancelAnimationFrame:()=>{},
    setTimeout:options.setTimeout||(()=>0),clearTimeout:()=>{},setInterval:()=>0,clearInterval:()=>{},
    Blob:global.Blob,URL:global.URL,
    addEventListener:windowEvents.addEventListener,removeEventListener:windowEvents.removeEventListener
  };
  sandbox.Math.random=rng;
  sandbox.globalThis=sandbox;sandbox.window=sandbox;sandbox.self=sandbox;
  sandbox.__NO_UI=1;
  executeScripts(loaded,sandbox);
  executeScripts([],sandbox,{footer:'globalThis.__engine=E;',footerFilename:name+'.engine-export.js'});
  if(options.footer)executeScripts([],sandbox,{footer:options.footer,footerFilename:name+'.eval-footer.js'});

  function key(type,code){documentEvents.dispatch(document,type,{code,preventDefault(){}});}
  function tick(ms){const fn=raf.next;if(!fn)throw new Error('No animation frame queued');
    raf.next=null;raf.time+=ms===undefined?1000/60:ms;fn(raf.time);}
  function ticks(n){for(let i=0;i<n;i++)tick();}
  let frame=0;
  function frames(n,render){counter.calls=0;counter.byMethod={};
    const advanced=sandbox.__engine.runFrames(n,{render:!!render,startFrame:frame});frame+=advanced;return counter;}
  return{sandbox,ctx,canvas,counter,listeners,key,tick,ticks,frames,
    sourceFiles:loaded.files,dependencyFiles:loaded.dependencyFiles,
    probe:name=>sandbox[name],engine:sandbox.__engine,get frame(){return frame;}};
}

module.exports={ROOT,seededRandom,inlineScript,bootGame};
