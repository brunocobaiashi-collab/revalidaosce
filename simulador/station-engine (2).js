/* ════════════════════════════════════════════════════════════════════════════
   station-engine.js — Núcleo unificado de geração de estações OSCE (RevalidaOSCE)
   Fonte ÚNICA de verdade para admin.html e index.html (Maratona).

   Wrappers injetam: aiCall, fewShotExamples, onProgress, pepPolicy, destino.
   O núcleo NÃO conhece DOM, Supabase, sessão ou UI — tudo entra por parâmetro.

   API:
     StationEngine.generate({
       area, tema, nivel, extra,        // entrada do caso
       fewShotExamples,                 // string já montada pelo wrapper (few-shot INEP)
       aiCall,                          // async (payload) => Response  (edge proxy)
       pepPolicy,                       // 'normalize' (Maratona) | 'reject' (Admin)
       modelGen,  modelAudit,           // default: claude-opus-4-8
       onProgress                       // (stepIndex:int) => void   (UI fica no wrapper)
     }) => { station, audit }           // wrapper decide: preview ou autosave
   ════════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var NL = '\n';

  // ─────────────────────────────────────────────────────────────────────────
  // PROMPTS CANÔNICOS
  // ─────────────────────────────────────────────────────────────────────────

  // sys1 — geração do caso. Base: Simulador (v2). Reenxertado: Regras de Ouro
  // #3 e #4 do Admin (impressos/se_perguntado_sobre_exame_fisico SEM gabarito).
  function buildSys1(area, nivel, fewShotExamples) {
    return [
      'Voce e especialista em criar estacoes OSCE no padrao INEP/Revalida brasileiro.',
      'Gere UMA estacao seguindo o padrao dos exemplos. Responda SOMENTE JSON valido (sem markdown).',
      'IMPORTANTE: seja CONCISO. Cada string do JSON deve ser curta (max 2-3 frases). Cada array com max 5 itens. NAO escreva textos longos.',
      '',
      '═══ REGRAS CRITICAS ═══',
      '',
      '1) ANTI-VAZAMENTO NO BRIEFING (CRITICO — sera auditado por outra IA):',
      '',
      '   ╔═══ orientMed: USE EXATAMENTE ESTE TEMPLATE FIXO ═══╗',
      '   "(1) realize a anamnese; (2) realize o exame fisico pertinente; (3) solicite exames complementares se necessario; (4) elabore hipotese diagnostica; (5) defina a conduta; (6) oriente o paciente/acompanhante."',
      '   ╚═══════════════════════════════════════════════════╝',
      '   NUNCA modifique esse template. NUNCA adicione termos especificos do caso.',
      '   ❌ "identificar sinais de alarme para dengue" — PROIBIDO (cita doenca)',
      '   ❌ "investigar tromboembolismo pulmonar" — PROIBIDO (cita doenca)',
      '   ❌ "solicitar D-dimero e angio-TC" — PROIBIDO (cita exame especifico)',
      '   ❌ "investigar sangramento" — PROIBIDO (cita queixa principal)',
      '',
      '   ╔═══ "name": APENAS sintomas COMUNS, NUNCA sinais especificos ═══╗',
      '   TESTE MENTAL antes de escrever o name:',
      '   "Lendo apenas este nome, posso pensar em pelo menos 3 diagnosticos diferentes?"',
      '   Se a resposta for NAO → o nome esta MUITO especifico → reescreva.',
      '',
      '   ✅ BONS NAMES (apontam para varios diagnosticos):',
      '   • "Dor abdominal aguda em adulto jovem"  (apendicite, colica, ITU, etc)',
      '   • "Cefaleia em mulher adulta"            (enxaqueca, AVC, sinusite, etc)',
      '   • "Febre e exantema em lactente"         (dengue, sarampo, escarlatina, etc)',
      '   • "Dispneia em paciente idoso"           (DPOC, ICC, TEP, pneumonia, etc)',
      '   • "Fadiga em mulher adulta"              (anemia, hipotireoidismo, depressao)',
      '',
      '   ❌ NAMES COM VAZAMENTO (apontam para um unico diagnostico):',
      '   • "Apendicite aguda"                     ← e o diagnostico literal',
      '   • "Dengue com sinais de alarme"          ← e o diagnostico literal',
      '   • "Febre e petequias em lactente"        ← petequias = patognomonico de dengue',
      '   • "Cefaleia subita em trovoada"          ← descreve HSA especificamente',
      '   • "Tosse com hemoptise"                  ← hemoptise direciona p/ TB/cancer',
      '',
      '   REGRA DE OURO: se um colega medico, lendo APENAS o "name", consegue cravar',
      '   o diagnostico provavel — entao o nome esta vazando. Reescreva mais geral.',
      '',
      '   ╔═══ "caso": 1-2 frases simples — MEDICO GENERALISTA ═══╗',
      '   FORMATO: "Voce e medico em [local]. Atendera [descricao do paciente] com queixa de [queixa GERAL]."',
      '   • Use a queixa GERAL (dor, febre, cansaco), NUNCA a queixa especifica detalhada',
      '   • NUNCA cite no caso: diagnostico, exames, condutas, sinais especificos',
      '   • NUNCA escreva especialidade no caso: o Revalida simula MEDICO GENERALISTA',
      '   ✅ "Voce e medico em UBS. Atendera mulher de 35 anos com queixa de dor abdominal."',
      '   ✅ "Voce e medico no pronto-socorro. Atendera homem de 60 anos com dor toracica."',
      '   ❌ "Voce e ginecologista em ambulatorio de referencia..." (NUNCA — generalista)',
      '   ❌ "...com queixa de dor em fossa iliaca direita ha 24h e febre." (queixa especifica)',
      '',
      '   Locais validos (variar entre estacoes):',
      '   • UBS / Unidade Basica de Saude / ESF',
      '   • Pronto-Socorro / PA / UPA / Emergencia',
      '   • Ambulatorio (geral, NAO de especialidade)',
      '   • Enfermaria de clinica geral',
      '   • Maternidade / Centro Obstetrico (so para Gineco/Obst)',
      '',
      '   O medico examinando deve CONDUZIR ate o limite do generalista e ENCAMINHAR',
      '   para especialista quando a conduta passar do escopo. Encaminhamento no orientMed',
      '   ou checklist e CORRETO. So nao escrever especialidade no proprio "caso".',
      '',
      '   ╔═══ "fala_inicial_espontanea": deve refletir o tom_emocional ═══╗',
      '   • Se o tom_emocional e "preocupada", a fala precisa transmitir preocupacao',
      '   ✅ tom="preocupada" + fala="Doutor, eu queria uma avaliacao, to meio aflita"',
      '   ❌ tom="preocupada" + fala="Vim de rotina" (CONTRADICAO!)',
      '',
      '   ╔═══ AUTO-CHECK ANTES DE RESPONDER ═══╗',
      '   Antes de retornar o JSON, responda mentalmente estas 5 perguntas:',
      '   1. O "name" aponta para 1 diagnostico ou para varios? (correto: VARIOS)',
      '   2. O "orientMed" usa exatamente o template padrao? (correto: SIM)',
      '   3. O "caso" cita queixa GERAL ou especifica? (correto: GERAL)',
      '   4. A "fala_inicial_espontanea" e coerente com o "tom_emocional"? (correto: SIM)',
      '   5. O "name" contem sinal/sintoma patognomonico? (correto: NAO — exclua petequias,',
      '      hemoptise, ictericia, papiledema, sopro especifico, etc).',
      '   Se qualquer resposta nao for a esperada, REESCREVA antes de retornar.',
      '',
      '2) PACIENTE NAO ANTECIPA (CRITICO):',
      '   • "fala_inicial_espontanea": 1 frase ULTRA curta — apenas a queixa central.',
      '     ✅ "Doutor, to com uma dor muito forte nas costas."',
      '     ❌ "Doutor, to com dor nas costas ha 24h, com febre e urina com sangue."',
      '   • SEM tempo detalhado, sintomas associados, antecedentes, contexto.',
      '   • "nao_falar_espontaneamente": ARRAY com 4-7 itens (sintomas associados, tempo',
      '     exato, antecedentes, habitos, contexto domiciliar).',
      '',
      '3) orientAtor (OBJETO JSONB):',
      '   • regra_fundamental: 2-3 frases (paciente real, nao antecipa).',
      '   • fala_inicial_espontanea: ver regra 2.',
      '   • tom_emocional: ex "ansiosa, preocupada".',
      '   • se_perguntado_sobre: 12-15 chaves em snake_case, respostas em 1a pessoa CURTAS.',
      '     Cobrir: queixa, tempo_inicio, sintomas_associados, antecedentes_pessoais,',
      '     medicacoes, habitos (fumo/alcool), e topicos especificos do caso.',
      '   • nao_falar_espontaneamente: ver regra 2.',
      '   • se_perguntado_sobre_exame_fisico: ver regra 5 (instrucao operacional, SEM achado).',
      '',
      '4) PEDIATRIA/ACOMPANHANTE (paciente <12a OU acompanhante fala):',
      '   • informante_tipo = "acompanhante"',
      '   • acompNome, acompRelacao ("Mae"/"Pai"/etc), acompGenero ("Feminino"/"Masculino")',
      '   • regra_fundamental: "Voce e a [relacao] de [paciente]."',
      '   • Caso contrario: informante_tipo = "paciente".',
      '',
      '5) IMPRESSOS NAO ENTREGAM GABARITO (CRITICO — a habilidade avaliada e o candidato INTERPRETAR):',
      '',
      '   a) Campo "se_perguntado_sobre_exame_fisico" (em orientAtor): escreva APENAS a',
      '      instrucao operacional de QUANDO/QUAL impresso entregar. NUNCA o achado entre parenteses.',
      '      ❌ "(sopro mitral)" / "(220x140 mmHg)" / "(VDRL 1:64 positivo)" / "(FEBRIL)" / "(lesoes vesiculares)"',
      '      ✅ "Caso solicite exame fisico, entregue o IMPRESSO 1 — EXAME FISICO."',
      '      ✅ "Caso solicite laboratorio (hemograma, sodio, ureia), entregue o IMPRESSO 2."',
      '',
      '   b) Os "rows" de cada impresso (tabela exams) contem APENAS DADOS BRUTOS para o',
      '      candidato LER e INTERPRETAR. NUNCA gabarito, diagnostico ou interpretacao.',
      '      ❌ "Padrao tipico de herpes zoster" / "Caracteristico de pneumonia" / "Diagnostico: ..."',
      '      ❌ "Achados a serem descritos pelo participante:" / "Achados esperados: ..."',
      '      ❌ "(FEBRIL)" / "(ALTERADO)" / "(POSITIVO)" / "(BAIXA)" como interpretacao apos o valor',
      '      ✅ Exame fisico: "Temperatura axilar: 38°C" (NAO "(FEBRIL)"); "PA: 125/72 mmHg"',
      '      ✅ Laboratorio: "Hemoglobina: 8,2 g/dL", "VCM: 110 fL" (sem marcar "(BAIXA)")',
      '      ✅ Imagem: legenda neutra ("Imagem da lesao na regiao X") + "Descreva os achados observados."',
      '',
      '      PRINCIPIO: se voce ja entrega a interpretacao no impresso, o candidato nao precisa',
      '      interpretar — e justamente a habilidade avaliada. Mantenha os rows como exame BRUTO.',
      '',
      '6) VALIDACOES TECNICAS:',
      '   • complexity: "medium" ou "advanced" (NUNCA simple/easy/intermediate).',
      '   • Cada exam: title claro, trigger_keywords array com 4-8 strings de 3+ chars',
      '     (NUNCA "rx"/"tc"/"us"/"pa" — use "raio x"/"tomografia"/"ultrassom"/"pressao arterial").',
      '   • Cada exam: rows com texto descritivo BRUTO (ver regra 5), images: [].',
      '',
      '═══ EXEMPLOS OFICIAIS INEP ═══',
      fewShotExamples || '(Sem exemplos disponiveis. Siga o padrao INEP geral.)',
      '',
      '═══ FORMATO DA SAIDA ═══',
      '{"name":"","area":"","nivel":"","local":"","infra":"","caso":"","orientMed":"","complexity":"medium","pNome":"","pIdade":0,"pGenero":"","pProf":"","pCivil":"","pQueixa":"","informante_tipo":"paciente","acompNome":"","acompRelacao":"","acompGenero":"","orientAtor":{"regra_fundamental":"","fala_inicial_espontanea":"","tom_emocional":"","se_perguntado_sobre":{},"nao_falar_espontaneamente":[],"se_perguntado_sobre_exame_fisico":""},"exams":[{"title":"","trigger_keywords":[],"rows":[],"images":[]}]}',
      '',
      'Area: ' + (area || '') + ' | Nivel: ' + (nivel || '')
    ].join(NL);
  }

  // sys2 — PEP. Canônico: Simulador (superset, com distribuição sugerida).
  function buildSys2() {
    return [
      'Voce e especialista em criar PEP (Padrao Esperado de Procedimentos) no formato INEP/Revalida.',
      'Responda SOMENTE JSON valido sem markdown.',
      '',
      'Gere o PEP estruturado em ARRAY de itens.',
      '⚠️ REGRA CRITICA — TOTAL DEVE SOMAR EXATAMENTE 10.0 PONTOS:',
      'A soma do MAIOR score de cada item (ultimo numero do array "scores") DEVE somar PRECISAMENTE 10.0.',
      'NUNCA gere 8, 9, 11 ou 12 pontos. SEMPRE 10.0 EXATOS.',
      'Use granularidade de 0.25 ou 0.5 para os scores (ex: 0.25, 0.5, 0.75, 1.0, 1.5, 2.0).',
      'Antes de responder, SOME mentalmente os pontos maximos de todos os itens — deve dar 10.0.',
      '',
      '8-12 itens cobrindo: Apresentacao, Anamnese, Exame Fisico, Exames Complementares, Hipotese Diagnostica, Conduta, Orientacao.',
      'Sugestao de distribuicao para somar 10:',
      '  - Apresentacao: 0.25-0.5',
      '  - Anamnese (1-3 itens): 1.5-3.0 total',
      '  - Exame Fisico: 1.0-2.0',
      '  - Exames Complementares: 1.5-2.5',
      '  - Hipotese Diagnostica: 1.5-2.5',
      '  - Conduta: 1.0-2.0',
      '  - Orientacao: 0.5-1.0',
      '',
      'FORMATO DE CADA ITEM:',
      '{"id":"1","text":"Titulo curto","subitens":"(1) acao\\n(2) acao","scores":[0,0.5,1.0],"labels":["Inadequado","Parcialmente adequado","Adequado"],"crit_adeq":"...","crit_parc":"... (omitir se 2 niveis)","crit_inad":"..."}',
      '',
      'Use 3 niveis quando o item tem multiplos subitens. Use 2 niveis quando e binario (ex: "Solicita radiografia").',
      'Total das pontuacoes maximas (ultimo score de cada) deve = 10.0',
      '',
      '═══ EXEMPLO DO INEP 2025/1 ═══',
      '[',
      '  {"id":"1","text":"Apresentação","subitens":"(1) identifica-se\\n(2) cumprimenta o paciente","scores":[0,0.25,0.5],"labels":["Inadequado","Parcialmente adequado","Adequado"],"crit_adeq":"realiza as duas ações","crit_parc":"realiza apenas uma","crit_inad":"não realiza nenhuma"},',
      '  {"id":"6","text":"Solicita radiografia","scores":[0,2.0],"labels":["Inadequado","Adequado"],"crit_adeq":"solicita radiografia","crit_inad":"não solicita"}',
      ']'
    ].join(NL);
  }

  // sysAudit — auditor IA. Canônico: Simulador (anti-falso-positivo, anti-over-rigor).
  function buildSysAudit() {
    return [
      'Voce e auditor clinico do INEP/Revalida que valida estacoes OSCE.',
      'Sua tarefa: analisar a estacao e identificar APENAS problemas REAIS e CLAROS.',
      'NAO invente problemas. NAO seja over-rigoroso. Reporte so o que e DEFEITO OBJETIVO.',
      '',
      'IMPORTANTE — O payload e um RESUMO (otimizado p/ tokens). O orientAtor completo NAO',
      'esta presente; voce ve "orientAtor_resumo" com metadados ja validados (fala_inicial_chars,',
      'se_perguntado_sobre_chaves, nao_falar_count, regra_fundamental_presente).',
      '⚠️ NAO reclame que orientAtor "esta incompleto" ou que "checklist esta truncado" — e RESUMO.',
      'Use os metadados: se_perguntado_sobre_chaves>=12 → OK; regra_fundamental_presente=true → OK.',
      '',
      '🔴 HIGH (causa FAIL — bloqueia a estacao):',
      '  - VAZAMENTO: "name" cita diagnostico (ex: "Apendicite", "Dengue", "AVC").',
      '  - VAZAMENTO: "caso" cita diagnostico, hipoteses ou exames especificos.',
      '  - VAZAMENTO: "orientMed" cita nome de doenca ou exame especifico do gabarito.',
      '  - VAZAMENTO: impresso/rows entregam interpretacao ("padrao tipico de...", "(FEBRIL)", "Diagnostico:...").',
      '  - INCOERENCIA CLINICA GRAVE: conduta inadequada/perigosa para o quadro.',
      '  - ESTRUTURA QUEBRADA: orientAtor sem regra_fundamental ou se_perguntado_sobre vazio.',
      '  - ESPECIALISTA NO CASO: "caso" diz "Voce e ginecologista/cardiologista/etc".',
      '    Revalida simula GENERALISTA — caso so pode dizer "Voce e medico em UBS/PA/Ambulatorio/PS".',
      '    (Encaminhar para especialista no orientMed/checklist e CORRETO — so nao no "caso".)',
      '',
      '🟡 MEDIUM (WARN com 2+):',
      '  - fala_inicial_chars > 100 (revela sintomas extras).',
      '  - se_perguntado_sobre_chaves < 12.  - nao_falar_count < 4.  - regra_fundamental_presente=false.',
      '  - PEP nao cobre fases essenciais.  - Pequena incoerencia clinica.',
      '',
      '🟢 LOW (NAO REPORTAR — esteticos ou artefatos do resumo):',
      '  - Sugestoes de redacao/estilo. "Poderia ser mais natural/especifico" — IGNORAR.',
      '  - "orientAtor incompleto" / "checklist truncado" / "estrutura nao validavel" — IGNORAR (e resumo!).',
      '',
      'REGRAS: 1) Issue cosmetica/subjetiva → NAO reporte. 2) Duvida HIGH vs MEDIUM → MEDIUM.',
      '3) Duvida MEDIUM vs nao reportar → NAO reportar. 4) Vazamento e SEMPRE high (nao invente onde nao ha).',
      '',
      'CLASSIFICACAO: "OK"=sem HIGH e ate 1 MEDIUM; "WARN"=sem HIGH mas 2+ MEDIUM; "FAIL"=1+ HIGH.',
      '',
      '⚠️ FORMATO — REGRA ABSOLUTA: responda EXCLUSIVAMENTE um JSON valido, comecando com { e',
      'terminando com }. NADA antes nem depois. Sem markdown, sem explicacao. O parser e estrito.',
      '{"status":"OK"|"WARN"|"FAIL","score":0-10,"issues":[{"severity":"high"|"medium","category":"vazamento"|"coerencia"|"estrutura"|"pep","message":"..."}]}'
    ].join(NL);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UTIL: extrair texto da Response do proxy (formato Anthropic ou OpenAI-like)
  // ─────────────────────────────────────────────────────────────────────────
  function extractText(data) {
    if (!data) return '';
    if (data.content && data.content[0]) return data.content[0].text || '';
    if (data.choices && data.choices[0] && data.choices[0].message) return data.choices[0].message.content || '';
    return '';
  }

  function stripFences(t) {
    return (t || '').replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  }

  // Parser tolerante: tenta direto; senão extrai 1o objeto/array balanceado; senão repara truncamento.
  function parseLoose(t) {
    t = stripFences(t);
    try { return JSON.parse(t); } catch (_) {}
    // extrair { ... } ou [ ... ] balanceado a partir do 1o delimitador
    var open = t.search(/[\[{]/);
    if (open >= 0) {
      var openCh = t[open], closeCh = openCh === '{' ? '}' : ']';
      var depth = 0, inStr = false, esc = false, end = -1;
      for (var p = open; p < t.length; p++) {
        var ch = t[p];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === openCh) depth++;
        else if (ch === closeCh) { depth--; if (depth === 0) { end = p; break; } }
      }
      if (end > open) { try { return JSON.parse(t.substring(open, end + 1)); } catch (_) {} }
    }
    // reparo de truncamento: fecha chaves/colchetes pendentes
    var rep = t.replace(/,\s*\{[^{}]*$/, '').replace(/,\s*"[^"]*$/, '');
    var ob = (rep.match(/\{/g) || []).length - (rep.match(/\}/g) || []).length;
    var ab = (rep.match(/\[/g) || []).length - (rep.match(/\]/g) || []).length;
    for (var x = 0; x < ab; x++) rep += ']';
    for (var y = 0; y < ob; y++) rep += '}';
    return JSON.parse(rep); // pode lançar — caller trata
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PEP: soma máximos. processPEP aplica política 'normalize' ou 'reject'.
  // ─────────────────────────────────────────────────────────────────────────
  // Extrai o array de itens do PEP, tolerante a como o modelo embrulhou a resposta
  function extractChecklistArray(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      var keys = ['checklist', 'pep', 'PEP', 'items', 'itens', 'criterios', 'criterios_pep', 'pep_items'];
      for (var i = 0; i < keys.length; i++) if (Array.isArray(raw[keys[i]])) return raw[keys[i]];
      for (var k in raw) if (Array.isArray(raw[k])) return raw[k]; // fallback: 1o array
    }
    return [];
  }

  // Normaliza cada item do PEP: garante 'text' (de varias chaves possiveis) e 'scores'.
  // Filtra itens sem texto ou sem pontuacao (que sumiriam silenciosamente no save).
  function normalizeChecklistItems(arr) {
    return (arr || []).map(function (it, i) {
      if (!it || typeof it !== 'object') return null;
      var text = it.text || it.titulo || it['t\u00edtulo'] || it.descricao || it['descri\u00e7\u00e3o']
               || it.criterio || it['crit\u00e9rio'] || it.item || it.nome || it.name || '';
      var scores = Array.isArray(it.scores) ? it.scores.map(function (x) { return Number(x) || 0; })
                 : (Array.isArray(it.pontuacoes) ? it.pontuacoes.map(function (x) { return Number(x) || 0; }) : []);
      var labels = Array.isArray(it.labels) ? it.labels
                 : (scores.length === 3 ? ['Inadequado', 'Parcialmente adequado', 'Adequado'] : ['Inadequado', 'Adequado']);
      return {
        id: String(it.id || (i + 1)),
        text: String(text).trim(),
        subitens: it.subitens || it.sub || '',
        scores: scores, labels: labels,
        crit_adeq: it.crit_adeq || '', crit_parc: it.crit_parc || '', crit_inad: it.crit_inad || ''
      };
    }).filter(function (it) { return it && it.text && it.scores && it.scores.length >= 2; });
  }

  function pepTotal(clArr) {
    if (!Array.isArray(clArr)) return 0;
    return clArr.reduce(function (s, item) {
      if (item && Array.isArray(item.scores) && item.scores.length) {
        return s + Math.max.apply(null, item.scores.map(function (x) { return Number(x) || 0; }));
      }
      return s;
    }, 0);
  }

  // policy 'normalize' (Maratona): ajusta scores para somar 10 e devolve o array.
  // policy 'reject'  (Admin):     NAO altera; devolve {ok, total} para o auditor reprovar.
  function processPEP(clArr, policy) {
    var total = Math.round(pepTotal(clArr) * 100) / 100;
    if (policy === 'reject') {
      return { checklist: clArr, ok: Math.abs(total - 10) <= 0.01, total: total };
    }
    // normalize
    if (Array.isArray(clArr) && clArr.length && total > 0 && Math.abs(total - 10) > 0.01) {
      var fator = 10 / total;
      clArr = clArr.map(function (item) {
        if (item && Array.isArray(item.scores)) {
          item.scores = item.scores.map(function (x) { return Math.round((Number(x) || 0) * fator * 4) / 4; });
        }
        return item;
      });
      var t2 = Math.round(pepTotal(clArr) * 100) / 100;
      if (Math.abs(t2 - 10) > 0.01 && clArr.length) {
        var ult = clArr[clArr.length - 1];
        if (ult && Array.isArray(ult.scores) && ult.scores.length) {
          var maxIdx = ult.scores.length - 1;
          ult.scores[maxIdx] = Math.round((Number(ult.scores[maxIdx]) + (10 - t2)) * 100) / 100;
          if (ult.scores.length === 3) ult.scores[1] = Math.round((ult.scores[maxIdx] / 2) * 100) / 100;
        }
      }
    }
    return { checklist: clArr, ok: true, total: Math.round(pepTotal(clArr) * 100) / 100 };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AUDITOR — pré-validação determinística (fail-closed) + auditor IA (fail-closed)
  // ─────────────────────────────────────────────────────────────────────────
  var DIAGNOSTICOS = ['apendicite','colecistite','pancreatite','diverticulite','pneumonia','tuberculose','asma','dpoc','dengue','zika','chikungunya','covid','sarampo','rubeola','caxumba','avc','iam','infarto','tep','tvp','hipertireoidismo','hipotireoidismo','lupus','cancer','neoplasia','meningite','sepse','cetoacidose','aborto','eclampsia','pre-eclampsia'];
  var ESPECIALIDADES = ['ginecologista','obstetra','cardiologista','pediatra','pneumologista','gastroenterologista','endocrinologista','neurologista','psiquiatra','urologista','nefrologista','oncologista','hematologista','reumatologista','dermatologista','ortopedista','oftalmologista','otorrinolaringologista','cirurgiao','cirurgião','infectologista','mastologista'];

  function preValidate(stObj, pepResult) {
    var issues = [];
    // checklist vazio = estacao inutilizavel no simulador -> reprova SEMPRE (qualquer policy)
    var clCheck = Array.isArray(stObj.checklist) ? stObj.checklist : [];
    if (clCheck.length === 0) {
      issues.push({ severity: 'high', category: 'pep_vazio', message: 'Estacao sem checklist valido (PEP vazio ou nao reconhecido).' });
    }
    var nameLow = (stObj.name || '').toLowerCase();
    var orientLow = (stObj.orientMed || '').toLowerCase();
    var casoLow = (stObj.caso || '').toLowerCase();
    DIAGNOSTICOS.forEach(function (d) {
      if (nameLow.indexOf(d) >= 0) issues.push({ severity: 'high', category: 'vazamento', message: 'name cita diagnostico: ' + d });
      if (orientLow.indexOf(d) >= 0) issues.push({ severity: 'high', category: 'vazamento', message: 'orientMed cita diagnostico: ' + d });
    });
    ESPECIALIDADES.forEach(function (esp) {
      if (new RegExp('\\b' + esp + '\\b', 'i').test(casoLow))
        issues.push({ severity: 'high', category: 'especialista_no_caso', message: 'caso menciona especialidade "' + esp + '" — Revalida simula generalista' });
    });
    // PEP determinístico (fail-closed quando policy='reject')
    if (pepResult && pepResult.ok === false) {
      issues.push({ severity: 'high', category: 'pep_soma_invalida', message: 'PEP soma ' + pepResult.total + ' (deve ser exatamente 10,0 pontos).' });
    }
    return issues;
  }

  function auditPayload(stObj) {
    var oa = stObj.orientAtor || {};
    var spsKeys = oa.se_perguntado_sobre ? Object.keys(oa.se_perguntado_sobre) : [];
    return {
      name: stObj.name, area: stObj.area, complexity: stObj.complexity,
      local: stObj.local, caso: stObj.caso, orientMed: stObj.orientMed,
      pIdade: stObj.pIdade, pGenero: stObj.pGenero, pQueixa: stObj.pQueixa,
      orientAtor_resumo: {
        tom_emocional: oa.tom_emocional || '',
        fala_inicial_espontanea: oa.fala_inicial_espontanea || '',
        fala_inicial_chars: (oa.fala_inicial_espontanea || '').length,
        se_perguntado_sobre_chaves: spsKeys.length,
        se_perguntado_sobre_keys_sample: spsKeys.slice(0, 8),
        nao_falar_count: (oa.nao_falar_espontaneamente || []).length,
        regra_fundamental_presente: !!(oa.regra_fundamental && oa.regra_fundamental.length > 20)
      },
      exams_titles: (stObj.exams || []).map(function (e) { return e.title; }),
      checklist_resumo: (function () {
        var raw = (typeof stObj.checklist === 'string') ? stObj.checklist : JSON.stringify(stObj.checklist);
        return raw.length <= 3000 ? raw : raw.substring(0, 3000) + '...[truncado]';
      })()
    };
  }

  // Retorna { passed, status, score, issues }. Fail-closed em qualquer erro do auditor.
  async function audit(stObj, aiCall, modelAudit, pepResult) {
    var local = preValidate(stObj, pepResult);
    if (local.length > 0) return { passed: false, status: 'FAIL', score: 0, issues: local };
    try {
      var r = await aiCall({ model: modelAudit, max_tokens: 1500, system: buildSysAudit(),
        messages: [{ role: 'user', content: 'Audite esta estacao OSCE:\n' + JSON.stringify(auditPayload(stObj), null, 2) }] });
      if (!r.ok) return { passed: false, status: 'AUDIT_ERROR', score: 0,
        issues: [{ severity: 'high', category: 'auditor_indisponivel', message: 'Auditor nao respondeu (HTTP ' + r.status + ').' }] };
      var parsed;
      try { parsed = parseLoose(extractText(await r.json())); }
      catch (_) {
        return { passed: false, status: 'AUDIT_ERROR', score: 0,
          issues: [{ severity: 'high', category: 'auditor_resposta_invalida', message: 'Auditor retornou resposta ilegivel.' }] };
      }
      if (!parsed || !parsed.status) return { passed: false, status: 'AUDIT_ERROR', score: 0,
        issues: [{ severity: 'high', category: 'auditor_resposta_invalida', message: 'Auditor sem campo status.' }] };
      return { passed: parsed.status === 'OK', status: parsed.status, score: parsed.score || 0, issues: parsed.issues || [] };
    } catch (e) {
      return { passed: false, status: 'AUDIT_ERROR', score: 0,
        issues: [{ severity: 'high', category: 'auditor_excecao', message: 'Erro na auditoria: ' + (e && e.message ? e.message : e) }] };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NÚCLEO: gera (Call 1 + Call 2) → processa PEP → audita. Sem retry/persistência
  // (isso fica no wrapper, que decide preview/autosave e UI de retry).
  // ─────────────────────────────────────────────────────────────────────────
  async function generate(opts) {
    opts = opts || {};
    var aiCall = opts.aiCall;
    if (typeof aiCall !== 'function') throw new Error('StationEngine.generate: opts.aiCall (função) é obrigatório.');
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    var modelGen = opts.modelGen || 'claude-opus-4-8';
    var modelAudit = opts.modelAudit || 'claude-opus-4-8';
    var pepPolicy = opts.pepPolicy || 'normalize';

    // ── Call 1: caso base ──
    onProgress(1);
    var sys1 = buildSys1(opts.area, opts.nivel, opts.fewShotExamples);
    var msg1 = 'Crie uma NOVA estacao OSCE no padrao INEP. Area: ' + (opts.area || '') + '. '
      + (opts.tema ? 'Tema-alvo (sugestao): ' + opts.tema + '. ' : 'Escolha tema relevante para Revalida. ')
      + 'Nivel: ' + (opts.nivel || 'medium') + '. '
      + (opts.extra ? 'Instrucoes extras: ' + opts.extra + '. ' : '')
      + 'Responda APENAS o JSON, no formato dos exemplos. NAO copie os exemplos — crie estacao original.';
    var r1 = await aiCall({ model: modelGen, max_tokens: 8000, system: sys1, messages: [{ role: 'user', content: msg1 }] });
    if (!r1.ok) throw new Error('HTTP ' + r1.status + ' na geracao do caso (Call 1).');
    var base = parseLoose(extractText(await r1.json()));

    // ── Call 2: PEP ──
    onProgress(2);
    var oa = base.orientAtor || {};
    var resumo = JSON.stringify({
      name: base.name, area: base.area, caso: (base.caso || '').substring(0, 300),
      orientMed: base.orientMed,
      orientAtor_resumo: (typeof oa === 'object') ? Object.keys(oa.se_perguntado_sobre || {}).slice(0, 15).join(', ') : '',
      exams: (base.exams || []).map(function (e) { return e.title || e.name; })
    });
    var r2 = await aiCall({ model: modelGen, max_tokens: 8000, system: buildSys2(),
      messages: [{ role: 'user', content: 'Estacao: ' + resumo + '. Gere o PEP completo (10 pts total). Responda APENAS o array JSON dos itens.' }] });
    if (!r2.ok) throw new Error('HTTP ' + r2.status + ' na geracao do PEP (Call 2).');
    var pepRaw = parseLoose(extractText(await r2.json()));
    var clArr = normalizeChecklistItems(extractChecklistArray(pepRaw));

    // ── PEP: política do wrapper ──
    var pep = processPEP(clArr, pepPolicy);

    // sanitizar complexity
    var compFromAI = (base.complexity || '').toLowerCase().trim();
    var complexity = (['medium', 'advanced'].indexOf(compFromAI) >= 0) ? compFromAI : 'medium';

    var station = Object.assign({}, base, { checklist: pep.checklist, complexity: complexity });

    // ── Auditoria (fail-closed) ──
    onProgress(3);
    var auditResult = await audit(station, aiCall, modelAudit, pep);

    onProgress(4);
    return { station: station, audit: auditResult };
  }

  global.StationEngine = {
    generate: generate,
    buildSys1: buildSys1, buildSys2: buildSys2, buildSysAudit: buildSysAudit,
    processPEP: processPEP, preValidate: preValidate, parseLoose: parseLoose,
    extractChecklistArray: extractChecklistArray, normalizeChecklistItems: normalizeChecklistItems,
    extractText: extractText, pepTotal: pepTotal
  };
})(typeof window !== 'undefined' ? window : this);
