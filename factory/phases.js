'use strict';

const fs=require('fs');
const path=require('path');
const child=require('child_process');
const canonical=require('./canonical');
const workspace=require('./workspace');
const store=require('./store');
const adapter=require('./adapters/tower-panic');
const{bootGame}=require('../evals/harness');

const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(process.env.ARCADE_FOUNDRY_OUT||path.join(ROOT,'.artifacts/factory/tower-panic-v2')),MEMORY_ROOT=path.resolve(process.env.ARCADE_FOUNDRY_MEMORY_ROOT||path.join(ROOT,'factory/memory'));
const DISCOVERY_SEEDS=[0x7a00,0x7ae9,0x7bd2];
const CONFIRMATION_SEEDS=Array.from({length:8},(_,i)=>0x91000+i*271);
const POOL=adapter.allGenomes();
const INPUT_FILES=[
  'tower-panic.html','engine.js','autoplay.js','game-source.js','package.json','package-lock.json',
  'evals/harness.js','evals/evidence.js','evals/ablation.js','evals/tower-panic-eval.js',
  'factory/canonical.js','factory/store.js','factory/workspace.js','factory/phases.js','factory/cli.js','factory/adapters/tower-panic.js',
  'factory/schemas/experiment.schema.json','factory/schemas/design-claim.schema.json','designs/games/tower-panic.json','designs/mechanics/telegraphed-interception.json','factory/memory/schema-lock.json'
];
const PROTECTED=['evals/visual-reviews/tower-panic.json','evals/visual-receipts/tower-panic-contact-sheet.png'];
const key=genome=>String(genome.threatLeadFrames);
function resultPayload(result){const copy=JSON.parse(JSON.stringify(result));delete copy.payloadSha256;return copy}
function addPayloadHash(value){value.payloadSha256=canonical.hash(resultPayload(value));return value}
function assertPayload(value){if(value.payloadSha256!==canonical.hash(resultPayload(value)))throw new Error(`payload hash mismatch: ${value.id||value.schema}`)}
function provenance(){
  const currentHead=child.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),inputManifest=workspace.snapshot(ROOT,INPUT_FILES),protectedManifest=workspace.snapshot(ROOT,PROTECTED);
  const dirty=child.execFileSync('git',['diff','--binary','--',...INPUT_FILES],{cwd:ROOT,encoding:'utf8'}),untracked=INPUT_FILES.filter(file=>{try{child.execFileSync('git',['ls-files','--error-unmatch',file],{cwd:ROOT,stdio:'ignore'});return false}catch{return true}}).map(file=>inputManifest.entries.find(entry=>entry.path===file));
  return{baselineCommit:'fef56f64a2ee7fe83a3beefbbe8361c09e016a2a',currentHead,dirtyInputHash:canonical.hash({trackedDiff:dirty,untracked}),inputManifest,protectedManifest,runtime:{node:process.version,platform:process.platform,arch:process.arch}};
}
function evaluate(genome,evaluation){
  const handle=workspace.create(ROOT,adapter);try{const patch=adapter.applyGenome(handle.workspace,genome),before=workspace.assertPolicy(handle,adapter,'before evaluation');if(JSON.stringify(before.changed)!==JSON.stringify(patch.changedLines?['tower-panic.html']:[]))throw new Error('candidate patch changed unexpected paths');
    const patchedTreeSha256=before.workspaceTree.sha256,result=adapter.evaluate(handle.workspace,genome,evaluation),after=workspace.assertPolicy(handle,adapter,'after evaluation');if(after.workspaceTree.sha256!==patchedTreeSha256)throw new Error('candidate mutated workspace during evaluation');
    const candidateSourceHash=after.workspaceTree.entries.find(entry=>entry.path==='tower-panic.html').sha256;if(patch.afterHash!==candidateSourceHash)throw new Error('candidate source hash does not match patch receipt');return addPayloadHash({...result,patch,candidateSourceHash})
  }finally{workspace.remove(handle)}
}
function dominates(a,b){const dimensions=['safety','progress','tacticalLegibilityProxy'];return dimensions.every(d=>a.quality[d]>=b.quality[d])&&dimensions.some(d=>a.quality[d]>b.quality[d])}
function front(results){return results.filter(a=>a.eligible&&!results.some(b=>b!==a&&b.eligible&&dominates(b,a))).sort((a,b)=>key(a.genome).localeCompare(key(b.genome)))}
function select(results){const incumbent=results.find(result=>result.genome.threatLeadFrames===0);if(!incumbent||!incumbent.eligible)throw new Error('incumbent failed confirmation gates');const promoted=results.filter(result=>result!==incumbent&&result.eligible&&dominates(result,incumbent));return promoted.length?promoted.sort((a,b)=>key(a.genome).localeCompare(key(b.genome)))[0]:incumbent}
function discoveryPath(){return path.join(OUT,'discovery.json')}
function searchPath(mode){return path.join(OUT,`search-${mode}.json`)}
function experimentPath(){return path.join(OUT,'experiment.json')}
function readBoundArtifact(file){const sidecar=store.readJson(file+'.sha256'),expected=sidecar.sha256,actual=workspace.fileHash(file);if(!/^[a-f0-9]{64}$/.test(expected)||expected!==actual)throw new Error(`phase artifact binding failed: ${file}`);const value=store.readJson(file);assertPayload(value);return value}
function discover(){
  const source=provenance(),evaluation={frames:9000,seeds:DISCOVERY_SEEDS,epoch:'tower-panic-discovery-v2'},results=POOL.map(genome=>evaluate(genome,evaluation)),target=results.find(result=>result.genome.threatLeadFrames===36);
  if(!target||target.eligible||!target.runs.some(run=>!run.gates.rescues))throw new Error('discovery did not measure the high-lead rescue-floor failure');
  const support=target.runs.filter(run=>!run.gates.rescues).map(run=>({seed:run.seed,resultPayloadSha256:target.payloadSha256,failedGate:'rescues',rescues:run.stats.rescues}));
  const claim=addPayloadHash({schema:'arcade-foundry-design-claim/v1',id:'tower-panic-high-lead-rescue-floor-v2',game:'tower-panic',evaluationEpoch:evaluation.epoch,inputManifestSha256:source.inputManifest.sha256,predicate:{field:'threatLeadFrames',operator:'equals',value:36},statement:'Skip threatLeadFrames=36 in a fresh confirmation epoch because discovery produced per-seed rescue-floor failures.',support,validationTarget:{threatLeadFrames:36}});
  const claimFile=path.join(MEMORY_ROOT,'claims',`${claim.id}-${claim.payloadSha256}.json`),claimWrite=store.writeImmutable(claimFile,claim);
  const record=addPayloadHash({schema:'arcade-foundry-discovery/v1',id:'tower-panic-discovery-v2',source,evaluation,pool:POOL,poolSha256:canonical.hash(POOL),results,claim:{path:path.relative(ROOT,claimFile),payloadSha256:claim.payloadSha256,fileSha256:claimWrite.sha256}});
  const receipt=store.writeArtifact(discoveryPath(),record);store.writeArtifact(discoveryPath()+'.sha256',{sha256:receipt.sha256});return{path:discoveryPath(),fileSha256:receipt.sha256,record}
}
function loadDiscovery(withClaim){const record=readBoundArtifact(discoveryPath());if(withClaim===false)return{record,claim:null};const claimFile=process.env.ARCADE_FOUNDRY_CLAIM?path.resolve(process.env.ARCADE_FOUNDRY_CLAIM):path.join(ROOT,record.claim.path),claim=store.readJson(claimFile);assertPayload(claim);if(claim.payloadSha256!==record.claim.payloadSha256||workspace.fileHash(claimFile)!==record.claim.fileSha256)throw new Error('persisted claim binding failed');if(claim.inputManifestSha256!==record.source.inputManifest.sha256)throw new Error('claim input manifest mismatch');return{record,claim}}
function matches(claim,genome){return claim.predicate.field==='threatLeadFrames'&&claim.predicate.operator==='equals'&&genome.threatLeadFrames===claim.predicate.value}
function search(mode){
  if(!['memory-on','memory-off'].includes(mode))throw new Error(`unknown search mode: ${mode}`);const{record:discovery,claim}=loadDiscovery(mode==='memory-on'),source=provenance();if(source.inputManifest.sha256!==discovery.source.inputManifest.sha256)throw new Error('search source differs from discovery source');
  const evaluation={frames:9000,seeds:CONFIRMATION_SEEDS,epoch:'tower-panic-confirmation-v2'},poolSha256=canonical.hash(POOL);if(poolSha256!==discovery.poolSha256)throw new Error('precommitted pool changed after discovery');
  const skipped=mode==='memory-on'?POOL.filter(genome=>matches(claim,genome)):[],evaluatedGenomes=POOL.filter(genome=>!skipped.some(item=>key(item)===key(genome))),results=evaluatedGenomes.map(genome=>evaluate(genome,evaluation)),selected=select(results);
  const cache={schema:'arcade-foundry-result-cache/v1',keyFields:['inputManifestSha256','evaluationEpoch','genome','seed','frames'],initialEntries:[]};
  const record=addPayloadHash({schema:'arcade-foundry-search/v1',id:`tower-panic-${mode}-v2`,mode,source,evaluation,pool:POOL,poolSha256,cache,claim:mode==='memory-on'?{id:claim.id,payloadSha256:claim.payloadSha256}:null,skipped,evaluatedGenomes,results,eligibleFront:front(results).map(result=>({genome:result.genome,candidateSourceHash:result.candidateSourceHash,quality:result.quality})),selected:{genome:selected.genome,candidateSourceHash:selected.candidateSourceHash,reason:selected.genome.threatLeadFrames===0?'retain-incumbent-no-strict-dominator':'strictly-dominates-incumbent'},cost:{proposed:POOL.length,skippedByClaim:skipped.length,cacheHits:0,executedCandidateEvaluations:results.length,seedRuns:results.length*evaluation.seeds.length,seedFrames:results.length*evaluation.seeds.length*evaluation.frames}});
  const receipt=store.writeArtifact(searchPath(mode),record);store.writeArtifact(searchPath(mode)+'.sha256',{sha256:receipt.sha256});return{path:searchPath(mode),fileSha256:receipt.sha256,record}
}
function causalReceipt(){
  const pairs=[];for(const seed of DISCOVERY_SEEDS){const control=workspace.create(ROOT,adapter),intervention=workspace.create(ROOT,adapter);try{adapter.applyGenome(control.workspace,{threatLeadFrames:0});adapter.applyGenome(intervention.workspace,{threatLeadFrames:36});const a=bootGame('tower-panic',{root:control.workspace,seed}),b=bootGame('tower-panic',{root:intervention.workspace,seed});let found=null;
      for(let frame=1;frame<=9000;frame++){a.frames(1,false);b.frames(1,false);const pa=a.sandbox.__towerPanicFoundryProbe(),pb=b.sandbox.__towerPanicFoundryProbe();if(canonical.stringify(pa.intent)!==canonical.stringify(pb.intent)){found={seed,firstIntentDivergenceFrame:frame,environmentSameAtDivergence:canonical.stringify(pa.environment)===canonical.stringify(pb.environment),interventionAnticipations:pb.activation.threatAnticipations};break}}
      if(!found)throw new Error(`parameter did not cause intent divergence for seed ${seed}`);workspace.assertPolicy(control,adapter,'causal control');workspace.assertPolicy(intervention,adapter,'causal intervention');pairs.push(found);
    }finally{workspace.remove(control);workspace.remove(intervention)}}
  return{schema:'arcade-foundry-causal-receipt/v1',control:{threatLeadFrames:0},intervention:{threatLeadFrames:36},pairs,ok:pairs.filter(pair=>pair.environmentSameAtDivergence&&pair.interventionAnticipations>0).length>=2,seedRuns:pairs.length*2,seedFrames:pairs.reduce((total,pair)=>total+pair.firstIntentDivergenceFrame*2,0)};
}
function assemble(){
  const discovery=readBoundArtifact(discoveryPath()),on=readBoundArtifact(searchPath('memory-on')),off=readBoundArtifact(searchPath('memory-off'));
  const validation=off.results.find(result=>result.genome.threatLeadFrames===36);if(!validation)throw new Error('memory-off control did not evaluate skipped region');const skippedValidated=!validation.eligible&&validation.runs.some(run=>!run.gates.rescues),causal=causalReceipt();
  const sameInputs=on.poolSha256===off.poolSha256&&on.source.inputManifest.sha256===off.source.inputManifest.sha256&&canonical.stringify(on.evaluation)===canonical.stringify(off.evaluation)&&canonical.stringify(on.cache)===canonical.stringify(off.cache),sameSelection=canonical.stringify(on.selected)===canonical.stringify(off.selected);
  const source=provenance(),protectedUnchanged=source.protectedManifest.sha256===discovery.source.protectedManifest.sha256;
  const acceptance={coldStartClaimLoaded:on.claim&&on.claim.payloadSha256===discovery.claim.payloadSha256,identicalPrecommittedPoolAndCache:sameInputs,freshHoldoutWorkSkipped:on.skipped.some(genome=>genome.threatLeadFrames===36)&&!on.results.some(result=>result.genome.threatLeadFrames===36),memoryOffValidatedSkippedRegion:skippedValidated,fewerConfirmationEvaluations:on.cost.executedCandidateEvaluations<off.cost.executedCandidateEvaluations,sameSourceBoundSelection:sameSelection,perSeedHardGateRejectedRegion:!validation.eligible,parameterCausallyActive:causal.ok,protectedArtifactsUnchanged:protectedUnchanged};
  const experiment=addPayloadHash({schema:'arcade-foundry-experiment/v2',id:'tower-panic-cumulative-learning-v2',status:{learningTrialOk:Object.values(acceptance).every(Boolean),focusedVerificationOk:null,automatedVisualOk:null,humanVisualGate:'pending',repositoryVerificationOk:false,releaseEligible:false},source,discovery:{path:path.relative(ROOT,discoveryPath()),payloadSha256:discovery.payloadSha256,fileSha256:workspace.fileHash(discoveryPath())},memoryAware:{path:path.relative(ROOT,searchPath('memory-on')),payloadSha256:on.payloadSha256,fileSha256:workspace.fileHash(searchPath('memory-on'))},memoryOff:{path:path.relative(ROOT,searchPath('memory-off')),payloadSha256:off.payloadSha256,fileSha256:workspace.fileHash(searchPath('memory-off'))},causal,acceptance,selection:on.selected,cost:{productionCandidateEvaluations:discovery.results.length+on.results.length,controlCandidateEvaluations:off.results.length,totalExecutedCandidateEvaluations:discovery.results.length+on.results.length+off.results.length,productionSeedRuns:discovery.results.length*DISCOVERY_SEEDS.length+on.cost.seedRuns,controlSeedRuns:off.cost.seedRuns,causalSeedRuns:causal.seedRuns,totalSeedFrames:discovery.results.length*DISCOVERY_SEEDS.length*9000+on.cost.seedFrames+off.cost.seedFrames+causal.seedFrames}});
  const receipt=store.writeArtifact(experimentPath(),experiment),ledger={schema:'arcade-foundry-experiment-record/v1',id:experiment.id,payloadSha256:experiment.payloadSha256,artifactFileSha256:receipt.sha256,artifact:path.relative(ROOT,experimentPath()),claimIds:[discovery.claim.path],learningTrialOk:experiment.status.learningTrialOk};
  const ledgerFile=path.join(MEMORY_ROOT,'experiments',`${experiment.id}-${experiment.payloadSha256}.json`);store.writeImmutable(ledgerFile,ledger);store.writeArtifact(experimentPath()+'.receipt.json',{...ledger,ledger:path.relative(ROOT,ledgerFile)});return{path:experimentPath(),fileSha256:receipt.sha256,experiment}
}

module.exports={ROOT,OUT,DISCOVERY_SEEDS,CONFIRMATION_SEEDS,POOL,INPUT_FILES,PROTECTED,key,addPayloadHash,assertPayload,provenance,evaluate,dominates,front,select,discover,search,assemble,discoveryPath,searchPath,experimentPath};
