'use strict';

/**
 * Resolve os caminhos de dados (banco e uploads) de forma que funcionem
 * tanto em desenvolvimento quanto no app empacotado.
 *
 * - Em desenvolvimento: usa a pasta ./data na raiz do projeto.
 * - No app empacotado (Electron): usa app.getPath('userData'), que e um
 *   local sempre gravavel (dentro do perfil do usuario no Windows).
 *
 * O modulo tenta usar o Electron quando disponivel; se estiver rodando o
 * backend "puro" (node), cai para a pasta local.
 */

const path = require('path');
const fs = require('fs');

function resolveBaseDir() {
  // Permite forcar um diretorio (util para testes / backup).
  if (process.env.GV_DATA_DIR) {
    return process.env.GV_DATA_DIR;
  }

  // Tenta usar o Electron (so existe quando rodando dentro do app).
  try {
    const electron = require('electron');
    const app = electron.app || (electron.remote && electron.remote.app);
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch (_) {
    // Electron nao disponivel (modo backend puro) -> segue para o fallback.
  }

  // Fallback para desenvolvimento: <raiz>/data
  return path.join(__dirname, '..', '..', 'data');
}

const baseDir = resolveBaseDir();
const uploadsDir = path.join(baseDir, 'uploads');
const produtosImgDir = path.join(uploadsDir, 'produtos');
const pessoasImgDir = path.join(uploadsDir, 'pessoas');
const notasDir = path.join(uploadsDir, 'notas');
const whatsappMidiaDir = path.join(uploadsDir, 'whatsapp');
const whatsappAuthDir = path.join(baseDir, 'whatsapp-auth');
const backupsDir = path.join(baseDir, 'backups');
const dbPath = path.join(baseDir, 'vendas.db');
// Certificado digital (.pfx) usado pra assinar a DPS da NFS-e. Fica fora de
// uploadsDir de proposito — nao e um "upload" comum, e um segredo do
// contribuinte; nunca e servido por rota estatica nenhuma.
const certificadosDir = path.join(baseDir, 'certificados');

function ensureDirs() {
  [baseDir, uploadsDir, produtosImgDir, pessoasImgDir, notasDir, whatsappMidiaDir, whatsappAuthDir, backupsDir, certificadosDir].forEach((dir) => {
    fs.mkdirSync(dir, { recursive: true });
  });
}

module.exports = {
  baseDir,
  uploadsDir,
  produtosImgDir,
  pessoasImgDir,
  notasDir,
  whatsappMidiaDir,
  whatsappAuthDir,
  backupsDir,
  certificadosDir,
  dbPath,
  ensureDirs,
};
