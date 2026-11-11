# Implantação (produção)

Modelo escolhido: **opção A** — o host já tem um proxy reverso (que atende n8n e Vaultwarden) dono das portas 80/443. O Comunic.SIP sobe como **stack separada** (API + Postgres próprios) e o proxy encaminha um subdomínio para a API.

## Pré-requisitos
- Docker + Docker Compose no host.
- Subdomínio (ex.: `sip.comunic.chat`) apontando para o host, com HTTPS no proxy.
- PBX Yeastar com OpenAPI e Linkus SDK ativos, certificado válido e o IP do host na IP Restriction.
- Token permanente do Helena da empresa.

## Passos
1. **Clonar** o repositório no host.
2. **Configurar** `comunic-sip-backend/.env` a partir de `.env.example`:
   - `DATABASE_URL` apontando para o Postgres da stack.
   - `ENCRYPTION_KEY` e `EXTENSION_JWT_SECRET` **novos** (`openssl rand -base64 32`), guardados no Vaultwarden.
   - `ALLOWED_ORIGINS=https://sip.comunic.chat`, `TRUST_PROXY=true`, `HOST=0.0.0.0`.
   - `PANEL_FRAME_ANCESTORS` só se precisar de domínios além de `*.wts.chat`/`*.flw.chat`.
3. **Subir** a stack: `docker compose up -d --build`.
4. **Migrar** o banco: `docker compose exec api npx prisma migrate deploy`.
5. **Provisionar** a empresa (ver `replicacao-nova-empresa.md`).
6. **Proxy reverso:** encaminhar `sip.comunic.chat` → `api:8787` (mesma rede docker do proxy, ou `127.0.0.1:8787`).
7. **Menu no Comunic Chat:** cadastrar o menu personalizado "Página interna" apontando para `https://sip.comunic.chat/painel` (ver `painel-gestao-rbac.md`). O proxy **não** pode adicionar `X-Frame-Options: DENY/SAMEORIGIN` nessa rota, senão o iframe não abre.
8. **Extensão:** em Ajustes → Login integrado, usar `https://sip.comunic.chat`. Para distribuição, publicar na Chrome Web Store/Edge Add-ons e adicionar o domínio de produção em `externally_connectable` e `optional_host_permissions`.

## Pendências antes do primeiro deploy
- [ ] `Dockerfile`: copiar `prisma/` e rodar `npx prisma generate` no build, e copiar `public/` (painel) para a imagem de runtime — hoje faltam os dois.
- [ ] `docker-compose.yml`: remover o serviço `caddy` (opção A), não publicar a porta do Postgres, publicar a API só em `127.0.0.1` ou só na rede do proxy.
- [ ] Assinatura do SDK com validade finita.

## Operação
- Logs: `docker compose logs -f api`.
- Saúde: `GET /health`.
- Backup: `pg_dump` diário cifrado; testar restauração.
- Atualizar: `git pull && docker compose up -d --build && docker compose exec api npx prisma migrate deploy`.
