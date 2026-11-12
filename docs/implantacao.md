# Implantação (produção)

Modelo escolhido em 12/11/2026: **VM dedicada** só para o Comunic.SIP. A stack tem 3 containers: **Caddy**, que atende 80/443 e emite/renova o HTTPS sozinho; **API**; e **Postgres**, sem porta publicada.

Se um dia o Comunic.SIP for para um host que **já tem** proxy reverso (opção A), não use o Caddy. Nesse caso use só `docker-compose.yml` (mais `docker-compose.proxy.yml`, se o proxy rodar em container) e aponte o proxy para `http://127.0.0.1:8787`.

## Pré-requisitos
- **VM:** Ubuntu 22.04/24.04 ou Debian 12, com 1 vCPU, 1 GB de RAM (2 GB é confortável) e 10 GB de disco. Precisa de IP público fixo e acesso SSH.
- **DNS:** registro A do subdomínio (ex.: `sip.comunic.chat`) apontando para o IP da VM **antes** de subir; sem isso o Let's Encrypt não emite.
- **Rede de entrada:** só 22, 80 e 443.
- **Rede de saída:** HTTPS para o PBX, `api.wts.chat`, o Let's Encrypt, o Docker Hub e o npm.
- **PBX Yeastar:** OpenAPI e Linkus SDK ativos, com certificado válido. Se a API do PBX tiver IP Restriction, o **IP da VM** precisa estar na lista.
- **Token permanente** do Helena de cada empresa.

## Passos
1. **Preparar a VM** (uma vez):
   ```bash
   sudo apt-get update && sudo apt-get install -y git
   sudo mkdir -p /opt/comunic-sip && sudo chown $USER /opt/comunic-sip
   git clone https://github.com/comunic-se/comunic-sip.git /opt/comunic-sip
   sudo bash /opt/comunic-sip/comunic-sip-backend/scripts/preparar-vm.sh
   ```
   O script faz o seguinte e no fim mostra o IP público:
   - atualiza o sistema;
   - instala Docker e Compose do repositório oficial;
   - liga o firewall (ufw só com 22, 80 e 443), o fail2ban e as atualizações automáticas de segurança;
   - configura a rotação de logs do Docker, o fuso de São Paulo e um swap de 1 GB se a RAM for pequena.

   Depois dele, **saia e entre de novo** no SSH.
2. **SSH:** só com chave, sem `PermitRootLogin`. O script imprime como fazer; teste numa segunda janela antes de fechar a primeira.
3. **Gerar o `.env`** com segredos **novos**:
   ```bash
   cd /opt/comunic-sip/comunic-sip-backend && ./scripts/gerar-env.sh
   ```
   O script pergunta o domínio e o e-mail do certificado. Ele gera `ENCRYPTION_KEY`, `EXTENSION_JWT_SECRET`, `DB_PASSWORD` e a senha de backup (em `~/.comunicsip-backup-pass`), tudo com chmod 600. O `.env` já traz `COMPOSE_FILE` incluindo o Caddy, então todo `docker compose` daquela pasta usa a stack completa.

   **Copie os segredos para o Vaultwarden antes de continuar.** Nunca reutilize a chave do ambiente de desenvolvimento.
4. **Subir:** `docker compose up -d --build`.
   - As migrations rodam sozinhas (`prisma migrate deploy` no `CMD`).
   - Confira com `docker compose ps`, `docker compose logs -f api caddy` e `curl https://<domínio>/health`.
