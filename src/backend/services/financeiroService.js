'use strict';

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { arred } = require('./precificacaoService');
const { hoje } = require('../utils/datas');

/** Soma N meses a uma data 'YYYY-MM-DD' preservando o dia quando possivel. */
function somarMeses(dataISO, meses) {
  const [a, m, d] = dataISO.split('-').map(Number);
  const base = new Date(a, m - 1 + meses, d);
  return base.toISOString().slice(0, 10);
}

// ===================== Contas financeiras (saldos) =====================

/** Le o mapa forma de pagamento -> conta financeira (config em JSON). */
function getMapaContas(db) {
  const row = db.prepare("SELECT valor FROM config WHERE chave = 'financeiro_mapa_contas'").get();
  if (!row || !row.valor) return {};
  try { return JSON.parse(row.valor) || {}; } catch (_) { return {}; }
}

function salvarMapaContas(mapa) {
  const db = getDb();
  const limpo = {};
  Object.entries(mapa || {}).forEach(([forma, id]) => { limpo[forma] = id ? Number(id) : null; });
  db.prepare("INSERT INTO config (chave, valor) VALUES ('financeiro_mapa_contas', ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor")
    .run(JSON.stringify(limpo));
  return limpo;
}

/** Conta financeira associada a uma forma de pagamento (ou null). */
function contaDaForma(db, forma) {
  if (!forma) return null;
  const mapa = getMapaContas(db);
  const id = mapa[forma];
  if (!id) return null;
  const existe = db.prepare('SELECT id FROM contas_financeiras WHERE id = ? AND ativa = 1').get(id);
  return existe ? Number(id) : null;
}

/**
 * Lanca um movimento no extrato de uma conta financeira. Sem conta_id, nao
 * faz nada (permite chamar sempre, mesmo quando a forma nao mapeia conta).
 * DEVE ser chamada dentro de uma transacao quando junto de outras escritas.
 */
function lancarMovimentoConta(db, { conta_id, tipo, valor, origem, referencia_id = null, descricao = null, data = null }) {
  if (!conta_id) return;
  if (tipo !== 'entrada' && tipo !== 'saida') throw new AppError('Tipo de movimento invalido.');
  if (data) {
    db.prepare(
      `INSERT INTO contas_financeiras_mov (conta_id, tipo, valor, origem, referencia_id, descricao, data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(conta_id, tipo, arred(Number(valor)), origem, referencia_id, descricao, data);
  } else {
    db.prepare(
      `INSERT INTO contas_financeiras_mov (conta_id, tipo, valor, origem, referencia_id, descricao)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(conta_id, tipo, arred(Number(valor)), origem, referencia_id, descricao);
  }
}

/** Saldo atual = saldo_inicial + entradas - saidas. */
function saldoConta(db, contaId) {
  const c = db.prepare('SELECT saldo_inicial FROM contas_financeiras WHERE id = ?').get(contaId);
  if (!c) return 0;
  const mov = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) s FROM contas_financeiras_mov WHERE conta_id = ?"
  ).get(contaId).s;
  return arred(Number(c.saldo_inicial) + Number(mov));
}

