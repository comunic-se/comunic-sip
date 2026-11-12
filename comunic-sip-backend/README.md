# comunic-sip-backend

API do Comunic.SIP. Faz a ponte segura entre o Comunic Chat (Helena), o PBX Yeastar e o banco:

- valida quem é o usuário (pela sessão do Comunic Chat) e emite um **JWT** próprio;
- aplica o **controle de acesso** (RBAC multinível) e o **gate de provisionamento** (só empresas habilitadas usam o sistema);
- emite a **assinatura do Linkus SDK** do ramal vinculado, com as credenciais do PBX guardadas **cifradas** no banco;
- serve o **painel de gestão** (`/painel`) e as rotas de ramais e contatos.

Stack: Node 20, TypeScript (ESM), Fastify 5, Prisma 6 + PostgreSQL 16, `@fastify/jwt`.

## Rodando em desenvolvimento

```powershell
npm install
copy .env.example .env      # preencha conforme a tabela abaixo
npm run db:dev             # só o Postgres (docker-compose.dev.yml), em 127.0.0.1:5433
npx prisma migrate deploy   # cria/atualiza as tabelas
node scripts/seed-comunic.mjs
npm run dev                 # tsx watch: recarrega sozinho a cada alteração
```

- API: `http://localhost:8787` · saúde: `GET /health` → `{"ok":true}`
- Painel: `http://localhost:8787/painel`
- O Postgres do compose fica na porta **5433** do host porque a 5432 costuma estar ocupada por um Postgres local.

Gerar segredos:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"      # EXTENSION_JWT_SECRET
```

### Scripts do npm
| Script | O que faz |
|---|---|
| `npm run dev` | Sobe a API com `tsx watch` |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Roda `dist/server.js` (produção) |
| `npm run db:dev` | Sobe o Postgres de desenvolvimento (`docker-compose.dev.yml`) |

## Variáveis de ambiente (`.env`, nunca versionado)

| Variável | Obrigatória | Uso |
|---|---|---|
| `DATABASE_URL` | sim | Postgres do Prisma. Dev: `postgresql://comunic:comunic@localhost:5433/comunicsip` |
| `ENCRYPTION_KEY` | sim | Chave AES-256-GCM (32 bytes em base64) que cifra os segredos guardados no banco. Trocar a chave invalida os segredos já gravados. |
| `EXTENSION_JWT_SECRET` | sim | Segredo que assina o JWT do painel/extensão. **Se ficar vazio o backend cai num segredo de desenvolvimento inseguro** — nunca deixe vazio fora do seu computador. |
| `PORT` / `HOST` | não | Padrão `8787` / `0.0.0.0` |
| `HELENA_BASE` | não | API da Helena. Padrão `https://api.wts.chat` |
| `ALLOWED_ORIGINS` | não | Origens liberadas no CORS, separadas por vírgula. Vazio = nega chamadas cross-origin (a extensão não precisa de CORS; o painel é servido pelo próprio backend). |
| `TRUST_PROXY` | não | `true` quando a API fica atrás de reverse proxy (lê `X-Forwarded-*`) |
| `SIGN_TTL_SECONDS` | não | Validade da assinatura do Linkus SDK, em segundos. Padrão `43200` (12 h); mínimo `1800` |
| `CDR_SYNC_ENABLED` / `CDR_SYNC_INTERVAL_S` / `CDR_BACKFILL_DAYS` | não | Coleta de chamadas: liga/desliga (padrão `true`), intervalo (padrão `120` s) e dias de histórico na primeira coleta (padrão `30`) |
| `PBX_TIMEZONE_OFFSET` | não | Fuso do relógio do PBX para CDR sem timestamp e para os filtros por data. Padrão `-03:00` |
| `PBX_DATE_ORDER` | não | Ordem da data no texto do CDR quando ambígua: `DMY` (padrão) ou `MDY` |
| `RATE_LIMIT_PER_MIN` | não | Limite geral de requisições por sessão/IP por minuto (padrão `600`) |
| `CDR_STORE_UNASSIGNED` | não | `true` grava também chamadas sem empresa cadastrada (padrão `false`, por minimização de dados) |
| `PANEL_FRAME_ANCESTORS` | não | Quem pode embutir o `/painel` em iframe. Padrão `'self' https://*.wts.chat https://*.flw.chat` |
| `PBX_BASE_URL`, `SDK_ACCESS_ID`, `SDK_ACCESS_KEY` | só p/ o seed | Usadas **apenas** por `scripts/seed-comunic.mjs` para cadastrar o PBX no banco (a chave vai cifrada). A API em si lê o PBX do banco. |
| `DB_PASSWORD` | produção | Senha do Postgres. **Obrigatória** no `docker-compose.yml` (sem ela a stack não sobe); no dev o padrão é `comunic` |

