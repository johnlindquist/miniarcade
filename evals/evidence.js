'use strict';

/* Ambient Evidence Protocol v1.
 *
 * Games may report observations, never conclusions. A ledger names each source
 * and appends frame-stamped facts; this module independently validates causal
 * structure and derives the useful totals. In particular, games cannot award
 * themselves points, count walking/replanning as a beat, rotate actor IDs, or
 * erase a stationary streak by briefly omitting the actor.
 */
const crypto=require('crypto');

const PROTOCOL='ambient-evidence/v1';
const VERSION=1;
const HALF_SECOND=30;
const MAX_SAMPLE_STEP=5;

const REASONS=Object.freeze({
  INVALID_LEDGER:'INVALID_LEDGER',
  INVALID_PROTOCOL:'INVALID_PROTOCOL',
  UNSUPPORTED_VERSION:'UNSUPPORTED_VERSION',
  DISABLED_LEDGER:'DISABLED_LEDGER',
  INVALID_SOURCE:'INVALID_SOURCE',
  DUPLICATE_SOURCE:'DUPLICATE_SOURCE',
  ALIASED_SOURCE:'ALIASED_SOURCE',
  INVALID_EVENT:'INVALID_EVENT',
  INVALID_SAMPLE_FRAME:'INVALID_SAMPLE_FRAME',
  DUPLICATE_SERIAL:'DUPLICATE_SERIAL',
  DECREASING_SERIAL:'DECREASING_SERIAL',
  DUPLICATE_FRAME:'DUPLICATE_FRAME',
  DECREASING_FRAME:'DECREASING_FRAME',
  UNKNOWN_SOURCE:'UNKNOWN_SOURCE',
  SOURCE_KIND_MISMATCH:'SOURCE_KIND_MISMATCH',
  RESPONSE_WITHOUT_THREAT:'RESPONSE_WITHOUT_THREAT',
  PAYOFF_WITHOUT_SETUP:'PAYOFF_WITHOUT_SETUP',
  PAYOFF_WITHOUT_COMMIT:'PAYOFF_WITHOUT_COMMIT',
  SCORED_LOCOMOTION:'SCORED_LOCOMOTION',
  SCORED_REPLAN:'SCORED_REPLAN',
  NONFINITE_COORDINATE:'NONFINITE_COORDINATE',
  ACTOR_IDENTITY_LAUNDERING:'ACTOR_IDENTITY_LAUNDERING',
  ACTOR_OMISSION:'ACTOR_OMISSION',
  ACTOR_STILLNESS:'ACTOR_STILLNESS',
  ACTOR_EMOTE_DURATION:'ACTOR_EMOTE_DURATION',
  ACTOR_EMOTE_SHARE:'ACTOR_EMOTE_SHARE',
  GAME_SCORE_FIELD:'GAME_SCORE_FIELD'
});

const MOTION_KINDS=new Set(['motion','actor','observation','locomotion','movement']);
const LOCOMOTION_KINDS=new Set(['locomotion','movement','walk','turn']);
const REPLAN_KINDS=new Set(['replan','replanning','navigation','path']);
const CREDIT_KINDS=new Set(['setup','threat','response','commit','payoff','progress','environment']);

function clone(value,seen){
  if(value===null||typeof value!=='object')return value;
  seen=seen||new Map();
  if(seen.has(value))throw new TypeError('canonical values must not be cyclic');
  const out=Array.isArray(value)?[]:{};seen.set(value,out);
  if(Array.isArray(value))for(const item of value)out.push(clone(item,seen));
  else for(const key of Object.keys(value))out[key]=clone(value[key],seen);
  seen.delete(value);return out;
}

