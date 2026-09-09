/* Contas individuais. O administrador inicial é definido no servidor em sistema/acesso. */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
if (!getApps().length) initializeApp();
const db = getFirestore();
const options = { region: 'southamerica-east1', invoker: 'public', timeoutSeconds: 120 };
const { cadastro } = require('./cadastro');
const ADMIN_EMAIL = 'matheusparente1@gmail.com';
async function acesso(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Entre com seu e-mail e senha.');
  const doc = await db.doc('acessos/' + req.auth.uid).get();
  if (!doc.exists || doc.data().ativo !== true) throw new HttpsError('permission-denied', 'Peça ao administrador geral para liberar seu acesso.');
  return { ...doc.data(), id: req.auth.uid };
}
exports.exigirAcesso = acesso;
exports.acessar = onCall(options, async req => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Entre na sua conta.');
  const configRef = db.doc('sistema/acesso');
  let config = await configRef.get();
  // A conta foi indicada pelo dono. Nunca promove o primeiro visitante ou um perfil local.
  if (!config.exists && String(req.auth.token.email || '').toLowerCase() === ADMIN_EMAIL) {
    const owner = await getAuth().getUserByEmail(ADMIN_EMAIL);
    if (owner.uid === req.auth.uid) {
      await db.runTransaction(async tx => {
        const current = await tx.get(configRef);
        if (!current.exists) tx.create(configRef, { adminUid: owner.uid });
      });
      config = await configRef.get();
    }
  }
  if (config.exists && config.data().adminUid === req.auth.uid) {
    const ref = db.doc('acessos/' + req.auth.uid);
    await db.runTransaction(async tx => {
      const existing = await tx.get(ref);
      if (!existing.exists) tx.create(ref, { clinicaId: req.auth.uid, nome: 'Matheus Parente', email: ADMIN_EMAIL, perfil: 'admin', profId: null, ativo: true, updatedAt: Date.now() });
    });
    // Backfill idempotente: mantém intactas as fichas e só prepara o cadastro da recepção.
    if (!config.data().cadastroV1) {
      let last = null;
      do {
        let query = db.collection('users/' + req.auth.uid + '/pacientes').orderBy('__name__').limit(100);
        if (last) query = query.startAfter(last);
        const page = await query.get();
        for (const patient of page.docs) {
          await db.runTransaction(async tx => {
            const current = await tx.get(patient.ref);
            if (current.exists) tx.set(db.doc('users/' + req.auth.uid + '/pacientesCadastro/' + patient.id), cadastro(current.data()));
          });
        }
        last = page.size === 100 ? page.docs[page.docs.length - 1] : null;
      } while (last);
      await configRef.set({ cadastroV1: true }, { merge: true });
    }
  }
  return acesso(req);
});
exports.gerenciarAcesso = onCall(options, async req => {
  const admin = await acesso(req);
  if (admin.perfil !== 'admin') throw new HttpsError('permission-denied', 'Somente o administrador gerencia acessos.');
  const d = req.data || {};
  if (d.id && !/^[A-Za-z0-9_-]{1,128}$/.test(String(d.id))) throw new HttpsError('invalid-argument', 'Usuário inválido.');
  if (d.profId && !/^[A-Za-z0-9_-]{1,128}$/.test(String(d.profId))) throw new HttpsError('invalid-argument', 'Profissional inválido.');
  if (d.acao === 'listar') {
    const docs = await db.collection('acessos').where('clinicaId', '==', admin.clinicaId).get();
    return { usuarios: docs.docs.map(doc => ({ ...doc.data(), id: doc.id })) };
  }
  const nome = String(d.nome || '').trim();
  const email = String(d.email || '').trim().toLowerCase();
  if (!nome || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['admin', 'recepcao', 'profissional'].includes(d.perfil)) throw new HttpsError('invalid-argument', 'Informe nome, e-mail e função válidos.');
  if (d.profId || d.perfil === 'profissional') {
    const prof = d.profId && await db.doc('users/' + admin.clinicaId + '/profissionais/' + String(d.profId)).get();
    if (!prof || !prof.exists || prof.data().ativo === false) throw new HttpsError('invalid-argument', 'Vincule um profissional ativo.');
  }
  let user;
  if (d.id) {
    user = await getAuth().getUser(String(d.id));
    if ((user.email || '').toLowerCase() !== email) throw new HttpsError('invalid-argument', 'O e-mail de uma conta existente não pode ser alterado aqui.');
  } else {
    try { user = await getAuth().getUserByEmail(email); }
    catch (e) { if (e.code !== 'auth/user-not-found') throw e; user = await getAuth().createUser({ email, displayName: nome }); }
  }
  const ref = db.doc('acessos/' + user.uid);
  const obj = { clinicaId: admin.clinicaId, nome, email, perfil: d.perfil, profId: d.profId || null, ativo: d.ativo !== false, updatedAt: Date.now() };
  await db.runTransaction(async tx => {
    const [previous, root, caller] = await Promise.all([tx.get(ref), tx.get(db.doc('sistema/acesso')), tx.get(db.doc('acessos/' + req.auth.uid))]);
    if (!caller.exists || !caller.data().ativo || caller.data().perfil !== 'admin') throw new HttpsError('permission-denied', 'Acesso revogado.');
    if (previous.exists && previous.data().clinicaId !== admin.clinicaId) throw new HttpsError('already-exists', 'Esta conta pertence a outra clínica.');
    if ((user.uid === req.auth.uid || (root.exists && root.data().adminUid === user.uid)) && (!obj.ativo || obj.perfil !== 'admin')) throw new HttpsError('failed-precondition', 'O administrador geral e o seu próprio acesso devem permanecer ativos como administrador.');
    tx.set(ref, obj);
  });
  // O colaborador define a senha por ‘Esqueci a senha’; nenhum administrador recebe um token de redefinição.
  const link = null;
  return { usuario: { ...obj, id: user.uid }, link };
});

