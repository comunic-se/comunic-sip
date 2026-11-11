# Habilitar uma nova empresa

Hoje o provisionamento é feito por scripts (o módulo Empresas do painel está planejado). Os scripts ficam em `comunic-sip-backend/scripts/`.

## 1. Dados necessários
- ID da empresa no Helena (aparece em `/core/v1/agent/me` de qualquer usuário dela).
- PBX que atenderá: URL (com porta) e AccessID/AccessKey do Linkus SDK (Integrations > Linkus SDK). Se o PBX já está cadastrado (ex.: atende outra empresa), reaproveite o registro.
- Faixa de ramais reservada para a empresa (ex.: 4100–4199).
- Token permanente do Helena da empresa.

## 2. Cadastrar PBX, empresa e faixa
Use `scripts/seed-comunic.mjs` como modelo: copie para `scripts/seed-<empresa>.mjs` e ajuste os IDs fixos (PBX, empresa com `active: true`, faixa e, se quiser, o primeiro vínculo). O PBX é lido de `PBX_BASE_URL`, `SDK_ACCESS_ID` e `SDK_ACCESS_KEY` do `.env`, e a chave é cifrada com `ENCRYPTION_KEY` antes de gravar. O script é idempotente.

> Provisionamento pelo painel (módulo Empresas) está planejado e vai substituir este passo.
```bash
node scripts/seed-<empresa>.mjs
```

## 3. Gravar o token permanente do Helena
```bash
node scripts/set-helena-token.mjs <companyId> <token>
```
O token é cifrado antes de ir para o banco. Rode no servidor; não cole o token em chats nem o deixe no histórico do shell (`HISTCONTROL=ignorespace` e um espaço antes do comando ajudam).

## 4. Vincular ramais
1. No Comunic Chat da empresa, cadastre o menu personalizado do painel (ver `painel-gestao-rbac.md`).
2. Pelo painel → Ramais, logado como admin da empresa (perfil ADMIN no Helena) ou SUPER/PARTNER, vincule cada atendente a um ramal da faixa.

## 5. Testar
1. Um atendente vinculado abre o Comunic Chat com a extensão → o ramal deve registrar.
2. Ligação de teste e chamada recebida.
3. Aba Contatos: buscar um contato existente (não criar contatos reais só para teste).

## Desabilitar
`active = false` na empresa bloqueia login integrado e painel imediatamente na próxima sessão.
