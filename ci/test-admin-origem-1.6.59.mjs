// Teste da coluna Origem e do cartão Origem dos cadastros em Acessos > Usuários
// (admin v1.6.59), em jsdom, com as RPCs simuladas. Nada de rede, nada de produção.
// Rodar a partir da raiz: node ci/test-admin-origem-1.6.59.mjs   (saída 1 = falhou)
//
// Prova: (a) coluna e cartão aparecem com dados; (b) valores hostis ficam escapados,
// inclusive no title; (c) RPC de origem com erro, ausente ou lançando exceção NÃO
// altera a tabela (só a coluna Origem vira —) e o cartão vira uma linha de aviso;
// (d) lista, paginação, busca e filtro por estágio continuam iguais (e, se a main
// estiver disponível no git, as 14 colunas antigas saem idênticas às da main);
// (e) o admin.html executa sem exceção.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
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

// ── dados simulados ──────────────────────────────────────────────────────────
const HOSTIL = '<img src=x onerror="window.__xss=1"> "aspas" & \'simples\'';
const HOSTIL_LP = '/" onmouseover="window.__xss3=1" x="<b>&amp;';
const USERS_P1 = [
  { user_id: 'u1', email: 'um@exemplo.invalid', full_name: 'Um', role: 'user', stage: 'treinando', simulations_count: 3,
    created_at: '2026-11-10T12:00:00Z', email_confirmed: true, last_access_at: '2026-11-17T12:00:00Z', last_payment_method: 'pix' },
  { user_id: 'u2', email: 'dois@exemplo.invalid', full_name: 'Dois ' + HOSTIL, role: 'user', stage: 'pagante', sub_status: 'active',
    simulations_count: 9, created_at: '2026-11-11T12:00:00Z', email_confirmed: true, subscription_expires_at: '2026-12-11T12:00:00Z',
    last_payment_method: 'credit_card' },
  { user_id: 'u3', email: 'tres@exemplo.invalid', full_name: null, role: 'admin', stage: 'treinando', simulations_count: 0,
    created_at: '2026-11-12T12:00:00Z', email_confirmed: false },
  { user_id: 'u4', email: 'quatro@exemplo.invalid', full_name: 'Quatro', role: 'user', stage: 'sem_estacao', simulations_count: 0,
    created_at: '2026-11-13T12:00:00Z', email_confirmed: true },
];
const LISTA = { meta: { total_count: 120, page: 1, per_page: 50, total_pages: 3, stage_counts: { todos: 120, nao_confirmado: 10, sem_estacao: 50, treinando: 40, pagante: 20 } }, users: USERS_P1 };
const ORIGEM = [
  { user_id: 'u1', cad_utm_campaign: 'revalida_busca', cad_utm_content: 'grupo_osce', cad_landing_path: HOSTIL_LP, cad_anuncio: true,
    venda_tipo: 'app', venda_utm_source: 'app', venda_utm_medium: 'trial_banner', venda_em: '2026-11-15T10:00:00' },
  { user_id: 'u2', cad_utm_campaign: HOSTIL, cad_utm_content: null, cad_anuncio: false,
    venda_tipo: 'landing', venda_utm_medium: HOSTIL, venda_em: '2026-11-15T10:00:00' },
  { user_id: 'u3', cad_anuncio: true },                                   // só clique, sem utm
  { user_id: 'u4' },                                                       // nada registrado
];
const RESUMO = (dias) => ({
  dias, desde: '2026-11-12', admins_excluidos: 1,
  origens: [
    { origem_rotulo: 'sem origem', cadastros: 40, treinaram: 10, compraram: 2 },
    { origem_rotulo: 'revalida_busca / grupo_osce', cadastros: 12, treinaram: 6, compraram: 3 },
    { origem_rotulo: HOSTIL, cadastros: 1, treinaram: 0, compraram: 0 },
  ],
  vendas: [
    { venda_tipo: 'app', venda_utm_medium: 'trial_banner', vendas: 2, valor_centavos: 39400 },
    { venda_tipo: 'sem_origem', venda_utm_medium: null, vendas: 3, valor_centavos: 59100 },
    { venda_tipo: 'landing', venda_utm_medium: HOSTIL, vendas: 1, valor_centavos: 19700 },
  ],
});

