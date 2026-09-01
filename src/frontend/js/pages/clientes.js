'use strict';

/**
 * Pagina de Clientes: cadastro, busca, saldo devedor (fiado) e detalhe com
 * historico de compras e contas a receber. Para o ramo "professor" (aulas
 * particulares), a mesma tela e os mesmos dados aparecem como "Alunos".
 */
window.PaginaClientes = (function () {
  const ehProfessor = () => window.__ramoServico === 'professor';
  // No instituto nao ha venda nem fiado: a pessoa e aluno ou mantenedor.
  const ehInstituto = () => window.__ramoServico === 'instituto';
  // Creche cobra mensalidade, nao fiado; usa os mesmos campos de aluno do instituto.
  const ehCreche = () => window.__ramoServico === 'creche';
  const rotulo = (maiusc) => {
    if (ehInstituto()) return maiusc ? 'Pessoa' : 'pessoa';
    return (ehProfessor() || ehCreche()) ? (maiusc ? 'Aluno' : 'aluno') : (maiusc ? 'Cliente' : 'cliente');
  };

  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <input type="search" id="cl-busca" class="cresce" placeholder="Buscar por nome, CPF ou telefone…" />
        <button class="btn" id="cl-novo">+ Novo ${rotulo()}</button>
      </div>
      <div class="card"><div id="cl-lista">Carregando…</div></div>`;
    container.querySelector('#cl-busca').addEventListener('input', UI.debounce(listar, 250));
    container.querySelector('#cl-novo').addEventListener('click', () => formCliente());
    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('cl-lista');
    if (!alvo) return;
    const busca = document.getElementById('cl-busca').value;
    let clientes;
    try { clientes = await API.get('/api/clientes' + (busca ? '?busca=' + encodeURIComponent(busca) : '')); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!clientes.length) { alvo.innerHTML = `<p class="muted">Nenhum ${rotulo()} cadastrado.</p>`; return; }
    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>Nome</th><th>Telefone</th><th>CPF</th><th>${ehInstituto() ? 'Perfil' : 'Deve (fiado)'}</th><th></th></tr></thead>
      <tbody>${clientes.map((c) => `<tr>
        <td>${UI.escapar(c.nome)}</td><td>${UI.escapar(c.telefone || '—')}</td><td>${UI.escapar(c.cpf || '—')}</td>
        <td>${ehInstituto()
          ? `<span class="badge badge--muted">${{ aluno: 'Aluno', mantenedor: 'Mantenedor', ambos: 'Aluno e mantenedor' }[c.natureza || 'aluno']}</span>`
          : (Number(c.saldo_devedor) > 0 ? `<span class="badge badge--alerta">${UI.moeda(c.saldo_devedor)}</span>` : '<span class="muted">—</span>')}</td>
        <td style="text-align:right"><button class="btn btn--secundario" data-ver="${c.id}">Ver</button></td>
      </tr>`).join('')}</tbody></table>`;
    alvo.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => detalhe(Number(b.dataset.ver))));
  }

  function formCliente(cliente) {
    const c = cliente || {};
    const ed = !!cliente;
    Modal.abrir({
      titulo: ed ? `Editar ${rotulo()}` : `Novo ${rotulo()}`, tamanho: 'modal--grande',
      corpoHTML: `<form id="fc" class="form-grid">
        <div class="campo col-2"><label>Nome *</label><input name="nome" value="${UI.escapar(c.nome || '')}" required /></div>
        <div class="campo col-2" id="cli-foto-campo">
          <label>Foto</label>
          ${ed ? `
            <div class="flex gap-12" style="align-items:center">
              <div class="foto-preview" id="cli-foto-preview" style="width:96px;height:96px;border-radius:8px;overflow:hidden;background:var(--fundo-alt,#f1f1f1);display:flex;align-items:center;justify-content:center;font-size:36px">
                ${c.foto_path ? `<img src="/uploads/pessoas/${encodeURIComponent(c.foto_path)}" alt="" style="width:100%;height:100%;object-fit:cover">` : '👤'}
              </div>
              <div>
                <input type="file" id="cli-foto-input" accept="image/*" style="display:none" />
                <button type="button" class="btn btn--secundario" id="cli-foto-btn">📷 Alterar foto</button>
              </div>
            </div>
          ` : '<span class="dica">Salve o cadastro para adicionar uma foto.</span>'}
        </div>
        <div class="campo"><label>Telefone</label><input name="telefone" value="${UI.escapar(c.telefone || '')}" /></div>
        <div class="campo"><label>CPF</label><input name="cpf" value="${UI.escapar(c.cpf || '')}" /></div>
        <div class="campo"><label>E-mail</label><input name="email" type="email" value="${UI.escapar(c.email || '')}" /></div>
        ${(ehInstituto() || ehCreche()) ? '' : `<div class="campo"><label>Limite de crédito (fiado) R$</label><input name="limite_credito" type="number" step="0.01" min="0" value="${c.limite_credito != null ? c.limite_credito : 0}" /></div>`}
        ${ehInstituto() ? `
        <div class="campo"><label>Natureza do cadastro</label>
          <select name="natureza">
            <option value="aluno" ${(c.natureza || 'aluno') === 'aluno' ? 'selected' : ''}>Aluno</option>
            <option value="mantenedor" ${c.natureza === 'mantenedor' ? 'selected' : ''}>Mantenedor</option>
            <option value="ambos" ${c.natureza === 'ambos' ? 'selected' : ''}>Aluno e mantenedor</option>
          </select>
          <span class="dica">Mantenedores aparecem em Arrecadação.</span></div>
        ` : ''}
        ${(ehInstituto() || ehCreche()) ? `
        <div class="campo"><label>Data de nascimento</label>
          <input name="data_nascimento" type="date" value="${UI.escapar(c.data_nascimento || '')}" /></div>
        <div class="campo"><label>Nome do responsável</label>
          <input name="responsavel_nome" value="${UI.escapar(c.responsavel_nome || '')}" />
          <span class="dica">Obrigatório na prática para alunos menores de idade.</span></div>
        <div class="campo"><label>Telefone do responsável</label>
          <input name="responsavel_telefone" value="${UI.escapar(c.responsavel_telefone || '')}" /></div>
        ` : ''}
        ${ehInstituto() ? `
        <div class="campo col-2" id="cli-instr-proprios" style="border-top:1px solid var(--borda);padding-top:14px">
          <label>Instrumentos próprios do aluno</label>
          <span class="dica">Aluno que traz o próprio instrumento não ocupa vaga do acervo — é o que permite a turma ser maior que a quantidade de instrumentos do instituto.</span>
          <div id="cli-instr-lista" class="mt-16"><span class="dica">Carregando…</span></div>
        </div>
        ` : ''}
        <div class="campo col-2"><label>Endereço</label><input name="endereco" value="${UI.escapar(c.endereco || '')}" /></div>
        <div class="campo col-2"><label>Observação</label><textarea name="observacao">${UI.escapar(c.observacao || '')}</textarea></div>
      </form>`,
      textoConfirmar: 'Salvar',
      aoAbrir: async (el) => {
        UI.ligarMascaraDocumento(el.querySelector('[name="cpf"]'));
        if (ed) {
          const btnFoto = el.querySelector('#cli-foto-btn');
          const inputFoto = el.querySelector('#cli-foto-input');
          if (btnFoto && inputFoto) {
            btnFoto.addEventListener('click', () => inputFoto.click());
            inputFoto.addEventListener('change', async () => {
              const arq = inputFoto.files[0];
              inputFoto.value = '';
              if (!arq) return;
              const fd = new FormData();
              fd.append('foto', arq);
              try {
                const atualizado = await API.post(`/api/clientes/${cliente.id}/foto`, fd);
                c.foto_path = atualizado.foto_path;
                const prev = el.querySelector('#cli-foto-preview');
                if (prev) prev.innerHTML = `<img src="/uploads/pessoas/${encodeURIComponent(atualizado.foto_path)}" alt="" style="width:100%;height:100%;object-fit:cover">`;
                UI.sucesso('Foto atualizada.');
              } catch (e) { UI.erro(e.message); }
            });
          }
        }
        const wrap = el.querySelector('#cli-instr-lista');
        if (!wrap) return;
        let instrumentos = [];
        let proprios = [];
        try {
          [instrumentos, proprios] = await Promise.all([
            API.get('/api/instrumentos'),
            ed ? API.get(`/api/instrumentos/proprios/${cliente.id}`) : Promise.resolve([]),
          ]);
        } catch (_) { wrap.innerHTML = '<span class="dica">Não foi possível carregar os instrumentos.</span>'; return; }

        if (!instrumentos.length) {
          wrap.innerHTML = '<span class="dica">Nenhum instrumento cadastrado no acervo ainda.</span>';
          return;
        }
        const tem = new Set(proprios.map((p) => p.instrumento_id));
        wrap.innerHTML = instrumentos.map((i) => `
          <label class="flex gap-12" style="align-items:center;padding:4px 0;cursor:pointer">
            <input type="checkbox" class="cli-instr" value="${i.id}" ${tem.has(i.id) ? 'checked' : ''} />
            <span>${UI.escapar(i.nome)}</span>
          </label>`).join('');
      },
      aoConfirmar: async (el) => {
        const f = el.querySelector('#fc');
        if (!f.nome.value.trim()) { UI.erro('Informe o nome.'); return false; }
        const body = Object.fromEntries(new FormData(f).entries());
        const marcados = Array.from(el.querySelectorAll('.cli-instr:checked')).map((c2) => Number(c2.value));
        const temSecaoInstrumentos = !!el.querySelector('#cli-instr-lista');
        try {
          const salvo = ed
            ? await API.put('/api/clientes/' + cliente.id, body)
            : await API.post('/api/clientes', body);
          if (temSecaoInstrumentos) {
            const alunoId = (salvo && salvo.id) || (ed ? cliente.id : null);
            if (alunoId) await API.put(`/api/instrumentos/proprios/${alunoId}`, { instrumento_ids: marcados });
          }
          UI.sucesso(`${rotulo(true)} salvo.`); await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function detalhe(id) {
    let c;
    try { c = await API.get('/api/clientes/' + id); } catch (e) { UI.erro(e.message); return; }
    const corpo = `
      ${(ehInstituto() || ehCreche()) ? '' : `<div class="grid grid--cards mb-16">
        <div class="card stat"><span class="stat__label">Deve (fiado)</span><span class="stat__value" style="font-size:22px;color:${Number(c.saldo_devedor) > 0 ? 'var(--alerta)' : 'var(--sucesso)'}">${UI.moeda(c.saldo_devedor)}</span></div>
        <div class="card stat"><span class="stat__label">Limite de crédito</span><span class="stat__value" style="font-size:22px">${UI.moeda(c.limite_credito)}</span></div>
        <div class="card stat"><span class="stat__label">Compras</span><span class="stat__value" style="font-size:22px">${c.compras.length}</span></div>
      </div>`}
      <table class="tabela mb-16">
        <tr><th>Telefone</th><td>${UI.escapar(c.telefone || '—')}</td><th>CPF</th><td>${UI.escapar(c.cpf || '—')}</td></tr>
        <tr><th>E-mail</th><td>${UI.escapar(c.email || '—')}</td><th>Endereço</th><td>${UI.escapar(c.endereco || '—')}</td></tr>
      </table>
      <h3>${(ehInstituto() || ehCreche()) ? 'Cobranças a receber' : 'Contas a receber (fiado)'}</h3>
      ${c.contas.length ? `<table class="tabela"><thead><tr><th>Descrição</th><th>Venc.</th><th>Valor</th><th>Situação</th></tr></thead>
        <tbody>${c.contas.map((ct) => `<tr><td>${UI.escapar(ct.descricao)}</td><td>${ct.vencimento ? UI.dataHora(ct.vencimento) : '—'}</td><td>${UI.moeda(ct.valor)}</td>
          <td>${ct.status === 'pendente' ? '<span class="badge badge--alerta">Pendente</span>' : ct.status === 'recebido' ? '<span class="badge badge--ok">Recebido</span>' : '<span class="badge badge--muted">Cancelada</span>'}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">Nenhuma conta.</p>'}
      ${(ehInstituto() || ehCreche()) ? '' : `<h3 class="mt-16">Últimas compras</h3>
      ${c.compras.length ? `<table class="tabela"><thead><tr><th>#</th><th>Data</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>${c.compras.map((v) => `<tr><td>${v.id}</td><td>${UI.dataHora(v.data)}</td><td>${UI.moeda(v.valor_total)}</td><td>${v.status}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">Nenhuma compra.</p>'}`}`;

    Modal.abrir({
      titulo: c.nome, tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        const foot = el.querySelector('.modal__foot');
        const bEdit = document.createElement('button');
        bEdit.className = 'btn'; bEdit.textContent = 'Editar';
        bEdit.addEventListener('click', () => { el.remove(); formCliente(c); });
        const bDel = document.createElement('button');
        bDel.className = 'btn btn--perigo'; bDel.textContent = 'Excluir';
        bDel.addEventListener('click', async () => {
          const ok = await UI.confirmar(`Excluir o ${rotulo()} "${c.nome}"? Se tiver histórico, será apenas inativado.`, { titulo: `Excluir ${rotulo()}`, textoConfirmar: 'Excluir' });
          if (!ok) return;
          try { const r = await API.del('/api/clientes/' + c.id); UI.sucesso(r.inativado ? `${rotulo(true)} inativado.` : `${rotulo(true)} excluído.`); el.remove(); await listar(); }
          catch (e) { UI.erro(e.message); }
        });
        foot.insertBefore(bDel, foot.firstChild);
        foot.insertBefore(bEdit, foot.firstChild);

        // No instituto, a secretaria precisa dos papéis do aluno na mão.
        if (ehInstituto()) {
          const bFicha = document.createElement('button');
          bFicha.className = 'btn btn--secundario'; bFicha.textContent = '📄 Ficha em PDF';
          bFicha.addEventListener('click', () => Documentos.fichaDoAluno(c.id));
          const bDocs = document.createElement('button');
          bDocs.className = 'btn btn--secundario'; bDocs.textContent = '🧾 Documentos';
          bDocs.addEventListener('click', () => menuDocumentos(c));
          foot.insertBefore(bDocs, foot.firstChild);
          foot.insertBefore(bFicha, foot.firstChild);
        }
      },
    });
  }

  /** Escolhe qual documento emitir para o aluno (declaração ou certificado). */
  async function menuDocumentos(cliente) {
    let ficha;
    try { ficha = await API.get(`/api/instituto/ficha-aluno/${cliente.id}`); }
    catch (e) { UI.erro(e.message); return; }

    const ativas = ficha.matriculas.filter((m) => m.status === 'ativa');
    const concluidas = ficha.matriculas.filter((m) => m.status === 'concluida');

    Modal.abrir({
      titulo: `Documentos — ${cliente.nome}`, tamanho: 'modal--pequeno', mostrarConfirmar: false,
      corpoHTML: `
        <div class="campo">
          <label>Declaração de matrícula</label>
          ${ativas.length
            ? `<p class="dica" style="margin-top:0">Comprova que o aluno frequenta o instituto (${ativas.map((m) => UI.escapar(m.curso_nome)).join(', ')}).</p>
               <button class="btn" id="doc-matricula">📄 Emitir declaração</button>`
            : '<p class="dica" style="margin-top:0">Só sai para quem tem matrícula ativa. Este aluno não está em nenhuma turma aberta.</p>'}
        </div>
        <div class="campo mt-16" style="border-top:1px solid var(--borda);padding-top:16px">
          <label>Certificado de conclusão</label>
          ${concluidas.length
            ? `<select id="doc-turma">${concluidas.map((m) => `<option value="${m.turma_id}">${UI.escapar(m.curso_nome)} — ${UI.escapar(m.turma_nome)}</option>`).join('')}</select>
               <button class="btn mt-16" id="doc-certificado">🎓 Emitir certificado</button>`
            : '<p class="dica" style="margin-top:0">Sai para turma concluída. Encerre a turma (ou marque a matrícula como concluída) para liberar.</p>'}
        </div>`,
      aoAbrir: (el) => {
        const bm = el.querySelector('#doc-matricula');
        if (bm) bm.addEventListener('click', () => Documentos.declaracaoMatricula(cliente.id));
        const bc = el.querySelector('#doc-certificado');
        if (bc) bc.addEventListener('click', () => Documentos.certificado(cliente.id, el.querySelector('#doc-turma').value));
      },
    });
  }


  return { titulo: 'Clientes', render };
})();
