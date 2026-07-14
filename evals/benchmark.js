'use strict';

const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const{buildScorecard}=require('./scorecard');
const{seededRandom}=require('./harness');

let sharedAblation=null;
try{sharedAblation=require('./ablation')}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error}

let sharedEvidence=null;
try{sharedEvidence=require('./evidence')}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error}

const PROTOCOL='ambient-evidence/v1';
const RECEIPT_SCHEMA='ambient-evidence-receipt/v1';
const EVENTS_SCHEMA='ambient-evidence-events/v1';
const PROVENANCE_SCHEMA='ambient-evidence-provenance/v1';
const DIAGNOSIS_SCHEMA='ambient-evidence-diagnosis/v1';
const ARTIFACT_INDEX_SCHEMA='ambient-evidence-artifact-index/v1';

const FAILURE_CODES=Object.freeze({
  NO_NATURAL_EVENTS:'AEV_NO_NATURAL_EVENTS',
  MOTION_ONLY:'AEV_MOTION_ONLY',
  CLUMPED_BEATS:'AEV_CLUMPED_BEATS',
  ALIASED_SOURCES:'AEV_ALIASED_SOURCES',
  BASELINE_HANDICAP:'AEV_BASELINE_HANDICAP',
  NO_CAUSAL_EFFECT:'AEV_NO_CAUSAL_EFFECT',
  RNG_LEAKAGE:'AEV_RNG_LEAKAGE',
  EVIDENCE_LEAKAGE:'AEV_EVIDENCE_LEAKAGE',
  FIXTURE_ONLY_REACHABILITY:'AEV_FIXTURE_ONLY_REACHABILITY',
  NONDETERMINISTIC_REPLAY:'AEV_NONDETERMINISTIC_REPLAY',
  INVALID_EVIDENCE:'AEV_INVALID_EVIDENCE',
  MISSING_DIMENSION:'AEV_MISSING_DIMENSION',
  HARD_DIMENSION:'AEV_HARD_DIMENSION'
});

const DEFAULT_PROFILES=Object.freeze({
  release:Object.freeze({
    minMeaningfulBeatsPerSeed:3,
    minDecisionKinds:2,
    minIndependentSources:2,
    beatBucketFrames:300,
    minBeatBuckets:2,
    maxDeadAirFrames:900,
    minBaselineProgress:1,
    minBaselineProgressRatio:0.2,
    requireBaseline:true,
    requireCausalEffect:true,
    requireEvidenceIsolation:true,
    dimensions:Object.freeze({
      meaningfulBeatCount:{min:3,hard:true,unit:'beats'},
      decisionKindCount:{min:2,hard:true,unit:'categories'},
      independentSourceCount:{min:2,hard:true,unit:'sources'},
      beatBucketCount:{min:2,hard:true,unit:'buckets'},
      maxDeadAirFrames:{max:900,hard:true,unit:'frames'},
      naturalReachability:{min:1,max:1,hard:true,unit:'ratio'},
      baselineProgressRatio:{min:0.2,hard:true,unit:'ratio'},
      evidenceIntegrity:{min:1,max:1,hard:true,unit:'ratio'}
    })
  }),
  smoke:Object.freeze({
    minMeaningfulBeatsPerSeed:1,
    minDecisionKinds:1,
    minIndependentSources:1,
    beatBucketFrames:600,
    minBeatBuckets:1,
    maxDeadAirFrames:1800,
    minBaselineProgress:1,
    minBaselineProgressRatio:0.1,
    requireBaseline:true,
    requireCausalEffect:true,
    requireEvidenceIsolation:true,
    dimensions:Object.freeze({
      meaningfulBeatCount:{min:1,hard:true,unit:'beats'},
      decisionKindCount:{min:1,hard:true,unit:'categories'},
      independentSourceCount:{min:1,hard:true,unit:'sources'},
      beatBucketCount:{min:1,hard:true,unit:'buckets'},
      maxDeadAirFrames:{max:1800,hard:true,unit:'frames'},
      naturalReachability:{min:1,max:1,hard:true,unit:'ratio'},
      baselineProgressRatio:{min:0.1,hard:true,unit:'ratio'},
      evidenceIntegrity:{min:1,max:1,hard:true,unit:'ratio'}
    })
  })
});

const MOVEMENT_KINDS=new Set(['move','movement','motion','walk','walking','turn','turning','replan','replanning','path','locomotion','idle','travel']);
const FRAMEWORK_DIMENSION_IDS=Object.freeze([
  'meaningfulBeatCount','decisionKindCount','independentSourceCount','beatBucketCount','maxDeadAirFrames',
  'naturalReachability','baselineProgressRatio','evidenceIntegrity','causalSeedShare'
]);
const FRAMEWORK_DIMENSION_ID_SET=new Set(FRAMEWORK_DIMENSION_IDS);
const isObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);