// ── monta uma página com os dublês do cliente Supabase ───────────────────────
async function montar(html, modoOrigem) {
  const erros = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => erros.push(e.message));
  const dom = new JSDOM(prepararHTML(html, path.dirname(ARQ)), {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://simulador.revalidaosce.com.br/admin.html', virtualConsole: vc, beforeParse: dublar,
  });
  await espera(400);
  const w = dom.window;
  const chamadas = [];
  let jwt = 0;
  w._adminSession = { access_token: 'jwt-de-teste' };
  w.getFreshAdminToken = async () => { jwt++; return 'jwt-de-teste'; };
  const modo = { origem: modoOrigem };
  const rpc = async (fn, args) => {
    chamadas.push([fn, JSON.parse(JSON.stringify(args || {}))]);
    if (fn === 'admin_list_users') {
      const pg = (args && args.p_page) || 1;
      return { data: { meta: { ...LISTA.meta, page: pg, stage: args.p_stage || null, search: args.p_search || null }, users: USERS_P1 }, error: null };
    }
    if (fn === 'admin_presence') return { data: [{ email: 'um@exemplo.invalid', last_seen_at: new Date().toISOString(), in_station: true }], error: null };
    if (fn === 'admin_checkout_status') return { data: [{ email: 'um@exemplo.invalid', ultimo_tipo: 'pix_gerado', ultimo_em: '2026-11-14T10:00:00Z', n_eventos: 1, trial_usado: 2 }], error: null };
    if (fn === 'admin_checkout_recentes') return { data: [], error: null };
    if (fn === 'admin_origem_usuarios' || fn === 'admin_origem_resumo') {
      if (modo.origem === 'erro') return { data: null, error: { code: '42501', message: 'access_denied' } };
      if (modo.origem === 'ausente') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
      if (modo.origem === 'excecao') throw new Error('rede caiu');
      if (modo.origem === 'lixo') return { data: 'nao sou lista', error: null };
      return { data: fn === 'admin_origem_usuarios' ? ORIGEM.filter((o) => args.p_user_ids.includes(o.user_id)) : RESUMO(args.p_dias), error: null };
    }
    return { data: null, error: { message: 'rpc nao simulada: ' + fn } };
  };
  w.supabase.createClient = () => ({ auth: { setSession: async () => ({ data: {}, error: null }) }, rpc });
  return { dom, w, d: w.document, erros, chamadas, modo, jwt: () => jwt };
}

const linhas = (d) => [...d.querySelectorAll('#users-list tbody tr')];
const cabecalho = (d) => [...d.querySelectorAll('#users-list thead th')].map((th) => th.textContent.trim());
const celulas = (tr) => [...tr.children].map((td) => td.innerHTML);
// Sem a coluna Origem e sem a célula "Online" (depende do relógio: "agora", "há 1s"...)
const semOrigem = (d) => linhas(d).map((tr) => celulas(tr).slice(1, 14).join('§'));
const n = (ch, fn) => ch.filter((c) => c[0] === fn).length;
const ultima = (ch, fn) => ch.filter((c) => c[0] === fn).pop();
const COLS_ANTIGAS = ['Online', 'Email', 'Nome', 'Criado em', 'Confirmou?', 'Estações', 'Trial', 'Checkout', 'Acesso', 'Assinatura', 'Plano', 'Validade', 'Método', 'Último acesso'];

const HTML = fs.readFileSync(ARQ, 'utf8');
console.log('\n── Teste · admin Origem dos usuários (jsdom) ─────────────');

