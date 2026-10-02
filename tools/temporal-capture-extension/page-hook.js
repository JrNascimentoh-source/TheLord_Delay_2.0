(() => {
  "use strict";

  /*
   * Network-like delay for the selected external page.
   * The payload/event is never changed: only delivery to page listeners
   * is postponed.
   */
  const host = location.hostname;
  const supported =
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "7a7bb.com" ||
    host.endsWith(".7a7bb.com");
  if (!supported) return;

  let delayMs = 0;
  let screenId = "";
  const listenerMap = new WeakMap();
  const handlerMap = new WeakMap();

  const originalAdd = WebSocket.prototype.addEventListener;
  const originalRemove = WebSocket.prototype.removeEventListener;
  const nativeOnMessage = Object.getOwnPropertyDescriptor(
    WebSocket.prototype,
    "onmessage"
  );

  function normalizeDelay(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  function callListener(listener, socket, event) {
    if (typeof listener === "function") return listener.call(socket, event);
    if (listener && typeof listener.handleEvent === "function") {
      return listener.handleEvent.call(listener, event);
    }
  }

  function deliver(listener, socket, event) {
    const wait = delayMs;
    if (wait <= 0) return callListener(listener, socket, event);

    setTimeout(() => {
      callListener(listener, socket, event);
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
    const matches = map.filter(item => item.listener === listener);

    if (!matches.length) {
      return originalRemove.call(this, type, listener, options);
    }

    for (const item of matches) {
      originalRemove.call(this, type, item.wrapped, options);
      const index = map.indexOf(item);
      if (index >= 0) map.splice(index, 1);
    }
  };

  if (nativeOnMessage && nativeOnMessage.get && nativeOnMessage.set) {
    Object.defineProperty(WebSocket.prototype, "onmessage", {
      configurable: nativeOnMessage.configurable,
      enumerable: nativeOnMessage.enumerable,
      get() {
        const state = handlerMap.get(this);
        return state ? state.handler : nativeOnMessage.get.call(this);
      },
      set(handler) {
        const previous = handlerMap.get(this);
        if (previous) {
          originalRemove.call(this, "message", previous.wrapped);
          handlerMap.delete(this);
        }

        if (typeof handler !== "function") {
          return nativeOnMessage.set.call(this, handler);
        }

        const wrapped = event => deliver(handler, this, event);
        handlerMap.set(this, {handler, wrapped});
        nativeOnMessage.set.call(this, wrapped);
      }
    });
  }

  function broadcastConfig(data) {
    try {
      for (const frame of Array.from(window.frames)) {
        frame.postMessage(data, "*");
      }
    } catch {}
  }

  window.addEventListener("message", event => {
    const data = event.data;
    if (!data || data.type !== "THELORD_DELAY_CONFIG") return;

    /*
     * The parent app may target an iframe that itself contains the
     * actual 7a7 page. Accept the configuration from an ancestor frame
     * and propagate it to child frames.
     */
    delayMs = normalizeDelay(data.delayMs);
    screenId = String(data.screenId || "");

    const status = {
      source: "thelord-delay-network",
      version: 2,
      delayMs,
      screenId,
      host: location.hostname,
      href: location.href
    };

    window.postMessage(status, "*");
    broadcastConfig(data);
  });

  window.postMessage({
    source: "thelord-delay-network",
    version: 2,
    delayMs: 0,
    screenId: "",
    host: location.hostname,
    href: location.href
  }, "*");
})();