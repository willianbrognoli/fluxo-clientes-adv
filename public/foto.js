'use strict';
// Leitura de dados do processo por foto, sem IA: OCR clássico (Tesseract) rodando no próprio
// aparelho + regras fixas (expressões regulares) para achar nº CNJ, vara, classe e partes.
// A foto não sai do aparelho.
(() => {
  const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let carregando = null;
  let worker = null;

  function carregarScript() {
    if (window.Tesseract) return Promise.resolve();
    if (carregando) return carregando;
    carregando = new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = TESSERACT;
      s.onload = ok;
      s.onerror = () => { carregando = null; erro(new Error('Não foi possível carregar o leitor de texto. Verifique a internet.')); };
      document.head.appendChild(s);
    });
    return carregando;
  }

  // Reduz/aumenta a foto para ~2000px, deixa em tons de cinza e reforça o contraste
  async function preparar(arquivo) {
    const bmp = await createImageBitmap(arquivo);
    const maior = Math.max(bmp.width, bmp.height);
    const escala = maior > 2200 ? 2200 / maior : maior < 1300 ? 1300 / maior : 1;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * escala);
    c.height = Math.round(bmp.height * escala);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      y = Math.max(0, Math.min(255, (y - 128) * 1.35 + 128));
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  async function lerTexto(arquivo, progresso) {
    progresso('Carregando leitor de texto…');
    await carregarScript();
    if (!worker) {
      progresso('Preparando leitor (só na primeira vez)…');
      worker = await window.Tesseract.createWorker('por', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') progresso(`Lendo a foto… ${Math.round((m.progress || 0) * 100)}%`);
        }
      });
    }
    progresso('Ajustando a imagem…');
    const canvas = await preparar(arquivo);
    progresso('Lendo a foto…');
    const r = await worker.recognize(canvas, {}, { text: true, tsv: true });
    return { texto: r.data.text || '', tsv: r.data.tsv || '' };
  }

  // ---------- Leitura por colunas (formulários "RÓTULO:   valor" que quebram linha) ----------
  // Usa a posição de cada palavra na foto: acha a coluna dos rótulos e a dos valores,
  // junta o rótulo inteiro ("PARTE" + "ASSISTIDA:") e todas as linhas do valor até o próximo rótulo.
  const ehRuido = (t) => !/[\p{L}\d]/u.test(t);
  const mediana = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

  function porColunas(tsv) {
    const palavras = [];
    for (const linha of String(tsv || '').split('\n')) {
      const c = linha.split('\t');
      if (c[0] !== '5' || c.length < 12) continue;
      const texto = c.slice(11).join(' ').trim();
      if (!texto || ehRuido(texto)) continue;
      const x0 = +c[6], y0 = +c[7], w = +c[8], h = +c[9];
      palavras.push({ t: texto, x0, y0, x1: x0 + w, y1: y0 + h, yc: y0 + h / 2, conf: +c[10] });
    }
    if (palavras.length < 6) return null;
    const mesmaLinha = (a, b) => Math.abs(a.yc - b.yc) < Math.max(a.y1 - a.y0, b.y1 - b.y0) * 0.6;

    // rótulos = palavras terminadas em ":"; o valor começa na próxima palavra da mesma linha
    const rot = palavras.filter((p) => /[\p{L})]:$/u.test(p.t));
    const inicios = [];
    for (const r of rot) {
      const prox = palavras.filter((p) => p !== r && mesmaLinha(p, r) && p.x0 > r.x1).sort((a, b) => a.x0 - b.x0)[0];
      if (prox && prox.x0 - r.x1 < 400) inicios.push(prox.x0);
    }
    if (inicios.length < 2) return null;
    const xValor = mediana(inicios);
    const xRotulo = mediana(rot.filter((r) => r.x1 < xValor).map((r) => r.x0));
    const alturaLinha = mediana(palavras.map((p) => p.y1 - p.y0)) || 20;

    // coluna dos rótulos: começa perto de xRotulo e termina antes da coluna dos valores
    const esquerda = palavras.filter((p) => Math.abs(p.x0 - xRotulo) <= alturaLinha * 1.5 && p.x1 < xValor - 4)
      .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    // coluna dos valores: começa em xValor; numa mesma linha, para no primeiro "buraco" grande
    // (ex.: QR code ao lado) e ignora palavras de baixa confiança
    const direita = [];
    const candidatos = palavras.filter((p) => p.x0 >= xValor - alturaLinha * 0.8 && p.conf >= 15)
      .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    for (const p of candidatos) {
      const naLinha = direita.filter((q) => mesmaLinha(p, q));
      if (!naLinha.length) { if (p.x0 <= xValor + alturaLinha * 2) direita.push(p); continue; }
      const ultima = naLinha.reduce((a, b) => (b.x1 > a.x1 ? b : a));
      if (p.x0 - ultima.x1 <= alturaLinha * 2) direita.push(p);
    }

    // monta os rótulos (podem quebrar em 2+ linhas: "CONTATO" / "PARTE:")
    const rotulos = [];
    let atual = null;
    for (const p of esquerda) {
      if (atual && p.y0 - atual.ultimoY > alturaLinha * 2.5) atual = null;
      if (!atual) atual = { partes: [], y0: p.y0 };
      atual.partes.push(p.t);
      atual.ultimoY = p.y1;
      if (p.t.endsWith(':')) { rotulos.push({ nome: atual.partes.join(' '), y0: atual.y0 }); atual = null; }
    }
    if (rotulos.length < 2) return null;

    // valor de cada rótulo = palavras da coluna da direita entre ele e o próximo rótulo
    const folga = alturaLinha * 0.5;
    const linhas = rotulos.map((r, i) => {
      const fim = i + 1 < rotulos.length ? rotulos[i + 1].y0 - folga : Infinity;
      const ws = direita.filter((p) => p.yc >= r.y0 - folga && p.yc < fim);
      let valor = '';
      for (const p of ws) {
        valor += valor && !/-$/.test(valor) ? ' ' + p.t : p.t;
      }
      return `${r.nome} ${valor}`.trim();
    });
    return linhas.join('\n');
  }

  // Combina a leitura por colunas (mais confiável) com a leitura linha a linha (complemento)
  function analisar(texto, tsv) {
    const linear = extrair(texto);
    const col = porColunas(tsv);
    if (!col) return { campos: linear, reconstruido: '' };
    const c = extrair(col);
    for (const k of Object.keys(linear)) {
      if (Array.isArray(c[k])) { if (!c[k].length) c[k] = linear[k]; } else if (!c[k]) c[k] = linear[k];
    }
    return { campos: c, reconstruido: col };
  }

  // ---------- Regras de extração ----------
  const paraDigito = (s) => s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/[Ss]/g, '5').replace(/B/g, '8');
  const D = '[\\dOoIl|SB]';

  function acharCNJ(texto) {
    const re = new RegExp(`(${D}{7})\\s*[-–—~]\\s*(${D}{2})\\s*[.,]\\s*(${D}{4})\\s*[.,]\\s*(${D})\\s*[.,]\\s*(${D}{2})\\s*[.,]\\s*(${D}{4})`);
    const m = texto.match(re);
    if (m) return paraDigito(m.slice(1).join(''));
    const corrido = texto.replace(/[ \t]/g, '').match(/\b\d{20}\b/);
    return corrido ? corrido[0] : '';
  }

  const ROTULOS = [
    { campo: 'assistida', re: /^(partes?\s*\(?s?\)?\s+assistid[oa]s?\s*\(?s?\)?|assistid[oa]s?\s*\(?[oa]?s?\)?)(?=[\s:;\-–]|$)/i },
    { campo: 'classe', re: /^(classe(\s+(processual|judicial))?|tipo\s+de\s+a[çc][ãa]o)\b/i },
    { campo: 'assunto', re: /^assunto(s)?(\s+principal)?\b/i },
    { campo: 'orgao', re: /^(vara|ju[ií]zo|[óo]rg[ãa]o(\s+julgador)?|serventia|unidade(\s+judici[áa]ria)?|secretaria)\b/i },
    { campo: 'comarca', re: /^(comarca|foro)\b/i },
    { campo: 'ativo', re: /^(polo\s+ativo|autor(es|a|as)?|requerentes?|exequentes?|reclamantes?|impetrantes?|embargantes?|apelantes?|agravantes?|querelantes?|denunciantes?|v[ií]timas?)\b/i },
    { campo: 'passivo', re: /^(polo\s+passivo|r[ée]u|r[ée]s|requerid[oa]s?|executad[oa]s?|reclamad[oa]s?|impetrad[oa]s?|embargad[oa]s?|apelad[oa]s?|agravad[oa]s?|querelad[oa]s?|denunciad[oa]s?|acusad[oa]s?|investigad[oa]s?)\b/i },
    { campo: 'valor', re: /^valor(\s+da\s+causa)?\b/i },
    { campo: 'telefone', re: /^(contato(\s+(da\s+)?parte)?|telefone|celular|fone|whats\s*app)(?=[\s:;\-–]|$)/i }
  ];

  // telefone: corrige letras lidas no lugar de números e ignora o "(00)00000-0000" de exemplo
  function telefone(s) {
    const d = paraDigito(String(s || '').replace(/D/g, '0')).replace(/\D/g, '');
    if (d.length < 10 || d.length > 13 || /^0+$/.test(d) || /^0{2}/.test(d)) return '';
    const n = d.length > 11 ? d.slice(-11) : d;
    return n.length === 11 ? `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}` : `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  }

  // corta no fim da "coluna": 2+ espaços, tabulação ou o próximo rótulo (Prazo:, Data:, ...)
  const cortar = (s) => String(s || '').split(/\s{2,}|\t|\s(?=(?:prazo|data|evento|processo|classe|vara|autor|r[ée]u|advogad|situa[çc])\w*\s*:)/i)[0];
  const limpar = (s) => cortar(String(s || '').replace(/^[\s:;.\-–—|]+/, ''))
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;.\-–—|]+/, '')
    .replace(/\s*\(?\s*(cpf|cnpj|rg|oab)\b.*$/i, '')
    .replace(/[|_]+/g, '')
    .trim();
  const pareceRotulo = (l) => ROTULOS.some((r) => r.re.test(l)) || /^(advogad|procurador|n[úu]mero|processo|data|distribu|juiz|magistrad|situa[çc][ãa]o|prioridade|segredo|prazo|evento|movimenta)/i.test(l);

  function extrair(texto) {
    const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = { numero: acharCNJ(texto), classe: '', assunto: '', orgao: '', comarca: '', valor: '', telefone: '', assistida: [], ativo: [], passivo: [] };
    for (let i = 0; i < linhas.length; i++) {
      let l = linhas[i];
      // "Parte assistida" pode vir no meio da linha (tabelas do Projudi): começa a leitura dali
      const meio = l.search(/partes?\s*\(?s?\)?\s+assistid/i);
      if (meio > 0) l = l.slice(meio);
      for (const { campo, re } of ROTULOS) {
        const m = l.match(re);
        if (!m) continue;
        let valor = limpar(l.slice(m[0].length));
        if (!valor && linhas[i + 1] && !pareceRotulo(linhas[i + 1])) valor = limpar(linhas[i + 1]);
        if (!valor || valor.length < 3) break;
        if (campo === 'ativo' || campo === 'passivo' || campo === 'assistida') {
          valor.split(/\s+e\s+(?=[A-ZÀ-Ú])|;/).map(limpar).filter((v) => v.length >= 3).forEach((v) => {
            if (!out[campo].includes(v)) out[campo].push(v);
          });
        } else if (campo === 'telefone') {
          if (!out.telefone) out.telefone = telefone(valor);
        } else if (!out[campo]) {
          out[campo] = (campo === 'comarca' ? valor.replace(/^d[aeo]s?\s+/i, '') : valor).slice(0, 200);
        }
        break;
      }
    }
    if (!out.orgao) {
      const v = linhas.find((l) => /\b(\d+\s*[ªºa°]?\s*)?vara\b|juizado|tribunal do j[úu]ri|turma recursal/i.test(l));
      if (v) out.orgao = limpar(v).slice(0, 200);
    }
    if (out.orgao && out.comarca && !out.orgao.toLowerCase().includes(out.comarca.toLowerCase())) {
      out.orgao = `${out.orgao} - ${out.comarca}`;
    }
    if (!out.classe && out.assunto) out.classe = out.assunto;
    return out;
  }

  window.LeitorFoto = {
    async ler(arquivo, progresso = () => {}) {
      const { texto, tsv } = await lerTexto(arquivo, progresso);
      const { campos, reconstruido } = analisar(texto, tsv);
      return { texto: reconstruido ? `${reconstruido}\n\n--- texto bruto ---\n${texto}` : texto, campos };
    },
    extrair,
    porColunas,
    analisar
  };
})();
