import WebSocket from "ws";

const url=process.env.RELAY_URL||"ws://127.0.0.1:8787/stream";
const channel=process.env.CHANNEL||"aviator-test";
const interval=Number(process.env.INTERVAL_MS||250);
const ws=new WebSocket(url);
let n=0;
ws.on("open",()=>{
  ws.send(JSON.stringify({type:"subscribe",channel,screenId:"producer"}));
  console.log("producer conectado",url,channel);
  setInterval(()=>{
    const receivedAt=Date.now();
    const payload={source:"local-test",sequence:n++,value:1+(n%40)/10};
    ws.send(JSON.stringify({type:"data",channel,receivedAt,payload}));
  },interval);
});
ws.on("message",raw=>console.log("relay:",raw.toString()));
ws.on("error",err=>{console.error(err.message);process.exitCode=1;});
