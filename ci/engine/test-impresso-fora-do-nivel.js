// Testes da 1.4.5 — impresso com interpretação/diagnóstico vira aviso (decisão do Bruno, 21/11).
//  (a) Básico com "compatível com" no laboratório: preValidate sem issue; softWarnings com
//      'impresso_fora_do_nivel'; audit() não volta FAIL por isso;
//  (b) Intermediário com laudo de TC "compatível com apendicite": nenhum aviso;
//  (c) Avançado com laudo de US citando o diagnóstico: aviso, sem FAIL;
//  (d) "name" com diagnóstico: continua FAIL;
//  (e) "caso" ou "orientMed" com diagnóstico: continua FAIL;
//  (f) buildSysAudit de cada nível (e ancorado): sem a frase de HIGH para impresso, com a categoria nova;
//  (g) buildSys1 / buildSys2 idênticos byte a byte à 1.4.4 (o gerador não muda);
//  (h) IA devolve WARN com 1 medium impresso_fora_do_nivel + 1 medium de outra categoria: OK, aviso em warnings;
//  (i) IA devolve FAIL só por 1 high impresso_fora_do_nivel: OK;
//  (j) IA devolve FAIL por 1 high de coerencia: continua FAIL;
//  (k) estação ancorada com linha de achado no impresso-âncora: não reprova e gera o aviso.
// Sem IA: aiCall é um stub que devolve uma resposta fixa.
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

