'use strict';

/* Generic same-seed causal ablation assertions.
 *
 * A fair ablation pair starts byte-identical, first diverges inside the named
 * mechanic's setup/telegraph window, leaves the simpler baseline active and
 * progressing, removes only named evidence sources, preserves the rest, changes
 * a relevant outcome, and keeps unrelated invariant digests identical.
 */
const{canonicalHash}=require('./evidence');

const REASONS=Object.freeze({
  INVALID_PAIR:'INVALID_PAIR',
  INVALID_TIMELINE_SCHEDULE:'INVALID_TIMELINE_SCHEDULE',
  TIMELINE_SCHEDULE_MISMATCH:'TIMELINE_SCHEDULE_MISMATCH',
  INITIAL_IDENTITY_MISMATCH:'INITIAL_IDENTITY_MISMATCH',
  NO_DIVERGENCE:'NO_DIVERGENCE',
  DIVERGENCE_BEFORE_WINDOW:'DIVERGENCE_BEFORE_WINDOW',
  DIVERGENCE_AFTER_WINDOW:'DIVERGENCE_AFTER_WINDOW',
  BASELINE_INACTIVE:'BASELINE_INACTIVE',
  BASELINE_NO_PROGRESS:'BASELINE_NO_PROGRESS',
  REMOVED_SOURCE_MISSING_LIVE:'REMOVED_SOURCE_MISSING_LIVE',
  REMOVED_SOURCE_PRESENT_BASELINE:'REMOVED_SOURCE_PRESENT_BASELINE',
  PRESERVED_SOURCE_MISSING_LIVE:'PRESERVED_SOURCE_MISSING_LIVE',
  PRESERVED_SOURCE_MISSING_BASELINE:'PRESERVED_SOURCE_MISSING_BASELINE',
  IRRELEVANT_EFFECT:'IRRELEVANT_EFFECT',
  INVARIANT_DIGEST_MISMATCH:'INVARIANT_DIGEST_MISMATCH'
});

const violation=(code,message,details)=>details===undefined?{code,message}:{code,message,details};
const valueAt=(object,path)=>{
  if(typeof path==='function')return path(object);
  if(path===undefined||path===null||path==='')return object;
  return String(path).split('.').reduce((value,key)=>value==null?undefined:value[key],object);
};
function digest(value){
  if(typeof value==='string')return value;
  if(value===undefined)return undefined;
  return canonicalHash(value);
}
function runsOf(pair){
  if(!pair||typeof pair!=='object')return{};
  return{
    live:pair.live||pair.enabled||pair.candidate||pair.control,
    baseline:pair.baseline||pair.ablated||pair.disabled||pair.off
  };
}
function timelineOf(run){
  if(!run)return[];
  const raw=run.timeline||run.frames||run.digests||[];
  if(!Array.isArray(raw))return[];
  return raw.map((entry,index)=>{
    if(entry&&typeof entry==='object'&&!Array.isArray(entry))return{
      frame:entry.frame===undefined?(entry.at===undefined?index:entry.at):entry.frame,
      digest:digest(entry.digest===undefined?(entry.stateDigest===undefined?(entry.signature===undefined?entry.state:entry.signature):entry.stateDigest):entry.digest)
    };
    return{frame:index,digest:digest(entry)};
  });
}
function initialDigest(run,timeline){
  if(!run)return undefined;
  const value=run.initialDigest===undefined?(run.initial===undefined?(timeline[0]&&timeline[0].digest):run.initial):run.initialDigest;
  return digest(value);
}
function invalidSchedule(timeline){
  if(timeline.length===0)return{issue:'missing'};
  for(let index=0;index<timeline.length;index++){
    const frame=timeline[index].frame;
    if(!Number.isFinite(frame)||!Number.isInteger(frame)||frame<0)return{issue:'invalid_frame',index,frame};
    if(index>0&&frame<=timeline[index-1].frame)return{issue:'not_strictly_increasing',index,frame,previous:timeline[index-1].frame};
  }
  return null;
}
function schedulesMatch(live,baseline){
  return live.length===baseline.length&&live.every((point,index)=>point.frame===baseline[index].frame);
}
function firstDivergence(live,baseline){
  const right=new Map(baseline.map(point=>[point.frame,point.digest]));
  for(const point of live)if(right.has(point.frame)&&right.get(point.frame)!==point.digest)return point.frame;
  return null;
}
function sourceCounts(run){
  if(!run)return{};
  if(run.sourceCounts&&typeof run.sourceCounts==='object')return run.sourceCounts;
  const evidence=run.evidence||run.ledger||run.probe;
  if(evidence&&Array.isArray(evidence.events)){
    const counts={};
    for(const event of evidence.events){const source=event&&((event.source===undefined)?event.sourceId:event.source);if(typeof source==='string')counts[source]=(counts[source]||0)+1}
    return counts;
  }
  if(run.sources&&typeof run.sources==='object'&&!Array.isArray(run.sources))return run.sources;
  return{};
}
function windowOf(contract){
  const raw=contract.firstDivergenceWindow||contract.divergenceWindow||contract.window||contract.firstDivergence;
  if(Array.isArray(raw))return{start:raw[0],end:raw[1]};
  if(raw&&typeof raw==='object')return{start:raw.start===undefined?raw.min:raw.start,end:raw.end===undefined?raw.max:raw.end};
  return{start:-Infinity,end:Infinity};
}
function invariantMaps(run){
  if(!run)return{};
  if(run.invariantDigests&&typeof run.invariantDigests==='object')return run.invariantDigests;
  if(run.invariants&&typeof run.invariants==='object')return run.invariants;
  if(run.invariantDigest!==undefined)return{default:run.invariantDigest};
  return{};
}
function effectPass(live,baseline,contract){
  const spec=contract.relevantEffect===undefined?contract.effect:contract.relevantEffect;
  if(typeof spec==='function')return!!spec(live,baseline);
  if(spec&&typeof spec==='object'){
    const left=valueAt(live,spec.metric===undefined?spec.path:spec.metric),right=valueAt(baseline,spec.metric===undefined?spec.path:spec.metric);
    if(!Number.isFinite(left)||!Number.isFinite(right))return false;
    const delta=left-right,minDelta=spec.minDelta===undefined?Number.EPSILON:spec.minDelta;
    if(spec.minRatio!==undefined&&right!==0&&left/right<spec.minRatio)return false;
    if(spec.direction==='less')return delta<=-minDelta;
    if(spec.direction==='different')return Math.abs(delta)>=minDelta;
    return delta>=minDelta;
  }
  const left=live&&live.effect,right=baseline&&baseline.effect;
  if(left===undefined||right===undefined)return false;
  try{return canonicalHash(left)!==canonicalHash(right)}catch(error){return left!==right}
}

