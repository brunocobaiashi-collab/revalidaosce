// Teste da divisao de falas do renderReply (v1.6.172), em jsdom, com estacao simulada.
// Nada de rede: callAI dublado; a voz passa pelo speak REAL (com a fila dublada, sem audio),
// para provar a guarda de texto vazio e o genero da voz.
// Rodar a partir da raiz: node ci/test-falas-1.6.172.mjs   (saida 1 = falhou)
//
// 6.1 divisao por rotulo no inicio de linha; 6.2 parte do paciente vazia = silencio;
// 6.3 speak ignora texto vazio; 6.4 revisao do historico e tela de resultado sem bolha vazia;
// "Nao consta." puro: Chefe so depois de pedido de exame, senao paciente.
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { scriptsInline } from './lib/html.mjs';

const ARQ = 'simulador/index.html';
let ok = 0, falhas = 0;
function confere(cond, nome, extra) {
  if (cond) { ok++; console.log('   ok    ' + nome); }
  else { falhas++; console.log('   FALHA ' + nome + (extra ? '  ::  ' + extra : '')); }
}

const GANCHO = `
;try{
  window.__msgs = []; window.__ai = { reply: '', chamadas: 0 };
  var __addOrig = addMsg;
  addMsg = function(type, text, extra){ window.__msgs.push({ type: type, text: text, temImpresso: !!extra }); try{ return __addOrig(type, text, extra); }catch(e){ return { remove: function(){} }; } };
  flushQ = function(){};  // a fila da voz fica parada: o teste le speakQ (o speak e o real)
  callAI = async function(){ window.__ai.chamadas++; var r = window.__ai.reply; return { ok: true, status: 200, json: async function(){ return { content: [{ type: 'text', text: r }] }; } }; };
  window.__T = {
    montar: function(s){ station = s; stationRules = buildRules(s); fired = {}; deliveredExams = []; examLog = []; chatHistory = []; fullTranscript = []; lastDoctorText = ''; ttsOn = true; isSpeaking = false; speakQ.length = 0; window.__msgs.length = 0; window.__ai.chamadas = 0; },
    limpar: function(){ window.__msgs.length = 0; speakQ.length = 0; isSpeaking = false; window.__ai.chamadas = 0; fullTranscript = []; },
    ultimoMedico: function(t){ lastDoctorText = t; },
    processInput: processInput, renderReply: renderReply, speak: speak,
    falas: function(){ return speakQ.map(function(q){ return { text: q.text, who: q.who, gender: q.gender }; }); },
    entregues: function(){ return deliveredExams.map(function(d){ return d.title; }); },
    transcript: function(){ return fullTranscript.slice(); },
    turnosParaExibir: (typeof _turnosParaExibir === 'function') ? _turnosParaExibir : function(c){ return c; },
    historico: function(data){ try{ renderHistDetail(data); }catch(e){ window.__histErro = String(e && e.message || e); } var el = document.getElementById('hd-log'); return el ? el.innerHTML : ''; },
    resultado: function(hist){ chatHistory = hist; doctorLog = []; examLog = []; renderEvalTranscript(); var el = document.getElementById('eval-transcript-content'); return el ? el.innerHTML : ''; }
  };
}catch(e){ window.__GANCHO_ERRO__ = String(e && e.message || e); }
`;

