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

  addError(errors,/^<button\b/i.test(eggoTag)&&attribute(eggoTag,'type')==='button'&&!attribute(eggoTag,'role')&&
    /\sdisabled(?:\s|>)/i.test(eggoTag)&&/egghead\.io mascot/i.test(attribute(eggoTag,'aria-label')||''),
    'EGGO_A11Y','Eggo must begin as a labeled disabled button until its interactive mesh is ready');
  addError(errors,attribute(fallbackTag,'src')==='eggo.svg'&&attribute(fallbackTag,'alt')===''&&attribute(fallbackTag,'draggable')==='false',
    'EGGO_FALLBACK','Eggo needs the exact local static fallback');
  addError(errors,/\.workshop-eggo img\[hidden\],\.workshop-eggo:not\(:disabled\) img\s*\{[^}]*display\s*:\s*none!important\b[^}]*\}/.test(html),
    'EGGO_LAYER','the static Eggo fallback must be removed from rendering whenever the mesh is interactive');
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
    const compactFx=fxSource.replace(/\s+/g,'');
    const keyHandler=compactFx.split('constonKeyDown=')[1]?.split('constonClick=')[0]||'';
    const repeatGuard='if(e.repeat){e.preventDefault();return;}';
    const keyHandlerWithoutRepeat=keyHandler.replace(repeatGuard,'');
    addError(errors,compactFx.includes('setPointerCapture(pointerId)')&&
      /releasePointerCapture\((?:pointerId|releasedPointer)\)/.test(compactFx),
      'POINTER_CAPTURE','Eggo must capture and release the drag pointer');
    addError(errors,/Math\.exp\(-\(dx\*dx\+dy\*dy\)\/.+fallRadius/.test(compactFx)&&compactFx.includes('spring=190,damping=9.5'),
      'STRETCH_PHYSICS','Eggo must retain Gaussian pull and spring return');
    addError(errors,compactFx.includes('tapSlop=Math.max(6,Math.min(10,Math.min(artW,artH)*0.18))')&&
      /reason==='pointerup'&&gestureDistance<tapSlop&&elapsed<400(?:;|&&|\|\||\))/.test(compactFx)&&
      compactFx.includes('releaseDistance=Math.hypot(point[0]-grabX,point[1]-grabY)')&&
      compactFx.includes('boopVelocity=540*Math.min(artW,artH)/124')&&compactFx.includes("setEggoState('booping')")&&
      compactFx.includes("addEventListener('keydown',onKeyDown)")&&compactFx.includes("addEventListener('keyup',onKeyUp)")&&
      compactFx.includes("eggo.addEventListener('blur',resetKeyboardActivation)")&&
      compactFx.includes("window.addEventListener('blur',resetKeyboardActivation)")&&
      compactFx.includes("addEventListener('click',onClick)")&&
      compactFx.includes('keyboardActivations.add(e.key)')&&compactFx.includes('keyboardActivations.has(e.key)')&&
      compactFx.includes('keyboardSource=e.key')&&
      keyHandler.includes(repeatGuard)&&!keyHandler.includes('boop(')&&!keyHandler.includes('.click(')&&
      !keyHandlerWithoutRepeat.includes('preventDefault(')&&
      compactFx.includes("constkey=keyboardActivations.has(keyboardSource)?keyboardSource:''")&&
      compactFx.includes("keyboardSource=remaining[remaining.length-1]||''")&&
      compactFx.includes("source=key?'keyboard':'semantic'")&&
      compactFx.includes('e.detail>0&&performance.now()-lastPointerRelease<700')&&
      compactFx.includes('oscillator.frequency.setValueAtTime(340,t)')&&
      compactFx.includes('oscillator.frequency.exponentialRampToValueAtTime(150,t+0.09)')&&
      compactFx.includes("newCustomEvent('miniarcade:boop',{detail:{source}})"),
      'BOOP_PHYSICS','Eggo boop must use release-aware tap slop, the mdflow tone, and one non-repeating native click path with interruption-safe source attribution');
    addError(errors,compactFx.includes('vec2toCta=u_cta.xy-u_mouse')&&
      /(?:spotlightSide\+spotlightWobble|spotlightWobble\+spotlightSide)/.test(compactFx)&&
      compactFx.includes('uniformfloatu_spotlightWobble;')&&compactFx.includes('u_spotlightWobble*min(')&&
      compactFx.includes('color+=u_spotlight*spotlight')&&
      compactFx.includes('debug.captureSpotlightPair=()=>')&&
      compactFx.includes('gl.getUniform(program,uSpotlight)')&&compactFx.includes('gl.getUniform(program,uSpotlightWobble)')&&
      compactFx.includes('gl.getUniform(program,uWobbleTime)')&&
      /noise\(vec2\(spotlightT\*7(?:\.0*)?-u_wobbleTime\*1\.4/.test(compactFx)&&
      compactFx.includes('spotlightT*24.0-u_time*5.0')&&compactFx.includes('mix(orange,cyan,spotlightT*0.8)'),
      'SPOTLIGHT_SHADER','mouse shader must retain a signed, live-bound, temporally wobbling pointer-to-CTA spotlight');
    addError(errors,compactFx.includes('premultipliedAlpha:true,preserveDrawingBuffer:true')&&
      compactFx.includes('debug.captureEggoPixels=()=>')&&compactFx.includes('gl.readPixels(0,0,eggoCanvas.width,eggoCanvas.height')&&
      compactFx.includes('premultipliedAlpha:false,preserveDrawingBuffer:false'),
      'FRAMEBUFFER_LIFECYCLE','Eggo must expose source-bound exact pixels while the animated dock shader releases its framebuffer');
    addError(errors,compactFx.includes('eggo.disabled=true')&&compactFx.includes('eggo.disabled=false')&&
      compactFx.includes('staticEggoLabel')&&compactFx.includes('interactiveEggoLabel'),
      'EGGO_FALLBACK_CONTROL','static fallback states must disable the boop control and mesh readiness must enable it');
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
    ['non-button mascot',()=>[html.replace('<button id="workshop-eggo"','<span id="workshop-eggo"'),fxSource]],
    ['missing button type',()=>[html.replace('class="workshop-eggo" type="button"','class="workshop-eggo"'),fxSource]],
    ['enabled static mascot',()=>[html.replace('data-eggo-state="static" disabled','data-eggo-state="static"'),fxSource]],
    ['visible fallback layer',()=>[html.replace(/\.workshop-eggo img\[hidden\],\.workshop-eggo:not\(:disabled\) img\s*\{\s*display\s*:\s*none!important\s*\}/,'.workshop-eggo img[hidden],.workshop-eggo:not(:disabled) img{display:block!important}'),fxSource]],
    ['remote mascot',()=>[html.replace('src="eggo.svg"','src="https://egghead.io/eggo.svg"'),fxSource]],
    ['interactive shader',()=>[html.replace('pointer-events:none;mix-blend-mode','pointer-events:auto;mix-blend-mode'),fxSource]],
    ['missing pointer capture',()=>[html,fxSource.replace(/eggo\.setPointerCapture\(\s*pointerId\s*\)/,'eggo.hasPointerCapture(pointerId)')]],
    ['long boop window',()=>[html,fxSource.replace(/gestureDistance\s*<\s*tapSlop\s*&&\s*elapsed\s*<\s*400\b/,'gestureDistance<tapSlop&&elapsed<4000')]],
    ['missing release displacement',()=>[html,fxSource.replace(/releaseDistance\s*=\s*Math\.hypot\(\s*point\[0\]\s*-\s*grabX\s*,\s*point\[1\]\s*-\s*grabY\s*\)/,'releaseDistance=0')]],
    ['missing semantic activation',()=>[html,fxSource.replace(/eggo\.addEventListener\(\s*'click'\s*,\s*onClick\s*\)/,"eggo.addEventListener('auxclick',onClick)")]],
    ['keyboard bypasses click',()=>[html,fxSource.replace(/keyboardActivations\.add\(\s*e\.key\s*\)\s*;/,"boop(pad+artW/2,pad+artH/2,'keyboard');")]],
    ['keyboard dispatches click',()=>[html,fxSource.replace(/keyboardActivations\.add\(\s*e\.key\s*\)\s*;/,'keyboardActivations.add(e.key);eggo.click();')]],
    ['keyboard repeat clicks',()=>[html,fxSource.replace(/if\s*\(\s*e\.repeat\s*\)\s*\{\s*e\.preventDefault\(\s*\)\s*;\s*return\s*;\s*\}/,'if(e.repeat)return;')]],
    ['drops overlapping key',()=>[html,fxSource.replace(/keyboardSource\s*=\s*remaining\[remaining\.length\s*-\s*1\]\s*\|\|\s*''\s*;/,"keyboardSource='';")]],
    ['stale keyboard modality',()=>[html,fxSource.replace(/eggo\.addEventListener\(\s*'blur'\s*,\s*resetKeyboardActivation\s*\)/,"eggo.addEventListener('blur',()=>{})")]],
    ['enabled fallback control',()=>[html,fxSource.replace(/eggo\.disabled\s*=\s*true/,'eggo.disabled=false')]],
    ['missing boop tone',()=>[html,fxSource.replace(/oscillator\.frequency\.setValueAtTime\(\s*340\s*,\s*t\s*\)/,'oscillator.frequency.setValueAtTime(1,t)')]],
    ['missing boop signal',()=>[html,fxSource.replace(/new CustomEvent\(\s*'miniarcade:boop'/,"new CustomEvent('miniarcade:no-boop'")]],
    ['unscaled boop impulse',()=>[html,fxSource.replace(/540\s*\*\s*Math\.min\(\s*artW\s*,\s*artH\s*\)\s*\/\s*124/,'540*Math.min(artW,artH)/1')]],
    ['discarded Eggo framebuffer',()=>[html,fxSource.replace(/premultipliedAlpha\s*:\s*true\s*,\s*preserveDrawingBuffer\s*:\s*true/,'premultipliedAlpha:true,preserveDrawingBuffer:false')]],
    ['missing spotlight',()=>[html,fxSource.replace(/color\s*\+=\s*u_spotlight\s*\*\s*spotlight/,'color+=0.0*spotlight')]],
    ['missing spotlight bend',()=>[html,fxSource.replace(/\*\s*u_spotlightWobble\s*\*\s*min\s*\(\s*16(?:\.0*)?\s*,\s*u_resolution\.y\s*\*\s*(?:0?\.24)\s*\)/,'*0.0*min(16.0,u_resolution.y*0.24)')]],
    ['static spotlight bend',()=>[html,fxSource.replace(/noise\s*\(\s*vec2\s*\(\s*spotlightT\s*\*\s*7(?:\.0*)?\s*-\s*u_wobbleTime\s*\*\s*1\.4\s*,\s*13\.1\s*\)\s*\)/,'0.0')]],
    ['split spotlight centerline',()=>[html,fxSource.replace(/(?:spotlightSide\s*\+\s*spotlightWobble|spotlightWobble\s*\+\s*spotlightSide)/,'abs(spotlightSide)+spotlightWobble')]],
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
  page.on('pageerror',error=>errors.push(error.stack||error.message));
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
      eggo:eggo.dataset.eggoState,eggoDisabled:eggo.disabled,eggoLabel:eggo.getAttribute('aria-label'),cards:document.querySelectorAll('.game-card').length,
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
async function waitForPresentation(page){
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function captureEggoPixels(page){
  const pixels=await page.evaluate(()=>window.__workshopFx.captureEggoPixels());
  assert(Array.isArray(pixels)&&pixels.length>0,'Eggo native-pixel capture is unavailable');
  return Buffer.from(pixels);
}
function spotlightEvidence(pair,later){
  const captures=['off','straight','bent'];
  assert(pair&&later&&captures.every(name=>Array.isArray(pair[name])&&pair[name].length===pair.off.length&&
    Array.isArray(later[name])&&later[name].length===pair.off.length),
  'source-bound spotlight capture is unavailable');
  assert(pair.live?.spotlight>=0.99&&pair.live?.wobble>=0.99&&
    later.live?.spotlight>=0.99&&later.live?.wobble>=0.99,
  `spotlight probe did not inherit enabled live uniforms (${JSON.stringify({first:pair.live,later:later.live})})`);
  const liveTimeDelta=later.live.time-pair.live.time;
  assert(liveTimeDelta>=0.2,
    `live spotlight time did not advance (${JSON.stringify({first:pair.live.time,later:later.live.time})})`);
  const vx=pair.cta.x-pair.mouse.x,vy=pair.cta.y-pair.mouse.y,length=Math.max(1,Math.hypot(vx,vy)),length2=length*length;
  const pixelDelta=(left,right,offset)=>Math.max(
    Math.abs(left[offset]-right[offset]),Math.abs(left[offset+1]-right[offset+1]),
    Math.abs(left[offset+2]-right[offset+2]),Math.abs(left[offset+3]-right[offset+3])
  );
  let changed=0,corridor=0,bendChanged=0,bendChangedLater=0;const bins=new Set();
  const summarize=(render,baseline)=>{
    const weights=[0,0,0,0],signed=[0,0,0,0];
    for(let pixel=0;pixel<pair.width*pair.height;pixel++){
      const offset=pixel*4,x=pixel%pair.width,y=Math.floor(pixel/pair.width);
      const px=x-pair.mouse.x,py=y-pair.mouse.y;
      const t=(px*vx+py*vy)/length2;
      const side=(px*vy-py*vx)/length;
      if(t<=0.08||t>=0.92||Math.abs(side)>=24)continue;
      const weight=Math.max(0,render[offset]-baseline[offset])+
        Math.max(0,render[offset+1]-baseline[offset+1])+
        Math.max(0,render[offset+2]-baseline[offset+2]);
      if(weight<=0)continue;
      const bin=Math.min(3,Math.floor((t-0.08)/0.84*4));
      weights[bin]+=weight;
      signed[bin]+=side*weight;
    }
    return weights.map((weight,index)=>weight?signed[index]/weight:null);
  };
  for(let pixel=0;pixel<pair.width*pair.height;pixel++){
    const offset=pixel*4;
    if(pixelDelta(pair.bent,pair.straight,offset)>=2)bendChanged++;
    if(pixelDelta(pair.bent,pair.off,offset)<2)continue;
    changed++;
    const x=pixel%pair.width,y=Math.floor(pixel/pair.width);
    const px=x-pair.mouse.x,py=y-pair.mouse.y;
    const t=(px*vx+py*vy)/length2;
    const distance=Math.abs(px*vy-py*vx)/length;
    if(t>0.08&&t<0.92&&distance<18){corridor++;bins.add(Math.min(3,Math.floor(t*4)));}
  }
  for(let pixel=0;pixel<pair.width*pair.height;pixel++){
    if(pixelDelta(later.bent,later.straight,pixel*4)>=2)bendChangedLater++;
  }
  const straightCenters=summarize(pair.straight,pair.off),bentCenters=summarize(pair.bent,pair.off);
  const straightLater=summarize(later.straight,later.off),bentLater=summarize(later.bent,later.off);
  const signedShifts=bentCenters.map((center,index)=>center===null||straightCenters[index]===null?0:center-straightCenters[index]);
  const signedLater=bentLater.map((center,index)=>center===null||straightLater[index]===null?0:center-straightLater[index]);
  const shifts=signedShifts.map(Math.abs),laterShifts=signedLater.map(Math.abs);
  const combinedShifts=shifts.map((shift,index)=>Math.max(shift,laterShifts[index]));
  const temporalShifts=signedShifts.map((shift,index)=>Math.abs(shift-signedLater[index]));
  const shiftedBins=combinedShifts.filter(shift=>shift>=0.2).length;
  const temporalBins=temporalShifts.filter(shift=>shift>=0.15).length;
  const maxShift=Math.max(...combinedShifts),maxTemporalShift=Math.max(...temporalShifts);
  assert(changed>=40&&corridor>=24&&bins.size>=3,
    `spotlight ablation lacked a distributed pointer-to-CTA beam (${JSON.stringify({changed,corridor,bins:[...bins]})})`);
  assert(bendChanged+bendChangedLater>=20&&shiftedBins>=1&&maxShift>=0.25,
    `spotlight wobble did not bend the beam centerline (${JSON.stringify({bendChanged,bendChangedLater,straightCenters,bentCenters,straightLater,bentLater,combinedShifts})})`);
  assert(temporalBins>=1&&maxTemporalShift>=0.2,
    `spotlight centerline did not wobble over time (${JSON.stringify({signedShifts,signedLater,temporalShifts})})`);
  return{liveBound:true,liveTimeDelta:+liveTimeDelta.toFixed(3),
    changedPixels:changed,corridorPixels:corridor,corridorBins:bins.size,
    bendChangedPixels:bendChanged+bendChangedLater,bendShiftBins:shiftedBins,maxBendShift:+maxShift.toFixed(3),
    temporalShiftBins:temporalBins,maxTemporalShift:+maxTemporalShift.toFixed(3)};
}

async function exerciseEggo(page){
  await page.waitForFunction(()=>['ready','idle'].includes(document.getElementById('workshop-eggo').dataset.eggoState));
  await page.waitForFunction(()=>window.__workshopFx&&!window.__workshopFx.eggoRafActive);
  await page.evaluate(()=>{document.getElementById('workshop-fx-canvas').style.visibility='hidden';});
  await waitForPresentation(page);
  const beforeState=await page.evaluate(()=>{
    const eggo=document.getElementById('workshop-eggo'),fallback=document.getElementById('workshop-eggo-fallback'),canvas=document.getElementById('workshop-eggo-canvas');
    const r=eggo.getBoundingClientRect(),fallbackRect=fallback.getBoundingClientRect(),canvasRect=canvas.getBoundingClientRect();
    return{active:document.querySelector('.game-card.is-active')?.dataset.index,
      position:document.getElementById('position').textContent.trim(),scroll:document.getElementById('game-track').scrollLeft,
      footer:document.querySelector('.site-footer').getBoundingClientRect().height,rect:{x:r.left+r.width/2,y:r.top+r.height/2},
      disabled:eggo.disabled,label:eggo.getAttribute('aria-label'),
      layers:{fallbackHidden:fallback.hidden,fallbackDisplay:getComputedStyle(fallback).display,fallbackWidth:fallbackRect.width,
        canvasHidden:canvas.hidden,canvasDisplay:getComputedStyle(canvas).display,canvasWidth:canvasRect.width},
      events:{...window.__workshopFx.events}};
  });
  assert(beforeState.layers.fallbackHidden&&beforeState.layers.fallbackDisplay==='none'&&beforeState.layers.fallbackWidth===0,
    `static Eggo is still visible beneath the mesh (${JSON.stringify(beforeState.layers)})`);
  assert(!beforeState.layers.canvasHidden&&beforeState.layers.canvasDisplay!=='none'&&beforeState.layers.canvasWidth>0,
    'deformable Eggo canvas is not the sole visible layer');
  assert(!beforeState.disabled&&/tap to boop, grab to stretch/i.test(beforeState.label),
    'ready Eggo mesh did not enable and label the interactive control');
  const rest=await captureEggoPixels(page);

  await page.mouse.move(beforeState.rect.x,beforeState.rect.y);
  await page.mouse.down();
  await delay(35);
  await page.mouse.up();
  assert(await page.evaluate(()=>document.activeElement?.id==='workshop-eggo'),'pointer activation did not preserve native Eggo focus');
  await page.waitForFunction(count=>window.__workshopFx.events.pointerBoop===count+1,{},beforeState.events.pointerBoop);
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='booping');
  await delay(45);
  const booped=await captureEggoPixels(page);
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='idle');
  await page.waitForFunction(()=>!window.__workshopFx.eggoRafActive);
  await page.evaluate(()=>document.activeElement?.blur());
  await waitForPresentation(page);
  const afterBoop=await captureEggoPixels(page);
  assert(hash(rest)!==hash(booped),'clean pointer tap did not visibly boop Eggo');
  assert(hash(rest)===hash(afterBoop),'pointer boop did not restore exact rest pixels');

  const boopsAfterTap=await page.evaluate(()=>window.__workshopFx.events.pointerBoop);
  await page.mouse.move(beforeState.rect.x,beforeState.rect.y);
  await page.mouse.down();
  await delay(430);
  await page.mouse.up();
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='idle');
  const afterLongPress=await page.evaluate(()=>({...window.__workshopFx.events}));
  assert(afterLongPress.pointerBoop===boopsAfterTap&&afterLongPress.longPressRejected===beforeState.events.longPressRejected+1,
    'long press incorrectly triggered a boop');

  await page.evaluate(point=>{
    const eggo=document.getElementById('workshop-eggo');
    eggo.dispatchEvent(new PointerEvent('pointerdown',{
      bubbles:true,pointerId:71,pointerType:'mouse',isPrimary:true,button:0,
      clientX:point.x,clientY:point.y
    }));
    eggo.dispatchEvent(new PointerEvent('pointerup',{
      bubbles:true,pointerId:71,pointerType:'mouse',isPrimary:true,button:0,
      clientX:point.x+30,clientY:point.y+8
    }));
  },beforeState.rect);
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='idle');
  const afterDroppedMove=await page.evaluate(()=>({...window.__workshopFx.events}));
  assert(afterDroppedMove.pointerBoop===boopsAfterTap&&afterDroppedMove.dragRelease===beforeState.events.dragRelease+1,
    'pointerup displacement without pointermove incorrectly triggered a boop');

  await page.mouse.move(beforeState.rect.x,beforeState.rect.y);
  await page.mouse.down();
  await page.mouse.move(beforeState.rect.x+30,beforeState.rect.y+10,{steps:4});
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='dragging');
  await delay(90);
  const pulled=await captureEggoPixels(page);
  await page.mouse.up();
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='idle');
  await waitForPresentation(page);
  const settled=await captureEggoPixels(page);
  const afterDrag=await page.evaluate(()=>({events:{...window.__workshopFx.events},
    active:document.querySelector('.game-card.is-active')?.dataset.index,
    position:document.getElementById('position').textContent.trim(),scroll:document.getElementById('game-track').scrollLeft,
    footer:document.querySelector('.site-footer').getBoundingClientRect().height}));
  assert(afterDrag.events.pointerBoop===boopsAfterTap&&afterDrag.events.dragRelease===beforeState.events.dragRelease+2&&
    afterDrag.events.semanticBoop===beforeState.events.semanticBoop,
    'pointer gesture double-fired semantic activation or stretch drag incorrectly triggered a boop');
  assert(beforeState.active===afterDrag.active&&beforeState.position===afterDrag.position,'pointer Eggo interaction changed gallery selection');
  assert(Math.abs(beforeState.scroll-afterDrag.scroll)<1,'pointer Eggo interaction moved the gallery rail');
  assert(Math.abs(beforeState.footer-afterDrag.footer)<1,'pointer Eggo interaction changed footer height');

  await page.evaluate(()=>{
    window.__eggoCtaClicks=0;
    window.__eggoNativeClicks=0;
    document.getElementById('workshop-cta').addEventListener('click',()=>window.__eggoCtaClicks++);
    document.getElementById('workshop-eggo').addEventListener('click',()=>window.__eggoNativeClicks++);
    document.activeElement?.blur();
  });
  let focused=false;
  for(let i=0;i<60;i++){
    await page.keyboard.press('Tab');
    focused=await page.evaluate(()=>document.activeElement?.id==='workshop-eggo');
    if(focused)break;
  }
  assert(focused,'real Tab navigation did not reach the Eggo boop button');
  const focus=await page.evaluate(()=>{const style=getComputedStyle(document.activeElement);return{style:style.outlineStyle,width:parseFloat(style.outlineWidth)||0};});
  assert(focus.style!=='none'&&focus.width>=1,'Eggo boop button lacks a visible focus outline');
  const keyboardStart=afterDrag.events.keyboardBoop;
  const semanticStart=afterDrag.events.semanticBoop;
  const keyboardRest=await captureEggoPixels(page);
  await page.keyboard.down('Enter');
  await page.waitForFunction(count=>window.__workshopFx.events.keyboardBoop===count+1&&window.__eggoNativeClicks===1,{},keyboardStart);
  await page.keyboard.down('Enter');
  await delay(45);
  const enterRepeat=await page.evaluate(()=>({
    keyboard:window.__workshopFx.events.keyboardBoop,
    semantic:window.__workshopFx.events.semanticBoop,
    clicks:window.__eggoNativeClicks
  }));
  assert(enterRepeat.keyboard===keyboardStart+1&&enterRepeat.semantic===semanticStart&&enterRepeat.clicks===1,
    'repeated Enter keydown emitted an extra native click or boop');
  await page.keyboard.up('Enter');
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='booping');
  const enterBoop=await captureEggoPixels(page);
  assert(hash(keyboardRest)!==hash(enterBoop),'Enter native click did not visibly boop Eggo');
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='idle');
  await page.keyboard.down('Space');
  await delay(45);
  const spaceDown=await page.evaluate(()=>({boops:window.__workshopFx.events.keyboardBoop,clicks:window.__eggoNativeClicks}));
  assert(spaceDown.boops===keyboardStart+1&&spaceDown.clicks===1,
    'Space activated Eggo on keydown instead of the native keyup click');
  await page.keyboard.up('Space');
  await page.waitForFunction(count=>window.__workshopFx.events.keyboardBoop===count+2&&window.__eggoNativeClicks===2,{},keyboardStart);
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='booping');
  await delay(45);
  const spaceBoop=await captureEggoPixels(page);
  assert(hash(keyboardRest)!==hash(spaceBoop),'Space native click did not visibly boop Eggo');
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='idle');
  await page.keyboard.down('Space');
  await page.keyboard.down('Enter');
  await page.waitForFunction(count=>window.__workshopFx.events.keyboardBoop===count+3&&window.__eggoNativeClicks===3,{},keyboardStart);
  await page.keyboard.up('Enter');
  await page.evaluate(()=>document.getElementById('workshop-eggo').click());
  await page.waitForFunction(count=>window.__workshopFx.events.keyboardBoop===count+4&&window.__eggoNativeClicks===4,{},keyboardStart);
  await page.evaluate(()=>{
    document.body.tabIndex=-1;
    document.body.focus();
  });
  await page.keyboard.up('Space');
  const overlapping=await page.evaluate(()=>({
    keyboard:window.__workshopFx.events.keyboardBoop,
    semantic:window.__workshopFx.events.semanticBoop,
    clicks:window.__eggoNativeClicks
  }));
  assert(overlapping.keyboard===keyboardStart+4&&overlapping.semantic===semanticStart&&overlapping.clicks===4,
    'overlapping Space and Enter activations lost their keyed click attribution');
  const keyboardAfterOverlap=overlapping.keyboard;
  const nativeAfterOverlap=overlapping.clicks;
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='idle');
  await page.focus('#workshop-eggo');
  await page.keyboard.down('Space');
  await page.evaluate(()=>{
    document.body.tabIndex=-1;
    document.body.focus();
  });
  await page.keyboard.up('Space');
  await delay(30);
  const interrupted=await page.evaluate(()=>({
    keyboard:window.__workshopFx.events.keyboardBoop,
    semantic:window.__workshopFx.events.semanticBoop,
    clicks:window.__eggoNativeClicks
  }));
  assert(interrupted.keyboard===keyboardAfterOverlap&&interrupted.semantic===semanticStart&&interrupted.clicks===nativeAfterOverlap,
    'interrupted Space activation emitted a click or retained keyboard activation');
  await page.evaluate(()=>document.getElementById('workshop-eggo').click());
  await page.waitForFunction((count,native)=>window.__workshopFx.events.semanticBoop===count+1&&window.__eggoNativeClicks===native+1,
    {},semanticStart,nativeAfterOverlap);
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='booping');
  await delay(45);
  const semanticBoop=await captureEggoPixels(page);
  assert(hash(keyboardRest)!==hash(semanticBoop),'semantic click changed the boop counter without changing Eggo pixels');
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='idle');

  const afterState=await page.evaluate(()=>({
    active:document.querySelector('.game-card.is-active')?.dataset.index,
    position:document.getElementById('position').textContent.trim(),scroll:document.getElementById('game-track').scrollLeft,
    footer:document.querySelector('.site-footer').getBoundingClientRect().height,
    raf:window.__workshopFx.eggoRafActive,events:{...window.__workshopFx.events},
    ctaClicks:window.__eggoCtaClicks,nativeClicks:window.__eggoNativeClicks
  }));
  await page.evaluate(()=>document.activeElement?.blur());
  await waitForPresentation(page);
  const finalRest=await captureEggoPixels(page);
  await page.evaluate(()=>{document.getElementById('workshop-fx-canvas').style.visibility='';});
  assert(hash(rest)!==hash(pulled),'real pointer drag did not change Eggo pixels');
  assert(hash(rest)===hash(settled)&&hash(rest)===hash(finalRest),
    `Eggo did not return to its exact rest pixels (${JSON.stringify({rest:hash(rest),settled:hash(settled),final:hash(finalRest)})})`);
  assert(afterState.events.keyboardBoop===keyboardAfterOverlap&&afterState.events.semanticBoop===semanticStart+1&&
    afterState.nativeClicks===nativeAfterOverlap+1&&afterState.ctaClicks===0,
  'keyboard and semantic activation must converge on exactly one native Eggo click without triggering the CTA');
  assert(!afterState.raf,'Eggo retained an animation frame after settling');
  return{singleLayer:true,pointerBoop:true,keyboardBoops:afterState.events.keyboardBoop-keyboardStart,
    semanticBoop:true,nativeClickActivations:afterState.nativeClicks,
    repeatSuppressed:true,overlappingKeys:true,interruptedSourceReset:true,droppedMoveSuppressed:true,
    dragSuppressed:true,longPressSuppressed:true,keyboardPixels:true,restored:true,events:afterState.events};
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
  const spotlightPair=await page.evaluate(()=>window.__workshopFx.captureSpotlightPair());
  await delay(600);
  const spotlightLater=await page.evaluate(()=>window.__workshopFx.captureSpotlightPair());
  const spotlight=spotlightEvidence(spotlightPair,spotlightLater);
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
  return{responsive:true,spotlight:{proved:true,...spotlight},draws:debug.draws,
    resolution:{width:geometry.canvasWidth,height:geometry.canvasHeight}};
}
async function exerciseContextLoss(page){
  const supported=await page.evaluate(()=>{
    const mesh=document.getElementById('workshop-eggo-canvas').getContext('webgl');
    const shader=document.getElementById('workshop-fx-canvas').getContext('webgl');
    const meshLoss=mesh?.getExtension('WEBGL_lose_context');
    const shaderLoss=shader?.getExtension('WEBGL_lose_context');
    if(!meshLoss||!shaderLoss)return false;
    meshLoss.loseContext();
    shaderLoss.loseContext();
    return true;
  });
  assert(supported,'browser does not expose WEBGL_lose_context for lifecycle evaluation');
  await page.waitForFunction(()=>{
    const eggo=document.getElementById('workshop-eggo');
    return eggo.dataset.eggoState==='static'&&eggo.disabled&&
      document.getElementById('workshop-eggo-fallback').hidden===false&&
      document.getElementById('workshop-eggo-canvas').hidden===true&&
      document.getElementById('workshop-dock').dataset.workshopShader==='failed'&&
      window.__workshopFx.captureEggoPixels===null&&window.__workshopFx.captureSpotlightPair===null;
  });
  return{meshFallback:true,shaderFailed:true,controlDisabled:true};
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
    assert(!initial.eggoDisabled&&/tap to boop, grab to stretch/i.test(initial.eggoLabel),'ready desktop Eggo control is disabled or mislabeled');
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
    const contextLoss=await exerciseContextLoss(page);
    assert(!errors.length,`live context loss produced page errors: ${errors.join('; ')}`);
    return{initial:{state:initial.state,seen:initial.seen,eggo:initial.eggo,shader:initial.shader},progression,
      earnedState:earned.state,activePosition:earned.position,outbound:keyboard.activation,
      keyboard:{focused:keyboard.focused,activatedWithEnter:keyboard.activatedWithEnter},stretch,shader,contextLoss,
      network:{eggheadRequestsBeforeActivation:requests.filter(isEgghead).length},layout,storage};
  }finally{await page.close();}
}

