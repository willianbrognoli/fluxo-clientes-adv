'use strict';
// Leitura de audiências no texto das intimações (sem IA: regras fixas).
// 1) Data real: "audiência ... para o dia 17/08/2026, às 13:00" / "20 de julho de 2026, 15h25"
//    ou "designo o dia 17/08/2026, às 13h, para audiência ...".
// 2) Só aviso do Projudi: "(seq. 12) AUDIÊNCIA ... DESIGNADA (22/10/2026)". A data entre parênteses
//    é a do ato do cartório, NÃO a da audiência: marca "audiência marcada, falta a data".

const MESES = {
  janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12
};

const pad = (n) => String(n).padStart(2, '0');

function montarData(d, m, a) {
  const dia = Number(d);
  const mes = /^\d+$/.test(String(m)) ? Number(m) : MESES[String(m).toLowerCase()];
  let ano = Number(a);
  if (ano < 100) ano += 2000;
  if (!mes || dia < 1 || dia > 31 || mes > 12 || ano < 2010 || ano > 2045) return null;
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  if (dt.getUTCMonth() !== mes - 1) return null;
  return `${ano}-${pad(mes)}-${pad(dia)}`;
}

function montarHora(h, m) {
  if (h == null || h === '') return '';
  const hh = Number(h), mm = Number(m || 0);
  if (hh < 6 || hh > 22 || mm > 59) return '';
  return `${pad(hh)}:${pad(mm)}`;
}

const DATA = String.raw`(\d{1,2})\s*(?:\/|de)\s*(\d{1,2}|janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*(?:\/|de)\s*(\d{4})`;
const HORA = String.raw`(?:[^.\d]{0,30}?(\d{1,2})\s*(?:h|:|horas)\s*(\d{2})?)?`;

const RE_DEPOIS = new RegExp(String.raw`audi[êe]ncia([^.]{0,200}?)(?:para\s+o\s+dia|no\s+dia|para\s+o\s+dia\s+de|na\s+data\s+de|data\s+de|dia|em)\s+` + DATA + HORA, 'gi');
const RE_ANTES = new RegExp(String.raw`(?:designo|redesigno|designad[ao]|redesignad[ao]|fica\s+designad[ao])\s+(?:para\s+)?(?:o\s+)?(?:dia\s+)?` + DATA + HORA + String.raw`[^.]{0,120}?audi[êe]ncia\s*(de\s+[a-zà-ú ]{3,50}?)?(?=[\s,.;]|$)`, 'gi');
const RE_MOVIMENTO = /\(seq\.\s*\d+\)\s*(AUDI[ÊE]NCIA[^()]*?)\s+(DESIGNADA|REDESIGNADA|CANCELADA|REALIZADA|N[ÃA]O[- ]REALIZADA)\s*\((\d{2}\/\d{2}\/\d{4})\)/i;

function tipoDe(trecho) {
  const m = String(trecho || '').match(/^\s*(de\s+[a-zà-ú\s]{3,60}?|una|preliminar|concentrada|admonit[óo]ria|de\s+cust[óo]dia)(?=\s+(?:para|no|na|em|dia|designad|redesignad|marcad)|[,;]|$)/i);
  if (!m) return 'Audiência';
  const t = m[1].replace(/\s+/g, ' ').trim().toLowerCase()
    .replace(/\s+(designo|redesigno|o\s+pr[óo]ximo|que|a\s+ser|a\s+realizar).*$/, '');
  return 'Audiência ' + t;
}

function capTipo(s) {
  return (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).replace(/\b(cpc|cpp|clt|eca)\b/g, (x) => x.toUpperCase());
}

// Retorna { datas: [{data, hora, tipo}], movimento: {situacao, tipo} | null }
function lerAudiencias(texto) {
  const t = String(texto || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const datas = [];
  const add = (data, hora, tipo) => {
    if (!data) return;
    if (!datas.some((x) => x.data === data && x.hora === hora)) datas.push({ data, hora, tipo });
  };
  let m;
  RE_DEPOIS.lastIndex = 0;
  while ((m = RE_DEPOIS.exec(t))) add(montarData(m[2], m[3], m[4]), montarHora(m[5], m[6]), tipoDe(m[1]));
  RE_ANTES.lastIndex = 0;
  while ((m = RE_ANTES.exec(t))) add(montarData(m[1], m[2], m[3]), montarHora(m[4], m[5]), m[6] ? 'Audiência ' + m[6].trim().toLowerCase() : 'Audiência');
  const mv = t.match(RE_MOVIMENTO);
  const movimento = mv ? { tipo: capTipo(mv[1].trim()), situacao: mv[2].toUpperCase().replace(/\s+/g, '-') } : null;
  return { datas, movimento };
}

// ---------- Arquivo de agenda (.ics) para assinar no Google Agenda / celular ----------
const escIcs = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
// linhas do .ics: no máximo 75 bytes (UTF-8); continua na linha seguinte começando com espaço
function dobrar(linha) {
  const out = [];
  let atual = '', bytes = 0;
  for (const ch of linha) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > 73) { out.push(atual); atual = ' '; bytes = 1; }
    atual += ch; bytes += b;
  }
  out.push(atual);
  return out.join('\r\n');
}
const carimbo = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Horário de Brasília (UTC-3, sem horário de verão desde 2019) -> UTC
function inicioUTC(data, hora) {
  const [a, m, d] = data.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  return new Date(Date.UTC(a, m - 1, d, h + 3, mi));
}

function gerarICS(eventos, nome) {
  const agora = carimbo(new Date());
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fluxo-clientes-adv//agenda//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escIcs(nome)}`, 'X-WR-TIMEZONE:America/Sao_Paulo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'
  ];
  for (const e of eventos) {
    L.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${agora}`);
    if (e.hora) {
      const ini = inicioUTC(e.data, e.hora);
      L.push(`DTSTART:${carimbo(ini)}`, `DTEND:${carimbo(new Date(ini.getTime() + 3600000))}`);
    } else {
      const fim = new Date(Date.UTC(...e.data.split('-').map((n, i) => (i === 1 ? n - 1 : +n))) + 86400000);
      L.push(`DTSTART;VALUE=DATE:${e.data.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${fim.toISOString().slice(0, 10).replace(/-/g, '')}`);
    }
    L.push(`SUMMARY:${escIcs(e.titulo)}`);
    if (e.local) L.push(`LOCATION:${escIcs(e.local)}`);
    L.push(`DESCRIPTION:${escIcs(e.descricao)}`);
    // avisos: 1 dia antes e 2 horas antes (sem hora: às 9h do dia anterior)
    const avisos = e.avisos || (e.hora ? ['-P1D', '-PT2H'] : ['-PT15H']);
    for (const tr of avisos) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escIcs(e.titulo)}`, `TRIGGER:${tr}`, 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(dobrar).join('\r\n') + '\r\n';
}

module.exports = { lerAudiencias, montarData, montarHora, gerarICS };
