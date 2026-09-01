'use strict';

/**
 * Pagina de Fornecedores: cadastro, busca e edicao. Antes so era acessivel
 * por um modal dentro de Produtos; agora tambem tem tela propria (grupo
 * "Cadastro" do menu).
 */
window.PaginaFornecedores = (function () {
  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <input type="search" id="fn-busca" class="cresce" placeholder="Buscar por nome ou CNPJ…" />
        <button class="btn" id="fn-novo">+ Novo fornecedor</button>
      </div>
      <div class="card"><div id="fn-lista">Carregando…</div></div>`;
    container.querySelector('#fn-busca').addEventListener('input', UI.debounce(listar, 250));
    container.querySelector('#fn-novo').addEventListener('click', () => formFornecedor());
    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('fn-lista');
    if (!alvo) return;
    const busca = document.getElementById('fn-busca').value;
    let fornecedores;
    try { fornecedores = await API.get('/api/fornecedores' + (busca ? '?busca=' + encodeURIComponent(busca) : '')); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!fornecedores.length) { alvo.innerHTML = '<p class="muted">Nenhum fornecedor cadastrado.</p>'; return; }
    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>Nome</th><th>CNPJ</th><th>Contato</th><th>Telefone</th><th>E-mail</th><th></th></tr></thead>
      <tbody>${fornecedores.map((f) => `<tr>
        <td>${UI.escapar(f.nome)}</td>
        <td>${UI.escapar(f.cnpj || '—')}</td>
        <td>${UI.escapar(f.contato || '—')}</td>
        <td>${UI.escapar(f.telefone || '—')}</td>
        <td>${UI.escapar(f.email || '—')}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn--secundario" data-editar="${f.id}">Editar</button>
          <button class="btn btn--secundario" data-excluir="${f.id}">✕</button>
        </td>
      </tr>`).join('')}</tbody></table>`;
    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => {
      const f = fornecedores.find((x) => x.id === Number(b.dataset.editar));
      formFornecedor(f);
    }));
    alvo.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir este fornecedor?', { titulo: 'Excluir fornecedor', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`/api/fornecedores/${b.dataset.excluir}`); UI.sucesso('Fornecedor excluído.'); await listar(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  function formFornecedor(fornecedor) {
    const ehEdicao = !!fornecedor;
    const f = fornecedor || {};
    Modal.abrir({
      titulo: ehEdicao ? 'Editar fornecedor' : 'Novo fornecedor', tamanho: 'modal--grande',
      corpoHTML: `<form id="form-forn" class="form-grid">
        <div class="campo col-2"><label>Nome / Razão social *</label><input name="nome" value="${UI.escapar(f.nome || '')}" required /></div>
        <div class="campo"><label>CNPJ</label><input name="cnpj" value="${UI.escapar(f.cnpj || '')}" /></div>
        <div class="campo"><label>Telefone</label><input name="telefone" value="${UI.escapar(f.telefone || '')}" /></div>
        <div class="campo"><label>Contato</label><input name="contato" value="${UI.escapar(f.contato || '')}" /></div>
        <div class="campo"><label>E-mail</label><input name="email" type="email" value="${UI.escapar(f.email || '')}" /></div>
      </form>`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => UI.ligarMascaraDocumento(el.querySelector('[name="cnpj"]')),
      aoConfirmar: async (el) => {
        const form = el.querySelector('#form-forn');
        if (!form.nome.value.trim()) { UI.erro('Informe o nome do fornecedor.'); return false; }
        const body = Object.fromEntries(new FormData(form).entries());
        try {
          if (ehEdicao) await API.put(`/api/fornecedores/${fornecedor.id}`, body);
          else await API.post('/api/fornecedores', body);
          UI.sucesso(ehEdicao ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.');
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }


  return { titulo: 'Fornecedores', render };
})();
