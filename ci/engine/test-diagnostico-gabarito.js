// Testes da 1.4.3 — o item de interpretação do modo ancorado premia o diagnóstico do gabarito, com o
// mesmo nome (caso real de 15/11: crit_adeq "fratura bimaleolar/pilão tibial" para o gabarito
// "Fratura da tíbia distal (pilão tibial) e da fíbula distal"). Texto aprovado pelo Bruno.
//  A) buildSys2 ancorado contém a proibição nova, o crit_adeq novo e a frase final nova; o texto
//     antigo saiu;
//  B) buildSys2 ancorado = o da 1.4.2 com exatamente as três trocas, e nada além;
//  C) buildSys2 sem âncora idêntico ao da 1.4.2.
const fs = require('fs');
const vm = require('vm');
const P = require('./_paths');
function load(p) { const c = {}; vm.createContext(c); vm.runInContext(fs.readFileSync(p, 'utf8'), c); return c.StationEngine; }
const SE = load(P.ENGINE);
const REF = load(P.base('1.4.2'));

let pass = 0, fail = 0;
function ok(cond, nome, extra) {
  if (cond) { pass++; console.log('OK   ' + nome); }
  else { fail++; console.log('FAIL ' + nome + (extra ? ' — ' + extra : '')); }
}

const VER = P.expect('1.4.3');
ok(SE.ENGINE_VERSION === VER, 'ENGINE_VERSION = ' + VER, 'veio ' + SE.ENGINE_VERSION);

const ANCHOR = {
  image_file: 'exemplo_a1b2c3d4.png', modality: 'radiografia', incidence: 'AP e perfil',
  finding_truth: 'traço de fratura em tíbia distal com extensão articular e fratura de fíbula distal',
  diagnosis_truth: 'Fratura da tíbia distal (pilão tibial) e da fíbula distal à esquerda',
  area: 'Cirurgia', image_credits: { license: 'CC BY 4.0', author: 'A', year: '2024' }
};
const anc = SE.normalizeAnchor(ANCHOR);
const novo = SE.buildSys2(anc);
const ref = REF.buildSys2(REF.normalizeAnchor(ANCHOR));

// [texto 1.4.2, texto 1.4.3]
const TROCAS = [
  ['  crit_adeq: descreve o achado principal (resuma o finding_truth acima) E conclui pela hipotese/\n' +
   '             diagnostico compativel\n',
   '  crit_adeq: descreve o achado principal (resuma o finding_truth acima) E conclui pelo\n' +
   '             diagnostico do gabarito (diagnosis_truth), com o mesmo nome\n'],
  ['  • NAO criar subitem que recite dado pronto (nao ha dado pronto — a imagem e crua)\n',
   '  • NAO criar subitem que recite dado pronto (nao ha dado pronto — a imagem e crua)\n' +
   '  • NAO aceitar no criterio diagnostico diferente do gabarito, nem juntar diagnosticos distintos\n' +
   '    com "/" ou "ou" (ex.: "fratura bimaleolar/pilao tibial"). Sinonimo so quando for a mesma doenca.\n'],
  ['A hipotese diagnostica premiada pelo PEP deve ser coerente com o diagnosis_truth acima.',
   'A hipotese diagnostica premiada pelo PEP deve ser o diagnosis_truth acima, com o mesmo nome;\n' +
   'vale a mesma proibicao de juntar diagnosticos diferentes.'],
];

// ── A) conteúdo ─────────────────────────────────────────────────────────────
ok(novo.indexOf('NAO aceitar no criterio diagnostico diferente do gabarito') >= 0 &&
   novo.indexOf('com "/" ou "ou" (ex.: "fratura bimaleolar/pilao tibial")') >= 0,
   'ancorado: proibição de juntar diagnósticos distintos presente');
ok(novo.indexOf('diagnostico do gabarito (diagnosis_truth), com o mesmo nome') >= 0, 'ancorado: crit_adeq pelo diagnosis_truth com o mesmo nome');
ok(novo.indexOf('deve ser o diagnosis_truth acima, com o mesmo nome') >= 0, 'ancorado: frase final nova');
ok(novo.indexOf('hipotese/\n             diagnostico compativel') < 0, 'ancorado: crit_adeq antigo saiu');
ok(novo.indexOf('deve ser coerente com o diagnosis_truth') < 0, 'ancorado: frase final antiga saiu');
ok(novo.indexOf(ANCHOR.diagnosis_truth) >= 0, 'ancorado: gabarito continua no prompt');
const iProib = novo.indexOf('PROIBICOES ABSOLUTAS neste item:'), iNova = novo.indexOf('NAO aceitar no criterio'),
      iPode = novo.indexOf('PODE existir tambem um item binario');
ok(iProib > 0 && iProib < iNova && iNova < iPode, 'ancorado: proibição nova dentro da lista de PROIBICOES ABSOLUTAS');

// ── B) só as três trocas ────────────────────────────────────────────────────
let esperado = ref, trocasOk = true;
for (const [velho, nv] of TROCAS) {
  if (esperado.split(velho).length !== 2) { trocasOk = false; break; }
  esperado = esperado.replace(velho, () => nv);
}
ok(trocasOk, 'ancorado: cada trecho da 1.4.2 aparece uma vez');
ok(trocasOk && esperado === novo, 'ancorado: 1.4.2 + as três trocas = 1.4.3, e nada além',
   'esperado ' + esperado.length + ' / novo ' + novo.length);

// ── C) sem âncora intocado ──────────────────────────────────────────────────
ok(SE.buildSys2() === REF.buildSys2(), 'sem âncora: buildSys2 idêntico ao da 1.4.2');
ok(SE.buildSys2().indexOf('NAO aceitar no criterio diagnostico') < 0, 'sem âncora: sem a proibição do modo ancorado');

console.log('\n=== ' + pass + ' OK / ' + fail + ' FAIL ===');
process.exit(fail === 0 ? 0 : 1);
