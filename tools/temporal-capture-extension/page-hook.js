(() => {
  "use strict";

  /*
   * Network-like delay for the selected external page.
   * The bytes/data are never changed: only delivery to WebSocket listeners
   * is postponed, exactly like extra network latency.
   */
  const host = location.hostname;
  const supported =
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "7a7bb.com" ||
    host.endsWith(".7a7bb.com");
  if (!supported) return;

  let delayMs = 0;
  const listenerMap = new WeakMap();
  const originalAdd = WebSocket.prototype.addEventListener;
  const originalRemove = WebSocket.prototype.removeEventListener;
  const nativeOnMessage = Object.getOwnPropertyDescriptor(WebSocket.prototype, "onmessage");

  function normalizeDelay(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  function currentDelay() {
    return delayMs;
  }

  function deliver(listener, socket, event) {
    const wait = currentDelay();
    if (wait <= 0) {
      if (typeof listener === "function") return listener.call(socket, event);
      if (listener && typeof listener.handleEvent === "function") {
        return listener.handleEvent.call(listener, event);
      }
      return;
    }

    setTimeout(() => {
      if (typeof listener === "function") {
        listener.call(socket, event);
      } else if (listener && typeof listener.handleEvent === "function") {
        listener.handleEvent.call(listener, event);
      }
    }, wait);
  }

  WebSocket.prototype.addEventListener = function(type, listener, options) {
    if (type !== "message" || !listener) {
      return originalAdd.call(this, type, listener, options);
    }

    const wrapped = event => deliver(listener, this, event);
    let map = listenerMap.get(this);
    if (!map) {
      map = [];
      listenerMap.set(this, map);
    }
    map.push({listener, wrapped, options});
    return originalAdd.call(this, type, wrapped, options);
  };

  WebSocket.prototype.removeEventListener = function(type, listener, options) {
    if (type !== "message" || !listener) {
      return originalRemove.call(this, type, listener, options);
    }

    const map = listenerMap.get(this) || [];
    const entry = map.find(item => item.listener === listener);
    if (!entry) return originalRemove.call(this, type, listener, options);

    const result = originalRemove.call(this, type, entry.wrapped, options);
    const index = map.indexOf(entry);
    if (index >= 0) map.splice(index, 1);
    return result;
  };

  if (nativeOnMessage && nativeOnMessage.get && nativeOnMessage.set) {
    const handlerState = new WeakMap();

    Object.defineProperty(WebSocket.prototype, "onmessage", {
      configurable: true,
      enumerable: nativeOnMessage.enumerable,
      get() {
        return handlerState.get(this) || null;
      },
      set(handler) {
        const previous = handlerState.get(this);
        if (previous) {
          const oldWrapped = previous.wrapped;
          originalRemove.call(this, "message", oldWrapped);
        }

        if (typeof handler !== "function") {
          handlerState.delete(this);
          nativeOnMessage.set.call(this, null);
          return;
        }

        const wrapped = event => deliver(handler, this, event);
        handlerState.set(this, {handler, wrapped});
        nativeOnMessage.set.call(this, wrapped);
      }
    });
  }

  window.addEventListener("message", event => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== "THELORD_DELAY_CONFIG") return;

    delayMs = normalizeDelay(data.delayMs);
    window.postMessage({
      source: "thelord-delay-network",
      version: 1,
      delayMs,
      screenId: String(data.screenId || "")
    }, "*");
  });

  window.postMessage({
    source: "thelord-delay-network",
    version: 1,
    delayMs: 0,
    screenId: ""
  }, "*");
})();
