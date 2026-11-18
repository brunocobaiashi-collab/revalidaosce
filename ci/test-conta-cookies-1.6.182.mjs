// Teste do cartao Privacidade e cookies na tela Conta (v1.6.182), em jsdom, com o consent.js real embutido
// e os cookies num CookieJar; cliente Supabase dublado. Sem rede. Valores sempre ficticios.
// Rodar a partir da raiz:  node ci/test-conta-cookies-1.6.182.mjs [arquivo]   (saida 1 = falhou)
//
// Prova, nos 4 perfis (pagante, admin, trial, trial esgotado):
//  - o cartao existe uma vez so, depois de Aparencia, e o link antigo #acct-cookies-link nao existe mais;
//  - estado null, ad:true e ad:false mostram o texto certo, com a data em DD/MM/AAAA;
//  - ts hostil (HTML, texto longo, data com lixo) nunca vira HTML e a data e omitida;
//  - clicar em #acct-cookies-btn reabre o banner e nao navega; clicar no link da politica nao abre o banner;
//  - depois de escolher no banner, a linha de estado se atualiza (RoConsent.aoMudar), sem ouvinte duplicado;
//  - sem window.RoConsent, renderAccountScreen termina sem excecao e a linha fica vazia;
//  - o menu do avatar nao tem mais item de cookies (#btn-menu-cookies ausente, nenhum [data-ro-cookies] no dropdown)
//    e os demais itens do menu continuam la;
//  - as 6 funcoes criticas existem e a matriz de acesso dos 4 perfis e igual a da main.
// Contra a 1.6.181 (sem o cartao) reprova.
// Requer jsdom:  npm install --no-save jsdom
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { JSDOM, VirtualConsole, CookieJar } from 'jsdom';
import { scriptsInline } from './lib/html.mjs';

const ARQ = process.argv[2] || 'simulador/index.html';
let ok = 0, falhas = 0;
function confere(cond, nome, extra) {
  if (cond) { ok++; console.log('   ok    ' + nome); }
  else { falhas++; console.log('   FALHA ' + nome + (extra ? '  ::  ' + extra : '')); }
}
const rejeicoes = [];
process.on('unhandledRejection', (e) => { rejeicoes.push(String(e && e.message || e)); });

