// ci/lib/numeros-publicos.mjs — regra dos números públicos do site (portão 7).
// Sem rede, sem dependência externa. Usado por check-numeros-publicos.mjs (páginas
// reais) e por test-numeros-publicos.mjs (autoteste que reprova de propósito).
//
// Regra (decisão do Bruno, 16/11/2026):
// - Frase pública: "estações das provas oficiais do INEP". Proibido "banco completo"
//   e "todas as estações do INEP". Proibido "PEP oficial", e PEP que "segue as
//   provas oficiais" sem restringir a frase às estações das provas oficiais do INEP.
// - Vitrine (index.html, planos.html) usa piso: "mais de N", N = piso do JSON.
// - Número exato só no FAQ e no Quem somos, sempre com a data (mês e ano).
// - Preço mensal único em todas as páginas.

export const ANTIGOS = [74, 177, 251, 236, 161];
// "PEP oficial": o PEP das estações de curadoria não é oficial (Bruno, 17/11/2026).
export const FRASES_PROIBIDAS = ['banco completo', 'todas as estacoes do inep', 'pep oficial'];
export const VITRINE = ['index.html', 'planos.html'];
export const EXATO_COM_DATA = ['faq.html', 'quem-somos.html'];
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Sem acento, sem caixa, espaço colapsado. */
export function norm(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[ \s]+/g, ' ').trim();
}

/** Só letras e dígitos, para comparar texto independente de pontuação. */
export function tokens(s) {
  return norm(s).replace(/[^a-z0-9]+/g, ' ').trim();
}

function decodificar(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function semTags(s) {
  return decodificar(s.replace(/<[^>]*>/g, ' '));
}

function coletarStrings(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => coletarStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => coletarStrings(x, out));
  return out;
}

/**
 * Separa a página em: texto visível, texto de atributos (meta, alt, title...),
 * blocos JSON-LD (já com JSON.parse) e o HTML sem comentários.
 */
export function analisar(html) {
  const semComentario = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const jsonld = [];
  const reLd = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = reLd.exec(semComentario))) {
    try { jsonld.push({ ok: true, dado: JSON.parse(m[1]) }); }
    catch (e) { jsonld.push({ ok: false, erro: e.message, bruto: m[1] }); }
  }
  const corpo = semComentario
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const atributos = [];
  const reAttr = /\s(?:content|alt|title|aria-label|placeholder)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  while ((m = reAttr.exec(corpo))) atributos.push(decodificar(m[2] ?? m[3] ?? ''));
  const textoLd = jsonld.map(b => b.ok ? coletarStrings(b.dado, []).map(semTags).join(' ') : b.bruto).join(' ');
  return {
    semComentario,
    jsonld,
    visivel: semTags(corpo),
    publico: norm([semTags(corpo), atributos.join(' '), textoLd].join(' ')),
  };
}

// Números ligados a estações. `mais` = vem depois de "mais de" (piso).
// Tipos: 'estacoes' (N estações), 'inep' (N das provas oficiais), 'curadoria', 'total'.
const PADROES = [
  ['estacoes', /(mais de )?\b(\d{1,4})\s+estac(?:ao|oes)\b/g],
  ['inep', /(mais de )?\b(\d{1,4})\s+(?:estacoes\s+)?das provas\b/g],
  ['curadoria', /(mais de )?\b(\d{1,4})\s+(?:estacoes\s+)?(?:de|da|pela) curadoria\b/g],
  ['curadoria', /(mais de )?\b(\d{1,4})\s+(?:estacoes\s+)?(?:curadas|criadas)\b/g],
  ['total', /(mais de )?\b(\d{1,4})\s+(?:estacoes\s+)?no total\b/g],
];

export function numerosDeEstacoes(textoNorm) {
  const achados = [];
  const vistos = new Set(); // mesma posição casada por dois padrões conta uma vez
  for (const [tipo, re] of PADROES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(textoNorm))) {
      const pos = m.index + (m[1] ? m[1].length : 0);
      if (vistos.has(pos)) { re.lastIndex = pos + 1; continue; }
      vistos.add(pos);
      achados.push({ tipo, n: +m[2], mais: !!m[1], trecho: textoNorm.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30) });
      re.lastIndex = pos + 1; // permite sobreposição
    }
  }
  return achados;
}

export function dataPorExtenso(iso) {
  const [ano, mes] = iso.split('-').map(Number);
  return `${MESES[mes - 1]} de ${ano}`;
}

function faqDoJsonLd(dado, out = []) {
  if (Array.isArray(dado)) dado.forEach(d => faqDoJsonLd(d, out));
  else if (dado && typeof dado === 'object') {
    const tipo = [].concat(dado['@type'] || []);
    if (tipo.includes('Question')) out.push({ pergunta: dado.name || '', resposta: dado.acceptedAnswer?.text || '' });
    Object.values(dado).forEach(v => { if (v && typeof v === 'object') faqDoJsonLd(v, out); });
  }
  return out;
}

/**
 * paginas: [{ arquivo: 'index.html', html: '...' }]. cfg: o numeros-publicos.json.
 * Devolve lista de erros (strings). Vazia = aprovado.
 */
