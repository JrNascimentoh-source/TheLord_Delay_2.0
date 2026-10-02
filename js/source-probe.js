(function(){
  "use strict";
  const VERSION=1;
  const state={version:VERSION,startedAt:Date.now(),frames:{},events:[],lastError:null};

  function redactUrl(raw){
    try{
      const u=new URL(String(raw),location.href);
      ["token","pass","password","pwd","acc","account","authorization","auth","session","sid"].forEach(k=>u.searchParams.has(k)&&u.searchParams.set(k,"[redacted]"));
      return u.href;
    }catch(_){return String(raw).replace(/([?&](?:token|pass|password|pwd|acc|account|authorization|auth|session|sid)=)[^&#]*/ig,"$1[redacted]")}
  }
  function push(type,data){
    const item={at:Date.now(),type,...data};
    state.events.push(item);
    if(state.events.length>200)state.events.shift();
    window.dispatchEvent(new CustomEvent("thelord:source-event",{detail:item}));
  }
  function safeOrigin(url){try{return new URL(url,location.href).origin}catch(_){return ""}}

  function install(win,frameId){
    if(!win||win.__TheLordSourceProbeInstalled)return {ok:false,reason:"already-installed"};
    try{
      const originalWS=win.WebSocket;
      if(typeof originalWS==="function"){
        function ProbeWebSocket(url,protocols){
          const ws=protocols===undefined?new originalWS(url):new originalWS(url,protocols);
          push("websocket-open",{frameId,url:redactUrl(url),origin:safeOrigin(url)});
          ["open","message","close","error"].forEach(type=>ws.addEventListener(type,e=>{
            push("websocket-"+type,{frameId,url:redactUrl(url),bytes:e&&e.data instanceof ArrayBuffer?e.data.byteLength:undefined});
          }));
          return ws;
        }
        ProbeWebSocket.prototype=originalWS.prototype;
        try{Object.setPrototypeOf(ProbeWebSocket,originalWS)}catch(_){}
        win.WebSocket=ProbeWebSocket;
      }

      if(win.fetch){
        const originalFetch=win.fetch.bind(win);
        win.fetch=function(input,init){
          const url=typeof input==="string"?input:(input&&input.url)||"";
          push("fetch",{frameId,url:redactUrl(url),method:(init&&init.method)||"GET"});
          return originalFetch(input,init).then(r=>{
            push("fetch-response",{frameId,url:redactUrl(url),status:r.status});
            return r;
          });
        };
      }

      const originalXHR=win.XMLHttpRequest;
      if(originalXHR){
        const open=originalXHR.prototype.open,send=originalXHR.prototype.send;
        originalXHR.prototype.open=function(method,url){
          this.__theLordProbe={method,url:redactUrl(url)};
          return open.apply(this,arguments);
        };
        originalXHR.prototype.send=function(){
          const meta=this.__theLordProbe||{};
          push("xhr",{frameId,method:meta.method||"GET",url:meta.url||""});
          return send.apply(this,arguments);
        };
      }

      win.__TheLordSourceProbeInstalled=true;
      push("probe-installed",{frameId});
      return {ok:true};
    }catch(error){
      state.lastError=String(error);
      push("probe-error",{frameId,error:String(error)});
      return {ok:false,reason:String(error)};
    }
  }

  function inspectFrame(frameId,frame){
    const url=frame&&frame.src||"";
    const result={frameId,url:redactUrl(url),sameOrigin:false,installed:false,blocked:false};
    try{
      const win=frame.contentWindow;
      result.sameOrigin=win.location.origin===location.origin;
      if(result.sameOrigin) result.installed=install(win,frameId).ok;
      else result.blocked=true;
    }catch(error){
      result.blocked=true;
      result.reason="cross-origin";
    }
    state.frames[frameId]=result;
    push("frame-inspected",result);
    return result;
  }

  function inspectAll(){
    document.querySelectorAll(".screen-frame").forEach((frame,i)=>inspectFrame(String(i+1),frame));
    return snapshot();
  }

  function snapshot(){
    return {version:VERSION,startedAt:state.startedAt,frames:state.frames,lastError:state.lastError,events:state.events.slice(-50)};
  }

  window.TheLordSourceProbe={version:VERSION,inspectFrame,inspectAll,snapshot,redactUrl};
  window.addEventListener("load",()=>setTimeout(inspectAll,300));
})();