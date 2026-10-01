'use strict';

/** Painel de indicadores voltado para o ramo "professor" (aula particular). */

const { getDb } = require('../../db/connection');
const { arred } = require('../precificacaoService');
const { hoje: hojeISO } = require('../../utils/datas');
const { margemPeriodo } = require('./vendas');
const frequencia = require('../frequenciaService');

function painelProfessor() {
  const db = getDb();
  const hoje = hojeISO();
  const mesIni = hoje.slice(0, 8) + '01';

  const carga = db.prepare(`
    SELECT COUNT(*) AS qtd, COALESCE(SUM(
      (CAST(substr(hora_fim,1,2) AS INTEGER) * 60 + CAST(substr(hora_fim,4,2) AS INTEGER)) -
      (CAST(substr(hora_inicio,1,2) AS INTEGER) * 60 + CAST(substr(hora_inicio,4,2) AS INTEGER))
    ),0) AS minutos
    FROM agendamentos
    WHERE date(data) >= date(?) AND status != 'cancelado' AND hora_fim IS NOT NULL
  `).get(mesIni);

  const alunosAtivos = db.prepare('SELECT COUNT(*) c FROM clientes WHERE ativo = 1').get().c;
  const faturamentoMes = db.prepare("SELECT COALESCE(SUM(valor_total),0) t FROM vendas WHERE status='concluida' AND date(data)>=date(?)").get(mesIni).t;
  const margemMes = margemPeriodo({ inicio: mesIni, fim: hoje });
  const aReceber = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_receber WHERE status='pendente'").get().t;
  const aPagar = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_pagar WHERE status='pendente'").get().t;

  return {
    aulas_mes: carga.qtd,
    horas_aula_mes: arred(carga.minutos / 60),
    alunos_ativos: alunosAtivos,
    faturamento_mes: arred(faturamentoMes),
    lucro_mes: margemMes.lucro,
    margem_mes: margemMes.margem,
    a_receber: arred(aReceber),
    a_pagar: arred(aPagar),
    ...frequencia.resumoPainel(),
  };
}

module.exports = { painelProfessor };
