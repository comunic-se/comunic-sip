# Comunic Chat (Helena / flw.chat) — índice de endpoints

Fonte: https://flwchat.readme.io (extraído em 09/11/2026). Spec completa: `flwchat-openapi.json`.

- Base: `https://api.wts.chat/core`
- Auth: `Authorization: Bearer pn_...` (Ajustes > Integrações > Integração via API)
- Rate limit: 1.000 req / 5 min por conta, burst 200 req / 5 s (429 ao exceder)
- Paginação: pageNumber / pageSize (máx. 100)


## Arquivos

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v2/file` | Obter url para upload |
| POST | `/v2/file` | Salvar arquivo |

## Campos

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v1/custom-field` | Listar |

## Carteiras

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v1/portfolio` | Listar |
| GET | `/v1/portfolio/{id}/contact` | Listar contatos |
| POST | `/v1/portfolio/{id}/contact` | Adicionar contato |
| DELETE | `/v1/portfolio/{id}/contact` | Remover contato |
| POST | `/v1/portfolio/{id}/contact/batch` | Adicionar contatos |
| DELETE | `/v1/portfolio/{id}/contact/batch` | Remover contatos |

## Contatos

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v1/contact` | Listar |
| POST | `/v1/contact` | Criar |
| POST | `/v1/contact/filter` | Filtrar |
| GET | `/v1/contact/phonenumber/{phone}` | Obter por Número de telefone |
| PUT | `/v1/contact/phonenumber/{phone}` | Atualizar por Número de telefone |
| GET | `/v1/contact/{id}` | Obter por ID |
| PUT | `/v2/contact/{id}` | Atualizar |
| POST | `/v1/contact/phonenumber/{phone}/tags` | Atualizar etiquetas por Número de telefone |
| POST | `/v1/contact/{id}/tags` | Atualizar etiquetas |
| POST | `/v2/contact/batch` | Salvar em massa |
| GET | `/v1/contact/custom-field` | Campos personalizados |

## Equipes

| Método | Caminho | Descrição |
|---|---|---|
| POST | `/v1/department` | Criar |
| GET | `/v2/department` | Listar |
| GET | `/v1/department/{id}` | Obter por ID |
| PUT | `/v1/department/{id}` | Atualizar |
| DELETE | `/v1/department/{id}` | Excluir |
| PUT | `/v1/department/{id}/agents` | Atualizar usuários |
| GET | `/v1/department/{id}/channel` | Listar canais |

## Etiquetas

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v1/tag` | Listar |
| POST | `/v1/tag` | Criar |
| GET | `/v1/tag/color` | Listar cores |
| PUT | `/v1/tag/{id}` | Atualizar |
| DELETE | `/v1/tag/{id}` | Excluir |

## Horários de Atendimento

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v1/company/officehours` | Obter |

## Usuários

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v1/agent` | Listar |
| POST | `/v1/agent` | Criar |
| GET | `/v1/agent/{id}` | Obter por ID |
| PUT | `/v1/agent/{id}` | Atualizar |
| DELETE | `/v1/agent/{id}` | Excluir |
| POST | `/v1/agent/{id}/departments` | Atualizar equipes |
| POST | `/v1/agent/{id}/status` | Alterar status |
| POST | `/v1/agent/{id}/logout` | Fazer logout |

## Webhooks

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v1/webhook/event` | Listar eventos |
| GET | `/v1/webhook/subscription` | Listar assinaturas |
| POST | `/v1/webhook/subscription` | Cria assinatura |
| GET | `/v1/webhook/subscription/{subscriptionId}` | Busca assinatura por ID |
| PUT | `/v1/webhook/subscription/{subscriptionId}` | Atualiza assinatura |
| DELETE | `/v1/webhook/subscription/{subscriptionId}` | Remove assinatura |

## Canais de Atendimento

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v1/channel` | Listar |

## Chatbots

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v1/chatbot` | Listar |
| POST | `/v1/chatbot/send` | Enviar chatbot |

