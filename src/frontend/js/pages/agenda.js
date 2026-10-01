'use strict';

/**
 * Agenda: agendamentos do dia por profissional, com status, faturamento
 * (gera a venda do serviço) e envio de confirmação por WhatsApp.
 * Cadastro da equipe (profissionais) no mesmo módulo.
 * No instituto a agenda só mostra as aulas (geradas pelas turmas ou avulsas):
 * sem faturar, sem "equipe" (isso é a página Voluntários) e sem aula fixa
 * separada, porque a recorrência já vem da turma.
 */
window.PaginaAgenda = (function () {
  let dia = new Date().toISOString().slice(0, 10);
  let mesAtual = dia.slice(0, 7); // 'YYYY-MM', usado na visão de calendário
  let vista = 'dia'; // 'semana' | 'dia' | 'mes' | 'recorrentes'
  let vistaPadraoAplicada = false;
  let profissionais = [];
  let clientes = [];
  let servicos = [];
  let aulasRecorrentes = [];
  let filtroProf = '';

  const STATUS = {
    agendado: ['Agendado', 'alerta'], confirmado: ['Confirmado', 'muted'],
    atendido: ['Atendido', 'ok'], cancelado: ['Cancelado', 'muted'], faltou: ['Faltou', 'erro'],
  };
  const FORMAS = { dinheiro: 'Dinheiro', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito', pix: 'PIX', prazo: 'A prazo' };
  const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

  // Rotulos: para o ramo "professor" (aulas particulares), fala a lingua do dia a dia do professor.
  const ehProfessor = () => window.__ramoServico === 'professor';
  // Num instituto sem fins lucrativos a aula nao vira venda: nao ha o que
  // faturar, nem valor ou servico a cobrar do aluno.
  const ehInstituto = () => window.__ramoServico === 'instituto';
  // Creche cobra mensalidade fixa (Financeiro > Mensalidades), nunca por
  // agendamento avulso: nao ha o que faturar aqui, como no instituto.
  const ehCreche = () => window.__ramoServico === 'creche';
  const crecheComTurma = () => ehCreche() && !!window.__crecheComTurma;
  // Valor/faturamento por aula nao existe nesses ramos: instituto e creche nao
  // vendem aula, e o professor cobra por mensalidade (Financeiro > Mensalidades).
  const semValorPorAula = () => ehInstituto() || ehCreche() || ehProfessor();
  const rCliente = (m) => ((ehProfessor() || ehInstituto() || ehCreche()) ? (m ? 'Aluno' : 'aluno') : (m ? 'Cliente' : 'cliente'));
  const rServico = (m) => (ehInstituto() ? (m ? 'Atividade' : 'atividade') : ehProfessor() ? (m ? 'Matéria' : 'matéria') : (m ? 'Serviço' : 'serviço'));
  const rAula = (m) => ((ehProfessor() || ehInstituto() || ehCreche()) ? (m ? 'Aula' : 'aula') : (m ? 'Agendamento' : 'agendamento'));
  const rProf = (m) => (ehInstituto() ? (m ? 'Instrutor' : 'instrutor') : (m ? 'Profissional' : 'profissional'));
  const rProfs = () => (ehInstituto() ? 'instrutores' : 'profissionais');

  function badge(s) { const [t, c] = STATUS[s] || [s, 'muted']; return `<span class="badge badge--${c}">${t}</span>`; }
  // Encontro de turma suspenso (feriado, férias): não é "agendado" nem
  // "cancelado" de verdade, é um dia que simplesmente não vai ter aula — por
  // isso ganha um badge próprio em vez do status normal, que confundiria.
  function badgeStatus(a) {
    return a.suspensa
      ? `<span class="badge badge--muted" title="${UI.escapar(a.motivo_suspensao || 'Dia suspenso')}">Suspensa</span>`
      : badge(a.status);
  }
  // Encontro gerado por turma nao tem cliente vinculado: o nome a mostrar
  // e o da turma/curso (guardado em servico_nome na hora de gerar), senao
  // some com "Sem aluno" mesmo tendo turma inteira ali.
  function nomeAgendamento(a) {
    return a.cliente_cadastro || a.cliente_nome || (a.turma_id ? (a.servico_nome || 'Turma') : `Sem ${rCliente()}`);
  }
  function mudarDia(delta) {
    const d = new Date(dia + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    dia = d.toISOString().slice(0, 10);
  }
  function diaLabel(iso) {
    const d = new Date(iso + 'T00:00:00');
    const semana = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
    return `${d.toLocaleDateString('pt-BR')} · ${semana[d.getDay()]}`;
  }
  function mesLabel(aaMm) {
    const [a, m] = aaMm.split('-').map(Number);
    const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return `${nomes[m - 1]} de ${a}`;
  }
  function mudarMes(aaMm, delta) {
    const [a, m] = aaMm.split('-').map(Number);
    const d = new Date(a, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  async function render(container) {
    // Professor particular enxerga a semana inteira de uma vez: e' a vista padrao.
    if (!vistaPadraoAplicada) { vistaPadraoAplicada = true; if (ehProfessor()) vista = 'semana'; }
    [profissionais, clientes, servicos] = await Promise.all([
      API.get('/api/agenda/profissionais').catch(() => []),
      API.get('/api/clientes').catch(() => []),
      API.get('/api/produtos?eh_servico=1').catch(() => []),
    ]);
    if (!ehInstituto()) await API.post('/api/agenda/aulas-recorrentes/gerar-pendentes', {}).catch(() => {});
    if ((ehInstituto() || crecheComTurma()) && vista === 'recorrentes') vista = 'dia';

    container.innerHTML = `
      <div class="subtabs">
        ${ehProfessor() ? `<button class="subtab ${vista === 'semana' ? 'subtab--ativa' : ''}" data-vista="semana">🗓️ Semana</button>` : ''}
        <button class="subtab ${vista === 'dia' ? 'subtab--ativa' : ''}" data-vista="dia">📋 Dia</button>
        <button class="subtab ${vista === 'mes' ? 'subtab--ativa' : ''}" data-vista="mes">📆 Mês</button>
        ${(ehInstituto() || crecheComTurma()) ? '' : `<button class="subtab ${vista === 'recorrentes' ? 'subtab--ativa' : ''}" data-vista="recorrentes">🔁 ${rAula(true)} fixa</button>`}
      </div>
      <div id="ag-corpo"></div>`;
    container.querySelectorAll('[data-vista]').forEach((b) => b.addEventListener('click', () => {
      if (vista === b.dataset.vista) return;
      vista = b.dataset.vista; render(container);
    }));

    if (vista === 'semana' && ehProfessor()) await renderSemana();
    else if (vista === 'mes') await renderMes();
    else if (vista === 'recorrentes') await renderRecorrentes();
    else await renderDia();
  }

  // ------------------------------ Visão: Semana (professor) ------------------------------
  async function renderSemana() {
    const alvo = document.getElementById('ag-corpo');
    if (!alvo) return;
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        ${profissionais.length ? `<select id="ag-prof-filtro-sem">
          <option value="">Todos os ${rProfs()}</option>
          ${profissionais.map((p) => `<option value="${p.id}" ${String(filtroProf) === String(p.id) ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
        </select>` : ''}
        <div class="cresce"></div>
        <button class="btn btn--secundario" id="ag-equipe-sem">👥 Equipe</button>
        <button class="btn" id="ag-novo-sem">+ Nova aula</button>
      </div>
      <div id="ag-semana"></div>`;
    const filtro = alvo.querySelector('#ag-prof-filtro-sem');
    if (filtro) filtro.addEventListener('change', (e) => { filtroProf = e.target.value; renderSemana(); });
    alvo.querySelector('#ag-equipe-sem').addEventListener('click', gerenciarEquipe);
    alvo.querySelector('#ag-novo-sem').addEventListener('click', () => abrirForm());
    await AgendaSemana.render(alvo.querySelector('#ag-semana'), {
      profissionalId: filtroProf,
      aoAbrirAula: (a) => abrirDetalhe(a),
      aoNovaAula: (data, hora) => abrirForm(null, { data, hora_inicio: hora }),
    });
  }

  // ------------------------------ Visão: Dia ------------------------------
  async function renderDia() {
    const alvo = document.getElementById('ag-corpo');
    if (!alvo) return;
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <div class="flex gap-12" style="align-items:center">
          <button class="btn btn--secundario" id="ag-ant">◀</button>
          <strong style="min-width:230px;text-align:center">${diaLabel(dia)}</strong>
          <button class="btn btn--secundario" id="ag-prox">▶</button>
          <input type="date" id="ag-data" value="${dia}" />
          <button class="btn btn--secundario" id="ag-hoje">Hoje</button>
        </div>
        <select id="ag-prof-filtro">
          <option value="">Todos os ${rProfs()}</option>
          ${profissionais.map((p) => `<option value="${p.id}" ${String(filtroProf) === String(p.id) ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
        </select>
        <div class="cresce"></div>
        ${ehInstituto() ? '<button class="btn btn--secundario" id="ag-imprimir">🖨️ Imprimir escala do dia</button>' : '<button class="btn btn--secundario" id="ag-equipe">👥 Equipe</button>'}
        <button class="btn" id="ag-novo">+ Nov${rAula() === 'aula' ? 'a' : 'o'} ${rAula()}</button>
      </div>
      <div id="ag-resumo"></div>
      <div id="ag-lista"><div class="card">Carregando…</div></div>`;

    alvo.querySelector('#ag-ant').addEventListener('click', () => { mudarDia(-1); renderDia(); });
    alvo.querySelector('#ag-prox').addEventListener('click', () => { mudarDia(1); renderDia(); });
    alvo.querySelector('#ag-hoje').addEventListener('click', () => { dia = new Date().toISOString().slice(0, 10); renderDia(); });
    alvo.querySelector('#ag-data').addEventListener('change', (e) => { dia = e.target.value || dia; renderDia(); });
    alvo.querySelector('#ag-prof-filtro').addEventListener('change', (e) => { filtroProf = e.target.value; listar(); });
    const btnEquipe = alvo.querySelector('#ag-equipe');
    if (btnEquipe) btnEquipe.addEventListener('click', gerenciarEquipe);
    const btnImprimir = alvo.querySelector('#ag-imprimir');
    if (btnImprimir) btnImprimir.addEventListener('click', () => Documentos.escalaDoDia(dia));
    alvo.querySelector('#ag-novo').addEventListener('click', () => abrirForm());

    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('ag-lista');
    if (!alvo) return;
    const params = new URLSearchParams({ data: dia });
    if (filtroProf) params.set('profissional_id', filtroProf);
    let itens; let resumo;
    try {
      [itens, resumo] = await Promise.all([
        API.get('/api/agenda?' + params.toString()),
        API.get('/api/agenda/resumo?data=' + dia),
      ]);
    } catch (e) { alvo.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}</div>`; return; }

    const res = document.getElementById('ag-resumo');
    if (res) res.innerHTML = `<div class="grid grid--cards mb-16">
      <div class="card stat"><span class="stat__label">${rAula(true)}s do dia</span><span class="stat__value">${resumo.total}</span></div>
      <div class="card stat"><span class="stat__label">Pendentes</span><span class="stat__value" style="color:var(--alerta)">${resumo.pendentes}</span></div>
      <div class="card stat"><span class="stat__label">Atendidos</span><span class="stat__value" style="color:var(--sucesso)">${resumo.atendidos}</span></div>
      ${ehProfessor() ? '' : `<div class="card stat"><span class="stat__label">Previsto no dia</span><span class="stat__value">${UI.moeda(resumo.previsto)}</span></div>`}
    </div>`;

    if (!itens.length) {
      alvo.innerHTML = `<div class="card vazio">Nenhum${rAula() === 'aula' ? 'a' : ''} ${rAula()} neste dia.
        <div class="mt-16"><button class="btn" onclick="document.getElementById('ag-novo').click()">+ Nov${rAula() === 'aula' ? 'a' : 'o'} ${rAula()}</button></div></div>`;
      return;
    }

    alvo.innerHTML = `<div class="card"><div class="agenda-lista">
      ${itens.map((a) => {
        const nome = nomeAgendamento(a);
        const tel = a.cliente_telefone || a.telefone;
        return `<div class="agenda-item" style="border-left-color:${a.profissional_cor || 'var(--primaria)'}${a.suspensa ? ';opacity:.55' : ''}">
          <div class="agenda-item__hora">${UI.escapar(a.hora_inicio)}${a.hora_fim ? `<span class="dica">até ${UI.escapar(a.hora_fim)}</span>` : ''}</div>
          <div class="agenda-item__info">
            <strong>${UI.escapar(nome)}</strong> ${badgeStatus(a)}${a.venda_id && !semValorPorAula() ? ' <span class="badge badge--ok">faturado</span>' : ''}${a.aula_recorrente_id ? ` <span class="badge badge--muted" title="Gerado automaticamente de uma ${rAula()} fixa">🔁 fixa</span>` : ''}
            <div class="dica">${a.suspensa ? `Suspensa${a.motivo_suspensao ? ' — ' + UI.escapar(a.motivo_suspensao) : ''}` : `${UI.escapar(a.servico_nome || rServico(true))}${a.profissional_nome ? ' · ' + UI.escapar(a.profissional_nome) : ''}${tel ? ' · ' + UI.escapar(tel) : ''}`}</div>
          </div>
          <div class="agenda-item__valor">${a.suspensa || semValorPorAula() ? '' : UI.moeda(a.valor)}</div>
          <div class="agenda-item__acoes">
            ${tel ? `<button class="btn btn--secundario" data-zap="${a.id}" title="Enviar confirmação por WhatsApp">💬</button>` : ''}
            <button class="btn btn--secundario" data-editar="${a.id}">Abrir</button>
          </div>
        </div>`;
      }).join('')}
    </div></div>`;

    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', async () => {
      try { abrirDetalhe(await API.get('/api/agenda/' + b.dataset.editar)); } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-zap]').forEach((b) => b.addEventListener('click', async () => {
      try { enviarWhatsApp(await API.get('/api/agenda/' + b.dataset.zap)); } catch (e) { UI.erro(e.message); }
    }));
  }

  // ------------------------------ Visão: Mês (calendário) ------------------------------
  async function renderMes() {
    const alvo = document.getElementById('ag-corpo');
    if (!alvo) return;
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <div class="flex gap-12" style="align-items:center">
          <button class="btn btn--secundario" id="ag-mes-ant">◀</button>
          <strong style="min-width:170px;text-align:center">${mesLabel(mesAtual)}</strong>
          <button class="btn btn--secundario" id="ag-mes-prox">▶</button>
          <button class="btn btn--secundario" id="ag-mes-hoje">Hoje</button>
        </div>
        <select id="ag-prof-filtro-mes">
          <option value="">Todos os ${rProfs()}</option>
          ${profissionais.map((p) => `<option value="${p.id}" ${String(filtroProf) === String(p.id) ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
        </select>
        <div class="cresce"></div>
        ${ehInstituto() ? '<button class="btn btn--secundario" id="ag-imprimir-mes">🖨️ Imprimir escala do mês</button>' : '<button class="btn btn--secundario" id="ag-equipe-mes">👥 Equipe</button>'}
        <button class="btn" id="ag-novo-mes">+ Nov${rAula() === 'aula' ? 'a' : 'o'} ${rAula()}</button>
      </div>
      <div id="ag-calendario"><div class="card">Carregando…</div></div>`;

    alvo.querySelector('#ag-mes-ant').addEventListener('click', () => { mesAtual = mudarMes(mesAtual, -1); renderMes(); });
    alvo.querySelector('#ag-mes-prox').addEventListener('click', () => { mesAtual = mudarMes(mesAtual, 1); renderMes(); });
    alvo.querySelector('#ag-mes-hoje').addEventListener('click', () => { mesAtual = new Date().toISOString().slice(0, 7); renderMes(); });
    alvo.querySelector('#ag-prof-filtro-mes').addEventListener('change', (e) => { filtroProf = e.target.value; carregarCalendario(); });
    const btnEquipeMes = alvo.querySelector('#ag-equipe-mes');
    if (btnEquipeMes) btnEquipeMes.addEventListener('click', gerenciarEquipe);
    const btnImprimirMes = alvo.querySelector('#ag-imprimir-mes');
    if (btnImprimirMes) btnImprimirMes.addEventListener('click', () => Documentos.escalaDoMes({ deMes: mesAtual, ateMes: mesAtual }));
    alvo.querySelector('#ag-novo-mes').addEventListener('click', () => abrirForm());

    await carregarCalendario();
  }

  async function carregarCalendario() {
    const cal = document.getElementById('ag-calendario');
    if (!cal) return;
    const [ano, mes] = mesAtual.split('-').map(Number);
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const params = new URLSearchParams({ inicio: `${mesAtual}-01`, fim: `${mesAtual}-${String(ultimoDia).padStart(2, '0')}` });
    if (filtroProf) params.set('profissional_id', filtroProf);

    let itens;
    try { itens = await API.get('/api/agenda?' + params.toString()); }
    catch (e) { cal.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}</div>`; return; }

    const porDia = new Map();
    itens.forEach((a) => {
      if (a.status === 'atendido') return; // ja concluido: some do calendario do mes pra nao poluir (continua no dia e nos relatorios)
      if (!porDia.has(a.data)) porDia.set(a.data, []);
      porDia.get(a.data).push(a);
    });

    const primeiroDiaSemana = new Date(ano, mes - 1, 1).getDay(); // 0 = domingo
    const diasNomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const hojeISO = new Date().toISOString().slice(0, 10);

    const celulas = [];
    for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null);
    for (let d = 1; d <= ultimoDia; d++) celulas.push(`${mesAtual}-${String(d).padStart(2, '0')}`);
    while (celulas.length % 7 !== 0) celulas.push(null);

    const MOSTRAR = 3;
    cal.innerHTML = `<div class="cal-grade">
      ${diasNomes.map((n) => `<div class="cal-cabecalho">${n}</div>`).join('')}
      ${celulas.map((iso) => {
        if (!iso) return '<div class="cal-dia cal-dia--vazio"></div>';
        const evs = (porDia.get(iso) || []).slice().sort((a, b) => (a.hora_inicio || '').localeCompare(b.hora_inicio || ''));
        const extras = evs.length - MOSTRAR;
        return `<div class="cal-dia ${iso === hojeISO ? 'cal-dia--hoje' : ''}" data-dia="${iso}">
          <div class="cal-dia__numero">${Number(iso.slice(8, 10))}</div>
          <div class="cal-dia__eventos">
            ${evs.slice(0, MOSTRAR).map((a) => {
              const nome = nomeAgendamento(a);
              const titulo = a.suspensa ? `${a.hora_inicio} — ${nome} (suspensa${a.motivo_suspensao ? ': ' + a.motivo_suspensao : ''})` : `${a.hora_inicio} — ${nome}`;
              return `<div class="cal-evento" data-evento="${a.id}" style="background:${a.profissional_cor || 'var(--primaria)'}${a.suspensa ? ';opacity:.5;text-decoration:line-through' : ''}" title="${UI.escapar(titulo)}">${UI.escapar(a.hora_inicio)} ${UI.escapar(nome)}</div>`;
            }).join('')}
            ${extras > 0 ? `<div class="cal-evento cal-evento--mais">+${extras} mais</div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;

    cal.querySelectorAll('.cal-dia[data-dia]').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.closest('[data-evento]')) return;
      dia = el.dataset.dia; vista = 'dia'; render(document.getElementById('view'));
    }));
    cal.querySelectorAll('[data-evento]').forEach((el) => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { abrirDetalhe(await API.get('/api/agenda/' + el.dataset.evento)); } catch (err) { UI.erro(err.message); }
    }));
  }

  // ------------------------- Visão: Aulas fixas (recorrentes) -------------------------
  async function renderRecorrentes() {
    const alvo = document.getElementById('ag-corpo');
    if (!alvo) return;
    alvo.innerHTML = `
      <p class="dica mb-16">Cadastre um${rAula() === 'aula' ? 'a' : ''} ${rAula()} fixa que se repete toda semana (ex.: "${rServico(true)} com ${rCliente(true).toLowerCase() === 'aluno' ? 'o aluno' : 'o cliente'} X, toda terça às 15h"). O sistema gera automaticamente as próximas ocorrências na agenda — sem precisar recriar toda semana.</p>
      <div class="barra-ferramentas"><div class="cresce"></div><button class="btn" id="rec-nova">+ Nov${rAula() === 'aula' ? 'a' : 'o'} ${rAula()} fixa</button></div>
      <div class="card"><div id="rec-lista">Carregando…</div></div>`;
    alvo.querySelector('#rec-nova').addEventListener('click', () => formRecorrente());
    await listarRecorrentes();
  }

  async function listarRecorrentes() {
    const alvo = document.getElementById('rec-lista');
    if (!alvo) return;
    try { aulasRecorrentes = await API.get('/api/agenda/aulas-recorrentes'); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!aulasRecorrentes.length) { alvo.innerHTML = `<p class="muted">Nenhum${rAula() === 'aula' ? 'a' : ''} ${rAula()} fixa cadastrada.</p>`; return; }
    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>${rCliente(true)}</th>${ehCreche() ? '' : `<th>${rServico(true)}</th>`}<th>Dia/Horário</th>${ehCreche() || ehProfessor() ? '' : '<th>Valor</th>'}<th>Status</th><th></th></tr></thead>
      <tbody>${aulasRecorrentes.map((r) => `<tr style="${r.ativa ? '' : 'opacity:.55'}">
        <td>${UI.escapar(r.aluno_cadastro_nome || r.aluno_nome || '—')}</td>
        ${ehCreche() ? '' : `<td>${UI.escapar(r.materia_nome || '—')}</td>`}
        <td>${DIAS_SEMANA[r.dia_semana]} · ${UI.escapar(r.hora_inicio)}${r.hora_fim ? ' às ' + UI.escapar(r.hora_fim) : ''}</td>
        ${ehCreche() || ehProfessor() ? '' : `<td>${UI.moeda(r.valor)}</td>`}
        <td>${r.ativa ? '<span class="badge badge--ok">Ativa</span>' : '<span class="badge badge--muted">Pausada</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn--secundario" data-rec-pausar="${r.id}" data-ativa="${r.ativa}">${r.ativa ? 'Pausar' : 'Reativar'}</button>
          <button class="btn btn--secundario" data-rec-editar="${r.id}">Editar</button>
          <button class="btn btn--secundario" data-rec-excluir="${r.id}">✕</button>
        </td>
      </tr>`).join('')}</tbody></table>`;

    alvo.querySelectorAll('[data-rec-editar]').forEach((b) => b.addEventListener('click', () => {
      const r = aulasRecorrentes.find((x) => x.id === Number(b.dataset.recEditar));
      formRecorrente(r);
    }));
    alvo.querySelectorAll('[data-rec-pausar]').forEach((b) => b.addEventListener('click', async () => {
      const ativa = b.dataset.ativa === '1';
      try {
        await API.put(`/api/agenda/aulas-recorrentes/${b.dataset.recPausar}`, { ativa: !ativa });
        UI.sucesso(ativa ? `${rAula(true)} fixa pausada.` : `${rAula(true)} fixa reativada.`);
        await listarRecorrentes();
      } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-rec-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar(`Excluir est${rAula() === 'aula' ? 'a' : 'e'} ${rAula()} fixa? As ocorrências já lançadas na agenda não serão apagadas.`, { titulo: `Excluir ${rAula()} fixa`, textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`/api/agenda/aulas-recorrentes/${b.dataset.recExcluir}`); UI.sucesso(`${rAula(true)} fixa excluída.`); await listarRecorrentes(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  function formRecorrente(r) {
    AulaFixaForm.abrir({ aula: r, clientes, servicos, profissionais, aoSalvar: listarRecorrentes });
  }

  // --------------------------- Form de agendamento ---------------------------
  function abrirForm(ag, previa) {
    const ehEdicao = !!ag;
    const a = ag || previa || {};
    Modal.abrir({
      titulo: ehEdicao ? `Editar ${rAula()}` : `Nov${rAula() === 'aula' ? 'a' : 'o'} ${rAula()}`, tamanho: 'modal--grande',
      corpoHTML: `
        <form id="form-ag" class="form-grid">
          <div class="campo"><label>Data *</label><input name="data" type="date" value="${a.data || dia}" required /></div>
          <div class="campo"><label>Hora início *</label><input name="hora_inicio" type="time" value="${a.hora_inicio || '09:00'}" required /></div>
          <div class="campo"><label>Hora fim <span class="dica">(automático pela duração)</span></label><input name="hora_fim" type="time" value="${a.hora_fim || ''}" /></div>
          <div class="campo"><label>${rProf(true)}</label><select name="profissional_id">
            <option value="">—</option>${profissionais.map((p) => `<option value="${p.id}" ${String(a.profissional_id) === String(p.id) ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
          </select></div>
          ${(ehInstituto() || ehCreche()) ? '' : `
          <div class="campo"><label>${rServico(true)}</label><select name="produto_id" id="ag-serv">
            <option value="">— selecione —</option>${servicos.map((s) => `<option value="${s.id}" data-preco="${s.preco_venda}" ${String(a.produto_id) === String(s.id) ? 'selected' : ''}>${UI.escapar(s.nome)}</option>`).join('')}
          </select>${ehProfessor() ? '' : '<span class="dica">Necessário para faturar o atendimento.</span>'}</div>
          ${ehProfessor() ? '' : `<div class="campo"><label>Valor (R$)</label><input name="valor" id="ag-valor" type="number" step="0.01" min="0" value="${a.valor != null ? a.valor : ''}" /></div>`}`}
          <div class="campo"><label>${rCliente(true)} (cadastrado)</label><select name="cliente_id" id="ag-cli">
            <option value="">— avulso —</option>${clientes.map((c) => `<option value="${c.id}" data-tel="${UI.escapar(c.telefone || '')}" ${String(a.cliente_id) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('')}
          </select></div>
          <div class="campo"><label>Ou nome do ${rCliente()}</label><input name="cliente_nome" value="${UI.escapar(a.cliente_nome || '')}" placeholder="${rCliente(true)} sem cadastro" /></div>
          <div class="campo col-2"><label>Telefone (WhatsApp)</label><input name="telefone" id="ag-tel" value="${UI.escapar(a.telefone || '')}" placeholder="Ex.: 11999998888" /></div>
          <div class="campo col-2"><label>Observações</label><textarea name="observacao">${UI.escapar(a.observacao || '')}</textarea></div>
        </form>`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        const serv = el.querySelector('#ag-serv');
        const valor = el.querySelector('#ag-valor');
        if (serv && valor) serv.addEventListener('change', () => {
          const opt = serv.selectedOptions[0];
          if (opt && opt.dataset.preco && !valor.value) valor.value = opt.dataset.preco;
        });
        const cli = el.querySelector('#ag-cli');
        cli.addEventListener('change', () => {
          const opt = cli.selectedOptions[0];
          const tel = el.querySelector('#ag-tel');
          if (opt && opt.dataset.tel && !tel.value) tel.value = opt.dataset.tel;
        });
        CadastroRapido.ligar(el.querySelector('[name="profissional_id"]'), 'profissional', { aoCriar: (r) => profissionais.push(r) });
        CadastroRapido.ligar(serv, 'servico', { aoCriar: (r) => servicos.push(r) });
        CadastroRapido.ligar(cli, 'cliente', { aoCriar: (r) => clientes.push(r) });
      },
      aoConfirmar: async (el) => {
        const dados = Object.fromEntries(new FormData(el.querySelector('#form-ag')).entries());
        try {
          if (ehEdicao) await API.put(`/api/agenda/${a.id}`, dados);
          else await API.post('/api/agenda', dados);
          UI.sucesso(ehEdicao ? `${rAula(true)} atualizad${ehProfessor() ? 'a' : 'o'}.` : `${rAula(true)} criad${ehProfessor() ? 'a' : 'o'}.`);
          if (dados.data) { dia = dados.data; mesAtual = dados.data.slice(0, 7); if (ehProfessor()) AgendaSemana.irPara(dados.data); }
          await render(document.getElementById('view'));
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ------------------------------ Detalhe ------------------------------
  /** Professor: botoes rapidos de presenca para aula ainda sem registro, de hoje ou anterior. Nao fatura. */
  function presencaRapida(a) {
    const d = new Date();
    const hojeLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return ehProfessor() && !a.suspensa && !a.venda_id && (a.status === 'agendado' || a.status === 'confirmado') && a.data <= hojeLocal;
  }

  function abrirDetalhe(a) {
    const nome = nomeAgendamento(a);
    const tel = a.cliente_telefone || a.telefone;
    Modal.abrir({
      titulo: `${a.hora_inicio} — ${nome}`, tamanho: 'modal--pequeno', mostrarConfirmar: false,
      corpoHTML: `
        <table class="tabela">
          <tr><th>Status</th><td>${badgeStatus(a)}${a.venda_id && !semValorPorAula() ? ' <span class="badge badge--ok">faturado (venda #' + a.venda_id + ')</span>' : ''}${a.aula_recorrente_id ? ` <span class="badge badge--muted">🔁 ${rAula()} fixa</span>` : ''}</td></tr>
          ${a.suspensa ? `<tr><th>Motivo</th><td>${UI.escapar(a.motivo_suspensao || '—')}</td></tr>` : ''}
          <tr><th>Data</th><td>${diaLabel(a.data)}</td></tr>
          <tr><th>Horário</th><td>${UI.escapar(a.hora_inicio)}${a.hora_fim ? ' às ' + UI.escapar(a.hora_fim) : ''}</td></tr>
          ${ehProfessor() && a.remarcado_de_data ? `<tr><th>Remarcada</th><td>era ${diaLabel(a.remarcado_de_data)} às ${UI.escapar(a.remarcado_de_hora || '')}${a.remarcado_por ? ' · pedido ' + { aluno: 'do aluno', professor: 'do professor', feriado: 'por feriado' }[a.remarcado_por] : ''}</td></tr>` : ''}
          ${(ehInstituto() || ehCreche()) ? '' : `<tr><th>${rServico(true)}</th><td>${UI.escapar(a.servico_nome || '—')}</td></tr>`}
          <tr><th>${ehInstituto() ? 'Instrutor' : 'Profissional'}</th><td>${UI.escapar(a.profissional_nome || '—')}</td></tr>
          <tr><th>Telefone</th><td>${UI.escapar(tel || '—')}</td></tr>
          ${semValorPorAula() ? '' : `<tr><th>Valor</th><td><strong>${UI.moeda(a.valor)}</strong></td></tr>`}
          ${a.observacao ? `<tr><th>Obs.</th><td>${UI.escapar(a.observacao)}</td></tr>` : ''}
        </table>
        ${a.suspensa
          ? '<p class="dica mt-16">Este dia está suspenso — para reabrir, use a tela de Chamada.</p>'
          : (ehInstituto() || crecheComTurma())
            ? '<p class="dica mt-16">Para suspender esta aula, use a tela de Chamada.</p>'
            : `<div class="campo mt-16"><label>Mudar status</label>
              <select id="det-status" ${a.venda_id ? 'disabled' : ''}>
                ${Object.keys(STATUS).map((s) => `<option value="${s}" ${a.status === s ? 'selected' : ''}>${STATUS[s][0]}</option>`).join('')}
              </select></div>`}`,
      aoAbrir: (el) => {
        const foot = el.querySelector('.modal__foot');
        foot.innerHTML = `
          <div class="flex gap-12" style="flex-wrap:wrap;width:100%">
            ${!a.suspensa && !ehInstituto() && !crecheComTurma() ? `<button class="btn btn--secundario" id="d-status" ${a.venda_id ? 'disabled' : ''}>Atualizar status</button>` : ''}
            ${presencaRapida(a) ? '<button class="btn btn--secundario" id="d-presente">✓ Presente</button><button class="btn btn--secundario" id="d-faltou">✗ Faltou</button>' : ''}
            ${tel ? '<button class="btn btn--secundario" id="d-zap">💬 WhatsApp</button>' : ''}
            <div class="cresce"></div>
            ${ehProfessor() && AgendaSemana.remarcavel(a) ? '<button class="btn btn--secundario" id="d-remarcar">↻ Remarcar</button>' : ''}
            ${!a.venda_id ? '<button class="btn btn--secundario" id="d-editar">Editar</button>' : ''}
            ${!a.venda_id ? '<button class="btn btn--perigo" id="d-excluir">Excluir</button>' : ''}
            ${!a.venda_id && !semValorPorAula() ? '<button class="btn" id="d-faturar">💲 Faturar</button>' : ''}
          </div>`;
        const btnStatus = foot.querySelector('#d-status');
        if (btnStatus) btnStatus.addEventListener('click', async () => {
          try { await API.post(`/api/agenda/${a.id}/status`, { status: el.querySelector('#det-status').value }); UI.sucesso('Status atualizado.'); el.remove(); await atualizarVistaAtual(); }
          catch (e) { UI.erro(e.message); }
        });
        [['#d-presente', 'atendido', 'Presença registrada.'], ['#d-faltou', 'faltou', 'Falta registrada.']].forEach(([sel, status, msg]) => {
          const b = foot.querySelector(sel);
          if (b) b.addEventListener('click', async () => {
            try { await API.post(`/api/agenda/${a.id}/status`, { status }); UI.sucesso(msg); el.remove(); await atualizarVistaAtual(); }
            catch (e) { UI.erro(e.message); }
          });
        });
        const zap = foot.querySelector('#d-zap');
        if (zap) zap.addEventListener('click', () => enviarWhatsApp(a));
        const rem = foot.querySelector('#d-remarcar');
        if (rem) rem.addEventListener('click', () => { el.remove(); AgendaSemana.remarcar(a, { aoConcluir: atualizarVistaAtual }); });
        const ed = foot.querySelector('#d-editar');
        if (ed) ed.addEventListener('click', () => { el.remove(); abrirForm(a); });
        const ex = foot.querySelector('#d-excluir');
        if (ex) ex.addEventListener('click', async () => {
          const ok = await UI.confirmar(`Excluir est${ehProfessor() ? 'a' : 'e'} ${rAula()}?`, { titulo: 'Excluir', textoConfirmar: 'Excluir' });
          if (!ok) return;
          try { await API.del(`/api/agenda/${a.id}`); UI.sucesso(`${rAula(true)} excluíd${ehProfessor() ? 'a' : 'o'}.`); el.remove(); await atualizarVistaAtual(); }
          catch (e) { UI.erro(e.message); }
        });
        const fat = foot.querySelector('#d-faturar');
        if (fat) fat.addEventListener('click', () => faturar(a, el));
      },
    });
  }

  function faturar(a, detalheEl) {
    Modal.abrir({
      titulo: `Faturar ${rAula()}`, tamanho: 'modal--pequeno',
      corpoHTML: `
        <p class="dica" style="margin-top:0">Gera a venda d${rServico() === 'matéria' ? 'a' : 'o'} ${rServico()} de <strong>${UI.moeda(a.valor)}</strong> e marca ${ehProfessor() ? 'a aula' : 'o agendamento'} como atendid${ehProfessor() ? 'a' : 'o'}.</p>
        <div class="campo"><label>Forma de pagamento</label><select id="f-forma">${Object.entries(FORMAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="campo mt-16" id="f-venc-wrap" style="display:none"><label>Vencimento (a prazo)</label><input id="f-venc" type="date" /></div>`,
      textoConfirmar: 'Faturar',
      aoAbrir: (el) => {
        const forma = el.querySelector('#f-forma');
        forma.addEventListener('change', () => { el.querySelector('#f-venc-wrap').style.display = forma.value === 'prazo' ? '' : 'none'; });
      },
      aoConfirmar: async (el) => {
        try {
          await API.post(`/api/agenda/${a.id}/faturar`, { forma_pagamento: el.querySelector('#f-forma').value, vencimento_prazo: el.querySelector('#f-venc').value || null });
          UI.sucesso('Atendimento faturado!');
          if (detalheEl) detalheEl.remove();
          await atualizarVistaAtual();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  /** Atualiza a semana, a lista do dia ou o calendário do mês, conforme a visão atual. */
  async function atualizarVistaAtual() {
    if (vista === 'semana' && ehProfessor()) await renderSemana();
    else if (vista === 'mes') await carregarCalendario();
    else await listar();
  }

  // ------------------------------ WhatsApp ------------------------------
  function soDigitos(t) { return String(t || '').replace(/\D/g, ''); }

  function enviarWhatsApp(a) {
    const tel = soDigitos(a.cliente_telefone || a.telefone);
    if (!tel) { UI.erro(`Est${ehProfessor() ? 'a' : 'e'} ${rAula()} não tem telefone.`); return; }
    const nome = a.cliente_cadastro || a.cliente_nome || rCliente();
    const dataBR = new Date(a.data + 'T00:00:00').toLocaleDateString('pt-BR');
    const padrao = `Olá, ${nome}! Confirmando seu horário de ${a.servico_nome || rServico()} em ${dataBR} às ${a.hora_inicio}. Até lá!`;
    Modal.abrir({
      titulo: '💬 Enviar por WhatsApp', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Telefone</label><input id="wa-tel" value="${UI.escapar(tel)}" /></div>
        <div class="campo mt-16"><label>Mensagem</label><textarea id="wa-msg" rows="4">${UI.escapar(padrao)}</textarea></div>
        <div class="dica mt-16">Abre o WhatsApp (Web ou aplicativo) com a mensagem pronta para enviar.</div>`,
      textoConfirmar: 'Abrir WhatsApp',
      aoConfirmar: (el) => {
        const num = soDigitos(el.querySelector('#wa-tel').value);
        if (!num) { UI.erro('Informe o telefone.'); return false; }
        const completo = num.length <= 11 ? '55' + num : num; // DDI Brasil quando não informado
        const url = `https://wa.me/${completo}?text=${encodeURIComponent(el.querySelector('#wa-msg').value)}`;
        abrirExterno(url);
      },
    });
  }

  /** Abre um link externo (no Electron, cai para window.open que o main trata). */
  function abrirExterno(url) {
    try {
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (_) { window.open(url, '_blank'); }
  }

  // ------------------------------ Equipe ------------------------------
  async function gerenciarEquipe() {
    profissionais = await API.get('/api/agenda/profissionais?incluir_inativos=1').catch(() => []);
    const corpo = `
      <form id="pf-form" class="form-grid" style="margin-bottom:16px">
        <div class="campo"><label>Nome *</label><input name="nome" required /></div>
        <div class="campo"><label>Telefone</label><input name="telefone" /></div>
        <div class="campo"><label>Comissão (%)</label><input name="comissao_pct" type="number" step="0.01" min="0" value="0" /></div>
        <div class="campo"><label>Cor na agenda</label><input name="cor" type="color" value="#2563eb" style="height:40px" /></div>
        <div class="campo col-2"><button class="btn" type="submit">Adicionar profissional</button></div>
      </form>
      <div id="pf-lista"></div>`;
    Modal.abrir({
      titulo: '👥 Equipe / profissionais', tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        const render = () => {
          el.querySelector('#pf-lista').innerHTML = profissionais.length ? `<table class="tabela">
            <thead><tr><th>Profissional</th><th>Telefone</th><th>Comissão</th><th>Status</th><th></th></tr></thead>
            <tbody>${profissionais.map((p) => `<tr style="${p.ativo ? '' : 'opacity:.55'}">
              <td><span class="agenda-cor" style="background:${p.cor}"></span> ${UI.escapar(p.nome)}</td>
              <td>${UI.escapar(p.telefone || '—')}</td>
              <td>${p.comissao_pct ? p.comissao_pct + '%' : '—'}</td>
              <td>${p.ativo ? '<span class="badge badge--ok">Ativo</span>' : '<span class="badge badge--muted">Inativo</span>'}</td>
              <td style="text-align:right"><button class="btn btn--secundario" data-del="${p.id}">✕</button></td>
            </tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhum profissional cadastrado.</p>';
          el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
            const ok = await UI.confirmar('Excluir este profissional? Se já tiver agendamentos, será apenas inativado.', { titulo: 'Excluir', textoConfirmar: 'Excluir' });
            if (!ok) return;
            try { await API.del(`/api/agenda/profissionais/${b.dataset.del}`); profissionais = await API.get('/api/agenda/profissionais?incluir_inativos=1'); render(); UI.sucesso('Pronto.'); }
            catch (e) { UI.erro(e.message); }
          }));
        };
        render();
        el.querySelector('#pf-form').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const dados = Object.fromEntries(new FormData(ev.target).entries());
          try {
            await API.post('/api/agenda/profissionais', dados);
            ev.target.reset();
            profissionais = await API.get('/api/agenda/profissionais?incluir_inativos=1');
            render(); UI.sucesso('Profissional adicionado.');
          } catch (e) { UI.erro(e.message); }
        });
      },
    });
  }

  return { titulo: 'Agenda', render };
})();
