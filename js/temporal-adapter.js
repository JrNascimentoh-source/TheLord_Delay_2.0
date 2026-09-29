(function(){
  "use strict";

  const bridge=()=>window.TheLordDelayBridge;
  const decoder=()=>window.TheLordTemporalDecoder;
  const state={socket:null,connected:false,screenId:null,url:"",channel:"",lastError:"",frames:0,decoded:0,binary:0};

  function close(){if(state.socket){try{state.socket.close();}catch(e){}}state.socket=null;state.connected=false;}

  async function handle(event){
    let result;
    try{result=await decoder().decode(event.data,{screenId:state.screenId,channel:state.channel});}
    catch(error){state.lastError=String(error&&error.message||error);return;}
    state.frames++;
    if(result.kind==="binary") state.binary++;
    if(result.kind==="decoded"||result.kind==="json"){
      state.decoded++;
      const receivedAt=Date.now();
      bridge().ingest(state.screenId,result.payload,receivedAt);
      window.dispatchEvent(new CustomEvent("thelord:temporal-source-data",{detail:{screenId:state.screenId,payload:result.payload,receivedAt,kind:result.kind}}));
      return;
    }
    window.dispatchEvent(new CustomEvent("thelord:temporal-binary-frame",{detail:{screenId:state.screenId,channel:state.channel,result}}));
  }

  function connect(options){
    options=options||{};close();
    const url=String(options.url||"").trim(),screenId=String(options.screenId||2),channel=String(options.channel||"default");
    if(!url) throw new Error("Temporal adapter: URL do relay não informada.");
    if(!bridge()||!decoder()) throw new Error("Temporal adapter: pipeline ainda não está pronto.");
    const ws=new WebSocket(url);ws.binaryType="arraybuffer";
    state.socket=ws;state.screenId=screenId;state.url=url;state.channel=channel;state.lastError="";state.frames=0;state.decoded=0;state.binary=0;
    ws.addEventListener("open",()=>{state.connected=true;ws.send(JSON.stringify({type:"subscribe",channel,screenId}));window.dispatchEvent(new CustomEvent("thelord:temporal-adapter",{detail:{type:"open",screenId,channel}}));});
    ws.addEventListener("message",handle);
    ws.addEventListener("error",()=>{state.lastError="WebSocket error";window.dispatchEvent(new CustomEvent("thelord:temporal-adapter",{detail:{type:"error",screenId}}));});
    ws.addEventListener("close",()=>{state.connected=false;window.dispatchEvent(new CustomEvent("thelord:temporal-adapter",{detail:{type:"close",screenId}}));});
    return true;
  }
  function ingest(screenId,payload,receivedAt){return bridge()?bridge().ingest(String(screenId),payload,receivedAt):false;}
  window.TheLordTemporalAdapter={version:2,connect,close,ingest,status:()=>({...state})};
})();