## Scripts de operação (`scripts/`)

| Script | Uso |
|---|---|
| `seed-comunic.mjs` | Prepara o piloto: registra o PBX (chave cifrada), cria a empresa Comunic.se ativa, faixa de ramais 4000–4099 e vincula o Pedro ao ramal 4004. **Não** concede papel de plataforma. Idempotente (pode rodar de novo). Os IDs do piloto estão fixos no arquivo. |
| `set-helena-token.mjs <companyId> <token>` | Grava, cifrado, o token permanente da API Helena (`pn_...`) de uma empresa. Necessário para listar usuários no painel e para a aba Contatos. Rode no terminal: o token não deve passar por chat, e-mail ou commit. |
| `papel-plataforma.mjs` | Papéis de plataforma: `listar`, `adicionar <userId> SUPER_ADMIN`, `adicionar <userId> PARTNER_ADMIN <partnerId>`, `remover <userId> <papel>`. Auditado |
| `backup.sh` / `restaurar.sh` | Backup cifrado do Postgres (servidor, cron) e restauração/teste em banco temporário. Ver `docs/implantacao.md` |
| `diagnostico-cdr.mjs` | Diagnóstico da coleta de chamadas (somente leitura): `node scripts/diagnostico-cdr.mjs --testar-api` |
| `admin-emergencia.mjs` | Contas de acesso de emergência ao painel: `criar <usuario> <companyId>`, `resetar`, `desativar`, `ativar`, `listar`. Pede a senha sem eco e mostra a chave do autenticador uma única vez |
| `gerar-assinatura.mjs` | Script antigo de testes manuais da assinatura do SDK. Não é usado pelo fluxo atual. |

## Organização do código (`src/`)

| Arquivo | Responsabilidade |
|---|---|
| `server.ts` | Monta o Fastify (CORS, JWT, rotas) e as rotas de login: `/v1/auth/extension`, `/v1/panel/session`, `/v1/me`, `/health` |
| `config.ts` | Lê e valida as variáveis de ambiente |
| `auth.ts` | Abre a sessão (valida o token Helena, aplica o gate da empresa, resolve o papel, emite o JWT) e o `requireAuth(permissão)` que protege as rotas |
| `rbac.ts` | Papéis, matriz de permissões e resolução do papel efetivo |
| `helena.ts` | Valida a sessão do usuário (`GET /core/v1/agent/me`) |
| `helena-admin.ts` | Chamadas com o token **permanente** da empresa: listar agentes, buscar/criar/editar contatos (com retry em 429 e telefone normalizado) |
| `yeastar.ts` | Token da API Yeastar (cacheado e renovado) e `sign/create` do Linkus SDK (exige vencimento futuro) |
| `crypto.ts` | Cifra/decifra segredos (AES-256-GCM) |
| `db.ts` | Cliente Prisma |
| `routes-panel.ts` | Painel: página `/painel` (com `frame-ancestors`), logo, usuários, faixas e vínculo de ramais |
| `routes-contacts.ts` | Contatos (`/v1/contacts`) |
| `routes-companies.ts` | Módulo Empresas: empresas, PBX, faixas e token do Helena |
| `routes-directory.ts` | Diretório de ramais da empresa (transferência na extensão) |
| `cdr-sync.ts` | Coleta periódica do CDR pela OpenAPI e associação empresa/atendente |
| `routes-calls.ts` | Chamadas (lista, exportação), Dashboard e "Sincronizar agora" |
| `routes-access.ts` | Permissões efetivas (`/v1/panel/me`) e módulo Acessos (concessões) |
| `routes-emergency.ts` | Login de emergência (senha Argon2id + TOTP, bloqueios, auditoria) |
| `totp.ts` | Códigos TOTP (RFC 6238) |

