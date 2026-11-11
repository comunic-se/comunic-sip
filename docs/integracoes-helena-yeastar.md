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
| Assinatura do SDK | `POST /openapi/v1.0/sign/create` com `{ username: <ramal>, sign_type: "sdk", expire_time }` |

### Regras
- **Máx. 8 access tokens por aplicação.** O backend guarda o token por PBX e renova com `refresh_token` (`src/yeastar.ts`).
- Linkus SDK exige firmware 83.12.0.23+ e plano Ultimate. Ativá-lo desliga o push do app Linkus Mobile oficial.
- WebRTC exige certificado HTTPS válido no PBX.
- IP Restriction da API deve incluir o IP do servidor do backend.

### Próximos passos
- **CDR:** Webhook Event Push (evento 30012) → rota no backend validando `X-Signature` (HMAC-SHA256 do corpo bruto) → tabela `calls`.
- **Assinatura finita:** `expire_time` > 0 e renovação antes do vencimento.

## SDK na extensão
`ys-webrtc-sdk-core` 1.1.0, rodando no offscreen document:
```ts
const { phone } = await init({ username: ramal, secret: assinatura, pbxURL });
phone.start();
```
