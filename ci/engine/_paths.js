// Resolve os caminhos dos arquivos usados pelas suítes do gerador.
//
//   ENGINE=<arquivo>          engine sob teste (padrão: simulador/station-engine.js do repositório)
//   EXPECT_VERSION=<x.y.z>    versão esperada na asserção de ENGINE_VERSION
//                             (o portão 6 passa a versão declarada no próprio arquivo)
//   BASE_PRE, BASE_1_1_0, BASE_1_2_0, BASE_1_4_0, BASE_1_4_2   troca uma baseline (padrão: ./baselines)
//
// As baselines são cópias exatas do station-engine.js em commits da main:
//   pre-1.1.0 = d0e4f62 · 1.1.0 = 90cc0f8 · 1.2.0 = 3ace155 · 1.4.0 = c7c3f5b · 1.4.2 = d904515
const path = require('path');

exports.ENGINE = process.env.ENGINE ||
  path.join(__dirname, '..', '..', 'simulador', 'station-engine.js');

exports.base = function (v) {
  const key = 'BASE_' + (v === 'pre-1.1.0' ? 'PRE' : v.replace(/\./g, '_'));
  return process.env[key] || path.join(__dirname, 'baselines', 'station-engine.' + v + '.js');
};

exports.expect = function (padrao) { return process.env.EXPECT_VERSION || padrao; };
