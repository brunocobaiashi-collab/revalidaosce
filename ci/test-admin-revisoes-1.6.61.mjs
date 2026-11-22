// Teste de Estações › Revisões e da Fila de curadoria só de resumo (admin v1.6.61), em
// jsdom, com rpcAdmin simulado. Nada de rede, nada de produção. Substitui o teste da 1.6.60.
// Rodar a partir da raiz: node ci/test-admin-revisoes-1.6.61.mjs   (saída 1 = falhou)
// (precisa de jsdom em ci/: cd ci && npm install --no-save jsdom)
//
// Prova, em Revisões: (a) a aba carrega o painel e a lista só com itens de estação, pedindo
// p_categoria estacao; (b) em_fila = 40 mostra o aviso de pausa em âmbar, 39 não; (c) pendente
// de estação tem Aprovar e Rejeitar; (d) aprovado tem Rejeitar e Reabrir; (e) ação recarrega
// Revisões, não a Fila. Na Fila de resumo: (f) nenhum item de estação, sem ff-estacao, com a
// linha que aponta para Revisões e contagens só de resumo. Segurança: (g) campos do banco
// escapados (ultimas.name e trecho); (h) ok:false gera alert e não recarrega.
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ARQ = 'simulador/admin.html';
let ok = 0, falhas = 0;
function confere(cond, nome) {
  if (cond) { ok++; console.log('   ok    ' + nome); }
  else { falhas++; console.log('   FALHA ' + nome); }
}
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function prepararHTML(html, dir) {
  return html.replace(
    /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (tag, src) => {
      if (/^https?:|^\/\//i.test(src)) return '';
      const local = path.join(dir, src.split('?')[0]);
      return fs.existsSync(local) ? `<script>${fs.readFileSync(local, 'utf8')}</script>` : '';
    }
  );
}

function dublar(w) {
  const cli = new Proxy(function () {}, {
    get: (_, p) => {
      if (p === 'then') return undefined;
      if (p === 'auth') return {
        getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }),
      };
      return () => cli;
    },
    apply: () => cli,
  });
  w.supabase = { createClient: () => cli };
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
}

const HOSTIL = '<script>window.__xss=1</script><img src=x onerror="window.__xss2=1">';
const PEND_EST = { id: 302, categoria: 'estacao', tipo: 'revisor', status: 'pendente', prioridade: 2, criado_em: '2026-11-20T12:00:00Z',
  tema_id: 't1', tema_nome: 'Tema um', station_nome: 'Estação 15d1c68c', trecho: 'trecho ' + HOSTIL,
  camada: 'clinica', correcao_proposta: 'trocar dose ' + HOSTIL, fonte: 'Diretriz ' + HOSTIL, fonte_verificada: false,
  station_fonte: 'inep', conteudo_mudou: true };
const PEND_RES = { id: 303, categoria: 'resumo', tipo: 'editorial', status: 'pendente', prioridade: 3, criado_em: '2026-11-20T12:00:00Z',
  tema_id: 't2', tema_nome: 'Tema dois', trecho: 'resumo com erro' };
const PEND_DES = { id: 306, categoria: 'desatualizado', tipo: 'desatualizado', status: 'pendente', prioridade: 1, criado_em: '2026-11-20T12:00:00Z',
  tema_id: 't5', tema_nome: 'Tema cinco', trecho: 'estação mudou' };
const APROVADAS = [
  { id: 304, categoria: 'estacao', tipo: 'revisor', status: 'aprovada', prioridade: 2, criado_em: '2026-11-19T12:00:00Z',
    tema_id: 't3', tema_nome: 'Tema três', trecho: 'x', camada: 'coerencia', fonte: 'PDF INEP', fonte_verificada: true,
    aprovado_em: '2026-11-21T15:00:00Z' },
];
const RESOLVIDAS = [
  { id: 305, categoria: 'estacao', tipo: 'revisor', status: 'resolvida', prioridade: 2, criado_em: '2026-11-18T12:00:00Z',
    tema_id: 't4', tema_nome: 'Tema quatro', trecho: 'y', decisao: 'rejeitada' },
];

const HTML = fs.readFileSync(ARQ, 'utf8');
console.log('\n── Teste · admin Estações › Revisões e Fila de resumo (jsdom) ─────────────────');

