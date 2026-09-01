'use strict';

/**
 * Cartoes-resumo genericos: comparativo pagar x receber e o resumo padrao
 * (vendas do dia/mes, estoque baixo, a pagar/receber) mostrado na tela
 * inicial para quem nao esta no ramo professor/instituto/creche.
 */

const { getDb } = require('../../db/connection');
const { arred } = require('../precificacaoService');
const { hoje: hojeISO } = require('../../utils/datas');
const { intervalo, margemPeriodo } = require('./vendas');

/** Comparativo contas a pagar x a receber no periodo (por vencimento). */
function pagarVsReceber({ inicio, fim } = {}) {
  const db = getDb();
  const { ini, f } = intervalo({ inicio, fim });
  const pagar = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_pagar WHERE date(vencimento) BETWEEN date(?) AND date(?)").get(ini, f).t;
  const receber = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_receber WHERE status!='cancelada' AND tipo <> 'venda_vista' AND date(vencimento) BETWEEN date(?) AND date(?)").get(ini, f).t;
  const pagarPend = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_pagar WHERE status='pendente' AND date(vencimento) BETWEEN date(?) AND date(?)").get(ini, f).t;
  const receberPend = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_receber WHERE status='pendente' AND date(vencimento) BETWEEN date(?) AND date(?)").get(ini, f).t;
  return {
    pagar: arred(pagar), receber: arred(receber),
    pagar_pendente: arred(pagarPend), receber_pendente: arred(receberPend),
    saldo_previsto: arred(receber - pagar),
  };
}

/** Cartoes-resumo para a tela de dashboard. */
function resumoGeral() {
  const db = getDb();
  const hoje = hojeISO();
  const mesIni = hoje.slice(0, 8) + '01';
  const vendasHoje = db.prepare("SELECT COALESCE(SUM(valor_total),0) t, COUNT(*) c FROM vendas WHERE status='concluida' AND date(data)=date(?)").get(hoje);
  const vendasMes = db.prepare("SELECT COALESCE(SUM(valor_total),0) t, COUNT(*) c FROM vendas WHERE status='concluida' AND date(data)>=date(?)").get(mesIni);
  const estoqueBaixo = db.prepare('SELECT COUNT(*) c FROM produtos WHERE ativo=1 AND eh_servico=0 AND eh_kit=0 AND estoque_atual <= estoque_minimo').get().c;
  const aReceber = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_receber WHERE status='pendente'").get().t;
  const aPagar = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_pagar WHERE status='pendente'").get().t;
  const margemMes = margemPeriodo({ inicio: mesIni, fim: hoje });
  return {
    vendas_hoje: { total: arred(vendasHoje.t), qtd: vendasHoje.c },
    vendas_mes: { total: arred(vendasMes.t), qtd: vendasMes.c },
    lucro_mes: margemMes.lucro,
    margem_mes: margemMes.margem,
    estoque_baixo: estoqueBaixo,
    a_receber: arred(aReceber),
    a_pagar: arred(aPagar),
  };
}

module.exports = { pagarVsReceber, resumoGeral };
