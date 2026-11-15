// Testes da 1.4.3 — parcial = metade EXATA do máximo (caso real de 15/11: item de interpretação
// da estação ancorada de fratura de tíbia e fíbula distais saiu com [0, 1.13, 2.25]; o certo é
// [0, 1.125, 2.25]).
//  A) os caminhos que calculam a parcial: colapso de 4+ faixas, expansão de 2 para 3 faixas,
//     reescala do fecharEmDez, piso e ajuste final da soma;
//  B) máximos 0.5 / 0.75 / 1.25 / 1.75 -> parciais 0.25 / 0.375 / 0.625 / 0.875;
//  C) rede no normalizeChecklistItems: 1.13 com máximo 2.25 vira 1.125; parcial escolhida
//     diferente da metade (0.75 com máximo 1.25) não é tocada;
//  D) a soma continua 10.0.
const fs = require('fs');
const vm = require('vm');
const P = require('./_paths');
function load(p) { const c = {}; vm.createContext(c); vm.runInContext(fs.readFileSync(p, 'utf8'), c); return c.StationEngine; }
const SE = load(P.ENGINE);

let pass = 0, fail = 0;
function ok(cond, nome, extra) {
  if (cond) { pass++; console.log('OK   ' + nome); }
  else { fail++; console.log('FAIL ' + nome + (extra ? ' — ' + extra : '')); }
}
const J = (x) => JSON.stringify(x);
function igual(a, b, nome) { ok(J(a) === J(b), nome, 'veio ' + J(a) + ', esperava ' + J(b)); }

const VER = P.expect('1.4.3');
ok(SE.ENGINE_VERSION === VER, 'ENGINE_VERSION = ' + VER, 'veio ' + SE.ENGINE_VERSION);

function norm(it) { return SE.normalizeChecklistItems([Object.assign({ text: 'Item' }, it)])[0].scores; }
function item(id, scores) {
  return { id: id, text: 'Item ' + id, scores: scores.slice(), crit_adeq: 'a',
           crit_parc: scores.length === 3 ? 'p' : '', crit_inad: 'i' };
}
function pep(lista) { return SE.processPEP(SE.normalizeChecklistItems(lista), 'normalize'); }
function soma(cl) { return Math.round(SE.pepTotal(cl) * 1000) / 1000; }

// ── A) caminhos ─────────────────────────────────────────────────────────────
igual(norm({ scores: [0, 0.75, 1.5, 2.25] }), [0, 1.125, 2.25], 'colapso de 4 faixas: máximo 2.25 -> parcial 1.125');
igual(norm({ scores: [0, 0.5, 1, 1.75, 2.25] }), [0, 1.125, 2.25], 'colapso de 5 faixas: máximo 2.25 -> parcial 1.125');
igual(norm({ scores: [0, 2.25], crit_parc: 'cumpre parte' }), [0, 1.125, 2.25], 'expansão de 2 faixas: máximo 2.25 -> parcial 1.125');

// Reescala: soma 11.25 -> fator 0.888…; [0, 1.25, 2.5] vira máximo 2.25. Antes a parcial era
// quantizada sozinha em 0.25 (1.111 -> 1.0).
let r = pep([item('1', [0, 1.25, 2.5]), item('2', [0, 2.25]), item('3', [0, 2.25]), item('4', [0, 2.25]), item('5', [0, 2])]);
igual(r.checklist[0].scores, [0, 1.125, 2.25], 'reescala: parcial que era metade continua metade (1.125)');
ok(soma(r.checklist) === 10, 'reescala: soma 10.0', 'veio ' + soma(r.checklist));

// Reescala com parcial escolhida diferente da metade: comportamento de antes (quantiza em 0.25).
// Soma 10.25 -> fator 0.9756: o item de 1.25 fica em 1.25 e a parcial 0.75 não vira 0.625.
r = pep([item('1', [0, 0.75, 1.25]), item('2', [0, 2.25]), item('3', [0, 2.25]), item('4', [0, 2.25]), item('5', [0, 2.25])]);
igual(r.checklist[0].scores, [0, 0.75, 1.25], 'reescala: parcial 0.75 de máximo 1.25 não é tocada');
ok(soma(r.checklist) === 10, 'reescala com parcial escolhida: soma 10.0', 'veio ' + soma(r.checklist));

