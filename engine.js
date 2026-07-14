/* SIDE/QUEST engine — shared scaffolding for self-playing 4:9 column games.
 *
 * Every game is a 160x360 logical canvas (2x backing store) that fills the
 * vertical strip left beside 4:3 footage in a 16:9 frame. The engine owns:
 *   - canvas + pixel-scaled 2d context        E.cv, E.ctx, E.W, E.H
 *   - a fixed 60Hz simulation loop            E.start(step, render)
 *   - rng / math helpers                      E.R, E.RI, E.hash, E.dist, E.clamp
 *   - pixel-rect drawing                      E.rect(x, y, w, h, color)
 *   - a particle pool                         E.spawn / E.burst / E.dust
 *                                             E.stepParts(hook?) / E.drawParts(camY?)
 *   - sim-inert fx stream + confetti          E.fxRandom / E.fxR / E.fxRI
 *     (celebrations never touch sim RNG)      E.fxBurst / E.fxDust
 *   - show kernel: payoff arbitration +       E.createShow({queueLimit, recoveryGap,
 *     hold/slow-mo/admire directives +          tiers:{n:{frames,minGap,hold,
 *     frame-stamped telemetry for evals          slowEvery,slowFrames,admire}}})
 *   - expanding ring effects                  E.ring / E.stepRings / E.drawRings(camY?)
 *   - screen shake                            E.shake(n) + E.preDraw() / E.postDraw()
 *   - keyboard input (arrows/WASD/space/...)  E.keys, E.tap(name), E.manual()
 *   - player sessions (attract -> instructions E.initSession(name), E.sessionStep({reset}),
 *     -> playing -> game over, score + best)   E.playing(), E.addScore(n), E.gameOver(info),
 *                                              E.drawSession(showScore?)
 *   - canvas video capture                    E.record(seconds) — realtime MediaRecorder
 *   - turbo capture                           E.recordTurbo(seconds) — simulates as fast as
 *     (?record=N runs turbo by default;        the CPU allows, encodes every frame via
 *      add &speed=1 to force realtime)         WebCodecs at exact 60fps timestamps, muxes a
 *                                              seekable .webm (needs webm-muxer.min.js)
 *
 * Page contract: a <canvas id="cv" width="320" height="720"> styled to
 * height:100vh; aspect-ratio:4/9; image-rendering:pixelated. Include this
 * file before the game script, then call E.start(step, render). step(frame)
 * runs at exactly 60Hz on any display; render(frame) runs after simulation
 * advances (30Hz in ?preview=1 gallery cards, 60Hz everywhere else).
 */
