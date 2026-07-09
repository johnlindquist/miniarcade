/* SIDE/QUEST autoplay toolkit.
 *
 * Small, dependency-free building blocks for self-playing games. The toolkit
 * owns no game state and defines no universal input shape: controllers return
 * whatever intent object (or primitive) their game already understands.
 *
 * Browser:  <script src="autoplay.js"></script>  -> globalThis.AI
 * Node:     const AI = require('./autoplay.js')
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AI=api;
})(typeof globalThis!=='undefined'?globalThis:typeof self!=='undefined'?self:this,function(){
  'use strict';

  const VERSION='1.0.0';
  const SKIP=typeof Symbol==='function'?Symbol('AI.SKIP'):{skip:true};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const valueOf=(value,...args)=>typeof value==='function'?value(...args):value;

  // ---- deterministic randomness -------------------------------------------------
  function hashSeed(seed){
    if(typeof seed==='number'&&Number.isFinite(seed)&&Number.isInteger(seed))return seed>>>0;
    if(typeof seed==='bigint')return Number(seed&BigInt(0xffffffff))>>>0;
    let text;
    if(typeof seed==='string')text=seed;
    else{
      try{text=JSON.stringify(seed);}
      catch(_){text=String(seed);}
      if(text===undefined)text=String(seed);
    }
    let h=2166136261;
    for(let i=0;i<text.length;i++){
      h^=text.charCodeAt(i);
      h=Math.imul(h,16777619);
    }
    // One final avalanche keeps short, similar labels from sharing prefixes.
    h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;
    h=Math.imul(h,0x846ca68b);h^=h>>>16;
    return h>>>0;
  }

  function createRng(seed){
    const initial=hashSeed(seed===undefined?0:seed);
    let state=initial;
    function uint32(){
      state=(state+0x6d2b79f5)>>>0;
      let t=state;
      t=Math.imul(t^(t>>>15),t|1);
      t^=t+Math.imul(t^(t>>>7),t|61);
      return (t^(t>>>14))>>>0;
    }
    function random(){return uint32()/4294967296;}
    random.float=random;
    random.uint32=uint32;
    random.range=(a,b)=>{
      if(b===undefined){b=a;a=0;}
      return a+random()*(b-a);
    };
    random.int=(a,b)=>{
      if(b===undefined){b=a;a=0;}
      a=Math.ceil(a);b=Math.floor(b);
      if(b<a){const t=a;a=b;b=t;}
      return a+Math.floor(random()*(b-a+1));
    };
    random.chance=p=>random()<clamp(Number(p)||0,0,1);
    random.pick=items=>items&&items.length?items[random.int(0,items.length-1)]:null;
    random.sign=()=>random()<0.5?-1:1;
    random.shuffle=(items,inPlace)=>{
      const out=inPlace?items:Array.from(items||[]);
      for(let i=out.length-1;i>0;i--){const j=random.int(0,i),v=out[i];out[i]=out[j];out[j]=v;}
      return out;
    };
    random.getState=()=>state>>>0;
    random.setState=next=>(state=hashSeed(next),random);
    // Forking is stable and does not consume the parent stream.
    random.fork=label=>createRng(hashSeed((state>>>0)+':'+String(label)));
    random.seed=initial;
    return random;
  }

  // ---- controller routing -------------------------------------------------------
  function controllerMux(options){
    if(!options||typeof options!=='object')throw new TypeError('controllerMux requires options');
    let controllers=options.controllers;
    if(!controllers){
      controllers={};
      for(const name of['human','ai','bot','autoplay'])if(own(options,name))controllers[name]=options[name];
    }
    const names=Object.keys(controllers);
    if(!names.length)throw new TypeError('controllerMux requires at least one controller');
    const manual=options.manual||options.isHuman;
    const fallback=options.fallback;
    const defaultMode=options.defaultMode||options.default||
      (controllers.ai?'ai':controllers.bot?'bot':controllers.autoplay?'autoplay':names[0]);
    function choose(context,explicitMode){
      if(explicitMode!==undefined&&explicitMode!==null)return explicitMode;
      if(typeof options.select==='function'){
        const selected=options.select(context);
        if(selected!==undefined&&selected!==null)return selected;
      }
      if(typeof manual==='function')return manual(context)?'human':
        (controllers.ai?'ai':controllers.bot?'bot':controllers.autoplay?'autoplay':defaultMode);
      if(context&&context.controller!==undefined)return context.controller;
      return defaultMode;
    }
    function control(context,explicitMode){
      let mode=choose(context,explicitMode),controller=controllers[mode];
      if(controller===undefined&&typeof fallback==='string'){
        mode=fallback;controller=controllers[mode];
      }
      if(controller===undefined&&fallback!==undefined&&typeof fallback!=='string')
        return valueOf(fallback,context,mode);
      if(controller===undefined)throw new Error('Unknown controller: '+String(mode));
      // Return the selected controller's value unchanged. The game owns its intent schema.
      return valueOf(controller,context,mode);
    }
    control.controllers=controllers;
    control.select=choose;
    return control;
  }

  // ---- selectors and rules ------------------------------------------------------
  function bestBy(items,score,options){
    options=options||{};
    const scoreFn=typeof score==='function'?score:item=>item==null?undefined:item[score];
    const filter=options.filter;
    const maximize=options.maximize!==false;
    let best=null,bestScore=maximize?-Infinity:Infinity,found=false,index=0;
    if(!items)return null;
    for(const item of items){
      const i=index++;
      if(filter&&!filter(item,i))continue;
      const next=scoreFn(item,i);
      if(typeof next!=='number'||Number.isNaN(next))continue;
      if(!found||(maximize?next>bestScore:next<bestScore)){
        found=true;best=item;bestScore=next;
      }
    }
    return found?best:null;
  }

  function pointDistance(a,b){return Math.hypot((b.x||0)-(a.x||0),(b.y||0)-(a.y||0));}

  function nearest(items,origin,options){
    options=options||{};
    const position=options.position||((item)=>item);
    const distance=options.distance||((a,b)=>options.wrap?wrappedDistance(a,b,options.wrap):pointDistance(a,b));
    const filter=options.filter;
    let winner=null,min=Infinity,index=0;
    if(!items)return null;
    for(const item of items){
      const i=index++;
      if(filter&&!filter(item,i))continue;
      const d=distance(origin,position(item,i),item,i);
      if(typeof d==='number'&&!Number.isNaN(d)&&d<min){min=d;winner=item;}
    }
    return winner;
  }

  function firstApplicable(rules,context,fallback){
    for(const rule of rules||[]){
      let result=SKIP;
      if(typeof rule==='function')result=rule(context);
      else if(Array.isArray(rule)){
        if(valueOf(rule[0],context))result=valueOf(rule[1],context);
      }else if(rule&&typeof rule==='object'){
        const condition=own(rule,'when')?rule.when:own(rule,'test')?rule.test:true;
        if(valueOf(condition,context)){
          if(own(rule,'then'))result=valueOf(rule.then,context);
          else if(own(rule,'run'))result=valueOf(rule.run,context);
          else if(own(rule,'value'))result=valueOf(rule.value,context);
        }
      }
      if(result!==SKIP&&result!==undefined&&result!==null)return result;
    }
    return fallback===undefined?null:valueOf(fallback,context);
  }

  // ---- wrapped geometry and steering -------------------------------------------
  function wrappedDelta(from,to,size){
    const raw=to-from;
    if(!(size>0)||!Number.isFinite(size))return raw;
    let d=raw%size;
    if(d>=size/2)d-=size;
    if(d< -size/2)d+=size;
    return d;
  }

  function wrapSize(wrap,axis){
    if(!wrap)return 0;
    if(typeof wrap==='number')return wrap;
    return axis==='x'?(wrap.width||wrap.x||0):(wrap.height||wrap.y||0);
  }

  function wrappedDistance(a,b,wrap){
    if(typeof a==='number'&&typeof b==='number')return Math.abs(wrappedDelta(a,b,wrap));
    const wx=wrapSize(wrap,'x'),wy=wrapSize(wrap,'y');
    const dx=wx?wrappedDelta(a.x||0,b.x||0,wx):(b.x||0)-(a.x||0);
    const dy=wy?wrappedDelta(a.y||0,b.y||0,wy):(b.y||0)-(a.y||0);
    return Math.hypot(dx,dy);
  }

  function vectorTo(from,to,wrap){
    const wx=wrapSize(wrap,'x'),wy=wrapSize(wrap,'y');
    return{
      x:wx?wrappedDelta(from.x||0,to.x||0,wx):(to.x||0)-(from.x||0),
      y:wy?wrappedDelta(from.y||0,to.y||0,wy):(to.y||0)-(from.y||0)
    };
  }

  function moveToward(value,target,maxDelta){
    maxDelta=Math.max(0,maxDelta||0);
    return value<target?Math.min(target,value+maxDelta):Math.max(target,value-maxDelta);
  }

  function steerAngle(current,target,maxTurn,period){
    period=period||Math.PI*2;
    const d=wrappedDelta(current,target,period),turn=clamp(d,-Math.abs(maxTurn),Math.abs(maxTurn));
    let out=(current+turn)%period;
    if(out<0)out+=period;
    return out;
  }

  function seek(from,to,options){
    if(typeof options==='number')options={maxSpeed:options};
    options=options||{};
    const delta=vectorTo(from,to,options.wrap),distance=Math.hypot(delta.x,delta.y);
    const maxSpeed=options.maxSpeed===undefined?1:Math.max(0,options.maxSpeed);
    const stop=Math.max(0,options.stopRadius||0),slow=Math.max(stop,options.slowRadius||0);
    if(distance<=stop||distance===0)return{x:0,y:0,distance};
    let speed=maxSpeed;
    if(slow>stop&&distance<slow)speed*=clamp((distance-stop)/(slow-stop),0,1);
    return{x:delta.x/distance*speed,y:delta.y/distance*speed,distance};
  }

  function flee(from,threat,options){
    const desired=seek(from,threat,options);
    return{x:-desired.x,y:-desired.y,distance:desired.distance};
  }

  function steer(velocity,desired,maxForce){
    let x=(desired.x||0)-(velocity.x||0),y=(desired.y||0)-(velocity.y||0);
    const force=Math.hypot(x,y),limit=maxForce===undefined?Infinity:Math.max(0,maxForce);
    if(force>limit&&force>0){x=x/force*limit;y=y/force*limit;}
    return{x,y};
  }

  // ---- watchability: skill, reaction delay, and intentional lapses --------------
  function asRange(value,fallback){
    let a,b;
    if(Array.isArray(value)){a=Number(value[0]);b=Number(value.length>1?value[1]:value[0]);}
    else if(value!==undefined){a=b=Number(value);}
    else return fallback.slice();
    if(!Number.isFinite(a)||!Number.isFinite(b))return fallback.slice();
    return a<=b?[a,b]:[b,a];
  }

  function createSkillProfile(options){
    options=options||{};
    const skill=clamp(options.skill===undefined?0.75:Number(options.skill),0,1);
    const precision=clamp(options.precision===undefined?0.55+skill*0.45:Number(options.precision),0,1);
    const risk=clamp(options.risk===undefined?0.3+skill*0.5:Number(options.risk),0,1);
    const recovery=clamp(options.recovery===undefined?0.45+skill*0.5:Number(options.recovery),0,1);
    const defaultReaction=[Math.floor((1-skill)*5),Math.ceil((1-skill)*10)];
    const reaction=asRange(options.reactionFrames,defaultReaction);
    const lapseDuration=asRange(options.lapseFrames,[8,Math.round(12+(1-skill)*36)]);
    const lapseChance=clamp(options.lapseChance===undefined?(1-skill)*0.004:Number(options.lapseChance),0,1);
    const rng=options.rng||createRng(options.seed===undefined?0:options.seed);
    if(!rng||typeof rng.chance!=='function'||typeof rng.int!=='function')
      throw new TypeError('skill profile rng must provide chance() and int()');
    let nextDecision=-Infinity,lapseUntil=-Infinity,lastIntent,lastFrame=-Infinity;

    const profile={skill,precision,risk,recovery,lapseChance,
      reactionFrames:reaction.slice(),lapseFrames:lapseDuration.slice(),rng};
    profile.noise=(scale)=>{
      scale=scale===undefined?1:scale;
      const sample=typeof rng.range==='function'?rng.range(-1,1):(rng()*2-1);
      return sample*scale*(1-precision);
    };
    profile.imprecise=(value,spread)=>value+profile.noise(spread);
    profile.takeRisk=(chance)=>rng.chance(clamp((chance===undefined?1:chance)*risk,0,1));
    profile.attemptRecovery=(chance)=>rng.chance(clamp((chance===undefined?1:chance)*recovery,0,1));
    profile.isLapsed=frame=>frame<lapseUntil;
    profile.status=frame=>({
      frame,lapsed:frame<lapseUntil,lapseRemaining:Math.max(0,lapseUntil-frame),
      ready:frame>=nextDecision,lastIntent
    });
    profile.decide=(frame,context,decide,onLapse)=>{
      // Convenience overload: decide(frame, decideFn, context, onLapse).
      if(typeof context==='function'){
        const fn=context;context=decide;decide=fn;
      }
      if(typeof decide!=='function')throw new TypeError('profile.decide requires a decision function');
      lastFrame=Math.max(lastFrame,frame);
      if(frame<lapseUntil)return onLapse?onLapse(context,lastIntent,profile):lastIntent;
      if(frame<nextDecision)return lastIntent;
      if(rng.chance(lapseChance)){
        const duration=rng.int(Math.ceil(lapseDuration[0]),Math.floor(lapseDuration[1]));
        lapseUntil=frame+Math.max(1,duration);nextDecision=lapseUntil;
        return onLapse?onLapse(context,lastIntent,profile):lastIntent;
      }
      lastIntent=decide(context,profile,lastIntent);
      const delay=rng.int(Math.ceil(reaction[0]),Math.floor(reaction[1]));
      nextDecision=frame+Math.max(1,delay);
      return lastIntent;
    };
    profile.remember=(intent,frame)=>{lastIntent=intent;if(frame!==undefined)nextDecision=frame;return intent;};
    profile.reset=()=>{nextDecision=-Infinity;lapseUntil=-Infinity;lastIntent=undefined;lastFrame=-Infinity;};
    Object.defineProperties(profile,{
      lastIntent:{get:()=>lastIntent},nextDecision:{get:()=>nextDecision},
      lapseUntil:{get:()=>lapseUntil},lastFrame:{get:()=>lastFrame}
    });
    return profile;
  }

  // ---- progress watchdog --------------------------------------------------------
  function createProgressWatchdog(options){
    options=options||{};
    let specs;
    if(Array.isArray(options.escalations))specs=options.escalations.map((entry,i)=>
      typeof entry==='number'?{after:entry,action:options.actions&&options.actions[i]}:
        {after:Number(entry.after),action:entry.action,name:entry.name});
    else if(Array.isArray(options.thresholds))specs=options.thresholds.map((after,i)=>
      ({after:Number(after),action:options.actions&&options.actions[i]}));
    else specs=[{after:Number(options.timeout===undefined?180:options.timeout),action:options.action}];
    specs=specs.filter(s=>Number.isFinite(s.after)&&s.after>=0).sort((a,b)=>a.after-b.after);
    if(!specs.length)throw new TypeError('watchdog requires at least one non-negative escalation');
    const changed=options.progressed||options.changed||((next,previous)=>!Object.is(next,previous));
    let value,hasValue=false,lastAt=0,clock=-1,level=0;

    function snapshot(now){
      const age=hasValue?Math.max(0,now-lastAt):0;
      return{value,age,level,stalled:level>0,lastProgressAt:lastAt,now};
    }
    function reset(next,now){
      clock=now===undefined?Math.max(0,clock):now;
      value=next;hasValue=arguments.length>0;lastAt=clock;level=0;
      return snapshot(clock);
    }
    function observe(next,now,context){
      if(now===undefined)now=clock+1;
      clock=now;
      if(!hasValue||changed(next,value,context)){
        value=next;hasValue=true;lastAt=now;level=0;
        return Object.assign(snapshot(now),{progressed:true,event:null,events:[]});
      }
      value=next;
      const age=Math.max(0,now-lastAt),events=[];
      while(level<specs.length&&age>=specs[level].after){
        const spec=specs[level],nextLevel=level+1;
        const before={value,age,level:nextLevel,after:spec.after,name:spec.name,context,now};
        const action=typeof spec.action==='function'?spec.action(context,before):spec.action;
        level=nextLevel;events.push({level,after:spec.after,name:spec.name,action});
      }
      return Object.assign(snapshot(now),{
        progressed:false,event:events.length?events[events.length-1]:null,events
      });
    }
    return{observe,reset,state:()=>snapshot(clock),get value(){return value;},get level(){return level;}};
  }

  // ---- short-term behavior memory ----------------------------------------------
  function createMemory(options){
    options=options||{};
    let localTime=Number(options.start)||0;
    const externalNow=typeof options.now==='function'?options.now:null;
    const now=()=>externalNow?Number(externalNow()):localTime;
    const values=new Map(),cooldowns=new Map(),visitMap=new Map(),blacklistMap=new Map();
    const expiry=duration=>duration===undefined||duration===Infinity?Infinity:
      now()+Math.max(0,Number(duration)||0);
    const expired=entry=>entry&&entry.expires<=now();
    function read(map,key){
      const entry=map.get(key);
      if(expired(entry)){map.delete(key);return undefined;}
      return entry;
    }
    function purge(){
      for(const map of[values,cooldowns,visitMap,blacklistMap])
        for(const [key,entry] of map)if(expired(entry))map.delete(key);
    }
    function set(key,value,ttl){
      if(ttl&&typeof ttl==='object')ttl=ttl.ttl;
      values.set(key,{value,expires:expiry(ttl)});return value;
    }
    function get(key,fallback){const entry=read(values,key);return entry?entry.value:fallback;}
    function has(key){return !!read(values,key);}
    function remove(key){return values.delete(key);}
    function cooldown(key,duration){cooldowns.set(key,{expires:expiry(duration)});return duration;}
    function remaining(key){const entry=read(cooldowns,key);return entry?Math.max(0,entry.expires-now()):0;}
    function ready(key){return !read(cooldowns,key);}
    function useCooldown(key,duration){if(!ready(key))return false;cooldown(key,duration);return true;}
    function visit(key,amount,ttl){
      amount=amount===undefined?1:amount;
      const previous=read(visitMap,key),count=(previous?previous.count:0)+amount;
      visitMap.set(key,{count,expires:expiry(ttl)});return count;
    }
    function visits(key){const entry=read(visitMap,key);return entry?entry.count:0;}
    function blacklist(key,duration,reason){
      if(duration===undefined)duration=Infinity;
      blacklistMap.set(key,{reason:reason===undefined?true:reason,expires:expiry(duration)});
      return reason===undefined?true:reason;
    }
    function isBlacklisted(key){return !!read(blacklistMap,key);}
    function blacklistReason(key){const entry=read(blacklistMap,key);return entry?entry.reason:undefined;}
    function clear(){values.clear();cooldowns.clear();visitMap.clear();blacklistMap.clear();}
    function tick(delta){
      if(!externalNow)localTime+=delta===undefined?1:Number(delta)||0;
      purge();return now();
    }
    function setTime(time){
      if(externalNow)throw new Error('Cannot set time when memory uses an external clock');
      localTime=Number(time)||0;purge();return localTime;
    }
    function snapshot(){
      purge();
      return{
        now:now(),values:Array.from(values,([key,e])=>[key,e.value,e.expires]),
        cooldowns:Array.from(cooldowns,([key,e])=>[key,e.expires]),
        visits:Array.from(visitMap,([key,e])=>[key,e.count,e.expires]),
        blacklist:Array.from(blacklistMap,([key,e])=>[key,e.reason,e.expires])
      };
    }
    return{tick,setTime,purge,set,remember:set,get,has,delete:remove,cooldown,remaining,ready,useCooldown,
      visit,visits,blacklist,isBlacklisted,blacklistReason,unblacklist:key=>blacklistMap.delete(key),
      clear,snapshot,get now(){return now();}};
  }

  // ---- bounded candidate lookahead ---------------------------------------------
  function shallowClone(value){
    if(Array.isArray(value))return value.slice();
    if(value&&typeof value==='object')return Object.assign({},value);
    return value;
  }

  function nonnegativeInteger(value,fallback){
    if(value===Infinity)return Infinity;
    const n=Number(value);
    return Number.isFinite(n)?Math.max(0,Math.floor(n)):fallback;
  }

  function simulateCandidates(candidates,options){
    options=options||{};
    if(typeof options.step!=='function')throw new TypeError('simulateCandidates requires step()');
    // Defaults are finite on purpose: an accidental giant/infinite candidate
    // iterable must not turn a per-frame planner into an unbounded job.
    const maxCandidates=nonnegativeInteger(options.maxCandidates,32);
    const horizon=nonnegativeInteger(options.horizon,60);
    const defaultSteps=maxCandidates===Infinity?(horizon===0?0:Infinity):maxCandidates*horizon;
    const maxSteps=nonnegativeInteger(options.maxSteps,defaultSteps);
    const clone=options.clone||shallowClone,list=[];
    let candidateLimitReached=false;
    for(const candidate of candidates||[]){
      if(list.length>=maxCandidates){candidateLimitReached=true;break;}
      list.push(candidate);
    }
    const entries=list.map((candidate,index)=>{
      let state;
      if(typeof options.createState==='function')state=options.createState(candidate,index);
      else if(own(options,'initialState'))state=clone(options.initialState,candidate,index);
      else state={};
      return{candidate,index,state,steps:0,done:false,score:NaN};
    });
    const finiteTime=Number.isFinite(options.timeBudgetMs),timer=options.now||(()=>Date.now());
    const deadline=finiteTime?timer()+Math.max(0,options.timeBudgetMs):Infinity;
    let steps=0,timeExhausted=false,depth=0;
    outer:for(;depth<horizon;depth++){
      let active=false;
      for(const entry of entries){
        if(entry.done)continue;
        if(options.done&&options.done(entry.state,entry.candidate,entry.steps,entry.index)){
          entry.done=true;continue;
        }
        active=true;
        if(steps>=maxSteps)break outer;
        if(finiteTime&&timer()>=deadline){timeExhausted=true;break outer;}
        const next=options.step(entry.state,entry.candidate,entry.steps,entry.index);
        if(next!==undefined)entry.state=next;
        entry.steps++;steps++;
        if(options.done&&options.done(entry.state,entry.candidate,entry.steps,entry.index))entry.done=true;
      }
      if(!active)break;
    }
    let bestResult=null;
    const maximize=options.maximize!==false;
    for(const entry of entries){
      entry.score=options.score?options.score(entry.state,entry.candidate,entry.steps,entry.index):
        entry.state&&entry.state.score;
      if(typeof entry.score!=='number'||Number.isNaN(entry.score))continue;
      if(!bestResult||(maximize?entry.score>bestResult.score:entry.score<bestResult.score))bestResult=entry;
    }
    const budgetExhausted=steps>=maxSteps&&entries.some(entry=>!entry.done&&entry.steps<horizon);
    const horizonReached=entries.some(entry=>!entry.done&&entry.steps>=horizon);
    return{
      best:bestResult?bestResult.candidate:null,bestResult,results:entries,steps,depth,
      truncated:candidateLimitReached||budgetExhausted||timeExhausted,
      candidateLimitReached,budgetExhausted,timeExhausted,horizonReached
    };
  }

  // ---- binary heap and A* / Dijkstra pathfinding --------------------------------
  class BinaryHeap{
    constructor(compare){this.compare=compare||((a,b)=>a-b);this.data=[];}
    get size(){return this.data.length;}
    peek(){return this.data.length?this.data[0]:undefined;}
    clear(){this.data.length=0;}
    push(value){
      const data=this.data;data.push(value);
      let i=data.length-1;
      while(i>0){const p=(i-1)>>1;if(this.compare(data[i],data[p])>=0)break;
        const t=data[i];data[i]=data[p];data[p]=t;i=p;}
      return this;
    }
    pop(){
      const data=this.data;if(!data.length)return undefined;
      const top=data[0],last=data.pop();
      if(data.length){
        data[0]=last;let i=0;
        for(;;){
          const left=i*2+1,right=left+1;let best=i;
          if(left<data.length&&this.compare(data[left],data[best])<0)best=left;
          if(right<data.length&&this.compare(data[right],data[best])<0)best=right;
          if(best===i)break;
          const t=data[i];data[i]=data[best];data[best]=t;i=best;
        }
      }
      return top;
    }
    toArray(){return this.data.slice();}
  }

  const pointKey=node=>node.x+','+node.y;

  function searchPath(options){
    options=options||{};
    if(!own(options,'start'))throw new TypeError('searchPath requires start');
    if(typeof options.neighbors!=='function')throw new TypeError('searchPath requires neighbors()');
    if(!own(options,'goal')&&typeof options.isGoal!=='function')
      throw new TypeError('searchPath requires goal or isGoal()');
    const start=options.start,goal=options.goal;
    const key=options.key||((node)=>node);
    const startKey=key(start),goalKey=own(options,'goal')?key(goal):undefined;
    const isGoal=options.isGoal||((node,nodeKey)=>Object.is(nodeKey,goalKey));
    const cost=options.cost||(()=>1),heuristic=options.heuristic||(()=>0);
    const maxIterations=Math.max(0,Math.floor(options.maxIterations===undefined?10000:options.maxIterations));
    const maxCost=options.maxCost===undefined?Infinity:options.maxCost;
    const weight=options.heuristicWeight===undefined?1:Math.max(0,options.heuristicWeight);
    let order=0,iterations=0;
    const openSet=new BinaryHeap((a,b)=>a.f-b.f||a.h-b.h||a.order-b.order);
    const best=new Map([[startKey,0]]),came=new Map(),nodes=new Map([[startKey,start]]);
    let h=Number(heuristic(start,goal));if(!Number.isFinite(h))h=0;
    openSet.push({node:start,nodeKey:startKey,g:0,h,f:h*weight,order:order++});

    function build(endKey,endNode,endCost){
      const path=[];let cursor=endKey;
      while(!Object.is(cursor,startKey)){
        path.push(nodes.get(cursor));
        if(!came.has(cursor))return null;
        cursor=came.get(cursor);
      }
      if(options.includeStart)path.push(start);
      path.reverse();
      return{found:true,path,cost:endCost,iterations,visited:best.size,end:endNode,
        truncated:false,reason:'found'};
    }

    while(openSet.size&&iterations<maxIterations){
      const current=openSet.pop();
      if(current.g!==best.get(current.nodeKey))continue;
      iterations++;
      if(options.onVisit)options.onVisit(current.node,current.g,iterations);
      if(isGoal(current.node,current.nodeKey,goal))return build(current.nodeKey,current.node,current.g);
      for(const next of options.neighbors(current.node,current.g)||[]){
        if(options.blocked&&options.blocked(next,current.node))continue;
        const edge=Number(cost(current.node,next));
        if(edge<0)throw new RangeError('Path costs must be non-negative');
        if(!Number.isFinite(edge))continue;
        const nextG=current.g+edge;
        if(nextG>maxCost)continue;
        const nextKey=key(next),previous=best.get(nextKey);
        if(previous!==undefined&&nextG>=previous)continue;
        best.set(nextKey,nextG);came.set(nextKey,current.nodeKey);nodes.set(nextKey,next);
        let nextH=Number(heuristic(next,goal));if(!Number.isFinite(nextH))nextH=0;
        openSet.push({node:next,nodeKey:nextKey,g:nextG,h:nextH,
          f:nextG+nextH*weight,order:order++});
      }
    }
    return{found:false,path:null,cost:Infinity,iterations,visited:best.size,end:null,
      truncated:openSet.size>0,reason:openSet.size?'maxIterations':'noPath'};
  }

  function findPath(options){const result=searchPath(options);return result.found?result.path:null;}

  // ---- generate-and-prove -------------------------------------------------------
  function generateValidated(build,validate,options){
    if(typeof build!=='function'||typeof validate!=='function')
      throw new TypeError('generateValidated requires build() and validate()');
    options=options||{};const maxAttempts=Math.max(1,Math.floor(options.maxAttempts||40));
    let lastValue=null,lastResult=null;
    for(let attempt=1;attempt<=maxAttempts;attempt++){
      const value=build(attempt),result=validate(value,attempt);
      const ok=result===true||(result&&result.ok===true);
      if(ok)return{ok:true,value,result,attempts:attempt};
      lastValue=value;lastResult=result;
      if(options.onReject)options.onReject(value,result,attempt);
    }
    const failure={ok:false,value:lastValue,result:lastResult,attempts:maxAttempts};
    if(options.throwOnFailure){const error=new Error('Unable to generate a valid result in '+maxAttempts+' attempts');
      error.generation=failure;throw error;}
    return failure;
  }

  return Object.freeze({
    VERSION,SKIP,hashSeed,createRng,rng:createRng,
    controllerMux,muxControllers:controllerMux,
    nearest,bestBy,firstApplicable,
    wrappedDelta,wrappedDistance,vectorTo,moveToward,steerAngle,seek,flee,steer,
    createSkillProfile,skillProfile:createSkillProfile,
    createProgressWatchdog,progressWatchdog:createProgressWatchdog,
    createMemory,memory:createMemory,
    simulateCandidates,
    BinaryHeap,pointKey,searchPath,findPath,generateValidated
  });
});
