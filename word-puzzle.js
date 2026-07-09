(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.WordPuzzle=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function mark(secret,word){
    const marks=Array(secret.length).fill('miss'),left={};
    for(let i=0;i<secret.length;i++)if(word[i]===secret[i])marks[i]='green';
    else left[secret[i]]=(left[secret[i]]||0)+1;
    for(let i=0;i<word.length;i++)if(marks[i]!=='green'&&(left[word[i]]||0)>0){
      marks[i]='yellow';left[word[i]]--;
    }
    return marks;
  }
  const sameMarks=(a,b)=>a.length===b.length&&a.every((value,i)=>value===b[i]);
  const matches=(secret,guess)=>sameMarks(mark(secret,guess.word),guess.marks);
  function possible(answers,guesses){
    return answers.filter(secret=>guesses.every(guess=>matches(secret,guess)));
  }
  function informationScore(answers,word){
    if(!answers.length)return 0;const groups=new Map();
    for(const secret of answers){const key=mark(secret,word).join(',');groups.set(key,(groups.get(key)||0)+1);}
    let expected=0;for(const n of groups.values())expected+=n*n/answers.length;
    return answers.length-expected;
  }
  function bestGuess(pool,answers){
    let best=null,score=-Infinity;
    for(const word of pool){const next=informationScore(answers,word);if(next>score){score=next;best=word;}}
    return best;
  }
  return Object.freeze({mark,sameMarks,matches,possible,informationScore,bestGuess});
});
