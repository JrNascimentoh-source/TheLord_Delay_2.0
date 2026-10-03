const DEFAULT_RELAY="ws://127.0.0.1:8787/stream";
const DEFAULT_CHANNEL="local-test";

let socket=null;
let connecting=null;
let relayUrl=DEFAULT_RELAY;
let channel=DEFAULT_CHANNEL;

const debuggerStates=new Map();
const CDP_HOOK_VERSION=1;

function sendJson(message){
  if(socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));
}

function connect(){
  if(socket&&(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING))return Promise.resolve(true);
  if(connecting)return connecting;
  connecting=new Promise(resolve=>{
    try{
      socket=new WebSocket(relayUrl);
      socket.binaryType="arraybuffer";
      socket.addEventListener("open",()=>{
        sendJson({type:"subscribe",channel,screenId:"capture"});
        connecting=null;
        resolve(true);
      },{once:true});
      socket.addEventListener("close",()=>{socket=null});
      socket.addEventListener("error",()=>{connecting=null;resolve(false)});
    }catch{
      connecting=null;
      resolve(false);
    }
  });
  return connecting;
}

async function cdp(tabId,method,params={},sessionId){
  const target={tabId};
  if(sessionId)target.sessionId=sessionId;
  return chrome.debugger.sendCommand(target,method,params);
}

function stateFor(tabId){
  let state=debuggerStates.get(tabId);
  if(!state){
    state={
      tabId,
      attached:false,
      active:false,
      screenId:"",
      delayMs:0,
      selectedFrameId:"",
      selectedFrames:new Set(),
      sessions:new Map(),
      injected:new Set(),
      status:"idle",
      error:""
    };
    debuggerStates.set(tabId,state);
  }
  return state;
}

function postStatus(tabId,extra={}){
  const state=debuggerStates.get(tabId);
  if(!state)return;
  const status={
    source:"thelord-cdp",
    version:CDP_HOOK_VERSION,
    screenId:state.screenId,
    active:state.active,
    delayMs:state.delayMs,
    selectedFrameId:state.selectedFrameId,
    selectedFrames:[...state.selectedFrames],
    attached:state.attached,
    status:state.status,
    error:state.error,
    targets:[...state.sessions.values()].map(x=>({
      targetId:x.targetId,
      sessionId:x.sessionId,
      type:x.type,
      url:x.url,
      parentFrameId:x.parentFrameId||"",
      hooked:x.hooked
    })),
    injected:state.injected.size,
    timestamp:Date.now(),
    ...extra
  };
  chrome.tabs.sendMessage(tabId,{type:"THELORD_CDP_STATUS",status}).catch(()=>{});
}

function attrsToObject(attrs=[]){
  const out={};
  for(let i=0;i<attrs.length;i+=2)out[attrs[i]]=attrs[i+1]??"";
  return out;
}

async function findScreenFrame(tabId,screenId){
  const tree=await cdp(tabId,"Page.getFrameTree");
  const wanted="Navegador da Tela "+String(screenId);
  const found=[];

  function walk(node){
    if(!node)return;
    const frame=node.frame||{};
    if(frame.id){
      found.push({frame,node});
    }
    for(const child of node.childFrames||[])walk(child);
  }
  walk(tree.frameTree);

  for(const item of found){
    if(item.frame.id===tree.frameTree.frame.id)continue;
    try{
      const owner=await cdp(tabId,"DOM.getFrameOwner",{frameId:item.frame.id});
      if(!owner?.backendNodeId)continue;
      const described=await cdp(tabId,"DOM.describeNode",{backendNodeId:owner.backendNodeId});
      const attrs=attrsToObject(described?.node?.attributes||[]);
      if(attrs.title===wanted)return item.frame.id;
    }catch{}
  }
  return "";
}

function collectFrameSubtree(tree,rootId,set){
  if(!tree)return;
  if(tree.frame?.id===rootId){
    const walk=node=>{
      if(!node)return;
      set.add(node.frame.id);
      for(const child of node.childFrames||[])walk(child);
    };
    walk(tree);
    return true;
  }
  for(const child of tree.childFrames||[]){
    if(collectFrameSubtree(child,rootId,set))return true;
  }
  return false;
}

