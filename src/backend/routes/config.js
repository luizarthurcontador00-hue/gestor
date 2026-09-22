'use strict';

const express = require('express');
const { getDb } = require('../db/connection');
const { asyncHandler } = require('../utils/errors');

const router = express.Router();

// Chaves de configuracao editaveis pela tela de Configuracoes.
const CHAVES_LOJA = [
  'nome_loja', 'loja_endereco', 'loja_telefone', 'loja_cnpj', 'loja_rodape_cupom', 'markup_padrao', 'meta_mensal_faturamento',
  'pix_chave', 'pix_nome_recebedor', 'pix_cidade',
  'gerar_codigo_auto', 'perfil_negocio', 'ramo_servico', 'creche_com_turma', 'onboarding_ok', 'loja_logo', 'loja_cidade', 'cor_primaria', 'fonte_escala', 'tema',
  // Modulo fiscal: NFC-e/NF-e via gateway externo (Focus NFe)
  'fiscal_regime_tributario', 'fiscal_inscricao_estadual', 'fiscal_inscricao_municipal',
  'fiscal_gateway', 'fiscal_ambiente', 'fiscal_token',
  // Modulo fiscal: NFS-e direto pelo Portal Nacional (gov.br) — certificado
  // digital + dados do prestador exigidos pela DPS.
  'fiscal_nfse_ambiente', 'fiscal_nfse_municipio_ibge', 'fiscal_nfse_certificado_senha',
  'fiscal_nfse_op_simples_nacional', 'fiscal_nfse_regime_especial_trib',
];

function lerConfig() {
  const db = getDb();
  const linhas = db.prepare('SELECT chave, valor FROM config').all();
  const obj = {};
  linhas.forEach((l) => { obj[l.chave] = l.valor; });
  return obj;
}

router.get('/', asyncHandler((req, res) => {
  res.json(lerConfig());
}));

router.put('/', asyncHandler((req, res) => {
  const db = getDb();
  const upsert = db.prepare(
    'INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor'
  );
  const body = req.body || {};
  const tx = db.transaction(() => {
    Object.keys(body).forEach((chave) => {
      // So permite gravar chaves conhecidas da loja (evita lixo na config).
      if (CHAVES_LOJA.includes(chave)) upsert.run(chave, body[chave] == null ? '' : String(body[chave]));
    });
  });
  tx();
  res.json(lerConfig());
}));

module.exports = router;