function canonicalize(value,seen){
  if(value===null||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number'){
    if(!Number.isFinite(value))throw new TypeError('canonical numbers must be finite');
    return Object.is(value,-0)?0:value;
  }
  if(typeof value!=='object')throw new TypeError('canonical values must be JSON data');
  seen=seen||new Set();if(seen.has(value))throw new TypeError('canonical values must not be cyclic');seen.add(value);
  let out;
  if(Array.isArray(value))out=value.map(item=>canonicalize(item,seen));
  else{
    out={};
    for(const key of Object.keys(value).sort()){
      if(value[key]===undefined)throw new TypeError('canonical values must not contain undefined');
      out[key]=canonicalize(value[key],seen);
    }
  }
  seen.delete(value);return out;
}
function canonicalStringify(value){return JSON.stringify(canonicalize(value))}
function sha256(value){return crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:Buffer.from(String(value))).digest('hex')}
function canonicalHash(value){return sha256(canonicalStringify(value))}

function normalizeSources(raw){
  if(Array.isArray(raw))return raw.map(source=>typeof source==='string'?{id:source,kind:source}:clone(source));
  if(raw&&typeof raw==='object')return Object.keys(raw).map(id=>{
    const source=raw[id];return typeof source==='string'?{id,kind:source}:Object.assign({id},clone(source||{}));
  });
  return null;
}
function normalizeLedger(input){
  const value=input&&input.evidence?input.evidence:input;
  if(!value||typeof value!=='object')return null;
  return{
    protocol:value.protocol,version:value.version,
    enabled:value.enabled===undefined?true:value.enabled,sources:normalizeSources(value.sources),
    events:Array.isArray(value.events)?value.events.map(item=>clone(item)):null,
    samples:Array.isArray(value.samples)?value.samples.map(item=>clone(item)):[],
    serial:value.serial,epoch:value.epoch,limit:value.limit,dropped:value.dropped,lastFrame:value.lastFrame
  };
}
function reason(code,message,details){return details===undefined?{code,message}:{code,message,details}}
function findScoreField(value,path,found,seen){
  if(!value||typeof value!=='object')return;
  seen=seen||new Set();if(seen.has(value))return;seen.add(value);
  for(const key of Object.keys(value)){
    const next=path?path+'.'+key:key,low=key.toLowerCase();
    if(low!=='scored'&&(low.includes('score')||/^(points?|weight|rating|rank|credits?)$/.test(low)))found.push(next);
    findScoreField(value[key],next,found,seen);
  }
}
function coordinateViolations(value,path,out,seen){
  if(!value||typeof value!=='object')return;
  seen=seen||new Set();if(seen.has(value))return;seen.add(value);
  for(const key of Object.keys(value)){
    const next=path?path+'.'+key:path||key;
    if(/^(x|y|sx|sy)$/.test(key)&&!Number.isFinite(value[key]))out.push(next);
    else coordinateViolations(value[key],next,out,seen);
  }
}
function sourceAlias(source){
  if(source.aliasOf!==undefined||source.alias!==undefined)return'alias:'+(source.aliasOf||source.alias);
  for(const key of['signal','path','counter','probe','channel','telemetry'])
    if(typeof source[key]==='string'&&source[key].trim())return key+':'+source[key].trim();
  return null;
}
function eventSource(event){return event.source===undefined?event.sourceId:event.source}
function reference(event,name){
  if(event[name+'Serial']!==undefined)return event[name+'Serial'];
  if(event[name]!==undefined)return event[name];
  if(event.causes&&event.causes[name]!==undefined)return event.causes[name];
  return undefined;
}
function actorsIn(sample){
  if(Array.isArray(sample.actors))return sample.actors;
  if(sample.actor&&typeof sample.actor==='object')return[sample.actor];
  if(sample.actorId!==undefined)return[{id:sample.actorId,role:sample.role,x:sample.x,y:sample.y,emote:sample.emote}];
  return[];
}
function sampleFrame(sample){return sample&&(sample.frame===undefined?sample.at:sample.frame)}

