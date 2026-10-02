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

  function now(){ return Date.now(); }

  function isSelected(id){
    const target=document.getElementById("target");
    if(!target) return true;
    return target.value==="all" || String(target.value)===String(id);
  }

  function getDelayMs(screen){
    return screen && screen.active && isSelected(screen.id)
      ? Math.max(0,Number(screen.delay)||0)*1000
      : 0;
  }

  function postConfig(id){
    const screen=getScreen(id);
    if(!screen || !screen.frame || !screen.frame.contentWindow) return false;
    if(!screen.frame.contentWindow) return false;

    /*
     * The iframe may redirect after navigation. Using its initial src origin
     * here can silently discard the configuration when the final document
     * lives on another allowed 7a7 subdomain. The page-hook validates the
     * message shape and propagates it to nested matching frames.
     */
    screen.frame.contentWindow.postMessage({
      type:TYPE_CONFIG,
      version:1,
      screenId:String(id),
      active:!!screen.active,
      delayMs:getDelayMs(screen)
    },"*");
    return true;
  }

  function deliver(id,item){
    const screen=getScreen(id);
    if(!screen || !screen.frame || !screen.frame.contentWindow) return false;
    const origin=getOrigin(screen);
    if(!origin || origin==="null") return false;

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
    return true;
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
    const key=String(id);
    const screen=getScreen(key);
    if(!screen) return false;

    const received=Number(receivedAt)||now();
    const delayMs=getDelayMs(screen);

    /*
     * Critical performance path:
     * realtime screens never enter the temporal queue. This keeps the
     * normal stream at realtime speed and reserves queue/timer work for
     * screens that actually have an active delay.
     */
    if(delayMs<=0){
      return deliver(key,{payload,receivedAt:received});
    }

    const item={
      payload,
      receivedAt:received,
      sequence:now(),
      dueAt:received+delayMs
    };

    const list=queues.get(key)||[];
    list.push(item);
    list.sort(function(a,b){
      return a.dueAt-b.dueAt || a.receivedAt-b.receivedAt || a.sequence-b.sequence;
    });

    queues.set(key,list);
    schedule(key);
    return true;
  }

  function ingest(id,payload,receivedAt){
    return enqueue(String(id),payload,receivedAt);
  }

  function deliverNow(id,payload,receivedAt){
    const key=String(id);
    if(!getScreen(key)) return false;
    return deliver(key,{payload,receivedAt:Number(receivedAt)||now()});
  }

  function rebase(id){
    const key=String(id);
    const screen=getScreen(key);
    const list=queues.get(key)||[];
    if(!screen) return;

    const delayMs=getDelayMs(screen);

    if(delayMs<=0){
      clear(key);
      return;
    }

    if(!list.length) return;

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

  function sync(id){ return postConfig(String(id)); }
  function syncAll(){ [1,2].forEach(sync); }

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
    version:2,
    sync,
    syncAll,
    enqueue,
    ingest,
    deliverNow,
    rebase,
    clear,
    pending:function(id){ return (queues.get(String(id))||[]).length; },
    types:{config:TYPE_CONFIG,data:TYPE_DATA,delivered:TYPE_DELIVERED}
  };

  window.dispatchEvent(new Event("thelord:delay-bridge-ready"));
  syncAll();
})();