async function waitForGalleryStable(page){
  let previous=null,stable=0;
  for(let attempt=0;attempt<40;attempt++){
    const current=await page.evaluate(()=>({
      position:document.getElementById('position').textContent.trim(),
      scroll:document.getElementById('game-track').scrollLeft,
      active:document.querySelector('.game-card.is-active')?.dataset.index
    }));
    if(previous&&current.position===previous.position&&current.active===previous.active&&Math.abs(current.scroll-previous.scroll)<0.1)stable++;
    else stable=0;
    if(stable>=5)return current;
    previous=current;
    await delay(60);
  }
  throw new Error('gallery selection and smooth scroll did not settle');
}
async function touchPoint(page){
  return page.$eval('#workshop-eggo',element=>{const r=element.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
}
async function touchTap(page){
  const point=await touchPoint(page),before=await page.evaluate(()=>window.__workshopFx.events.pointerBoop);
  const client=await page.createCDPSession();
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1,radiusX:2,radiusY:2,force:1}]});
  await delay(20);
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+2,y:point.y+2,id:1,radiusX:2,radiusY:2,force:1}]});
  await delay(15);
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await client.detach();
  await page.waitForFunction(count=>window.__workshopFx.events.pointerBoop===count+1,{},before);
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='idle');
}
async function touchDrag(page){
  const point=await touchPoint(page),before=await page.evaluate(()=>({...window.__workshopFx.events}));
  const client=await page.createCDPSession();
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1,radiusX:2,radiusY:2,force:1}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+18,y:point.y+6,id:1,radiusX:2,radiusY:2,force:1}]});
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='dragging');
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await client.detach();
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='idle');
  const after=await page.evaluate(()=>({...window.__workshopFx.events}));
  assert(after.pointerBoop===before.pointerBoop&&after.dragRelease===before.dragRelease+1,'touch drag incorrectly triggered a boop');
}
async function touchCancel(page){
  const point=await touchPoint(page),before=await page.evaluate(()=>({...window.__workshopFx.events}));
  const client=await page.createCDPSession();
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1,radiusX:2,radiusY:2,force:1}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await client.detach();
  await page.waitForFunction(count=>window.__workshopFx.events.cancel===count+1,{},before.cancel);
  await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='idle');
  const after=await page.evaluate(()=>({...window.__workshopFx.events}));
  assert(after.pointerBoop===before.pointerBoop,'touch cancellation incorrectly triggered a boop');
}

