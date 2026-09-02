# Clinicar — Especificação da v1 (contrato entre construtores)

Versão 1.0 · 02/09/2026 · Arquiteto. Consolida o BRIEF.md e os 4 relatórios de pesquisa
(mercado nacional, agendas internacionais, raio-X do sistema antigo, requisitos legais/UX).
**Este documento é o contrato.** Quem construir em paralelo (casca · agenda · atendimento ·
integração) implementa EXATAMENTE as assinaturas da seção 4. Dúvida = pergunta ao arquiteto,
nunca invenção silenciosa de API.

Regras absolutas (do BRIEF, repetidas porque são as mais violadas):
1. Nunca expor dados reais de paciente (nem em teste, nem em log, nem em relatório). Teste = dados fictícios em porta própria.
2. Nenhum nome de concorrente no produto. Nenhuma menção ao ecossistema anterior: a string proibida não aparece em `src/`, `functions/`, `firestore.rules`, `CNAME` nem em meta tags.
3. Zero `alert()`, `confirm()`, `prompt()`. Só `CA.ui.modal / confirm / toast / drawer`.
4. Ninguém cria projeto Firebase, mexe em regras publicadas, IAM ou credenciais. `src/config.js` fica vazio.
5. Nunca gravar o estado inteiro por cima (last-write-wins). Só `CA.upsert / CA.remove / CA.setCfg`, que passam pelo merge item a item do `backend.js`.
6. Nenhum `_mt*.js` em `src/`. Nenhuma conta ou Firebase do ecossistema anterior.
7. Zero emoji como ícone. Tabler Icons (`<i class="ti ti-nome">`). Inter. Uma cor de acento.

---

## 1. Visão do produto

Clinicar é o sistema de uma clínica pequena (1 a 6 profissionais, uma recepção) em site próprio, que nasce 100% funcional sem conta e sem servidor (modo local) e ganha sincronização quando o dono ligar seu próprio Firebase.
A recepção vive na agenda — dia com um profissional por coluna, arrastar para remarcar, encaixe explícito, lista de espera, bloqueios, confirmação por WhatsApp com texto pronto — e o profissional vive na lista do dia e no atendimento.
O atendimento reaproveita o que já funcionava (evolução por voz → IA, receituário com modelos, atestado, exames, impressão limpa) e acrescenta o que a lei exige: cabeçalho completo dos documentos, CID só com autorização, evolução que nunca some, perfis que separam recepção de prontuário.
O financeiro nasce no ato de finalizar a consulta (valor do procedimento, forma de pagamento, recebido/pendente) e vira caixa do dia e resumo do mês; o painel mostra hoje, próximos, faltas, receita e aniversariantes.
Os dados são do dono: exportáveis em JSON a qualquer momento, com backup rotativo, painel de recuperação e importação do sistema antigo por arquivo — sem acesso cruzado a nenhum banco.

---

## 2. Escopo

### 2.1 Entra na v1

| Área | Entra |
|---|---|
| Agenda | Visões Dia (colunas por profissional), Semana (7 dias de um profissional), Mês (contagens por dia), Lista (texto, celular/impressão). Slot-base configurável (10/15/20/30). Turnos por profissional pintados; fora-de-turno cinza; bloqueios hachurados. Linha "agora". Painel lateral (drawer) para criar/ver consulta. Arrastar para remarcar (desktop) com validação no arraste, toast com Desfazer, e modal curto se mudar de profissional. Redimensionar pela borda inferior. Status em um clique na ordem do fluxo + menu para Faltou/Cancelou/Cancelado pela clínica; "cancelou tarde" calculado pela janela configurada. Encaixe explícito (checkbox + motivo, limite por hora por profissional, blocos meia-largura com hachura). Lista de espera por profissional com preferências, ordenada por tempo, "Marcar" em modo clique-na-vaga, e sugestão "Vaga aberta · N na espera" ao cancelar/faltar. Bloqueios pontuais e férias (por profissional ou clínica), listando consultas atingidas. Notas do dia por profissional. Busca de consulta por nome em qualquer data. Próxima vaga livre (tipo + profissional). WhatsApp via `wa.me` com modelos (confirmar, lembrete, remarcar, teleconsulta com link colado) e painel "Lembretes de amanhã" com "Marcar como confirmado". Impressão da agenda do dia. Modo privacidade (iniciais). Atalhos T/N/P/Esc/setas. |
| Pacientes | Cadastro completo (inclui nome social, nome da mãe, naturalidade, convênio + carteira, origem, consentimentos opt-in com data/origem), busca instantânea por nome/CPF/telefone/nascimento (blindada contra autofill), cadastro rápido inline (nome + telefone) de dentro da agenda, ficha com abas (Resumo, Consultas, Evoluções, Receitas, Documentos, Exames, Financeiro, Privacidade), contador de faltas/cancelamentos tardios com selo de risco, inativar (nunca apagar), página LGPD do paciente (exportar cópia JSON+PDF, corrigir, registrar pedido de eliminação, ver compartilhamentos). |
| Atendimento | Tela de atendimento aberta da agenda ("Iniciar"), com histórico ao lado. Evolução (livre/SOAP/anamnese/alta/encaminhamento) com rascunho autosalvo, ditar (Web Speech, só onde existir), gravar consulta → IA (quando backend configurado) e "Estruturar com IA"; versão anterior preservada ao editar ("retificado em"). Receituário com banco de medicamentos (reaproveitar `MED_DB`), tipos Simples / Antimicrobiano (2 vias, validade 10 dias) / Controle especial (2 vias, 30 dias, separado), quantidade por extenso nas controladas, aviso de alergia, modelos. Atestado (afastamento/comparecimento/acompanhante) com CID desligado por padrão e autorização registrada na ficha. Pedido de exames (chips + lista). Declaração/encaminhamento/relatório por modelo com `{{nome}} {{cpf}} {{data}}`. Exames laboratoriais com curva SVG. Resumo do paciente por IA. Impressão A4 limpa via iframe oculto, cabeçalho legal completo, 2 vias rotuladas, rodapé "imprima e assine / assine com seu certificado". Termo de consentimento por modelo. |
| Financeiro | Lançamento criado ao finalizar a consulta (valor do procedimento, desconto, forma, parcelas, recebido/pendente), baixa posterior, despesas simples, caixa do dia, extrato filtrável (período, profissional, forma, convênio, status), resumo do mês, repasse por profissional (% ou fixo). |
| Painel | Hoje (sala de espera em três colunas com cronômetro), próximos, contadores do dia, faltas e cancelamentos tardios do mês, receita do mês (recebido × pendente), aniversariantes da semana, lembrete de backup (7 dias sem exportar no modo local), pedidos LGPD com prazo. |
| Configurações | Clínica (dados para impressão, logo fora do estado principal, rodapé), profissionais (conselho/número/UF/RQE/especialidade/cor/horários por dia da semana/slot/encaixes por hora/repasse), procedimentos (nome/duração/valor/cor/modalidade/intervalo), convênios, política de cancelamento (janela e taxa), modelos de WhatsApp, usuários e perfis (recepção/profissional/administrador, PIN opcional), dados (exportar tudo, importar, backups, painel de recuperação), privacidade (responsável, contato, aviso de privacidade imprimível, checklist de incidente), sobre (declaração de não certificação). |
| Importar | "Importar arquivo (JSON)": aceita a exportação do sistema antigo e a exportação do próprio Clinicar; prévia SÓ de contagens e avisos; mapeamento campo a campo (seção 3.4); modo mesclar ou substituir com confirmação. |
| Plataforma | Rota por hash (Voltar funciona, F5 mantém contexto), backend com adaptadores `local` e `firebase` atrás da mesma interface, merge item a item com lápides, blindagem do localStorage (backup rotativo, trava no 1º save, chave ruim preservada, aviso de cota), login próprio, manifest PWA (sem service worker na v1), `firestore.rules` e `functions/index.js` prontos para o dono publicar, `CNAME` de exemplo. |

### 2.2 Fica para depois (semente de `docs/PENDENTE.md`)

Cada item abaixo entra em `docs/PENDENTE.md` com a mesma redação; nada disso é prometido na v1 nem aparece como botão morto.

1. Agendamento online pelo paciente (página pública com vagas reais).
2. Teleconsulta com vídeo dentro do produto (WebRTC exige sinalização + TURN no Firebase próprio). Na v1, "Teleconsulta" é um procedimento com campo de link externo colado, que entra na mensagem de WhatsApp.
3. Recorrência de consultas (semanal/quinzenal/mensal com prévia de conflitos).
4. Remarcação em massa de um dia inteiro.
5. Sincronização com Google/Apple Calendar.
6. Faturamento TISS, guias, glosas e NFS-e.
7. Contas a pagar completas, centros de custo, DRE, múltiplas contas.
8. Assinatura digital qualificada (ICP-Brasil) dentro do app; validação em validar.iti.gov.br.
9. Anexos de arquivo (PDF/imagem) no prontuário — exige Storage no Firebase próprio; v1 não anexa.
10. Multiusuário real por clínica no Firebase (contas separadas por funcionário com regras por perfil). Na v1 os perfis são locais (limitam a interface, não são segurança forte) e o Firebase é uma conta = uma clínica.
11. Service worker / uso offline no modo firebase (o modo local já funciona sem rede se a página estiver aberta).
12. Bloqueio de tela por inatividade e backup cifrado com senha.
13. Gatilho automático da lista de espera com prazo de resposta e ofertas simultâneas (v1: manual, um por vez, com registro da oferta).
14. Cadência automática de lembretes (D-7/D-2/D-1/D-0) — v1: painel manual de "Lembretes de amanhã".
15. Prescrição/receita eletrônica com assinatura e envio direto à farmácia.
16. Painel de chamada da sala de espera em TV.
17. Indicadores avançados (ocupação, tempo até 3ª vaga, vagas preenchidas pela espera).
18. Curvas de crescimento, IG/DPP e calculadoras clínicas na ficha.
19. Impressão de Notificação de Receita A/B (formulário oficial numerado; o app só avisa).
20. Compactação segura de lápides com múltiplos aparelhos offline por mais de 90 dias.

---

## 3. Modelo de dados

### 3.1 Convenções

- Estado em memória: `CA.state = { <coleção>: [], cfg: {...}, _tomb: {id: tsMs} }`.
- Todo item de coleção tem `id` (string, sem ponto — `CA.uid()` = `Date.now().toString(36) + '-' + 6 chars base36`), `createdAt` (ms) e `updatedAt` (ms). `updatedAt` é carimbado SEMPRE por `CA.upsert`; construtores não carimbam à mão.
- Exclusão = `CA.remove(col, id)` → grava `_tomb[id] = Date.now()` e filtra. Coleções clínicas (evolucoes, receitas, documentos, exames, auditoria) **não têm exclusão na interface**; só inativação/versão.
- Datas de calendário: `'YYYY-MM-DD'`. Horas: `'HH:MM'`. Instantes: ms desde epoch (`Date.now()`). Dinheiro: inteiro em centavos (`valorCent`). Nunca float para dinheiro.
- `cfg` é um objeto único com `updatedAt`; no merge vence o `updatedAt` maior (nunca é reescrito parcialmente a partir de um form — `CA.setCfg(patch)` mescla sobre o existente).
- Logo e outros blobs ficam FORA do estado principal (`clinicar.v1.logo` no localStorage; em firebase, doc `meta/logo`).
- Os IDs importados do sistema antigo são preservados (já são base36 sem ponto).

### 3.2 Coleções

**profissionais**
```
{ id, nome, conselho:'CRM'|'CRO'|'CRP'|'CREFITO'|'CRN'|'OUTRO', numero, uf, rqe, especialidade,
  cor:'#hex' (uma de 8 cores de identificação, seção 7), ativo:true,
  horarios:{ '1':[{ini:'08:00',fim:'12:00'},{ini:'14:00',fim:'18:00'}], ... '0'..'6' (0=domingo) },
  slot:15, maxEncaixesHora:1, procIds:[...] (vazio = todos), procPadraoId,
  repasse:{ modo:'pct'|'fixo'|'nenhum', valor:number },   // pct 0-100; fixo em centavos
  usuarioId|null, createdAt, updatedAt }
```

**procedimentos** (tipos de consulta)
```
{ id, nome, dur:30, valorCent:0, cor:'#hex', modalidade:'presencial'|'tele', bufferMin:0,
  ativo:true, createdAt, updatedAt }
```
Semente na primeira execução: Consulta (30 min), Retorno (20), Procedimento (60), Teleconsulta (30, tele), Exame (30).