'use strict';
const E=(()=>{
  const cv=document.getElementById('cv'),ctx=cv.getContext('2d',{alpha:false});
  ctx.scale(2,2);
  const W=160,H=360;
  const params=typeof location!=='undefined'?new URLSearchParams(location.search||''):new URLSearchParams();
  const preview=params.has('preview');
  function makeRng(seed){let s=seed>>>0;
    return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);
      t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
  }
  // Rendering must never advance the simulation stream: gallery previews,
  // direct pages, turbo capture, and headless evals all draw at different rates.
  // The fx stream exists because celebrations fire from step(): using the sim
  // stream there would let a payoff burst reshuffle later enemies and layouts,
  // and visualRng advances at render rate so it isn't replay-exact either.
  let rng=null,rngSeed=null,visualRng=makeRng(0x51de0f5e),fxRng=makeRng(0x9d2c5681);
  function seedRandom(seed){
    rngSeed=(Number(seed)>>>0)||1;
    rng=makeRng(rngSeed);
    visualRng=makeRng((Math.imul(rngSeed^0x9e3779b9,0x85ebca6b)>>>0)||0x51de0f5e);
    fxRng=makeRng((Math.imul(rngSeed^0x3c6ef372,0xc2b2ae35)>>>0)||0x9d2c5681);
    return rngSeed;
  }
  if(params.has('seed'))seedRandom(params.get('seed'));
  const random=()=>rng?rng():Math.random();
  const R=(a,b)=>a+random()*(b-a);
  const RI=(a,b)=>Math.floor(R(a,b+1));
  const fxRandom=()=>fxRng();
  const fxR=(a,b)=>a+fxRng()*(b-a);
  const fxRI=(a,b)=>Math.floor(fxR(a,b+1));
  const hash=(x,y)=>{const s=Math.sin(x*127.1+y*311.7)*43758.5453;return s-Math.floor(s);};
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function rect(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),w,h);}

  // ---- particles: tiny squares with drag, optional gravity, fading tail
  let parts=[],partFree=[];
  function spawn(p){const out=partFree.pop()||{};
    Object.assign(out,{x:0,y:0,vx:0,vy:0,t:20,drag:0.94,grav:0,c:'#fff'},p);parts.push(out);return out;}
  function burst(x,y,n,c,sp,grav){
    for(let i=0;i<n;i++){const a=R(0,6.283);
      spawn({x,y,vx:Math.cos(a)*R(0.3,sp),vy:Math.sin(a)*R(0.3,sp),t:RI(14,32),c,grav:grav||0});}
  }
  function dust(x,y,n,c){
    for(let i=0;i<n;i++)spawn({x:x+R(-3,3),y:y+R(0,3),vx:R(-0.4,0.4),vy:R(-0.3,0.1),t:RI(8,18),c:c||'#8a7a5e',drag:1});
  }
  // Celebration particles live in their own pool: game stepParts hooks can
  // kill, count, or roll sim RNG per particle, so fx confetti passing through
  // them would leak presentation into gameplay. __NO_PAYOFF_FX must leave the
  // sim byte-identical, which this isolation makes true by construction.
  let fxParts=[];
  function fxBurst(x,y,n,c,sp,grav){
    if(typeof __NO_PAYOFF_FX!=='undefined')return;
    for(let i=0;i<n;i++){const a=fxR(0,6.283);
      fxParts.push(Object.assign(partFree.pop()||{},{drag:0.94,
        x,y,vx:Math.cos(a)*fxR(0.3,sp),vy:Math.sin(a)*fxR(0.3,sp),t:fxRI(14,32),c,grav:grav||0}));}
  }
  function fxDust(x,y,n,c){
    if(typeof __NO_PAYOFF_FX!=='undefined')return;
    for(let i=0;i<n;i++)fxParts.push(Object.assign(partFree.pop()||{},{grav:0,
      x:x+fxR(-3,3),y:y+fxR(0,3),vx:fxR(-0.4,0.4),vy:fxR(-0.3,0.1),t:fxRI(8,18),c:c||'#8a7a5e',drag:1}));
  }
  function stepParts(hook){ // hook(p) may return false to kill the particle
    let w=0;
    for(const p of parts){
      p.vx*=p.drag;p.vy*=p.drag;p.vy+=p.grav;p.x+=p.vx;p.y+=p.vy;p.t--;
      if(hook&&hook(p)===false)p.t=0;
      if(p.t>0)parts[w++]=p;else partFree.push(p);
    }
    parts.length=w;
    w=0;
    for(const p of fxParts){
      p.vx*=p.drag;p.vy*=p.drag;p.vy+=p.grav;p.x+=p.vx;p.y+=p.vy;p.t--;
      if(p.t>0)fxParts[w++]=p;else partFree.push(p);
    }
    fxParts.length=w;
  }
  function drawParts(camY){camY=camY||0;
    for(const p of parts){ctx.globalAlpha=Math.min(1,p.t/12);rect(p.x,p.y-camY,2,2,p.c);}
    for(const p of fxParts){ctx.globalAlpha=Math.min(1,p.t/12);rect(p.x,p.y-camY,2,2,p.c);}
    ctx.globalAlpha=1;
  }

  // ---- expanding rings (pings, sweeps, shockwaves)
  let rings=[],ringFree=[];
  function ring(x,y,c,dr,t){const f=ringFree.pop()||{};Object.assign(f,{x,y,r:3,dr,t,t0:t,c});rings.push(f);return f;}
  function stepRings(){let w=0;for(const f of rings){f.r+=f.dr;f.t--;
      if(f.t>0)rings[w++]=f;else ringFree.push(f);}rings.length=w;}
  function drawRings(camY){camY=camY||0;
    for(const f of rings){ctx.globalAlpha=0.7*f.t/f.t0;ctx.strokeStyle=f.c;
      ctx.beginPath();ctx.arc(f.x,f.y-camY,f.r,0,7);ctx.stroke();}
    ctx.globalAlpha=1;
  }

  // ---- screen shake, applied around the world draw
  let shakeT=0;
  const shake=n=>{shakeT=Math.max(shakeT,n);};
  // Whole-pixel offsets only: a fractional translate antialiases every rect
  // edge against whatever lies beneath, which on a pixelated canvas reads as
  // a ghostly grid flashing over dark scenes during even tiny shakes.
  function preDraw(){ctx.save();if(shakeT>0){ctx.translate(Math.round((visualRng()*2-1)*shakeT*0.4),
      Math.round((visualRng()*2-1)*shakeT*0.4));shakeT--;}}
  function postDraw(){ctx.restore();}

  // ---- show kernel: deterministic celebration arbitration + frame-stamped
  //      telemetry. Decides WHEN a payoff may present (priority beats FIFO,
  //      same-id coalescing, fast expiry, per-tier spacing, a recovery gap
  //      after apex cues) and WHAT presentation the game should honor this
  //      frame (world hold, integer physics gating, bot admire). It never
  //      mutates gameplay, schedules acts, or draws: games offer moments,
  //      render the active cue, and honor the directives. Pure function of
  //      the call sequence — no RNG. Callers pass a monotonic showFrame
  //      (game/engine frame counters reset between runs; the kernel must not
  //      guess reset behavior).
  function createShow(opts){
    opts=opts||{};
    const queueLimit=opts.queueLimit!==undefined?opts.queueLimit:2;
    const recoveryGap=opts.recoveryGap!==undefined?opts.recoveryGap:45;
    const tiers={};
    const tierCfg=t=>tiers[t]||(tiers[t]={frames:48,minGap:0,hold:0,slowEvery:1,slowFrames:0,admire:0});
    for(const k in(opts.tiers||{})){
      const src=opts.tiers[k];
      tiers[k]={frames:src.frames!==undefined?src.frames:48,minGap:src.minGap||0,hold:src.hold||0,
        slowEvery:src.slowEvery||1,slowFrames:src.slowFrames||0,admire:src.admire||0};
    }
    let active=null,queue=[],log=[],lastShown={},lastApexEnd=-1e9;
    const counts={offered:0,shown:0,dropped:0,expired:0,coalesced:0,preempted:0,
      heldFrames:0,slowedFrames:0,admireFrames:0,notes:0,logTotal:0,maxQueue:0};
    // Per-tier trigger opportunities vs presentations: ladder-coverage evals
    // must see that muting tier 1 didn't erase tier-1 *events*, only cues.
    const offeredByTier={},shownByTier={};
    const bump=(m,t)=>{m[t]=(m[t]||0)+1;};
    function record(kind,sf,cue,extra){
      counts.logTotal++;
      log.push(Object.assign({kind,frame:sf,id:cue&&cue.id,tier:cue&&cue.tier,tag:cue&&cue.tag},extra));
      if(log.length>600)log.splice(0,log.length-600);
    }
    function begin(cue,sf){
      const cfg=tierCfg(cue.tier);
      // presentation starts the frame AFTER the trigger, whether the cue came
      // straight from offer() or was promoted from the queue — this keeps the
      // hold/slow/admire windows exactly cfg-sized in both paths
      active={id:cue.id,tier:cue.tier,tag:cue.tag,x:cue.x,y:cue.y,data:cue.data,
        count:cue.count||1,startAt:sf+1,endAt:sf+1+cfg.frames,cfg};
      lastShown[cue.tier]=sf;counts.shown++;bump(shownByTier,cue.tier);record('show',sf,active);
    }
    function offer(o){
      counts.offered++;bump(offeredByTier,o.tier);
      const sf=o.at,cfg=tierCfg(o.tier);
      o={id:o.id,tier:o.tier,tag:o.tag,x:o.x,y:o.y,data:o.data,at:sf,
        expiresAt:o.expiresAt!==undefined?o.expiresAt:sf+18,count:1};
      if(active&&active.id===o.id&&active.tier===o.tier){active.count++;counts.coalesced++;return'coalesced';}
      const dup=queue.find(q=>q.id===o.id&&q.tier===o.tier);
      if(dup){dup.count++;counts.coalesced++;return'coalesced';}
      if(lastShown[o.tier]!==undefined&&sf-lastShown[o.tier]<cfg.minGap){
        counts.dropped++;record('drop',sf,o,{why:'gap'});return'dropped';}
      if(active&&o.tier>active.tier){
        counts.preempted++;record('preempt',sf,active,{by:o.id});
        begin(o,sf);return'shown';}
      if(!active&&!(o.tier>=2&&sf-lastApexEnd<recoveryGap)){begin(o,sf);return'shown';}
      if(o.tier>=(active?active.tier:2)&&queue.length<queueLimit){
        queue.push(o);counts.maxQueue=Math.max(counts.maxQueue,queue.length);return'queued';}
      counts.dropped++;record('drop',sf,o,{why:'busy'});return'dropped';
    }
    function note(e){
      counts.notes++;
      record(e.kind||'note',e.at,e,e.landsAt!==undefined?{landsAt:e.landsAt}:undefined);
    }
    function step(sf){
      if(active&&sf>=active.endAt){
        if(active.tier>=3)lastApexEnd=sf;
        record('end',sf,active);active=null;
      }
      while(!active&&queue.length){
        const c=queue[0];
        if(c.expiresAt<sf){queue.shift();counts.expired++;record('expire',sf,c);continue;}
        if(c.tier>=2&&sf-lastApexEnd<recoveryGap)break;
        if(lastShown[c.tier]!==undefined&&sf-lastShown[c.tier]<tierCfg(c.tier).minGap){
          queue.shift();counts.dropped++;record('drop',sf,c,{why:'gap'});continue;}
        queue.shift();begin(c,sf);
      }
      let holdWorld=false,physicsEvery=1,admire=false,t=0;
      if(active){
        t=sf-active.startAt;const cfg=active.cfg;
        holdWorld=t>=0&&t<cfg.hold;
        if(!holdWorld&&t>=0&&t<cfg.hold+cfg.slowFrames)physicsEvery=cfg.slowEvery;
        admire=t>=0&&t<cfg.admire;
        if(holdWorld)counts.heldFrames++;
        if(physicsEvery>1)counts.slowedFrames++;
        if(admire)counts.admireFrames++;
      }
      return{cue:active,t,holdWorld,physicsEvery,admire};
    }
    function reset(sf){
      sf=sf||0;
      if(active){if(active.tier>=3)lastApexEnd=sf;record('end',sf,active,{why:'reset'});active=null;}
      for(const c of queue){counts.expired++;record('expire',sf,c,{why:'reset'});}
      queue.length=0;
    }
    return{offer,note,step,reset,events:()=>log.slice(),
      probe:()=>Object.assign({queued:queue.length,
        active:active?{id:active.id,tier:active.tier}:null,
        offeredByTier:Object.assign({},offeredByTier),
        shownByTier:Object.assign({},shownByTier)},counts)};
  }

  // ---- ambient evidence ledger: observational, deterministic, bounded, and
  //      clone-isolated. Games register honest telemetry sources once, then
  //      append nondecreasing frame-ordered facts. The simulation must never read
  //      this ledger to make decisions. __NO_EVIDENCE_LEDGER turns every API
  //      into a no-op without consuming RNG or mutating the retained history.
  function createEvidence(options){
    options=options||{};
    const limit=options.limit===undefined?(options.maxEvents===undefined?(options.capacity===undefined?600:options.capacity):options.maxEvents):options.limit;
    if(!Number.isInteger(limit)||limit<1)throw new Error('evidence limit must be a positive integer');
    const clone=(value,seen)=>{
      if(value===null||typeof value!=='object')return value;
      seen=seen||new Map();if(seen.has(value))throw new Error('evidence values must not be cyclic');
      const out=Array.isArray(value)?[]:{};seen.set(value,out);
      if(Array.isArray(value))for(const item of value)out.push(clone(item,seen));
      else for(const key of Object.keys(value))out[key]=clone(value[key],seen);
      seen.delete(value);return out;
    };
    const rawSources=options.sources||[],sources=[];
    if(Array.isArray(rawSources)){
      for(const source of rawSources){
        if(typeof source==='string')sources.push({id:source,kind:source});
        else sources.push(clone(source));
      }
    }else if(rawSources&&typeof rawSources==='object'){
      for(const id of Object.keys(rawSources)){
        const value=rawSources[id];
        sources.push(typeof value==='string'?{id,kind:value}:Object.assign({id},clone(value||{})));
      }
    }else throw new Error('evidence sources must be an array or object');
    const sourceById=new Map();
    for(const source of sources){
      if(!source||typeof source.id!=='string'||!source.id.trim()||typeof source.kind!=='string'||!source.kind.trim())
        throw new Error('evidence sources need non-empty id and kind strings');
      if(sourceById.has(source.id))throw new Error('evidence source ids must be unique: '+source.id);
      sourceById.set(source.id,source);
    }
    let events=[],serial=0,lastFrame=-Infinity,dropped=0,epoch=0;
    const disabled=()=>typeof globalThis!=='undefined'&&typeof globalThis.__NO_EVIDENCE_LEDGER!=='undefined';
    function record(sourceOrEvent,frameOrEvent,data){
      if(disabled())return null;
      let event;
      if(sourceOrEvent&&typeof sourceOrEvent==='object')event=clone(sourceOrEvent);
      else if(typeof frameOrEvent==='number')event=Object.assign({},clone(data||{}),{source:sourceOrEvent,frame:frameOrEvent});
      else event=Object.assign({},clone(frameOrEvent||{}),{source:sourceOrEvent});
      const sourceId=event.source===undefined?event.sourceId:event.source,source=sourceById.get(sourceId);
      if(!source)throw new Error('unknown evidence source: '+sourceId);
      const frame=event.frame;
      if(!Number.isInteger(frame)||frame<0||frame<lastFrame)throw new Error('evidence frames must be nonnegative integers in nondecreasing order');
      if(event.serial!==undefined)throw new Error('evidence serial is ledger-owned');
      if(event.kind!==undefined&&event.kind!==source.kind)throw new Error('evidence source kind mismatch: '+sourceId);
      delete event.sourceId;event.source=sourceId;event.kind=source.kind;event.serial=++serial;
      lastFrame=frame;events.push(event);
      if(events.length>limit){const n=events.length-limit;events.splice(0,n);dropped+=n;}
      return clone(event);
    }
    function eventsSince(after){
      if(disabled())return[];
      after=after===undefined?-1:Number(after);
      return events.filter(event=>event.serial>after).map(event=>clone(event));
    }
    function probe(){
      const off=disabled();
      return{protocol:'ambient-evidence/v1',version:1,enabled:!off,epoch,limit,
        serial:off?0:serial,lastFrame:off?null:(lastFrame===-Infinity?null:lastFrame),
        dropped:off?0:dropped,sources:sources.map(source=>clone(source)),
        events:off?[]:events.map(event=>clone(event))};
    }
    function reset(){
      if(disabled())return false;
      events=[];serial=0;lastFrame=-Infinity;dropped=0;epoch++;return true;
    }
    return{record,emit:record,append:record,observe:record,event:record,eventsSince,events:()=>eventsSince(-1),probe,reset};
  }

  // ---- keyboard: arrows + WASD move, space/x/z act; any input enters manual
  //      mode and the AI takes back over after 8 idle seconds
  const keys={left:false,right:false,up:false,down:false,a:false,b:false,c:false};
  const taps={};let lastKeyTime=-1e9;
  const KEYMAP={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',
    ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',
    Space:'a',KeyX:'b',KeyJ:'b',KeyK:'b',KeyZ:'c',ShiftLeft:'c',ShiftRight:'c',
    Enter:'start',NumpadEnter:'start',Escape:'quit'};
  if(!preview&&typeof document!=='undefined'&&document.addEventListener){
    document.addEventListener('keydown',e=>{
      const k=KEYMAP[e.code];if(!k)return;
      e.preventDefault();
      if(!keys[k])taps[k]=(taps[k]||0)+1;
      keys[k]=true;lastKeyTime=Date.now();
    });
    document.addEventListener('keyup',e=>{
      const k=KEYMAP[e.code];if(!k)return;
      keys[k]=false;lastKeyTime=Date.now();
    });
  }
  function tap(name){if(taps[name]){taps[name]=0;return true;}return false;}
  function manual(){return SES.mode!=='instructions'&&Date.now()-lastKeyTime<8000;}
  function axis2(options){ // stable keyboard vector; bridges brief key ghosting
    options=options||{};const sticky=options.stickyFrames||0,normalize=!!options.normalize;
    let lx=0,ly=0,left=0;
    return()=>{let x=(keys.right?1:0)-(keys.left?1:0),y=(keys.down?1:0)-(keys.up?1:0);
      if(x||y){lx=x;ly=y;left=sticky;}else if(left>0){x=lx;y=ly;left--;}
      if(normalize&&x&&y){x*=Math.SQRT1_2;y*=Math.SQRT1_2;}return{x,y};};
  }

  // ---- player sessions: attract (AI plays) -> ENTER -> instructions -> ENTER -> playing
  //      -> game over -> attract
  const SES={mode:'attract',score:0,best:0,t:0,name:'game',info:'',help:[],viewer:false};
  function initSession(name,help,options){SES.name=name;SES.help=help||[];SES.viewer=!!(options&&options.viewer);
    try{SES.best=+(localStorage.getItem('sq-'+name)||0);}catch(e){}}
  function playing(){return SES.mode==='playing';}
  function addScore(n){SES.score+=n;}
  function gameOver(info){SES.mode='over';SES.t=0;SES.info=info||'';
    if(SES.score>SES.best){SES.best=SES.score;
      try{localStorage.setItem('sq-'+SES.name,SES.best);}catch(e){}}}
  function sessionStep(hooks){ // call once per step; hooks: {reset()}
    SES.t++;
    if(SES.mode==='attract'){
      if(tap('start')){SES.mode='instructions';SES.t=0;}
    }else if(SES.mode==='instructions'){
      if(tap('start')){hooks.reset();SES.mode='playing';SES.score=0;SES.t=0;}
      else if(tap('quit')){SES.mode='attract';SES.t=0;}
    }else if(SES.mode==='playing'){
      if(tap('quit')){SES.mode='attract';SES.t=0;hooks.reset();}
    }else{ // game over card
      if(tap('start')){hooks.reset();SES.mode='playing';SES.score=0;SES.t=0;}
      else if(SES.t>720){SES.mode='attract';SES.t=0;hooks.reset();}
    }
  }
  function drawSession(showScore){
    if(preview||recording||typeof __NO_UI!=='undefined')return; // never in previews or captured video
    const cx2=W/2;
    ctx.font='bold 8px monospace';
    if(SES.mode==='attract'){
      if(SES.viewer){
        // These games are ambient shows first. On a direct page, interaction is
        // a delayed corner affordance; gallery previews and recordings stay pure.
        if(!preview&&SES.t>480&&Math.floor((SES.t-480)/90)%2===0){
          ctx.font='bold 5px monospace';const s='ENTER · TAKE OVER',w2=s.length*3+6;
          ctx.globalAlpha=0.28;rect(W-w2-3,H-10,w2,8,'#0a0d14');ctx.globalAlpha=0.48;
          ctx.fillStyle='#c8d2e0';ctx.fillText(s,W-w2,H-4);ctx.globalAlpha=1;
        }
      }else if(Math.floor(SES.t/45)%2===0){
        const s='ENTER · PLAY',w2=s.length*5+10;
        ctx.globalAlpha=0.6;rect(cx2-w2/2,H-26,w2,12,'#0a0d14');
        ctx.globalAlpha=0.9;ctx.fillStyle='#e8ebf2';
        ctx.fillText(s,cx2-s.length*2.5,H-17);ctx.globalAlpha=1;
      }
    }else if(SES.mode==='instructions'){
      const hl=SES.help,cardH=56+hl.length*12,top=Math.round((H-cardH)/2);
      ctx.globalAlpha=0.9;rect(10,top,W-20,cardH,'#0a0d14');ctx.globalAlpha=0.55;
      ctx.strokeStyle='#2de2e6';ctx.strokeRect(10.5,top+0.5,W-21,cardH-1);ctx.globalAlpha=1;
      ctx.fillStyle='#e8ebf2';
      let s='INSTRUCTIONS';ctx.fillText(s,cx2-s.length*2.5,top+17);
      if(hl.length){
        ctx.font='bold 6px monospace';
        const keyW=Math.max(...hl.map(l=>l[0].length));
        hl.forEach((ln,i)=>{
          ctx.fillStyle='#2de2e6';ctx.fillText(ln[0],18,top+35+i*12);
          ctx.fillStyle='#c8d2e0';ctx.fillText(ln[1],18+keyW*3.6+8,top+35+i*12);
        });
      }
      ctx.font='bold 8px monospace';ctx.fillStyle='#ffd166';
      s='ENTER · START';ctx.fillText(s,cx2-s.length*2.5,top+cardH-10);
    }else if(SES.mode==='playing'){
      if(showScore!==false){
        const s=''+SES.score,w2=Math.max(28,s.length*5+12);
        ctx.globalAlpha=0.55;rect(cx2-w2/2,H-16,w2,12,'#0a0d14');ctx.globalAlpha=1;
        ctx.fillStyle='#ffd166';ctx.fillText(s,cx2-s.length*2.5,H-7);
      }
    }else{
      ctx.globalAlpha=0.85;rect(20,150,W-40,64,'#0a0d14');ctx.globalAlpha=0.5;
      ctx.strokeStyle='#2de2e6';ctx.strokeRect(20.5,150.5,W-41,63);ctx.globalAlpha=1;
      ctx.fillStyle='#e8ebf2';
      let s='GAME OVER';ctx.fillText(s,cx2-s.length*2.5,166);
      ctx.fillStyle='#ffd166';s=(SES.info?SES.info+'  ':'')+SES.score;ctx.fillText(s,cx2-s.length*2.5,182);
      ctx.fillStyle='#8b91a5';s='BEST '+SES.best;ctx.fillText(s,cx2-s.length*2.5,194);
      if(Math.floor(SES.t/45)%2===0){ctx.fillStyle='#2de2e6';s='ENTER · AGAIN';ctx.fillText(s,cx2-s.length*2.5,207);}
    }
  }

  // ---- canvas capture: E.record(seconds) downloads a .webm when done.
  //      ?record=N in the url auto-records N seconds from load.
  //      (realtime capture: keep the tab visible while it runs)
  let recBadge=null,recording=false;
  function record(seconds){
    recording=true;
    const stream=cv.captureStream(60);
    let opts={mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:8e6};
    if(!MediaRecorder.isTypeSupported(opts.mimeType))opts={mimeType:'video/webm'};
    const rec=new MediaRecorder(stream,opts),chunks=[];
    rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    rec.onstop=()=>{
      const b=new Blob(chunks,{type:'video/webm'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(b);
      a.download=document.title.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+seconds+'s.webm';
      a.click();
      recording=false;
      if(recBadge){recBadge.remove();recBadge=null;}
    };
    recBadge=document.createElement('div'); // DOM overlay: visible to you, not in the video
    recBadge.style.cssText='position:fixed;top:10px;right:12px;color:#fff;background:#c11c2a;'+
      'font:bold 12px monospace;padding:4px 8px;border-radius:3px;z-index:9';
    document.body.appendChild(recBadge);
    const t0=Date.now();
    const iv=setInterval(()=>{
      const left=seconds-(Date.now()-t0)/1000;
      if(recBadge)recBadge.textContent='REC '+Math.max(0,Math.ceil(left))+'s';
      if(left<=0){clearInterval(iv);rec.stop();}
    },250);
    rec.start(1000);
    return rec;
  }
  // ---- turbo capture: run the simulation flat-out, encode every frame with
  //      an explicit 60fps timestamp, and mux a normal-speed seekable video.
  //      Wall time is bounded by encode throughput, not the clip length.
  const now=()=>typeof performance!=='undefined'?performance.now():Date.now();
  const profile={enabled:params.has('profile'),stepMs:0,renderMs:0,frameMs:0,steps:0,renders:0,
    frames:0,queueWaits:0,maxQueue:0,started:Date.now()};
  function measure(k,fn,arg){if(!profile.enabled)return fn(arg);const t=now(),out=fn(arg),dt=now()-t;
    if(k==='step'){profile.stepMs+=dt;profile.steps++;}else{profile.renderMs+=dt;profile.renders++;}return out;}
  function profileReport(reset){const elapsed=Math.max(1,Date.now()-profile.started),out={
      elapsedMs:elapsed,steps:profile.steps,renders:profile.renders,frames:profile.frames,
      stepMs:+profile.stepMs.toFixed(2),renderMs:+profile.renderMs.toFixed(2),frameMs:+profile.frameMs.toFixed(2),
      avgStepMs:+(profile.stepMs/Math.max(1,profile.steps)).toFixed(4),
      avgRenderMs:+(profile.renderMs/Math.max(1,profile.renders)).toFixed(4),
      queueWaits:profile.queueWaits,maxQueue:profile.maxQueue,seed:rngSeed};
    if(reset)Object.assign(profile,{stepMs:0,renderMs:0,frameMs:0,steps:0,renders:0,frames:0,
      queueWaits:0,maxQueue:0,started:Date.now()});return out;}

  let loopHooks=null,turbo=false,externalPaused=false;
  if(preview&&typeof window!=='undefined'&&window.addEventListener)window.addEventListener('message',e=>{
    if(typeof location!=='undefined'&&e.origin!==location.origin)return;
    if(typeof parent!=='undefined'&&e.source!==parent)return;
    const d=e.data;if(d&&d.type==='sidequest:active')externalPaused=!d.active;
  });
  const paused=()=>!turbo&&(externalPaused||(typeof document!=='undefined'&&document.hidden===true));
  async function recordTurbo(seconds){
    if(!loopHooks||typeof VideoEncoder==='undefined'){record(seconds);return;}
    try{
      await new Promise((res,rej)=>{ // vendored muxer, loaded on demand
        if(typeof WebMMuxer!=='undefined')return res();
        const s=document.createElement('script');s.src='webm-muxer.min.js';
        s.onload=res;s.onerror=rej;document.head.appendChild(s);
      });
    }catch(e){record(seconds);return;}
    turbo=true;recording=true;
    const total=Math.round(seconds*60);
    const muxer=new WebMMuxer.Muxer({target:new WebMMuxer.ArrayBufferTarget(),
      video:{codec:'V_VP9',width:cv.width,height:cv.height,frameRate:60}});
    const enc=new VideoEncoder({
      output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),
      error:e=>console.error('turbo encode:',e)});
    const baseConfig={codec:'vp09.00.31.08',width:cv.width,height:cv.height,bitrate:6e6,framerate:60,
      alpha:'discard',latencyMode:'quality'};
    let encConfig={...baseConfig,hardwareAcceleration:'prefer-hardware'};
    try{const support=await VideoEncoder.isConfigSupported(encConfig);if(!support.supported)encConfig=baseConfig;}
    catch(e){encConfig=baseConfig;}
    enc.configure(encConfig);
    recBadge=document.createElement('div');
    recBadge.style.cssText='position:fixed;top:10px;right:12px;color:#fff;background:#7b2ff2;'+
      'font:bold 12px monospace;padding:4px 8px;border-radius:3px;z-index:9';
    document.body.appendChild(recBadge);
    const t0=Date.now();
    let i=0;
    await new Promise(res=>{
      const pump=(byTimer)=>{
        // occluded windows starve rAF without setting document.hidden, so
        // timer-driven ticks get a fat budget to keep near-full speed
        const budget=byTimer?180:13;
        const f0=performance.now();
        while(i<total&&performance.now()-f0<budget&&enc.encodeQueueSize<12){
          measure('step',loopHooks.step,i+1);
          measure('render',loopHooks.render,i+1);
          const ft=profile.enabled?now():0;
          const vf=new VideoFrame(cv,{timestamp:Math.round(i*1e6/60),duration:Math.round(1e6/60)});
          if(profile.enabled)profile.frameMs+=now()-ft;
          enc.encode(vf,{keyFrame:i%120===0});
          vf.close();
          i++;profile.frames++;profile.maxQueue=Math.max(profile.maxQueue,enc.encodeQueueSize);
        }
        if(i<total&&enc.encodeQueueSize>=12)profile.queueWaits++;
        if(recBadge)recBadge.textContent='TURBO '+Math.floor(i/60)+'/'+seconds+'s · '+
          ((i/60)/Math.max(0.1,(Date.now()-t0)/1000)).toFixed(1)+'x';
        if(i<total){ // race rAF against a watchdog timer; first one runs the next tick
          let done=false;
          const go=t=>{if(done)return;done=true;pump(t);};
          requestAnimationFrame(()=>go(false));
          setTimeout(()=>go(true),250);
        }else res();
      };
      pump(false);
    });
    await enc.flush();enc.close();
    muxer.finalize();
    const blob=new Blob([muxer.target.buffer],{type:'video/webm'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=document.title.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+seconds+'s.webm';
    a.click();
    if(recBadge){recBadge.remove();recBadge=null;}
    if(profile.enabled)console.info('SIDE/QUEST profile',profileReport());
    turbo=false;recording=false;
  }
  if(typeof location!=='undefined'&&typeof MediaRecorder!=='undefined'){
    const m=(location.search||'').match(/record=(\d+)/);
    if(m){
      const secs=Math.min(7200,+m[1]||60);
      const realtime=/[?&]speed=1(&|$)/.test(location.search);
      setTimeout(()=>realtime?record(secs):recordTurbo(secs),400);
    }
  }

  // ---- fixed 60Hz simulation regardless of display refresh rate
  function start(step,render,options){
    options=options||{};
    loopHooks={step,render};
    const preview=params.has('preview'),renderEvery=options.renderEvery||(preview?2:1);
    let last=0,acc=0,frame=0,lastRendered=-1;
    if(!options.headless){measure('render',render,0);lastRendered=0;}
    function tick(now){
      requestAnimationFrame(tick);
      if(turbo)return; // turbo capture drives the loop itself
      if(paused()){last=now;acc=0;return;}
      if(!last)last=now;
      acc+=Math.min(100,now-last);last=now;
      while(acc>=1000/60){acc-=1000/60;frame++;measure('step',step,frame);}
      // Rendering unchanged state on 120/144Hz displays doubles work for no
      // visual benefit. Gallery previews intentionally draw every other step.
      if(!options.headless&&frame!==lastRendered&&frame%renderEvery===0){measure('render',render,frame);lastRendered=frame;}
    }
    requestAnimationFrame(tick);
  }
  function runFrames(count,options){options=options||{};if(!loopHooks)return 0;
    const first=options.startFrame||0;for(let i=0;i<count;i++){
      const f=first+i+1;measure('step',loopHooks.step,f);
      if(options.render)measure('render',loopHooks.render,f);
    }return count;}

  return{cv,ctx,W,H,random,seedRandom,R,RI,hash,dist,clamp,rect,spawn,burst,dust,stepParts,drawParts,
    fxRandom,fxR,fxRI,fxBurst,fxDust,createShow,createEvidence,
    ring,stepRings,drawRings,shake,preDraw,postDraw,start,runFrames,keys,tap,manual,axis2,record,recordTurbo,
    profileReport,initSession,sessionStep,drawSession,playing,addScore,gameOver,
    sessionProbe:()=>({mode:SES.mode,t:SES.t,name:SES.name,viewer:SES.viewer})};
})();