function listarContasFinanceiras({ incluir_inativas } = {}) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM contas_financeiras ${incluir_inativas ? '' : 'WHERE ativa = 1'} ORDER BY (ativa=0), ordem, id`
  ).all();
  return rows.map((c) => ({ ...c, saldo_atual: saldoConta(db, c.id) }));
}

function criarContaFinanceira(dados) {
  const db = getDb();
  const nome = (dados.nome || '').trim();
  if (!nome) throw new AppError('Informe o nome da conta.');
  const tipo = ['dinheiro', 'banco', 'cartao', 'outro'].includes(dados.tipo) ? dados.tipo : 'outro';
  const ordem = db.prepare('SELECT COALESCE(MAX(ordem),-1)+1 o FROM contas_financeiras').get().o;
  const info = db.prepare(
    'INSERT INTO contas_financeiras (nome, tipo, saldo_inicial, ordem) VALUES (?, ?, ?, ?)'
  ).run(nome, tipo, Number(dados.saldo_inicial || 0), ordem);
  return db.prepare('SELECT * FROM contas_financeiras WHERE id = ?').get(info.lastInsertRowid);
}

function atualizarContaFinanceira(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM contas_financeiras WHERE id = ?').get(id);
  if (!atual) throw new AppError('Conta nao encontrada.', 404);
  const nome = dados.nome !== undefined ? (dados.nome || '').trim() : atual.nome;
  if (!nome) throw new AppError('Informe o nome da conta.');
  const tipo = dados.tipo !== undefined && ['dinheiro', 'banco', 'cartao', 'outro'].includes(dados.tipo) ? dados.tipo : atual.tipo;
  const saldoInicial = dados.saldo_inicial !== undefined && dados.saldo_inicial !== '' ? Number(dados.saldo_inicial) : atual.saldo_inicial;
  const ativa = dados.ativa !== undefined ? (dados.ativa ? 1 : 0) : atual.ativa;
  db.prepare('UPDATE contas_financeiras SET nome=?, tipo=?, saldo_inicial=?, ativa=? WHERE id=?')
    .run(nome, tipo, saldoInicial, ativa, id);
  return db.prepare('SELECT * FROM contas_financeiras WHERE id = ?').get(id);
}

/**
 * Ajuste manual de saldo (controle de saldo da conta): registra um movimento
 * de entrada/saida igual a diferenca entre o saldo desejado e o atual.
 */
function ajustarSaldoConta(id, novoSaldo, motivo) {
  const db = getDb();
  const conta = db.prepare('SELECT * FROM contas_financeiras WHERE id = ?').get(id);
  if (!conta) throw new AppError('Conta nao encontrada.', 404);
  const alvo = Number(novoSaldo);
  if (Number.isNaN(alvo)) throw new AppError('Saldo invalido.');
  const atual = saldoConta(db, id);
  const diff = arred(alvo - atual);
  if (diff === 0) return { ...conta, saldo_atual: atual };
  lancarMovimentoConta(db, {
    conta_id: id,
    tipo: diff > 0 ? 'entrada' : 'saida',
    valor: Math.abs(diff),
    origem: 'ajuste',
    descricao: motivo || 'Ajuste manual de saldo',
  });
  return { ...conta, saldo_atual: saldoConta(db, id) };
}

function excluirContaFinanceira(id) {
  const db = getDb();
  const temMov = db.prepare('SELECT 1 FROM contas_financeiras_mov WHERE conta_id = ? LIMIT 1').get(id);
  if (temMov) {
    // Preserva o historico: apenas inativa contas que ja movimentaram.
    db.prepare('UPDATE contas_financeiras SET ativa = 0 WHERE id = ?').run(id);
    return { inativada: true };
  }
  db.prepare('DELETE FROM contas_financeiras WHERE id = ?').run(id);
  return { excluida: true };
}

/** Saldo da conta considerando so os movimentos ate uma data (para saber o saldo final de um periodo passado). */
function saldoContaAte(db, contaId, dataLimite) {
  const c = db.prepare('SELECT saldo_inicial FROM contas_financeiras WHERE id = ?').get(contaId);
  if (!c) return 0;
  const mov = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) s FROM contas_financeiras_mov WHERE conta_id = ? AND date(data) <= date(?)"
  ).get(contaId, dataLimite).s;
  return arred(Number(c.saldo_inicial) + Number(mov));
}

function extratoConta(id, { inicio, fim } = {}) {
  const db = getDb();
  const conta = db.prepare('SELECT * FROM contas_financeiras WHERE id = ?').get(id);
  if (!conta) throw new AppError('Conta nao encontrada.', 404);
  const where = ['conta_id = @id'];
  const params = { id };
  if (inicio) { where.push('date(data) >= date(@inicio)'); params.inicio = inicio; }
  if (fim) { where.push('date(data) <= date(@fim)'); params.fim = fim; }
  const movimentos = db.prepare(
    `SELECT * FROM contas_financeiras_mov WHERE ${where.join(' AND ')} ORDER BY date(data) DESC, id DESC LIMIT 300`
  ).all(params);
  return {
    ...conta,
    saldo_atual: saldoConta(db, id),
    saldo_inicio_periodo: inicio ? saldoContaAte(db, id, somarDias(inicio, -1)) : null,
    saldo_fim_periodo: fim ? saldoContaAte(db, id, fim) : null,
    movimentos,
  };
}

// =========================== Contas a pagar ===========================

function listarPagar({ status, inicio, fim, projeto_id } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (status) { where.push('cp.status = @status'); params.status = status; }
  if (inicio) { where.push('date(cp.vencimento) >= date(@inicio)'); params.inicio = inicio; }
  if (fim) { where.push('date(cp.vencimento) <= date(@fim)'); params.fim = fim; }
  if (projeto_id) { where.push('cp.projeto_id = @projeto_id'); params.projeto_id = Number(projeto_id); }
  return db.prepare(`
    SELECT cp.*, f.nome AS fornecedor_nome, cd.nome AS categoria_nome, pj.nome AS projeto_nome
    FROM contas_pagar cp
    LEFT JOIN fornecedores f ON f.id = cp.fornecedor_id
    LEFT JOIN categorias_despesa cd ON cd.id = cp.categoria_despesa_id
    LEFT JOIN projetos pj ON pj.id = cp.projeto_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (cp.status='pago'), date(cp.vencimento)
  `).all(params);
}

// ===================== Categorias de despesa (DRE) =====================

function listarCategoriasDespesa() {
  return getDb().prepare('SELECT * FROM categorias_despesa ORDER BY (considera_dre=0), ordem, id').all();
}

function criarCategoriaDespesa(dados) {
  const db = getDb();
  const nome = (dados.nome || '').trim();
  if (!nome) throw new AppError('Informe o nome da categoria.');
  const ordem = db.prepare('SELECT COALESCE(MAX(ordem),-1)+1 o FROM categorias_despesa').get().o;
  const considera = dados.considera_dre === false || dados.considera_dre === 0 || dados.considera_dre === '0' ? 0 : 1;
  const info = db.prepare('INSERT INTO categorias_despesa (nome, considera_dre, ordem) VALUES (?, ?, ?)').run(nome, considera, ordem);
  return db.prepare('SELECT * FROM categorias_despesa WHERE id = ?').get(info.lastInsertRowid);
}

function atualizarCategoriaDespesa(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM categorias_despesa WHERE id = ?').get(id);
  if (!atual) throw new AppError('Categoria nao encontrada.', 404);
  const nome = dados.nome !== undefined ? (dados.nome || '').trim() : atual.nome;
  if (!nome) throw new AppError('Informe o nome da categoria.');
  const considera = dados.considera_dre !== undefined
    ? (dados.considera_dre ? 1 : 0) : atual.considera_dre;
  db.prepare('UPDATE categorias_despesa SET nome=?, considera_dre=? WHERE id=?').run(nome, considera, id);
  return db.prepare('SELECT * FROM categorias_despesa WHERE id = ?').get(id);
}

function excluirCategoriaDespesa(id) {
  // As contas ja lancadas ficam sem categoria (SET NULL), sem perder historico.
  getDb().prepare('DELETE FROM categorias_despesa WHERE id = ?').run(id);
  return { ok: true };
}

/**
 * Cria conta a pagar, com parcelamento opcional.
 * dados = { descricao, fornecedor_id?, valor, vencimento?/primeiro_vencimento?,
 *           parcelas?, parcela_inicial?, valor_modo?, forma_pagamento? }
 * valor_modo = 'parcela': o valor informado e o de CADA parcela (nao e dividido).
 * valor_modo default ('unico'): o valor informado e o TOTAL, dividido pelas parcelas.
 * parcela_inicial permite comecar o lancamento a partir de uma parcela do meio
 * (ex.: parcela 3 de 5, quando as anteriores ja foram pagas/lancadas em outro lugar).
 * Cada parcela vence a cada mes a partir do vencimento informado.
 */
function criarPagar(dados) {
  const db = getDb();
  const descricao = (dados.descricao || '').trim();
  if (!descricao) throw new AppError('Informe a descricao da conta.');
  const valorInformado = Number(dados.valor);
  if (!(valorInformado > 0)) throw new AppError('Informe um valor maior que zero.');
  const totalParcelas = Math.max(1, Number(dados.parcelas || 1));
  const parcelaInicial = Math.min(totalParcelas, Math.max(1, Number(dados.parcela_inicial || 1)));
  const primeiro = dados.primeiro_vencimento || dados.vencimento || null;
  const porParcela = dados.valor_modo === 'parcela';

  const categoria = dados.categoria_despesa_id ? Number(dados.categoria_despesa_id) : null;
  // Verba carimbada do instituto: amarra a despesa ao projeto que a bancou.
  const projeto = dados.projeto_id ? Number(dados.projeto_id) : null;
  const valores = [];
  if (porParcela) {
    for (let i = 1; i <= totalParcelas; i++) valores.push(arred(valorInformado));
  } else {
    const valorParcela = arred(valorInformado / totalParcelas);
    let acumulado = 0;
    for (let i = 1; i <= totalParcelas; i++) {
      const v = i === totalParcelas ? arred(valorInformado - acumulado) : valorParcela;
      acumulado = arred(acumulado + v);
      valores.push(v);
    }
  }

  const ins = db.prepare(
    `INSERT INTO contas_pagar (fornecedor_id, descricao, valor, vencimento, status, forma_pagamento, parcela, total_parcelas, categoria_despesa_id, projeto_id)
     VALUES (?, ?, ?, ?, 'pendente', ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    const ids = [];
    for (let i = parcelaInicial; i <= totalParcelas; i++) {
      const venc = primeiro ? somarMeses(primeiro, i - parcelaInicial) : null;
      const desc = totalParcelas > 1 ? `${descricao} (${i}/${totalParcelas})` : descricao;
      ids.push(ins.run(dados.fornecedor_id || null, desc, valores[i - 1], venc, dados.forma_pagamento || null, i, totalParcelas, categoria, projeto).lastInsertRowid);
    }
    return ids;
  });
  const ids = tx();
  if (ids.length > 1) return { criadas: ids.length };
  return db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(ids[0]);
}

