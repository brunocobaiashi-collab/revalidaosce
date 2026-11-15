// Testes da 1.3.0 (briefing area-canonica-engine): chaves canônicas, lookup tolerante, canonArea.
const fs = require('fs');
const vm = require('vm');
const P = require('./_paths');
function load(p) { const c = {}; vm.createContext(c); vm.runInContext(fs.readFileSync(p, 'utf8'), c); return c.StationEngine; }
const SE = load(P.ENGINE);
const V12 = load(P.base('1.2.0'));

let pass = 0, fail = 0;
function ok(cond, nome, extra) {
  if (cond) { pass++; console.log('OK   ' + nome); }
  else { fail++; console.log('FAIL ' + nome + (extra ? ' — ' + extra : '')); }
}

const VER = P.expect('1.3.0');
ok(SE.ENGINE_VERSION === VER, 'ENGINE_VERSION = ' + VER, 'veio ' + SE.ENGINE_VERSION);

const CANON = ['Clínica Médica', 'Cirurgia Geral', 'Ginecologia e Obstetrícia', 'Pediatria', 'Medicina de Família e Comunidade'];

// 1) Chaves canônicas + arrays IDÊNTICOS aos da v1.2.0 (só as chaves mudaram).
//    A v1.2.0 não exporta TEMA_EIXOS: extraio o bloco dos dois fontes por regex.
function extractEixos(path) {
  const src = fs.readFileSync(path, 'utf8');
  const m = src.match(/var TEMA_EIXOS = \{([\s\S]*?)\n  \};/);
  const body = m[1];
  const out = {};
  for (const line of body.split('\n')) {
    const mm = line.match(/^\s*'([^']+)':\s*(\[.*\]),?\s*$/);
    if (mm) out[mm[1]] = JSON.parse(mm[2].replace(/'/g, '"'));
  }
  return out;
}
const oldEx = extractEixos(P.base('1.2.0'));
const newEx = extractEixos(P.ENGINE);
ok(JSON.stringify(Object.keys(newEx).sort()) === JSON.stringify(CANON.slice().sort()),
   'TEMA_EIXOS: exatamente as 5 chaves canônicas', JSON.stringify(Object.keys(newEx)));
const MAP = { 'Ginecologia': 'Ginecologia e Obstetrícia', 'Pediatria': 'Pediatria', 'Cirurgia': 'Cirurgia Geral', 'Clínica': 'Clínica Médica', 'Medicina de Família/Comunidade': 'Medicina de Família e Comunidade' };
let arraysOk = true;
for (const [k, v] of Object.entries(oldEx)) {
  if (JSON.stringify(newEx[MAP[k]]) !== JSON.stringify(v)) { arraysOk = false; console.log('  divergiu:', k); }
}
ok(arraysOk && Object.keys(oldEx).length === 5, 'TEMA_EIXOS: arrays de eixos byte-idênticos aos da v1.2.0');

// 2) eixosDaArea — canônica, legada, variantes, lixo
ok(SE.eixosDaArea('Cirurgia Geral').length > 0 && SE.eixosDaArea('Cirurgia Geral') === SE.eixosDaArea('Cirurgia'),
   'eixosDaArea: canônica e legada devolvem o MESMO array (Cirurgia)');
ok(SE.eixosDaArea('Clínica').length > 0 && JSON.stringify(SE.eixosDaArea('Clínica')) === JSON.stringify(newEx['Clínica Médica']),
   'eixosDaArea: legada Clínica → eixos de Clínica Médica');
ok(SE.eixosDaArea('Medicina de Família/Comunidade').length > 0, 'eixosDaArea: legada MFC com barra');
ok(SE.eixosDaArea('ginecologia').length > 0 && SE.eixosDaArea('GO — Obstetrícia').length > 0, 'eixosDaArea: caixa/variantes');
ok(SE.eixosDaArea('mfc').length > 0, 'eixosDaArea: abreviação mfc');
ok(SE.eixosDaArea('Dermatologia').length === 0 && SE.eixosDaArea('').length === 0, 'eixosDaArea: área exótica/vazia → []');

// 3) canonArea
ok(SE.canonArea('Cirurgia') === 'Cirurgia Geral' && SE.canonArea('Clínica') === 'Clínica Médica'
   && SE.canonArea('Medicina de Família/Comunidade') === 'Medicina de Família e Comunidade'
   && SE.canonArea('Ginecologia') === 'Ginecologia e Obstetrícia' && SE.canonArea('Pediatria') === 'Pediatria',
   'canonArea: 5 legadas → 5 canônicas');
ok(SE.canonArea('Clínica Médica') === 'Clínica Médica', 'canonArea: canônica passa intacta');
ok(SE.canonArea('Dermatologia') === 'Dermatologia' && SE.canonArea('') === '', 'canonArea: exótica/vazia intactas (não inventa)');

const CALL1 = JSON.stringify({ name: 'Febre em adulto', area: 'Clínica', caso: 'Voce e medico em UBS.', orientMed: 'template', complexity: 'medium', orientAtor: { regra_fundamental: 'x'.repeat(30), se_perguntado_sobre: { a: '1' } }, exams: [{ title: 'EXAME FÍSICO', rows: ['Temp: 38°C'], images: [], trigger_keywords: ['exame fisico','fisico','sinais vitais'] }] });
const CALL2 = JSON.stringify([{ id: '1', text: 'Anamnese', subitens: '', scores: [0, 5, 10], labels: ['a','b','c'], crit_adeq: 'x' }]);
function mkResp(text) { return { ok: true, status: 200, json: () => Promise.resolve({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }) }; }
function stubFactory(msgs) {
  let n = 0;
  return async p => { n++; msgs.push(p); return mkResp(n === 1 ? CALL1 : (n === 2 ? CALL2 : '{"status":"OK","score":9,"issues":[]}')); };
}

(async () => {
  // 4) generate com área LEGADA → prompt recebe canônica + tema sorteado dos eixos certos
  let calls = [];
  await SE.generate({ area: 'Cirurgia', aiCall: stubFactory(calls), pepPolicy: 'normalize', fewShotExamples: '' });
  const msg1 = calls[0].messages[0].content;
  ok(/Area: Cirurgia Geral\. /.test(msg1), 'generate: área legada canonicalizada no msg1', msg1.slice(0, 90));
  ok(calls[0].system.indexOf('Area: Cirurgia Geral') >= 0, 'generate: sys1 com área canônica', calls[0].system.split('\n').pop());
  ok(/Eixo tematico sorteado/.test(msg1), 'generate: sorteio de eixo FUNCIONOU com grafia legada (o modo de falha silenciosa)', msg1.slice(0, 200));
  const eixoOk = newEx['Cirurgia Geral'].some(e => msg1.indexOf(e) >= 0);
  ok(eixoOk, 'generate: eixo sorteado pertence aos eixos de Cirurgia Geral');

  // 4b) v1.2.0 (prova do acoplamento): 'Cirurgia Geral' canônica NÃO sorteava eixo
  let callsOld = [];
  await V12.generate({ area: 'Cirurgia Geral', aiCall: stubFactory(callsOld), pepPolicy: 'normalize', fewShotExamples: '' });
  ok(!/Eixo tematico sorteado/.test(callsOld[0].messages[0].content),
     '(prova) v1.2.0 com área canônica: sorteio de eixo morria silenciosamente');

  // 5) Caminho "Aleatória": área sorteada é canônica (10 rodadas)
  let todasCanon = true;
  for (let i = 0; i < 10; i++) {
    let cs = [];
    await SE.generate({ aiCall: stubFactory(cs), pepPolicy: 'normalize', fewShotExamples: '' });
    const m = cs[0].messages[0].content.match(/^Crie uma NOVA estacao OSCE no padrao INEP\. Area: ([^.]+)\. /);
    if (!m || CANON.indexOf(m[1]) < 0) { todasCanon = false; console.log('  área sorteada fora do canônico:', m && m[1]); break; }
  }
  ok(todasCanon, 'generate "Aleatória": 10/10 áreas sorteadas canônicas');

  // 6) Modo ancorado: área obrigatória continua (throw preservado) e anchor.area legada canonicaliza
  const CRED = { license: 'CC BY 4.0' };
  const ANC = { image_file: 'x.png', modality: 'radiografia de tórax', incidence: 'PA', finding_truth: 'ft', diagnosis_truth: 'dt', area: '', image_credits: CRED };
  try { await SE.generate({ imageAnchor: ANC, aiCall: async () => mkResp('{}') }); ok(false, 'ancorado sem área deveria lançar'); }
  catch (e) { ok(/informe a area/.test(e.message), 'ancorado: throw de área obrigatória preservado'); }
  let cs2 = [];
  let n2 = 0;
  const resA = await SE.generate({
    imageAnchor: Object.assign({}, ANC, { area: 'Clínica' }),
    aiCall: async p => { n2++; cs2.push(p); return mkResp(n2 === 1 ? CALL1 : (n2 === 2 ? JSON.stringify([{ id: '1', text: 'Interpreta a radiografia de tórax e reconhece o achado', scores: [0, 5, 10], labels: ['a','b','c'], crit_adeq: 'x' }]) : '{"status":"OK","score":9,"issues":[]}')); },
    pepPolicy: 'normalize', fewShotExamples: ''
  });
  ok(cs2[0].messages[0].content.indexOf('Area: Clínica Médica.') >= 0 && resA.station.complexity === 'advanced',
     'ancorado: anchor.area legada canonicalizada + advanced preservado');
  ok(!/Eixo tematico sorteado/.test(cs2[0].messages[0].content), 'ancorado: segue SEM sorteio de tema');

  console.log('\n=== ' + pass + ' OK / ' + fail + ' FAIL ===');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
