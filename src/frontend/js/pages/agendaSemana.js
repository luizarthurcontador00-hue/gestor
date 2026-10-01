'use strict';

/**
 * Grade semanal de aulas (ramo professor): colunas = dias, linhas = horas.
 * Usada na Agenda (vista "Semana") e na Central de Gestão (versão compacta).
 * Também guarda a tela "Remarcar", compartilhada pelo detalhe da aula e pelo
 * arrastar-e-soltar da grade.
 *
 * AgendaSemana.render(container, { compacto, profissionalId, aoAbrirAula, aoNovaAula, aoMudar })
 * AgendaSemana.remarcar(aula, { data, hora, aoConcluir })
 */
window.AgendaSemana = (function () {
  const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const PALETA = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#ea580c'];
  const COR_SEM_MATERIA = '#64748b';
  const FAIXA_PADRAO = { de: 8, ate: 18 };

  // A semana navegada fica guardada entre telas: voltar à Agenda não pula pra hoje.
  let ancora = hojeISO();

  // ------------------------- Funções puras (sem DOM) -------------------------
  function pad2(n) { return String(n).padStart(2, '0'); }
  function isoLocal(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function hojeISO() { return isoLocal(new Date()); }
  function paraData(iso) { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); }
  function somarDias(iso, n) { const d = paraData(iso); d.setDate(d.getDate() + n); return isoLocal(d); }
  /** Segunda-feira da semana que contém a data. */
  function inicioDaSemana(iso) { return somarDias(iso, -((paraData(iso).getDay() + 6) % 7)); }
  function minutos(hora) { const [h, m] = String(hora).split(':').map(Number); return h * 60 + (m || 0); }
  function dataBR(iso) { return paraData(iso).toLocaleDateString('pt-BR'); }
  function diaCurto(iso) { return `${DIAS_CURTOS[paraData(iso).getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`; }

  /** Cor estável por nome de matéria: mesmo nome, mesma cor, sempre. */
  function corMateria(nome) {
    const n = String(nome || '').trim().toLowerCase();
    if (!n) return COR_SEM_MATERIA;
    let h = 2166136261; // FNV-1a: espalha melhor que soma simples em nomes curtos
    for (let i = 0; i < n.length; i++) h = Math.imul(h ^ n.charCodeAt(i), 16777619) >>> 0;
    return PALETA[(h >>> 8) % PALETA.length];
  }

  const fimDe = (a) => {
    const ini = minutos(a.hora_inicio);
    const fim = a.hora_fim ? minutos(a.hora_fim) : ini + 60;
    return fim > ini ? fim : ini + 60;
  };

  /**
   * Monta a grade da semana a partir das aulas já carregadas.
   * Aula cancelada não aparece. "Fantasma" = o horário de onde uma aula foi remarcada.
   */
  function calcularGrade(itens, inicio, hoje) {
    const fim = somarDias(inicio, 6);
    const doDia = (iso) => iso >= inicio && iso <= fim;
    const aulas = itens.filter((a) => a.status !== 'cancelado' && doDia(a.data));
    const fantasmas = itens.filter((a) => a.status !== 'cancelado' && a.remarcado_de_data && doDia(a.remarcado_de_data)
      && !(a.remarcado_de_data === a.data && a.remarcado_de_hora === a.hora_inicio));

    const dias = [];
    for (let i = 0; i < 6; i++) dias.push(somarDias(inicio, i));
    const domingo = somarDias(inicio, 6);
    if (aulas.some((a) => a.data === domingo) || fantasmas.some((a) => a.remarcado_de_data === domingo)) dias.push(domingo);

    const horasUsadas = [];
    aulas.forEach((a) => { horasUsadas.push(Math.floor(minutos(a.hora_inicio) / 60), Math.floor((fimDe(a) - 1) / 60)); });
    fantasmas.forEach((a) => { horasUsadas.push(Math.floor(minutos(a.remarcado_de_hora) / 60)); });
    const faixa = horasUsadas.length
      ? { de: Math.max(0, Math.min(...horasUsadas) - 1), ate: Math.min(23, Math.max(...horasUsadas) + 1) }
      : { ...FAIXA_PADRAO };

    const horas = [];
    for (let h = faixa.de; h <= faixa.ate; h++) horas.push(h);

    const celulas = new Map();
    const chave = (iso, h) => `${iso}|${h}`;
    dias.forEach((iso) => horas.forEach((h) => celulas.set(chave(iso, h), { aulas: [], fantasmas: [], ocupada: false })));
    aulas.slice().sort((x, y) => x.hora_inicio.localeCompare(y.hora_inicio)).forEach((a) => {
      const ini = minutos(a.hora_inicio);
      const c = celulas.get(chave(a.data, Math.floor(ini / 60)));
      if (c) c.aulas.push(a);
      for (let h = Math.floor(ini / 60); h <= Math.floor((fimDe(a) - 1) / 60); h++) {
        const o = celulas.get(chave(a.data, h));
        if (o) o.ocupada = true;
      }
    });
    fantasmas.forEach((a) => {
      const c = celulas.get(chave(a.remarcado_de_data, Math.floor(minutos(a.remarcado_de_hora) / 60)));
      if (c) c.fantasmas.push(a);
    });

    let livres = 0;
    celulas.forEach((c) => { if (!c.ocupada) livres++; });
    const metricas = {
      aulasSemana: aulas.length,
      aulasHoje: aulas.filter((a) => a.data === hoje).length,
      remarcadas: aulas.filter((a) => a.remarcado_de_data).length,
      livres,
    };
    return { dias, horas, celulas, chave, metricas, fim };
  }

  /** Há outra aula (do mesmo profissional) sobrepondo o intervalo? Devolve a aula em conflito. */
  function acharConflito(itens, { id, profissional_id, hora_inicio, hora_fim }) {
    const ini = minutos(hora_inicio);
    const fim = hora_fim ? minutos(hora_fim) : ini + 60;
    return itens.find((o) => o.id !== id && o.status !== 'cancelado' && !o.suspensa
      && (o.profissional_id || null) === (profissional_id || null)
      && minutos(o.hora_inicio) < fim && fimDe(o) > ini) || null;
  }

  // ----------------------------- Helpers de tela -----------------------------
  const nomeAluno = (a) => a.cliente_cadastro || a.cliente_nome || 'Aluno';
  const materiaDe = (a) => a.servico_nome || '';
  const remarcavel = (a) => !a.venda_id && a.status !== 'atendido' && a.status !== 'cancelado';

  function abrirExterno(url) {
    try {
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (_) { window.open(url, '_blank'); }
  }

  function abrirWhatsApp(telefone, mensagem) {
    const num = String(telefone || '').replace(/\D/g, '');
    if (!num) return;
    const completo = num.length <= 11 ? '55' + num : num; // DDI Brasil quando não informado
    abrirExterno(`https://wa.me/${completo}?text=${encodeURIComponent(mensagem)}`);
  }

  function rotuloSemana(inicio) {
    const fim = somarDias(inicio, 6);
    return `${inicio.slice(8, 10)}/${inicio.slice(5, 7)} a ${dataBR(fim)}`;
  }

  // ------------------------------- Grade -------------------------------
  function render(container, opcoes = {}) {
    const { compacto = false, profissionalId = '', aoAbrirAula = null, aoNovaAula = null, aoMudar = null } = opcoes;
    let itens = [];
    let arrastando = null;

    container.innerHTML = `
      <div class="sem ${compacto ? 'sem--compacto' : ''}">
        <div class="sem-topo">
          <div class="flex gap-12" style="align-items:center">
            <button class="btn btn--secundario" data-sem-nav="-1" title="Semana anterior">◀</button>
            <strong class="sem-titulo" id="sem-titulo"></strong>
            <button class="btn btn--secundario" data-sem-nav="1" title="Próxima semana">▶</button>
            <button class="btn btn--secundario" data-sem-nav="hoje">Hoje</button>
          </div>
          <div class="sem-legenda" id="sem-legenda"></div>
        </div>
        <div class="sem-metricas" id="sem-metricas"></div>
        <div id="sem-corpo"><div class="dica">Carregando…</div></div>
      </div>`;

    container.querySelectorAll('[data-sem-nav]').forEach((b) => b.addEventListener('click', () => {
      const v = b.dataset.semNav;
      ancora = v === 'hoje' ? hojeISO() : somarDias(ancora, Number(v) * 7);
      carregar();
    }));

    async function carregar() {
      const inicio = inicioDaSemana(ancora);
      const params = new URLSearchParams({ inicio, fim: somarDias(inicio, 6), com_origem: '1' });
      if (profissionalId) params.set('profissional_id', profissionalId);
      try { itens = await API.get('/api/agenda?' + params.toString()); }
      catch (e) {
        const corpo = container.querySelector('#sem-corpo');
        if (corpo) corpo.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}</div>`;
        return;
      }
      desenhar(inicio);
    }

    function desenhar(inicio) {
      const corpo = container.querySelector('#sem-corpo');
      if (!corpo) return; // a tela mudou enquanto carregava
      const g = calcularGrade(itens, inicio, hojeISO());
      container.querySelector('#sem-titulo').textContent = rotuloSemana(inicio);

      const m = g.metricas;
      container.querySelector('#sem-metricas').innerHTML = [
        ['Aulas na semana', m.aulasSemana], ['Aulas hoje', m.aulasHoje], ['Remarcadas', m.remarcadas], ['Horários livres', m.livres],
      ].map(([r, v]) => `<div class="sem-metrica"><span class="sem-metrica__valor">${v}</span><span class="sem-metrica__rotulo">${r}</span></div>`).join('');

      const materias = [...new Set(itens.filter((a) => a.status !== 'cancelado' && materiaDe(a)).map(materiaDe))].sort();
      container.querySelector('#sem-legenda').innerHTML = materias
        .map((n) => `<span class="sem-legenda__item"><span class="sem-legenda__ponto" style="background:${corMateria(n)}"></span>${UI.escapar(n)}</span>`).join('');

      const hoje = hojeISO();
      const podeCriar = !!aoNovaAula || compacto;
      const cab = g.dias.map((iso) => `<div class="sem-cab ${iso === hoje ? 'sem-cab--hoje' : ''}">${DIAS_CURTOS[paraData(iso).getDay()]}<strong>${Number(iso.slice(8, 10))}</strong></div>`).join('');
      const linhas = g.horas.map((h) => `<div class="sem-hora">${pad2(h)}h</div>${g.dias.map((iso) => {
        const c = g.celulas.get(g.chave(iso, h));
        const livre = !c.ocupada && !c.aulas.length;
        return `<div class="sem-cel ${livre ? 'sem-cel--livre' : ''} ${livre && !podeCriar ? 'sem-cel--inerte' : ''} ${iso === hoje ? 'sem-cel--hoje' : ''}" data-dia="${iso}" data-hora="${h}">
          ${c.fantasmas.map((a) => `<div class="sem-fantasma" title="${UI.escapar(nomeAluno(a))} foi remarcada para ${dataBR(a.data)} às ${UI.escapar(a.hora_inicio)}">${UI.escapar(nomeAluno(a))} · foi p/ ${UI.escapar(diaCurto(a.data))}</div>`).join('')}
          ${c.aulas.map(blocoAula).join('')}
          ${livre && !c.fantasmas.length ? '<span class="sem-livre">livre</span>' : ''}
        </div>`;
      }).join('')}`).join('');

      corpo.innerHTML = `<div class="sem-grade" style="grid-template-columns:44px repeat(${g.dias.length}, minmax(0, 1fr))">
        <div></div>${cab}${linhas}</div>`;
      ligarEventos(corpo);
    }

    function blocoAula(a) {
      const pend = a.status === 'agendado' || a.status === 'confirmado';
      const marca = a.status === 'atendido' ? ' ✓' : a.status === 'faltou' ? ' · faltou' : '';
      return `<div class="sem-aula ${a.status === 'atendido' ? 'sem-aula--feita' : ''} ${a.status === 'faltou' ? 'sem-aula--faltou' : ''}" draggable="${pend && !a.venda_id}"
        data-aula="${a.id}" style="--cor:${corMateria(materiaDe(a))}" title="${UI.escapar(nomeAluno(a))}${materiaDe(a) ? ' — ' + UI.escapar(materiaDe(a)) : ''}">
        <span class="sem-aula__hora">${UI.escapar(a.hora_inicio)}${a.hora_fim ? '–' + UI.escapar(a.hora_fim) : ''}${marca}</span>
        <strong>${UI.escapar(nomeAluno(a))}</strong>
        <span class="sem-aula__materia">${UI.escapar(materiaDe(a))}</span>
        ${a.remarcado_de_data ? '<span class="sem-aula__tag">↻ remarcada</span>' : ''}
      </div>`;
    }

    function ligarEventos(corpo) {
      const achar = (el) => itens.find((a) => a.id === Number(el.dataset.aula));
      corpo.querySelectorAll('[data-aula]').forEach((el) => {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const a = achar(el);
          if (!a) return;
          if (aoAbrirAula) aoAbrirAula(a); else location.hash = '#/agenda';
        });
        el.addEventListener('dragstart', (ev) => {
          arrastando = achar(el);
          ev.dataTransfer.effectAllowed = 'move';
          ev.dataTransfer.setData('text/plain', String(el.dataset.aula));
          el.classList.add('sem-aula--arrastando');
        });
        el.addEventListener('dragend', () => {
          arrastando = null;
          el.classList.remove('sem-aula--arrastando');
          corpo.querySelectorAll('.sem-cel--alvo').forEach((c) => c.classList.remove('sem-cel--alvo'));
        });
      });
      corpo.querySelectorAll('.sem-cel').forEach((cel) => {
        cel.addEventListener('dragover', (ev) => { if (arrastando) { ev.preventDefault(); cel.classList.add('sem-cel--alvo'); } });
        cel.addEventListener('dragleave', () => cel.classList.remove('sem-cel--alvo'));
        cel.addEventListener('drop', (ev) => {
          ev.preventDefault();
          cel.classList.remove('sem-cel--alvo');
          const a = arrastando;
          arrastando = null;
          if (!a) return;
          const hora = `${pad2(Number(cel.dataset.hora))}:${String(a.hora_inicio).slice(3, 5) || '00'}`;
          if (cel.dataset.dia === a.data && hora === a.hora_inicio) return;
          remarcar(a, { data: cel.dataset.dia, hora, aoConcluir: depoisDeRemarcar });
        });
        cel.addEventListener('click', () => {
          if (!cel.classList.contains('sem-cel--livre')) return;
          if (aoNovaAula) aoNovaAula(cel.dataset.dia, `${pad2(Number(cel.dataset.hora))}:00`);
          else if (compacto) location.hash = '#/agenda';
        });
      });
    }

    async function depoisDeRemarcar() {
      await carregar();
      if (aoMudar) aoMudar();
    }

    return carregar();
  }

  // ------------------------------- Remarcar -------------------------------
  function remarcar(aula, { data, hora, aoConcluir } = {}) {
    if (!remarcavel(aula)) { UI.erro('Esta aula não pode mais ser remarcada.'); return; }
    const nome = nomeAluno(aula);
    const materia = materiaDe(aula);
    const tel = aula.cliente_telefone || aula.telefone;
    const veioDeFixa = !!aula.aula_recorrente_id;
    const duracao = aula.hora_fim ? Math.max(0, minutos(aula.hora_fim) - minutos(aula.hora_inicio)) : 0;
    let por = 'aluno';
    let escopo = 'esta';

    Modal.abrir({
      titulo: 'Remarcar aula', tamanho: 'modal--pequeno',
      corpoHTML: `
        <p class="dica" style="margin-top:0"><strong>${UI.escapar(nome)}</strong>${materia ? ' · ' + UI.escapar(materia) : ''}<br>
          Agora: ${UI.escapar(diaCurto(aula.data))} às ${UI.escapar(aula.hora_inicio)}</p>
        <div class="form-grid">
          <div class="campo"><label>Nova data *</label><input id="rm-data" type="date" value="${UI.escapar(data || aula.data)}" /></div>
          <div class="campo"><label>Novo horário *</label><input id="rm-hora" type="time" value="${UI.escapar(hora || aula.hora_inicio)}" /></div>
        </div>
        <div class="dica mt-16" id="rm-situacao"></div>
        <div class="campo mt-16"><label>Quem desmarcou</label>
          <div class="sem-opcoes" id="rm-por">
            <button type="button" class="btn btn--secundario sem-opcao--ativa" data-v="aluno">Aluno</button>
            <button type="button" class="btn btn--secundario" data-v="professor">Professor</button>
            <button type="button" class="btn btn--secundario" data-v="feriado">Feriado</button>
          </div></div>
        ${veioDeFixa ? `<div class="campo mt-16"><label>Vale para</label>
          <div class="sem-opcoes" id="rm-escopo">
            <button type="button" class="btn btn--secundario sem-opcao--ativa" data-v="esta">Só esta aula</button>
            <button type="button" class="btn btn--secundario" data-v="proximas">Esta e as próximas</button>
          </div></div>` : ''}
        <label class="flex gap-12 mt-16" style="align-items:center;cursor:pointer">
          <input type="checkbox" id="rm-zap" ${tel ? '' : 'disabled'} />
          <span>Avisar ${UI.escapar(nome)} por WhatsApp${tel ? '' : ' <span class="dica">(sem telefone cadastrado)</span>'}</span>
        </label>`,
      textoConfirmar: 'Remarcar',
      aoAbrir: (el) => {
        const escolha = (id, aoMudar) => {
          const grupo = el.querySelector(id);
          if (!grupo) return;
          grupo.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
            grupo.querySelectorAll('button').forEach((x) => x.classList.toggle('sem-opcao--ativa', x === b));
            aoMudar(b.dataset.v);
          }));
        };
        escolha('#rm-por', (v) => { por = v; });
        escolha('#rm-escopo', (v) => { escopo = v; });

        const situacao = el.querySelector('#rm-situacao');
        let seq = 0;
        async function conferir() {
          const d = el.querySelector('#rm-data').value;
          const h = el.querySelector('#rm-hora').value;
          if (!d || !h) { situacao.textContent = ''; return; }
          const minha = ++seq;
          let doDia = [];
          try { doDia = await API.get('/api/agenda?data=' + d); } catch (_) { situacao.textContent = ''; return; }
          if (minha !== seq) return; // chegou resposta mais nova
          const fim = duracao ? `${pad2(Math.floor((minutos(h) + duracao) / 60) % 24)}:${pad2((minutos(h) + duracao) % 60)}` : null;
          const outra = acharConflito(doDia, { id: aula.id, profissional_id: aula.profissional_id, hora_inicio: h, hora_fim: fim });
          situacao.innerHTML = outra
            ? `<span class="badge badge--alerta">Já existe aula neste horário</span> ${UI.escapar(nomeAluno(outra))} às ${UI.escapar(outra.hora_inicio)}`
            : '<span class="badge badge--ok">Horário livre</span>';
        }
        el.querySelector('#rm-data').addEventListener('change', conferir);
        el.querySelector('#rm-hora').addEventListener('change', conferir);
        conferir();
      },
      aoConfirmar: async (el) => {
        const novaData = el.querySelector('#rm-data').value;
        const novaHora = el.querySelector('#rm-hora').value;
        if (!novaData || !novaHora) { UI.erro('Informe a nova data e o novo horário.'); return false; }
        let r;
        try { r = await API.post(`/api/agenda/${aula.id}/remarcar`, { data: novaData, hora_inicio: novaHora, por, escopo }); }
        catch (e) { UI.erro(e.message); return false; }
        if (r.conflito) UI.alerta('Aula remarcada, mas já havia outra aula neste horário.');
        else UI.sucesso(r.escopo_aplicado === 'proximas' ? 'Aula remarcada — as próximas também mudaram.' : 'Aula remarcada.');
        const zap = el.querySelector('#rm-zap');
        if (zap && zap.checked && tel) {
          const de = `${dataBR(aula.data)} às ${aula.hora_inicio}`;
          const para = `${dataBR(r.data)} às ${r.hora_inicio}`;
          abrirWhatsApp(tel, `Olá, ${nome}! Sua aula${materia ? ' de ' + materia : ''} foi remarcada de ${de} para ${para}.`);
        }
        if (aoConcluir) await aoConcluir(r);
      },
    });
  }

  return {
    render, remarcar, remarcavel, irPara: (iso) => { ancora = iso; },
    _t: { isoLocal, somarDias, inicioDaSemana, corMateria, calcularGrade, acharConflito },
  };
})();
