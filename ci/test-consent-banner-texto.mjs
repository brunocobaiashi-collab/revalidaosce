// Teste do texto do banner de cookies (consent.js v1.2), em jsdom, com cookies num CookieJar. Sem rede.
// Rodar a partir da raiz:  node ci/test-consent-banner-texto.mjs [consent.js]   (saida 1 = falhou)
// O argumento opcional troca o consent.js embutido nas paginas (ex.: a copia da main, que tem de reprovar).
//
// Prova, na landing (index.html) e no simulador (tela-hub s-dashboard):
//  - o banner mostra o titulo "Sua privacidade" e o texto novo, ao pe da letra;
//  - o texto nao contem "anuncio" (sem acento e sem caixa) nem "medir de qual";
//  - exatamente 2 botoes, Aceitar (data-ro-c="sim") e Recusar (data-ro-c="nao"), sem classe nem estilo
//    inline que destaque um do outro, e com o mesmo estilo calculado;
//  - o link da politica fica dentro do <p>, com o href esperado; no simulador abre em outra aba;
//  - Aceitar grava rosce_consent {"v":1,"ad":true}; Recusar grava {"v":1,"ad":false};
//  - as duas copias do consent.js sao identicas.
// Requer jsdom:  cd ci && npm install
import fs from 'node:fs';
import { JSDOM, VirtualConsole, CookieJar } from 'jsdom';

const CONSENT = fs.readFileSync(process.argv[2] || 'consent.js', 'utf8');
const TITULO = 'Sua privacidade';
const CORPO = 'Usamos cookies para entender como você chegou até aqui e melhorar a nossa divulgação. Recusar não muda nada no simulador. Política de privacidade';
const HREF = 'https://revalidaosce.com.br/politica-privacidade.html#cookies';
const ESTILOS = ['color', 'background-color', 'border', 'border-color', 'font-weight', 'font-size', 'padding', 'min-width', 'border-radius'];

let ok = 0, falhas = 0;
function confere(cond, nome, extra) {
  if (cond) { ok++; console.log('   ok    ' + nome); }
  else { falhas++; console.log('   FALHA ' + nome + (extra ? '  ::  ' + extra : '')); }
}
const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nfc = s => s.normalize('NFC').replace(/\s+/g, ' ').trim();

// A pagina real, so com o consent.js (os outros scripts saem: aqui interessa o banner).
function montarHTML(arquivo, tela) {
  let html = fs.readFileSync(arquivo, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => {
    const m = tag.match(/^<script\b([^>]*)\bsrc\s*=\s*["']\/consent\.js[^"']*["']([^>]*)>/i);
    if (!m) return '';
    return `<script${m[1]}${m[2]}>${CONSENT}</script>`;
  });
  if (tela) html = html.replace(/<body\b([^>]*)>/i, `<body$1 data-screen="${tela}">`);
  return html;
}
async function abrir(arquivo, url, tela) {
  const jar = new CookieJar();
  const erros = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => erros.push(String(e && e.message || e)));
  const dom = new JSDOM(montarHTML(arquivo, tela), { url, runScripts: 'dangerously', pretendToBeVisual: true, cookieJar: jar, virtualConsole: vc });
  // o banner monta no DOMContentLoaded
  if (dom.window.document.readyState === 'loading') await new Promise(r => dom.window.document.addEventListener('DOMContentLoaded', r));
  return { dom, w: dom.window, d: dom.window.document, erros };
}
function lerConsent(d) {
  const m = d.cookie.match(/(?:^|; )rosce_consent=([^;]*)/);
  if (!m) return null;
  try { return JSON.parse(decodeURIComponent(m[1])); } catch { return null; }
}

