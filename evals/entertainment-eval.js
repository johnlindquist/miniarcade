#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const{assertEntertainment}=require('./entertainment');
let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true};

const limits={
  minRooms:3,minBranches:4,maxStraight:8,
  minPuzzleTransitions:6,minPuzzleCompletions:1,
  minEnemyActions:8,minPlayerResponses:3,
  requiredDecisionKinds:['puzzle','threat','response','payoff'],
  minPerDecisionKind:1,maxDeadAir:240,deadAirUnit:'frames'
};

console.log('1) an authored puzzle encounter passes the shared contract');
{
  const errors=[];
  const result=assertEntertainment('fixture',{
    noVisiblePath:true,
    topology:{rooms:3,branches:7,maxStraight:6},
    puzzle:{transitions:12,completions:2},
    agency:{enemyActions:18,playerResponses:7},
    decisions:{puzzle:{count:12,source:'puzzleSteps'},threat:{count:18,source:'enemyTells'},response:{count:7,source:'playerResponses'},combat:{count:4,source:'combatBeats'},payoff:{count:2,source:'payoffs'}},
    maxDeadAir:150
  },limits,message=>errors.push(message));
  if(!result.ok||errors.length)fail('valid encounter was rejected: '+errors.join('; '));
  console.log('  setup, topology, agency, response, payoff, and dead-air evidence accepted');
}

console.log('2) a moving corridor/path-overlay demo fails loudly');
{
  const errors=[];
  const result=assertEntertainment('corridor',{
    noVisiblePath:false,
    topology:{rooms:1,branches:0,maxStraight:17},
    puzzle:{transitions:0,completions:0},
    agency:{enemyActions:0,playerResponses:0},
    decisions:{movement:{count:900,source:'moves'},replan:{count:60,source:'replans'}},
    maxDeadAir:900
  },limits,message=>errors.push(message));
  const expected=['navigation path','authored rooms','topology branches','straight traversal','puzzle transitions','puzzle completions','enemy actions','player responses','puzzle decisions','threat decisions','response decisions','payoff decisions','dead air'];
  if(result.ok)fail('corridor fixture passed');
  for(const phrase of expected)if(!errors.some(message=>message.includes(phrase)))fail('corridor failure omitted '+phrase+': '+errors.join('; '));
  console.log('  rejected with '+errors.length+' independent failures; movement/replans received no credit');
}

console.log('2b) permissive limits and aliased counters fail closed');
{
  const evidence={noVisiblePath:true,topology:{rooms:0,branches:0,maxStraight:0},puzzle:{transitions:0,completions:0},agency:{enemyActions:0,playerResponses:0},decisions:{puzzle:{count:99,source:'oneCounter'},threat:{count:99,source:'oneCounter'}},maxDeadAir:0};
  let threw=false;try{assertEntertainment('bad-limits',evidence,{minRooms:-1,minBranches:-1,maxStraight:Infinity,minPuzzleTransitions:-1,minPuzzleCompletions:-1,minEnemyActions:-1,minPlayerResponses:-1,requiredDecisionKinds:['puzzle','threat'],minPerDecisionKind:-1,maxDeadAir:Infinity},()=>{})}catch(error){threw=/must be finite and positive/.test(error.message)}
  if(!threw)fail('negative/Infinity limits were accepted');
  const errors=[];assertEntertainment('alias',{...evidence,topology:{rooms:3,branches:4,maxStraight:5},puzzle:{transitions:9,completions:2},agency:{enemyActions:9,playerResponses:9},maxDeadAir:10},{minRooms:3,minBranches:4,maxStraight:8,minPuzzleTransitions:6,minPuzzleCompletions:1,minEnemyActions:8,minPlayerResponses:3,requiredDecisionKinds:['puzzle','threat'],minPerDecisionKind:1,maxDeadAir:240},message=>errors.push(message));
  if(!errors.some(message=>message.includes('alias')))fail('one telemetry counter satisfied multiple decision categories');
  console.log('  invalid bands rejected; required decision categories need unique telemetry sources');
}

console.log('3) every active exploration game carries the contract and no path renderer');
{
  const games=['ghost-shift','pico-cap','dungeon-express','tower-panic'],forbidden=[
    ['route/path renderer',/\bfunction\s+draw(?:Route|Path)s?\b|\bdrawRoutes?\s*\(/],
    ['planner-memory presentation helper',/\bfunction\s+drawMemoryCues\b|\bdrawMemoryCues\s*\(/],
    ['visible route-plan copy',/VISIBLE (?:ROUTE )?PLAN|ROUTE HUD|FOLLOW THE (?:PATH|LINE)|CLIMB THE LINE|CHECK THE PLAN/],
    ['visual route-point/hash probe',/route(?:Points|Hash)\s*:/]
  ];
  for(const game of games){
    const htmlPath=path.join(__dirname,'..',game+'.html'),evalPath=path.join(__dirname,game+'-eval.js');
    if(!fs.existsSync(htmlPath)||!fs.existsSync(evalPath)){fail(`${game}: missing active game or focused eval`);continue}
    const html=fs.readFileSync(htmlPath,'utf8'),focused=fs.readFileSync(evalPath,'utf8');
    if(!/assertEntertainment\s*\(/.test(focused))fail(`${game}: focused eval does not call assertEntertainment`);
    if(!/noVisiblePath/.test(focused))fail(`${game}: focused eval does not prove noVisiblePath`);
    if(!/runMotion\s*\(/.test(focused)||!/assertMotion\s*\(/.test(focused))fail(`${game}: focused eval does not enforce the shared actor-motion contract`);
    for(const[label,pattern]of forbidden)if(pattern.test(html))fail(`${game}: ${label} returned`);
  }
  console.log(`  ${games.length} exploration games registered; entertainment, shared motion, and source bans present`);
}

if(failed){console.error('\nLEVEL ENTERTAINMENT EVALS FAILED');process.exit(1)}
console.log('\nLEVEL ENTERTAINMENT EVALS PASSED');
