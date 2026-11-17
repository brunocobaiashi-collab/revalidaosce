// Teste do funil do trial (v1.6.174), em jsdom, com o cliente Supabase dublado. Sem rede.
// Rodar a partir da raiz:  node ci/test-funil-trial-1.6.174.mjs [arquivo]   (saida 1 = falhou)
//
// Cobre: card de compra no resultado do trial (eval-trial-cta) para os perfis e os casos de
// falha; eventos paywall_view, checkout_click (6 origens), trial_cta_view e trial_cta_click;
// e imprime a matriz dos 4 perfis (pagante, admin, trial, trial esgotado) em JSON para
// comparar com a versao anterior (rodar com o arquivo antigo como argumento e --so-matriz).
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { scriptsInline } from './lib/html.mjs';

const ARQ = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'simulador/index.html';
const SO_MATRIZ = process.argv.includes('--so-matriz');
let ok = 0, falhas = 0;
function confere(cond, nome, extra) {
  if (cond) { ok++; if (!SO_MATRIZ) console.log('   ok    ' + nome); }
  else { falhas++; console.log('   FALHA ' + nome + (extra ? '  ::  ' + extra : '')); }
}

// Cliente Supabase falso, montado DENTRO da IIFE (substitui supabaseClient e supaFetch).
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
const visivel = (el) => !!el && el.style.display !== 'none';

// ── Matriz dos 4 perfis ───────────────────────────────────────────────────────
const PERFIS = {
  pagante: { profile: { role: 'user', subscription_status: 'active', subscription_expires_at: '2099-01-01T00:00:00Z' }, trialRem: 0 },
  admin: { profile: { role: 'admin', subscription_status: null, subscription_expires_at: null }, trialRem: 0 },
  trial: { profile: { role: 'user', subscription_status: null, subscription_expires_at: null }, trialRem: 2 },
  trial_esgotado: { profile: { role: 'user', subscription_status: null, subscription_expires_at: null }, trialRem: 0 },
};
const matriz = {};
for (const [nome, cfg] of Object.entries(PERFIS)) {
  Object.assign(w.__CFG, cfg);
  T.usuario(USR); T.modo(undefined, undefined); T.show('s-select');
  const bloq = await T.checkSubscription();
  const banner = d.getElementById('trial-banner');
  matriz[nome] = {
    bloqueado: bloq, modo: w.__accessMode, acesso: w.__hasActiveAccess, tela: d.body.getAttribute('data-screen'),
    banner: visivel(banner), titulo: bloq ? d.getElementById('access-required-title').textContent : null,
    msg: bloq ? d.getElementById('access-required-message').textContent : null,
    cta_href: d.getElementById('btn-acquire-access').getAttribute('href'),
    cta_txt: d.getElementById('btn-acquire-access').textContent,
  };
}
if (SO_MATRIZ) { console.log(JSON.stringify(matriz, null, 1)); process.exit(0); }
console.log('\n── Matriz dos 4 perfis ──');
console.log(JSON.stringify(matriz));
confere(Object.values(T.criticas).every((t) => t === 'function'), 'as 6 funcoes criticas presentes', JSON.stringify(T.criticas));
confere(matriz.trial_esgotado.cta_href === 'https://pay.kiwify.com.br/OpKRKOr?utm_source=app&utm_medium=blocked_screen&utm_campaign=access_required',
  'href/UTM do btn-acquire-access intocados');

// paywall_view no trial_exhausted (do checkSubscription acima)
const pvEsg = w.__ux.filter((u) => u.ev === 'paywall_view');
confere(pvEsg.length === 1 && pvEsg[0].d.modo === 'trial_exhausted' && pvEsg[0].d.restantes === 0 && pvEsg[0].d.de === 's-select',
  'paywall_view trial_exhausted (uma vez, de, restantes)', JSON.stringify(pvEsg));

// paywall_view locked_station
w.__ux.length = 0;
T.modo('trial', 2); T.show('s-select');
T.showAccessRequired('locked_station');
const pvL = w.__ux.filter((u) => u.ev === 'paywall_view');
confere(pvL.length === 1 && pvL[0].d.modo === 'locked_station' && pvL[0].d.de === 's-select' && pvL[0].d.restantes === 2,
  'paywall_view locked_station', JSON.stringify(pvL));

