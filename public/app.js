'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dig = (s) => String(s || '').replace(/\D/g, '');
  const cnj = (n) => {
    const d = dig(n);
    if (d.length !== 20) return n || '';
    return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;
  };
  const dataBR = (iso) => {
    if (!iso) return '';
    const [a, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
  };
  const diasDesde = (iso) => {
    if (!iso) return '';
    const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (dias <= 0) return 'hoje nesta etapa';
    if (dias === 1) return 'há 1 dia nesta etapa';
    return `há ${dias} dias nesta etapa`;
  };
  const relativo = (iso) => {
    if (!iso) return 'nunca';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'agora há pouco';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };
  const POLO = { A: 'polo ativo', P: 'polo passivo', T: 'terceiro', S: 'parte assistida' };

  // ---------- WhatsApp ----------
  // Número no formato internacional (55 + DDD + número). Aceita "(41) 99999-9999", "041...", "+55 ...".
  function foneWA(tel) {
    let d = dig(tel).replace(/^0+/, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    return d.length >= 12 && d.length <= 13 ? d : '';
  }
  const primeiroNome = (n) => {
    const p = String(n || '').trim().split(/\s+/)[0] || '';
    return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
  };
  const linkWA = (fone, texto) => `https://wa.me/${fone}${texto ? '?text=' + encodeURIComponent(texto) : ''}`;
  // Mensagens prontas: a advogada ainda pode editar no WhatsApp antes de enviar.
  function mensagensWA(c) {
    const nome = primeiroNome(c.cliente === 'Cliente sem nome' ? '' : c.cliente);
    const oi = `Olá${nome ? ', ' + nome : ''}! Tudo bem?`;
    const proc = c.numero ? ` nº ${cnj(c.numero)}` : '';
    const out = [{ rot: 'Atualização do processo', txt: `${oi} Passando para atualizar você sobre o seu processo${proc}: ` }];
    const a = proximaAud(c);
    if (a) {
      out.push({ rot: 'Lembrete de audiência', txt: `${oi} Lembrando que a ${a.tipo ? a.tipo.toLowerCase() : 'audiência'} do seu processo${proc} está marcada para ${dataBR(a.data)}${a.hora ? ' às ' + a.hora : ''}${c.orgao ? ', em ' + c.orgao : ''}. Qualquer dúvida, estou à disposição.` });
    }
    out.push({ rot: 'Honorários', txt: `${oi} Sobre os honorários do seu processo${proc}${c.honorarios ? ' (' + c.honorarios + ')' : ''}: ` });
    out.push({ rot: 'Pedir documentos', txt: `${oi} Para dar andamento ao seu processo${proc}, preciso que você me envie: ` });
    out.push({ rot: 'Só abrir a conversa', txt: '' });
    return out;
  }

  const ICON = {
    check: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    voltar: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M15 18 9 12l6-6"/></svg>',
    cima: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>',
    baixo: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
    lixo: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    camera: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    whats: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4.5 19.5 5.6 16A8 8 0 1 1 8.4 18.6z"/><path d="M9.2 8.6c.2-.4.6-.5.9-.4l.8 1.6-.6.8c.5 1.1 1.3 1.9 2.4 2.4l.8-.6 1.6.8c.1.3 0 .7-.4.9-.6.4-1.4.5-2.1.2-1.9-.8-3.3-2.2-4-4-.3-.7-.1-1.3.6-1.7z"/></svg>',
    feito: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/></svg>'
  };

  let S = null;              // estado vindo do servidor
  let vista = 'quadro';
  let etapaAtiva = null;     // etapa visível no celular
  let busca = '';
  const escolhaCliente = {}; // numero -> nome escolhido na caixa de encontrados
  let pollSync = null;

  // ---------- API ----------
  async function api(metodo, url, corpo) {
    const r = await fetch(url, {
      method: metodo,
      headers: corpo ? { 'Content-Type': 'application/json' } : {},
      body: corpo ? JSON.stringify(corpo) : undefined,
      credentials: 'same-origin'
    });
    if (r.status === 401 && url !== '/api/login') { mostrarLogin(); throw new Error('Sessão expirada'); }
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(dados.erro || 'Algo deu errado. Tente de novo.');
    return dados;
  }
  async function acao(metodo, url, corpo) {
    try {
      const novo = await api(metodo, url, corpo);
      if (novo && novo.etapas) { S = novo; render(); }
      return novo;
    } catch (e) {
      toast(e.message);
      throw e;
    }
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, desfazer) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${desfazer ? '<button type="button">Desfazer</button>' : ''}`;
    t.hidden = false;
    if (desfazer) $('button', t).onclick = () => { t.hidden = true; desfazer(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, desfazer ? 5000 : 3200);
  }

  // ---------- Login ----------
  function mostrarLogin() {
    $('#tela-app').hidden = true;
    $('#tela-login').hidden = false;
    setTimeout(() => $('#form-login [name=usuario]').focus(), 50);
  }
  $('#form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const btn = $('button[type=submit]', ev.target);
    btn.disabled = true;
    $('#login-erro').textContent = '';
    try {
      await api('POST', '/api/login', { usuario: f.get('usuario'), senha: f.get('senha') });
      ev.target.reset();
      await iniciar();
    } catch (e) {
      $('#login-erro').textContent = e.message;
    } finally { btn.disabled = false; }
  });

  async function iniciar() {
    try {
      S = await api('GET', '/api/estado');
    } catch { return; }
    $('#tela-login').hidden = true;
    $('#tela-app').hidden = false;
    $('#oab-rotulo').textContent = `OAB ${S.oab.numero}/${S.oab.uf}`;
    if (!etapaAtiva || !S.etapas.some((e) => e.id === etapaAtiva)) etapaAtiva = S.etapas[0] && S.etapas[0].id;
    render();
    if (syncVencida()) sincronizar(true);
  }

  // ---------- Navegação ----------
  function irPara(v) {
    vista = v;
    $$('.aba').forEach((b) => { if (b.dataset.vista === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $$('.vista').forEach((s) => { s.hidden = s.id !== 'vista-' + v; });
    $('.fab').hidden = v !== 'quadro';
    window.scrollTo({ top: 0 });
    render();
  }
  $$('.aba').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.vista)));

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-acao]');
    if (!el) return;
    const a = el.dataset.acao;
    if (a === 'novo') abrirNovo();
    if (a === 'exportar') abrirExportar();
    if (a === 'sync') sincronizar();
    if (a === 'sair') api('POST', '/api/logout').finally(mostrarLogin);
  });
  $('#btn-sync').addEventListener('click', sincronizar);

  // ---------- Sincronização ----------
  // A busca roda no navegador: o DJEN (CNJ) só aceita IPs do Brasil e o servidor pode estar fora.
  let syncLocal = false;
  const enxuto = (it) => ({
    id: it.id,
    data_disponibilizacao: it.data_disponibilizacao,
    siglaTribunal: it.siglaTribunal,
    tipoComunicacao: it.tipoComunicacao,
    tipoDocumento: it.tipoDocumento,
    nomeOrgao: it.nomeOrgao,
    nomeClasse: it.nomeClasse,
    numero_processo: it.numero_processo,
    link: it.link,
    texto: String(it.texto || '').slice(0, 4000),
    destinatarios: (it.destinatarios || []).map((d) => ({ nome: d.nome, polo: d.polo })),
    destinatarioadvogados: (it.destinatarioadvogados || []).map((a) => ({ advogado: a.advogado && { nome: a.advogado.nome, numero_oab: a.advogado.numero_oab } }))
  });
  async function sincronizar(silencioso) {
    if (syncLocal) return;
    syncLocal = true;
    render();
    if (silencioso !== true) toast('Buscando todas as intimações da OAB… pode levar até 1 minuto.');
    const antes = S.encontrados.length;
    let lidos = 0;
    try {
      const cfg = await api('GET', '/api/sync/inicio');
      let pagina = 1, total = Infinity;
      while (lidos < total && pagina <= 60) {
        const url = new URL(cfg.api);
        url.searchParams.set('numeroOab', cfg.oab.numero);
        url.searchParams.set('ufOab', cfg.oab.uf);
        url.searchParams.set('itensPorPagina', '100');
        url.searchParams.set('pagina', String(pagina));
        // manual = histórico completo; automática = só os últimos dias
        if (cfg.inicio && silencioso === true) url.searchParams.set('dataDisponibilizacaoInicio', cfg.inicio);
        let r;
        for (let t = 1; t <= 3; t++) {
          r = await fetch(url, { headers: { Accept: 'application/json' } });
          if (r.status !== 429) break;
          await new Promise((ok) => setTimeout(ok, 20000 * t));
        }
        if (!r.ok) throw new Error(`Diário de Justiça respondeu ${r.status}`);
        const j = await r.json();
        total = Number(j.count || 0);
        const lote = j.items || [];
        if (!lote.length) break;
        await api('POST', '/api/sync/lote', { itens: lote.map(enxuto) });
        lidos += lote.length;
        pagina++;
        await new Promise((ok) => setTimeout(ok, 1200));
      }
      S = await api('POST', '/api/sync/fim', { lidos });
      const pend = S.encontrados.length;
      if (silencioso !== true || pend > antes) toast(pend ? `Busca concluída: ${pend} processo(s) aguardando em Encontrados` : 'Busca concluída. Nada novo.');
    } catch (e) {
      const msg = e instanceof TypeError ? 'sem conexão com o Diário de Justiça' : e.message;
      try { S = await api('POST', '/api/sync/fim', { erro: msg }); } catch {}
      toast('Não foi possível buscar agora: ' + msg);
    } finally {
      syncLocal = false;
      render();
    }
  }
  function syncVencida() {
    const ult = S.sync.ultimaOk ? new Date(S.sync.ultimaOk).getTime() : 0;
    return Date.now() - ult > 6 * 3600 * 1000;
  }
  function vigiarSync() {
    clearInterval(pollSync);
    pollSync = setInterval(async () => {
      try {
        const antes = S.encontrados.length;
        S = await api('GET', '/api/estado');
        if (!S.sync.rodando) {
          clearInterval(pollSync);
          const novos = S.encontrados.length - antes;
          if (S.sync.erro) toast('Não foi possível buscar agora: ' + S.sync.erro);
          else toast(novos > 0 ? `${novos} processo(s) novo(s) em Encontrados` : 'Busca concluída. Nada novo.');
        }
        render();
      } catch { clearInterval(pollSync); }
    }, 4000);
  }

  // ---------- Render ----------
  function render() {
    if (!S) return;
    const n = S.encontrados.length;
    const cont = $('#cont-encontrados');
    cont.hidden = !n;
    cont.textContent = n > 99 ? '99+' : n;
    $('#btn-sync').classList.toggle('girando', syncLocal);
    $('#btn-sync').disabled = syncLocal;
    const info = syncLocal ? 'Buscando agora…'
      : `Última busca ${relativo(S.sync.ultimaOk)}. Busca sozinho ao abrir o app (a cada 6 horas).` + (S.sync.erro ? ` Último erro: ${S.sync.erro}` : '');
    $('#info-sync').textContent = `Processos da OAB ${S.oab.numero}/${S.oab.uf} no Diário de Justiça Eletrônico. ${info}`;
    $('#info-sync-2').textContent = info;
    if (vista === 'quadro') renderQuadro();
    if (vista === 'encontrados') renderEncontrados();
    if (vista === 'etapas') renderEtapas();
    if (vista === 'mais') renderMais();
    if (vista === 'agenda') renderAgenda();
    const pend = S.cartoes.filter((c) => c.audPendente).length + prazosAbertos().filter((x) => diasAte(x.p.fim) <= 3).length;
    const ca = $('#cont-agenda');
    ca.hidden = !pend;
    ca.textContent = pend;
  }

  // ---------- Audiências ----------
  const hojeISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const somaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const diaLongo = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  const diaCurto = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  const proximaAud = (c) => (c.audiencias || []).filter((a) => a.data >= hojeISO())[0];

  // ---------- Prazos ----------
  const diasAte = (iso) => Math.round((new Date(iso + 'T12:00:00') - new Date(hojeISO() + 'T12:00:00')) / 86400000);
  function quandoPrazo(fim) {
    const n = diasAte(fim);
    if (n < 0) return { txt: `VENCIDO ${dataBR(fim).slice(0, 5)}`, cls: 'urgente' };
    if (n === 0) return { txt: 'vence HOJE', cls: 'urgente' };
    if (n === 1) return { txt: 'vence amanhã', cls: 'urgente' };
    return { txt: `${dataBR(fim).slice(0, 5)} · faltam ${n} dias`, cls: n <= 5 ? 'perto' : '' };
  }
  const prazosAbertos = () => {
    const out = [];
    for (const c of S.cartoes) for (const p of c.prazos || []) if (!p.feito) out.push({ c, p });
    return out.sort((a, b) => a.p.fim.localeCompare(b.p.fim));
  };
  const descrPrazo = (p) => `${p.dias} dias ${p.tipo === 'corridos' ? 'corridos' : 'úteis'} · ${p.modo === 'djen' ? 'disponibilizado no Diário em' : 'intimação/ciência em'} ${dataBR(p.ref)}`;

  function selosAudiencia(c) {
    const p = proximaAud(c);
    const out = [];
    const pz = (c.prazos || []).filter((x) => !x.feito)[0];
    if (pz) {
      const q = quandoPrazo(pz.fim);
      out.push(`<span class="selo prazo ${q.cls}">Prazo ${esc(pz.descricao)}: ${q.txt}</span>`);
    }
    if (p) {
      const quando = p.data === hojeISO() ? 'HOJE' : p.data === somaDias(hojeISO(), 1) ? 'amanhã' : dataBR(p.data).slice(0, 5);
      out.push(`<span class="selo aud">Audiência ${quando}${p.hora ? ' às ' + p.hora : ''}</span>`);
    }
    if (c.audPendente) out.push('<span class="selo">Audiência marcada: falta a data</span>');
    return out.length ? `<span class="cartao-selos">${out.join('')}</span>` : '';
  }

  // Data sempre dd/mm/aaaa e hora hh:mm (24h), independente do idioma do aparelho
  const campoData = (attrs) => `<input ${attrs} type="text" inputmode="numeric" placeholder="dd/mm/aaaa" maxlength="10" data-mask="data" autocomplete="off">`;
  const campoHora = (attrs) => `<input ${attrs} type="text" inputmode="numeric" placeholder="hh:mm" maxlength="5" data-mask="hora" autocomplete="off">`;
  function brParaISO(s) {
    const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return '';
    const [d, mo, a] = [+m[1], +m[2], +m[3]];
    const dt = new Date(a, mo - 1, d);
    if (a < 2000 || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
    return `${a}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const horaValida = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || '').trim());
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (!el.dataset || !el.dataset.mask) return;
    const d = el.value.replace(/\D/g, '');
    if (el.dataset.mask === 'data') {
      const x = d.slice(0, 8);
      el.value = x.length > 4 ? `${x.slice(0, 2)}/${x.slice(2, 4)}/${x.slice(4)}` : x.length > 2 ? `${x.slice(0, 2)}/${x.slice(2)}` : x;
    } else {
      const x = d.slice(0, 4);
      el.value = x.length > 2 ? `${x.slice(0, 2)}:${x.slice(2)}` : x;
    }
  });

  function formAudHTML(prefixo) {
    return `<div class="linha-aud">
      <label>Data${campoData(`id="${prefixo}-data"`)}</label>
      <label>Hora${campoHora(`id="${prefixo}-hora"`)}</label>
      <label class="largo">Tipo (opcional)<input id="${prefixo}-tipo" placeholder="Ex.: instrução e julgamento" autocomplete="off"></label>
    </div>`;
  }
  async function salvarAud(id, prefixo) {
    const data = brParaISO($(`#${prefixo}-data`).value);
    if (!data) { toast('Digite a data no formato dd/mm/aaaa'); $(`#${prefixo}-data`).focus(); return false; }
    const hora = $(`#${prefixo}-hora`).value.trim();
    if (hora && !horaValida(hora)) { toast('Digite a hora no formato hh:mm (ex.: 14:30)'); $(`#${prefixo}-hora`).focus(); return false; }
    const t = $(`#${prefixo}-tipo`).value.trim();
    await acao('POST', `/api/cartoes/${id}/audiencias`, { data, hora, tipo: t ? (/^audi/i.test(t) ? t : 'Audiência de ' + t.replace(/^de\s+/i, '')) : 'Audiência' });
    toast(`Audiência salva: ${dataBR(data)}${hora ? ' às ' + hora : ''}`);
    return true;
  }

  // seção "Audiências" dentro do editar processo
  function renderAudSecao(id) {
    const c = S.cartoes.find((x) => x.id === id);
    const box = $('#aud-secao');
    if (!c || !box) return;
    const hoje = hojeISO();
    box.innerHTML = `
      ${c.audPendente ? `<div class="pendente"><span><strong>Audiência marcada, falta a data.</strong> ${esc(c.audPendente.tipo)} (aviso de ${dataBR(c.audPendente.em)}). Confira no Projudi e coloque a data abaixo.</span>
        <button type="button" class="btn fantasma" data-dispensar>Não precisa</button></div>` : ''}
      <div class="aud-lista">${(c.audiencias || []).slice().reverse().slice(0, 8).map((a) => `
        <div class="aud-linha ${a.data < hoje ? 'passada' : ''}">
          <div><strong>${diaCurto(a.data)}${a.hora ? ' · ' + a.hora : ''}</strong><br><small>${esc(a.tipo || 'Audiência')} · ${a.origem === 'djen' ? 'lida do Diário' : 'informada por você'}</small></div>
          <button type="button" class="btn icone" data-aud-del="${esc(a.id)}" aria-label="Apagar audiência de ${dataBR(a.data)}">${ICON.lixo}</button>
        </div>`).join('') || '<p class="sutil">Nenhuma audiência cadastrada.</p>'}</div>
      ${formAudHTML('aud-novo')}
      <button type="button" class="btn" data-aud-add>Adicionar audiência</button>`;
    $('[data-aud-add]', box).onclick = async () => { try { if (await salvarAud(id, 'aud-novo')) renderAudSecao(id); } catch {} };
    $$('[data-aud-del]', box).forEach((b) => b.onclick = async () => {
      if (!confirm('Apagar esta audiência da agenda?')) return;
      try { await acao('DELETE', `/api/cartoes/${id}/audiencias/${encodeURIComponent(b.dataset.audDel)}`); renderAudSecao(id); } catch {}
    });
    const disp = $('[data-dispensar]', box);
    if (disp) disp.onclick = async () => { try { await acao('POST', `/api/cartoes/${id}/audiencias/dispensar`); renderAudSecao(id); } catch {} };
  }

  // seção "Prazos" dentro do processo: lista + calculadora com prévia da contagem
  function renderPrazoSecao(id, pre) {
    const c = S.cartoes.find((x) => x.id === id);
    const box = $('#prazo-secao');
    if (!c || !box) return;
    const lista = (c.prazos || []).slice().sort((a, b) => (a.feito - b.feito) || a.fim.localeCompare(b.fim)).slice(0, 12);
    box.innerHTML = `
      <div class="aud-lista">${lista.map((p) => {
        const q = quandoPrazo(p.fim);
        return `<div class="aud-linha prazo-linha ${p.feito ? 'passada' : q.cls}">
          <div><strong>${esc(p.descricao)} · ${diaCurto(p.fim)}</strong> ${p.feito ? '<span class="selo neutro">cumprido</span>' : `<span class="selo prazo ${q.cls}">${q.txt}</span>`}<br>
          <small>${esc(descrPrazo(p))}${(p.pulados || []).length ? ` · pulou: ${p.pulados.map((x) => `${dataBR(x.data).slice(0, 5)}${x.ate ? '–' + dataBR(x.ate).slice(0, 5) : ''} (${esc(x.motivo)})`).join(', ')}` : ''}</small></div>
          <button type="button" class="btn icone" data-pz-feito="${p.id}" aria-label="${p.feito ? 'Reabrir' : 'Marcar como cumprido'}: ${esc(p.descricao)}" title="${p.feito ? 'Reabrir' : 'Cumprido'}">${p.feito ? ICON.voltar : ICON.check}</button>
          <button type="button" class="btn icone" data-pz-del="${p.id}" aria-label="Apagar prazo ${esc(p.descricao)}">${ICON.lixo}</button>
        </div>`;
      }).join('') || '<p class="sutil">Nenhum prazo cadastrado. Use "Contar prazo" numa intimação abaixo ou preencha aqui.</p>'}</div>
      <div class="pz-form">
        <label class="largo">O que é<input id="pz-descr" placeholder="Ex.: contestação, recurso, manifestação" maxlength="120" autocomplete="off"></label>
        <div class="linha-aud">
          <label>Data${campoData('id="pz-ref"')}</label>
          <label>Quantos dias<input id="pz-dias" type="text" inputmode="numeric" maxlength="3" placeholder="15" autocomplete="off"></label>
        </div>
        <label>Essa data é
          <select id="pz-modo">
            <option value="djen">Disponibilização no Diário (DJEN)</option>
            <option value="ciencia">Intimação/ciência (leitura no sistema ou publicação)</option>
          </select></label>
        <label>Contagem
          <select id="pz-tipo"><option value="uteis">Dias úteis (CPC)</option><option value="corridos">Dias corridos</option></select></label>
        <p id="pz-previa" class="pz-previa" aria-live="polite"></p>
        <button type="button" class="btn" data-pz-add>Adicionar prazo</button>
      </div>`;
    const f = { descr: $('#pz-descr'), ref: $('#pz-ref'), dias: $('#pz-dias'), modo: $('#pz-modo'), tipo: $('#pz-tipo') };
    if (pre) { f.ref.value = dataBR(pre.ref); f.modo.value = pre.modo || 'djen'; }
    const ler = () => ({ ref: brParaISO(f.ref.value), dias: Number(f.dias.value.replace(/\D/g, '')), modo: f.modo.value, tipo: f.tipo.value });
    const previa = () => {
      const d = ler();
      const r = window.Prazos && d.ref && d.dias ? window.Prazos.calcular({ ...d, extras: S.suspensoes || [] }) : null;
      $('#pz-previa').innerHTML = r
        ? `${d.modo === 'djen' ? `Publicação: <strong>${dataBR(r.publicacao)}</strong> · ` : ''}Começa a contar: <strong>${dataBR(r.inicio)}</strong><br>
           Último dia: <strong class="pz-fim">${diaCurto(r.fim)}</strong>
           ${r.pulados.length ? `<br><small>Pulou: ${r.pulados.map((x) => `${dataBR(x.data).slice(0, 5)}${x.ate ? '–' + dataBR(x.ate).slice(0, 5) : ''} (${esc(x.motivo)})`).join(', ')}</small>` : ''}
           <br><small>Ajuda de cálculo: confira sempre. Feriado municipal ou suspensão do tribunal? Cadastre em Mais.</small>`
        : '<small>Preencha a data e os dias para ver o último dia do prazo.</small>';
    };
    Object.values(f).forEach((el) => { el.addEventListener('input', previa); el.addEventListener('change', previa); });
    // Enter dentro da calculadora não deve salvar/fechar o processo
    $('.pz-form', box).addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); $('[data-pz-add]', box).click(); } });
    previa();
    $('[data-pz-add]', box).onclick = async () => {
      const d = ler();
      if (!d.ref) { toast('Digite a data no formato dd/mm/aaaa'); f.ref.focus(); return; }
      if (!(d.dias >= 1 && d.dias <= 365)) { toast('Informe quantos dias tem o prazo'); f.dias.focus(); return; }
      try {
        await acao('POST', `/api/cartoes/${id}/prazos`, { ...d, descricao: f.descr.value.trim() || 'Prazo' });
        const novo = (S.cartoes.find((x) => x.id === id).prazos || []).slice(-1)[0];
        toast('Prazo salvo');
        renderPrazoSecao(id);
      } catch {}
    };
    $$('[data-pz-feito]', box).forEach((b) => b.onclick = async () => {
      const p = c.prazos.find((x) => x.id === b.dataset.pzFeito);
      try { await acao('PATCH', `/api/cartoes/${id}/prazos/${p.id}`, { feito: !p.feito }); toast(p.feito ? 'Prazo reaberto' : 'Prazo marcado como cumprido'); renderPrazoSecao(id); } catch {}
    });
    $$('[data-pz-del]', box).forEach((b) => b.onclick = async () => {
      if (!confirm('Apagar este prazo?')) return;
      try { await acao('DELETE', `/api/cartoes/${id}/prazos/${b.dataset.pzDel}`); renderPrazoSecao(id); } catch {}
    });
  }

  let linkAgenda = null;
  async function prepararLinks() {
    linkAgenda = await api('GET', '/api/agenda/link').catch(() => linkAgenda);
    if (!linkAgenda) return;
    $('#ag-google').href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(linkAgenda.https)}`;
    $('#ag-webcal').href = linkAgenda.webcal;
    // mostra se o calendário do celular já leu a agenda (prova de que a assinatura funcionou)
    const L = linkAgenda.leituras || {};
    const nomes = Object.keys(L);
    const st = $('#ag-status');
    if (!nomes.length) {
      st.className = 'ag-status alerta';
      st.innerHTML = '<strong>Nenhum calendário leu a agenda ainda.</strong> A assinatura não foi concluída. Siga os passos em "Como assinar" abaixo.';
    } else {
      st.className = 'ag-status ok';
      st.innerHTML = nomes.map((n) => `<strong>${esc(n)}</strong> leu a agenda ${esc(relativo(L[n].em))} (${L[n].eventos} evento(s)).`).join('<br>') +
        `<br><span class="sutil">Prazos e audiências novos aparecem na próxima leitura. O Google relê a cada poucas horas.</span>`;
    }
  }
  $('#ag-copiar').addEventListener('click', async () => {
    await prepararLinks();
    try { await navigator.clipboard.writeText(linkAgenda.https); toast('Link da agenda copiado'); }
    catch { prompt('Copie o link da agenda:', linkAgenda.https); }
  });
  $('#ag-novo').addEventListener('click', async () => {
    if (!confirm('Gerar um link novo? O link antigo para de funcionar e você precisa assinar a agenda de novo no celular.')) return;
    await api('POST', '/api/agenda/novo-link').catch(() => {});
    linkAgenda = null;
    await prepararLinks();
    toast('Link novo gerado. Assine a agenda de novo.');
  });

  function renderAgenda() {
    prepararLinks();
    const hoje = hojeISO();
    const amanha = somaDias(hoje, 1);
    const pzs = prazosAbertos();
    $('#agenda-prazos').innerHTML = pzs.length ? `<p class="ag-dia">Prazos em aberto (${pzs.length})</p>` + pzs.map(({ c, p }) => {
      const q = quandoPrazo(p.fim);
      return `<div class="ag-item ag-prazo ${q.cls}">
        <button type="button" class="ag-abrir" data-id="${c.id}">
          <span class="ag-hora">${dataBR(p.fim).slice(0, 5)}<small>${new Date(p.fim + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' })}</small></span>
          <span class="ag-info"><strong>${esc(c.cliente)}</strong><span class="sutil">Prazo: ${esc(p.descricao)} · <span class="selo prazo ${q.cls}">${q.txt}</span></span>
          <span class="cartao-info">${esc([cnj(c.numero), c.orgao].filter(Boolean).join(' · '))}</span></span>
        </button>
        <button type="button" class="btn icone" data-feito="${c.id}|${p.id}" aria-label="Marcar prazo ${esc(p.descricao)} de ${esc(c.cliente)} como cumprido" title="Cumprido">${ICON.check}</button>
      </div>`;
    }).join('') : '';
    $$('#agenda-prazos .ag-abrir').forEach((b) => b.addEventListener('click', () => abrirCartao(b.dataset.id)));
    $$('#agenda-prazos [data-feito]').forEach((b) => b.addEventListener('click', async () => {
      const [cid, pid] = b.dataset.feito.split('|');
      try { await acao('PATCH', `/api/cartoes/${cid}/prazos/${pid}`, { feito: true }); toast('Prazo marcado como cumprido'); } catch {}
    }));
    const pend = S.cartoes.filter((c) => c.audPendente);
    $('#agenda-pendentes').innerHTML = pend.length ? `<p class="ag-dia hoje">Audiência marcada, falta a data (${pend.length})</p>` + pend.map((c) => `
      <div class="pendente" data-id="${c.id}">
        <span><strong>${esc(c.cliente)}</strong><br>${esc(c.audPendente.tipo)} · aviso de ${dataBR(c.audPendente.em)}<br><span class="num">${esc(cnj(c.numero))}</span></span>
        ${formAudHTML('pend-' + c.id)}
        <div class="item-acoes"><button type="button" class="btn fantasma" data-dispensar>Não precisa</button><button type="button" class="btn primario" data-salvar>Salvar data</button></div>
      </div>`).join('') : '';
    $$('#agenda-pendentes .pendente').forEach((el) => {
      const id = el.dataset.id;
      $('[data-salvar]', el).onclick = () => salvarAud(id, 'pend-' + id).catch(() => {});
      $('[data-dispensar]', el).onclick = () => acao('POST', `/api/cartoes/${id}/audiencias/dispensar`).catch(() => {});
    });

    const itens = [];
    for (const c of S.cartoes) for (const a of c.audiencias || []) if (a.data >= hoje) itens.push({ c, a });
    itens.sort((x, y) => `${x.a.data}${x.a.hora || '99'}`.localeCompare(`${y.a.data}${y.a.hora || '99'}`));
    let html = '', dia = '';
    for (const { c, a } of itens) {
      if (a.data !== dia) {
        dia = a.data;
        const rot = a.data === hoje ? 'Hoje' : a.data === amanha ? 'Amanhã' : diaLongo(a.data);
        html += `<p class="ag-dia ${a.data === hoje ? 'hoje' : ''}">${esc(rot)}</p>`;
      }
      html += `<button type="button" class="ag-item" data-id="${c.id}">
        <span class="ag-hora">${a.hora || '--:--'}<small>${dataBR(a.data).slice(0, 5)}</small></span>
        <span class="ag-info"><strong>${esc(c.cliente)}</strong><span class="sutil">${esc(a.tipo || 'Audiência')}</span>
        <span class="cartao-info">${esc([cnj(c.numero), c.orgao].filter(Boolean).join(' · '))}</span></span>
      </button>`;
    }
    if (html) html = '<p class="ag-dia">Audiências</p>' + html;
    $('#agenda-lista').innerHTML = html || `<div class="vazio"><strong>Nenhuma audiência futura</strong>Quando uma intimação trouxer a data, ela aparece aqui. Você também pode colocar a data no editar do processo.</div>`;
    $$('#agenda-lista .ag-item').forEach((b) => b.addEventListener('click', () => abrirCartao(b.dataset.id)));
  }

  function filtrados() {
    const q = busca.trim().toLowerCase();
    if (!q) return S.cartoes;
    const qd = dig(q);
    return S.cartoes.filter((c) =>
      (c.cliente || '').toLowerCase().includes(q) ||
      (qd && dig(c.numero).includes(qd)) ||
      (c.classe || '').toLowerCase().includes(q) ||
      (c.notas || '').toLowerCase().includes(q));
  }

  function renderQuadro() {
    const lista = filtrados();
    const porEtapa = (id) => lista.filter((c) => c.etapaId === id)
      .sort((a, b) => (b.novidade - a.novidade) || (a.etapaDesde || '').localeCompare(b.etapaDesde || ''));

    // chips (celular)
    $('#chips').innerHTML = S.etapas.map((e, i) => {
      const cs = porEtapa(e.id);
      const nov = cs.some((c) => c.novidade);
      return `<button type="button" class="chip" data-etapa="${e.id}" aria-pressed="${e.id === etapaAtiva}">
        ${nov ? '<span class="ponto" aria-hidden="true"></span><span class="sr">Tem nova intimação. </span>' : ''}${esc(e.nome)}<span class="n"><span class="sr">, </span>${cs.length}<span class="sr"> processos</span></span></button>`;
    }).join('');
    $$('#chips .chip').forEach((b) => b.addEventListener('click', () => {
      etapaAtiva = b.dataset.etapa;
      renderQuadro();
      b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }));

    $('#quadro').innerHTML = S.etapas.map((e, i) => {
      const cs = porEtapa(e.id);
      const prox = S.etapas[i + 1];
      return `<section class="coluna ${e.id === etapaAtiva ? 'ativa' : ''}" id="col-${e.id}" data-etapa="${e.id}" aria-label="${esc(e.nome)}">
        <div class="coluna-cab"><span>${esc(e.nome)}</span><span class="n">${cs.length}</span></div>
        <div class="cartoes">
          ${cs.length ? cs.map((c) => cartaoHTML(c, i, prox)).join('') : vazioHTML(e, i)}
        </div>
      </section>`;
    }).join('');

    $$('#quadro .cartao-corpo').forEach((b) => b.addEventListener('click', () => abrirCartao(b.closest('.cartao').dataset.id)));
    $$('#quadro .btn-avancar').forEach((b) => b.addEventListener('click', () => avancar(b.closest('.cartao').dataset.id)));
    $$('#quadro .btn-voltar').forEach((b) => b.addEventListener('click', () => avancar(b.closest('.cartao').dataset.id, true)));
    ativarArrastar();
  }

  function vazioHTML(e, i) {
    if (busca) return '<div class="vazio">Nada encontrado nesta etapa.</div>';
    if (i === 0) return `<div class="vazio"><strong>Nenhum cliente novo</strong>Adicione pelo botão + ou aceite processos em Encontrados.</div>`;
    return `<div class="vazio">Nenhum processo em “${esc(e.nome)}”.</div>`;
  }

  function cartaoHTML(c, i, prox) {
    const info = [c.classe, c.orgao].filter(Boolean).join(' · ');
    return `<article class="cartao" data-id="${c.id}" draggable="true">
      <button type="button" class="cartao-corpo" aria-label="Abrir ${esc(c.cliente)}">
        <span class="cartao-cliente"><span>${esc(c.cliente)}</span>${c.novidade ? '<span class="selo">Nova intimação</span>' : ''}</span>
        ${c.numero ? `<span class="cartao-proc num">${esc(cnj(c.numero))}</span>` : ''}
        ${info ? `<span class="cartao-info">${esc(info)}</span>` : ''}
        <span class="cartao-meta"><span>${diasDesde(c.etapaDesde)}</span>${c.honorarios ? `<span>Honorários: ${esc(c.honorarios)}</span>` : ''}</span>
        ${selosAudiencia(c)}
      </button>
      <div class="cartao-acoes">
        ${foneWA(c.telefone) ? `<a class="btn btn-whats" href="${linkWA(foneWA(c.telefone), `Olá${primeiroNome(c.cliente) ? ', ' + primeiroNome(c.cliente) : ''}! Tudo bem?`)}" target="_blank" rel="noopener" aria-label="WhatsApp de ${esc(c.cliente)}" title="WhatsApp">${ICON.whats}</a>` : ''}
        ${i > 0 ? `<button type="button" class="btn btn-voltar" aria-label="Voltar para ${esc(S.etapas[i - 1].nome)}" title="Voltar etapa">${ICON.voltar}</button>` : ''}
        ${prox
          ? `<button type="button" class="btn btn-avancar"><span class="check">${ICON.check}</span><span class="rot">Concluir <small>→ ${esc(prox.nome)}</small></span></button>`
          : `<span class="final">${ICON.feito} Etapa final</span>`}
      </div>
    </article>`;
  }

  async function avancar(id, voltar) {
    const c = S.cartoes.find((x) => x.id === id);
    if (!c) return;
    const de = c.etapaId;
    await acao('POST', `/api/cartoes/${id}/avancar`, { voltar: !!voltar });
    const novo = S.cartoes.find((x) => x.id === id);
    const etapa = S.etapas.find((e) => e.id === novo.etapaId);
    if (navigator.vibrate) navigator.vibrate(12);
    toast(`${c.cliente.split(' ')[0]} → ${etapa ? etapa.nome : ''}`, () => acao('PATCH', `/api/cartoes/${id}`, { etapaId: de }));
  }

  // Arrastar e soltar (computador)
  function ativarArrastar() {
    if (!matchMedia('(min-width: 960px) and (pointer: fine)').matches) return;
    $$('#quadro .cartao').forEach((el) => {
      el.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', el.dataset.id); el.classList.add('arrastando'); });
      el.addEventListener('dragend', () => el.classList.remove('arrastando'));
    });
    $$('#quadro .coluna').forEach((col) => {
      col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('alvo'); });
      col.addEventListener('dragleave', () => col.classList.remove('alvo'));
      col.addEventListener('drop', (ev) => {
        ev.preventDefault(); col.classList.remove('alvo');
        const id = ev.dataTransfer.getData('text/plain');
        const c = S.cartoes.find((x) => x.id === id);
        if (c && c.etapaId !== col.dataset.etapa) acao('PATCH', `/api/cartoes/${id}`, { etapaId: col.dataset.etapa });
      });
    });
  }

  $('#busca').addEventListener('input', (ev) => {
    busca = ev.target.value;
    renderQuadro();
    // no celular, pula para a primeira etapa com resultado
    if (busca && !filtrados().some((c) => c.etapaId === etapaAtiva)) {
      const c = filtrados()[0];
      if (c) { etapaAtiva = c.etapaId; renderQuadro(); }
    }
  });

  // ---------- Encontrados ----------
  function renderEncontrados() {
    const el = $('#lista-encontrados');
    if (!S.encontrados.length) {
      el.innerHTML = `<div class="vazio"><strong>Nada pendente</strong>${syncLocal ? 'Buscando intimações…' : 'Quando surgir um processo novo na sua OAB, ele aparece aqui.'}</div>`;
      return;
    }
    el.innerHTML = S.encontrados.map((p) => {
      const escolhido = escolhaCliente[p.numero] ?? p.sugestaoCliente ?? '';
      const partes = (p.partes || []).filter((x) => x.nome !== 'SIGILO');
      return `<article class="item" data-numero="${p.numero}">
        <div class="cartao-cliente"><h3>${esc(escolhido || 'Cliente não identificado')}</h3>${p.tribunal ? `<span class="selo neutro">${esc(p.tribunal)}</span>` : ''}</div>
        <span class="cartao-proc num">${esc(cnj(p.numero))}</span>
        <span class="cartao-info">${esc([p.classe, p.orgao].filter(Boolean).join(' · '))}</span>
        <span class="cartao-meta"><span>Última intimação: ${dataBR(p.ultimaData)}</span><span>${(p.intimacoes || []).length} intimação(ões)</span></span>
        ${partes.length ? `<div><p class="sutil" style="font-size:.8rem;margin-bottom:6px">Quem é o cliente? Toque para escolher:</p>
          <div class="partes">${partes.map((x) => `<button type="button" class="parte" aria-pressed="${x.nome === escolhido}" data-nome="${esc(x.nome)}">${esc(x.nome)} <small>${POLO[x.polo] || ''}</small></button>`).join('')}</div></div>` : ''}
        <div class="item-acoes">
          <button type="button" class="btn fantasma" data-desc>Descartar</button>
          <button type="button" class="btn primario" data-aceitar>Adicionar ao quadro</button>
        </div>
      </article>`;
    }).join('');
    $$('#lista-encontrados .parte').forEach((b) => b.addEventListener('click', () => {
      const num = b.closest('.item').dataset.numero;
      escolhaCliente[num] = b.dataset.nome;
      renderEncontrados();
    }));
    $$('#lista-encontrados [data-aceitar]').forEach((b) => b.addEventListener('click', async () => {
      const num = b.closest('.item').dataset.numero;
      const p = S.encontrados.find((x) => x.numero === num);
      const nome = escolhaCliente[num] ?? p.sugestaoCliente ?? '';
      b.disabled = true;
      await acao('POST', `/api/encontrados/${num}/aceitar`, { cliente: nome }).catch(() => {});
      toast(`Adicionado em “${S.etapas[0].nome}”`);
    }));
    $$('#lista-encontrados [data-desc]').forEach((b) => b.addEventListener('click', async () => {
      const num = b.closest('.item').dataset.numero;
      b.disabled = true;
      await acao('POST', `/api/encontrados/${num}/descartar`).catch(() => {});
      toast('Descartado', () => acao('POST', `/api/descartados/${num}/restaurar`));
    }));
  }

  // ---------- Etapas ----------
  function renderEtapas() {
    const ul = $('#lista-etapas');
    ul.innerHTML = S.etapas.map((e, i) => {
      const n = S.cartoes.filter((c) => c.etapaId === e.id).length;
      return `<li class="etapa-linha" data-id="${e.id}">
        <span class="ordem">${i + 1}</span>
        <input value="${esc(e.nome)}" maxlength="60" aria-label="Nome da etapa ${i + 1}">
        <span class="etapa-botoes">
          <button type="button" class="btn icone" data-mover="-1" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>${ICON.cima}</button>
          <button type="button" class="btn icone" data-mover="1" aria-label="Descer" ${i === S.etapas.length - 1 ? 'disabled' : ''}>${ICON.baixo}</button>
          <button type="button" class="btn icone" data-excluir aria-label="Excluir etapa" title="${n ? `Tem ${n} processo(s)` : 'Excluir'}">${ICON.lixo}</button>
        </span>
      </li>`;
    }).join('');
    $$('#lista-etapas input').forEach((inp) => {
      const salvarNome = async () => {
        const id = inp.closest('li').dataset.id;
        const e = S.etapas.find((x) => x.id === id);
        const nome = inp.value.trim();
        if (!nome) { inp.value = e.nome; return; }
        if (nome !== e.nome) { await acao('PATCH', `/api/etapas/${id}`, { nome }).catch(() => {}); toast('Etapa renomeada'); }
      };
      inp.addEventListener('blur', salvarNome);
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } });
    });
    $$('#lista-etapas [data-mover]').forEach((b) => b.addEventListener('click', () => {
      const id = b.closest('li').dataset.id;
      const ids = S.etapas.map((e) => e.id);
      const i = ids.indexOf(id), j = i + Number(b.dataset.mover);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      acao('POST', '/api/etapas/ordem', { ids }).catch(() => {});
    }));
    $$('#lista-etapas [data-excluir]').forEach((b) => b.addEventListener('click', () => {
      const id = b.closest('li').dataset.id;
      const e = S.etapas.find((x) => x.id === id);
      if (confirm(`Excluir a etapa “${e.nome}”?`)) acao('DELETE', `/api/etapas/${id}`).catch(() => {});
    }));
  }
  $('#form-etapa').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const inp = ev.target.nome;
    await acao('POST', '/api/etapas', { nome: inp.value }).catch(() => {});
    inp.value = '';
  });

  // ---------- Mais ----------
  function renderMais() {
    const sl = $('#lista-suspensoes');
    const sus = S.suspensoes || [];
    sl.innerHTML = sus.length ? sus.map((x) => `
      <div class="item"><div><strong>${diaCurto(x.data)}</strong><div class="sutil">${esc(x.nome || 'dia sem expediente')}</div></div>
      <button type="button" class="btn icone" data-susp-del="${x.data}" aria-label="Remover ${dataBR(x.data)}">${ICON.lixo}</button></div>`).join('')
      : '<p class="sutil">Nenhum dia cadastrado.</p>';
    $$('[data-susp-del]', sl).forEach((b) => b.onclick = () =>
      acao('PUT', '/api/suspensoes', { datas: sus.filter((x) => x.data !== b.dataset.suspDel) }).then(() => toast('Removido. Prazos recalculados.')).catch(() => {}));
    $('#senha-info').textContent = S.senhaTrocadaEm
      ? `Senha trocada pelo app em ${dataBR(S.senhaTrocadaEm)}. Ao trocar, os outros aparelhos precisam entrar de novo.`
      : 'Você ainda usa a senha criada na instalação. Troque por uma só sua. Ao trocar, os outros aparelhos precisam entrar de novo.';
    const el = $('#lista-descartados');
    el.innerHTML = S.descartados.length ? S.descartados.map((d) => `
      <div class="item" data-numero="${d.numero}">
        <div><strong>${esc(d.cliente || 'Sem nome')}</strong><div class="cartao-proc num">${esc(cnj(d.numero))}</div></div>
        <button type="button" class="btn" data-restaurar>Restaurar</button>
      </div>`).join('') : '<p class="sutil">Nenhum processo descartado.</p>';
    $$('#lista-descartados [data-restaurar]').forEach((b) => b.addEventListener('click', async () => {
      await acao('POST', `/api/descartados/${b.closest('.item').dataset.numero}/restaurar`).catch(() => {});
      toast('Restaurado: está em Encontrados');
    }));
  }

  $('#susp-add').addEventListener('click', async () => {
    const data = brParaISO($('#susp-data').value);
    if (!data) { toast('Digite a data no formato dd/mm/aaaa'); $('#susp-data').focus(); return; }
    const nome = $('#susp-nome').value.trim();
    try {
      await acao('PUT', '/api/suspensoes', { datas: [...(S.suspensoes || []), { data, nome }] });
      $('#susp-data').value = ''; $('#susp-nome').value = '';
      toast('Dia cadastrado. Prazos em aberto recalculados.');
    } catch {}
  });
  $('#form-senha').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    if (f.nova.value !== f.repete.value) { toast('As duas novas senhas não são iguais'); f.repete.focus(); return; }
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    try {
      await api('POST', '/api/senha', { atual: f.atual.value, nova: f.nova.value });
      f.reset();
      S = await api('GET', '/api/estado'); render();
      toast('Senha trocada. Os outros aparelhos vão pedir a senha nova.');
    } catch (e) { toast(e.message); }
    btn.disabled = false;
  });

  // ---------- Folha de detalhe ----------
  const dlg = $('#dlg');
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg || ev.target.closest('[data-fechar]')) dlg.close(); });

  function campos(c) {
    return `
      <label>Cliente<input name="cliente" value="${esc(c.cliente === 'Cliente sem nome' ? '' : (c.cliente || ''))}" placeholder="Nome do cliente" required autocomplete="off"></label>
      <div class="duas">
        <label>Telefone<input name="telefone" type="tel" inputmode="tel" value="${esc(c.telefone || '')}" autocomplete="off"></label>
        <label>Honorários<input name="honorarios" inputmode="decimal" value="${esc(c.honorarios || '')}" placeholder="R$" autocomplete="off"></label>
      </div>
      <label>Nº do processo<input name="numero" class="num" inputmode="numeric" value="${esc(cnj(c.numero || ''))}" placeholder="0000000-00.0000.0.00.0000" autocomplete="off"></label>
      <label>Vara / órgão<input name="orgao" value="${esc(c.orgao || '')}" autocomplete="off"></label>
      <label>Classe / assunto<input name="classe" value="${esc(c.classe || '')}" autocomplete="off"></label>
      <label>Etapa<select name="etapaId">${S.etapas.map((e) => `<option value="${e.id}" ${e.id === (c.etapaId || etapaAtiva) ? 'selected' : ''}>${esc(e.nome)}</option>`).join('')}</select></label>
      <label>Anotações<textarea name="notas" rows="4">${esc(c.notas || '')}</textarea></label>`;
  }

  function ligarFoto(form) {
    const inp = $('#foto-arquivo');
    const status = $('#foto-status');
    const botao = $('[data-foto]');
    const preencher = (nome, valor, sobrescrever) => {
      if (!valor || !form[nome]) return false;
      if (form[nome].value && !sobrescrever) return false;
      form[nome].value = nome === 'numero' ? cnj(valor) : valor;
      return true;
    };
    const titulo = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()) : s);
    const chips = (partes) => {
      const box = $('#foto-partes');
      if (!partes.length) { box.innerHTML = ''; return; }
      box.innerHTML = `<p class="sutil" style="font-size:.8rem;margin:4px 0 6px">Quem é o cliente? Toque para escolher:</p>
        <div class="partes">${partes.map((p) => `<button type="button" class="parte" data-nome="${esc(p.nome)}">${esc(p.nome)} <small>${esc(p.polo || '')}</small></button>`).join('')}</div>`;
      $$('.parte', box).forEach((b) => b.addEventListener('click', () => {
        form.cliente.value = titulo(b.dataset.nome);
        $$('.parte', box).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      }));
    };
    botao.addEventListener('click', () => inp.click());
    inp.addEventListener('change', async () => {
      const arq = inp.files && inp.files[0];
      inp.value = '';
      if (!arq) return;
      botao.disabled = true;
      botao.classList.add('girando');
      try {
        if (!window.LeitorFoto) throw new Error('Leitor de foto indisponível.');
        const { texto, campos: c } = await window.LeitorFoto.ler(arq, (msg) => { status.textContent = msg; });
        $('#foto-texto').hidden = !texto.trim();
        $('#foto-texto textarea').value = texto.trim();
        const achados = [];
        if (preencher('numero', c.numero, true)) achados.push('nº do processo');
        if (preencher('orgao', c.orgao)) achados.push('vara');
        if (preencher('classe', c.classe)) achados.push('classe');
        if (preencher('telefone', c.telefone)) achados.push('telefone');
        if (c.audiencia && form.audData && !form.audData.value) {
          form.audData.value = dataBR(c.audiencia.data);
          if (c.audiencia.hora) form.audHora.value = c.audiencia.hora;
          achados.push('data da audiência');
        }
        if (c.valor && !form.notas.value) form.notas.value = `Valor da causa: ${c.valor}`;
        // a parte assistida é o cliente: tem prioridade sobre qualquer outro nome
        if (c.assistida[0]) { form.cliente.value = titulo(c.assistida[0]); achados.push('cliente (parte assistida)'); }
        let partes = [
          ...c.assistida.map((n) => ({ nome: n, polo: 'parte assistida' })),
          ...c.ativo.filter((n) => !c.assistida.includes(n)).map((n) => ({ nome: n, polo: 'polo ativo' })),
          ...c.passivo.filter((n) => !c.assistida.includes(n)).map((n) => ({ nome: n, polo: 'polo passivo' }))
        ];
        // completa com o que a busca da OAB já sabe sobre esse processo
        if (c.numero) {
          const conhecido = await api('GET', `/api/processo/${dig(c.numero)}`).catch(() => null);
          if (conhecido) {
            if (preencher('orgao', conhecido.orgao)) achados.push('vara');
            if (preencher('classe', conhecido.classe)) achados.push('classe');
            const extras = (conhecido.partes || []).filter((p) => !p.advogada && p.nome !== 'SIGILO' && !partes.some((x) => x.nome === p.nome))
              .map((p) => ({ nome: p.nome, polo: POLO[p.polo] || '' }));
            partes = partes.concat(extras);
            if (!form.cliente.value && conhecido.sugestaoCliente && conhecido.sugestaoCliente !== 'Processo em sigilo') form.cliente.value = titulo(conhecido.sugestaoCliente);
            achados.push('dados da OAB');
          }
        }
        if (!form.cliente.value && c.ativo[0]) form.cliente.value = titulo(c.ativo[0]);
        if (partes.length) achados.push('partes');
        chips(partes);
        status.textContent = achados.length
          ? `Encontrei: ${[...new Set(achados)].join(', ')}. Confira os campos antes de salvar.`
          : 'Não consegui identificar os dados. Tente uma foto mais nítida, reta e bem iluminada, ou preencha à mão.';
      } catch (e) {
        status.textContent = e.message || 'Não foi possível ler a foto.';
      } finally {
        botao.disabled = false;
        botao.classList.remove('girando');
      }
    });
  }

  // ---------- Exportar PDF ----------
  function abrirExportar() {
    $('#dlg-titulo').textContent = 'Exportar PDF';
    const n = (id) => S.cartoes.filter((c) => c.etapaId === id).length;
    $('#dlg-corpo').innerHTML = `
      <fieldset class="opcoes">
        <legend>O que exportar</legend>
        <label class="opcao"><input type="radio" name="tipo" value="processos" checked> Processos (tabela por etapa)</label>
        <label class="opcao"><input type="radio" name="tipo" value="audiencias"> Agenda: prazos em aberto e próximas audiências</label>
      </fieldset>
      <div id="exp-proc">
        <label>Etapa<select name="etapa">
          <option value="">Todas as etapas (${S.cartoes.length})</option>
          ${S.etapas.map((e) => `<option value="${e.id}">${esc(e.nome)} (${n(e.id)})</option>`).join('')}
        </select></label>
        <label class="opcao"><input type="checkbox" name="notas"> Incluir anotações</label>
      </div>
      <p class="sutil">O PDF sai em A4 deitado, pronto para imprimir. No celular ele vai para Downloads: abra e use Imprimir ou Compartilhar.</p>`;
    $('#dlg-rodape').innerHTML = `<button type="button" class="btn fantasma" data-fechar>Cancelar</button><button type="submit" class="btn primario">Gerar PDF</button>`;
    const form = $('#form-cartao');
    const alternar = () => { $('#exp-proc').hidden = form.tipo.value !== 'processos'; };
    $$('input[name=tipo]', form).forEach((r) => r.addEventListener('change', alternar));
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const btn = $('button[type=submit]', dlg);
      btn.disabled = true;
      btn.textContent = 'Gerando…';
      try {
        if (!window.ExportarPDF) throw new Error('Exportação indisponível.');
        const r = await window.ExportarPDF.gerar(S, { tipo: form.tipo.value, etapa: form.etapa.value, notas: form.notas.checked });
        dlg.close();
        toast(`PDF gerado: ${r.linhas} linha(s)`);
      } catch (e) {
        toast(e.message || 'Não foi possível gerar o PDF.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Gerar PDF';
      }
    };
    if (!dlg.open) dlg.showModal();
    if (window.ExportarPDF) window.ExportarPDF.carregar().catch(() => {});
  }

  function abrirNovo() {
    $('#dlg-titulo').textContent = 'Novo processo';
    $('#dlg-corpo').innerHTML = `
      <div class="foto-caixa">
        <button type="button" class="btn grande" data-foto>${ICON.camera}<span>Preencher por foto</span></button>
        <input type="file" accept="image/*" id="foto-arquivo" hidden>
        <p class="sutil" id="foto-status">Tire uma foto da capa ou da tela do processo. A leitura é feita no próprio aparelho.</p>
        <div id="foto-partes"></div>
        <details id="foto-texto" hidden><summary>Ver texto lido da foto</summary><textarea readonly rows="6" aria-label="Texto lido da foto"></textarea></details>
      </div>
      ${campos({ etapaId: vista === 'quadro' ? etapaAtiva : S.etapas[0].id })}
      <p class="secao-titulo">Audiência (opcional)</p>
      <div class="linha-aud">
        <label>Data${campoData('name="audData"')}</label>
        <label>Hora${campoHora('name="audHora"')}</label>
        <label class="largo">Tipo<input name="audTipo" placeholder="Ex.: instrução e julgamento" autocomplete="off"></label>
      </div>`;
    $('#dlg-rodape').innerHTML = `<button type="button" class="btn fantasma" data-fechar>Cancelar</button><button type="submit" class="btn primario">Adicionar</button>`;
    const form = $('#form-cartao');
    ligarFoto(form);
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const dados = Object.fromEntries(new FormData(form));
      if (dados.audData) {
        const iso = brParaISO(dados.audData);
        if (!iso) { toast('Data da audiência: use dd/mm/aaaa'); form.audData.focus(); return; }
        if (dados.audHora && !horaValida(dados.audHora)) { toast('Hora da audiência: use hh:mm (ex.: 14:30)'); form.audHora.focus(); return; }
        dados.audData = iso;
      }
      try {
        await acao('POST', '/api/cartoes', dados);
        dlg.close();
        etapaAtiva = dados.etapaId;
        if (vista !== 'quadro') irPara('quadro'); else render();
        toast('Processo adicionado');
      } catch {}
    };
    dlg.showModal();
    setTimeout(() => form.cliente.focus(), 60);
  }

  // Seção WhatsApp na folha do processo: usa o telefone digitado no campo (mesmo antes de salvar).
  function renderWASecao(c) {
    const box = $('#wa-secao');
    const campo = $('#form-cartao [name="telefone"]');
    if (!box || !campo) return;
    const desenhar = () => {
      const fone = foneWA(campo.value);
      if (!fone) {
        box.innerHTML = `<p class="sutil">${dig(campo.value) ? 'Telefone incompleto: use DDD + número, ex.: (41) 99999-9999.' : 'Preencha o telefone do cliente para enviar mensagens prontas.'}</p>`;
        return;
      }
      const dados = { ...c, cliente: $('#form-cartao [name="cliente"]').value || c.cliente };
      box.innerHTML = `<p class="sutil">Escolha a mensagem. Ela abre no WhatsApp para você completar ou ajustar antes de enviar.</p>
        <div class="wa-opcoes">${mensagensWA(dados).map((m) =>
          `<a class="btn wa-op" href="${linkWA(fone, m.txt)}" target="_blank" rel="noopener">${ICON.whats}<span>${esc(m.rot)}</span></a>`).join('')}</div>`;
    };
    campo.addEventListener('input', desenhar);
    desenhar();
  }

  function abrirCartao(id) {
    const c = S.cartoes.find((x) => x.id === id);
    if (!c) return;
    const conhecidas = c.novidade;
    $('#dlg-titulo').textContent = c.cliente;
    const partes = (c.partes || []).filter((p) => p.nome !== 'SIGILO');
    const intims = (c.intimacoes || []).slice(0, 15);
    $('#dlg-corpo').innerHTML = `
      ${campos(c)}
      <p class="secao-titulo">Prazos</p>
      <div id="prazo-secao" class="aud-secao"></div>
      <p class="secao-titulo">Audiências</p>
      <div id="aud-secao" class="aud-secao"></div>
      <p class="secao-titulo">WhatsApp</p>
      <div id="wa-secao" class="wa-secao"></div>
      ${partes.length ? `<p class="secao-titulo">Partes</p><div class="partes">${partes.map((p) => `<span class="parte">${esc(p.nome)} <small>${POLO[p.polo] || ''}</small></span>`).join('')}</div>` : ''}
      ${intims.length ? `<p class="secao-titulo">Intimações recentes</p>${intims.map((x, k) => `
        <div class="intim ${conhecidas && k === 0 ? 'nova' : ''}">
          <span class="data">${dataBR(x.data)} · ${esc(x.tipo)}</span>
          <span>${esc(x.texto)}</span>
          <span class="intim-acoes">
            ${/^\d{4}-\d{2}-\d{2}/.test(x.data || '') ? `<button type="button" class="btn" data-contar="${esc(x.data.slice(0, 10))}">Contar prazo</button>` : ''}
            ${/^https:\/\//.test(x.link || '') ? `<a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">Abrir no tribunal</a>` : ''}
          </span>
        </div>`).join('')}` : ''}
      ${(c.historico || []).length ? `<p class="secao-titulo">Histórico de etapas</p><ul class="historico">${c.historico.slice().reverse().slice(0, 12).map((h) =>
        `<li>${dataBR(h.em)} — ${esc((S.etapas.find((e) => e.id === h.etapaId) || h).nome || '')}</li>`).join('')}</ul>` : ''}`;
    $('#dlg-rodape').innerHTML = `<button type="button" class="btn fantasma perigo-texto" data-remover>${ICON.lixo}<span>Remover</span></button><button type="submit" class="btn primario">Salvar</button>`;
    const form = $('#form-cartao');
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const dados = Object.fromEntries(new FormData(form));
      try {
        await acao('PATCH', `/api/cartoes/${id}`, dados);
        etapaAtiva = dados.etapaId;
        dlg.close();
        render();
        toast('Salvo');
      } catch {}
    };
    $('[data-remover]', dlg).onclick = async () => {
      const msg = c.origem === 'oab'
        ? `Remover “${c.cliente}” do quadro? Ele não volta sozinho pela busca da OAB (dá para restaurar em Mais › Descartados).`
        : `Remover “${c.cliente}” do quadro? Isso não pode ser desfeito.`;
      if (!confirm(msg)) return;
      try { await acao('DELETE', `/api/cartoes/${id}`); dlg.close(); toast('Removido do quadro'); } catch {}
    };
    renderWASecao(c);
    renderPrazoSecao(id);
    $$('#dlg-corpo [data-contar]').forEach((b) => b.onclick = () => {
      renderPrazoSecao(id, { ref: b.dataset.contar, modo: 'djen' });
      $('#prazo-secao').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => $('#pz-descr').focus({ preventScroll: true }), 350);
    });
    renderAudSecao(id);
    if (!dlg.open) dlg.showModal();
    $('#dlg-corpo').scrollTop = 0;
    if (c.novidade) api('PATCH', `/api/cartoes/${id}`, { novidade: false }).then((n) => { S = n; render(); }).catch(() => {});
  }

  // Máscara do nº CNJ ao digitar
  document.addEventListener('input', (ev) => {
    if (ev.target.name !== 'numero') return;
    const d = dig(ev.target.value).slice(0, 20);
    if (d.length === 20) ev.target.value = cnj(d);
  });

  // ---------- Início ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  iniciar().catch(() => mostrarLogin());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S) api('GET', '/api/estado').then((n) => { S = n; render(); if (syncVencida()) sincronizar(true); }).catch(() => {});
  });
})();
