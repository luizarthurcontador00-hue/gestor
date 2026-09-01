'use strict';

/**
 * CRUD de produto, estoque (ajuste/conferencia/movimentacoes) e o helper de
 * data/hora usado nos rotulos de lote. E o modulo "central": fotos.js,
 * codigoBarras.js, kits.js e lote.js dependem de `obter`/`criar` daqui.
 */

const fs = require('fs');
const path = require('path');
const { getDb } = require('../../db/connection');
const { AppError } = require('../../utils/errors');
const { registrarMovimentacao } = require('../estoqueService');
const { precoPorMarkup, markupEfetivo } = require('../precificacaoService');
const paths = require('../../paths');

const SELECT_BASE = `
  SELECT p.*, c.nome AS categoria_nome, f.nome AS fornecedor_nome
  FROM produtos p
  LEFT JOIN categorias c ON c.id = p.categoria_id
  LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
`;

function listar({ busca, categoria_id, fornecedor_id, estoque_baixo, incluir_inativos, eh_servico } = {}) {
  const db = getDb();
  const where = [];
  const params = {};

  // Por padrao lista produtos (eh_servico=0); a pagina de Servicos passa eh_servico=1.
  if (eh_servico === '1' || eh_servico === 1 || eh_servico === true) where.push('p.eh_servico = 1');
  else where.push('p.eh_servico = 0');

  if (!incluir_inativos) where.push('p.ativo = 1');
  if (busca) {
    where.push('(p.nome LIKE @busca OR p.codigo_barras LIKE @busca OR p.descricao LIKE @busca)');
    params.busca = `%${busca}%`;
  }
  if (categoria_id) {
    where.push('p.categoria_id = @categoria_id');
    params.categoria_id = Number(categoria_id);
  }
  if (fornecedor_id) {
    where.push('p.fornecedor_id = @fornecedor_id');
    params.fornecedor_id = Number(fornecedor_id);
  }
  if (estoque_baixo === true || estoque_baixo === 'true' || estoque_baixo === '1') {
    where.push('p.estoque_atual <= p.estoque_minimo');
  }

  const sql = SELECT_BASE +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY p.nome COLLATE NOCASE';
  return db.prepare(sql).all(params);
}

function obter(id) {
  const db = getDb();
  const prod = db.prepare(SELECT_BASE + ' WHERE p.id = ?').get(id);
  if (!prod) throw new AppError('Produto nao encontrado.', 404);
  // eslint-disable-next-line global-require
  prod.fotos = require('./fotos').listarFotos(id);
  return prod;
}

