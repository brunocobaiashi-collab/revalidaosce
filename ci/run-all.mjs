// Roda os 5 portões em sequência e devolve um resumo.
// Uso (sempre a partir da RAIZ do repositório):  node ci/run-all.mjs
//
// Sai com código 1 se qualquer portão reprovar. Cada portão roda em processo
// próprio de propósito: um portão que estoura não impede os outros de rodarem,
// então uma rodada mostra TODOS os problemas de uma vez, não o primeiro.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!fs.existsSync('simulador/index.html')) {
  console.error('ERRO: rode a partir da raiz do repositório (esperava simulador/index.html).');
  process.exit(2);
}

const PORTOES = [
  ['1 · sintaxe', 'ci/check-sintaxe.mjs'],
  ['2 · versão', 'ci/check-versao.mjs'],
  ['3 · runtime jsdom', 'ci/check-runtime.mjs'],
  ['4 · listener órfão', 'ci/check-listeners.mjs'],
  ['5 · handler inline', 'ci/check-onclick.mjs'],
];

const reprovados = [];
for (const [nome, script] of PORTOES) {
  const r = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  if (r.status !== 0) reprovados.push(nome);
}

console.log('\n' + '═'.repeat(60));
if (reprovados.length) {
  console.log(`REPROVADO — ${reprovados.length} de ${PORTOES.length} portões: ${reprovados.join(', ')}`);
  console.log('═'.repeat(60));
  process.exit(1);
}
console.log(`APROVADO — ${PORTOES.length} portões verdes.`);
console.log('═'.repeat(60));
