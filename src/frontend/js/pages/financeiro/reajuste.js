'use strict';

/** Reajuste em lote das mensalidades dos alunos (ramo professor). O servidor revalida tudo ao aplicar. */
window.FinanceiroReajuste = (function () {
  /** Novo valor da mensalidade, ou null se o reajuste digitado nao vale (mesmas regras do servidor). */
  function novoValor(tipo, valor, atual) {
    const v = Number(valor);
    if (valor === '' || valor == null || !Number.isFinite(v)) return null;
    let novo;
    if (tipo === 'percentual') {
      if (v === 0 || v < -90) return null;
      novo = atual * (1 + v / 100);
    } else {
      novo = v;
    }
    novo = Number(novo.toFixed(2)); // igual ao arred() do servidor
    return novo > 0 ? novo : null;
  }

  function linhasHTML(itens, tipo, valor) {
    return itens.map((a) => {
      const novo = novoValor(tipo, valor, a.valor);
      return `<tr>
        <td><input type="checkbox" class="rj-sel" value="${a.id}" checked /></td>
        <td>${UI.escapar(a.cliente_nome)}</td>
        <td>${UI.moeda(a.valor)}</td>
        <td>${novo == null ? '<span class="muted">—</span>' : `<strong>${UI.moeda(novo)}</strong> <span class="dica">${novo >= a.valor ? '+' : '−'}${UI.moeda(Math.abs(novo - a.valor))}</span>`}</td>
      </tr>`;
    }).join('');
  }

  async function abrir({ aoConcluir } = {}) {
    let itens;
    try {
      const hoje = new Date().toISOString().slice(0, 10);
      itens = (await API.get('/api/financeiro/assinaturas')).filter((a) => a.ativa && (!a.data_fim || a.data_fim >= hoje));
    } catch (e) { UI.erro(e.message); return; }
    if (!itens.length) { UI.alerta('Nenhuma mensalidade ativa para reajustar.'); return; }

    Modal.abrir({
      titulo: 'Reajustar mensalidades', tamanho: 'modal--grande',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo"><label>Tipo de reajuste</label><select id="rj-tipo">
            <option value="percentual">Percentual (%)</option><option value="valor">Novo valor fixo (R$)</option>
          </select></div>
          <div class="campo"><label id="rj-rotulo">Percentual (%)</label><input id="rj-valor" type="number" step="0.01" placeholder="Ex.: 10" /></div>
        </div>
        <table class="tabela mt-16"><thead><tr><th style="width:32px"><input type="checkbox" id="rj-todos" checked /></th><th>Aluno</th><th>Antes</th><th>Depois</th></tr></thead>
          <tbody id="rj-linhas">${linhasHTML(itens, 'percentual', '')}</tbody></table>
        <div class="campo mt-16"><label>Motivo <span class="dica">(opcional)</span></label><input id="rj-motivo" placeholder="Ex.: Reajuste anual" /></div>
        <label class="flex gap-12 mt-16" style="align-items:center;cursor:pointer">
          <input type="checkbox" id="rj-mes" />
          <span>Aplicar também na cobrança deste mês, se ainda estiver pendente</span>
        </label>
        <span class="dica">Sem marcar, o novo valor vale a partir da próxima cobrança lançada; o que já está em "A receber" não muda.</span>`,
      textoConfirmar: 'Aplicar reajuste',
      aoAbrir: (el) => {
        const tipo = el.querySelector('#rj-tipo');
        const valor = el.querySelector('#rj-valor');
        const redesenhar = () => {
          el.querySelector('#rj-rotulo').textContent = tipo.value === 'percentual' ? 'Percentual (%)' : 'Novo valor (R$)';
          const marcados = new Set(Array.from(el.querySelectorAll('.rj-sel:checked')).map((c) => Number(c.value)));
          el.querySelector('#rj-linhas').innerHTML = linhasHTML(itens, tipo.value, valor.value);
          el.querySelectorAll('.rj-sel').forEach((c) => { c.checked = marcados.has(Number(c.value)); });
          el.querySelector('#rj-todos').checked = el.querySelectorAll('.rj-sel:checked').length === itens.length;
        };
        tipo.addEventListener('change', redesenhar);
        valor.addEventListener('input', redesenhar);
        el.querySelector('#rj-todos').addEventListener('change', (e) => {
          el.querySelectorAll('.rj-sel').forEach((c) => { c.checked = e.target.checked; });
        });
      },
      aoConfirmar: async (el) => {
        const ids = Array.from(el.querySelectorAll('.rj-sel:checked')).map((c) => Number(c.value));
        if (!ids.length) { UI.erro('Marque ao menos um aluno.'); return false; }
        const tipo = el.querySelector('#rj-tipo').value;
        const valor = el.querySelector('#rj-valor').value;
        if (itens.some((a) => ids.includes(a.id) && novoValor(tipo, valor, a.valor) == null)) {
          UI.erro('Informe um reajuste válido: o novo valor de cada aluno marcado deve ficar acima de zero.');
          return false;
        }
        const mes = el.querySelector('#rj-mes').checked;
        const ok = await UI.confirmar(
          `Reajustar a mensalidade de ${ids.length} aluno(s)?${mes ? ' As cobranças pendentes deste mês também serão atualizadas.' : ''}`,
          { titulo: 'Confirmar reajuste', textoConfirmar: 'Reajustar', perigo: false }
        );
        if (!ok) return false;
        try {
          const r = await API.post('/api/financeiro/assinaturas/reajuste', {
            tipo, valor: Number(valor), assinatura_ids: ids, motivo: el.querySelector('#rj-motivo').value, atualizar_cobranca_do_mes: mes,
          });
          UI.sucesso(`${r.reajustadas} mensalidade(s) reajustada(s)${mes ? `; ${r.cobrancas_atualizadas} cobrança(s) do mês atualizada(s)` : ''}.`);
          if (aoConcluir) await aoConcluir(r);
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { abrir, novoValor };
})();
