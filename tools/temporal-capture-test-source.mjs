import http from "node:http";
import { WebSocketServer } from "ws";

const httpPort=Number(process.env.TEST_HTTP_PORT||8899);
const wsPort=Number(process.env.TEST_WS_PORT||8898);

const html='<!doctype html><meta charset="utf-8"><title>TheLord capture test</title>'+
'<style>body{font:16px system-ui;background:#111;color:#eee;padding:24px}</style>'+
'<h1>WebSocket capture test source</h1><p id="status">connecting...</p>'+
'<script>'+
'const status=document.querySelector("#status");'+
'const ws=new WebSocket("ws://127.0.0.1:'+wsPort+'/source");'+
'ws.binaryType="arraybuffer"; let n=0;'+
'ws.onopen=()=>status.textContent="connected";'+
'ws.onclose=()=>status.textContent="closed";'+
'setInterval(()=>{if(ws.readyState!==1)return;'+
'const payload={source:"controlled-local-test",sequence:n++,value:1+(n%40)/10};'+
'ws.send(new TextEncoder().encode(JSON.stringify(payload)));},250);'+
'<\\/script>';

const server=http.createServer((req,res)=>{
  res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
  res.end(html);
});
const wss=new WebSocketServer({port:wsPort,path:"/source"});
wss.on("connection",socket=>socket.on("message",()=>{}));
server.listen(httpPort,"127.0.0.1",()=>console.log("HTTP test source: http://127.0.0.1:"+httpPort+"/?thelordCapture=1"));
console.log("WebSocket test source: ws://127.0.0.1:"+wsPort+"/source");