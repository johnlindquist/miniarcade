'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const canonical=require('./canonical');

function byteHash(data){return crypto.createHash('sha256').update(data).digest('hex')}
function writeImmutable(file,value){
  const data=typeof value==='string'?value:canonical.stringify(value);fs.mkdirSync(path.dirname(file),{recursive:true});
  try{fs.writeFileSync(file,data,{flag:'wx'});return{created:true,sha256:byteHash(data),bytes:Buffer.byteLength(data)}}
  catch(error){if(error.code!=='EEXIST')throw error;const existing=fs.readFileSync(file);if(!existing.equals(Buffer.from(data)))throw new Error(`immutable record collision: ${file}`);return{created:false,sha256:byteHash(existing),bytes:existing.length}}
}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'))}
function writeArtifact(file,value){const data=canonical.stringify(value);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);return{sha256:byteHash(data),bytes:Buffer.byteLength(data)}}

module.exports={byteHash,writeImmutable,readJson,writeArtifact};
