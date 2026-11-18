// Teste do filtro de dificuldade do acervo (v1.6.179), em jsdom, com catalogo dublado.
// Motivo: o banco grava stations.complexity como simple/medium/advanced; ate a 1.6.178 o
// filtro procurava basic e "Basico" mostrava zero estacoes.
// Rodar a partir da raiz: node ci/test-filtro-dificuldade-1.6.179.mjs [arquivo]   (saida 1 = falhou)
// Contra a 1.6.178 os casos de "Basico" falham (reproduz o defeito).
//
// Perfis: pagante/admin (sem cadeado) e trial/trial esgotado (lista com cadeados): em cada um,
// Basico = so simple, Intermediario = so medium, Avancado = so advanced, Todas = todas;
// no trial, clicar numa trancada nunca chama loadStation.
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { scriptsInline } from './lib/html.mjs';

const ARQ = process.argv[2] || 'simulador/index.html';
let ok = 0, falhas = 0;
function confere(cond, nome, extra) {
  if (cond) { ok++; console.log('   ok    ' + nome); }
  else { falhas++; console.log('   FALHA ' + nome + (extra ? '  ::  ' + extra : '')); }
}

const CATALOGO = [
  { id: 'a1', area: 'Clínica Médica', name: 'Alfa simples', fonte: 'inep', edicao: '2025/2', complexity: 'simple', trial_available: true },
  { id: 'a2', area: 'Pediatria', name: 'Beta simples', fonte: 'ia_curada', complexity: 'simple', trial_available: false },
  { id: 'b1', area: 'Cirurgia Geral', name: 'Gama media', fonte: 'inep', edicao: '2025/1', complexity: 'medium', trial_available: false },
  { id: 'c1', area: 'Ginecologia e Obstetrícia', name: 'Delta avancada', fonte: 'ia_curada', complexity: 'advanced', trial_available: false },
  { id: 'c2', area: 'Clínica Médica', name: 'Epsilon avancada', fonte: 'inep', edicao: '2025/2', complexity: 'advanced', trial_available: true },
];

const GANCHO = `
;try{
  window.__F = { carregou: [], paywall: 0 };
  fetchStations = async function(){ return JSON.parse(JSON.stringify(window.__CATALOGO__)); };
  loadHistory = async function(){ return []; };
  loadStation = function(id){ window.__F.carregou.push(String(id)); };
  showAccessRequired = function(){ window.__F.paywall++; };
  window.__F.render = function(){ return renderStations(); };
  window.__F.selo = function(c){ return complexityBadge(c); };
}catch(e){ window.__GANCHO_ERRO__ = String(e && e.message || e); }
`;

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

function injetar(html) {
  const blocos = scriptsInline(html);
  const p = blocos.reduce((a, b) => (b.codigo.length > (a ? a.codigo.length : 0) ? b : a), null);
  const c = p.codigo;
  const fim = c.lastIndexOf('})()');
  const pos = fim >= 0 && fim > c.length - 400 ? fim : c.length;
  return html.slice(0, p.inicioCodigo) + c.slice(0, pos) + GANCHO + c.slice(pos) + html.slice(p.inicioCodigo + c.length);
}

function dublar(w) {
  const cli = new Proxy(function () {}, {
    get: (_, p) => {
      if (p === 'then') return undefined;
      if (p === 'auth') return {
        getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }),
        signInWithOAuth: async () => ({ data: {}, error: null }), signInWithPassword: async () => ({ data: {}, error: null }),
        setSession: async () => ({ data: {}, error: null }),
      };
      return () => cli;
    },
    apply: () => cli,
  });
  w.supabase = { createClient: () => cli };
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  w.gtag = () => {}; w.dataLayer = [];
  w.turnstile = { render: () => 'w-0', reset: () => {}, remove: () => {} };
  w.scrollTo = () => {};
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  w.AudioContext = w.webkitAudioContext = function () {
    return { createMediaElementSource: () => ({ connect() {} }), createGain: () => ({ connect() {}, gain: { value: 1, setValueAtTime() {} } }),
      destination: {}, state: 'running', resume: async () => {}, close: async () => {}, currentTime: 0 };
  };
  w.MediaRecorder = function () { return { start() {}, stop() {}, state: 'inactive', mimeType: 'audio/webm' }; };
  w.MediaRecorder.isTypeSupported = () => true;
  Object.defineProperty(w.navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [] }) }, configurable: true });
  w.HTMLMediaElement.prototype.play = async () => {};
  w.HTMLMediaElement.prototype.pause = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, closePath() {}, save() {}, restore() {},
    translate() {}, rotate() {}, scale() {}, fillText() {}, measureText: () => ({ width: 40 }), setLineDash() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  });
  w.localStorage.setItem('rv_ant', 'dublado-ci');
}

