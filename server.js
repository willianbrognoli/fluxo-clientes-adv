'use strict';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------- Configuração ----------
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const APP_USER = process.env.APP_USER || 'admin';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const OAB_NUMERO = process.env.OAB_NUMERO || '65538';
const OAB_UF = (process.env.OAB_UF || 'PR').toUpperCase();
const SYNC_HORAS = Number(process.env.SYNC_HORAS || 6);
const API_DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

if (!APP_PASSWORD) {
  console.warn('[aviso] APP_PASSWORD não definida: defina a variável de ambiente para proteger o acesso.');
}

const ETAPAS_PADRAO = [
  'Cliente novo', 'Acompanhamento', 'Pedir honorários', 'Concluso com juiz',
  'Honorários fixados', 'Cobrança', 'Recebimento', 'Finalizado'
];

// ---------- Banco (arquivo JSON) ----------
const uid = () => crypto.randomBytes(8).toString('hex');
const agora = () => new Date().toISOString();

function dbInicial() {
  return {
    versao: 1,
    etapas: ETAPAS_PADRAO.map((nome) => ({ id: uid(), nome })),
    cartoes: [],
    encontrados: {},   // numero -> dados do processo vindo da OAB
    descartados: {},   // numero -> { numero, cliente, em }
    sync: { ultima: null, ultimaOk: null, erro: null, rodando: false }
  };
}

fs.mkdirSync(DATA_DIR, { recursive: true });
let db;
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch {
  db = dbInicial();
}
db.sync = { ...db.sync, rodando: false };

let salvando = Promise.resolve();
function salvar() {
  const conteudo = JSON.stringify(db);
  salvando = salvando.then(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, conteudo);
    fs.renameSync(tmp, DB_FILE);
  }).catch((e) => console.error('[db] erro ao salvar', e));
  return salvando;
}
salvar();