**convenios**
```
{ id, nome, ativo:true, createdAt, updatedAt }
```
Semente: "Particular" (id fixo `'particular'`).

**pacientes**
```
{ id, nome, nomeSocial:'', nasc:'YYYY-MM-DD'|'', sexo:'M'|'F'|'O'|'', cpf:'', fone:'', email:'',
  endereco:'', nomeMae:'', naturalidade:'', convenioId:'particular', convenioNumero:'',
  origem:'indicacao'|'site'|'whatsapp'|'convenio'|'importacao'|'outro'|'',
  alergias:'', problemas:'', meds:'', obs:'',
  consentimentos:{ lembretes:{ativo:false, em:ms|null, origem:'verbal'|'assinado'|'whatsapp'|''},
                   campanhas:{...}, compartilhamento:{...} },
  cidAutorizacoes:[{ em:ms, documentoId, cid }],
  lgpd:{ pedidos:[{ em:ms, tipo:'eliminacao'|'correcao'|'copia', status:'aberto'|'atendido', obs }],
         compartilhamentos:[{ em:ms, tipo:'impressao'|'exportacao'|'whatsapp', alvo }] },
  ativo:true, inativadoEm:null, createdAt, updatedAt }
```
Faltas e cancelamentos tardios NÃO são campos: são derivados de `consultas` por `Pacientes.faltas(id)`.

**consultas**
```
{ id, data:'YYYY-MM-DD', hora:'HH:MM', dur:30, profId, pacId, procId,
  status:'agendado'|'confirmado'|'chegou'|'em_atendimento'|'finalizado'|'faltou'|
         'cancelado'|'cancelado_tarde'|'cancelado_clinica',
  encaixe:false, encaixeMotivo:'', obs:'', origem:'recepcao'|'espera'|'importacao',
  teleLink:'', lembreteEm:null, confirmadoEm:null, chegouEm:null, inicioEm:null, fimEm:null,
  cancelamento:{ em:ms, motivo:'', porQuem:'paciente'|'clinica' }|null,
  esperaId:null, evolucaoId:null, lancamentoId:null,
  historico:[{ em:ms, usuario, acao:'criada'|'remarcada'|'status'|'lembrete'|'editada', de, para }],
  createdAt, updatedAt }
```
Consulta nunca é apagada pela interface: cancelar muda status. `CA.remove` em consultas só existe para desfazer criação acidental nos primeiros 60 s (toast Desfazer).

**bloqueios**
```
{ id, profId|null (null = clínica inteira), dataIni, dataFim, horaIni:'00:00', horaFim:'23:59',
  diaInteiro:true, motivo:'ferias'|'feriado'|'congresso'|'reuniao'|'almoco'|'outro', descricao:'',
  createdAt, updatedAt }
```

**espera**
```
{ id, pacId, profId|null, procId, prioridade:'normal'|'urgente', diasPref:[1,3,5] (vazio = qualquer),
  horaPref:{ini:'',fim:''}, obs:'', ofertas:[{ em:ms, data, hora, profId }],
  status:'aguardando'|'marcado'|'desistiu', consultaId:null, createdAt, updatedAt }
```

**notasDia**
```
{ id:'<data>_<profId|geral>', data, profId|null, texto, createdAt, updatedAt }
```

**evolucoes** (era `records`)
```
{ id, pacId, profId, consultaId|null, data:ISO, tipo:'evolucao'|'soap'|'anamnese'|'alta'|'encaminhamento',
  tipoAtend:'primeira'|'retorno'|'nova', titulo, texto,
  versoes:[{ em:ms, usuario, titulo, texto }],   // versão anterior a cada edição (append-only)
  origem:'manual'|'ia_texto'|'ia_audio'|'importacao', createdAt, updatedAt }
```

**receitas** (era `prescriptions`)
```
{ id, pacId, profId, data:ISO, tipo:'simples'|'antimicrobiano'|'controle',
  itens:[{ nome, pos, qtd:'', qtdExtenso:'' }], obs, createdAt, updatedAt }
```

**documentos**
```
{ id, pacId, profId, data:ISO,
  tipo:'atestado'|'exames'|'declaracao'|'encaminhamento'|'relatorio'|'consentimento',
  subtipo:'afastamento'|'comparecimento'|'acompanhante'|'', dias:null, dataInicio:'', horaIni:'', horaFim:'',
  cid:'', cidAutorizado:false, texto, titulo, exames:'', ind:'', obs:'', modeloId:null,
  createdAt, updatedAt }
```

**exames** (era `labs`)
```
{ id, pacId, data:'YYYY-MM-DD', nome, valor:number, unidade, createdAt, updatedAt }
```

**modelos**
```
{ id, tipo:'rx'|'atestado'|'exames'|'evolucao'|'documento'|'whatsapp', nome, updatedAt, createdAt,
  rx:{ rxTipo, itens, obs } | atestado:{ subtipo, dias, cid, texto } | exames:{ lista } |
  evolucao:{ tipo, texto } | documento:{ tipoDoc, titulo, texto } | whatsapp:{ chave, texto } }
```

**lancamentos**
```
{ id, tipo:'receita'|'despesa', consultaId|null, pacId|null, profId|null, procId|null,
  data:'YYYY-MM-DD', descricao, valorCent, descontoCent:0,
  forma:'dinheiro'|'pix'|'debito'|'credito'|'convenio'|'outro'|'', parcelas:1,
  status:'pendente'|'recebido'|'cancelado', recebidoEm:null, convenioId|null,
  createdAt, updatedAt }
```

**usuarios** (perfis; no firebase v1 vivem dentro da conta única da clínica)
```
{ id, nome, perfil:'admin'|'recepcao'|'profissional', profId|null, pinHash:''|sha256hex, ativo:true,
  createdAt, updatedAt }
```

**auditoria** (append-only, teto 5.000 itens — o mais antigo sai)
```
{ id, em:ms, usuarioId, perfil, acao:'ficha.abrir'|'evolucao.criar'|'evolucao.editar'|'documento.imprimir'|
  'receita.imprimir'|'paciente.exportar'|'dados.exportar'|'dados.importar'|'consulta.status'|'login'|'logout',
  alvo:'<coleção>', alvoId, pacId|null, createdAt, updatedAt }
```

**cfg** (objeto único)
```
{ clinica:{ nome, endereco, telefone, email, cnpj:'', rodape:'' },
  agenda:{ slotBase:15, horaIni:'07:00', horaFim:'19:00', densidade:'padrao' },
  politica:{ janelaCancelamentoH:24, taxaFaltaCent:0, taxaFaltaPct:0, cobrarTardio:true },
  lgpd:{ responsavel:'', contato:'', aviso:'' },
  whatsapp:{ modelos:{ confirmar, lembrete, remarcar, tele, vaga } },   // textos com {nome} {data} {hora} {prof} {clinica} {endereco} {link}
  seed:true, versao:1, updatedAt }
```

**_tomb** `{ [id]: tsMs }` — unido pelo maior timestamp; compactado em `Backend.compactTomb` (só no modo local, > 90 dias).

### 3.3 Layout no Firebase (adaptador `firebase`)

```
users/{uid}/pacientes/{id}      users/{uid}/consultas/{id}    users/{uid}/evolucoes/{id}
users/{uid}/receitas/{id}       users/{uid}/documentos/{id}   users/{uid}/exames/{id}
users/{uid}/modelos/{id}        users/{uid}/lancamentos/{id}  users/{uid}/profissionais/{id}
users/{uid}/procedimentos/{id}  users/{uid}/convenios/{id}    users/{uid}/bloqueios/{id}
users/{uid}/espera/{id}         users/{uid}/notasDia/{id}     users/{uid}/usuarios/{id}
users/{uid}/auditoria/{id}
users/{uid}/meta/cfg   (= cfg)      users/{uid}/meta/tomb  ({ ids:{ [id]:ts } })
users/{uid}/meta/logo  ({ dataUrl })  users/{uid}/meta/info  ({ versao, ultimoSync })
```
Um documento por item: nada de "state inteiro num doc de 1 MiB". Regras: dono lê/escreve só `users/{uid}/**`.

### 3.4 Mapa de importação: sistema antigo → novo

Formato aceito: `{ app:'clinicar-antigo', versao:1, exportadoEm, state:{...} }` (gerado pelo trecho de `docs/EXPORTACAO-ANTIGO.md`) **ou** o `state` cru (detectado por ter `patients`/`appts`/`records`). A exportação do próprio Clinicar é `{ app:'clinicar', versao:1, exportadoEm, state }` e importa 1:1.

Antes de tudo o importador cria (se não existir) **um profissional padrão** a partir de `cfg` antigo e **os 5 procedimentos** de semente; todo item importado recebe `profId` desse profissional. Convênios são criados a partir do texto `convenio` normalizado (`CA.util.norm`), sem duplicar.

| Antigo | Novo | Regra |
|---|---|---|
| `patients[].id` | `pacientes[].id` | preservado |
| `.nome` | `.nome` | trim |
| `.nasc` | `.nasc` | como está (YYYY-MM-DD ou vazio) |
| `.sexo` M/F/O | `.sexo` | idem |
| `.cpf` `.fone` `.email` `.endereco` | mesmos nomes | só dígitos em cpf/fone guardados como texto |
| `.convenio` (texto) | `.convenioId` | vazio → `'particular'`; senão cria/casa convênio por nome normalizado |
| `.alergias` `.problemas` `.meds` `.obs` | mesmos nomes | — |
| `.criadoEm` (ISO) | `.createdAt` (ms) | `Date.parse`; falha → `updatedAt` |
| `.updatedAt` | `.updatedAt` | preservado (importante para o merge) |
| — | `nomeSocial, nomeMae, naturalidade, convenioNumero` | `''` |
| — | `origem` | `'importacao'` |
| — | `consentimentos` | todos `{ativo:false}` (nunca inventar opt-in) |
| — | `ativo` | `true` |
| `appts[].id` | `consultas[].id` | preservado |
| `.date` `.time` `.dur` | `.data` `.hora` `.dur` | `time` vazio → `'08:00'`; `dur` inválido → 30 |
| `.pacId` | `.pacId` | se nulo e `.pac` (nome solto) existir: casa paciente por nome normalizado; sem par → cria paciente `{nome:pac, fone, origem:'importacao'}` (conta em "pacientes criados a partir de consultas") |
| `.fone` | `pacientes[].fone` | só se o paciente casado/criado estiver sem telefone |
| `.type` con/ret/tel/pro/exa | `.procId` | con→Consulta, ret→Retorno, tel→Teleconsulta, pro→Procedimento, exa→Exame |
| `.status` | `.status` | agendado→agendado, confirmado→confirmado, atendido→finalizado, faltou→faltou, cancelado→cancelado |
| `.obs` | `.obs` | — |
| `.teleRoom` | `.teleLink` | `''` (a sala antiga não existe no produto novo; contar em "links de teleconsulta descartados") |
| `.updatedAt` | `.updatedAt` | preservado |
| — | `profId` | profissional padrão |
| — | `encaixe, origem, historico` | `false, 'importacao', [{acao:'criada', em:updatedAt, usuario:'importacao'}]` |
| `records[].id .pacId .tipo .tipoAtend .titulo .texto .updatedAt` | `evolucoes[]` mesmos nomes | `date`→`data`; `apptId`→`consultaId`; `versoes:[]`; `origem:'importacao'`; `profId` padrão; sem `pacId` válido → descartado e contado |
| `prescriptions[].id .pacId .obs .updatedAt` | `receitas[]` | `date`→`data`; `tipo` simples→simples, especial→controle; `itens` ausente → parse de `texto` por linha em `' — '` → `{nome,pos}`; `qtd,qtdExtenso:''` |
| `documentos[].*` | `documentos[]` | mesmos campos; `tipo` atestado/exames preservado; `cid` preenchido → `cidAutorizado:false` (contar em "atestados com CID sem autorização registrada"); `profId` padrão |
| `labs[].id .pacId .date .nome .valor .unidade .updatedAt` | `exames[]` | `date`→`data` |
| `modelos[]` tipo rx/atestado | `modelos[]` | `rx:{rxTipo (especial→controle), itens, obs}` / `atestado:{subtipo,dias,cid,texto}` — campos soltos movidos para o subobjeto |
| `docs[]` (histórico sem id/paciente) | `evolucoes[]` | `id` novo, `pacId:null`, `titulo:title`, `data:date`, `texto:out`, `origem:'importacao'`; aparecem em Configurações › Dados › "Textos importados sem paciente" (só contagem + abrir um a um) |
| `cfg.medico .crm .esp .rqe` | `profissionais[0]` | `nome`, `numero` (dígitos), `uf` (se vier "12345-CE" ou "CRM-CE 12345"), `especialidade`, `rqe` |
| `cfg.clinica .endereco .telefone .rodape` | `cfg.clinica.*` | — |
| `cfg.logo` (dataURL) | `clinicar.v1.logo` / `meta/logo` | fora do estado |
| `cfg.agenda.ini .fim .slot .dias[]` | `profissionais[0].horarios` + `.slot`; `cfg.agenda.horaIni/horaFim` | cada dia em `dias` recebe `[{ini,fim}]`; `slot` → `profissionais[0].slot` e `cfg.agenda.slotBase` |
| `migratedEvoluai` | — | ignorado |
| `_tomb` | `_tomb` | unido pelo maior timestamp |

