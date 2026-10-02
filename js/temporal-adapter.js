(function(){
  "use strict";

  const bridge=()=>window.TheLordDelayBridge;
  const decoder=()=>window.TheLordTemporalDecoder;
  const sockets=new Map(), states=new Map();

  function stateFor(id){
    id=String(id);
    if(!states.has(id)){
      states.set(id,{
        socket:null,connected:false,screenId:id,url:"",channel:"",
        delayMs:0,lastError:"",frames:0,decoded:0,binary:0,
        lastDiagnosticAt:0
      });
    }
    return states.get(id);
  }

  function close(id){
    if(id===undefined||id===null){
      [...sockets.keys()].forEach(close);
      return;
    }
    id=String(id);
    const ws=sockets.get(id);
    if(ws){try{ws.close()}catch(e){}}
    sockets.delete(id);
    const s=stateFor(id);
    s.socket=null;
    s.connected=false;
  }

  function emitDiagnostic(s,payload){
    const t=Date.now();
    /* Do not create a DOM event for every game frame. */
    if(t-s.lastDiagnosticAt<250) return;
    s.lastDiagnosticAt=t;
    window.dispatchEvent(new CustomEvent("thelord:temporal-source-data",{
      detail:payload
    }));
  }

  async function handle(id,event){
    const s=stateFor(id);
    let result;

    try{
      result=await decoder().decode(event.data,{
        screenId:s.screenId,
        channel:s.channel
      });
    }catch(error){
      s.lastError=String(error&&error.message||error);
      return;
    }

    s.frames++;

    if(result.kind==="binary"){
      s.binary++;
      window.dispatchEvent(new CustomEvent("thelord:temporal-binary-frame",{
        detail:{
          screenId:s.screenId,
          channel:s.channel,
          delayMs:s.delayMs,
          result
        }
      }));
      return;
    }

    if(result.kind==="decoded"||result.kind==="json"){
      s.decoded++;

      const receivedAt=Date.now();
      const targetBridge=bridge();

      if(!targetBridge){
        s.lastError="Delay bridge indisponível";
        return;
      }

      const accepted=targetBridge.ingest(
        s.screenId,
        result.payload,
        receivedAt
      );

      if(!accepted) s.lastError="Delay bridge rejeitou o frame";

      emitDiagnostic(s,{
        screenId:s.screenId,
        channel:s.channel,
        delayMs:s.delayMs,
        payload:result.payload,
        receivedAt,
        kind:result.kind
      });
    }
  }

  function connect(options){
    options=options||{};
    const id=String(options.screenId||2);
    close(id);

    const url=String(options.url||"").trim();
    const channel=String(options.channel||"default");
    const delayMs=Math.max(0,Math.floor(Number(options.delayMs||0)));

    if(!url) throw new Error("Temporal adapter: URL do relay não informada.");
    if(!bridge()||!decoder()) throw new Error("Temporal adapter: pipeline ainda não está pronto.");

    const s=stateFor(id);
    const ws=new WebSocket(url);
    ws.binaryType="arraybuffer";

    s.socket=ws;
    s.screenId=id;
    s.url=url;
    s.channel=channel;
    s.delayMs=delayMs;
    s.lastError="";
    s.frames=0;
    s.decoded=0;
    s.binary=0;
    s.lastDiagnosticAt=0;
    sockets.set(id,ws);

    ws.addEventListener("open",()=>{
      s.connected=true;
      ws.send(JSON.stringify({
        type:"subscribe",
        channel,
        screenId:id,
        delayMs:0
      }));
      window.dispatchEvent(new CustomEvent("thelord:temporal-adapter",{
        detail:{type:"open",screenId:id,channel,delayMs:s.delayMs}
      }));
    });

    ws.addEventListener("message",event=>handle(id,event));

    ws.addEventListener("error",()=>{
      s.lastError="WebSocket error";
      window.dispatchEvent(new CustomEvent("thelord:temporal-adapter",{
        detail:{type:"error",screenId:id,channel,delayMs:s.delayMs}
      }));
    });

    ws.addEventListener("close",()=>{
      s.connected=false;
      if(sockets.get(id)===ws) sockets.delete(id);
      window.dispatchEvent(new CustomEvent("thelord:temporal-adapter",{
        detail:{type:"close",screenId:id,channel,delayMs:s.delayMs}
      }));
    });

    return true;
  }

  function connectScreens(options){
    options=options||{};
    (options.screenIds||[1,2]).forEach(id=>connect({...options,screenId:id}));
    return true;
  }

  function ingest(id,payload,receivedAt){
    return bridge()
      ? bridge().ingest(String(id),payload,receivedAt)
      : false;
  }

  function status(id){
    if(id===undefined||id===null){
      const out={};
      states.forEach((v,k)=>{out[k]={...v,socket:undefined}});
      return out;
    }
    return {...stateFor(id),socket:undefined};
  }

  window.TheLordTemporalAdapter={
    version:6,
    connect,
    connectScreens,
    close,
    ingest,
    status
  };
})();