// ci/lib/consentimento.mjs — regra do consentimento de cookies (portão 8).
// Usado por check-consentimento.mjs (arquivos reais) e por test-consentimento.mjs
// (autoteste que reprova de propósito).
//
// Regra (decisão do Bruno, 16/11/2026; política de privacidade, seção 12):
// - Nenhum .html carrega a tag do Google fixa; o carregador vive só no consent.js,
//   e só depois do "Aceitar".
// - Todo .html público inclui o consent.js.
// - rosce_attr só é gravado pelo consent.js, dentro de função chamada pelo ramo "aceito".
// - Conversão (gtag('event', ...)) nas páginas só dentro de RoConsent.quandoAceitar
//   ou atrás de RoConsent.aceito().
// - consent.js da raiz e simulador/consent.js idênticos byte a byte.

import { extrairScripts } from './html.mjs';

/** Corpo (entre chaves) da função `function nome(`; null se não achar. */
export function corpoDaFuncao(codigo, nome) {
  const i = codigo.indexOf('function ' + nome + '(');
  if (i < 0) return null;
  const abre = codigo.indexOf('{', i);
  if (abre < 0) return null;
  let n = 0;
  for (let j = abre; j < codigo.length; j++) {
    if (codigo[j] === '{') n++;
    else if (codigo[j] === '}' && --n === 0) return { inicio: abre, fim: j, texto: codigo.slice(abre, j + 1) };
  }
  return null;
}

function ocorrencias(texto, trecho) {
  const out = [];
  let i = -1;
  while ((i = texto.indexOf(trecho, i + 1)) >= 0) out.push(i);
  return out;
}

