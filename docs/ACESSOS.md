# Contas individuais e recepção — setembro de 2026

O login Firebase identifica uma pessoa. Não existe seleção de outro usuário depois de entrar.
O administrador inicial é a conta existente `matheusparente1@gmail.com`; a função `acessar`
confere o UID dessa conta no Firebase Auth e fixa o responsável em `sistema/acesso`.
Nenhuma outra conta recebe acesso automaticamente. Os antigos perfis em `usuarios` não
concedem permissões na nuvem, e os registros existentes não são apagados.

Em **Ajustes › Usuários › Liberar acesso**, o administrador informa nome, e-mail e função.
O colaborador define a senha usando **Esqueci a senha**. O aplicativo não revela senhas
nem fornece links de recuperação ao administrador.

| Função | Acesso |
|---|---|
| Administrador | Equipe, ajustes, agenda, prontuário e financeiro |
| Recepção | Cadastro, agenda, chegada e financeiro; sem prontuário |
| Profissional | Agenda e prontuário; sem ajustes e financeiro |

Cada profissional de saúde precisa estar vinculado a um profissional ativo da agenda.
A revogação é consultada pelas regras em cada operação; a sessão aberta também acompanha
alterações no documento de acesso e fecha as telas protegidas quando a função muda.

## Preservação e sincronização

A clínica continua usando `users/{uid-do-administrador}`. As permissões ficam em
`acessos/{uid-da-pessoa}`, gravadas somente pelo servidor. `pacientes` guarda a ficha
completa; `pacientesCadastro` contém apenas os campos cadastrais permitidos à recepção.
`salvarCadastro` atualiza as duas versões na mesma transação e preserva os campos clínicos
quando quem salva é da recepção. Carimbos `updatedAt` continuam resolvendo conflitos. A cobrança ao finalizar ou registrar falta é criada no servidor, de forma idempotente, sem liberar o financeiro ao profissional.
No primeiro acesso do administrador, o servidor prepara as projeções cadastrais das fichas
anteriores sem modificar os documentos originais. Isso não imprime dados de pacientes.

O modo local continua disponível quando não existe configuração Firebase e começa somente
com o administrador. Perfis locais são controles deste dispositivo; não são contas da nuvem.
Se a configuração Firebase existe mas o servidor falha, o app não libera um modo local alternativo.

## Fluxo rápido

- Na consulta: **Paciente chegou** ou **Iniciar atendimento**, sem confirmação intermediária obrigatória.
- No cadastro da consulta: **Salvar e colocar na espera** ou, para quem atende, **Salvar e atender**.
- O paciente pode ser cadastrado no próprio formulário da consulta, sem sair da agenda.
- Consultas canceladas, com falta ou finalizadas não iniciam atendimento por esse atalho.
- A recepção não inicia nem finaliza atendimentos clínicos.

## Publicação

1. Validar em emuladores com `demo-clinicar` (ver `tests/README.md`).
2. Publicar as funções `acessar`, `gerenciarAcesso`, `salvarCadastro`, `registrarCobranca`, `gemini` e `geminiAudio`.
3. Publicar o frontend e as regras de acesso no mesmo ciclo de atualização.
4. Entrar novamente com a conta do administrador; só então liberar a equipe.

Não voltar às regras antigas para contornar um problema: elas tratavam conta como clínica,
e não oferecem as permissões individuais. O retorno de versão exige avaliar frontend,
funções e regras juntos.
