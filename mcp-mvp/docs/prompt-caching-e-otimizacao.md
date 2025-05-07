# Prompt Caching & Otimização

## 1. Visão Geral

Prompt caching (Anthropic) permite reutilizar partes do contexto em conversas longas, reduzindo drasticamente o custo de tokens. A otimização do payload de ferramentas complementa essa economia, tornando o sistema mais eficiente.

## 2. Funcionamento do Prompt Caching (Anthropic)

- Requer header `anthropic-beta: prompt-caching-2024-07-31` e `anthropic-conversation-id`
- Elegível a partir de 2048 tokens de entrada (Claude 3.5 Haiku)
- Até 4 blocos podem receber `cache_control`
- Primeira chamada cria o cache (25% mais cara), subsequentes usam o cache (até 90% mais baratas)
- Cache expira após 5 minutos de inatividade

### Estratégia Implementada
- IDs de sessão por IP+user-agent
- Aplicação estratégica de `cache_control` (primeira, intermediária, penúltima e última mensagem)
- Estimativa de tokens e logging detalhado
- Logs de eficiência do cache e troubleshooting

## 3. Otimização do Payload de Ferramentas

- **Problema:** Definições completas de ferramentas consomem 30-40% dos tokens de entrada
- **Soluções:**
  1. Compressão de schemas e descrições
  2. Registro de ferramentas no servidor (enviar só referência após o início)
  3. Filtragem dinâmica de ferramentas relevantes
- **Recomendação:** Começar pela compressão, evoluir para registro server-side

## 4. Melhores Práticas

- Conversas longas se beneficiam mais do caching
- Manter padrões consistentes de mensagens para maximizar cache hits
- Monitorar logs de tokens e eficiência do cache
- Aplicar cache_control apenas nos blocos mais relevantes

## 5. Troubleshooting

- Verifique consistência do conversation ID
- Confirme headers e thresholds de tokens
- Monitore logs para identificar se o cache está ativo
- Para OpenAI, use estratégias de compactação/resumo de contexto

## 6. Próximos Passos

- Implementar registro server-side de ferramentas
- Pesquisar novas estratégias de compressão e filtragem
- Medir impacto real das otimizações em produção

## 7. Referências

- [Changelog](./implementation-summary.md)
- [Integração OpenAI](./integracao-openai.md)
- [Integração Claude](./integracao-claude.md)
- [Jira Tools](./jira-tools.md) 