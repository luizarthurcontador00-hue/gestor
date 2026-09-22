'use strict';

/**
 * NFS-e emitida direto pelo Portal Nacional (gov.br/nfse), sem gateway.
 *
 * Diferente do NFC-e (fiscalService.js, que manda o pedido pronto pra um
 * gateway pago assinar e falar com a SEFAZ), aqui o sistema assume ele
 * mesmo o que o gateway faria: guarda o certificado digital A1 do
 * contribuinte, monta e assina a DPS (Declaração de Prestação de Serviço)
 * em XML e fala direto com a API da Receita por TLS mútuo (o certificado é
 * apresentado no handshake HTTPS — não é token/header).
 *
 * Fontes oficiais usadas pra montar isso (baixadas em
 * docs/fiscal/nfse-nacional/, versão 1.01 — conferir se saiu versão nova
 * antes de reusar em produção):
 *  - Esquemas XSD: docs/fiscal/nfse-nacional/xsd/1.01/*.xsd
 *  - Layout da DPS: docs/fiscal/nfse-nacional/ANEXO_I-DPS_NFSe-v1.01.xlsx
 *  - Swagger real da API (Produção Restrita):
 *    sefin.producaorestrita.nfse.gov.br/SefinNacional/swagger/docs/v1
 *    adn.producaorestrita.nfse.gov.br/adn/swagger/v1/swagger.json
 *
 * ATENÇÃO — o que NÃO foi validado contra uma conta real (testar em
 * Produção Restrita antes de confiar em produção):
 *  - Algoritmo de assinatura: usei RSA-SHA256 / C14N exclusive (os
 *    padrões atuais do xml-crypto), porque é um sistema novo (2023+) e
 *    SHA-1 já é desaconselhado pela ICP-Brasil para assinaturas novas —
 *    mas os documentos oficiais que consultei não cravam o algoritmo
 *    explicitamente. Se a API rejeitar a assinatura, esse é o primeiro
 *    lugar a olhar (ver `assinarDps`).
 *  - Se o endpoint de Parâmetros Municipais (consultarAliquota) exige o
 *    mesmo TLS mútuo dos demais — assumi que sim (ver `chamarADN`).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const forge = require('node-forge');
const { XMLBuilder, XMLParser } = require('fast-xml-parser');
const { SignedXml } = require('xml-crypto');
const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const paths = require('../paths');

const CAMINHO_CERTIFICADO = path.join(paths.certificadosDir, 'certificado.pfx');

const HOSTS = {
  homologacao: { sefin: 'sefin.producaorestrita.nfse.gov.br', adn: 'adn.producaorestrita.nfse.gov.br' },
  producao: { sefin: 'sefin.nfse.gov.br', adn: 'adn.nfse.gov.br' },
};

// ------------------------------ Configuração ------------------------------

const CHAVES_CONFIG = [
  'loja_cnpj', 'nome_loja', 'fiscal_inscricao_municipal',
  'fiscal_nfse_ambiente', 'fiscal_nfse_municipio_ibge', 'fiscal_nfse_certificado_senha',
  'fiscal_nfse_op_simples_nacional', 'fiscal_nfse_regime_especial_trib',
];

function obterConfig() {
  const db = getDb();
  const linhas = db.prepare(
    `SELECT chave, valor FROM config WHERE chave IN (${CHAVES_CONFIG.map(() => '?').join(',')})`
  ).all(...CHAVES_CONFIG);
  const cfg = {};
  linhas.forEach((l) => { cfg[l.chave] = l.valor; });
  return {
    cnpj: (cfg.loja_cnpj || '').replace(/\D/g, ''),
    nome: cfg.nome_loja || '',
    inscricaoMunicipal: cfg.fiscal_inscricao_municipal || '',
    ambiente: cfg.fiscal_nfse_ambiente === 'producao' ? 'producao' : 'homologacao',
    municipioIbge: cfg.fiscal_nfse_municipio_ibge || '',
    certificadoSenha: cfg.fiscal_nfse_certificado_senha || '',
    // 1-Não Optante | 2-MEI | 3-ME/EPP (Simples Nacional) — ver TSOpSimpNac
    opSimplesNacional: cfg.fiscal_nfse_op_simples_nacional || '3',
    // 0-Nenhum | 1-Ato Cooperado | 2-Estimativa | ... 5-Profissional Autônomo | 9-Outros — ver TSRegEspTrib
    regimeEspecial: cfg.fiscal_nfse_regime_especial_trib || '0',
  };
}

function certificadoExiste() {
  return fs.existsSync(CAMINHO_CERTIFICADO);
}

function estaConfigurado() {
  const cfg = obterConfig();
  return !!(cfg.cnpj && cfg.municipioIbge && cfg.certificadoSenha && certificadoExiste());
}

// ------------------------------ Certificado (.pfx) ------------------------------

/**
 * Le o .pfx do disco e extrai { cert, key } em PEM usando a senha guardada
 * na config. Tambem devolve o Buffer bruto do .pfx, que e o formato que o
 * https.Agent do proprio Node aceita nativamente pra TLS mutuo (nao precisa
 * de PEM pra isso — so pra assinar o XML e que a chave precisa estar
 * "aberta").
 */
