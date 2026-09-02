# Exportar dados do sistema anterior

O Clinicar novo **não lê** o banco do sistema anterior. A migração é por arquivo: um botão
"Exportar dados" no sistema anterior gera um `.json` que o novo importa em **Ajustes › Importar**.
Nada é enviado a lugar nenhum — o arquivo é gerado no navegador e baixado.

## O trecho a acrescentar (≤ 40 linhas)

Cole a função no fim do `<script>` principal do sistema anterior (ele já tem `state`, `normalize()` e `mtToast()`):

```js
/* ===== Exportar dados para o Clinicar novo (arquivo JSON local) ===== */
function exportarDadosConsultai(){
  const dados={app:'clinicar-antigo',versao:1,exportadoEm:new Date().toISOString(),state:normalize(state)};
  const texto=JSON.stringify(dados);
  const blob=new Blob([texto],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download='clinicar-antigo-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
  const s=dados.state;
  mtToast('Exportado: '+(s.patients||[]).length+' pacientes, '+(s.appts||[]).length+' consultas, '
    +(s.records||[]).length+' evoluções, '+(s.prescriptions||[]).length+' receitas.');
}
```

E o botão, em `renderConfig()`, na mesma linha do botão **Salvar dados**:

```html
<button class="btn btn-g" onclick="exportarDadosConsultai()"><i class="ti ti-download"></i> Exportar dados</button>
```

## Onde fica
Configurações (aba de dados do profissional/clínica) → botão **Exportar dados**, ao lado de "Salvar dados".
Faça isso **logado**, com o app já sincronizado (a pílula de nuvem sem pendências), para o `state` estar completo.

## Como conferir o arquivo
1. O nome é `clinicar-antigo-AAAA-MM-DD.json`. Abra num editor de texto: começa com `{"app":"clinicar-antigo","versao":1,...`.
2. As contagens do toast (pacientes, consultas, evoluções, receitas) devem bater com o que você vê no sistema anterior.
3. No Clinicar novo, **Ajustes › Importar › Escolher arquivo**: a prévia mostra a mesma tabela de contagens
   (encontrados / novos / já existem / descartados) e os avisos — sem nomes. Só grava depois de **Importar**.
4. O que o mapeamento faz (docs/ESPEC.md §3.4): `atendido → finalizado`, `especial → controle especial`,
   receita só-texto vira itens, consultas com nome solto viram fichas novas, `docs[]` vira "Textos importados sem paciente",
   links de teleconsulta antigos são descartados, atestados com CID entram **sem** autorização registrada (revise).

## Segurança
- O arquivo contém dados reais de pacientes: guarde-o só no seu computador e apague-o depois de importar.
- Não anexe em e-mail nem envie por mensageiro.
