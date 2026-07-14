'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const{execFileSync}=require('child_process');
const LEGACY_COMPATIBILITY=require('./visual-legacy-compat');

const PROTOCOL='ambient-evidence/v1';
const HASH_RE=/^[a-f0-9]{64}$/;
const EVIDENCE_FIELDS=['checkpoints','fixtures','naturalSequence','probeFields','crops','actors','metrics','references'];
const compareText=(a,b)=>a<b?-1:a>b?1:0;

function assertSlug(value,label){
  if(typeof value!=='string'||!/^[a-z0-9-]+$/.test(value))throw new Error(`${label||'game'} must be a valid slug`);
  return value;
}

function cloneJson(value,label){
  const visit=(input,trail)=>{
    if(input===null||typeof input==='string'||typeof input==='boolean')return input;
    if(typeof input==='number'){
      if(!Number.isFinite(input))throw new Error(`${label||'manifest'} ${trail} must be finite`);
      return input;
    }
    if(Array.isArray(input))return input.map((item,index)=>visit(item,`${trail}[${index}]`));
    if(!input||typeof input!=='object'||Object.getPrototypeOf(input)!==Object.prototype)
      throw new Error(`${label||'manifest'} ${trail} must contain only JSON values`);
    const out={};
    for(const key of Object.keys(input).sort()){
      if(input[key]===undefined)throw new Error(`${label||'manifest'} ${trail}.${key} is undefined`);
      out[key]=visit(input[key],`${trail}.${key}`);
    }
    return out;
  };
  return visit(value,'$');
}

