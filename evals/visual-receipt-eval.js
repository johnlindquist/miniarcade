#!/usr/bin/env node
'use strict';

const fs=require('fs');
const os=require('os');
const path=require('path');
const{checkMetricBands,deriveBand,reviewIdentitySha256,verifyReviewReceipt}=require('./visual-harness');
let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true};
const IDENTITY_FILES=['sample.html','horizon.html','blockmine.html','engine.js','autoplay.js','word-puzzle.js',
  'evals/sample-visual-eval.js','evals/harness.js','evals/visual-harness.js','evals/visual-baselines/example.txt',
  'render/runtime.js','render/render.js','render/package.json','render/package-lock.json','render/fonts/Silkscreen-Regular.ttf'];
const seedIdentityRoot=root=>{for(const file of IDENTITY_FILES){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,file+' v1\n')}};
const fixtureRoot=fs.mkdtempSync(path.join(os.tmpdir(),'visual-review-verifier-'));seedIdentityRoot(fixtureRoot);
process.on('exit',()=>fs.rmSync(fixtureRoot,{recursive:true,force:true}));
const categories={};
for(const name of['characterCraft','environmentCraft','levelVariety','animationImpact','readability','artDirectionCohesion'])
  categories[name]={meetsMachineHunt:true,meetsBlockMine:true,note:'reviewed at native size'};
const boundIdentity=reviewIdentitySha256('sample',{root:fixtureRoot}),DARWIN_HASH='a'.repeat(64),LINUX_HASH='b'.repeat(64);
const base={schema:1,game:'sample',verdict:'pass',references:['horizon','blockmine'],montageSha256:DARWIN_HASH,reviewedAt:'2026-07-10',reviewer:'fixture reviewer',reviewPlatform:'darwin',
  reviewIdentitySha256:boundIdentity,allowCrossPlatformRasterization:true,categories};
const verify=(receipt,options)=>verifyReviewReceipt(receipt,{root:fixtureRoot,game:'sample',...options});

console.log('1) the review platform still requires the exact reviewed montage');
{
  const exact=verify(base,{platform:'darwin',montageSha256:DARWIN_HASH}),drift=verify(base,{platform:'darwin',montageSha256:'c'.repeat(64)});
  if(!exact.ok)fail('exact review-platform receipt failed: '+exact.errors.join('; '));
  if(drift.ok||!drift.errors.includes('review montage hash is stale'))fail('same-platform raster drift was accepted');
  console.log('  exact accepted; changed macOS montage rejected');
}

console.log('2) another platform may drift only under the exact reviewed identity');
{
  const linux=verify(base,{platform:'linux',montageSha256:LINUX_HASH});
  const stale=verify({...base,reviewIdentitySha256:'c'.repeat(64)},{platform:'linux',montageSha256:LINUX_HASH});
  const unbound=verify({...base,allowCrossPlatformRasterization:false},{platform:'linux',montageSha256:LINUX_HASH});
  const malformed=verify({...base,montageSha256:'not-a-hash'},{platform:'linux',montageSha256:LINUX_HASH}),
    malformedIdentity=verify({...base,reviewIdentitySha256:'not-a-hash'},{platform:'linux',montageSha256:LINUX_HASH});
  if(!linux.ok||!linux.platformDriftAccepted)fail('bound Linux raster drift was rejected: '+linux.errors.join('; '));
  if(stale.ok||!stale.errors.includes('review code/capture identity is stale'))fail('stale source/capture identity was accepted');
  if(unbound.ok)fail('cross-platform drift passed without explicit receipt permission');
  if(malformed.ok||!malformed.errors.includes('review montage hash is missing or invalid'))fail('malformed reviewed montage hash was accepted as platform drift');
  if(malformedIdentity.ok||!malformedIdentity.errors.includes('review code/capture identity is missing or invalid'))fail('malformed review identity was accepted as platform drift');
  console.log('  bound drift accepted; stale identity, malformed hash, and unapproved drift rejected');
}

console.log('3) candidate, capture stack, and both quality references bind the identity');
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'visual-review-identity-')),
    files=IDENTITY_FILES;
  try{
    for(const file of files){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,file+' v1\n')}
    const initial=reviewIdentitySha256('sample',{root});
    for(const file of files){const target=path.join(root,file),original=fs.readFileSync(target);fs.writeFileSync(target,Buffer.concat([original,Buffer.from('changed\n')]));if(reviewIdentitySha256('sample',{root})===initial)fail(`${file}: mutation did not invalidate review identity`);fs.writeFileSync(target,original)}
    let missingRejected=false;fs.rmSync(path.join(root,'evals/harness.js'));try{reviewIdentitySha256('sample',{root})}catch(error){missingRejected=/input missing/.test(error.message)}
    if(!missingRejected)fail('missing capture input was silently skipped');
    console.log(`  all ${files.length} candidate, reference, harness, renderer, dependency, font, and baseline inputs are mutation-tested`);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
}

