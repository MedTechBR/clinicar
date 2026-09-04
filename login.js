/* Clinicar — login.js
   Tela de login PRÓPRIA no visual do produto. Modo local: faixa "Modo local" + lista de usuários (PIN opcional).
   Modo firebase: e-mail + senha e depois a mesma lista de usuários/perfis. Contrato: docs/ESPEC.md §4.6. */
(function () {
  'use strict';

  var promessaGate = null, resolverGate = null, elRaiz = null, unChange = null;
  var estado = { pinPara: null, erroPin: '', erroLogin: '', ocupado: false };

  function ativos() { return CL.col('usuarios').filter(function (u) { return u && u.ativo !== false; }); }
  function garantirUsuarios() {
    if (ativos().length) return;
    if (!CL.get('usuarios', 'usr-admin')) CL.upsert('usuarios', { id: 'usr-admin', nome: 'Administração', perfil: 'admin', profId: null, pinHash: '', ativo: true });
    else CL.patch('usuarios', 'usr-admin', { ativo: true });
  }
  function precisaEmail() { return Backend.modo === 'firebase' && !Backend.auth.user; }

  function render() {
    if (!elRaiz) return;
    var e = CL.util.esc;
    var local = Backend.modo !== 'firebase';
    var html = '<div class="login"><div class="login-cartao">' +
      '<div class="login-marca"><span class="login-logo" aria-hidden="true"><i class="ti ti-calendar-heart"></i></span>' +
      '<h1>Clinicar</h1><p>A agenda e o prontuário da sua clínica, no seu próprio site.</p></div>';
    if (local) {
      html += '<div class="login-faixa" role="note"><i class="ti ti-device-desktop" aria-hidden="true"></i><span><strong>Modo local</strong> — os dados ficam neste navegador. Faça backups em Configurações › Dados.</span></div>';
    }
    if (precisaEmail()) {
      html += '<form class="login-form" data-form="email" novalidate>' +
        '<div class="campo"><label for="login-email">E-mail</label><input id="login-email" name="email" type="email" autocomplete="email" required inputmode="email"></div>' +
        '<div class="campo"><label for="login-senha">Senha</label><input id="login-senha" name="senha" type="password" autocomplete="current-password" required></div>' +
        (estado.erroLogin ? '<div class="aviso-inline is-erro" role="alert"><i class="ti ti-alert-circle" aria-hidden="true"></i><span>' + e(estado.erroLogin) + '</span></div>' : '') +
        '<button type="submit" class="btn btn-primario btn-largo"' + (estado.ocupado ? ' disabled' : '') + '><i class="ti ti-login" aria-hidden="true"></i>Entrar</button>' +
        '<button type="button" class="btn-link" data-acao="esqueci">Esqueci a senha</button></form>';
    } else {
      garantirUsuarios();
      html += '<h2>Quem está usando?</h2><div class="login-usuarios">';
      ativos().forEach(function (u) {
        html += '<button type="button" class="login-usuario" data-acao="entrar" data-id="' + e(u.id) + '">' +
          '<span class="avatar avatar-lg" aria-hidden="true">' + e(CL.util.iniciais(u.nome)) + '</span>' +
          '<span><strong>' + e(u.nome) + '</strong><small>' + e(CL.fmt.perfil(u.perfil)) + (u.pinHash ? ' · com PIN' : '') + '</small></span>' +
          (u.pinHash ? '<i class="ti ti-lock" aria-hidden="true"></i>' : '<i class="ti ti-chevron-right" aria-hidden="true"></i>') + '</button>';
        if (estado.pinPara === u.id) {
          html += '<form class="login-pin" data-form="pin" data-id="' + e(u.id) + '">' +
            '<div class="campo"><label for="login-pin">PIN de ' + e(CL.util.primeiroNome(u.nome)) + '</label>' +
            '<input id="login-pin" class="input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" autofocus></div>' +
            '<button type="submit" class="btn btn-primario">Entrar</button></form>' +
            (estado.erroPin ? '<div class="campo-erro" role="alert"><i class="ti ti-alert-circle" aria-hidden="true"></i>' + e(estado.erroPin) + '</div>' : '');
        }
      });
      html += '</div>';
      if (Backend.modo === 'firebase') html += '<button type="button" class="btn btn-fantasma" data-acao="sair-conta"><i class="ti ti-logout" aria-hidden="true"></i>Sair da conta</button>';
    }
    html += '<div class="login-rodape">Clinicar · versão ' + e(CL.VERSAO) + '</div></div></div>';
    elRaiz.innerHTML = html;
    var foco = elRaiz.querySelector('[autofocus]') || elRaiz.querySelector('input') || elRaiz.querySelector('.login-usuario');
    if (foco) requestAnimationFrame(function () { try { foco.focus(); } catch (err) { /* sem foco */ } });
  }

  function entrar(u) {
    CL.sessao.set(u);
    CL.audit('login', 'usuarios', u.id);
    if (!CL.pref.get('login.dicaPin', false) && !u.pinHash) {
      CL.pref.set('login.dicaPin', true);
      CL.ui.toast('Dica: defina um PIN por usuário em Ajustes › Usuários.', { kind: 'info', ms: 6000 });
    }
    concluir();
  }
  function concluir() {
    estado.pinPara = null; estado.erroPin = ''; estado.erroLogin = '';
    if (unChange) { unChange(); unChange = null; }
    if (elRaiz) { elRaiz.innerHTML = ''; elRaiz.hidden = true; }
    var r = resolverGate; promessaGate = null; resolverGate = null;
    if (r) r();
  }

  function aoClicar(ev) {
    var b = ev.target.closest('[data-acao]');
    if (!b) return;
    var acao = b.getAttribute('data-acao');
    if (acao === 'entrar') {
      var u = CL.get('usuarios', b.getAttribute('data-id'));
      if (!u) return;
      if (u.pinHash) { estado.pinPara = u.id; estado.erroPin = ''; render(); return; }
      entrar(u);
    } else if (acao === 'esqueci') {
      var email = (elRaiz.querySelector('#login-email') || {}).value || '';
      if (!email.trim()) { estado.erroLogin = 'Digite o e-mail para receber o link de redefinição.'; render(); return; }
      Backend.auth.redefinirSenha(email).then(function () {
        CL.ui.toast('Enviamos um link de redefinição para ' + email.trim(), { kind: 'ok', ms: 6000 });
      }).catch(function (err) { estado.erroLogin = mensagemAuth(err); render(); });
    } else if (acao === 'sair-conta') {
      Backend.auth.sair().then(function () { location.reload(); });
    }
  }
  function mensagemAuth(err) {
    var code = (err && err.code) || '';
    /* O servidor responde o mesmo código para senha errada e para conta inexistente
       (proteção contra descobrir quais e-mails existem). A mensagem cobre os dois casos. */
    if (/wrong-password|invalid-credential|invalid-login-credentials|user-not-found/i.test(code)) return 'E-mail ou senha não conferem — e a resposta é a mesma quando a conta ainda não foi criada. Confira o e-mail, use "Esqueci a senha" ou peça ao administrador para criar a conta da clínica.';
    if (/invalid-email/i.test(code)) return 'E-mail inválido.';
    if (/too-many-requests/i.test(code)) return 'Muitas tentativas. Aguarde alguns minutos.';
    if (/network-request-failed/i.test(code)) return 'Sem rede. Verifique a conexão e tente de novo.';
    if (/invalid-api-key|api-key-not-valid|app-not-authorized|configuration-not-found/i.test(code)) return 'A configuração em config.js não é válida. Confira os dados copiados do console.';
    return 'Não foi possível entrar: ' + Backend.auth.traduzirErro(err);
  }
  function aoSubmeter(ev) {
    var f = ev.target.closest('form[data-form]');
    if (!f) return;
    ev.preventDefault();
    if (f.getAttribute('data-form') === 'pin') {
      var u = CL.get('usuarios', f.getAttribute('data-id'));
      var pin = (f.querySelector('input') || {}).value || '';
      if (!u) return;
      CL.util.sha256(pin).then(function (hash) {
        if (hash === u.pinHash) entrar(u);
        else { estado.erroPin = 'PIN incorreto.'; render(); }
      });
      return;
    }
    if (f.getAttribute('data-form') === 'email') {
      var email = f.querySelector('#login-email').value, senha = f.querySelector('#login-senha').value;
      if (!email.trim() || !senha) { estado.erroLogin = 'Preencha e-mail e senha.'; render(); return; }
      estado.ocupado = true; estado.erroLogin = ''; render();
      Backend.auth.entrar(email, senha).then(function () {
        estado.ocupado = false; render();
      }).catch(function (err) { estado.ocupado = false; estado.erroLogin = mensagemAuth(err); render(); });
    }
  }

  var Login = window.Login = {
    gate: function () {
      if (CL.session) return Promise.resolve();
      if (promessaGate) return promessaGate;
      promessaGate = new Promise(function (r) { resolverGate = r; });
      var restaurada = !precisaEmail() && CL.sessao.restaurar();
      if (restaurada) { concluir(); return Promise.resolve(); }
      Login.mount(document.getElementById('login-raiz'));
      return promessaGate;
    },
    mount: function (el) {
      elRaiz = el;
      if (!elRaiz) return;
      elRaiz.hidden = false;
      if (!elRaiz.__ligado) {
        elRaiz.addEventListener('click', aoClicar);
        elRaiz.addEventListener('submit', aoSubmeter);
        elRaiz.__ligado = true;
      }
      if (!unChange) unChange = CL.on('change', function (info) { if (info && (info.col === 'usuarios' || info.col === '*')) render(); });
      render();
    },
    sair: function () {
      try { CL.audit('logout', 'usuarios', CL.session ? CL.session.usuarioId : null); } catch (e) { /* sem sessão */ }
      var firebase = Backend.modo === 'firebase';
      CL.sessao.clear();
      if (firebase) {
        /* Garante que nada do usuário anterior fique em memória num computador compartilhado. */
        Backend.auth.sair().then(function () { location.replace(location.pathname + location.search + '#/login'); location.reload(); });
        return;
      }
      CL.route.go('#/login');
    },
    trocarUsuario: function () {
      try { CL.audit('logout', 'usuarios', CL.session ? CL.session.usuarioId : null); } catch (e) { /* sem sessão */ }
      CL.sessao.clear();
      CL.route.go('#/login');
    }
  };
})();