function movimentacoes(id, limite = 100) {
  const db = getDb();
  obter(id); // garante existencia
  return db
    .prepare(
      `SELECT * FROM movimentacoes_estoque
       WHERE produto_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(id, limite);
}

function normalizar(dados) {
  const custo = Number(dados.custo || 0);
  let preco_venda = dados.preco_venda != null && dados.preco_venda !== ''
    ? Number(dados.preco_venda)
    : null;

  // Se nao informaram preco:
  //  - em importacoes (_semPrecoAuto), fica 0: o preco sera definido na
  //    Precificacao (regra: produto importado passa pela precificacao primeiro);
  //  - caso contrario, calcula pelo markup (produto/categoria/global).
  if (preco_venda == null) {
    if (dados._semPrecoAuto) {
      preco_venda = 0;
    } else {
      const markup = markupEfetivo({ markupProduto: dados.markup, categoriaId: dados.categoria_id });
      preco_venda = precoPorMarkup(custo, markup);
    }
  }

  const ehServico = (dados.eh_servico === true || dados.eh_servico === 1 || dados.eh_servico === '1' || dados.eh_servico === 'on') ? 1 : 0;

  return {
    nome: (dados.nome || '').trim(),
    descricao: dados.descricao || null,
    codigo_barras: dados.codigo_barras ? String(dados.codigo_barras).trim() : null,
    categoria_id: dados.categoria_id ? Number(dados.categoria_id) : null,
    fornecedor_id: dados.fornecedor_id ? Number(dados.fornecedor_id) : null,
    unidade: ehServico ? 'SERV' : (dados.unidade || 'UN').trim().toUpperCase(),
    custo,
    markup: dados.markup != null && dados.markup !== '' ? Number(dados.markup) : null,
    preco_venda,
    estoque_minimo: ehServico ? 0 : Number(dados.estoque_minimo || 0),
    // Aceita boolean real (lote) ou string vinda de formulario ('1'/'on'/'0'/'false').
    eh_kit: (dados.eh_kit === true || dados.eh_kit === '1' || dados.eh_kit === 'on') ? 1 : 0,
    eh_servico: ehServico,
    duracao_min: dados.duracao_min != null && dados.duracao_min !== '' ? Number(dados.duracao_min) : null,
    grupo_variacao: dados.grupo_variacao ? String(dados.grupo_variacao).trim() || null : null,
    variacao: dados.variacao ? String(dados.variacao).trim() || null : null,
    ncm: dados.ncm ? String(dados.ncm).replace(/\D/g, '') || null : null,
    cfop: dados.cfop ? String(dados.cfop).replace(/\D/g, '') || null : null,
    cst_csosn: dados.cst_csosn ? String(dados.cst_csosn).trim() || null : null,
    origem_mercadoria: dados.origem_mercadoria != null && dados.origem_mercadoria !== '' ? Number(dados.origem_mercadoria) : 0,
  };
}

function criar(dados) {
  const db = getDb();
  const d = normalizar(dados);
  if (!d.nome) throw new AppError('O nome do produto e obrigatorio.');

  // Kits e servicos nao tem estoque proprio.
  const estoqueInicial = (d.eh_kit || d.eh_servico) ? 0 : Number(dados.estoque_atual || 0);

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO produtos
          (nome, descricao, codigo_barras, categoria_id, fornecedor_id, unidade,
           custo, markup, preco_venda, estoque_atual, estoque_minimo, foto_path,
           eh_kit, eh_servico, duracao_min, grupo_variacao, variacao,
           ncm, cfop, cst_csosn, origem_mercadoria)
         VALUES
          (@nome, @descricao, @codigo_barras, @categoria_id, @fornecedor_id, @unidade,
           @custo, @markup, @preco_venda, 0, @estoque_minimo, @foto_path,
           @eh_kit, @eh_servico, @duracao_min, @grupo_variacao, @variacao,
           @ncm, @cfop, @cst_csosn, @origem_mercadoria)`
      )
      .run({ ...d, foto_path: dados.foto_path || null });

    const id = info.lastInsertRowid;
    if (estoqueInicial > 0) {
      registrarMovimentacao(db, {
        produto_id: id,
        tipo: 'entrada',
        quantidade: estoqueInicial,
        custo_unitario: d.custo,
        origem: 'inicial',
        observacao: 'Estoque inicial do cadastro',
      });
    }
    return id;
  });

  const id = tx();
  // Foto enviada junto no cadastro (fluxo legado): registra na galeria.
  // Require tardio para evitar ciclo com fotos.js, que por sua vez importa
  // `obter`/`removerFotoArquivo` daqui no topo do arquivo.
  if (dados.foto_path) {
    try {
      // eslint-disable-next-line global-require
      require('./fotos').adicionarFotos(id, [dados.foto_path]);
    } catch (_) { /* nao bloqueia o cadastro */ }
  }
  return obter(id);
}

function atualizar(id, dados) {
  const db = getDb();
  const atual = obter(id);
  const d = normalizar({ ...atual, ...dados });

  // foto: mantem a atual se nao veio nova
  const foto_path = dados.foto_path !== undefined ? dados.foto_path : atual.foto_path;

  // Se trocou a foto e havia uma antiga diferente, remove o arquivo antigo.
  if (dados.foto_path !== undefined && atual.foto_path && atual.foto_path !== dados.foto_path) {
    removerFotoArquivo(atual.foto_path);
  }

  db.prepare(
    `UPDATE produtos SET
       nome=@nome, descricao=@descricao, codigo_barras=@codigo_barras,
       categoria_id=@categoria_id, fornecedor_id=@fornecedor_id, unidade=@unidade,
       custo=@custo, markup=@markup, preco_venda=@preco_venda,
       estoque_minimo=@estoque_minimo, foto_path=@foto_path,
       eh_kit=@eh_kit, eh_servico=@eh_servico, duracao_min=@duracao_min,
       grupo_variacao=@grupo_variacao, variacao=@variacao,
       ncm=@ncm, cfop=@cfop, cst_csosn=@cst_csosn, origem_mercadoria=@origem_mercadoria,
       atualizado_em=datetime('now','localtime')
     WHERE id=@id`
  ).run({ ...d, foto_path, id });

  return obter(id);
}

