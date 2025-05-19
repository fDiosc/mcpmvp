import { OpenAI } from "openai";
import dotenv from "dotenv";
dotenv.config();
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
/**
 * Cria um assistente OpenAI com ferramentas MCP dinâmicas
 * @param mcpClient Instância do MCP Client
 * @returns Assistente OpenAI criado com as ferramentas MCP atuais
 */
export async function createDynamicAssistant(mcpClient) {
    // Descobre as ferramentas MCP dinamicamente
    const tools = await mcpClient.listTools();
    const openaiTools = tools.tools.map((tool) => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description || `MCP tool: ${tool.name}`,
            parameters: tool.inputSchema
        }
    }));
    return createAssistant(openaiTools);
}
/**
 * Cria um assistente simples que pode usar ferramentas MCP (estático)
 * @param tools Lista de ferramentas MCP disponíveis para o assistente
 */
export async function createAssistant(tools) {
    try {
        console.log('Criando assistente OpenAI com ferramentas:', JSON.stringify(tools, null, 2));
        const assistant = await openai.beta.assistants.create({
            name: "MCP Test Assistant",
            instructions: "Você é um assistente útil que usa ferramentas MCP para ajudar os usuários.",
            model: "gpt-4o",
            tools
        });
        console.log(`Assistente criado com ID: ${assistant.id}`);
        return assistant;
    }
    catch (error) {
        console.error("Erro ao criar o assistente:", error);
        throw error;
    }
}
export async function createThread() {
    try {
        console.log('Criando thread OpenAI...');
        const thread = await openai.beta.threads.create();
        console.log(`Thread criada com ID: ${thread.id}`);
        return thread;
    }
    catch (error) {
        console.error("Erro ao criar a thread:", error);
        throw error;
    }
}
/**
 * Envia uma mensagem para o assistente e executa ferramentas MCP se necessário
 * @param client Instância do MCP Client
 * @param threadId ID da thread OpenAI
 * @param assistantId ID do assistente OpenAI
 * @param content Mensagem do usuário
 */
export async function sendMessage(client, threadId, assistantId, content) {
    try {
        console.log('Enviando mensagem para o assistente:', content);
        await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content
        });
        console.log('Criando run do assistente...');
        let run = await openai.beta.threads.runs.create(threadId, {
            assistant_id: assistantId
        });
        console.log('Run criado:', run.id);
        let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
        console.log('Status inicial do run:', runStatus.status);
        while (runStatus.status !== "completed" && runStatus.status !== "failed") {
            if (runStatus.status === "requires_action" && runStatus.required_action?.type === "submit_tool_outputs") {
                const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
                console.log('Tool calls recebidas:', JSON.stringify(toolCalls, null, 2));
                const tool_outputs = [];
                for (const call of toolCalls) {
                    const toolName = call.function.name;
                    const args = JSON.parse(call.function.arguments);
                    console.log('Chamando ferramenta MCP:', toolName, 'com argumentos:', args);
                    const result = await client.callTool({
                        name: toolName,
                        arguments: args
                    });
                    console.log('Resultado da ferramenta MCP:', result);
                    let output = "";
                    if (result?.content && Array.isArray(result.content) && result.content[0]?.text) {
                        output = result.content[0].text;
                    }
                    else {
                        output = JSON.stringify(result);
                    }
                    tool_outputs.push({
                        tool_call_id: call.id,
                        output
                    });
                }
                console.log('Submetendo tool_outputs ao OpenAI:', tool_outputs);
                run = await openai.beta.threads.runs.submitToolOutputs(threadId, run.id, { tool_outputs });
            }
            else {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
            console.log('Status atual:', runStatus.status);
        }
        const messages = await openai.beta.threads.messages.list(threadId);
        const assistantMessages = messages.data.filter(m => m.role === "assistant");
        if (assistantMessages.length > 0) {
            const contentBlocks = assistantMessages[0].content;
            const textBlock = contentBlocks.find((block) => block.type === "text" && typeof block.text === "object" && typeof block.text.value === "string");
            if (textBlock) {
                console.log('Resposta do assistente (bloco de texto):', textBlock.text.value);
                return textBlock.text.value;
            }
            console.log('Resposta do assistente (conteúdo bruto):', assistantMessages[0].content);
            return JSON.stringify(assistantMessages[0].content);
        }
        console.log('Sem resposta do assistente');
        return "Sem resposta do assistente";
    }
    catch (error) {
        console.error("Erro ao enviar mensagem:", error);
        throw error;
    }
}
/**
 * Cria um assistente OpenAI passando o endpoint do servidor MCP (mcp_servers)
 * @param mcpServerUrl URL do servidor MCP
 */
export async function createAssistantWithMcpServer(mcpServerUrl) {
    try {
        console.log('Criando assistente OpenAI com MCP server:', mcpServerUrl);
        const assistant = await openai.beta.assistants.create({
            name: "MCP Test Assistant",
            instructions: "Você é um assistente útil que usa ferramentas MCP para ajudar os usuários.",
            model: "gpt-4o",
            // @ts-expect-error: mcp_servers is not yet in the OpenAI SDK types, but is supported by the API
            mcp_servers: [mcpServerUrl]
        });
        console.log(`Assistente criado com ID: ${assistant.id}`);
        return assistant;
    }
    catch (error) {
        console.error("Erro ao criar o assistente com MCP server:", error);
        throw error;
    }
}
