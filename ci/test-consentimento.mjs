// Autoteste do portão 8 (consentimento de cookies). Reprova de propósito o que tem de reprovar.
// Rodar a partir da raiz: node ci/test-consentimento.mjs   (saída 1 = falhou)
// O check-consentimento.mjs também o executa antes de conferir os arquivos.
//
// Casos: as páginas da main 4d4b084 (antes do consentimento: tag fixa, conversão
// direta, rosce_attr gravado na landing) reprovam; trechos copiados ao pé da letra
// cobrem o clone raso. Versões estragadas do consent.js (aceite no carregamento,
// rosce_attr fora do ramo aceito, banner no login do simulador, links sem rótulo
// fixo) reprovam. Páginas boas passam.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as jsdom from 'jsdom';
import { verificarPaginas, verificarConsentJs, verificarComportamento } from './lib/consentimento.mjs';

const BASE = '4d4b084';
// Trechos das páginas em 4d4b084, ao pé da letra.
const GTAG_FIXO = `<!-- Google tag (gtag.js) — Google Ads AW-18306871741 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-18306871741"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'AW-18306871741');
</script>`;
const ATTR_ANTIGO = `<script>(function(){ var NAME='rosce_attr'; document.cookie=NAME+'='+encodeURIComponent('{}')+'; max-age=7776000; path=/'; })();</script>`;
const CADASTRO_ANTIGO = `<script>try{ if(typeof gtag === 'function'){ gtag('event', 'conversion', { 'send_to': 'AW-18306871741/0jV-CJWNoM4cEL3jsplE' }); } }catch(_e){}</script>`;
const INCLUI = '<script src="/consent.js?v=1"></script>';
const BOA = `<!doctype html><html><head>${INCLUI}</head><body><a href="/politica-privacidade.html#cookies" data-ro-cookies>Preferências de cookies</a></body></html>`;
const COMPRA_BOA = `${INCLUI}<script>window.RoConsent.quandoAceitar(function(){ window.gtag('event', 'conversion', { 'send_to': 'AW-18306871741/QuYTCMHDyswcEL3jsplE' }); });</script>`;
const CADASTRO_BOM = `${INCLUI}<script>try{ if(window.RoConsent && window.RoConsent.aceito() && typeof gtag === 'function'){ gtag('event', 'conversion', { 'send_to': 'AW-18306871741/0jV-CJWNoM4cEL3jsplE' }); } }catch(_e){}</script>`;

function gitShow(arq) {
  try { return execFileSync('git', ['show', `${BASE}:${arq}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); }
  catch { return null; }
}

export async function autoteste({ silencioso = false } = {}) {
  const falhas = [];
  const log = s => { if (!silencioso) console.log(s); };
  function caso(nome, erros, esperaReprovar, deveConter = []) {
    const reprovou = erros.length > 0;
    const faltam = deveConter.filter(t => !erros.some(e => e.includes(t)));
    const ok = reprovou === esperaReprovar && !faltam.length;
    log(`  ${ok ? '✓' : '✗'} ${nome}${reprovou ? ` (${erros.length} erro(s))` : ''}`);
    if (!ok) falhas.push(`${nome}: esperado ${esperaReprovar ? 'reprovar' : 'aprovar'}` +
      (faltam.length ? `, faltou erro com ${faltam.map(t => `"${t}"`).join(', ')}` : '') +
      (erros.length ? ` | erros: ${erros.slice(0, 4).join(' ; ')}` : ''));
  }
  const pg = (arquivo, html) => verificarPaginas([{ arquivo, html }]);

  // Páginas
  caso('trecho: tag fixa reprova', pg('faq.html', GTAG_FIXO), true, ['tag do Google fixa', 'gtag definido', 'não inclui o consent.js']);
  caso('trecho: rosce_attr na página reprova', pg('index.html', INCLUI + ATTR_ANTIGO), true, ['rosce_attr']);
  caso('trecho: Cadastro sem consentimento reprova', pg('simulador/index.html', INCLUI + CADASTRO_ANTIGO), true, ["gtag('event') sem consentimento"]);
  caso('página boa aprova', pg('quem-somos.html', BOA), false);
  caso('Compra dentro de quandoAceitar aprova', pg('obrigado/index.html', COMPRA_BOA), false);
  caso('Cadastro atrás de RoConsent.aceito() aprova', pg('simulador/index.html', CADASTRO_BOM), false);
  const reais = [['index.html', ['tag do Google fixa', 'rosce_attr']], ['planos.html', ['tag do Google fixa', 'rosce_attr']],
    ['obrigado/index.html', ['tag do Google fixa', "gtag('event') sem consentimento"]],
    ['simulador/index.html', ['tag do Google fixa', "gtag('event') sem consentimento"]], ['conta-restaurada.html', ['não inclui o consent.js']]];
  let achou = 0;
  for (const [arq, esperado] of reais) {
    const html = gitShow(arq);
    if (!html) continue;
    achou++;
    caso(`${arq} de ${BASE} reprova`, pg(arq, html), true, esperado);
  }
  if (!achou) log(`  · arquivos de ${BASE} indisponíveis (clone raso): cobertos pelos trechos copiados`);

  // consent.js estragado
  const bom = fs.readFileSync('consent.js', 'utf8');
  const estragar = (de, para) => { if (!bom.includes(de)) throw new Error('autoteste desatualizado: trecho sumiu do consent.js: ' + de); return bom.replace(de, para); };
  const mutantes = [
    ['aceite no carregamento reprova', estragar('if (aceito()) aplicarAceite();\n    else if (!estado() && !semBanner) abrirBanner();', 'aplicarAceite();'), ['fora do ramo aceito', 'primeira visita já carrega a tag']],
    ['rosce_attr fora do ramo aceito reprova', estragar('function decorar(attr) {', 'function decorar(attr) {\n      gravarCookie(ATTR, attr, 7776000);'), ['rosce_attr gravado fora', 'grava rosce_attr sem consentimento']],
    ['banner no login do simulador reprova', estragar("var HUBS = ['s-dashboard',", "var HUBS = ['s-login', 's-dashboard',"), ['banner aparece na tela de login']],
    ['links sem rótulo fixo reprova', estragar('if (modoAtribuicao && !aceito()) decorar({});', ''), ['perdeu os rótulos fixos']],
    ['origem() sem aceite reprova', estragar('return aceito() ? lerCookie(ATTR) : null;', 'return lerCookie(ATTR);'), ['origem() devolve dado com a recusa gravada']],
    ['recusa sem avisar o simulador reprova', estragar('      avisarMudanca(!!ad);\n', ''), ['aoMudar avisou']],
    ['recusa sem apagar rosce_attr reprova', estragar('if (eraAceito || tagCarregada) apagarCookiesDePublicidade();', ''), ['não apagou o rosce_attr']],
  ];
  for (const [nome, codigo, esperado] of mutantes) {
    const erros = [...verificarConsentJs(codigo), ...(await verificarComportamento(codigo, jsdom))];
    caso(nome, erros, true, esperado);
  }
  return falhas;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Autoteste do portão 8 · consentimento de cookies');
  const falhas = await autoteste();
  if (falhas.length) { falhas.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('  OK');
}
