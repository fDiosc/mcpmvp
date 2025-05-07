# Implementação da integração com Claude via AWS Bedrock e API Anthropic

## 1. Visão Geral

Este documento detalha a implementação da integração com o modelo Claude da Anthropic, através de duas abordagens distintas:

1. **AWS Bedrock**: Utiliza a AWS como intermediária para acessar o modelo Claude
2. **API Anthropic Direta**: Integração direta com a API da Anthropic usando o SDK oficial

Ambas as abordagens suportam ferramentas (tool use) e permitem manter o contexto de conversas, mas possuem diferenças importantes na implementação e comportamento.

## 2. Modelos Claude Suportados

| Modelo | API Anthropic | AWS Bedrock | 
|--------|---------------|-------------|
| Claude 3.7 Sonnet | claude-3-7-sonnet-20250219 | anthropic.claude-3-7-sonnet-20250219-v1:0 |
| Claude 3.5 Haiku | claude-3-5-haiku-20241022 | anthropic.claude-3-5-haiku-20241022-v1:0 |
| Claude 3.5 Sonnet v2 | claude-3-5-sonnet-20241022 | anthropic.claude-3-5-sonnet-20241022-v2:0 |
| Claude 3.5 Sonnet | claude-3-5-sonnet-20240620 | anthropic.claude-3-5-sonnet-20240620-v1:0 |
| Claude 3 Opus | claude-3-opus-20240229 | anthropic.claude-3-opus-20240229-v1:0 |
| Claude 3 Sonnet | claude-3-sonnet-20240229 | anthropic.claude-3-sonnet-20240229-v1:0 |
| Claude 3 Haiku | claude-3-haiku-20240307 | anthropic.claude-3-haiku-20240307-v1:0 |

## 3. Implementação AWS Bedrock

### 3.1 Configuração

```typescript
// Importação do cliente Bedrock
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

// Inicialização do cliente
const bedrockClient = new BedrockRuntimeClient({ 
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
});
```

### 3.2 Função para chamar Claude via Bedrock

```typescript
async function callClaudeHaiku(messages, tools) {
  const modelId = "anthropic.claude-3-haiku-20240307-v1:0";
  
  const input = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1024,
    messages: messages,
    tools: tools,
    temperature: 0.7,
  };

  const command = new InvokeModelCommand({
    modelId: modelId,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(input),
  });

  try {
    const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody;
  } catch (error) {
    console.error("Erro ao chamar Claude via Bedrock:", error);
    throw error;
  }
}
```

### 3.3 Características e Limitações da Abordagem Bedrock

- **Gestão de Histórico**: O histórico de mensagens é mantido pelo frontend e enviado a cada requisição.
- **Autenticação**: Utiliza credenciais AWS (ACCESS_KEY e SECRET_KEY).
- **Tool Use**: Funcionamento menos consistente com as ferramentas, às vezes não reconhecendo corretamente a execução da ferramenta.
- **Formatos de Mensagens**: Formatação menos rigorosa, mas também mais propenso a erros.
- **Vantagens**: Integração simplificada com infraestrutura AWS existente, gestão de cotas via AWS.

## 4. Implementação API Anthropic Direta

### 4.1 Configuração

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';

// Inicialização do cliente Anthropic
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});
```

### 4.2 Função para chamar Claude via API direta

```typescript
async function callClaudeDirectAPI(messages, tools) {
  try {
    const formattedMessages = formatMessagesForAnthropic(messages);
    const formattedTools = convertMcpToolsToAnthropicFormat(tools);
    
    const response = await anthropic.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 1024,
      messages: formattedMessages,
      tools: formattedTools,
      temperature: 0.7,
    });
    
    return response;
  } catch (error) {
    console.error("Erro ao chamar Anthropic API:", error);
    throw error;
  }
}
```

### 4.3 Gerenciamento de ferramentas (tool use)

```typescript
async function handleToolExecution(toolUse, executeTool, messageHistory) {
  const { name, input } = toolUse;
  const toolUseId = toolUse.id || uuidv4();
  
  try {
    const toolResult = await executeTool(name, input);
    const resultContent = toolResult?.content?.[0]?.text || JSON.stringify(toolResult);
    
    // Adiciona mensagem do assistente com a chamada da ferramenta
    messageHistory.push({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: toolUseId,
          name,
          input
        }
      ]
    });
    
    // Adiciona mensagem do usuário com o resultado da ferramenta
    messageHistory.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: resultContent
        }
      ]
    });
    
    return { messageHistory, toolResult };
  } catch (error) {
    // Tratamento de erro...
    return { messageHistory, error };
  }
}
```

### 4.4 Características da Abordagem API Direta

- **Gestão de Histórico**: Implementação robusta com correto encadeamento de mensagens e ferramentas.
- **Autenticação**: Utiliza chave de API da Anthropic.
- **Tool Use**: Implementação confiável seguindo as especificações exatas da API Anthropic.
- **Formatos de Mensagens**: Tratamento rigoroso dos formatos de mensagens e respostas.
- **Tipagem**: Melhor tipagem com TypeScript utilizando tipos do SDK oficial.
- **Vantagens**: Reconhecimento consistente de ferramentas, suporte nativo a tool_use e tool_result.

## 5. Comparação entre as Abordagens

| Característica | AWS Bedrock | API Anthropic Direta |
|----------------|-------------|----------------------|
| Configuração | Credenciais AWS | Chave API Anthropic |
| Tool Use | Menos consistente | Mais confiável |
| Controle de Formato | Menos rigoroso | Mais rigoroso |
| Gestão de Histórico | Pelo frontend | Pelo backend e frontend |
| Custo | Faturamento AWS | Faturamento Anthropic |
| Limites de API | Gerenciado via AWS | Gerenciado pela Anthropic |
| Correção de IDs | Não necessário | Necessário ajustar IDs entre tool_use e tool_result |

## 6. Integração com o Frontend

O frontend permite que o usuário escolha entre as opções através de um dropdown:

```html
<select id="modelSelect">
  <option value="openai">OpenAI</option>
  <option value="claude">Claude (Bedrock)</option>
  <option value="anthropic">Claude (API Direct)</option>
</select>
```

## 7. Fluxo de processamento

1. **Fluxo Bedrock**:
   - Recebe mensagem do usuário + histórico de mensagens
   - Converte tools MCP para formato Claude
   - Chama AWS Bedrock com a mensagem e ferramentas
   - Processa resposta do modelo
   - Se houver tool_use, executa a ferramenta e adiciona o resultado ao histórico
   - Retorna resposta final ao usuário

2. **Fluxo API Direta**:
   - Recebe mensagem do usuário
   - Formata corretamente as mensagens para o formato Anthropic
   - Chama API Anthropic
   - Se houver tool_use, executa a ferramenta e adiciona tanto a chamada quanto o resultado ao histórico
   - Faz nova chamada à API com o histórico atualizado
   - Retorna resposta final ao usuário

## 8. Conclusão

A implementação via API Direta da Anthropic oferece uma experiência mais robusta para tool use, eliminando problemas onde o modelo repetidamente chama ferramentas sem reconhecer que já foram executadas. A formatação correta das mensagens e o tratamento adequado dos IDs de tool_use e tool_result garantem que o Claude entenda corretamente quando uma ferramenta foi executada e receba apropriadamente os resultados.

Ambas as abordagens são mantidas no projeto para oferecer maior flexibilidade, permitindo que o usuário escolha de acordo com suas preferências ou necessidades específicas. 