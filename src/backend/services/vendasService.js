'use strict';

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { registrarMovimentacao } = require('./estoqueService');
const { arred } = require('./precificacaoService');

const FORMAS = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'prazo'];

/** Busca rapida de produto para a venda/PDV (codigo de barras exato ou nome). */
function buscarProduto(termo) {
  const db = getDb();
  if (!termo) return [];
  const t = String(termo).trim();
  // Codigo de barras exato tem prioridade (leitor USB).
  const exato = db.prepare('SELECT * FROM produtos WHERE codigo_barras = ? AND ativo = 1').get(t);
  if (exato) return [exato];
  return db.prepare(
    'SELECT * FROM produtos WHERE ativo = 1 AND (nome LIKE ? OR codigo_barras LIKE ?) ORDER BY nome COLLATE NOCASE LIMIT 20'
  ).all(`%${t}%`, `%${t}%`);
}

/**
 * Cria uma venda.
 * dados = {
 *   itens: [{ produto_id, quantidade, preco_unitario?, desconto_item? }],
 *   desconto?: number,            // desconto geral (R$)
 *   pagamentos: [{ forma_pagamento, valor }],
 *   caixa_id?: number,            // se nao vier, usa o caixa aberto (se houver)
 *   observacao?, vencimento_prazo?: 'YYYY-MM-DD'
 * }
 */
