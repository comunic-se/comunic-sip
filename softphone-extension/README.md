# softphone-extension — extensão "Comunic.Chat"

Softphone do Comunic Chat para Chrome e Edge (Manifest V3). Usa o Linkus SDK (`ys-webrtc-sdk-core`) para registrar o ramal no Yeastar e fazer/receber chamadas WebRTC direto do navegador.

O nome exibido no navegador é **Comunic.Chat**; internamente o projeto se chama Comunic.SIP.

## Build e instalação (dev)

```powershell
npm install
npm run build:prod   # produção: backend https://177.93.130.128 + PBX comunic.ras.yeastar.com
npm run build -- --backend=http://localhost:8787 --pbx=https://<pbx>   # outro ambiente (dev, parceiro)
npm run watch -- --backend=http://localhost:8787                        # rebuild automático
npm run pack         # build:prod + release/comunic-chat-<versão>.zip para instalação manual (ID fixo)
npm run pack:store   # idem, sem a "key", para enviar à Chrome Web Store / Edge Add-ons
npm run typecheck    # checagem de tipos (tsc --noEmit)
```
1. `chrome://extensions` → ligar **Modo do desenvolvedor** → **Carregar sem compactação** → selecionar `dist/`.
2. Abrir o Comunic Chat: o ramal registra sozinho. **Não há tela de conectividade**: o backend e o PBX vêm do build (`--backend` é obrigatório; `--pbx` aceita vários, separados por vírgula). A engrenagem abre só os ajustes de **áudio** e o "Sobre".
3. Abrir ou atualizar o Comunic Chat: o ramal registra sozinho.

Depois de qualquer alteração: `npm run build` e recarregar a extensão em `chrome://extensions`.

> **ID da extensão em dev:** extensão carregada sem compactação tem o ID derivado da pasta. Se a pasta mudar de lugar, o ID muda e o painel deixa de falar com a extensão — abra o painel com `?ext=<novo-id>`. Publicada na Chrome Web Store, o ID é fixo.

## Funcionalidades

- **Login integrado:** captura a sessão do Comunic Chat e o backend devolve o ramal + assinatura do SDK. Nenhuma senha de ramal é digitada.
- **Assinatura com validade:** renovada sozinha 15 min antes de vencer (`chrome.alarms`), sem derrubar chamada em andamento.
- **Transferência:** abas **Teclado** (igual ao discador, com apagar) e **Ramais** (lista da empresa com busca por nome ou número; digitar uma letra já abre a lista). Se o nome digitado bater com um único ramal, Consultar/Transferir usam esse ramal.
- **Em ligação:** a barra de abas some.
- **Presença:** avisa o backend (`POST /v1/presence`) quando o registro muda e a cada minuto (`chrome.alarms`), para o painel mostrar Conectado/Desconectado.
- **Chamadas:** discador, receber (toque suave + notificação do Chrome com Atender/Recusar), mudo, espera, DTMF, transferência cega e assistida (consulta), histórico (CDR do ramal).
- **Click-to-call:** no Comunic Chat, passe o mouse sobre um telefone e clique em **Ligar**; ou selecione o número e use o clique direito → **Ligar para "…" com Comunic.Chat**. Reconhece formatos brasileiros (+55, DDD com/sem parênteses, fixo e celular) e ignora datas, CPF/CNPJ, valores e campos de digitação. Disca só com o ramal registrado e sem outra chamada em andamento.
- **Contatos:** busca por nome ou número, criar e editar (nome, telefone, e-mail), ligar. **Não há remoção** — por regra de negócio e porque a API do Helena não oferece.
- **Ponte com o painel:** o painel de gestão (aberto dentro do Comunic Chat, em iframe) pede a sessão à extensão, então o gestor entra sem colar token. O domínio do painel precisa estar em `externally_connectable`.

## Arquitetura interna

| Peça | Arquivo | Papel |
|---|---|---|
| Service worker | `src/background.ts` | Orquestra tudo: login integrado, notificações, mensagens entre popup e offscreen, contatos via backend, ponte externa com o painel |
| Offscreen document | `src/offscreen.ts` | Roda o SDK do Yeastar (registro SIP, áudio, eventos de chamada) e o toque de chamada recebida (WebAudio). Fica vivo com o popup fechado. |
| Popup | `src/popup/*` | Interface: Teclado, Contatos (contatos do Comunic Chat e ramais da empresa com status), Histórico, telas de chamada e Ajustes de áudio |
| Config de build | `src/shared/config.ts` | `BACKEND_URL` e `BUILD_INFO`, injetados pelo `build.mjs` |
| Áudio | `src/shared/audio.ts` | Ajustes de áudio: microfone, alto-falante, dispositivo e volume do toque |
| Chamadas | `src/call/` | Tela de chamada e lógica de controle usada pelo popup |
| Click-to-call | `src/content/click-to-call.ts` | Content script nas páginas do Comunic Chat (`*.wts.chat`, `*.flw.chat`, exceto `api.*`). Não altera o DOM do app (React): o botão "Ligar" fica numa camada própria (Shadow DOM fechado). Build separado em IIFE |
| Telefones | `src/shared/phone.ts` | Reconhece e normaliza números (DDD + número, sem 55, como a aba Contatos) |
| Microfone | `src/request-mic.*` | Janela visível que pede permissão de microfone (o offscreen não consegue exibir o pedido) |
| Tipos de mensagem | `src/shared/messages.ts` | Contrato entre popup, background e offscreen |

