// Testes da 1.4.1 — binário conjuntivo (doc de 19/08, refeita em 15/11).
//  A) buildSys2: a 1.4.1 é a 1.4.0 MAIS o bloco novo, e nada além — tirando o bloco, o prompt volta
//     a ser byte a byte o da 1.4.0 (com e sem âncora). buildSys1 e buildSysAudit: test-regressao.js.
//  B) aviso binario_conjuntivo: os exemplos do doc de 19/08 disparam; alternativa, item de 3 faixas
//     e ação indivisível não disparam. Casos sintéticos, escritos a partir das frases do doc.
const fs = require('fs');
const vm = require('vm');
const P = require('./_paths');
function load(p) { const c = {}; vm.createContext(c); vm.runInContext(fs.readFileSync(p, 'utf8'), c); return c.StationEngine; }
const SE = load(P.ENGINE);
const REF = load(P.base('1.4.0'));

let pass = 0, fail = 0;
function ok(cond, nome, extra) {
  if (cond) { pass++; console.log('OK   ' + nome); }
  else { fail++; console.log('FAIL ' + nome + (extra ? ' — ' + extra : '')); }
}

const VER = P.expect('1.4.1');
ok(SE.ENGINE_VERSION === VER, 'ENGINE_VERSION = ' + VER, 'veio ' + SE.ENGINE_VERSION);

// ── A) buildSys2 = 1.4.0 + bloco ────────────────────────────────────────────
const BLOCO = [
  '⚠️ BINARIO SO PARA ACAO INDIVISIVEL (nada de tudo-ou-nada escondido):',
  'Item binario ([0, max]) so quando o criterio e UMA acao indivisivel (ex: "solicita radiografia de torax").',
  'Se o crit_adeq OU os subitens exigem DOIS OU MAIS componentes OBRIGATORIOS (ex: "cumprimenta E pergunta',
  'idade E profissao", "avalia os quatro quadrantes", "hemograma + glicemia + funcao renal"), o item TEM de',
  'ter 3 faixas, com crit_parc dizendo o limiar parcial. Binario conjuntivo da ZERO a quem cumpre 4 de 5,',
  'igual a quem nao fez nada.',
  'ALTERNATIVA NAO E CONJUNCAO: "A ou B", "e/ou", "ao menos dois de" continuam podendo ser binarios.',
  '',
].join('\n') + '\n';

const ANCHOR = {
  image_file: 'exemplo_a1b2c3d4.png', modality: 'radiografia de tórax', incidence: 'PA',
  finding_truth: 'hipertransparência em hemitórax direito', diagnosis_truth: 'pneumotórax',
  area: 'Clínica Médica', image_credits: { license: 'CC BY 4.0', author: 'A', year: '2024' }
};
for (const [rot, anc] of [['sem âncora', undefined], ['ancorado', SE.normalizeAnchor(ANCHOR)]]) {
  const novo = SE.buildSys2(anc);
  const ref = REF.buildSys2(anc && REF.normalizeAnchor(ANCHOR));
  const i = novo.indexOf(BLOCO);
  ok(i > 0 && novo.indexOf(BLOCO, i + 1) < 0, 'buildSys2 ' + rot + ': bloco presente uma vez');
  ok(novo.slice(0, i) + novo.slice(i + BLOCO.length) === ref, 'buildSys2 ' + rot + ': sem o bloco, idêntico à 1.4.0',
     'novo ' + novo.length + ' / ref ' + ref.length + ' / bloco ' + BLOCO.length);
  ok(novo.indexOf('ESTRUTURA DE FAIXAS') < i && novo.indexOf('DECOMPONHA DIAGNOSTICOS') > i,
     'buildSys2 ' + rot + ': bloco entre ESTRUTURA DE FAIXAS e DECOMPONHA');
}

