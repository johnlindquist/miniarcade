#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');

const FOOTER=`
const __baseMatrix=()=>Array.from({length:ROWS},(_,r)=>
  Array.from({length:COLS},(_,c)=>(r*2+c)%5));
const __setMatrix=matrix=>{
  board=matrix.map(row=>row.map(value=>typeof value==='number'?makeRune(value):
    makeRune(value.type,value.special)));
  phase='idle';phaseT=0;pending=null;activeClear=new Set();cascade=0;
  selected=null;hint=null;hintT=0;lastSwap=null;
};
const __signature=()=>board.map(row=>row.map(tile=>tile?tile.type+':'+tile.special:'x').join(',')).join('|');
const __boardReport=()=>{
  const flat=board.flat(),moves=validMoves(),groups=findMatches();
  return{rows:board.length,rowWidths:board.map(row=>row.length),tiles:flat.length,
    full:flat.every(Boolean),typesValid:flat.every(tile=>tile&&tile.type>=RED&&tile.type<=VIOLET),
    initialSpecials:flat.filter(tile=>tile&&tile.special!==NONE).length,
    unresolvedMatches:groups.length,validMoves:moves.length,
    adjacentMoves:moves.every(move=>adjacent(move.a,move.b)),
    moveBounds:moves.every(move=>inside(move.a.r,move.a.c)&&inside(move.b.r,move.b.c))};
};
globalThis.__seedSweep=count=>{
  const failures=[];let minMoves=Infinity,maxMoves=0;
  for(let i=0;i<count;i++){
    resetGame();const report=__boardReport();minMoves=Math.min(minMoves,report.validMoves);maxMoves=Math.max(maxMoves,report.validMoves);
    if(report.rows!==ROWS||report.rowWidths.some(width=>width!==COLS)||report.tiles!==ROWS*COLS||
      !report.full||!report.typesValid||report.initialSpecials!==0||report.unresolvedMatches!==0||
      report.validMoves<1||!report.adjacentMoves||!report.moveBounds)failures.push({i,report});
  }
  return{count,failures,minMoves,maxMoves,last:__boardReport()};
};
globalThis.__invalidSwapFixture=()=>{
  resetGame();const legal=new Set(validMoves().map(move=>keyOf(move.a.r,move.a.c)+'>'+keyOf(move.b.r,move.b.c)));
  let pair=null;for(let r=0;r<ROWS&&!pair;r++)for(let c=0;c<COLS&&!pair;c++)for(const d of[[0,1],[1,0]]){
    const b={r:r+d[0],c:c+d[1]},a={r,c};if(inside(b.r,b.c)&&!legal.has(keyOf(r,c)+'>'+keyOf(b.r,b.c))){pair={a,b};break;}}
  const a=pair&&pair.a,b=pair&&pair.b,before=__signature(),preMatches=findMatches().length;
  const accepted=!!pair&&trySwap(a,b),during=__signature();let steps=0;
  while(phase!=='idle'&&steps++<80)updateBoard();
  return{hadInvalid:!!pair,accepted,preMatches,duringChanged:during!==before,reverted:__signature()===before,
    phase,steps,stable:findMatches().length===0,validMoves:validMoves().length};
};
globalThis.__validSwapFixture=()=>{
  resetGame();const move=validMoves()[0],beforePower=powers.reduce((sum,n)=>sum+n,0),beforeMatches=totalMatches;
  const accepted=!!move&&trySwap(move.a,move.b);let steps=0,peakCascade=0;
  while(phase!=='idle'&&steps++<600){updateBoard();peakCascade=Math.max(peakCascade,cascade);}
  return{hadMove:!!move,accepted,steps,phase,peakCascade,matches:totalMatches-beforeMatches,
    powerGain:powers.reduce((sum,n)=>sum+n,0)-beforePower,stable:findMatches().length===0,
    validMoves:validMoves().length,full:board.flat().every(Boolean)};
};

const __h4Cells=[0,1,2,3].map(c=>({r:2,c}));
const __v4Cells=[0,1,2,3].map(r=>({r,c:2}));
const __h5Cells=[0,1,2,3,4].map(c=>({r:2,c}));
const __crossH=[{r:2,c:1},{r:2,c:2},{r:2,c:3}],__crossV=[{r:1,c:2},{r:2,c:2},{r:3,c:2}];
const __groups=()=>({
  row:{type:RED,cells:__h4Cells,dirs:new Set(['h']),runs:[{dir:'h',cells:__h4Cells}]},
  col:{type:GOLD,cells:__v4Cells,dirs:new Set(['v']),runs:[{dir:'v',cells:__v4Cells}]},
  color:{type:BLUE,cells:__h5Cells,dirs:new Set(['h']),runs:[{dir:'h',cells:__h5Cells}]},
  nova:{type:GREEN,cells:[...__crossH,...__crossV.filter(p=>p.r!==2)],dirs:new Set(['h','v']),
    runs:[{dir:'h',cells:__crossH},{dir:'v',cells:__crossV}]}
});
const __forge=group=>{
  __setMatrix(__baseMatrix());for(const p of group.cells)board[p.r][p.c]=makeRune(group.type);
  cascade=1;const before=specialsMade;startClear([group]);
  const kept=[...pending.keep.entries()].map(([key,tile])=>({key,type:tile.type,special:tile.special}));
  return{classification:classifyGroup(group),made:specialsMade-before,kept,clear:activeClear.size};
};
const __expand=special=>{
  __setMatrix(__baseMatrix());powers=[0,0,0,0,0];matchCounts=[0,0,0,0,0];totalMatches=0;
  const r=3,c=2;board[r][c]=makeRune(RED,special);cascade=1;const set=new Set([keyOf(r,c)]);expandSpecials(set);
  return{size:set.size,power:powers[RED],matches:totalMatches,keys:[...set].sort((a,b)=>a-b)};
};
const __anchorChain=()=>{
  const from={r:1,c:1},anchor={r:2,c:1};__setMatrix(__baseMatrix());
  board[2][0]=makeRune(RED);board[2][1]=makeRune(GOLD);board[2][2]=makeRune(RED);board[2][3]=makeRune(RED);
  board[from.r][from.c]=makeRune(RED,ROW);powers=[0,0,0,0,0];matchCounts=[0,0,0,0,0];totalMatches=0;
  const stableBefore=findMatches().length===0,accepted=trySwap(from,anchor);let steps=0;while(phase==='swap'&&steps++<20)updateBoard();
  const kept=board[anchor.r][anchor.c],expected=[];for(let c=0;c<COLS;c++)if(c!==anchor.c)expected.push(keyOf(anchor.r,c));
  return{stableBefore,accepted,steps,phase,clear:activeClear.size,fullRow:expected.every(key=>activeClear.has(key)),anchorClear:activeClear.has(keyOf(anchor.r,anchor.c)),
    keptType:kept.type,keptSpecial:kept.special,power:powers[RED],matches:totalMatches};
};
globalThis.__specialFixture=()=>{
  resetGame();const groups=__groups(),row=__forge(groups.row),col=__forge(groups.col),
    color=__forge(groups.color),nova=__forge(groups.nova);
  const rowBlast=__expand(ROW),colBlast=__expand(COL),novaBlast=__expand(NOVA),anchorChain=__anchorChain();
  __setMatrix(__baseMatrix());powers=[0,0,0,0,0];matchCounts=[0,0,0,0,0];totalMatches=0;
  board[0][0]=makeRune(PRISM,COLOR);board[0][1]=makeRune(GOLD);
  const targetKeys=[];for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)if(board[r][c].type===GOLD)targetKeys.push(keyOf(r,c));
  const prismAccepted=trySwap({r:0,c:0},{r:0,c:1});let prismSteps=0;
  while(phase==='swap'&&prismSteps++<20)updateBoard();
  const prism={accepted:prismAccepted,phase,clear:activeClear.size,targetCount:targetKeys.length,
    missedTargets:targetKeys.filter(key=>!activeClear.has(key)).length,
    includesBoth:activeClear.has(keyOf(0,0))&&activeClear.has(keyOf(0,1)),goldPower:powers[GOLD]};
  return{row,col,color,nova,rowBlast,colBlast,novaBlast,anchorChain,prism};
};

const __dummy=(x,y)=>({kind:'ghoul',x,y,vx:0,vy:0,hp:100,maxHp:100,sp:0,r:5,dmg:0,hit:0,orbCd:0,t:0,dead:false});
const __hpTotal=()=>enemies.reduce((sum,enemy)=>sum+enemy.hp,0);
globalThis.__powerFixture=()=>{
  resetGame();enemies=[];bolts=[];powers=[0,0,0,0,0];matchCounts=[0,0,0,0,0];totalMatches=0;
  awardMatch(RED,3,1,false);const red1={power:powers[RED],bolts:bolts.length,damage:bolts[0]&&bolts[0].dmg};
  bolts=[];awardMatch(RED,3,1,false);const red2={power:powers[RED],bolts:bolts.length,damage:bolts[0]&&bolts[0].dmg};

  resetGame();powers=[0,0,0,0,0];matchCounts=[0,0,0,0,0];totalMatches=0;enemies=[__dummy(68,100),__dummy(92,100),__dummy(80,122)];links=[];
  let before=__hpTotal();awardMatch(GOLD,3,1,false);const gold1={power:powers[GOLD],damage:before-__hpTotal(),links:links.length,
    delay:attackDelay()};
  enemies=[__dummy(68,100),__dummy(92,100),__dummy(80,122)];links=[];before=__hpTotal();awardMatch(GOLD,3,1,false);
  const gold2={power:powers[GOLD],damage:before-__hpTotal(),links:links.length,delay:attackDelay()};

  resetGame();powers=[0,0,0,0,0];matchCounts=[0,0,0,0,0];totalMatches=0;P.shield=0;
  awardMatch(BLUE,3,1,false);const blue1={power:powers[BLUE],shield:P.shield};awardMatch(BLUE,3,1,false);
  const blue2={power:powers[BLUE],shield:P.shield,armor:wardArmor()};

  resetGame();powers=[0,0,0,0,0];matchCounts=[0,0,0,0,0];totalMatches=0;P.hp=2;
  awardMatch(GREEN,3,1,false);const green1={power:powers[GREEN],hp:P.hp,maxHp:P.maxHp};awardMatch(GREEN,3,1,false);
  const green2={power:powers[GREEN],hp:P.hp,maxHp:P.maxHp};

  resetGame();powers=[0,0,0,0,0];matchCounts=[0,0,0,0,0];totalMatches=0;enemies=[__dummy(72,103),__dummy(88,103)];
  before=__hpTotal();awardMatch(VIOLET,3,1,false);const violet1={power:powers[VIOLET],damage:before-__hpTotal()};
  enemies=[__dummy(72,103),__dummy(88,103)];before=__hpTotal();awardMatch(VIOLET,3,1,false);
  const violet2={power:powers[VIOLET],damage:before-__hpTotal(),orbits:orbitCount()};
  return{red1,red2,gold1,gold2,blue1,blue2,green1,green2,violet1,violet2};
};

let __autoStats=null;
const __autoSnapshot=reason=>({reason,elapsed,kills,totalMatches,bestCascade,specialsMade,
  powerSum:powers.reduce((sum,n)=>sum+n,0),powers:powers.slice(),hp:P.hp,maxHp:P.maxHp});
globalThis.__enableAutoStats=()=>{
  if(__autoStats)return __autoStats;
  __autoStats={runs:[],resets:0,deaths:0,dawns:0,totalKills:0,totalAwards:0,totalSpecials:0,chains:0,
    powerRegressions:0,maxPowerSum:0,maxPowers:[0,0,0,0,0],maxCascade:0,maxEnemies:0,minHp:P.hp,finite:true};
  const reset0=resetGame;resetGame=function(){
    if(frame>0){const reason=dead?'death':elapsed>=RUN_FRAMES?'dawn':'other';__autoStats.runs.push(__autoSnapshot(reason));
      if(reason==='death')__autoStats.deaths++;if(reason==='dawn')__autoStats.dawns++;}
    __autoStats.resets++;return reset0();
  };
  const kill0=killEnemy;killEnemy=function(enemy){const alive=!enemy.dead,out=kill0(enemy);if(alive&&enemy.dead)__autoStats.totalKills++;return out;};
  const award0=awardMatch;awardMatch=function(type,size,chain,fromSpecial){const before=powers.slice(),out=award0(type,size,chain,fromSpecial);
    __autoStats.totalAwards++;if(powers.some((value,i)=>value<before[i]))__autoStats.powerRegressions++;
    __autoStats.maxPowerSum=Math.max(__autoStats.maxPowerSum,powers.reduce((sum,n)=>sum+n,0));
    powers.forEach((value,i)=>{__autoStats.maxPowers[i]=Math.max(__autoStats.maxPowers[i],value);});return out;};
  const clear0=startClear;startClear=function(groups,custom){const before=specialsMade;
    if(cascade>=2)__autoStats.chains++;
    const out=clear0(groups,custom);
    __autoStats.totalSpecials+=Math.max(0,specialsMade-before);return out;};
  const step0=step;step=function(){const out=step0();__autoStats.maxPowerSum=Math.max(__autoStats.maxPowerSum,powers.reduce((sum,n)=>sum+n,0));
    __autoStats.maxCascade=Math.max(__autoStats.maxCascade,bestCascade,cascade);__autoStats.maxEnemies=Math.max(__autoStats.maxEnemies,enemies.length);
    __autoStats.minHp=Math.min(__autoStats.minHp,P.hp);
    if(frame%60===0){const actors=[P,...enemies,...bolts,...links];if(!actors.every(actor=>Object.values(actor).every(value=>typeof value!=='number'||Number.isFinite(value))))__autoStats.finite=false;}
    return out;};
  return __autoStats;
};
globalThis.__autoProbe=()=>({...__autoStats,current:{elapsed,kills,totalMatches,bestCascade,specialsMade,
  powerSum:powers.reduce((sum,n)=>sum+n,0),powers:powers.slice(),hp:P.hp,maxHp:P.maxHp,dead},
  allRuns:[...__autoStats.runs,__autoSnapshot('current')]});

let __paceStats=null;
globalThis.__enablePacing=()=>{
  if(__paceStats)return __paceStats;
  __paceStats={firstThreat:null,early:[],mid:[],late:[]};
  const hurt0=hurtPlayer;hurtPlayer=function(n){if(__paceStats.firstThreat===null)__paceStats.firstThreat=elapsed;return hurt0(n);};
  const step0=step;step=function(){const out=step0();
    const phase=elapsed<=900?'early':elapsed>=2701&&elapsed<=3600?'mid':elapsed>=6301&&elapsed<=7199?'late':null;
    if(phase){const near=enemies.reduce((n,e)=>n+(Math.hypot(e.x-P.x,e.y-P.y)<48?1:0),0);
      __paceStats[phase].push({active:enemies.length,near,far:enemies.length-near,kills,zoom:cameraZoom,
        level:overallLevel(),power:totalPower()});}
    return out;};
  return __paceStats;
};
const __summarizePace=samples=>{
  const avg=key=>samples.reduce((sum,s)=>sum+s[key],0)/Math.max(1,samples.length);
  const sorted=key=>samples.map(s=>s[key]).sort((a,b)=>a-b),percentile=(key,q)=>{const a=sorted(key);return a[Math.min(a.length-1,Math.floor(a.length*q))]||0;};
  return{frames:samples.length,activeAvg:avg('active'),activeP90:percentile('active',.9),activeMax:percentile('active',1),
    nearAvg:avg('near'),nearMax:percentile('near',1),farAvg:avg('far'),zoomAvg:avg('zoom'),levelAvg:avg('level'),powerAvg:avg('power'),
    kills:samples.length?samples.at(-1).kills-samples[0].kills:0};
};
globalThis.__paceProbe=()=>({firstThreat:__paceStats.firstThreat,early:__summarizePace(__paceStats.early),
  mid:__summarizePace(__paceStats.mid),late:__summarizePace(__paceStats.late)});
globalThis.__crowdState=()=>{const distances=enemies.map(e=>Math.hypot(e.x-P.x,e.y-P.y));return{
  active:enemies.length,within10:distances.filter(d=>d<10).length,within42:distances.filter(d=>d<42).length,
  far:distances.filter(d=>d>=48).length,min:distances.length?Math.min(...distances):Infinity,zoom:cameraZoom,level:overallLevel()};};

globalThis.__manualState=()=>({playing:playing(),cursor:{...cursor},selected:selected&&{...selected},
  hint:hint&&{a:{...hint.a},b:{...hint.b}},hintT,phase,lastSwap:lastSwap&&{a:{...lastSwap.a},b:{...lastSwap.b}},
  validMoves:validMoves().length});
`;

