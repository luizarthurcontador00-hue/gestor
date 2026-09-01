'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { arred } = require('./precificacaoService');
const { hoje } = require('../utils/datas');
const paths = require('../paths');

const STATUS = ['agendado', 'confirmado', 'atendido', 'cancelado', 'faltou'];

// ----------------------------- Profissionais -----------------------------

function listarProfissionais({ incluir_inativos } = {}) {
  return getDb().prepare(
    `SELECT * FROM profissionais ${incluir_inativos ? '' : 'WHERE ativo = 1'} ORDER BY (ativo=0), nome COLLATE NOCASE`
  ).all();
}

function criarProfissional(dados) {
  const db = getDb();
  const nome = (dados.nome || '').trim();
  if (!nome) throw new AppError('Informe o nome do profissional.');
  const info = db.prepare(
    'INSERT INTO profissionais (nome, telefone, cor, comissao_pct, tipo, email, documento, endereco, observacao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(nome, dados.telefone || null, dados.cor || '#2563eb', Number(dados.comissao_pct || 0),
    dados.tipo === 'voluntario' ? 'voluntario' : 'contratado',
    dados.email || null, dados.documento || null, dados.endereco || null, dados.observacao || null);
  const id = info.lastInsertRowid;
  if (dados.disponibilidade) salvarDisponibilidade(db, id, dados.disponibilidade);
  return obterProfissional(id);
}

/** Em que dias/horarios o voluntario pode ajudar (usado para escalar turmas). */
function salvarDisponibilidade(db, profissionalId, faixas) {
  db.prepare('DELETE FROM voluntarios_disponibilidade WHERE profissional_id = ?').run(profissionalId);
  const ins = db.prepare('INSERT INTO voluntarios_disponibilidade (profissional_id, dia_semana, hora_inicio, hora_fim) VALUES (?, ?, ?, ?)');
  (faixas || []).forEach((f) => {
    const dia = Number(f.dia_semana);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) return;
    const ini = String(f.hora_inicio || '').trim();
    const fim = String(f.hora_fim || '').trim();
    if (!/^\d{2}:\d{2}$/.test(ini) || !/^\d{2}:\d{2}$/.test(fim) || fim <= ini) {
      throw new AppError('Informe um intervalo de disponibilidade válido (início antes do fim).');
    }
    ins.run(profissionalId, dia, ini, fim);
  });
}

function obterProfissional(id) {
  const db = getDb();
  const p = db.prepare('SELECT * FROM profissionais WHERE id = ?').get(id);
  if (!p) throw new AppError('Profissional nao encontrado.', 404);
  p.disponibilidade = db.prepare('SELECT * FROM voluntarios_disponibilidade WHERE profissional_id = ? ORDER BY dia_semana, hora_inicio').all(id);
  p.turmas = db.prepare(`
    SELECT t.id, t.nome, t.sala, ti.papel, c.nome AS curso_nome
    FROM turmas_instrutores ti JOIN turmas t ON t.id = ti.turma_id
    JOIN cursos c ON c.id = t.curso_id
    WHERE ti.profissional_id = ? AND t.status IN ('aberta','planejada')
    ORDER BY t.nome
  `).all(id);
  const horarios = db.prepare('SELECT * FROM turmas_horarios WHERE turma_id = ? ORDER BY dia_semana, hora_inicio');
  p.turmas.forEach((t) => { t.horarios = horarios.all(t.id); });
  return p;
}

function atualizarProfissional(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM profissionais WHERE id = ?').get(id);
  if (!atual) throw new AppError('Profissional nao encontrado.', 404);
  const nome = dados.nome !== undefined ? (dados.nome || '').trim() : atual.nome;
  if (!nome) throw new AppError('Informe o nome do profissional.');
  db.prepare('UPDATE profissionais SET nome=?, telefone=?, cor=?, comissao_pct=?, ativo=?, tipo=?, email=?, documento=?, endereco=?, observacao=? WHERE id=?').run(
    nome,
    dados.telefone !== undefined ? dados.telefone : atual.telefone,
    dados.cor !== undefined ? dados.cor : atual.cor,
    dados.comissao_pct !== undefined ? Number(dados.comissao_pct || 0) : atual.comissao_pct,
    dados.ativo !== undefined ? (dados.ativo ? 1 : 0) : atual.ativo,
    dados.tipo !== undefined ? (dados.tipo === 'voluntario' ? 'voluntario' : 'contratado') : atual.tipo,
    dados.email !== undefined ? dados.email : atual.email,
    dados.documento !== undefined ? dados.documento : atual.documento,
    dados.endereco !== undefined ? dados.endereco : atual.endereco,
    dados.observacao !== undefined ? dados.observacao : atual.observacao,
    id
  );
  if (dados.disponibilidade) salvarDisponibilidade(db, Number(id), dados.disponibilidade);
  return obterProfissional(id);
}

