'use strict';

/** Aba "A Receber": contas a receber (cobranças), com parcelamento e cobrança PIX. */
window.FinanceiroReceber = (function () {
  const S = window.FinanceiroShared;
  const filtroReceber = { mes: S.mesCorrente(), todos: false, status: '' };

  async function render() {
    const alvo = S.alvoConteudo();
    const statusOpcoes = ['<option value="">Todas</option>', '<option value="pendente">Pendentes</option>', '<option value="recebido">Recebidas</option>', '<option value="cancelada">Canceladas</option>']
      .map((o) => o.replace(`value="${filtroReceber.status}"`, `value="${filtroReceber.status}" selected`)).join('');
    alvo.innerHTML = S.barraMes(filtroReceber, 'cr', statusOpcoes) + '<div class="card"><div id="cr-lista">Carregando…</div></div>';
    S.ligarBarraMes(alvo, filtroReceber, 'cr', { rerender: render, recarregar: listar });
    alvo.querySelector('#cr-nova').addEventListener('click', () => form());
    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('cr-lista');
    let contas;
    try { contas = await API.get('/api/financeiro/contas-receber?' + S.queryPeriodo(filtroReceber)); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!contas.length) { alvo.innerHTML = '<p class="muted">Nenhuma conta neste período.</p>'; return; }
    const receb = contas.filter((c) => c.status === 'recebido').reduce((s, c) => s + Number(c.valor), 0);
    const pend = contas.filter((c) => c.status === 'pendente').reduce((s, c) => s + Number(c.valor), 0);
    alvo.innerHTML = S.tabelaContas(contas, 'receber') +
      `<div class="flex flex--between mt-16" style="font-size:14px"><span class="muted">${contas.length} conta(s)</span>
        <span>A receber: <strong style="color:var(--alerta,#b45309)">${UI.moeda(pend)}</strong> · Recebido: <strong style="color:var(--sucesso)">${UI.moeda(receb)}</strong></span></div>`;
    S.ligarAcoes(alvo, 'receber', contas, { recarregar: listar, formulario: form });
  }

  function form(cr) {
    const ehEdicao = !!cr;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar conta a receber' : 'Nova conta a receber', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Descrição *</label><input id="cr-desc" value="${UI.escapar(cr ? cr.descricao : '')}" /></div>
        ${!ehEdicao ? `
        <div class="campo mt-16"><label>Como vai informar o valor?</label>
          <div class="flex gap-12" style="align-items:center;flex-wrap:wrap">
            <label class="flex gap-12" style="align-items:center"><input type="radio" name="cr-modo" value="unico" checked> Valor único (divide pelas parcelas)</label>
            <label class="flex gap-12" style="align-items:center"><input type="radio" name="cr-modo" value="parcela"> Valor de cada parcela</label>
          </div>
        </div>` : ''}
        <div class="campo mt-16"><label id="cr-valor-label">${ehEdicao ? 'Valor (R$) *' : 'Valor total (R$) *'}</label><input id="cr-valor" type="number" step="0.01" min="0" value="${cr ? cr.valor : ''}" /></div>
        ${!ehEdicao ? `
        <div class="form-grid mt-16">
          <div class="campo"><label>Parcelas</label><input id="cr-parc" type="number" min="1" value="1" /></div>
          <div class="campo" id="cr-parcini-wrap" style="display:none"><label>Começa na parcela nº</label><input id="cr-parcini" type="number" min="1" value="1" /></div>
        </div>` : ''}
        <div class="campo mt-16"><label>${ehEdicao ? 'Vencimento' : '1º vencimento'}</label><input id="cr-venc" type="date" value="${cr ? (cr.vencimento || '') : new Date().toISOString().slice(0, 10)}" /></div>
        <div class="dica mt-16">${ehEdicao ? 'Editando apenas este lançamento.' : 'Parcelas mensais são geradas automaticamente.'}</div>`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        if (ehEdicao) return;
        const parc = el.querySelector('#cr-parc');
        const parciniWrap = el.querySelector('#cr-parcini-wrap');
        const label = el.querySelector('#cr-valor-label');
        parc.addEventListener('input', () => {
          parciniWrap.style.display = Number(parc.value) > 1 ? '' : 'none';
        });
        el.querySelectorAll('input[name="cr-modo"]').forEach((r) => r.addEventListener('change', () => {
          const modo = el.querySelector('input[name="cr-modo"]:checked').value;
          label.textContent = modo === 'parcela' ? 'Valor de cada parcela (R$) *' : 'Valor total (R$) *';
        }));
      },
      aoConfirmar: async (el) => {
        try {
          if (ehEdicao) {
            await API.put(`/api/financeiro/contas-receber/${cr.id}`, {
              descricao: el.querySelector('#cr-desc').value,
              valor: el.querySelector('#cr-valor').value, vencimento: el.querySelector('#cr-venc').value || null,
            });
            UI.sucesso('Conta atualizada.');
          } else {
            const modo = el.querySelector('input[name="cr-modo"]:checked').value;
            const r = await API.post('/api/financeiro/contas-receber', {
              descricao: el.querySelector('#cr-desc').value,
              valor: el.querySelector('#cr-valor').value, valor_modo: modo,
              parcelas: el.querySelector('#cr-parc').value, parcela_inicial: el.querySelector('#cr-parcini').value,
              primeiro_vencimento: el.querySelector('#cr-venc').value || null,
            });
            UI.sucesso(`${r.criadas} parcela(s) criada(s).`);
          }
          await listar(); S.carregarAlertas();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { render, listar, form };
})();