/**
 * Ajuste manual de estoque para um valor absoluto (inventario). Gera a
 * movimentacao de entrada/saida correspondente a diferenca.
 */
function ajustarEstoque(id, novaQuantidade, motivo) {
  const db = getDb();
  const prod = obter(id);
  const nova = Number(novaQuantidade);
  if (Number.isNaN(nova)) throw new AppError('Quantidade invalida.');
  const diff = Number((nova - Number(prod.estoque_atual)).toFixed(3));
  if (diff === 0) return prod;

  const tx = db.transaction(() => {
    registrarMovimentacao(db, {
      produto_id: id,
      tipo: diff > 0 ? 'entrada' : 'saida',
      quantidade: Math.abs(diff),
      custo_unitario: prod.custo,
      origem: 'ajuste',
      observacao: motivo || 'Ajuste manual de estoque',
    });
  });
  tx();
  return obter(id);
}

/**
 * Conferencia de estoque (inventario) em lote: recebe uma lista de itens
 * contados fisicamente e ajusta o saldo de cada produto para a quantidade
 * informada, gerando a movimentacao de entrada/saida correspondente a
 * diferenca. Somente itens com contagem informada sao processados; produtos
 * sem divergencia nao geram movimentacao. Tudo numa unica transacao.
 *
 * @param {Array<{id:number, contagem:number}>} itens
 * @param {string} [observacao] rotulo aplicado as movimentacoes
 * @returns {object} resumo { total, ajustados, sem_divergencia, erros, rotulo, resultados }
 */
function conferenciaEstoque(itens, observacao) {
  if (!Array.isArray(itens) || !itens.length) {
    throw new AppError('Nenhum item para conferir.');
  }
  const db = getDb();
  const rotulo = (observacao && observacao.trim())
    ? observacao.trim()
    : `Conferência de estoque ${dataHoraRotulo()}`;

  // 1) Valida e calcula tudo fora da transacao (apenas leituras).
  const plano = [];
  for (const item of itens) {
    const id = Number(item.id);
    const prod = db.prepare('SELECT id, nome, custo, estoque_atual, eh_kit FROM produtos WHERE id = ?').get(id);
    if (!prod) { plano.push({ id, sucesso: false, erro: 'Produto não encontrado.' }); continue; }
    if (prod.eh_kit) { plano.push({ id, nome: prod.nome, sucesso: false, erro: 'Kit não controla estoque próprio.' }); continue; }
    const contagem = Number(item.contagem);
    if (Number.isNaN(contagem) || contagem < 0) { plano.push({ id, nome: prod.nome, sucesso: false, erro: 'Contagem inválida.' }); continue; }
    const anterior = Number(prod.estoque_atual);
    const diferenca = Number((contagem - anterior).toFixed(3));
    plano.push({ id, nome: prod.nome, custo: prod.custo, sucesso: true, anterior, contagem, diferenca });
  }

  // 2) Aplica os ajustes numa unica transacao (so os itens com divergencia).
  const aplicar = plano.filter((r) => r.sucesso && r.diferenca !== 0);
  const tx = db.transaction(() => {
    for (const r of aplicar) {
      registrarMovimentacao(db, {
        produto_id: r.id,
        tipo: r.diferenca > 0 ? 'entrada' : 'saida',
        quantidade: Math.abs(r.diferenca),
        custo_unitario: r.custo,
        origem: 'ajuste',
        observacao: rotulo,
      });
    }
  });
  tx();

  return {
    total: plano.length,
    ajustados: aplicar.length,
    sem_divergencia: plano.filter((r) => r.sucesso && r.diferenca === 0).length,
    erros: plano.filter((r) => !r.sucesso).length,
    rotulo,
    resultados: plano,
  };
}

/**
 * Exclusao: se o produto ja tem movimentacoes/vendas, apenas inativa
 * (soft delete) para preservar historico. Caso contrario, remove de fato.
 */
