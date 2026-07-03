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
       onFallback,                      // ({from,to,response}) => void  (observabilidade do fallback)
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
  // Nivel MEDIO (Intermediario) permite achados + interpretacao/diagnostico nos impressos
  // (o candidato CONDUZ, nao diagnostica). Facil/Dificil seguem estritos (dados brutos).
  function nivelPermiteDx(n) { return /intermedi|m[\u00e9e]dio|medium/i.test(n || ''); }

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
      (nivelPermiteDx(nivel)
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
      '   • Cada exam: title claro, trigger_keywords array com 4-8 strings de 3+ chars',
      '     (NUNCA "rx"/"tc"/"us"/"pa" — use "raio x"/"tomografia"/"ultrassom"/"pressao arterial").',
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
      '⚠️ labels DEVE ter o MESMO numero de itens que scores (mesmas faixas). Se scores tem 4 numeros, labels tem 4 rotulos (ex: ["Inadequado","Insuficiente","Parcialmente adequado","Adequado"]). NUNCA 4 scores com 3 labels.',
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
    ].join(NL);
  }

  // sysAudit — auditor IA. Canônico: Simulador (anti-falso-positivo, anti-over-rigor).
  function buildSysAudit(nivel) {
    return [
      'Voce e auditor clinico do INEP/Revalida que valida estacoes OSCE.',
      'Sua tarefa: analisar a estacao e identificar APENAS problemas REAIS e CLAROS.',
      'NAO invente problemas. NAO seja over-rigoroso. Reporte so o que e DEFEITO OBJETIVO.',
      (nivelPermiteDx(nivel)
        ? 'NIVEL MEDIO: o LAUDO DE IMAGEM (US/TC/RM/eco/doppler/mamografia) PODE/DEVE conter achados + diagnostico ("compativel com..."). Laboratorio, exame fisico e raio-x seguem BRUTOS. So reporte vazamento se o dx aparecer em laboratorio/fisico/raio-x — NUNCA por dx no laudo de imagem.'
        : 'Impressos com dados brutos; a imagem (se houver) traz SO achados, sem diagnostico. Reporte VAZAMENTO se entregarem interpretacao/diagnostico pronto (inclusive laudo de imagem citando o dx no nivel dificil).'),
      '',
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
      var labels = labelsForBands(scores.length, it.labels);
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

  function preValidate(stObj, pepResult, nivel) {
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
      if (nivelPermiteDx(nivel) && IMG_LAUDO_RX.test(e.title || '')) return;
      if (rowsTxt && LEAK_RX.test(rowsTxt)) {
        issues.push({ severity: 'high', category: 'vazamento_impresso', message: 'Impresso "' + (e.title || '') + '" contem interpretacao/diagnostico nos dados (use apenas valores brutos — sem "(LEUCOCITOSE)", "Diagnostico:", "compativel com", etc).' });
      }
      var rl = rowsTxt.toLowerCase();
      DIAGNOSTICOS.forEach(function (d) { if (rl.indexOf(d) >= 0) issues.push({ severity: 'high', category: 'vazamento_impresso', message: 'Impresso "' + (e.title || '') + '" cita diagnostico: ' + d }); });
    });
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
        return { title: e.title, achados: rows.length > 240 ? rows.substring(0, 240) + '...' : rows, tem_imagem: !!(e.images && e.images.length) };
      }),
      checklist_resumo: (function () {
        var raw = (typeof stObj.checklist === 'string') ? stObj.checklist : JSON.stringify(stObj.checklist);
        return raw.length <= 3000 ? raw : raw.substring(0, 3000) + '...[truncado]';
      })()
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
    { nome: 'lactato', rx: /lactato/i },
    { nome: 'radiografia', rx: /radiografia|raio-?x/i },
    { nome: 'tomografia', rx: /tomografi/i },
    { nome: 'ultrassom/FAST', rx: /ultrassom|ultrassonografi|ecografi|\bfast\b/i },
    { nome: 'eletrocardiograma', rx: /eletrocardiogram|\becg\b/i },
    { nome: 'ecocardiograma', rx: /ecocardiogram/i }
  ];

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
    return warns;
  }

  async function audit(stObj, aiCall, modelAudit, pepResult, nivel) {
    var local = preValidate(stObj, pepResult, nivel);
    var warnings = softWarnings(stObj);
    if (local.length > 0) return { passed: false, status: 'FAIL', score: 0, issues: local, warnings: warnings };
    try {
      var r = await aiCall({ model: modelAudit, max_tokens: 1500, system: buildSysAudit(nivel),
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
      return async function (params) {
        var resp = await rawAiCall(params);
        if (!resp || !resp.ok) return resp;               // erro HTTP/transporte: engine ja trata !ok
        var data;
        try { data = await resp.json(); }
        catch (e) { return shim(false, (resp && resp.status) || 0, null); }
        var m = params && params.model;
        if (data && data.stop_reason === 'refusal' && m && m !== modelFallback) {
          try { onFallback({ from: m, to: modelFallback, response: data }); } catch (_e) {}
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

    // ── Call 1: caso base ──
    onProgress(1);
    // Diversidade: sorteia area (se vazia) e eixo tematico (se tema vazio) p/ evitar convergir no mesmo caso
    var areaUse = opts.area || '';
    if (!areaUse) { var _aks = Object.keys(TEMA_EIXOS); areaUse = _aks[Math.floor(Math.random() * _aks.length)]; }
    var temaUse = (opts.tema || '').trim();
    var temaSorteado = false;
    if (!temaUse) {
      var _eixos = TEMA_EIXOS[areaUse] || [];
      if (_eixos.length) { temaUse = _eixos[Math.floor(Math.random() * _eixos.length)]; temaSorteado = true; }
    }
    var sys1 = buildSys1(areaUse, opts.nivel, opts.fewShotExamples);
    var msg1 = 'Crie uma NOVA estacao OSCE no padrao INEP. Area: ' + areaUse + '. '
      + (temaUse
          ? (temaSorteado
              ? 'Eixo tematico sorteado (use como PONTO DE PARTIDA e crie um caso ORIGINAL e ESPECIFICO dentro dele, com perfil de paciente variado — idade, paridade, contexto): '
              : 'Tema-alvo (sugestao): ') + temaUse + '. '
          : 'Escolha tema relevante para Revalida. ')
      + 'Nivel: ' + (opts.nivel || 'medium') + '. '
      + (opts.extra ? 'Instrucoes extras: ' + opts.extra + '. ' : '')
      + 'Responda APENAS o JSON, no formato dos exemplos. NAO copie os exemplos — crie estacao original e DIFERENTE dos exemplos.';
    var r1 = await aiCall({ model: modelGen, max_tokens: 16000, system: sys1, messages: [{ role: 'user', content: msg1 }] });
    if (!r1.ok) throw new Error('HTTP ' + r1.status + ' na geracao do caso (Call 1).');
    var data1 = await r1.json();
    var trunc1 = !!(data1 && data1.stop_reason === 'max_tokens');
    var base = parseLoose(extractText(data1));

    // ── Call 2: PEP ──
    onProgress(2);
    var oa = base.orientAtor || {};
    var resumo = JSON.stringify({
      name: base.name, area: base.area, caso: (base.caso || '').substring(0, 300),
      orientMed: base.orientMed,
      orientAtor_resumo: (typeof oa === 'object') ? Object.keys(oa.se_perguntado_sobre || {}).slice(0, 15).join(', ') : '',
      exams: (base.exams || []).map(function (e) { return { title: e.title || e.name, rows: Array.isArray(e.rows) ? e.rows : [] }; })
    });
    var r2 = await aiCall({ model: modelGen, max_tokens: 8000, system: buildSys2(),
      messages: [{ role: 'user', content: 'Estacao: ' + resumo + '. Gere o PEP completo (10 pts total). Responda APENAS o array JSON dos itens.' }] });
    if (!r2.ok) throw new Error('HTTP ' + r2.status + ' na geracao do PEP (Call 2).');
    var data2 = await r2.json();
    var trunc2 = !!(data2 && data2.stop_reason === 'max_tokens');
    var pepRaw = parseLoose(extractText(data2));
    var clArr = normalizeChecklistItems(extractChecklistArray(pepRaw));

    // ── PEP: política do wrapper ──
    var pep = processPEP(clArr, pepPolicy);

    // sanitizar complexity
    var compFromAI = (base.complexity || '').toLowerCase().trim();
    var complexity = (['medium', 'advanced'].indexOf(compFromAI) >= 0) ? compFromAI : 'medium';

    var station = Object.assign({}, base, { checklist: pep.checklist, complexity: complexity });

    // ── Auditoria (fail-closed) ──
    onProgress(3);
    var auditResult = await audit(station, aiCall, modelAudit, pep, opts.nivel);

    // ── Truncamento (max_tokens) força reprovacao -> retry no wrapper ──
    if (trunc1 || trunc2) {
      var truncIssues = [];
      if (trunc1) truncIssues.push({ severity: 'high', category: 'truncamento', message: 'Geracao do caso (Call 1) truncada por max_tokens — estacao incompleta (impressos podem vir sem dados).' });
      if (trunc2) truncIssues.push({ severity: 'high', category: 'truncamento', message: 'Geracao do PEP (Call 2) truncada por max_tokens.' });
      auditResult = { passed: false, status: 'TRUNCATED', score: 0, issues: truncIssues.concat(auditResult.issues || []) };
    }

    onProgress(4);
    return { station: station, audit: auditResult };
  }

  global.StationEngine = {
    generate: generate,
    buildSys1: buildSys1, buildSys2: buildSys2, buildSysAudit: buildSysAudit,
    processPEP: processPEP, preValidate: preValidate, softWarnings: softWarnings, audit: audit, parseLoose: parseLoose,
    extractChecklistArray: extractChecklistArray, normalizeChecklistItems: normalizeChecklistItems,
    extractText: extractText, pepTotal: pepTotal
  };
})(typeof window !== 'undefined' ? window : this);
