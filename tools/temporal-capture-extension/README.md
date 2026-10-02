# TheLord Delay — Network Delay

Extensão de apoio para aplicar o atraso temporal na página externa selecionada.

## Comportamento

- A tela em tempo real continua recebendo as mensagens normalmente.
- A tela selecionada pelo TheLord Delay envia ao iframe uma configuração com o atraso.
- Na página selecionada, a extensão **não altera os bytes nem o conteúdo das mensagens**.
- O atraso é aplicado somente antes da entrega das mensagens WebSocket aos listeners da página.
- Na prática, a página selecionada se comporta como se aquela conexão tivesse latência adicional.
- O mesmo gráfico/dados continuam sendo recebidos na mesma sequência; apenas chegam aos listeners alguns segundos depois.

## Suporte atual

A extensão está habilitada para:

- `7a7bb.com` e subdomínios;
- páginas locais usadas pelos testes do projeto.

## Instalação

1. Execute `npm install`.
2. Execute `npm run start:relay` quando for testar o pipeline temporal.
3. Abra `chrome://extensions`.
4. Ative **Modo do desenvolvedor**.
5. Use **Carregar sem compactação** e selecione `tools/temporal-capture-extension`.
6. Abra o TheLord Delay.
7. No aplicativo, escolha a tela e o valor de DELAY.
8. Clique em **ATIVAR DELAY**.

## Fluxo

```text
WebSocket da página externa
        │
        ├── Tela normal → entrega imediata
        │
        └── Tela selecionada → espera N segundos
                              │
                              ▼
                         mesmo evento
                         mesmos bytes
                         mesma ordem
```

O mecanismo não recalcula, desenha, injeta ou altera o gráfico. Ele somente posterga a entrega dos eventos recebidos pela página selecionada.
