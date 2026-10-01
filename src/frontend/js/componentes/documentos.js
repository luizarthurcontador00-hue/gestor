'use strict';

/**
 * Documentos em PDF do instituto: ficha do aluno, folha de chamada para
 * preencher a mao, declaracao de matricula, declaracao de voluntariado e
 * certificado de conclusao.
 *
 * Ficam juntos porque compartilham o mesmo cabecalho (dados do instituto) e
 * a mesma assinatura (o membro marcado para assinar documentos) — e porque
 * quem mexe num costuma mexer nos outros.
 */
window.Documentos = (function () {
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  const esc = (v) => UI.escapar(v == null ? '' : String(v));

  const ROTULO_MATRICULA = {
    ativa: 'Ativa', espera: 'Fila de espera', trancada: 'Trancada',
    concluida: 'Concluída', desistente: 'Desistente',
  };

  /** "31 de julho de 2026" — como se escreve num documento, não "2026-07-31". */
  function porExtenso(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '—';
    const [a, m, d] = iso.split('-').map(Number);
    return `${d} de ${MESES[m - 1]} de ${a}`;
  }

  function dataBR(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '—';
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
  }

  async function contexto() {
    const [cfg, assinante] = await Promise.all([
      API.get('/api/config').catch(() => ({})),
      API.get('/api/membros/assinante').catch(() => null),
    ]);
    return { cfg: cfg || {}, assinante };
  }

  const ESTILO_BASE = `
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color:#111; padding:32px; }
    .cabecalho { display:flex; align-items:center; gap:14px; border-bottom:2px solid #333; padding-bottom:10px; margin-bottom:18px; }
    .cabecalho img { max-height:54px; max-width:120px; object-fit:contain; }
    .cabecalho h1 { font-size:17px; margin:0; }
    .cabecalho .sub { font-size:11px; color:#555; margin-top:2px; }
    h2 { font-size:15px; margin:20px 0 6px; }
    table { width:100%; border-collapse:collapse; font-size:12px; margin-top:6px; }
    th, td { border:1px solid #bbb; padding:5px 7px; text-align:left; vertical-align:top; }
    th { background:#eef2f7; font-weight:bold; }
    .dica { color:#666; font-size:11px; }
    .rodape { margin-top:26px; font-size:10px; color:#777; text-align:right; }
    .assinatura { margin-top:60px; border-top:1px solid #333; width:300px; text-align:center; padding-top:6px; font-size:12px; margin-left:auto; margin-right:auto; }
  `;

  function cabecalho(cfg, titulo, subtitulo) {
    const dados = [cfg.loja_cnpj ? 'CNPJ: ' + esc(cfg.loja_cnpj) : '', cfg.loja_endereco ? esc(cfg.loja_endereco) : '',
      cfg.loja_telefone ? 'Tel.: ' + esc(cfg.loja_telefone) : ''].filter(Boolean).join(' · ');
    return `
      <div class="cabecalho">
        ${cfg.loja_logo ? `<img src="${cfg.loja_logo}" alt="">` : ''}
        <div>
          <h1>${esc(cfg.nome_loja || 'Instituto')}</h1>
          ${dados ? `<div class="sub">${dados}</div>` : ''}
        </div>
      </div>
      <h2 style="margin-top:0">${titulo}</h2>
      ${subtitulo ? `<p class="dica" style="margin-top:0">${subtitulo}</p>` : ''}`;
  }

  function pagina(titulo, cfg, corpo, extraCss = '') {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title>
      <style>${ESTILO_BASE}${extraCss}</style></head><body>${corpo}</body></html>`;
  }

  // ======================= Modelos editáveis =======================
  // O texto dos documentos fica em Configurações → Documentos. Aqui só
  // preenchemos os marcadores e transformamos em HTML imprimível.

  async function modelo(chave) {
    return API.get(`/api/instituto/modelos/${chave}`);
  }

  /** Linha de assinatura pronta, com nome e cargo embaixo. */
  function linhaAssinatura(nome, cargo) {
    return `<div class="assinatura">${esc(nome || '—')}`
      + `${cargo ? `<br><span style="font-size:11px;color:#555">${esc(cargo)}</span>` : ''}</div>`;
  }

  /**
   * Converte o texto do modelo em HTML: linha em branco separa parágrafo,
   * **texto** vira negrito. O conteúdo dos marcadores é escapado; o resto é
   * o texto que o próprio instituto escreveu.
   */
  function textoParaHTML(texto) {
    const blocos = String(texto || '').replace(/\r/g, '').split(/\n{2,}/);
    return blocos.map((bloco) => {
      const t = bloco.trim();
      if (!t) return '';
      // Blocos especiais montados pelo sistema (assinatura, destaque) já vêm
      // como HTML e não devem virar parágrafo comum.
      if (/^<(div|center|destaque|h\d|table)/i.test(t)) {
        return t.replace(/<destaque>(.*?)<\/destaque>/gis, '<p class="destaque">$1</p>')
          .replace(/<center>(.*?)<\/center>/gis, '<p class="centro">$1</p>');
      }
      const comMarcacao = t
        .replace(/<destaque>(.*?)<\/destaque>/gis, '</p><p class="destaque">$1</p><p>')
        .replace(/<center>(.*?)<\/center>/gis, '</p><p class="centro">$1</p><p>')
        .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
      return `<p>${comMarcacao}</p>`;
    }).join('\n').replace(/<p>\s*<\/p>/g, '');
  }

  function preencher(corpo, dados) {
    return String(corpo || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, chave) => {
      const v = dados[chave.toLowerCase()];
      return v == null || v === '' ? '—' : String(v);
    });
  }

  /** Dados que todo documento tem: o instituto, a data e quem assina. */
  function dadosComuns(ctx) {
    const hoje = new Date().toISOString().slice(0, 10);
    return {
      instituto_nome: esc(ctx.cfg.nome_loja || 'Instituto'),
      instituto_cnpj: esc(ctx.cfg.loja_cnpj || ''),
      instituto_endereco: esc(ctx.cfg.loja_endereco || ''),
      instituto_telefone: esc(ctx.cfg.loja_telefone || ''),
      instituto_cidade: esc(ctx.cfg.loja_cidade || ''),
      data_extenso: porExtenso(hoje),
      data: dataBR(hoje),
      assinante_nome: esc(ctx.assinante ? ctx.assinante.nome : (ctx.cfg.nome_loja || '')),
      assinante_cargo: esc(ctx.assinante ? ctx.assinante.cargo : ''),
      assinatura_instituto: linhaAssinatura(
        ctx.assinante ? ctx.assinante.nome : (ctx.cfg.nome_loja || 'Responsável pela instituição'),
        ctx.assinante ? ctx.assinante.cargo : ''
      ),
    };
  }

  /** Monta o PDF de um modelo já preenchido. */
  function corpoModelo(m, ctx, dados) {
    return `
      ${cabecalho(ctx.cfg, '')}
      <h2 class="titulo-doc">${esc(m.titulo_documento)}</h2>
      ${textoParaHTML(preencher(m.corpo, { ...dadosComuns(ctx), ...dados }))}`;
  }

  async function emitirModelo(chave, dados, arquivo, extraCss = '') {
    let m; let ctx;
    try { [m, ctx] = await Promise.all([modelo(chave), contexto()]); }
    catch (e) { UI.erro(e.message); return; }

    try { await UI.baixarPDF(pagina(m.titulo, ctx.cfg, corpoModelo(m, ctx, dados), ESTILO_DECLARACAO + extraCss), arquivo); }
    catch (e) { UI.erro(e.message); }
  }

  /**
   * Mesma coisa que emitirModelo, mas pra varias pessoas de uma vez — um PDF
   * só, uma pagina por pessoa (quebra-pagina entre elas). E o que faz
   * "imprimir documentos em lote" funcionar pra qualquer modelo (declaracao,
   * certificado, ficha), sem duplicar a logica de busca/preenchimento.
   */
  async function emitirModeloLote(chave, listaDados, arquivo, extraCss = '') {
    if (!listaDados.length) { UI.erro('Não há ninguém para gerar o documento.'); return; }
    let m; let ctx;
    try { [m, ctx] = await Promise.all([modelo(chave), contexto()]); }
    catch (e) { UI.erro(e.message); return; }

    const corpo = listaDados.map((dados, i) => `${i > 0 ? '<div class="quebra-pagina"></div>' : ''}${corpoModelo(m, ctx, dados)}`).join('\n');
    try { await UI.baixarPDF(pagina(m.titulo, ctx.cfg, corpo, ESTILO_DECLARACAO + '.quebra-pagina { page-break-before: always; }' + extraCss), arquivo); }
    catch (e) { UI.erro(e.message); }
  }

  function nomeArquivo(prefixo, nome) {
    const limpo = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    return `${prefixo}${limpo ? '-' + limpo : ''}.pdf`;
  }

  // ============================ Ficha do aluno ============================

  function corpoFicha(d, ctx) {
    const a = d.aluno;
    const emAberto = d.emprestimos.filter((e) => e.em_aberto);
    const devolvidos = d.emprestimos.filter((e) => !e.em_aberto);

    return `
      ${cabecalho(ctx.cfg, 'Ficha do aluno', `Emitida em ${dataBR(d.emitido_em)}`)}

      <table>
        <tr><th style="width:110px">Nome</th><td colspan="${a.foto_path ? 2 : 3}"><strong>${esc(a.nome)}</strong></td>
          ${a.foto_path ? `<td rowspan="5" style="width:110px;text-align:center">
            <img src="/uploads/pessoas/${encodeURIComponent(a.foto_path)}" alt="" style="width:90px;height:90px;object-fit:cover;border-radius:6px">
          </td>` : ''}
        </tr>
        <tr>
          <th>Nascimento</th><td>${dataBR(a.data_nascimento)}${a.idade != null ? ` <span class="dica">(${a.idade} anos)</span>` : ''}</td>
          <th style="width:110px">CPF</th><td>${esc(a.cpf || '—')}</td>
        </tr>
        <tr><th>Telefone</th><td>${esc(a.telefone || '—')}</td><th>E-mail</th><td>${esc(a.email || '—')}</td></tr>
        <tr><th>Endereço</th><td colspan="3">${esc(a.endereco || '—')}</td></tr>
        <tr>
          <th>Responsável</th><td>${esc(a.responsavel_nome || '—')}</td>
          <th>Telefone</th><td>${esc(a.responsavel_telefone || '—')}</td>
        </tr>
      </table>

      <h2>Turmas</h2>
      ${d.matriculas.length ? `<table>
        <thead><tr><th>Curso / turma</th><th>Horário</th><th>Instrutor</th><th>Período</th><th>Situação</th><th>Frequência</th></tr></thead>
        <tbody>${d.matriculas.map((m) => `<tr>
          <td><strong>${esc(m.curso_nome)}</strong><div class="dica">${esc(m.turma_nome)}${m.sala ? ' · ' + esc(m.sala) : ''}</div></td>
          <td>${esc(m.horarios || '—')}</td>
          <td>${esc(m.instrutores || '—')}</td>
          <td>${dataBR(m.periodo_inicio)}${m.periodo_fim ? ' a ' + dataBR(m.periodo_fim) : ''}${m.periodo_rotulo ? `<div class="dica">${esc(m.periodo_rotulo)}</div>` : ''}</td>
          <td>${esc(ROTULO_MATRICULA[m.status] || m.status)}</td>
          <td>${m.frequencia.percentual != null
            ? `<strong>${m.frequencia.percentual}%</strong><div class="dica">${m.frequencia.presencas}/${m.frequencia.encontros} presenças</div>`
            : '<span class="dica">sem chamada</span>'}</td>
        </tr>`).join('')}</tbody></table>`
        : '<p class="dica">Sem matrícula registrada.</p>'}

      <h2>Instrumentos</h2>
      ${emAberto.length ? `<table>
        <thead><tr><th>Instrumento</th><th>Nº</th><th>Saiu em</th><th>Devolver até</th></tr></thead>
        <tbody>${emAberto.map((e) => `<tr>
          <td>${esc(e.instrumento_nome)}</td><td>${esc(e.numero)}</td>
          <td>${dataBR(e.data_emprestimo)}</td><td>${e.previsao_devolucao ? dataBR(e.previsao_devolucao) : '—'}</td>
        </tr>`).join('')}</tbody></table>`
        : '<p class="dica">Nenhum instrumento do acervo com o aluno no momento.</p>'}
      ${d.instrumentos_proprios.length
        ? `<p class="dica">Instrumento próprio: ${d.instrumentos_proprios.map((i) => esc(i.instrumento_nome)).join(', ')} — não ocupa vaga do acervo.</p>`
        : ''}
      ${devolvidos.length ? `<p class="dica">${devolvidos.length} empréstimo(s) já devolvido(s) no histórico.</p>` : ''}

      <h2>Termos e autorizações</h2>
      ${d.autorizacoes.length ? `<table>
        <thead><tr><th>Termo</th><th>Entregue?</th><th>Data</th><th>Observação</th></tr></thead>
        <tbody>${d.autorizacoes.map((t) => `<tr>
          <td>${esc(t.tipo)}</td><td>${t.entregue ? 'Sim' : 'Não'}</td>
          <td>${t.data_entrega ? dataBR(t.data_entrega) : '—'}</td><td>${esc(t.observacao || '')}</td>
        </tr>`).join('')}</tbody></table>`
        : '<p class="dica">Nenhum termo registrado.</p>'}

      <h2>Resumo</h2>
      <table>
        <tr>
          <th>Turmas ativas</th><td>${d.resumo.turmas_ativas}</td>
          <th>No histórico</th><td>${d.resumo.turmas_no_historico}</td>
          <th>Frequência geral</th><td>${d.resumo.frequencia_geral != null ? d.resumo.frequencia_geral + '%' : '—'}</td>
        </tr>
      </table>

      <div class="rodape">Documento de uso interno · ${esc(ctx.cfg.nome_loja || 'Instituto')}</div>`;
  }

  async function fichaDoAluno(alunoId) {
    let d; let ctx;
    try { [d, ctx] = await Promise.all([API.get(`/api/instituto/ficha-aluno/${alunoId}`), contexto()]); }
    catch (e) { UI.erro(e.message); return; }

    try { await UI.baixarPDF(pagina('Ficha do aluno', ctx.cfg, corpoFicha(d, ctx)), nomeArquivo('ficha', d.aluno.nome)); }
    catch (e) { UI.erro(e.message); }
  }

  /** Ficha de todos os alunos ativos da turma, num PDF só (uma página por aluno). */
  async function fichasDoAlunoLote(turmaId) {
    let turma;
    try { turma = await API.get(`/api/turmas/${turmaId}`); } catch (e) { UI.erro(e.message); return; }
    const ativos = turma.matriculas.filter((m) => m.status === 'ativa');
    if (!ativos.length) { UI.erro('Nenhum aluno ativo nesta turma.'); return; }

    let ctx; let lista;
    try {
      ctx = await contexto();
      lista = await Promise.all(ativos.map((m) => API.get(`/api/instituto/ficha-aluno/${m.aluno_id}`)));
    } catch (e) { UI.erro(e.message); return; }

    const corpo = lista.map((d, i) => `${i > 0 ? '<div class="quebra-pagina"></div>' : ''}${corpoFicha(d, ctx)}`).join('\n');
    try { await UI.baixarPDF(pagina('Fichas dos alunos', ctx.cfg, corpo, '.quebra-pagina { page-break-before: always; }'), nomeArquivo('fichas', turma.nome)); }
    catch (e) { UI.erro(e.message); }
  }

  // ==================== Folha de chamada para preencher ====================

  /**
   * A folha que o instrutor leva impressa: alunos nas linhas, datas nas
   * colunas, quadradinhos em branco. Sempre com linhas vazias no fim — aluno
   * novo aparece na aula antes de aparecer no sistema.
   */
  const CSS_FOLHA_CHAMADA = `
    @page { size: A4 landscape; margin: 12mm; }
    body { padding: 0; }
    /* width:auto deixa a grade do tamanho do conteúdo: com poucas datas no
       mês ela não estica os quadradinhos pela folha toda. */
    table.chamada, table.assinaturas { width:auto; min-width:55%; }
    table.chamada td, table.chamada th { text-align:center; }
    table.chamada .col-n { width:26px; color:#666; }
    table.chamada .col-nome { text-align:left; min-width:220px; }
    table.chamada .col-dia { width:38px; height:26px; }
    table.chamada .dia-semana { font-weight:normal; font-size:9px; color:#666; }
    table.chamada tr.extra .col-nome { background:repeating-linear-gradient(180deg,#fff,#fff 22px,#eee 22px,#eee 23px); }
    table.assinaturas { margin-top:14px; }
    table.assinaturas th { text-align:center; }
    table.assinaturas .rubrica { height:40px; min-width:110px; }
    .legenda { font-size:11px; color:#555; margin:6px 0 0; }
    .ficha-turma th { width:90px; }
    .quebra-pagina { page-break-before: always; }
  `;

  /** Monta o corpo (sem a moldura do documento) da folha de uma turma — usado tanto sozinho quanto no lote de todas as turmas. */
  function corpoFolhaChamada(d, ctx) {
    const colunas = d.encontros.length;
    const linhasExtras = 4;
    const [ano, mesNum] = d.periodo.de.split('-').map(Number);

    return `
      ${cabecalho(ctx.cfg, 'Folha de chamada', `${MESES[mesNum - 1]} de ${ano}`)}

      <table class="ficha-turma">
        <tr>
          <th style="width:90px">Turma</th><td><strong>${esc(d.turma.nome)}</strong> <span class="dica">${esc(d.turma.curso_nome)}</span></td>
          <th style="width:90px">Sala</th><td>${esc(d.turma.sala || '—')}</td>
        </tr>
        <tr>
          <th>Horário</th><td>${esc(d.horarios.join(' · ') || '—')}</td>
          <th>Instrutor</th><td>${esc(d.instrutores.map((i) => i.nome).join(', ') || '—')}</td>
        </tr>
      </table>

      ${colunas ? `
      <table class="chamada">
        <thead>
          <tr>
            <th class="col-n">#</th>
            <th class="col-nome">Aluno</th>
            ${d.encontros.map((e) => `<th class="col-dia">${e.dia}/${e.mes_curto}<div class="dia-semana">${e.dia_semana}</div></th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${d.alunos.map((al, i) => `<tr>
            <td class="col-n">${i + 1}</td>
            <td class="col-nome">${esc(al.nome)}</td>
            ${d.encontros.map(() => '<td class="col-dia"></td>').join('')}
          </tr>`).join('')}
          ${Array.from({ length: linhasExtras }).map((_, i) => `<tr class="extra">
            <td class="col-n">${d.alunos.length + i + 1}</td>
            <td class="col-nome"></td>
            ${d.encontros.map(() => '<td class="col-dia"></td>').join('')}
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="legenda">Marque <strong>P</strong> para presente, <strong>F</strong> para falta e <strong>J</strong> para falta justificada.
      As linhas em branco são para quem chegar durante o mês.</p>

      <table class="assinaturas">
        <thead><tr>${d.encontros.map((e) => `<th>${e.dia}/${e.mes_curto}</th>`).join('')}</tr></thead>
        <tbody><tr>${d.encontros.map(() => '<td class="rubrica"></td>').join('')}</tr></tbody>
      </table>
      <p class="legenda">Rubrica de quem deu a aula.</p>
      ` : `<p class="dica">Não há aula marcada para esta turma em ${MESES[mesNum - 1]} de ${ano}.</p>`}

      <div class="rodape">
        ${d.alunos.length} aluno(s) matriculado(s) · ${colunas} encontro(s) no mês ·
        emitido em ${dataBR(new Date().toISOString().slice(0, 10))}
      </div>`;
  }

  async function folhaDeChamada(turmaId, mes) {
    let d; let ctx;
    try {
      [d, ctx] = await Promise.all([
        API.get(`/api/turmas/${turmaId}/folha-impressao?mes=${encodeURIComponent(mes || '')}`),
        contexto(),
      ]);
    } catch (e) { UI.erro(e.message); return; }

    const corpo = corpoFolhaChamada(d, ctx);
    try { await UI.baixarPDF(pagina('Folha de chamada', ctx.cfg, corpo, CSS_FOLHA_CHAMADA), nomeArquivo(`chamada-${d.periodo.de.slice(0, 7)}`, d.turma.nome)); }
    catch (e) { UI.erro(e.message); }
  }

  /**
   * Gera de uma vez as folhas de chamada do mês de todas as turmas abertas,
   * num PDF só (uma folha por turma, com quebra de página entre elas) —
   * pra imprimir tudo já pronto em vez de gerar turma por turma.
   */
  async function folhasDeChamadaLote(mes) {
    let turmas; let ctx;
    try {
      [turmas, ctx] = await Promise.all([
        API.get('/api/turmas?status=aberta'),
        contexto(),
      ]);
    } catch (e) { UI.erro(e.message); return; }

    if (!turmas.length) { UI.erro('Não há turma aberta para gerar as folhas.'); return; }

    const dados = [];
    for (const t of turmas) {
      try { dados.push(await API.get(`/api/turmas/${t.id}/folha-impressao?mes=${encodeURIComponent(mes || '')}`)); }
      catch (e) { /* turma sem horario cadastrado, por exemplo: pula */ }
    }
    if (!dados.length) { UI.erro('Nenhuma turma pôde gerar folha para este mês.'); return; }

    const corpo = dados.map((d, i) => `${i > 0 ? '<div class="quebra-pagina"></div>' : ''}${corpoFolhaChamada(d, ctx)}`).join('');
    const [ano, mesNum] = dados[0].periodo.de.split('-').map(Number);
    try { await UI.baixarPDF(pagina('Folhas de chamada', ctx.cfg, corpo, CSS_FOLHA_CHAMADA), nomeArquivo('chamadas', `${MESES[mesNum - 1]}-${ano}`)); }
    catch (e) { UI.erro(e.message); }
  }

  // ===================== Calendário de aulas (instrutor) =====================

  const DIAS_SEMANA_ABREV = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  /** 'YYYY-MM' de hoje até `meses` para trás/frente, pro seletor de período. */
  function periodoDoMes(deMes, ateMes) {
    const [a1, m1] = deMes.split('-').map(Number);
    const [a2, m2] = ateMes.split('-').map(Number);
    const de = `${deMes}-01`;
    const ultimoDia = new Date(a2, m2, 0).getDate();
    const ate = `${ateMes}-${String(ultimoDia).padStart(2, '0')}`;
    return { de, ate };
  }

  function rotuloPeriodo(deMes, ateMes) {
    const nome = (aaMm) => { const [a, m] = aaMm.split('-').map(Number); return `${MESES[m - 1]} de ${a}`; };
    return deMes === ateMes ? nome(deMes) : `${nome(deMes)} a ${nome(ateMes)}`;
  }

  /** Corpo do calendário de um instrutor: uma linha por aula real do período, com os alunos da turma logo abaixo. */
  function corpoCalendarioInstrutor(nome, encontros) {
    return `
      <h2 style="margin-top:0">${esc(nome)}</h2>
      ${encontros.length ? `
      <table>
        <thead><tr><th>Dia</th><th>Horário</th><th>Turma</th><th>Curso</th><th>Sala</th><th>Função</th></tr></thead>
        <tbody>${encontros.map((e) => `<tr${e.suspensa ? ' style="opacity:.55"' : ''}>
          <td>${DIAS_SEMANA_ABREV[e.dia_semana]} ${dataBR(e.data)}${e.suspensa ? ' <span class="dica">(suspensa)</span>' : ''}</td>
          <td>${esc(e.hora_inicio)}${e.hora_fim ? ' às ' + esc(e.hora_fim) : ''}</td>
          <td>${esc(e.turma_nome)}</td>
          <td>${esc(e.curso_nome)}</td>
          <td>${esc(e.sala || '—')}</td>
          <td>${esc(e.papel || '—')}</td>
        </tr>
        <tr${e.suspensa ? ' style="opacity:.55"' : ''}>
          <td></td>
          <td colspan="5" style="font-size:11px;color:#555">${e.alunos.length ? esc(e.alunos.join(', ')) : 'Nenhum aluno matriculado.'}</td>
        </tr>`).join('')}</tbody>
      </table>` : '<p class="dica">Nenhuma aula marcada neste período.</p>'}`;
  }

  /** Calendário das aulas reais de um instrutor num período (um mês ou vários), pronto pra imprimir e levar. */
  async function calendarioInstrutor(profissionalId, { deMes, ateMes } = {}) {
    const mesAtual = new Date().toISOString().slice(0, 7);
    const de = deMes || mesAtual; const ate = ateMes || de;
    const { de: dataDe, ate: dataAte } = periodoDoMes(de, ate);

    let p; let encontros; let ctx;
    try {
      [p, encontros, ctx] = await Promise.all([
        API.get(`/api/agenda/profissionais/${profissionalId}`),
        API.get(`/api/turmas/instrutores/${profissionalId}/encontros?de=${dataDe}&ate=${dataAte}`),
        contexto(),
      ]);
    } catch (e) { UI.erro(e.message); return; }

    const corpo = `${cabecalho(ctx.cfg, 'Calendário de aulas', rotuloPeriodo(de, ate))}${corpoCalendarioInstrutor(p.nome, encontros)}
      <div class="rodape">emitido em ${dataBR(new Date().toISOString().slice(0, 10))}</div>`;
    try { await UI.baixarPDF(pagina('Calendário de aulas', ctx.cfg, corpo), nomeArquivo(`calendario-aulas-${de}`, p.nome)); }
    catch (e) { UI.erro(e.message); }
  }

  /** Um PDF só com o calendário de todos os instrutores no período (uma página cada). */
  async function calendariosInstrutoresLote({ deMes, ateMes } = {}) {
    const mesAtual = new Date().toISOString().slice(0, 7);
    const de = deMes || mesAtual; const ate = ateMes || de;
    const { de: dataDe, ate: dataAte } = periodoDoMes(de, ate);

    let profissionais; let ctx;
    try {
      [profissionais, ctx] = await Promise.all([
        API.get('/api/agenda/profissionais'),
        contexto(),
      ]);
    } catch (e) { UI.erro(e.message); return; }

    const comAula = [];
    for (const pf of profissionais) {
      let encontros;
      try { encontros = await API.get(`/api/turmas/instrutores/${pf.id}/encontros?de=${dataDe}&ate=${dataAte}`); } catch (_) { continue; }
      if (encontros.length) comAula.push({ nome: pf.nome, encontros });
    }
    if (!comAula.length) { UI.erro('Nenhum instrutor tem aula marcada neste período.'); return; }

    const corpo = `${cabecalho(ctx.cfg, 'Calendário de aulas', rotuloPeriodo(de, ate))}`
      + comAula.map((p, i) => `${i > 0 ? '<div class="quebra-pagina"></div>' : ''}${corpoCalendarioInstrutor(p.nome, p.encontros)}`).join('')
      + `<div class="rodape">emitido em ${dataBR(new Date().toISOString().slice(0, 10))}</div>`;
    try { await UI.baixarPDF(pagina('Calendário de aulas', ctx.cfg, corpo, '.quebra-pagina { page-break-before: always; }'), nomeArquivo(`calendario-aulas-${de}`, 'todos-os-instrutores')); }
    catch (e) { UI.erro(e.message); }
  }

  // ========================= Escala do dia (Agenda) =========================

  /** "quarta-feira, 31 de julho de 2026" — pro cabeçalho da escala do dia. */
  function porExtensoComDia(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '—';
    const diaSemana = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
    return `${diaSemana[new Date(iso + 'T12:00:00').getDay()]}, ${porExtenso(iso)}`;
  }

  const CSS_ESCALA_DO_DIA = `
    @page { size: A4 landscape; margin: 14mm; }
    table.tabela-escala th, table.tabela-escala td { text-align:center; vertical-align:middle; }
    table.tabela-escala td { font-size:12px; }
    table.tabela-escala .escala-turma { font-weight:bold; }
    table.tabela-escala .escala-detalhe { font-size:10px; color:#555; }
  `;

  /**
   * Escala do dia num quadro (horário × curso), igual a um mural de aviso:
   * cada linha é um horário, cada coluna um curso/instrumento, e a célula
   * mostra qual turma acontece ali — assim quem não usa o sistema (staff,
   * instrutores, visitantes) lê de relance quem tem aula com quem e onde.
   */
  function corpoEscalaDoDia(encontros) {
    if (!encontros.length) return '<p class="dica">Nenhuma aula marcada neste dia.</p>';

    const chaveHorario = (e) => `${e.hora_inicio}|${e.hora_fim || ''}`;
    const horarios = [...new Map(encontros.map((e) => [chaveHorario(e), { inicio: e.hora_inicio, fim: e.hora_fim }])).values()]
      .sort((a, b) => a.inicio.localeCompare(b.inicio));
    const cursos = [...new Set(encontros.map((e) => e.curso_nome || 'Outros'))];

    const grade = new Map();
    encontros.forEach((e) => {
      const chave = `${chaveHorario(e)}|${e.curso_nome || 'Outros'}`;
      if (!grade.has(chave)) grade.set(chave, []);
      grade.get(chave).push(e);
    });

    return `
      <table class="tabela-escala">
        <thead><tr><th></th>${cursos.map((c) => `<th>${esc(c.toUpperCase())}</th>`).join('')}</tr></thead>
        <tbody>${horarios.map((h) => `<tr>
          <th style="white-space:nowrap">${esc(h.inicio)}${h.fim ? ' até ' + esc(h.fim) : ''}</th>
          ${cursos.map((c) => {
            const itens = grade.get(`${h.inicio}|${h.fim || ''}|${c}`) || [];
            return `<td>${itens.map((e) => `
              <div class="escala-turma"${e.suspensa ? ' style="opacity:.55;text-decoration:line-through"' : ''}>${esc(e.turma_nome)}</div>
              ${e.sala || e.profissional_nome ? `<div class="escala-detalhe">${[e.sala ? 'Sala ' + esc(e.sala) : '', e.profissional_nome ? esc(e.profissional_nome) : ''].filter(Boolean).join(' · ')}</div>` : ''}
            `).join('<hr style="border:none;border-top:1px dashed #ccc;margin:4px 0">')}</td>`;
          }).join('')}
        </tr>`).join('')}</tbody>
      </table>`;
  }

  /** PDF pronto pra imprimir e afixar: a escala de aulas de um dia, pra staff, instrutores e visitantes acompanharem. */
  async function escalaDoDia(data) {
    let encontros; let ctx;
    try {
      [encontros, ctx] = await Promise.all([
        API.get(`/api/turmas/escala-do-dia?data=${encodeURIComponent(data)}`),
        contexto(),
      ]);
    } catch (e) { UI.erro(e.message); return; }
    if (!encontros.length) { UI.erro('Não há aula marcada neste dia.'); return; }

    const corpo = `${cabecalho(ctx.cfg, 'Escala de aulas do dia', porExtensoComDia(data))}${corpoEscalaDoDia(encontros)}
      <div class="rodape">emitido em ${dataBR(new Date().toISOString().slice(0, 10))}</div>`;
    try { await UI.baixarPDF(pagina('Escala de aulas do dia', ctx.cfg, corpo, CSS_ESCALA_DO_DIA), nomeArquivo('escala-do-dia', data)); }
    catch (e) { UI.erro(e.message); }
  }

  /** PDF do mês inteiro: a mesma grade horário × curso, repetida dia a dia, pra quem quer o panorama do mês pregado no mural. */
  async function escalaDoMes({ deMes, ateMes } = {}) {
    const mesAtual = new Date().toISOString().slice(0, 7);
    const de = deMes || mesAtual; const ate = ateMes || de;
    const { de: dataDe, ate: dataAte } = periodoDoMes(de, ate);

    let encontros; let ctx;
    try {
      [encontros, ctx] = await Promise.all([
        API.get(`/api/turmas/escala-do-periodo?de=${dataDe}&ate=${dataAte}`),
        contexto(),
      ]);
    } catch (e) { UI.erro(e.message); return; }
    if (!encontros.length) { UI.erro('Não há aula marcada neste período.'); return; }

    const porDia = new Map();
    encontros.forEach((e) => {
      if (!porDia.has(e.data)) porDia.set(e.data, []);
      porDia.get(e.data).push(e);
    });
    const dias = [...porDia.keys()].sort();

    const corpo = `${cabecalho(ctx.cfg, 'Escala de aulas do mês', rotuloPeriodo(de, ate))}`
      + dias.map((d) => `<h3>${esc(porExtensoComDia(d))}</h3>${corpoEscalaDoDia(porDia.get(d))}`).join('')
      + `<div class="rodape">emitido em ${dataBR(new Date().toISOString().slice(0, 10))}</div>`;
    try { await UI.baixarPDF(pagina('Escala de aulas do mês', ctx.cfg, corpo, CSS_ESCALA_DO_DIA), nomeArquivo('escala-do-mes', de)); }
    catch (e) { UI.erro(e.message); }
  }

  // ========================= Relatório de todas as turmas =========================

  const ROTULO_STATUS_TURMA = { planejada: 'Planejada', aberta: 'Aberta', encerrada: 'Encerrada', cancelada: 'Cancelada' };

  /** Uma página por turma: curso, período, instrutores, progresso, vagas e a lista de alunos matriculados. */
  function corpoRelatorioTurma(t, progresso) {
    const instrutores = t.instrutores.length
      ? t.instrutores.map((i) => `${esc(i.nome)} (${esc(i.papel)})`).join(', ')
      : 'Nenhum instrutor escalado.';
    const horarios = t.horarios.length
      ? t.horarios.map((h) => `${DIAS_SEMANA_ABREV[h.dia_semana]} ${esc(h.hora_inicio)}–${esc(h.hora_fim)}`).join(' · ')
      : '—';
    const ativos = t.matriculas.filter((m) => m.status === 'ativa');

    return `
      <h2 style="margin-top:0">${esc(t.curso_nome)}</h2>
      <h3 style="margin-top:0">${esc(t.nome)} <span class="dica">${ROTULO_STATUS_TURMA[t.status] || t.status}</span></h3>
      <p class="dica" style="margin-top:0">${horarios}${t.sala ? ' · Sala ' + esc(t.sala) : ''}
        · Período: ${dataBR(t.periodo_inicio)}${t.periodo_fim ? ' até ' + dataBR(t.periodo_fim) : ''}</p>
      <p><strong>Instrutores:</strong> ${instrutores}</p>
      <p><strong>Progresso do curso:</strong> ${progresso.percentual != null
        ? `${progresso.percentual}% (${progresso.horas_dadas}h de ${progresso.carga_horaria}h)`
        : 'sem carga horária cadastrada no curso'}</p>
      <p><strong>Vagas:</strong> ${t.vagas_ocupadas} de ${t.vagas_total}${t.na_espera ? ` · ${t.na_espera} na fila de espera` : ''}</p>
      <h4>Alunos matriculados</h4>
      <table>
        <thead><tr><th>Aluno</th><th>Situação</th><th>Responsável</th></tr></thead>
        <tbody>${ativos.length ? ativos.map((m) => `<tr>
          <td>${esc(m.aluno_nome)}</td>
          <td>${esc(ROTULO_MATRICULA[m.status] || m.status)}</td>
          <td>${esc(m.responsavel_nome || '—')}</td>
        </tr>`).join('') : '<tr><td colspan="3" class="dica">Nenhum aluno matriculado.</td></tr>'}</tbody>
      </table>`;
  }

  /**
   * Relatório com todas as turmas (respeitando o filtro da tela), uma página
   * por turma, agrupado por curso — assim saem juntas todas as folhas de
   * bateria, depois todas de violão, e assim por diante.
   */
  async function relatorioDeTurmas({ curso_id, status } = {}) {
    const params = new URLSearchParams();
    if (curso_id) params.set('curso_id', curso_id);
    const statusList = Array.isArray(status) ? status : (status ? [status] : []);
    if (statusList.length) params.set('status', statusList.join(','));

    let resumos; let ctx;
    try {
      [resumos, ctx] = await Promise.all([
        API.get('/api/turmas?' + params.toString()),
        contexto(),
      ]);
    } catch (e) { UI.erro(e.message); return; }
    if (!resumos.length) { UI.erro('Não há turma para gerar o relatório.'); return; }

    let detalhes;
    try {
      detalhes = await Promise.all(resumos.map(async (r) => {
        const [t, prog] = await Promise.all([
          API.get(`/api/turmas/${r.id}`),
          API.get(`/api/turmas/${r.id}/progresso`),
        ]);
        return { t, prog };
      }));
    } catch (e) { UI.erro(e.message); return; }

    detalhes.sort((a, b) => a.t.curso_nome.localeCompare(b.t.curso_nome, 'pt-BR') || a.t.nome.localeCompare(b.t.nome, 'pt-BR'));

    const corpo = `${cabecalho(ctx.cfg, 'Relatório de turmas', `${detalhes.length} turma(s)`)}`
      + detalhes.map((d, i) => `${i > 0 ? '<div class="quebra-pagina"></div>' : ''}${corpoRelatorioTurma(d.t, d.prog)}`).join('')
      + `<div class="rodape">emitido em ${dataBR(new Date().toISOString().slice(0, 10))}</div>`;
    try {
      await UI.baixarPDF(
        pagina('Relatório de turmas', ctx.cfg, corpo, '.quebra-pagina { page-break-before: always; }'),
        nomeArquivo('relatorio-turmas', new Date().toISOString().slice(0, 10))
      );
    } catch (e) { UI.erro(e.message); }
  }

  // ============================= Declarações =============================

  const ESTILO_DECLARACAO = `
    body { font-family: Georgia, serif; padding:56px; line-height:1.9; }
    .cabecalho { border-bottom:none; justify-content:center; text-align:center; display:block; margin-bottom:34px; }
    .cabecalho h1 { font-size:19px; }
    .titulo-doc { font-size:16px; text-align:center; margin:26px 0; letter-spacing:.5px; }
    p { text-align: justify; margin: 10px 0; }
    p.centro { text-align:center; font-size:15px; }
    p.destaque { text-align:center; font-size:22px; font-weight:bold; margin:12px 0; }
    .assinatura { margin-top:56px; }
  `;

  function dadosDeclaracaoMatricula(d) {
    const a = d.aluno;
    const turmas = d.matriculas.map((m) => {
      const carga = m.carga_horaria ? `, com carga horária de ${m.carga_horaria} hora(s)` : '';
      return `<li>${esc(m.curso_nome)} — turma ${esc(m.turma_nome)}${m.horarios ? `, ${esc(m.horarios)}` : ''}${carga}, `
        + `desde ${porExtenso(m.data_matricula || m.periodo_inicio)}.</li>`;
    }).join('');
    return {
      aluno_nome: `<strong>${esc(a.nome)}</strong>`,
      aluno_cpf: esc(a.cpf || ''),
      aluno_nascimento: porExtenso(a.data_nascimento),
      responsavel_nome: esc(a.responsavel_nome || ''),
      turmas: `<ul>${turmas}</ul>`,
    };
  }

  async function declaracaoMatricula(alunoId) {
    let d;
    try { d = await API.get(`/api/instituto/declaracao-matricula/${alunoId}`); }
    catch (e) { UI.erro(e.message); return; }
    await emitirModelo('declaracao_matricula', dadosDeclaracaoMatricula(d), nomeArquivo('declaracao-matricula', d.aluno.nome));
  }

  /** Declaração de matrícula de todos os alunos ativos da turma, num PDF só. */
  async function declaracoesMatriculaLote(turmaId) {
    let turma;
    try { turma = await API.get(`/api/turmas/${turmaId}`); } catch (e) { UI.erro(e.message); return; }
    const ativos = turma.matriculas.filter((m) => m.status === 'ativa');
    if (!ativos.length) { UI.erro('Nenhum aluno ativo nesta turma.'); return; }

    let lista;
    try {
      lista = await Promise.all(ativos.map(async (m) => dadosDeclaracaoMatricula(await API.get(`/api/instituto/declaracao-matricula/${m.aluno_id}`))));
    } catch (e) { UI.erro(e.message); return; }

    await emitirModeloLote('declaracao_matricula', lista, nomeArquivo('declaracoes-matricula', turma.nome));
  }

  /**
   * Declaração de trabalho voluntário. Separa aulas de atividades porque a
   * pessoa que montou o palco doou o tempo dela igual a quem deu aula.
   */
  async function declaracaoVoluntariado(pessoa, de, ate) {
    const partes = [];
    if (pessoa.aulas_dadas > 0) partes.push(`ministrado <strong>${pessoa.aulas_dadas} aula(s)</strong>`);
    if (pessoa.atividades > 0) partes.push('participado de '
      + `<strong>${pessoa.atividades} atividade(s)</strong> de apoio (eventos, manutenção e organização)`);
    const feito = partes.length ? partes.join(' e ') : 'colaborado com as atividades da instituição';

    await emitirModelo('declaracao_voluntariado', {
      voluntario_nome: `<strong>${esc(pessoa.nome)}</strong>`,
      voluntario_documento: esc(pessoa.documento || ''),
      voluntario_telefone: esc(pessoa.telefone || ''),
      voluntario_email: esc(pessoa.email || ''),
      voluntario_endereco: esc(pessoa.endereco || ''),
      periodo_de: porExtenso(de),
      periodo_ate: porExtenso(ate),
      horas: esc(String(pessoa.horas || 0)),
      aulas: pessoa.aulas_dadas || 0,
      atividades: pessoa.atividades || 0,
      resumo_atividades: feito,
      assinatura_pessoa: linhaAssinatura(pessoa.nome, pessoa.documento ? `CPF: ${pessoa.documento}` : 'Voluntário(a)'),
    }, nomeArquivo('declaracao-voluntariado', pessoa.nome));
  }

  /** Termo assinado quando o voluntário entra (Lei 9.608/1998). */
  async function termoVoluntariado(pessoa, extras = {}) {
    await emitirModelo('termo_voluntariado', {
      voluntario_nome: `<strong>${esc(pessoa.nome)}</strong>`,
      voluntario_documento: esc(pessoa.documento || ''),
      voluntario_telefone: esc(pessoa.telefone || ''),
      voluntario_email: esc(pessoa.email || ''),
      voluntario_endereco: esc(pessoa.endereco || ''),
      atividade: esc(extras.atividade || ''),
      carga_semanal: esc(extras.carga_semanal || ''),
      inicio: extras.inicio ? porExtenso(extras.inicio) : '',
      assinatura_pessoa: linhaAssinatura(pessoa.nome, pessoa.documento ? `CPF: ${pessoa.documento}` : 'Voluntário(a)'),
    }, nomeArquivo('termo-voluntariado', pessoa.nome));
  }

  const CSS_CERTIFICADO = '@page { size: A4 landscape; margin: 18mm; } body { padding:34px; }';

  function dadosCertificado(d) {
    const m = d.matricula;
    return {
      aluno_nome: esc(d.aluno.nome),
      curso: esc(m.curso_nome),
      turma: esc(m.turma_nome),
      carga_horaria: m.carga_horaria || '',
      frequencia: m.frequencia.percentual != null ? `${m.frequencia.percentual}%` : '',
      periodo_inicio: porExtenso(m.periodo_inicio),
      periodo_fim: porExtenso(m.periodo_fim),
      instrutores: esc(m.instrutores || ''),
    };
  }

  async function certificado(alunoId, turmaId) {
    let d;
    try { d = await API.get(`/api/instituto/certificado/${alunoId}/${turmaId}`); }
    catch (e) { UI.erro(e.message); return; }
    await emitirModelo('certificado', dadosCertificado(d), nomeArquivo('certificado', d.aluno.nome), CSS_CERTIFICADO);
  }

  /** Certificado de todos os alunos concluintes da turma, num PDF só. */
  async function certificadosLote(turmaId) {
    let turma;
    try { turma = await API.get(`/api/turmas/${turmaId}`); } catch (e) { UI.erro(e.message); return; }
    const concluidos = turma.matriculas.filter((m) => m.status === 'concluida');
    if (!concluidos.length) { UI.erro('Nenhum aluno concluinte nesta turma ainda.'); return; }

    let lista;
    try {
      lista = await Promise.all(concluidos.map(async (m) => dadosCertificado(await API.get(`/api/instituto/certificado/${m.aluno_id}/${turmaId}`))));
    } catch (e) { UI.erro(e.message); return; }

    await emitirModeloLote('certificado', lista, nomeArquivo('certificados', turma.nome), CSS_CERTIFICADO);
  }

  // ============== Relatório de frequência (professor particular) ==============

  const ROTULO_AULA = {
    atendido: 'Aula dada', faltou: 'Faltou', cancelado: 'Cancelada', agendado: 'Agendada', confirmado: 'Confirmada',
  };
  const POR_QUEM = { aluno: 'a pedido do aluno', professor: 'a pedido do professor', feriado: 'por feriado' };

  function corpoFrequencia(d, cfg) {
    const t = d.totais;
    const hojeISO = new Date().toISOString().slice(0, 10);
    const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const rotuloAula = (a) => (a.data < hojeISO && (a.status === 'agendado' || a.status === 'confirmado') ? 'Sem registro' : (ROTULO_AULA[a.status] || a.status));
    return `
      ${cabecalho({ ...cfg, nome_loja: cfg.nome_loja || 'Professor particular' }, 'Relatório de frequência',
        `Aluno: <strong>${esc(d.aluno.nome)}</strong> · Período: ${dataBR(d.periodo.inicio)} a ${dataBR(d.periodo.fim)}`)}
      <h2>Resumo</h2>
      <table>
        <tr><th>Aulas dadas</th><td>${t.dadas}</td><th>Faltas</th><td>${t.faltas}</td>
          <th>Remarcadas</th><td>${t.remarcadas}</td><th>Canceladas</th><td>${t.canceladas}</td></tr>
        <tr><th colspan="2">Frequência</th><td colspan="6"><strong>${t.frequencia_pct != null ? t.frequencia_pct + '%' : '—'}</strong>
          <span class="dica">aulas dadas ÷ (dadas + faltas)</span></td></tr>
      </table>
      <h2>Últimos 6 meses</h2>
      <table>
        <thead><tr><th>Mês</th><th>Dadas</th><th>Faltas</th><th>Frequência</th></tr></thead>
        <tbody>${d.serie_mensal.map((m) => `<tr><td>${MES[Number(m.mes.slice(5, 7)) - 1]}/${m.mes.slice(0, 4)}</td><td>${m.dadas}</td><td>${m.faltas}</td>
          <td>${m.frequencia_pct != null ? m.frequencia_pct + '%' : '—'}</td></tr>`).join('')}</tbody>
      </table>
      <h2>Aulas do período</h2>
      ${d.ultimas_aulas.length ? `<table>
        <thead><tr><th>Data</th><th>Horário</th><th>Matéria</th><th>Situação</th></tr></thead>
        <tbody>${d.ultimas_aulas.map((a) => `<tr><td>${dataBR(a.data)}</td><td>${esc(a.hora_inicio)}</td><td>${esc(a.materia || '—')}</td>
          <td>${esc(rotuloAula(a))}${a.remarcada ? ` <span class="dica">(remarcada${a.remarcado_por ? ' ' + POR_QUEM[a.remarcado_por] : ''})</span>` : ''}</td></tr>`).join('')}</tbody>
      </table>
      ${d.ultimas_aulas.length >= 20 ? '<p class="dica">Mostrando as 20 aulas mais recentes do período.</p>' : ''}`
        : '<p class="dica">Nenhuma aula no período.</p>'}
      <div class="rodape">Emitido em ${dataBR(hojeISO)} · ${esc(cfg.nome_loja || 'Professor particular')}</div>`;
  }

  /** Relatório que o professor entrega ao aluno/responsável. `d` é a resposta de /api/agenda/frequencia/aluno/:id. */
  async function relatorioFrequenciaAluno(d) {
    let cfg;
    try { cfg = (await API.get('/api/config')) || {}; } catch (e) { UI.erro(e.message); return; }
    try { await UI.baixarPDF(pagina('Relatório de frequência', cfg, corpoFrequencia(d, cfg)), nomeArquivo('frequencia', d.aluno.nome)); }
    catch (e) { UI.erro(e.message); }
  }

  return {
    relatorioFrequenciaAluno, corpoFrequencia,
    fichaDoAluno, fichasDoAlunoLote, folhaDeChamada, folhasDeChamadaLote,
    calendarioInstrutor, calendariosInstrutoresLote, escalaDoDia, escalaDoMes, relatorioDeTurmas,
    declaracaoMatricula, declaracoesMatriculaLote, declaracaoVoluntariado, termoVoluntariado,
    certificado, certificadosLote,
    porExtenso, dataBR,
  };
})();