'use strict';

/*
 * Shared release assertion for authored exploration levels.
 *
 * This deliberately does not consume the generic soak's movement/event counters:
 * locomotion is not entertainment. Each game adapts its own truthful telemetry to
 * this small evidence shape so the focused eval can prove topology, puzzle state,
 * enemy agency, player response, category breadth, and a real dead-air ceiling.
 *
 * evidence = {
 *   noVisiblePath: true,
 *   topology: {rooms, branches, maxStraight},
 *   puzzle: {transitions, completions},
 *   agency: {enemyActions, playerResponses},
 *   decisions: {puzzle:{count,source}, threat:{count,source}, ...},
 *   maxDeadAir: Number
 * }
 *
 * limits = {
 *   minRooms, minBranches, maxStraight,
 *   minPuzzleTransitions, minPuzzleCompletions,
 *   minEnemyActions, minPlayerResponses,
 *   requiredDecisionKinds: ['puzzle', 'threat', ...],
 *   minPerDecisionKind, maxDeadAir, deadAirUnit
 * }
 */

function finiteNonNegative(value){
  return Number.isFinite(value)&&value>=0;
}

function validateLimits(limits){
  const l=limits||{},positive=['minRooms','minBranches','maxStraight','minPuzzleTransitions','minPuzzleCompletions','minEnemyActions','minPlayerResponses','minPerDecisionKind','maxDeadAir'];
  for(const key of positive)if(!Number.isFinite(l[key])||l[key]<=0)throw new Error(`entertainment limit ${key} must be finite and positive`);
  if(!Array.isArray(l.requiredDecisionKinds)||!l.requiredDecisionKinds.length||l.requiredDecisionKinds.some(kind=>typeof kind!=='string'||!kind)||new Set(l.requiredDecisionKinds).size!==l.requiredDecisionKinds.length)
    throw new Error('entertainment requiredDecisionKinds must be a non-empty unique string list');
  if(l.deadAirUnit!==undefined&&(typeof l.deadAirUnit!=='string'||!l.deadAirUnit.trim()))throw new Error('entertainment deadAirUnit must be a non-empty string');
  return l;
}

function normalizeDecision(value){
  if(value&&typeof value==='object'&&!Array.isArray(value))return{count:value.count,source:value.source};
  return{count:value,source:null};
}

function analyzeEntertainment(evidence){
  const e=evidence||{},topology=e.topology||{},puzzle=e.puzzle||{},agency=e.agency||{},decisions=e.decisions||{};
  const normalized=Object.fromEntries(Object.entries(decisions).map(([kind,value])=>[kind,normalizeDecision(value)]));
  return{
    noVisiblePath:e.noVisiblePath===true,
    topology:{rooms:topology.rooms,branches:topology.branches,maxStraight:topology.maxStraight},
    puzzle:{transitions:puzzle.transitions,completions:puzzle.completions},
    agency:{enemyActions:agency.enemyActions,playerResponses:agency.playerResponses},
    decisions:Object.fromEntries(Object.entries(normalized).map(([kind,value])=>[kind,value.count])),
    decisionSources:Object.fromEntries(Object.entries(normalized).map(([kind,value])=>[kind,value.source])),
    decisionKinds:Object.entries(normalized).filter(([,value])=>finiteNonNegative(value.count)&&value.count>0).map(([kind])=>kind).sort(),
    maxDeadAir:e.maxDeadAir
  };
}

function assertEntertainment(label,evidence,limits,fail){
  const report=analyzeEntertainment(evidence),l=validateLimits(limits),bad=[];
  const need=(condition,message)=>{if(!condition)bad.push(message)};
  need(report.noVisiblePath,'computed navigation path is visible or not proven absent');
  need(finiteNonNegative(report.topology.rooms)&&report.topology.rooms>=l.minRooms,
    `only ${report.topology.rooms} authored rooms (floor ${l.minRooms})`);
  need(finiteNonNegative(report.topology.branches)&&report.topology.branches>=l.minBranches,
    `only ${report.topology.branches} topology branches/choices (floor ${l.minBranches})`);
  need(finiteNonNegative(report.topology.maxStraight)&&report.topology.maxStraight<=l.maxStraight,
    `straight traversal ${report.topology.maxStraight} exceeds ${l.maxStraight}`);
  need(finiteNonNegative(report.puzzle.transitions)&&report.puzzle.transitions>=l.minPuzzleTransitions,
    `only ${report.puzzle.transitions} puzzle transitions (floor ${l.minPuzzleTransitions})`);
  need(finiteNonNegative(report.puzzle.completions)&&report.puzzle.completions>=l.minPuzzleCompletions,
    `only ${report.puzzle.completions} puzzle completions (floor ${l.minPuzzleCompletions})`);
  need(finiteNonNegative(report.agency.enemyActions)&&report.agency.enemyActions>=l.minEnemyActions,
    `only ${report.agency.enemyActions} enemy actions (floor ${l.minEnemyActions})`);
  need(finiteNonNegative(report.agency.playerResponses)&&report.agency.playerResponses>=l.minPlayerResponses,
    `only ${report.agency.playerResponses} player responses (floor ${l.minPlayerResponses})`);
  const usedSources=new Map();
  for(const kind of l.requiredDecisionKinds){
    const count=report.decisions[kind];
    need(finiteNonNegative(count)&&count>=l.minPerDecisionKind,
      `${kind} decisions ${count===undefined?'missing':count} (floor ${l.minPerDecisionKind})`);
    const source=report.decisionSources[kind];
    need(typeof source==='string'&&source.trim(),`${kind} decisions do not declare an independent telemetry source`);
    if(typeof source==='string'&&source.trim()){
      const previous=usedSources.get(source);need(!previous,`${kind} decisions alias ${previous} telemetry source ${source}`);usedSources.set(source,kind);
    }
  }
  need(finiteNonNegative(report.maxDeadAir)&&report.maxDeadAir<=l.maxDeadAir,
    `dead air ${report.maxDeadAir} ${l.deadAirUnit||'units'} exceeds ${l.maxDeadAir}`);
  for(const message of bad)fail(`${label}: ${message}`);
  return{ok:bad.length===0,bad,report};
}

module.exports={analyzeEntertainment,assertEntertainment,validateLimits};
