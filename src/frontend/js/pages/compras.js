'use strict';

/**
 * Pagina de Compras: importacao de NF-e (XML) em dois passos (preview ->
 * confirmacao, completando produtos novos), historico de notas importadas, e
 * pedidos de compra (rascunho enviado ao fornecedor, antes da mercadoria
 * chegar — quando chegar, continua sendo a importacao de NF-e quem da
 * entrada de verdade no estoque).
 */
window.PaginaCompras = (function () {
  let categorias = [];
  let fornecedores = [];
  let abaAtual = 'notas';
  const STATUS_PEDIDO = {
    aberto: ['Em aberto', 'alerta'], enviado: ['Enviado', 'muted'],
    recebido: ['Recebido', 'ok'], cancelado: ['Cancelado', 'muted'],
  };

  async function render(container) {
    container.innerHTML = `
      <div class="tabs">
        <div class="tab ${abaAtual === 'notas' ? 'ativo' : ''}" data-aba="notas">Notas fiscais</div>
        <div class="tab ${abaAtual === 'pedidos' ? 'ativo' : ''}" data-aba="pedidos">📝 Pedidos de compra</div>
      </div>
      <div id="compras-conteudo"></div>`;

    container.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      abaAtual = t.dataset.aba;
      container.querySelectorAll('.tab').forEach((x) => x.classList.toggle('ativo', x === t));
      trocarAba();
    }));

    [categorias, fornecedores] = await Promise.all([
      API.get('/api/categorias').catch(() => []),
      API.get('/api/fornecedores').catch(() => []),
    ]);

    trocarAba();
  }

  function trocarAba() {
    if (abaAtual === 'pedidos') renderPedidos();
    else renderNotas();
  }

  // ------------------------------ Notas fiscais (NF-e) ------------------------------
  async function renderNotas() {
    const alvo = document.getElementById('compras-conteudo');
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce">
          <strong>Importar nota fiscal</strong>
          <div class="dica">Selecione o arquivo XML da NF-e de compra para dar entrada no estoque.</div>
        </div>
        <input type="file" id="xml-file" accept=".xml,text/xml,application/xml" style="display:none" />
        <button class="btn" id="btn-importar">📥 Importar NF-e (XML)</button>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Notas importadas</h3>
        <div id="lista-compras">Carregando…</div>
      </div>
    `;

    const input = alvo.querySelector('#xml-file');
    alvo.querySelector('#btn-importar').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      if (!input.files.length) return;
      await importar(input.files[0]);
      input.value = '';
    });

    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('lista-compras');
    if (!alvo) return;
    let compras;
    try { compras = await API.get('/api/compras'); }
    catch (e) { alvo.innerHTML = `<span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}`; return; }

    if (!compras.length) { alvo.innerHTML = '<p class="muted">Nenhuma nota importada ainda.</p>'; return; }

    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>NF</th><th>Fornecedor</th><th>Emissão</th><th>Itens</th><th>Valor</th><th></th></tr></thead>
      <tbody>${compras.map((c) => `<tr>
        <td>${UI.escapar(c.numero_nf || '—')}</td>
        <td>${UI.escapar(c.fornecedor_nome || '—')}</td>
        <td>${c.data_emissao ? UI.dataHora(c.data_emissao) : '—'}</td>
        <td>${c.total_itens}</td>
        <td>${UI.moeda(c.valor_total)}</td>
        <td style="text-align:right"><button class="btn btn--secundario" data-ver="${c.id}">Ver itens</button></td>
      </tr>`).join('')}</tbody></table>`;

    alvo.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => verCompra(Number(b.dataset.ver))));
  }

  async function importar(arquivo) {
    UI.toast('Lendo XML…', 'info');
    const fd = new FormData();
    fd.append('xml', arquivo);
    let preview;
    try {
      const resp = await fetch('/api/compras/importar-xml', { method: 'POST', body: fd });
      const txt = await resp.text();
      preview = txt ? JSON.parse(txt) : null;
      if (!resp.ok) throw new Error((preview && preview.erro) || 'Falha ao ler o XML.');
    } catch (e) { UI.erro(e.message); return; }
    abrirPreview(preview);
  }

  function abrirPreview(prev) {
    const optCategorias = (sel) => '<option value="">— categoria —</option>' +
      categorias.map((c) => `<option value="${c.id}" ${String(sel) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('');

    const linhas = prev.itens.map((it, idx) => {
      if (it.produto_existente) {
        return `<tr data-idx="${idx}" data-tipo="existente">
          <td>${UI.escapar(it.descricao)}<div class="dica">EAN: ${UI.escapar(it.ean || '—')}</div></td>
          <td>${UI.numero(it.quantidade)} ${UI.escapar(it.unidade)}</td>
          <td>${UI.moeda(it.valor_unitario)}</td>
          <td colspan="2"><span class="badge badge--ok">Vinculado</span> ${UI.escapar(it.produto_existente.nome)}
            <div class="dica">Estoque atual: ${UI.numero(it.produto_existente.estoque_atual)} → atualiza custo e soma entrada</div></td>
        </tr>`;
      }
      return `<tr data-idx="${idx}" data-tipo="novo">
        <td>
          <span class="badge badge--alerta" data-badge-novo>Produto novo</span>
          <div class="dica">NF: ${UI.escapar(it.descricao)} | EAN: ${UI.escapar(it.ean || '—')}</div>
          <input class="mt-16" style="width:100%" data-campo="nome" value="${UI.escapar(it.descricao)}" placeholder="Nome do produto *" />
          <div class="mt-16">
            <button type="button" class="btn btn--secundario" data-link-toggle="${idx}">🔗 Vincular a produto já cadastrado</button>
            <div data-link-box="${idx}" style="display:none;margin-top:8px">
              <input data-link-busca="${idx}" placeholder="Buscar produto do cadastro…" style="width:100%" autocomplete="off" />
              <div data-link-res="${idx}"></div>
            </div>
            <div data-link-sel="${idx}"></div>
          </div>
        </td>
        <td>${UI.numero(it.quantidade)} ${UI.escapar(it.unidade)}</td>
        <td>${UI.moeda(it.valor_unitario)}</td>
        <td><select data-campo="categoria_id">${optCategorias('')}</select></td>
        <td>
          <input type="number" step="0.01" min="0" data-campo="preco_venda" placeholder="Preço venda" style="width:110px" />
          <div class="dica">ou markup %<input type="number" step="0.01" min="0" data-campo="markup" style="width:70px" placeholder="ex: 50"></div>
        </td>
      </tr>`;
    }).join('');

    const corpo = `
      <div class="card mb-16" style="background:#f8fafc">
        <div class="flex flex--between">
          <div><strong>${UI.escapar(prev.fornecedor.nome)}</strong>
            <div class="dica">CNPJ: ${UI.escapar(prev.fornecedor.cnpj || '—')} ${prev.fornecedor_existente ? '· fornecedor já cadastrado' : '· será cadastrado'}</div></div>
          <div style="text-align:right">
            <div>NF ${UI.escapar(prev.numero_nf || '—')}</div>
            <div class="stat__value" style="font-size:20px">${UI.moeda(prev.valor_total)}</div>
          </div>
        </div>
      </div>
      <table class="tabela">
        <thead><tr><th>Produto</th><th>Qtd</th><th>Custo unit.</th><th>Categoria</th><th>Preço venda</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <div class="card mt-16">
        <label class="flex gap-12" style="align-items:center">
          <input type="checkbox" id="cp-gerar" /> Gerar conta a pagar desta nota
        </label>
        <div class="campo mt-16" id="cp-venc-wrap" style="display:none;max-width:220px">
          <label>Vencimento</label>
          <input type="date" id="cp-venc" />
        </div>
      </div>`;

    Modal.abrir({
      titulo: 'Conferir importação da NF-e',
      tamanho: 'modal--grande',
      corpoHTML: corpo,
      textoConfirmar: 'Confirmar importação',
      aoAbrir: (el) => {
        const chk = el.querySelector('#cp-gerar');
        chk.addEventListener('change', () => {
          el.querySelector('#cp-venc-wrap').style.display = chk.checked ? '' : 'none';
        });

        // Conciliacao manual: vincular um item da nota a um produto ja cadastrado.
        el.querySelectorAll('[data-link-toggle]').forEach((btn) => {
          const idx = btn.dataset.linkToggle;
          const box = el.querySelector(`[data-link-box="${idx}"]`);
          btn.addEventListener('click', () => { box.style.display = box.style.display === 'none' ? '' : 'none'; });
        });
        el.querySelectorAll('[data-link-busca]').forEach((inp) => {
          const idx = inp.dataset.linkBusca;
          const res = el.querySelector(`[data-link-res="${idx}"]`);
          let t;
          inp.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(async () => {
              const q = inp.value.trim();
              if (!q) { res.innerHTML = ''; return; }
              const achados = await API.get('/api/vendas/buscar-produto?termo=' + encodeURIComponent(q)).catch(() => []);
              if (!achados.length) { res.innerHTML = '<div class="dica">Nenhum produto encontrado.</div>'; return; }
              res.innerHTML = `<div class="pdv-resultados">${achados.map((c) => `<button type="button" data-pick="${c.id}" data-nome="${UI.escapar(c.nome)}">${UI.escapar(c.nome)}${c.codigo_barras ? ` <span class="muted">${UI.escapar(c.codigo_barras)}</span>` : ''}</button>`).join('')}</div>`;
              res.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
                const tr = el.querySelector(`tr[data-idx="${idx}"]`);
                tr.dataset.tipo = 'vinculado';
                tr.dataset.produtoId = b.dataset.pick;
                el.querySelector(`[data-link-sel="${idx}"]`).innerHTML = `<span class="badge badge--ok mt-16" style="display:inline-block">Vinculado a: ${b.dataset.nome}</span> <button type="button" class="btn btn--secundario" data-link-undo="${idx}">desfazer</button>`;
                el.querySelector(`[data-link-box="${idx}"]`).style.display = 'none';
                const badge = tr.querySelector('[data-badge-novo]'); if (badge) badge.style.display = 'none';
                el.querySelector(`[data-link-undo="${idx}"]`).addEventListener('click', () => {
                  tr.dataset.tipo = 'novo'; delete tr.dataset.produtoId;
                  el.querySelector(`[data-link-sel="${idx}"]`).innerHTML = '';
                  if (badge) badge.style.display = '';
                });
              }));
            }, 250);
          });
        });
      },
      aoConfirmar: async (el) => {
        // monta itens
        const itens = [];
        for (const tr of el.querySelectorAll('tbody tr')) {
          const idx = Number(tr.dataset.idx);
          const base = prev.itens[idx];
          if (tr.dataset.tipo === 'existente') {
            itens.push({ ...base, produto_id: base.produto_existente.id });
          } else if (tr.dataset.tipo === 'vinculado' && tr.dataset.produtoId) {
            // Conciliacao manual: item da nota vinculado a um produto existente.
            itens.push({ ...base, produto_id: Number(tr.dataset.produtoId) });
          } else {
            const nome = tr.querySelector('[data-campo="nome"]').value.trim();
            if (!nome) { UI.erro('Informe o nome de todos os produtos novos.'); return false; }
            itens.push({
              ...base,
              novo: {
                nome,
                categoria_id: tr.querySelector('[data-campo="categoria_id"]').value || null,
                preco_venda: tr.querySelector('[data-campo="preco_venda"]').value || null,
                markup: tr.querySelector('[data-campo="markup"]').value || null,
              },
            });
          }
        }
        const gerar = el.querySelector('#cp-gerar').checked;
        const payload = {
          xml_path: prev.xml_path, chave: prev.chave, numero_nf: prev.numero_nf,
          data_emissao: prev.data_emissao, valor_total: prev.valor_total,
          fornecedor: prev.fornecedor_existente ? { id: prev.fornecedor_existente.id, ...prev.fornecedor } : prev.fornecedor,
          itens,
          gerar_conta_pagar: gerar,
          vencimento: gerar ? (el.querySelector('#cp-venc').value || null) : null,
        };
        try {
          await API.post('/api/compras/confirmar', payload);
          UI.sucesso('Nota importada! Produtos enviados para a Precificação.');
          await listar();
          // Leva para a aba de Precificacao (grupo da nota).
          window.__precAbrirProdutos = true;
          setTimeout(() => { location.hash = '#/precificacao'; }, 900);
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function verCompra(id) {
    let c;
    try { c = await API.get(`/api/compras/${id}`); } catch (e) { UI.erro(e.message); return; }
    const corpo = `
      <div class="mb-16"><strong>${UI.escapar(c.fornecedor_nome || '—')}</strong>
        <div class="dica">NF ${UI.escapar(c.numero_nf || '—')} · Emissão ${c.data_emissao ? UI.dataHora(c.data_emissao) : '—'} · Importada ${UI.dataHora(c.data_importacao)}</div></div>
      <table class="tabela">
        <thead><tr><th>Produto</th><th>NCM</th><th>Qtd</th><th>Custo unit.</th><th>Total</th></tr></thead>
        <tbody>${c.itens.map((i) => `<tr>
          <td>${UI.escapar(i.produto_nome || i.descricao_nf || '—')}</td>
          <td>${UI.escapar(i.ncm || '—')}</td>
          <td>${UI.numero(i.quantidade)}</td>
          <td>${UI.moeda(i.valor_unitario)}</td>
          <td>${UI.moeda(i.valor_total)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="4" style="text-align:right">Total da nota</th><th>${UI.moeda(c.valor_total)}</th></tr></tfoot>
      </table>`;
    Modal.abrir({ titulo: 'Itens da nota', tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false });
  }

  // ------------------------------ Pedidos de compra ------------------------------
  const filtroPedidos = { status: '', fornecedor_id: '' };

  async function renderPedidos() {
    const alvo = document.getElementById('compras-conteudo');
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <select id="pd-filtro-fornecedor"><option value="">Todos os fornecedores</option>${fornecedores.map((f) => `<option value="${f.id}">${UI.escapar(f.nome)}</option>`).join('')}</select>
        <select id="pd-filtro-status">
          <option value="">Todos os status</option>
          ${Object.entries(STATUS_PEDIDO).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}
        </select>
        <div class="cresce"></div>
        <button class="btn" id="pd-novo">+ Novo pedido de compra</button>
      </div>
      <div class="card"><div id="pd-lista">Carregando…</div></div>`;

    alvo.querySelector('#pd-filtro-fornecedor').addEventListener('change', (e) => { filtroPedidos.fornecedor_id = e.target.value; listarPedidos(); });
    alvo.querySelector('#pd-filtro-status').addEventListener('change', (e) => { filtroPedidos.status = e.target.value; listarPedidos(); });
    alvo.querySelector('#pd-novo').addEventListener('click', () => formPedido());

    await listarPedidos();
  }

  async function listarPedidos() {
    const alvo = document.getElementById('pd-lista');
    if (!alvo) return;
    const params = new URLSearchParams();
    if (filtroPedidos.status) params.set('status', filtroPedidos.status);
    if (filtroPedidos.fornecedor_id) params.set('fornecedor_id', filtroPedidos.fornecedor_id);
    let pedidos;
    try { pedidos = await API.get('/api/pedidos-compra?' + params.toString()); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }

    if (!pedidos.length) { alvo.innerHTML = '<p class="muted">Nenhum pedido de compra neste filtro.</p>'; return; }

    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>Fornecedor</th><th>Criado em</th><th>Itens</th><th>Valor</th><th>Status</th><th></th></tr></thead>
      <tbody>${pedidos.map((p) => {
        const [txt, cor] = STATUS_PEDIDO[p.status] || [p.status, 'muted'];
        return `<tr>
          <td>${UI.escapar(p.fornecedor_nome)}</td>
          <td>${UI.dataHora(p.criado_em)}</td>
          <td>${p.qtd_itens}</td>
          <td>${UI.moeda(p.valor_total)}</td>
          <td><span class="badge badge--${cor}">${txt}</span></td>
          <td style="text-align:right;white-space:nowrap">
            ${p.status === 'aberto' ? `<button class="btn btn--secundario" data-editar="${p.id}">Editar</button>` : `<button class="btn btn--secundario" data-ver="${p.id}">Ver</button>`}
          </td>
        </tr>`;
      }).join('')}</tbody></table>`;

    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', async () => {
      try { formPedido(await API.get(`/api/pedidos-compra/${b.dataset.editar}`)); } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', async () => {
      try { verPedido(await API.get(`/api/pedidos-compra/${b.dataset.ver}`)); } catch (e) { UI.erro(e.message); }
    }));
  }

  /** Form de criacao/edicao de um pedido (so' permitido enquanto status='aberto'). */
  function formPedido(pedido) {
    const editando = !!pedido;
    let fornecedorId = pedido ? pedido.fornecedor_id : '';
    const itens = pedido ? pedido.itens.map((i) => ({
      produto_id: i.produto_id, nome: i.produto_nome, unidade: i.unidade,
      quantidade: Number(i.quantidade), custo_unitario: Number(i.custo_unitario),
    })) : [];

    const corpo = `
      <div class="campo">
        <label>Fornecedor *</label>
        ${editando
          ? `<input readonly value="${UI.escapar(pedido.fornecedor_nome)}" />`
          : `<select id="pc-fornecedor"><option value="">Selecione…</option>${fornecedores.map((f) => `<option value="${f.id}">${UI.escapar(f.nome)}</option>`).join('')}</select>`}
      </div>
      <div class="flex flex--between mt-16" style="align-items:center;flex-wrap:wrap;gap:8px">
        <label style="margin:0">Itens do pedido</label>
        <div class="flex gap-12" style="flex-wrap:wrap">
          <a href="/api/pedidos-compra/planilha/modelo" class="btn btn--secundario">⬇️ Modelo da planilha</a>
          <input type="file" id="pc-planilha-file" accept=".xlsx,.xls,.csv" style="display:none" />
          <button type="button" class="btn btn--secundario" id="pc-planilha" ${fornecedorId ? '' : 'disabled'}>📊 Importar planilha</button>
          <button type="button" class="btn btn--secundario" id="pc-sugerir" ${fornecedorId ? '' : 'disabled'}>💡 Sugerir itens em falta</button>
        </div>
      </div>
      <div class="barra-ferramentas mt-16" style="margin-bottom:8px">
        <input type="search" id="pc-busca" class="cresce" placeholder="Buscar produto deste fornecedor…" autocomplete="off" ${fornecedorId ? '' : 'disabled'} />
      </div>
      <div id="pc-busca-resultados"></div>
      <div id="pc-itens" class="mt-16"></div>
      <div class="campo mt-16"><label>Observação</label><textarea id="pc-obs" rows="2">${UI.escapar(pedido ? pedido.observacao || '' : '')}</textarea></div>`;

    Modal.abrir({
      titulo: editando ? `Editar pedido #${pedido.id}` : 'Novo pedido de compra',
      tamanho: 'modal--grande', corpoHTML: corpo, textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        const renderItens = () => {
          const totalGeral = itens.reduce((s, i) => s + i.quantidade * i.custo_unitario, 0);
          el.querySelector('#pc-itens').innerHTML = itens.length ? `<table class="tabela">
            <thead><tr><th>Produto</th><th>Qtd</th><th>Custo unit.</th><th>Total</th><th></th></tr></thead>
            <tbody>${itens.map((i, idx) => `<tr>
              <td>${UI.escapar(i.nome)}${i.novo ? ' <span class="badge badge--alerta">🆕 Novo produto</span>' : ''}</td>
              <td><input type="number" min="0.01" step="0.01" data-qtd="${idx}" value="${i.quantidade}" style="width:80px" /></td>
              <td><input type="number" min="0" step="0.01" data-custo="${idx}" value="${i.custo_unitario}" style="width:100px" /></td>
              <td>${UI.moeda(i.quantidade * i.custo_unitario)}</td>
              <td><button type="button" class="btn btn--secundario" data-remover="${idx}">✕</button></td>
            </tr>`).join('')}</tbody>
            <tfoot><tr><th colspan="3" style="text-align:right">Total do pedido</th><th>${UI.moeda(totalGeral)}</th><th></th></tr></tfoot>
          </table>` : '<p class="muted">Nenhum item adicionado ainda.</p>';

          el.querySelectorAll('[data-qtd]').forEach((inp) => inp.addEventListener('change', () => {
            itens[Number(inp.dataset.qtd)].quantidade = Number(inp.value) || 0; renderItens();
          }));
          el.querySelectorAll('[data-custo]').forEach((inp) => inp.addEventListener('change', () => {
            itens[Number(inp.dataset.custo)].custo_unitario = Number(inp.value) || 0; renderItens();
          }));
          el.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', () => {
            itens.splice(Number(b.dataset.remover), 1); renderItens();
          }));
        };
        renderItens();

        const adicionarItem = (p, qtdSugerida) => {
          const existente = itens.find((i) => i.produto_id === p.produto_id || i.produto_id === p.id);
          if (existente) { existente.quantidade += qtdSugerida || 1; renderItens(); return; }
          itens.push({
            produto_id: p.produto_id || p.id,
            nome: p.produto_nome || p.nome,
            unidade: p.unidade || 'UN',
            quantidade: qtdSugerida || 1,
            custo_unitario: Number(p.custo_unitario ?? p.custo ?? 0),
          });
          renderItens();
        };

        const buscaInput = el.querySelector('#pc-busca');
        const resAlvo = el.querySelector('#pc-busca-resultados');
        let debounce;
        buscaInput.addEventListener('input', () => {
          clearTimeout(debounce);
          const termo = buscaInput.value.trim();
          if (!termo) { resAlvo.innerHTML = ''; return; }
          debounce = setTimeout(async () => {
            const achados = await API.get(`/api/produtos?fornecedor_id=${fornecedorId}&busca=${encodeURIComponent(termo)}`).catch(() => []);
            resAlvo.innerHTML = achados.length ? `<div class="pdv-resultados">${achados.map((p) => `
              <button type="button" data-add="${p.id}">${UI.escapar(p.nome)} <span class="muted">estoque ${UI.numero(p.estoque_atual)} · ${UI.moeda(p.custo)}</span></button>
            `).join('')}</div>` : '<p class="muted">Nenhum produto encontrado para esse fornecedor.</p>';
            resAlvo.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
              const p = achados.find((x) => x.id === Number(b.dataset.add));
              adicionarItem(p);
              buscaInput.value = ''; resAlvo.innerHTML = ''; buscaInput.focus();
            }));
          }, 250);
        });

        const planilhaInput = el.querySelector('#pc-planilha-file');
        el.querySelector('#pc-planilha').addEventListener('click', () => planilhaInput.click());
        planilhaInput.addEventListener('change', async () => {
          const arquivo = planilhaInput.files[0];
          if (!arquivo || !fornecedorId) return;
          const fd = new FormData();
          fd.append('planilha', arquivo);
          fd.append('fornecedor_id', fornecedorId);
          try {
            const resp = await fetch('/api/pedidos-compra/planilha/importar', { method: 'POST', body: fd });
            const texto = await resp.text();
            const linhas = texto ? JSON.parse(texto) : [];
            if (!resp.ok) throw new Error((linhas && linhas.erro) || 'Falha ao ler a planilha.');
            let novos = 0;
            linhas.forEach((l) => {
              if (l.produto_id) { adicionarItem({ produto_id: l.produto_id, nome: l.nome, unidade: l.unidade, custo: l.custo_unitario }, l.quantidade); return; }
              novos += 1;
              itens.push({
                produto_id: null, novo: true, nome: l.nome, codigo_barras: l.codigo_barras || null,
                unidade: l.unidade || 'UN', quantidade: l.quantidade, custo_unitario: l.custo_unitario || 0,
              });
            });
            renderItens();
            UI.sucesso(`${linhas.length} linha(s) importada(s)${novos ? `, ${novos} como produto novo` : ''}. Revise antes de salvar.`);
          } catch (err) { UI.erro(err.message); }
          planilhaInput.value = '';
        });

        el.querySelector('#pc-sugerir').addEventListener('click', async () => {
          if (!fornecedorId) return;
          let sugestoes;
          try { sugestoes = await API.get(`/api/pedidos-compra/sugerir?fornecedor_id=${fornecedorId}`); }
          catch (e) { UI.erro(e.message); return; }
          if (!sugestoes.length) { UI.toast('Nenhum produto deste fornecedor está abaixo do estoque mínimo.', 'info'); return; }
          sugestoes.forEach((s) => adicionarItem(s, s.quantidade));
          UI.sucesso(`${sugestoes.length} item(ns) sugerido(s) adicionado(s).`);
        });

        if (!editando) {
          CadastroRapido.ligar(el.querySelector('#pc-fornecedor'), 'fornecedor', { aoCriar: (r) => fornecedores.push(r) });
          el.querySelector('#pc-fornecedor').addEventListener('change', (e) => {
            fornecedorId = e.target.value ? Number(e.target.value) : '';
            if (itens.length) { itens.length = 0; renderItens(); UI.toast('Itens limpos: fornecedor trocado.', 'info'); }
            el.querySelector('#pc-busca').disabled = !fornecedorId;
            el.querySelector('#pc-sugerir').disabled = !fornecedorId;
            el.querySelector('#pc-planilha').disabled = !fornecedorId;
          });
        }
      },
      aoConfirmar: async (el) => {
        if (!fornecedorId) { UI.erro('Selecione o fornecedor.'); return false; }
        if (!itens.length) { UI.erro('Adicione ao menos um item ao pedido.'); return false; }
        const payload = {
          fornecedor_id: fornecedorId,
          observacao: el.querySelector('#pc-obs').value,
          itens: itens.map((i) => (i.produto_id
            ? { produto_id: i.produto_id, quantidade: i.quantidade, custo_unitario: i.custo_unitario }
            : { novo: { nome: i.nome, codigo_barras: i.codigo_barras || null }, quantidade: i.quantidade, custo_unitario: i.custo_unitario })),
        };
        try {
          if (editando) await API.put(`/api/pedidos-compra/${pedido.id}`, payload);
          else await API.post('/api/pedidos-compra', payload);
          UI.sucesso((editando ? 'Pedido atualizado.' : 'Pedido criado.') + ' Itens enviados para a Conferência de Mercadoria.');
          await listarPedidos();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  /** Visualizacao (com acoes de status/PDF) de um pedido — usada para os que nao estao mais 'aberto', ou para so conferir. */
  function verPedido(pedido) {
    const [txt, cor] = STATUS_PEDIDO[pedido.status] || [pedido.status, 'muted'];
    const corpo = `
      <div class="flex flex--between mb-16">
        <div><strong>${UI.escapar(pedido.fornecedor_nome)}</strong>
          <div class="dica">Criado em ${UI.dataHora(pedido.criado_em)}${pedido.enviado_em ? ' · Enviado em ' + UI.dataHora(pedido.enviado_em) : ''}${pedido.recebido_em ? ' · Recebido em ' + UI.dataHora(pedido.recebido_em) : ''}</div></div>
        <span class="badge badge--${cor}">${txt}</span>
      </div>
      ${pedido.observacao ? `<p class="dica">${UI.escapar(pedido.observacao)}</p>` : ''}
      <table class="tabela">
        <thead><tr><th>Produto</th><th>Qtd</th><th>Custo unit.</th><th>Total</th></tr></thead>
        <tbody>${pedido.itens.map((i) => `<tr>
          <td>${UI.escapar(i.produto_nome)}</td>
          <td>${UI.numero(i.quantidade)} ${UI.escapar(i.unidade)}</td>
          <td>${UI.moeda(i.custo_unitario)}</td>
          <td>${UI.moeda(i.valor_total)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="3" style="text-align:right">Total do pedido</th><th>${UI.moeda(pedido.valor_total)}</th></tr></tfoot>
      </table>`;

    Modal.abrir({
      titulo: `Pedido de compra #${pedido.id}`, tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        const foot = el.querySelector('.modal__foot');
        const botoes = [];
        botoes.push('<button class="btn btn--secundario" id="pd-pdf">⬇️ Baixar PDF</button>');
        botoes.push('<button class="btn btn--secundario" id="pd-conferencia">🔍 Ver na Conferência de Mercadoria</button>');
        if (pedido.status === 'aberto') botoes.push('<button class="btn btn--secundario" id="pd-editar">Editar</button>');
        if (pedido.status === 'aberto') botoes.push('<button class="btn" id="pd-enviar">📤 Marcar como enviado</button>');
        if (pedido.status === 'enviado') botoes.push('<button class="btn" id="pd-receber">✅ Marcar como recebido</button>');
        if (pedido.status === 'aberto' || pedido.status === 'enviado') botoes.push('<button class="btn btn--perigo" id="pd-cancelar">Cancelar pedido</button>');
        foot.innerHTML = `<div class="flex gap-12" style="flex-wrap:wrap;width:100%">${botoes.join('')}</div>`;

        foot.querySelector('#pd-pdf').addEventListener('click', () => baixarPdfPedido(pedido));
        foot.querySelector('#pd-conferencia').addEventListener('click', () => { location.hash = '#/conferencia'; });
        const btnEditar = foot.querySelector('#pd-editar');
        if (btnEditar) btnEditar.addEventListener('click', () => { el.remove(); formPedido(pedido); });
        const btnEnviar = foot.querySelector('#pd-enviar');
        if (btnEnviar) btnEnviar.addEventListener('click', () => mudarStatusPedido(pedido.id, 'enviado', el));
        const btnReceber = foot.querySelector('#pd-receber');
        if (btnReceber) btnReceber.addEventListener('click', () => mudarStatusPedido(pedido.id, 'recebido', el));
        const btnCancelar = foot.querySelector('#pd-cancelar');
        if (btnCancelar) btnCancelar.addEventListener('click', async () => {
          const ok = await UI.confirmar('Cancelar este pedido de compra?', { titulo: 'Cancelar pedido', textoConfirmar: 'Cancelar pedido' });
          if (ok) mudarStatusPedido(pedido.id, 'cancelado', el);
        });
      },
    });
  }

  async function mudarStatusPedido(id, status, elModal) {
    try {
      await API.post(`/api/pedidos-compra/${id}/status`, { status });
      UI.sucesso('Status atualizado.');
      if (elModal) elModal.remove();
      await listarPedidos();
    } catch (e) { UI.erro(e.message); }
  }

  async function baixarPdfPedido(pedido) {
    let loja = {};
    try { loja = await API.get('/api/config'); } catch (_) { /* segue sem dados da loja */ }
    const linhas = pedido.itens.map((i) => `<tr>
      <td>${UI.escapar(i.produto_nome)}</td>
      <td style="text-align:center">${UI.numero(i.quantidade)} ${UI.escapar(i.unidade)}</td>
      <td style="text-align:right">${UI.moeda(i.custo_unitario)}</td>
      <td style="text-align:right">${UI.moeda(i.valor_total)}</td>
    </tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pedido de compra #${pedido.id}</title>
      <style>body{font-family:Arial,sans-serif;color:#111;padding:24px;max-width:720px;margin:auto}
      h1{font-size:20px;margin:0} .cab{display:flex;justify-content:space-between;border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:12px}
      table{width:100%;border-collapse:collapse;margin-top:12px} th,td{border-bottom:1px solid #ddd;padding:6px;font-size:13px;text-align:left}
      .tot{text-align:right;font-size:16px;margin-top:12px} .box{border:1px solid #ccc;border-radius:8px;padding:10px;margin-top:10px;font-size:13px}
      .muted{color:#666}</style></head><body>
      <div class="cab"><div style="display:flex;gap:12px;align-items:center">${loja.loja_logo ? `<img src="${loja.loja_logo}" style="width:56px;height:56px;object-fit:contain">` : ''}<div><h1>${UI.escapar(loja.nome_loja || 'Minha Empresa')}</h1>
        <div class="muted">${UI.escapar(loja.loja_telefone || '')} ${UI.escapar(loja.loja_cnpj || '')}</div></div></div>
        <div style="text-align:right"><strong>Pedido de compra #${pedido.id}</strong><br><span class="muted">${UI.dataHora(pedido.criado_em)}</span></div></div>
      <div class="box"><strong>Fornecedor:</strong> ${UI.escapar(pedido.fornecedor_nome)}
      ${pedido.fornecedor_telefone ? `<br><strong>Telefone:</strong> ${UI.escapar(pedido.fornecedor_telefone)}` : ''}
      ${pedido.fornecedor_email ? `<br><strong>E-mail:</strong> ${UI.escapar(pedido.fornecedor_email)}` : ''}</div>
      <table><thead><tr><th>Produto</th><th style="text-align:center">Qtd</th><th style="text-align:right">Custo unit.</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${linhas}</tbody></table>
      <div class="tot"><strong>Total do pedido: ${UI.moeda(pedido.valor_total)}</strong></div>
      ${pedido.observacao ? `<div class="box"><strong>Observações:</strong> ${UI.escapar(pedido.observacao)}</div>` : ''}
      </body></html>`;
    UI.baixarPDF(html, `pedido-compra-${pedido.id}.pdf`);
  }

  return { titulo: 'Compras', render };
})();
