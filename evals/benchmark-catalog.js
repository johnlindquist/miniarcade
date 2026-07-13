'use strict';

/* Canonical AEP benchmark panel.
 *
 * Each default seed names one runtime-ledger game and one measured same-seed
 * causal baseline. The games remain separate runs: no game can hide
 * another game's dead air, missing category, stalled baseline, or evidence
 * leakage behind catalog-wide aggregate totals.
 */
const{bootGame}=require('./harness');

const DEFAULT_FRAMES=18000;
const GAMES=Object.freeze({
  'ghost-shift':Object.freeze({
    seed:0x6520,
    ablation:'__NO_THREAT_PLAN'
  }),
  'pico-cap':Object.freeze({
    seed:0x9c20,
    ablation:'__NO_SIZE_PLAN'
  }),
  'dungeon-express':Object.freeze({
    seed:0xdac00,
    ablation:'__NO_ENEMY_AI'
  }),
  'tower-panic':Object.freeze({
    seed:0x7a00,
    ablation:'__NO_CASCADE_LOOKAHEAD'
  }),
  'ricochet-foundry':Object.freeze({
    seed:0xf04d1,
    ablation:'__NO_THERMAL_LOOKAHEAD'
  })
});
const GAME_IDS=Object.keys(GAMES);
const DEFAULT_SEEDS=GAME_IDS.map(game=>`${game}:${GAMES[game].seed}`);

function hashText(value){
  let hash=2166136261;
  for(const char of String(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}
  return hash>>>0;
}
function targetForSeed(value){
  if(typeof value==='string'&&value.includes(':')){
    const split=value.lastIndexOf(':'),game=value.slice(0,split),raw=value.slice(split+1),config=GAMES[game];
    if(!config)throw new Error(`unknown catalog benchmark game: ${game}`);
    const seed=Number(raw);
    if(!Number.isSafeInteger(seed)||seed<0)throw new Error(`invalid catalog simulation seed: ${raw}`);
    return{game,seed,config,panelSeed:value};
  }
  const number=typeof value==='number'?value:hashText(value),game=GAME_IDS[(number>>>0)%GAME_IDS.length],config=GAMES[game];
  return{game,seed:typeof value==='number'?value:hashText(value),config,panelSeed:value};
}
function decisionSignature(ambient){
  return{
    game:ambient.game,
    progress:ambient.soak.progress,
    puzzle:ambient.evidence.puzzle,
    agency:ambient.evidence.agency,
    decisions:Object.fromEntries(Object.entries(ambient.evidence.decisions).map(([kind,value])=>[kind,value.count]))
  };
}
function observation(target,variant,frames){
  const declarations=[];
  if(variant==='baseline')declarations.push(`globalThis.${target.config.ablation}=true;`);
  if(variant==='evidence-off')declarations.push('globalThis.__NO_EVIDENCE_LEDGER=true;');
  const game=bootGame(target.game,{seed:target.seed,footer:declarations.join('\n')}),initial=game.sandbox.__ambientProbe();
  if(!initial||initial.protocol!=='ambient-evidence/v1'||initial.game!==target.game)
    throw new Error(`${target.game} did not expose its canonical ambient probe`);
  const environmentSignature={topology:initial.topology||initial.evidence&&initial.evidence.topology,initialStateSignature:initial.stateSignature};
  game.frames(frames,false);
  const ambient=game.sandbox.__ambientProbe();
  if(!ambient||ambient.protocol!=='ambient-evidence/v1'||ambient.game!==target.game)
    throw new Error(`${target.game} did not expose its canonical ambient probe`);
  return{
    frames,
    evidence:ambient.ledger,
    progress:ambient.soak.progress,
    decisions:ambient.evidence.decisions,
    decisionSignature:decisionSignature(ambient),
    simSignature:ambient.stateSignature,
    rngState:game.engine.random(),
    environmentSignature,
    capable:ambient.finite!==false&&ambient.soak.progress>0,
    handicap:false,
    unrelatedChanges:[],
    provenance:{game:target.game,panelSeed:target.panelSeed,simulationSeed:target.seed,ablation:variant==='baseline'?target.config.ablation:null}
  };
}
async function run({seed,frames,verifyReplay}){
  const target=targetForSeed(seed),budget=frames===undefined?DEFAULT_FRAMES:frames;
  return{
    seed,
    live:observation(target,'live',budget),
    baseline:observation(target,'baseline',budget),
    evidenceOff:observation(target,'evidence-off',budget),
    replay:verifyReplay?observation(target,'live',budget):null
  };
}

module.exports={
  id:'aep-exploration-catalog',
  game:'exploration-catalog',
  version:'1',
  defaultProfile:'release',
  seeds:DEFAULT_SEEDS,
  frames:DEFAULT_FRAMES,
  requiredNaturalCategories:['setup','threat','response','commit','payoff'],
  ablation:'per-game causal baseline',
  provenanceFiles:[
    'engine.js','autoplay.js','game-source.js','evals/harness.js','evals/game-contracts.js',
    'evals/benchmark-catalog.js','evals/benchmark-cli.js',
    ...GAME_IDS.map(game=>`${game}.html`),
    ...GAME_IDS.map(game=>`evals/${game}-eval.js`)
  ],
  run,
  GAMES,
  DEFAULT_SEEDS,
  targetForSeed,
  observation
};
