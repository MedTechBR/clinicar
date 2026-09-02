/* Clinicar — financeiro.js (dono: casca · construído pela integração)
   Global "Financeiro". Contrato: docs/ESPEC.md §4.10 e §5.4.
   Rotas: #/financeiro (caixa de hoje) · #/financeiro/caixa/<data> ·
          #/financeiro/extrato?de=&ate=&prof=&forma=&conv=&status=&tipo=&pag= ·
          #/financeiro/mes/<AAAA-MM> · #/financeiro/repasse/<AAAA-MM>
   Dinheiro SEMPRE em centavos (valorCent/descontoCent); formatação só por CL.fmt.dinheiro.
   Escrita no estado só por CL.upsert / CL.patch. Sem alert/confirm/prompt. */
(function () {
  'use strict';
  var U = CL.util;
  var e = function (s) { return U.esc(s); };
  var FORMAS = [
    ['dinheiro', 'Dinheiro', 'ti-cash'], ['pix', 'PIX', 'ti-qrcode'], ['debito', 'Débito', 'ti-credit-card'],
    ['credito', 'Crédito', 'ti-credit-card'], ['convenio', 'Convênio', 'ti-building-hospital'], ['outro', 'Outro', 'ti-dots']
  ];
  var FORMA_ROTULO = {};
  FORMAS.forEach(function (f) { FORMA_ROTULO[f[0]] = f[1]; });
  var VISOES = ['caixa', 'extrato', 'mes', 'repasse'];
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var POR_PAGINA = 50;
  var st = { el: null, visao: 'caixa', data: null, mes: null, filtros: {}, pagina: 0, abertoProf: '', unsubs: [], renderPendente: null };

  /* =================== acesso =================== */
  function hoje() { return U.hoje(); }
  function pac(id) { return id ? CL.get('pacientes', id) : undefined; }
  function prof(id) { return id ? CL.get('profissionais', id) : undefined; }
  function proc(id) { return id ? CL.get('procedimentos', id) : undefined; }
  function conv(id) { return id ? CL.get('convenios', id) : undefined; }
  function nomeProf(id) { var p = prof(id); return p ? p.nome : ''; }
  function nomePac(id) { var p = pac(id); return p ? CL.nomeExibido(p.nome) : ''; }
  function profsAtivos() { return CL.col('profissionais').filter(function (p) { return p && p.ativo !== false; }); }
  function liquido(l) { return (parseInt(l.valorCent, 10) || 0) - (parseInt(l.descontoCent, 10) || 0); }
  function mesDe(ymd) { return String(ymd || hoje()).slice(0, 7); }
  function mesValido(m) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || '')); }
  function fimMes(mes) { var d = U.dataDe(mes + '-01'); d.setMonth(d.getMonth() + 1); d.setDate(0); return U.ymd(d); }
  function addMes(mes, n) { var d = U.dataDe(mes + '-01'); d.setMonth(d.getMonth() + n); return U.ymd(d).slice(0, 7); }
  function mesExtenso(mes) { var d = U.dataDe(mes + '-01'); return d ? MESES[d.getMonth()] + ' de ' + d.getFullYear() : mes; }
  function valorInput(cent) { return CL.fmt.dinheiro(cent).replace('R$ ', ''); }
  function horaDe(l) { var c = l.consultaId ? CL.get('consultas', l.consultaId) : null; return c ? c.hora : ''; }
  function descricaoDe(l) { return l.descricao || (proc(l.procId) || {}).nome || (l.tipo === 'despesa' ? 'Despesa' : 'Receita'); }
  function rotuloStatus(l) {
    if (l.status === 'cancelado') return 'Cancelado';
    if (l.tipo === 'despesa') return l.status === 'recebido' ? 'Pago' : 'A pagar';
    return l.status === 'recebido' ? 'Recebido' : 'Pendente';
  }
  function chipStatus(l) {
    var cls = l.status === 'recebido' ? 'chip-ok' : l.status === 'cancelado' ? '' : 'chip-aviso';
    var ic = l.status === 'recebido' ? 'ti-circle-check' : l.status === 'cancelado' ? 'ti-x' : 'ti-clock';
    return '<span class="chip ' + cls + '"><i class="ti ' + ic + '" aria-hidden="true"></i>' + e(rotuloStatus(l)) + '</span>';
  }
  function porData(a, b) { return (a.data < b.data ? -1 : a.data > b.data ? 1 : (a.createdAt || 0) - (b.createdAt || 0)); }
  function porDataDesc(a, b) { return -porData(a, b); }
  function podeFinanceiro() { return CL.can('financeiro'); }

  /* =================== normalização e operações (puras + upsert) =================== */
  function normalizar(d) {
    d = d || {};
    var tipo = d.tipo === 'despesa' ? 'despesa' : 'receita';
    var status = ['pendente', 'recebido', 'cancelado'].indexOf(d.status) >= 0 ? d.status : 'pendente';
    var out = {
      tipo: tipo, consultaId: d.consultaId || null, pacId: d.pacId || null, profId: d.profId || null, procId: d.procId || null,
      data: /^\d{4}-\d{2}-\d{2}$/.test(String(d.data || '')) ? String(d.data) : hoje(),
      descricao: String(d.descricao || '').trim(), valorCent: Math.max(0, Math.round(Number(d.valorCent) || 0)),
      descontoCent: Math.max(0, Math.round(Number(d.descontoCent) || 0)),
      forma: FORMA_ROTULO[d.forma] ? d.forma : '', parcelas: Math.max(1, Math.min(24, parseInt(d.parcelas, 10) || 1)),
      status: status, recebidoEm: status === 'recebido' ? (d.recebidoEm || Date.now()) : null,
      convenioId: d.convenioId || null, obs: String(d.obs || ''), cancelamento: d.cancelamento || null
    };
    if (d.id) out.id = d.id;
    if (d.createdAt) out.createdAt = d.createdAt;
    if (d.updatedAt) out.updatedAt = d.updatedAt;
    if (out.descontoCent > out.valorCent) out.descontoCent = out.valorCent;
    if (!out.descricao) out.descricao = (proc(out.procId) || {}).nome || (tipo === 'despesa' ? 'Despesa' : 'Receita');
    return out;
  }
  function filtrar(f) {
    f = f || {};
    return CL.col('lancamentos').filter(function (l) {
      if (!l) return false;
      if (f.de && l.data < f.de) return false;
      if (f.ate && l.data > f.ate) return false;
      if (f.profId && l.profId !== f.profId) return false;
      if (f.forma && l.forma !== f.forma) return false;
      if (f.convenioId && l.convenioId !== f.convenioId) return false;
      if (f.status && l.status !== f.status) return false;
      if (f.tipo && l.tipo !== f.tipo) return false;
      if (f.pacId && l.pacId !== f.pacId) return false;
      return true;
    });
  }

  /* Cria o lançamento pendente de uma consulta (idempotente). Sem valor no procedimento → null,
     salvo opts.mesmoSemValor (usado pela baixa manual). */
  function lancarDaConsulta(consultaId, opts) {
    opts = opts || {};
    var c = CL.get('consultas', consultaId);
    if (!c) return null;
    var existente = c.lancamentoId ? CL.get('lancamentos', c.lancamentoId) : null;
    if (existente && existente.status !== 'cancelado') return existente;
    existente = CL.col('lancamentos').filter(function (l) {
      return l && l.consultaId === c.id && l.tipo === 'receita' && l.status !== 'cancelado' && l.descricao !== 'Taxa de falta';
    })[0];
    if (existente) {
      if (c.lancamentoId !== existente.id) CL.patch('consultas', c.id, { lancamentoId: existente.id });
      return existente;
    }
    var pr = proc(c.procId), p = pac(c.pacId);
    var valor = opts.valorCent != null ? Math.round(Number(opts.valorCent) || 0) : (pr ? (parseInt(pr.valorCent, 10) || 0) : 0);
    if (!(valor > 0) && !opts.mesmoSemValor) return null;
    var l = CL.upsert('lancamentos', normalizar({
      tipo: 'receita', consultaId: c.id, pacId: c.pacId, profId: c.profId, procId: c.procId, data: c.data || hoje(),
      descricao: pr ? pr.nome : 'Consulta', valorCent: valor, descontoCent: 0, forma: '', parcelas: 1, status: 'pendente',
      convenioId: c.convenioId || (p && p.convenioId) || null
    }));
    CL.patch('consultas', c.id, { lancamentoId: l.id });
    return l;
  }
  function lancar(dados) {
    var n = normalizar(dados);
    var l = CL.upsert('lancamentos', n);
    if (l.consultaId) {
      var c = CL.get('consultas', l.consultaId);
      if (c && !c.lancamentoId && l.tipo === 'receita' && l.descricao !== 'Taxa de falta') CL.patch('consultas', c.id, { lancamentoId: l.id });
    }
    return l;
  }
  function atualizar(id, campos) {
    var l = CL.get('lancamentos', id);
    if (!l) return null;
    var n = normalizar(Object.assign({}, l, campos || {}, { id: l.id, createdAt: l.createdAt }));
    Object.keys(n).forEach(function (k) { l[k] = n[k]; });
    return CL.upsert('lancamentos', l);
  }
  function receber(id, campos) {
    campos = campos || {};
    var l = CL.get('lancamentos', id);
    if (!l || l.status === 'cancelado') return null;
    var r = atualizar(id, {
      valorCent: campos.valorCent != null ? campos.valorCent : l.valorCent,
      descontoCent: campos.descontoCent != null ? campos.descontoCent : l.descontoCent,
      forma: campos.forma || l.forma || 'outro', parcelas: campos.parcelas || l.parcelas || 1,
      data: campos.data || hoje(), status: 'recebido', recebidoEm: Date.now()
    });
    try { CL.audit('lancamento.receber', 'lancamentos', r.id, { pacId: r.pacId, valorCent: liquido(r), forma: r.forma }); } catch (err) { console.error(err); }
    CL.emit('lancamento:recebido', { id: r.id, valorCent: liquido(r), forma: r.forma });
    return r;
  }
  function cancelar(id, motivo) {
    var l = CL.get('lancamentos', id);
    if (!l) return null;
    if (l.status === 'cancelado') return l;
    l.status = 'cancelado';
    l.cancelamento = { em: Date.now(), motivo: String(motivo || ''), usuario: CL.session ? CL.session.nome : '' };
    CL.upsert('lancamentos', l);
    try { CL.audit('lancamento.cancelar', 'lancamentos', l.id, { pacId: l.pacId, motivo: l.cancelamento.motivo }); } catch (err) { console.error(err); }
    return l;
  }
  function reabrir(id) {
    var l = CL.get('lancamentos', id);
    if (!l || l.status !== 'recebido') return null;
    return atualizar(id, { status: 'pendente', recebidoEm: null });
  }

  function resumo(f) {
    var r = { recebidoCent: 0, pendenteCent: 0, despesasCent: 0, porForma: {}, porProf: {}, porProc: {}, qtd: 0, qtdRecebidos: 0, qtdPendentes: 0 };
    filtrar(f).forEach(function (l) {
      if (l.status === 'cancelado') return;
      var v = liquido(l);
      r.qtd++;
      if (l.tipo === 'despesa') { r.despesasCent += v; return; }
      if (l.status === 'recebido') {
        r.recebidoCent += v; r.qtdRecebidos++;
        var fk = l.forma || 'sem_forma'; r.porForma[fk] = (r.porForma[fk] || 0) + v;
        var pk = l.profId || 'sem_prof'; r.porProf[pk] = (r.porProf[pk] || 0) + v;
        var ck = l.procId || 'outros'; r.porProc[ck] = (r.porProc[ck] || 0) + v;
      } else { r.pendenteCent += v; r.qtdPendentes++; }
    });
    return r;
  }
  function caixaDia(data) {
    data = data || hoje();
    var rec = [], pend = [], desp = [], aberto = [];
    CL.col('lancamentos').forEach(function (l) {
      if (!l || l.status === 'cancelado') return;
      if (l.tipo === 'despesa') { if (l.data === data) desp.push(l); return; }
      if (l.data === data) { if (l.status === 'recebido') rec.push(l); else pend.push(l); }
      else if (l.status === 'pendente' && l.data < data) aberto.push(l);
    });
    var soma = function (arr) { return arr.reduce(function (s, l) { return s + liquido(l); }, 0); };
    var r = {
      data: data, recebimentos: rec.sort(porData), pendentes: pend.sort(porData), despesas: desp.sort(porData), emAberto: aberto.sort(porDataDesc),
      recebidoCent: soma(rec), pendenteCent: soma(pend), despesasCent: soma(desp), emAbertoCent: soma(aberto)
    };
    r.totalCent = r.recebidoCent;
    r.saldoCent = r.recebidoCent - r.despesasCent;
    return r;
  }
  function repasse(profId, de, ate) {
    var p = prof(profId);
    var regra = (p && p.repasse && typeof p.repasse === 'object') ? p.repasse : { modo: 'nenhum', valor: 0 };
    var itens = filtrar({ profId: profId, de: de, ate: ate, tipo: 'receita', status: 'recebido' }).sort(porData);
    var base = itens.reduce(function (s, l) { return s + liquido(l); }, 0);
    var valor = Number(regra.valor) || 0, rep = 0;
    if (regra.modo === 'pct') rep = Math.round(base * valor / 100);
    else if (regra.modo === 'fixo') rep = Math.round(valor) * itens.length;
    return { profId: profId, baseCent: base, repasseCent: rep, itens: itens, regra: regra, qtd: itens.length };
  }
  function extrato(pacId) { return filtrar({ pacId: pacId }).sort(porDataDesc); }
  function descricaoRegra(regra) {
    if (!regra || regra.modo === 'nenhum' || !regra.modo) return 'sem repasse configurado';
    if (regra.modo === 'pct') return (Number(regra.valor) || 0) + '% do recebido';
    return CL.fmt.dinheiro(regra.valor) + ' por atendimento recebido';
  }

  /* =================== modal de baixa =================== */
  function baixa(id, opts) {
    opts = opts || {};
    var l = CL.get('lancamentos', id);
    if (!l) { var c = CL.get('consultas', id); if (c) l = lancarDaConsulta(c.id, { mesmoSemValor: true }); }
    if (!l) { CL.ui.toast('Lançamento não encontrado', { kind: 'aviso' }); return null; }
    if (!podeFinanceiro()) { CL.ui.toast('Seu perfil não registra recebimentos', { kind: 'aviso' }); return null; }
    if (l.status === 'cancelado') { CL.ui.toast('Este lançamento está cancelado', { kind: 'aviso' }); return null; }
    if (l.status === 'recebido' && !opts.editar) { CL.ui.toast('Já recebido em ' + CL.fmt.data(l.data) + (l.forma ? ' por ' + FORMA_ROTULO[l.forma] : ''), { kind: 'info' }); return null; }
    var lid = l.id;
    var forma = l.forma || 'pix';
    var c = l.consultaId ? CL.get('consultas', l.consultaId) : null;
    var corpo = document.createElement('div');
    corpo.className = 'fin-baixa pilha';
    var quem = [nomePac(l.pacId), descricaoDe(l), c ? CL.fmt.data(c.data) + ' ' + c.hora : CL.fmt.data(l.data), nomeProf(l.profId)].filter(Boolean).join(' · ');
    corpo.innerHTML = '<p class="texto-2 fin-baixa-quem"></p>' +
      '<div class="campos"><div class="campo"><label for="fb-valor">Valor (R$)</label><input id="fb-valor" class="input tnum" type="text" inputmode="decimal" autocomplete="off" autofocus></div>' +
      '<div class="campo"><label for="fb-desc">Desconto (R$)</label><input id="fb-desc" class="input tnum" type="text" inputmode="decimal" autocomplete="off"></div></div>' +
      '<div class="campo"><span class="campo-rotulo" id="fb-forma-rotulo">Forma de pagamento</span><div class="fin-formas" role="group" aria-labelledby="fb-forma-rotulo">' +
      FORMAS.map(function (f) { return '<button type="button" class="fin-forma" data-forma="' + f[0] + '" aria-pressed="' + (f[0] === forma ? 'true' : 'false') + '"><i class="ti ' + f[2] + '" aria-hidden="true"></i><span>' + f[1] + '</span></button>'; }).join('') + '</div></div>' +
      '<div class="campos"><div class="campo" data-parcelas' + (forma === 'credito' ? '' : ' hidden') + '><label for="fb-parc">Parcelas</label><select id="fb-parc" class="select">' +
      [1, 2, 3, 4, 5, 6, 10, 12].map(function (n) { return '<option value="' + n + '"' + (n === (l.parcelas || 1) ? ' selected' : '') + '>' + n + 'x</option>'; }).join('') + '</select></div>' +
      '<div class="campo"><label for="fb-data">Data do recebimento</label><input id="fb-data" class="input" type="date" value="' + e(l.status === 'recebido' ? l.data : hoje()) + '"></div></div>' +
      '<div class="fin-baixa-total"><span>A receber</span><strong class="tnum" data-total></strong></div>';
    corpo.querySelector('.fin-baixa-quem').textContent = quem;
    var iValor = corpo.querySelector('#fb-valor'), iDesc = corpo.querySelector('#fb-desc');
    iValor.value = valorInput(l.valorCent); iDesc.value = valorInput(l.descontoCent || 0);
    function ler() {
      var v = Math.max(0, U.centavos(iValor.value)), d = Math.max(0, U.centavos(iDesc.value));
      if (d > v) d = v;
      return { valorCent: v, descontoCent: d, forma: forma, parcelas: parseInt(corpo.querySelector('#fb-parc').value, 10) || 1, data: corpo.querySelector('#fb-data').value || hoje() };
    }
    function total() { var r = ler(); corpo.querySelector('[data-total]').textContent = CL.fmt.dinheiro(r.valorCent - r.descontoCent); }
    corpo.addEventListener('input', total);
    corpo.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-forma]'); if (!b) return;
      forma = b.getAttribute('data-forma');
      Array.prototype.forEach.call(corpo.querySelectorAll('[data-forma]'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      corpo.querySelector('[data-parcelas]').hidden = forma !== 'credito';
      total();
    });
    total();
    var m = CL.ui.modal({
      titulo: l.status === 'recebido' ? 'Editar recebimento' : 'Receber',
      corpo: corpo,
      botoes: [
        { rotulo: 'Deixar pendente', tipo: 'neutro', acao: function () {
          var r = ler();
          atualizar(lid, { valorCent: r.valorCent, descontoCent: r.descontoCent, forma: forma, parcelas: r.parcelas, status: 'pendente', recebidoEm: null });
          CL.ui.toast('Lançamento fica pendente: ' + CL.fmt.dinheiro(r.valorCent - r.descontoCent), { kind: 'info' });
          if (typeof opts.aoFechar === 'function') opts.aoFechar({ recebido: false });
        } },
        { rotulo: 'Receber', tipo: 'primario', icone: 'ti-check', acao: function () {
          var r = ler();
          if (!(r.valorCent - r.descontoCent >= 0)) { CL.ui.toast('Confira o valor', { kind: 'aviso' }); return false; }
          var rec = receber(lid, r);
          if (!rec) return false;
          CL.ui.toast('Recebido ' + CL.fmt.dinheiro(liquido(rec)) + ' por ' + FORMA_ROTULO[rec.forma], { kind: 'ok', action: { rotulo: 'Ver caixa', fn: function () { CL.route.go('#/financeiro/caixa/' + rec.data); } } });
          if (typeof opts.aoReceber === 'function') opts.aoReceber(rec);
          if (typeof opts.aoFechar === 'function') opts.aoFechar({ recebido: true, lancamento: rec });
        } }
      ]
    });
    corpo.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target && ev.target.tagName === 'INPUT') { ev.preventDefault(); var bt = m.el.querySelector('.modal-rodape .btn-primario'); if (bt) bt.click(); }
    });
    return m;
  }

  /* =================== modal de lançamento avulso / edição =================== */
  function abrirLancamento(existente, o) {
    o = o || {};
    if (!podeFinanceiro()) { CL.ui.toast('Seu perfil não lança no financeiro', { kind: 'aviso' }); return null; }
    var l = existente ? CL.get('lancamentos', existente.id || existente) : null;
    var f = l ? Object.assign({}, l) : { tipo: o.tipo || 'receita', data: o.data || hoje(), profId: (CL.session && CL.session.profId) || (profsAtivos()[0] || {}).id || null, status: 'pendente', forma: '', valorCent: 0, descontoCent: 0, pacId: o.pacId || null, descricao: '' };
    var vinculado = !!(l && l.consultaId);
    var pacSel = pac(f.pacId);
    var corpo = document.createElement('form');
    corpo.className = 'fin-form pilha';
    corpo.setAttribute('novalidate', '');
    var profs = profsAtivos();
    corpo.innerHTML =
      (vinculado ? '<div class="aviso-inline is-info"><i class="ti ti-link" aria-hidden="true"></i><span>Lançamento ligado a uma consulta: paciente e procedimento vêm da agenda.</span></div>' :
        '<div class="segmentado" role="group" aria-label="Tipo"><button type="button" data-tipo="receita" aria-pressed="' + (f.tipo !== 'despesa') + '">Receita</button><button type="button" data-tipo="despesa" aria-pressed="' + (f.tipo === 'despesa') + '">Despesa</button></div>') +
      '<div class="campo"><label for="fl-desc">Descrição</label><input id="fl-desc" class="input" type="text" maxlength="120" autocomplete="off" required autofocus></div>' +
      '<div class="campos"><div class="campo"><label for="fl-valor">Valor (R$)</label><input id="fl-valor" class="input tnum" type="text" inputmode="decimal" autocomplete="off"></div>' +
      '<div class="campo"><label for="fl-desconto">Desconto (R$)</label><input id="fl-desconto" class="input tnum" type="text" inputmode="decimal" autocomplete="off"></div>' +
      '<div class="campo"><label for="fl-data">Data</label><input id="fl-data" class="input" type="date"></div></div>' +
      '<div class="campos"><div class="campo"><label for="fl-forma">Forma</label><select id="fl-forma" class="select"><option value="">— sem forma —</option>' +
      FORMAS.map(function (x) { return '<option value="' + x[0] + '">' + x[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="campo"><label for="fl-prof">Profissional</label><select id="fl-prof" class="select"><option value="">— nenhum —</option>' +
      profs.map(function (p) { return '<option value="' + e(p.id) + '">' + e(p.nome) + '</option>'; }).join('') + '</select></div></div>' +
      (vinculado ? '' : '<div class="campo" data-pac-campo' + (f.tipo === 'despesa' ? ' hidden' : '') + '><label for="fl-pac">Paciente (opcional)</label>' +
        '<div class="fin-pac-sel" data-pac-sel' + (pacSel ? '' : ' hidden') + '><span class="chip chip-acento"><i class="ti ti-user" aria-hidden="true"></i><span data-pac-nome></span></span><button type="button" class="btn btn-fantasma btn-pequeno" data-acao="pac-limpar"><i class="ti ti-x" aria-hidden="true"></i>Trocar</button></div>' +
        '<div class="busca" data-pac-busca' + (pacSel ? ' hidden' : '') + '><i class="ti ti-search" aria-hidden="true"></i><input id="fl-pac" class="input" type="text" placeholder="Nome, CPF ou telefone"></div><div class="fin-pac-lista" data-pac-lista></div></div>') +
      '<div class="campo-linha"><input id="fl-pago" type="checkbox"><label for="fl-pago" data-pago-rotulo></label></div>' +
      '<div class="campo"><label for="fl-obs">Observação</label><textarea id="fl-obs" class="textarea" rows="2"></textarea></div>';
    var g = function (id) { return corpo.querySelector('#' + id); };
    g('fl-desc').value = f.descricao || '';
    g('fl-valor').value = valorInput(f.valorCent || 0);
    g('fl-desconto').value = valorInput(f.descontoCent || 0);
    g('fl-data').value = f.data || hoje();
    g('fl-forma').value = f.forma || '';
    g('fl-prof').value = f.profId || '';
    g('fl-pago').checked = f.status === 'recebido';
    g('fl-obs').value = f.obs || '';
    var tipo = f.tipo === 'despesa' ? 'despesa' : 'receita';
    var pacId = f.pacId || null;
    function rotuloPago() { g('fl-pago').nextElementSibling.textContent = tipo === 'despesa' ? 'Já pago' : 'Já recebido'; }
    rotuloPago();
    if (pacSel) corpo.querySelector('[data-pac-nome]').textContent = CL.nomeExibido(pacSel.nome);
    var busca = g('fl-pac');
    if (busca) {
      U.semAutofill(busca);
      var lista = corpo.querySelector('[data-pac-lista]');
      var buscar = U.debounce(function () {
        var q = U.valorBusca(busca).trim();
        lista.innerHTML = '';
        if (!q || !window.Pacientes) return;
        var achados = Pacientes.buscar(q, { limite: 6 });
        if (!achados.length) { lista.innerHTML = '<div class="fin-pac-vazio texto-3">Nenhum paciente encontrado</div>'; return; }
        lista.innerHTML = achados.map(function (p) { return '<button type="button" class="fin-pac-item" data-pac-id="' + e(p.id) + '"><strong></strong><small class="texto-3">' + e([CL.fmt.idade(p.nasc), p.fone ? CL.fmt.fone(p.fone) : ''].filter(Boolean).join(' · ')) + '</small></button>'; }).join('');
        Array.prototype.forEach.call(lista.querySelectorAll('[data-pac-id]'), function (b, i) { b.querySelector('strong').textContent = CL.nomeExibido(achados[i].nome); });
      }, 150);
      busca.addEventListener('input', buscar);
    }
    corpo.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-tipo]');
      if (t) {
        tipo = t.getAttribute('data-tipo');
        Array.prototype.forEach.call(corpo.querySelectorAll('[data-tipo]'), function (x) { x.setAttribute('aria-pressed', x === t ? 'true' : 'false'); });
        var pc = corpo.querySelector('[data-pac-campo]'); if (pc) pc.hidden = tipo === 'despesa';
        rotuloPago();
        return;
      }
      var pi = ev.target.closest('[data-pac-id]');
      if (pi) {
        pacId = pi.getAttribute('data-pac-id');
        var p = pac(pacId);
        corpo.querySelector('[data-pac-nome]').textContent = p ? CL.nomeExibido(p.nome) : '';
        corpo.querySelector('[data-pac-sel]').hidden = false;
        corpo.querySelector('[data-pac-busca]').hidden = true;
        corpo.querySelector('[data-pac-lista]').innerHTML = '';
        return;
      }
      var pl = ev.target.closest('[data-acao="pac-limpar"]');
      if (pl) {
        pacId = null;
        corpo.querySelector('[data-pac-sel]').hidden = true;
        corpo.querySelector('[data-pac-busca]').hidden = false;
        busca.value = ''; busca.focus();
      }
    });
    function coletar() {
      var p = pac(pacId);
      var dados = {
        tipo: tipo, descricao: g('fl-desc').value.trim(), valorCent: Math.max(0, U.centavos(g('fl-valor').value)), descontoCent: Math.max(0, U.centavos(g('fl-desconto').value)),
        data: g('fl-data').value || hoje(), forma: g('fl-forma').value, profId: g('fl-prof').value || null, obs: g('fl-obs').value.trim(),
        status: g('fl-pago').checked ? 'recebido' : 'pendente'
      };
      if (!vinculado) { dados.pacId = tipo === 'despesa' ? null : pacId; dados.convenioId = (tipo !== 'despesa' && p) ? (p.convenioId || null) : null; }
      return dados;
    }
    function salvar() {
      var d = coletar();
      if (!d.descricao) { CL.ui.toast('Dê uma descrição ao lançamento', { kind: 'aviso' }); g('fl-desc').focus(); return false; }
      if (!(d.valorCent > 0)) { CL.ui.toast('Informe o valor', { kind: 'aviso' }); g('fl-valor').focus(); return false; }
      if (d.status === 'recebido' && !d.forma) { CL.ui.toast('Escolha a forma de pagamento', { kind: 'aviso' }); g('fl-forma').focus(); return false; }
      var salvo;
      if (l) {
        if (d.status === 'recebido' && l.status !== 'recebido') { atualizar(l.id, d); salvo = receber(l.id, { valorCent: d.valorCent, descontoCent: d.descontoCent, forma: d.forma, parcelas: l.parcelas, data: d.data }); }
        else salvo = atualizar(l.id, Object.assign(d, { recebidoEm: d.status === 'recebido' ? (l.recebidoEm || Date.now()) : null }));
      } else salvo = lancar(d);
      CL.ui.toast((l ? 'Lançamento atualizado' : 'Lançamento criado') + ': ' + CL.fmt.dinheiro(liquido(salvo)), { kind: 'ok' });
      if (typeof o.aoSalvar === 'function') o.aoSalvar(salvo);
      return true;
    }
    var m = CL.ui.modal({
      titulo: l ? 'Editar lançamento' : 'Lançamento avulso', corpo: corpo,
      botoes: [{ rotulo: 'Cancelar', tipo: 'neutro' }, { rotulo: 'Salvar', tipo: 'primario', icone: 'ti-device-floppy', acao: function () { return salvar(); } }]
    });
    corpo.addEventListener('submit', function (ev) { ev.preventDefault(); if (salvar()) m.fechar({ motivo: 'enter' }); });
    return m;
  }
  function pedirCancelamento(id) {
    var l = CL.get('lancamentos', id);
    if (!l) return;
    CL.ui.pedirTexto({ titulo: 'Cancelar lançamento', rotulo: 'Motivo (opcional)', placeholder: 'Ex.: lançado em duplicidade', ok: 'Cancelar lançamento' }).then(function (motivo) {
      if (motivo === null) return;
      cancelar(id, motivo);
      CL.ui.toast('Lançamento cancelado', { kind: 'ok' });
    });
  }

  /* =================== telas =================== */
  function linhaHtml(l, o) {
    o = o || {};
    var p = pac(l.pacId);
    var acoes = '';
    if (l.status === 'pendente') acoes += '<button type="button" class="btn btn-primario btn-pequeno" data-acao="receber" data-id="' + e(l.id) + '"><i class="ti ti-check" aria-hidden="true"></i>' + (l.tipo === 'despesa' ? 'Pagar' : 'Receber') + '</button>';
    acoes += '<button type="button" class="btn btn-icone btn-fantasma" data-acao="menu" data-id="' + e(l.id) + '" aria-label="Mais ações"><i class="ti ti-dots" aria-hidden="true"></i></button>';
    var hora = horaDe(l);
    return '<tr' + (l.status === 'cancelado' ? ' class="is-cancelado"' : '') + '>' +
      (o.data ? '<td data-rotulo="Data" class="tnum">' + e(CL.fmt.data(l.data)) + '</td>' : '<td data-rotulo="Hora" class="tnum">' + e(hora || '—') + '</td>') +
      '<td data-rotulo="Paciente">' + (p ? '<a href="#/pacientes/' + e(p.id) + '/financeiro" class="nome-paciente">' + e(CL.nomeExibido(p.nome)) + '</a>' : '<span class="texto-3">—</span>') + '</td>' +
      '<td data-rotulo="Profissional">' + e(nomeProf(l.profId) || '—') + '</td>' +
      '<td data-rotulo="Descrição">' + (l.tipo === 'despesa' ? '<span class="chip">despesa</span> ' : '') + e(descricaoDe(l)) + (l.descontoCent ? ' <small class="texto-3">(desc. ' + e(CL.fmt.dinheiro(l.descontoCent)) + ')</small>' : '') + '</td>' +
      '<td data-rotulo="Forma">' + e(FORMA_ROTULO[l.forma] || '—') + (l.forma === 'credito' && l.parcelas > 1 ? ' ' + l.parcelas + 'x' : '') + '</td>' +
      '<td data-rotulo="Valor" class="num tnum">' + (l.tipo === 'despesa' ? '−' : '') + e(CL.fmt.dinheiro(liquido(l))) + '</td>' +
      '<td data-rotulo="Status">' + chipStatus(l) + '</td>' +
      '<td class="acoes"><div class="linha-acoes fin-acoes">' + acoes + '</div></td></tr>';
  }
  function tabelaHtml(lista, o) {
    o = o || {};
    if (!lista.length) return '';
    return '<div class="tabela-wrap tabela-cartoes"><table class="tabela fin-tabela"><thead><tr><th>' + (o.data ? 'Data' : 'Hora') + '</th><th>Paciente</th><th>Profissional</th><th>Descrição</th><th>Forma</th><th class="num">Valor</th><th>Status</th><th class="acoes"><span class="sr-only">Ações</span></th></tr></thead><tbody>' +
      lista.map(function (l) { return linhaHtml(l, o); }).join('') + '</tbody></table></div>';
  }
  function kpiHtml(itens) {
    return '<div class="grade-cards fin-kpis">' + itens.map(function (k) {
      return '<div class="card kpi' + (k.classe ? ' ' + k.classe : '') + '"><span class="kpi-numero">' + e(CL.fmt.dinheiro(k.valor)) + '</span><span class="kpi-rotulo">' + e(k.rotulo) + (k.sub ? ' <small class="texto-3">· ' + e(k.sub) + '</small>' : '') + '</span></div>';
    }).join('') + '</div>';
  }

  function renderCaixa(box) {
    var data = st.data || hoje();
    var cx = caixaDia(data);
    var doDia = cx.recebimentos.concat(cx.pendentes, cx.despesas).sort(function (a, b) { return (horaDe(a) || '99').localeCompare(horaDe(b) || '99') || (a.createdAt || 0) - (b.createdAt || 0); });
    var html = '<div class="fin-nav"><div class="linha-acoes">' +
      '<button type="button" class="btn btn-icone btn-neutro" data-acao="dia-ant" aria-label="Dia anterior"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>' +
      '<button type="button" class="btn btn-neutro" data-acao="dia-hoje">Hoje</button>' +
      '<button type="button" class="btn btn-icone btn-neutro" data-acao="dia-prox" aria-label="Dia seguinte"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>' +
      '<label class="sr-only" for="fin-data">Data</label><input id="fin-data" class="input fin-data" type="date" value="' + e(data) + '"></div>' +
      '<h2 class="fin-titulo-dia">' + e(CL.fmt.dataExtenso(data)) + '</h2></div>' +
      kpiHtml([
        { rotulo: 'Recebido', valor: cx.recebidoCent, sub: cx.recebimentos.length + (cx.recebimentos.length === 1 ? ' lançamento' : ' lançamentos'), classe: 'is-ok' },
        { rotulo: 'Pendente', valor: cx.pendenteCent, sub: cx.pendentes.length ? cx.pendentes.length + ' no dia' : '', classe: 'is-aviso' },
        { rotulo: 'Despesas', valor: cx.despesasCent },
        { rotulo: 'Saldo do dia', valor: cx.saldoCent, classe: cx.saldoCent < 0 ? 'is-erro' : '' }
      ]);
    if (!doDia.length) {
      html += '<div class="card fin-vazio" data-vazio-dia></div>';
    } else {
      html += '<h3 class="fin-secao">Lançamentos do dia <span class="texto-3">(' + doDia.length + ')</span></h3>' + tabelaHtml(doDia);
    }
    var aberto = cx.emAberto;
    if (st.abertoProf) aberto = aberto.filter(function (l) { return l.profId === st.abertoProf; });
    html += '<div class="fin-aberto"><div class="fin-secao-linha"><h3 class="fin-secao">Em aberto de dias anteriores <span class="texto-3">(' + cx.emAberto.length + ' · ' + e(CL.fmt.dinheiro(cx.emAbertoCent)) + ')</span></h3>' +
      (cx.emAberto.length ? '<label class="sr-only" for="fin-aberto-prof">Profissional</label><select id="fin-aberto-prof" class="select fin-select-curto"><option value="">Todos os profissionais</option>' +
        profsAtivos().map(function (p) { return '<option value="' + e(p.id) + '"' + (st.abertoProf === p.id ? ' selected' : '') + '>' + e(p.nome) + '</option>'; }).join('') + '</select>' : '') + '</div>';
    if (!cx.emAberto.length) html += '<p class="texto-3 fin-nada">Nenhuma pendência antiga.</p>';
    else if (!aberto.length) html += '<p class="texto-3 fin-nada">Nenhuma pendência deste profissional.</p>';
    else html += tabelaHtml(aberto.slice(0, 100), { data: true }) + (aberto.length > 100 ? '<p class="texto-3 fin-nada">Mostrando as 100 mais recentes — use o extrato para ver todas.</p>' : '');
    html += '</div>';
    box.innerHTML = html;
    var vz = box.querySelector('[data-vazio-dia]');
    if (vz) CL.ui.vazio(vz, { icone: 'ti-cash-off', titulo: 'Nenhum lançamento neste dia', texto: 'Os lançamentos nascem ao finalizar uma consulta com valor. Você também pode lançar uma receita ou despesa avulsa.', acao: { rotulo: 'Lançamento avulso', icone: 'ti-plus', fn: function () { abrirLancamento(null, { data: data }); } } });
  }

  function filtrosDe(q) {
    q = q || {};
    var f = { de: q.de || '', ate: q.ate || '', profId: q.prof || '', forma: q.forma || '', convenioId: q.conv || '', status: q.status || '', tipo: q.tipo || '' };
    if (!f.de && !f.ate) { f.de = mesDe(hoje()) + '-01'; f.ate = fimMes(mesDe(hoje())); }
    return f;
  }
  function hashExtrato(f, pag) {
    var partes = [];
    if (f.de) partes.push('de=' + f.de);
    if (f.ate) partes.push('ate=' + f.ate);
    if (f.profId) partes.push('prof=' + encodeURIComponent(f.profId));
    if (f.forma) partes.push('forma=' + f.forma);
    if (f.convenioId) partes.push('conv=' + encodeURIComponent(f.convenioId));
    if (f.status) partes.push('status=' + f.status);
    if (f.tipo) partes.push('tipo=' + f.tipo);
    if (pag > 0) partes.push('pag=' + pag);
    return '#/financeiro/extrato' + (partes.length ? '?' + partes.join('&') : '');
  }
  function renderExtrato(box) {
    var f = st.filtros;
    var lista = filtrar(f).sort(porDataDesc);
    var r = resumo(f);
    var total = lista.length, pags = Math.max(1, Math.ceil(total / POR_PAGINA));
    if (st.pagina >= pags) st.pagina = pags - 1;
    var ini = st.pagina * POR_PAGINA, fim = Math.min(total, ini + POR_PAGINA);
    var opt = function (v, rot, sel) { return '<option value="' + e(v) + '"' + (sel === v ? ' selected' : '') + '>' + e(rot) + '</option>'; };
    var html = '<form class="card fin-filtros" data-form="filtros" novalidate>' +
      '<div class="linha-acoes fin-atalhos" role="group" aria-label="Período"><button type="button" class="btn btn-neutro btn-pequeno" data-periodo="hoje">Hoje</button><button type="button" class="btn btn-neutro btn-pequeno" data-periodo="semana">Semana</button><button type="button" class="btn btn-neutro btn-pequeno" data-periodo="mes">Mês</button><button type="button" class="btn btn-neutro btn-pequeno" data-periodo="mes-ant">Mês anterior</button></div>' +
      '<div class="campos fin-filtros-campos">' +
      '<div class="campo"><label for="fx-de">De</label><input id="fx-de" class="input" type="date" name="de" value="' + e(f.de) + '"></div>' +
      '<div class="campo"><label for="fx-ate">Até</label><input id="fx-ate" class="input" type="date" name="ate" value="' + e(f.ate) + '"></div>' +
      '<div class="campo"><label for="fx-prof">Profissional</label><select id="fx-prof" class="select" name="prof">' + opt('', 'Todos', f.profId) + profsAtivos().map(function (p) { return opt(p.id, p.nome, f.profId); }).join('') + '</select></div>' +
      '<div class="campo"><label for="fx-forma">Forma</label><select id="fx-forma" class="select" name="forma">' + opt('', 'Todas', f.forma) + FORMAS.map(function (x) { return opt(x[0], x[1], f.forma); }).join('') + '</select></div>' +
      '<div class="campo"><label for="fx-conv">Convênio</label><select id="fx-conv" class="select" name="conv">' + opt('', 'Todos', f.convenioId) + CL.col('convenios').filter(function (c) { return c && c.ativo !== false; }).map(function (c) { return opt(c.id, c.nome, f.convenioId); }).join('') + '</select></div>' +
      '<div class="campo"><label for="fx-status">Status</label><select id="fx-status" class="select" name="status">' + opt('', 'Todos', f.status) + opt('pendente', 'Pendente', f.status) + opt('recebido', 'Recebido / pago', f.status) + opt('cancelado', 'Cancelado', f.status) + '</select></div>' +
      '<div class="campo"><label for="fx-tipo">Tipo</label><select id="fx-tipo" class="select" name="tipo">' + opt('', 'Receitas e despesas', f.tipo) + opt('receita', 'Só receitas', f.tipo) + opt('despesa', 'Só despesas', f.tipo) + '</select></div>' +
      '</div><div class="linha-acoes"><button type="submit" class="btn btn-primario"><i class="ti ti-filter" aria-hidden="true"></i>Filtrar</button>' +
      '<button type="button" class="btn btn-neutro" data-acao="csv"' + (total ? '' : ' disabled') + '><i class="ti ti-file-spreadsheet" aria-hidden="true"></i>Exportar CSV</button></div></form>' +
      kpiHtml([
        { rotulo: 'Recebido', valor: r.recebidoCent, sub: r.qtdRecebidos + ' lanç.', classe: 'is-ok' },
        { rotulo: 'Pendente', valor: r.pendenteCent, sub: r.qtdPendentes + ' lanç.', classe: 'is-aviso' },
        { rotulo: 'Despesas', valor: r.despesasCent },
        { rotulo: 'Resultado', valor: r.recebidoCent - r.despesasCent, classe: (r.recebidoCent - r.despesasCent) < 0 ? 'is-erro' : '' }
      ]);
    if (!total) {
      html += '<div class="card" data-vazio-extrato></div>';
    } else {
      html += '<div class="fin-totais"><div class="card"><div class="card-titulo"><i class="ti ti-wallet" aria-hidden="true"></i>Por forma</div>' + listaTotais(r.porForma, function (k) { return FORMA_ROTULO[k] || (k === 'sem_forma' ? 'Sem forma' : k); }) + '</div>' +
        '<div class="card"><div class="card-titulo"><i class="ti ti-user-heart" aria-hidden="true"></i>Por profissional</div>' + listaTotais(r.porProf, function (k) { return nomeProf(k) || (k === 'sem_prof' ? 'Sem profissional' : k); }) + '</div></div>' +
        '<div class="fin-secao-linha"><h3 class="fin-secao">Lançamentos <span class="texto-3">(' + (ini + 1) + '–' + fim + ' de ' + total + ')</span></h3>' +
        (pags > 1 ? '<div class="linha-acoes"><button type="button" class="btn btn-neutro btn-pequeno" data-acao="pag-ant"' + (st.pagina === 0 ? ' disabled' : '') + '>Anterior</button><span class="texto-2 tnum">' + (st.pagina + 1) + ' / ' + pags + '</span><button type="button" class="btn btn-neutro btn-pequeno" data-acao="pag-prox"' + (st.pagina >= pags - 1 ? ' disabled' : '') + '>Próxima</button></div>' : '') + '</div>' +
        tabelaHtml(lista.slice(ini, fim), { data: true });
    }
    box.innerHTML = html;
    var vz = box.querySelector('[data-vazio-extrato]');
    if (vz) CL.ui.vazio(vz, { icone: 'ti-receipt-off', titulo: 'Nada neste período', texto: 'Amplie o período ou limpe os filtros.', acao: { rotulo: 'Ver este mês', icone: 'ti-calendar', fn: function () { st.pagina = 0; CL.route.go(hashExtrato({ de: mesDe(hoje()) + '-01', ate: fimMes(mesDe(hoje())) }, 0)); } } });
  }
  function listaTotais(mapa, rotulo) {
    var chaves = Object.keys(mapa).sort(function (a, b) { return mapa[b] - mapa[a]; });
    if (!chaves.length) return '<p class="texto-3">Nenhum recebimento.</p>';
    var max = mapa[chaves[0]] || 1;
    return '<ul class="fin-lista-totais">' + chaves.map(function (k) {
      var pct = Math.max(2, Math.round(mapa[k] / max * 100));
      return '<li><span class="fin-tot-rotulo">' + e(rotulo(k)) + '</span><span class="fin-tot-barra" aria-hidden="true"><span class="fin-tot-fill" style="width:' + pct + '%"></span></span><span class="tnum fin-tot-valor">' + e(CL.fmt.dinheiro(mapa[k])) + '</span></li>';
    }).join('') + '</ul>';
  }
  function exportarCsv() {
    var f = st.filtros;
    var lista = filtrar(f).sort(porData);
    var cab = ['data', 'tipo', 'descricao', 'paciente', 'profissional', 'procedimento', 'convenio', 'forma', 'parcelas', 'valor', 'desconto', 'liquido', 'status', 'consulta', 'observacao'];
    var cel = function (v) { v = String(v == null ? '' : v); return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var linhas = [cab.join(';')];
    lista.forEach(function (l) {
      var p = pac(l.pacId);
      linhas.push([CL.fmt.data(l.data), l.tipo, descricaoDe(l), p ? CL.nomeExibido(p.nome) : '', nomeProf(l.profId), (proc(l.procId) || {}).nome || '', (conv(l.convenioId) || {}).nome || '',
        FORMA_ROTULO[l.forma] || '', l.parcelas || 1, valorInput(l.valorCent), valorInput(l.descontoCent || 0), valorInput(liquido(l)), rotuloStatus(l), l.consultaId || '', l.obs || ''].map(cel).join(';'));
    });
    U.baixar('clinicar-extrato-' + (f.de || 'inicio') + '-a-' + (f.ate || 'hoje') + '.csv', '\ufeff' + linhas.join('\r\n'), 'text/csv;charset=utf-8');
    try { CL.audit('dados.exportar', 'lancamentos', null, { formato: 'csv', qtd: lista.length }); } catch (err) { console.error(err); }
    CL.ui.toast('Extrato exportado (' + lista.length + ' linhas)', { kind: 'ok' });
  }

  function renderMes(box) {
    var mes = st.mes || mesDe(hoje());
    var de = mes + '-01', ate = fimMes(mes);
    var r = resumo({ de: de, ate: ate });
    var semanas = [[1, 7], [8, 14], [15, 21], [22, 28], [29, 31]];
    var porSemana = semanas.map(function () { return 0; });
    filtrar({ de: de, ate: ate, tipo: 'receita', status: 'recebido' }).forEach(function (l) {
      var dia = parseInt(l.data.slice(8, 10), 10);
      for (var i = 0; i < semanas.length; i++) if (dia >= semanas[i][0] && dia <= semanas[i][1]) { porSemana[i] += liquido(l); break; }
    });
    var max = Math.max.apply(null, porSemana.concat([1]));
    var W = 560, H = 160, pad = 28, gw = (W - pad * 2) / semanas.length;
    var svg = '<svg class="fin-barras" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Recebido por semana">';
    porSemana.forEach(function (v, i) {
      var bh = Math.round((H - 44) * v / max), x = Math.round(pad + i * gw + gw * 0.2), y = H - 24 - bh, bw = Math.round(gw * 0.6);
      svg += '<rect class="fin-barra" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" rx="4"></rect>' +
        '<text class="fin-barra-rotulo" x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + semanas[i][0] + '–' + semanas[i][1] + '</text>' +
        (v ? '<text class="fin-barra-valor" x="' + (x + bw / 2) + '" y="' + (y - 4) + '" text-anchor="middle">' + e(CL.fmt.dinheiro(v)) + '</text>' : '');
    });
    svg += '</svg>';
    var topProc = Object.keys(r.porProc).sort(function (a, b) { return r.porProc[b] - r.porProc[a]; }).slice(0, 5);
    var taxas = filtrar({ de: de, ate: ate, tipo: 'receita' }).filter(function (l) { return l.descricao === 'Taxa de falta' && l.status !== 'cancelado'; });
    var taxaRec = 0, taxaPend = 0;
    taxas.forEach(function (l) { if (l.status === 'recebido') taxaRec += liquido(l); else taxaPend += liquido(l); });
    var html = '<div class="fin-nav"><div class="linha-acoes">' +
      '<button type="button" class="btn btn-icone btn-neutro" data-acao="mes-ant" aria-label="Mês anterior"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>' +
      '<button type="button" class="btn btn-neutro" data-acao="mes-hoje">Este mês</button>' +
      '<button type="button" class="btn btn-icone btn-neutro" data-acao="mes-prox" aria-label="Mês seguinte"><i class="ti ti-chevron-right" aria-hidden="true"></i></button></div>' +
      '<h2 class="fin-titulo-dia">' + e(mesExtenso(mes)) + '</h2></div>' +
      kpiHtml([
        { rotulo: 'Recebido', valor: r.recebidoCent, sub: r.qtdRecebidos + ' lanç.', classe: 'is-ok' },
        { rotulo: 'Pendente', valor: r.pendenteCent, sub: r.qtdPendentes + ' lanç.', classe: 'is-aviso' },
        { rotulo: 'Despesas', valor: r.despesasCent },
        { rotulo: 'Resultado', valor: r.recebidoCent - r.despesasCent, classe: (r.recebidoCent - r.despesasCent) < 0 ? 'is-erro' : '' }
      ]);
    if (!r.qtd) {
      html += '<div class="card" data-vazio-mes></div>';
    } else {
      html += '<div class="fin-mes-grade"><div class="card"><div class="card-titulo"><i class="ti ti-chart-bar" aria-hidden="true"></i>Recebido por semana</div>' + svg + '</div>' +
        '<div class="card"><div class="card-titulo"><i class="ti ti-list-numbers" aria-hidden="true"></i>Procedimentos que mais renderam</div>' +
        (topProc.length ? '<ol class="fin-top">' + topProc.map(function (k) { return '<li><span>' + e((proc(k) || {}).nome || (k === 'outros' ? 'Outros' : k)) + '</span><span class="tnum">' + e(CL.fmt.dinheiro(r.porProc[k])) + '</span></li>'; }).join('') + '</ol>' : '<p class="texto-3">Nenhum recebimento.</p>') + '</div>' +
        '<div class="card"><div class="card-titulo"><i class="ti ti-user-off" aria-hidden="true"></i>Faltas com taxa cobrada</div>' +
        (taxas.length ? '<dl class="fin-dl"><div><dt>Taxas lançadas</dt><dd class="tnum">' + taxas.length + '</dd></div><div><dt>Recebido</dt><dd class="tnum">' + e(CL.fmt.dinheiro(taxaRec)) + '</dd></div><div><dt>Pendente</dt><dd class="tnum">' + e(CL.fmt.dinheiro(taxaPend)) + '</dd></div></dl>' : '<p class="texto-3">Nenhuma taxa de falta neste mês.</p>') + '</div>' +
        '<div class="card"><div class="card-titulo"><i class="ti ti-wallet" aria-hidden="true"></i>Por forma</div>' + listaTotais(r.porForma, function (k) { return FORMA_ROTULO[k] || (k === 'sem_forma' ? 'Sem forma' : k); }) + '</div></div>' +
        '<div class="linha-acoes fin-rodape-acoes"><a class="btn btn-neutro" href="' + e(hashExtrato({ de: de, ate: ate }, 0)) + '"><i class="ti ti-list" aria-hidden="true"></i>Ver extrato do mês</a><a class="btn btn-neutro" href="#/financeiro/repasse/' + e(mes) + '"><i class="ti ti-users" aria-hidden="true"></i>Repasse do mês</a></div>';
    }
    box.innerHTML = html;
    var vz = box.querySelector('[data-vazio-mes]');
    if (vz) CL.ui.vazio(vz, { icone: 'ti-chart-bar-off', titulo: 'Nenhum lançamento em ' + mesExtenso(mes), texto: 'Finalize consultas com valor ou faça um lançamento avulso para ver o resumo.', acao: { rotulo: 'Lançamento avulso', icone: 'ti-plus', fn: function () { abrirLancamento(null, {}); } } });
  }

  function renderRepasse(box) {
    var mes = st.mes || mesDe(hoje());
    var de = mes + '-01', ate = fimMes(mes);
    var profs = profsAtivos();
    var html = '<div class="fin-nav"><div class="linha-acoes">' +
      '<button type="button" class="btn btn-icone btn-neutro" data-acao="mes-ant" aria-label="Mês anterior"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>' +
      '<button type="button" class="btn btn-neutro" data-acao="mes-hoje">Este mês</button>' +
      '<button type="button" class="btn btn-icone btn-neutro" data-acao="mes-prox" aria-label="Mês seguinte"><i class="ti ti-chevron-right" aria-hidden="true"></i></button></div>' +
      '<h2 class="fin-titulo-dia">Repasse · ' + e(mesExtenso(mes)) + '</h2>' +
      (profs.length ? '<button type="button" class="btn btn-neutro" data-acao="imprimir-repasse"><i class="ti ti-printer" aria-hidden="true"></i>Imprimir</button>' : '') + '</div>';
    if (!profs.length) {
      html += '<div class="card" data-vazio-rep></div>';
      box.innerHTML = html;
      CL.ui.vazio(box.querySelector('[data-vazio-rep]'), { icone: 'ti-user-plus', titulo: 'Nenhum profissional cadastrado', texto: 'Cadastre os profissionais e a regra de repasse em Ajustes.', acao: { rotulo: 'Abrir Ajustes', icone: 'ti-settings', fn: function () { CL.route.go('#/config/profissionais'); } } });
      return;
    }
    var totalBase = 0, totalRep = 0;
    html += '<div class="fin-repasse-lista">';
    profs.forEach(function (p) {
      var r = repasse(p.id, de, ate);
      totalBase += r.baseCent; totalRep += r.repasseCent;
      html += '<div class="card fin-rep-card"><div class="fin-rep-cabeca"><span class="chip-ponto" style="background:' + e(p.cor || '#4B5563') + '"></span><h3>' + e(p.nome) + '</h3><span class="texto-3">' + e(descricaoRegra(r.regra)) + '</span></div>' +
        '<div class="fin-rep-valores"><div><span class="rotulo">Base recebida</span><strong class="tnum">' + e(CL.fmt.dinheiro(r.baseCent)) + '</strong><small class="texto-3">' + r.qtd + (r.qtd === 1 ? ' atendimento' : ' atendimentos') + '</small></div>' +
        '<div><span class="rotulo">Repasse</span><strong class="tnum fin-rep-total">' + e(CL.fmt.dinheiro(r.repasseCent)) + '</strong></div></div>' +
        (r.itens.length ? '<details class="fin-rep-itens"><summary>Itens (' + r.itens.length + ')</summary><div class="tabela-wrap tabela-cartoes"><table class="tabela"><thead><tr><th>Data</th><th>Paciente</th><th>Descrição</th><th>Forma</th><th class="num">Valor</th></tr></thead><tbody>' +
          r.itens.map(function (l) { return '<tr><td data-rotulo="Data" class="tnum">' + e(CL.fmt.data(l.data)) + '</td><td data-rotulo="Paciente">' + e(nomePac(l.pacId) || '—') + '</td><td data-rotulo="Descrição">' + e(descricaoDe(l)) + '</td><td data-rotulo="Forma">' + e(FORMA_ROTULO[l.forma] || '—') + '</td><td data-rotulo="Valor" class="num tnum">' + e(CL.fmt.dinheiro(liquido(l))) + '</td></tr>'; }).join('') +
          '</tbody></table></div></details>' : '<p class="texto-3">Nenhum recebimento no mês.</p>') +
        '<div class="linha-acoes"><button type="button" class="btn btn-neutro btn-pequeno" data-acao="imprimir-repasse" data-prof="' + e(p.id) + '"><i class="ti ti-printer" aria-hidden="true"></i>Imprimir</button>' +
        (CL.can('config') ? '<a class="btn btn-fantasma btn-pequeno" href="#/config/profissionais"><i class="ti ti-settings" aria-hidden="true"></i>Regra</a>' : '') + '</div></div>';
    });
    html += '</div><div class="card fin-rep-totais"><span>Total recebido <strong class="tnum">' + e(CL.fmt.dinheiro(totalBase)) + '</strong></span><span>Total de repasses <strong class="tnum">' + e(CL.fmt.dinheiro(totalRep)) + '</strong></span></div>';
    box.innerHTML = html;
  }
  function imprimirRepasse(profId) {
    var mes = st.mes || mesDe(hoje());
    var de = mes + '-01', ate = fimMes(mes);
    var profs = profId ? [prof(profId)].filter(Boolean) : profsAtivos();
    if (!profs.length) return Promise.resolve(false);
    var corpo = '';
    profs.forEach(function (p) {
      var r = repasse(p.id, de, ate);
      corpo += '<h2 style="font-size:13pt;margin:6mm 0 2mm">' + e(p.nome) + '</h2><p>Regra: ' + e(descricaoRegra(r.regra)) + '</p>' +
        '<p><strong>Base recebida:</strong> ' + e(CL.fmt.dinheiro(r.baseCent)) + ' (' + r.qtd + ' atendimentos) · <strong>Repasse:</strong> ' + e(CL.fmt.dinheiro(r.repasseCent)) + '</p>' +
        (r.itens.length ? '<table style="width:100%;border-collapse:collapse;font-size:10pt"><thead><tr><th style="text-align:left;border-bottom:1px solid #000;padding:2px 4px">Data</th><th style="text-align:left;border-bottom:1px solid #000;padding:2px 4px">Paciente</th><th style="text-align:left;border-bottom:1px solid #000;padding:2px 4px">Descrição</th><th style="text-align:right;border-bottom:1px solid #000;padding:2px 4px">Valor</th></tr></thead><tbody>' +
          r.itens.map(function (l) { return '<tr><td style="padding:2px 4px">' + e(CL.fmt.data(l.data)) + '</td><td style="padding:2px 4px">' + e(nomePac(l.pacId) || '—') + '</td><td style="padding:2px 4px">' + e(descricaoDe(l)) + '</td><td style="padding:2px 4px;text-align:right">' + e(CL.fmt.dinheiro(liquido(l))) + '</td></tr>'; }).join('') + '</tbody></table>' : '');
    });
    return CL.print.documento({ titulo: 'Repasse — ' + mesExtenso(mes), corpoHtml: corpo, profissional: profs.length === 1 ? profs[0] : { nome: (CL.state.cfg.clinica || {}).nome || '' }, tipoDoc: 'agenda', semAssinatura: profs.length !== 1, vias: 1, id: 'repasse-' + mes });
  }

  /* =================== casca da tela =================== */
  function render() {
    var el = st.el;
    if (!el) return;
    var html = '<div class="tela fin"><div class="tela-cabeca"><h1>Financeiro</h1>' +
      '<div class="segmentado fin-visoes" role="group" aria-label="Visão">' +
      [['caixa', 'Caixa do dia'], ['extrato', 'Extrato'], ['mes', 'Mês'], ['repasse', 'Repasse']].map(function (v) { return '<button type="button" data-visao="' + v[0] + '" aria-pressed="' + (st.visao === v[0] ? 'true' : 'false') + '">' + v[1] + '</button>'; }).join('') + '</div>' +
      '<button type="button" class="btn btn-primario" data-acao="avulso" aria-label="Lançamento avulso" title="Lançamento avulso"><i class="ti ti-plus" aria-hidden="true"></i><span>Lançamento avulso</span></button></div>' +
      '<div class="fin-corpo" data-corpo></div></div>';
    el.innerHTML = html;
    var box = el.querySelector('[data-corpo]');
    if (st.visao === 'caixa') renderCaixa(box);
    else if (st.visao === 'extrato') renderExtrato(box);
    else if (st.visao === 'mes') renderMes(box);
    else renderRepasse(box);
  }
  function irCaixa(data) { CL.route.go('#/financeiro/caixa/' + data); }
  function irMes(mes) { CL.route.go('#/financeiro/' + st.visao + '/' + mes); }
  function abrirMenu(ancora, id) {
    var l = CL.get('lancamentos', id); if (!l) return;
    var itens = [];
    if (l.status === 'pendente') itens.push({ rotulo: l.tipo === 'despesa' ? 'Pagar' : 'Receber', icone: 'ti-check', fn: function () { baixa(id); } });
    itens.push({ rotulo: 'Editar', icone: 'ti-pencil', fn: function () { abrirLancamento(l); } });
    if (l.status === 'recebido') itens.push({ rotulo: 'Voltar a pendente', icone: 'ti-arrow-back-up', fn: function () { reabrir(id); CL.ui.toast('Lançamento voltou a pendente', { kind: 'ok' }); } });
    if (l.consultaId && window.Agenda && typeof Agenda.abrirConsulta === 'function') itens.push({ rotulo: 'Ver consulta', icone: 'ti-calendar-event', fn: function () { Agenda.abrirConsulta(l.consultaId); } });
    if (l.pacId) itens.push({ rotulo: 'Abrir ficha', icone: 'ti-user', fn: function () { CL.route.go('#/pacientes/' + encodeURIComponent(l.pacId) + '/financeiro'); } });
    if (l.status !== 'cancelado') itens.push('-', { rotulo: 'Cancelar lançamento', icone: 'ti-x', tipo: 'perigo', fn: function () { pedirCancelamento(id); } });
    CL.ui.menu(ancora, itens);
  }
  function aoClicar(ev) {
    var b = ev.target.closest('[data-acao], [data-visao], [data-periodo]');
    if (!b) return;
    if (b.hasAttribute('data-visao')) {
      var v = b.getAttribute('data-visao');
      if (v === 'caixa') irCaixa(st.data || hoje());
      else if (v === 'extrato') CL.route.go(hashExtrato(filtrosDe({}), 0));
      else CL.route.go('#/financeiro/' + v + '/' + (st.mes || mesDe(hoje())));
      return;
    }
    if (b.hasAttribute('data-periodo')) {
      var per = b.getAttribute('data-periodo'), h = hoje(), f = Object.assign({}, st.filtros);
      if (per === 'hoje') { f.de = h; f.ate = h; }
      else if (per === 'semana') { var d = U.dataDe(h); var dow = (d.getDay() + 6) % 7; f.de = U.addDias(h, -dow); f.ate = U.addDias(f.de, 6); }
      else if (per === 'mes') { f.de = mesDe(h) + '-01'; f.ate = fimMes(mesDe(h)); }
      else if (per === 'mes-ant') { var ma = addMes(mesDe(h), -1); f.de = ma + '-01'; f.ate = fimMes(ma); }
      st.pagina = 0;
      CL.route.go(hashExtrato(f, 0), { replace: true });
      return;
    }
    var acao = b.getAttribute('data-acao'), id = b.getAttribute('data-id');
    if (acao === 'avulso') abrirLancamento(null, { data: st.visao === 'caixa' ? st.data : hoje() });
    else if (acao === 'receber') baixa(id);
    else if (acao === 'menu') abrirMenu(b, id);
    else if (acao === 'dia-ant') irCaixa(U.addDias(st.data || hoje(), -1));
    else if (acao === 'dia-prox') irCaixa(U.addDias(st.data || hoje(), 1));
    else if (acao === 'dia-hoje') irCaixa(hoje());
    else if (acao === 'mes-ant') irMes(addMes(st.mes || mesDe(hoje()), -1));
    else if (acao === 'mes-prox') irMes(addMes(st.mes || mesDe(hoje()), 1));
    else if (acao === 'mes-hoje') irMes(mesDe(hoje()));
    else if (acao === 'csv') exportarCsv();
    else if (acao === 'pag-ant') { st.pagina = Math.max(0, st.pagina - 1); CL.route.go(hashExtrato(st.filtros, st.pagina), { replace: true }); }
    else if (acao === 'pag-prox') { st.pagina++; CL.route.go(hashExtrato(st.filtros, st.pagina), { replace: true }); }
    else if (acao === 'imprimir-repasse') imprimirRepasse(b.getAttribute('data-prof') || null);
  }
  function aoMudarCampo(ev) {
    var t = ev.target;
    if (!t) return;
    if (t.id === 'fin-data' && /^\d{4}-\d{2}-\d{2}$/.test(t.value)) irCaixa(t.value);
    else if (t.id === 'fin-aberto-prof') { st.abertoProf = t.value; render(); }
  }
  function aoSubmeter(ev) {
    var f = ev.target.closest('form[data-form="filtros"]');
    if (!f) return;
    ev.preventDefault();
    var q = { de: f.de.value, ate: f.ate.value, profId: f.prof.value, forma: f.forma.value, convenioId: f.conv.value, status: f.status.value, tipo: f.tipo.value };
    if (q.de && q.ate && q.de > q.ate) { var x = q.de; q.de = q.ate; q.ate = x; }
    st.pagina = 0;
    CL.route.go(hashExtrato(q, 0), { replace: true });
  }
  function agendarRender() {
    if (!st.el) return;
    clearTimeout(st.renderPendente);
    st.renderPendente = setTimeout(function () { if (st.el && !document.activeElement.closest('.fin-filtros')) render(); }, 150);
  }

  var Financeiro = window.Financeiro = {
    mount: function (el, params) {
      st.el = el;
      var seg = (params && params.seg) || [], q = (params && params.q) || {};
      if (!podeFinanceiro()) {
        var box = document.createElement('div'); el.innerHTML = ''; el.appendChild(box);
        CL.ui.vazio(box, { icone: 'ti-lock', titulo: 'Financeiro — perfil de recepção ou administração', texto: 'Seu perfil não abre o caixa. Peça à recepção ou ao administrador.', acao: { rotulo: 'Ir para a agenda', icone: 'ti-calendar', fn: function () { CL.route.go('#/agenda'); } } });
        return;
      }
      var v = VISOES.indexOf(seg[0]) >= 0 ? seg[0] : null;
      if (!v) {
        v = CL.pref.get('fin.visao', 'caixa');
        if (VISOES.indexOf(v) < 0) v = 'caixa';
        CL.route.go(v === 'caixa' ? '#/financeiro/caixa/' + hoje() : v === 'extrato' ? hashExtrato(filtrosDe({}), 0) : '#/financeiro/' + v + '/' + mesDe(hoje()), { replace: true });
        return;
      }
      st.visao = v;
      CL.pref.set('fin.visao', v);
      st.data = (v === 'caixa' && /^\d{4}-\d{2}-\d{2}$/.test(seg[1] || '') && U.dataDe(seg[1])) ? seg[1] : hoje();
      st.mes = ((v === 'mes' || v === 'repasse') && mesValido(seg[1])) ? seg[1] : mesDe(hoje());
      st.filtros = filtrosDe(q);
      st.pagina = Math.max(0, parseInt(q.pag, 10) || 0);
      el.addEventListener('click', aoClicar);
      el.addEventListener('change', aoMudarCampo);
      el.addEventListener('submit', aoSubmeter);
      st.unsubs.push(CL.on('change', function (info) { if (!info || ['lancamentos', 'consultas', 'pacientes', 'profissionais', 'procedimentos', '*'].indexOf(info.col) >= 0) agendarRender(); }));
      st.unsubs.push(CL.on('privacidade', agendarRender));
      render();
    },
    unmount: function () {
      clearTimeout(st.renderPendente);
      st.unsubs.forEach(function (u) { try { u(); } catch (err) { /* já removido */ } });
      st.unsubs = [];
      if (st.el) { st.el.removeEventListener('click', aoClicar); st.el.removeEventListener('change', aoMudarCampo); st.el.removeEventListener('submit', aoSubmeter); }
      st.el = null;
    },
    lancarDaConsulta: lancarDaConsulta,
    baixa: baixa,
    lancar: lancar,
    atualizar: atualizar,
    receber: receber,
    cancelar: cancelar,
    reabrir: reabrir,
    resumo: resumo,
    caixaDia: caixaDia,
    repasse: repasse,
    extrato: extrato,
    abrirLancamento: abrirLancamento,
    imprimirRepasse: imprimirRepasse,
    FORMAS: FORMAS,
    formaRotulo: function (k) { return FORMA_ROTULO[k] || ''; },
    liquido: liquido
  };
  CL.route.register('financeiro', Financeiro);
})();
