// Portão 3 — runtime em jsdom (regra 5 do FUNCIONALIDADES).
// node --check prova que o arquivo COMPILA. Não prova que ele EXECUTA.
// Um `$('id-que-sumiu')` nulo compila perfeitamente e derruba o script inteiro
// na primeira execução — junto com o login, que é definido depois.
//
// Aqui o arquivo é carregado num motor JS real, com DOM montado, com os
// serviços externos dublados (Supabase, Turnstile, áudio, rede). Se lançar,
// reprova. Se as funções críticas não existirem depois, reprova.

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { cor, scriptsInline } from './lib/html.mjs';

const ALVOS = [
  {
    arquivo: 'simulador/index.html',
    criticas: ['loginWithGoogle', 'loginWithEmail', 'checkSubscription', 'loadStation', 'fetchStations', 'onLoginSuccess'],
  },
  {
    arquivo: 'simulador/admin.html',
    criticas: ['loadPending', 'saveStation', 'approveStation', 'loadUsers'],
  },
];

const erros = [];

function dublar(w) {
  // Supabase — o client real nunca é alcançável no CI.
  const clientFalso = new Proxy(function () {}, {
    get: (_, prop) => {
      if (prop === 'then') return undefined; // não fingir ser Promise
      if (prop === 'auth') {
        return {
          getSession: async () => ({ data: { session: null } }),
          getUser: async () => ({ data: { user: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signInWithOAuth: async () => ({ data: {}, error: null }),
          signInWithPassword: async () => ({ data: {}, error: null }),
          signOut: async () => ({ error: null }),
          setSession: async () => ({ data: {}, error: null }),
        };
      }
      return () => clientFalso;
    },
    apply: () => clientFalso,
  });
  w.supabase = { createClient: () => clientFalso };

  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  w.gtag = () => {};
  w.dataLayer = [];
  w.turnstile = { render: () => 'w-0', reset: () => {}, remove: () => {} };
  w.scrollTo = () => {};
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  w.AudioContext = w.webkitAudioContext = function () {
    return {
      createMediaElementSource: () => ({ connect() {} }),
      createGain: () => ({ connect() {}, gain: { value: 1, setValueAtTime() {} } }),
      destination: {}, state: 'running', resume: async () => {}, close: async () => {}, currentTime: 0,
    };
  };
  w.MediaRecorder = function () { return { start() {}, stop() {}, ondataavailable: null, state: 'inactive' }; };
  w.MediaRecorder.isTypeSupported = () => true;
  Object.defineProperty(w.navigator, 'mediaDevices', {
    value: { getUserMedia: async () => ({ getTracks: () => [] }) }, configurable: true,
  });
  w.HTMLMediaElement.prototype.play = async () => {};
  w.HTMLMediaElement.prototype.pause = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    closePath() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    fillText() {}, measureText: () => ({ width: 40 }), setLineDash() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  });
}

/**
 * Injeta a sonda DENTRO do bloco principal.
 * Não dá para checar `window.loginWithEmail`: o bloco é uma IIFE com
 * 'use strict' e, por invariante do §8, nada vaza para window. A sonda tem de
 * rodar no mesmo escopo — e, se o script abortar antes do fim, ela simplesmente
 * não roda, que é exatamente o sinal que se quer detectar.
 */
function injetarSonda(html, nomes) {
  const pares = nomes.map((n) => `${JSON.stringify(n)}: (typeof ${n})`).join(', ');
  const sonda = `\n;try{window.__CI_SONDA__={${pares}};}catch(e){window.__CI_SONDA_ERRO__=String(e&&e.message||e);}\n`;

  const blocos = scriptsInline(html);
  const principal = blocos.reduce((a, b) => (b.codigo.length > (a ? a.codigo.length : 0) ? b : a), null);
  if (!principal) return { html, ok: false };

  const codigo = principal.codigo;
  const fimIIFE = codigo.lastIndexOf('})()');
  const posicao = fimIIFE >= 0 && fimIIFE > codigo.length - 400 ? fimIIFE : codigo.length;
  const novoCodigo = codigo.slice(0, posicao) + sonda + codigo.slice(posicao);

  return {
    html: html.slice(0, principal.inicioCodigo) + novoCodigo + html.slice(principal.inicioCodigo + codigo.length),
    ok: true,
  };
}

/** Substitui <script src="..."> por conteúdo local (relativo) ou remove (CDN). */
function prepararHTML(arquivo) {
  const dir = path.dirname(arquivo);
  return fs.readFileSync(arquivo, 'utf8').replace(
    /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (tag, src) => {
      if (/^https?:|^\/\//i.test(src)) return '<!-- script externo removido no CI -->';
      const local = path.join(dir, src.split('?')[0]);
      if (!fs.existsSync(local)) return `<!-- ${src} ausente -->`;
      return `<script>${fs.readFileSync(local, 'utf8')}</script>`;
    }
  );
}

console.log(`\n── Portão 3 · runtime jsdom ${'─'.repeat(31)}`);

for (const alvo of ALVOS) {
  const problemas = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => problemas.push(`${e.message}${e.detail ? ' :: ' + String(e.detail).split('\n').slice(0, 3).join(' | ') : ''}`));

  const preparado = injetarSonda(prepararHTML(alvo.arquivo), alvo.criticas);
  if (!preparado.ok) { erros.push(`${alvo.arquivo}: não achei o bloco <script> principal para injetar a sonda`); continue; }

  let dom;
  try {
    dom = new JSDOM(preparado.html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://simulador.revalidaosce.com.br/',
      virtualConsole: vc,
      beforeParse: dubladoresAntes,
    });
  } catch (e) {
    erros.push(`${alvo.arquivo}: falhou ao montar o DOM — ${e.message}`);
    continue;
  }

  await new Promise((r) => setTimeout(r, 400)); // deixa DOMContentLoaded e init assíncrono rodarem

  for (const p of problemas) {
    erros.push(`${alvo.arquivo}: exceção em runtime — ${p}`);
  }

  const w = dom.window;
  const sonda = w.__CI_SONDA__;
  if (!sonda) {
    erros.push(`${alvo.arquivo}: a sonda no fim do bloco principal NÃO rodou — o script abortou antes do fim${w.__CI_SONDA_ERRO__ ? ' (' + w.__CI_SONDA_ERRO__ + ')' : ''}`);
  } else {
    const ausentes = alvo.criticas.filter((f) => sonda[f] !== 'function');
    if (ausentes.length) erros.push(`${alvo.arquivo}: função crítica ausente ao fim do load — ${ausentes.join(', ')}`);
    else console.log(`   ${cor.fraco(alvo.arquivo + ': sonda ok, ' + alvo.criticas.length + ' funções críticas presentes')}`);
  }
  dom.window.close();
}

function dubladoresAntes(w) { dublar(w); }

if (!erros.length) console.log(`   ${cor.ok('ok')}`);
for (const e of erros) console.log(`   ${cor.erro('ERRO')}   ${e}`);
process.exit(erros.length ? 1 : 0);
