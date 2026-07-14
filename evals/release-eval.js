#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const{auditCatalog}=require('./catalog-eval');
const ROOT=path.join(__dirname,'..');
let failed=false;
const fail=(code,message)=>{console.error(`  FAIL [${code}]: ${message}`);failed=true};

console.log('1) Ambient Evidence Protocol v1 catalog accounting');
const catalog=auditCatalog();
if(!catalog.ok)for(const error of catalog.errors)fail(error.code,error.message);
else console.log(`  ${catalog.summary.games} games · ${catalog.summary.covered} covered · ${catalog.summary.legacy} frozen legacy debt`);

console.log('2) canonical benchmark and verification commands');
const pkg=require('../package.json');
const requiredScripts={
  benchmark:'node evals/benchmark-cli.js',
  verify:'npm --prefix render test && npm test',
  'verify:release':'npm run verify && node evals/release-eval.js',
  'verify:live':'node evals/live-eval.js --base https://miniarcade.dev',
};
for(const [name,command] of Object.entries(requiredScripts)){
  if(pkg.scripts?.[name]!==command)fail('RELEASE_COMMAND_DRIFT',`${name} must be ${JSON.stringify(command)}`);
  else console.log(`  npm run ${name}`);
}

console.log('3) canonical default benchmark covers five runtime-ledger games');
let benchmarkCatalog;
try{benchmarkCatalog=require('./benchmark-catalog')}
catch(error){fail('BENCHMARK_CATALOG_INVALID',error.message)}
const expectedBenchmarkGames=['ghost-shift','pico-cap','dungeon-express','tower-panic','ricochet-foundry'];
if(benchmarkCatalog?.id!=='aep-exploration-catalog')fail('BENCHMARK_CATALOG_DRIFT','default benchmark id must be aep-exploration-catalog');
const benchmarkGames=Object.keys(benchmarkCatalog?.GAMES||{});
if(JSON.stringify(benchmarkGames)!==JSON.stringify(expectedBenchmarkGames))fail('BENCHMARK_CATALOG_DRIFT',`default benchmark games must be ${expectedBenchmarkGames.join(', ')}`);
if(!Array.isArray(benchmarkCatalog?.seeds)||benchmarkCatalog.seeds.length!==expectedBenchmarkGames.length)fail('BENCHMARK_CATALOG_DRIFT','default benchmark needs five independent game seeds');
else console.log(`  ${benchmarkCatalog.seeds.length} independent game runs · natural evidence + causal baseline + evidence-off twin`);

console.log('4) deploy security policy matches the live verifier');
let vercel;
try{vercel=JSON.parse(fs.readFileSync(path.join(ROOT,'vercel.json'),'utf8'))}
catch(error){fail('VERCEL_CONFIG_INVALID',error.message)}
const expectedHeaders={
  'x-content-type-options':'nosniff',
  'referrer-policy':'strict-origin-when-cross-origin',
  'permissions-policy':'camera=(), microphone=(), geolocation=()',
};
const globalRule=vercel?.headers?.find(rule=>rule.source==='/(.*)');
const configured=new Map((globalRule?.headers||[]).map(header=>[String(header.key).toLowerCase(),header.value]));
for(const [key,value] of Object.entries(expectedHeaders)){
  if(configured.get(key)!==value)fail('SECURITY_HEADER_CONFIG_DRIFT',`${key} must be ${JSON.stringify(value)} in vercel.json`);
}
if(globalRule)console.log(`  ${Object.keys(expectedHeaders).length} required global headers configured`);

console.log('5) release scope is explicit about available evidence');
const readme=fs.readFileSync(path.join(ROOT,'README.md'),'utf8');
const agents=fs.readFileSync(path.join(ROOT,'AGENTS.md'),'utf8');
if(!readme.includes('Ambient Evidence Protocol v1'))fail('AEP_DOCUMENTATION_MISSING','README.md must document Ambient Evidence Protocol v1');
if(!agents.includes('Ambient Evidence Protocol v1'))fail('AEP_CONTRACT_MISSING','AGENTS.md must define Ambient Evidence Protocol v1');
console.log('  benchmark receipts come from the deterministic runner; this source preflight does not fabricate one or a deploy commit marker');
console.log('  live verification checks deployed routes, catalog, runtime scripts, cachebusters when present, and security headers');

if(failed){console.error('\nRELEASE EVAL FAILED');process.exit(1)}
console.log('\nRELEASE EVAL PASSED');
