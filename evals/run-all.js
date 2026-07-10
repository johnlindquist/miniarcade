#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const{spawn}=require('child_process');

const dir=__dirname;
const files=fs.readdirSync(dir).filter(name=>/-eval\.js$/.test(name)&&name!=='run-all.js').sort();
const visualFiles=files.filter(name=>/-visual-eval\.js$/.test(name));
const behaviorFiles=files.filter(name=>!/-visual-eval\.js$/.test(name));
const serial=process.argv.includes('--serial');

function run(file){return new Promise(resolve=>{
  const started=Date.now();
  const child=spawn(process.execPath,[path.join(dir,file)],{cwd:path.join(dir,'..'),stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  child.on('close',(code,signal)=>resolve({file,code:code===null?1:code,signal,output,ms:Date.now()-started}));
});}

(async()=>{
  console.log(`SIDE/QUEST evals: ${files.length} suites (`+
    `${behaviorFiles.length} behavioral ${serial?'serial':'parallel'}, ${visualFiles.length} visual serial)`);
  const results=[];
  if(serial)for(const file of behaviorFiles)results.push(await run(file));
  else results.push(...await Promise.all(behaviorFiles.map(run)));
  // Real-canvas suites are deliberately serialized after the cheap/headless
  // wave: this bounds CPU and memory, and prevents artifact writers racing.
  for(const file of visualFiles)results.push(await run(file));
  for(const result of results){
    const ok=result.code===0;
    console.log(`\n===== ${result.file} · ${ok?'PASS':'FAIL'} · ${(result.ms/1000).toFixed(2)}s =====`);
    process.stdout.write(result.output.trimEnd()+'\n');
  }
  const failed=results.filter(r=>r.code!==0);
  console.log(`\n${failed.length?`FAILED: ${failed.map(r=>r.file).join(', ')}`:`ALL ${results.length} EVAL SUITES PASSED`}`);
  process.exit(failed.length?1:0);
})().catch(error=>{console.error(error);process.exit(1);});
