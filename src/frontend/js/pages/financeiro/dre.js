'use strict';

/**
 * Aba "DRE": Demonstração do Resultado do Exercício. Por padrao olha o ano
 * inteiro (visao mais usada pra fechar o ano com o contador) — mes e
 * periodo personalizado ficam disponiveis pra quem quer o detalhe menor.
 */
window.FinanceiroDRE = (function () {
  const S = window.FinanceiroShared;

  function anoCorrente() { return new Date().getFullYear(); }
  function periodoAno(ano) { return { inicio: `${ano}-01-01`, fim: `${ano}-12-31` }; }
  const dreFiltro = {
    tipo: 'ano',
    mes: S.mesCorrente(),
    ano: anoCorrente(),
    de: S.mesCorrente() + '-01',
    ate: new Date().toISOString().slice(0, 10),
  };

  function periodoDRE() {
    if (dreFiltro.tipo === 'mes') return { ...S.periodoMes(dreFiltro.mes), label: S.mesLabel(dreFiltro.mes) };
    if (dreFiltro.tipo === 'personalizado') return { inicio: dreFiltro.de, fim: dreFiltro.ate, label: `${UI.dataHora(dreFiltro.de)} até ${UI.dataHora(dreFiltro.ate)}` };
    return { ...periodoAno(dreFiltro.ano), label: `Ano de ${dreFiltro.ano}` };
  }

  async function render() {
    const alvo = S.alvoConteudo();
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <div class="campo"><label class="dica">Período</label>
          <select id="dre-tipo">
            <option value="ano" ${dreFiltro.tipo === 'ano' ? 'selected' : ''}>Ano</option>
            <option value="mes" ${dreFiltro.tipo === 'mes' ? 'selected' : ''}>Mês</option>
            <option value="personalizado" ${dreFiltro.tipo === 'personalizado' ? 'selected' : ''}>Personalizado</option>
          </select></div>
        <div id="dre-nav-mes" class="flex gap-12" style="align-items:center;display:${dreFiltro.tipo === 'mes' ? 'flex' : 'none'}">
          <button class="btn btn--secundario" id="dre-ant">◀</button>
          <strong style="min-width:150px;text-align:center">${S.mesLabel(dreFiltro.mes)}</strong>
          <button class="btn btn--secundario" id="dre-prox">▶</button>
        </div>
        <div id="dre-nav-ano" class="flex gap-12" style="align-items:center;display:${dreFiltro.tipo === 'ano' ? 'flex' : 'none'}">
          <button class="btn btn--secundario" id="dre-ano-ant">◀</button>
          <strong style="min-width:90px;text-align:center">${dreFiltro.ano}</strong>
          <button class="btn btn--secundario" id="dre-ano-prox">▶</button>
        </div>
        <div id="dre-nav-personalizado" class="flex gap-12" style="align-items:end;display:${dreFiltro.tipo === 'personalizado' ? 'flex' : 'none'}">
          <div class="campo"><label class="dica">De</label><input type="date" id="dre-de" value="${dreFiltro.de}" /></div>
          <div class="campo"><label class="dica">Até</label><input type="date" id="dre-ate" value="${dreFiltro.ate}" /></div>
        </div>
        <div class="cresce"></div>
        <button class="btn btn--secundario" id="dre-sincronizar" title="Corrige o custo de vendas antigas cujo produto não tinha custo cadastrado na hora">🔄 Atualizar custos</button>
        <button class="btn btn--secundario" id="dre-categorias">🏷️ Categorias de despesa</button>
      </div>
      <div id="dre-resultado">Carregando…</div>`;
    alvo.querySelector('#dre-tipo').addEventListener('change', (e) => { dreFiltro.tipo = e.target.value; render(); });
    alvo.querySelector('#dre-ant').addEventListener('click', () => { dreFiltro.mes = S.mudarMes(dreFiltro.mes, -1); render(); });
    alvo.querySelector('#dre-prox').addEventListener('click', () => { dreFiltro.mes = S.mudarMes(dreFiltro.mes, 1); render(); });
    alvo.querySelector('#dre-ano-ant').addEventListener('click', () => { dreFiltro.ano -= 1; render(); });
    alvo.querySelector('#dre-ano-prox').addEventListener('click', () => { dreFiltro.ano += 1; render(); });
    const de = alvo.querySelector('#dre-de');
    const ate = alvo.querySelector('#dre-ate');
    if (de) de.addEventListener('change', () => { dreFiltro.de = de.value; carregar(); });
    if (ate) ate.addEventListener('change', () => { dreFiltro.ate = ate.value; carregar(); });
    alvo.querySelector('#dre-categorias').addEventListener('click', gerenciarCategorias);
    alvo.querySelector('#dre-sincronizar').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        const r = await API.post('/api/vendas/sincronizar-custos', {});
        UI.sucesso(r.itens_atualizados > 0
          ? `${r.itens_atualizados} item(ns) de venda atualizado(s) com o custo atual do produto.`
          : 'Nenhum item precisava de atualização.');
        await carregar();
      } catch (e) { UI.erro(e.message); }
      finally { btn.disabled = false; }
    });
    await carregar();
  }

  async function carregar() {
    const alvo = document.getElementById('dre-resultado');
    const { inicio, fim, label } = periodoDRE();
    let d;
    try { d = await API.get(`/api/financeiro/dre?inicio=${inicio}&fim=${fim}`); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }

    const linha = (rotulo, valor, opts = {}) => `
      <tr class="${opts.forte ? 'dre-forte' : ''}">
        <td style="padding-left:${opts.recuo ? '24px' : '0'}">${opts.sinal || ''} ${UI.escapar(rotulo)}</td>
        <td style="text-align:right;color:${opts.cor || 'inherit'}">${UI.moeda(valor)}</td>
      </tr>`;

    const despesasHTML = d.despesas.length
      ? d.despesas.map((c) => linha(c.nome, c.total, { recuo: true, sinal: '−', cor: 'var(--perigo)' })).join('')
      : '<tr><td class="muted" style="padding-left:24px">Nenhuma despesa no período</td><td></td></tr>';

    // Comércio ve CMV, serviço ve CSP, e quem tem os dois ve as duas linhas.
    const temComercio = window.__perfilNegocio !== 'servico';
    const temServico = window.__perfilNegocio !== 'comercio';
    const linhasCusto = [
      temComercio ? linha('(−) CMV — custo da mercadoria vendida', d.cmv, { cor: 'var(--perigo)' }) : '',
      temServico ? linha('(−) CSP — custo dos serviços prestados', d.csp, { cor: 'var(--perigo)' }) : '',
    ].join('');

    alvo.innerHTML = `
      <div class="grid grid--cards mb-16">
        <div class="card stat"><span class="stat__label">Receita de vendas</span><span class="stat__value" style="color:var(--sucesso)">${UI.moeda(d.receita_bruta)}</span></div>
        <div class="card stat"><span class="stat__label">Lucro bruto <span class="dica">(margem ${d.margem_bruta_pct}%)</span></span><span class="stat__value">${UI.moeda(d.lucro_bruto)}</span></div>
        <div class="card stat"><span class="stat__label">Resultado do período</span><span class="stat__value" style="color:${d.resultado_liquido >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(d.resultado_liquido)}</span></div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Demonstração do Resultado — ${UI.escapar(label)}</h3>
        <table class="tabela dre-tabela">
          <tbody>
            ${linha('Receita de vendas', d.receita_bruta, { sinal: '', cor: 'var(--sucesso)' })}
            ${linhasCusto}
            ${linha('= Lucro bruto', d.lucro_bruto, { forte: true })}
            <tr><td colspan="2" style="padding-top:12px"><strong>Despesas operacionais</strong></td></tr>
            ${despesasHTML}
            ${linha('Total de despesas', d.total_despesas, { forte: true, cor: 'var(--perigo)' })}
            ${linha('= Resultado líquido do período', d.resultado_liquido, { forte: true, cor: d.resultado_liquido >= 0 ? 'var(--sucesso)' : 'var(--perigo)' })}
          </tbody>
        </table>
        <p class="dica mt-16">A receita vem das vendas concluídas no período; ${temComercio && temServico ? 'o CMV usa o custo dos produtos vendidos e o CSP o custo dos serviços prestados' : temServico ? 'o CSP usa o custo dos serviços prestados' : 'o CMV usa o custo dos itens vendidos'}; as despesas vêm das contas a pagar do período, agrupadas por categoria. Compras de mercadoria não entram como despesa (elas viram CMV ao vender). Margem líquida: <strong>${d.margem_liquida_pct}%</strong>.</p>
      </div>`;
  }

  async function gerenciarCategorias() {
    const corpo = `
      <form id="cat-form" class="barra-ferramentas" style="margin-bottom:16px">
        <input id="cat-nome" class="cresce" placeholder="Nova categoria (ex.: Aluguel, Impostos)" required />
        <label class="flex gap-12" style="align-items:center;font-size:13px"><input type="checkbox" id="cat-dre" checked> Entra no DRE</label>
        <button class="btn" type="submit">Adicionar</button>
      </form>
      <div id="cat-lista"></div>`;
    Modal.abrir({
      titulo: 'Categorias de despesa', tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        const render = () => {
          el.querySelector('#cat-lista').innerHTML = S.state.categoriasDespesa.length ? `<table class="tabela">
            <thead><tr><th>Categoria</th><th>No DRE?</th><th></th></tr></thead>
            <tbody>${S.state.categoriasDespesa.map((c) => `<tr>
              <td>${UI.escapar(c.nome)}</td>
              <td>${c.considera_dre ? '<span class="badge badge--ok">Sim</span>' : '<span class="badge badge--muted">Não (compra/estoque)</span>'}</td>
              <td style="text-align:right"><button class="btn btn--secundario" data-cat-del="${c.id}">✕</button></td>
            </tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhuma categoria.</p>';
          el.querySelectorAll('[data-cat-del]').forEach((b) => b.addEventListener('click', async () => {
            const ok = await UI.confirmar('Excluir esta categoria? As contas já lançadas ficam sem categoria.', { titulo: 'Excluir categoria', textoConfirmar: 'Excluir' });
            if (!ok) return;
            try { await API.del(`/api/financeiro/categorias-despesa/${b.dataset.catDel}`); S.state.categoriasDespesa = await API.get('/api/financeiro/categorias-despesa'); render(); UI.sucesso('Categoria excluída.'); }
            catch (e) { UI.erro(e.message); }
          }));
        };
        render();
        el.querySelector('#cat-form').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          try {
            await API.post('/api/financeiro/categorias-despesa', { nome: el.querySelector('#cat-nome').value, considera_dre: el.querySelector('#cat-dre').checked });
            S.state.categoriasDespesa = await API.get('/api/financeiro/categorias-despesa');
            el.querySelector('#cat-nome').value = ''; render(); UI.sucesso('Categoria adicionada.');
          } catch (e) { UI.erro(e.message); }
        });
      },
    });
  }

  return { render, carregar };
})();
