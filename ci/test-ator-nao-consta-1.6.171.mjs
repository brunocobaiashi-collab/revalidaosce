// Teste do prompt do ator (v1.6.171): "Nao consta." para dado ausente, sem etiqueta "X: nao consta"
// e sem trocar por negativa. Sem chamada de IA: confere so o TEXTO do prompt montado pelo mesmo
// caminho do app (parsePatient, parseActorInstructions, buildActorSystem), em jsdom.
// Rodar a partir da raiz: node ci/test-ator-nao-consta-1.6.171.mjs   (saida 1 = falhou)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { carregarMontador } from './lib/ator-prompt.mjs';

let ok = 0, falhas = 0;
function confere(cond, nome, extra) {
  if (cond) { ok++; console.log('   ok    ' + nome); }
  else { falhas++; console.log('   FALHA ' + nome + (extra ? '  ::  ' + extra : '')); }
}

// Estacao simulada: adulta, com nome e idade, SEM profissao e SEM estado civil.
const ADULTA = {
  id: 'ci-171', name: 'Estacao de teste', area: 'Clinica Medica',
  pNome: 'Maria', pIdade: '32', pGenero: 'feminino',
  orientAtor: {
    fala_inicial_espontanea: 'Doutora, estou com dor para urinar.',
    se_perguntado_sobre: { febre: 'Nao, febre nao.', antecedentes_pessoais: 'Nao tenho doenca nenhuma que eu saiba.' },
  },
  exams: [{ title: 'EXAME FISICO', rows: ['PA 120x80 mmHg'], images: [] }],
};
// Pediatrica: so confirma que o caminho do acompanhante monta sem erro e com as mesmas regras.
const PEDIATRICA = {
  id: 'ci-171-ped', name: 'Estacao pediatrica de teste', area: 'Pediatria',
  pNome: 'Joao', pIdade: '4', acompNome: 'Maria', acompRelacao: 'mae',
  orientAtor: { se_perguntado_sobre: { febre: 'Teve febre ontem.' } },
  exams: [{ title: 'EXAME FISICO', rows: ['FC 110 bpm'], images: [] }],
};

// Linhas que o prompt apresenta como resposta CERTA: "CORRETO:" e "Resposta:".
function respostasCorretas(prompt) {
  const saida = [];
  for (const linha of prompt.split('\n')) {
    const m = linha.match(/\b(CORRETO|Resposta)\s*:\s*(.*)$/);
    if (m) saida.push(m[2]);
  }
  return saida;
}
const ETIQUETA = /\w+:\s*nao consta/i;

function conferirNovo(prompt, rotulo) {
  const corretas = respostasCorretas(prompt);
  confere(corretas.length >= 5, `${rotulo}: prompt traz os exemplos CORRETO/Resposta (${corretas.length})`);
  const comEtiqueta = corretas.filter((r) => ETIQUETA.test(r));
  confere(comEtiqueta.length === 0, `${rotulo}: nenhum exemplo CORRETO/Resposta com etiqueta "X: nao consta"`, comEtiqueta.join(' || '));
  confere(!corretas.some((r) => /Profissao:\s*nao consta/i.test(r)), `${rotulo}: nenhum exemplo CORRETO com "Profissao: nao consta"`);
  confere(!/NAO SENTE/.test(prompt), `${rotulo}: sem "NAO SENTE"`);
  confere(/NUNCA troque por negativa/.test(prompt), `${rotulo}: regra de nao trocar "Nao consta." por negativa`);
  confere(/O resto nao consta/.test(prompt), `${rotulo}: exemplo "O resto nao consta"`);
  confere(/NUNCA use etiqueta "X: nao consta"/.test(prompt), `${rotulo}: proibicao explicita da etiqueta`);
  confere(/Se NENHUM dos itens perguntados esta nos seus dados, a resposta e so "Nao consta\."/.test(prompt), `${rotulo}: nenhum item presente -> so "Nao consta."`);
  confere(/PRECEDENCIA DO ROTEIRO/.test(prompt) && /MESMO assunto/.test(prompt), `${rotulo}: precedencia do roteiro com limite de assunto`);
  confere(!/so vale para a pergunta de identificacao/.test(prompt), `${rotulo}: sem a excecao da etiquetagem item a item`);
  confere(!/responda EXATAMENTE "Nao consta\." e NADA mais/.test(prompt), `${rotulo}: sem "EXATAMENTE ... e NADA mais" na regra 1`);
  // O que nao muda
  confere(/"Chefe de estacao: Nao consta\." NUNCA invente um impresso inexistente/.test(prompt), `${rotulo}: regra do Chefe para impresso inexistente intacta`);
  confere(/NUNCA invente valores plausiveis/.test(prompt), `${rotulo}: proibicao de inventar dado pessoal intacta`);
  confere(/TERMINANTEMENTE PROIBIDO inventar qualquer dado nao listado/.test(prompt), `${rotulo}: proibicao de inventar na pergunta composta intacta`);
  confere(/NUNCA preencha a lacuna com sintomas inventados/.test(prompt), `${rotulo}: anti-alucinacao de sintomas intacta`);
  confere(/NUNCA invente dados plausiveis para preencher lacunas/.test(prompt), `${rotulo}: anti-alucinacao geral intacta`);
}

