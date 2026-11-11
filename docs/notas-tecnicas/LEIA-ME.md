# Notas técnicas — Comunic Voz

As notas oficiais e atualizadas ficam no Projeto "Comunic - SIP" no claude.ai:

- `claude/arquitetura-comunic-voz.md` — arquitetura (extensão MV3, backend, painel, multi-tenant, segurança, roadmap)
- `claude/helena-api-notas-tecnicas.md` — API do Comunic Chat (Helena / flw.chat): auth, rate limit, contatos, equipes, conversas, webhooks, identidade via `agent/me`
- `claude/yeastar-integracao-notas-tecnicas.md` — Yeastar P-Series: API, Linkus SDK Web, eventos 30011/30012, endpoints

Documentação completa da API do Comunic Chat: `../comunic-chat-api/`
- `flwchat-openapi.json` — especificação OpenAPI 3.0 de todos os endpoints (83 caminhos)
- `flwchat-guias.md` — guias (autenticação, paginação, rate limiting, login integrado, webhooks, firewall, n8n/Make)
- `endpoints.md` — índice rápido por módulo

## Pontos da API do Comunic Chat relevantes para a telefonia
- Identificar chamador: `GET /v1/contact/phonenumber/{phone}` (ou espelho local via webhooks CONTACT_NEW / CONTACT_UPDATE)
- Registrar ligação na conversa: `POST /chat/v1/session/{id}/note` (nota interna) — localizar a conversa com `GET /v2/session?ContactId=...`
- Usuários e setores: `GET /v1/agent`, `GET /v2/department`
- Status do atendente: `POST /v1/agent/{id}/status` (ex.: marcar indisponível durante a ligação)
- Horário de atendimento: `GET /v1/company/officehours` (útil para URA / roteamento)
- Webhooks: `GET /v1/webhook/event` (lista de eventos), `POST /v1/webhook/subscription`
- Envio de áudio (ex.: gravação para o cliente): `POST /v1/send/audio`; upload via `GET /v2/file` + `POST /v2/file`
- Cards do CRM: `POST /v1/panel/card/{cardId}/note` para anotar a ligação no card


## Armadilhas já confirmadas na prática
Ver `../integracoes-helena-yeastar.md` (caixa dos campos por tipo de token, `textFilter` ignorado, `fields` em PascalCase no PUT, rate limit).