async function runMobile(browser,baseUrl,width,height,receiptDir,timeoutMs){
  const{page,requests,errors}=await openPage(browser,baseUrl,{width,height,isMobile:true,hasTouch:true,deviceScaleFactor:1});
  page.setDefaultTimeout(timeoutMs);
  try{
    await page.waitForFunction(()=>['ready','idle'].includes(document.getElementById('workshop-eggo').dataset.eggoState));
    const before=await layoutState(page);
    for(let seen=1;seen<=3;seen++){await page.click('#next-game');await waitSeen(page,seen);}
    const galleryBefore=await waitForGalleryStable(page);
    await touchTap(page);
    await touchDrag(page);
    await touchCancel(page);
    const stableAfter=await waitForGalleryStable(page);
    const galleryAfter=await page.evaluate(stable=>({...stable,events:{...window.__workshopFx.events}}),stableAfter);
    const earned=await stateOf(page);const after=await layoutState(page);
    assert(earned.state==='earned'&&earned.seen===3,`${width}x${height} did not earn after three Next activations`);
    assert(!earned.eggoDisabled&&/tap to boop, grab to stretch/i.test(earned.eggoLabel),`${width}x${height} interactive Eggo is disabled or mislabeled`);
    assert(earned.shader==='disabled',`${width}x${height} should disable the mouse shader`);
    assert(galleryAfter.events.pointerBoop>=1&&galleryAfter.events.dragRelease>=1&&galleryAfter.events.cancel>=1&&
      galleryAfter.events.semanticBoop===0,`${width}x${height} did not distinguish touch tap, drag, cancel, and synthetic click suppression`);
    assert(galleryBefore.position===galleryAfter.position&&Math.abs(galleryBefore.scroll-galleryAfter.scroll)<1,
      `${width}x${height} mascot interaction moved the gallery (${JSON.stringify({galleryBefore,galleryAfter})})`);
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
      trackOverlap:after.overlap,ctaHeight:after.cta.height,touchBoop:true,touchStretch:true,touchCancel:true,events:galleryAfter.events};
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
      const fallback=document.getElementById('workshop-eggo-fallback'),mesh=document.getElementById('workshop-eggo-canvas');
      return{earned:dock.dataset.workshopState==='earned',seen:+dock.dataset.workshopSeen,shader:dock.dataset.workshopShader,eggo:eggo.dataset.eggoState,
        eggoDisabled:eggo.disabled,eggoLabel:eggo.getAttribute('aria-label'),
        fallbackVisible:!fallback.hidden&&getComputedStyle(fallback).display!=='none'&&fallback.getBoundingClientRect().width>0,
        meshHidden:mesh.hidden&&getComputedStyle(mesh).display==='none',
        labelVisible:getComputedStyle(label).display!=='none',cells,scanAnimationName:scan.animationName,
        ctaTransition:cta.transitionDuration,dockTransition:dockStyle.transitionDuration,transform:cta.transform,
        draws:window.__workshopFx.drawCounters};
    });
    assert(reduced.earned&&reduced.seen===3&&reduced.labelVisible,'reduced motion lost earned state or copy');
    assert(reduced.eggo==='static'&&reduced.eggoDisabled&&/egghead\.io mascot/i.test(reduced.eggoLabel)&&
      !/tap to boop/i.test(reduced.eggoLabel)&&reduced.fallbackVisible&&reduced.meshHidden,
    'reduced motion did not keep a disabled, accurately labeled static Eggo fallback');
    assert(reduced.shader==='disabled'&&reduced.draws.eggo===0&&reduced.draws.shader===0,'reduced motion initialized an animated workshop canvas');
    assert(reduced.cells.every(color=>color==='rgb(45, 226, 230)'),'reduced motion did not visibly fill all signal cells');
    assert(reduced.scanAnimationName==='none','reduced motion did not disable the scan animation');
    assert(isZeroDuration(reduced.ctaTransition)&&isZeroDuration(reduced.dockTransition),'reduced motion did not remove workshop transitions');
    assert(reduced.transform==='none','reduced motion did not remove the CTA hover transform');
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
    await page.waitForFunction(()=>['ready','idle'].includes(document.getElementById('workshop-eggo').dataset.eggoState)&&
      !document.getElementById('workshop-eggo').disabled&&document.getElementById('workshop-dock').dataset.workshopShader==='active');
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
    await page.waitForFunction(()=>document.getElementById('workshop-eggo').dataset.eggoState==='static'&&
      document.getElementById('workshop-eggo').disabled&&document.getElementById('workshop-dock').dataset.workshopShader==='disabled');
    const liveTransition=await page.evaluate(()=>({
      fallback:!document.getElementById('workshop-eggo-fallback').hidden,
      mesh:document.getElementById('workshop-eggo-canvas').hidden,
      capture:window.__workshopFx.captureEggoPixels,
      spotlight:window.__workshopFx.captureSpotlightPair
    }));
    assert(liveTransition.fallback&&liveTransition.mesh&&liveTransition.capture===null&&liveTransition.spotlight===null,
      'live reduced-motion transition retained an interactive canvas or debug capture');
    const keyboard=await focusAndActivateCta(page);
    assert(requests.filter(isEgghead).length===0,'reduced-motion keyboard interception contacted egghead');
    assert(!errors.length,`reduced-motion page errors: ${errors.join('; ')}`);
    if(receiptDir)await page.screenshot({path:path.join(receiptDir,'reduced-motion.png')});
    return{earned:reduced.earned,eggo:reduced.eggo,shader:reduced.shader,scanAnimationName:reduced.scanAnimationName,
      liveTransition:true,keyboard:{focused:keyboard.focused,activatedWithEnter:keyboard.activatedWithEnter}};
  }finally{await page.close();}
}