// ── (a) com dados ────────────────────────────────────────────────────────────
const A = await montar(HTML, 'ok');
confere(A.erros.length === 0, '(e) admin.html carrega sem exceção' + (A.erros.length ? ' — ' + A.erros[0] : ''));
confere(typeof A.w.setOrigemDias === 'function' && typeof A.w.loadUsers === 'function', 'setOrigemDias e loadUsers em window');
confere(!!A.d.getElementById('users-origem'), 'contêiner do cartão existe');
await A.w.loadUsers(1);
await espera(60);
confere(JSON.stringify(cabecalho(A.d)) === JSON.stringify([...COLS_ANTIGAS, 'Origem']), '(a) cabeçalho = 14 colunas de antes + Origem, no fim');
confere(linhas(A.d).length === 4, '(a) 4 linhas de usuário');
const orig = ultima(A.chamadas, 'admin_origem_usuarios');
confere(orig && JSON.stringify(orig[1].p_user_ids) === JSON.stringify(['u1', 'u2', 'u3', 'u4']), '(a) admin_origem_usuarios recebe os ids desta página');
confere(A.jwt() >= 1, '(§10) JWT renovado antes das chamadas privilegiadas');
const c = linhas(A.d).map((tr) => tr.lastElementChild);
confere(c[0].textContent.includes('Cadastro: revalida_busca / grupo_osce') && c[0].textContent.includes('Venda: app / trial_banner'), '(a) u1: campanha / grupo e app / trial_banner');
confere(c[2].textContent.includes('Cadastro: anúncio') && !c[2].textContent.includes('Venda:'), '(a) u3: só clique vira "anúncio", sem linha de venda');
confere(c[3].textContent.trim() === 'Sem origem registrada', '(a) u4: "Sem origem registrada"');
const card = A.d.getElementById('users-origem');
confere(card.textContent.includes('Origem dos cadastros') && card.textContent.includes('últimos 30 dias'), '(a) cartão aparece, padrão 30 dias');
confere(card.textContent.includes('revalida_busca / grupo_osce') && card.textContent.includes('6 (50%)') && card.textContent.includes('3 (25%)'), '(a) cartão: cadastros, treinaram e compraram por origem');
confere(card.textContent.includes('app / trial_banner: 2 (R$ 394,00)') && card.textContent.includes('sem origem: 3 (R$ 591,00)'), '(a) cartão: vendas por superfície com valor');
confere(card.textContent.includes('aceitou os cookies'), '(a) cartão explica a origem só com cookies aceitos');
confere(card.textContent.includes('1 conta(s) de admin'), '(a) cartão: admins fora do resumo');
// seletor 7 dias
const b7 = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '7 dias');
b7.click();
await espera(60);
confere(ultima(A.chamadas, 'admin_origem_resumo')[1].p_dias === 7 && card.textContent.includes('últimos 7 dias'), '(a) seletor 7 dias recarrega o cartão');
confere(!/gclid|sck|GCLID|SCK/.test(A.d.getElementById('users-list').textContent), '(a) tabela não mostra gclid nem sck');

// ── (b) valores hostis ───────────────────────────────────────────────────────
const lista = A.d.getElementById('users-list');
confere(lista.querySelectorAll('img,script').length === 0 && card.querySelectorAll('img,script').length === 0, '(b) nenhum <img>/<script> criado por utm hostil');
confere(A.w.__xss === undefined && A.w.__xss3 === undefined, '(b) nenhum handler hostil executou');
confere(c[1].textContent.includes('Cadastro: ' + HOSTIL) && c[1].textContent.includes('Venda: landing / ' + HOSTIL), '(b) utm hostil aparece como texto literal na coluna');
const tit = c[0].querySelector('[title]');
confere(tit && tit.getAttribute('title') === 'Página de entrada: ' + HOSTIL_LP && tit.attributes.length === 1, '(b) landing_path hostil só no title, escapado, sem atributo extra');
confere(!c[0].textContent.includes(HOSTIL_LP), '(b) landing_path bruto não aparece no texto da tabela');
confere(card.textContent.includes(HOSTIL + '1') || card.textContent.includes(HOSTIL), '(b) rótulo hostil no cartão vira texto');
confere(card.textContent.includes('landing / ' + HOSTIL + ': 1'), '(b) botão hostil nas vendas vira texto');

