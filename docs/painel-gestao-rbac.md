# Painel de gestão e controle de acesso (RBAC)

## Como o painel é exibido
O painel abre **dentro do Comunic Chat**, como menu personalizado do tipo **Página interna** (iframe). Por isso ele não tem barra de topo, logo, nome da empresa, papel, avatar nem botão "Sair" — o Comunic Chat já mostra tudo isso. O painel exibe só o menu dos módulos e o conteúdo.

### Cadastro do menu no Comunic Chat
Em Ajustes → menus personalizados → **Novo menu personalizado**:

| Campo | Valor |
|---|---|
| Nome | ex.: `Telefonia` |
| Ícone | à escolha |
| Comportamento | **Página interna** |
| Permissões | Super Administrador e Administrador (quem gerencia ramais). Atendentes só quando houver módulos para eles |
| Categoria | Admin (ou Ajustes) |
| URL | `https://<backend>/painel` |
| Parâmetros | opcionais (Id do usuário / Id da conta) — ver abaixo |
| Contas | as empresas habilitadas no Comunic.SIP |

**As permissões do menu só escondem o item.** Quem decide o que cada pessoa vê e altera é o backend, pelo papel. Abrir a URL direto não dá mais acesso do que o papel permite.

**Parâmetros de URL (Id do usuário / Id da conta) não autenticam ninguém** — qualquer um pode alterá-los. Se usados, servem só para conferir que batem com a sessão; a identidade vem sempre da sessão captada pela extensão.

### Login
O painel pede a sessão à extensão Comunic.Chat (mensagem externa `PANEL_SESSION`), que chama `POST /v1/panel/session`. Nada é digitado ou colado. Requisitos: extensão instalada e o domínio do painel em `externally_connectable` do manifest (hoje `localhost`, `127.0.0.1` e `*.comunic.chat`). Em dev, se o ID da extensão mudou: `/painel?ext=<id>`.

Se a sessão expirar (401), o painel volta à tela de conexão e tenta de novo pela extensão.

**Acesso de emergência:** sem Comunic Chat/extensão, um SUPER_ADMIN entra com usuário + senha + código do autenticador (seção "Acesso de emergência" em `seguranca.md`). Sessão de 1 h, com aviso e botão Sair. A antiga entrada manual por token (dev) foi removida.

### Embutir só no Comunic Chat
A rota `/painel` envia `Content-Security-Policy: frame-ancestors 'self' https://*.wts.chat https://*.flw.chat`. Outro site que tente embutir o painel é bloqueado pelo navegador. Para whitelabel em outro domínio, ajuste `PANEL_FRAME_ANCESTORS`.

## Papéis
| Papel | Como é atribuído | Alcance |
|---|---|---|
| SUPER_ADMIN | tabela `platform_role` | toda a plataforma |
| PARTNER_ADMIN | tabela `platform_role` (com `partnerId`) | empresas do parceiro (whitelabel) |
| COMPANY_ADMIN | automático: perfil ADMIN no Helena | a própria empresa |
| SUPERVISOR | tabela `role_override` | o(s) departamento(s) dele |
| AGENT | padrão | só ele mesmo |

Ordem de resolução (`resolveScope` em `src/rbac.ts`): `platform_role` > `role_override` > perfil do Helena. O papel é recalculado a cada nova sessão.

## Matriz de permissões
Escopos: `all` > `partner` > `company` > `department` > `self`. "—" = sem acesso.

| Permissão | SUPER | PARTNER | COMPANY_ADMIN | SUPERVISOR | AGENT |
|---|---|---|---|---|---|
| `provision_company` | all | partner | — | — | — |
| `manage_pbx` | all | — | — | — | — |
| `manage_branding` | all | partner | — | — | — |
| `manage_roles` | all | partner | — | — | — |
| `manage_extensions` | all | partner | company | — | — |
| `view_dashboard` | all | partner | company | department | self |
| `view_cdr` | all | partner | company | department | self |
| `export_cdr` | all | partner | company | — | — |
| `play_recording` | all | partner | company | department | self |

Fonte de verdade: `MATRIX` em `src/rbac.ts`. Se divergir desta tabela, vale o código — e atualize esta página.

## Módulos
| Módulo | Permissão | Estado |
|---|---|---|
| Ramais (vincular/desvincular atendente ↔ ramal) | `manage_extensions` | **pronto** |
| Dashboard | `view_dashboard` | em breve (depende do CDR) |
| Chamadas | `view_cdr` | em breve (CDR via webhook 30012) |
| Gravações | `play_recording` | em breve |
| Empresas (cadastro, PBX, faixas, token, ativar/desativar) | `provision_company` / `manage_pbx` | **pronto** — só aparece para SUPER/PARTNER; aba PBX só para SUPER |

## Regras do módulo Empresas
- Nova empresa: ID da conta no Comunic Chat (UUID), nome, PBX, faixa inicial, token do Helena (opcional, pode ser depois) e se já nasce ativa.
- Credenciais do PBX e token do Helena são **testados antes de salvar** e ficam cifrados; a tela só mostra "Configurado"/"Pendente".
- Faixas não podem se sobrepor a faixas de outras empresas no mesmo PBX; remover faixa com ramal vinculado é recusado.
- Desativar uma empresa pede confirmação (segundo clique) e bloqueia o login integrado e o painel dela na próxima sessão. Ninguém desativa a própria empresa.
- PARTNER_ADMIN só vê e cria empresas do próprio parceiro e só usa PBXs que já atendem suas empresas.

## Regras do módulo Ramais
- Coluna **Status**: **Conectado** (extensão com o ramal registrado, sinal nos últimos 2,5 min), **Desconectado** (tem ramal, mas sem sinal — passe o mouse para ver o último sinal) e **Desvinculado** (sem ramal). Atualiza sozinha a cada 30 s.
- Só ramais dentro das faixas (`extension_range`) da empresa.
- Um ramal por usuário e um usuário por ramal dentro da empresa (restrições únicas no banco).
- Toda alteração grava `audit_log`.
