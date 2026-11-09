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
    const r = await worker.recognize(canvas);
    return r.data.text || '';
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
    { campo: 'classe', re: /^(classe(\s+(processual|judicial))?|tipo\s+de\s+a[çc][ãa]o)\b/i },
    { campo: 'assunto', re: /^assunto(s)?(\s+principal)?\b/i },
    { campo: 'orgao', re: /^(vara|ju[ií]zo|[óo]rg[ãa]o(\s+julgador)?|serventia|unidade(\s+judici[áa]ria)?|secretaria)\b/i },
    { campo: 'comarca', re: /^(comarca|foro)\b/i },
    { campo: 'ativo', re: /^(polo\s+ativo|autor(es|a|as)?|requerentes?|exequentes?|reclamantes?|impetrantes?|embargantes?|apelantes?|agravantes?|querelantes?|denunciantes?|v[ií]timas?)\b/i },
    { campo: 'passivo', re: /^(polo\s+passivo|r[ée]u|r[ée]s|requerid[oa]s?|executad[oa]s?|reclamad[oa]s?|impetrad[oa]s?|embargad[oa]s?|apelad[oa]s?|agravad[oa]s?|querelad[oa]s?|denunciad[oa]s?|acusad[oa]s?|investigad[oa]s?)\b/i },
    { campo: 'valor', re: /^valor(\s+da\s+causa)?\b/i }
  ];

  const limpar = (s) => String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;.\-–—|]+/, '')
    .replace(/\s*\(?\s*(cpf|cnpj|rg|oab)\b.*$/i, '')
    .replace(/[|_]+/g, '')
    .trim();
  const pareceRotulo = (l) => ROTULOS.some((r) => r.re.test(l)) || /^(advogad|procurador|n[úu]mero|processo|data|distribu|juiz|magistrad|situa[çc][ãa]o|prioridade|segredo)/i.test(l);

  function extrair(texto) {
    const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = { numero: acharCNJ(texto), classe: '', assunto: '', orgao: '', comarca: '', valor: '', ativo: [], passivo: [] };
    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      for (const { campo, re } of ROTULOS) {
        const m = l.match(re);
        if (!m) continue;
        let valor = limpar(l.slice(m[0].length));
        if (!valor && linhas[i + 1] && !pareceRotulo(linhas[i + 1])) valor = limpar(linhas[i + 1]);
        if (!valor || valor.length < 3) break;
        if (campo === 'ativo' || campo === 'passivo') {
          valor.split(/\s+e\s+(?=[A-ZÀ-Ú])|;/).map(limpar).filter((v) => v.length >= 3).forEach((v) => {
            if (!out[campo].includes(v)) out[campo].push(v);
          });
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
      const texto = await lerTexto(arquivo, progresso);
      return { texto, campos: extrair(texto) };
    },
    extrair
  };
})();
