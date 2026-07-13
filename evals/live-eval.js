#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const games=require('../games');
const ROOT=path.join(__dirname,'..');
const REQUIRED_HEADERS={
  'x-content-type-options':'nosniff',
  'referrer-policy':'strict-origin-when-cross-origin',
  'permissions-policy':'camera=(), microphone=(), geolocation=()',
};

function parseArgs(argv){
  const options={games:[],timeout:15000};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--base')options.base=argv[++i];
    else if(arg==='--game')options.games.push(...String(argv[++i]||'').split(',').filter(Boolean));
    else if(arg==='--timeout')options.timeout=Number(argv[++i]);
    else if(arg==='--help')options.help=true;
    else options.invalid=arg;
  }
  return options;
}
const usage=()=>console.log('Usage: node evals/live-eval.js --base <url> [--game <id[,id...]>] [--timeout <ms>]');
const sha256=body=>crypto.createHash('sha256').update(body).digest('hex');
const scriptSources=html=>[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match=>match[1]);
const basename=source=>{try{return path.posix.basename(new URL(source,'https://example.invalid/').pathname)}catch{return path.posix.basename(source.split('?')[0])}};
function tagAttributes(tag){
  const attrs={};
  for(const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[match[1].toLowerCase()]=match[2]??match[3]??match[4];
  return attrs;
}
function parseManifest(source){
  const entries=[];
  for(const match of source.matchAll(/\{id:['"]([^'"]+)['"],title:['"]([^'"]+)['"]/g))entries.push({id:match[1],title:match[2]});
  return entries;
}

async function run(){
  const options=parseArgs(process.argv.slice(2));
  if(options.help){usage();return}
  if(options.invalid){console.error(`LIVE EVAL FAILED [LIVE_ARGUMENT_INVALID]: unknown argument ${options.invalid}`);usage();process.exit(1)}
  // run-all.js discovers every *-eval.js. Network verification is therefore
  // opt-in; the package verify:live command supplies the production base URL.
  if(!options.base){console.log('LIVE EVAL SKIPPED: no explicit --base URL (use npm run verify:live)');return}
  if(!Number.isFinite(options.timeout)||options.timeout<1000){console.error('LIVE EVAL FAILED [LIVE_TIMEOUT_INVALID]: --timeout must be at least 1000ms');process.exit(1)}

  let base;
  try{base=new URL(options.base)}catch(error){console.error(`LIVE EVAL FAILED [LIVE_BASE_URL_INVALID]: ${error.message}`);process.exit(1)}
  if(!/^https?:$/.test(base.protocol)){console.error(`LIVE EVAL FAILED [LIVE_BASE_URL_INVALID]: unsupported protocol ${base.protocol}`);process.exit(1)}
  const failures=[];
  const fail=(code,message)=>{failures.push({code,message});console.error(`  FAIL [${code}]: ${message}`)};
  const checkedScripts=new Map();

  async function request(label,url,{security=true}={}){
    let response,body;
    try{
      response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(options.timeout),headers:{'user-agent':'miniarcade-live-eval/1'}});
      body=Buffer.from(await response.arrayBuffer());
    }catch(error){fail('LIVE_HTTP_ERROR',`${label} ${url}: ${error.name}: ${error.message}`);return null}
    if(!response.ok)fail('LIVE_HTTP_STATUS',`${label} ${url}: HTTP ${response.status}`);
    if(security){
      for(const [key,value] of Object.entries(REQUIRED_HEADERS)){
        const actual=response.headers.get(key);
        if(actual===null)fail('LIVE_SECURITY_HEADER_MISSING',`${label} ${url}: missing ${key}`);
        else if(actual!==value)fail('LIVE_SECURITY_HEADER_MISMATCH',`${label} ${url}: ${key}=${JSON.stringify(actual)}, expected ${JSON.stringify(value)}`);
      }
    }
    return{response,body,text:body.toString('utf8'),url:String(response.url)};
  }

  const rootUrl=new URL('/',base);
  console.log(`LIVE AEP v1 verification: ${rootUrl.origin}`);
  const baseResult=await request('base route',base);
  if(baseResult)console.log(`  base route ${baseResult.response.status} ${baseResult.url}`);
  const rootResult=await request('root route',rootUrl);
  if(rootResult)console.log(`  root route ${rootResult.response.status} ${rootResult.url}`);

  const manifestUrl=new URL('games.js',rootUrl);
  const manifestResult=await request('catalog manifest',manifestUrl);
  let liveEntries=[];
  if(manifestResult){
    liveEntries=parseManifest(manifestResult.text);
    const localEntries=games.map(({id,title})=>({id,title}));
    if(JSON.stringify(liveEntries)!==JSON.stringify(localEntries))
      fail('LIVE_MANIFEST_ENTRY_DRIFT',`deployed catalog ${JSON.stringify(liveEntries)} does not match expected ${JSON.stringify(localEntries)}`);
    const liveHash=sha256(manifestResult.body);
    const localHash=sha256(fs.readFileSync(path.join(ROOT,'games.js')));
    if(liveHash!==localHash)fail('LIVE_MANIFEST_HASH_DRIFT',`deployed games.js ${liveHash} does not match local ${localHash}`);
    else console.log(`  catalog manifest ${liveEntries.length} entries · sha256 ${liveHash.slice(0,12)}…`);
    if(rootResult){
      const marker=[...rootResult.text.matchAll(/<script\b[^>]*\bsrc=["']games\.js\?v=([a-f0-9]+)["']/gi)][0];
      if(!marker)fail('LIVE_MANIFEST_MARKER_MISSING','root route has no games.js?v=<hash> cachebuster');
      else if(marker[1]!==liveHash.slice(0,marker[1].length))fail('LIVE_MANIFEST_MARKER_DRIFT',`root cachebuster ${marker[1]} does not match deployed manifest ${liveHash.slice(0,marker[1].length)}`);
      else console.log(`  root manifest cachebuster ${marker[1]} matches deployed bytes`);
    }
  }

  const selected=options.games.length?options.games:games.map(game=>game.id);
  for(const id of selected)if(!games.some(game=>game.id===id))fail('LIVE_GAME_UNKNOWN',`${id} is not an expected catalog game`);
  const expectedById=new Map(games.map(game=>[game.id,game]));
  const liveById=new Map(liveEntries.map(entry=>[entry.id,entry]));

  for(const id of selected){
    const expected=expectedById.get(id);if(!expected)continue;
    const liveEntry=liveById.get(id);
    if(!liveEntry)fail('LIVE_EXPECTED_CATALOG_ENTRY_MISSING',`${id} is missing from deployed games.js`);
    else if(liveEntry.title!==expected.title)fail('LIVE_EXPECTED_CATALOG_ENTRY_DRIFT',`${id}: deployed title ${JSON.stringify(liveEntry.title)} does not match ${JSON.stringify(expected.title)}`);

    const gameUrl=new URL(`${id}.html`,rootUrl);
    const pageResult=await request(`${id} game route`,gameUrl);
    if(!pageResult)continue;
    const canvasTag=pageResult.text.match(/<canvas\b[^>]*>/i)?.[0];
    if(!canvasTag)fail('LIVE_NATIVE_CANVAS_MISSING',`${id}: no canvas element found`);
    else{
      const attrs=tagAttributes(canvasTag);
      if(attrs.width!=='320'||attrs.height!=='720')fail('LIVE_NATIVE_CANVAS_SIZE_DRIFT',`${id}: canvas is ${attrs.width||'?'}x${attrs.height||'?'}, expected 320x720`);
    }
    const remoteSources=scriptSources(pageResult.text),remoteNames=new Set(remoteSources.map(basename));
    const localHtml=fs.readFileSync(path.join(ROOT,`${id}.html`),'utf8');
    const requiredNames=new Set(scriptSources(localHtml).map(basename));
    requiredNames.add('engine.js');
    for(const name of requiredNames)if(!remoteNames.has(name))fail('LIVE_RUNTIME_SCRIPT_MISSING',`${id}: deployed page is missing ${name}`);
    for(const source of remoteSources){
      const scriptUrl=new URL(source,gameUrl);
      if(!checkedScripts.has(String(scriptUrl)))checkedScripts.set(String(scriptUrl),{source,url:scriptUrl,owners:[id]});
      else checkedScripts.get(String(scriptUrl)).owners.push(id);
    }
    console.log(`  ${id}: route ${pageResult.response.status} · native canvas · ${remoteSources.map(basename).join(', ')}`);
  }

  for(const item of checkedScripts.values()){
    const result=await request(`runtime script for ${item.owners.join(',')}`,item.url);
    if(!result)continue;
    const marker=new URL(item.url).searchParams.get('v');
    if(marker){
      const actual=sha256(result.body).slice(0,marker.length);
      if(actual!==marker)fail('LIVE_SCRIPT_CACHEBUSTER_DRIFT',`${item.url}: cachebuster ${marker} does not match bytes ${actual}`);
    }
  }
  console.log(`  runtime routes checked: ${checkedScripts.size} (${[...checkedScripts.keys()].filter(url=>new URL(url).searchParams.has('v')).length} with byte-checked cachebusters)`);
  console.log('  deployment commit identity: not asserted because the current site exposes no commit marker');

  if(failures.length){
    console.error(`\nLIVE EVAL FAILED: ${failures.length} failure(s) · ${[...new Set(failures.map(failure=>failure.code))].join(', ')}`);
    process.exit(1);
  }
  console.log(`\nLIVE EVAL PASSED: root, catalog, ${selected.length} game route(s), runtime scripts, cachebusters, and security headers`);
}

run().catch(error=>{console.error(`LIVE EVAL FAILED [LIVE_UNEXPECTED]: ${error.stack||error}`);process.exit(1)});
