'use strict';

/**
 * CRM da agencia de viagem: funil Kanban de leads (Entrou em contato ->
 * Aguardando proposta -> Aguardando pagamento -> Venda concluída). Ao fechar
 * a venda, abre um formulario com os dados da venda (valor, comissao do
 * agente, datas de ida/volta), que gera automaticamente a conta a receber
 * (Financeiro) e a comissao (Contas a Pagar), e alimenta o Calendário de
 * Viagens. Reaproveita o mesmo layout visual do Pátio da Oficina (Kanban).
 */
window.PaginaCRM = (function () {
  let leads = [];
  let agentes = [];
  let checkins = [];
  let mostrarPerdidos = false;

  const COLUNAS = [
    { status: 'contato', titulo: 'Entrou em contato', proximo: 'proposta', rotuloAvancar: 'Enviar proposta →' },
    { status: 'proposta', titulo: 'Aguardando aprovar proposta', proximo: 'pagamento', rotuloAvancar: 'Aguardar pagamento →' },
    { status: 'pagamento', titulo: 'Aguardando pagamento', proximo: null, rotuloAvancar: null },
    { status: 'vendido', titulo: 'Venda concluída', proximo: null, rotuloAvancar: null },
  ];

  async function render(container) {
    agentes = await API.get('/api/agenda/profissionais').catch(() => []);
    container.innerHTML = `
      <div class="barra-ferramentas">
        <label class="flex gap-12" style="align-items:center;font-size:14px">
          <input type="checkbox" id="crm-perdidos"> Mostrar perdidos
        </label>
        <div class="cresce"></div>
        <button class="btn" id="crm-novo">+ Novo lead</button>
      </div>
      <div class="patio-kanban" id="crm-kanban"></div>
      <div id="crm-perdidos-lista" class="mt-16"></div>`;

    container.querySelector('#crm-novo').addEventListener('click', () => formLead());
    container.querySelector('#crm-perdidos').addEventListener('change', (e) => { mostrarPerdidos = e.target.checked; renderTudo(); });
    await listar();
  }

  async function listar() {
    [leads, checkins] = await Promise.all([
      API.get('/api/crm/leads').catch(() => []),
      API.get('/api/crm/checkins').catch(() => []),
    ]);
    renderTudo();
  }

  function renderTudo() {
    renderKanban();
    renderPerdidos();
  }

  function renderKanban() {
    const alvo = document.getElementById('crm-kanban');
    if (!alvo) return;
    alvo.innerHTML = COLUNAS.map((col) => {
      const itens = leads.filter((l) => l.status === col.status);
      return `<div class="patio-coluna">
        <div class="patio-coluna__titulo">${col.titulo} <span class="badge badge--muted">${itens.length}</span></div>
        <div class="patio-coluna__cards">${itens.length ? itens.map((l) => cardLead(l, col)).join('') : '<div class="patio-vazio">Vazio</div>'}</div>
      </div>`;
    }).join('') + `
      <div class="patio-coluna">
        <div class="patio-coluna__titulo">✈️ Check-in a fazer <span class="badge badge--muted">${checkins.length}</span></div>
        <div class="patio-coluna__cards">${checkins.length ? checkins.map(cardCheckin).join('') : '<div class="patio-vazio">Nenhum check-in pendente.</div>'}</div>
      </div>`;

    alvo.querySelectorAll('[data-ver]').forEach((c) => c.addEventListener('click', () => formLead(leads.find((l) => l.id === Number(c.dataset.ver)))));
    alvo.querySelectorAll('[data-avancar]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await API.put(`/api/crm/leads/${b.dataset.avancar}`, { status: b.dataset.para }); await listar(); }
      catch (err) { UI.erro(err.message); }
    }));
    alvo.querySelectorAll('[data-fechar-venda]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      formFecharVenda(leads.find((l) => l.id === Number(b.dataset.fecharVenda)));
    }));
    alvo.querySelectorAll('[data-perdido]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await UI.confirmar('Marcar este lead como perdido? Ele sai do funil ativo.', { titulo: 'Marcar como perdido', textoConfirmar: 'Marcar perdido', perigo: true });
      if (!ok) return;
      try { await API.put(`/api/crm/leads/${b.dataset.perdido}`, { status: 'perdido' }); await listar(); }
      catch (err) { UI.erro(err.message); }
    }));
    alvo.querySelectorAll('[data-checkin]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await API.post(`/api/crm/vendas/${b.dataset.checkin}/checkin`, {}); UI.sucesso('Check-in marcado como feito.'); await listar(); }
      catch (err) { UI.erro(err.message); }
    }));
  }

  function cardCheckin(v) {
    return `<div class="patio-card">
      <div class="patio-card__num">✈️ ${v.data_ida || 'sem data'}</div>
      <div class="patio-card__cliente">${UI.escapar(v.cliente_nome)}</div>
      <div class="patio-card__veiculo">${UI.escapar(v.descricao)}</div>
      <div class="patio-card__acao">
        <button class="btn" data-checkin="${v.id}">✓ Check-in feito</button>
      </div>
    </div>`;
  }

  function cardLead(l, col) {
    const origemIcone = { whatsapp: '💬', indicacao: '🤝', site: '🌐' }[l.origem] || '📞';
    return `<div class="patio-card" data-ver="${l.id}">
      <div class="patio-card__num">#${l.id} ${origemIcone} ${UI.escapar(l.origem || 'contato')}</div>
      <div class="patio-card__cliente">${UI.escapar(l.nome)}</div>
      ${l.telefone ? `<div class="patio-card__veiculo">${UI.escapar(l.telefone)}</div>` : ''}
      <div class="patio-card__acao">
        ${col.status === 'pagamento'
          ? `<button class="btn" data-fechar-venda="${l.id}">💰 Fechar venda</button>`
          : (col.proximo ? `<button class="btn btn--secundario" data-avancar="${l.id}" data-para="${col.proximo}">${col.rotuloAvancar}</button>` : '')}
        ${col.status !== 'vendido' ? `<button class="btn btn--secundario" data-perdido="${l.id}" style="margin-top:6px">✕ Perdido</button>` : ''}
      </div>
    </div>`;
  }

  function renderPerdidos() {
    const alvo = document.getElementById('crm-perdidos-lista');
    if (!alvo) return;
    if (!mostrarPerdidos) { alvo.innerHTML = ''; return; }
    const perdidos = leads.filter((l) => l.status === 'perdido');
    alvo.innerHTML = `<div class="card">
      <h3 style="margin-top:0">Leads perdidos</h3>
      ${perdidos.length ? `<table class="tabela"><thead><tr><th>Lead</th><th>Telefone</th><th></th></tr></thead>
        <tbody>${perdidos.map((l) => `<tr>
          <td>${UI.escapar(l.nome)}</td><td>${UI.escapar(l.telefone || '—')}</td>
          <td style="text-align:right"><button class="btn btn--secundario" data-reativar="${l.id}">Reativar</button></td>
        </tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhum lead perdido.</p>'}
    </div>`;
    alvo.querySelectorAll('[data-reativar]').forEach((b) => b.addEventListener('click', async () => {
      try { await API.put(`/api/crm/leads/${b.dataset.reativar}`, { status: 'contato' }); UI.sucesso('Lead reativado.'); await listar(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  function formLead(lead) {
    const ehEdicao = !!lead;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar lead' : 'Novo lead', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Nome *</label><input id="ld-nome" value="${UI.escapar(lead ? lead.nome : '')}" /></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Telefone</label><input id="ld-tel" value="${UI.escapar(lead && lead.telefone ? lead.telefone : '')}" /></div>
          <div class="campo"><label>E-mail</label><input id="ld-email" value="${UI.escapar(lead && lead.email ? lead.email : '')}" /></div>
        </div>
        <div class="campo mt-16"><label>Origem</label>
          <select id="ld-origem">
            <option value="">— não informado —</option>
            <option value="whatsapp" ${lead && lead.origem === 'whatsapp' ? 'selected' : ''}>💬 WhatsApp</option>
            <option value="indicacao" ${lead && lead.origem === 'indicacao' ? 'selected' : ''}>🤝 Indicação</option>
            <option value="site" ${lead && lead.origem === 'site' ? 'selected' : ''}>🌐 Site</option>
            <option value="outro" ${lead && lead.origem === 'outro' ? 'selected' : ''}>Outro</option>
          </select></div>
        <div class="campo mt-16"><label>Observação</label><textarea id="ld-obs">${UI.escapar(lead && lead.observacao ? lead.observacao : '')}</textarea></div>
        ${ehEdicao && lead.venda ? `<div class="dica mt-16">🧾 Venda fechada: ${UI.escapar(lead.venda.descricao)} — pacote ${UI.moeda(lead.venda.valor_venda)} · comissão da agência ${UI.moeda(lead.venda.comissao_valor)}</div>` : ''}`,
      textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        const dados = {
          nome: el.querySelector('#ld-nome').value,
          telefone: el.querySelector('#ld-tel').value,
          email: el.querySelector('#ld-email').value,
          origem: el.querySelector('#ld-origem').value,
          observacao: el.querySelector('#ld-obs').value,
        };
        try {
          if (ehEdicao) await API.put(`/api/crm/leads/${lead.id}`, dados);
          else await API.post('/api/crm/leads', dados);
          UI.sucesso(ehEdicao ? 'Lead atualizado.' : 'Lead cadastrado.');
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  function formFecharVenda(lead) {
    Modal.abrir({
      titulo: `💰 Fechar venda — ${lead.nome}`, tamanho: 'modal--grande',
      corpoHTML: `
        <div class="campo"><label>Descrição da venda *</label><input id="fv-desc" placeholder="Ex.: Pacote Cancún 7 noites" /></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Operadora/fornecedor</label><input id="fv-operadora" /></div>
          <div class="campo"><label>Nº da reserva</label><input id="fv-reserva" /></div>
        </div>
        <div class="campo mt-16"><label>Valor da venda (R$) <span class="dica">informativo — quem vende o pacote é a operadora, esse valor não é receita da agência</span></label>
          <input id="fv-valor" type="number" step="0.01" min="0" /></div>

        <div class="form-grid mt-16" style="border-top:1px solid var(--borda);padding-top:16px">
          <div class="campo"><label>Comissão da agência (%) *</label><input id="fv-comissao-pct" type="number" step="0.01" min="0" /></div>
          <div class="campo"><label>Parcelas (a receber)</label><input id="fv-parcelas" type="number" min="1" value="1" /></div>
        </div>
        <div class="dica mt-16" id="fv-comissao-preview">Comissão da agência (a receber): R$ 0,00</div>
        <div class="campo mt-16"><label>1º vencimento</label><input id="fv-venc" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>

        <div class="form-grid mt-16" style="border-top:1px solid var(--borda);padding-top:16px">
          <div class="campo"><label>Funcionário responsável</label>
            <select id="fv-agente"><option value="">— sem funcionário —</option>${agentes.map((a) => `<option value="${a.id}" data-pct="${a.comissao_pct}">${UI.escapar(a.nome)} (${a.comissao_pct}%)</option>`).join('')}</select></div>
          <div class="campo"><label>Comissão do funcionário (%) <span class="dica">sobre a comissão da agência</span></label><input id="fv-comissao-func-pct" type="number" step="0.01" min="0" /></div>
        </div>
        <div class="dica mt-16" id="fv-comissao-func-preview">Comissão do funcionário (a pagar): R$ 0,00</div>

        <div class="form-grid mt-16" style="border-top:1px solid var(--borda);padding-top:16px">
          <div class="campo"><label>Data de ida</label><input id="fv-ida" type="date" /></div>
          <div class="campo"><label>Data de volta</label><input id="fv-volta" type="date" /></div>
        </div>
        <div class="campo mt-16"><label>Observação</label><textarea id="fv-obs"></textarea></div>
        <div class="dica mt-16">Isso gera automaticamente a conta a receber da comissão da agência (Financeiro), a comissão do funcionário (Contas a Pagar, se houver) e aparece no Calendário de Viagens.</div>`,
      textoConfirmar: 'Fechar venda',
      aoAbrir: (el) => {
        const comissaoAgencia = () => {
          const valor = Number(el.querySelector('#fv-valor').value || 0);
          const pct = Number(el.querySelector('#fv-comissao-pct').value || 0);
          return valor * pct / 100;
        };
        const atualizarPreviewAgencia = () => {
          el.querySelector('#fv-comissao-preview').textContent = `Comissão da agência (a receber): ${UI.moeda(comissaoAgencia())}`;
          atualizarPreviewFuncionario();
        };
        const atualizarPreviewFuncionario = () => {
          const pctFunc = Number(el.querySelector('#fv-comissao-func-pct').value || 0);
          el.querySelector('#fv-comissao-func-preview').textContent = `Comissão do funcionário (a pagar): ${UI.moeda(comissaoAgencia() * pctFunc / 100)}`;
        };
        el.querySelector('#fv-valor').addEventListener('input', atualizarPreviewAgencia);
        el.querySelector('#fv-comissao-pct').addEventListener('input', atualizarPreviewAgencia);
        el.querySelector('#fv-comissao-func-pct').addEventListener('input', atualizarPreviewFuncionario);
        el.querySelector('#fv-agente').addEventListener('change', (e) => {
          const opt = e.target.selectedOptions[0];
          if (opt && opt.dataset.pct) { el.querySelector('#fv-comissao-func-pct').value = opt.dataset.pct; atualizarPreviewFuncionario(); }
        });
        CadastroRapido.ligar(el.querySelector('#fv-agente'), 'profissional', {
          rotulo: 'funcionário', aoCriar: (r) => agentes.push(r),
          opcao: (r) => ({ texto: `${r.nome} (${r.comissao_pct || 0}%)`, data: { pct: r.comissao_pct || 0 } }),
        });
      },
      aoConfirmar: async (el) => {
        const dados = {
          descricao: el.querySelector('#fv-desc').value,
          operadora: el.querySelector('#fv-operadora').value,
          numero_reserva: el.querySelector('#fv-reserva').value,
          valor_venda: el.querySelector('#fv-valor').value,
          parcelas: el.querySelector('#fv-parcelas').value,
          primeiro_vencimento: el.querySelector('#fv-venc').value || null,
          agente_id: el.querySelector('#fv-agente').value || null,
          comissao_pct: el.querySelector('#fv-comissao-pct').value || null,
          comissao_funcionario_pct: el.querySelector('#fv-comissao-func-pct').value || null,
          data_ida: el.querySelector('#fv-ida').value || null,
          data_volta: el.querySelector('#fv-volta').value || null,
          observacao: el.querySelector('#fv-obs').value,
        };
        try {
          await API.post(`/api/crm/leads/${lead.id}/fechar-venda`, dados);
          UI.sucesso('Venda fechada! Comissão da agência e do funcionário geradas.');
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { titulo: 'CRM', render };
})();
