// Testes da 1.2.0 (briefing modelos-geracao-lote §2): maxTokensAudit + auditor_truncado.
const fs = require('fs');
const vm = require('vm');
const P = require('./_paths');
function load(p) { const c = {}; vm.createContext(c); vm.runInContext(fs.readFileSync(p, 'utf8'), c); return c.StationEngine; }
const SE = load(P.ENGINE);
const OLD = load(P.base('1.1.0'));

let pass = 0, fail = 0;
function ok(cond, nome, extra) {
  if (cond) { pass++; console.log('OK   ' + nome); }
  else { fail++; console.log('FAIL ' + nome + (extra ? ' — ' + extra : '')); }
}

const VER = P.expect('1.3.0');
ok(SE.ENGINE_VERSION === VER, 'ENGINE_VERSION = ' + VER, 'veio ' + SE.ENGINE_VERSION);

// Estação mínima válida (passa no preValidate sem anchor)
const ST = {
  name: 'Dor abdominal em adulto jovem', orientMed: 'template', caso: 'Voce e medico em UBS.',
  checklist: [{ id: '1', text: 'Anamnese', scores: [0, 0.5, 1], labels: ['a','b','c'], crit_adeq: 'x', crit_parc: 'y' }],
  exams: [{ title: 'EXAME FISICO', rows: ['PA: 120x80 mmHg'], images: [], trigger_keywords: ['exame fisico','fisico geral','sinais vitais'] }]
};
const PEPOK = { ok: true, total: 10 };
function mkResp(text, stop) {
  return { ok: true, status: 200, json: () => Promise.resolve({ content: [{ type: 'text', text }], stop_reason: stop || 'end_turn' }) };
}

(async () => {
  // 1) default 4000 no orçamento do auditor
  let captured = null;
  await SE.audit(ST, async p => { captured = p; return mkResp('{"status":"OK","score":9,"issues":[]}'); }, 'claude-fable-5', PEPOK, 'Intermediário');
  ok(captured && captured.max_tokens === 4000, 'audit: default max_tokens=4000', 'veio ' + (captured && captured.max_tokens));

  // 2) configurável via parâmetro / opts.maxTokensAudit
  captured = null;
  await SE.audit(ST, async p => { captured = p; return mkResp('{"status":"OK","score":9,"issues":[]}'); }, 'claude-fable-5', PEPOK, 'Intermediário', null, 6000);
  ok(captured && captured.max_tokens === 6000, 'audit: maxTokensAudit=6000 respeitado', 'veio ' + (captured && captured.max_tokens));

  // 3) truncamento -> AUDIT_ERROR auditor_truncado (fail-closed, mensagem com o orçamento)
  const rTrunc = await SE.audit(ST, async () => mkResp('{"status":"OK","score":9,"issues":[{"severity":"high","cat', 'max_tokens'), 'claude-fable-5', PEPOK, 'Intermediário');
  ok(rTrunc.passed === false && rTrunc.status === 'AUDIT_ERROR' && rTrunc.issues[0].category === 'auditor_truncado' && /4000/.test(rTrunc.issues[0].message),
     'audit: stop_reason max_tokens -> auditor_truncado', JSON.stringify(rTrunc.issues));

  // 3b) PROVA DO BURACO FAIL-OPEN na v1.1.0 (cenario estreito porem real): status OK ja emitido,
  //     issues cortado no 2o item — o reparo do parseLoose descarta o item HIGH truncado e a
  //     v1.1.0 APROVA (issue high silenciosamente perdida); a v1.2.0 reprova com diagnostico.
  const TRUNC2 = '{"status":"OK","score":9,"issues":[{"severity":"medium","category":"pep","message":"x"},{"severity":"high","cat';
  const rOld = await OLD.audit(ST, async () => mkResp(TRUNC2, 'max_tokens'), 'claude-fable-5', PEPOK, 'Intermediário');
  ok(rOld.passed === true, '(prova) v1.1.0 aprovava audit truncado no 2o item de issues (high descartada)', JSON.stringify(rOld));
  const rNew2 = await SE.audit(ST, async () => mkResp(TRUNC2, 'max_tokens'), 'claude-fable-5', PEPOK, 'Intermediário');
  ok(rNew2.passed === false && rNew2.issues[0].category === 'auditor_truncado', '(prova) v1.2.0 reprova o mesmo payload com auditor_truncado', JSON.stringify(rNew2.issues));

  // 4) via generate: opts.maxTokensAudit propagado até a 3a chamada
  const CALL1 = JSON.stringify({ name: 'Febre em adulto', area: 'Clínica', caso: 'Voce e medico em UBS.', orientMed: 'template', complexity: 'medium', orientAtor: { regra_fundamental: 'x'.repeat(30), se_perguntado_sobre: { a: '1' } }, exams: [{ title: 'EXAME FÍSICO', rows: ['Temp: 38°C'], images: [], trigger_keywords: ['exame fisico','fisico','sinais vitais'] }] });
  const CALL2 = JSON.stringify([{ id: '1', text: 'Anamnese', subitens: '', scores: [0, 5, 10], labels: ['a','b','c'], crit_adeq: 'x', crit_parc: 'y' }]);
  let mts = [];
  const res = await SE.generate({
    aiCall: async p => { mts.push(p.max_tokens); return mkResp(mts.length === 1 ? CALL1 : (mts.length === 2 ? CALL2 : '{"status":"OK","score":9,"issues":[]}')); },
    pepPolicy: 'normalize', fewShotExamples: '', maxTokensAudit: 5000
  });
  ok(mts.length === 3 && mts[0] === 16000 && mts[1] === 8000 && mts[2] === 5000,
     'generate: orçamentos [16000, 8000, opts.maxTokensAudit]', JSON.stringify(mts));
  ok(res.audit.passed === true, 'generate: fluxo completo OK com orçamento customizado', JSON.stringify(res.audit.issues));

  // 5) generate sem opts.maxTokensAudit -> 4000 na auditoria
  mts = [];
  await SE.generate({
    aiCall: async p => { mts.push(p.max_tokens); return mkResp(mts.length === 1 ? CALL1 : (mts.length === 2 ? CALL2 : '{"status":"OK","score":9,"issues":[]}')); },
    pepPolicy: 'normalize', fewShotExamples: ''
  });
  ok(mts[2] === 4000, 'generate: default do auditor = 4000', JSON.stringify(mts));

  console.log('\n=== ' + pass + ' OK / ' + fail + ' FAIL ===');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