## Conversas

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v2/session` | Listar |
| GET | `/v2/session/{id}` | Obter por ID |
| PUT | `/v1/session/{id}/transfer` | Transferir |
| PUT | `/v1/session/{id}/assignee` | Atribuir usuário |
| PUT | `/v1/session/{id}/complete` | Concluir |
| PUT | `/v1/session/{id}/status` | Alterar status |
| PUT | `/v2/session/{id}/partial` | Alterar |
| GET | `/v1/session/{id}/message` | Listar mensagens |
| POST | `/v1/session/{id}/message` | Enviar mensagem |
| POST | `/v1/session/{id}/message/sync` | Enviar mensagem síncrona |
| POST | `/v1/session/{id}/note` | Salvar nota interna |
| GET | `/v1/session/{id}/note` | Listar notas internas |
| GET | `/v1/session/note/{id}` | Obter uma nota interna |
| DELETE | `/v1/session/note/{id}` | Excluir uma nota interna |

## Envios (Msg/Otp/Bot)

| Método | Caminho | Descrição |
|---|---|---|
| POST | `/v1/send/otp` | OTP |
| GET | `/v1/send/otp/{id}` | OTP status |
| POST | `/v1/send/text` | Texto |
| POST | `/v1/send/audio` | Áudio |
| POST | `/v1/send/video` | Vídeo |
| POST | `/v1/send/image` | Imagem |
| POST | `/v1/send/document` | Documento |
| GET | `/v1/send/message/{id}` | Mensagem status |
| POST | `/v1/send/template` | Modelo |
| POST | `/v1/send/template/batch` | Modelo (em lote) |
| POST | `/v1/send/typing` | Digitando |
| POST | `/v1/send/chatbot` | Chatbot |
| GET | `/v1/send/chatbot/{id}` | Chatbot status |
| POST | `/v1/send/chatbot/batch` | Chatbot (em lote) |

## Mensagens

| Método | Caminho | Descrição |
|---|---|---|
| POST | `/v1/message/send` | Enviar |
| POST | `/v1/message/send-sync` | Enviar síncrono |
| GET | `/v1/message/{id}` | Obter por ID |
| DELETE | `/v1/message/{id}` | Excluir mensagem |
| GET | `/v1/message/{id}/status` | Obter status por ID |
| GET | `/v1/message` | Listar |

## Mensagens Agendadas

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v1/scheduled-message` | Listar |
| POST | `/v1/scheduled-message` | Criar |
| GET | `/v1/scheduled-message/{id}` | Obter por ID |
| PUT | `/v1/scheduled-message/{id}` | Atualizar |
| POST | `/v1/scheduled-message/{id}/cancel` | Cancelar |
| POST | `/v1/scheduled-message/batch-cancel` | Cancelar em massa |

## Modelos de Mensagem

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v1/template` | Listar |

## Sequências

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v1/sequence` | Listar |
| GET | `/v2/sequence/{id}/contact` | Listar contatos |
| POST | `/v1/sequence/{id}/contact` | Adicionar contato |
| DELETE | `/v1/sequence/{id}/contact` | Remover contato |
| POST | `/v1/sequence/{id}/contact/batch` | Adicionar contatos |
| DELETE | `/v1/sequence/{id}/contact/batch` | Remover contatos |

## Cards

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v2/panel/card` | Listar |
| POST | `/v2/panel/card` | Criar |
| GET | `/v2/panel/card/{id}` | Obter por ID |
| PUT | `/v3/panel/card/{id}` | Atualizar |
| POST | `/v2/panel/card/{id}/duplicate` | Duplicar |
| GET | `/v1/panel/card/{cardId}/note` | Listar anotações |
| POST | `/v1/panel/card/{cardId}/note` | Adicionar anotação |
| DELETE | `/v1/panel/card/{cardId}/note/{noteId}` | Remover anotação |

## Painéis

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/v2/panel` | Listar painéis |
| GET | `/v1/panel/{id}` | Obter por ID |
| GET | `/v1/panel/{id}/custom-fields` | Campos personalizados |
| GET | `/v1/panel/{id}/lost-reason` | Listar motivos de perda |
