'use strict';

/**
 * Turmas do instituto: a oferta concreta de um curso, com periodo, dias da
 * semana, instrutores e alunos matriculados.
 *
 * Duas regras que o modulo faz questao de garantir:
 * - As vagas nunca passam do que o acervo de instrumentos aguenta naquele
 *   horario (nao adianta abrir turma de violao com 12 vagas se so ha 8).
 * - Quando a turma lota, a matricula nao e recusada: o aluno entra na fila de
 *   espera, que e o comportamento util no dia a dia de um instituto.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { arred } = require('./precificacaoService');
const { hoje: hojeISO } = require('../utils/datas');
const instrumentos = require('./instrumentosService');

const STATUS_TURMA = ['planejada', 'aberta', 'encerrada', 'cancelada'];
const STATUS_MATRICULA = ['ativa', 'espera', 'trancada', 'concluida', 'desistente'];
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Instrumentos que a turma precisa (pode ser mais de um — ex.: turma de banda). */
function instrumentosDaTurma(db, turmaId) {
  return db.prepare(`
    SELECT i.id, i.nome, i.quantidade_total
    FROM turmas_instrumentos ti JOIN instrumentos i ON i.id = ti.instrumento_id
    WHERE ti.turma_id = ? ORDER BY i.nome
  `).all(turmaId);
}

function listar({ curso_id, status, instrumento_id } = {}) {
  const where = [];
  const params = { curso_id, instrumento_id };

  if (curso_id) where.push('t.curso_id = @curso_id');
  // "status" aceita uma lista (separada por virgula, ou ja um array) pra dar
  // pra marcar mais de uma situacao no filtro ao mesmo tempo.
  const statusList = Array.isArray(status)
    ? status.filter(Boolean)
    : String(status || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (statusList.length) {
    where.push(`t.status IN (${statusList.map((_, i) => `@status${i}`).join(',')})`);
    statusList.forEach((s, i) => { params[`status${i}`] = s; });
  }
  if (instrumento_id) where.push('EXISTS (SELECT 1 FROM turmas_instrumentos ti WHERE ti.turma_id = t.id AND ti.instrumento_id = @instrumento_id)');

  const turmas = getDb().prepare(`
    SELECT t.*, c.nome AS curso_nome, c.categoria AS curso_categoria,
      (SELECT COUNT(*) FROM matriculas m WHERE m.turma_id = t.id AND m.status = 'ativa') AS matriculados,
      (SELECT COUNT(*) FROM matriculas m WHERE m.turma_id = t.id AND m.status = 'espera') AS na_espera
    FROM turmas t
    JOIN cursos c ON c.id = t.curso_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.status, c.nome, t.nome
  `).all(params);

  const db = getDb();
  const buscarAtivas = db.prepare("SELECT aluno_id, instrumento_id FROM matriculas WHERE turma_id = ? AND status = 'ativa'");
  turmas.forEach((t) => {
    t.horarios = db.prepare('SELECT * FROM turmas_horarios WHERE turma_id = ? ORDER BY dia_semana, hora_inicio').all(t.id);
    t.instrutores = db.prepare(`
      SELECT ti.papel, p.id, p.nome
      FROM turmas_instrutores ti JOIN profissionais p ON p.id = ti.profissional_id
      WHERE ti.turma_id = ? ORDER BY ti.papel, p.nome
    `).all(t.id);
    t.instrumentos = instrumentosDaTurma(db, t.id);
    const v = contarVagas(buscarAtivas.all(t.id), t.vagas);
    t.vagas_ocupadas = v.ocupadas;
    t.vagas_total = v.total;
  });
  return turmas;
}

function obter(id) {
  const db = getDb();
  const turma = db.prepare(`
    SELECT t.*, c.nome AS curso_nome, c.categoria AS curso_categoria, c.carga_horaria AS curso_carga_horaria
    FROM turmas t
    JOIN cursos c ON c.id = t.curso_id
    WHERE t.id = ?
  `).get(id);
  if (!turma) throw new AppError('Turma não encontrada.', 404);

  turma.horarios = db.prepare('SELECT * FROM turmas_horarios WHERE turma_id = ? ORDER BY dia_semana, hora_inicio').all(id);
  turma.instrumentos = instrumentosDaTurma(db, id);
  turma.instrutores = db.prepare(`
    SELECT ti.*, p.nome, p.telefone, p.cor, p.tipo
    FROM turmas_instrutores ti JOIN profissionais p ON p.id = ti.profissional_id
    WHERE ti.turma_id = ? ORDER BY ti.papel, p.nome
  `).all(id);
  turma.matriculas = db.prepare(`
    SELECT m.*, a.nome AS aluno_nome, a.telefone, a.data_nascimento, a.responsavel_nome, a.responsavel_telefone,
      i.nome AS instrumento_nome
    FROM matriculas m
    JOIN clientes a ON a.id = m.aluno_id
    LEFT JOIN instrumentos i ON i.id = m.instrumento_id
    WHERE m.turma_id = ? ORDER BY (m.status != 'ativa'), a.nome
  `).all(id);
  const ativas = turma.matriculas.filter((m) => m.status === 'ativa');
  turma.matriculados = ativas.length;
  turma.na_espera = turma.matriculas.filter((m) => m.status === 'espera').length;
  const v = contarVagas(ativas, turma.vagas);
  turma.vagas_ocupadas = v.ocupadas;
  turma.vagas_total = v.total;
  return turma;
}

function validarHorarios(horarios) {
  const lista = (horarios || []).map((h) => {
    const dia = Number(h.dia_semana);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) throw new AppError('Dia da semana inválido no horário da turma.');
    const ini = String(h.hora_inicio || '').trim();
    const fim = String(h.hora_fim || '').trim();
    if (!/^\d{2}:\d{2}$/.test(ini) || !/^\d{2}:\d{2}$/.test(fim)) throw new AppError('Informe as horas no formato HH:MM.');
    if (fim <= ini) throw new AppError(`No ${DIAS[dia]}, a hora de término precisa ser depois da hora de início.`);
    return { dia_semana: dia, hora_inicio: ini, hora_fim: fim };
  });
  if (!lista.length) throw new AppError('Informe ao menos um dia e horário para a turma.');
  return lista;
}

/** Duração em horas de um horário (hora_fim - hora_inicio). */
function duracaoHoras(h) {
  const [hi, mi] = h.hora_inicio.split(':').map(Number);
  const [hf, mf] = h.hora_fim.split(':').map(Number);
  return (hf * 60 + mf - (hi * 60 + mi)) / 60;
}

/**
 * A partir do início do período, dos horários semanais e da carga horária
 * do curso, caminha dia a dia até acumular as horas necessárias e devolve a
 * data do último encontro — essa é a data de fim projetada da turma. Datas
 * em `suspensas` (Set de 'YYYY-MM-DD') não contam hora nenhuma, então um dia
 * suspenso empurra a data de fim pra frente.
 */
