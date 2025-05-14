# Integração MCP-Jira Assistant com ProductLab

Este documento detalha a arquitetura e implementação da integração entre o servidor MCP (Model Context Protocol) e o ProductLab Dashboard, focando especificamente no recurso Jira Assistant.

## Visão Geral

O Jira Assistant é um módulo do ProductLab Dashboard que permite aos usuários interagir com seus dados do Jira usando linguagem natural, através de uma interface de chat alimentada por IA. A integração é realizada através de chamadas de API entre o frontend do ProductLab e o servidor MCP, que fornece acesso a modelos de IA (OpenAI e Claude) com ferramentas específicas para interagir com o Jira.

## Arquitetura de Integração

```
┌───────────────────────┐          ┌────────────────────────┐         ┌───────────────────┐
│                       │          │                        │         │                   │
│ ProductLab Dashboard  │  ◄─────► │ MCP Server (localhost) │ ◄─────► │    Jira Cloud     │
│  (Next.js Frontend)   │   HTTP   │     (Port 3333)        │   API   │                   │
│                       │  (Proxy) │                        │         │                   │
└───────────────────────┘          └────────────────────────┘         └───────────────────┘
                                             ▲
                                             │
                                    ┌────────┴───────────┐
                                    │                    │
                                    │   OpenAI / Claude  │
                                    │     AI Models      │
                                    │                    │
                                    └────────────────────┘
```

### Componentes Principais

1. **ProductLab Dashboard (Frontend):**
   - Páginas e componentes de interface do usuário
   - Gerenciamento de credenciais do Jira
   - Histórico de conversa e exibição de respostas

2. **API Proxy no ProductLab:**
   - Middleware que gerencia autenticação
   - Adiciona credenciais do Jira e informações do usuário
   - Realiza limpeza e formatação de respostas
   - **Gateway unificado para todas as comunicações com o MCP**

3. **Servidor MCP:**
   - Hospeda o protocolo Model Context Protocol
   - Conecta-se a modelos de IA (OpenAI/Claude)
   - Implementa ferramentas específicas do Jira
   - Gerencia seleção dinâmica de ferramentas baseada em contexto

4. **Jira Cloud API:**
   - API externa para interagir com instâncias do Jira
   - Acessada através das ferramentas do MCP

## Fluxo de Integração

### 1. Inicialização e Autenticação

```
┌─────────────┐              ┌──────────────┐            ┌────────────┐
│ ProductLab  │              │  Next.js API  │           │ MCP Server │
│  Frontend   │              │    Routes     │           │            │
└──────┬──────┘              └──────┬───────┘           └──────┬─────┘
       │                            │                          │
       │ 1. Carrega página          │                          │
       │ Jira Assistant             │                          │
       ├───────────────────────────►│                          │
       │                            │                          │
       │ 2. Verifica autenticação   │                          │
       │ via NextAuth               │                          │
       │◄───────────────────────────┤                          │
       │                            │                          │
       │ 3. Verifica status         │                          │
       │ do servidor MCP            │                          │
       ├───────────────────────────►│                          │
       │                            │ 4. Ping request          │
       │                            ├─────────────────────────►│
       │                            │                          │
       │                            │ 5. Resposta de ping      │
       │                            │◄─────────────────────────┤
       │ 6. Status do MCP           │                          │
       │◄───────────────────────────┤                          │
       │                            │                          │
       │ 7. Verifica modo de        │                          │
       │ credenciais do Jira        │                          │
       ├───────────────────────────►│                          │
       │                            │ 8. Consulta de modo      │
       │                            │ de credenciais           │
       │                            ├─────────────────────────►│
       │                            │                          │
       │                            │ 9. Resposta com modo     │
       │                            │ de credenciais           │
       │                            │◄─────────────────────────┤
       │ 10. Modo de credenciais    │                          │
       │◄───────────────────────────┤                          │
       │                            │                          │
       │ 11. Busca credenciais      │                          │
       │ do Jira do usuário         │                          │
       ├───────────────────────────►│                          │
       │                            │                          │
       │ 12. Retorna credenciais    │                          │
       │◄───────────────────────────┤                          │
       │                            │                          │
       │ 13. Exibe interface        │                          │
       │ (ou solicita credenciais)  │                          │
       └──────────────────────────┘                            │
```

