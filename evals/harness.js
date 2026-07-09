#!/usr/bin/env node
'use strict';

// Shared deterministic, headless boot surface for SIDE/QUEST evals. Games keep
// their browser-first single-file shape; the harness supplies the tiny DOM they
// need and exposes the engine's direct step runner so evals never traverse draw
// code unless a rendering assertion explicitly requests it.
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const ROOT=path.join(__dirname,'..');

function seededRandom(seed){
  let s=(Number(seed)>>>0)||1;
  return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);
    t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
}

function inlineScript(html){
  const blocks=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  const hit=blocks.find(m=>m[1].includes("'use strict'"))||blocks.at(-1);
  if(!hit)throw new Error('No inline game script found');
  return hit[1];
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
  const html=fs.readFileSync(path.join(ROOT,name+'.html'),'utf8');
  const engine=fs.readFileSync(path.join(ROOT,'engine.js'),'utf8');
  const autoplay=fs.readFileSync(path.join(ROOT,'autoplay.js'),'utf8');
  const wordPuzzle=fs.readFileSync(path.join(ROOT,'word-puzzle.js'),'utf8');
  const listeners={};
  const counter={calls:0,byMethod:{}};
  const ctx=makeContext(counter);
  const canvas={width:320,height:720,getContext:()=>ctx,captureStream:()=>({})};
  ctx.canvas=canvas;
  const raf={next:null,time:0};
  const rng=seededRandom(options.seed===undefined?1:options.seed);
  const storage=new Map();
  const document={
    hidden:false,
    getElementById:()=>canvas,
    createElement:tag=>tag==='canvas'?{...canvas,getContext:()=>makeContext(counter)}:
      {style:{},remove(){},click(){},set src(v){this._src=v;},get src(){return this._src;}},
    addEventListener:(type,fn)=>{listeners[type]=fn;},
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
  };
  sandbox.Math.random=rng;
  sandbox.globalThis=sandbox;
  sandbox.__NO_UI=1;
  const footer='\n;globalThis.__engine=E;\n'+(options.footer||'');
  vm.createContext(sandbox);
  vm.runInContext((engine+'\n'+autoplay+'\n'+wordPuzzle+'\n'+inlineScript(html)).replace(/'use strict';/g,'')+footer,sandbox,
    {filename:name+'.eval.js'});

  function key(type,code){const fn=listeners[type];if(fn)fn({code,preventDefault(){}});}
  function tick(ms){const fn=raf.next;if(!fn)throw new Error('No animation frame queued');
    raf.next=null;raf.time+=ms===undefined?1000/60:ms;fn(raf.time);}
  function ticks(n){for(let i=0;i<n;i++)tick();}
  function frames(n,render){counter.calls=0;counter.byMethod={};
    sandbox.__engine.runFrames(n,{render:!!render});return counter;}
  return{sandbox,ctx,canvas,counter,listeners,key,tick,ticks,frames,
    probe:name=>sandbox[name],engine:sandbox.__engine};
}

module.exports={ROOT,seededRandom,inlineScript,bootGame};