function prepararHTML(arquivo) {
  const dir = path.dirname(arquivo);
  return fs.readFileSync(arquivo, 'utf8').replace(
    /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (tag, src) => {
      if (/^https?:|^\/\//i.test(src)) return '';
      const local = path.join(dir, src.split('?')[0]);
      return fs.existsSync(local) ? `<script>${fs.readFileSync(local, 'utf8')}</script>` : '';
    }
  );
}

function injetar(html) {
  const blocos = scriptsInline(html);
  const p = blocos.reduce((a, b) => (b.codigo.length > (a ? a.codigo.length : 0) ? b : a), null);
  const c = p.codigo;
  const fim = c.lastIndexOf('})()');
  const pos = fim >= 0 && fim > c.length - 400 ? fim : c.length;
  return html.slice(0, p.inicioCodigo) + c.slice(0, pos) + GANCHO + c.slice(pos) + html.slice(p.inicioCodigo + c.length);
}

function dublar(w) {
  const cli = new Proxy(function () {}, {
    get: (_, p) => {
      if (p === 'then') return undefined;
      if (p === 'auth') return {
        getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }),
        signInWithOAuth: async () => ({ data: {}, error: null }), signInWithPassword: async () => ({ data: {}, error: null }),
        setSession: async () => ({ data: {}, error: null }),
      };
      return () => cli;
    },
    apply: () => cli,
  });
  w.supabase = { createClient: () => cli };
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  w.gtag = () => {}; w.dataLayer = [];
  w.turnstile = { render: () => 'w-0', reset: () => {}, remove: () => {} };
  w.scrollTo = () => {};
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  w.AudioContext = w.webkitAudioContext = function () {
    return { createMediaElementSource: () => ({ connect() {} }), createGain: () => ({ connect() {}, gain: { value: 1, setValueAtTime() {} } }),
      destination: {}, state: 'running', resume: async () => {}, close: async () => {}, currentTime: 0 };
  };
  w.MediaRecorder = function () { return { start() {}, stop() {}, state: 'inactive' }; };
  w.MediaRecorder.isTypeSupported = () => true;
  Object.defineProperty(w.navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [] }) }, configurable: true });
  w.HTMLMediaElement.prototype.play = async () => {};
  w.HTMLMediaElement.prototype.pause = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, closePath() {}, save() {}, restore() {},
    translate() {}, rotate() {}, scale() {}, fillText() {}, measureText: () => ({ width: 40 }), setLineDash() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  });
  w.localStorage.setItem('rv_ant', 'dublado-ci');
}

const erros = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => erros.push(e.message));
const dom = new JSDOM(injetar(prepararHTML(ARQ)), {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'https://simulador.revalidaosce.com.br/', virtualConsole: vc, beforeParse: dublar,
});
await new Promise((r) => setTimeout(r, 400));
const w = dom.window;
console.log('\n── Teste · divisão de falas 1.6.172 ' + '─'.repeat(24));
if (!w.__T) { console.log('   FALHA gancho não rodou: ' + (w.__GANCHO_ERRO__ || erros.join(' | '))); process.exit(1); }
const T = w.__T;

// Estação com os 3 impressos da demo (dor em hipocôndrio direito), paciente adulta.
const DEMO = {
  id: 'ci-172', name: 'Dor em hipocôndrio direito', area: 'Cirurgia', pNome: 'Joana', pIdade: '45', pGenero: 'feminino',
  exams: [
    { title: 'EXAME FÍSICO', rows: ['PA 130x80 mmHg', 'Murphy positivo'], images: [] },
    { title: 'EXAMES LABORATORIAIS', rows: ['Leucócitos 14.000'], images: [], trigger_keywords: ['hemograma', 'laboratoriais'] },
    { title: 'ULTRASSOM DE ABDOME', rows: ['Vesícula com cálculos'], images: [], trigger_keywords: ['ultrassom', 'usg'] },
  ],
};
// Pediátrica: quem fala é a mãe (voz feminina), a criança tem nome masculino.
const PED = {
  id: 'ci-172-ped', name: 'Febre na criança', area: 'Pediatria', pNome: 'Joao', pIdade: '4', pGenero: 'masculino',
  acompNome: 'Maria', acompRelacao: 'mae', acompGenero: 'feminino', informante_tipo: 'acompanhante',
  exams: [{ title: 'EXAME FÍSICO', rows: ['FC 110 bpm'], images: [] }],
};

