# TheLord_Delay_2.0

TheLord Delay 2.0 é a nova base web do projeto. A arquitetura foi iniciada do zero para abandonar a implementação Java/APK e seguir o modelo de aplicação web responsiva usado no TheLord_Aviator.

## Base visual

A interface foi montada a partir da referência do Claude: identidade escura, contornos e brilho vermelho, dourado metálico, cartões arredondados, painel de controle, duas telas e CTA central.

### Comportamento inicial

- Seleção do alvo: Tela 1, Tela 2 ou ambas.
- Delay configurável de 0 a 30 segundos.
- Indicador do valor atualizado em tempo real.
- Botão ATIVAR DELAY / DESATIVAR DELAY.
- Seleção visual das telas atingidas pelo delay.
- Duas áreas de navegador responsivas.
- Navegação por endereço, início, voltar, avançar e recarregar.
- Persistência local das configurações do delay.
- Base PWA com manifest e service worker.

## Estrutura

`index.html`
`css/theme.css`
`css/layout.css`
`css/components.css`
`js/app.js`
`js/delay.js`
`js/browser.js`
`js/storage.js`
`manifest.json`
`sw.js`

## Limitação importante do navegador

As telas usam iframe para apresentar páginas externas. Um site pode impedir a incorporação por X-Frame-Options ou CSP. Isso é uma proteção do navegador e não pode ser removido pelo JavaScript desta aplicação.

O delay implementado nesta etapa atua sobre as navegações acionadas pelos próprios controles do TheLord Delay. Ele não intercepta tráfego, scripts ou conteúdo de terceiros.

## Próximas etapas

Esta é a base de trabalho do projeto. A partir dela podemos ajustar visual, comportamento e recursos sem voltar para Java/APK.