function carregarCertificado() {
  if (!certificadoExiste()) {
    throw new AppError('Certificado digital não encontrado. Envie o arquivo .pfx em Configurações → Módulo Fiscal → NFS-e.');
  }
  const cfg = obterConfig();
  if (!cfg.certificadoSenha) {
    throw new AppError('Senha do certificado não configurada.');
  }
  const pfxBuffer = fs.readFileSync(CAMINHO_CERTIFICADO);

  let cert;
  let key;
  try {
    const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, cfg.certificadoSenha);
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    const keyBags = (
      p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]
      || p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]
      || []
    );
    if (!certBags.length || !keyBags.length) {
      throw new Error('Certificado não tem par de certificado + chave privada dentro do .pfx.');
    }
    cert = forge.pki.certificateToPem(certBags[0].cert);
    key = forge.pki.privateKeyToPem(keyBags[0].key);
  } catch (e) {
    throw new AppError(`Não foi possível abrir o certificado (senha incorreta ou arquivo inválido): ${e.message}`);
  }

  return { pfxBuffer, cert, key };
}

/**
 * Dados do certificado carregado (nome do titular e validade), pra mostrar
 * na tela de Configurações sem expor a chave privada. Devolve null se ainda
 * não tem certificado ou senha configurados, ou se a senha estiver errada.
 */
function certificadoInfo() {
  if (!certificadoExiste()) return null;
  try {
    const { cert } = carregarCertificado();
    const forgeCert = forge.pki.certificateFromPem(cert);
    return {
      titular: forgeCert.subject.getField('CN') ? forgeCert.subject.getField('CN').value : null,
      valido_ate: forgeCert.validity.notAfter.toISOString().slice(0, 10),
      expirado: forgeCert.validity.notAfter < new Date(),
    };
  } catch (_) {
    return null;
  }
}

// ------------------------------ Requisição mTLS ------------------------------

/**
 * POST/GET pra API do Portal Nacional apresentando o certificado do
 * contribuinte no handshake TLS (autenticação mútua) — é assim que a API
 * identifica quem está emitindo, não tem token/header de autenticação.
 */
function requisicaoMTLS({ host, path: caminho, method = 'GET', body, pfxBuffer, senha }) {
  return new Promise((resolve, reject) => {
    const dados = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = https.request({
      host,
      path: caminho,
      method,
      pfx: pfxBuffer,
      passphrase: senha,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(dados ? { 'Content-Length': dados.length } : {}),
      },
    }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8');
        let json = null;
        try { json = texto ? JSON.parse(texto) : null; } catch (_) { /* resposta nao-JSON */ }
        resolve({ status: res.statusCode, json, texto });
      });
    });
    req.on('error', (e) => reject(new AppError(`Falha de conexão com o Portal Nacional da NFS-e: ${e.message}`)));
    if (dados) req.write(dados);
    req.end();
  });
}

async function chamarSefin(caminho, { method = 'GET', body } = {}) {
  const cfg = obterConfig();
  const { pfxBuffer } = carregarCertificado();
  const host = HOSTS[cfg.ambiente].sefin;
  const resp = await requisicaoMTLS({ host, path: `/SefinNacional${caminho}`, method, body, pfxBuffer, senha: cfg.certificadoSenha });
  return resp;
}

async function chamarADN(caminho) {
  const cfg = obterConfig();
  const { pfxBuffer } = carregarCertificado();
  const host = HOSTS[cfg.ambiente].adn;
  const resp = await requisicaoMTLS({ host, path: caminho, method: 'GET', pfxBuffer, senha: cfg.certificadoSenha });
  return resp;
}

