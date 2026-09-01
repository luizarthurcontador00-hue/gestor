'use strict';

/**
 * Cadastro em lote (grade ou importacao de planilha): acha-ou-cria
 * categoria/fornecedor por nome, detecta duplicidade e cadastra cada linha
 * de forma independente, alimentando Precificacao e Conferencia ao final.
 */

const { getDb } = require('../../db/connection');
const { AppError } = require('../../utils/errors');
const { criar, obter, dataHoraRotulo } = require('./core');
const { garantirCodigoBarras } = require('./codigoBarras');

/** Le a config que liga a geracao automatica de codigo de barras na importacao. */
function codigoAutoLigado(db) {
  const row = db.prepare("SELECT valor FROM config WHERE chave = 'gerar_codigo_auto'").get();
  // Padrao ligado quando a chave nao existe.
  return !row || row.valor == null ? true : String(row.valor) === '1';
}

function acharOuCriarCategoria(db, nome) {
  const limpo = (nome || '').toString().trim();
  if (!limpo) return null;
  const existente = db.prepare('SELECT id FROM categorias WHERE nome = ? COLLATE NOCASE').get(limpo);
  if (existente) return existente.id;
  return db.prepare('INSERT INTO categorias (nome) VALUES (?)').run(limpo).lastInsertRowid;
}

function acharOuCriarFornecedor(db, nome) {
  const limpo = (nome || '').toString().trim();
  if (!limpo) return null;
  const existente = db.prepare('SELECT id FROM fornecedores WHERE nome = ? COLLATE NOCASE').get(limpo);
  if (existente) return existente.id;
  return db.prepare('INSERT INTO fornecedores (nome) VALUES (?)').run(limpo).lastInsertRowid;
}

/**
 * Confere se ja existe produto ativo com o mesmo codigo de barras ou o mesmo
 * nome (sem diferenciar maiusculas/espacos) — evita duplicar cadastro de
 * quem ja esta na base, o erro mais comum de digitar um lote grande as
 * pressas ou reimportar a mesma planilha por engano.
 */
function acharDuplicado(db, { nome, codigo_barras }) {
  const codigo = String(codigo_barras || '').trim();
  if (codigo) {
    const porCodigo = db.prepare('SELECT id, nome FROM produtos WHERE ativo = 1 AND codigo_barras = ?').get(codigo);
    if (porCodigo) return { campo: 'codigo_barras', produto: porCodigo };
  }
  const nomeNorm = String(nome || '').trim().toLowerCase();
  if (nomeNorm) {
    const porNome = db.prepare("SELECT id, nome FROM produtos WHERE ativo = 1 AND LOWER(TRIM(nome)) = ?").get(nomeNorm);
    if (porNome) return { campo: 'nome', produto: porNome };
  }
  return null;
}

/**
 * Cadastra varios produtos de uma vez (grade de cadastro em lote ou
 * importacao de planilha). Cada linha e processada de forma independente:
 * um erro numa linha nao impede as demais de serem salvas. Categoria e
 * fornecedor podem vir por nome (texto): sao localizados ou criados na hora.
 */
function criarLote(linhas) {
  if (!Array.isArray(linhas) || !linhas.length) {
    throw new AppError('Nenhum produto para cadastrar.');
  }
  const db = getDb();
  const resultados = linhas.map((linha, idx) => {
    try {
      if (!linha.nome || !String(linha.nome).trim()) {
        throw new AppError('Informe o nome do produto.');
      }
      const duplicado = acharDuplicado(db, { nome: linha.nome, codigo_barras: linha.codigo_barras });
      if (duplicado) {
        const comoQue = duplicado.campo === 'codigo_barras' ? 'com esse código de barras' : 'com esse nome';
        throw new AppError(`Já existe um produto cadastrado ${comoQue}: "${duplicado.produto.nome}" (#${duplicado.produto.id}).`);
      }
      // Importacao: se o usuario nao digitou um preco na grade, o produto fica
      // sem preco (0) e sera precificado na aba Precificacao.
      const dados = { ...linha, _semPrecoAuto: true };
      if (linha.categoria) dados.categoria_id = acharOuCriarCategoria(db, linha.categoria);
      if (linha.fornecedor) dados.fornecedor_id = acharOuCriarFornecedor(db, linha.fornecedor);
      let produto = criar(dados);
      // Gera codigo de barras interno automaticamente (se ligado nas Config).
      if (codigoAutoLigado(db) && !(produto.codigo_barras && String(produto.codigo_barras).replace(/\D/g, '').length === 13)) {
        garantirCodigoBarras(produto.id);
        produto = obter(produto.id);
      }
      return { linha: idx + 1, sucesso: true, produto };
    } catch (e) {
      return { linha: idx + 1, sucesso: false, nome: linha.nome || null, erro: (e && e.message) || 'Erro desconhecido.' };
    }
  });
  // Envia os produtos criados para a planilha de Precificacao, agrupados por
  // um lote com data/hora, para o usuario definir os precos por markup divisor.
  const criados = resultados.filter((r) => r.sucesso).map((r) => ({
    produto_id: r.produto.id,
    referencia: r.produto.codigo_barras,
    descricao: r.produto.nome,
    quantidade: 1,
    valor_pedido: Number(r.produto.custo || 0),
  }));
  let lotePrecificacao = null;
  let loteConferencia = null;
  if (criados.length) {
    // eslint-disable-next-line global-require
    const prec = require('../precAvancadaService');
    // eslint-disable-next-line global-require
    const conferencia = require('../conferenciaService');
    const rotulo = `Cadastro em lote ${dataHoraRotulo()}`;
    prec.importarProdutos(criados, rotulo);
    // A conferencia usa a quantidade que o usuario digitou na grade (o que
    // deveria chegar fisicamente), diferente da precificacao que so importa
    // o valor unitario.
    const paraConferir = resultados.filter((r) => r.sucesso).map((r) => ({
      produto_id: r.produto.id,
      referencia: r.produto.codigo_barras,
      descricao: r.produto.nome,
      quantidade: Number(r.produto.estoque_atual || 0),
    }));
    conferencia.importarProdutos(paraConferir, rotulo);
    lotePrecificacao = rotulo;
    loteConferencia = rotulo;
  }

  return {
    total: resultados.length,
    criados: resultados.filter((r) => r.sucesso).length,
    erros: resultados.filter((r) => !r.sucesso).length,
    resultados,
    lote_precificacao: lotePrecificacao,
    lote_conferencia: loteConferencia,
  };
}

module.exports = { codigoAutoLigado, acharOuCriarCategoria, acharOuCriarFornecedor, acharDuplicado, criarLote };
