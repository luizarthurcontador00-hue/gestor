'use strict';

/**
 * Turmas do instituto: a oferta concreta de um curso, com dias, horarios,
 * instrutores e alunos matriculados.
 *
 * O detalhe que faz diferenca aqui: ao escolher instrumento e horarios, a
 * tela ja consulta o acervo e mostra quantas vagas cabem — em vez de deixar
 * o usuario descobrir o limite so na hora de salvar.
 */
window.PaginaTurmas = (function () {
  const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const STATUS = {
    planejada: ['Planejada', 'muted'], aberta: ['Aberta', 'ok'],
    encerrada: ['Encerrada', 'muted'], cancelada: ['Cancelada', 'muted'],
  };
  const STATUS_MATRICULA = {
    ativa: ['Ativa', 'ok'], espera: ['Fila de espera', 'alerta'],
    trancada: ['Trancada', 'muted'], concluida: ['Concluída', 'muted'], desistente: ['Desistente', 'muted'],
  };

  let cursos = [];
  let instrumentos = [];
  let equipe = [];
  // Creche nao usa o conceito de instrumento/acervo do instituto.
  const ehCreche = () => window.__ramoServico === 'creche';
  // Por regra, ao abrir o modulo so mostra turma em andamento ou planejada —
  // encerrada/cancelada so aparece quando o usuario pede explicitamente
  // marcando a caixinha (senao a lista some do dia a dia).
  const STATUS_PADRAO = ['aberta', 'planejada'];
  let filtro = { curso_id: '', status: STATUS_PADRAO.slice() };

  async function render(container) {
    // O filtro nao pode sobreviver de uma visita a outra: sem isso, o select
    // reaparece em "Todos" mas a lista continua filtrada pelo valor antigo
    // (guardado num objeto de escopo do modulo) — parece a tela "travada",
    // trazendo menos turma do que deveria.
    filtro = { curso_id: '', status: STATUS_PADRAO.slice() };
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="campo"><label>Curso</label><select id="tu-curso"><option value="">Todos</option></select></div>
        <div class="campo"><label>Situação</label>
          <div class="flex gap-12" style="align-items:center;height:38px">
            ${Object.entries(STATUS).map(([v, [t]]) => `
              <label class="flex gap-12" style="align-items:center;gap:4px;cursor:pointer;white-space:nowrap">
                <input type="checkbox" data-status-check value="${v}" ${filtro.status.includes(v) ? 'checked' : ''} />
                <span class="dica">${t}</span>
              </label>`).join('')}
          </div>
        </div>
        <div class="cresce"></div>
        <button class="btn btn--secundario" id="tu-imprimir">🖨️ Imprimir turmas</button>
        <button class="btn" id="tu-nova">+ Nova turma</button>
      </div>
      <div class="card"><div id="tu-lista">Carregando…</div></div>`;

    [cursos, instrumentos, equipe] = await Promise.all([
      API.get('/api/cursos').catch(() => []),
      ehCreche() ? Promise.resolve([]) : API.get('/api/instrumentos').catch(() => []),
      API.get('/api/agenda/profissionais').catch(() => []),
    ]);

    const selCurso = container.querySelector('#tu-curso');
    cursos.forEach((c) => selCurso.insertAdjacentHTML('beforeend', `<option value="${c.id}">${UI.escapar(c.nome)}</option>`));

    selCurso.addEventListener('change', (e) => { filtro.curso_id = e.target.value; listar(); });
    container.querySelectorAll('[data-status-check]').forEach((cb) => cb.addEventListener('change', () => {
      filtro.status = Array.from(container.querySelectorAll('[data-status-check]:checked')).map((c) => c.value);
      listar();
    }));
    container.querySelector('#tu-nova').addEventListener('click', () => {
      if (!cursos.length) { UI.erro('Cadastre ao menos um curso antes de criar turmas.'); return; }
      formulario(null);
    });
    container.querySelector('#tu-imprimir').addEventListener('click', () => Documentos.relatorioDeTurmas(filtro));

    listar();
  }

  function resumoHorarios(horarios) {
    if (!horarios || !horarios.length) return '—';
    return horarios.map((h) => `${DIAS_CURTO[h.dia_semana]} ${h.hora_inicio}`).join(' · ');
  }

  async function listar() {
    const alvo = document.getElementById('tu-lista');
    if (!alvo) return;
    let turmas = [];
    try {
      const q = new URLSearchParams();
      if (filtro.curso_id) q.set('curso_id', filtro.curso_id);
      if (filtro.status.length) q.set('status', filtro.status.join(','));
      turmas = await API.get('/api/turmas?' + q.toString());
    } catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    if (!turmas.length) {
      alvo.innerHTML = `<div class="vazio"><h3>Nenhuma turma</h3>
        <p class="dica">Crie uma turma para começar a matricular alunos e fazer chamada.</p></div>`;
      return;
    }

    alvo.innerHTML = `
      <div class="rolagem"><table class="tabela">
        <thead><tr>
          <th>Turma</th><th>Dias</th><th>Ocupação</th><th>Instrumento</th><th>Instrutor</th><th>Situação</th><th></th>
        </tr></thead>
        <tbody>
          ${turmas.map((t) => {
            const [rot, cor] = STATUS[t.status] || [t.status, 'muted'];
            const lotada = t.vagas_ocupadas >= t.vagas_total && t.vagas_total > 0;
            return `
            <tr>
              <td>
                <strong>${UI.escapar(t.nome)}</strong>
                <div class="dica">${UI.escapar(t.curso_nome)}${t.sala ? ' · Sala ' + UI.escapar(t.sala) : ''}</div>
              </td>
              <td class="dica">${UI.escapar(resumoHorarios(t.horarios))}</td>
              <td>
                <span class="badge ${lotada ? 'badge--alerta' : 'badge--ok'}">${t.vagas_ocupadas}/${t.vagas_total}</span>
                ${t.na_espera ? `<div class="dica">${t.na_espera} na espera</div>` : ''}
              </td>
              <td class="dica">${UI.escapar(t.instrumentos.map((i) => i.nome).join(', ') || '—')}</td>
              <td class="dica">${t.instrutores.length ? UI.escapar(t.instrutores.map((i) => i.nome).join(', ')) : '<span class="badge badge--erro">sem instrutor</span>'}</td>
              <td><span class="badge badge--${cor}">${rot}</span></td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn--secundario" data-ver="${t.id}">Abrir</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>`;

    alvo.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => abrirTurma(Number(b.dataset.ver))));
  }

  // ---------------------------- Detalhe da turma ----------------------------

  async function abrirTurma(id) {
    let t;
    try { t = await API.get(`/api/turmas/${id}`); } catch (e) { UI.erro(e.message); return; }
    const [rot, cor] = STATUS[t.status] || [t.status, 'muted'];

    Modal.abrir({
      titulo: t.nome,
      tamanho: 'modal--grande',
      mostrarConfirmar: false,
      corpoHTML: `
        <p class="dica" style="margin-top:0">
          ${UI.escapar(t.curso_nome)} · <span class="badge badge--${cor}">${rot}</span>
          ${t.sala ? ' · Sala ' + UI.escapar(t.sala) : ''}
          ${t.instrumentos.length ? ' · Usa ' + UI.escapar(t.instrumentos.map((i) => i.nome).join(', ')) : ''}
        </p>
        <p class="dica">
          ${UI.escapar(resumoHorarios(t.horarios))} ·
          Período: ${UI.dataHora(t.periodo_inicio)}${t.periodo_fim ? ' até ' + UI.dataHora(t.periodo_fim) : ''}
          ${t.periodo_rotulo ? ` · <span class="badge badge--muted">${UI.escapar(t.periodo_rotulo)}</span>` : ''}
        </p>
        <div id="tu-progresso"></div>
        <div id="tu-historico"></div>

        <div class="flex gap-12 mt-16" style="flex-wrap:wrap;align-items:center">
          <span class="badge ${t.vagas_ocupadas >= t.vagas_total ? 'badge--alerta' : 'badge--ok'}">${t.vagas_ocupadas} de ${t.vagas_total} vagas</span>
          ${t.na_espera ? `<span class="badge badge--alerta">${t.na_espera} na fila de espera</span>` : ''}
          ${t.vagas_total > t.vagas
            ? `<span class="dica">(${t.vagas} configurada${t.vagas === 1 ? '' : 's'} + ${t.vagas_total - t.vagas} aluno${t.vagas_total - t.vagas === 1 ? '' : 's'} com instrumento próprio, que não ocupa${t.vagas_total - t.vagas === 1 ? '' : 'm'} vaga do acervo)</span>`
            : ''}
        </div>

        <h4 class="mt-16">Instrutores</h4>
        ${t.instrutores.length
          ? `<p class="dica">${t.instrutores.map((i) => `${UI.escapar(i.nome)} (${UI.escapar(i.papel)})`).join(' · ')}</p>`
          : '<p class="dica">Nenhum instrutor escalado ainda.</p>'}

        <h4 class="mt-16">Alunos</h4>
        <div id="tu-alunos"></div>

        <div class="flex gap-12 mt-16" style="flex-wrap:wrap">
          ${t.status === 'encerrada' ? '' : '<button class="btn" type="button" id="tu-matricular">+ Matricular aluno</button>'}
          <button class="btn btn--secundario" type="button" id="tu-frequencia">📊 Frequência</button>
          <button class="btn btn--secundario" type="button" id="tu-folha">🖨️ Folha de chamada</button>
          <button class="btn btn--secundario" type="button" id="tu-editar">Editar turma</button>
          <div class="cresce"></div>
          ${t.status === 'encerrada'
            ? ''
            : `<button class="btn btn--secundario" type="button" id="tu-encerrar">Encerrar período</button>
               <button class="btn" type="button" id="tu-renovar">🔁 Renovar para o próximo período</button>`}
        </div>

        <div class="flex gap-12 mt-16" style="flex-wrap:wrap;border-top:1px solid var(--borda);padding-top:14px">
          <span class="dica" style="align-self:center">Documentos em lote (um PDF só, todos os alunos):</span>
          ${t.matriculados
            ? `<button class="btn btn--secundario" type="button" id="tu-declaracoes-lote">📄 Declarações</button>
               <button class="btn btn--secundario" type="button" id="tu-fichas-lote">🗂️ Fichas</button>`
            : ''}
          ${t.matriculas.some((m) => m.status === 'concluida')
            ? '<button class="btn btn--secundario" type="button" id="tu-certificados-lote">🎓 Certificados dos concluintes</button>'
            : ''}
        </div>`,
      aoAbrir: (el) => {
        desenharAlunos(el, t);
        desenharHistorico(el, t.id);
        desenharProgresso(el, t.id);
        const bm = el.querySelector('#tu-matricular');
        if (bm) bm.addEventListener('click', () => matricular(t, el));
        el.querySelector('#tu-frequencia').addEventListener('click', () => verFrequencia(t.id));
        el.querySelector('#tu-folha').addEventListener('click', () => Documentos.folhaDeChamada(t.id, new Date().toISOString().slice(0, 7)));
        el.querySelector('#tu-editar').addEventListener('click', () => {
          el.querySelector('[data-fechar]').click();
          formulario(t);
        });
        const be = el.querySelector('#tu-encerrar');
        if (be) be.addEventListener('click', () => encerrarTurma(t, el));
        const br = el.querySelector('#tu-renovar');
        if (br) br.addEventListener('click', () => renovarTurma(t, el));
        const bdl = el.querySelector('#tu-declaracoes-lote');
        if (bdl) bdl.addEventListener('click', () => Documentos.declaracoesMatriculaLote(t.id));
        const bfl = el.querySelector('#tu-fichas-lote');
        if (bfl) bfl.addEventListener('click', () => Documentos.fichasDoAlunoLote(t.id));
        const bcl = el.querySelector('#tu-certificados-lote');
        if (bcl) bcl.addEventListener('click', () => Documentos.certificadosLote(t.id));
      },
    });
  }

  /** As gerações da turma: 2026/1 → 2026/2 → … */
  async function desenharHistorico(el, turmaId) {
    const alvo = el.querySelector('#tu-historico');
    if (!alvo) return;
    let hist = [];
    try { hist = await API.get(`/api/turmas/${turmaId}/historico`); } catch (_) { return; }
    if (hist.length < 2) return;
    alvo.innerHTML = `<p class="dica">🔁 Períodos desta turma:
      ${hist.map((h) => {
        const rotulo = h.periodo_rotulo || UI.dataHora(h.periodo_inicio);
        return h.atual
          ? `<strong>${UI.escapar(rotulo)}</strong>`
          : `<a href="#" data-hist="${h.id}">${UI.escapar(rotulo)}</a>`;
      }).join(' → ')}</p>`;
    alvo.querySelectorAll('[data-hist]').forEach((a) => a.addEventListener('click', (ev) => {
      ev.preventDefault();
      el.querySelector('[data-fechar]').click();
      abrirTurma(Number(a.dataset.hist));
    }));
  }

  /** % de conclusão da turma frente à carga horária do curso (quando cadastrada). */
  async function desenharProgresso(el, turmaId) {
    const alvo = el.querySelector('#tu-progresso');
    if (!alvo) return;
    let p;
    try { p = await API.get(`/api/turmas/${turmaId}/progresso`); } catch (_) { return; }
    if (p.carga_horaria == null) return;
    const cor = p.percentual >= 100 ? 'var(--sucesso)' : 'var(--primaria)';
    alvo.innerHTML = `
      <div class="flex flex--between" style="align-items:center;font-size:12px;color:var(--texto-muted,#666)">
        <span>Progresso do curso (${p.horas_dadas}h de ${p.carga_horaria}h)${p.horas_abonadas ? ` <span class="dica">— inclui ${p.horas_abonadas}h abonadas de antes do cadastro</span>` : ''}</span>
        <strong>${p.percentual}%</strong>
      </div>
      <div style="background:var(--borda,#e5e7eb);border-radius:6px;height:8px;overflow:hidden;margin-top:4px">
        <div style="width:${p.percentual}%;height:100%;background:${cor}"></div>
      </div>`;
  }

  function encerrarTurma(turma, elPai) {
    const hoje = new Date().toISOString().slice(0, 10);
    const ativos = turma.matriculas.filter((m) => m.status === 'ativa').length;
    Modal.abrir({
      titulo: `Encerrar — ${turma.nome}`, tamanho: 'modal--pequeno', textoConfirmar: 'Encerrar turma',
      corpoHTML: `
        <p class="dica" style="margin-top:0">Encerrar fecha o período da turma: ${ativos} matrícula(s) ativa(s) passam a
        <strong>concluída</strong> (liberando o certificado), a fila de espera é dispensada e as aulas futuras que ainda
        não tiveram chamada saem do calendário. O histórico e as chamadas já registradas ficam.</p>
        <div class="campo"><label>Data de encerramento *</label><input type="date" id="en-data" value="${hoje}" /></div>
        <div class="dica mt-16">Se a ideia é continuar com a mesma turma no próximo semestre, use
        <strong>Renovar</strong> em vez disto — ele encerra e já abre a seguinte.</div>`,
      aoConfirmar: async (el) => {
        try {
          await API.post(`/api/turmas/${turma.id}/encerrar`, { data_fim: el.querySelector('#en-data').value });
          UI.sucesso('Turma encerrada.');
          if (elPai) elPai.querySelector('[data-fechar]').click();
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  function renovarTurma(turma, elPai) {
    const ativos = turma.matriculas.filter((m) => m.status === 'ativa');
    const hoje = new Date().toISOString().slice(0, 10);
    const ano = new Date().getFullYear();
    const semestre = new Date().getMonth() < 6 ? 2 : 1;
    const sugestaoRotulo = semestre === 1 ? `${ano + 1}/1` : `${ano}/2`;

    Modal.abrir({
      titulo: `Renovar — ${turma.nome}`, tamanho: 'modal--grande', textoConfirmar: 'Renovar turma',
      corpoHTML: `
        <p class="dica" style="margin-top:0">Cria a turma do próximo período com o mesmo curso, horários, instrutores e
        acervo, levando junto os alunos que você marcar. A turma atual é encerrada — assim cada semestre tem a sua
        frequência e o seu certificado separados.</p>
        <div class="form-grid">
          <div class="campo"><label>Início do novo período *</label><input type="date" id="rn-inicio" value="${hoje}" /></div>
          <div class="campo"><label>Fim <span class="dica">(opcional)</span></label><input type="date" id="rn-fim" /></div>
          <div class="campo"><label>Identificação do período</label>
            <input id="rn-rotulo" value="${sugestaoRotulo}" placeholder="Ex.: 2026/2" /></div>
          <div class="campo"><label>Vagas</label><input type="number" id="rn-vagas" min="0" value="${turma.vagas}" /></div>
        </div>
        <div class="campo mt-16"><label>Nome da turma</label><input id="rn-nome" value="${UI.escapar(turma.nome)}" /></div>
        <div class="campo mt-16" style="border-top:1px solid var(--borda);padding-top:16px">
          <label>Quem continua no próximo período?</label>
          ${ativos.length ? `
            <div class="flex gap-12 mb-16"><button type="button" class="btn btn--secundario" id="rn-todos">Marcar todos</button>
              <button type="button" class="btn btn--secundario" id="rn-nenhum">Desmarcar todos</button></div>
            <div id="rn-alunos">${ativos.map((m) => `
              <label class="flex gap-12" style="align-items:center;padding:5px 0">
                <input type="checkbox" class="rn-aluno" value="${m.aluno_id}" checked />
                <span>${UI.escapar(m.aluno_nome)}</span>
              </label>`).join('')}</div>`
            : '<p class="dica">Não há aluno ativo. A turma nova nasce vazia.</p>'}
        </div>`,
      aoConfirmar: async (el) => {
        const inicio = el.querySelector('#rn-inicio').value;
        if (!inicio) { UI.erro('Informe o início do novo período.'); return false; }
        const escolhidos = Array.from(el.querySelectorAll('.rn-aluno:checked')).map((c) => Number(c.value));
        try {
          const r = await API.post(`/api/turmas/${turma.id}/renovar`, {
            periodo_inicio: inicio,
            periodo_fim: el.querySelector('#rn-fim').value || null,
            periodo_rotulo: el.querySelector('#rn-rotulo').value,
            nome: el.querySelector('#rn-nome').value,
            vagas: el.querySelector('#rn-vagas').value,
            alunos: escolhidos,
          });
          UI.sucesso(`Turma renovada com ${r.alunos_levados} aluno(s).`);
          if (r.nao_couberam.length) {
            UI.erro(`${r.nao_couberam.length} aluno(s) não entraram: ${r.nao_couberam.map((n) => `${n.nome} (${n.motivo})`).join(' · ')}`);
          }
          if (elPai) elPai.querySelector('[data-fechar]').click();
          await listar();
          abrirTurma(r.turma.id);
        } catch (e) { UI.erro(e.message); return false; }
      },
      aoAbrir: (el) => {
        const marcar = (v) => el.querySelectorAll('.rn-aluno').forEach((c) => { c.checked = v; });
        const bt = el.querySelector('#rn-todos');
        if (bt) bt.addEventListener('click', () => marcar(true));
        const bn = el.querySelector('#rn-nenhum');
        if (bn) bn.addEventListener('click', () => marcar(false));
      },
    });
  }

  function desenharAlunos(el, turma) {
    const alvo = el.querySelector('#tu-alunos');
    if (!turma.matriculas.length) {
      alvo.innerHTML = '<p class="dica">Nenhum aluno matriculado.</p>';
      return;
    }
    const mostrarInstrumento = turma.instrumentos.length > 1;
    alvo.innerHTML = `
      <div class="rolagem"><table class="tabela">
        <thead><tr><th>Aluno</th><th>Situação</th>${mostrarInstrumento ? '<th>Instrumento</th>' : ''}<th>Contato</th><th></th></tr></thead>
        <tbody>
          ${turma.matriculas.map((m) => {
            const [rot, cor] = STATUS_MATRICULA[m.status] || [m.status, 'muted'];
            const menor = ehMenor(m.data_nascimento);
            return `
            <tr>
              <td>
                ${UI.escapar(m.aluno_nome)}
                ${menor ? ' <span class="badge badge--muted" title="Menor de idade">menor</span>' : ''}
                ${menor && m.responsavel_nome ? `<div class="dica">Resp.: ${UI.escapar(m.responsavel_nome)}</div>` : ''}
              </td>
              <td><span class="badge badge--${cor}">${rot}</span></td>
              ${mostrarInstrumento ? `<td class="dica">${UI.escapar(m.instrumento_nome || '—')}</td>` : ''}
              <td class="dica">${UI.escapar(m.responsavel_telefone || m.telefone || '—')}</td>
              <td style="text-align:right;white-space:nowrap">
                <select data-status="${m.id}" style="max-width:150px">
                  ${Object.entries(STATUS_MATRICULA).map(([v, [rotulo]]) => `<option value="${v}" ${m.status === v ? 'selected' : ''}>${rotulo}</option>`).join('')}
                </select>
                <button class="btn btn--perigo" type="button" data-excluir-matricula="${m.id}" title="Excluir matrícula">🗑️</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>`;

    alvo.querySelectorAll('[data-status]').forEach((s) => s.addEventListener('change', async () => {
      try {
        const r = await API.put(`/api/turmas/matriculas/${s.dataset.status}`, { status: s.value });
        UI.sucesso(r.promovido
          ? `Situação atualizada. ${r.promovido.aluno_nome} saiu da fila de espera e assumiu a vaga.`
          : 'Situação atualizada.');
        desenharAlunos(el, r.turma);
        listar();
      } catch (e) { UI.erro(e.message); }
    }));

    alvo.querySelectorAll('[data-excluir-matricula]').forEach((b) => b.addEventListener('click', async () => {
      const m = turma.matriculas.find((x) => x.id === Number(b.dataset.excluirMatricula));
      const ok = await UI.confirmar(
        `Excluir a matrícula de "${m ? m.aluno_nome : ''}" nesta turma? Isso remove o vínculo por completo — use "Desistente" na situação se quiser manter o histórico.`,
        { titulo: 'Excluir matrícula', textoConfirmar: 'Excluir' }
      );
      if (!ok) return;
      try {
        const r = await API.del(`/api/turmas/matriculas/${b.dataset.excluirMatricula}`);
        UI.sucesso(r.promovido
          ? `Matrícula excluída. ${r.promovido.aluno_nome} saiu da fila de espera e assumiu a vaga.`
          : 'Matrícula excluída.');
        desenharAlunos(el, r.turma);
        listar();
      } catch (e) { UI.erro(e.message); }
    }));
  }

  function ehMenor(dataNascimento) {
    if (!dataNascimento) return false;
    const nasc = new Date(dataNascimento + 'T12:00:00');
    if (Number.isNaN(nasc.getTime())) return false;
    const idade = (Date.now() - nasc.getTime()) / (365.25 * 24 * 3600 * 1000);
    return idade < 18;
  }

  function matricular(turma, elPai) {
    let alunos = [];
    let instrumentosDoAlunoSelecionado = new Set();

    function atualizarInfoInstrumento(el) {
      const info = el.querySelector('#ma-instrumento-info');
      if (!info || !turma.instrumentos.length) return;
      const sel = el.querySelector('#ma-instrumento');
      const instId = sel ? Number(sel.value) : turma.instrumentos[0].id;
      const inst = turma.instrumentos.find((i) => i.id === instId);
      if (!inst) { info.textContent = ''; return; }
      const escolhido = el.querySelector('input[name="ma-aluno"]:checked');
      if (!escolhido) { info.textContent = ''; return; }
      const tem = instrumentosDoAlunoSelecionado.has(instId);
      info.innerHTML = tem
        ? `✅ Este aluno já tem <strong>${UI.escapar(inst.nome)}</strong> (próprio ou emprestado pelo instituto) — não vai depender do acervo.`
        : `⚠️ Este aluno não tem <strong>${UI.escapar(inst.nome)}</strong> registrado — vai usar um do acervo, se houver disponível.`;
      info.style.color = tem ? 'var(--sucesso)' : 'var(--perigo)';
    }

    async function carregarInstrumentosDoAluno(el, alunoId) {
      if (!turma.instrumentos.length) return;
      instrumentosDoAlunoSelecionado = new Set();
      if (alunoId) {
        try {
          const [proprios, emprestimos] = await Promise.all([
            API.get(`/api/instrumentos/proprios/${alunoId}`),
            API.get(`/api/instrumentos/emprestimos?abertos=1&aluno_id=${alunoId}`),
          ]);
          proprios.forEach((p) => instrumentosDoAlunoSelecionado.add(Number(p.instrumento_id)));
          emprestimos.forEach((e) => instrumentosDoAlunoSelecionado.add(Number(e.instrumento_id)));
        } catch (_) { /* sem info do acervo pro aluno, so nao mostra o aviso */ }
      }
      atualizarInfoInstrumento(el);
    }

    Modal.abrir({
      titulo: 'Matricular aluno',
      textoConfirmar: 'Matricular',
      corpoHTML: `
        <div class="campo"><label>Buscar aluno</label>
          <input type="search" id="ma-busca" placeholder="Digite o nome do aluno" /></div>
        <div id="ma-resultados" class="mt-16"><p class="dica">Digite para buscar.</p></div>
        ${turma.instrumentos.length > 1 ? `
        <div class="campo mt-16"><label>Qual instrumento este aluno vai usar? *</label>
          <select id="ma-instrumento">
            ${turma.instrumentos.map((i) => `<option value="${i.id}">${UI.escapar(i.nome)}</option>`).join('')}
          </select>
          <span class="dica">A turma tem mais de um instrumento cadastrado — cada aluno usa um deles.</span></div>
        ` : ''}
        ${turma.instrumentos.length ? '<div id="ma-instrumento-info" class="dica mt-16"></div>' : ''}
        ${turma.vagas_ocupadas >= turma.vagas_total
          ? '<p class="dica mt-16">⚠️ A turma está lotada. Quem for matriculado agora entra na <strong>fila de espera</strong> e assume assim que abrir vaga — a não ser que traga o próprio instrumento.</p>'
          : ''}`,
      aoAbrir: (el) => {
        const busca = el.querySelector('#ma-busca');
        let timer = null;
        busca.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(async () => {
            const termo = busca.value.trim();
            const alvo = el.querySelector('#ma-resultados');
            if (!termo) { alvo.innerHTML = '<p class="dica">Digite para buscar.</p>'; return; }
            try {
              alunos = await API.get('/api/clientes?busca=' + encodeURIComponent(termo));
            } catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }
            if (!alunos.length) { alvo.innerHTML = '<p class="dica">Nenhum aluno encontrado.</p>'; return; }
            alvo.innerHTML = alunos.slice(0, 20).map((a) => `
              <label class="flex gap-12" style="align-items:center;padding:6px 0;cursor:pointer">
                <input type="radio" name="ma-aluno" value="${a.id}" />
                <span>${UI.escapar(a.nome)}${a.telefone ? ` <span class="dica">${UI.escapar(a.telefone)}</span>` : ''}</span>
              </label>`).join('');
            alvo.querySelectorAll('input[name="ma-aluno"]').forEach((r) => r.addEventListener('change', () => {
              carregarInstrumentosDoAluno(el, r.value);
            }));
          }, 300);
        });
        const instrumentoSel = el.querySelector('#ma-instrumento');
        if (instrumentoSel) instrumentoSel.addEventListener('change', () => atualizarInfoInstrumento(el));
      },
      aoConfirmar: async (el) => {
        const escolhido = el.querySelector('input[name="ma-aluno"]:checked');
        if (!escolhido) { UI.erro('Selecione um aluno.'); return false; }
        const instrumentoSel = el.querySelector('#ma-instrumento');
        try {
          const r = await API.post(`/api/turmas/${turma.id}/matriculas`, {
            aluno_id: escolhido.value,
            instrumento_id: instrumentoSel ? instrumentoSel.value : undefined,
          });
          UI.sucesso(r.entrou_na_espera
            ? 'Turma lotada: o aluno entrou na fila de espera.'
            : 'Aluno matriculado.');
          desenharAlunos(elPai, r.turma);
          listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function verFrequencia(turmaId) {
    let dados;
    try { dados = await API.get(`/api/turmas/${turmaId}/frequencia`); } catch (e) { UI.erro(e.message); return; }
    Modal.abrir({
      titulo: 'Frequência — ' + dados.turma.nome,
      tamanho: 'modal--grande',
      mostrarConfirmar: false,
      corpoHTML: !dados.alunos.length
        ? '<p class="dica">Nenhum aluno com chamada registrada ainda.</p>'
        : `<div class="rolagem"><table class="tabela">
            <thead><tr><th>Aluno</th><th>Presenças</th><th>Faltas</th><th>Justificadas</th><th>Frequência</th><th>Faltas seguidas</th></tr></thead>
            <tbody>
              ${dados.alunos.map((a) => `
                <tr>
                  <td>${UI.escapar(a.aluno_nome)}</td>
                  <td>${a.presencas || 0}</td>
                  <td>${a.faltas || 0}</td>
                  <td>${a.justificadas || 0}</td>
                  <td>${a.percentual == null ? '—' : `<span class="badge ${a.percentual >= 75 ? 'badge--ok' : 'badge--alerta'}">${a.percentual}%</span>`}</td>
                  <td>${a.faltas_seguidas >= 3 ? `<span class="badge badge--erro">${a.faltas_seguidas}</span>` : (a.faltas_seguidas || 0)}</td>
                </tr>`).join('')}
            </tbody>
          </table></div>`,
    });
  }

  // ------------------------------ Formulário ------------------------------

  function formulario(turma) {
    const ed = !!turma;
    const horarios = ed ? turma.horarios.map((h) => ({ ...h })) : [{ dia_semana: 2, hora_inicio: '19:00', hora_fim: '20:00' }];
    const instrutores = ed ? turma.instrutores.map((i) => ({ profissional_id: i.profissional_id, papel: i.papel })) : [];

    Modal.abrir({
      titulo: ed ? 'Editar turma' : 'Nova turma',
      tamanho: 'modal--grande',
      textoConfirmar: 'Salvar',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo"><label>Curso *</label>
            <select id="tf-curso">
              ${cursos.map((c) => `<option value="${c.id}" ${ed && turma.curso_id === c.id ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('')}
            </select></div>
          <div class="campo"><label>Nome da turma *</label>
            <input id="tf-nome" value="${ed ? UI.escapar(turma.nome) : ''}" placeholder="Ex.: Violão Iniciante — Turma A" /></div>

          ${ehCreche() ? '' : `
          <div class="campo col-2"><label>Instrumentos usados <span class="dica">(pode marcar mais de um — ex.: turma de banda)</span></label>
            <div id="tf-instrumentos" style="display:flex;flex-wrap:wrap;gap:12px">
              ${instrumentos.map((i) => `<label class="flex gap-12" style="align-items:center;cursor:pointer">
                <input type="checkbox" value="${i.id}" ${ed && turma.instrumentos.some((ti) => ti.id === i.id) ? 'checked' : ''} />
                <span>${UI.escapar(i.nome)} (${i.quantidade_total})</span>
              </label>`).join('') || '<span class="dica">Nenhum instrumento cadastrado no acervo.</span>'}
            </div>
            <span class="dica">Informática e reforço normalmente ficam sem nenhum marcado.</span></div>
          <div class="campo"><label>Instrumentos por aluno</label>
            <input id="tf-por-aluno" type="number" min="1" step="1" value="${ed ? turma.instrumentos_por_aluno : 1}" /></div>
          `}
          <div class="campo"><label>Vagas *</label>
            <input id="tf-vagas" type="number" min="0" step="1" value="${ed ? turma.vagas : ''}" />
            <span class="dica" id="tf-aviso-vagas"></span></div>

          <div class="campo"><label>Sala / local</label>
            <input id="tf-sala" value="${ed ? UI.escapar(turma.sala || '') : ''}" /></div>
          <div class="campo"><label>Início do período *</label>
            <input id="tf-inicio" type="date" value="${ed ? UI.escapar(turma.periodo_inicio) : ''}" /></div>
          <div class="campo"><label>Fim do período</label>
            <input id="tf-fim" type="date" value="${ed ? UI.escapar(turma.periodo_fim || '') : ''}" />
            <span class="dica">Deixe vazio: se o curso tiver carga horária cadastrada, o sistema calcula sozinho a partir dos horários da turma.</span></div>

          <div class="campo"><label>Situação</label>
            <select id="tf-status">
              ${Object.entries(STATUS).filter(([v]) => ed || v === 'planejada' || v === 'aberta').map(([v, [t]]) => `<option value="${v}" ${(ed ? turma.status : 'aberta') === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            <span class="dica">${ed ? '' : 'Planejada: já organiza tudo (horários, instrutor, vagas), mas ainda não é a turma corrente do dia a dia.'}</span></div>

          <div class="campo col-2" style="border-top:1px solid var(--borda);padding-top:14px">
            <label>Dias e horários *</label>
            <div id="tf-horarios"></div>
            <button class="btn btn--secundario mt-16" type="button" id="tf-add-horario">+ Adicionar dia</button>
          </div>

          <div class="campo col-2" style="border-top:1px solid var(--borda);padding-top:14px">
            <label>Instrutores</label>
            <div id="tf-instrutores"></div>
            <button class="btn btn--secundario mt-16" type="button" id="tf-add-instrutor">+ Adicionar instrutor</button>
          </div>

          ${ed ? `
          <div class="campo" style="border-top:1px solid var(--borda);padding-top:14px">
            <label>Horas abonadas</label>
            <input id="tf-horas-abonadas" type="number" min="0" step="0.5" value="${turma.horas_abonadas || 0}" />
            <span class="dica">Turma que já tinha aula antes de entrar no sistema: informe aqui quantas horas já foram dadas antes do cadastro. Some direto no progresso do curso, sem precisar lançar chamada retroativa.</span></div>
          ` : ''}

          <div class="campo col-2"><label>Observação</label>
            <textarea id="tf-obs" rows="2">${ed ? UI.escapar(turma.observacao || '') : ''}</textarea></div>
        </div>`,
      aoAbrir: (el) => {
        CadastroRapido.ligarAtalho(el.querySelector('#tf-curso'), { rotulo: 'curso', hash: '#/cursos', pagina: 'Cursos' });
        function desenharHorarios() {
          const alvo = el.querySelector('#tf-horarios');
          alvo.innerHTML = horarios.map((h, i) => `
            <div class="flex gap-12 mt-16" style="align-items:center;flex-wrap:wrap">
              <select data-dia="${i}" style="max-width:150px">
                ${DIAS.map((d, n) => `<option value="${n}" ${Number(h.dia_semana) === n ? 'selected' : ''}>${d}</option>`).join('')}
              </select>
              <input type="time" data-ini="${i}" value="${UI.escapar(h.hora_inicio || '')}" style="max-width:120px" />
              <span class="dica">às</span>
              <input type="time" data-fim="${i}" value="${UI.escapar(h.hora_fim || '')}" style="max-width:120px" />
              ${horarios.length > 1 ? `<button class="btn btn--perigo" type="button" data-rm-h="${i}">Remover</button>` : ''}
            </div>`).join('');

          alvo.querySelectorAll('[data-dia]').forEach((s) => s.addEventListener('change', () => { horarios[Number(s.dataset.dia)].dia_semana = Number(s.value); conferirVagas(true); }));
          alvo.querySelectorAll('[data-ini]').forEach((s) => s.addEventListener('change', () => { horarios[Number(s.dataset.ini)].hora_inicio = s.value; conferirVagas(true); }));
          alvo.querySelectorAll('[data-fim]').forEach((s) => s.addEventListener('change', () => { horarios[Number(s.dataset.fim)].hora_fim = s.value; conferirVagas(true); }));
          alvo.querySelectorAll('[data-rm-h]').forEach((b) => b.addEventListener('click', () => { horarios.splice(Number(b.dataset.rmH), 1); desenharHorarios(); conferirVagas(true); }));
        }

        function desenharInstrutores() {
          const alvo = el.querySelector('#tf-instrutores');
          if (!instrutores.length) { alvo.innerHTML = '<p class="dica">Nenhum instrutor escalado.</p>'; return; }
          alvo.innerHTML = instrutores.map((ins, i) => `
            <div class="flex gap-12 mt-16" style="align-items:center;flex-wrap:wrap">
              <select data-prof="${i}" style="max-width:220px">
                ${equipe.map((p) => `<option value="${p.id}" ${Number(ins.profissional_id) === p.id ? 'selected' : ''}>${UI.escapar(p.nome)}${p.tipo === 'voluntario' ? ' (voluntário)' : ''}</option>`).join('')}
              </select>
              <select data-papel="${i}" style="max-width:150px">
                ${['titular', 'auxiliar', 'suplente'].map((pp) => `<option value="${pp}" ${ins.papel === pp ? 'selected' : ''}>${pp}</option>`).join('')}
              </select>
              <button class="btn btn--perigo" type="button" data-rm-i="${i}">Remover</button>
            </div>`).join('');

          alvo.querySelectorAll('[data-prof]').forEach((s) => s.addEventListener('change', () => { instrutores[Number(s.dataset.prof)].profissional_id = Number(s.value); }));
          alvo.querySelectorAll('[data-papel]').forEach((s) => s.addEventListener('change', () => { instrutores[Number(s.dataset.papel)].papel = s.value; }));
          alvo.querySelectorAll('[data-rm-i]').forEach((b) => b.addEventListener('click', () => { instrutores.splice(Number(b.dataset.rmI), 1); desenharInstrutores(); }));
        }

        function instrumentosMarcados() {
          return Array.from(el.querySelectorAll('#tf-instrumentos input:checked')).map((c) => c.value);
        }

        /**
         * Consulta o acervo (de cada instrumento marcado) e avisa quantas vagas
         * cabem. Quando `atualizarVagas` é true (mudou instrumento, horário ou
         * instrumentos/aluno), o campo Vagas é preenchido sozinho com o limite —
         * é o que faz "vagas" seguir o acervo em vez de ser só um número
         * digitado à parte. Não mexe no valor ao abrir pra editar (a turma pode
         * ter vagas a mais de propósito, contando com aluno que traz o próprio
         * instrumento), nem enquanto o usuário está digitando o campo direto.
         */
        async function conferirVagas(atualizarVagas) {
          const aviso = el.querySelector('#tf-aviso-vagas');
          const ids = instrumentosMarcados();
          if (!ids.length) { aviso.textContent = 'Sem instrumento: as vagas não são limitadas pelo acervo.'; aviso.style.color = ''; return; }
          try {
            const resultados = await Promise.all(ids.map((instId) => API.post(`/api/instrumentos/${instId}/vagas-disponiveis`, {
              horarios,
              turma_id: ed ? turma.id : null,
              instrumentos_por_aluno: el.querySelector('#tf-por-aluno').value,
            })));
            // Marcar mais de um instrumento e um cardapio de opcoes (ex.:
            // violão aço OU violão de naylon) — cada aluno usa um deles, não
            // todos ao mesmo tempo. Por isso a capacidade da turma é a SOMA
            // do que cabe em cada instrumento, não o menor entre eles.
            const somaVagasMaximas = resultados.reduce((s, r) => s + r.vagas_maximas, 0);
            aviso.innerHTML = resultados.map((r) => {
              const ocupando = r.turmas_no_mesmo_horario.map((t) => t.nome).join(', ');
              return `<strong>${UI.escapar(r.instrumento)}</strong>: o instituto tem ${r.quantidade_total}. `
                + (r.em_uso_no_horario ? `Neste horário, ${r.em_uso_no_horario} já em uso${ocupando ? ` (${UI.escapar(ocupando)})` : ''}. ` : '')
                + `Cabem até <strong>${r.vagas_maximas}</strong> aluno(s).`;
            }).join('<br>')
              + (resultados.length > 1 ? `<br>Somando os instrumentos marcados (cada aluno usa um deles): até <strong>${somaVagasMaximas}</strong> aluno(s) no total.` : '')
              + (atualizarVagas ? '<br><span class="dica">Vagas preenchidas automaticamente pelo acervo — ajuste se algum aluno trouxer o próprio instrumento ou já estiver com um emprestado.</span>' : '');
            if (atualizarVagas) el.querySelector('#tf-vagas').value = somaVagasMaximas;
            const vagas = Number(el.querySelector('#tf-vagas').value || 0);
            aviso.style.color = vagas > somaVagasMaximas ? 'var(--perigo)' : '';
          } catch (e) { aviso.textContent = e.message; }
        }

        el.querySelector('#tf-add-horario').addEventListener('click', () => {
          horarios.push({ dia_semana: 4, hora_inicio: '19:00', hora_fim: '20:00' });
          desenharHorarios(); conferirVagas(true);
        });
        el.querySelector('#tf-add-instrutor').addEventListener('click', () => {
          if (!equipe.length) { UI.erro('Cadastre voluntários antes de escalar instrutores.'); return; }
          instrutores.push({ profissional_id: equipe[0].id, papel: instrutores.length ? 'auxiliar' : 'titular' });
          desenharInstrutores();
        });
        const tfInstrumentos = el.querySelector('#tf-instrumentos');
        const tfPorAluno = el.querySelector('#tf-por-aluno');
        if (tfInstrumentos) tfInstrumentos.addEventListener('change', () => conferirVagas(true));
        if (tfPorAluno) tfPorAluno.addEventListener('change', () => conferirVagas(true));
        el.querySelector('#tf-vagas').addEventListener('input', () => conferirVagas(false));

        desenharHorarios();
        desenharInstrutores();
        conferirVagas();
      },
      aoConfirmar: async (el) => {
        const campoHorasAbonadas = el.querySelector('#tf-horas-abonadas');
        const corpo = {
          curso_id: el.querySelector('#tf-curso').value,
          nome: el.querySelector('#tf-nome').value,
          instrumentos_ids: Array.from(el.querySelectorAll('#tf-instrumentos input:checked')).map((c) => c.value),
          instrumentos_por_aluno: el.querySelector('#tf-por-aluno') ? el.querySelector('#tf-por-aluno').value : 1,
          vagas: el.querySelector('#tf-vagas').value,
          sala: el.querySelector('#tf-sala').value,
          periodo_inicio: el.querySelector('#tf-inicio').value,
          periodo_fim: el.querySelector('#tf-fim').value,
          observacao: el.querySelector('#tf-obs').value,
          horarios,
          instrutores,
          status: el.querySelector('#tf-status').value,
          ...(campoHorasAbonadas ? { horas_abonadas: campoHorasAbonadas.value } : {}),
        };
        try {
          if (ed) await API.put(`/api/turmas/${turma.id}`, corpo);
          else await API.post('/api/turmas', corpo);
          UI.sucesso(ed ? 'Turma atualizada.' : 'Turma criada e encontros lançados no calendário.');
          listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { titulo: 'Turmas', render };
})();