### 2. Interação com Chat

```
┌─────────────┐              ┌──────────────┐            ┌────────────┐
│ ProductLab  │              │  Next.js API  │           │ MCP Server │
│  Frontend   │              │    Proxy      │           │            │
└──────┬──────┘              └──────┬───────┘           └──────┬─────┘
       │                            │                          │
       │ 1. Envia mensagem          │                          │
       │ do usuário                 │                          │
       ├───────────────────────────►│                          │
       │                            │                          │
       │                            │ 2. Encaminha mensagem    │
       │                            │ com credenciais          │
       │                            ├─────────────────────────►│
       │                            │                          │
       │                            │ 3. Detecção de contexto  │
       │                            │ e seleção de ferramentas │
       │                            │◄─────────────────────────┤
       │                            │                          │
       │                            │ 4. Processamento do      │
       │                            │ modelo de IA com         │
       │                            │ ferramentas do Jira      │
       │                            │◄─────────────────────────┤
       │                            │                          │
       │                            │ 5. Resposta com histórico│
       │                            │◄─────────────────────────┤
       │                            │                          │
       │                            │ 6. Limpeza e formatação  │
       │                            │ da resposta              │
       │                            │                          │
       │ 7. Resposta formatada      │                          │
       │◄───────────────────────────┤                          │
       │                            │                          │
       │ 8. Exibe resposta          │                          │
       │ e atualiza histórico       │                          │
       └──────────────────────────┘                            │
```

## Detalhes de Implementação

### 1. Componentes do ProductLab

#### JiraAssistantPage.tsx (Página Principal)
- Container para o assistente Jira
- Gerencia estado de conexão com o servidor MCP
- Controla exibição do modal de credenciais
- Verifica presença de credenciais válidas

#### JiraChatComponent.tsx (Interface de Chat)
- Implementa a interface de chat com envio de mensagens
- Mantém histórico de conversas
- Gerencia estado de loading e erros
- Permite seleção de modelos (OpenAI/Claude)
- Formata respostas usando ReactMarkdown

#### Hook useJiraCredentialsMode
- **Usa o proxy API para verificar o modo de credenciais**
- Gerencia fallback para modo seguro (use credenciais do usuário)
- Tratamento de erros robusto

#### API Proxy (jira-assistant-proxy.js)
- Autentica o usuário via NextAuth
- Obtém credenciais do Jira do banco de dados
- Encaminha requisições para o servidor MCP
- Processa e limpa respostas antes de retornar ao frontend
- Implementa tratamento de erros e mensagens amigáveis
- **Gerencia verificação de modo de credenciais**
- **Centraliza toda comunicação com o servidor MCP**

### 2. Gerenciamento de Credenciais do Jira

- **Armazenamento:** Credenciais são armazenadas de forma segura no banco de dados Prisma, vinculadas ao ID do usuário
- **Validação:** Credenciais são validadas antes do armazenamento
- **Acesso:** Hooks React (`useJiraCredentials` e `useJiraCredentialsMode`) fornecem acesso às credenciais
- **Flexibilidade:** Suporte a credenciais em variáveis de ambiente ou no banco de dados
- **Verificação de Modo:** Sistema verifica se deve usar credenciais do usuário ou variáveis de ambiente

### 3. Integração com o Servidor MCP

O servidor MCP expõe os seguintes endpoints relevantes para a integração:

- `/ping`: Verificação de status do servidor
- `/chat`: Endpoint principal para processamento de mensagens
- `/api/jira/check-credentials`: Validação de credenciais do Jira
- `/api/jira/credentials-mode`: Informa o modo de credenciais (variáveis de ambiente ou do usuário)
- `/tools`: Endpoint para descoberta dinâmica de ferramentas

### 4. Seleção de Modelos e Gerenciamento de Histórico

- Suporte para modelos OpenAI e Claude (Anthropic)
- Diferentes estratégias de gerenciamento de histórico por modelo:
  - **OpenAI:** Gerencia threads nativamente
  - **Claude:** Requer envio de histórico de conversas a cada requisição

### 5. Fluxo de Operação do MCP-Jira

1. **Verificação do Modo de Credenciais:**
   - O sistema verifica com o servidor MCP se deve usar variáveis de ambiente ou credenciais do usuário
   - A comunicação é feita através do proxy para evitar problemas de CORS
   - Tratamento de erros robusto com fallback para o modo mais seguro