// ── (c) RPC de origem falha de vários jeitos: a tabela não muda ─────────────
const base = semOrigem(A.d);
const statsBase = A.d.getElementById('users-stats').innerHTML;
const pagBase = A.d.getElementById('users-pagination').innerHTML;
for (const modo of ['erro', 'ausente', 'excecao', 'lixo']) {
  const X = await montar(HTML, modo);
  await X.w.loadUsers(1);
  await espera(60);
  const cs = linhas(X.d).map((tr) => tr.lastElementChild.textContent.trim());
  confere(X.erros.length === 0 && linhas(X.d).length === 4, `(c) ${modo}: aba carrega, 4 linhas, sem exceção`);
  confere(JSON.stringify(semOrigem(X.d)) === JSON.stringify(base), `(c) ${modo}: as outras 13 colunas idênticas às do caso com dados`);
  confere(cs.every((t) => t === '—'), `(c) ${modo}: coluna Origem mostra só —`);
  confere(X.d.getElementById('users-stats').innerHTML === statsBase && X.d.getElementById('users-pagination').innerHTML === pagBase, `(c) ${modo}: contagem, "em estação agora" e paginação iguais`);
  confere(/indisponível agora/.test(X.d.getElementById('users-origem').textContent), `(c) ${modo}: cartão vira uma linha de aviso`);
}
confere(statsBase.includes('em estação agora'), '(§10) indicador "em estação agora" continua');

// ── (d) busca, paginação e estágio continuam iguais ─────────────────────────
A.d.getElementById('users-search').value = 'um@';
A.chamadas.length = 0;
await A.w.loadUsers(1);
await espera(60);
let lu = ultima(A.chamadas, 'admin_list_users');
confere(lu && lu[1].p_search === 'um@' && lu[1].p_page === 1 && lu[1].p_per_page === 50 && lu[1].p_stage === null, '(d) busca: admin_list_users com os mesmos parâmetros de antes');
const prox = [...A.d.querySelectorAll('#users-pagination button')].find((b) => b.textContent.includes('Próxima'));
prox.click();
await espera(80);
lu = ultima(A.chamadas, 'admin_list_users');
confere(lu && lu[1].p_page === 2, '(d) paginação: Próxima pede a página 2');
A.w.setUsersStage('pagante');
await espera(80);
lu = ultima(A.chamadas, 'admin_list_users');
confere(lu && lu[1].p_stage === 'pagante' && lu[1].p_page === 1, '(d) filtro de estágio pagante, volta à página 1');
confere(A.d.querySelectorAll('#users-stage-filters button, #users-stage-filters [onclick]').length >= 5, '(d) chips de estágio renderizados');
confere(n(A.chamadas, 'admin_list_users') === 3 && n(A.chamadas, 'admin_origem_usuarios') === 3, '(d) uma chamada de origem por carga de página, nunca mais de uma');

// ── (d) comparação com a main, se disponível no git ─────────────────────────
let htmlMain = null;
try { htmlMain = execSync('git show origin/main:' + ARQ, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); } catch (_) {}
if (htmlMain && htmlMain !== HTML && !htmlMain.includes('admin_origem_usuarios')) {
  const M = await montar(htmlMain, 'ok');
  await M.w.loadUsers(1);
  await espera(60);
  confere(JSON.stringify(cabecalho(M.d)) === JSON.stringify(COLS_ANTIGAS), '(d) main: cabeçalho de 14 colunas conferido');
  const velho = linhas(M.d).map((tr) => celulas(tr).slice(1, 14).join('§'));
  confere(JSON.stringify(velho) === JSON.stringify(base), '(d) as 13 colunas estáveis saem idênticas às da main');
  confere(M.d.getElementById('users-stats').innerHTML === statsBase && M.d.getElementById('users-pagination').innerHTML === pagBase, '(d) contagem e paginação idênticas às da main');
} else {
  console.log('   aviso  main sem versão anterior acessível no git: comparação com a main pulada');
}

console.log(`\n   ${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