// Cliente Supabase falso, montado DENTRO da IIFE (substitui supabaseClient e supaFetch).
const GANCHO = `
;try{
  window.__rpc = [];
  window.__CFG = window.__CFG || { profile: null, sub: null, trialRem: 0, rpcAttr: 'ok' };
  function __chain(tbl){
    var q = { select: function(){ return q; }, eq: function(){ return q; }, in: function(){ return q; }, gt: function(){ return q; },
      order: function(){ return q; }, limit: function(){ return q; }, update: function(){ return q; }, insert: function(){ return q; },
      upsert: function(){ return q; }, delete: function(){ return q; }, is: function(){ return q; }, neq: function(){ return q; },
      single: async function(){ return { data: tbl === 'profiles' ? window.__CFG.profile : null, error: null }; },
      maybeSingle: async function(){ return { data: tbl === 'subscriptions' ? window.__CFG.sub : null, error: null }; },
      then: function(res, rej){ return Promise.resolve({ data: [], error: null }).then(res, rej); } };
    return q;
  }
  supabaseClient = {
    from: function(t){ return __chain(t); },
    rpc: function(nome, args){
      if(nome === 'registrar_atribuicao' || nome === 'apagar_minha_atribuicao'){
        window.__rpc.push({ nome: nome, args: args === undefined ? null : JSON.parse(JSON.stringify(args)) });
        var m = window.__CFG.rpcAttr;
        if(m === 'throw') throw new Error('rpc lancou');
        if(m === 'reject') return Promise.reject(new Error('rpc rejeitou'));
        if(m === 'okfalse') return Promise.resolve({ data: { ok: false }, error: null });
        return Promise.resolve({ data: nome === 'apagar_minha_atribuicao' ? { ok: true, apagadas: 1 } : { ok: true, gravado: true }, error: null });
      }
      if(nome === 'get_trial_status') return Promise.resolve({ data: { remaining: window.__CFG.trialRem }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    channel: function(){ var c = { on: function(){ return c; }, subscribe: function(){ return c; }, unsubscribe: function(){}, track: async function(){} }; return c; },
    removeChannel: function(){},
    auth: { getSession: async function(){ return { data: { session: null } }; }, onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; },
      signOut: async function(){ return { error: null }; } }
  };
  supaFetch = async function(){ return { ok: true, status: 200, json: async function(){ return []; } }; };
  window.__T = {
    login: function(u){ currentUser = u; currentSession = { user: u, access_token: 'x' }; _loginHandled = false; return onLoginSuccess(); },
    kiwify: function(m){ return _kiwifyLink(m); },
    origem: function(){ return lerOrigemAnuncio(); },
    showAccessRequired: function(m){ return showAccessRequired(currentUser, null, m); },
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
function dublar(w, ls, cfg) {
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
  // gtag dublado (sem aceite o consent.js nao define o seu; com aceite ele o substitui e grava no dataLayer)
  w.__gtag = []; w.gtag = function () { w.__gtag.push(Array.from(arguments)); }; w.dataLayer = [];
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
  w.addEventListener('click', (e) => { const a = e.target && e.target.closest && e.target.closest('a'); if (a) e.preventDefault(); });
  for (const [k, v] of Object.entries(ls || {})) w.localStorage.setItem(k, v);
  w.__CFG = cfg;
}

const HTML = injetar(prepararHTML(ARQ));
const espera = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const URL_APP = 'https://simulador.revalidaosce.com.br/';
const ck = (n, v) => n + '=' + encodeURIComponent(JSON.stringify(v)) + '; path=/; domain=.revalidaosce.com.br';
const consent = (ad, ts) => ck('rosce_consent', { v: 1, ad, ts });
const PERFIS = {
  pagante: { profile: { role: 'user', subscription_status: 'active', subscription_expires_at: '2099-01-01T00:00:00Z' }, trialRem: 0 },
  admin: { profile: { role: 'admin', subscription_status: null, subscription_expires_at: null }, trialRem: 0 },
  trial: { profile: { role: 'user', subscription_status: null, subscription_expires_at: null }, trialRem: 2 },
  trial_esgotado: { profile: { role: 'user', subscription_status: null, subscription_expires_at: null }, trialRem: 0 },
};
const diasAtras = (n) => new Date(Date.now() - n * 86400000).toISOString();
function usuario(id) {
  return { id, email: 'teste-' + id + '@example.com', email_confirmed_at: diasAtras(40), created_at: diasAtras(40),
    last_sign_in_at: new Date().toISOString(), app_metadata: { provider: 'email' }, identities: [{ provider: 'email' }], user_metadata: { full_name: 'Teste' } };
}
const erros = [];
async function abrir({ cookies = [], perfil = 'pagante' } = {}) {
  const jar = new CookieJar();
  for (const c of cookies) jar.setCookieSync(c, URL_APP);
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/navigation/i.test(e.message)) erros.push(e.message); });
  const cfg = Object.assign({ sub: null, rpcAttr: 'ok' }, JSON.parse(JSON.stringify(PERFIS[perfil])));
  const dom = new JSDOM(HTML, { url: URL_APP, runScripts: 'dangerously', pretendToBeVisual: true, cookieJar: jar, virtualConsole: vc,
    beforeParse: (w) => dublar(w, {}, cfg) });
  await espera(300);
  const w = dom.window;
  if (!w.__T) { console.log('   FALHA gancho nao rodou: ' + (w.__GANCHO_ERRO__ || 'script abortou')); process.exit(1); }
  return { dom, w, d: w.document, T: w.__T };
}
async function conta(t, perfil) {
  await t.T.login(usuario('u-' + perfil)); await espera(60);
  await t.w.renderAccountScreen(); await espera(40);
}
const estado = (t) => { const el = t.d.getElementById('acct-cookies-status'); return el ? el.textContent : null; };
const banner = (t) => { const b = t.d.getElementById('ro-consent'); return !!b && !b.hidden; };
const clicar = (t, el) => { const ev = new t.w.MouseEvent('click', { bubbles: true, cancelable: true }); if (el) el.dispatchEvent(ev); return ev; };
const ACEITO_TXT = 'Cookies de mensuração e publicidade: aceitos em 05/03/2026.';
const RECUSADO_TXT = 'Cookies de mensuração e publicidade: recusados em 05/03/2026.';

// ── 1) Estrutura e estados, nos 4 perfis ───────────────────────────────────────
for (const perfil of Object.keys(PERFIS)) {
  for (const [rot, cookies, esperado] of [
    ['null', [], 'Você ainda não escolheu.'],
    ['ad:true', [consent(true, '2026-03-05')], ACEITO_TXT],
    ['ad:false', [consent(false, '2026-03-05')], RECUSADO_TXT],
  ]) {
    const t = await abrir({ cookies, perfil });
    let lancou = null;
    try { await conta(t, perfil); } catch (e) { lancou = e; }
    confere(!lancou, `${perfil} / ${rot}: renderAccountScreen sem excecao`, lancou && String(lancou));
    confere(t.d.body.getAttribute('data-screen') === 's-account', `${perfil} / ${rot}: tela Conta`);
    const cards = [...t.d.querySelectorAll('#s-account .acct-grid > .card')];
    const alvo = cards.filter((c) => /Privacidade e cookies/.test((c.querySelector('.clabel') || {}).textContent || ''));
    confere(alvo.length === 1, `${perfil} / ${rot}: cartao Privacidade e cookies existe uma vez`, String(alvo.length));
    if (rot === 'null') {
      const i = cards.indexOf(alvo[0]);
      confere(i > 0 && /Apar/.test(cards[i - 1].querySelector('.clabel').textContent) && i === cards.length - 1, `${perfil}: cartao logo depois de Aparencia, ultimo da grade`);
      confere(!t.d.getElementById('acct-cookies-link'), `${perfil}: link antigo #acct-cookies-link removido`);
      const btn = t.d.getElementById('acct-cookies-btn');
      confere(!!btn && btn.hasAttribute('data-ro-cookies') && btn.getAttribute('type') === 'button' && !btn.hasAttribute('onclick') && btn.textContent.trim() === 'Alterar minha escolha',
        `${perfil}: botao Alterar minha escolha com data-ro-cookies, sem onclick`);
      const pol = alvo[0] && alvo[0].querySelector('a[href="https://revalidaosce.com.br/politica-privacidade.html#cookies"]');
      confere(!!pol && pol.target === '_blank' && pol.rel === 'noopener' && !pol.hasAttribute('data-ro-cookies'), `${perfil}: link da politica sem data-ro-cookies`);
      confere(alvo[0] && alvo[0].textContent.includes('Os cookies de mensuração e publicidade só são ativados se você aceitar. Recusar não impede nenhum uso do simulador.'),
        `${perfil}: texto fixo presente`);
    }
    confere(estado(t) === esperado, `${perfil} / ${rot}: estado "${esperado}"`, JSON.stringify(estado(t)));
    t.dom.window.close();
  }
}

