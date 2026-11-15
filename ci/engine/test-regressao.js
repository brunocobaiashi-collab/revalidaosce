// Regressão dos prompts SEM imageAnchor: buildSys1/buildSys2/buildSysAudit e o
// preValidate de uma estação de exemplo têm de sair byte a byte idênticos aos da
// referência.
//
// Parte A — referência = última versão publicada (baselines/station-engine.1.4.2.js).
//   Divergência só é aceita se a função estiver em PERMITIDAS, com a versão e o
//   motivo. Mudar prompt exige pedido explícito do Bruno; a entrada em PERMITIDAS
//   é a prova, no diff do pull request, de que a mudança foi intencional.
//   Quando a versão nova for publicada, a baseline dela entra em baselines/ e a
//   lista volta a ficar vazia.
//
// Parte B — histórica: Intermediário e Avançado sem âncora seguem idênticos ao
//   arquivo anterior à 1.1.0 (d0e4f62) no buildSys1 e no buildSysAudit. O Básico
//   mudou de propósito na 1.4.0 (11/08) e o buildSys2 na 1.4.1/1.4.2 (15/11, bloco
//   do binário conjuntivo, aprovado pelo Bruno): os dois ficam fora desta parte. O
//   buildSys2 continua provado como "1.4.0 + o bloco, e nada além" em
//   test-binario-conjuntivo.js.
//
// Parte A também compara os três prompts ANCORADOS (1.4.3). A chave do ancorado é
//   separada ('buildSys2(ancorado)'): permitir o ancorado não afrouxa o sem âncora.
const fs = require('fs');
const vm = require('vm');
const P = require('./_paths');

function load(path) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx);
  return ctx.StationEngine;
}

// Ex.: { 'buildSys2()': '1.4.1 — regra do binário conjuntivo (pedido do Bruno, dd/mm)' }
const PERMITIDAS = {
  'buildSys2(ancorado)': '1.4.3 — item de interpretação: crit_adeq conclui pelo diagnosis_truth com o mesmo nome; proibido juntar diagnósticos distintos com "/" ou "ou" (aprovado pelo Bruno em 15/11)',
};

const REF = load(P.base('1.4.2'));
const PRE = load(P.base('pre-1.1.0'));
const NEW = load(P.ENGINE);

let fails = 0;
let permitidas = 0;
function cmp(nome, a, b, lista) {
  if (a === b) { console.log('OK   ' + nome + ' (idêntico, ' + a.length + ' chars)'); return; }
  if (lista && lista[nome]) {
    permitidas++;
    console.log('PERM ' + nome + ' — divergência permitida: ' + lista[nome]);
    return;
  }
  fails++;
  console.log('DIFF ' + nome + ' — ref ' + a.length + ' chars vs novo ' + b.length + ' chars');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.log('  1a divergência no char ' + i + ':');
      console.log('  REF:  ...' + JSON.stringify(a.slice(Math.max(0, i - 40), i + 60)));
      console.log('  NOVO: ...' + JSON.stringify(b.slice(Math.max(0, i - 40), i + 60)));
      break;
    }
  }
}

const casos = [
  ['Clínica Médica', 'Emergência', 'EXEMPLO FEWSHOT XYZ', 'Intermediário'],
  ['Ginecologia e Obstetrícia', 'UBS', '', 'Avançado'],
  ['Pediatria', '', null, 'Básico'],
  ['', '', undefined, ''],
];
const difsAudit = ['Intermediário', 'Avançado', 'Básico', '', 'medium'];

// Estação de exemplo válida para o preValidate da 1.4.x (3 faixas com crit_parc).
const st = {
  name: 'Dor abdominal em adulto jovem', orientMed: 'template', caso: 'Voce e medico em UBS.',
  checklist: [{ id: '1', text: 'Anamnese', scores: [0, 0.5, 1], labels: ['a','b','c'], crit_adeq: 'x', crit_parc: 'y' }],
  exams: [{ title: 'EXAME FISICO', rows: ['PA: 120x80 mmHg'], images: [], trigger_keywords: ['exame fisico','fisico geral','sinais vitais'] }]
};

console.log('--- Parte A: contra a 1.4.2 publicada ---');
for (const [area, nivel, few, dif] of casos) {
  cmp('buildSys1(' + JSON.stringify([area, nivel, dif]) + ')',
      REF.buildSys1(area, nivel, few, dif), NEW.buildSys1(area, nivel, few, dif), PERMITIDAS);
}
cmp('buildSys2()', REF.buildSys2(), NEW.buildSys2(), PERMITIDAS);
for (const dif of difsAudit) {
  cmp('buildSysAudit(' + JSON.stringify(dif) + ')', REF.buildSysAudit(dif), NEW.buildSysAudit(dif), PERMITIDAS);
}
const ANCHOR = {
  image_file: 'exemplo_a1b2c3d4.png', modality: 'radiografia de tórax', incidence: 'PA',
  finding_truth: 'hipertransparência em hemitórax direito', diagnosis_truth: 'pneumotórax',
  area: 'Clínica Médica', image_credits: { license: 'CC BY 4.0', author: 'A', year: '2024' }
};
const ancRef = REF.normalizeAnchor(ANCHOR), ancNew = NEW.normalizeAnchor(ANCHOR);
cmp('buildSys1(ancorado)', REF.buildSys1('Clínica Médica', 'Emergência', 'FEWSHOT', 'Avançado', ancRef),
    NEW.buildSys1('Clínica Médica', 'Emergência', 'FEWSHOT', 'Avançado', ancNew), PERMITIDAS);
cmp('buildSys2(ancorado)', REF.buildSys2(ancRef), NEW.buildSys2(ancNew), PERMITIDAS);
cmp('buildSysAudit(ancorado)', REF.buildSysAudit('Avançado', ancRef), NEW.buildSysAudit('Avançado', ancNew), PERMITIDAS);
cmp('preValidate(sem anchor)',
    JSON.stringify(REF.preValidate(st, { ok: true, total: 10 }, 'Intermediário')),
    JSON.stringify(NEW.preValidate(st, { ok: true, total: 10 }, 'Intermediário')), PERMITIDAS);

console.log('--- Parte B: Intermediário e Avançado contra o arquivo anterior à 1.1.0 ---');
for (const [area, nivel, few, dif] of casos) {
  if (dif === 'Básico' || dif === '') continue;
  cmp('pre: buildSys1(' + JSON.stringify([area, nivel, dif]) + ')',
      PRE.buildSys1(area, nivel, few, dif), NEW.buildSys1(area, nivel, few, dif), PERMITIDAS_PRE());
}
for (const dif of ['Intermediário', 'Avançado']) {
  cmp('pre: buildSysAudit(' + JSON.stringify(dif) + ')', PRE.buildSysAudit(dif), NEW.buildSysAudit(dif), PERMITIDAS_PRE());
}

// Na parte B, uma função permitida na parte A também é aceita (o mesmo motivo vale).
function PERMITIDAS_PRE() {
  const out = {};
  for (const k of Object.keys(PERMITIDAS)) out['pre: ' + k] = PERMITIDAS[k];
  return out;
}

console.log(fails === 0
  ? '\n=== REGRESSÃO ZERO CONFIRMADA' + (permitidas ? ' (' + permitidas + ' divergência(s) permitida(s))' : '') + ' ==='
  : '\n=== ' + fails + ' DIVERGÊNCIA(S) ===');
process.exit(fails === 0 ? 0 : 1);
