const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
 const context=await browser.newContext();
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await context.route('**/config.js*',r=>r.fulfill({contentType:'application/javascript',body:'window.CLINICAR_CONFIG={};'}));
 const page=await context.newPage();page.on('pageerror',e=>console.log('LOCAL ERROR',e.message));
 await page.goto('http://127.0.0.1:8897',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:/Administração/}).click();
 await page.evaluate(()=>CL.ready);
 assert.equal(await page.evaluate(()=>CL.col('usuarios').length),1);
 await page.evaluate(()=>Config.salvarProfissional({nome:'Profissional Fictício',horarios:Object.fromEntries([0,1,2,3,4,5,6].map(d=>[d,[{ini:'00:00',fim:'23:59'}]])),slot:15,ativo:true}));
 await page.evaluate(()=>CL.persist());
 await page.getByRole('button',{name:'Nova consulta',exact:true}).first().click();
 await page.locator('#drawer-raiz').getByRole('button',{name:'Novo paciente',exact:true}).click();
 await page.locator('[name="novoNome"]').fill('Paciente Local Fictício',{timeout:3000});
 await page.getByRole('button',{name:'Cadastrar e usar'}).click();
 await page.getByRole('button',{name:'Salvar e atender',exact:true}).click();
 await page.waitForURL('**/#/atendimento/**');
 assert.equal(await page.evaluate(()=>CL.col('consultas')[0].status),'em_atendimento');
 const rejected=await page.evaluate(async()=>{
   const c=CL.col('consultas')[0];
   CL.patch('consultas',c.id,{status:'cancelado'});
   const before=location.hash;const r=await Atendimento.iniciar(c.id);
   return {ok:r.ok,status:CL.get('consultas',c.id).status,sameRoute:before===location.hash};
 });
 assert.deepEqual(rejected,{ok:false,status:'cancelado',sameRoute:true});
 await context.clearCookies();
 console.log('PASS local: só administrador inicial, salvar e atender, consulta cancelada não reabre');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
