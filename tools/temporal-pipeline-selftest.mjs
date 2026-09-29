import { spawn } from "node:child_process";
import { once } from "node:events";
import { WebSocket } from "ws";

const host="127.0.0.1";
const port=Number(process.env.TEMPORAL_SELFTEST_PORT||8877);
const relay=new URL(`ws://${host}:${port}/stream`);
const configuredDelayMs=Math.max(100,Math.floor(Number(process.env.TEMPORAL_DELAY_MS||1000)));
const realtimeMaxMs=500;
const delayToleranceMs=150;

function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function openClient(url){const ws=new WebSocket(url);await once(ws,"open");return ws;}

async function waitForSubscription(ws,screenId){
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{cleanup();reject(new Error(`timeout aguardando subscribed para ${screenId}`));},2000);
    function onMessage(raw,isBinary){
      if(isBinary) return;
      let msg;
      try{msg=JSON.parse(raw.toString());}catch(e){return;}
      if(msg.type==="subscribed"&&msg.screenId===screenId){cleanup();resolve(msg);}
    }
    function cleanup(){clearTimeout(timeout);ws.off("message",onMessage);}
    ws.on("message",onMessage);
  });
}

async function main(){
  const child=spawn(process.execPath,["tools/temporal-relay.mjs"],{
    env:{...process.env,HOST:host,PORT:String(port),TEMPORAL_DEFAULT_DELAY_MS:"0"},
    stdio:["ignore","pipe","pipe"]
  });

  let stderr="";
  child.stderr.on("data",chunk=>{stderr+=chunk.toString();});
  const clients=[];

  try{
    await wait(250);
    if(child.exitCode!==null) throw new Error(`relay encerrou antes do teste: ${stderr}`);

    const producer=await openClient(relay);
    const realtime=await openClient(relay);
    const delayed=await openClient(relay);
    clients.push(producer,realtime,delayed);

    const realtimeReceived=[];
    const delayedReceived=[];

    realtime.on("message",(raw,isBinary)=>{if(isBinary) realtimeReceived.push({data:Buffer.from(raw),receivedAt:Date.now()});});
    delayed.on("message",(raw,isBinary)=>{if(isBinary) delayedReceived.push({data:Buffer.from(raw),receivedAt:Date.now()});});

    producer.send(JSON.stringify({type:"subscribe",channel:"temporal-selftest",screenId:"producer",delayMs:0}));
    realtime.send(JSON.stringify({type:"subscribe",channel:"temporal-selftest",screenId:"screen-realtime",delayMs:0}));
    delayed.send(JSON.stringify({type:"subscribe",channel:"temporal-selftest",screenId:"screen-delayed",delayMs:configuredDelayMs}));

    const realtimeSub=await waitForSubscription(realtime,"screen-realtime");
    const delayedSub=await waitForSubscription(delayed,"screen-delayed");

    if(realtimeSub.delayMs!==0) throw new Error(`tela realtime recebeu delay inesperado: ${realtimeSub.delayMs}`);
    if(delayedSub.delayMs!==configuredDelayMs) throw new Error(`tela delayed recebeu ${delayedSub.delayMs} ms; esperado ${configuredDelayMs} ms`);

    await wait(100);

    const frames=[
      Buffer.from(JSON.stringify({source:"selftest",sequence:1,value:1.1}),"utf8"),
      Buffer.from(JSON.stringify({source:"selftest",sequence:2,value:2.2}),"utf8"),
      Buffer.from(JSON.stringify({source:"selftest",sequence:3,value:3.3}),"utf8")
    ];
    const sent=[];

    for(let i=0;i<frames.length;i++){
      const sentAt=Date.now();
      sent.push({frame:frames[i],sentAt});
      producer.send(frames[i],{binary:true});
      if(i<frames.length-1) await wait(100);
    }

    const deadline=Date.now()+configuredDelayMs+3000;
    while((realtimeReceived.length<frames.length||delayedReceived.length<frames.length)&&Date.now()<deadline) await wait(25);

    if(realtimeReceived.length!==frames.length) throw new Error(`tela realtime recebeu ${realtimeReceived.length}/${frames.length} frames`);
    if(delayedReceived.length!==frames.length) throw new Error(`tela delayed recebeu ${delayedReceived.length}/${frames.length} frames`);

    for(let i=0;i<frames.length;i++){
      if(!realtimeReceived[i].data.equals(frames[i])) throw new Error(`frame ${i+1} foi alterado na tela realtime`);
      if(!delayedReceived[i].data.equals(frames[i])) throw new Error(`frame ${i+1} foi alterado na tela delayed`);

      const realtimeElapsed=realtimeReceived[i].receivedAt-sent[i].sentAt;
      const delayedElapsed=delayedReceived[i].receivedAt-sent[i].sentAt;

      if(realtimeElapsed>realtimeMaxMs) throw new Error(`frame ${i+1} não chegou em tempo real: ${realtimeElapsed} ms`);
      if(delayedElapsed<configuredDelayMs-delayToleranceMs) throw new Error(`frame ${i+1} chegou cedo demais: ${delayedElapsed} ms; esperado >= ${configuredDelayMs-delayToleranceMs} ms`);
    }

    console.log("TEMPORAL PIPELINE SELFTEST OK");
    console.log(`Frames preservados: ${frames.length}`);
    console.log("Tela realtime: delay=0 ms");
    console.log(`Tela delayed: delay=${configuredDelayMs} ms`);

    for(let i=0;i<frames.length;i++){
      console.log(`Frame ${i+1}: realtime=${realtimeReceived[i].receivedAt-sent[i].sentAt} ms | delayed=${delayedReceived[i].receivedAt-sent[i].sentAt} ms`);
    }
    console.log("OK: cada tela recebeu o mesmo fluxo com seu próprio atraso.");
  } finally {
    for(const ws of clients){try{ws.close();}catch(e){}}
    child.kill("SIGTERM");
    await wait(100);
  }
}

main().catch(error=>{
  console.error("TEMPORAL PIPELINE SELFTEST FAILED:",error.message);
  process.exitCode=1;
});
