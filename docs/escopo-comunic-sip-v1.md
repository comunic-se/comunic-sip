# Escopo do Comunic.SIP v1.0.0

## Objetivos
- Centralizar comunicação de voz no Comunic Chat
- Integrar telefonia via Yeastar P-Series
- Complementar o WhatsApp como canal de vendas

## Requisitos funcionais (v1.0.0)
- [ ] Registrar um ramal do Yeastar na extensão
- [ ] Realizar e receber chamadas pelo ramal
- [ ] Discador integrado na interface do Comunic Chat
- [ ] Consultar a base de contatos do Comunic Chat para discar
- [ ] Transferência de chamadas (cega e assistida)
- [ ] Função "click-to-call" nos números de telefone

## Entregas
- Extensão Chrome/Edge com softphone integrado
- Backend de integração com a API do Yeastar
- Design consistente com o Comunic Chat
- Documentação de implantação e uso

## Próximas versões (fora do escopo da v1)
- Painel de gestão de ramais e filas
- Dashboard de métricas e relatórios de chamadas
- Acesso e reprodução de gravações (via API do Yeastar)

## Premissas (confirmadas)
- PBX Yeastar P-Series com plano Ultimate — OK
- Acesso de administrador à API e ao SDK do Yeastar — OK
- Suporte oficial a Chrome e Edge (ambos Chromium); outros Chromium com compatibilidade não oficial — OK
- Até 100 ramais simultâneos — OK
