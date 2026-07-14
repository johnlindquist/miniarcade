#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const ROOT=path.join(__dirname,'..');
const DEFAULT_GAMES=require('../games');
const DEFAULT_REGISTRY=require('./game-contracts');
const DEFAULT_DEBT=require('./legacy-quality-debt.json');

// This is the immutable admission boundary for legacy status. Entries may move
// from open to resolved, but this set must never grow. New games ship as aep1.
const FROZEN_LEGACY_IDS=Object.freeze([
  'horizon','meatlad','rocket','smallguys','wordfall','hexcascade','blockmine',
  'webslam','deadline-deck','scrapshift','motobowl',
]);
const REQUIRED_MISSING=Object.freeze(['visualEval','visualReceipt','visualReview']);
const FRAMEWORK_EVALS=Object.freeze([
  'evals/autoplay-eval.js',
  'evals/benchmark-catalog-eval.js',
  'evals/benchmark-eval.js',
  'evals/catalog-eval.js',
  'evals/engine-eval.js',
  'evals/entertainment-eval.js',
  'evals/evidence-eval.js',
  'evals/gallery-eval.js',
  'evals/live-eval.js',
  'evals/motion-eval.js',
  'evals/release-eval.js',
  'evals/show-eval.js',
  'evals/static-layer-eval.js',
  'evals/visual-receipt-eval.js',
  'evals/word-puzzle-eval.js',
]);

const sorted=value=>[...value].sort();
const sameSet=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const rel=absolute=>path.relative(ROOT,absolute).split(path.sep).join('/');

function numberWord(n){
  const ones=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  if(n<20)return ones[n];
  if(n<100)return tens[Math.floor(n/10)]+(n%10?`-${ones[n%10]}`:'');
  throw new Error(`catalog count ${n} is outside the documented word range`);
}