let failed=false;
const fail=message=>{console.error('  FAIL:',message);failed=true;};
const press=(game,code)=>{game.key('keydown',code);game.frames(1,false);game.key('keyup',code);};
const approxGreater=(next,previous)=>Number.isFinite(next)&&Number.isFinite(previous)&&next>previous+1e-9;

console.log('1) board generation: full, stable, and playable across 200 boards');
let game=bootGame('hexcascade',{seed:0x7ec000,footer:FOOTER});
const sweep=game.sandbox.__seedSweep(200);
console.log(`  ${sweep.count} boards, legal moves ${sweep.minMoves}..${sweep.maxMoves}, ${sweep.failures.length} invariant failures`);
if(sweep.failures.length)fail(`generated board invariant failed: ${JSON.stringify(sweep.failures[0])}`);

console.log('2) swaps: invalid moves animate back; valid moves resolve to a stable powered board');
const invalid=game.sandbox.__invalidSwapFixture(),valid=game.sandbox.__validSwapFixture();
console.log(`  invalid reverted ${invalid.reverted} in ${invalid.steps} ticks; valid resolved ${valid.matches} match(es), +${valid.powerGain} power in ${valid.steps} ticks`);
if(!invalid.hadInvalid||invalid.preMatches!==0||invalid.accepted||!invalid.duringChanged||!invalid.reverted||invalid.phase!=='idle'||!invalid.stable)
  fail(`invalid swap contract regressed: ${JSON.stringify(invalid)}`);