function shouldHookContext(state,source,params){
  const context=params?.context;
  const aux=context?.auxData||{};
  const frameId=String(aux.frameId||"");
  if(frameId&&state.selectedFrames.has(frameId))return true;

  const sessionId=source?.sessionId||"";
  const target=state.sessions.get(sessionId);
  if(target&&target.selected) return true;

  return false;
}

function makeHookExpression(delayMs,screenId){
  const d=Math.max(0,Number(delayMs)||0);
  const sid=String(screenId||"");
  return `(()=>{const CFG={delayMs:${d},screenId:${JSON.stringify(sid)},version:1};
    const G=globalThis;
    const old=G.__THELORD_CDP_DELAY_HOOK__;
    if(old&&old.version===1){old.set(CFG.delayMs,CFG.screenId);return "updated";}
    const state={version:1,delayMs:CFG.delayMs,screenId:CFG.screenId,captured:0,delivered:0};
    G.__THELORD_CDP_DELAY_HOOK__={version:1,set:(ms,id)=>{state.delayMs=Math.max(0,Number(ms)||0);state.screenId=String(id||"");},status:()=>({...state})};
    const Native=G.WebSocket;
    if(typeof Native!=="function")return "no-websocket";
    const originalAdd=Native.prototype.addEventListener;
    const originalRemove=Native.prototype.removeEventListener;
    const nativeOnMessage=Object.getOwnPropertyDescriptor(Native.prototype,"onmessage");
    const installed=new WeakSet();
    const delayed=new WeakSet();
    const listeners=new WeakMap();
    const handlers=new WeakMap();
    function isAviator(ws){try{return new URL(ws.url).pathname==="/parties/main/aviator";}catch{return false;}}
    function dispatch(ws,event){
      const data=event.data;
      let copy;
      try{copy=new MessageEvent("message",{data,origin:event.origin||"",lastEventId:event.lastEventId||"",source:event.source||null,ports:event.ports||[]});}
      catch{copy=event;}
      delayed.add(copy);
      state.delivered++;
      try{ws.dispatchEvent(copy);}catch{}
    }
    function capture(ws){
      if(!ws||installed.has(ws))return;
      installed.add(ws);
      originalAdd.call(ws,"message",event=>{
        if(delayed.has(event))return;
        state.captured++;
        const wait=isAviator(ws)?state.delayMs:0;
        if(wait<=0){state.delivered++;return;}
        try{event.stopImmediatePropagation();}catch{}
        setTimeout(()=>dispatch(ws,event),wait);
      },true);
    }
    Native.prototype.addEventListener=function(type,listener,options){
      if(type!=="message"||!listener)return originalAdd.call(this,type,listener,options);
      capture(this);
      const wrapped=event=>{
        const wait=isAviator(this)?state.delayMs:0;
        if(wait<=0)return typeof listener==="function"?listener.call(this,event):listener.handleEvent?.(event);
        setTimeout(()=>typeof listener==="function"?listener.call(this,event):listener.handleEvent?.(event),wait);
      };
      let list=listeners.get(this);if(!list){list=[];listeners.set(this,list);}
      list.push({listener,wrapped,options});
      return originalAdd.call(this,type,wrapped,options);
    };
    Native.prototype.removeEventListener=function(type,listener,options){
      if(type!=="message"||!listener)return originalRemove.call(this,type,listener,options);
      const list=listeners.get(this)||[];
      for(const item of list.filter(x=>x.listener===listener)){
        originalRemove.call(this,type,item.wrapped,options);
        const i=list.indexOf(item);if(i>=0)list.splice(i,1);
      }
    };
    if(nativeOnMessage?.get&&nativeOnMessage?.set){
      Object.defineProperty(Native.prototype,"onmessage",{configurable:nativeOnMessage.configurable,enumerable:nativeOnMessage.enumerable,
        get(){return handlers.get(this)?.handler??nativeOnMessage.get.call(this);},
        set(handler){
          capture(this);
          const prev=handlers.get(this);
          if(prev)originalRemove.call(this,"message",prev.wrapped);
          if(typeof handler!=="function"){handlers.delete(this);return nativeOnMessage.set.call(this,handler);}
          const wrapped=event=>{const wait=isAviator(this)?state.delayMs:0;if(wait<=0)return handler.call(this,event);setTimeout(()=>handler.call(this,event),wait);};
          handlers.set(this,{handler,wrapped});nativeOnMessage.set.call(this,wrapped);
        }
      });
    }
    function proxy(C){
      if(typeof C!=="function")return C;
      try{return new Proxy(C,{construct(target,args,newTarget){const ws=Reflect.construct(target,args,newTarget);capture(ws);return ws;},apply(target,thisArg,args){return Reflect.apply(target,thisArg,args);}});}catch{return C;}
    }
    let exposed=proxy(Native);
    try{G.WebSocket=exposed;}catch{}
    try{
      const desc=Object.getOwnPropertyDescriptor(G,"WebSocket");
      if(desc?.configurable){
        Object.defineProperty(G,"WebSocket",{configurable:true,enumerable:desc.enumerable,get(){return exposed;},set(next){exposed=proxy(next);}});
      }
    }catch{}
    try{
      const timer=setInterval(()=>{try{if(G.WebSocket!==exposed){exposed=proxy(G.WebSocket);G.WebSocket=exposed;}}catch{}},1000);
      if(timer?.unref)timer.unref();
    }catch{}
    return "installed";
  })()`;
}

