# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Não lançado]

### Adicionado
- **Backend multi-tenant** (Fastify 5 + Prisma 6 + Postgres 16): empresas, PBX, faixas de ramal, vínculos, papéis e auditoria.
- **Login integrado:** a extensão capta a sessão do Comunic Chat; o backend valida no Helena, aplica o gate de empresa e devolve ramal + assinatura do SDK.
- **RBAC multinível:** SUPER_ADMIN, PARTNER_ADMIN, COMPANY_ADMIN, SUPERVISOR, AGENT com escopos all/partner/company/department/self.
- **Painel de gestão** (`/painel`) com login pela extensão e módulo Ramais (vincular/desvincular), feito para abrir dentro do Comunic Chat (menu "Página interna"); só pode ser embutido pelos domínios do Comunic Chat (`frame-ancestors`).
- **Contatos na extensão:** buscar, criar e editar (nome, telefone, e-mail) via backend com token permanente da empresa.
- Toque de chamada recebida e notificação com Atender/Recusar.
- Segredos cifrados com AES-256-GCM; cache de token OpenAPI do Yeastar com refresh.
- Documentação em `docs/`.

### Alterado
- **Docker (opção A):** compose de produção sem Caddy, Postgres sem porta publicada, API só em `127.0.0.1`, limites de memória e senha do banco obrigatória; `docker-compose.dev.yml` para o Postgres de dev e `docker-compose.proxy.yml` para proxy em container. `Dockerfile` gera o client do Prisma, inclui painel e scripts, roda como usuário `node`, tem healthcheck e aplica as migrations ao subir.
- Extensão renomeada para **Comunic.Chat**, com ícones e logo oficiais.
- Popup redesenhado no padrão visual do Comunic Chat (320×420, sem rolagem no teclado e nas telas de chamada).
- Postgres de dev na porta `5433` (a 5432 costuma estar ocupada).

### Removido
- `Caddyfile` e o serviço `caddy` (o TLS fica no proxy existente do host).
- Rota de depuração `/v1/sip/signature` e o mapeamento fixo de ramais por variável de ambiente.

### Corrigido
- Telefone vazio nos contatos (diferença de caixa `phoneNumber`/`phonenumber` no Helena).
- Busca de contatos ignorada (`textFilter` não funciona; usar `name`/`phoneNumber`).
- Elementos com `hidden` aparecendo no popup (CSS `display` sobrescrevendo).
