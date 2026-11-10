# Comunic.SIP

Telefonia integrada ao Comunic Chat usando o PBX Yeastar P-Series. Softphone entregue como extensão para navegadores Chromium (Chrome e Edge), com um backend de integração.

## Objetivo
Centralizar a comunicação no Comunic Chat, somando a telefonia (voz) ao WhatsApp como mais um canal de vendas.

## Estrutura do repositório
```
comunic-sip/
  softphone-extension/   Extensão MV3 (Chrome/Edge) — softphone, discador, click-to-call
  comunic-sip-backend/   Backend de integração com a API/SDK do Yeastar
  design-system/         Tokens e overrides de UI (herdados do Comunic Chat)
  docs/                  Escopo, equipe, notas técnicas e guia de ambiente
  mockups/               Protótipos de tela
```

## Setup do ambiente (Windows)
Veja `docs/setup-ambiente-dev.ps1`. Rode no PowerShell como Administrador.

## Escopo da v1.0.0
Veja `docs/escopo-comunic-sip-v1.md`.