2. **Detecção de Contexto:**
   - Quando uma mensagem contém termos relacionados ao Jira (tickets, issues, sprints), o sistema ativa ferramentas do Jira
   - Sistema de descoberta dinâmica de ferramentas reduz uso de tokens

3. **Seleção de Ferramentas:**
   - O componente Tool Selection Agent (agente de seleção de ferramentas) determina quais ferramentas do Jira são relevantes
   - Ex: para pesquisa de tickets, ferramentas de busca são priorizadas

4. **Execução da Ferramenta:**
   - O modelo AI decide quando chamar ferramentas do Jira
   - Ferramentas usam credenciais fornecidas para acessar a API do Jira
   - Resultados são formatados e incorporados na conversa

5. **Processamento de Resposta:**
   - Respostas são limpas para remover blocos técnicos (usando `cleanResponseForDisplay`)
   - Histórico é atualizado com a nova interação
   - Múltiplas chamadas de ferramenta são tratadas em uma única resposta

## Ferramentas do Jira Disponíveis

O servidor MCP implementa as seguintes ferramentas para interação com o Jira:

1. **get_jira_issue:** Obtém detalhes de uma issue específica
2. **search_jira_issues:** Pesquisa issues com base em critérios específicos
3. **get_jira_sprint:** Obtém informações sobre sprints
4. **get_my_jira_issues:** Recupera issues atribuídas ao usuário atual
5. **add_jira_comment:** Adiciona comentários a uma issue
6. **create_jira_issue:** Cria uma nova issue no Jira
7. **update_jira_issue:** Atualiza campos de uma issue existente

## Segurança e Considerações

1. **Autenticação:**
   - A autenticação do usuário é gerenciada pelo NextAuth no ProductLab
   - Credenciais do Jira são armazenadas de forma segura

2. **Isolamento:**
   - O servidor MCP opera localmente (localhost:3333)
   - Não é exposto diretamente à internet
   - **Toda comunicação passa pelo proxy API para evitar problemas de CORS**

3. **Tratamento de Erros:**
   - Erros de conexão e autenticação são tratados com mensagens amigáveis
   - Sistema de reconexão automática após falhas
   - **Fallbacks seguros para todas as operações críticas**

4. **Privacidade dos Dados:**
   - Dados do Jira são processados localmente no servidor MCP
   - Informações sensíveis não são enviadas para os modelos de IA além do necessário

## Melhorias Recentes e Futuras

### Implementadas Recentemente:
- Centralização de prompts em uma única localização
- Detecção aprimorada de contextos para evitar execução desnecessária
- Prevenção de duplicidade de notas e ações
- Padronização de prompts do sistema
- **Proxy centralizado para toda comunicação com o MCP**
- **Tratamento de erros robusto na verificação de modo de credenciais**
- **Fallbacks seguros para garantir continuidade da operação**

### Melhorias Futuras Planejadas:
- Caching inteligente de respostas para consultas frequentes
- Suporte para operações em lote no Jira
- Interface para visualização avançada de issues e dashboards
- Integração com outras ferramentas de gerenciamento de projeto

## Considerações Técnicas

### Requisitos:
- Servidor MCP rodando localmente na porta 3333
- Credenciais de API do Jira configuradas
- Chaves de API para OpenAI ou Anthropic

### Limitações Atuais:
- Dependência do servidor MCP local
- Algumas funcionalidades avançadas do Jira ainda não suportadas
- Potenciais limitações de tokens em conversas muito longas

## Conclusão

A integração MCP-Jira Assistant demonstra uma arquitetura eficiente para combinar interfaces de conversação baseadas em IA com sistemas externos como o Jira. A abordagem de seleção dinâmica de ferramentas, combinada com gerenciamento eficiente de conversas, permite interações naturais e eficazes com dados do Jira, economizando tempo dos usuários e fornecendo acesso fácil às informações de gerenciamento de projetos. 

O uso de um proxy centralizado para toda comunicação entre o frontend e o servidor MCP garante maior segurança, consistência e robustez, permitindo tratamento de erros unificado e evitando problemas de CORS. 

## Tratamento de Credenciais

### Modos de Credenciais

O servidor MCP suporta dois modos de operação para credenciais do Jira:

