import { spawn } from "node:child_process";
import { once } from "node:events";
import { WebSocket } from "ws";

const host = "127.0.0.1";
const port = Number(process.env.TEMPORAL_SELFTEST_PORT || 8877);
const relay = new URL(`ws://${host}:${port}/stream`);

function wait(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }

async function openClient(url){
  const ws = new WebSocket(url);
  await once(ws,"open");
  return ws;
}

async function main(){
  const child = spawn(process.execPath, ["tools/temporal-relay.mjs"], {
    env:{...process.env,HOST:host,PORT:String(port)},
    stdio:["ignore","pipe","pipe"]
  });

  let stderr="";
  child.stderr.on("data",chunk=>{stderr+=chunk.toString();});

  try{
    await wait(250);
    if(child.exitCode!==null) throw new Error(`relay encerrou antes do teste: ${stderr}`);

    const producer = await openClient(relay);
    const consumer = await openClient(relay);

    const received = [];
    consumer.on("message",(raw,isBinary)=>{
      if(isBinary) received.push(Buffer.from(raw));
    });

    producer.send(JSON.stringify({type:"subscribe",channel:"selftest",screenId:"producer"}));
    consumer.send(JSON.stringify({type:"subscribe",channel:"selftest",screenId:"consumer"}));

    await wait(100);

    const frames = [
      Buffer.from(JSON.stringify({source:"selftest",sequence:1,value:1.1}),"utf8"),
      Buffer.from(JSON.stringify({source:"selftest",sequence:2,value:2.2}),"utf8"),
      Buffer.from(JSON.stringify({source:"selftest",sequence:3,value:3.3}),"utf8")
    ];

    for(const frame of frames) producer.send(frame);

    const deadline=Date.now()+2000;
    while(received.length<frames.length && Date.now()<deadline) await wait(25);

    if(received.length!==frames.length){
      throw new Error(`relay não entregou todos os frames: recebeu ${received.length}/${frames.length}`);
    }

    for(let i=0;i<frames.length;i++){
      if(!received[i].equals(frames[i])){
        throw new Error(`frame ${i+1} foi alterado durante o relay`);
      }
    }

    console.log("SELFTEST OK: relay preservou 3 frames binários e a ordem dos bytes.");

    producer.close();
    consumer.close();
  } finally {
    child.kill("SIGTERM");
    await wait(100);
  }
}

main().catch(error=>{
  console.error("SELFTEST FAILED:",error.message);
  process.exitCode=1;
});
