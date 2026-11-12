# Integrações: Helena e Yeastar

## Helena (Comunic Chat)
Base: `https://api.wts.chat` (mesma API atende `flw.chat`).

| Uso | Endpoint | Token |
|---|---|---|
| Quem é o usuário da sessão | `GET /core/v1/agent/me` | sessão do navegador |
| Agentes da empresa (painel) | `GET /core/v1/agent?pageNumber=&pageSize=100` | permanente da empresa |
| Buscar contatos | `POST /core/v1/contact/filter` | permanente |
| Criar / editar contato | `POST /core/v1/contact` · `PUT /core/v1/contact/{id}` | permanente |

### Armadilhas (já tratadas no código)
- **Caixa dos campos muda com o tipo de token:** com token permanente vem `phoneNumber`/`phoneNumberFormatted`; com sessão vem `phonenumber`. Leia os dois.
- **`textFilter` é ignorado** em `/contact/filter`. Use `name` ou `phoneNumber`.
- **PUT exige `fields` em PascalCase:** `["Name","PhoneNumber","Email"]`; sem isso os campos não são atualizados.
- Telefone no formato `55DDDNUMERO` (sem `+`).
- **Rate limit:** 1000 requisições / 5 min → o cliente (`helena-admin.ts`) espera e tenta de novo em 429.
- Não há DELETE de contatos.
- Nota de sessão: `/chat/v1/session/{id}/note`.

## Yeastar P-Series (Software Edition)
Base: `https://<pbx>:<porta-do-portal>` (padrão 8088). Header `User-Agent` obrigatório.

| Uso | Endpoint |
|---|---|
| Token OpenAPI | `POST /openapi/v1.0/get_token` / `refresh_token` — com o **AccessID/AccessKey do Linkus SDK** (Integrations > Linkus SDK), guardados no registro `pbx` |
| Assinatura do SDK | `POST /openapi/v1.0/sign/create` com `{ username: <ramal>, sign_type: "sdk", expire_time }`. **`expire_time` é o instante de expiração em epoch (segundos), não uma duração**; `0` = nunca expira (não usamos) |

### Regras
- **Máx. 8 access tokens por aplicação.** O backend guarda o token por PBX e renova com `refresh_token` (`src/yeastar.ts`).
- Linkus SDK exige firmware 83.12.0.23+ e plano Ultimate. Ativá-lo desliga o push do app Linkus Mobile oficial.
- WebRTC exige certificado HTTPS válido no PBX.
- IP Restriction da API deve incluir o IP do servidor do backend.

### Coleta de chamadas (CDR) — `src/cdr-sync.ts`
- **Credencial:** Client ID/Secret da **OpenAPI** (Integrations → API), diferente do AccessID/AccessKey do Linkus SDK. Fica cifrada no registro `pbx`. Exige acesso remoto à API pela FQDN e o IP do backend na IP Restriction.
- **Como:** a cada `CDR_SYNC_INTERVAL_S` (padrão 120 s) o backend lê `GET /openapi/v1.0/cdr/list?sort_by=id&order_by=desc` página a página até encontrar uma chamada já gravada; na primeira vez vai até `CDR_BACKFILL_DAYS` (padrão 30). Idempotente por `(pbx_id, uid)`.
- **Empresa da chamada:** pelo ramal dono (saída = quem ligou; entrada = quem recebeu; interna = quem ligou, com a outra ponta guardada) dentro das **faixas** do PBX; sem ramal (ex.: fila), pelo **DID** em `did_route`; sem nada, fica sem empresa (só o master vê).
- **Atendente:** vínculo ramal → usuário **no momento da coleta** (trocar o vínculo depois não reescreve o histórico).
- **Horário:** usa `timestamp` quando vem; senão interpreta `time` no fuso `PBX_TIMEZONE_OFFSET` (padrão `-03:00`).
- **SDK não serve para isso:** o `cdrQuery` do Linkus SDK só traz o histórico do próprio ramal e não tem gravações.
- Status no painel: Empresas → PBX → coluna "Coleta de chamadas" e botão **Sincronizar**.

### Próximos passos
- **Tempo real (opcional, produção):** Webhook Event Push (evento 30012) validando `X-Signature` (HMAC-SHA256 do corpo bruto), somando-se à coleta periódica.
- **Gravações:** `recording/list` + `recording/download` via proxy autenticado no backend.

## SDK na extensão
`ys-webrtc-sdk-core` 1.1.0, rodando no offscreen document:
```ts
const { phone } = await init({ username: ramal, secret: assinatura, pbxURL });
phone.start();
```
