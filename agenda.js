/* Clinicar — agenda.js (dono: agenda)
   Global único "Agenda". Visões Dia (uma coluna por profissional) / Semana / Mês / Lista, lista de espera,
   lembretes de amanhã, bloqueios e férias, encaixe explícito, arrastar para remarcar (pointer events; no
   toque, segurar 350 ms), redimensionar pela borda, status em um clique, WhatsApp via wa.me com texto
   pronto, notas do dia, próxima vaga, busca de consulta, impressão do dia e modo privacidade.
   Contrato: docs/ESPEC.md §4.7 e §5.1.
   Regras: escrita no estado SÓ por CL.upsert / CL.patch / CL.remove; zero alert/confirm/prompt;
   eventos por delegação (data-acao); estilo inline só para posição/altura/cor calculadas. */
(function () {
  'use strict';

  var U = CL.util;
  var e = function (s) { return U.esc(s); };

  /* =================== constantes =================== */
  var VISOES = ['dia', 'semana', 'mes', 'lista'];
  var ROTULO_VISAO = { dia: 'Dia', semana: 'Semana', mes: 'Mês', lista: 'Lista' };
  var CANCELADOS = { cancelado: true, cancelado_tarde: true, cancelado_clinica: true };
  var INATIVOS = { cancelado: true, cancelado_tarde: true, cancelado_clinica: true, faltou: true };
  var MOTIVOS_BLOQ = { ferias: 'Férias', feriado: 'Feriado', congresso: 'Congresso', reuniao: 'Reunião', almoco: 'Almoço', outro: 'Outro' };
  var CORES_PROF = ['#2B5CE6', '#0E8A6C', '#B3541E', '#7C3AED', '#C2185B', '#0F766E', '#B45309', '#4B5563'];
  var CONSELHOS = ['CRM', 'CRO', 'CRP', 'CREFITO', 'CRN', 'OUTRO'];
  var DIAS_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var DIAS_NOME = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var ROTULO_AVANCO = { confirmado: 'Confirmar', chegou: 'Chegou', em_atendimento: 'Iniciar atendimento', finalizado: 'Finalizar' };
  var MODELOS_PADRAO = {
    confirmar: 'Olá, {nome}! Confirmando sua consulta com {prof} em {data} às {hora}, na {clinica}. Endereço: {endereco}. Responda SIM para confirmar ou avise se precisar remarcar.',
    lembrete: 'Olá, {nome}! Lembrete: sua consulta com {prof} é em {data}, às {hora}, na {clinica}. Endereço: {endereco}. Até lá!',
    remarcar: 'Olá, {nome}. Precisamos remarcar sua consulta com {prof} de {data} às {hora}. Qual o melhor dia e horário para você?',
    tele: 'Olá, {nome}! Sua teleconsulta com {prof} é em {data} às {hora}. Entre pelo link: {link}. Fique em um lugar reservado e com boa conexão.',
    vaga: 'Olá, {nome}! Abriu um horário com {prof} em {data} às {hora}, na {clinica}. Quer ficar com ele? Responda SIM e reservamos para você.'
  };
  var ROTULO_MODELO = { confirmar: 'Confirmar', lembrete: 'Lembrete', remarcar: 'Remarcar', tele: 'Teleconsulta', vaga: 'Vaga' };
  var VAGA_DIAS = 7;
  var DESFAZER_MS = 60000;
  var TOQUE_MS = 350;
  var COLS_RENDER = { consultas: 1, bloqueios: 1, espera: 1, pacientes: 1, profissionais: 1, procedimentos: 1, convenios: 1, lancamentos: 1 };
  var HORARIO_PADRAO = { '1': [{ ini: '08:00', fim: '12:00' }, { ini: '14:00', fim: '18:00' }] };
  ['2', '3', '4', '5'].forEach(function (d) { HORARIO_PADRAO[d] = HORARIO_PADRAO['1'].map(function (t) { return { ini: t.ini, fim: t.fim }; }); });

  /* =================== estado do módulo =================== */
  var el = null;
  var st = { visao: 'dia', data: '', profs: [] };
  var modoVaga = null, manterModoVaga = false;
  var unsubs = [], timerAgora = null, timerResize = null, rafRender = null, renderAdiado = false, primeiraRender = false;
  var pend = null, arraste = null, ultimoArrasteEm = 0;
  var formAberto = null;
  var faltasCache = {};

  /* =================== acesso ao estado =================== */
  function hoje() { return U.hoje(); }
  function agoraMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function cfg() { return CL.state.cfg || {}; }
  function cfgAgenda() { return cfg().agenda || {}; }
  function politica() { return cfg().politica || {}; }
  /* A escolha de colunas é PESSOAL. Sem escopo por usuário, quem entrasse depois
     herdava a seleção do anterior — e um profissional acabava vendo a fila dos
     outros em vez da própria. */
  function chaveProfs() {
    var s = CL.session;
    return 'agenda.profs' + (s && s.usuarioId ? '.' + s.usuarioId : '');
  }
  function profsAtivos() { return CL.col('profissionais').filter(function (p) { return p && p.ativo !== false; }); }
  function procsAtivos() { return CL.col('procedimentos').filter(function (p) { return p && p.ativo !== false; }); }
  function convsAtivos() { return CL.col('convenios').filter(function (c) { return c && c.ativo !== false; }); }
  function prof(id) { return id ? CL.get('profissionais', id) : undefined; }
  function proc(id) { return id ? CL.get('procedimentos', id) : undefined; }
  function pac(id) { return id ? CL.get('pacientes', id) : undefined; }
  function conv(id) { return id ? CL.get('convenios', id) : undefined; }
  function nomeProf(id) { var p = prof(id); return p ? p.nome : '—'; }
  /* Rótulos curtos e ÚNICOS por profissional (abas da espera, chips do celular): "Dra. Ana Lima" e
     "Dr. Ana Souza" viram "Ana L." / "Ana S." e "AL" / "AS" — nunca "Dra." nem "DF" repetidos. */
  var rotulosCache = null;
  function rotulosProfs() {
    var lista = profsAtivos();
    var chave = lista.map(function (p) { return p.id + ':' + p.nome; }).join('|');
    if (rotulosCache && rotulosCache.chave === chave) return rotulosCache;
    var partesDe = function (p) { return U.semTitulo(p.nome).split(/\s+/).filter(Boolean); };
    var candidatosNome = function (p) {
      var t = partesDe(p), f = t[0] || String(p.nome || '?'), u = t.length > 1 ? t[t.length - 1] : '';
      return [f, u ? f + ' ' + u[0] + '.' : f, u ? f + ' ' + u : f, U.semTitulo(p.nome) || f];
    };
    var candidatosIni = function (p) {
      var t = partesDe(p), f = t[0] || String(p.nome || '?'), u = t.length > 1 ? t[t.length - 1] : '';
      return [U.iniciais(p.nome) || '?', (f.slice(0, 2) + (u ? u[0] : '')).toUpperCase(), f.slice(0, 3).toUpperCase(), (f.slice(0, 2) + (u ? u.slice(0, 2) : '')).toUpperCase()];
    };
    var unicos = function (gerar) {
      var out = {}, nivel = {};
      lista.forEach(function (p) { nivel[p.id] = 0; });
      for (var k = 0; k < 5; k++) {
        var usados = {};
        lista.forEach(function (p) { var c = gerar(p); out[p.id] = c[Math.min(nivel[p.id], c.length - 1)]; usados[out[p.id]] = (usados[out[p.id]] || 0) + 1; });
        var colidiu = false;
        lista.forEach(function (p) { if (usados[out[p.id]] > 1) { colidiu = true; nivel[p.id]++; } });
        if (!colidiu) break;
      }
      var vistos = {};
      lista.forEach(function (p) { var r = out[p.id]; vistos[r] = (vistos[r] || 0) + 1; if (vistos[r] > 1) out[p.id] = r + ' ' + vistos[r]; });
      return out;
    };
    rotulosCache = { chave: chave, nome: unicos(candidatosNome), ini: unicos(candidatosIni) };
    return rotulosCache;
  }
  function rotuloProf(p) { return p ? (rotulosProfs().nome[p.id] || U.nomeCurto(p.nome) || String(p.nome || '')) : ''; }
  function iniciaisProf(p) { return p ? (rotulosProfs().ini[p.id] || U.iniciais(p.nome) || '?') : ''; }
  function nomePac(c) { var p = pac(c && c.pacId); return p ? CL.nomeExibido(p.nome) : 'Sem paciente'; }
  function nomeReal(c) { var p = pac(c && c.pacId); return p ? p.nome : ''; }
  function slotDe(p) { return Math.max(5, parseInt(p && p.slot, 10) || parseInt(cfgAgenda().slotBase, 10) || 15); }
  function maxEncaixes(p) { var n = parseInt(p && p.maxEncaixesHora, 10); return isNaN(n) ? 1 : Math.max(0, n); }
  function durDe(c) { return Math.max(5, parseInt(c && c.dur, 10) || 30); }
  function fimDe(c) { return U.min(c.hora) + durDe(c); }
  function ativa(c) { return !!c && !INATIVOS[c.status]; }
  function ordenar(lista) {
    return lista.slice().sort(function (a, b) {
      return (a.data < b.data ? -1 : a.data > b.data ? 1 : 0) || (U.min(a.hora) - U.min(b.hora)) || ((a.encaixe ? 1 : 0) - (b.encaixe ? 1 : 0)) || ((a.createdAt || 0) - (b.createdAt || 0));
    });
  }
  function consultasDia(data, profId) {
    return CL.col('consultas').filter(function (c) { return c && c.data === data && (!profId || c.profId === profId); });
  }
  function diaSemana(data) { var d = U.dataDe(data); return d ? d.getDay() : 0; }
  function temHorarios(p) {
    var h = p && p.horarios;
    return !!h && Object.keys(h).some(function (k) { return Array.isArray(h[k]) && h[k].length > 0; });
  }
  function turnos(p, data) {
    var h = p && p.horarios;
    var t = h && h[String(diaSemana(data))];
    return Array.isArray(t) ? t.filter(function (x) { return x && x.ini && x.fim && U.min(x.fim) > U.min(x.ini); }) : [];
  }
  function dentroTurno(p, data, a, z) {
    return turnos(p, data).some(function (t) { return U.min(t.ini) <= a && U.min(t.fim) >= z; });
  }
  function bloqueiosDe(data, profId) {
    return CL.col('bloqueios').filter(function (b) {
      if (!b || !b.dataIni || !b.dataFim) return false;
      if (b.dataIni > data || b.dataFim < data) return false;
      if (!profId) return true;
      return !b.profId || b.profId === profId;
    });
  }
  function bloqueioIntervalo(b, data) {
    if (b.diaInteiro) return [0, 1440];
    var ini = U.min(b.horaIni || '00:00'), fim = U.min(b.horaFim || '23:59');
    if (b.dataIni === b.dataFim) return [ini, Math.max(fim, ini + 5)];
    if (data === b.dataIni) return [ini, 1440];
    if (data === b.dataFim) return [0, Math.max(fim, 5)];
    return [0, 1440];
  }
  function rotuloBloqueio(b) {
    var m = MOTIVOS_BLOQ[b.motivo] || 'Bloqueio';
    return b.descricao ? m + ' — ' + b.descricao : m;
  }
  function sobrepoe(a1, a2, b1, b2) { return a1 < b2 && b1 < a2; }
  function instante(c) {
    var d = U.dataDe(c.data);
    if (!d) return 0;
    var m = U.min(c.hora);
    d.setHours(Math.floor(m / 60), m % 60, 0, 0);
    return d.getTime();
  }
  function usuarioAtual() { return CL.session ? CL.session.nome : ''; }
  function historico(c, item) {
    if (!Array.isArray(c.historico)) c.historico = [];
    c.historico.push(Object.assign({ em: Date.now(), usuario: usuarioAtual() }, item));
  }
  function capitalizar(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function dataCurta(ymd) { return CL.fmt.dataExtenso(ymd, true); }
  function foneWa(fone) {
    var d = U.digits(fone);
    if (!d) return '';
    if ((d.length === 10 || d.length === 11) && d.slice(0, 2) !== '55') d = '55' + d;
    return d;
  }
  function preencherModelo(texto, mapa) {
    return String(texto || '').replace(/\{(\w+)\}/g, function (tudo, k) { return (k in mapa) ? String(mapa[k] == null ? '' : mapa[k]) : tudo; });
  }
  function modeloWa(chave) {
    var m = (cfg().whatsapp && cfg().whatsapp.modelos) || {};
    return m[chave] || MODELOS_PADRAO[chave] || m.confirmar || MODELOS_PADRAO.confirmar;
  }

  /* ---- pacientes: usa Pacientes.* quando o módulo existir; senão, reserva própria ---- */
  function buscarPacientes(q, opts) {
    opts = opts || {};
    if (window.Pacientes && typeof Pacientes.buscar === 'function') return Pacientes.buscar(q, { limite: opts.limite || 8, inativos: !!opts.inativos });
    q = String(q || '');
    if (q.indexOf('@') >= 0) q = '';
    var n = U.norm(q), d = U.digits(q), limite = opts.limite || 8;
    var lista = CL.col('pacientes').filter(function (p) { return p && (opts.inativos || p.ativo !== false); });
    lista.sort(function (a, b) { return U.norm(a.nome) < U.norm(b.nome) ? -1 : 1; });
    if (!n) return lista.slice(0, limite);
    var mData = q.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    return lista.filter(function (p) {
      if (U.norm(p.nome).indexOf(n) >= 0) return true;
      if (p.nomeSocial && U.norm(p.nomeSocial).indexOf(n) >= 0) return true;
      if (d.length >= 3 && !mData && (U.digits(p.cpf).indexOf(d) >= 0 || U.digits(p.fone).indexOf(d) >= 0)) return true;
      if (mData && p.nasc) {
        var dd = ('0' + mData[1]).slice(-2), mm = ('0' + mData[2]).slice(-2);
        if (p.nasc.slice(5) === mm + '-' + dd && (!mData[3] || p.nasc.slice(0, 4) === mData[3])) return true;
      }
      return false;
    }).slice(0, limite);
  }
  function pacienteRapido(d) {
    if (window.Pacientes && typeof Pacientes.rapido === 'function') return Pacientes.rapido(d);
    var nome = String(d.nome || '').trim();
    var igual = CL.col('pacientes').filter(function (p) { return p && p.ativo !== false && U.norm(p.nome) === U.norm(nome); })[0];
    if (igual) {
      return CL.ui.confirmar({ titulo: 'Paciente já cadastrado', texto: 'Já existe uma ficha com este nome. Usar a ficha existente?', ok: 'Usar existente', cancelar: 'Criar outra' })
        .then(function (usar) { return usar ? igual : criarPaciente(d); });
    }
    return criarPaciente(d);
  }
  function criarPaciente(d) {
    var off = { ativo: false, em: null, origem: '' };
    return CL.upsert('pacientes', {
      nome: String(d.nome || '').trim(), nomeSocial: '', nasc: d.nasc || '', sexo: '', cpf: '', fone: U.digits(d.fone || ''), email: '',
      endereco: '', nomeMae: '', naturalidade: '', convenioId: 'particular', convenioNumero: '', origem: '',
      alergias: '', problemas: '', meds: '', obs: '',
      consentimentos: { lembretes: Object.assign({}, off), campanhas: Object.assign({}, off), compartilhamento: Object.assign({}, off) },
      cidAutorizacoes: [], lgpd: { pedidos: [], compartilhamentos: [] }, ativo: true, inativadoEm: null
    });
  }
  function faltasDe(pacId) {
    if (!pacId) return { faltas: 0, tardios: 0, total: 0, risco: false };
    if (faltasCache[pacId]) return faltasCache[pacId];
    var r;
    if (window.Pacientes && typeof Pacientes.faltas === 'function') r = Pacientes.faltas(pacId, { meses: 12 });
    else {
      var limite = U.addDias(hoje(), -365), f = 0, t = 0;
      CL.col('consultas').forEach(function (c) {
        if (!c || c.pacId !== pacId || c.data < limite) return;
        if (c.status === 'faltou') f++; else if (c.status === 'cancelado_tarde') t++;
      });
      r = { faltas: f, tardios: t, total: f + t, risco: f + t >= 3 };
    }
    faltasCache[pacId] = r;
    return r;
  }
  function selos(p) {
    if (!p) return '';
    if (window.Pacientes && typeof Pacientes.selo === 'function') return Pacientes.selo(p.id) || '';
    var s = '';
    var f = faltasDe(p.id);
    if (f.risco) s += '<span class="chip chip-aviso" title="' + f.faltas + ' falta(s) e ' + f.tardios + ' cancelamento(s) tardio(s) em 12 meses"><i class="ti ti-alert-triangle" aria-hidden="true"></i>Risco de falta</span>';
    if (p.alergias) s += '<span class="chip chip-erro" title="' + e(p.alergias) + '"><i class="ti ti-alert-circle" aria-hidden="true"></i>Alergia</span>';
    return s;
  }
  function abrirFicha(id) {
    if (window.Pacientes && typeof Pacientes.abrirFicha === 'function') Pacientes.abrirFicha(id);
    else CL.route.go('#/pacientes/' + id);
  }

  /* =================== regras puras =================== */
  function conflitos(q) {
    q = q || {};
    var out = [];
    var a = U.min(q.hora), z = a + Math.max(5, parseInt(q.dur, 10) || 30);
    var p = prof(q.profId);
    consultasDia(q.data, q.profId).forEach(function (c) {
      if (c.id === q.ignorarId || !ativa(c)) return;
      var ca = U.min(c.hora), cz = fimDe(c);
      if (sobrepoe(a, z, ca, cz)) out.push({ tipo: 'sobreposicao', consultaId: c.id, texto: c.hora + ' já tem ' + nomePac(c) + (c.encaixe ? ' (encaixe)' : '') });
    });
    bloqueiosDe(q.data, q.profId).forEach(function (b) {
      var iv = bloqueioIntervalo(b, q.data);
      if (!sobrepoe(a, z, iv[0], iv[1])) return;
      if (q.encaixe && !b.diaInteiro) return;
      out.push({ tipo: 'bloqueio', bloqueioId: b.id, texto: 'Horário bloqueado: ' + rotuloBloqueio(b) });
    });
    if (p && temHorarios(p)) {
      var ts = turnos(p, q.data);
      if (!ts.length) out.push({ tipo: 'fora_turno', texto: p.nome + ' não atende neste dia' });
      else if (!dentroTurno(p, q.data, a, z)) out.push({ tipo: 'fora_turno', texto: 'Fora do horário de ' + p.nome + ' (' + ts.map(function (t) { return t.ini + '–' + t.fim; }).join(', ') + ')' });
    }
    if (q.pacId) {
      consultasDia(q.data).forEach(function (c) {
        if (c.id === q.ignorarId || c.pacId !== q.pacId || !ativa(c)) return;
        out.push({ tipo: 'mesmo_paciente', consultaId: c.id, texto: 'Este paciente já tem consulta neste dia às ' + c.hora + (c.profId !== q.profId ? ' com ' + nomeProf(c.profId) : '') });
      });
    }
    if (q.encaixe) {
      var max = maxEncaixes(p), hh = String(q.hora || '').slice(0, 2);
      var n = consultasDia(q.data, q.profId).filter(function (c) { return c.id !== q.ignorarId && c.encaixe && ativa(c) && String(c.hora).slice(0, 2) === hh; }).length;
      if (n >= max) out.push({ tipo: 'limite_encaixe', texto: max === 0 ? 'Este profissional não aceita encaixes' : 'Limite de ' + max + ' encaixe' + (max > 1 ? 's' : '') + ' por hora já atingido' });
    }
    return out;
  }
  function duros(lista, encaixe) {
    return (lista || []).filter(function (x) { return x.tipo === 'bloqueio' || x.tipo === 'limite_encaixe' || (x.tipo === 'sobreposicao' && !encaixe); });
  }
  function avisosDe(lista) {
    return (lista || []).filter(function (x) { return x.tipo === 'fora_turno' || x.tipo === 'mesmo_paciente'; });
  }
  function particionar(lista) {
    var itens = lista.map(function (c) { return { id: c.id, a: U.min(c.hora), z: fimDe(c) }; })
      .sort(function (x, y) { return (x.a - y.a) || (x.z - y.z); });
    var out = {}, cluster = [], fins = [], maxLanes = 0;
    function fechar() {
      cluster.forEach(function (it) { out[it.id].total = maxLanes; });
      cluster = []; fins = []; maxLanes = 0;
    }
    itens.forEach(function (it) {
      if (cluster.length) {
        var fimCluster = 0;
        fins.forEach(function (f) { if (f > fimCluster) fimCluster = f; });
        if (it.a >= fimCluster) fechar();
      }
      var lane = -1;
      for (var l = 0; l < fins.length; l++) if (fins[l] <= it.a) { lane = l; break; }
      if (lane < 0) { lane = fins.length; fins.push(0); }
      fins[lane] = it.z;
      out[it.id] = { lane: lane, total: 1 };
      cluster.push(it);
      if (fins.length > maxLanes) maxLanes = fins.length;
    });
    if (cluster.length) fechar();
    return out;
  }
  function faixaDe(datas, profIds) {
    if (st.ver24) return [0, 1440];
    var ini = U.min(cfgAgenda().horaIni || '07:00'), fim = U.min(cfgAgenda().horaFim || '19:00');
    datas.forEach(function (d) {
      profIds.forEach(function (pid) {
        turnos(prof(pid), d).forEach(function (t) { ini = Math.min(ini, U.min(t.ini)); fim = Math.max(fim, U.min(t.fim)); });
        consultasDia(d, pid).forEach(function (c) { if (st.ocultarCancelados && CANCELADOS[c.status]) return; ini = Math.min(ini, U.min(c.hora)); fim = Math.max(fim, fimDe(c)); });
      });
    });
    ini = Math.max(0, Math.floor(ini / 60) * 60);
    fim = Math.min(1440, Math.ceil(fim / 60) * 60);
    if (fim <= ini) fim = Math.min(1440, ini + 60);
    return [ini, fim];
  }
  function esperaAguardando() { return CL.col('espera').filter(function (x) { return x && x.status === 'aguardando'; }); }
  function elegiveis(q) {
    q = q || {};
    var dia = q.data ? diaSemana(q.data) : null;
    var m = q.hora ? U.min(q.hora) : null;
    return esperaAguardando().filter(function (x) {
      if (q.profId && x.profId && x.profId !== q.profId) return false;
      if (dia != null && Array.isArray(x.diasPref) && x.diasPref.length && x.diasPref.map(Number).indexOf(dia) < 0) return false;
      if (m != null && x.horaPref && (x.horaPref.ini || x.horaPref.fim)) {
        if (x.horaPref.ini && m < U.min(x.horaPref.ini)) return false;
        if (x.horaPref.fim && m > U.min(x.horaPref.fim)) return false;
      }
      return true;
    }).sort(function (a, b) {
      var ua = a.prioridade === 'urgente' ? 0 : 1, ub = b.prioridade === 'urgente' ? 0 : 1;
      return (ua - ub) || ((a.createdAt || 0) - (b.createdAt || 0));
    });
  }
  function slotPreenchido(c) {
    var a = U.min(c.hora), z = fimDe(c);
    return consultasDia(c.data, c.profId).some(function (o) { return o.id !== c.id && ativa(o) && sobrepoe(a, z, U.min(o.hora), fimDe(o)); });
  }
  function vagasAbertas(data, profId) {
    var limite = Date.now() - VAGA_DIAS * 86400000;
    var out = [];
    consultasDia(data, profId).forEach(function (c) {
      if (!INATIVOS[c.status]) return;
      var em = (c.cancelamento && c.cancelamento.em) || c.updatedAt || 0;
      if (em < limite) return;
      if (instante(c) <= Date.now()) return;
      if (slotPreenchido(c)) return;
      var n = elegiveis({ data: c.data, hora: c.hora, profId: c.profId }).length;
      if (n > 0) out.push({ consulta: c, n: n });
    });
    return out;
  }
  function lembretesDe(data) {
    return ordenar(consultasDia(data).filter(function (c) { return c.status === 'agendado' && !c.confirmadoEm; }))
      .map(function (c) { var p = pac(c.pacId); return { consultaId: c.id, pacId: c.pacId, fone: p ? U.digits(p.fone) : '', status: c.status, hora: c.hora, profId: c.profId }; })
      .filter(function (x) { return x.fone.length >= 10; });
  }

  /* =================== operações (gravam via CL.upsert) =================== */
  function normalizarDados(d) {
    d = d || {};
    return {
      id: d.id || null, pacId: d.pacId || null, profId: d.profId || '', procId: d.procId || '',
      data: String(d.data || '').slice(0, 10), hora: CL.fmt.hora(d.hora || ''), dur: Math.max(5, parseInt(d.dur, 10) || 30),
      convenioId: d.convenioId || null, encaixe: !!d.encaixe, encaixeMotivo: String(d.encaixeMotivo || '').trim(),
      obs: String(d.obs || '').trim(), teleLink: String(d.teleLink || '').trim(), esperaId: d.esperaId || null, origem: d.origem || ''
    };
  }
  function salvar(dados, opts) {
    opts = opts || {};
    var d = normalizarDados(dados);
    if (opts.forcarEncaixe) d.encaixe = true;
    var erros = [];
    if (!d.pacId || !pac(d.pacId)) erros.push({ tipo: 'paciente', texto: 'Escolha ou cadastre o paciente' });
    if (!d.profId || !prof(d.profId)) erros.push({ tipo: 'profissional', texto: 'Escolha o profissional' });
    if (!U.dataDe(d.data)) erros.push({ tipo: 'data', texto: 'Informe a data' });
    if (!/^\d{2}:\d{2}$/.test(d.hora)) erros.push({ tipo: 'hora', texto: 'Informe a hora' });
    if (d.encaixe && !d.encaixeMotivo) erros.push({ tipo: 'encaixe', texto: 'Informe o motivo do encaixe' });
    if (d.teleLink) {
      /* "meet.exemplo.com/abc" ganha https://; qualquer outro esquema (javascript:, data:…) é recusado. */
      if (!/^[a-z][a-z0-9+.-]*:/i.test(d.teleLink)) d.teleLink = 'https://' + d.teleLink;
      d.teleLink = U.urlSegura(d.teleLink);
      if (!d.teleLink) erros.push({ tipo: 'tele', texto: 'O link da teleconsulta precisa começar com https://' });
    }
    if (erros.length) return { ok: false, conflitos: erros, avisos: [] };
    var todos = conflitos({ data: d.data, hora: d.hora, dur: d.dur, profId: d.profId, pacId: d.pacId, ignorarId: d.id, encaixe: d.encaixe });
    var hard = duros(todos, d.encaixe), soft = avisosDe(todos);
    if (hard.length) return { ok: false, conflitos: hard, avisos: soft };
    if (soft.length && !opts.ignorarAvisos) return { ok: false, conflitos: [], avisos: soft };
    var existente = d.id ? CL.get('consultas', d.id) : null;
    if (existente) {
      var mudou = existente.data !== d.data || existente.hora !== d.hora || existente.profId !== d.profId;
      var de = existente.data + ' ' + existente.hora + ' · ' + nomeProf(existente.profId);
      ['pacId', 'profId', 'procId', 'data', 'hora', 'dur', 'convenioId', 'encaixe', 'encaixeMotivo', 'obs', 'teleLink'].forEach(function (k) { existente[k] = d[k]; });
      if (mudou) {
        historico(existente, { acao: 'remarcada', de: de, para: d.data + ' ' + d.hora + ' · ' + nomeProf(d.profId) });
        if (existente.status === 'confirmado') { existente.status = 'agendado'; existente.confirmadoEm = null; }
      } else historico(existente, { acao: 'editada' });
      return { ok: true, consulta: CL.upsert('consultas', existente), avisos: soft };
    }
    var c = {
      data: d.data, hora: d.hora, dur: d.dur, profId: d.profId, pacId: d.pacId, procId: d.procId, status: 'agendado',
      encaixe: d.encaixe, encaixeMotivo: d.encaixeMotivo, obs: d.obs, origem: d.origem || (d.esperaId ? 'espera' : 'recepcao'),
      teleLink: d.teleLink, convenioId: d.convenioId, lembreteEm: null, confirmadoEm: null, chegouEm: null, inicioEm: null, fimEm: null,
      cancelamento: null, esperaId: d.esperaId, evolucaoId: null, lancamentoId: null, historico: []
    };
    historico(c, { acao: 'criada' });
    return { ok: true, consulta: CL.upsert('consultas', c), avisos: soft };
  }

  function taxaFaltaCent(c) {
    var pol = politica();
    var fixa = parseInt(pol.taxaFaltaCent, 10) || 0;
    if (fixa > 0) return fixa;
    var pct = parseFloat(pol.taxaFaltaPct) || 0;
    var pr = proc(c.procId);
    if (pct > 0 && pr && pr.valorCent > 0) return Math.round(pr.valorCent * pct / 100);
    return 0;
  }
  function lancarTaxa(c) {
    var valor = taxaFaltaCent(c);
    if (!valor) return null;
    var ja = CL.col('lancamentos').filter(function (l) { return l && l.consultaId === c.id && l.descricao === 'Taxa de falta' && l.status !== 'cancelado'; })[0];
    if (ja) return ja;
    var p = pac(c.pacId);
    var l = CL.upsert('lancamentos', {
      tipo: 'receita', consultaId: c.id, pacId: c.pacId, profId: c.profId, procId: c.procId, data: hoje(),
      descricao: 'Taxa de falta', valorCent: valor, descontoCent: 0, forma: '', parcelas: 1, status: 'pendente', recebidoEm: null,
      convenioId: (p && p.convenioId) || null
    });
    CL.ui.toast('Taxa de falta lançada: ' + CL.fmt.dinheiro(valor) + ' (pendente)', { kind: 'info' });
    return l;
  }
  function lancarDaConsulta(c) {
    if (window.Financeiro && typeof Financeiro.lancarDaConsulta === 'function') return Financeiro.lancarDaConsulta(c.id);
    if (c.lancamentoId && CL.get('lancamentos', c.lancamentoId)) return CL.get('lancamentos', c.lancamentoId);
    var pr = proc(c.procId), p = pac(c.pacId);
    if (!pr || !(pr.valorCent > 0)) return null;
    var l = CL.upsert('lancamentos', {
      tipo: 'receita', consultaId: c.id, pacId: c.pacId, profId: c.profId, procId: c.procId, data: c.data,
      descricao: pr.nome, valorCent: pr.valorCent, descontoCent: 0, forma: '', parcelas: 1, status: 'pendente', recebidoEm: null,
      convenioId: (p && p.convenioId) || null
    });
    CL.patch('consultas', c.id, { lancamentoId: l.id });
    return l;
  }
  function efeitosFinalizar(c) {
    var pr = proc(c.procId);
    if (!pr || !(pr.valorCent > 0)) return;
    var l = lancarDaConsulta(c);
    if (window.Financeiro && typeof Financeiro.baixa === 'function') {
      try { Financeiro.baixa(l ? l.id : c.id); } catch (err) { console.error(err); }
    } else if (l) CL.ui.toast('Lançamento pendente de ' + CL.fmt.dinheiro(l.valorCent) + ' criado', { kind: 'ok' });
  }
  function avisarVaga(c) {
    if (instante(c) <= Date.now()) return;
    var n = elegiveis({ data: c.data, hora: c.hora, profId: c.profId }).length;
    if (!n) return;
    CL.ui.toast('Vaga aberta · ' + n + ' na espera', { kind: 'info', action: { rotulo: 'Ver', fn: function () { abrirVaga(c.id); } } });
  }
  function mudarStatus(id, novo, opts) {
    opts = opts || {};
    var c = CL.get('consultas', id);
    if (!c) return Promise.resolve({ ok: false, status: null, motivo: 'Consulta não encontrada' });
    var de = c.status;
    if (de === novo) return Promise.resolve({ ok: true, status: de });
    if (!CL.STATUS[novo]) return Promise.resolve({ ok: false, status: de, motivo: 'Status desconhecido' });
    var iDe = CL.FLUXO.indexOf(de), iNovo = CL.FLUXO.indexOf(novo);
    var admin = CL.session && CL.session.perfil === 'admin';
    var permitido = false;
    if (iDe >= 0 && iNovo > iDe) permitido = true;
    else if (!(CL.STATUS[de] || {}).terminal && (novo === 'faltou' || novo === 'cancelado' || novo === 'cancelado_tarde' || novo === 'cancelado_clinica')) permitido = true;
    else if (admin || opts.reabrir) {
      if (de === 'finalizado' && novo === 'em_atendimento') permitido = true;
      if ((de === 'faltou' || CANCELADOS[de]) && novo === 'agendado') permitido = true;
    }
    if (!permitido) {
      var msg = 'Não dá para mudar de "' + ((CL.STATUS[de] || {}).rotulo || de) + '" para "' + CL.STATUS[novo].rotulo + '"';
      CL.ui.toast(msg, { kind: 'aviso' });
      return Promise.resolve({ ok: false, status: de, motivo: msg });
    }
    var agora = Date.now();
    if (novo === 'cancelado') {
      var jan = parseFloat(politica().janelaCancelamentoH) || 0;
      if (jan > 0 && politica().cobrarTardio !== false && agora > instante(c) - jan * 3600000) novo = 'cancelado_tarde';
    }
    c.status = novo;
    if (novo === 'confirmado') c.confirmadoEm = agora;
    else if (novo === 'chegou') c.chegouEm = agora;
    else if (novo === 'em_atendimento') { c.inicioEm = c.inicioEm && de === 'finalizado' ? c.inicioEm : agora; c.fimEm = null; }
    else if (novo === 'finalizado') c.fimEm = agora;
    else if (novo === 'agendado') { c.confirmadoEm = null; c.chegouEm = null; c.inicioEm = null; c.fimEm = null; c.cancelamento = null; }
    if (CANCELADOS[novo]) c.cancelamento = { em: agora, motivo: String(opts.motivo || ''), porQuem: opts.porQuem || (novo === 'cancelado_clinica' ? 'clinica' : 'paciente') };
    historico(c, { acao: 'status', de: de, para: novo, motivo: String(opts.motivo || '') });
    CL.upsert('consultas', c);
    try { CL.audit('consulta.status', 'consultas', c.id, { pacId: c.pacId, de: de, para: novo }); } catch (err) { console.error(err); }
    CL.emit('consulta:status', { id: c.id, de: de, para: novo });
    if (novo === 'finalizado') efeitosFinalizar(c);
    if (novo === 'faltou' || novo === 'cancelado_tarde') lancarTaxa(c);
    if (INATIVOS[novo]) avisarVaga(c);
    return Promise.resolve({ ok: true, status: novo });
  }

  function aplicarRemarcacao(c, novo, rotulo) {
    var de = c.data + ' ' + c.hora + ' · ' + nomeProf(c.profId);
    c.data = novo.data; c.hora = novo.hora; c.profId = novo.profId; c.dur = novo.dur;
    if (novo.status) c.status = novo.status;
    if ('confirmadoEm' in novo) c.confirmadoEm = novo.confirmadoEm;
    else if (c.status === 'confirmado') { c.status = 'agendado'; c.confirmadoEm = null; }
    historico(c, { acao: 'remarcada', de: de, para: c.data + ' ' + c.hora + ' · ' + nomeProf(c.profId), desfeito: rotulo === 'desfazer' || undefined });
    return CL.upsert('consultas', c);
  }
  function remarcar(id, alvo, opts) {
    opts = opts || {};
    alvo = alvo || {};
    var c = CL.get('consultas', id);
    if (!c) return Promise.resolve({ ok: false, conflitos: [{ tipo: 'inexistente', texto: 'Consulta não encontrada' }] });
    var novo = { data: alvo.data || c.data, hora: CL.fmt.hora(alvo.hora || c.hora), profId: alvo.profId || c.profId, dur: Math.max(5, parseInt(alvo.dur, 10) || durDe(c)) };
    var todos = conflitos({ data: novo.data, hora: novo.hora, dur: novo.dur, profId: novo.profId, pacId: c.pacId, ignorarId: id, encaixe: c.encaixe });
    var hard = duros(todos, c.encaixe);
    if (hard.length) return Promise.resolve({ ok: false, conflitos: hard, avisos: avisosDe(todos) });
    var pergunta = Promise.resolve(true);
    if (novo.profId !== c.profId && opts.confirmarProf !== false) {
      pergunta = CL.ui.confirmar({ titulo: 'Mudar de profissional?', texto: 'Mudar a consulta de ' + nomePac(c) + ' para ' + nomeProf(novo.profId) + '?', ok: 'Mudar' });
    }
    return pergunta.then(function (ok) {
      if (!ok) return { ok: false, cancelado: true, conflitos: [] };
      var antes = { data: c.data, hora: c.hora, profId: c.profId, dur: c.dur, status: c.status, confirmadoEm: c.confirmadoEm };
      aplicarRemarcacao(c, novo);
      var desfeito = false;
      var desfazer = function () {
        if (desfeito) return; desfeito = true;
        var cc = CL.get('consultas', id);
        if (!cc) return;
        aplicarRemarcacao(cc, antes, 'desfazer');
        CL.ui.toast('Remarcação desfeita', { kind: 'ok' });
      };
      if (!opts.silencioso) CL.ui.toast('Remarcado para ' + dataCurta(novo.data) + ' ' + novo.hora, { kind: 'ok', action: { rotulo: 'Desfazer', fn: desfazer } });
      return { ok: true, desfazer: desfazer, consulta: c, avisos: avisosDe(todos) };
    });
  }

  function proximaVaga(q) {
    q = q || {};
    var pr = proc(q.procId);
    var dur = Math.max(5, parseInt(q.dur, 10) || (pr && pr.dur) || 30);
    var lista = q.profId ? [prof(q.profId)].filter(Boolean) : profsAtivos();
    var dir = q.direcao === -1 ? -1 : 1;
    var inicio = q.aPartir || hoje();
    var horaRef = q.aPartirHora ? U.min(q.aPartirHora) : null;
    var h = hoje(), am = agoraMin();
    for (var i = 0; i < 180; i++) {
      var d = U.addDias(inicio, dir * i);
      if (!d || d < h) return null;
      var melhor = null;
      lista.forEach(function (p) {
        var slot = slotDe(p);
        turnos(p, d).forEach(function (t) {
          var a = Math.ceil(U.min(t.ini) / slot) * slot, z = U.min(t.fim);
          for (var m = a; m + dur <= z; m += slot) {
            if (d === h && m <= am) continue;
            if (i === 0 && horaRef != null && (dir === 1 ? m <= horaRef : m >= horaRef)) continue;
            var hh = U.hhmm(m);
            if (duros(conflitos({ data: d, hora: hh, dur: dur, profId: p.id }), false).length) continue;
            if (!melhor || (dir === 1 ? m < melhor.min : m > melhor.min)) melhor = { data: d, hora: hh, profId: p.id, min: m };
            if (dir === 1) break;
          }
        });
      });
      if (melhor) return { data: melhor.data, hora: melhor.hora, profId: melhor.profId };
    }
    return null;
  }

  function whatsapp(consultaId, chave, opts) {
    opts = opts || {};
    var c = CL.get('consultas', consultaId) || {};
    var p = pac(c.pacId) || {};
    var pf = prof(c.profId) || {};
    var cl = cfg().clinica || {};
    chave = chave || 'confirmar';
    var texto = preencherModelo(modeloWa(chave), {
      nome: U.primeiroNome(p.nome), prof: pf.nome || '', data: c.data ? CL.fmt.dataExtenso(c.data) : '', hora: c.hora || '',
      clinica: cl.nome || 'clínica', endereco: cl.endereco || '', link: c.teleLink || ''
    }).replace(/[ \t]+\./g, '.').replace(/  +/g, ' ').trim();
    var fone = foneWa(opts.fone != null ? opts.fone : p.fone);
    return { url: 'https://wa.me/' + fone + '?text=' + encodeURIComponent(texto), texto: texto, fone: fone, chave: chave };
  }
  function registrarLembrete(c, chave) {
    c.lembreteEm = Date.now();
    historico(c, { acao: 'lembrete', chave: chave });
    CL.upsert('consultas', c);
    var p = pac(c.pacId);
    if (p) {
      var lg = (p.lgpd && typeof p.lgpd === 'object') ? p.lgpd : { pedidos: [], compartilhamentos: [] };
      if (!Array.isArray(lg.compartilhamentos)) lg.compartilhamentos = [];
      lg.compartilhamentos.push({ em: Date.now(), tipo: 'whatsapp', alvo: chave });
      CL.patch('pacientes', p.id, { lgpd: lg });
    }
  }
  function abrirUrl(url) {
    var w = null;
    try { w = window.open(url, '_blank', 'noopener'); } catch (err) { w = null; }
    if (!w) CL.ui.toast('O navegador bloqueou a janela. Copie o link e abra no WhatsApp.', { kind: 'aviso' });
  }

  var espera = {
    adicionar: function (d) {
      d = d || {};
      if (!d.pacId || !pac(d.pacId)) { CL.ui.toast('Escolha o paciente', { kind: 'aviso' }); return null; }
      var x = CL.upsert('espera', {
        pacId: d.pacId, profId: d.profId || null, procId: d.procId || '', prioridade: d.prioridade === 'urgente' ? 'urgente' : 'normal',
        diasPref: Array.isArray(d.diasPref) ? d.diasPref.map(Number) : [], horaPref: { ini: (d.horaPref && d.horaPref.ini) || '', fim: (d.horaPref && d.horaPref.fim) || '' },
        obs: String(d.obs || '').trim(), ofertas: [], status: 'aguardando', consultaId: null
      });
      CL.ui.toast('Adicionado à lista de espera', { kind: 'ok' });
      return x;
    },
    remover: function (id, motivo) {
      var x = CL.get('espera', id);
      if (!x) return false;
      CL.patch('espera', id, { status: 'desistiu', motivoSaida: String(motivo || '') });
      return true;
    },
    elegiveis: elegiveis,
    marcar: function (esperaId) {
      var x = CL.get('espera', esperaId);
      if (!x || !pac(x.pacId)) { CL.ui.toast('Entrada da lista não encontrada', { kind: 'aviso' }); return; }
      var p = pac(x.pacId);
      var futura = ordenar(CL.col('consultas').filter(function (c) { return c.pacId === x.pacId && ativa(c) && instante(c) > Date.now(); }))[0];
      var entrar = function () {
        modoVaga = { esperaId: x.id, pacId: x.pacId, nome: U.primeiroNome(p.nome), profId: x.profId || null, procId: x.procId || '' };
        manterModoVaga = true;
        var profs = x.profId ? [x.profId] : (st.profs.length ? st.profs : null);
        var v = (st.visao === 'dia' || st.visao === 'semana') ? st.visao : 'dia';
        var d = (st.data && st.visao !== 'espera' && st.visao !== 'lembretes') ? st.data : hoje();
        if (el && st.visao === v && el.querySelector('.ag-grade')) { manterModoVaga = false; render(); }
        else irPara(v, d, profs);
      };
      if (futura) {
        CL.ui.modal({
          titulo: 'Já tem consulta marcada',
          corpo: '<p class="prosa">' + e(CL.nomeExibido(p.nome)) + ' já tem consulta em ' + e(dataCurta(futura.data)) + ' às ' + e(futura.hora) + ' com ' + e(nomeProf(futura.profId)) + '.</p>',
          botoes: [
            { rotulo: 'Cancelar', tipo: 'neutro' },
            { rotulo: 'Remarcar a existente', tipo: 'neutro', icone: 'ti-calendar-repeat', acao: function () { abrirRemarcar(futura.id); } },
            { rotulo: 'Marcar outra', tipo: 'primario', icone: 'ti-plus', acao: function () { entrar(); } }
          ]
        });
        return;
      }
      entrar();
    },
    ofertar: function (esperaId, slot) {
      var x = CL.get('espera', esperaId);
      if (!x) return '';
      var p = pac(x.pacId) || {};
      var pf = prof(slot && slot.profId) || {};
      var cl = cfg().clinica || {};
      var texto = preencherModelo(modeloWa('vaga'), {
        nome: U.primeiroNome(p.nome), prof: pf.nome || '', data: slot && slot.data ? CL.fmt.dataExtenso(slot.data) : '', hora: (slot && slot.hora) || '',
        clinica: cl.nome || 'clínica', endereco: cl.endereco || '', link: ''
      });
      var url = 'https://wa.me/' + foneWa(p.fone) + '?text=' + encodeURIComponent(texto);
      var ofertas = Array.isArray(x.ofertas) ? x.ofertas.slice() : [];
      ofertas.push({ em: Date.now(), data: slot ? slot.data : '', hora: slot ? slot.hora : '', profId: slot ? slot.profId : null });
      CL.patch('espera', x.id, { ofertas: ofertas });
      return url;
    }
  };

  function atingidasDe(b) {
    var out = [];
    if (!b || !b.dataIni || !b.dataFim) return out;
    CL.col('consultas').forEach(function (c) {
      if (!ativa(c) || c.data < b.dataIni || c.data > b.dataFim) return;
      if (b.profId && c.profId !== b.profId) return;
      var iv = bloqueioIntervalo(b, c.data);
      if (sobrepoe(U.min(c.hora), fimDe(c), iv[0], iv[1])) out.push(c.id);
    });
    return out;
  }
  var bloqueios = {
    criar: function (d) {
      d = d || {};
      var ini = String(d.dataIni || '').slice(0, 10), fim = String(d.dataFim || ini).slice(0, 10);
      if (!U.dataDe(ini) || !U.dataDe(fim)) { CL.ui.toast('Informe as datas do bloqueio', { kind: 'aviso' }); return null; }
      if (fim < ini) { var t = ini; ini = fim; fim = t; }
      var b = CL.upsert('bloqueios', {
        id: d.id || undefined, profId: d.profId || null, dataIni: ini, dataFim: fim,
        horaIni: d.diaInteiro ? '00:00' : CL.fmt.hora(d.horaIni || '00:00'), horaFim: d.diaInteiro ? '23:59' : CL.fmt.hora(d.horaFim || '23:59'),
        diaInteiro: !!d.diaInteiro, motivo: MOTIVOS_BLOQ[d.motivo] ? d.motivo : 'outro', descricao: String(d.descricao || '').trim()
      });
      return { bloqueio: b, atingidas: atingidasDe(b) };
    },
    remover: function (id) { return CL.remove('bloqueios', id); },
    atingidas: atingidasDe
  };

  var notas = {
    get: function (data, profId) {
      var n = CL.get('notasDia', data + '_' + (profId || 'geral'));
      return n ? (n.texto || '') : '';
    },
    set: function (data, profId, texto) {
      var id = data + '_' + (profId || 'geral');
      var atual = CL.get('notasDia', id);
      texto = String(texto || '');
      if (!atual && !texto.trim()) return null;
      if (atual && atual.texto === texto) return atual;
      return CL.upsert('notasDia', Object.assign(atual || { id: id, data: data, profId: profId || null }, { texto: texto }));
    }
  };

  function imprimirDia(data, profId) {
    var lista = profId ? [prof(profId)].filter(Boolean) : selecionados().map(prof).filter(Boolean);
    if (!lista.length) lista = profsAtivos();
    var css = '<style>.doc-tabela{width:100%;border-collapse:collapse;font-size:10.5pt}.doc-tabela th,.doc-tabela td{border-bottom:1px solid #999;padding:2mm 1.5mm;text-align:left;vertical-align:top}.doc-tabela th{font-size:9.5pt}.doc-secao{font-size:12pt;font-weight:700;margin:5mm 0 2mm}</style>';
    var corpo = css;
    lista.forEach(function (p) {
      var cs = ordenar(consultasDia(data, p.id).filter(function (c) { return !CANCELADOS[c.status]; }));
      corpo += '<div class="doc-secao">' + e(p.nome) + ' · ' + cs.length + ' consulta' + (cs.length === 1 ? '' : 's') + '</div>';
      if (!cs.length) { corpo += '<p>Sem consultas.</p>'; return; }
      corpo += '<table class="doc-tabela"><thead><tr><th>Hora</th><th>Paciente</th><th>Procedimento</th><th>Convênio</th><th>Telefone</th><th>Situação</th></tr></thead><tbody>';
      cs.forEach(function (c) {
        var pa = pac(c.pacId), pr = proc(c.procId), cv = conv(c.convenioId || (pa && pa.convenioId));
        corpo += '<tr><td>' + e(c.hora) + '</td><td>' + e(nomePac(c)) + (c.encaixe ? ' (encaixe)' : '') + '</td><td>' + e(pr ? pr.nome : '') + '</td><td>' + e(cv ? cv.nome : '') + '</td><td>' + e(pa && pa.fone ? CL.fmt.fone(pa.fone) : '') + '</td><td>' + e((CL.STATUS[c.status] || {}).rotulo || c.status) + '</td></tr>';
      });
      corpo += '</tbody></table>';
    });
    return CL.print.documento({ titulo: 'Agenda de ' + CL.fmt.data(data), tipoDoc: 'agenda', corpoHtml: corpo, profissional: lista.length === 1 ? lista[0] : {}, semAssinatura: true });
  }

  /* =================== seleção, navegação e cabeçalho =================== */
  function maxCols() { var w = window.innerWidth; return w >= 1024 ? 4 : (w >= 768 ? 2 : 1); }
  function padraoVisao() { return window.innerWidth < 768 ? 'lista' : 'dia'; }
  function selecionados() {
    var ativos = profsAtivos().map(function (p) { return p.id; });
    var sel = (st.profs || []).filter(function (id) { return ativos.indexOf(id) >= 0; });
    if (!sel.length) {
      var s = CL.session;
      if (s && s.profId && ativos.indexOf(s.profId) >= 0) sel = [s.profId];
      else sel = ativos.slice(0, maxCols());
    }
    if (st.visao === 'semana' || maxCols() === 1) sel = sel.slice(0, 1);
    return sel;
  }
  function irPara(visao, data, profs, replace) {
    var hash;
    data = data || hoje();
    if (visao === 'mes') hash = '#/agenda/mes/' + data.slice(0, 7);
    else if (visao === 'espera') hash = '#/agenda/espera';
    else if (visao === 'lembretes') hash = '#/agenda/lembretes/' + data;
    else hash = '#/agenda/' + visao + '/' + data + (profs && profs.length ? '?prof=' + profs.join(',') : '');
    CL.route.go(hash, { replace: !!replace });
  }
  function selecionarProf(id) {
    var sel = selecionados();
    if (st.visao === 'semana' || maxCols() === 1) sel = [id];
    else if (sel.indexOf(id) >= 0) { if (sel.length > 1) sel = sel.filter(function (x) { return x !== id; }); }
    else sel = sel.concat([id]);
    st.profs = sel;
    CL.pref.set(chaveProfs(), sel);
    irPara(st.visao, st.data, sel, true);
  }
  function deslocar(n) {
    if (st.visao === 'mes') {
      var d = U.dataDe(st.data.slice(0, 7) + '-01');
      d.setMonth(d.getMonth() + n);
      irPara('mes', U.ymd(d));
    } else if (st.visao === 'semana') irPara('semana', U.addDias(st.data, 7 * n), st.profs);
    else if (st.visao === 'espera') return;
    else irPara(st.visao, U.addDias(st.data, n), st.profs);
  }
  function inicioSemana(data) { var off = (diaSemana(data) + 6) % 7; return U.addDias(data, -off); }
  function tituloData() {
    if (st.visao === 'mes') { var d = U.dataDe(st.data); return capitalizar(MESES[d.getMonth()] + ' de ' + d.getFullYear()); }
    if (st.visao === 'semana') {
      var a = inicioSemana(st.data), z = U.addDias(a, 6), da = U.dataDe(a), dz = U.dataDe(z);
      if (da.getMonth() === dz.getMonth()) return da.getDate() + ' a ' + dz.getDate() + ' de ' + MESES[da.getMonth()] + ' de ' + da.getFullYear();
      return da.getDate() + ' de ' + MESES[da.getMonth()].slice(0, 3) + ' a ' + dz.getDate() + ' de ' + MESES[dz.getMonth()].slice(0, 3) + ' de ' + dz.getFullYear();
    }
    if (st.visao === 'espera') return 'Lista de espera';
    if (st.visao === 'lembretes') return 'Lembretes de ' + dataCurta(st.data);
    var t = capitalizar(CL.fmt.dataExtenso(st.data));
    return st.data === hoje() ? 'Hoje · ' + t : t;
  }
  function textoPolitica() {
    var pol = politica();
    var jan = parseFloat(pol.janelaCancelamentoH) || 0;
    if (!jan) return 'Sem cobrança por cancelamento';
    var taxa = (parseInt(pol.taxaFaltaCent, 10) || 0) > 0 || (parseFloat(pol.taxaFaltaPct) || 0) > 0;
    if (pol.cobrarTardio !== false && taxa) return 'Cancelamento com menos de ' + jan + ' h é cobrado';
    return 'Cancele com ' + jan + ' h de antecedência';
  }
  function horaPx() {
    var v = parseFloat(getComputedStyle(document.body).getPropertyValue('--hora-px'));
    return v > 0 ? v : 60;
  }
  function proximaHoraLivre() {
    var slot = slotDe(prof(selecionados()[0]));
    var m = Math.ceil((agoraMin() + 1) / slot) * slot;
    var ini = U.min(cfgAgenda().horaIni || '07:00');
    if (st.data !== hoje() || m < ini) m = ini;
    return U.hhmm(Math.min(m, 1435));
  }

  function cabecalhoHtml() {
    var nEspera = esperaAguardando().length;
    var mes = st.visao === 'mes';
    var html = '<div class="ag-cabeca"><div class="ag-cabeca-linha">';
    html += '<div class="segmentado" role="group" aria-label="Visão">' + VISOES.map(function (v) {
      return '<button type="button" data-acao="visao" data-visao="' + v + '" aria-pressed="' + (st.visao === v ? 'true' : 'false') + '">' + ROTULO_VISAO[v] + '</button>';
    }).join('') + '</div>';
    if (st.visao !== 'espera') {
      html += '<div class="ag-nav"><button type="button" class="btn btn-icone btn-neutro" data-acao="anterior" aria-label="Anterior" title="Anterior (←)"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>' +
        '<button type="button" class="btn btn-neutro" data-acao="hoje" title="Hoje (T)">Hoje</button>' +
        '<button type="button" class="btn btn-icone btn-neutro" data-acao="proximo" aria-label="Próximo" title="Próximo (→)"><i class="ti ti-chevron-right" aria-hidden="true"></i></button></div>';
      html += '<label class="ag-data"><span class="sr-only">Escolher data</span><input class="input" type="' + (mes ? 'month' : 'date') + '" data-acao="data" value="' + e(mes ? st.data.slice(0, 7) : st.data) + '"></label>';
    }
    html += '<h1 class="ag-titulo">' + e(tituloData()) + '</h1>';
    html += '<div class="ag-cabeca-acoes">' +
      '<button type="button" class="btn btn-primario" data-acao="nova" title="Nova consulta (N)" aria-label="Nova consulta"><i class="ti ti-plus" aria-hidden="true"></i><span>Nova consulta</span></button>' +
      '<button type="button" class="btn btn-neutro" data-acao="espera" title="Lista de espera" aria-label="Lista de espera"' + (st.visao === 'espera' ? ' aria-pressed="true"' : '') + '><i class="ti ti-list-numbers" aria-hidden="true"></i><span>Espera</span>' + (nEspera ? '<span class="ag-contador">' + nEspera + '</span>' : '') + '</button>' +
      '<button type="button" class="btn btn-neutro" data-acao="lembretes" title="Lembretes de amanhã" aria-label="Lembretes de amanhã"' + (st.visao === 'lembretes' ? ' aria-pressed="true"' : '') + '><i class="ti ti-bell" aria-hidden="true"></i><span>Lembretes</span></button>' +
      '<button type="button" class="btn btn-neutro" data-acao="bloquear" title="Bloquear horário ou férias" aria-label="Bloquear"><i class="ti ti-ban" aria-hidden="true"></i><span>Bloquear</span></button>' +
      '<button type="button" class="btn btn-neutro" data-acao="proxima-vaga" title="Próxima vaga livre" aria-label="Próxima vaga"><i class="ti ti-calendar-search" aria-hidden="true"></i><span>Próxima vaga</span></button>' +
      '<button type="button" class="btn btn-icone btn-neutro" data-acao="buscar" aria-label="Buscar consulta" title="Buscar consulta (/)"><i class="ti ti-search" aria-hidden="true"></i></button>' +
      '<button type="button" class="btn btn-icone btn-neutro" data-acao="menu" aria-label="Mais opções" aria-haspopup="menu" title="Mais opções"><i class="ti ti-dots" aria-hidden="true"></i></button>' +
      '</div></div>';
    if (st.visao !== 'espera' && st.visao !== 'lembretes') html += chipsHtml();
    html += '</div>';
    return html;
  }
  function chipsHtml() {
    var lista = profsAtivos(), sel = selecionados();
    var unico = st.visao === 'semana' || maxCols() === 1;
    var html = '<div class="ag-chips" role="group" aria-label="Profissionais">';
    if (unico && lista.length > 1) html += '<button type="button" class="ag-chip ag-chip-nav" data-acao="prof-anterior" aria-label="Profissional anterior"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>';
    lista.forEach(function (p) {
      var on = sel.indexOf(p.id) >= 0;
      html += '<button type="button" class="ag-chip' + (on ? ' is-on' : '') + '" data-acao="prof" data-id="' + e(p.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '" title="' + e(p.nome) + '">' +
        '<span class="ag-chip-cor" style="background:' + e(p.cor || '#4B5563') + '"></span><span class="ag-chip-ini">' + e(iniciaisProf(p)) + '</span><span class="ag-chip-nome">' + e(p.nome) + '</span></button>';
    });
    if (unico && lista.length > 1) html += '<button type="button" class="ag-chip ag-chip-nav" data-acao="prof-proximo" aria-label="Próximo profissional"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>';
    html += '<button type="button" class="ag-chip ag-chip-mais" data-acao="prof-novo" title="Novo profissional" aria-label="Novo profissional"><i class="ti ti-plus" aria-hidden="true"></i></button></div>';
    return html;
  }
  function notasHtml() {
    if (st.visao !== 'dia' && st.visao !== 'lista') return '';
    var aberto = !!CL.pref.get('agenda.notasAberto', false);
    var sel = selecionados();
    var itens = sel.map(function (id) { return { id: id, rotulo: nomeProf(id) }; }).concat([{ id: '', rotulo: 'Geral' }]);
    var tem = itens.some(function (it) { return notas.get(st.data, it.id).trim(); });
    var html = '<details class="ag-notas" data-notas="1"' + (aberto ? ' open' : '') + '><summary><i class="ti ti-note" aria-hidden="true"></i>Notas do dia' + (tem && !aberto ? ' <span class="ag-contador">' + itens.filter(function (it) { return notas.get(st.data, it.id).trim(); }).length + '</span>' : '') + '</summary><div class="ag-notas-corpo">';
    itens.forEach(function (it) {
      var idEl = 'ag-nota-' + (it.id || 'geral');
      html += '<div class="campo"><label for="' + idEl + '">' + e(it.rotulo) + '</label><textarea id="' + idEl + '" class="textarea" rows="2" data-nota="' + e(it.id) + '" placeholder="Anotação para este dia">' + e(notas.get(st.data, it.id)) + '</textarea></div>';
    });
    html += '</div></details>';
    return html;
  }
  function modoVagaHtml() {
    if (!modoVaga) return '';
    return '<div class="ag-modo-vaga" role="status"><i class="ti ti-hand-click" aria-hidden="true"></i><span>Escolha um horário para ' + e(CL.nomeExibido(modoVaga.nome)) + ' — Esc cancela</span><button type="button" class="btn btn-fantasma btn-pequeno" data-acao="cancelar-vaga"><i class="ti ti-x" aria-hidden="true"></i>Cancelar</button></div>';
  }

  /* =================== grade (dia e semana) =================== */
  function arrastavel(c) { return ativa(c) && !(CL.STATUS[c.status] || {}).terminal && c.status !== 'em_atendimento'; }
  function blocoHtml(c, faixa, hpx, lane, idx) {
    var p = pac(c.pacId), pr = proc(c.procId), cv = conv(c.convenioId || (p && p.convenioId));
    var a = U.min(c.hora), dur = durDe(c);
    var top = (a - faixa[0]) / 60 * hpx, h = Math.max(dur / 60 * hpx - 2, 22);
    var total = (lane && lane.total) || 1, w = 100 / total, left = w * ((lane && lane.lane) || 0);
    var stt = CL.STATUS[c.status] || CL.STATUS.agendado;
    var l = c.lancamentoId ? CL.get('lancamentos', c.lancamentoId) : null;
    var icones = '';
    if (c.confirmadoEm && c.status !== 'agendado') icones += '<i class="ti ti-check" title="Confirmado" aria-hidden="true"></i>';
    if (l && l.status === 'recebido') icones += '<i class="ti ti-cash" title="Pago" aria-hidden="true"></i>';
    if (c.obs) icones += '<i class="ti ti-message" title="Tem observação" aria-hidden="true"></i>';
    if (pr && pr.modalidade === 'tele') icones += '<i class="ti ti-video" title="Teleconsulta" aria-hidden="true"></i>';
    if (p && faltasDe(p.id).risco) icones += '<i class="ti ti-alert-triangle" title="Risco de falta" aria-hidden="true"></i>';
    if (c.encaixe) icones += '<i class="ti ti-arrows-diagonal" title="Encaixe" aria-hidden="true"></i>';
    var l2 = [pr && pr.nome, cv && cv.nome].filter(Boolean).join(' · ');
    var dica = [c.hora + '–' + U.hhmm(a + dur), nomePac(c), l2, stt.rotulo + (c.encaixe ? ' · encaixe' : ''), c.obs].filter(Boolean).join(' · ');
    return '<div class="ag-bloco ' + stt.classe + (c.encaixe ? ' is-encaixe' : '') + (arrastavel(c) ? ' is-movel' : '') + '" data-id="' + e(c.id) + '" role="button" tabindex="0" aria-label="' + e(dica) + '" title="' + e(dica) + '"' +
      ' style="top:' + top + 'px;height:' + h + 'px;left:' + left + '%;width:calc(' + w + '% - 3px);border-left-color:' + e((pr && pr.cor) || '#626973') + ';z-index:' + Math.min(2 + idx, 18) + '">' +
      '<span class="ag-l1"><span class="tnum">' + e(c.hora) + '</span> <span class="nome-paciente">' + e(nomePac(c)) + '</span></span>' +
      (h >= 30 && l2 ? '<span class="ag-l2">' + e(l2) + '</span>' : '') +
      (icones ? '<span class="ag-icones">' + icones + '</span>' : '') +
      (arrastavel(c) ? '<span class="ag-alca" data-alca="1" aria-hidden="true"></span>' : '') + '</div>';
  }
  function colunaHtml(col, faixa, hpx) {
    var p = prof(col.profId), slot = slotDe(p), alt = (faixa[1] - faixa[0]) / 60 * hpx;
    var ts = turnos(p, col.data), livre = !temHorarios(p);
    var semTurno = !livre && !ts.length;
    var html = '<div class="ag-col' + (col.hoje ? ' is-hoje' : '') + (semTurno ? ' is-sem-turno' : '') + '" data-prof="' + e(col.profId) + '" data-data="' + e(col.data) + '">';
    html += '<div class="ag-col-cabeca"' + (col.cor ? ' style="--prof:' + e(col.cor) + '"' : '') + '>' + (col.cor ? '<span class="ag-col-cor" style="background:' + e(col.cor) + '"></span>' : '') +
      '<span class="ag-col-titulo" title="' + e(col.titulo) + '">' + e(col.titulo) + '</span>' + (col.sub ? '<span class="ag-col-sub">' + e(col.sub) + '</span>' : '') + '</div>';
    html += '<div class="ag-col-corpo" data-ini="' + faixa[0] + '" data-fim="' + faixa[1] + '" style="height:' + alt + 'px">';
    for (var m = faixa[0]; m < faixa[1]; m += slot) {
      var top = (m - faixa[0]) / 60 * hpx, h = Math.min(slot, faixa[1] - m) / 60 * hpx;
      var emTurno = livre || ts.some(function (t) { return U.min(t.ini) <= m && U.min(t.fim) >= m + slot; });
      html += '<div class="ag-celula ' + (emTurno ? 'ag-turno' : 'ag-fora') + (m % 60 === 0 ? ' is-hora' : (m % 30 === 0 ? ' is-meia' : ' is-quarto')) + '" data-hora="' + U.hhmm(m) + '" data-prof="' + e(col.profId) + '" data-data="' + e(col.data) + '" style="top:' + top + 'px;height:' + h + 'px"></div>';
    }
    bloqueiosDe(col.data, col.profId).forEach(function (b) {
      var iv = bloqueioIntervalo(b, col.data);
      var a = Math.max(iv[0], faixa[0]), z = Math.min(iv[1], faixa[1]);
      if (z <= a) return;
      html += '<div class="ag-bloqueio" data-bloqueio="' + e(b.id) + '" role="button" tabindex="0" title="' + e(rotuloBloqueio(b)) + '" style="top:' + ((a - faixa[0]) / 60 * hpx) + 'px;height:' + ((z - a) / 60 * hpx) + 'px"><i class="ti ti-ban" aria-hidden="true"></i><span>' + e(rotuloBloqueio(b)) + '</span></div>';
    });
    var lista = ordenar(consultasDia(col.data, col.profId).filter(function (c) { return !(st.ocultarCancelados && CANCELADOS[c.status]); }));
    var lanes = particionar(lista);
    lista.forEach(function (c, i) { html += blocoHtml(c, faixa, hpx, lanes[c.id], i); });
    vagasAbertas(col.data, col.profId).forEach(function (v) {
      var c = v.consulta, a = U.min(c.hora);
      html += '<div class="ag-vaga-aberta" data-vaga="' + e(c.id) + '" role="button" tabindex="0" title="Vaga aberta às ' + e(c.hora) + ' · ' + v.n + ' na espera" style="top:' + ((a - faixa[0]) / 60 * hpx) + 'px;height:' + Math.max(durDe(c) / 60 * hpx - 2, 22) + 'px">' +
        '<span class="ag-l1"><i class="ti ti-bell-ringing" aria-hidden="true"></i> Vaga aberta · ' + v.n + ' na espera</span><span class="ag-l2">' + e(c.hora) + ' · clique para ver</span></div>';
    });
    if (col.hoje) {
      var am = agoraMin();
      if (am >= faixa[0] && am <= faixa[1]) html += '<div class="ag-agora" data-agora="1" style="top:' + ((am - faixa[0]) / 60 * hpx) + 'px"></div>';
    }
    html += '</div></div>';
    return html;
  }
  function gradeHtml(cols, faixa, hpx, semana) {
    var alt = (faixa[1] - faixa[0]) / 60 * hpx;
    var html = '<div class="ag-rolagem"><div class="ag-grade' + (semana ? ' is-semana' : '') + '" style="--ag-cols:' + cols.length + '">';
    html += '<div class="ag-horas"><div class="ag-col-cabeca ag-horas-cabeca"><button type="button" class="btn btn-fantasma btn-pequeno" data-acao="ver24" title="' + (st.ver24 ? 'Voltar ao horário da clínica' : 'Ver as 24 horas') + '" aria-pressed="' + (st.ver24 ? 'true' : 'false') + '">24 h</button></div><div class="ag-col-corpo" style="height:' + alt + 'px">';
    for (var m = faixa[0] + 30; m < faixa[1]; m += 30) html += '<div class="ag-hora-rotulo' + (m % 60 ? ' is-meia' : '') + '" style="top:' + ((m - faixa[0]) / 60 * hpx) + 'px">' + U.hhmm(m) + '</div>';
    html += '</div></div>';
    cols.forEach(function (c) { html += colunaHtml(c, faixa, hpx); });
    html += '</div></div>';
    return html;
  }
  function rolarPara(corpo, faixa, hpx, datas, profIds) {
    var r = corpo.querySelector('.ag-rolagem');
    if (!r) return;
    if (!primeiraRender && st.scrollTop != null) { r.scrollTop = st.scrollTop; r.scrollLeft = st.scrollLeft || 0; return; }
    primeiraRender = false;
    var alvo = null;
    if (datas.indexOf(hoje()) >= 0) alvo = agoraMin() - 60;
    else {
      profIds.forEach(function (id) { datas.forEach(function (d) { turnos(prof(id), d).forEach(function (t) { var m = U.min(t.ini) - 30; if (alvo == null || m < alvo) alvo = m; }); }); });
      if (alvo == null) alvo = faixa[0];
    }
    r.scrollTop = Math.max(0, (alvo - faixa[0]) / 60 * hpx);
  }
  function renderDia(corpo) {
    var sel = selecionados(), hpx = horaPx();
    var cols = sel.map(function (id) {
      var p = prof(id), n = consultasDia(st.data, id).filter(ativa).length;
      return { profId: id, data: st.data, titulo: p.nome, sub: n ? n + (n === 1 ? ' consulta' : ' consultas') : '', cor: p.cor, hoje: st.data === hoje() };
    });
    var faixa = faixaDe([st.data], sel);
    corpo.innerHTML = gradeHtml(cols, faixa, hpx, false);
    var vazio = !sel.some(function (id) { return consultasDia(st.data, id).some(ativa); });
    if (vazio) corpo.insertAdjacentHTML('afterbegin', '<div class="ag-dica"><i class="ti ti-calendar-plus" aria-hidden="true"></i><span>Nenhuma consulta — clique em um horário para marcar</span><button type="button" class="btn btn-primario btn-pequeno" data-acao="nova">Nova consulta</button></div>');
    rolarPara(corpo, faixa, hpx, [st.data], sel);
  }
  function renderSemana(corpo) {
    var pid = selecionados()[0], hpx = horaPx();
    var ini = inicioSemana(st.data), dias = [];
    for (var i = 0; i < 7; i++) dias.push(U.addDias(ini, i));
    var cols = dias.map(function (d) {
      var n = consultasDia(d, pid).filter(ativa).length;
      return { profId: pid, data: d, titulo: DIAS_CURTO[diaSemana(d)] + ' ' + d.slice(8, 10) + '/' + d.slice(5, 7), sub: n ? String(n) : '', cor: null, hoje: d === hoje() };
    });
    var faixa = faixaDe(dias, [pid]);
    corpo.innerHTML = gradeHtml(cols, faixa, hpx, true);
    rolarPara(corpo, faixa, hpx, dias, [pid]);
  }

  /* =================== mês =================== */
  function renderMes(corpo) {
    var base = U.dataDe(st.data.slice(0, 7) + '-01');
    var y = base.getFullYear(), m = base.getMonth();
    var startDow = base.getDay(), dim = new Date(y, m + 1, 0).getDate();
    var semanas = Math.ceil((startDow + dim) / 7);
    var sel = selecionados();
    var todos = profsAtivos().map(function (p) { return p.id; });
    var profs = sel.length ? sel : todos;
    if (maxCols() === 1 && st.profs.length === 0) profs = todos;
    var h = hoje(), total = 0;
    var html = '<div class="ag-mes-wrap"><div class="ag-mes-cabeca">' + DIAS_CURTO.map(function (d) { return '<div>' + d + '</div>'; }).join('') + '</div><div class="ag-mes">';
    for (var i = 0; i < semanas * 7; i++) {
      var d = new Date(y, m, 1 - startDow + i), ds = U.ymd(d), inM = d.getMonth() === m;
      var cs = consultasDia(ds).filter(function (c) { return profs.indexOf(c.profId) >= 0; });
      var n = cs.filter(ativa).length, f = cs.filter(function (c) { return c.status === 'faltou'; }).length;
      var bls = bloqueiosDe(ds).filter(function (b) { return !b.profId || profs.indexOf(b.profId) >= 0; });
      var ferias = bls.some(function (b) { return b.diaInteiro && (b.motivo === 'ferias' || b.motivo === 'feriado'); });
      if (inM) total += n;
      var pontos = '';
      profs.forEach(function (pid) { if (cs.some(function (c) { return c.profId === pid && ativa(c); })) pontos += '<span class="ag-mes-ponto" style="background:' + e((prof(pid) || {}).cor || '#4B5563') + '" title="' + e(nomeProf(pid)) + '"></span>'; });
      var txt = n ? n + (n === 1 ? ' consulta' : ' consultas') : '';
      if (f) txt += (txt ? ' · ' : '') + f + (f === 1 ? ' falta' : ' faltas');
      if (bls.length) txt += (txt ? ' · ' : '') + bls.length + (bls.length === 1 ? ' bloqueio' : ' bloqueios');
      html += '<div class="ag-mes-dia' + (inM ? '' : ' is-fora') + (ds === h ? ' is-hoje' : '') + (ferias ? ' is-ferias' : '') + '" data-acao="abrir-dia" data-data="' + ds + '" role="button" tabindex="0" aria-label="' + e(CL.fmt.dataExtenso(ds) + (txt ? ': ' + txt : '')) + '">' +
        '<span class="ag-mes-num">' + d.getDate() + '</span>' + (txt ? '<div class="ag-mes-txt">' + e(txt) + '</div>' : '') + (n ? '<span class="ag-mes-n">' + n + '</span>' : '') +
        (pontos ? '<div class="ag-mes-pontos">' + pontos + '</div>' : '') + '</div>';
    }
    html += '</div><div class="ag-mes-rodape">' + total + (total === 1 ? ' consulta' : ' consultas') + ' no mês' + (profs.length < todos.length ? ' (profissionais selecionados)' : '') + '</div></div>';
    corpo.innerHTML = html;
  }

  /* =================== lista =================== */
  function cartaoHtml(c) {
    var p = pac(c.pacId), pr = proc(c.procId), pf = prof(c.profId), cv = conv(c.convenioId || (p && p.convenioId));
    var stt = CL.STATUS[c.status] || CL.STATUS.agendado;
    var prox = CL.proximoStatus(c.status);
    var botao = '';
    if (prox) {
      var dis = prox === 'em_atendimento' && !CL.can('clinico');
      botao = '<button type="button" class="btn btn-neutro" data-acao="avancar" data-id="' + e(c.id) + '" data-para="' + prox + '"' + (dis ? ' disabled title="Seu perfil não abre o prontuário"' : ' title="Marcar como ' + e(CL.STATUS[prox].rotulo.toLowerCase()) + '"') + '><i class="ti ' + CL.STATUS[prox].icone + '" aria-hidden="true"></i><span>' + ROTULO_AVANCO[prox] + '</span></button>';
    }
    return '<div class="ag-cartao ' + stt.classe + (c.encaixe ? ' is-encaixe' : '') + '" data-id="' + e(c.id) + '" role="button" tabindex="0" style="border-left-color:' + e((pr && pr.cor) || '#626973') + '">' +
      '<div class="ag-cartao-hora">' + e(c.hora) + '<small>' + durDe(c) + ' min</small></div>' +
      '<div class="ag-cartao-corpo"><span class="ag-cartao-nome nome-paciente">' + e(nomePac(c)) + '</span>' +
      '<span class="ag-cartao-sub">' + (pr ? '<span>' + e(pr.nome) + '</span>' : '') + (cv ? '<span>' + e(cv.nome) + '</span>' : '') + (pf ? '<span class="chip"><span class="chip-ponto" style="background:' + e(pf.cor || '#4B5563') + '"></span>' + e(pf.nome) + '</span>' : '') + CL.chipStatus(c.status) + (c.encaixe ? '<span class="chip"><i class="ti ti-arrows-diagonal" aria-hidden="true"></i>Encaixe</span>' : '') + (p ? selos(p) : '') + '</span></div>' +
      '<div class="ag-cartao-acoes">' + (p && p.fone && !stt.terminal ? '<button type="button" class="btn btn-icone btn-neutro" data-acao="whatsapp" data-id="' + e(c.id) + '" aria-label="WhatsApp" title="WhatsApp"><i class="ti ti-brand-whatsapp" aria-hidden="true"></i></button>' : '') + botao + '</div></div>';
  }
  function renderLista(corpo) {
    var sel = selecionados();
    var lista = ordenar(consultasDia(st.data).filter(function (c) { return sel.indexOf(c.profId) >= 0 && !(st.ocultarCancelados && CANCELADOS[c.status]); }));
    if (!lista.length) {
      var box = document.createElement('div'); box.className = 'ag-lista';
      corpo.innerHTML = ''; corpo.appendChild(box);
      CL.ui.vazio(box, { icone: 'ti-calendar-plus', titulo: 'Nenhuma consulta neste dia', texto: 'Marque a primeira consulta ou escolha outro dia.', acao: { rotulo: 'Nova consulta', icone: 'ti-plus', fn: function () { Agenda.abrirNova({ data: st.data, profId: sel[0] }); } } });
      return;
    }
    var html = '<div class="ag-lista">', ultima = '';
    lista.forEach(function (c) {
      if (c.hora !== ultima) { ultima = c.hora; html += '<div class="ag-lista-hora">' + e(c.hora) + '</div>'; }
      html += cartaoHtml(c);
    });
    html += '</div>';
    corpo.innerHTML = html;
  }

  /* =================== lista de espera =================== */
  function esperandoHa(x) {
    var d = Math.floor((Date.now() - (x.createdAt || Date.now())) / 86400000);
    return d <= 0 ? 'hoje' : d + (d === 1 ? ' dia' : ' dias');
  }
  function preferenciasDe(x) {
    var partes = [];
    if (Array.isArray(x.diasPref) && x.diasPref.length) partes.push(x.diasPref.map(function (d) { return DIAS_CURTO[+d]; }).join(', '));
    if (x.horaPref && (x.horaPref.ini || x.horaPref.fim)) partes.push((x.horaPref.ini || '…') + '–' + (x.horaPref.fim || '…'));
    return partes.length ? partes.join(' · ') : 'qualquer horário';
  }
  function renderEspera(corpo) {
    var aba = st.esperaAba || '';
    var lista = esperaAguardando().filter(function (x) { return !aba || x.profId === aba || (aba === '_sem' && !x.profId); });
    lista.sort(function (a, b) { return ((a.prioridade === 'urgente' ? 0 : 1) - (b.prioridade === 'urgente' ? 0 : 1)) || ((a.createdAt || 0) - (b.createdAt || 0)); });
    var html = '<div class="ag-pagina"><div class="ag-linha-topo"><div class="segmentado ag-abas" role="group" aria-label="Filtrar por profissional">' +
      '<button type="button" data-acao="espera-aba" data-aba="" aria-pressed="' + (!aba ? 'true' : 'false') + '">Todos</button>' +
      profsAtivos().map(function (p) { return '<button type="button" data-acao="espera-aba" data-aba="' + e(p.id) + '" aria-pressed="' + (aba === p.id ? 'true' : 'false') + '" title="' + e(p.nome) + '">' + e(rotuloProf(p)) + '</button>'; }).join('') +
      '<button type="button" data-acao="espera-aba" data-aba="_sem" aria-pressed="' + (aba === '_sem' ? 'true' : 'false') + '">Qualquer</button></div>' +
      '<button type="button" class="btn btn-primario" data-acao="espera-nova"><i class="ti ti-plus" aria-hidden="true"></i>Adicionar à espera</button></div>';
    if (!lista.length) {
      html += '<div data-vazio></div></div>';
      corpo.innerHTML = html;
      CL.ui.vazio(corpo.querySelector('[data-vazio]'), { icone: 'ti-list-numbers', titulo: 'Ninguém na lista de espera', texto: 'Quem pede um horário que não existe entra aqui e é chamado quando abre uma vaga.', acao: { rotulo: 'Adicionar à espera', icone: 'ti-plus', fn: function () { abrirEsperaForm({}); } } });
      return;
    }
    html += '<div class="tabela-wrap tabela-cartoes"><table class="tabela"><thead><tr><th>Paciente</th><th>Procedimento</th><th>Profissional</th><th>Preferências</th><th>Esperando há</th><th>Ofertas</th><th class="acoes">Ações</th></tr></thead><tbody>';
    lista.forEach(function (x) {
      var p = pac(x.pacId), pr = proc(x.procId);
      html += '<tr data-espera-id="' + e(x.id) + '"><td data-rotulo="Paciente"><span class="nome-paciente">' + e(p ? CL.nomeExibido(p.nome) : 'Paciente removido') + '</span>' + (x.prioridade === 'urgente' ? ' <span class="chip chip-erro"><i class="ti ti-urgent" aria-hidden="true"></i>Urgente</span>' : '') + (x.obs ? '<br><small class="texto-3">' + e(x.obs) + '</small>' : '') + '</td>' +
        '<td data-rotulo="Procedimento">' + e(pr ? pr.nome : '—') + '</td><td data-rotulo="Profissional">' + e(x.profId ? nomeProf(x.profId) : 'Qualquer') + '</td>' +
        '<td data-rotulo="Preferências">' + e(preferenciasDe(x)) + '</td><td data-rotulo="Esperando há">' + e(esperandoHa(x)) + '</td><td data-rotulo="Ofertas" class="num">' + ((x.ofertas || []).length) + '</td>' +
        '<td class="acoes"><div class="linha-acoes" style="justify-content:flex-end"><button type="button" class="btn btn-primario btn-pequeno" data-acao="espera-marcar" data-id="' + e(x.id) + '"><i class="ti ti-calendar-plus" aria-hidden="true"></i>Marcar</button>' +
        (p && p.fone ? '<button type="button" class="btn btn-neutro btn-pequeno" data-acao="espera-whatsapp" data-id="' + e(x.id) + '"><i class="ti ti-brand-whatsapp" aria-hidden="true"></i>WhatsApp</button>' : '') +
        '<button type="button" class="btn btn-fantasma btn-pequeno" data-acao="espera-remover" data-id="' + e(x.id) + '"><i class="ti ti-trash" aria-hidden="true"></i>Remover</button></div></td></tr>';
    });
    html += '</tbody></table></div></div>';
    corpo.innerHTML = html;
  }

  /* =================== lembretes de amanhã =================== */
  function renderLembretes(corpo) {
    var data = st.data;
    var itens = lembretesDe(data);
    var todas = consultasDia(data).filter(ativa);
    var confirmadas = todas.filter(function (c) { return c.confirmadoEm || CL.FLUXO.indexOf(c.status) >= 1; }).length;
    var html = '<div class="ag-pagina"><div class="ag-linha-topo"><h2>' + e(dataCurta(data)) + '</h2><span class="chip chip-acento"><i class="ti ti-check" aria-hidden="true"></i>' + confirmadas + ' de ' + todas.length + ' confirmadas</span>' +
      '<button type="button" class="btn btn-neutro btn-pequeno" data-acao="lembretes-amanha">Amanhã</button></div>';
    if (!itens.length) {
      html += '<div data-vazio></div></div>';
      corpo.innerHTML = html;
      CL.ui.vazio(corpo.querySelector('[data-vazio]'), { icone: 'ti-bell-check', titulo: 'Nada a lembrar', texto: todas.length ? 'Todas as consultas deste dia já estão confirmadas ou não têm telefone na ficha.' : 'Não há consultas marcadas para este dia.', acao: { rotulo: 'Ver a agenda', icone: 'ti-calendar', fn: function () { irPara('dia', data, st.profs); } } });
      return;
    }
    html += '<div class="tabela-wrap tabela-cartoes"><table class="tabela"><thead><tr><th>Hora</th><th>Paciente</th><th>Profissional</th><th>Telefone</th><th class="acoes">Ações</th></tr></thead><tbody>';
    itens.forEach(function (it) {
      var p = pac(it.pacId);
      html += '<tr><td data-rotulo="Hora" class="tnum">' + e(it.hora) + '</td><td data-rotulo="Paciente"><span class="nome-paciente">' + e(p ? CL.nomeExibido(p.nome) : '') + '</span></td><td data-rotulo="Profissional">' + e(nomeProf(it.profId)) + '</td><td data-rotulo="Telefone">' + e(CL.fmt.fone(it.fone)) + '</td>' +
        '<td class="acoes"><div class="linha-acoes" style="justify-content:flex-end"><button type="button" class="btn btn-neutro btn-pequeno" data-acao="whatsapp" data-id="' + e(it.consultaId) + '" data-chave="lembrete"><i class="ti ti-brand-whatsapp" aria-hidden="true"></i>WhatsApp</button>' +
        '<button type="button" class="btn btn-primario btn-pequeno" data-acao="confirmar" data-id="' + e(it.consultaId) + '"><i class="ti ti-check" aria-hidden="true"></i>Confirmado</button></div></td></tr>';
    });
    html += '</tbody></table></div></div>';
    corpo.innerHTML = html;
  }

  /* =================== render principal =================== */
  function renderSemProfissional() {
    el.innerHTML = '<div class="ag"><div class="ag-rolagem"><div data-vazio></div></div></div>';
    CL.ui.vazio(el.querySelector('[data-vazio]'), { icone: 'ti-user-plus', titulo: 'Cadastre o primeiro profissional', texto: 'A agenda mostra uma coluna por profissional. Comece por quem atende na clínica.', acao: { rotulo: 'Novo profissional', icone: 'ti-plus', fn: abrirNovoProfissional } });
  }
  function render() {
    if (!el) return;
    rafRender = null;
    if (arraste) { renderAdiado = true; return; }
    faltasCache = {};
    var r = el.querySelector('.ag-rolagem');
    if (r && !primeiraRender) { st.scrollTop = r.scrollTop; st.scrollLeft = r.scrollLeft; }
    if (!profsAtivos().length) { renderSemProfissional(); return; }
    el.innerHTML = '<div class="ag">' + cabecalhoHtml() + notasHtml() + modoVagaHtml() + '<div class="ag-corpo" data-corpo="1"></div></div>';
    var corpo = el.querySelector('[data-corpo]');
    if (st.visao === 'dia') renderDia(corpo);
    else if (st.visao === 'semana') renderSemana(corpo);
    else if (st.visao === 'mes') renderMes(corpo);
    else if (st.visao === 'lista') renderLista(corpo);
    else if (st.visao === 'espera') renderEspera(corpo);
    else if (st.visao === 'lembretes') renderLembretes(corpo);
    if (formAberto && formAberto.ctx && document.contains(formAberto.ctx.el)) atualizarPreview();
    else formAberto = null;
  }
  function agendarRender() {
    if (!el) return;
    if (arraste) { renderAdiado = true; return; }
    if (rafRender) return;
    rafRender = requestAnimationFrame(render);
  }
  function atualizarAgora() {
    if (!el || arraste) return;
    var linhas = el.querySelectorAll('[data-agora]');
    if (!linhas.length) { if ((st.visao === 'dia' || st.visao === 'semana') && (st.data === hoje() || st.visao === 'semana')) agendarRender(); return; }
    var hpx = horaPx(), am = agoraMin();
    Array.prototype.forEach.call(linhas, function (l) {
      var corpo = l.parentNode, ini = +corpo.getAttribute('data-ini'), fim = +corpo.getAttribute('data-fim');
      if (am < ini || am > fim) { agendarRender(); return; }
      l.style.top = ((am - ini) / 60 * hpx) + 'px';
    });
  }

  /* =================== campo de paciente (busca + cadastro rápido) =================== */
  function campoPaciente(host, opts) {
    opts = opts || {};
    var estado = { pacId: opts.pacId || null, novoAberto: false, q: '' };
    var api = {
      get: function () { return estado.pacId; },
      set: function (id) {
        estado.pacId = id && pac(id) ? String(id) : null;
        estado.novoAberto = false;
        desenhar();
        if (typeof opts.aoMudar === 'function') opts.aoMudar(estado.pacId);
      },
      focar: function () {
        var i = host.querySelector('input[type="search"]');
        if (i) { try { i.focus(); } catch (err) { /* sem foco */ } }
      }
    };
    function desenhar() {
      var p = pac(estado.pacId);
      if (p) {
        host.innerHTML = '<div class="ag-pac-sel"><span class="avatar" aria-hidden="true">' + e(U.iniciais(p.nome)) + '</span>' +
          '<span><strong class="nome-paciente">' + e(CL.nomeExibido(p.nome)) + '</strong><small class="texto-3">' + [CL.fmt.idade(p.nasc), p.fone ? CL.fmt.fone(p.fone) : 'sem telefone'].filter(Boolean).map(e).join(' · ') + '</small><span class="linha-acoes">' + selos(p) + '</span></span>' +
          '<button type="button" class="btn btn-fantasma btn-pequeno" data-acao="trocar-paciente">Trocar</button></div>';
        return;
      }
      host.innerHTML = '<div class="busca"><i class="ti ti-search" aria-hidden="true"></i><input type="search" class="input" placeholder="Nome, CPF, telefone ou nascimento" aria-label="Buscar paciente"' + (opts.autofocus ? ' autofocus' : '') + '></div>' +
        '<div class="ag-resultados" data-resultados hidden></div>' +
        '<div class="linha-acoes"><button type="button" class="btn-link" data-acao="novo-paciente"><i class="ti ti-user-plus" aria-hidden="true"></i> Novo paciente</button></div>' +
        '<div class="ag-novo-pac" data-novo hidden><div class="campos-2"><div class="campo"><label>Nome</label><input type="text" name="novoNome" autocomplete="off"></div><div class="campo"><label>Telefone (WhatsApp)</label><input type="tel" name="novoFone" inputmode="tel" autocomplete="off" placeholder="(85) 99999-9999"></div></div>' +
        '<div class="campos-2"><div class="campo"><label>Nascimento (opcional)</label><input type="date" name="novoNasc"></div><div class="campo ag-campo-botao"><button type="button" class="btn btn-neutro" data-acao="criar-paciente"><i class="ti ti-check" aria-hidden="true"></i>Cadastrar e usar</button></div></div></div>';
      var input = host.querySelector('input[type="search"]');
      U.semAutofill(input);
      input.value = estado.q;
      if (estado.q) listar();
      if (estado.novoAberto) abrirNovo();
    }
    function listar() {
      var box = host.querySelector('[data-resultados]'), input = host.querySelector('input[type="search"]');
      if (!box || !input) return;
      var q = U.valorBusca(input).trim();
      estado.q = q;
      if (!q) { box.hidden = true; box.innerHTML = ''; return; }
      var lista = buscarPacientes(q, { limite: 8 });
      if (!lista.length) {
        box.innerHTML = '<div class="ag-resultado-vazio">Nenhum paciente encontrado. <button type="button" class="btn-link" data-acao="novo-paciente">Cadastrar agora</button></div>';
        box.hidden = false; return;
      }
      box.innerHTML = lista.map(function (p) {
        return '<button type="button" class="ag-resultado" data-acao="escolher-paciente" data-id="' + e(p.id) + '"><span><strong class="nome-paciente">' + e(CL.nomeExibido(p.nome)) + '</strong><small>' + [CL.fmt.idade(p.nasc), p.fone ? CL.fmt.fone(p.fone) : ''].filter(Boolean).map(e).join(' · ') + '</small></span>' + selos(p) + '</button>';
      }).join('');
      box.hidden = false;
    }
    function abrirNovo() {
      var n = host.querySelector('[data-novo]');
      if (!n) return;
      n.hidden = false; estado.novoAberto = true;
      var nome = n.querySelector('[name="novoNome"]');
      if (!nome.value && estado.q && !/\d/.test(estado.q)) nome.value = estado.q;
      try { nome.focus(); } catch (err) { /* sem foco */ }
    }
    function criar() {
      var n = host.querySelector('[data-novo]');
      if (!n) return;
      var nome = n.querySelector('[name="novoNome"]').value.trim();
      if (!nome) { CL.ui.toast('Informe o nome do paciente', { kind: 'aviso' }); n.querySelector('[name="novoNome"]').focus(); return; }
      var dados = { nome: nome, fone: n.querySelector('[name="novoFone"]').value, nasc: n.querySelector('[name="novoNasc"]').value };
      Promise.resolve(pacienteRapido(dados)).then(function (p) {
        if (p && p.id) { CL.ui.toast('Paciente cadastrado', { kind: 'ok' }); api.set(p.id); }
      }).catch(function (err) { console.error(err); CL.ui.toast('Não foi possível cadastrar: ' + (err && err.message || 'erro'), { kind: 'erro' }); });
    }
    host.addEventListener('input', function (ev) { if (ev.target.matches('input[type="search"]')) listar(); });
    host.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      if (ev.target.matches('input[type="search"]')) {
        ev.preventDefault(); ev.stopPropagation();
        var primeiro = host.querySelector('[data-acao="escolher-paciente"]');
        if (primeiro) api.set(primeiro.getAttribute('data-id'));
        else if (estado.q) abrirNovo();
      } else if (ev.target.closest('[data-novo]')) { ev.preventDefault(); ev.stopPropagation(); criar(); }
    });
    host.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-acao]');
      if (!b || !host.contains(b)) return;
      var a = b.getAttribute('data-acao');
      if (a === 'escolher-paciente') { ev.stopPropagation(); api.set(b.getAttribute('data-id')); }
      else if (a === 'novo-paciente') { ev.stopPropagation(); abrirNovo(); }
      else if (a === 'criar-paciente') { ev.stopPropagation(); criar(); }
      else if (a === 'trocar-paciente') { ev.stopPropagation(); estado.q = ''; api.set(null); api.focar(); }
    });
    desenhar();
    return api;
  }

  /* =================== drawer: criar / editar =================== */
  function opcoes(lista, valor, rotulo) {
    return lista.map(function (x) { return '<option value="' + e(x.id) + '"' + (x.id === valor ? ' selected' : '') + '>' + e(rotulo ? rotulo(x) : x.nome) + '</option>'; }).join('');
  }
  function avisoHtml(tipo, texto, extra) {
    return '<div class="aviso-inline' + (tipo === 'erro' ? ' is-erro' : '') + '" role="' + (tipo === 'erro' ? 'alert' : 'status') + '"><i class="ti ' + (tipo === 'erro' ? 'ti-alert-circle' : 'ti-alert-triangle') + '" aria-hidden="true"></i><span class="ag-cresce">' + e(texto) + '</span>' + (extra || '') + '</div>';
  }
  function formHtml(f, procs) {
    var pr = proc(f.procId);
    return '<div class="campo"><label>Paciente</label><div data-paciente></div><div class="campo-erro" data-erro-paciente hidden></div></div>' +
      '<div class="campos-2"><div class="campo"><label for="agf-prof">Profissional</label><select id="agf-prof" name="profId" class="select"' + (f.pacId ? ' autofocus' : '') + '>' + opcoes(profsAtivos(), f.profId) + '</select></div>' +
      '<div class="campo"><label for="agf-proc">Procedimento</label><select id="agf-proc" name="procId" class="select">' + (procs.length ? '' : '<option value="">Sem procedimento</option>') + opcoes(procs, f.procId, function (p) { return p.nome + ' · ' + p.dur + ' min' + (p.valorCent ? ' · ' + CL.fmt.dinheiro(p.valorCent) : ''); }) + '</select><span class="ag-valor" data-valor>' + (pr && pr.valorCent ? e(CL.fmt.dinheiro(pr.valorCent)) : '') + '</span></div></div>' +
      '<div class="campos-2"><div class="campo"><label for="agf-data">Data</label><input id="agf-data" type="date" name="data" value="' + e(f.data) + '" required></div>' +
      '<div class="campo"><label for="agf-hora">Hora</label><input id="agf-hora" type="time" name="hora" value="' + e(f.hora) + '" step="300" required></div></div>' +
      '<div class="campos-2"><div class="campo"><label for="agf-dur">Duração (min)</label><input id="agf-dur" type="number" name="dur" value="' + e(f.dur) + '" min="5" step="5" inputmode="numeric"></div>' +
      '<div class="campo"><label for="agf-conv">Convênio</label><select id="agf-conv" name="convenioId" class="select">' + opcoes(convsAtivos(), f.convenioId) + '</select></div></div>' +
      '<div class="campo" data-campo="encaixe"><label class="campo-linha"><input type="checkbox" name="encaixe"' + (f.encaixe ? ' checked' : '') + '> Encaixe (fora da grade, lado a lado)</label><input type="text" name="encaixeMotivo" class="input" placeholder="Motivo do encaixe (obrigatório)" value="' + e(f.encaixeMotivo) + '"' + (f.encaixe ? '' : ' hidden') + '></div>' +
      '<div class="campo" data-campo="tele"' + (pr && pr.modalidade === 'tele' ? '' : ' hidden') + '><label for="agf-tele">Link da teleconsulta</label><input id="agf-tele" type="url" name="teleLink" value="' + e(f.teleLink) + '" placeholder="https://…" inputmode="url"><span class="campo-ajuda">Entra na mensagem de WhatsApp do modelo Teleconsulta.</span></div>' +
      '<div class="campo"><label for="agf-obs">Observação</label><textarea id="agf-obs" name="obs" class="textarea" rows="2">' + e(f.obs) + '</textarea></div>' +
      '<div class="pilha" data-avisos></div>';
  }
  function reabrirEspera(esperaId) {
    var x = CL.get('espera', esperaId);
    if (x && x.status === 'marcado') CL.patch('espera', esperaId, { status: 'aguardando', consultaId: null });
  }
  function concluirEspera(esperaId, consulta) {
    var x = CL.get('espera', esperaId);
    if (!x) return;
    var p = pac(x.pacId);
    CL.ui.confirmar({ titulo: 'Tirar da lista de espera?', texto: 'A consulta de ' + (p ? CL.nomeExibido(p.nome) : 'paciente') + ' foi marcada. Tirar da lista de espera?', ok: 'Tirar da lista', cancelar: 'Manter na lista' })
      .then(function (ok) { CL.patch('espera', esperaId, ok ? { status: 'marcado', consultaId: consulta.id } : { consultaId: consulta.id }); });
  }
  function abrirForm(dados, existente) {
    dados = dados || {};
    if (!profsAtivos().length) {
      CL.ui.toast('Cadastre um profissional antes de marcar consultas', { kind: 'aviso', action: { rotulo: 'Cadastrar', fn: abrirNovoProfissional } });
      return null;
    }
    var c = existente || null;
    var pfId = dados.profId || (c && c.profId) || selecionados()[0] || profsAtivos()[0].id;
    var pf = prof(pfId) || profsAtivos()[0];
    var procs = procsAtivos();
    if (pf && Array.isArray(pf.procIds) && pf.procIds.length) {
      var permitidos = procs.filter(function (p) { return pf.procIds.indexOf(p.id) >= 0; });
      if (permitidos.length) procs = permitidos;
    }
    var procId = (c && c.procId) || dados.procId || (pf && pf.procPadraoId && proc(pf.procPadraoId) ? pf.procPadraoId : '') || (procs[0] ? procs[0].id : '');
    var pr = proc(procId);
    var pacId = (c && c.pacId) || dados.pacId || null, p = pac(pacId);
    var f = {
      id: c ? c.id : null, pacId: pacId, profId: pf ? pf.id : '', procId: procId,
      data: dados.data || (c && c.data) || ((st.data && st.visao !== 'espera' && st.visao !== 'mes') ? st.data : hoje()),
      hora: CL.fmt.hora(dados.hora || (c && c.hora) || proximaHoraLivre()),
      dur: parseInt(dados.dur, 10) || (c && c.dur) || (pr && pr.dur) || 30,
      convenioId: (c && c.convenioId) || (p && p.convenioId) || 'particular',
      encaixe: !!dados.encaixe || !!(c && c.encaixe), encaixeMotivo: (c && c.encaixeMotivo) || '', obs: (c && c.obs) || '', teleLink: (c && c.teleLink) || '',
      esperaId: dados.esperaId || (c && c.esperaId) || null, origem: dados.origem || (c && c.origem) || ''
    };
    var corpo = document.createElement('form');
    corpo.className = 'ag-form'; corpo.noValidate = true;
    corpo.innerHTML = formHtml(f, procs);
    var campoPac = campoPaciente(corpo.querySelector('[data-paciente]'), {
      pacId: f.pacId, autofocus: !f.pacId,
      aoMudar: function (id) {
        f.pacId = id;
        var pp = pac(id), s = corpo.querySelector('[name="convenioId"]');
        if (pp && pp.convenioId && s && conv(pp.convenioId)) s.value = pp.convenioId;
        var erro = corpo.querySelector('[data-erro-paciente]'); if (erro) { erro.hidden = true; erro.textContent = ''; }
        atualizarAvisos();
      }
    });
    var rodape = document.createElement('div');
    rodape.className = 'ag-form-rodape';
    rodape.innerHTML = '<span class="ag-politica">' + e(textoPolitica()) + '</span><button type="button" class="btn btn-neutro" data-acao="cancelar">Cancelar</button><button type="button" class="btn btn-primario" data-acao="salvar"><i class="ti ti-check" aria-hidden="true"></i>Salvar</button>';
    var ctx = CL.ui.drawer({ titulo: c ? 'Editar consulta' : 'Nova consulta', corpo: corpo, rodape: rodape, aoFechar: function () { limparPreview(); if (formAberto && formAberto.ctx === ctx) formAberto = null; } });
    function g(n) { return corpo.querySelector('[name="' + n + '"]'); }
    function ler() {
      return {
        id: f.id, pacId: campoPac.get(), profId: g('profId').value, procId: g('procId').value, data: g('data').value, hora: g('hora').value,
        dur: parseInt(g('dur').value, 10) || 0, convenioId: g('convenioId').value, encaixe: g('encaixe').checked && !corpo.querySelector('[data-campo="encaixe"]').hidden,
        encaixeMotivo: g('encaixeMotivo').value, obs: g('obs').value, teleLink: g('teleLink').value, esperaId: f.esperaId, origem: f.origem
      };
    }
    formAberto = { ctx: ctx, ler: ler };
    function atualizarEncaixe() {
      var d = ler(), box = corpo.querySelector('[data-campo="encaixe"]'), chk = g('encaixe');
      var jaEncaixe = !!(c && c.encaixe);
      var limite = !jaEncaixe && !!d.data && !!d.hora && conflitos({ data: d.data, hora: d.hora, dur: d.dur, profId: d.profId, ignorarId: f.id, encaixe: true }).some(function (x) { return x.tipo === 'limite_encaixe'; });
      box.hidden = limite;
      if (limite) chk.checked = false;
      g('encaixeMotivo').hidden = !chk.checked;
    }
    function atualizarAvisos() {
      var box = corpo.querySelector('[data-avisos]'), d = ler();
      if (!d.data || !d.hora || !d.profId) { box.innerHTML = ''; return; }
      var todos = conflitos({ data: d.data, hora: d.hora, dur: d.dur, profId: d.profId, pacId: d.pacId, ignorarId: f.id, encaixe: d.encaixe });
      var hard = duros(todos, d.encaixe), soft = avisosDe(todos);
      box.innerHTML = hard.map(function (x) { return avisoHtml('erro', x.texto, x.tipo === 'sobreposicao' && !corpo.querySelector('[data-campo="encaixe"]').hidden ? '<button type="button" class="btn btn-neutro btn-pequeno" data-acao="encaixar">Encaixar</button>' : ''); }).join('') +
        soft.map(function (x) { return avisoHtml('aviso', x.texto); }).join('');
    }
    function atualizarProc() {
      var pr2 = proc(g('procId').value), durEl = g('dur');
      if (pr2 && !durEl.getAttribute('data-manual')) durEl.value = pr2.dur || 30;
      corpo.querySelector('[data-valor]').textContent = pr2 && pr2.valorCent ? CL.fmt.dinheiro(pr2.valorCent) : '';
      corpo.querySelector('[data-campo="tele"]').hidden = !(pr2 && pr2.modalidade === 'tele');
    }
    function tudo() { atualizarEncaixe(); atualizarAvisos(); atualizarPreview(); }
    function submeter(ignorar) {
      var d = ler();
      var r = salvar(d, { ignorarAvisos: !!ignorar });
      if (!r.ok) {
        var box = corpo.querySelector('[data-avisos]'), html = '';
        r.conflitos.forEach(function (x) {
          if (x.tipo === 'paciente') { var er = corpo.querySelector('[data-erro-paciente]'); er.innerHTML = '<i class="ti ti-alert-circle" aria-hidden="true"></i> ' + e(x.texto); er.hidden = false; return; }
          html += avisoHtml('erro', x.texto, x.tipo === 'sobreposicao' && !d.encaixe && !corpo.querySelector('[data-campo="encaixe"]').hidden ? '<button type="button" class="btn btn-neutro btn-pequeno" data-acao="encaixar">Encaixar</button>' : '');
        });
        (r.avisos || []).forEach(function (x) { html += avisoHtml('aviso', x.texto); });
        if (!r.conflitos.length && r.avisos && r.avisos.length) html += '<div class="linha-acoes"><button type="button" class="btn btn-neutro" data-acao="salvar-assim"><i class="ti ti-check" aria-hidden="true"></i>Salvar assim mesmo</button></div>';
        box.innerHTML = html;
        if (r.conflitos.some(function (x) { return x.tipo === 'paciente'; })) campoPac.focar();
        else if (r.conflitos.some(function (x) { return x.tipo === 'encaixe'; })) { g('encaixeMotivo').hidden = false; g('encaixeMotivo').focus(); }
        else if (r.conflitos.some(function (x) { return x.tipo === 'tele'; })) { corpo.querySelector('[data-campo="tele"]').hidden = false; g('teleLink').focus(); }
        return;
      }
      var nova = !c, consulta = r.consulta;
      ctx.fechar({ motivo: 'salvo' });
      if (nova) {
        var idNova = consulta.id, criadaEm = Date.now();
        CL.ui.toast('Consulta marcada para ' + dataCurta(consulta.data) + ' ' + consulta.hora, {
          kind: 'ok', action: { rotulo: 'Desfazer', fn: function () {
            if (Date.now() - criadaEm > DESFAZER_MS) { CL.ui.toast('Já passou o tempo para desfazer — cancele a consulta pela agenda', { kind: 'aviso' }); return; }
            var cc = CL.get('consultas', idNova);
            if (cc && cc.status === 'agendado') { CL.remove('consultas', idNova); if (cc.esperaId) reabrirEspera(cc.esperaId); CL.ui.toast('Consulta desfeita', { kind: 'ok' }); }
          } }
        });
        if (f.esperaId) concluirEspera(f.esperaId, consulta);
        if (modoVaga && (!f.esperaId || modoVaga.esperaId === f.esperaId)) { modoVaga = null; agendarRender(); }
        if (el && (st.visao === 'dia' || st.visao === 'lista' || st.visao === 'semana') && consulta.data !== st.data) irPara(st.visao, consulta.data, st.profs);
      } else CL.ui.toast('Consulta atualizada', { kind: 'ok' });
    }
    ctx.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-acao]');
      if (!b) return;
      var a = b.getAttribute('data-acao');
      if (a === 'cancelar') ctx.fechar({ motivo: 'cancelar' });
      else if (a === 'salvar') submeter(false);
      else if (a === 'salvar-assim') submeter(true);
      else if (a === 'encaixar') { g('encaixe').checked = true; g('encaixeMotivo').hidden = false; atualizarAvisos(); atualizarPreview(); g('encaixeMotivo').focus(); }
    });
    corpo.addEventListener('submit', function (ev) { ev.preventDefault(); submeter(false); });
    corpo.addEventListener('change', function (ev) {
      var n = ev.target.getAttribute('name');
      if (n === 'procId') { atualizarProc(); tudo(); }
      else if (n === 'dur') { ev.target.setAttribute('data-manual', '1'); tudo(); }
      else if (n === 'profId' || n === 'data' || n === 'hora' || n === 'encaixe') tudo();
    });
    corpo.addEventListener('input', function (ev) {
      var n = ev.target.getAttribute('name');
      if (n === 'hora' || n === 'dur') { if (n === 'dur') ev.target.setAttribute('data-manual', '1'); atualizarPreview(); }
    });
    atualizarEncaixe();
    if (f.encaixe) g('encaixeMotivo').hidden = false;
    atualizarAvisos();
    atualizarPreview();
    if (!f.pacId) requestAnimationFrame(function () { campoPac.focar(); });
    return ctx;
  }
  var previewEl = null;
  function limparPreview() { if (previewEl && previewEl.parentNode) previewEl.parentNode.removeChild(previewEl); previewEl = null; }
  function atualizarPreview() {
    limparPreview();
    if (!el || !formAberto || typeof formAberto.ler !== 'function') return;
    var d;
    try { d = formAberto.ler(); } catch (err) { return; }
    if (!d.data || !d.hora || !d.profId) return;
    var col = el.querySelector('.ag-col[data-prof="' + d.profId + '"][data-data="' + d.data + '"]');
    if (!col) return;
    var corpo = col.querySelector('.ag-col-corpo'), ini = +corpo.getAttribute('data-ini'), fim = +corpo.getAttribute('data-fim');
    var m = U.min(d.hora), dur = Math.max(5, d.dur || 30), hpx = horaPx();
    if (m < ini || m >= fim) return;
    var s = document.createElement('div');
    s.className = 'ag-sombra is-previa';
    s.style.top = ((m - ini) / 60 * hpx) + 'px';
    s.style.height = (dur / 60 * hpx) + 'px';
    var pr = proc(d.procId);
    if (pr && pr.cor) s.style.borderColor = pr.cor;
    s.innerHTML = '<span class="ag-sombra-rotulo">' + e(CL.fmt.hora(d.hora) + '–' + U.hhmm(m + dur)) + '</span>';
    corpo.appendChild(s);
    previewEl = s;
  }

  /* =================== drawer: ver consulta =================== */
  function dado(rotulo, valor, html) {
    return '<dt>' + e(rotulo) + '</dt><dd>' + (html ? valor : e(valor)) + '</dd>';
  }
  function verHtml(c) {
    var p = pac(c.pacId), pr = proc(c.procId), pf = prof(c.profId), cv = conv(c.convenioId || (p && p.convenioId));
    var html = '<div class="ag-ver-cabeca"><span class="avatar avatar-lg" aria-hidden="true">' + e(p ? U.iniciais(p.nome) : '?') + '</span><div class="ag-cresce">' +
      (p ? '<a class="ag-ver-nome nome-paciente" href="#/pacientes/' + e(p.id) + '" data-acao="ficha" data-id="' + e(p.id) + '">' + e(CL.nomeExibido(p.nome)) + '</a>' : '<span class="ag-ver-nome">Sem paciente</span>') +
      '<div class="texto-2">' + [p && CL.fmt.idade(p.nasc), cv && cv.nome].filter(Boolean).map(e).join(' · ') + '</div>' +
      (p && p.fone ? '<div class="linha-acoes"><a href="tel:+' + e(foneWa(p.fone)) + '">' + e(CL.fmt.fone(p.fone)) + '</a><button type="button" class="btn btn-neutro btn-pequeno" data-acao="whatsapp" data-id="' + e(c.id) + '"><i class="ti ti-brand-whatsapp" aria-hidden="true"></i>WhatsApp</button></div>' : '<div class="ajuda">Sem telefone na ficha</div>') +
      (p ? '<div class="linha-acoes">' + selos(p) + '</div>' : '') + '</div></div>';
    html += '<div class="linha-acoes">' + CL.chipStatus(c.status) + (c.encaixe ? '<span class="chip"><i class="ti ti-arrows-diagonal" aria-hidden="true"></i>Encaixe</span>' : '') + (c.origem === 'espera' ? '<span class="chip"><i class="ti ti-list-numbers" aria-hidden="true"></i>Da lista de espera</span>' : '') + '</div>';
    html += '<dl class="ag-ver-dados">' +
      dado('Quando', dataCurta(c.data) + ' · ' + c.hora + '–' + U.hhmm(fimDe(c)) + ' (' + durDe(c) + ' min)') +
      dado('Procedimento', pr ? pr.nome + (pr.valorCent ? ' · ' + CL.fmt.dinheiro(pr.valorCent) : '') : '—') +
      dado('Profissional', pf ? pf.nome : '—') +
      (c.encaixeMotivo ? dado('Motivo do encaixe', c.encaixeMotivo) : '') +
      (c.obs ? dado('Observação', c.obs) : '') +
      (c.teleLink ? dado('Teleconsulta', U.urlSegura(c.teleLink) ? '<a href="' + e(U.urlSegura(c.teleLink)) + '" target="_blank" rel="noopener">' + e(c.teleLink) + '</a>' : e(c.teleLink), true) : '') +
      (c.lembreteEm ? dado('Último WhatsApp', CL.fmt.dataHora(c.lembreteEm)) : '') +
      (c.cancelamento ? dado('Cancelamento', CL.fmt.dataHora(c.cancelamento.em) + (c.cancelamento.motivo ? ' · ' + c.cancelamento.motivo : '') + (c.cancelamento.porQuem === 'clinica' ? ' · pela clínica' : '')) : '') + '</dl>';
    var l = c.lancamentoId ? CL.get('lancamentos', c.lancamentoId) : null;
    if (!l) l = CL.col('lancamentos').filter(function (x) { return x && x.consultaId === c.id && x.status !== 'cancelado'; })[0] || null;
    if (l) html += '<div class="ag-lanc"><i class="ti ti-cash" aria-hidden="true"></i><span class="ag-cresce">' + e(l.descricao || 'Lançamento') + ' · ' + e(CL.fmt.dinheiro(l.valorCent)) + ' · ' + (l.status === 'recebido' ? 'recebido' : l.status === 'pendente' ? 'pendente' : 'cancelado') + '</span>' +
      (l.status === 'pendente' && CL.can('financeiro') && window.Financeiro && typeof Financeiro.baixa === 'function' ? '<button type="button" class="btn btn-neutro btn-pequeno" data-acao="receber" data-id="' + e(l.id) + '">Receber</button>' : '') + '</div>';
    var hist = Array.isArray(c.historico) ? c.historico.slice().reverse() : [];
    html += '<details class="ag-hist"><summary>Histórico (' + hist.length + ')</summary><ul class="ag-historico">' + hist.map(function (h) {
      var txt;
      if (h.acao === 'criada') txt = 'Criada';
      else if (h.acao === 'remarcada') txt = (h.desfeito ? 'Remarcação desfeita: ' : 'Remarcada de ') + (h.de || '') + ' para ' + (h.para || '');
      else if (h.acao === 'status') txt = (CL.STATUS[h.de] ? CL.STATUS[h.de].rotulo : h.de) + ' → ' + (CL.STATUS[h.para] ? CL.STATUS[h.para].rotulo : h.para) + (h.motivo ? ' (' + h.motivo + ')' : '');
      else if (h.acao === 'lembrete') txt = 'WhatsApp aberto (' + (ROTULO_MODELO[h.chave] || h.chave || 'mensagem') + ')';
      else txt = 'Editada';
      return '<li><span class="tnum">' + e(CL.fmt.dataHora(h.em)) + '</span> · ' + e(txt) + (h.usuario ? ' · ' + e(h.usuario) : '') + '</li>';
    }).join('') + '</ul></details>';
    return html;
  }
  function verRodapeHtml(c) {
    var prox = CL.proximoStatus(c.status), html = '<button type="button" class="btn btn-icone btn-neutro" data-acao="menu" data-id="' + e(c.id) + '" aria-label="Mais ações" aria-haspopup="menu"><i class="ti ti-dots" aria-hidden="true"></i></button>';
    if (prox) {
      var dis = prox === 'em_atendimento' && !CL.can('clinico');
      html += '<button type="button" class="btn btn-primario ag-cresce" data-acao="avancar" data-id="' + e(c.id) + '" data-para="' + prox + '"' + (dis ? ' disabled title="Seu perfil não abre o prontuário — o profissional inicia o atendimento"' : '') + '><i class="ti ' + CL.STATUS[prox].icone + '" aria-hidden="true"></i>' + ROTULO_AVANCO[prox] + '</button>';
    }
    return html;
  }
  function avancar(id, para) {
    var c = CL.get('consultas', id);
    if (!c) return Promise.resolve({ ok: false });
    para = para || CL.proximoStatus(c.status);
    if (!para) return Promise.resolve({ ok: false });
    if (para === 'em_atendimento') {
      if (!CL.can('clinico')) { CL.ui.toast('Seu perfil não abre o prontuário', { kind: 'aviso' }); return Promise.resolve({ ok: false }); }
      if (window.Atendimento && typeof Atendimento.iniciar === 'function') return Promise.resolve(Atendimento.iniciar(id)).then(function () { return { ok: true, status: 'em_atendimento' }; });
    }
    return mudarStatus(id, para).then(function (r) {
      if (r.ok) CL.ui.toast(CL.STATUS[r.status].rotulo, { kind: 'ok', ms: 2500 });
      return r;
    });
  }
  function abrirConsulta(id) {
    var c = CL.get('consultas', id);
    if (!c) { CL.ui.toast('Consulta não encontrada', { kind: 'aviso' }); return null; }
    var corpo = document.createElement('div');
    corpo.className = 'ag-ver';
    corpo.innerHTML = verHtml(c);
    var rodape = document.createElement('div');
    rodape.className = 'ag-ver-rodape';
    rodape.innerHTML = verRodapeHtml(c);
    var un = null;
    var ctx = CL.ui.drawer({ titulo: 'Consulta', corpo: corpo, rodape: rodape, aoFechar: function () { if (un) { un(); un = null; } } });
    un = CL.on('change', function (info) {
      if (!document.contains(ctx.el)) { if (un) { un(); un = null; } return; }
      if (!info || (info.col !== '*' && info.col !== 'lancamentos' && info.col !== 'pacientes' && !(info.col === 'consultas' && info.id === id))) return;
      var cc = CL.get('consultas', id);
      if (!cc) { ctx.fechar({ motivo: 'removida' }); return; }
      corpo.innerHTML = verHtml(cc);
      rodape.innerHTML = verRodapeHtml(cc);
    });
    ctx.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-acao]');
      if (!b) return;
      var a = b.getAttribute('data-acao');
      var cc = CL.get('consultas', id);
      if (!cc) return;
      if (a === 'avancar') avancar(id, b.getAttribute('data-para'));
      else if (a === 'menu') menuConsulta(b, cc);
      else if (a === 'whatsapp') abrirWhatsapp(id);
      else if (a === 'ficha') { ev.preventDefault(); ctx.fechar({ motivo: 'ficha' }); abrirFicha(b.getAttribute('data-id')); }
      else if (a === 'receber') { if (window.Financeiro && typeof Financeiro.baixa === 'function') Financeiro.baixa(b.getAttribute('data-id')); }
    });
    return ctx;
  }
  function menuConsulta(ancora, c) {
    var itens = [], term = !!(CL.STATUS[c.status] || {}).terminal;
    if (!term) {
      itens.push({ rotulo: 'Faltou', icone: 'ti-user-off', fn: function () { abrirFalta(c.id); } });
      itens.push({ rotulo: 'Cancelou (paciente)', icone: 'ti-x', fn: function () { abrirCancelar(c.id, 'cancelado'); } });
      itens.push({ rotulo: 'Cancelado pela clínica', icone: 'ti-building-off', fn: function () { abrirCancelar(c.id, 'cancelado_clinica'); } });
      itens.push('-');
      itens.push({ rotulo: 'Remarcar', icone: 'ti-calendar-repeat', fn: function () { abrirRemarcar(c.id); } });
      itens.push({ rotulo: 'Editar', icone: 'ti-pencil', fn: function () { abrirForm({}, CL.get('consultas', c.id)); } });
      itens.push('-');
    }
    itens.push({ rotulo: 'Copiar link do WhatsApp', icone: 'ti-copy', fn: function () { copiarWa(c.id); } });
    itens.push({ rotulo: 'Imprimir comprovante', icone: 'ti-printer', fn: function () { imprimirComprovante(c.id); } });
    itens.push({ rotulo: 'Adicionar à lista de espera', icone: 'ti-list-numbers', fn: function () { abrirEsperaForm({ pacId: c.pacId, profId: c.profId, procId: c.procId }); } });
    if (term && CL.session && CL.session.perfil === 'admin') {
      itens.push('-');
      itens.push({ rotulo: c.status === 'finalizado' ? 'Reabrir atendimento' : 'Reabrir como agendada', icone: 'ti-rotate', fn: function () { mudarStatus(c.id, c.status === 'finalizado' ? 'em_atendimento' : 'agendado', { reabrir: true }); } });
    }
    CL.ui.menu(ancora, itens);
  }
  function abrirFalta(id) {
    var c = CL.get('consultas', id);
    if (!c) return;
    CL.ui.confirmar({ titulo: 'Registrar falta', texto: 'Marcar que ' + nomePac(c) + ' faltou à consulta de ' + dataCurta(c.data) + ' às ' + c.hora + '?' + (taxaFaltaCent(c) ? ' Uma taxa de falta de ' + CL.fmt.dinheiro(taxaFaltaCent(c)) + ' será lançada como pendente.' : ''), ok: 'Registrar falta', okTipo: 'perigo' })
      .then(function (ok) { if (ok) mudarStatus(id, 'faltou').then(function (r) { if (r.ok) CL.ui.toast('Falta registrada', { kind: 'ok' }); }); });
  }
  function abrirCancelar(id, tipo) {
    var c = CL.get('consultas', id);
    if (!c) return;
    CL.ui.pedirTexto({ titulo: tipo === 'cancelado_clinica' ? 'Cancelar pela clínica' : 'Cancelamento pelo paciente', rotulo: 'Motivo', placeholder: tipo === 'cancelado_clinica' ? 'Ex.: profissional adoeceu' : 'Ex.: imprevisto, pediu para remarcar', ok: 'Cancelar consulta' })
      .then(function (motivo) {
        if (motivo === null) return;
        mudarStatus(id, tipo, { motivo: motivo, porQuem: tipo === 'cancelado_clinica' ? 'clinica' : 'paciente' }).then(function (r) {
          if (!r.ok) return;
          CL.ui.toast(r.status === 'cancelado_tarde' ? 'Cancelamento tardio registrado (dentro da janela de ' + (politica().janelaCancelamentoH || 0) + ' h)' : 'Consulta cancelada', { kind: 'ok' });
        });
      });
  }
  function abrirRemarcar(id) {
    var c = CL.get('consultas', id);
    if (!c) return;
    var corpo = document.createElement('form');
    corpo.className = 'ag-form'; corpo.noValidate = true;
    corpo.innerHTML = '<p class="texto-2">' + e(nomePac(c)) + ' · hoje em ' + e(dataCurta(c.data)) + ' às ' + e(c.hora) + '</p>' +
      '<div class="campos-2"><div class="campo"><label for="agr-data">Nova data</label><input id="agr-data" type="date" name="data" value="' + e(c.data) + '" autofocus></div><div class="campo"><label for="agr-hora">Nova hora</label><input id="agr-hora" type="time" name="hora" value="' + e(c.hora) + '" step="300"></div></div>' +
      '<div class="campo"><label for="agr-prof">Profissional</label><select id="agr-prof" name="profId" class="select">' + opcoes(profsAtivos(), c.profId) + '</select></div><div class="pilha" data-avisos></div>';
    var m = CL.ui.modal({
      titulo: 'Remarcar consulta', corpo: corpo,
      botoes: [
        { rotulo: 'Cancelar', tipo: 'neutro' },
        { rotulo: 'Remarcar', tipo: 'primario', icone: 'ti-calendar-repeat', acao: function () { return tentar(); } }
      ]
    });
    function tentar() {
      var d = { data: corpo.querySelector('[name="data"]').value, hora: corpo.querySelector('[name="hora"]').value, profId: corpo.querySelector('[name="profId"]').value };
      return remarcar(id, d, { confirmarProf: false }).then(function (r) {
        if (r.ok) return true;
        corpo.querySelector('[data-avisos]').innerHTML = (r.conflitos || []).map(function (x) { return avisoHtml('erro', x.texto); }).join('') || avisoHtml('erro', 'Não foi possível remarcar');
        return false;
      });
    }
    corpo.addEventListener('submit', function (ev) { ev.preventDefault(); tentar().then(function (ok) { if (ok) m.fechar({ motivo: 'enter' }); }); });
  }
  function copiarWa(id) {
    var r = whatsapp(id, 'confirmar');
    if (!r.fone) { CL.ui.toast('O paciente não tem telefone na ficha', { kind: 'aviso' }); return; }
    var feito = function () { CL.ui.toast('Link copiado', { kind: 'ok' }); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(r.url).then(feito, function () { CL.ui.toast('Não foi possível copiar — abra pelo botão WhatsApp', { kind: 'aviso' }); });
    else CL.ui.toast('Copiar não é permitido neste navegador — abra pelo botão WhatsApp', { kind: 'aviso' });
  }
  function imprimirComprovante(id) {
    var c = CL.get('consultas', id);
    if (!c) return;
    var p = pac(c.pacId), pf = prof(c.profId), pr = proc(c.procId), cl = cfg().clinica || {};
    var corpo = '<p>Consulta marcada para <strong>' + e(capitalizar(CL.fmt.dataExtenso(c.data))) + '</strong>, às <strong>' + e(c.hora) + '</strong>.</p>' +
      '<p>Profissional: ' + e(pf ? pf.nome : '') + (pr ? '<br>Procedimento: ' + e(pr.nome) : '') + (pr && pr.modalidade === 'tele' && c.teleLink ? '<br>Link: ' + e(c.teleLink) : '') + '</p>' +
      (cl.endereco ? '<p>Endereço: ' + e(cl.endereco) + (cl.telefone ? ' · ' + e(cl.telefone) : '') + '</p>' : '') +
      '<p>' + e(textoPolitica()) + '. Em caso de imprevisto, avise a clínica com antecedência.</p>';
    CL.print.documento({ titulo: 'Comprovante de agendamento', tipoDoc: 'agenda', corpoHtml: corpo, paciente: p || null, profissional: pf || {}, semAssinatura: true, id: c.id });
  }

  /* =================== WhatsApp =================== */
  function abrirWhatsapp(id, chaveInicial) {
    var c = CL.get('consultas', id);
    if (!c) return;
    var p = pac(c.pacId);
    if (!p) { CL.ui.toast('Esta consulta não tem paciente vinculado', { kind: 'aviso' }); return; }
    var pr = proc(c.procId);
    var chave = ROTULO_MODELO[chaveInicial] ? chaveInicial : (pr && pr.modalidade === 'tele' && c.teleLink ? 'tele' : 'confirmar');
    var consent = !!(p.consentimentos && p.consentimentos.lembretes && p.consentimentos.lembretes.ativo);
    var corpo = document.createElement('div');
    corpo.className = 'pilha';
    corpo.innerHTML = '<div class="campo"><label for="agw-fone">Telefone (WhatsApp)</label><input id="agw-fone" type="tel" inputmode="tel" autocomplete="off" value="' + e(p.fone ? CL.fmt.fone(p.fone) : '') + '" placeholder="(85) 99999-9999"><span class="campo-ajuda">O código do Brasil (55) é adicionado sozinho.</span></div>' +
      '<div class="campo"><span class="campo-rotulo">Modelo</span><div class="segmentado ag-abas" role="group" aria-label="Modelo de mensagem">' + Object.keys(ROTULO_MODELO).map(function (k) { return '<button type="button" data-chave="' + k + '" aria-pressed="' + (k === chave ? 'true' : 'false') + '">' + ROTULO_MODELO[k] + '</button>'; }).join('') + '</div></div>' +
      '<div class="campo"><span class="campo-rotulo">Prévia</span><div class="ag-wa-previa" data-previa></div></div>' +
      (consent ? '' : '<div class="aviso-inline is-info"><i class="ti ti-info-circle" aria-hidden="true"></i><span>O paciente ainda não registrou autorização para lembretes. Confirmar a consulta é operacional; guardar o consentimento evita dúvidas depois.</span></div><label class="campo-linha"><input type="checkbox" data-optin> Registrar agora que o paciente autorizou lembretes (verbal)</label>') +
      '<p class="ajuda">Nada é enviado automaticamente — o WhatsApp abre com o texto pronto.</p>';
    function atualizar() {
      var r = whatsapp(id, chave, { fone: corpo.querySelector('#agw-fone').value });
      corpo.querySelector('[data-previa]').textContent = r.texto;
      return r;
    }
    corpo.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-chave]');
      if (!b) return;
      chave = b.getAttribute('data-chave');
      Array.prototype.forEach.call(corpo.querySelectorAll('[data-chave]'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      atualizar();
    });
    corpo.addEventListener('input', function (ev) { if (ev.target.id === 'agw-fone') atualizar(); });
    atualizar();
    CL.ui.modal({
      titulo: 'WhatsApp para ' + CL.nomeExibido(p.nome), corpo: corpo,
      botoes: [
        { rotulo: 'Cancelar', tipo: 'neutro' },
        { rotulo: 'Copiar texto', tipo: 'neutro', icone: 'ti-copy', fecha: false, acao: function () {
          var r = atualizar();
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(r.texto).then(function () { CL.ui.toast('Texto copiado', { kind: 'ok' }); }, function () { CL.ui.toast('Não foi possível copiar', { kind: 'aviso' }); });
          else CL.ui.toast('Copiar não é permitido neste navegador', { kind: 'aviso' });
        } },
        { rotulo: 'Abrir WhatsApp', tipo: 'primario', icone: 'ti-brand-whatsapp', acao: function () {
          var r = atualizar();
          if (!r.fone || r.fone.length < 12) { CL.ui.toast('Informe um telefone com DDD', { kind: 'aviso' }); corpo.querySelector('#agw-fone').focus(); return false; }
          var digitos = U.digits(corpo.querySelector('#agw-fone').value);
          var patch = {};
          if (!U.digits(p.fone) && digitos) patch.fone = digitos;
          var opt = corpo.querySelector('[data-optin]');
          if (opt && opt.checked) {
            var cons = Object.assign({}, p.consentimentos || {});
            cons.lembretes = { ativo: true, em: Date.now(), origem: 'verbal' };
            patch.consentimentos = cons;
          }
          if (Object.keys(patch).length) CL.patch('pacientes', p.id, patch);
          registrarLembrete(CL.get('consultas', id) || c, chave);
          abrirUrl(r.url);
          CL.ui.toast('WhatsApp aberto — registrado na consulta', { kind: 'ok' });
        } }
      ]
    });
  }
  function abrirOferta(esperaId, slot) {
    var x = CL.get('espera', esperaId);
    if (!x) return;
    var p = pac(x.pacId);
    if (!p || !U.digits(p.fone)) { CL.ui.toast('O paciente não tem telefone na ficha', { kind: 'aviso' }); return; }
    slot = slot || proximaVaga({ profId: x.profId || null, procId: x.procId }) || { data: hoje(), hora: '08:00', profId: x.profId || (profsAtivos()[0] || {}).id };
    var corpo = document.createElement('form');
    corpo.className = 'ag-form'; corpo.noValidate = true;
    corpo.innerHTML = '<p class="texto-2">Oferecer um horário a <strong class="nome-paciente">' + e(CL.nomeExibido(p.nome)) + '</strong> pelo WhatsApp. A oferta fica registrada na lista.</p>' +
      '<div class="campos-2"><div class="campo"><label for="ago-data">Data</label><input id="ago-data" type="date" name="data" value="' + e(slot.data) + '" autofocus></div><div class="campo"><label for="ago-hora">Hora</label><input id="ago-hora" type="time" name="hora" value="' + e(slot.hora) + '" step="300"></div></div>' +
      '<div class="campo"><label for="ago-prof">Profissional</label><select id="ago-prof" name="profId" class="select">' + opcoes(profsAtivos(), slot.profId) + '</select></div>';
    CL.ui.modal({
      titulo: 'Oferecer horário', corpo: corpo,
      botoes: [
        { rotulo: 'Cancelar', tipo: 'neutro' },
        { rotulo: 'Abrir WhatsApp', tipo: 'primario', icone: 'ti-brand-whatsapp', acao: function () {
          var s = { data: corpo.querySelector('[name="data"]').value, hora: corpo.querySelector('[name="hora"]').value, profId: corpo.querySelector('[name="profId"]').value };
          if (!s.data || !s.hora) { CL.ui.toast('Informe data e hora', { kind: 'aviso' }); return false; }
          abrirUrl(espera.ofertar(esperaId, s));
          CL.ui.toast('Oferta registrada', { kind: 'ok' });
        } }
      ]
    });
    corpo.addEventListener('submit', function (ev) { ev.preventDefault(); });
  }
  function removerDaLista(id) {
    var x = CL.get('espera', id);
    if (!x) return;
    CL.ui.pedirTexto({ titulo: 'Remover da lista de espera', rotulo: 'Motivo (opcional)', placeholder: 'Ex.: desistiu, marcou em outro lugar', ok: 'Remover' })
      .then(function (motivo) { if (motivo === null) return; espera.remover(id, motivo); CL.ui.toast('Removido da lista de espera', { kind: 'ok' }); });
  }

  /* =================== bloqueios =================== */
  function abrirBloquear(pre) {
    pre = pre || {};
    var diaInteiro = pre.diaInteiro != null ? !!pre.diaInteiro : !pre.horaIni;
    var corpo = document.createElement('form');
    corpo.className = 'ag-form'; corpo.noValidate = true;
    corpo.innerHTML = '<div class="campo"><label for="agb-prof">Profissional</label><select id="agb-prof" name="profId" class="select" autofocus><option value="">Clínica inteira</option>' + opcoes(profsAtivos(), pre.profId || '') + '</select></div>' +
      '<div class="campo"><label class="campo-linha"><input type="checkbox" name="diaInteiro"' + (diaInteiro ? ' checked' : '') + '> Dia inteiro</label></div>' +
      '<div class="campos-2"><div class="campo"><label for="agb-de">De</label><input id="agb-de" type="date" name="dataIni" value="' + e(pre.dataIni || st.data || hoje()) + '" required></div><div class="campo"><label for="agb-ate">Até</label><input id="agb-ate" type="date" name="dataFim" value="' + e(pre.dataFim || pre.dataIni || st.data || hoje()) + '" required></div></div>' +
      '<div class="campos-2" data-horas' + (diaInteiro ? ' hidden' : '') + '><div class="campo"><label for="agb-hi">Das</label><input id="agb-hi" type="time" name="horaIni" value="' + e(pre.horaIni || '12:00') + '" step="300"></div><div class="campo"><label for="agb-hf">Até</label><input id="agb-hf" type="time" name="horaFim" value="' + e(pre.horaFim || '13:00') + '" step="300"></div></div>' +
      '<div class="campos-2"><div class="campo"><label for="agb-motivo">Motivo</label><select id="agb-motivo" name="motivo" class="select">' + Object.keys(MOTIVOS_BLOQ).map(function (k) { return '<option value="' + k + '"' + (k === (pre.motivo || 'outro') ? ' selected' : '') + '>' + MOTIVOS_BLOQ[k] + '</option>'; }).join('') + '</select></div>' +
      '<div class="campo"><label for="agb-desc">Descrição</label><input id="agb-desc" type="text" name="descricao" value="' + e(pre.descricao || '') + '" placeholder="Ex.: congresso em SP"></div></div>' +
      '<p class="ajuda">Almoço e pausas fixas de toda semana são definidos nos horários do profissional, em Ajustes.</p>';
    corpo.addEventListener('change', function (ev) { if (ev.target.name === 'diaInteiro') corpo.querySelector('[data-horas]').hidden = ev.target.checked; });
    function ler() {
      var g = function (n) { return corpo.querySelector('[name="' + n + '"]'); };
      return { profId: g('profId').value || null, diaInteiro: g('diaInteiro').checked, dataIni: g('dataIni').value, dataFim: g('dataFim').value, horaIni: g('horaIni').value, horaFim: g('horaFim').value, motivo: g('motivo').value, descricao: g('descricao').value };
    }
    function gravar() {
      var d = ler();
      if (!d.dataIni) { CL.ui.toast('Informe a data inicial', { kind: 'aviso' }); return false; }
      if (!d.diaInteiro && U.min(d.horaFim) <= U.min(d.horaIni)) { CL.ui.toast('A hora final deve ser depois da inicial', { kind: 'aviso' }); return false; }
      var r = bloqueios.criar(d);
      if (!r) return false;
      CL.ui.toast('Bloqueio criado', { kind: 'ok' });
      if (r.atingidas.length) setTimeout(function () { abrirAtingidas(r.bloqueio, r.atingidas); }, 0);
      return true;
    }
    var m = CL.ui.modal({ titulo: 'Bloquear horário', corpo: corpo, botoes: [{ rotulo: 'Cancelar', tipo: 'neutro' }, { rotulo: 'Bloquear', tipo: 'primario', icone: 'ti-ban', acao: gravar }] });
    corpo.addEventListener('submit', function (ev) { ev.preventDefault(); if (gravar()) m.fechar({ motivo: 'enter' }); });
  }
  function abrirAtingidas(b, ids) {
    var lista = ordenar(ids.map(function (id) { return CL.get('consultas', id); }).filter(Boolean));
    var corpo = document.createElement('div');
    corpo.className = 'pilha';
    corpo.innerHTML = '<p>' + lista.length + (lista.length === 1 ? ' consulta' : ' consultas') + ' neste período — remarcar?</p><ul class="lista-simples">' + lista.map(function (c) {
      return '<li><span class="ag-cresce"><strong class="tnum">' + e(dataCurta(c.data) + ' ' + c.hora) + '</strong> · <span class="nome-paciente">' + e(nomePac(c)) + '</span> · ' + e(nomeProf(c.profId)) + '</span><button type="button" class="btn btn-neutro btn-pequeno" data-acao="ver" data-id="' + e(c.id) + '">Abrir</button></li>';
    }).join('') + '</ul>';
    var m = CL.ui.modal({
      titulo: 'Consultas no período bloqueado', corpo: corpo,
      botoes: [{ rotulo: 'Fechar', tipo: 'neutro' }, { rotulo: 'Ver na agenda', tipo: 'primario', icone: 'ti-calendar', acao: function () { irPara('dia', lista[0].data, b.profId ? [b.profId] : st.profs); } }]
    });
    corpo.addEventListener('click', function (ev) {
      var x = ev.target.closest('[data-acao="ver"]');
      if (!x) return;
      m.fechar({ motivo: 'ver' });
      abrirConsulta(x.getAttribute('data-id'));
    });
  }
  function abrirBloqueio(id) {
    var b = CL.get('bloqueios', id);
    if (!b) return;
    var n = atingidasDe(b).length;
    var periodo = b.dataIni === b.dataFim ? dataCurta(b.dataIni) : dataCurta(b.dataIni) + ' a ' + dataCurta(b.dataFim);
    if (!b.diaInteiro) periodo += ' · ' + b.horaIni + '–' + b.horaFim;
    var corpo = '<dl class="ag-ver-dados">' + dado('Quem', b.profId ? nomeProf(b.profId) : 'Clínica inteira') + dado('Período', periodo) + dado('Motivo', MOTIVOS_BLOQ[b.motivo] || 'Outro') + (b.descricao ? dado('Descrição', b.descricao) : '') + dado('Consultas no período', n ? String(n) : 'nenhuma') + '</dl>';
    CL.ui.modal({
      titulo: 'Bloqueio', corpo: corpo,
      botoes: [
        { rotulo: 'Fechar', tipo: 'neutro' },
        { rotulo: 'Remover bloqueio', tipo: 'perigo', icone: 'ti-trash', acao: function () {
          return CL.ui.confirmar({ titulo: 'Remover bloqueio?', texto: 'O horário volta a ficar disponível para marcação.', ok: 'Remover', okTipo: 'perigo' }).then(function (ok) {
            if (ok) { bloqueios.remover(id); CL.ui.toast('Bloqueio removido', { kind: 'ok' }); }
            return true;
          });
        } }
      ]
    });
  }

  /* =================== vaga aberta e lista de espera =================== */
  function abrirVaga(consultaId) {
    var c = CL.get('consultas', consultaId);
    if (!c) return;
    var lista = elegiveis({ data: c.data, hora: c.hora, profId: c.profId });
    var cedo = instante(c) - Date.now() < 2 * 3600000;
    var corpo = document.createElement('div');
    corpo.className = 'pilha';
    var html = '<p class="texto-2">' + e(dataCurta(c.data)) + ' às ' + e(c.hora) + ' · ' + e(nomeProf(c.profId)) + ' · ' + durDe(c) + ' min</p>';
    if (cedo) html += avisoHtml('aviso', 'Menos de 2 h de antecedência — prefira ligar para confirmar antes de oferecer.');
    if (!lista.length) html += '<p>Ninguém elegível na lista de espera para este horário.</p>';
    else html += '<ul class="lista-simples">' + lista.map(function (x) {
      var p = pac(x.pacId);
      return '<li><span class="ag-cresce"><strong class="nome-paciente">' + e(p ? CL.nomeExibido(p.nome) : '') + '</strong>' + (x.prioridade === 'urgente' ? ' <span class="chip chip-erro"><i class="ti ti-urgent" aria-hidden="true"></i>Urgente</span>' : '') +
        '<br><small class="texto-3">' + e(preferenciasDe(x)) + ' · esperando há ' + e(esperandoHa(x)) + ' · ' + (x.ofertas || []).length + ' oferta(s)</small></span>' +
        '<div class="linha-acoes">' + (p && U.digits(p.fone) ? '<button type="button" class="btn btn-neutro btn-pequeno" data-acao="ofertar" data-id="' + e(x.id) + '"><i class="ti ti-brand-whatsapp" aria-hidden="true"></i>WhatsApp</button>' : '<span class="ajuda">sem telefone</span>') +
        '<button type="button" class="btn btn-primario btn-pequeno" data-acao="marcar" data-id="' + e(x.id) + '"><i class="ti ti-calendar-plus" aria-hidden="true"></i>Marcar</button></div></li>';
    }).join('') + '</ul>';
    corpo.innerHTML = html;
    var m = CL.ui.modal({ titulo: 'Vaga aberta · ' + lista.length + ' na espera', corpo: corpo, botoes: [{ rotulo: 'Fechar', tipo: 'neutro' }] });
    corpo.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-acao]');
      if (!b) return;
      var x = CL.get('espera', b.getAttribute('data-id'));
      if (!x) return;
      if (b.getAttribute('data-acao') === 'ofertar') {
        abrirUrl(espera.ofertar(x.id, { data: c.data, hora: c.hora, profId: c.profId }));
        CL.ui.toast('Oferta registrada na lista de espera', { kind: 'ok' });
        b.disabled = true; b.title = 'Oferta registrada';
      } else {
        m.fechar({ motivo: 'marcar' });
        abrirForm({ data: c.data, hora: c.hora, profId: c.profId, dur: c.dur, pacId: x.pacId, procId: x.procId || c.procId, esperaId: x.id, origem: 'espera' }, null);
      }
    });
  }
  function abrirEsperaForm(pre) {
    pre = pre || {};
    var corpo = document.createElement('form');
    corpo.className = 'ag-form'; corpo.noValidate = true;
    var procs = procsAtivos();
    corpo.innerHTML = '<div class="campo"><label>Paciente</label><div data-paciente></div></div>' +
      '<div class="campos-2"><div class="campo"><label for="age-prof">Profissional</label><select id="age-prof" name="profId" class="select"><option value="">Qualquer</option>' + opcoes(profsAtivos(), pre.profId || '') + '</select></div>' +
      '<div class="campo"><label for="age-proc">Procedimento</label><select id="age-proc" name="procId" class="select">' + opcoes(procs, pre.procId || (proc('proc-consulta') ? 'proc-consulta' : (procs[0] || {}).id)) + '</select></div></div>' +
      '<div class="campo"><span class="campo-rotulo">Prioridade</span><div class="segmentado" role="group" aria-label="Prioridade"><button type="button" data-prio="normal" aria-pressed="true">Normal</button><button type="button" data-prio="urgente" aria-pressed="false">Urgente</button></div></div>' +
      '<div class="campo"><span class="campo-rotulo">Dias preferidos (nenhum = qualquer dia)</span><div class="ag-dias">' + DIAS_CURTO.map(function (d, i) { return '<label class="ag-dia"><input type="checkbox" name="dia" value="' + i + '"> ' + d + '</label>'; }).join('') + '</div></div>' +
      '<div class="campos-2"><div class="campo"><label for="age-hi">Horário de</label><input id="age-hi" type="time" name="horaIni" step="300"></div><div class="campo"><label for="age-hf">até</label><input id="age-hf" type="time" name="horaFim" step="300"></div></div>' +
      '<div class="campo"><label for="age-obs">Observação</label><input id="age-obs" type="text" name="obs" placeholder="Ex.: prefere manhã, ligar antes"></div>';
    var campoPac = campoPaciente(corpo.querySelector('[data-paciente]'), { pacId: pre.pacId || null, autofocus: !pre.pacId });
    var prio = 'normal';
    corpo.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-prio]');
      if (!b) return;
      prio = b.getAttribute('data-prio');
      Array.prototype.forEach.call(corpo.querySelectorAll('[data-prio]'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
    });
    corpo.addEventListener('submit', function (ev) { ev.preventDefault(); });
    CL.ui.modal({
      titulo: 'Adicionar à lista de espera', corpo: corpo,
      botoes: [
        { rotulo: 'Cancelar', tipo: 'neutro' },
        { rotulo: 'Adicionar', tipo: 'primario', icone: 'ti-plus', acao: function () {
          var g = function (n) { return corpo.querySelector('[name="' + n + '"]'); };
          var d = {
            pacId: campoPac.get(), profId: g('profId').value || null, procId: g('procId').value, prioridade: prio,
            diasPref: Array.prototype.map.call(corpo.querySelectorAll('[name="dia"]:checked'), function (x) { return +x.value; }),
            horaPref: { ini: g('horaIni').value, fim: g('horaFim').value }, obs: g('obs').value
          };
          if (!d.pacId) { CL.ui.toast('Escolha ou cadastre o paciente', { kind: 'aviso' }); campoPac.focar(); return false; }
          return !!espera.adicionar(d);
        } }
      ]
    });
  }

  /* =================== busca, próxima vaga, novo profissional, legenda, densidade =================== */
  function abrirBusca() {
    var corpo = document.createElement('div');
    corpo.className = 'pilha';
    corpo.innerHTML = '<div class="busca"><i class="ti ti-search" aria-hidden="true"></i><input type="search" class="input" placeholder="Nome do paciente" aria-label="Buscar consulta por paciente" autofocus></div><div class="ag-busca-lista" data-lista><p class="ajuda">Digite o nome para buscar em toda a agenda.</p></div>';
    var input = corpo.querySelector('input');
    U.semAutofill(input);
    function listar() {
      var q = U.norm(U.valorBusca(input)), box = corpo.querySelector('[data-lista]');
      if (q.length < 2) { box.innerHTML = '<p class="ajuda">Digite pelo menos 2 letras.</p>'; return; }
      var ids = {};
      CL.col('pacientes').forEach(function (p) { if (p && (U.norm(p.nome).indexOf(q) >= 0 || (p.nomeSocial && U.norm(p.nomeSocial).indexOf(q) >= 0))) ids[p.id] = true; });
      var h = hoje(), todas = CL.col('consultas').filter(function (c) { return c && ids[c.pacId]; });
      var lista = ordenar(todas.filter(function (c) { return c.data >= h; })).concat(ordenar(todas.filter(function (c) { return c.data < h; })).reverse()).slice(0, 60);
      if (!lista.length) { box.innerHTML = '<p class="ajuda">Nenhuma consulta encontrada.</p>'; return; }
      var html = '', ultima = '';
      lista.forEach(function (c) {
        if (c.data !== ultima) { ultima = c.data; html += '<div class="ag-lista-hora">' + e(dataCurta(c.data)) + (c.data === h ? ' · hoje' : '') + '</div>'; }
        var pr = proc(c.procId);
        html += '<button type="button" class="ag-resultado" data-id="' + e(c.id) + '"><span><strong class="tnum">' + e(c.hora) + '</strong> <span class="nome-paciente">' + e(nomePac(c)) + '</span><small>' + e(nomeProf(c.profId) + (pr ? ' · ' + pr.nome : '')) + '</small></span>' + CL.chipStatus(c.status) + '</button>';
      });
      box.innerHTML = html;
    }
    input.addEventListener('input', U.debounce(listar, 120));
    var m = CL.ui.modal({ titulo: 'Buscar consulta', corpo: corpo, botoes: [{ rotulo: 'Fechar', tipo: 'neutro' }] });
    corpo.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-id]');
      if (!b) return;
      m.fechar({ motivo: 'abrir' });
      abrirConsulta(b.getAttribute('data-id'));
    });
  }
  function abrirProximaVaga(pre) {
    pre = pre || {};
    var procs = procsAtivos();
    var corpo = document.createElement('form');
    corpo.className = 'ag-form'; corpo.noValidate = true;
    corpo.innerHTML = '<div class="campos-2"><div class="campo"><label for="agv-proc">Procedimento</label><select id="agv-proc" name="procId" class="select" autofocus>' + opcoes(procs, pre.procId || (proc('proc-consulta') ? 'proc-consulta' : (procs[0] || {}).id)) + '</select></div>' +
      '<div class="campo"><label for="agv-prof">Profissional</label><select id="agv-prof" name="profId" class="select"><option value="">Todos</option>' + opcoes(profsAtivos(), pre.profId || '') + '</select></div></div>' +
      '<div class="ag-vaga-resultado" data-resultado aria-live="polite"></div>' +
      '<div class="linha-acoes"><button type="button" class="btn btn-neutro" data-dir="-1"><i class="ti ti-chevron-left" aria-hidden="true"></i>Anterior</button><button type="button" class="btn btn-neutro" data-dir="1">Próxima<i class="ti ti-chevron-right" aria-hidden="true"></i></button></div>';
    var atual = null;
    function buscar(dir, aPartir, hora) {
      var g = function (n) { return corpo.querySelector('[name="' + n + '"]'); };
      atual = proximaVaga({ procId: g('procId').value, profId: g('profId').value || null, aPartir: aPartir || hoje(), aPartirHora: hora || null, direcao: dir });
      var box = corpo.querySelector('[data-resultado]');
      if (!atual) { box.innerHTML = '<p class="texto-2">Nenhuma vaga livre encontrada nos próximos 180 dias' + (!profsAtivos().some(temHorarios) ? ' — defina os horários dos profissionais em Ajustes' : '') + '.</p>'; return; }
      box.innerHTML = '<div class="ag-vaga-achada"><i class="ti ti-calendar-check" aria-hidden="true"></i><span><strong>' + e(capitalizar(CL.fmt.dataExtenso(atual.data))) + '</strong> às <strong>' + e(atual.hora) + '</strong><br><small class="texto-3">' + e(nomeProf(atual.profId)) + '</small></span></div>';
    }
    corpo.addEventListener('change', function () { buscar(1); });
    corpo.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-dir]');
      if (!b) return;
      var dir = +b.getAttribute('data-dir');
      if (atual) buscar(dir, atual.data, atual.hora); else buscar(1);
    });
    corpo.addEventListener('submit', function (ev) { ev.preventDefault(); });
    buscar(1);
    CL.ui.modal({
      titulo: 'Próxima vaga livre', corpo: corpo,
      botoes: [
        { rotulo: 'Fechar', tipo: 'neutro' },
        { rotulo: 'Marcar neste horário', tipo: 'primario', icone: 'ti-calendar-plus', acao: function () {
          if (!atual) { CL.ui.toast('Nenhuma vaga para marcar', { kind: 'aviso' }); return false; }
          var procId = corpo.querySelector('[name="procId"]').value;
          setTimeout(function () { abrirForm({ data: atual.data, hora: atual.hora, profId: atual.profId, procId: procId }, null); }, 0);
        } }
      ]
    });
  }
  function abrirNovoProfissional() {
    var usadas = profsAtivos().map(function (p) { return p.cor; });
    var corInicial = CORES_PROF.filter(function (c) { return usadas.indexOf(c) < 0; })[0] || CORES_PROF[profsAtivos().length % CORES_PROF.length];
    var corpo = document.createElement('form');
    corpo.className = 'ag-form'; corpo.noValidate = true;
    corpo.innerHTML = '<div class="campo"><label for="agp-nome">Nome</label><input id="agp-nome" type="text" name="nome" autocomplete="off" placeholder="Dra. Ana Souza" autofocus required></div>' +
      '<div class="campos-2"><div class="campo"><label for="agp-conselho">Conselho</label><select id="agp-conselho" name="conselho" class="select">' + CONSELHOS.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('') + '</select></div>' +
      '<div class="campo"><label for="agp-numero">Número</label><input id="agp-numero" type="text" name="numero" inputmode="numeric" autocomplete="off"></div></div>' +
      '<div class="campos-2"><div class="campo"><label for="agp-uf">UF</label><input id="agp-uf" type="text" name="uf" maxlength="2" autocomplete="off" placeholder="CE"></div>' +
      '<div class="campo"><label for="agp-esp">Especialidade</label><input id="agp-esp" type="text" name="especialidade" autocomplete="off"></div></div>' +
      '<div class="campo"><span class="campo-rotulo">Cor de identificação</span><div class="ag-cores" role="group" aria-label="Cor">' + CORES_PROF.map(function (c) { return '<button type="button" class="ag-cor" data-cor="' + c + '" aria-pressed="' + (c === corInicial ? 'true' : 'false') + '" aria-label="Cor ' + c + '" style="background:' + c + '"></button>'; }).join('') + '</div></div>' +
      '<div class="campos-2"><div class="campo"><label for="agp-slot">Intervalo da grade</label><select id="agp-slot" name="slot" class="select"><option value="10">10 min</option><option value="15" selected>15 min</option><option value="20">20 min</option><option value="30">30 min</option></select></div>' +
      '<div class="campo"><label for="agp-enc">Encaixes por hora</label><input id="agp-enc" type="number" name="maxEncaixesHora" value="1" min="0" max="6" inputmode="numeric"></div></div>' +
      '<div class="campo"><label class="campo-linha"><input type="checkbox" name="horarioPadrao" checked> Horário padrão: segunda a sexta, 08:00–12:00 e 14:00–18:00</label><span class="campo-ajuda">Ajuste depois em Ajustes › Profissionais.</span></div>';
    var cor = corInicial;
    corpo.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-cor]');
      if (!b) return;
      cor = b.getAttribute('data-cor');
      Array.prototype.forEach.call(corpo.querySelectorAll('[data-cor]'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
    });
    function gravar() {
      var g = function (n) { return corpo.querySelector('[name="' + n + '"]'); };
      var nome = g('nome').value.trim();
      if (!nome) { CL.ui.toast('Informe o nome do profissional', { kind: 'aviso' }); g('nome').focus(); return false; }
      var horarios = {};
      if (g('horarioPadrao').checked) Object.keys(HORARIO_PADRAO).forEach(function (d) { horarios[d] = HORARIO_PADRAO[d].map(function (t) { return { ini: t.ini, fim: t.fim }; }); });
      var p = CL.upsert('profissionais', {
        nome: nome, conselho: g('conselho').value, numero: U.digits(g('numero').value), uf: g('uf').value.trim().toUpperCase().slice(0, 2), rqe: '', especialidade: g('especialidade').value.trim(),
        cor: cor, ativo: true, horarios: horarios, slot: parseInt(g('slot').value, 10) || 15, maxEncaixesHora: Math.max(0, parseInt(g('maxEncaixesHora').value, 10) || 0),
        procIds: [], procPadraoId: null, repasse: { modo: 'nenhum', valor: 0 }, usuarioId: null
      });
      CL.ui.toast('Profissional cadastrado', { kind: 'ok' });
      var sel = st.profs.filter(function (id) { return prof(id); });
      if (st.visao === 'semana' || maxCols() === 1) sel = [p.id]; else sel = sel.concat([p.id]);
      st.profs = sel;
      CL.pref.set(chaveProfs(), sel);
      if (el) irPara(st.visao === 'espera' || st.visao === 'lembretes' ? st.visao : st.visao, st.data, sel, true);
      return true;
    }
    var m = CL.ui.modal({ titulo: 'Novo profissional', corpo: corpo, botoes: [{ rotulo: 'Cancelar', tipo: 'neutro' }, { rotulo: 'Salvar', tipo: 'primario', icone: 'ti-check', acao: gravar }] });
    corpo.addEventListener('submit', function (ev) { ev.preventDefault(); if (gravar()) m.fechar({ motivo: 'enter' }); });
  }
  function abrirLegenda() {
    var html = '<div class="ag-legenda">' + Object.keys(CL.STATUS).map(function (k) { return '<div>' + CL.chipStatus(k) + '</div>'; }).join('') +
      '<div><span class="chip" style="border:1.5px dashed var(--tinta-3)"><i class="ti ti-arrows-diagonal" aria-hidden="true"></i>Encaixe</span></div>' +
      '<div><span class="chip ag-legenda-bloqueio"><i class="ti ti-ban" aria-hidden="true"></i>Bloqueio</span></div>' +
      '<div><span class="chip ag-vaga-aberta ag-legenda-vaga"><i class="ti ti-bell-ringing" aria-hidden="true"></i>Vaga aberta</span></div></div>' +
      '<p class="ajuda">Faixa colorida à esquerda do bloco = procedimento. Ponto colorido no chip = profissional. Ícones: confirmado, pago, observação, teleconsulta, risco de falta, encaixe.</p>';
    CL.ui.modal({ titulo: 'Legenda', corpo: html, botoes: [{ rotulo: 'Fechar', tipo: 'primario' }] });
  }
  function abrirDensidade() {
    var atual = CL.pref.get('densidade', 'padrao');
    var ops = [['compacto', 'Compacta'], ['padrao', 'Padrão'], ['confortavel', 'Confortável']];
    var corpo = document.createElement('div');
    corpo.innerHTML = '<p class="texto-2">Altura de cada hora na grade.</p><div class="segmentado" role="group" aria-label="Densidade">' + ops.map(function (o) { return '<button type="button" data-densidade="' + o[0] + '" aria-pressed="' + (o[0] === atual ? 'true' : 'false') + '">' + o[1] + '</button>'; }).join('') + '</div>';
    corpo.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-densidade]');
      if (!b) return;
      var v = b.getAttribute('data-densidade');
      CL.pref.set('densidade', v);
      document.body.setAttribute('data-densidade', v);
      Array.prototype.forEach.call(corpo.querySelectorAll('[data-densidade]'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      agendarRender();
    });
    CL.ui.modal({ titulo: 'Densidade da agenda', corpo: corpo, botoes: [{ rotulo: 'Fechar', tipo: 'primario' }] });
  }
  function menuAgenda(ancora) {
    var itens = [];
    if (st.visao === 'dia' || st.visao === 'lista') itens.push({ rotulo: 'Imprimir o dia', icone: 'ti-printer', fn: function () { imprimirDia(st.data, selecionados().length === 1 ? selecionados()[0] : null); } });
    itens.push({ rotulo: st.ocultarCancelados ? 'Mostrar cancelados' : 'Ocultar cancelados', icone: st.ocultarCancelados ? 'ti-eye' : 'ti-eye-off', fn: function () { st.ocultarCancelados = !st.ocultarCancelados; CL.pref.set('agenda.ocultarCancelados', st.ocultarCancelados); render(); } });
    if (st.visao === 'dia' || st.visao === 'semana') itens.push({ rotulo: st.ver24 ? 'Ver só o horário da clínica' : 'Ver 24 h', icone: 'ti-clock-hour-12', fn: function () { st.ver24 = !st.ver24; CL.pref.set('agenda.ver24', st.ver24); render(); } });
    itens.push({ rotulo: 'Densidade…', icone: 'ti-arrows-vertical', fn: abrirDensidade });
    itens.push({ rotulo: 'Legenda', icone: 'ti-palette', fn: abrirLegenda });
    itens.push('-');
    itens.push({ rotulo: 'Novo profissional', icone: 'ti-user-plus', fn: abrirNovoProfissional });
    if (CL.can('config')) itens.push({ rotulo: 'Horários dos profissionais', icone: 'ti-clock-edit', fn: function () { CL.route.go('#/config/profissionais'); } });
    CL.ui.menu(ancora, itens);
  }

  /* =================== arrastar para remarcar / redimensionar =================== */
  function limparPendente() {
    if (!pend) return;
    clearTimeout(pend.timer);
    document.removeEventListener('pointermove', aoPointerMove);
    document.removeEventListener('pointerup', aoPointerUp);
    document.removeEventListener('pointercancel', aoPointerCancel);
    pend = null;
  }
  function aoPointerDown(ev) {
    if (ev.button != null && ev.button !== 0) return;
    if (modoVaga || !el) return;
    var alca = ev.target.closest ? ev.target.closest('[data-alca]') : null;
    var bloco = ev.target.closest ? ev.target.closest('.ag-bloco[data-id]') : null;
    if (!bloco || !el.contains(bloco)) return;
    var c = CL.get('consultas', bloco.getAttribute('data-id'));
    if (!c || !arrastavel(c)) return;
    if (pend) limparPendente();
    pend = { id: c.id, bloco: bloco, modo: alca ? 'redimensionar' : 'mover', x0: ev.clientX, y0: ev.clientY, pointerId: ev.pointerId, tipo: ev.pointerType || 'mouse', timer: null, ativo: false, ultimo: ev };
    if (pend.tipo === 'touch' || pend.tipo === 'pen') pend.timer = setTimeout(function () { if (pend && !pend.ativo) iniciarArraste(); }, TOQUE_MS);
    document.addEventListener('pointermove', aoPointerMove);
    document.addEventListener('pointerup', aoPointerUp);
    document.addEventListener('pointercancel', aoPointerCancel);
  }
  function aoPointerMove(ev) {
    if (!pend || ev.pointerId !== pend.pointerId) return;
    pend.ultimo = ev;
    if (!pend.ativo) {
      var dx = ev.clientX - pend.x0, dy = ev.clientY - pend.y0, dist = Math.sqrt(dx * dx + dy * dy);
      if (pend.tipo === 'mouse') { if (dist > 4) iniciarArraste(); }
      else if (dist > 10) { limparPendente(); return; }
      if (!pend || !pend.ativo) return;
    }
    if (ev.cancelable) ev.preventDefault();
    atualizarArraste(ev);
  }
  function iniciarArraste() {
    var p = pend;
    if (!p || p.ativo) return;
    var c = CL.get('consultas', p.id);
    if (!c) { limparPendente(); return; }
    p.ativo = true; arraste = p;
    p.c = c; p.dur = durDe(c); p.hpx = horaPx();
    var rect = p.bloco.getBoundingClientRect();
    p.offsetY = p.y0 - rect.top;
    p.bloco.classList.add('is-arrastando');
    document.body.classList.add('is-arrastando-agenda');
    var s = document.createElement('div');
    s.className = 'ag-sombra';
    s.innerHTML = '<span class="ag-sombra-rotulo"></span>';
    p.sombra = s; p.alvo = null;
    atualizarArraste(p.ultimo);
  }
  function atualizarArraste(ev) {
    var p = arraste;
    if (!p || !el) return;
    var colEl = null;
    if (p.modo === 'redimensionar') colEl = p.bloco.closest('.ag-col');
    else {
      var alvoEl = document.elementFromPoint(ev.clientX, ev.clientY);
      colEl = alvoEl && alvoEl.closest ? alvoEl.closest('.ag-col') : null;
    }
    if (!colEl || !el.contains(colEl)) {
      p.alvo = null;
      if (p.sombra.parentNode) p.sombra.parentNode.removeChild(p.sombra);
      return;
    }
    var corpo = colEl.querySelector('.ag-col-corpo'), r = corpo.getBoundingClientRect();
    var profId = colEl.getAttribute('data-prof'), data = colEl.getAttribute('data-data');
    var slot = slotDe(prof(profId)), ini = +corpo.getAttribute('data-ini'), fim = +corpo.getAttribute('data-fim');
    var min, dur = p.dur;
    if (p.modo === 'mover') {
      var y = ev.clientY - p.offsetY - r.top;
      min = ini + Math.round(y / p.hpx * 60 / slot) * slot;
      min = Math.max(ini, Math.min(min, fim - dur));
    } else {
      var yf = ev.clientY - r.top;
      var fimMin = ini + Math.round(yf / p.hpx * 60 / slot) * slot;
      min = U.min(p.c.hora);
      dur = Math.max(slot, Math.min(fimMin - min, fim - min));
      profId = p.c.profId; data = p.c.data;
    }
    var todos = conflitos({ data: data, hora: U.hhmm(min), dur: dur, profId: profId, pacId: p.c.pacId, ignorarId: p.c.id, encaixe: p.c.encaixe });
    var hard = duros(todos, p.c.encaixe);
    var fora = todos.some(function (x) { return x.tipo === 'fora_turno'; });
    p.sombra.classList.toggle('is-invalido', hard.length > 0);
    p.sombra.classList.toggle('is-valido', hard.length === 0);
    p.sombra.style.top = ((min - ini) / 60 * p.hpx) + 'px';
    p.sombra.style.height = (dur / 60 * p.hpx) + 'px';
    p.sombra.querySelector('.ag-sombra-rotulo').textContent = U.hhmm(min) + '–' + U.hhmm(min + dur) + (hard.length ? ' · ' + hard[0].texto : (fora ? ' · fora do turno' : ''));
    if (p.sombra.parentNode !== corpo) corpo.appendChild(p.sombra);
    p.alvo = { data: data, hora: U.hhmm(min), profId: profId, dur: dur, hard: hard };
    var rol = el.querySelector('.ag-rolagem');
    if (rol) {
      var rr = rol.getBoundingClientRect();
      if (ev.clientY < rr.top + 48) rol.scrollTop -= 12; else if (ev.clientY > rr.bottom - 48) rol.scrollTop += 12;
      if (ev.clientX < rr.left + 40) rol.scrollLeft -= 12; else if (ev.clientX > rr.right - 40) rol.scrollLeft += 12;
    }
  }
  function finalizarArraste() {
    var p = arraste;
    if (!p) return null;
    if (p.sombra && p.sombra.parentNode) p.sombra.parentNode.removeChild(p.sombra);
    p.bloco.classList.remove('is-arrastando');
    document.body.classList.remove('is-arrastando-agenda');
    arraste = null; ultimoArrasteEm = Date.now();
    limparPendente();
    if (renderAdiado) { renderAdiado = false; agendarRender(); }
    return p;
  }
  function rejeitarSoltura(c, a) {
    var motivo = a.hard[0];
    var podeEncaixar = maxEncaixes(prof(a.profId)) > 0 && a.hard.every(function (x) {
      if (x.tipo === 'sobreposicao') return true;
      if (x.tipo === 'bloqueio') { var b = CL.get('bloqueios', x.bloqueioId); return !!b && !b.diaInteiro; }
      return false;
    });
    CL.ui.toast('Não remarcado: ' + motivo.texto, { kind: 'aviso', action: podeEncaixar ? { rotulo: 'Encaixar', fn: function () { abrirForm({ data: a.data, hora: a.hora, profId: a.profId, encaixe: true }, CL.get('consultas', c.id)); } } : null });
  }
  function aoPointerUp(ev) {
    if (!pend || ev.pointerId !== pend.pointerId) return;
    if (!pend.ativo) { limparPendente(); return; }
    var p = finalizarArraste();
    if (!p || !p.alvo) return;
    var c = CL.get('consultas', p.id);
    if (!c) return;
    var a = p.alvo;
    if (p.modo === 'mover') {
      if (a.data === c.data && a.hora === c.hora && a.profId === c.profId) return;
      if (a.hard.length) { rejeitarSoltura(c, a); return; }
      remarcar(c.id, { data: a.data, hora: a.hora, profId: a.profId }, { confirmarProf: true }).then(function (r) {
        if (!r.ok && r.conflitos && r.conflitos.length) rejeitarSoltura(c, { data: a.data, hora: a.hora, profId: a.profId, hard: r.conflitos });
      });
    } else {
      if (a.dur === durDe(c)) return;
      if (a.hard.length) { CL.ui.toast('Não alterado: ' + a.hard[0].texto, { kind: 'aviso' }); return; }
      c.dur = a.dur;
      historico(c, { acao: 'editada', campo: 'duracao' });
      CL.upsert('consultas', c);
      CL.ui.toast('Duração: ' + a.dur + ' min', { kind: 'ok', ms: 2500 });
    }
  }
  function aoPointerCancel(ev) {
    if (!pend || ev.pointerId !== pend.pointerId) return;
    if (pend.ativo) finalizarArraste(); else limparPendente();
  }
  function aoTouchMove(ev) { if (arraste && ev.cancelable) ev.preventDefault(); }
  function aoContextMenu(ev) { if (pend || arraste) ev.preventDefault(); }

  /* =================== eventos da tela =================== */
  function mudarVisao(v) {
    if (VISOES.indexOf(v) < 0) return;
    var base = st.data || hoje();
    if (st.visao === 'mes' && v !== 'mes') base = base.slice(0, 7) === hoje().slice(0, 7) ? hoje() : base;
    if (st.visao === 'espera' || st.visao === 'lembretes') base = hoje();
    irPara(v, base, st.profs);
  }
  function cancelarModoVaga() {
    if (!modoVaga) return;
    modoVaga = null;
    CL.ui.toast('Marcação pela lista de espera cancelada', { kind: 'info', ms: 2500 });
    agendarRender();
  }
  function aoClicarCelula(cel) {
    var hora = cel.getAttribute('data-hora'), profId = cel.getAttribute('data-prof'), data = cel.getAttribute('data-data');
    if (modoVaga) {
      abrirForm({ data: data, hora: hora, profId: profId, pacId: modoVaga.pacId, procId: modoVaga.procId || undefined, esperaId: modoVaga.esperaId, origem: 'espera' }, null);
      return;
    }
    abrirForm({ data: data, hora: hora, profId: profId }, null);
  }
  function aoClicar(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var b = t.closest('[data-acao]');
    if (!b || !el.contains(b)) {
      if (Date.now() - ultimoArrasteEm < 400) return;
      var bloco = t.closest('.ag-bloco[data-id]');
      if (bloco) { abrirConsulta(bloco.getAttribute('data-id')); return; }
      var vaga = t.closest('[data-vaga]');
      if (vaga) { abrirVaga(vaga.getAttribute('data-vaga')); return; }
      var bloq = t.closest('[data-bloqueio]');
      if (bloq) { abrirBloqueio(bloq.getAttribute('data-bloqueio')); return; }
      var cel = t.closest('.ag-celula');
      if (cel) { aoClicarCelula(cel); return; }
      var cartao = t.closest('.ag-cartao[data-id]');
      if (cartao) { abrirConsulta(cartao.getAttribute('data-id')); return; }
      return;
    }
    var a = b.getAttribute('data-acao'), id = b.getAttribute('data-id');
    var sel = selecionados();
    switch (a) {
      case 'visao': mudarVisao(b.getAttribute('data-visao')); break;
      case 'anterior': deslocar(-1); break;
      case 'proximo': deslocar(1); break;
      case 'hoje': irPara(st.visao, hoje(), st.profs); break;
      case 'nova': abrirForm({ data: (st.visao === 'mes' || st.visao === 'espera') ? hoje() : st.data, profId: sel[0] }, null); break;
      case 'espera': irPara('espera'); break;
      case 'lembretes': case 'lembretes-amanha': irPara('lembretes', U.addDias(hoje(), 1)); break;
      case 'bloquear': abrirBloquear({ profId: sel.length === 1 ? sel[0] : '', dataIni: st.visao === 'mes' || st.visao === 'espera' ? hoje() : st.data }); break;
      case 'proxima-vaga': abrirProximaVaga({ profId: sel.length === 1 ? sel[0] : null }); break;
      case 'buscar': abrirBusca(); break;
      case 'menu': menuAgenda(b); break;
      case 'prof': selecionarProf(id); break;
      case 'prof-novo': abrirNovoProfissional(); break;
      case 'prof-anterior': case 'prof-proximo': {
        var ids = profsAtivos().map(function (p) { return p.id; });
        var i = ids.indexOf(sel[0]);
        var j = (i + (a === 'prof-proximo' ? 1 : -1) + ids.length) % ids.length;
        st.profs = [ids[j]];
        CL.pref.set(chaveProfs(), st.profs);
        irPara(st.visao, st.data, st.profs, true);
        break;
      }
      case 'ver24': st.ver24 = !st.ver24; CL.pref.set('agenda.ver24', st.ver24); render(); break;
      case 'cancelar-vaga': cancelarModoVaga(); break;
      case 'abrir-dia': irPara('dia', b.getAttribute('data-data'), st.profs); break;
      case 'avancar': avancar(id, b.getAttribute('data-para')); break;
      case 'confirmar': mudarStatus(id, 'confirmado').then(function (r) { if (r.ok) CL.ui.toast('Consulta confirmada', { kind: 'ok', ms: 2500 }); }); break;
      case 'whatsapp': abrirWhatsapp(id, b.getAttribute('data-chave') || null); break;
      case 'espera-aba': st.esperaAba = b.getAttribute('data-aba') || ''; render(); break;
      case 'espera-nova': abrirEsperaForm({ profId: st.esperaAba && st.esperaAba !== '_sem' ? st.esperaAba : null }); break;
      case 'espera-marcar': espera.marcar(id); break;
      case 'espera-whatsapp': abrirOferta(id, null); break;
      case 'espera-remover': removerDaLista(id); break;
      default: break;
    }
  }
  function aoMudar(ev) {
    var t = ev.target;
    if (!t || !t.matches) return;
    if (t.matches('[data-acao="data"]')) {
      var v = t.value;
      if (!v) return;
      if (st.visao === 'mes') irPara('mes', v.slice(0, 7) + '-01');
      else irPara(st.visao, v.slice(0, 10), st.profs);
    } else if (t.matches('[data-nota]')) {
      notas.set(st.data, t.getAttribute('data-nota') || null, t.value);
    }
  }
  function aoAlternar(ev) {
    var d = ev.target;
    if (d && d.matches && d.matches('details[data-notas]')) CL.pref.set('agenda.notasAberto', !!d.open);
  }
  function aoTeclar(ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var t = ev.target;
    if (!t || !t.closest || t.matches('button, a, input, select, textarea, summary')) return;
    var alvo = t.closest('.ag-bloco[data-id], .ag-cartao[data-id], [data-vaga], [data-bloqueio], .ag-mes-dia');
    if (!alvo) return;
    ev.preventDefault();
    alvo.click();
  }
  function aoResize() {
    clearTimeout(timerResize);
    timerResize = setTimeout(function () { if (el) agendarRender(); }, 200);
  }
  CL.keys.register('agenda', {
    t: function () { if (el) irPara(st.visao === 'espera' ? 'dia' : st.visao, hoje(), st.profs); },
    n: function () { if (el) abrirForm({ data: (st.visao === 'mes' || st.visao === 'espera') ? hoje() : st.data, profId: selecionados()[0] }, null); },
    p: function () { deslocar(-1); }, ',': function () { deslocar(-1); }, ArrowLeft: function () { deslocar(-1); },
    '.': function () { deslocar(1); }, ArrowRight: function () { deslocar(1); },
    '1': function () { mudarVisao('dia'); }, '7': function () { mudarVisao('semana'); }, m: function () { mudarVisao('mes'); }, l: function () { mudarVisao('lista'); },
    '/': function () { abrirBusca(); },
    Escape: function () { if (modoVaga) cancelarModoVaga(); }
  });

  /* =================== mount / unmount =================== */
  function ligar() {
    el.addEventListener('click', aoClicar);
    el.addEventListener('change', aoMudar);
    el.addEventListener('keydown', aoTeclar);
    el.addEventListener('pointerdown', aoPointerDown);
    el.addEventListener('touchmove', aoTouchMove, { passive: false });
    el.addEventListener('contextmenu', aoContextMenu);
    el.addEventListener('toggle', aoAlternar, true);
    unsubs.push(CL.on('change', function (info) { if (!info) return; if (info.col === '*' || COLS_RENDER[info.col]) agendarRender(); }));
    unsubs.push(CL.on('cfg', agendarRender));
    unsubs.push(CL.on('privacidade', agendarRender));
    unsubs.push(CL.on('session', agendarRender));
    timerAgora = setInterval(atualizarAgora, 60000);
    window.addEventListener('resize', aoResize);
  }
  function desligar() {
    if (el) {
      el.removeEventListener('click', aoClicar);
      el.removeEventListener('change', aoMudar);
      el.removeEventListener('keydown', aoTeclar);
      el.removeEventListener('pointerdown', aoPointerDown);
      el.removeEventListener('touchmove', aoTouchMove);
      el.removeEventListener('contextmenu', aoContextMenu);
      el.removeEventListener('toggle', aoAlternar, true);
    }
    unsubs.forEach(function (u) { try { u(); } catch (err) { /* já removido */ } });
    unsubs = [];
    clearInterval(timerAgora); timerAgora = null;
    clearTimeout(timerResize); timerResize = null;
    if (rafRender) { cancelAnimationFrame(rafRender); rafRender = null; }
    window.removeEventListener('resize', aoResize);
  }
  function mount(raiz, params) {
    el = raiz;
    params = params || {};
    var seg = params.seg || [], q = params.q || {};
    var v = seg[0];
    if (!v) { irPara(CL.pref.get('agenda.visao', padraoVisao()), hoje(), CL.pref.get(chaveProfs(), null), true); return; }
    if (VISOES.indexOf(v) < 0 && v !== 'espera' && v !== 'lembretes') { irPara('dia', hoje(), null, true); return; }
    st.visao = v;
    st.ver24 = !!CL.pref.get('agenda.ver24', false);
    st.ocultarCancelados = !!CL.pref.get('agenda.ocultarCancelados', false);
    st.scrollTop = null; st.scrollLeft = 0; primeiraRender = true;
    if (v === 'mes') st.data = (/^\d{4}-\d{2}$/.test(seg[1] || '') && U.dataDe(seg[1] + '-01')) ? seg[1] + '-01' : hoje().slice(0, 7) + '-01';
    else if (v === 'espera') st.data = hoje();
    else st.data = (/^\d{4}-\d{2}-\d{2}$/.test(seg[1] || '') && U.dataDe(seg[1])) ? seg[1] : (v === 'lembretes' ? U.addDias(hoje(), 1) : hoje());
    var ativos = profsAtivos().map(function (p) { return p.id; });
    var profs = q.prof ? String(q.prof).split(',') : (CL.pref.get(chaveProfs(), null) || []);
    st.profs = (Array.isArray(profs) ? profs : []).filter(function (id) { return ativos.indexOf(id) >= 0; });
    if (VISOES.indexOf(v) >= 0) CL.pref.set('agenda.visao', v);
    ligar();
    render();
  }
  function unmount() {
    if (arraste) finalizarArraste();
    limparPendente();
    limparPreview();
    desligar();
    el = null;
    if (!manterModoVaga) modoVaga = null;
    manterModoVaga = false;
  }

  /* =================== API pública (ESPEC §4.7) =================== */
  var Agenda = window.Agenda = {
    mount: mount,
    unmount: unmount,
    abrirNova: function (o) {
      o = o || {};
      return abrirForm({ data: o.data, hora: o.hora, profId: o.profId, pacId: o.pacId, procId: o.procId, esperaId: o.esperaId, dur: o.dur, origem: o.origem, encaixe: o.encaixe }, null);
    },
    abrirConsulta: abrirConsulta,
    salvar: salvar,
    conflitos: conflitos,
    mudarStatus: mudarStatus,
    remarcar: remarcar,
    proximaVaga: proximaVaga,
    whatsapp: whatsapp,
    lembretes: lembretesDe,
    espera: espera,
    bloqueios: bloqueios,
    notas: notas,
    imprimirDia: imprimirDia,
    abrirWhatsapp: abrirWhatsapp,
    abrirBloquear: abrirBloquear,
    abrirEspera: abrirEsperaForm,
    abrirVaga: abrirVaga,
    irPara: irPara,
    consultasDia: consultasDia,
    particionar: particionar
  };
  CL.route.register('agenda', Agenda);
})();
