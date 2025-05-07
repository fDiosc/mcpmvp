# Integração Claude 3.5 Haiku via AWS Bedrock

## Objetivo
Permitir que o usuário escolha entre assistentes OpenAI (GPT) ou Claude (via AWS Bedrock, modelo Haiku 3.5) na interface web, com suporte a tool use (function calling) dinâmico via MCP. Agora, apenas a ferramenta de notas (`create_note`) está disponível.

---

## 1. Pré-requisitos
- Conta AWS com Bedrock habilitado e acesso ao modelo Claude 3.5 Haiku (`anthropic.claude-3-haiku-20240307-v1:0`).
- Chaves de acesso AWS (Access Key ID, Secret Access Key, região).
- Node.js >= 18.
- Dependências: `@aws-sdk/client-bedrock-runtime`, `dotenv`, `@modelcontextprotocol/sdk`.

---

## 2. Configuração AWS Bedrock

1. Instale o SDK:
   ```sh
   npm install @aws-sdk/client-bedrock-runtime
   ```
2. Configure as credenciais AWS em `.env`:
   ```env
   AWS_ACCESS_KEY_ID=your-access-key
   AWS_SECRET_ACCESS_KEY=your-secret-key
   AWS_REGION=us-east-1
   ```

---

## 3. Chamada ao Claude Haiku 3.5 com Tool Use

```js
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import dotenv from "dotenv";
dotenv.config();

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

async function callClaudeHaiku(messages, tools) {
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1024,
    messages,
    tools
  };
  const command = new InvokeModelCommand({
    modelId: "anthropic.claude-3-haiku-20240307-v1:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body),
  });
  const response = await bedrock.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody;
}
```

---

## 4. Fluxo Conversacional e Tool Use

- O **frontend** mantém o histórico completo de mensagens (usuário e assistente) em memória por sessão (enquanto a aba estiver aberta).
- A cada requisição para Claude/Bedrock, o frontend envia o histórico completo no campo `history`.
- O **backend** processa esse histórico, executa tool use conforme necessário e retorna a resposta final ao frontend.
- O backend não persiste histórico entre sessões.
- O único tool use disponível é `create_note` (criação de notas).

### Exemplo de fluxo:
1. Usuário envia mensagem pelo chat web.
2. Frontend adiciona a mensagem ao histórico e envia todo o histórico para o backend.
3. Backend processa o histórico, chama Claude, executa tool use se necessário, e retorna a resposta.
4. Frontend adiciona a resposta ao histórico.

---

## 5. Estrutura para Seleção de Modelo (OpenAI x Bedrock)

- O usuário pode escolher entre OpenAI (com threads nativas) ou Claude (Bedrock) na interface web.
- Para Claude, o contexto é sempre enviado pelo frontend.
- Para OpenAI, o contexto é gerenciado por thread/conversationId nativo.

---

## 6. Riscos e Boas Práticas
- **Limites de uso:** Bedrock pode ter limites de requisições e custos.
- **Limite de contexto:** O histórico enviado deve ser limitado para não exceder o limite de tokens do modelo.
- **Segurança:** Nunca exponha chaves AWS no frontend.
- **Logs e monitoramento:** Logar chamadas e respostas para troubleshooting.
- **Persistência:** O histórico é perdido ao fechar a aba do navegador.

---

## 7. Exemplo de Uso

- **Chat:**
  - Você: oi
  - Agente: Olá! Como posso ajudar você hoje?
  - Você: crie uma nota chamada Teste com conteúdo Olá mundo
  - Agente: Nota criada com sucesso: Teste

- **Notas Criadas:**
  - First Note: This is note 1
  - Second Note: This is note 2
  - Teste: Olá mundo

---

**Com isso, seu sistema está pronto para alternar entre OpenAI e Claude (Bedrock) como assistente, com suporte a tool use dinâmico via MCP apenas para notas.** 