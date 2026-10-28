#!/usr/bin/env bash
# Выполняется на сервере в /opt/soremo: создаёт секреты при первом запуске,
# собирает и поднимает стек, применяет сид. Повторный запуск — обновление.
set -euo pipefail
cd "$(dirname "$0")"

rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-32}"; }

if [ ! -f .env ]; then
  : "${SITE_ADDRESS:?укажите домен: SITE_ADDRESS=soremo.example.ru}"
  cat > .env <<ENV
SITE_ADDRESS=${SITE_ADDRESS}
DB_PASSWORD=$(rand 32)
JWT_SECRET=$(rand 48)
S3_ACCESS_KEY=$(rand 20)
S3_SECRET_KEY=$(rand 40)
SEED_ADMIN_EMAIL=${ADMIN_EMAIL:-admin@${SITE_ADDRESS}}
SEED_ADMIN_PASSWORD=$(rand 16)
SEED_DEMO_PASSWORD=$(rand 10)
# Почта: пока SMTP не задан, ссылка подтверждения показывается на странице.
SMTP_ADDR=
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM='SOREMO CITY <no-reply@${SITE_ADDRESS}>'
ENV
  chmod 600 .env
  echo "Создан deploy/.env с новыми секретами."
fi

set -a; . ./.env; set +a
cat > s3.json <<JSON
{"identities":[{"name":"soremo-api","credentials":[{"accessKey":"${S3_ACCESS_KEY}","secretKey":"${S3_SECRET_KEY}"}],"actions":["Admin","Read","List","Tagging","Write"]}]}
JSON
chmod 600 s3.json

docker compose -f compose.prod.yml up -d --build --remove-orphans
echo "Ждём API…"
for _ in $(seq 1 60); do
  docker compose -f compose.prod.yml exec -T api wget -qO- http://localhost:8080/api/v1/health >/dev/null 2>&1 && break
  sleep 3
done
docker compose -f compose.prod.yml run --rm api seed
docker image prune -f >/dev/null

cat <<INFO

Готово: https://${SITE_ADDRESS}
  Админ:  ${SEED_ADMIN_EMAIL} / ${SEED_ADMIN_PASSWORD}
  Демо:   demo@soremo.local / ${SEED_DEMO_PASSWORD}
Пароли хранятся в /opt/soremo/deploy/.env.
INFO
