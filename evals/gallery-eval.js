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
if(games.length!==16||ids.size!==games.length)fail('manifest must contain sixteen unique game ids');
for(const game of games)if(!/^[a-z0-9-]+$/.test(game.id)||!game.title||!game.label||!game.tagline||!game.tone)
  fail(`malformed manifest entry: ${JSON.stringify(game)}`);

const index=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
if(!index.includes('games.js'))fail('gallery does not load the shared manifest');
if(!index.includes("sidequest:active"))fail('gallery does not manage preview visibility');
if(!index.includes('MINI<span>/</span>ARCADE'))fail('gallery does not expose the MINI/ARCADE brand');
if(!index.includes('sixteen tiny games'))fail('gallery count copy is stale');
if(!index.includes('.ss{--accent:'))fail('Scrap Shift gallery tone is missing');
if(!index.includes('.mr{--accent:'))fail('MISREGISTER gallery tone is missing');
for(const tone of ['sy','af','tl','cc'])if(!index.includes(`.${tone}{--accent:`))fail(`${tone} gallery tone is missing`);
const manifestBytes=fs.readFileSync(path.join(ROOT,'games.js'));
const manifestHash=crypto.createHash('sha256').update(manifestBytes).digest('hex').slice(0,8);
if(!index.includes(`games.js?v=${manifestHash}`))fail(`gallery cachebuster does not match games.js (${manifestHash})`);
const readme=fs.readFileSync(path.join(ROOT,'README.md'),'utf8').toLowerCase();
if(!readme.includes('sixteen self-playing'))fail('runtime README count is stale');
if(!index.includes('repeat(auto-fill,minmax('))fail('gallery grid does not reflow responsively');
if(!index.includes('aspect-ratio:4/9'))fail('preview viewports lost the 4:9 game aspect');
if(!index.includes("link.className='card-link'"))fail('gallery cards are not whole-card click targets');
if(!index.includes('.card-link{position:absolute;inset:0'))fail('card link does not cover the entire card');
if(!index.includes('pointer-events:none'))fail('preview iframes intercept card clicks');
if(!index.includes("frame.tabIndex=-1")||!index.includes("aria-hidden','true"))fail('preview iframes can steal keyboard focus');
if(!index.includes('IntersectionObserver'))fail('gallery does not pause offscreen previews');
if(!index.includes('(hover:none),(pointer:coarse)'))fail('gallery does not keep the PLAY affordance visible on touch');

const engine=fs.readFileSync(path.join(ROOT,'engine.js'),'utf8');
if(!engine.includes("if(preview||recording"))fail('preview canvases still advertise direct-game controls');
if(!engine.includes("e.origin!==location.origin")||!engine.includes("e.source!==parent"))
  fail('preview activity messages are not restricted to the same-origin parent');

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