function validateActors(samples,options,violations){
  const stepLimit=options.maxSampleStep===undefined?MAX_SAMPLE_STEP:options.maxSampleStep;
  const stillFrames=options.maxStillFrames===undefined?HALF_SECOND:options.maxStillFrames;
  const radius=options.stillRadius===undefined?2:options.stillRadius;
  const emoteFrames=options.emoteFrames===undefined?120:options.emoteFrames;
  const emoteShare=options.emoteShare===undefined?0.15:options.emoteShare;
  const minPresenceShare=options.minPresenceShare===undefined?0.95:options.minPresenceShare;
  const requested=[
    ...(Array.isArray(options.requiredActorIds)?options.requiredActorIds:[]),
    ...(Array.isArray(options.requiredIds)?options.requiredIds:[])
  ];
  const required=new Set(requested);
  if(typeof options.protagonistId==='string'&&options.protagonistId)required.add(options.protagonistId);
  if(typeof options.requiredProtagonistId==='string'&&options.requiredProtagonistId)required.add(options.requiredProtagonistId);
  if(!samples.length){
    for(const id of required)violations.push(reason(REASONS.ACTOR_OMISSION,`required actor ${id} has no samples`,{id}));
    return;
  }
  const roles=new Map(),tracks=new Map(),protagonists=new Set();
  const firstFrame=sampleFrame(samples[0]),secondFrame=sampleFrame(samples[1]);
  const firstElapsed=Number.isInteger(firstFrame)&&Number.isInteger(secondFrame)&&secondFrame>firstFrame&&secondFrame-firstFrame<=stepLimit?secondFrame-firstFrame:stepLimit;
  let previousFrame=null,totalFrames=0;
  for(let index=0;index<samples.length;index++){
    const sample=samples[index];
    if(!sample||typeof sample!=='object'){
      violations.push(reason(REASONS.INVALID_SAMPLE_FRAME,`actor sample ${index} is not an object`,{index}));continue;
    }
    const frame=sampleFrame(sample);
    const validFrame=Number.isInteger(frame)&&frame>=0&&(previousFrame===null||frame>previousFrame);
    if(!validFrame)violations.push(reason(REASONS.INVALID_SAMPLE_FRAME,`actor sample ${index} needs a strictly increasing nonnegative integer frame`,{index,frame,previousFrame}));
    const elapsed=validFrame?(previousFrame===null?firstElapsed:frame-previousFrame):0;
    if(validFrame&&previousFrame!==null&&elapsed>stepLimit)
      violations.push(reason(REASONS.ACTOR_OMISSION,`actor samples skipped ${elapsed} frames (maximum ${stepLimit})`,{frame,previousFrame}));
    if(validFrame){previousFrame=frame;totalFrames+=elapsed}
    const actors=actorsIn(sample),ids=new Set();
    if(!actors.length)violations.push(reason(REASONS.ACTOR_OMISSION,'actor sample omitted every watched actor',{frame,index}));
    for(const actor of actors){
      if(!actor||typeof actor.id!=='string'||!actor.id.trim()||ids.has(actor.id)){
        violations.push(reason(REASONS.ACTOR_OMISSION,'actor sample needs unique non-empty actor IDs',{frame,id:actor&&actor.id}));continue;
      }
      ids.add(actor.id);
      if(!Number.isFinite(actor.x)||!Number.isFinite(actor.y)){
        violations.push(reason(REASONS.NONFINITE_COORDINATE,`actor ${actor.id} sample coordinates must be finite`,{frame,id:actor.id,x:actor.x,y:actor.y}));continue;
      }
      const role=actor.role;
      if(typeof role==='string'&&role){
        const prior=roles.get(role);
        if(prior&&prior!==actor.id)violations.push(reason(REASONS.ACTOR_IDENTITY_LAUNDERING,`role ${role} changed actor ID from ${prior} to ${actor.id}`,{frame,role,prior,id:actor.id}));
        else roles.set(role,actor.id);
        if(/^(?:hero|player|protagonist)$/i.test(role))protagonists.add(actor.id);
      }
      let track=tracks.get(actor.id);
      if(!track){track={id:actor.id,x:actor.x,y:actor.y,bare:0,emote:0,emoteTotal:0,seenFrames:0,seenSamples:0,missing:false};tracks.set(actor.id,track)}
      if(track.missing)violations.push(reason(REASONS.ACTOR_OMISSION,`actor ${actor.id} disappeared and returned`,{frame,id:actor.id}));
      track.missing=false;track.seenSamples++;track.seenFrames+=elapsed;
      if(actor.emote){
        track.emote+=elapsed;track.emoteTotal+=elapsed;
        if(track.emote>emoteFrames&&!track.emoteReported){
          track.emoteReported=true;violations.push(reason(REASONS.ACTOR_EMOTE_DURATION,`actor ${actor.id} emote ran ${track.emote} frames (limit ${emoteFrames})`,{frame,id:actor.id,frames:track.emote,limit:emoteFrames}));
        }
      }else{track.emote=0;track.emoteReported=false}
      const dx=actor.x-track.x,dy=actor.y-track.y;
      if(dx*dx+dy*dy<=radius*radius){
        if(actor.emote)track.bare=0;
        else{
          track.bare+=elapsed;
          if(track.bare>stillFrames&&!track.stillReported){
            track.stillReported=true;violations.push(reason(REASONS.ACTOR_STILLNESS,`actor ${actor.id} stayed within ${radius}px for ${track.bare} frames`,{frame,id:actor.id,frames:track.bare}));
          }
        }
      }else{track.x=actor.x;track.y=actor.y;track.bare=0;track.stillReported=false}
    }
    for(const[id,track]of tracks)if(!ids.has(id))track.missing=true;
  }
  const persistent=[];
  for(const track of tracks.values()){
    const presence=track.seenSamples/samples.length,share=track.seenFrames?track.emoteTotal/track.seenFrames:0;
    if(presence>=minPresenceShare)persistent.push(track.id);
    if(share>emoteShare)violations.push(reason(REASONS.ACTOR_EMOTE_SHARE,`actor ${track.id} emote covered ${(share*100).toFixed(1)}% of sampled time (limit ${(emoteShare*100).toFixed(0)}%)`,{id:track.id,share,limit:emoteShare}));
  }
  if(!persistent.length)violations.push(reason(REASONS.ACTOR_OMISSION,`no stable watched actor appears in ${(minPresenceShare*100).toFixed(0)}% of samples`,{minPresenceShare,totalFrames}));
  for(const id of protagonists)required.add(id);
  for(const id of required){
    const track=tracks.get(id),presence=track?track.seenSamples/samples.length:0;
    if(presence<minPresenceShare)violations.push(reason(REASONS.ACTOR_OMISSION,`required actor ${id} appears in ${(presence*100).toFixed(1)}% of samples (floor ${(minPresenceShare*100).toFixed(0)}%)`,{id,presence,minPresenceShare}));
  }
}

