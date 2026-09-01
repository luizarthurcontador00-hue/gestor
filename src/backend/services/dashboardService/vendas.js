'use strict';

/**
 * Analises de venda: series por periodo, ranking, margem e curva ABC.
 * `intervalo()` e reaproveitado pelos outros modulos do dashboard que
 * tambem recebem { inicio, fim } opcionais.
 */

const { getDb } = require('../../db/connection');
const { arred } = require('../precificacaoService');

function intervalo({ inicio, fim } = {}) {
  return { ini: inicio || '0000-01-01', f: fim || '9999-12-31' };
}

/** Vendas agrupadas por dia ou mes. */
function vendasPorPeriodo({ inicio, fim, agrupamento } = {}) {
  const db = getDb();
  const { ini, f } = intervalo({ inicio, fim });
  const fmt = agrupamento === 'mes' ? '%Y-%m' : '%Y-%m-%d';
  return db.prepare(`
    SELECT strftime('${fmt}', data) AS periodo,
           COALESCE(SUM(valor_total),0) AS total, COUNT(*) AS qtd
    FROM vendas
    WHERE status='concluida' AND date(data) BETWEEN date(?) AND date(?)
    GROUP BY periodo ORDER BY periodo
  `).all(ini, f);
}

/** Ranking de produtos mais vendidos. */
function maisVendidos({ inicio, fim, limite = 10, por = 'quantidade' } = {}) {
  const db = getDb();
  const { ini, f } = intervalo({ inicio, fim });
  const ordem = por === 'faturamento' ? 'total' : 'quantidade';
  return db.prepare(`
    SELECT vi.produto_id AS id,
           COALESCE(p.nome, vi.descricao) AS nome,
           COALESCE(SUM(vi.quantidade),0) AS quantidade,
           COALESCE(SUM(vi.valor_total),0) AS total
    FROM vendas_itens vi
    JOIN vendas v ON v.id = vi.venda_id
    LEFT JOIN produtos p ON p.id = vi.produto_id
    WHERE v.status='concluida' AND date(v.data) BETWEEN date(?) AND date(?)
    GROUP BY vi.produto_id
    ORDER BY ${ordem} DESC
    LIMIT ?
  `).all(ini, f, Number(limite));
}

/** Margem de lucro por categoria no periodo. */
function margemPorCategoria({ inicio, fim } = {}) {
  const db = getDb();
  const { ini, f } = intervalo({ inicio, fim });
  const linhas = db.prepare(`
    SELECT COALESCE(c.nome, 'Sem categoria') AS categoria,
           COALESCE(SUM(vi.valor_total),0) AS receita,
           COALESCE(SUM(vi.custo_unitario * vi.quantidade),0) AS custo
    FROM vendas_itens vi
    JOIN vendas v ON v.id = vi.venda_id
    LEFT JOIN produtos p ON p.id = vi.produto_id
    LEFT JOIN categorias c ON c.id = p.categoria_id
    WHERE v.status='concluida' AND date(v.data) BETWEEN date(?) AND date(?)
    GROUP BY c.id ORDER BY receita DESC
  `).all(ini, f);
  return linhas.map((l) => ({
    categoria: l.categoria,
    receita: arred(l.receita),
    custo: arred(l.custo),
    lucro: arred(l.receita - l.custo),
    margem: l.receita > 0 ? arred(((l.receita - l.custo) / l.receita) * 100) : 0,
  }));
}

/** Margem/lucro consolidado do periodo. */
function margemPeriodo({ inicio, fim } = {}) {
  const db = getDb();
  const { ini, f } = intervalo({ inicio, fim });
  const r = db.prepare(`
    SELECT COALESCE(SUM(vi.valor_total),0) AS receita,
           COALESCE(SUM(vi.custo_unitario * vi.quantidade),0) AS custo
    FROM vendas_itens vi JOIN vendas v ON v.id = vi.venda_id
    WHERE v.status='concluida' AND date(v.data) BETWEEN date(?) AND date(?)
  `).get(ini, f);
  return {
    receita: arred(r.receita), custo: arred(r.custo), lucro: arred(r.receita - r.custo),
    margem: r.receita > 0 ? arred(((r.receita - r.custo) / r.receita) * 100) : 0,
  };
}

/** Curva ABC de produtos por faturamento. */
function curvaABC({ inicio, fim } = {}) {
  const db = getDb();
  const { ini, f } = intervalo({ inicio, fim });
  const produtos = db.prepare(`
    SELECT vi.produto_id AS id, COALESCE(p.nome, vi.descricao) AS nome,
           COALESCE(SUM(vi.valor_total),0) AS faturamento,
           COALESCE(SUM(vi.quantidade),0) AS quantidade
    FROM vendas_itens vi
    JOIN vendas v ON v.id = vi.venda_id
    LEFT JOIN produtos p ON p.id = vi.produto_id
    WHERE v.status='concluida' AND date(v.data) BETWEEN date(?) AND date(?)
    GROUP BY vi.produto_id
    HAVING faturamento > 0
    ORDER BY faturamento DESC
  `).all(ini, f);

  const totalGeral = produtos.reduce((s, p) => s + Number(p.faturamento), 0);
  let acumulado = 0;
  return {
    total: arred(totalGeral),
    itens: produtos.map((p) => {
      acumulado += Number(p.faturamento);
      const percAcum = totalGeral > 0 ? (acumulado / totalGeral) * 100 : 0;
      const classe = percAcum <= 80 ? 'A' : percAcum <= 95 ? 'B' : 'C';
      return {
        id: p.id, nome: p.nome, faturamento: arred(p.faturamento), quantidade: arred(p.quantidade),
        perc: totalGeral > 0 ? arred((p.faturamento / totalGeral) * 100) : 0,
        perc_acumulado: arred(percAcum), classe,
      };
    }),
  };
}

module.exports = { intervalo, vendasPorPeriodo, maisVendidos, margemPorCategoria, margemPeriodo, curvaABC };
