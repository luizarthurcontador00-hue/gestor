'use strict';

/**
 * Data de hoje no formato YYYY-MM-DD, no fuso local da maquina. Reaproveitado
 * no lugar de `new Date().toISOString().slice(0, 10)` reimplementado em cada
 * servico (esse padrao usa UTC, nao o fuso local — mantido igual ao que ja
 * rodava, so centralizado).
 */
function hoje() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { hoje };
