/* Clinicar — backend.js
   Interface ÚNICA de persistência, autenticação e IA, com dois adaptadores escolhidos em init():
     local    (padrão)  → localStorage com blindagem (backup rotativo, trava do 1º save, chave ruim preservada, cota)
     firebase           → só quando config.js tem apiKey + projectId E o SDK carregou; um documento por item,
                          transação por item (nunca grava o estado inteiro, nunca cai para gravação crua), merge
                          item a item com lápides (updatedAt vence; empate fica com o local).
   Depende só de CL.util / CL.ui.toast / CL.emit. Contrato: docs/ESPEC.md §4.5. */
(function () {
  'use strict';

  var K = {
    state: 'clinicar.v1.state', bk: ['clinicar.v1.bk.1', 'clinicar.v1.bk.2', 'clinicar.v1.bk.3'], meta: 'clinicar.v1.meta',
    logo: 'clinicar.v1.logo', sessao: 'clinicar.v1.sessao', pref: 'clinicar.v1.pref', ruim: 'clinicar.v1.ruim.',
    rascunhos: 'clinicar.v1.rascunhos'   /* gravada por atendimento.js; sai no "Sair" como todo clinicar.v1.* (só o pref fica) */
  };
  var SDK = 'https://www.gstatic.com/firebasejs/10.13.2/';
  var TETO_AUDIO = 9000000;
  var TETO_LOGO = 900000;      /* documento do Firestore tem teto de 1 MiB; a logo processada fica em ~120 KB */
  var ls = window.localStorage;
  var status = { modo: 'local', online: navigator.onLine, ultimoSaveOk: null, ultimoSync: null, pendentes: false };
  var sessaoSalvou = false;
  var problemaCarga = null;
  var avisoQuota = null;

  function cols() { return CL.COLECOES; }
  function lerMeta() {
    try { var m = JSON.parse(ls.getItem(K.meta)); return (m && typeof m === 'object') ? m : {}; } catch (e) { return {}; }
  }
  function gravarMeta(patch) {
    var m = Object.assign(lerMeta(), patch || {});
    try { ls.setItem(K.meta, JSON.stringify(m)); } catch (e) { /* meta é auxiliar */ }
    return m;
  }
  function contagens(state) {
    var c = { total: 0 };
    cols().forEach(function (col) { c[col] = (state && Array.isArray(state[col])) ? state[col].length : 0; c.total += c[col]; });
    c.pc = c.pacientes + c.consultas;
    return c;
  }
  function parseSeguro(raw) {
    if (!raw) return null;
    try { var st = JSON.parse(raw); return (st && typeof st === 'object' && !Array.isArray(st)) ? st : null; } catch (e) { return null; }
  }
  function eCota(e) {
    return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
  }
  function abrirRecuperacao(motivo) {
    var abrir = function () {
      if (window.Config && typeof Config.abrirRecuperacao === 'function') Config.abrirRecuperacao(motivo);
      else CL.ui.toast('Há um problema com os dados guardados neste navegador. Abra Ajustes › Dados › Recuperação.', { kind: 'erro', fixo: true });
    };
    if (CL.ready && typeof CL.ready.then === 'function') CL.ready.then(abrir); else abrir();
  }
  function avisarCota() {
    if (avisoQuota) return;
    avisoQuota = CL.ui.toast('Espaço do navegador cheio — exporte um backup', {
      kind: 'erro', fixo: true,
      action: { rotulo: 'Exportar agora', fn: function () { avisoQuota = null; CL.util.baixar('clinicar-backup-' + CL.util.hoje() + '.json', Backend.exportar(), 'application/json'); } }
    });
  }

  /* =================== merge puro (testável) =================== */
  function merge(remoto, local) {
    local = local || CL.defaultState();
    if (!remoto || typeof remoto !== 'object') return local;
    var out = Object.assign({}, local);
    var tomb = Object.assign({}, remoto._tomb || {});
    var lt = local._tomb || {};
    Object.keys(lt).forEach(function (id) { if (!(id in tomb) || lt[id] > tomb[id]) tomb[id] = lt[id]; });
    var nomes = {};
    cols().forEach(function (c) { nomes[c] = true; });
    Object.keys(remoto).forEach(function (k) { if (Array.isArray(remoto[k])) nomes[k] = true; });
    Object.keys(local).forEach(function (k) { if (Array.isArray(local[k])) nomes[k] = true; });
    Object.keys(nomes).forEach(function (col) {
      var R = Array.isArray(remoto[col]) ? remoto[col] : [];
      var L = Array.isArray(local[col]) ? local[col] : [];
      var porId = new Map();
      var considerar = function (it) {
        if (!it || it.id == null) return;
        var prev = porId.get(it.id);
        if (!prev || (+it.updatedAt || 0) >= (+prev.updatedAt || 0)) porId.set(it.id, it);
      };
      R.forEach(considerar); L.forEach(considerar);   /* local por último: empate fica com o local */
      out[col] = Array.from(porId.values()).filter(function (x) { return !(x.id in tomb && tomb[x.id] >= (+x.updatedAt || 0)); });
    });
    var rc = remoto.cfg, lc = local.cfg;
    if (rc && typeof rc === 'object' && (+rc.updatedAt || 0) > (+(lc && lc.updatedAt) || 0)) out.cfg = rc;
    else out.cfg = lc || rc || CL.defaultCfg();
    out._tomb = tomb;
    return out;
  }
  function compactTomb(state, dias) {
    var limite = Date.now() - (dias == null ? 90 : dias) * 86400000;
    var t = state._tomb || {};
    Object.keys(t).forEach(function (id) { if (+t[id] < limite) delete t[id]; });
    state._tomb = t;
    return state;
  }

  /* =================== adaptador LOCAL =================== */
  function melhorBackup() {
    for (var i = 0; i < K.bk.length; i++) {
      var st = parseSeguro(ls.getItem(K.bk[i]));
      if (st && contagens(st).total > 0) return { chave: K.bk[i], state: st };
    }
    return null;
  }
  function temDadosRaw(raw, info) {
    if (info && typeof info.total === 'number') return info.total > 0;
    var st = parseSeguro(raw);
    return !!st && contagens(st).total > 0;
  }
  function rotacionar(cNovo, meta) {
    var rawAtual = ls.getItem(K.state);
    if (!rawAtual) return;
    var totalAtual = meta.contagemTotal, pcAtual = meta.contagemUltimoSave;
    if (typeof totalAtual !== 'number') {
      var st = parseSeguro(rawAtual);
      if (!st) return;
      var ca = contagens(st); totalAtual = ca.total; pcAtual = ca.pc;
    }
    if (!(totalAtual > 0)) return;              /* nunca rotaciona uma cópia vazia */
    if (totalAtual === cNovo.total) return;     /* contagem igual: nada a guardar */
    var bkMeta = (meta.bk && typeof meta.bk === 'object') ? meta.bk : {};
    var mover = function (de, para) {
      var v = ls.getItem(de);
      if (v && temDadosRaw(v, bkMeta[de])) { ls.setItem(para, v); bkMeta[para] = bkMeta[de] || { em: null, total: null }; }
    };
    mover(K.bk[1], K.bk[2]);
    mover(K.bk[0], K.bk[1]);
    ls.setItem(K.bk[0], rawAtual);
    bkMeta[K.bk[0]] = { em: meta.ultimoSaveOk || Date.now(), total: totalAtual, pc: pcAtual };
    gravarMeta({ bk: bkMeta });
  }

  var Local = {
    load: function () {
      var raw = ls.getItem(K.state);
      if (raw === null || raw === undefined) return CL.normalizar(CL.defaultState());
      var st = parseSeguro(raw);
      if (st) return CL.normalizar(st);
      var chaveRuim = K.ruim + Date.now();
      try { ls.setItem(chaveRuim, raw); } catch (e) { console.error('[Backend] não coube guardar a chave ruim', e); }
      ls.removeItem(K.state);
      var bk = melhorBackup();
      problemaCarga = { tipo: 'corrompido', chaveRuim: chaveRuim, backup: bk ? bk.chave : null };
      return CL.normalizar(bk ? bk.state : CL.defaultState());
    },
    save: function (state, opts) {
      opts = opts || {};
      return new Promise(function (resolve, reject) {
        var c = contagens(state);
        var meta = lerMeta();
        if (c.pc === 0 && (meta.contagemUltimoSave | 0) > 0 && !opts.forcarVazio) {
          status.pendentes = true;
          abrirRecuperacao({ tipo: 'trava', contagemGravada: meta.contagemUltimoSave });
          var err = new Error('Salvamento bloqueado: a memória está vazia, mas há ' + meta.contagemUltimoSave + ' registros gravados neste navegador.');
          err.code = 'trava';
          return reject(err);
        }
        var texto;
        try { texto = JSON.stringify(state); } catch (e) { return reject(e); }
        try { rotacionar(c, meta); }
        catch (e1) {
          if (eCota(e1)) { try { ls.removeItem(K.bk[2]); rotacionar(c, lerMeta()); } catch (e2) { /* segue sem rotação */ } }
          else console.error('[Backend] rotação falhou', e1);
        }
        try { ls.setItem(K.state, texto); }
        catch (e) {
          if (eCota(e)) {
            status.pendentes = true;
            avisarCota();
            var errCota = new Error('Espaço do navegador cheio — exporte um backup');
            errCota.code = 'cota';
            return reject(errCota);
          }
          return reject(e);
        }
        sessaoSalvou = true;
        status.pendentes = false;
        status.ultimoSaveOk = Date.now();
        gravarMeta({ ultimoSaveOk: status.ultimoSaveOk, contagemUltimoSave: c.pc, contagemTotal: c.total, sessaoSalvou: true });
        resolve();
      });
    },
    subscribe: function (fn) {
      var h = function (e) {
        if (e.key !== K.state || !e.newValue) return;
        var st = parseSeguro(e.newValue);
        if (st) fn(CL.normalizar(st));
      };
      window.addEventListener('storage', h);
      return function () { window.removeEventListener('storage', h); };
    }
  };

  /* =================== adaptador FIREBASE =================== */
  var FB = { app: null, auth: null, db: null, fns: null, mods: null, uid: null, remoto: {}, unsubs: [], ouvintesAuth: [], primeiroAuth: true, assinante: null, saindo: false, trocandoConta: false };
  function importarModulo(url) { return import(url); }
  function limparParaFirestore(obj) { return JSON.parse(JSON.stringify(obj)); }
  function traduzirErro(e) {
    var code = (e && e.code) || '';
    if (/network|unavailable/i.test(code)) return 'sem acesso à rede';
    if (/permission-denied/i.test(code)) return 'sem permissão (as regras do banco não foram publicadas?)';
    if (/invalid-api-key|api-key-not-valid|app-not-authorized/i.test(code)) return 'configuração inválida em config.js';
    if (/not-found/i.test(code)) return 'função não publicada';
    return (e && e.message) || 'erro desconhecido';
  }
  function iniciarFirebase(config) {
    return Promise.all([
      importarModulo(SDK + 'firebase-app.js'),
      importarModulo(SDK + 'firebase-auth.js'),
      importarModulo(SDK + 'firebase-firestore.js'),
      importarModulo(SDK + 'firebase-functions.js')
    ]).then(function (m) {
      FB.mods = { app: m[0], auth: m[1], fs: m[2], fn: m[3] };
      FB.app = FB.mods.app.initializeApp({
        apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId,
        storageBucket: config.storageBucket, messagingSenderId: config.messagingSenderId, appId: config.appId
      });
      FB.auth = FB.mods.auth.getAuth(FB.app);
      FB.db = FB.mods.fs.getFirestore(FB.app);
      FB.fns = FB.mods.fn.getFunctions(FB.app, config.regiaoFunctions || 'southamerica-east1');
      return new Promise(function (resolve) {
        var pronto = false;
        var timer = setTimeout(function () { if (!pronto) { pronto = true; resolve(null); } }, 6000);
        FB.mods.auth.onAuthStateChanged(FB.auth, function (u) {
          FB.uid = u ? u.uid : null;
          if (!pronto) { pronto = true; clearTimeout(timer); resolve(u); return; }
          aoMudarAuth(u);
        }, function (err) { console.error('[Backend] auth', err); if (!pronto) { pronto = true; resolve(null); } });
      });
    });
  }
  function aoMudarAuth(u) {
    var uidAnterior = FB.uid;
    FB.uid = u ? u.uid : null;
    FB.ouvintesAuth.slice().forEach(function (fn) { try { fn(u); } catch (e) { console.error(e); } });
    pararSnapshots();
    if (!u) {
      if (uidAnterior && !FB.saindo) {
        /* Sessão encerrada fora do "Sair" (senha trocada, conta desativada, token revogado): nada mais sobe.
           O cache já tem dono (meta.uid), então outra conta que entrar depois não o herda. */
        gravarMeta({ orfao: Date.now() });
        status.pendentes = true;
        CL.emit('sync', { estado: 'erro', em: Date.now(), erro: new Error('sessão encerrada') });
        CL.ui.toast('Sua sessão no servidor terminou. Saia e entre de novo para continuar sincronizando.', { kind: 'aviso', fixo: true });
      }
      return;
    }
    /* Cache deste navegador pertence a outra conta? Some antes de qualquer merge/envio. */
    var descartou = descartarCacheDeOutraConta(u.uid);
    gravarMeta({ uid: String(u.uid) });
    FB.trocandoConta = descartou;
    lerRemoto(u.uid).then(function (remoto) {
      aplicarLogoRemota(remoto._logo, !descartou); delete remoto._logo;
      var merged = merge(remoto, descartou ? CL.defaultState() : CL.state);
      status.ultimoSync = Date.now();
      FB.trocandoConta = false;
      if (FB.assinante) FB.assinante(merged, { sincronizarTudo: !descartou });
      if (descartou) {
        /* Cache novo só com a conta que entrou (para abrir sem rede) + semente se a conta for nova. */
        Local.save(CL.state, {}).catch(function (e) { console.error('[Backend] cache após troca de conta', e); });
        if (typeof CL.seed === 'function') CL.seed();
      }
      iniciarSnapshots();
    }).catch(function (e) {
      console.error('[Backend] leitura após login', e);
      FB.trocandoConta = false;
      if (descartou && FB.assinante) FB.assinante(CL.defaultState(), {});
      CL.ui.toast('Não foi possível ler o servidor: ' + traduzirErro(e) + (descartou ? '.' : '. Os dados deste navegador continuam intactos.'), { kind: 'erro', fixo: true });
      CL.emit('sync', { estado: 'erro', em: Date.now(), erro: e });
    });
  }
  function lerRemoto(uid) {
    var fs = FB.mods.fs;
    var st = CL.defaultState();
    var tarefas = cols().map(function (col) {
      return fs.getDocs(fs.collection(FB.db, 'users', uid, col)).then(function (snap) {
        st[col] = snap.docs.map(function (d) { return d.data(); });
      });
    });
    tarefas.push(fs.getDoc(fs.doc(FB.db, 'users', uid, 'meta', 'cfg')).then(function (s) { st.cfg = s.exists() ? s.data() : null; }));
    tarefas.push(fs.getDoc(fs.doc(FB.db, 'users', uid, 'meta', 'tomb')).then(function (s) { st._tomb = s.exists() ? (s.data().ids || {}) : {}; }));
    tarefas.push(fs.getDoc(fs.doc(FB.db, 'users', uid, 'meta', 'logo')).then(function (s) { st._logo = s.exists() ? s.data() : null; }));
    return Promise.all(tarefas).then(function () { return st; });
  }
  function emParalelo(itens, n, fn) {
    var i = 0;
    var trabalhador = function () {
      if (i >= itens.length) return Promise.resolve();
      var it = itens[i++];
      return Promise.resolve().then(function () { return fn(it); }).then(trabalhador);
    };
    var ws = [];
    for (var k = 0; k < Math.min(n, itens.length); k++) ws.push(trabalhador());
    return Promise.all(ws);
  }
  function gravarItem(state, col, id, trazidos) {
    var fs = FB.mods.fs;
    var ref = fs.doc(FB.db, 'users', FB.uid, col, id);
    var local = null;
    var arr = state[col] || [];
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) { local = arr[i]; break; }
    var tombTs = state._tomb ? state._tomb[id] : undefined;
    return fs.runTransaction(FB.db, function (tx) {
      return tx.get(ref).then(function (snap) {
        var remoto = snap.exists() ? snap.data() : null;
        if (!local) {
          if (tombTs != null && (!remoto || tombTs >= (+remoto.updatedAt || 0))) tx.delete(ref);
          return;
        }
        if (remoto && (+remoto.updatedAt || 0) > (+local.updatedAt || 0)) { trazidos.push({ col: col, obj: remoto }); return; }
        tx.set(ref, limparParaFirestore(local));
      });
    });
  }
  function gravarCfg(state, trazidos) {
    var fs = FB.mods.fs;
    var ref = fs.doc(FB.db, 'users', FB.uid, 'meta', 'cfg');
    return fs.runTransaction(FB.db, function (tx) {
      return tx.get(ref).then(function (snap) {
        var remoto = snap.exists() ? snap.data() : null;
        var local = state.cfg || {};
        if (remoto && (+remoto.updatedAt || 0) > (+local.updatedAt || 0)) { trazidos.push({ col: 'cfg', obj: remoto }); return; }
        tx.set(ref, limparParaFirestore(local));
      });
    });
  }
  function gravarTomb(state) {
    var fs = FB.mods.fs;
    var ids = {};
    Object.keys(state._tomb || {}).forEach(function (id) { if (id.indexOf('.') < 0) ids[id] = state._tomb[id]; });
    if (!Object.keys(ids).length) return Promise.resolve();
    return fs.setDoc(fs.doc(FB.db, 'users', FB.uid, 'meta', 'tomb'), { ids: ids }, { merge: true });
  }
  function aplicarTrazidos(state, trazidos) {
    if (!trazidos.length) return;
    trazidos.forEach(function (t) {
      if (t.col === 'cfg') { state.cfg = t.obj; return; }
      var arr = state[t.col] = state[t.col] || [];
      var i = -1;
      for (var k = 0; k < arr.length; k++) if (arr[k] && arr[k].id === t.obj.id) { i = k; break; }
      if (i >= 0) arr[i] = t.obj; else arr.push(t.obj);
    });
    CL.emit('change', { col: '*' });
    CL.emit('sync', { estado: 'ok', em: Date.now(), trazidos: trazidos.length });
  }
  function montarRemoto() {
    var st = {};
    cols().forEach(function (col) { if (Array.isArray(FB.remoto[col])) st[col] = FB.remoto[col]; });
    if (FB.remoto.cfg) st.cfg = FB.remoto.cfg;
    st._tomb = FB.remoto._tomb || {};
    return st;
  }
  function pararSnapshots() {
    FB.unsubs.forEach(function (u) { try { u(); } catch (e) { /* já parado */ } });
    FB.unsubs = []; FB.remoto = {};
  }
  function iniciarSnapshots() {
    pararSnapshots();
    if (!FB.uid || !FB.assinante) return;
    var fs = FB.mods.fs, uid = FB.uid;
    var agendar = CL.util.debounce(function () {
      var merged = merge(montarRemoto(), CL.state);
      status.ultimoSync = Date.now();
      FB.assinante(merged, {});
    }, 400);
    var aoErro = function (col) {
      return function (err) { console.error('[Backend] snapshot ' + col, err); CL.emit('sync', { estado: 'erro', em: Date.now(), erro: err }); };
    };
    cols().forEach(function (col) {
      FB.unsubs.push(fs.onSnapshot(fs.collection(FB.db, 'users', uid, col), function (snap) {
        FB.remoto[col] = snap.docs.map(function (d) { return d.data(); });
        if (!snap.metadata.hasPendingWrites) agendar();
      }, aoErro(col)));
    });
    FB.unsubs.push(fs.onSnapshot(fs.doc(FB.db, 'users', uid, 'meta', 'cfg'), function (s) { FB.remoto.cfg = s.exists() ? s.data() : null; if (!s.metadata.hasPendingWrites) agendar(); }, aoErro('cfg')));
    FB.unsubs.push(fs.onSnapshot(fs.doc(FB.db, 'users', uid, 'meta', 'tomb'), function (s) { FB.remoto._tomb = s.exists() ? (s.data().ids || {}) : {}; if (!s.metadata.hasPendingWrites) agendar(); }, aoErro('tomb')));
    FB.unsubs.push(fs.onSnapshot(fs.doc(FB.db, 'users', uid, 'meta', 'logo'), function (s) { if (!s.metadata.hasPendingWrites) aplicarLogoRemota(s.exists() ? s.data() : null, false); }, aoErro('logo')));
  }
  function limparCacheLocal() {
    var chaves = [];
    for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (k && k.indexOf('clinicar.v1.') === 0 && k !== K.pref) chaves.push(k); }
    chaves.forEach(function (k) { ls.removeItem(k); });
  }
  /* Dono do cache = uid gravado em clinicar.v1.meta na primeira leitura/gravação em modo firebase.
     Cache sem dono é o de modo local (migra para a primeira conta que entrar, por desenho);
     cache de OUTRA conta nunca é mesclado nem enviado: é descartado antes de ler o servidor. */
  function donoCache() { var m = lerMeta(); return m.uid ? String(m.uid) : null; }
  function cacheDeOutraConta(uid) { var dono = donoCache(); return !!(uid && dono && dono !== String(uid)); }
  /* ---------- logo da clínica: pertence à CONTA, não ao navegador ----------
     localStorage é só cache (a impressão lê síncrono); a fonte é users/{uid}/meta/logo.
     Por isso "Sair" e a troca de conta podem limpar o cache sem perder a logo: ela volta do servidor. */
  function logoLocal() { try { return ls.getItem(K.logo) || ''; } catch (e) { return ''; } }
  function logoMeta() { var m = lerMeta().logo; return (m && typeof m === 'object') ? m : {}; }
  function gravarLogoLocal(dataUrl, updatedAt, sincronizada) {
    try { if (dataUrl) ls.setItem(K.logo, dataUrl); else ls.removeItem(K.logo); }
    catch (e) { avisarCota(); return false; }
    gravarMeta({ logo: { updatedAt: updatedAt || Date.now(), sincronizadaEm: sincronizada ? Date.now() : null } });
    return true;
  }
  function logoPendente() {
    var m = logoMeta();
    if (!(+m.updatedAt || 0) && !logoLocal()) return false;      /* navegador que nunca teve logo não empurra nada */
    return !m.sincronizadaEm || (+m.updatedAt || 0) > (+m.sincronizadaEm || 0);
  }
  function enviarLogo() {
    if (status.modo !== 'firebase' || !FB.uid || !FB.mods) return Promise.resolve(false);
    var dataUrl = logoLocal();
    var updatedAt = +logoMeta().updatedAt || Date.now();
    if (dataUrl.length > TETO_LOGO) {
      CL.ui.toast('A logo é grande demais para sincronizar; ela fica só neste navegador. Use uma imagem menor.', { kind: 'aviso', ms: 8000 });
      return Promise.resolve(false);
    }
    var fs = FB.mods.fs;
    return fs.setDoc(fs.doc(FB.db, 'users', FB.uid, 'meta', 'logo'), { dataUrl: dataUrl, updatedAt: updatedAt })
      .then(function () { gravarMeta({ logo: { updatedAt: updatedAt, sincronizadaEm: Date.now() } }); return true; })
      .catch(function (e) { console.error('[Backend] a logo não subiu', e); return false; });
  }
  function aplicarLogoRemota(doc, podeEnviar) {
    var localTs = +logoMeta().updatedAt || 0;   /* 0 = este navegador nunca gravou logo (ou vem de antes deste campo) */
    if (doc && typeof doc === 'object') {
      var rt = +doc.updatedAt || 0;
      /* decide por data, não por "tem logo aqui": senão uma remoção feita neste navegador
         ressuscitaria a logo antiga que ainda está no servidor. */
      if (!localTs || rt >= localTs) {
        var url = typeof doc.dataUrl === 'string' ? doc.dataUrl : '';
        if (url !== logoLocal()) gravarLogoLocal(url, rt || Date.now(), true);
        else gravarMeta({ logo: { updatedAt: rt || localTs, sincronizadaEm: Date.now() } });
        return;
      }
    }
    if (podeEnviar && logoPendente()) enviarLogo();               /* servidor sem logo (ou mais velha): sobe a daqui */
  }

  function descartarCacheDeOutraConta(uid) {
    if (!cacheDeOutraConta(uid)) return false;
    var c = contagens(parseSeguro(ls.getItem(K.state)) || {});
    limparCacheLocal();
    gravarMeta({ uid: String(uid), descartouOutraConta: Date.now() });
    console.warn('[Backend] cache local de outra conta descartado (' + c.total + ' itens) antes de entrar');
    CL.ui.toast('Este navegador guardava dados de outra conta; eles foram descartados e só os dados da sua conta foram carregados.', { kind: 'aviso', ms: 8000 });
    return true;
  }

  var Firebase = {
    load: function () {
      if (FB.uid) { descartarCacheDeOutraConta(FB.uid); gravarMeta({ uid: String(FB.uid) }); }
      var local = Local.load();
      if (!FB.uid) return Promise.resolve(local);
      return lerRemoto(FB.uid).then(function (remoto) {
        aplicarLogoRemota(remoto._logo, true); delete remoto._logo;
        var merged = merge(remoto, local);
        status.ultimoSync = Date.now();
        return merged;
      }).catch(function (e) {
        console.error('[Backend] leitura remota falhou', e);
        CL.ui.toast('Não foi possível ler o servidor: ' + traduzirErro(e) + '. Usando os dados deste navegador.', { kind: 'erro', fixo: true });
        CL.emit('sync', { estado: 'erro', em: Date.now(), erro: e });
        return local;
      });
    },
    save: function (state, opts) {
      opts = opts || {};
      if (FB.trocandoConta) {
        /* Entre descartar o cache da outra conta e receber o servidor, a memória ainda é da conta anterior: não grava nada. */
        console.warn('[Backend] gravação ignorada durante a troca de conta');
        return Promise.resolve();
      }
      return Local.save(state, opts).then(function () {
        if (!FB.uid) return;
        gravarMeta({ uid: String(FB.uid) });
        if (!navigator.onLine) {
          status.pendentes = true;
          var off = new Error('Sem rede: as alterações ficam neste navegador e sobem quando a conexão voltar.');
          off.code = 'offline';
          throw off;
        }
        var sujos = opts.sujos || {};
        var tarefas = [];
        Object.keys(sujos).forEach(function (col) {
          if (cols().indexOf(col) < 0) return;
          sujos[col].forEach(function (id) { if (String(id).indexOf('.') < 0) tarefas.push({ col: col, id: String(id) }); });
        });
        var trazidos = [];
        return emParalelo(tarefas, 4, function (t) { return gravarItem(state, t.col, t.id, trazidos); })
          .then(function () { if (opts.cfg) return gravarCfg(state, trazidos); })
          .then(function () { if (opts.tomb) return gravarTomb(state); })
          .then(function () {
            var fs = FB.mods.fs;
            return fs.setDoc(fs.doc(FB.db, 'users', FB.uid, 'meta', 'info'), { versao: 1, ultimoSync: Date.now() }, { merge: true });
          })
          .then(function () {
            status.pendentes = false;
            status.ultimoSync = Date.now();
            aplicarTrazidos(state, trazidos);
          })
          .catch(function (e) {
            /* Sem fallback para gravação crua: rejeita e CL.persist avisa. */
            status.pendentes = true;
            var err = new Error(traduzirErro(e));
            err.code = e && e.code;
            err.original = e;
            throw err;
          });
      });
    },
    subscribe: function (fn) {
      FB.assinante = fn;
      var unLocal = Local.subscribe(fn);
      iniciarSnapshots();
      return function () { unLocal(); pararSnapshots(); FB.assinante = null; };
    }
  };

  /* =================== interface pública =================== */
  var adaptador = Local;
  var Backend = window.Backend = {
    modo: 'local',
    init: function (config) {
      config = config || window.CLINICAR_CONFIG || {};
      status.modo = 'local'; adaptador = Local;
      var pedido = !!(config.apiKey && String(config.apiKey).trim() && config.projectId && String(config.projectId).trim());
      if (!pedido) { Backend.modo = 'local'; return Promise.resolve({ modo: 'local' }); }
      return iniciarFirebase(config).then(function () {
        status.modo = 'firebase'; adaptador = Firebase; Backend.modo = 'firebase';
        return { modo: 'firebase' };
      }).catch(function (e) {
        console.warn('[Backend] Firebase indisponível, seguindo em modo local:', e && e.message);
        status.modo = 'local'; adaptador = Local; Backend.modo = 'local';
        CL.ui.toast('Sem acesso ao servidor; modo local', { kind: 'aviso', ms: 6000 });
        return { modo: 'local' };
      });
    },
    load: function () { return Promise.resolve().then(function () { return adaptador.load(); }); },
    save: function (state, opts) { return adaptador.save(state, opts); },
    subscribe: function (fn) { return adaptador.subscribe(fn); },
    merge: merge,
    compactTomb: compactTomb,
    donoCache: donoCache,
    cacheDeOutraConta: cacheDeOutraConta,
    aposBoot: function () {
      if (problemaCarga) { var p = problemaCarga; problemaCarga = null; abrirRecuperacao(p); }
      if (status.modo === 'local') { try { compactTomb(CL.state, 90); } catch (e) { /* opcional */ } }
    },
    problemaCarga: function () { return problemaCarga; },
    auth: {
      get user() { return FB.auth ? FB.auth.currentUser : null; },
      entrar: function (email, senha) {
        if (status.modo !== 'firebase') return Promise.reject(new Error('modo local'));
        return FB.mods.auth.signInWithEmailAndPassword(FB.auth, String(email || '').trim(), String(senha || '')).then(function (c) { return c.user; });
      },
      sair: function () {
        if (status.modo !== 'firebase') return Promise.resolve();
        FB.saindo = true;
        pararSnapshots();
        /* A logo é da conta: garante que subiu antes de limpar este navegador (senão o "Sair" a perderia). */
        return (logoPendente() ? enviarLogo() : Promise.resolve(false)).then(function () {
          return FB.mods.auth.signOut(FB.auth).catch(function (e) { console.error(e); });
        }).then(function () {
          limparCacheLocal();
          FB.uid = null;
          if (FB.mods.fs.clearIndexedDbPersistence) {
            return FB.mods.fs.terminate(FB.db).then(function () { return FB.mods.fs.clearIndexedDbPersistence(FB.db); }).catch(function () { /* outra aba aberta */ });
          }
        });
      },
      aoMudar: function (fn) {
        FB.ouvintesAuth.push(fn);
        return function () { var i = FB.ouvintesAuth.indexOf(fn); if (i >= 0) FB.ouvintesAuth.splice(i, 1); };
      },
      redefinirSenha: function (email) {
        if (status.modo !== 'firebase') return Promise.reject(new Error('modo local'));
        return FB.mods.auth.sendPasswordResetEmail(FB.auth, String(email || '').trim());
      },
      traduzirErro: traduzirErro
    },
    ai: {
      disponivel: function () { return status.modo === 'firebase' && !!FB.fns && !!FB.uid; },
      texto: function (pergunta, opts) {
        if (!Backend.ai.disponivel()) return Promise.reject(new Error('configure o backend'));
        var chamada = FB.mods.fn.httpsCallable(FB.fns, 'gemini');
        return chamada({ prompt: String(pergunta || ''), model: (opts && opts.model) || 'gemini-2.5-pro' })
          .then(function (r) { return (r.data && r.data.text) || ''; })
          .catch(function (e) { throw new Error(/not-found/i.test(e && e.code) ? 'configure o backend' : traduzirErro(e)); });
      },
      audio: function (base64, mime, pergunta, opts) {
        if (!Backend.ai.disponivel()) return Promise.reject(new Error('configure o backend'));
        var tam = (base64 || '').length;
        if (tam > TETO_AUDIO) return Promise.reject(new Error('Áudio muito longo (' + Math.round(tam / 1000000) + ' MB). Grave em blocos menores.'));
        if (tam > TETO_AUDIO * 0.8) CL.ui.toast('O áudio está perto do limite; considere blocos menores.', { kind: 'aviso' });
        var chamada = FB.mods.fn.httpsCallable(FB.fns, 'geminiAudio');
        return chamada({ audio: base64, mimeType: mime, prompt: String(pergunta || ''), model: (opts && opts.model) || 'gemini-2.5-pro' })
          .then(function (r) { return (r.data && r.data.text) || ''; })
          .catch(function (e) { throw new Error(/not-found/i.test(e && e.code) ? 'configure o backend' : traduzirErro(e)); });
      }
    },
    backups: function () {
      var meta = lerMeta(); var bkMeta = meta.bk || {};
      var lista = [];
      K.bk.forEach(function (chave) {
        var st = parseSeguro(ls.getItem(chave));
        if (!st) return;
        var c = contagens(st); delete c.pc;
        lista.push({ chave: chave, em: (bkMeta[chave] && bkMeta[chave].em) || null, contagens: c });
      });
      return lista;
    },
    restaurar: function (chave) {
      return Promise.resolve().then(function () {
        var raw = ls.getItem(chave);
        var st = parseSeguro(raw);
        if (!st) throw new Error('Backup não encontrado ou ilegível');
        var atual = ls.getItem(K.state);
        if (atual && atual !== raw && parseSeguro(atual)) {
          try { ls.setItem(K.ruim + Date.now() + '-antes-restaurar', atual); } catch (e) { /* cota */ }
        }
        CL.substituirEstado(st);
        return Local.save(CL.state, { forcarVazio: true }).then(function () {
          if (status.modo === 'firebase' && FB.uid) CL.persistTudo();
          return CL.state;
        });
      });
    },
    chavesRuins: function () {
      var lista = [];
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (k && k.indexOf(K.ruim) === 0) {
          var ts = parseInt(k.slice(K.ruim.length), 10);
          lista.push({ chave: k, em: isNaN(ts) ? null : ts, tamanho: (ls.getItem(k) || '').length, legivel: !!parseSeguro(ls.getItem(k)) });
        }
      }
      return lista;
    },
    limparRuins: function () { Backend.chavesRuins().forEach(function (r) { ls.removeItem(r.chave); }); },
    exportar: function () {
      /* a logo vive fora do state (é da conta, não de uma coleção): sem ela o backup não devolveria os documentos como eram */
      return JSON.stringify({ app: 'clinicar', versao: 1, exportadoEm: new Date().toISOString(), logo: logoLocal(), state: CL.state });
    },
    logo: {
      get: logoLocal,
      set: function (dataUrl) { gravarLogoLocal(dataUrl || '', Date.now(), false); return enviarLogo(); },
      pendente: logoPendente
    },
    meta: { get: lerMeta, set: gravarMeta },
    status: function () {
      return { modo: status.modo, online: navigator.onLine, ultimoSaveOk: status.ultimoSaveOk || lerMeta().ultimoSaveOk || null, ultimoSync: status.ultimoSync, pendentes: status.pendentes, sessaoSalvou: sessaoSalvou, usuario: FB.uid, donoCache: donoCache() };
    },
    chaves: K
  };
})();
