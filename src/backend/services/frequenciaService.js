'use strict';

/**
 * Frequencia dos alunos de aula particular (relatorio do aluno e indicadores do
 * painel do professor). Definicoes usadas em todo o modulo, sobre aulas
 * (agendamentos) NAO suspensas:
 *  - dadas = status atendido; faltas = faltou; canceladas = cancelado (o banco
 *    nao guarda quem cancelou, so quem pediu a remarcacao);
 *  - remarcadas = linhas com remarcado_de_data (separadas por remarcado_por);
 *    uma aula remarcada e depois dada conta nas duas colunas;
 *  - sem_registro = data anterior a hoje ainda agendado/confirmado (esqueceram
 *    de marcar presenca);
 *  - frequencia_pct = dadas / (dadas + faltas) * 100; null se o denominador e 0.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { arred } = require('./precificacaoService');
const { hoje } = require('../utils/datas');

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const LIMITE_FREQUENCIA_BAIXA = 70;
const MIN_AULAS_FREQUENCIA = 3;
const DIAS_SEM_AULA = 30;
const MAX_ATENCAO = 8;

function pct(dadas, faltas) {
  const den = dadas + faltas;
  return den > 0 ? arred((dadas / den) * 100) : null;
}

function ultimoDiaDoMes(aaMm) {
  const [a, m] = aaMm.split('-').map(Number);
  return `${aaMm}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

function somarDias(iso, dias) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diasEntre(deIso, ateIso) {
  return Math.round((new Date(ateIso + 'T00:00:00Z') - new Date(deIso + 'T00:00:00Z')) / 86400000);
}

/** Os 6 meses terminando no mes de `ref` ('YYYY-MM-DD'), do mais antigo ao atual. */
function ultimosMeses(ref, n = 6) {
  const [a, m] = ref.split('-').map(Number);
  const meses = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    meses.push(d.toISOString().slice(0, 7));
  }
  return meses;
}

function totais(aulas, ref) {
  const t = {
    dadas: 0, faltas: 0, canceladas: 0, remarcadas: 0,
    remarcadas_por: { aluno: 0, professor: 0, feriado: 0 }, sem_registro: 0,
  };
  for (const a of aulas) {
    if (a.status === 'atendido') t.dadas++;
    else if (a.status === 'faltou') t.faltas++;
    else if (a.status === 'cancelado') t.canceladas++;
    else if (a.data < ref) t.sem_registro++;
    if (a.remarcado_de_data) {
      t.remarcadas++;
      if (t.remarcadas_por[a.remarcado_por] !== undefined) t.remarcadas_por[a.remarcado_por]++;
    }
  }
  t.frequencia_pct = pct(t.dadas, t.faltas);
  return t;
}

function frequenciaAluno(clienteId, { inicio, fim } = {}) {
  const db = getDb();
  const aluno = db.prepare('SELECT id, nome FROM clientes WHERE id = ?').get(clienteId);
  if (!aluno) throw new AppError('Aluno nao encontrado.', 404);
  const ref = hoje();
  const de = inicio || ref.slice(0, 8) + '01';
  const ate = fim || ultimoDiaDoMes(ref.slice(0, 7));
  if (!DATA_ISO.test(de) || !DATA_ISO.test(ate)) throw new AppError('Periodo invalido.');
  if (ate < de) throw new AppError('A data final nao pode ser anterior a inicial.');

  const meses = ultimosMeses(ref);
  const desde = meses[0] + '-01' < de ? meses[0] + '-01' : de;
  const mesFim = ultimoDiaDoMes(ref.slice(0, 7));
  const rows = db.prepare(`
    SELECT id, data, hora_inicio, servico_nome, status, remarcado_de_data, remarcado_por
    FROM agendamentos
    WHERE cliente_id = ? AND suspensa = 0 AND data >= ? AND data <= ?
    ORDER BY data DESC, hora_inicio DESC
  `).all(clienteId, desde, mesFim > ate ? mesFim : ate);

  const noPeriodo = rows.filter((r) => r.data >= de && r.data <= ate);
  const serie = meses.map((mes) => {
    const t = totais(rows.filter((r) => r.data.slice(0, 7) === mes), ref);
    return { mes, dadas: t.dadas, faltas: t.faltas, frequencia_pct: t.frequencia_pct };
  });
  const ultimas = noPeriodo.filter((r) => r.data <= ref).slice(0, 20).map((r) => ({
    id: r.id, data: r.data, hora_inicio: r.hora_inicio, materia: r.servico_nome || null, status: r.status,
    remarcada: !!r.remarcado_de_data, remarcado_por: r.remarcado_por || null,
  }));
  return { aluno, periodo: { inicio: de, fim: ate }, totais: totais(noPeriodo, ref), serie_mensal: serie, ultimas_aulas: ultimas };
}

