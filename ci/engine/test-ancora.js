// Testes funcionais do MODO AVANCADA ANCORADA EM IMAGEM (1.1.0 em diante).
const fs = require('fs');
const vm = require('vm');
const P = require('./_paths');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(P.ENGINE, 'utf8'), ctx);
const SE = ctx.StationEngine;

let pass = 0, fail = 0;
function ok(cond, nome, extra) {
  if (cond) { pass++; console.log('OK   ' + nome); }
  else { fail++; console.log('FAIL ' + nome + (extra ? ' — ' + extra : '')); }
}

const CRED = { pmcid: 'PMC123', license: 'CC BY 4.0', source_url: 'https://x', author: 'A', year: '2024' };
const ANCHOR = {
  image_file: 'chest_xray_pneumothorax_a1b2c3d4.png',
  modality: 'radiografia de tórax',
  incidence: 'PA / ântero-posterior',
  finding_truth: 'hipertransparência em hemitórax direito, ausência de trama vascular periférica, desvio contralateral do mediastino',
  diagnosis_truth: 'pneumotórax hipertensivo à direita',
  area: 'Clínica Médica',
  image_credits: CRED
};

// ── 1) normalizeAnchor ──────────────────────────────────────────────────────
const VER = P.expect('1.3.0');
ok(SE.ENGINE_VERSION === VER, 'ENGINE_VERSION exportado = ' + VER, 'veio ' + SE.ENGINE_VERSION);
ok(SE.normalizeAnchor(null) === null && SE.normalizeAnchor(undefined) === null, 'normalizeAnchor: ausente → null');
try { SE.normalizeAnchor({ modality: 'rx' }); ok(false, 'normalizeAnchor: incompleto deve lançar'); }
catch (e) {
  ok(/image_file/.test(e.message) && /finding_truth/.test(e.message) && /diagnosis_truth/.test(e.message) && /image_credits/.test(e.message),
     'normalizeAnchor: erro lista os campos faltantes', e.message);
}
try { SE.normalizeAnchor(Object.assign({}, ANCHOR, { image_credits: { pmcid: 'x' } })); ok(false, 'credits sem license deve lançar'); }
catch (e) { ok(/license/.test(e.message), 'normalizeAnchor: credits sem license lança', e.message); }
const na = SE.normalizeAnchor(Object.assign({}, ANCHOR, { image_credits: [CRED] })); // array de 1 tolerado
ok(na.image_credits === CRED, 'normalizeAnchor: image_credits como array de 1 é desembrulhado');
ok(na.image_file === ANCHOR.image_file && na.area === 'Clínica Médica', 'normalizeAnchor: campos normalizados');

// ── 2) enforceAnchorImpresso ────────────────────────────────────────────────
const anc = SE.normalizeAnchor(ANCHOR);
// Caso A: modelo criou o impresso de imagem com achado vazado + imagem inventada em outro exam
const baseA = {
  exams: [
    { title: 'EXAME FÍSICO', rows: ['PA: 90x60 mmHg', 'FC: 128 bpm'], images: ['foto_inventada.png'], image_credits: [null] },
    { title: 'RADIOGRAFIA DE TÓRAX', rows: ['Radiografia de tórax PA', 'Achado: hipertransparência em hemitórax direito'], images: [], trigger_keywords: ['radiografia'] }
  ]
};
SE.enforceAnchorImpresso(baseA, anc);
const exA = baseA.exams[1];
ok(exA.images.length === 1 && exA.images[0] === anc.image_file, 'enforce: images=[image_file] exato');
ok(Array.isArray(exA.image_credits) && exA.image_credits.length === 1 && exA.image_credits[0] === CRED, 'enforce: image_credits alinhado por índice');
ok(exA.rows.length === 1 && /^Radiografia de tórax, incidência PA/.test(exA.rows[0]) && !/achado/i.test(exA.rows[0]),
   'enforce: rows reescrito = só técnica/incidência (achado eliminado)', JSON.stringify(exA.rows));
ok(exA.trigger_keywords.length >= 3 && exA.trigger_keywords.indexOf('radiografia') >= 0 && exA.trigger_keywords.indexOf('raio x') >= 0,
   'enforce: keywords mescladas (modelo + defaults por modalidade)', JSON.stringify(exA.trigger_keywords));
ok(baseA.exams[0].images.length === 0 && baseA.exams[0].image_credits.length === 0,
   'enforce: imagem inventada no exame físico foi removida');

