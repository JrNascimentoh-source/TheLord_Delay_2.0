(function(){
  "use strict";
  const TYPE_CONFIG="THELORD_DELAY_CONFIG";
  const TYPE_DATA="THELORD_DELAY_DATA";
  const TYPE_DELIVERED="THELORD_DELAYED_DATA";
  const queues=new Map();

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
  function postConfig(id){
    const screen=getScreen(id);
    if(!screen || !screen.frame || !screen.frame.contentWindow) return false;
    const origin=getOrigin(screen);
    if(!origin || origin==="null") return false;
    screen.frame.contentWindow.postMessage({
      type:TYPE_CONFIG,version:1,screenId:String(id),
      active:!!screen.active,
      delayMs:Math.max(0,Number(screen.delay)||0)*1000
    },origin);
    return true;
  }
  function deliver(id,item){
    const screen=getScreen(id);
    if(!screen || !screen.frame || !screen.frame.contentWindow) return;
    const origin=getOrigin(screen);
    if(!origin || origin==="null") return;
    const deliveredAt=Date.now();
    screen.frame.contentWindow.postMessage({
      type:TYPE_DELIVERED,version:1,screenId:String(id),
      receivedAt:item.receivedAt,deliveredAt,payload:item.payload
    },origin);
    window.dispatchEvent(new CustomEvent("thelord:delayed-data",{
      detail:{screenId:String(id),payload:item.payload,
        receivedAt:item.receivedAt,deliveredAt}
    }));
  }
  function enqueue(id,payload){
    const screen=getScreen(id);
    if(!screen) return false;
    const delayMs=screen.active ? Math.max(0,Number(screen.delay)||0)*1000 : 0;
    const item={payload,receivedAt:Date.now()};
    if(!delayMs){ deliver(id,item); return true; }
    let timer=setTimeout(function(){
      const list=queues.get(String(id))||[];
      const index=list.indexOf(timer);
      if(index>=0) list.splice(index,1);
      deliver(id,item);
    },delayMs);
    const list=queues.get(String(id))||[];
    list.push(timer);
    queues.set(String(id),list);
    return true;
  }
  function clear(id){
    const key=String(id);
    (queues.get(key)||[]).forEach(clearTimeout);
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
      enqueue(id,data.payload);
      return;
    }
  });

  window.TheLordDelayBridge={version:1,sync,syncAll,enqueue,clear,
    types:{config:TYPE_CONFIG,data:TYPE_DATA,delivered:TYPE_DELIVERED}};
  window.dispatchEvent(new Event("thelord:delay-bridge-ready"));
  syncAll();
})();