# Portões de validação — Fase 1

Verificações automáticas do frontend do simulador, rodando a cada push no
GitHub Actions (`.github/workflows/validacao.yml`).

**Fase 1 é alarme, não trava.** O Vercel publica assim que o arquivo entra no
repositório; os portões rodam em paralelo e mandam e-mail em ~1 minuto se algo
reprovar. Para virar gate de verdade, o fluxo precisa passar por pull request
com o check marcado como obrigatório em *Settings → Branches*.

## Rodar na mão

Sempre a partir da **raiz do repositório**:

```bash
cd ci && npm install && cd ..
node ci/run-all.mjs
```

Código de saída 1 = algum portão reprovou. Cada portão roda em processo próprio,
então uma rodada mostra todos os problemas de uma vez.

## Os portões

| # | Arquivo | O que prova | Incidente que motivou |
|---|---|---|---|
| 1 | `check-sintaxe.mjs` | Cada `<script>` inline compila; `<style>` com chaves balanceadas; nenhum fragmento proibido | Aspas simples na nota de versão quebrando a string (recorrente); `PLACEHOLDER` publicado em 16/08 |
| 2 | `check-versao.mjs` | `<meta app-version>` = `APP_VERSION.version`; versão sobe quando o arquivo muda | Dois arquivos diferentes no ar com o mesmo número |
| 3 | `check-runtime.mjs` | O arquivo **executa** num DOM montado (jsdom) e as funções críticas existem no fim | P0 21/07 — `$()` nulo abortou o script e derrubou o login |
| 4 | `check-listeners.mjs` | Nenhum `addEventListener` em id inexistente | P0 21/07 — `btn-hd-back` órfão |
| 5 | `check-onclick.mjs` | Toda função chamada de handler inline está em `window` | `openExamsTab` morto da v1.6.54 à v1.6.152, em silêncio |
| 6 | `check-engine.mjs` | `station-engine.js`: `ENGINE_VERSION` registrada no cabeçalho e maior que a da `main` quando o arquivo difere do da `main` (na própria `main`, compara com o commit anterior); baselines intactas (sha256); as suítes de `ci/engine/` passam | Só o portão 1 olhava o gerador; a 1.4.1 (19/08) nunca foi publicada e nada avisou |

### Por que o portão 3 usa sonda em vez de olhar `window`

O bloco principal do `index.html` é uma IIFE com `'use strict'`: por invariante
do §8, nada vaza para `window`. Checar `window.loginWithEmail` daria falso
negativo sempre. A sonda é injetada **dentro** da IIFE, na última linha — e se o
script abortar antes de chegar lá, ela simplesmente não roda. A ausência da
sonda *é* o sinal.

### O que a Fase 1 não cobre

A matriz de acesso dos 3 perfis (regra 6 do FUNCIONALIDADES) precisa de conta
real, rede e credenciais — é teste ponta a ponta contra produção, não análise
estática. Fica para a Fase 2. Até lá, o teste em aba anônima continua sendo do
Bruno.

### Portão 6 — as suítes do gerador

Ficam em `ci/engine/` (CommonJS; o `package.json` local diz isso). Cada uma roda
também na mão, a partir da raiz: `node ci/engine/test-ancora.js`.

| Suíte | Cobre |
|---|---|
| `test-regressao.js` | Prompts sem âncora e ancorados (`buildSys1`, `buildSys2`, `buildSysAudit`) e `preValidate` idênticos, byte a byte, à última versão publicada (`baselines/station-engine.1.4.3.js`); `buildSys1` e `buildSysAudit` de Intermediário e Avançado idênticos também ao arquivo anterior à 1.1.0 |
| `test-ancora.js` | Modo ancorado em imagem |
| `test-audit-budget.js` | `maxTokensAudit` e auditoria truncada |
| `test-area-canonica.js` | Áreas canônicas, `eixosDaArea`, `canonArea` |
| `test-binario-conjuntivo.js` | 1.4.1: `buildSys2` = 1.4.0 + o bloco do binário conjuntivo, e nada além; aviso `binario_conjuntivo` |
| `test-parcial-exata.js` | 1.4.3: parcial = metade exata do máximo (colapso, expansão, reescala, piso, ajuste da soma); rede que crava `max/2` em parcial arredondada; parcial escolhida diferente da metade intacta; soma 10,0 |
| `test-diagnostico-gabarito.js` | 1.4.3: `buildSys2` ancorado = 1.4.2 + o trecho do diagnóstico do gabarito (crit_adeq com o mesmo nome do `diagnosis_truth`, proibição de juntar diagnósticos com "/" ou "ou"), e nada além; sem âncora idêntico |

**Mudança intencional de prompt** (só com pedido explícito do Bruno): a função entra
em `PERMITIDAS`, no topo do `test-regressao.js`, com a versão e o motivo. Depois que a
versão nova for publicada, a cópia dela entra em `baselines/` (com o sha256 em
`check-engine.mjs`) e `PERMITIDAS` volta a ficar vazia. Baseline nunca se edita.

## Manutenção

- Portão 1: cada fragmento em `PROIBIDOS` deve corresponder a um incidente real.
  Lista que cresce por precaução vira ruído.
- Portão 3: se um serviço externo novo entrar no `index.html`, o dublê
  correspondente precisa ser adicionado em `dublar()`, senão o portão reprova
  por falta de dublê e não por defeito de verdade.
- Portões 4 e 5: erro é reprovação, aviso é observação. Não transformar aviso em
  erro sem antes zerar a contagem, senão o CI nasce vermelho e perde a função.
