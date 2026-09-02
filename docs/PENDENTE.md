# Clinicar — o que NÃO está na v1

Lista viva. Nada daqui aparece como botão morto ou promessa na interface. Fonte: docs/ESPEC.md §2.2 + o que ficou fora na construção (02/09/2026).

## Fora do escopo da v1 (ESPEC §2.2)

1. Agendamento online pelo paciente (página pública com vagas reais).
2. Teleconsulta com vídeo dentro do produto (exige sinalização + TURN no Firebase próprio). Na v1, "Teleconsulta" é um procedimento com link externo colado, que entra na mensagem de WhatsApp.
3. Recorrência de consultas (semanal/quinzenal/mensal com prévia de conflitos).
4. Remarcação em massa de um dia inteiro.
5. Sincronização com Google/Apple Calendar.
6. Faturamento TISS, guias, glosas e NFS-e.
7. Contas a pagar completas, centros de custo, DRE, múltiplas contas.
8. Assinatura digital qualificada (ICP-Brasil) dentro do app; validação em validar.iti.gov.br.
9. Anexos de arquivo (PDF/imagem) no prontuário — exige Storage no Firebase próprio.
10. Multiusuário real por clínica no Firebase (contas separadas por funcionário com regras por perfil). Na v1 os perfis são locais: limitam a interface, não são segurança forte; o Firebase é uma conta = uma clínica.
11. Service worker / uso offline no modo firebase.
12. Bloqueio de tela por inatividade e backup cifrado com senha.
13. Gatilho automático da lista de espera com prazo de resposta e ofertas simultâneas (v1: manual, um por vez, com registro da oferta).
14. Cadência automática de lembretes (D-7/D-2/D-1/D-0) — v1: painel manual de "Lembretes de amanhã".
15. Receita eletrônica com assinatura e envio direto à farmácia.
16. Painel de chamada da sala de espera em TV.
17. Indicadores avançados (ocupação, tempo até 3ª vaga, vagas preenchidas pela espera).
18. Curvas de crescimento, IG/DPP e calculadoras clínicas na ficha.
19. Impressão de Notificação de Receita A/B (formulário oficial numerado; o app só avisa).
20. Compactação segura de lápides com múltiplos aparelhos offline por mais de 90 dias.

## Ficou fora na construção (integração, 02/09/2026)

21. **Backend real não exercitado.** `firestore.rules`, `functions/index.js` e o adaptador `firebase` do `backend.js` foram escritos e validados por sintaxe/revisão, mas nunca rodaram contra um projeto Firebase (a regra proíbe os agentes de criar um). Primeiro deploy pelo dono: seguir o cabeçalho de `functions/index.js` e testar com dados fictícios. `firebase.json` mínimo foi incluído para o `firebase deploy`.
22. **IA só com backend.** Gravar consulta, Estruturar com IA e Resumo do paciente mostram "Configure o backend" até a function `gemini`/`geminiAudio` estar publicada. Não há modo de IA por chave própria (decisão: sem chave no cliente).
23. **Verificação visual no navegador** (360/768/1440, scroll horizontal, foco/Tab, arraste, CLS, contraste renderizado) é do auditor — os construtores testaram só a lógica em JavaScriptCore com DOM falso e dados fictícios.
24. **Financeiro:** parcelas de cartão são registradas (1–24x) mas não geram lançamentos por parcela nem controle de recebimento por parcela; repasse "fixo" é por atendimento recebido; sem conciliação, sem múltiplas contas, sem recibo impresso ao paciente (o comprovante de agendamento existe na agenda). CSV do extrato usa `;` e vírgula decimal (Excel pt-BR).
25. **Painel:** "Chamar próximo" inicia o primeiro da sala do próprio profissional; não há chamada por som/TV nem fila entre salas. Aniversariantes limitados a 7 dias e ao consentimento de campanhas para o botão de WhatsApp.
26. **Ajustes:** logo redimensionada no navegador (480×180, ≤ 120 KB) e guardada fora do estado (`clinicar.v1.logo` / `meta/logo`); ainda não há prévia de impressão completa em Ajustes › Clínica (só o cabeçalho). Horários por profissional aceitam até 3 intervalos por dia; feriados nacionais não são pré-cadastrados (use Bloquear na agenda). Não há exclusão de profissional/procedimento/usuário — só inativar.
27. **Importação:** aceita só a exportação do sistema anterior (`docs/EXPORTACAO-ANTIGO.md`) e o backup do próprio Clinicar; não lê CSV/planilhas nem exportações de outros sistemas. No modo mesclar, a configuração da clínica do arquivo só preenche campos vazios; no modo substituir, usuários e auditoria são mantidos. Consultas antigas importadas não geram lançamentos financeiros retroativos. Fixture fictícia para teste em `docs/fixtures/antigo-ficticio.json`.
28. **Textos importados sem paciente** (histórico `docs[]` do sistema anterior) ficam em Ajustes › Dados: podem ser lidos, copiados e vinculados a um paciente, mas não editados nem apagados.
29. **Domínio próprio** depende do registro pelo dono (`docs/DOMINIO.md`); o `CNAME` está com um endereço de exemplo.
30. **Firebase Auth multiusuário:** o login por e-mail/senha é uma conta por clínica; os perfis (recepção/profissional/administrador) continuam locais mesmo no modo firebase.