Prévia obrigatória antes de aplicar: tabela de contagens por coleção (encontrados / novos / já existentes / descartados) + avisos numerados. **Nunca nomes, CPFs ou telefones na prévia.**

---

## 4. Arquitetura de arquivos

```
clinicar/
├── src/
│   ├── index.html         casca, navegação por hash, pontos de montagem
│   ├── styles.css         tokens + componentes + grade da agenda + impressão
│   ├── config.js          config web do Firebase (VAZIA) + comentário
│   ├── core.js            CA: estado, storage, roteador, modal/toast, utilitários
│   ├── backend.js         Backend: interface única + adaptadores local/firebase
│   ├── login.js           Login: tela própria + "modo local" + perfis
│   ├── agenda.js          Agenda
│   ├── pacientes.js       Pacientes
│   ├── atendimento.js     Atendimento (evolução, receita, atestado, exames, docs, impressão)
│   ├── financeiro.js      Financeiro
│   ├── painel.js          Painel
│   ├── configuracoes.js   Config
│   ├── importar.js        Importar
│   ├── manifest.webmanifest, icone-192.png, icone-512.png
├── firestore.rules
├── functions/index.js
├── CNAME
└── docs/ ESPEC.md · PENDENTE.md · DOMINIO.md · EXPORTACAO-ANTIGO.md
```

Ordem de carga no `index.html` (scripts clássicos, `defer`, nesta ordem): `config.js → core.js → backend.js → login.js → pacientes.js → agenda.js → atendimento.js → financeiro.js → painel.js → configuracoes.js → importar.js`. Cada módulo expõe UM global (`CA`, `Backend`, `Login`, `Agenda`, `Pacientes`, `Atendimento`, `Financeiro`, `Painel`, `Config`, `Importar`). Nenhum `import`/`export` ES (sem bundler; scripts clássicos para `file://` e GitHub Pages).

Donos: **casca** = index.html, styles.css, core.js, login.js, painel.js, configuracoes.js, financeiro.js, manifest/ícones · **agenda** = agenda.js, pacientes.js · **atendimento** = atendimento.js · **integracao** = backend.js, config.js, importar.js, firestore.rules, functions/index.js, CNAME, docs/DOMINIO.md, docs/EXPORTACAO-ANTIGO.md, docs/PENDENTE.md.

Contrato de módulo de tela (todos os que têm rota): `X.mount(el, params)` desenha dentro de `el` (limpa antes), `X.unmount()` remove listeners/timers. O roteador chama `unmount` do anterior e `mount` do novo. Módulos não tocam no DOM fora do `el` recebido, exceto via `CA.ui.*`.

Padrão de eventos DOM: **delegação** (`el.addEventListener('click', e => e.target.closest('[data-acao]'))`) com `data-acao` / `data-id`. Proibido `onclick="fn('${id}')"` inline.

### 4.1 `index.html` (dono: casca)

Responsabilidade: casca única. `<head>` com `<title>Clinicar</title>`, meta viewport, `theme-color`, manifest, Inter (Google Fonts, com fallback `system-ui`), Tabler Icons webfont (cdn.jsdelivr `@tabler/icons-webfont`), `styles.css`. `<body>`: honeypot anti-autofill logo após `<body>` (`<input name="username" … tabindex="-1" aria-hidden>` + `password`, ambos fora da tela), `#app` com:
- `<header id="topo">` — marca "Clinicar", seletor de contexto (nome do usuário + perfil), botão de sincronização/estado (`modo local` | `sincronizado` | `sem rede`), botão "Modo privacidade".
- `<nav id="nav">` — links `#/agenda`, `#/pacientes`, `#/painel`, `#/financeiro`, `#/config` com ícones Tabler (`ti-calendar`, `ti-users`, `ti-layout-dashboard`, `ti-cash`, `ti-settings`). Desktop: barra lateral estreita (64 px) com rótulo; ≤ 767 px: barra inferior fixa.
- `<main id="vista">` — ponto de montagem das telas.
- `<div id="drawer-raiz">`, `<div id="modal-raiz">`, `<div id="toast-raiz">`, `<iframe id="print-raiz" hidden>`.
- `<div id="login-raiz">` — a tela de login cobre tudo enquanto não há sessão.
Depende de: todos os scripts. Sem JS inline além de `CA.boot()` no final.

### 4.2 `styles.css` (dono: casca)

Responsabilidade: tokens (seção 7), reset, tipografia, componentes (`.btn`, `.input`, `.select`, `.card`, `.chip`, `.tabela`, `.modal`, `.drawer`, `.toast`, `.vazio`, `.skeleton`), layout da casca, **grade da agenda** (`.ag-grade`, `.ag-col`, `.ag-bloco`, `.ag-turno`, `.ag-bloqueio`, `.ag-agora`, estados `.is-arrastando`, `.is-invalido`), classes de status (`.st-agendado` …), `@media print` (esconde casca; documentos A4). Nada de estilo inline nos módulos além de posicionamento calculado (`top/height/left/width` dos blocos).

### 4.3 `config.js` (dono: integracao)

```js
// Cole aqui a configuração web do projeto Firebase PRÓPRIO do Clinicar
// (Console → Configurações do projeto → Seus apps → SDK → firebaseConfig).
// Enquanto apiKey estiver vazia, o app roda em modo local (sem conta).
window.CLINICAR_CONFIG = { apiKey:'', authDomain:'', projectId:'', storageBucket:'',
  messagingSenderId:'', appId:'', regiaoFunctions:'southamerica-east1' };
```
Só isso. Sem lógica.

### 4.4 `core.js` (dono: casca) — global `CA`

Depende de: `Backend` (chamado em `boot`), `Login` (gate). Todo mundo depende de `CA`.

Estado e persistência
- `CA.state` — objeto vivo (seção 3). Leitura direta permitida; **escrita só pelas funções abaixo**.
- `CA.ready: Promise<void>` — resolve após `boot` carregar o estado e a sessão.
- `CA.col(nome) → Array` — a coleção (cria vazia se faltar).
- `CA.get(nome, id) → obj|undefined`.
- `CA.upsert(nome, obj) → obj` — atribui `id` se faltar, `createdAt` se faltar, `updatedAt = Date.now()`; substitui/insere; marca sujo; `CA.persist()`; emite `'change'` com `{col:nome, id, obj}`. Devolve o objeto guardado.
- `CA.patch(nome, id, campos) → obj` — `Object.assign` + mesma trilha de `upsert`.
- `CA.remove(nome, id) → boolean` — lápide + filtra + persist + `'change'`.
- `CA.setCfg(patchProfundo) → cfg` — mescla recursivamente sobre `state.cfg`, carimba `updatedAt`, persist, emite `'cfg'`.
- `CA.persist() → Promise<void>` — debounce 300 ms → `Backend.save(state, {sujos})`; em falha: `CA.ui.toast(msg, {kind:'erro', fixo:true, action:{label:'Exportar agora', fn}})`. Nunca engole erro.
- `CA.on(evento, fn) → unsub`, `CA.emit(evento, dado)`. Eventos: `'change'`, `'cfg'`, `'route'`, `'session'`, `'sync'` (`{estado:'ok'|'offline'|'erro'|'local', em}`), `'consulta:status'` (`{id, de, para}`), `'privacidade'` (`bool`).
- `CA.uid() → string`.
- `CA.lote(fn) → Promise<void>` — executa `fn` com o debounce de `persist` suspenso e faz UM `Backend.save` ao final (importação, seed, restauração).
- `CA.seed()` — na primeira execução cria procedimentos, convênio Particular, usuário admin "Administração" e modelos de WhatsApp padrão; `cfg.seed=true`.

Sessão e permissões
- `CA.session` — `{ usuarioId, nome, perfil, profId, privacidade:false }` ou `null`.
- `CA.session.set(usuario)`, `CA.session.clear()`, `CA.can(acao) → boolean` com ações `'clinico'` (abrir evolução/receita/documento: profissional e admin), `'financeiro'` (recepção, admin), `'config'` (admin), `'agenda'` (todos). Recepção não passa em `'clinico'` — a UI esconde e o roteador redireciona com toast "Seu perfil não abre o prontuário".
- `CA.audit(acao, alvo, alvoId, extra)` — insere em `auditoria` (com teto).

Roteador (hash)
- Formato: `#/vista[/seg1[/seg2]][?a=1&b=2]`. Exemplos: `#/agenda/dia/2026-09-02?prof=abc,def`, `#/pacientes/ID/evolucoes`, `#/atendimento/CONSULTA_ID`, `#/financeiro/caixa/2026-09-02`, `#/config/profissionais`, `#/login`.
- `CA.route.register(vista, modulo)` — `modulo` tem `mount(el, params)` / `unmount()`. `params = { seg:[...], q:{...} }`.
- `CA.route.go(hash, {replace:false})`, `CA.route.current → {vista, seg, q, hash}`, `CA.route.voltar()`.
- Guarda: sem sessão → `#/login` (guarda o destino e volta depois). `hashchange` → `unmount`/`mount`. Rota desconhecida → `#/agenda`.
- Preserva scroll por vista em `sessionStorage`.

UI própria (substitui alert/confirm/prompt)
- `CA.ui.modal({ titulo, corpo: string|Element, botoes:[{ rotulo, tipo:'primario'|'perigo'|'neutro', acao(ctx), fecha:true }], largo:false, aoFechar }) → { el, fechar() }` — remove qualquer modal anterior antes de abrir; Esc fecha; foco preso; `aria-modal`; foco volta ao disparador.
- `CA.ui.confirmar({ titulo, texto, ok:'Confirmar', okTipo:'primario'|'perigo', cancelar:'Cancelar' }) → Promise<boolean>`.
- `CA.ui.pedirTexto({ titulo, rotulo, valor:'', placeholder }) → Promise<string|null>`.
- `CA.ui.toast(msg, { kind:'ok'|'erro'|'aviso'|'info', ms:4000, fixo:false, action:{ rotulo, fn } }) → { fechar() }` — no máximo 3 visíveis; com `action` dura 6 s.
- `CA.ui.drawer({ titulo, corpo, rodape, largura:'md'|'lg', aoFechar }) → { el, fechar() }` — painel à direita (desktop) / folha inferior (≤ 767 px); Esc fecha; só um por vez.
- `CA.ui.vazio(el, { icone, titulo, texto, acao:{ rotulo, fn } })`, `CA.ui.carregando(el, texto)` (esqueleto sem pulo), `CA.ui.erro(el, { texto, acao })`.
- `CA.ui.menu(ancoraEl, [{ rotulo, icone, tipo, fn }])` — menu "…" posicionado.

