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
       modelFallback,                   // default: claude-opus-4-8 (retry p/ Fable refusal)
       maxTokensAudit,                  // default: 4000 — orcamento de SAIDA da auditoria (Fable 5
                                        // emite thinking no MESMO orcamento; 1500 truncava o JSON)
       onFallback,                      // ({from,to,response}) => void  (observabilidade do fallback)
       onProgress                       // (stepIndex:int) => void   (UI fica no wrapper)
     }) => { station, audit }           // wrapper decide: preview ou autosave

   ENDURECIMENTO DE RUBRICA (2026-07-09) — normalizacao INEP no proprio gerador:
     • buildSys2: PEP so pode ter 2 (binario) ou 3 faixas — NUNCA 4/5 ("Insuficiente"/
       "Totalmente adequado" proibidos); parcial = max/2 por padrao; decompor diagnosticos/
       condutas independentes em itens separados; itens de exame pontuam SOLICITAR+INTERPRETAR,
       nunca RECITAR o dado que o impresso ja entregou.
     • normalizeChecklistItems: colapsa qualquer item com 4+ faixas para 3 niveis [0, max/2, max]
       (preserva o maximo -> soma do PEP intacta). Rede na origem, mesmo se o modelo desobedecer.
     • preValidate: novo gate 'banda_invalida' (high) para 4+ faixas que escaparem.
   COBERTURA DE PALAVRAS DOS EXAMES (2026-07-10): o gerador passa a produzir e o sistema a VERIFICAR
   que cada impresso e solicitavel pelo candidato.
     • buildSys1: trigger_keywords OBRIGATORIA por impresso (4-8 formas naturais de pedir o exame:
       nome + sinonimos + regiao/modalidade), com exemplos (ginecologico, mamas, abdominal,
       toracocentese, imagem generica) e o PORQUE (sem cobertura o impresso so responde a "impresso N").
     • preValidate (BLOQUEIA): 'exame_sem_cobertura' (high) quando um impresso tem <3 keywords usaveis
       E o titulo nao casa com nenhum exame reconhecido pelo runtime (COVERED_EXAM_RX, espelho das
       heuristicas/EXAM_FAMILIES do index.html) — i.e., o candidato nao conseguiria pedi-lo.
     • softWarnings (AVISA): 'cobertura_keywords_fraca' quando as keywords sao poucas mas o titulo e
       exame padrao (runtime entrega por heuristica) — robustez, nao bloqueia.
     • Manter COVERED_EXAM_RX em sincronia com o index.html ao adicionar novas familias de exame.
   QUALIDADE DO crit_adeq (2026-07-10): alinha o PEP gerado ao auditor endurecido do runtime.
     • buildSys2: crit_adeq deve ser CONTAVEL e alinhado aos subitens; itens de TERAPEUTICA/profilaxia
       NOMEIAM o agente correto (nao "orienta tratamento" — e "prescreve ceftriaxona+azitromicina..."),
       encaminhamento nomeia a ESPECIALIDADE correta, conduta pontua a ACAO instituida. Fecha a lacuna
       que deixava a regra "terapeutica correta" (auditor 1.6.66) sem crit_adeq para cobrar (falsos-
       positivos amlodipino/fogachos e cipro/gonococo nasciam de crit_adeq vago).
     • buildSysAudit: novo MEDIUM que sinaliza crit_adeq terapeutico/encaminhamento VAGO.
   IMAGEM SO VIRA DEFEITO SE COBRAR INTERPRETACAO (2026-07-10): estacao SEM impresso de imagem nao
   pode ter item de PEP que manda INTERPRETAR imagem. Imagem apenas SOLICITADA/verbalizada e desenho
   valido. softWarnings: removida a imagem do EXAM_CHECKS amplo (que avisava em solicitacao-so, ruido)
   e criado 'pep_imagem_sem_laudo' (warn) que so dispara quando IMG_INTERP_RX (verbo de leitura ligado
   a termo de imagem) casa E nenhum impresso fornece imagem (IMG_TERM_RX).
   Pendente (outros arquivos, chat Index/Adm/Quick-API): few-shot/GEN_DIFF_RUBRIC (admin.html) e
   a regra de "terapeutica correta" no auditor (index.html).
   AVANCADA ANCORADA EM IMAGEM (2026-07-18) — brief "geracao-estacao-avancada-imagem" v1.0:
     • Novo opt em generate(): imageAnchor {image_file, modality, incidence, finding_truth,
       diagnosis_truth, area, image_credits}. A imagem APROVADA (gate 1 da Angelica) e a ANCORA:
       o gerador escreve a estacao EM TORNO dela (ordem invertida — nunca o texto antes da imagem).
     • normalizeAnchor: fail-fast ANTES de gastar tokens (exige image_file, modality,
       finding_truth, diagnosis_truth e image_credits com license).
     • buildSys1/buildSys2/buildSysAudit ganham o gabarito da imagem: vinheta coerente com o
       diagnosis_truth; item de interpretacao anti-Type-B (cobra SO o que esta no finding_truth,
       sem medida quantitativa nao suportada); auditor sabe que cobrar interpretacao AQUI e
       CORRETO (a imagem existe) e valida contra o gabarito.
     • enforceAnchorImpresso (deterministico, pos-Call 1): rows do impresso-ancora = SO
       tecnica/incidencia (a AUSENCIA de "Achado:" define o tier — nao se confia no modelo p/
       isso), images=[image_file] exato, image_credits alinhado por indice (bug de producao:
       credit null — nao repetir), trigger_keywords solicitaveis por familia de modalidade;
       imagens inventadas nos DEMAIS impressos sao removidas (placeholder = imagem morta).
     • preValidate (modo ancorado, todos HIGH/fail-closed): ancora_sem_imagem,
       credito_desalinhado, achado_no_tier_avancado, segundo_impresso_imagem,
       pep_sem_interpretacao.
     • Ancorado forca: complexity='advanced', dificuldade tratada como 'Avancado' (impressos
       estritos; prevalece sobre GEN_DIFF_RUBRIC do wrapper), trial_available=false (protecao
       de IP), area obrigatoria (opts.area ou anchor.area), SEM sorteio de tema/area.
     • SEM ancora: comportamento 100% identico ao anterior (prompts byte-a-byte iguais).
     • ENGINE_VERSION exportado (1.1.0; 1.0.0 = estado anterior, sem versionamento).
   ORCAMENTO DO AUDITOR + TRUNCAMENTO (2026-07-26) — briefing "modelos-geracao-lote" v1.0 §2:
     • max_tokens da auditoria: 1500 (hardcoded) -> opts.maxTokensAudit || 4000. O Fable 5 emite
       blocos de thinking no MESMO orcamento (media real de 1.860 tokens no eval) — com 1500 o
       JSON da auditoria truncava e a estacao era reprovada com "resposta ilegivel" (falso FAIL).
     • Deteccao de truncamento NA AUDITORIA (espelha trunc1/trunc2 da geracao): stop_reason
       'max_tokens' -> AUDIT_ERROR categoria 'auditor_truncado' com a causa explicita. Isso
       fecha tambem um fail-open real: parseLoose REPARA JSON truncado (fecha chaves), entao um
       audit cortado no meio de "issues" podia parsear com status OK e issues faltando —
       aprovacao indevida. Agora truncamento reprova SEMPRE, com diagnostico claro.
     • ENGINE_VERSION 1.2.0.
   ════════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var NL = '\n';
  // Versionamento do engine (disciplina do projeto: todo arquivo entregue incrementa versao).
  var ENGINE_VERSION = '1.2.0'; // 2026-07-26 — orcamento configuravel do auditor (maxTokensAudit) + deteccao de truncamento na auditoria

  // ─────────────────────────────────────────────────────────────────────────
  // PROMPTS CANÔNICOS
  // ─────────────────────────────────────────────────────────────────────────

  // sys1 — geração do caso. Base: Simulador (v2). Reenxertado: Regras de Ouro
  // #3 e #4 do Admin (impressos/se_perguntado_sobre_exame_fisico SEM gabarito).
  // Nivel MEDIO (Intermediario) permite achados + interpretacao/diagnostico nos impressos
  // (o candidato CONDUZ, nao diagnostica). Facil/Dificil seguem estritos (dados brutos).
  function nivelPermiteDx(n) { return /intermedi|m[\u00e9e]dio|medium/i.test(n || ''); }

  function buildSys1(area, nivel, fewShotExamples, dificuldade, anchor) {
    var head = [
      'Voce e especialista em criar estacoes OSCE no padrao INEP/Revalida brasileiro.',
      'Gere UMA estacao seguindo o padrao dos exemplos. Responda SOMENTE JSON valido (sem markdown).',
      'IMPORTANTE: seja CONCISO. Cada string do JSON deve ser curta (max 2-3 frases). Cada array com max 5 itens. NAO escreva textos longos.',
      '',
      '═══ REGRAS CRITICAS ═══',
      ''
    ];
    var corpo = [
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
      '      ⚠️ LISTE TODOS OS IMPRESSOS: o campo deve cobrir CADA impresso da estacao (exame fisico,',
      '      laboratorio, imagem/FAST, etc), dizendo quando entregar cada um. Nao deixe nenhum impresso',
      '      sem instrucao de entrega correspondente.',
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
      '   b2) IMAGEM POR NIVEL (laboratorio e exame fisico ficam SEMPRE brutos, inclusive no medio):',
      (nivelPermiteDx(dificuldade)
        ? '      NIVEL MEDIO: se o caso tiver exame de imagem com laudo (US/TC/RM/eco/doppler/mamografia), o laudo DEVE trazer os achados + a CONCLUSAO/diagnostico ("compativel com..."). Se NAO houver imagem, use fisico+laboratorio brutos e o candidato diagnostica.'
        : '      Se houver exame de imagem com laudo, ele traz APENAS os achados — NAO cite o diagnostico (o candidato deduz).'),
      '      Raio-X, ECG e foto: imagem CRUA, SEM laudo (sem achados e sem diagnostico) — a leitura e a competencia avaliada.',
      '',
      '   c) ALINHAMENTO (CRITICO p/ qualidade INEP): os exames complementares devem ser PERTINENTES',
      '      a queixa e ao quadro provavel — NUNCA exames aleatorios ou desconexos. Os achados (rows)',
      '      devem ser CONSISTENTES com UM unico quadro clinico plausivel para a queixa, internamente',
      '      coerentes (queixa, exame fisico e exames apontando ao mesmo diagnostico — sem cita-lo).',
      '      Inclua apenas os exames que um generalista pediria para ESTE caso, com achados realistas.',
      '',
      '   d) COERENCIA DE GRAVIDADE (achados <-> quadro clinico): os achados (rows), INCLUSIVE os de',
      '      IMAGEM, NAO podem introduzir um grau de gravidade que o quadro clinico nao sustenta.',
      '      Ex: se o paciente esta ESTAVEL com pneumotorax SIMPLES (traqueia centrada, sem turgencia',
      '      jugular, PA normal), a radiografia NAO deve descrever "desvio de mediastino" — isso e sinal',
      '      de pneumotorax HIPERTENSIVO, que exige paciente INSTAVEL e descompressao imediata. Sinais',
      '      vitais, exame fisico e achados de imagem devem descrever a MESMA gravidade clinica.',
      '',
      '   e) IMAGEM/FAST — REDACAO LIMPA: ao descrever exame com multiplas janelas/regioes (ex: FAST,',
      '      com hepatorrenal, esplenorrenal, pelvico, pericardio), cada regiao deve dizer de forma',
      '      INEQUIVOCA se o achado esta PRESENTE ou AUSENTE — NUNCA as duas coisas na mesma linha. Use',
      '      o nome anatomico correto de cada janela e nao misture lados ("periesplenico/esplenorrenal"',
      '      e a ESQUERDA; "hepatorrenal/Morrison" e a DIREITA).',
      '      ❌ "Quadrante direito: pequena lamina de liquido livre periesplenico ausente neste quadrante"',
      '      ✅ "Espaco hepatorrenal (Morrison, a direita): sem liquido livre"',
      '      ✅ "Espaco esplenorrenal (a esquerda): liquido livre presente"',
      '',
      '6) VALIDACOES TECNICAS:',
      '   • complexity: "medium" ou "advanced" (NUNCA simple/easy/intermediate).',
      '   • COBERTURA DE PALAVRAS (trigger_keywords) — OBRIGATORIA em CADA impresso, senao o candidato',
      '     NAO consegue solicitar o exame e o impresso NUNCA aparece (falha grave de estacao):',
      '     Cada exam DEVE ter trigger_keywords: array de 4-8 strings (3+ chars, minusculas, SEM acento)',
      '     cobrindo TODAS as formas naturais de PEDIR aquele exame — o nome do exame + sinonimos +',
      '     a regiao/modalidade. Pense: "como o candidato falaria para pedir ISTO?".',
      '     (NUNCA abreviacoes soltas "rx"/"tc"/"us"/"pa" — use "raio x"/"tomografia"/"ultrassom"/"pressao arterial").',
      '     Exemplos de boa cobertura por tipo de impresso:',
      '       - "EXAME GINECOLOGICO" -> ["exame ginecologico","exame especular","especulo","toque vaginal","exame pelvico","inspecao vulvar"]',
      '       - "EXAME DAS MAMAS" -> ["exame das mamas","exame mamario","palpacao das mamas","examinar as mamas","exame clinico das mamas"]',
      '       - "EXAME ABDOMINAL" -> ["exame abdominal","exame do abdome","palpacao abdominal","examinar o abdome"]',
      '       - "ANALISE DO LIQUIDO PLEURAL (TORACOCENTESE)" -> ["toracocentese","liquido pleural","analise do liquido pleural","puncao pleural"]',
      '       - "EXAMES DE IMAGEM (MAMOGRAFIA+US)" -> ["mamografia","ultrassom de mama","ultrassonografia das mamas","exames de imagem"]',
      '     Regra pratica: se o titulo do impresso NAO for um exame padrao obvio (exame fisico, hemograma,',
      '     raio x, ecg, ultrassom, tomografia), a cobertura por palavras e AINDA MAIS critica — inclua o',
      '     nome do procedimento/regiao E os sinonimos falados. Titulos genericos ("IMAGEM","EXAMES") exigem',
      '     as palavras do que o impresso REALMENTE contem (ex.: se "IMAGEM" e uma TC de abdome, inclua',
      '     "tomografia de abdome","tc de abdome").',
      '   • Cada exam: rows com texto descritivo BRUTO (ver regra 5), images: [].',
      '   • IMPRESSOS: no MAXIMO 5 impressos, apenas os ESSENCIAIS e pertinentes ao caso. TODO impresso',
      '     DEVE ter os rows PREENCHIDOS com dados brutos — NUNCA crie impresso de titulo sem dados.',
      '     Menos impressos completos e melhor que muitos vazios. Nao gere exames irrelevantes so para encher.',
      '',
      '═══ EXEMPLOS OFICIAIS INEP ═══',
      fewShotExamples || '(Sem exemplos disponiveis. Siga o padrao INEP geral.)',
      '',
      '═══ FORMATO DA SAIDA ═══',
      '{"name":"","area":"","nivel":"","local":"","infra":"","caso":"","orientMed":"","complexity":"medium","pNome":"","pIdade":0,"pGenero":"","pProf":"","pCivil":"","pQueixa":"","informante_tipo":"paciente","acompNome":"","acompRelacao":"","acompGenero":"","orientAtor":{"regra_fundamental":"","fala_inicial_espontanea":"","tom_emocional":"","se_perguntado_sobre":{},"nao_falar_espontaneamente":[],"se_perguntado_sobre_exame_fisico":""},"exams":[{"title":"","trigger_keywords":[],"rows":[],"images":[]}]}',
      '',
      'Area: ' + (area || '') + ' | Nivel: ' + (nivel || '')
    ];
    return head.concat(anchor ? anchorSys1Block(anchor) : [], corpo).join(NL);
  }

  // sys2 — PEP. Canônico: Simulador (superset, com distribuição sugerida).
  // anchor (opcional): estacao AVANCADA ancorada em imagem — anexa a regra do item de interpretacao.
  function buildSys2(anchor) {
    var linhas = [
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
      '⚠️ ESTRUTURA DE FAIXAS — SO BINARIO OU 3 NIVEIS (padrao INEP; NUNCA 4+):',
      'Cada item tem EXATAMENTE 2 faixas (binario) OU 3 faixas. NUNCA use 4 ou 5 faixas.',
      '  - BINARIO: scores [0, max], labels ["Inadequado","Adequado"] — para acao unica/objetiva (ex: "Solicita radiografia").',
      '  - 3 NIVEIS: scores [0, max/2, max], labels ["Inadequado","Parcialmente adequado","Adequado"] — quando ha multiplos subitens.',
      'PARCIAL = METADE DO MAXIMO por padrao (ex: max 1.0 -> parcial 0.5; max 1.5 -> parcial 0.75; max 2.0 -> parcial 1.0).',
      'PROIBIDO os niveis "Insuficiente" e "Totalmente adequado" (sao 4a/5a faixa, fora do padrao INEP).',
      'labels DEVE ter o MESMO numero de itens que scores. NUNCA 4 scores com 3 labels, e NUNCA 4 faixas.',
      '',
      '⚠️ DECOMPONHA DIAGNOSTICOS E CONDUTAS INDEPENDENTES EM ITENS SEPARADOS:',
      'Se o caso tem DOIS diagnosticos/hipoteses independentes, ou DUAS condutas independentes, cada um',
      'e um item PROPRIO com sua pontuacao — NUNCA agrupe "diagnostico A e B" num item so, nem "conduta',
      'X e Y" num item so. Um item = uma habilidade avaliavel de forma independente.',
      '',
      '⚠️ O PEP AVALIA SOLICITAR + INTERPRETAR, NUNCA RECITAR O IMPRESSO:',
      'Itens de exame fisico e de exames complementares pontuam o candidato por SOLICITAR o exame e por',
      'INTERPRETAR/CONCLUIR a partir do achado — NUNCA por repetir em voz alta o dado que o impresso ja',
      'entregou. NAO crie subitem do tipo "verbaliza que a PA e 90x60" ou "identifica nodulo azulado as 5h"',
      '(isso e recitar o impresso). Em vez disso: "solicita exame fisico dirigido" e "interpreta o achado',
      '(reconhece instabilidade / reconhece a trombose e afasta abscesso)". A habilidade avaliada e o',
      'raciocinio clinico, nao a leitura do dado pronto.',
      '',
      '⚠️ QUALIDADE DO crit_adeq (o auditor aplica o crit_adeq LITERALMENTE — escreva-o para ser cobravel):',
      'O crit_adeq/crit_parc/crit_inad e o CRITERIO que o corretor automatico usa. Se for vago, o corretor',
      'nao consegue distinguir o certo do errado. Regras:',
      '  1) CONTAVEL E ALINHADO AOS SUBITENS: o crit_adeq diz EXPLICITAMENTE quantos/quais subitens exige',
      '     (ex.: "realiza os 3", "cita ambos os agentes", "investiga os 4"). Evite vago ("avalia',
      '     adequadamente", "conduz bem"). O crit_parc (se 3 niveis) diz o limiar parcial (ex.: "realiza 1 de 2").',
      '  2) TERAPEUTICA/PROFILAXIA/TRATAMENTO — NOMEIE O(S) AGENTE(S) CORRETO(S): o crit_adeq deve NOMEAR o',
      '     farmaco/classe/terapia CORRETA e vigente para o caso, nao "orientar tratamento" generico.',
      '     ❌ "orienta opcao nao hormonal para fogachos" (vago — credita ate amlodipino, que e errado)',
      '     ✅ "prescreve ISRS/venlafaxina ou gabapentina para os fogachos"',
      '     ❌ "indica profilaxia para ISTs"   ✅ "prescreve ceftriaxona + azitromicina + penicilina benzatina"',
      '     Assim o corretor rebaixa a escolha ERRADA (a acao existe mas o agente e incorreto).',
      '  3) ENCAMINHAMENTO — NOMEIE A ESPECIALIDADE CORRETA: ❌ "encaminha ao especialista"',
      '     ✅ "encaminha a urologia" (para litiase ureteral). Especialidade proxima porem errada NAO conta.',
      '  4) CONDUTA PONTUA A ACAO INSTITUIDA, nao a mencao: escreva o crit_adeq sobre INSTITUIR a conduta',
      '     correta (ex.: "inicia anticoagulacao plena"), nao sobre "falar" no assunto.',
      'Total das pontuacoes maximas (ultimo score de cada) deve = 10.0',
      '',
      '⚠️ NENHUM ITEM PODE TER PONTUACAO MAXIMA ZERO:',
      'TODO item visivel DEVE pontuar. NUNCA gere item com scores [0,0] ou [0,0,0].',
      'Se a soma passar de 10, REDISTRIBUA reduzindo os pesos dos itens maiores — JAMAIS zere',
      'um item para fechar a conta. A ORIENTACAO ao paciente e tarefa obrigatoria do orientMed',
      '(item 6) e SEMPRE vale ponto (minimo 0.25). Um item que nao pontua e um defeito grave.',
      '',
      '⚠️ ALINHAMENTO PEP <-> IMPRESSOS (so cobre o que existe):',
      'Os subitens so podem cobrar exames/dados que EXISTEM nos impressos fornecidos (lista "exams",',
      'com title e rows). Antes de citar um exame num subitem, confirme que ele consta em algum impresso.',
      'Ex: NAO cobre "gasometria arterial" ou "coagulograma" se nenhum impresso traz esses dados;',
      'NAO cobre "tipagem sanguinea" se nao ha tipagem nos impressos. Cobre apenas o que o candidato',
      'consegue obter na estacao.',
      '',
      '⚠️ COERENCIA CLINICA (fisiologia <-> conduta):',
      'Os subitens e criterios devem ser COERENTES com o estado clinico descrito (sinais vitais, achados).',
      'NAO exija conduta que pressupoe um estado diferente do apresentado. Ex: se os sinais vitais mostram',
      'INSTABILIDADE/choque (PA baixa, taquicardia, palidez), NAO exija "TC em paciente estavel" — nesse',
      'caso a conduta esperada e estabilizacao/cirurgia imediata. Sinais vitais, achados e conduta esperada',
      'devem contar a MESMA historia clinica.',
      '',
      '═══ EXEMPLO DO INEP 2025/1 ═══',
      '[',
      '  {"id":"1","text":"Apresentação","subitens":"(1) identifica-se\\n(2) cumprimenta o paciente","scores":[0,0.25,0.5],"labels":["Inadequado","Parcialmente adequado","Adequado"],"crit_adeq":"realiza as duas ações","crit_parc":"realiza apenas uma","crit_inad":"não realiza nenhuma"},',
      '  {"id":"6","text":"Solicita radiografia","scores":[0,2.0],"labels":["Inadequado","Adequado"],"crit_adeq":"solicita radiografia","crit_inad":"não solicita"}',
      ']'
    ];
    return linhas.concat(anchor ? anchorSys2Block(anchor) : []).join(NL);
  }

  // sysAudit — auditor IA. Canônico: Simulador (anti-falso-positivo, anti-over-rigor).
  // anchor (opcional): estacao ancorada — auditor recebe o gabarito da imagem e regras do tier.
  function buildSysAudit(dificuldade, anchor) {
    var head = [
      'Voce e auditor clinico do INEP/Revalida que valida estacoes OSCE.',
      'Sua tarefa: analisar a estacao e identificar APENAS problemas REAIS e CLAROS.',
      'NAO invente problemas. NAO seja over-rigoroso. Reporte so o que e DEFEITO OBJETIVO.',
      (nivelPermiteDx(dificuldade)
        ? 'NIVEL MEDIO: o LAUDO DE IMAGEM (US/TC/RM/eco/doppler/mamografia) PODE/DEVE conter achados + diagnostico ("compativel com..."). Laboratorio, exame fisico e raio-x seguem BRUTOS. So reporte vazamento se o dx aparecer em laboratorio/fisico/raio-x — NUNCA por dx no laudo de imagem.'
        : 'Impressos com dados brutos; a imagem (se houver) traz SO achados, sem diagnostico. Reporte VAZAMENTO se entregarem interpretacao/diagnostico pronto (inclusive laudo de imagem citando o dx no nivel dificil).'),
      ''
    ];
    var corpo = [
      'IMPORTANTE — O payload e um RESUMO (otimizado p/ tokens). Voce ve "orientAtor_resumo" com',
      'metadados ja validados (fala_inicial_chars, se_perguntado_sobre_chaves, nao_falar_count,',
      'regra_fundamental_presente) E TAMBEM o conteudo de "se_perguntado_sobre" (as respostas da',
      'personagem, chave->valor) — USE esse conteudo para checar coerencia clinica com o PEP.',
      '⚠️ NAO reclame que orientAtor "esta incompleto" ou que "checklist esta truncado" — e RESUMO.',
      'Use os metadados: se_perguntado_sobre_chaves>=12 → OK; regra_fundamental_presente=true → OK.',
      '',
      'VOCE AGORA VE OS EXAMES COM ACHADOS (campo "exams": title + achados + tem_imagem). Use isso para',
      'validar (a) ALINHAMENTO: cada exame e pertinente a queixa/quadro provavel; (b) CONSISTENCIA: os',
      'achados sao compativeis entre si e com UM quadro clinico plausivel para a queixa. Rigor INEP: a',
      'estacao deve ser internamente coerente — queixa, dados, exame fisico e exames no mesmo quadro.',
      '',
      '🔴 HIGH (causa FAIL — bloqueia a estacao):',
      '  - VAZAMENTO: "name" cita diagnostico (ex: "Apendicite", "Dengue", "AVC").',
      '  - VAZAMENTO: "caso" cita diagnostico, hipoteses ou exames especificos.',
      '  - VAZAMENTO: "orientMed" cita nome de doenca ou exame especifico do gabarito.',
      '  - VAZAMENTO: impresso/rows entregam interpretacao ("padrao tipico de...", "(FEBRIL)", "Diagnostico:...").',
      '  - INCOERENCIA CLINICA GRAVE: conduta inadequada/perigosa para o quadro.',
      '  - INCOERENCIA FISIOLOGIA<->CONDUTA: o PEP exige conduta que pressupoe estado clinico diferente',
      '    do descrito (ex: exige "TC em paciente estavel" mas os sinais vitais mostram instabilidade/',
      '    choque, onde o correto seria estabilizacao/cirurgia imediata). Sinais vitais, achados e conduta',
      '    esperada devem contar a MESMA historia clinica.',
      '  - INCOERENCIA ORIENTATOR<->PEP (inversao clinica): os fatores de risco, comorbidades, alergias e',
      '    contraindicacoes que a personagem REVELA no se_perguntado_sobre devem ser coerentes com o que o',
      '    PEP premia. E ERRO GRAVE quando o PEP premia concluir ou conduzir o OPOSTO do que os dados da',
      '    personagem indicam. Exemplos: personagem fuma e tem enxaqueca COM AURA (contraindicacoes a',
      '    estrogenio) mas o PEP premia "concluir que e elegivel para contraceptivo combinado"; personagem',
      '    alergica a um farmaco mas o PEP premia prescrever esse farmaco; personagem com fator de risco',
      '    que o PEP afirma inexistir ("paciente sem fatores de risco"). Se a personagem TEM um fator de',
      '    risco/contraindicacao, o PEP NAO pode premiar ignora-lo, nega-lo ou conduzir contra ele. Esse',
      '    tipo de inversao premia o aluno errado e penaliza o correto — reporte como high/coerencia.',
      '  - ITEM SEM PONTO: algum item do PEP tem pontuacao maxima 0 (nao pontua nada).',
      '  - ESTRUTURA QUEBRADA: orientAtor sem regra_fundamental ou se_perguntado_sobre vazio.',
      '  - ESPECIALISTA NO CASO: "caso" diz "Voce e ginecologista/cardiologista/etc".',
      '    Revalida simula GENERALISTA — caso so pode dizer "Voce e medico em UBS/PA/Ambulatorio/PS".',
      '    (Encaminhar para especialista no orientMed/checklist e CORRETO — so nao no "caso".)',
      '  - ALINHAMENTO DE EXAMES: um exame disponivel e CLARAMENTE irrelevante para a queixa/caso',
      '    (ex: espirometria numa estacao de cefaleia sem nexo). Exames devem ser pertinentes ao quadro.',
      '  - ACHADOS INCONSISTENTES: valores/achados de um impresso incompativeis entre si ou com um quadro',
      '    plausivel para a queixa (ex: hemograma normal numa sepse grave descrita; ECG dito normal mas',
      '    com supra de ST nos rows). Os achados (rows) devem ser internamente coerentes com UM quadro.',
      '  - DEMOGRAFIA IMPOSSIVEL: idade/sexo incompativeis com a queixa (ex: queixa de menopausa em',
      '    paciente do sexo masculino; gestacao sem possibilidade biologica; doenca pediatrica em idoso).',
      '',
      '🟡 MEDIUM (WARN com 2+):',
      '  - fala_inicial_chars > 100 (revela sintomas extras).',
      '  - se_perguntado_sobre_chaves < 12.  - nao_falar_count < 4.  - regra_fundamental_presente=false.',
      '  - PEP nao cobre fases essenciais.  - Pequena incoerencia clinica.',
      '  - Exame presente porem pouco focado/pertinente ao quadro (poderia ser mais alinhado).',
      '  - Historia/antecedentes com pequena inconsistencia interna.',
      '  - PEP nao cobre as 4 fases: anamnese, exame fisico, hipotese diagnostica, conduta.',
      '  - PEP cobra exame/dado que nenhum impresso fornece (ex: subitem pede gasometria/coagulograma/',
      '    tipagem mas nao ha esse dado nos impressos), salvo se for claramente resposta verbal do chefe.',
      '  - crit_adeq TERAPEUTICO VAGO: item de conduta/tratamento/profilaxia/encaminhamento cujo crit_adeq',
      '    NAO nomeia o agente/terapia/especialidade CORRETA (ex.: "orienta tratamento", "indica profilaxia",',
      '    "encaminha ao especialista"). Sem nomear, o corretor credita ate a escolha errada. Reporte para',
      '    que o crit_adeq nomeie o correto (ex.: "prescreve ceftriaxona+azitromicina+penicilina benzatina";',
      '    "encaminha a urologia").',
      '  - ACHADO DE IMAGEM com gravidade que o quadro nao sustenta (ex: "desvio de mediastino" num',
      '    pneumotorax descrito como simples/estavel, com traqueia centrada e sem turgencia jugular).',
      '  - IMAGEM/FAST com regiao ambigua (afirma e nega o achado na mesma linha) ou lado anatomico trocado.',
      '  - Valores plausiveis mas no limite do coerente para o quadro.',
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
      '{"status":"OK"|"WARN"|"FAIL","score":0-10,"issues":[{"severity":"high"|"medium","category":"vazamento"|"coerencia"|"alinhamento"|"demografia"|"estrutura"|"pep","message":"..."}]}'
    ];
    return head.concat(anchor ? anchorSysAuditBlock(anchor) : [], corpo).join(NL);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UTIL: extrair texto da Response do proxy (formato Anthropic ou OpenAI-like)
  // ─────────────────────────────────────────────────────────────────────────
  function extractText(data) {
    if (!data) return '';
    // Procura o PRIMEIRO bloco de texto (modelos com 'thinking' colocam um bloco de
    // raciocinio antes do texto; ler so content[0] devolveria vazio nesses casos).
    if (Array.isArray(data.content)) {
      for (var i = 0; i < data.content.length; i++) {
        var b = data.content[i];
        if (b && b.type === 'text' && b.text) return b.text;
      }
      for (var j = 0; j < data.content.length; j++) {
        if (data.content[j] && data.content[j].text) return data.content[j].text;
      }
    }
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

  // Reconcilia rotulos com o numero de faixas de score (labels.length === scores.length).
  // Mata o quirk de PEP com scores de 4 faixas e labels de 3. Usa a redacao do modelo
  // apenas quando o tamanho ja bate; caso contrario, aplica o esquema canonico por n.
  function labelsForBands(n, provided) {
    if (Array.isArray(provided) && provided.length === n) return provided.slice();
    var CANON = {
      2: ['Inadequado', 'Adequado'],
      3: ['Inadequado', 'Parcialmente adequado', 'Adequado'],
      4: ['Inadequado', 'Insuficiente', 'Parcialmente adequado', 'Adequado'],
      5: ['Inadequado', 'Insuficiente', 'Parcialmente adequado', 'Adequado', 'Totalmente adequado']
    };
    if (CANON[n]) return CANON[n].slice();
    if (n <= 1) return ['Adequado'];
    var out = ['Inadequado'];
    for (var i = 1; i < n - 1; i++) out.push('Parcialmente adequado ' + i);
    out.push('Adequado');
    return out;
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
      // NORMALIZACAO DE BANDAS (padrao INEP: so binario ou 3 niveis). Qualquer item com 4+ faixas
      // ("Insuficiente"/"Totalmente adequado") e colapsado para 3 niveis [0, max/2, max]: preserva o
      // MAXIMO (a soma do PEP nao muda) e crava parcial = metade do maximo. Rede na origem: estacao
      // nova de IA nunca entra no acervo com 4 bandas, mesmo que o modelo desobedeca o prompt.
      var provLabels = it.labels;
      if (scores.length > 3) {
        var mxB = Math.max.apply(null, scores.map(function (x) { return Number(x) || 0; }));
        scores = [0, Math.round((mxB / 2) * 100) / 100, mxB];
        provLabels = null;
      }
      var labels = labelsForBands(scores.length, provLabels);
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
    // 0) RESSUSCITAR itens mortos (maximo 0): todo item visivel DEVE pontuar.
    //    Em vez de reprovar (e gastar retry), atribui peso default e renormaliza p/ 10.
    var ressuscitou = false;
    if (Array.isArray(clArr)) {
      clArr.forEach(function (item) {
        if (item && Array.isArray(item.scores) && item.scores.length) {
          var mx = Math.max.apply(null, item.scores.map(function (x) { return Number(x) || 0; }));
          if (!(mx > 0)) {
            item.scores = (item.scores.length >= 3) ? [0, 0.25, 0.5] : [0, 0.5];
            item.labels = labelsForBands(item.scores.length, null);
            ressuscitou = true;
          }
        }
      });
    }
    if (ressuscitou && Array.isArray(clArr) && clArr.length) {
      var tR = pepTotal(clArr);
      if (tR > 0 && Math.abs(tR - 10) > 0.01) {
        var fR = 10 / tR;
        clArr.forEach(function (item) {
          if (item && Array.isArray(item.scores)) {
            item.scores = item.scores.map(function (x) { return Math.round((Number(x) || 0) * fR * 4) / 4; });
          }
        });
        // ajuste fino no MAIOR item p/ fechar exatamente 10 (preserva o peso da orientacao)
        var tR2 = pepTotal(clArr);
        if (Math.abs(tR2 - 10) > 0.01) {
          var maior = null, maiorMx = -1;
          clArr.forEach(function (item) {
            if (item && Array.isArray(item.scores) && item.scores.length) {
              var m = Number(item.scores[item.scores.length - 1]) || 0;
              if (m > maiorMx) { maiorMx = m; maior = item; }
            }
          });
          if (maior) {
            var li = maior.scores.length - 1;
            maior.scores[li] = Math.round((Number(maior.scores[li]) + (10 - tR2)) * 100) / 100;
            if (maior.scores.length === 3) maior.scores[1] = Math.round((maior.scores[li] / 2) * 100) / 100;
          }
        }
      }
    }
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

  // Eixos tematicos por area — sorteados quando o tema vem vazio (garante diversidade da geracao)
  var TEMA_EIXOS = {
    'Ginecologia': ['sangramento uterino anormal','corrimento vaginal e vaginites','climaterio e menopausa','contracepcao e planejamento familiar','dor pelvica','doenca inflamatoria pelvica','pre-natal de baixo risco','intercorrencias hipertensivas na gestacao','diabetes gestacional','hemorragia da primeira metade da gestacao','puerperio e amamentacao','rastreio de cancer de colo (citologia alterada)','nodulo mamario e mastalgia','amenorreia','infeccoes sexualmente transmissiveis','violencia sexual'],
    'Pediatria': ['febre sem sinais localizatorios','diarreia aguda e desidratacao','infeccao respiratoria aguda','exantemas da infancia','sibilancia e asma','dor abdominal na crianca','ictericia neonatal','crescimento e desenvolvimento','calendario vacinal','suspeita de maus-tratos','cefaleia na infancia','infeccao do trato urinario'],
    'Cirurgia': ['abdome agudo inflamatorio','abdome agudo obstrutivo','trauma abdominal','trauma toracico','atendimento ao politraumatizado (ABCDE)','hernias da parede abdominal','colelitiase e complicacoes','doencas anorretais','urolitiase','retencao urinaria aguda','feridas e drenagem de abscesso','queimaduras'],
    'Clínica': ['dor toracica','dispneia aguda','dor abdominal no adulto','cefaleia','febre no adulto','sindrome consumptiva','descompensacao de diabetes','crise hipertensiva','sincope','lombalgia','diarreia no adulto','ictericia no adulto','disturbios da tireoide','anemia'],
    'Medicina de Família/Comunidade': ['manejo de hipertensao na APS','manejo de diabetes na APS','saude mental (depressao/ansiedade) na APS','pre-natal de baixo risco','puericultura','cessacao do tabagismo','rastreios em adultos','paciente poliqueixoso','planejamento familiar','abordagem do uso de alcool']
  };

  // Espelho CONDENSADO da cobertura do runtime (buildRules heuristicas + EXAM_FAMILIES do index.html).
  // Um impresso cujo TITULO casa aqui e solicitavel mesmo SEM trigger_keywords (o runtime entrega por
  // heuristica). MANTER EM SINCRONIA com o index.html quando novas familias de exame forem adicionadas.
  var COVERED_EXAM_RX = /f[i\u00ed]sic|clinic|abcde|exame.{0,5}(retal|digital)|toque.{0,5}retal|\burina\b|urinari|\beas\b|urocultura|sedimento.{0,10}urin|hemogram|leucogram|hematimetr|(exame.{0,6}(de.{0,4})?)?sangue|bioquimic|laborator|exames?.{0,5}complement|\becg\b|eletrocardiogr|\beletro\b|raio.{0,3}x|radiograf|\brx\b|incidencia|ultrassom|ultrasson|\busg\b|ecograf|tomograf|\btc\b|\btac\b|resson[a\u00e2]nc|\brm\b|glicem|dextro|\bhgt\b|glicose|gasometr|sorolog|\bhiv\b|vdrl|sifilis|hepatite|beta.?hcg|\bhcg\b|ureia|creatinin|funcao.{0,8}renal|\btgo\b|\btgp\b|bilirrubin|transaminas|funcao.{0,8}hepat|sodio|potassio|eletrolit|calcio|troponin|ck.?mb|\bcpk\b|coagulogr|\btap\b|\bttpa?\b|\binr\b|plaqueta|liquor|liquido.{0,5}(cefalo|cerebro)|puncao.{0,5}lombar|\braqui|papanicol|citolog|colpocit|preventivo|colposcop|espiromet|prova.{0,8}(funcao|ventil)|pico.{0,5}fluxo|endoscop|\beda\b|colonoscop|\bpcr\b|proteina.{0,5}c.{0,5}reativ|\bvhs\b|ecocardiogr|eco.{0,4}cardi|fundoscop|fundo.{0,5}(de.{0,5})?olho|oftalmoscop|caderneta|carteira.{0,8}(vacina|gestante)|cart[a\u00e3]o.{0,8}(pre.?natal|crianc|gestante)|cultura|antibiogram|hemocultura|teste.{0,5}rapido|antigeno|\bswab\b|eletroencefal|\beeg\b|otoscop|doppler|duplex|biopsia|anatomopatolog|histopatolog|amilase|lipase|tireoid|\btsh\b|\bt4\b|\bt3\b|hormon|les[a\u00e3]o|lesoes|inspec|ectoscop|ictoscop|\bferida|queimad|ulcera|dermatolog/i;
  function engNorm(t) { return String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  // Conta trigger_keywords "usaveis" de um impresso (>=3 chars apos deacentuar, deduplicadas).
  function usableKw(ex) {
    var seen = {};
    (Array.isArray(ex && ex.trigger_keywords) ? ex.trigger_keywords : []).forEach(function (k) {
      if (typeof k !== 'string') return;
      var kn = engNorm(k).trim();
      if (kn.length >= 3) seen[kn] = 1;
    });
    return Object.keys(seen).length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MODO AVANCADA ANCORADA EM IMAGEM (2026-07-18)
  // A imagem aprovada pela Angelica e a ANCORA da estacao — o gerador recebe o
  // gabarito (finding_truth/diagnosis_truth) e escreve a estacao EM TORNO dela.
  // O tier avancado e definido pela AUSENCIA de linha "Achado:" no impresso de
  // imagem; por isso o impresso-ancora e reescrito DETERMINISTICAMENTE (nao se
  // confia no modelo para o que define o tier).
  // ─────────────────────────────────────────────────────────────────────────
  // Titulo/corpo com "cara" de exame de imagem (p/ localizar o impresso-ancora e
  // vetar um SEGUNDO impresso de imagem na estacao ancorada). Opera sobre engNorm().
  var ANCHOR_IMG_TITLE_RX = /radiograf|raio.{0,3}x|\brx\b|tomograf|angiotomograf|ultrass|\busg\b|ecograf|doppler|mamograf|cintilograf|ressonanc|\brm\b|ecocardiogr|\becg\b|eletrocardiogr|\bfast\b|\bimagem\b/;
  // Linha de achado/laudo/diagnostico no impresso-ancora = contradicao de tier (rede pos-enforce).
  var ANCHOR_ACHADO_RX = /^\s*(achados?|laudo|conclus[a\u00e3]o|impress[a\u00e3]o(\s+diagn[o\u00f3]stica)?|diagn[o\u00f3]stico)\s*[:\-]|compat[i\u00ed]vel\s+com|sugestiv[oa]\s+de/i;

  // Linha de tecnica/incidencia do impresso-ancora (conteudo visto pelo candidato).
  function buildAnchorTechLine(anchor) {
    var m = String((anchor && anchor.modality) || '').trim();
    var line = m ? (m.charAt(0).toUpperCase() + m.slice(1)) : 'Exame de imagem';
    var inc = String((anchor && anchor.incidence) || '').trim();
    if (inc) line += ', incid\u00eancia ' + inc;
    return line + '.';
  }

  // Keywords deterministicas p/ o impresso-ancora ser SOLICITAVEL pelo candidato:
  // mescla as do modelo com defaults por familia de modalidade (dedup por engNorm, teto 8).
  function anchorKeywords(anchor, provided) {
    var m = engNorm((anchor && anchor.modality) || '');
    var base = ['exame de imagem', 'imagem'];
    if (/radiograf|raio/.test(m)) base = base.concat(['radiografia', 'raio x']);
    else if (/tomograf/.test(m)) base = base.concat(['tomografia', 'tomografia computadorizada']);
    else if (/ultrass|ecograf/.test(m)) base = base.concat(['ultrassom', 'ultrassonografia']);
    else if (/ressonanc/.test(m)) base = base.concat(['ressonancia', 'ressonancia magnetica']);
    else if (/ecocardiogr/.test(m)) base = base.concat(['ecocardiograma']);
    else if (/eletrocardiogr/.test(m)) base = ['eletrocardiograma', 'eletro'];
    else if (/mamograf/.test(m)) base = base.concat(['mamografia']);
    else if (/\bfast\b/.test(m)) base = base.concat(['fast', 'ultrassom fast']);
    if (m.length >= 3) base.push(m); // ex.: 'radiografia de torax' (modalidade completa, ja sem acento)
    var out = [], seen = {};
    (Array.isArray(provided) ? provided : []).concat(base).forEach(function (k) {
      if (typeof k !== 'string') return;
      var kn = engNorm(k).trim();
      if (kn.length < 3 || seen[kn]) return;
      seen[kn] = 1; out.push(kn);
    });
    return out.slice(0, 8);
  }

  // Valida e normaliza opts.imageAnchor. Retorna null se ausente. Lanca Error se
  // incompleta — fail-fast ANTES da Call 1 (nenhum token gasto com ancora invalida).
  // image_credits: bloco de credito emitido pelo pipeline de busca (objeto unico;
  // tolera array de 1 elemento).
  function normalizeAnchor(a) {
    if (a == null || a === false || a === '') return null;
    if (typeof a !== 'object') throw new Error('imageAnchor deve ser um objeto (modo avancada ancorada em imagem).');
    var cred = a.image_credits;
    if (Array.isArray(cred)) cred = cred[0];
    var falta = [];
    if (!String(a.image_file || '').trim()) falta.push('image_file');
    if (!String(a.modality || '').trim()) falta.push('modality');
    if (!String(a.finding_truth || '').trim()) falta.push('finding_truth');
    if (!String(a.diagnosis_truth || '').trim()) falta.push('diagnosis_truth');
    if (!cred || typeof cred !== 'object' || !String(cred.license || '').trim()) falta.push('image_credits (objeto com license)');
    if (falta.length) throw new Error('imageAnchor incompleto — campos obrigatorios ausentes: ' + falta.join(', ') + '. Nada foi gerado (fail-fast).');
    return {
      image_file: String(a.image_file).trim(),
      modality: String(a.modality).trim(),
      incidence: String(a.incidence || '').trim(),
      finding_truth: String(a.finding_truth).trim(),
      diagnosis_truth: String(a.diagnosis_truth).trim(),
      area: String(a.area || '').trim(),
      image_credits: cred
    };
  }

  // Pos-Call 1 (deterministico): garante o impresso-ancora exatamente como o tier
  // exige — rows = SO tecnica/incidencia (nenhum "Achado:"), images=[image_file],
  // image_credits alinhado por indice (bug conhecido de producao: credit null),
  // trigger_keywords solicitaveis — e remove imagens INVENTADAS dos demais
  // impressos (placeholder sem arquivo real no bucket = imagem morta).
  function enforceAnchorImpresso(base, anchor) {
    if (!base || typeof base !== 'object') return base;
    var exams = Array.isArray(base.exams) ? base.exams : [];
    var idx = -1, i;
    // 1) quem ja referencia o arquivo da ancora (modelo obedeceu o sys1)
    for (i = 0; i < exams.length; i++) {
      var e0 = exams[i];
      if (e0 && Array.isArray(e0.images) && e0.images.indexOf(anchor.image_file) >= 0) { idx = i; break; }
    }
    // 2) senao, 1o impresso com TITULO de exame de imagem
    if (idx < 0) for (i = 0; i < exams.length; i++) {
      if (exams[i] && ANCHOR_IMG_TITLE_RX.test(engNorm(exams[i].title || ''))) { idx = i; break; }
    }
    // 3) senao, 1o impresso cujos rows mencionam modalidade de imagem
    if (idx < 0) for (i = 0; i < exams.length; i++) {
      var rws = (exams[i] && Array.isArray(exams[i].rows)) ? exams[i].rows.join(' ') : '';
      if (rws && ANCHOR_IMG_TITLE_RX.test(engNorm(rws))) { idx = i; break; }
    }
    // 4) senao, cria (o modelo omitiu — a ancora e obrigatoria)
    var ex;
    if (idx < 0) { ex = {}; exams.push(ex); idx = exams.length - 1; }
    else { ex = exams[idx] || (exams[idx] = {}); }
    ex.title = String(ex.title || anchor.modality || 'EXAME DE IMAGEM').toUpperCase();
    ex.rows = [buildAnchorTechLine(anchor)];
    ex.images = [anchor.image_file];
    ex.image_credits = [anchor.image_credits];
    ex.trigger_keywords = anchorKeywords(anchor, ex.trigger_keywords);
    for (i = 0; i < exams.length; i++) {
      if (i === idx || !exams[i]) continue;
      if (Array.isArray(exams[i].images) && exams[i].images.length) exams[i].images = [];
      if (Array.isArray(exams[i].image_credits) && exams[i].image_credits.length) exams[i].image_credits = [];
    }
    base.exams = exams;
    return base;
  }

  // Bloco do sys1 (geracao do caso) — o gabarito da imagem guia a vinheta.
  function anchorSys1Block(anchor) {
    return [
      '0) MODO AVANCADA ANCORADA EM IMAGEM (PREVALECE sobre QUALQUER instrucao de nivel/dificuldade):',
      '   Esta estacao e construida EM TORNO de uma imagem medica REAL, ja aprovada por revisao clinica.',
      '   GABARITO DA IMAGEM (uso interno SEU — NUNCA vaza para name/caso/orientMed/impressos):',
      '   • Modalidade: ' + anchor.modality + (anchor.incidence ? ' | Incidencia/tecnica: ' + anchor.incidence : ''),
      '   • Achado real (finding_truth): ' + anchor.finding_truth,
      '   • Diagnostico real (diagnosis_truth): ' + anchor.diagnosis_truth,
      '   REGRAS DO MODO ANCORADO:',
      '   a) Construa vinheta, orientAtor, sinais vitais e exame fisico COERENTES com esse diagnostico e',
      '      com a MESMA gravidade clinica que o achado mostra — sem citar o diagnostico (o anti-vazamento',
      '      da regra 1 continua valendo integralmente).',
      '   b) IMPRESSO-ANCORA OBRIGATORIO (o UNICO impresso de exame de imagem da estacao):',
      '      • title: nome do exame (ex.: "' + anchor.modality.toUpperCase() + '")',
      '      • rows: UMA unica linha com APENAS a tecnica/incidencia (ex.: "' + buildAnchorTechLine(anchor) + '")',
      '        PROIBIDO linha "Achado:", laudo, descricao de achados ou diagnostico — a imagem e CRUA e o',
      '        candidato interpreta sozinho (a AUSENCIA do achado e o que define o tier avancado).',
      '      • images: ["' + anchor.image_file + '"] (copie o nome do arquivo EXATAMENTE)',
      '      • trigger_keywords: 4-8 formas naturais de PEDIR este exame',
      '   c) NENHUM outro impresso pode ser exame de imagem nem conter achados de imagem. Exame fisico e',
      '      laboratorio (se pertinentes) seguem BRUTOS e coerentes com o mesmo quadro.',
      '   d) complexity: "advanced". Os exemplos INEP adiante ilustram o FORMATO — o tier desta estacao e',
      '      AVANCADO ancorado, mesmo que os exemplos sejam de outro tier.',
      ''
    ];
  }

  // Bloco do sys2 (PEP) — item de interpretacao anti-Type-B, colado ao gabarito.
  function anchorSys2Block(anchor) {
    return [
      '',
      '⚠️ ITEM DE INTERPRETACAO DA IMAGEM (OBRIGATORIO — estacao AVANCADA ancorada em imagem REAL):',
      'A estacao entrega ao candidato uma imagem CRUA (so tecnica/incidencia, sem laudo). GABARITO DA',
      'IMAGEM (uso interno — o corretor cobra exatamente isto):',
      '  • achado real (finding_truth): ' + anchor.finding_truth,
      '  • diagnostico real (diagnosis_truth): ' + anchor.diagnosis_truth,
      'Crie EXATAMENTE UM item de interpretacao, com 3 niveis [0, X/2, X] (peso sugerido 1.5-2.5):',
      '  text: "Interpreta a ' + anchor.modality + ' e reconhece o achado"',
      '  crit_adeq: descreve o achado principal (resuma o finding_truth acima) E conclui pela hipotese/',
      '             diagnostico compativel',
      '  crit_parc: descreve o achado OU cita a alteracao correta sem concluir a interpretacao',
      '  crit_inad: nao interpreta ou descreve achado incompativel com a imagem',
      'PROIBICOES ABSOLUTAS neste item:',
      '  • NAO cobrar achado que NAO esta no gabarito acima (nao inventar patologia extra)',
      '  • NAO exigir medida quantitativa que a imagem nao permite (ex.: indice cardiotoracico sem regua/',
      '    calibracao, percentual de colapso, medida em cm)',
      '  • NAO criar subitem que recite dado pronto (nao ha dado pronto — a imagem e crua)',
      'PODE existir tambem um item binario de SOLICITAR o exame de imagem (desenho valido).',
      'A hipotese diagnostica premiada pelo PEP deve ser coerente com o diagnosis_truth acima.'
    ];
  }

  // Bloco do sysAudit — auditor conhece o gabarito e as regras do tier ancorado.
  function anchorSysAuditBlock(anchor) {
    return [
      'ESTACAO ANCORADA EM IMAGEM (tier AVANCADO): existe imagem REAL aprovada, entregue CRUA ao candidato.',
      'GABARITO DA IMAGEM (fonte de verdade): achado="' + anchor.finding_truth + '" | diagnostico="' + anchor.diagnosis_truth + '".',
      'Regras ADICIONAIS para esta estacao:',
      '  - Cobrar INTERPRETACAO da imagem no PEP e CORRETO e esperado (a imagem EXISTE e e a competencia',
      '    central do tier). NAO reporte "PEP cobra interpretar imagem sem laudo" — aqui isso NAO e defeito.',
      '  - HIGH: o impresso-ancora (exam com ancora=true) contem linha de achado/laudo/diagnostico nos',
      '    achados — contradiz o tier (imagem crua: apenas tecnica/incidencia).',
      '  - HIGH: item de interpretacao cobrando achado que NAO esta no gabarito acima, ou exigindo medida',
      '    quantitativa que a imagem nao permite.',
      '  - HIGH: hipotese diagnostica premiada pelo PEP incompativel com o diagnostico do gabarito.',
      '  - MEDIUM: se_perguntado_sobre_exame_fisico sem instrucao de QUANDO entregar o impresso-ancora.',
      '  - A vinheta (sinais vitais, exame fisico, labs) deve sustentar a MESMA gravidade do diagnostico do',
      '    gabarito (ex.: pneumotorax hipertensivo exige paciente instavel; achado incidental exige estavel).',
      ''
    ];
  }

  function preValidate(stObj, pepResult, dificuldade, anchor) {
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
      if (casoLow.indexOf(d) >= 0) issues.push({ severity: 'high', category: 'vazamento', message: 'caso cita diagnostico: ' + d });
    });
    ESPECIALIDADES.forEach(function (esp) {
      if (new RegExp('\\b' + esp + '\\b', 'i').test(casoLow))
        issues.push({ severity: 'high', category: 'especialista_no_caso', message: 'caso menciona especialidade "' + esp + '" — Revalida simula generalista' });
    });
    // PEP determinístico (fail-closed quando policy='reject')
    if (pepResult && pepResult.ok === false) {
      issues.push({ severity: 'high', category: 'pep_soma_invalida', message: 'PEP soma ' + pepResult.total + ' (deve ser exatamente 10,0 pontos).' });
    }
    // Item com pontuacao maxima 0 = item morto (nao pontua nada). Rede de seguranca apos o conserto do processPEP.
    clCheck.forEach(function (it, i) {
      if (it && Array.isArray(it.scores) && it.scores.length) {
        var mxIt = Math.max.apply(null, it.scores.map(function (x) { return Number(x) || 0; }));
        if (!(mxIt > 0)) issues.push({ severity: 'high', category: 'item_morto', message: 'Item "' + (it.text || ('#' + (i + 1))) + '" tem pontuacao maxima 0 — nao pontua nada. Redistribua os pontos.' });
      }
    });
    // Faixa fora do padrao INEP: so 2 (binario) ou 3 niveis. Rede de seguranca — normalizeChecklistItems
    // ja colapsa 4+/5+ para 3; se algum item chegar aqui com 4+ faixas, sinaliza (high).
    clCheck.forEach(function (it, i) {
      if (it && Array.isArray(it.scores) && it.scores.length > 3) {
        issues.push({ severity: 'high', category: 'banda_invalida', message: 'Item "' + (it.text || ('#' + (i + 1))) + '" tem ' + it.scores.length + ' faixas — padrao INEP admite apenas 2 (binario) ou 3 niveis. Colapse para [0, max/2, max].' });
      }
    });
    // Impresso sem dados (rows vazios e sem imagem) = estacao incompleta (provavel truncamento) -> reprova
    var examsArr = Array.isArray(stObj.exams) ? stObj.exams : [];
    var vazios = examsArr.filter(function (e) {
      if (!e || !(e.title || '').trim()) return false;
      var temRows = Array.isArray(e.rows) && e.rows.some(function (r) { return (r == null ? '' : String(r)).trim().length > 0; });
      var temImg = Array.isArray(e.images) && e.images.length > 0;
      return !temRows && !temImg;
    });
    if (vazios.length) {
      issues.push({ severity: 'high', category: 'impresso_vazio', message: vazios.length + ' impresso(s) sem dados: ' + vazios.map(function (e) { return e.title; }).join('; ') + '. Estacao incompleta (provavel truncamento).' });
    }
    // Vazamento de DIAGNOSTICO/INTERPRETACAO nos impressos: o candidato deve INTERPRETAR, nao receber pronto
    var LEAK_RX = /\bdiagn[o\u00f3]stic[oa]\b|\bhip[o\u00f3]tese\s+diagn|compat[i\u00ed]vel\s+com|sugest[i\u00ed]v[oa]\s+de|caracter[i\u00ed]stic[oa]\s+de|padr\w+\s+t[i\u00ed]pic|patognom|consistente\s+com|indicativ[oa]\s+de|confirma\w*\s+(o\s+)?(diagn|quadro)|\((febril|alterad[oa]?|leucocitose|leucopenia|anormal|aumentad[oa]?|diminuid[oa]?|reduzid[oa]?|elevad[oa]?|baix[oa]|alt[oa]|positiv[oa]|negativ[oa]|normal|desvio|reagente|hipertrofi)\b/i;
    var IMG_LAUDO_RX = /ultrass|ecograf|tomograf|ressonanc|ecocardiogram|doppler|mamograf|angiotomograf/i;
    examsArr.forEach(function (e) {
      var rowsTxt = Array.isArray(e.rows) ? e.rows.join(' ') : '';
      // No nivel MEDIO, o LAUDO DE IMAGEM pode trazer o diagnostico; laboratorio/fisico/raio-x seguem estritos.
      if (nivelPermiteDx(dificuldade) && IMG_LAUDO_RX.test(e.title || '')) return;
      if (rowsTxt && LEAK_RX.test(rowsTxt)) {
        issues.push({ severity: 'high', category: 'vazamento_impresso', message: 'Impresso "' + (e.title || '') + '" contem interpretacao/diagnostico nos dados (use apenas valores brutos — sem "(LEUCOCITOSE)", "Diagnostico:", "compativel com", etc).' });
      }
      var rl = rowsTxt.toLowerCase();
      DIAGNOSTICOS.forEach(function (d) { if (rl.indexOf(d) >= 0) issues.push({ severity: 'high', category: 'vazamento_impresso', message: 'Impresso "' + (e.title || '') + '" cita diagnostico: ' + d }); });
    });
    // COBERTURA DE PALAVRAS por exame (BLOQUEIA): impresso que o candidato NAO consegue solicitar some
    // da estacao na pratica (so responde a "impresso N") — exame nao exibido = falha grave de reputacao.
    // Gap REAL = poucas trigger_keywords usaveis E titulo NAO coberto por heuristica/familia do runtime.
    examsArr.forEach(function (e) {
      if (!e || !String(e.title || '').trim()) return;
      var n = usableKw(e);
      var coberto = COVERED_EXAM_RX.test(engNorm(e.title));
      if (n < 3 && !coberto) {
        issues.push({ severity: 'high', category: 'exame_sem_cobertura',
          message: 'Impresso "' + (e.title || '') + '" nao tem cobertura de palavras: ' + n + ' trigger_keyword(s) usavel(is) e o titulo nao casa com nenhum exame reconhecido pelo simulador. O candidato NAO conseguiria solicitar este exame (so via "impresso N") e ele nao apareceria. Adicione 4-8 formas naturais de pedir este exame (nome + sinonimos + regiao/modalidade).' });
      }
    });
    // ── MODO ANCORADO (avancada ancorada em imagem): redes deterministicas do tier ──
    if (anchor) {
      var ancEx = null;
      examsArr.forEach(function (e) {
        if (!ancEx && e && Array.isArray(e.images) && e.images.indexOf(anchor.image_file) >= 0) ancEx = e;
      });
      if (!ancEx) {
        issues.push({ severity: 'high', category: 'ancora_sem_imagem',
          message: 'Nenhum impresso contem a imagem-ancora "' + anchor.image_file + '". A estacao avancada ancorada exige o impresso de imagem crua com esse arquivo.' });
      } else {
        var _imgsA = ancEx.images;
        var _credsA = Array.isArray(ancEx.image_credits) ? ancEx.image_credits : [];
        if (_credsA.length !== _imgsA.length || _credsA.some(function (c) { return !c || typeof c !== 'object'; })) {
          issues.push({ severity: 'high', category: 'credito_desalinhado',
            message: 'Impresso-ancora "' + (ancEx.title || '') + '": images[] e image_credits[] devem estar alinhados por indice e sem nulos (bug conhecido de producao — nao repetir).' });
        }
        var _rowsA = Array.isArray(ancEx.rows) ? ancEx.rows : [];
        if (_rowsA.some(function (r) { return ANCHOR_ACHADO_RX.test(String(r == null ? '' : r)); })) {
          issues.push({ severity: 'high', category: 'achado_no_tier_avancado',
            message: 'Impresso-ancora "' + (ancEx.title || '') + '" contem linha de achado/laudo — contradiz o tier avancado (imagem CRUA: apenas tecnica/incidencia; a ausencia do achado e o que define o tier).' });
        }
      }
      examsArr.forEach(function (e) {
        if (!e || e === ancEx) return;
        if (ANCHOR_IMG_TITLE_RX.test(engNorm(e.title || '')) || (Array.isArray(e.images) && e.images.length)) {
          issues.push({ severity: 'high', category: 'segundo_impresso_imagem',
            message: 'Impresso "' + (e.title || '') + '" e um segundo exame de imagem — na estacao ancorada a imagem-ancora e o UNICO impresso de imagem (outro laudo/imagem entregaria o diagnostico por fora).' });
        }
      });
      var _temInterp = clCheck.some(function (it) {
        var c = (((it && it.text) || '') + ' ' + ((it && it.subitens) || '') + ' ' + ((it && it.crit_adeq) || '')).toLowerCase();
        return IMG_INTERP_RX.test(c);
      });
      if (!_temInterp) {
        issues.push({ severity: 'high', category: 'pep_sem_interpretacao',
          message: 'PEP sem item de INTERPRETACAO da imagem — numa estacao avancada ancorada, interpretar a imagem e a competencia central. Inclua o item (3 niveis) cobrando o achado do gabarito.' });
      }
    }
    return issues;
  }

  function auditPayload(stObj, anchor) {
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
        se_perguntado_sobre: (function () {
          // Conteudo (chave->valor) das respostas da personagem, com valores truncados.
          // Necessario para o auditor checar coerencia orientAtor<->PEP (fatores de risco,
          // comorbidades e contraindicacoes reveladas vs. o que o PEP premia).
          var sps = oa.se_perguntado_sobre || {};
          var out = {};
          Object.keys(sps).forEach(function (k) {
            var v = String(sps[k] == null ? '' : sps[k]);
            out[k] = v.length > 140 ? v.substring(0, 140) + '...' : v;
          });
          return out;
        })(),
        nao_falar_count: (oa.nao_falar_espontaneamente || []).length,
        regra_fundamental_presente: !!(oa.regra_fundamental && oa.regra_fundamental.length > 20)
      },
      exams: (stObj.exams || []).map(function (e) {
        var rows = Array.isArray(e.rows) ? e.rows.join(' | ') : '';
        var o = { title: e.title, achados: rows.length > 240 ? rows.substring(0, 240) + '...' : rows, tem_imagem: !!(e.images && e.images.length) };
        if (anchor) o.ancora = !!(e.images && e.images.indexOf && e.images.indexOf(anchor.image_file) >= 0);
        return o;
      }),
      checklist_resumo: (function () {
        var raw = (typeof stObj.checklist === 'string') ? stObj.checklist : JSON.stringify(stObj.checklist);
        return raw.length <= 3000 ? raw : raw.substring(0, 3000) + '...[truncado]';
      })(),
      // Gabarito da imagem (modo ancorado) — undefined some no JSON.stringify quando ausente.
      image_anchor: anchor ? { modality: anchor.modality, incidence: anchor.incidence, finding_truth: anchor.finding_truth, diagnosis_truth: anchor.diagnosis_truth } : undefined
    };
  }

  // Retorna { passed, status, score, issues }. Fail-closed em qualquer erro do auditor.
  // Exames nomeados que, se COBRADOS no PEP, devem ter dados em algum impresso.
  // rx especificos p/ minimizar falso-positivo. Severity 'warn' (nao bloqueia — pode ser resposta verbal).
  var EXAM_CHECKS = [
    { nome: 'gasometria arterial', rx: /gasometr/i },
    { nome: 'coagulograma', rx: /coagulogram|tempo de protrombina|\bttpa?\b|\binr\b/i },
    { nome: 'tipagem sanguinea', rx: /tipagem|grupo sangu[i\u00ed]neo|fator rh/i },
    { nome: 'troponina', rx: /troponin/i },
    { nome: 'D-dimero', rx: /d-?d[i\u00ed]mer/i },
    { nome: 'amilase/lipase', rx: /amilase|lipase/i },
    { nome: 'beta-HCG', rx: /beta-?hcg|b-?hcg/i },
    { nome: 'urina (EAS)', rx: /\beas\b|sum[a\u00e1]rio de urina|urin[a\u00e1]lise|parcial de urina/i },
    { nome: 'urocultura', rx: /urocultura/i },
    { nome: 'hemocultura', rx: /hemocultura/i },
    { nome: 'lactato', rx: /lactato/i }
    // Imagem (radiografia/tomografia/USG/ECG/eco) foi REMOVIDA daqui: exame de imagem em item de
    // SOLICITACAO/verbalizacao e desenho valido e nao deve gerar aviso. Imagem so vira defeito quando
    // o PEP manda INTERPRETAR e nao ha laudo — tratado por IMG_INTERP_RX (pep_imagem_sem_laudo) abaixo.
  ];
  // Termos que indicam que um IMPRESSO fornece imagem (laudo).
  var IMG_TERM_RX = /radiograf|tomograf|angiotomograf|angio-?tc|ultrass|\busg\b|ecograf|\bfast\b|doppler|mamograf|cintilograf|ressonanc|ecocardiogr|\becg\b|eletrocardiogr|\bimagem\b|\blaudo\b|incidencia/i;
  // Item de PEP que exige INTERPRETAR imagem: verbo de leitura ligado a um termo de imagem (na mesma linha).
  var IMG_INTERP_RX = /(interpreta|descreve.{0,15}achad|reconhec|identifica|analisa|evidencia|observa|leitura).{0,45}(radiograf|tomograf|ultrass|\busg\b|angio|doppler|mamograf|cintilograf|ressonanc|ecocardiogr|\becg\b|eletrocardiogr|\bimagem\b|\blaudo\b)|(radiograf|tomograf|ultrass|\busg\b|angio|doppler|mamograf|ecocardiogr|\becg\b|\bimagem\b|\blaudo\b).{0,45}(interpreta|mostra|evidencia|revela|com achado|com sinal|apresenta)/i;

  // Avisos NAO bloqueantes (portao de qualidade p/ curadoria). Nao gasta retry.
  function softWarnings(stObj) {
    var warns = [];
    var clArr = Array.isArray(stObj.checklist) ? stObj.checklist : [];
    var pepTxt = clArr.map(function (it) {
      return ((it && it.text) || '') + ' ' + ((it && it.subitens) || '') + ' ' + ((it && it.crit_adeq) || '');
    }).join(' \n ').toLowerCase();
    var examsArr = Array.isArray(stObj.exams) ? stObj.exams : [];
    var corpus = examsArr.map(function (e) {
      return ((e && e.title) || '') + ' ' + (Array.isArray(e.rows) ? e.rows.join(' ') : '');
    }).join(' \n ').toLowerCase();
    EXAM_CHECKS.forEach(function (chk) {
      if (chk.rx.test(pepTxt) && !chk.rx.test(corpus)) {
        warns.push({ severity: 'warn', category: 'pep_exame_ausente',
          message: 'PEP cobra "' + chk.nome + '" mas nenhum impresso fornece esse dado. Adicione ao impresso ou ajuste o subitem (ou confirme que e resposta verbal do chefe).' });
      }
    });
    // IMAGEM SEM LAUDO (principio: estacao SEM exame de imagem NUNCA pode cobrar INTERPRETAR imagem).
    // So avisa quando um item manda INTERPRETAR/descrever achados de imagem E nenhum impresso fornece
    // imagem. Item que apenas SOLICITA/verbaliza a imagem e desenho valido e NAO dispara (fim do ruido).
    if (!IMG_TERM_RX.test(corpus)) {
      clArr.forEach(function (it) {
        var linhas = String((it && it.subitens) || '').split('\n');
        linhas.push(String((it && it.text) || ''));
        var achou = linhas.some(function (ln) { return IMG_INTERP_RX.test(ln.toLowerCase()); });
        if (achou) {
          warns.push({ severity: 'warn', category: 'pep_imagem_sem_laudo',
            message: 'Item "' + ((it && it.text) || '') + '" pede para INTERPRETAR imagem, mas a estacao nao tem impresso de imagem. Estacao sem exame de imagem nao pode cobrar interpretacao de imagem: adicione o laudo (impresso) OU troque o subitem para apenas SOLICITAR/verbalizar a imagem.' });
        }
      });
    }
    // COBERTURA DE PALAVRAS fraca, mas titulo e exame padrao (o runtime entrega por heuristica):
    // nao bloqueia, mas avisa para adicionar trigger_keywords (robustez, e o pedido pode variar).
    examsArr.forEach(function (e) {
      if (!e || !String(e.title || '').trim()) return;
      if (usableKw(e) < 3 && COVERED_EXAM_RX.test(engNorm(e.title))) {
        warns.push({ severity: 'warn', category: 'cobertura_keywords_fraca',
          message: 'Impresso "' + (e.title || '') + '" tem poucas trigger_keywords. O titulo e um exame padrao (o simulador entrega por heuristica), mas inclua 4-8 formas naturais de pedir o exame para robustez.' });
      }
    });
    return warns;
  }

  async function audit(stObj, aiCall, modelAudit, pepResult, dificuldade, anchor, maxTokensAudit) {
    var local = preValidate(stObj, pepResult, dificuldade, anchor);
    var warnings = softWarnings(stObj);
    if (local.length > 0) return { passed: false, status: 'FAIL', score: 0, issues: local, warnings: warnings };
    var mtAudit = maxTokensAudit || 4000; // Fable 5 gasta thinking no mesmo orcamento (media 1.860); 1500 truncava
    try {
      var r = await aiCall({ model: modelAudit, max_tokens: mtAudit, system: buildSysAudit(dificuldade, anchor),
        messages: [{ role: 'user', content: 'Audite esta estacao OSCE:\n' + JSON.stringify(auditPayload(stObj, anchor), null, 2) }] });
      if (!r.ok) return { passed: false, status: 'AUDIT_ERROR', score: 0,
        issues: [{ severity: 'high', category: 'auditor_indisponivel', message: 'Auditor nao respondeu (HTTP ' + r.status + ').' }] };
      var dataAudit;
      try { dataAudit = await r.json(); }
      catch (_e0) {
        return { passed: false, status: 'AUDIT_ERROR', score: 0,
          issues: [{ severity: 'high', category: 'auditor_resposta_invalida', message: 'Auditor retornou resposta ilegivel.' }] };
      }
      // TRUNCAMENTO NA AUDITORIA (espelha trunc1/trunc2 da geracao). Checar ANTES do parseLoose:
      // o parseLoose REPARA JSON truncado (fecha chaves) — um audit cortado no meio de "issues"
      // podia parsear com status OK e issues faltando (fail-open). Truncou -> reprova SEMPRE.
      if (dataAudit && dataAudit.stop_reason === 'max_tokens') {
        return { passed: false, status: 'AUDIT_ERROR', score: 0,
          issues: [{ severity: 'high', category: 'auditor_truncado',
            message: 'Auditoria truncada por max_tokens (orcamento atual: ' + mtAudit + ') — aumente opts.maxTokensAudit.' }] };
      }
      var parsed;
      try { parsed = parseLoose(extractText(dataAudit)); }
      catch (_) {
        return { passed: false, status: 'AUDIT_ERROR', score: 0,
          issues: [{ severity: 'high', category: 'auditor_resposta_invalida', message: 'Auditor retornou resposta ilegivel.' }] };
      }
      if (!parsed || !parsed.status) return { passed: false, status: 'AUDIT_ERROR', score: 0,
        issues: [{ severity: 'high', category: 'auditor_resposta_invalida', message: 'Auditor sem campo status.' }] };
      return { passed: parsed.status === 'OK', status: parsed.status, score: parsed.score || 0, issues: parsed.issues || [], warnings: warnings };
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
    // ── Fallback de recusa (Fable 5 -> Opus 4.8) ──────────────────────────────
    // O Fable 5 pode recusar por classificador (bio/quimica/saude/cyber) devolvendo
    // stop_reason:"refusal" num HTTP 200. Aqui refazemos a MESMA chamada no modelo
    // de fallback UMA vez, de forma transparente para o resto do engine (geracao +
    // auditoria herdam, pois o aiCall embrulhado e passado adiante).
    var modelFallback = opts.modelFallback || 'claude-opus-4-8';
    var onFallback = typeof opts.onFallback === 'function' ? opts.onFallback : function () {};
    aiCall = (function (rawAiCall) {
      function shim(ok, status, data, extra) {
        return Object.assign({ ok: ok, status: status, json: function () { return Promise.resolve(data); } }, extra || {});
      }
      function _emptyContent(d) {
        return !d || !Array.isArray(d.content) ||
          !d.content.some(function (b) { return b && b.type === 'text' && b.text && String(b.text).trim(); });
      }
      return async function (params) {
        var resp = await rawAiCall(params);
        if (!resp || !resp.ok) return resp;               // erro HTTP/transporte: engine ja trata !ok
        var data;
        try { data = await resp.json(); }
        catch (e) { return shim(false, (resp && resp.status) || 0, null); }
        var m = params && params.model;
        var _refusal = data && data.stop_reason === 'refusal';
        var _vazio = _emptyContent(data);   // recusa "silenciosa" / geracao vazia -> tambem cai pro fallback
        if (m && m !== modelFallback && (_refusal || _vazio)) {
          try { onFallback({ from: m, to: modelFallback, reason: _refusal ? 'refusal' : 'empty', response: data }); } catch (_e) {}
          var resp2 = await rawAiCall(Object.assign({}, params, { model: modelFallback }));
          if (!resp2 || !resp2.ok) return resp2;
          var data2;
          try { data2 = await resp2.json(); }
          catch (e2) { return shim(false, (resp2 && resp2.status) || 0, null); }
          return shim(true, (resp2 && resp2.status) || 200, data2, { _fellBack: true, _fallbackFrom: m });
        }
        return shim(true, (resp && resp.status) || 200, data);
      };
    })(aiCall);
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    var modelGen = opts.modelGen || 'claude-opus-4-8';
    var modelAudit = opts.modelAudit || 'claude-opus-4-8';
    var pepPolicy = opts.pepPolicy || 'normalize';
    // ── MODO AVANCADA ANCORADA: valida a ancora (fail-fast ANTES da Call 1) ──
    var anchor = normalizeAnchor(opts.imageAnchor); // null se ausente; Error se incompleta
    // Ancorado => impressos ESTRITOS (sem a exce\u00e7\u00e3o de laudo-com-dx do nivel medio),
    // prevalecendo sobre qualquer rubrica de dificuldade que o wrapper injete via extra.
    var difUse = anchor ? 'Avan\u00e7ado' : (opts.dificuldade || opts.nivel || '');

    // ── Call 1: caso base ──
    onProgress(1);
    // Diversidade: sorteia area (se vazia) e eixo tematico (se tema vazio) p/ evitar convergir no mesmo caso.
    // MODO ANCORADO: NUNCA sorteia — area vem da ancora/opts e o tema E a imagem aprovada
    // (um eixo sorteado poderia contradizer o gabarito, ex.: eixo "cefaleia" com RX de pneumotorax).
    var areaUse = opts.area || (anchor && anchor.area) || '';
    if (!areaUse) {
      if (anchor) throw new Error('Modo ancorado: informe a area (opts.area ou imageAnchor.area).');
      var _aks = Object.keys(TEMA_EIXOS); areaUse = _aks[Math.floor(Math.random() * _aks.length)];
    }
    var temaUse = (opts.tema || '').trim();
    var temaSorteado = false;
    if (!temaUse && !anchor) {
      var _eixos = TEMA_EIXOS[areaUse] || [];
      if (_eixos.length) { temaUse = _eixos[Math.floor(Math.random() * _eixos.length)]; temaSorteado = true; }
    }
    var sys1 = buildSys1(areaUse, opts.nivel, opts.fewShotExamples, difUse, anchor);
    var temaClause;
    if (anchor) {
      temaClause = 'MODO AVANCADA ANCORADA: construa o caso EM TORNO da imagem ja aprovada (gabarito interno no sistema) — NAO invente tema desconexo do gabarito. '
        + (temaUse ? 'Contexto/tema sugerido: ' + temaUse + '. ' : '');
    } else if (temaUse) {
      temaClause = (temaSorteado
          ? 'Eixo tematico sorteado (use como PONTO DE PARTIDA e crie um caso ORIGINAL e ESPECIFICO dentro dele, com perfil de paciente variado — idade, paridade, contexto): '
          : 'Tema-alvo (sugestao): ') + temaUse + '. ';
    } else {
      temaClause = 'Escolha tema relevante para Revalida. ';
    }
    var msg1 = 'Crie uma NOVA estacao OSCE no padrao INEP. Area: ' + areaUse + '. '
      + temaClause
      + 'Nivel: ' + (opts.nivel || 'medium') + '. '
      + (opts.extra ? 'Instrucoes extras: ' + opts.extra + '. ' : '')
      + 'Responda APENAS o JSON, no formato dos exemplos. NAO copie os exemplos — crie estacao original e DIFERENTE dos exemplos.';
    var r1 = await aiCall({ model: modelGen, max_tokens: 16000, system: sys1, messages: [{ role: 'user', content: msg1 }] });
    if (!r1.ok) throw new Error('HTTP ' + r1.status + ' na geracao do caso (Call 1).');
    var data1 = await r1.json();
    var trunc1 = !!(data1 && data1.stop_reason === 'max_tokens');
    var _txt1 = extractText(data1);
    if (!_txt1 || !String(_txt1).trim()) throw new Error('Modelo retornou conteudo vazio na Call 1 (possivel recusa). Tente outro modelo ou ajuste o tema.');
    var base = parseLoose(_txt1);
    // MODO ANCORADO: reescrita deterministica do impresso-ancora (o tier depende disso).
    if (anchor) base = enforceAnchorImpresso(base, anchor);

    // ── Call 2: PEP ──
    onProgress(2);
    var oa = base.orientAtor || {};
    var resumo = JSON.stringify({
      name: base.name, area: base.area, caso: (base.caso || '').substring(0, 300),
      orientMed: base.orientMed,
      orientAtor_resumo: (typeof oa === 'object') ? Object.keys(oa.se_perguntado_sobre || {}).slice(0, 15).join(', ') : '',
      exams: (base.exams || []).map(function (e) { return { title: e.title || e.name, rows: Array.isArray(e.rows) ? e.rows : [] }; })
    });
    var r2 = await aiCall({ model: modelGen, max_tokens: 8000, system: buildSys2(anchor),
      messages: [{ role: 'user', content: 'Estacao: ' + resumo + '. Gere o PEP completo (10 pts total). Responda APENAS o array JSON dos itens.' }] });
    if (!r2.ok) throw new Error('HTTP ' + r2.status + ' na geracao do PEP (Call 2).');
    var data2 = await r2.json();
    var trunc2 = !!(data2 && data2.stop_reason === 'max_tokens');
    var pepRaw = parseLoose(extractText(data2));
    var clArr = normalizeChecklistItems(extractChecklistArray(pepRaw));

    // ── PEP: política do wrapper ──
    var pep = processPEP(clArr, pepPolicy);

    // sanitizar complexity (ancorado: SEMPRE advanced — e a definicao do modo)
    var compFromAI = (base.complexity || '').toLowerCase().trim();
    var complexity = anchor ? 'advanced' : ((['medium', 'advanced'].indexOf(compFromAI) >= 0) ? compFromAI : 'medium');

    var station = Object.assign({}, base, { checklist: pep.checklist, complexity: complexity });
    // Avancada ancorada NUNCA e estacao demo do trial (protecao de IP do acervo).
    if (anchor) station.trial_available = false;

    // ── Auditoria (fail-closed) ──
    onProgress(3);
    var auditResult = await audit(station, aiCall, modelAudit, pep, difUse, anchor, opts.maxTokensAudit);

    // ── Truncamento (max_tokens) força reprovacao -> retry no wrapper ──
    if (trunc1 || trunc2) {
      var truncIssues = [];
      if (trunc1) truncIssues.push({ severity: 'high', category: 'truncamento', message: 'Geracao do caso (Call 1) truncada por max_tokens — estacao incompleta (impressos podem vir sem dados).' });
      if (trunc2) truncIssues.push({ severity: 'high', category: 'truncamento', message: 'Geracao do PEP (Call 2) truncada por max_tokens.' });
      auditResult = { passed: false, status: 'TRUNCATED', score: 0, issues: truncIssues.concat(auditResult.issues || []) };
    }

    onProgress(4);
    // imageAnchor no retorno: o wrapper pode exibir o gabarito p/ o gate 2 da Angelica
    // (comparar item de interpretacao vs. finding_truth). undefined quando nao ancorado.
    return { station: station, audit: auditResult, imageAnchor: anchor || undefined };
  }

  global.StationEngine = {
    ENGINE_VERSION: ENGINE_VERSION,
    generate: generate,
    buildSys1: buildSys1, buildSys2: buildSys2, buildSysAudit: buildSysAudit,
    processPEP: processPEP, preValidate: preValidate, softWarnings: softWarnings, audit: audit, parseLoose: parseLoose,
    extractChecklistArray: extractChecklistArray, normalizeChecklistItems: normalizeChecklistItems,
    extractText: extractText, pepTotal: pepTotal,
    normalizeAnchor: normalizeAnchor, enforceAnchorImpresso: enforceAnchorImpresso
  };
})(typeof window !== 'undefined' ? window : this);
