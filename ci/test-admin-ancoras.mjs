// Teste da sub-aba Âncoras do admin (v1.6.57), em jsdom, com respostas simuladas
// das RPCs e da prévia do hyper-service. Nada de rede, nada de produção.
// Rodar a partir da raiz: node ci/test-admin-ancoras.mjs   (saída 1 = falhou)
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

function prepararHTML(arquivo) {
  const dir = path.dirname(arquivo);
  return fs.readFileSync(arquivo, 'utf8').replace(
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

const erros = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => erros.push(e.message));
const dom = new JSDOM(prepararHTML(ARQ), {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'https://simulador.revalidaosce.com.br/admin.html', virtualConsole: vc, beforeParse: dublar,
});
await espera(400);
const w = dom.window, d = w.document;

// ── dublês ───────────────────────────────────────────────────────────────────
const chamadas = [];           // [nome, corpo]
const respostas = {};          // nome -> função(corpo) | valor
w.getFreshAdminToken = async () => 'jwt-de-teste';
w.rpcAdmin = async (fn, body) => {
  chamadas.push([fn, JSON.parse(JSON.stringify(body || {}))]);
  const r = respostas[fn];
  if (r === undefined) throw new Error(fn + ' sem resposta simulada');
  return typeof r === 'function' ? r(body) : JSON.parse(JSON.stringify(r));
};
let previas = 0, modoPrevia = 'ok';
const hyperLog = [], hyperResp = {};   // parte B: ancora_importar / ancora_retirar
w.fetch = async (url, opts) => {
  const corpo = opts && opts.body ? JSON.parse(opts.body) : {};
  if (corpo.action === 'ancora_previa') {
    previas++;
    if (modoPrevia === '429') return { ok: false, status: 429, headers: { get: () => 'application/json' },
      json: async () => ({ error: 'fonte_limite_429', mensagem: 'A fonte pediu para esperar 60 s' }) };
    return { ok: true, status: 200, headers: { get: () => 'image/png' }, blob: async () => new w.Blob(['png'], { type: 'image/png' }) };
  }
  if (corpo.action === 'ancora_importar' || corpo.action === 'ancora_retirar') {
    hyperLog.push(corpo);
    const [status, body] = hyperResp[corpo.action];
    return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => JSON.parse(JSON.stringify(body)) };
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
};
let criadas = 0, revogadas = 0;
w.URL.createObjectURL = () => 'blob:teste/' + (++criadas);
w.URL.revokeObjectURL = () => { revogadas++; };

const n = (fn) => chamadas.filter((c) => c[0] === fn).length;
const ultima = (fn) => chamadas.filter((c) => c[0] === fn).pop();
const det = () => d.getElementById('an-detalhe');
const botao = (raiz, texto) => [...raiz.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(texto));
const erroDe = (campo) => det().querySelector('.an-erro[data-campo="' + campo + '"]');
const visivel = (el) => !!el && el.style.display !== 'none' && el.textContent.trim() !== '';

const MAL = '<script>window.__xss=1</script><img src=x onerror="window.__xss2=1"> "aspas" \'simples\'';
const LINHAS = [
  { id: 'a1', fonte: 'multicare', fonte_id: 'PMC1_fig1', url_fonte: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/', previa_url: null,
    licenca: 'CC BY 4.0', licenca_codigo: 'CC BY', autores: '["Silva A", "Souza B"]', artigo_titulo: 'Titulo ' + MAL, periodico: 'J Teste', ano: 2021,
    doi: '10.1/x', pmcid: 'PMC1', legenda_original: 'Chest X-ray showing right lower lobe consolidation. ' + MAL,
    trecho_caso_original: 'A 54-year-old man presented with fever.', paciente_idade: 54, paciente_sexo: 'M',
    achado_fonte: 'right lower lobe consolidation', diagnostico_fonte: 'consolidation', achado_verdade: 'Consolidação em lobo inferior direito',
    diagnostico_verdade: 'Pneumonia', modalidade: 'Radiografia de tórax', incidencia: 'PA', area: 'Clínica Médica', tema_id: 't1',
    rosto_identificavel: false, dado_paciente_visivel: false, marcacoes: 'setas_letras', legivel_celular: true, estado: 'candidata',
    arquivo_origem: '{"largura":1200,"altura":980}' },
  { id: 'a2', fonte: 'multicare', fonte_id: 'PMC2_fig3', url_fonte: 'javascript:alert(1)', previa_url: null, licenca: 'CC BY 4.0',
    autores: 'Lee C', artigo_titulo: 'ECG', periodico: 'X', ano: 2020, legenda_original: 'ECG with ST elevation in V1-V4.',
    trecho_caso_original: '', paciente_idade: null, paciente_sexo: 'F', achado_fonte: 'ST elevation', diagnostico_fonte: null,
    achado_verdade: 'Supra de ST', diagnostico_verdade: 'IAM anterior', modalidade: 'ECG', area: 'Outra', tema_id: null,
    marcacoes: 'nenhuma', estado: 'candidata', arquivo_origem: null },
];
respostas.admin_temas_overview = [{ tema_id: 't1', nome: 'Pneumonia' }];

console.log('\n── Teste · admin Âncoras (jsdom) ─────────────────────────');
confere(erros.length === 0, 'admin.html carrega sem exceção' + (erros.length ? ' — ' + erros[0] : ''));
confere(typeof w.loadAncoras === 'function' && typeof w.filtrarAncoras === 'function' && typeof w.filtrarAncorasTema === 'function', 'funções de onclick existem em window');
confere(!!d.getElementById('st-ancoras') && !!d.getElementById('panel-ancoras'), 'sub-aba e painel existem');

// 1. lista vazia
respostas.admin_ancora_resumo = [];
respostas.admin_ancora_list = [];
w.switchTab('ancoras');
await espera();
confere(d.getElementById('panel-ancoras').classList.contains('active'), 'switchTab ativa o painel');
confere(d.getElementById('an-list').textContent.includes('Nenhuma âncora'), 'lista vazia mostra aviso');
confere(ultima('admin_ancora_list')[1].p_estado === 'candidata', 'padrão: candidatas');

// 2. lista com linhas + texto de terceiros
respostas.admin_ancora_resumo = [{ tema_id: 't1', estado: 'candidata', n: 20 }, { tema_id: null, estado: 'candidata', n: 6 }, { tema_id: 't1', estado: 'rejeitada', n: 1 }];
respostas.admin_ancora_list = LINHAS;
await w.loadAncoras();
await espera();
const lista = d.getElementById('an-list');
confere(lista.querySelectorAll('.an-card').length === 2, 'lista com 2 linhas');
confere(d.querySelector('#an-resumo b[data-estado="candidata"]').textContent === '26', 'resumo soma 26 candidatas');
confere(lista.querySelector('.an-card[data-id="a1"] .an-aviso') && lista.querySelector('.an-card[data-id="a1"] .an-aviso').textContent.includes('marcação'), 'aviso de marcação sugerida pela carga');
confere(!lista.querySelector('.an-card[data-id="a2"] .an-aviso'), 'sem aviso quando a carga diz nenhuma');
confere(lista.textContent.includes('1200 × 980 px') && lista.textContent.includes('54 anos, masculino') && lista.textContent.includes('Pneumonia'), 'tamanho, paciente e tema na linha');
confere(lista.querySelectorAll('script,img').length === 0 && lista.textContent.includes('<script>window.__xss=1</script>'), 'legenda com <script> vira texto, não HTML');

// 3. abrir a linha
respostas.admin_ancora_get = { ok: true, ancora: Object.assign({}, LINHAS[0], { caso_texto: 'Caso <b>inteiro</b> ' + MAL }) };
await w.abrirAncora('a1');
await espera(60);
confere(previas === 1 && criadas === 1, 'abrir chama a prévia uma vez e cria object URL');
const imgs = det().querySelectorAll('img');
confere(imgs.length === 2 && [...imgs].every((i) => i.getAttribute('src') === 'blob:teste/1'), 'imagem nas duas molduras');
confere(det().textContent.includes('Celular (360 px)'), 'moldura de celular');
confere(n('admin_ancora_get') === 1, 'abrir chama admin_ancora_get');
confere(det().querySelectorAll('script,b>b').length === 0 && det().querySelector('details div').textContent.includes('Caso <b>inteiro</b>'), 'texto do caso entra como texto');
const link = det().querySelector('a');
confere(link && link.href.startsWith('https://') && link.rel === 'noopener noreferrer' && link.target === '_blank', 'link do artigo https com noopener noreferrer');
confere(det().querySelector('.an-credito').textContent.includes('Silva A, Souza B') && det().querySelector('.an-credito').textContent.includes('"aspas"'), 'crédito com autores e aspas como texto');
confere(det().querySelector('input[data-campo="achado_fonte"]').value === 'right lower lobe consolidation' && det().querySelector('select[data-campo="area"]').value === 'Clínica Médica' && det().querySelector('select[data-campo="tema_id"]').value === 't1', 'formulário pré-preenchido');
confere(det().querySelectorAll('input[type=radio]').length === 8 && det().querySelectorAll('input[type=radio]:checked').length === 0, 'triagem: 4 perguntas sem resposta pré-marcada');
confere(w.__xss === undefined && w.__xss2 === undefined, 'nenhum script de terceiros executou');

// 4. triagem incompleta não chama a RPC
d.querySelector('input[data-tri="rosto_identificavel"][value="nao"]').checked = true;
botao(det(), 'Aprovar').click();
await espera();
confere(n('admin_ancora_aprovar') === 0, 'triagem incompleta: aprovar não chama a RPC');
confere(visivel(det().querySelector('.an-geral')) && visivel(erroDe('marcacoes')) && !visivel(erroDe('rosto_identificavel')), 'triagem incompleta: avisa nas perguntas sem resposta');

// 5. aprovar recusado com três motivos
d.querySelector('input[data-tri="dado_paciente_visivel"][value="nao"]').checked = true;
d.querySelector('input[data-tri="marcacoes"][value="sim"]').checked = true;
d.querySelector('input[data-tri="legivel_celular"][value="sim"]').checked = true;
respostas.admin_ancora_aprovar = { ok: false, erro: 'reprovada_na_conferencia', motivos: ['achado_fonte_nao_literal', 'area_invalida', 'marcacoes_nao_permitidas'] };
botao(det(), 'Aprovar').click();
await espera();
const pAprov = ultima('admin_ancora_aprovar');
confere(pAprov && pAprov[1].p_triagem.rosto_identificavel === false && pAprov[1].p_triagem.legivel_celular === true && pAprov[1].p_triagem.marcacoes === 'setas_letras' && Object.keys(pAprov[1].p_triagem).length === 4, 'p_triagem com 4 chaves e booleanos de verdade');
confere(pAprov[1].p_id === 'a1' && pAprov[1].p_area === 'Clínica Médica' && pAprov[1].p_tema_id === 't1', 'payload do aprovar');
confere(visivel(erroDe('achado_fonte')) && erroDe('achado_fonte').textContent.includes('exatamente') && visivel(erroDe('area')) && visivel(erroDe('marcacoes')) && erroDe('marcacoes').textContent.includes('Rejeitar'), 'três motivos em português ao lado dos campos');
confere(!erroDe('area').textContent.includes('area_invalida'), 'motivo não aparece como código cru');

// 6. rejeitar sem motivo
const antesRej = n('admin_ancora_rejeitar');
botao(det(), 'Rejeitar').click();
await espera();
confere(n('admin_ancora_rejeitar') === antesRej && visivel(erroDe('motivo')), 'rejeitar sem motivo: não chama a RPC e avisa');

// 7. aprovar com sucesso
d.querySelector('input[data-tri="marcacoes"][value="nao"]').checked = true;
respostas.admin_ancora_aprovar = { ok: true, id: 'a1', estado: 'aprovada' };
const listasAntes = n('admin_ancora_list');
botao(det(), 'Aprovar').click();
await espera(60);
confere(ultima('admin_ancora_aprovar')[1].p_triagem.marcacoes === 'nenhuma', 'marcação não = nenhuma');
confere(d.getElementById('an-msg').textContent.includes('aprovada') && n('admin_ancora_list') === listasAntes + 1, 'aprovar com sucesso: mensagem e lista recarregada');
confere(revogadas >= 1 && det().style.display === 'none', 'fechar a linha revoga o object URL');

// 8. rejeitar com motivo
await w.abrirAncora('a2');
await espera(60);
confere(!det().querySelector('a'), 'url_fonte sem https não vira link');
det().querySelector('textarea[data-campo="motivo"]').value = 'Tem seta do autor';
respostas.admin_ancora_rejeitar = { ok: true, estado: 'rejeitada' };
botao(det(), 'Rejeitar').click();
await espera(60);
confere(ultima('admin_ancora_rejeitar')[1].p_motivo === 'Tem seta do autor' && d.getElementById('an-msg').textContent.includes('rejeitada'), 'rejeitar com motivo chama a RPC');

// 9. reabrir
respostas.admin_ancora_list = [Object.assign({}, LINHAS[1], { estado: 'rejeitada', motivo_rejeicao: 'Tem seta do autor' })];
w.filtrarAncoras('rejeitada');
await espera(60);
await w.abrirAncora('a2');
await espera(60);
confere(!botao(det(), 'Aprovar') && det().querySelectorAll('input[type=radio]:not(:disabled)').length === 0, 'linha rejeitada: sem Aprovar, formulário travado');
respostas.admin_ancora_reabrir = { ok: false, erro: 'retirada_pendente' };
botao(det(), 'Reabrir').click();
await espera(60);
confere(det().querySelector('.an-geral').textContent.includes('bucket'), 'reabrir recusado mostra o motivo em português');
respostas.admin_ancora_reabrir = { ok: true, estado: 'candidata' };
botao(det(), 'Reabrir').click();
await espera(60);
confere(d.getElementById('an-msg').textContent.includes('candidata'), 'reabrir com sucesso');

// 10. 429 da prévia: mostra a mensagem e não repete
respostas.admin_ancora_list = LINHAS;
w.filtrarAncoras('candidata');
await espera(60);
modoPrevia = '429';
const prevAntes = previas;
await w.abrirAncora('a1');
await espera(400);
const st = det().querySelector('.an-previa-status');
confere(previas === prevAntes + 1, '429: uma chamada só, sem repetição automática');
confere(st.textContent.includes('A fonte pediu para esperar 60 s') && st.textContent.includes('429'), '429: mostra a mensagem da fonte');
confere(botao(det(), 'Tentar a prévia de novo').style.display !== 'none', '429: oferece repetir à mão');

// 11. sair da aba libera a prévia
modoPrevia = 'ok';
await w.abrirAncora('a2');
await espera(60);
const revAntes = revogadas;
w.switchTab('pendentes');
await espera();
confere(revogadas === revAntes + 1 && det().style.display === 'none', 'sair da aba revoga o object URL');


// ══ PARTE B (v1.6.58) ══════════════════════════════════════════════════════
console.log('   ── parte B');
const alertas = [];
w.alert = (m) => { alertas.push(String(m)); };
const BASE = w.eval('STATION_IMAGES_BASE');
const ARQ_B = 'ancora-b1-abcd1234.webp';
const ANC = { image_file: ARQ_B, modality: 'Radiografia de tórax', incidence: 'PA', finding_truth: 'Consolidação em LID',
  diagnosis_truth: 'Pneumonia', area: 'Clínica Médica',
  image_credits: { author: 'Silva A', article: 'A case', journal: 'J', year: 2021, license: 'CC BY 4.0', source_url: 'https://x.org', pmcid: 'PMC1', modified: false } };
const B_SEM = Object.assign({}, LINHAS[0], { id: 'b1', estado: 'aprovada', arquivo_bucket: null, marcacoes: 'nenhuma' });
const B_COM = Object.assign({}, B_SEM, { arquivo_bucket: ARQ_B });

// modificacao_nao_permitida corrigida
confere(w.eval('AN_MOTIVOS.modificacao_nao_permitida[1]').includes('marcada como modificada') && !w.eval('AN_MOTIVOS.modificacao_nao_permitida[1]').includes('licença'), 'mensagem de modificacao_nao_permitida corrigida');

// B1. importar com sucesso
respostas.admin_ancora_list = [B_SEM];
w.filtrarAncoras('aprovada');
await espera(60);
await w.abrirAncora('b1');
await espera(60);
confere(!!botao(det(), 'Importar imagem') && !botao(det(), 'Gerar estação'), 'aprovada sem arquivo: só Importar');
hyperResp.ancora_importar = [200, { ok: true, id: 'b1', arquivo: ARQ_B, bytes: 1234 }];
respostas.admin_ancora_get = { ok: true, ancora: B_COM };
const prevB = previas;
botao(det(), 'Importar imagem').click();
await espera(120);
confere(hyperLog.length === 1 && hyperLog[0].action === 'ancora_importar' && hyperLog[0].id === 'b1' && Object.keys(hyperLog[0]).length === 2, 'importar manda só action e id');
confere(d.getElementById('an-msg').textContent.includes(ARQ_B), 'importar mostra o nome do arquivo');
confere([...det().querySelectorAll('img')].every((i) => i.getAttribute('src') === BASE + ARQ_B) && previas === prevB, 'linha recarregada: imagem vem do bucket, sem prévia');
confere(!!botao(det(), 'Gerar estação com esta imagem') && !!botao(det(), 'Retirar'), 'aprovada com arquivo: Gerar e Retirar');

// B2. importar recusado (409 e 429)
respostas.admin_ancora_list = [B_SEM];
w.filtrarAncoras('aprovada');
await espera(60);
await w.abrirAncora('b1');
await espera(60);
hyperResp.ancora_importar = [409, { error: 'estado_invalido', estado: 'aprovada', tem_arquivo: true }];
botao(det(), 'Importar imagem').click();
await espera(60);
const info = () => det().querySelector('.an-info');
confere(visivel(info()) && info().textContent.includes('estado: aprovada') && info().textContent.includes('já tem arquivo'), 'importar recusado (409) explica em português');
hyperResp.ancora_importar = [503, { error: 'fonte_limite_429', mensagem: 'Espere 2 minutos' }];
const nImp = hyperLog.length;
botao(det(), 'Importar imagem').click();
await espera(300);
confere(hyperLog.length === nImp + 1 && info().textContent.includes('Espere 2 minutos') && info().textContent.includes('Nada foi repetido'), 'importar com 429: mostra a mensagem e não repete');

// B3. gerar preenche e NÃO dispara
let disparos = 0;
w.runGenStation = async () => { disparos++; };
respostas.admin_ancora_list = [B_COM];
w.filtrarAncoras('aprovada');
await espera(60);
await w.abrirAncora('b1');
await espera(60);
respostas.admin_ancora_para_engine = { ok: true, ancora_id: 'b1', imageAnchor: ANC };
d.getElementById('gen-model').value = 'claude-sonnet-4-6';
d.getElementById('gen-instrucoes').value = 'sobra de outra geração';
botao(det(), 'Gerar estação com esta imagem').click();
await espera(60);
let aj = null; try { aj = JSON.parse(d.getElementById('gen-anchor-json').value); } catch (_) {}
confere(ultima('admin_ancora_para_engine')[1].p_id === 'b1', 'gerar chama admin_ancora_para_engine');
confere(aj && aj.image_file === ARQ_B && aj.image_credits.license === 'CC BY 4.0' && d.getElementById('gen-anchor-chk').checked, 'gen-anchor-json com o imageAnchor e gen-anchor-chk marcado');
confere(d.getElementById('gen-area').value === 'Clínica Médica' && d.getElementById('gen-tema').value === 'Pneumonia' && d.getElementById('gen-model').value === 'claude-opus-4-8' && d.getElementById('gen-instrucoes').value === '', 'área, tema e modelo padrão do assistente ancorado');
confere(d.getElementById('modal-gen').classList.contains('open') && d.getElementById('gen-step-1').style.display === 'block', 'modal de geração aberto no passo 1');
confere(disparos === 0, 'gerar NÃO dispara a geração');
confere(w.__anEmUso && w.__anEmUso.id === 'b1' && w.__anEmUso.image_file === ARQ_B, 'guarda a âncora em uso (id e image_file)');

// salvar: preenche o form como o fluxo real (fillFormFromAI) e chama saveStation
const ESTACAO = (imgs) => ({ name: 'Estação teste', area: 'Clínica Médica', caso: 'Caso clínico', pNome: 'Ator', __anchored: true, fonte: 'ia_curada',
  exams: [{ title: 'EXAME DE IMAGEM — RADIOGRAFIA', rows: ['Radiografia de tórax PA'], images: imgs, image_credits: [ANC.image_credits] }],
  checklist: [{ id: '1', item: 'Item', scores: [0, 10], crit_adeq: 'x' }] });
const salvos = [], apagados = [];
w.saveStationDB = async (obj) => { salvos.push(obj); return { id: 'st-' + salvos.length }; };
w.deleteStationDB = async (id) => { apagados.push(id); };
async function preencherESalvar(imgs) {
  w.closeModal('modal-gen');
  w.fillFormFromAI(ESTACAO(imgs));
  await espera(300);
  w.__lastSaveStationTs = 0;
  await w.saveStation();
  await espera(60);
}

// B4. salvar chama marcar_usada com o id salvo
respostas.admin_ancora_marcar_usada = { ok: true, estado: 'usada' };
alertas.length = 0;
await preencherESalvar([ARQ_B]);
const mu = ultima('admin_ancora_marcar_usada');
confere(salvos.length === 1, 'estação nova salva (saveStationDB chamado uma vez)' + (alertas.length ? ' — alertas: ' + alertas.join(' / ') : ''));
confere(mu && mu[1].p_id === 'b1' && mu[1].p_station_id === 'st-1', 'salvar chama admin_ancora_marcar_usada com o id da estação salva');
confere(alertas.some((a) => a.includes('Uso da âncora registrado')) && w.__anEmUso === null, 'sucesso avisa e limpa a âncora em uso');

// B5. falha do marcar_usada avisa e não apaga nada
respostas.admin_ancora_list = [B_COM];
w.filtrarAncoras('aprovada'); await espera(60);
await w.abrirAncora('b1'); await espera(60);
botao(det(), 'Gerar estação com esta imagem').click(); await espera(60);
respostas.admin_ancora_marcar_usada = { ok: false, erro: 'estacao_nao_pending', status: 'active' };
alertas.length = 0;
await preencherESalvar([ARQ_B]);
const msgFalha = alertas.find((a) => a.includes('mas o uso da âncora não foi registrado')) || '';
confere(msgFalha.includes('A estação foi salva (id st-2)') && msgFalha.includes('não está pending') && msgFalha.includes('Não gere outra estação com esta imagem antes de resolver'), 'falha do marcar_usada avisa com clareza');
confere(apagados.length === 0 && salvos.length === 2 && w.__anUsoPendente && w.__anUsoPendente.station_id === 'st-2', 'falha não apaga nada e guarda a pendência');
await w.abrirAncora('b1'); await espera(60);
confere(!!det().querySelector('.an-uso-pendente') && det().querySelector('.an-uso-pendente').textContent.includes('st-2'), 'linha mostra o uso pendente');
respostas.admin_ancora_marcar_usada = { ok: true, estado: 'usada' };
botao(det(), 'Registrar o uso de novo').click(); await espera(60);
confere(ultima('admin_ancora_marcar_usada')[1].p_station_id === 'st-2' && w.__anUsoPendente === null, 'registrar de novo usa o id salvo');

// B6. descartar não registra uso
respostas.admin_ancora_list = [B_COM];
w.filtrarAncoras('aprovada'); await espera(60);
await w.abrirAncora('b1'); await espera(60);
botao(det(), 'Gerar estação com esta imagem').click(); await espera(60);
w.descartarGeracao();
const nMu = n('admin_ancora_marcar_usada');
await preencherESalvar([ARQ_B]);
confere(w.__anEmUso === null && n('admin_ancora_marcar_usada') === nMu, 'descartar não registra uso');
botao(det(), 'Gerar estação com esta imagem').click(); await espera(60);
w.closeModal('modal-gen');
w.openGenModal();
confere(w.__anEmUso === null, 'iniciar outra geração limpa a âncora em uso');
botao(det(), 'Gerar estação com esta imagem').click(); await espera(60);
w.closeModal('modal-form');
confere(w.__anEmUso === null, 'fechar o formulário sem salvar limpa a âncora em uso');
botao(det(), 'Gerar estação com esta imagem').click(); await espera(60);
alertas.length = 0;
await preencherESalvar(['outra-imagem.webp']);
confere(n('admin_ancora_marcar_usada') === nMu && alertas.some((a) => a.includes('nenhum impresso cita')), 'impresso sem o arquivo da âncora não registra uso e avisa');

// B7. retirar
respostas.admin_ancora_list = [B_COM];
w.filtrarAncoras('aprovada'); await espera(60);
await w.abrirAncora('b1'); await espera(60);
const nRet = hyperLog.length;
botao(det(), 'Retirar').click(); await espera();
confere(hyperLog.length === nRet && visivel(erroDe('motivo_retirar')), 'retirar sem motivo não chama nada');
det().querySelector('textarea[data-campo="motivo_retirar"]').value = 'Imagem trocada';
hyperResp.ancora_retirar = [409, { error: 'arquivo_citado_em_estacoes', arquivo: ARQ_B, estacoes: [
  { id: 'st-9', status: 'pending', nome: 'Pneumonia <script>window.__xss3=1</script>' }, { id: 'st-10', status: 'active', nome: 'Outra "estação"' }] }];
botao(det(), 'Retirar').click(); await espera(60);
const lis = [...det().querySelectorAll('.an-citadas li')];
confere(hyperLog[hyperLog.length - 1].motivo === 'Imagem trocada', 'retirar manda o motivo');
confere(lis.length === 2 && lis[0].textContent.includes('<script>') && lis[0].textContent.includes('pending') && lis[1].textContent.includes('active') && !det().querySelector('.an-citadas script') && w.__xss3 === undefined, 'retirar recusado lista as estações como texto');
hyperResp.ancora_retirar = [502, { error: 'remocao_falhou', pendente: true }];
botao(det(), 'Retirar').click(); await espera(60);
confere(info().textContent.includes('pendente') && !!botao(det(), 'Repetir a retirada'), 'retirada pendente oferece repetir');
hyperResp.ancora_retirar = [200, { ok: true, id: 'b1', estado: 'rejeitada', arquivo_removido: true }];
botao(det(), 'Repetir a retirada').click(); await espera(60);
confere(!('motivo' in hyperLog[hyperLog.length - 1]) && d.getElementById('an-msg').textContent.includes('retirada'), 'repetir a retirada vai sem motivo e conclui');

// B8. rejeitada com arquivo_retirado: concluir retirada
respostas.admin_ancora_list = [Object.assign({}, B_SEM, { estado: 'rejeitada', motivo_rejeicao: 'Imagem trocada', arquivo_retirado: ARQ_B })];
w.filtrarAncoras('rejeitada'); await espera(60);
confere(!!d.querySelector('#an-list .an-selo-pendente'), 'lista mostra o selo retirada pendente');
await w.abrirAncora('b1'); await espera(60);
confere(!!det().querySelector('.an-selo-pendente') && !!botao(det(), 'Concluir retirada'), 'linha mostra o selo e Concluir retirada');
botao(det(), 'Concluir retirada').click(); await espera(60);
const ultRet = hyperLog[hyperLog.length - 1];
confere(ultRet.action === 'ancora_retirar' && !('motivo' in ultRet) && d.getElementById('an-msg').textContent.includes('retirada'), 'concluir retirada chama ancora_retirar sem motivo');

// B9. usada: liberar com e sem sucesso
respostas.admin_ancora_list = [Object.assign({}, B_COM, { estado: 'usada', station_id_usada: 'st-1' })];
w.filtrarAncoras('usada'); await espera(60);
await w.abrirAncora('b1'); await espera(60);
confere(det().textContent.includes('Ligada à estação') && det().textContent.includes('st-1') && !!botao(det(), 'Liberar'), 'usada mostra a estação ligada e Liberar');
respostas.admin_ancora_liberar = { ok: false, erro: 'estacao_ainda_vale', status: 'pending' };
botao(det(), 'Liberar').click(); await espera(60);
confere(det().querySelector('.an-geral').textContent.includes('ainda vale (status: pending)'), 'liberar recusado explica que a estação ainda vale');
respostas.admin_ancora_liberar = { ok: true, estado: 'aprovada', estacao: 'st-1' };
botao(det(), 'Liberar').click(); await espera(60);
confere(d.getElementById('an-msg').textContent.includes('liberada') && ultima('admin_ancora_liberar')[1].p_id === 'b1', 'liberar com sucesso');

confere(erros.length === 0, 'nenhuma exceção em runtime' + (erros.length ? ' — ' + erros.join(' | ') : ''));
console.log(`\n   ${ok} OK / ${falhas} FAIL`);
dom.window.close();
process.exit(falhas ? 1 : 0);
