(function(){
  "use strict";

  const TYPE_CONFIG="THELORD_DELAY_CONFIG";
  const TYPE_DATA="THELORD_DELAY_DATA";
  const TYPE_DELIVERED="THELORD_DELAYED_DATA";
  const queues=new Map();
  const timers=new Map();

  function getScreen(id){
    return window.TheLord && window.TheLord.screens && window.TheLord.screens[id];
  }

  function getOrigin(screen){
    try{
      const url=screen && screen.frame && screen.frame.src;
      if(!url) return "";
      return new URL(url,location.href).origin;
    }catch(e){ return ""; }
  }

  function now(){
    return Date.now();
  }

  function getDelayMs(screen){
    return screen && screen.active
      ? Math.max(0,Number(screen.delay)||0)*1000
      : 0;
  }

  function postConfig(id){
    const screen=getScreen(id);
    if(!screen || !screen.frame || !screen.frame.contentWindow) return false;

    const origin=getOrigin(screen);
    if(!origin || origin==="null") return false;

    screen.frame.contentWindow.postMessage({
      type:TYPE_CONFIG,
      version:1,
      screenId:String(id),
      active:!!screen.active,
      delayMs:getDelayMs(screen)
    },origin);

    return true;
  }

  function deliver(id,item){
    const screen=getScreen(id);
    if(!screen || !screen.frame || !screen.frame.contentWindow) return;

    const origin=getOrigin(screen);
    if(!origin || origin==="null") return;

    const deliveredAt=now();
    screen.frame.contentWindow.postMessage({
      type:TYPE_DELIVERED,
      version:1,
      screenId:String(id),
      receivedAt:item.receivedAt,
      deliveredAt,
      payload:item.payload
    },origin);

    window.dispatchEvent(new CustomEvent("thelord:delayed-data",{
      detail:{
        screenId:String(id),
        payload:item.payload,
        receivedAt:item.receivedAt,
        deliveredAt,
        delayMs:Math.max(0,deliveredAt-item.receivedAt)
      }
    }));
  }

  function schedule(id){
    const key=String(id);
    const list=queues.get(key)||[];
    const oldTimer=timers.get(key);

    if(oldTimer){
      clearTimeout(oldTimer);
      timers.delete(key);
    }

    if(!list.length) return;

    const item=list[0];
    const wait=Math.max(0,item.dueAt-now());

    const timer=setTimeout(function(){
      timers.delete(key);

      const current=queues.get(key)||[];
      if(current.length && current[0]===item){
        current.shift();

        if(current.length) queues.set(key,current);
        else queues.delete(key);

        deliver(key,item);
      }

      schedule(key);
    },wait);

    timers.set(key,timer);
  }

  function enqueue(id,payload,receivedAt){
    const screen=getScreen(id);
    if(!screen) return false;

    const key=String(id);
    const received=Number(receivedAt)||now();
    const delayMs=getDelayMs(screen);

    const item={
      payload,
      receivedAt:received,
      sequence:now(),
      dueAt:received+delayMs
    };

    const list=queues.get(key)||[];
    list.push(item);

    /*
     * Preserve chronological order of the source stream.
     * When several packets share the same timestamp, sequence keeps
     * their arrival order deterministic.
     */
    list.sort(function(a,b){
      return a.dueAt-b.dueAt || a.receivedAt-b.receivedAt || a.sequence-b.sequence;
    });

    queues.set(key,list);
    schedule(key);
    return true;
  }

  /*
   * Public ingestion point for a cooperative data adapter.
   * A same-origin page, an authorized relay, or a cooperative iframe
   * can call:
   *   window.TheLordDelayBridge.ingest(2, payload, receivedAt)
   *
   * This function does not inspect or alter the source data. It only
   * timestamps, queues and releases it according to the selected delay.
   */
  function ingest(id,payload,receivedAt){
    return enqueue(String(id),payload,receivedAt);
  }

  function deliverNow(id,payload,receivedAt){
    const key=String(id);
    if(!getScreen(key)) return false;
    deliver(key,{payload,receivedAt:Number(receivedAt)||now()});
    return true;
  }

  /*
   * If the user changes the delay while packets are already buffered,
   * rebase only the still-pending packets. This keeps the selected
   * delay deterministic instead of leaving a mixture of old/new offsets.
   */
  function rebase(id){
    const key=String(id);
    const screen=getScreen(key);
    const list=queues.get(key)||[];
    if(!screen || !list.length) return;

    const delayMs=getDelayMs(screen);

    list.forEach(function(item){
      item.dueAt=item.receivedAt+delayMs;
    });

    list.sort(function(a,b){
      return a.dueAt-b.dueAt || a.receivedAt-b.receivedAt || a.sequence-b.sequence;
    });

    queues.set(key,list);
    schedule(key);
  }

  function clear(id){
    const key=String(id);
    const timer=timers.get(key);

    if(timer) clearTimeout(timer);

    timers.delete(key);
    queues.delete(key);
  }

  function sync(id){
    return postConfig(String(id));
  }

  function syncAll(){
    [1,2].forEach(sync);
  }

  window.addEventListener("message",function(event){
    const screens=(window.TheLord&&window.TheLord.screens)||{};

    for(const id of [1,2]){
      const screen=screens[id];
      if(!screen || !screen.frame) continue;
      if(event.source!==screen.frame.contentWindow) continue;

      const origin=getOrigin(screen);
      if(!origin || event.origin!==origin) return;

      const data=event.data;
      if(!data || typeof data!=="object" || data.type!==TYPE_DATA) return;

      enqueue(id,data.payload,data.receivedAt);
      return;
    }
  });

  window.TheLordDelayBridge={
    version:1,
    sync,
    syncAll,
    enqueue,
    ingest,
    deliverNow,
    rebase,
    clear,
    pending:function(id){
      return (queues.get(String(id))||[]).length;
    },
    types:{
      config:TYPE_CONFIG,
      data:TYPE_DATA,
      delivered:TYPE_DELIVERED
    }
  };

  window.dispatchEvent(new Event("thelord:delay-bridge-ready"));
  syncAll();
})();