'use strict';

/** Aba "Fluxo de Caixa": saldos das contas financeiras, extrato e mapa forma→conta. */
window.FinanceiroFluxo = (function () {
  const S = window.FinanceiroShared;
  const filtroFluxo = { conta_financeira_id: '' };
  const NOME_ORIGEM_MOV = { venda: 'Venda', recebimento: 'Recebimento', pagamento: 'Pagamento', ajuste: 'Ajuste', abertura: 'Abertura', oferta: '🤝 Oferta' };

  async function render() {
    const alvo = S.alvoConteudo();
    S.state.contasFin = await API.get('/api/financeiro/contas-financeiras').catch(() => []);
    const hoje = new Date().toISOString().slice(0, 10);
    const mesInicio = hoje.slice(0, 8) + '01';
    alvo.innerHTML = `
      <div class="card mb-16">
        <div class="flex flex--between" style="align-items:center;flex-wrap:wrap;gap:8px">
          <h3 style="margin:0">💰 Saldos das contas</h3>
          <div class="flex gap-12">
            <button class="btn btn--secundario" id="fx-mapa">⚙️ Formas → contas</button>
            <button class="btn" id="fx-nova-conta">+ Nova conta</button>
          </div>
        </div>
        <div id="fx-contas" class="mt-16">Carregando…</div>
      </div>
      <div class="barra-ferramentas">
        <div class="campo"><label class="dica">Conta</label><select id="fx-conta"><option value="">Todas as contas (visão geral)</option>${S.state.contasFin.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label class="dica">De</label><input type="date" id="fx-inicio" value="${mesInicio}"></div>
        <div class="campo"><label class="dica">Até</label><input type="date" id="fx-fim" value="${hoje}"></div>
        <button class="btn btn--secundario" id="fx-aplicar" style="align-self:end">Atualizar</button>
      </div>
      <div id="fx-resultado"></div>`;
    alvo.querySelector('#fx-conta').value = filtroFluxo.conta_financeira_id;
    alvo.querySelector('#fx-aplicar').addEventListener('click', () => { filtroFluxo.conta_financeira_id = document.getElementById('fx-conta').value; carregar(); });
    alvo.querySelector('#fx-nova-conta').addEventListener('click', () => formContaFinanceira());
    alvo.querySelector('#fx-mapa').addEventListener('click', configMapa);
    await carregar();
  }

  async function carregar() {
    const alvo = document.getElementById('fx-resultado');
    const inicio = document.getElementById('fx-inicio').value;
    const fim = document.getElementById('fx-fim').value;
    let fx;
    try {
      const params = new URLSearchParams({ inicio, fim });
      if (filtroFluxo.conta_financeira_id) params.set('conta_financeira_id', filtroFluxo.conta_financeira_id);
      fx = await API.get(`/api/financeiro/fluxo-caixa?${params.toString()}`);
    } catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }

    renderContasCards(fx.contas || [], fx.saldo_total_contas || 0);

    const painelConta = fx.conta_financeira ? `
      <div class="grid grid--cards mb-16">
        <div class="card stat"><span class="stat__label">Saldo no início do período</span><span class="stat__value">${UI.moeda(fx.saldo_inicio_periodo)}</span></div>
        <div class="card stat"><span class="stat__label">Saldo no fim do período</span><span class="stat__value" style="color:${fx.saldo_fim_periodo >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(fx.saldo_fim_periodo)}</span></div>
      </div>
      <p class="dica mb-16">Saldo de <strong>${UI.escapar(fx.conta_financeira.nome)}</strong> no fim do período selecionado — use para conferir com o saldo final do extrato do banco (aba Conciliação) antes de exportar para o contador.</p>` : '';

    alvo.innerHTML = `
      ${painelConta}
      <div class="grid grid--cards mb-16">
        <div class="card stat"><span class="stat__label">Entradas no período</span><span class="stat__value" style="color:var(--sucesso)">${UI.moeda(fx.entradas)}</span></div>
        <div class="card stat"><span class="stat__label">Saídas no período</span><span class="stat__value" style="color:var(--perigo)">${UI.moeda(fx.saidas)}</span></div>
        <div class="card stat"><span class="stat__label">Resultado do período</span><span class="stat__value" style="color:${fx.saldo >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(fx.saldo)}</span></div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Composição do período</h3>
        <table class="tabela">
          ${S.ehInstituto() ? '' : `<tr><td>Vendas à vista (dinheiro, cartão, PIX)</td><td style="text-align:right;color:var(--sucesso)">+ ${UI.moeda(fx.detalhe.vendas_a_vista)}</td></tr>`}
          ${S.ehInstituto() || Number(fx.detalhe.ofertas || 0) > 0 ? `<tr><td>Ofertas e doações recebidas</td><td style="text-align:right;color:var(--sucesso)">+ ${UI.moeda(fx.detalhe.ofertas || 0)}</td></tr>` : ''}
          <tr><td>${S.ehInstituto() ? 'Cobranças recebidas (contribuições, mensalidades)' : 'Recebimentos de contas (a prazo/parcelas)'}</td><td style="text-align:right;color:var(--sucesso)">+ ${UI.moeda(fx.detalhe.recebimentos)}</td></tr>
          <tr><td>${S.ehInstituto() ? 'Despesas pagas' : 'Pagamentos de contas'}</td><td style="text-align:right;color:var(--perigo)">- ${UI.moeda(fx.detalhe.pagamentos)}</td></tr>
        </table>
      </div>`;
  }

  function renderContasCards(contas, saldoTotal) {
    const alvo = document.getElementById('fx-contas');
    if (!alvo) return;
    if (!contas.length) { alvo.innerHTML = '<p class="muted">Nenhuma conta cadastrada. Crie uma conta (banco, caixa, máquina de cartão) para controlar os saldos.</p>'; return; }
    alvo.innerHTML = `
      <div class="grid grid--cards">
        ${contas.map((c) => `
          <div class="card stat" style="gap:6px">
            <span class="stat__label">${(S.TIPOS_CONTA[c.tipo] || S.TIPOS_CONTA.outro)} · ${UI.escapar(c.nome)}</span>
            <span class="stat__value" style="color:${Number(c.saldo_atual) >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(c.saldo_atual)}</span>
            <div class="flex gap-12 mt-16" style="flex-wrap:wrap">
              <button class="btn btn--secundario" data-conta-ajustar="${c.id}">Ajustar saldo</button>
              <button class="btn btn--secundario" data-conta-extrato="${c.id}">Extrato</button>
              <button class="btn btn--secundario" data-conta-editar="${c.id}">Editar</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="flex flex--between mt-16"><span class="muted">Saldo total das contas</span><strong style="font-size:18px;color:${saldoTotal >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(saldoTotal)}</strong></div>`;

    alvo.querySelectorAll('[data-conta-ajustar]').forEach((b) => b.addEventListener('click', () => ajustarSaldoConta(contas.find((c) => c.id === Number(b.dataset.contaAjustar)))));
    alvo.querySelectorAll('[data-conta-extrato]').forEach((b) => b.addEventListener('click', () => verExtrato(contas.find((c) => c.id === Number(b.dataset.contaExtrato)))));
    alvo.querySelectorAll('[data-conta-editar]').forEach((b) => b.addEventListener('click', () => formContaFinanceira(contas.find((c) => c.id === Number(b.dataset.contaEditar)))));
  }

  function formContaFinanceira(conta) {
    const ehEdicao = !!conta;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar conta' : 'Nova conta financeira', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Nome *</label><input id="fc-nome" value="${UI.escapar(conta ? conta.nome : '')}" placeholder="Ex.: Banco Itaú, Caixa, Máquina Cielo" /></div>
        <div class="campo mt-16"><label>Tipo</label><select id="fc-tipo">
          ${Object.entries(S.TIPOS_CONTA).map(([k, v]) => `<option value="${k}" ${conta && conta.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select></div>
        <div class="campo mt-16"><label>Saldo inicial (R$)</label><input id="fc-saldo" type="number" step="0.01" value="${conta ? conta.saldo_inicial : 0}" />
          <div class="dica">Saldo de abertura da conta (o "saldo de entrada"). Depois, use "Ajustar saldo" para correções.</div></div>
        ${ehEdicao ? `<div class="mt-16"><button type="button" class="btn btn--perigo" id="fc-excluir">Excluir conta</button></div>` : ''}`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        const btn = el.querySelector('#fc-excluir');
        if (btn) btn.addEventListener('click', async () => {
          const ok = await UI.confirmar('Excluir esta conta? Se já tiver movimentações, ela será apenas desativada.', { titulo: 'Excluir conta', textoConfirmar: 'Excluir' });
          if (!ok) return;
          try { const r = await API.del(`/api/financeiro/contas-financeiras/${conta.id}`); el.remove(); UI.sucesso(r.inativada ? 'Conta desativada (tinha movimentações).' : 'Conta excluída.'); await carregar(); }
          catch (e) { UI.erro(e.message); }
        });
      },
      aoConfirmar: async (el) => {
        const dados = { nome: el.querySelector('#fc-nome').value, tipo: el.querySelector('#fc-tipo').value, saldo_inicial: el.querySelector('#fc-saldo').value };
        try {
          if (ehEdicao) await API.put(`/api/financeiro/contas-financeiras/${conta.id}`, dados);
          else await API.post('/api/financeiro/contas-financeiras', dados);
          UI.sucesso(ehEdicao ? 'Conta atualizada.' : 'Conta criada.');
          await carregar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  function ajustarSaldoConta(conta) {
    Modal.abrir({
      titulo: `Ajustar saldo — ${conta.nome}`, tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Saldo atual</label><input value="${UI.moeda(conta.saldo_atual)}" disabled /></div>
        <div class="campo mt-16"><label>Novo saldo (R$) *</label><input id="aj-saldo" type="number" step="0.01" value="${conta.saldo_atual}" /></div>
        <div class="campo mt-16"><label>Motivo</label><input id="aj-motivo" placeholder="Ex.: conferência do extrato, sangria, aporte" /></div>
        <div class="dica mt-16">A diferença é registrada no extrato da conta como um ajuste.</div>`,
      textoConfirmar: 'Salvar ajuste',
      aoConfirmar: async (el) => {
        try {
          await API.post(`/api/financeiro/contas-financeiras/${conta.id}/ajustar-saldo`, { saldo: el.querySelector('#aj-saldo').value, motivo: el.querySelector('#aj-motivo').value });
          UI.sucesso('Saldo ajustado.'); await carregar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function verExtrato(conta) {
    const hoje = new Date().toISOString().slice(0, 10);
    const mesInicio = hoje.slice(0, 8) + '01';
    const corpo = `
      <div class="barra-ferramentas mb-16">
        <div class="campo"><label class="dica">De</label><input type="date" id="ve-inicio" value="${mesInicio}"></div>
        <div class="campo"><label class="dica">Até</label><input type="date" id="ve-fim" value="${hoje}"></div>
        <button class="btn btn--secundario" id="ve-aplicar" style="align-self:end">Filtrar</button>
      </div>
      <div id="ve-resultado">Carregando…</div>`;
    Modal.abrir({
      titulo: `Extrato — ${conta.nome}`, tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        const carregarExtrato = async () => {
          const resAlvo = el.querySelector('#ve-resultado');
          const inicio = el.querySelector('#ve-inicio').value;
          const fim = el.querySelector('#ve-fim').value;
          let ext;
          try { ext = await API.get(`/api/financeiro/contas-financeiras/${conta.id}/extrato?inicio=${inicio}&fim=${fim}`); }
          catch (e) { resAlvo.innerHTML = UI.escapar(e.message); return; }
          resAlvo.innerHTML = `
            <div class="grid grid--cards mb-16">
              <div class="card stat"><span class="stat__label">Saldo no início do período</span><span class="stat__value">${UI.moeda(ext.saldo_inicio_periodo)}</span></div>
              <div class="card stat"><span class="stat__label">Saldo no fim do período</span><span class="stat__value" style="color:${ext.saldo_fim_periodo >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(ext.saldo_fim_periodo)}</span></div>
              <div class="card stat"><span class="stat__label">Saldo atual (hoje)</span><span class="stat__value">${UI.moeda(ext.saldo_atual)}</span></div>
            </div>
            ${ext.movimentos.length ? `<table class="tabela">
              <thead><tr><th>Data</th><th>Origem</th><th>Descrição</th><th style="text-align:right">Valor</th></tr></thead>
              <tbody>${ext.movimentos.map((m) => `<tr>
                <td>${UI.dataHora(m.data)}</td>
                <td>${NOME_ORIGEM_MOV[m.origem] || m.origem}</td>
                <td>${UI.escapar(m.descricao || '—')}</td>
                <td style="text-align:right;color:${m.tipo === 'entrada' ? 'var(--sucesso)' : 'var(--perigo)'}">${m.tipo === 'entrada' ? '+' : '-'} ${UI.moeda(m.valor)}</td>
              </tr>`).join('')}</tbody></table>` : '<p class="muted">Sem movimentações neste período.</p>'}`;
        };
        el.querySelector('#ve-aplicar').addEventListener('click', carregarExtrato);
        carregarExtrato();
      },
    });
  }

  async function configMapa() {
    let mapa = {}; let contas = [];
    try { [mapa, contas] = await Promise.all([API.get('/api/financeiro/mapa-contas'), API.get('/api/financeiro/contas-financeiras')]); }
    catch (e) { UI.erro(e.message); return; }
    const opcoes = (sel) => '<option value="">— nenhuma —</option>' + contas.map((c) => `<option value="${c.id}" ${String(sel) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('');
    const corpo = `
      <p class="dica" style="margin-top:0">Escolha em qual conta cada forma de pagamento entra (nas vendas do PDV) ou sai. Você pode sobrescrever na hora de pagar/receber.</p>
      ${Object.entries(S.FORMAS_SALDO).map(([k, v]) => `
        <div class="campo mt-16"><label>${v}</label><select data-mapa="${k}">${opcoes(mapa[k])}</select></div>`).join('')}`;
    Modal.abrir({
      titulo: 'Formas de pagamento → contas', tamanho: 'modal--pequeno', corpoHTML: corpo, textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        const novo = {};
        el.querySelectorAll('[data-mapa]').forEach((s) => { novo[s.dataset.mapa] = s.value || null; });
        try { await API.put('/api/financeiro/mapa-contas', novo); UI.sucesso('Configuração salva.'); }
        catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { render, carregar };
})();