async function runWebglFailure(browser,baseUrl,receiptDir,timeoutMs){
  const{page,errors}=await openPage(browser,baseUrl,{width:1440,height:900},{webglFailure:true});
  page.setDefaultTimeout(timeoutMs);
  try{
    const state=await page.evaluate(()=>{
      const fallback=document.getElementById('workshop-eggo-fallback'),mesh=document.getElementById('workshop-eggo-canvas');
      const eggo=document.getElementById('workshop-eggo');
      return{eggo:eggo.dataset.eggoState,eggoDisabled:eggo.disabled,eggoLabel:eggo.getAttribute('aria-label'),
        shader:document.getElementById('workshop-dock').dataset.workshopShader,
        fallbackVisible:!fallback.hidden&&getComputedStyle(fallback).display!=='none'&&fallback.getBoundingClientRect().width>0,
        meshHidden:mesh.hidden&&getComputedStyle(mesh).display==='none',
        ctaVisible:document.getElementById('workshop-cta').getBoundingClientRect().width>0,
        cards:document.querySelectorAll('.game-card').length};
    });
    assert(state.eggo==='static'&&state.eggoDisabled&&!/tap to boop/i.test(state.eggoLabel)&&state.fallbackVisible&&state.meshHidden,
      'WebGL failure did not reveal a disabled static Eggo');
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
    const receipt={schema:6,surface:'workshop-funnel',baseOrigin:siteUrl.origin,gameCount:GAME_COUNT,eggoHash:EGGO_HASH,
      viewports:[{name:'desktop',width:1440,height:900},{name:'mobile-390x844',width:390,height:844},
        {name:'mobile-360x640',width:360,height:640},{name:'reduced-motion',width:1440,height:900},{name:'webgl-failure',width:1440,height:900}],
      initialState:desktop.initial,progression:desktop.progression,earnedState:desktop.earnedState,activePosition:desktop.activePosition,
      outbound:desktop.outbound,keyboard:desktop.keyboard,stretch:desktop.stretch,shader:desktop.shader,
      mobile:{tap:mobile390.touchBoop&&mobile360.touchBoop,drag:mobile390.touchStretch&&mobile360.touchStretch,
        cancel:mobile390.touchCancel&&mobile360.touchCancel,events390:mobile390.events,events360:mobile360.events},
      reducedMotion:{earned:reducedMotion.earned,eggo:reducedMotion.eggo,shader:reducedMotion.shader,
        scanAnimationName:reducedMotion.scanAnimationName,liveTransition:reducedMotion.liveTransition},
      webglFailure:{eggo:webglFailure.eggo,shader:webglFailure.shader,controlDisabled:webglFailure.eggoDisabled},
      contextLoss:desktop.contextLoss,network:desktop.network,
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
