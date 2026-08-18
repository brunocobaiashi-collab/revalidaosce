// Portão 5 — handler inline sem exposição global.
// O bloco principal do index é uma IIFE com 'use strict': nada vaza para window.
// Um onclick="fn()" resolve no escopo GLOBAL. Se a função só existe dentro da
// IIFE, o toque lança ReferenceError e não faz nada — em silêncio.
//
// Foi o caso do openExamsTab: o chip que o Chefe de estação entrega em toda
// solicitação de impresso ficou morto da v1.6.54 à v1.6.152 sem virar um único
// relato de bug, porque o candidato contornava abrindo a aba Exames na mão.
//
// Só aplica em arquivo cujo bloco principal seja IIFE com 'use strict';
// nos demais, vira aviso.

import { ler, scriptsInline, linhaDe, relatorio } from './lib/html.mjs';

const ALVOS = ['simulador/index.html', 'simulador/admin.html'];

// nomes que já são globais do navegador ou palavras-chave — não precisam de window.X
const GLOBAIS = new Set([
  'alert', 'confirm', 'prompt', 'console', 'setTimeout', 'setInterval', 'fetch',
  'open', 'close', 'print', 'focus', 'blur', 'scrollTo', 'Number', 'String',
  'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'if', 'for', 'while', 'return',
  'typeof', 'void', 'new', 'this', 'event', 'function', 'try', 'catch',
]);

const ATRIBUTOS = 'onclick|onchange|oninput|onsubmit|onkeydown|onkeyup|onkeypress|onfocus|onblur|onmousedown|onmouseup|ontouchstart|onerror|onload';

const erros = [];
const avisos = [];

for (const arquivo of ALVOS) {
  const texto = ler(arquivo);

  const blocos = scriptsInline(texto);
  const principal = blocos.reduce((a, b) => (b.codigo.length > (a ? a.codigo.length : 0) ? b : a), null);
  const ehIIFEStrict = !!principal && /^\s*[;(]?\s*\(\s*function\s*\(/.test(principal.codigo) && /['"]use strict['"]/.test(principal.codigo.slice(0, 400));

  const re = new RegExp(`\\b(?:${ATRIBUTOS})\\s*=\\s*(["'])([\\s\\S]{0,300}?)\\1`, 'g');
  const chamadas = new Map(); // nome -> primeira linha

  let m;
  while ((m = re.exec(texto))) {
    // Um handler montado por concatenação/template tem trechos avaliados no
    // MOMENTO DA MONTAGEM, no escopo local — não no clique. Ex.:
    //   '<button onclick="abrirTema(&quot;'+_temaEsc(id)+'&quot;)">'
    // Só `abrirTema` precisa estar em window; `_temaEsc` roda dentro da IIFE.
    const corpo = m[2]
      .replace(/\$\{[\s\S]*?\}/g, '')
      .replace(/'\s*\+[\s\S]*?\+\s*'/g, '')
      .replace(/"\s*\+[\s\S]*?\+\s*"/g, '');
    const reFn = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
    let f;
    while ((f = reFn.exec(corpo))) {
      const nome = f[2];
      if (GLOBAIS.has(nome)) continue;
      if (!chamadas.has(nome)) chamadas.set(nome, linhaDe(texto, m.index));
    }
  }

  const faltando = [];
  for (const [nome, linha] of chamadas) {
    const exposta =
      new RegExp(`window\\.${nome}\\s*=`).test(texto) ||
      new RegExp(`window\\[\\s*['"]${nome}['"]\\s*\\]\\s*=`).test(texto);
    if (!exposta) faltando.push(`${nome}() (linha ${linha})`);
  }

  if (faltando.length) {
    if (ehIIFEStrict) {
      erros.push(
        `${arquivo}: handler inline chama ${faltando.length} função(ões) sem window.X = X — ${faltando.join(', ')}` +
        ' [o bloco principal é IIFE com "use strict": o handler resolve no escopo global e lança ReferenceError]'
      );
    } else {
      const amostra = faltando.slice(0, 5).join(', ');
      avisos.push(
        `${arquivo}: ${faltando.length} função(ões) de handler inline sem window.X = X — ${amostra}${faltando.length > 5 ? ', …' : ''}` +
        ' (o bloco principal não é IIFE, então provavelmente são globais de verdade — só confira se isso mudar)'
      );
    }
  }
}

process.exit(relatorio('Portão 5 · handler inline exposto', erros, avisos) ? 1 : 0);