const RE_TAG = /googletagmanager\.com\/gtag\/js/;
const RE_INCLUI = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*consent\.js(?:\?[^"']*)?["']/i;
const RE_EVENTO = /gtag\(\s*['"]event['"]/g;

/** paginas: [{ arquivo, html }]. Devolve lista de erros. */
export function verificarPaginas(paginas) {
  const erros = [];
  for (const { arquivo, html } of paginas) {
    const err = m => erros.push(`${arquivo}: ${m}`);
    if (RE_TAG.test(html)) err('tag do Google fixa na página (o carregador vive só no consent.js)');
    if (/function\s+gtag\s*\(/.test(html) || /gtag\(\s*['"]config['"]/.test(html)) err('gtag definido ou configurado na página (só o consent.js faz isso)');
    if (!RE_INCLUI.test(html)) err('não inclui o consent.js');
    // rosce_attr pode aparecer no texto (a política explica o cookie), nunca em script da página
    if (extrairScripts(html).some(b => b.codigo.includes('rosce_attr'))) err('script da página mexe no rosce_attr (só o consent.js grava esse cookie)');
    let m;
    RE_EVENTO.lastIndex = 0;
    while ((m = RE_EVENTO.exec(html))) {
      const antes = html.slice(Math.max(0, m.index - 700), m.index);
      if (!/quandoAceitar\(|RoConsent\.aceito\(\)/.test(antes)) err(`gtag('event') sem consentimento (perto do caractere ${m.index})`);
    }
  }
  return erros;
}

/** Regras estáticas do próprio consent.js. */
export function verificarConsentJs(codigo, nome = 'consent.js') {
  const erros = [];
  const err = m => erros.push(`${nome}: ${m}`);
  const atrib = corpoDaFuncao(codigo, 'atribuirComConsentimento');
  const aceite = corpoDaFuncao(codigo, 'aplicarAceite');
  const tag = corpoDaFuncao(codigo, 'carregarTag');
  if (!atrib || !aceite || !tag) { err('faltam as funções atribuirComConsentimento, aplicarAceite ou carregarTag'); return erros; }
  const dentro = (pos, f) => pos > f.inicio && pos < f.fim;

  // rosce_attr só é gravado dentro de atribuirComConsentimento
  const gravacoes = ocorrencias(codigo, 'gravarCookie(ATTR');
  if (!gravacoes.length) err('não achei a gravação do rosce_attr (gravarCookie(ATTR, ...))');
  gravacoes.filter(p => !dentro(p, atrib)).forEach(() => err('rosce_attr gravado fora de atribuirComConsentimento'));
  if (/document\.cookie\s*=\s*ATTR|rosce_attr=/.test(codigo)) err('rosce_attr gravado direto em document.cookie');

  // atribuirComConsentimento e carregarTag só são chamadas por aplicarAceite
  for (const [nomeF, def] of [['atribuirComConsentimento', atrib], ['carregarTag', tag]]) {
    const usos = ocorrencias(codigo, nomeF).filter(p => codigo.slice(p - 9, p) !== 'function ');
    usos.filter(p => !dentro(p, aceite)).forEach(() => err(`${nomeF} usada fora de aplicarAceite`));
    if (!usos.length) err(`${nomeF} nunca é chamada`);
  }
  // a URL da tag só aparece dentro de carregarTag
  ocorrencias(codigo, 'googletagmanager.com/gtag/js').filter(p => !dentro(p, tag)).forEach(() => err('URL da tag fora de carregarTag'));

  // aplicarAceite só no ramo aceito
  const chamadas = ocorrencias(codigo, 'aplicarAceite()').filter(p => codigo.slice(p - 9, p) !== 'function ');
  const permitidas = ['if (aceito()) aplicarAceite()', 'if (ad) aplicarAceite()'];
  for (const p of chamadas) {
    const linha = codigo.slice(codigo.lastIndexOf('\n', p) + 1, codigo.indexOf('\n', p));
    if (!permitidas.some(t => linha.includes(t))) err(`aplicarAceite chamada fora do ramo aceito: "${linha.trim()}"`);
  }
  return erros;
}

/**
 * Comportamento do consent.js num DOM montado. `jsdom` é o módulo (JSDOM, CookieJar),
 * passado por quem chama. Devolve lista de erros.
 */
export async function verificarComportamento(codigo, { JSDOM, CookieJar, VirtualConsole }) {
  const erros = [];
  const falhasJs = [];
  const err = m => erros.push('comportamento: ' + m);
  const HTML = (corpo, attr = 'data-atribuicao="landing"') => `<!doctype html><html><head><script ${attr}>${codigo}</script></head><body>
    <a id="k" href="https://pay.kiwify.com.br/OpKRKOr">Assinar</a>
    <a id="s" href="https://simulador.revalidaosce.com.br/?signup=1">Teste grátis</a>
    <a id="pref" href="/politica-privacidade.html#cookies" data-ro-cookies>Preferências de cookies</a>${corpo || ''}</body></html>`;
  const espera = ms => new Promise(r => setTimeout(r, ms));
  async function abrir(url, corpo, cookies = [], attr) {
    const jar = new CookieJar();
    for (const c of cookies) jar.setCookieSync(c, url);
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => falhasJs.push(String(e && e.message || e).split('\n')[0]));
    const dom = new JSDOM(HTML(corpo, attr), { url, runScripts: 'dangerously', cookieJar: jar, pretendToBeVisual: true, virtualConsole: vc });
    await espera(30);
    return { dom, jar, w: dom.window, d: dom.window.document };
  }
  const tags = d => [...d.querySelectorAll('script[src]')].filter(s => /googletagmanager\.com\/gtag\/js/.test(s.src)).length;
  const cookie = (d, n) => { const m = d.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; };
  const banner = d => { const b = d.getElementById('ro-consent'); return !!(b && !b.hidden); };
  const clicar = (d, sel) => { const b = d.querySelector(sel); if (b) b.dispatchEvent(new d.defaultView.MouseEvent('click', { bubbles: true, cancelable: true })); return !!b; };
  const URL1 = 'https://www.revalidaosce.com.br/?gclid=TESTE123&utm_source=google&utm_medium=cpc&utm_campaign=teste';

  // 1. primeira visita
  let t = await abrir(URL1);
  if (falhasJs.length || !t.w.RoConsent) { err('o consent.js não executa: ' + (falhasJs[0] || 'RoConsent ausente')); return erros; }
  if (!banner(t.d)) err('primeira visita sem banner');
  if (tags(t.d)) err('primeira visita já carrega a tag do Google');
  if (typeof t.w.gtag !== 'undefined') err('primeira visita já define gtag');
  if (cookie(t.d, 'rosce_attr')) err('primeira visita grava rosce_attr sem consentimento');
  let k = t.d.getElementById('k').href, s = t.d.getElementById('s').href;
  if (/sck=|gclid=/.test(k) || /gclid=/.test(s)) err(`sem consentimento o link leva o clique: ${k} | ${s}`);
  if (!/utm_source=landing/.test(k) || !/utm_medium=landing_cta/.test(k) || !/utm_campaign=preco/.test(k)) err(`sem consentimento o link da Kiwify perdeu os rótulos fixos: ${k}`);
  if (/utm_source=google/.test(k)) err(`sem consentimento o link da Kiwify leva a utm da URL: ${k}`);
  let chamou = 0;
  t.w.RoConsent.quandoAceitar(() => { chamou++; });
  if (chamou) err('quandoAceitar rodou antes do aceite');

  // 2. Aceitar
  if (!clicar(t.d, '#ro-consent button[data-ro-c="sim"]')) err('banner sem botão Aceitar');
  await espera(10);
  if (tags(t.d) !== 1) err(`depois do Aceitar, tags do Google = ${tags(t.d)} (esperado 1)`);
  const attr = cookie(t.d, 'rosce_attr');
  if (!attr || !attr.includes('TESTE123')) err('depois do Aceitar o rosce_attr não foi gravado com o gclid');
  k = t.d.getElementById('k').href; s = t.d.getElementById('s').href;
  if (!/sck=TESTE123/.test(k) || !/utm_source=google_ads/.test(k)) err(`depois do Aceitar o link da Kiwify não foi decorado: ${k}`);
  if (!/gclid=TESTE123/.test(s)) err(`depois do Aceitar o link do simulador não leva o gclid: ${s}`);
  const c1 = cookie(t.d, 'rosce_consent');
  if (!c1 || !/"ad":true/.test(c1) || !/"v":1/.test(c1)) err(`rosce_consent depois do Aceitar: ${c1}`);
  if (banner(t.d)) err('banner continua aberto depois do Aceitar');
  if (chamou !== 1) err(`quandoAceitar rodou ${chamou} vez(es) depois do aceite (esperado 1)`);
  const dl = (t.w.dataLayer || []).map(a => Array.from(a));
  const iDef = dl.findIndex(a => a[0] === 'consent' && a[1] === 'default');
  const iCfg = dl.findIndex(a => a[0] === 'config');
  if (iDef < 0 || iCfg < 0 || iDef > iCfg) err('Consent Mode: consent default tem de vir antes do config');
  if (!dl.some(a => a[0] === 'consent' && a[1] === 'update' && a[2] && a[2].ad_storage === 'granted')) err('Consent Mode: falta consent update com ad_storage granted');

  // 3. revogar pelo rodapé
  clicar(t.d, '#pref');
  await espera(10);
  if (!banner(t.d)) err('Preferências de cookies não reabriu o banner');
  clicar(t.d, '#ro-consent button[data-ro-c="nao"]');
  await espera(10);
  if (cookie(t.d, 'rosce_attr')) err('recusar depois de aceitar não apagou o rosce_attr');
  k = t.d.getElementById('k').href;
  if (/sck=/.test(k)) err(`recusar depois de aceitar deixou o sck no link: ${k}`);
  if (!/"ad":false/.test(cookie(t.d, 'rosce_consent') || '')) err('recusar não gravou ad:false');
  t.dom.window.close();

  // 4. volta com aceite gravado
  const hoje = new Date().toISOString().slice(0, 10);
  const aceitoCk = 'rosce_consent=' + encodeURIComponent(JSON.stringify({ v: 1, ad: true, ts: hoje })) + '; path=/';
  t = await abrir('https://www.revalidaosce.com.br/planos.html', '', [aceitoCk]);
  if (banner(t.d)) err('com aceite gravado o banner voltou');
  if (tags(t.d) !== 1) err('com aceite gravado a tag não carregou');
  t.dom.window.close();

  // 5. Recusar na primeira visita
  t = await abrir(URL1);
  clicar(t.d, '#ro-consent button[data-ro-c="nao"]');
  await espera(10);
  if (tags(t.d) || cookie(t.d, 'rosce_attr') || typeof t.w.gtag !== 'undefined') err('Recusar carregou tag ou gravou rosce_attr');
  const rec = cookie(t.d, 'rosce_consent');
  t.dom.window.close();
  t = await abrir(URL1, '', ['rosce_consent=' + encodeURIComponent(rec || '') + '; path=/']);
  if (banner(t.d)) err('com recusa gravada o banner voltou');
  if (tags(t.d) || cookie(t.d, 'rosce_attr')) err('com recusa gravada houve tag ou rosce_attr');
  t.dom.window.close();

  // 6. versão diferente pergunta de novo
  t = await abrir(URL1, '', ['rosce_consent=' + encodeURIComponent(JSON.stringify({ v: 0, ad: true, ts: hoje })) + '; path=/']);
  if (!banner(t.d) || tags(t.d)) err('rosce_consent de outra versão não perguntou de novo');
  t.dom.window.close();

  // 7. simulador: banner só nas telas-hub
  const APP = '<div id="s-login" class="screen active"></div><div id="s-dashboard" class="screen"></div><div id="s-sim" class="screen"></div><nav id="mobile-nav" class="nav-hidden"></nav>';
  t = await abrir('https://simulador.revalidaosce.com.br/', APP, [], '');
  t.d.body.setAttribute('data-screen', 's-login');
  await espera(20);
  if (banner(t.d)) err('simulador: banner aparece na tela de login');
  t.d.body.setAttribute('data-screen', 's-dashboard');
  await espera(20);
  if (!banner(t.d)) err('simulador: banner não aparece no dashboard');
  t.d.body.setAttribute('data-screen', 's-sim');
  await espera(20);
  if (banner(t.d)) err('simulador: banner aparece durante a estação');
  for (const tela of ['s-access-required', 's-eval', 's-brief']) {
    t.d.body.setAttribute('data-screen', tela);
    await espera(10);
    if (banner(t.d)) err(`simulador: banner aparece em ${tela}`);
  }
  t.dom.window.close();
  falhasJs.forEach(e => err('erro de execução: ' + e));
  return erros;
}
