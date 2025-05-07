# Implementação de MVP: Servidor MCP Local com Agente OpenAI e Claude (Bedrock)

## 1. Visão Geral do Projeto

Este documento detalha a implementação de um MVP (Minimum Viable Product) que integra um servidor MCP (Model Context Protocol) local com agentes da OpenAI e Claude (via AWS Bedrock). O objetivo é criar um ambiente de teste onde agentes de IA possam interagir com ferramentas locais (notas e Jira) através do protocolo MCP, com suporte a contexto conversacional e tool use robusto.

## 2. Estrutura Final do Projeto

```
mcp-mvp/
├── src/
│   ├── index.ts               # Servidor MCP com Express, endpoints, tools e SSE transport
│   ├── web/
│   │   └── index.html         # Interface web de chat e listagem de notas
│   └── client/
│       ├── index.ts           # Cliente OpenAI com SSE transport
│       └── agents/
│           └── assistant.ts   # Implementação do agente assistente
├── build/                     # Código compilado (TypeScript)
│   ├── index.js
│   ├── web/
│   │   └── index.html
│   └── client/
│       ├── index.js
│       └── agents/
│           └── assistant.js
├── test-puppeteer.js          # Script de teste automatizado da interface web
├── package.json
├── tsconfig.json
└── README.md
```

## 3. Funcionalidades Implementadas

- **Servidor MCP**:
  - Expõe endpoints via Express para conexão SSE, chat e listagem de notas.
  - Ferramenta `create_note` para criar notas de texto.
  - Ferramenta `get_jira_issue` para buscar dados de uma issue no Jira Cloud (autenticação via variáveis de ambiente).
  - Recurso `note` para listar e acessar notas existentes.
  - Endpoint HTTP `/notas` para retornar todas as notas em JSON.
  - Endpoint POST `/chat` para integração do chat web com o agente real.
  - Serve arquivos estáticos da interface web.

- **Cliente OpenAI/MCP**:
  - Conecta-se ao servidor MCP usando SSEClientTransport.
  - Cria um assistente OpenAI com acesso às ferramentas expostas.
  - Utiliza o conceito de thread/conversationId nativo do OpenAI para manter o contexto.

- **Claude (Bedrock)**:
  - O frontend mantém o histórico de mensagens em memória por sessão (enquanto a aba estiver aberta) e envia o histórico completo a cada requisição.
  - O backend processa o contexto enviado pelo frontend, sem persistência de histórico.
  - Suporte a tool use dinâmico (function calling) para todas as ferramentas expostas.
  - O resultado de qualquer tool é retornado ao modelo como mensagem JSON estruturada (role: 'user'), garantindo robustez e compatibilidade com Bedrock.
  - O fluxo suporta tool use encadeado e multi-step, permitindo automações avançadas.

- **Interface Web**:
  - Chat integrado ao agente real (OpenAI/MCP ou Claude/Bedrock).
  - Listagem de notas criadas, com botão para atualizar.

- **Testes Automatizados**:
  - Script Puppeteer para testar o fluxo de chat e listagem de notas.

## 4. Exemplo de Uso das Tools

- **Buscar issue no Jira:**
  - Você: "Busque a issue CR-618 no Jira"
  - Agente: (executa get_jira_issue, retorna resultado como JSON)
    ```json
    {"content":[{"type":"text","text":"Issue CR-618: [UI/UX] Desenhar Fluxo SCR\nStatus: CONCLUIDO"}]}
    ```
  - O modelo pode usar esse resultado para criar uma nota, responder ao usuário, ou encadear outras ações.

- **Criar nota baseada em issue:**
  - Você: "Crie uma nota com os dados da issue CR-618"
  - Agente: (executa get_jira_issue, depois create_note, ambos retornam resultado como JSON)

## 5. Instruções de Build, Execução e Teste

### **Build e execução do servidor**

1. Instale as dependências:
   ```sh
   npm install
   ```
2. Compile o projeto e copie a interface web para o build:
   ```sh
   npm run build
   ```
3. Inicie o servidor:
   ```sh
   node build/index.js
   ```

### **Acessando a interface web e endpoints**
- Interface web: [http://localhost:3333/](http://localhost:3333/)
- Listagem de notas (JSON): [http://localhost:3333/notas](http://localhost:3333/notas)

### **Testando o chat integrado**
- Envie mensagens pelo chat web. O agente responde de verdade e pode acionar qualquer tool MCP (ex: criar nota, buscar issue no Jira).
- Exemplo de comandos:
  - "Crie uma nota chamada Teste com conteúdo Olá mundo"
  - "Busque a issue CR-618 no Jira"
  - "Crie uma nota com os dados da issue CR-618"

### **Testes Automatizados com Puppeteer**

1. Instale o Puppeteer (se ainda não instalou):
   ```sh
   npm install puppeteer
   ```
2. Com o servidor rodando, execute:
   ```sh
   node test-puppeteer.js
   ```
3. O script irá:
   - Abrir a interface web
   - Enviar uma mensagem para criar uma nota
   - Imprimir o conteúdo do chat e das notas no terminal

## 6. Observações e Troubleshooting

- O diretório `src/` deve estar dentro de `mcp-mvp/`.
- Sempre rode `npm run build` após alterações no código fonte.
- O endpoint `/notas` e a interface web só funcionam se o build estiver atualizado e o servidor rodando a partir de `build/index.js`.
- Se aparecer "Cannot GET /notas" ou "Cannot GET /", verifique se o build está correto e se o diretório `web` foi copiado para `build/web`.
- O chat web agora está integrado ao agente real, permitindo testes completos de ponta a ponta.
- O backend está preparado para evoluir para novas tools e fluxos multi-step, bastando adicionar novas definições MCP.

---

O projeto está funcional, com chat web integrado ao agente OpenAI/MCP ou Claude/Bedrock, endpoint de notas, integração robusta com Jira, e testes automatizados. Pronto para evoluções futuras!
