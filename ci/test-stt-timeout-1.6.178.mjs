// Teste do tempo limite da transcricao (v1.6.178), em jsdom, com timers falsos.
// Nada de rede: fetch dublado. Motivo: incidente do Deepgram em 18/11, em que o fetch do
// transcribe nunca respondia e a tela ficava em "Transcrevendo..." para sempre.
// Rodar a partir da raiz: node ci/test-stt-timeout-1.6.178.mjs [arquivo]   (saida 1 = falhou)
// O argumento opcional permite rodar os mesmos casos contra outra versao do simulador
// (os casos de tempo limite falham na 1.6.177, que nao tinha tempo limite).
//
// 1 fetch que nunca resolve: aos 60 s o tbox mostra a mensagem nova e o mic volta a gravar;
// 2 o mesmo, com texto ja transcrito antes (prev): mantem o texto e a classe live;
// 3 fetch normal; 4 401 + refresh + 200 (as duas chamadas com tempo limite);
// 5 401 persistente; 6 502 do servidor; 7 erro de rede (continua "(erro de conexao)").
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { scriptsInline } from './lib/html.mjs';

const ARQ = process.argv[2] || 'simulador/index.html';
let ok = 0, falhas = 0;
function confere(cond, nome, extra) {
  if (cond) { ok++; console.log('   ok    ' + nome); }
  else { falhas++; console.log('   FALHA ' + nome + (extra ? '  ::  ' + extra : '')); }
}

