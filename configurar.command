#!/bin/zsh
# Recebe a configuração web do Firebase (copiada do console) e deixa o Clinicar pronto.
# Duplo clique. Depois disso, só falta rodar o deploy-clinicar.command.
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

echo "=== Clinicar — configurar a nuvem ==="
echo
echo "No console do Firebase: engrenagem > Configurações do projeto > Seus apps > Web."
echo "Copie o bloco firebaseConfig inteiro e cole aqui."
echo "Quando terminar de colar, pressione Enter e depois Ctrl-D."
echo
CONF=$(cat)

python3 - "$CONF" <<'PY'
import json, re, sys, pathlib, shutil

bruto = sys.argv[1]
campos = {}
for chave in ['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId','measurementId']:
    m = re.search(chave + r'\s*:\s*["\']([^"\']+)["\']', bruto)
    if m: campos[chave] = m.group(1)

faltando = [c for c in ['apiKey','authDomain','projectId','appId'] if not campos.get(c)]
if faltando:
    print('\nNão consegui ler: ' + ', '.join(faltando))
    print('Cole o bloco inteiro, com as chaves entre aspas. Nada foi alterado.')
    raise SystemExit(1)

proibidos = {'medtech-c658c','granae-6c018','radioia-a61ec','medprovas-app',
             'cro-hrsc-01','internamed-c5c3d','medres-app','custos-pj-hrsc'}
if campos['projectId'] in proibidos:
    print('\nPARADO: "%s" é o projeto de OUTRO aplicativo.' % campos['projectId'])
    print('O Clinicar precisa de um projeto próprio. Nada foi alterado.')
    raise SystemExit(1)

p = pathlib.Path('config.js')
shutil.copy(p, 'config.js.bak')
p.write_text(
"""// Configuração web do projeto Firebase do Clinicar.
// Pública por design: quem protege os dados são as regras do Firestore (firestore.rules),
// não o segredo destas chaves. Gerado por configurar.command.
window.CLINICAR_CONFIG = {
  apiKey: %r,
  authDomain: %r,
  projectId: %r,
  storageBucket: %r,
  messagingSenderId: %r,
  appId: %r,
  regiaoFunctions: 'southamerica-east1'
};
""".replace("%r", "%s") % tuple(
    "'" + campos.get(c, '').replace("'", "") + "'"
    for c in ['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId']
), encoding='utf-8')

pathlib.Path('.firebaserc').write_text(
    json.dumps({'projects': {'default': campos['projectId']}}, indent=2) + '\n', encoding='utf-8')

print('\nconfig.js  escrito  (cópia do anterior em config.js.bak)')
print('.firebaserc escrito  projeto: ' + campos['projectId'])
PY

[ $? -ne 0 ] && { read -r "?Enter para fechar"; exit 1; }

echo
echo "Conferindo se o arquivo continua válido..."
osascript -l JavaScript -e 'ObjC.import("Foundation"); var s=$.NSString.stringWithContentsOfFileEncodingError("config.js", $.NSUTF8StringEncoding, null).js; try { new Function(s); "  config.js OK" } catch(e) { "  ERRO: "+e.message }'

echo
echo "Próximos passos:"
echo "  1. duplo clique em deploy-clinicar.command  (publica regras e funções)"
echo "  2. git add -A && git commit -m 'liga a nuvem' && git push"
echo "  3. recarregue https://medtechbr.github.io/clinicar/ — vai pedir e-mail e senha"
echo
read -r "?Enter para fechar"
