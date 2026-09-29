# TheLord Delay — relay temporal

Este relay é a ponte controlada para uma fonte de dados que o aplicativo possa consumir legitimamente. Ele não interpreta, altera ou fabrica dados do jogo: apenas transporta pacotes e preserva o timestamp de origem.

## Instalação

```bash
npm install
npm start
```

Por padrão fica em `ws://127.0.0.1:8787/stream`.

## Produtor

Envie ao relay:

```json
{"type":"data","channel":"aviator","receivedAt":1720000000000,"payload":{"...":"dados da fonte"}}
```

## Consumidor

O aplicativo pode conectar o adaptador temporal a `ws://127.0.0.1:8787/stream`. O adaptador entrega os pacotes ao `TheLordDelayBridge.ingest(screenId, payload, receivedAt)`, que aplica o atraso configurado e mantém a ordem temporal.

**Importante:** este componente não dá acesso a DOM, WebSocket ou dados de um iframe cross-origin. A fonte precisa fornecer os dados ao relay/adapter de forma tecnicamente permitida.