// ---------- Autenticação ----------
function assinar(valor) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(valor).digest('hex');
}
function criarToken(usuario) {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  const corpo = Buffer.from(JSON.stringify({ u: usuario, exp })).toString('base64url');
  return corpo + '.' + assinar(corpo);
}
function lerToken(token) {
  if (!token || !token.includes('.')) return null;
  const [corpo, sig] = token.split('.');
  const esperado = assinar(corpo);
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try {
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    return dados.exp > Date.now() ? dados : null;
  } catch { return null; }
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function igualSeguro(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const tentativas = new Map(); // ip -> { n, ate }

// ---------- App ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const t = tentativas.get(ip);
  if (t && t.n >= 8 && t.ate > Date.now()) {
    return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  const { usuario, senha } = req.body || {};
  const norm = (s) => String(s || '').trim().toLowerCase();
  const ok = APP_PASSWORD && igualSeguro(norm(usuario), norm(APP_USER)) && igualSeguro(senha || '', APP_PASSWORD);
  if (!ok) {
    const atual = t && t.ate > Date.now() ? t : { n: 0, ate: Date.now() + 15 * 60 * 1000 };
    atual.n++;
    tentativas.set(ip, atual);
    return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  }
  tentativas.delete(ip);
  const seguro = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `sessao=${criarToken(APP_USER)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${seguro ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'sessao=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  if (lerToken(cookies(req).sessao)) return next();
  res.status(401).json({ erro: 'Não autenticado' });
});

// ---------- Helpers ----------
const soDigitos = (s) => String(s || '').replace(/\D/g, '');
function mascaraCNJ(n) {
  const d = soDigitos(n);
  if (d.length !== 20) return n || '';
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;
}
const texto = (v, max = 500) => String(v ?? '').trim().slice(0, max);

function estado() {
  return {
    etapas: db.etapas,
    cartoes: db.cartoes,
    encontrados: Object.values(db.encontrados).sort((a, b) => (b.ultimaData || '').localeCompare(a.ultimaData || '')),
    descartados: Object.values(db.descartados).sort((a, b) => (b.em || '').localeCompare(a.em || '')),
    sync: db.sync,
    oab: { numero: OAB_NUMERO, uf: OAB_UF }
  };
}
const achaCartao = (id) => db.cartoes.find((c) => c.id === id);

function moverPara(cartao, etapaId) {
  if (cartao.etapaId === etapaId) return;
  cartao.etapaId = etapaId;
  cartao.etapaDesde = agora();
  cartao.historico = cartao.historico || [];
  const etapa = db.etapas.find((e) => e.id === etapaId);
  cartao.historico.push({ etapaId, nome: etapa ? etapa.nome : '', em: cartao.etapaDesde });
  if (cartao.historico.length > 100) cartao.historico.shift();
}

function novoCartao(dados) {
  const c = {
    id: uid(),
    cliente: texto(dados.cliente, 200) || 'Cliente sem nome',
    telefone: texto(dados.telefone, 40),
    numero: soDigitos(dados.numero).length === 20 ? soDigitos(dados.numero) : texto(dados.numero, 40),
    tribunal: texto(dados.tribunal, 40),
    orgao: texto(dados.orgao, 200),
    classe: texto(dados.classe, 200),
    partes: Array.isArray(dados.partes) ? dados.partes.slice(0, 20) : [],
    intimacoes: Array.isArray(dados.intimacoes) ? dados.intimacoes : [],
    honorarios: texto(dados.honorarios, 60),
    notas: texto(dados.notas, 5000),
    origem: dados.origem === 'oab' ? 'oab' : 'manual',
    novidade: false,
    criadoEm: agora(),
    etapaId: null,
    etapaDesde: null,
    historico: []
  };
  moverPara(c, dados.etapaId && db.etapas.some((e) => e.id === dados.etapaId) ? dados.etapaId : db.etapas[0].id);
  return c;
}

// ---------- Rotas: estado ----------
app.get('/api/estado', (req, res) => res.json(estado()));

// ---------- Rotas: etapas ----------
app.post('/api/etapas', (req, res) => {
  const nome = texto(req.body.nome, 60);
  if (!nome) return res.status(400).json({ erro: 'Informe o nome da etapa.' });
  db.etapas.push({ id: uid(), nome });
  salvar(); res.json(estado());
});
app.patch('/api/etapas/:id', (req, res) => {
  const e = db.etapas.find((x) => x.id === req.params.id);
  if (!e) return res.status(404).json({ erro: 'Etapa não encontrada.' });
  const nome = texto(req.body.nome, 60);
  if (!nome) return res.status(400).json({ erro: 'O nome não pode ficar vazio.' });
  e.nome = nome;
  salvar(); res.json(estado());
});
app.post('/api/etapas/ordem', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (ids.length !== db.etapas.length || !ids.every((id) => db.etapas.some((e) => e.id === id))) {
    return res.status(400).json({ erro: 'Ordem inválida.' });
  }
  db.etapas = ids.map((id) => db.etapas.find((e) => e.id === id));
  salvar(); res.json(estado());
});
app.delete('/api/etapas/:id', (req, res) => {
  if (db.etapas.length <= 1) return res.status(400).json({ erro: 'É preciso ter pelo menos uma etapa.' });
  const n = db.cartoes.filter((c) => c.etapaId === req.params.id).length;
  if (n) return res.status(400).json({ erro: `Essa etapa tem ${n} processo(s). Mova-os antes de excluir.` });
  db.etapas = db.etapas.filter((e) => e.id !== req.params.id);
  salvar(); res.json(estado());
});

// ---------- Rotas: cartões ----------
app.post('/api/cartoes', (req, res) => {
  const num = soDigitos(req.body.numero);
  if (num && db.cartoes.some((c) => soDigitos(c.numero) === num)) {
    return res.status(400).json({ erro: 'Esse processo já está no quadro.' });
  }
  const enc = num && db.encontrados[num];
  const c = novoCartao({ ...(enc || {}), ...req.body, origem: enc ? 'oab' : 'manual' });
  if (enc) delete db.encontrados[num];
  db.cartoes.push(c);
  salvar(); res.json(estado());
});
app.patch('/api/cartoes/:id', (req, res) => {
  const c = achaCartao(req.params.id);
  if (!c) return res.status(404).json({ erro: 'Processo não encontrado.' });
  const b = req.body || {};
  if ('cliente' in b) c.cliente = texto(b.cliente, 200) || 'Cliente sem nome';
  if ('telefone' in b) c.telefone = texto(b.telefone, 40);
  if ('numero' in b) c.numero = soDigitos(b.numero).length === 20 ? soDigitos(b.numero) : texto(b.numero, 40);
  if ('orgao' in b) c.orgao = texto(b.orgao, 200);
  if ('classe' in b) c.classe = texto(b.classe, 200);
  if ('honorarios' in b) c.honorarios = texto(b.honorarios, 60);
  if ('notas' in b) c.notas = texto(b.notas, 5000);
  if ('novidade' in b) c.novidade = !!b.novidade;
  if (b.etapaId && db.etapas.some((e) => e.id === b.etapaId)) moverPara(c, b.etapaId);
  salvar(); res.json(estado());
});
app.post('/api/cartoes/:id/avancar', (req, res) => {
  const c = achaCartao(req.params.id);
  if (!c) return res.status(404).json({ erro: 'Processo não encontrado.' });
  const i = db.etapas.findIndex((e) => e.id === c.etapaId);
  const dir = req.body && req.body.voltar ? -1 : 1;
  const alvo = db.etapas[Math.max(0, Math.min(db.etapas.length - 1, (i < 0 ? 0 : i) + dir))];
  moverPara(c, alvo.id);
  salvar(); res.json(estado());
});
app.delete('/api/cartoes/:id', (req, res) => {
  const c = achaCartao(req.params.id);
  if (!c) return res.status(404).json({ erro: 'Processo não encontrado.' });
  db.cartoes = db.cartoes.filter((x) => x.id !== c.id);
  const num = soDigitos(c.numero);
  if (c.origem === 'oab' && num) {
    db.descartados[num] = { numero: num, cliente: c.cliente, classe: c.classe, em: agora() };
  }
  salvar(); res.json(estado());
});

// ---------- Rotas: encontrados na OAB ----------
app.post('/api/encontrados/:numero/aceitar', (req, res) => {
  const num = soDigitos(req.params.numero);
  const enc = db.encontrados[num];
  if (!enc) return res.status(404).json({ erro: 'Processo não está mais na lista.' });
  if (!db.cartoes.some((c) => soDigitos(c.numero) === num)) {
    let cliente = texto(req.body.cliente || enc.sugestaoCliente, 200);
    if (cliente && cliente === cliente.toUpperCase() && /[A-Z]{3}/.test(cliente)) cliente = capitalizar(cliente);
    db.cartoes.push(novoCartao({ ...enc, cliente, origem: 'oab' }));
  }
  delete db.encontrados[num];
  salvar(); res.json(estado());
});
app.post('/api/encontrados/:numero/descartar', (req, res) => {
  const num = soDigitos(req.params.numero);
  const enc = db.encontrados[num];
  if (!enc) return res.status(404).json({ erro: 'Processo não está mais na lista.' });
  db.descartados[num] = { numero: num, cliente: enc.sugestaoCliente, classe: enc.classe, em: agora() };
  delete db.encontrados[num];
  salvar(); res.json(estado());
});
app.post('/api/descartados/:numero/restaurar', (req, res) => {
  const num = soDigitos(req.params.numero);
  if (!db.descartados[num]) return res.status(404).json({ erro: 'Não encontrado.' });
  delete db.descartados[num];
  if (db.processos && db.processos[num]) db.encontrados[num] = db.processos[num];
  salvar(); res.json(estado());
});

// ---------- Sincronização com o DJEN (CNJ) ----------
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function buscarPagina(pagina, inicio) {
  const url = new URL(API_DJEN);
  url.searchParams.set('numeroOab', OAB_NUMERO);
  url.searchParams.set('ufOab', OAB_UF);
  url.searchParams.set('itensPorPagina', '100');
  url.searchParams.set('pagina', String(pagina));
  if (inicio) url.searchParams.set('dataDisponibilizacaoInicio', inicio);
  for (let tentativa = 1; tentativa <= 4; tentativa++) {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'fluxo-clientes-adv/1.0' } });
    if (r.status === 429) { await espera(30000 * tentativa); continue; }
    if (!r.ok) throw new Error(`DJEN respondeu ${r.status}`);
    return r.json();
  }
  throw new Error('DJEN: limite de consultas atingido, tente mais tarde.');
}

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'com', 'ou', 'sem', 'a', 'o', 'por', 'para']);
function capitalizar(s) {
  return String(s).toLowerCase().split(/(\s+|[-/()])/).map((w, i) => {
    if (!w.trim() || /^[-/()]$/.test(w)) return w;
    if (i > 0 && MINUSCULAS.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join('');
}

function nomeAdvogado(item) {
  const a = (item.destinatarioadvogados || []).find((x) => x.advogado && String(x.advogado.numero_oab) === OAB_NUMERO);
  return a ? a.advogado.nome : '';
}

function integrar(itens) {
  db.processos = db.processos || {};
  for (const it of itens) {
    const num = soDigitos(it.numero_processo);
    if (num.length < 10) continue;
    const adv = (nomeAdvogado(it) || '').toUpperCase();
    const p = db.processos[num] || { numero: num, partes: [], intimacoes: [] };
    p.numero = num;
    p.tribunal = it.siglaTribunal || p.tribunal || '';
    p.orgao = it.nomeOrgao || p.orgao || '';
    p.classe = it.nomeClasse ? capitalizar(it.nomeClasse) : (p.classe || '');
    for (const d of it.destinatarios || []) {
      const nome = String(d.nome || '').trim();
      if (!nome || p.partes.some((x) => x.nome === nome)) continue;
      p.partes.push({ nome, polo: d.polo || '', advogada: nome.toUpperCase() === adv });
    }
    // "Parte assistida: NOME" / "Assistido(a): NOME" no texto da intimação = cliente
    const limpo = String(it.texto || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const ma = limpo.match(/(?:partes?\s*(?:\(s\))?\s+)?assistid[oa]s?\s*(?:\([oa]?s?\))?\s*[:\-–]\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'.\- ]{3,80}?)(?=\s*(?:[,;(]|\bCPF\b|\bCNPJ\b|\s-\s|$))/i);
    if (ma && !/^(por|pel[oa]|defesa|advogad)/i.test(ma[1])) p.assistida = ma[1].trim();
    if (!p.intimacoes.some((x) => x.id === it.id)) {
      p.intimacoes.push({
        id: it.id,
        data: it.data_disponibilizacao,
        tipo: it.tipoComunicacao || it.tipoDocumento || '',
        texto: String(it.texto || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600),
        link: it.link || ''
      });
      p.novaIntimacao = true;
    }
    p.intimacoes.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    p.intimacoes = p.intimacoes.slice(0, 40);
    p.ultimaData = p.intimacoes[0] ? p.intimacoes[0].data : '';
    const candidato = p.partes.find((x) => !x.advogada && !/^SIGILO$|MINIST[EÉ]RIO P[UÚ]BLICO|ESTADO D[OE] |MUNIC[IÍ]PIO D[EO] /i.test(x.nome));
    if (p.assistida && !p.partes.some((x) => x.nome.toUpperCase() === p.assistida.toUpperCase())) {
      p.partes.unshift({ nome: p.assistida, polo: 'S', advogada: false });
    }
    p.sugestaoCliente = p.assistida || (candidato ? candidato.nome : (p.partes.some((x) => x.nome === 'SIGILO') ? 'Processo em sigilo' : ''));
    db.processos[num] = p;
  }
  // distribuir: quadro, descartados ou encontrados
  for (const p of Object.values(db.processos)) {
    if (!p.novaIntimacao) continue;
    p.novaIntimacao = false;
    const c = db.cartoes.find((x) => soDigitos(x.numero) === p.numero);
    if (c) {
      const conhecidas = new Set((c.intimacoes || []).map((x) => x.id));
      if (p.intimacoes.some((x) => !conhecidas.has(x.id))) c.novidade = true;
      c.intimacoes = p.intimacoes;
      c.partes = p.partes;
      c.tribunal = c.tribunal || p.tribunal;
      c.orgao = c.orgao || p.orgao;
      c.classe = c.classe || p.classe;
      if (c.origem === 'manual') c.origem = 'oab';
    } else if (!db.descartados[p.numero]) {
      db.encontrados[p.numero] = p;
    }
  }
}

async function sincronizar() {
  if (db.sync.rodando || db.sync.servidorBloqueado || process.env.SYNC_SERVIDOR === '0') return;
  db.sync.rodando = true;
  try {
    let inicio = null;
    if (db.sync.ultimaOk) {
      const d = new Date(db.sync.ultimaOk);
      d.setDate(d.getDate() - 10);
      inicio = d.toISOString().slice(0, 10);
    }
    let pagina = 1, total = Infinity, lidos = 0;
    const itens = [];
    while (lidos < total && pagina <= 60) {
      const r = await buscarPagina(pagina, inicio);
      total = Number(r.count || 0);
      const lote = r.items || [];
      itens.push(...lote);
      lidos += lote.length;
      if (!lote.length) break;
      pagina++;
      await espera(1500);
    }
    integrar(itens);
    db.sync.ultimaOk = agora();
    db.sync.lidos = itens.length;
    console.log(`[sync] ${itens.length} intimações lidas`);
  } catch (e) {
    if (/ 403/.test(e.message)) {
      // IP do servidor bloqueado (fora do Brasil): a busca passa a ser feita só pelo navegador
      db.sync.servidorBloqueado = true;
      console.warn('[sync] DJEN bloqueou o IP do servidor (403). A busca fica a cargo do navegador.');
    } else {
      db.sync.erro = e.message;
    }
    console.error('[sync] erro', e.message);
  } finally {
    db.sync.ultima = agora();
    db.sync.rodando = false;
    salvar();
  }
}

app.post('/api/sincronizar', (req, res) => {
  if (!db.sync.rodando) sincronizar();
  res.json({ ok: true, rodando: true });
});

// Busca feita pelo navegador (IP brasileiro). O DJEN bloqueia IPs de fora do Brasil,
// então o servidor (ex.: VPS nos EUA) recebe aqui os itens que o navegador baixou.
app.get('/api/sync/inicio', (req, res) => {
  let inicio = null;
  if (db.sync.ultimaOk) {
    const d = new Date(db.sync.ultimaOk);
    d.setDate(d.getDate() - 10);
    inicio = d.toISOString().slice(0, 10);
  }
  res.json({ inicio, oab: { numero: OAB_NUMERO, uf: OAB_UF }, api: API_DJEN });
});
// Dados conhecidos de um processo (vindos da busca da OAB), usados para completar a leitura por foto
app.get('/api/processo/:numero', (req, res) => {
  const p = (db.processos || {})[soDigitos(req.params.numero)];
  res.json(p ? { numero: p.numero, tribunal: p.tribunal, orgao: p.orgao, classe: p.classe, partes: p.partes, sugestaoCliente: p.sugestaoCliente } : null);
});

app.post('/api/sync/lote', (req, res) => {
  const itens = Array.isArray(req.body.itens) ? req.body.itens.slice(0, 500) : [];
  integrar(itens.filter((x) => x && typeof x === 'object' && x.numero_processo));
  salvar();
  res.json({ ok: true, recebidos: itens.length });
});
app.post('/api/sync/fim', (req, res) => {
  const erro = req.body && req.body.erro ? texto(req.body.erro, 300) : null;
  db.sync.ultima = agora();
  if (erro) db.sync.erro = erro;
  else { db.sync.erro = null; db.sync.ultimaOk = agora(); db.sync.lidos = Number(req.body.lidos) || 0; }
  salvar();
  res.json(estado());
});

// ---------- Front-end ----------
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true, index: 'index.html' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`Fluxo de clientes rodando na porta ${PORT} (OAB ${OAB_NUMERO}/${OAB_UF})`);
  const precisa = !db.sync.ultimaOk || Date.now() - new Date(db.sync.ultimaOk).getTime() > SYNC_HORAS * 3600 * 1000;
  if (precisa) setTimeout(sincronizar, 3000);
  setInterval(sincronizar, SYNC_HORAS * 3600 * 1000);
});

module.exports = { mascaraCNJ };
