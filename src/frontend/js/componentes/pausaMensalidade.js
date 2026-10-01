'use strict';

/**
 * Pausa da mensalidade com periodo (ramo professor). Usado pela ficha do aluno
 * e por Financeiro > Mensalidades.
 *
 * PausaMensalidade.abrir({ assinatura, aoConcluir })  — modal de pausa
 * PausaMensalidade.retomar(assinatura, aoConcluir)    — retoma e oferece reativar horarios fixos
 * PausaMensalidade.seloHTML(assinatura, hojeISO)      — "Pausada de dd/mm a dd/mm" ou ''
 */
window.PausaMensalidade = (function () {
  const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

  function hojeLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Pausa em curso ou ainda por comecar (periodo nao terminou). */
  function emPausa(a, hojeISO) {
    return !!(a && a.pausada_de && (!a.pausada_ate || a.pausada_ate >= (hojeISO || hojeLocal())));
  }

  function rotulo(a, hojeISO) {
    const inicio = a.pausada_de > (hojeISO || hojeLocal()) ? 'Pausa agendada de ' : 'Pausada de ';
    return `${inicio}${dm(a.pausada_de)} ${a.pausada_ate ? 'a ' + dm(a.pausada_ate) : 'até retomar'}`;
  }

  function seloHTML(a, hojeISO) {
    return emPausa(a, hojeISO) ? `<span class="badge badge--alerta">${UI.escapar(rotulo(a, hojeISO))}</span>` : '';
  }

  function abrir({ assinatura, aoConcluir }) {
    Modal.abrir({
      titulo: 'Pausar mensalidade', tamanho: 'modal--pequeno',
      corpoHTML: `
        <p class="dica" style="margin-top:0">A cobrança é pulada nos meses em que o dia de vencimento (dia ${assinatura.dia_vencimento}) cair dentro da pausa. Depois do período, volta sozinha.</p>
        <div class="form-grid">
          <div class="campo"><label>Pausar a partir de *</label><input id="pz-de" type="date" value="${hojeLocal()}" /></div>
          <div class="campo"><label>Até <span class="dica">(opcional)</span></label><input id="pz-ate" type="date" /></div>
        </div>
        <span class="dica">Sem data final, a mensalidade fica pausada até você retomar.</span>
        <label class="flex gap-12 mt-16" style="align-items:center;cursor:pointer">
          <input type="checkbox" id="pz-aulas" />
          <span>Pausar também os horários fixos e cancelar as aulas desse período</span>
        </label>`,
      textoConfirmar: 'Pausar',
      aoConfirmar: async (el) => {
        const de = el.querySelector('#pz-de').value;
        const ate = el.querySelector('#pz-ate').value || null;
        if (!de) { UI.erro('Informe a data de início da pausa.'); return false; }
        if (ate && ate < de) { UI.erro('A data final não pode ser anterior ao início.'); return false; }
        try {
          const r = await API.post(`/api/financeiro/assinaturas/${assinatura.id}/pausar`, { de, ate, pausar_aulas: el.querySelector('#pz-aulas').checked });
          UI.sucesso(r.aulas_pausadas
            ? `Mensalidade pausada. ${r.aulas_pausadas} horário(s) fixo(s) pausado(s) e ${r.aulas_canceladas} aula(s) cancelada(s).`
            : 'Mensalidade pausada.');
          if (r.cobranca_pendente_no_periodo) {
            UI.alerta('Já existe uma cobrança pendente dentro do período da pausa. Ela continua em "A receber" — cancele lá se não quiser cobrar.');
          }
          if (aoConcluir) await aoConcluir(r);
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function retomar(assinatura, aoConcluir) {
    try {
      const r = await API.post(`/api/financeiro/assinaturas/${assinatura.id}/retomar`, {});
      UI.sucesso('Mensalidade retomada.');
      if (r.aulas_pausadas > 0) {
        const ok = await UI.confirmar(
          `${r.aulas_pausadas} horário(s) fixo(s) deste aluno continuam pausados. Reativar agora?`,
          { titulo: 'Reativar horários fixos', textoConfirmar: 'Reativar horários fixos', perigo: false }
        );
        if (ok) await reativarHorarios(assinatura.cliente_id);
      }
      if (aoConcluir) await aoConcluir(r);
    } catch (e) { UI.erro(e.message); }
  }

  async function reativarHorarios(alunoId) {
    const hoje = hojeLocal();
    const horarios = await API.get('/api/agenda/aulas-recorrentes?aluno_id=' + alunoId);
    const pausados = horarios.filter((h) => !h.ativa && (!h.data_fim || h.data_fim >= hoje));
    for (const h of pausados) await API.put(`/api/agenda/aulas-recorrentes/${h.id}`, { ativa: true });
    UI.sucesso(`${pausados.length} horário(s) fixo(s) reativado(s).`);
  }

  return { abrir, retomar, emPausa, rotulo, seloHTML };
})();