// Caso B: modelo omitiu o impresso de imagem → engine cria
const baseB = { exams: [{ title: 'EXAME FÍSICO', rows: ['Temp: 38°C'] }] };
SE.enforceAnchorImpresso(baseB, anc);
ok(baseB.exams.length === 2 && baseB.exams[1].title === 'RADIOGRAFIA DE TÓRAX' && baseB.exams[1].images[0] === anc.image_file,
   'enforce: impresso-âncora criado quando o modelo omite', JSON.stringify(baseB.exams[1]));

// Caso C: modelo copiou o arquivo corretamente → localizado pela via 1
const baseC = { exams: [{ title: 'IMPRESSO 2', rows: ['linha'], images: [anc.image_file] }] };
SE.enforceAnchorImpresso(baseC, anc);
ok(baseC.exams.length === 1 && baseC.exams[0].rows.length === 1 && /incidência/.test(baseC.exams[0].rows[0]),
   'enforce: localização por image_file (título genérico não atrapalha)');

// ── 3) preValidate — redes do modo ancorado ─────────────────────────────────
function mkStation(over) {
  return Object.assign({
    name: 'Dispneia em adulto', orientMed: '(1) realize a anamnese...', caso: 'Voce e medico no pronto-socorro.',
    orientAtor: { se_perguntado_sobre: { alergias: 'Nao tenho alergia a remedio.' } }, // 1.4.6: estacao valida tem a chave de alergia
    checklist: [
      { id: '1', text: 'Anamnese', subitens: '', scores: [0, 0.5, 1], labels: ['a','b','c'], crit_adeq: 'realiza os 3', crit_parc: 'realiza 1-2' },
      { id: '2', text: 'Interpreta a radiografia de tórax e reconhece o achado', subitens: '', scores: [0, 1, 2], labels: ['a','b','c'], crit_adeq: 'descreve hipertransparência e conclui', crit_parc: 'descreve sem concluir' }
    ],
    exams: [
      { title: 'EXAME FÍSICO', rows: ['PA: 90x60 mmHg'], images: [], trigger_keywords: ['exame fisico','fisico geral','sinais vitais'] },
      { title: 'RADIOGRAFIA DE TÓRAX', rows: ['Radiografia de tórax, incidência PA / ântero-posterior.'], images: [ANCHOR.image_file], image_credits: [CRED], trigger_keywords: ['radiografia','raio x','exame de imagem','radiografia de torax'] }
    ]
  }, over || {});
}
function cats(issues) { return issues.map(i => i.category).sort().join(','); }

// 3a) estação correta → nenhuma issue ancorada
let iss = SE.preValidate(mkStation(), { ok: true, total: 10 }, 'Avançado', anc);
ok(iss.length === 0, 'preValidate ancorado: estação correta passa limpa', cats(iss));

// 3b) sem item de interpretação → pep_sem_interpretacao
const stB = mkStation(); stB.checklist = [stB.checklist[0]];
iss = SE.preValidate(stB, { ok: true, total: 10 }, 'Avançado', anc);
ok(iss.some(i => i.category === 'pep_sem_interpretacao'), 'preValidate: pep_sem_interpretacao (high)', cats(iss));

// 3c) créditos desalinhados (null) → credito_desalinhado
const stC = mkStation(); stC.exams[1].image_credits = [null];
iss = SE.preValidate(stC, { ok: true, total: 10 }, 'Avançado', anc);
ok(iss.some(i => i.category === 'credito_desalinhado'), 'preValidate: credito_desalinhado com null', cats(iss));
const stC2 = mkStation(); delete stC2.exams[1].image_credits;
iss = SE.preValidate(stC2, { ok: true, total: 10 }, 'Avançado', anc);
ok(iss.some(i => i.category === 'credito_desalinhado'), 'preValidate: credito_desalinhado com ausente', cats(iss));

// 3d) achado no impresso-âncora → desde a 1.4.5 (decisão do Bruno, 21/11) é aviso, não issue
const stD = mkStation(); stD.exams[1].rows.push('Achado: hipertransparência em hemitórax direito');
iss = SE.preValidate(stD, { ok: true, total: 10 }, 'Avançado', anc);
ok(iss.length === 0, 'preValidate: achado no impresso-âncora não reprova (1.4.5)', cats(iss));
ok(SE.softWarnings(stD, 'Avançado', anc).some(w => w.category === 'impresso_fora_do_nivel'),
   'softWarnings: achado no impresso-âncora vira impresso_fora_do_nivel (1.4.5)');

