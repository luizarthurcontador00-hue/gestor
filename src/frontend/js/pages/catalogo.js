'use strict';

/**
 * Catalogo para divulgacao: seleciona produtos/servicos e gera uma folha
 * ilustrada (foto, nome, preco) pronta para "Salvar como PDF" na tela de
 * impressao do sistema, para enviar por WhatsApp ou postar em redes sociais.
 * Usa o mesmo UI.imprimir() (iframe oculto + print) ja usado em Etiquetas.
 */
window.PaginaCatalogo = (function () {
  let categorias = [];
  let config = {};
  const selecao = new Map(); // id -> { nome, preco_venda, foto_path }
  let incluirServicos = false;

  async function render(container) {
    [categorias, config] = await Promise.all([
      API.get('/api/categorias').catch(() => []),
      API.get('/api/config').catch(() => ({})),
    ]);
    selecao.clear();

    container.innerHTML = `
      <a href="#/produtos" class="dica" style="display:inline-block;margin-bottom:12px">← Voltar para Produtos</a>
      <div class="barra-ferramentas">
        <input type="search" id="cat-busca" class="cresce" placeholder="Buscar produto por nome ou código de barras…" />
        <select id="cat-categoria"><option value="">Todas as categorias</option>${categorias.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select>
        <label class="flex gap-12" style="align-items:center"><input type="checkbox" id="cat-servicos"> Incluir serviços</label>
        <label class="flex gap-12" style="align-items:center"><input type="checkbox" id="cat-todos"> Selecionar todos</label>
      </div>
      <div class="card mb-16"><div id="cat-lista">Carregando…</div></div>
      <div class="card">
        <h3 style="margin-top:0">📢 Catálogo para divulgação</h3>
        <p class="dica">Gera um PDF com foto, nome e preço dos itens selecionados, pronto para enviar pelo WhatsApp ou postar nas redes.</p>
        <div class="form-grid">
          <div class="campo"><label>Título do catálogo</label><input id="cat-titulo" value="${UI.escapar(config.nome_loja ? `Catálogo — ${config.nome_loja}` : 'Catálogo de Produtos')}"></div>
          <div class="campo"><label>Itens por linha</label><select id="cat-colunas">
            <option value="2">2</option><option value="3" selected>3</option><option value="4">4</option>
          </select></div>
        </div>
        <label class="flex gap-12 mt-16" style="align-items:center">
          <input type="checkbox" id="cat-so-foto">
          Incluir apenas itens com foto
        </label>
        <label class="flex gap-12 mt-16" style="align-items:center">
          <input type="checkbox" id="cat-rodape" ${config.loja_telefone ? 'checked' : ''}>
          Mostrar telefone/contato da loja no rodapé
        </label>
        <div class="flex flex--between mt-16">
          <span class="dica"><strong id="cat-total-sel">0</strong> item(ns) selecionado(s)</span>
          <button class="btn" id="cat-gerar">📄 Gerar catálogo em PDF</button>
        </div>
      </div>`;

    container.querySelector('#cat-busca').addEventListener('input', UI.debounce(listar, 250));
    container.querySelector('#cat-categoria').addEventListener('change', listar);
    container.querySelector('#cat-servicos').addEventListener('change', (e) => { incluirServicos = e.target.checked; listar(); });
    container.querySelector('#cat-todos').addEventListener('change', (e) => marcarTodosVisiveis(e.target.checked));
    container.querySelector('#cat-gerar').addEventListener('click', () => gerarCatalogo());
    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('cat-lista');
    if (!alvo) return;
    const busca = document.getElementById('cat-busca').value;
    const categoria_id = document.getElementById('cat-categoria').value;
    const params = new URLSearchParams();
    if (busca) params.set('busca', busca);
    if (categoria_id) params.set('categoria_id', categoria_id);

    let itens;
    try {
      itens = await API.get('/api/produtos?' + params.toString());
      if (incluirServicos) {
        const servicos = await API.get('/api/produtos?' + params.toString() + '&eh_servico=1');
        itens = itens.concat(servicos);
      }
    } catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }

    if (!itens.length) { alvo.innerHTML = '<p class="muted">Nenhum item encontrado.</p>'; return; }

    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th style="width:34px"></th><th style="width:50px"></th><th>Item</th><th>Categoria</th><th>Preço</th></tr></thead>
      <tbody>${itens.map((p) => `<tr>
        <td><input type="checkbox" data-check="${p.id}" ${selecao.has(p.id) ? 'checked' : ''}></td>
        <td>${p.foto_path ? `<img src="/uploads/produtos/${encodeURIComponent(p.foto_path)}" style="width:32px;height:32px;object-fit:cover;border-radius:4px">` : '<span class="dica">sem foto</span>'}</td>
        <td>${UI.escapar(p.nome)}</td>
        <td>${UI.escapar(p.categoria_nome || '—')}</td>
        <td>${UI.moeda(p.preco_venda)}</td>
      </tr>`).join('')}</tbody></table>`;

    alvo.querySelectorAll('[data-check]').forEach((chk) => chk.addEventListener('change', (e) => {
      const id = Number(chk.dataset.check);
      const item = itens.find((p) => p.id === id);
      if (e.target.checked) selecao.set(id, item); else selecao.delete(id);
      atualizarContador();
    }));
    atualizarContador();
  }

  function marcarTodosVisiveis(marcar) {
    document.querySelectorAll('#cat-lista [data-check]').forEach((chk) => {
      if (chk.checked !== marcar) { chk.checked = marcar; chk.dispatchEvent(new Event('change')); }
    });
  }

  function atualizarContador() {
    const el = document.getElementById('cat-total-sel');
    if (el) el.textContent = selecao.size;
  }

  function gerarCatalogo() {
    if (!selecao.size) { UI.erro('Selecione ao menos um item.'); return; }
    const somenteFoto = document.getElementById('cat-so-foto').checked;
    const mostrarRodape = document.getElementById('cat-rodape').checked;
    const titulo = document.getElementById('cat-titulo').value.trim() || 'Catálogo de Produtos';
    const colunas = Number(document.getElementById('cat-colunas').value || 3);

    let itens = Array.from(selecao.values());
    if (somenteFoto) itens = itens.filter((p) => p.foto_path);
    if (!itens.length) { UI.erro('Nenhum item com foto entre os selecionados.'); return; }

    const cartoesHTML = itens.map((p) => `
      <div class="cat-item">
        <div class="cat-item-foto">${p.foto_path ? `<img src="/uploads/produtos/${encodeURIComponent(p.foto_path)}">` : '<span class="cat-item-sem-foto">📦</span>'}</div>
        <div class="cat-item-nome">${escaparTxt(p.nome)}</div>
        <div class="cat-item-preco">${UI.moeda(p.preco_venda)}</div>
      </div>`).join('');

    const rodapeHTML = mostrarRodape && (config.loja_telefone || config.nome_loja)
      ? `<div class="cat-rodape">${config.nome_loja ? escaparTxt(config.nome_loja) : ''}${config.nome_loja && config.loja_telefone ? ' · ' : ''}${config.loja_telefone ? escaparTxt(config.loja_telefone) : ''}</div>`
      : '';

    const html = `<html><head><meta charset="utf-8"><title>${escaparTxt(titulo)}</title>
      <style>
        @page { size: A4; margin: 10mm; }
        * { font-family: Arial, sans-serif; box-sizing: border-box; }
        body { margin: 0; }
        .cat-titulo { font-size: 20px; font-weight: bold; text-align: center; margin-bottom: 16px; }
        .cat-grade { display: grid; grid-template-columns: repeat(${colunas}, 1fr); gap: 8mm; }
        .cat-item {
          border: 1px solid #ddd; border-radius: 6px; padding: 8px; text-align: center;
          break-inside: avoid; page-break-inside: avoid;
        }
        .cat-item-foto { width: 100%; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 6px; background: #f5f5f5; border-radius: 4px; }
        .cat-item-foto img { width: 100%; height: 100%; object-fit: cover; }
        .cat-item-sem-foto { font-size: 32px; }
        .cat-item-nome { font-size: 12px; margin-bottom: 4px; }
        .cat-item-preco { font-size: 14px; font-weight: bold; color: #16a34a; }
        .cat-rodape { text-align: center; font-size: 11px; color: #666; margin-top: 16px; }
      </style></head>
      <body>
        <div class="cat-titulo">${escaparTxt(titulo)}</div>
        <div class="cat-grade">${cartoesHTML}</div>
        ${rodapeHTML}
      </body></html>`;

    UI.baixarPDF(html, `${titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
  }

  function escaparTxt(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  return { titulo: 'Catálogo', render };
})();