/** Edita uma conta a pagar ja lancada (uma parcela/lancamento por vez). */
function atualizarPagar(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id);
  if (!atual) throw new AppError('Conta nao encontrada.', 404);
  const descricao = dados.descricao !== undefined ? (dados.descricao || '').trim() : atual.descricao;
  if (!descricao) throw new AppError('Informe a descricao da conta.');
  const valor = dados.valor !== undefined && dados.valor !== '' ? Number(dados.valor) : atual.valor;
  if (!(valor > 0)) throw new AppError('Informe um valor maior que zero.');
  const vencimento = dados.vencimento !== undefined ? (dados.vencimento || null) : atual.vencimento;
  const fornecedorId = dados.fornecedor_id !== undefined ? (dados.fornecedor_id || null) : atual.fornecedor_id;
  const categoria = dados.categoria_despesa_id !== undefined ? (dados.categoria_despesa_id || null) : atual.categoria_despesa_id;
  const formaPagamento = dados.forma_pagamento !== undefined ? (dados.forma_pagamento || null) : atual.forma_pagamento;
  const projeto = dados.projeto_id !== undefined ? (dados.projeto_id || null) : atual.projeto_id;
  const valorArred = arred(valor);
  const tx = db.transaction(() => {
    db.prepare('UPDATE contas_pagar SET descricao=?, valor=?, vencimento=?, fornecedor_id=?, categoria_despesa_id=?, forma_pagamento=?, projeto_id=? WHERE id=?')
      .run(descricao, valorArred, vencimento, fornecedorId, categoria, formaPagamento, projeto, id);
    if (atual.status === 'pago' && valorArred !== Number(atual.valor)) {
      db.prepare("UPDATE contas_financeiras_mov SET valor=? WHERE origem='pagamento' AND referencia_id=?").run(valorArred, id);
    }
  });
  tx();
  return db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id);
}

function baixarPagar(id, { data_pagamento, forma_pagamento, conta_financeira_id } = {}) {
  const db = getDb();
  const c = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id);
  if (!c) throw new AppError('Conta nao encontrada.', 404);
  if (c.status === 'pago') throw new AppError('Esta conta ja foi paga.');
  const forma = forma_pagamento || c.forma_pagamento || null;
  const contaId = conta_financeira_id ? Number(conta_financeira_id) : contaDaForma(db, forma);
  const tx = db.transaction(() => {
    db.prepare("UPDATE contas_pagar SET status='pago', data_pagamento=?, forma_pagamento=COALESCE(?, forma_pagamento), conta_financeira_id=? WHERE id=?")
      .run(data_pagamento || hoje(), forma_pagamento || null, contaId || null, id);
    lancarMovimentoConta(db, {
      conta_id: contaId, tipo: 'saida', valor: c.valor, origem: 'pagamento',
      referencia_id: id, descricao: c.descricao, data: data_pagamento || hoje(),
    });
  });
  tx();
  return db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id);
}

