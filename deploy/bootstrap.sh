#!/usr/bin/env bash
# Подготовка чистого сервера Ubuntu 22.04/24.04: Docker, файрвол, swap.
# Запуск: ssh root@<ip> 'bash -s' < deploy/bootstrap.sh
set -euo pipefail

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
apt-get install -y -qq rsync ufw >/dev/null

# Только SSH и веб. База, S3 и Chromium доступны лишь внутри сети Docker.
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443 >/dev/null
ufw --force enable >/dev/null

# Swap: сборка фронтенда и Chromium не помещаются в 2 ГБ без него.
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p /opt/soremo
echo "Сервер готов: $(docker --version)"
