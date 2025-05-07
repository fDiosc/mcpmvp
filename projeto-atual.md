# Estado Atual do Projeto MCP-MVP

## Resumo

O MCP-MVP (Model Context Protocol - Minimum Viable Product) é uma implementação de servidor MCP local que permite interações entre agentes de IA (OpenAI e Claude) e ferramentas locais, como notas e Jira. O projeto demonstra o potencial do protocolo MCP para criar ambientes de teste onde agentes de IA podem acessar ferramentas externas e manter contexto conversacional.

## Integrações de Modelos Implementadas

1. **OpenAI Assistants API**
   - Uso da API de assistentes nativa da OpenAI
   - Suporte a threads e histórico de conversas nativas
   - Integração com ferramentas MCP via transport SSE

2. **Claude via AWS Bedrock**
   - Integração com modelos Claude através da infraestrutura AWS
   - Histórico de conversas gerenciado pelo frontend
   - Suporte a tool use com conversão de formatos

3. **Claude via API Anthropic Direta**
   - Implementação direta com o SDK oficial da Anthropic
   - Melhor tratamento de tool use e reconhecimento de ferramentas
   - Formatação apropriada de mensagens e histórico
   - Suporte a prompt caching para redução de custos
   - Monitoramento de uso de tokens e efetividade do cache

## Ferramentas Implementadas

### Ferramenta de Notas
- `create_note`: Cria notas com título e conteúdo
- Armazenamento em memória de notas
- Listagem e recuperação de notas existentes

### Ferramentas Jira (Expandidas)
1. `get_jira_issue`: Informações básicas de issues
2. `get_detailed_jira_issue`: Informações detalhadas de issues
3. `get_jira_issue_comments`: Comentários de issues
4. `get_jira_issue_transitions`: Transições disponíveis
5. `search_jira_issues`: Busca com JQL
6. `get_jira_issue_watchers`: Observadores de issues
7. `get_jira_issue_attachments`: Anexos de issues
8. `get_jira_issue_sprints`: Sprints associados

## Recursos de Otimização

### Prompt Caching (API Anthropic)
- Implementação do recurso beta de caching da Anthropic
- Marcação de partes do contexto para cache com `cache_control`
- Primeira mensagem/instruções do sistema cacheadas
- Histórico de conversa cacheado (exceto última mensagem do usuário)
- Controle de token usage com logs detalhados
- Benefícios de custo: 
  - Primeira chamada: custo 25% maior (criação do cache)
  - Chamadas subsequentes: economia de até 90% nos tokens de entrada
  - Cache expira após 5 minutos de inatividade

## Interface Web

- Chat interativo com seleção de modelo (OpenAI, Claude Bedrock, Claude API Direta)
- Listagem e atualização de notas criadas
- Interface responsiva com indicadores de carregamento
- Histórico de conversas mantido durante a sessão
- Tratamento de erros e feedback visual

## Estrutura do Projeto

```
mcp-mvp/
├── src/
│   ├── index.ts               # Servidor MCP com Express e endpoints
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

## Configuração e Variáveis de Ambiente

O projeto utiliza as seguintes variáveis de ambiente (configuradas em um arquivo `.env`):

```
OPENAI_API_KEY=chave_api_openai
AWS_ACCESS_KEY_ID=chave_acesso_aws
AWS_SECRET_ACCESS_KEY=chave_secreta_aws
AWS_REGION=regiao_aws
ANTHROPIC_API_KEY=chave_api_anthropic
JIRA_BASE_URL=url_jira
JIRA_USERNAME=usuario_jira
JIRA_API_TOKEN=token_api_jira
```

## Fluxos de Interação Implementados

1. **Fluxo Básico de Chat**
   - Usuário envia mensagem via interface web
   - Servidor encaminha para o modelo selecionado
   - Modelo processa e responde via SSE ou standard request/response

2. **Fluxo com Uso de Ferramentas**
   - Modelo identifica necessidade de usar uma ferramenta
   - Ferramenta é executada no servidor
   - Resultado é enviado de volta ao modelo
   - Modelo incorpora o resultado na resposta final

3. **Fluxo Multi-Step com Ferramentas**
   - Modelo pode executar várias ferramentas em sequência
   - Cada resultado é incorporado no contexto
   - Respostas finais incluem dados combinados de várias fontes

4. **Fluxo com Prompt Caching**
   - Primeira interação: armazena instruções e contexto em cache
   - Interações subsequentes: reutiliza o cache para partes estáticas da conversa
   - Apenas a consulta mais recente do usuário não é cacheada
   - Logs detalhados monitoram eficiência do cache

## Modelos Claude Suportados

| Modelo | API Anthropic | AWS Bedrock | 
|--------|---------------|-------------|
| Claude 3.7 Sonnet | claude-3-7-sonnet-20250219 | anthropic.claude-3-7-sonnet-20250219-v1:0 |
| Claude 3.5 Haiku | claude-3-5-haiku-20241022 | anthropic.claude-3-5-haiku-20241022-v1:0 |
| Claude 3.5 Sonnet v2 | claude-3-5-sonnet-20241022 | anthropic.claude-3-5-sonnet-20241022-v2:0 |
| Claude 3.5 Sonnet | claude-3-5-sonnet-20240620 | anthropic.claude-3-5-sonnet-20240620-v1:0 |
| Claude 3 Opus | claude-3-opus-20240229 | anthropic.claude-3-opus-20240229-v1:0 |
| Claude 3 Sonnet | claude-3-sonnet-20240229 | anthropic.claude-3-sonnet-20240229-v1:0 |
| Claude 3 Haiku | claude-3-haiku-20240307 | anthropic.claude-3-haiku-20240307-v1:0 |

## Comparação entre Integrações Claude

| Característica | AWS Bedrock | API Anthropic Direta |
|----------------|-------------|----------------------|
| Configuração | Credenciais AWS | Chave API Anthropic |
| Tool Use | Menos consistente | Mais confiável |
| Controle de Formato | Menos rigoroso | Mais rigoroso |
| Gestão de Histórico | Frontend | Backend e frontend |
| Custo | Faturamento AWS | Faturamento Anthropic |
| Limites de API | Via AWS | Via Anthropic |
| Prompt Caching | Não suportado | Suportado (economia de até 90%) |

## Instruções de Build e Execução

1. Instalar dependências:
   ```sh
   npm install
   ```

2. Configurar variáveis de ambiente (arquivo `.env`)

3. Compilar o projeto:
   ```sh
   npm run build
   ```

4. Iniciar o servidor:
   ```sh
   node build/index.js
   ```

5. Acessar a interface web: http://localhost:3333

## Testes Disponíveis

1. Teste de interface web:
   ```sh
   node test-puppeteer.js
   ```

2. Testes de ferramentas Jira:
   ```sh
   node test-jira.js
   node test-jira-tools.js
   ```

## Próximos Passos

1. **Melhorias de Interface**
   - Interface mais sofisticada para exibição de dados do Jira
   - Suporte a markdown e formatação de código
   - Persistent storage para histórico de conversas

2. **Novas Ferramentas**
   - Implementar ferramentas para criação e atualização de issues no Jira
   - Adicionar integrações com outros sistemas (GitHub, Confluence, etc.)
   - Suporte a upload e análise de arquivos

3. **Melhorias Técnicas**
   - Implementar streaming de respostas para todos os modelos
   - Melhorar tratamento de erros e resiliência
   - Adicionar testes automatizados mais abrangentes
   - Implementar autenticação e autorização para a API
   - Remover logs de desenvolvimento em ambiente de produção 