function reabrirPagar(id) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM contas_financeiras_mov WHERE origem='pagamento' AND referencia_id=?").run(id);
    db.prepare("UPDATE contas_pagar SET status='pendente', data_pagamento=NULL, conta_financeira_id=NULL WHERE id=?").run(id);
  });
  tx();
  return db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id);
}

function excluirPagar(id) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM contas_financeiras_mov WHERE origem='pagamento' AND referencia_id=?").run(id);
    db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(id);
  });
  tx();
  return { ok: true };
}

// ========================= Contas fixas (recorrentes) =========================

function listarContasFixas() {
  const db = getDb();
  return db.prepare(`
    SELECT cf.*, f.nome AS fornecedor_nome
    FROM contas_fixas cf LEFT JOIN fornecedores f ON f.id = cf.fornecedor_id
    ORDER BY (cf.ativa = 0), cf.dia_vencimento
  `).all();
}

function validarContaFixa(dados) {
  const descricao = (dados.descricao || '').trim();
  if (!descricao) throw new AppError('Informe a descricao da conta fixa.');
  if (!(Number(dados.valor) > 0)) throw new AppError('Informe um valor maior que zero.');
  const dia = Number(dados.dia_vencimento);
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    throw new AppError('Informe um dia de vencimento entre 1 e 31.');
  }
  return { descricao, valor: Number(dados.valor), dia_vencimento: dia, fornecedor_id: dados.fornecedor_id || null };
}

function criarContaFixa(dados) {
  const db = getDb();
  const d = validarContaFixa(dados);
  const info = db.prepare(
    'INSERT INTO contas_fixas (descricao, fornecedor_id, valor, dia_vencimento) VALUES (?, ?, ?, ?)'
  ).run(d.descricao, d.fornecedor_id, d.valor, d.dia_vencimento);
  return db.prepare('SELECT * FROM contas_fixas WHERE id = ?').get(info.lastInsertRowid);
}

function atualizarContaFixa(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM contas_fixas WHERE id = ?').get(id);
  if (!atual) throw new AppError('Conta fixa nao encontrada.', 404);
  const d = validarContaFixa({ ...atual, ...dados });
  const ativa = dados.ativa !== undefined ? (dados.ativa ? 1 : 0) : atual.ativa;
  db.prepare('UPDATE contas_fixas SET descricao=?, fornecedor_id=?, valor=?, dia_vencimento=?, ativa=? WHERE id=?')
    .run(d.descricao, d.fornecedor_id, d.valor, d.dia_vencimento, ativa, id);
  return db.prepare('SELECT * FROM contas_fixas WHERE id = ?').get(id);
}

function excluirContaFixa(id) {
  // Nao apaga as contas a pagar ja geradas (historico), so o modelo.
  getDb().prepare('DELETE FROM contas_fixas WHERE id = ?').run(id);
  return { ok: true };
}

function ultimoDiaDoMes(ano, mes) {
  return new Date(ano, mes, 0).getDate(); // mes: 1-12
}

/**
 * Gera as contas a pagar do mes corrente para cada conta fixa ativa que
 * ainda nao tenha uma gerada neste mes. Idempotente: pode ser chamada varias
 * vezes (na inicializacao do app e ao abrir a tela) sem duplicar.
 */
function gerarContasFixasPendentes() {
  const db = getDb();
  const fixas = db.prepare('SELECT * FROM contas_fixas WHERE ativa = 1').all();
  if (!fixas.length) return { geradas: 0 };

  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = agora.getMonth() + 1;
  const aaMm = `${ano}-${String(mes).padStart(2, '0')}`;
  const ultimoDia = ultimoDiaDoMes(ano, mes);

  let geradas = 0;
  const tx = db.transaction(() => {
    const jaTem = db.prepare(
      "SELECT 1 FROM contas_pagar WHERE conta_fixa_id = ? AND strftime('%Y-%m', vencimento) = ?"
    );
    const inserir = db.prepare(
      `INSERT INTO contas_pagar (fornecedor_id, conta_fixa_id, descricao, valor, vencimento, status)
       VALUES (?, ?, ?, ?, ?, 'pendente')`
    );
    for (const f of fixas) {
      if (jaTem.get(f.id, aaMm)) continue;
      const dia = Math.min(Number(f.dia_vencimento), ultimoDia);
      const vencimento = `${aaMm}-${String(dia).padStart(2, '0')}`;
      inserir.run(f.fornecedor_id, f.id, f.descricao, f.valor, vencimento);
      geradas++;
    }
  });
  tx();
  return { geradas };
}

// ==================== Assinaturas (mensalidades recorrentes) ====================

function listarAssinaturas({ cliente_id } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (cliente_id) { where.push('a.cliente_id = @cliente_id'); params.cliente_id = cliente_id; }
  return db.prepare(`
    SELECT a.*, c.nome AS cliente_nome
    FROM assinaturas a JOIN clientes c ON c.id = a.cliente_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (a.ativa = 0), c.nome
  `).all(params);
}

function validarAssinatura(dados) {
  const descricao = (dados.descricao || '').trim();
  if (!descricao) throw new AppError('Informe a descricao da assinatura.');
  if (!dados.cliente_id) throw new AppError('Selecione o cliente.');
  if (!(Number(dados.valor) > 0)) throw new AppError('Informe um valor maior que zero.');
  const dia = Number(dados.dia_vencimento);
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    throw new AppError('Informe um dia de vencimento entre 1 e 31.');
  }
  if (dados.data_fim && dados.data_inicio && dados.data_fim < dados.data_inicio) {
    throw new AppError('A data de encerramento nao pode ser anterior ao inicio.');
  }
  return {
    descricao, cliente_id: Number(dados.cliente_id), valor: Number(dados.valor), dia_vencimento: dia,
    data_inicio: dados.data_inicio || hoje(),
    data_fim: dados.data_fim || null,
    observacao: (dados.observacao || '').trim() || null,
  };
}

