'use strict';

/**
 * Cadastro rapido ao lado de um <select>: botao "+ Novo ..." que abre um
 * modal minimo POR CIMA do formulario atual (o que ja foi digitado embaixo
 * nao se perde), cria o registro na API e ja deixa ele selecionado.
 *
 * CadastroRapido.ligar(select, tipo, { aoCriar, rotulo, irmaos, natureza, opcao })
 *  - tipo: 'cliente' | 'profissional' | 'servico' | 'fornecedor' | 'categoria' | 'conta'
 *  - aoCriar(registro): para a pagina atualizar o proprio cache (ex.: array de clientes)
 *  - irmaos: outros <select> que tambem recebem a nova opcao (sem selecionar)
 *  - extra: campos fixos acrescentados ao corpo do POST (ex.: { tipo: 'voluntario' })
 *  - opcao(registro) -> { texto, data }: sobrescreve como a <option> e' montada
 *  - Quando o select nao tem nenhuma opcao com valor, aparece tambem uma dica
 *    "Nenhum ... cadastrado" com o mesmo botao (reavalia sozinho se o select
 *    for preenchido depois, via MutationObserver).
 *
 * CadastroRapido.ligarAtalho(select, { rotulo, feminino, hash, pagina })
 *  - para cadastros complexos (turma, curso...): so a dica + atalho para a pagina.
 */
