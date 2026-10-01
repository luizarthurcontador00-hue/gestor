'use strict';

/**
 * PDV (Ponto de Venda): tela otimizada para o balcao.
 * - Busca por código de barras (leitor USB) ou nome
 * - Carrinho, desconto, múltiplas formas de pagamento com troco
 * - Abertura/fechamento de caixa, sangria e suprimento
 * - Atalhos: F2 foca busca · F4 finaliza · Del limpa venda
 */
window.PaginaPDV = (function () {
  let carrinho = [];   // { produto, quantidade, preco }
  let caixa = null;
  let resultados = [];
  let selIdx = 0;
  let handlerTeclado = null;
  let relogioInterval = null;
  let origemOS = null; // { osId, rotulo, cliente_id, desconto, itens } — quando vem de "Finalizar no PDV" (Ordens/Orçamentos)

  const FORMAS = [
    ['dinheiro', 'Dinheiro'], ['cartao_credito', 'Cartão crédito'],
    ['cartao_debito', 'Cartão débito'], ['pix', 'PIX'], ['prazo', 'A prazo'],
  ];

  async function render(container) {
    carrinho = [];
    origemOS = null;
    caixa = await API.get('/api/caixa/atual').catch(() => null);

    // Carrinho pre-carregado (ex.: "Finalizar no PDV" a partir de uma Ordem de Serviço).
    const precarga = window.__pdvPreCarga;
    if (precarga) {
      window.__pdvPreCarga = null;
      origemOS = precarga;
      carrinho = precarga.itens.map((i) => ({
        produto: { id: i.produto_id, nome: i.descricao },
        quantidade: Number(i.quantidade) || 1,
        preco: Number(i.preco_unitario) || 0,
      }));
    }

    container.innerHTML = `
      <div id="pdv-root" class="pdv">
        <div class="pdv__esq">
          <div id="caixa-bar"></div>
          ${origemOS ? `<div class="pdv-os-banner" id="pdv-os-banner">🛠️ Carrinho vindo de <strong>${UI.escapar(origemOS.rotulo)}</strong> — ao concluir, a ordem será marcada como entregue.
            <button class="btn btn--secundario" id="pdv-os-remover">Remover vínculo</button></div>` : ''}
          <div class="pdv-busca">
            <input id="pdv-input" type="text" placeholder="Código de barras ou nome do produto…  (F2)" autocomplete="off" />
            <button class="btn" id="pdv-add">Adicionar</button>
          </div>
          <div id="pdv-resultados"></div>
          <div class="pdv-carrinho">
            <table>
              <thead><tr><th>Produto</th><th>Qtd</th><th>Preço</th><th>Subtotal</th><th></th></tr></thead>
              <tbody id="pdv-itens"></tbody>
            </table>
          </div>
        </div>
        <div class="pdv__dir">
          <div class="pdv-total-card">
            <div class="linha" style="margin-bottom:14px;font-size:12px;text-transform:uppercase;letter-spacing:1px">
              <span>🖥️ PDV</span><span id="pdv-relogio" style="font-family:'Courier New',monospace"></span>
            </div>
            <div class="linha"><span>Itens</span><span id="pdv-qtd-itens">0</span></div>
            <div class="linha"><span>Subtotal</span><span id="pdv-subtotal">R$ 0,00</span></div>
            <div class="pdv-desconto linha" style="display:block">
              <span>Desconto (R$)</span>
              <input id="pdv-desconto" type="number" min="0" step="0.01" value="${origemOS && origemOS.desconto ? origemOS.desconto : 0}" />
            </div>
            <hr style="border-color:#374151;margin:12px 0" />
            <div class="linha" style="align-items:baseline"><span>TOTAL</span><span class="total" id="pdv-total">R$ 0,00</span></div>
          </div>
          <div class="pdv-acoes">
            <button class="btn" id="pdv-finalizar">Finalizar venda (F4)</button>
            <button class="btn btn--secundario" id="pdv-limpar">Limpar venda (Del)</button>
          </div>
          <div class="atalho">
            <kbd>F2</kbd> buscar · <kbd>Enter</kbd> adicionar · <kbd>F4</kbd> finalizar · <kbd>Del</kbd> limpar
          </div>
        </div>
      </div>`;

    const remBtn = container.querySelector('#pdv-os-remover');
    if (remBtn) remBtn.addEventListener('click', () => {
      origemOS = null;
      const banner = document.getElementById('pdv-os-banner');
      if (banner) banner.remove();
      UI.toast('Vínculo removido. Os itens continuam no carrinho.', 'info');
    });

    renderCaixaBar();
    renderCarrinho();

    if (relogioInterval) clearInterval(relogioInterval);
    const atualizarRelogio = () => {
      const el = document.getElementById('pdv-relogio');
      if (!el) { clearInterval(relogioInterval); return; }
      el.textContent = new Date().toLocaleTimeString('pt-BR');
    };
    atualizarRelogio();
    relogioInterval = setInterval(atualizarRelogio, 1000);

    const input = container.querySelector('#pdv-input');
    input.addEventListener('keydown', onInputKey);
    input.addEventListener('input', UI.debounce(buscar, 200));
    container.querySelector('#pdv-add').addEventListener('click', () => adicionarDaBusca());
    container.querySelector('#pdv-desconto').addEventListener('input', atualizarTotais);
    container.querySelector('#pdv-finalizar').addEventListener('click', finalizar);
    container.querySelector('#pdv-limpar').addEventListener('click', limpar);

    setTimeout(() => input.focus(), 50);

    // Atalhos globais (removidos ao sair da pagina)
    if (handlerTeclado) document.removeEventListener('keydown', handlerTeclado);
    handlerTeclado = (e) => {
      if (!document.getElementById('pdv-root')) { document.removeEventListener('keydown', handlerTeclado); return; }
      if (e.key === 'F2') { e.preventDefault(); input.focus(); input.select(); }
      else if (e.key === 'F4') { e.preventDefault(); finalizar(); }
      else if (e.key === 'Delete') { e.preventDefault(); limpar(); }
    };
    document.addEventListener('keydown', handlerTeclado);
  }

  // ----------------------- Caixa -----------------------
  function renderCaixaBar() {
    const bar = document.getElementById('caixa-bar');
    if (!bar) return;
    if (caixa) {
      bar.className = 'pdv-caixa-bar aberto';
      bar.innerHTML = `
        <span>🟢 Caixa aberto — abertura ${UI.moeda(caixa.valor_abertura)} · vendas ${caixa.resumo.qtd_vendas} (${UI.moeda(caixa.resumo.total_vendas)})</span>
        <span class="acoes">
          <button class="btn btn--secundario" data-mov="suprimento">Suprimento</button>
          <button class="btn btn--secundario" data-mov="sangria">Sangria</button>
          <button class="btn btn--perigo" id="btn-fechar-caixa">Fechar caixa</button>
        </span>`;
      bar.querySelectorAll('[data-mov]').forEach((b) => b.addEventListener('click', () => movimentarCaixa(b.dataset.mov)));
      bar.querySelector('#btn-fechar-caixa').addEventListener('click', fecharCaixa);
    } else {
      bar.className = 'pdv-caixa-bar fechado';
      bar.innerHTML = `<span>🟡 Caixa fechado — abra o caixa para iniciar as vendas do dia.</span>
        <span class="acoes"><button class="btn" id="btn-abrir-caixa">Abrir caixa</button></span>`;
      bar.querySelector('#btn-abrir-caixa').addEventListener('click', abrirCaixa);
    }
  }

  function abrirCaixa() {
    Modal.abrir({
      titulo: 'Abrir caixa', tamanho: 'modal--pequeno',
      corpoHTML: `<div class="campo"><label>Valor de abertura (troco inicial)</label>
        <input id="ca-valor" type="number" min="0" step="0.01" value="0" /></div>`,
      textoConfirmar: 'Abrir',
      aoConfirmar: async (el) => {
        try {
          caixa = await API.post('/api/caixa/abrir', { valor_abertura: Number(el.querySelector('#ca-valor').value || 0) });
          renderCaixaBar(); UI.sucesso('Caixa aberto.');
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  function movimentarCaixa(tipo) {
    Modal.abrir({
      titulo: tipo === 'sangria' ? 'Sangria (retirada)' : 'Suprimento (entrada)', tamanho: 'modal--pequeno',
      corpoHTML: `<div class="campo"><label>Valor</label><input id="mv-valor" type="number" min="0" step="0.01" /></div>
        <div class="campo mt-16"><label>Motivo</label><input id="mv-motivo" /></div>`,
      textoConfirmar: 'Confirmar',
      aoConfirmar: async (el) => {
        try {
          caixa = await API.post(`/api/caixa/${caixa.id}/movimento`, {
            tipo, valor: Number(el.querySelector('#mv-valor').value || 0), motivo: el.querySelector('#mv-motivo').value,
          });
          renderCaixaBar(); UI.sucesso('Movimento registrado.');
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function fecharCaixa() {
    const atual = await API.get('/api/caixa/atual').catch(() => caixa);
    const esperado = atual.resumo.esperado_dinheiro;
    Modal.abrir({
      titulo: 'Fechar caixa', tamanho: 'modal--pequeno',
      corpoHTML: `
        <table class="tabela">
          <tr><th>Abertura</th><td>${UI.moeda(atual.valor_abertura)}</td></tr>
          <tr><th>Vendas em dinheiro</th><td>${UI.moeda(atual.resumo.por_forma.find((f) => f.forma === 'dinheiro') ? atual.resumo.por_forma.find((f) => f.forma === 'dinheiro').total : 0)}</td></tr>
          <tr><th>Suprimentos</th><td>${UI.moeda(atual.resumo.suprimentos)}</td></tr>
          <tr><th>Sangrias</th><td>- ${UI.moeda(atual.resumo.sangrias)}</td></tr>
          <tr><th>Esperado em caixa</th><td><strong>${UI.moeda(esperado)}</strong></td></tr>
        </table>
        <div class="campo mt-16"><label>Valor contado (dinheiro na gaveta)</label>
          <input id="fc-valor" type="number" min="0" step="0.01" value="${esperado}" /></div>
        <div id="fc-dif" class="dica mt-16"></div>`,
      textoConfirmar: 'Fechar caixa',
      aoAbrir: (el) => {
        const inp = el.querySelector('#fc-valor');
        const dif = el.querySelector('#fc-dif');
        const calc = () => {
          const d = Number(inp.value || 0) - esperado;
          dif.textContent = d === 0 ? 'Sem diferença.' : (d > 0 ? `Sobra de ${UI.moeda(d)}` : `Falta de ${UI.moeda(Math.abs(d))}`);
          dif.style.color = d === 0 ? '' : (d > 0 ? 'var(--sucesso)' : 'var(--perigo)');
        };
        inp.addEventListener('input', calc); calc();
      },
      aoConfirmar: async (el) => {
        try {
          const r = await API.post(`/api/caixa/${atual.id}/fechar`, { valor_fechamento: Number(el.querySelector('#fc-valor').value || 0) });
          caixa = null; renderCaixaBar();
          UI.sucesso(`Caixa fechado. Diferença: ${UI.moeda(r.diferenca)}.`);
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ----------------------- Busca / carrinho -----------------------
  async function buscar() {
    const termo = document.getElementById('pdv-input').value.trim();
    const alvo = document.getElementById('pdv-resultados');
    if (!termo) { alvo.innerHTML = ''; resultados = []; return; }
    resultados = await API.get('/api/vendas/buscar-produto?termo=' + encodeURIComponent(termo)).catch(() => []);
    selIdx = 0;
    if (!resultados.length) { alvo.innerHTML = '<div class="pdv-resultados" style="padding:10px" >Nenhum produto encontrado.</div>'; return; }
    alvo.innerHTML = `<div class="pdv-resultados">${resultados.map((p, i) => `
      <button data-i="${i}" class="${i === selIdx ? 'sel' : ''}">
        <span class="pdv-resultado-foto">${p.foto_path ? `<img src="/uploads/produtos/${encodeURIComponent(p.foto_path)}" alt="">` : (p.eh_servico ? '🧰' : '📦')}</span>
        <span class="pdv-resultado-info">
          <strong>${UI.escapar(p.nome)}</strong> — ${UI.moeda(p.preco_venda)}
          <span class="muted"> · ${p.eh_servico ? '<span class="badge badge--muted">serviço</span>' : 'estoque ' + UI.numero(p.estoque_atual)} · ${UI.escapar(p.codigo_barras || 's/ código')}</span>
        </span>
      </button>`).join('')}</div>`;
    alvo.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => adicionar(resultados[Number(b.dataset.i)])));
  }

  function onInputKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      adicionarDaBusca();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault(); moverSelecao(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); moverSelecao(-1);
    }
  }

  function moverSelecao(d) {
    if (!resultados.length) return;
    selIdx = Math.max(0, Math.min(resultados.length - 1, selIdx + d));
    document.querySelectorAll('#pdv-resultados [data-i]').forEach((b, i) => b.classList.toggle('sel', i === selIdx));
  }

  async function adicionarDaBusca() {
    const termo = document.getElementById('pdv-input').value.trim();
    if (!termo) return;
    // Se ainda nao buscou, busca agora (fluxo do leitor: digita e Enter).
    if (!resultados.length) {
      resultados = await API.get('/api/vendas/buscar-produto?termo=' + encodeURIComponent(termo)).catch(() => []);
    }
    if (resultados.length === 1) return adicionar(resultados[0]);
    if (resultados.length > 1) return adicionar(resultados[selIdx] || resultados[0]);
    UI.erro('Produto não encontrado.');
  }

  function adicionar(produto) {
    if (!produto) return;
    const existente = carrinho.find((i) => i.produto.id === produto.id);
    if (existente) existente.quantidade = arred(existente.quantidade + 1);
    else carrinho.push({ produto, quantidade: 1, preco: Number(produto.preco_venda) });
    // Vender sem custo cadastrado nao trava a venda (pode ser proposital, tipo
    // brinde), mas o CMV do DRE fica errado sem o usuario saber — melhor
    // avisar na hora do que descobrir so no relatorio do mes.
    if (!existente && (!produto.custo || Number(produto.custo) <= 0)) {
      UI.alerta(`"${produto.nome}" está sem custo cadastrado — a margem e o CMV desta venda vão sair errados.`);
    }
    limparBusca();
    renderCarrinho();
  }

  function limparBusca() {
    const inp = document.getElementById('pdv-input');
    inp.value = ''; document.getElementById('pdv-resultados').innerHTML = '';
    resultados = []; selIdx = 0; inp.focus();
  }

  function renderCarrinho() {
    const tb = document.getElementById('pdv-itens');
    if (!tb) return;
    if (!carrinho.length) {
      tb.innerHTML = '<tr><td colspan="5" class="vazio">Carrinho vazio. Bipe ou busque um produto.</td></tr>';
    } else {
      tb.innerHTML = carrinho.map((i, idx) => `<tr>
        <td>${UI.escapar(i.produto.nome)}</td>
        <td><input class="qtd" type="number" min="0" step="0.001" value="${i.quantidade}" data-qtd="${idx}" /></td>
        <td>${UI.moeda(i.preco)}</td>
        <td>${UI.moeda(arred(i.quantidade * i.preco))}</td>
        <td><button class="btn btn--secundario" data-rem="${idx}">✕</button></td>
      </tr>`).join('');
      tb.querySelectorAll('[data-qtd]').forEach((inp) => inp.addEventListener('input', () => {
        const idx = Number(inp.dataset.qtd);
        carrinho[idx].quantidade = Number(inp.value || 0);
        atualizarTotais();
      }));
      tb.querySelectorAll('[data-rem]').forEach((b) => b.addEventListener('click', () => {
        carrinho.splice(Number(b.dataset.rem), 1); renderCarrinho();
      }));
    }
    atualizarTotais();
  }

  function calcTotais() {
    const subtotal = arred(carrinho.reduce((s, i) => s + i.quantidade * i.preco, 0));
    const desconto = Number(document.getElementById('pdv-desconto').value || 0);
    const total = arred(Math.max(0, subtotal - desconto));
    return { subtotal, desconto, total };
  }

  function atualizarTotais() {
    const t = calcTotais();
    document.getElementById('pdv-qtd-itens').textContent = carrinho.reduce((s, i) => s + Number(i.quantidade), 0);
    document.getElementById('pdv-subtotal').textContent = UI.moeda(t.subtotal);
    document.getElementById('pdv-total').textContent = UI.moeda(t.total);
  }

  function limpar() {
    if (!carrinho.length) return;
    UI.confirmar('Limpar a venda atual?', { titulo: 'Limpar venda', textoConfirmar: 'Limpar' }).then((ok) => {
      if (ok) { carrinho = []; document.getElementById('pdv-desconto').value = 0; renderCarrinho(); limparBusca(); }
    });
  }

  // ----------------------- Pagamento / finalizar -----------------------
  function finalizar() {
    if (!carrinho.length) { UI.erro('Adicione itens antes de finalizar.'); return; }
    const t = calcTotais();
    let pagamentos = [{ forma_pagamento: 'dinheiro', valor: t.total }];

    const linhasHTML = () => pagamentos.map((p, i) => `
      <div class="pagamento-linha" data-i="${i}">
        <select data-forma="${i}">${FORMAS.map((f) => `<option value="${f[0]}" ${p.forma_pagamento === f[0] ? 'selected' : ''}>${f[1]}</option>`).join('')}</select>
        <input type="number" min="0" step="0.01" data-valor="${i}" value="${p.valor}" style="width:120px" />
        <button class="btn btn--secundario" data-rem="${i}">✕</button>
      </div>`).join('');

    Modal.abrir({
      titulo: `Pagamento — ${UI.moeda(t.total)}`,
      tamanho: 'modal--pequeno',
      corpoHTML: `
        <div id="pg-linhas">${linhasHTML()}</div>
        <button class="btn btn--secundario" id="pg-add" style="margin-top:8px">+ Adicionar forma</button>
        <hr style="margin:14px 0;border:none;border-top:1px solid var(--borda)" />
        <div class="flex flex--between"><span>Total a pagar</span><strong>${UI.moeda(t.total)}</strong></div>
        <div class="flex flex--between mt-16"><span>Informado</span><strong id="pg-informado">R$ 0,00</strong></div>
        <div class="flex flex--between mt-16"><span id="pg-lbl">Troco</span><strong id="pg-troco">R$ 0,00</strong></div>
        <div class="campo mt-16">
          <label>Cliente <span class="dica">(obrigatório para venda a prazo/fiado)</span></label>
          <select id="pg-cliente"><option value="">— sem cliente —</option></select>
        </div>
        <div class="campo mt-16" id="pg-venc-wrap" style="display:none">
          <label>Vencimento (venda a prazo)</label><input type="date" id="pg-venc" />
        </div>`,
      textoConfirmar: 'Concluir venda',
      aoAbrir: (el) => {
        // Carrega clientes para o seletor (venda a prazo/fiado).
        API.get('/api/clientes').then((cls) => {
          const sel = el.querySelector('#pg-cliente');
          if (!sel) return;
          sel.innerHTML = '<option value="">— sem cliente —</option>' +
            cls.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}${Number(c.saldo_devedor) > 0 ? ' (deve ' + UI.moeda(c.saldo_devedor) + ')' : ''}</option>`).join('');
          if (origemOS && origemOS.cliente_id) sel.value = String(origemOS.cliente_id);
          // So depois de carregar, para a dica de "nenhum cliente" nao piscar enquanto a lista vem.
          CadastroRapido.ligar(sel, 'cliente');
        }).catch(() => {});

        const recalc = () => {
          const informado = arred(pagamentos.reduce((s, p) => s + Number(p.valor || 0), 0));
          el.querySelector('#pg-informado').textContent = UI.moeda(informado);
          const diff = arred(informado - t.total);
          el.querySelector('#pg-lbl').textContent = diff >= 0 ? 'Troco' : 'Falta';
          el.querySelector('#pg-troco').textContent = UI.moeda(Math.abs(diff));
          const temPrazo = pagamentos.some((p) => p.forma_pagamento === 'prazo');
          el.querySelector('#pg-venc-wrap').style.display = temPrazo ? '' : 'none';
        };
        const religar = () => {
          el.querySelector('#pg-linhas').innerHTML = linhasHTML();
          el.querySelectorAll('[data-forma]').forEach((s) => s.addEventListener('change', () => { pagamentos[Number(s.dataset.forma)].forma_pagamento = s.value; recalc(); }));
          el.querySelectorAll('[data-valor]').forEach((inp) => inp.addEventListener('input', () => { pagamentos[Number(inp.dataset.valor)].valor = Number(inp.value || 0); recalc(); }));
          el.querySelectorAll('[data-rem]').forEach((b) => b.addEventListener('click', () => { if (pagamentos.length > 1) { pagamentos.splice(Number(b.dataset.rem), 1); religar(); recalc(); } }));
          recalc();
        };
        el.querySelector('#pg-add').addEventListener('click', () => {
          const t2 = calcTotais();
          const informado = pagamentos.reduce((s, p) => s + Number(p.valor || 0), 0);
          pagamentos.push({ forma_pagamento: 'dinheiro', valor: arred(Math.max(0, t2.total - informado)) });
          religar();
        });
        religar();
      },
      aoConfirmar: async (el) => {
        const vencInp = el.querySelector('#pg-venc');
        const clienteId = el.querySelector('#pg-cliente').value || null;
        const temPrazo = pagamentos.some((p) => p.forma_pagamento === 'prazo');
        if (temPrazo && !clienteId) { UI.erro('Selecione o cliente para a venda a prazo (fiado).'); return false; }
        try {
          const venda = await API.post('/api/vendas', {
            itens: carrinho.map((i) => ({ produto_id: i.produto.id, quantidade: i.quantidade, preco_unitario: i.preco })),
            desconto: t.desconto,
            pagamentos,
            cliente_id: clienteId,
            vencimento_prazo: vencInp && vencInp.value ? vencInp.value : null,
          });

          const osFinalizada = origemOS;
          if (osFinalizada) {
            try { await API.post(`/api/ordens/${osFinalizada.osId}/vincular-venda`, { venda_id: venda.id }); }
            catch (e2) { UI.erro('Venda concluída, mas houve erro ao vincular a ordem: ' + e2.message); }
            origemOS = null;
            const banner = document.getElementById('pdv-os-banner');
            if (banner) banner.remove();
          }

          carrinho = [];
          document.getElementById('pdv-desconto').value = 0;
          renderCarrinho(); limparBusca();
          caixa = await API.get('/api/caixa/atual').catch(() => caixa);
          renderCaixaBar();
          abrirConclusao(venda, osFinalizada);
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ----------------------- Conclusao / cupom -----------------------
  function abrirConclusao(venda, osInfo) {
    Modal.abrir({
      titulo: `✅ Venda #${venda.id} concluída`,
      tamanho: 'modal--pequeno',
      corpoHTML: `
        <div style="text-align:center">
          <div class="stat__value" style="color:var(--sucesso)">${UI.moeda(venda.valor_total)}</div>
          ${venda.troco > 0 ? `<p style="font-size:18px">Troco: <strong>${UI.moeda(venda.troco)}</strong></p>` : ''}
          <p class="muted">${venda.itens.length} item(ns)</p>
          ${osInfo ? `<p class="dica">🛠️ ${UI.escapar(osInfo.rotulo)} marcada como entregue.</p>` : ''}
        </div>`,
      textoConfirmar: '🖨️ Imprimir cupom',
      aoConfirmar: async () => { await imprimirCupom(venda); return false; },
      aoAbrir: (el) => {
        // Botao secundario "Nova venda" (fecha e foca a busca).
        const foot = el.querySelector('.modal__foot');
        const cancelar = foot.querySelector('[data-fechar]');
        if (cancelar) cancelar.textContent = 'Fechar';
        const b = document.createElement('button');
        b.className = 'btn btn--secundario'; b.textContent = 'Nova venda';
        b.addEventListener('click', () => { el.remove(); const i = document.getElementById('pdv-input'); if (i) i.focus(); });
        foot.insertBefore(b, foot.firstChild);
      },
    });
  }

  const NOMES_FORMA = { dinheiro: 'Dinheiro', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito', pix: 'PIX', prazo: 'A prazo' };

  async function imprimirCupom(venda) {
    let cfg = {};
    try { cfg = await API.get('/api/config'); } catch (_) { /* usa vazio */ }
    const linhaItens = venda.itens.map((i) => `
      <tr><td colspan="3">${escaparTxt(i.descricao || '')}</td></tr>
      <tr><td>${Number(i.quantidade)} x ${dinTxt(i.preco_unitario)}</td><td></td><td style="text-align:right">${dinTxt(i.valor_total)}</td></tr>`).join('');
    const pags = venda.pagamentos.map((p) => `<tr><td colspan="2">${NOMES_FORMA[p.forma_pagamento] || p.forma_pagamento}</td><td style="text-align:right">${dinTxt(p.valor)}</td></tr>`).join('');

    const html = `<html><head><meta charset="utf-8"><title>Cupom #${venda.id}</title>
      <style>
        * { font-family: 'Courier New', monospace; }
        body { width: 300px; margin: 0 auto; padding: 8px; color:#000; font-size:12px; }
        h2 { text-align:center; margin:4px 0; font-size:15px; }
        .center { text-align:center; }
        table { width:100%; border-collapse:collapse; }
        td { padding:1px 0; vertical-align:top; }
        hr { border:none; border-top:1px dashed #000; margin:6px 0; }
        .tot { font-size:14px; font-weight:bold; }
      </style></head><body>
      ${cfg.loja_logo ? `<div class="center"><img src="${cfg.loja_logo}" style="max-width:120px;max-height:60px;object-fit:contain"></div>` : ''}
      <h2>${escaparTxt(cfg.nome_loja || 'Comprovante de Venda')}</h2>
      <div class="center">
        ${cfg.loja_endereco ? escaparTxt(cfg.loja_endereco) + '<br>' : ''}
        ${cfg.loja_telefone ? 'Tel: ' + escaparTxt(cfg.loja_telefone) + '<br>' : ''}
        ${cfg.loja_cnpj ? 'CNPJ/CPF: ' + escaparTxt(cfg.loja_cnpj) : ''}
      </div>
      <hr>
      <div>Venda #${venda.id} — ${new Date().toLocaleString('pt-BR')}</div>
      <div class="center" style="font-size:10px">*** SEM VALOR FISCAL ***</div>
      <hr>
      <table>${linhaItens}</table>
      <hr>
      <table>
        <tr><td colspan="2">Subtotal</td><td style="text-align:right">${dinTxt(venda.valor_bruto)}</td></tr>
        ${Number(venda.desconto) > 0 ? `<tr><td colspan="2">Desconto</td><td style="text-align:right">-${dinTxt(venda.desconto)}</td></tr>` : ''}
        <tr class="tot"><td colspan="2">TOTAL</td><td style="text-align:right">${dinTxt(venda.valor_total)}</td></tr>
      </table>
      <hr>
      <table>${pags}${venda.troco > 0 ? `<tr><td colspan="2">Troco</td><td style="text-align:right">${dinTxt(venda.troco)}</td></tr>` : ''}</table>
      <hr>
      <div class="center">${escaparTxt(cfg.loja_rodape_cupom || 'Obrigado pela preferência!')}</div>
      </body></html>`;

    UI.imprimir(html);
  }

  function escaparTxt(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function dinTxt(v) { return Number(v || 0).toFixed(2).replace('.', ','); }

  // ----------------------- utils -----------------------
  function arred(n) { return Number(Number(n || 0).toFixed(2)); }

  return { titulo: 'PDV', render };
})();
