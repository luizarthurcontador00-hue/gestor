'use strict';

/**
 * Secao "Frequencia" da ficha do aluno (ramo professor): cartoes, barras por
 * mes e ultimas aulas, com seletor de periodo e relatorio em PDF.
 * Dados vem de GET /api/agenda/frequencia/aluno/:id.
 */
window.FrequenciaAluno = (function () {
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const ROTULO_STATUS = {
    atendido: ['Aula dada', 'ok'], faltou: ['Faltou', 'erro'], cancelado: ['Cancelada', 'muted'],
    agendado: ['Agendada', 'alerta'], confirmado: ['Confirmada', 'alerta'],
  };

  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /** Periodo { inicio, fim } do seletor; 'personalizado' devolve null (usa os campos de data). */
  function periodo(tipo, hojeISO) {
    const [a, m] = hojeISO.split('-').map(Number);
    if (tipo === 'mes') return { inicio: iso(new Date(a, m - 1, 1)), fim: iso(new Date(a, m, 0)) };
    if (tipo === '3meses') return { inicio: iso(new Date(a, m - 3, 1)), fim: iso(new Date(a, m, 0)) };
    if (tipo === 'ano') return { inicio: `${a}-01-01`, fim: `${a}-12-31` };
    return null;
  }

  const dataBR = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

  function cartoesHTML(t) {
    const card = (rot, val, sub) => `<div class="card stat"><span class="stat__label">${rot}</span><span class="stat__value" style="font-size:22px">${val}</span><span class="dica">${sub || ''}</span></div>`;
    return `<div class="grid grid--cards mb-16">
      ${card('Aulas dadas', t.dadas, t.canceladas ? `${t.canceladas} cancelada(s)` : '')}
      ${card('Faltas', t.faltas, t.sem_registro ? `${t.sem_registro} sem registro` : '')}
      ${card('Remarcadas', t.remarcadas, `aluno ${t.remarcadas_por.aluno} · professor ${t.remarcadas_por.professor} · feriado ${t.remarcadas_por.feriado}`)}
      ${card('Frequência', t.frequencia_pct != null ? t.frequencia_pct + '%' : '—', 'dadas ÷ (dadas + faltas)')}
    </div>`;
  }

  /** Mini-barras: altura proporcional a % de frequencia de cada mes. */
  function barrasHTML(serie) {
    return `<div class="flex gap-12" style="align-items:flex-end;height:96px">${serie.map((m) => {
      const p = m.frequencia_pct;
      const cor = p == null ? 'transparent' : p >= 80 ? 'var(--sucesso)' : p >= 70 ? 'var(--alerta)' : 'var(--perigo)';
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%" title="${m.dadas} dada(s), ${m.faltas} falta(s)">
        <span class="dica">${p != null ? p + '%' : '—'}</span>
        <div style="width:70%;height:${p != null ? Math.max(p * 0.6, 2) : 0}px;background:${cor};border-radius:3px 3px 0 0"></div>
      </div>`;
    }).join('')}</div>
    <div class="flex gap-12">${serie.map((m) => `<span class="dica" style="flex:1;text-align:center">${MES[Number(m.mes.slice(5, 7)) - 1]}</span>`).join('')}</div>`;
  }

  function tabelaHTML(aulas, hojeISO) {
    if (!aulas.length) return '<p class="muted">Nenhuma aula no período.</p>';
    return `<table class="tabela"><thead><tr><th>Data</th><th>Horário</th><th>Matéria</th><th>Situação</th></tr></thead>
      <tbody>${aulas.map((a) => {
        const semRegistro = a.data < hojeISO && (a.status === 'agendado' || a.status === 'confirmado');
        const [rot, cor] = semRegistro ? ['Sem registro', 'alerta'] : (ROTULO_STATUS[a.status] || [a.status, 'muted']);
        return `<tr><td>${dataBR(a.data)}</td><td>${UI.escapar(a.hora_inicio)}</td><td>${UI.escapar(a.materia || '—')}</td>
          <td><span class="badge badge--${cor}">${UI.escapar(rot)}</span>${a.remarcada ? ' <span class="dica">↻ remarcada</span>' : ''}</td></tr>`;
      }).join('')}</tbody></table>`;
  }

  function montar(alvo, aluno) {
    const hojeISO = iso(new Date());
    alvo.innerHTML = `
      <div class="flex gap-12 mb-16" style="align-items:flex-end;flex-wrap:wrap">
        <div class="campo"><label>Período</label><select id="fq-tipo">
          <option value="mes">Mês atual</option><option value="3meses">Últimos 3 meses</option>
          <option value="ano">Ano</option><option value="personalizado">Personalizado</option>
        </select></div>
        <div class="campo" id="fq-custom" style="display:none"><label>De / até</label>
          <span class="flex gap-12"><input id="fq-de" type="date" /><input id="fq-ate" type="date" /></span></div>
        <div class="cresce"></div>
        <button type="button" class="btn btn--secundario" id="fq-pdf" disabled>🖨️ Imprimir / PDF relatório do aluno</button>
      </div>
      <div id="fq-corpo">Carregando…</div>`;

    let dados = null;
    const corpo = alvo.querySelector('#fq-corpo');
    const tipo = alvo.querySelector('#fq-tipo');
    const botaoPdf = alvo.querySelector('#fq-pdf');

    async function carregar() {
      let p = periodo(tipo.value, hojeISO);
      alvo.querySelector('#fq-custom').style.display = p ? 'none' : '';
      if (!p) {
        p = { inicio: alvo.querySelector('#fq-de').value, fim: alvo.querySelector('#fq-ate').value };
        if (!p.inicio || !p.fim) { corpo.innerHTML = '<p class="dica">Escolha as duas datas.</p>'; return; }
      }
      corpo.textContent = 'Carregando…';
      try {
        dados = await API.get(`/api/agenda/frequencia/aluno/${aluno.id}?inicio=${p.inicio}&fim=${p.fim}`);
      } catch (e) { dados = null; botaoPdf.disabled = true; corpo.innerHTML = `<span class="dica">${UI.escapar(e.message)}</span>`; return; }
      botaoPdf.disabled = false;
      corpo.innerHTML = `${cartoesHTML(dados.totais)}
        <strong>Frequência nos últimos 6 meses</strong><div class="mt-16 mb-16">${barrasHTML(dados.serie_mensal)}</div>
        <strong>Aulas do período</strong>${dados.ultimas_aulas.length >= 20 ? ' <span class="dica">(20 mais recentes)</span>' : ''}
        <div class="mt-16">${tabelaHTML(dados.ultimas_aulas, hojeISO)}</div>`;
    }

    tipo.addEventListener('change', carregar);
    alvo.querySelector('#fq-de').addEventListener('change', carregar);
    alvo.querySelector('#fq-ate').addEventListener('change', carregar);
    botaoPdf.addEventListener('click', () => { if (dados) Documentos.relatorioFrequenciaAluno(dados); });
    return carregar();
  }

  return { montar, periodo, cartoesHTML, barrasHTML, tabelaHTML };
})();
