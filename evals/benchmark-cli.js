#!/usr/bin/env node
'use strict';

const path=require('path');
const fs=require('fs');
const{runBenchmark,canonicalStringify}=require('./benchmark');
const REPOSITORY_ROOT=path.resolve(__dirname,'..');
const DEFAULT_MODULE=path.join(__dirname,'benchmark-catalog.js');

function parseArgs(argv){
  const flags={profile:null,seeds:[],seedCount:null,baseSeed:undefined,outDir:null,json:false,write:true,frames:undefined,verifyReplay:false,module:null};
  const take=(name,index)=>{if(argv[index+1]===undefined)throw new Error(`${name} needs a value`);return argv[index+1]};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--profile')flags.profile=take(arg,i++);
    else if(arg.startsWith('--profile='))flags.profile=arg.slice(10);
    else if(arg==='--seed')flags.seeds.push(parseSeed(take(arg,i++)));
    else if(arg.startsWith('--seed='))flags.seeds.push(parseSeed(arg.slice(7)));
    else if(arg==='--seed-count'||arg==='--seeds')flags.seedCount=positiveInteger(take(arg,i++),arg);
    else if(arg.startsWith('--seed-count='))flags.seedCount=positiveInteger(arg.slice(13),'--seed-count');
    else if(arg.startsWith('--seeds='))flags.seedCount=positiveInteger(arg.slice(8),'--seeds');
    else if(arg==='--base-seed')flags.baseSeed=parseSeed(take(arg,i++));
    else if(arg.startsWith('--base-seed='))flags.baseSeed=parseSeed(arg.slice(12));
    else if(arg==='--frames')flags.frames=positiveInteger(take(arg,i++),arg);
    else if(arg.startsWith('--frames='))flags.frames=positiveInteger(arg.slice(9),'--frames');
    else if(arg==='--out')flags.outDir=take(arg,i++);
    else if(arg.startsWith('--out='))flags.outDir=arg.slice(6);
    else if(arg==='--json')flags.json=true;
    else if(arg==='--no-write')flags.write=false;
    else if(arg==='--verify-replay')flags.verifyReplay=true;
    else if(arg==='--help'||arg==='-h')flags.help=true;
    else if(arg.startsWith('-'))throw new Error(`unknown argument: ${arg}`);
    else if(flags.module)throw new Error(`unexpected argument: ${arg}`);
    else flags.module=arg;
  }
  return flags;
}
function positiveInteger(value,name){const number=Number(value);if(!Number.isInteger(number)||number<=0)throw new Error(`${name} must be a positive integer`);return number}
function parseSeed(value){
  const text=String(value).trim();
  if(/^0x[0-9a-f]+$/i.test(text))return Number.parseInt(text,16);
  if(/^\d+$/.test(text)){const number=Number(text);if(Number.isSafeInteger(number))return number}
  if(text)return text;
  throw new Error('seed must not be empty');
}
function usage(){return`Usage: node evals/benchmark-cli.js [benchmark-module] [options]

Options:
  --profile NAME       Benchmark profile (default: spec default or release)
  --seed VALUE         Explicit deterministic seed; repeat for a panel
  --seeds N            Generate a deterministic panel of N seeds
  --base-seed VALUE    Namespace the generated seed panel
  --frames N           Override the benchmark frame budget
  --verify-replay      Run an additional same-seed replay when supported
  --out DIR            Artifact directory (default: .artifacts/benchmarks/<id>/<profile>)
  --no-write           Do not write canonical JSON artifacts
  --json               Print a machine-readable result
  -h, --help           Show this help`}

function isInsideRoot(root,candidate){
  const relative=path.relative(root,candidate);
  return relative!== '..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);
}
function assertBenchmarkModuleInsideRoot(modulePath,root=REPOSITORY_ROOT){
  const absoluteRoot=path.resolve(root),absoluteModule=path.resolve(modulePath);
  if(!isInsideRoot(absoluteRoot,absoluteModule))throw new Error(`benchmark module must be inside repository root: ${absoluteModule}`);
  const realRoot=fs.realpathSync(absoluteRoot),realModule=fs.realpathSync(absoluteModule);
  if(!isInsideRoot(realRoot,realModule))throw new Error(`benchmark module resolves outside repository root: ${absoluteModule}`);
  const resolvedEntry=fs.realpathSync(require.resolve(absoluteModule));
  if(!isInsideRoot(realRoot,resolvedEntry))throw new Error(`benchmark module resolves outside repository root: ${absoluteModule}`);
  return resolvedEntry;
}
function loadSpec(modulePath){
  const absolute=path.resolve(modulePath),loaded=require(absolute);
  const candidate=loaded&&loaded.default?loaded.default:loaded;
  if(typeof candidate==='function')return candidate();
  if(candidate&&typeof candidate.createBenchmark==='function')return candidate.createBenchmark();
  if(candidate&&candidate.benchmark)return candidate.benchmark;
  return candidate;
}

async function main(argv){
  const flags=parseArgs(argv||process.argv.slice(2));
  if(flags.help){console.log(usage());return 0}
  let modulePath=flags.module?path.resolve(flags.module):DEFAULT_MODULE;
  if(!fs.existsSync(modulePath)){
    if(!flags.module)throw new Error(`default benchmark module is missing: ${DEFAULT_MODULE}; add evals/benchmark-catalog.js or pass an explicit benchmark module`);
    throw new Error(`benchmark module is missing: ${modulePath}`);
  }
  if(flags.module)modulePath=assertBenchmarkModuleInsideRoot(modulePath);
  let spec=await loadSpec(modulePath);
  if(!spec||typeof spec.id!=='string')throw new Error('benchmark module must export a spec with a stable id');
  const root=path.resolve(__dirname,'..'),relativeModule=path.relative(root,modulePath).split(path.sep).join('/');
  if(!relativeModule.startsWith('../')&&!path.isAbsolute(relativeModule))spec={...spec,provenanceFiles:[...(spec.provenanceFiles||[]),relativeModule]};
  const profile=flags.profile||spec.defaultProfile||'release';
  const outDir=flags.write?path.resolve(flags.outDir||path.join('.artifacts','benchmarks',spec.id,profile)):null;
  const result=await runBenchmark(spec,{profile,seeds:flags.seeds.length?flags.seeds:undefined,
    seedCount:flags.seedCount||undefined,baseSeed:flags.baseSeed,frames:flags.frames,
    verifyReplay:flags.verifyReplay,outDir});
  if(flags.json)process.stdout.write(canonicalStringify({ok:result.ok,outDir:result.outDir,receipt:result.receipt,
    scorecard:result.scorecard,diagnosis:result.diagnosis,artifactIndex:result.artifactIndex})+'\n');
  else{
    console.log(`${result.receipt.benchmarkId} · ${result.receipt.profile} · ${result.receipt.verdict.toUpperCase()}`);
    console.log(`  seeds: ${result.receipt.seedPanel.join(', ')}`);
    console.log(`  score: ${(result.scorecard.score*100).toFixed(1)}% · ${result.diagnosis.failureCodes.length} failure code(s)`);
    if(result.diagnosis.failureCodes.length)console.log(`  failures: ${result.diagnosis.failureCodes.join(', ')}`);
    if(result.outDir)console.log(`  artifacts: ${result.outDir}`);
  }
  return result.ok?0:1;
}

if(require.main===module)main().then(code=>{process.exitCode=code}).catch(error=>{console.error(error.message);process.exitCode=2});
module.exports={REPOSITORY_ROOT,DEFAULT_MODULE,parseArgs,parseSeed,usage,isInsideRoot,assertBenchmarkModuleInsideRoot,loadSpec,main};
