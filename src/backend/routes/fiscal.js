'use strict';

const express = require('express');
const { asyncHandler, AppError } = require('../utils/errors');
const fiscal = require('../services/fiscalService');
const nfse = require('../services/nfseService');
const { uploadCertificado } = require('../middleware/upload');
const { getDb } = require('../db/connection');

const router = express.Router();

router.get('/status', asyncHandler((req, res) => res.json({ configurado: fiscal.estaConfigurado() })));

router.get('/vendas/:vendaId/notas', asyncHandler((req, res) => res.json(fiscal.listarPorVenda(req.params.vendaId))));
router.post('/vendas/:vendaId/emitir-nfce', asyncHandler(async (req, res) => res.status(201).json(await fiscal.emitirNFCe(req.params.vendaId))));
router.post('/notas/:notaId/consultar', asyncHandler(async (req, res) => res.json(await fiscal.consultarStatus(req.params.notaId))));

// ----------------------- NFS-e (Portal Nacional) -----------------------
router.get('/nfse/status', asyncHandler((req, res) => res.json({
  configurado: nfse.estaConfigurado(),
  certificado: nfse.certificadoInfo(),
})));
router.post('/nfse/certificado', uploadCertificado.single('certificado'), asyncHandler((req, res) => {
  if (!req.file) throw new AppError('Selecione o arquivo do certificado digital (.pfx ou .p12).');
  const senha = (req.body && req.body.senha || '').trim();
  if (!senha) throw new AppError('Informe a senha do certificado.');
  getDb().prepare(
    "INSERT INTO config (chave, valor) VALUES ('fiscal_nfse_certificado_senha', ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor"
  ).run(senha);
  const info = nfse.certificadoInfo();
  if (!info) throw new AppError('Certificado salvo, mas não foi possível abri-lo — confira se a senha está correta.');
  res.status(201).json({ recebido: true, certificado: info });
}));
router.get('/nfse/aliquota', asyncHandler(async (req, res) => {
  const { codigoMunicipio, codigoServico, competencia } = req.query;
  if (!codigoMunicipio || !codigoServico || !competencia) {
    throw new AppError('Informe codigoMunicipio, codigoServico e competencia.');
  }
  res.json(await nfse.consultarAliquota(codigoMunicipio, codigoServico, competencia));
}));
router.post('/vendas/:vendaId/emitir-nfse', asyncHandler(async (req, res) => res.status(201).json(await nfse.emitirNFSe(req.params.vendaId))));
router.post('/notas/:notaId/consultar-nfse', asyncHandler(async (req, res) => res.json(await nfse.consultarNFSe(req.params.notaId))));

module.exports = router;
