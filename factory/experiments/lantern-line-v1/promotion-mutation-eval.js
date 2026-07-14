#!/usr/bin/env node
'use strict';

const fs=require('fs');
const os=require('os');
const path=require('path');
const canonical=require('../../canonical');
const store=require('../../store');
const workspace=require('../../workspace');
const phases=require('./phases');
const promotion=require('./verify-promotion');

const BASE=phases.experimentPath(),PROMOTION=path.join(phases.OUT,'promotion.json');
function copy(root,source){const relative=path.relative(phases.ROOT,source),target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);return target}
function clone(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lantern-promotion-mutation-')),top=store.readJson(BASE),receipt=store.readJson(BASE+'.receipt.json'),files=[BASE,BASE+'.receipt.json',PROMOTION,path.resolve(phases.ROOT,top.discovery.path),path.resolve(phases.ROOT,top.discovery.path)+'.sha256',path.resolve(phases.ROOT,top.memoryAware.path),path.resolve(phases.ROOT,top.memoryAware.path)+'.sha256',path.resolve(phases.ROOT,top.memoryOff.path),path.resolve(phases.ROOT,top.memoryOff.path)+'.sha256',path.resolve(phases.ROOT,receipt.ledger)];for(const file of files)copy(root,file);return{root,artifact:path.join(root,path.relative(phases.ROOT,BASE)),promotion:path.join(root,path.relative(phases.ROOT,PROMOTION))}
}
function rehash(value){delete value.payloadSha256;value.payloadSha256=canonical.hash(value);return value}
function bind(bundle){
  const experiment=store.readJson(bundle.artifact),receiptFile=bundle.artifact+'.receipt.json',priorReceipt=store.readJson(receiptFile),priorLedger=path.join(bundle.root,priorReceipt.ledger),promotionReceipt=store.readJson(bundle.promotion);rehash(experiment);store.writeArtifact(bundle.artifact,experiment);const discovery=store.readJson(path.join(bundle.root,experiment.discovery.path)),artifact=path.relative(bundle.root,bundle.artifact),record=phases.experimentRecord(experiment,discovery,workspace.fileHash(bundle.artifact),artifact),ledgerRelative=phases.experimentLedgerRelative(experiment),ledgerFile=path.join(bundle.root,ledgerRelative);if(path.resolve(priorLedger)!==path.resolve(ledgerFile))fs.rmSync(priorLedger,{force:true});store.writeArtifact(ledgerFile,record);store.writeArtifact(receiptFile,{...record,ledger:ledgerRelative});promotionReceipt.experimentPayloadSha256=experiment.payloadSha256;promotionReceipt.experimentFileSha256=workspace.fileHash(bundle.artifact);rehash(promotionReceipt);store.writeArtifact(bundle.promotion,promotionReceipt);
}
const receipts=[];
function mutateExperiment(name,mutate){const bundle=clone();try{const experiment=store.readJson(bundle.artifact);mutate(experiment,bundle);store.writeArtifact(bundle.artifact,experiment);bind(bundle);const report=promotion.verifyPromotion(bundle.artifact,bundle.promotion,{artifactRoot:bundle.root}),rejected=!report.ok;receipts.push({name,rejected,failures:report.failures});if(!rejected)throw new Error('accepted '+name);console.log(`  rejected ${name}: ${report.failures[0]}`)}finally{fs.rmSync(bundle.root,{recursive:true,force:true})}}
function transitionFixture(){
  const experiment=store.readJson(BASE),before='a'.repeat(64),after='b'.repeat(64);experiment.incumbentGenome={clogLeadFrames:36};experiment.selection={genome:{clogLeadFrames:54},candidateSourceHash:after,reason:'pareto-front-strictly-dominates-incumbent'};experiment.source.inputManifest.entries.find(entry=>entry.path==='lantern-line.html').sha256=before;const receipt={action:'promote-candidate',genome:{clogLeadFrames:54},beforeHash:before,afterHash:after,patch:{path:'lantern-line.html',before:'const CLOG_LEAD_FRAMES = 36; // @foundry clogLeadFrames',after:'const CLOG_LEAD_FRAMES = 54; // @foundry clogLeadFrames',changedLines:1,beforeHash:before,afterHash:after}};if(promotion.verifyTransition(experiment,receipt,after).length)throw new Error('valid synthetic promotion transition failed');return{experiment,receipt,after}
}
function mutateTransition(name,mutate){const fixture=transitionFixture();mutate(fixture.receipt);const failures=promotion.verifyTransition(fixture.experiment,fixture.receipt,fixture.after),rejected=!!failures.length;receipts.push({name,rejected,failures});if(!rejected)throw new Error('accepted '+name);console.log(`  rejected ${name}: ${failures[0]}`)}

const base=promotion.verifyPromotion(BASE,PROMOTION);if(!base.ok)throw new Error('baseline promotion invalid: '+base.failures.join('; '));
mutateExperiment('forged-experiment-cost',experiment=>{experiment.cost.totalSeedFrames--});
mutateExperiment('forged-experiment-acceptance',experiment=>{experiment.acceptance.costAccountingHonest=false;experiment.status.learningTrialOk=false});
mutateExperiment('omitted-experiment-arm',(experiment,bundle)=>{const childFile=path.join(bundle.root,experiment.memoryAware.path),child=store.readJson(childFile);child.results.pop();child.evaluatedGenomes.pop();rehash(child);store.writeArtifact(childFile,child);experiment.memoryAware.payloadSha256=child.payloadSha256;experiment.memoryAware.fileSha256=workspace.fileHash(childFile)});
mutateExperiment('forged-before-hash',(experiment,bundle)=>{const receipt=store.readJson(bundle.promotion);receipt.beforeHash='c'.repeat(64);rehash(receipt);store.writeArtifact(bundle.promotion,receipt)});
mutateTransition('forged-patch-path',receipt=>{receipt.patch.path='README.md'});
mutateTransition('forged-patch-before-hash',receipt=>{receipt.patch.beforeHash='c'.repeat(64)});
mutateTransition('forged-patch-after-hash',receipt=>{receipt.patch.afterHash='c'.repeat(64)});
mutateTransition('unrelated-one-line-patch',receipt=>{receipt.patch.before='const OTHER = 36;';receipt.patch.after='const OTHER = 54;'});
const mutationReceipt={schema:'lantern-line-promotion-mutation-receipt/v1',mutations:receipts.length,rejected:receipts.filter(item=>item.rejected).length,receipts};store.writeArtifact(path.join(phases.OUT,'promotion-mutation-receipt.json'),mutationReceipt);console.log(JSON.stringify(mutationReceipt,null,2));
console.log('LANTERN LINE PROMOTION MUTATION EVAL PASSED');