Formatação e utilitários
- `CA.fmt.data(ymd) → 'dd/mm/aaaa'`, `CA.fmt.dataExtenso(ymd)`, `CA.fmt.diaSemana(ymd, curto)`, `CA.fmt.hora(hhmm)`, `CA.fmt.dinheiro(cent) → 'R$ 1.234,56'`, `CA.fmt.idade(nasc) → '34 a'|''`, `CA.fmt.fone(digits)`, `CA.fmt.cpf(digits)`, `CA.fmt.relativo(ms)`.
- `CA.util.hoje() → 'YYYY-MM-DD'`, `ymd(date)`, `addDias(ymd, n)`, `min('HH:MM') → int`, `hhmm(int)`, `somaMin('HH:MM', n)`, `norm(str)` (minúsculas sem acento), `esc(str)` (HTML), `iniciais(nome)`, `debounce(fn, ms)`, `digits(str)`, `centavos('12,50') → 1250`, `sha256(str) → Promise<hex>`, `baixar(nomeArquivo, texto, mime)`, `semAutofill(inputEl)` (limpa valor com "@" no foco e ignora no filtro).
- `CA.STATUS` — `{ agendado:{ rotulo:'Agendado', icone:'ti-calendar', classe:'st-agendado', terminal:false }, … }` para os 9 status. `CA.FLUXO = ['agendado','confirmado','chegou','em_atendimento','finalizado']`. `CA.proximoStatus(s) → s|null`.
- `CA.print.documento({ titulo, corpoHtml, paciente, profissional, tipoDoc:'receita'|'atestado'|'exames'|'documento'|'evolucao'|'agenda', vias:1|2, rotulosVias:['1ª via — farmácia','2ª via — paciente'], validade:'', mostrarCid:false }) → Promise<void>` — monta A4 no `#print-raiz` (iframe oculto, `srcdoc`, sem `window.open`, sem `document.write`), cabeçalho legal (nome + conselho/UF, RQE, clínica, endereço, telefone/e-mail), linha do paciente (nome · CPF · nascimento), data/hora de emissão, corpo, assinatura + carimbo, rodapé fixo "Documento gerado eletronicamente. Válido quando impresso e assinado pelo profissional ou assinado digitalmente com certificado ICP-Brasil." + `cfg.clinica.rodape`; imprime `vias` páginas rotuladas; registra `CA.audit`. CPF vazio → modal "Sem CPF na ficha — imprimir assim mesmo?".
- `CA.keys.register(vista, { 't': fn, 'n': fn, … })` — atalhos ativos só na vista atual e fora de inputs.
- `CA.pref.get(chave, padrao)` / `CA.pref.set(chave, valor)` — preferências de interface em `clinicar.v1.pref` (densidade, profissionais visíveis, última visão).
- `CA.boot() → Promise<void>` — `Backend.init(window.CLINICAR_CONFIG)` → `Backend.load()` → `state` → `seed` → `Backend.subscribe` → `Login.gate()` → `route.start()`.

### 4.5 `backend.js` (dono: integracao) — global `Backend`

Interface única; dois adaptadores internos escolhidos em `init`. Depende de: `CA.util`, `CA.ui.toast` (só para avisos de cota), nunca de módulos de tela.

- `Backend.init(config) → Promise<{ modo:'local'|'firebase' }>` — firebase se `config.apiKey` não vazio E o SDK carregar (import dinâmico de `https://www.gstatic.com/firebasejs/10.13.2/*`); falha de rede no SDK → cai para local com toast "Sem acesso ao servidor; modo local". `Backend.modo` fica preenchido.
- `Backend.load() → Promise<state>` — local: lê `clinicar.v1.state` com a blindagem abaixo; firebase: lê as 16 coleções + `meta/*`, mescla com o cache local e devolve.
- `Backend.save(state, { sujos:{ [col]: Set<id> }, cfg:boolean, tomb:boolean }) → Promise<void>` — local: grava tudo (com rotação); firebase: grava cache local E, por item sujo, transação que lê o doc remoto e só escreve se `local.updatedAt >= remoto.updatedAt` (senão traz o remoto para o estado e emite `'sync'`); `meta/tomb` via `setDoc(ref, { ids:{ [id]:ts } }, { merge:true })` (ids sem ponto); `meta/cfg` só se `updatedAt` maior. **Sem fallback para gravação crua**: se a transação falhar, rejeita e `CA.persist` avisa.
- `Backend.subscribe(fn) → unsub` — local: evento `storage` (outra aba) → recarrega e chama `fn(state)`; firebase: `onSnapshot` por coleção → `Backend.merge` → `fn(stateMesclado)`.
- `Backend.merge(remoto, local) → state` — puro, testável: união por id, vence `updatedAt` maior (empate: local), remove se `_tomb[id] >= updatedAt`, lápides unidas pelo maior ts, `cfg` pelo `updatedAt`.
- `Backend.compactTomb(state, dias=90) → state` — só local.
- `Backend.auth` — `{ user, entrar(email, senha) → Promise<user>, sair() → Promise, aoMudar(fn) → unsub, redefinirSenha(email) → Promise }`. Local: `user = null`, `entrar` rejeita com `'modo local'`.
- `Backend.ai` — `{ disponivel() → boolean, texto(prompt, { model:'gemini-2.5-pro' }) → Promise<string>, audio(base64, mime, prompt, { model }) → Promise<string> }`. Local ou sem Functions: `disponivel()=false` e as chamadas rejeitam com `Error('configure o backend')` — a UI mostra "Configure o backend para usar a IA" (link para `#/config/sobre`). Firebase: `httpsCallable(functions, 'gemini')` `{prompt, model} → {text}` e `'geminiAudio'` `{audio, mimeType, prompt, model} → {text}`, região `config.regiaoFunctions`. Teto no cliente: 9.000.000 chars de base64 (aviso antes de estourar).
- `Backend.backups() → [{ chave, em, contagens:{ pacientes, consultas, … } }]`, `Backend.restaurar(chave) → Promise<state>`, `Backend.chavesRuins() → [...]`, `Backend.exportar() → string` (JSON `{ app:'clinicar', versao:1, exportadoEm, state }`), `Backend.limparRuins()`.
- `Backend.logo.get() → dataUrl|''`, `Backend.logo.set(dataUrl)`.
- `Backend.status() → { modo, online, ultimoSaveOk, ultimoSync, pendentes }`.

Blindagem do adaptador local (obrigatória):
1. Chaves: `clinicar.v1.state`, `clinicar.v1.bk.1|2|3`, `clinicar.v1.ruim.<ts>`, `clinicar.v1.meta` `{ ultimoSaveOk, ultimoExport, contagemUltimoSave, sessaoSalvou }`, `clinicar.v1.logo`, `clinicar.v1.sessao`, `clinicar.v1.pref`.
2. `load`: JSON inválido → renomeia para `clinicar.v1.ruim.<ts>` (nunca sobrescreve), carrega o backup mais recente COM dados e abre o painel de recuperação (`Config.abrirRecuperacao()`) com toast fixo.
3. Trava do 1º save: se o estado a gravar tem 0 pacientes E 0 consultas mas `meta.contagemUltimoSave` > 0 e a sessão ainda não salvou nada → **não grava**, abre a recuperação. Só grava vazio após confirmação explícita ("Apagar tudo" digitando REMOVER).
4. Rotação: antes de gravar, se `state` atual no disco tem dados e a contagem de itens mudou, `bk.2→bk.3`, `bk.1→bk.2`, `state→bk.1`. Nunca rotaciona uma cópia vazia por cima de uma com dados.
5. `QuotaExceededError` → toast fixo "Espaço do navegador cheio — exporte um backup" com ação; `meta.ultimoSaveOk` não avança; `Backend.status().pendentes = true`.

### 4.6 `login.js` (dono: casca) — global `Login`

Depende de: `CA`, `Backend.auth`, `Backend.modo`.
- `Login.gate() → Promise<void>` — resolve quando `CA.session` existe. Sem sessão: monta em `#login-raiz`.
- `Login.mount(el)` — tela no visual do produto: marca, frase de uma linha, e:
  - modo local: faixa "Modo local — os dados ficam neste navegador. Faça backups em Configurações › Dados." e lista de usuários (`usuarios` ativos) como cartões (nome + perfil); usuário com `pinHash` pede PIN (4-6 dígitos, `CA.util.sha256`); primeiro uso: cria "Administração" (admin) e "Recepção" e entra direto como admin com dica de definir PIN.
  - modo firebase: e-mail + senha (inputs 16 px), "Esqueci a senha", erro com o que fazer (senha errada / e-mail não cadastrado / sem rede). Após autenticar, escolhe o usuário/perfil (mesma lista). Sem link "criar conta" (o dono cria no console).
- `Login.sair()` — `CA.audit('logout')`, limpa sessão, `Backend.auth.sair()` se firebase, volta ao gate.
- `Login.trocarUsuario()` — mesma lista sem deslogar do Firebase.

### 4.7 `agenda.js` (dono: agenda) — global `Agenda`

Depende de: `CA`, `Pacientes.buscar / rapido / faltas / abrirFicha`, `Financeiro.lancarDaConsulta` (via evento), `Atendimento.iniciar`.
Rotas: `#/agenda` (última visão salva), `#/agenda/dia/<data>?prof=a,b`, `#/agenda/semana/<data>?prof=a`, `#/agenda/mes/<AAAA-MM>`, `#/agenda/lista/<data>`, `#/agenda/espera`, `#/agenda/lembretes/<data>`.
- `Agenda.mount(el, params)` / `unmount()`.
- `Agenda.abrirNova({ data, hora, profId, pacId, procId, esperaId, dur }) → drawer` — drawer de criação já preenchido; foco no campo de paciente.
- `Agenda.abrirConsulta(id) → drawer` — modo leitura com ações.
- `Agenda.salvar(dados, { forcarEncaixe:false }) → { ok:true, consulta } | { ok:false, conflitos:[...] }` — valida, grava via `CA.upsert('consultas')`, historico `'criada'`/`'editada'`.
- `Agenda.conflitos({ data, hora, dur, profId, pacId, ignorarId }) → [{ tipo:'sobreposicao'|'bloqueio'|'fora_turno'|'mesmo_paciente'|'limite_encaixe', consultaId?, bloqueioId?, texto }]` — pura.
- `Agenda.mudarStatus(id, novo, { motivo, porQuem }) → Promise<{ ok, status }>` — aplica transições permitidas (`agendado→confirmado→chegou→em_atendimento→finalizado`; qualquer não-terminal → `faltou|cancelado|cancelado_clinica`; `cancelado` vira `cancelado_tarde` sozinho se `agora > inicio − janelaCancelamentoH` e `politica.cobrarTardio`); carimba `confirmadoEm/chegouEm/inicioEm/fimEm`; `historico`; `CA.audit`; emite `'consulta:status'`; se `finalizado` e procedimento com valor → `Financeiro.lancarDaConsulta(id)` e abre `Financeiro.baixa` ("Receber agora?"); `faltou`/`cancelado_tarde` com taxa → lançamento pendente com descrição "Taxa de falta". Reabrir (`finalizado→em_atendimento`, `faltou→agendado`) só admin, via menu.
- `Agenda.remarcar(id, { data, hora, profId, dur }, { confirmarProf:true }) → Promise<{ ok, desfazer() }>` — conflitos como em `salvar`; volta status para `agendado` se estava `confirmado` (histórico `'remarcada'` de→para); toast "Remarcado para … — Desfazer".
- `Agenda.proximaVaga({ profId|null, procId, aPartir:'YYYY-MM-DD', direcao:1|-1 }) → { data, hora, profId }|null` — pula para o próximo intervalo livre dentro dos turnos que caiba a duração; horizonte 180 dias.
- `Agenda.whatsapp(consultaId, chave:'confirmar'|'lembrete'|'remarcar'|'tele'|'vaga', { fone }) → { url, texto }` — `wa.me/55<digits>?text=` com o modelo de `cfg.whatsapp.modelos` (só `{nome}` 1º nome, `{prof}`, `{data}` extenso, `{hora}`, `{clinica}`, `{endereco}`, `{link}`); nunca procedimento/diagnóstico. Marca `lembreteEm` e histórico `'lembrete'` ao abrir; se o paciente não tem `consentimentos.lembretes.ativo`, mostra aviso de que a confirmação é operacional e pergunta se quer registrar o opt-in.
- `Agenda.lembretes(data) → [{ consultaId, pacId, fone, status }]` — consultas de `data` sem `confirmadoEm` e com telefone.
- `Agenda.espera` — `{ adicionar(dados), remover(id, motivo), elegiveis({ data, hora, profId }) → [...ordenados por createdAt], marcar(esperaId) (entra em "modo clique na vaga": barra amarela "Escolha um horário para <1º nome> — Esc cancela"), ofertar(esperaId, { data, hora, profId }) → url wa.me }`.
- `Agenda.bloqueios` — `{ criar(dados) → { bloqueio, atingidas:[consultaId] }, remover(id), atingidas(bloqueio) }`.
- `Agenda.notas.get(data, profId)` / `set(data, profId, texto)`.
- `Agenda.imprimirDia(data, profId)` → `CA.print.documento({ tipoDoc:'agenda' })`.

### 4.8 `pacientes.js` (dono: agenda) — global `Pacientes`