const J = (x) => JSON.stringify(x);
const msgs = () => w.__msgs.map((m) => m.type + '|' + m.text);
const vozes = () => T.falas().map((f) => f.who + '|' + f.text);
const ROTULO = /chefe\s+de\s+esta\S{1,4}o\s*:|^\s*paciente\s*:|\npaciente\s*:/i;
function semDefeito(rot) {
  const m = w.__msgs, f = T.falas(), t = T.transcript();
  confere(!m.some((x) => (x.type === 'actor' || x.type === 'chief') && !String(x.text || '').trim()), `${rot}: nenhuma bolha vazia`, J(msgs()));
  confere(!t.some((x) => x.quem !== 'medico' && !String(x.fala || '').trim()), `${rot}: nenhum turno vazio na transcrição`, J(t));
  confere(!f.some((x) => !String(x.text || '').trim()), `${rot}: nenhum texto vazio na voz`, J(vozes()));
  confere(!f.some((x) => ROTULO.test(x.text)), `${rot}: nenhum rótulo no texto da voz`, J(vozes()));
}
function caso(est, reply, ultimoMedico, rot, esperadoMsgs, esperadoVoz) {
  T.montar(est);
  if (ultimoMedico) T.ultimoMedico(ultimoMedico);
  T.renderReply(reply);
  confere(J(msgs()) === J(esperadoMsgs), `${rot}: tela`, J(msgs()));
  if (esperadoVoz) confere(J(vozes()) === J(esperadoVoz), `${rot}: voz`, J(vozes()));
  semDefeito(rot);
}

// ── Tabela do item 5 da análise ───────────────────────────────────────────
const DUVIDA = 'Só uma dúvida, doutor: essa cirurgia é pra tirar a vesícula? E eu vou precisar operar agora mesmo?';
caso(DEMO, 'Paciente: [permanece em silencio, sem nada a acrescentar neste momento.]\n\nChefe de estação: Pode relatar, doutor.\n\nChefe de estação: Achados registrados.', '',
  '(5.1) rubrica + Chefe + Chefe', ['chief|Pode relatar, doutor.', 'chief|Achados registrados.'], ['chief|Pode relatar, doutor.', 'chief|Achados registrados.']);
caso(DEMO, 'Paciente: [aguarda a resposta do medico.]\n\nChefe de estação: Conduta registrada.\n\nPaciente: ' + DUVIDA, '',
  '(5.2) rubrica + Chefe + Paciente', ['chief|Conduta registrada.', 'actor|' + DUVIDA], ['chief|Conduta registrada.', 'actor|' + DUVIDA]);
confere(J(T.transcript()) === J([{ quem: 'chief', fala: 'Conduta registrada.' }, { quem: 'paciente', fala: DUVIDA }]), '(5.2) transcrição: chief + paciente, cada um com seu rótulo', J(T.transcript()));
confere(T.falas()[1].gender === 'f', '(5.2) pergunta da paciente na voz feminina da paciente');
caso(DEMO, 'Chefe de estação: Conduta registrada.\nPaciente: ' + DUVIDA, '',
  '(5.3) Chefe + Paciente', ['chief|Conduta registrada.', 'actor|' + DUVIDA], ['chief|Conduta registrada.', 'actor|' + DUVIDA]);
caso(DEMO, '*aguarda*\nChefe de estação: segue o IMPRESSO 3.', 'Solicito um ultrassom de abdome',
  '(5.4) *rubrica* + Chefe entrega', ['chief|Segue ULTRASSOM DE ABDOME.'], ['chief|Segue o Impresso 3.']);
confere(T.entregues().includes('ULTRASSOM DE ABDOME'), '(5.4) impresso 3 entregue');
caso(DEMO, 'Paciente: [permanece em silêncio]', '', '(5.5) só rubrica = silêncio', [], []);
confere(T.transcript().length === 0, '(5.5) nada na transcrição');
caso(DEMO, 'Tá bom, doutor.\nChefe de estação: Achados registrados.', '',
  '(5.6) paciente + Chefe', ['actor|Tá bom, doutor.', 'chief|Achados registrados.'], ['actor|Tá bom, doutor.', 'chief|Achados registrados.']);
caso(DEMO, 'Tá bom, doutor. Chefe de estação: Achados registrados.', '',
  '(5.6b) Chefe no meio da linha (divisão antiga)', ['actor|Tá bom, doutor.', 'chief|Achados registrados.']);
caso(DEMO, 'Chefe de estação: Achados registrados.', '', '(5.7) só Chefe', ['chief|Achados registrados.'], ['chief|Achados registrados.']);
// Forma NFD do "estação" (acento decomposto) também divide.
caso(DEMO, 'Paciente: [aguarda]\nChefe de esta\u0063\u0327\u0061\u0303o: Conduta registrada.', '', '(5.8) rótulo do Chefe em NFD', ['chief|Conduta registrada.']);
caso(DEMO, 'Chefe de estação:', '', '(5.9) rótulo do Chefe sem fala = silêncio', [], []);