async function injectIntoSession(state,source,contextId){
  const sessionId=source?.sessionId||"";
  const key=(sessionId||"root")+":"+String(contextId);
  if(state.injected.has(key))return;
  try{
    const result=await cdp(state.tabId,"Runtime.evaluate",{
      expression:makeHookExpression(state.delayMs,state.screenId),
      contextId,
      returnByValue:true,
      silent:true,
      awaitPromise:false
    },sessionId||undefined);
    state.injected.add(key);
    postStatus(state.tabId,{lastInjection:{key,result:result?.result?.value||"ok"}});
  }catch(error){
    postStatus(state.tabId,{lastInjectionError:String(error.message||error)});
  }
}

async function configureDebugger(tabId,screenId,delayMs,active){
  const state=stateFor(tabId);
  state.screenId=String(screenId||"");
  state.delayMs=Math.max(0,Number(delayMs)||0);
  state.active=!!active&&state.delayMs>0;
  state.error="";

  if(!state.active){
    if(state.attached){
      try{await chrome.debugger.detach({tabId});}catch{}
    }
    debuggerStates.delete(tabId);
    postStatus(tabId,{status:"disabled"});
    return;
  }

  try{
    if(!state.attached){
      await chrome.debugger.attach({tabId},"0.1");
      state.attached=true;
    }

    await cdp(tabId,"Runtime.enable");
    await cdp(tabId,"Page.enable");
    await cdp(tabId,"DOM.enable");

    const tree=await cdp(tabId,"Page.getFrameTree");
    state.selectedFrameId=await findScreenFrame(tabId,state.screenId);
    state.selectedFrames.clear();
    if(state.selectedFrameId)collectFrameSubtree(tree.frameTree,state.selectedFrameId,state.selectedFrames);

    await cdp(tabId,"Target.setAutoAttach",{
      autoAttach:true,
      waitForDebuggerOnStart:true,
      flatten:true,
      filter:[
        {type:"iframe",exclude:false},
        {type:"worker",exclude:false},
        {type:"shared_worker",exclude:false},
        {type:"service_worker",exclude:false}
      ]
    });

    state.status=state.selectedFrameId?"armed":"frame-not-found";
    postStatus(tabId);

    if(state.selectedFrameId){
      const selectedUrl=(tree.frameTree.childFrames||[])
        .flatMap(x=>[x.frame,...(x.childFrames||[]).map(y=>y.frame)])
        .find(f=>f.id===state.selectedFrameId)?.url||"";
      if(selectedUrl){
        await cdp(tabId,"Page.navigate",{frameId:state.selectedFrameId,url:selectedUrl});
      }
    }
  }catch(error){
    state.status="error";
    state.error=String(error.message||error);
    postStatus(tabId);
  }
}