/** Consulta a alíquota do ISSQN parametrizada pelo município (evita manter tabela própria). */
async function consultarAliquota(codigoMunicipio, codigoServico, competenciaISO) {
  const resp = await chamarADN(`/parametrizacao/${codigoMunicipio}/${codigoServico}/${competenciaISO}/aliquota`);
  if (resp.status !== 200) {
    throw new AppError((resp.json && resp.json.mensagem) || 'Não foi possível consultar a alíquota do ISSQN para este município/serviço.');
  }
  return resp.json;
}

// ------------------------------ Montagem da DPS (XML) ------------------------------

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: false,
  suppressEmptyNode: true,
});

/** "AAAA-MM-DDThh:mm:ss+hh:mm" — TSDateTimeUTC exige offset numérico, não aceita sufixo "Z". */
function dataHoraComOffset(d = new Date()) {
  const p = (n) => String(Math.abs(n)).padStart(2, '0');
  const offsetMin = -d.getTimezoneOffset();
  const sinal = offsetMin >= 0 ? '+' : '-';
  const offset = `${sinal}${p(Math.floor(Math.abs(offsetMin) / 60))}:${p(Math.abs(offsetMin) % 60)}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${offset}`;
}

function soDigitos(v) { return String(v || '').replace(/\D/g, ''); }

/**
 * Monta o identificador de 45 posições da DPS: "DPS" + cLocEmi(7) +
 * tipoInscricaoFederal(1) + inscricaoFederal(14) + serie(5) + numero(15).
 * Regra exata do Anexo I / TSIdDPS (docs/fiscal/nfse-nacional).
 */
function montarIdDps({ municipioIbge, cnpj, serie, numero }) {
  const insc14 = soDigitos(cnpj).padStart(14, '0');
  const serie5 = String(serie).padStart(5, '0');
  const numero15 = String(numero).padStart(15, '0');
  return `DPS${municipioIbge}2${insc14}${serie5}${numero15}`;
}

/**
 * Monta o XML da DPS (ainda sem assinatura) a partir da venda, dos itens
 * de serviço dela e (se houver) do cliente. Função pura — não acessa
 * rede/banco — pra poder ser testada isolada, no mesmo espírito de
 * `montarPayloadNFCe` em fiscalService.js.
 *
 * Simplificações assumidas (fora do escopo do que foi pedido; cobrem o
 * caso comum de uma pequena empresa prestando serviço no próprio
 * município, sem comércio exterior/obra/evento/retenção federal):
 *  - Um único código de serviço por DPS: se os itens de serviço da venda
 *    tiverem códigos diferentes, a validação em cima (emitirNFSe) barra.
 *  - tpRetISSQN sempre "1" (não retido) e tribISSQN sempre "1" (tributável).
 *  - indTotTrib = "0" (não informa valor estimado de tributos).
 */
