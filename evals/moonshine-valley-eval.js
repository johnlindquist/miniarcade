#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const vm=require('vm');
const{ROOT,inlineScript,bootGame}=require('./harness');
const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');

const FOOTER=`
globalThis.__mvApplied=[];
{const __mva0=applyIntent;applyIntent=intent=>{const out=__mva0(intent);
  globalThis.__mvApplied.push({frame:runFrame,keys:Object.keys(intent||{}).sort(),intent:{...(intent||{})}});
  if(globalThis.__mvApplied.length>300)globalThis.__mvApplied.shift();return out;};}
globalThis.__mvClearApplied=()=>{globalThis.__mvApplied.length=0;};
globalThis.__mvLastApplied=()=>globalThis.__mvApplied.at(-1)||null;
globalThis.__mvMotion=()=>[round(farmer.x,5),round(farmer.y,5),round(farmer.vx,5),round(farmer.vy,5)].join('|');
`;

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const sum=(items,fn)=>items.reduce((n,item)=>n+fn(item),0);
const INTENT_KEYS=['act','aimX','aimY','dx','dy','tactic','targetId'];
const sameKeys=keys=>JSON.stringify(keys)===JSON.stringify(INTENT_KEYS);
const validIntent=i=>i&&Number.isFinite(i.dx)&&Number.isFinite(i.dy)&&Number.isFinite(i.aimX)&&
  Number.isFinite(i.aimY)&&typeof i.act==='boolean'&&typeof i.targetId==='string'&&typeof i.tactic==='string';

// Ten fixed same-seed ten-minute pairs (0x4d5600 + i*137), measured
// 2026-07-10 after the seed-return farm loop was frozen. Smart observed:
// score 667..711, shipped 231..246, kills 68..75, crop hits 0..3,
// losses 0..1, perfect nights 9..10, events 1591..1676, progress
// 627..665. Reactive observed: score 596..622, shipped 225..253,
// kills 42..46, crop hits 0..7, losses 0..1, perfect nights 6..10,
// events 1314..1441, progress 585..655. Bands add measured margin on
// both sides while keeping both policies watchable.
const SMART_BANDS={
  farmScore:[640,735],objectives:[10,10],shipped:[215,265],kills:[62,82],
  cropHits:[0,7],cropLosses:[0,2],breaches:[0,1],nightsHeld:[10,10],
  perfectNights:[8,10],lastSecondSaves:[0,6],lapses:[0,10],events:[1500,1780],
  progress:[590,720],acts:[100,100],dawns:[10,10],maxEventLull:[0,450],
  maxProgressLull:[0,800]
};
const REACTIVE_BANDS={
  farmScore:[570,650],objectives:[10,10],shipped:[210,270],kills:[38,52],
  cropHits:[0,11],cropLosses:[0,3],breaches:[0,1],nightsHeld:[10,10],
  perfectNights:[4,10],lastSecondSaves:[0,10],lapses:[0,10],events:[1220,1530],
  progress:[540,710],acts:[100,100],dawns:[10,10],maxEventLull:[0,420],
  maxProgressLull:[0,1100]
};
const farmScore=s=>s.objectives*20+s.shipped+s.kills*3+s.perfectNights*4+
  s.lastSecondSaves*2-s.cropLosses*10-s.breaches*12;
function bandValue(p,key){
  if(key==='farmScore')return farmScore(p.stats);
  if(Object.prototype.hasOwnProperty.call(p.stats,key))return p.stats[key];
  return p[key];
}
function inBands(p,bands,label){
  for(const[key,[lo,hi]]of Object.entries(bands)){
    const value=bandValue(p,key);
    if(!Number.isFinite(value)||value<lo||value>hi)
      fail(`${label}: ${key} ${value} outside measured band ${lo}..${hi}`);
  }
}
function checkNightPairs(p,label,count){
  const notes=p.actNotes.filter(n=>n.id==='night');
  const warnings=notes.filter(n=>n.kind==='act-warning');
  const lands=notes.filter(n=>n.kind==='act-land');
  if(warnings.length!==count||lands.length!==count)
    fail(`${label}: night act emitted ${warnings.length} warnings / ${lands.length} lands, expected ${count}/${count}`);
  for(let i=0;i<Math.min(warnings.length,lands.length);i++){
    if(lands[i].at-warnings[i].at!==240||warnings[i].landsAt!==lands[i].at||lands[i].tag!==warnings[i].tag)
      fail(`${label}: night ${i+1} warning/land pair was not an exact 240-frame day pair`);
  }
}

