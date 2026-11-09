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

  const ICON = {
    check: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    voltar: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M15 18 9 12l6-6"/></svg>',
    cima: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>',
    baixo: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
    lixo: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    camera: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
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
      </button>
      <div class="cartao-acoes">
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
      ${campos({ etapaId: vista === 'quadro' ? etapaAtiva : S.etapas[0].id })}`;
    $('#dlg-rodape').innerHTML = `<button type="button" class="btn fantasma" data-fechar>Cancelar</button><button type="submit" class="btn primario">Adicionar</button>`;
    const form = $('#form-cartao');
    ligarFoto(form);
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const dados = Object.fromEntries(new FormData(form));
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

  function abrirCartao(id) {
    const c = S.cartoes.find((x) => x.id === id);
    if (!c) return;
    const conhecidas = c.novidade;
    $('#dlg-titulo').textContent = c.cliente;
    const tel = dig(c.telefone);
    const partes = (c.partes || []).filter((p) => p.nome !== 'SIGILO');
    const intims = (c.intimacoes || []).slice(0, 15);
    $('#dlg-corpo').innerHTML = `
      ${campos(c)}
      ${tel ? `<a class="btn" href="https://wa.me/${tel.length <= 11 ? '55' + tel : tel}" target="_blank" rel="noopener">Abrir conversa no WhatsApp</a>` : ''}
      ${partes.length ? `<p class="secao-titulo">Partes</p><div class="partes">${partes.map((p) => `<span class="parte">${esc(p.nome)} <small>${POLO[p.polo] || ''}</small></span>`).join('')}</div>` : ''}
      ${intims.length ? `<p class="secao-titulo">Intimações recentes</p>${intims.map((x, k) => `
        <div class="intim ${conhecidas && k === 0 ? 'nova' : ''}">
          <span class="data">${dataBR(x.data)} · ${esc(x.tipo)}</span>
          <span>${esc(x.texto)}</span>
          ${/^https:\/\//.test(x.link || '') ? `<a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">Abrir no tribunal</a>` : ''}
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
    dlg.showModal();
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
