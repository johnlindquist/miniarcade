#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const{spawnSync}=require('child_process');
const games=require('../games');
const{ROOT,bootGame}=require('./harness');
const{auditWorkshopMarkup}=require('./workshop-funnel-browser');

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};

console.log(`manifest: ${games.length} unique games`);
const ids=new Set(games.map(g=>g.id));
if(games.length!==31||ids.size!==games.length)fail('manifest must contain thirty-one unique game ids');
for(const game of games)if(!/^[a-z0-9-]+$/.test(game.id)||!game.title||!game.label||!game.tagline||!game.tone)
  fail(`malformed manifest entry: ${JSON.stringify(game)}`);

const index=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const workshopFx=fs.readFileSync(path.join(ROOT,'workshop-fx.js'),'utf8');
const workshopAudit=auditWorkshopMarkup(index,workshopFx);
for(const error of workshopAudit.errors)fail(`[${error.code}] ${error.message}`);
if(!index.includes('games.js'))fail('gallery does not load the shared manifest');
if(!index.includes("sidequest:active"))fail('gallery does not manage preview visibility');
if(!index.includes('Thirty-one tiny, self-playing retro games')||!index.includes('thirty-one tiny games'))
  fail('gallery count copy is stale');
if(!index.includes('>01 / 31</output>')||index.includes('>01 / 30</output>'))
  fail('gallery position count is stale');
if(!index.includes('.ss{--accent:'))fail('Scrap Shift gallery tone is missing');
for(const tone of ['mb','gs','wr','gg','sk','sv','ng','pc','fc','tp','bb','rc','rr','cc','hh','kc','mv','de','rf'])if(!index.includes(`.${tone}{--accent:`))fail(`${tone} gallery tone is missing`);
const manifestBytes=fs.readFileSync(path.join(ROOT,'games.js'));
const manifestHash=crypto.createHash('sha256').update(manifestBytes).digest('hex').slice(0,8);
if(!index.includes(`games.js?v=${manifestHash}`))fail(`gallery cachebuster does not match games.js (${manifestHash})`);
const readme=fs.readFileSync(path.join(ROOT,'README.md'),'utf8');
if(!readme.includes('Thirty-one self-playing'))fail('runtime README count is stale');

console.log('headless smoke: 600 steps plus one render per game');
for(const [i,game]of games.entries()){
  const page=path.join(ROOT,game.id+'.html');
  if(!fs.existsSync(page)){fail(`${game.id}: page missing`);continue;}
  try{
    const boot=bootGame(game.id,{seed:0x600d0000+i});
    boot.frames(600,false);
    const calls=boot.frames(1,true).calls;
    if(calls<=0)fail(`${game.id}: render emitted no canvas commands`);
    console.log(`  ${game.id.padEnd(10)} ok · ${calls} canvas commands`);
  }catch(error){fail(`${game.id}: ${error.stack||error}`);}
}

console.log('gallery browser: workshop dock and effects');
const browserCheck=spawnSync(process.execPath,[path.join(__dirname,'workshop-funnel-browser.js'),'--root',ROOT],{
  stdio:'inherit',env:process.env
});
if(browserCheck.status!==0)fail(`workshop browser check exited with ${browserCheck.status??'no status'}`);

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
