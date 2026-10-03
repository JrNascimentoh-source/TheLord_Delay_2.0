const DEFAULT_RELAY="ws://127.0.0.1:8787/stream";
const DEFAULT_CHANNEL="local-test";
const AVIATOR_THROTTLE_RULES=[
  {urlPattern:"wss://api.r-o-4-m.com/parties/main/aviator*",latency:1500,downloadThroughput:4096,uploadThroughput:4096,offline:false},
  {urlPattern:"https://api.r-o-4-m.com/parties/main/aviator*",latency:1500,downloadThroughput:4096,uploadThroughput:4096,offline:false}
];
let socket=null;
let connecting=null;
let relayUrl=DEFAULT_RELAY;
let channel=DEFAULT_CHANNEL;
const throttledTabs=new Set();

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
      socket.addEventListener("open",()=>{sendJson({type:"subscribe",channel,screenId:"capture"});connecting=null;resolve(true)},{once:true});
      socket.addEventListener("close",()=>{socket=null});
      socket.addEventListener("error",()=>{connecting=null;resolve(false)});
    }catch{connecting=null;resolve(false)}
  });
  return connecting;
}
async function setThrottle(tabId,enabled){
  const debuggee={tabId};
  if(enabled){
    if(!throttledTabs.has(tabId)){
      await chrome.debugger.attach(debuggee,"1.3");
      await chrome.debugger.sendCommand(debuggee,"Network.enable");
      await chrome.debugger.sendCommand(debuggee,"Network.emulateNetworkConditionsByRule",{matchedNetworkConditions:AVIATOR_THROTTLE_RULES});
      throttledTabs.add(tabId);
    }
    return {ok:true,enabled:true,mode:"aviator-3g-test"};
  }
  if(throttledTabs.has(tabId)){
    try{await chrome.debugger.detach(debuggee)}catch{}
    throttledTabs.delete(tabId);
  }
  return {ok:true,enabled:false};
}
chrome.debugger.onDetach.addListener(source=>{
  if(source.tabId!=null)throttledTabs.delete(source.tabId);
});
chrome.tabs.onRemoved.addListener(tabId=>throttledTabs.delete(tabId));

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(!message)return;
  if(message.type==="THELORD_NETWORK_THROTTLE"){
    const tabId=sender.tab?.id;
    if(tabId==null){sendResponse({ok:false,error:"Aba do aplicativo não identificada"});return;}
    setThrottle(tabId,!!message.enabled).then(sendResponse).catch(error=>sendResponse({ok:false,error:String(error.message||error)}));
    return true;
  }
  if(!String(message.type||"").startsWith("THELORD_CAPTURE_"))return;
  (async()=>{
    const ok=await connect();
    if(!ok)throw new Error("Relay temporal indisponível");
    if(message.type==="THELORD_CAPTURE_BINARY"){socket.send(message.data);sendResponse({ok:true});return;}
    sendResponse({ok:true});
  })().catch(error=>sendResponse({ok:false,error:String(error.message||error)}));
  return true;
});