#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const canonical=require('./canonical');
const store=require('./store');

const ROOT=path.resolve(__dirname,'..');
function check(condition,message){if(!condition)throw new Error(message)}
function contained(root,relative){check(typeof relative==='string'&&!path.isAbsolute(relative),'evidence path must be relative');const target=path.resolve(root,relative),rel=path.relative(root,target);check(rel===''||(!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel)),`evidence path escapes root: ${relative}`);return target}
function collect(experimentFile){
  const experiment=store.readJson(experimentFile),receipt=store.readJson(experimentFile+'.receipt.json'),files=new Set();
  for(const entry of[...experiment.source.inputManifest.entries,...experiment.source.protectedManifest.entries])files.add(entry.path);
  for(const relative of['AGENTS.md','README.md','factory/verify-artifact.js','factory/export-evidence.js','factory/mutation-eval.js','factory/factory-eval.js'])files.add(relative);
  const experimentRelative=path.relative(ROOT,experimentFile);files.add(experimentRelative);files.add(experimentRelative+'.receipt.json');
  for(const reference of[experiment.discovery,experiment.memoryAware,experiment.memoryOff]){files.add(reference.path);files.add(reference.path+'.sha256')}
  const discovery=store.readJson(contained(ROOT,experiment.discovery.path));files.add(discovery.claim.path);files.add(receipt.ledger);
  const verification=path.join(path.dirname(experimentFile),'verification.json');if(fs.existsSync(verification))files.add(path.relative(ROOT,verification));
  return[...files].sort();
}
function exportEvidence(experimentFile=path.join(ROOT,'.artifacts/factory/tower-panic-v2/experiment.json'),out=path.join(ROOT,'.artifacts/factory/tower-panic-v2/evidence-package')){
  experimentFile=path.resolve(experimentFile);out=path.resolve(out);fs.rmSync(out,{recursive:true,force:true});const repositoryRoot=path.join(out,'repository-root'),entries=[];
  for(const relative of collect(experimentFile)){const source=contained(ROOT,relative),stat=fs.lstatSync(source);check(stat.isFile()&&!stat.isSymbolicLink(),`evidence source is not a regular file: ${relative}`);const target=contained(repositoryRoot,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);fs.chmodSync(target,stat.mode&0o777);const data=fs.readFileSync(target);entries.push({path:relative,sha256:store.byteHash(data),bytes:data.length,mode:stat.mode&0o777})}
  const manifest={schema:'arcade-foundry-evidence-package/v1',experimentArtifact:path.relative(ROOT,experimentFile),entries};manifest.payloadSha256=canonical.hash(manifest);store.writeArtifact(path.join(out,'manifest.json'),manifest);return{out,manifest}
}
function verifyExport(out){
  out=path.resolve(out);const manifest=store.readJson(path.join(out,'manifest.json')),copy={...manifest};delete copy.payloadSha256;check(manifest.payloadSha256===canonical.hash(copy),'evidence manifest payload hash mismatch');const repositoryRoot=path.join(out,'repository-root');for(const entry of manifest.entries){const file=contained(repositoryRoot,entry.path),stat=fs.lstatSync(file),data=fs.readFileSync(file);check(stat.isFile()&&!stat.isSymbolicLink()&&data.length===entry.bytes&&store.byteHash(data)===entry.sha256&&(stat.mode&0o777)===entry.mode,`evidence package file mismatch: ${entry.path}`)}return{schema:'arcade-foundry-evidence-package-verification/v1',payloadSha256:manifest.payloadSha256,files:manifest.entries.length,ok:true}
}
if(require.main===module){try{const command=process.argv[2]||'export',target=process.argv[3];const result=command==='verify'?verifyExport(target||path.join(ROOT,'.artifacts/factory/tower-panic-v2/evidence-package')):exportEvidence(target);console.log(canonical.stringify(result.manifest?{out:path.relative(ROOT,result.out),payloadSha256:result.manifest.payloadSha256,files:result.manifest.entries.length,ok:true}:result).trim())}catch(error){console.error(error.stack||error.message);process.exit(1)}}
module.exports={collect,exportEvidence,verifyExport};