function montarDPS({ numeroDps, venda, itensServico, cliente, config }) {
  const dataServico = String(venda.data || '').slice(0, 10);
  const idDps = montarIdDps({ municipioIbge: config.municipioIbge, cnpj: config.cnpj, serie: '1', numero: numeroDps });

  const codigosServico = [...new Set(itensServico.map((i) => i.codigo_servico_nacional))];
  const codigoServico = codigosServico[0];
  const descricaoServico = itensServico.map((i) => i.descricao || i.nome).join('; ').slice(0, 2000);
  const valorServico = itensServico.reduce((s, i) => s + Number(i.valor_total), 0);

  const prest = {
    CNPJ: config.cnpj,
    ...(config.inscricaoMunicipal ? { IM: config.inscricaoMunicipal } : {}),
    xNome: config.nome,
    regTrib: {
      opSimpNac: config.opSimplesNacional,
      regEspTrib: config.regimeEspecial,
    },
  };

  let toma;
  if (cliente) {
    const doc = soDigitos(cliente.cpf);
    const ehCnpj = doc.length > 11;
    const tem_endereco = cliente.endereco_cep && cliente.endereco_logradouro && cliente.endereco_numero
      && cliente.endereco_bairro && cliente.endereco_municipio_ibge && cliente.endereco_uf;
    toma = {
      ...(doc ? (ehCnpj ? { CNPJ: doc } : { CPF: doc }) : {}),
      xNome: cliente.nome,
      ...(tem_endereco ? {
        end: {
          endNac: { cMun: cliente.endereco_municipio_ibge, CEP: soDigitos(cliente.endereco_cep) },
          xLgr: cliente.endereco_logradouro,
          nro: cliente.endereco_numero,
          ...(cliente.endereco_complemento ? { xCpl: cliente.endereco_complemento } : {}),
          xBairro: cliente.endereco_bairro,
        },
      } : {}),
      ...(cliente.telefone ? { fone: soDigitos(cliente.telefone) } : {}),
      ...(cliente.email ? { email: cliente.email } : {}),
    };
  }

  const infDPS = {
    '@_Id': idDps,
    tpAmb: config.ambiente === 'producao' ? '1' : '2',
    dhEmi: dataHoraComOffset(),
    verAplic: 'ContaFlow-1.0',
    serie: '1',
    nDPS: String(numeroDps),
    dCompet: dataServico,
    tpEmit: '1', // prestador
    cLocEmi: config.municipioIbge,
    prest,
    ...(toma ? { toma } : {}),
    serv: {
      locPrest: { cLocPrestacao: config.municipioIbge },
      cServ: {
        cTribNac: codigoServico,
        xDescServ: descricaoServico,
      },
    },
    valores: {
      vServPrest: { vServ: valorServico.toFixed(2) },
      trib: {
        tribMun: {
          tribISSQN: '1', // operacao tributavel
          tpRetISSQN: '1', // nao retido
        },
        totTrib: { indTotTrib: '0' },
      },
    },
  };

  const xmlObj = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    DPS: {
      '@_xmlns': 'http://www.sped.fazenda.gov.br/nfse',
      '@_versao': '1.01',
      infDPS,
    },
  };

  return { xml: builder.build(xmlObj), idDps };
}

/** Assina a DPS (enveloped signature sobre o elemento infDPS) com XMLDSIG. */
function assinarDps(xml, { cert, key }) {
  const sig = new SignedXml({
    privateKey: key,
    publicCert: cert,
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  });
  sig.addReference({
    xpath: "//*[local-name(.)='infDPS']",
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
  });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='infDPS']", action: 'after' } });
  return sig.getSignedXml();
}

function gzipBase64(xml) {
  return zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
}

// ------------------------------ Emissão ------------------------------

function atualizarNota(id, campos) {
  const db = getDb();
  const sets = Object.keys(campos).map((k) => `${k}=@${k}`).join(', ');
  db.prepare(`UPDATE notas_fiscais SET ${sets}, atualizado_em=datetime('now','localtime') WHERE id=@id`)
    .run({ ...campos, id });
}

/**
 * Valida que a venda tem o que a DPS precisa antes de tentar emitir.
 * Mesmo espírito de `validarItensFiscais` em fiscalService.js.
 */
function validarParaEmissao(itensServico) {
  if (!itensServico.length) {
    throw new AppError('Esta venda não tem itens de serviço para gerar NFS-e.');
  }
  const semCodigo = itensServico.filter((i) => !i.codigo_servico_nacional);
  if (semCodigo.length) {
    const nomes = semCodigo.map((i) => i.descricao || i.nome).join(', ');
    throw new AppError(
      `Os seguintes serviços estão sem "Código de serviço (LC 116)" cadastrado: ${nomes}. ` +
      'Preencha em Serviços > editar > "Dados fiscais" antes de emitir a NFS-e.'
    );
  }
  const codigos = new Set(itensServico.map((i) => i.codigo_servico_nacional));
  if (codigos.size > 1) {
    throw new AppError(
      'Esta venda tem itens de serviço com códigos de tributação diferentes — a NFS-e só aceita ' +
      'um código por nota. Emita em vendas separadas ou ajuste o código dos serviços.'
    );
  }
}

