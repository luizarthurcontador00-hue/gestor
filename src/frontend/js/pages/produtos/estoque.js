'use strict';

/**
 * Conferencia de estoque (inventario): contagem fisica dos produtos contra o
 * saldo do sistema, com ajuste em lote ao finalizar. Sub-aba da pagina de
 * Produtos (window.PaginaProdutos, em produtos/index.js), que chama
 * `render(container, { preencherCategorias })` passando o preenchedor de
 * select de categorias ja carregado por ela — o unico ponto em comum com
 * o cadastro/CRUD de produtos.
 *
 * Nao confundir com a pagina "Conferência de Mercadoria" (pages/conferencia.js,
 * rota #/conferencia): aquela é o checklist de recebimento de um lote comprado;
 * esta é a contagem periódica do estoque já cadastrado.
 */
window.ProdutosEstoque = (function () {
  let confTodos = [];             // produtos carregados p/ conferencia (sem kits)
  const contagens = new Map();    // id -> valor digitado na contagem (string)
  let preencherCategorias = null; // injetado pelo chamador (produtos/index.js)

  async function render(container, { preencherCategorias: preencher } = {}) {
    preencherCategorias = preencher;
    container.innerHTML = `
      <div class="card mb-16" style="background:#eff6ff;border-color:#bfdbfe">
        <strong>📋 Conferência de estoque</strong>
        <p class="dica" style="margin-bottom:0">Conte fisicamente os produtos e informe a quantidade encontrada em <strong>Contagem</strong>.
        Ao <strong>finalizar</strong>, o saldo é ajustado para o valor contado e a diferença fica registrada no histórico de cada produto.
        Produtos deixados em branco não são alterados. Você também pode <strong>bipar o código de barras</strong> para somar +1 à contagem.</p>
      </div>
      <div class="barra-ferramentas">
        <input type="search" id="cf-scan" class="cresce" placeholder="Bipe o código de barras (soma +1) ou digite o nome e tecle Enter…" autocomplete="off" />
        <select id="cf-categoria"><option value="">Todas as categorias</option></select>
        <button class="btn btn--secundario" id="cf-preencher" title="Marca como conferidos, com o saldo atual, os produtos ainda não contados">✓ Não contados = saldo atual</button>
      </div>
      <div id="cf-resumo"></div>
      <div id="cf-tabela"><div class="card">Carregando…</div></div>
      <div class="barra-ferramentas" style="justify-content:flex-end;margin-top:16px">
        <button class="btn btn--secundario" id="cf-limpar">Limpar contagem</button>
        <button class="btn" id="cf-finalizar">✔️ Finalizar conferência</button>
      </div>
    `;

    preencherCategorias(container.querySelector('#cf-categoria'));

    const scan = container.querySelector('#cf-scan');
    scan.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      biparContagem(scan);
    });
    container.querySelector('#cf-categoria').addEventListener('change', renderTabelaConferencia);
    container.querySelector('#cf-preencher').addEventListener('click', preencherNaoContados);
    container.querySelector('#cf-limpar').addEventListener('click', limparContagem);
    container.querySelector('#cf-finalizar').addEventListener('click', finalizarConferencia);

    await carregarConferencia();
    scan.focus();
  }

  async function carregarConferencia() {
    const alvo = document.getElementById('cf-tabela');
    let itens;
    try { itens = await API.get('/api/produtos'); }
    catch (e) { if (alvo) alvo.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}</div>`; return; }
    // Kits não têm estoque próprio: ficam de fora da conferência.
    confTodos = itens.filter((p) => !p.eh_kit);
    renderTabelaConferencia();
  }

  function categoriaFiltroConf() {
    const sel = document.getElementById('cf-categoria');
    return sel ? sel.value : '';
  }

  function renderTabelaConferencia() {
    const alvo = document.getElementById('cf-tabela');
    if (!alvo) return;
    const cat = categoriaFiltroConf();
    const lista = confTodos.filter((p) => !cat || String(p.categoria_id) === String(cat));

    if (!confTodos.length) {
      alvo.innerHTML = '<div class="card vazio">Nenhum produto cadastrado para conferir.</div>';
      renderResumoConferencia();
      return;
    }
    if (!lista.length) {
      alvo.innerHTML = '<div class="card vazio">Nenhum produto nesta categoria.</div>';
      renderResumoConferencia();
      return;
    }

    alvo.innerHTML = `<table class="tabela tabela--conferencia">
      <thead><tr>
        <th>Produto</th><th>Un.</th>
        <th style="text-align:right">Saldo sistema</th>
        <th style="width:140px">Contagem</th>
        <th style="text-align:right">Diferença</th>
      </tr></thead>
      <tbody>${lista.map((p) => linhaConferencia(p)).join('')}</tbody>
    </table>`;

    alvo.querySelectorAll('[data-cf-id]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const id = Number(inp.dataset.cfId);
        if (inp.value === '') contagens.delete(id); else contagens.set(id, inp.value);
        atualizarLinhaConferencia(id);
        renderResumoConferencia();
      });
    });
    lista.forEach((p) => atualizarLinhaConferencia(p.id));
    renderResumoConferencia();
  }

  function linhaConferencia(p) {
    const val = contagens.has(p.id) ? contagens.get(p.id) : '';
    return `<tr data-cf-linha="${p.id}">
      <td>${UI.escapar(p.nome)}${p.codigo_barras ? `<div class="dica">${UI.escapar(p.codigo_barras)}</div>` : ''}</td>
      <td>${UI.escapar(p.unidade)}</td>
      <td style="text-align:right">${UI.numero(p.estoque_atual)}</td>
      <td><input type="number" step="0.001" min="0" data-cf-id="${p.id}" value="${val}" placeholder="—" style="width:130px;text-align:right"></td>
      <td class="cf-diff" style="text-align:right"></td>
    </tr>`;
  }

  function calcularDiferenca(id) {
    if (!contagens.has(id)) return null;
    const raw = contagens.get(id);
    if (raw === '' || raw == null) return null;
    const p = confTodos.find((x) => x.id === id);
    if (!p) return null;
    return Number((Number(raw) - Number(p.estoque_atual)).toFixed(3));
  }

  function atualizarLinhaConferencia(id) {
    const tr = document.querySelector(`[data-cf-linha="${id}"]`);
    if (!tr) return;
    const diff = calcularDiferenca(id);
    const cel = tr.querySelector('.cf-diff');
    if (diff == null) { cel.innerHTML = '<span class="muted">—</span>'; }
    else if (diff === 0) { cel.innerHTML = '<span class="badge badge--ok">confere</span>'; }
    else if (diff > 0) { cel.innerHTML = `<strong style="color:#15803d">+${UI.numero(diff)}</strong>`; }
    else { cel.innerHTML = `<strong style="color:#b91c1c">${UI.numero(diff)}</strong>`; }
    tr.classList.toggle('cf-linha--divergente', diff != null && diff !== 0);
    tr.classList.toggle('cf-linha--confere', diff === 0);
  }

  function renderResumoConferencia() {
    const alvo = document.getElementById('cf-resumo');
    if (!alvo) return;
    let contados = 0; let diverg = 0;
    for (const p of confTodos) {
      const diff = calcularDiferenca(p.id);
      if (diff == null) continue;
      contados++;
      if (diff !== 0) diverg++;
    }
    const cat = categoriaFiltroConf();
    const visiveis = confTodos.filter((p) => !cat || String(p.categoria_id) === String(cat)).length;
    alvo.innerHTML = `<div class="card mb-16" style="display:flex;gap:24px;flex-wrap:wrap;align-items:center;background:#f8fafc">
      <div><span class="stat__value" style="font-size:20px">${contados}</span> <span class="muted">de ${confTodos.length} contado(s)</span></div>
      <div><span class="stat__value" style="font-size:20px;color:${diverg ? '#b45309' : '#15803d'}">${diverg}</span> <span class="muted">divergência(s)</span></div>
      <div class="cresce"></div>
      <div class="muted">${visiveis} produto(s) nesta visão</div>
    </div>`;
  }

  function biparContagem(scan) {
    const termo = (scan.value || '').trim();
    if (!termo) return;
    const alvo = acharProdutoConferencia(termo);
    if (!alvo) { UI.erro(`Nenhum produto encontrado para "${termo}".`); scan.select(); return; }
    const atual = contagens.has(alvo.id) ? Number(contagens.get(alvo.id)) || 0 : 0;
    const nova = Number((atual + 1).toFixed(3));
    contagens.set(alvo.id, String(nova));
    scan.value = '';
    // Se estava filtrado por outra categoria, volta para "todas" para exibir o item.
    const catSel = document.getElementById('cf-categoria');
    if (catSel && catSel.value && String(alvo.categoria_id) !== String(catSel.value)) catSel.value = '';
    renderTabelaConferencia();
    destacarLinhaConferencia(alvo.id);
    UI.toast(`${alvo.nome}: contagem = ${nova}`, 'sucesso');
  }

  function acharProdutoConferencia(termo) {
    const t = termo.trim();
    const porCodigo = confTodos.find((p) => p.codigo_barras && String(p.codigo_barras) === t);
    if (porCodigo) return porCodigo;
    const alvo = t.toLowerCase();
    return confTodos.find((p) => (p.nome || '').toLowerCase().includes(alvo)) || null;
  }

  function destacarLinhaConferencia(id) {
    const tr = document.querySelector(`[data-cf-linha="${id}"]`);
    if (!tr) return;
    tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    tr.classList.add('cf-linha--destaque');
    setTimeout(() => tr.classList.remove('cf-linha--destaque'), 1200);
  }

  function preencherNaoContados() {
    const cat = categoriaFiltroConf();
    const lista = confTodos.filter((p) => !cat || String(p.categoria_id) === String(cat));
    let preenchidos = 0;
    for (const p of lista) {
      if (contagens.has(p.id)) continue;
      contagens.set(p.id, String(Number(p.estoque_atual)));
      preenchidos++;
    }
    renderTabelaConferencia();
    UI.toast(preenchidos ? `${preenchidos} produto(s) marcado(s) com o saldo atual.` : 'Todos os produtos desta visão já estavam contados.', 'info');
  }

  async function limparContagem() {
    if (!contagens.size) return;
    const ok = await UI.confirmar('Limpar todas as contagens digitadas nesta conferência?', { titulo: 'Limpar contagem', textoConfirmar: 'Limpar' });
    if (!ok) return;
    contagens.clear();
    renderTabelaConferencia();
  }

  async function finalizarConferencia() {
    const itens = [];
    let diverg = 0;
    for (const p of confTodos) {
      const diff = calcularDiferenca(p.id);
      if (diff == null) continue;
      itens.push({ id: p.id, contagem: Number(contagens.get(p.id)) });
      if (diff !== 0) diverg++;
    }
    if (!itens.length) { UI.erro('Informe a contagem de ao menos um produto antes de finalizar.'); return; }

    const ok = await UI.confirmar(
      `Você contou ${itens.length} produto(s), com ${diverg} divergência(s).\n\nO estoque será ajustado para os valores contados e a diferença ficará registrada no histórico. Confirmar?`,
      { titulo: 'Finalizar conferência', textoConfirmar: 'Ajustar estoque' }
    );
    if (!ok) return;

    try {
      const r = await API.post('/api/produtos/conferencia', { itens });
      UI.sucesso(`Conferência concluída: ${r.ajustados} ajuste(s) de estoque, ${r.sem_divergencia} sem divergência${r.erros ? `, ${r.erros} com erro` : ''}.`);
      contagens.clear();
      await carregarConferencia();
    } catch (e) { UI.erro(e.message); }
  }

  return { render };
})();
