#!/usr/bin/env node
'use strict';

// Explicit maintainer action for accepting already-reviewed Darwin montage
// bytes. Ordinary visual evals never write evals/visual-receipts/.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const root=path.join(__dirname,'..'),games=process.argv.slice(2);
if(!games.length)throw new Error('usage: node evals/preserve-visual-review.js <game> [...]');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceCandidates=game=>[
  path.join(root,'.artifacts','visual',game,'contact-sheet.png'),
  path.join(root,'..','.artifacts','visual',game,'contact-sheet.png'),
  path.join(root,'.artifacts','visual',game,game+'-contact-sheet.png'),
  path.join(root,'..','.artifacts','visual',game,game+'-contact-sheet.png'),
  path.join(root,'.artifacts',game+'-visual','reference-contact-sheet.png'),
  path.join(root,'..','.artifacts',game+'-visual','reference-contact-sheet.png'),
  path.join(root,'.artifacts',game+'-visual','eval-contact-sheet.png'),
  path.join(root,'..','.artifacts',game+'-visual','eval-contact-sheet.png')
];
const targetFor=game=>path.join(__dirname,'visual-receipts',game+(game==='grave-garden'?'-scale':'')+'-contact-sheet.png');
for(const game of games){
  if(!/^[a-z0-9-]+$/.test(game))throw new Error('invalid game slug '+game);
  const reviewPath=path.join(__dirname,'visual-reviews',game+'.json'),target=targetFor(game);
  if(!fs.existsSync(reviewPath))throw new Error(`${game}: semantic review is missing`);
  const review=JSON.parse(fs.readFileSync(reviewPath,'utf8'));
  if(review.verdict!=='pass'||!/^[a-f0-9]{64}$/.test(review.montageSha256||''))throw new Error(`${game}: semantic review is not an approved hash`);
  const candidates=sourceCandidates(game).filter(file=>fs.existsSync(file)),source=candidates.find(file=>hash(file)===review.montageSha256);
  if(!source)throw new Error(`${game}: no generated contact sheet matches approved ${review.montageSha256}; checked ${candidates.length} existing candidate(s)`);
  const actual=hash(source);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
  console.log(`${game}: preserved ${actual} from ${path.relative(root,source)}`);
}
