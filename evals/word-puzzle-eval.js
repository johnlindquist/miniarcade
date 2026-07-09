#!/usr/bin/env node
'use strict';
const WordPuzzle=require('../word-puzzle');
let failed=false,checks=0;
const check=(condition,message)=>{checks++;if(!condition){failed=true;console.error('  FAIL:',message);}};

console.log('duplicate-safe marking and candidate filtering');
const marks=WordPuzzle.mark('ARROW','AWARE');
console.log(' ',marks.join('/'));
check(marks.join(',')==='green,yellow,miss,yellow,miss','duplicate letters were over-counted');
const answers=['ARROW','BRAWL','CROWN','GHOST'];
const left=WordPuzzle.possible(answers,[{word:'AWARE',marks}]);
check(left.length===1&&left[0]==='ARROW','candidate filtering lost the secret or kept impossible words');

console.log('information scoring prefers a discriminating guess');
const weak=WordPuzzle.informationScore(['ARROW','BRAWL','CROWN'],'ARROW');
const best=WordPuzzle.bestGuess(['ARROW','BRAWL','CROWN'],['ARROW','BRAWL','CROWN']);
console.log(`  ARROW score ${weak.toFixed(2)}, best ${best}`);
check(best!==null&&weak>0,'information scorer returned no useful guess');
check(WordPuzzle.sameMarks(['green'],['green']),'mark equality failed');
check(!WordPuzzle.sameMarks(['green'],['yellow']),'mark equality accepted a mismatch');

console.log(failed?`\nWORD PUZZLE EVAL FAILED (${checks})`:`\nWORD PUZZLE EVAL PASSED (${checks})`);
process.exit(failed?1:0);
