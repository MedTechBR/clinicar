# Validação da versão 1.1.0 — 09/09/2026

Testes executados em `demo-clinicar`, com Auth, Firestore e Functions emulados,
e contextos novos do Playwright. Nenhum cadastro de teste foi criado em produção.

- **32 verificações de regras:** conta sem delegação, usuário anônimo, acesso cruzado
  entre clínicas, elevação de privilégios, leitura clínica pela recepção, financeiro
  pelo profissional, escrita de auditoria, chegada e revogação.
- **Funções:** bootstrap restrito à conta indicada, delegação, revogação, proteção do
  administrador, vínculo obrigatório do profissional, preservação dos campos clínicos
  e rejeição da versão mais antiga do cadastro. Duas solicitações simultâneas de cobrança
  geraram um único lançamento, com o valor do procedimento.
- **Navegador com duas contas:** entrada direta sem subusuário; cadastro rápido pela recepção;
  espera; atualização na conta clínica; abertura do atendimento; recarregamento; delegação
  pela interface; revogação da sessão da recepção. Executado também com atraso de 800 ms
  na gravação do cadastro. Sem erros JavaScript e sem rolagem horizontal em 360, 768 e 1440 px.
- **Modo local:** somente o administrador inicial; cadastrar no formulário e “Salvar e atender”;
  uma consulta cancelada não é reaberta pelo atalho.
- Sintaxe dos arquivos JavaScript e `git diff --check` válidos.

As funções de IA não foram chamadas durante os testes (não há necessidade de executar
inferência para verificar autenticação e fluxo de recepção).
