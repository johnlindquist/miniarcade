#!/usr/bin/env node
'use strict';

const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const{spawnSync}=require('child_process');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'miniarcade-render-smoke-'));
process.on('exit',()=>fs.rmSync(dir,{recursive:true,force:true}));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function render(name){
  const out=path.join(dir,name+'.mp4'),run=spawnSync(process.execPath,[path.join(__dirname,'render.js'),'pico-cap','0.2',out,'--seed','4660','--fps','30','--probe'],{encoding:'utf8',maxBuffer:4*1024*1024});
  if(run.status!==0)throw new Error(`renderer failed (${run.status})\n${run.stdout}\n${run.stderr}`);
  if(!/probe \{[^\n]*"finite":true/.test(run.stdout))throw new Error('renderer probe did not report finite simulation state');
  const stat=fs.statSync(out);if(stat.size<1000)throw new Error(`renderer produced undersized MP4 (${stat.size} bytes)`);
  return out;
}

const first=render('first'),second=render('second');
if(hash(first)!==hash(second))throw new Error('same-seed renderer smoke outputs are not byte deterministic');
const probe=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,avg_frame_rate,nb_frames','-of','json',first],{encoding:'utf8'});
if(probe.status!==0)throw new Error(`ffprobe failed (${probe.status}): ${probe.stderr}`);
const parsed=JSON.parse(probe.stdout),stream=parsed.streams&&parsed.streams[0];
if(!stream||stream.codec_name!=='h264'||stream.width!==320||stream.height!==720||stream.avg_frame_rate!=='30/1'||Number(stream.nb_frames)!==6)
  throw new Error('unexpected renderer stream: '+JSON.stringify(stream));
console.log(`renderer smoke passed: h264 ${stream.width}x${stream.height}, ${stream.nb_frames} frames @ ${stream.avg_frame_rate}, sha256 ${hash(first)}`);
