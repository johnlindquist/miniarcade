'use strict';

const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const canonical=require('./canonical');

function contained(root,target){const relative=path.relative(root,target);return relative===''||(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))}
function safePath(root,relative){
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative))throw new Error(`unsafe workspace path: ${relative}`);
  const target=path.resolve(root,relative);if(!contained(root,target))throw new Error(`workspace path escapes root: ${relative}`);return target;
}
function realContained(root,target){const realRoot=fs.realpathSync(root),realTarget=fs.realpathSync(target);if(!contained(realRoot,realTarget))throw new Error(`real path escapes root: ${target}`);return realTarget}
function fileHash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}
function snapshot(root,files){
  const entries=[...new Set(files)].sort().map(relative=>{const file=safePath(root,relative),stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile())throw new Error(`snapshot path is not a regular file: ${relative}`);realContained(root,file);return{path:relative,sha256:fileHash(file),bytes:stat.size,mode:stat.mode&0o777}});
  return{schema:'arcade-foundry-snapshot/v1',entries,sha256:canonical.hash(entries)};
}
function treeManifest(root){
  const entries=[];function walk(dir){for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),relative=path.relative(root,file),stat=fs.lstatSync(file);if(stat.isSymbolicLink()){entries.push({path:relative,type:'symlink',target:fs.readlinkSync(file),mode:stat.mode&0o777});continue}if(stat.isDirectory()){entries.push({path:relative,type:'directory',mode:stat.mode&0o777});walk(file)}else if(stat.isFile())entries.push({path:relative,type:'file',sha256:fileHash(file),bytes:stat.size,mode:stat.mode&0o777});else entries.push({path:relative,type:'other',mode:stat.mode&0o777})}}walk(root);return{entries,sha256:canonical.hash(entries)}}
function create(root,adapter,options){
  options=options||{};const files=[...new Set([...adapter.allowedCandidateFiles,...adapter.requiredReadOnlyFiles,...adapter.forbiddenFiles])].sort(),before=snapshot(root,files),workspace=fs.mkdtempSync(path.join(options.parent||os.tmpdir(),'arcade-foundry-'));
  for(const relative of files){const source=safePath(root,relative);realContained(root,source);const target=safePath(workspace,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);fs.chmodSync(target,fs.statSync(source).mode&0o777)}
  return{root,workspace,before,files,cleanTree:treeManifest(workspace)};
}
function assertPolicy(handle,adapter,phase){
  const afterRoot=snapshot(handle.root,handle.files);if(afterRoot.sha256!==handle.before.sha256)throw new Error(`factory mutated repository root during ${phase||'candidate run'}`);
  const tree=treeManifest(handle.workspace),beforeByPath=new Map(handle.cleanTree.entries.map(entry=>[entry.path,entry])),afterByPath=new Map(tree.entries.map(entry=>[entry.path,entry]));
  const all=[...new Set([...beforeByPath.keys(),...afterByPath.keys()])].sort(),changed=[];
  for(const file of all)if(canonical.stringify(beforeByPath.get(file)||null)!==canonical.stringify(afterByPath.get(file)||null))changed.push(file);
  const allowed=new Set(adapter.allowedCandidateFiles),forbidden=new Set(adapter.forbiddenFiles),violation=changed.find(file=>!allowed.has(file)||forbidden.has(file));
  if(violation)throw new Error(`candidate changed forbidden path: ${violation}`);
  if(tree.entries.some(entry=>entry.type==='symlink'))throw new Error('candidate workspace contains a symlink');
  return{changed,rootSnapshot:afterRoot,workspaceTree:tree};
}
function remove(handle){fs.rmSync(handle.workspace,{recursive:true,force:true})}

module.exports={safePath,realContained,fileHash,snapshot,treeManifest,create,assertPolicy,remove};
