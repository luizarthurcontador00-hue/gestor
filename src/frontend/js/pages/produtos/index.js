'use strict';

/**
 * Pagina de Produtos: listagem (cards) com busca, filtro por categoria e
 * alerta de estoque baixo; cadastro/edicao com foto; detalhe com imagem
 * ampliada, historico de movimentacoes e ajuste de estoque.
 *
 * A sub-aba "Conferência de estoque" (contagem fisica/inventario) vive em
 * produtos/estoque.js (window.ProdutosEstoque) — só compartilha com esta
 * pagina a lista de categorias e o preenchedor de <select>, passados em
 * render() na hora de trocar de aba.
 */
window.PaginaProdutos = (function () {
  let categorias = [];
  let fornecedores = [];
  let filtros = { busca: '', categoria_id: '', estoque_baixo: false };
  let modoSelecao = false;
  let selecionados = new Set();
  // Subgrupos da aba Produtos: 'lista' (cadastro) e 'conferencia' (inventario).
  let vista = 'lista';

  async function render(container) {
    await carregarAuxiliares();
    container.innerHTML = `
      <div class="subtabs">
        <button class="subtab ${vista === 'lista' ? 'subtab--ativa' : ''}" data-vista="lista">📦 Produtos</button>
        <button class="subtab ${vista === 'conferencia' ? 'subtab--ativa' : ''}" data-vista="conferencia">📋 Conferência de estoque</button>
      </div>
      <div id="prod-sub-conteudo"></div>
    `;
    container.querySelectorAll('[data-vista]').forEach((b) => b.addEventListener('click', () => {
      if (vista === b.dataset.vista) return;
      vista = b.dataset.vista;
      render(container);
    }));
    const alvo = container.querySelector('#prod-sub-conteudo');
    if (vista === 'conferencia') await window.ProdutosEstoque.render(alvo, { preencherCategorias: preencherSelectCategorias });
    else await renderLista(alvo);
  }

  async function renderLista(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <input type="search" id="pf-busca" class="cresce" placeholder="Buscar por nome ou código de barras…" />
        <select id="pf-categoria"><option value="">Todas as categorias</option></select>
        <label class="flex gap-12" style="align-items:center;font-size:14px">
          <input type="checkbox" id="pf-baixo" /> Só estoque baixo
        </label>
        <button class="btn btn--secundario" id="btn-categorias">🏷️ Categorias</button>
        <button class="btn btn--secundario" id="btn-fornecedores">🚚 Fornecedores</button>
        <button class="btn btn--secundario" id="btn-lote">📋 Cadastro em Lote</button>
        <button class="btn btn--secundario" id="btn-conferencia">🔍 Conferência de Mercadoria</button>
        <button class="btn btn--secundario" id="btn-etiquetas">🔖 Etiquetas</button>
        <button class="btn btn--secundario" id="btn-catalogo">📢 Catálogo</button>
        <button class="btn btn--secundario" id="btn-modo-selecao">☑️ Selecionar vários</button>
        <button class="btn" id="btn-novo">+ Novo produto</button>
      </div>
      <div id="barra-selecao" style="display:none"></div>
      <div id="produtos-lista"><div class="card">Carregando…</div></div>
    `;

    preencherSelectCategorias(container.querySelector('#pf-categoria'));
    container.querySelector('#pf-busca').value = filtros.busca || '';
    container.querySelector('#pf-categoria').value = filtros.categoria_id || '';
    container.querySelector('#pf-baixo').checked = !!filtros.estoque_baixo;

    const busca = container.querySelector('#pf-busca');
    busca.addEventListener('input', UI.debounce((e) => { filtros.busca = e.target.value; listar(); }, 250));
    container.querySelector('#pf-categoria').addEventListener('change', (e) => { filtros.categoria_id = e.target.value; listar(); });
    container.querySelector('#pf-baixo').addEventListener('change', (e) => { filtros.estoque_baixo = e.target.checked; listar(); });
    container.querySelector('#btn-novo').addEventListener('click', () => abrirFormProduto());
    container.querySelector('#btn-categorias').addEventListener('click', abrirGerenciadorCategorias);
    container.querySelector('#btn-fornecedores').addEventListener('click', abrirGerenciadorFornecedores);
    container.querySelector('#btn-lote').addEventListener('click', () => { location.hash = '#/lote'; });
    container.querySelector('#btn-conferencia').addEventListener('click', () => { location.hash = '#/conferencia'; });
    container.querySelector('#btn-etiquetas').addEventListener('click', () => { location.hash = '#/etiquetas'; });
    container.querySelector('#btn-catalogo').addEventListener('click', () => { location.hash = '#/catalogo'; });
    container.querySelector('#btn-modo-selecao').addEventListener('click', alternarModoSelecao);

    await listar();
  }

  function alternarModoSelecao() {
    modoSelecao = !modoSelecao;
    if (!modoSelecao) selecionados.clear();
    const btn = document.getElementById('btn-modo-selecao');
    if (btn) btn.textContent = modoSelecao ? '✕ Cancelar seleção' : '☑️ Selecionar vários';
    listar();
  }

  function renderBarraSelecao() {
    const alvo = document.getElementById('barra-selecao');
    if (!alvo) return;
    if (!modoSelecao || selecionados.size === 0) { alvo.style.display = 'none'; alvo.innerHTML = ''; return; }
    alvo.style.display = 'block';
    alvo.innerHTML = `<div class="card mb-16" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#eef2ff;border-color:#c7d2fe">
      <strong>${selecionados.size} produto(s) selecionado(s)</strong>
      <div class="cresce"></div>
      <button class="btn btn--secundario" id="sel-editar">✏️ Editar em lote</button>
      <button class="btn btn--perigo" id="sel-excluir">🗑️ Excluir selecionados</button>
    </div>`;
    alvo.querySelector('#sel-editar').addEventListener('click', abrirEdicaoEmLote);
    alvo.querySelector('#sel-excluir').addEventListener('click', excluirSelecionados);
  }

  async function carregarAuxiliares() {
    [categorias, fornecedores] = await Promise.all([
      API.get('/api/categorias'),
      API.get('/api/fornecedores'),
    ]);
  }

  function preencherSelectCategorias(select, selecionado) {
    const ehFiltro = select.id === 'pf-categoria' || select.id === 'cf-categoria';
    select.innerHTML = (ehFiltro ? '<option value="">Todas as categorias</option>' : '<option value="">Sem categoria</option>')
      + categorias.map((c) => `<option value="${c.id}" ${String(selecionado) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('');
  }

  async function listar() {
    const alvo = document.getElementById('produtos-lista');
    if (!alvo) return;
    const params = new URLSearchParams();
    if (filtros.busca) params.set('busca', filtros.busca);
    if (filtros.categoria_id) params.set('categoria_id', filtros.categoria_id);
    if (filtros.estoque_baixo) params.set('estoque_baixo', '1');

    let itens;
    try {
      itens = await API.get('/api/produtos?' + params.toString());
    } catch (e) {
      alvo.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}</div>`;
      return;
    }

    if (!itens.length) {
      alvo.innerHTML = `<div class="card vazio">Nenhum produto encontrado.
        <div class="mt-16"><button class="btn" onclick="document.getElementById('btn-novo').click()">Cadastrar o primeiro produto</button></div></div>`;
      return;
    }

    alvo.innerHTML = `<div class="produtos-grid">${itens.map((p) => cardProduto(p, modoSelecao)).join('')}</div>`;
    alvo.querySelectorAll('[data-produto]').forEach((el) => {
      const id = Number(el.dataset.produto);
      el.addEventListener('click', () => {
        if (modoSelecao) { alternarSelecao(id); return; }
        abrirDetalhe(id);
      });
    });
    renderBarraSelecao();
  }

  function alternarSelecao(id) {
    if (selecionados.has(id)) selecionados.delete(id);
    else selecionados.add(id);
    listar();
  }

  function cardProduto(p, selecao) {
    const baixo = !p.eh_kit && Number(p.estoque_atual) <= Number(p.estoque_minimo);
    const fotoHTML = p.foto_path
      ? `<img src="/uploads/produtos/${encodeURIComponent(p.foto_path)}" alt="">`
      : (p.eh_kit ? '🎁' : '📦');
    const marcado = selecionados.has(p.id);
    return `
      <div class="produto-card ${baixo ? 'estoque-baixo' : ''} ${marcado ? 'produto-card--selecionado' : ''}" data-produto="${p.id}">
        ${selecao ? `<div class="produto-card__check"><input type="checkbox" ${marcado ? 'checked' : ''} tabindex="-1" style="pointer-events:none"></div>` : ''}
        <div class="produto-card__foto">${fotoHTML}</div>
        <div class="produto-card__body">
          <div class="produto-card__nome">${p.eh_kit ? '<span class="badge badge--muted" style="margin-right:4px">Kit</span>' : ''}${UI.escapar(p.nome)}</div>
          <div class="produto-card__preco">${Number(p.preco_venda) > 0 ? UI.moeda(p.preco_venda) : '<span class="badge badge--alerta">definir preço</span>'}</div>
          <div class="produto-card__estoque">
            ${p.eh_kit ? 'Composto por outros produtos' : `Estoque: ${UI.numero(p.estoque_atual)} ${UI.escapar(p.unidade)}
            ${baixo ? '<span class="badge badge--alerta" style="margin-left:6px">baixo</span>' : ''}`}
          </div>
        </div>
      </div>`;
  }

  // ----------------------- Formulario de produto -----------------------
  function abrirFormProduto(produto) {
    const ehEdicao = !!produto;
    const p = produto || {};
    const corpo = `
      <form id="form-produto" class="form-grid">
        <div class="campo col-2">
          <label>Nome *</label>
          <input name="nome" required value="${UI.escapar(p.nome || '')}" />
        </div>
        <div class="campo">
          <label>Código de barras (EAN)</label>
          <input name="codigo_barras" value="${UI.escapar(p.codigo_barras || '')}" />
        </div>
        <div class="campo">
          <label>Unidade</label>
          <input name="unidade" value="${UI.escapar(p.unidade || 'UN')}" />
        </div>
        <div class="campo">
          <label>Categoria</label>
          <select name="categoria_id" id="fp-categoria"></select>
        </div>
        <div class="campo">
          <label>Fornecedor</label>
          <select name="fornecedor_id" id="fp-fornecedor"></select>
        </div>
        <div class="campo">
          <label>Custo (R$)</label>
          <input id="fp-custo" name="custo" type="number" step="0.01" min="0" value="${p.custo != null ? p.custo : ''}" />
        </div>
        <div class="campo">
          <label>Markup (%) <span class="dica">(opcional)</span></label>
          <input name="markup" type="number" step="0.01" min="0" value="${p.markup != null ? p.markup : ''}" />
        </div>
        <div class="campo">
          <label>Preço de venda (R$)</label>
          <input name="preco_venda" type="number" step="0.01" min="0" value="${p.preco_venda != null ? p.preco_venda : ''}" />
          <span class="dica">Deixe em branco para calcular pelo markup.</span>
        </div>
        <div class="campo" id="fp-estoque-wrap">
          <label>Estoque ${ehEdicao ? 'atual' : 'inicial'}</label>
          <input id="fp-estoque" name="estoque_atual" type="number" step="0.001" min="0" value="${p.estoque_atual != null ? p.estoque_atual : 0}" ${ehEdicao ? 'disabled' : ''} />
          ${ehEdicao ? '<span class="dica">Use "Ajustar estoque" no detalhe.</span>' : ''}
        </div>
        <div class="campo">
          <label>Estoque mínimo</label>
          <input name="estoque_minimo" type="number" step="0.001" min="0" value="${p.estoque_minimo != null ? p.estoque_minimo : 0}" />
        </div>
        <div class="campo col-2">
          <label>Descrição</label>
          <textarea name="descricao">${UI.escapar(p.descricao || '')}</textarea>
        </div>
        <div class="campo col-2" style="border-top:1px solid var(--borda);padding-top:16px">
          <label style="font-weight:600">🧾 Dados fiscais <span class="dica">(para emissão de NF-e/NFC-e — opcional até configurar o módulo fiscal)</span></label>
        </div>
        <div class="campo">
          <label>NCM</label>
          <input name="ncm" value="${UI.escapar(p.ncm || '')}" placeholder="Ex.: 61091000" maxlength="8" />
        </div>
        <div class="campo">
          <label>CFOP</label>
          <input name="cfop" value="${UI.escapar(p.cfop || '')}" placeholder="Ex.: 5102" maxlength="4" />
        </div>
        <div class="campo">
          <label>CST/CSOSN</label>
          <input name="cst_csosn" value="${UI.escapar(p.cst_csosn || '')}" placeholder="Ex.: 102 (consulte seu contador)" />
        </div>
        <div class="campo">
          <label>Origem da mercadoria</label>
          <select name="origem_mercadoria">
            ${[
              [0, '0 — Nacional'], [1, '1 — Estrangeira, importação direta'], [2, '2 — Estrangeira, mercado interno'],
              [3, '3 — Nacional, conteúdo importado > 40%'], [4, '4 — Nacional, produção conforme PPB'],
              [5, '5 — Nacional, conteúdo importado ≤ 40%'], [6, '6 — Estrangeira, importação direta, sem similar nacional'],
              [7, '7 — Estrangeira, mercado interno, sem similar nacional'], [8, '8 — Nacional, conteúdo importado > 70%'],
            ].map(([v, t]) => `<option value="${v}" ${Number(p.origem_mercadoria || 0) === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="campo col-2">
          <label class="flex gap-12" style="align-items:center">
            <input type="checkbox" id="fp-eh-kit" ${p.eh_kit ? 'checked' : ''}>
            🎁 Este produto é um Kit/Combo (composto por outros produtos)
          </label>
        </div>
        <div class="campo col-2" id="fp-kit-secao" style="display:${p.eh_kit ? 'block' : 'none'}">
          <div class="card" style="background:#f8fafc">
            <p class="dica" style="margin-top:0">O custo deste produto é calculado automaticamente pela soma dos itens abaixo. O estoque não é controlado neste produto — é baixado direto dos componentes a cada venda.</p>
            <input id="fp-kit-busca" placeholder="Buscar produto para adicionar ao kit…" style="width:100%" />
            <div id="fp-kit-resultados"></div>
            <table class="tabela mt-16">
              <thead><tr><th>Produto</th><th style="width:100px">Qtd.</th><th style="width:40px"></th></tr></thead>
              <tbody id="fp-kit-itens"><tr><td colspan="3" class="muted">Nenhum item adicionado.</td></tr></tbody>
            </table>
            <div class="flex flex--between mt-16">
              <span>Custo estimado do kit</span><strong id="fp-kit-custo">R$ 0,00</strong>
            </div>
          </div>
        </div>
        <div class="campo col-2">
          <label>Fotos do produto <span class="dica">(a 1ª é a principal; dá para ajustar o enquadramento e adicionar várias)</span></label>
          <div id="fp-galeria" class="galeria-fotos"></div>
          <input type="file" id="fp-foto" accept="image/*" multiple style="display:none" />
          <button type="button" class="btn btn--secundario mt-16" id="fp-add-foto">📷 Adicionar foto</button>
        </div>
      </form>`;

    // Galeria: em edicao mexe direto no servidor; em cadastro novo, fica em memoria
    // ate salvar o produto (quando ganha um id) e entao as fotos sao enviadas.
    let fotos = ehEdicao && Array.isArray(p.fotos) ? p.fotos.slice() : [];
    const novasFotos = []; // { blob, url } (apenas no cadastro novo)

    let kitItens = []; // { produto_componente_id, nome, custo, quantidade }

    function renderKitItens(el) {
      const tbody = el.querySelector('#fp-kit-itens');
      if (!kitItens.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="muted">Nenhum item adicionado.</td></tr>';
      } else {
        tbody.innerHTML = kitItens.map((it, i) => `<tr>
          <td>${UI.escapar(it.nome)}</td>
          <td><input type="number" step="0.001" min="0.001" value="${it.quantidade}" data-kit-qtd="${i}" style="width:100%" /></td>
          <td><button class="btn btn--secundario" data-kit-rem="${i}">✕</button></td>
        </tr>`).join('');
        tbody.querySelectorAll('[data-kit-qtd]').forEach((inp) => inp.addEventListener('input', () => {
          kitItens[Number(inp.dataset.kitQtd)].quantidade = Number(inp.value || 0);
          atualizarCustoKit(el);
        }));
        tbody.querySelectorAll('[data-kit-rem]').forEach((btn) => btn.addEventListener('click', () => {
          kitItens.splice(Number(btn.dataset.kitRem), 1);
          renderKitItens(el);
        }));
      }
      atualizarCustoKit(el);
    }

    function atualizarCustoKit(el) {
      const total = kitItens.reduce((s, it) => s + Number(it.custo) * Number(it.quantidade || 0), 0);
      el.querySelector('#fp-kit-custo').textContent = UI.moeda(total);
      const custoInput = el.querySelector('#fp-custo');
      if (custoInput) custoInput.value = total.toFixed(2);
    }

    function aplicarVisibilidadeKit(el) {
      const ehKit = el.querySelector('#fp-eh-kit').checked;
      el.querySelector('#fp-kit-secao').style.display = ehKit ? 'block' : 'none';
      const custoInput = el.querySelector('#fp-custo');
      custoInput.disabled = ehKit;
      const estoqueWrap = el.querySelector('#fp-estoque-wrap');
      estoqueWrap.style.opacity = ehKit ? '.5' : '1';
      el.querySelector('#fp-estoque').disabled = ehKit || ehEdicao;
    }

    Modal.abrir({
      titulo: ehEdicao ? 'Editar produto' : 'Novo produto',
      tamanho: 'modal--grande',
      corpoHTML: corpo,
      textoConfirmar: 'Salvar',
      aoAbrir: async (el) => {
        preencherSelectCategorias(el.querySelector('#fp-categoria'), p.categoria_id);
        const selF = el.querySelector('#fp-fornecedor');
        selF.innerHTML = '<option value="">Sem fornecedor</option>' +
          fornecedores.map((f) => `<option value="${f.id}" ${String(p.fornecedor_id) === String(f.id) ? 'selected' : ''}>${UI.escapar(f.nome)}</option>`).join('');
        // ---------------------------- Galeria de fotos ----------------------------
        const galeriaEl = el.querySelector('#fp-galeria');
        function renderGaleria() {
          const itens = ehEdicao
            ? fotos.map((f) => `
                <div class="galeria-item ${f.principal ? 'galeria-item--principal' : ''}">
                  <img src="/uploads/produtos/${encodeURIComponent(f.arquivo)}" alt="">
                  ${f.principal ? '<span class="galeria-item__tag">principal</span>' : `<button type="button" class="galeria-item__btn galeria-item__btn--estrela" data-principal="${f.id}" title="Tornar principal">★</button>`}
                  <button type="button" class="galeria-item__btn galeria-item__btn--x" data-remover="${f.id}" title="Remover">✕</button>
                </div>`).join('')
            : novasFotos.map((nf, i) => `
                <div class="galeria-item ${i === 0 ? 'galeria-item--principal' : ''}">
                  <img src="${nf.url}" alt="">
                  ${i === 0 ? '<span class="galeria-item__tag">principal</span>' : `<button type="button" class="galeria-item__btn galeria-item__btn--estrela" data-principal-nova="${i}" title="Tornar principal">★</button>`}
                  <button type="button" class="galeria-item__btn galeria-item__btn--x" data-remover-nova="${i}" title="Remover">✕</button>
                </div>`).join('');
          galeriaEl.innerHTML = itens || '<div class="galeria-vazia">📷 Sem fotos ainda</div>';

          galeriaEl.querySelectorAll('[data-principal]').forEach((b) => b.addEventListener('click', async () => {
            try { fotos = await API.post(`/api/produtos/${p.id}/fotos/${b.dataset.principal}/principal`, {}); renderGaleria(); }
            catch (e) { UI.erro(e.message); }
          }));
          galeriaEl.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', async () => {
            try { fotos = await API.del(`/api/produtos/${p.id}/fotos/${b.dataset.remover}`); renderGaleria(); }
            catch (e) { UI.erro(e.message); }
          }));
          galeriaEl.querySelectorAll('[data-principal-nova]').forEach((b) => b.addEventListener('click', () => {
            const i = Number(b.dataset.principalNova);
            const [item] = novasFotos.splice(i, 1); novasFotos.unshift(item); renderGaleria();
          }));
          galeriaEl.querySelectorAll('[data-remover-nova]').forEach((b) => b.addEventListener('click', () => {
            const i = Number(b.dataset.removerNova);
            URL.revokeObjectURL(novasFotos[i].url); novasFotos.splice(i, 1); renderGaleria();
          }));
        }
        renderGaleria();

        const foto = el.querySelector('#fp-foto');
        el.querySelector('#fp-add-foto').addEventListener('click', () => foto.click());
        foto.addEventListener('change', async () => {
          const arquivos = Array.from(foto.files);
          foto.value = '';
          for (const arq of arquivos) {
            const blob = await ajustarFoto(arq); // abre o editor de enquadramento
            if (!blob) continue;
            if (ehEdicao) {
              try {
                const fd = new FormData();
                fd.append('fotos', blob, 'foto.jpg');
                fotos = await enviarMultipart('POST', `/api/produtos/${p.id}/fotos`, fd);
                renderGaleria();
              } catch (e) { UI.erro(e.message); }
            } else {
              novasFotos.push({ blob, url: URL.createObjectURL(blob) });
              renderGaleria();
            }
          }
        });

        // ----- Kit: alternancia de visibilidade e carga da composicao atual -----
        el.querySelector('#fp-eh-kit').addEventListener('change', () => aplicarVisibilidadeKit(el));
        aplicarVisibilidadeKit(el);

        if (ehEdicao && p.eh_kit) {
          try {
            const comp = await API.get(`/api/produtos/${p.id}/composicao`);
            kitItens = comp.map((c) => ({ produto_componente_id: c.produto_componente_id, nome: c.nome, custo: c.custo, quantidade: c.quantidade }));
          } catch (_) { kitItens = []; }
        }
        renderKitItens(el);

        const buscaKit = el.querySelector('#fp-kit-busca');
        const resultadosKit = el.querySelector('#fp-kit-resultados');
        buscaKit.addEventListener('input', UI.debounce(async () => {
          const termo = buscaKit.value.trim();
          if (!termo) { resultadosKit.innerHTML = ''; return; }
          const achados = await API.get('/api/vendas/buscar-produto?termo=' + encodeURIComponent(termo)).catch(() => []);
          const candidatos = achados.filter((c) => !ehEdicao || c.id !== p.id);
          if (!candidatos.length) { resultadosKit.innerHTML = '<div class="dica">Nenhum produto encontrado.</div>'; return; }
          resultadosKit.innerHTML = `<div class="pdv-resultados">${candidatos.map((c) => `
            <button type="button" data-add-kit="${c.id}">${UI.escapar(c.nome)} <span class="muted">— ${UI.moeda(c.custo)} custo</span></button>
          `).join('')}</div>`;
          resultadosKit.querySelectorAll('[data-add-kit]').forEach((btn) => btn.addEventListener('click', () => {
            const id = Number(btn.dataset.addKit);
            const produto = candidatos.find((c) => c.id === id);
            if (kitItens.some((it) => it.produto_componente_id === id)) { UI.erro('Este produto já está no kit.'); return; }
            kitItens.push({ produto_componente_id: id, nome: produto.nome, custo: produto.custo, quantidade: 1 });
            buscaKit.value = ''; resultadosKit.innerHTML = '';
            renderKitItens(el);
          }));
        }, 250));
      },
      aoConfirmar: async (el) => {
        const form = el.querySelector('#form-produto');
        if (!form.nome.value.trim()) { UI.erro('Informe o nome do produto.'); return false; }
        const ehKit = el.querySelector('#fp-eh-kit').checked;
        if (ehKit && !kitItens.length) { UI.erro('Adicione ao menos um produto para compor o kit.'); return false; }

        const fd = new FormData(form);
        fd.set('eh_kit', ehKit ? '1' : '0'); // sempre explicito (checkbox desmarcado nao envia o campo)
        fd.delete('foto'); // fotos agora sao gerenciadas pela galeria

        try {
          let salvo;
          if (ehEdicao) {
            salvo = await enviarMultipart('PUT', `/api/produtos/${produto.id}`, fd);
          } else {
            salvo = await enviarMultipart('POST', '/api/produtos', fd);
            // Cadastro novo: envia as fotos preparadas para o produto recem-criado.
            if (novasFotos.length) {
              const fdFotos = new FormData();
              novasFotos.forEach((nf) => fdFotos.append('fotos', nf.blob, 'foto.jpg'));
              try { await enviarMultipart('POST', `/api/produtos/${salvo.id}/fotos`, fdFotos); }
              catch (e) { UI.erro('Produto salvo, mas houve erro ao enviar as fotos: ' + e.message); }
              novasFotos.forEach((nf) => URL.revokeObjectURL(nf.url));
            }
          }
          if (ehKit) {
            await API.put(`/api/produtos/${salvo.id}/composicao`, {
              itens: kitItens.map((it) => ({ produto_componente_id: it.produto_componente_id, quantidade: it.quantidade })),
            });
          }
          UI.sucesso(ehEdicao ? 'Produto atualizado.' : 'Produto cadastrado.');
          await carregarAuxiliares();
          await listar();
        } catch (e) {
          UI.erro(e.message); return false;
        }
      },
    });
  }

  // ----------------------- Detalhe do produto -----------------------
  // ----------------------- Acoes em lote (selecao multipla) -----------------------
  async function excluirSelecionados() {
    const ids = Array.from(selecionados);
    const ok = await UI.confirmar(
      `Excluir ${ids.length} produto(s) selecionado(s)? Produtos com histórico (vendas ou movimentações) serão apenas inativados, não removidos.`,
      { titulo: 'Excluir selecionados', textoConfirmar: 'Excluir' }
    );
    if (!ok) return;
    try {
      const r = await API.post('/api/produtos/lote-excluir', { ids });
      UI.sucesso(`${r.excluidos} excluído(s), ${r.inativados} inativado(s)${r.erros ? `, ${r.erros} com erro` : ''}.`);
      selecionados.clear();
      await listar();
    } catch (e) { UI.erro(e.message); }
  }

  function abrirEdicaoEmLote() {
    const ids = Array.from(selecionados);
    Modal.abrir({
      titulo: `Editar ${ids.length} produto(s) em lote`, tamanho: 'modal--pequeno',
      corpoHTML: `
        <p class="dica" style="margin-top:0">Marque só os campos que quer alterar. Os não marcados permanecem como estão em cada produto.</p>
        <div class="campo">
          <label><input type="checkbox" id="el-chk-cat"> Categoria</label>
          <select id="el-categoria" disabled><option value="">Sem categoria</option>${categorias.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select>
        </div>
        <div class="campo mt-16">
          <label><input type="checkbox" id="el-chk-forn"> Fornecedor</label>
          <select id="el-fornecedor" disabled><option value="">Sem fornecedor</option>${fornecedores.map((f) => `<option value="${f.id}">${UI.escapar(f.nome)}</option>`).join('')}</select>
        </div>
        <div class="campo mt-16">
          <label><input type="checkbox" id="el-chk-und"> Unidade</label>
          <input id="el-unidade" disabled />
        </div>
        <div class="campo mt-16">
          <label><input type="checkbox" id="el-chk-estmin"> Estoque mínimo</label>
          <input id="el-estmin" type="number" step="0.001" min="0" disabled />
        </div>
        <div class="campo mt-16">
          <label><input type="checkbox" id="el-chk-status"> Status</label>
          <select id="el-status" disabled><option value="1">Ativo</option><option value="0">Inativo</option></select>
        </div>`,
      textoConfirmar: 'Aplicar aos selecionados',
      aoAbrir: (el) => {
        const ligar = (chkId, campoId) => {
          const chk = el.querySelector(chkId);
          const campo = el.querySelector(campoId);
          chk.addEventListener('change', () => { campo.disabled = !chk.checked; });
        };
        ligar('#el-chk-cat', '#el-categoria');
        ligar('#el-chk-forn', '#el-fornecedor');
        ligar('#el-chk-und', '#el-unidade');
        ligar('#el-chk-estmin', '#el-estmin');
        ligar('#el-chk-status', '#el-status');
      },
      aoConfirmar: async (el) => {
        const campos = {};
        if (el.querySelector('#el-chk-cat').checked) campos.categoria_id = el.querySelector('#el-categoria').value || null;
        if (el.querySelector('#el-chk-forn').checked) campos.fornecedor_id = el.querySelector('#el-fornecedor').value || null;
        if (el.querySelector('#el-chk-und').checked) campos.unidade = el.querySelector('#el-unidade').value;
        if (el.querySelector('#el-chk-estmin').checked) campos.estoque_minimo = el.querySelector('#el-estmin').value;
        if (el.querySelector('#el-chk-status').checked) campos.ativo = el.querySelector('#el-status').value === '1';

        if (!Object.keys(campos).length) { UI.erro('Marque ao menos um campo para alterar.'); return false; }

        try {
          const r = await API.post('/api/produtos/lote-editar', { ids, campos });
          UI.sucesso(`${r.atualizados} produto(s) atualizado(s)${r.erros ? `, ${r.erros} com erro` : ''}.`);
          selecionados.clear();
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function abrirDetalhe(id) {
    let p, movs, composicao = null;
    try {
      [p, movs] = await Promise.all([
        API.get(`/api/produtos/${id}`),
        API.get(`/api/produtos/${id}/movimentacoes`),
      ]);
      if (p.eh_kit) composicao = await API.get(`/api/produtos/${id}/composicao`).catch(() => []);
    } catch (e) { UI.erro(e.message); return; }

    const baixo = !p.eh_kit && Number(p.estoque_atual) <= Number(p.estoque_minimo);
    const corpo = `
      ${p.eh_kit ? '<span class="badge badge--muted mb-16" style="display:inline-block">🎁 Kit / Combo</span>' : ''}
      <div class="flex gap-12" style="align-items:flex-start;flex-wrap:wrap">
        <div>
          <div class="foto-preview" id="det-foto" style="width:180px;height:180px">
            ${p.foto_path ? `<img src="/uploads/produtos/${encodeURIComponent(p.foto_path)}">` : (p.eh_kit ? '🎁' : '📦')}
          </div>
          ${p.fotos && p.fotos.length > 1 ? `<div class="det-miniaturas" id="det-miniaturas">
            ${p.fotos.map((f) => `<img src="/uploads/produtos/${encodeURIComponent(f.arquivo)}" data-foto-src="/uploads/produtos/${encodeURIComponent(f.arquivo)}" class="${f.principal ? 'ativa' : ''}" alt="">`).join('')}
          </div>` : ''}
        </div>
        <div style="flex:1;min-width:220px">
          <table class="tabela">
            <tr><th>Preço de venda</th><td>${UI.moeda(p.preco_venda)}</td></tr>
            <tr><th>Custo</th><td>${UI.moeda(p.custo)}${p.eh_kit ? ' <span class="dica">(soma dos componentes)</span>' : ''}</td></tr>
            ${p.eh_kit
              ? '<tr><th>Estoque</th><td class="muted">Controlado pelos componentes</td></tr>'
              : `<tr><th>Estoque</th><td>${UI.numero(p.estoque_atual)} ${UI.escapar(p.unidade)} ${baixo ? '<span class="badge badge--alerta">baixo</span>' : ''}</td></tr>
                 <tr><th>Estoque mínimo</th><td>${UI.numero(p.estoque_minimo)}</td></tr>`}
            <tr><th>Categoria</th><td>${UI.escapar(p.categoria_nome || '—')}</td></tr>
            <tr><th>Fornecedor</th><td>${UI.escapar(p.fornecedor_nome || '—')}</td></tr>
            <tr><th>Cód. barras</th><td>${UI.escapar(p.codigo_barras || '—')}</td></tr>
            ${p.grupo_variacao ? `<tr><th>Variação</th><td>${UI.escapar(p.grupo_variacao)}${p.variacao ? ' — ' + UI.escapar(p.variacao) : ''}</td></tr>` : ''}
          </table>
          ${p.descricao ? `<p class="muted mt-16">${UI.escapar(p.descricao)}</p>` : ''}
        </div>
      </div>
      ${composicao && composicao.length ? `
        <h3 class="mt-16">Itens do kit</h3>
        <table class="tabela">
          <thead><tr><th>Produto</th><th>Qtd.</th><th>Custo</th></tr></thead>
          <tbody>${composicao.map((c) => `<tr><td>${UI.escapar(c.nome)}</td><td>${UI.numero(c.quantidade)} ${UI.escapar(c.unidade)}</td><td>${UI.moeda(c.custo)}</td></tr>`).join('')}</tbody>
        </table>` : ''}
      <h3 class="mt-16">Histórico de movimentações</h3>
      <div style="max-height:220px;overflow:auto">
        ${movs.length ? `<table class="tabela">
          <thead><tr><th>Data</th><th>Tipo</th><th>Qtd</th><th>Saldo</th><th>Origem</th><th>Obs.</th></tr></thead>
          <tbody>${movs.map((m) => `<tr>
            <td>${UI.dataHora(m.data)}</td>
            <td>${m.tipo === 'entrada' ? '⬆️ entrada' : '⬇️ saída'}</td>
            <td>${UI.numero(m.quantidade)}</td>
            <td>${UI.numero(m.estoque_apos)}</td>
            <td>${UI.escapar(m.origem)}</td>
            <td>${UI.escapar(m.observacao || '')}</td>
          </tr>`).join('')}</tbody>
        </table>` : '<p class="muted">Sem movimentações.</p>'}
      </div>`;

    Modal.abrir({
      titulo: p.nome,
      tamanho: 'modal--grande',
      corpoHTML: corpo,
      mostrarConfirmar: false,
      aoAbrir: (el) => {
        const mini = el.querySelector('#det-miniaturas');
        if (mini) mini.querySelectorAll('[data-foto-src]').forEach((img) => img.addEventListener('click', () => {
          const grande = el.querySelector('#det-foto');
          if (grande) grande.innerHTML = `<img src="${img.dataset.fotoSrc}">`;
          mini.querySelectorAll('img').forEach((x) => x.classList.toggle('ativa', x === img));
        }));
        const foot = el.querySelector('.modal__foot');
        foot.innerHTML = `
          <button class="btn btn--perigo" data-excluir>Excluir</button>
          <button class="btn btn--secundario" data-etiqueta>🔖 Imprimir etiqueta</button>
          <button class="btn btn--secundario" data-ajustar>Ajustar estoque</button>
          <button class="btn" data-editar>Editar</button>`;
        foot.querySelector('[data-editar]').addEventListener('click', () => { el.remove(); abrirFormProduto(p); });
        foot.querySelector('[data-ajustar]').addEventListener('click', () => { el.remove(); abrirAjusteEstoque(p); });
        foot.querySelector('[data-etiqueta]').addEventListener('click', () => imprimirEtiquetaRapida(p));
        foot.querySelector('[data-excluir]').addEventListener('click', async () => {
          const ok = await UI.confirmar(`Excluir o produto "${p.nome}"? Se houver histórico, ele será apenas inativado.`, { titulo: 'Excluir produto', textoConfirmar: 'Excluir' });
          if (!ok) return;
          try {
            const r = await API.del(`/api/produtos/${p.id}`);
            UI.sucesso(r.inativado ? 'Produto inativado (tinha histórico).' : 'Produto excluído.');
            el.remove(); await listar();
          } catch (e) { UI.erro(e.message); }
        });
      },
    });
  }

  function imprimirEtiquetaRapida(p) {
    Modal.abrir({
      titulo: `Imprimir etiqueta — ${p.nome}`, tamanho: 'modal--pequeno',
      corpoHTML: `<div class="campo"><label>Quantidade de etiquetas</label>
        <input id="et-qtd-rapida" type="number" min="1" value="1" /></div>
        ${!p.codigo_barras ? '<p class="dica mt-16">Este produto ainda não tem código de barras — um código interno será gerado e salvo no cadastro.</p>' : ''}`,
      textoConfirmar: 'Imprimir',
      aoConfirmar: async (el) => {
        const qtd = Math.max(1, Number(el.querySelector('#et-qtd-rapida').value || 1));
        if (!window.PaginaEtiquetas) { UI.erro('Módulo de etiquetas indisponível.'); return false; }
        await window.PaginaEtiquetas.imprimirIds(new Map([[p.id, { qtd }]]));
      },
    });
  }

  function abrirAjusteEstoque(p) {
    Modal.abrir({
      titulo: `Ajustar estoque — ${p.nome}`,
      tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo">
          <label>Estoque atual</label>
          <input value="${UI.numero(p.estoque_atual)} ${UI.escapar(p.unidade)}" disabled />
        </div>
        <div class="campo mt-16">
          <label>Nova quantidade contada *</label>
          <input id="aj-qtd" type="number" step="0.001" min="0" value="${p.estoque_atual}" />
        </div>
        <div class="campo mt-16">
          <label>Motivo</label>
          <input id="aj-motivo" placeholder="Ex.: inventário, perda, quebra" />
        </div>`,
      textoConfirmar: 'Salvar ajuste',
      aoConfirmar: async (el) => {
        const qtd = el.querySelector('#aj-qtd').value;
        try {
          await API.post(`/api/produtos/${p.id}/estoque`, { quantidade: Number(qtd), motivo: el.querySelector('#aj-motivo').value });
          UI.sucesso('Estoque ajustado.');
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ----------------------- Gerenciadores auxiliares -----------------------
  async function abrirGerenciadorCategorias() {
    await carregarAuxiliares();
    const corpo = `
      <form id="form-cat" class="barra-ferramentas" style="margin-bottom:16px">
        <input name="nome" class="cresce" placeholder="Nome da categoria" required />
        <input name="markup_padrao" type="number" step="0.01" min="0" placeholder="Markup % (opcional)" style="width:150px" />
        <button class="btn" type="submit">Adicionar</button>
      </form>
      <div id="lista-cat"></div>`;
    Modal.abrir({
      titulo: 'Categorias', tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        const render = () => {
          el.querySelector('#lista-cat').innerHTML = categorias.length ? `<table class="tabela">
            <thead><tr><th>Nome</th><th>Markup padrão</th><th>Produtos</th><th></th></tr></thead>
            <tbody>${categorias.map((c) => `<tr>
              <td>${UI.escapar(c.nome)}</td>
              <td>${c.markup_padrao != null ? c.markup_padrao + '%' : '—'}</td>
              <td>${c.total_produtos}</td>
              <td style="text-align:right"><button class="btn btn--secundario" data-del="${c.id}" ${c.total_produtos > 0 ? 'disabled title="Há produtos nesta categoria"' : ''}>Excluir</button></td>
            </tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhuma categoria.</p>';
          el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
            const ok = await UI.confirmar('Excluir esta categoria?', { titulo: 'Excluir categoria', textoConfirmar: 'Excluir' });
            if (!ok) return;
            try { await API.del(`/api/categorias/${b.dataset.del}`); categorias = await API.get('/api/categorias'); render(); UI.sucesso('Categoria excluída.'); }
            catch (e) { UI.erro(e.message); }
          }));
        };
        render();
        el.querySelector('#form-cat').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const f = ev.target;
          try {
            await API.post('/api/categorias', { nome: f.nome.value, markup_padrao: f.markup_padrao.value });
            f.reset(); categorias = await API.get('/api/categorias'); render(); UI.sucesso('Categoria adicionada.');
          } catch (e) { UI.erro(e.message); }
        });
      },
    });
  }

  async function abrirGerenciadorFornecedores() {
    await carregarAuxiliares();
    const corpo = `
      <form id="form-forn" class="form-grid" style="margin-bottom:16px">
        <div class="campo col-2"><label>Nome / Razão social *</label><input name="nome" required /></div>
        <div class="campo"><label>CNPJ</label><input name="cnpj" /></div>
        <div class="campo"><label>Telefone</label><input name="telefone" /></div>
        <div class="campo"><label>Contato</label><input name="contato" /></div>
        <div class="campo"><label>E-mail</label><input name="email" type="email" /></div>
        <div class="campo col-2"><button class="btn" type="submit">Adicionar fornecedor</button></div>
      </form>
      <div id="lista-forn"></div>`;
    Modal.abrir({
      titulo: 'Fornecedores', tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        UI.ligarMascaraDocumento(el.querySelector('[name="cnpj"]'));
        const render = () => {
          el.querySelector('#lista-forn').innerHTML = fornecedores.length ? `<table class="tabela">
            <thead><tr><th>Nome</th><th>CNPJ</th><th>Telefone</th><th></th></tr></thead>
            <tbody>${fornecedores.map((f) => `<tr>
              <td>${UI.escapar(f.nome)}</td><td>${UI.escapar(f.cnpj || '—')}</td><td>${UI.escapar(f.telefone || '—')}</td>
              <td style="text-align:right"><button class="btn btn--secundario" data-del="${f.id}">Excluir</button></td>
            </tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhum fornecedor.</p>';
          el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
            const ok = await UI.confirmar('Excluir este fornecedor?', { titulo: 'Excluir fornecedor', textoConfirmar: 'Excluir' });
            if (!ok) return;
            try { await API.del(`/api/fornecedores/${b.dataset.del}`); fornecedores = await API.get('/api/fornecedores'); render(); UI.sucesso('Fornecedor excluído.'); }
            catch (e) { UI.erro(e.message); }
          }));
        };
        render();
        el.querySelector('#form-forn').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const f = ev.target;
          try {
            await API.post('/api/fornecedores', {
              nome: f.nome.value, cnpj: f.cnpj.value, telefone: f.telefone.value, contato: f.contato.value, email: f.email.value,
            });
            f.reset(); fornecedores = await API.get('/api/fornecedores'); render(); UI.sucesso('Fornecedor adicionado.');
          } catch (e) { UI.erro(e.message); }
        });
      },
    });
  }

  // ----------------------- utilitarios -----------------------
  async function enviarMultipart(metodo, url, formData) {
    const resp = await fetch(url, { method: metodo, body: formData });
    const texto = await resp.text();
    let dados = null;
    if (texto) { try { dados = JSON.parse(texto); } catch (_) { dados = texto; } }
    if (!resp.ok) throw new Error((dados && dados.erro) ? dados.erro : 'Erro ao salvar.');
    return dados;
  }

  /**
   * Editor de enquadramento (ajuste) da foto: mostra a imagem num quadro,
   * permite arrastar e dar zoom, e devolve um Blob JPEG quadrado (ou null se
   * o usuario cancelar).
   */
  function ajustarFoto(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const F = 300; // tamanho do quadro na tela (px)
      const O = 640; // tamanho da imagem final (px)
      let escala = 1; let baseEscala = 1; let tx = 0; let ty = 0; let natW = 0; let natH = 0;
      let concluido = false;

      const fechar = Modal.abrir({
        titulo: 'Ajustar foto', tamanho: 'modal--pequeno',
        corpoHTML: `
          <p class="dica" style="margin-top:0">Arraste a imagem e use o zoom para enquadrar. A área dentro do quadro será salva.</p>
          <div class="cropper-frame" id="cr-frame" style="width:${F}px;height:${F}px">
            <img id="cr-img" src="${url}" draggable="false" alt="">
          </div>
          <div class="campo mt-16"><label>Zoom</label><input id="cr-zoom" type="range" min="1" max="4" step="0.01" value="1" style="width:100%"></div>`,
        textoConfirmar: 'Usar foto',
        aoAbrir: (el) => {
          const img = el.querySelector('#cr-img');
          const frame = el.querySelector('#cr-frame');
          const zoom = el.querySelector('#cr-zoom');
          function clamp() {
            const w = natW * escala; const h = natH * escala;
            tx = Math.min(0, Math.max(F - w, tx));
            ty = Math.min(0, Math.max(F - h, ty));
          }
          function aplicar() {
            img.style.width = (natW * escala) + 'px';
            img.style.height = (natH * escala) + 'px';
            img.style.left = tx + 'px';
            img.style.top = ty + 'px';
          }
          function init() {
            natW = img.naturalWidth; natH = img.naturalHeight;
            baseEscala = Math.max(F / natW, F / natH);
            escala = baseEscala;
            tx = (F - natW * escala) / 2; ty = (F - natH * escala) / 2;
            clamp(); aplicar();
          }
          if (img.complete && img.naturalWidth) init(); else img.onload = init;
          zoom.addEventListener('input', () => { escala = baseEscala * Number(zoom.value); clamp(); aplicar(); });

          let arrastando = false; let px = 0; let py = 0;
          const ponto = (e) => (e.touches ? e.touches[0] : e);
          const down = (e) => { arrastando = true; const pt = ponto(e); px = pt.clientX; py = pt.clientY; };
          const move = (e) => {
            if (!arrastando) return;
            const pt = ponto(e); tx += pt.clientX - px; ty += pt.clientY - py; px = pt.clientX; py = pt.clientY;
            clamp(); aplicar(); if (e.cancelable) e.preventDefault();
          };
          const up = () => { arrastando = false; };
          frame.addEventListener('mousedown', down);
          frame.addEventListener('touchstart', down, { passive: true });
          window.addEventListener('mousemove', move);
          frame.addEventListener('touchmove', move, { passive: false });
          window.addEventListener('mouseup', up);
          frame.addEventListener('touchend', up);
          el._exportar = () => {
            const canvas = document.createElement('canvas');
            canvas.width = O; canvas.height = O;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, O, O);
            const r = O / F;
            ctx.drawImage(img, tx * r, ty * r, natW * escala * r, natH * escala * r);
            return new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
          };
          el._limpar = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
          };
          // Cancelar / fechar sem confirmar -> resolve(null).
          el.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => {
            if (!concluido) { concluido = true; el._limpar(); URL.revokeObjectURL(url); resolve(null); }
          }));
        },
        aoConfirmar: async (el) => {
          concluido = true;
          const blob = await el._exportar();
          el._limpar();
          URL.revokeObjectURL(url);
          resolve(blob);
        },
      });
      // Escape/click-fora fecham o overlay sem passar pelos handlers acima:
      // garante o resolve(null) observando a remocao do modal.
      const overlay = document.querySelector('.modal-overlay:last-child');
      if (overlay) {
        const obs = new MutationObserver(() => {
          if (!document.body.contains(overlay) && !concluido) {
            concluido = true; URL.revokeObjectURL(url); resolve(null); obs.disconnect();
          }
        });
        obs.observe(document.body, { childList: true });
      }
      void fechar;
    });
  }

  return { titulo: 'Produtos', render };
})();
