// Teste da política de privacidade: origem do anúncio por usuário (18/11/2026). Sem rede.
// Rodar a partir da raiz:  node ci/test-politica-origem-anuncio.mjs [arquivo]   (saída 1 = falhou)
//
// Prova: os cinco trechos novos (§2.4, §4, §6, §7, §12) estão na página uma vez só cada,
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

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