Depende de: `CA`, `Atendimento` (abre editores das abas clínicas), `Financeiro.extrato` (aba Financeiro), `Agenda.abrirNova` (botão Agendar).
Rotas: `#/pacientes`, `#/pacientes/<id>`, `#/pacientes/<id>/<aba>` com abas `resumo|consultas|evolucoes|receitas|documentos|exames|financeiro|privacidade`.
- `Pacientes.mount(el, params)` / `unmount()`.
- `Pacientes.buscar(q, { limite:8, inativos:false }) → [paciente]` — pura; casa nome (`norm`), dígitos de CPF/telefone, nascimento (`dd/mm` ou `dd/mm/aaaa`); ignora `q` com "@".
- `Pacientes.rapido({ nome, fone, nasc }) → paciente` — cadastro mínimo; avisa (toast) se já existe nome idêntico normalizado e devolve o existente se o usuário escolher.
- `Pacientes.abrirForm(id|null, { aoSalvar }) → modal` — cadastro completo; campos faltantes = aviso, não bloqueio; só `nome` obrigatório.
- `Pacientes.abrirFicha(id, aba='resumo')` — `route.go`.
- `Pacientes.inativar(id, motivo) → Promise<boolean>` — confirmar próprio; some das listas; recuperável em Config › Dados › Inativos.
- `Pacientes.faltas(id, { meses:12 }) → { faltas, tardios, total, risco:boolean }` — `risco = faltas + tardios >= 3`.
- `Pacientes.lgpd` — `{ exportar(id) → baixa JSON + abre PDF legível (tudo do paciente), registrarPedido(id, tipo, obs), compartilhamentos(id) → [...] }`.
- `Pacientes.selo(id) → html` — chip de risco/alergia para a agenda.

### 4.9 `atendimento.js` (dono: atendimento) — global `Atendimento`

Depende de: `CA` (upsert, print, ui, audit, can), `Backend.ai`, `Agenda.mudarStatus`, `Pacientes.faltas` (não), `Financeiro.baixa` (via Agenda).
Rotas: `#/atendimento/<consultaId>` (tela cheia de atendimento) e editores em modal/drawer chamados a partir da ficha.
- `Atendimento.mount(el, params)` / `unmount()` — layout 2 colunas (desktop): esquerda = histórico do paciente (últimas evoluções, alergias em destaque, problemas, medicações, exames recentes); direita = editor da evolução atual + barra de ações (Receita, Atestado, Exames, Documento, Imprimir, Finalizar). ≤ 767 px: abas Histórico/Evolução.
- `Atendimento.iniciar(consultaId) → Promise<void>` — `Agenda.mudarStatus(id,'em_atendimento')` (se ainda não) e `route.go('#/atendimento/'+id)`; recepção → toast e não abre.
- `Atendimento.finalizar(consultaId) → Promise<void>` — salva rascunho pendente como evolução (se houver texto), `Agenda.mudarStatus(id,'finalizado')`, volta para `#/agenda`.
- `Atendimento.evolucao` — `{ abrir({ pacId, consultaId, id }) → editor, salvar(dados) → evolucao (edição empurra a versão anterior para `versoes`), rascunho:{ get(chave), set(chave, texto), limpar(chave) } (autosave a cada 2 s em `clinicar.v1.pref.rascunhos`), ditar:{ iniciar(onTexto), parar(), disponivel() }, gravar:{ iniciar() → Promise, parar() → Promise<{ base64, mime, seg }>, emAndamento() }, estruturar({ tipoAtend, formato, rascunho, pacId }) → Promise<string> (monta o prompt escriba com `encounterCtx`), transcrever({ base64, mime, tipoAtend, formato, pacId }) → Promise<string>, resumoPaciente(pacId) → Promise<string> }`. Formatos `REC_FMT` reaproveitados do sistema antigo (regras de anamnese incluídas). Consentimento verbal para gravar exibido antes de iniciar (checkbox lembrado por sessão).
- `Atendimento.receita` — `{ abrir({ pacId, id, itens? }), salvar(dados) → receita, imprimir(id|rascunho), buscarMed(q) → [{ n, p, c }] (MED_DB reaproveitado), separar(itens) → { simples:[], antimicrobiano:[], controle:[] } (nunca mistura na mesma folha; salva/imprime receitas distintas), modelos:{ listar(), salvar(nome, dados), aplicar(id) } }`. Impressão: antimicrobiano 2 vias + "Validade: 10 dias"; controle 2 vias + "Validade: 30 dias" + quantidade por extenso obrigatória (bloqueia com modal se faltar); listas A/B → aviso "use a Notificação de Receita oficial" e não imprime.
- `Atendimento.atestado` — `{ abrir({ pacId, id }), gerarTexto(campos) → string, salvar(dados) → documento, imprimir(id|rascunho), modelos:{...} }`. CID desligado; ligar exige marcar "Paciente autorizou constar o diagnóstico" → grava `cidAutorizado:true`, frase de concordância no texto e `pacientes[].cidAutorizacoes`.
- `Atendimento.exames` — `{ abrir({ pacId, id }), salvar, imprimir, comuns:[...] (EXAMES_COMUNS reaproveitado) }`.
- `Atendimento.documento` — `{ abrir({ pacId, tipo:'declaracao'|'encaminhamento'|'relatorio'|'consentimento', modeloId }), preencher(texto, pacId, extras) → string (substitui `{{nome}} {{cpf}} {{data}} {{nasc}} {{idade}} {{prof}} {{clinica}}`), salvar, imprimir }`.
- `Atendimento.labs` — `{ adicionar({ pacId, nome, valor, unidade, data }), remover(id) (só admin, com lápide), svg(serie) → string }`.
- `Atendimento.imprimirEvolucao(id)`.
- `Atendimento.abrirAba(pacId, aba, containerEl)` — desenha o conteúdo das abas clínicas da ficha (chamado por `Pacientes`): listas por data desc + estado vazio + botões de novo.

### 4.10 `financeiro.js` (dono: casca) — global `Financeiro`

Depende de: `CA`, `Pacientes.buscar` (lançamento avulso).
Rotas: `#/financeiro`, `#/financeiro/caixa/<data>`, `#/financeiro/extrato?de=&ate=&prof=&forma=&status=`, `#/financeiro/repasse/<AAAA-MM>`.
- `Financeiro.mount(el, params)` / `unmount()`.
- `Financeiro.lancarDaConsulta(consultaId) → lancamento` — cria `pendente` com `valorCent` do procedimento e `convenioId` do paciente; grava `consulta.lancamentoId`; idempotente.
- `Financeiro.baixa(lancamentoId|consultaId) → modal` — forma, parcelas, desconto, data; `status:'recebido'`, `recebidoEm`.
- `Financeiro.lancar(dados) → lancamento` — avulso (receita ou despesa).
- `Financeiro.cancelar(id, motivo)`.
- `Financeiro.resumo({ de, ate, profId, forma, convenioId, status }) → { recebidoCent, pendenteCent, despesasCent, porForma:{}, porProf:{}, porProc:{}, qtd }` — pura.
- `Financeiro.caixaDia(data) → { recebimentos:[], despesas:[], totalCent }`.
- `Financeiro.repasse(profId, de, ate) → { baseCent, repasseCent, itens:[] }`.
- `Financeiro.extrato(pacId) → [lancamento]` — para a aba da ficha.

### 4.11 `painel.js` (dono: casca) — global `Painel`

Depende de: `CA`, `Agenda.mudarStatus / abrirConsulta / lembretes`, `Financeiro.resumo`, `Pacientes.abrirFicha`, `Atendimento.iniciar`, `Backend.status`.
Rota: `#/painel`.
- `Painel.mount(el, params)` / `unmount()` — atualiza a cada 30 s (cronômetros a cada 1 s) sem recarregar.
- `Painel.kpis(data) → { marcadas, confirmadas, chegaram, emAtendimento, finalizadas, faltas, cancelados, encaixes }`.
- `Painel.salaEspera(data, profId|null) → { aguardando:[], naSala:[], emAtendimento:[] }` — cada item com `esperaMin`.
- `Painel.aniversariantes({ dias:7 }) → [{ pacId, data, idade }]`.
- `Painel.alertas() → [{ tipo:'backup'|'lgpd'|'sync'|'quota', texto, acao }]`.

### 4.12 `configuracoes.js` (dono: casca) — global `Config`

Depende de: `CA`, `Backend` (backups, exportar, logo, status), `Importar.mount`, `Login.trocarUsuario`.
Rotas: `#/config/<aba>` com abas `clinica|profissionais|procedimentos|convenios|politica|whatsapp|usuarios|dados|privacidade|importar|sobre`.
- `Config.mount(el, params)` / `unmount()`.
- `Config.exportarTudo()` — `Backend.exportar()` → `CA.util.baixar('clinicar-backup-AAAA-MM-DD.json')`; `meta.ultimoExport`; `CA.audit('dados.exportar')`.
- `Config.abrirRecuperacao()` — modal com backups (data + contagens), chaves ruins (baixar/limpar), "Restaurar" com confirmação; nunca mostra nomes.
- `Config.apagarTudo()` — digita REMOVER; exporta antes obrigatoriamente.
- `Config.salvarProfissional(dados)`, `Config.salvarProcedimento(dados)`, `Config.salvarConvenio(dados)`, `Config.salvarUsuario(dados)` (PIN → `sha256`), `Config.salvarPolitica`, `Config.salvarWhatsapp`, `Config.salvarClinica` (logo → canvas 480×180 PNG/JPEG ≤ 120 KB → `Backend.logo.set`).
- `Config.avisoPrivacidade()` — imprime folha do aviso com responsável/contato.
- Aba **sobre**: versão, modo (local/firebase), estado do backend de IA (`Backend.ai.disponivel()`), texto fixo: "O Clinicar não é prontuário eletrônico certificado. Documentos valem impressos e assinados ou assinados digitalmente com certificado ICP-Brasil."

### 4.13 `importar.js` (dono: integracao) — global `Importar`

Depende de: `CA`, `Backend.exportar` (backup automático antes de aplicar).
Rota: `#/config/importar` (montado por `Config`).
- `Importar.mount(el)` — zona de arquivo (input + arrastar), etapas: 1 escolher → 2 prévia → 3 aplicar → 4 relatório.
- `Importar.ler(file) → Promise<{ origem:'antigo'|'clinicar'|'desconhecido', bruto }>`.
- `Importar.mapear(bruto, origem) → { parcial:{ <coleções> , cfgPatch, logo }, contagens:{ [col]:{ encontrados, novos, existentes, descartados } }, avisos:[string] }` — pura, sem gravar; segue a tabela 3.4.
- `Importar.aplicar(parcial, { modo:'mesclar'|'substituir' }) → Promise<{ contagens }>` — mesclar = `Backend.merge` item a item (importado só vence se `updatedAt` maior); substituir = exporta backup, confirma com REMOVER, troca as coleções importadas. Sempre via `CA.upsert` em lote (`CA.persist` uma vez ao fim — expor `CA.lote(fn)` no core que suspende o debounce).
- `Importar.relatorio(contagens, avisos) → html` — só números.

### 4.14 Fora de `src/`

- `firestore.rules` (integracao):
  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /users/{uid}/{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
      match /{document=**} { allow read, write: if false; }
    }
  }
  ```
- `functions/index.js` (integracao): Node 20, `firebase-functions/v2/https` `onCall` região `southamerica-east1`; `gemini` (`{prompt, model}`, `MAX_PROMPT` 24.000 chars, `timeoutSeconds:120`) e `geminiAudio` (`{audio, mimeType, prompt, model}`, `memory:'512MiB'`, `timeoutSeconds:300`, teto 9.500.000 chars); exige `req.auth`; token da própria conta de serviço via metadata server (`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token`, header `Metadata-Flavor: Google`); chama `https://aiplatform.googleapis.com/v1/projects/<PROJECT>/locations/<LOCATION>/publishers/google/models/<model>:generateContent` com `contents:[{role:'user', parts:[{inlineData:{mimeType, data}}, {text}]}]`; devolve `{ text }`; `HttpsError` com mensagens em português; `PROJECT` de `process.env.GCLOUD_PROJECT`; `functions/package.json` mínimo. Sem chave em lugar nenhum. Comentário de cabeçalho com os 4 passos de publicação (habilitar Vertex AI API, `firebase deploy --only functions`, colar config, testar).
- `CNAME` (integracao): uma única linha, `clinicar.exemplo.com.br` (o arquivo não aceita comentários; a explicação fica em `docs/DOMINIO.md`). O dono troca pelo domínio real.
- `docs/DOMINIO.md` (integracao): registrar domínio, DNS (A ×4 do GitHub Pages + CNAME `www`), ativar HTTPS, trocar `CNAME`, `authDomain` no Firebase Auth (domínios autorizados), prazo de propagação, como testar.
- `docs/EXPORTACAO-ANTIGO.md` (integracao): trecho ≤ 40 linhas para o sistema antigo — botão "Exportar dados" que serializa `state` (`normalize(state)`) em `{ app:'clinicar-antigo', versao:1, exportadoEm, state }`, baixa `.json` via Blob + `<a download>`, sem enviar nada; onde colar (Configurações) e como conferir o arquivo (contagens).
- `docs/PENDENTE.md` (integracao): lista da seção 2.2.

