// Portão 7 — números públicos do site (decisão do Bruno, 16/11/2026).
// Uso, a partir da raiz: node ci/check-numeros-publicos.mjs   (saída 1 = reprovou)
//
// Roda primeiro o autoteste (test-numeros-publicos.mjs): se o portão deixou de
// reprovar o que deve reprovar, ele mesmo reprova. Depois confere as páginas
// públicas: todo .html da raiz e obrigado/index.html.
// Os números ficam em ci/numeros-publicos.json (públicos; ci/ não vai ao ar).

import fs from 'node:fs';
import { cor } from './lib/html.mjs';
import { verificar } from './lib/numeros-publicos.mjs';
import { autoteste } from './test-numeros-publicos.mjs';

const cfg = JSON.parse(fs.readFileSync('ci/numeros-publicos.json', 'utf8'));

console.log('\n' + ('── Portão 7 · números públicos ').padEnd(60, '─'));
const falhasAuto = autoteste(cfg, { silencioso: true });
if (falhasAuto.length) {
  console.log(cor.erro('  ✗ autoteste: o portão deixou de reprovar o que deve'));
  falhasAuto.forEach(f => console.log('    - ' + f));
}

const arquivos = fs.readdirSync('.').filter(f => f.endsWith('.html')).sort();
if (fs.existsSync('obrigado/index.html')) arquivos.push('obrigado/index.html');
const paginas = arquivos.map(arquivo => ({ arquivo, html: fs.readFileSync(arquivo, 'utf8') }));
const erros = verificar(paginas, cfg);

for (const arquivo of arquivos) {
  const meus = erros.filter(e => e.startsWith(arquivo + ':'));
  console.log(`  ${meus.length ? cor.erro('✗') : cor.ok('✓')} ${arquivo}`);
  meus.forEach(e => console.log('    - ' + e.slice(arquivo.length + 2)));
}

if (erros.length || falhasAuto.length) {
  console.log(`  REPROVADO: ${erros.length} erro(s) nas páginas, ${falhasAuto.length} falha(s) no autoteste.`);
  process.exit(1);
}
console.log(`  OK: ${arquivos.length} páginas; piso ${cfg.piso_total}/${cfg.piso_inep}/${cfg.piso_curadoria}, exato ${cfg.exato.ativas}/${cfg.exato.inep}/${cfg.exato.curadoria}, R$ ${cfg.preco_mensal}/mês.`);
