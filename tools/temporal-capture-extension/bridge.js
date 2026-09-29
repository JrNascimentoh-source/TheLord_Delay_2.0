(() => {
  "use strict";
  const PREFIX="thelord-temporal-capture";
  const host=location.hostname;
  if(host!=="127.0.0.1"&&host!=="localhost")return;
  window.addEventListener("message",event=>{
    if(event.source!==window||event.origin!==location.origin)return;
    const data=event.data;
    if(!data||data.source!==PREFIX||data.version!==1)return;
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
    chrome.runtime.sendMessage({type:"THELORD_CAPTURE_EVENT",event:data}).catch(()=>{});
  });
})();