/** Indicadores do mes para o Painel do professor, mais a lista de alunos para acompanhar. */
function resumoPainel() {
  const db = getDb();
  const ref = hoje();
  const mesIni = ref.slice(0, 8) + '01';
  const mesFim = ultimoDiaDoMes(ref.slice(0, 7));

  const doMes = db.prepare(`
    SELECT cliente_id, data, status, remarcado_de_data, remarcado_por
    FROM agendamentos WHERE cliente_id IS NOT NULL AND suspensa = 0 AND data >= ? AND data <= ?
  `).all(mesIni, mesFim);
  const geral = totais(doMes, ref);
  const semRegistro = db.prepare(
    "SELECT COUNT(*) AS n FROM agendamentos WHERE suspensa = 0 AND data < ? AND status IN ('agendado','confirmado')"
  ).get(ref).n;

  return {
    frequencia_mes_pct: geral.frequencia_pct,
    faltas_mes: geral.faltas,
    remarcadas_mes: geral.remarcadas,
    sem_registro: semRegistro,
    alunos_atencao: alunosAtencao(db, ref, doMes),
  };
}

/**
 * Um motivo por aluno, na ordem: 2 faltas seguidas (nas ultimas aulas
 * registradas, ultimos 60 dias) > frequencia do mes < 70% com 3+ aulas
 * marcadas (nao canceladas) > 30+ dias sem aula atendida, so para quem tem
 * aula fixa ativa (sem nenhuma atendida, conta desde o inicio da aula fixa).
 */
function alunosAtencao(db, ref, doMes) {
  const alunos = new Map(db.prepare('SELECT id, nome FROM clientes WHERE ativo = 1').all().map((c) => [c.id, c.nome]));
  const achados = new Map();
  const marcar = (id, prioridade, item) => {
    if (!alunos.has(id)) return;
    const atual = achados.get(id);
    if (!atual || prioridade < atual.prioridade) achados.set(id, { prioridade, ...item, id, nome: alunos.get(id) });
  };

  const recentes = db.prepare(`
    SELECT cliente_id, status FROM agendamentos
    WHERE cliente_id IS NOT NULL AND suspensa = 0 AND status IN ('atendido','faltou') AND data <= ? AND data >= ?
    ORDER BY data DESC, hora_inicio DESC
  `).all(ref, somarDias(ref, -60));
  const vistos = new Map();
  for (const r of recentes) {
    const lista = vistos.get(r.cliente_id) || [];
    if (lista.length < 2) lista.push(r.status);
    vistos.set(r.cliente_id, lista);
  }
  vistos.forEach((lista, id) => {
    if (lista.length === 2 && lista.every((s) => s === 'faltou')) {
      marcar(id, 1, { tipo: 'faltas_seguidas', motivo: '2 faltas seguidas', faltas_seguidas: 2 });
    }
  });

  const porAluno = new Map();
  for (const r of doMes) {
    if (!porAluno.has(r.cliente_id)) porAluno.set(r.cliente_id, []);
    porAluno.get(r.cliente_id).push(r);
  }
  porAluno.forEach((aulas, id) => {
    const marcadas = aulas.filter((a) => a.status !== 'cancelado').length;
    const t = totais(aulas, ref);
    if (marcadas >= MIN_AULAS_FREQUENCIA && t.frequencia_pct != null && t.frequencia_pct < LIMITE_FREQUENCIA_BAIXA) {
      marcar(id, 2, {
        tipo: 'frequencia_baixa', motivo: `Frequência de ${t.frequencia_pct}% no mês`,
        frequencia_pct: t.frequencia_pct, aulas: marcadas, faltas: t.faltas,
      });
    }
  });

  const comFixa = db.prepare(`
    SELECT c.id,
      (SELECT MAX(data) FROM agendamentos WHERE cliente_id = c.id AND status = 'atendido' AND suspensa = 0) AS ultima,
      (SELECT MIN(data_inicio) FROM aulas_recorrentes WHERE aluno_id = c.id AND ativa = 1) AS fixa_desde
    FROM clientes c
    WHERE c.ativo = 1 AND EXISTS (SELECT 1 FROM aulas_recorrentes r WHERE r.aluno_id = c.id AND r.ativa = 1)
  `).all();
  for (const c of comFixa) {
    const base = c.ultima || c.fixa_desde;
    const dias = base ? diasEntre(base, ref) : 0;
    if (dias >= DIAS_SEM_AULA) {
      marcar(c.id, 3, {
        tipo: 'sem_aula', dias_sem_aula: dias,
        motivo: c.ultima ? `${dias} dias sem aula atendida` : 'Nenhuma aula atendida ainda',
      });
    }
  }

  return [...achados.values()]
    .sort((a, b) => a.prioridade - b.prioridade || a.nome.localeCompare(b.nome))
    .slice(0, MAX_ATENCAO)
    .map(({ prioridade, ...resto }) => resto);
}

module.exports = { frequenciaAluno, resumoPainel };
