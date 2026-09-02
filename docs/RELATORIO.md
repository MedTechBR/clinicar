# Clinicar 1.0 — relatório de entrega

02/09/2026. Aplicativo próprio, sem vínculo com o ecossistema anterior.

## Veredito honesto

**Não passou pelo crivo completo que combinamos.** A auditoria previa três rodadas com dois
auditores independentes. A rodada 1 rodou inteira; as rodadas 2 e 3 morreram por limite de sessão
e, na retomada, o orquestrador travou. **Eu fechei o restante manualmente** e verifiquei no
navegador, mas isso é uma auditoria a menos do que o combinado.

O que a rodada 1 encontrou e o que aconteceu com cada achado:

| Bloqueador | Origem | Situação |
|---|---|---|
| Vazamento de dados entre contas no cache local | segurança | corrigido (cache carimbado com o dono) |
| Rascunhos de evolução (PHI) na única chave não limpa no logout | segurança | corrigido (chave própria, limpa ao sair) |
| `javascript:` aceito no link da teleconsulta (XSS) | segurança | corrigido (`urlSegura` na gravação e na exibição) |
| Toast cobria os botões do painel de consulta | funcional | corrigido pelo corretor da rodada 1 |
| Prévia de impressão cortava ~215 px por linha | funcional | corrigido pelo corretor da rodada 1 |
| Estado vazio da agenda escondido atrás da barra | funcional | corrigido pelo corretor da rodada 1 |
| Nomes de profissionais colapsando para "Dr."/"Dra." | funcional | corrigido pelo corretor da rodada 1 |
| Alvos de toque abaixo de 44 px em 360 px | funcional | corrigido e remedido: zero |
| Tabelas de Ajustes não atualizavam após salvar | funcional | corrigido pelo corretor da rodada 1 |

## Medido por mim, no navegador, na versão entregue

| Item | 360 px | 1440 px |
|---|---|---|
| Falhas de contraste AA | 0 | 0 |
| Alvos abaixo de 44 px | 0 | só o bloco da agenda* |
| Inputs abaixo de 16 px | 0 | 0 |
| Emoji como ícone | 0 | 0 |
| Scroll horizontal | não | não |
| Erros no console | 0 | 0 |

\* A altura do bloco **é** a duração da consulta na grade de horários. Esticar para 44 px
quebraria a leitura do tempo. No celular, todo controle real tem 44 px.

Fluxo testado do zero, por clique e por estado: entrar → cadastrar profissional e paciente →
marcar consulta → aparecer na agenda → mudar status → persistir. Backup rotativo confirmado
(`clinicar.v1.bk.1..3`).

## Identidade visual

Trocada a paleta genérica (azul + cinza, que dá cara de template) por identidade própria:
verde profundo como acento, coral para o "agora", papel quente e tinta com viés verde.
Tipografia com Bricolage Grotesque no display e Inter nos dados. A cor tem função — cada
profissional colore sua coluna e seus blocos, e os sete status têm cores distinguíveis de
relance. A barra lateral virou tinta escura, o que separa aplicativo de site.

## O que NÃO está pronto

`docs/PENDENTE.md` lista 30 itens. Os que mais pesam:

1. **O backend nunca rodou.** As regras do Firestore, a função de IA e o adaptador de nuvem
   foram escritos e revisados, mas jamais executados contra um projeto real — a regra proibia os
   agentes de criar um. Enquanto isso, o app roda em modo local, que é completo.
2. **IA depende do backend.** Gravar consulta, estruturar evolução e resumo do paciente mostram
   "Configure o backend" até a função estar publicada.
3. **Sem anexo de arquivo no prontuário** (exige Storage) e **sem teleconsulta com vídeo dentro
   do produto** (exige sinalização e TURN).
4. **Multiusuário não é segurança forte:** os perfis limitam a interface; no Firebase é uma conta
   por clínica.

## Para ligar a nuvem — só você pode fazer

1. Criar o projeto no Firebase (Auth por e-mail/senha + Firestore).
2. Colar a config web em `src/config.js` (é pública por design).
3. `firebase deploy --only firestore:rules,functions`.

Agentes não criam projeto, não mexem em regras publicadas nem em credenciais.

## A única coisa mais importante a seguir

Publicar o backend e rodar o app inteiro contra ele com dados fictícios. É a única parte do
sistema que ninguém exercitou, e é onde moram os erros que só aparecem em execução real.
