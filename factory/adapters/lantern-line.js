'use strict';

const fs=require('fs');
const path=require('path');
const{bootGame}=require('../../evals/harness');
const evidence=require('../../evals/evidence');
const canonical=require('../canonical');

const MARKER=/const CLOG_LEAD_FRAMES = (\d+); \/\/ @foundry clogLeadFrames/g;
const adapter={
  id:'lantern-line',version:1,
  allowedCandidateFiles:['lantern-line.html'],
  requiredReadOnlyFiles:['engine.js','autoplay.js','game-source.js','evals/harness.js','evals/lantern-line-eval.js','evals/evidence.js','evals/ablation.js','evals/motion.js','evals/feedback.js'],
  forbiddenFiles:['games.js','evals/game-contracts.js','index.html','package.json','evals/visual-reviews/tower-panic.json','evals/visual-receipts/tower-panic-contact-sheet.png','evals/visual-reviews/lantern-line.json','evals/visual-receipts/lantern-line-contact-sheet.png'],
  genome:{clogLeadFrames:{min:0,max:54,step:18}},
  allGenomes(){return[0,18,36,54].map(clogLeadFrames=>({clogLeadFrames}))},
  readGenome(root){
    const source=fs.readFileSync(path.join(root,'lantern-line.html'),'utf8'),matches=[...source.matchAll(MARKER)];
    if(matches.length!==1)throw new Error(`expected exactly one clogLeadFrames marker, found ${matches.length}`);
    return this.validateGenome({clogLeadFrames:Number(matches[0][1])});
  },
  validateGenome(genome){
    const keys=Object.keys(genome).sort();if(JSON.stringify(keys)!=='["clogLeadFrames"]')throw new Error(`unexpected genome keys: ${keys.join(',')}`);
    const value=genome.clogLeadFrames,spec=this.genome.clogLeadFrames;if(!Number.isInteger(value)||value<spec.min||value>spec.max||(value-spec.min)%spec.step)throw new Error(`invalid clogLeadFrames: ${value}`);return genome;
  },
  applyGenome(workspace,genome){
    this.validateGenome(genome);const file=path.join(workspace,'lantern-line.html'),before=fs.readFileSync(file,'utf8'),matches=[...before.matchAll(MARKER)];
    if(matches.length!==1)throw new Error(`expected exactly one clogLeadFrames marker, found ${matches.length}`);
    const replacement=`const CLOG_LEAD_FRAMES = ${genome.clogLeadFrames}; // @foundry clogLeadFrames`,after=before.slice(0,matches[0].index)+replacement+before.slice(matches[0].index+matches[0][0].length);
    fs.writeFileSync(file,after);return{path:'lantern-line.html',before:matches[0][0],after:replacement,changedLines:matches[0][0]===replacement?0:1,beforeHash:canonical.hash(before),afterHash:canonical.hash(after)};
  },
  run(workspace,genome,seed,frames){
    const game=bootGame('lantern-line',{root:workspace,seed}),initial=game.sandbox.__ambientProbe();game.frames(frames,false);
    const p=game.sandbox.__lanternLineProbe(),ambient=game.sandbox.__ambientProbe(),report=evidence.validateEvidence(ambient.ledger),derived=report.ok?evidence.deriveEvidence(ambient.ledger):null;
    const gates={finite:p.finite,batches:p.stats.batchesCompleted>=14,exactLanterns:p.stats.exactLanterns>=6,districts:p.stats.districtsLit>=1,jams:p.stats.jams<=5,deadAir:p.stats.maxDecisionDeadAir<=240,evidence:report.ok,evidenceDrops:report.ok&&report.ledger.dropped===0,parameterActive:genome.clogLeadFrames===0?p.stats.forecastChecks>0:p.stats.leadActivations>0};
    return{seed,frames,gates,eligible:Object.values(gates).every(Boolean),stats:p.stats,initialStateSignature:initial.stateSignature,finalStateSignature:game.sandbox.__lanternLineSignature(),evidenceLedger:report.ledger,evidenceHash:evidence.canonicalEvidenceHash(report.ledger),derivedEvidence:derived,rngReceipt:game.engine.random()};
  },
  evaluate(workspace,genome,options){
    this.validateGenome(genome);options=options||{};const frames=options.frames||9000,seeds=options.seeds||[0x1a11,0x1ab7,0x1b5d],runs=seeds.map(seed=>this.run(workspace,genome,seed,frames));
    const sum=key=>runs.reduce((total,run)=>total+run.stats[key],0),max=key=>Math.max(...runs.map(run=>run.stats[key]));
    const totals={exactLanterns:sum('exactLanterns'),imperfectLanterns:sum('imperfectLanterns'),districtsLit:sum('districtsLit'),jamFrames:sum('jamFrames'),clogsAvoided:sum('clogsAvoided'),forecastResponses:sum('forecastResponses'),reactiveResponses:sum('reactiveResponses'),planReversals:sum('planReversals'),events:sum('events'),progress:sum('progress'),leadActivations:sum('leadActivations'),maxDecisionDeadAir:max('maxDecisionDeadAir')};
    const quality={throughput:totals.exactLanterns*60+totals.districtsLit*300+sum('batchesCompleted')*8-sum('spoiledBatches')*35,safety:totals.clogsAvoided*20+sum('purgeCaptures')*30-sum('jams')*50-totals.jamFrames/6,tacticalLegibilityProxy:totals.forecastResponses*15+totals.planReversals*12+sum('windups')*4-totals.maxDecisionDeadAir/12};
    return{genome,runs,totals,eligible:runs.every(run=>run.eligible),quality};
  }
};
module.exports=adapter;