function validateEvidence(input,options){
  options=options||{};
  const ledger=normalizeLedger(input),violations=[];
  if(!ledger||!ledger.sources||!ledger.events){
    violations.push(reason(REASONS.INVALID_LEDGER,'evidence needs source metadata and an event array'));
    return{ok:false,reasons:[...new Set(violations.map(v=>v.code))],violations,ledger:null};
  }
  if(ledger.protocol!==PROTOCOL)violations.push(reason(REASONS.INVALID_PROTOCOL,`evidence protocol must be exactly ${PROTOCOL}`,{actual:ledger.protocol,expected:PROTOCOL}));
  if(ledger.version!==VERSION)violations.push(reason(REASONS.UNSUPPORTED_VERSION,`evidence version ${ledger.version} is unsupported`,{actual:ledger.version,supported:VERSION}));
  if(typeof ledger.enabled!=='boolean')violations.push(reason(REASONS.INVALID_LEDGER,'evidence enabled flag must be boolean',{enabled:ledger.enabled}));
  else if(!ledger.enabled)violations.push(reason(REASONS.DISABLED_LEDGER,'disabled evidence cannot satisfy a release evidence gate'));
  const scoreFields=[];findScoreField(input,'',scoreFields);
  for(const field of scoreFields)violations.push(reason(REASONS.GAME_SCORE_FIELD,`game-supplied score field ${field} is forbidden`,{field}));
  const sources=new Map(),aliases=new Map();
  for(const source of ledger.sources){
    if(!source||typeof source.id!=='string'||!source.id.trim()||typeof source.kind!=='string'||!source.kind.trim()){
      violations.push(reason(REASONS.INVALID_SOURCE,'sources need non-empty id and kind strings',{source}));continue;
    }
    if(sources.has(source.id))violations.push(reason(REASONS.DUPLICATE_SOURCE,`source ${source.id} is registered more than once`,{source:source.id}));
    else sources.set(source.id,source);
    const alias=sourceAlias(source);
    if(alias){
      const prior=aliases.get(alias);
      if(prior&&prior!==source.id)violations.push(reason(REASONS.ALIASED_SOURCE,`sources ${prior} and ${source.id} alias ${alias}`,{alias,sources:[prior,source.id]}));
      else if(alias.startsWith('alias:'))violations.push(reason(REASONS.ALIASED_SOURCE,`source ${source.id} declares an alias`,{alias,source:source.id}));
      aliases.set(alias,source.id);
    }
  }
  let lastSerial=-Infinity,lastFrame=-Infinity;
  const serials=new Set(),bySerial=new Map(),motionSamples=ledger.samples.slice(),sourceActorIds=new Map();
  for(let index=0;index<ledger.events.length;index++){
    const event=ledger.events[index];
    if(!event||typeof event!=='object'){
      violations.push(reason(REASONS.INVALID_EVENT,`event ${index} is not an object`,{index}));continue;
    }
    const serial=event.serial,frame=event.frame;
    if(!Number.isInteger(serial)||serial<0)violations.push(reason(REASONS.INVALID_EVENT,`event ${index} has an invalid serial`,{index,serial}));
    else{
      if(serials.has(serial))violations.push(reason(REASONS.DUPLICATE_SERIAL,`serial ${serial} is duplicated`,{index,serial}));
      else{
        serials.add(serial);bySerial.set(serial,{event,index});
        if(serial<lastSerial)violations.push(reason(REASONS.DECREASING_SERIAL,`serial ${serial} follows ${lastSerial}`,{index,serial,lastSerial}));
      }
      lastSerial=serial;
    }
    if(!Number.isInteger(frame)||frame<0)violations.push(reason(REASONS.INVALID_EVENT,`event ${index} frame must be a nonnegative integer`,{index,frame}));
    else{
      if(frame<lastFrame)violations.push(reason(REASONS.DECREASING_FRAME,`frame ${frame} follows ${lastFrame}`,{index,frame,lastFrame}));
      lastFrame=frame;
    }
    const sourceId=eventSource(event),source=sources.get(sourceId);
    if(!source)violations.push(reason(REASONS.UNKNOWN_SOURCE,`event ${serial} uses unknown source ${sourceId}`,{serial,source:sourceId}));
    else if(event.kind!==source.kind)violations.push(reason(REASONS.SOURCE_KIND_MISMATCH,`event ${serial} kind ${event.kind} does not match source ${sourceId} kind ${source.kind}`,{serial,source:sourceId,eventKind:event.kind,sourceKind:source.kind}));
    const coordinates=[];coordinateViolations(event,`events[${index}]`,coordinates);
    for(const path of coordinates)violations.push(reason(REASONS.NONFINITE_COORDINATE,`coordinate ${path} must be finite`,{path}));
    const kind=event.kind,eventActors=actorsIn(event);
    if(LOCOMOTION_KINDS.has(kind)&&event.scored!==false&&(!source||source.scored!==false))
      violations.push(reason(REASONS.SCORED_LOCOMOTION,`locomotion event ${serial} is not explicitly unscored`,{serial,source:sourceId}));
    if(REPLAN_KINDS.has(kind)&&event.scored!==false&&(!source||source.scored!==false))
      violations.push(reason(REASONS.SCORED_REPLAN,`replanning event ${serial} is not explicitly unscored`,{serial,source:sourceId}));
    const stableActor=kind==='response'||kind==='commit'||source&&(source.stableActor===true||source.actorId!==undefined||MOTION_KINDS.has(source.kind));
    const actorIds=eventActors.map(actor=>actor&&actor.id),validActorIds=actorIds.filter(id=>typeof id==='string'&&id.trim());
    if(stableActor&&(eventActors.length!==1||validActorIds.length!==1))
      violations.push(reason(REASONS.ACTOR_OMISSION,`${kind||'stable'} event ${serial} needs exactly one non-empty actor identity`,{serial,kind,actors:actorIds}));
    if(source&&source.actorId!==undefined&&validActorIds.length===1&&validActorIds[0]!==source.actorId)
      violations.push(reason(REASONS.ACTOR_IDENTITY_LAUNDERING,`source ${sourceId} changed actor identity`,{serial,source:sourceId,expected:source.actorId,actual:validActorIds[0]}));
    if(source&&validActorIds.length===1&&(MOTION_KINDS.has(source.kind)||source.stableActor===true)){
      const id=validActorIds[0],prior=sourceActorIds.get(sourceId);
      if(prior&&prior!==id)violations.push(reason(REASONS.ACTOR_IDENTITY_LAUNDERING,`source ${sourceId} changed actor ID from ${prior} to ${id}`,{serial,source:sourceId,prior,id}));
      else sourceActorIds.set(sourceId,id);
    }
    if(event.sample===true||(source&&MOTION_KINDS.has(source.kind)))motionSamples.push(event);
  }
  const priorFact=(entry,event,index)=>entry&&entry.index<index&&entry.event.serial<event.serial&&entry.event.frame<=event.frame;
  for(let index=0;index<ledger.events.length;index++){
    const event=ledger.events[index];
    if(!event||typeof event!=='object')continue;
    if(event.kind==='response'){
      const cause=bySerial.get(reference(event,'cause'));
      if(!priorFact(cause,event,index)||cause.event.kind!=='threat')
        violations.push(reason(REASONS.RESPONSE_WITHOUT_THREAT,`response ${event.serial} lacks a prior threat cause`,{serial:event.serial,cause:reference(event,'cause')}));
    }
    if(event.kind==='payoff'){
      const setup=bySerial.get(reference(event,'setup')),commit=bySerial.get(reference(event,'commit'));
      const validSetup=priorFact(setup,event,index)&&setup.event.kind==='setup';
      if(!validSetup)
        violations.push(reason(REASONS.PAYOFF_WITHOUT_SETUP,`payoff ${event.serial} lacks a prior setup`,{serial:event.serial,setup:reference(event,'setup')}));
      const validCommit=priorFact(commit,event,index)&&['commit','response'].includes(commit.event.kind)&&
        validSetup&&commit.index>setup.index&&commit.event.serial>setup.event.serial&&commit.event.frame>=setup.event.frame;
      if(!validCommit)
        violations.push(reason(REASONS.PAYOFF_WITHOUT_COMMIT,`payoff ${event.serial} lacks a causal commit after setup`,{serial:event.serial,commit:reference(event,'commit')}));
    }
  }
  const sampleCoordinates=[];coordinateViolations(ledger.samples,'samples',sampleCoordinates);
  for(const path of sampleCoordinates)violations.push(reason(REASONS.NONFINITE_COORDINATE,`coordinate ${path} must be finite`,{path}));
  validateActors(motionSamples,options,violations);
  return{ok:violations.length===0,reasons:[...new Set(violations.map(v=>v.code))],violations,ledger};
}

