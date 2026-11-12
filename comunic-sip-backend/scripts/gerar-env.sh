#!/usr/bin/env bash
# Gera o .env de PRODUÇÃO com segredos novos (rodar na VM, na pasta comunic-sip-backend):
#
#   ./scripts/gerar-env.sh
#
# Pergunta o domínio e o e-mail do certificado, gera ENCRYPTION_KEY, EXTENSION_JWT_SECRET,
# DB_PASSWORD e a senha dos backups. Os segredos ficam só nesta VM (chmod 600).
# COPIE-OS PARA O VAULTWARDEN: sem a ENCRYPTION_KEY os segredos do banco não abrem,
# e sem a senha de backup nenhum backup pode ser restaurado.
set -euo pipefail
cd "$(dirname "$0")/.."

[[ -e .env ]] && { echo ".env já existe. Não vou sobrescrever segredos (apague à mão se for mesmo recomeçar)."; exit 1; }
command -v openssl >/dev/null || { echo "Instale o openssl"; exit 1; }

read -rp "Domínio do painel/API (ex.: sip.comunic.chat): " DOMAIN
read -rp "E-mail para o certificado HTTPS (avisos do Let's Encrypt): " ACME_EMAIL
[[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "Domínio inválido: $DOMAIN"; exit 1; }
[[ "$ACME_EMAIL" == *@* ]] || { echo "E-mail inválido"; exit 1; }

umask 077
cat > .env <<ENV
# Gerado por scripts/gerar-env.sh em $(date -Is). NUNCA vai para o git.
# Inclui o Caddy (HTTPS) em todo "docker compose ..." desta pasta:
COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml

DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL

NODE_ENV=production
HOST=0.0.0.0
PORT=8787
TRUST_PROXY=true

DB_PASSWORD=$(openssl rand -hex 24)
ENCRYPTION_KEY=$(openssl rand -base64 32)
EXTENSION_JWT_SECRET=$(openssl rand -hex 48)

HELENA_BASE=https://api.wts.chat
# O painel é servido pelo mesmo domínio e a extensão usa host_permissions: CORS fica fechado.
ALLOWED_ORIGINS=

SIGN_TTL_SECONDS=43200
CDR_SYNC_ENABLED=true
CDR_BACKFILL_DAYS=30
PBX_TIMEZONE_OFFSET=-03:00
PBX_DATE_ORDER=DMY
ENV
chmod 600 .env

PASS_FILE="$HOME/.comunicsip-backup-pass"
if [[ ! -e "$PASS_FILE" ]]; then
  openssl rand -base64 33 > "$PASS_FILE"
  chmod 600 "$PASS_FILE"
fi

cat <<MSG
.env criado (chmod 600) e senha de backup em $PASS_FILE.

AGORA, antes de subir: copie para o Vaultwarden (item "Comunic.SIP produção"):
  - ENCRYPTION_KEY, EXTENSION_JWT_SECRET e DB_PASSWORD   →  cat .env
  - senha dos backups                                     →  cat $PASS_FILE
Depois: docker compose up -d --build
MSG
