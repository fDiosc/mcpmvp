# Changelog e Marcos de Implementação

## Mudanças Principais

- Integração direta com API Anthropic (Claude) e OpenAI Assistants API
- Implementação de prompt caching (Anthropic) para redução de custos
- Expansão das ferramentas Jira (várias operações)
- Interface web aprimorada para chat, seleção de modelo e listagem de notas
- Scripts de testes automatizados para interface e ferramentas

## Marcos

- **v1.0**: MVP funcional com OpenAI, Claude (Bedrock e API Direta), notas e Jira
- **v1.1**: Prompt caching Anthropic, logging detalhado de tokens, otimização de payload de ferramentas
- **v1.2**: Integração OpenAI Direct, normalização de fluxos multi-modelo, melhorias de UX

## Próximos Passos

- Testes avançados de multi-turn e tool chaining
- Melhorias de feedback de erro e tratamento de quotas
- Opções de configuração avançada de modelos
- Streaming de respostas e tracking de tokens

## Para detalhes técnicos:
- [Integração OpenAI](./integracao-openai.md)
- [Integração Claude](./integracao-claude.md)
- [Prompt Caching & Otimização](./prompt-caching-e-otimizacao.md)
- [Jira Tools](./jira-tools.md) 