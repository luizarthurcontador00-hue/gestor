'use strict';

/**
 * Secoes da arrecadacao do instituto: ofertas, doacoes em especie,
 * mantenedores, projetos e a prestacao de contas do periodo.
 *
 * Isto NAO e uma pagina: sao blocos montados dentro da tela de Financeiro
 * quando o ramo e "instituto". A ideia e ter um financeiro so — o saldo, a
 * conciliacao e a arrecadacao falando do mesmo dinheiro — em vez de duas
 * telas que nunca fecham entre si.
 *
 * Aqui nao existe venda: o que entra e doacao, o que sai e despesa do
 * projeto, e o resultado nao e lucro — e saldo para prestar contas.
 */
window.SecoesArrecadacao = (function () {
  const FORMAS = [['pix', 'PIX'], ['dinheiro', 'Dinheiro'], ['transferencia', 'Transferência'],
    ['boleto', 'Boleto'], ['cartao', 'Cartão'], ['outro', 'Outro']];
  let projetos = [];
  let contasFin = [];
  let alvoId = 'ar-conteudo';
  const alvo = () => document.getElementById(alvoId);
  const hoje = () => new Date().toISOString().slice(0, 10);
  const inicioDoMes = () => hoje().slice(0, 8) + '01';
  const periodo = { de: inicioDoMes(), ate: hoje(), projeto_id: '' };

  /** Define em qual container as secoes vao ser desenhadas. */
  function montarEm(id) { alvoId = id; }

  async function carregarProjetos() {
    try { projetos = await API.get('/api/arrecadacao/projetos'); } catch (_) { projetos = []; }
    return projetos;
  }

  async function carregarContas() {
    try { contasFin = await API.get('/api/financeiro/contas-financeiras'); } catch (_) { contasFin = []; }
    return contasFin;
  }

  function barraPeriodo(idPrefixo) {
    return `
      <div class="barra-ferramentas">
        <div class="campo"><label>De</label><input type="date" id="${idPrefixo}-de" value="${periodo.de}" /></div>
        <div class="campo"><label>Até</label><input type="date" id="${idPrefixo}-ate" value="${periodo.ate}" /></div>
        <div class="campo"><label>Projeto</label>
          <select id="${idPrefixo}-projeto">
            <option value="">Todos</option>
            ${projetos.map((p) => `<option value="${p.id}" ${periodo.projeto_id == p.id ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
          </select></div>
        <div class="cresce"></div>
        <slot id="${idPrefixo}-acoes"></slot>
      </div>`;
  }

  function ligarPeriodo(prefixo, aoMudar) {
    const de = document.getElementById(`${prefixo}-de`);
    const ate = document.getElementById(`${prefixo}-ate`);
    const proj = document.getElementById(`${prefixo}-projeto`);
    if (de) de.addEventListener('change', (e) => { periodo.de = e.target.value; aoMudar(); });
    if (ate) ate.addEventListener('change', (e) => { periodo.ate = e.target.value; aoMudar(); });
    if (proj) proj.addEventListener('change', (e) => { periodo.projeto_id = e.target.value; aoMudar(); });
  }

  function query() {
    const q = new URLSearchParams();
    if (periodo.de) q.set('de', periodo.de);
    if (periodo.ate) q.set('ate', periodo.ate);
    if (periodo.projeto_id) q.set('projeto_id', periodo.projeto_id);
    return q.toString();
  }

  // ------------------------------- Ofertas -------------------------------
  async function renderOfertas() {
    const el = alvo();
    if (!el) return;
    el.innerHTML = barraPeriodo('of') + '<div class="card"><div id="of-lista">Carregando…</div></div>';
    document.getElementById('of-acoes').outerHTML = '<button class="btn" id="of-nova">+ Registrar oferta</button>';
    document.getElementById('of-nova').addEventListener('click', () => formOferta(null));
    ligarPeriodo('of', renderOfertas);

    let ofertas = [];
    try { ofertas = await API.get('/api/arrecadacao/ofertas?' + query()); }
    catch (e) { document.getElementById('of-lista').innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }
    await carregarContas();
    const nomeConta = (id) => { const c = contasFin.find((x) => x.id === id); return c ? c.nome : null; };

    const total = ofertas.reduce((s, o) => s + Number(o.valor || 0), 0);
    document.getElementById('of-lista').innerHTML = !ofertas.length
      ? `<div class="vazio"><h3>Nenhuma oferta no período</h3><p class="dica">Registre as doações recebidas — cada oferta entra direto no saldo da conta escolhida.</p></div>`
      : `<p><strong>Total do período: ${UI.moeda(total)}</strong> · ${ofertas.length} oferta(s) — já somadas ao saldo das contas</p>
        <div class="rolagem"><table class="tabela">
          <thead><tr><th>Data</th><th>Doador</th><th>Valor</th><th>Entrou em</th><th>Projeto</th><th></th></tr></thead>
          <tbody>
            ${ofertas.map((o) => `
              <tr>
                <td>${UI.dataHora(o.data)}</td>
                <td>${UI.escapar(o.mantenedor_nome || o.doador_nome || '—')}
                  ${o.recibo_emitido ? ' <span class="badge badge--muted">recibo emitido</span>' : ''}</td>
                <td>${UI.moeda(o.valor)}</td>
                <td class="dica">${UI.escapar(nomeConta(o.conta_financeira_id) || '⚠️ fora do caixa')}
                  <div class="dica">${UI.escapar(o.forma || '—')}</div></td>
                <td class="dica">${UI.escapar(o.projeto_nome || '—')}</td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn--secundario" data-recibo="${o.id}">Recibo</button>
                  <button class="btn btn--secundario" data-of-editar="${o.id}">Editar</button>
                  <button class="btn btn--perigo" data-of-excluir="${o.id}">Excluir</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table></div>`;

    el.querySelectorAll('[data-of-editar]').forEach((b) => b.addEventListener('click', () => formOferta(ofertas.find((o) => o.id === Number(b.dataset.ofEditar)))));
    el.querySelectorAll('[data-recibo]').forEach((b) => b.addEventListener('click', () => gerarRecibo(Number(b.dataset.recibo))));
    el.querySelectorAll('[data-of-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir esta oferta? O valor sai também do saldo da conta.', { titulo: 'Excluir oferta', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try {
        await API.del(`/api/arrecadacao/ofertas/${b.dataset.ofExcluir}`);
        UI.sucesso('Oferta excluída.');
        renderOfertas();
        if (window.__atualizarAvisoLembretes) window.__atualizarAvisoLembretes();
      } catch (e) { UI.erro(e.message); }
    }));
  }

  function formOferta(oferta) {
    const ed = !!oferta;
    Modal.abrir({
      titulo: ed ? 'Editar oferta' : 'Registrar oferta',
      textoConfirmar: 'Salvar',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo col-2"><label>Doador</label>
            <input type="search" id="ofd-busca" placeholder="Buscar mantenedor cadastrado (opcional)"
              value="${ed ? UI.escapar(oferta.mantenedor_nome || '') : ''}" />
            <div id="ofd-resultados"></div>
            <input type="hidden" id="ofd-cliente" value="${ed && oferta.cliente_id ? oferta.cliente_id : ''}" />
          </div>
          <div class="campo col-2"><label>Ou nome do doador (avulso/anônimo)</label>
            <input id="ofd-nome" value="${ed ? UI.escapar(oferta.doador_nome || '') : ''}" placeholder="Ex.: Doador anônimo" /></div>
          <div class="campo"><label>Valor *</label>
            <input id="ofd-valor" type="number" step="0.01" min="0" value="${ed ? oferta.valor : ''}" /></div>
          <div class="campo"><label>Data *</label>
            <input id="ofd-data" type="date" value="${ed ? UI.escapar(oferta.data) : hoje()}" /></div>
          <div class="campo"><label>Forma</label>
            <select id="ofd-forma">
              ${FORMAS.map(([v, t]) => `<option value="${v}" ${ed && oferta.forma === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select></div>
          <div class="campo"><label>Entrou na conta</label>
            <select id="ofd-conta">
              <option value="">Automático (pela forma)</option>
              ${contasFin.map((c) => `<option value="${c.id}" ${ed && String(oferta.conta_financeira_id) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)} — ${UI.moeda(c.saldo_atual)}</option>`).join('')}
            </select>
            <span class="dica">É esta conta que vai subir de saldo — e onde a oferta vai aparecer na conciliação do extrato.</span></div>
          <div class="campo col-2"><label>Projeto</label>
            <select id="ofd-projeto">
              <option value="">Nenhum (uso geral)</option>
              ${projetos.map((p) => `<option value="${p.id}" ${ed && oferta.projeto_id === p.id ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
            </select>
            <span class="dica">Verba carimbada: separa esta entrada na prestação de contas.</span></div>
          <div class="campo col-2"><label>Observação</label>
            <textarea id="ofd-obs" rows="2">${ed ? UI.escapar(oferta.observacao || '') : ''}</textarea></div>
        </div>`,
      aoAbrir: (el) => {
        CadastroRapido.ligar(el.querySelector('#ofd-conta'), 'conta', {
          aoCriar: (r) => contasFin.push(r),
          opcao: (r) => ({ texto: `${r.nome} — ${UI.moeda(r.saldo_inicial)}`, data: {} }),
        });
        const busca = el.querySelector('#ofd-busca');
        let timer = null;
        busca.addEventListener('input', () => {
          el.querySelector('#ofd-cliente').value = '';
          clearTimeout(timer);
          timer = setTimeout(async () => {
            const termo = busca.value.trim();
            const lista = el.querySelector('#ofd-resultados');
            if (!termo) { lista.innerHTML = ''; return; }
            let pessoas = [];
            try { pessoas = await API.get('/api/clientes?busca=' + encodeURIComponent(termo)); } catch (_) { return; }
            lista.innerHTML = pessoas.slice(0, 8).map((p) => `
              <div class="dica" style="padding:4px 0;cursor:pointer" data-pessoa="${p.id}" data-nome="${UI.escapar(p.nome)}">👤 ${UI.escapar(p.nome)}</div>`).join('');
            lista.querySelectorAll('[data-pessoa]').forEach((d) => d.addEventListener('click', () => {
              el.querySelector('#ofd-cliente').value = d.dataset.pessoa;
              busca.value = d.dataset.nome;
              el.querySelector('#ofd-nome').value = '';
              lista.innerHTML = '<span class="dica">✅ Mantenedor selecionado.</span>';
            }));
          }, 300);
        });
      },
      aoConfirmar: async (el) => {
        const corpo = {
          cliente_id: el.querySelector('#ofd-cliente').value || null,
          doador_nome: el.querySelector('#ofd-nome').value,
          valor: el.querySelector('#ofd-valor').value,
          data: el.querySelector('#ofd-data').value,
          forma: el.querySelector('#ofd-forma').value,
          conta_financeira_id: el.querySelector('#ofd-conta').value || null,
          projeto_id: el.querySelector('#ofd-projeto').value || null,
          observacao: el.querySelector('#ofd-obs').value,
        };
        try {
          if (ed) await API.put(`/api/arrecadacao/ofertas/${oferta.id}`, corpo);
          else await API.post('/api/arrecadacao/ofertas', corpo);
          UI.sucesso(ed ? 'Oferta atualizada.' : 'Oferta registrada e somada ao saldo.');
          renderOfertas();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function gerarRecibo(id) {
    let o; let cfg = {}; let assinante = null;
    try {
      [o, cfg, assinante] = await Promise.all([
        API.get(`/api/arrecadacao/ofertas/${id}`),
        API.get('/api/config').catch(() => ({})),
        API.get('/api/membros/assinante').catch(() => null),
      ]);
    } catch (e) { UI.erro(e.message); return; }

    const doador = o.mantenedor_nome || o.doador_nome || '—';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Recibo de doação</title>
      <style>
        body{font-family:Georgia,serif;padding:48px;color:#111;line-height:1.7}
        h1{font-size:20px;text-align:center;margin-bottom:4px}
        .sub{text-align:center;color:#555;font-size:13px;margin-bottom:32px}
        .valor{font-size:24px;font-weight:bold;margin:24px 0}
        .assinatura{margin-top:64px;border-top:1px solid #333;width:280px;text-align:center;padding-top:6px;font-size:13px}
      </style></head><body>
      <h1>${UI.escapar(cfg.nome_loja || 'Instituto')}</h1>
      <div class="sub">
        ${UI.escapar(cfg.loja_cnpj ? 'CNPJ: ' + cfg.loja_cnpj : '')}
        ${cfg.loja_endereco ? ' · ' + UI.escapar(cfg.loja_endereco) : ''}
      </div>
      <h2>RECIBO DE DOAÇÃO</h2>
      <div class="valor">${UI.moeda(o.valor)}</div>
      <p>Recebemos de <strong>${UI.escapar(doador)}</strong>${o.cpf ? ` (CPF/CNPJ ${UI.escapar(o.cpf)})` : ''}
      a importância de <strong>${UI.moeda(o.valor)}</strong>, a título de doação
      ${o.projeto_nome ? `destinada ao projeto <strong>${UI.escapar(o.projeto_nome)}</strong>` : 'para manutenção das atividades da instituição'},
      recebida em ${UI.dataHora(o.data)}${o.forma ? ` via ${UI.escapar(o.forma)}` : ''}.</p>
      <p>Por ser expressão da verdade, firmamos o presente recibo.</p>
      <div class="assinatura">
        ${UI.escapar(assinante ? assinante.nome : (cfg.nome_loja || 'Responsável'))}
        ${assinante ? `<br><span style="font-size:11px;color:#555">${UI.escapar(assinante.cargo)}</span>` : ''}
      </div>
      </body></html>`;

    try {
      await UI.baixarPDF(html, `recibo-doacao-${id}.pdf`);
      await API.post(`/api/arrecadacao/ofertas/${id}/recibo-emitido`);
      renderOfertas();
    } catch (e) { UI.erro(e.message); }
  }

  // -------------------------- Doações em espécie --------------------------
  async function renderEspecie() {
    const el = alvo();
    if (!el) return;
    el.innerHTML = barraPeriodo('es') + '<div class="card"><div id="es-lista">Carregando…</div></div>';
    document.getElementById('es-acoes').outerHTML = '<button class="btn" id="es-nova">+ Registrar doação</button>';
    document.getElementById('es-nova').addEventListener('click', formEspecie);
    ligarPeriodo('es', renderEspecie);

    let itens = [];
    try { itens = await API.get('/api/arrecadacao/doacoes-especie?' + query()); }
    catch (e) { document.getElementById('es-lista').innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    document.getElementById('es-lista').innerHTML = !itens.length
      ? `<div class="vazio"><h3>Nenhuma doação em espécie</h3>
          <p class="dica">Um violão doado não entra no caixa, mas precisa ser registrado — para agradecer, prestar contas e saber o que o instituto tem.</p></div>`
      : `<div class="rolagem"><table class="tabela">
          <thead><tr><th>Data</th><th>Doador</th><th>O que foi doado</th><th>Qtd.</th><th>Valor estimado</th><th></th></tr></thead>
          <tbody>
            ${itens.map((d) => `
              <tr>
                <td>${UI.dataHora(d.data)}</td>
                <td>${UI.escapar(d.mantenedor_nome || d.doador_nome || '—')}</td>
                <td>${UI.escapar(d.descricao)}
                  ${d.instrumento_nome ? ` <span class="badge badge--ok">${UI.escapar(d.instrumento_nome)}</span>` : ''}</td>
                <td>${UI.escapar(String(d.quantidade))}</td>
                <td>${d.valor_estimado ? UI.moeda(d.valor_estimado) : '—'}</td>
                <td style="text-align:right"><button class="btn btn--perigo" data-es-rm="${d.id}">Excluir</button></td>
              </tr>`).join('')}
          </tbody>
        </table></div>
        <p class="dica mt-16">Bens doados não movimentam o saldo das contas — por isso ficam fora do caixa e aparecem em separado na prestação de contas.</p>`;

    el.querySelectorAll('[data-es-rm]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir este registro de doação?', { titulo: 'Excluir', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`/api/arrecadacao/doacoes-especie/${b.dataset.esRm}`); UI.sucesso('Registro excluído.'); renderEspecie(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  async function formEspecie() {
    let instrumentos = [];
    try { instrumentos = await API.get('/api/instrumentos'); } catch (_) { instrumentos = []; }

    Modal.abrir({
      titulo: 'Registrar doação em espécie',
      textoConfirmar: 'Registrar',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo col-2"><label>Nome do doador *</label>
            <input id="esd-nome" placeholder="Ex.: Igreja Central" /></div>
          <div class="campo col-2"><label>O que foi doado *</label>
            <input id="esd-descricao" placeholder="Ex.: Violão infantil" /></div>
          <div class="campo"><label>Quantidade</label>
            <input id="esd-qtd" type="number" min="1" step="1" value="1" /></div>
          <div class="campo"><label>Valor estimado</label>
            <input id="esd-valor" type="number" min="0" step="0.01" placeholder="Opcional" /></div>
          <div class="campo"><label>Data *</label>
            <input id="esd-data" type="date" value="${hoje()}" /></div>
          <div class="campo"><label>Projeto</label>
            <select id="esd-projeto">
              <option value="">Nenhum</option>
              ${projetos.map((p) => `<option value="${p.id}">${UI.escapar(p.nome)}</option>`).join('')}
            </select></div>
          <div class="campo col-2" style="border-top:1px solid var(--borda);padding-top:14px">
            <label>É um instrumento do acervo?</label>
            <select id="esd-instrumento">
              <option value="">Não é instrumento</option>
              ${instrumentos.map((i) => `<option value="${i.id}">${UI.escapar(i.nome)} (hoje: ${i.quantidade_total})</option>`).join('')}
            </select>
            <label class="flex gap-12 mt-16" style="align-items:center">
              <input type="checkbox" id="esd-somar" checked /> Somar ao acervo (aumenta as vagas possíveis nas turmas)
            </label>
          </div>
          <div class="campo col-2"><label>Observação</label><textarea id="esd-obs" rows="2"></textarea></div>
        </div>`,
      aoConfirmar: async (el) => {
        try {
          await API.post('/api/arrecadacao/doacoes-especie', {
            doador_nome: el.querySelector('#esd-nome').value,
            descricao: el.querySelector('#esd-descricao').value,
            quantidade: el.querySelector('#esd-qtd').value,
            valor_estimado: el.querySelector('#esd-valor').value || null,
            data: el.querySelector('#esd-data').value,
            projeto_id: el.querySelector('#esd-projeto').value || null,
            instrumento_id: el.querySelector('#esd-instrumento').value || null,
            somar_ao_acervo: el.querySelector('#esd-somar').checked,
            observacao: el.querySelector('#esd-obs').value,
          });
          UI.sucesso('Doação registrada.');
          renderEspecie();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ----------------------------- Mantenedores -----------------------------
  async function renderMantenedores() {
    const el = alvo();
    if (!el) return;
    el.innerHTML = '<div class="card"><div id="mn-lista">Carregando…</div></div>';
    let lista = [];
    try { lista = await API.get('/api/arrecadacao/mantenedores'); }
    catch (e) { document.getElementById('mn-lista').innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    document.getElementById('mn-lista').innerHTML = !lista.length
      ? `<div class="vazio"><h3>Nenhum mantenedor</h3>
          <p class="dica">Marque uma pessoa como "mantenedor" no cadastro de Pessoas para ela aparecer aqui.</p></div>`
      : `<div class="rolagem"><table class="tabela">
          <thead><tr><th>Mantenedor</th><th>Contribuição mensal</th><th>Situação</th><th>Total doado</th><th>Última doação</th><th>Contato</th></tr></thead>
          <tbody>
            ${lista.map((m) => `
              <tr class="pi-clicavel" data-historico="${m.id}">
                <td><strong>${UI.escapar(m.nome)}</strong></td>
                <td>${m.contribuicao_mensal
                  ? `${UI.moeda(m.contribuicao_mensal)} <span class="dica">(dia ${m.dia_vencimento})</span>`
                  : '<span class="dica">avulso</span>'}</td>
                <td>${!m.contribuicao_mensal ? '<span class="dica">—</span>'
                  : m.contribuicoes_atrasadas > 0
                    ? `<span class="badge badge--alerta">${m.contribuicoes_atrasadas} atrasada(s)</span>`
                    : '<span class="badge badge--ok">em dia</span>'}</td>
                <td>${UI.moeda(m.total_doado || 0)}</td>
                <td class="dica">${m.ultima_doacao ? UI.dataHora(m.ultima_doacao) : '—'}</td>
                <td class="dica">${UI.escapar(m.telefone || m.email || '—')}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>
        <p class="dica mt-16">A contribuição mensal é lançada na aba "Contribuição mensal" e vira uma cobrança em "A receber" todo mês. Clique num mantenedor para ver o histórico de doações.</p>`;

    document.getElementById('mn-lista').querySelectorAll('[data-historico]').forEach((tr) => {
      tr.addEventListener('click', () => historicoMantenedor(Number(tr.dataset.historico)));
    });
  }

  /** Historico de doacoes do mantenedor: ofertas avulsas e cobrancas da contribuicao mensal. */
  async function historicoMantenedor(clienteId) {
    let d;
    try { d = await API.get(`/api/arrecadacao/mantenedores/${clienteId}/historico`); }
    catch (e) { UI.erro(e.message); return; }

    const STATUS_COBRANCA = { pendente: ['Pendente', 'alerta'], recebido: ['Recebido', 'ok'] };
    Modal.abrir({
      titulo: `Histórico — ${d.mantenedor.nome}`, tamanho: 'modal--grande', mostrarConfirmar: false,
      corpoHTML: `
        <h4 style="margin-top:0">Contribuição mensal</h4>
        ${d.cobrancas.length
          ? `<div class="rolagem"><table class="tabela">
              <thead><tr><th>Vencimento</th><th>Valor</th><th>Situação</th></tr></thead>
              <tbody>${d.cobrancas.map((c) => {
                const hoje = new Date().toISOString().slice(0, 10);
                const atrasada = c.status === 'pendente' && c.vencimento && c.vencimento < hoje;
                const [rot, cor] = STATUS_COBRANCA[c.status] || [c.status, 'muted'];
                return `<tr>
                  <td>${c.vencimento ? UI.dataHora(c.vencimento) : '—'}</td>
                  <td>${UI.moeda(c.valor)}</td>
                  <td><span class="badge badge--${atrasada ? 'erro' : cor}">${atrasada ? 'Atrasada' : rot}</span></td>
                </tr>`;
              }).join('')}</tbody>
            </table></div>`
          : '<p class="dica">Nenhuma contribuição mensal cadastrada.</p>'}

        <h4 class="mt-16">Doações avulsas <span class="dica">(total: ${UI.moeda(d.total_doado_avulso)})</span></h4>
        ${d.ofertas.length
          ? `<div class="rolagem"><table class="tabela">
              <thead><tr><th>Data</th><th>Valor</th><th>Forma</th><th>Projeto</th></tr></thead>
              <tbody>${d.ofertas.map((o) => `<tr>
                <td>${UI.dataHora(o.data)}</td>
                <td>${UI.moeda(o.valor)}</td>
                <td class="dica">${UI.escapar(FORMAS.find(([v]) => v === o.forma)?.[1] || o.forma || '—')}</td>
                <td class="dica">${UI.escapar(o.projeto_nome || '—')}</td>
              </tr>`).join('')}</tbody>
            </table></div>`
          : '<p class="dica">Nenhuma doação avulsa registrada.</p>'}`,
    });
  }

  // ------------------------------- Projetos -------------------------------
  async function renderProjetos() {
    const el = alvo();
    if (!el) return;
    el.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce"><strong>Projetos</strong>
          <div class="dica">Verba carimbada: amarrar entradas e despesas a um projeto é o que torna a prestação de contas possível.</div></div>
        <button class="btn" id="pj-novo">+ Novo projeto</button>
      </div>
      <div class="card"><div id="pj-lista">Carregando…</div></div>`;

    document.getElementById('pj-novo').addEventListener('click', () => {
      Modal.abrir({
        titulo: 'Novo projeto', textoConfirmar: 'Criar',
        corpoHTML: `<div class="campo"><label>Nome *</label><input id="pj-nome" placeholder="Ex.: Projeto Música na Escola" /></div>
          <div class="campo mt-16"><label>Descrição</label><textarea id="pj-desc" rows="2"></textarea></div>`,
        aoConfirmar: async (elm) => {
          try {
            await API.post('/api/arrecadacao/projetos', {
              nome: elm.querySelector('#pj-nome').value,
              descricao: elm.querySelector('#pj-desc').value,
            });
            await carregarProjetos();
            UI.sucesso('Projeto criado.');
            renderProjetos();
          } catch (e) { UI.erro(e.message); return false; }
        },
      });
    });

    let lista = [];
    try { lista = await API.get('/api/arrecadacao/projetos?incluir_inativos=1'); }
    catch (e) { document.getElementById('pj-lista').innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    document.getElementById('pj-lista').innerHTML = !lista.length
      ? '<div class="vazio"><h3>Nenhum projeto</h3><p class="dica">Se a arrecadação vier de editais, cadastre cada projeto aqui.</p></div>'
      : `<div class="rolagem"><table class="tabela">
          <thead><tr><th>Projeto</th><th>Arrecadado</th><th>Gasto</th><th>Saldo</th></tr></thead>
          <tbody>
            ${lista.map((p) => {
              const saldo = Number(p.arrecadado || 0) - Number(p.gasto || 0);
              return `<tr ${p.ativo ? '' : 'style="opacity:.55"'}>
                <td><strong>${UI.escapar(p.nome)}</strong>${p.ativo ? '' : ' <span class="badge badge--muted">inativo</span>'}
                  ${p.descricao ? `<div class="dica">${UI.escapar(p.descricao)}</div>` : ''}</td>
                <td>${UI.moeda(p.arrecadado || 0)}</td>
                <td>${UI.moeda(p.gasto || 0)}</td>
                <td><span class="badge ${saldo >= 0 ? 'badge--ok' : 'badge--erro'}">${UI.moeda(saldo)}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
        <p class="dica mt-16">O "gasto" vem das despesas marcadas com o projeto na aba Saídas.</p>`;
  }

  // -------------------------- Prestação de contas --------------------------
  async function renderContas() {
    const el = alvo();
    if (!el) return;
    el.innerHTML = barraPeriodo('pc') + '<div class="card"><div id="pc-corpo">Carregando…</div></div>';
    document.getElementById('pc-acoes').outerHTML = '<button class="btn btn--secundario" id="pc-pdf">⬇️ Baixar PDF</button>';
    ligarPeriodo('pc', renderContas);

    let d; let contas = [];
    try {
      [d, contas] = await Promise.all([
        API.get('/api/arrecadacao/prestacao-de-contas?' + query()),
        API.get('/api/financeiro/contas-financeiras').catch(() => []),
      ]);
    } catch (e) { document.getElementById('pc-corpo').innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    const saldoContas = contas.reduce((s, c) => s + Number(c.saldo_atual || 0), 0);
    document.getElementById('pc-corpo').innerHTML = corpoContas(d) + `
      <div class="card mt-16">
        <h4 style="margin-top:0">Conferência com o caixa</h4>
        <p class="dica">Saldo somado de todas as contas financeiras hoje:
          <strong style="color:${saldoContas >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(saldoContas)}</strong>.
          As ofertas do período já estão dentro desse saldo — se o número não bater com o extrato do banco,
          use a aba <strong>Conciliação</strong> antes de fechar a prestação de contas.</p>
      </div>`;
    document.getElementById('pc-pdf').addEventListener('click', async () => {
      let cfg = {};
      try { cfg = await API.get('/api/config'); } catch (_) { cfg = {}; }
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Prestação de contas</title>
        <style>body{font-family:Arial,sans-serif;padding:32px;color:#111}
        h1{font-size:20px;margin-bottom:2px}h2{font-size:15px;margin-top:24px}
        table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
        th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}
        .dica{color:#666;font-size:12px}</style></head><body>
        <h1>${UI.escapar(cfg.nome_loja || 'Instituto')}</h1>
        <div class="dica">Prestação de contas${d.projeto ? ' — ' + UI.escapar(d.projeto.nome) : ''}
          · Período: ${UI.escapar(d.periodo.de || 'início')} a ${UI.escapar(d.periodo.ate || 'hoje')}</div>
        ${corpoContas(d)}
        <p class="dica">Saldo em caixa/banco na emissão deste relatório: ${UI.moeda(saldoContas)}.</p>
        </body></html>`;
      try { await UI.baixarPDF(html, 'prestacao-de-contas.pdf'); } catch (e) { UI.erro(e.message); }
    });
  }

  function corpoContas(d) {
    return `
      <div class="flex gap-12" style="flex-wrap:wrap;margin-bottom:16px">
        <div class="card" style="flex:1;min-width:180px">
          <div class="dica">Entradas (ofertas)</div>
          <h3 style="margin:4px 0">${UI.moeda(d.entradas.total)}</h3>
          <div class="dica">${d.entradas.quantidade} doação(ões)</div>
        </div>
        <div class="card" style="flex:1;min-width:180px">
          <div class="dica">Despesas</div>
          <h3 style="margin:4px 0">${UI.moeda(d.despesas.total)}</h3>
          <div class="dica">${d.despesas.quantidade} lançamento(s)</div>
        </div>
        <div class="card" style="flex:1;min-width:180px">
          <div class="dica">Saldo do período</div>
          <h3 style="margin:4px 0;color:${d.saldo >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(d.saldo)}</h3>
        </div>
        <div class="card" style="flex:1;min-width:180px">
          <div class="dica">Alcance social</div>
          <h3 style="margin:4px 0">${d.alcance.alunos_atendidos} aluno(s)</h3>
          <div class="dica">${d.alcance.aulas_realizadas} aula(s) realizada(s)</div>
        </div>
      </div>

      <h4>Entradas por forma de recebimento</h4>
      ${d.entradas.por_forma.length
        ? `<table class="tabela"><thead><tr><th>Forma</th><th>Quantidade</th><th>Total</th></tr></thead><tbody>
            ${d.entradas.por_forma.map((f) => `<tr><td>${UI.escapar(f.forma)}</td><td>${f.quantidade}</td><td>${UI.moeda(f.total)}</td></tr>`).join('')}
          </tbody></table>`
        : '<p class="dica">Nenhuma entrada no período.</p>'}

      <h4 class="mt-16">Despesas por categoria</h4>
      ${d.despesas.por_categoria.length
        ? `<table class="tabela"><thead><tr><th>Categoria</th><th>Total</th></tr></thead><tbody>
            ${d.despesas.por_categoria.map((c) => `<tr><td>${UI.escapar(c.categoria)}</td><td>${UI.moeda(c.total)}</td></tr>`).join('')}
          </tbody></table>`
        : '<p class="dica">Nenhuma despesa no período.</p>'}

      <h4 class="mt-16">Doações em espécie</h4>
      <p class="dica">${d.doacoes_especie.quantidade} doação(ões) de bens, valor estimado ${UI.moeda(d.doacoes_especie.valor_estimado || 0)}.
      Não entram no caixa — são registradas à parte.</p>`;
  }

  return {
    montarEm,
    carregarProjetos,
    carregarContas,
    projetos: () => projetos,
    ofertas: renderOfertas,
    especie: renderEspecie,
    mantenedores: renderMantenedores,
    projetosSecao: renderProjetos,
    prestacaoDeContas: renderContas,
  };
})();