if(!valid.hadMove||!valid.accepted||valid.phase!=='idle'||valid.matches<1||valid.powerGain<1||!valid.stable||valid.validMoves<1||!valid.full)
  fail(`valid swap did not fully resolve: ${JSON.stringify(valid)}`);

console.log('3) Candy-Crush specials: stripe, nova, prism creation and blast footprints');
const specials=game.sandbox.__specialFixture();
const forged=[['row',specials.row,1,0],['col',specials.col,2,1],['color',specials.color,4,-1],['nova',specials.nova,3,3]];
for(const[name,result,kind,type]of forged){
  const kept=result.kept[0];console.log(`  ${name.padEnd(5)} class ${result.classification}, kept ${kept&&kept.type}:${kept&&kept.special}, clear ${result.clear}`);
  if(result.classification!==kind||result.made!==1||result.kept.length!==1||!kept||kept.special!==kind||kept.type!==type)
    fail(`${name} special forging regressed: ${JSON.stringify(result)}`);
}
console.log(`  blasts row ${specials.rowBlast.size}, column ${specials.colBlast.size}, nova ${specials.novaBlast.size}; anchor chain ${specials.anchorChain.clear}; prism ${specials.prism.clear} cells`);
if(specials.row.clear!==3||specials.col.clear!==3||specials.color.clear!==4||specials.nova.clear!==4)
  fail(`special anchor preservation regressed: ${JSON.stringify({row:specials.row,col:specials.col,color:specials.color,nova:specials.nova})}`);