function criarAssinatura(dados) {
  const db = getDb();
  const d = validarAssinatura(dados);
  const cliente = db.prepare('SELECT id FROM clientes WHERE id = ?').get(d.cliente_id);
  if (!cliente) throw new AppError('Cliente nao encontrado.', 404);
  const info = db.prepare(
    'INSERT INTO assinaturas (cliente_id, descricao, valor, dia_vencimento, data_inicio, data_fim, observacao) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(d.cliente_id, d.descricao, d.valor, d.dia_vencimento, d.data_inicio, d.data_fim, d.observacao);
  return db.prepare(
    'SELECT a.*, c.nome AS cliente_nome FROM assinaturas a JOIN clientes c ON c.id = a.cliente_id WHERE a.id = ?'
  ).get(info.lastInsertRowid);
}

function atualizarAssinatura(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(id);
  if (!atual) throw new AppError('Assinatura nao encontrada.', 404);
  const d = validarAssinatura({ ...atual, ...dados });
  const ativa = dados.ativa !== undefined ? (dados.ativa ? 1 : 0) : atual.ativa;
  db.prepare(
    'UPDATE assinaturas SET cliente_id=?, descricao=?, valor=?, dia_vencimento=?, data_inicio=?, data_fim=?, observacao=?, ativa=? WHERE id=?'
  ).run(d.cliente_id, d.descricao, d.valor, d.dia_vencimento, d.data_inicio, d.data_fim, d.observacao, ativa, id);
  return db.prepare(
    'SELECT a.*, c.nome AS cliente_nome FROM assinaturas a JOIN clientes c ON c.id = a.cliente_id WHERE a.id = ?'
  ).get(id);
}

function excluirAssinatura(id) {
  // Nao apaga as contas a receber ja geradas (historico), so o modelo.
  getDb().prepare('DELETE FROM assinaturas WHERE id = ?').run(id);
  return { ok: true };
}

/**
 * Gera as contas a receber do mes corrente para cada assinatura ativa (dentro
 * da vigencia) que ainda nao tenha uma gerada neste mes. Idempotente: pode
 * ser chamada varias vezes (na inicializacao do app e ao abrir a tela) sem
 * duplicar, no mesmo espirito de gerarContasFixasPendentes().
 */
function gerarAssinaturasPendentes() {
  const db = getDb();
  const ativas = db.prepare(`
    SELECT * FROM assinaturas
    WHERE ativa = 1
      AND date(data_inicio) <= date('now','localtime')
      AND (data_fim IS NULL OR date(data_fim) >= date('now','localtime'))
  `).all();
  if (!ativas.length) return { geradas: 0 };

  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = agora.getMonth() + 1;
  const aaMm = `${ano}-${String(mes).padStart(2, '0')}`;
  const ultimoDia = ultimoDiaDoMes(ano, mes);

  let geradas = 0;
  const tx = db.transaction(() => {
    const jaTem = db.prepare(
      "SELECT 1 FROM contas_receber WHERE assinatura_id = ? AND strftime('%Y-%m', vencimento) = ?"
    );
    const inserir = db.prepare(
      `INSERT INTO contas_receber (cliente_id, assinatura_id, descricao, valor, vencimento, status)
       VALUES (?, ?, ?, ?, ?, 'pendente')`
    );
    for (const a of ativas) {
      if (jaTem.get(a.id, aaMm)) continue;
      const dia = Math.min(Number(a.dia_vencimento), ultimoDia);
      const vencimento = `${aaMm}-${String(dia).padStart(2, '0')}`;
      inserir.run(a.cliente_id, a.id, a.descricao, a.valor, vencimento);
      geradas++;
    }
  });
  tx();
  return { geradas };
}

// ========================== Contas a receber ==========================

function listarReceber({ status, inicio, fim } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (status) { where.push('cr.status = @status'); params.status = status; }
  if (inicio) { where.push('date(cr.vencimento) >= date(@inicio)'); params.inicio = inicio; }
  if (fim) { where.push('date(cr.vencimento) <= date(@fim)'); params.fim = fim; }
  return db.prepare(`
    SELECT cr.*, c.nome AS cliente_nome FROM contas_receber cr
    LEFT JOIN clientes c ON c.id = cr.cliente_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (cr.status!='pendente'), date(cr.vencimento)
  `).all(params);
}

/**
 * Cria conta a receber, com parcelamento opcional.
 * dados = { descricao, valor, parcelas?, parcela_inicial?, valor_modo?,
 *           primeiro_vencimento?, venda_id?, cliente_id? }
 * valor_modo = 'parcela': o valor informado e o de CADA parcela (nao e dividido).
 * valor_modo default ('unico'): o valor informado e o TOTAL, dividido pelas parcelas.
 * parcela_inicial permite comecar o lancamento a partir de uma parcela do meio.
 */
function criarReceber(dados) {
  const db = getDb();
  const descricao = (dados.descricao || '').trim();
  if (!descricao) throw new AppError('Informe a descricao.');
  const valorInformado = Number(dados.valor);
  if (!(valorInformado > 0)) throw new AppError('Informe um valor maior que zero.');
  const totalParcelas = Math.max(1, Number(dados.parcelas || 1));
  const parcelaInicial = Math.min(totalParcelas, Math.max(1, Number(dados.parcela_inicial || 1)));
  const primeiro = dados.primeiro_vencimento || hoje();
  const clienteId = dados.cliente_id ? Number(dados.cliente_id) : null;
  const porParcela = dados.valor_modo === 'parcela';

  const valores = [];
  if (porParcela) {
    for (let i = 1; i <= totalParcelas; i++) valores.push(arred(valorInformado));
  } else {
    const valorParcela = arred(valorInformado / totalParcelas);
    let acumulado = 0;
    for (let i = 1; i <= totalParcelas; i++) {
      // Ultima parcela ajusta a diferenca de arredondamento.
      const v = i === totalParcelas ? arred(valorInformado - acumulado) : valorParcela;
      acumulado = arred(acumulado + v);
      valores.push(v);
    }
  }

  const ins = db.prepare(
    `INSERT INTO contas_receber (venda_id, cliente_id, descricao, valor, parcela, total_parcelas, vencimento, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente')`
  );
  const ids = [];
  const tx = db.transaction(() => {
    for (let i = parcelaInicial; i <= totalParcelas; i++) {
      const venc = somarMeses(primeiro, i - parcelaInicial);
      const desc = totalParcelas > 1 ? `${descricao} (${i}/${totalParcelas})` : descricao;
      const info = ins.run(dados.venda_id || null, clienteId, desc, valores[i - 1], i, totalParcelas, venc);
      ids.push(info.lastInsertRowid);
    }
  });
  tx();
  return { criadas: ids.length, ids };
}

/** Edita uma conta a receber ja lancada (uma parcela/lancamento por vez). */
function atualizarReceber(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(id);
  if (!atual) throw new AppError('Conta nao encontrada.', 404);
  if (atual.tipo === 'venda_vista') throw new AppError('Recebimento de venda a vista nao pode ser editado.');
  const descricao = dados.descricao !== undefined ? (dados.descricao || '').trim() : atual.descricao;
  if (!descricao) throw new AppError('Informe a descricao.');
  const valor = dados.valor !== undefined && dados.valor !== '' ? Number(dados.valor) : atual.valor;
  if (!(valor > 0)) throw new AppError('Informe um valor maior que zero.');
  const vencimento = dados.vencimento !== undefined ? (dados.vencimento || null) : atual.vencimento;
  const clienteId = dados.cliente_id !== undefined ? (dados.cliente_id || null) : atual.cliente_id;
  const valorArred = arred(valor);
  const tx = db.transaction(() => {
    db.prepare('UPDATE contas_receber SET descricao=?, valor=?, vencimento=?, cliente_id=? WHERE id=?')
      .run(descricao, valorArred, vencimento, clienteId, id);
    if (atual.status === 'recebido' && valorArred !== Number(atual.valor)) {
      db.prepare("UPDATE contas_financeiras_mov SET valor=? WHERE origem='recebimento' AND referencia_id=?").run(valorArred, id);
    }
  });
  tx();
  return db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(id);
}

/**
 * Monta os dados de uma cobrança para enviar ao cliente: a conta, os itens
 * da venda (se a conta veio de uma venda a prazo) e um QR Code PIX com o
 * valor ja preenchido, usando a chave PIX cadastrada em Configurações.
 */
async function gerarCobranca(id) {
  const db = getDb();
  const cr = db.prepare(
    `SELECT cr.*, c.nome AS cliente_nome, c.telefone AS cliente_telefone
     FROM contas_receber cr LEFT JOIN clientes c ON c.id = cr.cliente_id
     WHERE cr.id = ?`
  ).get(id);
  if (!cr) throw new AppError('Conta nao encontrada.', 404);
  if (cr.status !== 'pendente') throw new AppError('Esta conta já foi quitada ou cancelada.');

  const itens = cr.venda_id
    ? db.prepare('SELECT descricao, quantidade, preco_unitario, valor_total FROM vendas_itens WHERE venda_id = ?').all(cr.venda_id)
    : [];

  const cfgLinhas = db.prepare(
    "SELECT chave, valor FROM config WHERE chave IN ('pix_chave','pix_nome_recebedor','pix_cidade','nome_loja')"
  ).all();
  const cfg = {};
  cfgLinhas.forEach((l) => { cfg[l.chave] = l.valor; });

  // eslint-disable-next-line global-require
  const pix = require('./pixService');
  const payload = pix.montarPayloadPix({
    chave: cfg.pix_chave,
    nome: cfg.pix_nome_recebedor || cfg.nome_loja,
    cidade: cfg.pix_cidade,
    valor: cr.valor,
    descricao: cr.descricao,
    txid: 'CR' + cr.id,
  });
  const qrDataUrl = await pix.gerarQrCodeDataUrl(payload);

  return { conta: cr, itens, pix: { payload, qr_data_url: qrDataUrl } };
}

function baixarReceber(id, { data_recebimento, forma_recebimento, conta_financeira_id } = {}) {
  const db = getDb();
  const c = db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(id);
  if (!c) throw new AppError('Conta nao encontrada.', 404);
  if (c.status === 'recebido') throw new AppError('Esta conta ja foi recebida.');
  if (c.status === 'cancelada') throw new AppError('Esta conta esta cancelada.');
  const contaId = conta_financeira_id ? Number(conta_financeira_id) : contaDaForma(db, forma_recebimento);
  const tx = db.transaction(() => {
    db.prepare("UPDATE contas_receber SET status='recebido', data_recebimento=?, forma_recebimento=?, conta_financeira_id=? WHERE id=?")
      .run(data_recebimento || hoje(), forma_recebimento || null, contaId || null, id);
    lancarMovimentoConta(db, {
      conta_id: contaId, tipo: 'entrada', valor: c.valor, origem: 'recebimento',
      referencia_id: id, descricao: c.descricao, data: data_recebimento || hoje(),
    });
  });
  tx();
  return db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(id);
}

function reabrirReceber(id) {
  const db = getDb();
  const c = db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(id);
  if (c && c.tipo === 'venda_vista') throw new AppError('Recebimento de venda a vista nao pode ser reaberto.');
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM contas_financeiras_mov WHERE origem='recebimento' AND referencia_id=?").run(id);
    db.prepare("UPDATE contas_receber SET status='pendente', data_recebimento=NULL, conta_financeira_id=NULL WHERE id=?").run(id);
  });
  tx();
  return db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(id);
}