function excluirProfissional(id) {
  const db = getDb();
  const temAgenda = db.prepare('SELECT 1 FROM agendamentos WHERE profissional_id = ? LIMIT 1').get(id);
  if (temAgenda) {
    db.prepare('UPDATE profissionais SET ativo = 0 WHERE id = ?').run(id);
    return { inativado: true };
  }
  db.prepare('DELETE FROM profissionais WHERE id = ?').run(id);
  return { excluido: true };
}

// ------------------------------ Agendamentos ------------------------------

function listar({ data, inicio, fim, profissional_id, status } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (data) { where.push('a.data = @data'); params.data = data; }
  if (inicio) { where.push('date(a.data) >= date(@inicio)'); params.inicio = inicio; }
  if (fim) { where.push('date(a.data) <= date(@fim)'); params.fim = fim; }
  if (profissional_id) { where.push('a.profissional_id = @prof'); params.prof = Number(profissional_id); }
  if (status) { where.push('a.status = @status'); params.status = status; }
  // Turma cancelada nunca deveria ter aula na agenda de verdade -- mas se
  // ficou algum encontro orfao pra tras (turma cancelada antes da limpeza
  // existir, por exemplo), nao deixa reaparecer aqui.
  where.push("(a.turma_id IS NULL OR NOT EXISTS (SELECT 1 FROM turmas t WHERE t.id = a.turma_id AND t.status = 'cancelada'))");
  return db.prepare(`
    SELECT a.*, c.nome AS cliente_cadastro, c.telefone AS cliente_telefone,
           p.nome AS profissional_nome, p.cor AS profissional_cor
    FROM agendamentos a
    LEFT JOIN clientes c ON c.id = a.cliente_id
    LEFT JOIN profissionais p ON p.id = a.profissional_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.data, a.hora_inicio
  `).all(params);
}

function obter(id) {
  const db = getDb();
  const a = db.prepare(`
    SELECT a.*, c.nome AS cliente_cadastro, c.telefone AS cliente_telefone,
           p.nome AS profissional_nome, p.cor AS profissional_cor
    FROM agendamentos a
    LEFT JOIN clientes c ON c.id = a.cliente_id
    LEFT JOIN profissionais p ON p.id = a.profissional_id
    WHERE a.id = ?
  `).get(id);
  if (!a) throw new AppError('Agendamento nao encontrado.', 404);
  return a;
}

