// Teste da política de privacidade: origem do anúncio por usuário (18/11/2026). Sem rede.
// Rodar a partir da raiz:  node ci/test-politica-origem-anuncio.mjs [arquivo]   (saída 1 = falhou)
//
// Prova: os cinco trechos novos (§2.4, §4, §6, §7, §12) e o item da §5 (adendo) estão na página uma vez só cada,
// a data da atualização é 18/11/2026, a âncora #cookies existe uma vez e o HTML monta
// num DOM com as tabelas e listas editadas no lugar certo.
// Requer jsdom:  npm install --no-save jsdom
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const ARQ = process.argv[2] || 'politica-privacidade.html';
const html = fs.readFileSync(ARQ, 'utf8').normalize('NFC');
let ok = 0, falhas = 0;
function confere(cond, nome, extra) {
  if (cond) { ok++; console.log('   ok    ' + nome); }
  else { falhas++; console.log('   FALHA ' + nome + (extra ? '  ::  ' + extra : '')); }
}
const conta = (t) => html.split(t.normalize('NFC')).length - 1;

const TRECHOS = [
  ['§2.4 origem do anúncio', 'se você aceitou os cookies de mensuração e se cadastrou depois de clicar em um anúncio nosso, guardamos na sua conta o identificador do clique'],
  ['§4 finalidade', 'Saber de qual anúncio veio cada cadastro e cada assinatura, para avaliar e decidir investimentos em publicidade'],
  ['§6 plataforma de pagamento', 'o link de assinatura leva para essa plataforma o identificador do clique do anúncio e a campanha, o grupo e a palavra-chave'],
  ['§7 retenção', 'Origem do anúncio ligada à sua conta'],
  ['§12 cookie de origem', 'e, se você criar uma conta, para registrá-la nela (veja a seção 2.4)'],
  ['§12 origem na conta e no link', 'Origem na sua conta e no link de assinatura'],
  ['§12 recusar depois de aceitar', 'e a origem do anúncio registrada na sua conta. Se você tinha aceitado em outro aparelho'],
];
for (const [nome, t] of TRECHOS) {
  const n = conta(t);
  confere(n === 1, nome + ' aparece uma vez', 'encontrado ' + n + 'x');
}
confere(conta('Última atualização: <strong>18 de novembro de 2026</strong>') === 1, 'data 18/11/2026');

const doc = new JSDOM(html).window.document;
const cookies = doc.querySelectorAll('#cookies');
confere(cookies.length === 1, 'âncora #cookies existe uma vez');
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ') : '');
confere(cookies.length === 1 && txt(cookies[0]).includes('Origem na sua conta e no link de assinatura'), '§12 dentro de #cookies');

const linhas4 = [...doc.querySelectorAll('table.data-table tr')].map(txt);
const i4 = linhas4.findIndex((l) => l.includes('Saber de qual anúncio veio'));
const iMk = linhas4.findIndex((l) => l.includes('Eventual envio de comunicações de marketing'));
confere(i4 >= 0 && iMk === i4 + 1, '§4 linha nova antes da de marketing');
confere(i4 >= 0 && doc.querySelectorAll('table.data-table tr')[i4].querySelectorAll('td').length === 2, '§4 linha com 2 colunas');
const tr7 = [...doc.querySelectorAll('table.data-table tr')].find((tr) => txt(tr).includes('Origem do anúncio ligada à sua conta'));
confere(tr7 && tr7.querySelectorAll('td').length === 2 && txt(tr7).includes('(até 5 anos)'), '§7 linha com 2 colunas');
const li24 = [...doc.querySelectorAll('li')].find((li) => txt(li).startsWith('Origem do anúncio (só com o seu consentimento):'));
confere(li24 && li24.querySelectorAll('code').length === 3, '§2.4 item com gclid, gbraid e wbraid');

// Adendo: §5 ganha o item de medição de anúncios (contradizia o "exclusivamente").
const ITEM5 = 'Medir de qual anúncio veio cada cadastro e cada assinatura, só se você aceitar os cookies de mensuração e publicidade (seção 12).';
confere(conta(ITEM5) === 1, '§5 item de medição aparece uma vez', 'encontrado ' + conta(ITEM5) + 'x');
const h5 = [...doc.querySelectorAll('h2')].find((h) => txt(h).startsWith('5. Como usamos'));
const bloco5 = h5 && h5.parentElement;
const ul5 = bloco5 && bloco5.querySelector('ul');
const itens5 = ul5 ? [...ul5.querySelectorAll('li')].map(txt) : [];
confere(itens5.length > 0 && itens5[itens5.length - 1] === ITEM5, '§5 item é o último da lista da §5');
const depois5 = ul5 && ul5.nextElementSibling;
confere(depois5 && depois5.tagName === 'P' && txt(depois5).startsWith('Não usamos seus dados para publicidade direcionada por terceiros'), '§5 parágrafo "Não usamos seus dados" segue a lista');

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
