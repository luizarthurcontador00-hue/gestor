'use strict';

const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const paths = require('../paths');
const { AppError } = require('../utils/errors');

paths.ensureDirs();

const EXT_PERMITIDAS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, paths.produtosImgDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const nome = crypto.randomBytes(8).toString('hex') + '_' + Date.now() + ext;
    cb(null, nome);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!EXT_PERMITIDAS.includes(ext)) {
    return cb(new AppError('Formato de imagem nao suportado. Use JPG, PNG, WEBP ou GIF.'));
  }
  cb(null, true);
}

const uploadFoto = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ----------------------- Upload de foto de pessoa (aluno/voluntário) -----------------------
const storagePessoa = multer.diskStorage({
  destination: (req, file, cb) => cb(null, paths.pessoasImgDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const nome = crypto.randomBytes(8).toString('hex') + '_' + Date.now() + ext;
    cb(null, nome);
  },
});

const uploadFotoPessoa = multer({
  storage: storagePessoa,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ----------------------- Upload de XML de NF-e -----------------------
const storageXml = multer.diskStorage({
  destination: (req, file, cb) => cb(null, paths.notasDir),
  filename: (req, file, cb) => {
    const nome = crypto.randomBytes(8).toString('hex') + '_' + Date.now() + '.xml';
    cb(null, nome);
  },
});

function xmlFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const okTipo = /xml/i.test(file.mimetype) || ext === '.xml';
  if (!okTipo) return cb(new AppError('Envie um arquivo XML de NF-e.'));
  cb(null, true);
}

const uploadXml = multer({
  storage: storageXml,
  fileFilter: xmlFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ----------------------- Upload de planilha (cadastro em lote) -----------------------
// Fica so em memoria: e apenas interpretada (parse) e descartada, nunca persistida em disco.
function planilhaFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
    return cb(new AppError('Envie um arquivo de planilha (.xlsx, .xls ou .csv).'));
  }
  cb(null, true);
}

const uploadPlanilha = multer({
  storage: multer.memoryStorage(),
  fileFilter: planilhaFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ----------------------- Upload de extrato OFX (conciliacao bancaria) -----------------------
// So fica em memoria: e interpretado (parse das transacoes) e descartado, nunca persistido em disco.
function ofxFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== '.ofx') return cb(new AppError('Envie um arquivo .ofx exportado do seu banco.'));
  cb(null, true);
}

const uploadOfx = multer({
  storage: multer.memoryStorage(),
  fileFilter: ofxFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ----------------------- Upload de anexo/audio do Atendimento (WhatsApp) -----------------------
const storageWhatsapp = multer.diskStorage({
  destination: (req, file, cb) => cb(null, paths.whatsappMidiaDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const nome = crypto.randomBytes(8).toString('hex') + '_' + Date.now() + ext;
    cb(null, nome);
  },
});

const uploadWhatsappMidia = multer({
  storage: storageWhatsapp,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// ----------------------- Upload de certificado digital (.pfx) para NFS-e -----------------------
// So existe um certificado por instalacao: nome fixo, sempre sobrescreve o anterior.
const storageCertificado = multer.diskStorage({
  destination: (req, file, cb) => cb(null, paths.certificadosDir),
  filename: (req, file, cb) => cb(null, 'certificado.pfx'),
});

function certificadoFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.pfx', '.p12'].includes(ext)) {
    return cb(new AppError('Envie um arquivo de certificado digital (.pfx ou .p12).'));
  }
  cb(null, true);
}

const uploadCertificado = multer({
  storage: storageCertificado,
  fileFilter: certificadoFilter,
  limits: { fileSize: 100 * 1024 }, // 100 KB — um .pfx tipico tem poucos KB
});

module.exports = { uploadFoto, uploadFotoPessoa, uploadXml, uploadPlanilha, uploadWhatsappMidia, uploadOfx, uploadCertificado };
