const DEFAULT_RELAY="ws://127.0.0.1:8787/stream";
const DEFAULT_CHANNEL="local-test";
let socket=null;
let connecting=null;
let relayUrl=DEFAULT_RELAY;
let channel=DEFAULT_CHANNEL;

function sendJson(message){if(socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));}
function connect(){
  if(socket&&(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING))return Promise.resolve(true);
  if(connecting)return connecting;
  connecting=new Promise(resolve=>{
    try{
      socket=new WebSocket(relayUrl);
      socket.binaryType="arraybuffer";
      socket.addEventListener("open",()=>{sendJson({type:"subscribe",channel,screenId:"capture"});connecting=null;resolve(true)},{once:true});
      socket.addEventListener("close",()=>{socket=null});
      socket.addEventListener("error",()=>{connecting=null;resolve(false)});
    }catch{connecting=null;resolve(false)}
  });
  return connecting;
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(!message||!String(message.type||"").startsWith("THELORD_CAPTURE_"))return;
  (async()=>{
    const ok=await connect();
    if(!ok)throw new Error("Relay temporal indisponível");
    if(message.type==="THELORD_CAPTURE_BINARY"){
      socket.send(message.data);
      sendResponse({ok:true});return;
    }
    sendResponse({ok:true});
  })().catch(error=>sendResponse({ok:false,error:String(error.message||error)}));
  return true;
});