const erros = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => erros.push(e.message));
const dom = new JSDOM(prepararHTML(HTML, path.dirname(ARQ)), {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'https://simulador.revalidaosce.com.br/admin.html', virtualConsole: vc, beforeParse: dublar,
});
await espera(400);
const w = dom.window, d = w.document;
confere(erros.length === 0, 'admin.html carrega sem exceção' + (erros.length ? ' — ' + erros[0] : ''));
['aprovarItemFila', 'rejeitarItemFila', 'filtrarFilaStatus', 'resolverItemFila', 'reabrirItemFila', 'loadFila',
 'loadRevisoes', 'filtrarRevisoesStatus', 'switchTab']
  .forEach((f) => confere(typeof w[f] === 'function', f + ' em window'));

// ordem da sub-aba: depois de Contestações, antes de Âncoras; painel no grupo estacoes
const subs = [...d.querySelectorAll('#sub-estacoes .sub-tab')].map((b) => b.id);
confere(subs.indexOf('st-revisoes') === subs.indexOf('st-contestacoes') + 1 && subs.indexOf('st-ancoras') === subs.indexOf('st-revisoes') + 1,
  'sub-aba st-revisoes entre Contestações e Âncoras');
confere(!!d.getElementById('panel-revisoes') && !!d.getElementById('rv-n-aba'), 'painel-revisoes e contador rv-n-aba existem');

const chamadas = [];
const resp = { aprovar: { ok: true }, rejeitar: { ok: true } };
let emFila = 39;
const painel = () => ({
  ativas: 281, revisadas: 48, mudaram: 0, nunca: 233, nunca_inep: 81, nunca_ia: 152,
  fila: { em_fila: emFila, pendentes: 39, aprovadas: 1, limite: 40 },
  ultima_rodada: '2026-11-22T11:25:26Z',
  ultimas: [
    { station_id: 's1', name: 'Estação hostil ' + HOSTIL, fonte: 'inep', origem: 'revisor', modelo: null, n_achados: 0, revisado_em: '2026-11-22T11:25:26Z', nota: null },
    { station_id: 's2', name: 'Estação dois', fonte: 'ia_curada', origem: 'lote_manual', modelo: 'x', n_achados: 3, revisado_em: '2026-11-21T10:00:00Z', nota: 'n' },
  ],
});
w.rpcAdmin = async (fn, args) => {
  chamadas.push([fn, JSON.parse(JSON.stringify(args || {}))]);
  if (fn === 'admin_revisor_painel') return painel();
  if (fn === 'admin_curadoria_list') {
    let itens = args.p_status === 'aprovada' ? APROVADAS : args.p_status === 'resolvida' ? RESOLVIDAS : [PEND_EST, PEND_RES, PEND_DES];
    if (args.p_categoria) itens = itens.filter((i) => i.categoria === args.p_categoria);
    return { itens, counts: { pendente_total: 41, por_categoria: { estacao: 39, resumo: 1, desatualizado: 1 }, temas_travados: 2, aprovada_total: 1,
      freio_estacao: { em_fila: emFila, limite: 40 } } };
  }
  if (fn === 'admin_revisor_aprovar') return resp.aprovar;
  if (fn === 'admin_revisor_rejeitar') return resp.rejeitar;
  if (fn === 'admin_curadoria_reabrir') return { ok: true };
  if (fn === 'admin_curadoria_resolver') return { ok: true };
  if (fn === 'admin_temas_overview') return [];
  throw new Error('rpc nao simulada: ' + fn);
};
const alertas = [];
w.alert = (m) => alertas.push(String(m));
w.prompt = () => 'nota de teste';
w.confirm = () => true;

const cartao = (sel, id) => [...d.querySelectorAll(sel + ' .st-card')].find((c) => c.innerHTML.includes('(' + id + ','));
const botoes = (c) => (c ? [...c.querySelectorAll('button')].map((b) => b.textContent.trim()) : []);
const conta = (fn) => chamadas.filter((c) => c[0] === fn).length;
const ultimaList = () => chamadas.filter((c) => c[0] === 'admin_curadoria_list').pop();

// ── Revisões ─────────────────────────────────────────────────────────────────
w.switchTab('revisoes');
await espera();
const grp = d.getElementById('grp-estacoes');
confere(d.getElementById('panel-revisoes').classList.contains('active') && d.getElementById('st-revisoes').classList.contains('active')
  && (!grp || grp.classList.contains('active')), '(a) switchTab ativa o painel no grupo Estações');
