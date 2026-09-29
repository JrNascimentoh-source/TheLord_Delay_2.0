# Capturador temporal — ambiente local

Harness de desenvolvimento para validar o pipeline WebSocket binário do TheLord Delay.

## Escopo

- Funciona somente em localhost e 127.0.0.1.
- Só ativa quando a URL contém thelordCapture=1.
- Observa mensagens WebSocket da página local.
- Não altera mensagens, não redireciona WebSockets e não modifica o comportamento do servidor.
- Encaminha uma cópia dos frames binários para o relay temporal.
- O relay não interpreta os bytes.

Não é destinado a interceptar ou modificar WebSockets de provedores externos.

## Instalação no Chrome

1. Execute npm install.
2. Execute npm run start:relay.
3. Abra chrome://extensions.
4. Ative Modo do desenvolvedor.
5. Use Carregar sem compactação e selecione tools/temporal-capture-extension.
6. Em outro terminal, execute npm run start:capture-test.

A página de teste abrirá em http://127.0.0.1:8899/?thelordCapture=1

## Teste ponta a ponta

Com o relay em execução, abra o TheLord Delay com:
?temporalRelay=ws://127.0.0.1:8787/stream&temporalChannel=local-test&temporalScreen=2

A página local produz frames binários JSON. O capturador observa esses frames, o relay os repassa, o decoder reconhece o JSON e o Delay Bridge aplica o atraso escolhido.

## Diagnóstico

WebSocket local → cópia do frame → relay → decoder → Delay Bridge

A extensão não tenta adivinhar campos binários nem transformar candidatos IEEE-754 em dados semânticos.