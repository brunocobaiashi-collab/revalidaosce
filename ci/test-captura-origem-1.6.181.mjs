// Teste da captura da origem no cadastro (S2, v1.6.181), em jsdom, com o consent.js real embutido,
// os cookies num CookieJar, o cliente Supabase e o gtag dublados. Sem rede. Valores sempre ficticios.
// Rodar a partir da raiz:  node ci/test-captura-origem-1.6.181.mjs [arquivo]   (saida 1 = falhou)
//
// Prova, nos 4 perfis (pagante, admin, trial, trial esgotado):
//  - sem aceite: nenhuma chamada a registrar_atribuicao, nenhum sck nos links (iguais aos da 1.6.180), nenhuma conversao;
//  - com aceite e cookie de origem: uma chamada com os valores certos (inclusive utm_content/utm_term),
//    sck e utm_content/utm_term nos links de checkout, rotulos de superficie intactos;
//  - conta antiga (30 dias): nenhuma chamada; segunda chamada para o mesmo usuario: nao repete (flag);
//  - RPC com {ok:false}, que lanca ou que rejeita: login e dashboard normais, sem erro;
//  - aceitou depois: registra uma vez; recusou depois de aceitar: apagar_minha_atribuicao e flag limpa
//    (no aviso do consent.js e no carregamento seguinte);
//  - Google, conta nova, com aceite: conversao Cadastro uma vez, sem e-mail nem id; recarga nao duplica;
//    sem aceite, nenhuma; login por e-mail nao dispara por este caminho;
//  - valores hostis no cookie: nada vira HTML, tudo cortado em 200 e em texto;
//  - as 6 funcoes criticas existem e a matriz de acesso dos 4 perfis e igual a da main.
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
const HOJE = new Date().toISOString().slice(0, 10);
const URL_APP = 'https://simulador.revalidaosce.com.br/';
const ck = (n, v) => n + '=' + encodeURIComponent(JSON.stringify(v)) + '; path=/; domain=.revalidaosce.com.br';
const ACEITO = ck('rosce_consent', { v: 1, ad: true, ts: HOJE });
const RECUSADO = ck('rosce_consent', { v: 1, ad: false, ts: HOJE });
const ORIGEM = { gclid: 'TESTE_S2', utm_content: '199194532778', utm_term: 'osce revalida', ts: HOJE, lp: '/' };
const ORIGEM_CK = ck('rosce_attr', ORIGEM);
const PERFIS = {
  pagante: { profile: { role: 'user', subscription_status: 'active', subscription_expires_at: '2099-01-01T00:00:00Z' }, trialRem: 0 },
  admin: { profile: { role: 'admin', subscription_status: null, subscription_expires_at: null }, trialRem: 0 },
  trial: { profile: { role: 'user', subscription_status: null, subscription_expires_at: null }, trialRem: 2 },
  trial_esgotado: { profile: { role: 'user', subscription_status: null, subscription_expires_at: null }, trialRem: 0 },
};
const TELA = { pagante: 's-dashboard', admin: 's-dashboard', trial: 's-dashboard', trial_esgotado: 's-access-required' };
const agora = () => new Date().toISOString();
const diasAtras = (n) => new Date(Date.now() - n * 86400000).toISOString();
function usuario(id, extra) {
  return Object.assign({ id, email: 'teste-' + id + '@example.com', email_confirmed_at: diasAtras(1), created_at: diasAtras(1),
    last_sign_in_at: agora(), app_metadata: { provider: 'email' }, identities: [{ provider: 'email' }], user_metadata: { full_name: 'Teste' } }, extra || {});
}

