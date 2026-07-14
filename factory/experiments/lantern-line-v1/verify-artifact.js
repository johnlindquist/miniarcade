#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const canonical=require('../../canonical');
const store=require('../../store');
const workspace=require('../../workspace');
const adapter=require('../../adapters/lantern-line');
const phases=require('./phases');

function same(a,b){return canonical.stringify(a)===canonical.stringify(b)}
function artifactPath(root,relative){return path.resolve(root,relative||'')}
function regularFile(root,relative,label,failures){
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||path.normalize(relative)!==relative){failures.push(`${label} path is not canonical`);return null}
  const file=artifactPath(root,relative),contained=path.relative(root,file);
  if(contained.startsWith('..'+path.sep)||path.isAbsolute(contained)){failures.push(`${label} path escapes artifact root`);return null}
  if(!fs.existsSync(file)){failures.push(`${label} missing`);return null}
  const stat=fs.lstatSync(file);
  if(stat.isSymbolicLink()||!stat.isFile()){failures.push(`${label} is not a regular file`);return null}
  try{workspace.realContained(root,file)}catch(error){failures.push(`${label} ${error.message}`);return null}
  return file;
}
function boundJson(root,reference,label,failures){
  const file=regularFile(root,reference.path,`${label} artifact`,failures);
  if(!file)return null;
  if(workspace.fileHash(file)!==reference.fileSha256){failures.push(`${label} file hash mismatch`);return null}
  const value=store.readJson(file);try{phases.assertPayload(value)}catch(error){failures.push(`${label} ${error.message}`)}
  if(value.payloadSha256!==reference.payloadSha256)failures.push(`${label} payload reference mismatch`);return value;
}
function expectedEvaluation(label){return label==='discovery'?{frames:9000,seeds:phases.DISCOVERY_SEEDS,epoch:'lantern-line-discovery-v1'}:{frames:9000,seeds:phases.CONFIRMATION_SEEDS,epoch:'lantern-line-confirmation-v1'}}
function genomeKeys(values){return(values||[]).map(value=>{try{return phases.key(adapter.validateGenome({...value}))}catch{return'INVALID'}})}
function exactGenomeSet(label,values,expected,failures){
  const actualKeys=genomeKeys(values),expectedKeys=genomeKeys(expected),unique=new Set(actualKeys);
  if(unique.size!==actualKeys.length)failures.push(`${label} contains duplicate genomes`);
  if(!same([...actualKeys].sort(),[...expectedKeys].sort()))failures.push(`${label} genome set mismatch`);
}
function replay(label,record,failures){
  if(!same(record.evaluation,expectedEvaluation(label)))failures.push(`${label} epoch or seed schedule changed`);
  if(!same(record.pool,phases.POOL)||record.poolSha256!==canonical.hash(phases.POOL))failures.push(`${label} legal genome pool mismatch`);
  if(label==='discovery')exactGenomeSet(`${label} results`,(record.results||[]).map(result=>result.genome),phases.POOL,failures);
  for(const result of record.results||[]){
    let fresh;try{fresh=phases.evaluate(result.genome,record.evaluation)}catch(error){failures.push(`${label} replay crashed for ${phases.key(result.genome)}: ${error.message}`);continue}
    if(!same(fresh,result))failures.push(`${label} replay mismatch for ${phases.key(result.genome)}`);
  }
}
function verifyClaim(discovery,on,off,failures){
  const target=(discovery.results||[]).find(result=>result.genome.clogLeadFrames===54),failure=target&&phases.claimFailure(target);
  if(failure&&!discovery.claim)failures.push('precommitted candidate-54 failure was not claimed');
  if(!failure&&discovery.claim)failures.push('claim emitted without precommitted candidate-54 failure');
  const expectedDecision=failure?'emitted-precommitted-hard-gate-claim':'no-claim-precommitted-target-passed';if(discovery.claimDecision!==expectedDecision)failures.push('claim decision does not match discovery evidence');
  if(discovery.claim){
    const claimFile=path.resolve(phases.ROOT,discovery.claim.path||'');if(!fs.existsSync(claimFile))failures.push('durable claim missing');else{const claim=store.readJson(claimFile);try{phases.assertPayload(claim)}catch(error){failures.push(error.message)}if(claim.payloadSha256!==discovery.claim.payloadSha256||workspace.fileHash(claimFile)!==discovery.claim.fileSha256)failures.push('durable claim binding mismatch');if(claim.evaluationEpoch!==discovery.evaluation.epoch||claim.inputManifestSha256!==discovery.source.inputManifest.sha256||claim.validationTarget.clogLeadFrames!==54)failures.push('durable claim substituted its declared condition');if(!same(claim.support,[failure]))failures.push('durable claim support was fabricated or substituted')}
    if(!on.claim||!on.skipped.some(genome=>genome.clogLeadFrames===54))failures.push('memory-aware arm did not consume the exact claim');
  }else if(on.claim||(on.skipped||[]).length)failures.push('memory-aware arm claimed savings without a durable claim');
  if((off.skipped||[]).length||off.claim)failures.push('memory-off arm skipped candidates or consumed memory');
}
function verifySearch(on,off,failures){
  if(on.mode!=='memory-on'||off.mode!=='memory-off')failures.push('search arm labels changed');
  for(const record of[on,off]){
    if(!same(record.evaluation,expectedEvaluation('confirmation')))failures.push(`${record.mode} confirmation schedule mismatch`);
    if(!same(record.pool,phases.POOL)||record.poolSha256!==canonical.hash(phases.POOL))failures.push(`${record.mode} pool mismatch`);
    const skippedList=record.skipped||[],skippedArray=genomeKeys(skippedList),legalKeys=new Set(genomeKeys(phases.POOL));if(new Set(skippedArray).size!==skippedArray.length||skippedArray.some(key=>!legalKeys.has(key)))failures.push(`${record.mode} skipped genome set is invalid`);
    const skippedKeys=new Set(skippedArray),expectedGenomes=phases.POOL.filter(genome=>!skippedKeys.has(phases.key(genome)));
    exactGenomeSet(`${record.mode} evaluatedGenomes`,record.evaluatedGenomes||[],expectedGenomes,failures);
    exactGenomeSet(`${record.mode} results`,(record.results||[]).map(result=>result.genome),expectedGenomes,failures);
    const expected=phases.select(record.results,record.incumbentGenome);if(!same(record.selected,expected))failures.push(`${record.mode} selected result was not derived from replayed Pareto front`);
    const front=phases.front(record.results).map(result=>({genome:result.genome,candidateSourceHash:result.candidateSourceHash,quality:result.quality}));if(!same(record.eligibleFront,front))failures.push(`${record.mode} eligible Pareto front mismatch`);
    const count=expectedGenomes.length,seeds=record.evaluation.seeds.length,expectedCost={proposed:phases.POOL.length,skippedByClaim:(record.skipped||[]).length,cacheHits:0,executedCandidateEvaluations:count,seedRuns:count*seeds,seedFrames:count*seeds*record.evaluation.frames};if(!same(record.cost,expectedCost))failures.push(`${record.mode} cost accounting mismatch`);
  }
  for(const left of on.results||[]){const right=(off.results||[]).find(result=>phases.key(result.genome)===phases.key(left.genome));if(!right||!same(left,right))failures.push(`common-arm result mismatch for ${phases.key(left.genome)}`)}
  if(!same(on.selected,off.selected))failures.push('memory arms selected different source-bound candidates');
}
function verifyArtifact(file,options){
  options=options||{};file=path.resolve(file);const failures=[],artifactRoot=path.resolve(options.artifactRoot||phases.ROOT);let experiment;
  try{experiment=store.readJson(file);phases.assertPayload(experiment)}catch(error){return{ok:false,failures:[`experiment unreadable: ${error.message}`]}}
  if(experiment.schema!=='arcade-foundry-lantern-line-experiment/v1'||experiment.id!=='lantern-line-foundry-v1')failures.push('experiment schema or id mismatch');
  const requiredStatus=['learningTrialOk','claimEmitted','memorySavingsClaimed','humanVisualGate','releaseEligible'];for(const key of requiredStatus)if(!(key in experiment.status))failures.push(`status missing ${key}`);
  if(experiment.status.releaseEligible!==false||experiment.status.humanVisualGate!=='pending')failures.push('pre-review experiment incorrectly claims release eligibility');
  if(!options.skipRootBinding){const input=workspace.snapshot(phases.ROOT,phases.INPUT_FILES),protectedManifest=workspace.snapshot(phases.ROOT,phases.PROTECTED);if(!same(input,experiment.source.inputManifest))failures.push('current source/input manifest differs from experiment');if(!same(protectedManifest,experiment.source.protectedManifest))failures.push('protected catalog or reviewed artifacts differ from experiment')}
  const discovery=boundJson(artifactRoot,experiment.discovery,'discovery',failures),on=boundJson(artifactRoot,experiment.memoryAware,'memory-aware',failures),off=boundJson(artifactRoot,experiment.memoryOff,'memory-off',failures);
  if(discovery&&on&&off){
    const rootIncumbent=adapter.readGenome(phases.ROOT);if(!same(discovery.incumbentGenome,on.incumbentGenome)||!same(on.incumbentGenome,off.incumbentGenome)||!same(experiment.incumbentGenome,on.incumbentGenome)||(!options.skipRootGenomeBinding&&!same(experiment.incumbentGenome,rootIncumbent)))failures.push('source-bound incumbent genome mismatch');
    if(!same(discovery.source,experiment.source)||!same(on.source,experiment.source)||!same(off.source,experiment.source))failures.push('child source provenance differs from top-level experiment source');
    replay('discovery',discovery,failures);replay('confirmation',on,failures);replay('confirmation',off,failures);verifyClaim(discovery,on,off,failures);verifySearch(on,off,failures);
    const claimEmitted=!!discovery.claim;if(experiment.status.claimEmitted!==claimEmitted||experiment.status.memorySavingsClaimed!==claimEmitted)failures.push('claim/savings status is dishonest');if(!claimEmitted&&(on.cost.executedCandidateEvaluations!==off.cost.executedCandidateEvaluations||on.cost.seedRuns!==off.cost.seedRuns))failures.push('no-claim run manufactured memory savings');
    if(!same(experiment.selection,on.selected))failures.push('top-level selection is not bound to memory-aware selection');const selected=on.results.find(result=>phases.key(result.genome)===phases.key(on.selected.genome));if(!selected||selected.candidateSourceHash!==experiment.selection.candidateSourceHash)failures.push('selected source hash does not bind to evaluated candidate');
    const incumbent=on.results.find(result=>phases.key(result.genome)===phases.key(on.incumbentGenome));if(phases.key(experiment.selection.genome)!==phases.key(on.incumbentGenome)&&(!incumbent||!selected||!phases.dominates(selected,incumbent)))failures.push('promoted selection does not strictly Pareto-dominate incumbent');
    const validation=off.results.find(result=>result.genome.clogLeadFrames===54),expectedAcceptance={precommittedClaimPolicyHonest:claimEmitted?on.skipped.some(genome=>genome.clogLeadFrames===54)&&!!on.claim:!on.claim&&!on.skipped.length,identicalPrecommittedPoolAndCache:on.poolSha256===off.poolSha256&&on.source.inputManifest.sha256===off.source.inputManifest.sha256&&same(discovery.incumbentGenome,on.incumbentGenome)&&same(on.incumbentGenome,off.incumbentGenome)&&same(on.evaluation,off.evaluation)&&same(on.cache,off.cache),memoryOffValidatedTarget:claimEmitted?!validation.eligible&&!!phases.claimFailure(validation):validation.eligible&&!phases.claimFailure(validation),costAccountingHonest:claimEmitted?on.cost.executedCandidateEvaluations<off.cost.executedCandidateEvaluations:on.cost.executedCandidateEvaluations===off.cost.executedCandidateEvaluations,commonArmsByteIdentical:on.results.every(left=>{const right=off.results.find(result=>phases.key(result.genome)===phases.key(left.genome));return right&&same(left,right)}),sameSourceBoundSelection:same(on.selected,off.selected),paretoSelectionStrict:phases.key(on.selected.genome)===phases.key(on.incumbentGenome)||phases.dominates(selected,incumbent),parameterCausallyActive:experiment.causal.ok,protectedArtifactsUnchanged:true};if(!same(experiment.acceptance,expectedAcceptance))failures.push('experiment acceptance was fabricated');if(experiment.status.learningTrialOk!==Object.values(expectedAcceptance).every(Boolean))failures.push('learning trial status does not derive from acceptance');
    const expectedCost={productionCandidateEvaluations:discovery.results.length+on.results.length,controlCandidateEvaluations:off.results.length,totalExecutedCandidateEvaluations:discovery.results.length+on.results.length+off.results.length,productionSeedRuns:discovery.results.length*phases.DISCOVERY_SEEDS.length+on.cost.seedRuns,controlSeedRuns:off.cost.seedRuns,causalSeedRuns:experiment.causal.seedRuns,totalSeedFrames:discovery.results.length*phases.DISCOVERY_SEEDS.length*discovery.evaluation.frames+on.cost.seedFrames+off.cost.seedFrames+experiment.causal.seedFrames};if(!same(experiment.cost,expectedCost))failures.push('top-level experiment cost accounting mismatch');
  }
  let replayedCausal=null;try{replayedCausal=phases.causalReceipt()}catch(error){failures.push(`causal receipt replay crashed: ${error.message}`)}if(replayedCausal&&!same(experiment.causal,replayedCausal))failures.push('causal receipt replay mismatch');if(!experiment.causal||!experiment.causal.ok||!Array.isArray(experiment.causal.pairs)||experiment.causal.pairs.length!==phases.DISCOVERY_SEEDS.length||experiment.causal.pairs.some(pair=>!pair.environmentSameAtDivergence||pair.interventionLeadActivations<=0))failures.push('causal parameter receipt invalid');
  const receiptFile=file+'.receipt.json',receiptRelative=path.relative(artifactRoot,receiptFile),boundReceipt=regularFile(artifactRoot,receiptRelative,'experiment ledger receipt',failures);
  if(boundReceipt){
    let receipt,receiptParsed=false;
    try{receipt=store.readJson(boundReceipt);receiptParsed=true}catch(error){failures.push(`experiment ledger receipt unreadable: ${error.message}`)}
    if(receiptParsed&&discovery){
      const logicalArtifact=path.relative(artifactRoot,file),expectedLedger=phases.experimentLedgerRelative(experiment),expectedRecord=phases.experimentRecord(experiment,discovery,workspace.fileHash(file),logicalArtifact),expectedReceipt={...expectedRecord,ledger:expectedLedger},receiptObject=receipt!==null&&!Array.isArray(receipt)&&typeof receipt==='object';
      if(!same(receipt,expectedReceipt))failures.push('experiment ledger receipt mismatch');
      if(!receiptObject)failures.push('experiment ledger receipt is not an object');
      if(receiptObject&&receipt.ledger===receiptRelative)failures.push('immutable experiment ledger aliases its receipt');
      if(!receiptObject||receipt.ledger!==expectedLedger)failures.push('immutable experiment ledger path mismatch');
      const ledgerFile=regularFile(artifactRoot,expectedLedger,'immutable experiment ledger',failures);
      if(ledgerFile&&path.resolve(ledgerFile)===path.resolve(boundReceipt))failures.push('immutable experiment ledger is not distinct from its receipt');
      if(ledgerFile){
        try{const record=store.readJson(ledgerFile);if(!same(record,expectedRecord))failures.push('immutable experiment ledger record mismatch')}
        catch(error){failures.push(`immutable experiment ledger unreadable: ${error.message}`)}
      }
    }
  }
  return{ok:!failures.length,failures,selection:experiment.selection,payloadSha256:experiment.payloadSha256,claimEmitted:experiment.status.claimEmitted,memorySavingsClaimed:experiment.status.memorySavingsClaimed};
}

if(require.main===module){const file=process.argv[2]?path.resolve(process.argv[2]):phases.experimentPath(),report=verifyArtifact(file);console.log(JSON.stringify(report,null,2));if(!report.ok)process.exit(1)}
module.exports={verifyArtifact};
