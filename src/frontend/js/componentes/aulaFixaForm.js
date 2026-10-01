'use strict';

/**
 * Formulario de aula fixa (aula que se repete toda semana). Usado pela Agenda
 * (aba "Aula fixa") e pelo cadastro do aluno (ramo professor), que fixa o
 * aluno e nao mostra valor: a aula particular e' paga pela mensalidade.
 *
 * AulaFixaForm.abrir({ aula, aluno, clientes, servicos, profissionais, aoSalvar })
 *  - aula: registro de aulas_recorrentes (edicao) ou vazio (nova)
 *  - aluno: { id, nome, telefone } para travar o aluno (cadastro do aluno)
 */
window.AulaFixaForm = (function () {
  const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

  const ehProfessor = () => window.__ramoServico === 'professor';
  const ehInstituto = () => window.__ramoServico === 'instituto';
  const ehCreche = () => window.__ramoServico === 'creche';
  const rCliente = (m) => ((ehProfessor() || ehInstituto() || ehCreche()) ? (m ? 'Aluno' : 'aluno') : (m ? 'Cliente' : 'cliente'));
  const rServico = (m) => (ehInstituto() ? (m ? 'Atividade' : 'atividade') : ehProfessor() ? (m ? 'Matéria' : 'matéria') : (m ? 'Serviço' : 'serviço'));
  const rAula = (m) => ((ehProfessor() || ehInstituto() || ehCreche()) ? (m ? 'Aula' : 'aula') : (m ? 'Agendamento' : 'agendamento'));

  function abrir({ aula, aluno, clientes = [], servicos = [], profissionais = [], aoSalvar }) {
    const r = aula;
    const ehEdicao = !!r;
    const semValor = ehProfessor(); // o valor da aula vem da mensalidade
    Modal.abrir({
      titulo: ehEdicao ? `Editar ${rAula()} fixa` : `Nov${rAula() === 'aula' ? 'a' : 'o'} ${rAula()} fixa`, tamanho: 'modal--grande',
      corpoHTML: `
        ${aluno ? `<div class="campo"><label>${rCliente(true)}</label><div><strong>${UI.escapar(aluno.nome)}</strong></div></div>` : `<div class="form-grid">
          <div class="campo"><label>${rCliente(true)} (cadastrado)</label><select id="rec-aluno">
            <option value="">— avulso —</option>${clientes.map((c) => `<option value="${c.id}" data-tel="${UI.escapar(c.telefone || '')}" ${r && String(r.aluno_id) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('')}
          </select></div>
          <div class="campo"><label>Ou nome do ${rCliente()}</label><input id="rec-aluno-nome" value="${UI.escapar(r ? r.aluno_nome || '' : '')}" placeholder="${rCliente(true)} sem cadastro" /></div>
        </div>`}
        ${ehCreche() ? '' : `<div class="form-grid mt-16">
          <div class="campo"><label>${rServico(true)}${semValor ? ' <span class="dica">(opcional)</span>' : ''}</label><select id="rec-materia">
            <option value="">— selecione —</option>${servicos.map((s) => `<option value="${s.id}" data-preco="${s.preco_venda}" ${r && String(r.produto_id) === String(s.id) ? 'selected' : ''}>${UI.escapar(s.nome)}</option>`).join('')}
          </select></div>
          ${semValor ? '' : `<div class="campo"><label>Valor (R$)</label><input id="rec-valor" type="number" step="0.01" min="0" value="${r ? r.valor : ''}" /></div>`}
        </div>`}
        ${profissionais.length ? `<div class="campo mt-16"><label>Profissional</label><select id="rec-prof">
          <option value="">—</option>${profissionais.map((p) => `<option value="${p.id}" ${r && String(r.profissional_id) === String(p.id) ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
        </select></div>` : ''}
        <div class="form-grid mt-16">
          <div class="campo"><label>Dia da semana *</label><select id="rec-dia">
            ${DIAS_SEMANA.map((n, i) => `<option value="${i}" ${r ? (r.dia_semana === i ? 'selected' : '') : (i === 1 ? 'selected' : '')}>${n}</option>`).join('')}
          </select></div>
          <div class="campo"><label>Hora início *</label><input id="rec-hora-ini" type="time" value="${r ? r.hora_inicio : '15:00'}" required /></div>
          <div class="campo"><label>Hora fim <span class="dica">(opcional)</span></label><input id="rec-hora-fim" type="time" value="${r && r.hora_fim ? r.hora_fim : ''}" /></div>
        </div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Começa em</label><input id="rec-inicio" type="date" value="${r ? r.data_inicio : new Date().toISOString().slice(0, 10)}" /></div>
          <div class="campo"><label>Até <span class="dica">(opcional — deixe em branco para repetir sem data final)</span></label><input id="rec-fim" type="date" value="${r && r.data_fim ? r.data_fim : ''}" /></div>
        </div>
        <div class="campo mt-16"><label>Telefone (WhatsApp)</label><input id="rec-tel" value="${UI.escapar(r ? r.telefone || '' : (aluno && aluno.telefone) || '')}" placeholder="Ex.: 11999998888" /></div>
        <div class="campo mt-16"><label>Observação</label><input id="rec-obs" value="${UI.escapar(r ? r.observacao || '' : '')}" /></div>
        <div class="dica mt-16">O sistema gera automaticamente as próximas 8-9 semanas na agenda. Editar aqui não altera ocorrências já lançadas — só as futuras que ainda serão geradas.</div>`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        const materia = el.querySelector('#rec-materia');
        const valor = el.querySelector('#rec-valor');
        if (materia && valor) materia.addEventListener('change', () => {
          const opt = materia.selectedOptions[0];
          if (opt && opt.dataset.preco && !valor.value) valor.value = opt.dataset.preco;
        });
        const selAluno = el.querySelector('#rec-aluno');
        if (selAluno) selAluno.addEventListener('change', () => {
          const opt = selAluno.selectedOptions[0];
          const tel = el.querySelector('#rec-tel');
          if (opt && opt.dataset.tel && !tel.value) tel.value = opt.dataset.tel;
        });
      },
      aoConfirmar: async (el) => {
        const dados = {
          aluno_id: aluno ? aluno.id : (el.querySelector('#rec-aluno').value || null),
          aluno_nome: aluno ? '' : el.querySelector('#rec-aluno-nome').value,
          produto_id: el.querySelector('#rec-materia') ? el.querySelector('#rec-materia').value || null : null,
          valor: el.querySelector('#rec-valor') ? el.querySelector('#rec-valor').value : 0,
          profissional_id: el.querySelector('#rec-prof') ? el.querySelector('#rec-prof').value || null : null,
          dia_semana: el.querySelector('#rec-dia').value,
          hora_inicio: el.querySelector('#rec-hora-ini').value,
          hora_fim: el.querySelector('#rec-hora-fim').value || null,
          data_inicio: el.querySelector('#rec-inicio').value || null,
          data_fim: el.querySelector('#rec-fim').value || null,
          telefone: el.querySelector('#rec-tel').value,
          observacao: el.querySelector('#rec-obs').value,
        };
        try {
          if (ehEdicao) await API.put(`/api/agenda/aulas-recorrentes/${r.id}`, dados);
          else await API.post('/api/agenda/aulas-recorrentes', dados);
          UI.sucesso(ehEdicao ? `${rAula(true)} fixa atualizada.` : `${rAula(true)} fixa cadastrada — as próximas ocorrências já foram lançadas na agenda.`);
          if (aoSalvar) await aoSalvar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { abrir, DIAS_SEMANA };
})();