async function verificar(nome, arquivo, url, tela, ehApp) {
  console.log(`\n${nome}`);
  const { w, d, erros } = await abrir(arquivo, url, tela);
  const el = d.getElementById('ro-consent');
  confere(!!el && !el.hidden, `${nome}: banner visivel na primeira visita`);
  if (!el) return;
  confere(el.getAttribute('role') === 'region' && el.getAttribute('aria-label') === 'Preferências de cookies', `${nome}: role e aria-label mantidos`);
  const p = el.querySelector('p');
  const t = p && p.querySelector('.ro-c-t');
  confere(!!t && nfc(t.textContent) === TITULO, `${nome}: titulo "${TITULO}"`, t ? t.textContent : 'sem .ro-c-t');
  confere(!!t && /^(STRONG|B)$/.test(t.tagName) && w.getComputedStyle(t).display === 'block', `${nome}: titulo em negrito, numa linha propria`);
  const corpo = p ? nfc(Array.from(p.childNodes).filter(n => n !== t).map(n => n.textContent).join('')) : '';
  confere(corpo === nfc(CORPO), `${nome}: texto novo ao pe da letra`, corpo);
  const todo = semAcento(el.textContent);
  confere(!todo.includes('anuncio'), `${nome}: sem a palavra anuncio`);
  confere(!todo.includes('medir de qual'), `${nome}: sem "medir de qual"`);

  const bts = Array.from(el.querySelectorAll('button'));
  confere(bts.length === 2, `${nome}: exatamente 2 botoes`, String(bts.length));
  const [a, r] = [el.querySelector('button[data-ro-c="sim"]'), el.querySelector('button[data-ro-c="nao"]')];
  confere(!!a && a.textContent.trim() === 'Aceitar', `${nome}: Aceitar com data-ro-c="sim"`);
  confere(!!r && r.textContent.trim() === 'Recusar', `${nome}: Recusar com data-ro-c="nao"`);
  if (a && r) {
    confere(a.className === r.className && !a.hasAttribute('style') && !r.hasAttribute('style'), `${nome}: botoes sem classe ou estilo inline que destaque um`);
    const ca = w.getComputedStyle(a), cr = w.getComputedStyle(r);
    const dif = ESTILOS.filter(k => ca.getPropertyValue(k) !== cr.getPropertyValue(k));
    confere(!dif.length, `${nome}: mesmo estilo calculado nos dois botoes`, dif.join(', '));
  }
  const css = d.getElementById('ro-consent-css');
  confere(!!css && !/data-ro-c|:first-child|:last-child|nth-child/.test(css.textContent), `${nome}: CSS sem regra que destaque um botao`);

  const lk = p && p.querySelector('a');
  confere(!!lk && lk.getAttribute('href') === HREF, `${nome}: link da politica dentro do <p> com o href esperado`);
  if (ehApp) confere(!!lk && lk.target === '_blank' && lk.rel === 'noopener', `${nome}: politica abre em outra aba`);
  confere(!erros.length, `${nome}: sem erro de script`, erros.join(' ; '));

  for (const [rotulo, sel, esperado] of [['Aceitar', 'sim', true], ['Recusar', 'nao', false]]) {
    const o = await abrir(arquivo, url, tela);
    const b = o.d.querySelector(`#ro-consent button[data-ro-c="${sel}"]`);
    if (b) b.dispatchEvent(new o.w.MouseEvent('click', { bubbles: true }));
    const c = lerConsent(o.d);
    confere(!!c && c.v === 1 && c.ad === esperado, `${nome}: ${rotulo} grava rosce_consent v:1 ad:${esperado}`, JSON.stringify(c));
    confere(o.d.getElementById('ro-consent').hidden, `${nome}: ${rotulo} fecha o banner`);
    o.w.close();
  }
  w.close();
}

console.log('copias do consent.js');
confere(fs.readFileSync('consent.js').equals(fs.readFileSync('simulador/consent.js')), 'consent.js e simulador/consent.js identicos byte a byte');

await verificar('landing', 'index.html', 'https://www.revalidaosce.com.br/', null, false);
await verificar('simulador', 'simulador/index.html', 'https://simulador.revalidaosce.com.br/', 's-dashboard', true);

console.log(`\n${ok} OK / ${falhas} FALHA`);
process.exit(falhas ? 1 : 0);