if(specials.rowBlast.size!==6||specials.colBlast.size!==7||specials.novaBlast.size!==9||
  specials.rowBlast.power!==2||specials.colBlast.power!==2||specials.novaBlast.power!==2)
  fail(`special blast footprint regressed: ${JSON.stringify({row:specials.rowBlast,col:specials.colBlast,nova:specials.novaBlast})}`);
if(!specials.anchorChain.stableBefore||!specials.anchorChain.accepted||specials.anchorChain.phase!=='clear'||
  specials.anchorChain.clear!==5||!specials.anchorChain.fullRow||specials.anchorChain.anchorClear||
  specials.anchorChain.keptType!==0||specials.anchorChain.keptSpecial!==1||
  specials.anchorChain.power!==4||specials.anchorChain.matches!==2)
  fail(`forge-anchor special did not chain before replacement: ${JSON.stringify(specials.anchorChain)}`);
if(!specials.prism.accepted||specials.prism.phase!=='clear'||specials.prism.missedTargets!==0||!specials.prism.includesBoth||
  specials.prism.clear!==specials.prism.targetCount+1||specials.prism.goldPower!==1+Math.max(0,specials.prism.clear-3))
  fail(`prism clear regressed: ${JSON.stringify(specials.prism)}`);

console.log('4) power coupling: every color grows its advertised combat system monotonically');
const power=game.sandbox.__powerFixture();
console.log(`  might ${power.red1.damage.toFixed(2)} -> ${power.red2.damage.toFixed(2)} bolt damage; haste ${power.gold1.delay.toFixed(1)} -> ${power.gold2.delay.toFixed(1)} frames`);
console.log(`  ward ${power.blue1.shield.toFixed(0)} -> ${power.blue2.shield.toFixed(0)}; vital ${power.green1.maxHp} -> ${power.green2.maxHp} max HP; orbit ${power.violet1.damage.toFixed(2)} -> ${power.violet2.damage.toFixed(2)}`);
if(power.red1.power!==1||power.red2.power!==2||power.red1.bolts<1||power.red2.bolts<1||!approxGreater(power.red2.damage,power.red1.damage))
  fail(`might coupling regressed: ${JSON.stringify({one:power.red1,two:power.red2})}`);
