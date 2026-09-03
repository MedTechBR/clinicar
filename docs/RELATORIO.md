# Clinicar 1.0 — relatório de entrega

02/09/2026. Sistema de clínica em site próprio, sem nenhum vínculo com o ecossistema anterior.

## Veredito

**NÃO aprovado.** Três rodadas de auditoria (dois auditores independentes por rodada: funcional e
segurança). A segurança passou na rodada 3; a parte funcional chegou a 8,5 mas **ficou com 3
bloqueadores abertos**, todos de acabamento visual/instrução — nenhum de perda de dados, nenhum de
vazamento. O app está utilizável em modo local; o que falta é fechar esses 3 itens e reauditar.

| Rodada | Funcional | Achados | Segurança | Achados |
|---|---|---|---|---|
| 1 | 6,5 — reprovado | 6 | 7,0 — reprovado | 3 |
| 2 | 6,5 — reprovado | 5 | 8,0 — reprovado | 1 |
| 3 | **8,5 — reprovado** | **3** | **9,0 — aprovado** | 0 |

A nota funcional subiu 2 pontos e os achados caíram pela metade a cada rodada; os que sobraram são
os menores da série, mas a régua do brief é objetiva (44 px, sem colisão de texto) e eles a violam.

## O que foi construído

Aplicativo próprio em HTML/CSS/JS puro, sem framework e sem build, na raiz do repositório:

- **Agenda** — visões dia (uma coluna por profissional), semana, mês e lista; arrastar para
  remarcar com validação durante o arraste e Desfazer; encaixe com motivo e limite por hora;
  bloqueios e férias com as consultas atingidas; lista de espera com "marcar na vaga"; sugestão
  "Vaga aberta" ao cancelar/faltar; WhatsApp por `wa.me` com modelos (nunca procedimento nem
  diagnóstico no texto); painel de lembretes de amanhã; impressão do dia; modo privacidade.
- **Pacientes** — cadastro completo, busca instantânea blindada contra o autofill do navegador,
  ficha com abas, selo de risco por faltas, inativar (nunca apagar), aba LGPD com exportação,
  correção e pedido de eliminação com prazo.
- **Atendimento** — evolução livre/SOAP/anamnese com rascunho autosalvo e versão anterior
  preservada; receituário com banco de medicamentos, separação automática de antimicrobiano e
  controlado, 2 vias e validade; atestado com CID desligado por padrão e autorização registrada;
  pedido de exames; documentos por modelo; exames com curva; impressão A4 limpa.
- **Financeiro** — lançamento ao finalizar a consulta, baixa com forma de pagamento, despesas,
  caixa do dia, extrato filtrável com CSV, resumo do mês e repasse por profissional.
- **Painel** — sala de espera com cronômetro e atraso, contadores do dia, próximos 7 dias, faltas,
  receita do mês, aniversariantes, alerta de backup e pedidos LGPD.
- **Ajustes** — clínica, profissionais, procedimentos, convênios, política de cancelamento,
  modelos de WhatsApp, usuários com PIN, dados (exportar/importar/backups/recuperação),
  privacidade e sobre.
- **Importar** — lê a exportação do sistema antigo e o backup do próprio Clinicar, com prévia só de
  contagens (nunca nomes), mesclar ou substituir.
- **Plataforma** — rota por hash (Voltar e F5 funcionam), backend com dois adaptadores atrás da
  mesma interface, merge item a item com lápides, blindagem do localStorage (backup rotativo,
  trava no primeiro save, chave ruim preservada, painel de recuperação), login próprio, PWA.

## Bloqueadores ainda abertos (3)

1. **Colisão de texto no cabeçalho de Pacientes em 360 px.** O título "Pacientes" transborda 17 px
   por baixo do contador "7 pacientes" e o cabeçalho lê "Pacientes̶acientes". É a única ocorrência
   em 14 rotas × 3 larguras. Correção: `styles.css` linha 103, `.tela-cabeca h1` para
   `flex:1 1 auto; min-width:fit-content` (o `flex-wrap` já existente quebra o contador para a
   linha de baixo).