---

## 5. Especificação tela a tela

### 5.1 Agenda

**Cabeçalho da agenda** (uma linha, sticky): segmented control `Dia | Semana | Mês | Lista`; `‹ Hoje ›`; seletor de data (input date nativo; no desktop abre popover de 3 meses); chips de profissionais (cor + iniciais; clique alterna; `+` adiciona; ≥ 5 selecionados → rolagem horizontal); campo "Próxima vaga" (procedimento + profissional + setas); botões `Nova consulta`, `Lista de espera (N)`, `Lembretes`, `Bloquear`, menu `…` (Imprimir dia, Ocultar cancelados, Densidade, Legenda). Busca de consulta por nome (ícone `ti-search`) abre lista agrupada por data.

**Visão Dia** — grade vertical: coluna de horas fixa à esquerda (56 px), uma coluna por profissional selecionado (mín. 220 px; até 4 iguais em ≥ 1024 px; 2 em 768–1023; 1 em < 768 com chips e swipe). Cabeçalho da coluna: cor do profissional + nome + contador do dia. Linha de hora cheia mais escura, quartos mais claros; rótulo em horas e meias. Altura 60 px/h (compacto 48, confortável 80; lembrada). Faixa exibida = `cfg.agenda.horaIni..horaFim` expandida para caber consultas; botão "ver 24 h". Turno do profissional = fundo papel; fora do turno = `--painel`; bloqueio = hachura diagonal + rótulo do motivo + `cursor:not-allowed` (não recebe clique nem drop). Linha "agora" vermelha fina com bolinha; ao abrir, rola até agora − 1 h. Clique em célula livre → `Agenda.abrirNova` com data/hora/profissional. Dia sem consultas: "Nenhuma consulta — clique em um horário para marcar".

**Bloco de consulta**: fundo = classe de status (seção 7), faixa esquerda 4 px = cor do procedimento, linha 1 `HH:MM Nome` (iniciais em modo privacidade), linha 2 `Procedimento · Convênio` quando ≥ 30 px; ícones 14 px à direita: `ti-check` confirmado, `ti-cash` pago, `ti-message` tem observação, `ti-video` tele, `ti-alert-triangle` risco de falta, `ti-arrows-diagonal` encaixe (borda tracejada). Cancelados: riscado, 40 % de opacidade, filtro "ocultar cancelados". Sobreposições/encaixes dividem a largura (partição de intervalos) e o slot ganha hachura leve. Hover/foco: tooltip com tudo. Foco visível (outline 2 px acento). Tab percorre blocos na ordem do horário.

**Arrastar (desktop, mouse)**: sombra segue o cursor com tooltip da nova hora; snap = `slotBase`; alvo válido azul suave, inválido vermelho suave (`Agenda.conflitos` a cada movimento); soltar em conflito hard (bloqueio/sobreposição) → bloco volta + toast com motivo + botão "Encaixar" (abre drawer com checkbox já marcado); soltar em outra coluna → modal curto "Mudar para Dr(a). X?"; soltar válido → `Agenda.remarcar` + toast "Remarcado para ter 09/09 10:15 — Desfazer" (6 s). Redimensionar pela borda inferior em passos do slot. Toque: sem arraste; "Remarcar" no drawer com data/hora.

**Drawer de consulta (criar)**: campos na ordem: Paciente (busca instantânea nome/CPF/telefone/nascimento, resultados com idade + selo de risco/alergia; "Novo paciente" inline pede nome + telefone e chama `Pacientes.rapido`); Profissional; Procedimento (preenche duração e valor, mostra prévia colorida na grade); Data; Hora; Duração; Convênio (do paciente, editável); Encaixe (checkbox + motivo obrigatório; some quando `maxEncaixesHora` atingido); Observação; Link da teleconsulta (só se procedimento tele). Rodapé: texto curto da política ("Cancelamento com menos de 24 h é cobrado") + `Salvar` (Enter) / `Cancelar` (Esc). Conflito soft (mesmo paciente no dia, fora do turno) → aviso inline com "Salvar assim mesmo".

**Drawer de consulta (ver)**: cabeçalho com nome (link para ficha), telefone (link `tel:` e botão WhatsApp), procedimento, profissional, data/hora, status atual com chip; **botão principal único** que avança o fluxo (Confirmar → Chegou → Iniciar atendimento → Finalizar); menu `…`: Faltou, Cancelou (pede motivo; sistema calcula "tarde"), Cancelado pela clínica, Remarcar, Editar, Copiar link WhatsApp, Imprimir comprovante, Adicionar à lista de espera, Reabrir (admin). Recepção vê "Iniciar atendimento" desabilitado com dica. Rodapé: histórico compacto (criada por / remarcada de X para Y / lembrete enviado / status) e lançamento financeiro vinculado (valor, status, botão Receber).

**Visão Semana**: 7 colunas (segunda a domingo; dias sem turno esmaecidos) de UM profissional (selector); mesma grade, blocos e arraste (inclusive entre dias). Hoje destacado. ≤ 767 px: rolagem horizontal com colunas de 160 px e cabeçalho sticky.

**Visão Mês**: grade Dom–Sáb; cada dia mostra "12 consultas · 2 faltas · 1 bloqueio" (só contagens), pontos coloridos por profissional; férias pintam o intervalo; clique abre o Dia. Total do mês no rodapé.

**Visão Lista**: agrupada por hora com etiqueta do profissional; cartões ≥ 44 px com botão de status grande; é a visão padrão em < 768 px e a base da impressão.

**Lista de espera** (`#/agenda/espera`, também como drawer): por profissional (abas) + "Todos"; entradas ordenadas por `createdAt` com selo "urgente"; colunas: paciente (iniciais em privacidade), procedimento, dias/horário preferidos, esperando há X dias, ofertas feitas; botões `Marcar` (modo clique-na-vaga com barra amarela; ao criar a consulta pergunta "Tirar da lista?" e avisa se o paciente já tem consulta futura — oferece remarcar), `WhatsApp` (oferta), `Remover`. Ao cancelar/faltar, o slot vira bloco escuro "Vaga aberta · N na espera" (por 7 dias ou até preenchido); clique lista os elegíveis (`Agenda.espera.elegiveis`) com botão WhatsApp por pessoa e registro em `ofertas`; não oferta vaga com menos de 2 h de antecedência.

**Bloqueios**: modal "Bloquear": profissional (ou clínica), de/até (data e hora ou dia inteiro), motivo, descrição; ao salvar mostra "4 consultas neste período — remarcar?" com lista compacta e botão "Ver na agenda". Bloqueio recorrente semanal (almoço) = edição do turno em Configurações › Profissionais › Horários (link direto no menu da agenda).

**Notas do dia**: painel colapsável abaixo do cabeçalho, uma nota por profissional + geral; texto livre; salva ao sair do campo.

**WhatsApp**: modal com telefone editável (adiciona 55), chips de modelo (Confirmar / Lembrete / Remarcar / Teleconsulta / Vaga), prévia ao vivo, nota "Nada é enviado automaticamente — o WhatsApp abre com o texto pronto"; salva telefone na ficha se faltava; abre em nova aba; registra `lembreteEm`. **Painel "Lembretes de amanhã"** (`#/agenda/lembretes/<data>`): uma linha por consulta não confirmada (nome, hora, profissional, telefone), botão WhatsApp e botão "Confirmado" (`Agenda.mudarStatus(id,'confirmado')`), contador "X de Y confirmados".

**Atalhos**: `T` hoje, `N` nova consulta, `P`/`,` anterior, `.`/`→` próximo, `1`/`7` dia/semana, `M` mês, `Esc` fecha drawer/cancela modo vaga, `/` foca a busca.

**Modo privacidade**: botão no topo troca nomes por iniciais em toda a agenda, painel e listas; faixa fina "Modo privacidade ativo".

### 5.2 Pacientes

**Lista** (`#/pacientes`): busca instantânea (input com `CA.util.semAutofill`), filtros Ativos/Inativos, ordenar por nome/última consulta/cadastro; tabela no desktop (nome, nascimento/idade, telefone, convênio, última consulta, faltas, ações) e cartões em < 768 px; contador "N pacientes"; estado vazio "Cadastre o primeiro paciente" com botão; botão `Novo paciente` (modal completo).

**Ficha** (`#/pacientes/<id>/<aba>`): cabeçalho com avatar de iniciais, nome (+ nome social em destaque se houver), idade/sexo/nascimento, telefone (WhatsApp), convênio + carteira, CPF, chips de alergia (vermelho) e risco de falta; ações: Editar, Agendar (`Agenda.abrirNova({pacId})`), WhatsApp, Resumo IA (se disponível), menu `…` (Inativar, Dados do paciente (LGPD), Imprimir ficha). Abas: **Resumo** (alergias, problemas, medicações, obs, consentimentos com data/origem, última/próxima consulta), **Consultas** (histórico com status e faltas), **Evoluções / Receitas / Documentos / Exames** (desenhadas por `Atendimento.abrirAba`; recepção vê a aba com cadeado e texto "Conteúdo clínico — perfil profissional"), **Financeiro** (`Financeiro.extrato`), **Privacidade** (Exportar cópia · Corrigir dados · Pedir eliminação — com a frase "O prontuário clínico fica guardado por 20 anos por obrigação legal; o pedido fica registrado" — · Compartilhamentos · Histórico de acessos da auditoria).

**Formulário**: seções Identificação (nome*, nome social, nascimento, sexo, CPF, nome da mãe, naturalidade), Contato (telefone, e-mail, endereço), Convênio (select + carteira), Origem, Clínico (alergias, problemas, medicações, obs), Consentimentos (3 toggles com origem e data automática; desligados por padrão), tudo com inputs 16 px; CPF/telefone com máscara leve; validação inline; salvar com Ctrl+Enter.

### 5.3 Atendimento

**Tela** (`#/atendimento/<consultaId>`): topo com paciente (nome, idade, alergias em vermelho), consulta (procedimento, hora, cronômetro desde `inicioEm`) e botões `Finalizar` (primário) e `Sair sem finalizar`. Esquerda (40 %): histórico rolável — evoluções anteriores (título, data, 3 linhas + "abrir"), exames recentes com tendência, receitas recentes; direita (60 %): editor de evolução em 3 zonas — contexto (tipo de atendimento primeira/retorno/nova detectado; formato; título), captura (`Gravar consulta`, `Ditar`, rascunho) e saída revisável com aviso "A IA é apoio: revise antes de salvar". Autosave do rascunho a cada 2 s (`rascunho:<consultaId>`), restaurado ao reabrir; aviso "rascunho recuperado de <hora>". Botões de emissão (Receita, Atestado, Exames, Documento) abrem modais sem sair da tela; ao salvar, aparecem na coluna esquerda. IA indisponível → botões mostram tooltip/toast "Configure o backend para usar a IA (Configurações › Sobre)". Gravação: consentimento do paciente (checkbox), tempo decorrido, limite 25 min por bloco com aviso aos 22 min, blocos concatenados.

**Editar evolução salva**: abre com aviso "A versão anterior fica guardada"; ao salvar, `versoes[]` recebe a anterior e a lista mostra "retificado em dd/mm hh:mm (N versões)" com visualização das versões. Sem botão excluir.

**Receituário**: busca de medicamento (acento-insensível) com sugestões, itens numerados com posologia editável, quantidade + por extenso (obrigatória em controle), aviso inline de alergia (match por substring de `alergias`), tipo (Simples / Antimicrobiano / Controle especial) com troca automática ao adicionar controlado e separação automática em documentos distintos; modelos (select + Aplicar + Salvar como modelo via `CA.ui.pedirTexto`); ações `Salvar`, `Salvar e imprimir`, `Imprimir rascunho`, `Enviar texto por WhatsApp` (só se paciente tem telefone; texto sem diagnóstico).

**Atestado**: finalidade, dias, data de início, horário (comparecimento), CID desligado com toggle + checkbox de autorização; "Gerar a partir dos campos" + texto editável; modelos; imprimir 1 via.

**Exames**: chips de exames comuns, lista uma por linha, indicação clínica; imprimir.

**Documento por modelo**: tipo, modelo (select), texto com placeholders substituídos, título; consentimento informado inclui campos de procedimento/riscos e linhas para assinatura do paciente/responsável.

**Exames laboratoriais**: formulário nome (datalist) + valor + unidade + data; agrupado por analito com último valor e tendência; curva SVG ≥ 2 valores.

