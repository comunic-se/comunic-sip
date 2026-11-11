# API do backend

Base em dev: `http://localhost:8787`. Respostas em JSON. Rotas protegidas exigem `Authorization: Bearer <JWT>` — o JWT é emitido pelo próprio backend (validade **12 h**) nas rotas de sessão abaixo.

Erros seguem o formato `{ "error": "mensagem legível" }`. O backend não devolve tokens nem detalhes internos nas mensagens.

## Público

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | `{ "ok": true }` |
| GET | `/painel` | Página do painel. Responde com `Content-Security-Policy: frame-ancestors …` para só poder ser embutida pelo Comunic Chat (ver `PANEL_FRAME_ANCESTORS`) |
| GET | `/logo-comunic.svg` | Logo usado na tela de conexão do painel |

## Sessão

Nas duas rotas o corpo é `{ "helenaToken": "<sessão do Comunic Chat>" }`. O backend valida a sessão em `GET /core/v1/agent/me` do Helena, aplica o **gate** (empresa cadastrada e `active`) e resolve o papel do usuário.

### `POST /v1/auth/extension` — login integrado da extensão
**200**
```json
{
  "token": "<JWT>",
  "role": "AGENT",
  "user": { "userId": "...", "companyId": "...", "name": "..." },
  "extension": "4004",
  "pbxUrl": "https://pbx.exemplo.com:8088",
  "sign": "<assinatura do Linkus SDK>"
}
```
| Código | Quando |
|---|---|
| 400 | `helenaToken` ausente |
| 401 | sessão do Comunic Chat inválida |
| 403 | empresa não habilitada no Comunic.SIP |
| 404 | usuário sem ramal vinculado |
| 500 | empresa sem PBX configurado |
| 502 | falha ao gerar a assinatura no Yeastar |

### `POST /v1/panel/session` — sessão do painel
Mesma validação, sem exigir ramal.
```json
{
  "token": "<JWT>",
  "role": "COMPANY_ADMIN",
  "scope": { "companyId": "...", "partnerId": null, "departmentIds": [] },
  "company": { "id": "...", "name": "..." }
}
```

### `GET /v1/me` (JWT)
Devolve o conteúdo do JWT atual: `{ "user": { ... } }`.

## Painel — ramais (JWT + permissão `manage_extensions`)

SUPER_ADMIN e PARTNER_ADMIN podem passar `companyId` (corpo ou query) para agir em outra empresa do seu escopo; os demais agem só na própria. Fora do escopo → **403**.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/v1/panel/users` | Agentes da empresa (lidos do Helena com o token permanente) e o ramal vinculado de cada um |
| GET | `/v1/panel/ranges` | Faixas de ramal da empresa |
| POST | `/v1/panel/extensions` | Vincula `{ helenaUserId, extension, companyId? }`. Se o usuário já tem ramal, troca. **400** se o ramal estiver fora das faixas da empresa. O banco impede o mesmo ramal para dois usuários da empresa |
| DELETE | `/v1/panel/extensions/:helenaUserId` | Desvincula (`?companyId=` opcional) |

Vincular e desvincular gravam `audit_log` (`extension_link` / `extension_unlink`, com autor e payload).

## Contatos (JWT)

Usam o **token permanente da empresa** (gravado com `scripts/set-helena-token.mjs`). Sem ele → **400**.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/v1/contacts?query=` | Busca por nome; com dígitos, busca por telefone. Resposta `{ items: [...] }` |
| POST | `/v1/contacts` | Cria `{ name, phoneNumber, email? }` (nome e telefone obrigatórios) |
| PUT | `/v1/contacts/:id` | Edita os mesmos campos |

Não existe remoção (regra de negócio; a API do Helena também não oferece). Telefone normalizado para `55DDDNUMERO`. Falha no Helena → **502**.

## CORS
Só as origens em `ALLOWED_ORIGINS` (separadas por vírgula). Vazio = nega chamadas de outras origens. A extensão não depende de CORS (usa permissão de host) e o painel é servido pelo próprio backend.
