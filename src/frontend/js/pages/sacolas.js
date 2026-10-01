'use strict';

/**
 * Sacolas de venda ("leva e traz"): produtos que saem da loja para serem
 * mostrados/vendidos em outro lugar. Ao montar, os itens saem do estoque.
 * Na conferência, o que voltou entra de volta e o que não voltou vira venda.
 */
window.PaginaSacolas = (function () {
  let clientes = [];
  let profissionais = [];
  const FORMAS_RECEB = {
    prazo: 'A prazo (cliente ficou devendo)', dinheiro: 'Dinheiro', pix: 'PIX',
    cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito',
  };

  async function render(container) {
    [clientes, profissionais] = await Promise.all([
      API.get('/api/clientes').catch(() => []),
      API.get('/api/agenda/profissionais').catch(() => []),
    ]);
    container.innerHTML = `
      <p class="dica mb-16">Monte uma sacola com os produtos que vão sair da loja (ex.: para mostrar na casa de um cliente). Ao montar, os itens já saem do estoque. Quando a sacola voltar, confira o que retornou — o que não voltar vira uma venda automaticamente.</p>
      <div class="barra-ferramentas"><div class="cresce"></div><button class="btn" id="sc-nova">+ Nova sacola</button></div>
      <div class="card"><div id="sc-lista">Carregando…</div></div>`;
    container.querySelector('#sc-nova').addEventListener('click', formNovaSacola);
    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('sc-lista');
    let sacolas;
    try { sacolas = await API.get('/api/sacolas'); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!sacolas.length) { alvo.innerHTML = '<p class="muted">Nenhuma sacola registrada ainda.</p>'; return; }
    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>#</th><th>Para</th><th>Vendedor</th><th>Saída</th><th>Peças</th><th>Status</th><th></th></tr></thead>
      <tbody>${sacolas.map((s) => `<tr>
        <td>${s.id}</td>
        <td>${UI.escapar(s.cliente_cadastrado_nome || s.cliente_nome || '—')}</td>
        <td>${UI.escapar(s.vendedor_nome || '—')}</td>
        <td>${UI.dataHora(s.data_saida)}</td>
        <td>${UI.numero(s.total_pecas)} peça(s) / ${s.total_itens} item(ns)</td>
        <td>${s.status === 'aberta' ? '<span class="badge badge--alerta">Em rua</span>' : '<span class="badge badge--ok">Conferida</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          ${s.status === 'aberta'
            ? `<button class="btn" data-conferir="${s.id}">Conferir</button><button class="btn btn--secundario" data-excluir="${s.id}">✕</button>`
            : `<button class="btn btn--secundario" data-ver="${s.id}">Ver</button>`}
        </td>
      </tr>`).join('')}</tbody></table>`;

    alvo.querySelectorAll('[data-conferir]').forEach((b) => b.addEventListener('click', () => formConferir(Number(b.dataset.conferir))));
    alvo.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => verSacola(Number(b.dataset.ver))));
    alvo.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Cancelar esta sacola? Os itens voltam para o estoque.', { titulo: 'Cancelar sacola', textoConfirmar: 'Cancelar sacola' });
      if (!ok) return;
      try { await API.del(`/api/sacolas/${b.dataset.excluir}`); UI.sucesso('Sacola cancelada.'); await listar(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  // ------------------------- Nova sacola -------------------------
  function formNovaSacola() {
    const itens = []; // { produto_id, descricao, quantidade, estoque_disponivel }
    const corpo = `
      <div class="form-grid">
        <div class="campo"><label>Cliente (opcional)</label><select id="sc-cliente"><option value="">— avulso —</option>${clientes.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label>Nome (se não tiver cadastro)</label><input id="sc-cliente-nome" placeholder="Ex.: Dona Marta" /></div>
      </div>
      ${profissionais.length ? `<div class="campo mt-16"><label>Vendedor (opcional)</label><select id="sc-vendedor"><option value="">—</option>${profissionais.map((p) => `<option value="${p.id}">${UI.escapar(p.nome)}</option>`).join('')}</select></div>` : ''}
      <div class="campo mt-16"><label>Produtos</label>
        <div style="position:relative">
          <input id="sc-busca" placeholder="🔍 Buscar produto…" autocomplete="off" style="width:100%" />
          <div id="sc-busca-res"></div>
        </div>
        <table class="tabela mt-16"><thead><tr><th>Produto</th><th style="width:110px">Qtd</th><th style="width:40px"></th></tr></thead>
          <tbody id="sc-itens"><tr><td colspan="3" class="muted">Nenhum produto adicionado.</td></tr></tbody></table>
      </div>
      <div class="campo mt-16"><label>Observação</label><input id="sc-obs" /></div>`;

    Modal.abrir({
      titulo: 'Nova sacola de vendas', tamanho: 'modal--grande', corpoHTML: corpo, textoConfirmar: 'Montar sacola',
      aoAbrir: (el) => {
        CadastroRapido.ligar(el.querySelector('#sc-cliente'), 'cliente', { aoCriar: (r) => clientes.push(r) });
        function renderItens() {
          const tb = el.querySelector('#sc-itens');
          tb.innerHTML = itens.length ? itens.map((i, idx) => `<tr>
            <td>${UI.escapar(i.descricao)} <span class="dica">(estoque: ${UI.numero(i.estoque_disponivel)})</span></td>
            <td><input type="number" step="1" min="1" max="${i.estoque_disponivel}" value="${i.quantidade}" data-iq="${idx}" style="width:80px" /></td>
            <td><button type="button" class="btn btn--secundario" data-irm="${idx}">✕</button></td>
          </tr>`).join('') : '<tr><td colspan="3" class="muted">Nenhum produto adicionado.</td></tr>';
          tb.querySelectorAll('[data-iq]').forEach((inp) => inp.addEventListener('input', () => {
            const idx = Number(inp.dataset.iq);
            let q = Number(inp.value || 0);
            if (q < 1) q = 1;
            if (q > itens[idx].estoque_disponivel) q = itens[idx].estoque_disponivel;
            itens[idx].quantidade = q;
          }));
          tb.querySelectorAll('[data-irm]').forEach((b) => b.addEventListener('click', () => { itens.splice(Number(b.dataset.irm), 1); renderItens(); }));
        }

        const busca = el.querySelector('#sc-busca');
        const res = el.querySelector('#sc-busca-res');
        let t;
        busca.addEventListener('input', () => {
          clearTimeout(t);
          t = setTimeout(async () => {
            const q = busca.value.trim();
            if (!q) { res.innerHTML = ''; return; }
            const achados = await API.get('/api/vendas/buscar-produto?termo=' + encodeURIComponent(q)).catch(() => []);
            const disponiveis = achados.filter((p) => !p.eh_servico && !p.eh_kit && Number(p.estoque_atual) > 0);
            if (!disponiveis.length) { res.innerHTML = '<div class="dica">Nenhum produto com estoque disponível.</div>'; return; }
            res.innerHTML = `<div class="pdv-resultados">${disponiveis.map((c) => `<button type="button" data-add="${c.id}">${UI.escapar(c.nome)} <span class="muted">— estoque ${UI.numero(c.estoque_atual)}</span></button>`).join('')}</div>`;
            res.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
              const c = disponiveis.find((x) => x.id === Number(b.dataset.add));
              const existe = itens.find((i) => i.produto_id === c.id);
              if (existe) { if (existe.quantidade < existe.estoque_disponivel) existe.quantidade++; }
              else itens.push({ produto_id: c.id, descricao: c.nome, quantidade: 1, estoque_disponivel: Number(c.estoque_atual) });
              busca.value = ''; res.innerHTML = ''; renderItens();
            }));
          }, 250);
        });

        renderItens();
      },
      aoConfirmar: async (el) => {
        if (!itens.length) { UI.erro('Adicione ao menos um produto.'); return false; }
        try {
          const vendedorSel = el.querySelector('#sc-vendedor');
          await API.post('/api/sacolas', {
            cliente_id: el.querySelector('#sc-cliente').value || null,
            cliente_nome: el.querySelector('#sc-cliente-nome').value,
            vendedor_id: vendedorSel ? vendedorSel.value || null : null,
            observacao: el.querySelector('#sc-obs').value,
            itens: itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade })),
          });
          UI.sucesso('Sacola montada — os itens já saíram do estoque.');
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ------------------------- Conferir -------------------------
  async function formConferir(id) {
    let s;
    try { s = await API.get(`/api/sacolas/${id}`); } catch (e) { UI.erro(e.message); return; }

    const corpo = `
      <p class="dica mb-16">Informe quanto voltou de cada item. O que não voltar vira uma venda automaticamente.</p>
      <table class="tabela">
        <thead><tr><th>Produto</th><th style="width:90px">Levado</th><th style="width:110px">Voltou</th><th style="width:90px">Vendido</th></tr></thead>
        <tbody>${s.itens.map((i) => `<tr>
          <td>${UI.escapar(i.descricao)}</td>
          <td style="text-align:center">${UI.numero(i.quantidade_levada)}</td>
          <td><input type="number" step="1" min="0" max="${i.quantidade_levada}" value="${i.quantidade_levada}" data-retorno="${i.id}" style="width:90px" /></td>
          <td style="text-align:center" data-vendido="${i.id}">0</td>
        </tr>`).join('')}</tbody>
      </table>
      <div class="card mt-16" id="cf-resumo"></div>
      <div class="campo mt-16" id="cf-forma-wrap"><label>Como o cliente pagou pelo que ficou?</label>
        <select id="cf-forma">${Object.entries(FORMAS_RECEB).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      </div>
      <div class="campo mt-16" id="cf-venc-wrap"><label>Vencimento (se ficou devendo)</label><input type="date" id="cf-venc" value="${new Date().toISOString().slice(0, 10)}" /></div>`;

    Modal.abrir({
      titulo: `Conferir sacola #${s.id}`, tamanho: 'modal--grande', corpoHTML: corpo, textoConfirmar: 'Confirmar conferência',
      aoAbrir: (el) => {
        function recalc() {
          let totalVendido = 0;
          let valorVendido = 0;
          s.itens.forEach((i) => {
            const inp = el.querySelector(`[data-retorno="${i.id}"]`);
            let retorno = Number(inp.value || 0);
            if (retorno < 0) retorno = 0;
            if (retorno > i.quantidade_levada) retorno = i.quantidade_levada;
            inp.value = retorno;
            const vendido = i.quantidade_levada - retorno;
            el.querySelector(`[data-vendido="${i.id}"]`).textContent = UI.numero(vendido);
            if (vendido > 0) { totalVendido += vendido; valorVendido += vendido * i.preco_unitario; }
          });
          el.querySelector('#cf-resumo').innerHTML = `
            <div class="flex flex--between"><span>Peças vendidas</span><span>${totalVendido}</span></div>
            <div class="flex flex--between"><strong>Valor da venda</strong><strong>${UI.moeda(valorVendido)}</strong></div>`;
          el.querySelector('#cf-forma-wrap').style.display = totalVendido > 0 ? '' : 'none';
          el.querySelector('#cf-venc-wrap').style.display = totalVendido > 0 && el.querySelector('#cf-forma').value === 'prazo' ? '' : 'none';
        }
        el.querySelectorAll('[data-retorno]').forEach((inp) => inp.addEventListener('input', recalc));
        el.querySelector('#cf-forma').addEventListener('change', recalc);
        recalc();
      },
      aoConfirmar: async (el) => {
        const itens = s.itens.map((i) => ({
          item_id: i.id,
          quantidade_retornada: Number(el.querySelector(`[data-retorno="${i.id}"]`).value || 0),
        }));
        try {
          const r = await API.post(`/api/sacolas/${s.id}/conferir`, {
            itens,
            forma_pagamento: el.querySelector('#cf-forma').value,
            vencimento_prazo: el.querySelector('#cf-venc').value || null,
          });
          UI.sucesso(r.venda_id ? `Sacola conferida. Venda #${r.venda_id} gerada.` : 'Sacola conferida — tudo voltou, nada foi vendido.');
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ------------------------- Ver detalhe -------------------------
  async function verSacola(id) {
    let s;
    try { s = await API.get(`/api/sacolas/${id}`); } catch (e) { UI.erro(e.message); return; }
    const corpo = `
      <div class="flex flex--between mb-16">
        <div><strong>Sacola #${s.id}</strong><div class="dica">Saída: ${UI.dataHora(s.data_saida)} · Conferida: ${s.data_conferencia ? UI.dataHora(s.data_conferencia) : '—'}</div></div>
        <span class="badge badge--ok">Conferida</span>
      </div>
      <div>Para: <strong>${UI.escapar(s.cliente_cadastrado_nome || s.cliente_nome || '—')}</strong>${s.vendedor_nome ? ` · Vendedor: ${UI.escapar(s.vendedor_nome)}` : ''}</div>
      <table class="tabela mt-16">
        <thead><tr><th>Produto</th><th>Levado</th><th>Voltou</th><th>Vendido</th></tr></thead>
        <tbody>${s.itens.map((i) => `<tr>
          <td>${UI.escapar(i.descricao)}</td>
          <td>${UI.numero(i.quantidade_levada)}</td>
          <td>${i.quantidade_retornada == null ? '—' : UI.numero(i.quantidade_retornada)}</td>
          <td>${i.quantidade_retornada == null ? '—' : UI.numero(i.quantidade_levada - i.quantidade_retornada)}</td>
        </tr>`).join('')}</tbody>
      </table>
      ${s.venda_id ? `<p class="mt-16">Venda gerada: <strong>#${s.venda_id}</strong></p>` : '<p class="mt-16 muted">Nada foi vendido — tudo retornou.</p>'}
      ${s.observacao ? `<p class="muted mt-16">${UI.escapar(s.observacao)}</p>` : ''}`;
    Modal.abrir({ titulo: 'Detalhes da sacola', tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false });
  }

  return { titulo: 'Sacolas de venda', render };
})();
