'use strict';

/**
 * Componente de modal reutilizavel.
 *
 * Modal.abrir({ titulo, corpoHTML, tamanho, textoConfirmar, aoConfirmar, aoAbrir })
 *  - aoConfirmar: async function(modalEl) -> retorne false para NAO fechar.
 *  - aoAbrir(modalEl): chamada apos renderizar (para ligar eventos/preencher).
 * Retorna uma funcao fechar().
 */
window.Modal = (function () {
  // Modais podem se empilhar (ex.: cadastro rapido sobre um formulario): o Esc
  // fecha so' o de cima, o ultimo overlay no DOM (mesmo z-index, vence a ordem).
  function ehTopo(overlay) {
    const todos = document.querySelectorAll('.modal-overlay');
    return todos[todos.length - 1] === overlay;
  }

  function abrir(opcoes) {
    const {
      titulo = '',
      corpoHTML = '',
      tamanho = '',
      textoConfirmar = 'Salvar',
      mostrarConfirmar = true,
      aoConfirmar = null,
      aoAbrir = null,
    } = opcoes;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal ${tamanho}">
        <div class="modal__head">
          <h2>${UI.escapar(titulo)}</h2>
          <button class="modal__fechar" title="Fechar" data-fechar>&times;</button>
        </div>
        <div class="modal__body">${corpoHTML}</div>
        <div class="modal__foot">
          <button class="btn btn--secundario" data-fechar>Cancelar</button>
          ${mostrarConfirmar ? `<button class="btn" data-confirmar>${UI.escapar(textoConfirmar)}</button>` : ''}
        </div>
      </div>`;

    function fechar() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }

    function onKey(e) {
      if (e.key === 'Escape' && ehTopo(overlay)) fechar();
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) fechar();
      if (e.target.closest('[data-fechar]')) fechar();
    });

    const btnConfirmar = overlay.querySelector('[data-confirmar]');
    if (btnConfirmar && aoConfirmar) {
      btnConfirmar.addEventListener('click', async () => {
        btnConfirmar.disabled = true;
        try {
          const r = await aoConfirmar(overlay);
          if (r !== false) fechar();
        } catch (err) {
          UI.erro(err.message || 'Erro ao salvar.');
        } finally {
          btnConfirmar.disabled = false;
        }
      });
    }

    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    if (aoAbrir) aoAbrir(overlay);
    return fechar;
  }

  /** Confirmacao de acao destrutiva com estilo proprio. Retorna Promise<boolean>. */
  function confirmar({ titulo = 'Confirmar', mensagem = '', textoConfirmar = 'Confirmar', perigo = true } = {}) {
    return new Promise((resolve) => {
      let respondido = false;
      const responder = (valor) => {
        if (respondido) return;
        respondido = true;
        resolve(valor);
      };

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal modal--pequeno">
          <div class="modal__head">
            <h2>${UI.escapar(titulo)}</h2>
            <button class="modal__fechar" data-cancelar>&times;</button>
          </div>
          <div class="modal__body"><p style="margin:0">${UI.escapar(mensagem)}</p></div>
          <div class="modal__foot">
            <button class="btn btn--secundario" data-cancelar>Cancelar</button>
            <button class="btn ${perigo ? 'btn--perigo' : ''}" data-ok>${UI.escapar(textoConfirmar)}</button>
          </div>
        </div>`;

      function fechar(valor) {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        responder(valor);
      }
      function onKey(e) { if (e.key === 'Escape' && ehTopo(overlay)) fechar(false); }

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.closest('[data-cancelar]')) fechar(false);
        if (e.target.closest('[data-ok]')) fechar(true);
      });

      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
    });
  }

  return { abrir, confirmar };
})();