// ── 1.6.167: dois impressos ───────────────────────────────────────────────
caso(DEMO, 'Chefe de estacao: segue o IMPRESSO 2. Segue o IMPRESSO 3.', 'Solicito laboratoriais e ultrassom',
  '(167) dois impressos numa linha', ['chief|Segue EXAMES LABORATORIAIS.', 'chief|Segue ULTRASSOM DE ABDOME.']);
confere(J(T.entregues()) === J(['EXAMES LABORATORIAIS', 'ULTRASSOM DE ABDOME']), '(167) entrega os dois', J(T.entregues()));
caso(DEMO, 'Chefe de estacao: segue o IMPRESSO 2.\nChefe de estacao: segue o IMPRESSO 3.', 'Solicito laboratoriais e ultrassom',
  '(167) dois impressos em duas linhas com rótulo', ['chief|Segue EXAMES LABORATORIAIS.', 'chief|Segue ULTRASSOM DE ABDOME.']);
confere(J(T.entregues()) === J(['EXAMES LABORATORIAIS', 'ULTRASSOM DE ABDOME']), '(167) duas linhas: entrega os dois', J(T.entregues()));

// ── 1.6.170 / 1.6.171: "Não consta." acentuado ────────────────────────────
caso(DEMO, 'Chefe de estacao: Nao consta.', 'Solicito uma tomografia', '(170) Chefe com rótulo, acentuado', ['chief|Não consta.'], ['chief|Não consta.']);
caso(DEMO, 'Chefe de estacao: Nao consta.', 'Tem alergia a remédio?', '(170) Chefe com rótulo continua Chefe sem pedido', ['chief|Não consta.']);
caso(DEMO, 'Paciente: Nao consta.', '', '(171) "Paciente: Nao consta." acentuado', ['actor|Não consta.'], ['actor|Não consta.']);
caso(DEMO, 'Chefe de estacao: Conduta registrada.\nPaciente: O resto nao consta.', '',
  '(171) Chefe + paciente com "nao consta"', ['chief|Conduta registrada.', 'actor|O resto não consta.'], ['chief|Conduta registrada.', 'actor|O resto não consta.']);

// ── "Não consta." puro ────────────────────────────────────────────────────
caso(DEMO, 'Não consta.', 'Tem alergia a remédio?', '(nc) puro depois de pergunta → paciente', ['actor|Não consta.'], ['actor|Não consta.']);
confere(J(T.transcript()) === J([{ quem: 'paciente', fala: 'Não consta.' }]), '(nc) transcrição com rótulo do paciente', J(T.transcript()));
caso(DEMO, 'nao consta', 'A senhora tem febre?', '(nc) puro minúsculo sem acento → "Não consta." do paciente', ['actor|Não consta.'], ['actor|Não consta.']);
caso(DEMO, 'Nao consta.', 'Solicito uma tomografia', '(nc) puro depois de pedido de exame → Chefe', ['chief|Não consta.'], ['chief|Não consta.']);
caso(DEMO, 'Febre não tive. O resto não consta.', 'Teve febre, vômito ou diarreia?', '(nc) mista → paciente, uma bolha', ['actor|Febre não tive. O resto não consta.']);

// ── "paciente:" no meio da frase não divide ───────────────────────────────
caso(DEMO, 'Paciente: O outro médico escreveu assim, paciente: repouso e dieta.', '',
  '(meio) "paciente:" no meio da frase', ['actor|O outro médico escreveu assim, paciente: repouso e dieta.']);

// ── Acompanhante informante ───────────────────────────────────────────────
caso(PED, 'Paciente: [aguarda]\nChefe de estação: Conduta registrada.\nMaria: Doutor, ele vai precisar internar?', '',
  '(acomp) rótulo com o nome da acompanhante', ['chief|Conduta registrada.', 'actor|Doutor, ele vai precisar internar?']);
confere(T.falas()[1] && T.falas()[1].who === 'actor' && T.falas()[1].gender === 'f', '(acomp) voz feminina da mãe depois da divisão', J(T.falas()));
caso(PED, 'Não consta.', 'Ele tem alergia?', '(acomp) "Não consta." puro → acompanhante', ['actor|Não consta.']);
confere(T.falas()[0] && T.falas()[0].gender === 'f', '(acomp) "Não consta." na voz da mãe', J(T.falas()));

