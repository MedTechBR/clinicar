/* Clinicar — importar.js (dono: integracao)
   Global "Importar". Contrato: docs/ESPEC.md §3.4, §4.13 e §5.7. Montado por Config em #/config/importar.
   Aceita: exportação do sistema anterior ({app:'clinicar-antigo',versao:1,state} ou o state cru com patients/appts/records)
   e a exportação do próprio Clinicar ({app:'clinicar',versao:1,state}).
   Prévia SÓ com contagens e avisos numerados — nunca nomes, CPFs ou telefones. Grava só após confirmação,
   em lote (CL.lote → um único save), mesclando item a item por Backend.merge (importado vence só com updatedAt maior). */
(function () {
  'use strict';
  var U = CL.util;
  var e = function (s) { return U.esc(s); };
  var ROTULOS = { profissionais: 'Profissionais', procedimentos: 'Procedimentos', convenios: 'Convênios', pacientes: 'Pacientes', consultas: 'Consultas', bloqueios: 'Bloqueios', espera: 'Lista de espera', notasDia: 'Notas do dia', evolucoes: 'Evoluções', receitas: 'Receitas', documentos: 'Documentos', exames: 'Exames', modelos: 'Modelos', lancamentos: 'Lançamentos', usuarios: 'Usuários', auditoria: 'Auditoria' };
  var ORDEM = ['profissionais', 'procedimentos', 'convenios', 'pacientes', 'consultas', 'bloqueios', 'espera', 'notasDia', 'evolucoes', 'receitas', 'documentos', 'exames', 'modelos', 'lancamentos', 'usuarios', 'auditoria'];
  var PROCS_SEMENTE = [
    ['proc-consulta', 'Consulta', 30, '#2B5CE6', 'presencial'], ['proc-retorno', 'Retorno', 20, '#0E8A6C', 'presencial'],
    ['proc-procedimento', 'Procedimento', 60, '#B3541E', 'presencial'], ['proc-tele', 'Teleconsulta', 30, '#7C3AED', 'tele'], ['proc-exame', 'Exame', 30, '#0F766E', 'presencial']
  ];
  var TIPO_PROC = { con: 'proc-consulta', ret: 'proc-retorno', tel: 'proc-tele', pro: 'proc-procedimento', exa: 'proc-exame' };
  var STATUS_MAP = { agendado: 'agendado', confirmado: 'confirmado', atendido: 'finalizado', faltou: 'faltou', cancelado: 'cancelado' };
  var TIPOS_EVO = ['evolucao', 'soap', 'anamnese', 'alta', 'encaminhamento'];
  var TIPOS_ATEND = ['primeira', 'retorno', 'nova'];
  var TIPOS_DOC = ['atestado', 'exames', 'declaracao', 'encaminhamento', 'relatorio', 'consentimento'];
  var UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  var MSG_NAO_RECONHECIDO = 'Arquivo não reconhecido — exporte novamente do sistema anterior';
  var st = { el: null, etapa: 1, lido: null, mapeado: null, modo: 'mesclar', arquivoNome: '', resultado: null, erro: '', ocupado: false };

  /* =================== utilitários puros =================== */
  function trim(v) { return String(v == null ? '' : v).trim(); }
  function ymd(v) { var s = trim(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && U.dataDe(s) ? s : ''; }
  function hhmm(v) { var m = trim(v).match(/^(\d{1,2}):(\d{2})/); if (!m) return ''; var h = +m[1], mi = +m[2]; if (h > 23 || mi > 59) return ''; return (h < 10 ? '0' : '') + h + ':' + m[2]; }
  function isoOu(v, ms) { var t = Date.parse(trim(v)); return isNaN(t) ? new Date(ms).toISOString() : new Date(t).toISOString(); }
  function msDe(v, padrao) { var t = typeof v === 'number' ? v : Date.parse(trim(v)); return isNaN(t) || !t ? padrao : t; }
  function idOk(id) { return id != null && String(id).length > 0 && String(id).indexOf('.') < 0 && String(id).indexOf('/') < 0; }
  function consentVazio() { var c = { ativo: false, em: null, origem: '' }; return { lembretes: Object.assign({}, c), campanhas: Object.assign({}, c), compartilhamento: Object.assign({}, c) }; }
  function slotDe(v) { var n = parseInt(v, 10) || 30; return n <= 10 ? 10 : n <= 15 ? 15 : n <= 20 ? 20 : n <= 30 ? 30 : n <= 40 ? 40 : 60; }
  function parseConselho(str) {
    var s = trim(str).toUpperCase();
    var out = { conselho: 'CRM', numero: U.digits(s), uf: '' };
    var m = s.match(/\b(CRM|CRO|CRP|CREFITO|CRN|COREN|CRF)\b/); if (m) out.conselho = m[1];
    var ufs = s.replace(/\b(CRM|CRO|CRP|CREFITO|CRN|COREN|CRF)\b/g, ' ').match(/\b[A-Z]{2}\b/g) || [];
    for (var i = 0; i < ufs.length; i++) if (UFS.indexOf(ufs[i]) >= 0) { out.uf = ufs[i]; break; }
    return out;
  }
  function parseItensTexto(texto) {
    return String(texto || '').split(/\r?\n/).map(function (l) { return l.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim(); }).filter(Boolean).map(function (l) {
      var p = l.split(/\s+[—–-]\s+/);
      return { nome: p[0].trim(), pos: p.slice(1).join(' — ').trim(), qtd: '', qtdExtenso: '' };
    });
  }
  function hashId(prefixo, texto) { return prefixo + '-' + U.sha256Sync(String(texto || '')).slice(0, 16); }
  function novaContagem() { return { encontrados: 0, novos: 0, existentes: 0, descartados: 0 }; }

  /* =================== detecção e leitura =================== */
  function detectar(bruto) {
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return { origem: 'desconhecido', state: null };
    if (bruto.app === 'clinicar-antigo' && bruto.state && typeof bruto.state === 'object') return { origem: 'antigo', state: bruto.state };
    if (bruto.app === 'clinicar' && bruto.state && typeof bruto.state === 'object') return { origem: 'clinicar', state: bruto.state };
    if (Array.isArray(bruto.patients) || Array.isArray(bruto.appts) || Array.isArray(bruto.records)) return { origem: 'antigo', state: bruto };
    if ((Array.isArray(bruto.pacientes) || Array.isArray(bruto.consultas)) && bruto.cfg && typeof bruto.cfg === 'object') return { origem: 'clinicar', state: bruto };
    return { origem: 'desconhecido', state: null };
  }
  function ler(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error(MSG_NAO_RECONHECIDO)); return; }
      if (file.size > 60 * 1024 * 1024) { reject(new Error('Arquivo muito grande (mais de 60 MB)')); return; }
      var r = new FileReader();
      r.onerror = function () { reject(new Error('Não foi possível ler o arquivo')); };
      r.onload = function () {
        var bruto;
        try { bruto = JSON.parse(String(r.result || '').replace(/^\uFEFF/, '')); } catch (err) { reject(new Error(MSG_NAO_RECONHECIDO)); return; }
        var d = detectar(bruto);
        resolve({ origem: d.origem, bruto: bruto, nome: file.name || '', tamanho: file.size || 0 });
      };
      r.readAsText(file);
    });
  }

  /* =================== mapeamento (puro) =================== */
  function mapear(bruto, origem) {
    var d = detectar(bruto);
    origem = origem || d.origem;
    if (origem === 'antigo') return mapearAntigo(d.state || bruto);
    if (origem === 'clinicar') return mapearConsultai(d.state || bruto);
    throw new Error(MSG_NAO_RECONHECIDO);
  }
  function mapearConsultai(s) {
    var parcial = { cfgPatch: null, logo: null, _tomb: {} };
    var cont = {}, avisos = [];
    ORDEM.forEach(function (col) {
      if (!Array.isArray(s[col])) return;
      var c = cont[col] = novaContagem();
      parcial[col] = [];
      s[col].forEach(function (it) {
        c.encontrados++;
        if (!it || typeof it !== 'object' || !idOk(it.id)) { c.descartados++; return; }
        var obj = Object.assign({}, it, { id: String(it.id) });
        if (col === 'consultas') obj.teleLink = CL.util.urlSegura(obj.teleLink);   /* só http(s) vira link */
        if (!obj.createdAt) obj.createdAt = +obj.updatedAt || Date.now();
        if (!obj.updatedAt) obj.updatedAt = obj.createdAt;
        parcial[col].push(obj);
        if (CL.get(col, obj.id)) c.existentes++; else c.novos++;
      });
    });
    if (s.cfg && typeof s.cfg === 'object') parcial.cfgPatch = Object.assign({}, s.cfg);
    if (s._tomb && typeof s._tomb === 'object') Object.keys(s._tomb).forEach(function (id) { if (idOk(id) && +s._tomb[id]) parcial._tomb[id] = +s._tomb[id]; });
    var tombN = Object.keys(parcial._tomb).length;
    if (tombN) avisos.push(tombN + ' exclusões registradas no arquivo serão respeitadas (itens apagados lá não voltam).');
    if (parcial.usuarios && parcial.usuarios.length) avisos.push('Usuários do arquivo são mesclados com os daqui; PINs vêm no arquivo.');
    return { parcial: parcial, contagens: cont, avisos: avisos, origem: 'clinicar' };
  }
  function mapearAntigo(s) {
    s = s && typeof s === 'object' ? s : {};
    var agora = Date.now();
    var parcial = { profissionais: [], procedimentos: [], convenios: [], pacientes: [], consultas: [], evolucoes: [], receitas: [], documentos: [], exames: [], modelos: [], cfgPatch: {}, logo: null, _tomb: {} };
    var cont = {}, avisos = [];
    var n = { criadosDeConsultas: 0, semPaciente: 0, teleDescartados: 0, cidSemAut: 0, fonesCompletados: 0, textosSoltos: 0, semData: 0 };
    var c = function (col) { return cont[col] = cont[col] || novaContagem(); };
    var oldCfg = (s.cfg && typeof s.cfg === 'object') ? s.cfg : {};
    var ag = (oldCfg.agenda && typeof oldCfg.agenda === 'object') ? oldCfg.agenda : {};

    /* profissional padrão */
    var profId, profNovo = null;
    var nomeProfArquivo = trim(oldCfg.medico);
    var profsAtivos = CL.col('profissionais').filter(function (p) { return p && p.ativo !== false; });
    var casado = nomeProfArquivo ? CL.col('profissionais').filter(function (p) { return p && U.norm(p.nome) === U.norm(nomeProfArquivo); })[0] : null;
    c('profissionais').encontrados = 1;
    if (casado) { profId = casado.id; c('profissionais').existentes = 1; avisos.push('Profissional do arquivo casado com um cadastro existente; os registros importados ficam com ele.'); }
    else if (!nomeProfArquivo && profsAtivos.length) { profId = profsAtivos[0].id; c('profissionais').existentes = 1; avisos.push('O arquivo não traz o nome do profissional; os registros ficam com o primeiro profissional ativo daqui.'); }
    else {
      var cr = parseConselho(oldCfg.crm);
      var horarios = {};
      var dias = Array.isArray(ag.dias) && ag.dias.length ? ag.dias : [1, 2, 3, 4, 5, 6];
      var ini = hhmm(ag.ini) || '07:00', fim = hhmm(ag.fim) || '19:00';
      dias.forEach(function (dd) { var k = String(parseInt(dd, 10)); if (/^[0-6]$/.test(k)) horarios[k] = [{ ini: ini, fim: fim }]; });
      profId = CL.uid();
      profNovo = { id: profId, nome: nomeProfArquivo || 'Profissional', conselho: cr.conselho, numero: cr.numero, uf: cr.uf, rqe: trim(oldCfg.rqe), especialidade: trim(oldCfg.esp), cor: '#2B5CE6', ativo: true, horarios: horarios, slot: slotDe(ag.slot), maxEncaixesHora: 1, procIds: [], procPadraoId: 'proc-consulta', repasse: { modo: 'nenhum', valor: 0 }, usuarioId: null, createdAt: agora, updatedAt: agora };
      parcial.profissionais.push(profNovo);
      c('profissionais').novos = 1;
      avisos.push('Profissional padrão criado a partir dos dados do sistema anterior' + (nomeProfArquivo ? '' : ' (sem nome — complete em Ajustes › Profissionais)') + '.');
    }

    /* procedimentos de semente */
    PROCS_SEMENTE.forEach(function (p) {
      c('procedimentos').encontrados++;
      if (CL.get('procedimentos', p[0])) { c('procedimentos').existentes++; return; }
      parcial.procedimentos.push({ id: p[0], nome: p[1], dur: p[2], valorCent: 0, cor: p[3], modalidade: p[4], bufferMin: 0, ativo: true, createdAt: agora, updatedAt: agora });
      c('procedimentos').novos++;
    });

    /* convênios */
    var convPorNorm = {};
    CL.col('convenios').forEach(function (cv) { if (cv) convPorNorm[U.norm(cv.nome)] = cv.id; });
    if (!CL.get('convenios', 'particular')) { parcial.convenios.push({ id: 'particular', nome: 'Particular', ativo: true, createdAt: agora, updatedAt: agora }); convPorNorm.particular = 'particular'; c('convenios').encontrados++; c('convenios').novos++; }
    var convVistos = {};
    function convenioId(texto) {
      var nome = trim(texto);
      if (!nome || U.norm(nome) === 'particular') return 'particular';
      var k = U.norm(nome);
      if (convPorNorm[k]) { if (!convVistos[k]) { convVistos[k] = true; c('convenios').encontrados++; c('convenios').existentes++; } return convPorNorm[k]; }
      convVistos[k] = true;
      var id = CL.uid();
      parcial.convenios.push({ id: id, nome: nome, ativo: true, createdAt: agora, updatedAt: agora });
      convPorNorm[k] = id;
      c('convenios').encontrados++; c('convenios').novos++;
      return id;
    }

    /* pacientes */
    var pacIds = {}, porNome = {}, pacImportado = {};
    CL.col('pacientes').forEach(function (p) { if (p) { pacIds[p.id] = true; if (!porNome[U.norm(p.nome)]) porNome[U.norm(p.nome)] = p.id; } });
    (Array.isArray(s.patients) ? s.patients : []).forEach(function (p) {
      c('pacientes').encontrados++;
      if (!p || typeof p !== 'object' || !idOk(p.id) || !trim(p.nome)) { c('pacientes').descartados++; return; }
      var upd = +p.updatedAt || 0;
      var createdAt = msDe(p.criadoEm, upd || agora);
      var updatedAt = upd || createdAt;
      var novo = {
        id: String(p.id), nome: trim(p.nome), nomeSocial: '', nasc: ymd(p.nasc), sexo: ['M', 'F', 'O'].indexOf(p.sexo) >= 0 ? p.sexo : '',
        cpf: U.digits(p.cpf), fone: U.digits(p.fone), email: trim(p.email), endereco: trim(p.endereco), nomeMae: '', naturalidade: '',
        convenioId: convenioId(p.convenio), convenioNumero: '', origem: 'importacao',
        alergias: trim(p.alergias), problemas: trim(p.problemas), meds: trim(p.meds), obs: trim(p.obs),
        consentimentos: consentVazio(), cidAutorizacoes: [], lgpd: { pedidos: [], compartilhamentos: [] }, ativo: true, inativadoEm: null,
        createdAt: createdAt, updatedAt: updatedAt
      };
      parcial.pacientes.push(novo);
      pacImportado[novo.id] = novo;
      if (pacIds[novo.id]) c('pacientes').existentes++; else c('pacientes').novos++;
      pacIds[novo.id] = true;
      if (!porNome[U.norm(novo.nome)]) porNome[U.norm(novo.nome)] = novo.id;
    });
    function completarFone(pacId, fone) {
      fone = U.digits(fone);
      if (!fone || fone.length < 10) return;
      var imp = pacImportado[pacId];
      if (imp) { if (!imp.fone) imp.fone = fone; return; }
      var ex = CL.get('pacientes', pacId);
      if (ex && !ex.fone) {
        var copia = Object.assign({}, ex, { fone: fone, updatedAt: agora });
        parcial.pacientes.push(copia); pacImportado[pacId] = copia; n.fonesCompletados++;
      }
    }

    /* consultas */
    (Array.isArray(s.appts) ? s.appts : []).forEach(function (a) {
      c('consultas').encontrados++;
      if (!a || typeof a !== 'object' || !idOk(a.id)) { c('consultas').descartados++; return; }
      var data = ymd(a.date);
      if (!data) { c('consultas').descartados++; n.semData++; return; }
      var upd = +a.updatedAt || agora;
      var pacId = (a.pacId && pacIds[a.pacId]) ? String(a.pacId) : null;
      if (!pacId && trim(a.pac)) {
        var nome = trim(a.pac), k = U.norm(nome);
        if (porNome[k]) pacId = porNome[k];
        else {
          pacId = CL.uid();
          var np = { id: pacId, nome: nome, nomeSocial: '', nasc: '', sexo: '', cpf: '', fone: U.digits(a.fone), email: '', endereco: '', nomeMae: '', naturalidade: '', convenioId: 'particular', convenioNumero: '', origem: 'importacao', alergias: '', problemas: '', meds: '', obs: '', consentimentos: consentVazio(), cidAutorizacoes: [], lgpd: { pedidos: [], compartilhamentos: [] }, ativo: true, inativadoEm: null, createdAt: upd, updatedAt: upd };
          parcial.pacientes.push(np); pacImportado[pacId] = np; pacIds[pacId] = true; porNome[k] = pacId;
          c('pacientes').encontrados++; c('pacientes').novos++; n.criadosDeConsultas++;
        }
      }
      if (pacId && a.fone) completarFone(pacId, a.fone);
      if (!pacId) n.semPaciente++;
      if (a.teleRoom) n.teleDescartados++;
      var pacObj = pacId ? (pacImportado[pacId] || CL.get('pacientes', pacId)) : null;
      var status = STATUS_MAP[a.status] || 'agendado';
      var consulta = {
        id: String(a.id), data: data, hora: hhmm(a.time) || '08:00', dur: (parseInt(a.dur, 10) >= 5) ? parseInt(a.dur, 10) : 30,
        profId: profId, pacId: pacId, procId: TIPO_PROC[a.type] || 'proc-consulta', status: status,
        encaixe: false, encaixeMotivo: '', obs: trim(a.obs), origem: 'importacao', teleLink: '', lembreteEm: null,
        confirmadoEm: null, chegouEm: null, inicioEm: null, fimEm: null,
        cancelamento: status === 'cancelado' ? { em: upd, motivo: '', porQuem: 'paciente' } : null,
        esperaId: null, evolucaoId: null, lancamentoId: null, convenioId: pacObj ? (pacObj.convenioId || 'particular') : 'particular',
        historico: [{ em: upd, usuario: 'importacao', acao: 'criada' }], createdAt: upd, updatedAt: upd
      };
      parcial.consultas.push(consulta);
      if (CL.get('consultas', consulta.id)) c('consultas').existentes++; else c('consultas').novos++;
    });

    /* evoluções (records) */
    (Array.isArray(s.records) ? s.records : []).forEach(function (r) {
      c('evolucoes').encontrados++;
      if (!r || typeof r !== 'object' || !idOk(r.id) || !r.pacId || !pacIds[r.pacId]) { c('evolucoes').descartados++; return; }
      var upd = +r.updatedAt || msDe(r.date, agora);
      var ev = {
        id: String(r.id), pacId: String(r.pacId), profId: profId, consultaId: r.apptId ? String(r.apptId) : null, data: isoOu(r.date, upd),
        tipo: TIPOS_EVO.indexOf(r.tipo) >= 0 ? r.tipo : 'evolucao', tipoAtend: TIPOS_ATEND.indexOf(r.tipoAtend) >= 0 ? r.tipoAtend : '',
        titulo: trim(r.titulo), texto: String(r.texto || ''), versoes: [], origem: 'importacao', createdAt: msDe(r.date, upd), updatedAt: upd
      };
      parcial.evolucoes.push(ev);
      if (CL.get('evolucoes', ev.id)) c('evolucoes').existentes++; else c('evolucoes').novos++;
    });

    /* receitas (prescriptions) */
    (Array.isArray(s.prescriptions) ? s.prescriptions : []).forEach(function (r) {
      c('receitas').encontrados++;
      if (!r || typeof r !== 'object' || !idOk(r.id) || !r.pacId || !pacIds[r.pacId]) { c('receitas').descartados++; return; }
      var upd = +r.updatedAt || msDe(r.date, agora);
      var itens = Array.isArray(r.itens) && r.itens.length ? r.itens.filter(function (it) { return it && trim(it.nome); }).map(function (it) { return { nome: trim(it.nome), pos: trim(it.pos), qtd: trim(it.qtd), qtdExtenso: trim(it.qtdExtenso) }; }) : parseItensTexto(r.texto);
      var rx = {
        id: String(r.id), pacId: String(r.pacId), profId: profId, data: isoOu(r.date, upd),
        tipo: r.tipo === 'especial' || r.tipo === 'controle' ? 'controle' : r.tipo === 'antimicrobiano' ? 'antimicrobiano' : 'simples',
        itens: itens, obs: trim(r.obs), origem: 'importacao', createdAt: msDe(r.date, upd), updatedAt: upd
      };
      parcial.receitas.push(rx);
      if (CL.get('receitas', rx.id)) c('receitas').existentes++; else c('receitas').novos++;
    });

    /* documentos */
    (Array.isArray(s.documentos) ? s.documentos : []).forEach(function (d) {
      c('documentos').encontrados++;
      if (!d || typeof d !== 'object' || !idOk(d.id) || !d.pacId || !pacIds[d.pacId]) { c('documentos').descartados++; return; }
      var upd = +d.updatedAt || msDe(d.date, agora);
      var tipo = TIPOS_DOC.indexOf(d.tipo) >= 0 ? d.tipo : 'declaracao';
      var cid = trim(d.cid);
      if (cid && tipo === 'atestado') n.cidSemAut++;
      var doc = {
        id: String(d.id), pacId: String(d.pacId), profId: profId, data: isoOu(d.date, upd), tipo: tipo,
        subtipo: ['afastamento', 'comparecimento', 'acompanhante'].indexOf(d.subtipo) >= 0 ? d.subtipo : '', dias: parseInt(d.dias, 10) || null,
        dataInicio: ymd(d.dataInicio), horaIni: hhmm(d.horaIni), horaFim: hhmm(d.horaFim), cid: cid, cidAutorizado: false,
        texto: String(d.texto || ''), titulo: trim(d.titulo) || (tipo === 'exames' ? 'Solicitação de exames' : tipo === 'atestado' ? 'Atestado' : 'Documento'),
        exames: String(d.exames || ''), ind: trim(d.ind), obs: trim(d.obs), modeloId: null, origem: 'importacao', createdAt: msDe(d.date, upd), updatedAt: upd
      };
      parcial.documentos.push(doc);
      if (CL.get('documentos', doc.id)) c('documentos').existentes++; else c('documentos').novos++;
    });

    /* exames (labs) */
    (Array.isArray(s.labs) ? s.labs : []).forEach(function (l) {
      c('exames').encontrados++;
      var valor = typeof l.valor === 'number' ? l.valor : parseFloat(String(l && l.valor != null ? l.valor : '').replace(',', '.'));
      if (!l || typeof l !== 'object' || !idOk(l.id) || !l.pacId || !pacIds[l.pacId] || !trim(l.nome) || isNaN(valor)) { c('exames').descartados++; return; }
      var upd = +l.updatedAt || agora;
      var ex = { id: String(l.id), pacId: String(l.pacId), data: ymd(l.date) || U.ymd(new Date(upd)), nome: trim(l.nome), valor: valor, unidade: trim(l.unidade), origem: 'importacao', createdAt: upd, updatedAt: upd };
      parcial.exames.push(ex);
      if (CL.get('exames', ex.id)) c('exames').existentes++; else c('exames').novos++;
    });

    /* modelos */
    (Array.isArray(s.modelos) ? s.modelos : []).forEach(function (m) {
      c('modelos').encontrados++;
      if (!m || typeof m !== 'object' || !idOk(m.id) || !trim(m.nome) || (m.tipo !== 'rx' && m.tipo !== 'atestado')) { c('modelos').descartados++; return; }
      var upd = +m.updatedAt || agora;
      var md = { id: String(m.id), tipo: m.tipo, nome: trim(m.nome), createdAt: upd, updatedAt: upd };
      if (m.tipo === 'rx') md.rx = { rxTipo: m.rxTipo === 'especial' || m.rxTipo === 'controle' ? 'controle' : m.rxTipo === 'antimicrobiano' ? 'antimicrobiano' : 'simples', itens: (Array.isArray(m.itens) ? m.itens : []).filter(function (it) { return it && trim(it.nome); }).map(function (it) { return { nome: trim(it.nome), pos: trim(it.pos), qtd: trim(it.qtd), qtdExtenso: trim(it.qtdExtenso) }; }), obs: trim(m.obs) };
      else md.atestado = { subtipo: ['afastamento', 'comparecimento', 'acompanhante'].indexOf(m.subtipo) >= 0 ? m.subtipo : 'afastamento', dias: parseInt(m.dias, 10) || null, cid: trim(m.cid), texto: String(m.texto || '') };
      parcial.modelos.push(md);
      if (CL.get('modelos', md.id)) c('modelos').existentes++; else c('modelos').novos++;
    });

    /* docs[] — histórico sem paciente */
    (Array.isArray(s.docs) ? s.docs : []).forEach(function (d) {
      c('evolucoes').encontrados++;
      if (!d || typeof d !== 'object' || !trim(d.out)) { c('evolucoes').descartados++; return; }
      var em = msDe(d.date, agora);
      var ev = { id: hashId('imp', trim(d.title) + '|' + trim(d.date) + '|' + String(d.out)), pacId: null, profId: profId, consultaId: null, data: isoOu(d.date, em), tipo: 'evolucao', tipoAtend: '', titulo: trim(d.title) || 'Texto importado', texto: String(d.out), versoes: [], origem: 'importacao', createdAt: em, updatedAt: em };
      parcial.evolucoes.push(ev);
      n.textosSoltos++;
      if (CL.get('evolucoes', ev.id)) c('evolucoes').existentes++; else c('evolucoes').novos++;
    });

    /* cfg e logo */
    var cl = {};
    if (trim(oldCfg.clinica)) cl.nome = trim(oldCfg.clinica);
    if (trim(oldCfg.endereco)) cl.endereco = trim(oldCfg.endereco);
    if (trim(oldCfg.telefone)) cl.telefone = trim(oldCfg.telefone);
    if (trim(oldCfg.rodape)) cl.rodape = trim(oldCfg.rodape);
    if (Object.keys(cl).length) parcial.cfgPatch.clinica = cl;
    var agPatch = {};
    if (hhmm(ag.ini)) agPatch.horaIni = hhmm(ag.ini);
    if (hhmm(ag.fim)) agPatch.horaFim = hhmm(ag.fim);
    if (ag.slot) agPatch.slotBase = slotDe(ag.slot);
    if (Object.keys(agPatch).length) parcial.cfgPatch.agenda = agPatch;
    if (typeof oldCfg.logo === 'string' && /^data:image\//.test(oldCfg.logo) && oldCfg.logo.length < 2000000) { parcial.logo = oldCfg.logo; avisos.push('Logo do sistema anterior encontrada (será usada se ainda não houver logo aqui).'); }
    if (s._tomb && typeof s._tomb === 'object') Object.keys(s._tomb).forEach(function (id) { if (idOk(id) && +s._tomb[id]) parcial._tomb[id] = +s._tomb[id]; });

    if (n.criadosDeConsultas) avisos.push(n.criadosDeConsultas + (n.criadosDeConsultas === 1 ? ' consulta sem ficha virou um paciente novo' : ' consultas sem ficha viraram fichas novas') + ' (só nome e telefone).');
    if (n.fonesCompletados) avisos.push(n.fonesCompletados + (n.fonesCompletados === 1 ? ' ficha existente ganhou telefone' : ' fichas existentes ganharam telefone') + ' vindo das consultas.');
    if (n.semPaciente) avisos.push(n.semPaciente + (n.semPaciente === 1 ? ' consulta sem paciente identificável foi importada sem vínculo' : ' consultas sem paciente identificável foram importadas sem vínculo') + ' — vincule na agenda.');
    if (n.semData) avisos.push(n.semData + (n.semData === 1 ? ' consulta sem data válida foi descartada.' : ' consultas sem data válida foram descartadas.'));
    if (n.teleDescartados) avisos.push(n.teleDescartados + (n.teleDescartados === 1 ? ' link de teleconsulta descartado' : ' links de teleconsulta descartados') + ' (a sala antiga não existe no produto novo).');
    if (n.cidSemAut) avisos.push(n.cidSemAut + (n.cidSemAut === 1 ? ' atestado com CID sem autorização registrada' : ' atestados com CID sem autorização registrada') + ' — revise antes de reimprimir.');
    var descClin = ['evolucoes', 'receitas', 'documentos', 'exames'].reduce(function (s2, col) { return s2 + (cont[col] ? cont[col].descartados : 0); }, 0) - (cont.evolucoes ? 0 : 0);
    if (descClin) avisos.push(descClin + (descClin === 1 ? ' registro clínico descartado' : ' registros clínicos descartados') + ' por paciente inexistente ou dado inválido.');
    if (n.textosSoltos) avisos.push(n.textosSoltos + (n.textosSoltos === 1 ? ' texto do histórico sem paciente' : ' textos do histórico sem paciente') + ' — veja em Ajustes › Dados › Textos importados sem paciente.');
    if (Object.keys(parcial._tomb).length) avisos.push(Object.keys(parcial._tomb).length + ' exclusões registradas no arquivo serão respeitadas.');
    Object.keys(parcial).forEach(function (k) { if (Array.isArray(parcial[k]) && !parcial[k].length) delete parcial[k]; });
    return { parcial: parcial, contagens: cont, avisos: avisos, origem: 'antigo' };
  }

  /* =================== aplicar =================== */
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
  function colsDe(parcial) { return ORDEM.filter(function (col) { return Array.isArray(parcial[col]); }); }
  function aplicar(parcial, opts) {
    opts = opts || {};
    var modo = opts.modo === 'substituir' ? 'substituir' : 'mesclar';
    var progresso = typeof opts.onProgresso === 'function' ? opts.onProgresso : function () {};
    var cols = colsDe(parcial);
    var resultado = { modo: modo, total: 0, removidos: 0 };
    cols.forEach(function (col) { resultado[col] = { gravados: 0, removidos: 0 }; });
    var temDados = CL.col('pacientes').length + CL.col('consultas').length > 0;
    if (temDados && !opts.semBackup) {
      try {
        U.baixar('clinicar-backup-antes-importar-' + U.hoje() + '.json', Backend.exportar(), 'application/json');
        Backend.meta.set({ ultimoExport: Date.now() });
      } catch (err) { console.error('[Importar] backup antes de importar falhou', err); }
    }
    if (modo === 'substituir') return substituir(parcial, cols, resultado, progresso, opts);
    return mesclar(parcial, cols, resultado, progresso, opts);
  }
  function aplicarCfg(parcial, modo, origem) {
    var patch = parcial.cfgPatch;
    if (!patch || typeof patch !== 'object') return;
    if (origem === 'clinicar') {
      var atual = CL.state.cfg || {};
      if (modo === 'substituir' || (+patch.updatedAt || 0) > (+atual.updatedAt || 0)) { var p = Object.assign({}, patch); delete p.updatedAt; CL.setCfg(p); }
      return;
    }
    var out = {};
    var atualCfg = CL.state.cfg || {};
    Object.keys(patch).forEach(function (sec) {
      if (!patch[sec] || typeof patch[sec] !== 'object') return;
      Object.keys(patch[sec]).forEach(function (k) {
        var local = atualCfg[sec] ? atualCfg[sec][k] : undefined;
        var vazio = local === undefined || local === null || local === '' || (sec === 'agenda' && k === 'slotBase' && local === 15) || (sec === 'agenda' && (k === 'horaIni' && local === '07:00' || k === 'horaFim' && local === '19:00'));
        if (modo === 'substituir' || vazio) { (out[sec] = out[sec] || {})[k] = patch[sec][k]; }
      });
    });
    if (Object.keys(out).length) CL.setCfg(out);
  }
  function aplicarLogo(parcial, modo) {
    if (!parcial.logo) return;
    if (modo === 'substituir' || !Backend.logo.get()) Backend.logo.set(parcial.logo);
  }
  function mesclar(parcial, cols, resultado, progresso, opts) {
    var remoto = { _tomb: parcial._tomb || {} };
    cols.forEach(function (col) { remoto[col] = parcial[col]; });
    var merged = Backend.merge(remoto, CL.state);
    var passos = cols.length + 1, feito = 0;
    return CL.lote(function () {
      var cadeia = Promise.resolve();
      cols.forEach(function (col) {
        cadeia = cadeia.then(function () {
          progresso(feito / passos, ROTULOS[col] || col);
          var atual = CL.col(col);
          var vivos = {};
          (merged[col] || []).forEach(function (item) {
            vivos[item.id] = true;
            var cur = CL.get(col, item.id);
            if (cur === item) return;
            CL.upsert(col, item, { manterUpdatedAt: true });
            resultado[col].gravados++; resultado.total++;
          });
          atual.slice().forEach(function (it) {
            if (it && !vivos[it.id]) { CL.remove(col, it.id); resultado[col].removidos++; resultado.removidos++; }
          });
          feito++;
          return esperar(0);
        });
      });
      return cadeia.then(function () {
        progresso(feito / passos, 'Configurações');
        var tomb = merged._tomb || {};
        Object.keys(tomb).forEach(function (id) { if (!(id in CL.state._tomb) || CL.state._tomb[id] < tomb[id]) CL.state._tomb[id] = tomb[id]; });
        aplicarCfg(parcial, 'mesclar', opts.origem);
        aplicarLogo(parcial, 'mesclar');
        CL.persistTudo();
        progresso(1, 'Concluído');
      });
    }).then(function () { return concluir(resultado, opts); });
  }
  function substituir(parcial, cols, resultado, progresso, opts) {
    var agora = Date.now();
    var novo = CL.normalizar(JSON.parse(JSON.stringify(CL.state)));
    var passos = cols.length + 1, feito = 0;
    cols.forEach(function (col) {
      progresso(feito / passos, ROTULOS[col] || col);
      if (col === 'usuarios' || col === 'auditoria') {
        var porId = {};
        novo[col].forEach(function (it) { if (it) porId[it.id] = it; });
        parcial[col].forEach(function (it) { if (!porId[it.id] || (+it.updatedAt || 0) > (+porId[it.id].updatedAt || 0)) { porId[it.id] = it; resultado[col].gravados++; resultado.total++; } });
        novo[col] = Object.keys(porId).map(function (k) { return porId[k]; });
      } else {
        var importados = {};
        parcial[col].forEach(function (it) { importados[it.id] = true; });
        novo[col].forEach(function (it) { if (it && !importados[it.id]) { novo._tomb[it.id] = agora; resultado[col].removidos++; resultado.removidos++; } });
        novo[col] = parcial[col].map(function (it) { var o = Object.assign({}, it); if (!o.createdAt) o.createdAt = o.updatedAt || agora; if (!o.updatedAt) o.updatedAt = o.createdAt; return o; });
        resultado[col].gravados = novo[col].length; resultado.total += novo[col].length;
      }
      feito++;
    });
    Object.keys(parcial._tomb || {}).forEach(function (id) { if (!(id in novo._tomb) || novo._tomb[id] < parcial._tomb[id]) novo._tomb[id] = parcial._tomb[id]; });
    return CL.lote(function () {
      CL.substituirEstado(novo);
      aplicarCfg(parcial, 'substituir', opts.origem);
      aplicarLogo(parcial, 'substituir');
      progresso(feito / passos, 'Gravando');
      return Backend.save(CL.state, { forcarVazio: true }).then(function () { CL.persistTudo(); progresso(1, 'Concluído'); });
    }).then(function () { return concluir(resultado, opts); });
  }
  function concluir(resultado, opts) {
    var contagens = {};
    ORDEM.forEach(function (col) { if (resultado[col]) contagens[col] = resultado[col]; });
    try { CL.audit('dados.importar', 'state', null, { origem: opts.origem || '', modo: resultado.modo, total: resultado.total, removidos: resultado.removidos }); } catch (err) { console.error(err); }
    try { Backend.meta.set({ ultimoImport: Date.now() }); } catch (err) { /* meta é auxiliar */ }
    return { contagens: contagens, total: resultado.total, removidos: resultado.removidos, modo: resultado.modo };
  }

  /* =================== relatório (só números) =================== */
  function relatorio(contagens, avisos, o) {
    o = o || {};
    var cols = ORDEM.filter(function (col) { return contagens[col] && (contagens[col].encontrados || contagens[col].gravados); });
    var html = '';
    if (!cols.length) html += '<p class="texto-2">Nada para importar neste arquivo.</p>';
    else if (o.final) {
      html += '<div class="tabela-wrap"><table class="tabela imp-tabela"><thead><tr><th>Coleção</th><th class="num">Gravados</th><th class="num">Removidos</th></tr></thead><tbody>' +
        cols.map(function (col) { var c = contagens[col]; return '<tr><td>' + e(ROTULOS[col] || col) + '</td><td class="num tnum">' + (c.gravados || 0) + '</td><td class="num tnum">' + (c.removidos || 0) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    } else {
      html += '<div class="tabela-wrap"><table class="tabela imp-tabela"><thead><tr><th>Coleção</th><th class="num">Encontrados</th><th class="num">Novos</th><th class="num">Já existem</th><th class="num">Descartados</th></tr></thead><tbody>' +
        cols.map(function (col) { var c = contagens[col]; return '<tr><td>' + e(ROTULOS[col] || col) + '</td><td class="num tnum">' + c.encontrados + '</td><td class="num tnum">' + c.novos + '</td><td class="num tnum">' + c.existentes + '</td><td class="num tnum">' + c.descartados + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    if (avisos && avisos.length) html += '<h3 class="imp-h3">Avisos</h3><ol class="imp-avisos">' + avisos.map(function (a) { return '<li>' + e(a) + '</li>'; }).join('') + '</ol>';
    return html;
  }

  /* =================== interface =================== */
  function etapasHtml() {
    var nomes = ['Escolher', 'Prévia', 'Aplicar', 'Relatório'];
    return '<ol class="imp-etapas" aria-label="Etapas">' + nomes.map(function (n, i) { var k = i + 1; return '<li class="' + (k === st.etapa ? 'is-atual' : k < st.etapa ? 'is-feita' : '') + '"' + (k === st.etapa ? ' aria-current="step"' : '') + '><span class="imp-n">' + (k < st.etapa ? '<i class="ti ti-check" aria-hidden="true"></i>' : k) + '</span>' + n + '</li>'; }).join('') + '</ol>';
  }
  function render() {
    var el = st.el;
    if (!el) return;
    var html = '<div class="imp">' + etapasHtml();
    if (st.etapa === 1) {
      html += '<label class="imp-zona" data-zona><input type="file" accept=".json,application/json" class="sr-only" data-arquivo><i class="ti ti-file-import" aria-hidden="true"></i><strong>Escolher arquivo .json</strong><span class="texto-2">ou arraste o arquivo para cá</span></label>' +
        '<p class="texto-2">Use o botão <strong>Exportar dados</strong> do sistema anterior ou um backup do próprio Clinicar. A prévia mostra só quantidades; nada é gravado antes da confirmação.</p>' +
        (st.erro ? '<div class="aviso-inline is-erro" role="alert"><i class="ti ti-alert-circle" aria-hidden="true"></i><span>' + e(st.erro) + '</span></div>' : '');
    } else if (st.etapa === 2 && st.mapeado) {
      var m = st.mapeado;
      var temDados = CL.col('pacientes').length + CL.col('consultas').length > 0;
      html += '<div class="card pilha"><div class="linha-acoes"><span class="chip chip-acento"><i class="ti ' + (m.origem === 'antigo' ? 'ti-history' : 'ti-database') + '" aria-hidden="true"></i>' + (m.origem === 'antigo' ? 'Exportação do sistema anterior' : 'Backup do Clinicar') + '</span><span class="texto-3">' + e(st.arquivoNome) + '</span></div>' +
        relatorio(m.contagens, m.avisos) + '</div>' +
        '<div class="card pilha"><h3 class="imp-h3">Como aplicar</h3><div class="imp-modos">' +
        '<label class="imp-modo' + (st.modo === 'mesclar' ? ' is-sel' : '') + '"><input type="radio" name="imp-modo" value="mesclar"' + (st.modo === 'mesclar' ? ' checked' : '') + '><span><strong>Mesclar</strong> <span class="chip chip-ok">recomendado</span><br><small class="texto-2">Junta com o que já existe. Um registro do arquivo só substitui o daqui se for mais recente.</small></span></label>' +
        '<label class="imp-modo' + (st.modo === 'substituir' ? ' is-sel' : '') + '"><input type="radio" name="imp-modo" value="substituir"' + (st.modo === 'substituir' ? ' checked' : '') + '><span><strong>Substituir</strong><br><small class="texto-2">Troca as coleções do arquivo pelas daqui (usuários e auditoria são mantidos). Faz backup antes e pede confirmação.</small></span></label></div>' +
        (temDados ? '<p class="texto-3">Um backup do estado atual é baixado automaticamente antes de aplicar.</p>' : '') +
        '<div class="linha-acoes"><button type="button" class="btn btn-neutro" data-acao="voltar"><i class="ti ti-arrow-left" aria-hidden="true"></i>Voltar</button><button type="button" class="btn btn-primario" data-acao="aplicar"' + (st.ocupado ? ' disabled' : '') + '><i class="ti ti-file-import" aria-hidden="true"></i>Importar</button></div></div>';
    } else if (st.etapa === 3) {
      html += '<div class="card imp-progresso-wrap"><p class="rotulo" data-rotulo>Preparando…</p><div class="imp-progresso" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-barra><span style="width:0%"></span></div><p class="texto-3">Não feche a página.</p></div>';
    } else if (st.etapa === 4 && st.resultado) {
      html += '<div class="card pilha"><div class="aviso-inline is-info"><i class="ti ti-circle-check" aria-hidden="true"></i><span>Importação concluída (' + (st.resultado.modo === 'substituir' ? 'substituir' : 'mesclar') + '): ' + st.resultado.total + ' registros gravados' + (st.resultado.removidos ? ', ' + st.resultado.removidos + ' removidos' : '') + '.</span></div>' +
        relatorio(st.resultado.contagens, st.mapeado ? st.mapeado.avisos : [], { final: true }) +
        '<div class="linha-acoes"><a class="btn btn-primario" href="#/agenda"><i class="ti ti-calendar" aria-hidden="true"></i>Abrir a agenda</a><button type="button" class="btn btn-neutro" data-acao="outro"><i class="ti ti-file-import" aria-hidden="true"></i>Importar outro arquivo</button></div></div>';
    }
    el.innerHTML = html + '</div>';
    var zona = el.querySelector('[data-zona]');
    if (zona) {
      var inp = zona.querySelector('[data-arquivo]');
      inp.addEventListener('change', function () { if (inp.files && inp.files[0]) receber(inp.files[0]); });
      ['dragenter', 'dragover'].forEach(function (ev) { zona.addEventListener(ev, function (evt) { evt.preventDefault(); zona.classList.add('is-sobre'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { zona.addEventListener(ev, function (evt) { evt.preventDefault(); zona.classList.remove('is-sobre'); }); });
      zona.addEventListener('drop', function (evt) { var f = evt.dataTransfer && evt.dataTransfer.files && evt.dataTransfer.files[0]; if (f) receber(f); });
    }
  }
  function receber(file) {
    st.erro = '';
    st.arquivoNome = file.name || '';
    ler(file).then(function (r) {
      if (r.origem === 'desconhecido') throw new Error(MSG_NAO_RECONHECIDO);
      st.lido = r;
      st.mapeado = mapear(r.bruto, r.origem);
      st.etapa = 2; st.modo = 'mesclar';
      render();
    }).catch(function (err) {
      st.lido = null; st.mapeado = null; st.etapa = 1;
      st.erro = (err && err.message) || MSG_NAO_RECONHECIDO;
      render();
    });
  }
  function confirmarSubstituir() {
    return new Promise(function (resolve) {
      var decidido = false;
      var corpo = document.createElement('div');
      corpo.className = 'pilha';
      corpo.innerHTML = '<p>As coleções do arquivo substituem as daqui. Usuários e auditoria são mantidos. Um backup é baixado antes.</p><div class="campo"><label for="imp-confirma">Digite REMOVER para confirmar</label><input id="imp-confirma" class="input" type="text" autocomplete="off" autofocus></div>';
      CL.ui.modal({
        titulo: 'Substituir os dados atuais', corpo: corpo,
        botoes: [
          { rotulo: 'Cancelar', tipo: 'neutro', acao: function () { decidido = true; resolve(false); } },
          { rotulo: 'Substituir', tipo: 'perigo', acao: function () {
            if (corpo.querySelector('input').value.trim() !== 'REMOVER') { CL.ui.toast('Digite REMOVER exatamente assim para confirmar', { kind: 'aviso' }); return false; }
            decidido = true; resolve(true);
          } }
        ],
        aoFechar: function () { if (!decidido) resolve(false); }
      });
    });
  }
  function executar() {
    if (!st.mapeado || st.ocupado) return;
    var pergunta = st.modo === 'substituir' ? confirmarSubstituir() : Promise.resolve(true);
    pergunta.then(function (ok) {
      if (!ok) return;
      st.ocupado = true; st.etapa = 3; render();
      var m = st.mapeado;
      return aplicar(m.parcial, {
        modo: st.modo, origem: m.origem,
        onProgresso: function (fr, rotulo) {
          if (!st.el) return;
          var b = st.el.querySelector('[data-barra]'), r = st.el.querySelector('[data-rotulo]');
          var pct = Math.round(Math.max(0, Math.min(1, fr)) * 100);
          if (b) { b.setAttribute('aria-valuenow', String(pct)); b.firstElementChild.style.width = pct + '%'; }
          if (r) r.textContent = rotulo + ' · ' + pct + '%';
        }
      }).then(function (res) {
        st.resultado = res; st.etapa = 4; st.ocupado = false;
        render();
        CL.ui.toast('Importação concluída: ' + res.total + ' registros', { kind: 'ok' });
      });
    }).catch(function (err) {
      console.error('[Importar] falha', err);
      st.ocupado = false; st.etapa = 2;
      render();
      CL.ui.toast('A importação falhou: ' + ((err && err.message) || 'erro desconhecido') + '. Nada além do que aparece foi gravado.', { kind: 'erro', fixo: true });
    });
  }
  function aoClicar(ev) {
    var b = ev.target.closest('[data-acao]');
    if (!b) return;
    var acao = b.getAttribute('data-acao');
    if (acao === 'voltar' || acao === 'outro') { st.etapa = 1; st.lido = null; st.mapeado = null; st.resultado = null; st.erro = ''; render(); }
    else if (acao === 'aplicar') executar();
  }
  function aoMudar(ev) {
    var t = ev.target;
    if (t && t.name === 'imp-modo') {
      st.modo = t.value === 'substituir' ? 'substituir' : 'mesclar';
      Array.prototype.forEach.call(st.el.querySelectorAll('.imp-modo'), function (l) { l.classList.toggle('is-sel', l.querySelector('input').checked); });
    }
  }

  var Importar = window.Importar = {
    mount: function (el) {
      if (st.el && st.el !== el) Importar.unmount();
      st.el = el;
      if (!el.__impLigado) { el.addEventListener('click', aoClicar); el.addEventListener('change', aoMudar); el.__impLigado = true; }
      if (st.etapa === 3 && !st.ocupado) st.etapa = 1;
      render();
    },
    unmount: function () {
      if (st.el && st.el.__impLigado) { st.el.removeEventListener('click', aoClicar); st.el.removeEventListener('change', aoMudar); st.el.__impLigado = false; }
      st.el = null;
      if (!st.ocupado) { st.etapa = 1; st.lido = null; st.mapeado = null; st.resultado = null; st.erro = ''; }
    },
    ler: ler,
    detectar: detectar,
    mapear: mapear,
    aplicar: aplicar,
    relatorio: relatorio,
    ROTULOS: ROTULOS
  };
})();
