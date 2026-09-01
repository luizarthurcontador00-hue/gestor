'use strict';

/** Codigo de barras EAN-13 (verificador, geracao interna) e etiquetas. */

const { getDb } = require('../../db/connection');
const { AppError } = require('../../utils/errors');
const { obter } = require('./core');

/** Digito verificador padrao EAN-13 a partir dos 12 primeiros digitos. */
function ean13DigitoVerificador(doze) {
  let soma = 0;
  for (let i = 0; i < 12; i++) {
    soma += Number(doze[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

/**
 * Gera um codigo EAN-13 interno e unico para o produto, usando o prefixo
 * 20-29 (faixa reservada pelo GS1 para uso interno/circulacao restrita,
 * convencao comum em varejo para itens sem codigo de fabrica).
 */
function gerarCodigoInterno(id) {
  const doze = '20' + String(id).padStart(10, '0');
  return doze + ean13DigitoVerificador(doze);
}

/**
 * Garante que o produto tenha um codigo de barras EAN-13 valido (13 digitos)
 * para impressao de etiqueta. Se ja tiver um codigo de 13 digitos, usa-o sem
 * alterar. Caso contrario, gera um codigo interno e SALVA no cadastro, para
 * que a etiqueta impressa sempre corresponda ao que o PDV reconhece.
 */
function garantirCodigoBarras(id) {
  const db = getDb();
  const p = obter(id);
  const digitos = (p.codigo_barras || '').replace(/\D/g, '');
  if (digitos.length === 13) return digitos;
  const novo = gerarCodigoInterno(id);
  db.prepare("UPDATE produtos SET codigo_barras = ?, atualizado_em = datetime('now','localtime') WHERE id = ?")
    .run(novo, id);
  return novo;
}

/** Prepara os dados de uma lista de produtos para impressao de etiquetas. */
function prepararEtiquetas(ids) {
  if (!Array.isArray(ids) || !ids.length) {
    throw new AppError('Selecione ao menos um produto para gerar etiquetas.');
  }
  return ids.map((id) => {
    const codigo_barras = garantirCodigoBarras(id);
    const p = obter(id);
    return { id: p.id, nome: p.nome, preco_venda: p.preco_venda, codigo_barras };
  });
}

module.exports = { ean13DigitoVerificador, gerarCodigoInterno, garantirCodigoBarras, prepararEtiquetas };
