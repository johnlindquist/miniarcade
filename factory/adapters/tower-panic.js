'use strict';

const fs=require('fs');
const path=require('path');
const{bootGame}=require('../../evals/harness');
const evidence=require('../../evals/evidence');
const canonical=require('../canonical');

const MARKER=/const THREAT_LEAD_FRAMES=(\d+); \/\/ @foundry threatLeadFrames/g;
const adapter={
  id:'tower-panic',version:2,
  allowedCandidateFiles:['tower-panic.html'],
  requiredReadOnlyFiles:['engine.js','autoplay.js','game-source.js','evals/harness.js','evals/tower-panic-eval.js','evals/evidence.js','evals/ablation.js'],
  forbiddenFiles:['games.js','evals/game-contracts.js','evals/visual-reviews/tower-panic.json','evals/visual-receipts/tower-panic-contact-sheet.png'],
  genome:{threatLeadFrames:{min:0,max:36,step:12}},
  allGenomes(){return[0,12,24,36].map(threatLeadFrames=>({threatLeadFrames}))},
  validateGenome(genome){
    const keys=Object.keys(genome).sort();if(JSON.stringify(keys)!=='["threatLeadFrames"]')throw new Error(`unexpected genome keys: ${keys.join(',')}`);
    const value=genome.threatLeadFrames,spec=this.genome.threatLeadFrames;if(!Number.isInteger(value)||value<spec.min||value>spec.max||(value-spec.min)%spec.step)throw new Error(`invalid threatLeadFrames: ${value}`);return genome;
  },
  applyGenome(workspace,genome){
    this.validateGenome(genome);const file=path.join(workspace,'tower-panic.html'),before=fs.readFileSync(file,'utf8'),matches=[...before.matchAll(MARKER)];
    if(matches.length!==1)throw new Error(`expected exactly one threatLeadFrames marker, found ${matches.length}`);
    const replacement=`const THREAT_LEAD_FRAMES=${genome.threatLeadFrames}; // @foundry threatLeadFrames`,after=before.slice(0,matches[0].index)+replacement+before.slice(matches[0].index+matches[0][0].length);
    fs.writeFileSync(file,after);return{path:'tower-panic.html',before:matches[0][0],after:replacement,changedLines:matches[0][0]===replacement?0:1,beforeHash:canonical.hash(before),afterHash:canonical.hash(after)};
  },
  run(workspace,genome,seed,frames){
    const game=bootGame('tower-panic',{root:workspace,seed}),initial=game.sandbox.__ambientProbe();game.frames(frames,false);
    const p=game.sandbox.__towerPanicProbe(),ambient=game.sandbox.__ambientProbe(),report=evidence.validateEvidence(ambient.ledger),derived=report.ok?evidence.deriveEvidence(ambient.ledger):null;
    const gates={finite:p.finite,progress:p.stats.progress>0,rescues:p.stats.rescues>=15,extractions:p.stats.extractions>=3,hits:p.stats.hits<=4,deadAir:p.stats.maxDecisionDeadAir<=270,evidence:report.ok,parameterActive:genome.threatLeadFrames===0?p.stats.threatChecks>0:p.stats.threatAnticipations>0};
    return{seed,frames,gates,eligible:Object.values(gates).every(Boolean),stats:p.stats,initialStateSignature:initial.stateSignature,finalStateSignature:game.sandbox.__towerPanicSignature(),evidenceLedger:report.ledger,evidenceHash:evidence.canonicalEvidenceHash(report.ledger),derivedEvidence:derived,rngReceipt:game.engine.random()};
  },
  evaluate(workspace,genome,options){
    this.validateGenome(genome);options=options||{};const frames=options.frames||9000,seeds=options.seeds||[0x7a00,0x7ae9,0x7bd2],runs=seeds.map(seed=>this.run(workspace,genome,seed,frames));
    const sum=key=>runs.reduce((total,run)=>total+run.stats[key],0),max=key=>Math.max(...runs.map(run=>run.stats[key]));
    const totals={rescues:sum('rescues'),extractions:sum('extractions'),hits:sum('hits'),downs:sum('downs'),deflections:sum('deflections'),reroutes:sum('reroutes'),events:sum('events'),progress:sum('progress'),threatChecks:sum('threatChecks'),threatAnticipations:sum('threatAnticipations'),maxDecisionDeadAir:max('maxDecisionDeadAir')};
    const quality={safety:totals.deflections*2-totals.hits*10-totals.downs*25,progress:totals.rescues*10+totals.extractions*80,tacticalLegibilityProxy:totals.deflections*3-totals.reroutes*2-totals.maxDecisionDeadAir/10};
    return{genome,runs,totals,eligible:runs.every(run=>run.eligible),quality};
  }
};
module.exports=adapter;
