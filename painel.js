/* Clinicar — painel.js (dono: casca · construído pela integração)
   Global "Painel". Contrato: docs/ESPEC.md §4.11 e §5.5. Rota: #/painel.
   Alertas (backup, LGPD, sincronização) · cartões do dia · sala de espera em 3 colunas com cronômetro ·
   próximos 7 dias · faltas e cancelamentos tardios do mês · receita do mês · aniversariantes · lembretes de amanhã.
   Atualiza a cada 30 s (cronômetros a cada 1 s) sem recarregar a tela. Nomes passam por CL.nomeExibido. */
(function () {
  'use strict';
  var U = CL.util;
  var e = function (s) { return U.esc(s); };
  var ATRASO_SALA_MIN = 20;
  var st = { el: null, timer30: null, timer1: null, unsubs: [], renderPendente: null };

  function hoje() { return U.hoje(); }
  function pac(id) { return id ? CL.get('pacientes', id) : undefined; }
  function prof(id) { return id ? CL.get('profissionais', id) : undefined; }
  function proc(id) { return id ? CL.get('procedimentos', id) : undefined; }
  function nomeProf(id) { var p = prof(id); return p ? p.nome : ''; }
  function nomePac(id) { var p = pac(id); return p ? CL.nomeExibido(p.nome) : '—'; }
  function profsAtivos() { return CL.col('profissionais').filter(function (p) { return p && p.ativo !== false; }); }
  function cancelado(s) { return s === 'cancelado' || s === 'cancelado_tarde' || s === 'cancelado_clinica'; }
  function consultasDe(data) { return CL.col('consultas').filter(function (c) { return c && c.data === data; }); }
  function instante(c) { var d = U.dataDe(c.data); if (!d) return 0; return d.getTime() + U.min(c.hora) * 60000; }
  function minutosDesde(ms) { return ms ? Math.max(0, Math.floor((Date.now() - ms) / 60000)) : 0; }
  function profDaSessao() { var s = CL.session; return (s && s.perfil === 'profissional' && s.profId && prof(s.profId)) ? s.profId : null; }
  function mesDe(ymd) { return String(ymd || hoje()).slice(0, 7); }
  function fimMes(mes) { var d = U.dataDe(mes + '-01'); d.setMonth(d.getMonth() + 1); d.setDate(0); return U.ymd(d); }
  function saudacao() { var h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; }
  function cron(min) { if (min < 60) return min + ' min'; var h = Math.floor(min / 60); return h + ' h ' + (min % 60 < 10 ? '0' : '') + (min % 60) + ' min'; }

  /* =================== API pura =================== */
  function kpis(data) {
    var r = { marcadas: 0, confirmadas: 0, chegaram: 0, emAtendimento: 0, finalizadas: 0, faltas: 0, cancelados: 0, encaixes: 0, total: 0 };
    consultasDe(data || hoje()).forEach(function (c) {
      r.total++;
      if (cancelado(c.status)) { r.cancelados++; return; }
      r.marcadas++;
      if (c.encaixe) r.encaixes++;
      if (c.status === 'confirmado') r.confirmadas++;
      else if (c.status === 'chegou') r.chegaram++;
      else if (c.status === 'em_atendimento') r.emAtendimento++;
      else if (c.status === 'finalizado') r.finalizadas++;
      else if (c.status === 'faltou') r.faltas++;
    });
    return r;
  }
  function salaEspera(data, profId) {
    data = data || hoje();
    var agora = Date.now();
    var r = { aguardando: [], naSala: [], emAtendimento: [] };
    consultasDe(data).forEach(function (c) {
      if (profId && c.profId !== profId) return;
      var p = pac(c.pacId);
      var base = { consultaId: c.id, pacId: c.pacId, nome: p ? p.nome : '', hora: c.hora, profId: c.profId, status: c.status, procId: c.procId, encaixe: !!c.encaixe, esperaMin: 0, atrasoMin: 0, desde: null };
      if (c.status === 'agendado' || c.status === 'confirmado') {
        var ini = instante(c);
        base.atrasoMin = agora > ini ? Math.floor((agora - ini) / 60000) : 0;
        r.aguardando.push(base);
      } else if (c.status === 'chegou') {
        base.desde = c.chegouEm || null;
        base.esperaMin = minutosDesde(c.chegouEm);
        base.alerta = base.esperaMin >= ATRASO_SALA_MIN;
        r.naSala.push(base);
      } else if (c.status === 'em_atendimento') {
        base.desde = c.inicioEm || null;
        base.esperaMin = minutosDesde(c.inicioEm);
        r.emAtendimento.push(base);
      }
    });
    var porHora = function (a, b) { return a.hora.localeCompare(b.hora); };
    r.aguardando.sort(porHora);
    r.naSala.sort(function (a, b) { return (a.desde || 0) - (b.desde || 0); });
    r.emAtendimento.sort(function (a, b) { return (a.desde || 0) - (b.desde || 0); });
    return r;
  }
  function aniversariantes(o) {
    o = o || {};
    var dias = Math.max(1, parseInt(o.dias, 10) || 7);
    var h = hoje(), limite = U.addDias(h, dias - 1);
    var anoHoje = parseInt(h.slice(0, 4), 10);
    var lista = [];
    CL.col('pacientes').forEach(function (p) {
      if (!p || p.ativo === false || !/^\d{4}-\d{2}-\d{2}$/.test(p.nasc || '')) return;
      var mmdd = p.nasc.slice(5);
      var nascAno = parseInt(p.nasc.slice(0, 4), 10);
      [anoHoje, anoHoje + 1].some(function (ano) {
        var data = ano + '-' + mmdd;
        if (mmdd === '02-29' && !U.dataDe(data)) data = ano + '-02-28';
        else if (mmdd === '02-29' && U.dataDe(data) && U.ymd(U.dataDe(data)) !== data) data = ano + '-02-28';
        if (data >= h && data <= limite) { lista.push({ pacId: p.id, data: data, idade: ano - nascAno, nome: p.nome, fone: p.fone || '', campanhas: !!(p.consentimentos && p.consentimentos.campanhas && p.consentimentos.campanhas.ativo) }); return true; }
        return false;
      });
    });
    return lista.sort(function (a, b) { return a.data.localeCompare(b.data) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
  }
  function alertas() {
    var lista = [];
    var status = (window.Backend && Backend.status) ? Backend.status() : { modo: 'local' };
    var meta = (window.Backend && Backend.meta) ? Backend.meta.get() : {};
    var temDados = CL.col('pacientes').length + CL.col('consultas').length > 0;
    if (status.modo === 'local' && temDados) {
      var dias = meta.ultimoExport ? Math.floor((Date.now() - meta.ultimoExport) / 86400000) : null;
      if (dias === null || dias >= 7) {
        lista.push({ tipo: 'backup', texto: dias === null ? 'Os dados ficam só neste navegador e ainda não foram exportados.' : 'Último backup há ' + dias + ' dias — exporte uma cópia.', acao: { rotulo: 'Exportar agora', fn: function () { if (window.Config) Config.exportarTudo(); } } });
      }
    }
    if (status.pendentes) lista.push({ tipo: 'sync', texto: 'Há alterações que não puderam ser gravadas. Exporte uma cópia por segurança.', acao: { rotulo: 'Ver estado', fn: function () { var b = document.getElementById('topo-sync'); if (b) b.click(); } } });
    if (window.Pacientes && Pacientes.lgpd && typeof Pacientes.lgpd.pedidosAbertos === 'function') {
      var pedidos = Pacientes.lgpd.pedidosAbertos();
      if (pedidos.length) {
        var restam = Math.ceil((pedidos[0].prazo - Date.now()) / 86400000);
        lista.push({ tipo: 'lgpd', texto: pedidos.length + (pedidos.length === 1 ? ' pedido LGPD aberto' : ' pedidos LGPD abertos') + ' · ' + (restam < 0 ? 'prazo vencido há ' + Math.abs(restam) + ' d' : restam === 0 ? 'vence hoje' : restam + ' d para responder'), pacId: pedidos[0].pacId, acao: { rotulo: 'Abrir', fn: function () { CL.route.go('#/pacientes/' + encodeURIComponent(pedidos[0].pacId) + '/privacidade'); } } });
      }
    }
    return lista;
  }

  /* =================== render =================== */
  function cartaoHtml(item, coluna) {
    var pr = proc(item.procId);
    var podeAbrirProntuario = CL.can('clinico');
    var muitosProfs = profsAtivos().length > 1 && !profDaSessao();
    var sub = [item.hora, muitosProfs ? nomeProf(item.profId) : '', pr ? pr.nome : ''].filter(Boolean).join(' · ');
    var tempo = '';
    if (coluna === 'aguardando' && item.atrasoMin > 0) tempo = '<span class="pn-tempo is-atraso"><i class="ti ti-alarm" aria-hidden="true"></i>atrasado ' + cron(item.atrasoMin) + '</span>';
    else if (coluna === 'naSala') tempo = '<span class="pn-tempo' + (item.alerta ? ' is-atraso' : '') + '"><i class="ti ti-hourglass" aria-hidden="true"></i>esperando <span class="pn-cron" data-desde="' + (item.desde || '') + '">' + cron(item.esperaMin) + '</span></span>';
    else if (coluna === 'emAtendimento') tempo = '<span class="pn-tempo"><i class="ti ti-stethoscope" aria-hidden="true"></i>há <span class="pn-cron" data-desde="' + (item.desde || '') + '">' + cron(item.esperaMin) + '</span></span>';
    var acoes = '';
    if (coluna === 'aguardando') {
      if (item.status === 'agendado') acoes += '<button type="button" class="btn btn-neutro btn-pequeno" data-acao="status" data-id="' + e(item.consultaId) + '" data-status="confirmado"><i class="ti ti-check" aria-hidden="true"></i>Confirmar</button>';
      acoes += '<button type="button" class="btn btn-primario btn-pequeno" data-acao="status" data-id="' + e(item.consultaId) + '" data-status="chegou"><i class="ti ti-door-enter" aria-hidden="true"></i>Chegou</button>';
    } else if (coluna === 'naSala') {
      acoes += '<button type="button" class="btn btn-primario btn-pequeno" data-acao="iniciar" data-id="' + e(item.consultaId) + '"' + (podeAbrirProntuario ? '' : ' disabled title="Só o profissional inicia o atendimento"') + '><i class="ti ti-player-play" aria-hidden="true"></i>Iniciar</button>';
    } else {
      if (podeAbrirProntuario) acoes += '<a class="btn btn-neutro btn-pequeno" href="#/atendimento/' + e(item.consultaId) + '"><i class="ti ti-notes" aria-hidden="true"></i>Abrir</a>';
      acoes += '<button type="button" class="btn btn-primario btn-pequeno" data-acao="status" data-id="' + e(item.consultaId) + '" data-status="finalizado"><i class="ti ti-circle-check" aria-hidden="true"></i>Finalizar</button>';
    }
    acoes += '<button type="button" class="btn btn-icone btn-fantasma" data-acao="consulta" data-id="' + e(item.consultaId) + '" aria-label="Ver consulta"><i class="ti ti-dots" aria-hidden="true"></i></button>';
    return '<div class="pn-cartao card' + (item.encaixe ? ' is-encaixe' : '') + '"><div class="pn-cartao-topo">' +
      (item.pacId ? '<a class="pn-nome nome-paciente" href="#/pacientes/' + e(item.pacId) + '">' + e(CL.nomeExibido(item.nome)) + '</a>' : '<span class="pn-nome texto-3">Sem paciente</span>') +
      CL.chipStatus(item.status) + '</div><div class="pn-cartao-sub texto-2">' + e(sub) + '</div>' + tempo + '<div class="linha-acoes pn-cartao-acoes">' + acoes + '</div></div>';
  }
  function colunaHtml(titulo, icone, itens, chave, extra) {
    return '<section class="pn-coluna" aria-label="' + e(titulo) + '"><header class="pn-coluna-cabeca"><i class="ti ' + icone + '" aria-hidden="true"></i><h3>' + e(titulo) + '</h3><span class="pn-contador">' + itens.length + '</span>' + (extra || '') + '</header>' +
      (itens.length ? '<div class="pn-coluna-corpo">' + itens.map(function (it) { return cartaoHtml(it, chave); }).join('') + '</div>' : '<p class="pn-coluna-vazia texto-3">' + (chave === 'aguardando' ? 'Ninguém a caminho.' : chave === 'naSala' ? 'Sala de espera vazia.' : 'Nenhum atendimento em curso.') + '</p>') + '</section>';
  }
  function kpiCardsHtml(k) {
    var itens = [['Marcadas', k.marcadas, 'ti-calendar'], ['Confirmadas', k.confirmadas, 'ti-check'], ['Chegaram', k.chegaram, 'ti-door-enter'], ['Em atendimento', k.emAtendimento, 'ti-stethoscope'], ['Finalizadas', k.finalizadas, 'ti-circle-check'], ['Faltas', k.faltas, 'ti-user-off'], ['Encaixes', k.encaixes, 'ti-arrows-diagonal']];
    return '<div class="pn-kpis">' + itens.map(function (it) { return '<div class="card kpi pn-kpi"><span class="kpi-numero">' + it[1] + '</span><span class="kpi-rotulo"><i class="ti ' + it[2] + '" aria-hidden="true"></i>' + e(it[0]) + '</span></div>'; }).join('') + '</div>';
  }
  function proximosHtml() {
    var h = hoje();
    var dias = [];
    for (var i = 1; i <= 7; i++) {
      var d = U.addDias(h, i);
      var cs = consultasDe(d).filter(function (c) { return !cancelado(c.status); });
      dias.push({ data: d, n: cs.length, conf: cs.filter(function (c) { return c.status !== 'agendado'; }).length });
    }
    var total = dias.reduce(function (s, x) { return s + x.n; }, 0);
    var html = '<div class="card pn-bloco"><div class="card-titulo"><i class="ti ti-calendar-due" aria-hidden="true"></i>Próximos 7 dias <span class="texto-3">· ' + total + '</span></div>';
    if (!total) html += '<p class="texto-3">Nenhuma consulta marcada para os próximos dias.</p>';
    else html += '<ul class="pn-proximos">' + dias.map(function (x) {
      return '<li><a href="#/agenda/dia/' + e(x.data) + '"><span class="pn-prox-dia">' + e(CL.fmt.diaSemana(x.data, true)) + ' <span class="tnum">' + e(CL.fmt.data(x.data).slice(0, 5)) + '</span></span><span class="pn-prox-barra" aria-hidden="true"><span style="width:' + (x.n ? Math.max(4, Math.round(x.n / Math.max.apply(null, dias.map(function (y) { return y.n; })) * 100)) : 0) + '%"></span></span><span class="pn-prox-n tnum">' + x.n + (x.n ? ' <small class="texto-3">' + x.conf + ' conf.</small>' : '') + '</span></a></li>';
    }).join('') + '</ul>';
    return html + '</div>';
  }
  function faltasHtml() {
    var mes = mesDe(hoje()), de = mes + '-01', ate = fimMes(mes);
    var lista = CL.col('consultas').filter(function (c) { return c && c.data >= de && c.data <= ate && (c.status === 'faltou' || c.status === 'cancelado_tarde'); }).sort(function (a, b) { return b.data.localeCompare(a.data) || b.hora.localeCompare(a.hora); });
    var faltas = lista.filter(function (c) { return c.status === 'faltou'; }).length;
    var html = '<div class="card pn-bloco"><div class="card-titulo"><i class="ti ti-user-off" aria-hidden="true"></i>Faltas e cancelamentos tardios do mês</div>' +
      '<div class="pn-duplo"><div><span class="kpi-numero">' + faltas + '</span><span class="kpi-rotulo">faltas</span></div><div><span class="kpi-numero">' + (lista.length - faltas) + '</span><span class="kpi-rotulo">cancelados tarde</span></div></div>';
    if (!lista.length) html += '<p class="texto-3">Nenhuma falta neste mês.</p>';
    else html += '<ul class="lista-simples pn-lista-curta">' + lista.slice(0, 5).map(function (c) {
      return '<li><span class="pn-cresce"><a class="nome-paciente" href="#/pacientes/' + e(c.pacId || '') + '/consultas">' + e(nomePac(c.pacId)) + '</a><br><small class="texto-3">' + e(CL.fmt.data(c.data) + ' ' + c.hora + ' · ' + nomeProf(c.profId)) + '</small></span>' + CL.chipStatus(c.status) + '</li>';
    }).join('') + '</ul>' + (lista.length > 5 ? '<p class="texto-3">e mais ' + (lista.length - 5) + '.</p>' : '');
    return html + '</div>';
  }
  function receitaHtml() {
    if (!CL.can('financeiro') || !window.Financeiro || typeof Financeiro.resumo !== 'function') return '';
    var mes = mesDe(hoje()), de = mes + '-01', ate = fimMes(mes);
    var r = Financeiro.resumo({ de: de, ate: ate });
    var tot = r.recebidoCent + r.pendenteCent;
    var pct = tot ? Math.round(r.recebidoCent / tot * 100) : 0;
    return '<div class="card pn-bloco"><div class="card-titulo"><i class="ti ti-cash" aria-hidden="true"></i>Receita do mês</div>' +
      '<div class="pn-duplo"><div><span class="kpi-numero tnum">' + e(CL.fmt.dinheiro(r.recebidoCent)) + '</span><span class="kpi-rotulo">recebido</span></div><div><span class="kpi-numero tnum">' + e(CL.fmt.dinheiro(r.pendenteCent)) + '</span><span class="kpi-rotulo">pendente</span></div></div>' +
      (tot ? '<div class="pn-barra" role="img" aria-label="' + pct + '% recebido"><span style="width:' + pct + '%"></span></div><p class="texto-3">' + pct + '% do previsto já recebido</p>' : '<p class="texto-3">Nenhum lançamento neste mês.</p>') +
      '<div class="linha-acoes"><a class="btn btn-neutro btn-pequeno" href="#/financeiro/extrato?de=' + e(de) + '&ate=' + e(ate) + '"><i class="ti ti-list" aria-hidden="true"></i>Extrato</a><a class="btn btn-fantasma btn-pequeno" href="#/financeiro/caixa/' + e(hoje()) + '">Caixa de hoje</a></div></div>';
  }
  function aniversariantesHtml() {
    var lista = aniversariantes({ dias: 7 });
    var html = '<div class="card pn-bloco"><div class="card-titulo"><i class="ti ti-cake" aria-hidden="true"></i>Aniversariantes da semana <span class="texto-3">· ' + lista.length + '</span></div>';
    if (!lista.length) html += '<p class="texto-3">Nenhum aniversário nos próximos 7 dias.</p>';
    else html += '<ul class="lista-simples pn-lista-curta">' + lista.slice(0, 12).map(function (a) {
      var fone = U.digits(a.fone);
      var wa = (a.campanhas && fone.length >= 10) ? '<button type="button" class="btn btn-icone btn-fantasma" data-acao="parabens" data-id="' + e(a.pacId) + '" aria-label="Enviar parabéns por WhatsApp" title="Enviar parabéns por WhatsApp"><i class="ti ti-brand-whatsapp" aria-hidden="true"></i></button>' : '';
      return '<li><span class="pn-cresce"><a class="nome-paciente" href="#/pacientes/' + e(a.pacId) + '">' + e(CL.nomeExibido(a.nome)) + '</a><br><small class="texto-3">' + e((a.data === hoje() ? 'hoje' : CL.fmt.diaSemana(a.data, true) + ' ' + CL.fmt.data(a.data).slice(0, 5)) + ' · ' + a.idade + ' anos') + '</small></span>' + wa + '</li>';
    }).join('') + '</ul>' + (lista.length > 12 ? '<p class="texto-3">e mais ' + (lista.length - 12) + '.</p>' : '');
    return html + '</div>';
  }
  function lembretesHtml() {
    var amanha = U.addDias(hoje(), 1);
    var todas = consultasDe(amanha).filter(function (c) { return !cancelado(c.status); });
    var confirmadas = todas.filter(function (c) { return c.status !== 'agendado' || c.confirmadoEm; }).length;
    var pendentes = (window.Agenda && typeof Agenda.lembretes === 'function') ? Agenda.lembretes(amanha).length : todas.length - confirmadas;
    return '<div class="card pn-bloco"><div class="card-titulo"><i class="ti ti-bell" aria-hidden="true"></i>Lembretes de amanhã</div>' +
      (todas.length ? '<p><strong class="tnum">' + confirmadas + ' de ' + todas.length + '</strong> confirmadas' + (pendentes ? ' · ' + pendentes + ' para lembrar' : '') + '</p>' : '<p class="texto-3">Nenhuma consulta amanhã.</p>') +
      '<div class="linha-acoes"><a class="btn btn-neutro btn-pequeno" href="#/agenda/lembretes/' + e(amanha) + '"><i class="ti ti-brand-whatsapp" aria-hidden="true"></i>Abrir lembretes</a></div></div>';
  }
  function alertasHtml() {
    var lista = alertas();
    if (!lista.length) return '';
    var icones = { backup: 'ti-download', lgpd: 'ti-shield-lock', sync: 'ti-cloud-off', quota: 'ti-database-off' };
    return '<div class="pn-alertas">' + lista.map(function (a, i) {
      return '<div class="aviso-inline' + (a.tipo === 'sync' ? ' is-erro' : '') + '" role="status"><i class="ti ' + (icones[a.tipo] || 'ti-alert-triangle') + '" aria-hidden="true"></i><span class="pn-cresce">' + e(a.texto) + '</span>' + (a.acao ? '<button type="button" class="btn btn-neutro btn-pequeno" data-acao="alerta" data-i="' + i + '">' + e(a.acao.rotulo) + '</button>' : '') + '</div>';
    }).join('') + '</div>';
  }
  var alertasAtuais = [];
  function render() {
    var el = st.el;
    if (!el) return;
    var h = hoje();
    var meu = profDaSessao();
    var k = kpis(h);
    var sala = salaEspera(h, meu);
    var temPac = CL.col('pacientes').length > 0;
    var temHoje = consultasDe(h).length > 0;
    alertasAtuais = alertas();
    var nome = CL.session ? U.primeiroNome(CL.session.nome) : '';
    var html = '<div class="tela pn"><div class="tela-cabeca"><div class="pn-saudacao"><h1>' + e(saudacao() + (nome ? ', ' + nome : '')) + '</h1><p class="texto-2">' + e(CL.fmt.dataExtenso(h)) + (meu ? ' · sua agenda' : '') + '</p></div>' +
      '<div class="linha-acoes"><a class="btn btn-neutro" href="#/agenda/dia/' + e(h) + '" aria-label="Agenda de hoje" title="Agenda de hoje"><i class="ti ti-calendar" aria-hidden="true"></i><span>Agenda de hoje</span></a>' +
      '<button type="button" class="btn btn-primario" data-acao="nova" aria-label="Nova consulta" title="Nova consulta"><i class="ti ti-plus" aria-hidden="true"></i><span>Nova consulta</span></button></div></div>' +
      alertasHtml() + kpiCardsHtml(k);
    if (!temHoje) {
      html += '<div class="card pn-vazio" data-vazio></div>';
    } else {
      var chamar = (meu && CL.can('clinico') && sala.naSala.length) ? '<button type="button" class="btn btn-primario btn-pequeno pn-chamar" data-acao="chamar"><i class="ti ti-player-play" aria-hidden="true"></i>Chamar próximo</button>' : '';
      html += '<h2 class="pn-secao"><i class="ti ti-armchair" aria-hidden="true"></i>Sala de espera</h2><div class="pn-sala">' +
        colunaHtml('Aguardando chegada', 'ti-clock', sala.aguardando, 'aguardando') +
        colunaHtml('Na sala', 'ti-armchair', sala.naSala, 'naSala', chamar) +
        colunaHtml('Em atendimento', 'ti-stethoscope', sala.emAtendimento, 'emAtendimento') + '</div>';
    }
    html += '<div class="pn-grade">' + proximosHtml() + faltasHtml() + receitaHtml() + aniversariantesHtml() + lembretesHtml() + '</div></div>';
    el.innerHTML = html;
    var vz = el.querySelector('[data-vazio]');
    if (vz) {
      if (!temPac) CL.ui.vazio(vz, { icone: 'ti-users', titulo: 'Comece cadastrando um paciente', texto: 'Depois marque a primeira consulta na agenda. O painel mostra o dia em tempo real.', acao: { rotulo: 'Novo paciente', icone: 'ti-user-plus', fn: function () { if (window.Pacientes) Pacientes.abrirForm(null, { aoSalvar: function (p) { Pacientes.abrirFicha(p.id); } }); } } });
      else CL.ui.vazio(vz, { icone: 'ti-calendar-off', titulo: 'Nenhuma consulta hoje', texto: 'Marque uma consulta na agenda — a sala de espera aparece aqui conforme os pacientes chegam.', acao: { rotulo: 'Nova consulta', icone: 'ti-plus', fn: novaConsulta } });
    }
  }
  function tick() {
    if (!st.el) return;
    Array.prototype.forEach.call(st.el.querySelectorAll('.pn-cron[data-desde]'), function (s) {
      var desde = parseInt(s.getAttribute('data-desde'), 10);
      if (!desde) return;
      var min = minutosDesde(desde);
      var txt = cron(min);
      if (s.textContent !== txt) s.textContent = txt;
      var wrap = s.closest('.pn-tempo');
      if (wrap && wrap.querySelector('.ti-hourglass')) wrap.classList.toggle('is-atraso', min >= ATRASO_SALA_MIN);
    });
  }
  function novaConsulta() {
    if (window.Agenda && typeof Agenda.abrirNova === 'function') { var d = Agenda.abrirNova({ data: hoje(), profId: profDaSessao() || undefined }); if (d) return; }
    CL.route.go('#/agenda/dia/' + hoje());
  }
  function mudarStatus(id, novo) {
    if (window.Agenda && typeof Agenda.mudarStatus === 'function') return Agenda.mudarStatus(id, novo, {});
    if (window.Atendimento && typeof Atendimento.mudarStatus === 'function') return Atendimento.mudarStatus(id, novo);
    CL.ui.toast('A agenda ainda não está disponível', { kind: 'aviso' });
    return Promise.resolve({ ok: false });
  }
  function parabens(pacId) {
    var p = pac(pacId);
    if (!p) return;
    var fone = U.digits(p.fone);
    if (fone.length < 10) { CL.ui.toast('Paciente sem telefone', { kind: 'aviso' }); return; }
    if (!(p.consentimentos && p.consentimentos.campanhas && p.consentimentos.campanhas.ativo)) { CL.ui.toast('Sem consentimento para mensagens de relacionamento', { kind: 'aviso' }); return; }
    if (fone.length <= 11) fone = '55' + fone;
    var cl = (CL.state.cfg.clinica || {}).nome || 'nossa equipe';
    var texto = 'Olá, ' + U.primeiroNome(p.nome) + '! ' + (cl === 'nossa equipe' ? 'Nossa equipe' : 'A equipe da ' + cl) + ' deseja um feliz aniversário e muita saúde!';
    var url = 'https://wa.me/' + fone + '?text=' + encodeURIComponent(texto);
    if (window.Pacientes && typeof Pacientes.registrarCompartilhamento === 'function') { try { Pacientes.registrarCompartilhamento(p.id, 'whatsapp', 'aniversário'); } catch (err) { console.error(err); } }
    window.open(url, '_blank', 'noopener');
  }
  function aoClicar(ev) {
    var b = ev.target.closest('[data-acao]');
    if (!b) return;
    var acao = b.getAttribute('data-acao'), id = b.getAttribute('data-id');
    if (acao === 'nova') novaConsulta();
    else if (acao === 'status') mudarStatus(id, b.getAttribute('data-status')).then(function () { agendarRender(); });
    else if (acao === 'iniciar') { if (window.Atendimento && typeof Atendimento.iniciar === 'function') Atendimento.iniciar(id); else CL.ui.toast('O atendimento ainda não está disponível', { kind: 'aviso' }); }
    else if (acao === 'chamar') {
      var sala = salaEspera(hoje(), profDaSessao());
      if (!sala.naSala.length) { CL.ui.toast('Ninguém na sala de espera', { kind: 'info' }); return; }
      if (window.Atendimento && typeof Atendimento.iniciar === 'function') Atendimento.iniciar(sala.naSala[0].consultaId);
    }
    else if (acao === 'consulta') { if (window.Agenda && typeof Agenda.abrirConsulta === 'function') Agenda.abrirConsulta(id); else CL.route.go('#/agenda/dia/' + hoje()); }
    else if (acao === 'parabens') parabens(id);
    else if (acao === 'alerta') { var a = alertasAtuais[+b.getAttribute('data-i')]; if (a && a.acao && typeof a.acao.fn === 'function') a.acao.fn(); }
  }
  function agendarRender() {
    if (!st.el) return;
    clearTimeout(st.renderPendente);
    st.renderPendente = setTimeout(function () { if (st.el && !CL.ui.aberto().modal) render(); }, 200);
  }

  var Painel = window.Painel = {
    mount: function (el) {
      st.el = el;
      el.addEventListener('click', aoClicar);
      render();
      st.timer30 = setInterval(function () { if (st.el && !CL.ui.aberto().modal && !CL.ui.aberto().drawer) render(); }, 30000);
      st.timer1 = setInterval(tick, 1000);
      st.unsubs.push(CL.on('change', function (info) { if (!info || ['consultas', 'pacientes', 'lancamentos', 'profissionais', '*'].indexOf(info.col) >= 0) agendarRender(); }));
      st.unsubs.push(CL.on('consulta:status', agendarRender));
      st.unsubs.push(CL.on('privacidade', agendarRender));
      st.unsubs.push(CL.on('sync', agendarRender));
    },
    unmount: function () {
      clearInterval(st.timer30); clearInterval(st.timer1); clearTimeout(st.renderPendente);
      st.unsubs.forEach(function (u) { try { u(); } catch (err) { /* já removido */ } });
      st.unsubs = [];
      if (st.el) st.el.removeEventListener('click', aoClicar);
      st.el = null;
    },
    kpis: kpis,
    salaEspera: salaEspera,
    aniversariantes: aniversariantes,
    alertas: alertas,
    atualizar: function () { render(); }
  };
  CL.route.register('painel', Painel);
})();