window.CadastroRapido = (function () {
  const ramo = () => window.__ramoServico;
  const ehPessoas = () => ['professor', 'creche', 'instituto'].includes(ramo());

  const TIPOS = {
    cliente: {
      rotulo: () => (ehPessoas() ? 'aluno' : 'cliente'),
      feminino: () => false,
      campos: [{ id: 'nome', rotulo: 'Nome', obrigatorio: true }, { id: 'telefone', rotulo: 'Telefone (WhatsApp)', dica: 'Ex.: 11999998888' }],
      url: '/api/clientes',
      // No instituto a mesma tabela guarda aluno e mantenedor; o padrao da tela de Pessoas e' 'aluno'.
      corpo: (v, o) => ({ nome: v.nome, telefone: v.telefone, ...(ramo() === 'instituto' ? { natureza: o.natureza || 'aluno' } : {}) }),
      opcao: (r) => ({ texto: r.nome, data: { tel: r.telefone || '' } }),
    },
    profissional: {
      rotulo: () => (ramo() === 'instituto' ? 'instrutor' : 'profissional'),
      feminino: () => false,
      campos: [{ id: 'nome', rotulo: 'Nome', obrigatorio: true }, { id: 'telefone', rotulo: 'Telefone', dica: 'Ex.: 11999998888' }],
      url: '/api/agenda/profissionais',
      corpo: (v) => ({ nome: v.nome, telefone: v.telefone }),
      opcao: (r) => ({ texto: r.nome, data: {} }),
    },
    servico: {
      rotulo: () => (ramo() === 'instituto' ? 'atividade' : ramo() === 'professor' ? 'matéria' : 'serviço'),
      feminino: () => ['instituto', 'professor'].includes(ramo()),
      campos: [{ id: 'nome', rotulo: 'Nome', obrigatorio: true }, { id: 'preco_venda', rotulo: 'Valor (R$) — opcional', numero: true }],
      url: '/api/produtos',
      corpo: (v) => ({ nome: v.nome, preco_venda: v.preco_venda, eh_servico: '1' }),
      opcao: (r) => ({ texto: r.nome, data: { preco: r.preco_venda != null ? r.preco_venda : 0 } }),
    },
    fornecedor: {
      rotulo: () => 'fornecedor',
      feminino: () => false,
      campos: [{ id: 'nome', rotulo: 'Nome / Razão social', obrigatorio: true }, { id: 'telefone', rotulo: 'Telefone' }],
      url: '/api/fornecedores',
      corpo: (v) => ({ nome: v.nome, telefone: v.telefone }),
      opcao: (r) => ({ texto: r.nome, data: {} }),
    },
    categoria: {
      rotulo: () => 'categoria',
      feminino: () => true,
      campos: [{ id: 'nome', rotulo: 'Nome', obrigatorio: true }],
      url: '/api/categorias',
      corpo: (v) => ({ nome: v.nome }),
      opcao: (r) => ({ texto: r.nome, data: {} }),
    },
    // Categoria de despesa (DRE): outra tabela e outra rota que a categoria de produto.
    categoria_despesa: {
      rotulo: () => 'categoria',
      feminino: () => true,
      campos: [{ id: 'nome', rotulo: 'Nome', obrigatorio: true }],
      url: '/api/financeiro/categorias-despesa',
      corpo: (v) => ({ nome: v.nome }),
      opcao: (r) => ({ texto: r.nome, data: {} }),
    },
    conta: {
      rotulo: () => 'conta',
      feminino: () => true,
      campos: [
        { id: 'nome', rotulo: 'Nome da conta', obrigatorio: true, dica: 'Ex.: Caixa, Banco do Brasil' },
        { id: 'tipo', rotulo: 'Tipo', opcoes: [['banco', 'Banco'], ['dinheiro', 'Dinheiro'], ['cartao', 'Cartão'], ['outro', 'Outro']] },
        { id: 'saldo_inicial', rotulo: 'Saldo inicial (R$) — opcional', numero: true },
      ],
      url: '/api/financeiro/contas-financeiras',
      corpo: (v) => ({ nome: v.nome, tipo: v.tipo, saldo_inicial: v.saldo_inicial }),
      opcao: (r) => ({ texto: r.nome, data: {} }),
    },
  };

  const temOpcaoReal = (select) => Array.from(select.options).some((o) => o.value !== '');
  const artigoNenhum = (fem, rot) => `Nenhum${fem ? 'a' : ''} ${rot} cadastrad${fem ? 'a' : 'o'}.`;

  /** Poe select e botao lado a lado (flex) sem perder listeners/valor do select. */
  function envolver(select) {
    const pai = select.parentNode;
    if (pai && pai.classList && pai.classList.contains('cr-linha')) return pai;
    const linha = document.createElement('div');
    linha.className = 'cr-linha';
    pai.insertBefore(linha, select);
    linha.appendChild(select);
    return linha;
  }

  function criarDica(linha, texto, textoBotao, aoClicar) {
    const dica = document.createElement('div');
    dica.className = 'cr-dica';
    dica.hidden = true;
    const span = document.createElement('span');
    span.textContent = texto;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cr-dica__btn';
    btn.textContent = textoBotao;
    btn.addEventListener('click', aoClicar);
    dica.appendChild(span);
    dica.appendChild(btn);
    linha.parentNode.insertBefore(dica, linha.nextSibling);
    return dica;
  }

  function observarVazio(select, dica) {
    const atualizar = () => { dica.hidden = temOpcaoReal(select); };
    atualizar();
    if (typeof MutationObserver === 'function') new MutationObserver(atualizar).observe(select, { childList: true });
    return atualizar;
  }

  function ligar(select, tipo, opts = {}) {
    const def = TIPOS[tipo];
    if (!select || !def || select.dataset.cadastroRapido) return;
    select.dataset.cadastroRapido = tipo;
    const rot = opts.rotulo || def.rotulo();
    const fem = opts.feminino != null ? opts.feminino : def.feminino();
    const textoBotao = `+ ${fem ? 'Nova' : 'Novo'} ${rot}`;

    const linha = envolver(select);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--secundario cr-btn';
    btn.title = `Cadastrar ${fem ? 'nova' : 'novo'} ${rot} sem sair desta tela`;
    btn.textContent = textoBotao;
    linha.appendChild(btn);

    const abrirCadastro = () => abrirModal(select, def, rot, fem, opts);
    btn.addEventListener('click', abrirCadastro);
    observarVazio(select, criarDica(linha, artigoNenhum(fem, rot), 'Cadastre agora →', abrirCadastro));
  }

  function ligarAtalho(select, { rotulo, feminino = false, hash, pagina } = {}) {
    if (!select || !hash || select.dataset.cadastroRapido) return;
    select.dataset.cadastroRapido = 'atalho';
    const linha = envolver(select);
    const dica = criarDica(linha, artigoNenhum(feminino, rotulo), `Ir para ${pagina || 'o cadastro'} →`, () => {
      // Fecha o modal em volta (pelo botao dele, que limpa os listeners) antes de trocar de pagina.
      const ov = select.closest && select.closest('.modal-overlay');
      const fechar = ov && ov.querySelector('[data-fechar]');
      if (fechar) fechar.click();
      window.location.hash = hash;
    });
    observarVazio(select, dica);
  }

  function acrescentarOpcao(select, def, registro, selecionar) {
    if (!select || Array.from(select.options).some((o) => o.value === String(registro.id))) return;
    const { texto, data } = def.opcao(registro);
    const op = document.createElement('option');
    op.value = String(registro.id);
    op.textContent = texto;
    Object.entries(data || {}).forEach(([k, v]) => { op.dataset[k] = String(v); });
    select.appendChild(op);
    if (selecionar) select.value = op.value;
  }

  function campoHTML(c) {
    const dica = c.dica ? ` placeholder="${UI.escapar(c.dica)}"` : '';
    const entrada = c.opcoes
      ? `<select id="cr-${c.id}">${c.opcoes.map(([v, t]) => `<option value="${v}">${UI.escapar(t)}</option>`).join('')}</select>`
      : `<input id="cr-${c.id}" ${c.numero ? 'type="number" step="0.01" min="0"' : ''}${dica} />`;
    return `<div class="campo mt-16"><label>${UI.escapar(c.rotulo)}${c.obrigatorio ? ' *' : ''}</label>${entrada}</div>`;
  }

  function abrirModal(select, def, rot, fem, opts) {
    Modal.abrir({
      titulo: `${fem ? 'Nova' : 'Novo'} ${rot}`,
      tamanho: 'modal--pequeno',
      corpoHTML: def.campos.map(campoHTML).join('') + '<div class="dica mt-16">Cadastro rápido — você completa os demais dados depois, na tela própria.</div>',
      textoConfirmar: 'Cadastrar',
      aoAbrir: (el) => {
        const primeiro = el.querySelector('input');
        if (primeiro) primeiro.focus();
        // Enter confirma (este modal nao e' um <form>).
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
            e.preventDefault();
            const ok = el.querySelector('[data-confirmar]');
            if (ok && !ok.disabled) ok.click();
          }
        });
      },
      aoConfirmar: async (el) => {
        const valores = {};
        def.campos.forEach((c) => { valores[c.id] = el.querySelector('#cr-' + c.id).value.trim(); });
        if (!valores.nome) { UI.erro('Informe o nome.'); return false; }
        let registro;
        try {
          registro = await API.post(def.url, { ...def.corpo(valores, opts), ...(opts.extra || {}) });
          const defOpcao = opts.opcao ? { opcao: opts.opcao } : def;
          acrescentarOpcao(select, defOpcao, registro, true);
          (opts.irmaos || []).forEach((s) => acrescentarOpcao(s, defOpcao, registro, false));
          select.dispatchEvent(new Event('change', { bubbles: true }));
          UI.sucesso(`${fem ? 'Nova' : 'Novo'} ${rot} cadastrad${fem ? 'a' : 'o'}.`);
        } catch (e) { UI.erro(e.message); return false; }
        if (opts.aoCriar) opts.aoCriar(registro);
      },
    });
  }

  return { ligar, ligarAtalho };
})();
