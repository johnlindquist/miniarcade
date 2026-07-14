#!/usr/bin/env node
'use strict';

const fs=require('fs');
const os=require('os');
const path=require('path');
const{spawnSync}=require('child_process');
const canonical=require('./canonical');
const store=require('./store');
const workspace=require('./workspace');
const adapter=require('./adapters/tower-panic');
const phases=require('./phases');
const verifier=require('./verify-artifact');
const exporter=require('./export-evidence');
const mutations=require('./mutation-eval');
const{bootGame}=require('../evals/harness');
const ROOT=path.resolve(__dirname,'..'),ARTIFACT=path.join(ROOT,'.artifacts/factory/tower-panic-v2/experiment.json');
let failed=false;const fail=message=>{failed=true;console.error('  FAIL:',message)};
function expectFailure(fn,pattern,label){try{fn();fail(label+' was accepted')}catch(error){if(pattern&&!pattern.test(error.message))fail(label+' failed for wrong reason: '+error.message)}}

console.log('1) canonical snapshots, traversal, symlink, additions, and post-run edits fail closed');
const files=[...adapter.allowedCandidateFiles,...adapter.requiredReadOnlyFiles,...adapter.forbiddenFiles],a=workspace.snapshot(ROOT,files),b=workspace.snapshot(ROOT,[...files].reverse());
if(a.sha256!==b.sha256||canonical.hash({b:2,a:1})!==canonical.hash({a:1,b:2}))fail('canonical ordering changed hashes');
expectFailure(()=>workspace.safePath(ROOT,'../escape'),/escapes/,'lexical path escape');
const handle=workspace.create(ROOT,adapter);try{
  const patch=adapter.applyGenome(handle.workspace,{threatLeadFrames:12}),policy=workspace.assertPolicy(handle,adapter,'pre-test');if(patch.changedLines!==1||JSON.stringify(policy.changed)!==JSON.stringify(['tower-panic.html']))fail('candidate patch was not exactly one marked line');
  fs.writeFileSync(path.join(handle.workspace,'added.js'),'x');expectFailure(()=>workspace.assertPolicy(handle,adapter,'added-file'),/forbidden path: added\.js/,'added file');fs.unlinkSync(path.join(handle.workspace,'added.js'));
  fs.symlinkSync('/tmp',path.join(handle.workspace,'escape-link'));expectFailure(()=>workspace.assertPolicy(handle,adapter,'symlink'),/(forbidden path|symlink)/,'symlink');fs.unlinkSync(path.join(handle.workspace,'escape-link'));
  fs.appendFileSync(path.join(handle.workspace,'games.js'),'\n// forbidden\n');expectFailure(()=>workspace.assertPolicy(handle,adapter,'post-run'),/forbidden path: games\.js/,'post-run forbidden edit');
}finally{workspace.remove(handle)}
const originalEvaluate=adapter.evaluate;try{adapter.evaluate=function(root,genome,options){const result=originalEvaluate.call(this,root,genome,options);fs.appendFileSync(path.join(root,'tower-panic.html'),' ');return result};expectFailure(()=>phases.evaluate({threatLeadFrames:12},{frames:60,seeds:[0x7a00]}),/mutated workspace/,'post-evaluation allowed-file content mutation');adapter.evaluate=function(root,genome,options){const result=originalEvaluate.call(this,root,genome,options);fs.chmodSync(path.join(root,'tower-panic.html'),0o600);return result};expectFailure(()=>phases.evaluate({threatLeadFrames:12},{frames:60,seeds:[0x7a00]}),/mutated workspace/,'post-evaluation allowed-file mode mutation')}finally{adapter.evaluate=originalEvaluate}

console.log('2) threat-lead parameter activates and causes same-seed intent divergence before environment drift');
let causalSeeds=0;
for(const seed of[0x7a00,0x7ae9,0x7bd2]){
  const base=workspace.create(ROOT,adapter),candidate=workspace.create(ROOT,adapter);try{adapter.applyGenome(base.workspace,{threatLeadFrames:0});adapter.applyGenome(candidate.workspace,{threatLeadFrames:36});const aGame=bootGame('tower-panic',{root:base.workspace,seed}),bGame=bootGame('tower-panic',{root:candidate.workspace,seed});let receipt=null;
    for(let frame=1;frame<=9000;frame++){aGame.frames(1,false);bGame.frames(1,false);const pa=aGame.sandbox.__towerPanicFoundryProbe(),pb=bGame.sandbox.__towerPanicFoundryProbe();if(canonical.stringify(pa.intent)!==canonical.stringify(pb.intent)){receipt={frame,environmentSame:canonical.stringify(pa.environment)===canonical.stringify(pb.environment),anticipations:pb.activation.threatAnticipations};break}}
    if(receipt&&receipt.environmentSame&&receipt.anticipations>0)causalSeeds++;
  }finally{workspace.remove(base);workspace.remove(candidate)}}
if(causalSeeds<2)fail(`parameter was causally active on only ${causalSeeds}/3 seeds`);

