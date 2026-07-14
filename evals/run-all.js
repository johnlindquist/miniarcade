#!/usr/bin/env node
'use strict';

const fs=require('fs');
const os=require('os');
const path=require('path');
const{spawn}=require('child_process');

const DEFAULT_TIMEOUT_MS=15*60*1000;
const DEFAULT_JOBS=Math.max(1,Math.min(4,(os.availableParallelism?os.availableParallelism():os.cpus().length)||1));

function splitValues(value){return String(value).split(',').map(item=>item.trim()).filter(Boolean)}
function parseArgs(argv){
  const flags={serial:false,jobs:DEFAULT_JOBS,timeoutMs:DEFAULT_TIMEOUT_MS,games:[],profiles:[],tags:[],json:false,out:null,help:false};
  const take=(name,index)=>{if(argv[index+1]===undefined)throw new Error(`${name} needs a value`);return argv[index+1]};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--serial')flags.serial=true;
    else if(arg==='--jobs')flags.jobs=positiveInteger(take(arg,i++),arg);
    else if(arg.startsWith('--jobs='))flags.jobs=positiveInteger(arg.slice(7),'--jobs');
    else if(arg==='--timeout-ms')flags.timeoutMs=positiveInteger(take(arg,i++),arg);
    else if(arg.startsWith('--timeout-ms='))flags.timeoutMs=positiveInteger(arg.slice(13),'--timeout-ms');
    else if(arg==='--timeout')flags.timeoutMs=positiveNumber(take(arg,i++),arg)*1000;
    else if(arg.startsWith('--timeout='))flags.timeoutMs=positiveNumber(arg.slice(10),'--timeout')*1000;
    else if(arg==='--game')flags.games.push(...splitValues(take(arg,i++)));
    else if(arg.startsWith('--game='))flags.games.push(...splitValues(arg.slice(7)));
    else if(arg==='--profile')flags.profiles.push(...splitValues(take(arg,i++)));
    else if(arg.startsWith('--profile='))flags.profiles.push(...splitValues(arg.slice(10)));
    else if(arg==='--tag')flags.tags.push(...splitValues(take(arg,i++)));
    else if(arg.startsWith('--tag='))flags.tags.push(...splitValues(arg.slice(6)));
    else if(arg==='--json')flags.json=true;
    else if(arg==='--out')flags.out=take(arg,i++);
    else if(arg.startsWith('--out='))flags.out=arg.slice(6);
    else if(arg==='--help'||arg==='-h')flags.help=true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if(flags.serial)flags.jobs=1;
  flags.jobs=Math.max(1,Math.min(64,flags.jobs));
  flags.games=[...new Set(flags.games)].sort();flags.profiles=[...new Set(flags.profiles)].sort();flags.tags=[...new Set(flags.tags)].sort();
  return flags;
}
function positiveInteger(value,name){const number=Number(value);if(!Number.isInteger(number)||number<=0)throw new Error(`${name} must be a positive integer`);return number}
function positiveNumber(value,name){const number=Number(value);if(!Number.isFinite(number)||number<=0)throw new Error(`${name} must be positive`);return number}
function usage(){return`Usage: node evals/run-all.js [options]

Options:
  --jobs N             Maximum concurrent behavioral suites (default: ${DEFAULT_JOBS})
  --serial             Run behavioral suites one at a time
  --timeout SEC        Per-suite timeout in seconds (default: ${DEFAULT_TIMEOUT_MS/1000})
  --timeout-ms MS      Per-suite timeout in milliseconds
  --game SLUG          Select one or more game suites (repeat or comma-separate)
  --profile NAME       Select behavior or visual suites
  --tag TAG            Require a suite tag (repeat or comma-separate)
  --json                Print only the machine-readable suite report
  --out FILE            Write the machine-readable suite report
  -h, --help            Show this help`}

function discoverSuites(options){
  options=options||{};const dir=path.resolve(options.dir||__dirname),root=path.resolve(options.root||path.join(dir,'..'));
  const gameSlugs=fs.readdirSync(root).filter(name=>name.endsWith('.html')).map(name=>name.slice(0,-5)).sort((a,b)=>b.length-a.length||a.localeCompare(b));
  return fs.readdirSync(dir).filter(name=>/-eval\.js$/.test(name)&&name!=='run-all.js').sort().map(file=>{
    const stem=file.slice(0,-'-eval.js'.length),visual=stem.endsWith('-visual'),gameStem=visual?stem.slice(0,-'-visual'.length):stem;
    const game=gameSlugs.find(slug=>gameStem===slug||gameStem.startsWith(slug+'-'))||null;
    const profile=visual?'visual':'behavior';
    const tags=[profile,game?'game':'global'];
    if(visual)tags.push('native-pixel');
    if(/(?:^|-)30m(?:-|$)|soak/.test(stem))tags.push('long');
    if(/benchmark/.test(stem))tags.push('benchmark');
    if(/(?:benchmark|evidence|catalog|release)/.test(stem))tags.push('protocol');
    if(/receipt/.test(stem))tags.push('receipt','protocol');
    return{id:stem,file,path:path.join(dir,file),game,profile,profiles:[profile,'release'],tags:[...new Set(tags)].sort(),visual};
  });
}

function filterSuites(suites,filters){
  filters=filters||{};const games=filters.games||[],profiles=filters.profiles||[],tags=filters.tags||[];
  return suites.filter(suite=>{
    const suiteProfiles=Array.isArray(suite.profiles)?suite.profiles:[suite.profile].filter(Boolean);
    return(!games.length||(suite.game&&games.includes(suite.game)))&&
      (!profiles.length||profiles.some(profile=>suiteProfiles.includes(profile)))&&tags.every(tag=>(suite.tags||[]).includes(tag));
  });
}