5. **Acesso de emergência:** `docker compose exec api node scripts/admin-emergencia.mjs criar <usuario> <companyId>`. Guarde a senha e o autenticador no Vaultwarden (ver `seguranca.md`). Na primeira subida, sem empresa cadastrada, use o master da plataforma (`papel-plataforma.mjs`).
6. **Cadastrar pelo painel** (banco limpo): PBX (Linkus SDK e Client ID/Secret da API), empresa, token do Helena, faixas e vínculos de ramal. Ver `replicacao-nova-empresa.md`. A coleta traz sozinha as chamadas dos últimos 30 dias.
7. **Menu no Comunic Chat:** cadastrar o menu personalizado "Página interna" apontando para `https://<domínio>/painel` (ver `painel-gestao-rbac.md`). Nenhum proxy pode adicionar `X-Frame-Options` nessa rota; o Caddyfile do repositório não adiciona.
8. **Backup no cron** do usuário (`crontab -e`):
   ```
   17 3 * * * cd /opt/comunic-sip/comunic-sip-backend && BACKUP_PASSPHRASE_FILE=$HOME/.comunicsip-backup-pass ./scripts/backup.sh >> backups/backup.log 2>&1
   ```
   Teste a restauração na primeira semana: `./scripts/restaurar.sh --testar backups/<arquivo>`. Copie os backups para fora da VM (snapshot do provedor ou outro storage), sempre longe da `ENCRYPTION_KEY`.
9. **Extensão:** build de produção conectado ao domínio (próxima seção).

## Extensão em produção: sem tela de Ajustes (fazer junto com o deploy)
Decisão de 12/11/2026: em produção a extensão já sai **conectada ao backend**, sem configuração pelo usuário. A tela de Ajustes (URL do backend, "Ativar login integrado" e campos manuais de PBX/ramal/assinatura) **sai** do build de produção. Passos:

1. **URL do backend no build:** `npm run build` lê a URL de uma variável (ex.: `BACKEND_URL=https://sip.comunic.chat npm run build`) e o esbuild injeta no código. Sem a variável, o build de dev usa `http://localhost:8787`.
2. **Manifest de produção:** o domínio do backend entra em `host_permissions` (fixo) em vez de `optional_host_permissions: ["https://*/*"]`; some o pedido de permissão em tempo de execução. `externally_connectable` fica só com o domínio do painel.
3. **Remover a tela de Ajustes** e os campos manuais do SDK (`pbxURL`, `extension`, `signature` digitados). Tudo vem do backend pelo login integrado. O botão de engrenagem sai (ou vira só "Sobre/versão").
4. **ID fixo da extensão:** publicar na Chrome Web Store / Edge Add-ons e atualizar o `EXT_ID` padrão em `public/painel.html` (deixa de precisar de `?ext=`).
5. **Whitelabel:** um build por parceiro com o domínio dele (`BACKEND_URL`, nome e ícones no manifest).
6. **Testar:** instalar o pacote de produção num perfil limpo do Chrome, abrir o Comunic Chat e confirmar que o ramal registra sem nenhum clique.

## Pendências antes do primeiro deploy
- [x] `Dockerfile` com Prisma, `public/` e `scripts/`, usuário sem privilégio e healthcheck.
- [x] `docker-compose.yml` (Postgres sem porta, API só no loopback, limites de memória) + `docker-compose.caddy.yml` para a VM dedicada.
- [x] `scripts/preparar-vm.sh` e `scripts/gerar-env.sh`.
- [ ] Testar o build da imagem (`docker compose build`) e uma subida completa.
- [x] Assinatura do SDK com validade finita e renovação automática.

## Operação
- **Backup:** `BACKUP_PASSPHRASE_FILE=$HOME/.comunicsip-backup-pass ./scripts/backup.sh` no cron (diário); teste mensal com `./scripts/restaurar.sh --testar backups/<arquivo>`. Restaurar produção: `docker compose stop api` e `./scripts/restaurar.sh --restaurar-producao backups/<arquivo>`.
- Logs: `docker compose logs -f api` (HTTPS/certificado: `docker compose logs caddy`).
- Saúde: `GET /health`.
- Atualizar: `git pull && docker compose up -d --build` (as migrations rodam ao subir).
- Scripts dentro do container: `docker compose exec api node scripts/<script>.mjs`.
