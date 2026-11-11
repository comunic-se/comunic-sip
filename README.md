# Comunic.SIP

Telefonia integrada ao **Comunic Chat** (plataforma Helena / wts.chat / flw.chat) usando o PBX **Yeastar P-Series** e o **Linkus SDK**.

O agente usa um softphone que vive no navegador — a extensão **Comunic.Chat** para Chrome e Edge — e o gestor administra ramais e acessos por um **painel web** que abre dentro do próprio Comunic Chat (menu personalizado "Página interna"). Um **backend** faz a ponte segura entre o Comunic Chat, o PBX e o banco de dados.

Produto multi-empresa (multi-tenant) e preparado para whitelabel: hoje atende a Comunic e os clientes em `comunic.wts.chat` / `comunic.flw.chat`; a meta é qualquer empresa do Helena CRM.

## O que já funciona

| Área | Funcionalidade |
|---|---|
| Softphone (extensão) | Registro automático do ramal ao abrir o Comunic Chat ("login integrado"), ligar, receber (com toque e notificação), mudo, espera, DTMF, transferência cega e assistida, histórico de chamadas |
| Contatos (extensão) | Buscar por nome ou número, criar e editar (nunca remover), ligar para o contato |
| Painel de gestão | Abre dentro do Comunic Chat, entrada automática pela extensão (sem senha), vínculo usuário → ramal com validação de faixa |
| Segurança | Login validado no backend, controle de acesso por papel (RBAC multinível), segredos cifrados no banco, nenhum segredo no navegador |

Em construção: provisionamento de empresas pelo painel, ingestão de CDR (Dashboard, Chamadas, Gravações), deploy em produção. Detalhes em [`CHANGELOG.md`](CHANGELOG.md) e nas limitações de [`docs/arquitetura.md`](docs/arquitetura.md).

## Estrutura do repositório

```
softphone-extension/   Extensão MV3 "Comunic.Chat" (Chrome/Edge): softphone + contatos
comunic-sip-backend/   API (Node 20 + Fastify + Prisma/Postgres): auth, RBAC, assinatura do SDK, painel
design-system/         Tokens e overrides de UI herdados do Comunic Chat
docs/                  Arquitetura, segurança, API, implantação, replicação, integrações
mockups/               Protótipos de tela
```

Cada parte tem seu próprio guia:
- [`comunic-sip-backend/README.md`](comunic-sip-backend/README.md) — como rodar, variáveis de ambiente, scripts, banco.
- [`softphone-extension/README.md`](softphone-extension/README.md) — como buildar, carregar e como a extensão funciona por dentro.

## Comece por aqui (ambiente de desenvolvimento)

Pré-requisitos: Node 20+, Docker Desktop, Git. No Windows, `docs/setup-ambiente-dev.ps1` instala tudo.

```powershell
# 1. Backend + banco
cd comunic-sip-backend
npm install
copy .env.example .env          # e preencha (veja o README do backend)
docker compose up -d db         # Postgres em 127.0.0.1:5433
npx prisma migrate deploy       # cria as tabelas
node scripts/seed-comunic.mjs   # PBX, empresa piloto, ramal e SUPER_ADMIN
npm run dev                     # API em http://localhost:8787

# 2. Extensão
cd ..\softphone-extension
npm install
npm run build                   # gera dist/
```
Depois: `chrome://extensions` → Modo do desenvolvedor → **Carregar sem compactação** → pasta `softphone-extension/dist`. Nas Configurações da extensão, ative o login integrado com `http://localhost:8787` e abra o Comunic Chat — o ramal registra sozinho.

Painel de gestão: `http://localhost:8787/painel` (entra pela extensão). Em produção ele é aberto pelo menu personalizado do Comunic Chat.

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/arquitetura.md](docs/arquitetura.md) | Componentes, fluxos (login, chamada, contatos, painel), decisões, limitações |
| [docs/api-backend.md](docs/api-backend.md) | Referência de todos os endpoints do backend |
| [docs/seguranca.md](docs/seguranca.md) | Princípios, tokens e validades, riscos e mitigações, checklist de produção |
| [docs/painel-gestao-rbac.md](docs/painel-gestao-rbac.md) | Painel no iframe do Comunic Chat (cadastro do menu), papéis, matriz de permissões |
| [docs/integracoes-helena-yeastar.md](docs/integracoes-helena-yeastar.md) | Como integramos com Helena e Yeastar, armadilhas conhecidas |
| [docs/implantacao.md](docs/implantacao.md) | Subir a plataforma num servidor (VPS) |
| [docs/replicacao-nova-empresa.md](docs/replicacao-nova-empresa.md) | Habilitar uma nova empresa (tenant) |
| [docs/notas-tecnicas/LEIA-ME.md](docs/notas-tecnicas/LEIA-ME.md) · [docs/comunic-chat-api/](docs/comunic-chat-api/) | Referência da API do Comunic Chat |
| [docs/escopo-comunic-sip-v1.md](docs/escopo-comunic-sip-v1.md) · [docs/equipe-comunic-sip.md](docs/equipe-comunic-sip.md) | Escopo da v1 e equipe |

## Equipe
Pedro Lucena, Rafael Diniz, Poliana Santos, Guilherme Zullo — Comunic.se.