function auditCatalog(options={}){
  const root=options.root||ROOT;
  const games=options.games||DEFAULT_GAMES;
  const registry=options.registry||DEFAULT_REGISTRY;
  const debt=options.debt||DEFAULT_DEBT;
  const textOverrides=options.textOverrides||{};
  const errors=[];
  const add=(code,message)=>errors.push({code,message});
  const absolute=relative=>path.join(root,relative);
  const exists=relative=>Object.prototype.hasOwnProperty.call(textOverrides,relative)||fs.existsSync(absolute(relative));
  const read=(relative,encoding='utf8')=>Object.prototype.hasOwnProperty.call(textOverrides,relative)?textOverrides[relative]:fs.readFileSync(absolute(relative),encoding);
  const readJson=relative=>{try{return JSON.parse(read(relative,'utf8'))}catch(error){add('JSON_INVALID',`${relative}: ${error.message}`);return null}};

  if(registry.schema!==1||registry.protocol!=='ambient-evidence-v1'||!Array.isArray(registry.contracts))
    add('CONTRACT_REGISTRY_INVALID','evals/game-contracts.js must export Ambient Evidence Protocol v1 contracts');
  if(debt.schema!==1||debt.protocol!=='ambient-evidence-v1')
    add('LEGACY_DEBT_INVALID','evals/legacy-quality-debt.json must use Ambient Evidence Protocol v1');

  const ids=games.map(game=>game.id);
  const uniqueIds=new Set(ids);
  if(uniqueIds.size!==ids.length)add('CATALOG_DUPLICATE',`games.js contains duplicate ids: ${ids.join(', ')}`);
  const contracts=Array.isArray(registry.contracts)?registry.contracts:[];
  const contractIds=contracts.map(contract=>contract.id);
  if(new Set(contractIds).size!==contractIds.length)add('CONTRACT_DUPLICATE','game-contracts.js contains duplicate game ids');
  if(!sameSet(ids,contractIds))add('CATALOG_CONTRACT_DRIFT',`catalog ids [${sorted(ids)}] do not equal contract ids [${sorted(contractIds)}]`);
  if(contracts.length!==games.length)add('CONTRACT_COUNT_DRIFT',`expected exactly ${games.length} contracts, found ${contracts.length}`);

  const frozen=Array.isArray(debt.frozenLegacyIds)?debt.frozenLegacyIds:[];
  if(!sameSet(frozen,FROZEN_LEGACY_IDS))add('LEGACY_FROZEN_SET_CHANGED',`frozen legacy ids must remain [${FROZEN_LEGACY_IDS.join(', ')}]`);
  const debtGames=debt.games&&typeof debt.games==='object'?debt.games:{};
  if(!sameSet(Object.keys(debtGames),FROZEN_LEGACY_IDS))add('LEGACY_DEBT_EXPANDED','legacy debt entries must remain exactly the frozen 2026-07-13 cohort');
  if(debt.policy?.mayAddEntries!==false||debt.policy?.newCatalogGamesMustUseStatus!=='aep1')
    add('LEGACY_POLICY_WEAKENED','legacy debt policy must prohibit additions and require new games to use aep1');

  const gameById=new Map(games.map(game=>[game.id,game]));
  const expectedEvals=new Set(FRAMEWORK_EVALS);
  const expectedReviews=new Set();
  const expectedReceipts=new Set();
  let coveredCount=0,legacyCount=0;

  for(const contract of contracts){
    const game=gameById.get(contract.id);
    if(!game)continue;
    if(contract.title!==game.title)add('CONTRACT_METADATA_DRIFT',`${contract.id}: contract title ${JSON.stringify(contract.title)} does not match games.js ${JSON.stringify(game.title)}`);
    if(!['aep1','legacy'].includes(contract.status))add('CONTRACT_STATUS_INVALID',`${contract.id}: unsupported status ${contract.status}`);
    const expectedBehavior=`evals/${contract.id}-eval.js`;
    if(contract.behaviorEval!==expectedBehavior)add('BEHAVIOR_EVAL_ROUTE_DRIFT',`${contract.id}: behavior eval must be ${expectedBehavior}`);
    if(!exists(expectedBehavior))add('BEHAVIOR_EVAL_MISSING',`${contract.id}: ${expectedBehavior} is missing`);
    expectedEvals.add(expectedBehavior);
    for(const extra of contract.additionalEvals||[]){
      if(typeof extra!=='string'||!extra.startsWith('evals/')||!extra.endsWith('-eval.js'))add('ADDITIONAL_EVAL_INVALID',`${contract.id}: invalid additional eval ${extra}`);
      else{expectedEvals.add(extra);if(!exists(extra))add('ADDITIONAL_EVAL_MISSING',`${contract.id}: ${extra} is missing`)}
    }
    const page=`${contract.id}.html`;
    if(!exists(page))add('GAME_PAGE_MISSING',`${contract.id}: ${page} is missing`);

    const debtEntry=debtGames[contract.id];
    if(contract.status==='legacy'){
      legacyCount++;
      if(!FROZEN_LEGACY_IDS.includes(contract.id))add('NEW_LEGACY_CONTRACT',`${contract.id}: new catalog games may not use legacy status`);
      if(contract.visual!==null)add('LEGACY_VISUAL_DECLARATION',`${contract.id}: legacy visual coverage must remain null until the debt is fully retired`);
      if(!debtEntry||debtEntry.status!=='open')add('LEGACY_DEBT_STATE_DRIFT',`${contract.id}: legacy contract requires one open frozen debt entry`);
      if(debtEntry&&!sameSet(debtEntry.missing||[],REQUIRED_MISSING))add('LEGACY_MISSING_SCOPE_DRIFT',`${contract.id}: open debt must name visualEval, visualReview, and visualReceipt`);
      if(debtEntry?.present?.behaviorEval!==expectedBehavior)add('LEGACY_PRESENT_DRIFT',`${contract.id}: frozen behavior coverage is stale`);
    }else if(contract.status==='aep1'){
      coveredCount++;
      if(debtEntry&&debtEntry.status!=='resolved')add('LEGACY_DEBT_NOT_RETIRED',`${contract.id}: aep1 contract must mark its frozen debt entry resolved`);
      const visual=contract.visual;
      if(!visual||typeof visual!=='object')add('VISUAL_CONTRACT_MISSING',`${contract.id}: aep1 requires eval, review, and receipt paths`);
      else{
        const expectedVisualEval=`evals/${contract.id}-visual-eval.js`;
        const expectedReview=`evals/visual-reviews/${contract.id}.json`;
        if(visual.eval!==expectedVisualEval)add('VISUAL_EVAL_ROUTE_DRIFT',`${contract.id}: visual eval must be ${expectedVisualEval}`);
        if(visual.review!==expectedReview)add('VISUAL_REVIEW_ROUTE_DRIFT',`${contract.id}: visual review must be ${expectedReview}`);
        for(const [kind,file] of Object.entries(visual)){
          if(!exists(file))add('EVIDENCE_FILE_MISSING',`${contract.id}: ${kind} file ${file} is missing`);
        }
        expectedEvals.add(visual.eval);expectedReviews.add(visual.review);expectedReceipts.add(visual.receipt);
        if(exists(visual.review)){
          const review=readJson(visual.review);
          if(review){
            if(review.game!==contract.id)add('VISUAL_REVIEW_GAME_DRIFT',`${contract.id}: ${visual.review} identifies ${review.game}`);
            if(review.verdict!=='pass')add('VISUAL_REVIEW_NOT_PASSING',`${contract.id}: semantic review verdict is not pass`);
            if(!/^[a-f0-9]{64}$/.test(review.montageSha256||''))add('VISUAL_REVIEW_HASH_INVALID',`${contract.id}: semantic review montage hash is invalid`);
            if(exists(visual.receipt)&&Buffer.isBuffer(read(visual.receipt,null))){
              const actual=sha256(read(visual.receipt,null));
              if(actual!==review.montageSha256)add('VISUAL_RECEIPT_HASH_DRIFT',`${contract.id}: preserved montage ${actual} does not match review ${review.montageSha256}`);
            }
          }
        }
      }
    }
  }

  for(const id of FROZEN_LEGACY_IDS){
    const entry=debtGames[id];
    if(!entry)continue;
    if(!['open','resolved'].includes(entry.status))add('LEGACY_DEBT_STATUS_INVALID',`${id}: debt status must be open or resolved`);
    if(entry.status==='resolved'&&(entry.missing||[]).length)add('LEGACY_RESOLUTION_INVALID',`${id}: resolved debt must have an empty missing list`);
  }

  if(fs.existsSync(absolute('evals'))){
    const actualEvals=fs.readdirSync(absolute('evals')).filter(name=>name.endsWith('-eval.js')).map(name=>`evals/${name}`);
    for(const file of actualEvals)if(!expectedEvals.has(file))add('UNREGISTERED_EVAL',`${file} is neither a game contract eval nor a registered framework eval`);
    for(const file of expectedEvals)if(!actualEvals.includes(file))add('REGISTERED_EVAL_MISSING',`${file} is registered but missing`);
  }
  if(fs.existsSync(absolute('evals/visual-reviews'))){
    const actual=fs.readdirSync(absolute('evals/visual-reviews')).filter(name=>name.endsWith('.json')).map(name=>`evals/visual-reviews/${name}`);
    if(!sameSet(actual,expectedReviews))add('VISUAL_REVIEW_SET_DRIFT',`review files [${sorted(actual)}] do not equal covered contracts [${sorted(expectedReviews)}]`);
  }
  if(fs.existsSync(absolute('evals/visual-receipts'))){
    const actual=fs.readdirSync(absolute('evals/visual-receipts')).filter(name=>name.endsWith('.png')).map(name=>`evals/visual-receipts/${name}`);
    if(!sameSet(actual,expectedReceipts))add('VISUAL_RECEIPT_SET_DRIFT',`receipt files [${sorted(actual)}] do not equal covered contracts [${sorted(expectedReceipts)}]`);
  }

  const count=games.length,word=numberWord(count),Word=word[0].toUpperCase()+word.slice(1);
  const packageJson=readJson('package.json');
  if(packageJson&&packageJson.description!==`${Word} tiny, self-playing retro games at miniarcade.dev`)
    add('PACKAGE_COUNT_DRIFT',`package description must say ${Word} tiny, self-playing retro games at miniarcade.dev`);
  if(exists('README.md')){
    const readme=read('README.md','utf8');
    if(!readme.includes(`${Word} self-playing 160×360 games`))add('README_COUNT_DRIFT',`README must say ${Word} self-playing 160×360 games`);
  }
  if(exists('index.html')){
    const index=read('index.html','utf8');
    if(!index.includes(`${Word} tiny, self-playing retro games`)||!index.includes(`${word} tiny games`))add('GALLERY_COUNT_DRIFT',`index.html must use ${Word}/${word} for the ${count}-game catalog`);
    if(!index.includes(`>01 / ${String(count).padStart(2,'0')}</output>`))add('GALLERY_POSITION_DRIFT',`index.html position must end in ${String(count).padStart(2,'0')}`);
    if(exists('games.js')){
      const hash=sha256(read('games.js',null)).slice(0,8);
      if(!index.includes(`games.js?v=${hash}`))add('MANIFEST_CACHEBUSTER_DRIFT',`index.html games.js cachebuster must be ${hash}`);
    }
  }

  return{ok:errors.length===0,errors,summary:{games:games.length,covered:coveredCount,legacy:legacyCount,reviews:expectedReviews.size,receipts:expectedReceipts.size}};
}