console.log('4) receipt game routing and portability metadata fail closed');
{
  const wrong=verify({...base,game:'another-game'},{platform:'linux',montageSha256:LINUX_HASH}),
    invalidPlatform=verify({...base,reviewPlatform:'plan9'},{platform:'linux',montageSha256:LINUX_HASH});
  if(wrong.ok||!wrong.errors.some(error=>/does not match/.test(error)))fail('mislabeled receipt was accepted for another game');
  if(invalidPlatform.ok||!invalidPlatform.errors.includes('cross-platform review platform missing or invalid'))fail('invalid review platform was accepted');
  let invalidSlugRejected=false;try{reviewIdentitySha256('../sample')}catch(error){invalidSlugRejected=/valid game slug/.test(error.message)}
  if(!invalidSlugRejected)fail('invalid game slug reached identity routing');
  console.log('  mislabeled games, invalid platforms, and unsafe slugs rejected');
}

console.log('5) metric-band helpers reject non-finite evidence and limits');
{
  const badValue=checkMetricBands({score:NaN},{score:{min:0,max:2}}),
    badLimit=checkMetricBands({score:1},{score:{min:Infinity,max:2}});
  let deriveRejected=false,paddingRejected=false;try{deriveBand([1,Infinity])}catch(error){deriveRejected=/finite numbers/.test(error.message)}
  try{deriveBand([1,2],{padding:Infinity})}catch(error){paddingRejected=/finite non-negative padding/.test(error.message)}
  if(badValue.ok||badLimit.ok||!deriveRejected||!paddingRejected)fail('non-finite visual evidence or band limits were accepted');
  console.log('  non-finite metrics, limits, and distributions rejected');
}

console.log('6) every committed semantic review is portable and bound to current bytes');
{
  const reviewDir=path.join(__dirname,'visual-reviews'),files=fs.readdirSync(reviewDir).filter(name=>name.endsWith('.json')).sort(),
    visualGames=fs.readdirSync(__dirname).filter(name=>name.endsWith('-visual-eval.js')).map(name=>name.slice(0,-'-visual-eval.js'.length)).sort(),
    reviewGames=files.map(name=>path.basename(name,'.json')).sort();
  if(JSON.stringify(visualGames)!==JSON.stringify(reviewGames))fail(`visual suite/review registry mismatch: suites ${visualGames.join(',')} reviews ${reviewGames.join(',')}`);
  for(const name of files){
    const reviewPath=path.join(reviewDir,name),game=path.basename(name,'.json'),receipt=JSON.parse(fs.readFileSync(reviewPath,'utf8')),
      checked=verifyReviewReceipt(reviewPath,{game});
    if(receipt.allowCrossPlatformRasterization!==true)fail(`${name}: cross-platform rasterization is not explicitly approved`);
    if(!/^[a-f0-9]{64}$/.test(receipt.montageSha256||''))fail(`${name}: montage hash is missing or malformed`);
    if(!/^[a-f0-9]{64}$/.test(receipt.reviewIdentitySha256||''))fail(`${name}: review identity is missing or malformed`);
    if(typeof receipt.seed!=='string'||!/^0x[a-f0-9]+$/i.test(receipt.seed))fail(`${name}: deterministic review seed is missing`);
    if(!Array.isArray(receipt.checkpoints)||!receipt.checkpoints.length||receipt.checkpoints.some(value=>typeof value!=='string'||!value.trim()))fail(`${name}: review checkpoints are missing`);
    if(!checked.ok)fail(`${name}: ${checked.errors.join('; ')}`);
  }
  const preservedDir=path.join(__dirname,'visual-receipts'),preserved=fs.readdirSync(preservedDir).filter(name=>name.endsWith('.png')).sort();
  const preservedGames=preserved.map(name=>name.replace(/-scale-contact-sheet\.png$/,'').replace(/-contact-sheet\.png$/,'')).sort();
  if(JSON.stringify(visualGames)!==JSON.stringify(preservedGames))fail(`visual suite/preserved montage registry mismatch: suites ${visualGames.join(',')} preserved ${preservedGames.join(',')}`);
  for(const name of preserved){const game=name.replace(/-scale-contact-sheet\.png$/,'').replace(/-contact-sheet\.png$/,''),reviewPath=path.join(reviewDir,game+'.json');if(!fs.existsSync(reviewPath)){fail(`${name}: preserved montage has no semantic review`);continue}const receipt=JSON.parse(fs.readFileSync(reviewPath,'utf8')),actual=require('crypto').createHash('sha256').update(fs.readFileSync(path.join(preservedDir,name))).digest('hex');if(actual!==receipt.montageSha256)fail(`${name}: preserved montage ${actual} does not match reviewed ${receipt.montageSha256}`)}
  for(const game of visualGames){const source=fs.readFileSync(path.join(__dirname,game+'-visual-eval.js'),'utf8');if(/(?:writeFileSync|copyFileSync)\([^\n]*(?:TRACKED|PRESERVED)_CONTACT_PATH/.test(source))fail(`${game}: ordinary visual eval overwrites its preserved reviewed montage`)}
  console.log(`  ${files.length} suites/reviews and ${preserved.length} preserved montages checked against current candidate, references, renderer, fonts, baselines, and capture stack`);
}

if(failed){console.error('\nVISUAL RECEIPT EVAL FAILED');process.exit(1)}
console.log('\nVISUAL RECEIPT EVAL PASSED');
