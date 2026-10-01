'use strict';

/**
 * Atendimento via WhatsApp Web: inbox + conversa lado a lado (sem popup),
 * abas Contatos / Pendentes / Em atendimento, bot configuravel de primeiro
 * atendimento, envio de texto/anexo/audio gravado, respostas rapidas por
 * "/atalho", indicador de digitando e encerramento formal do atendimento
 * (com reabertura automatica se o contato escrever de novo). Disponivel
 * para qualquer tipo de negocio (nao depende de perfil/ramo).
 */
window.PaginaAtendimento = (function () {
  const CHAVE_ATENDENTE = 'wa_atendente_atual';

  let statusAtual = { estado: 'desconectado', qr: null };
  let conversas = [];
  let contatos = [];
  let respostasRapidas = [];
  let responsaveis = [];
  let servicosAgenda = [];

  let abaAtiva = 'pendentes'; // contatos | pendentes | em_atendimento
  let termoBusca = '';
  let timerBuscaContatos = null;

  let conversaAbertaId = null;
  let conversaAberta = null;
  let contatoAberto = null;
  let ultimaContagemMsgs = 0;

  let pollStatus = null;
  let pollLista = null;
  let pollThread = null;

  let gravador = null;
  let chunksAudio = [];
  let gravando = false;
  let ultimoDigitando = 0;

  const ICONE_TIPO = { texto: '', imagem: '📷 ', video: '🎥 ', audio: '🎤 ', documento: '📄 ', sticker: '🩹 ' };
  const ROTULO_TIPO = { imagem: 'Foto', video: 'Vídeo', audio: 'Áudio', documento: 'Documento', sticker: 'Figurinha' };
  const TICK_STATUS = { enviada: '✓', entregue: '✓✓', lida: '✓✓' };
  const ROTULO_ESTADO = {
    desconectado: '⚪ Desconectado', gerando_qr: '🟡 Conectando…',
    aguardando_leitura: '🟡 Escaneie o QR Code', conectado: '🟢 Conectado', erro: '🔴 Erro',
  };

  // ------------------------------- Helpers -------------------------------

  function atendenteAtualId() {
    const v = localStorage.getItem(CHAVE_ATENDENTE);
    return v ? Number(v) : null;
  }
  function definirAtendenteAtual(id) {
    if (id) localStorage.setItem(CHAVE_ATENDENTE, String(id));
    else localStorage.removeItem(CHAVE_ATENDENTE);
  }

  function iniciaisContato(nome, telefone) {
    const base = (nome || telefone || '?').trim();
    const partes = base.split(/\s+/).filter(Boolean);
    if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
    return base.slice(0, 2).toUpperCase();
  }

  function corAvatar(chave) {
    const paleta = (window.Graficos && Graficos.CORES) || ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
    let hash = 0;
    const s = String(chave || '');
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return paleta[hash % paleta.length];
  }

  function tempoRelativo(iso) {
    if (!iso) return '';
    const d = new Date(String(iso).replace(' ', 'T'));
    if (isNaN(d.getTime())) return '';
    const agora = new Date();
    const diffMin = Math.floor((agora - d) / 60000);
    if (diffMin < 1) return 'agora';
    if (diffMin < 60) return `${diffMin}min`;
    const meiaNoite = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const diffDias = Math.round((meiaNoite(agora) - meiaNoite(d)) / 86400000);
    if (diffDias === 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (diffDias === 1) return 'ontem';
    if (diffDias < 7) return `${diffDias}d`;
    return d.toLocaleDateString('pt-BR');
  }

  function previewMensagem(c) {
    if (!c.ultima_mensagem_tipo) return 'Sem mensagens ainda.';
    if (c.ultima_mensagem_texto) return `${ICONE_TIPO[c.ultima_mensagem_tipo] || ''}${c.ultima_mensagem_texto}`;
    return `${ICONE_TIPO[c.ultima_mensagem_tipo] || ''}[${ROTULO_TIPO[c.ultima_mensagem_tipo] || c.ultima_mensagem_tipo}]`;
  }

  // Nao inclui o "+55" dentro do valor mascarado: se os digitos do prefixo
  // ficassem no proprio <input>, cada nova tecla digitada re-extrairia os
  // digitos "55" do prefixo junto com o numero real, corrompendo o valor
  // progressivamente (loop de realimentacao). O "+55" fica num rotulo fixo
  // ao lado do campo (ver #nc-prefixo-tel), fora da area editavel.
  function mascararTelefone(digitos) {
    if (!digitos) return '';
    if (digitos.length <= 2) return '(' + digitos;
    const ddd = digitos.slice(0, 2);
    const resto = digitos.slice(2);
    if (resto.length <= 4) return `(${ddd}) ${resto}`;
    const fim = resto.slice(-4);
    const meio = resto.slice(0, -4);
    return `(${ddd}) ${meio}-${fim}`;
  }

  function formatarTelefone(tel) {
    const d = String(tel || '').replace(/\D/g, '');
    if (d.length === 12 || d.length === 13) return '+55 ' + mascararTelefone(d.slice(2));
    if (d.length === 10 || d.length === 11) return '+55 ' + mascararTelefone(d);
    return tel || '—';
  }

  /** Salão/oficina/serviço geral e instituto têm Agenda; agência de viagem usa CRM + Calendário de Viagens em vez disso. */
  function agendaDisponivel() {
    const perfil = window.__perfilNegocio;
    const ramo = window.__ramoServico;
    return (perfil === 'servico' || perfil === 'ambos' || perfil === 'instituto') && ramo !== 'agencia_viagem';
  }

  function crmDisponivel() {
    return window.__ramoServico === 'agencia_viagem';
  }

  function pararPolling() {
    if (pollStatus) clearInterval(pollStatus);
    if (pollLista) clearInterval(pollLista);
    if (pollThread) clearInterval(pollThread);
  }

  // ------------------------------- Render raiz -------------------------------

  async function render(container) {
    responsaveis = await API.get('/api/agenda/profissionais').catch(() => []);
    respostasRapidas = await API.get('/api/whatsapp/respostas-rapidas').catch(() => []);
    if (agendaDisponivel()) servicosAgenda = await API.get('/api/produtos?eh_servico=1').catch(() => []);

    container.innerHTML = `
      <div class="wa-pagina">
        <div class="wa-faixa" id="wa-faixa"></div>
        <div class="wa-duas-colunas">
          <div class="wa-coluna-inbox">
            <div class="wa-abas" id="wa-abas"></div>
            <div class="wa-busca"><input id="wa-busca" placeholder="Buscar conversas" /></div>
            <button class="btn" id="wa-nova">+ Nova conversa</button>
            <div class="wa-lista" id="wa-lista"></div>
          </div>
          <div class="wa-coluna-chat" id="wa-coluna-chat"></div>
        </div>
      </div>`;

    conversaAbertaId = null;
    conversaAberta = null;
    renderChatColuna();

    container.querySelector('#wa-nova').addEventListener('click', abrirNovaConversa);
    container.querySelector('#wa-busca').addEventListener('input', (e) => {
      termoBusca = e.target.value;
      if (abaAtiva === 'contatos') { clearTimeout(timerBuscaContatos); timerBuscaContatos = setTimeout(carregarLista, 250); }
      else renderListaInbox();
    });

    await atualizarStatus();
    renderFaixa();
    await carregarLista();

    if (pollStatus) clearInterval(pollStatus);
    pollStatus = setInterval(async () => {
      if (!document.getElementById('wa-faixa')) { pararPolling(); return; }
      await atualizarStatus();
      renderFaixa();
    }, 5000);
    if (pollLista) clearInterval(pollLista);
    pollLista = setInterval(() => {
      if (!document.getElementById('wa-lista')) { pararPolling(); return; }
      carregarLista();
    }, 10000);
  }

  async function atualizarStatus() {
    try { statusAtual = await API.get('/api/whatsapp/status'); }
    catch (e) { statusAtual = { estado: 'erro', erro: e.message }; }
  }

  // ------------------------------- Faixa de saudação -------------------------------

  function renderFaixa() {
    const alvo = document.getElementById('wa-faixa');
    if (!alvo) return;
    const atual = atendenteAtualId();
    const nomeAtual = (responsaveis.find((r) => r.id === atual) || {}).nome || 'Equipe';
    const classePill = statusAtual.estado === 'conectado' ? 'wa-pill--ok' : statusAtual.estado === 'erro' ? 'wa-pill--erro' : 'wa-pill--espera';
    alvo.innerHTML = `
      <div>Olá, <strong>${UI.escapar(nomeAtual)}</strong>! 👋 Seja bem-vindo(a) ao <strong>Atendimento</strong></div>
      <div class="flex gap-12" style="align-items:center;flex-wrap:wrap">
        <select id="wa-atendente-atual" title="Quem está atendendo agora">
          <option value="">— selecionar atendente —</option>
          ${responsaveis.map((r) => `<option value="${r.id}" ${atual === r.id ? 'selected' : ''}>${UI.escapar(r.nome)}</option>`).join('')}
        </select>
        <span class="wa-pill ${classePill}" id="wa-pill-conexao">${ROTULO_ESTADO[statusAtual.estado] || statusAtual.estado}</span>
        <button class="btn btn--secundario" id="wa-agendar-gerenciar">⏰ Agendar</button>
        <button class="btn btn--secundario" id="wa-atalhos-gerenciar">⚡ Respostas rápidas</button>
        <button class="btn btn--secundario" id="wa-bot-config">🤖 Bot</button>
      </div>`;

    alvo.querySelector('#wa-atendente-atual').addEventListener('change', (e) => {
      definirAtendenteAtual(e.target.value ? Number(e.target.value) : null);
      renderFaixa();
    });
    alvo.querySelector('#wa-pill-conexao').addEventListener('click', abrirConexaoModal);
    alvo.querySelector('#wa-agendar-gerenciar').addEventListener('click', () => abrirGerenciarAgendamentos());
    alvo.querySelector('#wa-atalhos-gerenciar').addEventListener('click', abrirGerenciarAtalhos);
    alvo.querySelector('#wa-bot-config').addEventListener('click', abrirConfigBot);
  }

  function abrirConexaoModal() {
    Modal.abrir({
      titulo: '🔌 Conexão do WhatsApp', tamanho: 'modal--pequeno', mostrarConfirmar: false,
      corpoHTML: `<div id="wa-conexao-corpo"></div>`,
      aoAbrir: (el) => {
        renderConexaoCorpo(el);
        const poll = setInterval(async () => {
          if (!document.getElementById('wa-conexao-corpo')) { clearInterval(poll); return; }
          try { statusAtual = await API.get('/api/whatsapp/status'); } catch (_) { /* ignora falha de poll */ }
          renderConexaoCorpo(el);
          renderFaixa();
        }, 2000);
      },
    });
  }

  function renderConexaoCorpo(el) {
    const corpo = el.querySelector('#wa-conexao-corpo');
    if (!corpo) return;
    const e = statusAtual.estado;
    corpo.innerHTML = `
      <div class="flex flex--between" style="align-items:center;flex-wrap:wrap;gap:12px">
        <strong>${ROTULO_ESTADO[e] || e}</strong>
        <div class="flex gap-12">
          ${e === 'desconectado' || e === 'erro' ? '<button class="btn" id="wa-conectar">Conectar WhatsApp</button>' : ''}
          ${e === 'conectado' ? '<button class="btn btn--perigo" id="wa-desconectar">Desconectar</button>' : ''}
        </div>
      </div>
      ${statusAtual.erro ? `<div class="dica mt-16" style="color:var(--perigo)">${UI.escapar(statusAtual.erro)}</div>` : ''}
      ${e === 'aguardando_leitura' && statusAtual.qr ? `
        <div class="mt-16" style="text-align:center">
          <img src="${statusAtual.qr}" alt="QR Code do WhatsApp" style="width:220px;height:220px;border:1px solid var(--borda);border-radius:8px">
          <p class="dica mt-16">Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho.</p>
        </div>` : ''}
      ${e === 'desconectado' ? '<p class="dica mt-16">Conecte para começar a receber e responder mensagens direto por aqui.</p>' : ''}`;

    const btnC = corpo.querySelector('#wa-conectar');
    if (btnC) btnC.addEventListener('click', async () => {
      btnC.disabled = true; btnC.textContent = 'Conectando…';
      try { statusAtual = await API.post('/api/whatsapp/conectar', {}); renderConexaoCorpo(el); renderFaixa(); }
      catch (err) { UI.erro(err.message); btnC.disabled = false; btnC.textContent = 'Conectar WhatsApp'; }
    });
    const btnD = corpo.querySelector('#wa-desconectar');
    if (btnD) btnD.addEventListener('click', async () => {
      const ok = await UI.confirmar('Desconectar o WhatsApp? Você vai precisar escanear o QR Code de novo para reconectar.', { titulo: 'Desconectar', textoConfirmar: 'Desconectar', perigo: true });
      if (!ok) return;
      try { statusAtual = await API.post('/api/whatsapp/desconectar', {}); renderConexaoCorpo(el); renderFaixa(); }
      catch (err) { UI.erro(err.message); }
    });
  }

  // ------------------------------- Inbox: abas + lista -------------------------------

  async function carregarLista() {
    try { conversas = await API.get('/api/whatsapp/conversas'); } catch (_) { /* mantem a lista anterior */ }
    renderAbas();
    if (abaAtiva === 'contatos') {
      try { contatos = await API.get(`/api/whatsapp/contatos${termoBusca ? '?busca=' + encodeURIComponent(termoBusca) : ''}`); }
      catch (_) { contatos = []; }
    }
    renderListaInbox();
  }

  function renderAbas() {
    const alvo = document.getElementById('wa-abas');
    if (!alvo) return;
    const qtdPendentes = conversas.filter((c) => c.status === 'contato' || c.status === 'aguardando').length;
    const qtdAtendimento = conversas.filter((c) => c.status === 'atendimento').length;
    alvo.innerHTML = `
      <button type="button" class="wa-aba ${abaAtiva === 'contatos' ? 'ativa' : ''}" data-aba="contatos">Contatos</button>
      <button type="button" class="wa-aba ${abaAtiva === 'pendentes' ? 'ativa' : ''}" data-aba="pendentes">Pendentes <span class="wa-aba__contador">${qtdPendentes}</span></button>
      <button type="button" class="wa-aba ${abaAtiva === 'em_atendimento' ? 'ativa' : ''}" data-aba="em_atendimento">Em atend. <span class="wa-aba__contador">${qtdAtendimento}</span></button>`;
    alvo.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => { abaAtiva = b.dataset.aba; carregarLista(); }));
  }

  function renderListaInbox() {
    const alvo = document.getElementById('wa-lista');
    if (!alvo) return;

    if (abaAtiva === 'contatos') {
      alvo.innerHTML = contatos.length ? contatos.map(cardContatoItem).join('') : '<p class="dica" style="padding:12px">Nenhum contato ainda.</p>';
      alvo.querySelectorAll('[data-contato]').forEach((el) => el.addEventListener('click', () => abrirContatoDaLista(Number(el.dataset.contato))));
      return;
    }

    const termo = termoBusca.trim().toLowerCase();
    const statusAlvo = abaAtiva === 'pendentes' ? ['contato', 'aguardando'] : ['atendimento'];
    const itens = conversas
      .filter((c) => statusAlvo.includes(c.status))
      .filter((c) => !termo || (c.nome_contato || '').toLowerCase().includes(termo) || (c.telefone || '').includes(termo));
    alvo.innerHTML = itens.length ? itens.map(cardConversaItem).join('') : '<p class="dica" style="padding:12px">Nenhuma conversa aqui.</p>';
    alvo.querySelectorAll('[data-abrir]').forEach((el) => el.addEventListener('click', () => abrirConversaInline(Number(el.dataset.abrir))));
    marcarItemAtivo();
  }

  function marcarItemAtivo() {
    document.querySelectorAll('.wa-item').forEach((el) => el.classList.remove('ativo'));
    if (!conversaAbertaId) return;
    const el = document.querySelector(`.wa-item[data-abrir="${conversaAbertaId}"]`);
    if (el) el.classList.add('ativo');
  }

  function cardConversaItem(c) {
    return `<div class="wa-item" data-abrir="${c.id}">
      <div class="wa-avatar" style="background:${corAvatar(c.wa_chat_id || c.telefone)}">${UI.escapar(iniciaisContato(c.nome_contato, c.telefone))}</div>
      <div class="wa-item__corpo">
        <div class="wa-item__topo">
          <span class="wa-item__nome">${UI.escapar(c.nome_contato || c.telefone || '—')}</span>
          <span class="wa-item__hora">${tempoRelativo(c.ultima_mensagem_em)}</span>
        </div>
        <div class="wa-item__baixo">
          <span class="wa-item__preview">${UI.escapar(previewMensagem(c))}${c.modo_atual === 'bot' ? ' · 🤖' : ''}</span>
          ${c.nao_lidas > 0 ? `<span class="wa-badge">${c.nao_lidas}</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  function cardContatoItem(c) {
    const semConversa = !c.conversa_id;
    return `<div class="wa-item" data-contato="${c.id}">
      <div class="wa-avatar" style="background:${corAvatar(c.wa_chat_id || c.telefone)}">${UI.escapar(iniciaisContato(c.nome, c.telefone))}</div>
      <div class="wa-item__corpo">
        <div class="wa-item__topo">
          <span class="wa-item__nome">${UI.escapar(c.nome || c.telefone || '—')}</span>
          <span class="wa-item__hora">${c.ultima_interacao ? tempoRelativo(c.ultima_interacao) : ''}</span>
        </div>
        <div class="wa-item__baixo">
          <span class="wa-item__preview">${semConversa ? 'Sem conversa ainda' : UI.escapar(previewMensagem(c))}</span>
          ${c.nao_lidas > 0 ? `<span class="wa-badge">${c.nao_lidas}</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  function abrirContatoDaLista(contatoId) {
    const c = contatos.find((x) => x.id === contatoId);
    if (c && c.conversa_id) { abrirConversaInline(c.conversa_id); return; }
    UI.toast('Este contato ainda não tem conversa. Use "+ Nova" para iniciar.', 'info');
  }

  // ------------------------------- Coluna da conversa -------------------------------

  async function abrirConversaInline(id) {
    let conversa;
    try { conversa = await API.get(`/api/whatsapp/conversas/${id}`); }
    catch (e) { UI.erro(e.message); return; }

    conversaAbertaId = id;
    conversaAberta = conversa;
    contatoAberto = null;
    ultimaContagemMsgs = 0;

    if (conversa.contato_id) {
      try { contatoAberto = await API.get(`/api/whatsapp/contatos/${conversa.contato_id}`); } catch (_) { /* segue sem push_name */ }
    }
    if (conversa.nao_lidas > 0) API.post(`/api/whatsapp/conversas/${id}/marcar-lida`, {}).catch(() => {});

    renderChatColuna();
    marcarItemAtivo();

    if (pollThread) clearInterval(pollThread);
    pollThread = setInterval(async () => {
      if (!conversaAbertaId || !document.getElementById('wa-thread')) { clearInterval(pollThread); return; }
      try {
        const atualizada = await API.get(`/api/whatsapp/conversas/${conversaAbertaId}`);
        conversaAberta = atualizada;
        renderThread(false);
      } catch (_) { /* ignora falha de poll */ }
    }, 4000);
  }

  function renderChatColuna() {
    const alvo = document.getElementById('wa-coluna-chat');
    if (!alvo) return;

    if (!conversaAberta) {
      alvo.innerHTML = `<div class="wa-vazio"><div class="wa-vazio__icone">💬</div><p>Nenhuma conversa selecionada.</p></div>`;
      return;
    }

    const pushNameDiferente = contatoAberto && contatoAberto.push_name && contatoAberto.push_name !== (conversaAberta.nome_contato || '');
    alvo.innerHTML = `
      <div class="wa-chat-cabecalho">
        <div class="flex gap-12" style="align-items:center">
          <div class="wa-avatar" style="background:${corAvatar(conversaAberta.wa_chat_id || conversaAberta.telefone)}">${UI.escapar(iniciaisContato(conversaAberta.nome_contato, conversaAberta.telefone))}</div>
          <div>
            <div class="flex gap-6" style="align-items:center">
              <strong>${UI.escapar(conversaAberta.nome_contato || conversaAberta.telefone || '—')}</strong>
              <button class="wa-icone-btn" id="wa-editar-contato" title="Editar contato" style="font-size:15px">✏️</button>
            </div>
            ${pushNameDiferente ? `<div class="dica">${UI.escapar(contatoAberto.push_name)}</div>` : ''}
          </div>
        </div>
        <div class="flex gap-8" style="flex-wrap:wrap">
          <button class="btn btn--secundario" id="wa-toggle-bot">${conversaAberta.modo_atual === 'bot' ? '🤖 Desativar robô' : '🤖 Ativar robô'}</button>
          <button class="btn btn--secundario" id="wa-iniciar-atendimento">Iniciar Atendimento</button>
          ${agendaDisponivel() ? '<button class="btn btn--secundario" id="wa-agendar-horario">📅 Agendar horário</button>' : ''}
          ${crmDisponivel() && !conversaAberta.lead_id ? '<button class="btn btn--secundario" id="wa-criar-lead">📇 Criar lead no CRM</button>' : ''}
          <button class="btn btn--secundario" id="wa-agendar-mensagem">⏰ Agendar mensagem</button>
          <button class="btn" id="wa-finalizar-atendimento">Finalizar Atendimento</button>
        </div>
      </div>
      <div class="wa-chat-corpo" id="wa-thread"></div>
      <div class="wa-chat-rodape">
        <button class="wa-icone-btn" id="wa-anexo-btn" title="Anexar arquivo">📎</button>
        <button class="wa-icone-btn" id="wa-audio-btn" title="Gravar áudio">🎤</button>
        <button class="wa-icone-btn" id="wa-atalho-btn" title="Respostas rápidas">⚡</button>
        <textarea id="wa-resposta" rows="1" placeholder="Digite uma mensagem… (Enter envia · /atalho para resposta rápida)"></textarea>
        <button class="btn" id="wa-enviar">Enviar</button>
        <input type="file" id="wa-arquivo-input" style="display:none" />
      </div>`;

    renderThread(true);
    ligarEventosChat();
  }

  function ligarEventosChat() {
    const id = conversaAbertaId;

    document.getElementById('wa-editar-contato').addEventListener('click', abrirEditarContato);

    document.getElementById('wa-toggle-bot').addEventListener('click', async () => {
      try { conversaAberta = await API.post(`/api/whatsapp/conversas/${id}/alternar-bot`, {}); renderChatColuna(); await carregarLista(); }
      catch (e) { UI.erro(e.message); }
    });

    document.getElementById('wa-iniciar-atendimento').addEventListener('click', async () => {
      try {
        conversaAberta = await API.post(`/api/whatsapp/conversas/${id}/iniciar-atendimento`, { atendente_id: atendenteAtualId() });
        UI.sucesso('Atendimento iniciado.');
        renderChatColuna();
        await carregarLista();
      } catch (e) { UI.erro(e.message); }
    });

    // Nova tentativa de baixar uma midia que nao veio junto com a mensagem.
    // Delegacao no container: a thread e reconstruida a cada atualizacao.
    document.getElementById('wa-thread').addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-baixar-midia]');
      if (!btn) return;
      btn.disabled = true;
      const textoOriginal = btn.textContent;
      btn.textContent = 'Baixando…';
      try {
        conversaAberta = await API.post(`/api/whatsapp/mensagens/${btn.dataset.baixarMidia}/baixar-midia`, {});
        UI.sucesso('Mídia baixada.');
        renderThread(true);
      } catch (e) {
        UI.erro(e.message);
        btn.disabled = false;
        btn.textContent = textoOriginal;
      }
    });

    document.getElementById('wa-finalizar-atendimento').addEventListener('click', abrirFinalizarAtendimento);
    const btnAgendar = document.getElementById('wa-agendar-horario');
    if (btnAgendar) btnAgendar.addEventListener('click', abrirAgendarHorario);
    const btnCriarLead = document.getElementById('wa-criar-lead');
    if (btnCriarLead) btnCriarLead.addEventListener('click', async () => {
      try {
        conversaAberta = await API.post(`/api/whatsapp/conversas/${id}/criar-lead`, {});
        UI.sucesso('Lead criado no CRM.');
        renderChatColuna();
        await carregarLista();
      } catch (e) { UI.erro(e.message); }
    });
    document.getElementById('wa-agendar-mensagem').addEventListener('click', () => {
      if (!conversaAberta.contato_id) { UI.erro('Contato não encontrado.'); return; }
      formAgendamento('unica', { id: conversaAberta.contato_id, nome: conversaAberta.nome_contato, telefone: conversaAberta.telefone });
    });

    const inp = document.getElementById('wa-resposta');
    const enviar = async () => {
      const texto = inp.value.trim();
      if (!texto) return;
      const btn = document.getElementById('wa-enviar');
      btn.disabled = true;
      try {
        conversaAberta = await API.post(`/api/whatsapp/conversas/${id}/mensagens`, { texto, atendente_id: atendenteAtualId() });
        inp.value = '';
        renderThread(true);
        await carregarLista();
      } catch (e) { UI.erro(e.message); }
      btn.disabled = false;
    };
    document.getElementById('wa-enviar').addEventListener('click', enviar);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });
    inp.addEventListener('input', () => {
      const m = inp.value.match(/^\/(\S+)\s$/);
      if (m) {
        const r = respostasRapidas.find((x) => x.ativo && x.atalho === m[1].toLowerCase());
        if (r) inp.value = r.conteudo;
      }
      notificarDigitando(id);
    });

    document.getElementById('wa-anexo-btn').addEventListener('click', () => document.getElementById('wa-arquivo-input').click());
    document.getElementById('wa-arquivo-input').addEventListener('change', (e) => {
      const arquivo = e.target.files[0];
      e.target.value = '';
      if (arquivo) abrirModalAnexo(id, arquivo);
    });
    document.getElementById('wa-audio-btn').addEventListener('click', () => alternarGravacaoAudio(id));
    document.getElementById('wa-atalho-btn').addEventListener('click', () => abrirListaAtalhos());
  }

  function notificarDigitando(conversaId) {
    const agora = Date.now();
    if (agora - ultimoDigitando < 3000) return;
    ultimoDigitando = agora;
    API.post(`/api/whatsapp/conversas/${conversaId}/digitando`, {}).catch(() => {});
  }

  function estaPertoDoFim(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function renderThread(forcar) {
    const thread = document.getElementById('wa-thread');
    if (!thread || !conversaAberta) return;
    const novaContagem = conversaAberta.mensagens.length;
    const chegouNova = novaContagem > ultimaContagemMsgs;
    const deveRolar = forcar || chegouNova || estaPertoDoFim(thread);
    ultimaContagemMsgs = novaContagem;

    thread.innerHTML = conversaAberta.mensagens.map(bolhaMensagem).join('') || '<p class="muted">Nenhuma mensagem ainda.</p>';

    if (deveRolar) {
      thread.scrollTop = thread.scrollHeight;
      thread.querySelectorAll('img,video').forEach((m) => {
        const rerolar = () => { thread.scrollTop = thread.scrollHeight; };
        m.addEventListener('load', rerolar, { once: true });
        m.addEventListener('loadedmetadata', rerolar, { once: true });
      });
    }
  }

  function bolhaMensagem(m) {
    if (m.remetente_tipo === 'sistema') {
      return `<div class="flex" style="justify-content:center;margin:10px 0">
        <span class="dica" style="background:var(--fundo-hover);padding:4px 12px;border-radius:999px">${UI.escapar(m.texto || '')}</span>
      </div>`;
    }

    const minha = m.direcao === 'enviada';
    const url = m.arquivo ? `/uploads/whatsapp/${encodeURIComponent(m.arquivo)}` : null;
    let corpo = '';
    const TIPOS_MIDIA = ['imagem', 'sticker', 'video', 'audio', 'documento'];
    if (m.tipo === 'imagem' && url) corpo = `<img src="${url}" style="max-width:220px;border-radius:8px;display:block">`;
    else if (m.tipo === 'sticker' && url) corpo = `<img src="${url}" style="width:96px;display:block">`;
    else if (m.tipo === 'video' && url) corpo = `<video src="${url}" controls style="max-width:240px;border-radius:8px;display:block"></video>`;
    else if (m.tipo === 'audio' && url) corpo = `<audio src="${url}" controls></audio>`;
    else if (m.tipo === 'documento' && url) corpo = `<a href="${url}" target="_blank" rel="noopener" class="btn btn--secundario">📄 baixar ${UI.escapar(ROTULO_TIPO.documento)}</a>`;
    else if (TIPOS_MIDIA.includes(m.tipo) && !url) {
      // Chegou a mensagem, mas o arquivo nao pode ser baixado na hora (o
      // WhatsApp as vezes ainda esta sincronizando a midia no celular).
      corpo = `<div class="dica" style="display:flex;flex-direction:column;gap:6px">
        <span>⚠️ Arquivo não baixado — ${UI.escapar(ROTULO_TIPO[m.tipo] || m.tipo)}</span>
        ${m.erro_midia ? `<span style="color:var(--perigo)">${UI.escapar(m.erro_midia)}</span>` : ''}
        <button class="btn btn--secundario" type="button" data-baixar-midia="${m.id}">⬇️ Tentar baixar de novo</button>
      </div>`;
    }
    if (m.texto) corpo += `<div>${UI.escapar(m.texto)}</div>`;
    if (!corpo) corpo = `<div class="dica">[${UI.escapar(m.tipo)}]</div>`;

    let rotulo = '';
    if (minha) {
      if (m.remetente_tipo === 'bot') rotulo = '🤖 Bot';
      else if (m.remetente_tipo === 'atendente' && m.remetente_id) {
        const resp = responsaveis.find((r) => r.id === m.remetente_id);
        rotulo = resp ? UI.escapar(resp.nome) : '';
      }
    }

    const tick = minha ? (m.status === 'erro' ? '⚠️' : (TICK_STATUS[m.status] || '✓')) : '';
    const corTick = m.status === 'lida' ? '#53bdeb' : 'inherit';

    return `<div class="flex" style="justify-content:${minha ? 'flex-end' : 'flex-start'};margin-bottom:8px">
      <div style="max-width:75%;padding:8px 12px;border-radius:10px;background:${minha ? 'var(--primaria)' : 'var(--fundo-card)'};color:${minha ? '#fff' : 'var(--texto)'};border:1px solid ${minha ? 'transparent' : 'var(--borda)'}">
        ${rotulo ? `<div style="font-size:11px;font-weight:700;opacity:.85;margin-bottom:2px">${rotulo}</div>` : ''}
        ${corpo}
        <div style="font-size:10.5px;opacity:.75;margin-top:4px;text-align:right">${UI.dataHora(m.criado_em)}${tick ? ` <span style="color:${corTick}">${tick}</span>` : ''}</div>
      </div>
    </div>`;
  }

  // ------------------------------- Ações da conversa -------------------------------

  function abrirFinalizarAtendimento() {
    const id = conversaAbertaId;
    Modal.abrir({
      titulo: '✅ Finalizar atendimento', tamanho: 'modal--pequeno',
      corpoHTML: `<div class="campo"><label>Comentário do atendimento (opcional)</label><textarea id="fin-comentario" placeholder="Resumo do que foi resolvido, combinados, etc."></textarea></div>`,
      textoConfirmar: 'Finalizar',
      aoConfirmar: async (el) => {
        const comentario = el.querySelector('#fin-comentario').value;
        try {
          await API.post(`/api/whatsapp/conversas/${id}/finalizar`, { comentario });
          UI.sucesso('Atendimento finalizado.');
          conversaAbertaId = null;
          conversaAberta = null;
          renderChatColuna();
          await carregarLista();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  function abrirAgendarHorario() {
    const conversa = conversaAberta;
    const hoje = new Date().toISOString().slice(0, 10);
    Modal.abrir({
      titulo: '📅 Agendar horário', tamanho: 'modal--grande',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo"><label>Data *</label><input id="ah-data" type="date" value="${hoje}" /></div>
          <div class="campo"><label>Hora início *</label><input id="ah-hora" type="time" value="09:00" /></div>
          <div class="campo"><label>Profissional</label><select id="ah-prof">
            <option value="">—</option>${responsaveis.map((p) => `<option value="${p.id}">${UI.escapar(p.nome)}</option>`).join('')}
          </select></div>
          <div class="campo"><label>Serviço</label><select id="ah-serv">
            <option value="">— selecione —</option>${servicosAgenda.map((s) => `<option value="${s.id}">${UI.escapar(s.nome)}</option>`).join('')}
          </select></div>
          <div class="campo col-2"><label>Nome do cliente</label><input id="ah-nome" value="${UI.escapar(conversa.nome_contato || '')}" /></div>
          <div class="campo col-2"><label>Telefone</label><input id="ah-tel" value="${UI.escapar(conversa.telefone || '')}" /></div>
          <div class="campo col-2"><label>Observações</label><textarea id="ah-obs"></textarea></div>
        </div>`,
      textoConfirmar: 'Agendar',
      aoAbrir: (el) => {
        CadastroRapido.ligar(el.querySelector('#ah-prof'), 'profissional', { aoCriar: (r) => responsaveis.push(r) });
        CadastroRapido.ligar(el.querySelector('#ah-serv'), 'servico', { aoCriar: (r) => servicosAgenda.push(r) });
      },
      aoConfirmar: async (el) => {
        const dados = {
          data: el.querySelector('#ah-data').value,
          hora_inicio: el.querySelector('#ah-hora').value,
          profissional_id: el.querySelector('#ah-prof').value || null,
          produto_id: el.querySelector('#ah-serv').value || null,
          cliente_nome: el.querySelector('#ah-nome').value,
          telefone: el.querySelector('#ah-tel').value,
          observacao: el.querySelector('#ah-obs').value,
        };
        if (!dados.data || !dados.hora_inicio) { UI.erro('Informe data e hora.'); return false; }
        try {
          await API.post('/api/agenda', dados);
          UI.sucesso('Agendamento criado na Agenda.');
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  function abrirEditarContato() {
    if (!conversaAberta || !conversaAberta.contato_id) { UI.erro('Contato não encontrado.'); return; }
    Modal.abrir({
      titulo: '👤 Dados do contato', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="flex gap-12 mb-16" style="align-items:center">
          <div class="wa-avatar" style="background:${corAvatar(conversaAberta.wa_chat_id)}">${UI.escapar(iniciaisContato((contatoAberto && contatoAberto.nome), conversaAberta.telefone))}</div>
          <div>
            <div class="dica">Nome no WhatsApp</div>
            <div>${UI.escapar((contatoAberto && contatoAberto.push_name) || '—')}</div>
          </div>
        </div>
        <div class="campo"><label>Telefone</label><input value="${UI.escapar(formatarTelefone(conversaAberta.telefone))}" disabled /></div>
        <div class="campo mt-16"><label>Nome do contato (apelido interno)</label><input id="ec-nome" value="${UI.escapar((contatoAberto && contatoAberto.nome) || '')}" /></div>`,
      textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        const nome = el.querySelector('#ec-nome').value;
        try {
          await API.put(`/api/whatsapp/contatos/${conversaAberta.contato_id}`, { nome });
          UI.sucesso('Contato atualizado.');
          conversaAberta = await API.get(`/api/whatsapp/conversas/${conversaAbertaId}`);
          contatoAberto = await API.get(`/api/whatsapp/contatos/${conversaAberta.contato_id}`);
          renderChatColuna();
          await carregarLista();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function alternarGravacaoAudio(conversaId) {
    const btn = document.getElementById('wa-audio-btn');
    if (!btn) return;

    if (!gravando) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunksAudio = [];
        gravador = new MediaRecorder(stream);
        gravador.ondataavailable = (e) => { if (e.data.size > 0) chunksAudio.push(e.data); };
        gravador.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunksAudio, { type: 'audio/webm' });
          await enviarAudioGravado(conversaId, blob);
        };
        gravador.start();
        gravando = true;
        btn.textContent = '⏹️';
        btn.classList.add('wa-gravando');
      } catch (e) { UI.erro('Não foi possível acessar o microfone: ' + e.message); }
    } else {
      gravador.stop();
      gravando = false;
      btn.textContent = '🎤';
      btn.classList.remove('wa-gravando');
    }
  }

  async function enviarAudioGravado(conversaId, blob) {
    const fd = new FormData();
    fd.append('arquivo', blob, 'audio.webm');
    fd.append('como_audio', '1');
    const atendente = atendenteAtualId();
    if (atendente) fd.append('atendente_id', String(atendente));
    try {
      conversaAberta = await API.post(`/api/whatsapp/conversas/${conversaId}/midia`, fd);
      renderThread(true);
      await carregarLista();
    } catch (e) { UI.erro(e.message); }
  }

  function abrirModalAnexo(conversaId, arquivo) {
    const ehImagem = arquivo.type.startsWith('image/');
    const previewUrl = ehImagem ? URL.createObjectURL(arquivo) : null;
    Modal.abrir({
      titulo: 'Enviar anexo', tamanho: 'modal--pequeno',
      corpoHTML: `
        ${ehImagem
          ? `<img src="${previewUrl}" style="max-width:100%;border-radius:8px;display:block;margin-bottom:12px" />`
          : `<div class="card mb-16">📄 ${UI.escapar(arquivo.name)} <span class="dica">(${(arquivo.size / 1024).toFixed(0)} KB)</span></div>`}
        <div class="campo"><label>Descrição (opcional)</label><input id="anexo-legenda" placeholder="Legenda…" /></div>`,
      textoConfirmar: 'Enviar',
      aoConfirmar: async (el) => {
        const legenda = el.querySelector('#anexo-legenda').value;
        const fd = new FormData();
        fd.append('arquivo', arquivo);
        if (legenda) fd.append('legenda', legenda);
        const atendente = atendenteAtualId();
        if (atendente) fd.append('atendente_id', String(atendente));
        try {
          conversaAberta = await API.post(`/api/whatsapp/conversas/${conversaId}/midia`, fd);
          renderThread(true);
          await carregarLista();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ------------------------------- Nova conversa -------------------------------

  function abrirNovaConversa() {
    let resultadosBusca = [];
    let numeroValido = false;

    const fechar = Modal.abrir({
      titulo: '💬 Nova conversa', tamanho: 'modal--pequeno',
      corpoHTML: `
        <p class="dica mb-16">Busque um contato existente ou digite um número novo</p>
        <div class="campo"><label>Contato ou número de WhatsApp</label>
          <div class="flex gap-8" style="align-items:center">
            <span id="nc-prefixo-tel" class="dica" style="display:none">+55</span>
            <input id="nc-campo" class="cresce" placeholder="Nome ou (11) 99999-9999" autocomplete="off" />
          </div>
        </div>
        <div id="nc-resultados"></div>
        <div id="nc-status-numero" class="dica"></div>
        <div class="campo mt-16" id="nc-nome-wrap" style="display:none"><label>Nome do contato (opcional)</label><input id="nc-nome" /></div>
        <div class="campo mt-16" id="nc-msg-wrap" style="display:none"><label>Primeira mensagem</label><textarea id="nc-texto"></textarea></div>`,
      textoConfirmar: 'Criar conversa',
      aoAbrir: (el) => {
        const campo = el.querySelector('#nc-campo');
        const prefixo = el.querySelector('#nc-prefixo-tel');
        const btnConfirmar = el.querySelector('[data-confirmar]');
        const resultadosEl = el.querySelector('#nc-resultados');
        const statusEl = el.querySelector('#nc-status-numero');
        const nomeWrap = el.querySelector('#nc-nome-wrap');
        const msgWrap = el.querySelector('#nc-msg-wrap');
        const textoEl = el.querySelector('#nc-texto');
        btnConfirmar.disabled = true;
        let timerBusca = null;

        function atualizarBotao() { btnConfirmar.disabled = !(numeroValido && textoEl.value.trim()); }

        campo.addEventListener('input', () => {
          const valor = campo.value;
          resultadosEl.innerHTML = '';
          statusEl.innerHTML = '';
          numeroValido = false;

          if (/[a-zA-Z]/.test(valor)) {
            prefixo.style.display = 'none';
            nomeWrap.style.display = 'none';
            msgWrap.style.display = 'none';
            btnConfirmar.disabled = true;
            clearTimeout(timerBusca);
            if (!valor.trim()) return;
            timerBusca = setTimeout(async () => {
              try {
                const r = await API.get(`/api/whatsapp/contatos?busca=${encodeURIComponent(valor)}`);
                resultadosBusca = r.slice(0, 6);
                resultadosEl.innerHTML = resultadosBusca.length
                  ? resultadosBusca.map((c) => `<div class="wa-nc-resultado" data-id="${c.id}">
                      <div class="wa-avatar" style="background:${corAvatar(c.wa_chat_id)}">${UI.escapar(iniciaisContato(c.nome, c.telefone))}</div>
                      <span>${UI.escapar(c.nome || c.telefone)}</span></div>`).join('')
                  : '<p class="dica">Nenhum contato encontrado.</p>';
                resultadosEl.querySelectorAll('.wa-nc-resultado').forEach((item) => item.addEventListener('click', () => {
                  const c = resultadosBusca.find((x) => x.id === Number(item.dataset.id));
                  if (!c) return;
                  if (c.conversa_id) { fechar(); abrirConversaInline(c.conversa_id); }
                  else {
                    // Numero salvo ja vem com o codigo do pais (55); tira antes de por no campo.
                    const semPais = String(c.telefone || '').replace(/\D/g, '').replace(/^55/, '');
                    campo.value = semPais;
                    campo.dispatchEvent(new Event('input'));
                  }
                }));
              } catch (_) { /* ignora falha de busca */ }
            }, 250);
          } else {
            const digitos = valor.replace(/\D/g, '').slice(0, 11);
            campo.value = mascararTelefone(digitos);
            prefixo.style.display = digitos.length ? '' : 'none';
            nomeWrap.style.display = '';
            msgWrap.style.display = '';
            numeroValido = digitos.length === 10 || digitos.length === 11;
            statusEl.innerHTML = digitos.length
              ? (numeroValido ? '<span style="color:var(--sucesso)">✅ Número válido</span>' : '<span style="color:var(--perigo)">❌ Número incompleto</span>')
              : '';
            atualizarBotao();
          }
        });
        textoEl.addEventListener('input', atualizarBotao);
      },
      aoConfirmar: async (el) => {
        const campo = el.querySelector('#nc-campo');
        const telefone = '55' + campo.value.replace(/\D/g, '');
        const nome = el.querySelector('#nc-nome').value;
        const texto = el.querySelector('#nc-texto').value;
        const btn = el.querySelector('[data-confirmar]');
        btn.textContent = 'Criando…';
        try {
          const conversa = await API.post('/api/whatsapp/conversas', { telefone, texto, nome, atendente_id: atendenteAtualId() });
          UI.sucesso('Conversa criada.');
          await carregarLista();
          abrirConversaInline(conversa.id);
        } catch (e) { UI.erro(e.message); btn.textContent = 'Criar conversa'; return false; }
      },
    });
  }

  // ------------------------------- Respostas rápidas -------------------------------

  function abrirListaAtalhos() {
    const disponiveis = respostasRapidas.filter((r) => r.ativo);
    const fechar = Modal.abrir({
      titulo: '⚡ Respostas rápidas', tamanho: 'modal--pequeno', mostrarConfirmar: false,
      corpoHTML: disponiveis.length
        ? disponiveis.map((r) => `
          <div class="wa-atalho-item" data-atalho="${r.id}">
            <strong>/${UI.escapar(r.atalho)}</strong>${r.titulo ? ` — ${UI.escapar(r.titulo)}` : ''}
            <div class="dica">${UI.escapar(r.conteudo)}</div>
          </div>`).join('')
        : '<p class="dica">Nenhuma resposta rápida cadastrada. Configure em "⚡ Respostas rápidas" no topo da tela.</p>',
      aoAbrir: (el) => {
        el.querySelectorAll('[data-atalho]').forEach((item) => item.addEventListener('click', () => {
          const r = respostasRapidas.find((x) => x.id === Number(item.dataset.atalho));
          const inp = document.getElementById('wa-resposta');
          if (inp && r) inp.value = r.conteudo;
          fechar();
        }));
      },
    });
  }

  async function abrirGerenciarAtalhos() {
    try { respostasRapidas = await API.get('/api/whatsapp/respostas-rapidas'); } catch (e) { UI.erro(e.message); return; }
    Modal.abrir({
      titulo: '⚡ Respostas rápidas', tamanho: 'modal--grande', mostrarConfirmar: false,
      corpoHTML: `
        <div class="flex flex--between" style="align-items:center">
          <p class="dica" style="margin:0">Digite "/atalho " (com espaço) na conversa para expandir automaticamente.</p>
          <button class="btn btn--secundario" id="rr-nova" type="button">+ Nova</button>
        </div>
        <div id="rr-lista" class="mt-16"></div>`,
      aoAbrir: (el) => {
        renderListaAtalhosGerenciar(el);
        el.querySelector('#rr-nova').addEventListener('click', () => formAtalho(el));
      },
    });
  }

  function renderListaAtalhosGerenciar(el) {
    const alvo = el.querySelector('#rr-lista');
    if (!alvo) return;
    alvo.innerHTML = respostasRapidas.length ? respostasRapidas.map((r) => `
      <div class="flex flex--between" style="align-items:center;border:1px solid var(--borda);border-radius:8px;padding:8px 12px;margin-bottom:8px;${r.ativo ? '' : 'opacity:.55'}">
        <div><strong>/${UI.escapar(r.atalho)}</strong>${r.titulo ? ` — ${UI.escapar(r.titulo)}` : ''}<div class="dica">${UI.escapar(r.conteudo)}</div></div>
        <div class="flex gap-12">
          <button class="btn btn--secundario" type="button" data-editar="${r.id}">Editar</button>
          <button class="btn btn--perigo" type="button" data-excluir="${r.id}">Excluir</button>
        </div>
      </div>`).join('') : '<p class="dica">Nenhuma resposta rápida cadastrada ainda.</p>';

    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => formAtalho(el, respostasRapidas.find((r) => r.id === Number(b.dataset.editar)))));
    alvo.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir esta resposta rápida?', { titulo: 'Excluir', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try {
        await API.del(`/api/whatsapp/respostas-rapidas/${b.dataset.excluir}`);
        respostasRapidas = respostasRapidas.filter((r) => r.id !== Number(b.dataset.excluir));
        renderListaAtalhosGerenciar(el);
      } catch (e) { UI.erro(e.message); }
    }));
  }

  function formAtalho(elPai, atalho) {
    const ehEdicao = !!atalho;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar resposta rápida' : 'Nova resposta rápida', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Atalho *</label><input id="rr-atalho" value="${UI.escapar(atalho ? atalho.atalho : '')}" placeholder="ex: boleto" /></div>
        <div class="campo mt-16"><label>Título (opcional)</label><input id="rr-titulo" value="${UI.escapar(atalho && atalho.titulo ? atalho.titulo : '')}" /></div>
        <div class="campo mt-16"><label>Conteúdo *</label><textarea id="rr-conteudo">${UI.escapar(atalho ? atalho.conteudo : '')}</textarea></div>`,
      textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        const dados = {
          atalho: el.querySelector('#rr-atalho').value,
          titulo: el.querySelector('#rr-titulo').value,
          conteudo: el.querySelector('#rr-conteudo').value,
        };
        try {
          const salvo = ehEdicao
            ? await API.put(`/api/whatsapp/respostas-rapidas/${atalho.id}`, dados)
            : await API.post('/api/whatsapp/respostas-rapidas', dados);
          if (ehEdicao) Object.assign(atalho, salvo);
          else respostasRapidas.push(salvo);
          renderListaAtalhosGerenciar(elPai);
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ------------------------------- Mensagens agendadas -------------------------------

  async function abrirGerenciarAgendamentos() {
    let agendadas, recorrentes;
    try {
      [agendadas, recorrentes] = await Promise.all([
        API.get('/api/whatsapp/mensagens-agendadas'),
        API.get('/api/whatsapp/mensagens-recorrentes'),
      ]);
    } catch (e) { UI.erro(e.message); return; }

    const fechar = Modal.abrir({
      titulo: '⏰ Mensagens agendadas', tamanho: 'modal--grande', mostrarConfirmar: false,
      corpoHTML: `
        <div class="flex flex--between" style="align-items:center">
          <strong>Envio único</strong>
          <button class="btn btn--secundario" id="ma-nova-unica" type="button">+ Nova</button>
        </div>
        <div id="ma-lista-unicas" class="mt-16 mb-16"></div>
        <hr class="mb-16" />
        <div class="flex flex--between" style="align-items:center">
          <strong>Todo mês</strong>
          <button class="btn btn--secundario" id="ma-nova-recorrente" type="button">+ Nova</button>
        </div>
        <div id="ma-lista-recorrentes" class="mt-16"></div>`,
      aoAbrir: (el) => {
        renderListaAgendadas(el, agendadas);
        renderListaRecorrentes(el, recorrentes);
        el.querySelector('#ma-nova-unica').addEventListener('click', () => {
          fechar();
          formAgendamento('unica', null, () => abrirGerenciarAgendamentos());
        });
        el.querySelector('#ma-nova-recorrente').addEventListener('click', () => {
          fechar();
          formAgendamento('recorrente', null, () => abrirGerenciarAgendamentos());
        });
      },
    });

    function renderListaAgendadas(el, itens) {
      const alvo = el.querySelector('#ma-lista-unicas');
      if (!alvo) return;
      const ROTULO_STATUS = { agendada: '', enviada: 'badge--ok', erro: 'badge--erro', cancelada: 'badge--muted' };
      alvo.innerHTML = itens.length ? itens.map((m) => `
        <div class="flex flex--between" style="align-items:center;border:1px solid var(--borda);border-radius:8px;padding:8px 12px;margin-bottom:8px;${m.status !== 'agendada' ? 'opacity:.6' : ''}">
          <div>
            <strong>${UI.escapar(m.nome || m.telefone)}</strong> — ${UI.dataHora(m.agendado_para)}
            <span class="badge ${ROTULO_STATUS[m.status] || ''}">${m.status}</span>
            <div class="dica">${UI.escapar(m.texto)}</div>
          </div>
          ${m.status === 'agendada' ? `<button class="btn btn--perigo" type="button" data-cancelar="${m.id}">Cancelar</button>` : ''}
        </div>`).join('') : '<p class="dica">Nenhuma mensagem agendada.</p>';
      alvo.querySelectorAll('[data-cancelar]').forEach((b) => b.addEventListener('click', async () => {
        try {
          await API.post(`/api/whatsapp/mensagens-agendadas/${b.dataset.cancelar}/cancelar`, {});
          const item = itens.find((m) => m.id === Number(b.dataset.cancelar));
          if (item) item.status = 'cancelada';
          renderListaAgendadas(el, itens);
        } catch (e) { UI.erro(e.message); }
      }));
    }

    function renderListaRecorrentes(el, itens) {
      const alvo = el.querySelector('#ma-lista-recorrentes');
      if (!alvo) return;
      alvo.innerHTML = itens.length ? itens.map((r) => `
        <div class="flex flex--between" style="align-items:center;border:1px solid var(--borda);border-radius:8px;padding:8px 12px;margin-bottom:8px;${r.ativo ? '' : 'opacity:.55'}">
          <div>
            <strong>${UI.escapar(r.nome || r.telefone)}</strong> — todo dia ${r.dia_mes} às ${r.hora}
            <div class="dica">${UI.escapar(r.texto)}</div>
          </div>
          <button class="btn btn--perigo" type="button" data-excluir-rec="${r.id}">Excluir</button>
        </div>`).join('') : '<p class="dica">Nenhuma mensagem recorrente.</p>';
      alvo.querySelectorAll('[data-excluir-rec]').forEach((b) => b.addEventListener('click', async () => {
        const ok = await UI.confirmar('Excluir esta mensagem recorrente?', { titulo: 'Excluir', textoConfirmar: 'Excluir' });
        if (!ok) return;
        try {
          await API.del(`/api/whatsapp/mensagens-recorrentes/${b.dataset.excluirRec}`);
          const idx = itens.findIndex((r) => r.id === Number(b.dataset.excluirRec));
          if (idx >= 0) itens.splice(idx, 1);
          renderListaRecorrentes(el, itens);
        } catch (e) { UI.erro(e.message); }
      }));
    }
  }

  /**
   * Agenda uma mensagem (unica ou recorrente) para um contato. Se contatoPreset
   * for informado (ex.: chamado de dentro de uma conversa aberta), o contato
   * fica travado; senao, mostra um campo de busca.
   */
  function formAgendamento(tipo, contatoPreset, aoSalvar) {
    let contatoEscolhido = contatoPreset || null;
    Modal.abrir({
      titulo: tipo === 'unica' ? '⏰ Agendar mensagem (uma vez)' : '⏰ Agendar mensagem (todo mês)', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo">
          <label>Contato *</label>
          ${contatoPreset
            ? `<input value="${UI.escapar(contatoPreset.nome || contatoPreset.telefone || '')}" disabled />`
            : `<input id="ag-contato-busca" placeholder="Buscar contato…" autocomplete="off" /><div id="ag-contato-resultados"></div>`}
        </div>
        ${tipo === 'unica'
          ? `<div class="form-grid mt-16">
              <div class="campo"><label>Data *</label><input id="ag-data" type="date" /></div>
              <div class="campo"><label>Hora *</label><input id="ag-hora" type="time" value="09:00" /></div>
            </div>`
          : `<div class="form-grid mt-16">
              <div class="campo"><label>Dia do mês *</label><input id="ag-dia-mes" type="number" min="1" max="31" value="1" /></div>
              <div class="campo"><label>Hora *</label><input id="ag-hora" type="time" value="09:00" /></div>
            </div>`}
        <div class="campo mt-16"><label>Mensagem *</label><textarea id="ag-texto"></textarea></div>`,
      textoConfirmar: 'Agendar',
      aoAbrir: (el) => {
        if (contatoPreset) return;
        const busca = el.querySelector('#ag-contato-busca');
        const resultados = el.querySelector('#ag-contato-resultados');
        let timer = null;
        busca.addEventListener('input', () => {
          contatoEscolhido = null;
          clearTimeout(timer);
          const v = busca.value.trim();
          resultados.innerHTML = '';
          if (!v) return;
          timer = setTimeout(async () => {
            try {
              const r = await API.get(`/api/whatsapp/contatos?busca=${encodeURIComponent(v)}`);
              const lista = r.slice(0, 6);
              resultados.innerHTML = lista.length
                ? lista.map((c) => `<div class="wa-nc-resultado" data-id="${c.id}">
                    <div class="wa-avatar" style="background:${corAvatar(c.wa_chat_id)}">${UI.escapar(iniciaisContato(c.nome, c.telefone))}</div>
                    <span>${UI.escapar(c.nome || c.telefone)}</span></div>`).join('')
                : '<p class="dica">Nenhum contato encontrado.</p>';
              resultados.querySelectorAll('.wa-nc-resultado').forEach((item) => item.addEventListener('click', () => {
                const c = lista.find((x) => x.id === Number(item.dataset.id));
                contatoEscolhido = c;
                busca.value = c.nome || c.telefone;
                resultados.innerHTML = '';
              }));
            } catch (_) { /* ignora falha de busca */ }
          }, 250);
        });
      },
      aoConfirmar: async (el) => {
        const texto = el.querySelector('#ag-texto').value;
        const contatoId = contatoPreset ? contatoPreset.id : (contatoEscolhido && contatoEscolhido.id);
        if (!contatoId) { UI.erro('Escolha um contato.'); return false; }
        if (!texto.trim()) { UI.erro('Escreva a mensagem.'); return false; }
        try {
          if (tipo === 'unica') {
            const data = el.querySelector('#ag-data').value;
            const hora = el.querySelector('#ag-hora').value;
            if (!data || !hora) { UI.erro('Informe data e hora.'); return false; }
            await API.post('/api/whatsapp/mensagens-agendadas', { contato_id: contatoId, texto, agendado_para: `${data} ${hora}:00` });
          } else {
            const diaMes = el.querySelector('#ag-dia-mes').value;
            const hora = el.querySelector('#ag-hora').value;
            await API.post('/api/whatsapp/mensagens-recorrentes', { contato_id: contatoId, texto, dia_mes: diaMes, hora });
          }
          UI.sucesso('Mensagem agendada.');
          if (aoSalvar) aoSalvar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ------------------------------- Bot configuravel -------------------------------

  async function abrirConfigBot() {
    let cfg, regras;
    try {
      [cfg, regras] = await Promise.all([API.get('/api/whatsapp/bot/config'), API.get('/api/whatsapp/bot/regras')]);
    } catch (e) { UI.erro(e.message); return; }

    Modal.abrir({
      titulo: '🤖 Bot de primeiro atendimento', tamanho: 'modal--grande',
      corpoHTML: `
        <div class="campo">
          <label><input type="checkbox" id="bot-ativo" ${cfg.ativo ? 'checked' : ''} /> Bot ativo (responde automaticamente até um atendente assumir a conversa)</label>
        </div>
        <div class="campo mt-16"><label>Mensagem de saudação (1ª mensagem do cliente)</label>
          <textarea id="bot-saudacao" placeholder="Olá! Bem-vindo(a)…">${UI.escapar(cfg.saudacao)}</textarea></div>
        <div class="campo mt-16"><label>Menu de opções</label>
          <textarea id="bot-menu" placeholder="1 - Orçamento&#10;2 - Falar com atendente">${UI.escapar(cfg.menuTexto)}</textarea>
          <p class="dica">Enviado logo após a saudação e reenviado quando o cliente digitar algo que o bot não reconhece.</p></div>
        <hr class="mt-16 mb-16" />
        <div class="flex flex--between" style="align-items:center">
          <strong>Regras de resposta</strong>
          <button class="btn btn--secundario" id="bot-nova-regra" type="button">+ Nova regra</button>
        </div>
        <div id="bot-regras" class="mt-16"></div>`,
      textoConfirmar: 'Salvar configuração',
      aoAbrir: (el) => {
        renderRegrasBot(el, regras);
        el.querySelector('#bot-nova-regra').addEventListener('click', () => formRegraBot(el, regras));
      },
      aoConfirmar: async (el) => {
        try {
          await API.put('/api/whatsapp/bot/config', {
            ativo: el.querySelector('#bot-ativo').checked,
            saudacao: el.querySelector('#bot-saudacao').value,
            menuTexto: el.querySelector('#bot-menu').value,
          });
          UI.sucesso('Configuração do bot salva.');
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  function renderRegrasBot(el, regras) {
    const alvo = el.querySelector('#bot-regras');
    if (!alvo) return;
    alvo.innerHTML = regras.length ? regras.map((r) => `
      <div class="flex flex--between" style="align-items:center;border:1px solid var(--borda);border-radius:8px;padding:8px 12px;margin-bottom:8px;${r.ativo ? '' : 'opacity:.55'}">
        <div>
          <strong>${r.gatilho_tipo === 'opcao_menu' ? 'Opção do menu' : 'Palavra-chave'}:</strong> ${UI.escapar(r.gatilho)}
          ${r.transfere_humano ? ' <span class="badge">transfere p/ atendente</span>' : ''}
          <div class="dica">${UI.escapar(r.resposta)}</div>
        </div>
        <div class="flex gap-12">
          <button class="btn btn--secundario" type="button" data-editar-regra="${r.id}">Editar</button>
          <button class="btn btn--perigo" type="button" data-excluir-regra="${r.id}">Excluir</button>
        </div>
      </div>`).join('') : '<p class="dica">Nenhuma regra cadastrada ainda.</p>';

    alvo.querySelectorAll('[data-editar-regra]').forEach((b) => b.addEventListener('click', () => {
      formRegraBot(el, regras, regras.find((r) => r.id === Number(b.dataset.editarRegra)));
    }));
    alvo.querySelectorAll('[data-excluir-regra]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir esta regra do bot?', { titulo: 'Excluir regra', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try {
        await API.del(`/api/whatsapp/bot/regras/${b.dataset.excluirRegra}`);
        const idx = regras.findIndex((r) => r.id === Number(b.dataset.excluirRegra));
        if (idx >= 0) regras.splice(idx, 1);
        renderRegrasBot(el, regras);
      } catch (e) { UI.erro(e.message); }
    }));
  }

  function formRegraBot(elPai, regras, regra) {
    const ehEdicao = !!regra;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar regra do bot' : 'Nova regra do bot', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Tipo de gatilho</label>
          <select id="rb-tipo">
            <option value="palavra_chave" ${regra && regra.gatilho_tipo === 'palavra_chave' ? 'selected' : ''}>Palavra-chave (uma ou mais, separadas por vírgula)</option>
            <option value="opcao_menu" ${regra && regra.gatilho_tipo === 'opcao_menu' ? 'selected' : ''}>Opção exata do menu (ex: "1")</option>
          </select></div>
        <div class="campo mt-16"><label>Gatilho *</label><input id="rb-gatilho" value="${UI.escapar(regra ? regra.gatilho : '')}" placeholder="ex: orçamento, preço, valor" /></div>
        <div class="campo mt-16"><label>Resposta *</label><textarea id="rb-resposta">${UI.escapar(regra ? regra.resposta : '')}</textarea></div>
        <div class="campo mt-16"><label><input type="checkbox" id="rb-transfere" ${regra && regra.transfere_humano ? 'checked' : ''} /> Transferir para atendente humano após esta resposta</label></div>`,
      textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        const dados = {
          gatilho_tipo: el.querySelector('#rb-tipo').value,
          gatilho: el.querySelector('#rb-gatilho').value,
          resposta: el.querySelector('#rb-resposta').value,
          transfere_humano: el.querySelector('#rb-transfere').checked,
        };
        try {
          const salva = ehEdicao
            ? await API.put(`/api/whatsapp/bot/regras/${regra.id}`, dados)
            : await API.post('/api/whatsapp/bot/regras', dados);
          if (ehEdicao) Object.assign(regra, salva);
          else regras.push(salva);
          renderRegrasBot(elPai, regras);
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { titulo: 'Atendimento', render };
})();