const erros = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => erros.push(e.message));
const dom = new JSDOM(injetar(prepararHTML(ARQ)), {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'https://simulador.revalidaosce.com.br/', virtualConsole: vc,
  beforeParse: (w) => { dublar(w); w.__CATALOGO__ = CATALOGO; },
});
await new Promise((r) => setTimeout(r, 400));
const w = dom.window;
console.log('\n── Teste · filtro de dificuldade 1.6.179 (' + ARQ + ') ' + '─'.repeat(6));
if (!w.__F) { console.log('   FALHA gancho não rodou: ' + (w.__GANCHO_ERRO__ || erros.join(' | '))); process.exit(1); }
const F = w.__F;
const $ = (id) => w.document.getElementById(id);
const ids = () => [...w.document.querySelectorAll('#station-list .scard')].map((c) => c.dataset.id).sort().join(',');

const sel = $('difficulty-filter');
const rotulo = (txt) => [...sel.options].find((o) => o.textContent.trim() === txt);
const ESPERADO = {
  'Básico': 'a1,a2',
  'Intermediário': 'b1',
  'Avançado': 'c1,c2',
  'Todas as dificuldades': 'a1,a2,b1,c1,c2',
};

for (const perfil of ['pagante', 'admin', 'trial', 'trial_exhausted']) {
  w.__accessMode = (perfil === 'trial' || perfil === 'trial_exhausted') ? perfil : 'full';
  const trial = perfil.indexOf('trial') === 0;
  for (const [txt, esperado] of Object.entries(ESPERADO)) {
    const op = rotulo(txt);
    if (!op) { confere(false, perfil + ' opção ' + txt + ' existe'); continue; }
    sel.value = op.value;
    await F.render();
    confere(ids() === esperado, perfil + ' ' + txt + ' → ' + esperado, ids() || '(nenhuma)');
    const trancadas = w.document.querySelectorAll('#station-list .scard[data-locked="1"]').length;
    const esperadoTrancadas = trial ? CATALOGO.filter((s) => esperado.split(',').includes(s.id) && !s.trial_available).length : 0;
    confere(trancadas === esperadoTrancadas, perfil + ' ' + txt + ' cadeados = ' + esperadoTrancadas, String(trancadas));
  }
  // clique em todas as cartas visíveis com "Todas": trancada nunca chama loadStation
  sel.value = '';
  await F.render();
  F.carregou.length = 0; F.paywall = 0;
  w.document.querySelectorAll('#station-list .scard').forEach((c) => c.dispatchEvent(new w.MouseEvent('click', { bubbles: true })));
  const abertas = trial ? CATALOGO.filter((s) => s.trial_available).map((s) => s.id) : CATALOGO.map((s) => s.id);
  confere(F.carregou.slice().sort().join(',') === abertas.sort().join(','), perfil + ' loadStation só nas liberadas', F.carregou.join(','));
  confere(F.paywall === (trial ? CATALOGO.length - abertas.length : 0), perfil + ' paywall nas trancadas', String(F.paywall));
}

confere(/Básico/.test(F.selo('simple')), 'complexityBadge(simple) = Básico', F.selo('simple'));
confere(/Básico/.test(F.selo('basic')), 'complexityBadge(basic) segue como apelido');
confere(/Intermediário/.test(F.selo('medium')) && /Avançado/.test(F.selo('advanced')), 'complexityBadge medium/advanced inalterados');

if (erros.length) console.log('   (avisos do jsdom: ' + erros.length + ')');
console.log('\n   ' + ok + ' ok, ' + falhas + ' falha(s)');
process.exit(falhas ? 1 : 0);
