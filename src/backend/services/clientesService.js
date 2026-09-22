'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { arred } = require('./precificacaoService');
const paths = require('../paths');

function listar({ busca, incluir_inativos } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (!incluir_inativos) where.push('c.ativo = 1');
  if (busca) {
    where.push('(c.nome LIKE @b OR c.cpf LIKE @b OR c.telefone LIKE @b)');
    params.b = `%${busca}%`;
  }
  // Inclui o saldo devedor (contas a receber pendentes do cliente).
  return db.prepare(`
    SELECT c.*,
      (SELECT COALESCE(SUM(valor),0) FROM contas_receber cr
        WHERE cr.cliente_id = c.id AND cr.status = 'pendente') AS saldo_devedor
    FROM clientes c
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.nome COLLATE NOCASE
  `).all(params);
}

function obter(id) {
  const db = getDb();
  const c = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  if (!c) throw new AppError('Cliente nao encontrado.', 404);
  c.saldo_devedor = arred(db.prepare(
    "SELECT COALESCE(SUM(valor),0) s FROM contas_receber WHERE cliente_id = ? AND status='pendente'"
  ).get(id).s);
  c.compras = db.prepare(`
    SELECT id, data, valor_total, status FROM vendas
    WHERE cliente_id = ? ORDER BY id DESC LIMIT 50
  `).all(id);
  c.contas = db.prepare(`
    SELECT id, descricao, valor, vencimento, status FROM contas_receber
    WHERE cliente_id = ? ORDER BY (status!='pendente'), date(vencimento) LIMIT 100
  `).all(id);
  return c;
}

function dados(body) {
  const nome = (body.nome || '').trim();
  if (!nome) throw new AppError('O nome do cliente e obrigatorio.');
  return {
    nome,
    cpf: body.cpf ? String(body.cpf).replace(/\D/g, '') || null : null,
    telefone: body.telefone || null,
    email: body.email || null,
    endereco: body.endereco || null,
    limite_credito: Number(body.limite_credito || 0),
    observacao: body.observacao || null,
    // Instituto: a mesma pessoa pode ser aluno, mantenedor ou os dois.
    natureza: ['aluno', 'mantenedor', 'ambos'].includes(body.natureza) ? body.natureza : 'aluno',
    data_nascimento: body.data_nascimento || null,
    responsavel_nome: body.responsavel_nome || null,
    responsavel_telefone: body.responsavel_telefone || null,
    // Endereco estruturado — so' usado na hora de montar a DPS da NFS-e
    // (o cliente pode ser tomador de servico); opcional.
    endereco_cep: body.endereco_cep ? String(body.endereco_cep).replace(/\D/g, '') || null : null,
    endereco_logradouro: body.endereco_logradouro || null,
    endereco_numero: body.endereco_numero || null,
    endereco_complemento: body.endereco_complemento || null,
    endereco_bairro: body.endereco_bairro || null,
    endereco_municipio_ibge: body.endereco_municipio_ibge ? String(body.endereco_municipio_ibge).replace(/\D/g, '') || null : null,
    endereco_uf: body.endereco_uf ? String(body.endereco_uf).trim().toUpperCase().slice(0, 2) || null : null,
  };
}

function criar(body) {
  const db = getDb();
  const d = dados(body);
  const info = db.prepare(
    `INSERT INTO clientes (nome, cpf, telefone, email, endereco, limite_credito, observacao,
       natureza, data_nascimento, responsavel_nome, responsavel_telefone,
       endereco_cep, endereco_logradouro, endereco_numero, endereco_complemento,
       endereco_bairro, endereco_municipio_ibge, endereco_uf)
     VALUES (@nome, @cpf, @telefone, @email, @endereco, @limite_credito, @observacao,
       @natureza, @data_nascimento, @responsavel_nome, @responsavel_telefone,
       @endereco_cep, @endereco_logradouro, @endereco_numero, @endereco_complemento,
       @endereco_bairro, @endereco_municipio_ibge, @endereco_uf)`
  ).run(d);
  return obter(info.lastInsertRowid);
}

function atualizar(id, body) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  if (!atual) throw new AppError('Cliente nao encontrado.', 404);
  const d = dados({ ...atual, ...body });
  db.prepare(
    `UPDATE clientes SET nome=@nome, cpf=@cpf, telefone=@telefone, email=@email,
      endereco=@endereco, limite_credito=@limite_credito, observacao=@observacao,
      natureza=@natureza, data_nascimento=@data_nascimento,
      responsavel_nome=@responsavel_nome, responsavel_telefone=@responsavel_telefone,
      endereco_cep=@endereco_cep, endereco_logradouro=@endereco_logradouro,
      endereco_numero=@endereco_numero, endereco_complemento=@endereco_complemento,
      endereco_bairro=@endereco_bairro, endereco_municipio_ibge=@endereco_municipio_ibge,
      endereco_uf=@endereco_uf WHERE id=@id`
  ).run({ ...d, id });
  return obter(id);
}

function excluir(id) {
  const db = getDb();
  const temVenda = db.prepare('SELECT 1 FROM vendas WHERE cliente_id = ? LIMIT 1').get(id);
  const temConta = db.prepare('SELECT 1 FROM contas_receber WHERE cliente_id = ? LIMIT 1').get(id);
  if (temVenda || temConta) {
    db.prepare('UPDATE clientes SET ativo = 0 WHERE id = ?').run(id);
    return { inativado: true };
  }
  db.prepare('DELETE FROM clientes WHERE id = ?').run(id);
  return { excluido: true };
}

function removerFotoArquivo(nomeArquivo) {
  try {
    const p = path.join(paths.pessoasImgDir, path.basename(nomeArquivo));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) { /* ignora falha ao remover arquivo antigo */ }
}

/** Troca a foto do cliente (aluno), removendo a anterior do disco. */
function atualizarFoto(id, fotoPath) {
  const db = getDb();
  const atual = db.prepare('SELECT foto_path FROM clientes WHERE id = ?').get(id);
  if (!atual) throw new AppError('Cliente nao encontrado.', 404);
  if (atual.foto_path) removerFotoArquivo(atual.foto_path);
  db.prepare('UPDATE clientes SET foto_path = ? WHERE id = ?').run(fotoPath, id);
  return obter(id);
}

module.exports = { listar, obter, criar, atualizar, excluir, atualizarFoto };
