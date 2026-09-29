import { WebSocketServer } from "ws";

const port=Number(process.env.PORT||8787);
const host=process.env.HOST||"127.0.0.1";
const wss=new WebSocketServer({host,port,path:"/stream"});
const channels=new Map();

function send(socket,message){
  if(socket.readyState===1) socket.send(JSON.stringify(message));
}
function members(channel){return channels.get(channel)||new Set();}
function join(socket,channel){
  if(!channels.has(channel)) channels.set(channel,new Set());
  channels.get(channel).add(socket);
  socket.channel=channel;
}
function leave(socket){
  if(!socket.channel) return;
  const set=channels.get(socket.channel);
  if(set){set.delete(socket);if(!set.size) channels.delete(socket.channel);}
  socket.channel="";
}

wss.on("connection",socket=>{
  send(socket,{type:"ready",version:1});
  socket.on("message",raw=>{
    let msg;
    try{msg=JSON.parse(raw.toString());}catch(e){return send(socket,{type:"error",code:"INVALID_JSON"});}
    if(!msg||typeof msg!=="object") return;

    if(msg.type==="subscribe"){
      leave(socket);
      join(socket,String(msg.channel||"default"));
      send(socket,{type:"subscribed",channel:socket.channel,screenId:String(msg.screenId||"")});
      return;
    }

    if(msg.type==="data"){
      const channel=String(msg.channel||socket.channel||"default");
      const receivedAt=Number(msg.receivedAt)||Date.now();
      const packet={type:"data",channel,receivedAt,payload:msg.payload};
      for(const peer of members(channel)) send(peer,packet);
    }
  });
  socket.on("close",()=>leave(socket));
  socket.on("error",()=>leave(socket));
});

console.log(`TheLord temporal relay listening on ws://${host}:${port}/stream`);
console.log("Protocol: producer sends {type:data,channel,receivedAt,payload}; consumers send {type:subscribe,channel,screenId}.");
