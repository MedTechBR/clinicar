/* Clinicar — configuracoes.js (dono: casca · completado pela integração)
   Global "Config". Contrato: docs/ESPEC.md §4.12 e §5.6. Rotas: #/config/<aba> com abas
   clinica | profissionais | procedimentos | convenios | politica | whatsapp | usuarios | dados | privacidade | importar | sobre.
   Guarda: só o administrador abre os ajustes (o roteador redireciona; "sobre" é aberta a todos).
   Config.abrirRecuperacao / exportarTudo / apagarTudo são a blindagem do storage (chamadas pelo Backend). */
(function () {
  'use strict';
  var U = CL.util;
  var e = function (s) { return U.esc(s); };
  var ABAS = [
    ['clinica', 'Clínica', 'ti-building'],
    ['profissionais', 'Profissionais', 'ti-user-heart'],
    ['procedimentos', 'Procedimentos', 'ti-list-details'],
    ['convenios', 'Convênios', 'ti-id-badge-2'],
    ['politica', 'Política', 'ti-clock-x'],
    ['whatsapp', 'WhatsApp', 'ti-brand-whatsapp'],
    ['usuarios', 'Usuários', 'ti-users'],
    ['dados', 'Dados', 'ti-database'],
    ['privacidade', 'Privacidade', 'ti-shield-lock'],
    ['importar', 'Importar', 'ti-file-import'],
    ['sobre', 'Sobre', 'ti-info-circle']
  ];
  var CORES = ['#2B5CE6', '#0E8A6C', '#B3541E', '#7C3AED', '#C2185B', '#0F766E', '#B45309', '#4B5563'];
  var CONSELHOS = ['CRM', 'CRO', 'CRP', 'CREFITO', 'CRN', 'COREN', 'CRF', 'CRFa', 'OUTRO'];
  var UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  var DIAS = [[1, 'Segunda'], [2, 'Terça'], [3, 'Quarta'], [4, 'Quinta'], [5, 'Sexta'], [6, 'Sábado'], [0, 'Domingo']];
  var PLACEHOLDERS_WA = ['{nome}', '{prof}', '{data}', '{hora}', '{clinica}', '{endereco}', '{link}'];
  var AVISO_PADRAO = 'Esta clínica trata seus dados pessoais e de saúde para agendar, atender e registrar o cuidado prestado, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018). O prontuário é guardado pelo prazo legal. Você pode pedir cópia, correção ou informações sobre o uso dos seus dados ao responsável indicado abaixo.';
  var elAtual = null, abaAtual = 'dados', unChange = null, unSession = null;
  var renderPendente = false;
  /* Re-renderiza a aba devolvendo o foco ao mesmo controle (data-acao/data-id), para o Tab não se perder. */
  function renderMantendoFoco(el) {
    el = el || elAtual; if (!el) return;
    renderPendente = false;
    var a = document.activeElement, sel = null;
    if (a && el.contains(a) && a.hasAttribute('data-acao')) {
      sel = '[data-acao="' + a.getAttribute('data-acao') + '"]' + (a.getAttribute('data-id') ? '[data-id="' + a.getAttribute('data-id') + '"]' : '');
    }
    renderAba(el);
    if (sel) { var n = el.querySelector(sel); if (n) { try { n.focus(); } catch (e) { /* sem foco */ } } }
  }
  /* Salvou com o modal aberto? A lista atrás é redesenhada assim que o modal fecha. */
  function aoFecharForm() { if (renderPendente && elAtual) renderMantendoFoco(elAtual); }

  function cfg() { return CL.state.cfg || CL.defaultCfg(); }
  function opt(v, rot, sel) { return '<option value="' + e(v) + '"' + (String(sel) === String(v) ? ' selected' : '') + '>' + e(rot) + '</option>'; }
  function campo(id, rotulo, inner, ajuda) { return '<div class="campo"><label for="' + id + '">' + e(rotulo) + '</label>' + inner + (ajuda ? '<span class="campo-ajuda">' + e(ajuda) + '</span>' : '') + '</div>'; }
  function input(id, valor, extra) { return '<input id="' + id + '" class="input" type="text" autocomplete="off" value="' + e(valor == null ? '' : valor) + '"' + (extra || '') + '>'; }
  function valorInput(cent) { return CL.fmt.dinheiro(cent).replace('R$ ', ''); }
  function podeConfig() { if (CL.can('config')) return true; CL.ui.toast('Só o administrador altera os ajustes', { kind: 'aviso' }); return false; }
  function abasPermitidas() { return CL.can('config') ? ABAS : ABAS.filter(function (a) { return a[0] === 'sobre'; }); }
  function contagensHtml(c) {
    var partes = [];
    ['pacientes', 'consultas', 'evolucoes', 'receitas', 'documentos', 'exames', 'lancamentos'].forEach(function (k) { if (c[k]) partes.push(c[k] + ' ' + k); });
    return partes.length ? partes.join(' · ') : 'sem registros';
  }
  function contagensDe(state) {
    var c = {};
    CL.COLECOES.forEach(function (k) { c[k] = Array.isArray(state[k]) ? state[k].length : 0; });
    return c;
  }
  function cardVazio(box, o) { var v = document.createElement('div'); box.appendChild(v); CL.ui.vazio(v, o); }

  /* =================== clínica =================== */
  function renderClinica(el) {
    var c = cfg().clinica || {};
    var logo = Backend.logo.get();
    var p0 = CL.col('profissionais').filter(function (p) { return p && p.ativo !== false; })[0];
    el.innerHTML = '<form class="pilha cfg-form" data-form="clinica" novalidate>' +
      '<div class="card"><div class="card-titulo"><i class="ti ti-building" aria-hidden="true"></i>Dados da clínica</div><div class="campos">' +
      campo('cl-nome', 'Nome da clínica', input('cl-nome', c.nome, ' maxlength="120"')) +
      campo('cl-cnpj', 'CNPJ (opcional)', input('cl-cnpj', c.cnpj, ' inputmode="numeric" maxlength="20"')) +
      '<div class="campo campo-cheio">' + '<label for="cl-endereco">Endereço</label>' + input('cl-endereco', c.endereco, ' maxlength="200"') + '</div>' +
      campo('cl-telefone', 'Telefone', input('cl-telefone', c.telefone, ' inputmode="tel" maxlength="30"')) +
      campo('cl-email', 'E-mail', '<input id="cl-email" class="input" type="email" autocomplete="off" value="' + e(c.email || '') + '" maxlength="120">') +
      '<div class="campo campo-cheio"><label for="cl-rodape">Rodapé dos documentos</label><input id="cl-rodape" class="input" type="text" autocomplete="off" value="' + e(c.rodape || '') + '" maxlength="200"><span class="campo-ajuda">Sai abaixo da frase legal em todos os impressos.</span></div>' +
      '</div></div>' +
      '<div class="card"><div class="card-titulo"><i class="ti ti-photo" aria-hidden="true"></i>Logo</div><div class="cfg-logo">' +
      '<div class="cfg-logo-previa" data-logo-previa>' + (logo ? '<img src="' + e(logo) + '" alt="Logo atual">' : '<span class="texto-3">Sem logo</span>') + '</div>' +
      '<div class="pilha"><label class="btn btn-neutro cfg-arquivo"><i class="ti ti-upload" aria-hidden="true"></i>Escolher imagem<input type="file" id="cl-logo" accept="image/*" class="sr-only"></label>' +
      (logo ? '<button type="button" class="btn btn-fantasma" data-acao="logo-remover"><i class="ti ti-trash" aria-hidden="true"></i>Remover logo</button>' : '') +
      '<span class="ajuda">PNG ou JPG. É redimensionada para 480×180 e fica fora do banco principal.</span></div></div></div>' +
      '<div class="card"><div class="card-titulo"><i class="ti ti-file-text" aria-hidden="true"></i>Prévia do cabeçalho impresso</div><div class="cfg-previa-cab" data-previa>' +
      '<div class="cfg-previa-esq">' + (logo ? '<img src="' + e(logo) + '" alt="">' : '') + '<div><strong data-pv="nome">' + e(c.nome || 'Nome da clínica') + '</strong><div data-pv="endereco">' + e(c.endereco || 'Endereço') + '</div><div data-pv="contato">' + e([c.telefone, c.email].filter(Boolean).join(' · ') || 'Telefone · e-mail') + '</div></div></div>' +
      '<div class="cfg-previa-dir"><strong>' + e(p0 ? p0.nome : 'Nome do profissional') + '</strong><div>' + e(p0 ? [p0.conselho, p0.uf].filter(Boolean).join('-') + (p0.numero ? ' ' + p0.numero : '') : 'CRM-UF 00000') + '</div>' + (p0 && p0.rqe ? '<div>RQE ' + e(p0.rqe) + '</div>' : '') + '</div></div></div>' +
      '<div class="linha-acoes"><button type="submit" class="btn btn-primario"><i class="ti ti-device-floppy" aria-hidden="true"></i>Salvar</button></div></form>';
    var f = el.querySelector('form');
    f.addEventListener('input', function (ev) {
      var t = ev.target; if (!t || !t.id) return;
      var pv = function (k) { return f.querySelector('[data-pv="' + k + '"]'); };
      if (t.id === 'cl-nome') pv('nome').textContent = t.value || 'Nome da clínica';
      else if (t.id === 'cl-endereco') pv('endereco').textContent = t.value || 'Endereço';
      else if (t.id === 'cl-telefone' || t.id === 'cl-email') pv('contato').textContent = [f.querySelector('#cl-telefone').value, f.querySelector('#cl-email').value].filter(Boolean).join(' · ') || 'Telefone · e-mail';
    });
    var arq = f.querySelector('#cl-logo');
    arq.addEventListener('change', function () {
      var file = arq.files && arq.files[0];
      if (!file) return;
      processarLogo(file).then(function (dataUrl) {
        Backend.logo.set(dataUrl);
        CL.ui.toast('Logo atualizada', { kind: 'ok' });
        renderClinica(el);
      }).catch(function (err) { CL.ui.toast('Não foi possível usar a imagem: ' + (err.message || 'formato inválido'), { kind: 'erro' }); });
    });
  }
  function processarLogo(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type || '')) { reject(new Error('escolha um arquivo de imagem')); return; }
      if (file.size > 8000000) { reject(new Error('imagem muito grande (máx. 8 MB)')); return; }
      var r = new FileReader();
      r.onerror = function () { reject(new Error('leitura falhou')); };
      r.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('imagem ilegível')); };
        img.onload = function () {
          var W = 480, H = 180;
          var esc = Math.min(W / img.width, H / img.height, 1);
          var w = Math.max(1, Math.round(img.width * esc)), h = Math.max(1, Math.round(img.height * esc));
          var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          var ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          var out = cv.toDataURL('image/png');
          if (out.length > 120 * 1024) {
            var cv2 = document.createElement('canvas'); cv2.width = w; cv2.height = h;
            var c2 = cv2.getContext('2d'); c2.fillStyle = '#fff'; c2.fillRect(0, 0, w, h); c2.drawImage(img, 0, 0, w, h);
            out = cv2.toDataURL('image/jpeg', 0.85);
            if (out.length > 120 * 1024) out = cv2.toDataURL('image/jpeg', 0.65);
          }
          resolve(out);
        };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }
  function salvarClinica(d) {
    if (!podeConfig()) return null;
    d = d || {};
    var patch = { clinica: {
      nome: String(d.nome || '').trim(), endereco: String(d.endereco || '').trim(), telefone: String(d.telefone || '').trim(),
      email: String(d.email || '').trim(), cnpj: String(d.cnpj || '').trim(), rodape: String(d.rodape || '').trim()
    } };
    var c = CL.setCfg(patch);
    if (d.logo !== undefined) Backend.logo.set(d.logo || '');
    return c.clinica;
  }

  /* =================== profissionais =================== */
  function coresHtml(sel) {
    return '<div class="cfg-cores" role="group" aria-label="Cor de identificação">' + CORES.map(function (c) {
      return '<button type="button" class="cfg-cor" data-cor="' + c + '" style="background:' + c + '" aria-pressed="' + (c === sel ? 'true' : 'false') + '" aria-label="Cor ' + c + '"></button>';
    }).join('') + '</div>';
  }
  function horariosHtml(h) {
    h = h || {};
    return '<div class="cfg-hor" data-horarios>' + DIAS.map(function (d) {
      var lista = Array.isArray(h[String(d[0])]) ? h[String(d[0])].slice(0, 3) : [];
      var pares = '';
      for (var i = 0; i < 3; i++) {
        var t = lista[i] || { ini: '', fim: '' };
        var oculto = i > 0 && !lista[i] && !lista[i - 1];
        pares += '<span class="cfg-hor-par"' + (oculto ? ' hidden' : '') + '><label class="sr-only" for="h-' + d[0] + '-' + i + '-i">Início ' + i + '</label><input id="h-' + d[0] + '-' + i + '-i" class="input" type="time" value="' + e(t.ini) + '" data-dia="' + d[0] + '" data-i="' + i + '" data-campo="ini"><span aria-hidden="true">–</span><label class="sr-only" for="h-' + d[0] + '-' + i + '-f">Fim ' + i + '</label><input id="h-' + d[0] + '-' + i + '-f" class="input" type="time" value="' + e(t.fim) + '" data-dia="' + d[0] + '" data-i="' + i + '" data-campo="fim"></span>';
      }
      return '<div class="cfg-hor-dia"><span class="cfg-hor-rotulo">' + d[1] + '</span><div class="cfg-hor-pares">' + pares + '<button type="button" class="btn btn-icone btn-fantasma" data-acao="hor-mais" data-dia="' + d[0] + '" aria-label="Mais um intervalo em ' + d[1] + '" title="Mais um intervalo"><i class="ti ti-plus" aria-hidden="true"></i></button></div></div>';
    }).join('') + '<div class="linha-acoes"><button type="button" class="btn btn-fantasma btn-pequeno" data-acao="hor-copiar"><i class="ti ti-copy" aria-hidden="true"></i>Copiar segunda para terça a sexta</button><button type="button" class="btn btn-fantasma btn-pequeno" data-acao="hor-limpar">Limpar tudo</button></div></div>';
  }
  function lerHorarios(box) {
    var h = {};
    DIAS.forEach(function (d) {
      var lista = [];
      for (var i = 0; i < 3; i++) {
        var ini = box.querySelector('#h-' + d[0] + '-' + i + '-i'), fim = box.querySelector('#h-' + d[0] + '-' + i + '-f');
        if (ini && fim && ini.value && fim.value && U.min(fim.value) > U.min(ini.value)) lista.push({ ini: ini.value, fim: fim.value });
      }
      h[String(d[0])] = lista;
    });
    return h;
  }
  function renderProfissionais(el) {
    var lista = CL.col('profissionais').slice().sort(function (a, b) { return (a.ativo === false) - (b.ativo === false) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
    var html = '<div class="pilha"><div class="linha-acoes cfg-topo"><p class="texto-2 cfg-cresce">Cada profissional tem cor, horários por dia da semana, tamanho do slot e regra de repasse.</p><button type="button" class="btn btn-primario" data-acao="prof-novo"><i class="ti ti-user-plus" aria-hidden="true"></i>Novo profissional</button></div>';
    if (!lista.length) html += '<div class="card" data-vazio></div>';
    else {
      html += '<div class="card"><ul class="lista-simples">' + lista.map(function (p) {
        var dias = DIAS.filter(function (d) { return Array.isArray((p.horarios || {})[String(d[0])]) && p.horarios[String(d[0])].length; }).map(function (d) { return d[1].slice(0, 3).toLowerCase(); }).join(' ');
        return '<li><span class="chip-ponto" style="background:' + e(p.cor || '#4B5563') + '"></span><span class="cfg-cresce"><strong>' + e(p.nome) + '</strong>' + (p.ativo === false ? ' <span class="chip">inativo</span>' : '') + '<br><small class="texto-3">' + e([[p.conselho, p.uf].filter(Boolean).join('-') + (p.numero ? ' ' + p.numero : ''), p.especialidade, dias ? 'atende ' + dias : 'sem horários', 'slot ' + (p.slot || 15) + ' min'].filter(Boolean).join(' · ')) + '</small></span>' +
          '<button type="button" class="btn btn-neutro btn-pequeno" data-acao="prof-editar" data-id="' + e(p.id) + '"><i class="ti ti-pencil" aria-hidden="true"></i>Editar</button></li>';
      }).join('') + '</ul></div>';
    }
    el.innerHTML = html + '</div>';
    var vz = el.querySelector('[data-vazio]');
    if (vz) CL.ui.vazio(vz, { icone: 'ti-user-heart', titulo: 'Nenhum profissional', texto: 'A agenda precisa de pelo menos um profissional com horários.', acao: { rotulo: 'Cadastrar profissional', icone: 'ti-user-plus', fn: function () { abrirProfissional(null); } } });
  }
  function abrirProfissional(id) {
    if (!podeConfig()) return null;
    var p = id ? CL.get('profissionais', id) : null;
    var f = p || { nome: '', conselho: 'CRM', numero: '', uf: '', rqe: '', especialidade: '', cor: CORES[CL.col('profissionais').length % CORES.length], ativo: true, horarios: { '1': [{ ini: '08:00', fim: '12:00' }, { ini: '14:00', fim: '18:00' }], '2': [{ ini: '08:00', fim: '12:00' }, { ini: '14:00', fim: '18:00' }], '3': [{ ini: '08:00', fim: '12:00' }, { ini: '14:00', fim: '18:00' }], '4': [{ ini: '08:00', fim: '12:00' }, { ini: '14:00', fim: '18:00' }], '5': [{ ini: '08:00', fim: '12:00' }, { ini: '14:00', fim: '18:00' }] }, slot: cfg().agenda.slotBase || 15, maxEncaixesHora: 1, procIds: [], procPadraoId: '', repasse: { modo: 'nenhum', valor: 0 }, usuarioId: null };
    var procs = CL.col('procedimentos').filter(function (x) { return x && x.ativo !== false; });
    var usuarios = CL.col('usuarios').filter(function (u) { return u && u.ativo !== false; });
    var rep = f.repasse || { modo: 'nenhum', valor: 0 };
    var corpo = document.createElement('form');
    corpo.className = 'pilha cfg-form';
    corpo.setAttribute('novalidate', '');
    corpo.innerHTML = '<div class="campos">' +
      '<div class="campo campo-cheio"><label for="pf-nome">Nome</label>' + input('pf-nome', f.nome, ' maxlength="120" required autofocus') + '</div>' +
      campo('pf-conselho', 'Conselho', '<select id="pf-conselho" class="select">' + CONSELHOS.map(function (c) { return opt(c, c, f.conselho || 'CRM'); }).join('') + '</select>') +
      campo('pf-numero', 'Número', input('pf-numero', f.numero, ' inputmode="numeric" maxlength="12"')) +
      campo('pf-uf', 'UF', '<select id="pf-uf" class="select">' + opt('', '—', f.uf) + UFS.map(function (u) { return opt(u, u, f.uf); }).join('') + '</select>') +
      campo('pf-rqe', 'RQE', input('pf-rqe', f.rqe, ' maxlength="12"')) +
      campo('pf-esp', 'Especialidade', input('pf-esp', f.especialidade, ' maxlength="80"')) +
      '<div class="campo"><span class="campo-rotulo">Cor</span>' + coresHtml(f.cor) + '</div>' +
      '</div>' +
      '<h3>Horários de atendimento</h3>' + horariosHtml(f.horarios) +
      '<div class="campos">' +
      campo('pf-slot', 'Slot da agenda', '<select id="pf-slot" class="select">' + [10, 15, 20, 30, 40, 60].map(function (m) { return opt(m, m + ' min', f.slot || 15); }).join('') + '</select>') +
      campo('pf-enc', 'Encaixes por hora', '<input id="pf-enc" class="input" type="number" min="0" max="6" value="' + (parseInt(f.maxEncaixesHora, 10) || 0) + '">') +
      campo('pf-padrao', 'Procedimento padrão', '<select id="pf-padrao" class="select">' + opt('', '— nenhum —', f.procPadraoId || '') + procs.map(function (x) { return opt(x.id, x.nome, f.procPadraoId || ''); }).join('') + '</select>') +
      '</div>' +
      '<div class="campo"><span class="campo-rotulo">Procedimentos atendidos <small class="texto-3">(nenhum marcado = todos)</small></span><div class="cfg-checks">' + procs.map(function (x) { return '<label class="cfg-check"><input type="checkbox" data-proc="' + e(x.id) + '"' + ((f.procIds || []).indexOf(x.id) >= 0 ? ' checked' : '') + '>' + e(x.nome) + '</label>'; }).join('') + '</div></div>' +
      '<div class="campos">' +
      campo('pf-rep-modo', 'Repasse', '<select id="pf-rep-modo" class="select">' + opt('nenhum', 'Sem repasse', rep.modo) + opt('pct', 'Percentual do recebido', rep.modo) + opt('fixo', 'Valor fixo por atendimento', rep.modo) + '</select>') +
      campo('pf-rep-valor', 'Valor do repasse', '<input id="pf-rep-valor" class="input tnum" type="text" inputmode="decimal" autocomplete="off" value="' + e(rep.modo === 'fixo' ? valorInput(rep.valor || 0) : String(rep.valor || 0)) + '">', 'Percentual (ex.: 70) ou valor em reais (ex.: 120,00).') +
      campo('pf-usuario', 'Usuário vinculado', '<select id="pf-usuario" class="select">' + opt('', '— nenhum —', f.usuarioId || '') + usuarios.map(function (u) { return opt(u.id, u.nome + ' (' + CL.fmt.perfil(u.perfil) + ')', f.usuarioId || ''); }).join('') + '</select>') +
      '</div>' +
      '<div class="campo-linha"><input id="pf-ativo" type="checkbox"' + (f.ativo !== false ? ' checked' : '') + '><label for="pf-ativo">Ativo (aparece na agenda)</label></div>';
    var cor = f.cor;
    corpo.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-cor], [data-acao]');
      if (!b) return;
      if (b.hasAttribute('data-cor')) {
        cor = b.getAttribute('data-cor');
        Array.prototype.forEach.call(corpo.querySelectorAll('[data-cor]'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        return;
      }
      var acao = b.getAttribute('data-acao');
      if (acao === 'hor-mais') {
        var dia = b.getAttribute('data-dia');
        var oculto = corpo.querySelector('.cfg-hor-par[hidden] input[data-dia="' + dia + '"]');
        if (oculto) { oculto.closest('.cfg-hor-par').hidden = false; oculto.focus(); } else CL.ui.toast('Máximo de 3 intervalos por dia', { kind: 'info' });
      } else if (acao === 'hor-copiar') {
        var h = lerHorarios(corpo);
        ['2', '3', '4', '5'].forEach(function (d) { h[d] = (h['1'] || []).map(function (t) { return { ini: t.ini, fim: t.fim }; }); });
        corpo.querySelector('[data-horarios]').outerHTML = horariosHtml(h);
      } else if (acao === 'hor-limpar') {
        corpo.querySelector('[data-horarios]').outerHTML = horariosHtml({});
      }
    });
    function coletar() {
      var g = function (id) { return corpo.querySelector('#' + id); };
      var modo = g('pf-rep-modo').value;
      var valorRep = modo === 'fixo' ? U.centavos(g('pf-rep-valor').value) : (parseFloat(String(g('pf-rep-valor').value).replace(',', '.')) || 0);
      return {
        id: p ? p.id : undefined, nome: g('pf-nome').value.trim(), conselho: g('pf-conselho').value, numero: U.digits(g('pf-numero').value), uf: g('pf-uf').value,
        rqe: g('pf-rqe').value.trim(), especialidade: g('pf-esp').value.trim(), cor: cor, horarios: lerHorarios(corpo),
        slot: parseInt(g('pf-slot').value, 10) || 15, maxEncaixesHora: Math.max(0, parseInt(g('pf-enc').value, 10) || 0),
        procIds: Array.prototype.map.call(corpo.querySelectorAll('[data-proc]:checked'), function (c) { return c.getAttribute('data-proc'); }),
        procPadraoId: g('pf-padrao').value || null, repasse: { modo: modo, valor: modo === 'nenhum' ? 0 : valorRep },
        usuarioId: g('pf-usuario').value || null, ativo: g('pf-ativo').checked
      };
    }
    function salvar() {
      var d = coletar();
      if (!d.nome) { CL.ui.toast('Informe o nome', { kind: 'aviso' }); corpo.querySelector('#pf-nome').focus(); return false; }
      if (d.repasse.modo === 'pct' && (d.repasse.valor < 0 || d.repasse.valor > 100)) { CL.ui.toast('Percentual de repasse entre 0 e 100', { kind: 'aviso' }); return false; }
      var salvo = salvarProfissional(d);
      if (!salvo) return false;
      CL.ui.toast((p ? 'Profissional atualizado' : 'Profissional cadastrado') + ': ' + salvo.nome, { kind: 'ok' });
      return true;
    }
    var m = CL.ui.modal({ titulo: p ? 'Editar profissional' : 'Novo profissional', corpo: corpo, largo: true, aoFechar: aoFecharForm, botoes: [{ rotulo: 'Cancelar', tipo: 'neutro' }, { rotulo: 'Salvar', tipo: 'primario', icone: 'ti-device-floppy', acao: function () { return salvar(); } }] });
    corpo.addEventListener('submit', function (ev) { ev.preventDefault(); if (salvar()) m.fechar({ motivo: 'enter' }); });
    return m;
  }
  function salvarProfissional(d) {
    if (!podeConfig()) return null;
    d = d || {};
    var atual = d.id ? CL.get('profissionais', d.id) : null;
    var obj = Object.assign(atual || {}, {
      nome: String(d.nome || '').trim(), conselho: CONSELHOS.indexOf(d.conselho) >= 0 ? d.conselho : 'OUTRO', numero: U.digits(d.numero || ''), uf: UFS.indexOf(d.uf) >= 0 ? d.uf : '',
      rqe: String(d.rqe || '').trim(), especialidade: String(d.especialidade || '').trim(), cor: CORES.indexOf(d.cor) >= 0 ? d.cor : CORES[0],
      ativo: d.ativo !== false, horarios: (d.horarios && typeof d.horarios === 'object') ? d.horarios : (atual ? atual.horarios : {}),
      slot: [10, 15, 20, 30, 40, 60].indexOf(parseInt(d.slot, 10)) >= 0 ? parseInt(d.slot, 10) : 15,
      maxEncaixesHora: Math.max(0, parseInt(d.maxEncaixesHora, 10) || 0),
      procIds: Array.isArray(d.procIds) ? d.procIds : [], procPadraoId: d.procPadraoId || null,
      repasse: { modo: ['pct', 'fixo', 'nenhum'].indexOf((d.repasse || {}).modo) >= 0 ? d.repasse.modo : 'nenhum', valor: Number((d.repasse || {}).valor) || 0 },
      usuarioId: d.usuarioId || null
    });
    if (d.id) obj.id = d.id;
    if (!obj.nome) return null;
    var salvo = CL.upsert('profissionais', obj);
    if (salvo.usuarioId) { var u = CL.get('usuarios', salvo.usuarioId); if (u && u.profId !== salvo.id) CL.patch('usuarios', u.id, { profId: salvo.id }); }
    return salvo;
  }

  /* =================== procedimentos =================== */
  function renderProcedimentos(el) {
    var lista = CL.col('procedimentos').slice().sort(function (a, b) { return (a.ativo === false) - (b.ativo === false) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
    var html = '<div class="pilha"><div class="linha-acoes cfg-topo"><p class="texto-2 cfg-cresce">Tipos de consulta com duração, valor e cor. O valor vira o lançamento pendente ao finalizar a consulta.</p><button type="button" class="btn btn-primario" data-acao="proc-novo"><i class="ti ti-plus" aria-hidden="true"></i>Novo procedimento</button></div>';
    if (!lista.length) html += '<div class="card" data-vazio></div>';
    else html += '<div class="tabela-wrap tabela-cartoes"><table class="tabela"><thead><tr><th>Nome</th><th class="num">Duração</th><th class="num">Valor</th><th>Modalidade</th><th class="num">Intervalo</th><th>Ativo</th><th class="acoes"><span class="sr-only">Ações</span></th></tr></thead><tbody>' +
      lista.map(function (p) {
        return '<tr' + (p.ativo === false ? ' class="is-inativo"' : '') + '><td data-rotulo="Nome"><span class="chip-ponto" style="background:' + e(p.cor || '#4B5563') + '"></span> ' + e(p.nome) + '</td><td data-rotulo="Duração" class="num tnum">' + (p.dur || 30) + ' min</td><td data-rotulo="Valor" class="num tnum">' + e(CL.fmt.dinheiro(p.valorCent || 0)) + '</td><td data-rotulo="Modalidade">' + (p.modalidade === 'tele' ? 'Teleconsulta' : 'Presencial') + '</td><td data-rotulo="Intervalo" class="num tnum">' + (p.bufferMin || 0) + ' min</td><td data-rotulo="Ativo">' + (p.ativo === false ? '<span class="chip">inativo</span>' : '<span class="chip chip-ok">ativo</span>') + '</td><td class="acoes"><button type="button" class="btn btn-neutro btn-pequeno" data-acao="proc-editar" data-id="' + e(p.id) + '"><i class="ti ti-pencil" aria-hidden="true"></i>Editar</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    el.innerHTML = html + '</div>';
    var vz = el.querySelector('[data-vazio]');
    if (vz) CL.ui.vazio(vz, { icone: 'ti-list-details', titulo: 'Nenhum procedimento', texto: 'Cadastre os tipos de consulta com duração e valor.', acao: { rotulo: 'Novo procedimento', icone: 'ti-plus', fn: function () { abrirProcedimento(null); } } });
  }
  function abrirProcedimento(id) {
    if (!podeConfig()) return null;
    var p = id ? CL.get('procedimentos', id) : null;
    var f = p || { nome: '', dur: 30, valorCent: 0, cor: CORES[CL.col('procedimentos').length % CORES.length], modalidade: 'presencial', bufferMin: 0, ativo: true };
    var corpo = document.createElement('form');
    corpo.className = 'pilha cfg-form'; corpo.setAttribute('novalidate', '');
    corpo.innerHTML = '<div class="campos"><div class="campo campo-cheio"><label for="pr-nome">Nome</label>' + input('pr-nome', f.nome, ' maxlength="80" required autofocus') + '</div>' +
      campo('pr-dur', 'Duração (min)', '<input id="pr-dur" class="input" type="number" min="5" max="480" step="5" value="' + (parseInt(f.dur, 10) || 30) + '">') +
      campo('pr-valor', 'Valor (R$)', '<input id="pr-valor" class="input tnum" type="text" inputmode="decimal" autocomplete="off" value="' + e(valorInput(f.valorCent || 0)) + '">') +
      campo('pr-mod', 'Modalidade', '<select id="pr-mod" class="select">' + opt('presencial', 'Presencial', f.modalidade) + opt('tele', 'Teleconsulta (link externo)', f.modalidade) + '</select>') +
      campo('pr-buffer', 'Intervalo após (min)', '<input id="pr-buffer" class="input" type="number" min="0" max="120" step="5" value="' + (parseInt(f.bufferMin, 10) || 0) + '">') +
      '<div class="campo"><span class="campo-rotulo">Cor</span>' + coresHtml(f.cor) + '</div></div>' +
      '<div class="campo-linha"><input id="pr-ativo" type="checkbox"' + (f.ativo !== false ? ' checked' : '') + '><label for="pr-ativo">Ativo</label></div>';
    var cor = f.cor;
    corpo.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-cor]'); if (!b) return;
      cor = b.getAttribute('data-cor');
      Array.prototype.forEach.call(corpo.querySelectorAll('[data-cor]'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
    });
    function salvar() {
      var g = function (i) { return corpo.querySelector('#' + i); };
      var d = { id: p ? p.id : undefined, nome: g('pr-nome').value.trim(), dur: parseInt(g('pr-dur').value, 10) || 30, valorCent: Math.max(0, U.centavos(g('pr-valor').value)), cor: cor, modalidade: g('pr-mod').value, bufferMin: Math.max(0, parseInt(g('pr-buffer').value, 10) || 0), ativo: g('pr-ativo').checked };
      if (!d.nome) { CL.ui.toast('Informe o nome', { kind: 'aviso' }); g('pr-nome').focus(); return false; }
      var s = salvarProcedimento(d);
      if (!s) return false;
      CL.ui.toast((p ? 'Procedimento atualizado' : 'Procedimento criado') + ': ' + s.nome, { kind: 'ok' });
      return true;
    }
    var m = CL.ui.modal({ titulo: p ? 'Editar procedimento' : 'Novo procedimento', corpo: corpo, aoFechar: aoFecharForm, botoes: [{ rotulo: 'Cancelar', tipo: 'neutro' }, { rotulo: 'Salvar', tipo: 'primario', icone: 'ti-device-floppy', acao: function () { return salvar(); } }] });
    corpo.addEventListener('submit', function (ev) { ev.preventDefault(); if (salvar()) m.fechar({ motivo: 'enter' }); });
    return m;
  }
  function salvarProcedimento(d) {
    if (!podeConfig()) return null;
    d = d || {};
    var atual = d.id ? CL.get('procedimentos', d.id) : null;
    var obj = Object.assign(atual || {}, {
      nome: String(d.nome || '').trim(), dur: Math.max(5, parseInt(d.dur, 10) || 30), valorCent: Math.max(0, Math.round(Number(d.valorCent) || 0)),
      cor: CORES.indexOf(d.cor) >= 0 ? d.cor : CORES[0], modalidade: d.modalidade === 'tele' ? 'tele' : 'presencial', bufferMin: Math.max(0, parseInt(d.bufferMin, 10) || 0), ativo: d.ativo !== false
    });
    if (d.id) obj.id = d.id;
    if (!obj.nome) return null;
    return CL.upsert('procedimentos', obj);
  }

  /* =================== convênios =================== */
  function renderConvenios(el) {
    var lista = CL.col('convenios').slice().sort(function (a, b) { return (a.id === 'particular' ? -1 : b.id === 'particular' ? 1 : 0) || (a.ativo === false) - (b.ativo === false) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
    el.innerHTML = '<div class="pilha"><form class="card" data-form="convenio" novalidate><div class="card-titulo"><i class="ti ti-id-badge-2" aria-hidden="true"></i>Novo convênio</div><div class="cfg-inline"><label class="sr-only" for="cv-nome">Nome do convênio</label><input id="cv-nome" class="input" type="text" maxlength="80" placeholder="Nome do convênio" autocomplete="off"><button type="submit" class="btn btn-primario"><i class="ti ti-plus" aria-hidden="true"></i>Adicionar</button></div></form>' +
      '<div class="card"><ul class="lista-simples">' + lista.map(function (c) {
        return '<li><span class="cfg-cresce"><strong>' + e(c.nome) + '</strong>' + (c.ativo === false ? ' <span class="chip">inativo</span>' : '') + (c.id === 'particular' ? ' <span class="chip chip-acento">padrão</span>' : '') + '</span>' +
          '<button type="button" class="btn btn-fantasma btn-pequeno" data-acao="conv-renomear" data-id="' + e(c.id) + '"><i class="ti ti-pencil" aria-hidden="true"></i>Renomear</button>' +
          (c.id === 'particular' ? '' : '<button type="button" class="btn btn-fantasma btn-pequeno" data-acao="conv-ativo" data-id="' + e(c.id) + '">' + (c.ativo === false ? 'Reativar' : 'Inativar') + '</button>') + '</li>';
      }).join('') + '</ul></div></div>';
  }
  function salvarConvenio(d) {
    if (!podeConfig()) return null;
    d = d || {};
    var nome = String(d.nome || '').trim();
    var atual = d.id ? CL.get('convenios', d.id) : null;
    if (!atual) {
      if (!nome) return null;
      var dup = CL.col('convenios').filter(function (c) { return c && U.norm(c.nome) === U.norm(nome); })[0];
      if (dup) { CL.ui.toast('Convênio já existe: ' + dup.nome, { kind: 'info' }); return dup; }
      return CL.upsert('convenios', { nome: nome, ativo: d.ativo !== false });
    }
    var obj = Object.assign(atual, { nome: nome || atual.nome, ativo: d.ativo === undefined ? atual.ativo !== false : !!d.ativo });
    if (obj.id === 'particular') obj.ativo = true;
    return CL.upsert('convenios', obj);
  }

  /* =================== política =================== */
  function renderPolitica(el) {
    var p = cfg().politica || {};
    var modoTaxa = (parseInt(p.taxaFaltaCent, 10) || 0) > 0 ? 'valor' : (parseFloat(p.taxaFaltaPct) || 0) > 0 ? 'pct' : 'nenhuma';
    el.innerHTML = '<form class="pilha cfg-form" data-form="politica" novalidate><div class="card"><div class="card-titulo"><i class="ti ti-clock-x" aria-hidden="true"></i>Cancelamento e falta</div><div class="campos">' +
      campo('po-janela', 'Janela de cancelamento', '<select id="po-janela" class="select">' + opt(0, 'Nenhuma', p.janelaCancelamentoH || 0) + opt(24, '24 horas', p.janelaCancelamentoH) + opt(48, '48 horas', p.janelaCancelamentoH) + opt(72, '72 horas', p.janelaCancelamentoH) + '</select>', 'Cancelar dentro da janela vira "cancelado tarde".') +
      campo('po-taxa-modo', 'Taxa de falta', '<select id="po-taxa-modo" class="select">' + opt('nenhuma', 'Não cobrar', modoTaxa) + opt('valor', 'Valor fixo', modoTaxa) + opt('pct', 'Percentual do procedimento', modoTaxa) + '</select>') +
      campo('po-taxa', 'Valor da taxa', '<input id="po-taxa" class="input tnum" type="text" inputmode="decimal" autocomplete="off" value="' + e(modoTaxa === 'valor' ? valorInput(p.taxaFaltaCent) : modoTaxa === 'pct' ? String(p.taxaFaltaPct) : '') + '"' + (modoTaxa === 'nenhuma' ? ' disabled' : '') + '>', 'Em reais (ex.: 50,00) ou percentual (ex.: 50).') +
      '</div><div class="campo-linha"><input id="po-tardio" type="checkbox"' + (p.cobrarTardio !== false ? ' checked' : '') + '><label for="po-tardio">Cobrar a taxa também no cancelamento tardio</label></div>' +
      '<div class="campo"><label for="po-texto">Texto curto mostrado ao marcar</label><input id="po-texto" class="input" type="text" maxlength="160" autocomplete="off" value="' + e(p.texto || '') + '" placeholder="Ex.: Cancelamento com menos de 24 h é cobrado"></div></div>' +
      '<div class="linha-acoes"><button type="submit" class="btn btn-primario"><i class="ti ti-device-floppy" aria-hidden="true"></i>Salvar</button></div></form>';
    el.querySelector('#po-taxa-modo').addEventListener('change', function (ev) { var t = el.querySelector('#po-taxa'); t.disabled = ev.target.value === 'nenhuma'; if (!t.disabled) t.focus(); });
  }
  function salvarPolitica(d) {
    if (!podeConfig()) return null;
    d = d || {};
    var patch = { politica: {
      janelaCancelamentoH: [0, 24, 48, 72].indexOf(parseInt(d.janelaCancelamentoH, 10)) >= 0 ? parseInt(d.janelaCancelamentoH, 10) : 24,
      taxaFaltaCent: Math.max(0, Math.round(Number(d.taxaFaltaCent) || 0)), taxaFaltaPct: Math.max(0, Math.min(100, Number(d.taxaFaltaPct) || 0)),
      cobrarTardio: d.cobrarTardio !== false, texto: String(d.texto || '').trim()
    } };
    return CL.setCfg(patch).politica;
  }

  /* =================== whatsapp =================== */
  var WA_ROTULOS = { confirmar: 'Confirmar consulta', lembrete: 'Lembrete', remarcar: 'Remarcar', tele: 'Teleconsulta', vaga: 'Vaga aberta' };
  function previaWa(texto) {
    var c = cfg(), cl = c.clinica || {};
    var p0 = CL.col('profissionais').filter(function (p) { return p && p.ativo !== false; })[0];
    var mapa = { '{nome}': 'Maria', '{prof}': p0 ? p0.nome : 'Dr(a). Nome', '{data}': CL.fmt.dataExtenso(U.addDias(U.hoje(), 1)), '{hora}': '09:00', '{clinica}': cl.nome || 'Clínica', '{endereco}': cl.endereco || 'Endereço', '{link}': 'https://exemplo.com/sala' };
    return String(texto || '').replace(/\{(nome|prof|data|hora|clinica|endereco|link)\}/g, function (m) { return mapa[m] || m; });
  }
  function renderWhatsapp(el) {
    var m = (cfg().whatsapp || {}).modelos || {};
    el.innerHTML = '<form class="pilha cfg-form" data-form="whatsapp" novalidate>' +
      '<div class="aviso-inline is-info"><i class="ti ti-info-circle" aria-hidden="true"></i><span>Nada é enviado automaticamente: o WhatsApp abre com o texto pronto. Campos: ' + PLACEHOLDERS_WA.map(function (p) { return '<code>' + e(p) + '</code>'; }).join(' ') + '. Nunca inclua procedimento ou diagnóstico.</span></div>' +
      Object.keys(WA_ROTULOS).map(function (k) {
        return '<div class="card cfg-wa"><div class="campo"><label for="wa-' + k + '">' + e(WA_ROTULOS[k]) + '</label><textarea id="wa-' + k + '" class="textarea" rows="3" data-wa="' + k + '" maxlength="600">' + e(m[k] || '') + '</textarea></div><div class="cfg-wa-previa"><span class="rotulo">Prévia</span><div class="ag-wa-previa" data-previa="' + k + '">' + e(previaWa(m[k] || '')) + '</div></div></div>';
      }).join('') +
      '<div class="linha-acoes"><button type="submit" class="btn btn-primario"><i class="ti ti-device-floppy" aria-hidden="true"></i>Salvar</button><button type="button" class="btn btn-fantasma" data-acao="wa-padrao">Restaurar textos padrão</button></div></form>';
    el.querySelector('form').addEventListener('input', function (ev) {
      var t = ev.target; if (!t || !t.hasAttribute('data-wa')) return;
      el.querySelector('[data-previa="' + t.getAttribute('data-wa') + '"]').textContent = previaWa(t.value);
    });
  }
  function salvarWhatsapp(modelos) {
    if (!podeConfig()) return null;
    var out = {}, atual = (cfg().whatsapp || {}).modelos || {};
    Object.keys(WA_ROTULOS).forEach(function (k) { out[k] = String((modelos && modelos[k] != null) ? modelos[k] : atual[k] || '').trim(); });
    return CL.setCfg({ whatsapp: { modelos: out } }).whatsapp.modelos;
  }
  function restaurarWaPadrao() {
    CL.ui.confirmar({ titulo: 'Restaurar textos padrão?', texto: 'Os cinco modelos voltam ao texto original.', ok: 'Restaurar' }).then(function (ok) {
      if (!ok) return;
      CL.setCfg({ whatsapp: { modelos: { confirmar: '', lembrete: '', remarcar: '', tele: '', vaga: '' } }, seed: false });
      CL.seed().then(function () { CL.ui.toast('Textos restaurados', { kind: 'ok' }); renderAba(elAtual); });
    });
  }

  /* =================== usuários =================== */
  function renderUsuarios(el) {
    var lista = CL.col('usuarios').slice().sort(function (a, b) { return (a.ativo === false) - (b.ativo === false) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
    el.innerHTML = '<div class="pilha"><div class="linha-acoes cfg-topo"><p class="texto-2 cfg-cresce">Perfis limitam a interface (recepção não abre o prontuário; só o administrador abre os ajustes). Não substituem contas separadas: quem tem acesso ao navegador vê a lista.</p><button type="button" class="btn btn-primario" data-acao="usr-novo"><i class="ti ti-user-plus" aria-hidden="true"></i>Novo usuário</button></div>' +
      '<div class="card"><ul class="lista-simples">' + lista.map(function (u) {
        var pf = u.profId ? CL.get('profissionais', u.profId) : null;
        return '<li><span class="avatar" aria-hidden="true">' + e(U.iniciais(u.nome)) + '</span><span class="cfg-cresce"><strong>' + e(u.nome) + '</strong>' + (u.ativo === false ? ' <span class="chip">inativo</span>' : '') + (CL.session && CL.session.usuarioId === u.id ? ' <span class="chip chip-acento">você</span>' : '') + '<br><small class="texto-3">' + e([CL.fmt.perfil(u.perfil), pf ? pf.nome : '', u.pinHash ? 'com PIN' : 'sem PIN'].filter(Boolean).join(' · ')) + '</small></span>' +
          '<button type="button" class="btn btn-neutro btn-pequeno" data-acao="usr-editar" data-id="' + e(u.id) + '"><i class="ti ti-pencil" aria-hidden="true"></i>Editar</button></li>';
      }).join('') + '</ul></div></div>';
  }
  function abrirUsuario(id) {
    if (!podeConfig()) return null;
    var u = id ? CL.get('usuarios', id) : null;
    var f = u || { nome: '', perfil: 'recepcao', profId: null, pinHash: '', ativo: true };
    var profs = CL.col('profissionais').filter(function (p) { return p && p.ativo !== false; });
    var corpo = document.createElement('form');
    corpo.className = 'pilha cfg-form'; corpo.setAttribute('novalidate', '');
    corpo.innerHTML = '<div class="campos"><div class="campo campo-cheio"><label for="us-nome">Nome</label>' + input('us-nome', f.nome, ' maxlength="80" required autofocus') + '</div>' +
      campo('us-perfil', 'Perfil', '<select id="us-perfil" class="select">' + opt('recepcao', 'Recepção', f.perfil) + opt('profissional', 'Profissional', f.perfil) + opt('admin', 'Administrador', f.perfil) + '</select>') +
      campo('us-prof', 'Profissional vinculado', '<select id="us-prof" class="select">' + opt('', '— nenhum —', f.profId || '') + profs.map(function (p) { return opt(p.id, p.nome, f.profId || ''); }).join('') + '</select>', 'Filtra a agenda e o painel para a própria fila.') +
      campo('us-pin', u && u.pinHash ? 'Novo PIN (deixe vazio para manter)' : 'PIN (opcional)', '<input id="us-pin" class="input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code">', '4 a 6 dígitos, pedidos ao entrar.') +
      '</div>' + (u && u.pinHash ? '<div class="campo-linha"><input id="us-pin-remover" type="checkbox"><label for="us-pin-remover">Remover o PIN</label></div>' : '') +
      '<div class="campo-linha"><input id="us-ativo" type="checkbox"' + (f.ativo !== false ? ' checked' : '') + '><label for="us-ativo">Ativo (aparece na tela de entrada)</label></div>';
    function salvar() {
      var g = function (i) { return corpo.querySelector('#' + i); };
      var pin = g('us-pin').value.trim();
      if (pin && !/^\d{4,6}$/.test(pin)) { CL.ui.toast('O PIN tem de 4 a 6 dígitos', { kind: 'aviso' }); g('us-pin').focus(); return false; }
      var d = { id: u ? u.id : undefined, nome: g('us-nome').value.trim(), perfil: g('us-perfil').value, profId: g('us-prof').value || null, pin: pin || null, removerPin: !!(g('us-pin-remover') && g('us-pin-remover').checked), ativo: g('us-ativo').checked };
      if (!d.nome) { CL.ui.toast('Informe o nome', { kind: 'aviso' }); g('us-nome').focus(); return false; }
      return salvarUsuario(d).then(function (s) {
        if (!s) return false;
        CL.ui.toast((u ? 'Usuário atualizado' : 'Usuário criado') + ': ' + s.nome, { kind: 'ok' });
        return true;
      });
    }
    var m = CL.ui.modal({ titulo: u ? 'Editar usuário' : 'Novo usuário', corpo: corpo, aoFechar: aoFecharForm, botoes: [{ rotulo: 'Cancelar', tipo: 'neutro' }, { rotulo: 'Salvar', tipo: 'primario', icone: 'ti-device-floppy', acao: function () { return salvar(); } }] });
    corpo.addEventListener('submit', function (ev) { ev.preventDefault(); Promise.resolve(salvar()).then(function (ok) { if (ok) m.fechar({ motivo: 'enter' }); }); });
    return m;
  }
  function salvarUsuario(d) {
    if (!podeConfig()) return Promise.resolve(null);
    d = d || {};
    var atual = d.id ? CL.get('usuarios', d.id) : null;
    var perfil = ['admin', 'recepcao', 'profissional'].indexOf(d.perfil) >= 0 ? d.perfil : 'recepcao';
    var ativo = d.ativo !== false;
    if (atual && !ativo && CL.session && CL.session.usuarioId === atual.id) { CL.ui.toast('Você não pode inativar o próprio usuário', { kind: 'aviso' }); return Promise.resolve(null); }
    if (atual && (perfil !== 'admin' || !ativo) && atual.perfil === 'admin') {
      var outrosAdmins = CL.col('usuarios').filter(function (x) { return x && x.id !== atual.id && x.perfil === 'admin' && x.ativo !== false; });
      if (!outrosAdmins.length) { CL.ui.toast('Mantenha pelo menos um administrador ativo', { kind: 'aviso' }); return Promise.resolve(null); }
    }
    var pinP = d.pin ? U.sha256(String(d.pin)) : Promise.resolve(null);
    return pinP.then(function (hash) {
      var obj = Object.assign(atual || { pinHash: '' }, { nome: String(d.nome || '').trim(), perfil: perfil, profId: d.profId || null, ativo: ativo });
      if (d.id) obj.id = d.id;
      if (hash) obj.pinHash = hash; else if (d.removerPin) obj.pinHash = '';
      if (!obj.nome) return null;
      var salvo = CL.upsert('usuarios', obj);
      if (salvo.profId) { var p = CL.get('profissionais', salvo.profId); if (p && p.usuarioId !== salvo.id) CL.patch('profissionais', p.id, { usuarioId: salvo.id }); }
      return salvo;
    });
  }

  /* =================== dados =================== */
  function renderDados(el) {
    var st = Backend.status();
    var meta = Backend.meta.get();
    var bks = Backend.backups();
    var ruins = Backend.chavesRuins();
    var inativos = CL.col('pacientes').filter(function (p) { return p && p.ativo === false; });
    var soltos = CL.col('evolucoes').filter(function (ev) { return ev && !ev.pacId; });
    var html = '<div class="pilha">' +
      '<div class="card"><div class="card-titulo"><i class="ti ti-download" aria-hidden="true"></i>Backup</div>' +
      '<p class="texto-2">Exporte tudo em um arquivo JSON e guarde fora deste computador.' + (meta.ultimoExport ? ' Último export: ' + e(CL.fmt.dataHora(meta.ultimoExport)) + '.' : ' Ainda não houve export.') + '</p>' +
      '<div class="linha-acoes cfg-acoes"><button type="button" class="btn btn-primario" data-acao="exportar"><i class="ti ti-download" aria-hidden="true"></i>Exportar tudo</button>' +
      '<button type="button" class="btn btn-neutro" data-aba="importar"><i class="ti ti-file-import" aria-hidden="true"></i>Importar arquivo</button>' +
      '<button type="button" class="btn btn-neutro" data-acao="recuperacao"><i class="ti ti-history" aria-hidden="true"></i>Recuperação</button></div></div>' +
      '<div class="card"><div class="card-titulo"><i class="ti ti-history" aria-hidden="true"></i>Backups automáticos</div>';
    if (!bks.length) html += '<p class="texto-2">Ainda não há cópias automáticas — elas surgem conforme os dados mudam.</p>';
    else {
      html += '<ul class="lista-simples">';
      bks.forEach(function (b) {
        html += '<li><span class="cfg-cresce"><strong>' + e(b.chave.replace('clinicar.v1.bk.', 'Cópia ')) + '</strong><br><small class="texto-3">' + (b.em ? e(CL.fmt.dataHora(b.em)) + ' · ' : '') + e(contagensHtml(b.contagens)) + '</small></span>' +
          '<button type="button" class="btn btn-neutro btn-pequeno" data-acao="restaurar" data-chave="' + e(b.chave) + '">Restaurar</button></li>';
      });
      html += '</ul>';
    }
    html += '</div>';
    if (ruins.length) {
      html += '<div class="card"><div class="card-titulo"><i class="ti ti-alert-triangle" aria-hidden="true"></i>Cópias com problema</div><ul class="lista-simples">';
      ruins.forEach(function (r) {
        html += '<li><span class="cfg-cresce">' + (r.em ? e(CL.fmt.dataHora(r.em)) : e(r.chave)) + ' <small class="texto-3">· ' + Math.round(r.tamanho / 1024) + ' KB' + (r.legivel ? '' : ' · ilegível') + '</small></span>' +
          '<button type="button" class="btn btn-neutro btn-pequeno" data-acao="baixar-ruim" data-chave="' + e(r.chave) + '">Baixar</button></li>';
      });
      html += '</ul><div class="linha-acoes cfg-acoes"><button type="button" class="btn btn-fantasma" data-acao="limpar-ruins">Limpar cópias com problema</button></div></div>';
    }
    html += '<div class="card"><div class="card-titulo"><i class="ti ti-user-off" aria-hidden="true"></i>Pacientes inativos <span class="texto-3">(' + inativos.length + ')</span></div>';
    if (!inativos.length) html += '<p class="texto-2">Nenhum paciente inativado. Inativar não apaga: a ficha some das listas e volta daqui.</p>';
    else html += '<ul class="lista-simples">' + inativos.slice(0, 50).map(function (p) { return '<li><span class="cfg-cresce nome-paciente">' + e(CL.nomeExibido(p.nome)) + '<br><small class="texto-3">inativado ' + e(p.inativadoEm ? CL.fmt.dataHora(p.inativadoEm) : '') + '</small></span><button type="button" class="btn btn-neutro btn-pequeno" data-acao="reativar" data-id="' + e(p.id) + '">Reativar</button></li>'; }).join('') + '</ul>' + (inativos.length > 50 ? '<p class="texto-3">Mostrando 50 de ' + inativos.length + '.</p>' : '');
    html += '</div>' +
      '<div class="card"><div class="card-titulo"><i class="ti ti-file-unknown" aria-hidden="true"></i>Textos importados sem paciente <span class="texto-3">(' + soltos.length + ')</span></div>' +
      (soltos.length ? '<p class="texto-2">Registros vindos da importação sem ficha vinculada. Abra um a um para copiar ou vincular a um paciente.</p><div class="linha-acoes cfg-acoes"><button type="button" class="btn btn-neutro" data-acao="soltos"><i class="ti ti-eye" aria-hidden="true"></i>Ver textos</button></div>' : '<p class="texto-2">Nenhum.</p>') + '</div>' +
      '<div class="card"><div class="card-titulo"><i class="ti ti-server" aria-hidden="true"></i>Estado do armazenamento</div><dl class="pilha cfg-dl">' +
      '<div><dt class="rotulo">Modo</dt><dd>' + (st.modo === 'firebase' ? 'sincronizado com o seu servidor' : 'local (este navegador)') + '</dd></div>' +
      '<div><dt class="rotulo">Último salvamento</dt><dd>' + (st.ultimoSaveOk ? e(CL.fmt.dataHora(st.ultimoSaveOk)) : '—') + '</dd></div>' +
      '<div><dt class="rotulo">Pendências</dt><dd>' + (st.pendentes ? 'há alterações não gravadas' : 'nenhuma') + '</dd></div></dl></div>' +
      '<div class="card"><div class="card-titulo"><i class="ti ti-trash" aria-hidden="true"></i>Apagar tudo</div><p class="texto-2">Remove todos os dados deste navegador. Um backup é exportado antes.</p>' +
      '<div class="linha-acoes cfg-acoes"><button type="button" class="btn btn-perigo" data-acao="apagar">Apagar tudo…</button></div></div></div>';
    el.innerHTML = html;
  }
  function abrirSoltos() {
    var soltos = CL.col('evolucoes').filter(function (ev) { return ev && !ev.pacId; }).sort(function (a, b) { return String(b.data || '').localeCompare(String(a.data || '')); });
    if (!soltos.length) { CL.ui.toast('Nenhum texto sem paciente', { kind: 'info' }); return; }
    var corpo = document.createElement('div');
    corpo.className = 'pilha';
    corpo.innerHTML = '<ul class="lista-simples">' + soltos.map(function (ev) { return '<li><span class="cfg-cresce"><strong>' + e(ev.titulo || 'Sem título') + '</strong><br><small class="texto-3">' + e(ev.data ? CL.fmt.dataHora(Date.parse(ev.data) || 0) || ev.data : '') + '</small></span><button type="button" class="btn btn-neutro btn-pequeno" data-solto="' + e(ev.id) + '">Abrir</button></li>'; }).join('') + '</ul>';
    corpo.addEventListener('click', function (ev) { var b = ev.target.closest('[data-solto]'); if (b) abrirSolto(b.getAttribute('data-solto')); });
    CL.ui.modal({ titulo: 'Textos importados sem paciente (' + soltos.length + ')', corpo: corpo, largo: true, botoes: [{ rotulo: 'Fechar', tipo: 'neutro' }] });
  }
  function abrirSolto(id) {
    var ev = CL.get('evolucoes', id);
    if (!ev) return;
    var corpo = document.createElement('div');
    corpo.className = 'pilha';
    corpo.innerHTML = '<pre class="hist-pre cfg-pre"></pre><div class="campo"><label for="solto-busca">Vincular a um paciente</label><div class="busca"><i class="ti ti-search" aria-hidden="true"></i><input id="solto-busca" class="input" type="text" placeholder="Nome, CPF ou telefone"></div><div class="fin-pac-lista" data-lista></div></div>';
    corpo.querySelector('pre').textContent = ev.texto || '';
    var busca = corpo.querySelector('#solto-busca');
    U.semAutofill(busca);
    var lista = corpo.querySelector('[data-lista]');
    busca.addEventListener('input', U.debounce(function () {
      var q = U.valorBusca(busca).trim();
      lista.innerHTML = '';
      if (!q || !window.Pacientes) return;
      var achados = Pacientes.buscar(q, { limite: 6 });
      lista.innerHTML = achados.length ? achados.map(function (p) { return '<button type="button" class="fin-pac-item" data-pac="' + e(p.id) + '"><strong></strong><small class="texto-3">' + e(CL.fmt.idade(p.nasc)) + '</small></button>'; }).join('') : '<div class="fin-pac-vazio texto-3">Nenhum paciente encontrado</div>';
      Array.prototype.forEach.call(lista.querySelectorAll('[data-pac]'), function (b, i) { b.querySelector('strong').textContent = CL.nomeExibido(achados[i].nome); });
    }, 150));
    var m = CL.ui.modal({
      titulo: ev.titulo || 'Texto importado', corpo: corpo, largo: true,
      botoes: [
        { rotulo: 'Copiar texto', tipo: 'neutro', icone: 'ti-clipboard', fecha: false, acao: function () {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ev.texto || '').then(function () { CL.ui.toast('Texto copiado', { kind: 'ok' }); }, function () { CL.ui.toast('Não foi possível copiar', { kind: 'erro' }); });
          else CL.ui.toast('Selecione o texto e copie com Ctrl+C', { kind: 'info' });
        } },
        { rotulo: 'Voltar à lista', tipo: 'primario', acao: function () { abrirSoltos(); return false; } }
      ]
    });
    corpo.addEventListener('click', function (evt) {
      var b = evt.target.closest('[data-pac]'); if (!b) return;
      var pacId = b.getAttribute('data-pac');
      var p = CL.get('pacientes', pacId);
      CL.ui.confirmar({ titulo: 'Vincular ao paciente?', texto: 'O texto passa a aparecer nas evoluções de ' + (p ? p.nome : 'este paciente') + '.', ok: 'Vincular' }).then(function (ok) {
        if (!ok) return;
        CL.patch('evolucoes', id, { pacId: pacId });
        CL.ui.toast('Texto vinculado', { kind: 'ok' });
        m.fechar();
        if (elAtual && abaAtual === 'dados') renderAba(elAtual);
      });
    });
  }

  /* =================== privacidade =================== */
  var ACOES_AUD = { 'ficha.abrir': 'Abriu ficha', 'evolucao.criar': 'Criou evolução', 'evolucao.editar': 'Editou evolução', 'documento.imprimir': 'Imprimiu documento', 'receita.imprimir': 'Imprimiu receita', 'paciente.exportar': 'Exportou dados do paciente', 'dados.exportar': 'Exportou dados', 'dados.importar': 'Importou dados', 'consulta.status': 'Mudou status de consulta', 'login': 'Entrou', 'logout': 'Saiu', 'lgpd.pedido': 'Registrou pedido LGPD', 'lancamento.receber': 'Registrou recebimento', 'lancamento.cancelar': 'Cancelou lançamento' };
  var audPeriodo = { de: '', ate: '' };
  function auditoriaDe(de, ate) {
    var ini = de ? U.dataDe(de).getTime() : 0;
    var fim = ate ? U.dataDe(ate).getTime() + 86400000 : Infinity;
    return CL.col('auditoria').filter(function (a) { return a && a.em >= ini && a.em < fim; }).sort(function (a, b) { return b.em - a.em; });
  }
  function renderPrivacidade(el) {
    var l = cfg().lgpd || {};
    if (!audPeriodo.de) { audPeriodo.de = U.addDias(U.hoje(), -7); audPeriodo.ate = U.hoje(); }
    var aud = auditoriaDe(audPeriodo.de, audPeriodo.ate);
    el.innerHTML = '<div class="pilha"><form class="card cfg-form" data-form="privacidade" novalidate><div class="card-titulo"><i class="ti ti-shield-lock" aria-hidden="true"></i>Responsável pelos dados</div><div class="campos">' +
      campo('lg-resp', 'Nome do responsável (encarregado)', input('lg-resp', l.responsavel, ' maxlength="120"')) +
      campo('lg-contato', 'Contato para pedidos', input('lg-contato', l.contato, ' maxlength="120"'), 'E-mail ou telefone que sai no aviso.') +
      '<div class="campo campo-cheio"><label for="lg-aviso">Aviso de privacidade</label><textarea id="lg-aviso" class="textarea" rows="5" maxlength="2000">' + e(l.aviso || AVISO_PADRAO) + '</textarea></div></div>' +
      '<div class="linha-acoes cfg-acoes"><button type="submit" class="btn btn-primario"><i class="ti ti-device-floppy" aria-hidden="true"></i>Salvar</button><button type="button" class="btn btn-neutro" data-acao="imprimir-aviso"><i class="ti ti-printer" aria-hidden="true"></i>Imprimir aviso</button></div></form>' +
      '<div class="card"><div class="card-titulo"><i class="ti ti-alert-triangle" aria-hidden="true"></i>Se houver um incidente com dados</div><ol class="cfg-checklist"><li>Interrompa o acesso (troque PINs, saia das contas) e exporte a auditoria do período.</li><li>Registre o que vazou, quando e quem foi afetado; avise os pacientes atingidos.</li><li>Comunique a ANPD quando houver risco relevante: <a href="https://www.gov.br/anpd" target="_blank" rel="noopener">gov.br/anpd</a>.</li></ol></div>' +
      '<div class="card"><div class="card-titulo"><i class="ti ti-list-search" aria-hidden="true"></i>Auditoria <span class="texto-3">(' + aud.length + ' no período)</span></div>' +
      '<form class="cfg-inline cfg-aud-filtro" data-form="auditoria" novalidate><label class="sr-only" for="au-de">De</label><input id="au-de" class="input" type="date" value="' + e(audPeriodo.de) + '"><label class="sr-only" for="au-ate">Até</label><input id="au-ate" class="input" type="date" value="' + e(audPeriodo.ate) + '"><button type="submit" class="btn btn-neutro"><i class="ti ti-filter" aria-hidden="true"></i>Filtrar</button><button type="button" class="btn btn-neutro" data-acao="exportar-auditoria"' + (aud.length ? '' : ' disabled') + '><i class="ti ti-download" aria-hidden="true"></i>Exportar auditoria do período</button></form>' +
      (aud.length ? '<div class="tabela-wrap tabela-cartoes"><table class="tabela"><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Alvo</th></tr></thead><tbody>' + aud.slice(0, 200).map(function (a) {
        return '<tr><td data-rotulo="Quando" class="tnum">' + e(CL.fmt.dataHora(a.em)) + '</td><td data-rotulo="Usuário">' + e(a.usuario || a.usuarioId || '—') + ' <small class="texto-3">' + e(CL.fmt.perfil(a.perfil)) + '</small></td><td data-rotulo="Ação">' + e(ACOES_AUD[a.acao] || a.acao) + (a.de && a.para ? ' <small class="texto-3">' + e(a.de + ' → ' + a.para) + '</small>' : '') + '</td><td data-rotulo="Alvo">' + (a.pacId ? '<a href="#/pacientes/' + e(a.pacId) + '/privacidade">ficha do paciente</a>' : e(a.alvo || '—')) + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (aud.length > 200 ? '<p class="texto-3">Mostrando 200 de ' + aud.length + '. Exporte para ver tudo.</p>' : '') : '<p class="texto-2">Nenhum registro no período.</p>') + '</div></div>';
  }
  function salvarPrivacidade(d) {
    if (!podeConfig()) return null;
    d = d || {};
    return CL.setCfg({ lgpd: { responsavel: String(d.responsavel || '').trim(), contato: String(d.contato || '').trim(), aviso: String(d.aviso || '').trim() } }).lgpd;
  }
  function avisoPrivacidade() {
    var l = cfg().lgpd || {}, cl = cfg().clinica || {};
    var corpo = '<p class="doc-pre">' + e(l.aviso || AVISO_PADRAO) + '</p>' +
      '<p><strong>Responsável pelos dados:</strong> ' + e(l.responsavel || '—') + '<br><strong>Contato:</strong> ' + e(l.contato || cl.email || cl.telefone || '—') + '</p>' +
      '<p>Seus direitos (art. 18 da LGPD): confirmação do tratamento, acesso, correção, informação sobre compartilhamentos e, quando cabível, eliminação — observados os prazos legais de guarda do prontuário.</p>';
    return CL.print.documento({ titulo: 'Aviso de privacidade', corpoHtml: corpo, profissional: { nome: cl.nome || '' }, tipoDoc: 'documento', semAssinatura: true, vias: 1, id: 'aviso-privacidade' });
  }
  function exportarAuditoria() {
    var aud = auditoriaDe(audPeriodo.de, audPeriodo.ate);
    var json = JSON.stringify({ app: 'clinicar', tipo: 'auditoria', versao: 1, exportadoEm: new Date().toISOString(), de: audPeriodo.de, ate: audPeriodo.ate, registros: aud }, null, 2);
    U.baixar('clinicar-auditoria-' + audPeriodo.de + '-a-' + audPeriodo.ate + '.json', json, 'application/json');
    CL.audit('dados.exportar', 'auditoria', null, { de: audPeriodo.de, ate: audPeriodo.ate, qtd: aud.length });
    CL.ui.toast('Auditoria exportada (' + aud.length + ' registros)', { kind: 'ok' });
  }

  /* =================== sobre =================== */
  function renderSobre(el) {
    var st = Backend.status();
    var ia = Backend.ai.disponivel();
    el.innerHTML = '<div class="pilha">' +
      '<div class="card"><div class="card-titulo">Clinicar</div><dl class="pilha cfg-dl">' +
      '<div><dt class="rotulo">Versão</dt><dd>' + e(CL.VERSAO) + '</dd></div>' +
      '<div><dt class="rotulo">Modo</dt><dd>' + (st.modo === 'firebase' ? 'sincronizado com o seu servidor' : 'local — sem conta e sem servidor') + '</dd></div>' +
      '<div><dt class="rotulo">Inteligência artificial</dt><dd>' + (ia ? 'disponível' : 'não configurada') + '</dd></div></dl>' +
      (ia ? '' : '<div class="aviso-inline is-info cfg-ia-passos"><i class="ti ti-sparkles" aria-hidden="true"></i><span><strong>Para ligar a IA (gravar consulta, estruturar evolução, resumo do paciente):</strong><ol><li>Crie um projeto próprio no Firebase e ative Authentication (e-mail/senha), Firestore e Functions.</li><li>Publique <code>firestore.rules</code> e <code>functions/</code> do repositório (<code>firebase deploy</code>).</li><li>Cole a configuração web do projeto em <code>config.js</code> e recarregue.</li></ol>Enquanto isso, os botões de IA mostram "Configure o backend".</span></div>') + '</div>' +
      '<div class="card"><p class="prosa">O Clinicar não é prontuário eletrônico certificado. Documentos valem impressos e assinados ou assinados digitalmente com certificado ICP-Brasil.</p></div>' +
      '<div class="card"><div class="card-titulo">Atalhos de teclado</div><ul class="lista-simples cfg-atalhos"><li><kbd>T</kbd> hoje</li><li><kbd>N</kbd> nova consulta</li><li><kbd>Esc</kbd> fecha janelas</li><li><kbd>←</kbd> <kbd>→</kbd> dia anterior / seguinte</li><li><kbd>1</kbd> <kbd>7</kbd> <kbd>M</kbd> <kbd>L</kbd> dia / semana / mês / lista</li><li><kbd>/</kbd> busca</li></ul></div></div>';
  }

  /* =================== casca das abas =================== */
  function renderAba(el) {
    var corpo = el.querySelector('#config-corpo');
    if (!corpo) return;
    Array.prototype.forEach.call(el.querySelectorAll('[data-aba]'), function (b) { if (b.tagName === 'A' || b.tagName === 'BUTTON') b.setAttribute('aria-current', b.getAttribute('data-aba') === abaAtual ? 'page' : 'false'); });
    var sel = el.querySelector('#config-aba-select'); if (sel) sel.value = abaAtual;
    var titulo = el.querySelector('#config-titulo'); var a = ABAS.filter(function (x) { return x[0] === abaAtual; })[0]; if (titulo && a) titulo.textContent = a[1];
    corpo.innerHTML = '';
    if (abaAtual === 'clinica') renderClinica(corpo);
    else if (abaAtual === 'profissionais') renderProfissionais(corpo);
    else if (abaAtual === 'procedimentos') renderProcedimentos(corpo);
    else if (abaAtual === 'convenios') renderConvenios(corpo);
    else if (abaAtual === 'politica') renderPolitica(corpo);
    else if (abaAtual === 'whatsapp') renderWhatsapp(corpo);
    else if (abaAtual === 'usuarios') renderUsuarios(corpo);
    else if (abaAtual === 'dados') renderDados(corpo);
    else if (abaAtual === 'privacidade') renderPrivacidade(corpo);
    else if (abaAtual === 'importar') { if (window.Importar) Importar.mount(corpo); }
    else renderSobre(corpo);
  }
  function aoClicar(ev) {
    var b = ev.target.closest('[data-aba], [data-acao]');
    if (!b || b.tagName === 'SELECT') return;
    if (b.hasAttribute('data-aba')) { ev.preventDefault(); CL.route.go('#/config/' + b.getAttribute('data-aba')); return; }
    var acao = b.getAttribute('data-acao'), chave = b.getAttribute('data-chave'), id = b.getAttribute('data-id');
    if (acao === 'exportar') Config.exportarTudo();
    else if (acao === 'recuperacao') Config.abrirRecuperacao();
    else if (acao === 'restaurar') restaurar(chave);
    else if (acao === 'baixar-ruim') U.baixar('clinicar-copia-problema-' + chave.replace(/^ca\.v1\.ruim\./, '') + '.json', localStorage.getItem(chave) || '', 'application/json');
    else if (acao === 'limpar-ruins') CL.ui.confirmar({ titulo: 'Limpar cópias com problema', texto: 'As cópias ilegíveis serão removidas. Baixe antes se quiser guardá-las.', ok: 'Limpar', okTipo: 'perigo' }).then(function (ok) { if (ok) { Backend.limparRuins(); CL.ui.toast('Cópias removidas', { kind: 'ok' }); renderAba(elAtual); } });
    else if (acao === 'apagar') Config.apagarTudo();
    else if (acao === 'reativar') { if (window.Pacientes && Pacientes.reativar) Pacientes.reativar(id); }
    else if (acao === 'soltos') abrirSoltos();
    else if (acao === 'prof-novo') abrirProfissional(null);
    else if (acao === 'prof-editar') abrirProfissional(id);
    else if (acao === 'proc-novo') abrirProcedimento(null);
    else if (acao === 'proc-editar') abrirProcedimento(id);
    else if (acao === 'usr-novo') abrirUsuario(null);
    else if (acao === 'usr-editar') abrirUsuario(id);
    else if (acao === 'conv-renomear') { var c = CL.get('convenios', id); if (c) CL.ui.pedirTexto({ titulo: 'Renomear convênio', rotulo: 'Nome', valor: c.nome }).then(function (v) { if (v && v.trim()) { salvarConvenio({ id: id, nome: v.trim() }); CL.ui.toast('Convênio renomeado', { kind: 'ok' }); } }); }
    else if (acao === 'conv-ativo') { var cv = CL.get('convenios', id); if (cv) { salvarConvenio({ id: id, ativo: cv.ativo === false }); CL.ui.toast(cv.ativo === false ? 'Convênio reativado' : 'Convênio inativado', { kind: 'ok' }); } }
    else if (acao === 'wa-padrao') restaurarWaPadrao();
    else if (acao === 'logo-remover') CL.ui.confirmar({ titulo: 'Remover a logo?', texto: 'Os documentos passam a sair sem logo.', ok: 'Remover', okTipo: 'perigo' }).then(function (ok) { if (ok) { Backend.logo.set(''); CL.ui.toast('Logo removida', { kind: 'ok' }); renderAba(elAtual); } });
    else if (acao === 'imprimir-aviso') avisoPrivacidade();
    else if (acao === 'exportar-auditoria') exportarAuditoria();
  }
  function aoMudar(ev) {
    var t = ev.target;
    if (t && t.id === 'config-aba-select') CL.route.go('#/config/' + t.value);
  }
  function aoSubmeter(ev) {
    var f = ev.target.closest('form[data-form]');
    if (!f) return;
    ev.preventDefault();
    var tipo = f.getAttribute('data-form');
    var g = function (id) { return f.querySelector('#' + id); };
    if (tipo === 'clinica') {
      salvarClinica({ nome: g('cl-nome').value, endereco: g('cl-endereco').value, telefone: g('cl-telefone').value, email: g('cl-email').value, cnpj: g('cl-cnpj').value, rodape: g('cl-rodape').value });
      CL.ui.toast('Dados da clínica salvos', { kind: 'ok' });
    } else if (tipo === 'convenio') {
      var nome = g('cv-nome').value.trim();
      if (!nome) { CL.ui.toast('Digite o nome do convênio', { kind: 'aviso' }); return; }
      var s = salvarConvenio({ nome: nome });
      if (s) { CL.ui.toast('Convênio adicionado: ' + s.nome, { kind: 'ok' }); g('cv-nome').value = ''; }
    } else if (tipo === 'politica') {
      var modo = g('po-taxa-modo').value, bruto = g('po-taxa').value;
      salvarPolitica({ janelaCancelamentoH: g('po-janela').value, taxaFaltaCent: modo === 'valor' ? U.centavos(bruto) : 0, taxaFaltaPct: modo === 'pct' ? parseFloat(String(bruto).replace(',', '.')) || 0 : 0, cobrarTardio: g('po-tardio').checked, texto: g('po-texto').value });
      CL.ui.toast('Política salva', { kind: 'ok' });
    } else if (tipo === 'whatsapp') {
      var modelos = {};
      Array.prototype.forEach.call(f.querySelectorAll('[data-wa]'), function (t) { modelos[t.getAttribute('data-wa')] = t.value; });
      salvarWhatsapp(modelos);
      CL.ui.toast('Modelos salvos', { kind: 'ok' });
    } else if (tipo === 'privacidade') {
      salvarPrivacidade({ responsavel: g('lg-resp').value, contato: g('lg-contato').value, aviso: g('lg-aviso').value });
      CL.ui.toast('Privacidade salva', { kind: 'ok' });
    } else if (tipo === 'auditoria') {
      audPeriodo = { de: g('au-de').value || '', ate: g('au-ate').value || '' };
      if (audPeriodo.de && audPeriodo.ate && audPeriodo.de > audPeriodo.ate) { var x = audPeriodo.de; audPeriodo.de = audPeriodo.ate; audPeriodo.ate = x; }
      renderAba(elAtual);
    }
  }
  function restaurar(chave) {
    var b = Backend.backups().filter(function (x) { return x.chave === chave; })[0];
    if (!b) return;
    CL.ui.confirmar({ titulo: 'Restaurar esta cópia?', texto: 'Os dados atuais serão substituídos por: ' + contagensHtml(b.contagens) + '. A versão atual fica guardada como cópia com problema.', ok: 'Restaurar', okTipo: 'perigo' })
      .then(function (ok) {
        if (!ok) return;
        return Backend.restaurar(chave).then(function () {
          CL.audit('dados.importar', 'backup', chave);
          CL.ui.toast('Cópia restaurada', { kind: 'ok' });
          if (elAtual) renderAba(elAtual);
          CL.route.remontar();
        });
      })
      .catch(function (err) { CL.ui.toast('Não foi possível restaurar: ' + err.message, { kind: 'erro', fixo: true }); });
  }

  var Config = window.Config = {
    mount: function (el, params) {
      elAtual = el;
      var abas = abasPermitidas();
      abaAtual = (params && params.seg && params.seg[0]) || (CL.can('config') ? 'clinica' : 'sobre');
      if (!abas.some(function (a) { return a[0] === abaAtual; })) abaAtual = abas[0][0];
      var html = '<div class="tela cfg"><div class="tela-cabeca"><h1>Ajustes</h1><span class="texto-3 cfg-titulo-aba" id="config-titulo"></span></div><div class="cfg-layout">' +
        '<nav class="cfg-abas" aria-label="Seções dos ajustes">' + abas.map(function (a) { return '<a href="#/config/' + a[0] + '" data-aba="' + a[0] + '"><i class="ti ' + a[2] + '" aria-hidden="true"></i><span>' + a[1] + '</span></a>'; }).join('') + '</nav>' +
        '<div class="cfg-abas-select"><label class="sr-only" for="config-aba-select">Seção</label><select id="config-aba-select" class="select">' + abas.map(function (a) { return opt(a[0], a[1], abaAtual); }).join('') + '</select></div>' +
        '<div id="config-corpo" class="cfg-corpo"></div></div></div>';
      el.innerHTML = html;
      el.addEventListener('click', aoClicar);
      el.addEventListener('change', aoMudar);
      el.addEventListener('submit', aoSubmeter);
      renderAba(el);
      unChange = CL.on('change', function (info) {
        if (!elAtual) return;
        var col = info && info.col;
        var mapa = { dados: ['pacientes', 'evolucoes', '*'], profissionais: ['profissionais', 'usuarios', '*'], procedimentos: ['procedimentos', '*'], convenios: ['convenios', '*'], usuarios: ['usuarios', 'profissionais', '*'] };
        if (!mapa[abaAtual] || mapa[abaAtual].indexOf(col) < 0) return;
        if (CL.ui.aberto().modal) renderPendente = true; else renderMantendoFoco(elAtual);
      });
      unSession = CL.on('privacidade', function () { if (elAtual && abaAtual === 'dados') renderAba(elAtual); });
    },
    unmount: function () {
      if (unChange) { unChange(); unChange = null; }
      if (unSession) { unSession(); unSession = null; }
      if (elAtual) { elAtual.removeEventListener('click', aoClicar); elAtual.removeEventListener('change', aoMudar); elAtual.removeEventListener('submit', aoSubmeter); }
      if (window.Importar && typeof Importar.unmount === 'function') Importar.unmount();
      elAtual = null;
    },
    exportarTudo: function () {
      var nome = 'clinicar-backup-' + U.hoje() + '.json';
      U.baixar(nome, Backend.exportar(), 'application/json');
      Backend.meta.set({ ultimoExport: Date.now() });
      CL.audit('dados.exportar', 'state', null);
      CL.ui.toast('Backup exportado: ' + nome, { kind: 'ok' });
    },
    abrirRecuperacao: function (motivo) {
      motivo = motivo || {};
      var bks = Backend.backups();
      var ruins = Backend.chavesRuins();
      var atual = contagensDe(CL.state);
      var corpo = document.createElement('div');
      corpo.className = 'pilha';
      var aviso = '';
      if (motivo.tipo === 'trava') aviso = 'O salvamento foi bloqueado: a memória do app está vazia, mas este navegador tem ' + motivo.contagemGravada + ' registros gravados. Nada foi apagado.';
      else if (motivo.tipo === 'corrompido') aviso = 'A cópia principal estava ilegível e foi preservada' + (motivo.backup ? '; a cópia automática mais recente foi carregada.' : ', mas não há cópia automática com dados.');
      var html = (aviso ? '<div class="aviso-inline ' + (motivo.tipo ? 'is-erro' : '') + '" role="alert"><i class="ti ti-alert-triangle" aria-hidden="true"></i><span>' + e(aviso) + '</span></div>' : '') +
        '<p class="texto-2">Em memória agora: ' + e(contagensHtml(atual)) + '.</p>';
      if (bks.length) {
        html += '<h3>Cópias automáticas</h3><ul class="lista-simples">';
        bks.forEach(function (b) {
          html += '<li><span class="cfg-cresce"><strong>' + e(b.chave.replace('clinicar.v1.bk.', 'Cópia ')) + '</strong><br><small class="texto-3">' + (b.em ? e(CL.fmt.dataHora(b.em)) + ' · ' : '') + e(contagensHtml(b.contagens)) + '</small></span>' +
            '<button type="button" class="btn btn-primario btn-pequeno" data-rec="restaurar" data-chave="' + e(b.chave) + '">Restaurar</button></li>';
        });
        html += '</ul>';
      } else html += '<p class="texto-2">Não há cópias automáticas neste navegador.</p>';
      if (ruins.length) {
        html += '<h3>Cópias com problema</h3><ul class="lista-simples">';
        ruins.forEach(function (r) {
          html += '<li><span class="cfg-cresce">' + (r.em ? e(CL.fmt.dataHora(r.em)) : e(r.chave)) + ' <small class="texto-3">· ' + Math.round(r.tamanho / 1024) + ' KB' + (r.legivel ? '' : ' · ilegível') + '</small></span>' +
            '<button type="button" class="btn btn-neutro btn-pequeno" data-rec="baixar" data-chave="' + e(r.chave) + '">Baixar</button></li>';
        });
        html += '</ul>';
      }
      corpo.innerHTML = html;
      var m = CL.ui.modal({
        titulo: 'Recuperação de dados', corpo: corpo, largo: true,
        botoes: [
          { rotulo: 'Exportar o que está em memória', tipo: 'neutro', icone: 'ti-download', acao: function () { Config.exportarTudo(); }, fecha: false },
          { rotulo: 'Fechar', tipo: 'primario' }
        ]
      });
      corpo.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-rec]'); if (!b) return;
        var chave = b.getAttribute('data-chave');
        if (b.getAttribute('data-rec') === 'baixar') { U.baixar('clinicar-copia-problema.json', localStorage.getItem(chave) || '', 'application/json'); return; }
        m.fechar();
        restaurar(chave);
      });
      return m;
    },
    apagarTudo: function () {
      if (!podeConfig()) return null;
      var corpo = document.createElement('div');
      corpo.className = 'pilha';
      corpo.innerHTML = '<p>Todos os dados deste navegador serão apagados. Um backup será baixado antes.</p>' +
        '<div class="campo"><label for="apagar-confirma">Digite REMOVER para confirmar</label><input id="apagar-confirma" class="input" type="text" autocomplete="off" autofocus></div>';
      return CL.ui.modal({
        titulo: 'Apagar tudo', corpo: corpo,
        botoes: [
          { rotulo: 'Cancelar', tipo: 'neutro' },
          { rotulo: 'Apagar tudo', tipo: 'perigo', acao: function () {
            var v = corpo.querySelector('input').value.trim();
            if (v !== 'REMOVER') { CL.ui.toast('Digite REMOVER exatamente assim para confirmar', { kind: 'aviso' }); return false; }
            Config.exportarTudo();
            return CL.lote(function () {
              CL.substituirEstado(CL.defaultState());
              return Backend.save(CL.state, { forcarVazio: true });
            }).then(function () {
              Backend.meta.set({ contagemUltimoSave: 0, contagemTotal: 0 });
              CL.ui.toast('Dados apagados', { kind: 'ok' });
              return CL.seed();
            }).then(function () { CL.route.remontar(); });
          } }
        ]
      });
    },
    salvarClinica: salvarClinica,
    salvarProfissional: salvarProfissional,
    salvarProcedimento: salvarProcedimento,
    salvarConvenio: salvarConvenio,
    salvarUsuario: salvarUsuario,
    salvarPolitica: salvarPolitica,
    salvarWhatsapp: salvarWhatsapp,
    salvarPrivacidade: salvarPrivacidade,
    avisoPrivacidade: avisoPrivacidade,
    abrirProfissional: abrirProfissional,
    abrirProcedimento: abrirProcedimento,
    abrirUsuario: abrirUsuario,
    processarLogo: processarLogo,
    previaWhatsapp: previaWa,
    CORES: CORES,
    AVISO_PADRAO: AVISO_PADRAO
  };
  CL.route.register('config', Config);
})();