// ── Card no resultado ─────────────────────────────────────────────────────────
const CATALOGO = Array.from({ length: 281 }, (_, i) => ({ id: 's' + i, trial_available: i < 3 }));
const REC = { id: 'demo-caneta', name: 'Pedido de medicação (caneta)', area: 'Clínica Médica' };
const LED = { id: 'h-1', station_id: 'demo-atraso', score_pct: 67.4, eval_items: [] };
const box = () => d.getElementById('eval-trial-cta');
function reset(cfg = {}) {
  Object.assign(w.__CFG, { catalogo: CATALOGO, catalogoErro: false, plano: { plano_completo: false, recomendada: REC }, planoErro: false }, cfg);
  w.__ux.length = 0; T.usuario(USR); T.maratona(false); T.reeval(null);
}
const ehCard = (c) => visivel(box()) && box().innerHTML.length > 0;

for (const [m, r] of [['subscriber', null], ['admin', null]]) {
  reset(); T.modo(m, r); await T.cta(LED); await espera();
  confere(!ehCard() && !w.__ux.some((u) => u.ev === 'trial_cta_view'), 'card ausente para ' + m);
}
reset(); T.modo('trial', 2); T.maratona(true); await T.cta(LED); await espera();
confere(!ehCard(), 'card ausente na Maratona');
reset(); T.modo('trial', 2); T.reeval({ id: 'h-0' }); await T.cta(LED); await espera();
confere(!ehCard(), 'card ausente na reavaliacao');
reset(); T.modo('trial', 2); await T.cta(LED, false); await espera();
confere(!ehCard(), 'card ausente quando a sessao nao e mais vigente');
reset(); T.modo('trial', 2); T.usuario(null); await T.cta(LED); await espera();
confere(!ehCard(), 'card ausente sem currentUser');

// trial depois da 1a (restantes 2)
reset(); T.modo('trial', 2); await T.cta(LED); await espera();
let txt = box().textContent;
confere(ehCard() && txt.includes('Você ainda tem 2 estações grátis'), 'titulo 2 estacoes gratis', txt);
confere(txt.includes('mais 278 estações das provas oficiais do INEP e de curadoria, nas 5 áreas'), 'X ao vivo = 278', txt);
confere(!!box().querySelector('a.tcta-buy') && !!box().querySelector('button.tcta-next'), 'os 2 botoes');
confere(box().querySelector('button.tcta-next').textContent === 'Fazer a próxima grátis: ' + REC.name, 'nome da demo recomendada');
confere(box().querySelector('a.tcta-buy').getAttribute('href').includes('utm_medium=eval_trial_1'), 'utm eval_trial_1');
confere(box().querySelector('a.tcta-buy').getAttribute('target') === '_blank', 'assinar em nova aba');
let tv = w.__ux.filter((u) => u.ev === 'trial_cta_view');
confere(tv.length === 1 && tv[0].d.restantes === 2 && tv[0].d.feitas === 1 && tv[0].d.nota === 67, 'trial_cta_view {restantes, feitas, nota}', JSON.stringify(tv));
confere(!/banco completo|todas as estações do inep|pep oficial|R\$/i.test(txt), 'sem frase proibida nem preco');

// clique em Proxima
T.loadStationEspia(); w.__ux.length = 0;
box().querySelector('button.tcta-next').click();
confere(JSON.stringify(w.__loads) === JSON.stringify([['demo-caneta', true, true]]), 'proxima chama loadStation(id, true, true) no clique', JSON.stringify(w.__loads));
let tc = w.__ux.filter((u) => u.ev === 'trial_cta_click');
confere(tc.length === 1 && tc[0].d.acao === 'proxima' && tc[0].d.restantes === 2 && tc[0].d.feitas === 1, 'trial_cta_click proxima', JSON.stringify(tc));
confere(!w.__ux.some((u) => u.ev === 'checkout_click'), 'proxima nao gera checkout_click');

// clique em Assinar: trial_cta_click + checkout_click eval_trial
w.__ux.length = 0;
box().querySelector('a.tcta-buy').click();
tc = w.__ux.filter((u) => u.ev === 'trial_cta_click');
let cc = w.__ux.filter((u) => u.ev === 'checkout_click');
confere(tc.length === 1 && tc[0].d.acao === 'assinar', 'trial_cta_click assinar', JSON.stringify(tc));
confere(cc.length === 1 && cc[0].d.origem === 'eval_trial' && cc[0].d.modo === 'trial', 'checkout_click eval_trial', JSON.stringify(cc));

// restantes 1: singular
reset(); T.modo('trial', 1); await T.cta(LED); await espera();
confere(box().textContent.includes('Você ainda tem 1 estação grátis'), 'singular com 1 restante', box().textContent);

