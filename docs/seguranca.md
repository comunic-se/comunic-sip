# Segurança

## Princípios
1. **Segredos ficam no servidor.** AccessID/AccessKey do Yeastar e tokens permanentes do Helena nunca vão para a extensão nem para o painel.
2. **Cifra em repouso.** Segredos no banco (chave do Linkus SDK do PBX, token permanente do Helena) são cifrados com AES-256-GCM (`src/crypto.ts`) usando `ENCRYPTION_KEY` (32 bytes em base64). Perder a chave = perder os segredos; troca de chave exige recifrar.
3. **Gate por empresa.** Só empresas cadastradas e com `active = true` recebem ramal/assinatura ou acessam o painel.
4. **Mínimo privilégio (RBAC).** Papel vindo do perfil no Comunic Chat (Super Administrador altera; Administrador só visualiza; Atendente vê só o próprio); papéis de plataforma só por script ou acesso de emergência; cada permissão pode ser ligada ou desligada por pessoa (o papel é só o padrão), com auditoria, sem autoelevação e com o master intocável. Ver `painel-gestao-rbac.md`.
5. **Auditoria.** Alterações feitas pelo painel vão para `audit_log`.

## O que nunca fazer
- Commitar `.env`, tokens, chaves ou dumps de banco. O `.gitignore` cobre `.env`; confira antes de cada commit.
- Colar tokens em chats, issues ou logs. O token permanente do Helena é gravado só via `scripts/set-helena-token.mjs` (lê da linha de comando local e grava cifrado).
- Reaproveitar a `ENCRYPTION_KEY` de dev em produção. Gere uma nova no servidor: `openssl rand -base64 32`.
- Deixar `EXTENSION_JWT_SECRET` vazio em produção (o código usa um segredo de dev como fallback — inaceitável fora da máquina local).

## Sessões e tokens
| Item | Onde vive | Validade |
|---|---|---|
| Sessão Helena captada | `chrome.storage.session` (memória do navegador) | a da sessão do Comunic Chat |
| JWT do backend | `chrome.storage.session` / memória do painel | 12 h |
| Token OpenAPI Yeastar | cache em memória no backend | 30 min, renovado com `refresh_token` (24 h). Limite de 8 tokens por app — por isso o cache |
| Assinatura do SDK | `chrome.storage.local` | `SIGN_TTL_SECONDS` (padrão 12 h). A extensão renova 15 min antes de vencer; se houver chamada em andamento, troca só ao fim dela |

## Superfície de ataque e mitigação
| Risco | Mitigação |
|---|---|
| Site malicioso pedir sessão à extensão | `externally_connectable` limitado a `localhost`, `127.0.0.1` e `*.comunic.chat`. **Pendente:** checar `sender.origin` também no handler |
| CORS aberto | `ALLOWED_ORIGINS` com negação por padrão |
| Painel embutido por site malicioso (clickjacking) | `/painel` envia `frame-ancestors` liberando só `'self'`, `*.wts.chat` e `*.flw.chat` (`PANEL_FRAME_ANCESTORS`) |
| Parâmetros do menu do Comunic Chat (Id do usuário/conta) adulterados | não são usados para autenticar; a identidade vem só da sessão validada no Helena |
| Acesso direto à URL do painel, fora do menu | o backend aplica o RBAC em toda rota; as permissões do menu só escondem o item |
| Abuso da API Helena | retry com espera em 429; rate limit do Helena é 1000 req / 5 min |
| Token Yeastar esgotado | cache + refresh em vez de `get_token` por requisição |
| Usuário de outra empresa ver dados | todas as consultas filtram por `companyId` resolvido do papel; SUPER/PARTNER têm escopo explícito |

## Produção — checklist
- [ ] HTTPS no proxy reverso, só ele exposto em 80/443.
- [ ] Postgres sem porta publicada (ou só `127.0.0.1`).
- [ ] `ENCRYPTION_KEY` e `EXTENSION_JWT_SECRET` novos, guardados no cofre (Vaultwarden).
- [ ] `ALLOWED_ORIGINS` com o domínio real do painel.
- [ ] `PANEL_FRAME_ANCESTORS` revisado (domínios do Comunic Chat/whitelabel).
- [ ] `TRUST_PROXY=true` atrás do proxy.
- [ ] Backup do banco cifrado e testado.

## Acesso de emergência (SUPER_ADMIN com senha + autenticador)
Para manutenção quando o Comunic Chat ou a extensão estiverem fora do ar. Abra `<backend>/painel` direto no navegador → **Acesso de emergência** → usuário, senha e código de 6 dígitos do app autenticador.

| Item | Como funciona |
|---|---|
| Criação | **Só por script no servidor**: `node scripts/admin-emergencia.mjs criar <usuario> <companyId>` (no container: `docker compose exec api node scripts/admin-emergencia.mjs …`). Não existe tela nem rota para criar conta |
| Senha | Digitada sem eco no script; mín. 14 caracteres com maiúscula, minúscula e número; guardada em **hash Argon2id** |
| Autenticador | TOTP de 6 dígitos / 30 s (Vaultwarden, Google Authenticator, Authy…). A chave é mostrada **uma vez** pelo script; no banco fica **cifrada** (AES-256-GCM), porque precisa ser lida para validar |
| Proteções | Erro genérico (não revela se o usuário existe; tempo de resposta igual); bloqueio da conta por 15 min após 5 falhas; limite de 10 tentativas por IP a cada 15 min; o mesmo código não serve duas vezes |
| Sessão | Papel SUPER_ADMIN, **1 h** de validade, aviso amarelo "Sessão de emergência" com **Sair** no painel |
| Auditoria | `audit_log`: `emergency_login_ok`, `emergency_login_fail` (com motivo e IP), `emergency_login_ratelimited`, e criação/reset/ativação pelo script |
| Manutenção | `resetar <usuario>` (nova senha e novo autenticador, desbloqueia), `desativar`/`ativar <usuario>`, `listar` |

Guarde usuário, senha e o TOTP no Vaultwarden. Se o celular/cofre for perdido, rode `resetar` no servidor.

## Riscos aceitos
| Item | Por que foi aceito | Quando rever |
|---|---|---|
| `npm audit`: 3 alertas altos — na verdade um só, `deepmerge-ts` < 8 ([GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)), via `prisma` → `@prisma/config` | Afeta só a leitura de arquivos de configuração pela CLI do Prisma (ex.: `migrate deploy`), com arquivos nossos. Nenhuma entrada de usuário chega lá; a API em execução não usa esse código. A correção exige Prisma 7 (versão maior, com mudanças de CLI) | Na migração planejada para Prisma 7 |
- [ ] PBX com certificado válido (WebRTC exige) e IP Restriction da API incluindo o IP do servidor.