**Impressão**: A4, margens 20 mm, cabeçalho completo, corpo, assinatura + carimbo, rodapé legal; 2 vias rotuladas para antimicrobiano/controle; prévia no próprio modal antes de imprimir (iframe visível de 100 % de largura) e botão Imprimir/Salvar PDF (diálogo do navegador).

### 5.4 Financeiro

**Caixa do dia** (`#/financeiro/caixa/<data>`): navegação de data; cartões Recebido / Pendente / Despesas / Saldo; tabela de lançamentos do dia (hora, paciente, profissional, procedimento, forma, valor, status, ações Receber/Editar/Cancelar); botão `Lançamento avulso` (receita/despesa). Pendentes de dias anteriores em seção "Em aberto" com filtro.

**Extrato** (`#/financeiro/extrato`): filtros (período com atalhos Hoje/Semana/Mês, profissional, forma, convênio, status), tabela paginada (50), totais por forma e por profissional, exportar CSV (`CA.util.baixar`).

**Resumo do mês**: cartões recebido × pendente × despesas, barras simples por semana (SVG próprio), top procedimentos, faltas com taxa cobrada.

**Repasse** (`#/financeiro/repasse/<AAAA-MM>`): por profissional: base recebida, regra (% ou fixo), repasse, lista de itens; imprimir.

**Modal de baixa** (chamado ao finalizar): valor (editável), desconto, forma (botões grandes: Dinheiro, PIX, Débito, Crédito, Convênio), parcelas (crédito), data; `Receber` / `Deixar pendente`.

### 5.5 Painel

`#/painel`: linha de alertas (backup há > 7 dias, cota, sincronização com erro, pedidos LGPD abertos com dias restantes de 15); saudação + data; cartões do dia (marcadas, confirmadas, chegaram, em atendimento, finalizadas, faltas, encaixes); **Sala de espera** em 3 colunas (Aguardando chegada com atraso em vermelho após a hora; Na sala com cronômetro desde `chegouEm`, alerta > 20 min; Em atendimento) — cartões com botão de próximo status e, para profissional, "Chamar próximo" que abre o atendimento; profissional logado vê só a própria fila; `Próximos` (7 dias, contagem por dia); `Faltas e cancelamentos tardios do mês` (número + lista curta); `Receita do mês` (recebido × pendente, link para o extrato); `Aniversariantes` (7 dias, com botão WhatsApp só se `consentimentos.campanhas.ativo`); `Lembretes de amanhã` (X de Y confirmados, link). Atualização automática a cada 30 s. Em < 768 px, colunas viram lista com cabeçalhos.

### 5.6 Configurações

Abas laterais (desktop) / select (mobile). **Clínica**: nome, endereço, telefone, e-mail, CNPJ, logo (upload com prévia; redimensiona), rodapé dos documentos; prévia do cabeçalho de impressão. **Profissionais**: lista com cor; form: nome, conselho, número, UF, RQE, especialidade, cor (8 opções), horários por dia da semana (até 3 intervalos), slot, encaixes por hora, procedimentos atendidos e padrão, repasse, usuário vinculado, ativo. **Procedimentos**: tabela (nome, duração, valor, cor, modalidade, intervalo, ativo). **Convênios**: lista simples. **Política**: janela de cancelamento (nenhuma/24/48/72 h), cobrar cancelamento tardio, taxa de falta (valor ou %), texto curto exibido no drawer. **WhatsApp**: 5 modelos editáveis com os placeholders listados e prévia. **Usuários**: nome, perfil, profissional vinculado, PIN (definir/remover), ativo; explica que perfis limitam a interface e não substituem contas separadas. **Dados**: Exportar tudo (JSON), Importar (vai para a aba), backups automáticos (3 cópias com data e contagens, Restaurar), chaves ruins (Baixar/Limpar), pacientes inativos (Reativar), textos importados sem paciente, "Apagar tudo" (REMOVER), estado do backend (modo, último salvamento, pendências). **Privacidade**: responsável pelos dados, contato, texto do aviso (com padrão curto), Imprimir aviso, checklist de incidente (3 linhas + Exportar auditoria do período + link para a ANPD). **Sobre**: versão, modo, IA disponível ou não com instruções, declaração de não certificação, atalhos de teclado.

### 5.7 Importação

`#/config/importar`: 1) zona "Escolher arquivo .json" + texto de 1 linha sobre como exportar do sistema antigo (link para `docs/EXPORTACAO-ANTIGO.md` não aparece no produto; o texto diz "use o botão Exportar dados do sistema anterior"). 2) Prévia: origem detectada, tabela de contagens por coleção (encontrados / novos / já existem / descartados), avisos numerados (ex.: "3 consultas sem paciente viraram fichas novas", "2 atestados com CID sem autorização registrada — revise"), escolha Mesclar (padrão) / Substituir (exige REMOVER e faz backup antes). 3) Barra de progresso sem pulo. 4) Relatório final com os mesmos números e botão "Abrir a agenda". Erro de arquivo → mensagem "Arquivo não reconhecido — exporte novamente do sistema anterior".

---

## 6. Critérios de aceite (mensuráveis no navegador)

Ambiente de teste: `python3 -m http.server 88xx` em `src/`, aba anônima, dados fictícios. "Grep" = busca no código de `src/`.

| # | Critério | Como testar |
|---|---|---|
| CA-01 | Zero `alert(`, `confirm(`, `prompt(` em `src/*.js` e `index.html`. | `grep -nE "\b(alert|confirm|prompt)\(" src/*` devolve 0 linhas. |
| CA-02 | A string proibida (nome do ecossistema anterior) e nomes de concorrentes não aparecem em `src/`, `functions/`, `firestore.rules`, `CNAME`, `manifest`. | `grep -ri "medtech" src functions firestore.rules CNAME` devolve 0; grep dos 20 nomes de concorrentes dos relatórios devolve 0. |
| CA-03 | Nenhum `_mt*.js` em `src/` nem referência a ele. | `ls src | grep _mt` vazio; `grep -n "_mt" src/*` vazio. |
| CA-04 | Todos os `.js` passam no validador JavaScriptCore do BRIEF. | Rodar o comando do BRIEF em cada arquivo → "OK". |
| CA-05 | Modo local funciona sem rede e sem conta: com `config.js` vazio, a tela de login mostra "Modo local" e entra sem senha. | Abrir com Wi-Fi desligado (fontes/ícones com fallback) → login local → agenda visível. |
| CA-06 | Voltar do navegador funciona e o F5 mantém o contexto. | Ir `#/agenda` → `#/pacientes/<id>/exames` → F5 mostra a mesma aba; Voltar retorna à agenda. |
| CA-07 | Sem scroll horizontal em 360, 768 e 1440 px em todas as telas (`document.documentElement.scrollWidth <= innerWidth`). | Emular os 3 tamanhos e visitar as 8 rotas principais. |
| CA-08 | Desktop 1440 usa a largura: agenda Dia mostra 4 profissionais em colunas ≥ 220 px sem rolagem horizontal. | Criar 4 profissionais, selecionar os 4, medir `getBoundingClientRect().width` das colunas. |
| CA-09 | Em 360 px, a agenda Dia mostra 1 profissional com chips e todos os alvos de toque ≥ 44 px. | Inspecionar botões de status e blocos: `offsetHeight >= 44`. |
| CA-10 | Nenhum `<input>`/`<select>`/`<textarea>` com `font-size` < 16 px. | `[...document.querySelectorAll('input,select,textarea')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=16)`. |
| CA-11 | Zero emoji como ícone: nenhum caractere das faixas emoji fora de conteúdo de usuário. | `grep -P "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" src/*.js src/index.html` devolve 0. |
| CA-12 | Contraste AA (≥ 4,5:1) em texto de todos os chips de status, botões e toasts. | Medir com script de contraste (composição alpha) nas 9 classes `.st-*`, `.btn-*`, `.toast-*`. |
| CA-13 | Clique em célula livre abre o drawer com data, hora e profissional preenchidos e foco no campo de paciente. | Clicar às 10:00 da coluna B → drawer com `10:00`, prof B, `document.activeElement` = busca. |
| CA-14 | Cadastro rápido de dentro do drawer cria paciente com nome + telefone e a consulta fica vinculada (`pacId`). | Criar "Paciente Teste" → salvar → `CA.get('consultas', id).pacId` existe. |
| CA-15 | Status avança em um clique na ordem agendado → confirmado → chegou → em_atendimento → finalizado, carimbando `confirmadoEm/chegouEm/inicioEm/fimEm`. | Clicar 4× no botão principal; conferir os 4 timestamps e `historico.length === 5`. |
| CA-16 | Cancelar dentro da janela grava `cancelado`; fora (ex.: janela 24 h, consulta em 2 h) grava `cancelado_tarde` e cria lançamento pendente "Taxa de falta" quando há taxa. | Configurar janela 24 h e taxa R$ 50; cancelar consulta de daqui a 2 h → status `cancelado_tarde`, lançamento pendente de 5000 centavos. |
| CA-17 | Arrastar bloco para célula livre remarca, mostra toast com "Desfazer", e Desfazer devolve data/hora originais; status `confirmado` volta a `agendado`. | Arrastar; conferir `data/hora`; clicar Desfazer; conferir retorno e `historico` com `remarcada`. |
| CA-18 | Soltar sobre bloqueio ou outra consulta é rejeitado (bloco volta) com toast explicando o motivo e opção "Encaixar". | Criar bloqueio 12–13 h; arrastar para 12:15 → consulta inalterada + toast. |
| CA-19 | Encaixe exige checkbox + motivo; o slot mostra os dois blocos lado a lado; limite por hora respeitado (opção some). | `maxEncaixesHora=1`: 1º encaixe ok; 2º na mesma hora sem a opção. |
| CA-20 | Bloqueio com consultas dentro lista a contagem de atingidas ao salvar. | 3 consultas na tarde; bloquear a tarde → modal "3 consultas neste período". |
| CA-21 | Lista de espera: `Marcar` entra em modo clique-na-vaga (barra amarela), cria a consulta com `origem:'espera'` e marca a entrada como `marcado`. | Fluxo completo; conferir `espera[].status`. |
| CA-22 | Cancelar/faltar com alguém na espera elegível mostra "Vaga aberta · N na espera" no slot e o clique lista elegíveis com botão WhatsApp. | Espera com `diasPref` do dia; cancelar → bloco escuro com N ≥ 1. |
| CA-23 | Link WhatsApp é `https://wa.me/55<dígitos>?text=` e o texto NÃO contém procedimento nem diagnóstico; abrir registra `lembreteEm`. | `Agenda.whatsapp(id,'confirmar').texto` sem o nome do procedimento; `lembreteEm` preenchido. |
| CA-24 | Painel "Lembretes de amanhã" lista só consultas não confirmadas com telefone e o botão "Confirmado" muda o status. | 3 consultas amanhã (1 confirmada, 1 sem telefone) → lista com 1. |
| CA-25 | Visão Mês mostra só contagens por dia (nenhum bloco de consulta) e clique abre o Dia. | `document.querySelectorAll('.ag-bloco').length === 0` no mês; clique → rota `#/agenda/dia/<data>`. |
| CA-26 | Busca de paciente ignora valores com "@" e acha por nome sem acento, CPF parcial e telefone parcial. | Digitar `joao` acha "João"; `"a@b.c"` devolve lista completa (não vazia). |
| CA-27 | Recepção não abre conteúdo clínico: rota `#/atendimento/<id>` redireciona com toast e as abas clínicas mostram cadeado. | Entrar como Recepção e tentar. |
| CA-28 | Editar evolução preserva a anterior em `versoes[]` e a lista mostra "retificado em"; não há botão excluir em evoluções/receitas/documentos. | Editar 1 evolução → `versoes.length === 1`; `grep -n "excluir"` na aba clínica só em labs (admin). |
| CA-29 | Rascunho da evolução sobrevive a F5 (autosave ≤ 2 s) e é restaurado com aviso. | Digitar, esperar 2 s, F5 → texto de volta. |
| CA-30 | Impressão: documento A4 com nome + conselho/UF, RQE, nome + CPF do paciente, data de emissão, endereço/telefone da clínica, linha de assinatura e rodapé legal; receita antimicrobiana e controlada imprimem 2 páginas rotuladas. | Prévia no iframe: contar elementos do cabeçalho; `@page` count = 2 nas 2 vias. |
| CA-31 | Atestado só imprime CID com o checkbox de autorização marcado; ao marcar, `documentos[].cidAutorizado=true` e `pacientes[].cidAutorizacoes` ganha 1 item. | Fluxo com e sem checkbox. |
| CA-32 | Controle especial sem quantidade por extenso não salva (modal explica); antimicrobiano + controlado no mesmo receituário viram 2 receitas separadas. | Adicionar amoxicilina + clonazepam → 2 documentos. |
| CA-33 | Finalizar consulta com procedimento de valor cria lançamento pendente e abre o modal de baixa; "Receber" com PIX marca `recebido` e o caixa do dia soma o valor. | Finalizar; `Financeiro.caixaDia(hoje).totalCent` = valor. |
| CA-34 | Dinheiro em centavos e formatado pt-BR em toda a interface (`R$ 1.234,56`); datas `dd/mm/aaaa`. | Inspecionar 5 telas; `grep -n "toFixed(2)" src/*` deve ser 0 fora de `CA.fmt`. |
| CA-35 | Backup rotativo: após 4 saves com contagem diferente existem `clinicar.v1.bk.1..3` com dados; nenhum backup vazio sobrescreve um com dados. | Inspecionar `localStorage` keys e contagens. |
| CA-36 | Trava do 1º save: com dados gravados, forçar `CA.state.pacientes=[]; CA.state.consultas=[]; CA.persist()` numa sessão nova NÃO grava e abre a recuperação. | Conferir que `clinicar.v1.state` mantém as contagens. |
| CA-37 | JSON corrompido em `clinicar.v1.state` é preservado como `clinicar.v1.ruim.<ts>`, o backup mais recente é carregado e o painel de recuperação abre. | `localStorage.setItem('clinicar.v1.state','{x')` + F5. |
| CA-38 | Exportar tudo baixa `clinicar-backup-<data>.json` com `{app:'clinicar',versao:1,state}` e reimportar em outro perfil anônimo reproduz as mesmas contagens. | Contar itens antes/depois. |
| CA-39 | Importar a exportação do sistema antigo (fixture fictícia com `pac` solto, `atendido`, receita só-texto, `especial`, `docs[]`) mostra a prévia só com contagens e aplica o mapa 3.4 (status `finalizado`, `tipo:'controle'`, itens parseados, pacientes criados de consultas soltas). | Fixture em `docs/fixtures/antigo-ficticio.json` (dados inventados) → conferir campos. |
| CA-40 | Merge item a item: `Backend.merge(remoto, local)` — item mais novo vence, lápide ≥ `updatedAt` remove, `cfg` pelo `updatedAt`, empate fica com o local. | 6 asserts no console com objetos sintéticos. |
| CA-41 | Sincronização firebase nunca grava o estado inteiro: `grep -n "setDoc" src/backend.js` só em `meta/*` e por item; nenhum `setDoc` com `state` completo; nenhum fallback após transação falha. | Revisão de código + teste com `config.js` fictício apontando para projeto inexistente → toast de erro, dados locais intactos. |
| CA-42 | IA sem backend: botões Gravar/Estruturar/Resumo mostram "Configure o backend" e não lançam erro no console. | Console sem `Uncaught`. |
| CA-43 | Esc fecha modal e drawer; Tab fica preso dentro do modal; foco volta ao botão que abriu; foco visível (outline) em todos os controles. | Navegar só com teclado pelo drawer de consulta. |
| CA-44 | Só um modal e só um drawer existem no DOM a qualquer momento (duplo clique não empilha). | Duplo clique em "Nova consulta" → `querySelectorAll('.modal, .drawer').length <= 2`. |
| CA-45 | Estados vazios com ação em agenda (dia), pacientes, espera, financeiro e painel; carregando sem pulo de layout (esqueleto com a altura final). | Visitar com estado zerado; medir CLS visualmente/`PerformanceObserver('layout-shift')` < 0,1. |
| CA-46 | Atalhos `T`, `N`, `Esc`, `→/←` funcionam na agenda e não disparam dentro de inputs. | Testar com foco no corpo e dentro de um input. |
| CA-47 | Modo privacidade troca nomes por iniciais na agenda, painel e listas, com faixa visível. | Ativar e inspecionar textos. |
| CA-48 | Auditoria registra abertura de ficha, impressão, exportação e mudanças de status com usuário e horário; visível na aba Privacidade. | Fazer as 4 ações → 4 entradas. |
| CA-49 | Página LGPD do paciente: Exportar cópia baixa JSON e abre PDF; "Pedir eliminação" registra em `lgpd.pedidos` com prazo de 15 dias no painel. | Fluxo completo. |
| CA-50 | `firestore.rules` nega tudo fora de `users/{uid}/**` e não contém `if true`. | `grep -n "if true" firestore.rules` vazio. |