function calcularFimAutomatico(periodoInicio, horarios, cargaHorariaHoras, suspensas) {
  if (!cargaHorariaHoras || !horarios || !horarios.length) return null;
  const suspensasSet = suspensas || new Set();
  let acumulado = 0;
  let ultimaData = null;
  const d = new Date(periodoInicio + 'T12:00:00');
  const limite = new Date(d);
  limite.setFullYear(limite.getFullYear() + 5); // trava de seguranca contra horario impossivel
  while (acumulado < cargaHorariaHoras && d <= limite) {
    const iso = d.toISOString().slice(0, 10);
    const doDia = horarios.filter((h) => Number(h.dia_semana) === d.getDay());
    if (doDia.length && !suspensasSet.has(iso)) {
      doDia.forEach((h) => { acumulado += duracaoHoras(h); });
      ultimaData = iso;
    }
    d.setDate(d.getDate() + 1);
  }
  return ultimaData;
}

function validar(dados, horarios) {
  const db = getDb();
  const nome = (dados.nome || '').trim();
  if (!nome) throw new AppError('Informe o nome da turma.');

  const cursoId = Number(dados.curso_id);
  const curso = db.prepare('SELECT * FROM cursos WHERE id = ?').get(cursoId);
  if (!curso) throw new AppError('Selecione um curso válido para a turma.');

  const vagas = Number(dados.vagas);
  if (!Number.isInteger(vagas) || vagas < 0) throw new AppError('Informe um número de vagas válido.');

  const inicio = String(dados.periodo_inicio || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) throw new AppError('Informe a data de início do período da turma.');
  let fim = String(dados.periodo_fim || '').trim() || null;
  if (fim && fim < inicio) throw new AppError('O fim do período não pode ser antes do início.');
  // Sem data de fim informada: se o curso tem carga horaria, calcula sozinho
  // ate onde a turma vai, em vez de deixar "sem data de termino" por padrao.
  if (!fim && curso.carga_horaria) fim = calcularFimAutomatico(inicio, horarios, curso.carga_horaria);

  const instrumentosIds = Array.isArray(dados.instrumentos_ids)
    ? [...new Set(dados.instrumentos_ids.map(Number).filter(Boolean))]
    : (dados.instrumento_id ? [Number(dados.instrumento_id)] : []);
  const porAluno = Math.max(1, Number(dados.instrumentos_por_aluno) || 1);
  const status = STATUS_TURMA.includes(dados.status) ? dados.status : 'aberta';

  const horasAbonadas = Number(dados.horas_abonadas);
  if (dados.horas_abonadas !== undefined && (Number.isNaN(horasAbonadas) || horasAbonadas < 0)) {
    throw new AppError('As horas abonadas precisam ser um número maior ou igual a zero.');
  }

  return {
    curso_id: cursoId,
    nome,
    instrumentos_ids: instrumentosIds,
    instrumentos_por_aluno: porAluno,
    vagas,
    sala: (dados.sala || '').trim() || null,
    periodo_inicio: inicio,
    periodo_fim: fim,
    status,
    observacao: (dados.observacao || '').trim() || null,
    horas_abonadas: Number.isNaN(horasAbonadas) ? 0 : horasAbonadas,
  };
}

/**
 * Impede abrir/editar turma pedindo mais instrumentos do que existem livres
 * naquele horario. Explica o limite com nomes, para dar para agir.
 */
/**
 * Vagas sao sobre o acervo: quem traz o proprio instrumento (ou ja esta com
 * um exemplar emprestado do instituto) nao usa nada dele, entao nao deveria
 * travar o limite configurado nem contar contra ele. Por isso o total
 * exibido cresce (vagas + quem furou) em vez da vaga configurada ser
 * alterada: "5 de 6" mostra a realidade sem mexer no numero que o instituto
 * configurou.
 *
 * `ocupadas` e o que aparece na tela: quantos alunos estao matriculados de
 * verdade, contando todo mundo (com instrumento proprio ou nao) — e' a
 * pergunta "quantos alunos tem aqui". `usandoAcervo` e o numero que decide
 * fila de espera e se da pra reduzir as vagas: so quem depende do acervo
 * pode travar essas coisas, quem traz o proprio nunca.
 *
 * Recalculado sempre na hora (nunca gravado), porque a posse do instrumento
 * pode mudar depois da matricula — um aluno que compra o proprio instrumento
 * libera a vaga de acervo sem precisar de nenhuma acao manual.
 */
function contarVagas(matriculasAtivas, vagasBase) {
  const furando = matriculasAtivas.filter((m) => m.instrumento_id && instrumentos.alunoJaTemInstrumento(m.aluno_id, m.instrumento_id)).length;
  return { ocupadas: matriculasAtivas.length, usandoAcervo: matriculasAtivas.length - furando, total: vagasBase + furando, furando };
}

/** Quantos matriculados ativos da turma trazem o proprio instrumento. */
function comInstrumentoProprio(turmaId, instrumentoId) {
  if (!turmaId || !instrumentoId) return 0;
  return getDb().prepare(`
    SELECT COUNT(*) c FROM matriculas m
    JOIN alunos_instrumentos_proprios p ON p.aluno_id = m.aluno_id AND p.instrumento_id = @instrumentoId
    WHERE m.turma_id = @turmaId AND m.status = 'ativa'
  `).get({ turmaId, instrumentoId }).c;
}

/**
 * Confere o acervo ao abrir/editar a turma.
 *
 * As vagas NAO sao travadas pelo tamanho do acervo, e isso e proposital: um
 * instituto com 4 violoes pode abrir turma de 8 quando metade dos alunos
 * traz o proprio instrumento — travar aqui impediria de criar a turma antes
 * de existir qualquer matricula (o ovo e a galinha). O limite de verdade e
 * cobrado na MATRICULA, onde da para saber exatamente quem precisa de
 * instrumento emprestado.
 *
 * O unico caso barrado aqui e o impossivel: turma que depende de instrumento
 * quando nenhum dos instrumentos marcados tem exemplar livre naquele
 * horario. Ter mais de um instrumento marcado (ex.: violao aco e violao de
 * naylon) e um cardapio — cada aluno usa um deles — entao so trava se NINGUEM
 * conseguisse usar nenhuma das opcoes, nao se so uma delas estiver
 * momentaneamente sem exemplar livre.
 */
function conferirAcervo(d, horarios, turmaIdIgnorar) {
  if (!d.instrumentos_ids.length || d.vagas === 0) return [];
  const resultados = d.instrumentos_ids.map((instrumentoId) => instrumentos.vagasDisponiveis(instrumentoId, horarios, {
    turmaIdIgnorar,
    instrumentosPorAluno: d.instrumentos_por_aluno,
  }));
  if (resultados.every((disp) => disp.vagas_maximas === 0)) {
    const nomes = resultados.map((disp) => disp.instrumento).join(', ');
    throw new AppError(
      `Não há ${nomes} livre neste horário. `
      + 'Escolha outro horário, ou matricule apenas alunos que tenham o próprio instrumento.'
    );
  }
  return resultados;
}

