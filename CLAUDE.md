# RevalidaOSCE — site e simulador (frontend)

Simulador de estações OSCE para o Revalida (INEP). SaaS em produção, com assinantes
pagantes e anúncios rodando. Dono: Bruno — decide, testa e faz o merge. Toda
comunicação, comentário de código e mensagem de commit em português do Brasil.

## Regras de ouro

1. **Nunca commit nem push direto na `main`.** A Vercel publica a `main` em cerca de
   1 minuto: push na `main` é deploy em produção. Trabalhe em branch
   `claude/<assunto>` e abra pull request. Quem faz o merge é o Bruno.
2. **Uma mudança por pull request.** O Bruno testa cada versão antes da próxima.
3. **Edite no lugar.** Nunca reescreva nem regenere um arquivo inteiro.
   `simulador/index.html` tem cerca de 11 mil linhas: localize com busca e leia só o
   trecho necessário. Diff grande para mudança pequena é sinal de erro — pare e avise.
4. **Este repositório é público.** Nunca commitar segredo, chave, código de edge
   function, SQL de produção, dado de usuário ou e-mail de cliente. O backend vive em
   outro repositório, privado (`revalidaosce-backend`).
5. **Nada em produção sem pedido explícito do Bruno na conversa:** alterar banco,
   publicar edge function, mexer em Vercel, DNS, Kiwify ou anúncios.
6. **Medir antes de teorizar.** Erro real do console, log, consulta ao banco — depois
   a correção. Hipótese sem dado já quase custou um revert errado.
7. Na dúvida sobre o que foi pedido, pergunte. Não amplie o escopo por conta própria.

## Mapa do repositório

| Caminho | O que é |
|---|---|
| `index.html`, `planos.html`, `faq.html`, `quem-somos.html`, `termos-de-uso.html`, `politica-privacidade.html`, `conta-restaurada.html` | Landing e páginas institucionais |
| `obrigado/index.html` | Pós-compra da Kiwify (auto-login) |
| `simulador/index.html` | O simulador: arquivo único, HTML + CSS + JS |
| `simulador/admin.html` | Painel administrativo |
| `simulador/station-engine.js` | Gerador e auditor de estações |
| `ci/` | Portões de validação (ver `ci/README.md`) |
| `vercel.json` | Cabeçalhos de cache — não alterar sem pedido |
| `.vercelignore` | O que a Vercel NÃO publica |

Dois projetos da Vercel leem este repositório: a landing publica a **raiz**
(`www.revalidaosce.com.br`) e o simulador publica a pasta **`simulador/`**
(`simulador.revalidaosce.com.br`).

**Tudo que está na raiz vai ao ar como arquivo público, exceto o que está no
`.vercelignore`.** Arquivo novo que não é do site entra no `.vercelignore` no mesmo
commit. Nunca remover linha do `.vercelignore`.

## Antes de abrir o pull request

1. Rodar os portões, a partir da raiz:
   ```bash
   cd ci && npm install && cd ..   # só na primeira vez
   node ci/run-all.mjs
   ```
   Saída 1 = reprovou. Corrigir a causa; nunca afrouxar o portão para passar.
2. Subir a versão de todo arquivo alterado em `simulador/`: `APP_VERSION.version`,
   `APP_VERSION.date`, `APP_VERSION.notes` e a `<meta name="app-version">`, todos
   iguais.
3. `APP_VERSION.notes` é uma string JS entre aspas simples. **Proibido aspas simples
   ou apóstrofo dentro dela** — já quebrou o arquivo várias vezes. A nota nova entra
   no início, separada das anteriores por ` | `.
4. Na descrição do pull request: o que mudou e por quê; quais invariantes abaixo a
   mudança toca e como foram preservados; a ordem de deploy, se depender de SQL ou de
   versão nova da edge function; e o roteiro de teste pós-deploy para o Bruno.

O que os portões provam: cada `<script>` compila (1), versão coerente e incrementada
(2), o arquivo executa num DOM montado e as funções críticas existem no fim —
`loginWithGoogle`, `loginWithEmail`, `checkSubscription`, `loadStation`,
`fetchStations`, `onLoginSuccess` (3), nenhum listener em id inexistente (4), toda
função de `onclick` inline está em `window` (5).

## Armadilhas do código — cada uma já derrubou produção

- O bloco principal do `index.html` é uma **IIFE com `'use strict'`**: nada vaza para
  `window`. Função chamada de `onclick` inline precisa de `window.X = X` explícito.
- **Listener órfão aborta o script inteiro** e derruba o login. Sempre
  `var el = $('id'); if (el) el.addEventListener(...)`. Removeu o elemento do HTML,
  remova o listener no mesmo commit.
- Os prompts do corretor, do comentador e do ator estão no `index.html`. **Mudar
  prompt é mudar o produto:** só com pedido explícito, e nunca junto com outra mudança.
- Não trocar modelo de IA, não acrescentar `temperature` às chamadas.
- Microfone, transcrição e voz funcionam. Não mexer sem necessidade.
- Estilo inline vence media query: quando for preciso sobrepor, `!important`.
- Texto em português com acento pode estar em NFC ou NFD: busca que "não acha" um
  trecho visível pode ser isso.

## Invariantes do produto — não regredir

Acesso e assinatura
- Login nunca é bloqueado por falta de assinatura. Bloqueia-se o acesso às estações,
  com a tela de paywall, sem deslogar.
- O caminho do assinante e do admin fica idêntico quando se mexe em trial ou grátis.
- Trial só abre as 3 estações demo — no acervo, na Maratona, na Estação do dia e no
  resumo. Nenhum caminho pode chamar `loadStation` com estação que o servidor vai
  negar: filtrar ou travar antes do clique.
- A trava de sessão única vale só para pagante e cortesia. Trial e admin são isentos.
- O servidor é a autoridade sobre acesso; o cliente é só experiência.

Atendimento e avaliação
- Resposta vazia do ator vira silêncio, nunca fala fixa.
- Volume e velocidade do áudio funcionam no iOS (Web Audio, `GainNode`).
- A transcrição salva inclui médico, paciente e Chefe de estação, cada um com seu rótulo.
- O corretor aplica o critério do item ao pé da letra; não arredonda para cima.
- O comentador não inventa fato nem valor.
- O card do resumo falha em silêncio: nunca quebra a tela que o hospeda.

Estações
- Estação gerada por IA nasce `pending`. Ativar é decisão humana.
- PEP soma exatamente 10,0; todo item tem `id` e `crit_adeq`; o máximo do item é
  `scores[último]` — não existe chave `max`.

Mudou autenticação, acesso ou paywall? O pull request tem de trazer o teste dos
quatro perfis: pagante, admin, trial e trial esgotado.

A lista completa é o contrato `instrucoes/FUNCIONALIDADES.md`, que fica no
repositório privado `revalidaosce-backend`. Se a mudança tocar pagamento, pós-compra,
avaliação ou resumo e o contrato não estiver disponível na sessão, peça ao Bruno
antes de continuar.

## Deploy

- Merge na `main` publica os dois projetos da Vercel. Antes do merge, o Bruno confere
  no painel admin o aviso "N em estação agora".
- Depois do deploy, o teste é do Bruno, em aba anônima: login por Google e por
  e-mail, os quatro perfis quando couber, console sem erro vermelho.
- Reverter é reverter o commit na `main`. Não "consertar por cima" em produção.