// ── 6.3 speak ignora texto vazio ──────────────────────────────────────────
T.montar(DEMO);
T.speak('', 'actor'); T.speak('   ', 'chief'); T.speak(null, 'actor');
confere(T.falas().length === 0, '(6.3) speak com texto vazio não enfileira', J(T.falas()));
T.speak('Oi, doutor.', 'actor');
confere(T.falas().length === 1, '(6.3) speak com texto continua enfileirando');

// ── Ponta a ponta: processInput com a resposta do caso real 6b5ec0de ─────
T.montar(DEMO);
w.__ai.reply = 'Paciente: [aguarda]\n\nChefe de estação: Conduta registrada.\n\nPaciente: ' + DUVIDA;
await T.processInput('A senhora tem alguma dúvida?');
confere(w.__ai.chamadas === 1, '(e2e) a fala foi à IA do ator');
semDefeito('(e2e) processInput');
confere(T.transcript().some((t) => t.quem === 'paciente' && t.fala === DUVIDA) && !T.transcript().some((t) => t.quem === 'chief' && /Paciente/.test(t.fala)),
  '(e2e) pergunta da paciente gravada como paciente', J(T.transcript()));

// ── 6.4 histórico salvo (só exibição) ─────────────────────────────────────
const SALVO = [
  { quem: 'medico', fala: 'Exame físico com Murphy positivo' },
  { quem: 'paciente', fala: '' },
  { quem: 'chief', fala: 'Pode relatar, doutor.\n\nChefe de estação: Achados registrados.' },
  { quem: 'medico', fala: 'Conduta: colecistectomia' },
  { quem: 'paciente', fala: '' },
  { quem: 'chief', fala: 'Conduta registrada.\n\nPaciente: ' + DUVIDA },
  { quem: 'paciente', fala: 'Chefe de estação: Segue EXAME FÍSICO.' },  // formato antigo (pré-1.6.64)
];
const exib = T.turnosParaExibir(SALVO);
confere(J(exib.map((t) => t.quem)) === J(['medico', 'chief', 'chief', 'medico', 'chief', 'paciente', 'chief']), '(6.4) turnos exibidos: sem paciente vazio, Chefe e paciente separados', J(exib));
const html = T.historico({ station_name: 'x', station_area: 'y', started_at: '2026-11-15T16:30:00Z', duration_sec: 600, score: 5, score_pct: 50,
  transcript: { conversation: SALVO }, doctor_log: [], eval_items: [] });
const bolhasPac = (html.match(/>Paciente<\/div>/g) || []).length;
confere(html && bolhasPac === 1 && html.includes('Só uma dúvida') && !/Paciente:/.test(html) && !/Chefe de estação:/.test(html),
  '(6.4) revisão do histórico: uma bolha PACIENTE (a pergunta), sem bolha vazia nem rótulo no texto', (w.__histErro || '') + ' ' + bolhasPac);
const res = T.resultado([
  { role: 'user', content: '[inicio da simulacao]' },
  { role: 'assistant', content: 'Paciente: [Joana aguarda em silencio, com expressao de dor.]' },
  { role: 'user', content: 'Exame físico com Murphy positivo' },
  { role: 'assistant', content: 'Paciente: [permanece em silencio, sem nada a acrescentar neste momento.]' },
  { role: 'user', content: 'Conduta: colecistectomia' },
  { role: 'assistant', content: 'Paciente: [aguarda]\n\nChefe de estação: Conduta registrada.\n\nPaciente: ' + DUVIDA },
]);
confere(res && !res.includes('[permanece') && !res.includes('[aguarda') && (res.match(/>Paciente:<\/span>/g) || []).length === 1
  && (res.match(/>Chefe de estação:<\/span>/g) || []).length === 1 && res.includes('Só uma dúvida'),
  '(6.4) tela de resultado: sem rubrica, Chefe e paciente separados', res.slice(0, 600));

for (const e of erros) { falhas++; console.log('   FALHA exceção em runtime: ' + e); }
console.log(`\n   ${ok} ok, ${falhas} falha(s)`);
dom.window.close();
process.exit(falhas ? 1 : 0);
