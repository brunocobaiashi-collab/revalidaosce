// Teste dos rotulos de checkout da tela Conta (v1.6.180), em jsdom, com o cliente Supabase dublado. Sem rede.
// Rodar a partir da raiz:  node ci/test-rotulos-checkout-1.6.180.mjs [arquivo]   (saida 1 = falhou)
//
// Prova: o cartao "Sem assinatura ativa" (menu da conta) leva utm_medium=conta_inativa; o botao
// "Assinar acesso ilimitado" do trial na Conta leva utm_medium=conta_trial; o banner do trial segue
// com trial_banner e o paywall com blocked_screen; todos com utm_source=app e /OpKRKOr.
// O contador de cliques (checkout_click) le o rotulo novo sem lista fechada.
// Contra a 1.6.179 tem de falhar nos dois defeitos.
// Requer jsdom:  npm install --no-save jsdom
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
  window.__ux = []; window.__abertos = [];
  window.__CFG = { profile: null, sub: null, trialRem: 0, plano: null, planoErro: false, catalogo: null, catalogoErro: false };
  function __chain(tbl){
    var q = { select: function(){ return q; }, eq: function(){ return q; }, in: function(){ return q; }, gt: function(){ return q; },
      order: function(){ return q; }, limit: function(){ return q; },
      single: async function(){ return { data: tbl === 'profiles' ? window.__CFG.profile : null, error: null }; },
      maybeSingle: async function(){ return { data: tbl === 'subscriptions' ? window.__CFG.sub : null, error: null }; },
      then: function(res){ return Promise.resolve({ data: [], error: null }).then(res); } };
    return q;
  }
  supabaseClient = {
    from: function(t){ return __chain(t); },
    rpc: function(nome, args){
      if(nome === 'log_ux_event'){ window.__ux.push({ ev: args.p_event, d: args.p_detail }); return Promise.resolve({ data: null, error: null }); }
      if(nome === 'get_trial_status') return Promise.resolve({ data: { remaining: window.__CFG.trialRem }, error: null });
      if(nome === 'get_plano_semana'){
        if(window.__CFG.planoErro) return Promise.reject(new Error('rpc falhou'));
        return Promise.resolve({ data: window.__CFG.plano, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    auth: { getSession: async function(){ return { data: { session: null } }; }, onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; } }
  };
  supaFetch = async function(p){
    if(String(p).indexOf('stations_catalog') >= 0){
      if(window.__CFG.catalogoErro) return { ok: false, status: 500, json: async function(){ return []; } };
      return { ok: true, status: 200, json: async function(){ return window.__CFG.catalogo; } };
    }
    return { ok: true, status: 200, json: async function(){ return []; } };
  };
  window.open = function(u){ window.__abertos.push(u); return null; };
  window.__T = {
    usuario: function(u){ currentUser = u; },
    modo: function(m, r){ window.__accessMode = m; window.__trialRemaining = r; },
    maratona: function(v){ marathonActive = v; },
    reeval: function(v){ _histReevalCtx = v; },
    checkSubscription: checkSubscription,
    showAccessRequired: function(m){ return showAccessRequired(currentUser, null, m); },
    show: show,
    banner: showTrialBanner,
    conta: renderAccountScreen,
    subInfo: renderSubscriptionInfo,
    msgAcao: msgAcao,
    temFn: function(n){ try{ return typeof eval(n) === 'function'; }catch(e){ return false; } },
    cta: function(led, vigente){ var S = { seq: _stationSeq, station: station }; if(vigente === false) S = { seq: -1, station: station }; return mostrarCtaTrial(led, S); },
    loadStationEspia: function(){ window.__loads = []; loadStation = function(id, a, b){ window.__loads.push([id, a, b]); }; },
    criticas: { loginWithGoogle: typeof loginWithGoogle, loginWithEmail: typeof loginWithEmail, checkSubscription: typeof checkSubscription,
      loadStation: typeof loadStation, fetchStations: typeof fetchStations, onLoginSuccess: typeof onLoginSuccess }
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
  w.HTMLMediaElement.prototype.play = async () => {};
  w.HTMLMediaElement.prototype.pause = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    closePath() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, fillText() {}, measureText: () => ({ width: 40 }), setLineDash() {},
    createLinearGradient: () => ({ addColorStop() {} }) });
  // nenhuma navegacao de verdade nos cliques em link
  w.addEventListener('click', (e) => { const a = e.target && e.target.closest && e.target.closest('a'); if (a) e.preventDefault(); });
}

const erros = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/navigation/i.test(e.message)) erros.push(e.message); });
const dom = new JSDOM(injetar(prepararHTML(ARQ)), {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://simulador.revalidaosce.com.br/', virtualConsole: vc, beforeParse: dublar,
});
await new Promise((r) => setTimeout(r, 400));
const w = dom.window, d = w.document, T = w.__T;
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));
if (!T) { console.log('   FALHA gancho nao rodou: ' + (w.__GANCHO_ERRO__ || 'script abortou')); process.exit(1); }