function canonicalize(value,stack){
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){
    if(!Number.isFinite(value))throw new Error('canonical JSON rejects non-finite numbers');
    return Object.is(value,-0)?0:value;
  }
  if(Array.isArray(value))return value.map(item=>canonicalize(item,stack));
  if(typeof value!=='object')throw new Error(`canonical JSON rejects ${typeof value}`);
  stack=stack||new Set();if(stack.has(value))throw new Error('canonical JSON rejects cycles');stack.add(value);
  const out={};
  for(const key of Object.keys(value).sort()){
    const item=value[key];if(item===undefined)continue;
    out[key]=canonicalize(item,stack);
  }
  stack.delete(value);return out;
}

function fallbackCanonicalStringify(value){return JSON.stringify(canonicalize(value));}
function canonicalStringify(value){
  const fn=sharedEvidence&&(sharedEvidence.canonicalStringify||sharedEvidence.stableStringify||sharedEvidence.canonicalJson);
  if(typeof fn==='function'){
    const result=fn(canonicalize(value));
    if(typeof result==='string')return result.endsWith('\n')?result.slice(0,-1):result;
  }
  return fallbackCanonicalStringify(value);
}
function canonicalBytes(value){return Buffer.from(canonicalStringify(value)+'\n');}
function sha256(value){
  const buffer=Buffer.isBuffer(value)?value:Buffer.from(String(value));
  if(sharedEvidence&&typeof sharedEvidence.sha256==='function'){
    const result=sharedEvidence.sha256(buffer);if(typeof result==='string'&&/^[a-f0-9]{64}$/.test(result))return result;
  }
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
function canonicalEqual(a,b){try{return canonicalStringify(a)===canonicalStringify(b)}catch{return false}}

function deterministicSeedPanel(options){
  options=options||{};
  if(Array.isArray(options.seeds)){
    if(!options.seeds.length)throw new Error('seed panel must not be empty');
    const seeds=options.seeds.map(normalizeSeed),seen=new Set();
    for(const seed of seeds){const key=canonicalStringify(seed);if(seen.has(key))throw new Error(`seed panel contains duplicate canonical seed ${String(seed)}`);seen.add(key)}
    return seeds;
  }
  const count=options.count===undefined?5:Number(options.count);
  if(!Number.isInteger(count)||count<=0||count>10000)throw new Error('seed count must be an integer from 1 to 10000');
  const namespace=String(options.namespace||options.benchmarkId||'ambient-evidence');
  const profile=String(options.profile||'release'),base=String(options.baseSeed===undefined?'v1':options.baseSeed);
  const digest=crypto.createHash('sha256').update(`${PROTOCOL}\0${namespace}\0${profile}\0${base}`).digest(),
    random=seededRandom(digest.readUInt32BE(0)||1),seeds=[],seen=new Set();
  while(seeds.length<count){let seed=Math.floor(random()*0x100000000)>>>0;if(seed===0)seed=1;if(seen.has(seed))continue;seen.add(seed);seeds.push(seed)}
  return seeds;
}
function normalizeSeed(seed){
  if(typeof seed==='number'&&Number.isSafeInteger(seed)&&seed>=0)return seed;
  if(typeof seed==='string'&&seed.trim())return seed.trim();
  throw new Error(`invalid deterministic seed ${String(seed)}`);
}

function resolveProfile(spec,name){
  const profiles={...DEFAULT_PROFILES,...(spec.profiles||{})};
  const profile=profiles[name];if(!profile)throw new Error(`unknown benchmark profile: ${name}`);
  const base=DEFAULT_PROFILES[name]||DEFAULT_PROFILES.release;
  return{...base,...profile,dimensions:{...(base.dimensions||{}),...(profile.dimensions||{})}};
}
function assertAdditionalDimensions(dimensions,label){
  if(dimensions===undefined||dimensions===null)return;
  for(const id of Object.keys(dimensions))if(FRAMEWORK_DIMENSION_ID_SET.has(id))throw new Error(`${label} may not override framework-derived dimension ${id}`);
}

function normalizeEvent(event,context){
  if(!event||typeof event!=='object')throw new Error(`seed ${context.seed}: evidence event must be an object`);
  const frame=Number(event.frame===undefined?event.at:event.frame);
  if(!Number.isInteger(frame)||frame<0||frame>=context.frames)throw new Error(`seed ${context.seed}: evidence event frame must be an integer from 0 to ${context.frames-1}`);
  const category=String(event.category||event.kind||event.type||'unknown').trim().toLowerCase();
  const source=event.source===undefined||event.source===null?'':String(event.source).trim();
  return{
    seed:context.seed,
    variant:context.variant,
    frame,
    category,
    source,
    id:event.id===undefined?null:String(event.id),
    visible:event.visible!==false,
    natural:context.variant==='live'&&event.fixture!==true&&event.natural!==false,
    fixture:context.variant==='fixture'||event.fixture===true,
    meaningful:event.meaningful===true||(event.meaningful!==false&&!MOVEMENT_KINDS.has(category)),
    details:isObject(event.details)?event.details:null
  };
}

function normalizeObservation(observation,context){
  const o=observation||{},frames=Number(o.frames===undefined?context.frames:o.frames);
  if(!Number.isInteger(frames)||frames<=0)throw new Error(`seed ${context.seed}: ${context.variant} observation frames must be a positive integer`);
  let evidenceReport=null,derivedEvidence=null,rawEvents=Array.isArray(o.events)?o.events:null;
  const ledger=o.evidence||o.ledger||null;
  if(ledger&&sharedEvidence&&typeof sharedEvidence.validateEvidence==='function'){
    evidenceReport=sharedEvidence.validateEvidence(ledger,{});
    if(evidenceReport.ok){
      if(typeof sharedEvidence.deriveEvidence==='function')derivedEvidence=sharedEvidence.deriveEvidence(ledger,{});
      if(!rawEvents)rawEvents=evidenceReport.ledger.events.map(event=>event.runFrame===undefined?event:{...event,frame:event.runFrame});
    }
  }
  const events=(rawEvents||[]).map(event=>normalizeEvent(event,{...context,frames}));
  return{
    seed:context.seed,variant:context.variant,
    frames,
    events,
    progress:finite(o.progress)?o.progress:0,
    decisions:o.decisions===undefined?null:o.decisions,
    decisionSignature:o.decisionSignature===undefined?null:o.decisionSignature,
    simSignature:o.simSignature===undefined?(o.signature===undefined?null:o.signature):o.simSignature,
    rngState:o.rngState===undefined?null:o.rngState,
    environmentSignature:o.environmentSignature===undefined?null:o.environmentSignature,
    capable:o.capable!==false,
    handicap:o.handicap===true,
    unrelatedChanges:Array.isArray(o.unrelatedChanges)?o.unrelatedChanges.map(String).sort():[],
    dimensions:isObject(o.dimensions)?o.dimensions:{},
    provenance:isObject(o.provenance)?o.provenance:{},
    evidenceReport,derivedEvidence,raw:o
  };
}

function normalizeBundle(bundle,seed,options){
  const b=bundle||{};seed=normalizeSeed(seed);
  const live=normalizeObservation(b.live||b.natural||b,{seed,variant:'live',frames:options.frames});
  const baseline=b.baseline?normalizeObservation(b.baseline,{seed,variant:'baseline',frames:live.frames}):null;
  const evidenceOff=b.evidenceOff||b.withoutEvidence;
  const isolated=evidenceOff?normalizeObservation(evidenceOff,{seed,variant:'evidence-off',frames:live.frames}):null;
  const replay=b.replay?normalizeObservation(b.replay,{seed,variant:'replay',frames:live.frames}):null;
  const fixture=b.fixture?normalizeObservation(b.fixture,{seed,variant:'fixture',frames:live.frames}):null;
  return{seed,live,baseline,evidenceOff:isolated,replay,fixture};
}

async function collectRuns(spec,options,seeds,profile){
  if(Array.isArray(options.runs))return options.runs.map(run=>normalizeBundle(run,run.seed,options));
  if(Array.isArray(spec.runs))return spec.runs.map(run=>normalizeBundle(run,run.seed,options));
  const execute=options.execute||spec.execute,bundleRunner=!execute&&(options.run||spec.run);
  if(typeof execute!=='function'&&typeof bundleRunner!=='function')throw new Error('benchmark needs execute({seed, profile, variant}) or pre-collected runs');
  const out=[];
  for(const seed of seeds){
    if(bundleRunner){const bundle=await bundleRunner({seed,profile:options.profile,frames:options.frames,ablation:spec.ablation,verifyReplay:options.verifyReplay===true});out.push(normalizeBundle(bundle,bundle&&bundle.seed,options));continue}
    const live=await execute({seed,profile:options.profile,variant:'live',frames:options.frames,evidence:true,ablation:spec.ablation});
    if(live&&(live.live||live.natural||live.baseline||live.evidenceOff||live.fixture)){out.push(normalizeBundle(live,live.seed,options));continue}
    const baseline=profile.requireBaseline===false?null:await execute({seed,profile:options.profile,variant:'baseline',frames:options.frames,evidence:true,ablation:spec.ablation});
    const evidenceOff=profile.requireEvidenceIsolation===false?null:await execute({seed,profile:options.profile,variant:'evidence-off',frames:options.frames,evidence:false,ablation:spec.ablation});
    const replay=options.verifyReplay?await execute({seed,profile:options.profile,variant:'live',frames:options.frames,evidence:true,ablation:spec.ablation,replay:true}):null;
    out.push(normalizeBundle({live,baseline,evidenceOff,replay},seed,options));
  }
  return out;
}

function addDiagnosis(list,code,message,details){list.push({code,message,details:details||null})}
function eventSort(a,b){return String(a.seed).localeCompare(String(b.seed),undefined,{numeric:true})||a.frame-b.frame||a.variant.localeCompare(b.variant)||a.category.localeCompare(b.category)||a.source.localeCompare(b.source)||String(a.id).localeCompare(String(b.id))}

function analyzeBenchmark(spec,runs,options){
  options=options||{};assertAdditionalDimensions(spec.dimensions,'spec.dimensions');assertAdditionalDimensions(options.dimensions,'options.dimensions');
  const profile=options.profileDefinition||resolveProfile(spec,options.profile||spec.defaultProfile||'release');
  const diagnoses=[],liveEvents=[],allEvents=[],categories=new Map(),sourceKinds=new Map(),bucketSet=new Set();
  let maxDeadAir=0,meaningfulCount=0,naturalSeedsWithRequired=0,baselineRatios=[],integrityPass=0,causalSeeds=0;
  const requiredCategories=(profile.requiredNaturalCategories||spec.requiredNaturalCategories||[]).map(value=>String(value).toLowerCase()).sort();
  for(const run of runs){
    if(run.live.evidenceReport&&!run.live.evidenceReport.ok){
      addDiagnosis(diagnoses,FAILURE_CODES.INVALID_EVIDENCE,`seed ${run.seed} supplied an invalid Ambient Evidence ledger`,{seed:run.seed,reasons:run.live.evidenceReport.reasons});
      for(const violation of run.live.evidenceReport.violations)addDiagnosis(diagnoses,violation.code,violation.message,{seed:run.seed,...(violation.details||{})});
    }
    if(spec.ablationContract&&run.baseline&&sharedAblation&&typeof sharedAblation.analyzeAblationPair==='function'){
      const report=sharedAblation.analyzeAblationPair({live:run.live.raw,baseline:run.baseline.raw},spec.ablationContract);
      for(const violation of report.violations){
        const code=violation.code==='NO_DIVERGENCE'||violation.code==='IRRELEVANT_EFFECT'?FAILURE_CODES.NO_CAUSAL_EFFECT:FAILURE_CODES.BASELINE_HANDICAP;
        addDiagnosis(diagnoses,code,`seed ${run.seed}: ${violation.message}`,{seed:run.seed,ablationReason:violation.code,...(violation.details||{})});
      }
    }
    const natural=run.live.events.filter(event=>event.natural&&event.visible);
    liveEvents.push(...natural);allEvents.push(...run.live.events);
    if(run.baseline)allEvents.push(...run.baseline.events);
    if(run.evidenceOff)allEvents.push(...run.evidenceOff.events);
    if(run.replay)allEvents.push(...run.replay.events);
    if(run.fixture)allEvents.push(...run.fixture.events);
    const meaningful=natural.filter(event=>event.meaningful);meaningfulCount+=meaningful.length;
    const minimumMeaningful=profile.minMeaningfulBeatsPerSeed||1;
    if(!natural.length)addDiagnosis(diagnoses,FAILURE_CODES.NO_NATURAL_EVENTS,`seed ${run.seed} produced no visible natural-run evidence`,{seed:run.seed});
    if(natural.length&&!meaningful.length)addDiagnosis(diagnoses,FAILURE_CODES.MOTION_ONLY,`seed ${run.seed} credited only ordinary locomotion`,{seed:run.seed,categories:[...new Set(natural.map(e=>e.category))].sort()});
    if(meaningful.length<minimumMeaningful)addDiagnosis(diagnoses,FAILURE_CODES.MOTION_ONLY,`seed ${run.seed} produced only ${meaningful.length} meaningful beat(s)`,{seed:run.seed,minimum:minimumMeaningful});
    const perSeedKinds=new Set(),perSeedSources=new Map();
    for(const event of meaningful){
      perSeedKinds.add(event.category);bucketSet.add(`${run.seed}:${Math.floor(event.frame/profile.beatBucketFrames)}`);
      if(!categories.has(event.category))categories.set(event.category,0);categories.set(event.category,categories.get(event.category)+1);
      if(event.source){if(!sourceKinds.has(event.source))sourceKinds.set(event.source,new Set());sourceKinds.get(event.source).add(event.category);perSeedSources.set(event.category,event.source)}
    }
    const ordered=meaningful.map(event=>event.frame).sort((a,b)=>a-b),end=Math.max(run.live.frames,ordered.at(-1)||0);let previous=0;
    for(const at of [...ordered,end]){maxDeadAir=Math.max(maxDeadAir,at-previous);previous=at}
    const perSeedBuckets=new Set(meaningful.map(event=>Math.floor(event.frame/profile.beatBucketFrames)));
    if(meaningful.length>=(profile.minMeaningfulBeatsPerSeed||1)&&perSeedBuckets.size<(profile.minBeatBuckets||1))
      addDiagnosis(diagnoses,FAILURE_CODES.CLUMPED_BEATS,`seed ${run.seed} concentrated ${meaningful.length} beats into ${perSeedBuckets.size} time bucket(s)`,{seed:run.seed,buckets:perSeedBuckets.size,minimum:profile.minBeatBuckets});
    if(ordered.length&&maxGap(ordered,end)>profile.maxDeadAirFrames)
      addDiagnosis(diagnoses,FAILURE_CODES.CLUMPED_BEATS,`seed ${run.seed} left ${maxGap(ordered,end)} frames of dead air`,{seed:run.seed,maxDeadAirFrames:maxGap(ordered,end),limit:profile.maxDeadAirFrames});
    const naturalKinds=new Set(meaningful.map(event=>event.category));
    const missing=requiredCategories.filter(category=>!naturalKinds.has(category));
    const fixtureKinds=new Set(run.fixture?run.fixture.events.filter(e=>e.visible&&e.meaningful).map(e=>e.category):[]);
    const fixtureOnly=missing.filter(category=>fixtureKinds.has(category));
    if(fixtureOnly.length)addDiagnosis(diagnoses,FAILURE_CODES.FIXTURE_ONLY_REACHABILITY,
      `seed ${run.seed} reaches required evidence only through fixtures`,{seed:run.seed,categories:fixtureOnly});
    if(!missing.length)naturalSeedsWithRequired++;
    if(profile.requireBaseline!==false){
      if(!run.baseline)addDiagnosis(diagnoses,FAILURE_CODES.BASELINE_HANDICAP,`seed ${run.seed} has no active baseline`,{seed:run.seed,reason:'missing'});
      else{
        const ratio=run.live.progress>0?run.baseline.progress/run.live.progress:(run.baseline.progress>=profile.minBaselineProgress?1:0);baselineRatios.push(ratio);
        const environmentChanged=run.live.environmentSignature!==null&&run.baseline.environmentSignature!==null&&!canonicalEqual(run.live.environmentSignature,run.baseline.environmentSignature);
        if(run.baseline.handicap||!run.baseline.capable||run.baseline.unrelatedChanges.length||run.baseline.progress<profile.minBaselineProgress||ratio<profile.minBaselineProgressRatio||environmentChanged)
          addDiagnosis(diagnoses,FAILURE_CODES.BASELINE_HANDICAP,`seed ${run.seed} baseline was handicapped or unable to progress`,{seed:run.seed,progress:run.baseline.progress,liveProgress:run.live.progress,ratio,unrelatedChanges:run.baseline.unrelatedChanges,environmentChanged});
        const liveDecision=run.live.decisionSignature===null?run.live.decisions:run.live.decisionSignature;
        const baseDecision=run.baseline.decisionSignature===null?run.baseline.decisions:run.baseline.decisionSignature;
        if(liveDecision!==null&&baseDecision!==null&&!canonicalEqual(liveDecision,baseDecision))causalSeeds++;
        else if(profile.requireCausalEffect!==false)addDiagnosis(diagnoses,FAILURE_CODES.NO_CAUSAL_EFFECT,`seed ${run.seed} ablation did not change decisions`,{seed:run.seed});
      }
    }
    if(profile.requireEvidenceIsolation!==false){
      if(!run.evidenceOff)addDiagnosis(diagnoses,FAILURE_CODES.EVIDENCE_LEAKAGE,`seed ${run.seed} has no evidence-disabled twin`,{seed:run.seed,reason:'missing'});
      else{
        const simPresent=run.live.simSignature!==null&&run.evidenceOff.simSignature!==null,
          rngPresent=run.live.rngState!==null&&run.evidenceOff.rngState!==null,
          simSame=simPresent&&canonicalEqual(run.live.simSignature,run.evidenceOff.simSignature),
          rngSame=rngPresent&&canonicalEqual(run.live.rngState,run.evidenceOff.rngState);
        if(!simPresent)addDiagnosis(diagnoses,FAILURE_CODES.EVIDENCE_LEAKAGE,`seed ${run.seed} lacks non-null live and evidence-disabled simulation signatures`,{seed:run.seed,livePresent:run.live.simSignature!==null,evidenceOffPresent:run.evidenceOff.simSignature!==null});
        else if(!simSame)addDiagnosis(diagnoses,FAILURE_CODES.EVIDENCE_LEAKAGE,`seed ${run.seed} evidence collection changed simulation`,{seed:run.seed});
        if(!rngPresent)addDiagnosis(diagnoses,FAILURE_CODES.RNG_LEAKAGE,`seed ${run.seed} lacks non-null live and evidence-disabled RNG signatures`,{seed:run.seed,livePresent:run.live.rngState!==null,evidenceOffPresent:run.evidenceOff.rngState!==null});
        else if(!rngSame)addDiagnosis(diagnoses,FAILURE_CODES.RNG_LEAKAGE,`seed ${run.seed} evidence collection consumed or changed RNG`,{seed:run.seed});
        if(simSame&&rngSame)integrityPass++;
      }
    }else integrityPass++;
    if(options.verifyReplay===true&&!run.replay)addDiagnosis(diagnoses,FAILURE_CODES.NONDETERMINISTIC_REPLAY,`seed ${run.seed} has no deterministic replay`,{seed:run.seed,reason:'missing'});
    else if(run.replay&&!canonicalEqual(replayComparable(run.live),replayComparable(run.replay)))
      addDiagnosis(diagnoses,FAILURE_CODES.NONDETERMINISTIC_REPLAY,`seed ${run.seed} did not replay identically`,{seed:run.seed});
  }
  const aliases=[...sourceKinds].filter(([,kinds])=>kinds.size>1).map(([source,kinds])=>({source,categories:[...kinds].sort()})).sort((a,b)=>a.source.localeCompare(b.source));
  if(aliases.length)addDiagnosis(diagnoses,FAILURE_CODES.ALIASED_SOURCES,'multiple evidence categories share a telemetry source',{aliases});
  const kindCount=categories.size,sourceCount=sourceKinds.size,seedCount=Math.max(1,runs.length);
  if(meaningfulCount<seedCount*(profile.minMeaningfulBeatsPerSeed||1)&&!diagnoses.some(d=>d.code===FAILURE_CODES.MOTION_ONLY))
    addDiagnosis(diagnoses,FAILURE_CODES.MOTION_ONLY,`natural runs produced only ${meaningfulCount} meaningful beats`,{minimum:seedCount*(profile.minMeaningfulBeatsPerSeed||1)});
  if(kindCount<(profile.minDecisionKinds||1))addDiagnosis(diagnoses,FAILURE_CODES.MOTION_ONLY,`natural runs exposed only ${kindCount} meaningful category/categories`,{minimum:profile.minDecisionKinds});
  const rawDimensions={
    meaningfulBeatCount:{value:meaningfulCount,unit:'beats',source:'natural visible event ledger'},
    decisionKindCount:{value:kindCount,unit:'categories',source:'natural event category'},
    independentSourceCount:{value:sourceCount,unit:'sources',source:'declared event source'},
    beatBucketCount:{value:bucketSet.size,unit:'buckets',source:`${profile.beatBucketFrames}-frame natural event buckets`},
    maxDeadAirFrames:{value:maxDeadAir,unit:'frames',source:'natural meaningful event spacing'},
    naturalReachability:{value:requiredCategories.length?naturalSeedsWithRequired/runs.length:meaningfulCount?1:0,unit:'ratio',source:'natural seed panel'},
    baselineProgressRatio:{value:baselineRatios.length?Math.min(...baselineRatios):profile.requireBaseline===false?1:0,unit:'ratio',source:'same-seed ablation'},
    evidenceIntegrity:{value:runs.length?integrityPass/runs.length:0,unit:'ratio',source:'evidence-disabled same-seed twin'},
    causalSeedShare:{value:runs.length?causalSeeds/runs.length:0,unit:'ratio',source:'same-seed decision signature'},
    ...(spec.dimensions||{}),...(options.dimensions||{})
  };
  const deduped=dedupeDiagnoses(diagnoses);
  const gates=[...new Set([...Object.values(FAILURE_CODES),...deduped.map(d=>d.code)])].sort().map(code=>({code,pass:!deduped.some(d=>d.code===code),hard:true,
    message:deduped.filter(d=>d.code===code).map(d=>d.message).join('; ')}));
  let scorecard=buildScorecard({profile:options.profile||spec.defaultProfile||'release',profileDefinition:profile,dimensions:rawDimensions,gates});
  const missing=scorecard.dimensions.filter(d=>d.required&&d.missing);
  for(const dimension of missing)addDiagnosis(deduped,FAILURE_CODES.MISSING_DIMENSION,`required raw dimension ${dimension.id} is missing`,{dimension:dimension.id});
  for(const dimension of scorecard.dimensions.filter(d=>d.hard&&!d.pass&&!d.missing))addDiagnosis(deduped,FAILURE_CODES.HARD_DIMENSION,`hard raw dimension ${dimension.id} missed its profile band`,{dimension:dimension.id,value:dimension.value,limits:dimension.limits});
  const finalDiagnoses=dedupeDiagnoses(deduped);
  const finalGates=[...new Set([...Object.values(FAILURE_CODES),...deduped.map(d=>d.code)])].sort().map(code=>({code,pass:!finalDiagnoses.some(d=>d.code===code),hard:true,message:finalDiagnoses.filter(d=>d.code===code).map(d=>d.message).join('; ')}));
  scorecard=buildScorecard({profile:options.profile||spec.defaultProfile||'release',profileDefinition:profile,dimensions:rawDimensions,gates:finalGates});
  return{profile,scorecard,events:allEvents.sort(eventSort),diagnoses:finalDiagnoses.sort(diagnosisSort),rawDimensions};
}

function maxGap(frames,end){let max=0,previous=0;for(const at of[...frames,end]){max=Math.max(max,at-previous);previous=at}return max}
function replayComparable(run){return{frames:run.frames,events:run.events.map(({variant,natural,fixture,...event})=>event),evidenceHash:run.derivedEvidence&&run.derivedEvidence.hash||null,progress:run.progress,decisions:run.decisions,decisionSignature:run.decisionSignature,simSignature:run.simSignature,rngState:run.rngState,dimensions:run.dimensions}}
function diagnosisSort(a,b){return a.code.localeCompare(b.code)||a.message.localeCompare(b.message)||canonicalStringify(a.details).localeCompare(canonicalStringify(b.details))}
function dedupeDiagnoses(items){const seen=new Set(),out=[];for(const item of items){const key=canonicalStringify(item);if(!seen.has(key)){seen.add(key);out.push(item)}}return out}

function sourceProvenance(spec,options,runs){
  const root=path.resolve(options.root||path.join(__dirname,'..')),frameworkFiles=['evals/benchmark.js','evals/scorecard.js'];
  if(fs.existsSync(path.join(root,'evals/evidence.js')))frameworkFiles.push('evals/evidence.js');
  if(spec.ablationContract&&fs.existsSync(path.join(root,'evals/ablation.js')))frameworkFiles.push('evals/ablation.js');
  const requested=[...frameworkFiles,...(spec.provenanceFiles||[]),...(options.provenanceFiles||[])];
  const files=[];
  for(const entry of [...new Set(requested.map(String))].sort()){
    const absolute=path.resolve(root,entry),relative=path.relative(root,absolute).split(path.sep).join('/');
    if(relative.startsWith('../')||path.isAbsolute(relative))throw new Error(`provenance input escapes root: ${entry}`);
    if(!fs.existsSync(absolute)||!fs.statSync(absolute).isFile())throw new Error(`provenance input missing: ${relative}`);
    const bytes=fs.readFileSync(absolute);files.push({path:relative,sha256:sha256(bytes),bytes:bytes.length});
  }
  const observed=runs.map(run=>run.live.provenance).filter(value=>Object.keys(value).length);
  return{schema:PROVENANCE_SCHEMA,protocol:PROTOCOL,benchmarkId:spec.id,game:spec.game||null,
    profile:options.profile,seedPanel:options.seeds,implementation:spec.version||'1',files,
    observed,configurationSha256:sha256(canonicalBytes({profile:options.profile,seeds:options.seeds,frames:options.frames||null,
      ablation:spec.ablation||null,requiredNaturalCategories:spec.requiredNaturalCategories||null}))};
}

function evidenceDigests(runs){
  const out=[];
  for(const run of runs)for(const variant of['live','baseline','evidenceOff','replay','fixture']){
    const observation=run[variant];
    if(observation&&observation.derivedEvidence&&typeof observation.derivedEvidence.hash==='string')
      out.push({seed:run.seed,variant,sha256:observation.derivedEvidence.hash});
  }
  return out.sort((a,b)=>String(a.seed).localeCompare(String(b.seed),undefined,{numeric:true})||a.variant.localeCompare(b.variant));
}

function createArtifactBundle(spec,runs,analysis,options){
  const events={schema:EVENTS_SCHEMA,protocol:PROTOCOL,benchmarkId:spec.id,profile:options.profile,
    seedPanel:options.seeds,evidenceDigests:evidenceDigests(runs),events:analysis.events};
  const diagnosis={schema:DIAGNOSIS_SCHEMA,protocol:PROTOCOL,benchmarkId:spec.id,profile:options.profile,
    verdict:analysis.diagnoses.length?'fail':'pass',failureCodes:[...new Set(analysis.diagnoses.map(d=>d.code))].sort(),diagnoses:analysis.diagnoses};
  const provenance=sourceProvenance(spec,options,runs);
  const primary={'scorecard.json':canonicalBytes(analysis.scorecard),'events.json':canonicalBytes(events),
    'provenance.json':canonicalBytes(provenance),'diagnosis.json':canonicalBytes(diagnosis)};
  const artifactIndex={schema:ARTIFACT_INDEX_SCHEMA,protocol:PROTOCOL,benchmarkId:spec.id,artifacts:Object.keys(primary).sort().map(name=>({name,sha256:sha256(primary[name]),bytes:primary[name].length,mediaType:'application/json'}))};
  const artifactIndexBytes=canonicalBytes(artifactIndex);
  const receipt={schema:RECEIPT_SCHEMA,protocol:PROTOCOL,benchmarkId:spec.id,game:spec.game||null,
    profile:options.profile,seedPanel:options.seeds,verdict:diagnosis.verdict,failureCodes:diagnosis.failureCodes,
    artifacts:Object.fromEntries([...artifactIndex.artifacts,{name:'artifact-index.json',sha256:sha256(artifactIndexBytes),bytes:artifactIndexBytes.length}].map(item=>[item.name,{sha256:item.sha256,bytes:item.bytes}]))};
  const files={...primary,'artifact-index.json':artifactIndexBytes,'receipt.json':canonicalBytes(receipt)};
  return{receipt,scorecard:analysis.scorecard,events,provenance,diagnosis,artifactIndex,files};
}

function writeBenchmarkArtifacts(bundle,outDir){
  const target=path.resolve(outDir);fs.mkdirSync(target,{recursive:true});
  for(const name of Object.keys(bundle.files).sort()){
    const destination=path.join(target,name),temporary=destination+`.tmp-${process.pid}`;
    fs.writeFileSync(temporary,bundle.files[name]);fs.renameSync(temporary,destination);
  }
  return target;
}

async function runBenchmark(spec,options){
  if(!spec||typeof spec.id!=='string'||!spec.id.trim())throw new Error('benchmark spec needs a stable id');
  options={...(options||{})};options.profile=options.profile||spec.defaultProfile||'release';
  if(options.frames===undefined&&spec.frames!==undefined)options.frames=spec.frames;
  if(options.frames!==undefined&&(!Number.isInteger(Number(options.frames))||Number(options.frames)<=0))throw new Error('benchmark frame budget must be a positive integer');
  if(options.frames!==undefined)options.frames=Number(options.frames);
  assertAdditionalDimensions(spec.dimensions,'spec.dimensions');assertAdditionalDimensions(options.dimensions,'options.dimensions');
  const profile=resolveProfile(spec,options.profile);
  const requestedSeeds=options.seeds!==undefined?options.seeds:(options.seedCount!==undefined?undefined:spec.seeds);
  options.seeds=deterministicSeedPanel({seeds:requestedSeeds,count:options.seedCount===undefined?(spec.seedCount===undefined?5:spec.seedCount):options.seedCount,
    namespace:spec.id,profile:options.profile,baseSeed:options.baseSeed===undefined?spec.baseSeed:options.baseSeed});
  const runs=await collectRuns(spec,options,options.seeds,profile);
  if(runs.length!==options.seeds.length)throw new Error(`benchmark collected ${runs.length} runs for ${options.seeds.length} seeds`);
  for(let index=0;index<options.seeds.length;index++)if(!canonicalEqual(runs[index].seed,options.seeds[index]))
    throw new Error(`benchmark run ${index} seed ${String(runs[index].seed)} does not match requested seed ${String(options.seeds[index])}`);
  const analysis=analyzeBenchmark(spec,runs,{...options,profileDefinition:profile});
  const bundle=createArtifactBundle(spec,runs,analysis,options);
  if(options.outDir)writeBenchmarkArtifacts(bundle,options.outDir);
  return{...bundle,runs,ok:bundle.receipt.verdict==='pass',outDir:options.outDir?path.resolve(options.outDir):null};
}

module.exports={PROTOCOL,RECEIPT_SCHEMA,EVENTS_SCHEMA,PROVENANCE_SCHEMA,DIAGNOSIS_SCHEMA,ARTIFACT_INDEX_SCHEMA,
  FAILURE_CODES,DEFAULT_PROFILES,canonicalize,canonicalStringify,canonicalBytes,sha256,deterministicSeedPanel,
  normalizeEvent,normalizeObservation,analyzeBenchmark,createArtifactBundle,writeBenchmarkArtifacts,runBenchmark};
