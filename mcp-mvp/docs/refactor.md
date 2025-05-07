# Refactor: Descoberta Dinâmica de Tools no MCP Server

## 1. Motivação

Atualmente, todas as tools são enviadas para o agente Anthropic a cada requisição, o que:
- Aumenta o consumo de tokens
- Dificulta a escalabilidade (muitos tools = overhead)
- Não segue as melhores práticas MCP/Anthropic

A descoberta dinâmica permite que o agente consulte o MCP server para obter apenas as tools relevantes para o contexto/tarefa, tornando o sistema mais eficiente, flexível e alinhado com o padrão do ecossistema MCP.

## 2. Plano de Implementação

### a) Expor endpoint/listagem dinâmica de tools
- Implementar endpoint (ex: `GET /tools` ou método equivalente via protocolo MCP) que retorna a lista de tools disponíveis no momento.
- Opcional: permitir filtros por contexto, mas inicialmente basta listar todas.

### b) Refatorar fluxo do client/agent
- Antes de enviar um prompt para o LLM, o client consulta o MCP server para obter a lista de tools.
- O client só envia para o LLM as tools retornadas por essa consulta.
- Se o contexto mudar (ex: troca de usuário, mudança de tarefa), o client pode consultar novamente.

### c) Ajustar integração com Anthropic
- Adaptar o código para montar o payload de tools dinamicamente, conforme a resposta do endpoint de descoberta.
- Garantir que o LLM só veja as tools relevantes para o contexto atual.

### d) Testes e fallback
- Testar o fluxo com diferentes números de tools e cenários de atualização dinâmica.
- Garantir fallback para casos onde a listagem falhe (ex: usar um subconjunto default ou exibir erro amigável).

## 3. Mudanças na Arquitetura

- O MCP server passa a ser responsável por expor a listagem de tools dinamicamente.
- O client/agent passa a ser responsável por consultar e montar o payload de tools a cada requisição.
- O fluxo de integração com o LLM se torna mais enxuto e escalável.

## 4. Impactos Esperados

### Performance
- Redução significativa do consumo de tokens por requisição
- Menor latência na comunicação com o LLM
- Escalabilidade para grandes conjuntos de tools

### Experiência do Usuário
- Respostas mais rápidas e contexto mais relevante
- Possibilidade futura de personalizar tools por contexto/usuário

### Manutenção
- Código mais modular e alinhado ao padrão MCP
- Facilidade para adicionar/remover tools sem alterar o core do client

## 5. Riscos e Considerações

- Mudança de fluxo pode impactar integrações existentes (testar bem)
- Se a listagem de tools falhar, o agente pode ficar sem acesso a ferramentas (implementar fallback)
- Futuramente, será importante adicionar filtragem/allowlist para segurança e governança

## 6. Próximos Passos

1. Implementar endpoint de listagem dinâmica de tools no MCP server
2. Refatorar client para consultar tools antes de cada requisição ao LLM
3. Adaptar integração Anthropic para usar lista dinâmica
4. Testar cenários com múltiplos tools e diferentes contextos
5. Documentar exemplos de uso e atualizar onboarding

---

**Referências:**
- [Anthropic - Best practices for agentic coding](https://www.anthropic.com/engineering/claude-code-best-practices)
- [MCP Deep Dive](https://medium.com/@h1deya/mcp-deep-dive-is-it-paving-the-way-towards-meta-ai-agents-heres-how-d1e931c01a67)
- [MCP Spec](https://modelcontextprotocol.io/specification/2025-03-26/) 