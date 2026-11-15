// Testes da 1.4.3 — parcial = metade EXATA do máximo (caso real de 15/11: item de interpretação
// da estação ancorada de fratura de tíbia e fíbula distais saiu com [0, 1.13, 2.25]; o certo é
// [0, 1.125, 2.25]).
//  A) os caminhos que calculam a parcial: colapso de 4+ faixas, expansão de 2 para 3 faixas,
//     reescala do fecharEmDez, piso e ajuste final da soma;
//  B) máximos 0.5 / 0.75 / 1.25 / 1.75 -> parciais 0.25 / 0.375 / 0.625 / 0.875;
//  C) 1.4.4 (decisão do Bruno, 15/11): no normalizeChecklistItems, TODO item de 3 faixas sai com
//     parcial = metade do máximo — o arredondamento da 1.4.3 (1.13 -> 1.125) e também a parcial
//     acima da metade que o modelo copia do INEP ([0, 0.75, 1.25] -> [0, 0.625, 1.25]); item de
//     0.25 com 3 faixas grava 0.125 e ganha o aviso 'parcial_fora_granularidade'; binário não muda;
//  D) a soma continua 10.0, inclusive no PEP real da estação do punho (15/11).
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

const VER = P.expect('1.4.4');
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

// 1.4.4: pelo caminho do gerador (normalizeChecklistItems -> processPEP) a parcial 0.75 de máximo 1.25
// vira a metade antes da reescala. Soma 10.25 -> fator 0.9756: o máximo 1.25 fica.
r = pep([item('1', [0, 0.75, 1.25]), item('2', [0, 2.25]), item('3', [0, 2.25]), item('4', [0, 2.25]), item('5', [0, 2.25])]);
igual(r.checklist[0].scores, [0, 0.625, 1.25], 'gerador: parcial 0.75 de máximo 1.25 -> 0.625 (metade)');
ok(soma(r.checklist) === 10, 'gerador com parcial acima da metade: soma 10.0', 'veio ' + soma(r.checklist));
// fecharEmDez intocado: chamado direto (sem a normalização), parcial diferente da metade segue a
// quantização da 1.4.3.
const cru = [item('1', [0, 0.75, 1.25]), item('2', [0, 2.25]), item('3', [0, 2.25]), item('4', [0, 2.25]), item('5', [0, 2.25])];
r = SE.processPEP(cru, 'normalize');
igual(r.checklist[0].scores, [0, 0.75, 1.25], 'fecharEmDez sem normalização: parcial escolhida segue como na 1.4.3');

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

// ── C) parcial sempre na metade (1.4.4) ─────────────────────────────────────
igual(norm({ scores: [0, 1.13, 2.25] }), [0, 1.125, 2.25], 'arredondada: 1.13 com máximo 2.25 -> 1.125');
igual(norm({ scores: [0, 0.63, 1.25] }), [0, 0.625, 1.25], 'arredondada: 0.63 com máximo 1.25 -> 0.625');
igual(norm({ scores: [0, 0.38, 0.75] }), [0, 0.375, 0.75], 'arredondada: 0.38 com máximo 0.75 -> 0.375');
igual(norm({ scores: [0, 0.88, 1.75] }), [0, 0.875, 1.75], 'arredondada: 0.88 com máximo 1.75 -> 0.875');
igual(norm({ scores: [0, 0.75, 1.25] }), [0, 0.625, 1.25], 'acima da metade: [0, 0.75, 1.25] -> [0, 0.625, 1.25]');
igual(norm({ scores: [0, 0.5, 0.75] }), [0, 0.375, 0.75], 'acima da metade: [0, 0.5, 0.75] -> [0, 0.375, 0.75]');
igual(norm({ scores: [0, 1.5, 2] }), [0, 1, 2], 'acima da metade: [0, 1.5, 2] -> [0, 1, 2]');
igual(norm({ scores: [0, 1, 2.25] }), [0, 1.125, 2.25], 'abaixo da metade: [0, 1, 2.25] -> [0, 1.125, 2.25]');
igual(norm({ scores: [0, 0.5] }), [0, 0.5], 'binário sem crit_parc não ganha terceira faixa');
igual(norm({ scores: [0, 0.75] }), [0, 0.75], 'binário de 0.75 sem crit_parc não ganha terceira faixa');

