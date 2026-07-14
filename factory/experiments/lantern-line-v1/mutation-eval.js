#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const canonical=require('../../canonical');
const store=require('../../store');
const workspace=require('../../workspace');
const verify=require('./verify-artifact');
const phases=require('./phases');

const BASE=phases.experimentPath(),MUTATION_ROOT=path.join(phases.OUT,'mutations');
function clone(name){const dir=path.join(MUTATION_ROOT,name);fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});const top=store.readJson(BASE),children={};for(const key of['discovery','memoryAware','memoryOff']){const value=store.readJson(path.resolve(phases.ROOT,top[key].path)),file=path.join(dir,top[key].path);children[key]={value,file};}return{dir,top,children,file:path.join(dir,path.relative(phases.ROOT,BASE))}}
function rehash(value){delete value.payloadSha256;value.payloadSha256=canonical.hash(value);return value}
function writeClone(bundle){for(const key of Object.keys(bundle.children)){const child=bundle.children[key];rehash(child.value);store.writeArtifact(child.file,child.value);bundle.top[key]={path:path.relative(bundle.dir,child.file),payloadSha256:child.value.payloadSha256,fileSha256:workspace.fileHash(child.file)}}rehash(bundle.top);store.writeArtifact(bundle.file,bundle.top);const artifact=path.relative(bundle.dir,bundle.file),record=phases.experimentRecord(bundle.top,bundle.children.discovery.value,workspace.fileHash(bundle.file),artifact),ledgerRelative=phases.experimentLedgerRelative(bundle.top),ledger=path.join(bundle.dir,ledgerRelative);store.writeArtifact(ledger,record);store.writeArtifact(bundle.file+'.receipt.json',{...record,ledger:ledgerRelative});return bundle.file}
function refreshSearch(record){record.evaluatedGenomes=record.results.map(result=>result.genome);record.eligibleFront=phases.front(record.results).map(result=>({genome:result.genome,candidateSourceHash:result.candidateSourceHash,quality:result.quality}));record.selected=phases.select(record.results,record.incumbentGenome);const count=record.results.length,seeds=record.evaluation.seeds.length;record.cost={proposed:record.pool.length,skippedByClaim:record.skipped.length,cacheHits:0,executedCandidateEvaluations:count,seedRuns:count*seeds,seedFrames:count*seeds*record.evaluation.frames}}
function refreshTop(bundle){const discovery=bundle.children.discovery.value,on=bundle.children.memoryAware.value,off=bundle.children.memoryOff.value,causal=bundle.top.causal;bundle.top.selection=on.selected;bundle.top.cost={productionCandidateEvaluations:discovery.results.length+on.results.length,controlCandidateEvaluations:off.results.length,totalExecutedCandidateEvaluations:discovery.results.length+on.results.length+off.results.length,productionSeedRuns:discovery.results.length*discovery.evaluation.seeds.length+on.cost.seedRuns,controlSeedRuns:off.cost.seedRuns,causalSeedRuns:causal.seedRuns,totalSeedFrames:discovery.results.length*discovery.evaluation.seeds.length*discovery.evaluation.frames+on.cost.seedFrames+off.cost.seedFrames+causal.seedFrames}}
const mutations=[
  ['epoch-rewrite',b=>{b.children.discovery.value.evaluation.epoch='lantern-line-discovery-v2'}],
  ['seed-schedule',b=>{b.children.memoryAware.value.evaluation.seeds[0]++}],
  ['fabricated-quality',b=>{b.children.memoryAware.value.results[0].quality.safety+=999}],
  ['gate-lie',b=>{b.children.discovery.value.results[3].runs[0].gates.exactLanterns=false;b.children.discovery.value.results[3].runs[0].eligible=false}],
  ['claim-substitution',b=>{b.children.discovery.value.claim={path:'factory/memory/lantern-line-v1/claims/fabricated.json',payloadSha256:'0'.repeat(64),fileSha256:'0'.repeat(64)};b.children.discovery.value.claimDecision='emitted-precommitted-hard-gate-claim'}],
  ['savings-without-claim',b=>{b.top.status.memorySavingsClaimed=true}],
  ['common-arm-mismatch',b=>{b.children.memoryOff.value.results[0].totals.events++}],
  ['cost-forgery',b=>{b.children.memoryAware.value.cost.seedFrames--}],
  ['pool-forgery',b=>{b.children.memoryAware.value.pool.pop()}],
  ['selection-forgery',b=>{b.top.selection.genome.clogLeadFrames=54}],
  ['source-hash-forgery',b=>{b.top.selection.candidateSourceHash='f'.repeat(64)}],
  ['source-substitution',b=>{b.top.source.inputManifest.sha256='a'.repeat(64)}],
  ['incumbent-forgery',b=>{b.top.incumbentGenome.clogLeadFrames=0}],
  ['causal-forgery',b=>{b.top.causal.ok=false}],
  ['causal-seed-forgery',b=>{b.top.causal.pairs[0].seed++}],
  ['causal-frame-forgery',b=>{b.top.causal.pairs[0].firstIntentDivergenceFrame++}],
  ['causal-control-forgery',b=>{b.top.causal.control.clogLeadFrames=18}],
  ['causal-intervention-forgery',b=>{b.top.causal.intervention.clogLeadFrames=36}],
  ['causal-seed-frames-forgery',b=>{b.top.causal.seedFrames++}],
  ['causal-activation-forgery',b=>{b.top.causal.pairs[0].interventionLeadActivations++}],
  ['causal-environment-forgery',b=>{b.top.causal.pairs[0].environmentSameAtDivergence=false}],
  ['causal-pair-order-forgery',b=>{b.top.causal.pairs.reverse()}],
  ['acceptance-forgery',b=>{b.top.acceptance.parameterCausallyActive=false}],
  ['release-forgery',b=>{b.top.status.releaseEligible=true;b.top.status.humanVisualGate='approved'}],
  ['missing-discovery-arm',b=>{b.children.discovery.value.results=b.children.discovery.value.results.filter(result=>result.genome.clogLeadFrames!==18);refreshTop(b)}],
  ['missing-confirmation-arm',b=>{for(const key of['memoryAware','memoryOff']){const record=b.children[key].value;record.results=record.results.filter(result=>result.genome.clogLeadFrames!==18);refreshSearch(record)}refreshTop(b)}],
  ['duplicate-confirmation-arm',b=>{const record=b.children.memoryAware.value;record.results.push(JSON.parse(JSON.stringify(record.results[0])));refreshSearch(record);refreshTop(b)}],
  ['evaluated-genomes-result-mismatch',b=>{b.children.memoryAware.value.evaluatedGenomes.pop()}],
  ['top-level-cost-forgery',b=>{b.top.cost.totalSeedFrames--}],
  ['child-source-substitution',b=>{b.children.memoryAware.value.source.inputManifest.sha256='b'.repeat(64)}],
  ['ledger-self-alias',null,(b,file)=>{const receiptFile=file+'.receipt.json',receipt=store.readJson(receiptFile),ledger=path.join(b.dir,receipt.ledger);receipt.ledger=path.relative(b.dir,receiptFile);store.writeArtifact(receiptFile,receipt);fs.rmSync(ledger)}],
  ['ledger-null-record',null,(b,file)=>{const receipt=store.readJson(file+'.receipt.json');store.writeArtifact(path.join(b.dir,receipt.ledger),null)}],
  ['receipt-null-record',null,(b,file)=>{store.writeArtifact(file+'.receipt.json',null)}]
];
let failed=false;const receipts=[];fs.mkdirSync(MUTATION_ROOT,{recursive:true});
for(const[name,mutate,afterWrite]of mutations){const bundle=clone(name);if(mutate)mutate(bundle);const file=writeClone(bundle);if(afterWrite)afterWrite(bundle,file);let report;try{report=verify.verifyArtifact(file,{artifactRoot:bundle.dir})}catch(error){report={ok:false,failures:['verifier threw: '+error.message]}}const rejected=!report.ok;receipts.push({name,rejected,failures:report.failures});if(!rejected){console.error('FAIL: accepted semantic mutation '+name);failed=true}else console.log(`  rejected ${name}: ${report.failures[0]}`)}
fs.rmSync(MUTATION_ROOT,{recursive:true,force:true});
const receipt={schema:'lantern-line-foundry-mutation-receipt/v1',mutations:receipts.length,rejected:receipts.filter(item=>item.rejected).length,receipts};store.writeArtifact(path.join(phases.OUT,'mutation-receipt.json'),receipt);
console.log(JSON.stringify(receipt,null,2));if(failed)process.exit(1);console.log('LANTERN LINE FOUNDRY MUTATION EVAL PASSED');
