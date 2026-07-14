#!/usr/bin/env node
'use strict';

const path=require('path');
const canonical=require('../../canonical');
const store=require('../../store');
const workspace=require('../../workspace');
const verify=require('./verify-artifact');
const phases=require('./phases');

function same(a,b){return canonical.stringify(a)===canonical.stringify(b)}
function marker(genome){return`const CLOG_LEAD_FRAMES = ${genome.clogLeadFrames}; // @foundry clogLeadFrames`}
function verifyTransition(experiment,receipt,currentHash){
  const failures=[],sourceEntry=experiment.source.inputManifest.entries.find(entry=>entry.path==='lantern-line.html'),expectedAction=phases.key(receipt.genome)===phases.key(experiment.incumbentGenome)?'retain-incumbent':'promote-candidate';
  if(receipt.action!==expectedAction)failures.push('promotion action does not match selected genome');
  if(!sourceEntry)failures.push('experiment source manifest lacks lantern-line.html');
  if(receipt.afterHash!==experiment.selection.candidateSourceHash||receipt.afterHash!==currentHash)failures.push('shipping source differs from selected candidate');
  if(receipt.action==='retain-incumbent'){
    if(receipt.patch!==null||receipt.beforeHash!==receipt.afterHash)failures.push('incumbent retention mutated source');
    if(sourceEntry&&receipt.beforeHash!==sourceEntry.sha256)failures.push('retained incumbent before hash differs from experiment source');
  }else{
    const patch=receipt.patch,expectedBefore=marker(experiment.incumbentGenome),expectedAfter=marker(experiment.selection.genome);
    if(!patch||patch.path!=='lantern-line.html'||patch.changedLines!==1)failures.push('candidate promotion lacks exact one-line source patch');
    else{
      if(patch.before!==expectedBefore||patch.after!==expectedAfter)failures.push('promotion patch does not change the declared Foundry marker');
      if(sourceEntry&&(patch.beforeHash!==sourceEntry.sha256||receipt.beforeHash!==sourceEntry.sha256))failures.push('promotion before hash differs from experiment source');
      if(patch.afterHash!==experiment.selection.candidateSourceHash||patch.afterHash!==receipt.afterHash)failures.push('promotion after hash differs from selected candidate');
    }
  }
  return failures;
}
function verifyPromotion(artifact,receiptFile,options){
  options=options||{};artifact=path.resolve(artifact);receiptFile=path.resolve(receiptFile);const experiment=store.readJson(artifact),receipt=store.readJson(receiptFile),failures=[],promoted=phases.key(experiment.selection.genome)!==phases.key(experiment.incumbentGenome),semantic=verify.verifyArtifact(artifact,{artifactRoot:options.artifactRoot,skipRootBinding:promoted,skipRootGenomeBinding:promoted});
  if(!semantic.ok)failures.push(...semantic.failures.map(failure=>'experiment: '+failure));
  const payload={...receipt};delete payload.payloadSha256;if(receipt.payloadSha256!==canonical.hash(payload))failures.push('promotion payload hash mismatch');
  if(receipt.experimentPayloadSha256!==experiment.payloadSha256)failures.push('promotion experiment payload mismatch');
  if(receipt.experimentFileSha256!==workspace.fileHash(artifact))failures.push('promotion experiment file mismatch');
  if(!same(receipt.genome,experiment.selection.genome))failures.push('promotion genome differs from selection');
  failures.push(...verifyTransition(experiment,receipt,workspace.fileHash(path.join(phases.ROOT,'lantern-line.html'))));
  if(workspace.snapshot(phases.ROOT,phases.PROTECTED).sha256!==receipt.protectedManifest.sha256)failures.push('protected artifacts changed during promotion');
  return{ok:!failures.length,failures,action:receipt.action,genome:receipt.genome,afterHash:receipt.afterHash};
}

if(require.main===module){const artifact=process.argv[2]?path.resolve(process.argv[2]):phases.experimentPath(),receiptFile=process.argv[3]?path.resolve(process.argv[3]):path.join(path.dirname(artifact),'promotion.json'),report=verifyPromotion(artifact,receiptFile);console.log(JSON.stringify(report,null,2));if(!report.ok)process.exit(1)}
module.exports={verifyPromotion,verifyTransition};