const GANCHO = `
;try{
  window.__auth = { refresh: false, expirou: 0 };
  tryRefreshAuth = async function(){ return window.__auth.refresh; };
  showAuthExpired = function(){ window.__auth.expirou++; };
  buildStationKeyterms = function(){ return ''; };
  window.__T = {
    transcrever: function(blob){ return transcribeAudio(blob); },
    setLive: function(t){ liveText = t; },
    estado: function(){ return { liveText: liveText, isRecording: isRecording }; },
    resetMic: function(){ isRecording = false; liveText = ''; mediaRecorder = null; }
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
  w.MediaRecorder = function () { return { start() {}, stop() {}, state: 'inactive', mimeType: 'audio/webm' }; };
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
console.log('\n── Teste · tempo limite da transcrição 1.6.178 (' + ARQ + ') ' + '─'.repeat(6));
if (!w.__T) { console.log('   FALHA gancho não rodou: ' + (w.__GANCHO_ERRO__ || erros.join(' | '))); process.exit(1); }
const T = w.__T;
const $ = (id) => w.document.getElementById(id);
const tick = () => new Promise((r) => setImmediate(r));
async function drenar() { for (let i = 0; i < 20; i++) await tick(); }

// ── Timers falsos (a partir daqui, depois do load) ────────────────────────────
let agora = 0, seq = 0;
const timers = new Map();
w.setTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { fn, quando: agora + (Number(ms) || 0) }); return id; };
w.clearTimeout = (id) => { timers.delete(id); };
async function avancar(ms) {
  const alvo = agora + ms;
  for (;;) {
    let prox = null;
    for (const [id, t] of timers) if (t.quando <= alvo && (!prox || t.quando < prox[1].quando)) prox = [id, t];
    if (!prox) break;
    timers.delete(prox[0]); agora = prox[1].quando;
    try { prox[1].fn(); } catch (e) { erros.push('timer: ' + e.message); }
    await drenar();
  }
  agora = alvo; await drenar();
}
const timers60 = () => [...timers.values()].filter((t) => t.quando - agora > 55000).length;

// ── Dublês de fetch ──────────────────────────────────────────────────────────
let chamadas = [];
function nuncaResponde(_u, init) {
  return new Promise((_res, rej) => {
    const s = init && init.signal;
    if (s) s.addEventListener('abort', () => rej(new w.DOMException('The operation was aborted.', 'AbortError')));
  });
}
const resp = (status, corpo) => Promise.resolve({ ok: status >= 200 && status < 300, status,
  json: async () => corpo, text: async () => JSON.stringify(corpo) });
function usarFetch(f) {
  chamadas = [];
  w.fetch = (u, init) => { chamadas.push({ u: String(u), temSinal: !!(init && init.signal) }); return f(u, init, chamadas.length); };
}
function cenario(prev) {
  T.resetMic(); if (prev) T.setLive(prev);
  w.__auth.refresh = false; w.__auth.expirou = 0;
  timers.clear();
}
const blob = new w.Blob([new Uint8Array(100)], { type: 'audio/webm' });
const MSG = 'A transcrição demorou. Toque no microfone e fale de novo.';

// 1. fetch que nunca resolve, sem texto anterior
cenario('');
usarFetch(nuncaResponde);
let fim = false; T.transcrever(blob).then(() => { fim = true; });
await drenar();
confere($('tbox').textContent.indexOf('Transcrevendo') >= 0, '1 tbox em Transcrevendo enquanto espera');
confere(chamadas.length === 1 && chamadas[0].u.indexOf('quick-api?transcribe=1') >= 0 && chamadas[0].temSinal, '1 fetch do transcribe com signal', JSON.stringify(chamadas));
await avancar(59999);
confere(!fim, '1 aos 59,999 s ainda esperando');
await avancar(1);
confere(fim, '1 aos 60 s o await termina');
confere($('tbox').textContent === MSG, '1 tbox mostra a mensagem nova', $('tbox').textContent);
confere($('tbox').className === 'tbox', '1 className = tbox', $('tbox').className);
confere($('sv-btn').disabled === true, '1 sv-btn desabilitado (sem texto)');
$('mic-btn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await drenar();
confere(T.estado().isRecording === true && $('tbox').textContent.indexOf('Gravando') === 0, '1 mic volta a gravar no toque seguinte', $('tbox').textContent);

// 2. o mesmo com texto anterior
cenario('Boa tarde, tudo bem?');
usarFetch(nuncaResponde);
fim = false; T.transcrever(blob).then(() => { fim = true; });
await drenar(); await avancar(60000);
confere(fim && $('tbox').textContent === 'Boa tarde, tudo bem? ' + MSG, '2 mantém o texto anterior + mensagem', $('tbox').textContent);
confere($('tbox').className === 'tbox live', '2 className = tbox live', $('tbox').className);
confere($('sv-btn').disabled === false, '2 sv-btn habilitado (há texto)');

// 3. fetch normal
cenario('');
usarFetch(() => resp(200, { text: 'boa tarde' }));
await T.transcrever(blob); await drenar();
confere($('tbox').textContent === 'boa tarde ●' && $('tbox').className === 'tbox live' && $('sv-btn').disabled === false, '3 normal: texto, live, sv-btn habilitado', $('tbox').textContent);
confere(chamadas.length === 1, '3 uma chamada');
confere(timers60() === 0, '3 tempo limite cancelado depois da resposta');

// 4. 401 + refresh + 200
cenario('');
w.__auth.refresh = true;
usarFetch((_u, _i, n) => (n === 1 ? resp(401, { error: 'x' }) : resp(200, { text: 'segunda' })));
await T.transcrever(blob); await drenar();
confere(chamadas.length === 2 && chamadas.every((c) => c.temSinal), '4 duas chamadas, ambas com signal', JSON.stringify(chamadas));
confere($('tbox').textContent === 'segunda ●' && w.__auth.expirou === 0, '4 texto da segunda chamada', $('tbox').textContent);
confere(timers60() === 0, '4 nenhum tempo limite pendente');

// 4b. 401, refresh ok, e a repetição nunca responde: também tem tempo limite
cenario('');
w.__auth.refresh = true;
usarFetch((u, i, n) => (n === 1 ? resp(401, { error: 'x' }) : nuncaResponde(u, i)));
fim = false; T.transcrever(blob).then(() => { fim = true; });
await drenar(); await avancar(60000);
confere(fim && $('tbox').textContent === MSG, '4b repetição presa também estoura em 60 s', $('tbox').textContent);

// 5. 401 persistente
cenario('');
usarFetch(() => resp(401, { error: 'x' }));
await T.transcrever(blob); await drenar();
confere(w.__auth.expirou === 1, '5 401 persistente chama showAuthExpired');

// 6. 502 do servidor
cenario('');
usarFetch(() => resp(502, { error: 'Erro na transcrição: deepgram_indisponivel' }));
await T.transcrever(blob); await drenar();
confere($('tbox').textContent === '(erro na transcrição — tente novamente)' && $('tbox').className === 'tbox' && $('sv-btn').disabled === true, '6 502: mensagem de erro de transcrição', $('tbox').textContent);

// 7. erro de rede
cenario('');
usarFetch(() => Promise.reject(new TypeError('Failed to fetch')));
await T.transcrever(blob); await drenar();
confere($('tbox').textContent === '(erro de conexão)' && $('sv-btn').disabled === true, '7 erro de rede continua (erro de conexão)', $('tbox').textContent);

confere(erros.length === 0, 'nenhum erro de jsdom', erros.join(' | '));
console.log(`\n   ${ok} ok, ${falhas} falha(s)`);
dom.window.close();
process.exit(falhas ? 1 : 0);
