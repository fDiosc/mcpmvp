# Integração OpenAI

## 1. Visão Geral

A integração OpenAI no MCP-MVP visa oferecer uma experiência consistente com a Anthropic, suportando ferramentas MCP, otimização de tokens e manutenção facilitada. O fluxo OpenAI replica o padrão Anthropic, com adaptações para diferenças de API.

## 2. Plano de Integração

- Novo cliente OpenAI (`openaiClient.ts`) inspirado no cliente Anthropic
- Adição do modelo `openai-direct` ao backend
- Conversão de formatos de mensagens e ferramentas
- Tracking de sessão por IP+user-agent
- Estratégias alternativas de otimização de tokens (não há prompt caching nativo)

## 3. Implementação

- Estrutura de tipos e funções similar ao cliente Anthropic
- Função principal: `callOpenAIDirectAPI(messages, tools, sessionId)`
- Estimativa de tokens e logging detalhado
- Conversão de ferramentas MCP para formato OpenAI
- Processamento de tool use e multi-turn
- Uso do parâmetro `user` para tracking de sessão
- Adaptação de mensagens para roles OpenAI ("system", "user", "assistant", "tool")

## 4. Diferenças OpenAI x Anthropic

| Aspecto | Anthropic API | OpenAI API | Adaptação |
|---------|---------------|------------|-----------|
| Prompt Caching | Suporte nativo | Não suportado | Otimização manual do histórico |
| ID de Conversa | Header | Parâmetro `user` | Tracking manual |
| Formato de Mensagens | `role: user/assistant` | `role: user/assistant/system/tool` | Conversão |
| Ferramentas | input_schema | parameters | Conversão |
| Logging de tokens | `usage.input_tokens` | `usage.prompt_tokens` | Normalização |
| Resposta | `content[]` | `choices[0].message` | Conversão |

## 5. Estratégias de Otimização

- Compactação de histórico: manter apenas mensagens essenciais
- Resumos de contexto: gerar resumos para conversas longas
- Uso do modo JSON para respostas estruturadas
- Logging e análise de uso de tokens
- Ferramentas: compressão de schemas e descrições

## 6. Referências

- [Prompt Caching & Otimização](./prompt-caching-e-otimizacao.md)
- [Changelog](./implementation-summary.md)
- [Jira Tools](./jira-tools.md) 