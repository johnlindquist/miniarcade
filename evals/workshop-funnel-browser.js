#!/usr/bin/env node
'use strict';
const fs=require('fs');
const http=require('http');
const path=require('path');
const crypto=require('crypto');
const games=require('../games');

const WORKSHOP_URL='https://egghead.io/workshop/software-factory';
const EGGO_HASH='d3e63150e58114fc19ff5fe8a12706832b10a81004cc94289d3c761d06493a38';
const GAME_COUNT=games.length;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const escapeRegExp=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const count=(source,pattern)=>(source.match(pattern)||[]).length;
const visibleText=source=>source.replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<script\b[\s\S]*?<\/script>/gi,' ')
  .replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const attribute=(tag,name)=>{
  const match=tag.match(new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1`,'i'));
  return match?match[2]:null;
};
const addError=(errors,condition,code,message)=>{if(!condition)errors.push({code,message});};

function auditWorkshopMarkup(html,fxSource=''){
  const errors=[];
  const footerStart=html.search(/<footer\b[^>]*class=["'][^"']*\bsite-footer\b/i);
  const footerEnd=footerStart<0?-1:html.indexOf('</footer>',footerStart);
  const dockStart=html.search(/<aside\b[^>]*id=["']workshop-dock["']/i);
  const dockEnd=dockStart<0?-1:html.indexOf('</aside>',dockStart);
  const ctaStart=html.search(/<a\b[^>]*id=["']workshop-cta["']/i);
  const ctaEnd=ctaStart<0?-1:html.indexOf('</a>',ctaStart);
  const trackStart=html.search(/<main\b[^>]*id=["']game-track["']/i);
  const trackEnd=trackStart<0?-1:html.indexOf('</main>',trackStart);
  const dockHtml=dockStart>=0&&dockEnd>dockStart?html.slice(dockStart,dockEnd+8):'';
  const ctaHtml=ctaStart>=0&&ctaEnd>ctaStart?html.slice(ctaStart,ctaEnd+4):'';
  const ctaTag=(html.match(/<a\b[^>]*id=["']workshop-cta["'][^>]*>/i)||[])[0]||'';
  const dockTag=(html.match(/<aside\b[^>]*id=["']workshop-dock["'][^>]*>/i)||[])[0]||'';
  const eggoTag=(html.match(/<[^>]*id=["']workshop-eggo["'][^>]*>/i)||[])[0]||'';
  const fallbackTag=(html.match(/<img\b[^>]*id=["']workshop-eggo-fallback["'][^>]*>/i)||[])[0]||'';
  const fxCanvasTag=(html.match(/<canvas\b[^>]*id=["']workshop-fx-canvas["'][^>]*>/i)||[])[0]||'';
  const eggoCanvasTag=(html.match(/<canvas\b[^>]*id=["']workshop-eggo-canvas["'][^>]*>/i)||[])[0]||'';
  const rel=(attribute(ctaTag,'rel')||'').toLowerCase().split(/\s+/).filter(Boolean);
  const described=(attribute(ctaTag,'aria-describedby')||'').split(/\s+/).filter(Boolean);
  const text=visibleText(html);
  const exactText=value=>count(text,new RegExp(escapeRegExp(value),'g'));

  addError(errors,count(html,/\bid=["']workshop-dock["']/gi)===1,'DOCK_COUNT','expected exactly one #workshop-dock');
  addError(errors,count(html,/\bid=["']workshop-cta["']/gi)===1,'CTA_COUNT','expected exactly one #workshop-cta');
  addError(errors,count(html,/\bid=["']workshop-eggo["']/gi)===1,'EGGO_COUNT','expected exactly one #workshop-eggo');
  addError(errors,footerStart>=0&&footerEnd>footerStart&&dockStart>footerStart&&dockStart<footerEnd,
    'DOCK_FOOTER','workshop dock must be inside .site-footer');
  addError(errors,!(trackStart>=0&&trackEnd>trackStart&&dockStart>trackStart&&dockStart<trackEnd),
    'DOCK_TRACK','workshop dock must not be inside #game-track');
  addError(errors,dockStart>=0&&dockEnd>dockStart&&ctaStart>dockStart&&ctaStart<dockEnd,
    'CTA_DOCK','workshop CTA must be a native anchor inside the dock');
  addError(errors,dockHtml.includes('id="workshop-eggo"')&&!ctaHtml.includes('workshop-eggo'),
    'EGGO_PLACEMENT','Eggo must be in the dock and outside the CTA');
  addError(errors,attribute(ctaTag,'href')===WORKSHOP_URL,'CTA_URL','workshop CTA must use the exact untracked URL');
  addError(errors,attribute(ctaTag,'target')==='_blank','CTA_TARGET','workshop CTA must open a new tab');
  addError(errors,rel.includes('noopener')&&rel.includes('noreferrer'),'CTA_REL','workshop CTA rel must contain noopener noreferrer');
  addError(errors,described.includes('workshop-authority')&&described.includes('workshop-scarcity')&&described.includes('workshop-new-tab'),
    'CTA_DESCRIPTION','workshop CTA must describe authority, scarcity, and new-tab behavior');
  addError(errors,attribute(dockTag,'data-workshop-state')==='quiet'&&attribute(dockTag,'data-workshop-seen')==='0',
    'INITIAL_STATE','workshop dock must begin quiet with zero signals');
  addError(errors,count(dockHtml,/class=["'][^"']*\bworkshop-signal-cell\b[^"']*["']/gi)===3,
    'SIGNAL_COUNT','workshop dock must contain exactly three signal cells');

  addError(errors,attribute(eggoTag,'role')==='img'&&!attribute(eggoTag,'tabindex')&&/grab to stretch/i.test(attribute(eggoTag,'aria-label')||''),
    'EGGO_A11Y','Eggo must be a labeled, non-tabbable image');
  addError(errors,attribute(fallbackTag,'src')==='eggo.svg'&&attribute(fallbackTag,'alt')===''&&attribute(fallbackTag,'draggable')==='false',
    'EGGO_FALLBACK','Eggo needs the exact local static fallback');
  addError(errors,attribute(fxCanvasTag,'aria-hidden')==='true'&&attribute(eggoCanvasTag,'aria-hidden')==='true',
    'CANVAS_A11Y','workshop canvases must be hidden from assistive technology');
  addError(errors,count(html,/<script\b[^>]*src=["']workshop-fx\.js["'][^>]*><\/script>/gi)===1,
    'FX_SCRIPT','gallery must load workshop-fx.js exactly once');
  addError(errors,/\.workshop-fx-canvas\{[^}]*position:absolute[^}]*pointer-events:none/i.test(html),
    'FX_SCOPE','mouse shader canvas must be absolute and pointer-transparent');
  addError(errors,!/\.(?:workshop-dock|workshop-link|workshop-scan|workshop-fx-canvas|workshop-eggo-canvas)[^{]*\{[^}]*position\s*:\s*fixed/i.test(html),
    'NO_OVERLAY','workshop effects must not be fixed-position');

  for(const value of [
    "YOU'RE WATCHING THE OUTPUT",'FACTORY SIGNAL FOUND','BUILD SOFTWARE WITH AGENTS',
    'JOHN LINDQUIST · EGGHEAD CO-FOUNDER','TICKETS ARE LIMITED','VIEW WORKSHOP TICKETS'
  ])addError(errors,exactText(value)===1,'COPY',`expected exact copy once: ${value}`);
  addError(errors,/class=["']workshop-cta-short["'][^>]*aria-hidden=["']true["'][^>]*>\s*WORKSHOP TICKETS\s*</i.test(html),
    'MOBILE_COPY','mobile CTA must use WORKSHOP TICKETS and remain decorative to AT');
  for(const className of ['workshop-scan','workshop-signal','workshop-state-label']){
    const tag=(dockHtml.match(new RegExp(`<[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`,'i'))||[])[0]||'';
    addError(errors,attribute(tag,'aria-hidden')==='true','DECORATIVE_AT',`${className} must be hidden from assistive technology`);
  }
  addError(errors,!/<dialog\b|role\s*=\s*["']dialog["']/i.test(html),'NO_DIALOG','workshop CTA must not be wrapped in a dialog');
  addError(errors,!/aria-live\s*=/i.test(dockHtml),'NO_LIVE','workshop dock must not use aria-live');
  addError(errors,!new RegExp(`<link\\b[^>]*rel=["'][^"']*(?:prefetch|preload)[^"']*["'][^>]*href=["']${escapeRegExp(WORKSHOP_URL)}`,'i').test(html),
    'NO_PREFETCH','workshop destination must not be prefetched');
  addError(errors,/const workshopSeen=new Set\(\)/.test(html)&&/workshopSeen\.add\(index\)/.test(html),
    'DISTINCT_SET','workshop progress must use a Set of game indexes');
  addError(errors,/function recordWorkshopAttention\(index,source\)/.test(html),'ATTENTION_HOOK','recordWorkshopAttention is missing');
  addError(errors,/Math\.min\(3,workshopSeen\.size\)/.test(html)&&/seen<3/.test(html),
    'THRESHOLD','workshop earn threshold must be three distinct games');
  addError(errors,/source='program'/.test(html)&&/source==='program'/.test(html)&&/setActive\(0\)/.test(html),
    'PROGRAM_SOURCE','initial setActive must use and ignore the default program source');
  for(const source of ['pointer','focus','button','keyboard','swipe','clip-select'])
    addError(errors,html.includes(`source:'${source}'`),'SOURCE',`missing deliberate activation source: ${source}`);
  addError(errors,/\.is-unlocking \.workshop-scan\{animation:workshop-scan 620ms var\(--ease\) 1\}/.test(html)&&
    /\[data-workshop-state="earned"\] \.workshop-link\{animation:workshop-ticket-pulse 620ms var\(--ease\) 1\}/.test(html)&&
    !/(?:workshop-scan|workshop-ticket-pulse)[^;}]*infinite/i.test(html),
    'BOUNDED_ANIMATION','unlock scan and pulse must each run once');
  addError(errors,/@media \(prefers-reduced-motion:reduce\)/.test(html)&&
    /\.workshop-eggo-canvas,\.workshop-fx-canvas\{display:none!important\}/.test(html)&&
    /\.workshop-link:hover\{transform:none\}/.test(html),
    'REDUCED_MOTION','reduced motion must disable workshop animation and canvases');

  if(fxSource){
    addError(errors,/setPointerCapture\(pointerId\)/.test(fxSource)&&/releasePointerCapture\(pointerId\)/.test(fxSource),
      'POINTER_CAPTURE','Eggo must capture and release the drag pointer');
    addError(errors,/Math\.exp\(-\(dx\*dx\+dy\*dy\)\/.+fallRadius/.test(fxSource)&&/spring=190,damping=9\.5/.test(fxSource),
      'STRETCH_PHYSICS','Eggo must retain Gaussian pull and spring return');
    addError(errors,/webglcontextlost/.test(fxSource)&&/showEggoFallback\('static'\)/.test(fxSource),
      'WEBGL_FALLBACK','Eggo must recover to its static fallback');
    addError(errors,/prefers-reduced-motion: reduce/.test(fxSource)&&/listenMedia\(reduce,reconcile\)/.test(fxSource),
      'LIVE_REDUCED_MOTION','effects must react to reduced-motion changes');
    addError(errors,/ResizeObserver/.test(fxSource)&&/document\.hidden/.test(fxSource)&&/powerPreference:'low-power'/.test(fxSource),
      'FX_LIFECYCLE','shader must resize locally, pause hidden, and request low power');
    addError(errors,/Math\.min\(devicePixelRatio\|\|1,1\)/.test(fxSource)&&/Math\.min\(0\.75,dpr\*0\.75\)/.test(fxSource),
      'FX_RESOLUTION','shader DPR and render scale must be capped');
    addError(errors,/\(hover: hover\) and \(pointer: fine\)/.test(fxSource)&&/\(min-width: 768px\)/.test(fxSource),
      'FX_DESKTOP_ONLY','mouse shader must stay a desktop fine-pointer enhancement');
    addError(errors,/data\.eggoState|dataset\.eggoState/.test(fxSource)&&/dataset\.workshopShader/.test(fxSource),
      'FX_STATE','effects need stable runtime state markers');
    addError(errors,!/(?:localStorage|sessionStorage|indexedDB|document\.cookie)/.test(fxSource),
      'NO_STORAGE','workshop effects must not persist state');
  }
  return{ok:errors.length===0,errors};
}

function runAdversarialAudits(html,fxSource){
  const baseline=auditWorkshopMarkup(html,fxSource);
  if(!baseline.ok)throw new Error(`workshop source audit failed: ${baseline.errors.map(error=>`[${error.code}] ${error.message}`).join('; ')}`);
  const fixtures=[
    ['wrong hostname',()=>[html.replace(WORKSHOP_URL,'https://example.com/workshop/software-factory'),fxSource]],
    ['query parameter',()=>[html.replace(WORKSHOP_URL,WORKSHOP_URL+'?utm_source=miniarcade'),fxSource]],
    ['missing rel',()=>[html.replace('rel="noopener noreferrer"','rel="noreferrer"'),fxSource]],
    ['duplicate CTA',()=>[html.replace('</aside>','<a id="workshop-cta" href="'+WORKSHOP_URL+'"></a></aside>'),fxSource]],
    ['threshold one',()=>[html.replace('Math.min(3,workshopSeen.size)','Math.min(1,workshopSeen.size)'),fxSource]],
    ['tabbable mascot',()=>[html.replace('class="workshop-eggo" role="img"','class="workshop-eggo" role="img" tabindex="0"'),fxSource]],
    ['remote mascot',()=>[html.replace('src="eggo.svg"','src="https://egghead.io/eggo.svg"'),fxSource]],
    ['interactive shader',()=>[html.replace('pointer-events:none;mix-blend-mode','pointer-events:auto;mix-blend-mode'),fxSource]],
    ['missing pointer capture',()=>[html,fxSource.replace('eggo.setPointerCapture(pointerId)','eggo.hasPointerCapture(pointerId)')]],
    ['missing hidden pause',()=>[html,fxSource.replace(/document\.hidden/g,'false')]],
    ['uncapped shader DPR',()=>[html,fxSource.replace('Math.min(devicePixelRatio||1,1)','devicePixelRatio||1')]]
  ];
  for(const[name,mutate]of fixtures){
    const[changedHtml,changedFx]=mutate();
    if(changedHtml===html&&changedFx===fxSource)throw new Error(`adversarial fixture did not mutate source: ${name}`);
    if(auditWorkshopMarkup(changedHtml,changedFx).ok)throw new Error(`workshop auditor missed adversarial fixture: ${name}`);
  }
}

function assert(condition,message){if(!condition)throw new Error(message);}
function isZeroDuration(value){return value.split(',').every(part=>parseFloat(part)===0);}
function isEgghead(url){try{return new URL(url).hostname==='egghead.io'||new URL(url).hostname.endsWith('.egghead.io');}catch{return false;}}
function isAnalytics(url){return /(?:google-analytics|googletagmanager|plausible|segment\.com|posthog|mixpanel|\/analytics(?:[/?]|$))/i.test(url);}

async function startStaticServer(root){
  const safeRoot=await fs.promises.realpath(path.resolve(root));
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8',
    '.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webm':'video/webm'};
  const server=http.createServer(async(req,res)=>{
    try{
      const requestUrl=new URL(req.url,'http://127.0.0.1');
      const decoded=decodeURIComponent(requestUrl.pathname);
      if(decoded.includes('\0'))throw new Error('invalid path');
      let target=path.resolve(safeRoot,'.'+decoded);
      if(target!==safeRoot&&!target.startsWith(safeRoot+path.sep))throw new Error('path escape');
      let stat=await fs.promises.stat(target);
      if(stat.isDirectory()){target=path.join(target,'index.html');stat=await fs.promises.stat(target);}
      const realTarget=await fs.promises.realpath(target);
      if(realTarget!==safeRoot&&!realTarget.startsWith(safeRoot+path.sep))throw new Error('symlink escape');
      if(!stat.isFile())throw new Error('not a file');
      res.writeHead(200,{'content-type':mime[path.extname(target).toLowerCase()]||'application/octet-stream','cache-control':'no-store'});
      if(req.method==='HEAD')return res.end();
      fs.createReadStream(realTarget).pipe(res);
    }catch{
      res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end('not found');
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();
  return{server,baseUrl:`http://127.0.0.1:${address.port}/`};
}
async function closeServer(server){if(server)await new Promise(resolve=>server.close(()=>resolve()));}
async function fetchText(url,timeoutMs){
  const response=await fetch(url,{signal:AbortSignal.timeout(timeoutMs)});
  assert(response.ok,`${url} returned HTTP ${response.status}`);
  return response.text();
}
async function fetchBytes(url,timeoutMs){
  const response=await fetch(url,{signal:AbortSignal.timeout(timeoutMs)});
  assert(response.ok,`${url} returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function openPage(browser,baseUrl,viewport,{reducedMotion=false,webglFailure=false}={}){
  const page=await browser.newPage();
  await page.setViewport(viewport);
  if(reducedMotion)await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  if(webglFailure)await page.evaluateOnNewDocument(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      if(type==='webgl'||type==='experimental-webgl')return null;
      return original.call(this,type,...args);
    };
  });
  const requests=[];const errors=[];
  page.on('request',request=>requests.push(request.url()));
  page.on('pageerror',error=>errors.push(error.message));
  page.setDefaultTimeout(15000);
  const url=new URL(baseUrl);url.searchParams.set('workshopDebug','1');
  await page.goto(url.href,{waitUntil:'domcontentloaded'});
  await page.waitForSelector(`.game-card:nth-child(${GAME_COUNT})`);
  await delay(200);
  return{page,requests,errors};
}

async function storageState(page){
  const client=await page.createCDPSession();
  const cookies=(await client.send('Network.getAllCookies')).cookies;
  await client.detach();
  return page.evaluate(async cookieCount=>({
    local:Object.keys(localStorage),session:Object.keys(sessionStorage),cookieCount,
    indexed:typeof indexedDB.databases==='function'?(await indexedDB.databases()).map(entry=>entry.name):[]
  }),cookies.length);
}
async function stateOf(page){
  return page.evaluate(()=>{
    const dock=document.getElementById('workshop-dock');
    const cta=document.getElementById('workshop-cta');
    const eggo=document.getElementById('workshop-eggo');
    const style=getComputedStyle(cta);const rect=cta.getBoundingClientRect();
    return{state:dock.dataset.workshopState,seen:+dock.dataset.workshopSeen,shader:dock.dataset.workshopShader,
      eggo:eggo.dataset.eggoState,cards:document.querySelectorAll('.game-card').length,
      active:document.querySelectorAll('.game-card.is-active').length,position:document.getElementById('position').textContent.trim(),
      ctaVisible:rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&style.pointerEvents!=='none',
      href:cta.href,target:cta.target,rel:cta.rel};
  });
}
async function waitSeen(page,seen){
  await page.waitForFunction(value=>+document.getElementById('workshop-dock').dataset.workshopSeen>=value,{},seen);
  return page.$eval('#workshop-dock',dock=>+dock.dataset.workshopSeen);
}
async function layoutState(page){
  return page.evaluate(()=>{
    const rect=selector=>{const value=document.querySelector(selector).getBoundingClientRect();return{top:value.top,bottom:value.bottom,left:value.left,right:value.right,width:value.width,height:value.height};};
    const visible=selector=>{const element=document.querySelector(selector),style=getComputedStyle(element),value=element.getBoundingClientRect();return value.width>0&&value.height>0&&style.display!=='none'&&style.visibility!=='hidden';};
    const footer=rect('.site-footer'),track=rect('#game-track'),dock=rect('#workshop-dock'),cta=rect('#workshop-cta'),eggo=rect('#workshop-eggo'),shader=rect('#workshop-fx-canvas');
    return{footer,track,dock,cta,eggo,shader,horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
      overlap:track.bottom>footer.top+1,ctaInViewport:cta.left>=0&&cta.right<=innerWidth+1&&cta.top>=0&&cta.bottom<=innerHeight+1,
      shaderInsideDock:shader.left>=dock.left-1&&shader.right<=dock.right+1&&shader.top>=dock.top-1&&shader.bottom<=dock.bottom+1,
      authorityVisible:visible('.workshop-authority'),scarcityVisible:visible('.workshop-scarcity'),dockVisible:visible('#workshop-dock'),
      eggoVisible:visible('#workshop-eggo'),ctaVisible:visible('#workshop-cta'),detailsVisible:visible('.site-footer summary')};
  });
}

async function focusAndActivateCta(page){
  await page.evaluate(()=>document.activeElement&&document.activeElement.blur());
  let focused=false;
  for(let i=0;i<60;i++){
    await page.keyboard.press('Tab');
    focused=await page.evaluate(()=>document.activeElement?.id==='workshop-cta');
    if(focused)break;
  }
  assert(focused,'real Tab navigation did not reach #workshop-cta');
  const focus=await page.evaluate(()=>{const style=getComputedStyle(document.activeElement);return{style:style.outlineStyle,width:parseFloat(style.outlineWidth)||0};});
  assert(focus.style!=='none'&&focus.width>=2,'workshop CTA lacks a visible focus outline');
  await page.evaluate(()=>{
    window.__workshopActivation=null;
    document.getElementById('workshop-cta').addEventListener('click',event=>{
      const link=event.currentTarget;
      window.__workshopActivation={href:link.href,target:link.target,rel:link.rel};
      event.preventDefault();
    },{once:true,capture:true});
  });
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.__workshopActivation!==null);
  const activation=await page.evaluate(()=>window.__workshopActivation);
  const rel=activation.rel.split(/\s+/).filter(Boolean);
  assert(activation.href===WORKSHOP_URL,'keyboard activation changed the workshop URL');
  assert(activation.target==='_blank','keyboard activation lost the new-tab target');
  assert(rel.includes('noopener')&&rel.includes('noreferrer'),'keyboard activation lost link protections');
  return{focused:true,activatedWithEnter:true,activation:{href:activation.href,target:activation.target,rel}};
}

async function screenshotClip(page,selector,pad=0){
  const clip=await page.$eval(selector,(element,padding)=>{
    const r=element.getBoundingClientRect();
    const x=Math.max(0,r.left-padding),y=Math.max(0,r.top-padding);
    return{x,y,width:Math.min(innerWidth-x,r.width+padding*2),height:Math.min(innerHeight-y,r.height+padding*2)};
  },pad);
  return page.screenshot({clip});
}

async function exerciseEggo(page){
  await page.waitForFunction(()=>['ready','idle'].includes(document.getElementById('workshop-eggo').dataset.eggoState));
  await page.waitForFunction(()=>window.__workshopFx&&!window.__workshopFx.eggoRafActive);
  await page.evaluate(()=>{document.getElementById('workshop-fx-canvas').style.visibility='hidden';});
  const beforeState=await page.evaluate(()=>({
    active:document.querySelector('.game-card.is-active')?.dataset.index,
    position:document.getElementById('position').textContent.trim(),scroll:document.getElementById('game-track').scrollLeft,
    footer:document.querySelector('.site-footer').getBoundingClientRect().height,
    rect:(()=>{const r=document.getElementById('workshop-eggo').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()
  }));
  const rest=await screenshotClip(page,'#workshop-eggo-canvas',1);
  await page.mouse.move(beforeState.rect.x,beforeState.rect.y);
  await page.mouse.down();
  await page.mouse.move(beforeState.rect.x+30,beforeState.rect.y+10,{steps:4});
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='dragging');
  await delay(90);
  const pulled=await screenshotClip(page,'#workshop-eggo-canvas',1);
  await page.mouse.up();
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='idle');
  const settled=await screenshotClip(page,'#workshop-eggo-canvas',1);
  const afterState=await page.evaluate(()=>({
    active:document.querySelector('.game-card.is-active')?.dataset.index,
    position:document.getElementById('position').textContent.trim(),scroll:document.getElementById('game-track').scrollLeft,
    footer:document.querySelector('.site-footer').getBoundingClientRect().height,
    raf:window.__workshopFx.eggoRafActive
  }));
  await page.evaluate(()=>{document.getElementById('workshop-fx-canvas').style.visibility='';});
  assert(hash(rest)!==hash(pulled),'real pointer drag did not change Eggo pixels');
  assert(hash(rest)===hash(settled),'Eggo did not return to its exact rest pixels');
  assert(beforeState.active===afterState.active&&beforeState.position===afterState.position,'Eggo drag changed gallery selection');
  assert(Math.abs(beforeState.scroll-afterState.scroll)<1,'Eggo drag moved the gallery rail');
  assert(Math.abs(beforeState.footer-afterState.footer)<1,'Eggo drag changed footer height');
  assert(!afterState.raf,'Eggo retained an animation frame after settling');
  return{changed:true,restored:true,settled:true};
}

async function exerciseShader(page){
  await page.waitForFunction(()=>document.getElementById('workshop-dock').dataset.workshopShader==='active');
  const geometry=await page.evaluate(()=>{
    const dock=document.getElementById('workshop-dock'),canvas=document.getElementById('workshop-fx-canvas');
    const r=dock.getBoundingClientRect();
    [...dock.children].filter(child=>child!==canvas).forEach(child=>child.dataset.evalOpacity=child.style.opacity||'');
    [...dock.children].filter(child=>child!==canvas).forEach(child=>{child.style.opacity='0';});
    return{left:r.left,top:r.top,width:r.width,height:r.height,canvasWidth:canvas.width,canvasHeight:canvas.height};
  });
  await page.mouse.move(geometry.left+28,geometry.top+geometry.height/2);
  await delay(120);
  const left=await screenshotClip(page,'#workshop-fx-canvas');
  const leftPointer=await page.evaluate(()=>({...window.__workshopFx.shaderPointer}));
  await page.mouse.move(geometry.left+geometry.width-28,geometry.top+geometry.height/2,{steps:5});
  await delay(120);
  const right=await screenshotClip(page,'#workshop-fx-canvas');
  const debug=await page.evaluate(()=>{
    const dock=document.getElementById('workshop-dock'),canvas=document.getElementById('workshop-fx-canvas');
    [...dock.children].filter(child=>child!==canvas).forEach(child=>{child.style.opacity=child.dataset.evalOpacity||'';delete child.dataset.evalOpacity;});
    return{energy:window.__workshopFx.shaderEnergy,draws:window.__workshopFx.drawCounters.shader,pointer:{...window.__workshopFx.shaderPointer}};
  });
  assert(hash(left)!==hash(right),'mouse shader pixels did not change between separated pointer positions');
  assert(debug.pointer.x-leftPointer.x>geometry.width*.35&&debug.draws>=2,
    `mouse shader did not track separated pointer positions (${JSON.stringify({leftPointer,debug})})`);
  assert(geometry.canvasWidth<=Math.ceil(geometry.width*.75)+1&&geometry.canvasHeight<=Math.ceil(geometry.height*.75)+1,
    'mouse shader backing buffer exceeds its resolution cap');
  return{responsive:true,draws:debug.draws,resolution:{width:geometry.canvasWidth,height:geometry.canvasHeight}};
}

async function runDesktop(browser,baseUrl,receiptDir,timeoutMs){
  const{page,requests,errors}=await openPage(browser,baseUrl,{width:1440,height:900});
  page.setDefaultTimeout(timeoutMs);
  try{
    await page.waitForFunction(()=>['ready','idle'].includes(document.getElementById('workshop-eggo').dataset.eggoState));
    const initial=await stateOf(page);
    assert(initial.cards===GAME_COUNT,`desktop gallery must render ${GAME_COUNT} game cards`);
    assert(initial.active===1,'desktop gallery must begin with one active card');
    assert(initial.state==='quiet'&&initial.seen===0,'programmatic gallery setup must not earn workshop progress');
    assert(initial.ctaVisible&&initial.href===WORKSHOP_URL,'workshop CTA must be usable before earning');
    assert(initial.target==='_blank'&&/\bnoopener\b/.test(initial.rel)&&/\bnoreferrer\b/.test(initial.rel),'initial workshop CTA protections are invalid');
    assert(initial.shader==='active','desktop mouse shader did not initialize');
    assert(requests.filter(isEgghead).length===0,'egghead was contacted before workshop activation');

    await page.focus('.game-card:nth-child(1) .card-link');
    const progression=[await waitSeen(page,1)];
    await page.keyboard.press('ArrowRight');progression.push(await waitSeen(page,2));
    await page.keyboard.press('ArrowRight');progression.push(await waitSeen(page,3));
    assert(progression.join(',')==='1,2,3','desktop workshop progress skipped a distinct-game signal');
    await page.keyboard.press('ArrowRight');
    const expectedPosition=`04 / ${String(GAME_COUNT).padStart(2,'0')}`;
    await page.waitForFunction(value=>document.getElementById('position').textContent.trim()===value,{},expectedPosition);
    const earned=await page.evaluate(()=>{
      const dock=document.getElementById('workshop-dock'),label=document.querySelector('.workshop-state-earned');
      const scan=getComputedStyle(document.querySelector('.workshop-scan'));
      return{state:dock.dataset.workshopState,seen:+dock.dataset.workshopSeen,active:document.querySelectorAll('.game-card.is-active').length,
        position:document.getElementById('position').textContent.trim(),labelVisible:getComputedStyle(label).display!=='none',
        animationName:scan.animationName,animationDuration:scan.animationDuration,animationIterations:scan.animationIterationCount,
        focusedCta:document.activeElement?.id==='workshop-cta',scrollY};
    });
    assert(earned.state==='earned'&&earned.seen===3,'third distinct activation must earn the workshop state');
    assert(earned.active===1&&earned.position===expectedPosition,'gallery selection regressed while earning the workshop state');
    assert(earned.labelVisible,'earned workshop label is not visibly rendered');
    assert(earned.animationName==='workshop-scan'&&parseFloat(earned.animationDuration)>0&&earned.animationIterations==='1','workshop scan must be one bounded animation');
    assert(!earned.focusedCta&&earned.scrollY===0,'earning must not focus or scroll to the workshop CTA');
    await delay(700);
    const layout=await layoutState(page);
    assert(layout.footer.height<=72,`desktop footer exceeds 72px (${layout.footer.height})`);
    assert(layout.track.height>=900*.42,`desktop gallery track is below 42vh (${layout.track.height})`);
    assert(!layout.overlap,'desktop workshop dock overlaps the gallery track');
    assert(layout.shaderInsideDock,'desktop mouse shader escaped the dock');
    const stretch=await exerciseEggo(page);
    const shader=await exerciseShader(page);
    const keyboard=await focusAndActivateCta(page);
    assert(requests.filter(isEgghead).length===0,'keyboard interception still contacted egghead');
    assert(requests.filter(isAnalytics).length===0,'gallery contacted an analytics endpoint');
    assert(!errors.length,`desktop page errors: ${errors.join('; ')}`);
    const storage=await storageState(page);
    assert(!storage.local.length&&!storage.session.length&&!storage.cookieCount&&!storage.indexed.length,'workshop path created persistent browser state');
    const prefetch=await page.evaluate(url=>[...document.querySelectorAll('link[rel~="prefetch"],link[rel~="preload"]')].some(link=>link.href===url),WORKSHOP_URL);
    assert(!prefetch,'workshop URL is prefetched');
    if(receiptDir)await page.screenshot({path:path.join(receiptDir,'desktop.png')});
    return{initial:{state:initial.state,seen:initial.seen,eggo:initial.eggo,shader:initial.shader},progression,
      earnedState:earned.state,activePosition:earned.position,outbound:keyboard.activation,
      keyboard:{focused:keyboard.focused,activatedWithEnter:keyboard.activatedWithEnter},stretch,shader,
      network:{eggheadRequestsBeforeActivation:requests.filter(isEgghead).length},layout,storage};
  }finally{await page.close();}
}

async function touchDrag(page){
  const point=await page.$eval('#workshop-eggo',element=>{const r=element.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
  const client=await page.createCDPSession();
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1,radiusX:2,radiusY:2,force:1}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+18,y:point.y+6,id:1,radiusX:2,radiusY:2,force:1}]});
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='dragging');
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await client.detach();
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='idle');
}

async function runMobile(browser,baseUrl,width,height,receiptDir,timeoutMs){
  const{page,requests,errors}=await openPage(browser,baseUrl,{width,height,isMobile:true,hasTouch:true,deviceScaleFactor:1});
  page.setDefaultTimeout(timeoutMs);
  try{
    await page.waitForFunction(()=>['ready','idle'].includes(document.getElementById('workshop-eggo').dataset.eggoState));
    const before=await layoutState(page);
    for(let seen=1;seen<=3;seen++){await page.click('#next-game');await waitSeen(page,seen);}
    await delay(550);
    const galleryBefore=await page.evaluate(()=>({position:document.getElementById('position').textContent.trim(),scroll:document.getElementById('game-track').scrollLeft}));
    await touchDrag(page);
    await delay(200);
    const galleryAfter=await page.evaluate(()=>({position:document.getElementById('position').textContent.trim(),scroll:document.getElementById('game-track').scrollLeft}));
    const earned=await stateOf(page);const after=await layoutState(page);
    assert(earned.state==='earned'&&earned.seen===3,`${width}x${height} did not earn after three Next activations`);
    assert(earned.shader==='disabled',`${width}x${height} should disable the mouse shader`);
    assert(galleryBefore.position===galleryAfter.position&&Math.abs(galleryBefore.scroll-galleryAfter.scroll)<1,`${width}x${height} mascot drag moved the gallery`);
    assert(!after.horizontalOverflow,`${width}x${height} has document-level horizontal overflow`);
    assert(after.dockVisible&&after.eggoVisible&&after.authorityVisible&&after.scarcityVisible&&after.ctaVisible,`${width}x${height} hides workshop information`);
    assert(after.cta.height>=44,`${width}x${height} workshop CTA is below 44px (${after.cta.height})`);
    assert(after.footer.height<=96,`${width}x${height} footer exceeds 96px (${after.footer.height})`);
    assert(!after.overlap,`${width}x${height} workshop dock overlaps the gallery track`);
    assert(after.ctaInViewport,`${width}x${height} workshop CTA leaves the viewport after earning`);
    assert(Math.abs(after.footer.height-before.footer.height)<=1,`${width}x${height} earning changed footer height`);
    if(width===390)assert(after.track.height>=height*.42,`390x844 gallery track is below 42vh (${after.track.height})`);
    if(width===360)assert(after.track.height>=220,`360x640 gallery track is below 220px (${after.track.height})`);
    assert(after.detailsVisible,`${width}x${height} play & record control is hidden`);
    await page.click('.site-footer summary');
    assert(await page.$eval('.site-footer details',element=>element.open),`${width}x${height} play & record does not open`);
    await page.click('.site-footer summary');
    assert(requests.filter(isEgghead).length===0,`${width}x${height} contacted egghead before CTA activation`);
    assert(!errors.length,`${width}x${height} page errors: ${errors.join('; ')}`);
    if(receiptDir)await page.screenshot({path:path.join(receiptDir,`mobile-${width}x${height}.png`)});
    return{width,height,footerHeight:after.footer.height,trackHeight:after.track.height,horizontalOverflow:after.horizontalOverflow,
      trackOverlap:after.overlap,ctaHeight:after.cta.height,touchStretch:true};
  }finally{await page.close();}
}

async function runReducedMotion(browser,baseUrl,receiptDir,timeoutMs){
  const{page,requests,errors}=await openPage(browser,baseUrl,{width:1440,height:900},{reducedMotion:true});
  page.setDefaultTimeout(timeoutMs);
  try{
    for(let seen=1;seen<=3;seen++){await page.click('#next-game');await waitSeen(page,seen);}
    await page.hover('#workshop-cta');
    const reduced=await page.evaluate(()=>{
      const dock=document.getElementById('workshop-dock'),eggo=document.getElementById('workshop-eggo'),scan=getComputedStyle(document.querySelector('.workshop-scan')),
        cta=getComputedStyle(document.getElementById('workshop-cta')),dockStyle=getComputedStyle(dock),label=document.querySelector('.workshop-state-earned');
      const cells=[...document.querySelectorAll('.workshop-signal-cell')].map(cell=>getComputedStyle(cell).backgroundColor);
      return{earned:dock.dataset.workshopState==='earned',seen:+dock.dataset.workshopSeen,shader:dock.dataset.workshopShader,eggo:eggo.dataset.eggoState,
        fallbackVisible:!document.getElementById('workshop-eggo-fallback').hidden,meshHidden:document.getElementById('workshop-eggo-canvas').hidden,
        labelVisible:getComputedStyle(label).display!=='none',cells,scanAnimationName:scan.animationName,
        ctaTransition:cta.transitionDuration,dockTransition:dockStyle.transitionDuration,transform:cta.transform,
        draws:window.__workshopFx.drawCounters};
    });
    assert(reduced.earned&&reduced.seen===3&&reduced.labelVisible,'reduced motion lost earned state or copy');
    assert(reduced.eggo==='static'&&reduced.fallbackVisible&&reduced.meshHidden,'reduced motion did not keep the static Eggo fallback');
    assert(reduced.shader==='disabled'&&reduced.draws.eggo===0&&reduced.draws.shader===0,'reduced motion initialized an animated workshop canvas');
    assert(reduced.cells.every(color=>color==='rgb(45, 226, 230)'),'reduced motion did not visibly fill all signal cells');
    assert(reduced.scanAnimationName==='none','reduced motion did not disable the scan animation');
    assert(isZeroDuration(reduced.ctaTransition)&&isZeroDuration(reduced.dockTransition),'reduced motion did not remove workshop transitions');
    assert(reduced.transform==='none','reduced motion did not remove the CTA hover transform');
    const keyboard=await focusAndActivateCta(page);
    assert(requests.filter(isEgghead).length===0,'reduced-motion keyboard interception contacted egghead');
    assert(!errors.length,`reduced-motion page errors: ${errors.join('; ')}`);
    if(receiptDir)await page.screenshot({path:path.join(receiptDir,'reduced-motion.png')});
    return{earned:reduced.earned,eggo:reduced.eggo,shader:reduced.shader,scanAnimationName:reduced.scanAnimationName,
      keyboard:{focused:keyboard.focused,activatedWithEnter:keyboard.activatedWithEnter}};
  }finally{await page.close();}
}

async function runWebglFailure(browser,baseUrl,receiptDir,timeoutMs){
  const{page,errors}=await openPage(browser,baseUrl,{width:1440,height:900},{webglFailure:true});
  page.setDefaultTimeout(timeoutMs);
  try{
    const state=await page.evaluate(()=>({
      eggo:document.getElementById('workshop-eggo').dataset.eggoState,
      shader:document.getElementById('workshop-dock').dataset.workshopShader,
      fallbackVisible:!document.getElementById('workshop-eggo-fallback').hidden,
      meshHidden:document.getElementById('workshop-eggo-canvas').hidden,
      ctaVisible:document.getElementById('workshop-cta').getBoundingClientRect().width>0,
      cards:document.querySelectorAll('.game-card').length
    }));
    assert(state.eggo==='static'&&state.fallbackVisible&&state.meshHidden,'WebGL failure did not reveal static Eggo');
    assert(state.shader==='failed','WebGL failure did not disable the dock shader');
    assert(state.ctaVisible&&state.cards===GAME_COUNT,'WebGL failure broke the CTA or gallery');
    assert(!errors.length,`WebGL failure produced page errors: ${errors.join('; ')}`);
    if(receiptDir)await page.screenshot({path:path.join(receiptDir,'webgl-failure.png')});
    return state;
  }finally{await page.close();}
}

async function runWorkshopBrowserChecks({baseUrl,root,timeoutMs=20000,receiptDir}={}){
  assert(Boolean(baseUrl)!==Boolean(root),'provide exactly one of baseUrl or root');
  let localServer=null,browser=null;
  if(receiptDir){receiptDir=path.resolve(receiptDir);await fs.promises.mkdir(receiptDir,{recursive:true});}
  try{
    if(root){localServer=await startStaticServer(root);baseUrl=localServer.baseUrl;}
    const siteUrl=new URL(baseUrl);if(!siteUrl.pathname.endsWith('/'))siteUrl.pathname+='/';
    const source=await fetchText(siteUrl.href,timeoutMs);
    const fxSource=await fetchText(new URL('workshop-fx.js',siteUrl).href,timeoutMs);
    const eggoBytes=await fetchBytes(new URL('eggo.svg',siteUrl).href,timeoutMs);
    assert(hash(eggoBytes)===EGGO_HASH,'eggo.svg does not match the reviewed mdflow asset');
    runAdversarialAudits(source,fxSource);
    const puppeteer=require('puppeteer');
    const launchArgs=process.env.CI?['--no-sandbox','--disable-setuid-sandbox']:[];
    browser=await puppeteer.launch({headless:true,args:launchArgs});
    const desktop=await runDesktop(browser,siteUrl.href,receiptDir,timeoutMs);
    const mobile390=await runMobile(browser,siteUrl.href,390,844,receiptDir,timeoutMs);
    const mobile360=await runMobile(browser,siteUrl.href,360,640,receiptDir,timeoutMs);
    const reducedMotion=await runReducedMotion(browser,siteUrl.href,receiptDir,timeoutMs);
    const webglFailure=await runWebglFailure(browser,siteUrl.href,receiptDir,timeoutMs);
    const receipt={schema:2,surface:'workshop-funnel',baseOrigin:siteUrl.origin,gameCount:GAME_COUNT,eggoHash:EGGO_HASH,
      viewports:[{name:'desktop',width:1440,height:900},{name:'mobile-390x844',width:390,height:844},
        {name:'mobile-360x640',width:360,height:640},{name:'reduced-motion',width:1440,height:900},{name:'webgl-failure',width:1440,height:900}],
      initialState:desktop.initial,progression:desktop.progression,earnedState:desktop.earnedState,activePosition:desktop.activePosition,
      outbound:desktop.outbound,keyboard:desktop.keyboard,stretch:desktop.stretch,shader:desktop.shader,
      reducedMotion:{earned:reducedMotion.earned,eggo:reducedMotion.eggo,shader:reducedMotion.shader,scanAnimationName:reducedMotion.scanAnimationName},
      webglFailure:{eggo:webglFailure.eggo,shader:webglFailure.shader},network:desktop.network,
      layout:{desktopFooterHeight:desktop.layout.footer.height,desktopTrackHeight:desktop.layout.track.height,
        mobileFooterHeight:mobile390.footerHeight,mobileTrackHeight:mobile390.trackHeight,mobile360FooterHeight:mobile360.footerHeight,
        mobile360TrackHeight:mobile360.trackHeight,horizontalOverflow:mobile390.horizontalOverflow||mobile360.horizontalOverflow,
        trackOverlap:desktop.layout.overlap||mobile390.trackOverlap||mobile360.trackOverlap},ok:true};
    if(receiptDir)await fs.promises.writeFile(path.join(receiptDir,'browser-check.json'),JSON.stringify(receipt,null,2)+'\n');
    return receipt;
  }finally{
    if(browser)await browser.close().catch(()=>{});
    await closeServer(localServer?.server);
  }
}

function cliArgs(argv){
  const options={};
  for(let i=0;i<argv.length;i++){
    const value=argv[i];
    if(value==='--root'||value==='--base'){
      if(!argv[i+1])throw new Error(`${value} requires a value`);
      options[value.slice(2)]=argv[++i];
    }else throw new Error(`unknown argument: ${value}`);
  }
  return options;
}

if(require.main===module)(async()=>{
  const options=cliArgs(process.argv.slice(2));
  await runWorkshopBrowserChecks({baseUrl:options.base,root:options.root&&path.resolve(options.root),
    receiptDir:process.env.MINIARCADE_FUNNEL_RECEIPTS||undefined});
  console.log('workshop funnel: dock ✓ Eggo stretch ✓ mouse shader ✓ mobile ✓ reduced-motion ✓ WebGL fallback ✓');
})().catch(error=>{console.error(error.stack||error);process.exit(1);});

module.exports={WORKSHOP_URL,EGGO_HASH,auditWorkshopMarkup,runWorkshopBrowserChecks};
