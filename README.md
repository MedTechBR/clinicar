# Clinicar

Sistema de gestão para clínicas e consultórios: agenda, prontuário, receituário,
financeiro e painel do dia. Roda no navegador, sem instalação.

## Como rodar

```bash
cd src && python3 -m http.server 8080
```
Abra `http://localhost:8080`.

Nasce em **modo local**: tudo fica no navegador, sem conta, e é totalmente usável assim.

## Ligar a nuvem (opcional)

1. Crie um projeto no Firebase (Auth por e-mail/senha + Firestore).
2. Cole a config web em `src/config.js`.
3. Publique as regras e a função de IA:
   ```bash
   firebase deploy --only firestore:rules,functions
   ```

Com a config preenchida o app passa a sincronizar entre aparelhos e libera a IA
(gravar consulta, estruturar evolução, resumo do paciente).

## Estrutura

| Pasta | O que é |
|---|---|
| `src/` | o aplicativo (HTML/CSS/JS puro, sem build) |
| `functions/` | função de IA (Gemini via Vertex, sem chave no cliente) |
| `firestore.rules` | cada conta lê e escreve só os próprios dados |
| `docs/` | especificação, pendências, migração e domínio próprio |

## Documentação

- `docs/ESPEC.md` — especificação completa e critérios de aceite
- `docs/PENDENTE.md` — o que **não** está nesta versão
- `docs/EXPORTACAO-ANTIGO.md` — como trazer os dados do sistema anterior
- `docs/DOMINIO.md` — apontar um domínio próprio
