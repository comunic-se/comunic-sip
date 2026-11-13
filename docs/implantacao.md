# Implantação (produção)

Modelo escolhido em 12/11/2026: **VM dedicada** só para o Comunic.SIP. A stack tem 3 containers: **Caddy**, que atende 80/443 e emite/renova o HTTPS sozinho; **API**; e **Postgres**, sem porta publicada.

Se um dia o Comunic.SIP for para um host que **já tem** proxy reverso (opção A), não use o Caddy. Nesse caso use só `docker-compose.yml` (mais `docker-compose.proxy.yml`, se o proxy rodar em container) e aponte o proxy para `http://127.0.0.1:8787`.

## Fase atual: acesso pelo IP (sem domínio)
Decisão de 12/11/2026: enquanto não há subdomínio, a VM atende por **`https://177.93.130.128`**.
- **Certificado:** o Let's Encrypt emite certificado válido para IP desde janeiro/2026, mas só no perfil *shortlived* (validade de ~6 dias). O Caddy renova sozinho, desde que a VM alcance o Let's Encrypt (a porta 80 precisa ficar aberta).
- **`.env`:** `DOMAIN=177.93.130.128` e `ACME_PROFILE=shortlived`. O `gerar-env.sh` detecta o IP e preenche os dois.
- **Extensão:** gerada com `npm run build:prod`, que já aponta para `https://177.93.130.128` (ver a seção da extensão abaixo).
- **Menu no Comunic Chat:** `https://177.93.130.128/painel`.
- **Ao migrar para domínio:**
  1. Troque `DOMAIN` e `ACME_PROFILE=classic` no `.env` e rode `docker compose up -d`.
  2. Atualize o menu do Comunic Chat.
  3. Gere a extensão com `--backend=https://<domínio>` e troque o `build:prod` no `package.json`.

  O banco e os segredos continuam os mesmos.

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
5. **Primeiro acesso (banco novo):** `docker compose exec api node scripts/primeiro-acesso.mjs`.
   - Pede, sem mostrar o que é digitado: a URL do PBX, o AccessID/AccessKey do Linkus SDK, o Client ID/Secret da API (opcional) e o token permanente do Comunic Chat (opcional).
   - **Testa as credenciais no PBX antes de gravar.**
   - Cria a Comunic.se com a faixa 4000–4099.
6. **Acesso de emergência:** `docker compose exec api node scripts/admin-emergencia.mjs criar <usuario> f0c2a7d8-9e22-42f5-8c39-19ff41688409`. Guarde a senha e o autenticador no Vaultwarden (ver `seguranca.md`).
6b. **Pelo painel** (`https://<domínio>/painel`, login de emergência): confira o PBX em Empresas e use **Sincronizar** para trazer as chamadas dos últimos 30 dias. Depois vincule os ramais aos usuários. Outras empresas: ver `replicacao-nova-empresa.md`.
7. **Menu no Comunic Chat:** cadastrar o menu personalizado "Página interna" apontando para `https://<domínio>/painel` (ver `painel-gestao-rbac.md`). Nenhum proxy pode adicionar `X-Frame-Options` nessa rota; o Caddyfile do repositório não adiciona.
8. **Backup no cron** do usuário (`crontab -e`):
   ```
   17 3 * * * cd /opt/comunic-sip/comunic-sip-backend && BACKUP_PASSPHRASE_FILE=$HOME/.comunicsip-backup-pass ./scripts/backup.sh >> backups/backup.log 2>&1
   ```
   Teste a restauração na primeira semana: `./scripts/restaurar.sh --testar backups/<arquivo>`. Copie os backups para fora da VM (snapshot do provedor ou outro storage), sempre longe da `ENCRYPTION_KEY`.
9. **Extensão:** build de produção conectado ao domínio (próxima seção).

## Extensão: endereços definidos no build (feito em 13/11/2026)
A extensão **não tem tela de conectividade**: os endereços do backend e do PBX entram no build, e a engrenagem abre só os ajustes de **áudio** e o "Sobre" (versão e build).

```bash
cd softphone-extension
npm run build:prod                                   # backend https://177.93.130.128 + PBX comunic.ras.yeastar.com
npm run build -- --backend=https://<servidor> --pbx=https://<pbx>   # outro ambiente/parceiro
```

- **Sem `--backend` o build falha**, de propósito, para que nenhuma extensão saia apontando para lugar nenhum. `--pbx` aceita vários endereços separados por vírgula. Também dá para usar as variáveis `BACKEND_URL` e `PBX_URL`.
- **Permissões:** o build gera o `dist/manifest.json` com o backend e o PBX em `host_permissions` (fixos, sem pedido de permissão ao usuário) e o backend em `externally_connectable` (ponte com o painel). O `manifest.json` da raiz é só a base.
- **Ao trocar de endereço** (por exemplo, do IP para um domínio): gere outro build e recarregue/republique a extensão.

**Pendente:**
1. **ID fixo da extensão:** publicar na Chrome Web Store / Edge Add-ons e atualizar o `EXT_ID` padrão em `public/painel.html` (deixa de precisar de `?ext=`).
2. **Whitelabel:** um build por parceiro (`--backend` dele, nome e ícones no manifest).
3. **Testar:** instalar o pacote num perfil limpo do Chrome, abrir o Comunic Chat e confirmar que o ramal registra sem nenhum clique.

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
