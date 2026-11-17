// Autoteste do portão 7 (números públicos). Reprova de propósito o que tem de reprovar.
// Rodar a partir da raiz: node ci/test-numeros-publicos.mjs   (saída 1 = falhou)
// O check-numeros-publicos.mjs também o executa antes de conferir as páginas.
//
// Casos: o texto da landing de 12/11/2026 (commit dd9c4f1: 74/177/251) reprova;
// frase proibida (com e sem acento, qualquer caixa); contador fora do piso;
// piso errado; exato na vitrine; preço diferente; FAQ com exato sem data, com
// número fora do JSON, com JSON-LD inválido ou divergente. E os casos bons passam.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { verificar, verificarApp } from './lib/numeros-publicos.mjs';

// Trechos do index.html em dd9c4f1 (antes deste portão), copiados ao pé da letra.
const INDEX_ANTIGO = `
<!-- contagem real do banco em 12/11/2026: 251 ativas (74 INEP + 177 curadas) -->
<div><div class="stat-n" data-count="251">0</div><div class="stat-l">Estações no banco</div></div>
<div class="feature-desc">74 estações das provas de habilidades clínicas do Revalida, nas 5 áreas — Clínica, Cirurgia, Ginecologia/Obstetrícia, Pediatria e Medicina de Família —, mais as estações da curadoria no mesmo padrão.</div>
<div class="feat-desc">São 177 estações criadas pela curadoria médica do RevalidaOSCE, somadas às 74 das provas oficiais do INEP — 251 no total, ampliadas continuamente para você treinar pontos fracos específicos antes da prova.</div>
<div class="preco-feat"><span class="preco-feat-check"></span> 74 estações das provas oficiais do INEP (2020 a 2025)</div>
<div class="preco-feat"><span class="preco-feat-check"></span> 177 estações criadas pela curadoria médica do RevalidaOSCE</div>
<p>Tudo isso por R$ 197/mês</p>`;

const CONTADOR_OK = '<div><div class="stat-n" data-count="270" data-suffix="+">0</div><div class="stat-l">Estações no banco</div></div>';
const INDEX_BOM = `${CONTADOR_OK}
<div>Mais de 100 estações das provas oficiais do INEP, nas 5 áreas.</div>
<div>São mais de 170 estações criadas pela curadoria médica do RevalidaOSCE, somadas a mais de 100 das provas oficiais do INEP — mais de 270 no total.</div>
<p>Sem cartão · ou assine por R$ 197/mês. Assinatura mensal R$ 197.</p>
<p>Teste grátis com 3 estações.</p>`;

const FRASE_EXATA = '281 estações no total (103 das provas oficiais do INEP e 178 de curadoria), números de novembro de 2026';
function faq(visivel, ld) {
  const json = ld ?? JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [
    { '@type': 'Question', name: 'Quantas estações há?', acceptedAnswer: { '@type': 'Answer', text: visivel } }] });
  return `<h3>Quantas estações há?</h3><p>${visivel}</p><script type="application/ld+json">${json}</script>`;
}

