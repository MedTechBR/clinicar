# Domínio próprio para o Clinicar (GitHub Pages)

O app nasce em `https://<organizacao>.github.io/clinicar/`. Quando você registrar um domínio
(ex.: `clinicar.suaclinica.com.br`), siga os passos abaixo. Nada muda no código além do arquivo `CNAME`.

## 1. Registrar o domínio
- Domínios `.com.br` são registrados em **registro.br** (ou pelo seu provedor de DNS habitual).
- Você pode usar um subdomínio de um domínio que já tem (ex.: `agenda.suaclinica.com.br`) — é o caminho mais simples.

## 2. Apontar o DNS
No painel de DNS do domínio crie:

**Se for subdomínio** (recomendado — `agenda.suaclinica.com.br`):
```
agenda   CNAME   <organizacao>.github.io.
```

**Se for o domínio raiz** (`suaclinica.com.br`): quatro registros A + (opcional) AAAA, mais o `www`:
```
@     A      185.199.108.153
@     A      185.199.109.153
@     A      185.199.110.153
@     A      185.199.111.153
@     AAAA   2606:50c0:8000::153
@     AAAA   2606:50c0:8001::153
@     AAAA   2606:50c0:8002::153
@     AAAA   2606:50c0:8003::153
www   CNAME  <organizacao>.github.io.
```
`<organizacao>` é o usuário/organização do GitHub que hospeda o repositório `clinicar`.
Os IPs acima são os oficiais do GitHub Pages; confira em docs.github.com ("Managing a custom domain") se mudarem.

## 3. Trocar o arquivo `CNAME`
- O arquivo `CNAME` na raiz do repositório tem **uma única linha** com o domínio, sem `https://`, sem barra, sem comentários.
- Substitua `clinicar.exemplo.com.br` pelo domínio real e faça commit. O GitHub Pages passa a servir o site nesse endereço.
- Com domínio próprio o app deixa de ficar em `/clinicar/` e passa para a raiz (`https://agenda.suaclinica.com.br/`). O `manifest.webmanifest` usa caminhos relativos, então continua válido.

## 4. Ativar no GitHub e ligar o HTTPS
1. Repositório → **Settings → Pages**.
2. Em **Custom domain**, digite o domínio e salve (o GitHub confere o DNS).
3. Marque **Enforce HTTPS** assim que a opção ficar disponível (o certificado é emitido automaticamente; pode levar de minutos a algumas horas).

## 5. Firebase (só quando o backend estiver ligado)
- Console do Firebase → **Authentication → Settings → Authorized domains** → adicione o domínio novo (e mantenha `localhost` para testes).
- `config.js` não muda: `authDomain` continua o do projeto (`<projeto>.firebaseapp.com`).

## 6. Prazo e como testar
- Propagação de DNS: de minutos até 24 h (raramente 48 h).
- Terminal: `dig +short agenda.suaclinica.com.br` deve mostrar `<organizacao>.github.io` (ou os IPs do GitHub);
  `curl -I https://agenda.suaclinica.com.br/` deve responder `200` com `server: GitHub.com`.
- Navegador: abra o endereço em aba anônima, faça login local e confira que `#/agenda` abre e que o ícone de instalação (PWA) aparece.
- Se aparecer aviso de certificado, aguarde o "Enforce HTTPS" concluir; se aparecer 404, confira o `CNAME` e o DNS.

## Ao trocar de domínio depois
Os dados do modo local ficam no navegador **por origem** (domínio). Ao mudar de endereço, exporte em
Ajustes › Dados › **Exportar tudo** no endereço antigo e importe no novo (Ajustes › Importar).

> O arquivo `docs/CNAME.exemplo` traz o formato. Só copie para a **raiz** como `CNAME`
> quando o domínio estiver registrado e apontado — um CNAME com domínio inexistente
> derruba o endereço `medtechbr.github.io/clinicar/`.
