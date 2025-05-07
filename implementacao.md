# Implementação de MVP: Servidor MCP Local com Agente OpenAI e Claude (Bedrock/API Direta)

## 1. Visão Geral do Projeto

Este documento detalha a implementação de um MVP (Minimum Viable Product) que integra um servidor MCP (Model Context Protocol) local com agentes da OpenAI e Claude (via AWS Bedrock e API Anthropic direta). O objetivo é criar um ambiente de teste onde agentes de IA possam interagir com ferramentas locais (notas e Jira) através do protocolo MCP, com suporte a contexto conversacional e tool use robusto.

## 2. Estrutura Final do Projeto

```
mcp-mvp/
├── src/
│   ├── index.ts               # Servidor MCP com Express, endpoints, tools e SSE transport
│   ├── jiraTool.ts            # Implementação de ferramentas do Jira expandidas
│   ├── anthropicClient.ts     # Cliente para API direta do Anthropic
│   ├── web/
│   │   └── index.html         # Interface web de chat e listagem de notas
│   └── client/
│       ├── index.ts           # Cliente OpenAI com SSE transport
│       └── agents/
│           └── assistant.ts   # Implementação do agente assistente
├── build/                     # Código compilado (TypeScript)
│   ├── index.js
│   ├── jiraTool.js
│   ├── anthropicClient.js
│   ├── web/
│   │   └── index.html
│   └── client/
│       ├── index.js
│       └── agents/
│           └── assistant.js
├── test-puppeteer.js          # Script de teste automatizado da interface web
├── test-jira.js               # Testes de ferramentas Jira
├── test-jira-tools.js         # Testes expandidos para ferramentas Jira
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

## 3. Funcionalidades Implementadas

- **Servidor MCP**:
  - Expõe endpoints via Express para conexão SSE, chat e listagem de notas.
  - Ferramenta `create_note` para criar notas de texto.
  - Ferramentas Jira expandidas:
    - `get_jira_issue` para buscar dados básicos de uma issue no Jira Cloud
    - `get_detailed_jira_issue` para buscar dados detalhados de uma issue
    - `get_jira_issue_comments` para buscar comentários de uma issue
    - `get_jira_issue_transitions` para buscar transições disponíveis
    - `search_jira_issues` para buscar issues com query JQL
    - `get_jira_issue_watchers` para buscar observadores de uma issue
    - `get_jira_issue_attachments` para buscar anexos de uma issue
    - `get_jira_issue_sprints` para buscar sprints associados a uma issue
  - Recurso `note` para listar e acessar notas existentes.
  - Endpoint HTTP `/notas` para retornar todas as notas em JSON.
  - Endpoint POST `/chat` para integração do chat web com os agentes.
  - Serve arquivos estáticos da interface web.

- **Cliente OpenAI/MCP**:
  - Conecta-se ao servidor MCP usando SSEClientTransport.
  - Cria um assistente OpenAI com acesso às ferramentas expostas.
  - Utiliza o conceito de thread/conversationId nativo do OpenAI para manter o contexto.

- **Claude (Bedrock)**:
  - O frontend mantém o histórico de mensagens em memória por sessão.
  - O backend processa o contexto enviado pelo frontend, sem persistência de histórico.
  - Suporte a tool use dinâmico (function calling) para todas as ferramentas expostas.
  - O resultado de qualquer tool é retornado ao modelo como mensagem JSON estruturada.
  - O fluxo suporta tool use encadeado e multi-step, permitindo automações avançadas.

- **Claude (API Direta)**:
  - Implementação com API Anthropic direta utilizando o SDK oficial.
  - Gerenciamento robusto de histórico de conversas e tool use.
  - Suporte a diversos modelos Claude (ver tabela de modelos no README).
  - Melhor tratamento de tool use e reconhecimento de ferramenta quando comparado à versão Bedrock.
  - Formatação adequada das mensagens para evitar problemas com texto aninhado.
  - Tratamento adequado dos campos ID para tool_use e tool_result.

- **Interface Web**:
  - Chat integrado aos agentes (OpenAI/MCP, Claude/Bedrock, Claude/API Direta).
  - Seleção de modelo via dropdown.
  - Listagem de notas criadas, com botão para atualizar.
  - Indicadores de carregamento e tratamento de erros.

- **Testes Automatizados**:
  - Script Puppeteer para testar o fluxo de chat e listagem de notas.
  - Testes específicos para ferramentas do Jira.

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

- **Buscar informações detalhadas de uma issue:**
  - Você: "Busque detalhes completos da issue CR-618 incluindo comentários"
  - Agente: (executa get_detailed_jira_issue e get_jira_issue_comments, retornando informações detalhadas)

## 5. Instruções de Build, Execução e Teste

### **Build e execução do servidor**

1. Instale as dependências:
   ```sh
   npm install
   ```
2. Configure as variáveis de ambiente em um arquivo `.env`:
   ```
   OPENAI_API_KEY=sua_chave_openai
   AWS_ACCESS_KEY_ID=sua_aws_access_key
   AWS_SECRET_ACCESS_KEY=sua_aws_secret_key
   AWS_REGION=sua_aws_region
   ANTHROPIC_API_KEY=sua_chave_anthropic
   JIRA_BASE_URL=sua_url_jira
   JIRA_USERNAME=seu_usuario_jira
   JIRA_API_TOKEN=seu_token_jira
   ```
3. Compile o projeto:
   ```sh
   npm run build
   ```
4. Inicie o servidor:
   ```sh
   node build/index.js
   ```

### **Acessando a interface web e endpoints**
- Interface web: [http://localhost:3333/](http://localhost:3333/)
- Listagem de notas (JSON): [http://localhost:3333/notas](http://localhost:3333/notas)

### **Testando o chat integrado**
- Envie mensagens pelo chat web. 
- Selecione o modelo desejado no dropdown:
  - "OpenAI": Utiliza a API de assistentes da OpenAI
  - "Claude (Bedrock)": Utiliza Claude via AWS Bedrock
  - "Claude (API Direct)": Utiliza a API Anthropic diretamente (melhor suporte para tool use)
- Exemplos de comandos:
  - "Crie uma nota chamada Teste com conteúdo Olá mundo"
  - "Busque a issue CR-618 no Jira"
  - "Busque detalhes completos da issue CR-618"
  - "Busque os comentários da issue CR-618"
  - "Crie uma nota com os dados da issue CR-618"

### **Testes Automatizados com Puppeteer**

1. Com o servidor rodando, execute:
   ```sh
   node test-puppeteer.js
   ```
2. O script irá:
   - Abrir a interface web
   - Enviar uma mensagem para criar uma nota
   - Imprimir o conteúdo do chat e das notas no terminal

### **Testes das ferramentas do Jira**

1. Execute:
   ```sh
   node test-jira.js
   ```
   ou
   ```sh
   node test-jira-tools.js
   ```
2. Os scripts testam as diferentes ferramentas do Jira implementadas.

## 6. Observações e Troubleshooting

- O diretório `src/` deve estar dentro de `mcp-mvp/`.
- Sempre rode `npm run build` após alterações no código fonte.
- O endpoint `/notas` e a interface web só funcionam se o build estiver atualizado e o servidor rodando a partir de `build/index.js`.
- Se aparecer "Cannot GET /notas" ou "Cannot GET /", verifique se o build está correto e se o diretório `web` foi copiado para `build/web`.
- Se aparecer "Modelo não suportado", verifique se as chaves API estão configuradas corretamente no arquivo `.env`.
- Para a API direta do Anthropic, confirme que está usando um ID de modelo válido (veja os modelos suportados no README).
- Se as chamadas de ferramentas falharem com Claude (Bedrock), tente a opção Claude (API Direct) que tem tratamento aprimorado para execução de ferramentas.

---

O projeto está funcional, com chat web integrado aos agentes (OpenAI, Claude/Bedrock e Claude/API Direta), endpoint de notas, integração robusta com Jira através de múltiplas ferramentas, e testes automatizados. Pronto para evoluções futuras!
