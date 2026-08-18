// Portão 4 — listener órfão (§8).
// Procura `$('id').addEventListener(...)` e `getElementById('id').addEventListener(...)`
// sem guarda, e cruza o id com os ids que existem no arquivo (inclusive os
// montados por innerHTML dentro do JS — id que nasce em runtime é id que existe).
//
// Um `$()` nulo lança TypeError e ABORTA o script inteiro dali para baixo.
// Foi assim que o `btn-hd-back` órfão derrubou o login por Google e por e-mail
// em 21/07. É o portão de maior valor histórico do conjunto.
//
// ERRO  = listener direto num id que não existe em lugar nenhum do arquivo.
// aviso = listener direto sem guarda `if(el)` (o id existe, mas o padrão é frágil).

import { ler, idsDeclarados, linhaDe, relatorio } from './lib/html.mjs';

const ALVOS = ['simulador/index.html', 'simulador/admin.html'];

const erros = [];
const avisos = [];

// $('x').addEventListener  |  document.getElementById('x').addEventListener
const RE_DIRETO = /(?:\$\(\s*['"]([\w:.-]+)['"]\s*\)|getElementById\(\s*['"]([\w:.-]+)['"]\s*\))\s*\.\s*addEventListener/g;

for (const arquivo of ALVOS) {
  const texto = ler(arquivo);
  const ids = idsDeclarados(texto);
  const semGuarda = [];

  let m;
  RE_DIRETO.lastIndex = 0;
  while ((m = RE_DIRETO.exec(texto))) {
    const id = m[1] || m[2];
    const linha = linhaDe(texto, m.index);
    if (!ids.has(id)) {
      erros.push(`${arquivo}:${linha} — addEventListener em #${id}, que não existe no arquivo (listener órfão: derruba o script inteiro dali para baixo)`);
    } else {
      semGuarda.push(`#${id} (linha ${linha})`);
    }
  }

  if (semGuarda.length) {
    const amostra = semGuarda.slice(0, 6).join(', ');
    avisos.push(`${arquivo}: ${semGuarda.length} listener(s) sem guarda if(el) — ${amostra}${semGuarda.length > 6 ? ', …' : ''}`);
  }
}

process.exit(relatorio('Portão 4 · listener órfão', erros, avisos) ? 1 : 0);
