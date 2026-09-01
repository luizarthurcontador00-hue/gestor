# Gestor de Vendas / CONTAFLOW desktop

Electron + Express + better-sqlite3. Frontend em **JS puro** (sem framework,
sem bundler, sem build step): cada página é um `<script>` carregado direto em
`src/frontend/index.html`.

## Onde mexer

- **Página nova/existente**: `src/frontend/js/pages/<dominio>.js`, expondo
  `window.PaginaXxx = (function () { ...; return { titulo, render }; })();`.
  Registrar a rota em `src/frontend/js/app.js` (`rotas`) e adicionar o
  `<script>` em `src/frontend/index.html`.
- **Serviço novo/existente (regra de negócio + SQL)**:
  `src/backend/services/<dominio>Service.js`, chamado pela rota fina
  correspondente em `src/backend/routes/<dominio>.js` (montada em
  `server.js` via `montarRota`).
- **UI compartilhada**: `src/frontend/js/ui.js` (`UI.moeda`, `UI.escapar`,
  `UI.debounce`, `UI.dataHora`, toasts, máscara de documento) e
  `src/frontend/js/componentes/` (Modal, gráficos, PDF de documentos,
  leitor de código de barras, avisos). Não reimplementar o que já existe
  aqui — o `UI.debounce`/`UI.moeda` já eram duplicados em várias páginas
  antes de serem centralizados.
- **Utilitário de backend compartilhado**: `src/backend/utils/` —
  `errors.js` (`AppError`, `asyncHandler`), `datas.js` (`hoje()`). Para
  arredondamento monetário/percentual, usar `arred()` de
  `src/backend/services/precificacaoService.js` (já importado por 13
  serviços), não reimplementar `Math.round(x * 100) / 100`.

## Regras

- Não introduzir framework, bundler ou TypeScript sem pedido explícito —
  o app inteiro roda hoje sem build step.
- Não criar abstrações genéricas (ex.: "CRUD page factory") para substituir
  o padrão `Modal.abrir({ aoAbrir, aoConfirmar })` já usado de forma
  consistente em ~30 páginas — reutilizar o padrão existente, não abstraí-lo.
- Trabalhar preferencialmente só dentro da página/serviço relacionado à
  tarefa — a maioria das páginas já é independente por domínio
  (`pages/financeiro.js`, `pages/clientes.js` etc.), não precisa ler o
  sistema inteiro pra alterar uma.
- Não alterar funcionalidades não relacionadas ao pedido.
- `npm run rebuild` é necessário depois de `npm install` (recompila o
  módulo nativo `better-sqlite3` para a ABI do Electron) antes de
  `npm run dev`/`npm start`; `npm run server` roda só o backend Express puro
  (sem Electron) em `http://localhost:3000`, útil pra testar sem recompilar.
