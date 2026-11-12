#!/usr/bin/env bash
# Backup CIFRADO do Postgres do Comunic.SIP (rodar no servidor, na pasta comunic-sip-backend).
#
#   BACKUP_PASSPHRASE='...' ./scripts/backup.sh
#
# Gera backups/comunicsip-AAAAMMDD-HHMMSS.dump.enc (pg_dump formato custom, cifrado com
# AES-256 / PBKDF2) + .sha256, e apaga os mais antigos que BACKUP_KEEP_DAYS (padrão 14).
#
# IMPORTANTE
# - Guarde a BACKUP_PASSPHRASE no Vaultwarden. Sem ela o backup não abre.
# - Os segredos dentro do banco (chave do PBX, token do Helena) estão cifrados com a
#   ENCRYPTION_KEY do .env. Guarde a ENCRYPTION_KEY no Vaultwarden também, e NUNCA no
#   mesmo lugar dos arquivos de backup.
# - Agende com cron, ex. todo dia às 03:17:
#   17 3 * * * cd /opt/comunic-sip/comunic-sip-backend && BACKUP_PASSPHRASE_FILE=/root/.comunicsip-backup-pass ./scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
DIR="${BACKUP_DIR:-backups}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
if [[ -n "${BACKUP_PASSPHRASE_FILE:-}" ]]; then BACKUP_PASSPHRASE="$(cat "$BACKUP_PASSPHRASE_FILE")"; fi
: "${BACKUP_PASSPHRASE:?defina BACKUP_PASSPHRASE (ou BACKUP_PASSPHRASE_FILE)}"
if (( ${#BACKUP_PASSPHRASE} < 16 )); then echo "BACKUP_PASSPHRASE muito curta (mín. 16)"; exit 1; fi
export BACKUP_PASSPHRASE

umask 077
mkdir -p "$DIR"
OUT="$DIR/comunicsip-$(date +%Y%m%d-%H%M%S).dump.enc"
TMP="$OUT.partial"

docker compose exec -T db pg_dump -U comunic -d comunicsip --format=custom --no-owner \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$TMP"
mv "$TMP" "$OUT"
sha256sum "$OUT" > "$OUT.sha256"
echo "$(date -Is) backup ok: $OUT ($(du -h "$OUT" | cut -f1))"

find "$DIR" -name 'comunicsip-*.dump.enc*' -type f -mtime +"$KEEP" -print -delete | sed 's/^/removido: /'
