#!/usr/bin/env node
'use strict';

const{spawnSync}=require('child_process');
const path=require('path');
const phases=require('./phases');

function runPhase(command,args){const result=spawnSync(process.execPath,[__filename,command,...(args||[])],{cwd:phases.ROOT,encoding:'utf8'});if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);if(result.status!==0)throw new Error(`${command} phase failed with status ${result.status}`)}
function main(argv){
  const command=argv[0]||'trial';
  if(command==='discover'){const out=phases.discover();console.log(JSON.stringify({phase:'discover',artifact:out.path,fileSha256:out.fileSha256,claim:out.record.claim},null,2));return}
  if(command==='search'){const mode=argv.includes('--memory-off')?'memory-off':argv.includes('--memory-on')?'memory-on':null;if(!mode)throw new Error('search requires --memory-on or --memory-off');const out=phases.search(mode);console.log(JSON.stringify({phase:'search',mode,artifact:out.path,fileSha256:out.fileSha256,cost:out.record.cost,selected:out.record.selected},null,2));return}
  if(command==='assemble'){const out=phases.assemble();console.log(JSON.stringify({phase:'assemble',artifact:out.path,fileSha256:out.fileSha256,status:out.experiment.status,acceptance:out.experiment.acceptance},null,2));if(!out.experiment.status.learningTrialOk)process.exitCode=1;return}
  if(command==='trial'){
    runPhase('discover');runPhase('search',['--memory-on']);runPhase('search',['--memory-off']);runPhase('assemble');return;
  }
  throw new Error('Usage: node factory/cli.js trial|discover|search --memory-on|--memory-off|assemble');
}
try{main(process.argv.slice(2))}catch(error){console.error(error.stack||error.message);process.exit(1)}