confere(conta('admin_revisor_painel') === 1 && chamadas.find((c) => c[0] === 'admin_revisor_painel')[1].p_ultimas === 20, '(a) chama admin_revisor_painel com p_ultimas 20');
confere(ultimaList()[1].p_categoria === 'estacao' && ultimaList()[1].p_status === 'pendente', '(a) lista pede p_categoria estacao e p_status pendente');
const rvp = d.getElementById('rv-painel').textContent;
confere(rvp.includes('Revisadas 48 de 281 ativas') && rvp.includes('nunca revisadas 233 (81 INEP, 152 IA)')
  && rvp.includes('mudaram depois da revisão 0') && /última rodada 22\/11.*07:25/.test(rvp), '(a) linha de situação com números e última rodada em Boa Vista');
confere(rvp.includes('Fila de estação 39 de 40'), '(a) linha da fila');
confere(!d.getElementById('rv-pausado') && !rvp.includes('revisor pausado'), '(b) em_fila 39: sem aviso de pausa');
confere(d.getElementById('panel-revisoes').textContent.includes('Rodadas automáticas: diária às 02:47 e semanal aos domingos às 04:23 (Boa Vista).'), '(a) texto fixo das rodadas');
const ult = d.querySelector('#rv-ultimas details');
confere(ult && !ult.open && ult.textContent.includes('Últimas revisões (2)') && ult.textContent.includes('sem achado')
  && ult.textContent.includes('3 achados') && ult.textContent.includes('INEP') && ult.textContent.includes('IA') && ult.textContent.includes('lote manual'),
  '(a) Últimas revisões recolhido, com selo, origem e achados');
confere(d.getElementById('rv-n-aba').textContent === '(39)', '(a) contador da aba (39)');
const rvCards = [...d.querySelectorAll('#rv-list .st-card')];
confere(rvCards.length === 1 && !!cartao('#rv-list', 302), '(a) lista de Revisões só com o item de estação');
const r302 = cartao('#rv-list', 302);
confere(JSON.stringify(botoes(r302)) === JSON.stringify(['Aprovar', 'Rejeitar', '✓ Resolver']), '(c) pendente de estação: Aprovar, Rejeitar e Resolver');
confere(r302.textContent.includes('revisor automático') && r302.textContent.includes('clínica') && r302.textContent.includes('INEP')
  && r302.textContent.includes('Correção proposta:') && r302.textContent.includes('não verificada') && r302.textContent.includes('A estação mudou depois desta proposta'),
  '(c) selos, correção proposta, fonte e aviso de estação mudada');

// (g) escape
confere(d.querySelectorAll('#panel-revisoes script, #panel-revisoes img').length === 0 && w.__xss === undefined && w.__xss2 === undefined,
  '(g) nada vindo do banco vira elemento em Revisões');
confere(r302.textContent.includes('trecho ' + HOSTIL) && ult.textContent.includes('Estação hostil ' + HOSTIL), '(g) trecho e ultimas.name aparecem literais');

// (b) em_fila = 40 → aviso em âmbar
emFila = 40;
await w.loadRevisoes();
await espera();
const pz = d.getElementById('rv-pausado');
confere(pz && pz.textContent.includes('revisor pausado: só grava estação sem achado até a fila baixar') && /d97706|217, 119, 6/.test(pz.getAttribute('style')),
  '(b) em_fila 40: aviso de pausa em âmbar');
emFila = 39;

// (h) ok:false → alert, sem recarregar
resp.aprovar = { ok: false, erro: 'nao_pendente' };
let antes = conta('admin_curadoria_list');
await w.aprovarItemFila(302, 'rv');
confere(alertas.some((a) => a.includes('nao_pendente')) && conta('admin_curadoria_list') === antes, '(h) aprovar ok:false: alert e sem recarregar');
resp.rejeitar = { ok: false, erro: 'ja_fechado' };
antes = conta('admin_curadoria_list');
await w.rejeitarItemFila(302, 'rv');
confere(alertas.some((a) => a.includes('ja_fechado')) && conta('admin_curadoria_list') === antes, '(h) rejeitar ok:false: alert e sem recarregar');