1. **Modo de Ambiente (ENV)**: Quando `USE_ENV_FOR_JIRA_CREDENTIALS=true`, o servidor usa as credenciais definidas nas variáveis de ambiente:
   - `JIRA_BASE_URL`
   - `JIRA_USERNAME`
   - `JIRA_API_TOKEN`
   
   Este modo é ideal para testes e desenvolvimento local.

2. **Modo de Credenciais Dinâmicas**: Quando `USE_ENV_FOR_JIRA_CREDENTIALS=false`, o servidor espera que as credenciais sejam enviadas em cada requisição pelo cliente. Estas credenciais são passadas para todas as chamadas de ferramentas subsequentes durante a mesma sessão de conversa.

### Fluxo de Credenciais

O fluxo de credenciais do Jira segue este processo:

1. O usuário configura suas credenciais no modal do Jira Assistant
2. As credenciais são armazenadas no banco de dados do ProductLab
3. Quando o usuário envia uma mensagem, o Jira Assistant:
   - Recupera as credenciais do banco de dados
   - Envia-as junto com a mensagem para o servidor MCP via proxy
4. O servidor MCP:
   - Recebe as credenciais na requisição inicial
   - Verifica a integridade das credenciais com validações específicas para cada campo
   - Passa-as para todas as chamadas de ferramentas subsequentes
   - Mantém-nas durante toda a sessão da conversa

### Melhorias de Segurança e Diagnóstico

Para garantir a segurança e facilitar a solução de problemas:

1. **Transmissão segura**:
   - As credenciais são transmitidas apenas via HTTPS
   - As credenciais não são armazenadas no servidor MCP
   - As credenciais são passadas apenas para as ferramentas relacionadas ao Jira

2. **Logs detalhados para diagnóstico**:
   - Logs estruturados em cada etapa do processo de autenticação
   - Informações detalhadas sobre quais campos estão presentes ou ausentes nas credenciais
   - Mascaramento de informações sensíveis nos logs (tokens, senhas)
   - Rastreamento completo do fluxo de requisições à API Jira

3. **Tipagem melhorada**:
   - Interfaces TypeScript bem definidas para credenciais e respostas
   - Verificação de tipos em tempo de compilação
   - Retornos consistentes e tipados para todas as ferramentas

### Tratamento de Erros

O sistema implementa verificações robustas de credenciais:

1. **Validação de credenciais em camadas**:
   - Verificação inicial de presença das credenciais
   - Verificação individual de cada campo necessário (baseUrl, username, apiToken)
   - Logs específicos para cada nível de validação

2. **Tratamento centralizado de erros**:
   - Função unificada para chamadas à API (`callJiraApi`)
   - Consistência no formato de respostas de erro
   - Captura e registro detalhado de exceções
   - Mensagens de erro padronizadas e informativas

3. **Degradação graciosa**:
   - Fallbacks seguros quando possível
   - Mensagens de erro claras e acionáveis para o usuário
   - Respostas estruturadas mesmo em caso de erro

## Ferramentas do Jira Melhoradas

As ferramentas do Jira foram aprimoradas com:

1. **Interface consistente**:
   - Todas as ferramentas usam a mesma função `callJiraApi` para interações com a API
   - Formato padronizado para respostas através de interface `ToolResponse`
   - Comportamento consistente para tratamento de erros

2. **Logs abrangentes**:
   - Rastreamento completo do ciclo de vida da requisição
   - Informações de contexto em cada chamada de API
   - Detalhes específicos sobre exceções e erros HTTP

3. **Validação robusta de entrada**:
   - Uso de Zod para validação de esquemas
   - Feedback claro sobre argumentos inválidos
   - Prevenção de chamadas de API com dados incompletos

## Ferramentas do Jira Disponíveis

O servidor MCP implementa as seguintes ferramentas para interação com o Jira:

1. **get_jira_issue:** Obtém detalhes de uma issue específica
2. **search_jira_issues:** Pesquisa issues com base em critérios específicos
3. **get_jira_sprint:** Obtém informações sobre sprints
4. **get_my_jira_issues:** Recupera issues atribuídas ao usuário atual
5. **add_jira_comment:** Adiciona comentários a uma issue
6. **create_jira_issue:** Cria uma nova issue no Jira
7. **update_jira_issue:** Atualiza campos de uma issue existente 