console.log('1) source syntax, finite boot, deterministic replay, render parity, and batching');
{
  const source=inlineScript(fs.readFileSync(path.join(ROOT,'moonshine-valley.html'),'utf8'));
  try{new vm.Script(source,{filename:'moonshine-valley.inline.js'});}catch(error){fail(`inline script syntax error: ${error.message}`);}
  const a=bootGame('moonshine-valley',{seed:0x4d5101,footer:FOOTER});
  const b=bootGame('moonshine-valley',{seed:0x4d5101,footer:FOOTER});
  const rendered=bootGame('moonshine-valley',{seed:0x4d5101,footer:FOOTER});
  a.frames(7200,false);b.frames(7200,false);rendered.frames(7200,true);
  const sa=a.sandbox.__moonshineValleySignature(),sb=b.sandbox.__moonshineValleySignature(),
    sr=rendered.sandbox.__moonshineValleySignature(),p=a.sandbox.__moonshineValleyProbe();
  console.log(`  headless ${sa===sb?'identical':'DIFFERENT'}; rendered ${sa===sr?'identical':'DIFFERENT'}; ${rendered.counter.calls} canvas calls on final frame`);
  if(sa!==sb)fail('same seed diverged under identical fixed 60 Hz headless steps');
  if(sa!==sr)fail('render traversal changed simulation state or RNG');
  if(!p.finite)fail('fixed-step replay ended with non-finite farm state');
  if(rendered.counter.calls<=0)fail('render parity run did not traverse the renderer');

  const mono=bootGame('moonshine-valley',{seed:0x4d5102,footer:FOOTER});
  const chunked=bootGame('moonshine-valley',{seed:0x4d5102,footer:FOOTER});
  mono.frames(18000,false);for(let i=0;i<1800;i++)chunked.frames(10,false);
  const same=mono.sandbox.__moonshineValleySignature()===chunked.sandbox.__moonshineValleySignature();
  console.log(`  18,000 monolithic frames vs 1,800 x 10: ${same?'identical':'DIFFERENT'}`);
  if(!same)fail('headless batching changed the deterministic fixed-step result');
}

console.log('2) human and bot share one seven-field intent schema and applyIntent path');
{
  const game=bootGame('moonshine-valley',{seed:0x4d5110,footer:FOOTER});
  const schemas=game.sandbox.__moonshineValleyIntentSchemas();
  game.frames(3,false);const botApplied=game.sandbox.__mvLastApplied();
  console.log(`  schema human ${schemas.humanKeys.join(',')} / bot ${schemas.botKeys.join(',')}; bot ${botApplied&&botApplied.intent.tactic}`);
  if(!sameKeys(schemas.humanKeys)||!sameKeys(schemas.botKeys)||!validIntent(schemas.human)||!validIntent(schemas.bot))
    fail(`controller intent schemas differ or contain invalid fields: ${JSON.stringify(schemas)}`);
  if(!botApplied||!sameKeys(botApplied.keys)||!validIntent(botApplied.intent)||botApplied.intent.tactic==='MANUAL FARMHAND')
    fail('autoplay controller did not traverse common applyIntent');

  press(game,'Enter');if(game.sandbox.__moonshineValleyProbe().playing)fail('first Enter skipped the instructions gate');
  press(game,'Enter');if(!game.sandbox.__moonshineValleyProbe().playing)fail('second Enter did not enter manual play');
  game.sandbox.__mvClearApplied();
  game.key('keydown','ArrowLeft');game.key('keydown','ArrowUp');game.key('keydown','Space');game.frames(2,false);
  game.key('keyup','ArrowLeft');game.key('keyup','ArrowUp');game.key('keyup','Space');
  const humanApplied=game.sandbox.__mvLastApplied(),p=game.sandbox.__moonshineValleyProbe();
  console.log(`  manual dx/dy ${humanApplied&&humanApplied.intent.dx}/${humanApplied&&humanApplied.intent.dy}; act ${humanApplied&&humanApplied.intent.act}; applied ${p.stats.appliedIntents}`);
  if(!humanApplied||!sameKeys(humanApplied.keys)||!validIntent(humanApplied.intent)||
    humanApplied.intent.tactic!=='MANUAL FARMHAND'||humanApplied.intent.dx!==-1||humanApplied.intent.dy!==-1||!humanApplied.intent.act)
    fail('manual move/action fields bypassed or changed before common applyIntent');
  if(p.stats.appliedIntents<3)fail('shared applyIntent counter did not include the manual frames');
}

