'use strict';

/** Aba "Conciliação": importação de extrato OFX, regras automáticas e conciliação manual. */
window.FinanceiroConciliacao = (function () {
  const S = window.FinanceiroShared;
  const conciliacaoFiltro = { conta_financeira_id: '', status: 'pendente' };
  const FORMAS_CONCILIACAO = { transferencia: 'Transferência', pix: 'PIX', dinheiro: 'Dinheiro', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito', boleto: 'Boleto' };

  async function render() {
    const alvo = S.alvoConteudo();
    S.state.contasFin = await API.get('/api/financeiro/contas-financeiras').catch(() => []);
    if (!S.state.contasFin.length) {
      alvo.innerHTML = `<div class="card vazio">Cadastre uma conta financeira primeiro (aba "Formas de pagamento → contas" ou no botão de saldos) para poder importar um extrato.
        <div class="campo mt-16" style="max-width:420px;margin:16px auto 0;text-align:left"><label>Conta financeira</label><select id="cc-conta-vazia"></select></div></div>`;
      CadastroRapido.ligar(alvo.querySelector('#cc-conta-vazia'), 'conta', { aoCriar: () => render() });
      return;
    }
    alvo.innerHTML = `
      <div class="card mb-16">
        <div class="flex flex--between" style="align-items:flex-start">
          <h3 style="margin-top:0">Importar extrato (.ofx)</h3>
          <button class="btn btn--secundario" id="cc-regras">⚙️ Regras de conciliação</button>
        </div>
        <p class="dica">Importe o extrato exportado do seu banco (formato OFX) para bater as transações com o que já está lançado — ${S.ehInstituto() ? 'ofertas recebidas e despesas' : 'contas a pagar/receber'} — e já dar baixa nelas. Transações sem par podem ser lançadas automaticamente por uma regra (ex.: "taxa" sempre vira despesa de tarifas bancárias).</p>
        <div class="form-grid">
          <div class="campo"><label>Conta financeira</label><select id="cc-conta">${S.state.contasFin.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Arquivo OFX</label><input type="file" id="cc-arquivo" accept=".ofx" /></div>
        </div>
        <button class="btn mt-16" id="cc-importar">Importar extrato</button>
      </div>
      <div class="barra-ferramentas">
        <select id="cc-filtro-conta"><option value="">Todas as contas</option>${S.state.contasFin.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select>
        <select id="cc-filtro-status">
          <option value="pendente">Pendentes</option>
          <option value="conciliada">Conciliadas</option>
          <option value="ignorada">Ignoradas</option>
          <option value="">Todas</option>
        </select>
        <div class="cresce"></div>
      </div>
      <div class="card"><div id="cc-lista">Carregando…</div></div>`;

    CadastroRapido.ligar(alvo.querySelector('#cc-conta'), 'conta', {
      irmaos: [alvo.querySelector('#cc-filtro-conta')],
      aoCriar: (r) => S.state.contasFin.push(r),
    });
    alvo.querySelector('#cc-importar').addEventListener('click', importarExtratoOfx);
    alvo.querySelector('#cc-regras').addEventListener('click', gerenciarRegrasConciliacao);
    alvo.querySelector('#cc-filtro-conta').addEventListener('change', (e) => { conciliacaoFiltro.conta_financeira_id = e.target.value; listar(); });
    alvo.querySelector('#cc-filtro-status').addEventListener('change', (e) => { conciliacaoFiltro.status = e.target.value; listar(); });
    await listar();
  }

  async function importarExtratoOfx() {
    const contaId = document.getElementById('cc-conta').value;
    const arquivo = document.getElementById('cc-arquivo').files[0];
    if (!contaId) { UI.erro('Selecione a conta financeira.'); return; }
    if (!arquivo) { UI.erro('Selecione o arquivo .ofx.'); return; }
    const fd = new FormData();
    fd.append('conta_financeira_id', contaId);
    fd.append('ofx', arquivo);
    try {
      const r = await API.post('/api/conciliacao/importar', fd);
      UI.sucesso(`${r.importadas} transação(ões) importada(s)${r.duplicadas ? ` — ${r.duplicadas} já tinha(m) sido importada(s) antes` : ''}${r.autoConciliadas ? ` — ${r.autoConciliadas} conciliada(s) automaticamente por regra` : ''}.`);
      document.getElementById('cc-arquivo').value = '';
      await listar();
    } catch (e) { UI.erro(e.message); }
  }

  async function listar() {
    const alvo = document.getElementById('cc-lista');
    if (!alvo) return;
    const params = new URLSearchParams();
    if (conciliacaoFiltro.conta_financeira_id) params.set('conta_financeira_id', conciliacaoFiltro.conta_financeira_id);
    if (conciliacaoFiltro.status) params.set('status', conciliacaoFiltro.status);
    let transacoes;
    try { transacoes = await API.get('/api/conciliacao?' + params.toString()); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!transacoes.length) { alvo.innerHTML = '<p class="muted">Nenhuma transação neste filtro.</p>'; return; }

    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Valor</th><th>Status</th><th></th></tr></thead>
      <tbody>${transacoes.map((t) => `<tr>
        <td>${UI.dataHora(t.data)}</td>
        <td>${UI.escapar(t.descricao)}${t.regra_padrao ? ` <span class="badge badge--muted" title="Conciliado automaticamente pela regra &quot;${UI.escapar(t.regra_padrao)}&quot;">🤖 automático</span>` : ''}${t.pagar_descricao ? `<div class="dica">↳ ${UI.escapar(t.pagar_descricao)}</div>` : ''}${t.receber_descricao ? `<div class="dica">↳ ${UI.escapar(t.receber_descricao)}</div>` : ''}${t.oferta_descricao ? `<div class="dica">↳ ${UI.escapar(t.oferta_descricao)}</div>` : ''}</td>
        <td><span class="chip-forma">${t.tipo === 'credito' ? '🟢 Crédito' : '🔴 Débito'}</span></td>
        <td>${UI.moeda(t.valor)}</td>
        <td>${t.status === 'pendente' ? '<span class="badge badge--alerta">Pendente</span>' : t.status === 'conciliada' ? '<span class="badge badge--ok">Conciliada</span>' : '<span class="badge badge--muted">Ignorada</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          ${t.status === 'pendente' ? `<button class="btn" data-conciliar="${t.id}">Conciliar</button><button class="btn btn--secundario" data-ignorar="${t.id}">Ignorar</button>` : `<button class="btn btn--secundario" data-reabrir="${t.id}">Reabrir</button>`}
        </td>
      </tr>`).join('')}</tbody></table>`;

    alvo.querySelectorAll('[data-conciliar]').forEach((b) => b.addEventListener('click', () => {
      const t = transacoes.find((x) => x.id === Number(b.dataset.conciliar));
      formConciliar(t);
    }));
    alvo.querySelectorAll('[data-ignorar]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Ignorar esta transação? Ela não vai gerar nenhum lançamento.', { titulo: 'Ignorar transação', textoConfirmar: 'Ignorar' });
      if (!ok) return;
      try { await API.post(`/api/conciliacao/${b.dataset.ignorar}/ignorar`, {}); await listar(); } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-reabrir]').forEach((b) => b.addEventListener('click', async () => {
      try { await API.post(`/api/conciliacao/${b.dataset.reabrir}/reabrir`, {}); UI.sucesso('Transação reaberta.'); await listar(); } catch (e) { UI.erro(e.message); }
    }));
  }

  async function gerenciarRegrasConciliacao() {
    let regras = await API.get('/api/conciliacao/regras').catch(() => []);
    let editandoId = null;

    const corpo = `
      <p class="dica mb-16">Quando uma transação do extrato não bater com nenhuma conta pendente, o sistema procura por esses termos na descrição e já lança automaticamente na categoria/fornecedor ou cliente escolhido (o que também aparece no DRE).</p>
      <form id="rc-form">
        <div class="form-grid">
          <div class="campo"><label>Termo(s) na descrição</label><input id="rc-padrao" placeholder="ex.: taxa, tarifa" required /></div>
          <div class="campo"><label>Lança como</label><select id="rc-tipo"><option value="pagar">Despesa (a pagar)</option><option value="receber">Receita (a receber)</option></select></div>
        </div>
        <div id="rc-campos-pagar" class="form-grid mt-16">
          <div class="campo"><label>Categoria (DRE)</label><select id="rc-categoria"><option value="">— sem categoria —</option>${S.state.categoriasDespesa.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Fornecedor</label><select id="rc-fornecedor"><option value="">—</option>${S.state.fornecedores.map((f) => `<option value="${f.id}">${UI.escapar(f.nome)}</option>`).join('')}</select></div>
        </div>
        <div id="rc-campos-receber" class="campo mt-16" style="display:none"><label>Cliente</label><select id="rc-cliente"><option value="">—</option>${S.state.clientes.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select></div>
        <div class="campo mt-16"><label>Descrição do lançamento (opcional)</label><input id="rc-descricao" placeholder="Se vazio, usa a descrição do próprio banco" /></div>
        <div class="flex gap-12 mt-16" style="align-items:center">
          <button class="btn" type="submit" id="rc-salvar">Adicionar regra</button>
          <button class="btn btn--secundario" type="button" id="rc-cancelar" style="display:none">Cancelar edição</button>
        </div>
      </form>
      <hr class="mt-16 mb-16" />
      <div id="rc-lista"></div>`;

    Modal.abrir({
      titulo: 'Regras de conciliação', tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        CadastroRapido.ligar(el.querySelector('#rc-categoria'), 'categoria_despesa', { aoCriar: (r) => S.state.categoriasDespesa.push(r) });
        CadastroRapido.ligar(el.querySelector('#rc-fornecedor'), 'fornecedor', { aoCriar: (r) => S.state.fornecedores.push(r) });
        CadastroRapido.ligar(el.querySelector('#rc-cliente'), 'cliente', { aoCriar: (r) => S.state.clientes.push(r) });
        const tipoSel = el.querySelector('#rc-tipo');
        const alternarCampos = () => {
          const pagar = tipoSel.value === 'pagar';
          el.querySelector('#rc-campos-pagar').style.display = pagar ? '' : 'none';
          el.querySelector('#rc-campos-receber').style.display = pagar ? 'none' : '';
        };
        tipoSel.addEventListener('change', alternarCampos);
        alternarCampos();

        const limparForm = () => {
          editandoId = null;
          el.querySelector('#rc-form').reset();
          alternarCampos();
          el.querySelector('#rc-salvar').textContent = 'Adicionar regra';
          el.querySelector('#rc-cancelar').style.display = 'none';
        };

        const render = () => {
          el.querySelector('#rc-lista').innerHTML = regras.length ? `<table class="tabela">
            <thead><tr><th>Termo(s)</th><th>Lança como</th><th>Destino</th><th>Ativa?</th><th></th></tr></thead>
            <tbody>${regras.map((r) => `<tr>
              <td>${UI.escapar(r.padrao)}</td>
              <td>${r.tipo === 'pagar' ? 'Despesa' : 'Receita'}</td>
              <td>${UI.escapar(r.categoria_nome || r.fornecedor_nome || r.cliente_nome || '—')}</td>
              <td>${r.ativa ? '<span class="badge badge--ok">Sim</span>' : '<span class="badge badge--muted">Pausada</span>'}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn--secundario" data-rc-editar="${r.id}">Editar</button>
                <button class="btn btn--secundario" data-rc-pausar="${r.id}">${r.ativa ? 'Pausar' : 'Ativar'}</button>
                <button class="btn btn--secundario" data-rc-del="${r.id}">✕</button>
              </td>
            </tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhuma regra cadastrada.</p>';

          el.querySelectorAll('[data-rc-editar]').forEach((b) => b.addEventListener('click', () => {
            const r = regras.find((x) => x.id === Number(b.dataset.rcEditar));
            if (!r) return;
            editandoId = r.id;
            el.querySelector('#rc-padrao').value = r.padrao;
            el.querySelector('#rc-tipo').value = r.tipo;
            alternarCampos();
            el.querySelector('#rc-categoria').value = r.categoria_despesa_id || '';
            el.querySelector('#rc-fornecedor').value = r.fornecedor_id || '';
            el.querySelector('#rc-cliente').value = r.cliente_id || '';
            el.querySelector('#rc-descricao').value = r.descricao_lancamento || '';
            el.querySelector('#rc-salvar').textContent = 'Salvar edição';
            el.querySelector('#rc-cancelar').style.display = '';
            el.querySelector('#rc-padrao').focus();
          }));
          el.querySelectorAll('[data-rc-pausar]').forEach((b) => b.addEventListener('click', async () => {
            const r = regras.find((x) => x.id === Number(b.dataset.rcPausar));
            if (!r) return;
            try { await API.put(`/api/conciliacao/regras/${r.id}`, { ativa: !r.ativa }); regras = await API.get('/api/conciliacao/regras'); render(); }
            catch (e) { UI.erro(e.message); }
          }));
          el.querySelectorAll('[data-rc-del]').forEach((b) => b.addEventListener('click', async () => {
            const ok = await UI.confirmar('Excluir esta regra?', { titulo: 'Excluir regra', textoConfirmar: 'Excluir' });
            if (!ok) return;
            try {
              await API.del(`/api/conciliacao/regras/${b.dataset.rcDel}`);
              regras = await API.get('/api/conciliacao/regras');
              if (editandoId === Number(b.dataset.rcDel)) limparForm();
              render();
              UI.sucesso('Regra excluída.');
            } catch (e) { UI.erro(e.message); }
          }));
        };
        render();

        el.querySelector('#rc-cancelar').addEventListener('click', limparForm);
        el.querySelector('#rc-form').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const tipo = tipoSel.value;
          const dados = {
            padrao: el.querySelector('#rc-padrao').value,
            tipo,
            descricao_lancamento: el.querySelector('#rc-descricao').value || null,
            categoria_despesa_id: tipo === 'pagar' ? (el.querySelector('#rc-categoria').value || null) : null,
            fornecedor_id: tipo === 'pagar' ? (el.querySelector('#rc-fornecedor').value || null) : null,
            cliente_id: tipo === 'receber' ? (el.querySelector('#rc-cliente').value || null) : null,
          };
          try {
            if (editandoId) await API.put(`/api/conciliacao/regras/${editandoId}`, dados);
            else await API.post('/api/conciliacao/regras', dados);
            regras = await API.get('/api/conciliacao/regras');
            limparForm();
            render();
            UI.sucesso('Regra salva.');
          } catch (e) { UI.erro(e.message); }
        });
      },
    });
  }

  function opcaoContaHTML(s, tipo, marcada) {
    const diferenca = Math.abs(Number(s.valor) - Number(s.__valorTransacao || 0));
    const ehOferta = s.origem_registro === 'oferta';
    // A oferta ja entrou no caixa quando foi registrada: conciliar so amarra
    // com o extrato, nunca lanca o valor de novo.
    const statusTxt = ehOferta
      ? '<span class="badge badge--ok">🤝 Oferta — já está no caixa</span>'
      : (s.status === 'pendente' ? '<span class="badge badge--alerta">Pendente</span>' : `<span class="badge badge--ok">${tipo === 'pagar' ? 'Paga' : 'Recebida'} — só amarra com o extrato</span>`);
    return `
      <label class="flex gap-12" style="align-items:center;padding:8px 0;border-bottom:1px solid var(--borda)">
        <input type="radio" name="cc-opcao" value="${s.id}" data-origem="${ehOferta ? 'oferta' : 'conta'}" ${marcada ? 'checked' : ''} />
        <span class="cresce">${UI.escapar(s.descricao)}${s.contraparte_nome ? ' — ' + UI.escapar(s.contraparte_nome) : ''}
          <span class="dica">${s.vencimento ? 'vence ' + s.vencimento : ''} — ${UI.moeda(s.valor)}${diferenca > 0.01 ? ` <span style="color:var(--perigo)">(diferença de ${UI.moeda(diferenca)})</span>` : ''}</span>
        </span>
        ${statusTxt}
      </label>`;
  }

  async function formConciliar(t) {
    let sugestoes;
    try { sugestoes = await API.get(`/api/conciliacao/${t.id}/sugestoes`); } catch (e) { UI.erro(e.message); return; }
    const tipo = t.tipo === 'debito' ? 'pagar' : 'receber';
    sugestoes.forEach((s) => { s.__valorTransacao = t.valor; });

    const corpo = `
      <div class="card mb-16">
        <div class="flex flex--between"><strong>${UI.escapar(t.descricao)}</strong><strong>${UI.moeda(t.valor)}</strong></div>
        <div class="dica">${UI.dataHora(t.data)} · ${t.tipo === 'credito' ? 'Entrada (crédito)' : 'Saída (débito)'}</div>
      </div>
      ${sugestoes.length ? `
      <div class="campo"><label>Bate com uma conta já cadastrada?</label></div>
      <div id="cc-sugestoes">${sugestoes.map((s, idx) => opcaoContaHTML(s, tipo, idx === 0)).join('')}</div>` : '<div class="dica mb-16">Nenhuma conta pendente com esse valor.</div>'}

      <div class="campo mt-16"><label>🔍 Buscar ${tipo === 'pagar' ? 'outra despesa' : (S.ehInstituto() ? 'outra oferta ou cobrança' : 'outra conta a receber')}</label></div>
      <div class="barra-ferramentas" style="margin-bottom:8px">
        <input type="search" id="cc-busca-termo" class="cresce" placeholder="Buscar por descrição…" />
        <select id="cc-busca-status">
          <option value="">Pendentes e pagas</option>
          <option value="pendente">Só pendentes</option>
          <option value="pago">Só já ${tipo === 'pagar' ? 'pagas' : 'recebidas'}</option>
        </select>
        <button type="button" class="btn btn--secundario" id="cc-busca-btn">Buscar</button>
      </div>
      <div id="cc-busca-resultados" class="mb-16"></div>

      <label class="flex gap-12" style="align-items:center;padding:8px 0">
        <input type="radio" name="cc-opcao" value="novo" ${sugestoes.length ? '' : 'checked'} />
        <span>Nenhuma dessas — criar um lançamento novo</span>
      </label>

      <div id="cc-form-novo" class="mt-16" style="${sugestoes.length ? 'display:none' : ''}">
        <div class="campo"><label>Descrição</label><input id="cc-nova-desc" value="${UI.escapar(t.descricao)}" /></div>
        ${tipo === 'pagar' ? `
        <div class="form-grid mt-16">
          <div class="campo"><label>Fornecedor</label><select id="cc-nova-forn"><option value="">—</option>${S.state.fornecedores.map((f) => `<option value="${f.id}">${UI.escapar(f.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Categoria (DRE)</label><select id="cc-nova-cat"><option value="">— sem categoria —</option>${S.state.categoriasDespesa.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select></div>
        </div>` : `
        <div class="campo mt-16"><label>Cliente</label><select id="cc-nova-cliente"><option value="">—</option>${S.state.clientes.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select></div>`}
      </div>
      <div class="campo mt-16"><label>Forma de pagamento</label><select id="cc-forma">${Object.entries(FORMAS_CONCILIACAO).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>`;

    Modal.abrir({
      titulo: `Conciliar — ${tipo === 'pagar' ? 'a pagar' : 'a receber'}`, tamanho: 'modal--grande', corpoHTML: corpo, textoConfirmar: 'Confirmar',
      aoAbrir: (el) => {
        CadastroRapido.ligar(el.querySelector('#cc-nova-forn'), 'fornecedor', { aoCriar: (r) => S.state.fornecedores.push(r) });
        CadastroRapido.ligar(el.querySelector('#cc-nova-cat'), 'categoria_despesa', { aoCriar: (r) => S.state.categoriasDespesa.push(r) });
        CadastroRapido.ligar(el.querySelector('#cc-nova-cliente'), 'cliente', { aoCriar: (r) => S.state.clientes.push(r) });
        // Delegacao: cobre tanto os radios que ja vem no HTML quanto os que a busca adicionar depois.
        el.addEventListener('change', (e) => {
          if (e.target.name !== 'cc-opcao') return;
          const sel = el.querySelector('input[name="cc-opcao"]:checked');
          el.querySelector('#cc-form-novo').style.display = sel && sel.value === 'novo' ? '' : 'none';
        });

        el.querySelector('#cc-busca-btn').addEventListener('click', async () => {
          const termo = el.querySelector('#cc-busca-termo').value.trim();
          const status = el.querySelector('#cc-busca-status').value;
          const resAlvo = el.querySelector('#cc-busca-resultados');
          resAlvo.innerHTML = 'Buscando…';
          try {
            const params = new URLSearchParams();
            if (termo) params.set('termo', termo);
            if (status) params.set('status', status);
            const achadas = await API.get(`/api/conciliacao/${t.id}/buscar?${params.toString()}`);
            achadas.forEach((s) => { s.__valorTransacao = t.valor; });
            resAlvo.innerHTML = achadas.length
              ? achadas.map((s) => opcaoContaHTML(s, tipo, false)).join('')
              : '<p class="muted">Nenhuma conta encontrada.</p>';
          } catch (e) { resAlvo.innerHTML = UI.escapar(e.message); }
        });
      },
      aoConfirmar: async (el) => {
        const opcaoSel = el.querySelector('input[name="cc-opcao"]:checked');
        const forma = el.querySelector('#cc-forma').value;
        try {
          if (opcaoSel && opcaoSel.value !== 'novo') {
            const alvoTipo = opcaoSel.dataset.origem === 'oferta' ? 'oferta' : tipo;
            await API.post(`/api/conciliacao/${t.id}/conciliar`, { tipo: alvoTipo, conta_id: Number(opcaoSel.value), forma });
            UI.sucesso(alvoTipo === 'oferta' ? 'Oferta amarrada ao extrato.' : 'Conciliado.');
          } else {
            const dados = { tipo, descricao: el.querySelector('#cc-nova-desc').value, forma };
            if (tipo === 'pagar') {
              dados.fornecedor_id = el.querySelector('#cc-nova-forn').value || null;
              dados.categoria_despesa_id = el.querySelector('#cc-nova-cat').value || null;
            } else {
              dados.cliente_id = el.querySelector('#cc-nova-cliente').value || null;
            }
            await API.post(`/api/conciliacao/${t.id}/novo-lancamento`, dados);
            UI.sucesso('Lançamento criado e conciliado.');
          }
          await listar(); S.carregarAlertas();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { render, listar };
})();