// ── 2) ts hostil ou invalido: data omitida, nada vira HTML ─────────────────────
for (const ts of ['<img src=x onerror="window.__xss=1">', 'a'.repeat(5000), '2026-03-05<b>x</b>', '05/03/2026', 12345, null]) {
  const t = await abrir({ cookies: [consent(true, ts)] });
  await conta(t, 'pagante');
  const el = t.d.getElementById('acct-cookies-status');
  confere(estado(t) === 'Cookies de mensuração e publicidade: aceitos.' && el.children.length === 0 && t.w.__xss === undefined && !t.d.querySelector('#s-account img[src="x"]'),
    `ts hostil (${String(ts).slice(0, 24)}): data omitida, so texto`, JSON.stringify(estado(t)).slice(0, 120));
  t.dom.window.close();
}

// ── 3) Botao reabre o banner, nao navega; link da politica nao abre ────────────
{
  const t = await abrir({ cookies: [consent(true, '2026-03-05')] });
  await conta(t, 'pagante');
  confere(!banner(t), 'com escolha feita, banner fechado na Conta');
  const pol = t.d.querySelector('#s-account a[href*="politica-privacidade.html#cookies"]');
  clicar(t, pol); await espera(20);
  confere(!banner(t), 'clicar no link da politica nao abre o banner');
  const href = t.w.location.href;
  const ev = clicar(t, t.d.getElementById('acct-cookies-btn')); await espera(20);
  confere(banner(t), 'clicar em Alterar minha escolha reabre o banner (#ro-consent visivel)');
  confere(t.w.location.href === href && ev.defaultPrevented, 'botao nao navega');
  // escolher Recusar no banner: a linha se atualiza
  const nao = t.d.querySelector('#ro-consent button[data-ro-c="nao"]');
  clicar(t, nao); await espera(20);
  const ts = new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
  confere(estado(t) === 'Cookies de mensuração e publicidade: recusados em ' + ts + '.', 'recusar no banner atualiza a linha de estado', JSON.stringify(estado(t)));
  // abrir a Conta de novo nao duplica o ouvinte; aceitar atualiza
  await t.w.renderAccountScreen(); await t.w.renderAccountScreen(); await espera(20);
  let chamadas = 0;
  const el = t.d.getElementById('acct-cookies-status');
  const desc = Object.getOwnPropertyDescriptor(t.w.Node.prototype, 'textContent');
  if (el) Object.defineProperty(el, 'textContent', { configurable: true, get() { return desc.get.call(this); }, set(v) { chamadas++; desc.set.call(this, v); } });
  clicar(t, t.d.getElementById('acct-cookies-btn')); await espera(20);
  clicar(t, t.d.querySelector('#ro-consent button[data-ro-c="sim"]')); await espera(20);
  confere(estado(t) === 'Cookies de mensuração e publicidade: aceitos em ' + ts + '.', 'aceitar no banner atualiza a linha de estado', JSON.stringify(estado(t)));
  confere(chamadas === 1, 'ouvinte aoMudar registrado uma vez so (Conta aberta 3 vezes)', String(chamadas));
  t.dom.window.close();
}
// primeira escolha feita na propria Conta (estado null -> aceito)
{
  const t = await abrir();
  await conta(t, 'trial');
  confere(banner(t) && estado(t) === 'Você ainda não escolheu.', 'sem escolha: banner aberto e estado null na Conta');
  clicar(t, t.d.querySelector('#ro-consent button[data-ro-c="sim"]')); await espera(20);
  confere(/^Cookies de mensuração e publicidade: aceitos em \d{2}\/\d{2}\/\d{4}\.$/.test(estado(t)), 'primeira escolha na Conta atualiza a linha', JSON.stringify(estado(t)));
  t.dom.window.close();
}

