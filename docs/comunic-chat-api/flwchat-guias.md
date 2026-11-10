# comunic.chat (flw.chat) — Guias da API
Fonte: https://flwchat.readme.io — extraído em 2026-11-09
Base URL: https://api.wts.chat/core | Auth: Authorization: Bearer <token>


---
<!-- https://flwchat.readme.io/reference/autenticação.md -->
# Autenticação

Entenda como autenticar suas requisições para utilizar a API.

Para uso da API deverá ser gerado um token permanente através da plataforma web.

O token pode ser gerado acessando a página de integrações `Ajustes > Integrações > Integração via API`).

Após gerar o token, informe-o nos `Headers` de cada requisição, utilizando a chave `Authorization` e o schema `Bearer`.

Exemplo: `Authorization: Bearer pn_0000000000000000000000`.

***

Você também pode realizar requisições diretamente a partir desta documentação. Para isso, bastar informar o token no campo adequado, assim como no exemplo abaixo:

---
<!-- https://flwchat.readme.io/reference/paginação.md -->
# Paginação

Entenda como a paginação nos endpoints de listagem funciona.

### Requisição

Vários endpoints de listagem de entidades possuem paginação, que é controlada através dos seguintes atributos `pageNumber` e `pageSize`, enviados no corpo da requisição.

```json
{
  "pageNumber": 1,
  "pageSize": 50,
  ...
}
```

Sendo:

* `pageNumber`: indica qual página deseja obter;
* `pageSize`: indica o tamanho desta página, ou seja, quantos itens serão retornados, sendo possível no máximo 100.

Observe que ao alterar o `pageSize` em requisições subsequentes, o `pageNumber` retornará resultados diferentes. Portanto, é importante manter um `pageSize` constante enquanto se itera sobre o `pageNumber`.

***

### Resposta

Os resultados retornados nos endpoints paginados possuem a seguinte estrutura:

```json
{
  "pageNumber": 1,
  "pageSize": 50,
  "totalPages": 5,
  "totalItems": 250,
  "hasMorePages": true,
  "items:" [{...}],
  ...
}
```

Sendo:

* `pageNumber`: indica qual página foi obtida;
* `pageSize`: indica o tamanho da página obtida;
* `totalPages`: total de páginas existentes para a consulta atual;
* `totalItems`: total de itens existentes para a consulta atual;
* `hasMorePages`: indica se há mais páginas a serem consultadas, ou seja, se `pageNumber` é menor que `totalPages`;
* `items`: array de entidades retornadas, cujo tamanho será menor ou igual a `pageSize`.

---
<!-- https://flwchat.readme.io/reference/rate-limiting.md -->
# Rate limiting

Para garantir a estabilidade, segurança e desempenho da API, aplicamos limites de requisições. Eles funcionam em duas camadas complementares:

1. **Limite principal (uso contínuo)**\
   Você pode realizar até **`1.000` requisições a cada `5` minutos**, o que equivale a uma média aproximada de `3` requisições por segundo.\
   Esse limite controla o uso regular da API ao longo do tempo.

2. **Limite de proteção contra picos (burst limit)**\
   Além do limite principal, existe um limite adicional de segurança: **`200` requisições a cada `5` segundos.**\
   Esse mecanismo evita picos repentinos de chamadas que poderiam impactar a saúde e a estabilidade da aplicação, mesmo que o limite principal ainda não tenha sido atingido.

**Comportamento em caso de excesso**

Requisições que ultrapassarem qualquer um desses limites receberão como resposta o status `429 – Too Many Requests`, você deve esperar para que o limite seja reestabelecido para voltar a disparar mensagem.

> 📘 Escopo
>
> Os limites citados acima são aplicados por conta

<br />

## Dicas para evitar atingir o limite

Algumas boas práticas ajudam a manter sua integração estável e evitam respostas `429 – Too Many Requests`.

* **Evite loops sem controle**\
  Laços que disparam requisições em sequência (especialmente for ou while) devem sempre ter algum tipo de atraso ou controle de volume.
* **Implemente retry com espera (backoff)**\
  Se receber um 429, aguarde alguns segundos antes de tentar novamente. Repetir imediatamente tende a piorar o problema.
* **Distribua as chamadas ao longo do tempo**\
  Em vez de disparar muitas requisições de uma vez, espalhe-as de forma uniforme para manter uma média estável.

## Dicas específicas para quem usa n8n\*\*

O n8n é poderoso, mas pode gerar picos de requisições sem perceber. Algumas configurações ajudam bastante:

* **Use o node Wait**\
  Após chamadas em massa ou dentro de loops, utilize o node Wait para inserir um atraso entre as execuções.\
  Mesmo um intervalo pequeno (ex: 500 ms) já reduz drasticamente o risco de atingir o limite.
* **Controle a concorrência**\
  Ao usar nodes como HTTP Request e Split In Batches, evite executar muitos itens em paralelo. Prefira processar em lotes menores e sequenciais.
* **Configure corretamente o Split In Batches**\
  Use tamanhos de lote menores (ex: 10 ou 20 itens).\
  Combine com o node Wait entre os lotes para suavizar o volume de chamadas.
* **Trate o erro 429 explicitamente**\
  Configure o fluxo para:\
  -Detectar o erro 429\
  -Aguardar alguns segundos\
  -Repetir a requisição automaticamente\
  -Isso evita falhas no workflow e respeita os limites da API.

---
<!-- https://flwchat.readme.io/reference/login-integrado.md -->
# Login integrado

É possível integrar o login entre plataformas, gerando um token via API e direcionando o usuário

Para integrar o login, você precisará de um **token permanente**, que pode ser obtido em Ajustes → Integração → Integração via API.

Com esse token, sua aplicação backend faz uma requisição POST para autenticar um usuário, definindo em qual conta ele será logado e para qual página será redirecionado.

***

## Parâmetros da Requisição

### Identificação do usuário

| Parâmetro     | Descrição                                                                                                                                    |
| :------------ | :------------------------------------------------------------------------------------------------------------------------------------------- |
| `phoneNumber` | Número de telefone do usuário. Para números nacionais, não é necessário formatação especial. Para internacionais, inclua o `+` antes do DDI. |
| `email`       | E-mail cadastrado na plataforma.                                                                                                             |
| `redirectUrl` | URL da página que o usuário acessará após autenticado. Ideal para direcionar diretamente a uma conversa específica. *(opcional)*             |

***

## Componente de Conversas

O componente de conversas está disponível na rota `/chat2/sessions/XXXXXX`, onde `XXXXXX` é o ID da conversa. Há duas variações úteis:

* **`/preview`** — Suprime o menu da plataforma, exibindo apenas a conversa.
* **`?interactive=true`** — Pré-habilita a interação na conversa.

Combinando os dois, a URL completa fica:

```
/chat2/sessions/XXXXXX/preview?interactive=true
```

***

## Fazendo a Requisição

> 🚧 **Atenção:** nunca faça essa requisição no front-end. Ela deve ser realizada exclusivamente via **backend** para preservar a segurança dos seus dados.

Passe o token permanente no cabeçalho usando autenticação **Bearer**:

```
Authorization: Bearer pn_000x000x000x000x000x000x000x00
```

**POST** `https://api.flw.chat/auth/v1/login/authenticate`

**Requisição**

```json
{
  "phoneNumber": "5531999999999",
  "email": "email@seudominio.com",
  "redirectUrl": "/chat2/sessions/df98b9fb-2280-45z5-bce1-3fe8aa7047e5/preview"
}
```

**Resposta**

```json
{
  "userId": "48525e80-43a7-4e06-86e0-f6b67b7d6629",
  "tenantId": "d4ed253d-f0c6-435c-8f7f-59a0598885fe",
  "urlRedirect": "https://xyz.flw.chat/auth/external-login?code=3aXTxVyWtU5p6x7PpGmtlL62XRjbmKUFIWxADykpaWQ&userId=58525e80-43z7-4e06-86e0-f6b67b7d6629&tenantId=d4ed253d-y0c6-435c-8f7f-59a0598885fe",
  "expiresIn": "2026-01-01T00:00:00Z"
}
```

Após receber a resposta, utilize o campo `urlRedirect` para redirecionar o usuário, ele iniciará a sessão já autenticado.

---
<!-- https://flwchat.readme.io/reference/webhooks-1.md -->
# Webhooks

Entenda como receber eventos em outro sistema.

O envio de eventos por webhook é um mecanismo para notificar o seu sistema quando uma variedade de interações ou eventos acontecem, incluindo quando uma pessoa envia uma mensagem ou um contato é alterado.

***

### Configuração

É possível realizar a configuração através da plataforma (acessando `Ajustes > Integrações > Webhooks` ).

Ao criar uma nova assinatura, você deverá selecionar os eventos/tópicos que deseja assinar e informar uma URL válida. A plataforma enviará requisições HTTP utilizando o método `POST`  para a URL informada, que deverá estar preparada e disponível publicamente para receber os eventos.

É possível pausar temporariamente o recebimento de webhooks, modificando os status da assinatura para inativo.

### Ciclo de vida de uma conversa

