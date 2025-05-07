# Integração Claude (Bedrock & API Direta)

## 1. Visão Geral

O projeto suporta integração com modelos Claude da Anthropic via duas abordagens:
- **AWS Bedrock**: Acesso via infraestrutura AWS
- **API Anthropic Direta**: Integração direta com o SDK oficial

Ambas suportam ferramentas (tool use) e contexto conversacional, mas possuem diferenças importantes.

## 2. Diferenças Bedrock x API Direta

| Aspecto | Bedrock | API Direta |
|---------|---------|------------|
| Autenticação | Credenciais AWS | Chave API Anthropic |
| Tool Use | Menos consistente | Mais confiável |
| Controle de Formato | Menos rigoroso | Mais rigoroso |
| Gestão de Histórico | Frontend | Backend e frontend |
| Prompt Caching | Não suportado | Suportado (Haiku e Sonnet) |
| IDs de tool_use/result | Não necessário | Ajuste manual |

## 3. Detalhes Técnicos

### 3.1 AWS Bedrock
- Cliente: `@aws-sdk/client-bedrock-runtime`
- Histórico mantido no frontend
- Tool use pode ser inconsistente
- Integração simplificada para quem já usa AWS

### 3.2 API Anthropic Direta
- Cliente: `@anthropic-ai/sdk`
- Histórico robusto, tool use confiável
- Suporte a prompt caching (ver [Prompt Caching & Otimização](./prompt-caching-e-otimizacao.md))
- IDs de tool_use e tool_result devem ser tratados corretamente

## 4. Troubleshooting

- Bedrock: problemas de reconhecimento de ferramentas → tente API Direta
- API Direta: verifique IDs de modelo válidos, headers de caching, e formatação de mensagens
- Logs detalhados ajudam a identificar problemas de tool use e caching

## 5. Referências

- [Prompt Caching & Otimização](./prompt-caching-e-otimizacao.md)
- [Changelog](./implementation-summary.md)
- [Jira Tools](./jira-tools.md) 