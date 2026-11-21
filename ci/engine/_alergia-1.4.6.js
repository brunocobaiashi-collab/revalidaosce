// Trecho que a 1.4.6 acrescentou ao buildSys1 (regra 3, lista "Cobrir"), decisão do Bruno de 16/11.
// Usado por test-impresso-fora-do-nivel.js (g) e test-alergia-roteiro.js: remove EXATAMENTE este
// trecho e o resto do prompt tem de sair idêntico, byte a byte, à baseline 1.4.5.
const LISTA_NOVA = '     medicacoes, alergias, habitos (fumo/alcool), e topicos especificos do caso.\n';
const LISTA_ANTIGA = '     medicacoes, habitos (fumo/alcool), e topicos especificos do caso.\n';
const BLOCO = [
  '     • Chave "alergias" OBRIGATORIA, com resposta coerente com o caso:',
  '       - Se a conduta esperada prescreve um farmaco, a resposta NAO pode contradize-la.',
  '         Padrao: "Nao tenho alergia a remedio."',
  '       - Se o caso DEPENDE de uma alergia (ex: alergia a penicilina que muda o antibiotico),',
  '         a resposta declara a alergia E o PEP paga por pergunta-la OU por escolher a alternativa.',
  '       - Pediatria/acompanhante (regra 4): quem responde e o acompanhante, sobre a crianca',
  '         (ex: "Ele nao tem alergia a remedio.").',
  ''
].join('\n');
const TRECHO_NOVO = LISTA_NOVA + BLOCO;

function ocorrencias(s, sub) { let n = 0, i = -1; while ((i = s.indexOf(sub, i + 1)) >= 0) n++; return n; }

// Devolve o prompt sem o trecho da 1.4.6, ou null se o trecho não estiver lá exatamente uma vez.
exports.semTrechoAlergia = function (prompt) {
  if (ocorrencias(prompt, TRECHO_NOVO) !== 1) return null;
  return prompt.replace(TRECHO_NOVO, LISTA_ANTIGA);
};
exports.TRECHO_NOVO = TRECHO_NOVO;