if(power.gold1.power!==1||power.gold2.power!==2||power.gold1.links<1||power.gold2.links<1||
  !approxGreater(power.gold2.damage,power.gold1.damage)||!(power.gold2.delay<power.gold1.delay))
  fail(`haste chain coupling regressed: ${JSON.stringify({one:power.gold1,two:power.gold2})}`);
if(power.blue1.power!==1||power.blue2.power!==2||!approxGreater(power.blue2.shield,power.blue1.shield)||power.blue2.armor<=0)
  fail(`ward coupling regressed: ${JSON.stringify({one:power.blue1,two:power.blue2})}`);
if(power.green1.power!==1||power.green2.power!==2||power.green2.maxHp<=power.green1.maxHp||power.green2.hp<=power.green1.hp)
  fail(`vital coupling regressed: ${JSON.stringify({one:power.green1,two:power.green2})}`);
if(power.violet1.power!==1||power.violet2.power!==2||!approxGreater(power.violet2.damage,power.violet1.damage)||power.violet2.orbits<1)
  fail(`orbit coupling regressed: ${JSON.stringify({one:power.violet1,two:power.violet2})}`);

console.log('5) pacing curve: calm opening, expanding camera, readable late swarm');
for(let run=1;run<=3;run++){
  game=bootGame('hexcascade',{seed:0x7ec080+run,footer:FOOTER});game.sandbox.__enablePacing();game.frames(7199,false);
  const pace=game.sandbox.__paceProbe(),nearShare=pace.late.nearAvg/Math.max(1,pace.late.activeAvg);
  console.log(`  run ${run}: threat ${pace.firstThreat}f; active ${pace.early.activeAvg.toFixed(1)} -> ${pace.mid.activeAvg.toFixed(1)} -> ${pace.late.activeAvg.toFixed(1)}; far ${pace.late.farAvg.toFixed(1)}; zoom ${pace.early.zoomAvg.toFixed(3)} -> ${pace.mid.zoomAvg.toFixed(3)} -> ${pace.late.zoomAvg.toFixed(3)}; level ${pace.early.levelAvg.toFixed(1)} -> ${pace.late.levelAvg.toFixed(1)}`);
  if(pace.firstThreat!==null&&pace.firstThreat<600)fail(`run ${run}: first threat arrived at ${pace.firstThreat}f before the opening could breathe`);
  if(pace.early.activeAvg<2.5||pace.early.activeAvg>8||pace.early.nearAvg>1.5||pace.early.nearMax>6)
    fail(`run ${run}: opening pressure is not calm/readable: ${JSON.stringify(pace.early)}`);
  if(pace.mid.activeAvg<5||pace.mid.activeAvg>18||pace.mid.activeAvg<pace.early.activeAvg*1.05||pace.mid.farAvg<5)
    fail(`run ${run}: midgame pressure did not build cleanly: ${JSON.stringify(pace.mid)}`);
  if(pace.late.activeAvg<22||pace.late.activeAvg>40||pace.late.activeP90<25||pace.late.activeMax>42||pace.late.farAvg<10||nearShare>.7)
    fail(`run ${run}: late swarm is sparse or collapses into a pile: ${JSON.stringify({late:pace.late,nearShare})}`);
  if(!(pace.early.zoomAvg>pace.mid.zoomAvg+.04&&pace.mid.zoomAvg>pace.late.zoomAvg+.04))
    fail(`run ${run}: camera did not progressively zoom out: ${pace.early.zoomAvg}/${pace.mid.zoomAvg}/${pace.late.zoomAvg}`);
  if(!(pace.early.levelAvg<pace.mid.levelAvg&&pace.mid.levelAvg<pace.late.levelAvg&&pace.early.powerAvg<pace.mid.powerAvg&&pace.mid.powerAvg<pace.late.powerAvg))
    fail(`run ${run}: power/level progression stalled`);
  if(pace.mid.kills<pace.early.kills*2||pace.late.kills<pace.mid.kills*1.6)
    fail(`run ${run}: kill output did not scale with the growing build: ${pace.early.kills}/${pace.mid.kills}/${pace.late.kills}`);
}