function analyzeAblationPair(pair,contract){
  contract=contract||{};
  const{live,baseline}=runsOf(pair),violations=[];
  if(!live||!baseline){
    violations.push(violation(REASONS.INVALID_PAIR,'ablation pair needs live and baseline runs'));
    return{ok:false,reasons:[REASONS.INVALID_PAIR],violations,firstDivergence:null};
  }
  const liveTimeline=timelineOf(live),baselineTimeline=timelineOf(baseline);
  const liveScheduleError=invalidSchedule(liveTimeline),baselineScheduleError=invalidSchedule(baselineTimeline);
  if(liveScheduleError)violations.push(violation(REASONS.INVALID_TIMELINE_SCHEDULE,'live timeline needs a non-empty, strictly increasing schedule of finite nonnegative integer frames',{run:'live',...liveScheduleError}));
  if(baselineScheduleError)violations.push(violation(REASONS.INVALID_TIMELINE_SCHEDULE,'baseline timeline needs a non-empty, strictly increasing schedule of finite nonnegative integer frames',{run:'baseline',...baselineScheduleError}));
  const scheduleValid=!liveScheduleError&&!baselineScheduleError;
  const scheduleMatches=scheduleValid&&schedulesMatch(liveTimeline,baselineTimeline);
  if(scheduleValid&&!scheduleMatches)violations.push(violation(REASONS.TIMELINE_SCHEDULE_MISMATCH,'live and baseline timelines need identical frame schedules',{live:liveTimeline.map(point=>point.frame),baseline:baselineTimeline.map(point=>point.frame)}));
  const leftInitial=initialDigest(live,liveTimeline),rightInitial=initialDigest(baseline,baselineTimeline);
  const liveTimelineInitial=liveTimeline[0]&&liveTimeline[0].digest,baselineTimelineInitial=baselineTimeline[0]&&baselineTimeline[0].digest;
  if(leftInitial===undefined||rightInitial===undefined||leftInitial!==rightInitial||liveTimelineInitial===undefined||baselineTimelineInitial===undefined||liveTimelineInitial!==baselineTimelineInitial)
    violations.push(violation(REASONS.INITIAL_IDENTITY_MISMATCH,'live and baseline need a defined matching initial frame digest',{live:leftInitial,baseline:rightInitial,liveTimeline:liveTimelineInitial,baselineTimeline:baselineTimelineInitial}));
  const comparableSchedule=scheduleValid&&scheduleMatches;
  const divergence=comparableSchedule?firstDivergence(liveTimeline,baselineTimeline):null,window=windowOf(contract);
  if(comparableSchedule&&divergence===null)violations.push(violation(REASONS.NO_DIVERGENCE,'ablation pair never diverged'));
  else if(divergence!==null&&Number.isFinite(window.start)&&divergence<window.start)
    violations.push(violation(REASONS.DIVERGENCE_BEFORE_WINDOW,`first divergence ${divergence} precedes ${window.start}`,{frame:divergence,window}));
  else if(divergence!==null&&Number.isFinite(window.end)&&divergence>window.end)
    violations.push(violation(REASONS.DIVERGENCE_AFTER_WINDOW,`first divergence ${divergence} follows ${window.end}`,{frame:divergence,window}));
  const activity=valueAt(baseline,contract.baselineActivity===undefined?'activity':contract.baselineActivity);
  const progress=valueAt(baseline,contract.baselineProgress===undefined?'progress':contract.baselineProgress);
  const minActivity=contract.minBaselineActivity===undefined?1:contract.minBaselineActivity;
  const minProgress=contract.minBaselineProgress===undefined?1:contract.minBaselineProgress;
  if(!Number.isFinite(activity)||activity<minActivity)
    violations.push(violation(REASONS.BASELINE_INACTIVE,`baseline activity ${activity} is below ${minActivity}`,{activity,minActivity}));
  if(!Number.isFinite(progress)||progress<minProgress)
    violations.push(violation(REASONS.BASELINE_NO_PROGRESS,`baseline progress ${progress} is below ${minProgress}`,{progress,minProgress}));
  const liveSources=sourceCounts(live),baselineSources=sourceCounts(baseline);
  for(const source of contract.removedSources||[]){
    if(!(liveSources[source]>0))violations.push(violation(REASONS.REMOVED_SOURCE_MISSING_LIVE,`removed source ${source} was not active in live`,{source}));
    if(baselineSources[source]>0)violations.push(violation(REASONS.REMOVED_SOURCE_PRESENT_BASELINE,`removed source ${source} remained active in baseline`,{source,count:baselineSources[source]}));
  }
  for(const source of contract.preservedSources||[]){
    if(!(liveSources[source]>0))violations.push(violation(REASONS.PRESERVED_SOURCE_MISSING_LIVE,`preserved source ${source} was absent in live`,{source}));
    if(!(baselineSources[source]>0))violations.push(violation(REASONS.PRESERVED_SOURCE_MISSING_BASELINE,`preserved source ${source} was absent in baseline`,{source}));
  }
  if(!effectPass(live,baseline,contract))violations.push(violation(REASONS.IRRELEVANT_EFFECT,'ablation did not change the declared relevant effect'));
  const liveInvariants=invariantMaps(live),baselineInvariants=invariantMaps(baseline);
  const requested=contract.invariantDigests||(Array.isArray(contract.invariants)?contract.invariants:null);
  const keys=requested||[...new Set([...Object.keys(liveInvariants),...Object.keys(baselineInvariants)])];
  for(const key of keys){
    const left=digest(liveInvariants[key]),right=digest(baselineInvariants[key]);
    if(left===undefined||right===undefined||left!==right)
      violations.push(violation(REASONS.INVARIANT_DIGEST_MISMATCH,`invariant digest ${key} changed`,{key,live:left,baseline:right}));
  }
  return{ok:violations.length===0,reasons:[...new Set(violations.map(item=>item.code))],violations,firstDivergence:divergence,window};
}
function assertAblationPair(label,pair,contract,fail){
  if(typeof contract==='function'){fail=contract;contract={}}
  const report=analyzeAblationPair(pair,contract);
  for(const item of report.violations)fail(`${label}: [${item.code}] ${item.message}`);
  return report;
}

module.exports={REASONS,analyzeAblationPair,validateAblationPair:analyzeAblationPair,
  analyzeCausalAblation:analyzeAblationPair,assertAblationPair,
  assertCausalAblation:assertAblationPair,firstDivergence};
