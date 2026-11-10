# Comunic Chat — mapa da plataforma

Levantamento feito navegando em `comunic.flw.chat` em 09/11/2026 (somente leitura). Serve de referência para encaixar o Comunic.SIP.

## Navegação principal (barra superior)

| Módulo | Conteúdo |
| --- | --- |
| **Atendimentos** | Caixa de entrada. Abas Novos / Meus / Outros; filtros Atendimentos / Grupos; lista com etiquetas (CLIENTE, C. CHAT, C. PABX, TAXA, INADIM…) e fila (Suporte, Comunic). Rodapé com campo +55 / telefone e botão "Conversar". |
| **CRM** | Contatos, Painéis, Carteiras, Agenda. Painéis em Kanban ou Lista (ex.: "Implantação", "Base de Conhecimento", "Minhas tarefas"). |
| **Apps** | Campanhas, Pagamentos, Chatbot, Sequências, Mensagens Agendadas, Manual, Mais apps (marketplace). |
| **Relatórios** | Indicadores. |
| **Ajustes** | Usuários, Equipes, Modelos de mensagem, Conta, Consumo de mensagens, Integrações. |

Borda direita: chat interno da equipe (avatares com anel verde quando online).

## Cabeçalho da conversa

Avatar + nome + etiquetas, ícones **olho**, **telefone** e **e-mail**. O ícone de telefone já existe e é o ponto de entrada natural para a ligação via SIP. Rodapé da conversa: arquivar, telefone, e-mail, classificação do atendimento, botão "Reiniciar".

## Marketplace de apps (Apps › Mais apps)

Cada app tem preço mensal e estado ATIVO/INATIVO. Ativos na conta: Tempo de segurança, Classificação de atendimento, Asaas, CRM, Sequências, Chat interno, Carteirização, Transcrição de áudio com IA, Agentes Inteligentes, Mensagens Agendadas, Grupos, Pesquisa CSAT (beta), Campanhas. Inativos: Distribuição de atendimentos, **Chamada de Voz – WhatsApp** (beta, teste grátis, só canais oficiais).

Implicação: o Comunic.SIP pode ser publicado como mais um app do marketplace, complementar à "Chamada de Voz – WhatsApp" (que não cobre telefonia PSTN/PABX).

## Integrações (Ajustes › Integrações)

- Widget de Atendimento
- **Webhooks** — eventos POST para URL própria (mensagem recebida, contato alterado…)
- **Integração via API** — token de acesso, iniciar conversas por modelo, interagir com contatos
- Automações via Pluga, N8N e Make.com

Webhooks + API são o caminho para registrar ligações no histórico do contato e movimentar cards do funil.

## Observações

- O domínio `comunic.flw.chat` indica que a plataforma roda sobre a base flw.chat (white label). Mudanças na interface nativa podem depender do fornecedor; o que não puder entrar no produto entra via extensão de navegador / app desktop + API.
- A etiqueta **C. PABX** já existe nos contatos: há clientes de PABX na base.