console.log('6) crowd separation: late swarms surround instead of stacking on the hero');
for(const seed of[20260712,20260716]){
  game=bootGame('hexcascade',{seed,footer:FOOTER});game.frames(6600,false);const crowd=game.sandbox.__crowdState();
  console.log(`  seed ${seed}: ${crowd.active} active, ${crowd.within10} piled, ${crowd.within42} near, ${crowd.far} approaching`);
  if(crowd.active<18||crowd.within10>Math.max(7,crowd.active*.25)||crowd.far<crowd.active*.35)
    fail(`seed ${seed}: late swarm collapsed into a center pile: ${JSON.stringify(crowd)}`);
}

console.log('7) autonomous watchability: 3 seeded three-minute runs');
for(let run=1;run<=3;run++){
  game=bootGame('hexcascade',{seed:0x7ec100+run,footer:FOOTER});game.sandbox.__enableAutoStats();game.frames(10800,false);
  const stats=game.sandbox.__autoProbe(),completed=stats.runs.length;
  console.log(`  run ${run}: ${stats.totalKills} kills, ${stats.totalAwards} match casts, ${stats.totalSpecials} specials, power ${stats.maxPowerSum} [${stats.maxPowers.join(',')}], cascade x${stats.maxCascade}, pressure ${stats.maxEnemies}, ${stats.deaths} deaths/${stats.dawns} dawns/${completed} completed`);
  if(!stats.finite)fail(`run ${run}: non-finite combat state`);
  if(stats.powerRegressions!==0)fail(`run ${run}: power decreased inside an award event`);
  if(stats.totalKills<300||stats.totalKills>480)fail(`run ${run}: ${stats.totalKills} kills outside watchable band 300..480`);
  if(stats.totalAwards<350||stats.totalAwards>620)fail(`run ${run}: ${stats.totalAwards} match casts outside band 350..620`);
  if(stats.totalSpecials<50||stats.totalSpecials>160)fail(`run ${run}: ${stats.totalSpecials} specials outside band 50..160`);
  if(stats.maxPowerSum<350||stats.maxPowerSum>700)fail(`run ${run}: power ${stats.maxPowerSum} outside band 350..700`);
  if(stats.maxPowers.some(value=>value<45))fail(`run ${run}: at least one color failed to evolve: ${stats.maxPowers.join(',')}`);
  if(stats.maxCascade<3||stats.maxCascade>10)fail(`run ${run}: cascade x${stats.maxCascade} outside band 3..10`);
  // band re-derived 2026-07-09: maxEnemies is chaotic across seeds — measured
  // 27,28,29,32,32,35,35,37,38,41 over seeds 0x7ec101..0a (acts on); the old
  // 34..42 was calibrated on 3 mid-band seeds and failed 5/10. Attribution:
  // __NO_ACTS run 1 also lands at 31, so the drift is timeline chaos, not the
  // tide. Readability has its own asserts (sections 5 and 6).
  if(stats.maxEnemies<25||stats.maxEnemies>44)fail(`run ${run}: enemy pressure ${stats.maxEnemies} outside 25..44`);
  if(stats.deaths>3)fail(`run ${run}: ${stats.deaths} deaths made the demo too restart-heavy`);
  if(stats.dawns<1)fail(`run ${run}: autoplay never survived to dawn`);
  if(!stats.allRuns.some(item=>item.elapsed>=900&&item.totalMatches>=3))fail(`run ${run}: no sustained powered combat segment`);
}