chrome.debugger.onEvent.addListener(async(source,method,params)=>{
  const tabId=source?.tabId;
  if(typeof tabId!=="number")return;
  const state=debuggerStates.get(tabId);
  if(!state)return;

  if(method==="Target.attachedToTarget"){
    const ti=params?.targetInfo||{};
    const sid=params?.sessionId||"";
    const parentFrame=String(ti.parentFrameId||"");
    const selected=!!parentFrame&&state.selectedFrames.has(parentFrame);
    state.sessions.set(sid,{targetId:ti.targetId,sessionId:sid,type:ti.type,url:ti.url||"",parentFrameId:parentFrame,selected,hooked:false});
    try{
      await cdp(tabId,"Runtime.enable",{},sid);
      await cdp(tabId,"Page.enable",{},sid);
      if(selected){
        await cdp(tabId,"Target.setAutoAttach",{
          autoAttach:true,
          waitForDebuggerOnStart:true,
          flatten:true,
          filter:[
            {type:"iframe",exclude:false},
            {type:"worker",exclude:false},
            {type:"shared_worker",exclude:false},
            {type:"service_worker",exclude:false}
          ]
        },sid);
      }
      if(params.waitingForDebugger)await cdp(tabId,"Runtime.runIfWaitingForDebugger",{},sid);
    }catch(error){
      postStatus(tabId,{targetError:String(error.message||error)});
    }
    postStatus(tabId);
    return;
  }

  if(method==="Runtime.executionContextCreated"){
    if(!shouldHookContext(state,source,params))return;
    const context=params.context;
    const aux=context?.auxData||{};
    if(aux.type==="isolated")return;
    await injectIntoSession(state,source,context.id);
    const sid=source.sessionId||"";
    const target=state.sessions.get(sid);
    if(target)target.hooked=true;
    if(aux.type==="worker"||target?.type==="worker"||target?.type==="shared_worker"){
      if(params.context?.origin)postStatus(tabId,{workerContext:{sessionId:sid,origin:params.context.origin,frameId:aux.frameId||""}});
    }
    return;
  }

  if(method==="Runtime.executionContextsCleared"){
    for(const key of [...state.injected])if(key.startsWith((source.sessionId||"root")+":"))state.injected.delete(key);
    return;
  }

  if(method==="Target.detachedFromTarget"){
    state.sessions.delete(params?.sessionId||"");
    postStatus(tabId);
  }
});

chrome.debugger.onDetach.addListener(source=>{
  const tabId=source?.tabId;
  if(typeof tabId!=="number")return;
  const state=debuggerStates.get(tabId);
  if(state){
    state.attached=false;
    state.status="detached";
    postStatus(tabId);
    debuggerStates.delete(tabId);
  }
});

chrome.tabs.onRemoved.addListener(tabId=>{
  debuggerStates.delete(tabId);
});

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(!message)return;

  if(message.type==="THELORD_CDP_CONFIG"){
    const tabId=sender?.tab?.id;
    if(typeof tabId!=="number"){
      sendResponse({ok:false,error:"Aba não identificada"});
      return;
    }
    configureDebugger(
      tabId,
      message.screenId,
      message.delayMs,
      message.active
    ).then(()=>sendResponse({ok:true})).catch(error=>sendResponse({ok:false,error:String(error.message||error)}));
    return true;
  }

  if(message.type==="THELORD_CAPTURE_BINARY"){
    (async()=>{
      const ok=await connect();
      if(!ok)throw new Error("Relay temporal indisponível");
      socket.send(message.data);
      sendResponse({ok:true});
    })().catch(error=>sendResponse({ok:false,error:String(error.message||error)}));
    return true;
  }

  if(message.type==="THELORD_CAPTURE_EVENT"){
    sendResponse({ok:true});
    return false;
  }

  return false;
});
