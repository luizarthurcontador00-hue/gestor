'use strict';

/** Aba "A Pagar" (ou "Despesas" no instituto): contas a pagar com parcelamento. */
window.FinanceiroPagar = (function () {
  const S = window.FinanceiroShared;
  const filtroPagar = { mes: S.mesCorrente(), todos: false, status: '' };

  async function render() {
    const alvo = S.alvoConteudo();
    const statusOpcoes = ['<option value="">Todas</option>', '<option value="pendente">Pendentes</option>', '<option value="pago">Pagas</option>']
      .map((o) => o.replace(`value="${filtroPagar.status}"`, `value="${filtroPagar.status}" selected`)).join('');
    alvo.innerHTML = S.barraMes(filtroPagar, 'cp', statusOpcoes) + '<div class="card"><div id="cp-lista">Carregando…</div></div>';
    S.ligarBarraMes(alvo, filtroPagar, 'cp', { rerender: render, recarregar: listar });
    // Sem a arrow, o evento de clique chegaria como se fosse a conta e o
    // formulario abriria em modo de edicao de um registro inexistente.
    alvo.querySelector('#cp-nova').addEventListener('click', () => form());
    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('cp-lista');
    let contas;
    try { contas = await API.get('/api/financeiro/contas-pagar?' + S.queryPeriodo(filtroPagar)); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!contas.length) { alvo.innerHTML = '<p class="muted">Nenhuma conta neste período.</p>'; return; }
    const total = contas.reduce((s, c) => s + Number(c.valor), 0);
    const pend = contas.filter((c) => c.status === 'pendente').reduce((s, c) => s + Number(c.valor), 0);
    alvo.innerHTML = S.tabelaContas(contas, 'pagar') +
      `<div class="flex flex--between mt-16" style="font-size:14px"><span class="muted">${contas.length} conta(s)</span>
        <span>Pendente: <strong style="color:var(--perigo)">${UI.moeda(pend)}</strong> · Total: <strong>${UI.moeda(total)}</strong></span></div>`;
    S.ligarAcoes(alvo, 'pagar', contas, { recarregar: listar, formulario: form });
  }

  async function form(cp) {
    const ehEdicao = !!cp;
    const inst = S.ehInstituto();
    // Projeto recem-criado na aba ao lado precisa aparecer aqui na hora.
    if (inst) S.state.projetos = await API.get('/api/arrecadacao/projetos').catch(() => S.state.projetos);
    Modal.abrir({
      titulo: ehEdicao ? (inst ? 'Editar despesa' : 'Editar conta a pagar') : (inst ? 'Nova despesa' : 'Nova conta a pagar'), tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Descrição *</label><input id="cp-desc" value="${UI.escapar(cp ? cp.descricao : '')}" /></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Fornecedor</label><select id="cp-forn"><option value="">—</option>${S.state.fornecedores.map((f) => `<option value="${f.id}" ${cp && String(cp.fornecedor_id) === String(f.id) ? 'selected' : ''}>${UI.escapar(f.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Categoria${inst ? '' : ' (DRE)'}</label><select id="cp-cat"><option value="">— sem categoria —</option>${S.state.categoriasDespesa.map((c) => `<option value="${c.id}" ${cp && String(cp.categoria_despesa_id) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}${c.considera_dre ? '' : ' (fora do DRE)'}</option>`).join('')}</select></div>
        </div>
        ${inst ? `
        <div class="campo mt-16"><label>Projeto</label>
          <select id="cp-projeto"><option value="">Nenhum (custeio geral)</option>${S.state.projetos.map((p) => `<option value="${p.id}" ${cp && String(cp.projeto_id) === String(p.id) ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}</select>
          <div class="dica">Marcando o projeto, esta despesa entra no "gasto" dele na prestação de contas.</div>
        </div>` : ''}
        ${!ehEdicao ? `
        <div class="campo mt-16"><label>Como vai informar o valor?</label>
          <div class="flex gap-12" style="align-items:center;flex-wrap:wrap">
            <label class="flex gap-12" style="align-items:center"><input type="radio" name="cp-modo" value="unico" checked> Valor único (divide pelas parcelas)</label>
            <label class="flex gap-12" style="align-items:center"><input type="radio" name="cp-modo" value="parcela"> Valor de cada parcela</label>
          </div>
        </div>` : ''}
        <div class="campo mt-16"><label id="cp-valor-label">${ehEdicao ? 'Valor (R$) *' : 'Valor total (R$) *'}</label><input id="cp-valor" type="number" step="0.01" min="0" value="${cp ? cp.valor : ''}" /></div>
        ${!ehEdicao ? `
        <div class="form-grid mt-16">
          <div class="campo"><label>Parcelas</label><input id="cp-parc" type="number" min="1" value="1" /></div>
          <div class="campo" id="cp-parcini-wrap" style="display:none"><label>Começa na parcela nº</label><input id="cp-parcini" type="number" min="1" value="1" /></div>
        </div>` : ''}
        <div class="campo mt-16"><label>${ehEdicao ? 'Vencimento' : '1º vencimento'}</label><input id="cp-venc" type="date" value="${cp ? (cp.vencimento || '') : new Date().toISOString().slice(0, 10)}" /></div>
        <div class="dica mt-16">${ehEdicao ? 'Editando apenas este lançamento.' : 'A categoria organiza a conta no DRE. Com mais de uma parcela, cada parcela vence a cada mês (uma conta por parcela).'}</div>`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        CadastroRapido.ligar(el.querySelector('#cp-forn'), 'fornecedor', { aoCriar: (r) => S.state.fornecedores.push(r) });
        CadastroRapido.ligar(el.querySelector('#cp-cat'), 'categoria_despesa', { aoCriar: (r) => S.state.categoriasDespesa.push(r) });
        if (ehEdicao) return;
        const parc = el.querySelector('#cp-parc');
        const parciniWrap = el.querySelector('#cp-parcini-wrap');
        const label = el.querySelector('#cp-valor-label');
        parc.addEventListener('input', () => {
          parciniWrap.style.display = Number(parc.value) > 1 ? '' : 'none';
        });
        el.querySelectorAll('input[name="cp-modo"]').forEach((r) => r.addEventListener('change', () => {
          const modo = el.querySelector('input[name="cp-modo"]:checked').value;
          label.textContent = modo === 'parcela' ? 'Valor de cada parcela (R$) *' : 'Valor total (R$) *';
        }));
      },
      aoConfirmar: async (el) => {
        try {
          const projetoSel = el.querySelector('#cp-projeto');
          const projetoId = projetoSel ? (projetoSel.value || null) : undefined;
          if (ehEdicao) {
            await API.put(`/api/financeiro/contas-pagar/${cp.id}`, {
              descricao: el.querySelector('#cp-desc').value, fornecedor_id: el.querySelector('#cp-forn').value || null,
              categoria_despesa_id: el.querySelector('#cp-cat').value || null,
              projeto_id: projetoId,
              valor: el.querySelector('#cp-valor').value, vencimento: el.querySelector('#cp-venc').value || null,
            });
            UI.sucesso(inst ? 'Despesa atualizada.' : 'Conta atualizada.');
          } else {
            const modo = el.querySelector('input[name="cp-modo"]:checked').value;
            const r = await API.post('/api/financeiro/contas-pagar', {
              descricao: el.querySelector('#cp-desc').value, fornecedor_id: el.querySelector('#cp-forn').value || null,
              categoria_despesa_id: el.querySelector('#cp-cat').value || null,
              projeto_id: projetoId,
              valor: el.querySelector('#cp-valor').value, valor_modo: modo,
              parcelas: el.querySelector('#cp-parc').value, parcela_inicial: el.querySelector('#cp-parcini').value,
              primeiro_vencimento: el.querySelector('#cp-venc').value || null,
            });
            UI.sucesso(r && r.criadas ? `${r.criadas} parcela(s) criada(s).` : (inst ? 'Despesa lançada.' : 'Conta criada.'));
          }
          await listar(); S.carregarAlertas();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { render, listar, form };
})();
