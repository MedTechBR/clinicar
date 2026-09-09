process.env.GCLOUD_PROJECT='demo-clinicar';
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8097';
process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9097';
const assert=require('node:assert/strict');
const requireFunctions=require('node:module').createRequire(require('node:path').join(__dirname,'../functions/package.json'));
const {getFirestore}=requireFunctions('firebase-admin/firestore');
const {getAuth}=requireFunctions('firebase-admin/auth');
const api=require('../functions/acessos');
const req=(uid,email,data={})=>({auth:{uid,token:{email}},data});
(async()=>{
 const db=getFirestore(),auth=getAuth();
 for(const [uid,email] of [['admin-test','matheusparente1@gmail.com'],['outsider-test','outsider@example.test']]) {
   try{await auth.createUser({uid,email,password:'Ficticia123!',emailVerified:true})}catch(e){if(e.code!=='auth/uid-already-exists'&&e.code!=='auth/email-already-exists')throw e}
 }
 await db.doc('users/admin-test/pacientes/pac-legacy').set({id:'pac-legacy',nome:'Paciente Legado Fictício',problemas:'Anotação clínica fictícia',updatedAt:1});
 await assert.rejects(api.acessar.run(req('outsider-test','outsider@example.test')),e=>e.code==='permission-denied');
 const admin=await api.acessar.run(req('admin-test','matheusparente1@gmail.com'));
 assert.equal(admin.perfil,'admin');assert.equal(admin.clinicaId,'admin-test');
 assert.equal((await db.doc('users/admin-test/pacientesCadastro/pac-legacy').get()).data().problemas,undefined);
 assert.equal((await db.doc('users/admin-test/pacientes/pac-legacy').get()).data().problemas,'Anotação clínica fictícia');
 const granted=await api.gerenciarAcesso.run(req('admin-test','matheusparente1@gmail.com',{nome:'Recepção Fictícia',email:'recep@example.test',perfil:'recepcao',ativo:true}));
 const rec=granted.usuario;
 await auth.updateUser(rec.id,{password:'Ficticia123!',emailVerified:true});
 assert.equal((await api.acessar.run(req(rec.id,rec.email))).perfil,'recepcao');
 await assert.rejects(api.gerenciarAcesso.run(req(rec.id,rec.email,{acao:'listar'})),e=>e.code==='permission-denied');
 await api.salvarCadastro.run(req(rec.id,rec.email,{paciente:{id:'pac-legacy',nome:'Cadastro atualizado fictício',updatedAt:2,problemas:'Tentativa de sobrescrever'}}));
 const raw=(await db.doc('users/admin-test/pacientes/pac-legacy').get()).data();
 assert.equal(raw.problemas,'Anotação clínica fictícia');assert.equal(raw.nome,'Cadastro atualizado fictício');
 const stale=await api.salvarCadastro.run(req(rec.id,rec.email,{paciente:{id:'pac-legacy',nome:'Versão antiga fictícia',updatedAt:1}}));
 assert.equal(stale.paciente.updatedAt,2);assert.equal(stale.paciente.problemas,undefined);
 await assert.rejects(api.gerenciarAcesso.run(req('admin-test','matheusparente1@gmail.com',{...admin,ativo:false})),e=>e.code==='failed-precondition');
 await assert.rejects(api.gerenciarAcesso.run(req('admin-test','matheusparente1@gmail.com',{nome:'Fictício',email:'med@example.test',perfil:'profissional',ativo:true})),e=>e.code==='invalid-argument');
 await api.gerenciarAcesso.run(req('admin-test','matheusparente1@gmail.com',{...rec,ativo:false}));
 await assert.rejects(api.acessar.run(req(rec.id,rec.email)),e=>e.code==='permission-denied');
 await assert.rejects(api.salvarCadastro.run(req(rec.id,rec.email,{paciente:{id:'pac-new',nome:'Fictício',updatedAt:3}})),e=>e.code==='permission-denied');
 await api.gerenciarAcesso.run(req('admin-test','matheusparente1@gmail.com',{...rec,ativo:true}));
 await db.doc('users/admin-test/procedimentos/proc-paid').set({nome:'Consulta fictícia',valorCent:10000});
 await db.doc('users/admin-test/consultas/paid-test').set({id:'paid-test',status:'finalizado',procId:'proc-paid',pacId:'pac-legacy',data:'2026-09-09',updatedAt:1});
 await Promise.all([api.registrarCobranca.run(req('admin-test','matheusparente1@gmail.com',{consultaId:'paid-test'})),api.registrarCobranca.run(req('admin-test','matheusparente1@gmail.com',{consultaId:'paid-test'}))]);
 const bills=await db.collection('users/admin-test/lancamentos').where('consultaId','==','paid-test').get();
 assert.equal(bills.size,1);assert.equal(bills.docs[0].data().valorCent,10000);
 console.log('PASS funções: bootstrap, delegação, revogação, preservação clínica e conflitos');
})().catch(e=>{console.error(e);process.exitCode=1});