![](https://files.readme.io/7a99955-Captura_de_Tela_2023-10-25_as_18.39.39.png)

***

### Estrutura

As mensagens de webhook enviadas possuirão o corpo no formato `application/json` e a seguinte estrutura:

```json
{
    "eventType": "NOME_DO_EVENTO",
    "date": "DATA_DE_ENVIO",
    "content": { ... }
}
```

Sendo:

* `eventType`: o nome do evento/tópico, sendo os valores possíveis listados [abaixo](#eventos);
* `date`: data e hora de geração do evento, seguindo o formato `YYYY-MM-DDTHH:mm:ss`;
* `content`: conteúdo do evento.

Veja abaixo um exemplo de webhook de alteração de contato:

```json
{
    "eventType": "CONTACT_UPDATE",
    "date": "2023-08-23T16:42:35.4359934Z",
    "content": {
        "id": "ed2b52f8-cf13-449b-b3d5-ae27051f4663",
        "createdAt": "2022-10-28T21:24:26.158391Z",
        "updatedAt": "2023-08-23T16:15:35.3814324Z",
        "companyId": "626fb5de-0cc2-4209-b456-47b454ee6e14",
        "name": "John Raymond Legrasse",
        "phonenumber": "+55|00000000000",
        "phonenumberFormatted": "(00) 00000-0000",
        "email": "exemplo@email.com",
        "instagram": null,
        "annotation": "",
        "tagsId": [],
        "tags": [],
        "status": "ACTIVE",
        "origin": "CREATED_FROM_HUB",
        "utm": null,
        "customFieldValues": {},
        "metadata": null
    }
}
```

---
<!-- https://flwchat.readme.io/reference/webhook-no-chatbot.md -->
# Webhook no Chatbot

Durante o atendimento pelo Chatbot, o sistema poderá disparar webhooks para buscar mais informações, dados e criar fluxos alternativos para uma melhor experiência dos clientes.

![](https://files.readme.io/ef08e9d-Captura_de_Tela_2024-01-23_as_14.57.27.png)

O webhook no chatbot tem uma mensagens de input e output padrões, você define a URL e recebe a mensagem via método `POST`.

**Mensagem de disparo:**\
Esta mensagem será enviada pelo chatbot para seu sistema com todos os dados capturados até o momento, os dados do canal de atendimento, dados do contato e as opções de respostas possíveis:

```json JSON
{
    "responseKeys": [
        "CLIENTE_EXISTE",
        "CLIENTE_NAO_EXISTE"
    ],
    "sessionId": "567ca9b8-eaa9-4a33-8cf9-d2c67060af74",
    "session": {
      "id": "567ca9b8-eaa9-4a33-8cf9-d2c67060af74",
      "createdAt": "2024-06-02T12:00:10.38771Z",
      "departmentId": "07deebd3-dede-42d1-9169-75e00efdf088",
      "userId": null,
      "number": "2024062700164",
      "utm": {
        "clid": "asldkjasLKJASLKDJLKJASLDKJASGFui3HT7c7KUdBaB7lOHHxp5CxufCY0GjlvZcDRpsTaRbZMQ",
        "term": null,
        "medium": "REFERRAL",
        "source": "INSTAGRAM",
        "content": "Campanha de Natal Minas Gerais!",
        "campaign": "776107696326",
        "headline": "Converse conosco",
        "referralUrl": "https://www.instagram.com/p/x466u6s5ykjs/"
      }
    },
    "channel": {
        "id": "0a4ca3cd-b9fd-4523-a032-5a343bf7b209",
        "key": "551140037752",
        "platform": "WhatsApp",
        "displayName": "(11) 3000-0000"
    },
    "contact": {
        "id": "f8f43b22-2f20-42f3-be13-65bf90282143",
        "name": "David",
        "phonenumber": "+55|1199999999",
        "display-phonenumber": "(11) 99999-9999",
        "email": "email@gmail.com",
        "instagram": null,
        "tags": [
            "Lead"
        ],
        "cnpj": "00.000.000/0000-00",
        "metadata": { "cod-ext": "abcd" }
    },
    "questions": {
        "cb-ec36e3fe-qst-c0b0875a": {
            "text": "Qual seu CNPJ?",
            "answer": "00.000.000/0000-00"
        }
    },
    "menus": {
        "cb-ec36e3fe-mn-943b055a": {
            "text": "Qual opção você deseja?",
            "answer": "Comprar"
        }
    },
    "lastMessage": {
      "id": "152d4d13-0b13-49bb-bafc-3923434f204b",
      "createdAt": "2024-06-27T19:09:22.592061Z",
      "type": "IMAGE",
      "text": null,
      "fileId": "aa546fa6-ca68-4a8b-a57d-c031460fae69",
      "file": {
        "publicUrl": "https://cdn.flw.chat/upload/88fb5de-0cc2-4209-b456-47b454ee6e14/IMAGE/c40e85e_20240627190923197_436019626068697.jpg?AWSAccessKeyId=XXXX",
        "extension": ".jpg",
        "mimeType": "image/jpeg",
        "name": "436019626068697.jpg",
        "size": 233541
      }
    }
}
```

**Mensagem de retorno (Simples)**\
Seu webhook deverá responder com um código HTTP `200` para seguir no fluxo principal de sucesso, mas você poderá criar fluxos alternativos, assim deverá responder com o código HTTP `200` e uma mensagem conforme abaixo:

```json
{
    "response": "CLIENTE_EXISTE"
}
```

**Mensagem de retorno (Com dados do contato)**\
Você poderá atualizar os dados do contato no retorno do webhook, bem como metadados para serem usados em outro momento de integração, como no exemplo abaixo o código do cliente no seu sistema.

```json
{
    "response": "CLIENTE_EXISTE",
    "metadata": {
        "cliente-existe": true
    },
    "contact": {
        "cnpj": "00.000.000/0000-00",
        "metadata": {
            "cod-ext": "abcd"
        }
    }
}
```

**Mensagem de retorno (Com disparo de mensagens)**\
Também é possível enviar mensagens ao usuário ao retornar do webhook, você deverá indicar uma lista de mensagens que serão disparadas na ordem enviada;

```json
{
    "response": "CLIENTE_EXISTE",
    "messages": [
        {
            "text": "Segue seu boleto abaixo para pagamento. Vencimento dia 10/01"
        },
        {
            "fileUrl": "https://xyz.com/boleto.pdf"
        },
        {
            "template": {
                "id": "ab78cd_oferta",
                "parameters": {
                    "valor": "R$ 9,99"
                }
            }
        }
    ]
}
```

As mensagens podem incluir texto e/ou arquivo. Além disso, é possível utilizar um modelo de mensagem (template) previamente criado.

As opções de respostas foram separadas para efeitos didáticos, mas podem ser combinadas em uma única mensagem.

***

## Perguntas Dinâmicas

Este recurso permite carregar opções de resposta em tempo real diretamente do seu sistema via Webhook. No momento em que o cliente atinge a etapa correspondente no fluxo, o chatbot realiza a requisição e renderiza as alternativas retornadas.

**Parâmetros do Objeto de Resposta**

| Parâmetro | Tipo   | Obrigatório | Descrição                                                                                                  |
| --------- | ------ | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `text`    | String | Opcional    | Texto principal da pergunta. Pode ser omitido se a opção "Definir como mensagem fixa" estiver ativa no nó. |
| `type`    | String | **Sim**     | Define o formato de exibição. Valores aceitos: `BUTTONS`, `LIST` ou `NUMBERS`.                             |
| `options` | Array  | **Sim**     | Lista de objetos contendo as opções para seleção (máximo de 50 itens).                                     |

**Estrutura do Array `options`**

Cada objeto dentro da lista de opções suporta os seguintes campos:

* `text` **(Obrigatório)**: O rótulo ou texto principal da opção exibida ao usuário.
* `description` **(Opcional)**: Subtítulo ou descrição de apoio. Disponível exclusivamente para o tipo `LIST`.
* `url` **(Opcional)**: Link para redirecionamento externo. Disponível exclusivamente para o tipo `BUTTONS`.

**Exemplo de Retorno JSON**

```json
{
  "text": "Como podemos ajudar hoje?",
  "type": "BUTTONS",
  "options": [
    {
      "text": "Área de Cliente",
      "url": "https://empresa.com/cliente"
    },
    {
      "text": "Suporte Técnico"
    }
  ]
}
```

---
<!-- https://flwchat.readme.io/reference/rastreio-de-campanha-utm.md -->
# Rastreio de campanha UTM

Entenda como rastrear sua campanha utilizando padrões UTM

Os padrões UTM são parâmetros adicionados às URLs para ajudar a rastrear a eficácia das campanhas, esses padrões permitem que você identifique de onde os visitantes estão vindo e quais campanhas são mais eficazes.

***

Um exemplo de uma URL com parâmetro UTM

`https://api.flw.chat/chat/v1/channel/wa/[TELEFONE]?text=[MENSAGEM]&utm_source=[SOURCE]&utm_medium=[MEDIUM]&utm_campaign=[CAMPAIGN]`

**Parâmetros**

**\[TELFONE]**: Inserir telefone da sua empresa no formato "5511980009999";\
**\[MENSAGEM]**: Inserir a mensagem que será enviada pelo cliente no WhatsApp. Ex.: Quero saber mais;\
**\[MEDIUM]**: Meio onde vai ser difundida a campanha independentemente da fonte. Ex.: Stories;\
**\[SOURCE]**: Plataforma de origem do lead. Ex.: tiktok;\
**\[CAMPAIGN]** : identifica a campanha. Ex.: PublicoAberto;

***

Assim que a conversa for iniciada, você verá a mensagem abaixo podendo ver a origem do lead.

![](https://files.readme.io/af1af8dd77ea112d7eae8958c87ac01390becb36419f221d0837dcd4a25dc60f-image.png)

Além deste ponto você conseguirá ver na origem do contato e no relatório de indicadores e de atendimentos.

<br />

<br />

![](https://files.readme.io/7eb194fc3093006500316a099c3b5791324ea982f1dce00ef30ea9c69c0d03de-image.png)

---
<!-- https://flwchat.readme.io/reference/informações-para-firewall.md -->
# Informações para Firewall

Empresas que tem regras mais rígidas de firewall podem usar as informações abaixo para configurar suas regras

**Acesso web**\
`https://*.flw.chat` e  `https://*.wts.chat`

**Acesso mobile**\
`https://mapi.flw.chat`

**API**\
`https://api.flw.chat` e  `https://api.wts.chat`

**Download de arquivos**\
`https://cdn.flw.chat` e  `https://cdn.wts.chat`

**Upload de arquivos**\
`https://wts-storage.s3.sa-east-1.amazonaws.com`

**Conexão websocket web**\
`wss://rt-web.flw.chat` e `wss://rt-web.wts.chat`

**Conexão websocket app mobile**\
`wss://rt.flw.chat` e  `wss://rt.wts.chat`

**Canais WebChat**\
Web: `https://webchat.flw.chat`\
API: `https://api-webchat.flw.chat`\
Websocket: `wss://api-webchat.flw.chat`

**IP de chamadas de webhook**\
`18.215.79.89`

**Chamadas de voz**\
`https://calling.flw.chat` e `https://calling.wts.chat`\
**IPs:** `18.230.127.33`  e `18.231.67.39`

**Distribuição de conteúdo / arquivos**\
`https://ip-ranges.amazonaws.com/ip-ranges.json`\
*Utilizamos o serviço `CLOUDFRONT `da AWS para fazer a distribuição de arquivos, para liberação no firewall é necessário adicionar os ranges de ips da AWS*

---
<!-- https://flwchat.readme.io/reference/1-criar-um-assistente-1.md -->
# 1. Criar um assistente

Neste primeiro passo vamos criar juntos um agente IA e configurar as primeiras etapas da integração com o assistente no N8N.

Antes de tudo vamos criar nosso assistente IA, configurar o modelo e criar uma chave de API.

## Como criar uma conta na OpenAI

* Acesse o site da OpenAI (<https://platform.openai.com>) no seu navegador.
* Inicie o cadastro: clique no botão "Sign Up" ou "Registrar-se" no canto superior direito da página.
* Preencha suas informações: insira seu endereço de e-mail ou, se preferir, faça login diretamente com uma conta Google ou Microsoft. Em seguida crie uma senha.
* Verificação de e-mail: após fornecer suas informações e criar uma conta, você receberá um e-mail de verificação. Acesse sua caixa de entrada e clique no link de verificação enviado pela OpenAI.
* Preencha seus dados pessoais: pode ser solicitado o fornecimento de informações como seu nome e telefone para verificação.
* Escolha um plano: a OpenAI oferece tanto uma versão gratuita quanto planos pagos com mais recursos. Escolha o que melhor se adequa às suas necessidades.

***

## Como criar um projeto dentro da OpenAI

* Após criar sua conta na OpenAI, será possível acessar o painel onde você poderá criar o seu assistente.
* No painel, clique em "Dashboard".
* Depois, clique em "Assistants".

[block:image]
{
  "images": [
    {
      "image": [
        "https://files.readme.io/1884fc9cfbadab6cbe9b395cce670fc856b0a0cb618daf59c8470345b496481a-WTS.png",
        null,
        ""
      ],
      "align": "center",
      "border": true
    }
  ]
}
[/block]

* Clique em "Create".
* Ao clicar em "Create", será aberta a tela acima onde você poderá dar um nome ao seu assistente no campo "Name".
* No campo "System instruction", você deverá definir como o assistente deve se comportar. Exemplo:

> **Você deve se comportar como um corretor de imóveis. Pergunte ao cliente sobre o tipo de imóvel, localização desejada, número de quartos, banheiros, vagas de garagem e faixa de preço. Responda perguntas frequentes de forma rápida e objetiva. Transfira para o atendimento humano se a informação disponível não for suficiente.**

* Defina o modelo no campo "Model" — recomendamos o gpt-4o-mini por ser um modelo completo e mais rápido que outros.
* Em seguida, é possível definir configurações adicionais como "File search" que permite que o assistente tenha conhecimento dos arquivos que você ou seus usuários carregam. Depois que um arquivo é carregado, o assistente decide automaticamente quando recuperar o conteúdo com base nas solicitações do usuário e, também, o "Code Interpreter" que permite que o assistente escreva e execute códigos.
* Configure o "Response Format" para "Text".
* Deixe os campos "Temperature" e "Top P" default, no futuro ajuste para que a resposta seja mais adequada ao tom que você deseja que o assistente responda.

***

## Como criar uma chave de API

* No menu lateral, clique em "API Keys".
* Na página de "API Keys", clique no botão "Create new secret key", como demonstra a imagem abaixo:

[block:image]
{
  "images": [
    {
      "image": [
        "https://files.readme.io/43e2c8e270320cec6ab59a1a01942b68fcdcc679b147031f5542879e44a572a1-WTS_3.png",
        null,
        ""
      ],
      "align": "center",
      "border": true
    }
  ]
}
[/block]

* Um pop-up aparecerá mostrando sua nova chave de API. **Copie a chave imediatamente**, pois você não poderá visualizá-la novamente.
* Essa chave será usada para autenticar suas solicitações ao utilizar a API da OpenAI.
* Se precisar, você pode revogar ou criar novas chaves a partir dessa mesma tela a qualquer momento.

<br />

**Lembre-se de que a chave de API é privada e você não deve compartilhá-la publicamente, pois ela dá acesso à sua conta e aos seus créditos da OpenAI.**

---
<!-- https://flwchat.readme.io/reference/2-criar-o-loop-no-chatbot.md -->
# 2. Criar o loop no chatbot

Entenda como criar o modelo de chatbot e configurar o loop de modo que as mensagens enviadas não se percam e sejam sempre processadas por seu assistente.

## Como criar o modelo do chatbot

* Dentro da plataforma faça login com o usuário administrador e siga os passos abaixo para criar o modelo do chatbot que será integrado à IA.

* No menu de opções clique em **Apps** > **Chatbot** > **Novo**.

* Dê um nome ao seu chatbot e o associe a um tipo de canal (Z-API ou WhatsApp oficial). Defina a equipe padrão desse chatbot.

* Crie um nó de mensagem receptiva. Exemplo: *Olá, boas-vindas! Como posso ajudar?*

* Em seguida, configure uma ação que aguarde resposta do contato com as opções: **"Limite de espera: Sem limite"** e **"Tolerância: 5 segundos"**.

* Acima do nó de "Aguardar resposta do contato" é necessário criar um ponto de retorno. Atenção: sem este ponto de retorno o loop não irá funcionar.

* Em seguida, é preciso configurar o disparo webhook que enviará as informações do atendimento.

* No campo **URL** copie a URL do webhook que deverá ser criado no N8N e cole no campo "URL". Clique em **"Atualizar"** para salvar as configurações.

[block:image]{"images":[{"image":["https://files.readme.io/2a68c3db185774771513e3170f7bd6d9f9b88f50a23c066ababadae59bf9f9be-image.png",null,null],"align":"center","border":true}]}[/block]

<br />

***

## Como criar os loops

* Dentro do subfluxo de **"Sucesso"** crie uma ação que redireciona para o ponto de retorno **"GPT"**, como mostra a imagem acima.
* Assim, o loop estará configurado de modo que sempre que o contato enviar uma mensagem a mesma voltará ao ponto de retorno configurado e será disparada via webhook criando o loop.

  ![](https://files.readme.io/1cea14fb4be34843910e0885f9dfb82d2376afb50718f3e6d2f53f1fca4baec3-image.png)

<br />

* No subfluxo de **"Falha no envio"** adicione uma mensagem de modo que o contato seja informado que a mensagem dele falhou ou não foi compreendida, logo após adicione outro ponto de retorno **"GPT"**, assim como no fluxo de "Sucesso no envio"

  ![](https://files.readme.io/cda5cd9b183db87645645cf2aaf482e281d973361e593fe392f47b757f0c4dba-image.png)

<br />

Após seguir os passos acima, salve seu chatbot, publique e o associe ao canal em que os clientes entrarão em contato e serão respondidos por seu assistente.

---
<!-- https://flwchat.readme.io/reference/3-como-ler-e-responder-textos.md -->
# 3. Como ler e responder textos

Vamos adicionar a capacidade de ler e responder textos usando o ChatGPT.

**Confira abaixo como ficará a integração após seguir esse tutorial.**

![](https://files.readme.io/cfefb1c37cf1a3dfbb0565c56dc4962574eda264966f4ad202eac5961ce13215-image.png)

> 📘 Para baixar o fluxo pronto, o JSON com todos os passos está [nesse link](https://github.com/wtschat/files/blob/main/wts_n8n_response_with_text.json) .
>
> Você poderá criar seu próprio fluxo, para facilitar você pode baixar o nosso fluxo e alterar.

***

# Como fazer

## Montando o escopo da integração

* Crie uma conta no [N8N](https://n8n.io/).
* Clique em "Add workflow".
* Em seguida, clique em "Add first step".
* Selecione o node "On webhook call".
* Altere o método "HTTP" para **"Post"**.

***

## Armazenando variáveis

* Crie um node "Edit Fields".
* Crie uma variável chamada text e armazene nessa variável o valor "lastMessagesAggregated". Veja imagem abaixo

  ![](https://files.readme.io/facbcd30f03b11a64240d77c4287b5960eef156874099cfd664fd92db60b382c-image.png)

***

## Configurando o node do assistente

* Logo após criar o webhook, é preciso criar o node do assistente IA.
* Para isso, clique em "+" digite **"OpenIA"** e selecione **"Message an assistant"**.
* Adicione a credencial que foi criada dentro da plataforma da OpenIA, essa credencial será a chave da API que você criou no passo 3 da etapa [Criar um assistente](https://flwchat.readme.io/reference/1-criar-um-assistente-1).
* Nas opções "Resource" e "Operation" deixe ambos default.
* Em "Assistant" selecione o assistente que você criou na etapa [Criar um assistente](https://flwchat.readme.io/reference/1-criar-um-assistente-1).
* Em "Prompt" selecione a opção "Define below", no campo "text" passe a variável "text" que gravamos no node anterior "Edit Fields".

  ![](https://files.readme.io/ae767047c740f4d42a51d78e0c20c5976fda75c90c94fbaf99089f7d85fd935a-image.png)

<br />

* Em "Memory" defina para "Use memory connector". Será criado um nó abaixo do nome "Window Buffer Memory", nele é preciso passar o ID da sessão (presente no webhook).

> ### Atenção
>
> Definir a memória é muito importante, ela que fará com que o assistente consiga entender o contexto da conversa.
>
> ![](https://files.readme.io/5df3223a5bdecaf177473b259690b565fe6dc883ef21de2574e6a168eab20746-image.png)
>
> <br />

***

## Ferramentas do assistente IA

O assistente assistente possui ferramentas (Tools), que permite interações com outros sistemas através de requisições HTTP, isso torna-se útil e abre um leque de opções, você pode fazer requisições para buscar um boleto em um banco de dados e retorna-lo para o contato por exemplo, nesse documento vamos abordar três funcionalidades, mas o céu é o limite tratando-se dessa funcionalidade.

1. Nessa primeira etapa vamos realizar uma requisição na API para buscar as equipes de uma conta, essa lista de equipes dará uma base ao seu agente para transferir o contato de acordo com o contexto da conversa.

* Clique em tools e crie uma requisição HTTP
* Em "Description" você deve dar instruções para o agente da função, segue uma sugestão: "Nesta função você consegue listar as equipes disponíveis para transferência".
* Configure a requisição de acordo com a [documentação](https://flwchat.readme.io/reference/get_v2-department).
* Ao configurar o header defina o "Value Provided" como "Using Field Below". Veja imagem abaixo

  ![](https://files.readme.io/358fe8a6d87ef75b4e5762813d0508afdc2507743637092ef2839bfef9ba105c-image.png)

2. Nessa etapa vamos configurar a função de transferência de equipe, também vamos criar uma requisição HTTP, para o endpoint de transferir conversas.

* Assim como na etapa anterior vamos dar algumas instruções para nosso assistente IA sobre como usar essa função, segue uma sugestão:\
  **Setores para transferência.**\
  **Algumas diretrizes:**\
  **-Seja rápido e objetivo ao responder perguntas frequentes, buscando entender detalhadamente o problema do contato.**\
  **-Explique de maneira simples qualquer processo técnico de baixa complexidade.**\
  **-Demonstre paciência ao lidar com questões delicadas ou frustrações dos clientes.**\
  **-Utilize um tom positivo e otimista, mesmo ao comunicar informações difíceis ou negativas**.\
  **-Não solicite dados do contato como (e-mail, Id, números de protocolo, documentos).**
* Configure a requisição de acordo com a [documentação](https://flwchat.readme.io/reference/put_v1-session-id-transfer).
* Marque a opção "Send Body" e cole o JSON abaixo no body da requisição.

```json
{
  "type": "DEPARTMENT",
  "newDepartmentId": "{departmentId}"
}
```

* Você deve usar um placeholder para quaisquer dados a serem preenchidos pelo modelo. Veja imagem abaixo

  ![](https://files.readme.io/9c47ae4c1fa9260cab44ea338517f64f7233a6916b49c2e8742882392c1c6fc9-image.png)

3. Por fim, a função de concluir atendimento, nessa etapa vamos configurar uma outra requisição para finalizar o atendimento quando solicitado pelo contato. Siga os passos abaixo

* No campo "Description" passe as instruções para seu assistente IA.
* Configure a requisição de acordo com a [documentação](https://flwchat.readme.io/reference/put_v1-session-id-complete).
* Marque a opção "Send Body" e cole o JSON abaixo no body da requisição
* ```json
  {
    "reactivateOnNewMessage": true
  }
  ```

  ![](https://files.readme.io/e395c0cd565d4c4ffa909f2c9c435968e37b079209006e47990240b1b7554735-image.png)

  ***

  ## Configuração do node de enviar mensagem ao contato
* O primeiro passo é instalar o módulo do WTS em seu N8N. É possível encontrar essa informação para a instalação em "Ajustes" > "Integrações" > "Automações via N8N".
* Após instalar o módulo WTS, crie uma chave de API dentro da plataforma em "Ajustes" > "Integrações" > "Integrações Via API" > "Novo" > "Nomeie a chave" > "Salve" > "Copie".
* Clique para adicionar um novo nó e digite "WTS", procure por "Session Actions" > "Send Message Text".
* Em "Credential to connection with", caso você já tenha uma chave de API criada, bastar selecioná-la. Caso não, basta criar uma nova "Create new credential" e colar a chave API criada na plataforma.
* O output em questão é a resposta do seu agente, você deve passá-lo dentro da requisição para disparar essa resposta para o contato.
* No campo "Text" coloque o output retornado por seu agente IA, no campo "Session ID" informe o id da sessão (essa informação você encontra no output do webhook, procure por "sessionId").

  ![](https://files.readme.io/32bd80ce5b147a49d540fee71eb35c23da1f13b56c6bec8a36ad78882e24f370-image.png)

Seguindo esse tutorial, será possível ler e responder textos usando o ChatGPT, além disso será possível executar funções de transferência e conclusão de atendimentos. Você também pode adicionar outras funções ao seu assistente, como buscar boletos em uma API externa por exemplo, existem diversas possibilidades que você pode explorar utilizando as ferramentas do seu assistente.

---
<!-- https://flwchat.readme.io/reference/4-como-processar-áudios.md -->
# 4. Como processar áudios

Nessa etapa vamos ensinar como adicionar a capacidade de processar áudios à sua IA.

**Confira abaixo como ficará a integração após seguir esse tutorial.**

![](https://files.readme.io/7cc1583c454c1a0441643149950d2cdafb2d08bef63adb07def0e4575c8bd7a6-image.png)

> 📘 Para baixar o fluxo pronto, o JSON com todos os passos está [nesse link](https://github.com/wtschat/files/blob/main/wts_n8n_transcribe_audio.json).
>
> Você poderá criar seu próprio fluxo, para facilitar você pode baixar o nosso fluxo e alterar.

## Separando os tipos de mensagem

Como explicado anteriormente, mensagens agregadas são divididas em mensagens de texto e mensagens que contenham áudio, imagem ou arquivo. Para separarmos as mensagens de texto das mensagens que contenham arquivos, vamos usar o node "Filter" validando se o tipo de mensagem "Text" é ou não vazio.

* Se não for vazio vamos usar um "Set" para gravar a várivel "lastMessagesAggregated.text" e, caso seja vazio, serão  enviadas apenas mensagens do tipo "File",  vamos tratar sobre mais a frente.

<br />

[block:image]
{
  "images": [
    {
      "image": [
        "https://files.readme.io/71fc809bc4c502da99eb9943f229c9850a781eb0b9c7ea44e93591ea0ab93402-image.png",
        null,
        ""
      ],
      "align": "center",
      "border": true
    }
  ]
}
[/block]

* Já para mensagens "Files" devemos dividir os arquivos vindos do webhook em arquivos únicos, usando o node "Split Out" e tratar cada tipo de arquivo de uma maneira. Nessa etapa vamos tratar apenas arquivos de áudio, outros tipos de arquivos serão abordados mais a frente.

[block:image]{"images":[{"image":["https://files.readme.io/e7c75bd3c0081ce3d348d9c5298682a3b463db1d52f5da648eb28fb9e8841acc-image.png",null,""],"align":"center","border":true}]}[/block]

* Após dividirmos os arquivos vamos separá-los por tipo, áudio, imagem e documentos. Para isso usaremos o node "Switch" e comparar se o "file.mimeType" (tipo de arquivo) começa com áudio/(formato) do arquivo.

[block:image]{"images":[{"image":["https://files.readme.io/7af17401bbc21aa3d7560ece8c31595cc9099638341708ad4427a6c4aae10cf8-image.png",null,""],"align":"center","border":true}]}[/block]

***

## Tratando arquivo de áudio

* Após separar o arquivo de áudio dos demais, é preciso fazer o seu download. Para isso usaremos uma requisição HTTP, vamos dar um "GET" na URL pública que se encontra o áudio.

[block:image]
{
  "images": [
    {
      "image": [
        "https://files.readme.io/c479446f08f8c7de2912467eeb97adc6c1449024ae15df08aa5bb7c56f312686-image.png",
        null,
        ""
      ],
      "align": "center",
      "border": true
    }
  ]
}
[/block]

***

## Transcrevendo o áudio

* Logo após realizar o download do áudio, crie um node OpenIA > "Transcribe Recording".

* No campo "Input Data Field Name" é necessário passar o nome do campo de entrada que contém os dados do arquivo binário a serem processados.

[block:image]{"images":[{"image":["https://files.readme.io/204196db3bcddd8f53201fd10a3890f6707cd323a80b3f59108dfb06ba9072d2-image.png",null,""],"align":"center","border":true}]}[/block]

* Grave o output da transcrição em uma variável.
* Crie um node "Merge" para agrupar os inputs.
* Grave os valores "text" e "sessionId" em um node "Set".

[block:image]
{
  "images": [
    {
      "image": [
        "https://files.readme.io/564f668d83d296a519040ff68fc620715a5ede2a0f10014fe43997892da0fcc4-image.png",
        null,
        ""
      ],
      "align": "center",
      "border": true
    }
  ]
}
[/block]

* Em seguida, é necessário concatenar as mensagens em uma única mensagem para enviarmos para o seu assistente.  Para isso será utilizado um node "Code", basta copiar o código abaixo:

```javascript
var text = "";
var sessionId = $('Webhook').first().json.body.sessionId;

for (const item of $input.all()) {
  text += item.json.text + " \n";
}

return { "text": text, "sessionId": sessionId };
```

***

### Resumo do que o código faz:

1. Inicializa uma variável text como uma string vazia.
2. Recupera o valor do sessionId de uma resposta de webhook anterior.
3. Itera por todos os itens de entrada disponíveis e concatena o texto de cada item, adicionando uma nova linha entre os textos.
4. Retorna um objeto com o texto concatenado e o sessionId para ser usado em outro lugar.

* Ligue o node "Code" ao seu assistente, que por sua vez estará ligado ao node "Enviar mensagem".

Após todos esses passos sua integração irá processar áudios enviados, transcrevendo-os em texto para que seu assistente consiga interpretar e responder da forma mais adequada.

---
<!-- https://flwchat.readme.io/reference/5-como-processar-imagens.md -->
# 5. Como processar imagens

Nessa etapa vamos ensinar como adicionar a capacidade de processar imagens à sua IA.

**Confira abaixo como ficará a integração após seguir esse tutorial.**

[block:image]
{
  "images": [
    {
      "image": [
        "https://files.readme.io/369776debe631f1056604367ea9f710eab5f720f7ebd09ee18394d33c8e89ec7-image.png",
        null,
        ""
      ],
      "align": "center",
      "border": true
    }
  ]
}
[/block]

> 📘 Para baixar o fluxo pronto, o JSON com todos os passos está [nesse link](https://github.com/wtschat/files/blob/main/wts_n8n_transcribe_image.json).
>
> Você poderá criar seu próprio fluxo, para facilitar você pode baixar o nosso fluxo e alterar.

## Processando imagens

* Na etapa anterior no processamento de áudio foi criado o node "Switch" para processar diferentes tipos de arquivo, vamos criar uma rota dentro desse switch para processar as **imagens.**

* Para isso, é necessário comparar se o "file.mimeType" (tipo de arquivo) começa com image/ + (formato) do arquivo, assim como foi feito para o áudio. Confira a imagem abaixo:

[block:image]{"images":[{"image":["https://files.readme.io/6291b8bb5c1840b9ee157b48677d63afdf81b190962700520d60f28f33defc68-image.png",null,""],"align":"center","border":true}]}[/block]

* Grave o "Content" (resultado da transcrição da imagem) em uma variável

  ![](https://files.readme.io/580a4203a135f4df22c16ef8e685b2a13ca6f231a89652a3dbdd68a05cd74861-image.png)
* Após esses passos basta ligar o node "Set" (que contém a variável da transcrição da imagem) ao "Merge". Como mostra a imagem inicial desse documento
* Salve seu workflow.

<br />

Seguindo esse rápido tutorial será possível processar imagens com IA.

---
<!-- https://flwchat.readme.io/reference/criar-token-para-integração.md -->
# Criar token para integração

Um token permanente permite que você autentique e autorize seu aplicativo sem ter que implementar fluxos de autenticação. Basta criar um novo token e usá-lo para autenticação onde quiser.

Para criar um token de autenticação clique em **Ajustes > Integrações > Integração via API (Configurar)**. Em seguida, clique em **Novo** e adicione um nome para o token.

[block:image]
{
  "images": [
    {
      "image": [
        "https://files.readme.io/828e12c05b6f3fcf45df249ebad77a6391c8fc35c503fe25f7af7f54e28dcfde-Token.gif",
        "",
        ""
      ],
      "align": "center"
    }
  ]
}
[/block]

### Uso do token em uma chamada Http

Para utilizar o token permanente, você deve incluí-lo no cabeçalho (header) da requisição HTTP. Use o formato abaixo para garantir o acesso:

**Header "Authorization":** Bearer {seu\_token\_aqui}

```curl
curl -X GET "https://api.flw.chat/v1/channel" \
     -H "Authorization: Bearer pn_TOKEN_PERMANENTE"
```

### Orientações de segurança

**Geração do Token:** Você pode gerar um novo token permanente sempre que precisar, informe o nome da plataforma que irá utilizar o token para que você consiga identificar no futuro. Esse token é uma chave única que permite acesso direto aos nossos serviços, sem necessidade de login contínuo.

**Uso do Token:** O token permanente pode ser utilizado em integrações externas e ferramentas que precisem acessar sua conta. Lembre-se de mantê-lo seguro, pois ele dá acesso direto à sua conta.

**Revogação do Token:** Você tem o controle total do token permanente. Caso não precise mais dele ou queira reforçar a segurança, você pode excluí-lo a qualquer momento. Uma vez excluído, todas as integrações que utilizavam esse token deixarão de funcionar.

**Segurança:** Recomendamos não compartilhar seu token com terceiros e, se suspeitar de algum uso indevido, exclua-o imediatamente e gere um novo.

---
<!-- https://flwchat.readme.io/reference/make.md -->
# MAKE

O **Make.com** é uma plataforma de automação que permite criar fluxos de trabalho personalizados para integrar diferentes aplicativos e serviços, eliminando tarefas manuais e repetitivas. Com uma interface visual intuitiva, os usuários podem conectar ferramentas e configurar gatilhos e ações para automatizar processos.

### Como funciona a contagem:

* **Operação**: Cada vez que um módulo em um cenário é executado, ele conta como uma operação. Por exemplo:
  * Buscar dados em uma planilha: 1 operação.
  * Enviar uma mensagem via e-mail ou Slack: 1 operação.
  * Processar dados de várias linhas: cada linha pode contar como uma operação separada.
* **Cobrança**:
  * **Plano contratado**: Cada plano (Gratuito, Core, Pro, etc.) tem um limite de operações mensais.
    * **Exemplo**: Um plano Core pode oferecer 10.000 operações por mês.
  * **Excedente**: Se o limite for atingido, os cenários param de executar até que:
    * O limite seja renovado no próximo ciclo.
    * Você faça um upgrade para um plano superior.

### Autenticação - Make.com

Um token permanente permite que você autentique e autorize seu aplicativo sem ter que implementar fluxos de autenticação OAuth 2.0. Basta criar um novo token e usá-lo para autenticação onde quiser.

Tutorial de instalação do aplicativo wtschat no Make.com

Passos para instalação

1. ### Acesse o Link do Aplicativo Make

   Abra o navegador e acesse o [link ](https://www.make.com/en/hq/app-invitation/0e94c36cbd3949661d56ad6aa33a80df)específico do aplicativo Make. Clique no botão “Instalar” para iniciar o processo.

   ![](https://files.readme.io/dab813e8d75ffeaec47b23d825d9d2b37b833d63a144a6f471ee33e5f04f7e83-image.png)
2. ### Complete a Instalação do Aplicativo

Você será redirecionado para uma página onde deverá selecionar a organização na qual deseja instalar o aplicativo. Selecione a organização desejada e clique no botão “Instalar” localizado no canto inferior direito da tela.\
Observação: A instalação só pode ser feita em uma organização na qual você possui a função de “administrador” ou “desenvolvedor de aplicativos”.

[block:image]
{
  "images": [
    {
      "image": [
        "https://files.readme.io/ef661dee5d39df4742fde9a3c0c359d2a85f53ee3456126d3a8619ce3190f063-INSTALAO_1.gif",
        "",
        ""
      ],
      "align": "center"
    }
  ]
}
[/block]

3. ### Confirmação de Instalação
   Uma notificação aparecerá na tela indicando que a instalação foi concluída com sucesso. Clique em "Finish Wizard"

<br />

4. ### Acesse o Make
   Abra o Make e acesse a organização onde você instalou o aplicativo. Navegue até “Aplicativos Instalados” para visualizar o ícone e o nome do aplicativo "wts.chat".

![](https://files.readme.io/76c4ae2777e38063a22bb3cf1ada4ee603fbc98602785c16ba4a7c7ca59a36f2-image.png)

*Visualize o ícone do aplicativo wts.chat em Aplicativos Instalados*

<br />

5. ### Crie um Novo Cenário
   Vá para a seção “Cenários”. Clique no botão “Crie um novo cenário” no canto superior direito da tela.

[block:image]
{
  "images": [
    {
      "image": [
        "https://files.readme.io/f6ead864644441c5328cf2630f30d8962742d533f63ea778af58321aa8a69bae-create_scenario.gif",
        "",
        ""
      ],
      "align": "center"
    }
  ]
}
[/block]

6. ### Adicione o módulo wtsChat ao Cenário
   Após criar o cenário, um pop-up será exibido permitindo que você pesquise os aplicativos. Digite "wts chat" na barra de pesquisa. Você poderá ver todos os módulos do wts chat, organizados em grupos como “Contatos”, “Mensagens”, “Painéis”, etc.

[block:image]
{
  "images": [
    {
      "image": [
        "https://files.readme.io/c653eb4d846c64beefb01adf8166fa3a66824241f2e741d367cab70cce6c5cd1-INSTALAO_2.gif",
        "",
        ""
      ],
      "align": "center"
    }
  ]
}
[/block]

---
<!-- https://flwchat.readme.io/reference/n8n.md -->
# N8N

O **n8n** é uma plataforma **LowCode** que permite criar automações de maneira intuitiva, sem a necessidade de conhecimento profundo em programação. Com o n8n, é possível integrar nossa plataforma com diversos serviços externos, aumentando significativamente as possibilidades ao utilizar nossa API.

# Modalidades de uso

### n8n.cloud

Você pode optar por contratar o n8n como **serviço na nuvem**, pagando por execução dos fluxos. Existem diferentes pacotes com limites de execuções mensais, atendendo às necessidades da maioria dos usuários. Este modelo é ideal para aqueles que buscam simplicidade e não querem se preocupar com manutenção de infraestrutura.\
Veja mais [aqui](https://n8n.io).

### Auto-hospedado (Self-hosted)

Para cenários em que há grande volume de integrações e automações, o custo do n8n na nuvem pode ser um fator limitante. Nesse caso, é possível instalar o n8n em um servidor próprio, permitindo execuções ilimitadas e reduzindo os custos relacionados.

Com a opção de **auto-hospedagem**, você paga apenas pelo servidor, o que é vantajoso para quem deseja flexibilidade e escalabilidade sem restrição de execuções.\
Veja mais [aqui](https://docs.n8n.io/hosting/).

***

# Módulo nativo para uso Self-hosted

Desenvolvemos um módulo nativo para facilitar a integração;

> 📘 Atenção - Community Nodes
>
> Para construção do módulo utilizamos a funcionalidade **Community Nodes** do N8N, esta funcionalidade está disponível apenas para contas **auto-hospedadas (self-hosted)**.
>
> Os usuários com n8n.cloud ainda não têm acesso a essa funcionalidade.

### Passos para instalação

**1 - Acesse as configurações na página inicial do n8n. Para isso, clique no menu de configurações no canto inferior esquerdo, em seguida clique em “Settings”/ “Configurações”.**

[block:image]
{
  "images": [
    {
      "image": [
        "https://files.readme.io/71de7612ae22b4af7730ebc6dec92b7ffa7d5bd0db6ba32f4b97dfe72df00491-chrome-capture-2024-11-19_2.gif",
        "",
        "Configurações da plataforma"
      ],
      "align": "center",
      "caption": "Configurações da plataforma"
    }
  ]
}
[/block]

**2 - Em seguida, no menu de opções clique em “Community nodes”/ “Nós da comunidade”.**

[block:image]
{
  "images": [
    {
      "image": [
        "https://files.readme.io/0ecb7ffaaa79d7602cd7272e58fa61da6ff43b6600e4a3b961f9cbf64cf0a34a-community.png",
        "",
        "Opção \"Community nodes\""
      ],
      "align": "center",
      "caption": "Opção \"Community nodes\""
    }
  ]
}
[/block]

**3 - Clique em “Install comunnity nodes”.**

Adicione o nome do pacote npm e aceite os termos de instalação e clique em install.\
**Nome do pacote**: n8n-nodes-wts.

[block:image]
{
  "images": [
    {
      "image": [
        "https://files.readme.io/a0f9d80c267de39a3188e62fc2a5c59bcd504b8cd2bfe691d001824a655b4f00-Nome_NPM.png",
        "",
        "Defina o nome do pacote: **n8n-nodes-wts**"
      ],
      "align": "center",
      "caption": "Defina o nome do pacote: **n8n-nodes-wts**"
    }
  ]
}
[/block]

### 🎉 Pronto, agora é só usar...

***

### Uso do módulo

* Clique no painel de nós, no canto superior direito e busque por “wts chat” para listar as ações disponíveis.

[block:image]{"images":[{"image":["https://files.readme.io/deb34f3d8488b542c6936a683d2025997f8268ed5d76c8b67f7c962711e5523a-zoom.gif","",""],"align":"center"}]}[/block]

Para utilizar o módulo, é necessário ter um token permanente, saiba mais [aqui](https://flwchat.readme.io/reference/criar-token-para-integra%C3%A7%C3%A3o) .

Após adicionar um dos nós, clique em **Credential to connect with** e **Create new credential**. Escolha um nome que identifique a sua conta na plataforma. Para finalizar, clique em **salvar**.

[block:image]
{
  "images": [
    {
      "image": [
        "https://files.readme.io/bdeaf66ba592ecbe7ad27a56df035e7f89ba9ce940921788a4e361e8416fc52b-chrome-capture-2024-11-19_5.gif",
        "",
        ""
      ],
      "align": "center",
      "border": true
    }
  ]
}
[/block]

Preencha as outras opções do nó e execute.

### 🎉 Pronto você deu o primeiro passo para realizar as integrações.

---
<!-- https://flwchat.readme.io/reference/get_v2-file.md -->
# Obter url para upload

Envie os metadados do arquivo e você receberá uma URL e deverá fazer upload para ela usando o método PUT<br /> Após enviar o conteúdo do arquivo, faça uma chamada para o endpont POST /core/v2/file

---
<!-- https://flwchat.readme.io/reference/post_v2-file.md -->
# Salvar arquivo

Após o upload do arquivo na URL fornecida na rota GET /core/v2/file execute este metodo para obter o ID do arquivo<br />O Id do arquivo pode ser fornecido no envio de mensagens. <br /><br />O FileId pode ser reaproveitado, não sendo necessário novos uploads para o mesmo arquivo.

---
<!-- https://flwchat.readme.io/reference/get_v1-custom-field.md -->
# Listar

---
<!-- https://flwchat.readme.io/reference/get_v1-portfolio.md -->
# Listar

Listagem paginada de carteiras.

---
<!-- https://flwchat.readme.io/reference/get_v1-portfolio-id-contact.md -->
# Listar contatos

Listagem de contatos associados a uma carteira.

---
<!-- https://flwchat.readme.io/reference/post_v1-portfolio-id-contact.md -->
# Adicionar contato

Adicione um contato em uma carteira.

---
<!-- https://flwchat.readme.io/reference/delete_v1-portfolio-id-contact.md -->
# Remover contato

Remova um contato de uma carteira.

---
<!-- https://flwchat.readme.io/reference/post_v1-portfolio-id-contact-batch.md -->
# Adicionar contatos

Adicione contatos em uma carteira adicionando um filtro.

---
<!-- https://flwchat.readme.io/reference/delete_v1-portfolio-id-contact-batch.md -->
# Remover contatos

Remova contatos de uma carteira adicionando um filtro.

---
<!-- https://flwchat.readme.io/reference/get_v1-contact.md -->
# Listar

Listagem paginada de contatos. Para resultados mais específicos, utilize o endpoint `/filter`.

---
<!-- https://flwchat.readme.io/reference/post_v1-contact.md -->
# Criar

---
<!-- https://flwchat.readme.io/reference/post_v1-contact-filter.md -->
# Filtrar

Filtragem paginada de contatos.

---
<!-- https://flwchat.readme.io/reference/get_v1-contact-phonenumber-phone.md -->
# Obter por Número de telefone

---
<!-- https://flwchat.readme.io/reference/put_v1-contact-phonenumber-phone.md -->
# Atualizar por Número de telefone

---
<!-- https://flwchat.readme.io/reference/get_v1-contact-id.md -->
# Obter por ID

---
<!-- https://flwchat.readme.io/reference/put_v2-contact-id.md -->
# Atualizar

---
<!-- https://flwchat.readme.io/reference/post_v1-contact-phonenumber-phone-tags.md -->
# Atualizar etiquetas por Número de telefone

---
<!-- https://flwchat.readme.io/reference/post_v1-contact-id-tags.md -->
# Atualizar etiquetas

---
<!-- https://flwchat.readme.io/reference/post_v2-contact-batch.md -->
# Salvar em massa

Permite salvar até 100 contatos em uma única requisição.<br />Se um contato com o mesmo número de telefone, Instagram ou endereço de email já existir, este apenas será atualizado.

---
<!-- https://flwchat.readme.io/reference/get_v1-contact-custom-field.md -->
# Campos personalizados

---
<!-- https://flwchat.readme.io/reference/post_v1-department.md -->
# Criar

---
<!-- https://flwchat.readme.io/reference/get_v2-department.md -->
# Listar

---
<!-- https://flwchat.readme.io/reference/get_v1-department-id.md -->
# Obter por ID

---
<!-- https://flwchat.readme.io/reference/put_v1-department-id.md -->
# Atualizar

---
<!-- https://flwchat.readme.io/reference/delete_v1-department-id.md -->
# Excluir

---
<!-- https://flwchat.readme.io/reference/put_v1-department-id-agents.md -->
# Atualizar usuários

---
<!-- https://flwchat.readme.io/reference/get_v1-department-id-channel.md -->
# Listar canais

---
<!-- https://flwchat.readme.io/reference/get_v1-tag.md -->
# Listar

---
<!-- https://flwchat.readme.io/reference/post_v1-tag.md -->
# Criar

Cria uma etiqueta na conta. A cor define automaticamente a cor do texto; quando omitida, a etiqueta é criada em `GRAY_600`.

---
<!-- https://flwchat.readme.io/reference/get_v1-tag-color.md -->
# Listar cores

Listagem das cores disponíveis para etiquetas. O valor de `color` é o que deve ser informado na criação e na atualização.

---
<!-- https://flwchat.readme.io/reference/put_v1-tag-id.md -->
# Atualizar

Atualiza o nome e a cor de uma etiqueta. Quando a cor é omitida, a cor atual é mantida.

---
<!-- https://flwchat.readme.io/reference/delete_v1-tag-id.md -->
# Excluir

Exclui uma etiqueta. Quando a etiqueta estiver vinculada a contatos, a exclusão é recusada até que seja
confirmada com `removeFromContacts`, pois ela será removida de todos os contatos associados.

---
<!-- https://flwchat.readme.io/reference/get_v1-company-officehours.md -->
# Obter

---
<!-- https://flwchat.readme.io/reference/get_v1-agent.md -->
# Listar

---
<!-- https://flwchat.readme.io/reference/post_v1-agent.md -->
# Criar

---
<!-- https://flwchat.readme.io/reference/get_v1-agent-id.md -->
# Obter por ID

---
<!-- https://flwchat.readme.io/reference/put_v1-agent-id.md -->
# Atualizar

---
<!-- https://flwchat.readme.io/reference/delete_v1-agent-id.md -->
# Excluir

---
<!-- https://flwchat.readme.io/reference/post_v1-agent-id-departments.md -->
# Atualizar equipes

---
<!-- https://flwchat.readme.io/reference/post_v1-agent-id-status.md -->
# Alterar status

---
<!-- https://flwchat.readme.io/reference/post_v1-agent-id-logout.md -->
# Fazer logout

---
<!-- https://flwchat.readme.io/reference/get_v1-webhook-event.md -->
# Listar eventos

Listagem dos eventos de webhook que podem ser assinados.

---
<!-- https://flwchat.readme.io/reference/get_v1-webhook-subscription.md -->
# Listar assinaturas

Listagem das assinaturas de webhook ativas e inativas.

---
<!-- https://flwchat.readme.io/reference/post_v1-webhook-subscription.md -->
# Cria assinatura

Cria assinatura de webhook.

---
<!-- https://flwchat.readme.io/reference/get_v1-webhook-subscription-subscriptionid.md -->
# Busca assinatura por ID

Busca assinatura de webhook através do ID.

---
<!-- https://flwchat.readme.io/reference/put_v1-webhook-subscription-subscriptionid.md -->
# Atualiza assinatura

Atualiza assinatura de webhook.

---
<!-- https://flwchat.readme.io/reference/delete_v1-webhook-subscription-subscriptionid.md -->
# Remove assinatura

Remove assinatura de webhook.

---
<!-- https://flwchat.readme.io/reference/get_v1-channel.md -->
# Listar

Listagem de canais de atendimento.

---
<!-- https://flwchat.readme.io/reference/get_v1-chatbot.md -->
# Listar

Listagem de chatbots.

---
<!-- https://flwchat.readme.io/reference/post_v1-chatbot-send.md -->
# Enviar chatbot

Permite iniciar a execução de um chatbot.<br />Durante a execução do chatbot, a interação com a conversa fica desabilitada para atendentes na central de atendimento.<br />A execução pode ser cancelada a qualquer momento, via API ou através da central de atendimento.<br />Este endpoint segue as mesmas regras do canal de atendimento, por exemplo: uma conversa só pode ser iniciada no WhatsApp utilizando um modelo de mensagem.<br />Caso o contato não esteja cadastrado, ele será cadastrado automaticamente antes do envio.

---
<!-- https://flwchat.readme.io/reference/get_v2-session.md -->
# Listar

Listagem paginada de conversas.

---
<!-- https://flwchat.readme.io/reference/get_v2-session-id.md -->
# Obter por ID

---
<!-- https://flwchat.readme.io/reference/put_v1-session-id-transfer.md -->
# Transferir

---
<!-- https://flwchat.readme.io/reference/put_v1-session-id-assignee.md -->
# Atribuir usuário

---
<!-- https://flwchat.readme.io/reference/put_v1-session-id-complete.md -->
# Concluir

---
<!-- https://flwchat.readme.io/reference/put_v1-session-id-status.md -->
# Alterar status

---
<!-- https://flwchat.readme.io/reference/put_v2-session-id-partial.md -->
# Alterar

Atualiza um ou mais atributos de uma conversa. Para usar você deve informar o novo valor do atribuito e quais atributos serão atualizados.

---
<!-- https://flwchat.readme.io/reference/get_v1-session-id-message.md -->
# Listar mensagens

Listagem paginada de mensagens por ID de uma conversa.

---
<!-- https://flwchat.readme.io/reference/post_v1-session-id-message.md -->
# Enviar mensagem

Este endpoint segue as mesmas regras do canal de atendimento, por exemplo: uma conversa só pode ser iniciada no WhatsApp utilizando um modelo de mensagem.<br />Caso o contato não esteja cadastrado, ele será cadastrado automaticamente antes do envio.
O envio da mensagem será assincrono, ao enviar a mensagem será salva em uma fila de disparo, e será processada posteriormente.
Para verificar a situação do envio, consulte pelo endereço /chat/v1/message/{}/status

---
<!-- https://flwchat.readme.io/reference/post_v1-session-id-message-sync.md -->
# Enviar mensagem síncrona

Este endpoint segue as mesmas regras do canal de atendimento, por exemplo: uma conversa só pode ser iniciada no WhatsApp utilizando um modelo de mensagem.<br />Caso o contato não esteja cadastrado, ele será cadastrado automaticamente antes do envio.<br />O envio da mensagem será síncrono, então ele pode demorar um tempo até que o servidor do canal de atencimento responda com um status válido para a mensagem.<br />O tempo máximo que este metodo esperará uma resposta é de 25 segundos, após este tempo ele entregará a última situação da mensagem;

---
<!-- https://flwchat.readme.io/reference/post_v1-session-id-note.md -->
# Salvar nota interna

---
<!-- https://flwchat.readme.io/reference/get_v1-session-id-note.md -->
# Listar notas internas

Este endpoint permite a listagem de notas internas de um atendimento.

---
<!-- https://flwchat.readme.io/reference/get_v1-session-note-id.md -->
# Obter uma nota interna

Este endpoint permite a obtenção de uma nota interna por meio de seu ID.

---
<!-- https://flwchat.readme.io/reference/delete_v1-session-note-id.md -->
# Excluir uma nota interna

Este endpoint permite a exclusão de uma nota interna por meio de seu ID.

---
<!-- https://flwchat.readme.io/reference/post_v1-send-otp.md -->
# OTP

Envia uma senha OTP para um contato no WhatsApp.
OTP = One time password.
O campo Code é opcional; se não informado, será gerado um código de 5 dígitos aleatórios.
O campo SenderId pode ser usado para controle do seu sistema.
O CallbackUrl permite receber webhook quando a mensagem for entregue ou falhar.
Este endpoint tem rate limit individual e permite 1000 requisições a cada 2 minutos.

---
<!-- https://flwchat.readme.io/reference/get_v1-send-otp-id.md -->
# OTP status

Consulta o status atual de uma mensagem OTP enviada anteriormente.
O parâmetro id aceita o ID da mensagem ou o SenderId informado no envio.
Este endpoint tem rate limit individual e permite 1000 requisições a cada 2 minutos.

---
<!-- https://flwchat.readme.io/reference/post_v1-send-text.md -->
# Texto

Envia uma mensagem de texto simples para um contato.
O campo Text é obrigatório.
O campo DelayTyping simula o indicador "digitando..." por até 25 segundos antes de entregar a mensagem.
O campo CallbackUrl permite receber webhook quando a mensagem for entregue ou falhar.
Este endpoint tem rate limit individual e permite 1000 requisições a cada 2 minutos.

---
<!-- https://flwchat.readme.io/reference/post_v1-send-audio.md -->
# Áudio

Envia uma mensagem de áudio para um contato.
O campo FileIdOrUrl é obrigatório; informe uma URL pública ou o ID de um arquivo previamente cadastrado.
O arquivo deve seguir as regras do canal de atendimento (formato e tamanho).
O campo CallbackUrl permite receber webhook quando a mensagem for entregue ou falhar.
Este endpoint tem rate limit individual e permite 1000 requisições a cada 2 minutos.

---
<!-- https://flwchat.readme.io/reference/post_v1-send-video.md -->
# Vídeo

Envia uma mensagem de vídeo para um contato.
O campo FileIdOrUrl é obrigatório; informe uma URL pública ou o ID de um arquivo previamente cadastrado.
O arquivo deve seguir as regras do canal de atendimento (formato e tamanho).
O campo CallbackUrl permite receber webhook quando a mensagem for entregue ou falhar.
Este endpoint tem rate limit individual e permite 1000 requisições a cada 2 minutos.

---
<!-- https://flwchat.readme.io/reference/post_v1-send-image.md -->
# Imagem

Envia uma mensagem de imagem para um contato.
O campo FileIdOrUrl é obrigatório; informe uma URL pública ou o ID de um arquivo previamente cadastrado.
O arquivo deve seguir as regras do canal de atendimento (formato e tamanho).
O campo CallbackUrl permite receber webhook quando a mensagem for entregue ou falhar.
Este endpoint tem rate limit individual e permite 1000 requisições a cada 2 minutos.

---
<!-- https://flwchat.readme.io/reference/post_v1-send-document.md -->
# Documento

Envia uma mensagem de documento para um contato.
O campo FileIdOrUrl é obrigatório; informe uma URL pública ou o ID de um arquivo previamente cadastrado.
O arquivo deve seguir as regras do canal de atendimento (formato e tamanho).
O campo CallbackUrl permite receber webhook quando a mensagem for entregue ou falhar.
Este endpoint tem rate limit individual e permite 1000 requisições a cada 2 minutos.

---
<!-- https://flwchat.readme.io/reference/get_v1-send-message-id.md -->
# Mensagem status

Consulta o status atual de uma mensagem enviada anteriormente pelos endpoints de envio.
O parâmetro id aceita o ID da mensagem retornado no momento do envio.
Este endpoint tem rate limit individual e permite 1000 requisições a cada 2 minutos.

---
<!-- https://flwchat.readme.io/reference/post_v1-send-template.md -->
# Modelo

Envia um modelo de mensagem para um único destinatário.
O campo TemplateId é obrigatório e deve corresponder a um template cadastrado no canal.
O campo Parameters deve ser preenchido caso o template possua variáveis.
O campo FileIdOrUrl é necessário apenas para templates com mídia.
O CallbackUrl permite receber webhook quando a mensagem for entregue ou falhar.
Este endpoint tem rate limit individual e permite 1000 requisições a cada 2 minutos.

---
<!-- https://flwchat.readme.io/reference/post_v1-send-template-batch.md -->
# Modelo (em lote)

Envia um modelo de mensagem para múltiplos destinatários em uma única requisição.
O campo TemplateId é compartilhado por todos os destinatários.
Cada item da lista deve conter o destinatário (To) e pode ter parâmetros e arquivo próprios.
O campo FileIdOrUrl por item é necessário apenas para templates com mídia.
O CallbackUrl por item permite receber webhook individual por mensagem.
As opções (User, Department, EnableBot, etc.) se aplicam a todos os atendimentos criados no lote.
É possível enviar até 100 mensagens por requisição.
Este endpoint tem rate limit individual e permite 1000 requisições a cada 2 minutos.

---
<!-- https://flwchat.readme.io/reference/post_v1-send-typing.md -->
# Digitando

Envia o indicador de "digitando" para o contato da conversa informada.
            
**Disponível apenas para canais CloudAPI (WhatsApp Business API oficial) e WebChat.**
Para outros tipos de canal, a requisição é aceita porém não produz efeito.

---
<!-- https://flwchat.readme.io/reference/post_v1-send-chatbot.md -->
# Chatbot

Enfileira o disparo de um chatbot para um contato.<br />
O processamento ocorre de forma assíncrona após o retorno deste endpoint.<br />
Este endpoint segue as mesmas regras do canal de atendimento, por exemplo: uma conversa só pode ser iniciada no WhatsApp utilizando um modelo de mensagem.<br />
Caso o contato não esteja cadastrado, ele será cadastrado automaticamente antes do envio.<br />
Este endpoint tem rate limit individual e permite 1000 requisições a cada 2 minutos.

---
<!-- https://flwchat.readme.io/reference/get_v1-send-chatbot-id.md -->
# Chatbot status

Consulta o status atual de um disparo de chatbot enfileirado anteriormente pelos endpoints de envio.<br />
O parâmetro id aceita o ID retornado no momento do envio.<br />
Este endpoint tem rate limit individual e permite 1000 requisições a cada 2 minutos.

---
<!-- https://flwchat.readme.io/reference/post_v1-send-chatbot-batch.md -->
# Chatbot (em lote)

Enfileira o disparo de um chatbot para múltiplos contatos em uma única requisição.<br />
O campo BotKey é compartilhado por todos os destinatários.<br />
Cada item da lista deve conter o destinatário (To) ou o ID da conversa (SessionId).<br />
O processamento ocorre de forma assíncrona após o retorno deste endpoint.<br />
Este endpoint tem rate limit individual e permite 1000 requisições a cada 2 minutos.

---
<!-- https://flwchat.readme.io/reference/post_v1-message-send.md -->
# Enviar

Este endpoint segue as mesmas regras do canal de atendimento, por exemplo: uma conversa só pode ser iniciada no WhatsApp utilizando um modelo de mensagem.<br />Caso o contato não esteja cadastrado, ele será cadastrado automaticamente antes do envio.<br />O envio da mensagem será assincrono, ao enviar a mensagem será salva em uma fila de disparo, e será processada posteriormente.<br />Para verificar a situação do envio, consulte pelo endereço /chat/v1/message/{id}/status

---
<!-- https://flwchat.readme.io/reference/post_v1-message-send-sync.md -->
# Enviar síncrono

Este endpoint segue as mesmas regras do canal de atendimento, por exemplo: uma conversa só pode ser iniciada no WhatsApp utilizando um modelo de mensagem.<br />Caso o contato não esteja cadastrado, ele será cadastrado automaticamente antes do envio.<br />O envio da mensagem será síncrono, então ele pode demorar um tempo até que o servidor do canal de atencimento responda com um status válido para a mensagem.<br />O tempo máximo que este metodo esperará uma resposta é de 25 segundos, após este tempo ele entregará a última situação da mensagem;

---
<!-- https://flwchat.readme.io/reference/get_v1-message-id.md -->
# Obter por ID

---
<!-- https://flwchat.readme.io/reference/get_v1-message-id-status.md -->
# Obter status por ID

---
<!-- https://flwchat.readme.io/reference/delete_v1-message-id.md -->
# Excluir mensagem

---
<!-- https://flwchat.readme.io/reference/get_v1-message.md -->
# Listar

Listagem paginada de mensagens por ID de uma conversa.

---
<!-- https://flwchat.readme.io/reference/get_v1-scheduled-message.md -->
# Listar

Listagem paginada de mensagens agendadas com filtros opcionais.

---
<!-- https://flwchat.readme.io/reference/post_v1-scheduled-message.md -->
# Criar

Cria uma nova mensagem agendada com os dados fornecidos.

---
<!-- https://flwchat.readme.io/reference/get_v1-scheduled-message-id.md -->
# Obter por ID

Retorna os detalhes de uma mensagem agendada específica.

---
<!-- https://flwchat.readme.io/reference/put_v1-scheduled-message-id.md -->
# Atualizar

Atualiza uma mensagem agendada existente. Mensagens já enviadas não podem ser editadas.

---
<!-- https://flwchat.readme.io/reference/post_v1-scheduled-message-id-cancel.md -->
# Cancelar

Cancela uma mensagem agendada específica. Apenas mensagens com status agendado podem ser canceladas.

---
<!-- https://flwchat.readme.io/reference/post_v1-scheduled-message-batch-cancel.md -->
# Cancelar em massa

Cancela em massa mensagens agendadas. Apenas mensagens com status agendado podem ser canceladas.

---
<!-- https://flwchat.readme.io/reference/get_v1-template.md -->
# Listar

Listagem paginada de modelos de mensagem.

---
<!-- https://flwchat.readme.io/reference/get_v1-sequence.md -->
# Listar

Listagem paginada de sequências.

---
<!-- https://flwchat.readme.io/reference/get_v2-sequence-id-contact.md -->
# Listar contatos

Listagem paginada de contatos da sequência.

---
<!-- https://flwchat.readme.io/reference/post_v1-sequence-id-contact.md -->
# Adicionar contato

Adicione um contato em uma sequência.

---
<!-- https://flwchat.readme.io/reference/delete_v1-sequence-id-contact.md -->
# Remover contato

Remova um contato de uma sequência.

---
<!-- https://flwchat.readme.io/reference/post_v1-sequence-id-contact-batch.md -->
# Adicionar contatos

Adicione contatos em uma sequência adicionando um filtro.

---
<!-- https://flwchat.readme.io/reference/delete_v1-sequence-id-contact-batch.md -->
# Remover contatos

Remova contatos de uma sequência adicionando um filtro.

---
<!-- https://flwchat.readme.io/reference/get_v2-panel-card.md -->
# Listar

Listagem paginada de cards.

---
<!-- https://flwchat.readme.io/reference/post_v2-panel-card.md -->
# Criar

---
<!-- https://flwchat.readme.io/reference/get_v2-panel-card-id.md -->
# Obter por ID

---
<!-- https://flwchat.readme.io/reference/put_v3-panel-card-id.md -->
# Atualizar

---
<!-- https://flwchat.readme.io/reference/post_v2-panel-card-id-duplicate.md -->
# Duplicar

---
<!-- https://flwchat.readme.io/reference/get_v1-panel-card-cardid-note.md -->
# Listar anotações

Listagem paginada de anotações.

---
<!-- https://flwchat.readme.io/reference/post_v1-panel-card-cardid-note.md -->
# Adicionar anotação

---
<!-- https://flwchat.readme.io/reference/delete_v1-panel-card-cardid-note-noteid.md -->
# Remover anotação

---
<!-- https://flwchat.readme.io/reference/get_v2-panel.md -->
# Listar painéis

---
<!-- https://flwchat.readme.io/reference/get_v1-panel-id.md -->
# Obter por ID

---
<!-- https://flwchat.readme.io/reference/get_v1-panel-id-custom-fields.md -->
# Campos personalizados

---
<!-- https://flwchat.readme.io/reference/get_v1-panel-id-lost-reason.md -->
# Listar motivos de perda

Listagem paginada de motivos de perda do painel.