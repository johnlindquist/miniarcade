'use strict';

// Shared browser-script discovery and execution for headless evals and the
// real-pixel renderer. Keep each classic script as its own VM Script so
// directive prologues and global lexical bindings behave like separate
// <script> elements in a browser.
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const DEFAULT_ROOT=__dirname;
const SCRIPT_RE=/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

function attribute(attrs,name){
  const match=String(attrs||'').match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'));
  return match&&(match[1]!==undefined?match[1]:match[2]!==undefined?match[2]:match[3]);
}

function scriptBlocks(html){
  return[...String(html).matchAll(SCRIPT_RE)].map((match,index)=>({
    index,attrs:match[1]||'',src:attribute(match[1],'src')||null,source:match[2]||''
  }));
}

function inlineScript(html,name){
  const blocks=scriptBlocks(html).filter(block=>!block.src);
  const hit=blocks.find(block=>block.source.includes("'use strict'"))||blocks.at(-1);
  if(!hit)throw new Error('No inline game script found'+(name?' in '+name+'.html':''));
  return hit.source;
}

function needsAutoplay(html){
  return scriptBlocks(html).some(block=>block.src&&/(?:^|\/)autoplay\.js(?:[?#]|$)/i.test(block.src))||/\bAI\./.test(html);
}

function needsWordPuzzle(html){
  return scriptBlocks(html).some(block=>block.src&&/(?:^|\/)word-puzzle\.js(?:[?#]|$)/i.test(block.src));
}

function localScriptPath(src,page,root){
  if(/^(?:[a-z]+:)?\/\//i.test(src)||/^(?:data|blob|javascript):/i.test(src))
    throw new Error('Remote script sources are unavailable in the offline runtime: '+src);
  const clean=src.split(/[?#]/,1)[0];
  if(!clean)throw new Error('Empty script source in '+page);
  const decoded=decodeURIComponent(clean);
  return decoded.startsWith('/')?path.resolve(root,'.'+decoded):path.resolve(path.dirname(page),decoded);
}

function gameSource(name,root){
  if(!/^[a-z0-9-]+$/.test(name))throw new Error('Invalid game id: '+name);
  root=root||DEFAULT_ROOT;
  const page=path.join(root,name+'.html');
  const html=fs.readFileSync(page,'utf8');
  const dependencies=[];
  const scripts=scriptBlocks(html).map(block=>{
    if(block.src){
      const file=localScriptPath(block.src,page,root);
      dependencies.push(file);
      return{source:fs.readFileSync(file,'utf8'),filename:file,file,src:block.src,inline:false,index:block.index};
    }
    return{source:block.source,filename:page+'#inline-'+(block.index+1),file:page,src:null,inline:true,index:block.index};
  });
  if(!scripts.length)throw new Error('No game scripts found in '+page);
  const dependencyFiles=[...new Set(dependencies)];
  return{
    name,root,html,page,scripts,dependencyFiles,
    files:[...dependencyFiles,page],
    source:scripts.map(script=>script.source).join('\n')
  };
}

function executeScripts(loaded,sandbox,options){
  options=options||{};
  const scripts=Array.isArray(loaded)?loaded:loaded.scripts;
  if(!Array.isArray(scripts))throw new Error('Expected discovered game scripts');
  const context=vm.isContext(sandbox)?sandbox:vm.createContext(sandbox);
  for(const script of scripts)vm.runInContext(script.source,context,{filename:script.filename});
  if(options.footer)vm.runInContext(options.footer,context,{filename:options.footerFilename||'game-footer.js'});
  return context;
}

module.exports={
  DEFAULT_ROOT,scriptBlocks,inlineScript,needsAutoplay,needsWordPuzzle,gameSource,executeScripts
};
