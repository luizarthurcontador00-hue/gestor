'use strict';

/** Aba "Mensalidades" (ou "Contribuição mensal" no instituto): cobranças recorrentes por cliente. */
window.FinanceiroAssinaturas = (function () {
  const S = window.FinanceiroShared;

  async function render() {
    const alvo = S.alvoConteudo();
    alvo.innerHTML = `
      <p class="dica mb-16">${S.ehInstituto()
        ? 'Cadastre a contribuição mensal de cada mantenedor. Todo mês, no dia combinado, a cobrança é lançada automaticamente em "A receber" — quando o dinheiro cair, registre a entrada em Ofertas para ela ir ao caixa e ao recibo.'
        : S.ehProfessor()
        ? 'Cadastre a mensalidade de cada aluno. Todo mês, no dia de vencimento, a cobrança é lançada automaticamente em "A Receber".'
        : 'Cadastre mensalidades de clientes (academia, escola, plano de serviço…). Todo mês, a cobrança é lançada automaticamente em "A Receber", no dia de vencimento escolhido.'}</p>
      <div class="barra-ferramentas"><div class="cresce"></div>${S.ehProfessor() ? '<button class="btn btn--secundario" id="as-reajustar">Reajustar mensalidades</button>' : ''}<button class="btn" id="as-nova">+ ${S.ehProfessor() ? 'Nova mensalidade' : 'Nova ' + S.rMens()}</button></div>
      <div class="card"><div id="as-lista">Carregando…</div></div>`;
    alvo.querySelector('#as-nova').addEventListener('click', () => form());
    const reaj = alvo.querySelector('#as-reajustar');
    if (reaj) reaj.addEventListener('click', () => FinanceiroReajuste.abrir({ aoConcluir: listar }));
    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('as-lista');
    let assinaturas;
    try { assinaturas = await API.get('/api/financeiro/assinaturas'); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!assinaturas.length) { alvo.innerHTML = `<p class="muted">Nenhuma ${S.rMens()} cadastrada.</p>`; return; }
    const hoje = new Date().toISOString().slice(0, 10);
    const prof = S.ehProfessor();
    const hojeLocal = S.hojeLocal();
    const badgeMes = { recebido: '<span class="badge badge--ok">pago</span>', pendente: '<span class="badge badge--alerta">pendente</span>', atrasada: '<span class="badge badge--erro">em atraso</span>' };
    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>${S.rMantenedor(true)}</th><th>Descrição</th><th>Dia venc.</th>${prof ? '<th>Próx. vencimento</th><th>Mês atual</th>' : ''}<th>Valor</th><th>Vigência</th><th>Status</th><th></th></tr></thead>
      <tbody>${assinaturas.map((a) => {
        const encerrada = a.data_fim && a.data_fim < hoje;
        return `<tr style="${a.ativa && !encerrada ? '' : 'opacity:.55'}">
        <td>${UI.escapar(a.cliente_nome)}</td>
        <td>${UI.escapar(a.descricao)}</td>
        <td>Dia ${a.dia_vencimento}</td>
        ${prof ? `<td>${a.ativa && !encerrada ? S.dataBR(S.proximoVencimento(a.dia_vencimento, hojeLocal)) : '—'}</td>
        <td>${a.ativa && !encerrada ? (badgeMes[a.mes_situacao] || '<span class="badge badge--muted">sem cobrança</span>') : '—'}</td>` : ''}
        <td>${UI.moeda(a.valor)}</td>
        <td>${a.data_inicio ? UI.dataHora(a.data_inicio) : '—'} até ${a.data_fim ? UI.dataHora(a.data_fim) : 'indeterminado'}</td>
        <td>${encerrada ? '<span class="badge badge--muted">Encerrada</span>' : (a.ativa ? (prof && PausaMensalidade.emPausa(a, hojeLocal) ? PausaMensalidade.seloHTML(a, hojeLocal) : '<span class="badge badge--ok">Ativa</span>') : '<span class="badge badge--muted">Pausada</span>')}</td>
        <td style="text-align:right;white-space:nowrap">
          ${prof && a.ativa && !encerrada
            ? (PausaMensalidade.emPausa(a, hojeLocal)
              ? `<button class="btn btn--secundario" data-as-retomar="${a.id}">Retomar</button>`
              : `<button class="btn btn--secundario" data-as-pausar-periodo="${a.id}">Pausar</button>`)
            : `<button class="btn btn--secundario" data-as-pausar="${a.id}" data-ativa="${a.ativa}">${a.ativa ? 'Pausar' : 'Reativar'}</button>`}
          <button class="btn btn--secundario" data-as-editar="${a.id}">Editar</button>
          <button class="btn btn--secundario" data-as-excluir="${a.id}">✕</button>
        </td>
      </tr>`;
      }).join('')}</tbody></table>`;

    alvo.querySelectorAll('[data-as-editar]').forEach((b) => b.addEventListener('click', () => {
      const a = assinaturas.find((x) => x.id === Number(b.dataset.asEditar));
      form(a);
    }));
    alvo.querySelectorAll('[data-as-pausar-periodo]').forEach((b) => b.addEventListener('click', () => {
      PausaMensalidade.abrir({ assinatura: assinaturas.find((x) => x.id === Number(b.dataset.asPausarPeriodo)), aoConcluir: listar });
    }));
    alvo.querySelectorAll('[data-as-retomar]').forEach((b) => b.addEventListener('click', () => {
      PausaMensalidade.retomar(assinaturas.find((x) => x.id === Number(b.dataset.asRetomar)), listar);
    }));
    alvo.querySelectorAll('[data-as-pausar]').forEach((b) => b.addEventListener('click', async () => {
      const ativa = b.dataset.ativa === '1';
      try {
        await API.put(`/api/financeiro/assinaturas/${b.dataset.asPausar}`, { ativa: !ativa });
        UI.sucesso(ativa ? `${S.rMens(true)} pausada.` : `${S.rMens(true)} reativada.`);
        await listar();
      } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-as-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar(`Excluir esta ${S.rMens()}? As cobranças já lançadas em meses anteriores não serão apagadas.`, { titulo: `Excluir ${S.rMens()}`, textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`/api/financeiro/assinaturas/${b.dataset.asExcluir}`); UI.sucesso(`${S.rMens(true)} excluída.`); await listar(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  function form(a) {
    const ehEdicao = !!a;
    Modal.abrir({
      titulo: ehEdicao ? `Editar ${S.rMens()}` : (S.ehProfessor() ? 'Nova mensalidade' : `Nova ${S.rMens()}`), tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>${S.rMantenedor(true)} *</label><select id="as-cliente" ${ehEdicao ? 'disabled' : ''}>
          <option value="">— selecione —</option>${S.state.clientes.map((c) => `<option value="${c.id}" ${a && String(a.cliente_id) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('')}
        </select></div>
        <div class="campo mt-16"><label>Descrição *</label><input id="as-desc" value="${UI.escapar(a ? a.descricao : '')}" placeholder="${S.ehInstituto() ? 'Ex.: Contribuição mensal, Apadrinhamento' : S.ehProfessor() ? 'Ex.: Mensalidade – Matemática' : 'Ex.: Mensalidade academia, Plano manutenção'}" /></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Valor (R$) *</label><input id="as-valor" type="number" step="0.01" min="0" value="${a ? a.valor : ''}" /></div>
          <div class="campo"><label>Dia do vencimento *</label><input id="as-dia" type="number" min="1" max="31" value="${a ? a.dia_vencimento : ''}" /></div>
        </div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Início</label><input id="as-inicio" type="date" value="${a ? a.data_inicio : new Date().toISOString().slice(0, 10)}" /></div>
          <div class="campo"><label>Encerramento <span class="dica">(opcional)</span></label><input id="as-fim" type="date" value="${a && a.data_fim ? a.data_fim : ''}" /></div>
        </div>
        <div class="campo mt-16"><label>Observação</label><input id="as-obs" value="${UI.escapar(a && a.observacao ? a.observacao : '')}" /></div>
        <div class="dica mt-16">Todo mês, no dia informado (ajustado se o mês não tiver esse dia), uma conta a receber é criada automaticamente para ${S.ehInstituto() ? 'o mantenedor' : S.ehProfessor() ? 'o aluno' : 'o cliente'}, dentro do período de vigência.</div>`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        if (ehEdicao) return;
        // No instituto quem paga a contribuicao mensal e' o mantenedor.
        CadastroRapido.ligar(el.querySelector('#as-cliente'), 'cliente', {
          rotulo: S.rMantenedor(), natureza: S.ehInstituto() ? 'mantenedor' : undefined,
          aoCriar: (r) => S.state.clientes.push(r),
        });
      },
      aoConfirmar: async (el) => {
        const dados = {
          cliente_id: el.querySelector('#as-cliente').value || null,
          descricao: el.querySelector('#as-desc').value,
          valor: el.querySelector('#as-valor').value,
          dia_vencimento: el.querySelector('#as-dia').value,
          data_inicio: el.querySelector('#as-inicio').value || null,
          data_fim: el.querySelector('#as-fim').value || null,
          observacao: el.querySelector('#as-obs').value,
        };
        try {
          if (ehEdicao) await API.put(`/api/financeiro/assinaturas/${a.id}`, dados);
          else await API.post('/api/financeiro/assinaturas', dados);
          UI.sucesso(ehEdicao ? `${S.rMens(true)} atualizada.` : `${S.rMens(true)} cadastrada.`);
          await API.post('/api/financeiro/assinaturas/gerar-pendentes', {}).catch(() => {});
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { render, listar, form };
})();
