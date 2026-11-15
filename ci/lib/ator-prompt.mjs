// ci/lib/ator-prompt.mjs — monta o prompt do ator (buildActorSystem) a partir do texto do
// simulador/index.html, em jsdom, pelo mesmo caminho do app:
//   station = <estacao>; p = parsePatient(station); actorInstr = parseActorInstructions(station);
//   buildActorSystem(p, actorInstr)
// As funcoes vivem dentro da IIFE principal (nada vaza para window). Por isso um gancho e
// injetado no fim da IIFE, SO no texto carregado pelo teste: ele expoe uma funcao
// window.__montarPromptAtor(estacao). O arquivo publicado nao muda.
// Nada de rede: Supabase, fetch, audio e microfone sao dublados.
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { scriptsInline } from './html.mjs';

const GANCHO = `
;try{
  window.__montarPromptAtor = function(est){
    var antes = station;
    station = est;
    try{
      var p = parsePatient(station);
      var actorInstr = parseActorInstructions(station);
      return buildActorSystem(p, actorInstr);
    } finally { station = antes; }
  };
  // Chama renderReply com a estacao dada e devolve o que foi para a tela (addMsg) e para a voz
  // (speak). addMsg e speak sao dublados SO durante a chamada e restaurados no fim.
  window.__renderReplyCapturado = function(est, reply){
    var antes = station, addOrig = addMsg, speakOrig = speak, msgs = [], falas = [];
    station = est;
    addMsg = function(type, text){ msgs.push({ type: type, text: text }); return { remove: function(){} }; };
    speak = function(text, who){ falas.push({ text: text, who: who }); };
    try{ renderReply(reply); }
    finally { addMsg = addOrig; speak = speakOrig; station = antes; }
    return JSON.stringify({ msgs: msgs, falas: falas });
  };
}catch(e){ window.__GANCHO_ERRO__ = String(e && e.message || e); }
`;

function inlinarScriptsLocais(html, dir) {
  return html.replace(
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
}

/**
 * Carrega um texto de index.html em jsdom e devolve { montar(estacao) -> string, erros, fechar() }.
 * `dir` e a pasta de onde os <script src> locais sao lidos (normalmente simulador/).
 */
export async function carregarMontador(html, dir = 'simulador') {
  const erros = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => erros.push(e.message));
  const dom = new JSDOM(injetar(inlinarScriptsLocais(html, dir)), {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://simulador.revalidaosce.com.br/', virtualConsole: vc, beforeParse: dublar,
  });
  await new Promise((r) => setTimeout(r, 400));
  const w = dom.window;
  if (typeof w.__montarPromptAtor !== 'function') {
    dom.window.close();
    throw new Error('gancho nao rodou: ' + (w.__GANCHO_ERRO__ || erros.join(' | ') || 'sem detalhe'));
  }
  return {
    // JSON ida e volta: a estacao entra no realm do jsdom como objeto simples.
    montar: (estacao) => w.__montarPromptAtor(w.JSON.parse(JSON.stringify(estacao))),
    renderReply: (estacao, reply) => JSON.parse(w.__renderReplyCapturado(w.JSON.parse(JSON.stringify(estacao)), reply)),
    erros,
    fechar: () => dom.window.close(),
  };
}
