// Portão 2 — versão.
// (a) <meta name="app-version"> e APP_VERSION.version têm de ser iguais;
// (b) se o arquivo mudou em relação ao commit anterior, a versão tem de ter subido.
//
// O (b) impede o pior caso do deploy por upload: dois arquivos diferentes no ar
// com o mesmo número, e ninguém consegue dizer qual está no navegador do médico.
// O cabeçalho da nota (`notes` começando por outra versão) sai só como aviso —
// é desalinho editorial, não risco.

import { execSync } from 'node:child_process';
import { ler, relatorio } from './lib/html.mjs';

const ALVOS = ['simulador/index.html', 'simulador/admin.html'];

const erros = [];
const avisos = [];

function semver(v) {
  return v.split('.').map((n) => parseInt(n, 10) || 0);
}
function maiorQue(a, b) {
  const x = semver(a);
  const y = semver(b);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) > (y[i] || 0)) return true;
    if ((x[i] || 0) < (y[i] || 0)) return false;
  }
  return false;
}
function extrairVersoes(texto) {
  const meta = /<meta\s+name=["']app-version["']\s+content=["']([^"']+)["']/.exec(texto);
  const obj = /APP_VERSION\s*=\s*\{[\s\S]{0,200}?version\s*:\s*['"]([^'"]+)['"]/.exec(texto);
  const notas = /APP_VERSION\s*=\s*\{[\s\S]*?notes\s*:\s*['"]\s*(\d+\.\d+\.\d+)/.exec(texto);
  return { meta: meta && meta[1], obj: obj && obj[1], notas: notas && notas[1] };
}
function versaoAnterior(caminho) {
  try {
    return execSync(`git show HEAD~1:${caminho}`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null; // primeiro commit, ou histórico raso — não dá para comparar
  }
}

for (const arquivo of ALVOS) {
  const atual = ler(arquivo);
  const v = extrairVersoes(atual);

  if (!v.meta) { erros.push(`${arquivo}: <meta name="app-version"> não encontrada`); continue; }
  if (!v.obj) { erros.push(`${arquivo}: APP_VERSION.version não encontrada`); continue; }

  if (v.meta !== v.obj) {
    erros.push(`${arquivo}: meta app-version = ${v.meta} mas APP_VERSION.version = ${v.obj} — os dois têm de bater`);
  }
  if (v.notas && v.notas !== v.obj) {
    avisos.push(`${arquivo}: a nota de versão começa em ${v.notas}, mas a versão é ${v.obj}`);
  }

  const anterior = versaoAnterior(arquivo);
  if (anterior === null) {
    avisos.push(`${arquivo}: sem commit anterior para comparar (histórico raso) — incremento não verificado`);
  } else if (anterior !== atual) {
    const va = extrairVersoes(anterior);
    if (va.obj && !maiorQue(v.obj, va.obj)) {
      erros.push(`${arquivo}: conteúdo mudou mas a versão não subiu (${va.obj} → ${v.obj})`);
    }
  }
}

process.exit(relatorio('Portão 2 · versão', erros, avisos) ? 1 : 0);