export function autoteste(cfg, { silencioso = false } = {}) {
  const falhas = [];
  const log = s => { if (!silencioso) console.log(s); };
  function caso(nome, paginas, esperaReprovar, deveConter = []) {
    const erros = verificar(paginas, cfg);
    const reprovou = erros.length > 0;
    let ok = reprovou === esperaReprovar;
    const faltam = deveConter.filter(t => !erros.some(e => e.includes(t)));
    if (faltam.length) ok = false;
    log(`  ${ok ? '✓' : '✗'} ${nome}${reprovou ? ` (${erros.length} erro(s))` : ''}`);
    if (!ok) falhas.push(`${nome}: esperado ${esperaReprovar ? 'reprovar' : 'aprovar'}` +
      (faltam.length ? `, faltou erro com ${faltam.map(t => `"${t}"`).join(', ')}` : '') +
      (erros.length ? ` | erros: ${erros.join(' ; ')}` : ''));
  }
  const pg = (arquivo, html) => [{ arquivo, html }];

  caso('landing de 12/11 (74/177/251) reprova', pg('index.html', INDEX_ANTIGO), true,
    ['número antigo 74', 'número antigo 177', 'número antigo 251', 'data-count do contador = 251']);

  // O index.html real do commit dd9c4f1, quando o objeto existe no clone.
  let antigoReal = null;
  try { antigoReal = execFileSync('git', ['show', 'dd9c4f1:index.html'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* clone raso */ }
  if (antigoReal) caso('index.html real de dd9c4f1 reprova', pg('index.html', antigoReal), true, ['74', '177', '251']);
  else log('  · index.html de dd9c4f1 indisponível (clone raso): coberto pelos trechos copiados');

  caso('landing nova aprova', pg('index.html', INDEX_BOM), false);
  caso('frase proibida reprova', pg('planos.html', '<p>Banco Completo das Edições Oficiais</p>'), true, ['banco completo']);
  caso('frase proibida em NFD reprova', pg('termos-de-uso.html', '<p>' + 'Todas as estações do INEP'.normalize('NFD') + '</p>'), true, ['todas as estacoes do inep']);
  caso('"PEP oficial" reprova', pg('index.html', INDEX_BOM + '<div class="dor-title">Avaliação pelo PEP Oficial de 10 pontos</div>'), true, ['pep oficial']);
  // Cartão "Fidelidade ao INEP" do Quem somos em b928cb3, ao pé da letra.
  caso('PEP segue as provas sem restringir ao INEP reprova', pg('quem-somos.html',
    '<div class="principio"><h3>Fidelidade ao INEP</h3><p>Formato, tempo, impressos e PEP seguem as provas oficiais do INEP. Não inventamos regra de prova.</p></div>'),
    true, ['sem restringir']);
  caso('PEP segue as provas restrito ao INEP aprova', pg('quem-somos.html',
    '<p>Nas estações das provas oficiais do INEP, formato, tempo, impressos e PEP seguem as provas. Não inventamos regra de prova.</p>' +
    '<p>As estações das provas oficiais do INEP seguem o caderno e o PEP publicados pelo INEP.</p>'), false);
  caso('frase proibida em meta reprova', pg('quem-somos.html', '<meta name="description" content="banco completo INEP">'), true, ['banco completo']);
  caso('contador 260 reprova', pg('index.html', INDEX_BOM.replace('data-count="270"', 'data-count="260"')), true, ['data-count do contador = 260']);
  caso('contador sem sufixo reprova', pg('index.html', INDEX_BOM.replace(' data-suffix="+"', '')), true, ['data-suffix']);
  caso('contador ausente reprova', pg('index.html', INDEX_BOM.replace(CONTADOR_OK, '')), true, ['não encontrado']);
  caso('piso errado reprova', pg('planos.html', '<li>Mais de 250 estações das provas oficiais do INEP</li>'), true, ['"mais de 250"']);
  caso('exato na vitrine reprova', pg('planos.html', '<li>103 estações das provas oficiais do INEP</li>'), true, ['número exato 103']);
  caso('preço diferente reprova', pg('faq.html', faq('Custa R$ 97/mês.')), true, ['R$ 97']);
  caso('preço em tags (R$<sup>) diferente reprova', pg('planos.html', '<div><sup>R$</sup>187<span>/mês</span></div>'), true, ['R$ 187']);
  caso('FAQ com exato e data aprova', pg('faq.html', faq(`São ${FRASE_EXATA}.`)), false);
  caso('FAQ com exato sem data reprova', pg('faq.html', faq('São 281 estações no total (103 das provas oficiais do INEP e 178 de curadoria).')), true, ['sem a data']);
  caso('FAQ com número fora do JSON reprova', pg('faq.html', faq(`São ${FRASE_EXATA.replace('178', '179')}.`)), true, ['179']);
  caso('Quem somos com 236/161 reprova', pg('quem-somos.html', '<li>161 estações curadas pela Equipe — 236 estações no total</li>'), true, ['161', '236']);
  caso('FAQ com JSON-LD inválido reprova', pg('faq.html', faq(`São ${FRASE_EXATA}.`, '{"@type": "FAQPage",}')), true, ['JSON-LD inválido']);
  caso('FAQ com JSON-LD divergente reprova', pg('faq.html',
    `<h3>Quantas estações há?</h3><p>São ${FRASE_EXATA}.</p><script type="application/ld+json">` +
    JSON.stringify({ '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Quantas estações há?', acceptedAnswer: { text: 'Banco com 300 questões.' } }] }) +
    '</script>'), true, ['resposta diverge']);
  // App: paywall do simulador 1.6.172, ao pé da letra.
  const PAYWALL_ANTIGO = "var _lockMsg = 'Esta estação faz parte do banco completo, exclusivo para assinantes. Assine para treinar sem limites — todas as estações Revalida, ator com IA e avaliação pelo PEP.';";
  const PAYWALL_NOVO = "var _lockMsg = 'Esta estação faz parte do plano completo, exclusivo para assinantes. Assine para treinar sem limites — estações das provas oficiais do INEP e de curadoria, ator com IA e avaliação pelo PEP.';";
  const app = (nome, texto, esperaReprovar, deveConter = []) => {
    const erros = verificarApp('simulador/index.html', texto);
    const ok = (erros.length > 0) === esperaReprovar && deveConter.every(t => erros.some(e => e.includes(t)));
    log(`  ${ok ? '✓' : '✗'} ${nome}${erros.length ? ` (${erros.length} erro(s))` : ''}`);
    if (!ok) falhas.push(`${nome}: esperado ${esperaReprovar ? 'reprovar' : 'aprovar'} | erros: ${erros.join(' ; ')}`);
  };
  app('paywall do app 1.6.172 reprova', PAYWALL_ANTIGO, true, ['banco completo']);
  app('paywall do app 1.6.173 aprova', PAYWALL_NOVO, false);
  return falhas;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = JSON.parse(fs.readFileSync('ci/numeros-publicos.json', 'utf8'));
  console.log('Autoteste do portão 7 · números públicos');
  const falhas = autoteste(cfg);
  if (falhas.length) { falhas.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('  OK');
}