/** Emite a NFS-e dos itens de serviço de uma venda já concluída. */
async function emitirNFSe(vendaId) {
  const db = getDb();
  const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(vendaId);
  if (!venda) throw new AppError('Venda não encontrada.', 404);
  if (venda.status !== 'concluida') throw new AppError('Somente vendas concluídas podem ter NFS-e emitida.');

  const jaTem = db.prepare(
    "SELECT * FROM notas_fiscais WHERE venda_id = ? AND tipo = 'nfse' AND status IN ('processando','autorizada') ORDER BY id DESC LIMIT 1"
  ).get(vendaId);
  if (jaTem) throw new AppError('Esta venda já tem uma NFS-e emitida ou em processamento.');

  if (!estaConfigurado()) {
    throw new AppError('NFS-e não configurada. Envie o certificado digital e preencha os dados do prestador em Configurações → Módulo Fiscal → NFS-e.');
  }

  const itensServico = db.prepare(`
    SELECT vi.*, p.nome, p.codigo_servico_nacional
    FROM vendas_itens vi JOIN produtos p ON p.id = vi.produto_id
    WHERE vi.venda_id = ? AND p.eh_servico = 1
  `).all(vendaId);
  validarParaEmissao(itensServico);

  const cliente = venda.cliente_id ? db.prepare('SELECT * FROM clientes WHERE id = ?').get(venda.cliente_id) : null;
  const config = obterConfig();
  const { cert, key, pfxBuffer } = carregarCertificado();

  const referencia = `venda-${vendaId}-${Date.now()}`;
  const info = db.prepare(
    `INSERT INTO notas_fiscais (venda_id, tipo, ambiente, referencia, status)
     VALUES (?, 'nfse', ?, ?, 'processando')`
  ).run(vendaId, config.ambiente, referencia);
  const notaId = info.lastInsertRowid;

  try {
    const { xml, idDps } = montarDPS({ numeroDps: notaId, venda, itensServico, cliente, config });
    const xmlAssinado = assinarDps(xml, { cert, key });
    const resp = await requisicaoMTLS({
      host: HOSTS[config.ambiente].sefin,
      path: '/SefinNacional/nfse',
      method: 'POST',
      body: { xmlGZipB64: gzipBase64(xmlAssinado) },
      pfxBuffer,
      senha: config.certificadoSenha,
    });

    if (resp.status === 201 && resp.json && resp.json.chaveAcesso) {
      atualizarNota(notaId, {
        status: 'autorizada',
        chave_acesso: resp.json.chaveAcesso,
        id_dps: idDps,
        codigo_verificacao: resp.json.codigoVerificacao || null,
        danfe_url: `https://${HOSTS[config.ambiente].adn}/danfse/${resp.json.chaveAcesso}`,
      });
    } else {
      const erro = (resp.json && (resp.json.mensagem || JSON.stringify(resp.json))) || resp.texto || `HTTP ${resp.status}`;
      throw new Error(erro);
    }
  } catch (e) {
    atualizarNota(notaId, { status: 'erro', mensagem_erro: e.message });
    throw new AppError(`Falha ao emitir NFS-e: ${e.message}`);
  }

  return db.prepare('SELECT * FROM notas_fiscais WHERE id = ?').get(notaId);
}

/** Consulta o status atual de uma NFS-e pela chave de acesso (útil se ficou "processando"). */
async function consultarNFSe(notaId) {
  const db = getDb();
  const nota = db.prepare('SELECT * FROM notas_fiscais WHERE id = ?').get(notaId);
  if (!nota) throw new AppError('Nota fiscal não encontrada.', 404);
  if (!nota.chave_acesso) return nota;

  const resp = await chamarSefin(`/nfse/${nota.chave_acesso}`);
  if (resp.status === 200 && resp.json) {
    atualizarNota(notaId, { status: 'autorizada', codigo_verificacao: resp.json.codigoVerificacao || nota.codigo_verificacao });
  }
  return db.prepare('SELECT * FROM notas_fiscais WHERE id = ?').get(notaId);
}

/**
 * Cancela uma NFS-e (evento de cancelamento). Estrutura do XML do evento
 * NÃO foi detalhada aqui — o schema fica em evento_v1.01.xsd/
 * pedRegEvento_v1.01.xsd (docs/fiscal/nfse-nacional/xsd/1.01/), que ainda
 * não li com o mesmo detalhe da DPS. Implementar e validar contra Produção
 * Restrita antes de oferecer cancelamento pela UI.
 */
async function cancelarNFSe() {
  throw new AppError('Cancelamento de NFS-e ainda não implementado — ver comentário em nfseService.js.');
}

module.exports = {
  obterConfig, estaConfigurado, certificadoExiste, carregarCertificado, certificadoInfo,
  consultarAliquota, montarDPS, assinarDps, montarIdDps,
  emitirNFSe, consultarNFSe, cancelarNFSe,
};
