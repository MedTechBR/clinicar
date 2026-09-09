# Testes do Clinicar

Somente dados fictícios em `demo-clinicar`. Nunca executar fixtures no projeto de produção.
Requisitos: Node 22, Java 21, Python 3.

```sh
npm ci --prefix functions
npm install --prefix tests
npx --prefix tests playwright install chromium
npx --prefix tests firebase emulators:start --config firebase.test.json --project demo-clinicar --only auth,firestore,functions
```

Em outro terminal, na raiz:

```sh
python3 -m http.server 8897 --bind 127.0.0.1
```

Em outro terminal, executar em ordem (cada suíte depende do estado fictício anterior):

```sh
node tests/rules.cjs
node tests/functions.cjs
node tests/browser.cjs
node tests/local.cjs
```

`rules.cjs` limpa apenas o banco do emulador e testa leitura/escrita por função.
`functions.cjs` prepara contas fictícias no Auth emulado e testa bootstrap, delegação,
revogação e preservação clínica. `browser.cjs` substitui a configuração e as conexões
somente no contexto isolado do Playwright, apontando para os emuladores. Nenhum perfil
do navegador pessoal é usado. Fechar os emuladores descarta as fixtures.
