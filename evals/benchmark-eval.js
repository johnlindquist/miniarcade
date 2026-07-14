#!/usr/bin/env node
'use strict';

const fs=require('fs');
const os=require('os');
const path=require('path');
const{runBenchmark,deterministicSeedPanel,FAILURE_CODES}=require('./benchmark');
const evidence=require('./evidence');
const{buildScorecard}=require('./scorecard');
const runAll=require('./run-all');
const benchmarkCli=require('./benchmark-cli');

let failed=false,checks=0;
function check(condition,message){checks++;if(!condition){failed=true;console.error('  FAIL:',message)}}
function has(result,code){return result.diagnosis.failureCodes.includes(code)}
function throws(action,pattern,message){checks++;try{action();failed=true;console.error('  FAIL:',message)}catch(error){if(!pattern.test(String(error&&error.message))){failed=true;console.error('  FAIL:',`${message} (unexpected error: ${error.message})`)}}}
async function rejects(action,pattern,message){checks++;try{await action();failed=true;console.error('  FAIL:',message)}catch(error){if(!pattern.test(String(error&&error.message))){failed=true;console.error('  FAIL:',`${message} (unexpected error: ${error.message})`)}}}

const seeds=[101,202];
const SPEC={id:'ambient-evidence-fixture',game:'fixture-room',version:'1',defaultProfile:'release',
  seeds,requiredNaturalCategories:['puzzle','threat'],ablation:'__NO_ENEMY_AI'};
function live(seed){return{frames:1200,progress:10,decisionSignature:{route:'live-'+seed},simSignature:{score:seed+10,x:4},rngState:{state:seed*7},environmentSignature:'room-a',events:[
  {frame:90,category:'puzzle',source:'puzzleTransitions',id:'switch',visible:true},
  {frame:430,category:'threat',source:'enemyTells',id:'windup',visible:true},
  {frame:780,category:'response',source:'playerDodges',id:'dodge',visible:true},
  {frame:1050,category:'payoff',source:'roomPayoffs',id:'gate',visible:true}
]}}
function validBundle(seed){const natural=live(seed);return{seed,live:natural,
  baseline:{frames:1200,progress:5,decisionSignature:{route:'baseline-'+seed},simSignature:{score:seed+5,x:3},rngState:{state:seed*7},environmentSignature:'room-a',events:[{frame:500,category:'puzzle',source:'puzzleTransitions'}]},
  evidenceOff:{...natural,events:[]}}}
const validRuns=()=>seeds.map(validBundle);
const tempRoots=[];process.on('exit',()=>{for(const dir of tempRoots)fs.rmSync(dir,{recursive:true,force:true})});
const temp=prefix=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),prefix));tempRoots.push(dir);return dir};

async function benchmark(spec,runs,extra){return runBenchmark(spec,{profile:'release',runs,outDir:extra&&extra.outDir,dimensions:extra&&extra.dimensions})}

