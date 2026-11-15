// Teste dos três ajustes do Chefe de estação (v1.6.170), em jsdom, com a estação simulada.
// Nada de rede: a IA do ator é dublada (callAI devolve o texto que o teste define).
// Rodar a partir da raiz: node ci/test-chefe-1.6.170.mjs   (saída 1 = falhou)
//
// (1) leitura de achados de impresso já entregue → "Achados registrados.", sem reentregar;
// (2) pedido com "estar + gerúndio" vira pedido; gerúndio solto em pergunta, não;
// (3) "Chefe de estacao: Nao consta." sai acentuado na tela e na voz, com o rótulo do Chefe.
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

// Gancho injetado DENTRO da IIFE principal (nada dela vaza para window): expõe o que o
// teste precisa e dubla a saída (addMsg é embrulhado, não trocado; speak e callAI são dublados).
const GANCHO = `
;try{
  window.__msgs = []; window.__falas = []; window.__ai = { reply: '', chamadas: 0 };
  var __addOrig = addMsg;
  addMsg = function(type, text, extra){ window.__msgs.push({ type: type, text: text, temImpresso: !!extra }); try{ return __addOrig(type, text, extra); }catch(e){ return { remove: function(){} }; } };
  speak = function(text, who){ window.__falas.push({ text: text, who: who }); };
  callAI = async function(){ window.__ai.chamadas++; var r = window.__ai.reply; return { ok: true, status: 200, json: async function(){ return { content: [{ type: 'text', text: r }] }; } }; };
  window.__T = {
    montar: function(s){ station = s; stationRules = buildRules(s); fired = {}; deliveredExams = []; examLog = []; chatHistory = []; fullTranscript = []; lastDoctorText = ''; window.__msgs.length = 0; window.__falas.length = 0; window.__ai.chamadas = 0; },
    limpar: function(){ window.__msgs.length = 0; window.__falas.length = 0; window.__ai.chamadas = 0; },
    processInput: processInput, renderReply: renderReply,
    entregues: function(){ return deliveredExams.map(function(d){ return d.title; }); },
    transcript: function(){ return fullTranscript.slice(); },
    REQUEST_RX: REQUEST_RX, norm: norm
  };
}catch(e){ window.__GANCHO_ERRO__ = String(e && e.message || e); }
`;

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
console.log('\n── Teste · Chefe de estação 1.6.170 ' + '─'.repeat(24));
if (!w.__T) { console.log('   FALHA gancho não rodou: ' + (w.__GANCHO_ERRO__ || erros.join(' | '))); process.exit(1); }
const T = w.__T;

const ESTACAO = {
  id: 'ci-170', name: 'Estação de teste', area: 'Pediatria', pNome: 'Marcos', pIdade: '4 anos',
  exams: [
    { title: 'EXAME FÍSICO GERAL', rows: ['PA 90x60 mmHg', 'FC 150 bpm'], images: [] },
    { title: 'EXAMES LABORATORIAIS', rows: ['Hemograma: Hb 12', 'Teste rápido HIV: não reagente'], images: [],
      trigger_keywords: ['teste rapido', 'testes rapidos', 'teste de hiv', 'hemograma'] },
  ],
};
const EF = 'EXAME FÍSICO GERAL', LAB = 'EXAMES LABORATORIAIS';

const chefe = () => w.__msgs.filter((m) => m.type === 'chief');
const reentregou = () => chefe().some((m) => /^Segue /.test(m.text));
const registrou = () => chefe().some((m) => m.text === 'Achados registrados.');

async function fala(texto, aiReply = '') { w.__ai.reply = aiReply; await T.processInput(texto); }

// ── (1) Leitura de achados do impresso já entregue ─────────────────────────
const LEITURAS = [
  'Exame físico verificamos que o Marcos tem de 4 anos e 6 meses, peso de 18 quilo temperatura normal, apresenta 150 batimentos por minuto',
  'Qual exame físico a temperatura está normal, pressão arterial normal, frequência cardíaca normal',
  'É 1 exame físico regular, hidratação e mucosa diminuída, estado geral, pressão arterial elevada, frequência cardíaca também elevada',
];
// A IA, no código antigo, anunciava a reentrega: simula isso para provar que ela nem é chamada.
const AI_REENTREGA = 'Chefe de estacao: segue o IMPRESSO 1.';

for (const [i, txt] of LEITURAS.entries()) {
  T.montar(ESTACAO);
  await fala('Solicito o exame físico');
  confere(T.entregues().includes(EF), `(1.${i + 1}) pedido inicial entrega o exame físico`);
  T.limpar();
  await fala(txt, AI_REENTREGA);
  confere(registrou() && !reentregou() && w.__ai.chamadas === 0,
    `(1.${i + 1}) leitura com impresso já entregue → "Achados registrados." sem reentregar`,
    JSON.stringify(chefe()));
  confere(w.__falas.some((f) => f.text === 'Achados registrados.' && f.who === 'chief'), `(1.${i + 1}) e é falado pelo Chefe`);
}

