// Testes da 1.4.6 — o roteiro do ator sempre responde alergia (decisão do Bruno, 16/11).
//  (a) estação sem chave de alergia em se_perguntado_sobre → preValidate devolve 'roteiro_sem_alergia'
//      (high, mensagem exata); também sem orientAtor e com se_perguntado_sobre vazio; audit() volta
//      FAIL sem chamar a IA;
//  (b) com a chave "alergias" → não devolve; audit() segue para a IA;
//  (c) com "alergia_medicamentosa" (e "Alergias", e orientAtor em string JSON) → não devolve: o casamento
//      é por /alergi/i no nome da chave;
//  (d) buildSys1 dos três níveis (e ancorado) tem "alergias" na lista "Cobrir" e o trecho da 1.4.6
//      exatamente uma vez; sem o trecho, idêntico à baseline 1.4.5;
//  (e) estação pediátrica com acompanhante: a regra continua valendo (sem chave reprova, com chave passa);
//      o trecho manda o acompanhante responder sobre a criança;
//  (f) buildSysAudit de cada nível (e ancorado) tem a linha nova em HIGH, junto de ESTRUTURA QUEBRADA,
//      e a checagem de coerência alergia × PEP continua lá.
// Sem IA: aiCall é um stub.
const fs = require('fs');
const vm = require('vm');
const P = require('./_paths');
const { semTrechoAlergia, TRECHO_NOVO } = require('./_alergia-1.4.6');
function load(p) { const c = {}; vm.createContext(c); vm.runInContext(fs.readFileSync(p, 'utf8'), c); return c.StationEngine; }
const SE = load(P.ENGINE);
const REF145 = load(P.base('1.4.5'));

let pass = 0, fail = 0;
function ok(cond, nome, extra) {
  if (cond) { pass++; console.log('OK   ' + nome); }
  else { fail++; console.log('FAIL ' + nome + (extra ? ' — ' + extra : '')); }
}
const J = (x) => JSON.stringify(x);
const CAT = 'roteiro_sem_alergia';
const MSG = 'Roteiro do ator sem chave de alergia em se_perguntado_sobre (regra 3 do gerador, 1.4.6).';
const PEP_OK = { ok: true, total: 10 };

function estacao(sps, extra) {
  return Object.assign({
    name: 'Dor abdominal em adulto jovem', orientMed: 'Atenda o paciente.', caso: 'Voce e medico em UBS.',
    local: 'UBS',
    orientAtor: { regra_fundamental: 'Voce e um paciente real que nao antecipa informacoes.', se_perguntado_sobre: sps },
    checklist: [{ id: '1', text: 'Anamnese', scores: [0, 0.5, 1], labels: ['a', 'b', 'c'], crit_adeq: 'x', crit_parc: 'y' }],
    exams: [{ title: 'EXAME FISICO', rows: ['PA: 120x80 mmHg'], images: [], trigger_keywords: ['exame fisico', 'fisico geral', 'sinais vitais'] }]
  }, extra || {});
}
const SPS_SEM = { queixa: 'Dor na barriga.', tempo_inicio: 'Desde ontem.', medicacoes: 'Nenhuma.', fumo: 'Nao fumo.' };
const comCat = (arr) => (arr || []).filter((i) => i.category === CAT);
let chamouIA = 0;
function stubOK() {
  return async function () {
    chamouIA++;
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: J({ status: 'OK', score: 9, issues: [] }) }] }) };
  };
}

