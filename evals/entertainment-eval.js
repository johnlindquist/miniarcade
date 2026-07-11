#!/usr/bin/env node
'use strict';

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
    decisions:{puzzle:12,threat:18,response:7,combat:4,payoff:2},
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
    decisions:{movement:900,replan:60},
    maxDeadAir:900
  },limits,message=>errors.push(message));
  const expected=['navigation path','authored rooms','topology branches','straight traversal','puzzle transitions','puzzle completions','enemy actions','player responses','puzzle decisions','threat decisions','response decisions','payoff decisions','dead air'];
  if(result.ok)fail('corridor fixture passed');
  for(const phrase of expected)if(!errors.some(message=>message.includes(phrase)))fail('corridor failure omitted '+phrase+': '+errors.join('; '));
  console.log('  rejected with '+errors.length+' independent failures; movement/replans received no credit');
}

if(failed){console.error('\nLEVEL ENTERTAINMENT EVALS FAILED');process.exit(1)}
console.log('\nLEVEL ENTERTAINMENT EVALS PASSED');