(async()=>{
  console.log('1) deterministic seed panels and canonical release evidence pass');
  const panelA=deterministicSeedPanel({benchmarkId:'fixture',profile:'release',baseSeed:'panel',count:5}),
    panelB=deterministicSeedPanel({benchmarkId:'fixture',profile:'release',baseSeed:'panel',count:5});
  check(JSON.stringify(panelA)===JSON.stringify(panelB),'same seed-panel inputs diverged');
  check(new Set(panelA).size===5&&panelA.every(Number.isInteger),'generated seed panel is not a stable integer panel');
  const countOverride=await runBenchmark({...SPEC,id:'seed-count-override-fixture',seeds:[7]},{profile:'release',seedCount:3,execute:({seed})=>validBundle(seed)});
  check(countOverride.runs.length===3&&countOverride.receipt.seedPanel.length===3&&!countOverride.receipt.seedPanel.includes(7),'explicit seed count did not override spec default seeds');
  let replayRequested=false;
  const bundledReplay=await runBenchmark({...SPEC,id:'bundle-replay-fixture',seeds:[101],run:({seed,verifyReplay})=>{replayRequested=verifyReplay;const bundle=validBundle(seed);bundle.replay=live(seed);return bundle}},{profile:'release',verifyReplay:true});
  check(replayRequested&&bundledReplay.ok,'bundle runner did not receive or pass deterministic replay verification');
  const passing=await benchmark(SPEC,validRuns());
  check(passing.ok,'valid multi-seed evidence failed: '+passing.diagnosis.failureCodes.join(', '));
  check(passing.scorecard.dimensions.every(d=>d.value===null||Number.isFinite(d.value)),'scorecard did not retain finite raw dimensions');
  console.log(`  ${panelA.length}-seed panel replayed; ${passing.events.events.length} canonical events accepted`);

  console.log('1a) framework dimensions are reserved while independent additions remain supported');
  const extraDimension=await benchmark({...SPEC,id:'extra-dimension-fixture',dimensions:{spectacleCount:{value:7,unit:'beats',source:'fixture'}}},validRuns(),{dimensions:{reactionCount:{value:5,unit:'beats',source:'fixture'}}});
  check(extraDimension.ok&&extraDimension.scorecard.dimensions.some(d=>d.id==='spectacleCount'&&d.value===7)&&extraDimension.scorecard.dimensions.some(d=>d.id==='reactionCount'&&d.value===5),'noncolliding spec/options dimensions were not retained');
  await rejects(()=>benchmark({...SPEC,id:'spec-dimension-collision',dimensions:{evidenceIntegrity:{value:1}}},validRuns()),/may not override framework-derived dimension evidenceIntegrity/,'spec dimension replaced framework evidence integrity');
  await rejects(()=>benchmark({...SPEC,id:'option-dimension-collision'},validRuns(),{dimensions:{meaningfulBeatCount:{value:999}}}),/may not override framework-derived dimension meaningfulBeatCount/,'options dimension replaced framework beat count');
  console.log('  framework measurements cannot be shadowed; one independent dimension retained');

  console.log('1b) seed identity is unique, canonical, ordered, and bound to collected bundles');
  throws(()=>deterministicSeedPanel({seeds:[101,101]}),/duplicate canonical seed/,'duplicate explicit seed panel was accepted');
  const reordered=validRuns().reverse();
  await rejects(()=>benchmark(SPEC,reordered),/run 0 seed 202 does not match requested seed 101/,'reordered pre-collected runs were accepted');
  const unseeded=validRuns();delete unseeded[0].seed;
  await rejects(()=>benchmark(SPEC,unseeded),/invalid deterministic seed undefined/,'unseeded pre-collected run inherited a requested seed');
  await rejects(()=>runBenchmark({...SPEC,id:'bundle-seed-missing',seeds:[101],run:({seed})=>{const bundle=validBundle(seed);delete bundle.seed;return bundle}},{profile:'release'}),/invalid deterministic seed undefined/,'unseeded bundle inherited a requested seed');
  await rejects(()=>runBenchmark({...SPEC,id:'bundle-seed-mismatch',seeds:[101],run:({seed})=>({...validBundle(seed),seed:seed+1})},{profile:'release'}),/seed 102 does not match requested seed 101/,'bundled runner could relabel its requested seed');
  check(new Set(deterministicSeedPanel({benchmarkId:'large-unique-panel',profile:'release',baseSeed:'unique',count:1000})).size===1000,'generated panel contained duplicate canonical seeds');
  console.log('  duplicate, reordered, and relabeled seed panels rejected');

  console.log('1c) frame budgets and event positions are positive integral observations');
  const zeroFrames=validRuns();zeroFrames[0].live.frames=0;
  await rejects(()=>benchmark(SPEC,zeroFrames),/live observation frames must be a positive integer/,'zero-frame pre-collected observation was accepted');
  await rejects(()=>runBenchmark({...SPEC,id:'invalid-request-budget',seeds:[101],run:({seed})=>validBundle(seed)},{profile:'release',frames:1.5}),/frame budget must be a positive integer/,'fractional requested frame budget was accepted');
  const fractionalEvent=validRuns();fractionalEvent[0].live.events[0].frame=90.5;
  await rejects(()=>benchmark(SPEC,fractionalEvent),/event frame must be an integer/,'fractional pre-collected event frame was accepted');
  await rejects(()=>runBenchmark({...SPEC,id:'bundle-event-range',seeds:[101],run:({seed})=>{const bundle=validBundle(seed);bundle.live.events[0].frame=bundle.live.frames;return bundle}},{profile:'release'}),/event frame must be an integer from 0 to 1199/,'bundled runner event escaped its observation frame budget');
  console.log('  invalid requested/observed budgets and fractional/out-of-range events rejected');

  console.log('1d) requested replay verification requires every pre-collected and bundled replay');
  const partialReplay=validRuns();partialReplay[0].replay=live(partialReplay[0].seed);
  const partialReplayResult=await runBenchmark({...SPEC,id:'partial-precollected-replay'},{profile:'release',runs:partialReplay,verifyReplay:true});
  check(has(partialReplayResult,FAILURE_CODES.NONDETERMINISTIC_REPLAY)&&partialReplayResult.diagnosis.diagnoses.some(d=>d.code===FAILURE_CODES.NONDETERMINISTIC_REPLAY&&d.details&&d.details.seed===202&&d.details.reason==='missing'),'missing replay in a pre-collected seed panel did not fail closed');
  const missingBundleReplay=await runBenchmark({...SPEC,id:'missing-bundle-replay',seeds:[101],run:({seed})=>validBundle(seed)},{profile:'release',verifyReplay:true});
  check(has(missingBundleReplay,FAILURE_CODES.NONDETERMINISTIC_REPLAY),'bundled runner omitted a requested replay without failing');
  console.log('  partial pre-collected and absent bundled replays rejected');

  console.log('1e) benchmark observations consume the shared AEP ledger validator');
  const ledger={protocol:evidence.PROTOCOL,version:1,sources:[
    {id:'setup-source',kind:'setup'},{id:'threat-source',kind:'threat'},
    {id:'response-source',kind:'response',stableActor:true},{id:'commit-source',kind:'commit',stableActor:true},
    {id:'payoff-source',kind:'payoff'}
  ],events:[
    {serial:1,frame:10,source:'setup-source',kind:'setup'},
    {serial:2,frame:310,source:'threat-source',kind:'threat'},
    {serial:3,frame:320,source:'response-source',kind:'response',causeSerial:2,actorId:'hero'},
    {serial:4,frame:620,source:'commit-source',kind:'commit',actorId:'hero'},
    {serial:5,frame:920,source:'payoff-source',kind:'payoff',setupSerial:1,commitSerial:4}
  ]};
  const ledgerLive={frames:1000,progress:4,decisionSignature:'live',simSignature:'same-sim',rngState:'same-rng',evidence:ledger};
  const ledgerRun={seed:303,live:ledgerLive,baseline:{frames:1000,progress:2,decisionSignature:'base',simSignature:'base-sim',rngState:'same-rng'},evidenceOff:{...ledgerLive,evidence:undefined}};
  const ledgerResult=await runBenchmark({id:'shared-ledger-fixture',seeds:[303],requiredNaturalCategories:['setup','threat']},{profile:'release',runs:[ledgerRun]});
  check(ledgerResult.ok,'shared valid ledger was rejected: '+ledgerResult.diagnosis.failureCodes.join(', '));
  check(ledgerResult.events.events.filter(event=>event.variant==='live').length===5,'benchmark did not import shared ledger events');
  const aliasLedger=JSON.parse(JSON.stringify(ledger));aliasLedger.sources[0].signal='one-counter';aliasLedger.sources[1].signal='one-counter';
  const invalidResult=await runBenchmark({id:'invalid-ledger-fixture',seeds:[303],requiredNaturalCategories:['setup','threat']},{profile:'release',runs:[{...ledgerRun,live:{...ledgerLive,evidence:aliasLedger}}]});
  check(has(invalidResult,FAILURE_CODES.INVALID_EVIDENCE)&&has(invalidResult,evidence.REASONS.ALIASED_SOURCE),'shared ledger reason codes were not preserved in diagnosis');
  const stillLedger=JSON.parse(JSON.stringify(ledger));stillLedger.samples=Array.from({length:8},(_,index)=>({frame:index*5,actors:[{id:'hero',role:'hero',x:10,y:10,emote:false}]}));
  const relaxedResult=await runBenchmark({id:'game-relaxed-evidence-fixture',seeds:[303],requiredNaturalCategories:['setup','threat']},{profile:'release',runs:[{...ledgerRun,live:{...ledgerLive,evidence:stillLedger,evidenceOptions:{maxStillFrames:1000}}}]});
  check(has(relaxedResult,FAILURE_CODES.INVALID_EVIDENCE)&&has(relaxedResult,evidence.REASONS.ACTOR_STILLNESS),'game-supplied evidence options weakened the framework stillness gate');
  const sampledA=JSON.parse(JSON.stringify(ledger));sampledA.samples=Array.from({length:8},(_,index)=>({frame:index*5,actors:[{id:'hero',role:'hero',x:index*3,y:10,emote:false}]}));
  const sampledB=JSON.parse(JSON.stringify(sampledA));sampledB.samples[3].actors[0].x+=0.5;
  const sampledSpec={id:'sample-digest-fixture',seeds:[303],requiredNaturalCategories:['setup','threat']};
  const sampleResultA=await runBenchmark(sampledSpec,{profile:'release',runs:[{...ledgerRun,live:{...ledgerLive,evidence:sampledA}}]}),
    sampleResultB=await runBenchmark(sampledSpec,{profile:'release',runs:[{...ledgerRun,live:{...ledgerLive,evidence:sampledB}}]});
  check(sampleResultA.ok&&sampleResultB.ok&&!sampleResultA.files['events.json'].equals(sampleResultB.files['events.json']),'benchmark artifacts ignored valid actor sample changes');
  check(sampleResultA.events.evidenceDigests.length===1,'benchmark events artifact omitted the canonical live evidence digest');
  const sampleReplay=await runBenchmark({...sampledSpec,id:'sample-replay-fixture'},{profile:'release',verifyReplay:true,runs:[{...ledgerRun,live:{...ledgerLive,evidence:sampledA},replay:{...ledgerLive,evidence:sampledB}}]});
  check(has(sampleReplay,FAILURE_CODES.NONDETERMINISTIC_REPLAY),'replay actor sample drift was ignored');
  console.log('  validator thresholds are framework-owned; actor samples are artifact- and replay-bound');

  console.log('2) motion-only evidence receives no entertainment credit');
  const motion=validRuns();for(const run of motion)run.live.events=run.live.events.map((event,index)=>({...event,category:index%2?'turn':'movement',source:index%2?'turns':'positions'}));
  const motionResult=await benchmark(SPEC,motion);
  check(has(motionResult,FAILURE_CODES.MOTION_ONLY),'motion-only fixture escaped the hard gate');
  console.log('  ordinary movement/turn telemetry rejected with '+FAILURE_CODES.MOTION_ONLY);

  console.log('2b) meaningful beat minima apply independently to every seed');
  const unevenBeats=validRuns();unevenBeats[0].live.events=unevenBeats[0].live.events.slice(0,2);
  const unevenResult=await benchmark(SPEC,unevenBeats);
  check(has(unevenResult,FAILURE_CODES.MOTION_ONLY)&&unevenResult.diagnosis.diagnoses.some(d=>d.code===FAILURE_CODES.MOTION_ONLY&&d.details&&d.details.seed===101&&d.details.minimum===3),'aggregate beat volume hid an underfilled seed');
  console.log('  2+4 aggregate beats could not hide the seed below its 3-beat floor');

  console.log('3) temporally clumped beats fail the dead-air/spread gate');
  const clumped=validRuns();for(const run of clumped)run.live.events=run.live.events.map((event,index)=>({...event,frame:100+index}));
  const clumpedResult=await benchmark(SPEC,clumped);
  check(has(clumpedResult,FAILURE_CODES.CLUMPED_BEATS),'clumped beat fixture passed');
  console.log('  dense burst plus long dead air rejected with '+FAILURE_CODES.CLUMPED_BEATS);

  console.log('4) categories require independent declared telemetry sources');
  const aliased=validRuns();for(const run of aliased)run.live.events=run.live.events.map(event=>({...event,source:'oneCounter'}));
  const aliasResult=await benchmark(SPEC,aliased);
  check(has(aliasResult,FAILURE_CODES.ALIASED_SOURCES),'aliased evidence sources passed');
  console.log('  one counter could not impersonate puzzle, threat, response, and payoff');

  console.log('5) same-seed ablations must keep a capable, unhandicapped baseline');
  const handicapped=validRuns();for(const run of handicapped){run.baseline.progress=0;run.baseline.capable=false;run.baseline.handicap=true;run.baseline.unrelatedChanges=['physics-speed']}
  const handicapResult=await benchmark(SPEC,handicapped);
  check(has(handicapResult,FAILURE_CODES.BASELINE_HANDICAP),'baseline-only handicap was accepted');
  console.log('  stalled baseline and unrelated physics change rejected');

  console.log('6) evidence collection may not consume RNG or change simulation');
  const leaking=validRuns();for(const run of leaking){run.evidenceOff.simSignature={changed:true};run.evidenceOff.rngState={state:-1}}
  const leakResult=await benchmark(SPEC,leaking);
  check(has(leakResult,FAILURE_CODES.EVIDENCE_LEAKAGE),'simulation evidence leakage was missed');
  check(has(leakResult,FAILURE_CODES.RNG_LEAKAGE),'RNG evidence leakage was missed');
  console.log('  simulation and RNG twins both fail closed');

  console.log('6b) absent signatures cannot earn evidence integrity credit');
  const unsigned=validRuns();for(const run of unsigned){run.live.simSignature=null;run.evidenceOff.simSignature=null;run.live.rngState=null;run.evidenceOff.rngState=null}
  const unsignedResult=await benchmark(SPEC,unsigned);
  check(has(unsignedResult,FAILURE_CODES.EVIDENCE_LEAKAGE)&&has(unsignedResult,FAILURE_CODES.RNG_LEAKAGE),'null pre-collected signatures passed canonical equality');
  check(unsignedResult.scorecard.dimensions.find(d=>d.id==='evidenceIntegrity').value===0,'null signatures received integrity credit');
  const unsignedBundle=await runBenchmark({...SPEC,id:'unsigned-bundle',seeds:[101],run:({seed})=>{const bundle=validBundle(seed);delete bundle.live.simSignature;delete bundle.evidenceOff.simSignature;delete bundle.live.rngState;delete bundle.evidenceOff.rngState;return bundle}},{profile:'release'});
  check(has(unsignedBundle,FAILURE_CODES.EVIDENCE_LEAKAGE)&&has(unsignedBundle,FAILURE_CODES.RNG_LEAKAGE),'unsigned bundled twin passed integrity');
  console.log('  null or omitted simulation/RNG twins receive zero integrity');

  console.log('7) frozen fixtures cannot substitute for natural-run reachability');
  const fixtureSpec={...SPEC,id:'ambient-evidence-fixture-reachability',requiredNaturalCategories:['puzzle','threat','solve']};
  const fixtureOnly=validRuns();for(const run of fixtureOnly)run.fixture={frames:1200,events:[{frame:600,category:'solve',source:'fixtureSolve',fixture:true}]};
  const fixtureResult=await benchmark(fixtureSpec,fixtureOnly);
  check(has(fixtureResult,FAILURE_CODES.FIXTURE_ONLY_REACHABILITY),'fixture-only category satisfied natural reachability');
  console.log('  synthetic solve remained useful evidence but did not count as naturally reached');

  console.log('8) profile bands preserve raw values and hard-gate independently of score');
  const card=buildScorecard({profile:'strict',profileDefinition:{dimensions:{beats:{min:10,hard:true},latency:{max:4,hard:false}}},
    dimensions:{beats:{value:9,unit:'beats',source:'ledger'},latency:{value:2,unit:'frames',source:'clock'}}});
  check(card.dimensions.find(d=>d.id==='beats').value===9,'scorecard discarded the raw beat count');
  check(!card.hardPass&&card.verdict==='fail','hard profile dimension did not control the verdict');
  check(card.dimensions.find(d=>d.id==='latency').pass,'independent max-direction dimension was scored incorrectly');
  console.log('  raw measurements retained; hard and advisory bands remain distinct');

  console.log('9) identical runs produce byte-identical receipt.json and artifact indexes');
  const outA=temp('ambient-evidence-a-'),outB=temp('ambient-evidence-b-');
  const first=await benchmark(SPEC,validRuns(),{outDir:outA}),second=await benchmark(SPEC,validRuns(),{outDir:outB});
  const receiptA=fs.readFileSync(path.join(outA,'receipt.json')),receiptB=fs.readFileSync(path.join(outB,'receipt.json')),
    indexA=fs.readFileSync(path.join(outA,'artifact-index.json')),indexB=fs.readFileSync(path.join(outB,'artifact-index.json'));
  check(receiptA.equals(receiptB),'receipt.json bytes changed across identical runs');
  check(indexA.equals(indexB),'artifact-index.json bytes changed across identical runs');
  check(first.receipt.artifacts['events.json'].sha256===second.receipt.artifacts['events.json'].sha256,'receipt content hashes diverged');
  for(const name of['receipt.json','scorecard.json','events.json','provenance.json','diagnosis.json','artifact-index.json'])check(fs.existsSync(path.join(outA,name)),`missing canonical artifact ${name}`);
  console.log(`  ${receiptA.length} receipt bytes replayed exactly with six canonical artifacts`);

  console.log('10) run-all exposes stable IDs, filters, bounded pools, and distinct process outcomes');
  const parsed=runAll.parseArgs(['--jobs','2','--game','rocket,blockmine','--profile=behavior','--tag','game','--timeout-ms','50','--json']);
  check(parsed.jobs===2&&parsed.games.join(',')==='blockmine,rocket'&&parsed.profiles[0]==='behavior'&&parsed.tags[0]==='game','run-all filters parsed incorrectly');
  const selected=runAll.filterSuites([
    {id:'rocket',game:'rocket',profile:'behavior',tags:['behavior','game']},
    {id:'rocket-visual',game:'rocket',profile:'visual',tags:['game','visual']},
    {id:'global',game:null,profile:'behavior',tags:['behavior','global']}
  ],parsed);
  check(selected.length===1&&selected[0].id==='rocket','run-all filtering did not preserve the stable suite ID');
  let active=0,peak=0;await runAll.runPool([0,1,2,3,4].map(id=>({id})),2,async suite=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,10));active--;return suite.id});
  check(peak===2,'bounded runner exceeded or failed to use the requested concurrency');
  const timeout=await runAll.runSuite({id:'timeout',command:process.execPath,args:['-e','setInterval(()=>{},1000)'],tags:[]},{timeoutMs:30,cwd:process.cwd()}),
    crash=await runAll.runSuite({id:'crash',command:process.execPath,args:['-e',"process.kill(process.pid,'SIGTERM')"],tags:[]},{timeoutMs:1000,cwd:process.cwd()}),
    assertion=await runAll.runSuite({id:'failure',command:process.execPath,args:['-e','process.exit(3)'],tags:[]},{timeoutMs:1000,cwd:process.cwd()});
  check(timeout.status==='timeout','timed-out suite was not classified as timeout');
  check(crash.status==='crash','signaled suite was not classified as crash');
  check(assertion.status==='fail'&&assertion.code===3,'ordinary assertion failure was not kept distinct');
  console.log('  pool capped at 2; timeout, crash, and nonzero failure classified separately');

  console.log('10b) explicit benchmark modules cannot escape source provenance');
  const outside=temp('ambient-external-benchmark-'),sideEffect=path.join(outside,'executed.txt'),outsideModule=path.join(outside,'benchmark.js');
  fs.writeFileSync(outsideModule,`require('fs').writeFileSync(${JSON.stringify(sideEffect)},'executed');module.exports={id:'external-fixture'};\n`);
  await rejects(()=>benchmarkCli.main([outsideModule,'--no-write']),/must be inside repository root/,'external benchmark module was loaded before its provenance boundary');
  check(!fs.existsSync(sideEffect),'rejected external benchmark module executed a side effect');
  const linkParent=path.join(__dirname,'..','.artifacts');fs.mkdirSync(linkParent,{recursive:true});
  const linkDir=fs.mkdtempSync(path.join(linkParent,'benchmark-module-'));tempRoots.push(linkDir);
  const linkedModule=path.join(linkDir,'linked.js');fs.symlinkSync(outsideModule,linkedModule);
  await rejects(()=>benchmarkCli.main([linkedModule,'--no-write']),/resolves outside repository root/,'inside-root symlink loaded an outside benchmark module');
  check(!fs.existsSync(sideEffect),'rejected symlinked benchmark module executed a side effect');
  console.log('  direct and symlink realpath escapes rejected before require()');

  console.log('10c) suite timeouts terminate process groups and bound escaped pipe holders');
  if(process.platform!=='win32'){
    const descendantCode=`const{spawn}=require('child_process');spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});setInterval(()=>{},1000);`;
    const descendant=await runAll.runSuite({id:'descendant-timeout',command:process.execPath,args:['-e',descendantCode],tags:[]},{timeoutMs:30,cwd:process.cwd()});
    check(descendant.status==='timeout'&&descendant.ms<2500,'descendant process group held the suite open after timeout escalation');
    const escapedCode=`const{spawn}=require('child_process');const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),5000)"],{stdio:'inherit',detached:true});console.log('ESCAPED:'+child.pid);child.unref();setInterval(()=>{},1000);`;
    const escaped=await runAll.runSuite({id:'escaped-pipe-timeout',command:process.execPath,args:['-e',escapedCode],tags:[]},{timeoutMs:30,cwd:process.cwd()});
    const escapedPid=Number((escaped.output.match(/ESCAPED:(\d+)/)||[])[1]);
    if(Number.isInteger(escapedPid)){try{process.kill(escapedPid,'SIGKILL')}catch{}}
    check(escaped.status==='timeout'&&escaped.ms<2500,'escaped session pipe holder prevented bounded timeout resolution');
    console.log('  descendants receive group escalation; escaped inherited pipes are forcibly closed');
  }else console.log('  skipped POSIX process-group assertions on Windows');

  console.log(failed?`\nAMBIENT EVIDENCE BENCHMARK EVAL FAILED (${checks} checks)`:`\nAMBIENT EVIDENCE BENCHMARK EVAL PASSED (${checks} checks)`);
  process.exitCode=failed?1:0;
})().catch(error=>{console.error(error.stack||error);process.exitCode=1});