console.log('3) four cold-start phases produce a holdout-validated memory advantage');
const run=spawnSync(process.execPath,[path.join(__dirname,'cli.js'),'trial'],{cwd:ROOT,encoding:'utf8'});if(run.status!==0){process.stdout.write(run.stdout);process.stderr.write(run.stderr);fail('cold-start trial failed')}const verified=verifier.verify(ARTIFACT);if(!verified.ok)fail('independent verifier did not pass');
const discoveryFile=path.join(ROOT,'.artifacts/factory/tower-panic-v2/discovery.json'),discoveryBytes=fs.readFileSync(discoveryFile);try{const altered=JSON.parse(discoveryBytes);altered.id='self-consistent-substitution';delete altered.payloadSha256;altered.payloadSha256=canonical.hash(altered);fs.writeFileSync(discoveryFile,canonical.stringify(altered));const substituted=spawnSync(process.execPath,[path.join(__dirname,'cli.js'),'search','--memory-on'],{cwd:ROOT,encoding:'utf8'});if(substituted.status===0)fail('search accepted a replaced phase artifact')}finally{fs.writeFileSync(discoveryFile,discoveryBytes)}
const missing=spawnSync(process.execPath,[path.join(__dirname,'cli.js'),'search','--memory-on'],{cwd:ROOT,encoding:'utf8',env:{...process.env,ARCADE_FOUNDRY_CLAIM:path.join(os.tmpdir(),'missing-foundry-claim.json')}});if(missing.status===0)fail('memory-on search accepted a missing persisted claim');
const corruptDir=fs.mkdtempSync(path.join(os.tmpdir(),'foundry-claim-'));try{const corrupt=path.join(corruptDir,'claim.json');fs.writeFileSync(corrupt,'{}\n');const bad=spawnSync(process.execPath,[path.join(__dirname,'cli.js'),'search','--memory-on'],{cwd:ROOT,encoding:'utf8',env:{...process.env,ARCADE_FOUNDRY_CLAIM:corrupt}});if(bad.status===0)fail('memory-on search accepted a corrupt persisted claim')}finally{fs.rmSync(corruptDir,{recursive:true,force:true})}
const coldRoot=fs.mkdtempSync(path.join(ROOT,'.artifacts/factory/cold-start-'));try{const env={...process.env,ARCADE_FOUNDRY_OUT:path.join(coldRoot,'out'),ARCADE_FOUNDRY_MEMORY_ROOT:path.join(coldRoot,'memory')},discover=spawnSync(process.execPath,[path.join(__dirname,'cli.js'),'discover'],{cwd:ROOT,encoding:'utf8',env}),search=discover.status===0?spawnSync(process.execPath,[path.join(__dirname,'cli.js'),'search','--memory-on'],{cwd:ROOT,encoding:'utf8',env}):{status:1};if(discover.status!==0||search.status!==0||!fs.readdirSync(path.join(coldRoot,'memory/claims')).length)fail('empty durable store did not create then load a claim across processes')}finally{fs.rmSync(coldRoot,{recursive:true,force:true})}
const first=fs.readFileSync(ARTIFACT),rerun=spawnSync(process.execPath,[path.join(__dirname,'cli.js'),'trial'],{cwd:ROOT,encoding:'utf8'}),second=fs.readFileSync(ARTIFACT);if(rerun.status!==0||!first.equals(second))fail('identical cold-start rerun changed artifact bytes');

console.log('4) independent verifier rejects self-consistent semantic mutations and bad file hashes');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'foundry-verify-'));try{
  const original=store.readJson(ARTIFACT),bad=JSON.parse(JSON.stringify(original));bad.acceptance.fewerConfirmationEvaluations=false;delete bad.payloadSha256;bad.payloadSha256=canonical.hash(bad);const badFile=path.join(temp,'experiment.json');fs.writeFileSync(badFile,canonical.stringify(bad));const originalReceipt=store.readJson(ARTIFACT+'.receipt.json');fs.writeFileSync(badFile+'.receipt.json',canonical.stringify({...originalReceipt,payloadSha256:bad.payloadSha256,artifactFileSha256:store.byteHash(fs.readFileSync(badFile))}));expectFailure(()=>verifier.verify(badFile),/acceptance receipt mismatch/,'semantic acceptance mutation');
  fs.appendFileSync(badFile,' ');expectFailure(()=>verifier.verify(badFile),/artifact byte hash mismatch/,'artifact byte mutation');
}finally{fs.rmSync(temp,{recursive:true,force:true})}

console.log('5) fifteen semantic mutation classes fail closed');
try{mutations.run()}catch(error){fail('mutation matrix failed: '+error.message)}

console.log('6) manifest-driven evidence export is complete and independently verifiable');
try{const exported=exporter.exportEvidence(ARTIFACT),packageCheck=exporter.verifyExport(exported.out),packageRoot=path.join(exported.out,'repository-root'),packageArtifact=path.join(packageRoot,path.relative(ROOT,ARTIFACT)),artifactCheck=verifier.verify(packageArtifact,{root:packageRoot});if(!packageCheck.ok||!artifactCheck.ok)fail('exported evidence package did not verify')}catch(error){fail('evidence export failed: '+error.message)}

console.log('7) protected review and PNG bytes remain unchanged across the complete trial');
const experiment=store.readJson(ARTIFACT);if(experiment.source.protectedManifest.sha256!==workspace.snapshot(ROOT,['evals/visual-reviews/tower-panic.json','evals/visual-receipts/tower-panic-contact-sheet.png']).sha256)fail('protected visual artifacts changed');

console.log(failed?'\nARCADE FOUNDRY EVAL FAILED':'\nARCADE FOUNDRY EVAL PASSED');process.exit(failed?1:0);
