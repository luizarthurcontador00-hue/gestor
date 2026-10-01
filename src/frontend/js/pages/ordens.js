'use strict';

/**
 * Ordens de Serviço e Orçamentos.
 * - Itens podem ser produtos (peças) e serviços (mão de obra) do cadastro,
 *   ou itens livres (texto).
 * - Fluxo de status por tipo. Ao "Faturar", gera uma venda de verdade
 *   (baixa estoque das peças, entra no financeiro/DRE/contas a receber).
 * - Orçamento pode virar OS com um clique.
 */
window.PaginaOrdens = (function () {
  let tipoAtual = 'os';       // 'os' | 'orcamento'
  let vistaOS = 'lista';      // 'lista' | 'patio' (só se aplica a tipoAtual === 'os')
  let clientes = [];
  let profissionais = [];
  const filtros = { os: { busca: '', status: '' }, orcamento: { busca: '', status: '' } };

  const STATUS = {
    os: ['aberta', 'em_andamento', 'concluida', 'entregue', 'cancelada'],
    orcamento: ['aberto', 'aprovado', 'recusado', 'expirado', 'cancelada'],
  };
  const LABEL = {
    aberta: ['Aberta', 'alerta'], em_andamento: ['Em andamento', 'muted'], concluida: ['Concluída', 'ok'],
    entregue: ['Entregue', 'ok'], cancelada: ['Cancelada', 'muted'],
    aberto: ['Aberto', 'alerta'], aprovado: ['Aprovado', 'ok'], recusado: ['Recusado', 'erro'], expirado: ['Expirado', 'muted'],
  };
  const FORMAS = { dinheiro: 'Dinheiro', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito', pix: 'PIX', prazo: 'A prazo' };

  function badge(status) {
    const [txt, cls] = LABEL[status] || [status, 'muted'];
    return `<span class="badge badge--${cls}">${txt}</span>`;
  }
  function ehOS() { return tipoAtual === 'os'; }
  function rotulo(tipo) { return tipo === 'orcamento' ? 'Orçamento' : 'OS'; }

  async function render(container) {
    [clientes, profissionais] = await Promise.all([
      API.get('/api/clientes').catch(() => []),
      API.get('/api/agenda/profissionais').catch(() => []),
    ]);
    container.innerHTML = `
      <div class="subtabs">
        <button class="subtab ${tipoAtual === 'os' ? 'subtab--ativa' : ''}" data-tipo="os">🛠️ Ordens de Serviço</button>
        <button class="subtab ${tipoAtual === 'orcamento' ? 'subtab--ativa' : ''}" data-tipo="orcamento">📄 Orçamentos</button>
      </div>
      ${tipoAtual === 'os' ? `
      <div class="subtabs">
        <button class="subtab ${vistaOS === 'lista' ? 'subtab--ativa' : ''}" data-vista-os="lista">📋 Lista</button>
        <button class="subtab ${vistaOS === 'patio' ? 'subtab--ativa' : ''}" data-vista-os="patio">🅿️ Pátio</button>
      </div>` : ''}
      <div id="ord-conteudo"></div>`;
    container.querySelectorAll('[data-tipo]').forEach((b) => b.addEventListener('click', () => {
      tipoAtual = b.dataset.tipo; render(container);
    }));
    container.querySelectorAll('[data-vista-os]').forEach((b) => b.addEventListener('click', () => {
      vistaOS = b.dataset.vistaOs; render(container);
    }));

    if (tipoAtual === 'os' && vistaOS === 'patio') await renderPatio();
    else await renderLista();
  }

  /** Atualiza a lista ou o Pátio, conforme a visão atual (usado apos acoes). */
  async function atualizarListaOuPatio() {
    if (tipoAtual === 'os' && vistaOS === 'patio') await carregarPatio();
    else await listar();
  }

  async function renderLista() {
    const alvo = document.getElementById('ord-conteudo');
    const f = filtros[tipoAtual];
    const opts = ['<option value="">Todos os status</option>']
      .concat(STATUS[tipoAtual].map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${(LABEL[s] || [s])[0]}</option>`)).join('');
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <input type="search" id="ord-busca" class="cresce" placeholder="Buscar por nº, cliente, equipamento…" value="${UI.escapar(f.busca)}" />
        <select id="ord-status">${opts}</select>
        <button class="btn" id="ord-nova">+ ${ehOS() ? 'Nova OS' : 'Novo orçamento'}</button>
      </div>
      <div class="card"><div id="ord-lista">Carregando…</div></div>`;
    alvo.querySelector('#ord-busca').addEventListener('input', UI.debounce((e) => { f.busca = e.target.value; listar(); }, 250));
    alvo.querySelector('#ord-status').addEventListener('change', (e) => { f.status = e.target.value; listar(); });
    alvo.querySelector('#ord-nova').addEventListener('click', () => abrirForm());
    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('ord-lista');
    if (!alvo) return;
    const f = filtros[tipoAtual];
    const params = new URLSearchParams({ tipo: tipoAtual });
    if (f.busca) params.set('busca', f.busca);
    if (f.status) params.set('status', f.status);
    let itens;
    try { itens = await API.get('/api/ordens?' + params.toString()); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!itens.length) { alvo.innerHTML = `<p class="muted">Nenhum ${ehOS() ? 'ordem de serviço' : 'orçamento'} ainda.</p>`; return; }
    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>Nº</th><th>Cliente</th><th>${ehOS() ? 'Equipamento' : 'Descrição'}</th><th>Itens</th><th>Total</th><th>Status</th><th></th></tr></thead>
      <tbody>${itens.map((o) => `<tr data-ver="${o.id}" style="cursor:pointer">
        <td><strong>#${o.numero}</strong></td>
        <td>${UI.escapar(o.cliente_nome || '—')}</td>
        <td>${UI.escapar(o.equipamento || o.defeito || '—')}</td>
        <td>${o.total_itens}</td>
        <td>${UI.moeda(o.valor_total)}</td>
        <td>${badge(o.status)}${o.venda_id ? ' <span class="badge badge--ok" title="Faturada">💲</span>' : ''}</td>
        <td style="text-align:right"><button class="btn btn--secundario" data-ver2="${o.id}">Abrir</button></td>
      </tr>`).join('')}</tbody></table>`;
    alvo.querySelectorAll('[data-ver],[data-ver2]').forEach((el) => el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      verDetalhe(Number(el.dataset.ver || el.dataset.ver2));
    }));
  }

  // ------------------------------ Formulário ------------------------------
  function abrirForm(existente) {
    const ehEdicao = !!existente;
    const o = existente || {};
    const tipo = ehEdicao ? o.tipo : tipoAtual;
    const isOS = tipo === 'os';
    let itensForm = ehEdicao ? o.itens.map((i) => ({ ...i })) : [];

    const corpo = `
      <form id="form-ord" class="form-grid">
        <div class="campo ${isOS ? '' : 'col-2'}"><label>Cliente</label>
          <select name="cliente_id"><option value="">— sem cliente —</option>${clientes.map((c) => `<option value="${c.id}" ${String(o.cliente_id) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('')}</select></div>
        ${isOS ? `<div class="campo"><label>Responsável / técnico</label><input name="responsavel" value="${UI.escapar(o.responsavel || '')}" /></div>
        <div class="campo"><label>Profissional <span class="dica">(para comissão)</span></label>
          <select name="profissional_id"><option value="">— sem profissional —</option>${profissionais.map((p) => `<option value="${p.id}" ${String(o.profissional_id) === String(p.id) ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label>Equipamento / objeto</label><input name="equipamento" value="${UI.escapar(o.equipamento || '')}" placeholder="Ex.: Notebook Dell, Fiat Uno" /></div>
        <div class="campo"><label>Marca / modelo</label><input name="marca_modelo" value="${UI.escapar(o.marca_modelo || '')}" /></div>
        <div class="campo"><label>Série / placa / patrimônio</label><input name="identificacao" value="${UI.escapar(o.identificacao || '')}" /></div>
        <div class="campo"><label>Garantia (dias)</label><input name="garantia_dias" type="number" min="0" value="${o.garantia_dias || 0}" /></div>
        <div class="campo col-2"><label>Defeito relatado / escopo</label><textarea name="defeito">${UI.escapar(o.defeito || '')}</textarea></div>`
        : `<div class="campo col-2"><label>Descrição / escopo</label><textarea name="defeito">${UI.escapar(o.defeito || '')}</textarea></div>
        <div class="campo"><label>Validade do orçamento</label><input name="validade" type="date" value="${o.validade || ''}" /></div>`}

        <div class="campo col-2"><label>Itens (peças e serviços)</label>
          <div style="position:relative">
            <input id="ord-item-busca" placeholder="🔍 Buscar produto ou serviço do cadastro…" autocomplete="off" style="width:100%" />
            <div id="ord-item-res"></div>
          </div>
          <button type="button" class="btn btn--secundario mt-16" id="ord-item-livre">+ Item livre (texto)</button>
          <table class="tabela mt-16"><thead><tr><th>Item</th><th style="width:80px">Qtd</th><th style="width:120px">Preço un.</th><th style="width:110px">Total</th><th style="width:40px"></th></tr></thead>
            <tbody id="ord-itens"></tbody></table>
        </div>

        <div class="campo"><label>Desconto (R$)</label><input name="desconto" type="number" step="0.01" min="0" value="${o.desconto || 0}" id="ord-desconto" /></div>
        <div class="campo"><label>Previsão de entrega</label><input name="data_previsao" type="date" value="${o.data_previsao ? String(o.data_previsao).slice(0, 10) : ''}" /></div>
        <div class="campo col-2"><label>Observações</label><textarea name="observacao">${UI.escapar(o.observacao || '')}</textarea></div>
        <div class="campo col-2"><div class="flex flex--between" style="font-size:18px"><strong>Total</strong><strong id="ord-total">R$ 0,00</strong></div></div>
      </form>`;

    Modal.abrir({
      titulo: ehEdicao ? `${rotulo(tipo)} #${o.numero}` : (isOS ? 'Nova ordem de serviço' : 'Novo orçamento'),
      tamanho: 'modal--grande', corpoHTML: corpo, textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        CadastroRapido.ligar(el.querySelector('[name="cliente_id"]'), 'cliente', { aoCriar: (r) => clientes.push(r) });
        CadastroRapido.ligar(el.querySelector('[name="profissional_id"]'), 'profissional', { aoCriar: (r) => profissionais.push(r) });
        function renderItens() {
          const tb = el.querySelector('#ord-itens');
          if (!itensForm.length) { tb.innerHTML = '<tr><td colspan="5" class="muted">Nenhum item. Busque um produto/serviço ou adicione um item livre.</td></tr>'; }
          else {
            tb.innerHTML = itensForm.map((i, idx) => `<tr>
              <td>${UI.escapar(i.descricao)} ${i.tipo === 'servico' ? '<span class="badge badge--muted">serviço</span>' : (i.tipo === 'livre' ? '<span class="badge badge--muted">livre</span>' : '')}</td>
              <td><input type="number" step="0.001" min="0" value="${i.quantidade}" data-iq="${idx}" style="width:70px" /></td>
              <td><input type="number" step="0.01" min="0" value="${i.preco_unitario}" data-ip="${idx}" style="width:110px" /></td>
              <td>${UI.moeda((Number(i.quantidade) || 0) * (Number(i.preco_unitario) || 0))}</td>
              <td><button type="button" class="btn btn--secundario" data-irm="${idx}">✕</button></td>
            </tr>`).join('');
            tb.querySelectorAll('[data-iq]').forEach((inp) => inp.addEventListener('input', () => { itensForm[Number(inp.dataset.iq)].quantidade = Number(inp.value || 0); recalc(); }));
            tb.querySelectorAll('[data-ip]').forEach((inp) => inp.addEventListener('input', () => { itensForm[Number(inp.dataset.ip)].preco_unitario = Number(inp.value || 0); recalc(); }));
            tb.querySelectorAll('[data-irm]').forEach((b) => b.addEventListener('click', () => { itensForm.splice(Number(b.dataset.irm), 1); renderItens(); }));
          }
          recalc();
        }
        function recalc() {
          const bruto = itensForm.reduce((s, i) => s + (Number(i.quantidade) || 0) * (Number(i.preco_unitario) || 0), 0);
          const desc = Number(el.querySelector('#ord-desconto').value || 0);
          el.querySelector('#ord-total').textContent = UI.moeda(Math.max(0, bruto - desc));
        }
        el.querySelector('#ord-desconto').addEventListener('input', recalc);
        renderItens();

        // Busca de produto/serviço
        const busca = el.querySelector('#ord-item-busca');
        const res = el.querySelector('#ord-item-res');
        let t;
        busca.addEventListener('input', () => {
          clearTimeout(t);
          t = setTimeout(async () => {
            const q = busca.value.trim();
            if (!q) { res.innerHTML = ''; return; }
            const achados = await API.get('/api/vendas/buscar-produto?termo=' + encodeURIComponent(q)).catch(() => []);
            if (!achados.length) { res.innerHTML = '<div class="dica">Nenhum item encontrado.</div>'; return; }
            res.innerHTML = `<div class="pdv-resultados">${achados.map((c) => `<button type="button" data-add="${c.id}">${UI.escapar(c.nome)} ${c.eh_servico ? '<span class="badge badge--muted">serviço</span>' : ''} <span class="muted">— ${UI.moeda(c.preco_venda)}</span></button>`).join('')}</div>`;
            res.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
              const c = achados.find((x) => x.id === Number(b.dataset.add));
              const existe = itensForm.find((i) => i.produto_id === c.id);
              if (existe) existe.quantidade = Number(existe.quantidade) + 1;
              else itensForm.push({ produto_id: c.id, tipo: c.eh_servico ? 'servico' : 'produto', descricao: c.nome, quantidade: 1, preco_unitario: Number(c.preco_venda) });
              busca.value = ''; res.innerHTML = ''; renderItens();
            }));
          }, 250);
        });
        el.querySelector('#ord-item-livre').addEventListener('click', () => {
          itensForm.push({ produto_id: null, tipo: 'livre', descricao: 'Item', quantidade: 1, preco_unitario: 0 });
          renderItens();
          // foca a descrição do novo item permitindo editar via prompt simples
          const nome = prompt('Descrição do item:');
          if (nome != null) { itensForm[itensForm.length - 1].descricao = nome.trim() || 'Item'; renderItens(); }
        });
      },
      aoConfirmar: async (el) => {
        const form = el.querySelector('#form-ord');
        const dados = Object.fromEntries(new FormData(form).entries());
        dados.tipo = tipo;
        dados.itens = itensForm.map((i) => ({ produto_id: i.produto_id || null, tipo: i.tipo, descricao: i.descricao, quantidade: i.quantidade, preco_unitario: i.preco_unitario }));
        try {
          if (ehEdicao) await API.put(`/api/ordens/${o.id}`, dados);
          else await API.post('/api/ordens', dados);
          UI.sucesso(ehEdicao ? 'Salvo.' : `${rotulo(tipo)} criada.`);
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ------------------------------ Detalhe ------------------------------
  async function verDetalhe(id) {
    let o;
    try { o = await API.get(`/api/ordens/${id}`); } catch (e) { UI.erro(e.message); return; }
    const isOS = o.tipo === 'os';
    const corpo = `
      <div class="flex flex--between" style="flex-wrap:wrap;gap:8px">
        <div><strong style="font-size:18px">${rotulo(o.tipo)} #${o.numero}</strong> ${badge(o.status)}${o.venda_id ? ' <span class="badge badge--ok">Faturada (venda #' + o.venda_id + ')</span>' : ''}</div>
        <div class="muted">${UI.dataHora(o.criado_em)}</div>
      </div>
      <table class="tabela mt-16">
        <tr><th>Cliente</th><td>${UI.escapar(o.cliente_nome || '—')}${o.cliente_telefone ? ' · ' + UI.escapar(o.cliente_telefone) : ''}</td></tr>
        ${isOS ? `<tr><th>Equipamento</th><td>${UI.escapar(o.equipamento || '—')}${o.marca_modelo ? ' · ' + UI.escapar(o.marca_modelo) : ''}${o.identificacao ? ' · ' + UI.escapar(o.identificacao) : ''}</td></tr>
        <tr><th>Responsável</th><td>${UI.escapar(o.responsavel || '—')}</td></tr>
        ${o.profissional_nome ? `<tr><th>Profissional</th><td>${UI.escapar(o.profissional_nome)}</td></tr>` : ''}
        <tr><th>Garantia</th><td>${o.garantia_dias ? o.garantia_dias + ' dias' : '—'}</td></tr>` : ''}
        ${o.defeito ? `<tr><th>${isOS ? 'Defeito/escopo' : 'Descrição'}</th><td>${UI.escapar(o.defeito)}</td></tr>` : ''}
        ${o.validade ? `<tr><th>Validade</th><td>${o.validade}</td></tr>` : ''}
        ${o.observacao ? `<tr><th>Observações</th><td>${UI.escapar(o.observacao)}</td></tr>` : ''}
      </table>
      <h3 class="mt-16">Itens</h3>
      <table class="tabela">
        <thead><tr><th>Item</th><th>Qtd</th><th>Preço un.</th><th>Total</th></tr></thead>
        <tbody>${o.itens.map((i) => `<tr><td>${UI.escapar(i.descricao)} ${i.tipo === 'servico' ? '<span class="badge badge--muted">serviço</span>' : ''}</td><td>${UI.numero(i.quantidade)}</td><td>${UI.moeda(i.preco_unitario)}</td><td>${UI.moeda(i.valor_total)}</td></tr>`).join('')}</tbody>
        <tfoot>
          ${o.desconto ? `<tr><th colspan="3" style="text-align:right">Desconto</th><th>- ${UI.moeda(o.desconto)}</th></tr>` : ''}
          <tr><th colspan="3" style="text-align:right">Total</th><th>${UI.moeda(o.valor_total)}</th></tr>
        </tfoot>
      </table>`;

    Modal.abrir({
      titulo: `${rotulo(o.tipo)} #${o.numero}`, tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        const foot = el.querySelector('.modal__foot');
        const podeEditar = !o.venda_id;
        const statusOpts = STATUS[o.tipo].map((s) => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${(LABEL[s] || [s])[0]}</option>`).join('');
        foot.innerHTML = `
          <div class="flex gap-12" style="flex-wrap:wrap;align-items:center;width:100%">
            <select id="det-status" ${o.venda_id ? 'disabled' : ''}>${statusOpts}</select>
            <button class="btn btn--secundario" id="det-status-btn" ${o.venda_id ? 'disabled' : ''}>Atualizar status</button>
            <div class="cresce"></div>
            <button class="btn btn--secundario" id="det-print">🖨️ Imprimir</button>
            <button class="btn btn--secundario" id="det-baixar-pdf">⬇️ Baixar PDF</button>
            ${o.tipo === 'orcamento' && !o.venda_id ? '<button class="btn btn--secundario" id="det-geraros">→ Gerar OS</button>' : ''}
            ${podeEditar ? '<button class="btn btn--secundario" id="det-editar">Editar</button>' : ''}
            ${!o.venda_id ? `<button class="btn btn--secundario" id="det-faturar">💲 Faturar rápido</button>` : ''}
            ${!o.venda_id ? `<button class="btn" id="det-pdv">🧾 Finalizar no PDV</button>` : ''}
          </div>`;
        el.querySelector('#det-status-btn').addEventListener('click', async () => {
          try { await API.post(`/api/ordens/${o.id}/status`, { status: el.querySelector('#det-status').value }); UI.sucesso('Status atualizado.'); el.remove(); await atualizarListaOuPatio(); }
          catch (e) { UI.erro(e.message); }
        });
        el.querySelector('#det-print').addEventListener('click', () => imprimir(o));
        el.querySelector('#det-baixar-pdf').addEventListener('click', () => baixarPdf(o));
        const ed = el.querySelector('#det-editar');
        if (ed) ed.addEventListener('click', () => { el.remove(); abrirForm(o); });
        const gos = el.querySelector('#det-geraros');
        if (gos) gos.addEventListener('click', async () => {
          try { const nova = await API.post(`/api/ordens/${o.id}/gerar-os`, {}); UI.sucesso(`OS #${nova.numero} gerada a partir do orçamento.`); el.remove(); tipoAtual = 'os'; await render(document.getElementById('view')); }
          catch (e) { UI.erro(e.message); }
        });
        const fat = el.querySelector('#det-faturar');
        if (fat) fat.addEventListener('click', () => faturar(o, el));
        const pdv = el.querySelector('#det-pdv');
        if (pdv) pdv.addEventListener('click', () => { el.remove(); enviarParaPDV(o); });
      },
    });
  }

  function faturar(o, detalheEl) {
    Modal.abrir({
      titulo: `Faturar ${rotulo(o.tipo)} #${o.numero}`, tamanho: 'modal--pequeno',
      corpoHTML: `
        <p class="dica" style="margin-top:0">Isso gera uma venda de <strong>${UI.moeda(o.valor_total)}</strong> (baixa o estoque das peças e lança no financeiro). ${ehServicoResumo(o)}</p>
        <div class="campo"><label>Forma de pagamento</label><select id="fat-forma">${Object.entries(FORMAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="campo mt-16" id="fat-venc-wrap" style="display:none"><label>Vencimento (a prazo)</label><input id="fat-venc" type="date" /></div>`,
      textoConfirmar: 'Faturar',
      aoAbrir: (el) => {
        const forma = el.querySelector('#fat-forma');
        forma.addEventListener('change', () => { el.querySelector('#fat-venc-wrap').style.display = forma.value === 'prazo' ? '' : 'none'; });
      },
      aoConfirmar: async (el) => {
        const forma = el.querySelector('#fat-forma').value;
        try {
          await API.post(`/api/ordens/${o.id}/faturar`, { forma_pagamento: forma, vencimento_prazo: el.querySelector('#fat-venc').value || null });
          UI.sucesso('Faturado! Venda gerada.');
          if (detalheEl) detalheEl.remove();
          await atualizarListaOuPatio();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  function ehServicoResumo(o) {
    const temPeca = o.itens.some((i) => i.tipo === 'produto');
    return temPeca ? '' : 'Só há serviços — nenhum estoque é movimentado.';
  }

  /**
   * Leva o usuário ao PDV com o carrinho pré-carregado pelos itens da ordem,
   * para finalizar o pagamento com todos os recursos do balcão (múltiplas
   * formas de pagamento, desconto, cupom). Ao concluir a venda no PDV, a
   * ordem é automaticamente vinculada e marcada como entregue.
   */
  function enviarParaPDV(o) {
    if (!o.itens.length) { UI.erro('Adicione itens antes de finalizar.'); return; }
    const semVinculo = o.itens.filter((i) => !i.produto_id);
    if (semVinculo.length) {
      UI.erro('Para finalizar no PDV, todos os itens precisam estar vinculados a um produto ou serviço do cadastro.');
      return;
    }
    const veiculo = o.tipo === 'os' && o.equipamento ? ' — ' + o.equipamento : '';
    window.__pdvPreCarga = {
      osId: o.id,
      rotulo: `${rotulo(o.tipo)} #${o.numero}${veiculo}`,
      cliente_id: o.cliente_id || null,
      desconto: Number(o.desconto || 0),
      itens: o.itens.map((i) => ({ produto_id: i.produto_id, descricao: i.descricao, quantidade: i.quantidade, preco_unitario: i.preco_unitario })),
    };
    location.hash = '#/pdv';
  }

  // ------------------------------ Impressão ------------------------------
  async function htmlOrdem(o) {
    let loja = {};
    try { loja = await API.get('/api/config'); } catch (_) { /* segue sem dados da loja */ }
    const linhas = o.itens.map((i) => `<tr><td>${UI.escapar(i.descricao)}</td><td style="text-align:center">${UI.numero(i.quantidade)}</td><td style="text-align:right">${UI.moeda(i.preco_unitario)}</td><td style="text-align:right">${UI.moeda(i.valor_total)}</td></tr>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${rotulo(o.tipo)} #${o.numero}</title>
      <style>body{font-family:Arial,sans-serif;color:#111;padding:24px;max-width:720px;margin:auto}
      h1{font-size:20px;margin:0} .cab{display:flex;justify-content:space-between;border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:12px}
      table{width:100%;border-collapse:collapse;margin-top:12px} th,td{border-bottom:1px solid #ddd;padding:6px;font-size:13px;text-align:left}
      .tot{text-align:right;font-size:16px;margin-top:12px} .box{border:1px solid #ccc;border-radius:8px;padding:10px;margin-top:10px;font-size:13px}
      .muted{color:#666}</style></head><body>
      <div class="cab"><div style="display:flex;gap:12px;align-items:center">${loja.loja_logo ? `<img src="${loja.loja_logo}" style="width:56px;height:56px;object-fit:contain">` : ''}<div><h1>${UI.escapar(loja.nome_loja || 'Minha Empresa')}</h1>
        <div class="muted">${UI.escapar(loja.loja_telefone || '')} ${UI.escapar(loja.loja_cnpj || '')}</div></div></div>
        <div style="text-align:right"><strong>${rotulo(o.tipo)} #${o.numero}</strong><br><span class="muted">${UI.dataHora(o.criado_em)}</span></div></div>
      <div class="box"><strong>Cliente:</strong> ${UI.escapar(o.cliente_nome || '—')} ${o.cliente_telefone ? '· ' + UI.escapar(o.cliente_telefone) : ''}
      ${o.tipo === 'os' ? `<br><strong>Equipamento:</strong> ${UI.escapar(o.equipamento || '—')} ${o.marca_modelo ? '· ' + UI.escapar(o.marca_modelo) : ''} ${o.identificacao ? '· ' + UI.escapar(o.identificacao) : ''}` : ''}
      ${o.defeito ? `<br><strong>${o.tipo === 'os' ? 'Defeito/escopo' : 'Descrição'}:</strong> ${UI.escapar(o.defeito)}` : ''}
      ${o.garantia_dias ? `<br><strong>Garantia:</strong> ${o.garantia_dias} dias` : ''}
      ${o.validade ? `<br><strong>Validade:</strong> ${o.validade}` : ''}</div>
      <table><thead><tr><th>Item</th><th style="text-align:center">Qtd</th><th style="text-align:right">Preço</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${linhas}</tbody></table>
      <div class="tot">${o.desconto ? `Desconto: - ${UI.moeda(o.desconto)}<br>` : ''}<strong>Total: ${UI.moeda(o.valor_total)}</strong></div>
      ${o.observacao ? `<div class="box"><strong>Observações:</strong> ${UI.escapar(o.observacao)}</div>` : ''}
      <p class="muted" style="margin-top:24px;text-align:center">${UI.escapar(loja.loja_rodape_cupom || '')}</p>
      </body></html>`;
  }

  async function imprimir(o) { UI.imprimir(await htmlOrdem(o)); }
  async function baixarPdf(o) { UI.baixarPDF(await htmlOrdem(o), `${rotulo(o.tipo).toLowerCase()}-${o.numero}.pdf`); }

  // ------------------------------ Pátio da Oficina (Kanban) ------------------------------
  const COLUNAS_PATIO = [
    { status: 'aberta', titulo: '🅿️ Aguardando', avancarPara: 'em_andamento', avancarTxt: '▶ Iniciar' },
    { status: 'em_andamento', titulo: '🔧 Em manutenção', avancarPara: 'concluida', avancarTxt: '✅ Concluir' },
    { status: 'concluida', titulo: '✅ Concluído', avancarPara: null },
    { status: 'entregue', titulo: '💲 Entregue / Pago', avancarPara: null },
  ];

  async function renderPatio() {
    const alvo = document.getElementById('ord-conteudo');
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <input type="search" id="pat-busca" class="cresce" placeholder="Buscar por nº, cliente, veículo…" />
        <button class="btn" id="pat-novo">+ Nova OS</button>
      </div>
      <div id="pat-resumo" class="grid grid--cards mb-16"></div>
      <div id="pat-kanban"><div class="card">Carregando…</div></div>`;
    alvo.querySelector('#pat-busca').addEventListener('input', UI.debounce(() => carregarPatio(), 250));
    alvo.querySelector('#pat-novo').addEventListener('click', () => abrirForm());
    await carregarPatio();
  }

  async function carregarPatio() {
    const kanban = document.getElementById('pat-kanban');
    if (!kanban) return;
    const buscaEl = document.getElementById('pat-busca');
    const busca = buscaEl ? buscaEl.value : '';
    const params = new URLSearchParams({ tipo: 'os' });
    if (busca) params.set('busca', busca);

    let itens;
    try { itens = await API.get('/api/ordens?' + params.toString()); }
    catch (e) { kanban.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}</div>`; return; }

    // "Entregue" so mostra os ultimos 14 dias no painel, para nao virar uma lista sem fim.
    const limite = new Date(); limite.setDate(limite.getDate() - 14);
    const porColuna = { aberta: [], em_andamento: [], concluida: [], entregue: [] };
    itens.forEach((o) => {
      if (o.status === 'cancelada' || !porColuna[o.status]) return;
      if (o.status === 'entregue') {
        const dt = o.data_entrega ? new Date(String(o.data_entrega).replace(' ', 'T')) : null;
        if (dt && dt < limite) return;
      }
      porColuna[o.status].push(o);
    });

    const resumo = document.getElementById('pat-resumo');
    const noPatio = porColuna.aberta.length + porColuna.em_andamento.length + porColuna.concluida.length;
    resumo.innerHTML = `
      <div class="card stat"><span class="stat__label">Carros no pátio</span><span class="stat__value">${noPatio}</span></div>
      <div class="card stat"><span class="stat__label">Aguardando</span><span class="stat__value" style="color:var(--alerta)">${porColuna.aberta.length}</span></div>
      <div class="card stat"><span class="stat__label">Em manutenção</span><span class="stat__value" style="color:var(--primaria)">${porColuna.em_andamento.length}</span></div>
      <div class="card stat"><span class="stat__label">Concluídos (aguard. pagamento)</span><span class="stat__value" style="color:var(--sucesso)">${porColuna.concluida.length}</span></div>`;

    kanban.innerHTML = `<div class="patio-kanban">
      ${COLUNAS_PATIO.map((c) => `
        <div class="patio-coluna">
          <div class="patio-coluna__titulo">${c.titulo} <span class="badge badge--muted">${porColuna[c.status].length}</span></div>
          <div class="patio-coluna__cards">
            ${porColuna[c.status].length ? porColuna[c.status].map((o) => cardPatio(o, c)).join('') : '<div class="patio-vazio">Nenhum</div>'}
          </div>
        </div>`).join('')}
    </div>`;

    kanban.querySelectorAll('[data-abrir]').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.closest('[data-acao]')) return;
      verDetalhe(Number(el.dataset.abrir));
    }));
    kanban.querySelectorAll('[data-avancar]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await API.post(`/api/ordens/${b.dataset.avancar}/status`, { status: b.dataset.para }); await carregarPatio(); }
      catch (err) { UI.erro(err.message); }
    }));
    kanban.querySelectorAll('[data-pdv]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { enviarParaPDV(await API.get('/api/ordens/' + b.dataset.pdv)); } catch (err) { UI.erro(err.message); }
    }));
  }

  function cardPatio(o, coluna) {
    const veiculo = [o.equipamento, o.marca_modelo].filter(Boolean).join(' · ') || 'Sem veículo informado';
    let acao = '';
    if (coluna.avancarPara) {
      acao = `<button class="btn btn--secundario" data-avancar="${o.id}" data-para="${coluna.avancarPara}">${coluna.avancarTxt}</button>`;
    } else if (coluna.status === 'concluida') {
      acao = `<button class="btn" data-pdv="${o.id}">🧾 Finalizar no PDV</button>`;
    }
    return `<div class="patio-card" data-abrir="${o.id}">
      <div class="patio-card__num">#${o.numero}</div>
      <div class="patio-card__cliente">${UI.escapar(o.cliente_nome || 'Sem cliente')}</div>
      <div class="patio-card__veiculo">🚗 ${UI.escapar(veiculo)}</div>
      ${o.responsavel ? `<div class="patio-card__resp">👤 ${UI.escapar(o.responsavel)}</div>` : ''}
      <div class="patio-card__valor">${UI.moeda(o.valor_total)}</div>
      ${acao ? `<div class="patio-card__acao" data-acao>${acao}</div>` : ''}
    </div>`;
  }


  return { titulo: 'Ordens & Orçamentos', render };
})();
