#!/usr/bin/env bash
# Restaura (ou TESTA) um backup cifrado do Comunic.SIP. Rodar no servidor, na pasta comunic-sip-backend.
#
#   ./scripts/restaurar.sh --testar backups/comunicsip-AAAAMMDD-HHMMSS.dump.enc
#       restaura num banco TEMPORÁRIO (comunicsip_teste), confere as tabelas e apaga.
#       Não toca no banco de produção. Faça isso periodicamente: backup não testado não é backup.
#
#   ./scripts/restaurar.sh --restaurar-producao backups/comunicsip-....dump.enc
#       SUBSTITUI o banco de produção pelo backup. Pare a API antes (docker compose stop api)
#       e pede confirmação digitando o nome do banco.
#
# Precisa de BACKUP_PASSPHRASE (ou BACKUP_PASSPHRASE_FILE).
set -euo pipefail

cd "$(dirname "$0")/.."
MODE="${1:-}"; FILE="${2:-}"
[[ "$MODE" == "--testar" || "$MODE" == "--restaurar-producao" ]] && [[ -f "$FILE" ]] || {
  sed -n '2,13p' "$0"; exit 1; }
if [[ -n "${BACKUP_PASSPHRASE_FILE:-}" ]]; then BACKUP_PASSPHRASE="$(cat "$BACKUP_PASSPHRASE_FILE")"; fi
: "${BACKUP_PASSPHRASE:?defina BACKUP_PASSPHRASE (ou BACKUP_PASSPHRASE_FILE)}"
export BACKUP_PASSPHRASE

if [[ -f "$FILE.sha256" ]]; then sha256sum -c "$FILE.sha256"; else echo "aviso: sem $FILE.sha256 para conferir a integridade"; fi

decrypt() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE"; }
psql_db() { docker compose exec -T db psql -U comunic -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }

if [[ "$MODE" == "--testar" ]]; then
  psql_db postgres -c 'DROP DATABASE IF EXISTS comunicsip_teste' -c 'CREATE DATABASE comunicsip_teste' >/dev/null
  trap 'psql_db postgres -c "DROP DATABASE IF EXISTS comunicsip_teste" >/dev/null || true' EXIT
  decrypt | docker compose exec -T db pg_restore -U comunic -d comunicsip_teste --no-owner --exit-on-error
  echo "Restaurado em comunicsip_teste. Contagem por tabela:"
  psql_db comunicsip_teste -At -c "
    SELECT 'company', count(*) FROM company UNION ALL
    SELECT 'extension_link', count(*) FROM extension_link UNION ALL
    SELECT 'calls', count(*) FROM calls UNION ALL
    SELECT 'audit_log', count(*) FROM audit_log UNION ALL
    SELECT '_prisma_migrations', count(*) FROM _prisma_migrations" | sed 's/|/: /'
  echo "TESTE OK — o banco temporário será apagado."
  exit 0
fi

read -r -p "Isto SUBSTITUI o banco de produção 'comunicsip'. Digite o nome do banco para confirmar: " ok
[[ "$ok" == "comunicsip" ]] || { echo "Cancelado."; exit 1; }
decrypt | docker compose exec -T db pg_restore -U comunic -d comunicsip --clean --if-exists --no-owner --exit-on-error
echo "Restauração concluída. Suba a API: docker compose start api"
