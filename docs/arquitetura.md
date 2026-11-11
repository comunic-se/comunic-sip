# Arquitetura — Comunic.SIP

Telefonia dentro do Comunic Chat (Helena: `wts.chat` / `flw.chat`) usando o PABX Yeastar P-Series e o Linkus SDK para Web.

## Visão geral

```
 Navegador do atendente                         Servidor Comunic.SIP                 Terceiros
 ┌───────────────────────────────┐             ┌──────────────────────────┐
 │ Comunic Chat (Helena)         │──Bearer────▶│                          │──────▶ Helena API
 │   (webRequest capta a sessão) │             │  comunic-sip-backend     │       (valida sessão,
 │                               │             │  Fastify + Prisma        │        agentes, contatos)
 │ Extensão Comunic.Chat (MV3)   │──HTTPS─────▶│                          │
 │   background (service worker) │◀─ramal+sign─│  Postgres 16             │──────▶ Yeastar OpenAPI
 │   offscreen (Linkus SDK) ─────┼──WebRTC/WSS─┼──────────────────────────┼──────▶ PBX (SIP/WebRTC)
 │   popup (UI)                  │             │  Painel de gestão        │
 │                               │             │  (/painel, HTML estático)│
 │ Painel (aba) ──externally_────┘             └──────────────────────────┘
 │             connectable
 └───────────────────────────────┘
```

## Componentes

| Componente | Pasta | Responsabilidade |
|---|---|---|
| Extensão | `softphone-extension/` | Softphone no navegador; capta a sessão do Comunic Chat; UI de teclado, contatos, histórico |
| Backend | `comunic-sip-backend/` | Valida sessão no Helena, aplica gate de empresa e RBAC, emite assinatura do SDK, guarda segredos cifrados, serve o painel |
| Banco | Postgres (docker) | Empresas, PBX, faixas de ramal, vínculos, papéis, auditoria |
| Painel | `comunic-sip-backend/public/painel.html` | Gestão de ramais (e, em breve, dashboard, chamadas, gravações, empresas). Exibido **dentro do Comunic Chat** como menu "Página interna" (iframe) |

## Fluxos principais

### 1. Login integrado (ramal sem senha)
1. O atendente abre o Comunic Chat. A extensão observa (via `chrome.webRequest`) as requisições para `api.wts.chat`/`api.flw.chat` e guarda o `Authorization: Bearer` em `chrome.storage.session`.
2. O background chama `POST /v1/auth/extension` no backend com essa sessão.
3. O backend consulta o Helena (`/core/v1/agent/me`), descobre usuário e empresa, aplica o **gate** (empresa cadastrada e ativa) e procura o vínculo usuário→ramal.
4. Com o vínculo, pede ao Yeastar uma **assinatura** (`sign/create`, `sign_type: sdk`) para o ramal e devolve `{ token, role, user, extension, pbxUrl, sign }` (JWT de 12 h).
5. O offscreen inicia o SDK (`init` → `phone.start()`) e o ramal registra.

Credenciais do Yeastar (AccessID/AccessKey) **nunca** saem do servidor.

### 2. Chamada
O offscreen recebe eventos do SDK (`incoming`, `startSession`, `deleteSession`…) e repassa ao background, que atualiza o popup e as notificações. Áudio remoto: `session.remoteStream` num `<audio>` do offscreen. Toque de chamada recebida: WebAudio no offscreen.

### 3. Contatos
Popup → background (`CONTACTS_SEARCH`/`CONTACT_SAVE`) → backend `/v1/contacts` com o JWT → Helena com o **token permanente da empresa** (cifrado no banco). Não usa a sessão do navegador, que expira e gerava erro 500.

### 4. Painel de gestão
O gestor clica no menu personalizado do Comunic Chat, que abre `/painel` num iframe. A página pede à extensão (mensagem externa `PANEL_SESSION`) uma sessão; a extensão chama `POST /v1/panel/session` com a sessão captada e devolve o JWT ao painel. Nenhum token é colado manualmente. O backend só permite que a página seja embutida pelos domínios do Comunic Chat (`frame-ancestors`).

## Decisões
- **Backend próprio em vez de chamar o Yeastar da extensão:** segredo do PBX fica no servidor; o gate por empresa é aplicado em um só lugar.
- **Offscreen document:** o service worker do MV3 não tem DOM nem WebRTC; o offscreen mantém a chamada viva com o popup fechado.
- **Token permanente por empresa para contatos:** estável e independente da sessão do atendente; guardado com AES-256-GCM.
- **Multi-tenant desde o início:** tudo é ligado a `company`; um PBX pode atender várias empresas por faixas de ramal.
- **Deploy (opção A):** a stack Comunic.SIP roda separada (API + Postgres próprios) atrás do proxy reverso já existente no host. Ver `implantacao.md`.

## Limitações conhecidas
- Assinatura do SDK criada com `expire_time: 0` (não expira). Planejado: validade finita + renovação.
- `Dockerfile` ainda não gera o client do Prisma (ver `implantacao.md`).
- CDR para o dashboard ainda não é coletado (planejado via Webhook Event Push, evento 30012).
- Provisionamento de empresa/PBX pelo painel ainda não existe (feito por scripts).