// ── 4) Sem window.RoConsent ────────────────────────────────────────────────────
for (const perfil of Object.keys(PERFIS)) {
  const t = await abrir({ perfil });
  await t.T.login(usuario('u-sem-rc-' + perfil)); await espera(60);
  delete t.w.RoConsent;
  let lancou = null;
  try { await t.w.renderAccountScreen(); } catch (e) { lancou = e; }
  confere(!lancou && estado(t) === '' && t.d.body.getAttribute('data-screen') === 's-account' && t.d.getElementById('acct-plan-title').textContent !== '',
    `sem RoConsent / ${perfil}: Conta renderiza, linha vazia`, lancou ? String(lancou) : JSON.stringify(estado(t)));
  t.dom.window.close();
}
// RoConsent.estado que lanca, e RoConsent sem aoMudar
{
  const t = await abrir();
  await t.T.login(usuario('u-rc-quebrado')); await espera(60);
  t.w.RoConsent = { estado() { throw new Error('quebrado'); } };
  let lancou = null;
  try { await t.w.renderAccountScreen(); } catch (e) { lancou = e; }
  confere(!lancou && estado(t) === 'Você ainda não escolheu.', 'RoConsent.estado que lanca e sem aoMudar: nada quebra', lancou && String(lancou));
  t.dom.window.close();
}

// ── 5) Menu do avatar sem item de cookies, nos 4 perfis ────────────────────────
const ITENS_MENU = ['btn-menu-account', 'btn-menu-history', 'btn-menu-messages', 'btn-admin-link', 'menu-sub-link', 'btn-change-pass', 'btn-delete-account', 'btn-logout'];
for (const perfil of Object.keys(PERFIS)) {
  const t = await abrir({ cookies: [consent(true, '2026-03-05')], perfil });
  await t.T.login(usuario('u-avatar-' + perfil)); await espera(60);
  const dd = t.d.getElementById('user-dropdown');
  confere(!!dd && !t.d.getElementById('btn-menu-cookies') && dd.querySelectorAll('[data-ro-cookies]').length === 0,
    `${perfil}: menu do avatar sem item de cookies`);
  const faltam = ITENS_MENU.filter((id) => !(dd && dd.querySelector('#' + id)));
  confere(faltam.length === 0, `${perfil}: demais itens do menu presentes`, faltam.join(','));
  t.dom.window.close();
}

// ── 6) Funcoes criticas e matriz de acesso igual a da main ─────────────────────
{
  const t = await abrir();
  confere(Object.values(t.T.criticas).every((x) => x === 'function'), 'as 6 funcoes criticas presentes', JSON.stringify(t.T.criticas));
  t.dom.window.close();
}
function matriz(arq) {
  return execFileSync(process.execPath, ['ci/test-funil-trial-1.6.174.mjs', arq, '--so-matriz'], { encoding: 'utf8' });
}
let base = null;
try { base = execFileSync('git', ['show', 'origin/main:simulador/index.html'], { encoding: 'utf8', maxBuffer: 64 << 20 }); } catch (_) {
  try { base = execFileSync('git', ['show', 'main:simulador/index.html'], { encoding: 'utf8', maxBuffer: 64 << 20 }); } catch (_e) { base = null; }
}
if (!base) console.log('   aviso  main indisponivel (clone raso): matriz nao comparada');
else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matriz-'));
  fs.writeFileSync(path.join(dir, 'index.html'), base);
  try { fs.writeFileSync(path.join(dir, 'consent.js'), execFileSync('git', ['show', 'origin/main:simulador/consent.js'], { encoding: 'utf8' })); } catch (_) {}
  const mBase = matriz(path.join(dir, 'index.html')), mNova = matriz(ARQ);
  fs.rmSync(dir, { recursive: true, force: true });
  confere(mBase === mNova, 'matriz de acesso dos 4 perfis igual a da main', mNova);
}

confere(erros.length === 0, 'sem excecao em runtime', erros.slice(0, 5).join(' | '));
confere(rejeicoes.length === 0, 'sem promessa rejeitada sem tratamento', rejeicoes.slice(0, 5).join(' | '));
console.log(`\n   ${ok} OK / ${falhas} FALHA`);
process.exit(falhas ? 1 : 0);