/** Soma minutos a um horario 'HH:MM'. */
function somarMinutos(hora, minutos) {
  const [h, m] = String(hora).split(':').map(Number);
  const total = h * 60 + m + Number(minutos || 0);
  const hh = Math.floor((total % 1440) / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normalizar(db, dados, atual = {}) {
  const data = dados.data || atual.data;
  const hora_inicio = dados.hora_inicio || atual.hora_inicio;
  if (!data) throw new AppError('Informe a data do agendamento.');
  if (!hora_inicio) throw new AppError('Informe o horario do agendamento.');

  const produto_id = dados.produto_id !== undefined
    ? (dados.produto_id ? Number(dados.produto_id) : null)
    : (atual.produto_id || null);

  let servico_nome = dados.servico_nome !== undefined ? dados.servico_nome : atual.servico_nome;
  let valor = dados.valor !== undefined && dados.valor !== '' ? Number(dados.valor) : Number(atual.valor || 0);
  let hora_fim = dados.hora_fim !== undefined ? dados.hora_fim : atual.hora_fim;

  // Puxa nome/preco/duracao do servico do cadastro quando vinculado.
  if (produto_id) {
    const serv = db.prepare('SELECT nome, preco_venda, duracao_min FROM produtos WHERE id = ?').get(produto_id);
    if (serv) {
      if (!servico_nome) servico_nome = serv.nome;
      if (!valor) valor = Number(serv.preco_venda || 0);
      if (!hora_fim && serv.duracao_min) hora_fim = somarMinutos(hora_inicio, serv.duracao_min);
    }
  }

  return {
    data,
    hora_inicio,
    hora_fim: hora_fim || null,
    cliente_id: dados.cliente_id !== undefined ? (dados.cliente_id ? Number(dados.cliente_id) : null) : (atual.cliente_id || null),
    cliente_nome: dados.cliente_nome !== undefined ? (dados.cliente_nome || null) : (atual.cliente_nome || null),
    telefone: dados.telefone !== undefined ? (dados.telefone || null) : (atual.telefone || null),
    profissional_id: dados.profissional_id !== undefined ? (dados.profissional_id ? Number(dados.profissional_id) : null) : (atual.profissional_id || null),
    produto_id,
    servico_nome: servico_nome || null,
    valor: arred(valor),
    observacao: dados.observacao !== undefined ? (dados.observacao || null) : (atual.observacao || null),
  };
}

function criar(dados) {
  const db = getDb();
  const d = normalizar(db, dados);
  const info = db.prepare(`
    INSERT INTO agendamentos
      (data, hora_inicio, hora_fim, cliente_id, cliente_nome, telefone, profissional_id,
       produto_id, servico_nome, valor, status, observacao)
    VALUES (@data, @hora_inicio, @hora_fim, @cliente_id, @cliente_nome, @telefone, @profissional_id,
       @produto_id, @servico_nome, @valor, 'agendado', @observacao)
  `).run(d);
  // eslint-disable-next-line global-require
  require('./googleAgendaService').sincronizarAsync(info.lastInsertRowid);
  return obter(info.lastInsertRowid);
}

function atualizar(id, dados) {
  const db = getDb();
  const atual = obter(id);
  if (atual.venda_id) throw new AppError('Este agendamento ja foi faturado.');
  const d = normalizar(db, dados, atual);
  db.prepare(`
    UPDATE agendamentos SET data=@data, hora_inicio=@hora_inicio, hora_fim=@hora_fim,
      cliente_id=@cliente_id, cliente_nome=@cliente_nome, telefone=@telefone,
      profissional_id=@profissional_id, produto_id=@produto_id, servico_nome=@servico_nome,
      valor=@valor, observacao=@observacao
    WHERE id=@id
  `).run({ ...d, id });
  // eslint-disable-next-line global-require
  require('./googleAgendaService').sincronizarAsync(id);
  return obter(id);
}

function mudarStatus(id, status) {
  const db = getDb();
  obter(id);
  if (!STATUS.includes(status)) throw new AppError('Status invalido.');
  db.prepare('UPDATE agendamentos SET status=? WHERE id=?').run(status, id);
  // eslint-disable-next-line global-require
  require('./googleAgendaService').sincronizarAsync(id);
  return obter(id);
}

function excluir(id) {
  const db = getDb();
  const a = obter(id);
  if (a.venda_id) throw new AppError('Este agendamento ja foi faturado; cancele a venda no modulo de Vendas.');
  db.prepare('DELETE FROM agendamentos WHERE id = ?').run(id);
  // eslint-disable-next-line global-require
  require('./googleAgendaService').excluirEventoAsync(id, a.google_event_id);
  return { ok: true };
}

/**
 * Fatura o agendamento: gera a venda do servico (sem estoque) e marca como
 * atendido. Exige que o agendamento esteja vinculado a um servico do cadastro.
 */
function faturar(id, { forma_pagamento = 'dinheiro', vencimento_prazo } = {}) {
  const db = getDb();
  const a = obter(id);
  if (a.venda_id) throw new AppError('Este agendamento ja foi faturado.');
  if (a.status === 'cancelado') throw new AppError('Agendamento cancelado nao pode ser faturado.');
  if (!a.produto_id) throw new AppError('Vincule um servico do cadastro para faturar este agendamento.');
  if (!(Number(a.valor) > 0)) throw new AppError('Informe o valor do atendimento antes de faturar.');

  // eslint-disable-next-line global-require
  const vendasService = require('./vendasService');
  const venda = vendasService.criarVenda({
    itens: [{ produto_id: a.produto_id, quantidade: 1, preco_unitario: Number(a.valor) }],
    cliente_id: a.cliente_id || null,
    pagamentos: [{ forma_pagamento, valor: Number(a.valor) }],
    vencimento_prazo: vencimento_prazo || null,
    observacao: `Agendamento #${a.id}`,
  });

  db.prepare("UPDATE agendamentos SET venda_id=?, status='atendido' WHERE id=?").run(venda.id, id);
  // eslint-disable-next-line global-require
  require('./googleAgendaService').sincronizarAsync(id);
  return { agendamento: obter(id), venda };
}

/** Resumo do dia (para o cabecalho da agenda). */
function resumoDia(data) {
  const db = getDb();
  // Dia suspenso (feriado, ferias) nao e um agendamento pendente nem entra
  // no total do dia — nao vai ter aula nenhuma, contar ele so infla o
  // "pendentes" com algo que ninguem vai atender.
  const r = db.prepare(`
    SELECT COUNT(*) total,
      COALESCE(SUM(CASE WHEN status='atendido' THEN 1 ELSE 0 END),0) atendidos,
      COALESCE(SUM(CASE WHEN status IN ('agendado','confirmado') THEN 1 ELSE 0 END),0) pendentes,
      COALESCE(SUM(CASE WHEN status IN ('agendado','confirmado','atendido') THEN valor ELSE 0 END),0) previsto
    FROM agendamentos a WHERE data = ? AND suspensa = 0
      AND (a.turma_id IS NULL OR NOT EXISTS (SELECT 1 FROM turmas t WHERE t.id = a.turma_id AND t.status = 'cancelada'))
  `).get(data);
  return { ...r, previsto: arred(r.previsto) };
}

// ------------------------------ Aulas recorrentes ------------------------------

function listarAulasRecorrentes() {
  return getDb().prepare(`
    SELECT r.*, c.nome AS aluno_cadastro_nome, p.nome AS profissional_nome
    FROM aulas_recorrentes r
    LEFT JOIN clientes c ON c.id = r.aluno_id
    LEFT JOIN profissionais p ON p.id = r.profissional_id
    ORDER BY (r.ativa = 0), r.dia_semana, r.hora_inicio
  `).all();
}

function validarAulaRecorrente(dados) {
  const diaSemana = Number(dados.dia_semana);
  if (Number.isNaN(diaSemana) || diaSemana < 0 || diaSemana > 6) throw new AppError('Selecione o dia da semana.');
  if (!dados.hora_inicio) throw new AppError('Informe o horário da aula.');
  if (!dados.aluno_id && !(dados.aluno_nome || '').trim()) throw new AppError('Informe o aluno.');
  if (dados.data_fim && dados.data_inicio && dados.data_fim < dados.data_inicio) {
    throw new AppError('A data de encerramento não pode ser anterior ao início.');
  }
  return {
    aluno_id: dados.aluno_id ? Number(dados.aluno_id) : null,
    aluno_nome: (dados.aluno_nome || '').trim() || null,
    profissional_id: dados.profissional_id ? Number(dados.profissional_id) : null,
    produto_id: dados.produto_id ? Number(dados.produto_id) : null,
    materia_nome: (dados.materia_nome || '').trim() || null,
    dia_semana: diaSemana,
    hora_inicio: dados.hora_inicio,
    hora_fim: dados.hora_fim || null,
    valor: arred(Number(dados.valor || 0)),
    telefone: (dados.telefone || '').trim() || null,
    data_inicio: dados.data_inicio || hoje(),
    data_fim: dados.data_fim || null,
    observacao: (dados.observacao || '').trim() || null,
  };
}

function criarAulaRecorrente(dados) {
  const db = getDb();
  const d = validarAulaRecorrente(dados);
  if (d.produto_id) {
    const serv = db.prepare('SELECT nome, preco_venda, duracao_min FROM produtos WHERE id = ?').get(d.produto_id);
    if (serv) {
      if (!d.materia_nome) d.materia_nome = serv.nome;
      if (!d.valor) d.valor = arred(Number(serv.preco_venda || 0));
      if (!d.hora_fim && serv.duracao_min) d.hora_fim = somarMinutos(d.hora_inicio, serv.duracao_min);
    }
  }
  const info = db.prepare(`
    INSERT INTO aulas_recorrentes (aluno_id, aluno_nome, profissional_id, produto_id, materia_nome,
      dia_semana, hora_inicio, hora_fim, valor, telefone, data_inicio, data_fim, observacao)
    VALUES (@aluno_id, @aluno_nome, @profissional_id, @produto_id, @materia_nome,
      @dia_semana, @hora_inicio, @hora_fim, @valor, @telefone, @data_inicio, @data_fim, @observacao)
  `).run(d);
  gerarOcorrenciasPendentes();
  return getDb().prepare('SELECT * FROM aulas_recorrentes WHERE id = ?').get(info.lastInsertRowid);
}

function atualizarAulaRecorrente(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM aulas_recorrentes WHERE id = ?').get(id);
  if (!atual) throw new AppError('Aula recorrente não encontrada.', 404);
  const d = validarAulaRecorrente({ ...atual, ...dados });
  const ativa = dados.ativa !== undefined ? (dados.ativa ? 1 : 0) : atual.ativa;
  db.prepare(`
    UPDATE aulas_recorrentes SET aluno_id=@aluno_id, aluno_nome=@aluno_nome, profissional_id=@profissional_id,
      produto_id=@produto_id, materia_nome=@materia_nome, dia_semana=@dia_semana, hora_inicio=@hora_inicio,
      hora_fim=@hora_fim, valor=@valor, telefone=@telefone, data_inicio=@data_inicio, data_fim=@data_fim,
      observacao=@observacao, ativa=@ativa
    WHERE id=@id
  `).run({ ...d, ativa, id });
  if (ativa) gerarOcorrenciasPendentes();
  return db.prepare('SELECT * FROM aulas_recorrentes WHERE id = ?').get(id);
}

/** Remove o "molde". As aulas (agendamentos) ja geradas nao sao apagadas — mesmo padrao de contas fixas/assinaturas. */
function excluirAulaRecorrente(id) {
  getDb().prepare('DELETE FROM aulas_recorrentes WHERE id = ?').run(id);
  return { ok: true };
}

/**
 * Gera os agendamentos das aulas recorrentes ativas para os proximos 60 dias
 * (a partir de hoje, respeitando data_inicio/data_fim de cada uma). So cria
 * o que ainda nao existe para aquele dia — idempotente, pode ser chamada
 * varias vezes (na inicializacao do app e ao abrir a Agenda) sem duplicar.
 */
function gerarOcorrenciasPendentes() {
  const db = getDb();
  const aulas = db.prepare('SELECT * FROM aulas_recorrentes WHERE ativa = 1').all();
  if (!aulas.length) return { geradas: 0 };

  const HORIZONTE_DIAS = 60;
  const hojeD = new Date(); hojeD.setHours(0, 0, 0, 0);
  const limiteD = new Date(hojeD); limiteD.setDate(limiteD.getDate() + HORIZONTE_DIAS);

  let geradas = 0;
  const tx = db.transaction(() => {
    const jaTem = db.prepare('SELECT 1 FROM agendamentos WHERE aula_recorrente_id = ? AND data = ?');
    const inserir = db.prepare(`
      INSERT INTO agendamentos (data, hora_inicio, hora_fim, cliente_id, cliente_nome, telefone,
        profissional_id, produto_id, servico_nome, valor, status, aula_recorrente_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'agendado', ?)
    `);
    for (const a of aulas) {
      const inicioD = new Date(Math.max(hojeD.getTime(), new Date(a.data_inicio + 'T00:00:00').getTime()));
      const fimD = a.data_fim
        ? new Date(Math.min(limiteD.getTime(), new Date(a.data_fim + 'T00:00:00').getTime()))
        : limiteD;
      for (let d = new Date(inicioD); d <= fimD; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== a.dia_semana) continue;
        const dataISO = d.toISOString().slice(0, 10);
        if (jaTem.get(a.id, dataISO)) continue;
        inserir.run(
          dataISO, a.hora_inicio, a.hora_fim, a.aluno_id, a.aluno_nome, a.telefone,
          a.profissional_id, a.produto_id, a.materia_nome, a.valor, a.id
        );
        geradas++;
      }
    }
  });
  tx();
  return { geradas };
}

function removerFotoArquivo(nomeArquivo) {
  try {
    const p = path.join(paths.pessoasImgDir, path.basename(nomeArquivo));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) { /* ignora falha ao remover arquivo antigo */ }
}

/** Troca a foto do profissional (voluntário/contratado), removendo a anterior do disco. */
function atualizarFotoProfissional(id, fotoPath) {
  const db = getDb();
  const atual = db.prepare('SELECT foto_path FROM profissionais WHERE id = ?').get(id);
  if (!atual) throw new AppError('Profissional não encontrado.', 404);
  if (atual.foto_path) removerFotoArquivo(atual.foto_path);
  db.prepare('UPDATE profissionais SET foto_path = ? WHERE id = ?').run(fotoPath, id);
  return obterProfissional(id);
}

module.exports = {
  STATUS,
  listarProfissionais, obterProfissional, criarProfissional, atualizarProfissional, excluirProfissional,
  atualizarFotoProfissional,
  listar, obter, criar, atualizar, mudarStatus, excluir, faturar, resumoDia,
  listarAulasRecorrentes, criarAulaRecorrente, atualizarAulaRecorrente, excluirAulaRecorrente, gerarOcorrenciasPendentes,
};