console.log('\n── Teste · prompt do ator 1.6.171 (Nao consta.) ' + '─'.repeat(12));

const novo = await carregarMontador(fs.readFileSync('simulador/index.html', 'utf8'));
const pAdulta = novo.montar(ADULTA);
conferirNovo(pAdulta, 'adulta');
confere(/- Nome: Maria/.test(pAdulta) && /- Idade: 32 anos/.test(pAdulta), 'adulta: nome e idade nos DADOS DA PERSONAGEM');
confere(!/- Profissao:/.test(pAdulta) && !/- Estado civil:/.test(pAdulta), 'adulta: profissao e estado civil ausentes dos DADOS (estacao sem esses campos)');
confere(/Nao tenho doenca nenhuma que eu saiba/.test(pAdulta), 'adulta: fala do roteiro chega ao prompt');
const pPed = novo.montar(PEDIATRICA);
conferirNovo(pPed, 'pediatrica');
confere(/VOCE INTERPRETA O ACOMPANHANTE/.test(pPed), 'pediatrica: caminho do acompanhante');

// Precedencia com sinonimo (replay de 15/11, caso Benedito).
confere(/Antes de responder "Nao consta\.", procure nos seus dados qualquer resposta sobre o assunto perguntado, mesmo com outras palavras/.test(pAdulta)
  && /"pressao alta" responde "tem doenca cardiovascular\?"/.test(pAdulta), 'adulta: procurar resposta do mesmo assunto com outras palavras');

// renderReply: ramo do paciente acentua "nao consta" na tela e na voz, na bolha PACIENTE.
function conferirFala(reply, esperado, rotulo) {
  const r = novo.renderReply(ADULTA, reply);
  const tela = r.msgs.map((m) => m.type + '|' + m.text), voz = r.falas.map((f) => f.who + '|' + f.text);
  confere(tela.length === 1 && tela[0] === 'actor|' + esperado && voz.length === 1 && voz[0] === 'actor|' + esperado,
    `renderReply: ${rotulo}`, JSON.stringify(r));
}
conferirFala('Paciente: Nao consta.', 'N\u00e3o consta.', '"Paciente: Nao consta." -> "Nao consta." acentuado, bolha PACIENTE');
conferirFala('Paciente: Febre n\u00e3o tive. O resto nao consta.', 'Febre n\u00e3o tive. O resto n\u00e3o consta.', 'mista: "O resto nao consta." acentuado, bolha PACIENTE');
conferirFala('Febre n\u00e3o tive. O resto nao consta.', 'Febre n\u00e3o tive. O resto n\u00e3o consta.', 'mista sem prefixo: acentuada, bolha PACIENTE');
conferirFala('Paciente: Tenho pressao alta.', 'Tenho pressao alta.', 'fala sem "nao consta" sai igual');
conferirFala('Paciente: N\u00e3o consta.', 'N\u00e3o consta.', 'ja acentuado continua igual');
// Ramo do Chefe: intocado (continua normalizando como na 1.6.170).
const rc = novo.renderReply(ADULTA, 'Chefe de estacao: Nao consta.');
confere(rc.msgs.length === 1 && rc.msgs[0].type === 'chief' && rc.msgs[0].text === 'N\u00e3o consta.' && rc.falas[0].who === 'chief',
  'renderReply: Chefe "Nao consta." continua no Chefe', JSON.stringify(rc));
const rp = novo.renderReply(ADULTA, 'Nao consta.');
confere(rp.msgs.length === 1 && rp.msgs[0].type === 'chief' && rp.msgs[0].text === 'N\u00e3o consta.',
  'renderReply: resposta pura "Nao consta." continua com o Chefe (muda so na 1.6.172)', JSON.stringify(rp));
for (const e of novo.erros) { falhas++; console.log('   FALHA excecao em runtime (novo): ' + e); }
novo.fechar();

// Sanidade: o prompt da origin/main (1.6.170) tem os defeitos que o teste procura.
// Se nao houver origin/main nesta copia, o passo e pulado (avisado).
let antigoHtml = null;
try { antigoHtml = execFileSync('git', ['show', 'origin/main:simulador/index.html'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
catch { console.log('   aviso origin/main indisponivel: sanidade contra o prompt antigo pulada'); }
if (antigoHtml && !/<meta name="app-version" content="1\.6\.171"/.test(antigoHtml) && /NAO SENTE/.test(antigoHtml)) {
  const antigo = await carregarMontador(antigoHtml);
  const pa = antigo.montar(ADULTA);
  confere(respostasCorretas(pa).some((r) => ETIQUETA.test(r)) && /NAO SENTE/.test(pa),
    'sanidade: o teste reprova o prompt antigo (etiqueta no CORRETO e "NAO SENTE")');
  antigo.fechar();
}

console.log(`\n   ${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
