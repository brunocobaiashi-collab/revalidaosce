// Teste da política de privacidade: §12 aponta o cartão Privacidade e cookies em Minha conta (18/11/2026). Sem rede.
// Rodar a partir da raiz:  node ci/test-politica-cookies-minha-conta.mjs [arquivo]   (saída 1 = falhou)
//
// Prova: a frase nova aparece uma vez, a antiga ("no menu do simulador") nenhuma vez,
// a âncora #cookies existe uma vez e contém a frase nova. Reprova contra a main anterior.
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

const NOVA = 'Para mudar a escolha a qualquer momento, use o link <strong>Preferências de cookies</strong> no rodapé das páginas ou, no simulador, o cartão <strong>Privacidade e cookies</strong> em <strong>Minha conta</strong>.';
confere(conta(NOVA) === 1, 'frase nova aparece uma vez', 'encontrada ' + conta(NOVA) + 'x');
confere(conta('no menu do simulador') === 0, 'frase antiga (no menu do simulador) não aparece', 'encontrada ' + conta('no menu do simulador') + 'x');

const doc = new JSDOM(html).window.document;
const cookies = doc.querySelectorAll('#cookies');
confere(cookies.length === 1, 'âncora #cookies existe uma vez');
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ') : '');
confere(cookies.length === 1 && txt(cookies[0]).includes('no simulador, o cartão Privacidade e cookies em Minha conta.'), 'frase nova dentro de #cookies, num item de lista');

console.log(`\n   ${ok} OK / ${falhas} FALHA`);
process.exit(falhas ? 1 : 0);
