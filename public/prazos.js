'use strict';
// Contagem de prazos processuais (ajuda de cálculo: SEMPRE conferir).
// Usado no navegador (window.Prazos) e no servidor (require).
//
// Regras aplicadas (CPC arts. 219, 220 e 224):
//  - Dias úteis: pula sábados, domingos, feriados nacionais, Carnaval (seg/ter),
//    Sexta-feira Santa, Corpus Christi, o recesso de 20/12 a 20/01 e os dias que
//    a advogada cadastrar (feriado municipal, suspensão do tribunal, etc.).
//  - Disponibilização no Diário (DJEN): considera publicado no 1º dia útil seguinte
//    e a contagem começa no dia útil seguinte à publicação.
//  - Intimação/ciência: a contagem começa no 1º dia útil seguinte.
//  - Dias corridos: conta todos os dias; se terminar em dia sem expediente, vai para o próximo dia útil.
(function (raiz) {
  const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const deISO = (s) => { const [a, m, d] = s.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); };
  const soma = (s, n) => { const d = deISO(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

  // Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)
  function pascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return iso(new Date(Date.UTC(ano, mes - 1, dia)));
  }

  const FIXOS = {
    '01-01': 'Confraternização Universal', '04-21': 'Tiradentes', '05-01': 'Dia do Trabalho',
    '09-07': 'Independência', '10-12': 'Nossa Senhora Aparecida', '11-02': 'Finados',
    '11-15': 'Proclamação da República', '11-20': 'Consciência Negra', '12-25': 'Natal'
  };
  const cacheMoveis = {};
  function moveis(ano) {
    if (cacheMoveis[ano]) return cacheMoveis[ano];
    const p = pascoa(ano);
    return (cacheMoveis[ano] = {
      [soma(p, -48)]: 'Carnaval', [soma(p, -47)]: 'Carnaval',
      [soma(p, -2)]: 'Sexta-feira Santa', [soma(p, 60)]: 'Corpus Christi'
    });
  }

  // Motivo de o dia NÃO ser útil (ou null se é útil). extras: { 'aaaa-mm-dd': 'descrição' }
  function motivo(dia, extras) {
    const sem = deISO(dia).getUTCDay();
    if (sem === 0) return 'domingo';
    if (sem === 6) return 'sábado';
    const md = dia.slice(5);
    if (md >= '12-20' || md <= '01-20') return 'recesso forense (20/12 a 20/01)';
    if (FIXOS[md]) return FIXOS[md];
    const mv = moveis(Number(dia.slice(0, 4)))[dia];
    if (mv) return mv;
    if (extras && extras[dia] !== undefined) return extras[dia] || 'dia sem expediente (cadastrado)';
    return null;
  }
  const util = (dia, extras) => !motivo(dia, extras);
  function proximoUtil(dia, extras) {
    let d = soma(dia, 1);
    for (let i = 0; i < 400 && !util(d, extras); i++) d = soma(d, 1);
    return d;
  }

  // ref: 'aaaa-mm-dd'; modo: 'djen' | 'ciencia'; dias: número; tipo: 'uteis' | 'corridos'
  // extras: lista [{data, nome}] ou objeto {data: nome}
  function calcular({ ref, modo = 'djen', dias, tipo = 'uteis', extras } = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ref || '')) return null;
    const n = Math.floor(Number(dias));
    if (!(n >= 1 && n <= 365)) return null;
    const ex = Array.isArray(extras) ? Object.fromEntries(extras.map((x) => [x.data, x.nome || ''])) : (extras || {});
    const publicacao = modo === 'djen' ? proximoUtil(ref, ex) : ref;
    const inicio = proximoUtil(publicacao, ex);
    let fim;
    if (tipo === 'corridos') {
      fim = soma(inicio, n - 1);
      if (!util(fim, ex)) fim = proximoUtil(fim, ex);
    } else {
      fim = inicio;
      for (let k = 1; k < n; k++) fim = proximoUtil(fim, ex);
    }
    // dias sem expediente (fora fim de semana) que foram pulados: ajuda a conferir
    const pulados = [];
    for (let d = soma(ref, 1); d <= fim && pulados.length < 40; d = soma(d, 1)) {
      const m = motivo(d, ex);
      if (m && m !== 'sábado' && m !== 'domingo') pulados.push({ data: d, motivo: m });
    }
    // agrupa o recesso numa linha só
    const rec = pulados.filter((p) => p.motivo.startsWith('recesso'));
    const resumo = pulados.filter((p) => !p.motivo.startsWith('recesso'));
    if (rec.length) resumo.push({ data: rec[0].data, ate: rec[rec.length - 1].data, motivo: 'recesso forense' });
    resumo.sort((a, b) => a.data.localeCompare(b.data));
    return { publicacao, inicio, fim, pulados: resumo };
  }

  const api = { calcular, motivo, proximoUtil, pascoa, soma };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Prazos = api;
})(typeof window !== 'undefined' ? window : globalThis);