// ── B) aviso binario_conjuntivo ─────────────────────────────────────────────
function item(crit_adeq, subitens, scores) {
  return { id: '1', text: 'Item', subitens: subitens || '', scores: scores || [0, 0.5],
           labels: (scores || [0, 0.5]).length === 3 ? ['Inadequado','Parcialmente adequado','Adequado'] : ['Inadequado','Adequado'],
           crit_adeq: crit_adeq, crit_parc: (scores || []).length === 3 ? 'parcial' : undefined, crit_inad: 'nao realiza' };
}
function avisa(it) {
  const st = { checklist: [it], exams: [], orientAtor: {} };
  return SE.softWarnings(st, 'Intermediário').some(w => w.category === 'binario_conjuntivo');
}
const DISPARA = [
  ['caso de origem: enumeração só no subitem, com "+"', item('solicita exames pré-operatórios', 'hemograma + glicemia + função renal + eletrólitos + coagulograma e verbaliza normalidade', [0, 0.25])],
  ['"cumprimenta E pergunta idade E profissão"', item('cumprimenta E pergunta idade E profissão')],
  ['"avalia os quatro quadrantes"', item('avalia os quatro quadrantes')],
  ['"seguindo todas as etapas"', item('realiza a prova do laço seguindo todas as etapas', '', [0, 1.0])],
  ['"orienta os dois itens"', item('orienta os dois itens', '', [0, 0.4])],
  ['"indica ... E verbaliza ..." (Parkland)', item('indica hidratação venosa E verbaliza o volume calculado por Parkland', '', [0, 0.375])],
  ['"solicita os 3 componentes"', item('solicita os 3 componentes e conclui que está estável')],
  ['subitens numerados (1)(2) em binário', item('realiza', '(1) lava as mãos\n(2) calça luvas')],
];
const NAO_DISPARA = [
  ['ação indivisível', item('solicita radiografia de tórax')],
  ['alternativa no subitem ("OU")', item('solicita hemograma', 'hemograma OU hemoglobina + hematócrito')],
  ['"ao menos dois de"', item('cita ao menos dois de: febre, tosse, dispneia')],
  ['"e/ou"', item('prescreve dipirona e/ou paracetamol')],
  ['limiar aberto (a correção de 19/08)', item('solicita ao menos 3 dos exames pré-operatórios listados E verbaliza que os resultados são normais', '', [0, 0.25])],
  ['"e" minúsculo de texto clínico', item('reconhece dor e febre como sinais de alarme')],
  ['item de 3 faixas com conjunção', item('cumprimenta E pergunta idade E profissão', '', [0, 0.25, 0.5])],
  ['"pelo menos 1 dos temas"', item('aborda pelo menos 1 dos temas')],
  ['"todas as dúvidas" não é lista de componentes', item('responde a todas as dúvidas')],
  ['"todas as consultas" não é lista de componentes', item('informa que o cartão deve acompanhar em todas as consultas')],
];
for (const [rot, it] of DISPARA) ok(avisa(it), 'dispara: ' + rot);
for (const [rot, it] of NAO_DISPARA) ok(!avisa(it), 'não dispara: ' + rot);

// WARN, nunca bloqueio: preValidate não conhece a categoria
const stB = { name: 'x', orientMed: 'template', caso: 'Voce e medico em UBS.',
  checklist: [Object.assign(item('cumprimenta E pergunta idade E profissão'), { scores: [0, 10] })],
  exams: [{ title: 'EXAME FISICO', rows: ['PA: 120x80 mmHg'], images: [], trigger_keywords: ['exame fisico','fisico geral','sinais vitais'] }] };
ok(!SE.preValidate(stB, { ok: true, total: 10 }, 'Intermediário').some(x => x.category === 'binario_conjuntivo'),
   'binario_conjuntivo não entra no preValidate (não bloqueia)');

console.log('\n=== ' + pass + ' OK / ' + fail + ' FAIL ===');
process.exit(fail === 0 ? 0 : 1);
