'use strict';

/** Aba "Contas Fixas": despesas recorrentes lançadas automaticamente todo mês. */
window.FinanceiroContasFixas = (function () {
  const S = window.FinanceiroShared;

  async function render() {
    const alvo = S.alvoConteudo();
    alvo.innerHTML = `
      <p class="dica mb-16">Cadastre contas que se repetem todo mês (aluguel, internet, água, luz…). Elas são lançadas automaticamente em "${S.ehInstituto() ? 'Despesas' : 'A Pagar'}" no início de cada mês.</p>
      <div class="barra-ferramentas"><div class="cresce"></div><button class="btn" id="cf-nova">+ ${S.ehInstituto() ? 'Nova despesa fixa' : 'Nova conta fixa'}</button></div>
      <div class="card"><div id="cf-lista">Carregando…</div></div>`;
    alvo.querySelector('#cf-nova').addEventListener('click', () => form());
    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('cf-lista');
    let contas;
    try { contas = await API.get('/api/financeiro/contas-fixas'); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!contas.length) { alvo.innerHTML = '<p class="muted">Nenhuma conta fixa cadastrada.</p>'; return; }
    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>Descrição</th><th>Fornecedor</th><th>Dia venc.</th><th>Valor</th><th>Status</th><th></th></tr></thead>
      <tbody>${contas.map((c) => `<tr style="${c.ativa ? '' : 'opacity:.55'}">
        <td>${UI.escapar(c.descricao)}</td>
        <td>${UI.escapar(c.fornecedor_nome || '—')}</td>
        <td>Dia ${c.dia_vencimento}</td>
        <td>${UI.moeda(c.valor)}</td>
        <td>${c.ativa ? '<span class="badge badge--ok">Ativa</span>' : '<span class="badge badge--muted">Pausada</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn--secundario" data-cf-pausar="${c.id}" data-ativa="${c.ativa}">${c.ativa ? 'Pausar' : 'Reativar'}</button>
          <button class="btn btn--secundario" data-cf-editar="${c.id}">Editar</button>
          <button class="btn btn--secundario" data-cf-excluir="${c.id}">✕</button>
        </td>
      </tr>`).join('')}</tbody></table>`;

    alvo.querySelectorAll('[data-cf-editar]').forEach((b) => b.addEventListener('click', () => {
      const c = contas.find((x) => x.id === Number(b.dataset.cfEditar));
      form(c);
    }));
    alvo.querySelectorAll('[data-cf-pausar]').forEach((b) => b.addEventListener('click', async () => {
      const ativa = b.dataset.ativa === '1';
      try {
        await API.put(`/api/financeiro/contas-fixas/${b.dataset.cfPausar}`, { ativa: !ativa });
        UI.sucesso(ativa ? 'Conta fixa pausada.' : 'Conta fixa reativada.');
        await listar();
      } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-cf-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir esta conta fixa? As contas já lançadas em meses anteriores não serão apagadas.', { titulo: 'Excluir conta fixa', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`/api/financeiro/contas-fixas/${b.dataset.cfExcluir}`); UI.sucesso('Conta fixa excluída.'); await listar(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  function form(cf) {
    const ehEdicao = !!cf;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar conta fixa' : 'Nova conta fixa', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Descrição *</label><input id="cf-desc" value="${UI.escapar(cf ? cf.descricao : '')}" /></div>
        <div class="campo mt-16"><label>Fornecedor</label><select id="cf-forn"><option value="">—</option>${S.state.fornecedores.map((f) => `<option value="${f.id}" ${cf && String(cf.fornecedor_id) === String(f.id) ? 'selected' : ''}>${UI.escapar(f.nome)}</option>`).join('')}</select></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Valor (R$) *</label><input id="cf-valor" type="number" step="0.01" min="0" value="${cf ? cf.valor : ''}" /></div>
          <div class="campo"><label>Dia do vencimento *</label><input id="cf-dia" type="number" min="1" max="31" value="${cf ? cf.dia_vencimento : ''}" /></div>
        </div>
        <div class="dica mt-16">Todo mês, no dia informado (ajustado se o mês não tiver esse dia), uma conta a pagar é criada automaticamente.</div>`,
      textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        const dados = {
          descricao: el.querySelector('#cf-desc').value,
          fornecedor_id: el.querySelector('#cf-forn').value || null,
          valor: el.querySelector('#cf-valor').value,
          dia_vencimento: el.querySelector('#cf-dia').value,
        };
        try {
          if (ehEdicao) await API.put(`/api/financeiro/contas-fixas/${cf.id}`, dados);
          else await API.post('/api/financeiro/contas-fixas', dados);
          UI.sucesso(ehEdicao ? 'Conta fixa atualizada.' : 'Conta fixa cadastrada.');
          await API.post('/api/financeiro/contas-fixas/gerar-pendentes', {}).catch(() => {});
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { render, listar, form };
})();
