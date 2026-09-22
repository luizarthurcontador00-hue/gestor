'use strict';

/**
 * Configuracoes da loja: dados que aparecem no cupom e nos relatorios, o
 * markup padrao usado na precificacao, modulo fiscal, aparencia e
 * integracoes. Organizado em abas (a tela crescia demais numa rolagem so).
 */
window.PaginaConfiguracoes = (function () {
  let abaAtual = 'loja';
  const ehInstituto = () => window.__ramoServico === 'instituto';
  // No instituto nao existe venda: o modulo fiscal (NF-e/NFC-e da venda) fica
  // fora, senao vira uma aba que nunca vai ser usada.
  const abas = () => [
    ['loja', ehInstituto() ? 'Instituto' : 'Loja'],
    ['pix', '💠 PIX'],
    ...(ehInstituto() ? [['documentos', '📄 Documentos']] : [['fiscal', '🧾 Fiscal']]),
    ['aparencia', '🎨 Aparência'],
    ['google', '📅 Google Agenda'],
    ['avisos', '🔔 Avisos automáticos'],
    // So no instituto: quem migrou de comercio/servico pode ter vendas de
    // teste do PDV que nunca vai usar de verdade — aqui da pra apagar sem
    // precisar reabrir o modulo de Vendas (que fica escondido do instituto).
    ...(ehInstituto() ? [['manutencao', '🧹 Dados de teste']] : []),
  ];

  async function render(container) {
    let cfg = {};
    try { cfg = await API.get('/api/config'); } catch (e) { /* usa vazio */ }

    const ABAS = abas();
    if (!ABAS.some(([id]) => id === abaAtual)) abaAtual = 'loja';

    container.innerHTML = `
      <div class="tabs">
        ${ABAS.map(([id, rotulo]) => `<div class="tab ${abaAtual === id ? 'ativo' : ''}" data-aba="${id}">${rotulo}</div>`).join('')}
      </div>
      <div id="cfg-conteudo"></div>`;

    container.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      abaAtual = t.dataset.aba;
      container.querySelectorAll('.tab').forEach((x) => x.classList.toggle('ativo', x === t));
      trocarAba(container, cfg);
    }));

    trocarAba(container, cfg);
  }

  function trocarAba(container, cfg) {
    const alvo = container.querySelector('#cfg-conteudo');
    if (abaAtual === 'pix') renderPix(alvo, cfg);
    else if (abaAtual === 'documentos') renderModelos(alvo);
    else if (abaAtual === 'fiscal') renderFiscal(alvo, cfg);
    else if (abaAtual === 'aparencia') renderAparencia(alvo, cfg, container);
    else if (abaAtual === 'google') renderGoogleAgenda(alvo);
    else if (abaAtual === 'avisos') renderAvisos(alvo);
    else if (abaAtual === 'manutencao') renderManutencao(alvo);
    else renderLoja(alvo, cfg, container);
  }

  // ------------------------------ Loja ------------------------------
  function renderLoja(alvo, cfg, container) {
    const inst = ehInstituto();
    // Instalações antigas gravaram "instituto" no ramo, com o perfil em
    // serviço/ambos. Aqui o instituto e uma categoria propria.
    const perfilAtual = cfg.ramo_servico === 'instituto' ? 'instituto' : (cfg.perfil_negocio || 'ambos');
    alvo.innerHTML = `
      <div class="card" style="max-width:640px">
        <h3 style="margin-top:0">${inst ? 'Dados do instituto' : 'Dados da loja'}</h3>
        <p class="dica">${inst
          ? 'Aparecem nos recibos de doação, nas atas, na prestação de contas e nos relatórios impressos.'
          : 'Aparecem no cupom de venda e nos relatórios impressos.'}</p>
        <form id="form-cfg" class="form-grid">
          <div class="campo col-2"><label>Tipo de atividade</label>
            <select name="perfil_negocio">
              <option value="comercio" ${perfilAtual === 'comercio' ? 'selected' : ''}>Comércio (produtos, estoque)</option>
              <option value="servico" ${perfilAtual === 'servico' ? 'selected' : ''}>Serviço (prestação de serviços)</option>
              <option value="ambos" ${perfilAtual === 'ambos' ? 'selected' : ''}>Comércio e Serviço</option>
              <option value="instituto" ${perfilAtual === 'instituto' ? 'selected' : ''}>🎼 Instituto / ONG (sem fins lucrativos)</option>
            </select>
            <span class="dica">Define quais módulos aparecem no menu. Recarrega o menu ao salvar.</span></div>
          <div class="campo col-2" id="cfg-ramo-wrap" style="display:${(perfilAtual === 'servico' || perfilAtual === 'ambos') ? '' : 'none'}">
            <label>Ramo de serviço</label>
            <select name="ramo_servico">
              <option value="salao" ${(cfg.ramo_servico || 'salao') === 'salao' ? 'selected' : ''}>💇 Salão / Barbearia / Estética</option>
              <option value="oficina" ${cfg.ramo_servico === 'oficina' ? 'selected' : ''}>🔧 Oficina / Assistência técnica</option>
              <option value="agencia_viagem" ${cfg.ramo_servico === 'agencia_viagem' ? 'selected' : ''}>✈️ Agência de viagem</option>
              <option value="professor" ${cfg.ramo_servico === 'professor' ? 'selected' : ''}>🎓 Professor particular / Aulas</option>
              <option value="creche" ${cfg.ramo_servico === 'creche' ? 'selected' : ''}>🧒 Creche / Escolinha infantil</option>
              <option value="geral" ${cfg.ramo_servico === 'geral' ? 'selected' : ''}>💼 Outros serviços</option>
            </select>
            <span class="dica">Refina o que aparece no menu — ex.: "Ordens & Orçamentos" (Pátio/OS) fica escondido para Salão.</span>
          </div>
          <div class="campo col-2" id="cfg-creche-turma-wrap" style="display:${cfg.ramo_servico === 'creche' ? '' : 'none'}">
            <label>As crianças são organizadas em turmas/salas?</label>
            <select name="creche_com_turma">
              <option value="1" ${(cfg.creche_com_turma ?? '1') === '1' ? 'selected' : ''}>Sim — turmas, matrícula e chamada por turma</option>
              <option value="0" ${cfg.creche_com_turma === '0' ? 'selected' : ''}>Não — horário fixo e chamada por criança</option>
            </select>
          </div>
          <div class="campo col-2 dica" id="cfg-instituto-aviso" style="display:${perfilAtual === 'instituto' ? '' : 'none'}">
            🎼 No modo Instituto o sistema não mostra venda, PDV, estoque nem lucro:
            as entradas são <strong>ofertas</strong>, as saídas são <strong>despesas</strong> e o
            resultado vira <strong>prestação de contas</strong>.
          </div>
          <div class="campo col-2"><label>${inst ? 'Nome do instituto' : 'Nome da loja'}</label><input name="nome_loja" value="${UI.escapar(cfg.nome_loja || '')}" /></div>
          <div class="campo"><label>Telefone</label><input name="loja_telefone" value="${UI.escapar(cfg.loja_telefone || '')}" /></div>
          <div class="campo"><label>CNPJ / CPF</label><input name="loja_cnpj" value="${UI.escapar(cfg.loja_cnpj || '')}" /></div>
          <div class="campo col-2"><label>Endereço</label><input name="loja_endereco" value="${UI.escapar(cfg.loja_endereco || '')}" /></div>
          <div class="campo col-2"><label>Cidade</label>
            <input name="loja_cidade" value="${UI.escapar(cfg.loja_cidade || '')}" placeholder="Ex.: Caldas Novas - GO" />
            <span class="dica">Abre os documentos assinados ("Caldas Novas - GO, 31 de julho de 2026").</span></div>
          ${inst ? '' : `
          <div class="campo col-2"><label>Mensagem no rodapé do cupom</label>
            <input name="loja_rodape_cupom" value="${UI.escapar(cfg.loja_rodape_cupom || 'Obrigado pela preferência!')}" /></div>
          <div class="campo"><label>Markup padrão (%)</label>
            <input name="markup_padrao" type="number" step="0.01" min="0" value="${cfg.markup_padrao != null ? cfg.markup_padrao : 100}" />
            <span class="dica">Usado no cálculo de preço quando o produto não tem markup próprio.</span></div>
          <div class="campo"><label>Meta mensal de faturamento (R$)</label>
            <input name="meta_mensal_faturamento" type="number" step="0.01" min="0" value="${cfg.meta_mensal_faturamento || ''}" placeholder="Ex.: 30000" />
            <span class="dica">Acompanhe o progresso na Central de Gestão (tela inicial).</span></div>
          <div class="campo col-2" style="border-top:1px solid var(--borda);padding-top:16px">
            <label class="flex gap-12" style="align-items:center">
              <input type="checkbox" name="gerar_codigo_auto" id="cfg-cod-auto" ${String(cfg.gerar_codigo_auto ?? '1') === '1' ? 'checked' : ''} />
              Gerar código de barras automaticamente ao importar produtos
            </label>
            <span class="dica">Ao cadastrar em lote ou importar por NF-e, produtos sem código de barras recebem um EAN-13 interno (para etiquetas e leitura no PDV).</span>
          </div>`}
          <div class="campo col-2"><button class="btn" type="submit">Salvar configurações</button></div>
        </form>
      </div>

      <div class="card mt-16" id="cfg-inicializacao-card" style="max-width:640px;display:none">
        <h3 style="margin-top:0">🖥️ Inicialização</h3>
        <p class="dica">Deixe o sistema sempre rodando em segundo plano (recebendo mensagens do WhatsApp, por exemplo) — abre sozinho, minimizado na bandeja, quando o computador ligar. O "X" da janela passa a só minimizar; use "Sair" no ícone da bandeja pra fechar de verdade.</p>
        <label class="flex gap-12" style="align-items:center">
          <input type="checkbox" id="cfg-auto-inicio" /> Iniciar automaticamente com o Windows
        </label>
      </div>`;

    if (window.appDesktop && window.appDesktop.obterInicializacaoAutomatica) {
      const cardIni = alvo.querySelector('#cfg-inicializacao-card');
      const checkIni = alvo.querySelector('#cfg-auto-inicio');
      cardIni.style.display = '';
      window.appDesktop.obterInicializacaoAutomatica().then((r) => { checkIni.checked = !!r.ativo; }).catch(() => {});
      checkIni.addEventListener('change', async (ev) => {
        try {
          await window.appDesktop.definirInicializacaoAutomatica(ev.target.checked);
          UI.sucesso(ev.target.checked ? 'Vai iniciar sozinho com o Windows, minimizado.' : 'Inicialização automática desativada.');
        } catch (e) {
          UI.erro(e.message);
          ev.target.checked = !ev.target.checked;
        }
      });
    }

    UI.ligarMascaraDocumento(alvo.querySelector('[name="loja_cnpj"]'));

    alvo.querySelector('select[name="perfil_negocio"]').addEventListener('change', (e) => {
      const ehInst = e.target.value === 'instituto';
      alvo.querySelector('#cfg-ramo-wrap').style.display = (e.target.value === 'servico' || e.target.value === 'ambos') ? '' : 'none';
      alvo.querySelector('#cfg-instituto-aviso').style.display = ehInst ? '' : 'none';
    });
    alvo.querySelector('select[name="ramo_servico"]').addEventListener('change', (e) => {
      alvo.querySelector('#cfg-creche-turma-wrap').style.display = e.target.value === 'creche' ? '' : 'none';
    });

    alvo.querySelector('#form-cfg').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(ev.target).entries());
      // O instituto define o ramo sozinho — nao existe ONG "de salao".
      // (O select de ramo fica escondido nesse caso, mas ainda vem no FormData.)
      if (body.perfil_negocio === 'instituto') body.ramo_servico = 'instituto';
      // Checkbox nao marcado nao entra no FormData: normaliza para '0'/'1'.
      // (No instituto esse campo nem existe — nao ha produto para etiquetar.)
      const codAuto = ev.target.querySelector('#cfg-cod-auto');
      if (codAuto) body.gerar_codigo_auto = codAuto.checked ? '1' : '0';
      try {
        await API.put('/api/config', body);
        Object.assign(cfg, body);
        UI.sucesso('Configurações salvas.');
        if (window.__recarregarPerfil) await window.__recarregarPerfil();
      } catch (e) { UI.erro(e.message); }
    });
  }

  // ------------------------------ PIX ------------------------------
  // ------------------------ Modelos de documento ------------------------

  /**
   * O texto de cada documento fica editável: cada instituto tem a redação
   * que o estatuto, o contador ou a prefeitura pedem. Os dados entram por
   * marcadores, preenchidos na hora de emitir.
   */
  async function renderModelos(alvo) {
    alvo.innerHTML = '<div class="card">Carregando…</div>';
    let modelos = [];
    try { modelos = await API.get('/api/instituto/modelos'); }
    catch (e) { alvo.innerHTML = `<div class="card"><p class="dica">${UI.escapar(e.message)}</p></div>`; return; }

    alvo.innerHTML = `
      <p class="dica">Escreva aqui o texto que o seu instituto usa. Onde entrar um dado, use o marcador
      correspondente — o sistema troca pelo valor na hora de gerar o PDF. Deixe uma linha em branco entre
      parágrafos e use <code>**texto**</code> para negrito.</p>
      ${modelos.map((m) => `
        <div class="card mt-16" data-modelo="${m.chave}">
          <div class="flex flex--between" style="align-items:flex-start;flex-wrap:wrap;gap:8px">
            <div class="cresce">
              <h3 style="margin:0">${UI.escapar(m.titulo)}
                ${m.personalizado ? '<span class="badge badge--ok">seu texto</span>' : '<span class="badge badge--muted">texto padrão</span>'}</h3>
              <p class="dica" style="margin:4px 0 0">${UI.escapar(m.descricao)}</p>
            </div>
          </div>
          <details class="mt-16">
            <summary class="dica" style="cursor:pointer">Marcadores disponíveis (${m.marcadores.length})</summary>
            <div class="mt-16" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:6px">
              ${m.marcadores.map((mk) => `
                <div class="dica"><code class="marcador" data-inserir="${m.chave}" data-valor="{{${mk.marcador}}}"
                  style="cursor:pointer">{{${mk.marcador}}}</code> ${UI.escapar(mk.descricao)}</div>`).join('')}
            </div>
            <p class="dica mt-16">Clique num marcador para inseri-lo onde o cursor estiver.</p>
          </details>
          <div class="campo mt-16">
            <textarea data-corpo="${m.chave}" rows="14" style="font-family:Menlo,Consolas,monospace;font-size:12.5px;line-height:1.6">${UI.escapar(m.corpo)}</textarea>
          </div>
          <div class="flex gap-12" style="flex-wrap:wrap">
            <button class="btn" data-salvar="${m.chave}">Salvar modelo</button>
            <button class="btn btn--secundario" data-restaurar="${m.chave}" ${m.personalizado ? '' : 'disabled'}>Restaurar padrão</button>
            <div class="cresce"></div>
            ${m.atualizado_em ? `<span class="dica" style="align-self:center">editado em ${UI.escapar(m.atualizado_em)}</span>` : ''}
          </div>
        </div>`).join('')}`;

    alvo.querySelectorAll('[data-inserir]').forEach((c) => c.addEventListener('click', () => {
      const area = alvo.querySelector(`[data-corpo="${c.dataset.inserir}"]`);
      if (!area) return;
      const pos = area.selectionStart ?? area.value.length;
      area.value = area.value.slice(0, pos) + c.dataset.valor + area.value.slice(area.selectionEnd ?? pos);
      area.focus();
      area.selectionStart = pos + c.dataset.valor.length;
      area.selectionEnd = area.selectionStart;
    }));

    alvo.querySelectorAll('[data-salvar]').forEach((b) => b.addEventListener('click', async () => {
      const chave = b.dataset.salvar;
      const corpo = alvo.querySelector(`[data-corpo="${chave}"]`).value;
      try {
        const r = await API.put(`/api/instituto/modelos/${chave}`, { corpo });
        if (r.avisos && r.avisos.length) {
          UI.erro(`Modelo salvo, mas há marcador que o sistema não conhece: ${r.avisos.map((a) => `{{${a}}}`).join(', ')}. Ele vai sair como "—" no PDF.`);
        } else {
          UI.sucesso('Modelo salvo.');
        }
        renderModelos(alvo);
      } catch (e) { UI.erro(e.message); }
    }));

    alvo.querySelectorAll('[data-restaurar]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Voltar ao texto padrão do sistema? O texto que você escreveu será perdido.',
        { titulo: 'Restaurar padrão', textoConfirmar: 'Restaurar' });
      if (!ok) return;
      try { await API.post(`/api/instituto/modelos/${b.dataset.restaurar}/restaurar`, {}); UI.sucesso('Texto padrão restaurado.'); renderModelos(alvo); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  function renderPix(alvo, cfg) {
    alvo.innerHTML = `
      <div class="card" style="max-width:640px">
        <h3 style="margin-top:0">💠 Recebimento via PIX</h3>
        <p class="dica">Usado para gerar a cobrança com QR Code PIX em Financeiro → A Receber. O sistema não guarda dinheiro nem se conecta a banco nenhum — ele só monta o QR a partir da sua chave.</p>
        <form id="form-pix" class="form-grid">
          <div class="campo col-2"><label>Chave PIX</label>
            <input name="pix_chave" value="${UI.escapar(cfg.pix_chave || '')}" placeholder="CPF/CNPJ, e-mail, celular ou chave aleatória" /></div>
          <div class="campo"><label>Nome do recebedor</label>
            <input name="pix_nome_recebedor" maxlength="25" value="${UI.escapar(cfg.pix_nome_recebedor || '')}" placeholder="Como aparece no banco (máx. 25 caracteres)" /></div>
          <div class="campo"><label>Cidade</label>
            <input name="pix_cidade" maxlength="15" value="${UI.escapar(cfg.pix_cidade || '')}" placeholder="Máx. 15 caracteres" /></div>
          <div class="campo col-2"><button class="btn" type="submit">Salvar chave PIX</button></div>
        </form>
      </div>`;

    alvo.querySelector('#form-pix').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(ev.target).entries());
      try {
        await API.put('/api/config', body);
        Object.assign(cfg, body);
        UI.sucesso('Chave PIX salva.');
      } catch (e) { UI.erro(e.message); }
    });
  }

  // --------------------------- Módulo Fiscal ---------------------------
  function renderFiscal(alvo, cfg) {
    alvo.innerHTML = `
      <div class="card" style="max-width:640px">
        <div class="flex flex--between" style="align-items:center">
          <h3 style="margin:0">🧾 Módulo Fiscal</h3>
          <span id="fis-status" class="badge badge--muted">verificando…</span>
        </div>
        <p class="dica">Emissão de NFC-e/NF-e/NFS-e via um gateway externo (hoje, Focus NFe). O sistema não guarda seu certificado digital — isso fica no painel do próprio gateway. Aqui você só conecta com o token de acesso.</p>
        <form id="form-fiscal" class="form-grid">
          <div class="campo"><label>Regime tributário</label>
            <select name="fiscal_regime_tributario">
              <option value="">— selecione —</option>
              <option value="simples_nacional" ${cfg.fiscal_regime_tributario === 'simples_nacional' ? 'selected' : ''}>Simples Nacional</option>
              <option value="lucro_presumido" ${cfg.fiscal_regime_tributario === 'lucro_presumido' ? 'selected' : ''}>Lucro Presumido</option>
              <option value="lucro_real" ${cfg.fiscal_regime_tributario === 'lucro_real' ? 'selected' : ''}>Lucro Real</option>
              <option value="mei" ${cfg.fiscal_regime_tributario === 'mei' ? 'selected' : ''}>MEI</option>
            </select></div>
          <div class="campo"><label>Ambiente</label>
            <select name="fiscal_ambiente">
              <option value="homologacao" ${(cfg.fiscal_ambiente || 'homologacao') === 'homologacao' ? 'selected' : ''}>Homologação (testes, não vale fiscalmente)</option>
              <option value="producao" ${cfg.fiscal_ambiente === 'producao' ? 'selected' : ''}>Produção (notas reais)</option>
            </select></div>
          <div class="campo"><label>Inscrição estadual</label><input name="fiscal_inscricao_estadual" value="${UI.escapar(cfg.fiscal_inscricao_estadual || '')}" placeholder="Necessária para NFC-e/NF-e" /></div>
          <div class="campo"><label>Inscrição municipal</label><input name="fiscal_inscricao_municipal" value="${UI.escapar(cfg.fiscal_inscricao_municipal || '')}" placeholder="Necessária para NFS-e" /></div>
          <div class="campo col-2"><label>Gateway de emissão</label>
            <select name="fiscal_gateway">
              <option value="focusnfe" ${(cfg.fiscal_gateway || 'focusnfe') === 'focusnfe' ? 'selected' : ''}>Focus NFe</option>
            </select>
            <span class="dica">Por enquanto o sistema só integra com o Focus NFe (focusnfe.com.br). Crie uma conta lá, cadastre o CNPJ e envie o certificado digital pelo painel deles.</span></div>
          <div class="campo col-2"><label>Token de acesso (Focus NFe)</label><input name="fiscal_token" type="password" value="${UI.escapar(cfg.fiscal_token || '')}" placeholder="Copie do painel do Focus NFe" /></div>
          <div class="campo col-2"><button class="btn" type="submit">Salvar módulo fiscal</button></div>
        </form>
      </div>`;

    alvo.querySelector('#form-fiscal').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(ev.target).entries());
      try {
        await API.put('/api/config', body);
        Object.assign(cfg, body);
        UI.sucesso('Módulo fiscal salvo.');
        atualizarStatusFiscal();
      } catch (e) { UI.erro(e.message); }
    });
    async function atualizarStatusFiscal() {
      const badge = alvo.querySelector('#fis-status');
      if (!badge) return;
      try {
        const r = await API.get('/api/fiscal/status');
        badge.textContent = r.configurado ? '✅ Configurado' : '⚠️ Não configurado';
        badge.className = 'badge ' + (r.configurado ? 'badge--ok' : 'badge--muted');
      } catch (e) { badge.textContent = '—'; }
    }
    atualizarStatusFiscal();
    renderNFSe(alvo, cfg);
  }

  // ------------------------------ NFS-e (Portal Nacional) ------------------------------
  function renderNFSe(container, cfg) {
    const card = document.createElement('div');
    card.className = 'card mt-16';
    card.style.maxWidth = '640px';
    card.innerHTML = `
      <div class="flex flex--between" style="align-items:center">
        <h3 style="margin:0">🏛️ NFS-e — Portal Nacional</h3>
        <span id="nfse-status" class="badge badge--muted">verificando…</span>
      </div>
      <p class="dica">Emissão de NFS-e (nota de serviço) <strong>direto pela Receita</strong>, sem gateway — o sistema guarda seu certificado digital A1 e assina a nota sozinho. Teste sempre em "Produção Restrita" antes de trocar para produção de verdade.</p>
      <div id="nfse-cert-info"></div>
      <form id="form-nfse-cert" class="form-grid mt-16">
        <div class="campo"><label>Certificado digital (.pfx / .p12)</label><input type="file" name="certificado" accept=".pfx,.p12" /></div>
        <div class="campo"><label>Senha do certificado</label><input type="password" name="senha" placeholder="Deixe em branco para manter a atual" /></div>
        <div class="campo col-2"><button class="btn btn--secundario" type="submit">Salvar certificado</button></div>
      </form>
      <form id="form-nfse" class="form-grid mt-16">
        <div class="campo"><label>Ambiente</label>
          <select name="fiscal_nfse_ambiente">
            <option value="homologacao" ${(cfg.fiscal_nfse_ambiente || 'homologacao') === 'homologacao' ? 'selected' : ''}>Produção Restrita (testes, não vale fiscalmente)</option>
            <option value="producao" ${cfg.fiscal_nfse_ambiente === 'producao' ? 'selected' : ''}>Produção (notas reais)</option>
          </select></div>
        <div class="campo"><label>Código do município (IBGE)</label>
          <input name="fiscal_nfse_municipio_ibge" value="${UI.escapar(cfg.fiscal_nfse_municipio_ibge || '')}" maxlength="7" placeholder="Ex.: 5212501" />
          <span class="dica">Município onde o CNPJ está cadastrado como prestador.</span></div>
        <div class="campo"><label>Situação no Simples Nacional</label>
          <select name="fiscal_nfse_op_simples_nacional">
            <option value="1" ${cfg.fiscal_nfse_op_simples_nacional === '1' ? 'selected' : ''}>Não optante</option>
            <option value="2" ${cfg.fiscal_nfse_op_simples_nacional === '2' ? 'selected' : ''}>Optante — MEI</option>
            <option value="3" ${(cfg.fiscal_nfse_op_simples_nacional || '3') === '3' ? 'selected' : ''}>Optante — ME/EPP</option>
          </select></div>
        <div class="campo"><label>Regime especial de tributação</label>
          <select name="fiscal_nfse_regime_especial_trib">
            <option value="0" ${(cfg.fiscal_nfse_regime_especial_trib || '0') === '0' ? 'selected' : ''}>Nenhum</option>
            <option value="1" ${cfg.fiscal_nfse_regime_especial_trib === '1' ? 'selected' : ''}>Ato Cooperado (Cooperativa)</option>
            <option value="2" ${cfg.fiscal_nfse_regime_especial_trib === '2' ? 'selected' : ''}>Estimativa</option>
            <option value="3" ${cfg.fiscal_nfse_regime_especial_trib === '3' ? 'selected' : ''}>Microempresa Municipal</option>
            <option value="4" ${cfg.fiscal_nfse_regime_especial_trib === '4' ? 'selected' : ''}>Notário ou Registrador</option>
            <option value="5" ${cfg.fiscal_nfse_regime_especial_trib === '5' ? 'selected' : ''}>Profissional Autônomo</option>
            <option value="6" ${cfg.fiscal_nfse_regime_especial_trib === '6' ? 'selected' : ''}>Sociedade de Profissionais</option>
            <option value="9" ${cfg.fiscal_nfse_regime_especial_trib === '9' ? 'selected' : ''}>Outros</option>
          </select></div>
        <div class="campo col-2"><button class="btn" type="submit">Salvar dados do prestador</button></div>
      </form>`;
    container.appendChild(card);

    card.querySelector('#form-nfse-cert').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const form = ev.target;
      const arquivo = form.certificado.files[0];
      const senha = form.senha.value;
      if (!arquivo && !senha) { UI.erro('Selecione o certificado e informe a senha.'); return; }
      if (!arquivo) { UI.erro('Selecione o arquivo do certificado.'); return; }
      if (!senha) { UI.erro('Informe a senha do certificado.'); return; }
      const fd = new FormData();
      fd.append('certificado', arquivo);
      fd.append('senha', senha);
      try {
        await API.post('/api/fiscal/nfse/certificado', fd);
        UI.sucesso('Certificado salvo.');
        form.reset();
        atualizarStatusNfse();
      } catch (e) { UI.erro(e.message); }
    });

    card.querySelector('#form-nfse').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(ev.target).entries());
      try {
        await API.put('/api/config', body);
        Object.assign(cfg, body);
        UI.sucesso('Dados do prestador (NFS-e) salvos.');
        atualizarStatusNfse();
      } catch (e) { UI.erro(e.message); }
    });

    async function atualizarStatusNfse() {
      const badge = card.querySelector('#nfse-status');
      const info = card.querySelector('#nfse-cert-info');
      if (!badge) return;
      try {
        const r = await API.get('/api/fiscal/nfse/status');
        badge.textContent = r.configurado ? '✅ Configurado' : '⚠️ Não configurado';
        badge.className = 'badge ' + (r.configurado ? 'badge--ok' : 'badge--muted');
        if (r.certificado) {
          const exp = r.certificado.expirado ? '<span class="badge badge--erro">expirado</span>' : '<span class="badge badge--ok">válido</span>';
          info.innerHTML = `<p class="dica">Certificado: <strong>${UI.escapar(r.certificado.titular || '—')}</strong> — válido até ${UI.escapar(r.certificado.valido_ate)} ${exp}</p>`;
        } else {
          info.innerHTML = '';
        }
      } catch (e) { badge.textContent = '—'; }
    }
    atualizarStatusNfse();
  }

  // ------------------------------ Aparência ------------------------------
  function renderAparencia(alvo, cfg, container) {
    alvo.innerHTML = `
      <div class="card" style="max-width:640px">
        <h3 style="margin-top:0">🎨 Aparência</h3>
        <p class="dica">Deixe o sistema com a cara da sua loja: logo, cor e tamanho da fonte.</p>
        <form id="form-aparencia" class="form-grid">
          <div class="campo col-2"><label>Logo da loja</label>
            <div class="flex gap-12" style="align-items:center">
              <div class="cfg-logo-preview" id="ap-logo-prev">${cfg.loja_logo ? `<img src="${cfg.loja_logo}">` : '🏪'}</div>
              <div>
                <input type="file" id="ap-logo-file" accept="image/*" />
                <div class="mt-16"><label class="dica"><input type="checkbox" id="ap-logo-remover"> Remover logo</label></div>
                <div class="dica">Aparece no menu lateral e nos impressos. Prefira PNG quadrado.</div>
              </div>
            </div>
          </div>
          <div class="campo"><label>Cor principal</label>
            <input type="color" id="ap-cor" value="${UI.escapar(cfg.cor_primaria || '#2563eb')}" style="width:80px;height:40px;padding:2px" />
            <span class="dica">Cor dos botões e destaques.</span></div>
          <div class="campo"><label>Tamanho da fonte</label>
            <select id="ap-fonte">
              ${[['pequeno', 'Pequeno'], ['normal', 'Normal'], ['grande', 'Grande'], ['maior', 'Maior']].map(([v, t]) => `<option value="${v}" ${(cfg.fonte_escala || 'normal') === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select></div>
          <div class="campo"><label>Tema</label>
            <select id="ap-tema">
              <option value="claro" ${(cfg.tema || 'claro') === 'claro' ? 'selected' : ''}>☀️ Claro</option>
              <option value="escuro" ${cfg.tema === 'escuro' ? 'selected' : ''}>🌙 Escuro</option>
            </select></div>
          <div class="campo col-2 flex gap-12">
            <button class="btn" type="submit">Salvar aparência</button>
            <button class="btn btn--secundario" type="button" id="ap-restaurar">Restaurar padrão</button>
          </div>
        </form>
      </div>`;

    let logoNovo = null; // dataURL do logo escolhido nesta sessão
    const fileInput = alvo.querySelector('#ap-logo-file');
    fileInput.addEventListener('change', () => {
      const arq = fileInput.files[0];
      if (!arq) return;
      if (arq.size > 2 * 1024 * 1024) { UI.erro('Imagem muito grande (máx. 2 MB).'); fileInput.value = ''; return; }
      const reader = new FileReader();
      reader.onload = () => {
        logoNovo = reader.result;
        alvo.querySelector('#ap-logo-prev').innerHTML = `<img src="${logoNovo}">`;
        alvo.querySelector('#ap-logo-remover').checked = false;
      };
      reader.readAsDataURL(arq);
    });

    alvo.querySelector('#form-aparencia').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const remover = alvo.querySelector('#ap-logo-remover').checked;
      const body = {
        cor_primaria: alvo.querySelector('#ap-cor').value,
        fonte_escala: alvo.querySelector('#ap-fonte').value,
        tema: alvo.querySelector('#ap-tema').value,
      };
      if (remover) body.loja_logo = '';
      else if (logoNovo) body.loja_logo = logoNovo;
      try {
        await API.put('/api/config', body);
        UI.sucesso('Aparência salva.');
        if (window.__recarregarPerfil) await window.__recarregarPerfil();
      } catch (e) { UI.erro(e.message); }
    });

    alvo.querySelector('#ap-restaurar').addEventListener('click', async () => {
      try {
        await API.put('/api/config', { cor_primaria: '#2563eb', fonte_escala: 'normal', tema: 'claro', loja_logo: '' });
        UI.sucesso('Aparência restaurada.');
        if (window.__recarregarPerfil) await window.__recarregarPerfil();
        render(container);
      } catch (e) { UI.erro(e.message); }
    });
  }

  // ------------------------ Google Agenda ------------------------
  function renderGoogleAgenda(alvo) {
    alvo.innerHTML = `
      <div class="card" style="max-width:640px">
        <div class="flex flex--between" style="align-items:center">
          <h3 style="margin:0">📅 Google Agenda</h3>
          <span id="ga-status" class="badge badge--muted">verificando…</span>
        </div>
        <p class="dica">Envia automaticamente para o Google Agenda tudo que for criado, editado ou cancelado na Agenda do sistema — assim os compromissos também aparecem no celular, com o lembrete do próprio Google. É uma via só: o que for criado direto no Google não volta para o sistema.</p>

        <div id="ga-cred-wrap">
          <form id="form-ga-cred" class="form-grid">
            <div class="campo col-2"><label>Client ID (Google Cloud Console)</label>
              <input name="client_id" placeholder="xxxxxxxxxxxx.apps.googleusercontent.com" /></div>
            <div class="campo col-2"><label>Client Secret</label>
              <input name="client_secret" type="password" placeholder="Gerado junto com o Client ID" /></div>
            <div class="campo col-2"><button class="btn btn--secundario" type="submit">Salvar credenciais</button></div>
          </form>
          <p class="dica">Credenciais criadas uma única vez, gratuitamente, no Google Cloud Console (console.cloud.google.com): habilite a "Google Calendar API" e crie um "ID do cliente OAuth" do tipo "App para computador". Fale com seu contador ou suporte técnico se tiver dúvida nesse passo.</p>
        </div>

        <div class="flex gap-12 mt-16" style="align-items:center;flex-wrap:wrap">
          <button class="btn" id="ga-conectar" type="button">Conectar conta Google</button>
          <button class="btn btn--secundario" id="ga-desconectar" type="button" style="display:none">Desconectar</button>
          <label class="flex gap-12" id="ga-ativo-wrap" style="align-items:center;display:none">
            <input type="checkbox" id="ga-ativo" /> Sincronizar automaticamente
          </label>
        </div>
        <p class="dica" id="ga-erro" style="display:none;color:#dc2626"></p>
      </div>`;

    async function atualizarStatusGoogle() {
      const badge = alvo.querySelector('#ga-status');
      const erroEl = alvo.querySelector('#ga-erro');
      if (!badge) return;
      let st;
      try { st = await API.get('/api/google-agenda/status'); } catch (e) { badge.textContent = '—'; return; }

      badge.textContent = st.conectado ? `✅ ${st.email || 'Conectado'}` : (st.configurado ? '⚠️ Não conectado' : '⚪ Não configurado');
      badge.className = 'badge ' + (st.conectado ? 'badge--ok' : 'badge--muted');

      alvo.querySelector('#ga-desconectar').style.display = st.conectado ? '' : 'none';
      alvo.querySelector('#ga-ativo-wrap').style.display = st.conectado ? '' : 'none';
      alvo.querySelector('#ga-ativo').checked = !!st.ativo;
      alvo.querySelector('#ga-conectar').textContent = st.conectado ? 'Reconectar conta Google' : 'Conectar conta Google';

      if (st.ultimoErro) {
        erroEl.style.display = '';
        erroEl.textContent = st.ultimoErro;
      } else {
        erroEl.style.display = 'none';
      }
    }

    alvo.querySelector('#form-ga-cred').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(ev.target).entries());
      try {
        await API.post('/api/google-agenda/credenciais', body);
        UI.sucesso('Credenciais salvas.');
        await atualizarStatusGoogle();
      } catch (e) { UI.erro(e.message); }
    });

    alvo.querySelector('#ga-conectar').addEventListener('click', async () => {
      const btn = alvo.querySelector('#ga-conectar');
      btn.disabled = true;
      const textoOriginal = btn.textContent;
      btn.textContent = 'Aguardando login no navegador…';
      try {
        await API.post('/api/google-agenda/conectar');
        UI.sucesso('Conta Google conectada!');
      } catch (e) {
        UI.erro(e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = textoOriginal;
        await atualizarStatusGoogle();
      }
    });

    alvo.querySelector('#ga-desconectar').addEventListener('click', async () => {
      const ok = await UI.confirmar('Desconectar a conta Google? A sincronização será desligada.');
      if (!ok) return;
      try {
        await API.post('/api/google-agenda/desconectar');
        UI.sucesso('Conta Google desconectada.');
        await atualizarStatusGoogle();
      } catch (e) { UI.erro(e.message); }
    });

    alvo.querySelector('#ga-ativo').addEventListener('change', async (ev) => {
      try {
        await API.post('/api/google-agenda/ativo', { ativo: ev.target.checked });
        UI.sucesso(ev.target.checked ? 'Sincronização automática ativada.' : 'Sincronização automática desativada.');
      } catch (e) {
        UI.erro(e.message);
        ev.target.checked = !ev.target.checked;
      }
    });

    atualizarStatusGoogle();
  }

  // ------------------------ Avisos automáticos ------------------------
  function renderAvisos(alvo) {
    alvo.innerHTML = `
      <div class="card" style="max-width:640px">
        <h3 style="margin-top:0">🔔 Avisos automáticos por WhatsApp</h3>
        <p class="dica">O sistema pode avisar sozinho os responsáveis. Nada é enviado sem você ligar aqui — e cada aviso sai uma única vez por pessoa.</p>
        <p class="dica" style="color:var(--alerta)">⚠️ É uma automação sobre o WhatsApp Web. Use com moderação: disparo em massa não solicitado pode fazer o WhatsApp bloquear o número do instituto.</p>

        <div class="campo mt-16">
          <label class="flex gap-12" style="align-items:center">
            <input type="checkbox" id="av-aula" /> Confirmar a aula do dia seguinte
          </label>
          <span class="dica">Manda uma mensagem ao responsável na véspera, perguntando se o aluno vem. É o que mais reduz falta.</span>
        </div>

        <div class="campo mt-16">
          <label class="flex gap-12" style="align-items:center">
            <input type="checkbox" id="av-emprestimo" /> Cobrar instrumento não devolvido
          </label>
          <span class="dica">Uma vez por dia enquanto o empréstimo estiver atrasado.</span>
        </div>

        <div class="campo mt-16" style="max-width:200px">
          <label>Horário do envio</label>
          <input type="time" id="av-hora" />
          <span class="dica">Os avisos saem a partir deste horário.</span>
        </div>

        <div id="av-previa" class="dica mt-16"></div>
        <div class="campo mt-16"><button class="btn" type="button" id="av-salvar">Salvar</button></div>
      </div>`;

    async function carregar() {
      let d;
      try { d = await API.get('/api/avisos/whatsapp'); } catch (e) { UI.erro(e.message); return; }
      alvo.querySelector('#av-aula').checked = !!d.aulaAtivo;
      alvo.querySelector('#av-emprestimo').checked = !!d.emprestimoAtivo;
      alvo.querySelector('#av-hora').value = d.hora || '09:00';
      alvo.querySelector('#av-previa').innerHTML = (d.aulaAtivo || d.emprestimoAtivo)
        ? `Agora mesmo sairiam: <strong>${d.aulas_amanha}</strong> aviso(s) de aula e <strong>${d.emprestimos_atrasados}</strong> cobrança(s) de instrumento.`
        : '';
    }

    alvo.querySelector('#av-salvar').addEventListener('click', async () => {
      try {
        await API.put('/api/avisos/whatsapp', {
          aulaAtivo: alvo.querySelector('#av-aula').checked,
          emprestimoAtivo: alvo.querySelector('#av-emprestimo').checked,
          hora: alvo.querySelector('#av-hora').value,
        });
        UI.sucesso('Avisos automáticos salvos.');
        carregar();
      } catch (e) { UI.erro(e.message); }
    });

    carregar();
  }

  // ------------------------ Dados de teste (instituto) ------------------------
  /**
   * O modulo de Vendas fica escondido do menu no instituto (nao existe venda
   * sem fins lucrativos), mas quem migrou de comercio/servico para instituto
   * pode ter vendas de teste do PDV que nunca vai usar de verdade. Como a
   * tela de Vendas nao e mais navegavel, essa e a unica porta pra apagar
   * esse resto sem reabrir o modulo inteiro.
   */
  async function renderManutencao(alvo) {
    alvo.innerHTML = `
      <div class="card" style="max-width:780px">
        <h3 style="margin-top:0">🧹 Vendas de teste</h3>
        <p class="dica">Vendas feitas no PDV antes de configurar o instituto (que não usa venda). Excluir aqui devolve o estoque e desfaz qualquer lançamento financeiro gerado — e apaga o registro de vez, sem volta.</p>
        <div id="mnt-lista" class="mt-16">Carregando…</div>
      </div>`;

    let vendas;
    try { vendas = await API.get('/api/vendas'); }
    catch (e) { alvo.querySelector('#mnt-lista').innerHTML = UI.escapar(e.message); return; }

    desenharListaVendas(alvo, vendas);
  }

  function desenharListaVendas(alvo, vendas) {
    const lista = alvo.querySelector('#mnt-lista');
    if (!vendas.length) { lista.innerHTML = '<p class="muted">Nenhuma venda no sistema. 👍</p>'; return; }
    lista.innerHTML = `<table class="tabela">
      <thead><tr><th>#</th><th>Data</th><th>Itens</th><th>Total</th><th>Status</th><th></th></tr></thead>
      <tbody>${vendas.map((v) => `<tr>
        <td>${v.id}</td>
        <td>${UI.dataHora(v.data)}</td>
        <td>${v.total_itens}</td>
        <td>${UI.moeda(v.valor_total)}</td>
        <td>${v.status === 'concluida' ? '<span class="badge badge--ok">Concluída</span>' : '<span class="badge badge--muted">Cancelada</span>'}</td>
        <td style="text-align:right"><button class="btn btn--perigo" data-mnt-excluir="${v.id}">🗑️ Excluir</button></td>
      </tr>`).join('')}</tbody></table>`;

    lista.querySelectorAll('[data-mnt-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir esta venda de teste? Devolve o estoque e desfaz o financeiro dela; o registro some de vez.', { titulo: 'Excluir venda', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try {
        await API.del(`/api/vendas/${b.dataset.mntExcluir}`);
        UI.sucesso('Venda excluída.');
        const restantes = vendas.filter((v) => String(v.id) !== b.dataset.mntExcluir);
        vendas.length = 0; vendas.push(...restantes);
        desenharListaVendas(alvo, vendas);
      } catch (e) { UI.erro(e.message); }
    }));
  }

  return { titulo: 'Configurações', render };
})();
