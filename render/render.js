#!/usr/bin/env node
'use strict';

// Deterministic offline MP4 renderer. Simulation always advances at 60 Hz;
// --fps changes only how often the real canvas is drawn and encoded.
const fs=require('fs');
const path=require('path');
const{spawn}=require('child_process');
const{bootRenderedGame,DEVICE_WIDTH,DEVICE_HEIGHT}=require('./runtime');

function parse(argv){
  const positional=[],flags={fps:30,preset:'ultrafast',crf:'23'};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--seed')flags.seed=argv[++i];
    else if(arg.startsWith('--seed='))flags.seed=arg.slice(7);
    else if(arg==='--fps')flags.fps=Number(argv[++i]);
    else if(arg.startsWith('--fps='))flags.fps=Number(arg.slice(6));
    else if(arg==='--preset')flags.preset=argv[++i];
    else if(arg.startsWith('--preset='))flags.preset=arg.slice(9);
    else if(arg==='--crf')flags.crf=argv[++i];
    else if(arg.startsWith('--crf='))flags.crf=arg.slice(6);
    else if(arg==='--probe')flags.probe=true;
    else if(arg==='--smooth-text')flags.smoothText=true;
    else if(arg==='--help'||arg==='-h')flags.help=true;
    else if(arg.startsWith('-'))throw new Error('Unknown flag: '+arg);
    else positional.push(arg);
  }
  return{positional,flags};
}

async function main(){
  const{positional,flags}=parse(process.argv.slice(2));
  if(flags.help){
    console.log('Usage: node render/render.js <game> <seconds> [out.mp4] [--seed N] [--probe] [--fps 30]');
    console.log('Simulation is fixed at 60 Hz; --fps must be a positive divisor of 60.');
    return;
  }
  const game=positional[0],seconds=Number(positional[1]),fps=flags.fps;
  if(!game||!Number.isFinite(seconds)||seconds<=0)throw new Error('Game and positive seconds are required');
  if(!Number.isFinite(fps)||fps<=0||60%fps!==0)throw new Error('--fps must be a positive divisor of 60');
  const out=path.resolve(positional[2]||`${game}-${seconds}s.mp4`),seed=flags.seed===undefined?1:Number(flags.seed);
  if(!Number.isFinite(seed))throw new Error('Bad --seed: '+flags.seed);
  const stride=60/fps,outFrames=Math.round(seconds*fps),simFrames=Math.round(seconds*60);
  if(outFrames*stride!==simFrames)throw new Error('Seconds must resolve to a whole 60 Hz simulation frame');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  const runtime=bootRenderedGame(game,{seed,smoothText:!!flags.smoothText});
  const ffmpeg=spawn('ffmpeg',['-y','-v','error','-f','rawvideo','-pix_fmt','rgba',
    '-s',`${DEVICE_WIDTH}x${DEVICE_HEIGHT}`,'-r',String(fps),'-i','-',
    '-c:v','libx264','-preset',flags.preset,'-crf',String(flags.crf),
    '-pix_fmt','yuv420p','-movflags','+faststart',out],{stdio:['pipe','inherit','inherit']});
  const finished=new Promise((resolve,reject)=>{
    ffmpeg.once('error',reject);
    ffmpeg.once('close',code=>code===0?resolve():reject(new Error(`ffmpeg exited ${code}`)));
  });
  console.log(`render ${game}: ${seconds}s sim@60Hz -> ${outFrames} frames @${fps}fps, seed 0x${(seed>>>0).toString(16)}`);
  const started=Date.now(),logEvery=Math.max(1,Math.floor(outFrames/10));
  for(let frame=0;frame<outFrames;frame++){
    runtime.advance(stride,{renderLast:true});
    if(!ffmpeg.stdin.write(runtime.canvas.data()))await new Promise(resolve=>ffmpeg.stdin.once('drain',resolve));
    if((frame+1)%logEvery===0||frame+1===outFrames){
      const rendered=(frame+1)/fps,wall=(Date.now()-started)/1000;
      console.log(`  ${rendered.toFixed(0)}/${seconds}s (${(rendered/Math.max(.1,wall)).toFixed(1)}x realtime)`);
    }
  }
  ffmpeg.stdin.end();
  await finished;
  const stat=fs.statSync(out);
  console.log(`wrote ${out} (${stat.size} bytes)`);
  if(flags.probe){
    const probe=typeof runtime.sandbox.__soakProbe==='function'?runtime.sandbox.__soakProbe():null;
    console.log('probe '+JSON.stringify(probe&&{finite:probe.finite!==false,events:probe.events,progress:probe.progress}));
  }
}

main().catch(error=>{console.error(error.stack||error);process.exit(1)});
