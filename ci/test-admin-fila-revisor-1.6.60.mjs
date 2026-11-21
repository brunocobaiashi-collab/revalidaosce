// Teste da Fila de curadoria com Aprovar e Rejeitar (admin v1.6.60), em jsdom,
// com rpcAdmin simulado. Nada de rede, nada de produção.
// Rodar a partir da raiz: node ci/test-admin-fila-revisor-1.6.60.mjs   (saída 1 = falhou)
//
// Prova: (a) item pendente de estação mostra Aprovar e Rejeitar; (b) item pendente de
// resumo não mostra; (c) item aprovado mostra Rejeitar e Reabrir; (d) campos do banco
// escapados; (e) ok:false gera alert e não recarrega; (f) ok:true recarrega; (g) filtro
// de três estados chama admin_curadoria_list com o status certo; (h) contagens e freio.
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
const PENDENTES = [
  { id: 302, categoria: 'estacao', tipo: 'revisor', status: 'pendente', prioridade: 2, criado_em: '2026-11-20T12:00:00Z',
    tema_id: 't1', tema_nome: 'Tema um', station_nome: 'Estação 15d1c68c', trecho: 'trecho ' + HOSTIL,
    camada: 'clinica', correcao_proposta: 'trocar dose ' + HOSTIL, fonte: 'Diretriz ' + HOSTIL, fonte_verificada: false,
    station_fonte: 'inep', conteudo_mudou: true },
  { id: 303, categoria: 'resumo', tipo: 'editorial', status: 'pendente', prioridade: 3, criado_em: '2026-11-20T12:00:00Z',
    tema_id: 't2', tema_nome: 'Tema dois', trecho: 'resumo com erro' },
];
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
console.log('\n── Teste · admin Fila de curadoria com Aprovar e Rejeitar (jsdom) ─────────────');

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
['aprovarItemFila', 'rejeitarItemFila', 'filtrarFilaStatus', 'resolverItemFila', 'reabrirItemFila', 'loadFila']
  .forEach((f) => confere(typeof w[f] === 'function', f + ' em window'));

const chamadas = [];
const resp = { aprovar: { ok: true }, rejeitar: { ok: true } };
let freio = { em_fila: 12, limite: 40 };
w.rpcAdmin = async (fn, args) => {
  chamadas.push([fn, JSON.parse(JSON.stringify(args || {}))]);
  if (fn === 'admin_curadoria_list') {
    const itens = args.p_status === 'aprovada' ? APROVADAS : args.p_status === 'resolvida' ? RESOLVIDAS : PENDENTES;
    return { itens, counts: { pendente_total: 2, por_categoria: { estacao: 1, resumo: 1 }, temas_travados: 0, aprovada_total: 1, freio_estacao: freio } };
  }
  if (fn === 'admin_revisor_aprovar') return resp.aprovar;
  if (fn === 'admin_revisor_rejeitar') return resp.rejeitar;
  if (fn === 'admin_curadoria_reabrir') return { ok: true };
  throw new Error('rpc nao simulada: ' + fn);
};
const alertas = [];
w.alert = (m) => alertas.push(String(m));
w.prompt = () => 'nota de teste';
w.confirm = () => true;

const cartao = (id) => [...d.querySelectorAll('#fila-list .st-card')].find((c) => c.innerHTML.includes('(' + id + ')'));
const botoes = (c) => (c ? [...c.querySelectorAll('button')].map((b) => b.textContent.trim()) : []);
const nList = () => chamadas.filter((c) => c[0] === 'admin_curadoria_list').length;

