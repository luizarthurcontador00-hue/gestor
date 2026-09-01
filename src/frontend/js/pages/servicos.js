'use strict';

/**
 * Página de Serviços: catálogo de serviços prestados (sem controle de
 * estoque). Reaproveita a tabela de produtos (eh_servico=1). Os serviços
 * podem ser vendidos no PDV (sozinhos ou junto com produtos) e entram no
 * financeiro/DRE como receita, e na Precificação (atividade "Serviços").
 */
window.PaginaServicos = (function () {
  let categorias = [];
  let filtros = { busca: '', categoria_id: '' };

  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <input type="search" id="sv-busca" class="cresce" placeholder="Buscar serviço por nome…" />
        <select id="sv-categoria"><option value="">Todas as categorias</option></select>
        <button class="btn btn--secundario" id="sv-categorias">🏷️ Categorias</button>
        <button class="btn" id="sv-novo">+ Novo serviço</button>
      </div>
      <div class="card" style="background:#eff6ff;border-color:#bfdbfe">
        <strong>🧰 Catálogo de serviços</strong>
        <p class="dica" style="margin-bottom:0">Cadastre os serviços que você presta (ex.: corte de cabelo, mão de obra, consultoria). Eles são vendidos no <strong>PDV</strong> como qualquer item — sozinhos ou junto com produtos — e entram na <strong>Precificação</strong> (atividade Serviços) e no <strong>DRE</strong> como receita.</p>
      </div>
      <div id="sv-lista"><div class="card">Carregando…</div></div>`;

    categorias = await API.get('/api/categorias').catch(() => []);
    preencherCategorias(container.querySelector('#sv-categoria'));

    container.querySelector('#sv-busca').addEventListener('input', UI.debounce((e) => { filtros.busca = e.target.value; listar(); }, 250));
    container.querySelector('#sv-categoria').addEventListener('change', (e) => { filtros.categoria_id = e.target.value; listar(); });
    container.querySelector('#sv-categorias').addEventListener('click', abrirCategorias);
    container.querySelector('#sv-novo').addEventListener('click', () => abrirForm());

    await listar();
  }

  function preencherCategorias(select, sel) {
    select.innerHTML = (select.id === 'sv-categoria' ? '<option value="">Todas as categorias</option>' : '<option value="">Sem categoria</option>')
      + categorias.map((c) => `<option value="${c.id}" ${String(sel) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('');
  }

  function duracaoTxt(min) {
    if (!min) return '—';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60); const m = min % 60;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }

  async function listar() {
    const alvo = document.getElementById('sv-lista');
    if (!alvo) return;
    const params = new URLSearchParams({ eh_servico: '1' });
    if (filtros.busca) params.set('busca', filtros.busca);
    if (filtros.categoria_id) params.set('categoria_id', filtros.categoria_id);
    let itens;
    try { itens = await API.get('/api/produtos?' + params.toString()); }
    catch (e) { alvo.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}</div>`; return; }

    if (!itens.length) {
      alvo.innerHTML = `<div class="card vazio">Nenhum serviço cadastrado.
        <div class="mt-16"><button class="btn" onclick="document.getElementById('sv-novo').click()">Cadastrar o primeiro serviço</button></div></div>`;
      return;
    }
    alvo.innerHTML = `<div class="card"><table class="tabela">
      <thead><tr><th>Serviço</th><th>Categoria</th><th>Duração</th><th>Custo</th><th>Preço</th><th></th></tr></thead>
      <tbody>${itens.map((s) => `<tr data-id="${s.id}" style="cursor:pointer">
        <td><strong>${UI.escapar(s.nome)}</strong>${s.descricao ? `<div class="dica">${UI.escapar(s.descricao)}</div>` : ''}</td>
        <td>${UI.escapar(s.categoria_nome || '—')}</td>
        <td>${duracaoTxt(s.duracao_min)}</td>
        <td>${UI.moeda(s.custo)}</td>
        <td>${Number(s.preco_venda) > 0 ? UI.moeda(s.preco_venda) : '<span class="badge badge--alerta">definir preço</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn--secundario" data-editar="${s.id}">Editar</button>
          <button class="btn btn--secundario" data-excluir="${s.id}">✕</button>
        </td>
      </tr>`).join('')}</tbody></table></div>`;

    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try { const s = await API.get(`/api/produtos/${b.dataset.editar}`); abrirForm(s); } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const ok = await UI.confirmar('Excluir este serviço? Se ele já foi vendido, será apenas inativado.', { titulo: 'Excluir serviço', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { const r = await API.del(`/api/produtos/${b.dataset.excluir}`); UI.sucesso(r.inativado ? 'Serviço inativado (tinha histórico).' : 'Serviço excluído.'); await listar(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  function abrirForm(servico) {
    const ehEdicao = !!servico;
    const s = servico || {};
    Modal.abrir({
      titulo: ehEdicao ? 'Editar serviço' : 'Novo serviço', tamanho: 'modal--grande',
      corpoHTML: `
        <form id="form-servico" class="form-grid">
          <div class="campo col-2"><label>Nome do serviço *</label><input name="nome" required value="${UI.escapar(s.nome || '')}" /></div>
          <div class="campo"><label>Categoria</label><select name="categoria_id" id="sv-fp-cat"></select></div>
          <div class="campo"><label>Duração estimada (minutos)</label><input name="duracao_min" type="number" min="0" step="1" value="${s.duracao_min != null ? s.duracao_min : ''}" /></div>
          <div class="campo"><label>Custo do serviço (R$) <span class="dica">(opcional)</span></label><input name="custo" type="number" step="0.01" min="0" value="${s.custo != null ? s.custo : ''}" /></div>
          <div class="campo"><label>Markup (%) <span class="dica">(opcional)</span></label><input name="markup" type="number" step="0.01" min="0" value="${s.markup != null ? s.markup : ''}" /></div>
          <div class="campo col-2"><label>Preço de venda (R$)</label><input name="preco_venda" type="number" step="0.01" min="0" value="${s.preco_venda != null ? s.preco_venda : ''}" />
            <span class="dica">Deixe em branco para calcular pelo markup. Você também pode precificar na aba Precificação (atividade Serviços).</span></div>
          <div class="campo col-2"><label>Descrição</label><textarea name="descricao">${UI.escapar(s.descricao || '')}</textarea></div>
        </form>`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => { preencherCategorias(el.querySelector('#sv-fp-cat'), s.categoria_id); },
      aoConfirmar: async (el) => {
        const form = el.querySelector('#form-servico');
        if (!form.nome.value.trim()) { UI.erro('Informe o nome do serviço.'); return false; }
        const dados = Object.fromEntries(new FormData(form).entries());
        dados.eh_servico = '1';
        try {
          if (ehEdicao) await API.put(`/api/produtos/${servico.id}`, dados);
          else await API.post('/api/produtos', dados);
          UI.sucesso(ehEdicao ? 'Serviço atualizado.' : 'Serviço cadastrado.');
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function abrirCategorias() {
    categorias = await API.get('/api/categorias').catch(() => []);
    const corpo = `
      <form id="sv-cat-form" class="barra-ferramentas" style="margin-bottom:16px">
        <input name="nome" class="cresce" placeholder="Nome da categoria (ex.: Cabelo, Estética, Mão de obra)" required />
        <input name="markup_padrao" type="number" step="0.01" min="0" placeholder="Markup % (opcional)" style="width:150px" />
        <button class="btn" type="submit">Adicionar</button>
      </form>
      <div id="sv-cat-lista"></div>`;
    Modal.abrir({
      titulo: 'Categorias', tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        const render = () => {
          el.querySelector('#sv-cat-lista').innerHTML = categorias.length ? `<table class="tabela">
            <thead><tr><th>Nome</th><th>Markup padrão</th><th></th></tr></thead>
            <tbody>${categorias.map((c) => `<tr>
              <td>${UI.escapar(c.nome)}</td><td>${c.markup_padrao != null ? c.markup_padrao + '%' : '—'}</td>
              <td style="text-align:right"><button class="btn btn--secundario" data-del="${c.id}" ${c.total_produtos > 0 ? 'disabled title="Há itens nesta categoria"' : ''}>Excluir</button></td>
            </tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhuma categoria.</p>';
          el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
            const ok = await UI.confirmar('Excluir esta categoria?', { titulo: 'Excluir categoria', textoConfirmar: 'Excluir' });
            if (!ok) return;
            try { await API.del(`/api/categorias/${b.dataset.del}`); categorias = await API.get('/api/categorias'); render(); preencherCategorias(document.getElementById('sv-categoria'), filtros.categoria_id); UI.sucesso('Categoria excluída.'); }
            catch (e) { UI.erro(e.message); }
          }));
        };
        render();
        el.querySelector('#sv-cat-form').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const f = ev.target;
          try {
            await API.post('/api/categorias', { nome: f.nome.value, markup_padrao: f.markup_padrao.value });
            f.reset(); categorias = await API.get('/api/categorias'); render();
            preencherCategorias(document.getElementById('sv-categoria'), filtros.categoria_id);
            UI.sucesso('Categoria adicionada.');
          } catch (e) { UI.erro(e.message); }
        });
      },
    });
  }


  return { titulo: 'Serviços', render };
})();
