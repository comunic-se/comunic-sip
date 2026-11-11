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
docker compose up -d db     # só o Postgres, em 127.0.0.1:5433
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
| `PANEL_FRAME_ANCESTORS` | não | Quem pode embutir o `/painel` em iframe. Padrão `'self' https://*.wts.chat https://*.flw.chat` |
| `PBX_BASE_URL`, `SDK_ACCESS_ID`, `SDK_ACCESS_KEY` | só p/ o seed | Usadas **apenas** por `scripts/seed-comunic.mjs` para cadastrar o PBX no banco (a chave vai cifrada). A API em si lê o PBX do banco. |
| `DB_PASSWORD` | não | Senha do Postgres do `docker-compose` (padrão `comunic`) |

## Scripts de operação (`scripts/`)

| Script | Uso |
|---|---|
| `seed-comunic.mjs` | Prepara o piloto: registra o PBX (chave cifrada), cria a empresa Comunic.se ativa, faixa de ramais 4000–4099, vincula o Pedro ao ramal 4004 e o marca como `SUPER_ADMIN`. Idempotente (pode rodar de novo). Os IDs do piloto estão fixos no arquivo. |
| `set-helena-token.mjs <companyId> <token>` | Grava, cifrado, o token permanente da API Helena (`pn_...`) de uma empresa. Necessário para listar usuários no painel e para a aba Contatos. Rode no terminal: o token não deve passar por chat, e-mail ou commit. |
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
| `yeastar.ts` | Token da API Yeastar (cacheado e renovado) e `sign/create` do Linkus SDK |
| `crypto.ts` | Cifra/decifra segredos (AES-256-GCM) |
| `db.ts` | Cliente Prisma |
| `routes-panel.ts` | Painel: página `/painel` (com `frame-ancestors`), logo, usuários, faixas e vínculo de ramais |
| `routes-contacts.ts` | Contatos (`/v1/contacts`) |

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
| `audit_log` | Ações sensíveis (vínculo/desvínculo de ramal, …) |
| `calls`, `contacts_cache`, `did_route` | Reservadas para a ingestão de CDR e espelho de contatos (ainda não usadas) |

Alterar o schema:
```powershell
npx prisma migrate dev --name descricao-da-mudanca   # gera a migration e aplica
npx prisma generate                                  # atualiza o client
```
> O projeto fixa o **Prisma 6**. O Prisma 8 mudou a CLI (`migrate dev` foi substituído); não atualize sem planejar a migração.

## Docker

`docker-compose.yml` tem três serviços: `db` (Postgres, só em `127.0.0.1:5433`), `api` e `caddy` (perfil `prod`). Para produção leia [`../docs/implantacao.md`](../docs/implantacao.md) — há pendências conhecidas (Prisma e `public/` no `Dockerfile`, remoção do Caddy pela opção A, exposição de portas) listadas lá.