function gravarInstrumentos(db, turmaId, instrumentosIds) {
  db.prepare('DELETE FROM turmas_instrumentos WHERE turma_id = ?').run(turmaId);
  const ins = db.prepare('INSERT INTO turmas_instrumentos (turma_id, instrumento_id) VALUES (?, ?)');
  (instrumentosIds || []).forEach((instId) => ins.run(turmaId, instId));
}

function criar(dados) {
  const db = getDb();
  const horarios = validarHorarios(dados.horarios);
  const d = validar(dados, horarios);
  conferirAcervo(d, horarios, null);

  const criarTudo = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO turmas (curso_id, nome, instrumentos_por_aluno, vagas, sala,
        periodo_inicio, periodo_fim, status, observacao, horas_abonadas)
      VALUES (@curso_id, @nome, @instrumentos_por_aluno, @vagas, @sala,
        @periodo_inicio, @periodo_fim, @status, @observacao, @horas_abonadas)
    `).run(d);
    const turmaId = info.lastInsertRowid;
    gravarHorarios(db, turmaId, horarios);
    gravarInstrumentos(db, turmaId, d.instrumentos_ids);
    gravarInstrutores(db, turmaId, dados.instrutores);
    return turmaId;
  });

  const id = criarTudo();
  gerarEncontros(id);
  return obter(id);
}

function atualizar(id, dados) {
  const db = getDb();
  const atual = obter(id);
  const horarios = dados.horarios ? validarHorarios(dados.horarios) : atual.horarios;
  const instrumentosIdsAtuais = atual.instrumentos.map((i) => i.id);
  const d = validar({ ...atual, instrumentos_ids: instrumentosIdsAtuais, ...dados }, horarios);
  conferirAcervo(d, horarios, id);

  // Reduzir vagas abaixo de quem ja depende do acervo deixaria aluno sem
  // instrumento — quem traz o proprio nao conta pra esse limite.
  const ativas = atual.matriculas.filter((m) => m.status === 'ativa');
  const usandoAcervo = contarVagas(ativas, atual.vagas).usandoAcervo;
  if (d.vagas < usandoAcervo) {
    throw new AppError(`Esta turma já tem ${usandoAcervo} aluno(s) matriculado(s) que dependem do acervo. Não dá para reduzir para ${d.vagas} vagas.`);
  }

  const salvar = db.transaction(() => {
    db.prepare(`
      UPDATE turmas SET curso_id=@curso_id, nome=@nome,
        instrumentos_por_aluno=@instrumentos_por_aluno, vagas=@vagas, sala=@sala,
        periodo_inicio=@periodo_inicio, periodo_fim=@periodo_fim, status=@status, observacao=@observacao,
        horas_abonadas=@horas_abonadas
      WHERE id=@id
    `).run({ ...d, id });
    if (dados.horarios) gravarHorarios(db, id, horarios);
    if (dados.instrumentos_ids) gravarInstrumentos(db, id, d.instrumentos_ids);
    if (dados.instrutores) {
      gravarInstrutores(db, id, dados.instrutores);
      sincronizarInstrutorDosEncontros(db, id);
    }
  });
  salvar();

  // Mudou dia/horario? Os encontros futuros do horario ANTIGO ficariam
  // orfaos no calendario (trocar terça por quarta deixaria os dois).
  if (dados.horarios) limparEncontrosForaDoHorario(id);
  if (d.status === 'aberta' || d.status === 'planejada') gerarEncontros(id);
  if ((d.status === 'encerrada' || d.status === 'cancelada') && atual.status !== d.status) {
    // A edição genérica também permite encerrar/cancelar (sem passar pelo
    // fluxo dedicado de encerrar()) — os encontros futuros sem chamada
    // registrada precisam sumir da agenda, senão a turma continua
    // aparecendo como se tivesse aula.
    db.prepare(`
      DELETE FROM agendamentos WHERE turma_id = ? AND date(data) > date('now','localtime')
        AND NOT EXISTS (SELECT 1 FROM presencas p WHERE p.agendamento_id = agendamentos.id)
    `).run(id);
  }
  return obter(id);
}

function gravarHorarios(db, turmaId, horarios) {
  db.prepare('DELETE FROM turmas_horarios WHERE turma_id = ?').run(turmaId);
  const ins = db.prepare('INSERT INTO turmas_horarios (turma_id, dia_semana, hora_inicio, hora_fim) VALUES (?, ?, ?, ?)');
  horarios.forEach((h) => ins.run(turmaId, h.dia_semana, h.hora_inicio, h.hora_fim));
}

function gravarInstrutores(db, turmaId, instrutores) {
  db.prepare('DELETE FROM turmas_instrutores WHERE turma_id = ?').run(turmaId);
  const ins = db.prepare('INSERT INTO turmas_instrutores (turma_id, profissional_id, papel) VALUES (?, ?, ?)');
  (instrutores || []).forEach((i) => {
    const pid = Number(i.profissional_id || i);
    if (!pid) return;
    const papel = ['titular', 'auxiliar', 'suplente'].includes(i.papel) ? i.papel : 'titular';
    ins.run(turmaId, pid, papel);
  });
}

/**
 * Cada encontro guarda o instrutor titular da hora em que foi gerado
 * (agendamentos.profissional_id), pra Agenda/Chamada nao precisarem cruzar
 * com turmas_instrutores toda vez. Problema: trocar o instrutor pela edição
 * da turma só atualiza turmas_instrutores — os encontros que já existiam
 * continuam com o nome antigo (ou em branco, se a turma tinha sido criada
 * sem instrutor). Só sincroniza o que ainda não aconteceu (sem chamada
 * registrada), pra não reescrever o instrutor de aula que já rolou.
 */
function sincronizarInstrutorDosEncontros(db, turmaId) {
  const titular = db.prepare("SELECT profissional_id FROM turmas_instrutores WHERE turma_id = ? AND papel = 'titular' LIMIT 1").get(turmaId);
  db.prepare(`
    UPDATE agendamentos SET profissional_id = ?
    WHERE turma_id = ? AND date(data) >= date('now','localtime')
      AND NOT EXISTS (SELECT 1 FROM presencas p WHERE p.agendamento_id = agendamentos.id)
  `).run(titular ? titular.profissional_id : null, turmaId);
}

function excluir(id) {
  const db = getDb();
  const turma = obter(id);
  const comPresenca = db.prepare(`
    SELECT COUNT(*) c FROM presencas p
    JOIN agendamentos a ON a.id = p.agendamento_id WHERE a.turma_id = ?
  `).get(id).c;
  if (comPresenca > 0) {
    throw new AppError('Esta turma já tem chamadas registradas e não pode ser excluída. Marque-a como encerrada para preservar o histórico.');
  }
  db.prepare('DELETE FROM turmas WHERE id = ?').run(id);
  return { ok: true, nome: turma.nome };
}

// ====================== Encerramento e renovacao ======================

/**
 * Encerra a turma no fim do periodo: as matriculas ativas viram "concluida"
 * e a fila de espera e dispensada (a turma nao existe mais para chamar
 * ninguem). Os encontros futuros sem chamada saem do calendario; os
 * passados ficam, porque sao o historico do que aconteceu.
 */
function encerrar(id, { data_fim } = {}) {
  const db = getDb();
  const turma = obter(id);
  if (turma.status === 'encerrada') throw new AppError('Esta turma já está encerrada.');

  const fim = String(data_fim || '').trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fim)) throw new AppError('Informe uma data de encerramento válida.');

  const fechar = db.transaction(() => {
    db.prepare("UPDATE turmas SET status = 'encerrada', periodo_fim = ? WHERE id = ?").run(fim, id);
    db.prepare(`
      UPDATE matriculas SET status = 'concluida', data_saida = ?
      WHERE turma_id = ? AND status = 'ativa'
    `).run(fim, id);
    db.prepare("UPDATE matriculas SET status = 'desistente', data_saida = ? WHERE turma_id = ? AND status = 'espera'").run(fim, id);
    db.prepare(`
      DELETE FROM agendamentos WHERE turma_id = ? AND date(data) > date(?)
        AND NOT EXISTS (SELECT 1 FROM presencas p WHERE p.agendamento_id = agendamentos.id)
    `).run(id, fim);
  });
  fechar();
  return obter(id);
}

/**
 * Renova a turma para o periodo seguinte: cria uma turma nova com o mesmo
 * curso, horarios, instrutores e acervo, e leva junto os alunos escolhidos.
 *
 * A turma anterior e encerrada (a nao ser que se peca o contrario), para o
 * historico de cada semestre ficar separado — que e o ponto de ter periodo.
 */
function renovar(id, dados = {}) {
  const db = getDb();
  const origem = obter(id);

  const inicio = String(dados.periodo_inicio || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) throw new AppError('Informe a data de início do novo período.');
  const fim = String(dados.periodo_fim || '').trim() || null;
  if (fim && fim < inicio) throw new AppError('O fim do período não pode ser antes do início.');

  // Quem vai junto: por padrao, todo mundo que estava ativo.
  const ativosData = origem.matriculas.filter((m) => m.status === 'ativa');
  const ativos = ativosData.map((m) => m.aluno_id);
  const levar = Array.isArray(dados.alunos) ? dados.alunos.map(Number).filter((a) => ativos.includes(a)) : ativos;

  const vagas = dados.vagas !== undefined && dados.vagas !== '' ? Number(dados.vagas) : origem.vagas;
  // Quem traz o proprio instrumento nao ocupa vaga de acervo na turma nova
  // tambem — so quem depende dele entra na conta do limite.
  const usandoAcervoNovas = contarVagas(ativosData.filter((m) => levar.includes(m.aluno_id)), vagas).usandoAcervo;
  if (usandoAcervoNovas > vagas) {
    throw new AppError(`Você escolheu ${levar.length} aluno(s) para continuar (${usandoAcervoNovas} deles dependem do acervo), mas a turma nova tem ${vagas} vaga(s).`);
  }

  // A ORDEM importa: a turma velha precisa fechar ANTES de a nova nascer.
  // Enquanto ela estiver aberta no mesmo dia e horario, ela segura os
  // instrumentos do acervo e a turma nova nao teria violao para ninguem.
  // Tudo numa transacao so: se a criacao falhar, a origem nao fica encerrada
  // sem substituta.
  const executar = db.transaction(() => {
    if (dados.encerrar_origem !== false) {
      const fimOrigem = (dados.data_fim_origem || '').trim() || inicio;
      db.prepare("UPDATE turmas SET status = 'encerrada', periodo_fim = ? WHERE id = ?").run(fimOrigem, id);
      db.prepare("UPDATE matriculas SET status = 'concluida', data_saida = ? WHERE turma_id = ? AND status = 'ativa'").run(fimOrigem, id);
      db.prepare("UPDATE matriculas SET status = 'desistente', data_saida = ? WHERE turma_id = ? AND status = 'espera'").run(fimOrigem, id);
      db.prepare(`
        DELETE FROM agendamentos WHERE turma_id = ? AND date(data) >= date(?)
          AND NOT EXISTS (SELECT 1 FROM presencas p WHERE p.agendamento_id = agendamentos.id)
      `).run(id, inicio);
    }

    const nova = criar({
      curso_id: origem.curso_id,
      nome: (dados.nome || '').trim() || origem.nome,
      instrumentos_ids: origem.instrumentos.map((i) => i.id),
      instrumentos_por_aluno: origem.instrumentos_por_aluno,
      vagas,
      sala: dados.sala !== undefined ? dados.sala : origem.sala,
      periodo_inicio: inicio,
      periodo_fim: fim,
      status: 'aberta',
      observacao: origem.observacao,
      horarios: origem.horarios.map((h) => ({ dia_semana: h.dia_semana, hora_inicio: h.hora_inicio, hora_fim: h.hora_fim })),
      instrutores: origem.instrutores.map((i) => ({ profissional_id: i.profissional_id, papel: i.papel })),
    });

    db.prepare('UPDATE turmas SET turma_origem_id = ?, periodo_rotulo = ? WHERE id = ?')
      .run(id, (dados.periodo_rotulo || '').trim() || null, nova.id);

    const naoCouberam = [];
    levar.forEach((alunoId) => {
      try { matricular(nova.id, { aluno_id: alunoId }); }
      catch (e) {
        const p = db.prepare('SELECT nome FROM clientes WHERE id = ?').get(alunoId);
        naoCouberam.push({ aluno_id: alunoId, nome: p && p.nome, motivo: e.message });
      }
    });
    return { novaId: nova.id, naoCouberam };
  });

  const { novaId, naoCouberam } = executar();

  return {
    turma: obter(novaId),
    origem: obter(id),
    alunos_levados: levar.length - naoCouberam.length,
    nao_couberam: naoCouberam,
  };
}

/** As gerações da turma: de onde ela veio e o que veio dela. */
function historicoDaTurma(id) {
  const db = getDb();
  obter(id);
  const linha = db.prepare(`
    WITH RECURSIVE anteriores(id) AS (
      SELECT turma_origem_id FROM turmas WHERE id = @id AND turma_origem_id IS NOT NULL
      UNION
      SELECT t.turma_origem_id FROM turmas t JOIN anteriores a ON t.id = a.id WHERE t.turma_origem_id IS NOT NULL
    ),
    seguintes(id) AS (
      SELECT id FROM turmas WHERE turma_origem_id = @id
      UNION
      SELECT t.id FROM turmas t JOIN seguintes s ON t.turma_origem_id = s.id
    )
    SELECT t.id, t.nome, t.periodo_inicio, t.periodo_fim, t.periodo_rotulo, t.status,
      (SELECT COUNT(*) FROM matriculas m WHERE m.turma_id = t.id AND m.status IN ('ativa','concluida')) AS alunos
    FROM turmas t
    WHERE t.id = @id OR t.id IN (SELECT id FROM anteriores) OR t.id IN (SELECT id FROM seguintes)
    ORDER BY date(t.periodo_inicio), t.id
  `).all({ id: Number(id) });
  return linha.map((t) => ({ ...t, atual: Number(t.id) === Number(id) }));
}

// ============================== Matriculas ==============================

/**
 * Matricula o aluno. Se a turma estiver cheia, entra na fila de espera em vez
 * de dar erro — recusar seria perder o aluno que procurou o instituto.
 */
function matricular(turmaId, { aluno_id, observacao, instrumento_id }) {
  const db = getDb();
  const turma = obter(turmaId);
  if (turma.status === 'encerrada' || turma.status === 'cancelada') {
    throw new AppError('Esta turma está encerrada e não aceita novas matrículas.');
  }

  const aluno = db.prepare('SELECT * FROM clientes WHERE id = ?').get(Number(aluno_id));
  if (!aluno) throw new AppError('Selecione um aluno válido.');

  const jaTem = db.prepare("SELECT * FROM matriculas WHERE turma_id = ? AND aluno_id = ? AND status IN ('ativa','espera')").get(turmaId, aluno.id);
  if (jaTem) throw new AppError(`${aluno.nome} já está ${jaTem.status === 'espera' ? 'na fila de espera' : 'matriculado'} nesta turma.`);

  // A lista de instrumentos da turma e um cardapio de opcoes (ex.: violao
  // aco OU violao de naylon), nao uma exigencia de que cada aluno precise
  // de todos ao mesmo tempo — cada aluno usa UM deles. Com 1 so instrumento
  // (o caso mais comum) nem precisa perguntar, ja usa esse. Com mais de um,
  // e obrigatorio dizer qual, senao nao da pra saber de qual acervo
  // descontar a vaga.
  let inst = null;
  if (turma.instrumentos.length === 1) {
    inst = turma.instrumentos[0];
  } else if (turma.instrumentos.length > 1) {
    const escolhidoId = Number(instrumento_id);
    inst = turma.instrumentos.find((i) => i.id === escolhidoId);
    if (!inst) throw new AppError('Esta turma tem mais de um instrumento. Escolha qual instrumento este aluno vai usar.');
  }

  // Aluno que nao depende do acervo pro instrumento escolhido (tem o
  // proprio, ou ja esta com um exemplar emprestado pelo instituto) nao
  // compete por vaga dele.
  const jaTemInstrumento = !inst || instrumentos.alunoJaTemInstrumento(aluno.id, inst.id);
  if (inst && !jaTemInstrumento) {
    const disp = instrumentos.vagasDisponiveis(inst.id, turma.horarios, {
      turmaIdIgnorar: turmaId,
      instrumentosPorAluno: turma.instrumentos_por_aluno,
    });
    const usandoAcervo = turma.matriculas.filter((m) => m.status === 'ativa' && m.instrumento_id === inst.id
      && !instrumentos.alunoJaTemInstrumento(m.aluno_id, inst.id)).length;
    if (usandoAcervo >= disp.vagas_maximas) {
      throw new AppError(
        `Não há ${disp.instrumento} disponível neste horário para ${aluno.nome}. `
        + `Os ${disp.vagas_maximas} do acervo já estão com outros alunos. `
        + 'Se o aluno tiver o próprio instrumento, marque isso no cadastro dele — '
        + 'ou, se ele já está com um exemplar emprestado do instituto, isso conta como se ele já tivesse o instrumento.'
      );
    }
  }

  // Quem traz o instrumento escolhido (proprio ou ja emprestado pelo
  // instituto) nao usa nada do acervo — entao a vaga que falta e so um
  // numero na ficha, nao um limite de verdade, e nunca vai pra fila de
  // espera por causa dela. Quem depende do acervo so entra em espera se as
  // vagas OCUPADAS DE VERDADE (excluindo quem furou) ja baterem no limite.
  const naoUsaAcervo = !!inst && jaTemInstrumento;
  const ativas = turma.matriculas.filter((m) => m.status === 'ativa');
  const cheia = !naoUsaAcervo && contarVagas(ativas, turma.vagas).usandoAcervo >= turma.vagas;
  const status = cheia ? 'espera' : 'ativa';

  const info = db.prepare(
    'INSERT INTO matriculas (turma_id, aluno_id, status, observacao, instrumento_id) VALUES (?, ?, ?, ?, ?)'
  ).run(turmaId, aluno.id, status, (observacao || '').trim() || null, inst ? inst.id : null);

  return {
    matricula: db.prepare('SELECT * FROM matriculas WHERE id = ?').get(info.lastInsertRowid),
    entrou_na_espera: status === 'espera',
    turma: obter(turmaId),
  };
}

/**
 * Muda a situacao do aluno na turma. Ao liberar uma vaga (saida/desistencia),
 * chama automaticamente o primeiro da fila de espera.
 */
function mudarStatusMatricula(matriculaId, status, observacao) {
  const db = getDb();
  if (!STATUS_MATRICULA.includes(status)) throw new AppError('Situação de matrícula inválida.');
  const m = db.prepare('SELECT * FROM matriculas WHERE id = ?').get(matriculaId);
  if (!m) throw new AppError('Matrícula não encontrada.', 404);

  const saiu = ['desistente', 'concluida', 'trancada'].includes(status);
  db.prepare(`
    UPDATE matriculas SET status = ?, observacao = COALESCE(?, observacao),
      data_saida = CASE WHEN ? THEN date('now','localtime') ELSE NULL END
    WHERE id = ?
  `).run(status, (observacao || '').trim() || null, saiu ? 1 : 0, matriculaId);

  let promovido = null;
  if (saiu && m.status === 'ativa') promovido = chamarPrimeiroDaEspera(db, m.turma_id);

  return { turma: obter(m.turma_id), promovido };
}

/** Puxa o primeiro da fila de espera para uma vaga que abriu. */
function chamarPrimeiroDaEspera(db, turmaId) {
  const turma = db.prepare('SELECT vagas FROM turmas WHERE id = ?').get(turmaId);
  // Quem esta na espera sempre depende do acervo (quem traz o proprio
  // instrumento nunca entra em espera, ja fura a vaga na hora da matricula)
  // — entao so as vagas ocupadas de verdade (excluindo quem furou) importam aqui.
  const ativas = db.prepare("SELECT aluno_id, instrumento_id FROM matriculas WHERE turma_id = ? AND status = 'ativa'").all(turmaId);
  if (contarVagas(ativas, turma.vagas).usandoAcervo >= turma.vagas) return null;

  const proximo = db.prepare(`
    SELECT m.*, c.nome AS aluno_nome FROM matriculas m JOIN clientes c ON c.id = m.aluno_id
    WHERE m.turma_id = ? AND m.status = 'espera' ORDER BY m.id LIMIT 1
  `).get(turmaId);
  if (!proximo) return null;

  db.prepare("UPDATE matriculas SET status = 'ativa' WHERE id = ?").run(proximo.id);
  return { id: proximo.id, aluno_nome: proximo.aluno_nome };
}

function removerMatricula(matriculaId) {
  const db = getDb();
  const m = db.prepare('SELECT * FROM matriculas WHERE id = ?').get(matriculaId);
  if (!m) throw new AppError('Matrícula não encontrada.', 404);
  const temPresenca = db.prepare(`
    SELECT COUNT(*) c FROM presencas p JOIN agendamentos a ON a.id = p.agendamento_id
    WHERE a.turma_id = ? AND p.aluno_id = ?
  `).get(m.turma_id, m.aluno_id).c;
  if (temPresenca > 0) {
    throw new AppError('Este aluno já tem presença registrada nesta turma. Marque como desistente para preservar o histórico.');
  }
  db.prepare('DELETE FROM matriculas WHERE id = ?').run(matriculaId);
  const promovido = m.status === 'ativa' ? chamarPrimeiroDaEspera(db, m.turma_id) : null;
  return { turma: obter(m.turma_id), promovido };
}

// ============================ Encontros ============================

/**
 * Cria no calendario os encontros da turma para os proximos 90 dias,
 * respeitando o periodo dela. Idempotente: so cria o que ainda nao existe,
 * entao pode rodar a cada boot/edicao sem duplicar (mesmo espirito da aula
 * fixa semanal que ja existia).
 */
function gerarEncontros(turmaId, diasAFrente = 90) {
  const db = getDb();
  const turma = db.prepare('SELECT * FROM turmas WHERE id = ?').get(turmaId);
  if (!turma || !['aberta', 'planejada'].includes(turma.status)) return { geradas: 0 };

  const horarios = db.prepare('SELECT * FROM turmas_horarios WHERE turma_id = ?').all(turmaId);
  if (!horarios.length) return { geradas: 0 };

  const curso = db.prepare('SELECT nome FROM cursos WHERE id = ?').get(turma.curso_id);
  const titular = db.prepare("SELECT profissional_id FROM turmas_instrutores WHERE turma_id = ? AND papel = 'titular' LIMIT 1").get(turmaId);

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const limite = new Date(hoje);
  limite.setDate(limite.getDate() + diasAFrente);

  const jaExiste = db.prepare('SELECT 1 FROM agendamentos WHERE turma_id = ? AND data = ? AND hora_inicio = ?');
  const inserir = db.prepare(`
    INSERT INTO agendamentos (data, hora_inicio, hora_fim, profissional_id, servico_nome, valor, status, turma_id, observacao)
    VALUES (?, ?, ?, ?, ?, 0, 'agendado', ?, ?)
  `);

  let geradas = 0;
  const rodar = db.transaction(() => {
    for (let d = new Date(hoje); d <= limite; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (iso < turma.periodo_inicio) continue;
      if (turma.periodo_fim && iso > turma.periodo_fim) break;

      horarios.filter((h) => Number(h.dia_semana) === d.getDay()).forEach((h) => {
        if (jaExiste.get(turmaId, iso, h.hora_inicio)) return;
        inserir.run(iso, h.hora_inicio, h.hora_fim, titular ? titular.profissional_id : null,
          `${curso ? curso.nome : 'Aula'} — ${turma.nome}`, turmaId, turma.sala ? `Sala: ${turma.sala}` : null);
        geradas++;
      });
    }
  });
  rodar();
  return { geradas };
}

/**
 * Remove do calendario os encontros FUTUROS que nao batem mais com os
 * horarios atuais da turma (depois de o dia/hora terem sido editados).
 *
 * Nunca mexe no passado nem em encontro que ja teve chamada: o historico do
 * que realmente aconteceu vale mais que a arrumacao do calendario.
 */
function limparEncontrosForaDoHorario(turmaId) {
  const db = getDb();
  const horarios = db.prepare('SELECT * FROM turmas_horarios WHERE turma_id = ?').all(turmaId);
  const turma = db.prepare('SELECT periodo_inicio, periodo_fim FROM turmas WHERE id = ?').get(turmaId);
  const hoje = hojeISO();

  const futuros = db.prepare(`
    SELECT a.id, a.data, a.hora_inicio FROM agendamentos a
    WHERE a.turma_id = ? AND a.data >= ?
      AND NOT EXISTS (SELECT 1 FROM presencas p WHERE p.agendamento_id = a.id)
  `).all(turmaId, hoje);

  const excluir = db.prepare('DELETE FROM agendamentos WHERE id = ?');
  let removidos = 0;
  const rodar = db.transaction(() => {
    futuros.forEach((enc) => {
      const diaSemana = new Date(enc.data + 'T12:00:00').getDay();
      const casa = horarios.some((h) => Number(h.dia_semana) === diaSemana && h.hora_inicio === enc.hora_inicio);
      const dentroDoPeriodo = enc.data >= turma.periodo_inicio && (!turma.periodo_fim || enc.data <= turma.periodo_fim);
      if (!casa || !dentroDoPeriodo) { excluir.run(enc.id); removidos++; }
    });
  });
  rodar();
  return { removidos };
}

/**
 * Quem poderia cobrir este encontro se o instrutor titular faltar.
 *
 * Usa a disponibilidade que os voluntarios ja informaram no cadastro: cruza
 * o dia da semana e o horario do encontro com as faixas de cada um. Quem ja
 * e da turma aparece primeiro (conhece os alunos); quem esta ocupado em
 * outra turma no mesmo horario e descartado.
 */
function sugerirSubstitutos(agendamentoId) {
  const db = getDb();
  const enc = db.prepare(`
    SELECT a.*, t.nome AS turma_nome FROM agendamentos a
    JOIN turmas t ON t.id = a.turma_id WHERE a.id = ?
  `).get(agendamentoId);
  if (!enc) throw new AppError('Encontro não encontrado.', 404);

  const diaSemana = new Date(enc.data + 'T12:00:00').getDay();
  const horaFim = enc.hora_fim || enc.hora_inicio;

  const candidatos = db.prepare(`
    SELECT DISTINCT p.id, p.nome, p.tipo, p.telefone,
      (SELECT 1 FROM turmas_instrutores ti WHERE ti.turma_id = @turmaId AND ti.profissional_id = p.id) AS ja_e_da_turma,
      (SELECT ti.papel FROM turmas_instrutores ti WHERE ti.turma_id = @turmaId AND ti.profissional_id = p.id) AS papel
    FROM profissionais p
    JOIN voluntarios_disponibilidade d ON d.profissional_id = p.id
    WHERE p.ativo = 1
      AND d.dia_semana = @diaSemana
      AND d.hora_inicio <= @horaInicio AND d.hora_fim >= @horaFim
      AND p.id != COALESCE(@titularId, -1)
      -- descarta quem ja esta dando outra aula no mesmo horario
      AND NOT EXISTS (
        SELECT 1 FROM agendamentos o
        WHERE o.data = @data AND o.id != @agendamentoId AND o.profissional_id = p.id
          AND o.status NOT IN ('cancelado')
          AND o.hora_inicio < @horaFim AND COALESCE(o.hora_fim, o.hora_inicio) > @horaInicio
      )
    ORDER BY ja_e_da_turma DESC, p.nome
  `).all({
    turmaId: enc.turma_id,
    diaSemana,
    horaInicio: enc.hora_inicio,
    horaFim,
    titularId: enc.profissional_id,
    data: enc.data,
    agendamentoId,
  });

  return {
    encontro: {
      id: enc.id, data: enc.data, hora_inicio: enc.hora_inicio, hora_fim: enc.hora_fim,
      turma_nome: enc.turma_nome,
    },
    candidatos,
  };
}

/** Troca quem vai dar a aula neste encontro (cobertura de falta). */
function definirInstrutorDoEncontro(agendamentoId, profissionalId) {
  const db = getDb();
  const enc = db.prepare('SELECT * FROM agendamentos WHERE id = ? AND turma_id IS NOT NULL').get(agendamentoId);
  if (!enc) throw new AppError('Encontro não encontrado.', 404);
  if (profissionalId && !db.prepare('SELECT 1 FROM profissionais WHERE id = ?').get(Number(profissionalId))) {
    throw new AppError('Instrutor não encontrado.');
  }
  db.prepare('UPDATE agendamentos SET profissional_id = ? WHERE id = ?').run(profissionalId ? Number(profissionalId) : null, agendamentoId);
  return { ok: true };
}

/** Gera os encontros de todas as turmas ativas (chamado no boot do sistema). */
function gerarEncontrosPendentes() {
  const db = getDb();
  const turmas = db.prepare("SELECT id FROM turmas WHERE status IN ('aberta','planejada')").all();
  let geradas = 0;
  turmas.forEach((t) => { geradas += gerarEncontros(t.id).geradas; });
  return { geradas };
}

// ==================== Progresso e suspensão de encontro ====================

/**
 * % de conclusao da turma frente a carga horaria do curso: soma as horas de
 * cada encontro ja passado (e nao suspenso) e compara com a carga horaria
 * cadastrada. Sem carga horaria no curso, nao ha o que medir.
 */
function progressoTurma(id) {
  const db = getDb();
  const turma = obter(id);
  if (!turma.curso_carga_horaria) {
    return { carga_horaria: null, horas_dadas: 0, horas_restantes: null, percentual: null };
  }
  const hoje = hojeISO();
  const encontros = db.prepare(`
    SELECT hora_inicio, hora_fim FROM agendamentos
    WHERE turma_id = ? AND data <= ? AND suspensa = 0
  `).all(id, hoje);
  // Turma antiga que ja tinha aula antes de entrar no sistema: o calendario
  // so comeca a existir a partir de quando ela foi cadastrada, entao
  // "horas_abonadas" e o credito manual pras aulas de antes (nao inventa
  // encontro nem chamada retroativos, so soma no total).
  const horasDadas = encontros.reduce((s, e) => s + duracaoHoras(e), 0) + Number(turma.horas_abonadas || 0);
  const cargaHoraria = Number(turma.curso_carga_horaria);
  const percentual = Math.min(100, Math.round((horasDadas / cargaHoraria) * 100));
  return {
    carga_horaria: cargaHoraria,
    horas_dadas: arred(horasDadas),
    horas_abonadas: Number(turma.horas_abonadas || 0),
    horas_restantes: Math.max(0, arred(cargaHoraria - horasDadas)),
    percentual,
  };
}

/**
 * Suspende (ou reabre) um dia de aula — feriado, imprevisto, instrutor que
 * viajou. Um encontro suspenso nao conta como aula dada nem entra na
 * frequencia, e a previsao de termino da turma e recalculada na hora: um dia
 * a menos empurra o fim mais pra frente (se o curso tiver carga horaria
 * cadastrada). O calendario e regenerado pra criar o encontro extra que
 * cobre a hora perdida.
 */
/** Recalcula periodo_fim de uma turma apos suspender/reabrir dias (so quando o curso tem carga horaria). */
function recalcularFimAposSuspensao(db, turmaId) {
  const turma = db.prepare('SELECT * FROM turmas WHERE id = ?').get(turmaId);
  const curso = db.prepare('SELECT carga_horaria FROM cursos WHERE id = ?').get(turma.curso_id);
  if (!curso.carga_horaria) return;
  const horarios = db.prepare('SELECT * FROM turmas_horarios WHERE turma_id = ?').all(turmaId);
  const suspensas = new Set(
    db.prepare('SELECT data FROM agendamentos WHERE turma_id = ? AND suspensa = 1').all(turmaId).map((r) => r.data)
  );
  const novoFim = calcularFimAutomatico(turma.periodo_inicio, horarios, curso.carga_horaria, suspensas);
  db.prepare('UPDATE turmas SET periodo_fim = ? WHERE id = ?').run(novoFim, turmaId);
}

function suspenderEncontro(agendamentoId, { suspender = true, motivo } = {}) {
  const db = getDb();
  const enc = db.prepare('SELECT * FROM agendamentos WHERE id = ? AND turma_id IS NOT NULL').get(agendamentoId);
  if (!enc) throw new AppError('Encontro não encontrado.', 404);
  if (db.prepare('SELECT 1 FROM presencas WHERE agendamento_id = ?').get(agendamentoId)) {
    throw new AppError('Este encontro já tem chamada registrada — não dá para suspender depois que a aula já aconteceu.');
  }

  const rodar = db.transaction(() => {
    db.prepare('UPDATE agendamentos SET suspensa = ?, motivo_suspensao = ? WHERE id = ?')
      .run(suspender ? 1 : 0, suspender ? ((motivo || '').trim() || null) : null, agendamentoId);
    recalcularFimAposSuspensao(db, enc.turma_id);
  });
  rodar();

  // Reabrir um dia pode encurtar a previsao de novo: tira do calendario o
  // que passou a sobrar depois do periodo_fim recalculado (nunca mexe no que
  // ja tem chamada registrada — isso limparEncontrosForaDoHorario ja garante).
  limparEncontrosForaDoHorario(enc.turma_id);
  gerarEncontros(enc.turma_id);
  return obter(enc.turma_id);
}

/**
 * Suspende em lote o mesmo período de dias (férias, recesso do instituto)
 * em todas as turmas ativas que tiverem encontro nele — sem precisar entrar
 * turma por turma. Encontro que já tem chamada registrada é ignorado (aula
 * que já rolou não pode ser desfeita); o restante segue exatamente a mesma
 * regra da suspensão individual, turma por turma: recalcula periodo_fim
 * quando o curso tem carga horária e resincroniza o calendário.
 */
function suspenderPeriodo({ de, ate, motivo }) {
  const db = getDb();
  const dataDe = String(de || '').trim();
  const dataAte = String(ate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDe) || !/^\d{4}-\d{2}-\d{2}$/.test(dataAte)) {
    throw new AppError('Informe as datas de início e fim do período de férias.');
  }
  if (dataAte < dataDe) throw new AppError('A data final não pode ser antes da inicial.');

  const motivoFinal = (motivo || '').trim() || 'Férias';
  const hoje = hojeISO();
  const diasNecessarios = Math.max(90, Math.ceil((new Date(`${dataAte}T12:00:00`) - new Date(`${hoje}T12:00:00`)) / 864e5) + 7);

  const turmasAtivas = db.prepare("SELECT id, nome FROM turmas WHERE status IN ('aberta','planejada')").all();

  let turmasAfetadas = 0;
  let encontrosSuspensos = 0;
  let encontrosComChamadaIgnorados = 0;
  const turmasComChamadaPendente = [];

  turmasAtivas.forEach((t) => {
    // garante que o calendario ja cobre o periodo pedido antes de tentar suspender
    // (gerarEncontros e idempotente: so cria o que ainda nao existe).
    gerarEncontros(t.id, diasNecessarios);

    const encontros = db.prepare(`
      SELECT id FROM agendamentos WHERE turma_id = ? AND data BETWEEN ? AND ? AND suspensa = 0
    `).all(t.id, dataDe, dataAte);
    if (!encontros.length) return;

    let algumSuspenso = false;
    let bloqueadoPorChamada = false;
    encontros.forEach((enc) => {
      if (db.prepare('SELECT 1 FROM presencas WHERE agendamento_id = ?').get(enc.id)) {
        encontrosComChamadaIgnorados++;
        bloqueadoPorChamada = true;
        return;
      }
      db.prepare('UPDATE agendamentos SET suspensa = 1, motivo_suspensao = ? WHERE id = ?').run(motivoFinal, enc.id);
      encontrosSuspensos++;
      algumSuspenso = true;
    });

    if (algumSuspenso) {
      turmasAfetadas++;
      recalcularFimAposSuspensao(db, t.id);
      limparEncontrosForaDoHorario(t.id);
      gerarEncontros(t.id);
    }
    if (bloqueadoPorChamada) turmasComChamadaPendente.push(t.nome);
  });

  return {
    turmas_afetadas: turmasAfetadas,
    encontros_suspensos: encontrosSuspensos,
    encontros_com_chamada_ignorados: encontrosComChamadaIgnorados,
    turmas_com_chamada_pendente: turmasComChamadaPendente,
  };
}

/**
 * Aulas de verdade (com data marcada) que um instrutor vai dar num período —
 * pra imprimir o calendário do mês (ou de vários meses) com as datas reais,
 * já com os alunos matriculados em cada turma logo abaixo.
 */
function encontrosDoInstrutor(profissionalId, { de, ate } = {}) {
  const db = getDb();
  // agendamentos.profissional_id só guarda o titular (é quem entra sozinho
  // na agenda de verdade) — um auxiliar ou suplente nunca aparece por ali,
  // mesmo escalado na turma. O calendário do instrutor precisa de QUALQUER
  // papel, então casa por turmas_instrutores em vez de a.profissional_id.
  const where = ['a.turma_id IS NOT NULL', "t.status != 'cancelada'"];
  const params = { profissionalId: Number(profissionalId) };
  if (de) { where.push('a.data >= @de'); params.de = de; }
  if (ate) { where.push('a.data <= @ate'); params.ate = ate; }

  const encontros = db.prepare(`
    SELECT a.id, a.data, a.hora_inicio, a.hora_fim, a.suspensa, a.turma_id,
      t.nome AS turma_nome, t.sala, c.nome AS curso_nome, ti.papel AS papel
    FROM agendamentos a
    JOIN turmas t ON t.id = a.turma_id
    JOIN cursos c ON c.id = t.curso_id
    JOIN turmas_instrutores ti ON ti.turma_id = t.id AND ti.profissional_id = @profissionalId
    WHERE ${where.join(' AND ')}
    ORDER BY a.data, a.hora_inicio
  `).all(params);

  const alunosPorTurma = new Map();
  const buscarAlunos = db.prepare(`
    SELECT cl.nome FROM matriculas m JOIN clientes cl ON cl.id = m.aluno_id
    WHERE m.turma_id = ? AND m.status = 'ativa' ORDER BY cl.nome
  `);
  encontros.forEach((e) => {
    if (!alunosPorTurma.has(e.turma_id)) {
      alunosPorTurma.set(e.turma_id, buscarAlunos.all(e.turma_id).map((r) => r.nome));
    }
    e.alunos = alunosPorTurma.get(e.turma_id);
    e.dia_semana = new Date(e.data + 'T12:00:00').getDay();
  });
  return encontros;
}

/** Escala de aulas num período (um dia ou um mês inteiro) — base da impressão para mural. */
function escalaDoPeriodo({ de, ate } = {}) {
  const db = getDb();
  const inicio = de;
  const fim = ate || de;
  const encontros = db.prepare(`
    SELECT a.id, a.data, a.hora_inicio, a.hora_fim, a.suspensa, a.motivo_suspensao, a.turma_id,
      t.nome AS turma_nome, t.sala, c.nome AS curso_nome,
      p.nome AS profissional_nome
    FROM agendamentos a
    JOIN turmas t ON t.id = a.turma_id
    JOIN cursos c ON c.id = t.curso_id
    LEFT JOIN profissionais p ON p.id = a.profissional_id
    WHERE a.turma_id IS NOT NULL AND a.data BETWEEN @inicio AND @fim AND t.status != 'cancelada'
    ORDER BY a.data, a.hora_inicio, t.nome
  `).all({ inicio, fim });

  const alunosPorTurma = new Map();
  const buscarAlunos = db.prepare(`
    SELECT cl.nome FROM matriculas m JOIN clientes cl ON cl.id = m.aluno_id
    WHERE m.turma_id = ? AND m.status = 'ativa' ORDER BY cl.nome
  `);
  encontros.forEach((e) => {
    if (!alunosPorTurma.has(e.turma_id)) {
      alunosPorTurma.set(e.turma_id, buscarAlunos.all(e.turma_id).map((r) => r.nome));
    }
    e.alunos = alunosPorTurma.get(e.turma_id);
  });
  return encontros;
}

function escalaDoDia(data) {
  return escalaDoPeriodo({ de: data, ate: data });
}

module.exports = {
  listar, obter, criar, atualizar, excluir,
  encerrar, renovar, historicoDaTurma,
  matricular, mudarStatusMatricula, removerMatricula,
  gerarEncontros, gerarEncontrosPendentes, limparEncontrosForaDoHorario,
  sugerirSubstitutos, definirInstrutorDoEncontro,
  comInstrumentoProprio, progressoTurma, suspenderEncontro, suspenderPeriodo, encontrosDoInstrutor,
  escalaDoDia, escalaDoPeriodo, contarVagas,
  STATUS_TURMA, STATUS_MATRICULA, DIAS,
};
