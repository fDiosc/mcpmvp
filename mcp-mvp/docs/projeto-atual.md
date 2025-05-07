# Estado Atual e Arquitetura do Projeto MCP-MVP

## 1. Visão Geral

O MCP-MVP (Model Context Protocol - Minimum Viable Product) é uma implementação de servidor MCP local que integra agentes de IA (OpenAI e Claude, via AWS Bedrock e API Anthropic direta) com ferramentas locais (notas e Jira). O objetivo é criar um ambiente robusto para testes e demonstração do protocolo MCP, com suporte a contexto conversacional, uso de ferramentas, caching de prompts (Anthropic) e interface web.

## 2. Estrutura do Projeto

```
mcp-mvp/
├── src/
│   ├── index.ts               # Servidor MCP com Express, endpoints, tools e SSE transport
│   ├── jiraTool.ts            # Implementação de ferramentas Jira
│   ├── anthropicClient.ts     # Cliente API Anthropic com prompt caching
│   ├── web/
│   │   └── index.html         # Interface web
│   └── client/
│       ├── index.ts           # Cliente OpenAI/MCP
│       └── agents/
│           └── assistant.ts   # Implementação do agente
├── build/                     # Código compilado
├── test-puppeteer.js          # Testes de interface
├── test-jira.js               # Testes de Jira
├── test-jira-tools.js         # Testes expandidos de Jira
├── package.json
└── tsconfig.json
```

## 3. Funcionalidades Principais

- **Servidor MCP**: Endpoints para SSE, chat, notas e ferramentas Jira.
- **Ferramentas**: Notas (criação/listagem) e Jira (várias operações detalhadas).
- **Clientes de Modelo**: OpenAI (Assistants API e integração direta), Claude via AWS Bedrock, Claude via API Anthropic (com prompt caching).
- **Frontend Web**: Interface de chat, seleção de modelo, listagem de notas.
- **Testes**: Scripts automatizados para interface e ferramentas Jira.

## 4. Fluxos de Interação

1. **Chat Básico**: Usuário envia mensagem via web, servidor encaminha para o modelo selecionado, resposta via SSE ou HTTP.
2. **Uso de Ferramentas**: Modelo identifica necessidade de ferramenta, executa no servidor, resultado é incorporado na resposta.
3. **Multi-Step Tools**: Execução encadeada de ferramentas, resultados combinados.
4. **Prompt Caching**: (Anthropic) Primeira interação armazena contexto em cache, subsequentes reutilizam cache para partes estáticas.

## 5. Modelos Suportados

| Modelo | API Anthropic | AWS Bedrock |
|--------|---------------|-------------|
| Claude 3.7 Sonnet | claude-3-7-sonnet-20250219 | anthropic.claude-3-7-sonnet-20250219-v1:0 |
| Claude 3.5 Haiku | claude-3-5-haiku-20241022 | anthropic.claude-3-5-haiku-20241022-v1:0 |
| Claude 3.5 Sonnet v2 | claude-3-5-sonnet-20241022 | anthropic.claude-3-5-sonnet-20241022-v2:0 |
| Claude 3.5 Sonnet | claude-3-5-sonnet-20240620 | anthropic.claude-3-5-sonnet-20240620-v1:0 |
| Claude 3 Opus | claude-3-opus-20240229 | anthropic.claude-3-opus-20240229-v1:0 |
| Claude 3 Sonnet | claude-3-sonnet-20240229 | anthropic.claude-3-sonnet-20240229-v1:0 |
| Claude 3 Haiku | claude-3-haiku-20240307 | anthropic.claude-3-haiku-20240307-v1:0 |

## 6. Exemplos de Uso

- **Buscar issue no Jira:**
  - "Busque a issue CR-618 no Jira"
  - Agente executa get_jira_issue, retorna resultado como JSON.
- **Criar nota baseada em issue:**
  - "Crie uma nota com os dados da issue CR-618"
  - Agente executa get_jira_issue, depois create_note.
- **Buscar detalhes completos:**
  - "Busque detalhes completos da issue CR-618 incluindo comentários"
  - Agente executa get_detailed_jira_issue e get_jira_issue_comments.

## 7. Instruções de Build, Execução e Teste

1. Instale dependências:
   ```sh
   npm install
   ```
2. Configure variáveis de ambiente em `.env`:
   ```
   OPENAI_API_KEY=...
   AWS_ACCESS_KEY_ID=...
   AWS_SECRET_ACCESS_KEY=...
   AWS_REGION=...
   ANTHROPIC_API_KEY=...
   JIRA_BASE_URL=...
   JIRA_USERNAME=...
   JIRA_API_TOKEN=...
   ```
3. Compile o projeto:
   ```sh
   npm run build
   ```
4. Inicie o servidor:
   ```sh
   node build/index.js
   ```
5. Acesse a interface web: http://localhost:3333

## 8. Testes Disponíveis

- Teste de interface web: `node test-puppeteer.js`
- Testes de ferramentas Jira: `node test-jira.js`, `node test-jira-tools.js`

## 9. Troubleshooting

- Verifique se o build está atualizado e o servidor rodando a partir de `build/index.js`.
- Se aparecer "Modelo não suportado", revise as chaves API.
- Para Anthropic, confira se o ID do modelo é válido.
- Para problemas com ferramentas no Bedrock, tente a opção Claude (API Direta).

## 10. Referências e Documentos Relacionados

- [Resumo de Implementação](./implementation-summary.md)
- [Integração OpenAI](./integracao-openai.md)
- [Integração Claude](./integracao-claude.md)
- [Prompt Caching & Otimização](./prompt-caching-e-otimizacao.md)
- [Jira Tools](./jira-tools.md) 