console.log('8) cascade lookahead: must beat greedy 1-ply on the same seed');
{
  const runPolicy=greedy=>{
    const g=bootGame('hexcascade',{seed:0x7ec101,footer:FOOTER});
    if(greedy)g.sandbox.__NO_LOOKAHEAD=1;
    g.sandbox.__enableAutoStats();g.frames(10800,false);
    return g.sandbox.__autoProbe();
  };
  const greedy=runPolicy(true),smart=runPolicy(false);
  console.log(`  greedy ${greedy.chains} chain-clears / ${greedy.totalSpecials} specials; `+
    `lookahead ${smart.chains} chain-clears / ${smart.totalSpecials} specials`);
  // The cascade sim exists to buy chain-clears; if it stops paying, fail loudly
  // instead of silently carrying dead planning code.
  if(smart.chains<=greedy.chains)
    fail(`cascade lookahead no longer beats greedy scoring (${smart.chains} vs ${greedy.chains} chain-clears)`);
}

console.log('9) session + manual board controls: Enter gate, cursor, selection, swap, hint');
game=bootGame('hexcascade',{seed:0x7ec200,footer:FOOTER});
const initial=game.sandbox.__manualState();press(game,'Enter');const instructions=game.sandbox.__manualState();
press(game,'Enter');const started=game.sandbox.__manualState();press(game,'ArrowRight');const moved=game.sandbox.__manualState();
press(game,'Space');const picked=game.sandbox.__manualState();press(game,'ArrowDown');const adjacent=game.sandbox.__manualState();
press(game,'Space');const attempted=game.sandbox.__manualState();game.frames(80,false);press(game,'KeyX');const hinted=game.sandbox.__manualState();
console.log(`  cursor (${started.cursor.r},${started.cursor.c}) -> (${moved.cursor.r},${moved.cursor.c}); selected ${picked.selected&&picked.selected.r+','+picked.selected.c}; swap phase ${attempted.phase}; hint ${hinted.hintT}f`);
if(initial.playing||instructions.playing)fail('first Enter skipped the instructions gate');
if(!started.playing)fail('second Enter did not start a scored run');
if(moved.cursor.r!==started.cursor.r||moved.cursor.c!==(started.cursor.c+1)%6)fail('manual right input did not move the rune cursor');
if(!picked.selected||picked.selected.r!==moved.cursor.r||picked.selected.c!==moved.cursor.c)fail('Space did not select the current rune');
if(adjacent.cursor.r!==(picked.selected.r+1)%7||adjacent.cursor.c!==picked.selected.c)fail('manual down input did not move to an adjacent rune');
if(attempted.selected!==null||!['swap','invalid'].includes(attempted.phase)||!attempted.lastSwap)fail('second Space did not attempt the adjacent swap');
if(!hinted.hint||hinted.hintT<=0||hinted.validMoves<1)fail('X did not mark a legal best move');