// 3e) segundo impresso de imagem → segundo_impresso_imagem
const stE = mkStation(); stE.exams.push({ title: 'ULTRASSONOGRAFIA DE TÓRAX', rows: ['linhas B ausentes'], images: [], trigger_keywords: ['ultrassom','ultrassonografia','exame de imagem'] });
iss = SE.preValidate(stE, { ok: true, total: 10 }, 'Avançado', anc);
ok(iss.some(i => i.category === 'segundo_impresso_imagem'), 'preValidate: segundo_impresso_imagem', cats(iss));

// 3f) âncora sumiu dos exams → ancora_sem_imagem
const stF = mkStation(); stF.exams[1].images = [];
iss = SE.preValidate(stF, { ok: true, total: 10 }, 'Avançado', anc);
ok(iss.some(i => i.category === 'ancora_sem_imagem'), 'preValidate: ancora_sem_imagem', cats(iss));

// ── 4) prompts ancorados contêm o gabarito ──────────────────────────────────
const s1 = SE.buildSys1('Clínica Médica', 'Emergência', 'FEWSHOT', 'Avançado', anc);
ok(s1.indexOf(anc.finding_truth) >= 0 && s1.indexOf(anc.image_file) >= 0 && s1.indexOf('MODO AVANCADA ANCORADA') >= 0,
   'buildSys1 ancorado: gabarito + image_file + bloco presente');
ok(s1.indexOf('PREVALECE') >= 0, 'buildSys1 ancorado: cláusula PREVALECE (vence GEN_DIFF_RUBRIC do wrapper)');
const s2 = SE.buildSys2(anc);
ok(s2.indexOf(anc.finding_truth) >= 0 && s2.indexOf('ITEM DE INTERPRETACAO DA IMAGEM') >= 0 && s2.indexOf('medida quantitativa') >= 0,
   'buildSys2 ancorado: item anti-Type-B com gabarito e proibições');
const sa = SE.buildSysAudit('Avançado', anc);
ok(sa.indexOf(anc.diagnosis_truth) >= 0 && sa.indexOf('NAO reporte "PEP cobra interpretar imagem sem laudo"') >= 0,
   'buildSysAudit ancorado: gabarito + instrução anti-falso-Type-B');