for (const [i, txt] of LEITURAS.entries()) {
  T.montar(ESTACAO);
  await fala(txt, AI_REENTREGA);
  confere(T.entregues().includes(EF) && !registrou(), `(1.${i + 1}) mesma fala sem o impresso entregue → entrega normal`, JSON.stringify(chefe()));
}

T.montar(ESTACAO);
await fala('Solicito o exame físico');
T.limpar();
await fala('Solicito novamente o exame físico', AI_REENTREGA);
confere(reentregou() && !registrou() && w.__ai.chamadas === 1, '(1) "Solicito novamente o exame físico" → entrega', JSON.stringify(chefe()));

// "Vou examinar o paciente" (sem achado): comportamento atual — primeira vez entrega;
// depois de entregue, a regra once já disparou e a fala vai à IA, como antes.
T.montar(ESTACAO);
await fala('Vou examinar o paciente');
confere(T.entregues().includes(EF) && !registrou(), '(1) "Vou examinar o paciente" sem impresso entregue → entrega (como antes)');
T.limpar();
await fala('Vou examinar o paciente', AI_REENTREGA);
confere(!registrou() && w.__ai.chamadas === 1, '(1) "Vou examinar o paciente" já entregue → segue para a IA (como antes)', JSON.stringify(chefe()));

// Só um termo de achado não basta.
T.montar(ESTACAO);
await fala('Solicito o exame físico');
T.limpar();
await fala('Exame físico com pressão normal', AI_REENTREGA);
confere(!registrou() && w.__ai.chamadas === 1, '(1) um termo de achado só → comportamento atual (vai à IA)');

// Achado + hipótese/conduta: continua "Conduta registrada.", como antes.
T.montar(ESTACAO);
await fala('Solicito o exame físico');
T.limpar();
await fala('Exame físico com pressão normal e frequência elevada, minha hipótese diagnóstica é desidratação', AI_REENTREGA);
confere(!registrou() && chefe().some((m) => m.text === 'Conduta registrada.'), '(1) achados + hipótese → "Conduta registrada." (como antes)', JSON.stringify(chefe()));

// ── (2) Pedido com estar + gerúndio ─────────────────────────────────────────
T.montar(ESTACAO);
await fala('Certo, e recomendo também, estar realizando os teste rápidos de IST como o teste rápido de HIV, sífilis, hepatite b, hepatite c');
confere(T.entregues().includes(LAB) && w.__ai.chamadas === 0, '(2) fala real a26788ff → entrega EXAMES LABORATORIAIS', JSON.stringify(chefe()));

T.montar(ESTACAO);
await fala('vamos estar solicitando hemograma');
confere(T.entregues().includes(LAB), '(2) "vamos estar solicitando hemograma" → entrega');

T.montar(ESTACAO);
await fala('você está realizando exames de rotina?', 'Paciente: Não, doutor.');
confere(T.entregues().length === 0 && w.__ai.chamadas === 1, '(2) "você está realizando exames de rotina?" → não entrega (vai ao paciente)', JSON.stringify(w.__msgs));
confere(!T.REQUEST_RX.test(T.norm('a senhora está realizando algum tratamento?')), '(2) gerúndio solto em pergunta não casa REQUEST_RX');
confere(T.REQUEST_RX.test(T.norm('vou estar pedindo um raio x')) && T.REQUEST_RX.test(T.norm('vamos estar coletando urina')), '(2) estar pedindo / estar coletando casam REQUEST_RX');

// ── (3) "Nao consta." do Chefe sem acento ───────────────────────────────────
T.montar(ESTACAO);
T.renderReply('Chefe de estacao: Nao consta.');
confere(chefe().length === 1 && chefe()[0].text === 'Não consta.', '(3) "Chefe de estacao: Nao consta." aparece "Não consta."', JSON.stringify(w.__msgs));
confere(w.__falas.length === 1 && w.__falas[0].text === 'Não consta.' && w.__falas[0].who === 'chief', '(3) e é falado "Não consta." pelo Chefe');
confere(T.transcript().some((l) => l.quem === 'chief' && l.fala === 'Não consta.'), '(3) transcrição salva com o rótulo do Chefe');
T.montar(ESTACAO);
T.renderReply('Chefe de estação: Não consta');
confere(chefe().length === 1 && chefe()[0].text === 'Não consta.', '(3) forma acentuada sem ponto também sai "Não consta."');
T.montar(ESTACAO);
T.renderReply('Nao consta.');
confere(chefe().length === 1 && chefe()[0].text === 'Não consta.', '(3) resposta pura "Nao consta." continua igual');

for (const e of erros) { falhas++; console.log('   FALHA exceção em runtime: ' + e); }
console.log(`\n   ${ok} ok, ${falhas} falha(s)`);
dom.window.close();
process.exit(falhas ? 1 : 0);