function canonicalJson(value){return JSON.stringify(cloneJson(value,'canonical JSON'));}
function manifestSha256(value){return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');}
function fileSha256(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}

function createEvidenceManifest(game,declaration){
  assertSlug(game,'evidence game');
  declaration=declaration||{};
  const manifest={protocol:PROTOCOL,kind:'visual-evidence',version:1,game};
  for(const field of EVIDENCE_FIELDS){
    if(!Object.prototype.hasOwnProperty.call(declaration,field))throw new Error(`visual evidence manifest is missing ${field}`);
    manifest[field]=cloneJson(declaration[field],`visual evidence ${field}`);
  }
  if(!Array.isArray(manifest.checkpoints)||manifest.checkpoints.length===0)throw new Error('visual evidence checkpoints must be a non-empty array');
  if(!Array.isArray(manifest.probeFields))throw new Error('visual evidence probeFields must be an array');
  if(!Array.isArray(manifest.references)||manifest.references.length===0||manifest.references.some(value=>typeof value!=='string'||!/^[a-z0-9-]+$/.test(value)))
    throw new Error('visual evidence references must be a non-empty slug array');
  if(!manifest.references.includes('horizon')||!manifest.references.includes('blockmine'))
    throw new Error('visual evidence references must include horizon and blockmine');
  return manifest;
}

function normalizeEvidenceManifest(game,value){
  if(!value||typeof value!=='object')throw new Error('visual evidence manifest is missing');
  if(value.protocol!==undefined&&value.protocol!==PROTOCOL)throw new Error('visual evidence protocol is unsupported');
  if(value.kind!==undefined&&value.kind!=='visual-evidence')throw new Error('visual evidence manifest kind is invalid');
  if(value.version!==undefined&&value.version!==1)throw new Error('visual evidence manifest version is unsupported');
  if(value.game!==undefined&&value.game!==game)throw new Error(`visual evidence game ${value.game} does not match ${game}`);
  return createEvidenceManifest(game,value);
}

function under(dir){
  if(!fs.existsSync(dir))return[];
  const out=[];
  const visit=current=>{
    for(const entry of fs.readdirSync(current,{withFileTypes:true}).sort((a,b)=>compareText(a.name,b.name))){
      const target=path.join(current,entry.name);
      if(entry.isDirectory())visit(target);else if(entry.isFile())out.push(target);
    }
  };
  visit(dir);return out;
}

function resolveBaselineTarget(root,relative){
  const base=path.resolve(root,'evals','visual-baselines'),target=path.resolve(base,relative);
  if(target!==base&&!target.startsWith(base+path.sep))throw new Error(`visual baseline path escapes its directory: ${relative}`);
  const candidates=[target,target+'.js',target+'.json',target+'.txt'];
  const found=candidates.find(candidate=>fs.existsSync(candidate));
  if(!found)throw new Error(`consumed visual baseline is missing: ${path.relative(root,target)}`);
  return fs.statSync(found).isDirectory()?under(found):[found];
}

function consumedBaselineFiles(root,visualEval){
  const source=fs.readFileSync(visualEval,'utf8'),relativeTargets=new Set();
  for(const match of source.matchAll(/require\(\s*['"]\.\/visual-baselines\/([^'"]+)['"]\s*\)/g))relativeTargets.add(match[1]);
  for(const match of source.matchAll(/path\.join\(\s*__dirname\s*,\s*['"]visual-baselines['"]\s*,\s*['"]([^'"]+)['"]/g))relativeTargets.add(match[1]);
  for(const match of source.matchAll(/['"](?:\.\/)?visual-baselines\/([^'"]+)['"]/g))relativeTargets.add(match[1]);
  return [...new Set([...relativeTargets].flatMap(relative=>resolveBaselineTarget(root,relative)))].sort();
}

function dependencyEntry(root,file){
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())throw new Error(`review identity input missing: ${path.relative(root,file)}`);
  return{path:path.relative(root,file).replace(/\\/g,'/'),sha256:fileSha256(file)};
}

function createDependencyManifest(game,options){
  options=options||{};assertSlug(game,'dependency game');
  const root=path.resolve(options.root||path.join(__dirname,'..')),
    visualEval=path.resolve(options.visualEvalPath||path.join(root,'evals',game+'-visual-eval.js')),
    references=options.references||['horizon','blockmine'];
  if(!Array.isArray(references)||references.length===0)throw new Error('dependency references must be a non-empty array');
  const groups={
    candidate:[path.join(root,game+'.html'),visualEval],
    references:references.map(reference=>path.join(root,assertSlug(reference,'reference')+'.html')),
    capture:[path.join(root,'evals','harness.js'),path.join(root,'evals','visual-harness.js'),path.join(root,'evals','visual-provenance.js')],
    runtime:[path.join(root,'engine.js'),path.join(root,'autoplay.js'),path.join(root,'word-puzzle.js'),path.join(root,'game-source.js'),path.join(root,'render','runtime.js')],
    renderer:[path.join(root,'render','render.js'),path.join(root,'render','package.json'),path.join(root,'render','package-lock.json'),
      path.join(root,'render','fonts','Silkscreen-Regular.ttf'),...under(path.join(root,'render','fonts'))],
    baselines:consumedBaselineFiles(root,visualEval)
  };
  for(const [group,files]of Object.entries(options.extraDependencies||{})){
    if(!Array.isArray(files))throw new Error(`extra dependency group ${group} must be an array`);
    groups[group]=(groups[group]||[]).concat(files.map(file=>path.resolve(root,file)));
  }
  const normalized={};
  for(const group of Object.keys(groups).sort()){
    const files=[...new Set(groups[group].map(file=>path.resolve(file)))].sort((a,b)=>compareText(path.relative(root,a),path.relative(root,b)));
    normalized[group]=files.map(file=>dependencyEntry(root,file));
  }
  return{protocol:PROTOCOL,kind:'visual-dependencies',version:1,game,files:normalized};
}

function normalizeDependencyManifest(game,value){
  if(!value||typeof value!=='object')throw new Error('visual dependency manifest is missing');
  if(value.protocol!==PROTOCOL||value.kind!=='visual-dependencies'||value.version!==1||value.game!==game)
    throw new Error('visual dependency manifest header is invalid');
  if(!value.files||typeof value.files!=='object'||Array.isArray(value.files))throw new Error('visual dependency files are missing');
  const out={protocol:PROTOCOL,kind:'visual-dependencies',version:1,game,files:{}};
  for(const group of Object.keys(value.files).sort()){
    const entries=value.files[group];
    if(!Array.isArray(entries))throw new Error(`visual dependency group ${group} must be an array`);
    out.files[group]=entries.map(entry=>{
      if(!entry||typeof entry.path!=='string'||!entry.path||path.isAbsolute(entry.path)||entry.path.split(/[\\/]/).includes('..')||!HASH_RE.test(entry.sha256||''))
        throw new Error(`visual dependency group ${group} has an invalid entry`);
      return{path:entry.path.replace(/\\/g,'/'),sha256:entry.sha256};
    }).sort((a,b)=>compareText(a.path,b.path));
  }
  return out;
}

function reviewIdentityFromManifests(evidenceManifest,dependencyManifest){
  return manifestSha256({protocol:PROTOCOL,kind:'visual-review-identity',version:1,
    game:evidenceManifest.game,evidenceManifestSha256:manifestSha256(evidenceManifest),dependencyManifestSha256:manifestSha256(dependencyManifest)});
}

function createVisualProvenance(game,options){
  options=options||{};
  const evidenceManifest=normalizeEvidenceManifest(game,options.evidenceManifest||options.evidence),
    dependencyManifest=options.dependencyManifest?normalizeDependencyManifest(game,options.dependencyManifest):createDependencyManifest(game,options);
  const montageSha256=options.montageSha256;
  if(!HASH_RE.test(montageSha256||''))throw new Error('visual provenance montage hash is missing or invalid');
  return{schema:1,protocol:PROTOCOL,game,montageSha256,evidenceManifest,
    evidenceManifestSha256:manifestSha256(evidenceManifest),dependencyManifest,
    dependencyManifestSha256:manifestSha256(dependencyManifest),
    reviewIdentitySha256:reviewIdentityFromManifests(evidenceManifest,dependencyManifest)};
}

function writeVisualProvenance(outPath,game,options){
  const value=createVisualProvenance(game,options);
  fs.mkdirSync(path.dirname(outPath),{recursive:true});
  fs.writeFileSync(outPath,JSON.stringify(value,null,2)+'\n');
  return value;
}

function reviewIdentitySha256(game,options){
  if(typeof game!=='string'||!/^[a-z0-9-]+$/.test(game))throw new Error('reviewIdentitySha256 needs a valid game slug');
  options=options||{};
  const dependencyManifest=options.dependencyManifest?normalizeDependencyManifest(game,options.dependencyManifest):createDependencyManifest(game,options),
    evidenceInput=options.evidenceManifest||options.evidence;
  if(evidenceInput)return reviewIdentityFromManifests(normalizeEvidenceManifest(game,evidenceInput),dependencyManifest);
  return manifestSha256({protocol:PROTOCOL,kind:'visual-review-source-identity',version:1,game,
    dependencyManifestSha256:manifestSha256(dependencyManifest)});
}

function verifyReviewReceipt(receiptOrPath,options,legacy){
  options=options||{};
  const receiptPath=typeof receiptOrPath==='string'?receiptOrPath:null,
    receipt=receiptPath?JSON.parse(fs.readFileSync(receiptPath,'utf8')):receiptOrPath,
    protocolReceipt=!!(receipt&&(receipt.protocol===PROTOCOL||receipt.evidenceManifest||receipt.evidenceManifestSha256||receipt.dependencyManifest||receipt.dependencyManifestSha256));
  if(!protocolReceipt){
    const base=legacy.verify(receiptOrPath,options),game=options.game||(receiptPath?path.basename(receiptPath,path.extname(receiptPath)):receipt&&receipt.game),
      anchor=game&&LEGACY_COMPATIBILITY.receipts&&LEGACY_COMPATIBILITY.receipts[game];
    if(!anchor||!receipt||receipt.reviewIdentitySha256!==anchor.reviewIdentitySha256||!base.errors.includes('review code/capture identity is stale'))return base;
    let currentIdentity=null;try{currentIdentity=reviewIdentitySha256(game,{root:options.root,visualEvalPath:options.visualEvalPath})}catch{return base}
    if(currentIdentity!==anchor.sourceIdentitySha256)return base;
    let errors=base.errors.filter(error=>error!=='review code/capture identity is stale'),platformDriftAccepted=base.platformDriftAccepted;
    const expectedHash=options.montageSha256||(options.montagePath&&fileSha256(options.montagePath));
    if(expectedHash&&receipt.montageSha256!==expectedHash&&receipt.allowCrossPlatformRasterization===true&&receipt.reviewPlatform!==(options.platform||process.platform)){
      errors=errors.filter(error=>error!=='review montage hash is stale');platformDriftAccepted=errors.length===0;
    }
    return{...base,ok:errors.length===0,errors,platformDriftAccepted,currentIdentity,receipt};
  }
  const expectedGame=options.game||(receiptPath?path.basename(receiptPath,path.extname(receiptPath)):null),game=expectedGame||(receipt&&receipt.game),
    synthetic=receipt&&{...receipt,reviewIdentitySha256:legacy.identity(game,{root:options.root,visualEvalPath:options.visualEvalPath})},
    base=legacy.verify(synthetic,options),errors=base.errors.filter(error=>error!=='review code/capture identity is stale'),warnings=[...base.warnings];
  const add=message=>{if(!errors.includes(message))errors.push(message)};
  if(!receipt||receipt.schema<2)add('ambient evidence receipts require review schema 2');
  if(receipt&&receipt.protocol!==undefined&&receipt.protocol!==PROTOCOL)add('ambient evidence protocol is unsupported');
  if(!HASH_RE.test(receipt&&receipt.reviewIdentitySha256||''))add('review code/capture identity is missing or invalid');
  let evidenceManifest=null,dependencyManifest=null,currentIdentity=null;
  try{
    evidenceManifest=normalizeEvidenceManifest(game,receipt.evidenceManifest);
    const evidenceHash=manifestSha256(evidenceManifest);
    if(!HASH_RE.test(receipt.evidenceManifestSha256||''))add('review evidence manifest hash is missing or invalid');
    else if(receipt.evidenceManifestSha256!==evidenceHash)add('review evidence manifest hash is stale');
    if(JSON.stringify(receipt.references)!==JSON.stringify(evidenceManifest.references))add('review references do not match evidence manifest');
    if(!Array.isArray(receipt.checkpoints))add('review checkpoints are missing');
    else if(JSON.stringify(receipt.checkpoints)!==JSON.stringify(evidenceManifest.checkpoints))add('review checkpoints do not match evidence manifest');
    const currentEvidence=normalizeEvidenceManifest(game,options.evidenceManifest||options.evidence||evidenceManifest);
    if(manifestSha256(currentEvidence)!==evidenceHash)add('review evidence manifest is stale');
    dependencyManifest=normalizeDependencyManifest(game,receipt.dependencyManifest);
    const dependencyHash=manifestSha256(dependencyManifest);
    if(!HASH_RE.test(receipt.dependencyManifestSha256||''))add('review dependency manifest hash is missing or invalid');
    else if(receipt.dependencyManifestSha256!==dependencyHash)add('review dependency manifest hash is stale');
    const currentDependencies=createDependencyManifest(game,{root:options.root,visualEvalPath:options.visualEvalPath,
      references:evidenceManifest.references});
    if(manifestSha256(currentDependencies)!==dependencyHash)add('review dependency manifest is stale');
    currentIdentity=reviewIdentityFromManifests(currentEvidence,currentDependencies);
    if(receipt.reviewIdentitySha256!==currentIdentity)add('review code/capture identity is stale');
    if(options.provenance){
      const provenance=options.provenance;
      if(!provenance||provenance.protocol!==PROTOCOL||provenance.game!==game)add('generated visual provenance header is invalid');
      if(provenance.montageSha256!==receipt.montageSha256)add('generated visual provenance montage is stale');
      if(provenance.evidenceManifestSha256!==receipt.evidenceManifestSha256||provenance.dependencyManifestSha256!==receipt.dependencyManifestSha256||provenance.reviewIdentitySha256!==receipt.reviewIdentitySha256)
        add('generated visual provenance does not match review receipt');
      try{
        if(manifestSha256(normalizeEvidenceManifest(game,provenance.evidenceManifest))!==provenance.evidenceManifestSha256||
          manifestSha256(normalizeDependencyManifest(game,provenance.dependencyManifest))!==provenance.dependencyManifestSha256)
          add('generated visual provenance manifest hash is stale');
      }catch(error){add(error.message)}
    }
  }catch(error){add(error.message)}
  const ok=errors.length===0;
  return{...base,ok,errors,warnings,platformDriftAccepted:ok&&base.platformDriftAccepted,currentIdentity,
    evidenceManifest,dependencyManifest,receipt};
}

function legacyIdentityInputBytes(root,relative,current){
  const rolloutHash=LEGACY_COMPATIBILITY.projectedPaths.get(relative);
  const currentHash=crypto.createHash('sha256').update(current).digest('hex');
  if(!rolloutHash||currentHash!==rolloutHash)return current;
  try{return execFileSync('git',['-C',root,'show',`${LEGACY_COMPATIBILITY.baseRevision}:${relative}`],{stdio:['ignore','pipe','ignore']})}
  catch{return current}
}

function legacyGameHashAccepted(game,reviewedHash,currentHash){
  const hashes=LEGACY_COMPATIBILITY.gameHashes[game];
  return !!hashes&&reviewedHash===hashes.reviewed&&currentHash===hashes.rollout;
}

function legacyHarnessBytes(input){
  let source=Buffer.isBuffer(input)?input.toString('utf8'):String(input);
  source=source.replace("const protocol=require('./visual-provenance');\n",'')
    .replace('function legacyReviewIdentitySha256(game,options){','function reviewIdentitySha256(game,options){')
    .replace('function verifyLegacyReviewReceipt(receiptOrPath,options){','function verifyReviewReceipt(receiptOrPath,options){')
    .replace('const currentIdentity=identityGame?legacyReviewIdentitySha256(identityGame,{root:options.root,visualEvalPath:options.visualEvalPath}):null;',
      'const currentIdentity=identityGame?reviewIdentitySha256(identityGame,{root:options.root,visualEvalPath:options.visualEvalPath}):null;')
    .replace("    let bytes=protocol.legacyIdentityInputBytes(root,relative,fs.readFileSync(file));\n    if(relative==='evals/visual-harness.js')bytes=protocol.legacyHarnessBytes(bytes);\n    hash.update(relative+'\\0');hash.update(bytes);hash.update('\\0');",
      "    hash.update(relative+'\\0');hash.update(fs.readFileSync(file));hash.update('\\0');")
    .replace(/\n\/\* AEP_V1_BEGIN \*\/[\s\S]*?\/\* AEP_V1_END \*\/\n/,'')
    .replace("  legacyReviewIdentitySha256,reviewIdentitySha256,verifyReviewReceipt,legacyGameHashAccepted,writeJson,\n  AMBIENT_EVIDENCE_PROTOCOL:protocol.PROTOCOL,manifestSha256:protocol.manifestSha256,\n  createEvidenceManifest:protocol.createEvidenceManifest,createDependencyManifest:protocol.createDependencyManifest,\n  createVisualProvenance:protocol.createVisualProvenance,writeVisualProvenance:protocol.writeVisualProvenance\n",'  reviewIdentitySha256,verifyReviewReceipt,writeJson\n');
  return Buffer.from(source);
}

module.exports={
  PROTOCOL,HASH_RE,EVIDENCE_FIELDS,canonicalJson,manifestSha256,fileSha256,
  createEvidenceManifest,normalizeEvidenceManifest,consumedBaselineFiles,
  createDependencyManifest,normalizeDependencyManifest,reviewIdentityFromManifests,
  createVisualProvenance,writeVisualProvenance,reviewIdentitySha256,verifyReviewReceipt,
  legacyIdentityInputBytes,legacyGameHashAccepted,legacyHarnessBytes
};
