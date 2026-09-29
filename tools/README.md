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


## Teste binário ponta a ponta

Em um terminal:

```bash
npm install
npm run start:relay
```

Em outro terminal:

```bash
npm run test:temporal
```

O produtor envia JSON como **frame WebSocket binário**. O relay repassa o frame sem interpretá-lo. No navegador, abra o aplicativo local com os parâmetros `?temporalRelay=ws://127.0.0.1:8787/stream&temporalChannel=aviator-test&temporalScreen=2`. O decoder converte o frame binário JSON em payload e o `TheLordDelayBridge` aplica o atraso escolhido.

### Quando a fonte real não for JSON

O decoder não inventa o significado do frame. Ele expõe hex/base64 e candidatos IEEE-754 apenas para diagnóstico. Para uma fonte binária proprietária, deve ser registrado um decodificador autorizado em `window.TheLordTemporalDecoder.register(fn, name)`. Somente o payload retornado explicitamente pelo decodificador entra na fila temporal.

Isso separa a parte já resolvida — **frame → timestamp → fila → entrega atrasada** — da parte que depende do protocolo da fonte: **bytes → mensagem semântica**.
