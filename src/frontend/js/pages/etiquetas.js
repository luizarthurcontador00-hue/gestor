'use strict';

/**
 * Pagina de Etiquetas: selecionar produtos (com quantidade de copias) e
 * imprimir etiquetas com codigo de barras EAN-13 numa folha configuravel.
 * Produtos sem codigo de barras recebem um codigo interno automaticamente
 * (gerado e salvo pelo backend), garantindo que a etiqueta impressa sempre
 * corresponda ao que o PDV reconhece ao ler.
 */
window.PaginaEtiquetas = (function () {
  let categorias = [];
  const selecao = new Map(); // id -> { qtd }
  const LAYOUT_PADRAO = { largura: 40, altura: 25, colunas: 5, espaco: 2, bordas: true };

  async function render(container) {
    categorias = await API.get('/api/categorias').catch(() => []);
    selecao.clear();

    container.innerHTML = `
      <a href="#/produtos" class="dica" style="display:inline-block;margin-bottom:12px">← Voltar para Produtos</a>
      <div class="barra-ferramentas">
        <input type="search" id="et-busca" class="cresce" placeholder="Buscar produto por nome ou código de barras…" />
        <select id="et-categoria"><option value="">Todas as categorias</option>${categorias.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select>
        <label class="flex gap-12" style="align-items:center"><input type="checkbox" id="et-todos"> Selecionar todos</label>
      </div>
      <div class="card mb-16"><div id="et-lista">Carregando…</div></div>
      <div class="card">
        <h3 style="margin-top:0">Layout da folha de etiquetas</h3>
        <p class="dica">Ajuste conforme a folha de etiquetas adesivas que você tem (ex.: 40×25mm, 5 colunas é um tamanho comum).</p>
        <div class="form-grid">
          <div class="campo"><label>Largura da etiqueta (mm)</label><input id="et-larg" type="number" min="15" value="${LAYOUT_PADRAO.largura}"></div>
          <div class="campo"><label>Altura da etiqueta (mm)</label><input id="et-alt" type="number" min="10" value="${LAYOUT_PADRAO.altura}"></div>
          <div class="campo"><label>Colunas por folha</label><input id="et-cols" type="number" min="1" max="8" value="${LAYOUT_PADRAO.colunas}"></div>
          <div class="campo"><label>Espaçamento (mm)</label><input id="et-gap" type="number" min="0" value="${LAYOUT_PADRAO.espaco}"></div>
        </div>
        <label class="flex gap-12 mt-16" style="align-items:center">
          <input type="checkbox" id="et-bordas" ${LAYOUT_PADRAO.bordas ? 'checked' : ''}>
          Mostrar linhas de corte (desligue se a folha já é autoadesiva pré-cortada)
        </label>
        <div class="flex flex--between mt-16">
          <span class="dica"><strong id="et-total-sel">0</strong> etiqueta(s) para impressão</span>
          <button class="btn" id="et-imprimir">🖨️ Gerar e imprimir etiquetas</button>
        </div>
      </div>`;

    container.querySelector('#et-busca').addEventListener('input', UI.debounce(listar, 250));
    container.querySelector('#et-categoria').addEventListener('change', listar);
    container.querySelector('#et-todos').addEventListener('change', (e) => marcarTodosVisiveis(e.target.checked));
    container.querySelector('#et-imprimir').addEventListener('click', () => imprimirSelecionados());
    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('et-lista');
    if (!alvo) return;
    const busca = document.getElementById('et-busca').value;
    const categoria_id = document.getElementById('et-categoria').value;
    const params = new URLSearchParams();
    if (busca) params.set('busca', busca);
    if (categoria_id) params.set('categoria_id', categoria_id);

    let itens;
    try { itens = await API.get('/api/produtos?' + params.toString()); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }

    if (!itens.length) { alvo.innerHTML = '<p class="muted">Nenhum produto encontrado.</p>'; return; }

    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th style="width:34px"></th><th>Produto</th><th>Código de barras</th><th>Preço</th><th style="width:120px">Qtd. etiquetas</th></tr></thead>
      <tbody>${itens.map((p) => {
        const sel = selecao.get(p.id);
        return `<tr>
          <td><input type="checkbox" data-check="${p.id}" ${sel ? 'checked' : ''}></td>
          <td>${UI.escapar(p.nome)}</td>
          <td>${p.codigo_barras ? UI.escapar(p.codigo_barras) : '<span class="badge badge--muted">gerado automaticamente</span>'}</td>
          <td>${UI.moeda(p.preco_venda)}</td>
          <td><input type="number" min="1" value="${sel ? sel.qtd : 1}" data-qtd="${p.id}" style="width:80px" ${sel ? '' : 'disabled'}></td>
        </tr>`;
      }).join('')}</tbody></table>`;

    alvo.querySelectorAll('[data-check]').forEach((chk) => chk.addEventListener('change', (e) => {
      const id = Number(chk.dataset.check);
      const qtdInput = alvo.querySelector(`[data-qtd="${id}"]`);
      if (e.target.checked) {
        selecao.set(id, { qtd: Number(qtdInput.value || 1) });
        qtdInput.disabled = false;
      } else {
        selecao.delete(id);
        qtdInput.disabled = true;
      }
      atualizarContador();
    }));
    alvo.querySelectorAll('[data-qtd]').forEach((inp) => inp.addEventListener('input', () => {
      const id = Number(inp.dataset.qtd);
      if (selecao.has(id)) { selecao.get(id).qtd = Math.max(1, Number(inp.value || 1)); atualizarContador(); }
    }));
    atualizarContador();
  }

  function marcarTodosVisiveis(marcar) {
    document.querySelectorAll('#et-lista [data-check]').forEach((chk) => {
      if (chk.checked !== marcar) { chk.checked = marcar; chk.dispatchEvent(new Event('change')); }
    });
  }

  function atualizarContador() {
    let total = 0;
    selecao.forEach((v) => { total += v.qtd; });
    const el = document.getElementById('et-total-sel');
    if (el) el.textContent = total;
  }

  function lerLayout() {
    return {
      largura: Number(document.getElementById('et-larg').value || LAYOUT_PADRAO.largura),
      altura: Number(document.getElementById('et-alt').value || LAYOUT_PADRAO.altura),
      colunas: Number(document.getElementById('et-cols').value || LAYOUT_PADRAO.colunas),
      espaco: Number(document.getElementById('et-gap').value || LAYOUT_PADRAO.espaco),
      bordas: document.getElementById('et-bordas').checked,
    };
  }

  async function imprimirSelecionados() {
    if (!selecao.size) { UI.erro('Selecione ao menos um produto.'); return; }
    await imprimirIds(new Map(selecao), lerLayout());
  }

  /**
   * Ponto de entrada reutilizavel: imprime etiquetas para um Map<id,{qtd}>.
   * Usado tambem pelo botao rapido na pagina de Produtos.
   */
  async function imprimirIds(mapaIdQtd, layout) {
    const lay = layout || LAYOUT_PADRAO;
    const ids = Array.from(mapaIdQtd.keys());
    let produtos;
    try { produtos = await API.post('/api/produtos/etiquetas/preparar', { ids }); }
    catch (e) { UI.erro(e.message); return; }

    const etiquetas = [];
    produtos.forEach((p) => {
      const qtd = (mapaIdQtd.get(p.id) || { qtd: 1 }).qtd;
      for (let i = 0; i < qtd; i++) etiquetas.push(p);
    });

    const pxPorMm = 3.7; // resolucao do SVG do codigo de barras
    const htmlEtiquetas = etiquetas.map((p) => `
      <div class="etq">
        <div class="etq-nome">${escaparTxt(p.nome)}</div>
        ${window.Barcode.ean13SVG(p.codigo_barras, { largura: Math.round(lay.largura * pxPorMm), altura: 34 })}
        <div class="etq-preco">${UI.moeda(p.preco_venda)}</div>
      </div>`).join('');

    const html = `<html><head><meta charset="utf-8"><title>Etiquetas</title>
      <style>
        @page { size: A4; margin: 5mm; }
        * { font-family: Arial, sans-serif; box-sizing: border-box; }
        body { margin: 0; }
        .folha { display: grid; grid-template-columns: repeat(${lay.colunas}, ${lay.largura}mm); gap: ${lay.espaco}mm; }
        .etq {
          width: ${lay.largura}mm; height: ${lay.altura}mm; overflow: hidden;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          ${lay.bordas ? 'border: 1px dashed #999;' : ''}
          padding: 1mm; break-inside: avoid; page-break-inside: avoid;
        }
        .etq-nome { font-size: 8px; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .etq svg { max-width: 100%; height: auto; }
        .etq-preco { font-size: 11px; font-weight: bold; }
      </style></head>
      <body><div class="folha">${htmlEtiquetas}</div></body></html>`;

    UI.imprimir(html);
  }

  function escaparTxt(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  return { titulo: 'Etiquetas', render, imprimirIds };
})();