console.log('3) night planner is non-vacuous, pure, repeatable, finite, and engine-RNG-free');
{
  const game=bootGame('moonshine-valley',{seed:0x4d5120,footer:FOOTER});
  const fixture=game.sandbox.__moonshineValleyPlannerFixture();
  const forecast=fixture.forecast;
  console.log(`  pure ${fixture.pure}; repeat ${fixture.repeat}; threat ${forecast&&forecast.id}; ETA ${forecast&&forecast.remaining.toFixed(1)}f`);
  if(!fixture.pure||!fixture.repeat||!fixture.finite||!forecast)
    fail(`night planner fixture regressed: ${JSON.stringify(fixture)}`);
  if(!Number.isFinite(forecast.remaining)||!Number.isFinite(forecast.shotFrames)||
    !Number.isFinite(forecast.urgency)||!Number.isFinite(forecast.aim.x)||!Number.isFinite(forecast.aim.y)||
    !Number.isFinite(forecast.intercept.x)||!Number.isFinite(forecast.intercept.y))
    fail('night planner produced a non-finite threat forecast');

  const control=bootGame('moonshine-valley',{seed:0x4d5121,footer:FOOTER});
  const planned=bootGame('moonshine-valley',{seed:0x4d5121,footer:FOOTER});
  planned.sandbox.__moonshineValleyPlannerFixture();
  const rp=planned.sandbox.__moonshineValleyNextRandom(),rc=control.sandbox.__moonshineValleyNextRandom();
  console.log(`  next engine RNG after planning ${rp.toFixed(8)} vs control ${rc.toFixed(8)}`);
  if(rp!==rc)fail('night planning consumed engine RNG for simulation-invisible work');
}

console.log('4) ten-seed night-plan A/B: combined farm score and both measured policy bands');
const pairedSmart=[],pairedReactive=[];
{
  let wins=0;
  for(let i=0;i<10;i++){
    const seed=0x4d5600+i*137;
    const smart=bootGame('moonshine-valley',{seed,footer:FOOTER});
    const reactive=bootGame('moonshine-valley',{seed,footer:FOOTER});reactive.sandbox.__NO_NIGHT_PLAN=1;
    smart.frames(36000,false);reactive.frames(36000,false);
    const ps=smart.sandbox.__moonshineValleyProbe(),pr=reactive.sandbox.__moonshineValleyProbe();
    pairedSmart.push(ps);pairedReactive.push(pr);
    const ss=farmScore(ps.stats),rs=farmScore(pr.stats);if(ss>rs)wins++;
    console.log(`  ${seed.toString(16)} ${ps.persona.padEnd(10)} smart ${ss} vs reactive ${rs}; kills ${ps.stats.kills}/${pr.stats.kills}, crop hits ${ps.stats.cropHits}/${pr.stats.cropHits}`);
    if(!ps.finite||!pr.finite)fail(`${seed.toString(16)}: a night-policy run ended non-finite`);
    inBands(ps,SMART_BANDS,`${seed.toString(16)} smart`);
    inBands(pr,REACTIVE_BANDS,`${seed.toString(16)} reactive`);
    checkNightPairs(ps,`${seed.toString(16)} smart`,10);
    checkNightPairs(pr,`${seed.toString(16)} reactive`,10);
  }
  const smartTotal=sum(pairedSmart,p=>farmScore(p.stats));
  const reactiveTotal=sum(pairedReactive,p=>farmScore(p.stats));
  const gain=smartTotal/reactiveTotal-1;
  const smartKills=sum(pairedSmart,p=>p.stats.kills),reactiveKills=sum(pairedReactive,p=>p.stats.kills);
  console.log(`  ${wins}/10 score wins; aggregate ${smartTotal} vs ${reactiveTotal} (+${(gain*100).toFixed(1)}%); kills ${smartKills}/${reactiveKills}`);
  if(wins!==10)fail(`night planner won the combined farm score on only ${wins}/10 paired seeds`);
  if(gain<.10)fail(`night planner aggregate farm-score gain ${(gain*100).toFixed(1)}% is below 10%`);
  if(smartKills<reactiveKills*1.45)fail('night planner lost its measured crop-defense advantage');
}

