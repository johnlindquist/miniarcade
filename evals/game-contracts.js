#!/usr/bin/env node
'use strict';

// Ambient Evidence Protocol v1 catalog registry.
//
// In this catalog/release slice, `aep1` means the game has the repository's
// current behavior suite plus the complete native visual chain: executable
// visual eval, semantic review, and preserved reviewed montage. It does not by
// itself claim runtime-ledger migration. `legacy` is permitted only for the
// frozen visual-evidence debt cohort in legacy-quality-debt.json.
const covered=(id,title,receipt=`evals/visual-receipts/${id}-contact-sheet.png`,extra={})=>Object.freeze({
  id,title,status:'aep1',
  behaviorEval:`evals/${id}-eval.js`,
  visual:Object.freeze({
    eval:`evals/${id}-visual-eval.js`,
    review:`evals/visual-reviews/${id}.json`,
    receipt,
  }),
  ...extra,
});
const legacy=(id,title,extra={})=>Object.freeze({
  id,title,status:'legacy',
  behaviorEval:`evals/${id}-eval.js`,
  visual:null,
  ...extra,
});

const contracts=Object.freeze([
  legacy('horizon','MACHINE HUNT'),
  legacy('meatlad','MEAT LAD'),
  legacy('rocket','POCKET LEAGUE'),
  legacy('smallguys','SMALL GUYS'),
  covered('surfers','SIDE SURFERS'),
  legacy('wordfall','WORD FALL'),
  legacy('hexcascade','HEX CASCADE'),
  legacy('blockmine','BLOCK MINE',{additionalEvals:Object.freeze(['evals/blockmine-30m-eval.js'])}),
  legacy('webslam','WEB SLAM'),
  legacy('deadline-deck','DEADLINE DECK'),
  legacy('scrapshift','SCRAP SHIFT'),
  legacy('motobowl','MOTO BOWL'),
  covered('ghost-shift','GHOST SHIFT'),
  covered('wingrush','WINGRUSH'),
  covered('grave-garden','GRAVE GARDEN','evals/visual-receipts/grave-garden-scale-contact-sheet.png'),
  covered('swarm-keeper','SWARM KEEPER'),
  covered('star-salvage','STAR SALVAGE'),
  covered('neon-getaway','NEON GETAWAY'),
  covered('pico-cap','PICO CAP'),
  covered('frog-convoy','FROG CONVOY'),
  covered('tower-panic','TOWER PANIC'),
  covered('burrow-boss','BURROW BOSS'),
  covered('raiders-cart','RAIDERS OF THE LOST CART'),
  covered('robo-rally','ROBO RALLY'),
  covered('castle-crasher','CASTLE CRASHER'),
  covered('hotel-haunt','HOTEL HAUNT'),
  covered('kaiju-control','KAIJU CONTROL'),
  covered('moonshine-valley','MOONSHINE VALLEY'),
  covered('dungeon-express','DUNGEON EXPRESS'),
  covered('crystal-mesa','CRYSTAL MESA'),
  covered('ricochet-foundry','RICOCHET FOUNDRY'),
]);

module.exports=Object.freeze({
  schema:1,
  protocol:'ambient-evidence-v1',
  contracts,
});