export function verificar(paginas, cfg) {
  const erros = [];
  const pisos = new Set([cfg.piso_total, cfg.piso_inep, cfg.piso_curadoria]);
  const exatoPorTipo = { inep: [cfg.exato.inep], curadoria: [cfg.exato.curadoria], total: [cfg.exato.ativas],
    estacoes: [cfg.exato.ativas, cfg.exato.inep, cfg.exato.curadoria] };
  const data = dataPorExtenso(cfg.data);

  for (const { arquivo, html } of paginas) {
    const nome = arquivo.replace(/\\/g, '/');
    const base = nome.split('/').pop();
    const ehVitrine = VITRINE.includes(nome);
    const ehExato = EXATO_COM_DATA.includes(nome);
    const a = analisar(html);
    const err = msg => erros.push(`${nome}: ${msg}`);

    // 1. frases proibidas
    for (const f of FRASES_PROIBIDAS) if (a.publico.includes(f)) err(`frase proibida "${f}"`);

    // 1b. PEP que "segue as provas" tem de dizer que é nas estações do INEP:
    // o PEP das estações de curadoria não é oficial (Bruno, 16/11/2026).
    for (const frase of a.publico.split(/[.!?;]/)) {
      if (/\bpep\b/.test(frase) && /\bseguem?\b/.test(frase) && /(provas oficiais|do inep|caderno)/.test(frase)
          && !frase.includes('estacoes das provas oficiais do inep')) {
        err(`PEP que segue as provas oficiais sem restringir às estações do INEP: "…${frase.trim().slice(0, 120)}…"`);
      }
    }

    // JSON-LD precisa ser JSON válido em qualquer página
    a.jsonld.filter(b => !b.ok).forEach(b => err(`JSON-LD inválido (${b.erro})`));

    const achados = numerosDeEstacoes(a.publico);
    let usouExato = false;
    for (const x of achados) {
      // 2. número antigo
      if (ANTIGOS.includes(x.n)) { err(`número antigo ${x.n} junto de estações: "…${x.trecho}…"`); continue; }
      if (x.mais) {
        // 3. piso
        if ((ehVitrine || ehExato) && !pisos.has(x.n)) err(`"mais de ${x.n}" não é piso do JSON (${[...pisos].join(', ')}): "…${x.trecho}…"`);
        continue;
      }
      if (x.n < 10) continue; // "3 estações grátis" etc.
      if (ehVitrine) err(`número exato ${x.n} na vitrine; use "mais de N": "…${x.trecho}…"`);
      else if (ehExato) {
        // 4. exato com data
        if (!exatoPorTipo[x.tipo].includes(x.n)) err(`número ${x.n} (${x.tipo}) diferente do JSON (${exatoPorTipo[x.tipo].join('/')}): "…${x.trecho}…"`);
        else usouExato = true;
      }
    }
    if (ehExato && usouExato && !a.publico.includes(data)) err(`número exato sem a data "${data}"`);

    // 3. contador da landing
    if (nome === 'index.html') {
      const m = /<div class="stat-n"([^>]*)>[^<]*<\/div>\s*<div class="stat-l">\s*Esta(?:ç|ç)ões no banco/.exec(a.semComentario.normalize('NFC'));
      if (!m) err('contador "Estações no banco" não encontrado');
      else {
        const dc = /data-count="(\d+)"/.exec(m[1]);
        const suf = /data-suffix="([^"]*)"/.exec(m[1]);
        if (!dc || +dc[1] !== cfg.piso_total) err(`data-count do contador = ${dc ? dc[1] : 'ausente'}, esperado ${cfg.piso_total}`);
        if (!suf || suf[1] !== '+') err('contador sem data-suffix="+" (piso tem de aparecer como "N+")');
      }
    }

    // 4. JSON-LD do FAQ bate com o texto visível
    if (base === 'faq.html') {
      const visivel = tokens(a.visivel);
      const qs = a.jsonld.filter(b => b.ok).flatMap(b => faqDoJsonLd(b.dado));
      if (!qs.length) err('FAQ sem perguntas no JSON-LD');
      for (const q of qs) {
        if (!visivel.includes(tokens(semTags(q.pergunta)))) err(`JSON-LD: pergunta não está no texto visível: "${q.pergunta}"`);
        if (!visivel.includes(tokens(semTags(q.resposta)))) err(`JSON-LD: resposta diverge do texto visível, na pergunta "${q.pergunta}"`);
      }
    }

    // 5. preço mensal
    const rePreco = /r\$\s*(\d+(?:[.,]\d{1,2})?)\s*(?:\/\s*mes|por mes)\b|mensal(?: no valor de| de)? r\$\s*(\d+(?:[.,]\d{1,2})?)/g;
    let p;
    while ((p = rePreco.exec(a.publico))) {
      const v = parseFloat((p[1] || p[2]).replace(',', '.'));
      if (v !== cfg.preco_mensal) err(`preço R$ ${p[1] || p[2]} diferente de R$ ${cfg.preco_mensal}/mês`);
    }
  }
  return [...new Set(erros)];
}
