'use strict';

/**
 * Central de Gestao (tela inicial): em vez de graficos e numeros soltos,
 * mostra uma lista priorizada do que precisa de atencao agora (contas
 * vencendo, estoque baixo, faturamento, clientes inativos, meta mensal…).
 * Cada item leva direto para a tela onde a acao e resolvida.
 */
window.PaginaInicio = (function () {
  const NIVEL = {
    vermelho: { icone: '🔴' }, laranja: { icone: '🟠' }, amarelo: { icone: '🟡' },
    azul: { icone: '🔵' }, verde: { icone: '🟢' }, info: { icone: '⚪' },
  };

  function montarItem(item) {
    const d = item.dados || {};
    switch (item.tipo) {
      case 'contas_hoje': {
        const partes = [];
        if (d.qtd_pagar > 0) partes.push(`${d.qtd_pagar} a pagar (${UI.moeda(d.valor_pagar)})`);
        if (d.qtd_receber > 0) partes.push(`${d.qtd_receber} a receber (${UI.moeda(d.valor_receber)})`);
        return { titulo: `${d.qtd} conta${d.qtd > 1 ? 's' : ''} vence${d.qtd > 1 ? 'm' : ''} hoje`, detalhe: partes.join(' · ') };
      }
      case 'contas_atrasadas': {
        const partes = [];
        if (d.qtd_pagar > 0) partes.push(`${d.qtd_pagar} a pagar (${UI.moeda(d.valor_pagar)})`);
        if (d.qtd_receber > 0) partes.push(`${d.qtd_receber} a receber (${UI.moeda(d.valor_receber)})`);
        return { titulo: `${d.qtd} conta${d.qtd > 1 ? 's' : ''} atrasada${d.qtd > 1 ? 's' : ''}`, detalhe: partes.join(' · ') };
      }
      case 'estoque_baixo':
        return { titulo: `${d.qtd} produto${d.qtd > 1 ? 's' : ''} abaixo do estoque mínimo`, detalhe: 'Reponha para não perder vendas.' };
      case 'faturamento_mes': {
        const acima = d.variacao_pct >= 0;
        return {
          titulo: `O faturamento do mês está ${Math.abs(d.variacao_pct)}% ${acima ? 'acima' : 'abaixo'} do mesmo período do mês anterior`,
          detalhe: `${UI.moeda(d.atual)} até agora (mês anterior: ${UI.moeda(d.anterior)})`,
        };
      }
      case 'clientes_inativos': {
        const professor = window.__ramoServico === 'professor';
        const quem = professor ? 'aluno' : 'cliente';
        return {
          titulo: `${d.qtd} ${quem}${d.qtd > 1 ? 's' : ''} há mais de ${d.dias} dias sem ${professor ? 'aula' : 'comprar'}`,
          detalhe: professor ? 'Um contato pode reativar essas aulas.' : 'Um contato pode reativar essas vendas.',
        };
      }
      case 'meta_mensal':
        return {
          titulo: `A meta mensal está em ${d.pct}%`,
          detalhe: d.falta > 0 ? `Faltam ${UI.moeda(d.falta)} para atingir a meta de ${UI.moeda(d.meta)}.` : `Meta de ${UI.moeda(d.meta)} atingida! 🎉`,
        };
      case 'meta_nao_definida':
        return { titulo: 'Defina sua meta mensal de faturamento', detalhe: 'Acompanhe o progresso aqui na Central de Gestão.' };
      case 'lembretes_vencidos':
        return { titulo: `${d.qtd} lembrete${d.qtd > 1 ? 's' : ''} vencido${d.qtd > 1 ? 's' : ''}`, detalhe: 'Veja o que ficou pendente.' };
      default:
        return { titulo: item.tipo, detalhe: '' };
    }
  }

  const ehInstituto = () => window.__ramoServico === 'instituto';

  async function render(container) {
    if (ehInstituto()) return renderInstituto(container);
    container.innerHTML = `
      <div class="flex flex--between mb-16" style="align-items:flex-end;flex-wrap:wrap;gap:8px">
        <div>
          <h2 style="margin:0 0 4px">Central de Gestão</h2>
          <p class="dica" style="margin:0">O que precisa da sua atenção agora.</p>
        </div>
      </div>
      <div id="central-itens"></div>
      ${window.__ramoServico === 'professor' ? `<div class="card mt-16">
        <h3 style="margin-top:0">🗓️ Aulas da semana</h3>
        <div id="central-semana"></div>
      </div>` : ''}
      <div class="card mt-16">
        <h3 style="margin-top:0">${window.__ramoServico === 'professor' ? '📊 Painel do professor' : 'Resumo rápido'}</h3>
        <div class="grid grid--cards" id="central-resumo"></div>
      </div>`;

    await Promise.all([carregarCentral(container), carregarResumo(), carregarSemana(container)]);
  }

  async function carregarSemana(container) {
    const alvo = container.querySelector('#central-semana');
    if (!alvo || !window.AgendaSemana) return;
    // As aulas fixas só viram aulas na agenda quando geradas; sem isto a semana
    // apareceria vazia até alguém abrir a Agenda.
    await API.post('/api/agenda/aulas-recorrentes/gerar-pendentes', {}).catch(() => {});
    await AgendaSemana.render(alvo, { compacto: true });
  }

  async function carregarCentral(container) {
    const alvo = container.querySelector('#central-itens');
    let central;
    try { central = await API.get('/api/dashboard/central'); }
    catch (e) { alvo.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}</div>`; return; }

    const itens = central.itens || [];
    if (!itens.length) {
      alvo.innerHTML = `<div class="card central-vazio">
        <div style="font-size:32px">✅</div>
        <strong>Tudo em dia!</strong>
        <p class="dica">Nada precisa da sua atenção imediata agora.</p>
      </div>`;
      return;
    }

    alvo.innerHTML = `<div class="central-lista">${itens.map((item, idx) => {
      const { icone } = NIVEL[item.nivel] || NIVEL.info;
      const { titulo, detalhe } = montarItem(item);
      return `<div class="central-item central-item--${item.nivel}" data-idx="${idx}">
        <span class="central-item__icone">${icone}</span>
        <div class="central-item__corpo">
          <span class="central-item__titulo">${UI.escapar(titulo)}</span>
          ${detalhe ? `<span class="central-item__detalhe">${UI.escapar(detalhe)}</span>` : ''}
        </div>
        <span class="central-item__seta">→</span>
      </div>`;
    }).join('')}</div>`;

    alvo.querySelectorAll('[data-idx]').forEach((el) => el.addEventListener('click', () => {
      const item = itens[Number(el.dataset.idx)];
      if (item && item.rota) location.hash = '#/' + item.rota;
    }));
  }

  async function carregarResumo() {
    const alvo = document.getElementById('central-resumo');
    if (!alvo) return;
    if (window.__ramoServico === 'professor') return carregarResumoProfessor(alvo);

    const temProdutos = window.__perfilNegocio !== 'servico' && window.__ramoServico !== 'creche';
    let r;
    try { r = await API.get('/api/dashboard/resumo'); } catch { alvo.innerHTML = ''; return; }
    alvo.innerHTML = `
      ${cardStat('Vendas hoje', UI.moeda(r.vendas_hoje.total), `${r.vendas_hoje.qtd} venda(s)`)}
      ${cardStat('Faturamento do mês', UI.moeda(r.vendas_mes.total), `${r.vendas_mes.qtd} venda(s)`)}
      ${cardStat('Lucro do mês', UI.moeda(r.lucro_mes), `margem ${r.margem_mes}%`)}
      ${temProdutos ? cardStat('Estoque baixo', r.estoque_baixo, 'produto(s)') : ''}
      ${cardStat('A receber', UI.moeda(r.a_receber), 'pendente')}
      ${cardStat('A pagar', UI.moeda(r.a_pagar), 'pendente')}`;
  }

  async function carregarResumoProfessor(alvo) {
    let r;
    try { r = await API.get('/api/dashboard/professor'); } catch { alvo.innerHTML = ''; return; }
    alvo.innerHTML = `
      ${cardStat('Horas de aula no mês', UI.numero(r.horas_aula_mes) + 'h', `${r.aulas_mes} aula(s)`)}
      ${cardStat('Alunos cadastrados', r.alunos_ativos, 'ativos')}
      ${cardStat('Faturamento do mês', UI.moeda(r.faturamento_mes), '')}
      ${cardStat('Lucro do mês', UI.moeda(r.lucro_mes), `margem ${r.margem_mes}%`)}
      ${cardStat('A receber', UI.moeda(r.a_receber), 'pendente')}
      ${cardStat('A pagar', UI.moeda(r.a_pagar), 'pendente')}
      ${cardStat('Frequência do mês', r.frequencia_mes_pct != null ? r.frequencia_mes_pct + '%' : '—', 'aulas dadas ÷ (dadas + faltas)')}
      ${cardStat('Faltas no mês', r.faltas_mes, '')}
      ${cardStat('Remarcações', r.remarcadas_mes, 'no mês')}
      ${blocoAtencaoProfessor(r)}`;
    alvo.querySelectorAll('[data-ir]').forEach((el) => el.addEventListener('click', () => { location.hash = '#/' + el.dataset.ir; }));
    alvo.querySelectorAll('[data-aluno]').forEach((el) => el.addEventListener('click', () => {
      if (window.PaginaClientes && PaginaClientes.detalhe) PaginaClientes.detalhe(Number(el.dataset.aluno));
      else location.hash = '#/clientes';
    }));
  }

  /** Aviso de presenca por registrar e lista de alunos para acompanhar (Painel do professor). */
  function blocoAtencaoProfessor(r) {
    const semRegistro = r.sem_registro > 0
      ? `<div class="pi-alerta pi-clicavel" data-ir="agenda" style="grid-column:1/-1">⚠️ ${r.sem_registro} aula${r.sem_registro > 1 ? 's' : ''} passada${r.sem_registro > 1 ? 's' : ''} sem presença registrada — clique para abrir a agenda.</div>`
      : '';
    const alunos = r.alunos_atencao || [];
    const lista = alunos.length ? `<div style="grid-column:1/-1">
      <strong>Alunos para acompanhar</strong>
      <table class="tabela mt-16"><tbody>${alunos.map((a) => `<tr class="pi-clicavel" data-aluno="${a.id}">
        <td>${UI.escapar(a.nome)}</td><td><span class="badge badge--alerta">${UI.escapar(a.motivo)}</span></td></tr>`).join('')}</tbody></table></div>` : '';
    return semRegistro + lista;
  }

  function cardStat(label, valor, sub) {
    return `<div class="card stat">
      <span class="stat__label">${label}</span>
      <span class="stat__value" style="font-size:22px">${valor}</span>
      <span class="dica">${sub || ''}</span>
    </div>`;
  }

  // ===================== Panorama do instituto =====================
  // Um retrato de quatro frentes: ensino, aulas de hoje, acervo e dinheiro.
  // Cada bloco leva pra tela onde a coisa se resolve.

  const STATUS_AULA = {
    agendado: ['Agendada', 'alerta'], confirmado: ['Confirmada', 'muted'],
    atendido: ['Realizada', 'ok'], faltou: ['Sem aula', 'erro'],
  };

  async function renderInstituto(container) {
    container.innerHTML = `
      <p class="dica mb-16" style="margin-top:0">Como estão as turmas, as aulas, o acervo e o caixa hoje. Clique em qualquer bloco para ir direto à tela.</p>
      <div id="pi-corpo">Carregando…</div>`;

    const alvo = container.querySelector('#pi-corpo');
    let d;
    try { d = await API.get('/api/dashboard/instituto'); }
    catch (e) {
      alvo.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}</div>`;
      return;
    }
    alvo.innerHTML = corpoInstituto(d);
    alvo.querySelectorAll('[data-ir]').forEach((el) => el.addEventListener('click', () => {
      location.hash = '#/' + el.dataset.ir;
    }));
  }

  function corpoInstituto(d) {
    return `
      ${blocoNumeros(d)}
      <div class="painel-instituto mt-16">
        ${blocoAulasHoje(d.aulas)}
        ${blocoTurmas(d.ensino)}
      </div>
      <div class="painel-instituto mt-16">
        ${blocoAcervo(d.acervo)}
        ${blocoDinheiro(d.dinheiro)}
      </div>
      <div class="painel-instituto mt-16">
        ${blocoObjetivos(d.objetivos)}
        ${blocoAniversariantes(d.aniversariantes)}
      </div>`;
  }

  function blocoNumeros(d) {
    const e = d.ensino;
    const freq = d.aulas.frequencia_mes;
    return `
      <div class="grid grid--cards">
        ${statNav('clientes', '🧑‍🎓 Alunos ativos', e.alunos_ativos,
          e.alunos_novos_mes > 0 ? `+${e.alunos_novos_mes} matriculado(s) neste mês` : 'nenhuma matrícula nova neste mês')}
        ${statNav('turmas', '📚 Turmas ativas', e.turmas_ativas,
          `${e.vagas_ocupadas}/${e.vagas_totais} vagas ocupadas (${e.ocupacao_pct}%)`)}
        ${statNav('chamada', '🗓️ Aulas nos próximos 7 dias', d.aulas.proximos_7_dias,
          `${d.aulas.realizadas_mes} realizada(s) neste mês`)}
        ${statNav('impacto', '✅ Frequência do mês', freq != null ? freq + '%' : '—',
          freq != null ? 'presenças sobre chamadas feitas' : 'ainda sem chamada registrada')}
        ${statNav('instrumentos', '🎸 Instrumentos', d.acervo.total,
          `${d.acervo.no_instituto} no instituto · ${d.acervo.emprestados} emprestado(s)`)}
        ${statNav('voluntarios', '🤝 Horas de voluntariado', d.pessoas.horas_voluntariado_mes + 'h',
          `${d.pessoas.voluntarios} voluntário(s) de ${d.pessoas.equipe} na equipe`)}
      </div>`;
  }

  function statNav(rota, label, valor, sub) {
    return `<div class="card stat pi-clicavel" data-ir="${rota}">
      <span class="stat__label">${label}</span>
      <span class="stat__value" style="font-size:24px">${valor}</span>
      <span class="dica">${UI.escapar(sub || '')}</span>
    </div>`;
  }

  function blocoAulasHoje(a) {
    const pendencia = a.chamadas_pendentes > 0
      ? `<div class="pi-alerta" data-ir="chamada">⚠️ ${a.chamadas_pendentes} aula(s) já passaram sem chamada registrada — sem isso o relatório de impacto sai menor do que a realidade.</div>`
      : '';
    if (!a.hoje.length) {
      return `<div class="card">
        <h3 style="margin-top:0">🗓️ Aulas de hoje</h3>
        ${pendencia}
        <p class="muted">Nenhuma aula marcada para hoje.</p>
      </div>`;
    }
    return `<div class="card">
      <h3 style="margin-top:0">🗓️ Aulas de hoje <span class="dica">(${a.hoje.length})</span></h3>
      ${pendencia}
      <div class="rolagem"><table class="tabela">
        <thead><tr><th>Horário</th><th>Turma</th><th>Instrutor</th><th>Alunos</th><th>Chamada</th></tr></thead>
        <tbody>${a.hoje.map((x) => {
          const [rot, cor] = STATUS_AULA[x.status] || [x.status, 'muted'];
          return `<tr class="pi-clicavel" data-ir="chamada">
            <td><strong>${UI.escapar(x.hora_inicio || '—')}</strong>${x.hora_fim ? `<div class="dica">até ${UI.escapar(x.hora_fim)}</div>` : ''}</td>
            <td>${UI.escapar(x.turma || '—')}<div class="dica">${UI.escapar(x.curso || '')}</div></td>
            <td>${x.instrutor ? `<div class="flex gap-12" style="align-items:center">
              <div class="pi-avatar">${x.instrutor_foto ? `<img src="/uploads/pessoas/${encodeURIComponent(x.instrutor_foto)}" alt="">` : '👤'}</div>
              <span>${UI.escapar(x.instrutor)}</span>
            </div>` : '<span class="badge badge--erro">sem instrutor</span>'}</td>
            <td>${x.alunos}</td>
            <td>${x.chamada_feita
              ? '<span class="badge badge--ok">feita</span>'
              : `<span class="badge badge--${cor}">${rot}</span>`}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
  }

  function blocoTurmas(e) {
    const avisos = [];
    if (e.turmas_sem_instrutor > 0) avisos.push(`<span class="badge badge--erro">${e.turmas_sem_instrutor} sem instrutor</span>`);
    if (e.turmas_lotadas > 0) avisos.push(`<span class="badge badge--alerta">${e.turmas_lotadas} lotada(s)</span>`);
    if (e.fila_espera > 0) avisos.push(`<span class="badge badge--muted">${e.fila_espera} na lista de espera</span>`);

    if (!e.turmas.length) {
      return `<div class="card">
        <h3 style="margin-top:0">📚 Turmas</h3>
        <p class="muted">Nenhuma turma ativa. Crie a primeira em <strong>Turmas</strong>.</p>
      </div>`;
    }
    return `<div class="card">
      <div class="flex flex--between" style="align-items:center;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">📚 Turmas e vagas</h3>
        <div class="flex gap-12" style="flex-wrap:wrap">${avisos.join(' ')}</div>
      </div>
      <div class="rolagem mt-16"><table class="tabela">
        <thead><tr><th>Turma</th><th>Ocupação</th><th style="width:140px"></th><th>Progresso do curso</th></tr></thead>
        <tbody>${e.turmas.map((t) => {
          const pct = t.vagas_total > 0 ? Math.min(100, Math.round((t.vagas_ocupadas / t.vagas_total) * 100)) : 0;
          const cor = pct >= 100 ? 'var(--perigo)' : pct >= 80 ? 'var(--alerta,#b45309)' : 'var(--sucesso)';
          const progresso = t.progresso_pct;
          const corProgresso = progresso >= 100 ? 'var(--sucesso)' : 'var(--primaria)';
          return `<tr class="pi-clicavel" data-ir="turmas">
            <td>${UI.escapar(t.nome)}<div class="dica">${UI.escapar(t.curso || '—')}${t.na_fila ? ` · ${t.na_fila} na fila` : ''}${t.instrutores ? '' : ' · <strong style="color:var(--perigo)">sem instrutor</strong>'}</div></td>
            <td style="white-space:nowrap">${t.vagas_ocupadas}/${t.vagas_total}</td>
            <td><div class="pi-barra"><span style="width:${pct}%;background:${cor}"></span></div></td>
            <td style="white-space:nowrap">${progresso == null ? '<span class="dica">—</span>'
              : `<div class="flex gap-12" style="align-items:center">
                  <div class="pi-barra" style="width:60px"><span style="width:${progresso}%;background:${corProgresso}"></span></div>
                  <span class="dica">${progresso}%</span>
                </div>`}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
  }

  function blocoAcervo(a) {
    const linhas = [
      ['No instituto (disponível para as turmas)', a.no_instituto, ''],
      ['Emprestados a alunos', a.emprestados, a.emprestimos_atrasados > 0 ? `${a.emprestimos_atrasados} com devolução atrasada` : ''],
      ['Em manutenção', a.em_manutencao, ''],
    ];
    return `<div class="card">
      <h3 style="margin-top:0">🎸 Acervo de instrumentos</h3>
      ${a.total === 0
        ? '<p class="muted">Nenhum instrumento cadastrado. O acervo é o que define quantas vagas cada turma de música pode abrir.</p>'
        : `<table class="tabela">
            ${linhas.map(([r, v, sub]) => `<tr class="pi-clicavel" data-ir="instrumentos">
              <td>${r}${sub ? `<div class="dica" style="color:var(--perigo)">${sub}</div>` : ''}</td>
              <td style="text-align:right"><strong>${v}</strong></td>
            </tr>`).join('')}
            <tr><td><strong>Total do acervo</strong></td><td style="text-align:right"><strong>${a.total}</strong></td></tr>
          </table>`}
    </div>`;
  }

  function blocoDinheiro(f) {
    const positivo = f.resultado_mes >= 0;
    return `<div class="card">
      <h3 style="margin-top:0">💰 Dinheiro do mês</h3>
      <table class="tabela">
        <tr class="pi-clicavel" data-ir="financeiro">
          <td>Ofertas recebidas<div class="dica">${f.ofertas_qtd_mes} doação(ões)</div></td>
          <td style="text-align:right;color:var(--sucesso)">+ ${UI.moeda(f.ofertas_mes)}</td>
        </tr>
        <tr class="pi-clicavel" data-ir="financeiro">
          <td>Despesas pagas</td>
          <td style="text-align:right;color:var(--perigo)">- ${UI.moeda(f.despesas_mes)}</td>
        </tr>
        <tr class="pi-clicavel" data-ir="financeiro">
          <td><strong>Resultado do mês</strong></td>
          <td style="text-align:right"><strong style="color:${positivo ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(f.resultado_mes)}</strong></td>
        </tr>
        <tr class="pi-clicavel" data-ir="financeiro">
          <td>Saldo em caixa e banco<div class="dica">somando todas as contas</div></td>
          <td style="text-align:right"><strong>${UI.moeda(f.saldo_contas)}</strong></td>
        </tr>
      </table>
      ${f.a_pagar > 0 ? `<div class="pi-alerta mt-16" data-ir="financeiro">
        ${UI.moeda(f.a_pagar)} em despesas a pagar${f.a_pagar_vencidas > 0 ? ` — <strong>${f.a_pagar_vencidas} já vencida(s)</strong>` : ''}.
      </div>` : ''}
    </div>`;
  }

  function blocoObjetivos(o) {
    return `<div class="card">
      <h3 style="margin-top:0">🎯 Objetivos</h3>
      ${!o.total_abertos
        ? '<p class="muted pi-clicavel" data-ir="tarefas">Nenhum objetivo cadastrado. Cadastre metas do instituto em Tarefas → Objetivos.</p>'
        : `<p class="dica pi-clicavel" data-ir="tarefas" style="margin-top:0">
             ${o.total_abertos} objetivo(s) em aberto ·
             <strong style="color:var(--sucesso)">${o.cabem_no_saldo} já dá(ão) pra fazer</strong> com o saldo em caixa de hoje.
           </p>
           <table class="tabela">
             ${o.itens.map((it) => `<tr class="pi-clicavel" data-ir="tarefas">
               <td>${UI.escapar(it.titulo)}</td>
               <td style="text-align:right">${it.valor != null ? UI.moeda(it.valor) : '<span class="dica">sem valor</span>'}</td>
               <td style="text-align:right;white-space:nowrap">
                 ${it.cabe_agora === true ? '<span class="badge badge--ok">dá pra fazer</span>'
                   : it.cabe_agora === false ? '<span class="badge badge--alerta">falta juntar</span>'
                   : '<span class="badge badge--muted">meta</span>'}
               </td>
             </tr>`).join('')}
           </table>`}
    </div>`;
  }

  function blocoAniversariantes(lista) {
    const mesNome = new Date().toLocaleDateString('pt-BR', { month: 'long' });
    const hojeDia = new Date().getDate();
    const mesStr = String(new Date().getMonth() + 1).padStart(2, '0');
    return `<div class="card">
      <h3 style="margin-top:0">🎂 Aniversariantes de ${mesNome}</h3>
      ${!lista.length
        ? '<p class="muted pi-clicavel" data-ir="clientes">Ninguém faz aniversário este mês (ou falta cadastrar a data de nascimento).</p>'
        : `<table class="tabela">
             ${lista.map((p) => `<tr class="pi-clicavel" data-ir="clientes">
               <td style="white-space:nowrap">${String(p.dia).padStart(2, '0')}/${mesStr}
                 ${p.dia === hojeDia ? ' <span class="badge badge--ok">hoje</span>' : ''}</td>
               <td>${UI.escapar(p.nome)}</td>
               <td class="dica" style="text-align:right">${p.fazendo} anos</td>
             </tr>`).join('')}
           </table>`}
    </div>`;
  }

  return { titulo: 'Central de Gestão', render };
})();