### Mensagens internas
Cada mensagem leva um `target` (`background`, `offscreen` ou `popup`).

| Tipo | De → para | Para quê |
|---|---|---|
| `INIT_SDK` / `INIT` | popup/background → offscreen | Iniciar o SDK com ramal, assinatura e URL do PBX (configuração manual) |
| `RENEW` | background → offscreen | Nova assinatura (login integrado ou renovação): reinicia o SDK agora, ou ao fim da chamada em andamento |
| `CALL`, `CALL_ACTION` | popup → background → offscreen | Discar; atender, recusar, desligar, mudo, espera, DTMF, transferências |
| `STATUS`, `CALL_STATE`, `CALL_EVENT` | offscreen → background → popup | Status de registro e estado da chamada |
| `GET_STATUS`, `GET_HISTORY` | popup → background/offscreen | Estado atual e histórico |
| `REQUEST_MIC` | offscreen → background | Abrir a janela de permissão de microfone |
| `CONTACTS_SEARCH`, `CONTACT_SAVE` | popup → background | Buscar/salvar contatos (o background chama o backend) |
| `GET_REG` | background → offscreen | Status atual do registro (para a presença) |
| `CLICK_TO_CALL` | página → background | Disca o número (valida, confere ramal registrado e se não há chamada); também usado pelo menu de clique direito |
| `DIRECTORY` | popup → background | Ramais da empresa para a transferência (`GET /v1/directory`) |
| `PANEL_SESSION` (externa) | painel → background | O painel pede uma sessão; o background abre `/v1/panel/session` com a sessão captada |

### O que fica guardado
| Onde | Chave | Conteúdo |
|---|---|---|
| `chrome.storage.local` | `pbxURL`, `extension`, `signature`, `signExpiresAt` | Ramal e assinatura entregues pelo backend e o vencimento dela (epoch, segundos) |
| `chrome.storage.local` | `audio` | Ajustes de áudio (`micId`, `speakerId`, `ringId`, `ringVolume`, `ringEnabled`). O offscreen recebe por `GET_AUDIO`/`AUDIO_SETTINGS` (ele não acessa storage) |
| `chrome.storage.session` (só memória, some ao fechar o navegador) | `helenaToken` | Último token de sessão do Comunic Chat captado |
| `chrome.storage.session` | `panelJwt` | JWT do backend (12 h) usado pela aba Contatos |

### Permissões
- `offscreen`, `storage`, `notifications`, `webRequest`, `alarms` (renovação da assinatura), `contextMenus` ("Ligar para…").
- `content_scripts`: páginas do Comunic Chat, para o click-to-call.
- `host_permissions`: `api.wts.chat` e `api.flw.chat` (para captar a sessão).
- `host_permissions`: `*.wts.chat` e `*.flw.chat` (o `webRequest` do login integrado só enxerga a requisição com permissão para a API **e** para a página do Comunic Chat que a fez), mais o backend e o PBX informados no build (gerados no `dist/manifest.json`). Não há permissão opcional pedida em tempo de execução.
- `externally_connectable`: `localhost`, `127.0.0.1` e `*.comunic.chat` — quem pode pedir sessão à extensão (o painel).

## Padrão visual
Segue o design do Comunic Chat: fonte Inter, azul de ação `#2563eb`, fundo `#f1f5f9`, botões em pílula, ícones Heroicons de contorno. Janela de 320×420, sem rolagem nas telas de teclado e chamada (Contatos e Histórico rolam).

Armadilha conhecida: no CSS, uma regra com `display` (grid/flex) anula o atributo `hidden`. Por isso existe `[hidden] { display: none !important; }` em `popup.css` — não remova.

## Ícones e marca
- Ícone da extensão: `assets/icon-{16,32,48,128}.png`, gerados a partir do logo Comunic PABX.
- Logo Comunic.Chat: `assets/logo-comunic.svg`.

## ID da extensão
A chave pública em `manifest.json` (`key`) fixa o ID em **`gihpjglehjmbghdfodgoekdpfkigamci`** em qualquer computador. O painel usa esse ID para pedir a sessão à extensão (`EXT_ID` em `comunic-sip-backend/public/painel.html`). Ao publicar na loja, o ID muda; veja `docs/implantacao.md`.
