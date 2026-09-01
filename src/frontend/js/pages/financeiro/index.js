'use strict';

/**
 * Pagina Financeiro: monta as abas e delega para cada modulo
 * (window.FinanceiroPagar, FinanceiroContasFixas, FinanceiroAssinaturas,
 * FinanceiroReceber, FinanceiroFluxo, FinanceiroDRE, FinanceiroConciliacao —
 * carregados antes deste arquivo). Estado compartilhado entre eles vive em
 * window.FinanceiroShared.state.
 *
 * No ramo "instituto" esta e a UNICA tela de dinheiro: a arrecadacao
 * (ofertas, projetos, mantenedores, prestacao de contas) entra aqui como
 * abas, delegada a window.SecoesArrecadacao — como ja era antes da divisao
 * deste arquivo em modulos menores.
 */
window.PaginaFinanceiro = (function () {
  const S = window.FinanceiroShared;
  let abaAtual = 'pagar';

  // Abas do instituto: agrupadas em nivel 1 (o assunto) e nivel 2 (o detalhe),
  // para nao virar uma fileira de 11 abas soltas.
  const ABAS_INSTITUTO = [
    { id: 'fluxo', rotulo: '💰 Caixa e saldos' },
    {
      id: 'entradas',
      rotulo: '🤝 Entradas',
      subs: [
        { id: 'ofertas', rotulo: 'Ofertas' },
        { id: 'receber', rotulo: 'A receber' },
        { id: 'assinaturas', rotulo: 'Contribuição mensal' },
        { id: 'especie', rotulo: 'Doações em espécie' },
      ],
    },
    {
      id: 'saidas',
      rotulo: '💸 Saídas',
      subs: [
        { id: 'pagar', rotulo: 'Despesas' },
        { id: 'fixas', rotulo: 'Despesas fixas' },
      ],
    },
    { id: 'conciliacao', rotulo: '🏦 Conciliação' },
    {
      id: 'prestacao',
      rotulo: '📊 Prestação de contas',
      subs: [
        { id: 'contas', rotulo: 'Resumo do período' },
        { id: 'projetos', rotulo: 'Projetos' },
        { id: 'mantenedores', rotulo: 'Mantenedores' },
      ],
    },
  ];
  const subAtual = { entradas: 'ofertas', saidas: 'pagar', prestacao: 'contas' };

  const ABAS_PADRAO = [
    { id: 'pagar', rotulo: 'A Pagar' },
    { id: 'fixas', rotulo: 'Contas Fixas' },
    { id: 'receber', rotulo: 'A Receber' },
    { id: 'assinaturas', rotulo: 'Mensalidades' },
    { id: 'fluxo', rotulo: 'Fluxo de Caixa' },
    { id: 'dre', rotulo: 'DRE' },
    { id: 'conciliacao', rotulo: '🏦 Conciliação' },
  ];

  const RENDERIZADORES = {
    pagar: () => window.FinanceiroPagar.render(),
    fixas: () => window.FinanceiroContasFixas.render(),
    receber: () => window.FinanceiroReceber.render(),
    assinaturas: () => window.FinanceiroAssinaturas.render(),
    fluxo: () => window.FinanceiroFluxo.render(),
    dre: () => window.FinanceiroDRE.render(),
    conciliacao: () => window.FinanceiroConciliacao.render(),
    ofertas: () => { secoes().montarEm('fin-sub'); return secoes().ofertas(); },
    especie: () => { secoes().montarEm('fin-sub'); return secoes().especie(); },
    mantenedores: () => { secoes().montarEm('fin-sub'); return secoes().mantenedores(); },
    projetos: () => { secoes().montarEm('fin-sub'); return secoes().projetosSecao(); },
    contas: () => { secoes().montarEm('fin-sub'); return secoes().prestacaoDeContas(); },
  };

  function secoes() { return window.SecoesArrecadacao; }

  async function render(container) {
    [S.state.fornecedores, S.state.clientes, S.state.categoriasDespesa] = await Promise.all([
      API.get('/api/fornecedores').catch(() => []),
      API.get('/api/clientes').catch(() => []),
      API.get('/api/financeiro/categorias-despesa').catch(() => []),
    ]);
    if (S.ehInstituto()) {
      S.state.projetos = await API.get('/api/arrecadacao/projetos').catch(() => []);
      if (window.SecoesArrecadacao) await SecoesArrecadacao.carregarProjetos();
    }

    const abas = S.ehInstituto() ? ABAS_INSTITUTO : ABAS_PADRAO;
    if (!abas.some((a) => a.id === abaAtual)) abaAtual = abas[0].id;

    container.innerHTML = `
      <div id="fin-alertas" class="mb-16"></div>
      <div class="tabs">
        ${abas.map((a) => `<div class="tab ${a.id === abaAtual ? 'ativo' : ''}" data-aba="${a.id}">${a.rotulo}</div>`).join('')}
      </div>
      <div id="fin-conteudo"></div>`;

    container.querySelectorAll('.tabs > .tab').forEach((t) => t.addEventListener('click', () => {
      abaAtual = t.dataset.aba;
      container.querySelectorAll('.tabs > .tab').forEach((x) => x.classList.toggle('ativo', x === t));
      trocarAba();
    }));

    await Promise.all([
      API.post('/api/financeiro/contas-fixas/gerar-pendentes', {}).catch(() => {}),
      API.post('/api/financeiro/assinaturas/gerar-pendentes', {}).catch(() => {}),
    ]);
    S.carregarAlertas();
    trocarAba();
  }

  function trocarAba() {
    const conteudo = document.getElementById('fin-conteudo');
    if (!conteudo) return;
    // Limpa antes de trocar: sem isso, um #fin-sub que sobrou da aba anterior
    // faria a proxima aba desenhar dentro da barra de sub-abas antiga.
    conteudo.innerHTML = '';

    if (!S.ehInstituto()) { (RENDERIZADORES[abaAtual] || RENDERIZADORES.fluxo)(); return; }

    const def = ABAS_INSTITUTO.find((a) => a.id === abaAtual) || ABAS_INSTITUTO[0];
    if (!def.subs) { (RENDERIZADORES[def.id] || RENDERIZADORES.fluxo)(); return; }

    conteudo.innerHTML = `
      <div class="tabs tabs--sub">
        ${def.subs.map((s) => `<div class="tab ${s.id === subAtual[def.id] ? 'ativo' : ''}" data-sub="${s.id}">${s.rotulo}</div>`).join('')}
      </div>
      <div id="fin-sub"></div>`;
    conteudo.querySelectorAll('[data-sub]').forEach((t) => t.addEventListener('click', () => {
      subAtual[def.id] = t.dataset.sub;
      conteudo.querySelectorAll('[data-sub]').forEach((x) => x.classList.toggle('ativo', x === t));
      document.getElementById('fin-sub').innerHTML = '';
      RENDERIZADORES[subAtual[def.id]]();
    }));
    RENDERIZADORES[subAtual[def.id]]();
  }

  return { titulo: 'Financeiro', render };
})();
