#!/bin/bash
read -p "Pega la URL de redirect: " url
if [ -z "$url" ]; then
  echo "URL vacia, cancelando."
  exit 1
fi
curl -s "$url"
echo ""
echo "Listo. Verifica con: cat ~/.clasprc.json"
