'use strict';

/**
 * Gera graficos simples em SVG (sem dependencias externas, funciona offline).
 * Cada funcao devolve uma string SVG responsiva (viewBox) com tooltips nativos.
 */
window.Graficos = (function () {
  const CORES = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

  const moeda = (v) => UI.moeda(v);
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /** Grafico de barras verticais. dados: [{label, valor}] */
  function barras(dados, opts = {}) {
    if (!dados || !dados.length) return vazio();
    const w = 640, h = 260, padL = 48, padB = 46, padT = 16, padR = 12;
    const gw = w - padL - padR, gh = h - padT - padB;
    const max = Math.max(...dados.map((d) => Number(d.valor)), 1);
    const bw = gw / dados.length;
    const cor = opts.cor || CORES[0];

    const barrasSVG = dados.map((d, i) => {
      const bh = (Number(d.valor) / max) * gh;
      const x = padL + i * bw + bw * 0.15;
      const y = padT + gh - bh;
      const larg = bw * 0.7;
      const label = String(d.label).length > 8 ? String(d.label).slice(5) : d.label; // encurta datas
      return `
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${larg.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" rx="3" fill="${cor}">
          <title>${esc(d.label)}: ${opts.moeda ? moeda(d.valor) : d.valor}</title>
        </rect>
        <text x="${(x + larg / 2).toFixed(1)}" y="${h - padB + 16}" font-size="10" text-anchor="middle" fill="#64748b">${esc(label)}</text>`;
    }).join('');

    return svgWrap(w, h, `
      ${eixoY(max, padL, padT, gh, gw, opts.moeda)}
      ${barrasSVG}`);
  }

  /** Grafico de linha. dados: [{label, valor}] */
  function linha(dados, opts = {}) {
    if (!dados || !dados.length) return vazio();
    const w = 640, h = 260, padL = 48, padB = 46, padT = 16, padR = 12;
    const gw = w - padL - padR, gh = h - padT - padB;
    const max = Math.max(...dados.map((d) => Number(d.valor)), 1);
    const cor = opts.cor || CORES[0];
    const passo = dados.length > 1 ? gw / (dados.length - 1) : 0;
    const pts = dados.map((d, i) => {
      const x = padL + i * passo;
      const y = padT + gh - (Number(d.valor) / max) * gh;
      return { x, y, d };
    });
    const linhaPath = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
    const area = linhaPath + ` L${pts[pts.length - 1].x.toFixed(1)} ${padT + gh} L${pts[0].x.toFixed(1)} ${padT + gh} Z`;
    const pontos = pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${cor}"><title>${esc(p.d.label)}: ${opts.moeda ? moeda(p.d.valor) : p.d.valor}</title></circle>`).join('');
    const rotulos = pts.map((p, i) => (i % Math.ceil(pts.length / 8 || 1) === 0)
      ? `<text x="${p.x.toFixed(1)}" y="${h - padB + 16}" font-size="10" text-anchor="middle" fill="#64748b">${esc(String(p.d.label).slice(5))}</text>` : '').join('');

    return svgWrap(w, h, `
      ${eixoY(max, padL, padT, gh, gw, opts.moeda)}
      <path d="${area}" fill="${cor}22" />
      <path d="${linhaPath}" fill="none" stroke="${cor}" stroke-width="2.5" />
      ${pontos}${rotulos}`);
  }

  /** Barras horizontais (rankings). dados: [{label, valor}] */
  function barrasHorizontais(dados, opts = {}) {
    if (!dados || !dados.length) return vazio();
    const w = 640, padT = 8, padR = 60, padL = 160, alturaBarra = 26, gap = 8;
    const h = padT * 2 + dados.length * (alturaBarra + gap);
    const gw = w - padL - padR;
    const max = Math.max(...dados.map((d) => Number(d.valor)), 1);
    const linhas = dados.map((d, i) => {
      const y = padT + i * (alturaBarra + gap);
      const bw = (Number(d.valor) / max) * gw;
      const cor = CORES[i % CORES.length];
      return `
        <text x="${padL - 8}" y="${y + alturaBarra / 2 + 4}" font-size="12" text-anchor="end" fill="#334155">${esc(String(d.label).length > 22 ? String(d.label).slice(0, 21) + '…' : d.label)}</text>
        <rect x="${padL}" y="${y}" width="${Math.max(2, bw).toFixed(1)}" height="${alturaBarra}" rx="4" fill="${cor}"><title>${esc(d.label)}: ${opts.moeda ? moeda(d.valor) : d.valor}</title></rect>
        <text x="${(padL + bw + 6).toFixed(1)}" y="${y + alturaBarra / 2 + 4}" font-size="11" fill="#64748b">${opts.moeda ? moeda(d.valor) : d.valor}</text>`;
    }).join('');
    return svgWrap(w, h, linhas);
  }

  /** Duas barras comparativas (ex.: pagar x receber). */
  function comparativo(itens, opts = {}) {
    // itens: [{label, valor, cor}]
    return barrasHorizontais(itens.map((i) => ({ label: i.label, valor: i.valor })), opts);
  }

  // ------------------------- helpers -------------------------
  function eixoY(max, padL, padT, gh, gw, ehMoeda) {
    const linhas = [];
    const passos = 4;
    for (let i = 0; i <= passos; i++) {
      const v = (max / passos) * i;
      const y = padT + gh - (v / max) * gh;
      linhas.push(`<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + gw}" y2="${y.toFixed(1)}" stroke="#eef2f7" />
        <text x="${padL - 6}" y="${(y + 3).toFixed(1)}" font-size="9" text-anchor="end" fill="#94a3b8">${ehMoeda ? abreviar(v) : Math.round(v)}</text>`);
    }
    return linhas.join('');
  }
  function abreviar(v) {
    if (v >= 1000) return 'R$' + (v / 1000).toFixed(1) + 'k';
    return 'R$' + Math.round(v);
  }
  function svgWrap(w, h, inner) {
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;font-family:inherit" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
  }
  function vazio() { return '<div class="vazio">Sem dados no período.</div>'; }

  return { barras, linha, barrasHorizontais, comparativo, CORES };
})();
