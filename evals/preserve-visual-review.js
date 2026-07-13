#!/usr/bin/env node
'use strict';

// Explicit maintainer action for accepting already-reviewed montage bytes.
// Ordinary visual evals never write evals/visual-receipts/. Protocol receipts
// additionally require the generated provenance sidecar for the exact source.
const fs=require('fs');
const path=require('path');
const{sha256,verifyReviewReceipt,AMBIENT_EVIDENCE_PROTOCOL}=require('./visual-harness');

function defaultSourceCandidates(root,game){return[
  path.join(root,'.artifacts','visual',game,'contact-sheet.png'),
  path.join(root,'..','.artifacts','visual',game,'contact-sheet.png'),
  path.join(root,'.artifacts','visual',game,game+'-contact-sheet.png'),
  path.join(root,'..','.artifacts','visual',game,game+'-contact-sheet.png'),
  path.join(root,'.artifacts',game+'-visual','reference-contact-sheet.png'),
  path.join(root,'..','.artifacts',game+'-visual','reference-contact-sheet.png'),
  path.join(root,'.artifacts',game+'-visual','eval-contact-sheet.png'),
  path.join(root,'..','.artifacts',game+'-visual','eval-contact-sheet.png')
]}

function targetFor(root,game){return path.join(root,'evals','visual-receipts',game+(game==='grave-garden'?'-scale':'')+'-contact-sheet.png')}
function provenanceCandidates(source){
  const ext=path.extname(source),stem=source.slice(0,-ext.length),dir=path.dirname(source);
  return[stem+'.provenance.json',stem+'-provenance.json',path.join(dir,'visual-provenance.json'),path.join(dir,'provenance.json')];
}
function isProtocolReceipt(review){return!!(review&&(review.evidenceManifest||review.dependencyManifest||review.protocol===AMBIENT_EVIDENCE_PROTOCOL))}

function preserveVisualReview(game,options){
  options=options||{};
  if(typeof game!=='string'||!/^[a-z0-9-]+$/.test(game))throw new Error('invalid game slug '+game);
  const root=path.resolve(options.root||path.join(__dirname,'..')),
    reviewPath=options.reviewPath||path.join(root,'evals','visual-reviews',game+'.json'),
    target=options.targetPath||targetFor(root,game);
  if(!fs.existsSync(reviewPath))throw new Error(`${game}: semantic review is missing`);
  const review=JSON.parse(fs.readFileSync(reviewPath,'utf8'));
  if(review.verdict!=='pass'||!/^[a-f0-9]{64}$/.test(review.montageSha256||''))throw new Error(`${game}: semantic review is not an approved hash`);
  const candidates=(options.sourceCandidates||defaultSourceCandidates(root,game)).filter(file=>fs.existsSync(file)&&fs.statSync(file).isFile()),
    matching=candidates.filter(file=>sha256(file)===review.montageSha256);
  if(!matching.length)throw new Error(`${game}: no generated contact sheet matches approved ${review.montageSha256}; checked ${candidates.length} existing candidate(s)`);

  const rejected=[];
  for(const source of matching){
    let provenance=null;
    if(isProtocolReceipt(review)){
      const provenancePath=(options.provenancePath&&fs.existsSync(options.provenancePath)?options.provenancePath:
        provenanceCandidates(source).find(file=>fs.existsSync(file)&&fs.statSync(file).isFile()));
      if(!provenancePath){rejected.push(`${path.relative(root,source)}: generated visual provenance is missing`);continue}
      try{provenance=JSON.parse(fs.readFileSync(provenancePath,'utf8'))}catch(error){rejected.push(`${path.relative(root,source)}: generated visual provenance is invalid: ${error.message}`);continue}
      if(provenance.montageSha256!==sha256(source)){rejected.push(`${path.relative(root,source)}: generated visual provenance montage is stale`);continue}
    }
    const checked=verifyReviewReceipt(review,{root,game,montageSha256:sha256(source),
      evidenceManifest:provenance&&provenance.evidenceManifest,provenance});
    if(!checked.ok){rejected.push(`${path.relative(root,source)}: ${checked.errors.join('; ')}`);continue}
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(source,target);
    const actual=sha256(target);
    if(actual!==review.montageSha256)throw new Error(`${game}: preserved montage verification failed after copy`);
    return{game,source,target,sha256:actual,protocol:isProtocolReceipt(review)?AMBIENT_EVIDENCE_PROTOCOL:'legacy'};
  }
  throw new Error(`${game}: matching montage bytes were refused because review/source/evidence identity is stale: ${rejected.join(' | ')}`);
}

function main(args){
  const games=args||process.argv.slice(2);
  if(!games.length)throw new Error('usage: node evals/preserve-visual-review.js <game> [...]');
  for(const game of games){
    const result=preserveVisualReview(game);
    console.log(`${game}: preserved ${result.sha256} from ${path.relative(path.join(__dirname,'..'),result.source)}`);
  }
}

if(require.main===module)main();
module.exports={defaultSourceCandidates,targetFor,provenanceCandidates,preserveVisualReview,main};
