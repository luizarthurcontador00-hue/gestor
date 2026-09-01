'use strict';

/**
 * Agregador de produtos: mantem a mesma API publica que
 * `require('../services/produtosService')` ja tinha (nada muda para quem
 * consome), so que a implementacao agora esta dividida por assunto nos
 * arquivos deste diretorio (core, fotos, codigoBarras, kits, lote).
 */

const core = require('./core');
const fotos = require('./fotos');
const codigoBarras = require('./codigoBarras');
const kits = require('./kits');
const lote = require('./lote');

module.exports = {
  listar: core.listar,
  obter: core.obter,
  movimentacoes: core.movimentacoes,
  criar: core.criar,
  atualizar: core.atualizar,
  ajustarEstoque: core.ajustarEstoque,
  conferenciaEstoque: core.conferenciaEstoque,
  excluir: core.excluir,
  excluirLote: core.excluirLote,
  editarLote: core.editarLote,

  listarFotos: fotos.listarFotos,
  adicionarFotos: fotos.adicionarFotos,
  definirFotoPrincipal: fotos.definirFotoPrincipal,
  removerFoto: fotos.removerFoto,

  garantirCodigoBarras: codigoBarras.garantirCodigoBarras,
  prepararEtiquetas: codigoBarras.prepararEtiquetas,

  obterComposicao: kits.obterComposicao,
  salvarComposicao: kits.salvarComposicao,

  criarLote: lote.criarLote,
  codigoAutoLigado: lote.codigoAutoLigado,
};
