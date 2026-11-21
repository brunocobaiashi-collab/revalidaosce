// Testes da 1.4.5 — impresso com interpretação/diagnóstico vira aviso (decisão do Bruno, 21/11).
//  (a) Básico com "compatível com" no laboratório: preValidate sem issue; softWarnings com
//      'impresso_fora_do_nivel'; audit() não volta FAIL por isso;
//  (b) Intermediário com laudo de TC "compatível com apendicite": nenhum aviso;
//  (c) Avançado com laudo de US citando o diagnóstico: aviso, sem FAIL;
//  (d) "name" com diagnóstico: continua FAIL;
//  (e) "caso" ou "orientMed" com diagnóstico: continua FAIL;
//  (f) buildSysAudit de cada nível (e ancorado): sem a frase de HIGH para impresso, com a categoria nova;
//  (g) buildSys1 / buildSys2 idênticos byte a byte à 1.4.4 (o gerador não muda).
// Sem IA: aiCall é um stub que devolve {"status":"OK"}.
const fs = require('fs');
const vm = require('vm');
const P = require('./_paths');
function load(p) { const c = {}; vm.createContext(c); vm.runInContext(fs.readFileSync(p, 'utf8'), c); return c.StationEngine; }
const SE = load(P.ENGINE);
const REF = load(P.base('1.4.4'));

let pass = 0, fail = 0;
function ok(cond, nome, extra) {
  if (cond) { pass++; console.log('OK   ' + nome); }
  else { fail++; console.log('FAIL ' + nome + (extra ? ' — ' + extra : '')); }
}
const J = (x) => JSON.stringify(x);
const CAT = 'impresso_fora_do_nivel';
const PEP_OK = { ok: true, total: 10 };

function estacao(exams, extra) {
  return Object.assign({
    name: 'Dor abdominal em adulto jovem', orientMed: 'Atenda o paciente.', caso: 'Voce e medico em UBS.',
    local: 'UBS',
    checklist: [{ id: '1', text: 'Anamnese', scores: [0, 0.5, 1], labels: ['a', 'b', 'c'], crit_adeq: 'x', crit_parc: 'y' }],
    exams: [{ title: 'EXAME FISICO', rows: ['PA: 120x80 mmHg'], images: [], trigger_keywords: ['exame fisico', 'fisico geral', 'sinais vitais'] }].concat(exams || [])
  }, extra || {});
}
const LAB_COMPATIVEL = { title: 'LABORATORIO', rows: ['Hemoglobina: 9,8 g/dL', 'Achados compatíveis com anemia ferropriva'], images: [],
  trigger_keywords: ['laboratorio', 'exames de sangue', 'hemograma'] };
const TC_APENDICITE = { title: 'TOMOGRAFIA DE ABDOME', rows: ['Apendice com 12 mm, densificacao da gordura periapendicular', 'Achados compatíveis com apendicite aguda'], images: [],
  trigger_keywords: ['tomografia', 'tc de abdome', 'tomografia de abdome'] };
const US_APENDICITE = { title: 'ULTRASSOM DE ABDOME', rows: ['Estrutura tubular nao compressivel em FID, 9 mm', 'Diagnostico: apendicite aguda'], images: [],
  trigger_keywords: ['ultrassom', 'usg de abdome', 'ultrassonografia'] };

function stubOK() {
  return async function () {
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"status":"OK","score":9,"issues":[]}' }] }) };
  };
}
const temCat = (arr) => (arr || []).some((w) => w.category === CAT);
const temVazImpresso = (arr) => (arr || []).some((w) => w.category === 'vazamento_impresso');