console.log('10) volatile tide act + show ladder: telegraphed, caster hunts the color, lord hitstop');
{
  const TIDE_FOOTER=`
;globalThis.__el=()=>elapsed;
globalThis.__tide=()=>({phase:tidePhase,type:tideType});
globalThis.__showP=()=>SHOW.probe();globalThis.__showE=()=>SHOW.events();
globalThis.__chosen=[0,0,0,0,0];
const __am1=awardMatch;awardMatch=function(type,size,chain,fromSpecial){
  if(chain===1&&!fromSpecial&&type>=0)globalThis.__chosen[type]++;
  return __am1(type,size,chain,fromSpecial);};
globalThis.__sig=()=>board.flat().reduce((s,t,i)=>s+(t?(t.type+1)*(i+7):0),0)+
  Math.round(kills*31+powers.reduce((s,n)=>s+n,0)*7+P.hp*100);`;
  const advanceTo=(g,target)=>{let guard=0;while(g.sandbox.__el()<target&&guard++<300)g.frames(60,false);};
  let sumA=0,sumB=0;
  for(const seed of[0x7ec601,0x7ec603]){
    const a=bootGame('hexcascade',{seed,footer:TIDE_FOOTER});
    const b=bootGame('hexcascade',{seed,footer:TIDE_FOOTER});
    b.sandbox.__NO_ACTS=1;
    advanceTo(a,3000);advanceTo(b,3000);
    const a0=[...a.sandbox.__chosen],b0=[...b.sandbox.__chosen];
    advanceTo(a,5150);advanceTo(b,5150);
    const t=a.sandbox.__tide().type,p=a.sandbox.__showP();
    const dA=a.sandbox.__chosen[t]-a0[t],dB=b.sandbox.__chosen[t]-b0[t];
    sumA+=dA;sumB+=dB;
    const tide=a.sandbox.__showE().filter(e=>e.id==='tide');
    const warn=tide.find(e=>e.kind==='act-warning'),land=tide.find(e=>e.kind==='act-land'),
      end=tide.find(e=>e.kind==='act-end');
    const o=p.offeredByTier,s3=p.shownByTier[3]||0;
    console.log(`  seed ${seed.toString(16)}: ${'RGBGV'[t]}-tide, chosen swaps ${dA} vs no-acts ${dB}, `+
      `telegraph ${warn&&land?land.tag-warn.tag:'?'}f, live ${land&&end?end.tag-land.tag:'?'}f, `+
      `lords ${s3} (held ${p.heldFrames}f), tiers ${JSON.stringify(o)}`);
    if(!warn||!land)fail(`seed ${seed.toString(16)}: tide act never telegraphed+landed`);
    else if(land.tag-warn.tag<180||land.tag-warn.tag>300)
      fail(`seed ${seed.toString(16)}: tide telegraph ${land.tag-warn.tag}f outside 180..300`);
    if(land&&end&&(end.tag-land.tag<900||end.tag-land.tag>2400))
      fail(`seed ${seed.toString(16)}: tide chapter length ${end.tag-land.tag}f not act-sized`);
    if(dA<dB)fail(`seed ${seed.toString(16)}: caster ignored the tide (${dA} vs ${dB} chosen)`);
    if(s3<1)fail(`seed ${seed.toString(16)}: no Night Lord fell — apex payoff never fired`);
    if(p.heldFrames!==6*s3)fail(`seed ${seed.toString(16)}: hitstop ${p.heldFrames}f != 6f per lord (${s3})`);
    if(!((o[1]||0)>(o[2]||0)&&(o[2]||0)>(o[3]||0)&&(o[3]||0)>=1))
      fail(`seed ${seed.toString(16)}: ladder opportunities not strictly ordered (${JSON.stringify(o)})`);
  }
  if(sumA<=sumB)fail(`tide never changed move valuation across seeds (${sumA} vs ${sumB} chosen swaps)`);
  else console.log(`  tide preference proven: ${sumA} vs ${sumB} chosen volatile swaps across seeds`);
  const a=bootGame('hexcascade',{seed:0x7ec611,footer:TIDE_FOOTER});
  const b=bootGame('hexcascade',{seed:0x7ec611,footer:TIDE_FOOTER});
  b.sandbox.__NO_PAYOFF_FX=1;
  advanceTo(a,2300);advanceTo(b,2300); // past the first Night Lord kill
  if(a.sandbox.__sig()!==b.sandbox.__sig())fail('__NO_PAYOFF_FX changed the sim: lordfall confetti leaked into gameplay');
  else console.log('  __NO_PAYOFF_FX: sim signatures identical through the first lord kill');
}

console.log('11) ten-minute soak: moving, happening, progressing');
{
  const{runSoak,analyzeSoak,assertSoak,soakLine}=require('./soak');
  const SOAK_FOOTER=`
;globalThis.__soakN={events:0,progress:0};
{const k0=killEnemy;killEnemy=e=>{const alive=!e.dead,out=k0(e);if(alive&&e.dead)globalThis.__soakN.events++;return out;};
 const a0=awardMatch;awardMatch=(t,s,c,f)=>{globalThis.__soakN.progress++;return a0(t,s,c,f);};}
globalThis.__soakProbe=()=>({sig:Math.round(P.x*7+P.y*13)+enemies.length*1009+totalMatches,
  events:globalThis.__soakN.events,progress:globalThis.__soakN.progress,
  finite:[P,...enemies].every(o=>['x','y'].every(k=>o[k]===undefined||Number.isFinite(o[k])))});`;
  const{samples}=runSoak('hexcascade',{seed:0x7ec501,footer:SOAK_FOOTER,minutes:10});
  const report=analyzeSoak(samples);
  console.log('  '+soakLine(report));
  // measured seeds 0x7ec501/02: still 0-1s, quiet 3-7s, stall 0s, ~1570 ev, ~1700 prog
  assertSoak('soak',report,{still:10,quiet:20,stall:20,minEvents:900,minProgress:1000},fail);
}

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
