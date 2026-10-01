'use strict';

const express = require('express');
const { asyncHandler, AppError } = require('../utils/errors');
const { uploadFotoPessoa } = require('../middleware/upload');
const ag = require('../services/agendaService');

const router = express.Router();

// Profissionais / equipe
router.get('/profissionais', asyncHandler((req, res) => res.json(ag.listarProfissionais({ incluir_inativos: req.query.incluir_inativos === '1' }))));
router.get('/profissionais/:id', asyncHandler((req, res) => res.json(ag.obterProfissional(req.params.id))));
router.post('/profissionais', asyncHandler((req, res) => res.status(201).json(ag.criarProfissional(req.body || {}))));
router.put('/profissionais/:id', asyncHandler((req, res) => res.json(ag.atualizarProfissional(req.params.id, req.body || {}))));
router.delete('/profissionais/:id', asyncHandler((req, res) => res.json(ag.excluirProfissional(req.params.id))));
router.post('/profissionais/:id/foto', uploadFotoPessoa.single('foto'), asyncHandler((req, res) => {
  if (!req.file) throw new AppError('Envie uma imagem.');
  res.json(ag.atualizarFotoProfissional(req.params.id, req.file.filename));
}));

// Aulas recorrentes (aula fixa semanal)
router.get('/aulas-recorrentes', asyncHandler((req, res) => res.json(ag.listarAulasRecorrentes(req.query))));
router.post('/aulas-recorrentes', asyncHandler((req, res) => res.status(201).json(ag.criarAulaRecorrente(req.body || {}))));
router.put('/aulas-recorrentes/:id', asyncHandler((req, res) => res.json(ag.atualizarAulaRecorrente(req.params.id, req.body || {}))));
router.delete('/aulas-recorrentes/:id', asyncHandler((req, res) => res.json(ag.excluirAulaRecorrente(req.params.id))));
router.post('/aulas-recorrentes/gerar-pendentes', asyncHandler((req, res) => res.json(ag.gerarOcorrenciasPendentes())));

// Agendamentos
router.get('/resumo', asyncHandler((req, res) => res.json(ag.resumoDia(req.query.data))));
router.get('/', asyncHandler((req, res) => res.json(ag.listar(req.query))));
router.get('/:id', asyncHandler((req, res) => res.json(ag.obter(req.params.id))));
router.post('/', asyncHandler((req, res) => res.status(201).json(ag.criar(req.body || {}))));
router.put('/:id', asyncHandler((req, res) => res.json(ag.atualizar(req.params.id, req.body || {}))));
router.post('/:id/status', asyncHandler((req, res) => res.json(ag.mudarStatus(req.params.id, req.body && req.body.status))));
router.post('/:id/remarcar', asyncHandler((req, res) => res.json(ag.remarcar(req.params.id, req.body || {}))));
router.post('/:id/faturar', asyncHandler((req, res) => res.json(ag.faturar(req.params.id, req.body || {}))));
router.delete('/:id', asyncHandler((req, res) => res.json(ag.excluir(req.params.id))));

module.exports = router;
