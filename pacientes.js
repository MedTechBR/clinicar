/* Clinicar — pacientes.js (dono: agenda)
   Global único: Pacientes. Lista com busca instantânea (blindada contra o autofill do navegador),
   cadastro completo, cadastro rápido (usado pela agenda), ficha com abas e histórico, faltas
   derivadas das consultas, inativação (nunca apaga) e página LGPD do paciente.
   Contrato: docs/ESPEC.md §4.8 e §5.2. Escrita no estado SÓ por CL.upsert / CL.patch. */
(function () {
  'use strict';
  var e = function (s) { return CL.util.esc(s); };

  var ABAS = [
    ['resumo', 'Resumo', 'ti-id'], ['consultas', 'Consultas', 'ti-calendar'], ['evolucoes', 'Evoluções', 'ti-notes'],
    ['receitas', 'Receitas', 'ti-pill'], ['documentos', 'Documentos', 'ti-file-text'], ['exames', 'Exames', 'ti-flask'],
    ['financeiro', 'Financeiro', 'ti-cash'], ['privacidade', 'Privacidade', 'ti-shield-lock']
  ];
  var CLINICAS = ['evolucoes', 'receitas', 'documentos', 'exames'];
  var SEXO = { M: 'Masculino', F: 'Feminino', O: 'Outro' };
  var ORIGENS = [['', '—'], ['indicacao', 'Indicação'], ['site', 'Site'], ['whatsapp', 'WhatsApp'], ['convenio', 'Convênio'], ['importacao', 'Importação'], ['outro', 'Outro']];
  var CONSENTS = [['lembretes', 'Lembretes de consulta por WhatsApp'], ['campanhas', 'Mensagens de campanhas e aniversário'], ['compartilhamento', 'Compartilhamento com outros profissionais ou convênio']];
  var CONSENT_ORIGENS = [['', '—'], ['verbal', 'Verbal'], ['assinado', 'Termo assinado'], ['whatsapp', 'Pelo WhatsApp']];
  var ACOES_AUDIT = {
    'ficha.abrir': 'Abriu a ficha', 'evolucao.criar': 'Criou evolução', 'evolucao.editar': 'Editou evolução',
    'documento.imprimir': 'Imprimiu documento', 'receita.imprimir': 'Imprimiu receita', 'paciente.exportar': 'Exportou dados do paciente',
    'consulta.status': 'Mudou o status da consulta', 'dados.exportar': 'Exportou tudo', 'dados.importar': 'Importou dados',
    'login': 'Entrou', 'logout': 'Saiu'
  };
  var PRAZO_LGPD_DIAS = 15;

  var vista = { el: null, modo: null, pacId: null, aba: 'resumo', q: '', filtro: 'ativos', ordem: 'nome', unsubs: [], timer: null };
  var ultimaAuditoria = { id: null, em: 0 };

  /* =================== modelo =================== */
  function consentVazio() {
    var c = {};
    CONSENTS.forEach(function (k) { c[k[0]] = { ativo: false, em: null, origem: '' }; });
    return c;
  }
  function normalizarPaciente(p) {
    p = p || {};
    var base = {
      nome: '', nomeSocial: '', nasc: '', sexo: '', cpf: '', fone: '', email: '', endereco: '', nomeMae: '', naturalidade: '',
      convenioId: 'particular', convenioNumero: '', origem: '', alergias: '', problemas: '', meds: '', obs: '',
      consentimentos: consentVazio(), cidAutorizacoes: [], lgpd: { pedidos: [], compartilhamentos: [] }, ativo: true, inativadoEm: null
    };
    Object.keys(base).forEach(function (k) { if (p[k] === undefined || p[k] === null) p[k] = base[k]; });
    if (typeof p.consentimentos !== 'object') p.consentimentos = consentVazio();
    CONSENTS.forEach(function (k) { if (!p.consentimentos[k[0]] || typeof p.consentimentos[k[0]] !== 'object') p.consentimentos[k[0]] = { ativo: false, em: null, origem: '' }; });
    if (!Array.isArray(p.cidAutorizacoes)) p.cidAutorizacoes = [];
    if (!p.lgpd || typeof p.lgpd !== 'object') p.lgpd = { pedidos: [], compartilhamentos: [] };
    if (!Array.isArray(p.lgpd.pedidos)) p.lgpd.pedidos = [];
    if (!Array.isArray(p.lgpd.compartilhamentos)) p.lgpd.compartilhamentos = [];
    return p;
  }
  function pac(id) { return CL.get('pacientes', id); }
  function nomeDe(id) { var p = pac(id); return p ? p.nome : ''; }
  function profNome(id) { var p = CL.get('profissionais', id); return p ? p.nome : ''; }
  function procNome(id) { var p = CL.get('procedimentos', id); return p ? p.nome : ''; }
  function convNome(id) { var c = CL.get('convenios', id); return c ? c.nome : (id === 'particular' || !id ? 'Particular' : ''); }
  function profissionalAtual() {
    var s = CL.session;
    var p = s && s.profId ? CL.get('profissionais', s.profId) : null;
    if (!p) p = CL.col('profissionais').filter(function (x) { return x.ativo !== false; })[0] || null;
    return p || { nome: s ? s.nome : '' };
  }
  function consultasDe(id) {
    return CL.col('consultas').filter(function (c) { return c && c.pacId === id; })
      .sort(function (a, b) { return (b.data + b.hora).localeCompare(a.data + a.hora); });
  }
  function ultimaConsulta(id) {
    var hoje = CL.util.hoje();
    return consultasDe(id).filter(function (c) { return c.data <= hoje && !/^cancelado/.test(c.status); })[0] || null;
  }
  function proximaConsulta(id) {
    var hoje = CL.util.hoje();
    var lista = consultasDe(id).filter(function (c) { return c.data >= hoje && !/^cancelado/.test(c.status) && c.status !== 'faltou' && c.status !== 'finalizado'; });
    return lista.length ? lista[lista.length - 1] : null;
  }
  function nascDe(texto) {
    var m = String(texto || '').trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (!m) return '';
    var dd = (m[1].length === 1 ? '0' : '') + m[1], mm = (m[2].length === 1 ? '0' : '') + m[2];
    return m[3] ? m[3] + '-' + mm + '-' + dd : mm + '-' + dd;
  }
  function ordenador(ordem) {
    if (ordem === 'ultima') {
      return function (a, b) {
        var ua = ultimaConsulta(a.id), ub = ultimaConsulta(b.id);
        return ((ub ? ub.data : '') + '').localeCompare((ua ? ua.data : '') + '') || a.nome.localeCompare(b.nome, 'pt-BR');
      };
    }
    if (ordem === 'cadastro') return function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); };
    return function (a, b) { return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' }); };
  }

  /* =================== API pura =================== */
  function buscar(q, o) {
    o = o || {};
    var limite = o.limite == null ? 8 : o.limite;
    var texto = String(q == null ? '' : q).trim();
    if (texto.indexOf('@') >= 0) texto = '';
    var todos = CL.col('pacientes').filter(function (p) { return p && (o.inativos ? p.ativo === false : p.ativo !== false); });
    var lista;
    if (!texto) lista = todos.slice();
    else {
      var termos = CL.util.norm(texto).split(/\s+/).filter(Boolean);
      var d = CL.util.digits(texto);
      var nasc = nascDe(texto);
      lista = todos.filter(function (p) {
        var nome = CL.util.norm((p.nome || '') + ' ' + (p.nomeSocial || '') + ' ' + (p.nomeMae || ''));
        if (termos.length && termos.every(function (t) { return nome.indexOf(t) >= 0; })) return true;
        if (d.length >= 3 && d.length === texto.replace(/[\s.\-()\/+]/g, '').length) {
          if (CL.util.digits(p.cpf).indexOf(d) >= 0) return true;
          if (CL.util.digits(p.fone).indexOf(d) >= 0) return true;
        }
        if (nasc && p.nasc) {
          if (nasc.length === 10 ? p.nasc === nasc : p.nasc.slice(5) === nasc) return true;
        }
        return false;
      });
    }
    lista.sort(ordenador(o.ordem || 'nome'));
    return limite > 0 ? lista.slice(0, limite) : lista;
  }
  function duplicados(nome) {
    var n = CL.util.norm(nome);
    if (!n) return [];
    return CL.col('pacientes').filter(function (p) { return p && p.ativo !== false && CL.util.norm(p.nome) === n; });
  }
  function rapido(dados) {
    dados = dados || {};
    var nome = String(dados.nome || '').trim();
    if (!nome) throw new Error('Informe o nome do paciente');
    var fone = CL.util.digits(dados.fone);
    var iguais = duplicados(nome);
    if (iguais.length && !dados.forcarNovo) {
      var ex = iguais[0];
      var patch = {};
      if (!ex.fone && fone) patch.fone = fone;
      if (!ex.nasc && dados.nasc) patch.nasc = dados.nasc;
      if (Object.keys(patch).length) CL.patch('pacientes', ex.id, patch);
      CL.ui.toast('Já existia uma ficha com este nome — usada a ficha existente', { kind: 'aviso' });
      return CL.get('pacientes', ex.id);
    }
    var p = normalizarPaciente({ nome: nome, fone: fone, nasc: dados.nasc || '', origem: dados.origem || 'recepcao' });
    if (!ORIGENS.some(function (o) { return o[0] === p.origem; })) p.origem = 'outro';
    return CL.upsert('pacientes', p);
  }
  function faltas(id, o) {
    var meses = (o && o.meses) || 12;
    var limite = CL.util.ymd(new Date(Date.now() - meses * 30 * 86400000));
    var f = 0, t = 0, total = 0;
    CL.col('consultas').forEach(function (c) {
      if (!c || c.pacId !== id || c.data < limite) return;
      total++;
      if (c.status === 'faltou') f++;
      else if (c.status === 'cancelado_tarde') t++;
    });
    return { faltas: f, tardios: t, total: total, risco: f + t >= 3 };
  }
  function selo(id) {
    var p = pac(id);
    if (!p) return '';
    var h = '';
    if (p.alergias) h += '<span class="chip chip-erro" title="Alergia: ' + e(p.alergias) + '"><i class="ti ti-alert-triangle" aria-hidden="true"></i>Alergia</span>';
    var f = faltas(id);
    if (f.risco) h += '<span class="chip chip-aviso" title="' + f.faltas + ' faltas e ' + f.tardios + ' cancelamentos tardios em 12 meses"><i class="ti ti-user-off" aria-hidden="true"></i>Risco de falta</span>';
    if (p.ativo === false) h += '<span class="chip"><i class="ti ti-archive" aria-hidden="true"></i>Inativo</span>';
    return h;
  }
  function registrarCompartilhamento(id, tipo, alvo) {
    var p = pac(id);
    if (!p) return;
    normalizarPaciente(p);
    p.lgpd.compartilhamentos.push({ em: Date.now(), tipo: tipo, alvo: alvo || '' });
    CL.patch('pacientes', id, { lgpd: p.lgpd });
  }

  /* =================== máscaras =================== */
  function mascaraCpf(v) {
    var d = CL.util.digits(v).slice(0, 11);
    var s = d;
    if (d.length > 9) s = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    else if (d.length > 6) s = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
    else if (d.length > 3) s = d.slice(0, 3) + '.' + d.slice(3);
    return s;
  }
  function mascaraFone(v) {
    var d = CL.util.digits(v);
    if (d.length > 11 && d.slice(0, 2) === '55') d = d.slice(2);
    d = d.slice(0, 11);
    if (d.length > 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length > 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + (d.length > 6 ? '-' + d.slice(6) : '');
    if (d.length > 2) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    return d;
  }
  function cpfValido(d) {
    d = CL.util.digits(d);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    var soma = 0, i;
    for (i = 0; i < 9; i++) soma += (+d[i]) * (10 - i);
    var dv1 = (soma * 10) % 11; if (dv1 === 10) dv1 = 0;
    if (dv1 !== +d[9]) return false;
    soma = 0;
    for (i = 0; i < 10; i++) soma += (+d[i]) * (11 - i);
    var dv2 = (soma * 10) % 11; if (dv2 === 10) dv2 = 0;
    return dv2 === +d[10];
  }

  /* =================== formulário completo =================== */
  function campo(rotulo, inner, cls) {
    return '<div class="campo' + (cls ? ' ' + cls : '') + '">' + (rotulo ? '<label class="campo-rotulo">' + rotulo + '</label>' : '') + inner + '</div>';
  }
  function opcoes(lista, atual) {
    return lista.map(function (o) { return '<option value="' + e(o[0]) + '"' + (String(atual) === String(o[0]) ? ' selected' : '') + '>' + e(o[1]) + '</option>'; }).join('');
  }
  function abrirForm(id, o) {
    o = o || {};
    var atual = id ? pac(id) : null;
    var p = normalizarPaciente(atual ? JSON.parse(JSON.stringify(atual)) : {});
    if (!atual && o.inicial) Object.assign(p, o.inicial);
    var conv = CL.col('convenios').filter(function (c) { return c.ativo !== false || c.id === p.convenioId; }).map(function (c) { return [c.id, c.nome]; });
    if (!conv.length) conv = [['particular', 'Particular']];
    var form = document.createElement('form');
    form.className = 'pac-form';
    form.setAttribute('novalidate', '');
    form.innerHTML =
      '<h3 class="pac-form-secao">Identificação</h3><div class="campos">' +
      campo('Nome completo <span class="obrig">*</span>', '<input class="input" name="nome" type="text" autocomplete="off" required value="' + e(p.nome) + '"><div class="campo-erro" data-erro="nome" hidden><i class="ti ti-alert-circle" aria-hidden="true"></i>Informe o nome</div>', 'campo-cheio') +
      campo('Nome social', '<input class="input" name="nomeSocial" type="text" autocomplete="off" value="' + e(p.nomeSocial) + '">') +
      campo('Nascimento', '<input class="input" name="nasc" type="date" value="' + e(p.nasc) + '">') +
      campo('Sexo', '<select class="select" name="sexo">' + opcoes([['', '—'], ['M', 'Masculino'], ['F', 'Feminino'], ['O', 'Outro']], p.sexo) + '</select>') +
      campo('CPF', '<input class="input" name="cpf" type="text" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" value="' + e(CL.fmt.cpf(p.cpf)) + '"><div class="campo-erro" data-erro="cpf" hidden><i class="ti ti-alert-circle" aria-hidden="true"></i>CPF não confere — confira os dígitos</div>') +
      campo('Nome da mãe', '<input class="input" name="nomeMae" type="text" autocomplete="off" value="' + e(p.nomeMae) + '">') +
      campo('Naturalidade', '<input class="input" name="naturalidade" type="text" autocomplete="off" placeholder="Cidade/UF" value="' + e(p.naturalidade) + '">') +
      '</div><h3 class="pac-form-secao">Contato</h3><div class="campos">' +
      campo('Telefone (WhatsApp)', '<input class="input" name="fone" type="tel" inputmode="tel" autocomplete="off" placeholder="(85) 99999-9999" value="' + e(CL.fmt.fone(p.fone)) + '">') +
      campo('E-mail', '<input class="input" name="email" type="email" autocomplete="off" value="' + e(p.email) + '">') +
      campo('Endereço', '<input class="input" name="endereco" type="text" autocomplete="off" placeholder="Rua, número, bairro, cidade/UF" value="' + e(p.endereco) + '">', 'campo-cheio') +
      '</div><h3 class="pac-form-secao">Convênio e origem</h3><div class="campos">' +
      campo('Convênio', '<select class="select" name="convenioId">' + opcoes(conv, p.convenioId || 'particular') + '</select>') +
      campo('Número da carteira', '<input class="input" name="convenioNumero" type="text" autocomplete="off" value="' + e(p.convenioNumero) + '">') +
      campo('Como conheceu a clínica', '<select class="select" name="origem">' + opcoes(ORIGENS, p.origem) + '</select>') +
      '</div><h3 class="pac-form-secao">Clínico</h3><div class="campos">' +
      campo('Alergias', '<input class="input" name="alergias" type="text" autocomplete="off" placeholder="Ex.: dipirona, penicilina" value="' + e(p.alergias) + '">', 'campo-cheio') +
      campo('Problemas / comorbidades', '<textarea class="textarea" name="problemas" rows="3">' + e(p.problemas) + '</textarea>') +
      campo('Medicações em uso', '<textarea class="textarea" name="meds" rows="3" placeholder="Uma por linha">' + e(p.meds) + '</textarea>') +
      campo('Observações', '<textarea class="textarea" name="obs" rows="2">' + e(p.obs) + '</textarea>', 'campo-cheio') +
      '</div><h3 class="pac-form-secao">Consentimentos</h3><p class="ajuda">Desligados por padrão. Ao ligar, a data é registrada automaticamente.</p><div class="pac-consents">' +
      CONSENTS.map(function (k) {
        var c = p.consentimentos[k[0]];
        return '<div class="pac-consent"><label class="campo-linha"><input type="checkbox" name="cons_' + k[0] + '"' + (c.ativo ? ' checked' : '') + '><span>' + e(k[1]) + '</span></label>' +
          '<select class="select" name="consorig_' + k[0] + '" aria-label="Origem do consentimento">' + opcoes(CONSENT_ORIGENS, c.origem) + '</select>' +
          '<small class="ajuda">' + (c.ativo && c.em ? 'desde ' + e(CL.fmt.data(CL.util.ymd(new Date(c.em)))) : 'sem registro') + '</small></div>';
      }).join('') + '</div>';
    var cpfEl = form.querySelector('[name="cpf"]'), foneEl = form.querySelector('[name="fone"]');
    cpfEl.addEventListener('input', function () { cpfEl.value = mascaraCpf(cpfEl.value); form.querySelector('[data-erro="cpf"]').hidden = true; });
    foneEl.addEventListener('input', function () { foneEl.value = mascaraFone(foneEl.value); });
    form.querySelector('[name="nome"]').addEventListener('input', function () { form.querySelector('[data-erro="nome"]').hidden = true; });

    function coletar() {
      var g = function (n) { var el = form.querySelector('[name="' + n + '"]'); return el ? String(el.value || '').trim() : ''; };
      var d = {
        nome: g('nome'), nomeSocial: g('nomeSocial'), nasc: g('nasc'), sexo: g('sexo'), cpf: CL.util.digits(g('cpf')),
        nomeMae: g('nomeMae'), naturalidade: g('naturalidade'), fone: CL.util.digits(g('fone')), email: g('email'), endereco: g('endereco'),
        convenioId: g('convenioId') || 'particular', convenioNumero: g('convenioNumero'), origem: g('origem'),
        alergias: g('alergias'), problemas: g('problemas'), meds: g('meds'), obs: g('obs')
      };
      var cons = p.consentimentos;
      CONSENTS.forEach(function (k) {
        var chk = form.querySelector('[name="cons_' + k[0] + '"]').checked;
        var orig = g('consorig_' + k[0]);
        var atualC = cons[k[0]];
        if (chk && !atualC.ativo) cons[k[0]] = { ativo: true, em: Date.now(), origem: orig };
        else if (!chk && atualC.ativo) cons[k[0]] = { ativo: false, em: null, origem: '' };
        else cons[k[0]].origem = orig;
      });
      d.consentimentos = cons;
      return d;
    }
    function validar(d) {
      var ok = true;
      if (!d.nome) { form.querySelector('[data-erro="nome"]').hidden = false; form.querySelector('[name="nome"]').focus(); ok = false; }
      if (d.cpf && !cpfValido(d.cpf)) { form.querySelector('[data-erro="cpf"]').hidden = false; if (ok) form.querySelector('[name="cpf"]').focus(); ok = false; }
      return ok;
    }
    function salvar() {
      var d = coletar();
      if (!validar(d)) return false;
      var faltando = [];
      if (!d.nasc) faltando.push('nascimento');
      if (!d.cpf) faltando.push('CPF');
      if (!d.fone) faltando.push('telefone');
      var obj = normalizarPaciente(atual ? Object.assign({}, atual) : {});
      Object.assign(obj, d);
      var salvo = CL.upsert('pacientes', obj);
      CL.ui.toast(atual ? 'Ficha atualizada' : 'Paciente cadastrado', { kind: 'ok' });
      if (faltando.length) CL.ui.toast('Faltam na ficha: ' + faltando.join(', '), { kind: 'aviso' });
      if (typeof o.aoSalvar === 'function') { try { o.aoSalvar(salvo); } catch (err) { console.error(err); } }
      return salvo;
    }
    var m = CL.ui.modal({
      titulo: atual ? 'Editar paciente' : 'Novo paciente',
      corpo: form, largo: true,
      botoes: [
        { rotulo: 'Cancelar', tipo: 'neutro' },
        { rotulo: 'Salvar', tipo: 'primario', icone: 'ti-device-floppy', acao: function () { return salvar() ? undefined : false; } }
      ]
    });
    form.addEventListener('submit', function (ev) { ev.preventDefault(); if (salvar()) m.fechar({ motivo: 'salvar' }); });
    form.addEventListener('keydown', function (ev) { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); if (salvar()) m.fechar({ motivo: 'salvar' }); } });
    return m;
  }

  /* =================== inativar / reativar =================== */
  function inativar(id, motivo) {
    var p = pac(id);
    if (!p) return Promise.resolve(false);
    return CL.ui.confirmar({
      titulo: 'Inativar paciente',
      texto: 'A ficha some das listas e da busca, mas nada é apagado: o prontuário fica guardado e o paciente pode ser reativado em Ajustes › Dados.',
      ok: 'Inativar', okTipo: 'perigo'
    }).then(function (ok) {
      if (!ok) return false;
      CL.patch('pacientes', id, { ativo: false, inativadoEm: Date.now(), inativadoMotivo: motivo || '' });
      CL.ui.toast('Paciente inativado', { kind: 'ok', action: { rotulo: 'Desfazer', fn: function () { reativar(id); } } });
      return true;
    });
  }
  function reativar(id) {
    if (!pac(id)) return false;
    CL.patch('pacientes', id, { ativo: true, inativadoEm: null });
    CL.ui.toast('Paciente reativado', { kind: 'ok' });
    return true;
  }

  /* =================== LGPD =================== */
  function dadosDoPaciente(id) {
    var p = pac(id);
    if (!p) return null;
    var clinico = CL.can('clinico');
    var filtro = function (col) { return CL.col(col).filter(function (x) { return x && x.pacId === id; }); };
    var d = { paciente: p, consultas: filtro('consultas'), lancamentos: filtro('lancamentos') };
    if (clinico) { d.evolucoes = filtro('evolucoes'); d.receitas = filtro('receitas'); d.documentos = filtro('documentos'); d.exames = filtro('exames'); }
    return d;
  }
  function htmlCopia(d) {
    var p = d.paciente;
    var linha = function (r, v) { return v ? '<p><strong>' + e(r) + ':</strong> ' + e(v) + '</p>' : ''; };
    var h = '<h2>Dados cadastrais</h2>' + linha('Nome', p.nome) + linha('Nome social', p.nomeSocial) + linha('Nascimento', CL.fmt.data(p.nasc)) +
      linha('Sexo', SEXO[p.sexo]) + linha('CPF', CL.fmt.cpf(p.cpf)) + linha('Nome da mãe', p.nomeMae) + linha('Naturalidade', p.naturalidade) +
      linha('Telefone', CL.fmt.fone(p.fone)) + linha('E-mail', p.email) + linha('Endereço', p.endereco) +
      linha('Convênio', convNome(p.convenioId) + (p.convenioNumero ? ' · ' + p.convenioNumero : '')) +
      linha('Alergias', p.alergias) + linha('Problemas', p.problemas) + linha('Medicações', p.meds) + linha('Observações', p.obs);
    h += '<h2>Consentimentos</h2>' + CONSENTS.map(function (k) { var c = p.consentimentos[k[0]] || {}; return '<p>' + e(k[1]) + ': ' + (c.ativo ? 'sim, desde ' + e(CL.fmt.data(CL.util.ymd(new Date(c.em || Date.now())))) + (c.origem ? ' (' + e(c.origem) + ')' : '') : 'não') + '</p>'; }).join('');
    h += '<h2>Consultas (' + d.consultas.length + ')</h2>' + (d.consultas.length ? '<ul>' + d.consultas.slice().sort(function (a, b) { return (b.data + b.hora).localeCompare(a.data + a.hora); }).map(function (c) {
      return '<li>' + e(CL.fmt.data(c.data)) + ' ' + e(c.hora) + ' · ' + e(procNome(c.procId) || 'Consulta') + ' · ' + e(profNome(c.profId)) + ' · ' + e((CL.STATUS[c.status] || {}).rotulo || c.status) + '</li>';
    }).join('') + '</ul>' : '<p>Nenhuma.</p>');
    if (d.evolucoes) {
      h += '<h2>Evoluções (' + d.evolucoes.length + ')</h2>' + d.evolucoes.map(function (r) { return '<p><strong>' + e(CL.fmt.dataHora(Date.parse(r.data) || r.createdAt)) + ' — ' + e(r.titulo || 'Evolução') + '</strong></p><pre class="doc-pre">' + e(r.texto) + '</pre>'; }).join('');
      h += '<h2>Receitas (' + d.receitas.length + ')</h2>' + d.receitas.map(function (r) { return '<p><strong>' + e(CL.fmt.dataHora(Date.parse(r.data) || r.createdAt)) + '</strong></p><ul>' + (r.itens || []).map(function (it) { return '<li>' + e(it.nome) + (it.pos ? ' — ' + e(it.pos) : '') + '</li>'; }).join('') + '</ul>'; }).join('');
      h += '<h2>Documentos (' + d.documentos.length + ')</h2>' + d.documentos.map(function (r) { return '<p><strong>' + e(CL.fmt.dataHora(Date.parse(r.data) || r.createdAt)) + ' — ' + e(r.titulo || r.tipo) + '</strong></p><pre class="doc-pre">' + e(r.texto) + '</pre>'; }).join('');
      h += '<h2>Exames (' + d.exames.length + ')</h2>' + (d.exames.length ? '<ul>' + d.exames.map(function (x) { return '<li>' + e(CL.fmt.data(x.data)) + ' · ' + e(x.nome) + ': ' + e(String(x.valor).replace('.', ',')) + ' ' + e(x.unidade || '') + '</li>'; }).join('') + '</ul>' : '<p>Nenhum.</p>');
    } else {
      h += '<p><em>O conteúdo clínico não foi incluído: a cópia foi gerada por um perfil sem acesso ao prontuário.</em></p>';
    }
    h += '<h2>Compartilhamentos registrados</h2>' + (p.lgpd.compartilhamentos.length ? '<ul>' + p.lgpd.compartilhamentos.map(function (c) { return '<li>' + e(CL.fmt.dataHora(c.em)) + ' · ' + e(c.tipo) + (c.alvo ? ' · ' + e(c.alvo) : '') + '</li>'; }).join('') + '</ul>' : '<p>Nenhum.</p>');
    return h;
  }
  var lgpd = {
    exportar: function (id) {
      var d = dadosDoPaciente(id);
      if (!d) return Promise.resolve(false);
      var p = d.paciente;
      var json = JSON.stringify({ app: 'clinicar', tipo: 'copia-paciente', versao: 1, exportadoEm: new Date().toISOString(), dados: d }, null, 2);
      CL.util.baixar('clinicar-paciente-' + CL.util.hoje() + '.json', json, 'application/json');
      CL.audit('paciente.exportar', 'pacientes', id, { pacId: id });
      registrarCompartilhamento(id, 'exportacao', 'cópia dos dados');
      return CL.print.documento({ titulo: 'Cópia dos dados do paciente', corpoHtml: htmlCopia(d), paciente: p, profissional: profissionalAtual(), tipoDoc: 'documento', semAssinatura: true, documentoId: id });
    },
    registrarPedido: function (id, tipo, obs) {
      var p = pac(id);
      if (!p) return null;
      normalizarPaciente(p);
      var pedido = { em: Date.now(), tipo: tipo || 'eliminacao', status: 'aberto', obs: obs || '', prazo: Date.now() + PRAZO_LGPD_DIAS * 86400000 };
      p.lgpd.pedidos.push(pedido);
      CL.patch('pacientes', id, { lgpd: p.lgpd });
      CL.audit('lgpd.pedido', 'pacientes', id, { pacId: id, tipo: pedido.tipo });
      return pedido;
    },
    atenderPedido: function (id, idx) {
      var p = pac(id);
      if (!p || !p.lgpd || !p.lgpd.pedidos[idx]) return false;
      p.lgpd.pedidos[idx].status = 'atendido';
      p.lgpd.pedidos[idx].atendidoEm = Date.now();
      CL.patch('pacientes', id, { lgpd: p.lgpd });
      return true;
    },
    compartilhamentos: function (id) { var p = pac(id); return p && p.lgpd && Array.isArray(p.lgpd.compartilhamentos) ? p.lgpd.compartilhamentos.slice().reverse() : []; },
    pedidosAbertos: function () {
      var lista = [];
      CL.col('pacientes').forEach(function (p) {
        if (!p || !p.lgpd || !Array.isArray(p.lgpd.pedidos)) return;
        p.lgpd.pedidos.forEach(function (pd, i) { if (pd.status === 'aberto') lista.push({ pacId: p.id, idx: i, tipo: pd.tipo, em: pd.em, prazo: pd.prazo || (pd.em + PRAZO_LGPD_DIAS * 86400000) }); });
      });
      return lista.sort(function (a, b) { return a.prazo - b.prazo; });
    }
  };
  function abrirPedidoEliminacao(id) {
    var corpo = document.createElement('div');
    corpo.className = 'pilha';
    corpo.innerHTML = '<p class="prosa">O prontuário clínico fica guardado por 20 anos por obrigação legal; o pedido fica registrado e a clínica tem ' + PRAZO_LGPD_DIAS + ' dias para responder ao paciente.</p>' +
      '<div class="campo"><label class="campo-rotulo" for="lgpd-obs">Observação (opcional)</label><textarea id="lgpd-obs" class="textarea" rows="3" placeholder="Como o pedido foi feito, canal, detalhes"></textarea></div>';
    CL.ui.modal({
      titulo: 'Registrar pedido de eliminação', corpo: corpo,
      botoes: [
        { rotulo: 'Cancelar', tipo: 'neutro' },
        { rotulo: 'Registrar pedido', tipo: 'primario', acao: function (ctx) { lgpd.registrarPedido(id, 'eliminacao', ctx.el.querySelector('#lgpd-obs').value.trim()); CL.ui.toast('Pedido registrado — prazo de ' + PRAZO_LGPD_DIAS + ' dias', { kind: 'ok' }); } }
      ]
    });
  }

  /* =================== WhatsApp da ficha =================== */
  function abrirWhatsapp(id) {
    var p = pac(id);
    if (!p) return;
    var corpo = document.createElement('div');
    corpo.className = 'pilha';
    var cl = (CL.state.cfg && CL.state.cfg.clinica) || {};
    var texto = 'Olá, ' + CL.util.primeiroNome(p.nome) + '!' + (cl.nome ? ' Aqui é da ' + cl.nome + '.' : '');
    corpo.innerHTML = '<div class="campo"><label class="campo-rotulo" for="wa-fone">Telefone</label><input id="wa-fone" class="input" type="tel" inputmode="tel" autocomplete="off" value="' + e(CL.fmt.fone(p.fone)) + '"></div>' +
      '<div class="campo"><label class="campo-rotulo" for="wa-texto">Mensagem</label><textarea id="wa-texto" class="textarea" rows="4">' + e(texto) + '</textarea></div>' +
      '<p class="ajuda">Nada é enviado automaticamente — o WhatsApp abre com o texto pronto para você revisar.</p>';
    CL.ui.modal({
      titulo: 'WhatsApp', corpo: corpo,
      botoes: [
        { rotulo: 'Cancelar', tipo: 'neutro' },
        { rotulo: 'Abrir no WhatsApp', tipo: 'primario', icone: 'ti-brand-whatsapp', acao: function (ctx) {
          var fone = CL.util.digits(ctx.el.querySelector('#wa-fone').value);
          if (fone.length < 10) { CL.ui.toast('Informe um telefone com DDD', { kind: 'erro' }); return false; }
          if (!p.fone) CL.patch('pacientes', id, { fone: fone });
          var num = fone.slice(0, 2) === '55' && fone.length > 11 ? fone : '55' + fone;
          var msg = ctx.el.querySelector('#wa-texto').value;
          registrarCompartilhamento(id, 'whatsapp', 'mensagem');
          window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
        } }
      ]
    });
  }

  /* =================== impressão da ficha =================== */
  function imprimirFicha(id) {
    var p = pac(id);
    if (!p) return;
    var linha = function (r, v) { return v ? '<p><strong>' + e(r) + ':</strong> ' + e(v) + '</p>' : ''; };
    var h = linha('Nome social', p.nomeSocial) + linha('Sexo', SEXO[p.sexo]) + linha('Nome da mãe', p.nomeMae) + linha('Naturalidade', p.naturalidade) +
      linha('Telefone', CL.fmt.fone(p.fone)) + linha('E-mail', p.email) + linha('Endereço', p.endereco) +
      linha('Convênio', convNome(p.convenioId) + (p.convenioNumero ? ' · carteira ' + p.convenioNumero : ''));
    if (CL.can('clinico')) h += linha('Alergias', p.alergias) + linha('Problemas', p.problemas) + linha('Medicações em uso', p.meds) + linha('Observações', p.obs);
    var u = ultimaConsulta(id), n = proximaConsulta(id);
    h += linha('Última consulta', u ? CL.fmt.data(u.data) + ' ' + u.hora + ' · ' + profNome(u.profId) : '') + linha('Próxima consulta', n ? CL.fmt.data(n.data) + ' ' + n.hora + ' · ' + profNome(n.profId) : '');
    CL.print.documento({ titulo: 'Ficha do paciente', corpoHtml: h, paciente: p, profissional: profissionalAtual(), tipoDoc: 'documento', semAssinatura: true, documentoId: id });
  }

  /* =================== lista =================== */
  function renderLista(el) {
    vista.modo = 'lista';
    var total = CL.col('pacientes').filter(function (p) { return p && p.ativo !== false; }).length;
    el.innerHTML = '<div class="tela pac-tela">' +
      '<div class="tela-cabeca"><h1>Pacientes</h1><span class="texto-3 tnum" id="pac-contador"></span>' +
      '<button type="button" class="btn btn-primario" data-acao="novo"><i class="ti ti-user-plus" aria-hidden="true"></i>Novo paciente</button></div>' +
      '<div class="pac-filtros"><div class="busca pac-busca"><i class="ti ti-search" aria-hidden="true"></i><input class="input" id="pac-busca" type="search" placeholder="Nome, CPF, telefone ou nascimento" aria-label="Buscar paciente"></div>' +
      '<div class="segmentado" role="group" aria-label="Filtro"><button type="button" data-filtro="ativos" aria-pressed="true">Ativos</button><button type="button" data-filtro="inativos" aria-pressed="false">Inativos</button></div>' +
      '<label class="pac-ordem"><span class="rotulo">Ordenar</span><select class="select" id="pac-ordem" aria-label="Ordenar por"><option value="nome">Nome</option><option value="ultima">Última consulta</option><option value="cadastro">Cadastro recente</option></select></label></div>' +
      '<div id="pac-tabela"></div></div>';
    var busca = el.querySelector('#pac-busca');
    CL.util.semAutofill(busca);
    busca.value = vista.q;
    var deb = CL.util.debounce(function () { vista.q = CL.util.valorBusca(busca); renderTabela(el); }, 120);
    busca.addEventListener('input', deb);
    busca.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { var primeiro = el.querySelector('#pac-tabela a.pac-nome'); if (primeiro) { ev.preventDefault(); primeiro.click(); } }
    });
    Array.prototype.forEach.call(el.querySelectorAll('[data-filtro]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-filtro') === vista.filtro ? 'true' : 'false'); });
    var ord = el.querySelector('#pac-ordem');
    ord.value = vista.ordem;
    ord.addEventListener('change', function () { vista.ordem = ord.value; renderTabela(el); });
    renderTabela(el);
    if (vista.q) busca.focus();
  }
  function renderTabela(el) {
    var box = el.querySelector('#pac-tabela');
    var cont = el.querySelector('#pac-contador');
    if (!box) return;
    var totalAtivos = CL.col('pacientes').filter(function (p) { return p && p.ativo !== false; }).length;
    var lista = buscar(vista.q, { limite: 0, inativos: vista.filtro === 'inativos', ordem: vista.ordem });
    if (cont) cont.textContent = lista.length === 1 ? '1 paciente' : lista.length + ' pacientes';
    if (!lista.length) {
      if (!totalAtivos && vista.filtro === 'ativos' && !vista.q) {
        CL.ui.vazio(box, { icone: 'ti-users', titulo: 'Cadastre o primeiro paciente', texto: 'A ficha guarda contato, convênio, alergias e o histórico de consultas.', acao: { rotulo: 'Novo paciente', icone: 'ti-user-plus', fn: function () { abrirForm(null, { aoSalvar: function (p) { abrirFicha(p.id); } }); } } });
      } else if (vista.filtro === 'inativos' && !vista.q) {
        CL.ui.vazio(box, { icone: 'ti-archive', titulo: 'Nenhum paciente inativo', texto: 'Pacientes inativados aparecem aqui e podem ser reativados.' });
      } else {
        var q = vista.q;
        CL.ui.vazio(box, { icone: 'ti-search-off', titulo: 'Nenhum paciente encontrado', texto: 'Tente outro nome, parte do CPF ou do telefone.', acao: { rotulo: 'Cadastrar "' + q.slice(0, 40) + '"', icone: 'ti-user-plus', fn: function () { abrirForm(null, { inicial: /\d/.test(q) ? {} : { nome: q }, aoSalvar: function (p) { abrirFicha(p.id); } }); } } });
      }
      return;
    }
    var h = '<div class="tabela-wrap tabela-cartoes"><table class="tabela pac-tabela"><thead><tr><th>Nome</th><th>Nascimento</th><th>Telefone</th><th>Convênio</th><th>Última consulta</th><th class="num">Faltas</th><th class="acoes"><span class="sr-only">Ações</span></th></tr></thead><tbody>';
    lista.forEach(function (p) {
      var u = ultimaConsulta(p.id);
      var f = faltas(p.id);
      var idade = CL.fmt.idade(p.nasc);
      h += '<tr data-id="' + e(p.id) + '">' +
        '<td data-rotulo="Nome"><a class="pac-nome nome-paciente" href="#/pacientes/' + e(p.id) + '">' + e(CL.nomeExibido(p.nome)) + '</a>' + (p.nomeSocial && !(CL.session && CL.session.privacidade) ? ' <span class="texto-3">(' + e(p.nomeSocial) + ')</span>' : '') + ' ' + selo(p.id) + '</td>' +
        '<td data-rotulo="Nascimento" class="tnum">' + (p.nasc ? e(CL.fmt.data(p.nasc)) + (idade ? ' <span class="texto-3">· ' + e(idade) + '</span>' : '') : '<span class="texto-3">—</span>') + '</td>' +
        '<td data-rotulo="Telefone" class="tnum">' + (p.fone ? e(CL.fmt.fone(p.fone)) : '<span class="texto-3">—</span>') + '</td>' +
        '<td data-rotulo="Convênio">' + e(convNome(p.convenioId)) + '</td>' +
        '<td data-rotulo="Última consulta" class="tnum">' + (u ? e(CL.fmt.data(u.data)) : '<span class="texto-3">—</span>') + '</td>' +
        '<td data-rotulo="Faltas" class="num">' + (f.faltas + f.tardios) + '</td>' +
        '<td class="acoes"><button type="button" class="btn btn-icone btn-fantasma" data-acao="agendar" data-id="' + e(p.id) + '" aria-label="Agendar consulta" title="Agendar"><i class="ti ti-calendar-plus" aria-hidden="true"></i></button>' +
        '<a class="btn btn-neutro btn-pequeno" href="#/pacientes/' + e(p.id) + '">Ficha</a></td></tr>';
    });
    h += '</tbody></table></div>';
    box.innerHTML = h;
  }

  /* =================== ficha =================== */
  function abaLink(id, aba, ativa) {
    var a = ABAS.filter(function (x) { return x[0] === aba; })[0];
    var clinica = CLINICAS.indexOf(aba) >= 0 && !CL.can('clinico');
    return '<a href="#/pacientes/' + e(id) + '/' + aba + '" role="tab" aria-selected="' + (ativa ? 'true' : 'false') + '"' + (ativa ? ' aria-current="page"' : '') + '><i class="ti ' + (clinica ? 'ti-lock' : a[2]) + '" aria-hidden="true"></i><span>' + e(a[1]) + '</span></a>';
  }
  function renderFicha(el) {
    vista.modo = 'ficha';
    var p = pac(vista.pacId);
    if (!p) {
      CL.ui.erro(el, { texto: 'Este paciente não foi encontrado.', acao: { rotulo: 'Ver pacientes', fn: function () { CL.route.go('#/pacientes'); } } });
      return;
    }
    normalizarPaciente(p);
    var priv = !!(CL.session && CL.session.privacidade);
    var idade = CL.fmt.idade(p.nasc);
    var meta = [];
    if (idade) meta.push(idade);
    if (p.sexo) meta.push(SEXO[p.sexo]);
    if (p.nasc) meta.push('nascido(a) em ' + CL.fmt.data(p.nasc));
    var iaOk = window.Backend && Backend.ai && Backend.ai.disponivel() && CL.can('clinico');
    el.innerHTML = '<div class="tela pac-ficha">' +
      '<div class="pac-voltar"><a href="#/pacientes" class="btn btn-fantasma btn-pequeno"><i class="ti ti-arrow-left" aria-hidden="true"></i>Pacientes</a></div>' +
      '<header class="pac-cabeca card"><div class="avatar avatar-lg" aria-hidden="true">' + e(CL.util.iniciais(p.nome) || '--') + '</div>' +
      '<div class="pac-cabeca-info"><h1 class="nome-paciente">' + e(CL.nomeExibido(p.nome)) + '</h1>' +
      (p.nomeSocial && !priv ? '<div class="pac-social">' + e(p.nomeSocial) + ' <span class="texto-3">(nome social)</span></div>' : '') +
      '<div class="pac-meta texto-2">' + e(meta.join(' · ')) + '</div>' +
      '<div class="pac-meta texto-2">' +
      (p.fone ? '<a href="tel:+55' + e(CL.util.digits(p.fone)) + '" class="tnum">' + e(CL.fmt.fone(p.fone)) + '</a>' : '<span class="texto-3">sem telefone</span>') +
      ' · ' + e(convNome(p.convenioId)) + (p.convenioNumero ? ' <span class="tnum">' + e(p.convenioNumero) + '</span>' : '') +
      (p.cpf && !priv ? ' · CPF <span class="tnum">' + e(CL.fmt.cpf(p.cpf)) + '</span>' : '') + '</div>' +
      '<div class="pac-selos">' + selo(p.id) + '</div></div>' +
      '<div class="pac-acoes"><button type="button" class="btn btn-neutro" data-acao="editar"><i class="ti ti-pencil" aria-hidden="true"></i>Editar</button>' +
      '<button type="button" class="btn btn-primario" data-acao="agendar"><i class="ti ti-calendar-plus" aria-hidden="true"></i>Agendar</button>' +
      '<button type="button" class="btn btn-neutro" data-acao="whatsapp"><i class="ti ti-brand-whatsapp" aria-hidden="true"></i>WhatsApp</button>' +
      (iaOk ? '<button type="button" class="btn btn-neutro" data-acao="resumo-ia"><i class="ti ti-sparkles" aria-hidden="true"></i>Resumo IA</button>' : '') +
      '<button type="button" class="btn btn-icone btn-neutro" data-acao="menu" aria-label="Mais ações" aria-haspopup="menu"><i class="ti ti-dots" aria-hidden="true"></i></button></div></header>' +
      '<nav class="pac-abas" role="tablist" aria-label="Seções da ficha">' + ABAS.map(function (a) { return abaLink(p.id, a[0], a[0] === vista.aba); }).join('') + '</nav>' +
      '<section class="pac-aba" id="pac-aba" role="tabpanel"></section></div>';
    renderAba(el.querySelector('#pac-aba'), p);
  }
  function renderAba(box, p) {
    var aba = vista.aba;
    if (CLINICAS.indexOf(aba) >= 0) {
      if (!CL.can('clinico')) { box.innerHTML = '<div class="cadeado"><i class="ti ti-lock" aria-hidden="true"></i>Conteúdo clínico — perfil profissional</div>'; return; }
      if (window.Atendimento && typeof Atendimento.abrirAba === 'function') Atendimento.abrirAba(p.id, aba, box);
      else box.innerHTML = '<div class="cadeado"><i class="ti ti-tool" aria-hidden="true"></i>O prontuário ainda não está disponível nesta versão.</div>';
      return;
    }
    if (aba === 'consultas') return renderConsultas(box, p);
    if (aba === 'financeiro') return renderFinanceiro(box, p);
    if (aba === 'privacidade') return renderPrivacidade(box, p);
    return renderResumo(box, p);
  }
  function bloco(titulo, conteudo, icone) {
    return '<div class="card"><div class="card-titulo">' + (icone ? '<i class="ti ' + icone + '" aria-hidden="true"></i>' : '') + e(titulo) + '</div>' + conteudo + '</div>';
  }
  function pre(texto, vazio) { return texto ? '<div class="pac-pre">' + e(texto) + '</div>' : '<p class="texto-3">' + e(vazio || 'Nada registrado') + '</p>'; }
  function consultaLinha(c) {
    if (!c) return '<p class="texto-3">Nenhuma</p>';
    return '<p><span class="tnum">' + e(CL.fmt.data(c.data)) + ' ' + e(c.hora) + '</span> · ' + e(procNome(c.procId) || 'Consulta') + (profNome(c.profId) ? ' · ' + e(profNome(c.profId)) : '') + ' ' + CL.chipStatus(c.status) + '</p>';
  }
  function renderResumo(box, p) {
    var clinico = CL.can('clinico');
    var f = faltas(p.id);
    var h = '<div class="pac-grade">';
    if (clinico) {
      h += bloco('Alergias', p.alergias ? '<div class="aviso-inline is-erro"><i class="ti ti-alert-triangle" aria-hidden="true"></i><span>' + e(p.alergias) + '</span></div>' : '<p class="texto-3">Nenhuma alergia registrada</p>', 'ti-alert-triangle');
      h += bloco('Problemas / comorbidades', pre(p.problemas), 'ti-clipboard-heart');
      h += bloco('Medicações em uso', pre(p.meds), 'ti-pill');
      h += bloco('Observações', pre(p.obs), 'ti-note');
    } else {
      h += bloco('Clínico', '<div class="cadeado"><i class="ti ti-lock" aria-hidden="true"></i>Conteúdo clínico — perfil profissional</div>', 'ti-lock');
    }
    h += bloco('Consultas', '<p class="rotulo">Última</p>' + consultaLinha(ultimaConsulta(p.id)) + '<p class="rotulo" style="margin-top:8px">Próxima</p>' + consultaLinha(proximaConsulta(p.id)) +
      '<p class="ajuda" style="margin-top:8px">' + f.faltas + ' falta(s) e ' + f.tardios + ' cancelamento(s) tardio(s) em 12 meses</p>', 'ti-calendar');
    h += bloco('Consentimentos', '<ul class="lista-simples">' + CONSENTS.map(function (k) {
      var c = p.consentimentos[k[0]] || {};
      return '<li><i class="ti ' + (c.ativo ? 'ti-circle-check' : 'ti-circle-off') + '" aria-hidden="true" style="color:' + (c.ativo ? 'var(--ok)' : 'var(--tinta-3)') + '"></i><span style="flex:1">' + e(k[1]) + '</span><small class="texto-3">' + (c.ativo ? 'desde ' + e(CL.fmt.data(CL.util.ymd(new Date(c.em || Date.now())))) + (c.origem ? ' · ' + e(c.origem) : '') : 'não') + '</small></li>';
    }).join('') + '</ul>', 'ti-checkbox');
    var cad = [];
    if (p.nomeMae) cad.push(['Nome da mãe', p.nomeMae]);
    if (p.naturalidade) cad.push(['Naturalidade', p.naturalidade]);
    if (p.email) cad.push(['E-mail', p.email]);
    if (p.endereco) cad.push(['Endereço', p.endereco]);
    if (p.origem) cad.push(['Origem', (ORIGENS.filter(function (o) { return o[0] === p.origem; })[0] || [0, p.origem])[1]]);
    cad.push(['Cadastro', CL.fmt.data(CL.util.ymd(new Date(p.createdAt || Date.now())))]);
    h += bloco('Cadastro', '<dl class="pac-dl">' + cad.map(function (x) { return '<div><dt class="rotulo">' + e(x[0]) + '</dt><dd>' + e(x[1]) + '</dd></div>'; }).join('') + '</dl>', 'ti-id');
    h += '</div>';
    box.innerHTML = h;
  }
  function renderConsultas(box, p) {
    var lista = consultasDe(p.id);
    var h = '<div class="linha-acoes pac-aba-acoes"><span class="texto-3 tnum">' + lista.length + ' consulta(s)</span><span style="flex:1"></span><button type="button" class="btn btn-primario" data-acao="agendar"><i class="ti ti-calendar-plus" aria-hidden="true"></i>Agendar</button></div>';
    if (!lista.length) {
      box.innerHTML = h;
      var v = document.createElement('div');
      box.appendChild(v);
      CL.ui.vazio(v, { icone: 'ti-calendar', titulo: 'Nenhuma consulta', texto: 'Marque a primeira consulta deste paciente na agenda.', acao: { rotulo: 'Agendar', icone: 'ti-calendar-plus', fn: function () { agendar(p.id); } } });
      return;
    }
    h += '<div class="tabela-wrap tabela-cartoes"><table class="tabela"><thead><tr><th>Data</th><th>Hora</th><th>Profissional</th><th>Procedimento</th><th>Status</th><th>Observação</th></tr></thead><tbody>';
    lista.forEach(function (c) {
      h += '<tr data-consulta="' + e(c.id) + '"><td data-rotulo="Data" class="tnum">' + e(CL.fmt.dataExtenso(c.data, true)) + '</td><td data-rotulo="Hora" class="tnum">' + e(c.hora) + '</td><td data-rotulo="Profissional">' + e(profNome(c.profId) || '—') + '</td><td data-rotulo="Procedimento">' + e(procNome(c.procId) || '—') + (c.encaixe ? ' <span class="chip">encaixe</span>' : '') + '</td><td data-rotulo="Status">' + CL.chipStatus(c.status) + '</td><td data-rotulo="Observação" class="pac-obs">' + e(c.obs || '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    box.innerHTML = h;
  }
  function renderFinanceiro(box, p) {
    var lista = (window.Financeiro && typeof Financeiro.extrato === 'function') ? Financeiro.extrato(p.id) : CL.col('lancamentos').filter(function (l) { return l && l.pacId === p.id; });
    lista = (lista || []).slice().sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); });
    var FORMAS = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito', convenio: 'Convênio', outro: 'Outro', '': '—' };
    var rec = 0, pend = 0;
    lista.forEach(function (l) { if (l.tipo === 'despesa') return; if (l.status === 'recebido') rec += (l.valorCent - (l.descontoCent || 0)); else if (l.status === 'pendente') pend += (l.valorCent - (l.descontoCent || 0)); });
    var h = '<div class="grade-cards pac-kpis"><div class="card kpi"><span class="kpi-numero">' + e(CL.fmt.dinheiro(rec)) + '</span><span class="kpi-rotulo">Recebido</span></div><div class="card kpi"><span class="kpi-numero">' + e(CL.fmt.dinheiro(pend)) + '</span><span class="kpi-rotulo">Pendente</span></div></div>';
    if (!lista.length) {
      box.innerHTML = h;
      var v = document.createElement('div'); box.appendChild(v);
      CL.ui.vazio(v, { icone: 'ti-cash', titulo: 'Sem lançamentos', texto: 'Os lançamentos nascem ao finalizar uma consulta com valor.' });
      return;
    }
    h += '<div class="tabela-wrap tabela-cartoes"><table class="tabela"><thead><tr><th>Data</th><th>Descrição</th><th>Forma</th><th class="num">Valor</th><th>Status</th></tr></thead><tbody>';
    lista.forEach(function (l) {
      var cls = l.status === 'recebido' ? 'chip-ok' : l.status === 'cancelado' ? '' : 'chip-aviso';
      var rot = l.status === 'recebido' ? 'Recebido' : l.status === 'cancelado' ? 'Cancelado' : 'Pendente';
      h += '<tr><td data-rotulo="Data" class="tnum">' + e(CL.fmt.data(l.data)) + '</td><td data-rotulo="Descrição">' + e(l.descricao || procNome(l.procId) || (l.tipo === 'despesa' ? 'Despesa' : 'Receita')) + '</td><td data-rotulo="Forma">' + e(FORMAS[l.forma] || l.forma || '—') + '</td><td data-rotulo="Valor" class="num">' + e(CL.fmt.dinheiro(l.valorCent - (l.descontoCent || 0))) + '</td><td data-rotulo="Status"><span class="chip ' + cls + '">' + rot + '</span></td></tr>';
    });
    h += '</tbody></table></div>';
    box.innerHTML = h;
  }
  function renderPrivacidade(box, p) {
    var pedidos = p.lgpd.pedidos.slice().map(function (pd, i) { pd._i = i; return pd; }).reverse();
    var comp = lgpd.compartilhamentos(p.id);
    var acessos = CL.col('auditoria').filter(function (a) { return a && (a.pacId === p.id || (a.alvo === 'pacientes' && a.alvoId === p.id)); }).sort(function (a, b) { return b.em - a.em; }).slice(0, 50);
    var admin = CL.session && CL.session.perfil === 'admin';
    var h = '<div class="pac-grade">';
    h += bloco('Direitos do paciente', '<div class="linha-acoes"><button type="button" class="btn btn-neutro" data-acao="lgpd-exportar"><i class="ti ti-download" aria-hidden="true"></i>Exportar cópia</button>' +
      '<button type="button" class="btn btn-neutro" data-acao="editar"><i class="ti ti-pencil" aria-hidden="true"></i>Corrigir dados</button>' +
      '<button type="button" class="btn btn-neutro" data-acao="lgpd-eliminar"><i class="ti ti-trash" aria-hidden="true"></i>Pedir eliminação</button></div>' +
      '<p class="ajuda" style="margin-top:12px">O prontuário clínico fica guardado por 20 anos por obrigação legal; o pedido fica registrado e a clínica responde em até ' + PRAZO_LGPD_DIAS + ' dias.</p>', 'ti-shield-lock');
    h += bloco('Pedidos registrados', pedidos.length ? '<ul class="lista-simples">' + pedidos.map(function (pd) {
      var prazo = pd.prazo || (pd.em + PRAZO_LGPD_DIAS * 86400000);
      var dias = Math.ceil((prazo - Date.now()) / 86400000);
      var st = pd.status === 'atendido' ? '<span class="chip chip-ok">atendido</span>' : (dias < 0 ? '<span class="chip chip-erro">prazo vencido</span>' : '<span class="chip chip-aviso">' + dias + ' dia(s) restantes</span>');
      return '<li><span class="cresce"><strong>' + e({ eliminacao: 'Eliminação', correcao: 'Correção', copia: 'Cópia' }[pd.tipo] || pd.tipo) + '</strong> · <span class="tnum">' + e(CL.fmt.dataHora(pd.em)) + '</span>' + (pd.obs ? '<br><small class="texto-3">' + e(pd.obs) + '</small>' : '') + '</span>' + st +
        (admin && pd.status === 'aberto' ? '<button type="button" class="btn btn-neutro btn-pequeno" data-acao="lgpd-atender" data-idx="' + pd._i + '">Marcar atendido</button>' : '') + '</li>';
    }).join('') + '</ul>' : '<p class="texto-3">Nenhum pedido</p>', 'ti-mail');
    h += bloco('Compartilhamentos', comp.length ? '<ul class="lista-simples">' + comp.slice(0, 30).map(function (c) { return '<li><span class="tnum">' + e(CL.fmt.dataHora(c.em)) + '</span><span>' + e({ impressao: 'Impressão', exportacao: 'Exportação', whatsapp: 'WhatsApp' }[c.tipo] || c.tipo) + (c.alvo ? ' · ' + e(c.alvo) : '') + '</span></li>'; }).join('') + '</ul>' : '<p class="texto-3">Nenhum compartilhamento registrado</p>', 'ti-share');
    h += bloco('Histórico de acessos', acessos.length ? '<ul class="lista-simples">' + acessos.map(function (a) { return '<li><span class="tnum">' + e(CL.fmt.dataHora(a.em)) + '</span><span class="cresce">' + e(ACOES_AUDIT[a.acao] || a.acao) + '</span><small class="texto-3">' + e(a.usuario || '') + (a.perfil ? ' · ' + e(CL.fmt.perfil(a.perfil)) : '') + '</small></li>'; }).join('') + '</ul>' : '<p class="texto-3">Nenhum acesso registrado</p>', 'ti-history');
    h += '</div>';
    box.innerHTML = h;
  }

  /* =================== ações =================== */
  function agendar(pacId) {
    if (window.Agenda && typeof Agenda.abrirNova === 'function') Agenda.abrirNova({ pacId: pacId });
    else CL.ui.toast('A agenda ainda não está disponível nesta versão', { kind: 'aviso' });
  }
  function menuFicha(ancora, p) {
    var itens = [];
    itens.push({ rotulo: 'Dados do paciente (LGPD)', icone: 'ti-shield-lock', fn: function () { abrirFicha(p.id, 'privacidade'); } });
    itens.push({ rotulo: 'Imprimir ficha', icone: 'ti-printer', fn: function () { imprimirFicha(p.id); } });
    itens.push('-');
    if (p.ativo === false) itens.push({ rotulo: 'Reativar paciente', icone: 'ti-archive-off', fn: function () { reativar(p.id); } });
    else itens.push({ rotulo: 'Inativar paciente', icone: 'ti-archive', tipo: 'perigo', fn: function () { inativar(p.id); } });
    CL.ui.menu(ancora, itens);
  }
  function aoClicar(ev) {
    var b = ev.target.closest('[data-acao]');
    if (!b || !vista.el || !vista.el.contains(b)) return;
    var acao = b.getAttribute('data-acao');
    var id = b.getAttribute('data-id') || vista.pacId;
    var p = id ? pac(id) : null;
    if (acao === 'novo') abrirForm(null, { inicial: vista.q && !/\d/.test(vista.q) ? { nome: vista.q } : {}, aoSalvar: function (np) { abrirFicha(np.id); } });
    else if (acao === 'agendar') agendar(id);
    else if (acao === 'editar' && p) abrirForm(p.id, {});
    else if (acao === 'whatsapp' && p) abrirWhatsapp(p.id);
    else if (acao === 'menu' && p) menuFicha(b, p);
    else if (acao === 'resumo-ia' && p) { if (window.Atendimento && typeof Atendimento.abrirResumo === 'function') Atendimento.abrirResumo(p.id); }
    else if (acao === 'lgpd-exportar' && p) lgpd.exportar(p.id);
    else if (acao === 'lgpd-eliminar' && p) abrirPedidoEliminacao(p.id);
    else if (acao === 'lgpd-atender' && p) { lgpd.atenderPedido(p.id, +b.getAttribute('data-idx')); CL.ui.toast('Pedido marcado como atendido', { kind: 'ok' }); }
    var f = ev.target.closest('[data-filtro]');
    if (f && vista.el.contains(f)) {
      vista.filtro = f.getAttribute('data-filtro');
      Array.prototype.forEach.call(vista.el.querySelectorAll('[data-filtro]'), function (x) { x.setAttribute('aria-pressed', x === f ? 'true' : 'false'); });
      renderTabela(vista.el);
    }
  }
  function aoMudar(info) {
    if (!vista.el) return;
    var cols = ['pacientes', 'consultas', 'evolucoes', 'receitas', 'documentos', 'exames', 'lancamentos', 'auditoria', '*'];
    if (info && info.col && cols.indexOf(info.col) < 0) return;
    if (info && info.col === 'auditoria' && vista.aba !== 'privacidade') return;
    if (info && info.col === 'exames' && vista.aba === 'exames') return; /* a aba de exames se redesenha sozinha e mantém o foco */
    clearTimeout(vista.timer);
    vista.timer = setTimeout(function () {
      if (!vista.el) return;
      if (vista.modo === 'lista') renderTabela(vista.el);
      else if (vista.modo === 'ficha') {
        var p = pac(vista.pacId);
        if (!p) return;
        if (CLINICAS.indexOf(vista.aba) >= 0 && info && info.col !== 'pacientes' && info.col !== '*') {
          var box = vista.el.querySelector('#pac-aba');
          if (box) renderAba(box, p);
        } else renderFicha(vista.el);
      }
    }, 80);
  }
  function abrirFicha(id, aba) {
    CL.route.go('#/pacientes/' + encodeURIComponent(id) + (aba ? '/' + aba : ''));
  }

  /* =================== módulo =================== */
  var Pacientes = window.Pacientes = {
    mount: function (el, params) {
      vista.el = el;
      var seg = (params && params.seg) || [];
      el.addEventListener('click', aoClicar);
      vista.unsubs.push(CL.on('change', aoMudar));
      vista.unsubs.push(CL.on('privacidade', function () { aoMudar({ col: '*' }); }));
      if (seg[0]) {
        vista.pacId = seg[0];
        vista.aba = ABAS.some(function (a) { return a[0] === seg[1]; }) ? seg[1] : 'resumo';
        renderFicha(el);
        var p = pac(vista.pacId);
        if (p && !(ultimaAuditoria.id === p.id && Date.now() - ultimaAuditoria.em < 10 * 60000)) {
          ultimaAuditoria = { id: p.id, em: Date.now() };
          CL.audit('ficha.abrir', 'pacientes', p.id, { pacId: p.id });
        }
      } else {
        vista.pacId = null;
        renderLista(el);
      }
    },
    unmount: function () {
      clearTimeout(vista.timer);
      vista.unsubs.forEach(function (u) { try { u(); } catch (err) { /* já removido */ } });
      vista.unsubs = [];
      if (vista.el) vista.el.removeEventListener('click', aoClicar);
      vista.el = null; vista.modo = null;
    },
    buscar: buscar,
    duplicados: duplicados,
    rapido: rapido,
    abrirForm: abrirForm,
    abrirFicha: abrirFicha,
    inativar: inativar,
    reativar: reativar,
    faltas: faltas,
    selo: selo,
    lgpd: lgpd,
    normalizar: normalizarPaciente,
    nome: nomeDe,
    ultimaConsulta: ultimaConsulta,
    proximaConsulta: proximaConsulta,
    imprimirFicha: imprimirFicha,
    whatsapp: abrirWhatsapp,
    registrarCompartilhamento: registrarCompartilhamento,
    cpfValido: cpfValido,
    mascaras: { cpf: mascaraCpf, fone: mascaraFone }
  };
  CL.route.register('pacientes', Pacientes);
})();