function stubIA(resp) {
  return async function () {
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(resp) }] }) };
  };
}
function stubOK() { return stubIA({ status: 'OK', score: 9, issues: [] }); }
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

  // (h) WARN = 1 medium impresso_fora_do_nivel + 1 medium de outra categoria -> OK
  const stH = estacao([]);
  const auH = await SE.audit(stH, stubIA({ status: 'WARN', score: 7, issues: [
    { severity: 'medium', category: CAT, message: 'Laboratorio traz "compativel com".' },
    { severity: 'medium', category: 'pep', message: 'PEP nao cobre a conduta.' }] }), 'stub', PEP_OK, 'Básico');
  ok(auH.status === 'OK' && auH.passed === true, '(h) WARN com 1 medium ' + CAT + ' + 1 medium pep: OK', J([auH.status, auH.passed]));
  ok(temCat(auH.warnings), '(h) o aviso da IA aparece em warnings');
  ok(auH.issues.length === 1 && auH.issues[0].category === 'pep', '(h) issues fica só com a de pep', J(auH.issues));
  ok(auH.warnings.some((w) => w.category === CAT && w.severity === 'warn' && /compativel com/.test(w.message)), '(h) aviso com severity warn e a mensagem da IA');

  // (i) FAIL só por 1 high impresso_fora_do_nivel -> OK
  const auI = await SE.audit(estacao([]), stubIA({ status: 'FAIL', score: 4, issues: [
    { severity: 'high', category: CAT, message: 'Exame fisico traz "(FEBRIL)".' }] }), 'stub', PEP_OK, 'Avançado');
  ok(auI.status === 'OK' && auI.passed === true, '(i) FAIL só por high ' + CAT + ': OK', J([auI.status, auI.passed]));
  ok(temCat(auI.warnings) && auI.issues.length === 0, '(i) a issue foi para warnings');

  // (i2) 2 medium de outras categorias + 1 impresso_fora_do_nivel -> continua WARN
  const auI2 = await SE.audit(estacao([]), stubIA({ status: 'WARN', score: 6, issues: [
    { severity: 'medium', category: CAT, message: 'x' }, { severity: 'medium', category: 'pep', message: 'y' },
    { severity: 'medium', category: 'coerencia', message: 'z' }] }), 'stub', PEP_OK, 'Básico');
  ok(auI2.status === 'WARN' && auI2.passed === false, '(i2) 2 medium de outras categorias: continua WARN', J(auI2.status));

  // (j) FAIL por 1 high de coerencia -> continua FAIL (com ou sem impresso_fora_do_nivel junto)
  const auJ = await SE.audit(estacao([]), stubIA({ status: 'FAIL', score: 3, issues: [
    { severity: 'high', category: 'coerencia', message: 'Conduta perigosa.' }] }), 'stub', PEP_OK, 'Intermediário');
  ok(auJ.status === 'FAIL' && auJ.passed === false, '(j) FAIL por high de coerencia: continua FAIL', J(auJ.status));
  const auJ2 = await SE.audit(estacao([]), stubIA({ status: 'FAIL', score: 3, issues: [
    { severity: 'high', category: CAT, message: 'x' }, { severity: 'high', category: 'coerencia', message: 'Conduta perigosa.' }] }), 'stub', PEP_OK, 'Intermediário');
  ok(auJ2.status === 'FAIL' && auJ2.passed === false && auJ2.issues.length === 1, '(j2) high de coerencia + high ' + CAT + ': FAIL só pela coerencia', J(auJ2));

  // (j3) erro da IA não muda
  const auJ3 = await SE.audit(estacao([]), async () => ({ ok: false, status: 503 }), 'stub', PEP_OK, 'Básico');
  ok(auJ3.status === 'AUDIT_ERROR' && auJ3.passed === false, '(j3) AUDIT_ERROR não muda', J(auJ3.status));
  const auJ4 = await SE.audit(estacao([]), async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"status":"OK"' }] }) }), 'stub', PEP_OK, 'Básico');
  ok(auJ4.status === 'AUDIT_ERROR' && auJ4.passed === false, '(j4) auditoria truncada continua AUDIT_ERROR', J(auJ4.status));

  // (k) estação ancorada com linha de achado no impresso-âncora
  const stK = estacao([{ title: 'RADIOGRAFIA DE TÓRAX', rows: ['Radiografia de tórax, incidência PA.', 'Achado: hipertransparência em hemitórax direito'],
    images: [ANCHOR.image_file], image_credits: [{ license: 'CC BY 4.0', author: 'A', year: '2024' }],
    trigger_keywords: ['radiografia', 'raio x', 'radiografia de torax'] }], {
    local: 'Pronto-socorro', caso: 'Voce e medico no pronto-socorro.',
    checklist: [
      { id: '1', text: 'Anamnese', scores: [0, 0.5, 1], labels: ['a', 'b', 'c'], crit_adeq: 'x', crit_parc: 'y' },
      { id: '2', text: 'Interpreta a radiografia de tórax e reconhece o achado', scores: [0, 1, 2], labels: ['a', 'b', 'c'], crit_adeq: 'descreve e conclui', crit_parc: 'descreve' }] });
  const preK = SE.preValidate(stK, PEP_OK, 'Avançado', ANCHOR);
  ok(preK.length === 0, '(k) ancorado com achado no impresso-âncora: preValidate sem issue', J(preK));
  const wK = SE.softWarnings(stK, 'Avançado', ANCHOR).filter((w) => w.category === CAT);
  ok(wK.length === 1 && /Impresso-ancora "RADIOGRAFIA DE TÓRAX" contem linha de achado\/laudo/.test(wK[0].message)
     && /Aviso, não bloqueia \(decisão de 21\/11\)\.$/.test(wK[0].message), '(k) um aviso com a mensagem da âncora + "Aviso, não bloqueia"', J(wK));
  const auK = await SE.audit(stK, stubOK(), 'stub', PEP_OK, 'Avançado', ANCHOR);
  ok(auK.status === 'OK' && auK.passed === true && temCat(auK.warnings), '(k) audit() não reprova e traz o aviso', J([auK.status, auK.issues]));
  // (k2) as outras redes da âncora continuam HIGH
  const stK2 = JSON.parse(JSON.stringify(stK)); stK2.exams[1].image_credits = [null];
  ok(SE.preValidate(stK2, PEP_OK, 'Avançado', ANCHOR).some((i) => i.category === 'credito_desalinhado' && i.severity === 'high'), '(k2) credito_desalinhado continua high');
  const stK3 = JSON.parse(JSON.stringify(stK)); stK3.exams[1].images = [];
  ok(SE.preValidate(stK3, PEP_OK, 'Avançado', ANCHOR).some((i) => i.category === 'ancora_sem_imagem' && i.severity === 'high'), '(k3) ancora_sem_imagem continua high');

  console.log('\n=== ' + pass + ' OK / ' + fail + ' FAIL ===');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.log('ERRO ' + (e && e.stack || e)); process.exit(1); });
