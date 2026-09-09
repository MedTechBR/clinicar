const {initializeTestEnvironment, assertSucceeds, assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,getDocs,collection,setDoc,updateDoc}=require('firebase/firestore');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-clinicar',firestore:{host:'127.0.0.1',port:8097,rules:fs.readFileSync(require('node:path').join(__dirname,'../firestore.rules'),'utf8')}});
 try {
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async c=>{
 const db=c.firestore();
 for(const [id,perfil] of [['admin-test','admin'],['recep-test','recepcao'],['med-test','profissional']]) await setDoc(doc(db,'acessos',id),{clinicaId:'admin-test',perfil,ativo:true,profId:null});
 for(const [col,id,data] of [
 ['pacientes','pac-test',{id:'pac-test',nome:'Paciente Fictício',problemas:'Conteúdo clínico fictício'}],
 ['pacientesCadastro','pac-test',{id:'pac-test',nome:'Paciente Fictício'}],
 ['evolucoes','ev-test',{id:'ev-test',texto:'Evolução fictícia'}],
 ['lancamentos','lan-test',{id:'lan-test',valorCent:100}],
 ['consultas','con-test',{id:'con-test',status:'agendado'}],
 ['consultas','con-active',{id:'con-active',status:'em_atendimento'}],
 ['meta','cfg',{seed:true}]
 ]) await setDoc(doc(db,'users','admin-test',col,id),data);
 });
 const admin=env.authenticatedContext('admin-test').firestore();
 const recep=env.authenticatedContext('recep-test').firestore();
 const med=env.authenticatedContext('med-test').firestore();
 const stranger=env.authenticatedContext('outsider-test').firestore();
 const anon=env.unauthenticatedContext().firestore();
 const ref=(db,col,id)=>doc(db,'users','admin-test',col,id);
 let checks=0;
 async function ok(p){await assertSucceeds(p);checks++} async function no(p){await assertFails(p);checks++}
 for(const db of [anon,stranger]) await no(getDoc(ref(db,'pacientesCadastro','pac-test')));
 await ok(getDocs(collection(recep,'users','admin-test','pacientesCadastro')));
 await no(getDocs(collection(recep,'users','admin-test','pacientes')));
 await no(getDoc(ref(recep,'pacientes','pac-test')));
 await no(getDocs(collection(recep,'users','admin-test','evolucoes')));
 for(const col of ['receitas','documentos','exames','modelos']) await no(getDocs(collection(recep,'users','admin-test',col)));
 await ok(getDoc(ref(med,'evolucoes','ev-test')));
 await ok(getDoc(ref(med,'pacientes','pac-test')));
 await no(getDoc(ref(med,'lancamentos','lan-test')));
 await ok(getDoc(ref(recep,'lancamentos','lan-test')));
 await no(updateDoc(ref(med,'meta','cfg'),{seed:false}));
 await no(updateDoc(ref(recep,'meta','cfg'),{seed:false}));
 await ok(updateDoc(ref(admin,'meta','cfg'),{seed:true}));
 await no(setDoc(doc(recep,'acessos','recep-test'),{ativo:true,perfil:'admin',clinicaId:'admin-test'}));
 await no(setDoc(ref(recep,'usuarios','usr-admin'),{perfil:'admin'}));
 await no(setDoc(ref(admin,'pacientes','new-test'),{nome:'Fictício'}));
 await ok(updateDoc(ref(recep,'consultas','con-test'),{status:'chegou'}));
 await no(updateDoc(ref(recep,'consultas','con-test'),{status:'em_atendimento'}));
 await no(updateDoc(ref(recep,'consultas','con-active'),{status:'cancelado'}));
 await no(updateDoc(ref(recep,'consultas','con-active'),{status:'finalizado'}));
 await ok(updateDoc(ref(med,'consultas','con-test'),{status:'em_atendimento'}));
 await no(getDoc(doc(recep,'users','another-clinic','pacientesCadastro','pac-test')));
 await no(getDoc(doc(recep,'acessos','admin-test')));
 await ok(getDoc(doc(recep,'acessos','recep-test')));
 await ok(setDoc(ref(recep,'auditoria','audit-test'),{usuarioId:'recep-test',acao:'login'}));
 await no(updateDoc(ref(recep,'auditoria','audit-test'),{acao:'alterado'}));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'acessos','recep-test'),{ativo:false}));
 await no(getDoc(ref(recep,'pacientesCadastro','pac-test')));
 await no(updateDoc(ref(recep,'consultas','con-test'),{status:'chegou'}));
 assert(checks>=30);console.log('PASS regras:',checks,'verificações');
 } finally {await env.clearFirestore();await env.cleanup()}
})().catch(e=>{console.error(e);process.exitCode=1});
