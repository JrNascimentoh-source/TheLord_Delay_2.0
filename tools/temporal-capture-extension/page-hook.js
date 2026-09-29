(() => {
  "use strict";
  const host = location.hostname;
  if (host !== "127.0.0.1" && host !== "localhost") return;
  if (new URLSearchParams(location.search).get("thelordCapture") !== "1") return;
  const NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket || NativeWebSocket.__theLordCaptureWrapped) return;

  function emit(kind, payload) {
    window.postMessage({source:"thelord-temporal-capture",version:1,kind,...payload}, location.origin);
  }
  function observe(event, socket, index) {
    const data = event.data;
    if (typeof data === "string") {
      emit("text",{index,url:socket.url,receivedAt:Date.now(),text:data}); return;
    }
    if (data instanceof ArrayBuffer) {
      emit("binary",{index,url:socket.url,receivedAt:Date.now(),data}); return;
    }
    if (ArrayBuffer.isView(data)) {
      const copy=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
      emit("binary",{index,url:socket.url,receivedAt:Date.now(),data:copy}); return;
    }
    if (data instanceof Blob) {
      data.arrayBuffer().then(buffer=>emit("binary",{index,url:socket.url,receivedAt:Date.now(),data:buffer})).catch(()=>{});
    }
  }
  function attach(socket,index) {
    socket.addEventListener("message",event=>observe(event,socket,index));
    emit("open-created",{index,url:socket.url,createdAt:Date.now()});
  }
  function WrappedWebSocket(url,protocols) {
    const socket=protocols===undefined?new NativeWebSocket(url):new NativeWebSocket(url,protocols);
    attach(socket,WrappedWebSocket.__nextIndex++);
    return socket;
  }
  WrappedWebSocket.__nextIndex=1;
  WrappedWebSocket.prototype=NativeWebSocket.prototype;
  WrappedWebSocket.CONNECTING=NativeWebSocket.CONNECTING;
  WrappedWebSocket.OPEN=NativeWebSocket.OPEN;
  WrappedWebSocket.CLOSING=NativeWebSocket.CLOSING;
  WrappedWebSocket.CLOSED=NativeWebSocket.CLOSED;
  WrappedWebSocket.__theLordCaptureWrapped=true;
  window.WebSocket=WrappedWebSocket;
  emit("ready",{page:location.href});
})();