// ── 5) generate end-to-end (aiCall stubado) ─────────────────────────────────
const CALL1_JSON = JSON.stringify({
  name: 'Dispneia súbita em adulto jovem', area: 'Clínica Médica', nivel: 'Emergência',
  local: 'Pronto-Socorro', infra: 'sala de emergência equipada',
  caso: 'Voce e medico no pronto-socorro. Atendera homem de 28 anos com queixa de falta de ar.',
  orientMed: '(1) realize a anamnese; (2) realize o exame fisico pertinente; (3) solicite exames complementares se necessario; (4) elabore hipotese diagnostica; (5) defina a conduta; (6) oriente o paciente/acompanhante.',
  complexity: 'medium', // errado de propósito — engine deve forçar advanced
  pNome: 'Carlos', pIdade: 28, pGenero: 'Masculino', pProf: 'estudante', pCivil: 'solteiro', pQueixa: 'falta de ar súbita',
  informante_tipo: 'paciente',
  orientAtor: {
    regra_fundamental: 'Voce e um paciente real com falta de ar subita e dor no peito ha 1 hora.',
    fala_inicial_espontanea: 'Doutor, do nada me deu uma falta de ar muito forte.',
    tom_emocional: 'ansioso, assustado',
    se_perguntado_sobre: { queixa: 'falta de ar', tempo_inicio: 'ha 1 hora', dor: 'dor no peito direito', febre: 'nao', tosse: 'nao', antecedentes_pessoais: 'nenhum', medicacoes: 'nenhuma', fumo: 'fumo 10 cigarros por dia', alcool: 'socialmente', alergias: 'nenhuma', cirurgias: 'nenhuma', viagem: 'nao', trauma: 'nao', esforco: 'estava em repouso' },
    nao_falar_espontaneamente: ['tabagismo', 'dor pleuritica', 'tempo exato', 'antecedentes'],
    se_perguntado_sobre_exame_fisico: 'Caso solicite exame fisico, entregue o IMPRESSO 1 — EXAME FISICO. Caso solicite exame de imagem (radiografia), entregue o IMPRESSO 2 — RADIOGRAFIA DE TORAX.'
  },
  exams: [
    { title: 'EXAME FÍSICO', trigger_keywords: ['exame fisico','fisico geral','sinais vitais','ausculta pulmonar'], rows: ['PA: 90x60 mmHg', 'FC: 128 bpm', 'FR: 32 irpm', 'SatO2: 86%', 'Ausculta: murmúrio vesicular abolido à direita', 'Traqueia desviada à esquerda', 'Turgência jugular presente'], images: [] },
    { title: 'RADIOGRAFIA DE TÓRAX', trigger_keywords: ['radiografia'], rows: ['Radiografia de tórax PA', 'Achado: hipertransparência à direita com desvio do mediastino'], images: [] } // achado vazado de propósito — enforce deve limpar
  ]
});
const CALL2_JSON = JSON.stringify([
  { id: '1', text: 'Apresentação', subitens: '(1) identifica-se\n(2) cumprimenta', scores: [0, 0.25, 0.5], labels: ['Inadequado','Parcialmente adequado','Adequado'], crit_adeq: 'realiza as duas', crit_parc: 'realiza uma', crit_inad: 'nenhuma' },
  { id: '2', text: 'Anamnese dirigida', subitens: '(1) inicio subito\n(2) dor toracica\n(3) tabagismo\n(4) dispneia', scores: [0, 1.0, 2.0], labels: ['Inadequado','Parcialmente adequado','Adequado'], crit_adeq: 'investiga os 4', crit_parc: 'investiga 2-3', crit_inad: '0-1' },
  { id: '3', text: 'Solicita exame físico dirigido', subitens: '', scores: [0, 1.0], labels: ['Inadequado','Adequado'], crit_adeq: 'solicita', crit_inad: 'nao solicita' },
  { id: '4', text: 'Reconhece sinais de instabilidade', subitens: '', scores: [0, 0.5, 1.0], labels: ['Inadequado','Parcialmente adequado','Adequado'], crit_adeq: 'reconhece hipotensao+hipoxemia', crit_parc: 'um dos dois', crit_inad: 'nenhum' },
  { id: '5', text: 'Solicita radiografia de tórax', subitens: '', scores: [0, 1.0], labels: ['Inadequado','Adequado'], crit_adeq: 'solicita', crit_inad: 'nao solicita' },
  { id: '6', text: 'Interpreta a radiografia de tórax e reconhece o achado', subitens: '', scores: [0, 1.0, 2.0], labels: ['Inadequado','Parcialmente adequado','Adequado'], crit_adeq: 'descreve hipertransparência com desvio contralateral do mediastino E conclui pela hipótese compatível', crit_parc: 'descreve o achado sem concluir', crit_inad: 'não interpreta' },
  { id: '7', text: 'Hipótese diagnóstica', subitens: '', scores: [0, 0.75, 1.5], labels: ['Inadequado','Parcialmente adequado','Adequado'], crit_adeq: 'conclui pela hipótese correta', crit_parc: 'hipótese parcial', crit_inad: 'errada' },
  { id: '8', text: 'Conduta imediata', subitens: '', scores: [0, 0.75, 1.5], labels: ['Inadequado','Parcialmente adequado','Adequado'], crit_adeq: 'institui descompressão imediata', crit_parc: 'conduta parcial', crit_inad: 'errada' },
  { id: '9', text: 'Orientação ao paciente', subitens: '', scores: [0, 0.5], labels: ['Inadequado','Adequado'], crit_adeq: 'orienta', crit_inad: 'nao orienta' }
]);
// soma: 0.5+2+1+1+1+2+1.5+1.5+0.5 = 11 → policy normalize ajusta p/ 10 (também testamos isso)
const AUDIT_JSON = JSON.stringify({ status: 'OK', score: 9, issues: [] });

function mkResp(text) {
  return { ok: true, status: 200, json: () => Promise.resolve({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }) };
}
let callN = 0; const sysCapturados = [];
async function aiCallStub(params) {
  callN++;
  sysCapturados.push(params.system || '');
  if (callN === 1) return mkResp(CALL1_JSON);
  if (callN === 2) return mkResp(CALL2_JSON);
  return mkResp(AUDIT_JSON);
}

