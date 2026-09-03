#!/bin/zsh
# Publica as regras do Firestore e as funções de IA do Clinicar.
# Duplo clique neste arquivo. Só funciona depois que o projeto existir no console.
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

echo "=== Clinicar — publicar backend ==="
if [ ! -f .firebaserc ]; then
  echo
  echo "Nenhum projeto vinculado ainda."
  echo "Escolha o projeto do Clinicar na lista a seguir:"
  echo
  firebase use --add || exit 1
fi

PROJ=$(python3 -c "import json;print(json.load(open('.firebaserc'))['projects']['default'])" 2>/dev/null)
echo
echo "Projeto: $PROJ"
echo

# trava: nunca publicar no projeto de outro app
case "$PROJ" in
  medtech-c658c|granae-6c018|radioia-a61ec|medprovas-app|cro-hrsc-01|internamed-c5c3d|medres-app|custos-pj-hrsc)
    echo "PARADO: '$PROJ' é o projeto de OUTRO aplicativo."
    echo "O Clinicar precisa de um projeto próprio. Rode 'firebase use --add' e escolha o certo."
    read -r "?Enter para fechar"; exit 1;;
esac

echo "--- regras do Firestore ---"
firebase deploy --only firestore:rules || { echo; echo "FALHOU nas regras."; read -r "?Enter"; exit 1; }
echo
echo "--- funções de IA (gemini, geminiAudio) ---"
firebase deploy --only functions || { echo; echo "FALHOU nas funções."; read -r "?Enter"; exit 1; }
echo
echo "PRONTO. Agora cole a configuração web em config.js e recarregue o app."
read -r "?Enter para fechar"
