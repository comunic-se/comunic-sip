# Habilitar uma nova empresa

O cadastro é feito pelo painel (módulo **Empresas**). Os scripts em `comunic-sip-backend/scripts/` continuam disponíveis como alternativa.

## 1. Dados necessários
- ID da empresa no Helena (aparece em `/core/v1/agent/me` de qualquer usuário dela).
- PBX que atenderá: URL (com porta) e AccessID/AccessKey do Linkus SDK (Integrations > Linkus SDK). Se o PBX já está cadastrado (ex.: atende outra empresa), reaproveite o registro.
- Faixa de ramais reservada para a empresa (ex.: 4100–4199).
- Token permanente do Helena da empresa.

## 2. Cadastrar pelo painel (recomendado)
Logado como SUPER_ADMIN (ou PARTNER_ADMIN, para empresas do seu parceiro), abra o painel → **Empresas**:
1. Se o PBX ainda não existe: aba **PBX** → **Novo PBX** (nome, URL `https://…:porta`, AccessID e AccessKey do Linkus SDK). As credenciais são testadas antes de salvar. Só SUPER_ADMIN.
2. **Nova empresa**: ID da conta, nome, PBX, faixa de ramais e o token permanente do Helena. O token é testado e guardado cifrado.
3. Deixe **Ativa** ligada para liberar o acesso.

Tudo fica registrado em `audit_log`.

## 3. Alternativa por script
Para automação ou ambiente sem painel: copie `scripts/seed-comunic.mjs` para `scripts/seed-<empresa>.mjs`, ajuste os IDs e rode `node scripts/seed-<empresa>.mjs` (PBX lido de `PBX_BASE_URL`/`SDK_ACCESS_ID`/`SDK_ACCESS_KEY`). O token pode ser gravado com `node scripts/set-helena-token.mjs <companyId> <token>` — rode no servidor, sem deixar o token no histórico do shell.

## 4. Vincular ramais
1. No Comunic Chat da empresa, cadastre o menu personalizado do painel (ver `painel-gestao-rbac.md`).
2. Pelo painel → Ramais, logado como admin da empresa (perfil ADMIN no Helena) ou SUPER/PARTNER, vincule cada atendente a um ramal da faixa.

## 5. Testar
1. Um atendente vinculado abre o Comunic Chat com a extensão → o ramal deve registrar.
2. Ligação de teste e chamada recebida.
3. Aba Contatos: buscar um contato existente (não criar contatos reais só para teste).

## Desabilitar
No painel → Empresas, desligue **Ativa** (pede confirmação). O login integrado e o painel da empresa ficam bloqueados na próxima sessão; nada é apagado.
