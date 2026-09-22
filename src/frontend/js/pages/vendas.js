'use strict';

/**
 * Pagina de Vendas: historico com filtros (periodo, forma de pagamento,
 * produto), detalhe da venda e cancelamento/estorno.
 * A realizacao de novas vendas fica no PDV.
 */
window.PaginaVendas = (function () {
  const FORMAS = {
    dinheiro: 'Dinheiro', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito',
    pix: 'PIX', prazo: 'A prazo',
  };
  const FORMAS_DEVOLUCAO = { dinheiro: 'Dinheiro', pix: 'PIX', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito' };
  const arred = (v) => Math.round(Number(v) * 100) / 100;
  const ehInstituto = () => window.__ramoServico === 'instituto';

  async function render(container) {
    const hoje = new Date().toISOString().slice(0, 10);
    const mesInicio = hoje.slice(0, 8) + '01';
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="campo"><label class="dica">De</label><input type="date" id="f-inicio" value="${mesInicio}"></div>
        <div class="campo"><label class="dica">Até</label><input type="date" id="f-fim" value="${hoje}"></div>
        <div class="campo"><label class="dica">Forma</label>
          <select id="f-forma"><option value="">Todas</option>${Object.entries(FORMAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        </div>
        <div class="campo"><label class="dica">Status</label>
          <select id="f-status"><option value="">Todas</option><option value="concluida">Concluídas</option><option value="cancelada">Canceladas</option></select>
        </div>
        <button class="btn btn--secundario" id="f-aplicar" style="align-self:end">Filtrar</button>
        <div class="cresce"></div>
        <button class="btn" id="btn-nova" style="align-self:end">🛒 Nova venda (PDV)</button>
      </div>
      <div id="resumo-vendas" class="grid grid--cards mb-16"></div>
      <div class="card"><div id="lista-vendas">Carregando…</div></div>`;

    container.querySelector('#f-aplicar').addEventListener('click', listar);
    container.querySelector('#btn-nova').addEventListener('click', () => { location.hash = '#/pdv'; });
    await listar();
  }

  function filtros() {
    return {
      inicio: val('f-inicio'), fim: val('f-fim'),
      forma_pagamento: val('f-forma'), status: val('f-status'),
    };
  }
  function val(id) { const e = document.getElementById(id); return e ? e.value : ''; }

  async function listar() {
    const alvo = document.getElementById('lista-vendas');
    const f = filtros();
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v); });
    let vendas;
    try { vendas = await API.get('/api/vendas?' + params.toString()); }
    catch (e) { alvo.innerHTML = `<span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}`; return; }

    // Resumo
    const concl = vendas.filter((v) => v.status === 'concluida');
    const totalPeriodo = concl.reduce((s, v) => s + Number(v.valor_total), 0);
    document.getElementById('resumo-vendas').innerHTML = `
      ${cardStat('Vendas concluídas', concl.length)}
      ${cardStat('Faturamento', UI.moeda(totalPeriodo))}
      ${cardStat('Ticket médio', UI.moeda(concl.length ? totalPeriodo / concl.length : 0))}
      ${cardStat('Canceladas', vendas.filter((v) => v.status === 'cancelada').length)}`;

    if (!vendas.length) { alvo.innerHTML = '<p class="muted">Nenhuma venda no período.</p>'; return; }
    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>#</th><th>Data</th><th>Itens</th><th>Formas</th><th>Total</th><th>Status</th><th></th></tr></thead>
      <tbody>${vendas.map((v) => `<tr style="${v.status === 'cancelada' ? 'opacity:.55' : ''}">
        <td>${v.id}</td>
        <td>${UI.dataHora(v.data)}</td>
        <td>${v.total_itens}</td>
        <td>${(v.formas || '').split(', ').filter(Boolean).map((x) => `<span class="chip-forma">${FORMAS[x] || x}</span>`).join('')}</td>
        <td>${UI.moeda(v.valor_total)}</td>
        <td>${v.status === 'concluida' ? '<span class="badge badge--ok">Concluída</span>' : '<span class="badge badge--erro">Cancelada</span>'}</td>
        <td style="text-align:right"><button class="btn btn--secundario" data-ver="${v.id}">Detalhes</button></td>
      </tr>`).join('')}</tbody></table>`;
    alvo.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => verVenda(Number(b.dataset.ver))));
  }

  function cardStat(label, valor) {
    return `<div class="card stat"><span class="stat__label">${label}</span><span class="stat__value" style="font-size:22px">${valor}</span></div>`;
  }

  async function verVenda(id) {
    let v, notas, devolucoes;
    try {
      [v, notas, devolucoes] = await Promise.all([
        API.get('/api/vendas/' + id),
        API.get('/api/fiscal/vendas/' + id + '/notas').catch(() => []),
        API.get('/api/devolucoes?venda_id=' + id).catch(() => []),
      ]);
    } catch (e) { UI.erro(e.message); return; }
    const temDisponivel = v.itens.some((i) => arred(Number(i.quantidade) - Number(i.quantidade_devolvida || 0)) > 0.0001);
    // Produto (NFC-e) e servico (NFS-e) sao documentos fiscais diferentes —
    // uma venda pode ter os dois ao mesmo tempo, entao cada um tem seu
    // proprio cartao, independente.
    const temProduto = v.itens.some((i) => !i.eh_servico);
    const temServico = v.itens.some((i) => i.eh_servico);
    const notaNfce = notas.filter((n) => n.tipo !== 'nfse').find((n) => n.status === 'autorizada' || n.status === 'processando')
      || notas.find((n) => n.tipo !== 'nfse');
    const notaNfse = notas.filter((n) => n.tipo === 'nfse').find((n) => n.status === 'autorizada' || n.status === 'processando')
      || notas.find((n) => n.tipo === 'nfse');
    const corpo = `
      <div class="flex flex--between mb-16">
        <div><strong>Venda #${v.id}</strong><div class="dica">${UI.dataHora(v.data)}</div></div>
        <div>${v.status === 'concluida' ? '<span class="badge badge--ok">Concluída</span>' : '<span class="badge badge--erro">Cancelada</span>'}</div>
      </div>
      <table class="tabela">
        <thead><tr><th>Produto</th><th>Qtd</th><th>Preço</th><th>Desc.</th><th>Total</th></tr></thead>
        <tbody>${v.itens.map((i) => `<tr>
          <td>${UI.escapar(i.descricao || '—')}${Number(i.quantidade_devolvida) > 0 ? ` <span class="badge badge--muted" title="Quantidade já devolvida">↩️ ${UI.numero(i.quantidade_devolvida)}</span>` : ''}</td><td>${UI.numero(i.quantidade)}</td>
          <td>${UI.moeda(i.preco_unitario)}</td><td>${UI.moeda(i.desconto_item)}</td><td>${UI.moeda(i.valor_total)}</td>
        </tr>`).join('')}</tbody>
      </table>
      <div class="flex flex--between mt-16"><span>Subtotal</span><span>${UI.moeda(v.valor_bruto)}</span></div>
      <div class="flex flex--between"><span>Desconto</span><span>- ${UI.moeda(v.desconto)}</span></div>
      <div class="flex flex--between"><strong>Total</strong><strong>${UI.moeda(v.valor_total)}</strong></div>
      <h3 class="mt-16">Pagamentos</h3>
      ${v.pagamentos.map((p) => `<div class="flex flex--between"><span class="chip-forma">${FORMAS[p.forma_pagamento] || p.forma_pagamento}</span><span>${UI.moeda(p.valor)}</span></div>`).join('')}
      ${v.observacao ? `<p class="muted mt-16">${UI.escapar(v.observacao)}</p>` : ''}
      ${devolucoes.length ? `<h3 class="mt-16">↩️ Devoluções / trocas</h3>
      ${devolucoes.map((d) => `<div class="flex flex--between"><span class="dica">${UI.dataHora(d.data)}${d.motivo ? ' — ' + UI.escapar(d.motivo) : ''}</span><span>${UI.moeda(d.valor_devolvido)}</span></div>`).join('')}` : ''}
      ${v.status === 'concluida' && temProduto ? `<h3 class="mt-16">🧾 NFC-e (produto)</h3>
      <div id="vd-fiscal-nfce">${situacaoFiscalHTML(notaNfce, 'nfce')}</div>` : ''}
      ${v.status === 'concluida' && temServico ? `<h3 class="mt-16">🧾 NFS-e (serviço)</h3>
      <div id="vd-fiscal-nfse">${situacaoFiscalHTML(notaNfse, 'nfse')}</div>` : ''}`;

    Modal.abrir({
      titulo: 'Detalhes da venda', tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        const foot = el.querySelector('.modal__foot');
        if (v.status === 'concluida') {
          if (temDisponivel) {
            const btnDev = document.createElement('button');
            btnDev.className = 'btn btn--secundario'; btnDev.textContent = '↩️ Devolver / trocar item';
            btnDev.addEventListener('click', () => { el.remove(); formDevolucao(v); });
            foot.insertBefore(btnDev, foot.firstChild);
          }
          const btn = document.createElement('button');
          btn.className = 'btn btn--perigo'; btn.textContent = 'Cancelar / estornar venda';
          btn.addEventListener('click', async () => {
            const ok = await UI.confirmar('Cancelar esta venda? O estoque dos itens será devolvido.', { titulo: 'Cancelar venda', textoConfirmar: 'Cancelar venda' });
            if (!ok) return;
            try { await API.post(`/api/vendas/${v.id}/cancelar`, {}); UI.sucesso('Venda cancelada e estoque devolvido.'); el.remove(); await listar(); }
            catch (e) { UI.erro(e.message); }
          });
          foot.insertBefore(btn, foot.firstChild);
        }
        if (ehInstituto()) {
          // So no instituto (que nao usa venda de verdade) faz sentido apagar
          // de vez: fora dele a venda cancelada continua valendo como
          // registro/auditoria, mesmo sem efeito no estoque/financeiro.
          const btnExcluir = document.createElement('button');
          btnExcluir.className = 'btn btn--perigo'; btnExcluir.textContent = '🗑️ Excluir venda de teste';
          btnExcluir.addEventListener('click', async () => {
            const ok = await UI.confirmar('Excluir esta venda de teste? Isso apaga o registro de vez, sem volta.', { titulo: 'Excluir venda', textoConfirmar: 'Excluir' });
            if (!ok) return;
            try { await API.del(`/api/vendas/${v.id}`); UI.sucesso('Venda excluída.'); el.remove(); await listar(); }
            catch (e) { UI.erro(e.message); }
          });
          foot.insertBefore(btnExcluir, foot.firstChild);
        }
        ligarAcoesFiscais(el, v.id);
      },
    });
  }

  // ------------------------ Devolução / troca -------------------------
  function formDevolucao(v) {
    const devolverForm = v.itens
      .map((i) => ({
        venda_item_id: i.id, descricao: i.descricao,
        disponivel: arred(Number(i.quantidade) - Number(i.quantidade_devolvida || 0)),
        valorUnitario: arred(Number(i.valor_total) / Number(i.quantidade)),
        quantidade: 0,
      }))
      .filter((i) => i.disponivel > 0.0001);
    if (!devolverForm.length) { UI.erro('Todos os itens desta venda já foram devolvidos.'); return; }
    let trocaForm = [];

    const corpo = `
      <p class="dica mb-16">Informe a quantidade de cada item que o cliente está devolvendo. Se ele for levar outro produto no lugar, adicione em "Troca por outro produto".</p>
      <table class="tabela">
        <thead><tr><th>Item</th><th style="width:110px">Disponível</th><th style="width:110px">Devolver</th></tr></thead>
        <tbody id="dv-itens">${devolverForm.map((i, idx) => `<tr>
          <td>${UI.escapar(i.descricao)}</td>
          <td>${UI.numero(i.disponivel)}</td>
          <td><input type="number" min="0" max="${i.disponivel}" step="0.001" value="0" data-dvq="${idx}" style="width:90px" /></td>
        </tr>`).join('')}</tbody>
      </table>
      <div class="campo mt-16"><label>Motivo (opcional)</label><input id="dv-motivo" placeholder="Ex.: produto com defeito, tamanho errado…" /></div>

      <div class="campo mt-16"><label>Troca por outro produto <span class="dica">(opcional — deixe em branco para devolução simples)</span></label>
        <div style="position:relative">
          <input id="dv-troca-busca" placeholder="🔍 Buscar produto…" autocomplete="off" style="width:100%" />
          <div id="dv-troca-res"></div>
        </div>
        <table class="tabela mt-16"><thead><tr><th>Produto</th><th style="width:80px">Qtd</th><th style="width:110px">Preço</th><th style="width:40px"></th></tr></thead>
          <tbody id="dv-troca-itens"><tr><td colspan="4" class="muted">Nenhum item de troca.</td></tr></tbody></table>
      </div>

      <div class="card mt-16" id="dv-resumo"></div>

      <div class="campo mt-16" id="dv-forma-wrap"><label id="dv-forma-label">Forma de pagamento da diferença</label>
        <select id="dv-forma">${Object.entries(FORMAS_DEVOLUCAO).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      </div>`;

    Modal.abrir({
      titulo: `Devolução / troca — venda #${v.id}`, tamanho: 'modal--grande', corpoHTML: corpo, textoConfirmar: 'Confirmar',
      aoAbrir: (el) => {
        function recalcResumo() {
          const valorDevolvido = arred(devolverForm.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0));
          const valorTroca = arred(trocaForm.reduce((s, i) => s + i.quantidade * i.preco_unitario, 0));
          const diferenca = arred(valorDevolvido - valorTroca);
          el.querySelector('#dv-resumo').innerHTML = `
            <div class="flex flex--between"><span>Valor devolvido</span><span>${UI.moeda(valorDevolvido)}</span></div>
            <div class="flex flex--between"><span>Valor dos itens de troca</span><span>${UI.moeda(valorTroca)}</span></div>
            <div class="flex flex--between"><strong>${diferenca >= 0 ? 'A devolver ao cliente' : 'Cliente paga a diferença'}</strong><strong>${UI.moeda(Math.abs(diferenca))}</strong></div>`;
          const formaWrap = el.querySelector('#dv-forma-wrap');
          formaWrap.style.display = Math.abs(diferenca) > 0.004 ? '' : 'none';
          el.querySelector('#dv-forma-label').textContent = diferenca >= 0 ? 'Forma de reembolso da diferença' : 'Forma de pagamento da diferença';
        }
        el.querySelectorAll('[data-dvq]').forEach((inp) => inp.addEventListener('input', () => {
          const idx = Number(inp.dataset.dvq);
          let q = Number(inp.value || 0);
          if (q < 0) q = 0;
          if (q > devolverForm[idx].disponivel) q = devolverForm[idx].disponivel;
          devolverForm[idx].quantidade = q;
          recalcResumo();
        }));

        function renderTroca() {
          const tb = el.querySelector('#dv-troca-itens');
          tb.innerHTML = trocaForm.length ? trocaForm.map((i, idx) => `<tr>
            <td>${UI.escapar(i.descricao)}</td>
            <td><input type="number" step="0.001" min="0.001" value="${i.quantidade}" data-tq="${idx}" style="width:70px" /></td>
            <td><input type="number" step="0.01" min="0" value="${i.preco_unitario}" data-tp="${idx}" style="width:100px" /></td>
            <td><button type="button" class="btn btn--secundario" data-trm="${idx}">✕</button></td>
          </tr>`).join('') : '<tr><td colspan="4" class="muted">Nenhum item de troca.</td></tr>';
          tb.querySelectorAll('[data-tq]').forEach((inp) => inp.addEventListener('input', () => { trocaForm[Number(inp.dataset.tq)].quantidade = Number(inp.value || 0); recalcResumo(); }));
          tb.querySelectorAll('[data-tp]').forEach((inp) => inp.addEventListener('input', () => { trocaForm[Number(inp.dataset.tp)].preco_unitario = Number(inp.value || 0); recalcResumo(); }));
          tb.querySelectorAll('[data-trm]').forEach((b) => b.addEventListener('click', () => { trocaForm.splice(Number(b.dataset.trm), 1); renderTroca(); recalcResumo(); }));
        }

        const busca = el.querySelector('#dv-troca-busca');
        const res = el.querySelector('#dv-troca-res');
        let t;
        busca.addEventListener('input', () => {
          clearTimeout(t);
          t = setTimeout(async () => {
            const q = busca.value.trim();
            if (!q) { res.innerHTML = ''; return; }
            const achados = await API.get('/api/vendas/buscar-produto?termo=' + encodeURIComponent(q)).catch(() => []);
            if (!achados.length) { res.innerHTML = '<div class="dica">Nenhum produto encontrado.</div>'; return; }
            res.innerHTML = `<div class="pdv-resultados">${achados.map((c) => `<button type="button" data-add="${c.id}">${UI.escapar(c.nome)} <span class="muted">— ${UI.moeda(c.preco_venda)}</span></button>`).join('')}</div>`;
            res.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
              const c = achados.find((x) => x.id === Number(b.dataset.add));
              const existe = trocaForm.find((i) => i.produto_id === c.id);
              if (existe) existe.quantidade = Number(existe.quantidade) + 1;
              else trocaForm.push({ produto_id: c.id, descricao: c.nome, quantidade: 1, preco_unitario: Number(c.preco_venda) });
              busca.value = ''; res.innerHTML = ''; renderTroca(); recalcResumo();
            }));
          }, 250);
        });

        renderTroca();
        recalcResumo();
      },
      aoConfirmar: async (el) => {
        const itens = devolverForm.filter((i) => i.quantidade > 0).map((i) => ({ venda_item_id: i.venda_item_id, quantidade: i.quantidade }));
        if (!itens.length) { UI.erro('Informe a quantidade a devolver de ao menos um item.'); return false; }
        try {
          await API.post('/api/devolucoes', {
            venda_id: v.id, itens,
            itens_troca: trocaForm.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, preco_unitario: i.preco_unitario })),
            motivo: el.querySelector('#dv-motivo').value,
            forma_pagamento_diferenca: el.querySelector('#dv-forma').value,
          });
          UI.sucesso('Devolução registrada.');
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // tipo: 'nfce' (produto, via gateway) ou 'nfse' (serviço, Portal Nacional).
  function situacaoFiscalHTML(nota, tipo) {
    const rotulo = tipo === 'nfse' ? 'NFS-e' : 'NFC-e';
    if (!nota) return `<div class="flex flex--between" style="align-items:center"><span class="dica">Nenhuma nota emitida para esta venda.</span><button class="btn btn--secundario" data-emitir="${tipo}">Emitir ${rotulo}</button></div>`;
    if (nota.status === 'processando') return `<div class="flex flex--between" style="align-items:center"><span class="badge badge--alerta">Processando…</span><button class="btn btn--secundario" data-consultar="${tipo}" data-nota="${nota.id}">Atualizar status</button></div>`;
    if (nota.status === 'autorizada') return `<div class="flex flex--between" style="align-items:center">
      <span class="badge badge--ok">✅ Autorizada${nota.numero ? ' — nº ' + UI.escapar(nota.numero) : ''}</span>
      ${nota.danfe_url ? `<a class="btn btn--secundario" href="${UI.escapar(nota.danfe_url)}" target="_blank" rel="noopener">${tipo === 'nfse' ? 'Ver DANFSe' : 'Ver DANFE'}</a>` : ''}
    </div>`;
    return `<div>
      <span class="badge badge--erro">Erro na emissão</span>
      ${nota.mensagem_erro ? `<p class="dica mt-16">${UI.escapar(nota.mensagem_erro)}</p>` : ''}
      <button class="btn btn--secundario mt-16" data-emitir="${tipo}">Tentar novamente</button>
    </div>`;
  }

  function ligarAcoesFiscais(el, vendaId) {
    el.querySelectorAll('[data-emitir]').forEach((btnEmitir) => btnEmitir.addEventListener('click', async () => {
      const tipo = btnEmitir.dataset.emitir;
      const alvoId = tipo === 'nfse' ? 'vd-fiscal-nfse' : 'vd-fiscal-nfce';
      btnEmitir.disabled = true; btnEmitir.textContent = 'Emitindo…';
      try {
        await API.post(`/api/fiscal/vendas/${vendaId}/emitir-${tipo}`, {});
        UI.sucesso(`${tipo === 'nfse' ? 'NFS-e' : 'Nota fiscal'} enviada para processamento.`);
      } catch (e) {
        UI.erro(e.message);
      } finally {
        const notasAtual = await API.get(`/api/fiscal/vendas/${vendaId}/notas`).catch(() => []);
        const nota = notasAtual.filter((n) => (tipo === 'nfse' ? n.tipo === 'nfse' : n.tipo !== 'nfse'))[0];
        el.querySelector('#' + alvoId).innerHTML = situacaoFiscalHTML(nota, tipo);
        ligarAcoesFiscais(el, vendaId);
      }
    }));
    el.querySelectorAll('[data-consultar]').forEach((btnConsultar) => btnConsultar.addEventListener('click', async () => {
      const tipo = btnConsultar.dataset.consultar;
      const alvoId = tipo === 'nfse' ? 'vd-fiscal-nfse' : 'vd-fiscal-nfce';
      try {
        const caminho = tipo === 'nfse' ? 'consultar-nfse' : 'consultar';
        const nota = await API.post(`/api/fiscal/notas/${btnConsultar.dataset.nota}/${caminho}`, {});
        el.querySelector('#' + alvoId).innerHTML = situacaoFiscalHTML(nota, tipo);
        ligarAcoesFiscais(el, vendaId);
      } catch (e) { UI.erro(e.message); }
    }));
  }

  return { titulo: 'Vendas', render };
})();