(async () => {
  const res = await SE.generate({
    area: '', tema: '', nivel: 'Emergência', dificuldade: 'Intermediário', // errado de propósito — anchor força Avançado
    imageAnchor: ANCHOR,
    fewShotExamples: 'FEWSHOT',
    aiCall: aiCallStub, pepPolicy: 'normalize',
    modelGen: 'claude-opus-4-8', modelAudit: 'claude-opus-4-8'
  });
  const st = res.station;
  ok(st.complexity === 'advanced', 'generate: complexity forçada advanced (modelo devolveu medium)');
  ok(st.trial_available === false, 'generate: trial_available=false (proteção de IP)');
  ok(res.imageAnchor && res.imageAnchor.finding_truth === anc.finding_truth, 'generate: imageAnchor no retorno p/ o wrapper');
  const rx = st.exams.find(e => /RADIOGRAFIA/.test(e.title));
  ok(rx && rx.images[0] === ANCHOR.image_file && rx.image_credits[0] === CRED, 'generate: impresso-âncora com imagem+crédito');
  ok(rx.rows.length === 1 && !/achado/i.test(rx.rows[0]), 'generate: achado vazado pela Call 1 foi eliminado', JSON.stringify(rx.rows));
  ok(rx.trigger_keywords.length >= 4, 'generate: keywords do impresso-âncora completadas');
  const soma = SE.pepTotal(st.checklist);
  ok(Math.abs(soma - 10) <= 0.01, 'generate: PEP normalizado soma 10.0', 'soma=' + soma);
  ok(res.audit.passed === true && res.audit.status === 'OK', 'generate: auditoria OK (preValidate ancorado passou)', JSON.stringify(res.audit.issues));
  ok(/MODO AVANCADA ANCORADA/.test(sysCapturados[0]) && sysCapturados[0].indexOf(anc.finding_truth) >= 0 && sysCapturados[0].indexOf(anc.image_file) >= 0,
     'generate: sys1 da Call 1 continha o bloco ancorado com gabarito');
  ok(sysCapturados[1].indexOf('ITEM DE INTERPRETACAO DA IMAGEM') >= 0, 'generate: sys2 da Call 2 com item anti-Type-B');
  ok(sysCapturados[2].indexOf('ESTACAO ANCORADA EM IMAGEM') >= 0, 'generate: sysAudit da auditoria com regras do tier');
  // área obrigatória: sem opts.area, veio do anchor.area (sem sorteio)
  ok(callN === 3, 'generate: 3 chamadas (caso, PEP, auditoria)');

  // 5b) fail-fast: âncora incompleta aborta antes de gastar tokens
  let chamou = 0;
  try {
    await SE.generate({ imageAnchor: { modality: 'rx' }, aiCall: async () => { chamou++; return mkResp('{}'); } });
    ok(false, 'generate: âncora incompleta deveria lançar');
  } catch (e) {
    ok(chamou === 0 && /imageAnchor incompleto/.test(e.message), 'generate: fail-fast sem gastar tokens', e.message);
  }

  // 5c) área obrigatória no modo ancorado
  try {
    await SE.generate({ imageAnchor: Object.assign({}, ANCHOR, { area: '' }), aiCall: async () => mkResp('{}') });
    ok(false, 'generate: modo ancorado sem área deveria lançar');
  } catch (e) {
    ok(/informe a area/.test(e.message), 'generate: área obrigatória no modo ancorado', e.message);
  }

  // 5d) sem âncora: fluxo normal segue funcionando (sorteio de área/tema)
  callN = 0; sysCapturados.length = 0;
  const CALL1_SIMPLES = JSON.stringify({ name: 'Febre em adulto', area: 'Clínica', caso: 'Voce e medico em UBS.', orientMed: 'template', complexity: 'medium', orientAtor: { regra_fundamental: 'x'.repeat(30), se_perguntado_sobre: { a: '1', alergias: 'nenhuma' } }, exams: [{ title: 'EXAME FÍSICO', rows: ['Temp: 38°C'], images: [], trigger_keywords: ['exame fisico','fisico','sinais vitais'] }] });
  let n2 = 0;
  const res2 = await SE.generate({
    aiCall: async () => { n2++; return mkResp(n2 === 1 ? CALL1_SIMPLES : (n2 === 2 ? CALL2_JSON : AUDIT_JSON)); },
    pepPolicy: 'normalize', fewShotExamples: ''
  });
  ok(res2.station && res2.station.complexity === 'medium' && res2.imageAnchor === undefined,
     'generate sem âncora: fluxo intacto, imageAnchor=undefined');

  console.log('\n=== ' + pass + ' OK / ' + fail + ' FAIL ===');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
