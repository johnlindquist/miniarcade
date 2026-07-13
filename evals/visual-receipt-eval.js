#!/usr/bin/env node
'use strict';

const fs=require('fs');
const os=require('os');
const path=require('path');
const{
  checkMetricBands,deriveBand,manifestSha256,createEvidenceManifest,createDependencyManifest,
  createVisualProvenance,legacyReviewIdentitySha256,reviewIdentitySha256,verifyReviewReceipt,legacyGameHashAccepted
}=require('./visual-harness');
const{legacyIdentityInputBytes}=require('./visual-provenance');
const{preserveVisualReview}=require('./preserve-visual-review');
let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true};
const REPO_ROOT=path.join(__dirname,'..');
const IDENTITY_FILES=['sample.html','horizon.html','blockmine.html','engine.js','autoplay.js','word-puzzle.js','game-source.js',
  'evals/sample-visual-eval.js','evals/harness.js','evals/visual-harness.js','evals/visual-provenance.js',
  'evals/visual-baselines/consumed.txt','evals/visual-baselines/unused.txt',
  'render/runtime.js','render/render.js','render/package.json','render/package-lock.json','render/fonts/Silkscreen-Regular.ttf'];
const seedIdentityRoot=root=>{for(const file of IDENTITY_FILES){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});
  const content=file==='evals/sample-visual-eval.js'?"require('./visual-baselines/consumed.txt');\n":file+' v1\n';fs.writeFileSync(target,content)}};
const fixtureRoot=fs.mkdtempSync(path.join(os.tmpdir(),'visual-review-verifier-'));seedIdentityRoot(fixtureRoot);
process.on('exit',()=>fs.rmSync(fixtureRoot,{recursive:true,force:true}));
const categories={};
for(const name of['characterCraft','environmentCraft','levelVariety','animationImpact','readability','artDirectionCohesion'])
  categories[name]={meetsMachineHunt:true,meetsBlockMine:true,note:'reviewed at native size'};
const boundIdentity=legacyReviewIdentitySha256('sample',{root:fixtureRoot}),DARWIN_HASH='a'.repeat(64),LINUX_HASH='b'.repeat(64);
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

console.log('3) candidate, capture, runtime, renderer, references, and consumed baselines bind the identity');
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'visual-review-identity-'));
  try{
    seedIdentityRoot(root);
    const initial=reviewIdentitySha256('sample',{root}),unused=path.join(root,'evals/visual-baselines/unused.txt'),
      consumed=path.join(root,'evals/visual-baselines/consumed.txt');
    const boundFiles=IDENTITY_FILES.filter(file=>!file.endsWith('/unused.txt'));
    for(const file of boundFiles){const target=path.join(root,file),original=fs.readFileSync(target);fs.writeFileSync(target,Buffer.concat([original,Buffer.from('changed\n')]));if(reviewIdentitySha256('sample',{root})===initial)fail(`${file}: mutation did not invalidate review identity`);fs.writeFileSync(target,original)}
    const unusedOriginal=fs.readFileSync(unused);fs.appendFileSync(unused,'changed\n');
    if(reviewIdentitySha256('sample',{root})!==initial)fail('unused baseline invalidated an unrelated visual review');
    fs.writeFileSync(unused,unusedOriginal);fs.appendFileSync(consumed,'changed\n');
    if(reviewIdentitySha256('sample',{root})===initial)fail('consumed baseline did not invalidate its visual review');
    fs.writeFileSync(consumed,'evals/visual-baselines/consumed.txt v1\n');
    let missingRejected=false;fs.rmSync(path.join(root,'evals/harness.js'));try{reviewIdentitySha256('sample',{root})}catch(error){missingRejected=/input missing/.test(error.message)}
    if(!missingRejected)fail('missing capture input was silently skipped');
    console.log(`  ${boundFiles.length} source dependencies and targeted baseline consumption are mutation-tested`);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
}