const erros = [];
async function abrir({ url = URL_APP, cookies = [], ls = {}, perfil = 'pagante', rpcAttr = 'ok' } = {}) {
  const jar = new CookieJar();
  for (const c of cookies) jar.setCookieSync(c, url);
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/navigation/i.test(e.message)) erros.push(e.message); });
  const cfg = Object.assign({ sub: null, rpcAttr }, JSON.parse(JSON.stringify(PERFIS[perfil])));
  const dom = new JSDOM(HTML, { url, runScripts: 'dangerously', pretendToBeVisual: true, cookieJar: jar, virtualConsole: vc,
    beforeParse: (w) => dublar(w, ls, cfg) });
  await espera(300);
  const w = dom.window;
  if (!w.__T) { console.log('   FALHA gancho nao rodou: ' + (w.__GANCHO_ERRO__ || 'script abortou')); process.exit(1); }
  return { dom, w, d: w.document, T: w.__T };
}
const attrRpc = (w) => w.__rpc.filter((r) => r.nome === 'registrar_atribuicao');
const apagarRpc = (w) => w.__rpc.filter((r) => r.nome === 'apagar_minha_atribuicao');
const conversoes = (w) => [...w.__gtag, ...(w.dataLayer || []).map((a) => Array.from(a))].filter((a) => a[0] === 'event' && a[1] === 'conversion');
const lsDump = (w) => { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; };
async function logar(t, u) { await t.T.login(u); await espera(80); }
const BASE = 'https://pay.kiwify.com.br/OpKRKOr';
const LINK_HOJE = BASE + '?utm_source=app&utm_medium=trial_banner&utm_campaign=in_app';
const PAYWALL_HOJE = BASE + '?utm_source=app&utm_medium=blocked_screen&utm_campaign=access_required';

// ── 1) Sem aceite (primeira visita e recusa gravada), nos 4 perfis ──────────────
for (const [rotulo, cookies] of [['sem escolha', [ORIGEM_CK]], ['recusado', [RECUSADO, ORIGEM_CK]]]) {
  for (const perfil of Object.keys(PERFIS)) {
    const t = await abrir({ url: URL_APP + '?gclid=TESTE_S2&utm_content=1&utm_term=x', cookies, perfil });
    await logar(t, usuario('u-sem-' + perfil, { app_metadata: { provider: 'google' }, created_at: agora(), last_sign_in_at: agora() }));
    confere(attrRpc(t.w).length === 0, `${rotulo} / ${perfil}: nenhuma chamada a registrar_atribuicao`);
    confere(conversoes(t.w).length === 0, `${rotulo} / ${perfil}: nenhuma conversao (Google, conta nova)`);
    confere(t.T.origem() === null, `${rotulo} / ${perfil}: lerOrigemAnuncio devolve null`);
    confere(t.T.kiwify('trial_banner') === LINK_HOJE, `${rotulo} / ${perfil}: link de checkout igual ao de hoje`, t.T.kiwify('trial_banner'));
    confere(t.d.body.getAttribute('data-screen') === TELA[perfil], `${rotulo} / ${perfil}: tela ${TELA[perfil]}`, t.d.body.getAttribute('data-screen'));
    if (perfil === 'trial_esgotado') confere(t.d.getElementById('btn-acquire-access').getAttribute('href') === PAYWALL_HOJE, `${rotulo}: paywall igual ao de hoje`);
    confere(!Object.keys(lsDump(t.w)).some((k) => /^ro_attr|^ro_cadastro_conv/.test(k)) && !Object.keys(t.w.sessionStorage).length,
      `${rotulo} / ${perfil}: nada guardado (localStorage/sessionStorage)`, JSON.stringify(lsDump(t.w)));
    t.dom.window.close();
  }
}

// ── 2) Com aceite e cookie de origem, nos 4 perfis ─────────────────────────────
for (const perfil of Object.keys(PERFIS)) {
  const t = await abrir({ cookies: [ACEITO, ORIGEM_CK], perfil });
  const u = usuario('u-ok-' + perfil);
  await logar(t, u);
  const r = attrRpc(t.w);
  confere(r.length === 1, `aceite / ${perfil}: uma chamada a registrar_atribuicao`, String(r.length));
  const a = r[0] && r[0].args;
  confere(!!a && a.p_gclid === 'TESTE_S2' && a.p_utm_content === '199194532778' && a.p_utm_term === 'osce revalida' && a.p_landing_path === '/' &&
    a.p_utm_source === null && a.p_utm_campaign === null && a.p_gbraid === null && Object.keys(a).length === 9,
    `aceite / ${perfil}: argumentos certos (Grupo 1: sem utm_source/campaign)`, JSON.stringify(a));
  confere(t.d.body.getAttribute('data-screen') === TELA[perfil], `aceite / ${perfil}: tela ${TELA[perfil]} (caminho intacto)`, t.d.body.getAttribute('data-screen'));
  confere(t.w.localStorage.getItem('ro_attr_' + u.id) === 'ok', `aceite / ${perfil}: flag ro_attr_<id> marcada`);
  const k = new URL(t.T.kiwify('trial_banner'));
  confere(k.searchParams.get('utm_source') === 'app' && k.searchParams.get('utm_medium') === 'trial_banner' && k.searchParams.get('utm_campaign') === 'in_app' &&
    k.searchParams.get('sck') === 'TESTE_S2' && k.searchParams.get('utm_content') === '199194532778' && k.searchParams.get('utm_term') === 'osce revalida',
    `aceite / ${perfil}: _kiwifyLink com sck e utm_content/term, rotulos intactos`, k.toString());
  if (perfil === 'trial_esgotado') {
    const p = new URL(t.d.getElementById('btn-acquire-access').getAttribute('href'));
    confere(p.searchParams.get('utm_source') === 'app' && p.searchParams.get('utm_medium') === 'blocked_screen' && p.searchParams.get('utm_campaign') === 'access_required' &&
      p.searchParams.get('sck') === 'TESTE_S2' && p.searchParams.get('utm_term') === 'osce revalida', 'aceite: paywall com sck/utm do anuncio e rotulo intacto', p.toString());
  }
  // segunda chamada para o mesmo usuario (novo login e recarga): nao repete
  await logar(t, u);
  confere(attrRpc(t.w).length === 1, `aceite / ${perfil}: segundo login nao repete`);
  const ls = lsDump(t.w);
  t.dom.window.close();
  const t2 = await abrir({ cookies: [ACEITO, ORIGEM_CK], perfil, ls });
  await logar(t2, u);
  confere(attrRpc(t2.w).length === 0, `aceite / ${perfil}: recarga nao repete (flag)`);
  t2.dom.window.close();
}

