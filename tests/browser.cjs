const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const errors=[];
 async function open(email) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',route=>{const u=new URL(route.request().url()); if(u.hostname==='127.0.0.1'||(route.request().method()==='GET'&&['www.gstatic.com','fonts.googleapis.com','fonts.gstatic.com','cdn.jsdelivr.net'].includes(u.hostname)))return route.continue(); return route.abort();});
  await context.route('**/config.js*',r=>r.fulfill({contentType:'application/javascript',body:'window.CLINICAR_CONFIG={apiKey:"fake-api-key",projectId:"demo-clinicar",appId:"demo",authDomain:"demo-clinicar.firebaseapp.com"};'}));
  await context.route('**/backend.js*',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(root,'backend.js'),'utf8').replace("FB.fns = FB.mods.fn.getFunctions(FB.app, config.regiaoFunctions || 'southamerica-east1');", "FB.fns = FB.mods.fn.getFunctions(FB.app, config.regiaoFunctions || 'southamerica-east1'); FB.mods.auth.connectAuthEmulator(FB.auth, 'http://127.0.0.1:9097', {disableWarnings:true}); FB.mods.fs.connectFirestoreEmulator(FB.db,'127.0.0.1',8097); FB.mods.fn.connectFunctionsEmulator(FB.fns,'127.0.0.1',5097);")}));
  await context.route('**/salvarCadastro',async route=>{ await new Promise(resolve=>setTimeout(resolve,800)); await route.continue(); });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')console.log('browser:',m.text().slice(0,220));});
  await page.goto('http://127.0.0.1:8897');
  await page.locator('#login-email').fill(email);await page.locator('#login-senha').fill('Ficticia123!');
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  return {context,page};
 }
 try {
  const admin=await open('matheusparente1@gmail.com'),page=admin.page;
  await page.waitForFunction(()=>CL.session&&Backend.acessoPronto,{},{timeout:45000});
  console.log('Login administrador concluído');
  assert.equal(await page.locator('.login-usuario').count(),0);
  assert.equal(await page.evaluate(()=>CL.session.perfil),'admin');
  await page.evaluate(()=>Config.salvarProfissional({nome:'Profissional Fictício',horarios:Object.fromEntries([0,1,2,3,4,5,6].map(d=>[d,[{ini:'00:00',fim:'23:59'}]])),slot:15,ativo:true}));
  await page.evaluate(()=>CL.persist());
  const recep=await open('recep@example.test');
  await recep.page.waitForFunction(()=>CL.session&&Backend.acessoPronto,{},{timeout:45000});
  console.log('Login recepção concluído');
  assert.equal(await recep.page.evaluate(()=>CL.session.perfil),'recepcao');
  assert.equal(await recep.page.evaluate(()=>CL.col('pacientes').some(p=>p.problemas)),false);
  assert.equal(await recep.page.evaluate(()=>CL.col('evolucoes').length),0);
  await recep.page.evaluate(()=>Agenda.abrirNova({}));
  await recep.page.getByRole('button',{name:'Novo paciente',exact:true}).click();
  await recep.page.locator('[name="novoNome"]').fill('Paciente Novo Fictício');
  await recep.page.getByRole('button',{name:'Cadastrar e usar'}).click();
  assert.equal(await recep.page.getByRole('button',{name:'Salvar e atender',exact:true}).count(),0);
  await recep.page.getByRole('button',{name:'Salvar e colocar na espera'}).click();
  await recep.page.waitForFunction(()=>CL.col('consultas').some(c=>c.status==='chegou'));
  assert.equal(await recep.page.evaluate(()=>CL.persist()),true);
  await page.waitForFunction(()=>CL.col('consultas').some(c=>c.status==='chegou'),{},{timeout:15000});
  await page.evaluate(()=>CL.route.go('#/painel'));
  await page.getByRole('button',{name:'Iniciar atendimento',exact:true}).first().click();
  try { await page.waitForURL('**/#/atendimento/**',{timeout:8000}); } catch(e) { console.log('DIAGNÓSTICO',JSON.stringify(await page.evaluate(()=>({hash:location.hash,session:CL.session,consultas:CL.col('consultas'),patients:CL.col('pacientes').map(p=>p.id),body:document.body.innerText.slice(-1600)})))); console.log('ERROS',errors); throw e; }
  assert.equal(await page.evaluate(()=>CL.col('consultas').some(c=>c.status==='em_atendimento')),true);
  assert.equal(await page.evaluate(()=>CL.persist()),true);
  await page.reload();await page.waitForFunction(()=>CL.session&&Backend.acessoPronto,{},{timeout:45000});
  assert.equal(await page.locator('.login-usuario').count(),0);
  await page.evaluate(()=>CL.route.go('#/config/usuarios'));
  await page.getByRole('button',{name:'Liberar acesso',exact:true}).waitFor();
  await page.getByRole('button',{name:'Liberar acesso',exact:true}).click();
  await page.locator('#ac-nome').fill('Profissional de Teste');await page.locator('#ac-email').fill('med-ui@example.test');
  await page.locator('#ac-perfil').selectOption('profissional');
  await page.locator('#ac-prof').selectOption({index:1});
  await page.getByRole('button',{name:'Salvar acesso',exact:true}).click();
  await page.getByText('med-ui@example.test',{exact:true}).waitFor({timeout:15000});
  const access=await page.evaluate(()=>Backend.auth.gerenciar({acao:'listar'}));
  const member=access.usuarios.find(u=>u.email==='recep@example.test');
  await page.evaluate(u=>Backend.auth.gerenciar({...u,ativo:false}),member);
  await recep.page.waitForFunction(()=>!CL.session&&!Backend.acessoPronto);
  await recep.page.getByText('Seu acesso foi alterado. Saia e entre novamente.',{exact:true}).waitFor();
  assert.equal(await recep.page.evaluate(()=>CL.col('pacientes').length),0);
  for(const width of [360,768,1440]) {await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overflow at '+width);}
  await page.screenshot({path:'/tmp/clinicar-acessos.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS navegador: login direto, cadastro→espera→atendimento entre duas contas, reload, delegação, revogação e 3 larguras');
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