(async function () {
  const VER = P.expect('1.4.6');
  ok(SE.ENGINE_VERSION === VER, 'ENGINE_VERSION = ' + VER, 'veio ' + SE.ENGINE_VERSION);

  // (a) sem chave de alergia
  for (const dif of ['Básico', 'Intermediário', 'Avançado']) {
    const pre = SE.preValidate(estacao(SPS_SEM), PEP_OK, dif);
    const c = comCat(pre);
    ok(c.length === 1, '(a) ' + dif + ': sem chave de alergia → 1 issue ' + CAT, J(pre));
    ok(c[0] && c[0].severity === 'high', '(a) ' + dif + ': severity high');
    ok(c[0] && c[0].message === MSG, '(a) ' + dif + ': mensagem exata', c[0] && c[0].message);
    ok(pre.length === 1, '(a) ' + dif + ': nenhuma outra issue na estação de teste', J(pre));
  }
  const stSemOA = estacao(SPS_SEM); delete stSemOA.orientAtor;
  ok(comCat(SE.preValidate(stSemOA, PEP_OK, 'Intermediário')).length === 1, '(a) sem orientAtor → ' + CAT);
  ok(comCat(SE.preValidate(estacao({}), PEP_OK, 'Intermediário')).length === 1, '(a) se_perguntado_sobre vazio → ' + CAT);
  ok(comCat(SE.preValidate(estacao({ queixa: 'Tenho alergia a dipirona.' }), PEP_OK, 'Intermediário')).length === 1,
     '(a) alergia só no texto de outra chave não conta: o casamento é no nome da chave');
  chamouIA = 0;
  const auA = await SE.audit(estacao(SPS_SEM), stubOK(), 'stub', PEP_OK, 'Intermediário');
  ok(auA.status === 'FAIL' && auA.passed === false && comCat(auA.issues).length === 1, '(a) audit() volta FAIL com ' + CAT, J([auA.status, auA.issues]));
  ok(chamouIA === 0, '(a) audit() reprova antes de chamar a IA (checagem determinística)');

  // (b) com "alergias"
  const stB = estacao(Object.assign({ alergias: 'Nao tenho alergia a remedio.' }, SPS_SEM));
  ok(comCat(SE.preValidate(stB, PEP_OK, 'Intermediário')).length === 0, '(b) com "alergias" → sem ' + CAT);
  ok(SE.preValidate(stB, PEP_OK, 'Intermediário').length === 0, '(b) estação de teste passa limpa');
  chamouIA = 0;
  const auB = await SE.audit(stB, stubOK(), 'stub', PEP_OK, 'Intermediário');
  ok(auB.status === 'OK' && auB.passed === true && chamouIA === 1, '(b) audit() segue para a IA e passa', J([auB.status, chamouIA]));

  // (c) variações do nome da chave
  for (const k of ['alergia_medicamentosa', 'Alergias', 'alergia', 'historico_alergico', 'ALERGIA_A_PENICILINA']) {
    const sps = Object.assign({}, SPS_SEM); sps[k] = 'Nao tenho.';
    ok(comCat(SE.preValidate(estacao(sps), PEP_OK, 'Avançado')).length === 0, '(c) chave "' + k + '" casa /alergi/i → sem ' + CAT);
  }
  const stStr = estacao(SPS_SEM, { orientAtor: J({ se_perguntado_sobre: { alergia_medicamentosa: 'Nao tenho.' } }) });
  ok(comCat(SE.preValidate(stStr, PEP_OK, 'Avançado')).length === 0, '(c) orientAtor em string JSON com chave de alergia → sem ' + CAT);
  const stStrSem = estacao(SPS_SEM, { orientAtor: J({ se_perguntado_sobre: SPS_SEM }) });
  ok(comCat(SE.preValidate(stStrSem, PEP_OK, 'Avançado')).length === 1, '(c) orientAtor em string JSON sem chave de alergia → ' + CAT);

  // (d) buildSys1 dos três níveis (e ancorado)
  const ANCHOR = SE.normalizeAnchor({
    image_file: 'exemplo_a1b2c3d4.png', modality: 'radiografia de tórax', incidence: 'PA',
    finding_truth: 'hipertransparência em hemitórax direito', diagnosis_truth: 'pneumotórax',
    area: 'Clínica Médica', image_credits: { license: 'CC BY 4.0', author: 'A', year: '2024' }
  });
  const ANCHOR145 = REF145.normalizeAnchor({
    image_file: 'exemplo_a1b2c3d4.png', modality: 'radiografia de tórax', incidence: 'PA',
    finding_truth: 'hipertransparência em hemitórax direito', diagnosis_truth: 'pneumotórax',
    area: 'Clínica Médica', image_credits: { license: 'CC BY 4.0', author: 'A', year: '2024' }
  });
  const sys1 = [
    ['Básico', SE.buildSys1('Clínica Médica', 'UBS', 'FEWSHOT', 'Básico'), REF145.buildSys1('Clínica Médica', 'UBS', 'FEWSHOT', 'Básico')],
    ['Intermediário', SE.buildSys1('Clínica Médica', 'UBS', 'FEWSHOT', 'Intermediário'), REF145.buildSys1('Clínica Médica', 'UBS', 'FEWSHOT', 'Intermediário')],
    ['Avançado', SE.buildSys1('Clínica Médica', 'UBS', 'FEWSHOT', 'Avançado'), REF145.buildSys1('Clínica Médica', 'UBS', 'FEWSHOT', 'Avançado')],
    ['ancorado', SE.buildSys1('Clínica Médica', 'Emergência', 'FEWSHOT', 'Avançado', ANCHOR), REF145.buildSys1('Clínica Médica', 'Emergência', 'FEWSHOT', 'Avançado', ANCHOR145)],
  ];
  for (const [nv, s, ref] of sys1) {
    const cobrir = s.slice(s.indexOf('     Cobrir:'), s.indexOf('topicos especificos do caso.'));
    ok(/\balergias\b/.test(cobrir), '(d) ' + nv + ': "alergias" na lista Cobrir', JSON.stringify(cobrir));
    ok(s.split(TRECHO_NOVO).length === 2, '(d) ' + nv + ': trecho da 1.4.6 exatamente uma vez');
    ok(semTrechoAlergia(s) === ref, '(d) ' + nv + ': sem o trecho, idêntico à 1.4.5');
  }
  ok(TRECHO_NOVO.indexOf('Nao tenho alergia a remedio.') >= 0, '(d) trecho traz o padrão "Nao tenho alergia a remedio."');
  ok(/alergia a penicilina/.test(TRECHO_NOVO) && /PEP paga por pergunta-la OU por escolher a alternativa/.test(TRECHO_NOVO),
     '(d) trecho: alergia que importa é declarada e paga no PEP');
  ok(SE.buildSys2() === REF145.buildSys2() && SE.buildSys2(ANCHOR) === REF145.buildSys2(ANCHOR145), '(d) buildSys2 idêntico à 1.4.5');

  // (e) pediatria com acompanhante
  const ped = {
    area: 'Pediatria', pNome: 'Joao', pIdade: 4, pGenero: 'Masculino', informante_tipo: 'acompanhante',
    acompNome: 'Maria', acompRelacao: 'Mae', acompGenero: 'Feminino'
  };
  const stE = estacao({ queixa: 'Ele esta com febre.', tempo_inicio: 'Desde ontem.' }, ped);
  stE.orientAtor.regra_fundamental = 'Voce e a Mae de Joao.';
  ok(comCat(SE.preValidate(stE, PEP_OK, 'Básico')).length === 1, '(e) pediatria/acompanhante sem chave de alergia → ' + CAT);
  const stE2 = estacao({ queixa: 'Ele esta com febre.', alergias: 'Ele nao tem alergia a remedio.' }, ped);
  ok(comCat(SE.preValidate(stE2, PEP_OK, 'Básico')).length === 0, '(e) pediatria/acompanhante com "alergias" → sem ' + CAT);
  const sysPed = SE.buildSys1('Pediatria', 'UBS', 'FEWSHOT', 'Básico');
  ok(sysPed.indexOf('Pediatria/acompanhante (regra 4): quem responde e o acompanhante, sobre a crianca') >= 0,
     '(e) buildSys1(Pediatria): o acompanhante responde sobre a criança');

  // (f) auditor
  const LINHA = '  - ESTRUTURA QUEBRADA: orientAtor sem chave de alergia em se_perguntado_sobre.';
  for (const [nv, s] of [['Básico', SE.buildSysAudit('Básico')], ['Intermediário', SE.buildSysAudit('Intermediário')],
                         ['Avançado', SE.buildSysAudit('Avançado')], ['ancorado', SE.buildSysAudit('Avançado', ANCHOR)]]) {
    const iHigh = s.indexOf('🔴 HIGH'), iMed = s.indexOf('🟡 MEDIUM'), iL = s.indexOf(LINHA);
    ok(iL > iHigh && iL < iMed, '(f) ' + nv + ': linha nova dentro de HIGH');
    ok(s.indexOf('  - ESTRUTURA QUEBRADA: orientAtor sem regra_fundamental ou se_perguntado_sobre vazio.\n' + LINHA) >= 0,
       '(f) ' + nv + ': logo depois de ESTRUTURA QUEBRADA');
    ok(s.indexOf('INCOERENCIA ORIENTATOR<->PEP (inversao clinica): os fatores de risco, comorbidades, alergias e') >= 0,
       '(f) ' + nv + ': coerência alergia × PEP continua');
    ok(s.replace(LINHA + '\n', '') === (nv === 'ancorado' ? REF145.buildSysAudit('Avançado', ANCHOR145) : REF145.buildSysAudit(nv)),
       '(f) ' + nv + ': sem a linha nova, idêntico à 1.4.5');
  }

  console.log('\n=== ' + pass + ' OK / ' + fail + ' FAIL ===');
  process.exit(fail ? 1 : 0);
})();
