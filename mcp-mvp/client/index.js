import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { createDynamicAssistant, createThread, sendMessage } from './agents/assistant.js';
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
async function main() {
    try {
        console.log('Iniciando cliente OpenAI para conexão ao servidor MCP...');
        // Usar SSEClientTransport para conectar ao servidor Express
        const sseUrl = new URL('http://localhost:3333/mcp/sse');
        const transport = new SSEClientTransport(sseUrl);
        const client = new Client({
            name: 'openai-client',
            version: '0.1.0'
        });
        await client.connect(transport);
        console.log('Cliente conectado ao servidor MCP');
        // Listar ferramentas disponíveis
        const tools = await client.listTools();
        console.log('Ferramentas disponíveis:', tools.tools.map(t => t.name));
        // Criar um assistente com as ferramentas MCP (dinâmico)
        const assistant = await createDynamicAssistant(client);
        const thread = await createThread();
        // Exemplo de interação com o assistente
        const userInput = 'Crie uma nota com título "Teste" e conteúdo "Esta é uma nota criada via MCP!"';
        console.log(`Enviando pergunta: ${userInput}`);
        const response = await sendMessage(client, thread.id, assistant.id, userInput);
        console.log('Resposta do assistente:', response);
        // Fechar conexão
        await client.close();
    }
    catch (error) {
        console.error('Erro no cliente OpenAI:', error);
    }
}
main();