// (e) ok:true → recarrega Revisões (painel + lista de estação), não a Fila nem os Resumos
resp.aprovar = { ok: true };
const p0 = conta('admin_revisor_painel'), t0 = conta('admin_temas_overview');
antes = conta('admin_curadoria_list');
await w.aprovarItemFila(302, 'rv');
const ca = chamadas.filter((c) => c[0] === 'admin_revisor_aprovar').pop();
confere(ca && ca[1].p_id === 302 && ca[1].p_nota === 'nota de teste', '(e) aprovar manda p_id e p_nota');
confere(conta('admin_curadoria_list') === antes + 1 && ultimaList()[1].p_categoria === 'estacao' && conta('admin_revisor_painel') === p0 + 1
  && conta('admin_temas_overview') === t0, '(e) aprovar ok:true recarrega Revisões');
w.prompt = () => null;
const nr = chamadas.length;
await w.rejeitarItemFila(302, 'rv');
confere(chamadas.length === nr, '(e) cancelar o prompt não chama RPC');
w.prompt = () => '';

// (d) Aprovadas
w.filtrarRevisoesStatus('aprovada');
await espera();
confere(ultimaList()[1].p_status === 'aprovada' && ultimaList()[1].p_categoria === 'estacao', '(d) filtro Aprovadas pede aprovada de estação');
confere(d.getElementById('rvf-st-aprovada').classList.contains('active') && !d.getElementById('rvf-st-pendente').classList.contains('active'), '(d) botão Aprovadas ativo');
const r304 = cartao('#rv-list', 304);
confere(r304 && JSON.stringify(botoes(r304)) === JSON.stringify(['Rejeitar', '↺ Reabrir']), '(d) aprovado: só Rejeitar e Reabrir');
confere(r304.textContent.includes('aprovado em 21/11') && r304.textContent.includes('verificada') && !r304.textContent.includes('não verificada'), '(d) aprovado em dd/mm e fonte verificada');
antes = conta('admin_curadoria_list');
await w.reabrirItemFila(304, 'rv');
confere(conta('admin_curadoria_list') === antes + 1 && ultimaList()[1].p_categoria === 'estacao', '(e) reabrir recarrega Revisões');

w.filtrarRevisoesStatus('resolvida');
await espera();
const r305 = cartao('#rv-list', 305);
confere(r305 && JSON.stringify(botoes(r305)) === JSON.stringify(['↺ Reabrir']) && r305.textContent.includes('rejeitada'), '(d) resolvida: só Reabrir, mostra decisão');
w.filtrarRevisoesStatus('pendente');
await espera();

// ── Resumos › Fila de curadoria ──────────────────────────────────────────────
confere(!d.getElementById('ff-estacao'), '(f) botão ff-estacao não existe');
w.filtrarFila('estacao');   // valor antigo: cai em Todas, sem quebrar
confere(d.getElementById('ff-todas').classList.contains('active'), '(f) filtrarFila(estacao) vira Todas');
await w.loadFila();
await espera();
confere(ultimaList()[1].p_categoria === null, '(f) Fila pede p_categoria null');
const fl = [...d.querySelectorAll('#fila-list .st-card')];
confere(fl.length === 2 && !cartao('#fila-list', 302) && !!cartao('#fila-list', 303) && !!cartao('#fila-list', 306), '(f) Fila sem item de estação, com resumo e desatualizado');
confere(!d.getElementById('fila-list').textContent.includes('Aprovar'), '(f) Fila sem Aprovar');
const ap = d.getElementById('fila-aponta-revisoes');
confere(ap && ap.textContent.includes('Itens de estação estão em Estações › 🔎 Revisões') && ap.textContent.includes('(39 pendentes)'), '(f) linha que aponta para Revisões com N pendentes');
const cont = d.getElementById('fila-resumo-contagens').textContent;
confere(cont.includes('2 pendentes') && !cont.includes('estação') && !cont.includes('freio') && !cont.includes('pausado'), '(f) contagens do topo só de resumo, sem freio');
confere(d.getElementById('rf-fila-n').textContent === '(2)', '(f) rf-fila-n conta só resumo');
// ação na Fila recarrega a Fila (p_categoria null) e os Resumos
antes = conta('admin_curadoria_list');
const t1 = conta('admin_temas_overview');
w.prompt = () => 'feito';
await w.resolverItemFila(303, 'fila');
confere(conta('admin_curadoria_list') === antes + 1 && ultimaList()[1].p_categoria === null && conta('admin_temas_overview') === t1 + 1, '(e) resolver na Fila recarrega Fila e Resumos');

confere(erros.length === 0, 'nenhuma exceção durante o teste' + (erros.length ? ' — ' + erros[0] : ''));

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