function excluir(id) {
  const db = getDb();
  const prod = obter(id);

  const temMov = db
    .prepare('SELECT 1 FROM movimentacoes_estoque WHERE produto_id = ? LIMIT 1')
    .get(id);
  const temVenda = db
    .prepare('SELECT 1 FROM vendas_itens WHERE produto_id = ? LIMIT 1')
    .get(id);

  if (temMov || temVenda) {
    db.prepare('UPDATE produtos SET ativo = 0 WHERE id = ?').run(id);
    return { inativado: true };
  }

  if (prod.foto_path) removerFotoArquivo(prod.foto_path);
  db.prepare('DELETE FROM produtos WHERE id = ?').run(id);
  return { excluido: true };
}

/**
 * Exclui varios produtos de uma vez. Reaproveita excluir() por item, entao
 * cada produto respeita a mesma regra (inativa se tem historico, senao
 * remove de fato); um erro num item nao impede os demais.
 */
function excluirLote(ids) {
  if (!Array.isArray(ids) || !ids.length) {
    throw new AppError('Selecione ao menos um produto.');
  }
  const resultados = ids.map((id) => {
    try {
      const r = excluir(id);
      return { id, sucesso: true, inativado: !!r.inativado };
    } catch (e) {
      return { id, sucesso: false, erro: (e && e.message) || 'Erro desconhecido.' };
    }
  });
  return {
    total: resultados.length,
    excluidos: resultados.filter((r) => r.sucesso && !r.inativado).length,
    inativados: resultados.filter((r) => r.sucesso && r.inativado).length,
    erros: resultados.filter((r) => !r.sucesso).length,
    resultados,
  };
}

/**
 * Atualiza um ou mais campos em varios produtos de uma vez. Somente os
 * campos presentes em `campos` sao alterados; os demais permanecem intactos.
 * Campos aceitos: categoria_id, fornecedor_id, unidade, estoque_minimo, ativo.
 */
function editarLote(ids, campos) {
  if (!Array.isArray(ids) || !ids.length) {
    throw new AppError('Selecione ao menos um produto.');
  }
  const db = getDb();
  const sets = [];
  const params = {};

  if (campos.categoria_id !== undefined) { sets.push('categoria_id=@categoria_id'); params.categoria_id = campos.categoria_id || null; }
  if (campos.fornecedor_id !== undefined) { sets.push('fornecedor_id=@fornecedor_id'); params.fornecedor_id = campos.fornecedor_id || null; }
  if (campos.unidade !== undefined && String(campos.unidade).trim() !== '') {
    sets.push('unidade=@unidade'); params.unidade = String(campos.unidade).trim().toUpperCase();
  }
  if (campos.estoque_minimo !== undefined && campos.estoque_minimo !== '') {
    sets.push('estoque_minimo=@estoque_minimo'); params.estoque_minimo = Number(campos.estoque_minimo);
  }
  if (campos.ativo !== undefined) { sets.push('ativo=@ativo'); params.ativo = campos.ativo ? 1 : 0; }

  if (!sets.length) throw new AppError('Selecione ao menos um campo para alterar.');

  const sql = `UPDATE produtos SET ${sets.join(', ')}, atualizado_em=datetime('now','localtime') WHERE id=@id`;
  const resultados = ids.map((id) => {
    try {
      obter(id); // garante existencia (lanca 404 amigavel se nao existir)
      db.prepare(sql).run({ ...params, id });
      return { id, sucesso: true };
    } catch (e) {
      return { id, sucesso: false, erro: (e && e.message) || 'Erro desconhecido.' };
    }
  });
  return {
    total: resultados.length,
    atualizados: resultados.filter((r) => r.sucesso).length,
    erros: resultados.filter((r) => !r.sucesso).length,
    resultados,
  };
}

function removerFotoArquivo(nomeArquivo) {
  try {
    const p = path.join(paths.produtosImgDir, path.basename(nomeArquivo));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {
    /* ignora falha ao remover arquivo antigo */
  }
}

/** Rotulo de lote no formato "DD/MM/AAAA HH:MM". */
function dataHoraRotulo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

module.exports = {
  listar, obter, movimentacoes, normalizar, criar, atualizar, ajustarEstoque,
  conferenciaEstoque, excluir, excluirLote, editarLote, removerFotoArquivo, dataHoraRotulo,
};