await w.loadFila();
await espera();
const c302 = cartao(302), c303 = cartao(303);
confere(c302 && botoes(c302).includes('Aprovar') && botoes(c302).includes('Rejeitar') && botoes(c302).includes('✓ Resolver'), '(a) pendente de estação: Aprovar, Rejeitar e Resolver');
confere(c303 && !botoes(c303).includes('Aprovar') && !botoes(c303).includes('Rejeitar') && botoes(c303).includes('✓ Resolver'), '(b) pendente de resumo: só Resolver');
confere(c302.textContent.includes('revisor automático') && c302.textContent.includes('clínica') && c302.textContent.includes('INEP'), '(a) selos tipo, camada e INEP');
confere(c302.textContent.includes('Correção proposta:') && c302.textContent.includes('não verificada'), '(a) correção proposta e fonte não verificada');
confere(c302.textContent.includes('A estação mudou depois desta proposta'), '(a) aviso de conteúdo mudou');
confere(d.querySelectorAll('#fila-list script, #fila-list img').length === 0 && w.__xss === undefined && w.__xss2 === undefined, '(d) nada vindo do banco vira elemento');
confere(c302.textContent.includes(HOSTIL), '(d) texto hostil aparece literal');
const cont = d.getElementById('fila-resumo-contagens');
confere(cont.textContent.includes('aprovadas 1') && cont.textContent.includes('estação na fila 12 de 40') && !cont.textContent.includes('freio'), '(h) contagens com aprovadas e freio normal');

// (e) ok:false → alert, sem recarregar
resp.aprovar = { ok: false, erro: 'nao_pendente' };
let antes = nList();
await w.aprovarItemFila(302);
confere(alertas.some((a) => a.includes('nao_pendente')) && nList() === antes, '(e) aprovar ok:false: alert com o erro e sem recarregar');
const ca = chamadas.filter((c) => c[0] === 'admin_revisor_aprovar').pop();
confere(ca && ca[1].p_id === 302 && ca[1].p_nota === 'nota de teste', '(e) aprovar manda p_id e p_nota');
resp.rejeitar = { ok: false, erro: 'ja_fechado' };
antes = nList();
await w.rejeitarItemFila(302);
confere(alertas.some((a) => a.includes('ja_fechado')) && nList() === antes, '(e) rejeitar ok:false: alert com o erro e sem recarregar');

// (f) ok:true → recarrega
resp.aprovar = { ok: true };
antes = nList();
await w.aprovarItemFila(302);
confere(nList() === antes + 1, '(f) aprovar ok:true recarrega a fila');
// cancelar o prompt não chama a RPC
w.prompt = () => null;
const nr = chamadas.length;
await w.rejeitarItemFila(302);
confere(chamadas.length === nr, '(f) cancelar o prompt não chama RPC');
w.prompt = () => '';

// (g) Aprovadas
w.filtrarFilaStatus('aprovada');
await espera();
confere(chamadas.filter((c) => c[0] === 'admin_curadoria_list').pop()[1].p_status === 'aprovada', '(g) filtro Aprovadas pede p_status aprovada');
confere(d.getElementById('ff-st-aprovada').classList.contains('active') && !d.getElementById('ff-st-pendente').classList.contains('active'), '(g) botão Aprovadas ativo');
const c304 = cartao(304);
confere(c304 && JSON.stringify(botoes(c304)) === JSON.stringify(['Rejeitar', '↺ Reabrir']), '(c) aprovado: só Rejeitar e Reabrir');
confere(c304.textContent.includes('aprovado em 21/11') && c304.textContent.includes('verificada') && !c304.textContent.includes('não verificada'), '(c) aprovado em dd/mm e fonte verificada');

// Resolvidas
w.filtrarFilaStatus('resolvida');
await espera();
const c305 = cartao(305);
confere(c305 && JSON.stringify(botoes(c305)) === JSON.stringify(['↺ Reabrir']) && c305.textContent.includes('rejeitada'), '(g) resolvida: só Reabrir, mostra decisão');

// freio estourado
freio = { em_fila: 41, limite: 40 };
w.filtrarFilaStatus('pendente');
await espera();
confere(cont.textContent.includes('revisor pausado (freio)'), '(h) freio estourado aparece em destaque');
confere(erros.length === 0, 'nenhuma exceção durante o teste' + (erros.length ? ' — ' + erros[0] : ''));

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
