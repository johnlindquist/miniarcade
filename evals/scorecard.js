'use strict';

// Ambient Evidence Protocol v1 scorecards deliberately retain raw measurements.
// A normalized score is a summary, never a substitute for a release gate.
const SCORECARD_SCHEMA='ambient-evidence-scorecard/v1';

const isObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clamp01=value=>Math.max(0,Math.min(1,value));

function normalizeDimensionDefinition(name,definition){
  const d=finite(definition)?{min:definition}:definition||{};
  if(!isObject(d))throw new Error(`dimension ${name} must be an object or finite minimum`);
  for(const key of['min','max','target','weight'])if(d[key]!==undefined&&!finite(d[key]))
    throw new Error(`dimension ${name} ${key} must be finite`);
  if(d.min!==undefined&&d.max!==undefined&&d.min>d.max)
    throw new Error(`dimension ${name} min exceeds max`);
  if(d.weight!==undefined&&d.weight<0)throw new Error(`dimension ${name} weight must be non-negative`);
  if(d.direction!==undefined&&!['min','max','range','target'].includes(d.direction))
    throw new Error(`dimension ${name} has invalid direction ${d.direction}`);
  return{
    name,
    direction:d.direction||(d.target!==undefined?'target':d.min!==undefined&&d.max!==undefined?'range':d.max!==undefined?'max':'min'),
    min:d.min,max:d.max,target:d.target,
    tolerance:d.tolerance===undefined?undefined:d.tolerance,
    weight:d.weight===undefined?1:d.weight,
    hard:d.hard===true,
    required:d.required!==false,
    unit:typeof d.unit==='string'?d.unit:null,
    description:typeof d.description==='string'?d.description:null
  };
}

function rawValue(raw){
  if(finite(raw))return{value:raw,unit:null,source:null};
  if(!isObject(raw)||!finite(raw.value))return null;
  return{value:raw.value,unit:typeof raw.unit==='string'?raw.unit:null,
    source:typeof raw.source==='string'?raw.source:null};
}

function dimensionScore(value,definition){
  const d=definition;
  if(d.direction==='target'){
    if(d.target===undefined)return 1;
    const tolerance=d.tolerance===undefined?Math.max(1,Math.abs(d.target)):d.tolerance;
    if(!finite(tolerance)||tolerance<0)throw new Error(`dimension ${d.name} tolerance must be finite and non-negative`);
    return tolerance===0?(value===d.target?1:0):clamp01(1-Math.abs(value-d.target)/tolerance);
  }
  if(d.direction==='max'){
    if(d.max===undefined)return 1;
    if(value<=d.max)return 1;
    if(d.max<=0)return 0;
    return clamp01(d.max/value);
  }
  if(d.direction==='range'){
    if(d.min!==undefined&&value<d.min)return d.min<=0?0:clamp01(value/d.min);
    if(d.max!==undefined&&value>d.max)return d.max<=0?0:clamp01(d.max/value);
    return 1;
  }
  if(d.min===undefined)return 1;
  if(value>=d.min)return 1;
  if(d.min<=0)return 0;
  return clamp01(value/d.min);
}

function dimensionPass(value,d){
  if(d.direction==='target'){
    if(d.target===undefined)return true;
    const tolerance=d.tolerance===undefined?0:d.tolerance;
    return Math.abs(value-d.target)<=tolerance;
  }
  if(d.direction==='max')return d.max===undefined||value<=d.max;
  if(d.direction==='range')return(d.min===undefined||value>=d.min)&&(d.max===undefined||value<=d.max);
  return d.min===undefined||value>=d.min;
}

function resolveProfile(profiles,profileName){
  const table=profiles||{};
  const chosen=table[profileName]||(!profileName&&table.default);
  if(chosen)return chosen;
  if(Object.keys(table).length)throw new Error(`unknown benchmark profile: ${profileName}`);
  return{dimensions:{}};
}

function buildScorecard(options){
  options=options||{};
  const profileName=options.profile||'default';
  const profile=options.profileDefinition||resolveProfile(options.profiles,profileName);
  const definitions=profile.dimensions||{};
  if(!isObject(definitions))throw new Error('profile dimensions must be an object');
  const raw=options.dimensions||{};
  if(!isObject(raw))throw new Error('raw dimensions must be an object');
  const names=[...new Set([...Object.keys(definitions),...Object.keys(raw)])].sort();
  const dimensions=[];let weighted=0,totalWeight=0;
  for(const name of names){
    const definition=normalizeDimensionDefinition(name,definitions[name]||{required:false,weight:0});
    const measurement=rawValue(raw[name]);
    if(!measurement){
      dimensions.push({id:name,value:null,unit:definition.unit,source:null,score:0,pass:false,
        hard:definition.hard,required:definition.required,missing:true});
      if(definition.required){totalWeight+=definition.weight;}
      continue;
    }
    const score=dimensionScore(measurement.value,definition),pass=dimensionPass(measurement.value,definition);
    weighted+=score*definition.weight;totalWeight+=definition.weight;
    dimensions.push({id:name,value:measurement.value,unit:measurement.unit||definition.unit,
      source:measurement.source,score,pass,hard:definition.hard,required:definition.required,missing:false,
      limits:{direction:definition.direction,min:definition.min,max:definition.max,target:definition.target,
        tolerance:definition.tolerance}});
  }
  const suppliedGates=Array.isArray(options.gates)?options.gates:[];
  const gates=suppliedGates.map((gate,index)=>{
    if(!gate||typeof gate.code!=='string'||!gate.code)throw new Error(`gate ${index} needs a stable code`);
    return{code:gate.code,pass:gate.pass===true,hard:gate.hard!==false,
      dimension:typeof gate.dimension==='string'?gate.dimension:null,
      message:typeof gate.message==='string'?gate.message:'',details:gate.details===undefined?null:gate.details};
  }).sort((a,b)=>a.code.localeCompare(b.code)||String(a.dimension).localeCompare(String(b.dimension))||a.message.localeCompare(b.message));
  const dimensionHardFailures=dimensions.filter(d=>d.hard&&!d.pass).map(d=>d.id);
  const gateHardFailures=gates.filter(g=>g.hard&&!g.pass).map(g=>g.code);
  const hardPass=dimensionHardFailures.length===0&&gateHardFailures.length===0;
  const score=totalWeight?weighted/totalWeight:1;
  return{
    schema:SCORECARD_SCHEMA,
    profile:profileName,
    verdict:hardPass?'pass':'fail',
    score,
    hardPass,
    hardFailures:{dimensions:dimensionHardFailures,codes:[...new Set(gateHardFailures)].sort()},
    dimensions,
    gates
  };
}

module.exports={SCORECARD_SCHEMA,buildScorecard,resolveProfile,normalizeDimensionDefinition,dimensionScore};
