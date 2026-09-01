'use strict';

/**
 * Diretoria e equipe administrativa do instituto: presidente, tesoureiro,
 * secretario, conselho fiscal.
 *
 * Guarda o mandato porque em entidade sem fins lucrativos o cargo tem prazo
 * — e quem assina recibo e declaracao muda quando a diretoria troca.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { hoje: hojeISO } = require('../utils/datas');

const CARGOS = [
  'presidente', 'vice_presidente', 'tesoureiro', 'vice_tesoureiro',
  'secretario', 'vice_secretario', 'conselho_fiscal', 'diretor',
  'coordenador', 'outro',
];

const ROTULO_CARGO = {
  presidente: 'Presidente',
  vice_presidente: 'Vice-presidente',
  tesoureiro: 'Tesoureiro(a)',
  vice_tesoureiro: 'Vice-tesoureiro(a)',
  secretario: 'Secretário(a)',
  vice_secretario: 'Vice-secretário(a)',
  conselho_fiscal: 'Conselho fiscal',
  diretor: 'Diretor(a)',
  coordenador: 'Coordenador(a)',
  outro: 'Outro',
};

function listar({ incluir_inativos } = {}) {
  const hoje = hojeISO();
  return getDb().prepare(`
    SELECT *,
      CASE WHEN mandato_fim IS NOT NULL AND mandato_fim < @hoje THEN 1 ELSE 0 END AS mandato_vencido
    FROM membros_instituto
    ${incluir_inativos ? '' : 'WHERE ativo = 1'}
    ORDER BY ativo DESC, nome COLLATE NOCASE
  `).all({ hoje }).map((m) => ({ ...m, cargo_rotulo: ROTULO_CARGO[m.cargo] || m.cargo }));
}

function obter(id) {
  const m = getDb().prepare('SELECT * FROM membros_instituto WHERE id = ?').get(id);
  if (!m) throw new AppError('Membro não encontrado.', 404);
  m.cargo_rotulo = ROTULO_CARGO[m.cargo] || m.cargo;
  return m;
}

function validar(dados) {
  const nome = (dados.nome || '').trim();
  if (!nome) throw new AppError('Informe o nome do membro.');

  const inicio = (dados.mandato_inicio || '').trim() || null;
  const fim = (dados.mandato_fim || '').trim() || null;
  if (inicio && !/^\d{4}-\d{2}-\d{2}$/.test(inicio)) throw new AppError('Data de início do mandato inválida.');
  if (fim && !/^\d{4}-\d{2}-\d{2}$/.test(fim)) throw new AppError('Data de fim do mandato inválida.');
  if (inicio && fim && fim < inicio) throw new AppError('O fim do mandato não pode ser antes do início.');

  return {
    nome,
    cargo: CARGOS.includes(dados.cargo) ? dados.cargo : 'outro',
    documento: (dados.documento || '').trim() || null,
    telefone: (dados.telefone || '').trim() || null,
    email: (dados.email || '').trim() || null,
    mandato_inicio: inicio,
    mandato_fim: fim,
    assina_documentos: dados.assina_documentos ? 1 : 0,
    observacao: (dados.observacao || '').trim() || null,
  };
}

function criar(dados) {
  const d = validar(dados);
  const info = getDb().prepare(`
    INSERT INTO membros_instituto (nome, cargo, documento, telefone, email,
      mandato_inicio, mandato_fim, assina_documentos, observacao)
    VALUES (@nome, @cargo, @documento, @telefone, @email,
      @mandato_inicio, @mandato_fim, @assina_documentos, @observacao)
  `).run(d);
  return obter(info.lastInsertRowid);
}

function atualizar(id, dados) {
  const atual = obter(id);
  const d = validar({ ...atual, ...dados });
  const ativo = dados.ativo !== undefined ? (dados.ativo ? 1 : 0) : atual.ativo;
  getDb().prepare(`
    UPDATE membros_instituto SET nome=@nome, cargo=@cargo, documento=@documento, telefone=@telefone,
      email=@email, mandato_inicio=@mandato_inicio, mandato_fim=@mandato_fim,
      assina_documentos=@assina_documentos, observacao=@observacao, ativo=@ativo
    WHERE id=@id
  `).run({ ...d, ativo, id });
  return obter(id);
}

function excluir(id) {
  obter(id);
  getDb().prepare('DELETE FROM membros_instituto WHERE id = ?').run(id);
  return { ok: true };
}

/**
 * Quem assina os documentos (recibo de doacao, declaracao de voluntariado).
 * Prefere quem esta marcado para assinar; se ninguem estiver, cai no
 * presidente com mandato em dia.
 */
function assinante() {
  const db = getDb();
  const hoje = hojeISO();
  const marcado = db.prepare(`
    SELECT * FROM membros_instituto
    WHERE ativo = 1 AND assina_documentos = 1
      AND (mandato_fim IS NULL OR mandato_fim >= @hoje)
    ORDER BY CASE cargo WHEN 'presidente' THEN 0 ELSE 1 END, nome LIMIT 1
  `).get({ hoje });
  const escolhido = marcado || db.prepare(`
    SELECT * FROM membros_instituto
    WHERE ativo = 1 AND cargo = 'presidente' AND (mandato_fim IS NULL OR mandato_fim >= @hoje)
    ORDER BY nome LIMIT 1
  `).get({ hoje });
  if (!escolhido) return null;
  return { nome: escolhido.nome, cargo: ROTULO_CARGO[escolhido.cargo] || escolhido.cargo };
}

module.exports = { listar, obter, criar, atualizar, excluir, assinante, CARGOS, ROTULO_CARGO };