function criarVenda(dados) {
  const db = getDb();
  if (!dados || !Array.isArray(dados.itens) || !dados.itens.length) {
    throw new AppError('Adicione ao menos um item para concluir a venda.');
  }
  const pagamentos = Array.isArray(dados.pagamentos) ? dados.pagamentos : [];
  if (!pagamentos.length) throw new AppError('Informe ao menos uma forma de pagamento.');
  for (const p of pagamentos) {
    if (!FORMAS.includes(p.forma_pagamento)) throw new AppError('Forma de pagamento invalida: ' + p.forma_pagamento);
    if (!(Number(p.valor) > 0)) throw new AppError('O valor de cada pagamento deve ser maior que zero.');
  }

  // Carrega produtos e calcula valores.
  const itensCalc = dados.itens.map((it) => {
    const prod = db.prepare('SELECT * FROM produtos WHERE id = ?').get(it.produto_id);
    if (!prod) throw new AppError('Produto do carrinho nao encontrado (id ' + it.produto_id + ').', 404);
    const qtd = Number(it.quantidade);
    if (!(qtd > 0)) throw new AppError(`Quantidade invalida para "${prod.nome}".`);
    const preco = it.preco_unitario != null && it.preco_unitario !== '' ? Number(it.preco_unitario) : Number(prod.preco_venda);
    const descItem = Number(it.desconto_item || 0);
    const totalItem = arred(qtd * preco - descItem);
    return { prod, qtd, preco, descItem, totalItem, custo: Number(prod.custo || 0) };
  });

  const bruto = arred(itensCalc.reduce((s, i) => s + i.qtd * i.preco, 0));
  const descItens = arred(itensCalc.reduce((s, i) => s + i.descItem, 0));
  const descGeral = Number(dados.desconto || 0);
  const total = arred(bruto - descItens - descGeral);
  if (total < 0) throw new AppError('O desconto nao pode ser maior que o valor da venda.');

  // Separa dinheiro das demais formas. O troco (dinheiro entregue alem do
  // necessario) NAO entra no caixa: registramos apenas a parte aplicada.
  const outras = pagamentos.filter((p) => p.forma_pagamento !== 'dinheiro');
  const dinheiro = pagamentos.filter((p) => p.forma_pagamento === 'dinheiro');
  const totalOutras = arred(outras.reduce((s, p) => s + Number(p.valor), 0));
  if (totalOutras > total + 0.001) {
    throw new AppError('A soma dos pagamentos (exceto dinheiro) excede o valor da venda.');
  }
  const dinheiroNecessario = arred(total - totalOutras);
  const dinheiroEntregue = arred(dinheiro.reduce((s, p) => s + Number(p.valor), 0));
  if (dinheiroEntregue + 0.001 < dinheiroNecessario) {
    throw new AppError(`Pagamento insuficiente. Faltam ${(dinheiroNecessario - dinheiroEntregue).toFixed(2)}.`);
  }
  const troco = arred(dinheiroEntregue - dinheiroNecessario);

  // Pagamentos que serao efetivamente gravados (dinheiro consolidado no valor aplicado).
  const pagamentosGravar = outras.map((p) => ({ forma_pagamento: p.forma_pagamento, valor: arred(Number(p.valor)) }));
  if (dinheiroNecessario > 0) {
    pagamentosGravar.push({ forma_pagamento: 'dinheiro', valor: dinheiroNecessario });
  }

  // Caixa: usa o informado ou o caixa aberto atual (se houver).
  let caixa_id = dados.caixa_id || null;
  if (!caixa_id) {
    const aberto = db.prepare("SELECT id FROM caixa WHERE status = 'aberto' ORDER BY id DESC LIMIT 1").get();
    if (aberto) caixa_id = aberto.id;
  }

  const tx = db.transaction(() => {
    const vendaInfo = db.prepare(
      `INSERT INTO vendas (valor_bruto, desconto, valor_total, status, caixa_id, cliente_id, observacao)
       VALUES (?, ?, ?, 'concluida', ?, ?, ?)`
    ).run(bruto, arred(descItens + descGeral), total, caixa_id, dados.cliente_id || null, dados.observacao || null);
    const venda_id = vendaInfo.lastInsertRowid;

    const insItem = db.prepare(
      `INSERT INTO vendas_itens
        (venda_id, produto_id, descricao, quantidade, preco_unitario, custo_unitario, desconto_item, valor_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const i of itensCalc) {
      insItem.run(venda_id, i.prod.id, i.prod.nome, i.qtd, i.preco, i.custo, i.descItem, i.totalItem);

      if (i.prod.eh_servico) {
        // Servico: nao movimenta estoque (nao ha mercadoria).
        // (a receita/CMV entram no financeiro/DRE normalmente)
      } else if (i.prod.eh_kit) {
        // Kit: nao tem estoque proprio - baixa os componentes que o compoem.
        const componentes = db.prepare('SELECT * FROM produtos_composicao WHERE produto_kit_id = ?').all(i.prod.id);
        for (const comp of componentes) {
          const componente = db.prepare('SELECT custo FROM produtos WHERE id = ?').get(comp.produto_componente_id);
          registrarMovimentacao(db, {
            produto_id: comp.produto_componente_id,
            tipo: 'saida',
            quantidade: arred(Number(comp.quantidade) * i.qtd),
            custo_unitario: componente ? Number(componente.custo) : null,
            origem: 'venda',
            referencia_id: venda_id,
            observacao: `Componente do kit "${i.prod.nome}" - venda #${venda_id}`,
          });
        }
      } else {
        registrarMovimentacao(db, {
          produto_id: i.prod.id,
          tipo: 'saida',
          quantidade: i.qtd,
          custo_unitario: i.custo,
          origem: 'venda',
          referencia_id: venda_id,
          observacao: 'Venda #' + venda_id,
        });
      }
    }

    // eslint-disable-next-line global-require
    const fin = require('./financeiroService');
    const insPag = db.prepare('INSERT INTO vendas_pagamentos (venda_id, forma_pagamento, valor) VALUES (?, ?, ?)');
    let totalVista = 0;
    const formasVista = [];
    let contaVista = null;
    for (const p of pagamentosGravar) {
      insPag.run(venda_id, p.forma_pagamento, Number(p.valor));
      if (p.forma_pagamento === 'prazo') {
        // Venda a prazo gera conta a receber pendente (recebe depois).
        db.prepare(
          `INSERT INTO contas_receber (venda_id, cliente_id, descricao, valor, parcela, total_parcelas, vencimento, status, tipo)
           VALUES (?, ?, ?, ?, 1, 1, ?, 'pendente', 'normal')`
        ).run(venda_id, dados.cliente_id || null, 'Venda #' + venda_id + ' (a prazo)', Number(p.valor), dados.vencimento_prazo || null);
      } else {
        // Venda a vista: alimenta o saldo da conta financeira mapeada.
        totalVista = arred(totalVista + Number(p.valor));
        formasVista.push(p.forma_pagamento);
        const contaId = fin.contaDaForma(db, p.forma_pagamento);
        if (contaId && contaVista == null) contaVista = contaId;
        fin.lancarMovimentoConta(db, {
          conta_id: contaId, tipo: 'entrada', valor: p.valor, origem: 'venda',
          referencia_id: venda_id, descricao: `Venda #${venda_id} (${p.forma_pagamento})`,
        });
      }
    }

    // Registra a parte a vista em Contas a Receber ja como "recebida"
    // (tipo venda_vista: nao conta de novo no fluxo de caixa).
    if (totalVista > 0) {
      const formaResumo = formasVista.length === 1 ? formasVista[0] : 'diversos';
      db.prepare(
        `INSERT INTO contas_receber (venda_id, cliente_id, descricao, valor, parcela, total_parcelas,
           vencimento, status, tipo, forma_recebimento, data_recebimento, conta_financeira_id)
         VALUES (?, ?, ?, ?, 1, 1, date('now','localtime'), 'recebido', 'venda_vista', ?, date('now','localtime'), ?)`
      ).run(venda_id, dados.cliente_id || null, 'Venda #' + venda_id, totalVista, formaResumo, contaVista);
    }

    return venda_id;
  });

  const venda = obterVenda(tx());
  venda.troco = troco;
  return venda;
}

/**
 * Reverte exatamente as movimentacoes geradas na venda (cobre produtos
 * simples e componentes de kits, sem depender da composicao atual do kit —
 * que pode ter mudado desde a venda) e os efeitos no financeiro. Usado
 * tanto no cancelamento quanto na exclusao (que cancela antes de apagar).
 */