// URL com parametros vale mais que o cookie (visita direta ao simulador por quem ja aceitou)
{
  const t = await abrir({ url: URL_APP + '?signup=1&gclid=TESTE_URL&utm_source=google&utm_medium=cpc&utm_campaign=turma_teste&utm_content=196895070181&utm_term=revalida',
    cookies: [ACEITO, ORIGEM_CK] });
  await logar(t, usuario('u-url'));
  const a = attrRpc(t.w)[0] && attrRpc(t.w)[0].args;
  confere(!!a && a.p_gclid === 'TESTE_URL' && a.p_utm_campaign === 'turma_teste' && a.p_utm_source === 'google' && a.p_utm_content === '196895070181' && a.p_landing_path === '/',
    'aceite: parametros da URL atual tem prioridade sobre o cookie', JSON.stringify(a));
  t.dom.window.close();
}

// Aceite sem origem nenhuma: nao chama
{
  const t = await abrir({ cookies: [ACEITO] });
  await logar(t, usuario('u-sem-origem'));
  confere(attrRpc(t.w).length === 0, 'aceite sem cookie nem URL: nenhuma chamada');
  confere(t.T.kiwify('x') === BASE + '?utm_source=app&utm_medium=x&utm_campaign=in_app', 'aceite sem origem: link igual ao de hoje');
  t.dom.window.close();
}

// ── 3) Conta antiga ─────────────────────────────────────────────────────────────
{
  const t = await abrir({ cookies: [ACEITO, ORIGEM_CK] });
  await logar(t, usuario('u-velho', { created_at: diasAtras(30) }));
  confere(attrRpc(t.w).length === 0, 'conta de 30 dias: nenhuma chamada');
  await logar(t, usuario('u-8d', { created_at: diasAtras(8) }));
  confere(attrRpc(t.w).length === 0, 'conta de 8 dias: nenhuma chamada');
  await logar(t, usuario('u-6d', { created_at: diasAtras(6) }));
  confere(attrRpc(t.w).length === 1, 'conta de 6 dias (confirmou o e-mail depois): uma chamada');
  t.dom.window.close();
}

// ── 4) RPC com ok:false, que lanca e que rejeita ───────────────────────────────
for (const modo of ['okfalse', 'throw', 'reject']) {
  for (const perfil of ['pagante', 'trial_esgotado']) {
    const t = await abrir({ cookies: [ACEITO, ORIGEM_CK], perfil, rpcAttr: modo });
    const u = usuario('u-' + modo + '-' + perfil);
    const antes = erros.length;
    let lancou = null;
    try { await logar(t, u); } catch (e) { lancou = e; }
    confere(!lancou && erros.length === antes, `RPC ${modo} / ${perfil}: login sem excecao`, lancou ? String(lancou) : erros.slice(antes).join(' | '));
    confere(t.d.body.getAttribute('data-screen') === TELA[perfil], `RPC ${modo} / ${perfil}: tela ${TELA[perfil]}`);
    confere(t.w.localStorage.getItem('ro_attr_' + u.id) !== 'ok', `RPC ${modo} / ${perfil}: flag nao marcada`);
    // tenta de novo no proximo login, ate 3 vezes no total
    await logar(t, u); await logar(t, u); await logar(t, u);
    confere(attrRpc(t.w).length === 3, `RPC ${modo} / ${perfil}: no maximo 3 tentativas`, String(attrRpc(t.w).length));
    t.dom.window.close();
  }
}

