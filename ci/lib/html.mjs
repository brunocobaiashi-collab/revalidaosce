// ci/lib/html.mjs — utilitários de parsing compartilhados pelos portões.
// Sem dependência externa. Node >= 18.

import fs from 'node:fs';

/** Lê arquivo em UTF-8. */
export function ler(caminho) {
  return fs.readFileSync(caminho, 'utf8');
}

/** Converte índice de caractere em número de linha (1-based). */
export function linhaDe(texto, indice) {
  let n = 1;
  for (let i = 0; i < indice && i < texto.length; i++) if (texto[i] === '\n') n++;
  return n;
}

/**
 * Extrai todos os blocos <script> do HTML.
 * Retorna [{ atributos, codigo, linha, inicioCodigo }].
 * Faz varredura sequencial (não regex global) para não se confundir com
 * ocorrências de "<script" dentro de strings JS — como a mensagem de erro
 * 'station-engine.js nao carregou — confira o <script src="...">'.
 */
export function extrairScripts(html) {
  const blocos = [];
  let cursor = 0;
  while (true) {
    const abre = html.indexOf('<script', cursor);
    if (abre < 0) break;
    const fimTag = html.indexOf('>', abre);
    if (fimTag < 0) break;
    const atributos = html.slice(abre + 7, fimTag);
    const fecha = html.indexOf('</script', fimTag);
    if (fecha < 0) break;
    blocos.push({
      atributos,
      codigo: html.slice(fimTag + 1, fecha),
      inicioCodigo: fimTag + 1,
      linha: linhaDe(html, abre),
    });
    cursor = fecha + 8;
  }
  return blocos;
}

/** Blocos que devem passar por checagem de sintaxe JS: inline, sem src, sem type exótico. */
export function scriptsInline(html) {
  return extrairScripts(html).filter((b) => {
    if (/\bsrc\s*=/.test(b.atributos)) return false;
    const tipo = /\btype\s*=\s*["']([^"']+)["']/.exec(b.atributos);
    if (!tipo) return true;
    const t = tipo[1].toLowerCase();
    return t === 'text/javascript' || t === 'application/javascript' || t === 'module';
  });
}

/** Extrai os blocos <style> do HTML. */
export function extrairEstilos(html) {
  const blocos = [];
  let cursor = 0;
  while (true) {
    const abre = html.indexOf('<style', cursor);
    if (abre < 0) break;
    const fimTag = html.indexOf('>', abre);
    if (fimTag < 0) break;
    const fecha = html.indexOf('</style', fimTag);
    if (fecha < 0) break;
    blocos.push({ codigo: html.slice(fimTag + 1, fecha), linha: linhaDe(html, abre) });
    cursor = fecha + 7;
  }
  return blocos;
}

/**
 * Todos os ids declarados em qualquer lugar do arquivo — inclusive dentro de
 * template strings de JS que montam HTML por innerHTML. É de propósito:
 * um id criado dinamicamente é um id que existe em runtime.
 */
export function idsDeclarados(texto) {
  const set = new Set();
  const re = /\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|\\"([^\\"]+)\\")/g;
  let m;
  while ((m = re.exec(texto))) {
    const v = (m[1] || m[2] || m[3] || '').trim();
    if (v && !v.includes('${') && !v.includes('+')) set.add(v);
  }
  // ids montados por setAttribute('id','x') e .id = 'x'
  const re2 = /(?:setAttribute\(\s*['"]id['"]\s*,\s*|\.id\s*=\s*)['"]([\w:.-]+)['"]/g;
  while ((m = re2.exec(texto))) set.add(m[1]);
  return set;
}

/** Formatação de saída padronizada entre os portões. */
export const cor = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  erro: (s) => `\x1b[31m${s}\x1b[0m`,
  aviso: (s) => `\x1b[33m${s}\x1b[0m`,
  fraco: (s) => `\x1b[90m${s}\x1b[0m`,
};

export function relatorio(nome, erros, avisos) {
  const linhas = [];
  linhas.push(`\n── ${nome} ${'─'.repeat(Math.max(0, 56 - nome.length))}`);
  for (const a of avisos) linhas.push(`   ${cor.aviso('aviso')}  ${a}`);
  for (const e of erros) linhas.push(`   ${cor.erro('ERRO')}   ${e}`);
  if (!erros.length && !avisos.length) linhas.push(`   ${cor.ok('ok')}`);
  else if (!erros.length) linhas.push(`   ${cor.ok('ok')} (com ${avisos.length} aviso(s))`);
  console.log(linhas.join('\n'));
  return erros.length;
}
