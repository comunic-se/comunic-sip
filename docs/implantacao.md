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
   - `DB_PASSWORD` forte (obrigatória; o compose recusa subir sem ela). O `DATABASE_URL` da API é montado pelo compose apontando para o serviço `db`.
3. **Subir** a stack: `docker compose up -d --build` (ou, com proxy em container, `PROXY_NETWORK=<rede> docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build`).
4. **Migrations:** aplicadas automaticamente quando a API sobe (`prisma migrate deploy` no `CMD` do `Dockerfile`). Confira com `docker compose logs api`.
5. **Provisionar** a empresa (ver `replicacao-nova-empresa.md`).
6. **Proxy reverso:** encaminhar `sip.comunic.chat` → `http://127.0.0.1:8787` (proxy instalado no host) ou `http://api:8787` (proxy em container, usando `docker-compose.proxy.yml`).
7. **Menu no Comunic Chat:** cadastrar o menu personalizado "Página interna" apontando para `https://sip.comunic.chat/painel` (ver `painel-gestao-rbac.md`). O proxy **não** pode adicionar `X-Frame-Options: DENY/SAMEORIGIN` nessa rota, senão o iframe não abre.
8. **Acesso de emergência:** `docker compose exec api node scripts/admin-emergencia.mjs criar <usuario> <companyId>` e guarde senha + autenticador no Vaultwarden (ver `seguranca.md`).
9. **Extensão:** em Ajustes → Login integrado, usar `https://sip.comunic.chat`. Para distribuição, publicar na Chrome Web Store/Edge Add-ons e adicionar o domínio de produção em `externally_connectable` e `optional_host_permissions`.

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
- [x] `docker-compose.yml` da opção A (sem Caddy, Postgres sem porta, API só no loopback, limites de memória).
- [ ] Testar o build da imagem (`docker compose build`) e uma subida completa.
- [x] Assinatura do SDK com validade finita e renovação automática.

## Operação
- Logs: `docker compose logs -f api`.
- Saúde: `GET /health`.
- Backup: `pg_dump` diário cifrado; testar restauração.
- Atualizar: `git pull && docker compose up -d --build` (as migrations rodam ao subir).
- Scripts dentro do container: `docker compose exec api node scripts/<script>.mjs`.
