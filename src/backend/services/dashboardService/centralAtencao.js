'use strict';

/**
 * Central de Gestão: lista de pontos que precisam de atenção agora, cada um
 * com um nivel de urgencia (vermelho/laranja/amarelo/azul/verde) e uma rota
 * para onde o clique deve levar. O frontend monta o texto/emoji a partir do
 * "tipo" — aqui so vao os dados brutos (numeros), sem formatacao.
 */

const { getDb } = require('../../db/connection');
const { arred } = require('../precificacaoService');
const { hoje: hojeISO } = require('../../utils/datas');

function centralAtencao() {
  const db = getDb();
  const hoje = hojeISO();
  const itens = [];

  // 1) Contas vencendo hoje (pagar + receber).
  const hojePagar = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM contas_pagar WHERE status='pendente' AND date(vencimento)=date(?)").get(hoje);
  const hojeReceber = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM contas_receber WHERE status='pendente' AND date(vencimento)=date(?)").get(hoje);
  if (hojePagar.c + hojeReceber.c > 0) {
    itens.push({
      tipo: 'contas_hoje', nivel: 'vermelho', rota: 'financeiro', peso: 1,
      dados: {
        qtd: hojePagar.c + hojeReceber.c,
        qtd_pagar: hojePagar.c, valor_pagar: arred(hojePagar.v),
        qtd_receber: hojeReceber.c, valor_receber: arred(hojeReceber.v),
      },
    });
  }

  // 2) Contas atrasadas (pagar + receber).
  const atrasoPagar = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM contas_pagar WHERE status='pendente' AND date(vencimento)<date(?)").get(hoje);
  const atrasoReceber = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM contas_receber WHERE status='pendente' AND date(vencimento)<date(?)").get(hoje);
  if (atrasoPagar.c + atrasoReceber.c > 0) {
    itens.push({
      tipo: 'contas_atrasadas', nivel: 'vermelho', rota: 'financeiro', peso: 1,
      dados: {
        qtd: atrasoPagar.c + atrasoReceber.c,
        qtd_pagar: atrasoPagar.c, valor_pagar: arred(atrasoPagar.v),
        qtd_receber: atrasoReceber.c, valor_receber: arred(atrasoReceber.v),
      },
    });
  }

  const ramoCfg = db.prepare("SELECT valor FROM config WHERE chave = 'ramo_servico'").get();
  const ramoServico = ramoCfg && ramoCfg.valor;

  // Num instituto sem fins lucrativos nao existe venda, estoque nem meta de
  // faturamento: o panorama dele e outro (painelInstituto) e os alertas do
  // dia a dia ficam no sino de avisos. Aqui sobram so as contas e lembretes.
  // Creche tambem cobra mensalidade fixa e nao vende produto — mesmo
  // tratamento do instituto: so contas e lembretes, sem venda/estoque/meta.
  if (ramoServico === 'instituto' || ramoServico === 'creche') {
    // eslint-disable-next-line global-require
    const lembretesInstituto = require('../lembretesService').pendentesVencidos();
    if (lembretesInstituto.length > 0) {
      itens.push({ tipo: 'lembretes_vencidos', nivel: 'vermelho', rota: 'lembretes', peso: 1, dados: { qtd: lembretesInstituto.length } });
    }
    itens.sort((a, b) => a.peso - b.peso);
    return { itens };
  }

  // 3) Produtos abaixo do estoque minimo (so faz sentido para quem vende produtos;
  // nunca para o ramo "professor", que nao tem produto nenhum por definicao).
  if (ramoServico !== 'professor') {
    const estoqueBaixo = db.prepare('SELECT COUNT(*) c FROM produtos WHERE ativo=1 AND eh_servico=0 AND eh_kit=0 AND estoque_atual <= estoque_minimo').get().c;
    if (estoqueBaixo > 0) {
      itens.push({ tipo: 'estoque_baixo', nivel: 'laranja', rota: 'produtos', peso: 2, dados: { qtd: estoqueBaixo } });
    }
  }

  // 4) Faturamento do mes (ate hoje) vs o mesmo intervalo de dias no mes anterior.
  const mesIni = hoje.slice(0, 8) + '01';
  const [ano, mes, dia] = hoje.split('-').map(Number);
  const mesAntIni = new Date(ano, mes - 2, 1).toISOString().slice(0, 10);
  const mesAntFim = new Date(ano, mes - 2, dia).toISOString().slice(0, 10);
  const fatAtual = db.prepare("SELECT COALESCE(SUM(valor_total),0) t FROM vendas WHERE status='concluida' AND date(data)>=date(?)").get(mesIni).t;
  const fatAnterior = db.prepare("SELECT COALESCE(SUM(valor_total),0) t FROM vendas WHERE status='concluida' AND date(data) BETWEEN date(?) AND date(?)").get(mesAntIni, mesAntFim).t;
  if (Number(fatAnterior) > 0) {
    const variacaoPct = arred(((Number(fatAtual) - Number(fatAnterior)) / Number(fatAnterior)) * 100);
    itens.push({
      tipo: 'faturamento_mes', nivel: variacaoPct >= 0 ? 'verde' : 'vermelho', rota: 'dashboard', peso: variacaoPct >= 0 ? 5 : 1,
      dados: { atual: arred(fatAtual), anterior: arred(fatAnterior), variacao_pct: variacaoPct },
    });
  }

  // 5) Clientes que ja compraram antes mas estao ha mais de 90 dias sem comprar.
  const diasInatividade = 90;
  const limiteInativo = new Date(Date.now() - diasInatividade * 864e5).toISOString().slice(0, 10);
  const clientesInativos = db.prepare(`
    SELECT COUNT(*) c FROM (
      SELECT cl.id, MAX(v.data) AS ultima
      FROM clientes cl JOIN vendas v ON v.cliente_id = cl.id AND v.status = 'concluida'
      WHERE cl.ativo = 1
      GROUP BY cl.id
      HAVING date(ultima) < date(?)
    )
  `).get(limiteInativo).c;
  if (clientesInativos > 0) {
    itens.push({ tipo: 'clientes_inativos', nivel: 'azul', rota: 'clientes', peso: 4, dados: { qtd: clientesInativos, dias: diasInatividade } });
  }

  // 6) Meta mensal de faturamento (configuravel em Configuracoes).
  const metaCfg = db.prepare("SELECT valor FROM config WHERE chave = 'meta_mensal_faturamento'").get();
  const meta = metaCfg && metaCfg.valor ? Number(metaCfg.valor) : 0;
  if (meta > 0) {
    const pct = arred((Number(fatAtual) / meta) * 100);
    itens.push({
      tipo: 'meta_mensal', nivel: 'amarelo', rota: 'dashboard', peso: 3,
      dados: { meta: arred(meta), atual: arred(fatAtual), pct, falta: arred(Math.max(0, meta - Number(fatAtual))) },
    });
  } else {
    itens.push({ tipo: 'meta_nao_definida', nivel: 'info', rota: 'configuracoes', peso: 6, dados: {} });
  }

  // 7) Lembretes vencidos.
  // eslint-disable-next-line global-require
  const lembretesVencidos = require('../lembretesService').pendentesVencidos();
  if (lembretesVencidos.length > 0) {
    itens.push({ tipo: 'lembretes_vencidos', nivel: 'vermelho', rota: 'lembretes', peso: 1, dados: { qtd: lembretesVencidos.length } });
  }

  itens.sort((a, b) => a.peso - b.peso);
  return { itens };
}

module.exports = { centralAtencao };
