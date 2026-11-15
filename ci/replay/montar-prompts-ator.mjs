// ci/replay/montar-prompts-ator.mjs — monta, por estacao, o prompt do ator ANTIGO (origin/main)
// e o NOVO (copia de trabalho), para o replay com o modelo real feito fora do repositorio.
//
// Uso (a partir da raiz do repositorio):
//   node ci/replay/montar-prompts-ator.mjs <entrada.json> <saida.json> [--ref-antiga=origin/main]
//
// ENTRADA e SAIDA ficam FORA do repositorio (que e publico). O script recusa caminhos dentro
// dele. Nenhum dado de estacao entra no repositorio.
//
// <entrada.json>: as estacoes como vem do banco (linhas da tabela stations, select=*), num
//   array, ou num objeto { "stations": [...] }.
// <saida.json>: array, uma entrada por estacao:
//   { id, name, versao_antiga, versao_nova, prompt_antigo, prompt_novo, igual }
//
// Caminho de montagem igual ao do app: o global `station` recebe a linha (o inventario de
// impressos depende dele), depois parsePatient(station), parseActorInstructions(station) e
// buildActorSystem(p, actorInstr). As funcoes estao dentro da IIFE; o gancho que as expoe e
// injetado so no texto carregado aqui (ver ci/lib/ator-prompt.mjs).
// Sem chamada de IA e sem rede.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { carregarMontador } from '../lib/ator-prompt.mjs';

function sair(msg) { console.error('ERRO: ' + msg); process.exit(2); }

if (!fs.existsSync('simulador/index.html')) sair('rode a partir da raiz do repositorio.');
const args = process.argv.slice(2);
const posicionais = args.filter((a) => !a.startsWith('--'));
const refArg = args.find((a) => a.startsWith('--ref-antiga='));
const REF = refArg ? refArg.split('=')[1] : 'origin/main';
if (posicionais.length !== 2) sair('uso: node ci/replay/montar-prompts-ator.mjs <entrada.json> <saida.json> [--ref-antiga=origin/main]');

const raiz = fs.realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
function foraDoRepo(arquivo, rotulo) {
  const abs = path.resolve(arquivo);
  let real = abs;
  try { real = fs.realpathSync(abs); } catch { real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs)); }
  if (real === raiz || real.startsWith(raiz + path.sep)) sair(`${rotulo} precisa ficar FORA do repositorio (publico): ${real}`);
  return abs;
}
const ENTRADA = foraDoRepo(posicionais[0], 'entrada');
const SAIDA = foraDoRepo(posicionais[1], 'saida');

let estacoes = JSON.parse(fs.readFileSync(ENTRADA, 'utf8'));
if (estacoes && !Array.isArray(estacoes) && Array.isArray(estacoes.stations)) estacoes = estacoes.stations;
if (!Array.isArray(estacoes)) sair('entrada deve ser um array de estacoes ou { "stations": [...] }.');

const versao = (html) => (html.match(/<meta name="app-version" content="([^"]+)"/) || [])[1] || '?';
const htmlNovo = fs.readFileSync('simulador/index.html', 'utf8');
let htmlAntigo;
try { htmlAntigo = execFileSync('git', ['show', `${REF}:simulador/index.html`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
catch { sair(`nao consegui ler ${REF}:simulador/index.html (rode git fetch origin main).`); }

const antigo = await carregarMontador(htmlAntigo);
const novo = await carregarMontador(htmlNovo);
const vA = versao(htmlAntigo), vN = versao(htmlNovo);

const saida = [];
let falhas = 0;
for (const est of estacoes) {
  const item = { id: est && est.id, name: est && est.name, versao_antiga: vA, versao_nova: vN };
  try {
    item.prompt_antigo = antigo.montar(est);
    item.prompt_novo = novo.montar(est);
    item.igual = item.prompt_antigo === item.prompt_novo;
  } catch (e) {
    falhas++;
    item.erro = String(e && e.message || e);
  }
  saida.push(item);
}
const erros = [...antigo.erros.map((e) => 'antigo: ' + e), ...novo.erros.map((e) => 'novo: ' + e)];
antigo.fechar(); novo.fechar();

fs.writeFileSync(SAIDA, JSON.stringify(saida, null, 2));
console.log(`${saida.length} estacao(oes) montada(s): antigo ${vA} (${REF}), novo ${vN} (copia de trabalho). ` +
  `${saida.filter((s) => s.igual === false).length} com prompt diferente, ${falhas} com erro.`);
for (const e of erros) console.log('aviso de runtime ' + e);
console.log('saida: ' + SAIDA);
process.exit(falhas ? 1 : 0);