// ── 5) Aceitou depois, ja logado (banner do hub) ───────────────────────────────
{
  const t = await abrir({ cookies: [ORIGEM_CK] });
  const u = usuario('u-depois', { app_metadata: { provider: 'google' }, identities: [{ provider: 'google' }], created_at: agora(), last_sign_in_at: agora() });
  await logar(t, u);
  confere(attrRpc(t.w).length === 0 && conversoes(t.w).length === 0, 'antes do aceite: nada');
  const b = t.d.querySelector('#ro-consent button[data-ro-c="sim"]');
  confere(!!b && !t.d.getElementById('ro-consent').hidden, 'banner visivel no dashboard');
  if (b) b.dispatchEvent(new t.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await espera(80);
  confere(attrRpc(t.w).length === 1, 'aceitou depois: registra uma vez', String(attrRpc(t.w).length));
  const cv = conversoes(t.w);
  confere(cv.length === 1, 'aceitou depois (Google, conta nova): conversao uma vez', String(cv.length));
  t.dom.window.close();
}

// ── 6) Recusou depois de ter aceitado ──────────────────────────────────────────
{
  const t = await abrir({ cookies: [ACEITO, ORIGEM_CK] });
  const u = usuario('u-recusa');
  await logar(t, u);
  confere(t.w.localStorage.getItem('ro_attr_' + u.id) === 'ok', 'recusa: flag marcada antes');
  t.w.RoConsent.abrir();
  await espera(20);
  const b = t.d.querySelector('#ro-consent button[data-ro-c="nao"]');
  if (b) b.dispatchEvent(new t.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await espera(60);
  confere(apagarRpc(t.w).length === 1, 'recusou depois: chama apagar_minha_atribuicao', String(apagarRpc(t.w).length));
  confere(t.w.localStorage.getItem('ro_attr_' + u.id) === null, 'recusou depois: flag limpa');
  confere(t.T.kiwify('x') === BASE + '?utm_source=app&utm_medium=x&utm_campaign=in_app', 'recusou depois: link volta ao de hoje');
  t.dom.window.close();
  // verificacao no carregamento: recusa gravada + flag de outro dia
  const t2 = await abrir({ cookies: [RECUSADO], ls: { ['ro_attr_' + u.id]: 'ok' } });
  await logar(t2, u);
  confere(apagarRpc(t2.w).length === 1 && t2.w.localStorage.getItem('ro_attr_' + u.id) === null, 'recusa gravada + flag no carregamento: apaga e limpa');
  t2.dom.window.close();
  // sem flag: nao chama
  const t3 = await abrir({ cookies: [RECUSADO] });
  await logar(t3, usuario('u-recusa-sem-flag'));
  confere(apagarRpc(t3.w).length === 0, 'recusa sem flag: nao chama apagar');
  t3.dom.window.close();
}

// ── 7) Conversao Cadastro pelo Google ──────────────────────────────────────────
{
  const g = usuario('u-google', { email: 'pessoa-teste@example.com', app_metadata: { provider: 'google' }, identities: [{ provider: 'google' }],
    created_at: agora(), last_sign_in_at: agora(), user_metadata: { full_name: 'Pessoa Teste' } });
  const t = await abrir({ cookies: [ACEITO] });
  await logar(t, g);
  let cv = conversoes(t.w);
  confere(cv.length === 1, 'Google, conta nova, com aceite: conversao uma vez', String(cv.length));
  const payload = JSON.stringify(cv);
  confere(cv[0] && cv[0][2] && cv[0][2].send_to === 'AW-18306871741/0jV-CJWNoM4cEL3jsplE' && Object.keys(cv[0][2]).length === 1,
    'conversao com o send_to do signUp e nada mais', payload);
  confere(!/example\.com|u-google|Pessoa/.test(payload), 'conversao sem e-mail, nome nem id', payload);
  await logar(t, g);
  confere(conversoes(t.w).length === 1, 'Google: segundo login na mesma pagina nao duplica');
  const ls = lsDump(t.w);
  t.dom.window.close();
  const t2 = await abrir({ cookies: [ACEITO], ls });
  await logar(t2, g);
  confere(conversoes(t2.w).length === 0, 'Google: recarregar a pagina nao duplica');
  t2.dom.window.close();
  // conta Google antiga (created_at e last_sign_in_at distantes)
  const t3 = await abrir({ cookies: [ACEITO] });
  await logar(t3, usuario('u-google-velho', { app_metadata: { provider: 'google' }, created_at: diasAtras(30), last_sign_in_at: agora() }));
  confere(conversoes(t3.w).length === 0, 'Google, conta antiga: nenhuma conversao');
  // e-mail, conta nova: nao dispara por este caminho (ja disparou no signUp)
  await logar(t3, usuario('u-email-novo', { created_at: agora(), last_sign_in_at: agora() }));
  confere(conversoes(t3.w).length === 0, 'login por e-mail (conta nova): nao dispara por este caminho');
  // nasceu por e-mail e depois ligou o Google: provedor do cadastro manda
  await logar(t3, usuario('u-email-google', { identities: [{ provider: 'email' }, { provider: 'google' }], created_at: agora(), last_sign_in_at: agora() }));
  confere(conversoes(t3.w).length === 0, 'cadastro por e-mail com identidade Google ligada: nao dispara');
  t3.dom.window.close();
}

// ── 8) Valores hostis no cookie ────────────────────────────────────────────────
{
  const hostil = { gclid: '<img src=x onerror="window.__xss=1">', utm_term: '"\'><script>window.__xss=2</script>' + 'a'.repeat(500),
    utm_content: 'x'.repeat(500), lp: '/<svg onload=window.__xss=3>', evil: 'nao-deve-ir', utm_campaign: { obj: 1 } };
  const t = await abrir({ cookies: [ACEITO, ck('rosce_attr', hostil)], perfil: 'trial_esgotado' });
  await logar(t, usuario('u-hostil'));
  const a = attrRpc(t.w)[0] && attrRpc(t.w)[0].args;
  confere(!!a && a.p_gclid === hostil.gclid && a.p_utm_term.length === 200 && a.p_utm_content.length === 200 && a.p_utm_campaign === null,
    'hostil: texto puro, cortado em 200, objeto descartado', JSON.stringify(a && { t: a.p_utm_term.length, c: a.p_utm_content.length, camp: a.p_utm_campaign }));
  confere(!!a && !('evil' in a) && Object.keys(a).length === 9, 'hostil: chave desconhecida nao vai');
  const href = t.d.getElementById('btn-acquire-access').getAttribute('href');
  confere(!/[<>"' ()]/.test(href) && new URL(href).searchParams.get('sck') === hostil.gclid, 'hostil: paywall com valores codificados', href.slice(0, 160));
  // banner do trial monta HTML com o link: nada injetado
  confere(!t.d.querySelector('img[src="x"], svg[onload]') && t.w.__xss === undefined, 'hostil: nada virou HTML nem executou');
  t.dom.window.close();
}
{
  // banner do trial (innerHTML com o link): o valor hostil fica so dentro do href, codificado
  const hostil = { gclid: '"><img src=x onerror=window.__xss=4>', utm_term: "' onmouseover='window.__xss=5" };
  const t = await abrir({ cookies: [ACEITO, ck('rosce_attr', hostil)], perfil: 'trial' });
  await logar(t, usuario('u-hostil-trial'));
  const a = t.d.querySelector('#trial-banner a[href*="pay.kiwify.com.br"]');
  const u = a && new URL(a.getAttribute('href'));
  confere(!!u && u.searchParams.get('sck') === hostil.gclid && u.searchParams.get('utm_term') === hostil.utm_term && u.searchParams.get('utm_medium') === 'trial_banner',
    'hostil: banner do trial com valores so no href, codificados', a && a.getAttribute('href'));
  confere(!t.d.querySelector('#trial-banner img, #trial-banner [onmouseover]') && t.w.__xss === undefined, 'hostil: banner do trial sem HTML injetado', JSON.stringify({ img: !!t.d.querySelector('#trial-banner img'), mo: !!t.d.querySelector('#trial-banner [onmouseover]'), xss: t.w.__xss, html: (t.d.getElementById('trial-banner') || {}).innerHTML }));
  t.dom.window.close();
}

// ── 9) Funcoes criticas e matriz de acesso igual a da main ─────────────────────
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