exports.salvarCadastro = onCall(options, async req => {
  const member = await acesso(req);
  const d = req.data || {}, p = d.paciente;
  if (!p || !/^[A-Za-z0-9_-]{1,128}$/.test(p.id || '') || typeof p.nome !== 'string' || !p.nome.trim() || !Number.isFinite(p.updatedAt)) throw new HttpsError('invalid-argument', 'Cadastro inválido.');
  const ref = db.doc('users/' + member.clinicaId + '/pacientes/' + p.id);
  const publicRef = db.doc('users/' + member.clinicaId + '/pacientesCadastro/' + p.id);
  return db.runTransaction(async tx => {
    const [previous, currentMember] = await Promise.all([tx.get(ref), tx.get(db.doc('acessos/' + req.auth.uid))]);
    if (!currentMember.exists || !currentMember.data().ativo || currentMember.data().clinicaId !== member.clinicaId || currentMember.data().perfil !== member.perfil) throw new HttpsError('permission-denied', 'Acesso alterado. Entre novamente.');
    const old = previous.exists ? previous.data() : {};
    if ((old.updatedAt || 0) > p.updatedAt) return { paciente: member.perfil === 'recepcao' ? cadastro(old) : old };
    const saved = member.perfil === 'recepcao' ? { ...old, ...cadastro(p) } : p;
    tx.set(ref, saved);
    tx.set(publicRef, cadastro(saved));
    return { paciente: member.perfil === 'recepcao' ? cadastro(saved) : saved };
  });
});

// A finalização gera a cobrança no servidor, sem dar ao profissional acesso ao financeiro.
exports.registrarCobranca = onCall(options, async req => {
  const member = await acesso(req), id = String((req.data || {}).consultaId || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new HttpsError('invalid-argument', 'Consulta inválida.');
  const base = 'users/' + member.clinicaId;
  return db.runTransaction(async tx => {
    const ref = db.doc(base + '/consultas/' + id);
    const [snapshot, accessNow] = await Promise.all([tx.get(ref), tx.get(db.doc('acessos/' + req.auth.uid))]);
    if (!accessNow.exists || !accessNow.data().ativo || accessNow.data().clinicaId !== member.clinicaId) throw new HttpsError('permission-denied', 'Acesso revogado.');
    if (!snapshot.exists) return { ok: true };
    const c = snapshot.data(), taxa = ['faltou', 'cancelado_tarde'].includes(c.status);
    if ((!taxa && c.status !== 'finalizado') || c.origem === 'importacao') return { ok: true };
    const [existing, procedure, config] = await Promise.all([
      tx.get(db.collection(base + '/lancamentos').where('consultaId', '==', id)),
      c.procId ? tx.get(db.doc(base + '/procedimentos/' + c.procId)) : Promise.resolve(null),
      tx.get(db.doc(base + '/meta/cfg'))
    ]);
    if (existing.docs.some(d => d.data().status !== 'cancelado' && (taxa ? d.data().descricao === 'Taxa de falta' : d.data().descricao !== 'Taxa de falta'))) return { ok: true };
    const pr = procedure && procedure.exists ? procedure.data() : {}, policy = config.exists ? config.data().politica || {} : {};
    const valor = taxa ? (Number(policy.taxaFaltaCent) || Math.round((Number(pr.valorCent) || 0) * (Number(policy.taxaFaltaPct) || 0) / 100)) : Number(pr.valorCent) || 0;
    if (!(valor > 0)) return { ok: true };
    const ledgerId = (taxa ? 'taxa-' : 'consulta-') + id, now = Date.now();
    tx.set(db.doc(base + '/lancamentos/' + ledgerId), { id: ledgerId, tipo: 'receita', consultaId: id, pacId: c.pacId || null, profId: c.profId || null, procId: c.procId || null, data: c.data, descricao: taxa ? 'Taxa de falta' : pr.nome || 'Consulta', valorCent: Math.round(valor), descontoCent: 0, forma: '', parcelas: 1, status: 'pendente', recebidoEm: null, convenioId: c.convenioId || 'particular', createdAt: now, updatedAt: now });
    if (!taxa) tx.update(ref, { lancamentoId: ledgerId, updatedAt: Math.max(now, (Number(c.updatedAt) || 0) + 1) });
    return { ok: true };
  });
});