2. **Alvo de toque de 32 px no toast, em celular.** `.toast-acao` ("Desfazer") e `.toast-x` têm
   32 px onde a régua exige 44 px abaixo de 768 px. Agrava porque "Desfazer" é o único caminho de
   desfazer uma remarcação e some sozinho em segundos. Correção: `styles.css`, dentro da media
   query de ≤767 px, `min-height:44px` na ação e 44×44 no fechar.
3. **Instrução aponta para arquivo que não existe.** Ajustes › Sobre manda colar a configuração em
   `src/config.js`, mas os arquivos ficam na raiz. Quem seguir a instrução não liga o backend.
   Corrigir em `configuracoes.js:651`, `functions/index.js:6` e `:15` e `backend.js:4`.

Nenhum dos três derruba função nem perde dado — são 30 minutos de trabalho e uma reauditoria.

## O que ficou pendente

`docs/PENDENTE.md` lista 30 itens. Os que mais pesam:

1. **O backend nunca rodou.** `firestore.rules`, `functions/index.js` e o adaptador de nuvem foram
   escritos, validados por sintaxe e revisados, mas jamais executados contra um projeto real —
   agentes não podem criar projeto Firebase. É o maior risco não medido do produto.
2. **IA depende do backend.** Gravar consulta, estruturar evolução e resumo do paciente mostram
   "Configure o backend" até a função estar publicada. Sem chave no cliente, por decisão.
3. **Sem anexo de arquivo no prontuário** (exige Storage) e **sem teleconsulta com vídeo** (exige
   sinalização e TURN).
4. **Perfis não são segurança forte.** Recepção/profissional/administrador limitam a interface; no
   Firebase é uma conta por clínica.
5. Sem faturamento TISS, sem agendamento online pelo paciente, sem sincronia com Google/Apple
   Calendar, sem uso offline no modo nuvem.

## Decisões de arquitetura

- **Aplicativo totalmente separado.** Marca, código e dados próprios; a palavra do ecossistema
  anterior não aparece em nenhum arquivo, nem em meta tag.
- **`backend.js` com dois adaptadores atrás da mesma interface.** `local` (padrão, localStorage,
  100% usável sem conta) e `firebase` (só liga quando a config estiver preenchida). Nenhum ponto do
  app fala com o banco direto.
- **Nunca gravar o estado inteiro.** Toda escrita passa por merge item a item com lápides e
  `updatedAt` — a falha que já apagou dados em outro app do dono não se repete aqui.
- **Login próprio** (e-mail/senha na nuvem, usuário + PIN no modo local), no visual do produto.
- **Migração por arquivo, sem acesso cruzado.** O app novo não lê o banco do antigo: importa o JSON
  exportado por ele (`docs/EXPORTACAO-ANTIGO.md` traz o trecho a colar no sistema antigo).
- **`firestore.rules` e a função de IA prontos no repo**, para o dono publicar — nenhum agente
  tocou em projeto, regra publicada, IAM ou credencial.
- **Site próprio** com `CNAME` de exemplo e o passo a passo em `docs/DOMINIO.md`.

## Para ligar a nuvem — só você pode fazer

1. Criar o projeto no Firebase e ativar **Autenticação por e-mail/senha** e **Firestore**
   (região `southamerica-east1`).
2. Colar a configuração web do projeto em **`config.js`, na raiz** (é pública por design). Enquanto
   estiver vazia, o app segue em modo local.
3. `firebase deploy --only firestore:rules,functions` (o cabeçalho de `functions/index.js` tem os
   passos; requer plano Blaze e a Vertex AI habilitada).
4. Adicionar o domínio do app aos domínios autorizados do Auth.

## Como rodar localmente

```
cd ~/Documents/Claude/clinicar && python3 -m http.server 8811
```

Abrir `http://localhost:8811/`. Entrar como Administração (modo local, sem conta). Para testar sem
inventar dados, importar `docs/fixtures/antigo-ficticio.json` em Ajustes › Importar.

## A única coisa mais importante a fazer a seguir

**Corrigir os 3 bloqueadores e rodar uma quarta rodada de auditoria funcional** — são correções de
CSS e de texto, medidas e localizadas linha a linha acima. Sem isso, o produto continua com o
carimbo de não aprovado, e o item que realmente assusta (o backend que nunca rodou) fica escondido
atrás de três defeitos pequenos que qualquer um consegue fechar hoje.