// Ajuste final da soma: 2+2+2+2+1.75 = 9.75; a reescala não muda nada na granularidade e o
// resíduo de 0.25 vai para o maior item (o primeiro de máximo 2, que é de 3 faixas) -> 2.25.
r = pep([item('1', [0, 1, 2]), item('2', [0, 2]), item('3', [0, 2]), item('4', [0, 2]), item('5', [0, 1.75])]);
igual(r.checklist[0].scores, [0, 1.125, 2.25], 'ajuste da soma: maior item vira 2.25 com parcial 1.125');
ok(soma(r.checklist) === 10, 'ajuste da soma: soma 10.0', 'veio ' + soma(r.checklist));

// Piso: item de 3 faixas que a reescala zera vai a 0.5, com parcial 0.25 (metade exata).
r = pep([item('1', [0, 0.05, 0.1]), item('2', [0, 4]), item('3', [0, 4]), item('4', [0, 4])]);
igual(r.checklist[0].scores, [0, 0.25, 0.5], 'piso: item de 3 faixas zerado -> [0, 0.25, 0.5]');
ok(soma(r.checklist) === 10, 'piso: soma 10.0', 'veio ' + soma(r.checklist));

// ── B) outros máximos ───────────────────────────────────────────────────────
for (const [mx, meio] of [[0.5, 0.25], [0.75, 0.375], [1.25, 0.625], [1.75, 0.875], [2.25, 1.125]]) {
  igual(norm({ scores: [0, mx], crit_parc: 'p' }), [0, meio, mx], 'expansão: máximo ' + mx + ' -> parcial ' + meio);
  igual(norm({ scores: [0, mx / 4, mx / 2, mx] }), [0, meio, mx], 'colapso: máximo ' + mx + ' -> parcial ' + meio);
}

// ── C) rede na normalização ─────────────────────────────────────────────────
igual(norm({ scores: [0, 1.13, 2.25] }), [0, 1.125, 2.25], 'rede: 1.13 com máximo 2.25 -> 1.125');
igual(norm({ scores: [0, 0.63, 1.25] }), [0, 0.625, 1.25], 'rede: 0.63 com máximo 1.25 -> 0.625');
igual(norm({ scores: [0, 0.38, 0.75] }), [0, 0.375, 0.75], 'rede: 0.38 com máximo 0.75 -> 0.375');
igual(norm({ scores: [0, 0.88, 1.75] }), [0, 0.875, 1.75], 'rede: 0.88 com máximo 1.75 -> 0.875');
igual(norm({ scores: [0, 0.75, 1.25] }), [0, 0.75, 1.25], 'rede: 0.75 com máximo 1.25 (escolha) não é tocada');
igual(norm({ scores: [0, 1, 2.25] }), [0, 1, 2.25], 'rede: 1.0 com máximo 2.25 (escolha) não é tocada');
igual(norm({ scores: [0, 1.5, 2] }), [0, 1.5, 2], 'rede: 1.5 com máximo 2 (escolha) não é tocada');
igual(norm({ scores: [0, 0.5] }), [0, 0.5], 'binário sem crit_parc não muda');

// ── D) PEP inteiro, caso real ───────────────────────────────────────────────
r = pep([item('1', [0, 0.5]), item('2', [0, 0.75, 1.5]), item('3', [0, 1.13, 2.25]), item('4', [0, 1, 2]),
         item('5', [0, 1.5]), item('6', [0, 0.5, 1]), item('7', [0, 0.75, 1.25])]);
igual(r.checklist[2].scores, [0, 1.125, 2.25], 'PEP do caso real: item de interpretação em [0, 1.125, 2.25]');
igual(r.checklist[6].scores, [0, 0.75, 1.25], 'PEP do caso real: [0, 0.75, 1.25] intacto');
ok(soma(r.checklist) === 10 && r.total === 10, 'PEP do caso real: soma 10.0', 'veio ' + soma(r.checklist));
// 'reject' (admin) não altera nada e confere a soma.
const rj = SE.processPEP(SE.normalizeChecklistItems([item('1', [0, 1.13, 2.25]), item('2', [0, 7.75])]), 'reject');
ok(rj.ok && rj.total === 10, "policy 'reject': soma 10.0 com parcial já normalizada", J(rj.total));
igual(rj.checklist[0].scores, [0, 1.125, 2.25], "policy 'reject': parcial 1.125");

console.log('\n=== ' + pass + ' OK / ' + fail + ' FAIL ===');
process.exit(fail === 0 ? 0 : 1);
