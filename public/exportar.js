'use strict';
// Exporta processos ou audiências para um PDF em tabela (A4 paisagem), pronto para imprimir.
// jsPDF + AutoTable são carregados só quando o botão é usado.
(() => {
  const LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
  ];
  let carregando = null;
  function carregar() {
    if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable) return Promise.resolve();
    if (carregando) return carregando;
    carregando = LIBS.reduce((p, src) => p.then(() => new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = ok;
      s.onerror = () => { carregando = null; erro(new Error('Não foi possível carregar o gerador de PDF. Verifique a internet.')); };
      document.head.appendChild(s);
    })), Promise.resolve());
    return carregando;
  }

  const dig = (s) => String(s || '').replace(/\D/g, '');
  const cnj = (n) => {
    const d = dig(n);
    return d.length === 20 ? `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}` : (n || '');
  };
  const br = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
  const hoje = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // fonte padrão do PDF não tem alguns símbolos: troca por equivalentes simples
  const limpo = (s) => String(s ?? '').replace(/[→–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\u0000-ÿ]/g, '');

  async function gerar(S, opcoes) {
    await carregar();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const ordemEtapa = Object.fromEntries(S.etapas.map((e, i) => [e.id, i]));
    const nomeEtapa = Object.fromEntries(S.etapas.map((e) => [e.id, e.nome]));
    const agora = new Date();
    const carimbo = `${br(hoje())} ${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    let titulo, head, body, colunas;

    if (opcoes.tipo === 'audiencias') {
      titulo = 'Agenda de audiências';
      const itens = [];
      for (const c of S.cartoes) for (const a of c.audiencias || []) if (a.data >= hoje()) itens.push({ c, a });
      itens.sort((x, y) => `${x.a.data}${x.a.hora || '99'}`.localeCompare(`${y.a.data}${y.a.hora || '99'}`));
      head = [['Data', 'Hora', 'Cliente', 'Tipo', 'Nº do processo', 'Vara / órgão', 'Telefone']];
      body = itens.map(({ c, a }) => [br(a.data), a.hora || '', c.cliente, a.tipo || 'Audiência', cnj(c.numero), c.orgao, c.telefone || '']);
      colunas = { 0: { cellWidth: 20 }, 1: { cellWidth: 13 }, 2: { cellWidth: 48, fontStyle: 'bold' }, 3: { cellWidth: 45 }, 4: { cellWidth: 44 }, 6: { cellWidth: 28 } };
    } else {
      let cs = S.cartoes.slice();
      if (opcoes.etapa) cs = cs.filter((c) => c.etapaId === opcoes.etapa);
      cs.sort((a, b) => (ordemEtapa[a.etapaId] - ordemEtapa[b.etapaId]) || a.cliente.localeCompare(b.cliente, 'pt-BR'));
      const variasEtapas = !opcoes.etapa;
      titulo = variasEtapas ? 'Processos por etapa' : `Processos - ${nomeEtapa[opcoes.etapa]}`;
      const cab = ['Cliente', 'Nº do processo', 'Vara / órgão', 'Classe', 'Na etapa desde', 'Próx. audiência', 'Honorários', 'Telefone'];
      if (variasEtapas) cab.unshift('Etapa');
      if (opcoes.notas) cab.push('Anotações');
      head = [cab];
      body = cs.map((c) => {
        const prox = (c.audiencias || []).find((a) => a.data >= hoje());
        const linha = [
          c.cliente, cnj(c.numero), c.orgao, c.classe, br(c.etapaDesde),
          prox ? `${br(prox.data)}${prox.hora ? ' ' + prox.hora : ''}` : (c.audPendente ? 'marcada, sem data' : ''),
          c.honorarios || '', c.telefone || ''
        ];
        if (variasEtapas) linha.unshift(nomeEtapa[c.etapaId] || '');
        if (opcoes.notas) linha.push((c.notas || '').slice(0, 400));
        return linha;
      });
      const o = variasEtapas ? 1 : 0;
      colunas = { [o]: { cellWidth: 40, fontStyle: 'bold' }, [o + 1]: { cellWidth: 41 }, [o + 4]: { cellWidth: 19 }, [o + 5]: { cellWidth: 22 }, [o + 6]: { cellWidth: 20 }, [o + 7]: { cellWidth: 25 } };
      if (variasEtapas) colunas[0] = { cellWidth: 24 };
    }

    const sub = `${S.oab ? `OAB ${S.oab.numero}/${S.oab.uf} - ` : ''}${body.length} registro(s) - gerado em ${carimbo}`;
    doc.autoTable({
      head: head.map((r) => r.map(limpo)),
      body: body.length ? body.map((r) => r.map(limpo)) : [[{ content: 'Nenhum registro.', colSpan: head[0].length, styles: { halign: 'center' } }]],
      startY: 24,
      margin: { top: 24, left: 10, right: 10, bottom: 14 },
      theme: 'grid',
      rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.8, overflow: 'linebreak', valign: 'top', lineColor: [205, 205, 205], lineWidth: 0.2, textColor: [25, 25, 25] },
      headStyles: { fillColor: [29, 107, 87], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
      alternateRowStyles: { fillColor: [244, 246, 245] },
      columnStyles: colunas,
      didDrawPage: (d) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(25);
        doc.text(limpo(`Fluxo de Clientes - ${titulo}`), 10, 13);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(100);
        doc.text(limpo(sub), 10, 18.5);
        const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
        doc.text(`Página ${d.pageNumber}`, w - 10, h - 7, { align: 'right' });
      }
    });
    const nome = `${opcoes.tipo === 'audiencias' ? 'audiencias' : 'processos'}-${hoje()}.pdf`;
    doc.save(nome);
    return { nome, linhas: body.length };
  }

  window.ExportarPDF = { gerar, carregar };
})();
