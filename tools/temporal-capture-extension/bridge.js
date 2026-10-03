(() => {
  "use strict";
  const PREFIX="thelord-temporal-capture";
  const host=location.hostname;
  const isLocal=host==="127.0.0.1"||host==="localhost";

  chrome.runtime.sendMessage({
    type:"THELORD_FRAME_HELLO",
    href:location.href
  }).catch(()=>{});

  window.addEventListener("message",event=>{
    if(event.source!==window)return;
    const data=event.data;
    if(!data||data.version!==1)return;

    if(isLocal&&event.origin===location.origin&&data.source==="thelord-cdp"){
      chrome.runtime.sendMessage({
        type:"THELORD_CDP_CONFIG",
        screenId:String(data.screenId||""),
        delayMs:Number(data.delayMs)||0,
        active:!!data.active
      }).catch(()=>{});
      return;
    }

    if(data.source!==PREFIX)return;

    if(data.kind==="binary"&&data.data instanceof ArrayBuffer){
      chrome.runtime.sendMessage({
        type:"THELORD_CAPTURE_BINARY",
        channel:"local-test",
        receivedAt:Number(data.receivedAt)||Date.now(),
        url:String(data.url||""),
        data:data.data
      }).catch(()=>{});
      return;
    }

    chrome.runtime.sendMessage({
      type:"THELORD_CAPTURE_EVENT",
      event:data
    }).catch(()=>{});
  });

  chrome.runtime.onMessage.addListener(message=>{
    if(!message)return;
    if(message.type==="THELORD_CDP_STATUS"){
      try{
        window.postMessage({
          source:"thelord-cdp",
          version:1,
          type:"status",
          status:message.status||{}
        },"*");
      }catch{}
    }
  });
})();