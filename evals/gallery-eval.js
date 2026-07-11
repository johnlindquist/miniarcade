#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const games=require('../games');
const{ROOT,bootGame}=require('./harness');

let failed=false;
const fail=m=>{console.error('  FAIL:',m);failed=true;};

console.log(`manifest: ${games.length} unique games`);
const ids=new Set(games.map(g=>g.id));
if(games.length!==26||ids.size!==games.length)fail('manifest must contain twenty-six unique game ids');
for(const game of games)if(!/^[a-z0-9-]+$/.test(game.id)||!game.title||!game.label||!game.tagline||!game.tone)
  fail(`malformed manifest entry: ${JSON.stringify(game)}`);

const index=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
if(!index.includes('games.js'))fail('gallery does not load the shared manifest');
if(!index.includes("sidequest:active"))fail('gallery does not manage preview visibility');
if(!index.includes('Twenty-six tiny, self-playing retro games')||!index.includes('twenty-six tiny games'))
  fail('gallery count copy is stale');
if(!index.includes('>01 / 26</output>')||index.includes('>01 / 25</output>'))
  fail('gallery position count is stale');
if(!index.includes('.ss{--accent:'))fail('Scrap Shift gallery tone is missing');
for(const tone of ['mb','gs','wr','gg','sk','sv','ng','pc','fc','tp','bb','rc','rr','cc','hh'])if(!index.includes(`.${tone}{--accent:`))fail(`${tone} gallery tone is missing`);
const manifestBytes=fs.readFileSync(path.join(ROOT,'games.js'));
const manifestHash=crypto.createHash('sha256').update(manifestBytes).digest('hex').slice(0,8);
if(!index.includes(`games.js?v=${manifestHash}`))fail(`gallery cachebuster does not match games.js (${manifestHash})`);
const readme=fs.readFileSync(path.join(ROOT,'README.md'),'utf8');
if(!readme.includes('Twenty-six self-playing'))fail('runtime README count is stale');

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

console.log(failed?'\nEVAL FAILED':'\nEVAL PASSED');
process.exit(failed?1:0);
