// Portão 8 — consentimento de cookies (decisão do Bruno, 16/11/2026).
// Uso, a partir da raiz: node ci/check-consentimento.mjs   (saída 1 = reprovou)
//
// Roda primeiro o autoteste (test-consentimento.mjs): se o portão deixou de reprovar
// o que deve reprovar, ele mesmo reprova. Depois confere:
//  - todo .html da raiz e obrigado/index.html: sem tag do Google fixa, com consent.js,
//    sem rosce_attr, conversão só com consentimento;
//  - consent.js: rosce_attr e a tag só no ramo "aceito" (estático) e o comportamento
//    num DOM montado (primeira visita, Aceitar, Recusar, revogar, telas do simulador);
//  - simulador/index.html e simulador/consent.js (idêntico ao da raiz) quando
//    simulador/consent.js existe. Antes disso o simulador é pulado, com aviso.

import fs from 'node:fs';
import * as jsdom from 'jsdom';
import { cor } from './lib/html.mjs';
import { verificarPaginas, verificarConsentJs, verificarComportamento } from './lib/consentimento.mjs';
import { autoteste } from './test-consentimento.mjs';

console.log('\n' + ('── Portão 8 · consentimento de cookies ').padEnd(60, '─'));
const falhasAuto = await autoteste({ silencioso: true });
if (falhasAuto.length) {
  console.log(cor.erro('  ✗ autoteste: o portão deixou de reprovar o que deve'));
  falhasAuto.forEach(f => console.log('    - ' + f));
}

const erros = [];
const arquivos = fs.readdirSync('.').filter(f => f.endsWith('.html')).sort();
if (fs.existsSync('obrigado/index.html')) arquivos.push('obrigado/index.html');
const temApp = fs.existsSync('simulador/consent.js');
if (temApp) arquivos.push('simulador/index.html');
erros.push(...verificarPaginas(arquivos.map(arquivo => ({ arquivo, html: fs.readFileSync(arquivo, 'utf8') }))));

if (!fs.existsSync('consent.js')) erros.push('consent.js: arquivo não existe na raiz');
else {
  const raiz = fs.readFileSync('consent.js');
  erros.push(...verificarConsentJs(raiz.toString('utf8')));
  erros.push(...(await verificarComportamento(raiz.toString('utf8'), jsdom)).map(e => 'consent.js: ' + e));
  if (temApp && !raiz.equals(fs.readFileSync('simulador/consent.js'))) erros.push('simulador/consent.js: diferente do consent.js da raiz (as duas cópias têm de ser idênticas)');
}

for (const arquivo of [...arquivos, 'consent.js', ...(temApp ? ['simulador/consent.js'] : [])]) {
  const meus = erros.filter(e => e.startsWith(arquivo + ':'));
  console.log(`  ${meus.length ? cor.erro('✗') : cor.ok('✓')} ${arquivo}`);
  meus.forEach(e => console.log('    - ' + e.slice(arquivo.length + 2)));
}
if (!temApp) console.log(`  ${cor.aviso ? cor.aviso('aviso') : 'aviso'}  simulador/consent.js ainda não existe: simulador pulado (entra com o PR do simulador)`);

if (erros.length || falhasAuto.length) {
  console.log(`  REPROVADO: ${erros.length} erro(s), ${falhasAuto.length} falha(s) no autoteste.`);
  process.exit(1);
}
console.log(`  OK: ${arquivos.length} páginas com consent.js; tag e rosce_attr só depois do aceite.`);