console.log('3b) legacy rollout compatibility is exact and expires on later mutations');
{
  const enginePath=path.join(REPO_ROOT,'engine.js'),current=fs.readFileSync(enginePath),projected=legacyIdentityInputBytes(REPO_ROOT,'engine.js',current),
    mutated=Buffer.concat([current,Buffer.from('\n// later mutation\n')]),notProjected=legacyIdentityInputBytes(REPO_ROOT,'engine.js',mutated),
    towerReview='30309a8b6ed4a1d2800d1de5344a2056d1ff1a89fcffbfa4c3cfedeab55f9570',
    towerRollout='c9b437bd5d000395e4662a2449457fca3d0f4d3b6fe1432b0f45430070e3762c';
  if(projected.equals(current))fail('exact AEP rollout engine bytes were not projected to the reviewed revision');
  if(!notProjected.equals(mutated))fail('later engine mutation was incorrectly hidden by legacy projection');
  if(!legacyGameHashAccepted('tower-panic',towerReview,towerRollout))fail('exact Tower Panic evidence-only rollout hash pair was rejected');
  if(legacyGameHashAccepted('tower-panic',towerReview,'f'.repeat(64))||legacyGameHashAccepted('unknown-game',towerReview,towerRollout))fail('later or unknown game hash was accepted by rollout compatibility');
  console.log('  exact shared/game rollout accepted; later shared/game mutations remain stale');
}

console.log('4) Ambient Evidence Protocol v1 binds every declared visual-evidence dimension');
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'visual-evidence-v1-'));
  try{
    seedIdentityRoot(root);
    const declaration={
      checkpoints:['opening@12','impact@natural'],fixtures:[{id:'opening',offsets:[12]},{id:'impact',source:'natural'}],
      naturalSequence:{seed:'0x7907',frames:{forecast:240,impact:312,aftermath:336}},
      probeFields:['player.box','target.phase','actors[].id'],crops:{world:{x:0,y:30,width:160,height:330}},
      actors:[{id:'player',probe:'player.box'}],metrics:['world.colorEntropy','impact.changedFraction'],references:['horizon','blockmine']
    },evidence=createEvidenceManifest('sample',declaration),dependencies=createDependencyManifest('sample',{root,references:declaration.references}),
      identity=reviewIdentitySha256('sample',{root,evidenceManifest:evidence,dependencyManifest:dependencies}),
      protocol={...base,schema:2,protocol:'ambient-evidence/v1',checkpoints:declaration.checkpoints,
        evidenceManifest:evidence,evidenceManifestSha256:manifestSha256(evidence),dependencyManifest:dependencies,
        dependencyManifestSha256:manifestSha256(dependencies),reviewIdentitySha256:identity},
      verifyProtocol=(value,options)=>verifyReviewReceipt(value,{root,game:'sample',...options});
    const exact=verifyProtocol(protocol,{platform:'linux',montageSha256:LINUX_HASH,evidenceManifest:evidence});
    if(!exact.ok)fail('exact protocol receipt failed: '+exact.errors.join('; '));
    const mutations=[
      ['metric evidence',{...declaration,metrics:[...declaration.metrics,'actor.drawnPixels']}],
      ['checkpoint',{...declaration,checkpoints:['opening@13','impact@natural']}],
      ['crop',{...declaration,crops:{world:{x:1,y:30,width:159,height:330}}}],
      ['natural sequence',{...declaration,naturalSequence:{...declaration.naturalSequence,frames:{...declaration.naturalSequence.frames,impact:313}}}]
    ];
    for(const[label,changed]of mutations){
      const checked=verifyProtocol(protocol,{platform:'linux',montageSha256:LINUX_HASH,evidenceManifest:createEvidenceManifest('sample',changed)});
      if(checked.ok||!checked.errors.includes('review evidence manifest is stale'))fail(`${label} mutation did not invalidate the review`);
    }
    const unused=path.join(root,'evals/visual-baselines/unused.txt'),consumed=path.join(root,'evals/visual-baselines/consumed.txt'),
      unusedBytes=fs.readFileSync(unused),consumedBytes=fs.readFileSync(consumed);
    fs.appendFileSync(unused,'unrelated mutation\n');
    if(!verifyProtocol(protocol,{platform:'linux',montageSha256:LINUX_HASH,evidenceManifest:evidence}).ok)fail('unused baseline invalidated protocol receipt');
    fs.writeFileSync(unused,unusedBytes);fs.appendFileSync(consumed,'consumed mutation\n');
    const consumedMutation=verifyProtocol(protocol,{platform:'linux',montageSha256:LINUX_HASH,evidenceManifest:evidence});
    if(consumedMutation.ok||!consumedMutation.errors.includes('review dependency manifest is stale'))fail('consumed baseline did not invalidate protocol receipt');
    fs.writeFileSync(consumed,consumedBytes);
    console.log('  evidence, checkpoint, crop, natural-sequence, and consumed-baseline mutations rejected');
  }finally{fs.rmSync(root,{recursive:true,force:true})}
}

