#!/usr/bin/env node
'use strict';

const{bootGame}=require('./harness');
const FRAMES=9000,SEEDS=Array.from({length:12},(_,i)=>0x1c00+i*157);
const keys=['exactLanterns','imperfectLanterns','districtsLit','jamFrames','clogsAvoided','forecastResponses','reactiveResponses','planReversals'];
const totals=()=>Object.fromEntries(keys.map(key=>[key,0]));
const liveTotal=totals(),baselineTotal=totals(),runs=[];
let safetyWins=0,throughputKeeps=0,failed=false;
const fail=message=>{console.error('FAIL:',message);failed=true;};

for(const seed of SEEDS){
  const live=bootGame('lantern-line',{seed}),baseline=bootGame('lantern-line',{seed});baseline.sandbox.__NO_CLOG_FORECAST=1;live.sandbox.__lanternLineReset();baseline.sandbox.__lanternLineReset();live.frames(FRAMES,false);baseline.frames(FRAMES,false);
  const a=live.sandbox.__lanternLineProbe(),b=baseline.sandbox.__lanternLineProbe();
  for(const key of keys){liveTotal[key]+=a.stats[key];baselineTotal[key]+=b.stats[key]}
  if(a.stats.jamFrames<b.stats.jamFrames)safetyWins++;if(a.stats.exactLanterns>=b.stats.exactLanterns-1)throughputKeeps++;
  if(!a.finite||!b.finite||a.stats.districtsLit!==4||b.stats.districtsLit!==4)fail(seed.toString(16)+': non-finite or incomplete skyline run');
  runs.push({seed,live:Object.fromEntries(keys.map(key=>[key,a.stats[key]])),baseline:Object.fromEntries(keys.map(key=>[key,b.stats[key]]))});
}

const receipt={schema:'lantern-line-benchmark/v1',frames:FRAMES,seeds:SEEDS,ablation:'__NO_CLOG_FORECAST',runs,aggregate:{live:liveTotal,baseline:baselineTotal,safetyWins,throughputKeeps}};
console.log(JSON.stringify(receipt,null,2));
if(safetyWins!==SEEDS.length)fail(`forecast safety won ${safetyWins}/${SEEDS.length} seeds`);
if(throughputKeeps<10)fail(`forecast retained throughput on only ${throughputKeeps}/${SEEDS.length} seeds`);
if(liveTotal.jamFrames>=baselineTotal.jamFrames*.25)fail(`forecast jam burden ${liveTotal.jamFrames} was not below 25% of reactive baseline ${baselineTotal.jamFrames}`);
if(liveTotal.exactLanterns<baselineTotal.exactLanterns-8)fail(`forecast sacrificed too much throughput ${liveTotal.exactLanterns}/${baselineTotal.exactLanterns}`);
if(liveTotal.forecastResponses<100||baselineTotal.forecastResponses!==0||liveTotal.clogsAvoided<100||baselineTotal.clogsAvoided!==0)fail('forecast intervention was not causally active across the panel');
if(failed)process.exit(1);
console.log('LANTERN LINE BENCHMARK PASSED');
