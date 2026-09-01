'use strict';

/** Kits/combos: composicao (itens que formam o kit) e recalculo do custo. */

const { getDb } = require('../../db/connection');
const { AppError } = require('../../utils/errors');
const { arred } = require('../precificacaoService');
const { obter } = require('./core');

/** Lista os itens que compoem um kit. */
function obterComposicao(kitId) {
  const db = getDb();
  obter(kitId); // garante existencia
  return db.prepare(`
    SELECT pc.id, pc.produto_componente_id, pc.quantidade,
           p.nome, p.custo, p.unidade
    FROM produtos_composicao pc
    JOIN produtos p ON p.id = pc.produto_componente_id
    WHERE pc.produto_kit_id = ?
    ORDER BY p.nome COLLATE NOCASE
  `).all(kitId);
}

/**
 * Substitui a lista de componentes de um kit e recalcula o custo do kit como
 * a soma (custo do componente x quantidade), mantendo o custo sempre coerente.
 */
function salvarComposicao(kitId, itens) {
  const db = getDb();
  obter(kitId);
  const lista = Array.isArray(itens) ? itens : [];
  if (!lista.length) throw new AppError('Adicione ao menos um produto para compor o kit.');

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM produtos_composicao WHERE produto_kit_id = ?').run(kitId);
    const ins = db.prepare(
      'INSERT INTO produtos_composicao (produto_kit_id, produto_componente_id, quantidade) VALUES (?, ?, ?)'
    );
    let custoTotal = 0;
    for (const item of lista) {
      const componenteId = Number(item.produto_componente_id);
      if (componenteId === Number(kitId)) {
        throw new AppError('Um kit nao pode conter a si mesmo como componente.');
      }
      const qtd = Number(item.quantidade);
      if (!(qtd > 0)) throw new AppError('A quantidade de cada item do kit deve ser maior que zero.');
      const componente = db.prepare('SELECT custo FROM produtos WHERE id = ?').get(componenteId);
      if (!componente) throw new AppError('Um dos produtos selecionados para o kit nao foi encontrado.');
      ins.run(kitId, componenteId, qtd);
      custoTotal += Number(componente.custo) * qtd;
    }
    db.prepare("UPDATE produtos SET eh_kit = 1, custo = ?, atualizado_em = datetime('now','localtime') WHERE id = ?")
      .run(arred(custoTotal), kitId);
  });
  tx();
  return obterComposicao(kitId);
}

module.exports = { obterComposicao, salvarComposicao };
