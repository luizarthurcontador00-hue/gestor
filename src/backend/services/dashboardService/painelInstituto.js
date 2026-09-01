'use strict';

/**
 * Panorama do instituto: o retrato de hoje em quatro frentes — ensino
 * (turmas, alunos, aulas), acervo (instrumentos), pessoas (voluntarios) e
 * dinheiro (ofertas x despesas, saldo em caixa).
 *
 * Aqui nao existe venda, produto nem lucro: o "resultado" de um instituto
 * sem fins lucrativos e quanta gente ele atendeu e se as contas fecham.
 */

const { getDb } = require('../../db/connection');
const { arred } = require('../precificacaoService');
const { hoje: hojeISO } = require('../../utils/datas');

function painelInstituto() {
  const db = getDb();
  const hoje = hojeISO();
  const mesIni = hoje.slice(0, 8) + '01';
  const daquiA7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

  // ---------------------------- Ensino ----------------------------
  const turmas = db.prepare(`
    SELECT t.id, t.nome, t.vagas, c.nome AS curso_nome,
      (SELECT COUNT(*) FROM matriculas m WHERE m.turma_id = t.id AND m.status = 'ativa') AS matriculados,
      (SELECT COUNT(*) FROM matriculas m WHERE m.turma_id = t.id AND m.status = 'espera') AS na_fila,
      (SELECT COUNT(*) FROM turmas_instrutores ti WHERE ti.turma_id = t.id) AS instrutores
    FROM turmas t LEFT JOIN cursos c ON c.id = t.curso_id
    WHERE t.status IN ('aberta','planejada')
    ORDER BY c.nome, t.nome
  `).all();

  // eslint-disable-next-line global-require
  const { contarVagas } = require('../turmasService');
  const buscarAtivas = db.prepare("SELECT aluno_id, instrumento_id FROM matriculas WHERE turma_id = ? AND status = 'ativa'");
  turmas.forEach((t) => {
    const v = contarVagas(buscarAtivas.all(t.id), t.vagas);
    t.vagas_ocupadas = v.ocupadas;
    t.vagas_total = v.total;
  });

  const vagasTotais = turmas.reduce((s, t) => s + Number(t.vagas_total || 0), 0);
  const ocupadas = turmas.reduce((s, t) => s + Number(t.vagas_ocupadas || 0), 0);

  const alunosAtivos = db.prepare(`
    SELECT COUNT(DISTINCT aluno_id) c FROM matriculas WHERE status = 'ativa'
  `).get().c;
  const alunosNovosMes = db.prepare(`
    SELECT COUNT(DISTINCT aluno_id) c FROM matriculas WHERE date(data_matricula) >= date(?)
  `).get(mesIni).c;

  // ---------------------------- Aulas ----------------------------
  const aulasHoje = db.prepare(`
    SELECT a.id, a.hora_inicio, a.hora_fim, a.status, t.nome AS turma_nome,
      c.nome AS curso_nome, p.nome AS instrutor_nome, p.foto_path AS instrutor_foto,
      (SELECT COUNT(*) FROM presencas pr WHERE pr.agendamento_id = a.id) AS chamada_feita,
      (SELECT COUNT(*) FROM matriculas m WHERE m.turma_id = t.id AND m.status = 'ativa') AS alunos
    FROM agendamentos a
    JOIN turmas t ON t.id = a.turma_id
    LEFT JOIN cursos c ON c.id = t.curso_id
    LEFT JOIN profissionais p ON p.id = a.profissional_id
    WHERE date(a.data) = date(?) AND a.status != 'cancelado' AND t.status != 'cancelada'
    ORDER BY a.hora_inicio
  `).all(hoje);

  const aulasSemana = db.prepare(`
    SELECT COUNT(*) c FROM agendamentos a
    WHERE turma_id IS NOT NULL AND status != 'cancelado'
      AND date(data) BETWEEN date(?) AND date(?)
      AND NOT EXISTS (SELECT 1 FROM turmas t WHERE t.id = a.turma_id AND t.status = 'cancelada')
  `).get(hoje, daquiA7).c;

  const aulasRealizadasMes = db.prepare(`
    SELECT COUNT(*) c FROM agendamentos a
    WHERE turma_id IS NOT NULL AND status = 'atendido' AND date(data) >= date(?)
      AND NOT EXISTS (SELECT 1 FROM turmas t WHERE t.id = a.turma_id AND t.status = 'cancelada')
  `).get(mesIni).c;

  // Aula que ja passou e ninguem registrou a chamada: o buraco que mais
  // estraga o relatorio de impacto depois.
  const chamadasPendentes = db.prepare(`
    SELECT COUNT(*) c FROM agendamentos a
    WHERE a.turma_id IS NOT NULL AND a.status != 'cancelado' AND a.suspensa = 0
      AND date(a.data) < date(?)
      AND NOT EXISTS (SELECT 1 FROM presencas pr WHERE pr.agendamento_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM turmas t WHERE t.id = a.turma_id AND t.status = 'cancelada')
  `).get(hoje).c;

  const presencasMes = db.prepare(`
    SELECT
      SUM(CASE WHEN pr.situacao = 'presente' THEN 1 ELSE 0 END) AS presentes,
      COUNT(*) AS total
    FROM presencas pr JOIN agendamentos a ON a.id = pr.agendamento_id
    WHERE date(a.data) >= date(?)
  `).get(mesIni);
  const frequenciaMes = presencasMes.total > 0
    ? arred((presencasMes.presentes / presencasMes.total) * 100) : null;

  // ---------------------------- Acervo ----------------------------
  const acervo = db.prepare(`
    SELECT COALESCE(SUM(quantidade_total),0) t FROM instrumentos WHERE ativo = 1
  `).get().t;
  const emprestados = db.prepare(`
    SELECT COUNT(*) c FROM emprestimos_instrumento WHERE data_devolucao IS NULL
  `).get().c;
  const emprestimosAtrasados = db.prepare(`
    SELECT COUNT(*) c FROM emprestimos_instrumento
    WHERE data_devolucao IS NULL AND previsao_devolucao IS NOT NULL AND date(previsao_devolucao) < date(?)
  `).get(hoje).c;
  const emManutencao = db.prepare(`
    SELECT COUNT(*) c FROM instrumentos_unidades WHERE estado = 'manutencao'
  `).get().c;

  // ---------------------------- Pessoas ----------------------------
  const voluntarios = db.prepare("SELECT COUNT(*) c FROM profissionais WHERE ativo = 1 AND tipo = 'voluntario'").get().c;
  const equipe = db.prepare('SELECT COUNT(*) c FROM profissionais WHERE ativo = 1').get().c;
  const horasMes = db.prepare(`
    SELECT COALESCE(SUM(
      (CAST(substr(a.hora_fim,1,2) AS INTEGER) * 60 + CAST(substr(a.hora_fim,4,2) AS INTEGER)) -
      (CAST(substr(a.hora_inicio,1,2) AS INTEGER) * 60 + CAST(substr(a.hora_inicio,4,2) AS INTEGER))
    ),0) AS minutos
    FROM agendamentos a
    WHERE a.turma_id IS NOT NULL AND a.status = 'atendido' AND a.profissional_id IS NOT NULL
      AND a.hora_fim IS NOT NULL AND date(a.data) >= date(?)
  `).get(mesIni).minutos;
  // Voluntariado nao e so aula: evento, manutencao do acervo e administrativo
  // tambem sao tempo doado.
  const horasAtividadesMes = db.prepare(
    'SELECT COALESCE(SUM(horas),0) h FROM voluntarios_atividades WHERE date(data) >= date(?)'
  ).get(mesIni).h;

  const filaEspera = db.prepare("SELECT COUNT(*) c FROM lista_espera WHERE status = 'aguardando'").get().c;

  // ---------------------------- Dinheiro ----------------------------
  const ofertasMes = db.prepare(`
    SELECT COALESCE(SUM(valor),0) t, COUNT(*) c FROM ofertas WHERE date(data) >= date(?)
  `).get(mesIni);
  const despesasMes = db.prepare(`
    SELECT COALESCE(SUM(valor),0) t FROM contas_pagar
    WHERE status = 'pago' AND date(data_pagamento) >= date(?)
  `).get(mesIni).t;
  const aPagar = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_pagar WHERE status='pendente'").get().t;
  const aPagarVencidas = db.prepare(
    "SELECT COUNT(*) c FROM contas_pagar WHERE status='pendente' AND date(vencimento) < date(?)"
  ).get(hoje).c;
  // eslint-disable-next-line global-require
  const financeiro = require('../financeiroService');
  const saldoContas = financeiro.listarContasFinanceiras().reduce((s, c) => s + Number(c.saldo_atual), 0);

  // ---------------------------- Objetivos ----------------------------
  // Mesma logica da tela de Tarefas: do mais barato pro mais caro, soma
  // ate onde o saldo em caixa cobre — pra saber de relance quantos objetivos
  // ja da pra bancar sem abrir a tela.
  const objetivosAbertos = db.prepare(
    "SELECT id, titulo, valor FROM objetivos WHERE status = 'aberto' ORDER BY (valor IS NULL), valor, criado_em"
  ).all();
  let acumuladoObjetivos = 0;
  const objetivos = objetivosAbertos.map((o) => {
    let cabeAgora = null;
    if (o.valor != null) {
      cabeAgora = acumuladoObjetivos + Number(o.valor) <= saldoContas;
      if (cabeAgora) acumuladoObjetivos += Number(o.valor);
    }
    return { id: o.id, titulo: o.titulo, valor: o.valor, cabe_agora: cabeAgora };
  });

  // eslint-disable-next-line global-require
  const aniversariantes = require('../institutoService').aniversariantesDoMes(hoje.slice(5, 7));

  return {
    hoje,
    ensino: {
      turmas_ativas: turmas.length,
      vagas_totais: vagasTotais,
      vagas_ocupadas: ocupadas,
      vagas_livres: Math.max(0, vagasTotais - ocupadas),
      ocupacao_pct: vagasTotais > 0 ? arred((ocupadas / vagasTotais) * 100) : 0,
      turmas_lotadas: turmas.filter((t) => t.vagas_ocupadas >= t.vagas_total).length,
      turmas_sem_instrutor: turmas.filter((t) => !t.instrutores).length,
      alunos_ativos: alunosAtivos,
      alunos_novos_mes: alunosNovosMes,
      fila_espera: filaEspera,
      turmas: turmas.map((t) => {
        // eslint-disable-next-line global-require
        const progresso = require('../turmasService').progressoTurma(t.id);
        return {
          id: t.id, nome: t.nome, curso: t.curso_nome, vagas: t.vagas,
          vagas_ocupadas: t.vagas_ocupadas, vagas_total: t.vagas_total,
          matriculados: t.matriculados, na_fila: t.na_fila, instrutores: t.instrutores,
          progresso_pct: progresso.percentual,
        };
      }),
    },
    aulas: {
      hoje: aulasHoje.map((a) => ({
        id: a.id, hora_inicio: a.hora_inicio, hora_fim: a.hora_fim, status: a.status,
        turma: a.turma_nome, curso: a.curso_nome, instrutor: a.instrutor_nome, instrutor_foto: a.instrutor_foto,
        alunos: a.alunos, chamada_feita: a.chamada_feita > 0,
      })),
      proximos_7_dias: aulasSemana,
      realizadas_mes: aulasRealizadasMes,
      chamadas_pendentes: chamadasPendentes,
      frequencia_mes: frequenciaMes,
    },
    acervo: {
      total: acervo,
      emprestados,
      emprestimos_atrasados: emprestimosAtrasados,
      em_manutencao: emManutencao,
      no_instituto: Math.max(0, Number(acervo) - Number(emprestados)),
    },
    pessoas: {
      equipe,
      voluntarios,
      horas_voluntariado_mes: arred(horasMes / 60 + Number(horasAtividadesMes)),
    },
    dinheiro: {
      ofertas_mes: arred(ofertasMes.t),
      ofertas_qtd_mes: ofertasMes.c,
      despesas_mes: arred(despesasMes),
      resultado_mes: arred(Number(ofertasMes.t) - Number(despesasMes)),
      saldo_contas: arred(saldoContas),
      a_pagar: arred(aPagar),
      a_pagar_vencidas: aPagarVencidas,
    },
    objetivos: {
      total_abertos: objetivosAbertos.length,
      cabem_no_saldo: objetivos.filter((o) => o.cabe_agora).length,
      itens: objetivos.slice(0, 6),
    },
    aniversariantes,
  };
}

module.exports = { painelInstituto };
