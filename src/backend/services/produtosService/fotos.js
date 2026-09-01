'use strict';

/** Galeria de fotos do produto: listar, adicionar, definir principal, remover. */

const { getDb } = require('../../db/connection');
const { AppError } = require('../../utils/errors');
const { obter, removerFotoArquivo } = require('./core');

function listarFotos(produtoId) {
  const db = getDb();
  return db.prepare(
    'SELECT id, arquivo, ordem, principal FROM produtos_fotos WHERE produto_id = ? ORDER BY principal DESC, ordem, id'
  ).all(produtoId);
}

/** Sincroniza produtos.foto_path com a foto principal atual (ou a primeira). */
function sincronizarFotoPrincipal(db, produtoId) {
  const principal = db.prepare(
    'SELECT arquivo FROM produtos_fotos WHERE produto_id = ? ORDER BY principal DESC, ordem, id LIMIT 1'
  ).get(produtoId);
  db.prepare("UPDATE produtos SET foto_path = ?, atualizado_em = datetime('now','localtime') WHERE id = ?")
    .run(principal ? principal.arquivo : null, produtoId);
}

/** Adiciona uma ou mais fotos (nomes de arquivo ja salvos em disco). */
function adicionarFotos(produtoId, arquivos) {
  const db = getDb();
  obter(produtoId); // garante existencia (404 amigavel)
  const lista = (Array.isArray(arquivos) ? arquivos : []).filter(Boolean);
  if (!lista.length) throw new AppError('Nenhuma foto enviada.');
  const tx = db.transaction(() => {
    const jaTem = db.prepare('SELECT COUNT(*) c FROM produtos_fotos WHERE produto_id = ?').get(produtoId).c;
    let ordem = db.prepare('SELECT COALESCE(MAX(ordem),-1)+1 o FROM produtos_fotos WHERE produto_id = ?').get(produtoId).o;
    const ins = db.prepare('INSERT INTO produtos_fotos (produto_id, arquivo, ordem, principal) VALUES (?, ?, ?, ?)');
    lista.forEach((arq, i) => {
      // A primeira foto de um produto sem nenhuma vira a principal.
      const principal = (jaTem === 0 && i === 0) ? 1 : 0;
      ins.run(produtoId, arq, ordem++, principal);
    });
    sincronizarFotoPrincipal(db, produtoId);
  });
  tx();
  return listarFotos(produtoId);
}

function definirFotoPrincipal(produtoId, fotoId) {
  const db = getDb();
  const foto = db.prepare('SELECT * FROM produtos_fotos WHERE id = ? AND produto_id = ?').get(fotoId, produtoId);
  if (!foto) throw new AppError('Foto nao encontrada.', 404);
  const tx = db.transaction(() => {
    db.prepare('UPDATE produtos_fotos SET principal = 0 WHERE produto_id = ?').run(produtoId);
    db.prepare('UPDATE produtos_fotos SET principal = 1 WHERE id = ?').run(fotoId);
    sincronizarFotoPrincipal(db, produtoId);
  });
  tx();
  return listarFotos(produtoId);
}

function removerFoto(produtoId, fotoId) {
  const db = getDb();
  const foto = db.prepare('SELECT * FROM produtos_fotos WHERE id = ? AND produto_id = ?').get(fotoId, produtoId);
  if (!foto) throw new AppError('Foto nao encontrada.', 404);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM produtos_fotos WHERE id = ?').run(fotoId);
    // Se removeu a principal, promove a proxima.
    const restam = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(principal),0) p FROM produtos_fotos WHERE produto_id = ?').get(produtoId);
    if (restam.c > 0 && restam.p === 0) {
      const proxima = db.prepare('SELECT id FROM produtos_fotos WHERE produto_id = ? ORDER BY ordem, id LIMIT 1').get(produtoId);
      if (proxima) db.prepare('UPDATE produtos_fotos SET principal = 1 WHERE id = ?').run(proxima.id);
    }
    sincronizarFotoPrincipal(db, produtoId);
  });
  tx();
  removerFotoArquivo(foto.arquivo);
  return listarFotos(produtoId);
}

module.exports = { listarFotos, adicionarFotos, definirFotoPrincipal, removerFoto };
