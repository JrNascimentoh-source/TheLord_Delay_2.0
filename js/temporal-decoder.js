(function(){
  "use strict";

  function bytesOf(value){
    if(value instanceof ArrayBuffer) return new Uint8Array(value);
    if(ArrayBuffer.isView(value)) return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
    return null;
  }

  function hex(bytes,limit){
    const n=Math.min(bytes.length,limit||64);let out=[];
    for(let i=0;i<n;i++) out.push(bytes[i].toString(16).padStart(2,"0"));
    return out.join(" ");
  }

  function base64(bytes){
    let s="";const chunk=0x8000;
    for(let i=0;i<bytes.length;i+=chunk) s+=String.fromCharCode(...bytes.subarray(i,i+chunk));
    return btoa(s);
  }

  function utf8(bytes){
    try{return new TextDecoder().decode(bytes);}catch(e){return "";}
  }

  function jsonFromText(text){
    const trimmed=String(text||"").trim();
    if(!trimmed || (trimmed[0]!=="{" && trimmed[0]!=="[")) return null;
    try{return JSON.parse(trimmed);}catch(e){return null;}
  }

  /* Diagnostic only: finds plausible IEEE-754 values in a binary frame.
   * It never promotes a candidate to game data. An explicit decoder must
   * return a payload before the adapter will enqueue anything.
   */
  function candidates(bytes){
    const out=[];
    const seen=new Set();
    const push=(value,offset,width,kind)=>{
      if(!Number.isFinite(value) || value<0 || value>1000000) return;
      const rounded=Math.round(value*10000)/10000;
      const key=width+":"+offset+":"+rounded;
      if(seen.has(key)) return;seen.add(key);
      out.push({offset,width,kind,value:rounded});
    };
    for(let i=0;i+4<=bytes.length;i++){
      const b=bytes.buffer.slice(bytes.byteOffset+i,bytes.byteOffset+i+4);
      const dv=new DataView(b);
      push(dv.getFloat32(0,false),i,4,"float32-be");
      push(dv.getFloat32(0,true),i,4,"float32-le");
    }
    for(let i=0;i+8<=bytes.length;i++){
      const b=bytes.buffer.slice(bytes.byteOffset+i,bytes.byteOffset+i+8);
      const dv=new DataView(b);
      push(dv.getFloat64(0,false),i,8,"float64-be");
      push(dv.getFloat64(0,true),i,8,"float64-le");
    }
    return out.slice(0,80);
  }

  const state={decoder:null,name:"none"};

  async function decode(data,context){
    context=context||{};
    if(typeof data==="string"){
      const parsed=jsonFromText(data);
      return parsed===null?{kind:"text",text:data}: {kind:"json",payload:parsed};
    }

    if(data instanceof Blob){
      data=await data.arrayBuffer();
    }

    const bytes=bytesOf(data);
    if(!bytes) return {kind:"unknown"};

    if(state.decoder){
      try{
        const payload=await state.decoder(bytes,context);
        if(payload!==undefined && payload!==null) return {kind:"decoded",payload};
      }catch(error){
        return {kind:"decoder-error",error:String(error&&error.message||error)};
      }
    }

    const text=utf8(bytes);
    const parsed=jsonFromText(text);
    if(parsed!==null) return {kind:"json",payload:parsed};

    return {kind:"binary",byteLength:bytes.byteLength,hex:hex(bytes),base64:base64(bytes),candidates:candidates(bytes)};
  }

  function register(decoder,name){
    if(typeof decoder!=="function") throw new TypeError("Temporal decoder precisa ser uma função.");
    state.decoder=decoder;state.name=String(name||"custom");
  }

  function clear(){state.decoder=null;state.name="none";}

  window.TheLordTemporalDecoder={version:1,decode,register,clear,status:()=>({name:state.name,custom:!!state.decoder})};
})();
