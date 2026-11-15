// Portão 6 — gerador (simulador/station-engine.js).
// (a) ENGINE_VERSION declarada e registrada no comentário do topo;
// (b) se o arquivo difere do da main (origin/main), ENGINE_VERSION tem de ser maior que a da
//     main. Comparar com a main, e não com o commit anterior, deixa a branch ter quantos commits
//     quiser numa versão só (15/11: o segundo commit da 1.4.1 reprovaria o check do push). Se o
//     arquivo é igual ao da main (a própria main, depois do merge), compara com o commit anterior,
//     o que cobre push direto na main. Sem origin/main disponível, cai no commit anterior com aviso;
// (c) as baselines de ci/engine/baselines/ são as cópias exatas dos commits da main
//     (sha256 fixo aqui) — baseline alterada anularia a regressão;
// (d) roda as suítes de ci/engine/, cada uma em processo próprio, contra o arquivo
//     do repositório.
//
// Motivo: até a 1.4.0 o único portão que olhava o gerador era o de sintaxe. A 1.4.1
// foi entregue em 19/08 e nunca publicada, e ninguém via isso pelo CI.

import { execSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ler, relatorio } from './lib/html.mjs';

const ARQUIVO = 'simulador/station-engine.js';
const DIR = 'ci/engine';
const SUITES = ['test-regressao.js', 'test-ancora.js', 'test-audit-budget.js', 'test-area-canonica.js', 'test-binario-conjuntivo.js', 'test-parcial-exata.js', 'test-diagnostico-gabarito.js'];

// Uma linha por baseline. Baseline nova entra aqui no mesmo commit em que entra no diretório.
const BASELINES = {
  'station-engine.pre-1.1.0.js': 'c40b19980fc1ea253ecdc3980d7599b26751aff4458c8179f0d78c9109022133', // d0e4f62
  'station-engine.1.1.0.js':     '066e535816b1f3d7340bc07b1d78db041d07bfccd183fff37c143ca7d56feb2a', // 90cc0f8
  'station-engine.1.2.0.js':     '01192bdf150abd378dc6455b26476656634344055561dcccf8f2beb7ab3bbae6', // 3ace155
  'station-engine.1.4.0.js':     'dfda051a614c25404ede7f4627f20c3be9de1aa26be28452895c2b48f4c13617', // c7c3f5b
  'station-engine.1.4.2.js':     '166360945018979da91afb0ef7b5e938522a4115418bf18e797908a2d45e85c0', // d904515
};

const erros = [];
const avisos = [];

function versaoDe(texto) {
  const m = /var\s+ENGINE_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/.exec(texto || '');
  return m && m[1];
}
function maiorQue(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (x[i] > y[i]) return true;
    if (x[i] < y[i]) return false;
  }
  return false;
}
function naRef(ref) {
  try {
    return execSync(`git show ${ref}:${ARQUIVO}`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null; // ref ausente (clone sem origin/main) ou histórico raso
  }
}

// (a)
const atual = ler(ARQUIVO);
const versao = versaoDe(atual);
if (!versao) {
  erros.push(`${ARQUIVO}: var ENGINE_VERSION = 'x.y.z' não encontrada`);
} else {
  const fimCabecalho = atual.indexOf('(function (global)');
  const cabecalho = fimCabecalho > 0 ? atual.slice(0, fimCabecalho) : '';
  if (!new RegExp('ENGINE_VERSION\\s+' + versao.replace(/\./g, '\\.') + '\\b').test(cabecalho)) {
    erros.push(`${ARQUIVO}: o comentário do topo não registra a versão ${versao} (esperava a linha "ENGINE_VERSION ${versao}" no histórico do cabeçalho)`);
  }
}

// (b)
const daMain = naRef('origin/main');
let ref = null, rotulo = '';
if (daMain !== null && daMain !== atual) {
  ref = daMain; rotulo = 'da main';
} else {
  ref = naRef('HEAD~1'); rotulo = 'do commit anterior';
  if (daMain === null) avisos.push(`${ARQUIVO}: origin/main indisponível — comparando com o commit anterior`);
}
if (ref === null) {
  avisos.push(`${ARQUIVO}: sem referência para comparar (histórico raso) — incremento não verificado`);
} else if (versao && ref !== atual) {
  const va = versaoDe(ref);
  if (va && !maiorQue(versao, va)) {
    erros.push(`${ARQUIVO}: difere ${rotulo} mas ENGINE_VERSION não subiu (${va} → ${versao})`);
  }
}

// (c)
for (const [nome, esperado] of Object.entries(BASELINES)) {
  const p = path.join(DIR, 'baselines', nome);
  if (!fs.existsSync(p)) { erros.push(`${p}: baseline ausente`); continue; }
  const h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  if (h !== esperado) erros.push(`${p}: sha256 ${h.slice(0, 12)}… difere do registrado (${esperado.slice(0, 12)}…) — baseline não se edita`);
}
for (const nome of fs.readdirSync(path.join(DIR, 'baselines'))) {
  if (!BASELINES[nome]) erros.push(`${DIR}/baselines/${nome}: baseline sem sha256 registrado em ci/check-engine.mjs`);
}

// (d)
if (versao) {
  for (const suite of SUITES) {
    const r = spawnSync(process.execPath, [path.join(DIR, suite)], {
      encoding: 'utf8',
      env: { ...process.env, ENGINE: path.resolve(ARQUIVO), EXPECT_VERSION: versao },
      timeout: 120000,
    });
    const saida = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0) {
      const falhas = saida.split('\n').filter((l) => /^(FAIL|DIFF|ERRO)|^\s+(REF|NOVO|1a)/.test(l)).slice(0, 12);
      erros.push(`${suite} reprovou${r.signal ? ` (${r.signal})` : ''}:\n        ` + (falhas.length ? falhas.join('\n        ') : saida.trim().split('\n').slice(-6).join('\n        ')));
    } else {
      const resumo = saida.trim().split('\n').filter(Boolean).pop() || '';
      console.log(`   ${suite}: ${resumo.replace(/=/g, '').trim()}`);
    }
  }
}

process.exit(relatorio('Portão 6 · gerador', erros, avisos) ? 1 : 0);