console.log('5) dusk act: exact warning, pre-land physical divergence, and clean reset');
{
  const active=bootGame('moonshine-valley',{seed:0x4d5130,footer:FOOTER});
  const ablated=bootGame('moonshine-valley',{seed:0x4d5130,footer:FOOTER});
  active.sandbox.__moonshineValleyActFixture();ablated.sandbox.__moonshineValleyActFixture();
  ablated.sandbox.__NO_ACTS=1;
  let first=-1,phase='';
  for(let frame=1;frame<=240;frame++){
    active.frames(1,false);ablated.frames(1,false);
    if(first<0&&active.sandbox.__mvMotion()!==ablated.sandbox.__mvMotion()){
      first=frame;phase=active.sandbox.__moonshineValleyProbe().actPhase;break;
    }
  }
  active.frames(330-Math.max(first,0),false);ablated.frames(330-Math.max(first,0),false);
  const pa=active.sandbox.__moonshineValleyProbe(),pb=ablated.sandbox.__moonshineValleyProbe();
  const warning=pa.actNotes.find(n=>n.kind==='act-warning'&&n.id==='night');
  const land=pa.actNotes.find(n=>n.kind==='act-land'&&n.id==='night');
  console.log(`  first motion divergence f${first} in ${phase}; warning lead ${warning&&land?land.at-warning.at:'missing'}f`);
  if(!warning||!land||land.at-warning.at!==240||warning.landsAt!==land.at)
    fail('night act did not preserve its exact 240-frame warning');
  if(first<1||first>240||phase!=='warn')fail('night act did not physically change the bot during the warning');
  if(pb.actNotes.some(n=>n.kind==='act-warning'||n.kind==='act-land'))fail('__NO_ACTS still emitted dusk/night act notes');

  const reset=bootGame('moonshine-valley',{seed:0x4d5131,footer:FOOTER});
  reset.sandbox.__moonshineValleyActFixture();reset.frames(80,false);
  const before=reset.sandbox.__moonshineValleyProbe();press(reset,'Enter');press(reset,'Enter');
  const fresh=reset.sandbox.__moonshineValleyProbe();reset.frames(400,false);
  const after=reset.sandbox.__moonshineValleyProbe(),stale=after.actNotes.filter(n=>n.kind==='act-land').length;
  console.log(`  reset during warning: ${before.actPhase}->${fresh.actPhase}; stale lands ${stale}`);
  if(before.actPhase!=='warn'||fresh.actPhase!=='day'||fresh.actNotes.length||stale||!after.playing||!after.finite)
    fail('session reset leaked a canceled night landing');
}

