# Ligar a nuvem do Clinicar

Hoje o app guarda tudo no navegador. Ligando o Firebase, os dados passam a viver na nuvem e
aparecem em qualquer aparelho — recepção, consultório e celular vendo a mesma agenda.

Os passos 1 a 4 são **seus**: criar projeto, escolher região e habilitar login envolvem conta e
cobrança, coisas que eu não faço por você. O passo 5 é um duplo clique. O 6 é colar um trecho.

---

## 1. Criar o projeto

[console.firebase.google.com](https://console.firebase.google.com) → **Adicionar projeto**.

- Nome: **Clinicar**
- Google Analytics: **pode desativar** (não usamos e é um dado a menos saindo da clínica)

## 2. Firestore — a escolha que não tem volta

**Criar banco de dados** → **Iniciar no modo de produção** →
**Local: `southamerica-east1` (São Paulo)**.

> A região do Firestore é **permanente**. Escolhida errada, só se resolve criando outro projeto
> e migrando tudo. São Paulo mantém os dados de saúde no Brasil e é a mesma região das funções.

Não se preocupe com as regras agora — o passo 5 publica as certas por cima.

## 3. Login por e-mail e senha

**Authentication** → **Vamos começar** → aba **Sign-in method** → **E-mail/senha** → ativar.

Depois, em **Users** → **Adicionar usuário**, crie a conta da clínica com o e-mail e a senha que
a equipe vai usar. **É uma conta por clínica**, não uma por funcionário — os perfis (recepção,
profissional, administrador) continuam sendo do lado do aplicativo.

## 4. Plano Blaze (necessário só para a IA)

Funções em nuvem exigem o plano **Blaze** (pague pelo uso). Sem Blaze, o passo 5 publica as
regras normalmente e o app sincroniza — só a IA (gravar consulta, estruturar evolução, resumo
do paciente) fica indisponível.

Se ativar o Blaze, **coloque um orçamento com alerta** (Faturamento → Orçamentos e alertas).
Os outros projetos daqui usam R$ 25 como teto de aviso.

## 5. Publicar regras e funções

No Finder, duplo clique em **`deploy-clinicar.command`**, na pasta do projeto.

Na primeira vez ele pergunta qual projeto usar — escolha o **Clinicar**. Ele recusa publicar em
projeto de outro aplicativo, então não dá para errar de alvo.

## 6. Colar a configuração no app — **duplo clique**

Console → engrenagem → **Configurações do projeto** → role até **Seus apps** → **Web (`</>`)** →
registre um app chamado `Clinicar` → **copie o bloco `firebaseConfig` inteiro**.

Duplo clique em **`configurar.command`**, cole o bloco, Enter e **Ctrl-D**. Ele escreve o
`config.js` e o `.firebaserc` sozinho, guarda uma cópia do arquivo anterior e recusa se você
colar o projeto de outro aplicativo ou uma colagem pela metade.

Depois: `git add -A && git commit -m "liga a nuvem" && git push`.

<details><summary>Se preferir editar à mão</summary>


Console → engrenagem → **Configurações do projeto** → role até **Seus apps** → **Web (`</>`)** →
registre um app chamado `Clinicar` → copie o objeto `firebaseConfig`.

Abra **`config.js`** na raiz do projeto e preencha:

```js
window.CLINICAR_CONFIG = {
  apiKey: 'AIza...',            // do console
  authDomain: 'clinicar-xxxx.firebaseapp.com',
  projectId: 'clinicar-xxxx',
  storageBucket: 'clinicar-xxxx.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:xxxxxxxx',
  regiaoFunctions: 'southamerica-east1'
};
```

</details>

Essa configuração é **pública por design** — quem protege os dados são as regras do passo 5, não
o segredo dessas chaves. Pode ficar no repositório sem problema.

Publique (`git add config.js && git commit && git push`) e recarregue o app: a pílula do topo
deixa de dizer "Modo local" e passa a pedir e-mail e senha.

---

## Levar os dados que já existem

O que está no navegador **não sobe sozinho**. Antes de entrar pela primeira vez na conta:

1. No app em modo local: **Ajustes → Dados → Exportar tudo** (baixa um JSON).
2. Recarregue, entre com o e-mail e a senha da clínica.
3. **Ajustes → Dados → Importar arquivo** e escolha o JSON.

Confira as contagens na prévia antes de confirmar.

## Como saber que funcionou

- A pílula do topo mostra a conta, não "Modo local".
- Abra em outro navegador, entre com a mesma conta: a agenda é a mesma.
- Marque uma consulta fictícia num aparelho e veja aparecer no outro.
- Em **Ajustes → Sobre**, o estado da IA deixa de dizer "configure o backend".

## O que muda em relação à privacidade

Os dados dos pacientes passam a ficar nos servidores do Google em São Paulo, e não mais só no
computador da clínica. As regras publicadas garantem que **só a conta dona lê e escreve a própria
árvore** — não há leitura pública nem acesso anônimo. Ainda assim, é uma decisão de tratamento de
dados de saúde: vale constar na sua política de privacidade e no que você informa ao paciente.