const USR = { id: 'u-1', email: 'teste@example.com', email_confirmed_at: '2026-11-01T00:00:00Z', user_metadata: { full_name: 'Teste Silva' } };
const BASE = 'https://pay.kiwify.com.br/OpKRKOr';
function params(href) {
  try { const u = new URL(href); return { caminho: u.origin + u.pathname, source: u.searchParams.get('utm_source'), medium: u.searchParams.get('utm_medium'), campaign: u.searchParams.get('utm_campaign') }; }
  catch (_) { return { caminho: null }; }
}
function rotulo(href, medium, campaign, nome) {
  const p = params(href);
  confere(p.caminho === BASE && p.source === 'app' && p.medium === medium && p.campaign === campaign,
    nome + ': ' + medium, href);
}
async function cliques(fn) {
  w.__ux.length = 0; await fn(); await espera();
  return w.__ux.filter((u) => u.ev === 'checkout_click').map((x) => x.d.origem);
}
T.usuario(USR);

// 1) Cartao "Sem assinatura ativa" (inactive e unknown) no menu da conta
for (const tipo of ['inactive', 'unknown']) {
  T.subInfo({ type: tipo });
  const a = d.querySelector('#menu-sub-detail a');
  rotulo(a && a.getAttribute('href'), 'conta_inativa', 'in_app', 'cartao Sem assinatura ativa (' + tipo + ')');
}
T.modo('trial_exhausted', 0);
const oInat = await cliques(() => d.querySelector('#menu-sub-detail a').click());
confere(JSON.stringify(oInat) === '["conta_inativa"]', 'checkout_click le conta_inativa do href', JSON.stringify(oInat));

// 2) Botao do trial na tela Conta (trial e trial esgotado)
for (const [m, r] of [['trial', 2], ['trial_exhausted', 0]]) {
  T.modo(m, r); await T.conta();
  const b = d.getElementById('acct-plan-btn');
  rotulo(b.getAttribute('href'), 'conta_trial', 'in_app', 'botao Assinar da Conta (' + m + ')');
  confere(b.style.display !== 'none' && b.getAttribute('data-ux-origem') === 'conta', 'botao da Conta visivel e com data-ux-origem=conta (' + m + ')');
}
const oConta = await cliques(() => d.getElementById('acct-plan-btn').click());
confere(JSON.stringify(oConta) === '["conta"]', 'checkout_click da Conta segue com origem conta', JSON.stringify(oConta));

// 3) Pagante e admin: botao da Conta nao e checkout
for (const m of ['subscriber', 'admin']) {
  T.modo(m, null); await T.conta();
  const b = d.getElementById('acct-plan-btn');
  const h = b.getAttribute('href') || '';
  confere(b.style.display === 'none' || !h.includes('pay.kiwify.com.br'), 'sem checkout na Conta para ' + m, h);
}

// 4) Intocados: banner do trial e paywall
T.modo('trial', 2); T.banner(2);
const ban = d.querySelector('#trial-banner a[href*="pay.kiwify.com.br"]');
rotulo(ban && ban.getAttribute('href'), 'trial_banner', 'in_app', 'banner do trial intocado');
T.modo('trial_exhausted', 0); T.showAccessRequired('trial_exhausted');
rotulo(d.getElementById('btn-acquire-access').getAttribute('href'), 'blocked_screen', 'access_required', 'paywall intocado');

confere(erros.length === 0, 'sem excecao em runtime', erros.join(' | '));
console.log(`\n   ${ok} OK / ${falhas} FALHA`);
process.exit(falhas ? 1 : 0);