console.log('5) preservation refuses stale source/evidence identity even when montage bytes match');
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'visual-preserve-identity-'));
  try{
    seedIdentityRoot(root);
    const source=path.join(root,'.artifacts/visual/sample/contact-sheet.png'),reviewPath=path.join(root,'evals/visual-reviews/sample.json'),
      provenancePath=path.join(root,'.artifacts/visual/sample/contact-sheet.provenance.json'),target=path.join(root,'evals/visual-receipts/sample-contact-sheet.png'),
      declaration={checkpoints:['opening@12'],fixtures:[{id:'opening',offsets:[12]}],naturalSequence:null,
        probeFields:['player.box'],crops:{world:{x:0,y:0,width:160,height:360}},actors:[{id:'player'}],metrics:['world.colorEntropy'],references:['horizon','blockmine']};
    fs.mkdirSync(path.dirname(source),{recursive:true});fs.writeFileSync(source,'reviewed montage bytes\n');
    const montageSha256=require('crypto').createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
      provenance=createVisualProvenance('sample',{root,montageSha256,evidence:declaration}),
      receipt={...base,schema:2,protocol:'ambient-evidence/v1',montageSha256,checkpoints:declaration.checkpoints,
        evidenceManifest:provenance.evidenceManifest,evidenceManifestSha256:provenance.evidenceManifestSha256,
        dependencyManifest:provenance.dependencyManifest,dependencyManifestSha256:provenance.dependencyManifestSha256,
        reviewIdentitySha256:provenance.reviewIdentitySha256};
    fs.mkdirSync(path.dirname(reviewPath),{recursive:true});fs.writeFileSync(reviewPath,JSON.stringify(receipt));fs.writeFileSync(provenancePath,JSON.stringify(provenance));
    const acceptedTarget=path.join(root,'accepted-contact-sheet.png'),accepted=preserveVisualReview('sample',
      {root,reviewPath,targetPath:acceptedTarget,sourceCandidates:[source],provenancePath});
    if(accepted.sha256!==montageSha256||!fs.existsSync(acceptedTarget))fail('exact protocol provenance was not preservable');
    fs.rmSync(acceptedTarget,{force:true});fs.appendFileSync(path.join(root,'sample.html'),'stale candidate source\n');
    let refused=false;try{preserveVisualReview('sample',{root,reviewPath,targetPath:target,sourceCandidates:[source],provenancePath})}catch(error){refused=/identity is stale/.test(error.message)}
    if(!refused||fs.existsSync(target))fail('preservation copied matching montage bytes under stale review/source/evidence identity');
    console.log('  stale protocol receipt/source/evidence identity refused before any committed-path copy');
  }finally{fs.rmSync(root,{recursive:true,force:true})}
}

console.log('6) receipt game routing and portability metadata fail closed');
{
  const wrong=verify({...base,game:'another-game'},{platform:'linux',montageSha256:LINUX_HASH}),
    invalidPlatform=verify({...base,reviewPlatform:'plan9'},{platform:'linux',montageSha256:LINUX_HASH});
  if(wrong.ok||!wrong.errors.some(error=>/does not match/.test(error)))fail('mislabeled receipt was accepted for another game');
  if(invalidPlatform.ok||!invalidPlatform.errors.includes('cross-platform review platform missing or invalid'))fail('invalid review platform was accepted');
  let invalidSlugRejected=false;try{reviewIdentitySha256('../sample')}catch(error){invalidSlugRejected=/valid game slug/.test(error.message)}
  if(!invalidSlugRejected)fail('invalid game slug reached identity routing');
  console.log('  mislabeled games, invalid platforms, and unsafe slugs rejected');
}

console.log('7) metric-band helpers reject non-finite evidence and limits');
{
  const badValue=checkMetricBands({score:NaN},{score:{min:0,max:2}}),
    badLimit=checkMetricBands({score:1},{score:{min:Infinity,max:2}});
  let deriveRejected=false,paddingRejected=false;try{deriveBand([1,Infinity])}catch(error){deriveRejected=/finite numbers/.test(error.message)}
  try{deriveBand([1,2],{padding:Infinity})}catch(error){paddingRejected=/finite non-negative padding/.test(error.message)}
  if(badValue.ok||badLimit.ok||!deriveRejected||!paddingRejected)fail('non-finite visual evidence or band limits were accepted');
  console.log('  non-finite metrics, limits, and distributions rejected');
}

console.log('8) every committed semantic review is portable and bound to current bytes');
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
