#!/usr/bin/env node
'use strict';

const catalog=require('./benchmark-catalog');
const{runBenchmark}=require('./benchmark');

let failed=false;
const fail=message=>{failed=true;console.error('  FAIL:',message)};
const check=(condition,message)=>{if(!condition)fail(message)};
const EXPECTED_GAMES=['ghost-shift','pico-cap','dungeon-express','tower-panic','ricochet-foundry'];

(async()=>{
  console.log('1) default panel covers five independent games without aggregate hiding');
  const targets=catalog.DEFAULT_SEEDS.map(catalog.targetForSeed),games=targets.map(target=>target.game);
  check(new Set(games).size===5,'default panel does not select five independent games');
  check(JSON.stringify(games)===JSON.stringify(EXPECTED_GAMES),'default panel must select '+EXPECTED_GAMES.join(', '));
  check(games.join(',')===Object.keys(catalog.GAMES).join(','),'default panel order drifted');
  console.log('  '+catalog.DEFAULT_SEEDS.join(', '));

  console.log('2) canonical live/baseline/evidence-off runs pass every hard gate');
  const first=await runBenchmark(catalog,{profile:'release'});
  check(first.ok,'default catalog failed: '+first.diagnosis.failureCodes.join(', '));
  check(first.runs.length===5,'catalog did not retain five independent game runs');
  for(const run of first.runs){
    check(run.live.evidenceReport&&run.live.evidenceReport.ok,`seed ${run.seed} did not validate its shared ledger`);
    check(run.live.raw.evidence.enabled===true&&run.live.raw.evidence.dropped===0,`seed ${run.seed} live ledger was disabled or dropped facts`);
    check(run.live.events.length>0,`seed ${run.seed} produced no natural ledger events`);
    check(run.baseline&&run.baseline.progress>0,`seed ${run.seed} baseline stopped progressing`);
    check(run.live.environmentSignature&&run.live.environmentSignature.topology&&typeof run.live.environmentSignature.initialStateSignature==='string',`seed ${run.seed} did not bind an observed initial environment`);
    check(JSON.stringify(run.live.environmentSignature)===JSON.stringify(run.baseline.environmentSignature),`seed ${run.seed} ablation changed the initial environment`);
    check(JSON.stringify(run.live.decisionSignature)!==JSON.stringify(run.baseline.decisionSignature),`seed ${run.seed} ablation did not change decisions`);
    check(run.evidenceOff&&run.live.simSignature===run.evidenceOff.simSignature,`seed ${run.seed} evidence changed simulation`);
    check(run.live.rngState===run.evidenceOff.rngState,`seed ${run.seed} evidence changed RNG`);
    const off=run.evidenceOff.raw.evidence;
    check(off.enabled===false&&off.serial===0&&off.dropped===0&&off.events.length===0,`seed ${run.seed} evidence-off ledger was not disabled and empty`);
  }
  console.log(`  ${first.runs.length} independent games · ${first.events.events.length} retained facts · ${first.receipt.verdict}`);

  console.log('3) replaying the real catalog produces byte-identical canonical artifacts');
  const second=await runBenchmark(catalog,{profile:'release'});
  for(const name of['receipt.json','artifact-index.json','scorecard.json','events.json','provenance.json','diagnosis.json'])
    check(first.files[name].equals(second.files[name]),`${name} changed across identical catalog runs`);
  const paths=new Set(first.provenance.files.map(file=>file.path));
  check(paths.has('evals/benchmark-catalog.js')&&paths.has('evals/benchmark-cli.js'),'default benchmark surface is absent from provenance');
  check(paths.has('autoplay.js')&&paths.has('game-source.js')&&paths.has('evals/game-contracts.js'),'executed runtime or catalog contract is absent from provenance');
  check(!paths.has('evals/ablation.js'),'unused generic ablation module was falsely claimed in provenance');
  for(const game of Object.keys(catalog.GAMES)){
    check(paths.has(`${game}.html`),`${game} implementation is absent from provenance`);
    check(paths.has(`evals/${game}-eval.js`),`${game} focused eval is absent from provenance`);
  }
  console.log('  six artifact files replayed exactly; five implementations and focused evals are source-bound');

  console.log(failed?'\nAEP BENCHMARK CATALOG EVAL FAILED':'\nAEP BENCHMARK CATALOG EVAL PASSED');
  process.exitCode=failed?1:0;
})().catch(error=>{console.error(error.stack||error);process.exitCode=1});
