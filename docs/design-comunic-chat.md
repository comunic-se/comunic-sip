# Comunic.SIP — guia de design

O Comunic.SIP não tem identidade visual própria: herda a casca e os tokens do Comunic Chat, para que o operador não sinta que trocou de aplicação.

Fonte dos tokens: **Comunic Chat Design System** (artifact da organização) + medições feitas na plataforma em produção em 09/11/2026. Arquivos em `../design-system/`.

## Fundamentos

- **Fonte:** Inter (400/500/600/700/800). Corpo 13–14px, títulos de página 28px ExtraBold com `-0.02em`, etiquetas 9–10px CAIXA ALTA.
- **Neutros:** escala slate do Tailwind. Fundo da aplicação `#f1f5f9`, cartões brancos, texto `#1e293b`, títulos `#0f172a`, apoio `#64748b`, bordas `#e2e8f0`.
- **Cor de ação:** azul `#2563eb` (hover `#1d4ed8`, selecionado `#dbeafe`). ⚠️ O design system diz índigo `#4f46e5`; o produto real usa azul. Os mockups seguem o produto (ver `comunic-sip-overrides.css`). **Decisão pendente.**
- **Etiquetas:** ciano `#66ccff`, magenta `#ff158a`, rosa `#fe60c9`, areia `#e3c298`, pêssego `#fed7aa` — indicam relação do contato, nunca estado.
- **Forma:** botões, campos, abas e chips em pílula (999px); cartões 12px; dropdowns 8px; etiquetas 2–4px.
- **Elevação:** quase nenhuma sombra; hierarquia por borda + fundo. Sombra visível só em dropdown/softphone (`0 8px 24px`) e pop-up/modal (`0 24px 48px`).
- **Ícones:** Heroicons 24 outline. Sem emoji.
- **Texto:** pt-BR, capitalização em frase, botões no infinitivo, datas `dd/mm/aaaa HH:mm`, tempo relativo nas listas ("há 12 min").
- **Casca fixa:** barra superior 52px · lista de atendimentos 290px · chat interno 44px à direita · campos/botões 38px.

## Cores de telefonia

| Uso | Cor |
| --- | --- |
| Atender / Ligar | `#15803d` (green-700 — passa contraste com texto branco; `#22c55e` não passa) |
| Encerrar / Recusar | `#dc2626` (fundo suave `#fef2f2`) |
| Em ligação / Online (ponto) | `#22c55e` |
| Em espera / Chamando | `#f59e0b` (pílula `#fef3c7` / texto `#92400e`) |
| Faixa do softphone e do pop-up | `#0f172a` |
| Ligação realizada (seta ↗) | verde `#15803d` · recebida (↙) azul `#1d4ed8` · perdida vermelho `#dc2626` |

## Padrões de interface do Comunic.SIP (mockups)

1. **Status do ramal na barra superior** — pílula "Ramal 201 · Disponível / Chamando / Em ligação" com ponto colorido.
2. **Softphone flutuante** (300px, canto inferior direito da conversa): faixa escura com estado, avatar, nome, número, cronômetro; grade 3×2 (Mudo, Espera, Teclado, Transferir, Gravando, Nota); botão Encerrar. Alterna para discador com teclado 3×4.
3. **Pop-up de chamada recebida** (360px, canto superior direito, sobre qualquer módulo): identificação do contato, etiquetas, card no funil, responsável, última interação, carteira; Recusar / Atender; links Abrir conversa / Abrir card / Enviar para fila. O card correspondente no Kanban ganha anel azul e selo "Ligando".
4. **Ligação na linha do tempo da conversa** — linha de sistema ("Pedro ligou para … pelo Ramal 201 em …") + cartão com direção, duração, player de gravação, download e **Resumo da ligação (IA)** com ações Ver transcrição / Criar tarefa / Mover card no funil.
5. **Lista de atendimentos** — filtro "Ligações"; prévia mostra "Ligação recebida · 06:52", "Chamada perdida" (vermelho), "Ligação em andamento" (verde); botão verde de ligar ao lado de "Conversar".
6. **Relatórios › Chamadas** — KPIs (total, atendidas, perdidas, tempo médio), filtros com prefixo (Período, Direção, Status, Ramal, Equipes), tabela com gravação e resumo IA por linha.
7. **Ajustes › Telefonia** — sub-abas Ramais e troncos / Filas / URA / Horários / Gravações; cartão do tronco SIP (servidor, porta/transporte, DIDs, canais, codecs, status de registro, testar conexão) com chaves de gravação, transcrição, abrir conversa ao atender e criar contato para número desconhecido; tabela de ramais com dispositivo (WebRTC, aparelho IP, softphone desktop), status e gravação.

## Pendências

- Confirmar cor de ação (azul do produto vs. índigo do design system).
- Logomarca em SVG.
- Onde o módulo entra na navegação: app do marketplace ou item próprio.
- Dados reais do provedor SIP (campos entre colchetes nos mockups).