Referência completa dos endpoints: [`../docs/api-backend.md`](../docs/api-backend.md).

## Banco de dados (Prisma)

Schema em `prisma/schema.prisma`; migrations em `prisma/migrations/`.

| Tabela | Conteúdo |
|---|---|
| `pbx` | Um registro por Yeastar; `sdk_access_key_enc` cifrado |
| `company` | Empresa (tenant). `id` = `companyId` do Helena. `active` liga/desliga o acesso; `helena_api_token_enc` cifrado |
| `extension_range` | Faixa de ramais liberada para a empresa |
| `extension_link` | Usuário Helena → ramal |
| `platform_role` | Papéis de plataforma/parceiro (`SUPER_ADMIN`, `PARTNER_ADMIN`) |
| `role_override` | Promoção manual dentro de uma empresa (ex.: `SUPERVISOR`) |
| `audit_log` | Ações sensíveis (vínculo/desvínculo de ramal, empresas, logins de emergência, …) |
| `permission_grant` | Permissões extras por usuário/empresa (quem concedeu e quando) |
| `emergency_admin` | Contas de acesso de emergência: hash Argon2id da senha, segredo TOTP cifrado, bloqueio |
| `calls` | Chamadas coletadas do PBX (empresa, atendente, outra ponta, durações, `raw` do PBX) |
| `did_route` | DID → empresa, para chamadas que não passam por um ramal (ex.: fila) |
| `contacts_cache` | Reservada para espelho de contatos (ainda não usada) |

Alterar o schema:
```powershell
npx prisma migrate dev --name descricao-da-mudanca   # gera a migration e aplica
npx prisma generate                                  # atualiza o client
```
> O projeto fixa o **Prisma 6**. O Prisma 8 mudou a CLI (`migrate dev` foi substituído); não atualize sem planejar a migração.

## Docker

| Arquivo | Para quê |
|---|---|
| `docker-compose.yml` | **Produção (base):** `api` + `db`. API só em `127.0.0.1:8787`, Postgres sem porta publicada, `mem_limit` de 512 MB em cada, `DB_PASSWORD` obrigatória |
| `docker-compose.caddy.yml` | **VM dedicada:** Caddy em 80/443 com HTTPS automático (Let's Encrypt) para `DOMAIN`; config em `deploy/Caddyfile`. O `.env` gerado por `scripts/gerar-env.sh` já o inclui via `COMPOSE_FILE` |
| `docker-compose.proxy.yml` | Host com proxy próprio em container (no lugar do Caddy): liga a API à rede do proxy (`PROXY_NETWORK`) |
| `docker-compose.dev.yml` | **Desenvolvimento:** só o Postgres, em `127.0.0.1:5433` (mesmo volume de dados) |
| `Dockerfile` | Build em duas etapas; gera o client do Prisma, inclui `public/` (painel) e `scripts/`, roda como usuário `node`, healthcheck em `/health`. **Aplica as migrations pendentes ao subir** (`prisma migrate deploy`) |

Scripts de servidor: `scripts/preparar-vm.sh` (prepara a VM: Docker, firewall, fail2ban) e `scripts/gerar-env.sh` (gera o `.env` de produção com segredos novos).

O `prisma` (CLI) está em `dependencies` porque o container precisa dele para aplicar as migrations. Passo a passo de produção: [`../docs/implantacao.md`](../docs/implantacao.md).