function run(){
  let failed=false;
  const fail=message=>{console.error('  FAIL:',message);failed=true};
  const expectCode=(name,result,code)=>{
    if(!result.errors.some(error=>error.code===code))fail(`${name}: expected ${code}, got ${result.errors.map(error=>error.code).join(', ')||'no failure'}`);
    else console.log(`  ${name}: rejected with ${code}`);
  };

  console.log('1) current catalog, contracts, evals, reviews, receipts, and counts agree');
  const current=auditCatalog();
  if(!current.ok)for(const error of current.errors)fail(`[${error.code}] ${error.message}`);
  else console.log(`  ${current.summary.games} contracts · ${current.summary.covered} AEP v1 covered · ${current.summary.legacy} frozen legacy debt`);

  console.log('2) adversarial accounting drift is rejected');
  const duplicate=JSON.parse(JSON.stringify(DEFAULT_REGISTRY));duplicate.contracts.push({...duplicate.contracts[0]});
  expectCode('duplicate contract',auditCatalog({registry:duplicate}),'CONTRACT_DUPLICATE');

  const expandedGames=JSON.parse(JSON.stringify(DEFAULT_GAMES));expandedGames.push({id:'future-game',title:'FUTURE GAME',label:'future game',tagline:'new',tone:'fg'});
  const expandedRegistry=JSON.parse(JSON.stringify(DEFAULT_REGISTRY));expandedRegistry.contracts.push({id:'future-game',title:'FUTURE GAME',status:'legacy',behaviorEval:'evals/future-game-eval.js',visual:null});
  const expandedDebt=JSON.parse(JSON.stringify(DEFAULT_DEBT));expandedDebt.frozenLegacyIds.push('future-game');expandedDebt.games['future-game']={status:'open',missing:[...REQUIRED_MISSING],present:{behaviorEval:'evals/future-game-eval.js'}};
  expectCode('new legacy admission',auditCatalog({games:expandedGames,registry:expandedRegistry,debt:expandedDebt}),'LEGACY_FROZEN_SET_CHANGED');

  const missingReview=JSON.parse(JSON.stringify(DEFAULT_REGISTRY));
  const visualContract=missingReview.contracts.find(contract=>contract.status==='aep1');visualContract.visual.review='evals/visual-reviews/not-present.json';
  expectCode('missing visual review',auditCatalog({registry:missingReview}),'EVIDENCE_FILE_MISSING');

  const stalePackage=JSON.stringify({...require('../package.json'),description:'Twenty-nine tiny, self-playing retro games at miniarcade.dev'},null,2);
  expectCode('stale count copy',auditCatalog({textOverrides:{'package.json':stalePackage}}),'PACKAGE_COUNT_DRIFT');

  const receiptContract=DEFAULT_REGISTRY.contracts.find(contract=>contract.status==='aep1');
  const review=JSON.parse(fs.readFileSync(path.join(ROOT,receiptContract.visual.review),'utf8'));review.montageSha256='0'.repeat(64);
  expectCode('receipt hash drift',auditCatalog({textOverrides:{[receiptContract.visual.review]:JSON.stringify(review)}}),'VISUAL_RECEIPT_HASH_DRIFT');

  if(failed){console.error('\nCATALOG EVAL FAILED');process.exit(1)}
  console.log('\nCATALOG EVAL PASSED');
}

module.exports={auditCatalog,FROZEN_LEGACY_IDS};
if(require.main===module)run();