function invalidError(report){
  const error=new Error('invalid ambient evidence: '+report.reasons.join(', '));
  error.code='INVALID_EVIDENCE';error.reasons=report.reasons;error.violations=report.violations;return error;
}
function canonicalSample(sample){
  const out=clone(sample),actors=actorsIn(sample).map(actor=>clone(actor)).sort((a,b)=>String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0);
  if(out.frame===undefined&&out.at!==undefined)out.frame=out.at;
  delete out.at;delete out.actor;delete out.actorId;delete out.role;delete out.x;delete out.y;delete out.emote;
  out.actors=actors;return out;
}
function evidencePayload(ledger){
  const payload={protocol:PROTOCOL,version:VERSION,
    sources:ledger.sources.map(source=>clone(source)).sort((a,b)=>String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0),
    events:ledger.events.map(event=>{const out=clone(event);if(out.source===undefined&&out.sourceId!==undefined){out.source=out.sourceId;delete out.sourceId}return out}),
    samples:ledger.samples.map(canonicalSample)};
  for(const key of['enabled','epoch','limit','serial','dropped','lastFrame'])if(ledger[key]!==undefined)payload[key]=clone(ledger[key]);
  return payload;
}
function canonicalEvidenceHash(input,options){
  const report=validateEvidence(input,options);if(!report.ok)throw invalidError(report);
  return canonicalHash(evidencePayload(report.ledger));
}
function deriveEvidence(input,options){
  const report=validateEvidence(input,options);if(!report.ok)throw invalidError(report);
  const ledger=report.ledger,byKind={},bySource={},credited=[];
  for(const event of ledger.events){
    byKind[event.kind]=(byKind[event.kind]||0)+1;
    const source=eventSource(event);bySource[source]=(bySource[source]||0)+1;
    if(CREDIT_KINDS.has(event.kind))credited.push(event);
  }
  const chains=ledger.events.filter(event=>event.kind==='payoff').map(event=>({
    payoff:event.serial,setup:reference(event,'setup'),commit:reference(event,'commit')
  }));
  let maxDeadAir=0;
  for(let i=1;i<credited.length;i++)maxDeadAir=Math.max(maxDeadAir,credited[i].frame-credited[i-1].frame);
  return{
    protocol:PROTOCOL,version:VERSION,eventCount:ledger.events.length,
    firstFrame:ledger.events.length?ledger.events[0].frame:null,lastFrame:ledger.events.length?ledger.events.at(-1).frame:null,
    countsByKind:Object.fromEntries(Object.entries(byKind).sort()),
    countsBySource:Object.fromEntries(Object.entries(bySource).sort()),
    activity:credited.length,progress:(byKind.commit||0)+(byKind.payoff||0),payoffs:byKind.payoff||0,
    maxDeadAir,chains,hash:canonicalHash(evidencePayload(ledger))
  };
}
function assertEvidence(label,input,options,fail){
  if(typeof options==='function'){fail=options;options={}}
  const report=validateEvidence(input,options);
  for(const violation of report.violations)fail(`${label}: [${violation.code}] ${violation.message}`);
  return report;
}

module.exports={PROTOCOL,VERSION,HALF_SECOND,MAX_SAMPLE_STEP,REASONS,
  canonicalize,canonicalStringify,stableStringify:canonicalStringify,canonicalJson:canonicalStringify,
  sha256,canonicalHash,canonicalEvidenceHash,
  validateEvidence,validateLedger:validateEvidence,deriveEvidence,deriveLedger:deriveEvidence,
  assertEvidence,normalizeLedger};
