// Portão 1 — sintaxe.
// (a) compila cada bloco <script> inline como script clássico (é assim que o
//     navegador executa) — pega string quebrada, vírgula sobrando, etc.;
// (b) confere o balanço de chaves de cada <style>;
// (c) procura fragmentos que já quebraram o arquivo antes.
//
// O caso histórico: aspas simples dentro da string `notes` da APP_VERSION.
// node --check pega isso; o olho humano não pega.

import vm from 'node:vm';
import { ler, scriptsInline, extrairEstilos, linhaDe, relatorio } from './lib/html.mjs';

const ALVOS_HTML = ['simulador/index.html', 'simulador/admin.html'];
const ALVOS_JS = ['simulador/station-engine.js'];

// Fragmentos que já causaram incidente. Um fragmento aqui = incidente conhecido.
const PROIBIDOS = [
  { frag: "', string='", motivo: 'aspas simples soltas em nota de versão (bug recorrente)' },
  { frag: 'PLACEHOLDER_WILL_BE_REPLACED', motivo: 'marcador de exemplo publicado por engano (incidente 16/08)' },
];

const erros = [];
const avisos = [];

function checarJS(codigo, arquivo, deslocamentoLinha, rotulo) {
  try {
    new vm.Script(codigo, { filename: rotulo });
  } catch (e) {
    const linhaLocal = Number((/:(\d+)$/.exec(String(e.stack || '').split('\n')[0]) || [])[1]) || 0;
    erros.push(`${arquivo} — ${rotulo}: ${e.message}${linhaLocal ? ` (linha ~${deslocamentoLinha + linhaLocal})` : ''}`);
  }
}

function balancoCSS(css) {
  // remove comentários e strings antes de contar
  const limpo = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  let saldo = 0;
  for (const c of limpo) {
    if (c === '{') saldo++;
    else if (c === '}') saldo--;
    if (saldo < 0) return saldo;
  }
  return saldo;
}

for (const arquivo of ALVOS_HTML) {
  const html = ler(arquivo);

  const blocos = scriptsInline(html);
  if (!blocos.length) erros.push(`${arquivo}: nenhum bloco <script> inline encontrado — extração falhou?`);
  blocos.forEach((b, i) => checarJS(b.codigo, arquivo, b.linha, `<script> #${i + 1} (linha ${b.linha})`));

  extrairEstilos(html).forEach((s, i) => {
    const saldo = balancoCSS(s.codigo);
    if (saldo !== 0) {
      erros.push(`${arquivo} — <style> #${i + 1} (linha ${s.linha}): chaves desbalanceadas (saldo ${saldo > 0 ? '+' : ''}${saldo})`);
    }
  });

  for (const p of PROIBIDOS) {
    const idx = html.indexOf(p.frag);
    if (idx >= 0) erros.push(`${arquivo}:${linhaDe(html, idx)} — fragmento proibido ${JSON.stringify(p.frag)}: ${p.motivo}`);
  }
}

for (const arquivo of ALVOS_JS) {
  checarJS(ler(arquivo), arquivo, 0, 'arquivo inteiro');
}

process.exit(relatorio('Portão 1 · sintaxe', erros, avisos) ? 1 : 0);