function excluirReceber(id) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM contas_financeiras_mov WHERE origem='recebimento' AND referencia_id=?").run(id);
    db.prepare('DELETE FROM contas_receber WHERE id = ?').run(id);
  });
  tx();
  return { ok: true };
}

// ============================== Alertas ==============================

function alertas({ dias = 7 } = {}) {
  const db = getDb();
  const limite = somarDias(hoje(), Number(dias));
  const q = (tabela, dataCol) => ({
    vencidas: db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM ${tabela} WHERE status='pendente' AND date(${dataCol}) < date(?)`).get(hoje()),
    aVencer: db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM ${tabela} WHERE status='pendente' AND date(${dataCol}) >= date(?) AND date(${dataCol}) <= date(?)`).get(hoje(), limite),
  });
  return { pagar: q('contas_pagar', 'vencimento'), receber: q('contas_receber', 'vencimento') };
}

function somarDias(dataISO, dias) {
  const d = new Date(dataISO + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// =========================== Fluxo de caixa ===========================

/**
 * Fluxo de caixa realizado por periodo:
 *  - Entradas: pagamentos NAO a prazo de vendas concluidas (data da venda) +
 *              contas a receber recebidas (data de recebimento)
 *  - Saidas:   contas a pagar pagas (data de pagamento)
 */
function fluxoCaixa({ inicio, fim, conta_financeira_id } = {}) {
  const db = getDb();
  const ini = inicio || '0000-01-01';
  const f = fim || '9999-12-31';

  // Com uma conta financeira selecionada, o fluxo vem direto do extrato dela
  // (contas_financeiras_mov) — e da pra ver o saldo no inicio/fim do periodo,
  // util pra bater com o saldo final do extrato do banco (conciliacao).
  if (conta_financeira_id) {
    const contaId = Number(conta_financeira_id);
    const conta = db.prepare('SELECT * FROM contas_financeiras WHERE id = ?').get(contaId);
    if (!conta) throw new AppError('Conta financeira nao encontrada.', 404);

    const porOrigem = db.prepare(`
      SELECT tipo, origem, COALESCE(SUM(valor),0) total
      FROM contas_financeiras_mov
      WHERE conta_id = ? AND date(data) BETWEEN date(?) AND date(?)
      GROUP BY tipo, origem
    `).all(contaId, ini, f);
    const somaTipo = (tipo) => arred(porOrigem.filter((r) => r.tipo === tipo).reduce((s, r) => s + Number(r.total), 0));
    const somaOrigem = (origem) => arred(porOrigem.filter((r) => r.origem === origem).reduce((s, r) => s + Number(r.total), 0));

    const entradas = somaTipo('entrada');
    const saidas = somaTipo('saida');
    const saldoInicioPeriodo = inicio ? saldoContaAte(db, contaId, somarDias(inicio, -1)) : Number(conta.saldo_inicial);
    const saldoFimPeriodo = fim ? saldoContaAte(db, contaId, fim) : saldoConta(db, contaId);

    return {
      entradas,
      saidas,
      saldo: arred(entradas - saidas),
      detalhe: {
        vendas_a_vista: somaOrigem('venda'),
        recebimentos: somaOrigem('recebimento'),
        ofertas: somaOrigem('oferta'),
        pagamentos: somaOrigem('pagamento'),
      },
      conta_financeira: { ...conta, saldo_atual: saldoConta(db, contaId) },
      saldo_inicio_periodo: arred(saldoInicioPeriodo),
      saldo_fim_periodo: arred(saldoFimPeriodo),
      contas: listarContasFinanceiras(),
      saldo_total_contas: arred(listarContasFinanceiras().reduce((s, c) => s + Number(c.saldo_atual), 0)),
    };
  }

  const vendasVista = db.prepare(`
    SELECT COALESCE(SUM(vp.valor),0) AS total
    FROM vendas_pagamentos vp JOIN vendas v ON v.id = vp.venda_id
    WHERE v.status='concluida' AND vp.forma_pagamento <> 'prazo'
      AND date(v.data) BETWEEN date(?) AND date(?)
  `).get(ini, f).total;

  // Exclui as contas "venda_vista" (registro ja embutido em vendasVista) para
  // nao contar a mesma venda a vista duas vezes.
  const recebimentos = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS total FROM contas_receber
    WHERE status='recebido' AND tipo <> 'venda_vista' AND date(data_recebimento) BETWEEN date(?) AND date(?)
  `).get(ini, f).total;

  const pagamentos = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS total FROM contas_pagar
    WHERE status='pago' AND date(data_pagamento) BETWEEN date(?) AND date(?)
  `).get(ini, f).total;

  // Oferta do instituto entra direto no caixa (nao passa por conta a receber),
  // entao vem do proprio extrato das contas para nao ficar de fora do fluxo.
  const ofertas = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS total FROM contas_financeiras_mov
    WHERE origem='oferta' AND tipo='entrada' AND date(data) BETWEEN date(?) AND date(?)
  `).get(ini, f).total;

  const entradas = arred(Number(vendasVista) + Number(recebimentos) + Number(ofertas));
  const saidas = arred(Number(pagamentos));
  return {
    entradas,
    saidas,
    saldo: arred(entradas - saidas),
    detalhe: {
      vendas_a_vista: arred(vendasVista),
      recebimentos: arred(recebimentos),
      ofertas: arred(ofertas),
      pagamentos: arred(pagamentos),
    },
    contas: listarContasFinanceiras(),
    saldo_total_contas: arred(listarContasFinanceiras().reduce((s, c) => s + Number(c.saldo_atual), 0)),
  };
}

// ============================ DRE (resultado) ============================

function primeiroDiaMes() { return new Date().toISOString().slice(0, 8) + '01'; }
function ultimoDiaMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

/**
 * Demonstracao do Resultado (DRE) simplificada por periodo (competencia):
 *   Receita de vendas (vendas concluidas, pelo valor liquido)
 *   (-) CMV — custo da mercadoria vendida (produtos) e/ou
 *   (-) CSP — custo dos servicos prestados (servicos), conforme o negocio
 *   = Lucro bruto
 *   (-) Despesas operacionais (contas a pagar por categoria, no vencimento)
 *   = Resultado liquido
 * Categorias marcadas como "fora do DRE" (ex.: compra de mercadoria) nao
 * entram nas despesas — elas ja aparecem no resultado via CMV, ao vender.
 */
function dre({ inicio, fim } = {}) {
  const db = getDb();
  const ini = inicio || primeiroDiaMes();
  const f = fim || ultimoDiaMes();

  const receita = db.prepare(
    "SELECT COALESCE(SUM(valor_total),0) t FROM vendas WHERE status='concluida' AND date(data) BETWEEN date(?) AND date(?)"
  ).get(ini, f).t;

  // Separa o custo de produtos (CMV) do custo de servicos prestados (CSP):
  // um prestador de servico nao vende "mercadoria", entao o nome certo do
  // seu custo direto e outro. Quando o negocio tem os dois (produtos e
  // servicos), o DRE mostra as duas linhas separadas.
  const custos = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN p.eh_servico = 1 THEN vi.custo_unitario * vi.quantidade ELSE 0 END),0) AS csp,
      COALESCE(SUM(CASE WHEN p.eh_servico IS NULL OR p.eh_servico = 0 THEN vi.custo_unitario * vi.quantidade ELSE 0 END),0) AS cmv
    FROM vendas_itens vi
    JOIN vendas v ON v.id = vi.venda_id
    LEFT JOIN produtos p ON p.id = vi.produto_id
    WHERE v.status='concluida' AND date(v.data) BETWEEN date(?) AND date(?)
  `).get(ini, f);
  const cmv = custos.cmv;
  const csp = custos.csp;

  const lucroBruto = arred(Number(receita) - Number(cmv) - Number(csp));

  // Despesas operacionais por categoria (considera_dre=1), pela competencia
  // (data de vencimento; se nula, usa a data de criacao).
  const despesasCat = db.prepare(`
    SELECT cd.id, cd.nome, COALESCE(SUM(cp.valor),0) total,
      COALESCE(SUM(CASE WHEN cp.status='pago' THEN cp.valor ELSE 0 END),0) pago
    FROM categorias_despesa cd
    LEFT JOIN contas_pagar cp
      ON cp.categoria_despesa_id = cd.id
      AND date(COALESCE(cp.vencimento, cp.criado_em)) BETWEEN date(?) AND date(?)
    WHERE cd.considera_dre = 1
    GROUP BY cd.id ORDER BY cd.ordem, cd.id
  `).all(ini, f).filter((c) => Number(c.total) > 0).map((c) => ({ nome: c.nome, total: arred(c.total), pago: arred(c.pago) }));

  const semCategoria = db.prepare(`
    SELECT COALESCE(SUM(valor),0) t FROM contas_pagar
    WHERE categoria_despesa_id IS NULL AND date(COALESCE(vencimento, criado_em)) BETWEEN date(?) AND date(?)
  `).get(ini, f).t;
  if (Number(semCategoria) > 0) despesasCat.push({ nome: 'Sem categoria', total: arred(semCategoria), pago: 0 });

  const totalDespesas = arred(despesasCat.reduce((s, c) => s + Number(c.total), 0));
  const resultado = arred(lucroBruto - totalDespesas);

  return {
    periodo: { inicio: ini, fim: f },
    receita_bruta: arred(receita),
    cmv: arred(cmv),
    csp: arred(csp),
    lucro_bruto: lucroBruto,
    margem_bruta_pct: receita > 0 ? arred((lucroBruto / receita) * 100) : 0,
    despesas: despesasCat,
    total_despesas: totalDespesas,
    resultado_liquido: resultado,
    margem_liquida_pct: receita > 0 ? arred((resultado / receita) * 100) : 0,
  };
}

module.exports = {
  listarPagar, criarPagar, atualizarPagar, baixarPagar, reabrirPagar, excluirPagar,
  listarCategoriasDespesa, criarCategoriaDespesa, atualizarCategoriaDespesa, excluirCategoriaDespesa,
  dre,
  listarReceber, criarReceber, atualizarReceber, baixarReceber, reabrirReceber, excluirReceber, gerarCobranca,
  alertas, fluxoCaixa,
  listarContasFixas, criarContaFixa, atualizarContaFixa, excluirContaFixa, gerarContasFixasPendentes,
  listarAssinaturas, criarAssinatura, atualizarAssinatura, excluirAssinatura, gerarAssinaturasPendentes,
  // contas financeiras (saldos)
  listarContasFinanceiras, criarContaFinanceira, atualizarContaFinanceira,
  ajustarSaldoConta, excluirContaFinanceira, extratoConta,
  getMapaContas, salvarMapaContas,
  // helpers usados por vendasService
  contaDaForma, lancarMovimentoConta,
};
