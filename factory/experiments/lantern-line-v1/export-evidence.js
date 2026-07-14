#!/usr/bin/env node
'use strict';

const fs=require('fs');
const os=require('os');
const path=require('path');
const canonical=require('../../canonical');
const store=require('../../store');
const workspace=require('../../workspace');
const verify=require('./verify-artifact');
const phases=require('./phases');

function walk(root,dir,entries){for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),relative=path.relative(root,file),stat=fs.lstatSync(file);if(stat.isSymbolicLink())entries.push({path:relative,type:'symlink'});else if(stat.isDirectory())walk(root,file,entries);else entries.push({path:relative,type:stat.isFile()?'file':'other'})}}
function samePaths(left,right){return canonical.stringify([...left].sort())===canonical.stringify([...right].sort())}
function regularFile(root,relative,failures){
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||path.normalize(relative)!==relative){failures.push(`non-canonical package path: ${relative}`);return null}
  let file;try{file=workspace.safePath(root,relative)}catch(error){failures.push(error.message);return null}
  if(!fs.existsSync(file)){failures.push(`package file missing: ${relative}`);return null}
  const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()){failures.push(`package path is not a regular file: ${relative}`);return null}
  try{workspace.realContained(root,file)}catch(error){failures.push(error.message);return null}
  return file;
}
function expectedPaths(experiment,receipt){return[
  experiment.discovery.path,experiment.discovery.path+'.sha256',
  experiment.memoryAware.path,experiment.memoryAware.path+'.sha256',
  experiment.memoryOff.path,experiment.memoryOff.path+'.sha256',
  path.relative(phases.ROOT,phases.experimentPath()),
  path.relative(phases.ROOT,phases.experimentPath())+'.receipt.json',
  receipt.ledger,
  path.relative(phases.ROOT,path.join(phases.OUT,'mutation-receipt.json')),
  path.relative(phases.ROOT,path.join(phases.OUT,'promotion.json')),
  path.relative(phases.ROOT,path.join(phases.OUT,'promotion-mutation-receipt.json'))
].sort()}
function verifyPackage(dir){
  dir=path.resolve(dir);const failures=[],manifestFile=path.join(dir,'manifest.json');let manifest=null;
  if(!fs.existsSync(manifestFile)||fs.lstatSync(manifestFile).isSymbolicLink()||!fs.lstatSync(manifestFile).isFile())return{ok:false,failures:['manifest is not a regular file'],files:0,payloadSha256:null};
  try{manifest=store.readJson(manifestFile)}catch(error){return{ok:false,failures:[`manifest unreadable: ${error.message}`],files:0,payloadSha256:null}}
  if(manifest.schema!=='arcade-foundry-evidence-package/v1')failures.push('manifest schema mismatch');
  if(!Array.isArray(manifest.files))failures.push('manifest files missing');
  const listed=[];
  for(const entry of manifest.files||[]){
    if(!entry||typeof entry!=='object'){failures.push('invalid manifest entry');continue}
    listed.push(entry.path);const file=regularFile(dir,entry.path,failures);if(!file)continue;
    const stat=fs.lstatSync(file);if(workspace.fileHash(file)!==entry.sha256||stat.size!==entry.bytes)failures.push(`manifest binding mismatch: ${entry.path}`);
  }
  if(new Set(listed).size!==listed.length)failures.push('manifest contains duplicate paths');
  const actual=[];walk(dir,dir,actual);const unexpectedType=actual.find(entry=>entry.type!=='file');if(unexpectedType)failures.push(`package contains ${unexpectedType.type}: ${unexpectedType.path}`);
  const actualFiles=actual.filter(entry=>entry.type==='file'&&entry.path!=='manifest.json').map(entry=>entry.path);if(!samePaths(listed,actualFiles))failures.push('manifest does not exactly enumerate package files');
  const payload={...manifest};delete payload.payloadSha256;if(manifest.payloadSha256!==canonical.hash(payload))failures.push('manifest payload mismatch');
  const experimentEntries=(manifest.files||[]).filter(entry=>entry.path.endsWith('/experiment.json'));
  if(experimentEntries.length!==1)failures.push('package must contain exactly one experiment');
  else{
    const experimentEntry=experimentEntries[0],experimentFile=regularFile(dir,experimentEntry.path,failures);
    if(experimentFile){
      const report=verify.verifyArtifact(experimentFile,{artifactRoot:dir});if(!report.ok)failures.push(...report.failures.map(failure=>'experiment: '+failure));if(report.payloadSha256!==manifest.experimentPayloadSha256)failures.push('experiment payload binding mismatch');
      try{
        const experiment=store.readJson(experimentFile),receipt=store.readJson(experimentFile+'.receipt.json'),expected=expectedPaths(experiment,receipt);
        if(!samePaths(listed,expected))failures.push('package semantic file closure mismatch');
        const canonicalLedger=phases.experimentLedgerRelative(experiment);if(receipt.ledger!==canonicalLedger||!listed.includes(canonicalLedger))failures.push('canonical immutable ledger is not manifest-bound');
      }catch(error){failures.push(`package closure unreadable: ${error.message}`)}
    }
  }
  return{ok:!failures.length,failures,files:(manifest.files||[]).length,payloadSha256:manifest.payloadSha256};
}
function exportPackage(dir){
  const report=verify.verifyArtifact(phases.experimentPath());if(!report.ok)throw new Error('cannot export unverified experiment: '+report.failures.join('; '));fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
  const experiment=store.readJson(phases.experimentPath()),receipt=store.readJson(phases.experimentPath()+'.receipt.json'),sources=[phases.experimentPath(),phases.experimentPath()+'.receipt.json',path.resolve(phases.ROOT,experiment.discovery.path),path.resolve(phases.ROOT,experiment.discovery.path)+'.sha256',path.resolve(phases.ROOT,experiment.memoryAware.path),path.resolve(phases.ROOT,experiment.memoryAware.path)+'.sha256',path.resolve(phases.ROOT,experiment.memoryOff.path),path.resolve(phases.ROOT,experiment.memoryOff.path)+'.sha256',path.resolve(phases.ROOT,receipt.ledger),path.join(phases.OUT,'mutation-receipt.json'),path.join(phases.OUT,'promotion.json'),path.join(phases.OUT,'promotion-mutation-receipt.json')];
  for(const source of sources){const target=path.join(dir,path.relative(phases.ROOT,source));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target)}
  const files=[];walk(dir,dir,files);const entries=files.filter(entry=>entry.type==='file'&&entry.path!=='manifest.json').map(entry=>{const full=path.join(dir,entry.path);return{path:entry.path,sha256:workspace.fileHash(full),bytes:fs.lstatSync(full).size}}),manifest={schema:'arcade-foundry-evidence-package/v1',experimentPayloadSha256:experiment.payloadSha256,files:entries};manifest.payloadSha256=canonical.hash(manifest);store.writeArtifact(path.join(dir,'manifest.json'),manifest);return verifyPackage(dir);
}
function mutationEval(dir){
  const receipts=[];
  function run(name,mutate){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'lantern-evidence-mutation-'));try{
      fs.cpSync(dir,root,{recursive:true});const manifestFile=path.join(root,'manifest.json'),manifest=store.readJson(manifestFile),experimentEntry=manifest.files.find(entry=>entry.path.endsWith('/experiment.json')),receiptPath=experimentEntry.path+'.receipt.json',receiptFile=path.join(root,receiptPath),receipt=store.readJson(receiptFile);mutate({root,manifest,experimentEntry,receiptPath,receiptFile,receipt});delete manifest.payloadSha256;manifest.payloadSha256=canonical.hash(manifest);store.writeArtifact(manifestFile,manifest);
      const report=verifyPackage(root),rejected=!report.ok;receipts.push({name,rejected,failures:report.failures});if(!rejected)throw new Error('accepted evidence-package mutation '+name);
    }finally{fs.rmSync(root,{recursive:true,force:true})}
  }
  run('ledger-self-alias',context=>{const ledger=context.receipt.ledger;context.receipt.ledger=context.receiptPath;store.writeArtifact(context.receiptFile,context.receipt);fs.rmSync(path.join(context.root,ledger));context.manifest.files=context.manifest.files.filter(entry=>entry.path!==ledger);const receiptEntry=context.manifest.files.find(entry=>entry.path===context.receiptPath);receiptEntry.sha256=workspace.fileHash(context.receiptFile);receiptEntry.bytes=fs.lstatSync(context.receiptFile).size});
  run('ledger-null-record',context=>{const ledgerFile=path.join(context.root,context.receipt.ledger),ledgerEntry=context.manifest.files.find(entry=>entry.path===context.receipt.ledger);store.writeArtifact(ledgerFile,null);ledgerEntry.sha256=workspace.fileHash(ledgerFile);ledgerEntry.bytes=fs.lstatSync(ledgerFile).size});
  const receipt={schema:'lantern-line-evidence-package-mutation-receipt/v1',mutations:receipts.length,rejected:receipts.filter(item=>item.rejected).length,receipts};store.writeArtifact(path.join(phases.OUT,'evidence-package-mutation-receipt.json'),receipt);return receipt;
}

const command=process.argv[2]||'export',dir=path.resolve(process.argv[3]||path.join(phases.OUT,'evidence-package'));let report;
if(command==='export')report=exportPackage(dir);else if(command==='verify')report=verifyPackage(dir);else if(command==='mutations')report=mutationEval(dir);else throw new Error(`usage: node ${process.argv[1]} [export|verify|mutations] [dir]`);
console.log(JSON.stringify(report,null,2));if(report.ok===false||report.rejected!==undefined&&report.rejected!==report.mutations)process.exit(1);
module.exports={exportPackage,verifyPackage,mutationEval};