function runSuite(suite,options){
  options=options||{};const timeoutMs=options.timeoutMs||DEFAULT_TIMEOUT_MS,started=Date.now(),posix=process.platform!=='win32';
  return new Promise(resolve=>{
    const command=suite.command||process.execPath,args=suite.args||[suite.path];
    let child,output='',settled=false,timedOut=false,spawnError=null,killTimer=null,forceTimer=null,timer=null,exitCode=null,exitSignal=null;
    const finish=(code,signal)=>{
      if(settled)return;settled=true;if(timer)clearTimeout(timer);if(killTimer)clearTimeout(killTimer);if(forceTimer)clearTimeout(forceTimer);
      let status;
      if(timedOut)status='timeout';
      else if(spawnError||signal)status='crash';
      else if(code===0)status='pass';
      else status='fail';
      resolve({id:suite.id,file:suite.file||null,game:suite.game||null,profile:suite.profile||'behavior',tags:suite.tags||[],
        status,code:code===null?null:code,signal:signal||null,timeoutMs:timedOut?timeoutMs:null,
        error:spawnError?spawnError.message:null,output,ms:Date.now()-started});
    };
    const killTree=signal=>{
      if(!child||!child.pid)return;
      if(posix){try{process.kill(-child.pid,signal);return}catch{}}
      try{child.kill(signal)}catch{}
    };
    try{child=spawn(command,args,{cwd:options.cwd||path.join(__dirname,'..'),stdio:['ignore','pipe','pipe'],env:options.env||process.env,detached:posix})}
    catch(error){spawnError=error;finish(null,null);return}
    child.stdout.on('data',data=>{output+=data});child.stderr.on('data',data=>{output+=data});
    child.on('error',error=>{spawnError=error});child.on('exit',(code,signal)=>{exitCode=code;exitSignal=signal});child.on('close',finish);
    timer=setTimeout(()=>{
      timedOut=true;output+=`${output&&!output.endsWith('\n')?'\n':''}[run-all] timed out after ${timeoutMs}ms\n`;
      killTree('SIGTERM');killTimer=setTimeout(()=>{
        killTree('SIGKILL');forceTimer=setTimeout(()=>{
          child.stdout.destroy();child.stderr.destroy();finish(exitCode,exitSignal);
        },250);
      },1000);
    },timeoutMs);
  });
}

async function runPool(suites,jobs,runner){
  const results=new Array(suites.length);let next=0;
  async function worker(){while(true){const index=next++;if(index>=suites.length)return;results[index]=await runner(suites[index])}}
  await Promise.all(Array.from({length:Math.min(jobs,suites.length)},worker));return results;
}

async function runAll(options){
  options=options||{};const all=options.suites||discoverSuites(options),selected=filterSuites(all,options);
  const behavior=selected.filter(suite=>!suite.visual),visual=selected.filter(suite=>suite.visual),runner=suite=>runSuite(suite,options);
  const behaviorResults=await runPool(behavior,options.serial?1:(options.jobs||DEFAULT_JOBS),runner),visualResults=[];
  // Real-canvas suites remain serial and start only after the behavioral wave.
  for(const suite of visual)visualResults.push(await runner(suite));
  const results=[...behaviorResults,...visualResults],counts={pass:0,fail:0,timeout:0,crash:0};
  for(const result of results)counts[result.status]++;
  return{schema:'miniarcade-eval-run/v1',suiteIds:selected.map(suite=>suite.id),filters:{games:options.games||[],profiles:options.profiles||[],tags:options.tags||[]},
    jobs:options.serial?1:(options.jobs||DEFAULT_JOBS),timeoutMs:options.timeoutMs||DEFAULT_TIMEOUT_MS,
    counts,total:results.length,ok:results.length>0&&counts.fail===0&&counts.timeout===0&&counts.crash===0,results};
}

function jsonReport(report){return JSON.stringify(report,null,2)+'\n'}
function printHuman(report,options){
  const behavior=report.results.filter(result=>result.profile!=='visual').length,visual=report.results.length-behavior;
  console.log(`SIDE/QUEST evals: ${report.total} suites (`+
    `${behavior} behavioral ${(options.serial||report.jobs===1)?'serial':'parallel'}, ${visual} visual serial)`);
  for(const result of report.results){
    console.log(`\n===== ${result.file||result.id} · ${result.status.toUpperCase()} · ${(result.ms/1000).toFixed(2)}s =====`);
    if(result.output)process.stdout.write(result.output.trimEnd()+'\n');
    if(result.status==='crash'&&!result.output)console.log(`  ${result.error||result.signal||'child process crashed'}`);
  }
  const failed=report.results.filter(result=>result.status!=='pass');
  console.log(`\n${failed.length?`FAILED: ${failed.map(result=>`${result.id} (${result.status})`).join(', ')}`:`ALL ${report.total} EVAL SUITES PASSED`}`);
}

async function main(argv){
  const flags=parseArgs(argv||process.argv.slice(2));if(flags.help){console.log(usage());return 0}
  const report=await runAll(flags);
  if(flags.out){const destination=path.resolve(flags.out);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,jsonReport(report))}
  if(flags.json)process.stdout.write(jsonReport(report));else printHuman(report,flags);
  if(!report.total)return 2;return report.ok?0:1;
}

if(require.main===module)main().then(code=>{process.exitCode=code}).catch(error=>{console.error(error.stack||error.message);process.exitCode=2});
module.exports={DEFAULT_TIMEOUT_MS,DEFAULT_JOBS,parseArgs,usage,discoverSuites,filterSuites,runSuite,runPool,runAll,jsonReport,printHuman,main};
