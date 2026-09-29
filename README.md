# TheLord_Delay_2.0

Aplicação web responsiva para apresentar o mesmo fluxo de dados em duas telas, permitindo aplicar um atraso temporal independente em cada tela.

## Fluxo temporal

fonte cooperativa → relay temporal → Tela 1 / Tela 2

- O relay recebe os frames sem alterar o conteúdo.
- Cada tela se conecta ao mesmo canal.
- Cada conexão possui seu próprio delayMs.
- delayMs: 0 entrega em tempo real.
- A outra tela pode receber o mesmo frame alguns segundos depois.
- A ordem dos frames é preservada.
- O atraso máximo do relay é 60 segundos.
- Trocar o delay enquanto há frames pendentes recalcula a fila para o novo valor.

Isso é um mecanismo de apresentação temporal. Ele não prevê resultados, não fabrica dados e não transforma uma fonte em outra.

## Interface

1. Escolha Tela 1, Tela 2 ou Ambas as telas.
2. Ajuste o slider de 0s a 60s.
3. Pressione ATIVAR DELAY.
4. A tela selecionada recebe o atraso escolhido; a outra permanece em 0s.
5. Em Configurações gerais, informe a URL do relay e o canal.
6. A configuração do relay fica salva no navegador e é reconectada automaticamente quando a aplicação abre.

Exemplo de relay local: ws://127.0.0.1:8787/stream

Canal padrão: aviator

## Relay

Instalação:

```bash
npm install
npm start
```

Por padrão: ws://127.0.0.1:8787/stream

Variáveis opcionais: PORT, HOST e TEMPORAL_DEFAULT_DELAY_MS.

O atraso por tela pode ser enviado no comando subscribe como delayMs.

## Testes

Teste completo do pipeline temporal:

```bash
npm run test:temporal:e2e
```

Teste com 3 segundos:

```bash
TEMPORAL_DELAY_MS=3000 npm run test:temporal:e2e
```

O teste verifica simultaneamente uma tela em tempo real e outra atrasada, confirmando que os bytes dos frames continuam idênticos.

## Fonte de dados

A fonte precisa fornecer os dados ao relay de forma tecnicamente permitida e compatível com o protocolo definido. O navegador não pode ser usado para remover proteções de iframe, CSP ou X-Frame-Options.

O adaptador temporal suporta frames WebSocket binários e JSON. Quando o frame é binário, o decoder só o transforma em payload semântico quando existe um decodificador explícito para aquele formato.

O projeto inclui uma extensão de captura para ambiente local de teste em tools/temporal-capture-extension/. Ela permanece restrita a localhost/127.0.0.1.

## Estado atual

A parte de relay → duas telas → delay independente → fila temporal → entrega está implementada.

A única integração que depende da fonte é o fornecimento legítimo dos frames e, quando necessário, o decodificador específico do protocolo da fonte.
