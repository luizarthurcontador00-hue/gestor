'use strict';

/**
 * Agregador do dashboard: mantem a mesma API publica que
 * `require('../services/dashboardService')` ja tinha (nada muda para quem
 * consome — a resolucao de modulo do Node encontra este index.js
 * automaticamente), so que a implementacao agora esta dividida por assunto
 * nos arquivos deste diretorio.
 */

const { vendasPorPeriodo, maisVendidos, margemPorCategoria, margemPeriodo, curvaABC } = require('./vendas');
const { pagarVsReceber, resumoGeral } = require('./resumo');
const { painelProfessor } = require('./painelProfessor');
const { painelInstituto } = require('./painelInstituto');
const { centralAtencao } = require('./centralAtencao');

module.exports = {
  vendasPorPeriodo,
  maisVendidos,
  margemPorCategoria,
  margemPeriodo,
  curvaABC,
  pagarVsReceber,
  resumoGeral,
  centralAtencao,
  painelProfessor,
  painelInstituto,
};
