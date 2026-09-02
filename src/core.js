/* Clinicar — core.js
   Global único: CL. Estado + persistência (via Backend), sessão e permissões, roteador por hash,
   UI própria (modal / confirmar / pedirTexto / toast / drawer / menu / vazio / carregando / erro),
   formatação pt-BR, utilitários, impressão A4 e boot. Contrato: docs/ESPEC.md §4.4.
   Regras: escrita no estado SÓ por CL.upsert / CL.patch / CL.remove / CL.setCfg. */
(function () {
  'use strict';

  var CL = window.CL = {};
  CL.VERSAO = '1.0.0';
  CL.COLECOES = ['profissionais', 'procedimentos', 'convenios', 'pacientes', 'consultas', 'bloqueios', 'espera',
    'notasDia', 'evolucoes', 'receitas', 'documentos', 'exames', 'modelos', 'lancamentos', 'usuarios', 'auditoria'];
  CL.AUDITORIA_TETO = 5000;

  /* =================== eventos =================== */
  var ouvintes = {};
  CL.on = function (evento, fn) {
    (ouvintes[evento] = ouvintes[evento] || []).push(fn);
    return function () { var l = ouvintes[evento] || []; var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  };
  CL.emit = function (evento, dado) {
    (ouvintes[evento] || []).slice().forEach(function (fn) {
      try { fn(dado); } catch (e) { console.error('[CL] ouvinte de "' + evento + '" falhou', e); }
    });
  };

  /* =================== estado =================== */
  function mesclar(alvo, patch) {
    Object.keys(patch || {}).forEach(function (k) {
      var v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (!alvo[k] || typeof alvo[k] !== 'object' || Array.isArray(alvo[k])) alvo[k] = {};
        mesclar(alvo[k], v);
      } else {
        alvo[k] = v;
      }
    });
    return alvo;
  }

  CL.defaultCfg = function () {
    return {
      clinica: { nome: '', endereco: '', telefone: '', email: '', cnpj: '', rodape: '' },
      agenda: { slotBase: 15, horaIni: '07:00', horaFim: '19:00', densidade: 'padrao' },
      politica: { janelaCancelamentoH: 24, taxaFaltaCent: 0, taxaFaltaPct: 0, cobrarTardio: true },
      lgpd: { responsavel: '', contato: '', aviso: '' },
      whatsapp: { modelos: { confirmar: '', lembrete: '', remarcar: '', tele: '', vaga: '' } },
      seed: false, versao: 1, updatedAt: 0
    };
  };
  CL.defaultState = function () {
    var s = {};
    CL.COLECOES.forEach(function (c) { s[c] = []; });
    s.cfg = CL.defaultCfg();
    s._tomb = {};
    return s;
  };
  CL.normalizar = function (s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
    CL.COLECOES.forEach(function (c) { if (!Array.isArray(s[c])) s[c] = []; });
    s.cfg = mesclar(CL.defaultCfg(), (s.cfg && typeof s.cfg === 'object') ? s.cfg : {});
    if (!s._tomb || typeof s._tomb !== 'object' || Array.isArray(s._tomb)) s._tomb = {};
    return s;
  };
  CL.state = CL.defaultState();

  var resolverReady;
  CL.ready = new Promise(function (r) { resolverReady = r; });

  CL.uid = function () {
    var rnd = '';
    var alfabeto = '0123456789abcdefghijklmnopqrstuvwxyz';
    var bytes = new Uint8Array(6);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var j = 0; j < 6; j++) bytes[j] = Math.floor(Math.random() * 256);
    for (var i = 0; i < 6; i++) rnd += alfabeto[bytes[i] % 36];
    return Date.now().toString(36) + '-' + rnd;
  };

  CL.col = function (nome) {
    if (!Array.isArray(CL.state[nome])) CL.state[nome] = [];
    return CL.state[nome];
  };
  CL.get = function (nome, id) {
    if (id == null) return undefined;
    var sid = String(id);
    var col = CL.col(nome);
    for (var i = 0; i < col.length; i++) if (col[i] && col[i].id === sid) return col[i];
    return undefined;
  };

  /* ---- sujos + persistência com debounce ---- */
  function novoSujos() { return { cols: {}, cfg: false, tomb: false }; }
  var sujos = novoSujos();
  var timerSave = null, salvando = null, promessaPendente = null, resolverPendente = null, loteProfundidade = 0;

  function marcar(col, id) {
    if (!col) return;
    (sujos.cols[col] = sujos.cols[col] || new Set()).add(String(id));
  }
  function temSujos() {
    return sujos.cfg || sujos.tomb || Object.keys(sujos.cols).some(function (c) { return sujos.cols[c].size > 0; });
  }
  function fundirSujos(outro) {
    Object.keys(outro.cols).forEach(function (c) {
      var alvo = (sujos.cols[c] = sujos.cols[c] || new Set());
      outro.cols[c].forEach(function (id) { alvo.add(id); });
    });
    sujos.cfg = sujos.cfg || outro.cfg;
    sujos.tomb = sujos.tomb || outro.tomb;
  }
  function exportarAgora() {
    try {
      var texto = window.Backend ? Backend.exportar() : JSON.stringify({ app: 'clinicar', versao: 1, exportadoEm: new Date().toISOString(), state: CL.state });
      CL.util.baixar('clinicar-backup-' + CL.util.hoje() + '.json', texto, 'application/json');
    } catch (e) { console.error(e); }
  }
  function executarSave() {
    timerSave = null;
    if (salvando) {
      salvando.then(function () { if (temSujos() || promessaPendente) CL.persist(); });
      return;
    }
    var lote = sujos; sujos = novoSujos();
    var resolver = resolverPendente || function () {};
    promessaPendente = null; resolverPendente = null;
    var opts = { sujos: lote.cols, cfg: lote.cfg, tomb: lote.tomb };
    var backend = window.Backend;
    if (!backend || typeof backend.save !== 'function') {
      console.error('[CL] Backend indisponível: nada foi salvo');
      fundirSujos(lote); resolver(false); return;
    }
    salvando = Promise.resolve()
      .then(function () { return backend.save(CL.state, opts); })
      .then(function () {
        CL.emit('sync', { estado: backend.modo === 'firebase' ? 'ok' : 'local', em: Date.now() });
        resolver(true);
      })
      .catch(function (err) {
        fundirSujos(lote);
        var code = err && err.code;
        if (code === 'offline') {
          CL.emit('sync', { estado: 'offline', em: Date.now() });
        } else {
          console.error('[CL] falha ao salvar', err);
          CL.emit('sync', { estado: 'erro', em: Date.now(), erro: err });
          if (code !== 'trava') {
            CL.ui.toast('Não foi possível salvar: ' + ((err && err.message) || 'erro desconhecido'),
              { kind: 'erro', fixo: true, action: { rotulo: 'Exportar agora', fn: exportarAgora } });
          }
        }
        resolver(false);
      })
      .then(function () { salvando = null; });
  }
  CL.persist = function () {
    if (!promessaPendente) promessaPendente = new Promise(function (r) { resolverPendente = r; });
    if (loteProfundidade > 0) return promessaPendente;
    clearTimeout(timerSave);
    timerSave = setTimeout(executarSave, 300);
    return promessaPendente;
  };
  CL.lote = function (fn) {
    loteProfundidade++;
    return Promise.resolve()
      .then(function () { return fn(); })
      .then(function () { loteProfundidade--; }, function (e) { loteProfundidade--; throw e; })
      .then(function () {
        if (loteProfundidade === 0 && (temSujos() || promessaPendente)) {
          clearTimeout(timerSave); timerSave = null;
          var p = promessaPendente || Promise.resolve();
          executarSave();
          return p;
        }
      });
  };
  /* Marca tudo como sujo (primeiro login no firebase, restauração de backup). */
  CL.persistTudo = function () {
    CL.COLECOES.forEach(function (c) { CL.col(c).forEach(function (it) { marcar(c, it.id); }); });
    sujos.cfg = true; sujos.tomb = true;
    return CL.persist();
  };
  /* Troca o conteúdo do estado mantendo a MESMA referência CL.state. */
  CL.substituirEstado = function (novo) {
    novo = CL.normalizar(novo);
    Object.keys(CL.state).forEach(function (k) { if (!(k in novo)) delete CL.state[k]; });
    Object.keys(novo).forEach(function (k) { CL.state[k] = novo[k]; });
    CL.emit('change', { col: '*' });
    CL.emit('cfg', CL.state.cfg);
  };

  /* opts.manterUpdatedAt: só para importação/merge, onde o carimbo original decide quem vence. */
  CL.upsert = function (nome, obj, opts) {
    if (!obj || typeof obj !== 'object') throw new Error('upsert: objeto inválido');
    var col = CL.col(nome);
    var agora = Date.now();
    if (!obj.id) obj.id = CL.uid();
    obj.id = String(obj.id);
    if (!obj.createdAt) obj.createdAt = agora;
    if (!(opts && opts.manterUpdatedAt && obj.updatedAt)) obj.updatedAt = agora;
    var i = -1;
    for (var k = 0; k < col.length; k++) if (col[k] && col[k].id === obj.id) { i = k; break; }
    if (i >= 0) col[i] = obj; else col.push(obj);
    if (nome === 'auditoria' && col.length > CL.AUDITORIA_TETO) col.splice(0, col.length - CL.AUDITORIA_TETO);
    marcar(nome, obj.id);
    CL.persist();
    CL.emit('change', { col: nome, id: obj.id, obj: obj });
    return obj;
  };
  CL.patch = function (nome, id, campos) {
    var atual = CL.get(nome, id);
    if (!atual) throw new Error('patch: ' + nome + '/' + id + ' não existe');
    Object.assign(atual, campos || {});
    return CL.upsert(nome, atual);
  };
  CL.remove = function (nome, id) {
    var sid = String(id);
    var col = CL.col(nome);
    var existia = false;
    for (var i = col.length - 1; i >= 0; i--) if (col[i] && col[i].id === sid) { col.splice(i, 1); existia = true; }
    if (!CL.state._tomb) CL.state._tomb = {};
    CL.state._tomb[sid] = Date.now();
    sujos.tomb = true;
    marcar(nome, sid);
    CL.persist();
    CL.emit('change', { col: nome, id: sid, obj: null, removido: true });
    return existia;
  };
  CL.setCfg = function (patchProfundo) {
    if (!CL.state.cfg) CL.state.cfg = CL.defaultCfg();
    mesclar(CL.state.cfg, patchProfundo || {});
    CL.state.cfg.updatedAt = Date.now();
    sujos.cfg = true;
    CL.persist();
    CL.emit('cfg', CL.state.cfg);
    return CL.state.cfg;
  };

  CL.seed = function () {
    if (CL.state.cfg && CL.state.cfg.seed) return Promise.resolve();
    return CL.lote(function () {
      var procs = [
        ['proc-consulta', 'Consulta', 30, '#2B5CE6', 'presencial'],
        ['proc-retorno', 'Retorno', 20, '#0E8A6C', 'presencial'],
        ['proc-procedimento', 'Procedimento', 60, '#B3541E', 'presencial'],
        ['proc-tele', 'Teleconsulta', 30, '#7C3AED', 'tele'],
        ['proc-exame', 'Exame', 30, '#0F766E', 'presencial']
      ];
      procs.forEach(function (p) {
        if (!CL.get('procedimentos', p[0])) CL.upsert('procedimentos', { id: p[0], nome: p[1], dur: p[2], valorCent: 0, cor: p[3], modalidade: p[4], bufferMin: 0, ativo: true });
      });
      if (!CL.get('convenios', 'particular')) CL.upsert('convenios', { id: 'particular', nome: 'Particular', ativo: true });
      if (!CL.col('usuarios').length) {
        CL.upsert('usuarios', { id: 'usr-admin', nome: 'Administração', perfil: 'admin', profId: null, pinHash: '', ativo: true });
        CL.upsert('usuarios', { id: 'usr-recepcao', nome: 'Recepção', perfil: 'recepcao', profId: null, pinHash: '', ativo: true });
      }
      var m = (CL.state.cfg.whatsapp && CL.state.cfg.whatsapp.modelos) || {};
      var padrao = {
        confirmar: 'Olá, {nome}! Confirmando sua consulta com {prof} em {data} às {hora}, na {clinica}. Endereço: {endereco}. Responda SIM para confirmar ou avise se precisar remarcar.',
        lembrete: 'Olá, {nome}! Lembrete: sua consulta com {prof} é em {data}, às {hora}, na {clinica}. Endereço: {endereco}. Até lá!',
        remarcar: 'Olá, {nome}. Precisamos remarcar sua consulta com {prof} de {data} às {hora}. Qual o melhor dia e horário para você?',
        tele: 'Olá, {nome}! Sua teleconsulta com {prof} é em {data} às {hora}. Entre pelo link: {link}. Fique em um lugar reservado e com boa conexão.',
        vaga: 'Olá, {nome}! Abriu um horário com {prof} em {data} às {hora}, na {clinica}. Quer ficar com ele? Responda SIM e reservamos para você.'
      };
      var modelos = {};
      Object.keys(padrao).forEach(function (k) { modelos[k] = m[k] || padrao[k]; });
      CL.setCfg({ whatsapp: { modelos: modelos }, seed: true });
    });
  };

  /* =================== sessão e permissões =================== */
  var sessao = null;
  var protoSessao = {
    set: function (u) { return CL.sessao.set(u); },
    clear: function () { return CL.sessao.clear(); }
  };
  var PERFIS = { admin: 'Administrador', recepcao: 'Recepção', profissional: 'Profissional' };
  CL.PERFIS = PERFIS;
  Object.defineProperty(CL, 'session', { get: function () { return sessao; }, set: function (v) { sessao = v; } });
  CL.sessao = {
    get: function () { return sessao; },
    set: function (u) {
      if (!u || !u.id) throw new Error('sessão: usuário inválido');
      sessao = Object.create(protoSessao);
      sessao.usuarioId = String(u.id);
      sessao.nome = u.nome || '';
      sessao.perfil = u.perfil || 'recepcao';
      sessao.profId = u.profId || null;
      sessao.privacidade = !!CL.pref.get('privacidade', false);
      try { localStorage.setItem('clinicar.v1.sessao', JSON.stringify({ usuarioId: sessao.usuarioId, em: Date.now() })); } catch (e) { /* sem storage */ }
      aplicarPrivacidade(sessao.privacidade);
      CL.emit('session', sessao);
      return sessao;
    },
    clear: function () {
      sessao = null;
      try { localStorage.removeItem('clinicar.v1.sessao'); } catch (e) { /* sem storage */ }
      CL.emit('session', null);
    },
    /* Reabre a sessão guardada (F5). Devolve true se conseguiu. */
    restaurar: function () {
      var guardada = null;
      try { guardada = JSON.parse(localStorage.getItem('clinicar.v1.sessao')); } catch (e) { guardada = null; }
      if (!guardada || !guardada.usuarioId) return false;
      var u = CL.get('usuarios', guardada.usuarioId);
      if (!u || u.ativo === false) return false;
      CL.sessao.set(u);
      return true;
    }
  };
  CL.can = function (acao) {
    if (!sessao) return false;
    var p = sessao.perfil;
    switch (acao) {
      case 'agenda': return true;
      case 'clinico': return p === 'profissional' || p === 'admin';
      case 'financeiro': return p === 'recepcao' || p === 'admin';
      case 'config': return p === 'admin';
      default: return false;
    }
  };
  CL.audit = function (acao, alvo, alvoId, extra) {
    var s = sessao;
    var item = Object.assign({
      em: Date.now(), usuarioId: s ? s.usuarioId : null, usuario: s ? s.nome : '', perfil: s ? s.perfil : '',
      acao: acao, alvo: alvo || '', alvoId: alvoId == null ? null : String(alvoId), pacId: null
    }, extra || {});
    return CL.upsert('auditoria', item);
  };

  function aplicarPrivacidade(v) {
    if (document.body) document.body.classList.toggle('is-privado', !!v);
    var faixa = document.getElementById('faixa-priv');
    if (faixa) faixa.hidden = !v;
    var btn = document.getElementById('topo-priv');
    if (btn) {
      btn.setAttribute('aria-pressed', v ? 'true' : 'false');
      var ic = btn.querySelector('i'); if (ic) ic.className = 'ti ' + (v ? 'ti-eye-off' : 'ti-eye');
    }
  }
  CL.privacidade = function (valor) {
    var v = valor === undefined ? !(sessao && sessao.privacidade) : !!valor;
    if (sessao) sessao.privacidade = v;
    CL.pref.set('privacidade', v);
    aplicarPrivacidade(v);
    CL.emit('privacidade', v);
    return v;
  };
  CL.nomeExibido = function (nome) {
    return (sessao && sessao.privacidade) ? CL.util.iniciais(nome) : (nome || '');
  };

  /* =================== preferências =================== */
  var prefCache = null;
  function lerPref() {
    if (prefCache) return prefCache;
    try { prefCache = JSON.parse(localStorage.getItem('clinicar.v1.pref')) || {}; } catch (e) { prefCache = {}; }
    if (!prefCache || typeof prefCache !== 'object') prefCache = {};
    return prefCache;
  }
  CL.pref = {
    get: function (chave, padrao) { var p = lerPref(); return (chave in p) ? p[chave] : padrao; },
    set: function (chave, valor) {
      var p = lerPref(); p[chave] = valor;
      try { localStorage.setItem('clinicar.v1.pref', JSON.stringify(p)); } catch (e) { /* cota: preferência não é vital */ }
      return valor;
    }
  };

  /* =================== status de consulta =================== */
  CL.STATUS = {
    agendado: { rotulo: 'Agendado', icone: 'ti-calendar', classe: 'st-agendado', terminal: false },
    confirmado: { rotulo: 'Confirmado', icone: 'ti-check', classe: 'st-confirmado', terminal: false },
    chegou: { rotulo: 'Chegou', icone: 'ti-door-enter', classe: 'st-chegou', terminal: false },
    em_atendimento: { rotulo: 'Em atendimento', icone: 'ti-stethoscope', classe: 'st-em_atendimento', terminal: false },
    finalizado: { rotulo: 'Finalizado', icone: 'ti-circle-check', classe: 'st-finalizado', terminal: true },
    faltou: { rotulo: 'Faltou', icone: 'ti-user-off', classe: 'st-faltou', terminal: true },
    cancelado: { rotulo: 'Cancelado', icone: 'ti-x', classe: 'st-cancelado', terminal: true },
    cancelado_tarde: { rotulo: 'Cancelado tarde', icone: 'ti-clock-x', classe: 'st-cancelado_tarde', terminal: true },
    cancelado_clinica: { rotulo: 'Cancelado pela clínica', icone: 'ti-building-off', classe: 'st-cancelado_clinica', terminal: true }
  };
  CL.FLUXO = ['agendado', 'confirmado', 'chegou', 'em_atendimento', 'finalizado'];
  CL.proximoStatus = function (s) {
    var i = CL.FLUXO.indexOf(s);
    return (i >= 0 && i < CL.FLUXO.length - 1) ? CL.FLUXO[i + 1] : null;
  };
  CL.chipStatus = function (status) {
    var st = CL.STATUS[status] || { rotulo: status || '', icone: 'ti-help', classe: '' };
    return '<span class="chip ' + st.classe + '"><i class="ti ' + st.icone + '" aria-hidden="true"></i>' + CL.util.esc(st.rotulo) + '</span>';
  };

  /* =================== formatação =================== */
  var DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  var DIAS_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function ymdDe(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') return CL.util.ymd(new Date(v));
    if (v instanceof Date) return CL.util.ymd(v);
    return String(v).slice(0, 10);
  }
  CL.fmt = {
    data: function (v) {
      var ymd = ymdDe(v);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
      return ymd.slice(8, 10) + '/' + ymd.slice(5, 7) + '/' + ymd.slice(0, 4);
    },
    dataExtenso: function (v, curto) {
      var ymd = ymdDe(v);
      var d = CL.util.dataDe(ymd);
      if (!d) return '';
      if (curto) return DIAS_CURTO[d.getDay()] + ', ' + CL.fmt.data(ymd);
      return DIAS[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear();
    },
    diaSemana: function (v, curto) {
      var d = CL.util.dataDe(ymdDe(v));
      if (!d) return '';
      return curto ? DIAS_CURTO[d.getDay()] : DIAS[d.getDay()];
    },
    hora: function (v) {
      if (v instanceof Date) return CL.util.hhmmDe(v);
      if (typeof v === 'number') return CL.util.hhmm(v);
      var s = String(v || '');
      var m = s.match(/^(\d{1,2}):(\d{2})/);
      return m ? (m[1].length === 1 ? '0' + m[1] : m[1]) + ':' + m[2] : s;
    },
    dataHora: function (ms) {
      if (!ms) return '';
      var d = new Date(ms);
      return CL.fmt.data(CL.util.ymd(d)) + ' ' + CL.util.hhmmDe(d);
    },
    dinheiro: function (cent) {
      cent = Math.round(Number(cent) || 0);
      var neg = cent < 0; cent = Math.abs(cent);
      var inteiro = String(Math.floor(cent / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      var dec = String(cent % 100); if (dec.length < 2) dec = '0' + dec;
      return (neg ? '-' : '') + 'R$ ' + inteiro + ',' + dec;
    },
    idade: function (nasc) {
      var d = CL.util.dataDe(ymdDe(nasc));
      if (!d) return '';
      var hoje = new Date();
      var anos = hoje.getFullYear() - d.getFullYear();
      var m = hoje.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && hoje.getDate() < d.getDate())) anos--;
      if (anos < 0) return '';
      if (anos < 1) {
        var meses = (hoje.getFullYear() - d.getFullYear()) * 12 + m - (hoje.getDate() < d.getDate() ? 1 : 0);
        return Math.max(0, meses) + ' m';
      }
      return anos + ' a';
    },
    fone: function (v) {
      var d = CL.util.digits(v);
      if ((d.length === 12 || d.length === 13) && d.slice(0, 2) === '55') d = d.slice(2);
      if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
      if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
      return v == null ? '' : String(v);
    },
    cpf: function (v) {
      var d = CL.util.digits(v);
      if (d.length === 11) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
      return v == null ? '' : String(v);
    },
    relativo: function (ms) {
      if (!ms) return '';
      var dif = Date.now() - ms;
      var futuro = dif < 0; dif = Math.abs(dif);
      var min = Math.round(dif / 60000);
      var txt;
      if (min < 1) return 'agora';
      if (min < 60) txt = min + ' min';
      else if (min < 60 * 24) txt = Math.round(min / 60) + ' h';
      else if (min < 60 * 24 * 7) txt = Math.round(min / 1440) + ' d';
      else return CL.fmt.data(CL.util.ymd(new Date(ms)));
      return futuro ? 'em ' + txt : 'há ' + txt;
    },
    perfil: function (p) { return PERFIS[p] || p || ''; }
  };

  /* =================== utilitários =================== */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  CL.util = {
    hoje: function () { return CL.util.ymd(new Date()); },
    ymd: function (date) {
      var d = date instanceof Date ? date : new Date(date);
      if (isNaN(d.getTime())) return '';
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    },
    dataDe: function (ymd) {
      var m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return null;
      var d = new Date(+m[1], +m[2] - 1, +m[3]);
      return isNaN(d.getTime()) ? null : d;
    },
    addDias: function (ymd, n) {
      var d = CL.util.dataDe(ymd);
      if (!d) return '';
      d.setDate(d.getDate() + (Number(n) || 0));
      return CL.util.ymd(d);
    },
    min: function (hhmm) {
      var m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
      return m ? (+m[1]) * 60 + (+m[2]) : 0;
    },
    hhmm: function (min) {
      min = Math.max(0, Math.round(Number(min) || 0));
      return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
    },
    hhmmDe: function (date) { var d = date instanceof Date ? date : new Date(date); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); },
    somaMin: function (hhmm, n) { return CL.util.hhmm(CL.util.min(hhmm) + (Number(n) || 0)); },
    norm: function (s) {
      return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    },
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    /* Tira títulos do início do nome ("Dra. Ana Lima" → "Ana Lima") para que iniciais e nome curto
       não virem "DL"/"Dra." em todo profissional cadastrado como Dr./Dra. */
    semTitulo: function (nome) {
      var s = String(nome || '').trim(), antes;
      do { antes = s; s = s.replace(/^(dr|dra|dr[ªa]|prof|profa|prof[ªa]|sr|sra|enf|enfa|enf[ªa])\.?\s+/i, ''); } while (s !== antes);
      return s;
    },
    iniciais: function (nome) {
      var partes = CL.util.semTitulo(nome).split(/\s+/).filter(Boolean);
      if (!partes.length) return '';
      if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
      return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
    },
    primeiroNome: function (nome) { return CL.util.semTitulo(nome).split(/\s+/)[0] || ''; },
    nomeCurto: function (nome) { return CL.util.primeiroNome(nome); },
    /* Só http(s) vira link clicável; javascript:, data: e afins são descartados (devolve ''). */
    urlSegura: function (s) {
      s = String(s == null ? '' : s).trim();
      return /^https?:\/\/[^\s<>"']+$/i.test(s) ? s : '';
    },
    debounce: function (fn, ms) {
      var t = null;
      var d = function () {
        var args = arguments, self = this;
        clearTimeout(t);
        t = setTimeout(function () { t = null; fn.apply(self, args); }, ms || 250);
      };
      d.cancelar = function () { clearTimeout(t); t = null; };
      return d;
    },
    digits: function (s) { return String(s == null ? '' : s).replace(/\D+/g, ''); },
    centavos: function (v) {
      if (typeof v === 'number') return Math.round(v * 100);
      var s = String(v == null ? '' : v).replace(/[^\d,.\-]/g, '');
      if (!s) return 0;
      var neg = s.charAt(0) === '-';
      s = s.replace(/-/g, '');
      if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
      else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
      var n = Math.round(parseFloat(s) * 100);
      if (isNaN(n)) return 0;
      return neg ? -n : n;
    },
    sha256: function (str) {
      var texto = String(str == null ? '' : str);
      if (window.crypto && window.crypto.subtle && window.TextEncoder) {
        return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)).then(function (buf) {
          var bytes = new Uint8Array(buf), hex = '';
          for (var i = 0; i < bytes.length; i++) hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
          return hex;
        }).catch(function () { return CL.util.sha256Sync(texto); });
      }
      return Promise.resolve(CL.util.sha256Sync(texto));
    },
    sha256Sync: sha256Js,
    baixar: function (nomeArquivo, texto, mime) {
      var blob = new Blob([texto], { type: mime || 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = nomeArquivo; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    },
    /* Blindagem contra autofill do navegador em campos de busca. */
    semAutofill: function (inputEl) {
      if (!inputEl) return inputEl;
      inputEl.setAttribute('autocomplete', 'off');
      inputEl.setAttribute('autocorrect', 'off');
      inputEl.setAttribute('autocapitalize', 'off');
      inputEl.setAttribute('spellcheck', 'false');
      inputEl.setAttribute('data-sem-autofill', '1');
      if (!inputEl.name || /mail|user|login/i.test(inputEl.name)) inputEl.name = 'busca-' + CL.uid();
      inputEl.addEventListener('focus', function () { if (inputEl.value.indexOf('@') >= 0) inputEl.value = ''; });
      inputEl.addEventListener('input', function () { if (inputEl.value.indexOf('@') >= 0 && inputEl.value.length > 3) inputEl.value = ''; });
      return inputEl;
    },
    valorBusca: function (inputEl) {
      var v = inputEl ? String(inputEl.value || '') : '';
      return v.indexOf('@') >= 0 ? '' : v;
    }
  };

  /* SHA-256 em JS puro: reserva para quando crypto.subtle não existe (file://, contexto inseguro). */
  function sha256Js(str) {
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var bytes = [];
    var s = String(str == null ? '' : str);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(i + 1) - 0xdc00); i++; }
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    var l = bytes.length, bitLen = l * 8;
    var total = Math.ceil((l + 9) / 64) * 64;
    var buf = new Uint8Array(total);
    for (var b = 0; b < l; b++) buf[b] = bytes[b];
    buf[l] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(total - 4, bitLen >>> 0);
    dv.setUint32(total - 8, Math.floor(bitLen / 4294967296));
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var W = new Uint32Array(64);
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var off = 0; off < total; off += 64) {
      for (var t = 0; t < 16; t++) W[t] = dv.getUint32(off + t * 4);
      for (t = 16; t < 64; t++) {
        var s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        var s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      var a = H[0], bb = H[1], cc = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & bb) ^ (a & cc) ^ (bb & cc);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = cc; cc = bb; bb = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + bb) >>> 0; H[2] = (H[2] + cc) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var hex = '';
    for (var q = 0; q < 8; q++) { var hx = H[q].toString(16); while (hx.length < 8) hx = '0' + hx; hex += hx; }
    return hex;
  }

  /* =================== UI própria =================== */
  var FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var modalAtual = null, drawerAtual = null, menuAtual = null;
  var toasts = [];

  function raiz(id) { return document.getElementById(id); }
  function focaveisDe(el) {
    return Array.prototype.filter.call(el.querySelectorAll(FOCAVEIS), function (x) { return x.offsetParent !== null || x === document.activeElement; });
  }
  function prenderFoco(el, e) {
    if (e.key !== 'Tab') return;
    var f = focaveisDe(el);
    if (!f.length) { e.preventDefault(); return; }
    var primeiro = f[0], ultimo = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === primeiro || !el.contains(document.activeElement))) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
  }
  function devolverFoco(el) {
    if (el && typeof el.focus === 'function' && document.contains(el)) {
      try { el.focus({ preventScroll: true }); } catch (e) { /* elemento sumiu */ }
    }
  }
  function preencher(alvo, conteudo) {
    alvo.innerHTML = '';
    if (conteudo == null) return;
    if (typeof conteudo === 'string') alvo.innerHTML = conteudo;
    else alvo.appendChild(conteudo);
  }
  function botaoHtml(b, idx) {
    var tipo = b.tipo === 'primario' ? 'btn-primario' : b.tipo === 'perigo' ? 'btn-perigo' : 'btn-neutro';
    return '<button type="button" class="btn ' + tipo + '" data-botao="' + idx + '"' + (b.desabilitado ? ' disabled' : '') + '>' +
      (b.icone ? '<i class="ti ' + CL.util.esc(b.icone) + '" aria-hidden="true"></i>' : '') + CL.util.esc(b.rotulo || 'OK') + '</button>';
  }

  CL.ui = {};

  CL.ui.modal = function (o) {
    o = o || {};
    if (modalAtual) modalAtual.fechar({ silencioso: true });
    var disparador = document.activeElement;
    var host = raiz('modal-raiz');
    if (!host) throw new Error('modal: #modal-raiz não existe');
    var scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.setAttribute('data-fecha', '1');
    var el = document.createElement('div');
    el.className = 'modal' + (o.largo ? ' modal-largo' : '');
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'modal-titulo');
    var botoes = Array.isArray(o.botoes) ? o.botoes : [];
    el.innerHTML = '<div class="modal-alca" aria-hidden="true"></div>' +
      '<header class="modal-cabeca"><h2 id="modal-titulo"></h2><button type="button" class="btn btn-icone btn-fantasma" data-fecha="1" aria-label="Fechar"><i class="ti ti-x" aria-hidden="true"></i></button></header>' +
      '<div class="modal-corpo"></div><footer class="modal-rodape">' + botoes.map(botaoHtml).join('') + '</footer>';
    el.querySelector('#modal-titulo').textContent = o.titulo || '';
    preencher(el.querySelector('.modal-corpo'), o.corpo);
    host.appendChild(scrim); host.appendChild(el);
    document.body.classList.add('has-modal');
    var fechado = false;
    var ctx = { el: el, fechar: fechar, corpo: el.querySelector('.modal-corpo') };
    function fechar(info) {
      if (fechado) return; fechado = true;
      el.removeEventListener('keydown', aoTeclar);
      scrim.remove(); el.remove();
      if (modalAtual === ctx) modalAtual = null;
      if (!modalAtual) document.body.classList.remove('has-modal');
      if (!(info && info.silencioso)) { devolverFoco(disparador); if (typeof o.aoFechar === 'function') { try { o.aoFechar(info || {}); } catch (e) { console.error(e); } } }
    }
    function aoTeclar(e) { prenderFoco(el, e); }
    el.addEventListener('keydown', aoTeclar);
    el.addEventListener('click', function (e) {
      var fx = e.target.closest('[data-fecha]');
      if (fx) { fechar({ motivo: 'fechar' }); return; }
      var bt = e.target.closest('[data-botao]');
      if (bt) {
        var b = botoes[+bt.getAttribute('data-botao')];
        if (!b) return;
        var r = typeof b.acao === 'function' ? b.acao(ctx) : undefined;
        if (b.fecha === false) return;
        if (r === false) return;
        if (r && typeof r.then === 'function') { r.then(function (v) { if (v !== false) fechar({ motivo: 'botao', botao: b }); }); return; }
        fechar({ motivo: 'botao', botao: b });
      }
    });
    scrim.addEventListener('click', function () { fechar({ motivo: 'fechar' }); });
    modalAtual = ctx;
    requestAnimationFrame(function () {
      var alvo = el.querySelector('[autofocus]') || el.querySelector('.modal-corpo ' + FOCAVEIS) || el.querySelector('.modal-rodape .btn-primario') || el.querySelector('.modal-rodape .btn') || el.querySelector('[data-fecha]');
      if (alvo) { try { alvo.focus(); if (alvo.select && alvo.tagName === 'INPUT') alvo.select(); } catch (e) { /* sem foco */ } }
    });
    return ctx;
  };

  CL.ui.confirmar = function (o) {
    o = o || {};
    return new Promise(function (resolve) {
      var decidido = false;
      var corpo = document.createElement('div');
      corpo.className = 'prosa';
      corpo.textContent = o.texto || '';
      CL.ui.modal({
        titulo: o.titulo || 'Confirmar',
        corpo: corpo,
        botoes: [
          { rotulo: o.cancelar || 'Cancelar', tipo: 'neutro', acao: function () { decidido = true; resolve(false); } },
          { rotulo: o.ok || 'Confirmar', tipo: o.okTipo === 'perigo' ? 'perigo' : 'primario', acao: function () { decidido = true; resolve(true); } }
        ],
        aoFechar: function () { if (!decidido) resolve(false); }
      });
    });
  };

  CL.ui.pedirTexto = function (o) {
    o = o || {};
    return new Promise(function (resolve) {
      var decidido = false;
      var id = 'pt-' + CL.uid();
      var corpo = document.createElement('form');
      corpo.className = 'campo';
      corpo.innerHTML = '<label for="' + id + '"></label><input id="' + id + '" class="input" type="text" autocomplete="off" autofocus>';
      corpo.querySelector('label').textContent = o.rotulo || '';
      var input = corpo.querySelector('input');
      input.value = o.valor || '';
      if (o.placeholder) input.placeholder = o.placeholder;
      var m = CL.ui.modal({
        titulo: o.titulo || '',
        corpo: corpo,
        botoes: [
          { rotulo: o.cancelar || 'Cancelar', tipo: 'neutro', acao: function () { decidido = true; resolve(null); } },
          { rotulo: o.ok || 'OK', tipo: 'primario', acao: function () { decidido = true; resolve(input.value); } }
        ],
        aoFechar: function () { if (!decidido) resolve(null); }
      });
      corpo.addEventListener('submit', function (e) { e.preventDefault(); decidido = true; resolve(input.value); m.fechar({ motivo: 'enter' }); });
    });
  };

  CL.ui.toast = function (msg, o) {
    o = o || {};
    var host = raiz('toast-raiz');
    if (!host) { console.log('[toast]', msg); return { fechar: function () {} }; }
    while (toasts.length >= 3) toasts[0].fechar();
    var kind = o.kind || 'info';
    var icones = { ok: 'ti-circle-check', erro: 'ti-alert-circle', aviso: 'ti-alert-triangle', info: 'ti-info-circle' };
    var el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.setAttribute('role', kind === 'erro' ? 'alert' : 'status');
    el.innerHTML = '<i class="ti ' + (icones[kind] || icones.info) + '" aria-hidden="true"></i><span class="toast-msg"></span>';
    el.querySelector('.toast-msg').textContent = msg;
    var timer = null;
    var t = { el: el, fechar: fechar };
    function fechar() {
      clearTimeout(timer);
      var i = toasts.indexOf(t); if (i >= 0) toasts.splice(i, 1);
      el.classList.add('is-saindo');
      setTimeout(function () { el.remove(); }, 160);
    }
    if (o.action && typeof o.action.fn === 'function') {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'toast-acao';
      b.textContent = o.action.rotulo || o.action.label || 'OK';
      b.addEventListener('click', function () { fechar(); o.action.fn(); });
      el.appendChild(b);
    }
    if (o.fixo) {
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'toast-x'; x.setAttribute('aria-label', 'Fechar aviso');
      x.innerHTML = '<i class="ti ti-x" aria-hidden="true"></i>';
      x.addEventListener('click', fechar);
      el.appendChild(x);
    }
    host.appendChild(el);
    toasts.push(t);
    if (!o.fixo) timer = setTimeout(fechar, o.ms || (o.action ? 6000 : 4000));
    return t;
  };

  CL.ui.drawer = function (o) {
    o = o || {};
    if (drawerAtual) drawerAtual.fechar({ silencioso: true });
    var disparador = document.activeElement;
    var host = raiz('drawer-raiz');
    if (!host) throw new Error('drawer: #drawer-raiz não existe');
    var scrim = document.createElement('div'); scrim.className = 'scrim';
    var el = document.createElement('aside');
    el.className = 'drawer' + (o.largura === 'lg' ? ' drawer-lg' : '');
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'drawer-titulo');
    el.innerHTML = '<header class="drawer-cabeca"><h2 id="drawer-titulo"></h2><button type="button" class="btn btn-icone btn-fantasma" data-fecha="1" aria-label="Fechar"><i class="ti ti-x" aria-hidden="true"></i></button></header>' +
      '<div class="drawer-corpo"></div><footer class="drawer-rodape"></footer>';
    el.querySelector('#drawer-titulo').textContent = o.titulo || '';
    preencher(el.querySelector('.drawer-corpo'), o.corpo);
    preencher(el.querySelector('.drawer-rodape'), o.rodape);
    host.appendChild(scrim); host.appendChild(el);
    document.body.classList.add('has-drawer');
    if (o.largura === 'lg') document.body.classList.add('has-drawer-lg');
    var fechado = false;
    var ctx = { el: el, fechar: fechar, corpo: el.querySelector('.drawer-corpo'), rodape: el.querySelector('.drawer-rodape') };
    function fechar(info) {
      if (fechado) return; fechado = true;
      el.removeEventListener('keydown', aoTeclar);
      scrim.remove(); el.remove();
      if (drawerAtual === ctx) drawerAtual = null;
      if (!drawerAtual) document.body.classList.remove('has-drawer', 'has-drawer-lg');
      if (!(info && info.silencioso)) { devolverFoco(disparador); if (typeof o.aoFechar === 'function') { try { o.aoFechar(info || {}); } catch (e) { console.error(e); } } }
    }
    function aoTeclar(e) { prenderFoco(el, e); }
    el.addEventListener('keydown', aoTeclar);
    el.addEventListener('click', function (e) { if (e.target.closest('[data-fecha]')) fechar({ motivo: 'fechar' }); });
    scrim.addEventListener('click', function () { fechar({ motivo: 'fechar' }); });
    drawerAtual = ctx;
    requestAnimationFrame(function () {
      var alvo = el.querySelector('[autofocus]') || el.querySelector('.drawer-corpo ' + FOCAVEIS) || el.querySelector('[data-fecha]');
      if (alvo) { try { alvo.focus(); } catch (e) { /* sem foco */ } }
    });
    return ctx;
  };

  CL.ui.menu = function (ancoraEl, itens) {
    if (menuAtual) menuAtual.fechar();
    var el = document.createElement('div');
    el.className = 'menu'; el.setAttribute('role', 'menu');
    (itens || []).forEach(function (it, i) {
      if (it === '-' || (it && it.separador)) { var sep = document.createElement('div'); sep.className = 'menu-sep'; el.appendChild(sep); return; }
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'menu-item' + (it.tipo === 'perigo' ? ' is-perigo' : ''); b.setAttribute('role', 'menuitem');
      b.setAttribute('data-i', String(i));
      if (it.desabilitado) { b.disabled = true; if (it.dica) b.title = it.dica; }
      b.innerHTML = (it.icone ? '<i class="ti ' + CL.util.esc(it.icone) + '" aria-hidden="true"></i>' : '') + '<span></span>';
      b.querySelector('span').textContent = it.rotulo || '';
      el.appendChild(b);
    });
    document.body.appendChild(el);
    var r = ancoraEl && ancoraEl.getBoundingClientRect ? ancoraEl.getBoundingClientRect() : { left: 8, right: 8, top: 8, bottom: 8 };
    var w = el.offsetWidth, h = el.offsetHeight;
    var left = Math.min(r.left, window.innerWidth - w - 8);
    var top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    el.style.left = Math.max(8, left) + 'px'; el.style.top = top + 'px';
    var ctx = { el: el, fechar: fechar };
    function fechar() {
      el.remove();
      document.removeEventListener('mousedown', fora, true);
      document.removeEventListener('touchstart', fora, true);
      window.removeEventListener('resize', fechar);
      if (menuAtual === ctx) menuAtual = null;
      devolverFoco(ancoraEl);
    }
    function fora(e) { if (!el.contains(e.target)) fechar(); }
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-i]'); if (!b || b.disabled) return;
      var it = itens[+b.getAttribute('data-i')];
      fechar();
      if (it && typeof it.fn === 'function') it.fn();
    });
    el.addEventListener('keydown', function (e) {
      var bs = Array.prototype.slice.call(el.querySelectorAll('.menu-item:not(:disabled)'));
      var i = bs.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (bs[i + 1] || bs[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (bs[i - 1] || bs[bs.length - 1]).focus(); }
      else if (e.key === 'Tab') { fechar(); }
    });
    setTimeout(function () {
      document.addEventListener('mousedown', fora, true);
      document.addEventListener('touchstart', fora, true);
      window.addEventListener('resize', fechar);
    }, 0);
    menuAtual = ctx;
    var primeiro = el.querySelector('.menu-item:not(:disabled)'); if (primeiro) primeiro.focus();
    return ctx;
  };

  CL.ui.vazio = function (el, o) {
    o = o || {};
    var box = document.createElement('div');
    box.className = 'vazio';
    box.innerHTML = '<i class="ti ' + CL.util.esc(o.icone || 'ti-inbox') + ' vazio-icone" aria-hidden="true"></i><h3></h3><p></p>';
    box.querySelector('h3').textContent = o.titulo || '';
    box.querySelector('p').textContent = o.texto || '';
    if (!o.texto) box.querySelector('p').remove();
    if (o.acao && typeof o.acao.fn === 'function') {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-primario';
      b.innerHTML = (o.acao.icone ? '<i class="ti ' + CL.util.esc(o.acao.icone) + '" aria-hidden="true"></i>' : '') + '<span></span>';
      b.querySelector('span').textContent = o.acao.rotulo || 'OK';
      b.addEventListener('click', o.acao.fn);
      box.appendChild(b);
    }
    el.innerHTML = ''; el.appendChild(box);
    return box;
  };
  CL.ui.carregando = function (el, texto, o) {
    o = o || {};
    var linhas = o.linhas || 4;
    var html = '<div class="skeleton" aria-busy="true" aria-live="polite">';
    html += '<div class="skeleton-bloco" style="height:32px;width:40%"></div>';
    for (var i = 0; i < linhas; i++) html += '<div class="skeleton-bloco" style="height:44px"></div>';
    html += '<div class="skeleton-texto"></div></div>';
    el.innerHTML = html;
    el.querySelector('.skeleton-texto').textContent = texto || 'Carregando…';
  };
  CL.ui.erro = function (el, o) {
    o = o || {};
    var box = document.createElement('div');
    box.className = 'erro-bloco';
    box.innerHTML = '<i class="ti ti-alert-circle" aria-hidden="true"></i><p></p>';
    box.querySelector('p').textContent = o.texto || 'Algo deu errado.';
    if (o.acao && typeof o.acao.fn === 'function') {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-neutro'; b.textContent = o.acao.rotulo || 'Tentar de novo';
      b.addEventListener('click', o.acao.fn);
      box.appendChild(b);
    }
    el.innerHTML = ''; el.appendChild(box);
    return box;
  };
  CL.ui.fecharTudo = function () {
    if (menuAtual) menuAtual.fechar();
    if (modalAtual) modalAtual.fechar({ motivo: 'fechar' });
    if (drawerAtual) drawerAtual.fechar({ motivo: 'fechar' });
  };
  CL.ui.aberto = function () { return { modal: !!modalAtual, drawer: !!drawerAtual, menu: !!menuAtual }; };

  /* Esc fecha o que estiver por cima (menu > modal > drawer). */
  function fecharTopo() {
    if (menuAtual) { menuAtual.fechar(); return true; }
    if (modalAtual) { modalAtual.fechar({ motivo: 'esc' }); return true; }
    if (drawerAtual) { drawerAtual.fechar({ motivo: 'esc' }); return true; }
    return false;
  }

  /* =================== atalhos =================== */
  CL.keys = {
    _mapas: {}, _vista: null,
    register: function (vista, mapa) { CL.keys._mapas[vista] = mapa || {}; }
  };
  document.addEventListener('keydown', function (e) {
    var alvo = e.target;
    var emInput = !!(alvo && alvo.matches && alvo.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
    if (e.key === 'Escape') {
      if (fecharTopo()) { e.preventDefault(); return; }
      if (emInput) return;
    } else {
      if (emInput || e.ctrlKey || e.metaKey || e.altKey) return;
      if (modalAtual || drawerAtual || menuAtual) return;
    }
    var mapa = CL.keys._mapas[CL.keys._vista];
    if (!mapa) return;
    var fn = mapa[e.key] || mapa[String(e.key).toLowerCase()];
    if (typeof fn === 'function') { e.preventDefault(); fn(e); }
  });

  /* =================== roteador =================== */
  var rotas = {}, atual = null, montado = null, pendenteDestino = null, navegacoes = 0, iniciado = false;
  var GUARDAS = { atendimento: 'clinico', config: 'config' };
  var MSG_GUARDA = { clinico: 'Seu perfil não abre o prontuário', config: 'Só o administrador abre os ajustes' };

  function salvarScroll(vista) {
    var el = raiz('vista');
    if (!el) return;
    try { sessionStorage.setItem('ca.scroll.' + vista, String(el.scrollTop)); } catch (e) { /* sem storage */ }
  }
  function restaurarScroll(vista) {
    var el = raiz('vista');
    if (!el) return;
    var v = 0;
    try { v = +sessionStorage.getItem('ca.scroll.' + vista) || 0; } catch (e) { v = 0; }
    requestAnimationFrame(function () { el.scrollTop = v; });
  }
  function marcarNav(vista) {
    var links = document.querySelectorAll('#nav a[data-vista]');
    Array.prototype.forEach.call(links, function (a) {
      if (a.getAttribute('data-vista') === vista) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }
  function desmontar() {
    if (montado && typeof montado.unmount === 'function') {
      try { montado.unmount(); } catch (e) { console.error('[CL] unmount falhou', e); }
    }
    montado = null;
    CL.keys._vista = null;
    var el = raiz('vista');
    if (el) el.innerHTML = '';
    if (menuAtual) menuAtual.fechar();
    if (drawerAtual) drawerAtual.fechar({ silencioso: true });
  }
  function aoMudarHash() {
    var r = CL.route.parse(location.hash);
    if (!sessao) {
      pendenteDestino = (r.vista && r.vista !== 'login') ? r.hash : null;
      if (atual) salvarScroll(atual.vista);
      desmontar(); atual = null;
      if (window.Login && typeof Login.gate === 'function') {
        Login.gate().then(function () { CL.route.go(pendenteDestino || '#/agenda', { replace: true }); });
      }
      return;
    }
    if (!r.vista || r.vista === 'login') {
      var dest = pendenteDestino || '#/agenda'; pendenteDestino = null;
      CL.route.go(dest, { replace: true });
      return;
    }
    pendenteDestino = null;
    var mod = rotas[r.vista];
    if (!mod) { CL.route.go('#/agenda', { replace: true }); return; }
    var guarda = GUARDAS[r.vista];
    var excecao = r.vista === 'config' && (r.seg[0] === 'sobre');
    if (guarda && !excecao && !CL.can(guarda)) {
      CL.ui.toast(MSG_GUARDA[guarda] || 'Sem permissão', { kind: 'aviso' });
      CL.route.go('#/agenda', { replace: true });
      return;
    }
    if (atual) salvarScroll(atual.vista);
    desmontar();
    atual = r; navegacoes++;
    var el = raiz('vista');
    if (!el) return;
    el.scrollTop = 0;
    el.setAttribute('data-vista', r.vista);
    try {
      mod.mount(el, { seg: r.seg, q: r.q, vista: r.vista, hash: r.hash });
      montado = mod;
    } catch (e) {
      console.error('[CL] mount de ' + r.vista + ' falhou', e);
      CL.ui.erro(el, { texto: 'Esta tela não pôde ser aberta.', acao: { rotulo: 'Ir para a agenda', fn: function () { CL.route.go('#/agenda'); } } });
    }
    restaurarScroll(r.vista);
    marcarNav(r.vista);
    CL.keys._vista = r.vista;
    CL.emit('route', r);
  }
  CL.route = {
    register: function (vista, modulo) { rotas[vista] = modulo; },
    parse: function (hash) {
      var h = String(hash || '').replace(/^#/, '');
      if (h.charAt(0) !== '/') h = '/' + h;
      var qi = h.indexOf('?');
      var caminho = qi >= 0 ? h.slice(0, qi) : h;
      var query = qi >= 0 ? h.slice(qi + 1) : '';
      var partes = caminho.split('/').filter(Boolean).map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });
      var q = {};
      if (query) query.split('&').forEach(function (par) {
        if (!par) return;
        var ei = par.indexOf('=');
        var k = ei >= 0 ? par.slice(0, ei) : par, v = ei >= 0 ? par.slice(ei + 1) : '';
        try { q[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { q[k] = v; }
      });
      return { vista: partes[0] || '', seg: partes.slice(1), q: q, hash: '#' + h };
    },
    go: function (hash, opts) {
      var h = String(hash || '#/agenda');
      if (h.charAt(0) !== '#') h = '#' + (h.charAt(0) === '/' ? '' : '/') + h;
      if (location.hash === h) { aoMudarHash(); return; }
      if (opts && opts.replace) location.replace(location.pathname + location.search + h);
      else location.hash = h;
    },
    voltar: function () {
      if (navegacoes > 1) history.back();
      else CL.route.go('#/agenda', { replace: true });
    },
    start: function () {
      if (iniciado) return;
      iniciado = true;
      window.addEventListener('hashchange', aoMudarHash);
      aoMudarHash();
    },
    remontar: function () { if (atual) aoMudarHash(); }
  };
  Object.defineProperty(CL.route, 'current', { get: function () { return atual; } });

  /* =================== impressão A4 =================== */
  var CSS_DOC = '@page{size:A4;margin:20mm}' +
    'body{font:12pt/1.45 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#000;background:#fff;margin:0}' +
    '.doc-via{display:flex;flex-direction:column;min-height:250mm;page-break-after:always;position:relative}' +
    '.doc-via:last-child{page-break-after:auto}' +
    '.doc-via-rotulo{position:absolute;right:0;top:0;font-size:9pt;color:#333;border:1px solid #333;padding:2px 8px;border-radius:4px}' +
    '.doc-cab{display:flex;justify-content:space-between;gap:12mm;align-items:flex-start;border-bottom:1.5px solid #000;padding-bottom:4mm;font-size:9.5pt;line-height:1.35}' +
    '.doc-cab-esq{display:flex;gap:6mm;align-items:flex-start;flex:1;min-width:0}' +
    '.doc-logo{max-height:22mm;max-width:50mm;object-fit:contain}' +
    '.doc-clinica-nome,.doc-prof-nome{font-weight:700;font-size:11.5pt}' +
    '.doc-prof{text-align:right;flex:none}' +
    '.doc-paciente{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:10pt;margin-top:4mm;padding:2mm 0;border-bottom:1px solid #999}' +
    '.doc-emissao{font-size:9pt;color:#333;margin-top:2mm}' +
    '.doc-titulo{font-size:15pt;font-weight:700;text-align:center;margin:8mm 0 5mm;text-transform:uppercase;letter-spacing:.03em}' +
    '.doc-corpo{flex:1;font-size:12pt}' +
    '.doc-corpo p{margin:0 0 3mm}.doc-corpo ol,.doc-corpo ul{margin:0 0 3mm;padding-left:6mm}' +
    '.doc-pre{white-space:pre-wrap;font:inherit;margin:0}' +
    '.doc-item{display:flex;gap:4mm;margin-bottom:3mm}.doc-item-n{font-weight:700;flex:none;width:7mm}' +
    '.doc-assinatura{margin:16mm auto 0;width:75mm;text-align:center;font-size:10pt;line-height:1.35}' +
    '.doc-linha{border-top:1px solid #000;margin-bottom:1.5mm}' +
    '.doc-rodape{margin-top:8mm;border-top:1px solid #999;padding-top:2mm;font-size:8pt;color:#333;line-height:1.35}' +
    /* Prévia em iframe estreito (modal de 760 px): a folha usa border-box + max-width e encolhe sem cortar texto. */
    '@media screen{body{background:#eee;padding:8mm}.doc-via{box-sizing:border-box;background:#fff;padding:20mm;box-shadow:0 2px 12px rgba(0,0,0,.15);margin:0 auto 8mm;width:210mm;max-width:100%;min-height:297mm}}' +
    '@media screen and (max-width:800px){body{padding:4mm}.doc-via{padding:12mm;min-height:0}}';

  CL.print = {
    montar: function (o) {
      o = o || {};
      var e = CL.util.esc;
      var cfg = CL.state.cfg || {};
      var cl = cfg.clinica || {};
      var prof = o.profissional || {};
      var pac = o.paciente || null;
      var logo = '';
      try { logo = (window.Backend && Backend.logo) ? (Backend.logo.get() || '') : ''; } catch (err) { logo = ''; }
      var agora = new Date();
      var vias = Math.max(1, parseInt(o.vias, 10) || 1);
      var rot = Array.isArray(o.rotulosVias) ? o.rotulosVias : [];
      var conselho = [prof.conselho, prof.uf].filter(Boolean).join('-') + (prof.numero ? ' ' + prof.numero : '');
      var cab = '<header class="doc-cab"><div class="doc-cab-esq">' +
        (logo ? '<img class="doc-logo" src="' + e(logo) + '" alt="">' : '') +
        '<div class="doc-clinica"><div class="doc-clinica-nome">' + e(cl.nome || '') + '</div>' +
        (cl.endereco ? '<div>' + e(cl.endereco) + '</div>' : '') +
        ((cl.telefone || cl.email) ? '<div>' + [cl.telefone, cl.email].filter(Boolean).map(e).join(' · ') + '</div>' : '') +
        (cl.cnpj ? '<div>CNPJ ' + e(cl.cnpj) + '</div>' : '') + '</div></div>' +
        '<div class="doc-prof"><div class="doc-prof-nome">' + e(prof.nome || '') + '</div>' +
        (conselho.trim() ? '<div>' + e(conselho) + '</div>' : '') +
        (prof.rqe ? '<div>RQE ' + e(prof.rqe) + '</div>' : '') +
        (prof.especialidade ? '<div>' + e(prof.especialidade) + '</div>' : '') + '</div></header>';
      var linhaPac = '';
      if (pac) {
        var idade = CL.fmt.idade(pac.nasc);
        linhaPac = '<div class="doc-paciente"><span><strong>Paciente:</strong> ' + e(pac.nome || '') + '</span>' +
          (pac.cpf ? '<span><strong>CPF:</strong> ' + e(CL.fmt.cpf(pac.cpf)) + '</span>' : '') +
          (pac.nasc ? '<span><strong>Nascimento:</strong> ' + e(CL.fmt.data(pac.nasc)) + (idade ? ' (' + idade + ')' : '') + '</span>' : '') + '</div>';
      }
      var emissao = '<div class="doc-emissao">Emitido em ' + CL.fmt.data(CL.util.ymd(agora)) + ' às ' + CL.util.hhmmDe(agora) +
        (o.validade ? ' · Validade: ' + e(o.validade) : '') + '</div>';
      var assinatura = o.semAssinatura ? '' : '<div class="doc-assinatura"><div class="doc-linha"></div><div>' + e(prof.nome || '') + '</div>' +
        ((conselho.trim() || prof.rqe) ? '<div>' + e(conselho) + (prof.rqe ? ' · RQE ' + e(prof.rqe) : '') + '</div>' : '') + '</div>';
      var rodape = '<footer class="doc-rodape"><div>Documento gerado eletronicamente. Válido quando impresso e assinado pelo profissional ou assinado digitalmente com certificado ICP-Brasil.</div>' +
        (cl.rodape ? '<div>' + e(cl.rodape) + '</div>' : '') + '</footer>';
      var paginas = '';
      for (var i = 0; i < vias; i++) {
        paginas += '<section class="doc-via">' + (rot[i] ? '<div class="doc-via-rotulo">' + e(rot[i]) + '</div>' : '') +
          cab + linhaPac + emissao + '<h1 class="doc-titulo">' + e(o.titulo || '') + '</h1>' +
          '<div class="doc-corpo">' + (o.corpoHtml || '') + '</div>' + assinatura + rodape + '</section>';
      }
      return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>' + e(o.titulo || 'Documento') + '</title><style>' + CSS_DOC + '</style></head><body class="doc-a4">' + paginas + '</body></html>';
    },
    documento: function (o) {
      o = o || {};
      var pac = o.paciente || null;
      var prosseguir = Promise.resolve(true);
      if (pac && !pac.cpf && o.tipoDoc !== 'agenda') {
        prosseguir = CL.ui.confirmar({ titulo: 'Sem CPF na ficha', texto: 'O documento sai sem o CPF do paciente. Imprimir assim mesmo?', ok: 'Imprimir', cancelar: 'Voltar' });
      }
      return prosseguir.then(function (ok) {
        if (!ok) return false;
        var html = CL.print.montar(o);
        var iframe = raiz('print-raiz');
        if (!iframe) throw new Error('impressão: #print-raiz não existe');
        return new Promise(function (resolve) {
          var feito = false;
          function imprimir() {
            if (feito) return; feito = true;
            try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { console.error(e); }
            var acao = o.tipoDoc === 'receita' ? 'receita.imprimir' : 'documento.imprimir';
            var alvoId = o.documentoId || o.id || null;
            try { CL.audit(acao, o.tipoDoc || 'documento', alvoId, { pacId: pac ? pac.id : null, titulo: o.titulo || '' }); } catch (e) { console.error(e); }
            if (pac && pac.id && CL.get('pacientes', pac.id)) {
              try {
                var p = CL.get('pacientes', pac.id);
                var lg = p.lgpd && typeof p.lgpd === 'object' ? p.lgpd : { pedidos: [], compartilhamentos: [] };
                if (!Array.isArray(lg.compartilhamentos)) lg.compartilhamentos = [];
                lg.compartilhamentos.push({ em: Date.now(), tipo: 'impressao', alvo: o.tipoDoc || 'documento' });
                CL.patch('pacientes', p.id, { lgpd: lg });
              } catch (e) { console.error(e); }
            }
            resolve(true);
          }
          iframe.onload = function () { setTimeout(imprimir, 60); };
          iframe.srcdoc = html;
          setTimeout(imprimir, 2500);
        });
      });
    }
  };

  /* =================== casca: topo, sync, privacidade =================== */
  function atualizarTopo() {
    var nome = raiz('topo-nome'), perfil = raiz('topo-perfil'), av = raiz('topo-avatar');
    if (nome) nome.textContent = sessao ? sessao.nome : '';
    if (perfil) perfil.textContent = sessao ? CL.fmt.perfil(sessao.perfil) : '';
    if (av) av.textContent = sessao ? CL.util.iniciais(sessao.nome) || '--' : '--';
  }
  var estadoSync = { estado: 'local', em: null };
  function atualizarSync(info) {
    if (info) estadoSync = info;
    var b = raiz('topo-sync'); if (!b) return;
    var mapa = {
      local: ['ti-device-desktop', 'Modo local', ''],
      ok: ['ti-cloud-check', 'Sincronizado', 'is-ok'],
      offline: ['ti-cloud-off', 'Sem rede', 'is-offline'],
      erro: ['ti-alert-triangle', 'Erro ao salvar', 'is-erro']
    };
    var m = mapa[estadoSync.estado] || mapa.local;
    b.className = 'topo-pill ' + m[2];
    b.innerHTML = '<i class="ti ' + m[0] + '" aria-hidden="true"></i><span></span>';
    b.querySelector('span').textContent = m[1];
    b.title = m[1] + (estadoSync.em ? ' · ' + CL.fmt.dataHora(estadoSync.em) : '');
  }
  function abrirStatus() {
    var st = (window.Backend && Backend.status) ? Backend.status() : { modo: 'local' };
    var e = CL.util.esc;
    var corpo = '<dl class="pilha">' +
      '<div><dt class="rotulo">Modo</dt><dd>' + (st.modo === 'firebase' ? 'Sincronizado com o seu servidor' : 'Local — os dados ficam neste navegador') + '</dd></div>' +
      '<div><dt class="rotulo">Último salvamento</dt><dd>' + (st.ultimoSaveOk ? e(CL.fmt.dataHora(st.ultimoSaveOk)) : 'ainda não salvou nesta sessão') + '</dd></div>' +
      (st.modo === 'firebase' ? '<div><dt class="rotulo">Última sincronização</dt><dd>' + (st.ultimoSync ? e(CL.fmt.dataHora(st.ultimoSync)) : '—') + '</dd></div>' : '') +
      '<div><dt class="rotulo">Rede</dt><dd>' + (st.online === false ? 'sem conexão' : 'conectado') + '</dd></div>' +
      '<div><dt class="rotulo">Pendências</dt><dd>' + (st.pendentes ? 'há alterações que não puderam ser gravadas' : 'nenhuma') + '</dd></div></dl>';
    CL.ui.modal({
      titulo: 'Estado dos dados', corpo: corpo,
      botoes: [
        { rotulo: 'Exportar agora', tipo: 'neutro', icone: 'ti-download', acao: function () { exportarAgora(); }, fecha: false },
        { rotulo: 'Fechar', tipo: 'primario' }
      ]
    });
  }
  function wireTopo() {
    var bu = raiz('topo-usuario');
    if (bu) bu.addEventListener('click', function () {
      CL.ui.menu(bu, [
        { rotulo: 'Trocar usuário', icone: 'ti-switch-horizontal', fn: function () { if (window.Login) Login.trocarUsuario(); } },
        { rotulo: (sessao && sessao.privacidade) ? 'Desligar modo privacidade' : 'Modo privacidade', icone: 'ti-eye-off', fn: function () { CL.privacidade(); } },
        { rotulo: 'Estado dos dados', icone: 'ti-database', fn: abrirStatus },
        '-',
        { rotulo: 'Sair', icone: 'ti-logout', tipo: 'perigo', fn: function () { if (window.Login) Login.sair(); } }
      ]);
    });
    var bs = raiz('topo-sync');
    if (bs) bs.addEventListener('click', abrirStatus);
    var bp = raiz('topo-priv');
    if (bp) bp.addEventListener('click', function () { CL.privacidade(); });
    CL.on('session', atualizarTopo);
    CL.on('sync', atualizarSync);
    window.addEventListener('online', function () {
      atualizarSync({ estado: (window.Backend && Backend.modo === 'firebase') ? 'ok' : 'local', em: estadoSync.em });
      if (temSujos()) CL.persist();
    });
    window.addEventListener('offline', function () {
      if (window.Backend && Backend.modo === 'firebase') atualizarSync({ estado: 'offline', em: estadoSync.em });
    });
  }

  /* Assinatura barata do estado para ignorar snapshots iguais. */
  function assinatura(st) {
    var partes = [];
    CL.COLECOES.forEach(function (c) {
      var arr = Array.isArray(st[c]) ? st[c] : [];
      var max = 0;
      for (var i = 0; i < arr.length; i++) { var u = +(arr[i] && arr[i].updatedAt) || 0; if (u > max) max = u; }
      partes.push(c + ':' + arr.length + ':' + max);
    });
    partes.push('cfg:' + ((st.cfg && st.cfg.updatedAt) || 0));
    partes.push('tomb:' + Object.keys(st._tomb || {}).length);
    return partes.join('|');
  }

  /* =================== boot =================== */
  CL.boot = function () {
    var vistaEl = raiz('vista');
    if (document.body) document.body.setAttribute('data-densidade', CL.pref.get('densidade', 'padrao'));
    if (vistaEl) CL.ui.carregando(vistaEl, 'Abrindo o Clinicar…');
    var backend = window.Backend;
    if (!backend) {
      if (vistaEl) CL.ui.erro(vistaEl, { texto: 'backend.js não carregou. Recarregue a página.', acao: { rotulo: 'Recarregar', fn: function () { location.reload(); } } });
      return Promise.reject(new Error('Backend ausente'));
    }
    return backend.init(window.CLINICAR_CONFIG || {})
      .then(function () { return backend.load(); })
      .then(function (st) {
        CL.substituirEstado(st);
        return CL.seed();
      })
      .then(function () {
        backend.subscribe(function (novo, info) {
          if (info && info.sincronizarTudo) { CL.substituirEstado(novo); CL.persistTudo(); return; }
          if (assinatura(novo) === assinatura(CL.state)) return;
          CL.substituirEstado(novo);
          if (atual) CL.route.remontar();
        });
        wireTopo();
        atualizarTopo();
        atualizarSync({ estado: backend.modo === 'firebase' ? (navigator.onLine ? 'ok' : 'offline') : 'local', em: null });
        if (vistaEl) vistaEl.innerHTML = '';
        return Login.gate();
      })
      .then(function () {
        CL.route.start();
        resolverReady();
        if (typeof backend.aposBoot === 'function') backend.aposBoot();
      })
      .catch(function (err) {
        console.error('[CL] boot falhou', err);
        if (vistaEl) CL.ui.erro(vistaEl, { texto: 'O Clinicar não conseguiu abrir: ' + ((err && err.message) || 'erro desconhecido'), acao: { rotulo: 'Recarregar', fn: function () { location.reload(); } } });
      });
  };
})();
