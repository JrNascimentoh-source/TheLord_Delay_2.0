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
    host.endsWith(".7a7bb.com") ||
    host === "7a711.com" ||
    host.endsWith(".7a711.com") ||
    host === "7a7.vip" ||
    host.endsWith(".7a7.vip") ||
    host === "game.r-o-4-m.com";
  if (!supported) return;

  let delayMs = 0;
  let screenId = "";
  let configured = false;
  const listenerMap = new WeakMap();
  const handlerMap = new WeakMap();
  const socketCaptureInstalled = new WeakSet();
  const delayedEvents = new WeakSet();
  const NativeWebSocket = window.WebSocket;
  const websocketConstructors = new WeakSet();
  let activeWebSocketConstructor = NativeWebSocket;

  function makeWebSocketProxy(Constructor) {
    if (typeof Constructor !== "function") return Constructor;
    if (websocketConstructors.has(Constructor)) return Constructor;
    websocketConstructors.add(Constructor);

    try {
      const proxy = new Proxy(Constructor, {
        construct(target, args, newTarget) {
          const socket = Reflect.construct(target, args, newTarget);
          installSocketCapture(socket);
          return socket;
        },
        apply(target, thisArg, args) {
          return Reflect.apply(target, thisArg, args);
        }
      });
      try { proxy.prototype = Constructor.prototype; } catch {}
      return proxy;
    } catch {
      return Constructor;
    }
  }

  const originalAdd = WebSocket.prototype.addEventListener;
  const originalRemove = WebSocket.prototype.removeEventListener;
  const nativeOnMessage = Object.getOwnPropertyDescriptor(
    WebSocket.prototype,
    "onmessage"
  );

  let capturedCount = 0;
  let deliveredCount = 0;

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

  function shouldDelaySocket(socket) {
    try {
      const url = new URL(socket.url);
      return url.pathname === "/parties/main/aviator";
    } catch {
      return false;
    }
  }

  function deliver(listener, target, event) {
    const wait = configured ? delayMs : 0;
    if (wait <= 0) return callListener(listener, target, event);
    setTimeout(() => callListener(listener, target, event), wait);
  }

  function cloneMessageEvent(event) {
    try {
      return new MessageEvent("message", {
        data: event.data,
        origin: event.origin || "",
        lastEventId: event.lastEventId || "",
        source: event.source || null,
        ports: event.ports || []
      });
    } catch {
      return event;
    }
  }

  function releaseSocketEvent(socket, event) {
    const copy = cloneMessageEvent(event);
    delayedEvents.add(copy);
    deliveredCount++;
    try {
      socket.dispatchEvent(copy);
    } catch {}
  }

  function installSocketCapture(socket) {
    if (!socket || socketCaptureInstalled.has(socket)) return;
    socketCaptureInstalled.add(socket);

    /*
     * Capture the native message immediately when the socket is created.
     * This is deliberately registered before the game normally installs
     * its own message handlers, including handlers installed by wrappers.
     */
    originalAdd.call(socket, "message", event => {
      if (delayedEvents.has(event)) return;

      capturedCount++;
      const wait = shouldDelaySocket(socket) && configured ? delayMs : 0;

      if (wait <= 0) {
        deliveredCount++;
        return;
      }

      try { event.stopImmediatePropagation(); } catch {}
      setTimeout(() => releaseSocketEvent(socket, event), wait);
    }, true);
  }

  NativeWebSocket.prototype.addEventListener = function(type, listener, options) {
    if (type !== "message" || !listener) {
      return originalAdd.call(this, type, listener, options);
    }

    installSocketCapture(this);
    const wrapped = event => callListener(listener, this, event);
    let map = listenerMap.get(this);
    if (!map) {
      map = [];
      listenerMap.set(this, map);
    }
    map.push({listener, wrapped, options});
    return originalAdd.call(this, type, wrapped, options);
  };

  NativeWebSocket.prototype.removeEventListener = function(type, listener, options) {
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
    Object.defineProperty(NativeWebSocket.prototype, "onmessage", {
      configurable: nativeOnMessage.configurable,
      enumerable: nativeOnMessage.enumerable,
      get() {
        const state = handlerMap.get(this);
        return state ? state.handler : nativeOnMessage.get.call(this);
      },
      set(handler) {
        installSocketCapture(this);
        const previous = handlerMap.get(this);
        if (previous) {
          originalRemove.call(this, "message", previous.wrapped);
          handlerMap.delete(this);
        }

        if (typeof handler !== "function") {
          return nativeOnMessage.set.call(this, handler);
        }

        const wrapped = event => callListener(handler, this, event);
        handlerMap.set(this, {handler, wrapped});
        nativeOnMessage.set.call(this, wrapped);
      }
    });
  }

  try {
    activeWebSocketConstructor = makeWebSocketProxy(NativeWebSocket);
    window.WebSocket = activeWebSocketConstructor;

    /*
     * The game may install unified-hook.js or another compatibility layer
     * that replaces window.WebSocket after document_start. Keep the hook
     * attached to the constructor actually exposed to the page.
     */
    const descriptor = Object.getOwnPropertyDescriptor(window, "WebSocket");
    if (descriptor && descriptor.configurable) {
      let exposed = activeWebSocketConstructor;
      Object.defineProperty(window, "WebSocket", {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get() { return exposed; },
        set(next) {
          exposed = makeWebSocketProxy(next);
          activeWebSocketConstructor = exposed;
        }
      });
    }
  } catch {}

  function watchWebSocketConstructor() {
    try {
      const current = window.WebSocket;
      if (typeof current === "function" && current !== activeWebSocketConstructor) {
        activeWebSocketConstructor = makeWebSocketProxy(current);
        if (window.WebSocket !== activeWebSocketConstructor) {
          try { window.WebSocket = activeWebSocketConstructor; } catch {}
        }
        postStatus({webSocketRehooked:true});
      }
    } catch {}
  }

  // Covers late replacements by the game's own unified-hook.js.
  try { setInterval(watchWebSocketConstructor, 100); } catch {}

  // Some games receive their realtime stream inside a Worker/SharedWorker
  // and forward frames to the page with postMessage. Delay that delivery too.
  function patchMessageTarget(proto, label) {
    if (!proto || proto.__theLordMessagePatched) return;
    const add = proto.addEventListener;
    const remove = proto.removeEventListener;
    if (typeof add !== "function" || typeof remove !== "function") return;

    const maps = new WeakMap();
    proto.addEventListener = function(type, listener, options) {
      if (type !== "message" || !listener) return add.call(this, type, listener, options);
      const wrapped = event => deliver(listener, this, event);
      let list = maps.get(this);
      if (!list) { list = []; maps.set(this, list); }
      list.push({listener, wrapped, options});
      return add.call(this, type, wrapped, options);
    };
    proto.removeEventListener = function(type, listener, options) {
      if (type !== "message" || !listener) return remove.call(this, type, listener, options);
      const list = maps.get(this) || [];
      const matches = list.filter(x => x.listener === listener);
      if (!matches.length) return remove.call(this, type, listener, options);
      for (const item of matches) {
        remove.call(this, type, item.wrapped, options);
        const i = list.indexOf(item);
        if (i >= 0) list.splice(i, 1);
      }
    };

    const desc = Object.getOwnPropertyDescriptor(proto, "onmessage");
    if (desc && desc.get && desc.set) {
      Object.defineProperty(proto, "onmessage", {
        configurable: desc.configurable,
        enumerable: desc.enumerable,
        get() {
          const state = maps.get(this)?.find(x => x.onmessage);
          return state ? state.listener : desc.get.call(this);
        },
        set(handler) {
          const list = maps.get(this) || [];
          for (const item of list.filter(x => x.onmessage)) {
            remove.call(this, "message", item.wrapped);
            const i = list.indexOf(item);
            if (i >= 0) list.splice(i, 1);
          }
          if (typeof handler !== "function") return desc.set.call(this, handler);
          const wrapped = event => deliver(handler, this, event);
          list.push({listener: handler, wrapped, onmessage: true});
          maps.set(this, list);
          return desc.set.call(this, wrapped);
        }
      });
    }
    try { Object.defineProperty(proto, "__theLordMessagePatched", {value: label}); } catch {}
  }

  try { patchMessageTarget(Worker && Worker.prototype, "Worker"); } catch {}
  try { patchMessageTarget(SharedWorker && SharedWorker.prototype.port?.constructor?.prototype, "SharedWorker"); } catch {}
  try { patchMessageTarget(MessagePort && MessagePort.prototype, "MessagePort"); } catch {}
  try { patchMessageTarget(ServiceWorkerContainer && ServiceWorkerContainer.prototype, "ServiceWorker"); } catch {}

  function postStatus(extra = {}) {
    const status = {
      source: "thelord-delay-network",
      version: 8,
      delayMs,
      screenId,
      configured,
      host: location.hostname,
      href: location.href,
      hooked: true,
      capturedCount,
      deliveredCount,
      websocketConstructor: typeof window.WebSocket === "function",
      aviatorSocketPath: "/parties/main/aviator",
      ...extra
    };
    try { window.postMessage(status, "*"); } catch {}
    try {
      if (window.top && window.top !== window) window.top.postMessage(status, "*");
    } catch {}
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
    if (!data) return;
    if (data.type === "THELORD_DELAY_CONFIG_REQUEST") {
      if (configured && event.source && event.source !== window) {
        try {
          event.source.postMessage({
            type:"THELORD_DELAY_CONFIG",
            version:1,
            screenId,
            active:delayMs>0,
            delayMs
          },"*");
        } catch {}
      }
      return;
    }
    if (data.type !== "THELORD_DELAY_CONFIG") return;

    /*
     * The parent app may target an iframe that itself contains the
     * actual 7a7 page. Accept the configuration from an ancestor frame
     * and propagate it to child frames.
     */
    delayMs = normalizeDelay(data.delayMs);
    screenId = String(data.screenId || "");
    configured = true;

    postStatus({configured: true});
    broadcastConfig(data);
  });

  postStatus({configured: false});
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({type:"THELORD_DELAY_CONFIG_REQUEST",version:1},"*");
    }
  } catch {}
})();