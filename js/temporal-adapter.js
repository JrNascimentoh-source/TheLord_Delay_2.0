(function(){
  "use strict";

  const bridge=()=>window.TheLordDelayBridge;
  const state={socket:null,connected:false,screenId:null,url:"",channel:"",lastError:""};

  function close(){
    if(state.socket){
      try{state.socket.close();}catch(e){}
    }
    state.socket=null;state.connected=false;
  }

  function connect(options){
    options=options||{};
    close();
    const url=String(options.url||"").trim();
    const screenId=String(options.screenId||2);
    const channel=String(options.channel||"default");
    if(!url) throw new Error("Temporal adapter: URL do relay não informada.");
    if(!bridge() || typeof bridge().ingest!=="function") throw new Error("Temporal adapter: bridge ainda não está pronto.");

    const ws=new WebSocket(url);
    ws.binaryType="arraybuffer";
    state.socket=ws;state.screenId=screenId;state.url=url;state.channel=channel;state.lastError="";

    ws.addEventListener("open",function(){
      state.connected=true;
      ws.send(JSON.stringify({type:"subscribe",channel,screenId}));
      window.dispatchEvent(new CustomEvent("thelord:temporal-adapter",{detail:{type:"open",screenId,channel}}));
    });
    ws.addEventListener("message",function(event){
      let message;
      try{
        message=typeof event.data==="string"?JSON.parse(event.data):null;
      }catch(e){return;}
      if(!message || message.type!=="data") return;
      const receivedAt=Number(message.receivedAt)||Date.now();
      bridge().ingest(screenId,message.payload,receivedAt);
      window.dispatchEvent(new CustomEvent("thelord:temporal-source-data",{detail:{screenId,payload:message.payload,receivedAt}}));
    });
    ws.addEventListener("error",function(){
      state.lastError="WebSocket error";
      window.dispatchEvent(new CustomEvent("thelord:temporal-adapter",{detail:{type:"error",screenId}}));
    });
    ws.addEventListener("close",function(){
      state.connected=false;
      window.dispatchEvent(new CustomEvent("thelord:temporal-adapter",{detail:{type:"close",screenId}}));
    });
    return true;
  }

  function ingest(screenId,payload,receivedAt){
    if(!bridge()) return false;
    return bridge().ingest(String(screenId),payload,receivedAt);
  }

  window.TheLordTemporalAdapter={
    version:1,
    connect,
    close,
    ingest,
    status:function(){return {...state};}
  };
})();