console.log('6) strict payoff ladder, exact apex budgets, and __NO_ADMIRE gate');
{
  const game=bootGame('moonshine-valley',{seed:0x4d5600,footer:FOOTER});game.frames(36060,false);
  const p=game.sandbox.__moonshineValleyProbe(),show=p.show,o=show.offeredByTier,s=show.shownByTier,
    s3=s[3]||0,admire=game.sandbox.__moonshineValleyAdmireFixture();
  console.log(`  tiers ${JSON.stringify(o)} shown ${JSON.stringify(s)}; budgets ${show.heldFrames}/${show.slowedFrames}/${show.admireFrames}`);
  if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=1))
    fail(`offered payoff ladder is not strictly ordered: ${JSON.stringify(o)}`);
  if(!((s[1]||0)>(s[2]||0)&&(s[2]||0)>(s[3]||0)&&(s[3]||0)>=1))
    fail(`shown payoff ladder is not strictly ordered: ${JSON.stringify(s)}`);
  if(s3!==10)fail(`ten-minute arc showed ${s3} dawn apexes instead of 10`);
  if(show.heldFrames!==6*s3)fail(`apex hitstop ${show.heldFrames} != 6*${s3}`);
  if(show.slowedFrames!==24*s3)fail(`apex slow-mo ${show.slowedFrames} != 24*${s3}`);
  if(show.admireFrames!==48*s3)fail(`apex admire ${show.admireFrames} != 48*${s3}`);
  if(p.stats.heldFrames!==show.heldFrames||p.stats.slowedFrames!==show.slowedFrames||p.stats.admireFrames!==show.admireFrames)
    fail('game-applied show budgets disagree with the kernel probe');
  if(admire.admired.tactic!=='WATCH THE SUNRISE'||admire.admired.dx!==0||admire.admired.dy!==0||admire.admired.act||
    admire.gated.tactic==='WATCH THE SUNRISE')
    fail(`__NO_ADMIRE did not gate only the bot sunrise pause: ${JSON.stringify(admire)}`);
}

console.log('7) payoff FX is an exact same-seed simulation no-op');
{
  const on=bootGame('moonshine-valley',{seed:0x4d5140,footer:FOOTER});
  const off=bootGame('moonshine-valley',{seed:0x4d5140,footer:FOOTER});off.sandbox.__NO_PAYOFF_FX=1;
  on.frames(18000,false);off.frames(18000,false);
  const p=on.sandbox.__moonshineValleyProbe(),same=on.sandbox.__moonshineValleySignature()===off.sandbox.__moonshineValleySignature();
  console.log(`  signatures ${same?'identical':'DIFFERENT'} after ${p.stats.harvests} harvests, ${p.stats.kills} kills, ${p.stats.dawns} dawns`);
  if(!same)fail('__NO_PAYOFF_FX changed farm, combat, objective, or RNG state');
  if(p.stats.harvests<80||p.stats.kills<25||p.stats.dawns<4)fail('payoff-FX parity proof did not exercise enough visible payoffs');
}

console.log('8) skill-profile imperfection has a measured normal band and exact ablation');
{
  const lapses=pairedSmart.map(p=>p.stats.lapses),total=sum(lapses,n=>n),active=lapses.filter(n=>n>0).length;
  console.log(`  normal ten-seed lapses ${lapses.join(',')} = ${total}; active seeds ${active}/10`);
  if(total<20||total>60||active<7||lapses.some(n=>n<0||n>10))
    fail(`normal lapse distribution left measured band: ${JSON.stringify(lapses)}`);
  const perfect=bootGame('moonshine-valley',{seed:0x4d5600,footer:FOOTER});perfect.sandbox.__NO_LAPSE=1;
  perfect.frames(36000,false);const p=perfect.sandbox.__moonshineValleyProbe();
  console.log(`  __NO_LAPSE: ${p.stats.lapses} lapses, ${p.stats.objectives} objectives, ${p.stats.shipped} shipped, ${p.stats.kills} kills`);
  if(p.stats.lapses!==0||!p.finite||p.stats.objectives!==10||p.stats.shipped<170||p.stats.kills<76||p.stats.perfectNights!==10)
    fail('__NO_LAPSE did not cleanly restore finite, competent perfect play');
}

console.log('9) shared ten-minute soak: moving, happening, and progressing');
{
  const{samples}=runSoak('moonshine-valley',{seed:0x4d5600,minutes:10});
  const report=analyzeSoak(samples);console.log('  '+soakLine(report));
  assertSoak('moonshine-valley soak',report,{still:2,quiet:9,stall:18,minEvents:1400,minProgress:540},fail);
}

console.log(failed?'\nMOONSHINE VALLEY EVAL FAILED':'\nMOONSHINE VALLEY EVAL PASSED');
process.exit(failed?1:0);
