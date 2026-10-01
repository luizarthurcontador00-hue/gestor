'use strict';

/**
 * Tarefas com acompanhamento de execucao: quadro Kanban pendente -> em
 * andamento -> concluida, com responsavel opcional (reaproveita o cadastro
 * de profissionais) e prazo.
 */
window.PaginaTarefas = (function () {
  let tarefas = [];
  let responsaveis = [];

  const COLUNAS = [
    { status: 'pendente', titulo: 'Pendente', proximo: 'andamento', rotuloAvancar: 'Iniciar →' },
    { status: 'andamento', titulo: 'Em andamento', proximo: 'concluida', rotuloAvancar: 'Concluir →' },
    { status: 'concluida', titulo: 'Concluída', proximo: null, rotuloAvancar: null },
  ];

  async function render(container) {
    responsaveis = await API.get('/api/agenda/profissionais').catch(() => []);
    await API.post('/api/tarefas/fixas/gerar-pendentes', {}).catch(() => {});
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce"></div>
        <button class="btn btn--secundario" id="tf-objetivos">🎯 Objetivos</button>
        <button class="btn btn--secundario" id="tf-fixas">🔁 Tarefas fixas</button>
        <button class="btn" id="tf-novo">+ Nova tarefa</button>
      </div>
      <div class="patio-kanban" id="tf-kanban"></div>`;
    container.querySelector('#tf-novo').addEventListener('click', () => formTarefa());
    container.querySelector('#tf-fixas').addEventListener('click', () => gerenciarFixas());
    container.querySelector('#tf-objetivos').addEventListener('click', () => gerenciarObjetivos());
    await listar();
  }

  async function listar() {
    tarefas = await API.get('/api/tarefas').catch(() => []);
    renderKanban();
  }

  function renderKanban() {
    const alvo = document.getElementById('tf-kanban');
    if (!alvo) return;
    const hoje = new Date().toISOString().slice(0, 10);
    alvo.innerHTML = COLUNAS.map((col) => {
      const itens = tarefas.filter((t) => t.status === col.status);
      return `<div class="patio-coluna">
        <div class="patio-coluna__titulo">${col.titulo} <span class="badge badge--muted">${itens.length}</span></div>
        <div class="patio-coluna__cards">${itens.length ? itens.map((t) => cardTarefa(t, col, hoje)).join('') : '<div class="patio-vazio">Vazio</div>'}</div>
      </div>`;
    }).join('');

    alvo.querySelectorAll('[data-ver]').forEach((c) => c.addEventListener('click', () => formTarefa(tarefas.find((t) => t.id === Number(c.dataset.ver)))));
    alvo.querySelectorAll('[data-avancar]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await API.put(`/api/tarefas/${b.dataset.avancar}`, { status: b.dataset.para }); await listar(); }
      catch (err) { UI.erro(err.message); }
    }));
  }

  function cardTarefa(t, col, hoje) {
    const atrasada = col.status !== 'concluida' && t.prazo && t.prazo < hoje;
    return `<div class="patio-card" data-ver="${t.id}">
      <div class="patio-card__num">#${t.id}${t.prazo ? ` · prazo ${t.prazo}${atrasada ? ' ⚠️' : ''}` : ''}</div>
      <div class="patio-card__cliente">${UI.escapar(t.titulo)}</div>
      ${t.responsavel_nome ? `<div class="patio-card__resp">${t.responsavel_cor ? `<span class="cm-cor" style="background:${t.responsavel_cor}"></span> ` : ''}${UI.escapar(t.responsavel_nome)}</div>` : ''}
      ${col.proximo ? `<div class="patio-card__acao"><button class="btn btn--secundario" data-avancar="${t.id}" data-para="${col.proximo}">${col.rotuloAvancar}</button></div>` : ''}
    </div>`;
  }

  function formTarefa(t) {
    const ehEdicao = !!t;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar tarefa' : 'Nova tarefa', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Título *</label><input id="tf-titulo" value="${UI.escapar(t ? t.titulo : '')}" /></div>
        <div class="campo mt-16"><label>Descrição</label><textarea id="tf-desc">${UI.escapar(t && t.descricao ? t.descricao : '')}</textarea></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Responsável</label><select id="tf-resp"><option value="">— sem responsável —</option>${responsaveis.map((r) => `<option value="${r.id}" ${t && String(t.responsavel_id) === String(r.id) ? 'selected' : ''}>${UI.escapar(r.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Prazo</label><input id="tf-prazo" type="date" value="${t && t.prazo ? t.prazo : ''}" /></div>
        </div>
        ${ehEdicao ? `<div class="campo mt-16"><label>Status</label>
          <select id="tf-status">${COLUNAS.map((c) => `<option value="${c.status}" ${t.status === c.status ? 'selected' : ''}>${c.titulo}</option>`).join('')}</select></div>` : ''}
        ${ehEdicao ? `<div class="mt-16"><button type="button" class="btn btn--perigo" id="tf-excluir">Excluir tarefa</button></div>` : ''}`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        CadastroRapido.ligar(el.querySelector('#tf-resp'), 'profissional', { rotulo: 'responsável', aoCriar: (r) => responsaveis.push(r) });
        const btn = el.querySelector('#tf-excluir');
        if (btn) btn.addEventListener('click', async () => {
          const ok = await UI.confirmar('Excluir esta tarefa?', { titulo: 'Excluir tarefa', textoConfirmar: 'Excluir' });
          if (!ok) return;
          try { await API.del(`/api/tarefas/${t.id}`); el.remove(); UI.sucesso('Tarefa excluída.'); await listar(); }
          catch (e) { UI.erro(e.message); }
        });
      },
      aoConfirmar: async (el) => {
        const dados = {
          titulo: el.querySelector('#tf-titulo').value,
          descricao: el.querySelector('#tf-desc').value,
          responsavel_id: el.querySelector('#tf-resp').value || null,
          prazo: el.querySelector('#tf-prazo').value || null,
        };
        const statusSel = el.querySelector('#tf-status');
        if (statusSel) dados.status = statusSel.value;
        try {
          if (ehEdicao) await API.put(`/api/tarefas/${t.id}`, dados);
          else await API.post('/api/tarefas', dados);
          UI.sucesso(ehEdicao ? 'Tarefa atualizada.' : 'Tarefa criada.');
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ------------------------- Tarefas fixas (recorrentes) -------------------------

  async function gerenciarFixas() {
    let fixas = [];
    try { fixas = await API.get('/api/tarefas/fixas'); } catch (e) { UI.erro(e.message); return; }

    Modal.abrir({
      titulo: '🔁 Tarefas fixas', tamanho: 'modal--grande', mostrarConfirmar: false,
      corpoHTML: `
        <p class="dica" style="margin-top:0">Tarefa que se repete todo mês (ex.: prestar contas, pagar o aluguel).
        No dia escolhido, o sistema já lança a tarefa do mês no quadro — sem precisar recriar manualmente.</p>
        <div class="barra-ferramentas"><div class="cresce"></div><button class="btn" id="tff-nova">+ Nova tarefa fixa</button></div>
        <div id="tff-lista" class="mt-16"></div>`,
      aoAbrir: (el) => {
        function desenhar() {
          el.querySelector('#tff-lista').innerHTML = fixas.length ? `<table class="tabela">
            <thead><tr><th>Título</th><th>Dia do mês</th><th>Responsável</th><th>Status</th><th></th></tr></thead>
            <tbody>${fixas.map((f) => `<tr style="${f.ativa ? '' : 'opacity:.55'}">
              <td>${UI.escapar(f.titulo)}</td>
              <td>Dia ${f.dia_mes}</td>
              <td>${UI.escapar(f.responsavel_nome || '—')}</td>
              <td>${f.ativa ? '<span class="badge badge--ok">Ativa</span>' : '<span class="badge badge--muted">Pausada</span>'}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn--secundario" data-tff-pausar="${f.id}" data-ativa="${f.ativa}">${f.ativa ? 'Pausar' : 'Reativar'}</button>
                <button class="btn btn--secundario" data-tff-editar="${f.id}">Editar</button>
                <button class="btn btn--secundario" data-tff-excluir="${f.id}">✕</button>
              </td>
            </tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhuma tarefa fixa cadastrada.</p>';

          el.querySelectorAll('[data-tff-editar]').forEach((b) => b.addEventListener('click', () => {
            formFixa(fixas.find((f) => f.id === Number(b.dataset.tffEditar)), recarregar);
          }));
          el.querySelectorAll('[data-tff-pausar]').forEach((b) => b.addEventListener('click', async () => {
            const ativa = b.dataset.ativa === '1';
            try {
              await API.put(`/api/tarefas/fixas/${b.dataset.tffPausar}`, { ativa: !ativa });
              UI.sucesso(ativa ? 'Tarefa fixa pausada.' : 'Tarefa fixa reativada.');
              await recarregar();
            } catch (e) { UI.erro(e.message); }
          }));
          el.querySelectorAll('[data-tff-excluir]').forEach((b) => b.addEventListener('click', async () => {
            const ok = await UI.confirmar('Excluir esta tarefa fixa? As tarefas já lançadas em meses anteriores não serão apagadas.', { titulo: 'Excluir tarefa fixa', textoConfirmar: 'Excluir' });
            if (!ok) return;
            try { await API.del(`/api/tarefas/fixas/${b.dataset.tffExcluir}`); UI.sucesso('Tarefa fixa excluída.'); await recarregar(); }
            catch (e) { UI.erro(e.message); }
          }));
        }
        async function recarregar() {
          fixas = await API.get('/api/tarefas/fixas').catch(() => fixas);
          desenhar();
        }
        desenhar();
        el.querySelector('#tff-nova').addEventListener('click', () => formFixa(null, recarregar));
      },
    });
  }

  function formFixa(f, aoSalvar) {
    const ehEdicao = !!f;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar tarefa fixa' : 'Nova tarefa fixa', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Título *</label><input id="tff-titulo" value="${UI.escapar(f ? f.titulo : '')}" /></div>
        <div class="campo mt-16"><label>Descrição</label><textarea id="tff-desc">${UI.escapar(f && f.descricao ? f.descricao : '')}</textarea></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Dia do mês *</label><input id="tff-dia" type="number" min="1" max="31" value="${f ? f.dia_mes : ''}" /></div>
          <div class="campo"><label>Responsável</label><select id="tff-resp"><option value="">— sem responsável —</option>${responsaveis.map((r) => `<option value="${r.id}" ${f && String(f.responsavel_id) === String(r.id) ? 'selected' : ''}>${UI.escapar(r.nome)}</option>`).join('')}</select></div>
        </div>
        <div class="dica mt-16">Todo mês, no dia informado (ajustado se o mês não tiver esse dia), uma tarefa é criada automaticamente no quadro, como "Pendente".</div>`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        CadastroRapido.ligar(el.querySelector('#tff-resp'), 'profissional', { rotulo: 'responsável', aoCriar: (r) => responsaveis.push(r) });
      },
      aoConfirmar: async (el) => {
        const dados = {
          titulo: el.querySelector('#tff-titulo').value,
          descricao: el.querySelector('#tff-desc').value,
          dia_mes: el.querySelector('#tff-dia').value,
          responsavel_id: el.querySelector('#tff-resp').value || null,
        };
        try {
          if (ehEdicao) await API.put(`/api/tarefas/fixas/${f.id}`, dados);
          else await API.post('/api/tarefas/fixas', dados);
          UI.sucesso(ehEdicao ? 'Tarefa fixa atualizada.' : 'Tarefa fixa cadastrada.');
          await API.post('/api/tarefas/fixas/gerar-pendentes', {}).catch(() => {});
          if (aoSalvar) await aoSalvar();
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ------------------------------- Objetivos -------------------------------

  async function saldoEmCaixa() {
    try {
      const contas = await API.get('/api/financeiro/contas-financeiras');
      return contas.reduce((s, c) => s + Number(c.saldo_atual || 0), 0);
    } catch (_) { return 0; }
  }

  async function gerenciarObjetivos() {
    let objetivos = [];
    let saldo = 0;
    try { [objetivos, saldo] = await Promise.all([API.get('/api/objetivos'), saldoEmCaixa()]); }
    catch (e) { UI.erro(e.message); return; }

    Modal.abrir({
      titulo: '🎯 Objetivos', tamanho: 'modal--grande', mostrarConfirmar: false,
      corpoHTML: `
        <p class="dica" style="margin-top:0">Metas do instituto pra acompanhar. Quem tiver valor cadastrado entra na conta de quanto dá pra fazer agora com o saldo em caixa.</p>
        <div class="barra-ferramentas"><div class="cresce"></div><button class="btn" id="obj-novo">+ Novo objetivo</button></div>
        <div id="obj-lista" class="mt-16"></div>`,
      aoAbrir: (el) => {
        function desenhar() {
          const abertos = objetivos.filter((o) => o.status === 'aberto');
          const encerrados = objetivos.filter((o) => o.status !== 'aberto');

          // Quem tem valor, do mais barato pro mais caro: marca "dá pra
          // fazer agora" enquanto a soma acumulada couber no saldo — assim
          // dá pra ver quantos objetivos o caixa cobre hoje, nao só um a um.
          const comValor = abertos.filter((o) => o.valor != null).sort((a, b) => a.valor - b.valor);
          let acumulado = 0;
          const cabe = new Set();
          comValor.forEach((o) => {
            if (acumulado + Number(o.valor) <= saldo) { acumulado += Number(o.valor); cabe.add(o.id); }
          });

          const linha = (o) => `<tr style="${o.status !== 'aberto' ? 'opacity:.55' : ''}">
            <td>${UI.escapar(o.titulo)}${o.descricao ? `<div class="dica">${UI.escapar(o.descricao)}</div>` : ''}</td>
            <td>${o.valor != null ? UI.moeda(o.valor) : '<span class="dica">sem valor</span>'}</td>
            <td>${o.status === 'aberto'
              ? (o.valor != null ? (cabe.has(o.id) ? '<span class="badge badge--ok">✅ dá pra fazer agora</span>' : '<span class="badge badge--alerta">falta juntar</span>') : '<span class="badge badge--muted">meta</span>')
              : (o.status === 'concluido' ? '<span class="badge badge--ok">Concluído</span>' : '<span class="badge badge--muted">Cancelado</span>')}</td>
            <td style="text-align:right;white-space:nowrap">
              ${o.status === 'aberto' ? `<button class="btn btn--secundario" data-obj-concluir="${o.id}">✔️ Concluir</button>` : ''}
              <button class="btn btn--secundario" data-obj-editar="${o.id}">Editar</button>
              <button class="btn btn--secundario" data-obj-excluir="${o.id}">✕</button>
            </td>
          </tr>`;

          el.querySelector('#obj-lista').innerHTML = `
            <div class="card mb-16"><span class="stat__label">Saldo em caixa</span> <strong>${UI.moeda(saldo)}</strong>
              ${comValor.length ? `<span class="dica"> · dá pra fazer ${cabe.size} de ${comValor.length} objetivo(s) com valor cadastrado agora</span>` : ''}</div>
            ${objetivos.length ? `<table class="tabela">
              <thead><tr><th>Objetivo</th><th>Valor</th><th>Situação</th><th></th></tr></thead>
              <tbody>${abertos.map(linha).join('')}${encerrados.map(linha).join('')}</tbody>
            </table>` : '<p class="muted">Nenhum objetivo cadastrado ainda.</p>'}`;

          el.querySelectorAll('[data-obj-editar]').forEach((b) => b.addEventListener('click', () => {
            formObjetivo(objetivos.find((o) => o.id === Number(b.dataset.objEditar)), recarregar);
          }));
          el.querySelectorAll('[data-obj-concluir]').forEach((b) => b.addEventListener('click', async () => {
            try { await API.put(`/api/objetivos/${b.dataset.objConcluir}`, { status: 'concluido' }); UI.sucesso('Objetivo concluído! 🎉'); await recarregar(); }
            catch (e) { UI.erro(e.message); }
          }));
          el.querySelectorAll('[data-obj-excluir]').forEach((b) => b.addEventListener('click', async () => {
            const ok = await UI.confirmar('Excluir este objetivo?', { titulo: 'Excluir objetivo', textoConfirmar: 'Excluir' });
            if (!ok) return;
            try { await API.del(`/api/objetivos/${b.dataset.objExcluir}`); UI.sucesso('Objetivo excluído.'); await recarregar(); }
            catch (e) { UI.erro(e.message); }
          }));
        }
        async function recarregar() {
          [objetivos, saldo] = await Promise.all([API.get('/api/objetivos').catch(() => objetivos), saldoEmCaixa()]);
          desenhar();
        }
        desenhar();
        el.querySelector('#obj-novo').addEventListener('click', () => formObjetivo(null, recarregar));
      },
    });
  }

  function formObjetivo(o, aoSalvar) {
    const ehEdicao = !!o;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar objetivo' : 'Novo objetivo', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Título *</label><input id="obj-titulo" value="${UI.escapar(o ? o.titulo : '')}" placeholder="Ex.: Comprar instrumentos, Abrir CNPJ, Iniciar turma de inglês" /></div>
        <div class="campo mt-16"><label>Descrição</label><textarea id="obj-desc">${UI.escapar(o && o.descricao ? o.descricao : '')}</textarea></div>
        <div class="campo mt-16"><label>Valor (R$) <span class="dica">(opcional — deixe em branco se não tiver custo)</span></label>
          <input id="obj-valor" type="number" step="0.01" min="0" value="${o && o.valor != null ? o.valor : ''}" /></div>`,
      textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        const titulo = el.querySelector('#obj-titulo').value.trim();
        if (!titulo) { UI.erro('Informe o título do objetivo.'); return false; }
        const dados = {
          titulo,
          descricao: el.querySelector('#obj-desc').value,
          valor: el.querySelector('#obj-valor').value === '' ? null : el.querySelector('#obj-valor').value,
        };
        try {
          if (ehEdicao) await API.put(`/api/objetivos/${o.id}`, dados);
          else await API.post('/api/objetivos', dados);
          UI.sucesso(ehEdicao ? 'Objetivo atualizado.' : 'Objetivo cadastrado.');
          if (aoSalvar) await aoSalvar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { titulo: 'Tarefas', render };
})();
