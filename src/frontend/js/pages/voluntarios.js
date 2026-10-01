'use strict';

/**
 * Voluntarios e instrutores do instituto. Alem do cadastro, guarda em que
 * dias/horarios cada pessoa pode ajudar — saber quem cobre qual horario e
 * metade da gestao de uma equipe voluntaria.
 */
window.PaginaVoluntarios = (function () {
  const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  let filtroTipo = '';

  async function render(container) {
    // Reseta a cada visita (mesmo motivo do filtro de Turmas/Chamada): senao
    // o select volta a mostrar "Todos" mas a lista continua filtrada por
    // dentro pelo valor da visita anterior.
    filtroTipo = '';
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce">
          <strong>Equipe do instituto</strong>
          <div class="dica">Voluntários e contratados. A disponibilidade informada aqui ajuda a escalar quem fica em cada turma.</div>
        </div>
        <div class="campo">
          <label>Tipo</label>
          <select id="vol-tipo">
            <option value="">Todos</option>
            <option value="voluntario">Somente voluntários</option>
            <option value="contratado">Somente contratados</option>
          </select>
        </div>
        <button class="btn btn--secundario" id="vol-atividades">📋 Atividades</button>
        <button class="btn btn--secundario" id="vol-horas">⏱️ Horas de voluntariado</button>
        <button class="btn btn--secundario" id="vol-calendarios">🗓️ Calendário de todos</button>
        <button class="btn" id="vol-novo">+ Nova pessoa</button>
      </div>
      <div class="card"><div id="vol-lista">Carregando…</div></div>`;

    container.querySelector('#vol-tipo').addEventListener('change', (e) => { filtroTipo = e.target.value; listar(); });
    container.querySelector('#vol-novo').addEventListener('click', () => formulario(null));
    container.querySelector('#vol-horas').addEventListener('click', horasVoluntariado);
    container.querySelector('#vol-atividades').addEventListener('click', () => atividades());
    container.querySelector('#vol-calendarios').addEventListener('click', () => {
      selecionarPeriodo((periodo) => Documentos.calendariosInstrutoresLote(periodo));
    });
    listar();
  }

  async function listar() {
    const alvo = document.getElementById('vol-lista');
    if (!alvo) return;
    let pessoas = [];
    try { pessoas = await API.get('/api/agenda/profissionais'); }
    catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    if (filtroTipo) pessoas = pessoas.filter((p) => (p.tipo || 'contratado') === filtroTipo);

    if (!pessoas.length) {
      alvo.innerHTML = `<div class="vazio"><h3>Ninguém cadastrado ainda</h3>
        <p class="dica">Cadastre os voluntários que dão aula no instituto.</p></div>`;
      return;
    }

    alvo.innerHTML = `
      <div class="rolagem"><table class="tabela">
        <thead><tr><th>Nome</th><th>Tipo</th><th>Contato</th><th></th></tr></thead>
        <tbody>
          ${pessoas.map((p) => `
            <tr>
              <td>
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${UI.escapar(p.cor || '#2563eb')};margin-right:6px"></span>
                <strong>${UI.escapar(p.nome)}</strong>
              </td>
              <td>${p.tipo === 'voluntario' ? '<span class="badge badge--ok">Voluntário</span>' : '<span class="badge badge--muted">Contratado</span>'}</td>
              <td class="dica">${UI.escapar(p.telefone || p.email || '—')}</td>
              <td style="text-align:right;white-space:nowrap">
                ${p.tipo === 'voluntario' ? `<button class="btn btn--secundario" data-termo="${p.id}">📜 Termo</button>` : ''}
                <button class="btn btn--secundario" data-calendario="${p.id}" title="Calendário de aulas para imprimir">🗓️</button>
                <button class="btn btn--secundario" data-ver="${p.id}">Ver</button>
                <button class="btn btn--secundario" data-editar="${p.id}">Editar</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;

    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', async () => {
      try { formulario(await API.get(`/api/agenda/profissionais/${b.dataset.editar}`)); }
      catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', async () => {
      try { detalhe(await API.get(`/api/agenda/profissionais/${b.dataset.ver}`)); }
      catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-termo]').forEach((b) => b.addEventListener('click', () => {
      formTermo(pessoas.find((p) => String(p.id) === b.dataset.termo));
    }));
    alvo.querySelectorAll('[data-calendario]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.calendario;
      selecionarPeriodo((periodo) => Documentos.calendarioInstrutor(id, periodo));
    }));
  }

  /** Pede de qual mês até qual mês imprimir o calendário de aulas (pode ser só um). */
  function selecionarPeriodo(aoEscolher) {
    const mesAtual = new Date().toISOString().slice(0, 7);
    Modal.abrir({
      titulo: 'Calendário de aulas — período', tamanho: 'modal--pequeno', textoConfirmar: '🗓️ Gerar PDF',
      corpoHTML: `
        <p class="dica" style="margin-top:0">Traz as aulas de verdade marcadas nesse período (com data, turma e os alunos matriculados).</p>
        <div class="form-grid">
          <div class="campo"><label>De</label><input type="month" id="cp-de" value="${mesAtual}" /></div>
          <div class="campo"><label>Até</label><input type="month" id="cp-ate" value="${mesAtual}" /></div>
        </div>
        <span class="dica">Deixe os dois iguais para um mês só.</span>`,
      aoConfirmar: async (el) => {
        const deMes = el.querySelector('#cp-de').value;
        const ateMes = el.querySelector('#cp-ate').value;
        if (!deMes || !ateMes) { UI.erro('Escolha o período.'); return false; }
        if (ateMes < deMes) { UI.erro('O mês final não pode ser antes do inicial.'); return false; }
        await aoEscolher({ deMes, ateMes });
      },
    });
  }

  /**
   * Termo de adesão ao serviço voluntário (Lei 9.608/1998) — o papel que
   * se assina na entrada. Pede as três coisas que só a coordenação sabe:
   * o que a pessoa vai fazer, quanto tempo por semana e desde quando.
   */
  function formTermo(pessoa) {
    if (!pessoa) return;
    const hoje = new Date().toISOString().slice(0, 10);
    Modal.abrir({
      titulo: `Termo de adesão — ${pessoa.nome}`, tamanho: 'modal--pequeno', textoConfirmar: '📜 Gerar termo',
      corpoHTML: `
        <p class="dica" style="margin-top:0">Documento assinado pelas duas partes na entrada do voluntário.
        Sai em duas vias. O texto pode ser ajustado em <strong>Configurações → Documentos</strong>.</p>
        <div class="campo"><label>Atividade que vai exercer *</label>
          <input id="tv-atividade" placeholder="Ex.: instrutor(a) de violão" /></div>
        <div class="campo mt-16"><label>Dedicação combinada</label>
          <input id="tv-carga" placeholder="Ex.: 4 horas semanais" /></div>
        <div class="campo mt-16"><label>Início *</label>
          <input type="date" id="tv-inicio" value="${hoje}" /></div>
        ${pessoa.documento ? '' : '<div class="dica mt-16">⚠️ Esta pessoa está sem documento no cadastro — o termo vai sair com um tracinho no lugar do CPF/RG.</div>'}`,
      aoConfirmar: async (el) => {
        const atividade = el.querySelector('#tv-atividade').value.trim();
        if (!atividade) { UI.erro('Informe a atividade que o voluntário vai exercer.'); return false; }
        await Documentos.termoVoluntariado(pessoa, {
          atividade,
          carga_semanal: el.querySelector('#tv-carga').value.trim(),
          inicio: el.querySelector('#tv-inicio').value,
        });
      },
    });
  }

  function detalhe(p) {
    Modal.abrir({
      titulo: p.nome,
      mostrarConfirmar: false,
      corpoHTML: `
        <p class="dica" style="margin-top:0">
          ${p.tipo === 'voluntario' ? '🙋 Voluntário' : 'Contratado'}
          ${p.documento ? ' · Documento: ' + UI.escapar(p.documento) : ''}
          ${p.telefone ? ' · ' + UI.escapar(p.telefone) : ''}
          ${p.email ? ' · ' + UI.escapar(p.email) : ''}
        </p>

        <h4>Disponibilidade</h4>
        ${p.disponibilidade && p.disponibilidade.length
          ? `<ul>${p.disponibilidade.map((d) => `<li>${DIAS[d.dia_semana]}, ${UI.escapar(d.hora_inicio)} às ${UI.escapar(d.hora_fim)}</li>`).join('')}</ul>`
          : '<p class="dica">Nenhuma disponibilidade informada.</p>'}

        <h4 class="mt-16">Turmas em que atua</h4>
        ${p.turmas && p.turmas.length
          ? `<ul>${p.turmas.map((t) => `<li>${UI.escapar(t.curso_nome)} — ${UI.escapar(t.nome)} <span class="badge badge--muted">${UI.escapar(t.papel)}</span></li>`).join('')}</ul>`
          : '<p class="dica">Ainda não está em nenhuma turma aberta.</p>'}

        ${p.observacao ? `<h4 class="mt-16">Observação</h4><p class="dica">${UI.escapar(p.observacao)}</p>` : ''}`,
    });
  }

  function formulario(pessoa) {
    const ed = !!pessoa;
    const faixas = (ed && pessoa.disponibilidade) ? pessoa.disponibilidade.slice() : [];

    Modal.abrir({
      titulo: ed ? 'Editar pessoa' : 'Nova pessoa',
      tamanho: 'modal--grande',
      textoConfirmar: 'Salvar',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo col-2"><label>Nome *</label>
            <input id="vo-nome" value="${ed ? UI.escapar(pessoa.nome) : ''}" /></div>
          <div class="campo col-2" id="vo-foto-campo">
            <label>Foto</label>
            ${ed ? `
              <div class="flex gap-12" style="align-items:center">
                <div class="foto-preview" id="vo-foto-preview" style="width:96px;height:96px;border-radius:8px;overflow:hidden;background:var(--fundo-alt,#f1f1f1);display:flex;align-items:center;justify-content:center;font-size:36px">
                  ${pessoa.foto_path ? `<img src="/uploads/pessoas/${encodeURIComponent(pessoa.foto_path)}" alt="" style="width:100%;height:100%;object-fit:cover">` : '👤'}
                </div>
                <div>
                  <input type="file" id="vo-foto-input" accept="image/*" style="display:none" />
                  <button type="button" class="btn btn--secundario" id="vo-foto-btn">📷 Alterar foto</button>
                </div>
              </div>
            ` : '<span class="dica">Salve o cadastro para adicionar uma foto.</span>'}
          </div>
          <div class="campo"><label>Tipo</label>
            <select id="vo-tipo">
              <option value="voluntario" ${ed && pessoa.tipo === 'voluntario' ? 'selected' : ''}>Voluntário</option>
              <option value="contratado" ${ed && pessoa.tipo !== 'voluntario' ? 'selected' : ''}>Contratado</option>
            </select></div>
          <div class="campo"><label>Telefone</label>
            <input id="vo-telefone" value="${ed ? UI.escapar(pessoa.telefone || '') : ''}" /></div>
          <div class="campo"><label>E-mail</label>
            <input id="vo-email" value="${ed ? UI.escapar(pessoa.email || '') : ''}" /></div>
          <div class="campo"><label>Documento</label>
            <input id="vo-documento" value="${ed ? UI.escapar(pessoa.documento || '') : ''}" placeholder="CPF ou RG" />
            <span class="dica">Aparece na declaração de horas e no termo de adesão.</span></div>
          <div class="campo"><label>Cor na agenda</label>
            <input type="color" id="vo-cor" value="${ed ? UI.escapar(pessoa.cor || '#2563eb') : '#2563eb'}" style="width:80px;height:38px;padding:2px" /></div>
          <div class="campo col-2"><label>Endereço</label>
            <input id="vo-endereco" value="${ed ? UI.escapar(pessoa.endereco || '') : ''}" placeholder="Rua, número, bairro" />
            <span class="dica">Usado no "residente e domiciliado em" do termo de adesão.</span></div>
          <div class="campo col-2"><label>Observação</label>
            <textarea id="vo-obs" rows="2">${ed ? UI.escapar(pessoa.observacao || '') : ''}</textarea></div>

          <div class="campo col-2" style="border-top:1px solid var(--borda);padding-top:14px">
            <label>Disponibilidade</label>
            <span class="dica">Em que dias e horários esta pessoa pode ajudar.</span>
            <div id="vo-faixas" class="mt-16"></div>
            <button class="btn btn--secundario mt-16" type="button" id="vo-add-faixa">+ Adicionar horário</button>
          </div>
        </div>`,
      aoAbrir: (el) => {
        if (ed) {
          const btnFoto = el.querySelector('#vo-foto-btn');
          const inputFoto = el.querySelector('#vo-foto-input');
          if (btnFoto && inputFoto) {
            btnFoto.addEventListener('click', () => inputFoto.click());
            inputFoto.addEventListener('change', async () => {
              const arq = inputFoto.files[0];
              inputFoto.value = '';
              if (!arq) return;
              const fd = new FormData();
              fd.append('foto', arq);
              try {
                const atualizado = await API.post(`/api/agenda/profissionais/${pessoa.id}/foto`, fd);
                pessoa.foto_path = atualizado.foto_path;
                const prev = el.querySelector('#vo-foto-preview');
                if (prev) prev.innerHTML = `<img src="/uploads/pessoas/${encodeURIComponent(atualizado.foto_path)}" alt="" style="width:100%;height:100%;object-fit:cover">`;
                UI.sucesso('Foto atualizada.');
              } catch (e) { UI.erro(e.message); }
            });
          }
        }
        function desenhar() {
          const alvo = el.querySelector('#vo-faixas');
          if (!faixas.length) {
            alvo.innerHTML = '<p class="dica">Nenhum horário informado.</p>';
            return;
          }
          alvo.innerHTML = faixas.map((f, i) => `
            <div class="flex gap-12 mt-16" style="align-items:center;flex-wrap:wrap">
              <select data-dia="${i}" style="max-width:150px">
                ${DIAS.map((d, n) => `<option value="${n}" ${Number(f.dia_semana) === n ? 'selected' : ''}>${d}</option>`).join('')}
              </select>
              <input type="time" data-ini="${i}" value="${UI.escapar(f.hora_inicio || '')}" style="max-width:120px" />
              <span class="dica">às</span>
              <input type="time" data-fim="${i}" value="${UI.escapar(f.hora_fim || '')}" style="max-width:120px" />
              <button class="btn btn--perigo" type="button" data-remover="${i}">Remover</button>
            </div>`).join('');

          alvo.querySelectorAll('[data-dia]').forEach((s) => s.addEventListener('change', () => { faixas[Number(s.dataset.dia)].dia_semana = Number(s.value); }));
          alvo.querySelectorAll('[data-ini]').forEach((s) => s.addEventListener('change', () => { faixas[Number(s.dataset.ini)].hora_inicio = s.value; }));
          alvo.querySelectorAll('[data-fim]').forEach((s) => s.addEventListener('change', () => { faixas[Number(s.dataset.fim)].hora_fim = s.value; }));
          alvo.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', () => { faixas.splice(Number(b.dataset.remover), 1); desenhar(); }));
        }

        el.querySelector('#vo-add-faixa').addEventListener('click', () => {
          faixas.push({ dia_semana: 1, hora_inicio: '19:00', hora_fim: '20:00' });
          desenhar();
        });
        desenhar();
      },
      aoConfirmar: async (el) => {
        const corpo = {
          nome: el.querySelector('#vo-nome').value,
          tipo: el.querySelector('#vo-tipo').value,
          telefone: el.querySelector('#vo-telefone').value,
          email: el.querySelector('#vo-email').value,
          documento: el.querySelector('#vo-documento').value,
          endereco: el.querySelector('#vo-endereco').value,
          cor: el.querySelector('#vo-cor').value,
          observacao: el.querySelector('#vo-obs').value,
          disponibilidade: faixas,
        };
        try {
          if (ed) await API.put(`/api/agenda/profissionais/${pessoa.id}`, corpo);
          else await API.post('/api/agenda/profissionais', corpo);
          UI.sucesso(ed ? 'Cadastro atualizado.' : 'Pessoa cadastrada.');
          listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  /**
   * Horas doadas por cada voluntario no periodo, com a declaracao em PDF que
   * eles costumam precisar (faculdade, empresa, comprovacao de horas).
   */
  async function horasVoluntariado() {
    const hoje = new Date().toISOString().slice(0, 10);
    const inicioAno = hoje.slice(0, 4) + '-01-01';

    Modal.abrir({
      titulo: 'Horas de voluntariado',
      tamanho: 'modal--grande',
      mostrarConfirmar: false,
      corpoHTML: `
        <div class="barra-ferramentas">
          <div class="campo"><label>De</label><input type="date" id="hv-de" value="${inicioAno}" /></div>
          <div class="campo"><label>Até</label><input type="date" id="hv-ate" value="${hoje}" /></div>
        </div>
        <div id="hv-lista" class="mt-16">Carregando…</div>`,
      aoAbrir: (el) => {
        async function carregar() {
          const de = el.querySelector('#hv-de').value;
          const ate = el.querySelector('#hv-ate').value;
          const alvo = el.querySelector('#hv-lista');
          let dados = [];
          try {
            dados = await API.get(`/api/turmas/horas-voluntariado?de=${de}&ate=${ate}`);
          } catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

          alvo.innerHTML = !dados.length
            ? '<p class="dica">Nada registrado no período. As horas vêm das chamadas das aulas e das atividades de apoio.</p>'
            : `<div class="rolagem"><table class="tabela">
                <thead><tr><th>Voluntário</th><th>Aulas dadas</th><th>Outras atividades</th><th>Horas</th><th></th></tr></thead>
                <tbody>
                  ${dados.map((d, i) => `
                    <tr>
                      <td>${UI.escapar(d.nome)}${d.tipo === 'voluntario' ? ' <span class="badge badge--ok">voluntário</span>' : ''}</td>
                      <td>${d.aulas_dadas}${d.horas_aula ? ` <span class="dica">${UI.escapar(String(d.horas_aula))}h</span>` : ''}</td>
                      <td>${d.atividades || 0}${d.horas_atividade ? ` <span class="dica">${UI.escapar(String(d.horas_atividade))}h</span>` : ''}</td>
                      <td><strong>${UI.escapar(String(d.horas || 0))}h</strong></td>
                      <td style="text-align:right">
                        <button class="btn btn--secundario" data-decl="${i}">📄 Declaração</button>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table></div>
              <p class="dica mt-16">As horas somam as aulas dadas (das chamadas registradas) com as atividades de apoio lançadas em "Atividades".</p>`;

          alvo.querySelectorAll('[data-decl]').forEach((b) => b.addEventListener('click', () => {
            Documentos.declaracaoVoluntariado(dados[Number(b.dataset.decl)], de, ate);
          }));
        }
        el.querySelector('#hv-de').addEventListener('change', carregar);
        el.querySelector('#hv-ate').addEventListener('change', carregar);
        carregar();
      },
    });
  }

  // ==================== Atividades fora da sala de aula ====================

  /**
   * Quem monta o palco do recital, troca as cordas ou passa a tarde na
   * papelada doou o tempo dele igual a quem deu aula. Antes, só as aulas
   * contavam — e a declaração saía menor do que a realidade.
   */
  async function atividades(profissionalId) {
    const hoje = new Date().toISOString().slice(0, 10);
    const inicioMes = hoje.slice(0, 8) + '01';
    let pessoas = [];
    let tipos = {};
    try {
      [pessoas, tipos] = await Promise.all([
        API.get('/api/agenda/profissionais'),
        API.get('/api/turmas/voluntarios/atividades/tipos').catch(() => ({})),
      ]);
    } catch (e) { UI.erro(e.message); return; }

    Modal.abrir({
      titulo: 'Atividades de voluntariado', tamanho: 'modal--grande', mostrarConfirmar: false,
      corpoHTML: `
        <p class="dica" style="margin-top:0">Registre o tempo doado fora da sala de aula: evento, manutenção do acervo,
        administrativo. Entra nas horas de voluntariado e na declaração.</p>
        <div class="barra-ferramentas">
          <div class="campo"><label>Voluntário</label>
            <select id="at-filtro-pessoa">
              <option value="">Todos</option>
              ${pessoas.map((p) => `<option value="${p.id}" ${String(profissionalId) === String(p.id) ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
            </select></div>
          <div class="campo"><label>De</label><input type="date" id="at-de" value="${inicioMes}" /></div>
          <div class="campo"><label>Até</label><input type="date" id="at-ate" value="${hoje}" /></div>
          <div class="cresce"></div>
          <button class="btn" id="at-nova" style="align-self:end">+ Registrar atividade</button>
        </div>
        <div id="at-lista" class="mt-16">Carregando…</div>`,
      aoAbrir: (el) => {
        async function carregar() {
          const alvo = el.querySelector('#at-lista');
          const q = new URLSearchParams();
          const pid = el.querySelector('#at-filtro-pessoa').value;
          if (pid) q.set('profissional_id', pid);
          q.set('de', el.querySelector('#at-de').value);
          q.set('ate', el.querySelector('#at-ate').value);
          let lista = [];
          try { lista = await API.get('/api/turmas/voluntarios/atividades?' + q.toString()); }
          catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

          const total = lista.reduce((s, a) => s + Number(a.horas || 0), 0);
          alvo.innerHTML = !lista.length
            ? '<div class="vazio"><h3>Nenhuma atividade no período</h3><p class="dica">Registre eventos, manutenção do acervo e trabalho administrativo.</p></div>'
            : `<p><strong>${Number(total.toFixed(1))}h</strong> em ${lista.length} atividade(s)</p>
              <div class="rolagem"><table class="tabela">
                <thead><tr><th>Data</th><th>Voluntário</th><th>Tipo</th><th>Descrição</th><th>Horas</th><th></th></tr></thead>
                <tbody>${lista.map((a) => `<tr>
                  <td>${UI.dataHora(a.data)}</td>
                  <td>${UI.escapar(a.voluntario_nome)}</td>
                  <td class="dica">${UI.escapar(tipos[a.tipo] || a.tipo)}</td>
                  <td>${UI.escapar(a.descricao || '—')}${a.hora_inicio ? `<div class="dica">${UI.escapar(a.hora_inicio)}–${UI.escapar(a.hora_fim || '')}</div>` : ''}</td>
                  <td><strong>${UI.escapar(String(a.horas))}h</strong></td>
                  <td style="text-align:right"><button class="btn btn--perigo" data-at-rm="${a.id}">Excluir</button></td>
                </tr>`).join('')}</tbody>
              </table></div>`;

          alvo.querySelectorAll('[data-at-rm]').forEach((b) => b.addEventListener('click', async () => {
            const ok = await UI.confirmar('Excluir este registro? As horas saem do total do voluntário.', { titulo: 'Excluir atividade', textoConfirmar: 'Excluir' });
            if (!ok) return;
            try { await API.del(`/api/turmas/voluntarios/atividades/${b.dataset.atRm}`); UI.sucesso('Atividade excluída.'); carregar(); }
            catch (e) { UI.erro(e.message); }
          }));
        }

        el.querySelector('#at-filtro-pessoa').addEventListener('change', carregar);
        el.querySelector('#at-de').addEventListener('change', carregar);
        el.querySelector('#at-ate').addEventListener('change', carregar);
        el.querySelector('#at-nova').addEventListener('click', () => formAtividade(pessoas, tipos, el.querySelector('#at-filtro-pessoa').value, carregar));
        carregar();
      },
    });
  }

  function formAtividade(pessoas, tipos, preSelecionado, aoSalvar) {
    const hoje = new Date().toISOString().slice(0, 10);
    Modal.abrir({
      titulo: 'Registrar atividade', tamanho: 'modal--pequeno', textoConfirmar: 'Registrar',
      corpoHTML: `
        <div class="campo"><label>Voluntário *</label>
          <select id="fa-pessoa">
            <option value="">— selecione —</option>
            ${pessoas.map((p) => `<option value="${p.id}" ${String(preSelecionado) === String(p.id) ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
          </select></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Data *</label><input type="date" id="fa-data" value="${hoje}" /></div>
          <div class="campo"><label>Tipo</label>
            <select id="fa-tipo">${Object.entries(tipos).map(([k, v]) => `<option value="${k}">${UI.escapar(v)}</option>`).join('')}</select></div>
        </div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Início</label><input type="time" id="fa-ini" /></div>
          <div class="campo"><label>Fim</label><input type="time" id="fa-fim" /></div>
        </div>
        <div class="campo mt-16"><label>Ou informe as horas direto</label>
          <input type="number" id="fa-horas" step="0.5" min="0" placeholder="Ex.: 2.5" />
          <span class="dica">Use isto quando não souber a hora exata — o total é o que importa para a declaração.</span></div>
        <div class="campo mt-16"><label>Descrição</label>
          <input id="fa-desc" placeholder="Ex.: montagem do palco do recital" /></div>`,
      aoAbrir: (el) => {
        // Voluntario e' um profissional com tipo 'voluntario' (mesma tabela, ver salvar acima).
        CadastroRapido.ligar(el.querySelector('#fa-pessoa'), 'profissional', {
          rotulo: 'voluntário', extra: { tipo: 'voluntario' }, aoCriar: (r) => pessoas.push(r),
        });
      },
      aoConfirmar: async (el) => {
        const corpo = {
          profissional_id: el.querySelector('#fa-pessoa').value,
          data: el.querySelector('#fa-data').value,
          tipo: el.querySelector('#fa-tipo').value,
          hora_inicio: el.querySelector('#fa-ini').value || null,
          hora_fim: el.querySelector('#fa-fim').value || null,
          horas: el.querySelector('#fa-horas').value || null,
          descricao: el.querySelector('#fa-desc').value,
        };
        if (!corpo.profissional_id) { UI.erro('Selecione o voluntário.'); return false; }
        try {
          await API.post('/api/turmas/voluntarios/atividades', corpo);
          UI.sucesso('Atividade registrada.');
          if (aoSalvar) aoSalvar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { titulo: 'Voluntários', render };
})();
