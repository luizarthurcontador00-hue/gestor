'use strict';

/**
 * Estado e helpers compartilhados entre as abas de Financeiro (pagar, contas
 * fixas, assinaturas, receber, fluxo, DRE, conciliação). `state` é um objeto
 * mutável — cada aba le/escreve nas mesmas chaves em vez de ter sua própria
 * cópia de fornecedores/clientes/contas.
 *
 * As abas de instituto (ofertas, doações, mantenedores, prestação de contas)
 * não vivem aqui — continuam delegadas a window.SecoesArrecadacao, como já
 * era antes da divisão deste arquivo.
 */
window.FinanceiroShared = (function () {
  const state = {
    fornecedores: [],
    clientes: [],
    contasFin: [],
    categoriasDespesa: [],
    projetos: [],
  };

  const ehInstituto = () => window.__ramoServico === 'instituto';
  // No instituto a "mensalidade" e a contribuicao mensal do mantenedor, nao
  // uma cobranca de cliente — os mesmos rotulos da tela de Pessoas.
  const rMens = (m) => (ehInstituto() ? (m ? 'Contribuição mensal' : 'contribuição mensal') : (m ? 'Mensalidade' : 'mensalidade'));
  const ehProfessor = () => window.__ramoServico === 'professor';
  const rMantenedor = (m) => {
    if (ehInstituto()) return m ? 'Mantenedor' : 'mantenedor';
    if (ehProfessor()) return m ? 'Aluno' : 'aluno';
    return m ? 'Cliente' : 'cliente';
  };

  /** Data de hoje no fuso local (toISOString() viraria o dia a partir das 21h no Brasil). */
  function hojeLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const dataBR = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

  /** Proximo vencimento (AAAA-MM-DD) de uma cobranca mensal no `dia`, a partir de `hojeISO` (inclusive); mes curto cai no ultimo dia. */
  function proximoVencimento(dia, hojeISO) {
    let a = Number(hojeISO.slice(0, 4));
    let m = Number(hojeISO.slice(5, 7));
    const monta = () => `${a}-${String(m).padStart(2, '0')}-${String(Math.min(Number(dia), new Date(a, m, 0).getDate())).padStart(2, '0')}`;
    let v = monta();
    if (v < hojeISO) { m += 1; if (m > 12) { m = 1; a += 1; } v = monta(); }
    return v;
  }

  /** Mensagem padrao de cobranca por WhatsApp de uma conta a receber pendente. */
  function mensagemCobranca(conta, hojeISO) {
    const venc = String(conta.vencimento || '').slice(0, 10);
    const quando = venc && venc < hojeISO ? 'que venceu em' : 'com vencimento em';
    return `Olá, ${conta.cliente_nome || ''}! Passando para lembrar da mensalidade de ${UI.moeda(conta.valor)} ${quando} ${venc ? dataBR(venc) : '—'}.`;
  }

  function abrirWhatsApp(telefone, mensagem) {
    const num = String(telefone || '').replace(/\D/g, '');
    if (!num) return;
    const completo = num.length <= 11 ? '55' + num : num; // DDI Brasil quando não informado
    const url = `https://wa.me/${completo}?text=${encodeURIComponent(mensagem)}`;
    try {
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (_) { window.open(url, '_blank'); }
  }

  const FORMAS = { dinheiro: 'Dinheiro', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito', pix: 'PIX', prazo: 'A prazo', boleto: 'Boleto', transferencia: 'Transferência' };
  // Formas que alimentam um saldo (a prazo nao entra em conta na hora).
  const FORMAS_SALDO = { dinheiro: 'Dinheiro', pix: 'PIX', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito', transferencia: 'Transferência', boleto: 'Boleto' };
  const TIPOS_CONTA = { dinheiro: '💵 Dinheiro', banco: '🏦 Banco', cartao: '💳 Máquina de cartão', outro: '📦 Outro' };

  function mesCorrente() { return new Date().toISOString().slice(0, 7); }
  function periodoMes(anoMes) {
    const [a, m] = anoMes.split('-').map(Number);
    const inicio = `${anoMes}-01`;
    const fim = new Date(a, m, 0).toISOString().slice(0, 10);
    return { inicio, fim };
  }
  function mesLabel(anoMes) {
    const [a, m] = anoMes.split('-').map(Number);
    const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return `${nomes[m - 1]} de ${a}`;
  }
  function mudarMes(anoMes, delta) {
    const [a, m] = anoMes.split('-').map(Number);
    const d = new Date(a, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** Onde a aba atual deve desenhar: dentro da sub-aba, se houver. */
  function alvoConteudo() {
    return document.getElementById('fin-sub') || document.getElementById('fin-conteudo');
  }

  async function carregarAlertas() {
    const alvo = document.getElementById('fin-alertas');
    if (!alvo) return;
    let a;
    try { a = await API.get('/api/financeiro/alertas?dias=7'); } catch { return; }
    const blocos = [];
    const rotuloPagar = ehInstituto() ? 'despesa(s)' : 'conta(s) a pagar';
    if (a.pagar.vencidas.c > 0) blocos.push(`<span class="badge badge--erro">${a.pagar.vencidas.c} ${rotuloPagar} vencida(s) — ${UI.moeda(a.pagar.vencidas.v)}</span>`);
    if (a.pagar.aVencer.c > 0) blocos.push(`<span class="badge badge--alerta">${a.pagar.aVencer.c} a pagar em 7 dias — ${UI.moeda(a.pagar.aVencer.v)}</span>`);
    if (a.receber.vencidas.c > 0) blocos.push(`<span class="badge badge--alerta">${a.receber.vencidas.c} a receber vencida(s) — ${UI.moeda(a.receber.vencidas.v)}</span>`);
    if (a.receber.aVencer.c > 0) blocos.push(`<span class="badge badge--muted">${a.receber.aVencer.c} a receber em 7 dias — ${UI.moeda(a.receber.aVencer.v)}</span>`);
    alvo.innerHTML = blocos.length ? `<div class="card" style="display:flex;gap:8px;flex-wrap:wrap">${blocos.join(' ')}</div>` : '';
  }

  function situacao(c) {
    if (c.tipo === 'venda_vista') return '<span class="badge badge--ok">Recebida (venda)</span>';
    if (c.status === 'pago' || c.status === 'recebido') return '<span class="badge badge--ok">Quitada</span>';
    if (c.status === 'cancelada') return '<span class="badge badge--muted">Cancelada</span>';
    const hoje = new Date().toISOString().slice(0, 10);
    if (c.vencimento && c.vencimento < hoje) return '<span class="badge badge--erro">Vencida</span>';
    return '<span class="badge badge--alerta">Pendente</span>';
  }

  function rotuloNovaConta(prefixo) {
    if (ehInstituto()) return prefixo === 'cp' ? 'Nova despesa' : 'Nova cobrança a receber';
    return prefixo === 'cp' ? 'Nova conta a pagar' : 'Nova conta a receber';
  }

  // Barra de navegacao de mes reutilizavel (A Pagar / A Receber).
  function barraMes(filtro, prefixo, statusOpcoes) {
    return `
      <div class="barra-ferramentas">
        <div class="flex gap-12" style="align-items:center">
          <button class="btn btn--secundario" id="${prefixo}-mes-ant" ${filtro.todos ? 'disabled' : ''}>◀</button>
          <strong style="min-width:150px;text-align:center">${filtro.todos ? 'Todos os períodos' : mesLabel(filtro.mes)}</strong>
          <button class="btn btn--secundario" id="${prefixo}-mes-prox" ${filtro.todos ? 'disabled' : ''}>▶</button>
          <label class="flex gap-12" style="align-items:center;font-size:13px;margin-left:8px">
            <input type="checkbox" id="${prefixo}-todos" ${filtro.todos ? 'checked' : ''}> Ver todos
          </label>
        </div>
        <select id="${prefixo}-status">${statusOpcoes}</select>
        <div class="cresce"></div>
        <button class="btn" id="${prefixo}-nova">+ ${rotuloNovaConta(prefixo)}</button>
      </div>`;
  }

  /** Liga os controles da barraMes. `rerender` refaz a tela (troca de mes/todos); `recarregar` so a lista (troca de status). */
  function ligarBarraMes(alvo, filtro, prefixo, { rerender, recarregar }) {
    alvo.querySelector(`#${prefixo}-mes-ant`).addEventListener('click', () => { filtro.mes = mudarMes(filtro.mes, -1); rerender(); });
    alvo.querySelector(`#${prefixo}-mes-prox`).addEventListener('click', () => { filtro.mes = mudarMes(filtro.mes, 1); rerender(); });
    alvo.querySelector(`#${prefixo}-todos`).addEventListener('change', (e) => { filtro.todos = e.target.checked; rerender(); });
    alvo.querySelector(`#${prefixo}-status`).addEventListener('change', (e) => { filtro.status = e.target.value; recarregar(); });
  }

  function queryPeriodo(filtro) {
    const params = new URLSearchParams();
    if (filtro.status) params.set('status', filtro.status);
    if (!filtro.todos) {
      const { inicio, fim } = periodoMes(filtro.mes);
      params.set('inicio', inicio); params.set('fim', fim);
    }
    return params.toString();
  }

  // ------------------------ Tabela e acoes (Pagar/Receber) ---------------------------
  function tabelaContas(contas, tipo) {
    return `<table class="tabela">
      <thead><tr><th>Descrição</th>${tipo === 'pagar' ? '<th>Fornecedor</th>' : ''}<th>Venc.</th><th>Valor</th><th>Situação</th><th></th></tr></thead>
      <tbody>${contas.map((c) => {
        const quitada = c.status === 'pago' || c.status === 'recebido';
        const ehVista = c.tipo === 'venda_vista';
        return `<tr>
          <td>${UI.escapar(c.descricao)}${tipo === 'pagar' && c.conta_fixa_id ? ' <span class="badge badge--muted" title="Gerada automaticamente de uma conta fixa">🔁 fixa</span>' : ''}${tipo === 'receber' && c.assinatura_id ? ` <span class="badge badge--muted" title="Gerada automaticamente de uma ${rMens()}">🔁 ${rMens()}</span>` : ''}${tipo === 'pagar' && c.total_parcelas > 1 ? ` <span class="badge badge--muted">${c.parcela}/${c.total_parcelas}</span>` : ''}${tipo === 'pagar' && c.categoria_nome ? `<div class="dica">🏷️ ${UI.escapar(c.categoria_nome)}</div>` : ''}${tipo === 'pagar' && c.projeto_nome ? `<div class="dica">📁 ${UI.escapar(c.projeto_nome)}</div>` : ''}</td>
          ${tipo === 'pagar' ? `<td>${UI.escapar(c.fornecedor_nome || '—')}</td>` : ''}
          <td>${c.vencimento ? UI.dataHora(c.vencimento) : '—'}</td>
          <td>${UI.moeda(c.valor)}</td>
          <td>${situacao(c)}</td>
          <td style="text-align:right;white-space:nowrap">
            ${!quitada && c.status !== 'cancelada' ? `<button class="btn" data-baixar="${c.id}">${tipo === 'pagar' ? 'Pagar' : 'Receber'}</button>` : ''}
            ${tipo === 'receber' && c.status === 'pendente' ? `<button class="btn btn--secundario" data-cobranca="${c.id}">🧾 Cobrança</button>` : ''}
            ${tipo === 'receber' && c.status === 'pendente' && ehProfessor() && c.cliente_telefone ? `<button class="btn btn--secundario" data-cobrar-wa="${c.id}">💬 Cobrar</button>` : ''}
            ${quitada && !ehVista ? `<button class="btn btn--secundario" data-reabrir="${c.id}">Reabrir</button>` : ''}
            ${ehVista ? '' : `<button class="btn btn--secundario" data-editar="${c.id}">Editar</button>`}
            ${ehVista ? '' : `<button class="btn btn--secundario" data-excluir="${c.id}">✕</button>`}
          </td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  /** Liga os botoes da tabelaContas. `recarregar`/`formulario` sao as funcoes da aba que chamou (Pagar ou Receber). */
  function ligarAcoes(alvo, tipo, contas, { recarregar, formulario }) {
    const base = '/api/financeiro/contas-' + tipo;
    alvo.querySelectorAll('[data-baixar]').forEach((b) => b.addEventListener('click', () => baixar(tipo, b.dataset.baixar, recarregar)));
    alvo.querySelectorAll('[data-cobranca]').forEach((b) => b.addEventListener('click', () => imprimirCobranca(b.dataset.cobranca)));
    alvo.querySelectorAll('[data-cobrar-wa]').forEach((b) => b.addEventListener('click', () => {
      const c = contas.find((x) => x.id === Number(b.dataset.cobrarWa));
      if (c) abrirWhatsApp(c.cliente_telefone, mensagemCobranca(c, hojeLocal()));
    }));
    alvo.querySelectorAll('[data-reabrir]').forEach((b) => b.addEventListener('click', async () => {
      try { await API.post(`${base}/${b.dataset.reabrir}/reabrir`, {}); await recarregar(); carregarAlertas(); } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => {
      const c = contas.find((x) => x.id === Number(b.dataset.editar));
      if (c) formulario(c);
    }));
    alvo.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir esta conta?', { titulo: 'Excluir conta', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`${base}/${b.dataset.excluir}`); await recarregar(); carregarAlertas(); UI.sucesso('Conta excluída.'); } catch (e) { UI.erro(e.message); }
    }));
  }

  // ------------------------ Cobrança (PIX) ---------------------------
  async function imprimirCobranca(id) {
    let dados, cfg;
    try {
      [dados, cfg] = await Promise.all([
        API.get(`/api/financeiro/contas-receber/${id}/cobranca`),
        API.get('/api/config').catch(() => ({})),
      ]);
    } catch (e) { UI.erro(e.message); return; }

    const c = dados.conta;
    const itensHTML = dados.itens.length ? `
      <table>
        <thead><tr><th style="text-align:left">Item</th><th>Qtd</th><th style="text-align:right">Valor</th></tr></thead>
        <tbody>${dados.itens.map((i) => `<tr>
          <td>${UI.escapar(i.descricao || '')}</td>
          <td style="text-align:center">${UI.numero(i.quantidade)}</td>
          <td style="text-align:right">${UI.moeda(i.valor_total)}</td>
        </tr>`).join('')}</tbody>
      </table>` : '';

    const html = `<html><head><meta charset="utf-8"><title>Cobrança #${c.id}</title>
      <style>
        * { font-family: Arial, Helvetica, sans-serif; }
        body { max-width: 480px; margin: 0 auto; padding: 24px; color:#111; }
        h2 { margin: 4px 0; }
        table { width:100%; border-collapse:collapse; margin: 12px 0; }
        td, th { padding:5px 0; border-bottom:1px solid #ddd; font-size:13px; }
        .center { text-align:center; }
        .tot { font-size:20px; font-weight:bold; margin-top:8px; }
        .pix-box { text-align:center; margin-top:24px; padding:16px; border:1px dashed #999; border-radius:8px; }
        .pix-copia { word-break: break-all; font-size:10px; background:#f4f4f4; padding:8px; border-radius:4px; margin-top:10px; }
      </style></head><body>
      ${cfg.loja_logo ? `<div class="center"><img src="${cfg.loja_logo}" style="max-width:120px;max-height:60px;object-fit:contain"></div>` : ''}
      <h2 class="center">${UI.escapar(cfg.nome_loja || 'Cobrança')}</h2>
      <p class="center" style="color:#555">Cobrança referente a: ${UI.escapar(c.descricao)}</p>
      <div class="center">Cliente: <strong>${UI.escapar(c.cliente_nome || '—')}</strong></div>
      <div class="center">Vencimento: <strong>${c.vencimento ? UI.dataHora(c.vencimento) : '—'}</strong></div>
      ${itensHTML}
      <div class="center tot">Total: ${UI.moeda(c.valor)}</div>
      <div class="pix-box">
        <div>Pague com PIX — aponte a câmera do seu banco para o QR Code</div>
        <img src="${dados.pix.qr_data_url}" style="width:220px;height:220px;margin-top:10px" />
        <div class="dica" style="margin-top:8px">Ou copie o código:</div>
        <div class="pix-copia">${UI.escapar(dados.pix.payload)}</div>
      </div>
      </body></html>`;
    UI.baixarPDF(html, `cobranca-${c.id}.pdf`);
  }

  async function baixar(tipo, id, recarregar) {
    const ehPagar = tipo === 'pagar';
    state.contasFin = await API.get('/api/financeiro/contas-financeiras').catch(() => []);
    Modal.abrir({
      titulo: ehPagar ? 'Registrar pagamento' : 'Registrar recebimento', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Data ${ehPagar ? 'do pagamento' : 'do recebimento'}</label><input id="bx-data" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
        <div class="campo mt-16"><label>Forma</label><select id="bx-forma">
          ${Object.entries(FORMAS).filter(([k]) => k !== 'prazo').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select></div>
        <div class="campo mt-16"><label>${ehPagar ? 'Sai da conta' : 'Entra na conta'}</label><select id="bx-conta">
          <option value="">Automático (pela forma)</option>
          ${state.contasFin.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)} — ${UI.moeda(c.saldo_atual)}</option>`).join('')}
        </select><div class="dica">Deixe em "automático" para usar a conta ligada à forma de pagamento.</div></div>`,
      textoConfirmar: 'Confirmar',
      aoConfirmar: async (el) => {
        const conta = el.querySelector('#bx-conta').value || null;
        const campo = ehPagar
          ? { data_pagamento: el.querySelector('#bx-data').value, forma_pagamento: el.querySelector('#bx-forma').value, conta_financeira_id: conta }
          : { data_recebimento: el.querySelector('#bx-data').value, forma_recebimento: el.querySelector('#bx-forma').value, conta_financeira_id: conta };
        try {
          await API.post(`/api/financeiro/contas-${tipo}/${id}/baixar`, campo);
          UI.sucesso(ehPagar ? 'Pagamento registrado.' : 'Recebimento registrado.');
          await recarregar(); carregarAlertas();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return {
    state,
    ehInstituto, ehProfessor, rMens, rMantenedor,
    hojeLocal, dataBR, proximoVencimento, mensagemCobranca, abrirWhatsApp,
    FORMAS, FORMAS_SALDO, TIPOS_CONTA,
    mesCorrente, periodoMes, mesLabel, mudarMes,
    alvoConteudo, carregarAlertas, situacao, rotuloNovaConta,
    barraMes, ligarBarraMes, queryPeriodo,
    tabelaContas, ligarAcoes, imprimirCobranca, baixar,
  };
})();
