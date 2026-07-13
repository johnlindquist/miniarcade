/* MINI/ARCADE workshop dock effects — dependency-free, progressively enhanced. */
'use strict';

(()=>{
  const params=new URLSearchParams(location.search);
  const debug=params.has('workshopDebug')?{
    drawCounters:{eggo:0,shader:0},
    state:{eggo:'static',shader:'disabled'},
    eggoRafActive:false,
    shaderEnergy:0,
    shaderPointer:{x:0,y:0},
    events:{pointerBoop:0,keyboardBoop:0,semanticBoop:0,dragRelease:0,cancel:0,longPressRejected:0},
    captureEggoPixels:null,
    captureSpotlightPair:null
  }:null;
  if(debug)window.__workshopFx=debug;

  const onReady=fn=>document.readyState==='loading'
    ?document.addEventListener('DOMContentLoaded',fn,{once:true}):fn();
  const listenMedia=(query,fn)=>{
    if(query.addEventListener)query.addEventListener('change',fn);
    else query.addListener(fn);
  };
  const compile=(gl,type,source)=>{
    const shader=gl.createShader(type);
    if(!shader)return null;
    gl.shaderSource(shader,source);
    gl.compileShader(shader);
    if(gl.getShaderParameter(shader,gl.COMPILE_STATUS))return shader;
    gl.deleteShader(shader);
    return null;
  };
  const makeProgram=(gl,vert,frag)=>{
    const vs=compile(gl,gl.VERTEX_SHADER,vert);
    const fs=compile(gl,gl.FRAGMENT_SHADER,frag);
    if(!vs||!fs){if(vs)gl.deleteShader(vs);if(fs)gl.deleteShader(fs);return null;}
    const program=gl.createProgram();
    if(!program)return null;
    gl.attachShader(program,vs);
    gl.attachShader(program,fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if(gl.getProgramParameter(program,gl.LINK_STATUS))return program;
    gl.deleteProgram(program);
    return null;
  };

  onReady(()=>{
    const dock=document.getElementById('workshop-dock');
    const eggo=document.getElementById('workshop-eggo');
    const fallback=document.getElementById('workshop-eggo-fallback');
    const eggoCanvas=document.getElementById('workshop-eggo-canvas');
    const fxCanvas=document.getElementById('workshop-fx-canvas');
    const cta=document.getElementById('workshop-cta');
    if(!dock)return;

    const reduce=matchMedia('(prefers-reduced-motion: reduce)');
    const fine=matchMedia('(hover: hover) and (pointer: fine)');
    const wide=matchMedia('(min-width: 768px)');
    let meshCleanup=null;
    let shaderCleanup=null;

    const staticEggoLabel='Eggo, the egghead.io mascot';
    const interactiveEggoLabel='Eggo, the egghead.io mascot — tap to boop, grab to stretch';
    const setEggoState=state=>{
      if(eggo)eggo.dataset.eggoState=state;
      if(debug)debug.state.eggo=state;
    };
    const showEggoFallback=state=>{
      if(eggo){eggo.disabled=true;eggo.setAttribute('aria-label',staticEggoLabel);}
      if(eggoCanvas)eggoCanvas.hidden=true;
      if(fallback)fallback.hidden=false;
      setEggoState(state||'static');
      if(debug)debug.eggoRafActive=false;
    };
    const showEggoCanvas=()=>{
      if(eggo){eggo.disabled=false;eggo.setAttribute('aria-label',interactiveEggoLabel);}
      if(fallback)fallback.hidden=true;
      if(eggoCanvas)eggoCanvas.hidden=false;
    };

    const MESH_VERT=`
attribute vec2 a_pos;
attribute vec2 a_uv;
uniform vec2 u_size;
varying vec2 v_uv;
void main(){
  vec2 clip=(a_pos/u_size)*2.0-1.0;
  gl_Position=vec4(clip.x,-clip.y,0.0,1.0);
  v_uv=a_uv;
}`;
    const MESH_FRAG=`
precision mediump float;
uniform sampler2D u_tex;
varying vec2 v_uv;
void main(){gl_FragColor=texture2D(u_tex,v_uv);}`;

    const initMesh=()=>{
      if(!eggo||!fallback||!eggoCanvas||reduce.matches){showEggoFallback('static');return false;}
      setEggoState('loading');
      eggoCanvas.hidden=true;
      fallback.hidden=false;

      const rect=eggo.getBoundingClientRect();
      const artW=Math.max(32,Math.round(rect.width||fallback.getBoundingClientRect().width||38));
      const artH=Math.max(32,Math.round(rect.height||fallback.getBoundingClientRect().height||40));
      const pad=Math.max(16,Math.min(20,Math.round(Math.min(artW,artH)*0.48)));
      const width=artW+pad*2;
      const height=artH+pad*2;
      const dpr=Math.min(devicePixelRatio||1,2);
      eggoCanvas.width=Math.round(width*dpr);
      eggoCanvas.height=Math.round(height*dpr);
      eggoCanvas.style.width=`${width}px`;
      eggoCanvas.style.height=`${height}px`;
      eggoCanvas.style.position='absolute';
      eggoCanvas.style.left='50%';
      eggoCanvas.style.top='50%';
      eggoCanvas.style.transform='translate(-50%,-50%)';
      eggoCanvas.style.pointerEvents='none';

      const gl=eggoCanvas.getContext('webgl',{
        alpha:true,antialias:false,depth:false,stencil:false,
        premultipliedAlpha:true,preserveDrawingBuffer:true,powerPreference:'low-power'
      });
      if(!gl||gl.isContextLost()){showEggoFallback('static');return false;}
      const program=makeProgram(gl,MESH_VERT,MESH_FRAG);
      if(!program){showEggoFallback('static');return false;}
      if(debug)debug.captureEggoPixels=()=>{
        const pixels=new Uint8Array(eggoCanvas.width*eggoCanvas.height*4);
        gl.finish();
        gl.readPixels(0,0,eggoCanvas.width,eggoCanvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        return Array.from(pixels);
      };
      gl.useProgram(program);
      gl.viewport(0,0,eggoCanvas.width,eggoCanvas.height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(gl.getUniformLocation(program,'u_size'),width,height);
      gl.uniform1i(gl.getUniformLocation(program,'u_tex'),0);

      const gx=Math.max(7,Math.min(16,Math.round(artW/13)));
      const gy=Math.max(7,Math.min(16,Math.round(artH/13)));
      const count=(gx+1)*(gy+1);
      const base=new Float32Array(count*2);
      const offset=new Float32Array(count*2);
      const velocity=new Float32Array(count*2);
      const positions=new Float32Array(count*2);
      const uvs=new Float32Array(count*2);
      for(let y=0;y<=gy;y++)for(let x=0;x<=gx;x++){
        const i=(y*(gx+1)+x)*2;
        base[i]=pad+x/gx*artW;
        base[i+1]=pad+y/gy*artH;
        positions[i]=base[i];
        positions[i+1]=base[i+1];
        uvs[i]=x/gx;
        uvs[i+1]=y/gy;
      }
      const indices=new Uint16Array(gx*gy*6);
      let k=0;
      for(let y=0;y<gy;y++)for(let x=0;x<gx;x++){
        const a=y*(gx+1)+x;
        indices[k++]=a;indices[k++]=a+1;indices[k++]=a+gx+1;
        indices[k++]=a+1;indices[k++]=a+gx+2;indices[k++]=a+gx+1;
      }

      const positionBuffer=gl.createBuffer();
      const uvBuffer=gl.createBuffer();
      const indexBuffer=gl.createBuffer();
      const texture=gl.createTexture();
      if(!positionBuffer||!uvBuffer||!indexBuffer||!texture){
        gl.deleteProgram(program);showEggoFallback('static');return false;
      }
      const aPos=gl.getAttribLocation(program,'a_pos');
      const aUv=gl.getAttribLocation(program,'a_uv');
      gl.bindBuffer(gl.ARRAY_BUFFER,positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER,positions,gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER,uvs,gl.STATIC_DRAW);
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));

      let disposed=false;
      let ready=false;
      let grabbing=false;
      let pointerId=-1;
      let grabX=0,grabY=0,pullX=0,pullY=0;
      let grabT=0,maxGestureDistance=0,lastPointerRelease=-Infinity;
      const keyboardActivations=new Set();
      const keyboardResetTimers=new Set();
      let keyboardSource='';
      let raf=0;
      let lastTime=0;
      const maxPull=Math.max(12,Math.min(14,Math.min(artW,artH)*0.35));
      const tapSlop=Math.max(6,Math.min(10,Math.min(artW,artH)*0.18));
      const fallRadius=Math.max(22,Math.min(26,Math.min(artW,artH)*0.62));
      const boopVelocity=540*Math.min(artW,artH)/124;

      const draw=()=>{
        gl.clearColor(0,0,0,0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindBuffer(gl.ARRAY_BUFFER,positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER,positions,gl.DYNAMIC_DRAW);
        gl.drawElements(gl.TRIANGLES,indices.length,gl.UNSIGNED_SHORT,0);
        if(debug)debug.drawCounters.eggo++;
      };
      const stopFrame=()=>{
        if(raf)cancelAnimationFrame(raf);
        raf=0;
        if(debug)debug.eggoRafActive=false;
      };
      const startFrame=()=>{
        if(raf||disposed||!ready)return;
        if(debug)debug.eggoRafActive=true;
        raf=requestAnimationFrame(frame);
      };
      const frame=now=>{
        raf=0;
        if(disposed||!ready)return;
        const dt=lastTime?Math.min((now-lastTime)/1000,0.033):1/60;
        lastTime=now;
        let maxOffset=0,maxVelocity=0;
        for(let i=0;i<count;i++){
          const ix=i*2,iy=ix+1;
          let tx=0,ty=0;
          if(grabbing){
            const dx=base[ix]-grabX,dy=base[iy]-grabY;
            const influence=Math.exp(-(dx*dx+dy*dy)/(fallRadius*fallRadius));
            tx=pullX*influence;
            ty=pullY*influence;
            const follow=Math.min(1,dt*26);
            offset[ix]+=(tx-offset[ix])*follow;
            offset[iy]+=(ty-offset[iy])*follow;
            velocity[ix]=0;velocity[iy]=0;
          }else{
            const spring=190,damping=9.5;
            velocity[ix]+=(-offset[ix]*spring-velocity[ix]*damping)*dt;
            velocity[iy]+=(-offset[iy]*spring-velocity[iy]*damping)*dt;
            offset[ix]+=velocity[ix]*dt;
            offset[iy]+=velocity[iy]*dt;
          }
          maxOffset=Math.max(maxOffset,Math.abs(offset[ix]),Math.abs(offset[iy]));
          maxVelocity=Math.max(maxVelocity,Math.abs(velocity[ix]),Math.abs(velocity[iy]));
          positions[ix]=base[ix]+offset[ix];
          positions[iy]=base[iy]+offset[iy];
        }
        if(!grabbing&&maxOffset<0.025&&maxVelocity<0.08){
          offset.fill(0);velocity.fill(0);positions.set(base);
          draw();
          setEggoState('idle');
          if(debug)debug.eggoRafActive=false;
          return;
        }
        draw();
        raf=requestAnimationFrame(frame);
      };
      const local=e=>{
        const r=eggo.getBoundingClientRect();
        return[e.clientX-r.left+pad,e.clientY-r.top+pad];
      };
      const boop=(x,y,source)=>{
        if(!ready)return;
        for(let i=0;i<count;i++){
          const ix=i*2,iy=ix+1;
          const dx=base[ix]-x,dy=base[iy]-y;
          const distance=Math.hypot(dx,dy)||1;
          const influence=Math.exp(-(distance*distance)/(fallRadius*fallRadius));
          velocity[ix]+=dx/distance*boopVelocity*influence;
          velocity[iy]+=dy/distance*boopVelocity*influence;
        }
        if(debug)debug.events[source==='keyboard'?'keyboardBoop':source==='semantic'?'semanticBoop':'pointerBoop']++;
        lastTime=0;
        setEggoState('booping');
        startFrame();
      };
      const resetKeyboardActivation=()=>{
        for(const timer of keyboardResetTimers)clearTimeout(timer);
        keyboardResetTimers.clear();
        keyboardActivations.clear();
        keyboardSource='';
      };
      const scheduleKeyboardReset=key=>{
        const timer=setTimeout(()=>{
          keyboardResetTimers.delete(timer);
          keyboardActivations.delete(key);
          if(keyboardSource===key)keyboardSource='';
        },0);
        keyboardResetTimers.add(timer);
      };
      const onDown=e=>{
        if(!ready||e.button!==0||e.isPrimary===false)return;
        resetKeyboardActivation();
        e.stopPropagation();
        pointerId=e.pointerId;
        try{eggo.setPointerCapture(pointerId);}catch(_error){}
        [grabX,grabY]=local(e);
        pullX=0;pullY=0;maxGestureDistance=0;grabT=performance.now();grabbing=true;lastTime=0;
        setEggoState('dragging');
        startFrame();
      };
      const onMove=e=>{
        if(!grabbing||e.pointerId!==pointerId)return;
        e.preventDefault();
        e.stopPropagation();
        const point=local(e);
        let dx=point[0]-grabX,dy=point[1]-grabY;
        const distance=Math.hypot(dx,dy);
        maxGestureDistance=Math.max(maxGestureDistance,distance);
        if(distance>maxPull){
          const soft=Math.min(maxPull*1.4,maxPull+(distance-maxPull)*0.24);
          dx=dx/distance*soft;
          dy=dy/distance*soft;
        }
        pullX=dx;pullY=dy;
        startFrame();
      };
      const release=(e,reason)=>{
        if(!grabbing||(e.pointerId!==undefined&&e.pointerId!==pointerId))return;
        e.stopPropagation();
        const releasedPointer=pointerId;
        const elapsed=performance.now()-grabT;
        let releaseDistance=0;
        if(reason==='pointerup'&&Number.isFinite(e.clientX)&&Number.isFinite(e.clientY)){
          const point=local(e);
          releaseDistance=Math.hypot(point[0]-grabX,point[1]-grabY);
        }
        const gestureDistance=Math.max(maxGestureDistance,Math.hypot(pullX,pullY),releaseDistance);
        const cleanTap=reason==='pointerup'&&gestureDistance<tapSlop&&elapsed<400;
        grabbing=false;
        lastPointerRelease=performance.now();
        if(reason!=='lost')try{eggo.releasePointerCapture(releasedPointer);}catch(_error){}
        pointerId=-1;pullX=0;pullY=0;lastTime=0;
        if(cleanTap){boop(grabX,grabY,'pointer');return;}
        if(debug){
          if(reason==='cancel'||reason==='lost')debug.events.cancel++;
          else if(gestureDistance<tapSlop&&elapsed>=400)debug.events.longPressRejected++;
          else debug.events.dragRelease++;
        }
        setEggoState('settling');
        startFrame();
      };
      const onPointerUp=e=>release(e,'pointerup');
      const onPointerCancel=e=>release(e,'cancel');
      const onLost=e=>{if(grabbing&&e.pointerId===pointerId)release(e,'lost');};
      const onKeyDown=e=>{
        if(e.key!=='Enter'&&e.key!==' ')return;
        if(e.repeat){e.preventDefault();return;}
        keyboardActivations.add(e.key);
        keyboardSource=e.key;
      };
      const onKeyUp=e=>{
        if((e.key!=='Enter'&&e.key!==' ')||!keyboardActivations.has(e.key))return;
        keyboardSource=e.key;
        scheduleKeyboardReset(e.key);
      };
      const onClick=e=>{
        if(e.detail>0&&performance.now()-lastPointerRelease<700){resetKeyboardActivation();return;}
        const key=keyboardActivations.has(keyboardSource)?keyboardSource:'';
        const source=key?'keyboard':'semantic';
        if(key){
          keyboardActivations.delete(key);
          const remaining=[...keyboardActivations];
          keyboardSource=remaining[remaining.length-1]||'';
        }
        boop(pad+artW/2,pad+artH/2,source);
      };
      const onContextLost=e=>{
        e.preventDefault();
        if(meshCleanup)meshCleanup();
        meshCleanup=null;
        showEggoFallback('static');
      };
      const previousTouchAction=eggo.style.touchAction;
      eggo.style.touchAction='none';
      eggo.addEventListener('pointerdown',onDown);
      eggo.addEventListener('pointermove',onMove);
      eggo.addEventListener('pointerup',onPointerUp);
      eggo.addEventListener('pointercancel',onPointerCancel);
      eggo.addEventListener('lostpointercapture',onLost);
      eggo.addEventListener('keydown',onKeyDown);
      eggo.addEventListener('keyup',onKeyUp);
      eggo.addEventListener('blur',resetKeyboardActivation);
      eggo.addEventListener('click',onClick);
      window.addEventListener('blur',resetKeyboardActivation);
      eggoCanvas.addEventListener('webglcontextlost',onContextLost,false);

      const image=new Image();
      image.decoding='async';
      image.onload=()=>{
        if(disposed)return;
        const raster=document.createElement('canvas');
        raster.width=Math.max(1,Math.round(artW*2));
        raster.height=Math.max(1,Math.round(artH*2));
        const ctx=raster.getContext('2d');
        if(!ctx){showEggoFallback('static');return;}
        const scale=Math.min(artW/image.naturalWidth,artH/image.naturalHeight);
        const imageW=image.naturalWidth*scale;
        const imageH=image.naturalHeight*scale;
        ctx.scale(2,2);
        ctx.drawImage(image,(artW-imageW)/2,(artH-imageH)/2,imageW,imageH);
        gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,raster);
        ready=true;
        positions.set(base);
        showEggoCanvas();
        setEggoState('ready');
        draw();
        startFrame();
      };
      image.onerror=()=>{if(!disposed)showEggoFallback('static');};
      image.src=fallback.currentSrc||fallback.getAttribute('src')||'eggo.svg';

      meshCleanup=()=>{
        if(disposed)return;
        disposed=true;ready=false;grabbing=false;
        resetKeyboardActivation();
        stopFrame();
        image.onload=null;image.onerror=null;
        eggo.removeEventListener('pointerdown',onDown);
        eggo.removeEventListener('pointermove',onMove);
        eggo.removeEventListener('pointerup',onPointerUp);
        eggo.removeEventListener('pointercancel',onPointerCancel);
        eggo.removeEventListener('lostpointercapture',onLost);
        eggo.removeEventListener('keydown',onKeyDown);
        eggo.removeEventListener('keyup',onKeyUp);
        eggo.removeEventListener('blur',resetKeyboardActivation);
        eggo.removeEventListener('click',onClick);
        window.removeEventListener('blur',resetKeyboardActivation);
        eggoCanvas.removeEventListener('webglcontextlost',onContextLost,false);
        eggo.style.touchAction=previousTouchAction;
        if(debug)debug.captureEggoPixels=null;
        gl.deleteTexture(texture);
        gl.deleteBuffer(positionBuffer);
        gl.deleteBuffer(uvBuffer);
        gl.deleteBuffer(indexBuffer);
        gl.deleteProgram(program);
      };
      return true;
    };

    const FX_VERT=`
attribute vec2 a_pos;
void main(){gl_Position=vec4(a_pos,0.0,1.0);}`;
    const FX_FRAG=`
precision mediump float;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform vec2 u_velocity;
uniform float u_energy;
uniform float u_time;
uniform float u_wobbleTime;
uniform float u_spotlight;
uniform float u_spotlightWobble;
uniform vec4 u_cta;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0)),f.x),f.y);
}
float roundedBox(vec2 p,vec2 b,float r){
  vec2 q=abs(p)-b+r;
  return min(max(q.x,q.y),0.0)+length(max(q,0.0))-r;
}
void main(){
  vec2 p=gl_FragCoord.xy;
  vec2 delta=p-u_mouse;
  float speed=length(u_velocity);
  vec2 direction=u_velocity/max(speed,0.001);
  float tail=clamp(speed*0.12,0.0,190.0);
  float along=clamp(dot(delta,-direction),0.0,tail);
  float cometDistance=length(delta+direction*along);
  float grain=noise(p*0.012+vec2(u_time*0.10,-u_time*0.07));
  float comet=exp(-cometDistance/(34.0+grain*32.0))*(0.025+u_energy*0.30);
  vec3 orange=vec3(1.0,0.43,0.12);
  vec3 cyan=vec3(0.18,0.80,0.92);
  vec3 color=comet*mix(orange,cyan,clamp(grain*0.7+speed*0.0003,0.0,1.0));

  vec2 toCta=u_cta.xy-u_mouse;
  float targetDistance=length(toCta);
  float spotlightReach=max(90.0,min(300.0,u_resolution.x*0.78));
  float spotlightProximity=1.0-smoothstep(44.0,spotlightReach,targetDistance);
  vec2 fromMouse=p-u_mouse;
  vec2 spotlightDirection=toCta/max(targetDistance,1.0);
  vec2 spotlightNormal=vec2(-spotlightDirection.y,spotlightDirection.x);
  float spotlightT=clamp(dot(fromMouse,toCta)/max(dot(toCta,toCta),1.0),0.0,1.0);
  vec2 spotlightOffset=fromMouse-toCta*spotlightT;
  float spotlightSide=dot(spotlightOffset,spotlightNormal);
  float spotlightEnd=abs(dot(spotlightOffset,spotlightDirection));
  float spotlightWobble=(noise(vec2(spotlightT*7.0-u_wobbleTime*1.4,13.1))-0.5)
    *u_spotlightWobble*min(16.0,u_resolution.y*0.24)*spotlightT*(1.0-spotlightT);
  float spotlightDistance=length(vec2(spotlightSide+spotlightWobble,spotlightEnd));
  float spotlightWidth=mix(min(11.0,u_resolution.y*0.18),2.2,spotlightT);
  float spotlight=exp(-(spotlightDistance*spotlightDistance)/(2.0*spotlightWidth*spotlightWidth));
  float spotlightPulse=0.6+0.4*sin(spotlightT*24.0-u_time*5.0);
  color+=u_spotlight*spotlight*spotlightPulse*spotlightProximity*(0.025+0.34*u_energy)
    *mix(orange,cyan,spotlightT*0.8);

  float box=roundedBox(p-u_cta.xy,u_cta.zw,10.0);
  float edge=exp(-abs(box)/3.5);
  float bloom=exp(-abs(box)/28.0);
  float mouseNear=exp(-length(u_mouse-u_cta.xy)/180.0);
  float breathe=0.76+0.24*sin(u_time*2.2);
  float halo=(edge*0.34+bloom*0.07)*(0.55+mouseNear*(0.75+u_energy)*breathe);
  color+=halo*orange;

  float alpha=clamp(max(max(color.r,color.g),color.b)*1.55,0.0,0.72);
  gl_FragColor=vec4(color,alpha);
}`;

    const setShaderState=state=>{
      dock.dataset.workshopShader=state;
      if(fxCanvas)fxCanvas.hidden=state!=='active';
      if(debug)debug.state.shader=state;
    };
    const shaderEligible=()=>!!fxCanvas&&!!cta&&!reduce.matches&&fine.matches&&wide.matches&&innerWidth>767;
    const initShader=()=>{
      if(!shaderEligible()){setShaderState('disabled');return false;}
      const gl=fxCanvas.getContext('webgl',{
        alpha:true,antialias:false,depth:false,stencil:false,
        premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'low-power'
      });
      if(!gl||gl.isContextLost()){setShaderState('failed');return false;}
      const program=makeProgram(gl,FX_VERT,FX_FRAG);
      if(!program){setShaderState('failed');return false;}
      gl.useProgram(program);
      const buffer=gl.createBuffer();
      if(!buffer){gl.deleteProgram(program);setShaderState('failed');return false;}
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      const aPos=gl.getAttribLocation(program,'a_pos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
      const uResolution=gl.getUniformLocation(program,'u_resolution');
      const uMouse=gl.getUniformLocation(program,'u_mouse');
      const uVelocity=gl.getUniformLocation(program,'u_velocity');
      const uEnergy=gl.getUniformLocation(program,'u_energy');
      const uTime=gl.getUniformLocation(program,'u_time');
      const uWobbleTime=gl.getUniformLocation(program,'u_wobbleTime');
      const uSpotlight=gl.getUniformLocation(program,'u_spotlight');
      const uSpotlightWobble=gl.getUniformLocation(program,'u_spotlightWobble');
      const uCta=gl.getUniformLocation(program,'u_cta');
      let disposed=false;
      let timer=0,raf=0,lastDraw=0,lastMove=0;
      let scale=0.75;
      let mouseX=0,mouseY=0,velocityX=0,velocityY=0,energy=0;
      let ctaX=0,ctaY=0,ctaW=1,ctaH=1;

      const resize=()=>{
        const rect=dock.getBoundingClientRect();
        const dpr=Math.min(devicePixelRatio||1,1);
        scale=Math.min(0.75,dpr*0.75);
        const width=Math.max(1,Math.round(rect.width*scale));
        const height=Math.max(1,Math.round(rect.height*scale));
        if(fxCanvas.width!==width||fxCanvas.height!==height){
          fxCanvas.width=width;fxCanvas.height=height;
          gl.viewport(0,0,width,height);
        }
        fxCanvas.style.width='100%';
        fxCanvas.style.height='100%';
        const target=cta.getBoundingClientRect();
        ctaX=(target.left-rect.left+target.width/2)*scale;
        ctaY=(rect.bottom-target.top-target.height/2)*scale;
        ctaW=Math.max(1,target.width/2*scale);
        ctaH=Math.max(1,target.height/2*scale);
        if(!lastMove){mouseX=width/2;mouseY=height/2;}
      };
      const clearSchedule=()=>{
        if(timer)clearTimeout(timer);
        if(raf)cancelAnimationFrame(raf);
        timer=0;raf=0;
      };
      const queue=(delay,replace)=>{
        if(disposed||document.hidden)return;
        if((timer||raf)&&!replace)return;
        clearSchedule();
        timer=setTimeout(()=>{
          timer=0;
          raf=requestAnimationFrame(draw);
        },Math.max(0,delay));
      };
      const draw=now=>{
        raf=0;
        if(disposed||document.hidden)return;
        const dt=lastDraw?Math.min((now-lastDraw)/1000,0.2):1/30;
        lastDraw=now;
        energy*=Math.exp(-dt*2.5);
        velocityX*=Math.exp(-dt*3.8);
        velocityY*=Math.exp(-dt*3.8);
        if(debug)debug.shaderEnergy=energy;
        gl.clearColor(0,0,0,0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(uResolution,fxCanvas.width,fxCanvas.height);
        gl.uniform2f(uMouse,mouseX,mouseY);
        gl.uniform2f(uVelocity,velocityX,velocityY);
        gl.uniform1f(uEnergy,Math.min(1,energy));
        gl.uniform1f(uTime,now/1000);
        gl.uniform1f(uWobbleTime,now/1000);
        gl.uniform1f(uSpotlight,1);
        gl.uniform1f(uSpotlightWobble,1);
        gl.uniform4f(uCta,ctaX,ctaY,ctaW,ctaH);
        gl.drawArrays(gl.TRIANGLES,0,3);
        if(debug)debug.drawCounters.shader++;
        const active=energy>0.035||now-lastMove<900;
        queue(active?1000/30:1000/10,false);
      };
      const wake=()=>{
        const now=performance.now();
        const remaining=Math.max(0,1000/30-(now-lastDraw));
        queue(remaining,true);
      };
      if(debug)debug.captureSpotlightPair=()=>{
        clearSchedule();
        const probeDistance=Math.min(180,fxCanvas.width*0.28);
        const probeX=Math.max(4,ctaX-probeDistance);
        const probeY=Math.max(4,Math.min(fxCanvas.height-4,ctaY+fxCanvas.height*0.08));
        const liveSpotlight=Number(gl.getUniform(program,uSpotlight));
        const liveWobble=Number(gl.getUniform(program,uSpotlightWobble));
        const liveTime=Number(gl.getUniform(program,uTime));
        const liveWobbleTime=Number(gl.getUniform(program,uWobbleTime));
        const capture=(spotlight,wobble)=>{
          gl.clearColor(0,0,0,0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.uniform2f(uResolution,fxCanvas.width,fxCanvas.height);
          gl.uniform2f(uMouse,probeX,probeY);
          gl.uniform2f(uVelocity,0,0);
          gl.uniform1f(uEnergy,1);
          gl.uniform1f(uTime,1.75);
          gl.uniform1f(uWobbleTime,liveWobbleTime);
          gl.uniform1f(uSpotlight,spotlight);
          gl.uniform1f(uSpotlightWobble,wobble);
          gl.uniform4f(uCta,ctaX,ctaY,ctaW,ctaH);
          gl.drawArrays(gl.TRIANGLES,0,3);
          gl.finish();
          const pixels=new Uint8Array(fxCanvas.width*fxCanvas.height*4);
          gl.readPixels(0,0,fxCanvas.width,fxCanvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          return Array.from(pixels);
        };
        const off=capture(0,liveWobble);
        const straight=capture(liveSpotlight,0);
        const bent=capture(liveSpotlight,liveWobble);
        gl.uniform1f(uSpotlight,liveSpotlight);
        gl.uniform1f(uSpotlightWobble,liveWobble);
        gl.uniform1f(uTime,liveTime);
        gl.uniform1f(uWobbleTime,liveWobbleTime);
        lastDraw=0;
        queue(0,true);
        return{off,straight,bent,on:bent,
          live:{spotlight:liveSpotlight,wobble:liveWobble,time:liveWobbleTime,ambientTime:liveTime},
          width:fxCanvas.width,height:fxCanvas.height,
          mouse:{x:probeX,y:probeY},cta:{x:ctaX,y:ctaY}};
      };
      const onPointerMove=e=>{
        const rect=dock.getBoundingClientRect();
        if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)return;
        const now=performance.now();
        const nextX=(e.clientX-rect.left)*scale;
        const nextY=(rect.bottom-e.clientY)*scale;
        if(lastMove){
          const dt=Math.max(0.008,(now-lastMove)/1000);
          const vx=(nextX-mouseX)/dt,vy=(nextY-mouseY)/dt;
          velocityX+=(vx-velocityX)*0.34;
          velocityY+=(vy-velocityY)*0.34;
          energy=Math.max(energy,Math.min(1,Math.hypot(vx,vy)/850));
        }
        mouseX=nextX;mouseY=nextY;lastMove=now;
        if(debug){debug.shaderPointer.x=nextX;debug.shaderPointer.y=nextY;debug.shaderEnergy=energy;}
        wake();
      };
      const onVisibility=()=>{
        if(document.hidden)clearSchedule();
        else{lastDraw=0;resize();queue(0,true);}
      };
      const onContextLost=e=>{
        e.preventDefault();
        if(shaderCleanup)shaderCleanup();
        shaderCleanup=null;
        setShaderState('failed');
      };
      const observer=new ResizeObserver(()=>{resize();queue(0,true);});
      observer.observe(dock);
      observer.observe(cta);
      dock.addEventListener('pointermove',onPointerMove,{passive:true});
      document.addEventListener('visibilitychange',onVisibility);
      fxCanvas.addEventListener('webglcontextlost',onContextLost,false);
      resize();
      setShaderState('active');
      queue(0,true);

      shaderCleanup=()=>{
        if(disposed)return;
        disposed=true;
        clearSchedule();
        observer.disconnect();
        dock.removeEventListener('pointermove',onPointerMove);
        document.removeEventListener('visibilitychange',onVisibility);
        fxCanvas.removeEventListener('webglcontextlost',onContextLost,false);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        if(debug){debug.shaderEnergy=0;debug.captureSpotlightPair=null;}
      };
      return true;
    };

    const reconcileMesh=()=>{
      if(meshCleanup){meshCleanup();meshCleanup=null;}
      if(reduce.matches)showEggoFallback('static');
      else initMesh();
    };
    const reconcileShader=()=>{
      if(shaderCleanup){shaderCleanup();shaderCleanup=null;}
      if(shaderEligible())initShader();
      else setShaderState('disabled');
    };
    const reconcile=()=>{reconcileMesh();reconcileShader();};

    showEggoFallback('static');
    setShaderState('disabled');
    reconcile();
    listenMedia(reduce,reconcile);
    listenMedia(fine,reconcileShader);
    listenMedia(wide,reconcileShader);
  });
})();