function reverterEfeitos(db, id) {
  const movs = db.prepare(
    "SELECT * FROM movimentacoes_estoque WHERE referencia_id = ? AND origem = 'venda' AND tipo = 'saida'"
  ).all(id);
  for (const m of movs) {
    registrarMovimentacao(db, {
      produto_id: m.produto_id,
      tipo: 'entrada',
      quantidade: m.quantidade,
      custo_unitario: m.custo_unitario,
      origem: 'estorno',
      referencia_id: id,
      observacao: 'Estorno da venda #' + id,
    });
  }
  db.prepare("DELETE FROM contas_financeiras_mov WHERE origem = 'venda' AND referencia_id = ?").run(id);
  db.prepare("UPDATE contas_receber SET status = 'cancelada' WHERE venda_id = ? AND status IN ('pendente','recebido')").run(id);
}

function cancelarVenda(id, motivo) {
  const db = getDb();
  const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(id);
  if (!venda) throw new AppError('Venda nao encontrada.', 404);
  if (venda.status === 'cancelada') throw new AppError('Esta venda ja esta cancelada.');

  const tx = db.transaction(() => {
    reverterEfeitos(db, id);
    db.prepare("UPDATE vendas SET status = 'cancelada', observacao = COALESCE(observacao,'') || ? WHERE id = ?")
      .run(motivo ? ` | Cancelada: ${motivo}` : ' | Cancelada', id);
  });
  tx();
  return obterVenda(id);
}

/**
 * Apaga a venda de vez — pensado para limpar venda de teste (ex.: quem
 * testou o PDV antes de decidir usar o modo instituto, que nao usa venda).
 * Se ainda estiver concluida, reverte estoque e financeiro antes de apagar
 * (mesma logica do cancelamento); o resto (itens, pagamentos, devolucoes,
 * vinculo com contas a receber e notas) e resolvido pelas chaves
 * estrangeiras (ON DELETE CASCADE/SET NULL).
 */
function excluirVenda(id) {
  const db = getDb();
  const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(id);
  if (!venda) throw new AppError('Venda nao encontrada.', 404);

  const tx = db.transaction(() => {
    if (venda.status !== 'cancelada') reverterEfeitos(db, id);
    db.prepare('DELETE FROM vendas WHERE id = ?').run(id);
  });
  tx();
}

function obterVenda(id) {
  const db = getDb();
  const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(id);
  if (!venda) throw new AppError('Venda nao encontrada.', 404);
  venda.itens = db.prepare(`
    SELECT vi.*, p.eh_servico
    FROM vendas_itens vi LEFT JOIN produtos p ON p.id = vi.produto_id
    WHERE vi.venda_id = ? ORDER BY vi.id
  `).all(id);
  venda.pagamentos = db.prepare('SELECT * FROM vendas_pagamentos WHERE venda_id = ?').all(id);
  return venda;
}

function listarVendas({ inicio, fim, forma_pagamento, produto_id, status } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (inicio) { where.push('date(v.data) >= date(@inicio)'); params.inicio = inicio; }
  if (fim) { where.push('date(v.data) <= date(@fim)'); params.fim = fim; }
  if (status) { where.push('v.status = @status'); params.status = status; }
  if (forma_pagamento) {
    where.push('EXISTS (SELECT 1 FROM vendas_pagamentos vp WHERE vp.venda_id = v.id AND vp.forma_pagamento = @forma)');
    params.forma = forma_pagamento;
  }
  if (produto_id) {
    where.push('EXISTS (SELECT 1 FROM vendas_itens vi WHERE vi.venda_id = v.id AND vi.produto_id = @produto)');
    params.produto = Number(produto_id);
  }
  const sql = `
    SELECT v.*,
      (SELECT GROUP_CONCAT(forma_pagamento, ', ') FROM vendas_pagamentos vp WHERE vp.venda_id = v.id) AS formas,
      (SELECT COUNT(*) FROM vendas_itens vi WHERE vi.venda_id = v.id) AS total_itens
    FROM vendas v
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY v.id DESC LIMIT 500`;
  return db.prepare(sql).all(params);
}

/**
 * Corrige itens de venda antigos que saíram com custo zerado (produto sem
 * custo cadastrado na hora da venda) e hoje já têm custo no cadastro.
 *
 * vendas_itens.custo_unitario é um retrato do custo no momento da venda —
 * do jeito certo para não deixar uma correção de custo de hoje mudar a
 * margem de vendas antigas por baixo dos panos. Mas quando esse retrato
 * nasceu vazio por falta de cadastro (não porque o produto custava zero de
 * verdade), o DRE fica com o CMV/CSP menor do que deveria até alguém
 * lembrar de arrumar manualmente. Este botão faz essa arrumação de uma vez.
 */
function sincronizarCustoVendas() {
  const db = getDb();
  const info = db.prepare(`
    UPDATE vendas_itens
    SET custo_unitario = (SELECT p.custo FROM produtos p WHERE p.id = vendas_itens.produto_id)
    WHERE (custo_unitario IS NULL OR custo_unitario = 0)
      AND produto_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM produtos p WHERE p.id = vendas_itens.produto_id AND p.custo > 0)
  `).run();
  return { itens_atualizados: info.changes };
}

module.exports = {
  FORMAS,
  buscarProduto,
  sincronizarCustoVendas,
  criarVenda,
  cancelarVenda,
  excluirVenda,
  obterVenda,
  listarVendas,
};
