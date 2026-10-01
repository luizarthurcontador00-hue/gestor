'use strict';

/**
 * Migrations versionadas do banco.
 *
 * Cada item do array `migrations` tem { version, up(db) }. Ao iniciar, o
 * sistema le a versao atual em `schema_version` e aplica, em ordem, todas as
 * migrations com versao maior. Assim o schema evolui sem perder dados do
 * usuario final entre atualizacoes do app.
 */

const { getDb } = require('./connection');

const migrations = [
  {
    version: 1,
    name: 'schema-inicial',
    up(db) {
      db.exec(`
        -- ============================ Categorias ============================
        CREATE TABLE IF NOT EXISTS categorias (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          nome          TEXT NOT NULL UNIQUE,
          markup_padrao REAL,                       -- % de markup padrao da categoria
          criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        -- ========================== Fornecedores ===========================
        CREATE TABLE IF NOT EXISTS fornecedores (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          nome      TEXT NOT NULL,
          cnpj      TEXT UNIQUE,
          contato   TEXT,
          telefone  TEXT,
          email     TEXT,
          criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        -- ============================ Produtos =============================
        CREATE TABLE IF NOT EXISTS produtos (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          nome           TEXT NOT NULL,
          descricao      TEXT,
          codigo_barras  TEXT,                       -- EAN
          categoria_id   INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
          fornecedor_id  INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
          unidade        TEXT NOT NULL DEFAULT 'UN',
          custo          REAL NOT NULL DEFAULT 0,
          markup         REAL,                        -- % markup do produto (sobrepoe a categoria)
          preco_venda    REAL NOT NULL DEFAULT 0,
          estoque_atual  REAL NOT NULL DEFAULT 0,
          estoque_minimo REAL NOT NULL DEFAULT 0,
          foto_path      TEXT,                        -- nome do arquivo em uploads/produtos
          ativo          INTEGER NOT NULL DEFAULT 1,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          atualizado_em  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_produtos_codigo_barras ON produtos(codigo_barras);
        CREATE INDEX IF NOT EXISTS idx_produtos_nome ON produtos(nome);
        CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON produtos(categoria_id);

        -- ============================ Compras ==============================
        CREATE TABLE IF NOT EXISTS compras (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          fornecedor_id   INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
          numero_nf       TEXT,
          chave_nfe       TEXT UNIQUE,                -- chave de acesso (44 digitos) p/ evitar duplicidade
          xml_path        TEXT,                       -- nome do arquivo em uploads/notas
          data_emissao    TEXT,
          data_importacao TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          valor_total     REAL NOT NULL DEFAULT 0,
          status          TEXT NOT NULL DEFAULT 'importada'  -- importada | cancelada
        );

        CREATE TABLE IF NOT EXISTS compras_itens (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          compra_id      INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
          produto_id     INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
          codigo_fornec  TEXT,                        -- codigo do produto no fornecedor (cProd)
          descricao_nf   TEXT,                        -- descricao como veio na NF
          ncm            TEXT,
          ean            TEXT,
          quantidade     REAL NOT NULL DEFAULT 0,
          valor_unitario REAL NOT NULL DEFAULT 0,
          valor_total    REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_compras_itens_compra ON compras_itens(compra_id);

        -- ============================= Vendas ==============================
        CREATE TABLE IF NOT EXISTS vendas (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          data        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          valor_bruto REAL NOT NULL DEFAULT 0,        -- soma dos itens antes do desconto
          desconto    REAL NOT NULL DEFAULT 0,
          valor_total REAL NOT NULL DEFAULT 0,        -- valor_bruto - desconto
          status      TEXT NOT NULL DEFAULT 'concluida', -- concluida | cancelada
          caixa_id    INTEGER REFERENCES caixa(id) ON DELETE SET NULL,
          observacao  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_vendas_data ON vendas(data);
        CREATE INDEX IF NOT EXISTS idx_vendas_status ON vendas(status);

        CREATE TABLE IF NOT EXISTS vendas_itens (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          venda_id       INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
          produto_id     INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
          descricao      TEXT,                        -- snapshot do nome do produto na venda
          quantidade     REAL NOT NULL DEFAULT 0,
          preco_unitario REAL NOT NULL DEFAULT 0,
          custo_unitario REAL NOT NULL DEFAULT 0,     -- snapshot do custo p/ calculo de margem
          desconto_item  REAL NOT NULL DEFAULT 0,
          valor_total    REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_vendas_itens_venda ON vendas_itens(venda_id);
        CREATE INDEX IF NOT EXISTS idx_vendas_itens_produto ON vendas_itens(produto_id);

        CREATE TABLE IF NOT EXISTS vendas_pagamentos (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          venda_id       INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
          forma_pagamento TEXT NOT NULL,              -- dinheiro | cartao_credito | cartao_debito | pix | prazo
          valor          REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_vendas_pag_venda ON vendas_pagamentos(venda_id);

        -- ====================== Movimentacoes de estoque ===================
        CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          produto_id    INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
          tipo          TEXT NOT NULL,                -- entrada | saida
          quantidade    REAL NOT NULL,
          custo_unitario REAL,
          estoque_apos  REAL,                         -- saldo do produto apos a movimentacao
          origem        TEXT NOT NULL,                -- compra | venda | ajuste | estorno | inicial
          referencia_id INTEGER,                      -- id da compra/venda relacionada
          observacao    TEXT,
          data          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_mov_produto ON movimentacoes_estoque(produto_id);
        CREATE INDEX IF NOT EXISTS idx_mov_data ON movimentacoes_estoque(data);

        -- ========================== Contas a pagar =========================
        CREATE TABLE IF NOT EXISTS contas_pagar (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          fornecedor_id   INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
          compra_id       INTEGER REFERENCES compras(id) ON DELETE SET NULL,
          descricao       TEXT NOT NULL,
          valor           REAL NOT NULL DEFAULT 0,
          vencimento      TEXT,
          status          TEXT NOT NULL DEFAULT 'pendente', -- pendente | pago
          forma_pagamento TEXT,
          data_pagamento  TEXT,
          criado_em       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_cpagar_status ON contas_pagar(status);
        CREATE INDEX IF NOT EXISTS idx_cpagar_venc ON contas_pagar(vencimento);

        -- ========================= Contas a receber ========================
        CREATE TABLE IF NOT EXISTS contas_receber (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          venda_id         INTEGER REFERENCES vendas(id) ON DELETE SET NULL,
          descricao        TEXT NOT NULL,
          valor            REAL NOT NULL DEFAULT 0,
          parcela          INTEGER NOT NULL DEFAULT 1,
          total_parcelas   INTEGER NOT NULL DEFAULT 1,
          vencimento       TEXT,
          status           TEXT NOT NULL DEFAULT 'pendente', -- pendente | recebido
          forma_recebimento TEXT,
          data_recebimento TEXT,
          criado_em        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_creceber_status ON contas_receber(status);
        CREATE INDEX IF NOT EXISTS idx_creceber_venc ON contas_receber(vencimento);

        -- ============================== Caixa ==============================
        CREATE TABLE IF NOT EXISTS caixa (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          data_abertura   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          valor_abertura  REAL NOT NULL DEFAULT 0,
          data_fechamento TEXT,
          valor_fechamento REAL,                      -- valor contado no fechamento
          valor_esperado  REAL,                       -- valor calculado esperado em dinheiro
          diferenca       REAL,                       -- contado - esperado
          status          TEXT NOT NULL DEFAULT 'aberto', -- aberto | fechado
          observacao      TEXT
        );

        CREATE TABLE IF NOT EXISTS caixa_movimentos (
          id       INTEGER PRIMARY KEY AUTOINCREMENT,
          caixa_id INTEGER NOT NULL REFERENCES caixa(id) ON DELETE CASCADE,
          tipo     TEXT NOT NULL,                     -- sangria | suprimento
          valor    REAL NOT NULL DEFAULT 0,
          motivo   TEXT,
          data     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_caixa_mov_caixa ON caixa_movimentos(caixa_id);

        -- ============================== Config =============================
        CREATE TABLE IF NOT EXISTS config (
          chave TEXT PRIMARY KEY,
          valor TEXT
        );
      `);
    },
  },
  {
    version: 2,
    name: 'clientes-e-fiado',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS clientes (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          nome           TEXT NOT NULL,
          cpf            TEXT,
          telefone       TEXT,
          email          TEXT,
          endereco       TEXT,
          limite_credito REAL NOT NULL DEFAULT 0,
          observacao     TEXT,
          ativo          INTEGER NOT NULL DEFAULT 1,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes(nome);

        ALTER TABLE vendas ADD COLUMN cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL;
        ALTER TABLE contas_receber ADD COLUMN cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL;
      `);
    },
  },
  {
    version: 3,
    name: 'kits-e-variacoes',
    up(db) {
      db.exec(`
        -- Kits/combos: produto composto por outros produtos (estoque
        -- controlado pelos componentes, nao pelo proprio kit).
        ALTER TABLE produtos ADD COLUMN eh_kit INTEGER NOT NULL DEFAULT 0;
        -- Variacoes: rotulo livre para agrupar produtos gerados em lote
        -- (ex: "Camiseta Modelo X" com variacao "Tamanho M").
        ALTER TABLE produtos ADD COLUMN grupo_variacao TEXT;
        ALTER TABLE produtos ADD COLUMN variacao TEXT;

        CREATE TABLE IF NOT EXISTS produtos_composicao (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          produto_kit_id        INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
          produto_componente_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
          quantidade            REAL NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_composicao_kit ON produtos_composicao(produto_kit_id);
        CREATE INDEX IF NOT EXISTS idx_produtos_grupo_variacao ON produtos(grupo_variacao);
      `);
    },
  },
  {
    version: 4,
    name: 'contas-fixas',
    up(db) {
      db.exec(`
        -- Contas fixas: modelo de conta a pagar recorrente (aluguel, internet,
        -- agua/luz...). A cada mes, uma conta_pagar e gerada automaticamente
        -- a partir do modelo, se ainda nao existir uma para o mes corrente.
        CREATE TABLE IF NOT EXISTS contas_fixas (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          descricao      TEXT NOT NULL,
          fornecedor_id  INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
          valor          REAL NOT NULL DEFAULT 0,
          dia_vencimento INTEGER NOT NULL,     -- 1 a 31 (ajustado ao ultimo dia do mes quando necessario)
          ativa          INTEGER NOT NULL DEFAULT 1,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        ALTER TABLE contas_pagar ADD COLUMN conta_fixa_id INTEGER REFERENCES contas_fixas(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_cpagar_conta_fixa ON contas_pagar(conta_fixa_id);
      `);
    },
  },
  {
    version: 5,
    name: 'precificacao-markup-divisor',
    up(db) {
      db.exec(`
        -- Configuracao de faturamento e impostos (linha unica - Modulo 2).
        CREATE TABLE IF NOT EXISTS precificacao_config (
          id                    INTEGER PRIMARY KEY CHECK (id = 1),
          faturamento_mensal    REAL NOT NULL DEFAULT 0,
          simples_nacional_pct  REAL NOT NULL DEFAULT 0,
          icms_pct              REAL NOT NULL DEFAULT 0,
          pis_pct               REAL NOT NULL DEFAULT 0,
          cofins_pct            REAL NOT NULL DEFAULT 0,
          ir_pct                REAL NOT NULL DEFAULT 0,
          cs_pct                REAL NOT NULL DEFAULT 0,
          ibs_pct               REAL NOT NULL DEFAULT 0,
          cbs_pct                REAL NOT NULL DEFAULT 0,
          atividade             TEXT NOT NULL DEFAULT 'comercio',
          atualizado_em         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        INSERT OR IGNORE INTO precificacao_config (id) VALUES (1);

        -- Despesas fixas e variaveis (Modulo 3).
        CREATE TABLE IF NOT EXISTS precificacao_despesas (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          tipo       TEXT NOT NULL CHECK (tipo IN ('fixa','variavel')),
          descricao  TEXT NOT NULL,
          valor      REAL NOT NULL DEFAULT 0,
          ordem      INTEGER NOT NULL DEFAULT 0
        );

        -- Produtos/servicos da planilha de precificacao (Modulo 5).
        CREATE TABLE IF NOT EXISTS precificacao_produtos (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          referencia         TEXT,
          descricao          TEXT NOT NULL,
          quantidade         REAL NOT NULL DEFAULT 1,
          valor_pedido       REAL NOT NULL DEFAULT 0,
          custo_embalagem    REAL NOT NULL DEFAULT 0,
          custo_frete_fixo   REAL NOT NULL DEFAULT 0,
          frete_pct          REAL NOT NULL DEFAULT 0,
          taxa_cartao_pct    REAL NOT NULL DEFAULT 0,
          margem_pct         REAL NOT NULL DEFAULT 0,
          usar_margem_setor  INTEGER NOT NULL DEFAULT 1,
          preco_mercado      REAL,
          preco_praticado    REAL,
          ordem              INTEGER NOT NULL DEFAULT 0,
          criado_em          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          atualizado_em      TEXT
        );
      `);

      // Itens padrao de despesas (valor 0 - usuario preenche depois).
      const fixas = [
        'Aluguel', 'Internet', 'Condomínio', 'Pró-labore', 'Material de escritório',
        'Luz/Água', 'Telefone', 'Remunerações (Salário, Férias, 13º)',
        'Manutenção patrimonial', 'Outras despesas tributárias (MEI)',
        'Outras despesas com pessoal', 'Outros gastos gerais',
      ];
      const variaveis = [
        'Matérias-primas', 'Embalagens', 'Etiquetas', 'Mercadoria para revenda',
        'Frete', 'Propaganda e publicidade', 'Comissão',
      ];
      const ins = db.prepare('INSERT INTO precificacao_despesas (tipo, descricao, valor, ordem) VALUES (?, ?, 0, ?)');
      fixas.forEach((d, i) => ins.run('fixa', d, i));
      variaveis.forEach((d, i) => ins.run('variavel', d, i));
    },
  },
  {
    version: 6,
    name: 'precificacao-vinculo-produtos',
    up(db) {
      db.exec(`
        -- Vincula uma linha da precificacao ao produto real (para aplicar o
        -- preco sugerido de volta ao cadastro) e agrupa por lote de importacao.
        ALTER TABLE precificacao_produtos ADD COLUMN produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL;
        ALTER TABLE precificacao_produtos ADD COLUMN lote TEXT;       -- rotulo do grupo (ex: "Cadastro em lote 20/07/2026 20:00")
        ALTER TABLE precificacao_produtos ADD COLUMN lote_data TEXT;  -- timestamp ISO para ordenar os grupos
        CREATE INDEX IF NOT EXISTS idx_prec_prod_lote ON precificacao_produtos(lote);
        CREATE INDEX IF NOT EXISTS idx_prec_prod_produto ON precificacao_produtos(produto_id);
      `);
    },
  },
  {
    version: 7,
    name: 'contas-financeiras-e-parcelamento',
    up(db) {
      db.exec(`
        -- Contas financeiras (carteiras/saldos): banco, dinheiro em caixa,
        -- maquina de cartao... Cada conta tem um saldo inicial e um extrato de
        -- movimentos; o saldo atual e o saldo inicial + entradas - saidas.
        CREATE TABLE IF NOT EXISTS contas_financeiras (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          nome          TEXT NOT NULL,
          tipo          TEXT NOT NULL DEFAULT 'outro',   -- dinheiro | banco | cartao | outro
          saldo_inicial REAL NOT NULL DEFAULT 0,
          ativa         INTEGER NOT NULL DEFAULT 1,
          ordem         INTEGER NOT NULL DEFAULT 0,
          criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        -- Extrato das contas financeiras (uma linha por entrada/saida).
        CREATE TABLE IF NOT EXISTS contas_financeiras_mov (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          conta_id      INTEGER NOT NULL REFERENCES contas_financeiras(id) ON DELETE CASCADE,
          data          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          tipo          TEXT NOT NULL,                   -- entrada | saida
          valor         REAL NOT NULL DEFAULT 0,
          origem        TEXT NOT NULL,                   -- venda | recebimento | pagamento | ajuste | abertura
          referencia_id INTEGER,
          descricao     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_cfin_mov_conta ON contas_financeiras_mov(conta_id);
        CREATE INDEX IF NOT EXISTS idx_cfin_mov_data ON contas_financeiras_mov(data);

        -- Parcelamento das contas a pagar + conta financeira usada no pagamento.
        ALTER TABLE contas_pagar ADD COLUMN parcela INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE contas_pagar ADD COLUMN total_parcelas INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE contas_pagar ADD COLUMN conta_financeira_id INTEGER REFERENCES contas_financeiras(id) ON DELETE SET NULL;

        -- Marca as contas a receber geradas por venda a vista (registro ja
        -- "recebido"), para nao duplicar no fluxo de caixa; + conta usada.
        ALTER TABLE contas_receber ADD COLUMN tipo TEXT NOT NULL DEFAULT 'normal';  -- normal | venda_vista
        ALTER TABLE contas_receber ADD COLUMN conta_financeira_id INTEGER REFERENCES contas_financeiras(id) ON DELETE SET NULL;
      `);

      // Contas padrao.
      const ins = db.prepare('INSERT INTO contas_financeiras (nome, tipo, ordem) VALUES (?, ?, ?)');
      const idCaixa = ins.run('Caixa (dinheiro)', 'dinheiro', 0).lastInsertRowid;
      const idBanco = ins.run('Banco', 'banco', 1).lastInsertRowid;
      const idCartao = ins.run('Máquina de cartão', 'cartao', 2).lastInsertRowid;

      // Mapa forma de pagamento -> conta financeira (editavel em Configuracoes).
      const mapa = {
        dinheiro: idCaixa,
        pix: idBanco,
        transferencia: idBanco,
        boleto: idBanco,
        cartao_credito: idCartao,
        cartao_debito: idCartao,
      };
      db.prepare("INSERT INTO config (chave, valor) VALUES ('financeiro_mapa_contas', ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor")
        .run(JSON.stringify(mapa));
    },
  },
  {
    version: 8,
    name: 'produtos-multiplas-fotos',
    up(db) {
      db.exec(`
        -- Galeria de fotos por produto. A foto marcada como principal continua
        -- refletida em produtos.foto_path (compatibilidade com cards/PDV/etc.).
        CREATE TABLE IF NOT EXISTS produtos_fotos (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
          arquivo    TEXT NOT NULL,
          ordem      INTEGER NOT NULL DEFAULT 0,
          principal  INTEGER NOT NULL DEFAULT 0,
          criado_em  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_produtos_fotos_produto ON produtos_fotos(produto_id);

        -- Migra a foto unica existente para a galeria (como principal).
        INSERT INTO produtos_fotos (produto_id, arquivo, ordem, principal)
          SELECT id, foto_path, 0, 1 FROM produtos
          WHERE foto_path IS NOT NULL AND TRIM(foto_path) <> '';
      `);
    },
  },
  {
    version: 9,
    name: 'dre-categorias-despesa',
    up(db) {
      db.exec(`
        -- Categorias de despesa (para o DRE). Categorias com considera_dre=0
        -- (ex.: compra de mercadoria) ficam de fora das despesas operacionais
        -- do DRE, pois entram no resultado via CMV quando o item e vendido.
        CREATE TABLE IF NOT EXISTS categorias_despesa (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          nome          TEXT NOT NULL,
          considera_dre INTEGER NOT NULL DEFAULT 1,
          ordem         INTEGER NOT NULL DEFAULT 0,
          criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        ALTER TABLE contas_pagar ADD COLUMN categoria_despesa_id INTEGER REFERENCES categorias_despesa(id) ON DELETE SET NULL;
      `);

      const ins = db.prepare('INSERT INTO categorias_despesa (nome, considera_dre, ordem) VALUES (?, ?, ?)');
      const operacionais = [
        'Aluguel', 'Água / Luz / Internet', 'Salários e encargos', 'Pró-labore',
        'Impostos e taxas', 'Marketing e propaganda', 'Manutenção', 'Frete / Logística',
        'Despesas administrativas', 'Outras despesas',
      ];
      operacionais.forEach((n, i) => ins.run(n, 1, i));
      // Categoria especial: compra de mercadoria (fora do DRE — vira CMV na venda).
      const idCompras = ins.run('Compra de mercadoria', 0, operacionais.length).lastInsertRowid;

      db.prepare("INSERT INTO config (chave, valor) VALUES ('categoria_compras_id', ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor")
        .run(String(idCompras));
      // Gerar codigo de barras interno automaticamente ao importar produtos.
      db.prepare("INSERT INTO config (chave, valor) VALUES ('gerar_codigo_auto', '1') ON CONFLICT(chave) DO NOTHING")
        .run();
    },
  },
  {
    version: 10,
    name: 'servicos',
    up(db) {
      db.exec(`
        -- Serviços: reaproveitam a tabela de produtos, mas nao controlam
        -- estoque. eh_servico=1 marca o item como servico (ex.: corte de
        -- cabelo, mao de obra, consultoria). duracao_min = duracao estimada.
        ALTER TABLE produtos ADD COLUMN eh_servico INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE produtos ADD COLUMN duracao_min INTEGER;
        CREATE INDEX IF NOT EXISTS idx_produtos_eh_servico ON produtos(eh_servico);
      `);
    },
  },
  {
    version: 11,
    name: 'ordens-servico-e-orcamentos',
    up(db) {
      db.exec(`
        -- Ordens de servico e orcamentos (mesma estrutura, campo tipo).
        --  tipo 'os'        -> status: aberta|em_andamento|concluida|entregue|cancelada
        --  tipo 'orcamento' -> status: aberto|aprovado|recusado|expirado|cancelada
        CREATE TABLE IF NOT EXISTS ordens_servico (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          tipo           TEXT NOT NULL DEFAULT 'os',
          numero         INTEGER NOT NULL,
          cliente_id     INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
          status         TEXT NOT NULL DEFAULT 'aberta',
          -- Dados do equipamento/objeto (OS de oficina/assistencia tecnica).
          equipamento    TEXT,
          marca_modelo   TEXT,
          identificacao  TEXT,          -- serie/placa/patrimonio
          defeito        TEXT,          -- defeito relatado / escopo do servico
          laudo          TEXT,          -- diagnostico/solucao
          responsavel    TEXT,          -- tecnico responsavel (texto livre)
          observacao     TEXT,
          desconto       REAL NOT NULL DEFAULT 0,
          valor_total    REAL NOT NULL DEFAULT 0,
          garantia_dias  INTEGER NOT NULL DEFAULT 0,
          validade       TEXT,          -- validade do orcamento (data)
          data_previsao  TEXT,
          data_conclusao TEXT,
          data_entrega   TEXT,
          venda_id       INTEGER REFERENCES vendas(id) ON DELETE SET NULL,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          atualizado_em  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_os_tipo ON ordens_servico(tipo);
        CREATE INDEX IF NOT EXISTS idx_os_status ON ordens_servico(status);
        CREATE INDEX IF NOT EXISTS idx_os_cliente ON ordens_servico(cliente_id);

        CREATE TABLE IF NOT EXISTS ordens_servico_itens (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          os_id          INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
          produto_id     INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
          tipo           TEXT NOT NULL DEFAULT 'produto',  -- produto | servico | livre
          descricao      TEXT NOT NULL,
          quantidade     REAL NOT NULL DEFAULT 1,
          preco_unitario REAL NOT NULL DEFAULT 0,
          custo_unitario REAL NOT NULL DEFAULT 0,
          valor_total    REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_os_itens_os ON ordens_servico_itens(os_id);
      `);
    },
  },
  {
    version: 12,
    name: 'agenda-e-profissionais',
    up(db) {
      db.exec(`
        -- Profissionais / equipe (usados na Agenda e nas Comissões).
        CREATE TABLE IF NOT EXISTS profissionais (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          nome         TEXT NOT NULL,
          telefone     TEXT,
          cor          TEXT NOT NULL DEFAULT '#2563eb',
          comissao_pct REAL NOT NULL DEFAULT 0,
          ativo        INTEGER NOT NULL DEFAULT 1,
          criado_em    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        -- Agendamentos (horários marcados). Podem virar venda ao "atender".
        CREATE TABLE IF NOT EXISTS agendamentos (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          data           TEXT NOT NULL,                 -- YYYY-MM-DD
          hora_inicio    TEXT NOT NULL,                 -- HH:MM
          hora_fim       TEXT,                          -- HH:MM
          cliente_id     INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
          cliente_nome   TEXT,                          -- avulso (sem cadastro)
          telefone       TEXT,
          profissional_id INTEGER REFERENCES profissionais(id) ON DELETE SET NULL,
          produto_id     INTEGER REFERENCES produtos(id) ON DELETE SET NULL,  -- serviço
          servico_nome   TEXT,
          valor          REAL NOT NULL DEFAULT 0,
          status         TEXT NOT NULL DEFAULT 'agendado', -- agendado|confirmado|atendido|cancelado|faltou
          observacao     TEXT,
          venda_id       INTEGER REFERENCES vendas(id) ON DELETE SET NULL,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_agenda_data ON agendamentos(data);
        CREATE INDEX IF NOT EXISTS idx_agenda_prof ON agendamentos(profissional_id);
      `);
    },
  },
  {
    version: 13,
    name: 'comissoes',
    up(db) {
      db.exec(`
        -- Vincula a OS a um profissional cadastrado (opcional), para que o
        -- trabalho de oficina/assistencia tecnica tambem entre no relatorio
        -- de comissoes (alem dos atendimentos da Agenda, que ja tem o vinculo).
        ALTER TABLE ordens_servico ADD COLUMN profissional_id INTEGER REFERENCES profissionais(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_os_profissional ON ordens_servico(profissional_id);

        -- Registro de comissao ja lancada em Contas a Pagar, para nao lancar
        -- a mesma comissao (profissional + periodo) duas vezes.
        CREATE TABLE IF NOT EXISTS comissoes_lancamentos (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
          periodo_inicio  TEXT NOT NULL,
          periodo_fim     TEXT NOT NULL,
          valor           REAL NOT NULL DEFAULT 0,
          conta_pagar_id  INTEGER REFERENCES contas_pagar(id) ON DELETE SET NULL,
          criado_em       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_comissoes_lanc_prof ON comissoes_lancamentos(profissional_id);
      `);
    },
  },
  {
    version: 14,
    name: 'assinaturas-mensalidades',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS assinaturas (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          cliente_id     INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
          descricao      TEXT NOT NULL,
          valor          REAL NOT NULL DEFAULT 0,
          dia_vencimento INTEGER NOT NULL,     -- 1 a 31 (ajustado ao ultimo dia do mes quando necessario)
          data_inicio    TEXT NOT NULL DEFAULT (date('now','localtime')),
          data_fim       TEXT,                 -- null = por tempo indeterminado
          observacao     TEXT,
          ativa          INTEGER NOT NULL DEFAULT 1,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_assinaturas_cliente ON assinaturas(cliente_id);

        ALTER TABLE contas_receber ADD COLUMN assinatura_id INTEGER REFERENCES assinaturas(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_creceber_assinatura ON contas_receber(assinatura_id);
      `);
    },
  },
  {
    version: 15,
    name: 'modulo-fiscal',
    up(db) {
      db.exec(`
        ALTER TABLE produtos ADD COLUMN ncm TEXT;
        ALTER TABLE produtos ADD COLUMN cfop TEXT;
        ALTER TABLE produtos ADD COLUMN cst_csosn TEXT;
        ALTER TABLE produtos ADD COLUMN origem_mercadoria INTEGER NOT NULL DEFAULT 0;

        CREATE TABLE IF NOT EXISTS notas_fiscais (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          venda_id       INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
          tipo           TEXT NOT NULL DEFAULT 'nfce',   -- nfce | nfe
          ambiente       TEXT NOT NULL DEFAULT 'homologacao',
          referencia     TEXT NOT NULL,                  -- ref enviada ao gateway (unica)
          status         TEXT NOT NULL DEFAULT 'processando', -- processando | autorizada | erro | cancelada
          numero         TEXT,
          serie          TEXT,
          chave_acesso   TEXT,
          protocolo      TEXT,
          danfe_url      TEXT,
          xml_url        TEXT,
          mensagem_erro  TEXT,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          atualizado_em  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_notas_fiscais_venda ON notas_fiscais(venda_id);
      `);
    },
  },
  {
    version: 16,
    name: 'crm-agencia-viagem',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS leads (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          nome           TEXT NOT NULL,
          telefone       TEXT,
          email          TEXT,
          origem         TEXT,                  -- whatsapp | indicacao | site | outro (preparado p/ integracao futura)
          status         TEXT NOT NULL DEFAULT 'contato', -- contato | proposta | pagamento | vendido | perdido
          observacao     TEXT,
          cliente_id     INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          atualizado_em  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

        CREATE TABLE IF NOT EXISTS vendas_viagem (
          id                     INTEGER PRIMARY KEY AUTOINCREMENT,
          lead_id                INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
          cliente_id             INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
          descricao              TEXT NOT NULL,     -- ex.: "Pacote Cancun 7 noites"
          operadora              TEXT,               -- fornecedor/operadora terceira
          numero_reserva         TEXT,
          valor_venda            REAL NOT NULL DEFAULT 0,
          agente_id              INTEGER REFERENCES profissionais(id) ON DELETE SET NULL,
          comissao_pct           REAL,
          comissao_valor         REAL NOT NULL DEFAULT 0,
          data_ida               TEXT,
          data_volta             TEXT,
          observacao             TEXT,
          conta_receber_id       INTEGER REFERENCES contas_receber(id) ON DELETE SET NULL,
          conta_pagar_comissao_id INTEGER REFERENCES contas_pagar(id) ON DELETE SET NULL,
          criado_em              TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_vendas_viagem_lead ON vendas_viagem(lead_id);
        CREATE INDEX IF NOT EXISTS idx_vendas_viagem_datas ON vendas_viagem(data_ida, data_volta);
      `);
    },
  },
  {
    version: 17,
    name: 'checkin-lembretes-tarefas',
    up(db) {
      db.exec(`
        ALTER TABLE vendas_viagem ADD COLUMN checkin_feito INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE vendas_viagem ADD COLUMN checkin_feito_em TEXT;

        CREATE TABLE IF NOT EXISTS lembretes (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          titulo         TEXT NOT NULL,
          descricao      TEXT,
          data_lembrete  TEXT NOT NULL,   -- YYYY-MM-DD
          concluido      INTEGER NOT NULL DEFAULT 0,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_lembretes_data ON lembretes(data_lembrete);

        CREATE TABLE IF NOT EXISTS tarefas (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          titulo          TEXT NOT NULL,
          descricao       TEXT,
          responsavel_id  INTEGER REFERENCES profissionais(id) ON DELETE SET NULL,
          status          TEXT NOT NULL DEFAULT 'pendente', -- pendente | andamento | concluida
          prazo           TEXT,
          criado_em       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          concluido_em    TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tarefas_status ON tarefas(status);
      `);
    },
  },
  {
    version: 18,
    name: 'atendimento-whatsapp',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversas_whatsapp (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          wa_chat_id      TEXT NOT NULL UNIQUE,   -- id do chat no WhatsApp (ex.: 5511999999999@c.us)
          nome_contato    TEXT,
          telefone        TEXT,
          status          TEXT NOT NULL DEFAULT 'contato', -- contato | aguardando | atendimento
          nao_lidas       INTEGER NOT NULL DEFAULT 0,
          lead_id         INTEGER REFERENCES leads(id) ON DELETE SET NULL,
          cliente_id      INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
          ultima_mensagem_em TEXT,
          criado_em       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_conversas_wa_status ON conversas_whatsapp(status);

        CREATE TABLE IF NOT EXISTS mensagens_whatsapp (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          conversa_id   INTEGER NOT NULL REFERENCES conversas_whatsapp(id) ON DELETE CASCADE,
          wa_message_id TEXT,
          direcao       TEXT NOT NULL,   -- recebida | enviada
          tipo          TEXT NOT NULL DEFAULT 'texto', -- texto | imagem | video | audio | documento | sticker
          texto         TEXT,
          arquivo       TEXT,            -- nome do arquivo em uploads/whatsapp
          arquivo_nome_original TEXT,
          criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_mensagens_wa_conversa ON mensagens_whatsapp(conversa_id);
      `);
    },
  },
  {
    version: 19,
    name: 'atendimento-bot-e-melhorias',
    up(db) {
      db.exec(`
        -- Confirmacao de entrega/leitura das mensagens enviadas.
        ALTER TABLE mensagens_whatsapp ADD COLUMN status TEXT NOT NULL DEFAULT 'recebida';
        -- status: recebida | enviada | entregue | lida | erro

        -- Se a conversa esta sendo respondida pelo bot ou ja foi passada pra humano.
        ALTER TABLE conversas_whatsapp ADD COLUMN modo_atual TEXT NOT NULL DEFAULT 'humano';
        -- modo_atual: bot | humano
        ALTER TABLE conversas_whatsapp ADD COLUMN atendente_id INTEGER REFERENCES profissionais(id) ON DELETE SET NULL;

        -- Evita duplicar mensagem recebida (mesmo wa_message_id) e agiliza a busca do ack.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mensagens_wa_msgid ON mensagens_whatsapp(wa_message_id)
          WHERE wa_message_id IS NOT NULL;

        -- Bot configuravel por regras (gatilho -> resposta), sem precisar programar.
        CREATE TABLE IF NOT EXISTS bot_respostas_whatsapp (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          gatilho_tipo     TEXT NOT NULL DEFAULT 'palavra_chave', -- opcao_menu | palavra_chave
          gatilho          TEXT NOT NULL,   -- "1" (opcao) ou "boleto,segunda via" (palavras, separadas por virgula)
          resposta         TEXT NOT NULL,
          transfere_humano INTEGER NOT NULL DEFAULT 0,
          ordem            INTEGER NOT NULL DEFAULT 0,
          ativo            INTEGER NOT NULL DEFAULT 1
        );

        -- Vincula uma tarefa criada a partir de uma conversa (rastreabilidade, opcional).
        ALTER TABLE tarefas ADD COLUMN conversa_whatsapp_id INTEGER REFERENCES conversas_whatsapp(id) ON DELETE SET NULL;
      `);
    },
  },
  {
    version: 20,
    name: 'atendimento-contatos-e-encerramento',
    up(db) {
      db.exec(`
        -- Agenda de contatos do WhatsApp, independente de ter conversa ativa
        -- (permite a aba "Contatos" e editar o apelido sem precisar de conversa).
        CREATE TABLE IF NOT EXISTS contatos_whatsapp (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          wa_chat_id       TEXT NOT NULL UNIQUE,
          telefone         TEXT,
          nome             TEXT,   -- apelido editavel pela equipe
          push_name        TEXT,   -- nome que o proprio WhatsApp informa
          criado_em        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          ultima_interacao TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_contatos_wa_chatid ON contatos_whatsapp(wa_chat_id);

        ALTER TABLE conversas_whatsapp ADD COLUMN contato_id INTEGER REFERENCES contatos_whatsapp(id) ON DELETE SET NULL;
        -- Encerramento formal do atendimento (fecha a conversa, some das abas ativas).
        ALTER TABLE conversas_whatsapp ADD COLUMN comentario_resolucao TEXT;
        ALTER TABLE conversas_whatsapp ADD COLUMN resolvida_em TEXT;

        CREATE TABLE IF NOT EXISTS respostas_rapidas_whatsapp (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          atalho    TEXT NOT NULL UNIQUE,   -- ex.: "boleto" -> digitar "/boleto " expande
          titulo    TEXT,
          conteudo  TEXT NOT NULL,
          ativo     INTEGER NOT NULL DEFAULT 1
        );

        -- Quem enviou cada mensagem "enviada" (mostra o rotulo na bolha do chat).
        ALTER TABLE mensagens_whatsapp ADD COLUMN remetente_tipo TEXT;
        -- remetente_tipo: atendente | bot | sistema (nulo em mensagens recebidas)
        ALTER TABLE mensagens_whatsapp ADD COLUMN remetente_id INTEGER REFERENCES profissionais(id) ON DELETE SET NULL;
      `);

      // Migra os contatos que ja existiam embutidos em conversas_whatsapp
      // para a nova tabela dedicada, e vincula cada conversa ao seu contato.
      const conversas = db.prepare('SELECT id, wa_chat_id, telefone, nome_contato FROM conversas_whatsapp').all();
      const inserirContato = db.prepare(
        'INSERT INTO contatos_whatsapp (wa_chat_id, telefone, nome, push_name, ultima_interacao) VALUES (?, ?, ?, ?, ?)'
      );
      const vincularContato = db.prepare('UPDATE conversas_whatsapp SET contato_id = ? WHERE id = ?');
      for (const c of conversas) {
        const info = inserirContato.run(c.wa_chat_id, c.telefone, c.nome_contato, c.nome_contato, null);
        vincularContato.run(info.lastInsertRowid, c.id);
      }
    },
  },
  {
    version: 21,
    name: 'atendimento-mensagens-agendadas',
    up(db) {
      db.exec(`
        -- Envio unico, numa data/hora futura.
        CREATE TABLE IF NOT EXISTS mensagens_agendadas_whatsapp (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          contato_id    INTEGER NOT NULL REFERENCES contatos_whatsapp(id) ON DELETE CASCADE,
          texto         TEXT NOT NULL,
          agendado_para TEXT NOT NULL,  -- 'YYYY-MM-DD HH:MM:SS'
          status        TEXT NOT NULL DEFAULT 'agendada', -- agendada | enviada | erro | cancelada
          erro          TEXT,
          criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          enviado_em    TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_msg_agendadas_status_data ON mensagens_agendadas_whatsapp(status, agendado_para);

        -- Repete todo mes, num dia/hora fixo (ex.: lembrete de mensalidade).
        CREATE TABLE IF NOT EXISTS mensagens_recorrentes_whatsapp (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          contato_id      INTEGER NOT NULL REFERENCES contatos_whatsapp(id) ON DELETE CASCADE,
          texto           TEXT NOT NULL,
          dia_mes         INTEGER NOT NULL CHECK (dia_mes BETWEEN 1 AND 31),
          hora            TEXT NOT NULL DEFAULT '09:00',
          ativo           INTEGER NOT NULL DEFAULT 1,
          ultima_execucao TEXT, -- 'YYYY-MM-DD' do ultimo envio, evita repetir no mesmo dia
          criado_em       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
      `);
    },
  },
  {
    version: 22,
    name: 'crm-comissao-agencia-e-funcionario',
    up(db) {
      db.exec(`
        -- A partir daqui, comissao_pct/comissao_valor passam a significar a
        -- comissao que a AGENCIA recebe da operadora (a receita de verdade do
        -- negocio) — valor_venda e so informativo (dinheiro que e da operadora,
        -- nao da agencia). Esta coluna guarda a fatia dessa comissao que vai
        -- para o funcionario que fechou a venda (agente_id).
        ALTER TABLE vendas_viagem ADD COLUMN comissao_funcionario_pct REAL;
        ALTER TABLE vendas_viagem ADD COLUMN comissao_funcionario_valor REAL NOT NULL DEFAULT 0;
        ALTER TABLE vendas_viagem ADD COLUMN conta_pagar_funcionario_id INTEGER REFERENCES contas_pagar(id) ON DELETE SET NULL;
      `);
    },
  },
  {
    version: 23,
    name: 'devolucoes-e-trocas',
    up(db) {
      db.exec(`
        -- Controla quanto de cada item vendido ja foi devolvido, para
        -- permitir devolucoes parciais (nao precisa devolver a venda toda).
        ALTER TABLE vendas_itens ADD COLUMN quantidade_devolvida REAL NOT NULL DEFAULT 0;

        CREATE TABLE IF NOT EXISTS devolucoes (
          id                        INTEGER PRIMARY KEY AUTOINCREMENT,
          venda_id                  INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
          motivo                    TEXT,
          valor_devolvido           REAL NOT NULL DEFAULT 0,   -- valor dos itens devolvidos
          valor_novos_itens         REAL NOT NULL DEFAULT 0,   -- valor dos itens levados na troca (se houver)
          diferenca                 REAL NOT NULL DEFAULT 0,   -- >0: loja deve ao cliente | <0: cliente paga a diferenca
          forma_pagamento_diferenca TEXT,
          data                      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          observacao                TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_devolucoes_venda ON devolucoes(venda_id);

        CREATE TABLE IF NOT EXISTS devolucoes_itens (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          devolucao_id   INTEGER NOT NULL REFERENCES devolucoes(id) ON DELETE CASCADE,
          venda_item_id  INTEGER NOT NULL REFERENCES vendas_itens(id) ON DELETE CASCADE,
          produto_id     INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
          descricao      TEXT,
          quantidade     REAL NOT NULL DEFAULT 0,
          valor_unitario REAL NOT NULL DEFAULT 0,
          valor_total    REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_devolucoes_itens_devolucao ON devolucoes_itens(devolucao_id);

        -- Itens levados pelo cliente em troca (quando a devolucao e uma troca
        -- por outro produto, e nao so o dinheiro de volta).
        CREATE TABLE IF NOT EXISTS devolucoes_itens_troca (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          devolucao_id   INTEGER NOT NULL REFERENCES devolucoes(id) ON DELETE CASCADE,
          produto_id     INTEGER NOT NULL REFERENCES produtos(id),
          descricao      TEXT,
          quantidade     REAL NOT NULL DEFAULT 0,
          valor_unitario REAL NOT NULL DEFAULT 0,
          valor_total    REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_devolucoes_troca_devolucao ON devolucoes_itens_troca(devolucao_id);
      `);
    },
  },
  {
    version: 24,
    name: 'sacolas-de-venda',
    up(db) {
      db.exec(`
        -- Sacola de vendas ("leva e traz"): produtos que saem da loja para
        -- serem mostrados/vendidos fora (na casa do cliente, por exemplo).
        -- Ao montar, os itens saem do estoque. Na conferencia, o que voltou
        -- entra de volta no estoque e o que nao voltou vira uma venda.
        CREATE TABLE IF NOT EXISTS sacolas_venda (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          cliente_id       INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
          cliente_nome     TEXT,                          -- avulso, quando nao tem cadastro
          vendedor_id      INTEGER REFERENCES profissionais(id) ON DELETE SET NULL,
          data_saida       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          data_conferencia TEXT,
          status           TEXT NOT NULL DEFAULT 'aberta', -- aberta | conferida
          venda_id         INTEGER REFERENCES vendas(id) ON DELETE SET NULL,
          observacao       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sacolas_status ON sacolas_venda(status);

        CREATE TABLE IF NOT EXISTS sacolas_venda_itens (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          sacola_id            INTEGER NOT NULL REFERENCES sacolas_venda(id) ON DELETE CASCADE,
          produto_id           INTEGER NOT NULL REFERENCES produtos(id),
          descricao            TEXT,
          quantidade_levada    REAL NOT NULL DEFAULT 0,
          quantidade_retornada REAL,                      -- NULL ate a conferencia
          preco_unitario       REAL NOT NULL DEFAULT 0,    -- snapshot no momento da saida
          custo_unitario       REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_sacolas_itens_sacola ON sacolas_venda_itens(sacola_id);
      `);
    },
  },
  {
    version: 25,
    name: 'aulas-recorrentes',
    up(db) {
      db.exec(`
        -- Aula fixa semanal (ex.: professor particular): um "molde" que gera
        -- automaticamente um agendamento normal a cada semana, no mesmo
        -- espirito de contas fixas/assinaturas (gera as ocorrencias futuras
        -- sem precisar recriar manualmente toda semana).
        CREATE TABLE IF NOT EXISTS aulas_recorrentes (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          aluno_id        INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
          aluno_nome      TEXT,                          -- avulso, quando nao tem cadastro
          profissional_id INTEGER REFERENCES profissionais(id) ON DELETE SET NULL,
          produto_id      INTEGER REFERENCES produtos(id) ON DELETE SET NULL,  -- materia (servico do cadastro)
          materia_nome    TEXT,
          dia_semana      INTEGER NOT NULL,              -- 0=domingo .. 6=sabado
          hora_inicio     TEXT NOT NULL,
          hora_fim        TEXT,
          valor           REAL NOT NULL DEFAULT 0,
          telefone        TEXT,
          data_inicio     TEXT NOT NULL,
          data_fim        TEXT,                          -- opcional, ate quando repetir
          ativa           INTEGER NOT NULL DEFAULT 1,
          observacao      TEXT,
          criado_em       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_aulas_rec_ativa ON aulas_recorrentes(ativa);

        ALTER TABLE agendamentos ADD COLUMN aula_recorrente_id INTEGER REFERENCES aulas_recorrentes(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_agenda_aula_rec ON agendamentos(aula_recorrente_id);
      `);
    },
  },
  {
    version: 26,
    name: 'conciliacao-bancaria-ofx',
    up(db) {
      db.exec(`
        -- Conciliacao bancaria: cada linha e uma transacao lida de um extrato
        -- OFX importado, vinculada a uma conta financeira do sistema. O
        -- usuario concilia cada uma com uma conta a pagar/receber existente
        -- (dando baixa nela, se ainda nao paga) ou cria um lancamento novo.
        CREATE TABLE IF NOT EXISTS extrato_ofx_transacoes (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          conta_financeira_id INTEGER NOT NULL REFERENCES contas_financeiras(id) ON DELETE CASCADE,
          fitid               TEXT,                 -- identificador do banco (evita importar 2x)
          data                TEXT NOT NULL,
          valor               REAL NOT NULL,        -- sempre positivo
          tipo                TEXT NOT NULL,        -- credito | debito
          descricao           TEXT,
          status              TEXT NOT NULL DEFAULT 'pendente', -- pendente | conciliada | ignorada
          contas_pagar_id     INTEGER REFERENCES contas_pagar(id) ON DELETE SET NULL,
          contas_receber_id   INTEGER REFERENCES contas_receber(id) ON DELETE SET NULL,
          importado_em        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_ofx_conta ON extrato_ofx_transacoes(conta_financeira_id);
        CREATE INDEX IF NOT EXISTS idx_ofx_status ON extrato_ofx_transacoes(status);
        CREATE INDEX IF NOT EXISTS idx_ofx_fitid ON extrato_ofx_transacoes(conta_financeira_id, fitid);
      `);
    },
  },
  {
    version: 27,
    name: 'regras-conciliacao',
    up(db) {
      db.exec(`
        -- Regras de conciliacao: quando a descricao da transacao do banco
        -- bate com um termo, categoriza/lanca automaticamente (ex.: toda vez
        -- que tiver "tarifa" no debito, lanca como categoria "Despesas
        -- bancarias"). So se aplica quando a transacao nao bate com nenhuma
        -- conta a pagar/receber pendente existente.
        CREATE TABLE IF NOT EXISTS regras_conciliacao (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          padrao               TEXT NOT NULL,     -- termo(s) separados por virgula, buscados na descricao
          tipo                 TEXT NOT NULL,     -- pagar | receber
          categoria_despesa_id INTEGER REFERENCES categorias_despesa(id) ON DELETE SET NULL,
          fornecedor_id        INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
          cliente_id           INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
          descricao_lancamento TEXT,              -- opcional: renomeia o lancamento (senao usa a descricao do banco)
          ativa                INTEGER NOT NULL DEFAULT 1,
          ordem                INTEGER NOT NULL DEFAULT 0,
          criado_em            TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_regras_conc_ativa ON regras_conciliacao(ativa);

        ALTER TABLE extrato_ofx_transacoes ADD COLUMN regra_id INTEGER REFERENCES regras_conciliacao(id) ON DELETE SET NULL;
      `);
    },
  },
  {
    version: 28,
    name: 'pedidos-de-compra',
    up(db) {
      db.exec(`
        -- Pedido de compra: um "rascunho" de compra a ser enviado para o
        -- fornecedor, ANTES da mercadoria chegar (diferente de "compras", que
        -- ja representa uma nota fiscal importada/estoque ja recebido). Cada
        -- pedido e sempre de UM fornecedor so, e so pode ter itens de
        -- produtos daquele mesmo fornecedor.
        CREATE TABLE IF NOT EXISTS pedidos_compra (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          fornecedor_id INTEGER NOT NULL REFERENCES fornecedores(id) ON DELETE RESTRICT,
          status        TEXT NOT NULL DEFAULT 'aberto', -- aberto | enviado | recebido | cancelado
          observacao    TEXT,
          valor_total   REAL NOT NULL DEFAULT 0,
          compra_id     INTEGER REFERENCES compras(id) ON DELETE SET NULL, -- NF-e vinculada quando o pedido e recebido
          criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          enviado_em    TEXT,
          recebido_em   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_pedidos_compra_fornecedor ON pedidos_compra(fornecedor_id);
        CREATE INDEX IF NOT EXISTS idx_pedidos_compra_status ON pedidos_compra(status);

        CREATE TABLE IF NOT EXISTS pedidos_compra_itens (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          pedido_id      INTEGER NOT NULL REFERENCES pedidos_compra(id) ON DELETE CASCADE,
          produto_id     INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
          quantidade     REAL NOT NULL,
          custo_unitario REAL NOT NULL DEFAULT 0,
          valor_total    REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_pedidos_compra_itens_pedido ON pedidos_compra_itens(pedido_id);
      `);
    },
  },
  {
    version: 29,
    name: 'integracao-google-agenda',
    up(db) {
      // Guarda o id do evento espelhado no Google Agenda do usuario, para
      // saber se deve criar (INSERT) ou atualizar/excluir (PATCH/DELETE) na
      // API do Google quando o agendamento mudar. NULL = ainda nao
      // sincronizado (ou integracao desligada).
      db.exec(`ALTER TABLE agendamentos ADD COLUMN google_event_id TEXT;`);
    },
  },
  {
    version: 30,
    name: 'whatsapp-motivo-falha-midia',
    up(db) {
      // Guarda o motivo real de a midia nao ter sido baixada (estagio interno
      // do WhatsApp Web: FETCHING, ERROR..., REUPLOADING, etc). Antes a falha
      // era silenciosa e a mensagem so aparecia como "[imagem]", sem nenhuma
      // pista do que aconteceu nem para o usuario nem para o suporte.
      db.exec(`ALTER TABLE mensagens_whatsapp ADD COLUMN erro_midia TEXT;`);
    },
  },
  {
    version: 31,
    name: 'instituto-educacao-e-musica',
    up(db) {
      db.exec(`
        -- ============================ ENSINO ============================

        -- Curso / modalidade oferecida (Violão, Teclado, Informática básica,
        -- Reforço de matemática...). E o "molde"; quem tem dia, hora e alunos
        -- e a turma.
        CREATE TABLE IF NOT EXISTS cursos (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          nome          TEXT NOT NULL,
          categoria     TEXT NOT NULL DEFAULT 'musica', -- musica | informatica | reforco | outro
          descricao     TEXT,
          carga_horaria REAL,
          ativo         INTEGER NOT NULL DEFAULT 1,
          criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_cursos_ativo ON cursos(ativo);

        -- Instrumentos disponiveis no instituto. A quantidade limita quantos
        -- alunos cabem numa turma que dependa daquele instrumento (nao adianta
        -- abrir turma de violao com 12 vagas se so existem 8 violoes).
        CREATE TABLE IF NOT EXISTS instrumentos (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          nome              TEXT NOT NULL,
          quantidade_total  INTEGER NOT NULL DEFAULT 0,
          observacao        TEXT,
          ativo             INTEGER NOT NULL DEFAULT 1,
          criado_em         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        -- Turma: uma oferta concreta do curso, com periodo, sala e vagas.
        -- instrumento_id (opcional) amarra a turma ao instrumento que ela
        -- consome — informatica e reforco normalmente ficam sem.
        CREATE TABLE IF NOT EXISTS turmas (
          id                     INTEGER PRIMARY KEY AUTOINCREMENT,
          curso_id               INTEGER NOT NULL REFERENCES cursos(id) ON DELETE RESTRICT,
          nome                   TEXT NOT NULL,
          instrumento_id         INTEGER REFERENCES instrumentos(id) ON DELETE SET NULL,
          instrumentos_por_aluno INTEGER NOT NULL DEFAULT 1,
          vagas                  INTEGER NOT NULL DEFAULT 0,
          sala                   TEXT,
          periodo_inicio         TEXT NOT NULL,
          periodo_fim            TEXT,
          status                 TEXT NOT NULL DEFAULT 'aberta', -- planejada | aberta | encerrada | cancelada
          observacao             TEXT,
          criado_em              TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_turmas_curso ON turmas(curso_id);
        CREATE INDEX IF NOT EXISTS idx_turmas_status ON turmas(status);

        -- Uma turma pode ter mais de um encontro por semana (ex.: ter e qui).
        CREATE TABLE IF NOT EXISTS turmas_horarios (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          turma_id    INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
          dia_semana  INTEGER NOT NULL,       -- 0=domingo .. 6=sabado
          hora_inicio TEXT NOT NULL,          -- HH:MM
          hora_fim    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_turmas_horarios_turma ON turmas_horarios(turma_id);

        -- Quem conduz a turma (titular e auxiliares).
        CREATE TABLE IF NOT EXISTS turmas_instrutores (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          turma_id        INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
          profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
          papel           TEXT NOT NULL DEFAULT 'titular' -- titular | auxiliar | suplente
        );
        CREATE INDEX IF NOT EXISTS idx_turmas_instrutores_turma ON turmas_instrutores(turma_id);

        -- Aluno dentro da turma. "espera" = fila quando a turma lotou.
        CREATE TABLE IF NOT EXISTS matriculas (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          turma_id       INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
          aluno_id       INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
          data_matricula TEXT NOT NULL DEFAULT (date('now','localtime')),
          data_saida     TEXT,
          status         TEXT NOT NULL DEFAULT 'ativa', -- ativa | espera | trancada | concluida | desistente
          observacao     TEXT,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_matriculas_turma ON matriculas(turma_id);
        CREATE INDEX IF NOT EXISTS idx_matriculas_aluno ON matriculas(aluno_id);

        -- Chamada: um registro por aluno em cada encontro (o encontro e um
        -- agendamento com turma_id preenchido).
        CREATE TABLE IF NOT EXISTS presencas (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          agendamento_id INTEGER NOT NULL REFERENCES agendamentos(id) ON DELETE CASCADE,
          aluno_id       INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
          situacao       TEXT NOT NULL DEFAULT 'presente', -- presente | falta | justificada
          observacao     TEXT,
          registrado_em  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          UNIQUE (agendamento_id, aluno_id)
        );
        CREATE INDEX IF NOT EXISTS idx_presencas_aluno ON presencas(aluno_id);

        -- O encontro da turma reaproveita a agenda que ja existe: assim turma
        -- e aula individual aparecem no mesmo calendario.
        ALTER TABLE agendamentos ADD COLUMN turma_id INTEGER REFERENCES turmas(id) ON DELETE CASCADE;
        CREATE INDEX IF NOT EXISTS idx_agenda_turma ON agendamentos(turma_id);

        -- ========================== PESSOAS ==========================

        -- Voluntarios: mesma tabela dos profissionais, com o que faltava.
        ALTER TABLE profissionais ADD COLUMN tipo TEXT NOT NULL DEFAULT 'contratado'; -- voluntario | contratado
        ALTER TABLE profissionais ADD COLUMN email TEXT;
        ALTER TABLE profissionais ADD COLUMN documento TEXT;
        ALTER TABLE profissionais ADD COLUMN observacao TEXT;

        -- Em que dias/horarios o voluntario pode ajudar.
        CREATE TABLE IF NOT EXISTS voluntarios_disponibilidade (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
          dia_semana      INTEGER NOT NULL,
          hora_inicio     TEXT NOT NULL,
          hora_fim        TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_voluntarios_disp ON voluntarios_disponibilidade(profissional_id);

        -- Alunos e mantenedores dividem o cadastro de pessoas (o pai de um
        -- aluno pode virar mantenedor sem virar cadastro duplicado).
        ALTER TABLE clientes ADD COLUMN natureza TEXT NOT NULL DEFAULT 'aluno'; -- aluno | mantenedor | ambos
        ALTER TABLE clientes ADD COLUMN data_nascimento TEXT;
        ALTER TABLE clientes ADD COLUMN responsavel_nome TEXT;
        ALTER TABLE clientes ADD COLUMN responsavel_telefone TEXT;

        -- ======================== ARRECADACAO ========================

        -- Projeto/edital com verba carimbada. Amarrar entrada e despesa a um
        -- projeto desde o inicio e o que torna a prestacao de contas possivel.
        CREATE TABLE IF NOT EXISTS projetos (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          nome      TEXT NOT NULL,
          descricao TEXT,
          ativo     INTEGER NOT NULL DEFAULT 1,
          criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        -- Oferta/doacao em dinheiro (pontual ou contribuicao do mantenedor
        -- daquele mes, quando registrada).
        CREATE TABLE IF NOT EXISTS ofertas (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          cliente_id     INTEGER REFERENCES clientes(id) ON DELETE SET NULL, -- mantenedor cadastrado
          doador_nome    TEXT,                                               -- doacao avulsa/anonima
          valor          REAL NOT NULL DEFAULT 0,
          data           TEXT NOT NULL DEFAULT (date('now','localtime')),
          forma          TEXT,                                               -- pix | dinheiro | transferencia | outro
          projeto_id     INTEGER REFERENCES projetos(id) ON DELETE SET NULL,
          observacao     TEXT,
          recibo_emitido INTEGER NOT NULL DEFAULT 0,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_ofertas_data ON ofertas(data);

        -- Doacao em especie: um violao doado nao entra no caixa, mas precisa
        -- ser registrado (para agradecer, prestar contas e saber o que se tem).
        -- Quando for instrumento, pode somar ao acervo em instrumentos.
        CREATE TABLE IF NOT EXISTS doacoes_especie (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          cliente_id      INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
          doador_nome     TEXT,
          descricao       TEXT NOT NULL,
          quantidade      REAL NOT NULL DEFAULT 1,
          valor_estimado  REAL,
          data            TEXT NOT NULL DEFAULT (date('now','localtime')),
          projeto_id      INTEGER REFERENCES projetos(id) ON DELETE SET NULL,
          instrumento_id  INTEGER REFERENCES instrumentos(id) ON DELETE SET NULL,
          observacao      TEXT,
          criado_em       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_doacoes_especie_data ON doacoes_especie(data);

        -- Despesa tambem aponta para o projeto (verba carimbada).
        ALTER TABLE contas_pagar ADD COLUMN projeto_id INTEGER REFERENCES projetos(id) ON DELETE SET NULL;
      `);
    },
  },
  {
    version: 32,
    name: 'instituto-patrimonio-emprestimo-e-diretoria',
    up(db) {
      db.exec(`
        -- Unidade fisica do instrumento ("violao nº 3"). O cadastro por
        -- unidade e opcional: quem so quer contar quantidade continua usando
        -- instrumentos.quantidade_total. Registrar unidades e o que permite
        -- emprestar um instrumento especifico e saber com quem ele esta.
        CREATE TABLE IF NOT EXISTS instrumentos_unidades (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          instrumento_id INTEGER NOT NULL REFERENCES instrumentos(id) ON DELETE CASCADE,
          numero         TEXT NOT NULL,                  -- "03", "Violao 3", tombo...
          estado         TEXT NOT NULL DEFAULT 'disponivel', -- disponivel | emprestado | manutencao | baixado
          observacao     TEXT,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          UNIQUE (instrumento_id, numero)
        );
        CREATE INDEX IF NOT EXISTS idx_unidades_instrumento ON instrumentos_unidades(instrumento_id);

        -- Emprestimo de uma unidade para um aluno levar para casa.
        CREATE TABLE IF NOT EXISTS emprestimos_instrumento (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          unidade_id          INTEGER NOT NULL REFERENCES instrumentos_unidades(id) ON DELETE CASCADE,
          aluno_id            INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
          data_emprestimo     TEXT NOT NULL DEFAULT (date('now','localtime')),
          previsao_devolucao  TEXT,
          data_devolucao      TEXT,
          observacao_saida    TEXT,
          observacao_retorno  TEXT,
          criado_em           TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_emprestimos_unidade ON emprestimos_instrumento(unidade_id);
        CREATE INDEX IF NOT EXISTS idx_emprestimos_aluno ON emprestimos_instrumento(aluno_id);
        CREATE INDEX IF NOT EXISTS idx_emprestimos_abertos ON emprestimos_instrumento(data_devolucao);

        -- Aluno que TEM o proprio instrumento nao ocupa vaga do acervo: e o
        -- que permite abrir turma maior do que a quantidade de instrumentos.
        -- E por tipo de instrumento (ter violao proprio nao ajuda em teclado).
        CREATE TABLE IF NOT EXISTS alunos_instrumentos_proprios (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          aluno_id       INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
          instrumento_id INTEGER NOT NULL REFERENCES instrumentos(id) ON DELETE CASCADE,
          observacao     TEXT,
          UNIQUE (aluno_id, instrumento_id)
        );
        CREATE INDEX IF NOT EXISTS idx_aluno_instr_proprio ON alunos_instrumentos_proprios(aluno_id);

        -- Diretoria e equipe administrativa do instituto (presidente,
        -- tesoureiro, secretario...). Guarda o mandato, porque em entidade
        -- sem fins lucrativos o cargo tem prazo e quem assina documento muda.
        CREATE TABLE IF NOT EXISTS membros_instituto (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          nome          TEXT NOT NULL,
          cargo         TEXT NOT NULL DEFAULT 'outro',
          documento     TEXT,
          telefone      TEXT,
          email         TEXT,
          mandato_inicio TEXT,
          mandato_fim   TEXT,
          assina_documentos INTEGER NOT NULL DEFAULT 0, -- aparece como assinatura em recibos/declaracoes
          ativo         INTEGER NOT NULL DEFAULT 1,
          observacao    TEXT,
          criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_membros_ativo ON membros_instituto(ativo);
      `);
    },
  },
  {
    version: 33,
    name: 'instituto-lista-espera-atas-e-autorizacoes',
    up(db) {
      db.exec(`
        -- Quem procurou o instituto quando NAO havia turma aberta do curso.
        -- Sem isso essa pessoa se perde: e captacao de aluno praticamente de
        -- graca, porque ela ja demonstrou interesse.
        CREATE TABLE IF NOT EXISTS lista_espera (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          aluno_id      INTEGER REFERENCES clientes(id) ON DELETE SET NULL, -- ja cadastrado
          nome          TEXT,                                              -- ainda nao cadastrado
          telefone      TEXT,
          responsavel_nome TEXT,
          curso_id      INTEGER REFERENCES cursos(id) ON DELETE CASCADE,
          preferencia   TEXT,                                              -- "manha", "noite", "sabado"...
          observacao    TEXT,
          status        TEXT NOT NULL DEFAULT 'aguardando', -- aguardando | contatado | matriculado | desistiu
          contatado_em  TEXT,
          matricula_id  INTEGER REFERENCES matriculas(id) ON DELETE SET NULL,
          criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_lista_espera_curso ON lista_espera(curso_id);
        CREATE INDEX IF NOT EXISTS idx_lista_espera_status ON lista_espera(status);

        -- Ata de reuniao: associacao precisa registrar o que foi deliberado.
        CREATE TABLE IF NOT EXISTS atas (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          titulo       TEXT NOT NULL,
          data         TEXT NOT NULL DEFAULT (date('now','localtime')),
          hora         TEXT,
          local        TEXT,
          pauta        TEXT,
          deliberacoes TEXT,
          observacao   TEXT,
          criado_em    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_atas_data ON atas(data);

        CREATE TABLE IF NOT EXISTS atas_participantes (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          ata_id    INTEGER NOT NULL REFERENCES atas(id) ON DELETE CASCADE,
          membro_id INTEGER REFERENCES membros_instituto(id) ON DELETE SET NULL,
          nome      TEXT NOT NULL,   -- guarda o nome mesmo se o membro sair depois
          presente  INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_atas_participantes ON atas_participantes(ata_id);

        -- Termo de autorizacao (uso de imagem, saida). Menor de idade sem
        -- termo assinado e um risco real para o instituto.
        CREATE TABLE IF NOT EXISTS autorizacoes (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          aluno_id     INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
          tipo         TEXT NOT NULL DEFAULT 'imagem', -- imagem | saida | outro
          entregue     INTEGER NOT NULL DEFAULT 0,
          data_entrega TEXT,
          observacao   TEXT,
          criado_em    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          UNIQUE (aluno_id, tipo)
        );
        CREATE INDEX IF NOT EXISTS idx_autorizacoes_aluno ON autorizacoes(aluno_id);

        -- Avisos ja enviados por WhatsApp, para nao repetir o mesmo lembrete
        -- (confirmacao de aula, cobranca de instrumento atrasado).
        CREATE TABLE IF NOT EXISTS avisos_enviados (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          tipo       TEXT NOT NULL,      -- aula_amanha | emprestimo_atrasado
          referencia TEXT NOT NULL,      -- chave do que foi avisado (ex.: "encontro:12:aluno:3")
          enviado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          UNIQUE (tipo, referencia)
        );
      `);
    },
  },
  {
    version: 34,
    name: 'oferta-entra-no-caixa',
    up(db) {
      // A oferta passa a ser um lancamento financeiro de verdade: entra numa
      // conta (caixa, banco, PIX), soma no saldo e pode ser conciliada com o
      // extrato. Antes ela vivia isolada — o dinheiro aparecia na prestacao
      // de contas mas nao no saldo, o que fazia os dois nunca baterem.
      db.exec(`
        ALTER TABLE ofertas ADD COLUMN conta_financeira_id INTEGER REFERENCES contas_financeiras(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_ofertas_conta ON ofertas(conta_financeira_id);

        -- A transacao do extrato tambem pode casar com uma oferta, nao so com
        -- conta a pagar/receber.
        ALTER TABLE extrato_ofx_transacoes ADD COLUMN oferta_id INTEGER REFERENCES ofertas(id) ON DELETE SET NULL;
      `);

      // Ofertas ja registradas antes desta versao entram no caixa padrao da
      // forma de pagamento usada, para o saldo passar a refletir a realidade.
      const mapa = db.prepare("SELECT valor FROM config WHERE chave = 'financeiro_mapa_contas'").get();
      let contaPorForma = {};
      try { contaPorForma = mapa ? JSON.parse(mapa.valor) : {}; } catch (_) { contaPorForma = {}; }

      const ofertas = db.prepare('SELECT * FROM ofertas').all();
      const lancar = db.prepare(`
        INSERT INTO contas_financeiras_mov (conta_id, tipo, valor, origem, referencia_id, descricao, data)
        VALUES (?, 'entrada', ?, 'oferta', ?, ?, ?)
      `);
      const marcar = db.prepare('UPDATE ofertas SET conta_financeira_id = ? WHERE id = ?');

      ofertas.forEach((o) => {
        const contaId = contaPorForma[o.forma] || contaPorForma.dinheiro || null;
        if (!contaId) return;
        lancar.run(contaId, o.valor, o.id, `Oferta — ${o.doador_nome || 'doador'}`, o.data);
        marcar.run(contaId, o.id);
      });
    },
  },

  {
    version: 35,
    name: 'instituto-vira-categoria',
    up(db) {
      // O instituto era um "ramo de serviço", ao lado de salão e oficina. Mas
      // uma ONG não presta serviço nem vende — ela atende. Agora ele é uma
      // categoria de atividade propria, ao lado de comercio/servico/ambos.
      // Quem ja usava o modo instituto passa para a categoria nova.
      const ramo = db.prepare("SELECT valor FROM config WHERE chave = 'ramo_servico'").get();
      if (!ramo || ramo.valor !== 'instituto') return;
      db.prepare(`
        INSERT INTO config (chave, valor) VALUES ('perfil_negocio', 'instituto')
        ON CONFLICT(chave) DO UPDATE SET valor = 'instituto'
      `).run();
    },
  },

  {
    version: 36,
    name: 'instituto-semestre-e-voluntariado',
    up(db) {
      db.exec(`
        -- Turma por periodo: a turma de 2026/2 nasce da de 2026/1. Guardar a
        -- origem e o que transforma uma pilha de turmas soltas em historico.
        ALTER TABLE turmas ADD COLUMN turma_origem_id INTEGER REFERENCES turmas(id) ON DELETE SET NULL;
        ALTER TABLE turmas ADD COLUMN periodo_rotulo TEXT;
        CREATE INDEX IF NOT EXISTS idx_turmas_origem ON turmas(turma_origem_id);

        -- Voluntariado fora da sala de aula: evento, manutencao do acervo,
        -- administrativo. Sem isso so contava quem dava aula.
        CREATE TABLE IF NOT EXISTS voluntarios_atividades (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
          data            TEXT NOT NULL,
          hora_inicio     TEXT,
          hora_fim        TEXT,
          horas           REAL NOT NULL DEFAULT 0,
          tipo            TEXT NOT NULL DEFAULT 'outro',
          descricao       TEXT,
          criado_em       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_vol_atividades ON voluntarios_atividades(profissional_id, data);
      `);
    },
  },

  {
    version: 37,
    name: 'modelos-de-documento',
    up(db) {
      db.exec(`
        -- Cada instituto tem o seu texto (o do estatuto, o que o contador
        -- pediu, o que a prefeitura aceita). Guardar so o que foi editado:
        -- quem nao mexer continua no texto padrao do sistema.
        CREATE TABLE IF NOT EXISTS modelos_documento (
          chave         TEXT PRIMARY KEY,
          corpo         TEXT NOT NULL,
          atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        -- O termo de adesao pede o endereco do voluntario ("residente e
        -- domiciliado em"), que ate agora nao existia no cadastro.
        ALTER TABLE profissionais ADD COLUMN endereco TEXT;
      `);
    },
  },
  {
    version: 38,
    name: 'tarefas-fixas',
    up(db) {
      db.exec(`
        -- Tarefa que se repete todo mes (ex.: prestar contas, pagar boleto de
        -- aluguel, fazer a folha de pagamento) — mesmo espirito da conta fixa
        -- do financeiro: o modelo fica aqui, e uma tarefa de verdade e gerada
        -- a cada mes pra entrar no quadro normal.
        CREATE TABLE IF NOT EXISTS tarefas_fixas (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          titulo          TEXT NOT NULL,
          descricao       TEXT,
          responsavel_id  INTEGER REFERENCES profissionais(id) ON DELETE SET NULL,
          dia_mes         INTEGER NOT NULL,
          ativa           INTEGER NOT NULL DEFAULT 1,
          criada_em       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        ALTER TABLE tarefas ADD COLUMN tarefa_fixa_id INTEGER REFERENCES tarefas_fixas(id) ON DELETE SET NULL;
      `);
    },
  },
  {
    version: 39,
    name: 'objetivos',
    up(db) {
      db.exec(`
        -- Objetivo pra acompanhar (ex.: abrir CNPJ, comprar instrumento,
        -- abrir turma nova). Valor e opcional: so entra na conta de "o que
        -- da pra fazer com o saldo em caixa" quem tiver valor cadastrado.
        CREATE TABLE IF NOT EXISTS objetivos (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          titulo        TEXT NOT NULL,
          descricao     TEXT,
          valor         REAL,
          status        TEXT NOT NULL DEFAULT 'aberto', -- aberto | concluido | cancelado
          criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          concluido_em  TEXT
        );
      `);
    },
  },
  {
    version: 40,
    name: 'turma-multiplos-instrumentos',
    up(db) {
      db.exec(`
        -- Ate aqui uma turma so podia depender de UM instrumento. Uma turma
        -- de banda (bateria + teclado + violao ao mesmo tempo) nao cabia
        -- nesse modelo. turmas.instrumento_id fica no lugar (por
        -- compatibilidade), mas para de ser escrito: quem manda agora e essa
        -- tabela, com uma linha por instrumento que a turma precisa.
        CREATE TABLE IF NOT EXISTS turmas_instrumentos (
          turma_id       INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
          instrumento_id INTEGER NOT NULL REFERENCES instrumentos(id) ON DELETE CASCADE,
          PRIMARY KEY (turma_id, instrumento_id)
        );
        INSERT INTO turmas_instrumentos (turma_id, instrumento_id)
          SELECT id, instrumento_id FROM turmas WHERE instrumento_id IS NOT NULL;
      `);
    },
  },
  {
    version: 41,
    name: 'turma-suspensao-de-encontro',
    up(db) {
      db.exec(`
        -- cursos.carga_horaria ja existe desde a v31 (e ja alimenta o
        -- certificado). O que faltava era o dia de aula poder ser suspenso
        -- (feriado, imprevisto, instrutor viajou) sem contar como aula dada
        -- nem empurrar a previsao de termino errada da turma.
        ALTER TABLE agendamentos ADD COLUMN suspensa INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE agendamentos ADD COLUMN motivo_suspensao TEXT;
      `);
    },
  },
  {
    version: 42,
    name: 'foto-de-aluno-e-voluntario',
    up(db) {
      db.exec(`
        -- Mesmo espirito da foto de produto: guarda so o nome do arquivo em
        -- uploads/pessoas, pra sair na ficha do aluno e na escala do Panorama.
        ALTER TABLE clientes ADD COLUMN foto_path TEXT;
        ALTER TABLE profissionais ADD COLUMN foto_path TEXT;
      `);
    },
  },
  {
    version: 43,
    name: 'matricula-instrumento-escolhido',
    up(db) {
      db.exec(`
        -- Turma com mais de um instrumento na lista (ex.: violao aco E
        -- violao de naylon) e um cardapio de opcoes, nao uma exigencia de
        -- que cada aluno precise de todos ao mesmo tempo -- cada aluno usa
        -- UM deles. Sem saber qual, a conferencia de acervo checava a
        -- disponibilidade de TODOS os instrumentos pra cada aluno, travando
        -- matricula de quem so precisava do que ainda tinha sobrando.
        ALTER TABLE matriculas ADD COLUMN instrumento_id INTEGER REFERENCES instrumentos(id);
      `);
    },
  },
  {
    version: 44,
    name: 'turma-horas-abonadas',
    up(db) {
      db.exec(`
        -- Turma antiga, cadastrada no sistema depois de já ter dado aula
        -- (ex.: comecou em papel meses atras): o calendario so existe a
        -- partir da data em que a turma entrou no sistema, entao o progresso
        -- automatico (que soma os encontros do calendario) fica menor que a
        -- realidade. Este numero e um abono manual de horas -- soma direto
        -- no progresso, sem inventar encontro/chamada retroativos.
        ALTER TABLE turmas ADD COLUMN horas_abonadas REAL NOT NULL DEFAULT 0;
      `);
    },
  },
  {
    version: 45,
    name: 'limpar-encontros-de-turma-encerrada-ou-cancelada',
    up(db) {
      // Encerrar/cancelar pela edição genérica da turma passou a limpar os
      // encontros futuros sem chamada (v0.79.1), mas só a partir dali pra
      // frente -- turma que já estava encerrada/cancelada antes disso ficou
      // com aulas fantasmas na Agenda e na Chamada pra sempre, porque nada
      // mais dispara aquela limpeza pra ela. Esta e' a limpeza retroativa,
      // rodando uma vez so.
      db.exec(`
        DELETE FROM agendamentos
        WHERE turma_id IN (SELECT id FROM turmas WHERE status IN ('cancelada','encerrada'))
          AND date(data) > date('now','localtime')
          AND NOT EXISTS (SELECT 1 FROM presencas p WHERE p.agendamento_id = agendamentos.id);
      `);
    },
  },
  {
    version: 46,
    name: 'sincronizar-instrutor-dos-encontros',
    up(db) {
      // Trocar o instrutor de uma turma (ou escalar um pela primeira vez
      // depois que a turma já tinha encontros gerados) só gravava em
      // turmas_instrutores -- os encontros futuros continuavam com o
      // profissional_id antigo (ou em branco), entao a Agenda e a Chamada
      // mostravam a turma sem instrutor mesmo com um titular escalado.
      // Sincroniza uma vez so, a partir de agora em diante fica automatico.
      db.exec(`
        UPDATE agendamentos
        SET profissional_id = (
          SELECT profissional_id FROM turmas_instrutores
          WHERE turma_id = agendamentos.turma_id AND papel = 'titular'
          LIMIT 1
        )
        WHERE turma_id IS NOT NULL
          AND date(data) >= date('now','localtime')
          AND NOT EXISTS (SELECT 1 FROM presencas p WHERE p.agendamento_id = agendamentos.id);
      `);
    },
  },
  {
    version: 47,
    name: 'conferencia-de-mercadoria',
    up(db) {
      // Fila de conferencia: quando o produto e cadastrado em lote (antes da
      // mercadoria fisica chegar), cada item entra aqui tambem -- alem de ir
      // pra Precificacao -- pra alguem bater, item a item, o que realmente
      // chegou na caixa contra o que foi cadastrado no sistema.
      db.exec(`
        CREATE TABLE IF NOT EXISTS conferencia_mercadoria (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          produto_id           INTEGER REFERENCES produtos(id) ON DELETE CASCADE,
          referencia           TEXT,
          descricao            TEXT NOT NULL,
          quantidade_esperada  REAL NOT NULL DEFAULT 0,
          quantidade_conferida REAL,
          conferido            INTEGER NOT NULL DEFAULT 0,
          observacao           TEXT,
          lote                 TEXT,
          lote_data            TEXT,
          ordem                INTEGER NOT NULL DEFAULT 0,
          criado_em            TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_conferencia_lote ON conferencia_mercadoria(lote);
        CREATE INDEX IF NOT EXISTS idx_conferencia_produto ON conferencia_mercadoria(produto_id);
      `);
    },
  },
  {
    version: 48,
    name: 'precificacao-preco-manual',
    up(db) {
      // Permite digitar o preco de venda que o usuario quer, em vez de aceitar
      // so' o sugerido pelo markup divisor. Quando preenchido, "Aplicar" grava
      // esse valor no produto; quando vazio, continua usando o sugerido.
      db.exec(`ALTER TABLE precificacao_produtos ADD COLUMN preco_venda_manual REAL;`);
    },
  },
  {
    version: 49,
    name: 'nfse-portal-nacional',
    up(db) {
      db.exec(`
        -- Endereco estruturado do cliente (tomador do servico). O campo
        -- "endereco" de texto livre continua existindo — estes sao usados
        -- so' na hora de montar a DPS (Declaracao de Prestacao de Servico) e
        -- sao opcionais: o schema nacional permite emitir sem endereco do
        -- tomador (nem sempre o prestador tem esse dado completo em maos).
        ALTER TABLE clientes ADD COLUMN endereco_cep TEXT;
        ALTER TABLE clientes ADD COLUMN endereco_logradouro TEXT;
        ALTER TABLE clientes ADD COLUMN endereco_numero TEXT;
        ALTER TABLE clientes ADD COLUMN endereco_complemento TEXT;
        ALTER TABLE clientes ADD COLUMN endereco_bairro TEXT;
        ALTER TABLE clientes ADD COLUMN endereco_municipio_ibge TEXT; -- codigo IBGE (7 digitos)
        ALTER TABLE clientes ADD COLUMN endereco_uf TEXT;

        -- Codigo de tributacao nacional do ISSQN (LC 116/2003 + desdobro
        -- nacional, 6 digitos) — equivalente ao NCM/CFOP, mas para servico.
        ALTER TABLE produtos ADD COLUMN codigo_servico_nacional TEXT;

        -- Campos especificos da NFS-e (Portal Nacional) na tabela de notas
        -- ja existente: id_dps e o identificador de 45 posicoes gerado na
        -- emissao (formacao definida no Anexo I do layout nacional);
        -- codigo_verificacao vem na resposta, usado no DANFSe.
        ALTER TABLE notas_fiscais ADD COLUMN id_dps TEXT;
        ALTER TABLE notas_fiscais ADD COLUMN codigo_verificacao TEXT;
      `);
    },
  },
  {
    version: 50,
    name: 'agenda-remarcar-aula',
    up(db) {
      db.exec(`
        -- Remarcar aula: guarda de onde ela veio (para a grade semanal mostrar
        -- "foi p/ ..." no horario antigo) e quem pediu. data_original e' o dia
        -- em que a aula fixa gerou esta ocorrencia; sem ela, o gerador de
        -- ocorrencias recriaria a aula no dia antigo depois de remarcada.
        ALTER TABLE agendamentos ADD COLUMN remarcado_de_data TEXT;
        ALTER TABLE agendamentos ADD COLUMN remarcado_de_hora TEXT;
        ALTER TABLE agendamentos ADD COLUMN remarcado_por TEXT; -- 'aluno' | 'professor' | 'feriado'
        ALTER TABLE agendamentos ADD COLUMN data_original TEXT;
      `);
    },
  },
  {
    version: 51,
    name: 'mensalidade-pausa-e-reajuste',
    up(db) {
      db.exec(`
        -- Pausa com periodo: a cobranca do mes e' pulada quando o vencimento cai
        -- dentro de [pausada_de, pausada_ate] (ate NULL = ate retomar). Separada
        -- de "ativa", que continua sendo o encerramento/pausa sem data.
        ALTER TABLE assinaturas ADD COLUMN pausada_de TEXT;
        ALTER TABLE assinaturas ADD COLUMN pausada_ate TEXT;

        CREATE TABLE IF NOT EXISTS assinaturas_reajustes (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          assinatura_id INTEGER NOT NULL REFERENCES assinaturas(id) ON DELETE CASCADE,
          valor_anterior REAL NOT NULL,
          valor_novo    REAL NOT NULL,
          motivo        TEXT,
          aplicado_em   TEXT NOT NULL DEFAULT (date('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_assin_reaj_assinatura ON assinaturas_reajustes(assinatura_id);
      `);
    },
  },
];

/**
 * Aplica todas as migrations pendentes. Idempotente.
 */
function runMigrations() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER NOT NULL,
      aplicada_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);

  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  const atual = row && row.v ? row.v : 0;

  const pendentes = migrations
    .filter((m) => m.version > atual)
    .sort((a, b) => a.version - b.version);

  for (const m of pendentes) {
    const aplicar = db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(m.version);
    });
    aplicar();
    // eslint-disable-next-line no-console
    console.log(`[db] migration aplicada: v${m.version} (${m.name})`);
  }

  return { de: atual, para: migrations[migrations.length - 1].version };
}

// A lista sai exportada para dar para testar uma migration isolada, sem ter
// que reconstruir o banco inteiro na versao anterior.
module.exports = { runMigrations, migrations };
