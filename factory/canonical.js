'use strict';

const crypto=require('crypto');

function normalize(value){
  if(Array.isArray(value))return value.map(normalize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])]));
  if(typeof value==='number'&&!Number.isFinite(value))throw new TypeError('canonical JSON rejects non-finite numbers');
  if(value===undefined)throw new TypeError('canonical JSON rejects undefined');
  return value;
}
function stringify(value){return JSON.stringify(normalize(value),null,2)+'\n'}
function hash(value){return crypto.createHash('sha256').update(typeof value==='string'?value:stringify(value)).digest('hex')}

module.exports={normalize,stringify,hash};