(async function () {
  const VER = P.expect('1.4.5');
  ok(SE.ENGINE_VERSION === VER, 'ENGINE_VERSION = ' + VER, 'veio ' + SE.ENGINE_VERSION);

  // (a) Básico
  const stA = estacao([LAB_COMPATIVEL]);
  const preA = SE.preValidate(stA, PEP_OK, 'Básico');
  ok(preA.length === 0, '(a) Básico: preValidate sem issue', J(preA));
  const swA = SE.softWarnings(stA, 'Básico');
  const wA = swA.filter((w) => w.category === CAT);
  ok(wA.length === 1, '(a) Básico: softWarnings com 1 aviso ' + CAT, J(swA));
  ok(wA[0] && wA[0].severity === 'warn', '(a) severidade warn');
  ok(wA[0] && wA[0].message === 'Impresso "LABORATORIO" traz interpretação/diagnóstico; no nível Básico o padrão é dado bruto. Aviso, não bloqueia (decisão de 21/11).',
     '(a) mensagem exata', wA[0] && wA[0].message);
  const auA = await SE.audit(stA, stubOK(), 'stub', PEP_OK, 'Básico');
  ok(auA.status !== 'FAIL' && auA.passed === true, '(a) audit() não volta FAIL', J(auA.status));
  ok(temCat(auA.warnings), '(a) audit().warnings traz ' + CAT + ' (o admin mostra em gen-warnings)');
  ok(!temVazImpresso(auA.issues), '(a) audit().issues sem vazamento_impresso');

  // (a2) Básico com diagnóstico nominal (citaDiagnostico) no laboratório: também aviso, não issue
  const stA2 = estacao([{ title: 'LABORATORIO', rows: ['NS1 reagente — dengue'], images: [], trigger_keywords: ['laboratorio', 'exames de sangue', 'sorologia'] }]);
  ok(SE.preValidate(stA2, PEP_OK, 'Básico').length === 0, '(a2) diagnóstico nominal no lab: preValidate sem issue');
  ok(SE.softWarnings(stA2, 'Básico').filter((w) => w.category === CAT).length === 1, '(a2) um aviso por impresso (LEAK_RX + citaDiagnostico não duplicam)');

  // (b) Intermediário: laudo de TC com diagnóstico é permitido
  const stB = estacao([TC_APENDICITE]);
  ok(SE.preValidate(stB, PEP_OK, 'Intermediário').length === 0, '(b) Intermediário: preValidate sem issue');
  ok(!temCat(SE.softWarnings(stB, 'Intermediário')), '(b) Intermediário: laudo de TC com dx sem aviso');
  // (b2) Intermediário: laboratório com dx continua avisando
  ok(temCat(SE.softWarnings(estacao([LAB_COMPATIVEL]), 'Intermediário')), '(b2) Intermediário: laboratório com dx gera aviso');

  // (c) Avançado: laudo de US com diagnóstico — aviso, sem FAIL
  const stC = estacao([US_APENDICITE]);
  ok(SE.preValidate(stC, PEP_OK, 'Avançado').length === 0, '(c) Avançado: preValidate sem issue');
  ok(temCat(SE.softWarnings(stC, 'Avançado')), '(c) Avançado: aviso ' + CAT);
  const auC = await SE.audit(stC, stubOK(), 'stub', PEP_OK, 'Avançado');
  ok(auC.status !== 'FAIL' && auC.passed === true, '(c) audit() não volta FAIL', J(auC.status));

  // (d) name com diagnóstico continua FAIL
  const stD = estacao([], { name: 'Apendicite aguda em adulto jovem' });
  const auD = await SE.audit(stD, stubOK(), 'stub', PEP_OK, 'Intermediário');
  ok(auD.status === 'FAIL' && auD.passed === false, '(d) name com dx: FAIL', J(auD.status));
  ok(auD.issues.some((i) => i.category === 'vazamento' && i.severity === 'high' && /^name/.test(i.message)), '(d) issue HIGH vazamento em name');

  // (e) caso / orientMed com diagnóstico continuam FAIL
  for (const [campo, txt] of [['caso', 'Voce e medico em UBS. Paciente com suspeita de pneumonia.'], ['orientMed', 'Investigue a dengue.']]) {
    const stE = estacao([], { [campo]: txt });
    const auE = await SE.audit(stE, stubOK(), 'stub', PEP_OK, 'Básico');
    ok(auE.status === 'FAIL' && auE.passed === false, '(e) ' + campo + ' com dx: FAIL', J(auE.status));
    ok(auE.issues.some((i) => i.category === 'vazamento' && i.severity === 'high' && i.message.indexOf(campo) === 0), '(e) issue HIGH vazamento em ' + campo);
  }

  // (f) prompts do auditor
  const ANCHOR = SE.normalizeAnchor({
    image_file: 'exemplo_a1b2c3d4.png', modality: 'radiografia de tórax', incidence: 'PA',
    finding_truth: 'hipertransparência em hemitórax direito', diagnosis_truth: 'pneumotórax',
    area: 'Clínica Médica', image_credits: { license: 'CC BY 4.0', author: 'A', year: '2024' }
  });
  const prompts = [['Básico', SE.buildSysAudit('Básico')], ['Intermediário', SE.buildSysAudit('Intermediário')],
    ['Avançado', SE.buildSysAudit('Avançado')], ['ancorado', SE.buildSysAudit('Avançado', ANCHOR)]];
  for (const [nv, sys] of prompts) {
    ok(sys.indexOf('VAZAMENTO: impresso/rows entregam interpretacao') < 0, '(f) ' + nv + ': sem o HIGH de impresso na lista 🔴');
    ok(sys.indexOf('Reporte VAZAMENTO se entregarem interpretacao') < 0, '(f) ' + nv + ': sem "Reporte VAZAMENTO" no head');
    ok(sys.indexOf('VAZAMENTO (high), como no tier dificil') < 0, '(f) ' + nv + ': sem o HIGH do bloco Básico');
    ok(sys.indexOf('4) Vazamento e SEMPRE high (nao invente') < 0, '(f) ' + nv + ': regra 4 restrita');
    ok(sys.indexOf('4) Vazamento em "name", "caso" ou "orientMed" e SEMPRE high') >= 0, '(f) ' + nv + ': regra 4 nomeia name/caso/orientMed');
    ok(sys.indexOf('"impresso_fora_do_nivel"') >= 0, '(f) ' + nv + ': categoria nova no formato de saída');
    const hi = sys.indexOf('🔴 HIGH'), md = sys.indexOf('🟡 MEDIUM'), cat = sys.indexOf('IMPRESSO FORA DO NIVEL (categoria impresso_fora_do_nivel)');
    ok(cat > md && md > hi, '(f) ' + nv + ': impresso_fora_do_nivel dentro da lista 🟡 MEDIUM');
    ok(sys.indexOf('"name" cita diagnostico') >= 0 && sys.indexOf('"caso" cita diagnostico') >= 0 && sys.indexOf('"orientMed" cita nome de doenca') >= 0,
       '(f) ' + nv + ': vazamento em name/caso/orientMed segue na lista HIGH');
  }
  ok(SE.buildSysAudit('Avançado', ANCHOR).indexOf('  - HIGH: o impresso-ancora') < 0, '(f) ancorado: impresso-âncora com laudo não é mais HIGH');
  ok(SE.buildSysAudit('Avançado', ANCHOR).indexOf('  - HIGH: item de interpretacao cobrando achado que NAO esta no gabarito') >= 0
     && SE.buildSysAudit('Avançado', ANCHOR).indexOf('  - HIGH: hipotese diagnostica premiada pelo PEP incompativel') >= 0,
     '(f) ancorado: os outros dois HIGH do bloco ficam');

  // (g) gerador idêntico à 1.4.4
  const ancRef = REF.normalizeAnchor({
    image_file: 'exemplo_a1b2c3d4.png', modality: 'radiografia de tórax', incidence: 'PA',
    finding_truth: 'hipertransparência em hemitórax direito', diagnosis_truth: 'pneumotórax',
    area: 'Clínica Médica', image_credits: { license: 'CC BY 4.0', author: 'A', year: '2024' }
  });
  for (const dif of ['Básico', 'Intermediário', 'Avançado']) {
    ok(SE.buildSys1('Clínica Médica', 'UBS', 'FEWSHOT', dif) === REF.buildSys1('Clínica Médica', 'UBS', 'FEWSHOT', dif), '(g) buildSys1(' + dif + ') = 1.4.4');
    ok(SE.buildSys2() === REF.buildSys2(), '(g) buildSys2 (' + dif + ') = 1.4.4');
  }
  ok(SE.buildSys1('Clínica Médica', 'Emergência', 'FEWSHOT', 'Avançado', ANCHOR) === REF.buildSys1('Clínica Médica', 'Emergência', 'FEWSHOT', 'Avançado', ancRef), '(g) buildSys1(ancorado) = 1.4.4');
  ok(SE.buildSys2(ANCHOR) === REF.buildSys2(ancRef), '(g) buildSys2(ancorado) = 1.4.4');

  console.log('\n=== ' + pass + ' OK / ' + fail + ' FAIL ===');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.log('ERRO ' + (e && e.stack || e)); process.exit(1); });