// trial esgotado depois da 3a
reset(); T.modo('trial_exhausted', 0); await T.cta(LED); await espera();
txt = box().textContent;
confere(ehCard() && txt.includes('Você concluiu as 3 estações grátis') && txt.includes('o plano completo tem mais 278 estações'), 'esgotado: titulo e texto', txt);
confere(!!box().querySelector('a.tcta-buy') && !box().querySelector('button.tcta-next'), 'esgotado: so Assinar');
confere(box().querySelector('a.tcta-buy').getAttribute('href').includes('utm_medium=eval_trial_3'), 'utm eval_trial_3');
tv = w.__ux.filter((u) => u.ev === 'trial_cta_view');
confere(tv.length === 1 && tv[0].d.restantes === 0 && tv[0].d.feitas === 3, 'trial_cta_view esgotado', JSON.stringify(tv));

// stations_catalog falhando: texto sem numero
reset({ catalogoErro: true }); w.eval('void 0'); T.modo('trial', 2);
// o cache da contagem ja foi preenchido acima; um DOM novo prova o caso sem cache
const dom2 = new JSDOM(injetar(prepararHTML(ARQ)), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://simulador.revalidaosce.com.br/', virtualConsole: new VirtualConsole(), beforeParse: dublar });
await new Promise((r) => setTimeout(r, 400));
const w2 = dom2.window;
Object.assign(w2.__CFG, { catalogoErro: true, plano: { plano_completo: false, recomendada: REC } });
w2.__T.usuario(USR); w2.__T.modo('trial', 2); await w2.__T.cta(LED); await espera();
const t2 = w2.document.getElementById('eval-trial-cta').textContent;
confere(t2.includes('Você ainda tem 2 estações grátis') && !/\d{2,} estações/.test(t2) && t2.includes('muito mais estações'), 'catalogo falhando: texto sem numero', t2);

// get_plano_semana falhando: sem botao de proxima
reset({ planoErro: true }); T.modo('trial', 2); await T.cta(LED); await espera();
confere(ehCard() && !box().querySelector('button.tcta-next') && !!box().querySelector('a.tcta-buy'), 'plano falhando: sem botao de proxima');
reset({ plano: { plano_completo: false, recomendada: null } }); T.modo('trial', 2); await T.cta(LED); await espera();
confere(ehCard() && !box().querySelector('button.tcta-next'), 'recomendada nula: sem botao de proxima');

// ── checkout_click: as 6 origens ──────────────────────────────────────────────
const origens = {};
async function cap(nome, fn) {
  w.__ux.length = 0; await fn(); await espera();
  const c = w.__ux.filter((u) => u.ev === 'checkout_click');
  origens[nome] = c.map((x) => x.d.origem + '/' + x.d.modo);
}
T.usuario(USR); T.modo('trial_exhausted', 0);
await cap('paywall', () => { T.showAccessRequired('trial_exhausted'); d.getElementById('btn-acquire-access').click(); });
T.modo('trial', 2);
await cap('trial_banner', () => { T.banner(2); d.querySelector('#trial-banner a[href*="pay.kiwify.com.br"]').click(); });
const hrefBanner = d.querySelector('#trial-banner a[href*="pay.kiwify.com.br"]').getAttribute('href');
await cap('conta', async () => { await T.conta(); d.getElementById('acct-plan-btn').click(); });
await cap('mensagens', () => T.msgAcao('assinar'));
await cap('invite_gate', () => d.getElementById('invite-gate-buy').click());
reset(); T.modo('trial', 2); await T.cta(LED); await espera();
await cap('eval_trial', () => box().querySelector('a.tcta-buy').click());
for (const o of ['paywall', 'trial_banner', 'conta', 'mensagens', 'invite_gate', 'eval_trial']) {
  const esperado = o === 'paywall' ? 'paywall/trial_exhausted' : o + '/trial';
  confere(origens[o].length === 1 && origens[o][0] === esperado, 'checkout_click origem ' + o, JSON.stringify(origens[o]));
}
confere(hrefBanner === 'https://pay.kiwify.com.br/OpKRKOr?utm_source=app&utm_medium=trial_banner&utm_campaign=in_app', 'banner com UTM trial_banner', hrefBanner);
confere(w.__abertos.some((u) => u.includes('utm_medium=mensagens')) && w.__abertos.some((u) => u.includes('utm_medium=signup_gate')), 'window.open de mensagens e invite intactos');

// Gerenciar assinatura (app.kiwify) nao conta
T.modo('subscriber', null); await T.conta();
w.__ux.length = 0; d.getElementById('acct-plan-btn').click(); await espera();
confere(!w.__ux.some((u) => u.ev === 'checkout_click'), 'app.kiwify (Gerenciar) nao conta');

confere(erros.length === 0, 'sem excecao em runtime', erros.join(' | '));
console.log(`\n   ${ok} OK / ${falhas} FALHA`);
process.exit(falhas ? 1 : 0);
