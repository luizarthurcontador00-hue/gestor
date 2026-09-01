'use strict';

/**
 * Lembretes soltos (nao ligados a nenhum modulo especifico): titulo, data e
 * um status de concluido. O sistema avisa quando a data chega/passa e o
 * lembrete ainda nao foi concluido.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { hoje } = require('../utils/datas');

function listar({ incluir_concluidos } = {}) {
  const db = getDb();
  const where = incluir_concluidos === '1' || incluir_concluidos === true ? '' : 'WHERE concluido = 0';
  return db.prepare(`
    SELECT * FROM lembretes ${where}
    ORDER BY concluido, date(data_lembrete)
  `).all();
}

function criar(dados) {
  const db = getDb();
  const titulo = (dados.titulo || '').trim();
  if (!titulo) throw new AppError('Informe o titulo do lembrete.');
  const dataLembrete = dados.data_lembrete || hoje();
  const info = db.prepare(
    'INSERT INTO lembretes (titulo, descricao, data_lembrete) VALUES (?, ?, ?)'
  ).run(titulo, dados.descricao || null, dataLembrete);
  return db.prepare('SELECT * FROM lembretes WHERE id = ?').get(info.lastInsertRowid);
}

function atualizar(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM lembretes WHERE id = ?').get(id);
  if (!atual) throw new AppError('Lembrete nao encontrado.', 404);
  const titulo = dados.titulo !== undefined ? (dados.titulo || '').trim() : atual.titulo;
  if (!titulo) throw new AppError('Informe o titulo do lembrete.');
  db.prepare('UPDATE lembretes SET titulo=?, descricao=?, data_lembrete=?, concluido=? WHERE id=?').run(
    titulo,
    dados.descricao !== undefined ? dados.descricao : atual.descricao,
    dados.data_lembrete !== undefined ? dados.data_lembrete : atual.data_lembrete,
    dados.concluido !== undefined ? (dados.concluido ? 1 : 0) : atual.concluido,
    id
  );
  return db.prepare('SELECT * FROM lembretes WHERE id = ?').get(id);
}

function excluir(id) {
  getDb().prepare('DELETE FROM lembretes WHERE id = ?').run(id);
  return { ok: true };
}

/** Lembretes vencidos (ate hoje) e nao concluidos — usado no aviso do topo. */
function pendentesVencidos() {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM lembretes WHERE concluido = 0 AND date(data_lembrete) <= date(?) ORDER BY date(data_lembrete)"
  ).all(hoje());
}

module.exports = { listar, criar, atualizar, excluir, pendentesVencidos };
