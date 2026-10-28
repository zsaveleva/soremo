#!/usr/bin/env bash
# Выкладка с локальной машины: копирует код на сервер и запускает server-up.sh.
#   deploy/deploy.sh root@203.0.113.10                 — без домена (адрес 203-0-113-10.sslip.io)
#   deploy/deploy.sh root@203.0.113.10 soremo.example.ru — со своим доменом (A-запись на IP сервера)
# Email администратора (для входа в /admin) можно задать заранее:
#   ADMIN_EMAIL=you@example.ru deploy/deploy.sh root@203.0.113.10
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:?укажите сервер: deploy/deploy.sh root@<ip> [домен]}"
HOST="${TARGET#*@}"
SITE="${2:-$(echo "$HOST" | tr . -).sslip.io}"

rsync -az --delete \
  --exclude .git --exclude node_modules --exclude .cache --exclude 'web/dist' \
  --exclude 'web/test-results' --exclude 'web/public/data' --exclude 'docs/screens' \
  --exclude 'deploy/.env' --exclude 'deploy/s3.json' \
  ./ "$TARGET:/opt/soremo/"

ssh "$TARGET" "cd /opt/soremo && SITE_ADDRESS='$SITE' ADMIN_EMAIL='${ADMIN_EMAIL:-}' bash deploy/server-up.sh"
