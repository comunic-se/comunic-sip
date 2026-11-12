#!/usr/bin/env bash
# Prepara uma VM DEDICADA (Ubuntu 22.04/24.04 ou Debian 12) para o Comunic.SIP.
# Rodar UMA vez, como root (sudo), logo após criar a VM:
#
#   sudo apt-get update && sudo apt-get install -y git
#   sudo mkdir -p /opt/comunic-sip && sudo chown $USER /opt/comunic-sip
#   git clone https://github.com/comunic-se/comunic-sip.git /opt/comunic-sip
#   sudo bash /opt/comunic-sip/comunic-sip-backend/scripts/preparar-vm.sh
#
# O que faz: atualiza o sistema, instala Docker Engine + Compose v2 (repositório
# oficial), git, openssl, firewall (ufw: só 22, 80 e 443), fail2ban para o SSH,
# atualizações automáticas de segurança, rotação de logs do Docker, fuso horário
# de São Paulo, swap de 1 GB se a VM tiver pouca RAM e a pasta /opt/comunic-sip.
# NÃO mexe no login do SSH: veja as recomendações impressas no final.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Rode com sudo: sudo bash $0"; exit 1; }
. /etc/os-release
case "$ID" in ubuntu|debian) ;; *) echo "Sistema $ID não suportado (use Ubuntu ou Debian)"; exit 1;; esac
ALVO="${SUDO_USER:-root}"
export DEBIAN_FRONTEND=noninteractive

echo "==> Atualizando o sistema"
apt-get update -q
apt-get -y -q upgrade
apt-get -y -q install ca-certificates curl gnupg git openssl ufw fail2ban unattended-upgrades

echo "==> Fuso horário America/Sao_Paulo"
timedatectl set-timezone America/Sao_Paulo || true

echo "==> Docker Engine + Compose v2 (repositório oficial)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
mkdir -p /etc/docker
if [[ ! -f /etc/docker/daemon.json ]]; then
  cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
JSON
fi
systemctl enable --now docker
systemctl restart docker
[[ "$ALVO" != root ]] && usermod -aG docker "$ALVO"

echo "==> Firewall: só SSH, HTTP e HTTPS"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> fail2ban (SSH) e atualizações automáticas de segurança"
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

MEM_MB=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
if (( MEM_MB < 2048 )) && ! swapon --show | grep -q .; then
  echo "==> Swap de 1 GB (RAM: ${MEM_MB} MB)"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Pasta da aplicação: /opt/comunic-sip (dono: $ALVO)"
mkdir -p /opt/comunic-sip
chown "$ALVO":"$ALVO" /opt/comunic-sip

cat <<MSG

Pronto. Versões: $(docker --version) | $(docker compose version)
IP público desta VM: $(curl -fsS https://api.ipify.org || echo "não consegui descobrir")

Próximos passos:
  1. Saia e entre de novo no SSH (para o usuário $ALVO usar o docker sem sudo).
  2. Aponte o DNS do subdomínio (registro A) para o IP acima.
  3. cd /opt/comunic-sip/comunic-sip-backend && ./scripts/gerar-env.sh

Recomendado para o SSH (faça você, testando em outra janela antes de fechar a atual):
  - entrar só com chave: PasswordAuthentication no  em /etc/ssh/sshd_config
  - sem root direto:     PermitRootLogin no
  - depois: systemctl restart ssh
MSG