---

## 7. Design

### 7.1 Tokens (`:root` em `styles.css`)

```
--acento:#2B5CE6; --acento-hover:#244FC7; --acento-fraco:#E3EAFD; --acento-texto:#1E43B8;
--tinta:#23272E; --tinta-2:#4B515A; --tinta-3:#6B7280;
--papel:#FAFAF8; --painel:#F1F1EC; --linha:#E8E8E2; --linha-forte:#D6D6CF; --branco:#FFFFFF;
--ok:#1E7F4F; --ok-fraco:#DDF5E6; --aviso:#8A5A00; --aviso-fraco:#FFF1D6; --erro:#A32D24; --erro-fraco:#FDE3E1;
--sombra-1:0 1px 2px rgba(35,39,46,.06); --sombra-2:0 6px 20px rgba(35,39,46,.10); --sombra-3:0 16px 48px rgba(35,39,46,.16);
--raio-1:6px; --raio-2:10px; --raio-3:14px;
--fonte:'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
--t-12:12px; --t-13:13px; --t-14:14px; --t-16:16px; --t-20:20px; --t-24:24px; --t-30:30px;
--e-1:4px; --e-2:8px; --e-3:12px; --e-4:16px; --e-5:24px; --e-6:32px; --e-7:48px;
--hora-px:60px; (48 compacto / 80 confortável — atributo data-densidade no body)
--nav-w:64px; --topo-h:52px; --drawer-w:420px;
```
Uma cor de acento (azul clínico). Cores semânticas só para status/feedback. Sem gradientes. `body { background:var(--papel); color:var(--tinta); font:var(--t-14)/1.45 var(--fonte); font-feature-settings:'tnum' 1 }` para horários e dinheiro.

**Cores de identificação de profissional** (8, usadas só em faixa/chip, nunca como fundo de texto): `#2B5CE6 #0E8A6C #B3541E #7C3AED #C2185B #0F766E #B45309 #4B5563`.

**Chips de status** (fundo / texto / ícone Tabler) — todas ≥ 4,5:1:

| status | classe | fundo | texto | ícone |
|---|---|---|---|---|
| Agendado | `.st-agendado` | `#EEF0F3` | `#3B4250` | `ti-calendar` |
| Confirmado | `.st-confirmado` | `#E3EAFD` | `#1E43B8` | `ti-check` |
| Chegou | `.st-chegou` | `#FFF1D6` | `#8A5A00` | `ti-door-enter` |
| Em atendimento | `.st-em_atendimento` | `#DDF5E6` | `#14663A` | `ti-stethoscope` |
| Finalizado | `.st-finalizado` | `#D5E8DB` | `#0F4D2B` | `ti-circle-check` |
| Faltou | `.st-faltou` | `#FDE3E1` | `#A32D24` | `ti-user-off` |
| Cancelado | `.st-cancelado` | `#F1F1EC` | `#6B7280` (riscado) | `ti-x` |
| Cancelado tarde | `.st-cancelado_tarde` | `#FDE3E1` | `#A32D24` (riscado) | `ti-clock-x` |
| Cancelado pela clínica | `.st-cancelado_clinica` | `#F1F1EC` | `#6B7280` (riscado) | `ti-building-off` |

Encaixe = borda tracejada 1,5 px `--tinta-3` sobre qualquer status. Cor nunca é o único sinal: ícone + rótulo (tooltip/legenda).

### 7.2 Grade de espaçamento e tipografia

Base 4 px; componentes em múltiplos de 8. Escala: título de tela 24/600, título de seção 20/600, subtítulo 16/600, corpo 14/400, rótulo 13/500, ajuda 12/400, KPI 30/600 tnum. Altura de linha 1,45 (corpo) e 1,2 (títulos). Largura máxima de texto corrido 72 ch; telas de trabalho (agenda, tabelas) usam 100 % da largura.

### 7.3 Componentes

- **Botão** `.btn` 40 px de altura (44 em < 768), padding 0 16, raio `--raio-2`, 14/500, ícone 18 px à esquerda; variantes `.btn-primario` (fundo acento, texto branco), `.btn-neutro` (borda `--linha-forte`, fundo branco), `.btn-perigo` (fundo `--erro`, texto branco), `.btn-fantasma` (sem borda), `.btn-icone` (40×40). Foco: `outline:2px solid var(--acento); outline-offset:2px`. Desabilitado 50 % com tooltip do motivo.
- **Input/Select/Textarea** `.input` 40 px (44 mobile), 16 px de fonte sempre, borda `--linha-forte`, raio `--raio-1`, foco borda acento + anel `--acento-fraco`; rótulo 13/500 acima; ajuda/erro 12 abaixo (erro em `--erro` com ícone `ti-alert-circle`). Máscaras leves em CPF/telefone/dinheiro.
- **Modal** `.modal` centrado, largura 520 (largo 760), raio `--raio-3`, sombra 3, título 20, corpo rolável, rodapé com botões à direita (primário por último); scrim `rgba(35,39,46,.45)`; ≤ 767 px vira folha inferior com alça.
- **Drawer** `.drawer` à direita, `--drawer-w`, altura total, cabeçalho fixo, corpo rolável, rodapé fixo; ≤ 767 px folha inferior 92 vh.
- **Toast** `.toast` canto inferior direito (centro em mobile), 14/500, ícone por tipo, ação como link; empilha até 3; `role="status"`; `fixo` tem botão fechar.
- **Tabela** `.tabela` cabeçalho sticky 13/500 `--tinta-2`, linhas 44 px, zebra `--painel`, ordenação por clique, `overflow-x:auto` no contêiner; em < 768 vira cartões via `data-rotulo`.
- **Chip** `.chip` 24 px, 12/500, raio 999, ícone 14; status usam as classes acima; convênio/profissional usam `--painel` com ponto colorido.
- **Cartão** `.card` fundo branco, borda `--linha`, raio `--raio-2`, padding 16; KPI = número 30 + rótulo 13.
- **Vazio** `.vazio` ícone 40 px `--tinta-3`, título 16/600, texto 14, botão primário.
- **Esqueleto** `.skeleton` blocos `--painel` com brilho sutil, mesma altura do conteúdo final.
- **Grade da agenda**: `.ag-grade` grid `56px repeat(n, minmax(220px,1fr))`; `.ag-turno` fundo `--papel`; fora do turno `--painel`; `.ag-bloqueio` `repeating-linear-gradient(135deg, transparent 0 6px, rgba(35,39,46,.06) 6px 8px)`; `.ag-agora` linha 2 px `#D92D20` com bolinha 8 px; `.ag-bloco` raio 6, padding 4 8, sombra 1, faixa esquerda 4 px, `overflow:hidden`, texto com ellipsis; `.is-arrastando` opacidade .7 + sombra 2; `.is-valido` fundo `--acento-fraco`; `.is-invalido` fundo `--erro-fraco`; `.ag-vaga-aberta` fundo `--tinta-2` texto branco.

### 7.4 Comportamento por largura

| | 360 px | 768 px | 1440 px |
|---|---|---|---|
| Navegação | barra inferior fixa 56 px, 5 ícones com rótulo 11 px, safe-area | barra inferior | barra lateral 64 px com rótulos |
| Agenda | Lista como padrão; Dia com 1 profissional (chips + swipe), 72 px/h; sem arraste; ações no drawer (folha inferior) | Dia com 2 colunas; arraste ativo com mouse; drawer lateral 380 px | Dia com até 4 colunas ≥ 220 px; drawer 420 px; grade usa 100 % da largura |
| Tabelas | cartões | tabela com rolagem interna | tabela completa |
| Modais | folha inferior | centrado 520 | centrado 520/760 |
| Atendimento | abas Histórico / Evolução | 2 colunas 40/60 | 2 colunas 40/60 com histórico sticky |
| Painel | cartões em 1 coluna; sala de espera em lista | 2 colunas | 3 colunas |
| Tipografia | idem (nunca reduz abaixo de 14 no corpo; inputs 16) | idem | idem |

Sem scroll horizontal do body em nenhuma largura; tudo que for largo rola dentro do próprio contêiner. Alvo de toque ≥ 44 px em < 768. `prefers-reduced-motion` desliga transições. Impressão: `@media print` esconde `#nav #topo #drawer-raiz #toast-raiz` e mostra só o documento.