// Item de 0.25 com 3 faixas: grava a metade (0.125) e avisa a curadoria, uma vez só.
function avisos(cl) {
  return SE.softWarnings({ checklist: cl, exams: [], orientAtor: {} }, 'Intermediário')
    .filter(w => w.category === 'parcial_fora_granularidade');
}
const cl025 = SE.normalizeChecklistItems([item('1', [0, 0.15, 0.25])]);
igual(cl025[0].scores, [0, 0.125, 0.25], 'item de 0.25: [0, 0.15, 0.25] -> [0, 0.125, 0.25]');
ok(avisos(cl025).length === 1, 'item de 0.25: aviso parcial_fora_granularidade, uma vez', J(avisos(cl025)));
ok(avisos(cl025).every(w => w.severity === 'warn'), 'item de 0.25: o aviso é warn (não bloqueia)');
ok(avisos(SE.normalizeChecklistItems([item('1', [0, 0.25, 0.5]), item('2', [0, 0.25])])).length === 0,
   'sem aviso para [0, 0.25, 0.5] nem para binário de 0.25');
ok(!SE.preValidate({ checklist: cl025, exams: [], orientAtor: {} }, { ok: true, total: 10 }, 'Intermediário')
     .some(x => x.category === 'parcial_fora_granularidade'), 'parcial_fora_granularidade não entra no preValidate');

// ── D) PEP inteiro, caso real ───────────────────────────────────────────────
r = pep([item('1', [0, 0.5]), item('2', [0, 0.75, 1.5]), item('3', [0, 1.13, 2.25]), item('4', [0, 1, 2]),
         item('5', [0, 1.5]), item('6', [0, 0.5, 1]), item('7', [0, 0.75, 1.25])]);
igual(r.checklist[2].scores, [0, 1.125, 2.25], 'PEP do caso real: item de interpretação em [0, 1.125, 2.25]');
igual(r.checklist[6].scores, [0, 0.625, 1.25], 'PEP do caso real: [0, 0.75, 1.25] -> [0, 0.625, 1.25] (1.4.4)');
ok(soma(r.checklist) === 10 && r.total === 10, 'PEP do caso real: soma 10.0', 'veio ' + soma(r.checklist));
// PEP real da estação do punho (gerada em 15/11), antes e depois da 1.4.4.
const PUNHO = [[0,0.25,0.5], [0,0.88,1.75], [0,0.75,1.25], [0,0.75,1.25], [0,0.5,0.75], [0,0.75],
               [0,0.75,1.25], [0,0.75,1.25], [0,0.5,0.75], [0,0.5]];
const PUNHO_144 = [[0,0.25,0.5], [0,0.875,1.75], [0,0.625,1.25], [0,0.625,1.25], [0,0.375,0.75], [0,0.75],
                   [0,0.625,1.25], [0,0.625,1.25], [0,0.375,0.75], [0,0.5]];
r = pep(PUNHO.map((sc, i) => item(String(i + 1), sc)));
igual(r.checklist.map(it => it.scores), PUNHO_144, 'PEP do punho: todas as parciais na metade');
ok(soma(r.checklist) === 10 && r.total === 10, 'PEP do punho: soma 10.0', 'veio ' + soma(r.checklist));
ok(r.checklist.every(it => it.scores.length === PUNHO[r.checklist.indexOf(it)].length), 'PEP do punho: nenhum item mudou de nº de faixas');
// 'reject' (admin) não altera nada e confere a soma.
const rj = SE.processPEP(SE.normalizeChecklistItems([item('1', [0, 1.13, 2.25]), item('2', [0, 7.75])]), 'reject');
ok(rj.ok && rj.total === 10, "policy 'reject': soma 10.0 com parcial já normalizada", J(rj.total));
igual(rj.checklist[0].scores, [0, 1.125, 2.25], "policy 'reject': parcial 1.125");

console.log('\n=== ' + pass + ' OK / ' + fail + ' FAIL ===');
process.exit(fail === 0 ? 0 : 1);
